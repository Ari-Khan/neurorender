import { io } from 'socket.io-client'
import { startServer } from '../server.js'
import { generateNetwork } from '../../frontend/src/net/sampling.js'

function toTyped(Type, x) {
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
const toF32 = (x) => toTyped(Float32Array, x)

const W = 320
const H = 240
const PORT = 3211

function makeMasks() {
  const idData = new Uint8ClampedArray(W * H * 4)
  const bgData = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      bgData[o] = 80
      bgData[o + 1] = 90
      bgData[o + 2] = 110
      bgData[o + 3] = 255
      const dx = (x - 160) / 60
      const dy = (y - 120) / 50
      if (dx * dx + dy * dy <= 1) {
        idData[o] = 50
        idData[o + 3] = 255
      }
      if (x > 220 && x < 300 && Math.abs(y - 120) < 10) {
        idData[o] = 152
        idData[o + 3] = 255
      }
    }
  }
  return { idData, bgData }
}

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    process.exitCode = 1
    throw new Error(label)
  }
  console.log(`ok: ${label}`)
}

const { idData, bgData } = makeMasks()
const net = generateNetwork({
  idData,
  bgData,
  width: W,
  height: H,
  density: 1,
  seed: 7,
})
assert(net.n > 20, `sampled ${net.n} neurons`)
assert(net.m > 50, `built ${net.m} synapses`)

const { http } = await startServer(PORT)
const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'] })

await new Promise((resolve, reject) => {
  socket.on('connect', resolve)
  socket.on('connect_error', reject)
})

const ack = await new Promise((resolve) => {
  socket.timeout(3000).emit(
    'net:build',
    {
      n: net.n,
      types: net.typeIdx.buffer,
      inh: net.inh.buffer,
      iBase: net.iBase.buffer,
      pre: net.pre.buffer,
      post: net.post.buffer,
      w: net.w.buffer,
      delayMs: net.delayMs.buffer,
      stdp: true,
    },
    (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res),
  )
})
assert(ack?.ok, `net:build ack ${JSON.stringify(ack)}`)

let frames = 0
let totalSpikes = 0
let lastV = null
const frameDone = new Promise((resolve) => {
  socket.on('sim:frame', (msg) => {
    frames++
    const v = toF32(msg.v)
    const spikes = toTyped(Int32Array, msg.spikes)
    totalSpikes += spikes.length / 2
    lastV = v
    if (frames >= 8) resolve()
  })
})

socket.emit('sim:start')
await frameDone
assert(frames >= 8, `received ${frames} frames`)
assert(lastV && lastV.length === net.n, 'voltage vector length matches n')
let finite = true
for (let i = 0; i < lastV.length; i++) if (!Number.isFinite(lastV[i])) finite = false
assert(finite, 'all voltages finite')
console.log(`frames=${frames} spikes=${totalSpikes}`)

socket.emit('sim:poke', { ids: Uint32Array.from([0, 1, 2]), amp: 60 })
await new Promise((r) => setTimeout(r, 400))

socket.emit('sim:pause')
const state = await new Promise((resolve) => {
  socket.once('sim:state', resolve)
  setTimeout(() => resolve({ running: 'timeout' }), 1000)
})
assert(state.running === false, 'sim paused')

socket.emit('sim:reset')
socket.close()
http.close()
console.log('\nE2E PASS')
process.exit(0)
