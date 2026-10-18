// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2010-2026 The artisan team (Marko Luther and contributors)
// Copyright (C) 2026 Dalton V
// Derived from Artisan's src/artisanlib/hottop.py (https://github.com/artisan-roaster-scope/artisan, commit 548036e).
// Ported to TypeScript and modified for artless, 2026. See LICENSE.

// Hottop 2K+ serial protocol: frame format, checksum, encode/decode and stream parser.

export const FRAME_LENGTH = 36
export const HEADER = [0xa5, 0x96] as const

// Safety limit (°C)
export const BT_CUTOFF = 220 // forced drop at or above this BT

// Machine ejects the beans if it receives no command for ~1 s while under PC control
export const MACHINE_WATCHDOG_S = 1

/** One decoded status frame. Fans are reported in percent (0–100) like the rest of the app. */
export interface HottopStatus {
  version: number // byte 4 ("1 = first released version"; not used)
  heater: number // byte 10, 0–100 %
  fan: number // byte 11, cooling fan, machine sends 0–10, stored ×10
  mainFan: number // byte 12, roasting fan, machine sends 0–10, stored ×10
  solenoid: number // byte 16, eject door 0/1
  drumMotor: number // byte 17, 0/1
  coolingMotor: number // byte 18, cooling-tray stirrer 0/1
  chaffTray: number // byte 19 (meaning unverified)
  et: number // bytes 23–24, °C
  bt: number // bytes 25–26, °C
}

/** Values the PC sends. Fans in percent; encoder scales to the machine's 0–10. */
export interface HottopCommand {
  heater: number
  fan: number
  mainFan: number
  solenoid: number
  drumMotor: number
  coolingMotor: number
}

export function checksum(bytes: ArrayLike<number>, length = FRAME_LENGTH - 1): number {
  let sum = 0
  for (let i = 0; i < length; i++) sum += bytes[i]
  return sum & 0xff
}

/** Python's round(): half to even. Needed so fan bytes match the reference vectors exactly (e.g. 25 % → 2). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff > 0.5) return f + 1
  if (diff < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

export function isValidFrame(frame: Uint8Array, verifyCrc = true): boolean {
  return (
    frame.length === FRAME_LENGTH &&
    frame[0] === HEADER[0] &&
    frame[1] === HEADER[1] &&
    (!verifyCrc || frame[35] === checksum(frame))
  )
}

export function decodeStatus(frame: Uint8Array): HottopStatus {
  return {
    version: frame[4],
    heater: frame[10],
    // Scaled like the main fan. Storing byte 11 raw (0–10) and then dividing by 10 again when
    // echoing it back would knock the cooling fan to 0/1 of 10.
    fan: frame[11] * 10,
    mainFan: frame[12] * 10,
    solenoid: frame[16],
    drumMotor: frame[17],
    coolingMotor: frame[18],
    chaffTray: frame[19],
    et: frame[23] * 256 + frame[24],
    bt: frame[25] * 256 + frame[26],
  }
}

/** Builds a PC→Hottop control frame. */
export function encodeCommand(cmd: HottopCommand): Uint8Array {
  const out = new Uint8Array(FRAME_LENGTH)
  out[0] = 0xa5
  out[1] = 0x96
  out[2] = 0xb0
  out[3] = 0xa0
  out[4] = 0x01
  out[5] = 0x01
  out[6] = 0x24
  out[10] = cmd.heater & 0xff
  out[11] = roundHalfEven(cmd.fan / 10) & 0xff
  out[12] = roundHalfEven(cmd.mainFan / 10) & 0xff
  out[16] = cmd.solenoid & 0xff
  out[17] = cmd.drumMotor & 0xff
  out[18] = cmd.coolingMotor & 0xff
  out[35] = checksum(out)
  return out
}

/**
 * Splits a byte stream into candidate frames:
 * skip to 0xA5, require 0x96 next (else drop and resync), then take 34 more bytes.
 * Candidates are returned whether or not their checksum is valid.
 */
export class FrameParser {
  private buf: number[] = []

  push(chunk: Uint8Array): Uint8Array[] {
    for (const b of chunk) this.buf.push(b)
    const frames: Uint8Array[] = []
    for (;;) {
      const start = this.buf.indexOf(HEADER[0])
      if (start < 0) {
        this.buf.length = 0
        break
      }
      if (start > 0) this.buf.splice(0, start)
      if (this.buf.length < 2) break
      if (this.buf[1] !== HEADER[1]) {
        this.buf.splice(0, 2) // consume both bytes and start over
        continue
      }
      if (this.buf.length < FRAME_LENGTH) break
      frames.push(Uint8Array.from(this.buf.splice(0, FRAME_LENGTH)))
    }
    return frames
  }

  reset(): void {
    this.buf.length = 0
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
