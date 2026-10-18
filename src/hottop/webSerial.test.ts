// The serial transport against a fake Web Serial port: what it opens, how it reads, and how it
// tells a lost cable apart from a recoverable read error and from closing on purpose.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSerialTransport, webSerialSupported } from './webSerial'

/** A SerialPort whose reads are fed by the test: push() bytes, fail() a read, lose() the device. */
class FakePort {
  info: SerialPortInfo = { usbVendorId: 0x1a86, usbProductId: 0x7523 }
  opened: SerialOptions | null = null
  signals: SerialOutputSignals | null = null
  signalsError: Error | null = null
  noStreams = false
  closed = 0
  written: Uint8Array[] = []
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  private ctrl: ReadableStreamDefaultController<Uint8Array> | null = null

  getInfo() {
    return this.info
  }

  async open(opts: SerialOptions) {
    this.opened = opts
    if (this.noStreams) return
    this.writable = new WritableStream({ write: (b) => void this.written.push(b) })
    this.newReadable()
  }

  async setSignals(s: SerialOutputSignals) {
    if (this.signalsError) throw this.signalsError
    this.signals = s
  }

  async close() {
    this.closed += 1
    this.readable = null
    this.writable = null
  }

  push(bytes: number[]) {
    this.ctrl!.enqueue(Uint8Array.from(bytes))
  }

  /** A framing/parity error: this stream errors, a fresh one takes its place. */
  fail(message: string) {
    const old = this.ctrl!
    this.newReadable()
    old.error(new Error(message))
  }

  /** The cable is pulled: the stream errors and the port has no readable any more. */
  lose(e: unknown) {
    const old = this.ctrl!
    this.readable = null
    old.error(e)
  }

  /** The stream ends without an error and the port has no readable any more. */
  end() {
    this.readable = null
    this.ctrl!.close()
  }

  private newReadable() {
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.ctrl = c) })
  }
}

function setup(port = new FakePort()) {
  vi.stubGlobal('navigator', { serial: { requestPort: async () => port } })
  return port
}

const flush = () => new Promise((r) => setTimeout(r, 0))

async function opened(port = new FakePort()) {
  setup(port)
  const t = await WebSerialTransport.request()
  const data: number[][] = []
  const onClose = vi.fn()
  await t.open({ onData: (c) => data.push(Array.from(c)), onClose })
  return { t, port, data, onClose }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('web serial transport', () => {
  it('is only offered when the browser has Web Serial', () => {
    vi.stubGlobal('navigator', {})
    expect(webSerialSupported()).toBe(false)
    vi.stubGlobal('navigator', { serial: {} })
    expect(webSerialSupported()).toBe(true)
  })

  it('names the port by its USB ids, or generically without them', async () => {
    setup()
    expect((await WebSerialTransport.request()).label).toBe('USB serial 1a86:7523')
    const bare = new FakePort()
    bare.info = {}
    setup(bare)
    expect((await WebSerialTransport.request()).label).toBe('Serial port')
    const noProduct = new FakePort()
    noProduct.info = { usbVendorId: 0x0403 }
    setup(noProduct)
    expect((await WebSerialTransport.request()).label).toBe('USB serial 0403:0000')
  })

  it('opens at 115200 8N1 and raises DTR and RTS', async () => {
    const { port } = await opened()
    expect(port.opened).toMatchObject({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' })
    expect(port.signals).toEqual({ dataTerminalReady: true, requestToSend: true })
  })

  it('still opens on an adapter without control lines', async () => {
    const port = new FakePort()
    port.signalsError = new Error('not supported')
    const { data } = await opened(port)
    port.push([1, 2])
    await flush()
    expect(data).toEqual([[1, 2]])
  })

  it('fails to open if the port comes up without streams', async () => {
    const port = new FakePort()
    port.noStreams = true
    setup(port)
    const t = await WebSerialTransport.request()
    await expect(t.open({ onData: () => {}, onClose: () => {} })).rejects.toThrow('Port opened without streams')
  })

  it('passes bytes through as they arrive and writes commands out', async () => {
    const { t, port, data } = await opened()
    port.push([0xa5, 0x96])
    port.push([0x01])
    await flush()
    expect(data).toEqual([[0xa5, 0x96], [0x01]])
    await t.write(Uint8Array.from([9, 9]))
    expect(port.written.map((b) => Array.from(b))).toEqual([[9, 9]])
  })

  it('refuses to write before it is open', async () => {
    setup()
    const t = await WebSerialTransport.request()
    await expect(t.write(new Uint8Array(1))).rejects.toThrow('Not connected')
  })

  it('carries on reading after a recoverable read error', async () => {
    const { port, data, onClose } = await opened()
    port.fail('Framing error')
    await flush()
    port.push([7])
    await flush()
    expect(data).toEqual([[7]])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a lost device once, with its error, and releases the port', async () => {
    const { port, onClose } = await opened()
    port.lose(new DOMException('The device has been lost.', 'NetworkError'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onClose.mock.calls[0][0].message).toBe('The device has been lost.')
    expect(port.closed).toBe(1)
  })

  it('wraps a non-Error failure', async () => {
    const { port, onClose } = await opened()
    port.lose('gone')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onClose.mock.calls[0][0].message).toBe('gone')
  })

  it('says the port closed when the stream just ends', async () => {
    const { port, onClose } = await opened()
    port.end()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onClose.mock.calls[0][0].message).toBe('Serial port closed')
  })

  it('does not report a close it was asked for, and only closes once', async () => {
    const { t, port, onClose } = await opened()
    await t.close()
    await t.close()
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(port.closed).toBe(1)
    await expect(t.write(new Uint8Array(1))).rejects.toThrow('Not connected')
  })

  it('closes cleanly even if the port is already gone', async () => {
    const { t, port } = await opened()
    port.close = () => Promise.reject(new Error('already closed'))
    await expect(t.close()).resolves.toBeUndefined()
  })
})
