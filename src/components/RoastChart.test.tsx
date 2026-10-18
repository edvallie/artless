// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoastMeta, Sample } from '../roastLog'
import { RoastChart } from './RoastChart'

const T0 = Date.UTC(2026, 9, 12, 9, 0, 0)

const IDLE: RoastMeta = {
  phase: 'idle',
  chargeAt: null,
  dropAt: null,
  firstAt: null,
  lastAt: null,
  roastSeconds: null,
  frames: 0,
  commands: 0,
  events: 0,
  samples: 0,
}

/** One sample a second from `from` to `to` seconds, BT climbing 0.5 °C/s from 100. */
function samples(from: number, to: number): Sample[] {
  const out: Sample[] = []
  for (let t = from; t <= to; t++) {
    out.push({ at: T0 + t * 1000, t, bt: 100 + (t - from) / 2, et: 200, heater: 60, mainFan: 30, fan: 0 })
  }
  return out
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ticks = () => Array.from(document.querySelectorAll('text.tick'), (e) => e.textContent)

describe('roast chart', () => {
  it('asks for a connection while there is no data', () => {
    render(<RoastChart samples={[]} roast={IDLE} unit="C" />)
    expect(screen.getByText('Connect a Hottop to start recording.')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Roast curve, no data yet')
    expect(document.querySelectorAll('path.line')).toHaveLength(0)
  })

  it('draws all four series and describes the latest reading', () => {
    render(<RoastChart samples={samples(0, 60)} roast={IDLE} unit="C" />)
    expect(screen.queryByText(/start recording/)).toBeNull()
    for (const s of ['bt', 'et', 'heater', 'fan']) expect(document.querySelector(`path.line-${s}`)).not.toBeNull()
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Roast curve at 1:00. Latest bean temp 130°, environment 200°.',
    )
  })

  it('marks the safety cutoff and labels the axis in the chosen unit', () => {
    const { rerender } = render(<RoastChart samples={samples(0, 10)} roast={IDLE} unit="C" />)
    expect(screen.getByText('Safety cutoff 220°')).toBeTruthy()
    expect(ticks()).toContain('°C')

    rerender(<RoastChart samples={samples(0, 10)} roast={IDLE} unit="F" />)
    expect(screen.getByText('Safety cutoff 428°')).toBeTruthy()
    expect(ticks()).toContain('°F')
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('bean temp 221°')
  })

  it('shows at least five minutes, and extends the time axis back into preheat', () => {
    const times = () => ticks().filter((t) => t?.includes(':'))
    render(<RoastChart samples={samples(0, 10)} roast={IDLE} unit="C" />)
    expect(times()).toEqual(['−1:00', '0:00', '1:00', '2:00', '3:00', '4:00', '5:00'])
    cleanup()

    const roasting = { ...IDLE, phase: 'roasting' as const, chargeAt: T0 }
    render(<RoastChart samples={samples(-150, 30)} roast={roasting} unit="C" />)
    expect(times()[0]).toBe('−2:00')
  })

  it('marks beans in and beans out', () => {
    const roasting = { ...IDLE, phase: 'roasting' as const, chargeAt: T0 }
    const { rerender } = render(<RoastChart samples={samples(-30, 300)} roast={roasting} unit="C" />)
    expect(screen.getByText('Beans in')).toBeTruthy()
    expect(screen.queryByText('Beans out')).toBeNull()

    const finished = { ...roasting, phase: 'finished' as const, dropAt: T0 + 290_000 }
    rerender(<RoastChart samples={samples(-30, 300)} roast={finished} unit="C" />)
    expect(screen.getByText('Beans out')).toBeTruthy()
  })

  it('thins long recordings to about two points per pixel but keeps the newest', () => {
    render(<RoastChart samples={samples(0, 3 * 3600)} roast={IDLE} unit="C" />)
    const d = document.querySelector('path.line-bt')!.getAttribute('d')!
    const points = d.split(/[ML]/).filter(Boolean)
    expect(points.length).toBeLessThan(3 * 3600)
    expect(points.length).toBeGreaterThan(500)
  })

  it('reads out the nearest sample under the pointer, and hides it on leave', () => {
    render(<RoastChart samples={samples(0, 240)} roast={IDLE} unit="C" />)
    const hit = document.querySelector('rect.hit')!
    // the axis runs −1:00 to 5:00; at 360 px wide, one pixel is one second
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 360 } as DOMRect)

    fireEvent.pointerMove(hit, { clientX: 180 }) // 2:00
    const tip = document.querySelector('.tooltip')!
    expect(tip.querySelector('.tt-time')?.textContent).toBe('2:00')
    expect(tip.textContent).toContain('BT 160°')
    expect(tip.textContent).toContain('Heater 60%')
    expect(tip.textContent).toContain('Main fan 30%')
    expect(document.querySelector('.crosshair')).not.toBeNull()

    fireEvent.pointerMove(hit, { clientX: 350 }) // 4:50, past the last sample: the nearest is 4:00
    expect(document.querySelector('.tt-time')?.textContent).toBe('4:00')

    fireEvent.pointerLeave(hit)
    expect(document.querySelector('.tooltip')).toBeNull()
  })
})
