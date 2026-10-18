import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BT_CUTOFF } from '../hottop/protocol'
import type { RoastMeta, Sample } from '../roastLog'
import { fmtClock, toUnit, type Unit } from '../state'

const M = { top: 14, right: 58, bottom: 26, left: 46 }
const TEMP_H = 300
const GAP = 34
const OUT_H = 96

function niceStep(range: number, target: number): number {
  const raw = range / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow
}

function nearest(samples: Sample[], t: number): Sample | null {
  if (!samples.length) return null
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t < t) lo = mid
    else hi = mid
  }
  return Math.abs(samples[lo].t - t) <= Math.abs(samples[hi].t - t) ? samples[lo] : samples[hi]
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function RoastChart({ samples, roast, unit }: { samples: Sample[]; roast: RoastMeta; unit: Unit }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [hoverT, setHoverT] = useState<number | null>(null)
  const plotW = width - M.left - M.right
  const height = M.top + TEMP_H + GAP + OUT_H + M.bottom
  const outTop = M.top + TEMP_H + GAP

  const last = samples[samples.length - 1]
  const first = samples[0]
  const tMax = Math.max(300, last ? Math.ceil((last.t + 30) / 60) * 60 : 0)
  // Preheat recorded before the beans went in sits at negative time, so the axis can start below 0.
  const tMin = Math.min(0, first ? Math.floor((first.t - 15) / 60) * 60 : 0)
  const tSpan = tMax - tMin

  // Beans in is 0:00 by construction; beans out is wherever it was marked.
  const marks = useMemo(() => {
    const out: { t: number; label: string }[] = []
    if (roast.chargeAt !== null) out.push({ t: 0, label: 'Beans in' })
    if (roast.chargeAt !== null && roast.dropAt !== null) {
      out.push({ t: (roast.dropAt - roast.chargeAt) / 1000, label: 'Beans out' })
    }
    return out
  }, [roast])

  const yMaxC = useMemo(() => {
    let m = BT_CUTOFF + 20
    for (const s of samples) m = Math.max(m, s.bt + 10, s.et + 10)
    return m
  }, [samples])
  const yLo = toUnit(0, unit)
  const yHi = toUnit(yMaxC, unit)

  const x = (t: number) => M.left + ((t - tMin) / tSpan) * plotW
  const yT = (c: number) => M.top + TEMP_H - ((toUnit(c, unit) - yLo) / (yHi - yLo)) * TEMP_H
  const yO = (pct: number) => outTop + OUT_H - (pct / 100) * OUT_H

  // keep paths light: at most ~2 points per pixel
  const drawn = useMemo(() => {
    const stride = Math.max(1, Math.ceil(samples.length / (plotW * 2)))
    const out = samples.filter((_, i) => i % stride === 0)
    if (samples.length && out[out.length - 1] !== samples[samples.length - 1]) out.push(samples[samples.length - 1])
    return out
  }, [samples, plotW])

  const path = (pick: (s: Sample) => number, y: (v: number) => number) =>
    drawn.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(pick(s)).toFixed(1)}`).join('')

  const yStep = niceStep(yHi - yLo, 5)
  const yTicks: number[] = []
  for (let v = Math.ceil(yLo / yStep) * yStep; v <= yHi; v += yStep) yTicks.push(v)
  const xStepMin = niceStep(tSpan / 60, Math.max(3, Math.floor(plotW / 90)))
  const xTicks: number[] = []
  for (let m = Math.ceil(tMin / 60 / xStepMin) * xStepMin; m * 60 <= tMax; m += xStepMin) xTicks.push(m * 60)

  const hover = hoverT === null ? null : nearest(samples, hoverT)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = tMin + ((e.clientX - r.left) / r.width) * tSpan
    setHoverT(Math.max(tMin, Math.min(t, tMax)))
  }

  const labelY = (y: number, other: number) => (Math.abs(y - other) < 14 ? (y < other ? y - 7 : y + 7) : y)

  return (
    <div className="chart" ref={wrapRef}>
      <div className="legend" aria-hidden="true">
        <span>
          <i className="sw sw-bt" />
          Bean temp (BT)
        </span>
        <span>
          <i className="sw sw-et" />
          Environment temp (ET)
        </span>
        <span>
          <i className="sw sw-heater" />
          Heater
        </span>
        <span>
          <i className="sw sw-fan" />
          Main fan
        </span>
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={
          last
            ? `Roast curve at ${fmtClock(last.t)}. Latest bean temp ${toUnit(last.bt, unit).toFixed(0)}°, environment ${toUnit(last.et, unit).toFixed(0)}°.`
            : 'Roast curve, no data yet'
        }
      >
        {/* temperature panel */}
        {yTicks.map((v) => {
          const y = M.top + TEMP_H - ((v - yLo) / (yHi - yLo)) * TEMP_H
          return (
            <g key={v}>
              <line className="grid" x1={M.left} x2={M.left + plotW} y1={y} y2={y} />
              <text className="tick" x={M.left - 8} y={y} textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            </g>
          )
        })}
        <text className="tick" x={M.left - 8} y={M.top - 4} textAnchor="end">
          °{unit}
        </text>
        <line className="ref" x1={M.left} x2={M.left + plotW} y1={yT(BT_CUTOFF)} y2={yT(BT_CUTOFF)} />
        <text className="ref-label" x={M.left + plotW} y={yT(BT_CUTOFF) - 6} textAnchor="end">
          Safety cutoff {toUnit(BT_CUTOFF, unit).toFixed(0)}°
        </text>
        {samples.length > 1 && (
          <>
            <path className="line line-et" d={path((s) => s.et, yT)} />
            <path className="line line-bt" d={path((s) => s.bt, yT)} />
          </>
        )}
        {last && (
          <>
            <text className="direct" x={x(last.t) + 8} y={labelY(yT(last.bt), yT(last.et))} dominantBaseline="middle">
              BT
            </text>
            <text className="direct" x={x(last.t) + 8} y={labelY(yT(last.et), yT(last.bt))} dominantBaseline="middle">
              ET
            </text>
          </>
        )}

        {/* outputs panel */}
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line className="grid" x1={M.left} x2={M.left + plotW} y1={yO(v)} y2={yO(v)} />
            <text className="tick" x={M.left - 8} y={yO(v)} textAnchor="end" dominantBaseline="middle">
              {v}%
            </text>
          </g>
        ))}
        {samples.length > 1 && (
          <>
            <path className="line line-fan" d={path((s) => s.mainFan, yO)} />
            <path className="line line-heater" d={path((s) => s.heater, yO)} />
          </>
        )}

        {/* roast markers */}
        {marks.map((m) => (
          <g key={m.label}>
            <line className="event-line" x1={x(m.t)} x2={x(m.t)} y1={M.top} y2={outTop + OUT_H} />
            <text className="event-label" x={x(m.t) + 4} y={M.top + 10}>
              {m.label}
            </text>
          </g>
        ))}

        {/* x axis */}
        {xTicks.map((t) => (
          <text key={t} className="tick" x={x(t)} y={height - 6} textAnchor="middle">
            {fmtClock(t)}
          </text>
        ))}

        {/* crosshair */}
        {hover && (
          <g className="crosshair">
            <line x1={x(hover.t)} x2={x(hover.t)} y1={M.top} y2={outTop + OUT_H} />
            <circle className="dot dot-bt" cx={x(hover.t)} cy={yT(hover.bt)} r={4.5} />
            <circle className="dot dot-et" cx={x(hover.t)} cy={yT(hover.et)} r={4.5} />
            <circle className="dot dot-heater" cx={x(hover.t)} cy={yO(hover.heater)} r={4} />
            <circle className="dot dot-fan" cx={x(hover.t)} cy={yO(hover.mainFan)} r={4} />
          </g>
        )}
        <rect
          className="hit"
          x={M.left}
          y={M.top}
          width={plotW}
          height={outTop + OUT_H - M.top}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHoverT(null)}
        />
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(x(hover.t) + 14, width - 190),
            top: M.top + 30,
          }}
        >
          <div className="tt-time">{fmtClock(hover.t)}</div>
          <div>
            <i className="sw sw-bt" />
            BT <b>{toUnit(hover.bt, unit).toFixed(0)}°</b>
          </div>
          <div>
            <i className="sw sw-et" />
            ET <b>{toUnit(hover.et, unit).toFixed(0)}°</b>
          </div>
          <div>
            <i className="sw sw-heater" />
            Heater <b>{hover.heater}%</b>
          </div>
          <div>
            <i className="sw sw-fan" />
            Main fan <b>{hover.mainFan / 10} of 10</b>
          </div>
        </div>
      )}

      {!samples.length && <p className="chart-empty">Connect a Hottop to start recording.</p>}
    </div>
  )
}
