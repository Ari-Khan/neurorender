import { io } from 'socket.io-client'

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

export const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
})

export function connectSocket() {
  if (!socket.connected) socket.connect()
  return socket
}

export function toTyped(Type, x) {
  if (x instanceof Type) return x
  if (x instanceof ArrayBuffer) return new Type(x)
  if (ArrayBuffer.isView(x)) {
    const bytesPer = Type.BYTES_PER_ELEMENT
    if (x.byteOffset % bytesPer === 0) {
      return new Type(x.buffer, x.byteOffset, x.byteLength / bytesPer)
    }
    const bytes = new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
    return new Type(bytes.slice().buffer)
  }
  return Type.from(x ?? [])
}

export const toF32 = (x) => toTyped(Float32Array, x)
export const toU32 = (x) => toTyped(Uint32Array, x)
