// @vitest-environment happy-dom
// The app shell: what debug mode shows, the banners, and the roast buttons under the chart.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { FRAME_LENGTH, checksum } from './hottop/protocol'
import type { Transport, TransportHandlers } from './hottop/transport'
import { roastLog } from './roastLog'
import { driver } from './state'

class FakeTransport implements Transport {
  label = 'fake'
  handlers!: TransportHandlers
  async open(h: TransportHandlers) {
    this.handlers = h
  }
  async write() {}
  async close() {}
}

function statusFrame(bt: number) {
  const f = new Uint8Array(FRAME_LENGTH)
  f[0] = 0xa5
  f[1] = 0x96
  f[25] = bt >> 8
  f[26] = bt & 0xff
  f[35] = checksum(f)
  return f
}

async function connectFake() {
  const t = new FakeTransport()
  await act(() => driver.connect(t))
  return { frame: (bt: number) => act(() => t.handlers.onData(statusFrame(bt))) }
}

const T0 = Date.UTC(2026, 9, 12, 9, 0, 0)
const menu = () => screen.getByRole('button', { name: 'Settings' })
const debugSwitch = () => screen.getByRole('button', { name: /Debug mode/ })
const drawer = () => document.getElementById('drawer')!

function turnOnDebug() {
  fireEvent.click(menu())
  fireEvent.click(debugSwitch())
}

beforeEach(() => {
  localStorage.clear()
  roastLog.newRoast()
})

afterEach(async () => {
  cleanup()
  await driver.disconnect()
  driver.clearSetpoints()
  driver.clearError()
  driver.setVerifyCrc(true)
  roastLog.newRoast()
  Reflect.deleteProperty(navigator, 'serial')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('settings drawer and debug mode', () => {
  it('starts with the drawer closed and debug mode off', () => {
    render(<App />)
    expect(menu().getAttribute('aria-expanded')).toBe('false')
    expect(drawer().hasAttribute('inert')).toBe(true)
    expect(debugSwitch().getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Run simulator' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Machine and link' })).toBeNull()
  })

  it('opens from the menu button and closes from Close, Escape or the backdrop', () => {
    render(<App />)
    fireEvent.click(menu())
    expect(menu().getAttribute('aria-expanded')).toBe('true')
    expect(drawer().hasAttribute('inert')).toBe(false)

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Close' }))
    expect(menu().getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(menu())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(menu().getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(menu())
    fireEvent.click(document.querySelector('.scrim')!)
    expect(menu().getAttribute('aria-expanded')).toBe('false')
  })

  it('ignores other keys while open', () => {
    render(<App />)
    fireEvent.click(menu())
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(menu().getAttribute('aria-expanded')).toBe('true')
  })

  it('shows the simulator and the link details in debug mode, and remembers it', () => {
    const { unmount } = render(<App />)
    turnOnDebug()
    expect(debugSwitch().getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Run simulator' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Machine and link' })).toBeTruthy()
    unmount()

    render(<App />)
    expect(screen.getByRole('button', { name: 'Run simulator' })).toBeTruthy()
    expect(menu().getAttribute('aria-expanded')).toBe('false') // the drawer itself never reopens on load
  })

  it('runs the simulator, and hides its panel without stopping it when debug goes off', async () => {
    render(<App />)
    turnOnDebug()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run simulator' })))
    expect(screen.getByText('Connected to Simulator')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Simulator' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '20×' }))
    expect(screen.getByRole('button', { name: '20×' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(debugSwitch())
    expect(screen.queryByRole('heading', { name: 'Simulator' })).toBeNull()
    expect(screen.getByText('Connected to Simulator')).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Disconnect' })))
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('reports frames, sleep blocking and the checksum switch in the link details', async () => {
    render(<App />)
    turnOnDebug()
    const { frame } = await connectFake()
    frame(150)
    const details = screen.getByRole('region', { name: 'Machine and link' })
    expect(within(details).getByText('1 good, 0 rejected')).toBeTruthy()
    expect(within(details).getByText('Not blocked')).toBeTruthy() // happy-dom has no wake lock
    expect(within(details).getByText(/Recorded data \(1 samples/)).toBeTruthy()

    fireEvent.click(within(details).getByRole('checkbox'))
    expect(driver.getSnapshot().verifyCrc).toBe(false)
  })
})

describe('banners', () => {
  it('only mentions the simulator to browsers without Web Serial in debug mode', () => {
    render(<App />)
    const banner = () => screen.getByText(/can’t open serial ports/)
    expect(banner().textContent).not.toContain('simulator')
    expect(screen.getByRole('button', { name: 'Connect Hottop' })).toMatchObject({ disabled: true })
    turnOnDebug()
    expect(banner().textContent).toContain('The simulator works here.')
  })

  it('warns that the computer can still sleep while connected', async () => {
    render(<App />)
    await connectFake()
    expect(screen.getByText('Your computer can still go to sleep.')).toBeTruthy()
  })

  it('shows a connection problem until dismissed', () => {
    render(<App />)
    act(() => driver.reportError('Write failed: timeout'))
    expect(screen.getByRole('alert').textContent).toContain('Write failed: timeout')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('holds the safety cutoff banner while BT is high, then lets it be dismissed', async () => {
    render(<App />)
    const { frame } = await connectFake()
    frame(225)
    expect(screen.getByRole('alert').textContent).toContain('Safety cutoff.')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()

    frame(205)
    expect(screen.getByRole('alert').textContent).toContain('Safety cutoff fired.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('connecting to a Hottop', () => {
  function withSerial(requestPort: () => Promise<unknown>) {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort } })
  }

  it('says nothing when the port picker is closed without a choice', async () => {
    withSerial(() => Promise.reject(new DOMException('No port selected by the user.', 'NotFoundError')))
    render(<App />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Connect Hottop' })))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('shows any other failure to get a port', async () => {
    withSerial(() => Promise.reject(new DOMException('Access denied.', 'SecurityError')))
    render(<App />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Connect Hottop' })))
    expect(screen.getByRole('alert').textContent).toContain('Access denied.')
  })
})

describe('roast buttons', () => {
  it('waits for readings, then walks through beans in, beans out and a new roast', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    render(<App />)
    expect(screen.getByRole('button', { name: 'Drop beans in' })).toMatchObject({ disabled: true })
    expect(screen.getByText(/Waiting for readings/)).toBeTruthy()

    const { frame } = await connectFake()
    frame(150)
    fireEvent.click(screen.getByRole('button', { name: 'Drop beans in' }))
    expect(roastLog.getMeta().phase).toBe('roasting')

    vi.setSystemTime(T0 + 492_000)
    frame(205)
    expect(screen.getByText(/Ends the roast at 8:12/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Beans out' }))
    expect(screen.getByText(/Roasted for 8:12/)).toBeTruthy()
    expect(screen.getByText('Roast length')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New roast' }))
    expect(roastLog.getMeta()).toMatchObject({ phase: 'idle', frames: 0 })
  })

  it('downloads the recording as JSON named after the charge time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (blobs.push(b as Blob), 'blob:roast'))
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    render(<App />)
    expect(screen.getByRole('button', { name: 'Download roast' })).toMatchObject({ disabled: true })
    const { frame } = await connectFake()
    frame(150)
    fireEvent.click(screen.getByRole('button', { name: 'Drop beans in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download roast' }))

    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('roast-2026-10-12-09-00.json')
    expect(clicked[0].href).toBe('blob:roast')
    const saved = JSON.parse(await blobs[0].text())
    expect(saved).toMatchObject({ format: 'artless.roast', chargeAt: T0 })
    expect(saved.frames).toHaveLength(1)
  })
})
