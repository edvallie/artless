import type { Transport, TransportHandlers } from './transport'

export const webSerialSupported = (): boolean => typeof navigator !== 'undefined' && 'serial' in navigator

/** Hottop serial link: 115200 baud, 8N1. */
export class WebSerialTransport implements Transport {
  readonly label: string
  private port: SerialPort
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private loop: Promise<void> | null = null
  private closing = false

  private constructor(port: SerialPort) {
    this.port = port
    const info = port.getInfo()
    this.label =
      info.usbVendorId !== undefined
        ? `USB serial ${hex4(info.usbVendorId)}:${hex4(info.usbProductId ?? 0)}`
        : 'Serial port'
  }

  /** Must be called from a user gesture (button click). */
  static async request(): Promise<WebSerialTransport> {
    const port = await navigator.serial.requestPort()
    return new WebSerialTransport(port)
  }

  async open(handlers: TransportHandlers): Promise<void> {
    await this.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096 })
    // Assert both control lines on open, as pySerial does. Some USB adapters keep the
    // link idle until DTR is raised, and not every adapter exposes the lines at all.
    try {
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: true })
    } catch {
      /* adapter without control lines: the data path still works */
    }
    if (!this.port.writable || !this.port.readable) throw new Error('Port opened without streams')
    this.writer = this.port.writable.getWriter()
    this.loop = this.readLoop(handlers)
  }

  private async readLoop(handlers: TransportHandlers): Promise<void> {
    let error: Error | undefined
    while (this.port.readable && !this.closing) {
      this.reader = this.port.readable.getReader()
      try {
        for (;;) {
          const { value, done } = await this.reader.read()
          if (done) break
          if (value) handlers.onData(value)
        }
      } catch (e) {
        // Framing/parity/buffer errors are recoverable: a fresh reader resumes the stream.
        // A lost device is not, and leaves port.readable null, which ends the loop.
        error = e instanceof Error ? e : new Error(String(e))
      } finally {
        this.reader.releaseLock()
        this.reader = null
      }
    }
    if (!this.closing) {
      await this.closePort()
      handlers.onClose(error ?? new Error('Serial port closed'))
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Not connected')
    await this.writer.write(bytes)
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    try {
      await this.reader?.cancel()
    } catch {
      /* already gone */
    }
    await this.loop
    await this.closePort()
  }

  private async closePort(): Promise<void> {
    try {
      this.writer?.releaseLock()
    } catch {
      /* already released */
    }
    this.writer = null
    try {
      await this.port.close()
    } catch {
      /* already closed or device unplugged */
    }
  }
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0')
