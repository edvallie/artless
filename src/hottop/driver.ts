// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2010-2026 The artisan team (Marko Luther and contributors)
// Copyright (C) 2026 Dalton V
// Derived from Artisan's src/artisanlib/hottop.py (https://github.com/artisan-roaster-scope/artisan, commit 548036e).
// Ported to TypeScript and modified for artless, 2026. See LICENSE.

// Hottop driver: control logic, setpoints and safety cutoff, on top of a Transport.
import {
  BT_CUTOFF,
  FrameParser,
  decodeStatus,
  encodeCommand,
  isValidFrame,
  toHex,
  type HottopCommand,
  type HottopStatus,
} from './protocol'
import type { Transport } from './transport'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/** -1 means "not set": the current reading is echoed back instead. */
export type Setpoints = HottopCommand

export interface DriverSnapshot {
  connection: ConnectionState
  transportLabel: string | null
  error: string | null
  readings: HottopStatus
  hasReadings: boolean
  setpoints: Setpoints
  commanded: HottopCommand // what the next control frame will carry
  cutoffActive: boolean // BT ≥ cutoff: drop is being forced
  cutoffTripped: boolean // the cutoff fired since connecting (cleared on connect or acknowledge)
  verifyCrc: boolean
  framesOk: number
  framesBad: number
  framesSent: number
  lastFrameAt: number | null
  lastFrameHex: string | null
  lastSentAt: number | null
  lastSentHex: string | null
}

const EMPTY_READINGS: HottopStatus = {
  version: 0,
  heater: 0,
  fan: 0,
  mainFan: 0,
  solenoid: 0,
  drumMotor: 0,
  coolingMotor: 0,
  chaffTray: 0,
  et: -1,
  bt: -1,
}

const UNSET: Setpoints = { heater: -1, fan: -1, mainFan: -1, solenoid: -1, drumMotor: -1, coolingMotor: -1 }

function newValue(set: number, get: number): number {
  if (set !== -1) return set
  if (get !== -1) return get
  return 0
}

const clampPct = (v: number) => Math.max(0, Math.min(Math.round(v), 100))

export interface SetHottopArgs {
  heater?: number
  fan?: number
  mainFan?: number
  solenoid?: boolean
  drumMotor?: boolean
  coolingMotor?: boolean
}

export class HottopDriver {
  private transport: Transport | null = null
  private parser = new FrameParser()
  private listeners = new Set<() => void>()
  private frameListeners = new Set<(s: HottopStatus, at: number, raw: Uint8Array) => void>()
  private sentListeners = new Set<(cmd: HottopCommand, at: number, raw: Uint8Array) => void>()
  private snap: DriverSnapshot

  constructor() {
    this.snap = {
      connection: 'disconnected',
      transportLabel: null,
      error: null,
      readings: EMPTY_READINGS,
      hasReadings: false,
      setpoints: UNSET,
      commanded: this.computeCommanded(EMPTY_READINGS, UNSET),
      cutoffActive: false,
      cutoffTripped: false,
      verifyCrc: true,
      framesOk: 0,
      framesBad: 0,
      framesSent: 0,
      lastFrameAt: null,
      lastFrameHex: null,
      lastSentAt: null,
      lastSentHex: null,
    }
  }

  // ---- store plumbing (for useSyncExternalStore) ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): DriverSnapshot => this.snap

  /** Called once per valid status frame, with the frame's own 36 bytes. */
  onFrame(fn: (s: HottopStatus, at: number, raw: Uint8Array) => void): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }

  /** Called once per command frame handed to the transport. */
  onSent(fn: (cmd: HottopCommand, at: number, raw: Uint8Array) => void): () => void {
    this.sentListeners.add(fn)
    return () => this.sentListeners.delete(fn)
  }

  private update(patch: Partial<DriverSnapshot>): void {
    const next = { ...this.snap, ...patch }
    next.commanded = this.computeCommanded(next.readings, next.setpoints)
    this.snap = next
    for (const fn of this.listeners) fn()
  }

  private computeCommanded(r: HottopStatus, s: Setpoints): HottopCommand {
    return {
      heater: newValue(s.heater, r.heater),
      fan: newValue(s.fan, r.fan),
      mainFan: newValue(s.mainFan, r.mainFan),
      solenoid: newValue(s.solenoid, r.solenoid),
      drumMotor: newValue(s.drumMotor, r.drumMotor),
      coolingMotor: newValue(s.coolingMotor, r.coolingMotor),
    }
  }

  // ---- connection ----

  async connect(transport: Transport): Promise<void> {
    if (this.transport) await this.disconnect()
    this.parser.reset()
    this.transport = transport
    this.update({ connection: 'connecting', transportLabel: transport.label, error: null, cutoffTripped: false })
    try {
      await transport.open({
        onData: (chunk) => this.handleData(chunk),
        onClose: (err) => this.handleClosed(transport, err),
      })
      if (this.transport === transport) this.update({ connection: 'connected' })
    } catch (e) {
      if (this.transport === transport) this.transport = null
      this.update({ connection: 'disconnected', transportLabel: null, error: errorText(e) })
    }
  }

  async disconnect(): Promise<void> {
    const t = this.transport
    this.transport = null
    if (t) {
      try {
        await t.close()
      } catch {
        // closing a port that already went away is fine
      }
    }
    this.resetReadings()
    this.update({ connection: 'disconnected', transportLabel: null })
  }

  private handleClosed(transport: Transport, err?: Error): void {
    if (this.transport !== transport) return
    this.transport = null
    this.resetReadings()
    this.update({ connection: 'disconnected', transportLabel: null, error: err ? errorText(err) : null })
  }

  /** Setpoints are kept, so a reconnect picks up where it left off. */
  private resetReadings(): void {
    this.parser.reset()
    this.update({ readings: EMPTY_READINGS, hasReadings: false, cutoffActive: false })
  }

  // ---- receive path ----

  private handleData(chunk: Uint8Array): void {
    for (const frame of this.parser.push(chunk)) {
      if (!isValidFrame(frame, this.snap.verifyCrc)) {
        this.update({ framesBad: this.snap.framesBad + 1 })
        continue
      }
      const now = Date.now()
      const readings = decodeStatus(frame)
      let setpoints = this.snap.setpoints
      let cutoffActive = false
      if (BT_CUTOFF <= readings.bt) {
        // Safety cut: heater off, main fan max, open the door, run drum and stirrer.
        cutoffActive = true
        setpoints = { ...setpoints, heater: 0, mainFan: 100, solenoid: 1, drumMotor: 1, coolingMotor: 1 }
      }
      this.update({
        readings,
        hasReadings: true,
        setpoints,
        cutoffActive,
        cutoffTripped: this.snap.cutoffTripped || cutoffActive,
        framesOk: this.snap.framesOk + 1,
        lastFrameAt: now,
        lastFrameHex: toHex(frame),
      })
      for (const fn of this.frameListeners) fn(readings, now, frame)
      // artless is always in control while connected: there is no read-only mode. One command
      // answers every valid status frame, with no extra throttle. With no setpoints, the reply
      // echoes the machine's own values, so connecting changes nothing until you touch a control.
      this.sendControl()
    }
  }

  private sendControl(): void {
    const t = this.transport
    if (!t) return
    const cmd = this.snap.commanded
    const frame = encodeCommand(cmd)
    const now = Date.now()
    this.update({ framesSent: this.snap.framesSent + 1, lastSentAt: now, lastSentHex: toHex(frame) })
    for (const fn of this.sentListeners) fn(cmd, now, frame)
    t.write(frame).catch((e) => this.update({ error: `Write failed: ${errorText(e)}` }))
  }

  // ---- external interface ----

  /** Sets outputs. Fans in percent. */
  setHottop(args: SetHottopArgs): void {
    const s = { ...this.snap.setpoints }
    if (args.heater !== undefined) s.heater = clampPct(args.heater)
    if (args.fan !== undefined) s.fan = clampPct(args.fan)
    if (args.mainFan !== undefined) s.mainFan = clampPct(args.mainFan)
    if (args.solenoid !== undefined) s.solenoid = args.solenoid ? 1 : 0
    if (args.drumMotor !== undefined) s.drumMotor = args.drumMotor ? 1 : 0
    if (args.coolingMotor !== undefined) s.coolingMotor = args.coolingMotor ? 1 : 0
    this.update({ setpoints: s })
  }

  /** Forget all setpoints so every output echoes the machine's own reading again. */
  clearSetpoints(): void {
    this.update({ setpoints: UNSET })
  }

  acknowledgeCutoff(): void {
    if (!this.snap.cutoffActive) this.update({ cutoffTripped: false })
  }

  setVerifyCrc(on: boolean): void {
    this.update({ verifyCrc: on })
  }

  reportError(message: string): void {
    this.update({ error: message })
  }

  clearError(): void {
    this.update({ error: null })
  }
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
