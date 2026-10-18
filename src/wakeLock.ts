// Keeps the computer awake while the roaster is connected. A machine that sleeps stops answering
// the Hottop's status frames, and after about a second without a command the Hottop ejects the
// beans. Uses the Screen Wake Lock API: blocking the screen from sleeping also blocks idle
// system sleep. It cannot stop a closed lid or a deliberate sleep, so the UI says when it's held.
import { useSyncExternalStore } from 'react'

export interface WakeLockStatus {
  wanted: boolean
  held: boolean
  /** Why it isn't held, when it's wanted. Null while held or not wanted. */
  reason: string | null
}

export const wakeLockSupported = (): boolean => typeof navigator !== 'undefined' && 'wakeLock' in navigator

const NO_API = 'This browser can’t block sleep: it has no Screen Wake Lock. Use Chrome, Edge or Opera.'
const HIDDEN = 'The browser releases the lock while this tab is in the background. Come back to it to take it again.'

class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null
  private status: WakeLockStatus = { wanted: false, held: false, reason: null }
  private listeners = new Set<() => void>()

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        // The browser drops the lock every time the page is hidden, so take it again on return.
        if (this.status.wanted) void this.acquire()
      })
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus = (): WakeLockStatus => this.status

  /** Idempotent. */
  enable(): void {
    if (!this.status.wanted) this.set({ wanted: true, held: false, reason: null })
    void this.acquire()
  }

  disable(): void {
    const s = this.sentinel
    this.sentinel = null
    this.set({ wanted: false, held: false, reason: null })
    if (s && !s.released) s.release().catch(() => {})
  }

  private async acquire(): Promise<void> {
    if (!this.status.wanted) return
    if (!wakeLockSupported()) return this.set({ wanted: true, held: false, reason: NO_API })
    if (this.sentinel && !this.sentinel.released) return this.set({ wanted: true, held: true, reason: null })
    // request() is rejected unless the page is visible.
    if (document.visibilityState !== 'visible') return this.set({ wanted: true, held: false, reason: HIDDEN })
    try {
      const s = await navigator.wakeLock.request('screen')
      if (!this.status.wanted) {
        void s.release().catch(() => {})
        return
      }
      this.sentinel = s
      s.addEventListener('release', () => {
        if (this.sentinel !== s) return
        this.sentinel = null
        if (this.status.wanted) this.set({ wanted: true, held: false, reason: HIDDEN })
      })
      this.set({ wanted: true, held: true, reason: null })
    } catch (e) {
      this.set({ wanted: true, held: false, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  private set(next: WakeLockStatus): void {
    const p = this.status
    if (p.wanted === next.wanted && p.held === next.held && p.reason === next.reason) return
    this.status = next
    for (const fn of this.listeners) fn()
  }
}

export const wakeLock = new ScreenWakeLock()

export function useWakeLock(): WakeLockStatus {
  return useSyncExternalStore(wakeLock.subscribe, wakeLock.getStatus)
}
