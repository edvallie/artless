import { useEffect, useState } from 'react'
import { ControlPanel } from './components/Controls'
import { RoastChart } from './components/RoastChart'
import type { DriverSnapshot } from './hottop/driver'
import { BT_CUTOFF, MACHINE_WATCHDOG_S } from './hottop/protocol'
import { SimulatorTransport } from './hottop/simulator'
import { WebSerialTransport, webSerialSupported } from './hottop/webSerial'
import { roastLog, useRateOfRise, useRoast, useSamples, type RoastMeta, type Sample } from './roastLog'
import { deltaToUnit, driver, fmtClock, fmtTemp, useDebug, useDriver, useSimInfo, useUnit, type Unit } from './state'
import { useWakeLock, wakeLock } from './wakeLock'
import './App.css'

export default function App() {
  const snap = useDriver()
  const samples = useSamples()
  const roast = useRoast()
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
        <h1 className="mark">artless</h1>
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

      <main className="layout">
        <div className="main-col">
          <section className="roast" aria-label="Roast">
            <Readouts snap={snap} roast={roast} unit={unit} />
            <RoastChart samples={samples} roast={roast} unit={unit} />
            <div className="chart-foot">
              <RoastBar roast={roast} samples={samples} />
            </div>
          </section>
          {debug && <MachineDetails snap={snap} samples={samples} roast={roast} unit={unit} />}
        </div>

        <aside className="side">
          <ControlPanel snap={snap} />
          {debug && sim && <SimPanel sim={sim} />}
        </aside>
      </main>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} debug={debug} setDebug={setDebug} />
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

function Readouts({ snap, roast, unit }: { snap: DriverSnapshot; roast: RoastMeta; unit: Unit }) {
  const r = snap.readings
  const ror = useRateOfRise()
  return (
    <dl className="readouts">
      <div className="ro ro-bt">
        <dt>
          <i className="sw sw-bt" />
          Bean temp
        </dt>
        <dd>
          {fmtTemp(r.bt, unit)}
          <span className="u">°{unit}</span>
        </dd>
      </div>
      <div className="ro">
        <dt>
          <i className="sw sw-et" />
          Environment
        </dt>
        <dd>
          {fmtTemp(r.et, unit)}
          <span className="u">°{unit}</span>
        </dd>
      </div>
      <div className="ro">
        <dt>
          <i className="sw sw-bt" />
          BT rate of rise
        </dt>
        <dd>
          {ror === null ? '—' : `${ror >= 0 ? '+' : '−'}${Math.abs(deltaToUnit(ror, unit)).toFixed(1)}`}
          <span className="u">°/min</span>
        </dd>
      </div>
      <div className="ro">
        <dt>{roast.phase === 'finished' ? 'Roast length' : 'Roast time'}</dt>
        <dd>{roast.roastSeconds === null ? '—' : fmtClock(roast.roastSeconds)}</dd>
      </div>
    </dl>
  )
}

/** Downloads the whole recording: every frame, every command, every marker. */
function downloadRoast() {
  const data = roastLog.export()
  const stamp = new Date(data.chargeAt ?? data.firstAt ?? Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `roast-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** The roast clock lives here: readings are recorded from the moment of connection, but 0:00 is
 *  the moment the beans go in. */
function RoastBar({ roast, samples }: { roast: RoastMeta; samples: Sample[] }) {
  return (
    <div className="roast-bar">
      {roast.phase === 'idle' && (
        <>
          <button className="btn btn-strong" onClick={() => roastLog.charge()} disabled={!samples.length}>
            Drop beans in
          </button>
          <p className="note">
            {samples.length
              ? 'Starts the roast clock at 0:00. The preheat already on the chart keeps its place, at negative time.'
              : 'Waiting for readings. The chart records as soon as the roaster sends them.'}
          </p>
        </>
      )}
      {roast.phase === 'roasting' && (
        <>
          <button className="btn btn-strong" onClick={() => roastLog.beansOut()}>
            Beans out
          </button>
          <p className="note">
            Ends the roast at {fmtClock(roast.roastSeconds ?? 0)}. “Drop beans out” in the controls does this too.
            Recording carries on, so the cooling curve is kept.
          </p>
        </>
      )}
      {roast.phase === 'finished' && (
        <>
          <button className="btn" onClick={() => roastLog.newRoast()}>
            New roast
          </button>
          <p className="note">
            Roasted for {fmtClock(roast.roastSeconds ?? 0)}. Starting a new roast throws this recording away, so
            download it first if you want to keep it.
          </p>
        </>
      )}
      <button className="btn btn-quiet" onClick={downloadRoast} disabled={!roast.frames}>
        Download roast
      </button>
    </div>
  )
}

function SimPanel({ sim }: { sim: SimulatorTransport }) {
  const info = useSimInfo(sim)
  if (!info) return null
  return (
    <section className="panel sim" aria-labelledby="sim-h">
      <h2 id="sim-h">Simulator</h2>
      <p className="note">
        A made-up thermal model speaking the real frame format. It ejects the beans like the real machine if commands
        stop for {MACHINE_WATCHDOG_S} s.
      </p>
      <div className="sim-row">
        <span className="ctl-label">Speed</span>
        <div className="units" role="group" aria-label="Simulation speed">
          {[1, 5, 20].map((s) => (
            <button key={s} aria-pressed={info.speed === s} onClick={() => sim.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <dl className="facts">
        <dt>Beans</dt>
        <dd>{info.beansInDrum ? 'In the drum' : 'In the cooling tray'}</dd>
        <dt>Under PC control</dt>
        <dd>{info.pcControl ? 'Yes' : 'No'}</dd>
        <dt>Watchdog ejects</dt>
        <dd>{info.watchdogEjects}</dd>
      </dl>
      <button className="btn" onClick={() => sim.loadBatch()} disabled={info.beansInDrum}>
        Load a new batch
      </button>
    </section>
  )
}

function MachineDetails({
  snap,
  samples,
  roast,
  unit,
}: {
  snap: DriverSnapshot
  samples: Sample[]
  roast: RoastMeta
  unit: Unit
}) {
  const r = snap.readings
  const ago = snap.lastFrameAt ? `${((Date.now() - snap.lastFrameAt) / 1000).toFixed(1)} s ago` : '—'
  const wake = useWakeLock()
  return (
    <section className="details" aria-labelledby="details-h">
      <h2 id="details-h">Machine and link</h2>
      <div className="details-grid">
        <dl className="facts">
          <dt>Protocol version byte</dt>
          <dd>{snap.hasReadings ? r.version : '—'}</dd>
          <dt>Chaff tray byte</dt>
          <dd>{snap.hasReadings ? r.chaffTray : '—'}</dd>
          <dt>Frames received</dt>
          <dd>
            {snap.framesOk} good, {snap.framesBad} rejected
          </dd>
          <dt>Frames sent</dt>
          <dd>{snap.framesSent}</dd>
          <dt>Last frame</dt>
          <dd>{ago}</dd>
          <dt>Sleep while connected</dt>
          <dd>{!wake.wanted ? '—' : wake.held ? 'Blocked' : 'Not blocked'}</dd>
          <dt>Recorded for playback</dt>
          <dd>
            {roast.frames} frames, {roast.commands} commands, {roast.events} events
          </dd>
          <dt>Checksum check</dt>
          <dd>
            <label className="check">
              <input type="checkbox" checked={snap.verifyCrc} onChange={(e) => driver.setVerifyCrc(e.target.checked)} />
              Reject frames with a bad checksum
            </label>
          </dd>
        </dl>
        <div className="hex">
          <h3>Last frame from the Hottop</h3>
          <code>{snap.lastFrameHex ?? 'Nothing received yet'}</code>
          <h3>Last command sent</h3>
          <code>{snap.lastSentHex ?? 'Nothing sent yet. Commands only go out while artless has control.'}</code>
        </div>
      </div>

      <details className="table">
        <summary>Recorded data ({samples.length} samples, one per second)</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">BT °{unit}</th>
                <th scope="col">ET °{unit}</th>
                <th scope="col">Heater %</th>
                <th scope="col">Main fan</th>
                <th scope="col">Cooling fan</th>
              </tr>
            </thead>
            <tbody>
              {samples
                .slice(-300)
                .reverse()
                .map((s) => (
                  <tr key={s.t}>
                    <td>{fmtClock(s.t)}</td>
                    <td>{fmtTemp(s.bt, unit)}</td>
                    <td>{fmtTemp(s.et, unit)}</td>
                    <td>{s.heater}</td>
                    <td>{s.mainFan / 10}</td>
                    <td>{s.fan / 10}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {samples.length > 300 && <p className="note">Showing the latest 300.</p>}
      </details>
    </section>
  )
}
