// @vitest-environment happy-dom
// The app shell and its pages: what debug mode shows, the banners, the roast buttons under the chart, and moving
// between pages mid-roast.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { FRAME_LENGTH, checksum } from './hottop/protocol'
import type { Transport, TransportHandlers } from './hottop/transport'
import { roastLog } from './roastLog'
import { routes } from './routes'
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

function renderApp(path = '/') {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
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
    renderApp()
    expect(menu().getAttribute('aria-expanded')).toBe('false')
    expect(drawer().hasAttribute('inert')).toBe(true)
    expect(debugSwitch().getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Run simulator' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Machine and link' })).toBeNull()
  })

  it('opens from the menu button and closes from Close, Escape or the backdrop', () => {
    renderApp()
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
    renderApp()
    fireEvent.click(menu())
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(menu().getAttribute('aria-expanded')).toBe('true')
  })

  it('shows the simulator and the link details in debug mode, and remembers it', () => {
    const { unmount } = renderApp()
    turnOnDebug()
    expect(debugSwitch().getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Run simulator' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Machine and link' })).toBeTruthy()
    unmount()

    renderApp()
    expect(screen.getByRole('button', { name: 'Run simulator' })).toBeTruthy()
    expect(menu().getAttribute('aria-expanded')).toBe('false') // the drawer itself never reopens on load
  })

  it('runs the simulator, and hides its panel without stopping it when debug goes off', async () => {
    renderApp()
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

  it('loads a new batch into the simulator once the beans are out', async () => {
    vi.useFakeTimers()
    renderApp()
    turnOnDebug()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run simulator' })))
    const sim = screen.getByRole('region', { name: 'Simulator' })
    const load = () => within(sim).getByRole('button', { name: 'Load a new batch' })
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(load()).toMatchObject({ disabled: true })

    fireEvent.click(screen.getByRole('button', { name: /Drop beans out/ }))
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(within(sim).getByText('In the cooling tray')).toBeTruthy()

    fireEvent.click(load())
    expect(within(sim).getByText('In the drum')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Disconnect' })))
  })

  it('reports frames, sleep blocking and the checksum switch in the link details', async () => {
    renderApp()
    turnOnDebug()
    const { frame } = await connectFake()
    const { framesOk, framesBad } = driver.getSnapshot() // the counters last the page's lifetime, not one link's
    frame(150)
    const details = screen.getByRole('region', { name: 'Machine and link' })
    expect(within(details).getByText(`${framesOk + 1} good, ${framesBad} rejected`)).toBeTruthy()
    expect(within(details).getByText('Not blocked')).toBeTruthy() // happy-dom has no wake lock
    expect(within(details).getByText(/Recorded data \(1 samples/)).toBeTruthy()

    fireEvent.click(within(details).getByRole('checkbox'))
    expect(driver.getSnapshot().verifyCrc).toBe(false)
  })
})

describe('banners', () => {
  it('only mentions the simulator to browsers without Web Serial in debug mode', () => {
    renderApp()
    const banner = () => screen.getByText(/can’t open serial ports/)
    expect(banner().textContent).not.toContain('simulator')
    expect(screen.getByRole('button', { name: 'Connect Hottop' })).toMatchObject({ disabled: true })
    turnOnDebug()
    expect(banner().textContent).toContain('The simulator works here.')
  })

  it('warns that the computer can still sleep while connected', async () => {
    renderApp()
    await connectFake()
    expect(screen.getByText('Your computer can still go to sleep.')).toBeTruthy()
  })

  it('shows a connection problem until dismissed', () => {
    renderApp()
    act(() => driver.reportError('Write failed: timeout'))
    expect(screen.getByRole('alert').textContent).toContain('Write failed: timeout')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('holds the safety cutoff banner while BT is high, then lets it be dismissed', async () => {
    renderApp()
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

describe('leaving the site', () => {
  const leave = () => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  }

  it('asks before a reload or a closed tab drops the roaster, and only while connected', async () => {
    renderApp()
    expect(leave()).toBe(false)
    await connectFake()
    expect(leave()).toBe(true)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Disconnect' })))
    expect(leave()).toBe(false)
  })
})

describe('connecting to a Hottop', () => {
  function withSerial(requestPort: () => Promise<unknown>) {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort } })
  }

  it('says nothing when the port picker is closed without a choice', async () => {
    withSerial(() => Promise.reject(new DOMException('No port selected by the user.', 'NotFoundError')))
    renderApp()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Connect Hottop' })))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('shows any other failure to get a port', async () => {
    withSerial(() => Promise.reject(new DOMException('Access denied.', 'SecurityError')))
    renderApp()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Connect Hottop' })))
    expect(screen.getByRole('alert').textContent).toContain('Access denied.')
  })
})

describe('roast buttons', () => {
  it('waits for readings, then walks through beans in, beans out and a new roast', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    renderApp()
    expect(screen.getByRole('button', { name: 'Drop beans in' }).closest('fieldset')?.disabled).toBe(true)

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

    renderApp()
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

  it('names a recording that never started after its first frame', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0 + 60_000)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:roast')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    renderApp()
    const { frame } = await connectFake()
    frame(150)
    fireEvent.click(screen.getByRole('button', { name: 'Download roast' }))
    expect(clicked[0].download).toBe('roast-2026-10-12-09-01.json')
  })
})

describe('readouts', () => {
  it('shows the BT rate of rise once it has 10 s of frames, signed and in the chosen unit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    renderApp()
    const ror = () => screen.getByText('BT rate of rise').closest('div')!.querySelector('dd')!.textContent
    const { frame } = await connectFake()
    expect(ror()).toBe('—°/min')

    for (let i = 0; i <= 20; i++) {
      vi.setSystemTime(T0 + i * 1000)
      frame(150 + i) // 1 °C a second
    }
    expect(ror()).toBe('+60.0°/min')
    fireEvent.click(screen.getByRole('button', { name: '°F' }))
    expect(ror()).toBe('+108.0°/min')

    for (let i = 21; i <= 60; i++) {
      vi.setSystemTime(T0 + i * 1000)
      frame(170 - (i - 20))
    }
    expect(ror()).toBe('−108.0°/min')
  })
})

describe('pages', () => {
  const footer = () => screen.getByRole('contentinfo')
  const keepTabOpen = /Keep this tab open and the cable connected while you roast/

  it('warns about the watchdog in the footer of every page, and on the About page', () => {
    renderApp()
    expect(within(footer()).getByText(keepTabOpen)).toBeTruthy()
    fireEvent.click(within(footer()).getByRole('link', { name: 'About artless' }))
    expect(within(footer()).getByText(keepTabOpen)).toBeTruthy()
    expect(within(screen.getByRole('main')).getByText(keepTabOpen)).toBeTruthy()
  })

  it('keeps the roast running, recording and in sight of the banners on the About page', async () => {
    renderApp()
    const { frame } = await connectFake()
    frame(150)
    fireEvent.click(screen.getByRole('button', { name: 'Drop beans in' }))

    fireEvent.click(within(footer()).getByRole('link', { name: 'About artless' }))
    expect(screen.getByRole('heading', { name: 'About artless' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Roast' })).toBeNull()

    const sent = driver.getSnapshot().framesSent
    frame(225)
    expect(driver.getSnapshot().framesSent).toBe(sent + 1) // still answering the watchdog
    expect(roastLog.getMeta()).toMatchObject({ phase: 'roasting', frames: 2 })
    expect(screen.getByText('Connected to fake')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Safety cutoff.')

    fireEvent.click(screen.getByRole('link', { name: 'Back to the roaster' }))
    expect(screen.getByRole('button', { name: 'Beans out' })).toBeTruthy()
  })

  it('links to the source, and opens every link off the site in a new tab so the roast survives it', () => {
    renderApp('/about')
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
      'https://github.com/edvallie/artless',
    )
    const outside = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')]
    expect(outside.length).toBeGreaterThan(0)
    for (const a of outside) expect(a.target).toBe('_blank')
  })

  it('says when there is no page at an address, and the wordmark leads back to the roaster', () => {
    renderApp('/nowhere')
    expect(screen.getByRole('heading', { name: 'There’s no page here' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'artless' }))
    expect(screen.getByRole('region', { name: 'Roast' })).toBeTruthy()
  })
})
