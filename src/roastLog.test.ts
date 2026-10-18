// The roast clock and the recording: reading always, timing from the charge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAME_LENGTH, checksum } from './hottop/protocol'
import type { Transport, TransportHandlers } from './hottop/transport'
import { btRateOfRise, roastLog, type FrameRecord } from './roastLog'
import { driver } from './state'

class FakeTransport implements Transport {
  label = 'fake'
  handlers!: TransportHandlers
  written: Uint8Array[] = []
  async open(h: TransportHandlers) {
    this.handlers = h
  }
  async write(b: Uint8Array) {
    this.written.push(b)
  }
  async close() {}
}

/** A status frame as the machine sends it: temperatures at 23–26, outputs at 10–12. */
function statusFrame({
  bt,
  et,
  heater = 0,
  mainFan = 0,
}: {
  bt: number
  et: number
  heater?: number
  mainFan?: number
}) {
  const f = new Uint8Array(FRAME_LENGTH)
  f[0] = 0xa5
  f[1] = 0x96
  f[4] = 1
  f[10] = heater
  f[12] = mainFan / 10
  f[23] = (et >> 8) & 0xff
  f[24] = et & 0xff
  f[25] = (bt >> 8) & 0xff
  f[26] = bt & 0xff
  f[35] = checksum(f)
  return f
}

const T0 = Date.UTC(2026, 9, 12, 9, 0, 0)

describe('roast recording', () => {
  let t: FakeTransport

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    roastLog.newRoast()
    t = new FakeTransport()
    await driver.connect(t)
  })

  afterEach(async () => {
    await driver.disconnect()
    roastLog.newRoast()
    vi.useRealTimers()
  })

  const frame = (bt: number, et = bt + 20) => t.handlers.onData(statusFrame({ bt, et }))

  it('reads and charts before the clock starts', () => {
    frame(60)
    vi.setSystemTime(T0 + 2000)
    frame(80)
    expect(roastLog.getMeta().phase).toBe('idle')
    expect(roastLog.getMeta().roastSeconds).toBeNull()
    expect(roastLog.getSamples().map((s) => s.t)).toEqual([0, 2])
    expect(roastLog.getMeta().frames).toBe(2)
  })

  it('moves the preheat to negative time when the beans go in', () => {
    frame(60)
    vi.setSystemTime(T0 + 2000)
    frame(80)
    roastLog.charge()
    expect(roastLog.getSamples().map((s) => s.t)).toEqual([-2, 0])

    vi.setSystemTime(T0 + 5000)
    frame(90)
    const samples = roastLog.getSamples()
    expect(samples.map((s) => s.t)).toEqual([-2, 0, 3])
    expect(roastLog.getMeta().phase).toBe('roasting')
    expect(roastLog.getMeta().roastSeconds).toBe(3)
  })

  it('keeps one sample per second but every frame', () => {
    frame(60)
    vi.setSystemTime(T0 + 300)
    frame(61)
    vi.setSystemTime(T0 + 600)
    frame(62)
    vi.setSystemTime(T0 + 1000)
    frame(63)
    expect(roastLog.getSamples()).toHaveLength(2)
    expect(roastLog.getMeta().frames).toBe(4)
  })

  it('records commands and setpoint changes with the readings', () => {
    frame(60) // answered with an echo of the machine's own values
    roastLog.charge()
    driver.setHottop({ heater: 70, mainFan: 30 })
    vi.setSystemTime(T0 + 1000)
    frame(70)

    expect(roastLog.getMeta().commands).toBe(2)
    const out = roastLog.export()
    expect(out.commands[0].cmd.heater).toBe(0)
    expect(out.commands[1].cmd.heater).toBe(70)
    expect(out.commands[1].t).toBe(1)
    expect(out.commands[1].raw.split(' ')).toHaveLength(FRAME_LENGTH)
    expect(out.events.map((e) => e.kind)).toEqual(['connected', 'charge', 'setpoints'])
    expect(out.events[2].setpoints).toMatchObject({ heater: 70, mainFan: 30 })
  })

  it('ends the roast on beans out and keeps recording', () => {
    frame(60)
    roastLog.charge()
    vi.setSystemTime(T0 + 600_000)
    frame(210)
    roastLog.beansOut()
    expect(roastLog.getMeta().phase).toBe('finished')
    expect(roastLog.getMeta().roastSeconds).toBe(600)

    vi.setSystemTime(T0 + 660_000)
    frame(80) // cooling
    expect(roastLog.getMeta().roastSeconds).toBe(600) // the length is fixed at the drop
    expect(roastLog.getSamples()).toHaveLength(3)
    expect(roastLog.getMeta().frames).toBe(3)
  })

  it('exports every frame verbatim, with both clocks', () => {
    frame(60)
    roastLog.charge()
    vi.setSystemTime(T0 + 1500)
    frame(65)
    const out = roastLog.export()
    expect(out.format).toBe('artless.roast')
    expect(out.chargeAt).toBe(T0)
    expect(out.frames).toHaveLength(2)
    expect(out.frames[0]).toMatchObject({ at: T0, t: 0 })
    expect(out.frames[1]).toMatchObject({ at: T0 + 1500, t: 1.5 })
    expect(out.frames[1].status).toMatchObject({ bt: 65, et: 85 })
    expect(out.frames[1].raw).toBe(
      Array.from(statusFrame({ bt: 65, et: 85 }), (b) => b.toString(16).padStart(2, '0')).join(' '),
    )
  })

  it('has no roast-relative times before the beans go in', () => {
    frame(60)
    const out = roastLog.export()
    expect(out.chargeAt).toBeNull()
    expect(out.roastSeconds).toBeNull()
    expect(out.frames[0].t).toBeNull()
    expect(out.events[0]).toMatchObject({ kind: 'connected', detail: 'fake', t: null })
    expect(out.source.transport).toBe('fake')
  })

  it('ignores a second charge and a beans-out without a charge', () => {
    frame(60)
    roastLog.beansOut()
    expect(roastLog.getMeta().phase).toBe('idle')

    roastLog.charge()
    vi.setSystemTime(T0 + 5000)
    roastLog.charge()
    expect(roastLog.getMeta().chargeAt).toBe(T0)

    roastLog.beansOut()
    vi.setSystemTime(T0 + 9000)
    roastLog.beansOut()
    expect(roastLog.getMeta().dropAt).toBe(T0 + 5000)
    expect(roastLog.export().events.map((e) => e.kind)).toEqual(['connected', 'charge', 'drop'])
  })

  it('logs the safety cutoff firing and clearing', () => {
    frame(150)
    vi.setSystemTime(T0 + 1000)
    frame(221)
    vi.setSystemTime(T0 + 2000)
    frame(210)
    const kinds = roastLog.export().events.map((e) => e.kind)
    expect(kinds).toContain('cutoff-fired')
    expect(kinds.indexOf('cutoff-cleared')).toBeGreaterThan(kinds.indexOf('cutoff-fired'))
  })

  it('logs a lost link with its reason', () => {
    frame(150)
    t.handlers.onClose(new Error('The device has been lost.'))
    const last = roastLog.export().events.at(-1)
    expect(last).toMatchObject({ kind: 'disconnected', detail: 'The device has been lost.' })
  })

  it('tells subscribers about each change, until they unsubscribe', () => {
    const fn = vi.fn()
    const off = roastLog.subscribe(fn)
    frame(60)
    expect(fn).toHaveBeenCalled()
    const calls = fn.mock.calls.length
    off()
    frame(61)
    expect(fn).toHaveBeenCalledTimes(calls)
  })
})

// ---- rate of rise: a fit over the frames, not a two-point secant ----

/** Frames at `hz`, BT following `bt(t)` and rounded down to whole °C like the real machine. */
function ramp(seconds: number, hz: number, bt: (t: number) => number, t0 = T0): FrameRecord[] {
  const out: FrameRecord[] = []
  for (let i = 0; i <= seconds * hz; i++) {
    const t = i / hz
    out.push({ at: t0 + t * 1000, status: { ...EMPTY, bt: Math.floor(bt(t)), et: 0 }, raw: '' })
  }
  return out
}

const EMPTY = {
  version: 1,
  heater: 0,
  fan: 0,
  mainFan: 0,
  solenoid: 0,
  drumMotor: 0,
  coolingMotor: 0,
  chaffTray: 0,
  et: 0,
  bt: 0,
}

describe('BT rate of rise', () => {
  it('recovers an exact ramp', () => {
    // 1 °C/s sampled at 1 Hz lands on whole degrees, so there is no staircase to fit around
    expect(btRateOfRise(ramp(30, 1, (t) => 100 + t))).toBeCloseTo(60, 6)
  })

  it('holds steady on a quantised ramp, where a secant would step', () => {
    // 10 °C/min: BT only ticks every 6 s, so a 20 s secant could only ever say 9 or 12
    const frames = ramp(60, 4, (t) => 100 + t / 6)
    expect(btRateOfRise(frames)).toBeGreaterThan(9.3)
    expect(btRateOfRise(frames)).toBeLessThan(10.7)
  })

  it('only looks at the window, so a change shows up within it', () => {
    // flat for a minute, then 20 °C/min for 20 s: the fit should follow the recent slope
    const flat = ramp(60, 4, () => 100)
    const rising = ramp(20, 4, (t) => 100 + t / 3, T0 + 60_000)
    expect(btRateOfRise(flat)).toBeCloseTo(0, 6)
    expect(btRateOfRise([...flat, ...rising])).toBeGreaterThan(18)
  })

  it('waits for enough of a line, and for a reading at all', () => {
    expect(btRateOfRise([])).toBeNull()
    expect(btRateOfRise(ramp(5, 4, (t) => 100 + t))).toBeNull() // only 5 s of frames
    expect(btRateOfRise(ramp(30, 4, () => -1))).toBeNull() // no probe reading
  })

  it('is published to the UI as frames arrive', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    roastLog.newRoast()
    const t = new FakeTransport()
    await driver.connect(t)
    expect(roastLog.getRor()).toBeNull()
    for (let i = 0; i <= 60; i++) {
      vi.setSystemTime(T0 + i * 250)
      t.handlers.onData(statusFrame({ bt: 100 + Math.floor(i / 4), et: 150 }))
    }
    // 4 Hz frames over a 1 °C/s staircase: within 0.5 °C/min of the truth
    expect(roastLog.getRor()).toBeCloseTo(60, 0)
    await driver.disconnect()
    roastLog.newRoast()
    vi.useRealTimers()
  })
})
