import { useEffect, useState, useSyncExternalStore } from 'react'
import { HottopDriver } from './hottop/driver'
import type { SimInfo, SimulatorTransport } from './hottop/simulator'

export const driver = new HottopDriver()

export function useDriver() {
  return useSyncExternalStore(driver.subscribe, driver.getSnapshot)
}

const noSim = { subscribe: () => () => {}, getInfo: () => null }
export function useSimInfo(sim: SimulatorTransport | null): SimInfo | null {
  const s = sim ?? noSim
  return useSyncExternalStore(s.subscribe, s.getInfo)
}

// ---- units ----

export type Unit = 'C' | 'F'

export function useUnit(): [Unit, (u: Unit) => void] {
  const [unit, setUnit] = useState<Unit>(() => {
    try {
      return localStorage.getItem('artless.unit') === 'F' ? 'F' : 'C'
    } catch {
      return 'C'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('artless.unit', unit)
    } catch {
      /* storage unavailable */
    }
  }, [unit])
  return [unit, setUnit]
}

// ---- debug mode ----

/** Off by default. Shows the simulator and the machine and link details. */
export function useDebug(): [boolean, (on: boolean) => void] {
  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('artless.debug') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('artless.debug', debug ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [debug])
  return [debug, setDebug]
}

export const toUnit = (c: number, u: Unit) => (u === 'F' ? (c * 9) / 5 + 32 : c)
/** Converts a temperature difference (e.g. RoR), not an absolute temperature. */
export const deltaToUnit = (c: number, u: Unit) => (u === 'F' ? (c * 9) / 5 : c)

export function fmtTemp(c: number, u: Unit): string {
  if (c < 0) return '—'
  return toUnit(c, u).toFixed(0)
}

/** Roast clock. Preheat sits before the charge, so negative times are normal. */
export function fmtClock(s: number): string {
  const sign = s < 0 ? '−' : ''
  const abs = Math.abs(s)
  const m = Math.floor(abs / 60)
  const sec = Math.floor(abs % 60)
  return `${sign}${m}:${sec.toString().padStart(2, '0')}`
}
