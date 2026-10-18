// The simulator has to behave like the machine where artless depends on it: valid frames on a
// steady beat, and the 1 s eject watchdog once a PC has taken control.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HottopDriver } from './driver'
import { decodeStatus, encodeCommand, isValidFrame, type HottopCommand } from './protocol'
import { SimulatorTransport } from './simulator'

const IDLE: HottopCommand = { heater: 0, fan: 0, mainFan: 0, solenoid: 0, drumMotor: 0, coolingMotor: 0 }

function open() {
  const sim = new SimulatorTransport()
  const frames: Uint8Array[] = []
  const onClose = vi.fn()
  void sim.open({ onData: (f) => frames.push(f), onClose })
  const last = () => decodeStatus(frames[frames.length - 1])
  return { sim, frames, last, onClose }
}

describe('simulator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('broadcasts a valid status frame every 250 ms, starting at room temperature', async () => {
    const { sim, frames, last } = open()
    vi.advanceTimersByTime(1000)
    expect(frames).toHaveLength(4)
    expect(frames.every((f) => isValidFrame(f))).toBe(true)
    expect(last()).toMatchObject({ bt: 21, et: 21, version: 1, chaffTray: 1 })
    await sim.close()
  })

  it('stops broadcasting when closed', async () => {
    const { sim, frames } = open()
    vi.advanceTimersByTime(500)
    await sim.close()
    vi.advanceTimersByTime(5000)
    expect(frames).toHaveLength(2)
  })

  it('takes commands and echoes them back in its status', async () => {
    const { sim, last } = open()
    await sim.write(encodeCommand({ ...IDLE, heater: 75, mainFan: 30, drumMotor: 1 }))
    vi.advanceTimersByTime(250)
    expect(last()).toMatchObject({ heater: 75, mainFan: 30, drumMotor: 1, solenoid: 0 })
    expect(sim.getInfo().pcControl).toBe(true)
    await sim.close()
  })

  it('ignores a corrupt command', async () => {
    const { sim, last } = open()
    const bad = encodeCommand({ ...IDLE, heater: 75 })
    bad[35] ^= 0xff
    await sim.write(bad)
    vi.advanceTimersByTime(250)
    expect(last().heater).toBe(0)
    expect(sim.getInfo().pcControl).toBe(false)
    await sim.close()
  })

  it('heats the beans with the heater on, and faster at a higher speed', async () => {
    const slow = open()
    const fast = open()
    fast.sim.setSpeed(20)
    for (const { sim } of [slow, fast]) await sim.write(encodeCommand({ ...IDLE, heater: 100, drumMotor: 1 }))
    // keep both under control while they heat
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(250)
      for (const { sim } of [slow, fast]) await sim.write(encodeCommand({ ...IDLE, heater: 100, drumMotor: 1 }))
    }
    expect(slow.last().et).toBeGreaterThan(21)
    expect(fast.last().bt).toBeGreaterThan(slow.last().bt)
    expect(fast.last().et).toBeGreaterThan(slow.last().et)
    await slow.sim.close()
    await fast.sim.close()
  })

  it('never ejects before a PC has taken control', async () => {
    const { sim } = open()
    vi.advanceTimersByTime(10_000)
    expect(sim.getInfo()).toMatchObject({ beansInDrum: true, watchdogEjects: 0 })
    await sim.close()
  })

  it('ejects the beans like the real machine when commands stop for over a second', async () => {
    const { sim, last } = open()
    const listener = vi.fn()
    sim.subscribe(listener)
    await sim.write(encodeCommand({ ...IDLE, heater: 80, drumMotor: 1 }))
    vi.advanceTimersByTime(1000)
    expect(sim.getInfo().watchdogEjects).toBe(0)

    vi.advanceTimersByTime(500)
    expect(sim.getInfo()).toMatchObject({ pcControl: false, beansInDrum: false, watchdogEjects: 1 })
    expect(last()).toMatchObject({ heater: 0, solenoid: 1, coolingMotor: 1, fan: 100 })
    expect(listener).toHaveBeenCalled()
    await sim.close()
  })

  it('cools beans in the tray, faster with the stirrer and fan running', async () => {
    const still = open()
    const stirred = open()
    for (const s of [still, stirred]) {
      s.sim.setSpeed(20)
      await s.sim.write(encodeCommand({ ...IDLE, heater: 100, drumMotor: 1 }))
    }
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(250)
      for (const s of [still, stirred]) await s.sim.write(encodeCommand({ ...IDLE, heater: 100, drumMotor: 1 }))
    }
    const hot = still.last().bt
    expect(hot).toBeGreaterThan(100)

    await still.sim.write(encodeCommand({ ...IDLE, solenoid: 1 }))
    await stirred.sim.write(encodeCommand({ ...IDLE, solenoid: 1, coolingMotor: 1, fan: 100 }))
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(250)
      await still.sim.write(encodeCommand({ ...IDLE, solenoid: 1 }))
      await stirred.sim.write(encodeCommand({ ...IDLE, solenoid: 1, coolingMotor: 1, fan: 100 }))
    }
    expect(still.sim.getInfo().beansInDrum).toBe(false)
    expect(still.last().bt).toBeLessThan(hot)
    expect(stirred.last().bt).toBeLessThan(still.last().bt)
    await still.sim.close()
    await stirred.sim.close()
  })

  it('loads a cold batch but keeps the outputs and the drum air temperature', async () => {
    const { sim, last } = open()
    sim.setSpeed(20)
    await sim.write(encodeCommand({ ...IDLE, heater: 100, drumMotor: 1, solenoid: 1 }))
    vi.advanceTimersByTime(250)
    await sim.write(encodeCommand({ ...IDLE, heater: 100, drumMotor: 1 }))
    expect(sim.getInfo().beansInDrum).toBe(false)
    const et = last().et

    sim.loadBatch()
    expect(sim.getInfo().beansInDrum).toBe(true)
    vi.advanceTimersByTime(250)
    expect(last()).toMatchObject({ heater: 100, drumMotor: 1, solenoid: 0 })
    expect(last().bt).toBeLessThan(30)
    expect(last().et).toBeGreaterThanOrEqual(et)
    await sim.close()
  })

  it('stays under control indefinitely when the driver is answering it', async () => {
    const sim = new SimulatorTransport()
    const d = new HottopDriver()
    await d.connect(sim)
    vi.advanceTimersByTime(30_000)
    expect(sim.getInfo()).toMatchObject({ pcControl: true, beansInDrum: true, watchdogEjects: 0 })
    expect(d.getSnapshot().framesOk).toBe(120)
    await d.disconnect()
  })

  it('stops notifying a subscriber that unsubscribed', async () => {
    const { sim } = open()
    const fn = vi.fn()
    sim.subscribe(fn)()
    sim.setSpeed(5)
    expect(fn).not.toHaveBeenCalled()
    expect(sim.getInfo().speed).toBe(5)
    await sim.close()
  })
})
