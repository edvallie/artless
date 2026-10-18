// The driver's connection lifecycle, receive path and setpoint handling. The byte-level
// encode/echo behaviour is checked against the reference vectors in protocol.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { HottopDriver } from './driver'
import { FRAME_LENGTH, checksum } from './protocol'
import type { Transport, TransportHandlers } from './transport'

class FakeTransport implements Transport {
  label = 'fake'
  handlers!: TransportHandlers
  written: Uint8Array[] = []
  closed = 0
  openError: Error | null = null
  writeError: Error | null = null
  closeError: Error | null = null
  async open(h: TransportHandlers) {
    if (this.openError) throw this.openError
    this.handlers = h
  }
  async write(b: Uint8Array) {
    this.written.push(b)
    if (this.writeError) throw this.writeError
  }
  async close() {
    this.closed += 1
    if (this.closeError) throw this.closeError
  }
}

/** A status frame as the machine sends it. */
function status({ bt = 150, et = 200, heater = 40, mainFan = 6, fan = 0, version = 1, chaffTray = 1 } = {}) {
  const f = new Uint8Array(FRAME_LENGTH)
  f[0] = 0xa5
  f[1] = 0x96
  f[4] = version
  f[10] = heater
  f[11] = fan
  f[12] = mainFan
  f[19] = chaffTray
  f[23] = et >> 8
  f[24] = et & 0xff
  f[25] = bt >> 8
  f[26] = bt & 0xff
  f[35] = checksum(f)
  return f
}

async function connected() {
  const t = new FakeTransport()
  const d = new HottopDriver()
  await d.connect(t)
  return { t, d }
}

describe('connecting and disconnecting', () => {
  it('starts disconnected, with nothing read and nothing set', () => {
    const s = new HottopDriver().getSnapshot()
    expect(s).toMatchObject({ connection: 'disconnected', hasReadings: false, framesOk: 0, framesSent: 0 })
    expect(s.readings.bt).toBe(-1)
    expect(s.commanded).toEqual({ heater: 0, fan: 0, mainFan: 0, solenoid: 0, drumMotor: 0, coolingMotor: 0 })
  })

  it('reports the transport while connecting and once connected', async () => {
    const t = new FakeTransport()
    const d = new HottopDriver()
    const seen: string[] = []
    d.subscribe(() => seen.push(d.getSnapshot().connection))
    await d.connect(t)
    expect(seen).toContain('connecting')
    expect(d.getSnapshot()).toMatchObject({ connection: 'connected', transportLabel: 'fake' })
  })

  it('shows why a port failed to open and stays disconnected', async () => {
    const t = new FakeTransport()
    t.openError = new Error('Failed to open serial port.')
    const d = new HottopDriver()
    await d.connect(t)
    expect(d.getSnapshot()).toMatchObject({
      connection: 'disconnected',
      transportLabel: null,
      error: 'Failed to open serial port.',
    })
    // the failed transport is forgotten, so a later disconnect doesn't touch it
    await d.disconnect()
    expect(t.closed).toBe(0)
  })

  it('reports a non-Error rejection as text', async () => {
    const t = new FakeTransport()
    t.open = () => Promise.reject('port busy')
    const d = new HottopDriver()
    await d.connect(t)
    expect(d.getSnapshot().error).toBe('port busy')
  })

  it('closes the old transport before connecting a new one', async () => {
    const { t, d } = await connected()
    const next = new FakeTransport()
    next.label = 'next'
    await d.connect(next)
    expect(t.closed).toBe(1)
    expect(d.getSnapshot().transportLabel).toBe('next')
  })

  it('clears readings on disconnect but keeps setpoints for a reconnect', async () => {
    const { t, d } = await connected()
    t.handlers.onData(status())
    d.setHottop({ heater: 70 })
    await d.disconnect()
    const s = d.getSnapshot()
    expect(t.closed).toBe(1)
    expect(s).toMatchObject({ connection: 'disconnected', hasReadings: false, cutoffActive: false })
    expect(s.readings.bt).toBe(-1)
    expect(s.setpoints.heater).toBe(70)
  })

  it('treats a port that fails to close as closed', async () => {
    const { t, d } = await connected()
    t.closeError = new Error('device lost')
    await expect(d.disconnect()).resolves.toBeUndefined()
    expect(d.getSnapshot().connection).toBe('disconnected')
  })

  it('drops to disconnected with the reason when the link goes away', async () => {
    const { t, d } = await connected()
    t.handlers.onData(status())
    t.handlers.onClose(new Error('The device has been lost.'))
    expect(d.getSnapshot()).toMatchObject({
      connection: 'disconnected',
      hasReadings: false,
      error: 'The device has been lost.',
    })
  })

  it('drops to disconnected without an error on a clean close', async () => {
    const { t, d } = await connected()
    t.handlers.onClose()
    expect(d.getSnapshot()).toMatchObject({ connection: 'disconnected', error: null })
  })

  it('ignores a late close from a transport it already replaced', async () => {
    const { t, d } = await connected()
    const old = t.handlers
    await d.connect(new FakeTransport())
    old.onClose(new Error('stale'))
    expect(d.getSnapshot()).toMatchObject({ connection: 'connected', error: null })
  })

  it('throws away a half-received frame when reconnecting', async () => {
    const { t, d } = await connected()
    t.handlers.onData(status().slice(0, 20))
    const next = new FakeTransport()
    await d.connect(next)
    next.handlers.onData(status().slice(20)) // the tail alone is not a frame
    expect(d.getSnapshot().framesOk).toBe(0)
    next.handlers.onData(status())
    expect(d.getSnapshot().framesOk).toBe(1)
  })
})

describe('receiving frames', () => {
  it('decodes readings and answers every valid frame with one command', async () => {
    const { t, d } = await connected()
    t.handlers.onData(status({ bt: 180, et: 230, version: 7, chaffTray: 0 }))
    t.handlers.onData(status({ bt: 181, et: 231 }))
    const s = d.getSnapshot()
    expect(s.readings).toMatchObject({ bt: 181, et: 231 })
    expect(s.hasReadings).toBe(true)
    expect(s.framesOk).toBe(2)
    expect(t.written).toHaveLength(2)
    expect(s.framesSent).toBe(2)
    expect(s.lastFrameHex?.split(' ')).toHaveLength(FRAME_LENGTH)
    expect(s.lastSentHex?.split(' ')).toHaveLength(FRAME_LENGTH)
  })

  it('handles two frames arriving in one chunk', async () => {
    const { t, d } = await connected()
    t.handlers.onData(new Uint8Array([...status({ bt: 100 }), ...status({ bt: 101 })]))
    expect(d.getSnapshot().framesOk).toBe(2)
    expect(t.written).toHaveLength(2)
  })

  it('rejects a frame with a bad checksum and does not answer it', async () => {
    const { t, d } = await connected()
    const bad = status()
    bad[35] ^= 0xff
    t.handlers.onData(bad)
    expect(d.getSnapshot()).toMatchObject({ framesBad: 1, framesOk: 0, hasReadings: false })
    expect(t.written).toHaveLength(0)
  })

  it('accepts a bad checksum when the check is turned off', async () => {
    const { t, d } = await connected()
    d.setVerifyCrc(false)
    const bad = status({ bt: 123 })
    bad[35] ^= 0xff
    t.handlers.onData(bad)
    expect(d.getSnapshot()).toMatchObject({ framesBad: 0, framesOk: 1, verifyCrc: false })
    expect(d.getSnapshot().readings.bt).toBe(123)
  })

  it('tells frame and command listeners, until they unsubscribe', async () => {
    const { t, d } = await connected()
    const frames = vi.fn()
    const sent = vi.fn()
    const offFrame = d.onFrame(frames)
    const offSent = d.onSent(sent)
    t.handlers.onData(status({ bt: 150 }))
    expect(frames).toHaveBeenCalledOnce()
    expect(frames.mock.calls[0][0]).toMatchObject({ bt: 150 })
    expect(sent).toHaveBeenCalledOnce()
    expect(sent.mock.calls[0][2]).toBe(t.written[0])

    offFrame()
    offSent()
    t.handlers.onData(status())
    expect(frames).toHaveBeenCalledOnce()
    expect(sent).toHaveBeenCalledOnce()
  })

  it('stops notifying a snapshot subscriber after it unsubscribes', async () => {
    const { t, d } = await connected()
    const fn = vi.fn()
    const off = d.subscribe(fn)
    t.handlers.onData(status())
    const calls = fn.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    off()
    t.handlers.onData(status())
    expect(fn).toHaveBeenCalledTimes(calls)
  })

  it('surfaces a failed write', async () => {
    const { t, d } = await connected()
    t.writeError = new Error('write timeout')
    t.handlers.onData(status())
    await vi.waitFor(() => expect(d.getSnapshot().error).toBe('Write failed: write timeout'))
  })
})

describe('setpoints', () => {
  it('clamps and rounds percentages, and turns switches into 0 or 1', () => {
    const d = new HottopDriver()
    d.setHottop({ heater: 140, fan: -20, mainFan: 33.6, solenoid: true, drumMotor: false, coolingMotor: true })
    expect(d.getSnapshot().setpoints).toEqual({
      heater: 100,
      fan: 0,
      mainFan: 34,
      solenoid: 1,
      drumMotor: 0,
      coolingMotor: 1,
    })
  })

  it('only changes the outputs it is given', () => {
    const d = new HottopDriver()
    d.setHottop({ heater: 60 })
    d.setHottop({ drumMotor: true })
    expect(d.getSnapshot().setpoints).toMatchObject({ heater: 60, drumMotor: 1, fan: -1, mainFan: -1 })
  })

  it('goes back to echoing the machine when setpoints are cleared', async () => {
    const { t, d } = await connected()
    d.setHottop({ heater: 90 })
    t.handlers.onData(status({ heater: 40 }))
    expect(t.written[0][10]).toBe(90)
    d.clearSetpoints()
    t.handlers.onData(status({ heater: 40 }))
    expect(t.written[1][10]).toBe(40)
  })
})

describe('safety cutoff', () => {
  it('overrides the heater even if it was set, and keeps the cut once BT falls', async () => {
    const { t, d } = await connected()
    d.setHottop({ heater: 100, mainFan: 20, solenoid: false })
    t.handlers.onData(status({ bt: 221 }))
    expect(d.getSnapshot()).toMatchObject({ cutoffActive: true, cutoffTripped: true })
    expect(d.getSnapshot().commanded).toMatchObject({
      heater: 0,
      mainFan: 100,
      solenoid: 1,
      drumMotor: 1,
      coolingMotor: 1,
    })

    // The cut writes itself into the setpoints, so cooling below the line doesn't re-light the heater.
    t.handlers.onData(status({ bt: 200 }))
    expect(d.getSnapshot()).toMatchObject({ cutoffActive: false, cutoffTripped: true })
    expect(t.written[1][10]).toBe(0)
  })

  it('can only be acknowledged once BT is back below the cutoff', async () => {
    const { t, d } = await connected()
    t.handlers.onData(status({ bt: 225 }))
    d.acknowledgeCutoff()
    expect(d.getSnapshot().cutoffTripped).toBe(true)
    t.handlers.onData(status({ bt: 210 }))
    d.acknowledgeCutoff()
    expect(d.getSnapshot().cutoffTripped).toBe(false)
  })

  it('is cleared by a fresh connection', async () => {
    const { t, d } = await connected()
    t.handlers.onData(status({ bt: 230 }))
    await d.connect(new FakeTransport())
    expect(d.getSnapshot().cutoffTripped).toBe(false)
  })
})

describe('errors', () => {
  it('reports and clears an error raised elsewhere', () => {
    const d = new HottopDriver()
    d.reportError('No port selected')
    expect(d.getSnapshot().error).toBe('No port selected')
    d.clearError()
    expect(d.getSnapshot().error).toBeNull()
  })
})
