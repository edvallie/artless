import { useOutletContext } from 'react-router'
import type { ShellContext } from '../App'
import { ControlPanel } from '../components/Controls'
import { RoastChart } from '../components/RoastChart'
import type { DriverSnapshot } from '../hottop/driver'
import { MACHINE_WATCHDOG_S } from '../hottop/protocol'
import type { SimulatorTransport } from '../hottop/simulator'
import { roastLog, useRateOfRise, useRoast, useSamples, type RoastMeta, type Sample } from '../roastLog'
import { deltaToUnit, driver, fmtClock, fmtTemp, useDriver, useSimInfo, type Unit } from '../state'
import { useWakeLock } from '../wakeLock'

/** The roaster itself: readouts, chart and controls. Leaving this page leaves the roast running. */
export function Roaster() {
  const { unit, debug, sim } = useOutletContext<ShellContext>()
  const snap = useDriver()
  const samples = useSamples()
  const roast = useRoast()

  return (
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
