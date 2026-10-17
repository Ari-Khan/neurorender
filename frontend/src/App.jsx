import { useCallback, useEffect, useRef, useState } from 'react'
import NeurorenderCanvas from './NeurorenderCanvas.jsx'
import { REGIONS } from './regions.js'
import { generateNetwork, buildPayload } from './net/sampling.js'
import { connectSocket, socket, toF32, toTyped } from './net/socket.js'
import { makeSyntheticOrganism } from './syntheticOrganism.js'
import './App.css'

const TOOLS = [
  { key: 'draw', label: 'Draw' },
  { key: 'erase', label: 'Erase' },
  { key: 'stim', label: 'Stim' },
]

const STATS_MS = 400

function App() {
  const [bg, setBg] = useState(() => makeSyntheticOrganism())
  const [tool, setTool] = useState('draw')
  const [region, setRegion] = useState(0)
  const [brush, setBrush] = useState(26)
  const [density, setDensity] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [stdp, setStdp] = useState(true)
  const [network, setNetwork] = useState(null)
  const [running, setRunning] = useState(false)
  const [conn, setConn] = useState('connecting')
  const [message, setMessage] = useState('Draw anatomical regions, then generate a network')
  const [stats, setStats] = useState({ simTime: 0, rate: 0 })

  const canvasApiRef = useRef(null)
  const simRef = useRef({ v: null, spikeT: null, simTime: 0 })
  const fileRef = useRef(null)
  const rateRef = useRef({ count: 0, lastSimTime: 0, lastStatsAt: 0 })

  useEffect(() => {
    const onConnect = () => setConn('online')
    const onDisconnect = () => setConn('offline')
    const onState = (s) => setRunning(!!s.running)
    const onFrame = (msg) => {
      const sim = simRef.current
      sim.v = toF32(msg.v)
      const spikes = toTyped(Int32Array, msg.spikes)
      const base = msg.t0
      const dt = msg.dt
      if (!sim.spikeT) sim.spikeT = new Float64Array(sim.v.length).fill(-1e9)
      for (let k = 0; k < spikes.length; k += 2) {
        const id = spikes[k]
        const t = base + spikes[k + 1] * dt
        if (id >= 0 && id < sim.spikeT.length && t > sim.spikeT[id]) sim.spikeT[id] = t
      }
      sim.simTime = base + msg.steps * dt
      const rate = rateRef.current
      rate.count += spikes.length / 2
      const now = performance.now()
      if (now - rate.lastStatsAt > STATS_MS) {
        const simDelta = sim.simTime - rate.lastSimTime
        const hz = simDelta > 0 ? (rate.count / simDelta) * 1000 : 0
        rate.count = 0
        rate.lastSimTime = sim.simTime
        rate.lastStatsAt = now
        setStats({ simTime: sim.simTime, rate: hz })
      }
    }

    connectSocket()
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('sim:state', onState)
    socket.on('sim:frame', onFrame)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('sim:state', onState)
      socket.off('sim:frame', onFrame)
    }
  }, [])

  useEffect(() => {
    socket.emit('sim:speed', speed)
  }, [speed])

  useEffect(() => {
    socket.emit('sim:stdp', stdp)
  }, [stdp])

  const resetSimView = useCallback((n) => {
    simRef.current.v = null
    simRef.current.spikeT = n ? new Float64Array(n).fill(-1e9) : null
    simRef.current.simTime = 0
    rateRef.current = { count: 0, lastSimTime: 0, lastStatsAt: 0 }
    setStats({ simTime: 0, rate: 0 })
  }, [])

  const handleGenerate = async () => {
    const api = canvasApiRef.current
    if (!api) return
    socket.emit('sim:pause')
    const idImageData = api.getIdImageData()
    const tmp = document.createElement('canvas')
    tmp.width = bg.width
    tmp.height = bg.height
    const tctx = tmp.getContext('2d', { willReadFrequently: true })
    tctx.drawImage(bg, 0, 0)
    const bgData = tctx.getImageData(0, 0, bg.width, bg.height).data

    const net = generateNetwork({
      idData: idImageData.data,
      bgData,
      width: bg.width,
      height: bg.height,
      density,
      seed: Math.floor(Math.random() * 1e9),
    })
    if (net.error || net.n === 0) {
      setMessage(net.error || 'No regions found — draw with the mask tools first')
      setNetwork(null)
      resetSimView(0)
      return
    }
    setNetwork(net)
    resetSimView(net.n)
    const ack = await new Promise((resolve) => {
      socket.timeout(5000).emit('net:build', buildPayload(net, stdp), (err, res) =>
        resolve(err ? { ok: false, error: 'server timeout' } : res),
      )
    })
    if (!ack || !ack.ok) {
      setMessage(`Backend build failed: ${ack?.error || 'unknown error'}`)
      return
    }
    setMessage(`Network ready — ${net.n} neurons, ${net.m} synapses`)
  }

  const handleRun = () => {
    if (!network) {
      setMessage('Generate a network first')
      return
    }
    if (running) socket.emit('sim:pause')
    else socket.emit('sim:start')
  }

  const handleReset = () => {
    socket.emit('sim:reset')
    resetSimView(network?.n || 0)
  }

  const handleClear = () => {
    socket.emit('sim:pause')
    canvasApiRef.current?.clearMasks()
    setNetwork(null)
    resetSimView(0)
    setMessage('Masks cleared — draw new regions')
  }

  const handlePoke = (ids) => {
    socket.emit('sim:poke', { ids, amp: 45 })
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 960 / img.naturalWidth, 640 / img.naturalHeight)
      const c = document.createElement('canvas')
      c.width = Math.max(2, Math.round(img.naturalWidth * scale))
      c.height = Math.max(2, Math.round(img.naturalHeight * scale))
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      socket.emit('sim:pause')
      setNetwork(null)
      resetSimView(0)
      setBg(c)
      setMessage('Image loaded — draw anatomical regions')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      setMessage('Could not load that image')
    }
    img.src = url
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>
            Neurorender<small>Izhikevich · Waxman · STDP</small>
          </span>
        </div>

        <div className="group">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Upload image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFile}
          />
        </div>

        <div className="group">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`btn ${tool === t.key ? 'active' : ''}`}
              onClick={() => setTool(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="group">
          {REGIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`btn region ${region === r.id ? 'active' : ''}`}
              style={{ '--rc': r.color }}
              onClick={() => {
                setRegion(r.id)
                if (tool === 'stim') setTool('draw')
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="group sliders">
          <label>
            Brush
            <input
              type="range"
              min="6"
              max="60"
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
            />
          </label>
          <label>
            Density
            <input
              type="range"
              min="0.25"
              max="2"
              step="0.05"
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
            />
          </label>
          <label>
            Speed
            <input
              type="range"
              min="0.25"
              max="4"
              step="0.25"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="group actions">
          <label className="btn toggle">
            <input
              type="checkbox"
              checked={stdp}
              onChange={(e) => setStdp(e.target.checked)}
            />
            STDP
          </label>
          <button type="button" className="btn" onClick={handleGenerate}>
            Generate
          </button>
          <button
            type="button"
            className={`btn primary ${running ? 'running' : ''}`}
            onClick={handleRun}
          >
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" className="btn" onClick={handleReset}>
            Reset
          </button>
          <button type="button" className="btn danger" onClick={handleClear}>
            Clear
          </button>
        </div>
      </header>

      <main className="stage">
        <NeurorenderCanvas
          ref={canvasApiRef}
          bg={bg}
          tool={tool}
          region={region}
          brush={brush}
          network={network}
          simRef={simRef}
          onPoke={handlePoke}
        />
      </main>

      <footer className="statusbar">
        <span className={`conn conn-${conn}`}>{conn}</span>
        <span>{network ? `${network.n} neurons` : 'no network'}</span>
        <span>{network ? `${network.m} synapses` : '—'}</span>
        <span>t = {(stats.simTime / 1000).toFixed(1)} s</span>
        <span>{stats.rate.toFixed(1)} spikes/s</span>
        <span className="message">{message}</span>
      </footer>
    </div>
  )
}

export default App
