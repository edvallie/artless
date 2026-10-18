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
        <StepSlider
          label="Main fan"
          hint="Roasting airflow"
          value={c.mainFan}
          reported={r.mainFan}
          onChange={(v) => driver.setHottop({ mainFan: v })}
          swatch="sw-fan"
        />
        <StepSlider
          label="Cooling fan"
          hint="Under the cooling tray"
          value={c.fan}
          reported={r.fan}
          onChange={(v) => driver.setHottop({ fan: v })}
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
            Heater off, door open, drum and stirrer on, cooling fan at 10. Also marks the end of the roast.
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

function Slider(props: {
  label: string
  value: number
  reported: number
  onChange: (v: number) => void
  swatch?: string
}) {
  const id = useId()
  return (
    <div className="ctl">
      <label htmlFor={id} className="ctl-label">
        {props.swatch && <i className={`sw ${props.swatch}`} />}
        {props.label}
      </label>
      <output htmlFor={id} className="ctl-value">
        {props.value}%
      </output>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <div className="ctl-row">
        <Reported show={props.reported !== props.value}>Hottop reports {props.reported}%</Reported>
        <span className="nudges">
          {[-5, -1, +1, +5].map((d) => (
            <button key={d} className="btn btn-nudge" onClick={() => props.onChange(props.value + d)}>
              {d > 0 ? `+${d}` : `−${-d}`}
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}

/** The Hottop's fans only have 11 positions (the protocol sends 0–10), so the slider snaps to them. */
function StepSlider(props: {
  label: string
  hint: string
  value: number
  reported: number
  onChange: (v: number) => void
  swatch?: string
}) {
  const id = useId()
  const level = Math.round(props.value / 10)
  const reportedLevel = Math.round(props.reported / 10)
  return (
    <div className="ctl">
      <label htmlFor={id} className="ctl-label">
        {props.swatch && <i className={`sw ${props.swatch}`} />}
        {props.label} <span className="hint">{props.hint}</span>
      </label>
      <output htmlFor={id} className="ctl-value">
        {level} <small>of 10</small>
      </output>
      <input
        id={id}
        type="range"
        className="range-fan"
        min={0}
        max={10}
        step={1}
        value={level}
        onChange={(e) => props.onChange(Number(e.target.value) * 10)}
      />
      <div className="ticks" aria-hidden="true">
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className={i === level ? 'tick tick-on' : 'tick'}>
            {i}
          </span>
        ))}
      </div>
      <div className="ctl-row">
        <Reported show={reportedLevel !== level}>Hottop reports {reportedLevel}</Reported>
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
