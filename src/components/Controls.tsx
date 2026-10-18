import { useId } from 'react'
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
          onChange={(v) => driver.setHottop({ heater: v })}
          swatch="sw-heater"
        />
        <Slider
          label="Main fan"
          hint="Roasting airflow"
          value={c.mainFan}
          reported={r.mainFan}
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
          onChange={(v) => driver.setHottop({ fan: v })}
          step={10}
          rangeClass="range-fan"
        />

        <div className="switches">
          <Switch
            label="Drum motor"
            on={!!c.drumMotor}
            reported={!!r.drumMotor}
            onChange={(v) => driver.setHottop({ drumMotor: v })}
          />
          <Switch
            label="Cooling stirrer"
            on={!!c.coolingMotor}
            reported={!!r.coolingMotor}
            onChange={(v) => driver.setHottop({ coolingMotor: v })}
          />
          <Switch
            label="Eject door"
            on={!!c.solenoid}
            reported={!!r.solenoid}
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

function Reported({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <span className={show ? 'reported' : 'reported reported-same'}>{children}</span>
}

/** A 0–100 % output. The fans step by 10 %: the protocol only carries 0–10 for them, so finer steps couldn't
 *  reach the machine. */
function Slider(props: {
  label: string
  hint?: string
  value: number
  reported: number
  onChange: (v: number) => void
  step?: number
  swatch?: string
  rangeClass?: string
}) {
  const id = useId()
  return (
    <div className="ctl">
      <label htmlFor={id} className="ctl-label">
        {props.swatch && <i className={`sw ${props.swatch}`} />}
        {props.label}
        {props.hint && <span className="hint">{props.hint}</span>}
      </label>
      <output htmlFor={id} className="ctl-value">
        {props.value}%
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
      <div className="ctl-row">
        <Reported show={props.reported !== props.value}>Hottop reports {props.reported}%</Reported>
      </div>
    </div>
  )
}

function Switch(props: {
  label: string
  on: boolean
  reported: boolean
  onChange: (v: boolean) => void
  onText?: string
  offText?: string
}) {
  const onText = props.onText ?? 'On'
  const offText = props.offText ?? 'Off'
  return (
    <div className="switch">
      <button
        className={props.on ? 'toggle toggle-on' : 'toggle'}
        aria-pressed={props.on}
        onClick={() => props.onChange(!props.on)}
      >
        <span className="toggle-label">{props.label}</span>
        <span className="toggle-state">{props.on ? onText : offText}</span>
      </button>
      <Reported show={props.reported !== props.on}>
        Hottop reports {props.reported ? onText.toLowerCase() : offText.toLowerCase()}
      </Reported>
    </div>
  )
}
