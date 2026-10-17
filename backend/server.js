import express from 'express'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { NeuronNetwork, DT } from './Neuron.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 3001
const TICK_MS = 33
const MAX_CATCHUP_MS = 250

function viewBytes(x) {
  return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
}

function toF32(x) {
  if (x instanceof Float32Array) return x
  if (x instanceof ArrayBuffer) return new Float32Array(x)
  if (ArrayBuffer.isView(x)) {
    const bytes = viewBytes(x)
    if (x.byteOffset % 4 === 0) {
      return new Float32Array(bytes.buffer, x.byteOffset, x.byteLength / 4)
    }
    return new Float32Array(bytes.slice().buffer)
  }
  return Float32Array.from(x ?? [])
}

function toU32(x) {
  if (x instanceof Uint32Array) return x
  if (x instanceof ArrayBuffer) return new Uint32Array(x)
  if (ArrayBuffer.isView(x)) {
    if (x.byteOffset % 4 === 0) {
      return new Uint32Array(x.buffer, x.byteOffset, x.byteLength / 4)
    }
    return new Uint32Array(viewBytes(x).slice().buffer)
  }
  return Uint32Array.from(x ?? [])
}

function toU8(x) {
  if (x instanceof Uint8Array) return x
  if (x instanceof ArrayBuffer) return new Uint8Array(x)
  if (ArrayBuffer.isView(x)) {
    return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
  }
  return Uint8Array.from(x ?? [])
}

export function startServer(port = DEFAULT_PORT) {
  const app = express()
  app.get('/health', (req, res) => res.json({ ok: true }))

  const distDir = path.resolve(__dirname, '../frontend/dist')
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
    app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')))
  } else {
    app.use((req, res) => res.status(200).send('neurorender backend'))
  }

  const http = createServer(app)
  const io = new Server(http, { cors: { origin: true } })

  io.on('connection', (socket) => {
    let net = null
    let running = false
    let speed = 1
    let timer = null
    let lastWall = 0

    const emitState = () => socket.emit('sim:state', { running })

    const stop = () => {
      running = false
      if (timer) clearInterval(timer)
      timer = null
      emitState()
    }

    const tick = () => {
      if (!net) return
      const now = Date.now()
      let simMs = (now - lastWall) * speed
      lastWall = now
      if (simMs > MAX_CATCHUP_MS) simMs = MAX_CATCHUP_MS
      const steps = Math.round(simMs / DT)
      if (steps < 1) return
      const t0 = net.simTimeMs()
      const spikes = net.runSteps(steps)
      socket.emit('sim:frame', {
        t0,
        steps,
        dt: DT,
        v: net.voltages.buffer,
        spikes: spikes.buffer,
      })
    }

    const start = () => {
      if (!net || running) return
      running = true
      lastWall = Date.now()
      timer = setInterval(tick, TICK_MS)
      emitState()
    }

    socket.on('net:build', (msg, ack) => {
      try {
        const types = toU8(msg.types)
        const inh = toU8(msg.inh)
        const iBase = toF32(msg.iBase)
        const pre = toU32(msg.pre)
        const post = toU32(msg.post)
        const w = toF32(msg.w)
        const delayMs = toF32(msg.delayMs)
        const n = types.length
        if (n < 1 || n > 5000) throw new Error(`invalid neuron count ${n}`)
        if (inh.length !== n || iBase.length !== n) {
          throw new Error('per-neuron arrays must all have length n')
        }
        const m = pre.length
        if (m > 100000) throw new Error(`too many synapses ${m}`)
        stop()
        net = new NeuronNetwork({
          types,
          inh,
          iBase,
          pre,
          post,
          w,
          delayMs,
          stdp: !!msg.stdp,
        })
        console.log(`[net] built n=${n} m=${m} stdp=${!!msg.stdp}`)
        ack?.({ ok: true, n, m })
      } catch (err) {
        console.error('[net] build failed:', err.message)
        ack?.({ ok: false, error: err.message })
      }
    })

    socket.on('net:ibase', (buf, ack) => {
      if (!net) return ack?.({ ok: false, error: 'no network' })
      const ib = toF32(buf)
      if (ib.length !== net.n) return ack?.({ ok: false, error: 'length mismatch' })
      net.iBase.set(ib)
      ack?.({ ok: true })
    })

    socket.on('sim:start', () => start())
    socket.on('sim:pause', () => stop())
    socket.on('sim:reset', () => {
      net?.reset()
      emitState()
    })
    socket.on('sim:poke', ({ ids, amp } = {}) => {
      if (!net || !ids) return
      net.poke(toU32(ids), amp ?? 40)
    })
    socket.on('sim:stdp', (v) => {
      if (net) net.stdp = !!v
    })
    socket.on('sim:speed', (x) => {
      speed = Math.min(4, Math.max(0.1, Number(x) || 1))
    })
    socket.on('disconnect', () => {
      stop()
      net = null
    })
  })

  return new Promise((resolve) => {
    http.listen(port, () => {
      console.log(`[server] listening on http://localhost:${port}`)
      resolve({ http, io, port })
    })
  })
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  startServer(process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT)
}
