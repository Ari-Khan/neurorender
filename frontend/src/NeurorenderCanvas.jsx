import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { REGIONS } from './regions.js'

const TAU = Math.PI * 2
const FLASH_MS = 40

const BAND_T = [0.08, 0.3, 0.55, 0.95]

function bandColor(rgb, t) {
  const m = 0.28 + 0.72 * t
  const w = t > 0.6 ? (t - 0.6) * 1.6 : 0
  const rr = Math.round(rgb[0] * m * (1 - w) + 255 * w)
  const gg = Math.round(rgb[1] * m * (1 - w) + 255 * w)
  const bb = Math.round(rgb[2] * m * (1 - w) + 255 * w)
  return `rgb(${rr},${gg},${bb})`
}

const COLOR_TABLE = REGIONS.flatMap(({ rgb }) => BAND_T.map((t) => bandColor(rgb, t)))

function voltageBand(vm) {
  const t = (vm + 70) / 100
  if (t < 0.15) return 0
  if (t < 0.35) return 1
  if (t < 0.6) return 2
  return 3
}

const NeurorenderCanvas = forwardRef(function NeurorenderCanvas(
  { bg, tool, region, brush, network, simRef, onPoke },
  ref,
) {
  const outRef = useRef(null)
  const canvases = useMemo(
    () => ({
      maskView: document.createElement('canvas'),
      maskId: document.createElement('canvas'),
      staticBg: document.createElement('canvas'),
      staticAxon: document.createElement('canvas'),
    }),
    [],
  )
  const stateRef = useRef({
    W: 0,
    H: 0,
    dpr: 1,
    dirty: true,
    drawing: false,
    last: null,
    pointer: null,
    bgSource: null,
    network: null,
    tool: 'draw',
    region: 0,
    brush: 24,
  })

  stateRef.current.tool = tool
  stateRef.current.region = region
  stateRef.current.brush = brush

  useImperativeHandle(
    ref,
    () => ({
      clearMasks() {
        const { W, H } = stateRef.current
        for (const key of ['maskView', 'maskId']) {
          const ctx = canvases[key].getContext('2d')
          ctx.globalCompositeOperation = 'source-over'
          ctx.clearRect(0, 0, W, H)
        }
      },
      getIdImageData() {
        const { W, H } = stateRef.current
        return canvases.maskId.getContext('2d').getImageData(0, 0, W, H)
      },
    }),
    [canvases],
  )

  useEffect(() => {
    stateRef.current.network = network
    stateRef.current.dirty = true
  }, [network])

  useEffect(() => {
    const st = stateRef.current
    const W = bg.width
    const H = bg.height
    st.W = W
    st.H = H
    st.bgSource = bg
    st.dpr = Math.min(2, window.devicePixelRatio || 1)
    outRef.current.width = Math.round(W * st.dpr)
    outRef.current.height = Math.round(H * st.dpr)
    for (const key of ['staticBg', 'staticAxon']) {
      canvases[key].width = Math.round(W * st.dpr)
      canvases[key].height = Math.round(H * st.dpr)
    }
    for (const key of ['maskView', 'maskId']) {
      canvases[key].width = W
      canvases[key].height = H
    }
    st.dirty = true
  }, [bg, canvases])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      drawFrame()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  })

  function rebuildStatic() {
    const st = stateRef.current
    st.dirty = false
    const { W, H, dpr, bgSource, network } = st

    const bgCtx = canvases.staticBg.getContext('2d')
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    bgCtx.clearRect(0, 0, W, H)
    bgCtx.drawImage(bgSource, 0, 0, W, H)
    bgCtx.fillStyle = 'rgba(8, 10, 18, 0.4)'
    bgCtx.fillRect(0, 0, W, H)

    const aCtx = canvases.staticAxon.getContext('2d')
    aCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    aCtx.clearRect(0, 0, W, H)
    if (network && network.m > 0) {
      const { x, y, pre, post, inh, curves, m } = network
      aCtx.lineWidth = 0.7
      aCtx.strokeStyle = 'rgba(130, 170, 255, 0.1)'
      aCtx.beginPath()
      for (let k = 0; k < m; k++) {
        const i = pre[k]
        const j = post[k]
        aCtx.moveTo(x[i], y[i])
        aCtx.quadraticCurveTo(curves.cx[k], curves.cy[k], x[j], y[j])
      }
      aCtx.stroke()
      aCtx.strokeStyle = 'rgba(255, 120, 120, 0.08)'
      aCtx.beginPath()
      for (let k = 0; k < m; k++) {
        if (!inh[pre[k]]) continue
        const i = pre[k]
        const j = post[k]
        aCtx.moveTo(x[i], y[i])
        aCtx.quadraticCurveTo(curves.cx[k], curves.cy[k], x[j], y[j])
      }
      aCtx.stroke()
    }
  }

  function drawFrame() {
    const st = stateRef.current
    const out = outRef.current
    if (!out) return
    const { W, H, dpr } = st
    const ctx = out.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (st.dirty) rebuildStatic()

    ctx.drawImage(canvases.staticBg, 0, 0, W, H)
    ctx.drawImage(canvases.maskView, 0, 0)
    ctx.drawImage(canvases.staticAxon, 0, 0, W, H)

    const net = st.network
    const sim = simRef.current
    if (net && net.n > 0) {
      drawNeurons(ctx, net, sim)
      drawPulses(ctx, net, sim)
    }

    if (st.pointer && st.tool !== 'stim') {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(st.pointer.x, st.pointer.y, st.brush, 0, TAU)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.arc(st.pointer.x, st.pointer.y, Math.max(1, st.brush - 1), 0, TAU)
      ctx.stroke()
    }
  }

  function drawNeurons(ctx, net, sim) {
    const { x, y, region, inh, n } = net
    const v = sim.v
    const spikeT = sim.spikeT
    const simTime = sim.simTime
    const r = Math.max(1.6, Math.min(3.2, 160 / Math.sqrt(n)))
    const flashing = []

    for (let band = 0; band < 4; band++) {
      for (let rg = 0; rg < REGIONS.length; rg++) {
        let any = false
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          if (region[i] !== rg) continue
          const s = spikeT ? spikeT[i] : -Infinity
          if (simTime - s < FLASH_MS) continue
          const band0 = v ? voltageBand(v[i]) : 0
          if (band0 !== band) continue
          ctx.moveTo(x[i] + r, y[i])
          ctx.arc(x[i], y[i], r, 0, TAU)
          any = true
        }
        if (any) {
          ctx.fillStyle = COLOR_TABLE[rg * 4 + band]
          ctx.fill()
        }
      }
    }

    if (spikeT) {
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const dtS = simTime - spikeT[i]
        if (dtS >= 0 && dtS < FLASH_MS) {
          ctx.moveTo(x[i] + r, y[i])
          ctx.arc(x[i], y[i], r, 0, TAU)
          flashing.push(i)
        }
      }
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      if (flashing.length > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.beginPath()
        for (const i of flashing) {
          ctx.moveTo(x[i] + r * 2.4, y[i])
          ctx.arc(x[i], y[i], r * 2.4, 0, TAU)
        }
        ctx.fill()
      }
    }

    ctx.strokeStyle = 'rgba(240,245,255,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      if (!inh[i]) continue
      ctx.moveTo(x[i] + r, y[i])
      ctx.arc(x[i], y[i], r, 0, TAU)
    }
    ctx.stroke()
  }

  function drawPulses(ctx, net, sim) {
    const { x, y, pre, curves, inh, m, delayMs } = net
    const spikeT = sim.spikeT
    if (!spikeT) return
    const simTime = sim.simTime
    let drawn = 0
    for (let k = 0; k < m && drawn < 800; k++) {
      const ts = spikeT[pre[k]]
      const delay = delayMs[k]
      const dtS = simTime - ts
      if (dtS < 0 || dtS > delay) continue
      const u = dtS / delay
      const iu = 1 - u
      const i = pre[k]
      const j = net.post[k]
      const px = iu * iu * x[i] + 2 * iu * u * curves.cx[k] + u * u * x[j]
      const py = iu * iu * y[i] + 2 * iu * u * curves.cy[k] + u * u * y[j]
      ctx.fillStyle = inh[i] ? 'rgba(255,150,150,0.9)' : 'rgba(190,225,255,0.95)'
      ctx.beginPath()
      ctx.arc(px, py, 1.7, 0, TAU)
      ctx.fill()
      drawn++
    }
  }

  const pointerPos = (e) => {
    const st = stateRef.current
    const rect = outRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (st.W / rect.width),
      y: (e.clientY - rect.top) * (st.H / rect.height),
    }
  }

  const strokeMasks = (x0, y0, x1, y1) => {
    const st = stateRef.current
    const reg = REGIONS[st.region]
    const erase = st.tool === 'erase'
    const specs = [
      [canvases.maskId, `rgb(${reg.idRgb[0]},${reg.idRgb[1]},${reg.idRgb[2]})`],
      [canvases.maskView, `rgba(${reg.rgb[0]},${reg.rgb[1]},${reg.rgb[2]},0.38)`],
    ]
    for (const [canvas, style] of specs) {
      const ctx = canvas.getContext('2d')
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
      ctx.strokeStyle = style
      ctx.lineWidth = st.brush * 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }
  }

  const handleDown = (e) => {
    const st = stateRef.current
    outRef.current.setPointerCapture(e.pointerId)
    const p = pointerPos(e)
    if (st.tool === 'stim') {
      const net = st.network
      if (!net) return
      const radius = Math.max(12, st.brush * 0.8)
      const ids = []
      for (let i = 0; i < net.n; i++) {
        if (Math.hypot(net.x[i] - p.x, net.y[i] - p.y) <= radius) ids.push(i)
      }
      if (ids.length > 0) onPoke?.(ids)
      return
    }
    st.drawing = true
    st.last = p
    strokeMasks(p.x, p.y, p.x, p.y)
  }

  const handleMove = (e) => {
    const st = stateRef.current
    const p = pointerPos(e)
    st.pointer = p
    if (!st.drawing) return
    strokeMasks(st.last.x, st.last.y, p.x, p.y)
    st.last = p
  }

  const handleUp = () => {
    stateRef.current.drawing = false
    stateRef.current.last = null
  }

  const handleLeave = () => {
    stateRef.current.pointer = null
  }

  return (
    <div className="nr-canvas-wrap">
      <canvas
        ref={outRef}
        className="nr-canvas"
        style={{ cursor: tool === 'stim' ? 'crosshair' : 'none' }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleLeave}
      />
    </div>
  )
})

export default NeurorenderCanvas
