import { useEffect, useRef, useState } from 'react'
import { LAYER_COLORS, forEachSpikeInRange, simData } from '../sim/simData'

const RASTER_WINDOW_MS = 5000
const RATE_WINDOW_MS = 8000
const RATE_BINS = 20
const RECENT_WINDOW_MS = 1000
const NEURON_RATE_WINDOW_MS = 2000
const MAX_DRAWN_SPIKES = 30000
const LAYER_NAMES = ['Brain', 'VN', 'ON']

function layerCss(layer) {
  const c = LAYER_COLORS[layer] || [200, 200, 200]
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

function fmt(value, digits = 1) {
  return Number(value).toFixed(digits)
}

function firstSpikes(data) {
  let firstAny = 0
  let firstBrain = 0
  const count = Math.min(data.neuronCount, data.firstSpike.length, data.layers.length)
  for (let i = 0; i < count; i += 1) {
    const t = data.firstSpike[i]
    if (t <= 0) continue
    if (firstAny === 0 || t < firstAny) firstAny = t
    if (data.layers[i] === 0 && (firstBrain === 0 || t < firstBrain)) firstBrain = t
  }
  return { firstAny, firstBrain }
}

function neuronSpikesInWindow(data, neuronIndex, fromMs, toMs) {
  let n = 0
  forEachSpikeInRange(data, fromMs, toMs, (index) => {
    if (index === neuronIndex) n += 1
  })
  return n
}

function setupCanvas(canvas, dpr) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return null
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, width, height }
}

function drawRaster(canvas, dpr, data) {
  const frame = canvas && setupCanvas(canvas, dpr)
  if (!frame) return
  const { ctx, width, height } = frame
  const count = data.neuronCount
  const end = data.simTimeMs
  const start = Math.max(0, end - RASTER_WINDOW_MS)
  const span = Math.max(1, end - start)

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  for (let s = Math.ceil(start / 1000) * 1000; s <= end; s += 1000) {
    const x = ((s - start) / span) * width
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  ctx.stroke()

  if (count > 0 && data.histCount > 0) {
    const layerArr = data.layers
    const cap = data.histIdx.length
    const stride = Math.max(1, Math.ceil(data.histCount / MAX_DRAWN_SPIKES))
    const colors = LAYER_COLORS.map((c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`)
    let lastLayer = -1
    for (let k = 0; k < data.histCount; k += stride) {
      const p = (data.histStart + k) % cap
      const t = data.histT[p]
      if (t < start) continue
      if (t > end) break
      const index = data.histIdx[p]
      const layer = index < layerArr.length ? layerArr[index] : 0
      if (layer !== lastLayer) {
        ctx.fillStyle = colors[layer] || '#ffffff'
        lastLayer = layer
      }
      const x = ((t - start) / span) * (width - 2) + 1
      const y = ((index + 0.5) / count) * height
      ctx.fillRect(x, y, 2, 1.5)
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fillRect(width - 1, 0, 1, height)
}

function drawRates(canvas, dpr, data) {
  const frame = canvas && setupCanvas(canvas, dpr)
  if (!frame) return
  const { ctx, width, height } = frame
  const end = data.simTimeMs
  const start = Math.max(0, end - RATE_WINDOW_MS)
  const span = Math.max(1, end - start)
  const binMs = span / RATE_BINS

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  for (let g = 1; g < 3; g += 1) {
    const y = (height * g) / 3
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()

  if (data.neuronCount === 0 || data.histCount === 0) return

  const layerArr = data.layers
  const binCounts = [
    new Float64Array(RATE_BINS),
    new Float64Array(RATE_BINS),
    new Float64Array(RATE_BINS),
  ]
  forEachSpikeInRange(data, start, end, (index, t) => {
    const layer = index < layerArr.length ? layerArr[index] : 0
    const bin = Math.min(RATE_BINS - 1, Math.max(0, Math.floor((t - start) / binMs)))
    binCounts[layer][bin] += 1
  })

  const binSec = binMs / 1000
  let maxRate = 1
  const series = binCounts.map((bins, layer) => {
    const neurons = Math.max(1, data.layerCounts[layer])
    return Array.from(bins, (n) => {
      const rate = n / (neurons * binSec)
      if (rate > maxRate) maxRate = rate
      return rate
    })
  })

  series.forEach((rates, layer) => {
    ctx.strokeStyle = layerCss(layer)
    ctx.lineWidth = 1.25
    ctx.beginPath()
    rates.forEach((rate, bin) => {
      const x = ((bin + 0.5) / RATE_BINS) * width
      const y = height - 2 - (rate / maxRate) * (height - 6)
      if (bin === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })

  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '9px system-ui, sans-serif'
  ctx.fillText(`${maxRate.toFixed(1)} Hz`, 4, 10)
}

function drawAnalysis(rasterCanvas, rateCanvas, data) {
  const dpr = window.devicePixelRatio || 1
  drawRaster(rasterCanvas, dpr, data)
  drawRates(rateCanvas, dpr, data)
}

function Row({ label, value, accent }) {
  return (
    <div className="row stats-row">
      <span className="row-label">{label}</span>
      <span className="row-value" style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  )
}

function LayerChip({ layer }) {
  return (
    <span className="stats-chip" style={{ background: layerCss(layer) }}>
      {LAYER_NAMES[layer] || `Layer ${layer}`}
    </span>
  )
}

export default function StatsPanel({
  networkStats,
  selectedNeuron,
  onClearSelection,
  simulationEnabled,
  speed,
}) {
  const [tab, setTab] = useState('section')
  const [expanded, setExpanded] = useState(true)
  const [, setTick] = useState(0)
  const rasterRef = useRef(null)
  const rateRef = useRef(null)
  const lastDrawRef = useRef(null)

  useEffect(() => {
    if (!expanded) return undefined
    const id = window.setInterval(() => setTick((t) => t + 1), 250)
    return () => window.clearInterval(id)
  }, [expanded])

  useEffect(() => {
    lastDrawRef.current = null
  }, [tab, expanded])

  const drawKey = `${simData.simTimeMs}|${simData.histCount}|${simData.neuronCount}`
  useEffect(() => {
    if (!expanded || tab !== 'section') return
    if (lastDrawRef.current === drawKey) return
    lastDrawRef.current = drawKey
    drawAnalysis(rasterRef.current, rateRef.current, simData)
  }, [expanded, tab, drawKey])

  const d = simData
  const totalNeurons = Math.max(d.neuronCount, networkStats?.neurons || 0)
  const layerCounts = d.layerCounts
  const { firstAny, firstBrain } = firstSpikes(d)
  const recentFrom = Math.max(0, d.simTimeMs - RECENT_WINDOW_MS)
  let recentTotal = 0
  const recentByLayer = [0, 0, 0]
  forEachSpikeInRange(d, recentFrom, d.simTimeMs, (index) => {
    recentTotal += 1
    const layer = index < d.layers.length ? d.layers[index] : 0
    recentByLayer[layer] += 1
  })
  const popRate = recentTotal / Math.max(1, totalNeurons)
  const reachedBrain = d.simTimeMs > 0 && firstBrain > 0

  const idx = selectedNeuron
  const hasNeuron = idx != null
    && idx >= 0
    && idx < d.neuronCount
    && idx < d.spikeCounts.length
    && idx < d.layers.length

  return (
    <div className="stats-panel" role="complementary" aria-label="Analysis readouts">
      <div className="stats-head">
        <div className="stats-tabs" role="tablist" aria-label="Analysis tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'neuron'}
            className={`stats-tab${tab === 'neuron' ? ' active' : ''}`}
            onClick={() => setTab('neuron')}
          >
            Neuron
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'section'}
            className={`stats-tab${tab === 'section' ? ' active' : ''}`}
            onClick={() => setTab('section')}
          >
            Section
          </button>
        </div>
        <button
          type="button"
          className="tbtn small stats-collapse"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Collapse analysis' : 'Expand analysis'}
        >
          {expanded ? '▾' : '▴'}
        </button>
      </div>
      {expanded && (
        <div className="stats-body">
          {tab === 'neuron' ? (
            hasNeuron ? (
              (() => {
                const layer = d.layers[idx]
                const spikes = d.spikeCounts[idx]
                const first = d.firstSpike[idx]
                const last = d.lastSpike[idx]
                const avgRate = d.simTimeMs > 0 ? spikes / (d.simTimeMs / 1000) : 0
                const winSpikes = neuronSpikesInWindow(
                  d,
                  idx,
                  Math.max(0, d.simTimeMs - NEURON_RATE_WINDOW_MS),
                  d.simTimeMs,
                )
                const winRate = winSpikes / (NEURON_RATE_WINDOW_MS / 1000)
                const params = d.params[idx]
                const drive = d.drive[idx]
                const v = d.v[idx]
                const u = d.u[idx]
                const p3 = idx * 3
                return (
                  <>
                    <section>
                      <h4>
                        <span className="stats-dot" aria-hidden="true" />
                        Neuron #{idx}
                      </h4>
                      <Row label="Layer" value={<LayerChip layer={layer} />} />
                      <Row
                        label="Position"
                        value={`${fmt(d.positions[p3] ?? 0, 1)}, ${fmt(d.positions[p3 + 1] ?? 0, 1)}, ${fmt(d.positions[p3 + 2] ?? 0, 1)}`}
                      />
                      <Row label="Input drive" value={fmt(drive ?? 0, 2)} />
                      <Row label="Membrane v" value={`${fmt(v ?? 0, 1)} mV`} />
                      <Row label="Recovery u" value={fmt(u ?? 0, 2)} />
                    </section>
                    <section>
                      <h4>Activity</h4>
                      <Row label="Spikes" value={String(spikes)} />
                      <Row label="First spike" value={first > 0 ? `${fmt(first, 0)} ms` : '—'} />
                      <Row label="Last spike" value={last > 0 ? `${fmt(last, 0)} ms` : '—'} />
                      <Row label="Avg rate" value={`${fmt(avgRate, 1)} Hz`} />
                      <Row
                        label={`Rate (${NEURON_RATE_WINDOW_MS / 1000}s window)`}
                        value={`${fmt(winRate, 1)} Hz`}
                      />
                    </section>
                    <section>
                      <h4>Izhikevich parameters</h4>
                      <Row label="Pattern" value={params?.name || 'Custom'} />
                      {['a', 'b', 'c', 'd'].map((key) => (
                        <Row key={key} label={key} value={params ? String(params[key]) : '—'} />
                      ))}
                    </section>
                    <button type="button" className="panel-btn" onClick={onClearSelection}>
                      Clear selection
                    </button>
                  </>
                )
              })()
            ) : (
              <p className="stats-hint">
                Click a neuron in the scene to inspect it. Selected neurons highlight in purple.
              </p>
            )
          ) : (
            <>
              <section>
                <h4>Brain</h4>
                <Row label="Neurons" value={String(totalNeurons)} />
                <Row label="Dendrites" value={String(networkStats?.dendrites ?? 0)} />
                {LAYER_NAMES.map((name, layer) => (
                  <Row
                    key={name}
                    label={<LayerChip layer={layer} />}
                    value={`${layerCounts[layer]} (${totalNeurons ? Math.round((layerCounts[layer] / totalNeurons) * 100) : 0}%)`}
                  />
                ))}
              </section>
              <section>
                <h4>Simulation</h4>
                <Row
                  label="Status"
                  value={runningLabel(d.running)}
                  accent={d.running ? '#7be08a' : undefined}
                />
                <Row label="Sim time" value={`${fmt(d.simTimeMs / 1000, 2)} s`} />
                <Row label="Speed" value={simulationEnabled ? `${speed}x` : '—'} />
                <Row label="Stimulus" value={d.stimulus ? String(d.stimulus) : '—'} />
                <Row label="Coupling g" value={d.coupling ? String(d.coupling) : '—'} />
                <Row label="Total spikes" value={String(d.totalSpikes)} />
                <Row label="Population rate" value={`${fmt(popRate, 1)} Hz`} />
                {LAYER_NAMES.map((name, layer) => (
                  <Row
                    key={name}
                    label={`${name} rate`}
                    value={`${fmt(recentByLayer[layer] / Math.max(1, layerCounts[layer]), 1)} Hz`}
                  />
                ))}
              </section>
              <section>
                <h4>Latency &amp; propagation</h4>
                <Row label="First spike" value={firstAny > 0 ? `${fmt(firstAny, 0)} ms` : '—'} />
                <Row
                  label="First brain spike"
                  value={firstBrain > 0 ? `${fmt(firstBrain, 0)} ms` : '—'}
                />
                <Row
                  label="Reached brain"
                  value={d.simTimeMs > 0 ? (firstBrain > 0 ? 'Yes' : 'No') : '—'}
                  accent={reachedBrain ? '#7be08a' : d.simTimeMs > 0 ? '#e07b7b' : undefined}
                />
              </section>
              <section>
                <h4>Raster — neurons × time</h4>
                <canvas ref={rasterRef} className="stats-canvas" />
                <div className="stats-legend">
                  {LAYER_NAMES.map((name, layer) => (
                    <span key={name} className="stats-legend-item">
                      <span className="stats-dot" style={{ background: layerCss(layer) }} />
                      {name}
                    </span>
                  ))}
                  <span className="stats-legend-note">last {RASTER_WINDOW_MS / 1000}s</span>
                </div>
              </section>
              <section>
                <h4>Firing rate per layer</h4>
                <canvas ref={rateRef} className="stats-canvas stats-canvas-rate" />
                <div className="stats-legend">
                  {LAYER_NAMES.map((name, layer) => (
                    <span key={name} className="stats-legend-item">
                      <span className="stats-dot" style={{ background: layerCss(layer) }} />
                      {name}
                    </span>
                  ))}
                  <span className="stats-legend-note">last {RATE_WINDOW_MS / 1000}s</span>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function runningLabel(running) {
  return running ? 'Running' : 'Stopped'
}
