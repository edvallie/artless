// A pretend Hottop 2K+ for trying the UI without a roaster.
// It speaks the real frame format and mimics the machine's 1 s eject watchdog.
// The thermal model and the 250 ms broadcast rate are made up; they are not measured from a machine.
import { FRAME_LENGTH, FrameParser, MACHINE_WATCHDOG_S, checksum, isValidFrame } from './protocol'
import type { Transport, TransportHandlers } from './transport'

const AMBIENT = 21
const BROADCAST_MS = 250

interface SimMachine {
  heater: number // 0–100
  fan: number // 0–10
  mainFan: number // 0–10
  solenoid: number
  drumMotor: number
  coolingMotor: number
  et: number
  bt: number
  beansInDrum: boolean
}

export interface SimInfo {
  speed: number
  beansInDrum: boolean
  pcControl: boolean
  watchdogEjects: number
}

export class SimulatorTransport implements Transport {
  readonly label = 'Simulator'
  private handlers: TransportHandlers | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private parser = new FrameParser()
  private lastCommandAt = 0
  private pcControl = false
  private m: SimMachine = freshMachine()
  private info: SimInfo = { speed: 1, beansInDrum: true, pcControl: false, watchdogEjects: 0 }
  private infoListeners = new Set<() => void>()

  // ---- sim controls, for the UI ----

  subscribe = (fn: () => void) => {
    this.infoListeners.add(fn)
    return () => this.infoListeners.delete(fn)
  }
  getInfo = (): SimInfo => this.info

  setSpeed(speed: number): void {
    this.setInfo({ speed })
  }

  /** Puts a fresh, cold batch in the drum. */
  loadBatch(): void {
    const keep = { heater: this.m.heater, fan: this.m.fan, mainFan: this.m.mainFan, drumMotor: this.m.drumMotor }
    this.m = { ...freshMachine(), ...keep, et: this.m.et }
    this.setInfo({ beansInDrum: true })
  }

  private setInfo(patch: Partial<SimInfo>): void {
    this.info = { ...this.info, ...patch }
    for (const fn of this.infoListeners) fn()
  }

  // ---- Transport ----

  async open(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers
    this.timer = setInterval(() => this.tick(), BROADCAST_MS)
  }

  async write(bytes: Uint8Array): Promise<void> {
    for (const f of this.parser.push(bytes)) {
      if (!isValidFrame(f)) continue
      this.m.heater = Math.min(f[10], 100)
      this.m.fan = Math.min(f[11], 10)
      this.m.mainFan = Math.min(f[12], 10)
      this.m.solenoid = f[16] ? 1 : 0
      this.m.drumMotor = f[17] ? 1 : 0
      this.m.coolingMotor = f[18] ? 1 : 0
      this.lastCommandAt = performance.now()
      if (!this.pcControl) this.setInfo({ pcControl: true })
      this.pcControl = true
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.handlers = null
  }

  // ---- machine ----

  private tick(): void {
    const m = this.m
    // Watchdog: under PC control and silent for > 1 s → the real machine dumps the beans.
    if (this.pcControl && performance.now() - this.lastCommandAt > MACHINE_WATCHDOG_S * 1000) {
      this.pcControl = false
      m.heater = 0
      m.solenoid = 1
      m.coolingMotor = 1
      m.fan = 10
      this.setInfo({ pcControl: false, watchdogEjects: this.info.watchdogEjects + 1 })
    }

    const dt = (BROADCAST_MS / 1000) * this.info.speed
    const etTarget = AMBIENT + m.heater * 3.3 * (1 - m.mainFan * 0.04)
    m.et += ((etTarget - m.et) * dt) / 28

    if (m.solenoid && m.beansInDrum) {
      m.beansInDrum = false
      this.setInfo({ beansInDrum: false })
    }
    if (m.beansInDrum) {
      const tau = m.drumMotor ? 75 : 110 // stalled drum transfers heat worse
      m.bt += ((m.et - m.bt) * dt) / tau
    } else {
      const tau = m.coolingMotor && m.fan > 0 ? 30 - m.fan * 1.5 : 140
      m.bt += ((AMBIENT - m.bt) * dt) / tau
    }

    this.handlers?.onData(encodeStatus(m))
  }
}

function freshMachine(): SimMachine {
  return {
    heater: 0,
    fan: 0,
    mainFan: 0,
    solenoid: 0,
    drumMotor: 0,
    coolingMotor: 0,
    et: AMBIENT,
    bt: AMBIENT,
    beansInDrum: true,
  }
}

function encodeStatus(m: SimMachine): Uint8Array {
  const f = new Uint8Array(FRAME_LENGTH)
  f[0] = 0xa5
  f[1] = 0x96
  f[4] = 1 // version
  f[10] = Math.round(m.heater)
  f[11] = m.fan
  f[12] = m.mainFan
  f[16] = m.solenoid
  f[17] = m.drumMotor
  f[18] = m.coolingMotor
  f[19] = 1 // chaff tray
  const et = Math.max(0, Math.round(m.et))
  const bt = Math.max(0, Math.round(m.bt))
  f[23] = et >> 8
  f[24] = et & 0xff
  f[25] = bt >> 8
  f[26] = bt & 0xff
  f[35] = checksum(f)
  return f
}
