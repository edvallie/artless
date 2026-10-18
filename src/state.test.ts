// @vitest-environment happy-dom
// Unit conversion, the roast clock's format, and the two settings kept in the browser.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deltaToUnit, fmtClock, fmtTemp, toUnit, useDebug, useUnit } from './state'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('temperatures', () => {
  it('converts absolute temperatures and differences differently', () => {
    expect(toUnit(100, 'C')).toBe(100)
    expect(toUnit(100, 'F')).toBe(212)
    expect(toUnit(0, 'F')).toBe(32)
    expect(deltaToUnit(10, 'F')).toBe(18) // a 10 °C/min rise is 18 °F/min, not 50
    expect(deltaToUnit(10, 'C')).toBe(10)
  })

  it('shows whole degrees, and a dash when there is no reading', () => {
    expect(fmtTemp(196.6, 'C')).toBe('197')
    expect(fmtTemp(220, 'F')).toBe('428')
    expect(fmtTemp(-1, 'C')).toBe('—')
    expect(fmtTemp(-1, 'F')).toBe('—')
  })
})

describe('roast clock', () => {
  it('formats minutes and padded seconds, dropping fractions', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(9.9)).toBe('0:09')
    expect(fmtClock(605)).toBe('10:05')
  })

  it('shows preheat before the charge as negative time', () => {
    expect(fmtClock(-75)).toBe('−1:15')
  })
})

describe('saved settings', () => {
  it('defaults to °C and remembers a switch to °F', () => {
    const { result, unmount } = renderHook(() => useUnit())
    expect(result.current[0]).toBe('C')
    act(() => result.current[1]('F'))
    expect(result.current[0]).toBe('F')
    unmount()
    expect(renderHook(() => useUnit()).result.current[0]).toBe('F')
  })

  it('defaults debug mode to off and remembers turning it on', () => {
    const { result, unmount } = renderHook(() => useDebug())
    expect(result.current[0]).toBe(false)
    act(() => result.current[1](true))
    expect(localStorage.getItem('artless.debug')).toBe('1')
    unmount()
    expect(renderHook(() => useDebug()).result.current[0]).toBe(true)
  })

  it('falls back to the defaults when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const unit = renderHook(() => useUnit()).result
    const debug = renderHook(() => useDebug()).result
    expect(unit.current[0]).toBe('C')
    expect(debug.current[0]).toBe(false)
    act(() => debug.current[1](true)) // still works for this page, just isn't saved
    expect(debug.current[0]).toBe(true)
  })
})
