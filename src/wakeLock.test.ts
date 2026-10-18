// @vitest-environment happy-dom
// The wake lock is what keeps a sleeping computer from tripping the Hottop's eject watchdog, so
// the UI has to know exactly when it's held and why it isn't.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeSentinel extends EventTarget {
  released = false
  readonly type = 'screen'
  onrelease = null
  release = vi.fn(async () => {
    this.released = true
  })
  /** What the browser does when the page is hidden. */
  drop() {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

let visibility: DocumentVisibilityState = 'visible'
let request: ReturnType<typeof vi.fn>

function withApi() {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
}

function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

let current: { disable(): void } | null = null

/** A fresh instance per test: the module keeps one lock for the whole page. */
async function load() {
  vi.resetModules()
  const lock = (await import('./wakeLock')).wakeLock
  current = lock
  return lock
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  request = vi.fn(async () => new FakeSentinel())
})

afterEach(() => {
  // earlier instances keep their visibilitychange listener, so leave them unwanted
  current?.disable()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

describe('wake lock', () => {
  it('is neither wanted nor held until enabled', async () => {
    const lock = await load()
    expect(lock.getStatus()).toEqual({ wanted: false, held: false, reason: null })
  })

  it('takes the lock on enable', async () => {
    withApi()
    const lock = await load()
    lock.enable()
    await settle()
    expect(request).toHaveBeenCalledWith('screen')
    expect(lock.getStatus()).toEqual({ wanted: true, held: true, reason: null })
  })

  it('does not ask twice while it already holds the lock', async () => {
    withApi()
    const lock = await load()
    lock.enable()
    await settle()
    lock.enable()
    await settle()
    expect(request).toHaveBeenCalledOnce()
    expect(lock.getStatus().held).toBe(true)
  })

  it('explains when the browser has no wake lock at all', async () => {
    const lock = await load()
    lock.enable()
    await settle()
    expect(lock.getStatus()).toMatchObject({ wanted: true, held: false })
    expect(lock.getStatus().reason).toMatch(/no Screen Wake Lock/)
  })

  it('waits for the tab to be visible, then takes the lock when it comes back', async () => {
    withApi()
    visibility = 'hidden'
    const lock = await load()
    lock.enable()
    await settle()
    expect(request).not.toHaveBeenCalled()
    expect(lock.getStatus().reason).toMatch(/background/)

    setVisibility('visible')
    await settle()
    expect(lock.getStatus()).toEqual({ wanted: true, held: true, reason: null })
  })

  it('notices when the browser drops the lock, and retakes it on return', async () => {
    withApi()
    const lock = await load()
    lock.enable()
    await settle()
    const first: FakeSentinel = await request.mock.results[0].value

    first.drop()
    expect(lock.getStatus()).toMatchObject({ wanted: true, held: false })
    expect(lock.getStatus().reason).toMatch(/background/)

    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    expect(lock.getStatus().held).toBe(true)
  })

  it('passes on why a request was refused', async () => {
    request = vi.fn(async () => {
      throw new DOMException('Battery saver is on.', 'NotAllowedError')
    })
    withApi()
    const lock = await load()
    lock.enable()
    await settle()
    expect(lock.getStatus()).toEqual({ wanted: true, held: false, reason: 'Battery saver is on.' })
  })

  it('reports a refusal that is not an Error as text', async () => {
    request = vi.fn(() => Promise.reject('denied'))
    withApi()
    const lock = await load()
    lock.enable()
    await settle()
    expect(lock.getStatus().reason).toBe('denied')
  })

  it('releases the lock on disable and stops wanting it', async () => {
    withApi()
    const lock = await load()
    lock.enable()
    await settle()
    const s: FakeSentinel = await request.mock.results[0].value
    lock.disable()
    expect(s.release).toHaveBeenCalledOnce()
    expect(lock.getStatus()).toEqual({ wanted: false, held: false, reason: null })

    // a release event after disabling is not a problem worth reporting
    s.drop()
    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledOnce()
    expect(lock.getStatus().wanted).toBe(false)
  })

  it('lets go of a lock that arrives after it was disabled', async () => {
    let grant!: (s: FakeSentinel) => void
    request = vi.fn(() => new Promise<FakeSentinel>((r) => (grant = r)))
    withApi()
    const lock = await load()
    lock.enable()
    lock.disable()
    const late = new FakeSentinel()
    grant(late)
    await settle()
    expect(late.release).toHaveBeenCalledOnce()
    expect(lock.getStatus().held).toBe(false)
  })

  it('only notifies subscribers when the status actually changes', async () => {
    withApi()
    const lock = await load()
    const fn = vi.fn()
    const off = lock.subscribe(fn)
    lock.enable()
    await settle()
    expect(fn).toHaveBeenCalledTimes(2) // wanted, then held
    lock.enable()
    await settle()
    expect(fn).toHaveBeenCalledTimes(2)
    off()
    lock.disable()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
