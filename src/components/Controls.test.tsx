// @vitest-environment happy-dom
// The control panel drives the real driver singleton through a fake transport, so each test
// checks what would actually go out to the roaster.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FRAME_LENGTH, checksum } from '../hottop/protocol'
import type { Transport, TransportHandlers } from '../hottop/transport'
import { roastLog } from '../roastLog'
import { driver, useDriver } from '../state'
import { ControlPanel } from './Controls'

class FakeTransport implements Transport {
  label = 'fake'
  handlers!: TransportHandlers
  written: Uint8Array[] = []
  async open(h: TransportHandlers) {
    this.handlers = h
  }
  async write(b: Uint8Array) {
    this.written.push(b)
  }
  async close() {}
}

function statusFrame({ heater = 40, mainFan = 6, fan = 0, drum = 1, bt = 150 } = {}) {
  const f = new Uint8Array(FRAME_LENGTH)
  f[0] = 0xa5
  f[1] = 0x96
  f[10] = heater
  f[11] = fan
  f[12] = mainFan
  f[17] = drum
  f[25] = bt >> 8
  f[26] = bt & 0xff
  f[35] = checksum(f)
  return f
}

function Panel() {
  return <ControlPanel snap={useDriver()} />
}

let t: FakeTransport

async function connectWithReading() {
  t = new FakeTransport()
  await act(() => driver.connect(t))
  act(() => t.handlers.onData(statusFrame()))
}

const setpoints = () => driver.getSnapshot().setpoints
const lastSent = () => t.written[t.written.length - 1]

beforeEach(() => {
  roastLog.newRoast()
})

afterEach(async () => {
  cleanup()
  await driver.disconnect()
  driver.clearSetpoints()
  roastLog.newRoast()
})

describe('control panel', () => {
  it('is locked until the roaster has sent a reading', async () => {
    render(<Panel />)
    expect(screen.getByText('Connect to the roaster first.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Drop beans out/ }).closest('fieldset')?.disabled).toBe(true)

    t = new FakeTransport()
    await act(() => driver.connect(t))
    expect(screen.getByRole('button', { name: /Drop beans out/ }).closest('fieldset')?.disabled).toBe(true)

    act(() => t.handlers.onData(statusFrame()))
    expect(screen.getByRole('button', { name: /Drop beans out/ }).closest('fieldset')?.disabled).toBe(false)
    expect(screen.queryByText('Connect to the roaster first.')).toBeNull()
  })

  it('drops the beans in from beside the controls, then gets out of the way', async () => {
    render(<Panel />)
    await connectWithReading()
    fireEvent.click(screen.getByRole('button', { name: 'Drop beans in' }))
    expect(roastLog.getMeta().phase).toBe('roasting')
    expect(screen.queryByRole('button', { name: 'Drop beans in' })).toBeNull()
    expect(screen.getByRole('button', { name: /Drop beans out/ })).toBeTruthy()
  })

  it('starts by showing what the machine reports', async () => {
    render(<Panel />)
    await connectWithReading()
    expect(screen.getByLabelText('Heater')).toMatchObject({ value: '40' })
    expect(screen.getByLabelText(/Main fan/)).toMatchObject({ value: '6' })
    expect(screen.getByRole('button', { name: /Drum motor/ }).getAttribute('aria-pressed')).toBe('true')
    // nothing overridden yet, so no "Hottop reports" differences are shown
    expect(document.querySelectorAll('.reported:not(.reported-same)')).toHaveLength(0)
  })

  it('nudges the heater and shows the machine still reporting the old value', async () => {
    render(<Panel />)
    await connectWithReading()
    fireEvent.click(screen.getByRole('button', { name: '+5' }))
    fireEvent.click(screen.getByRole('button', { name: '−1' }))
    expect(setpoints().heater).toBe(44)
    expect(screen.getByText('Hottop reports 40%').className).toBe('reported')

    act(() => t.handlers.onData(statusFrame()))
    expect(lastSent()[10]).toBe(44)
  })

  it('moves the heater with the slider', async () => {
    render(<Panel />)
    await connectWithReading()
    fireEvent.change(screen.getByLabelText('Heater'), { target: { value: '85' } })
    expect(setpoints().heater).toBe(85)
    expect(screen.getByText('85%')).toBeTruthy()
  })

  it('snaps the fans to the machine’s 11 steps', async () => {
    render(<Panel />)
    await connectWithReading()
    fireEvent.change(screen.getByLabelText(/Main fan/), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText(/Cooling fan/), { target: { value: '3' } })
    expect(setpoints()).toMatchObject({ mainFan: 90, fan: 30 })
    expect(screen.getByText('Hottop reports 6')).toBeTruthy()

    act(() => t.handlers.onData(statusFrame()))
    expect([lastSent()[11], lastSent()[12]]).toEqual([3, 9])
  })

  it('switches the motors and the door', async () => {
    render(<Panel />)
    await connectWithReading()
    const door = screen.getByRole('button', { name: /Eject door/ })
    expect(door.textContent).toContain('Closed')
    fireEvent.click(door)
    expect(door.textContent).toContain('Open')
    expect(screen.getByText('Hottop reports closed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Drum motor/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cooling stirrer/ }))
    expect(setpoints()).toMatchObject({ solenoid: 1, drumMotor: 0, coolingMotor: 1 })
  })

  it('drops the beans: heater off, door open, cooling on, and ends the roast', async () => {
    render(<Panel />)
    await connectWithReading()
    act(() => roastLog.charge())
    fireEvent.click(screen.getByRole('button', { name: /Drop beans out/ }))
    expect(setpoints()).toEqual({ heater: 0, fan: 100, mainFan: -1, solenoid: 1, drumMotor: 1, coolingMotor: 1 })
    expect(roastLog.getMeta().phase).toBe('finished')

    act(() => t.handlers.onData(statusFrame()))
    const f = lastSent()
    expect([f[10], f[11], f[12], f[16], f[17], f[18]]).toEqual([0, 10, 6, 1, 1, 1])
  })

  it('goes back to following the machine', async () => {
    render(<Panel />)
    await connectWithReading()
    fireEvent.click(screen.getByRole('button', { name: '+5' }))
    fireEvent.click(screen.getByRole('button', { name: /Follow the machine/ }))
    expect(setpoints().heater).toBe(-1)
    expect(screen.getByLabelText('Heater')).toMatchObject({ value: '40' })
  })
})
