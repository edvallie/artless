export interface TransportHandlers {
  onData: (chunk: Uint8Array) => void
  onClose: (error?: Error) => void
}

/** A byte pipe to a Hottop: real serial port or the simulator. */
export interface Transport {
  readonly label: string
  open(handlers: TransportHandlers): Promise<void>
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}
