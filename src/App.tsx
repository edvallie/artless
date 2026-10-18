import { useEffect, useState } from 'react'
import { Link, Outlet, ScrollRestoration } from 'react-router'
import { BT_CUTOFF } from './hottop/protocol'
import { SimulatorTransport } from './hottop/simulator'
import { WebSerialTransport, webSerialSupported } from './hottop/webSerial'
import { roastLog } from './roastLog'
import { driver, fmtTemp, useDebug, useDriver, useUnit, type Unit } from './state'
import { useWakeLock, wakeLock } from './wakeLock'
import './App.css'

/** What the shell hands every page. */
export type ShellContext = { unit: Unit; debug: boolean; sim: SimulatorTransport | null }

/** The shell around every page. The top bar and the banners stay on screen wherever you are, because the roast
 *  carries on while you read another page. */
export default function App() {
  const snap = useDriver()
  const [unit, setUnit] = useUnit()
  const [debug, setDebug] = useDebug()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sim, setSim] = useState<SimulatorTransport | null>(null)

  const connectSerial = async () => {
    try {
      const t = await WebSerialTransport.request()
      setSim(null)
      await driver.connect(t)
    } catch (e) {
      // closing the port picker without choosing is not an error worth showing
      if (e instanceof DOMException && e.name === 'NotFoundError') return
      driver.reportError(e instanceof Error ? e.message : String(e))
    }
  }

  const connectSim = async () => {
    const t = new SimulatorTransport()
    setSim(t)
    roastLog.newRoast()
    await driver.connect(t)
  }

  const disconnect = async () => {
    await driver.disconnect()
    setSim(null)
  }

  const connected = snap.connection !== 'disconnected'
  const wake = useWakeLock()

  // A sleeping computer stops answering the Hottop, which then ejects the beans.
  useEffect(() => {
    if (!connected) return
    wakeLock.enable()
    return () => wakeLock.disable()
  }, [connected])

  return (
    <div className="app">
      <header className="bar">
        <button
          className="btn btn-icon"
          aria-expanded={drawerOpen}
          aria-controls="drawer"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Settings</span>
        </button>
        <h1 className="mark">
          <Link to="/">artless</Link>
        </h1>
        <p className="conn" aria-live="polite">
          <span className={`led led-${snap.connection}`} aria-hidden="true" />
          {snap.connection === 'connected' && `Connected to ${snap.transportLabel}`}
          {snap.connection === 'connecting' && `Connecting to ${snap.transportLabel}…`}
          {snap.connection === 'disconnected' && 'Not connected'}
        </p>
        <div className="bar-actions">
          {!connected && (
            <>
              <button className="btn btn-strong" onClick={connectSerial} disabled={!webSerialSupported()}>
                Connect Hottop
              </button>
              {debug && (
                <button className="btn" onClick={connectSim}>
                  Run simulator
                </button>
              )}
            </>
          )}
          {connected && (
            <button className="btn" onClick={disconnect}>
              Disconnect
            </button>
          )}
          <div className="units" role="group" aria-label="Temperature unit">
            {(['C', 'F'] as const).map((u) => (
              <button key={u} aria-pressed={unit === u} onClick={() => setUnit(u)}>
                °{u}
              </button>
            ))}
          </div>
        </div>
      </header>

      {!webSerialSupported() && !connected && (
        <p className="banner banner-info">
          This browser can’t open serial ports. Use Chrome, Edge or Opera on a desktop to reach the Hottop.
          {debug && ' The simulator works here.'}
        </p>
      )}
      {wake.wanted && !wake.held && (
        <p className="banner banner-info">
          <strong>Your computer can still go to sleep.</strong> {wake.reason} If it sleeps mid-roast, artless stops
          answering the Hottop and the beans are ejected about a second later.
        </p>
      )}
      {snap.error && (
        <p className="banner banner-error" role="alert">
          <strong>Connection problem.</strong> {snap.error}
          <button className="btn btn-quiet" onClick={() => driver.clearError()}>
            Dismiss
          </button>
        </p>
      )}
      {snap.cutoffTripped && (
        <p className="banner banner-critical" role="alert">
          <span className="icon" aria-hidden="true">
            !
          </span>
          {snap.cutoffActive ? (
            <span>
              <strong>Safety cutoff.</strong> Bean temp is at or above {fmtTemp(BT_CUTOFF, unit)}°. Heater is off, the
              door is open, and the main fan, drum and stirrer are running. Your settings are overridden until it drops.
            </span>
          ) : (
            <span>
              <strong>Safety cutoff fired.</strong> Bean temp reached {fmtTemp(BT_CUTOFF, unit)}° and the beans were
              dropped. The outputs stay where the cutoff left them until you change them.
            </span>
          )}
          {!snap.cutoffActive && (
            <button className="btn btn-quiet" onClick={() => driver.acknowledgeCutoff()}>
              Dismiss
            </button>
          )}
        </p>
      )}

      <Outlet context={{ unit, debug, sim } satisfies ShellContext} />

      <footer className="foot">
        <Link to="/about">About artless</Link>
      </footer>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} debug={debug} setDebug={setDebug} />
      <ScrollRestoration />
    </div>
  )
}

/** Settings that stay out of the way during a roast. Starts closed on every load. */
function Drawer({
  open,
  onClose,
  debug,
  setDebug,
}: {
  open: boolean
  onClose: () => void
  debug: boolean
  setDebug: (on: boolean) => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div className={open ? 'scrim scrim-open' : 'scrim'} onClick={onClose} aria-hidden="true" />
      <aside id="drawer" className={open ? 'drawer drawer-open' : 'drawer'} inert={!open} aria-labelledby="drawer-h">
        <div className="drawer-head">
          <h2 id="drawer-h">Settings</h2>
          <button className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="switch">
          <button
            className={debug ? 'toggle toggle-on' : 'toggle'}
            aria-pressed={debug}
            onClick={() => setDebug(!debug)}
          >
            <span className="toggle-label">Debug mode</span>
            <span className="toggle-state">{debug ? 'On' : 'Off'}</span>
          </button>
          <p className="note">Shows the simulator, and the machine and link details under the chart.</p>
        </div>
      </aside>
    </>
  )
}
