// The roast recording. Everything the machine says and everything artless says back, kept at full
// rate with timestamps, so a roast can later be replayed exactly as it happened.
//
// Reading starts the moment the roaster connects, which is what the chart shows. The roast *clock*
// starts separately, when the beans go in ("charge" in roasting terms), so preheat sits at negative
// time and 0:00 is the moment the beans hit the drum.
import { useSyncExternalStore } from 'react'
import type { Setpoints } from './hottop/driver'
import { toHex, type HottopCommand, type HottopStatus } from './hottop/protocol'
import { driver } from './state'

export type RoastPhase = 'idle' | 'roasting' | 'finished'

/** One second of the chart series. Derived from the frames; `t` is seconds from charge. */
export interface Sample {
  at: number
  t: number
  bt: number
  et: number
  heater: number
  mainFan: number
  fan: number
}

/** A status frame from the roaster, decoded and verbatim. */
export interface FrameRecord {
  at: number
  status: HottopStatus
  raw: string // the 36 bytes, hex: replayable through FrameParser
}

/** A command frame artless sent. */
export interface CommandRecord {
  at: number
  cmd: HottopCommand
  raw: string
}

export type EventKind =
  | 'connected'
  | 'disconnected'
  | 'charge' // beans in: the roast clock starts here
  | 'drop' // beans out: the roast ends here
  | 'setpoints' // an output was changed, by hand or by the safety cutoff
  | 'cutoff-fired'
  | 'cutoff-cleared'

export interface EventRecord {
  at: number
  kind: EventKind
  detail?: string
  setpoints?: Setpoints
}

export interface RoastMeta {
  phase: RoastPhase
  chargeAt: number | null
  dropAt: number | null
  firstAt: number | null
  lastAt: number | null
  /** Seconds from charge to drop, or to the latest frame while still roasting. */
  roastSeconds: number | null
  frames: number
  commands: number
  events: number
  samples: number
}

const ROR_WINDOW_S = 20 // the fit window: ~10 s of lag, and short enough to see a change land
const ROR_MIN_SPAN_S = 10 // below this there isn't enough of a line to fit
const MAX_SAMPLES = 4 * 3600 // 4 h of chart series
const MAX_RECORDS = 200_000 // ~14 h of frames at 4 Hz; oldest go first

const sameSetpoints = (a: Setpoints, b: Setpoints) =>
  a.heater === b.heater &&
  a.fan === b.fan &&
  a.mainFan === b.mainFan &&
  a.solenoid === b.solenoid &&
  a.drumMotor === b.drumMotor &&
  a.coolingMotor === b.coolingMotor

/**
 * BT rate of rise in °C/min: a least-squares fit over every frame in the last `windowS`.
 *
 * Not a two-point secant. BT arrives quantised to whole °C (protocol.ts decodes a 16-bit integer),
 * so at 8 °C/min the reading only ticks every 7.5 s and a secant can only ever report multiples of
 * 60/windowS. A fit uses where the staircase sits inside the window, not just how many steps it
 * took, which is what makes a 20 s window steadier than the old 30 s secant despite less lag.
 */
export function btRateOfRise(frames: FrameRecord[], windowS = ROR_WINDOW_S, minSpanS = ROR_MIN_SPAN_S): number | null {
  const last = frames[frames.length - 1]
  if (!last) return null
  const t0 = last.at
  let n = 0
  let st = 0
  let sy = 0
  let stt = 0
  let sty = 0
  let earliest = t0
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    const t = (f.at - t0) / 1000 // seconds, negative going back
    if (t < -windowS) break
    if (f.status.bt < 0) continue // no probe reading in this frame
    n += 1
    st += t
    sy += f.status.bt
    stt += t * t
    sty += t * f.status.bt
    earliest = f.at
  }
  if (n < 3 || (t0 - earliest) / 1000 < minSpanS) return null
  const den = n * stt - st * st
  if (den <= 0) return null // every frame landed on the same timestamp
  return ((n * sty - st * sy) / den) * 60
}

class RoastLog {
  private samples: Sample[] = []
  private frames: FrameRecord[] = []
  private commands: CommandRecord[] = []
  private events: EventRecord[] = []
  private chargeAt: number | null = null
  private dropAt: number | null = null
  private firstAt: number | null = null
  private lastAt: number | null = null
  private lastSecond = -1
  private ror: number | null = null
  private meta: RoastMeta = this.computeMeta()
  private listeners = new Set<() => void>()
  private prev = driver.getSnapshot()

  constructor() {
    driver.onFrame((status, at, raw) => this.addFrame(status, at, raw))
    driver.onSent((cmd, at, raw) => {
      this.commands.push({ at, cmd, raw: toHex(raw) })
      trim(this.commands)
      this.bump()
    })
    driver.subscribe(() => this.observeDriver())
  }

  // ---- store plumbing ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSamples = (): Sample[] => this.samples
  getMeta = (): RoastMeta => this.meta
  getRor = (): number | null => this.ror

  // ---- markers ----

  /** Beans in: 0:00. Preheat samples already recorded shift to negative time. */
  charge(): void {
    if (this.chargeAt !== null) return
    const at = Date.now()
    this.chargeAt = at
    this.samples = this.samples.map((s) => ({ ...s, t: (s.at - at) / 1000 }))
    this.log({ at, kind: 'charge' })
  }

  /** Beans out: the end of the roast. Recording carries on, so the cooling curve is kept too. */
  beansOut(): void {
    if (this.chargeAt === null || this.dropAt !== null) return
    const at = Date.now()
    this.dropAt = at
    this.log({ at, kind: 'drop' })
  }

  /** Throws the recording away and waits for the next charge. */
  newRoast(): void {
    this.samples = []
    this.frames = []
    this.commands = []
    this.events = []
    this.chargeAt = null
    this.dropAt = null
    this.firstAt = null
    this.lastAt = null
    this.lastSecond = -1
    this.ror = null
    this.bump()
  }

  // ---- recording ----

  private addFrame(status: HottopStatus, at: number, raw: Uint8Array): void {
    this.frames.push({ at, status, raw: toHex(raw) })
    trim(this.frames)
    this.ror = btRateOfRise(this.frames)
    if (this.firstAt === null) this.firstAt = at
    this.lastAt = at
    // The chart gets one point per second; the frames above keep the full rate.
    if (status.bt >= 0) {
      const second = Math.floor((at - this.firstAt) / 1000)
      if (second !== this.lastSecond) {
        this.lastSecond = second
        const s: Sample = {
          at,
          t: this.tOf(at),
          bt: status.bt,
          et: status.et,
          heater: status.heater,
          mainFan: status.mainFan,
          fan: status.fan,
        }
        this.samples = [...this.samples, s]
        if (this.samples.length > MAX_SAMPLES) this.samples = this.samples.slice(-MAX_SAMPLES)
      }
    }
    this.bump()
  }

  /** Control, cutoff, connection and output changes, read off the driver's own snapshot. */
  private observeDriver(): void {
    const s = driver.getSnapshot()
    const p = this.prev
    this.prev = s
    const at = Date.now()
    if (s.connection !== p.connection) {
      if (s.connection === 'connected') this.log({ at, kind: 'connected', detail: s.transportLabel ?? undefined })
      else if (p.connection === 'connected') this.log({ at, kind: 'disconnected', detail: s.error ?? undefined })
    }
    if (s.cutoffActive !== p.cutoffActive) {
      this.log({ at, kind: s.cutoffActive ? 'cutoff-fired' : 'cutoff-cleared' })
    }
    if (!sameSetpoints(s.setpoints, p.setpoints)) {
      this.log({ at, kind: 'setpoints', setpoints: s.setpoints })
    }
  }

  private log(e: EventRecord): void {
    this.events.push(e)
    trim(this.events)
    this.bump()
  }

  private tOf(at: number): number {
    const origin = this.chargeAt ?? this.firstAt ?? at
    return (at - origin) / 1000
  }

  private computeMeta(): RoastMeta {
    const phase: RoastPhase = this.chargeAt === null ? 'idle' : this.dropAt === null ? 'roasting' : 'finished'
    const end = this.dropAt ?? this.lastAt
    return {
      phase,
      chargeAt: this.chargeAt,
      dropAt: this.dropAt,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
      roastSeconds: this.chargeAt !== null && end !== null ? (end - this.chargeAt) / 1000 : null,
      frames: this.frames.length,
      commands: this.commands.length,
      events: this.events.length,
      samples: this.samples.length,
    }
  }

  private bump(): void {
    this.meta = this.computeMeta()
    for (const fn of this.listeners) fn()
  }

  // ---- export: the whole recording, enough to replay the roast ----

  export(): RoastExport {
    return {
      format: 'artless.roast',
      version: 1,
      savedAt: new Date().toISOString(),
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      source: { transport: driver.getSnapshot().transportLabel, baudRate: 115200, frameLength: 36 },
      chargeAt: this.chargeAt,
      dropAt: this.dropAt,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
      roastSeconds: this.meta.roastSeconds,
      events: this.events.map((e) => ({ ...e, t: this.relative(e.at) })),
      frames: this.frames.map((f) => ({ ...f, t: this.relative(f.at) })),
      commands: this.commands.map((c) => ({ ...c, t: this.relative(c.at) })),
      samples: this.samples,
    }
  }

  /** Seconds from charge, null until the beans go in. Epoch `at` is always the primary clock. */
  private relative(at: number): number | null {
    if (this.chargeAt === null) return null
    return Math.round(((at - this.chargeAt) / 1000) * 1000) / 1000
  }
}

export interface RoastExport {
  format: 'artless.roast'
  version: 1
  savedAt: string
  timezoneOffsetMinutes: number
  source: { transport: string | null; baudRate: number; frameLength: number }
  chargeAt: number | null
  dropAt: number | null
  firstAt: number | null
  lastAt: number | null
  roastSeconds: number | null
  events: (EventRecord & { t: number | null })[]
  frames: (FrameRecord & { t: number | null })[]
  commands: (CommandRecord & { t: number | null })[]
  samples: Sample[]
}

function trim<T>(xs: T[]): void {
  if (xs.length > MAX_RECORDS) xs.splice(0, xs.length - MAX_RECORDS)
}

export const roastLog = new RoastLog()

export function useSamples(): Sample[] {
  return useSyncExternalStore(roastLog.subscribe, roastLog.getSamples)
}

export function useRoast(): RoastMeta {
  return useSyncExternalStore(roastLog.subscribe, roastLog.getMeta)
}

/** BT rate of rise in °C/min, or null until there's enough of a line to fit. */
export function useRateOfRise(): number | null {
  return useSyncExternalStore(roastLog.subscribe, roastLog.getRor)
}
