import { useEffect, useId, useState } from 'react'
import type { DriverSnapshot } from '../hottop/driver'
import { roastLog, useRoast } from '../roastLog'
import { driver } from '../state'

export function ControlPanel({ snap }: { snap: DriverSnapshot }) {
  const r = snap.readings
  const c = snap.commanded
  const connected = snap.connection === 'connected' && snap.hasReadings
  const roast = useRoast()

  return (
    <section className="panel controls" aria-labelledby="controls-h">
      <div className="control-head">
        <h2 id="controls-h">Roaster controls</h2>
        {!connected && <p className="note">Connect to the roaster first.</p>}
      </div>

      <fieldset disabled={!connected} className="outputs">
        <legend className="sr-only">Roaster outputs</legend>

        <Slider
          label="Heater"
          value={c.heater}
          reported={r.heater}
          live={connected}
          onChange={(v) => driver.setHottop({ heater: v })}
          swatch="sw-heater"
        />
        <Slider
          label="Main fan"
          hint="Roasting airflow"
          value={c.mainFan}
          reported={r.mainFan}
          live={connected}
          onChange={(v) => driver.setHottop({ mainFan: v })}
          step={10}
          swatch="sw-fan"
          rangeClass="range-fan"
        />
        <Slider
          label="Cooling fan"
          hint="Under the cooling tray"
          value={c.fan}
          reported={r.fan}
          live={connected}
          onChange={(v) => driver.setHottop({ fan: v })}
          step={10}
          rangeClass="range-fan"
        />

        <div className="switches">
          <Switch
            label="Drum motor"
            on={!!c.drumMotor}
            reported={!!r.drumMotor}
            live={connected}
            onChange={(v) => driver.setHottop({ drumMotor: v })}
          />
          <Switch
            label="Cooling stirrer"
            on={!!c.coolingMotor}
            reported={!!r.coolingMotor}
            live={connected}
            onChange={(v) => driver.setHottop({ coolingMotor: v })}
          />
          <Switch
            label="Eject door"
            on={!!c.solenoid}
            reported={!!r.solenoid}
            live={connected}
            onChange={(v) => driver.setHottop({ solenoid: v })}
            onText="Open"
            offText="Closed"
          />
        </div>

        <div className="actions">
          {roast.phase === 'idle' && (
            <>
              <button className="btn btn-strong btn-charge" onClick={() => roastLog.charge()}>
                Drop beans in
              </button>
              <p className="note">
                Starts the roast clock at 0:00. The preheat already on the chart keeps its place, at negative time.
              </p>
            </>
          )}
          <button
            className="btn btn-drop"
            onClick={() => {
              driver.setHottop({ heater: 0, solenoid: true, drumMotor: true, coolingMotor: true, fan: 100 })
              roastLog.beansOut()
            }}
          >
            Drop beans out
          </button>
          <p className="note">
            Heater off, door open, drum and stirrer on, cooling fan at 100%. Also marks the end of the roast.
          </p>
          <button className="btn btn-quiet" onClick={() => driver.clearSetpoints()}>
            Follow the machine’s values
          </button>
          <p className="note">Stops overriding: every output echoes what the Hottop reports.</p>
        </div>
      </fieldset>
    </section>
  )
}

/** A change takes a frame or two to come back from the Hottop, so only a disagreement that has held this long counts. */
const MISMATCH_MS = 3000

/** True once the Hottop has reported something other than `value` for MISMATCH_MS straight. Any change to either side
 *  starts the clock again, so dragging a slider the machine is following never trips it. */
function useMismatch<T>(value: T, reported: T, live: boolean): boolean {
  const [held, setHeld] = useState(false)
  const key = live && value !== reported ? `${value}|${reported}` : null
  useEffect(() => {
    if (key === null) return
    const t = setTimeout(() => setHeld(true), MISMATCH_MS)
    return () => {
      clearTimeout(t)
      setHeld(false)
    }
  }, [key])
  return held
}

/** A 0–100 % output. The fans step by 10 %: the protocol only carries 0–10 for them, so finer steps couldn't
 *  reach the machine. */
function Slider(props: {
  label: string
  hint?: string
  value: number
  reported: number
  live: boolean
  onChange: (v: number) => void
  step?: number
  swatch?: string
  rangeClass?: string
}) {
  const id = useId()
  const mismatch = useMismatch(props.value, props.reported, props.live)
  const warning = `Hottop reports ${props.reported}%`
  return (
    <div className="ctl">
      <label htmlFor={id} className="ctl-label">
        {props.swatch && <i className={`sw ${props.swatch}`} />}
        {props.label}
        {props.hint && <span className="hint">{props.hint}</span>}
      </label>
      <output
        htmlFor={id}
        className={mismatch ? 'ctl-value mismatch' : 'ctl-value'}
        title={mismatch ? warning : undefined}
      >
        {props.value}%{mismatch && <span className="sr-only">. {warning}</span>}
      </output>
      <input
        id={id}
        type="range"
        className={props.rangeClass}
        min={0}
        max={100}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  )
}

function Switch(props: {
  label: string
  on: boolean
  reported: boolean
  live: boolean
  onChange: (v: boolean) => void
  onText?: string
  offText?: string
}) {
  const onText = props.onText ?? 'On'
  const offText = props.offText ?? 'Off'
  const mismatch = useMismatch(props.on, props.reported, props.live)
  const warning = `Hottop reports ${(props.reported ? onText : offText).toLowerCase()}`
  return (
    <button
      className={props.on ? 'toggle toggle-on' : 'toggle'}
      aria-pressed={props.on}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="toggle-label">{props.label}</span>
      <span className={mismatch ? 'toggle-state mismatch' : 'toggle-state'} title={mismatch ? warning : undefined}>
        {props.on ? onText : offText}
        {mismatch && <span className="sr-only">. {warning}</span>}
      </span>
    </button>
  )
}
