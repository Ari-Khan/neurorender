import { REGIONS } from '../regions.js'
import { TYPE_ORDER } from '../../../backend/Neuron.js'

const MAX_NEURONS = 1000
const HARD_CORE_PAD = 0.6
const WAXMAN_ALPHA = 0.35
const WAXMAN_BETA = 0.15
const MAX_DIST = 100
const SAME_REGION_BOOST = 1.6
const V_CONDUCTION = 1.5
const MAX_DELAY_MS = 60
const PHOTO_GAIN = 1

export function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function regionAtPixel(idData, idx) {
  const o = idx * 4
  if (idData[o + 3] < 128) return -1
  if (idData[o + 1] > 60 || idData[o + 2] > 60) return -1
  const id = Math.round((idData[o] - 50) / 51)
  return id >= 0 && id < REGIONS.length ? id : -1
}

function bridson({ width, height, radius, isActive, seeds, rng, k = 24 }) {
  const cell = radius / Math.SQRT2
  const gw = Math.max(1, Math.ceil(width / cell))
  const gh = Math.max(1, Math.ceil(height / cell))
  const grid = new Int32Array(gw * gh).fill(-1)
  const pts = seeds.slice()

  const gridPlace = (pi) => {
    const gx = Math.min(gw - 1, Math.floor(pts[pi][0] / cell))
    const gy = Math.min(gh - 1, Math.floor(pts[pi][1] / cell))
    grid[gy * gw + gx] = pi
  }
  for (let i = 0; i < pts.length; i++) gridPlace(i)

  const tooClose = (x, y) => {
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(x / cell)))
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(y / cell)))
    for (let dy = -2; dy <= 2; dy++) {
      const yy = gy + dy
      if (yy < 0 || yy >= gh) continue
      for (let dx = -2; dx <= 2; dx++) {
        const xx = gx + dx
        if (xx < 0 || xx >= gw) continue
        const pi = grid[yy * gw + xx]
        if (pi < 0) continue
        const ddx = pts[pi][0] - x
        const ddy = pts[pi][1] - y
        if (ddx * ddx + ddy * ddy < radius * radius) return true
      }
    }
    return false
  }

  const active = []
  const trySpawn = () => {
    for (let tries = 0; tries < 400; tries++) {
      const x = rng() * width
      const y = rng() * height
      if (!isActive(x, y) || tooClose(x, y)) continue
      pts.push([x, y])
      gridPlace(pts.length - 1)
      active.push(pts.length - 1)
      return true
    }
    return false
  }

  if (!trySpawn()) return []

  while (active.length > 0) {
    const ai = Math.floor(rng() * active.length)
    const pi = active[ai]
    const [px, py] = pts[pi]
    let placed = false
    for (let attempt = 0; attempt < k; attempt++) {
      const ang = rng() * Math.PI * 2
      const rad = radius * (1 + rng())
      const x = px + Math.cos(ang) * rad
      const y = py + Math.sin(ang) * rad
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (!isActive(x, y) || tooClose(x, y)) continue
      pts.push([x, y])
      gridPlace(pts.length - 1)
      active.push(pts.length - 1)
      placed = true
      break
    }
    if (!placed) {
      active[ai] = active[active.length - 1]
      active.pop()
    }
  }

  return pts.slice(seeds.length)
}

function photoCurrent(bgData, width, height, x, y) {
  const px = Math.min(width - 1, Math.max(0, Math.round(x)))
  const py = Math.min(height - 1, Math.max(0, Math.round(y)))
  const o = (py * width + px) * 4
  const r = bgData[o] / 255
  const g = bgData[o + 1] / 255
  const b = bgData[o + 2] / 255
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const rg = r - g
  const by = b - (r + g) / 2
  const drive = 1 + PHOTO_GAIN * (8 * lum + 3 * rg + 1.5 * by)
  return Math.min(24, Math.max(0, drive))
}

export function generateNetwork({
  idData,
  bgData,
  width,
  height,
  density = 1,
  seed = 1,
  rSom = 3,
}) {
  const rng = mulberry32(seed)

  const regionIdx = new Int16Array(width * height).fill(-1)
  const area = new Float64Array(REGIONS.length)
  for (let i = 0; i < width * height; i++) {
    const r = regionAtPixel(idData, i)
    regionIdx[i] = r
    if (r >= 0) area[r]++
  }

  let est = 0
  for (let r = 0; r < REGIONS.length; r++) {
    est += area[r] * REGIONS[r].density * density
  }
  const scale = est > MAX_NEURONS ? MAX_NEURONS / est : 1

  const minSep = 2 * rSom + HARD_CORE_PAD
  const seeds = []
  const regionPoints = []
  const regionCount = new Int32Array(REGIONS.length)

  for (let r = 0; r < REGIONS.length; r++) {
    if (area[r] < 4) {
      regionPoints.push([])
      continue
    }
    const rho = REGIONS[r].density * density * scale
    if (rho <= 0) {
      regionPoints.push([])
      continue
    }
    const radius = Math.max(minSep, Math.sqrt(0.7 / rho))
    const isActive = (x, y) => {
      const xi = Math.min(width - 1, Math.max(0, Math.floor(x)))
      const yi = Math.min(height - 1, Math.max(0, Math.floor(y)))
      return regionIdx[yi * width + xi] === r
    }
    const pts = bridson({ width, height, radius, isActive, seeds, rng })
    regionCount[r] = pts.length
    for (const p of pts) seeds.push(p)
    regionPoints.push(pts)
  }

  let n = seeds.length
  if (n < 1) {
    return {
      n: 0,
      m: 0,
      width,
      height,
      error: 'Draw anatomical regions on the image first',
    }
  }

  let trimmed = false
  if (n > MAX_NEURONS) {
    const keep = new Array(MAX_NEURONS)
    for (let i = 0; i < MAX_NEURONS; i++) keep[i] = seeds[i]
    seeds.length = 0
    seeds.push(...keep)
    n = MAX_NEURONS
    trimmed = true
  }

  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const region = new Uint8Array(n)
  const typeIdx = new Uint8Array(n)
  const inh = new Uint8Array(n)
  const iBase = new Float32Array(n)

  const typeIndexOf = (name) => Math.max(0, TYPE_ORDER.indexOf(name))

  for (let i = 0; i < n; i++) {
    const [sx, sy] = seeds[i]
    x[i] = sx
    y[i] = sy
    const xi = Math.min(width - 1, Math.max(0, Math.floor(sx)))
    const yi = Math.min(height - 1, Math.max(0, Math.floor(sy)))
    const r = Math.max(0, regionIdx[yi * width + xi])
    region[i] = r
    const reg = REGIONS[r]
    const isInh = rng() > reg.excProb
    inh[i] = isInh ? 1 : 0
    typeIdx[i] = isInh ? typeIndexOf('FS') : typeIndexOf(reg.type)
    iBase[i] = reg.drive + rng() * 4
    if (reg.key === 'eye') iBase[i] += photoCurrent(bgData, width, height, sx, sy)
  }

  const L = Math.hypot(width, height)
  const preL = []
  const postL = []
  const wL = []
  const delayL = []
  const degree = new Int32Array(n)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j]
      const dy = y[i] - y[j]
      const d = Math.hypot(dx, dy)
      if (d > MAX_DIST || d < 1e-6) continue
      let p = WAXMAN_ALPHA * Math.exp(-d / (WAXMAN_BETA * L))
      if (region[i] === region[j]) p *= SAME_REGION_BOOST
      if (rng() >= p) continue
      addSynapse(i, j, d, rng, inh, preL, postL, wL, delayL, degree)
    }
  }

  for (let i = 0; i < n; i++) {
    if (degree[i] > 0) continue
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = Math.hypot(x[i] - x[j], y[i] - y[j])
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    if (best >= 0) {
      addSynapse(i, best, bestD, rng, inh, preL, postL, wL, delayL, degree)
    }
  }

  const m = preL.length
  const pre = Uint32Array.from(preL)
  const post = Uint32Array.from(postL)
  const w = Float32Array.from(wL)
  const delayMs = Float32Array.from(delayL)

  const cx = new Float32Array(m)
  const cy = new Float32Array(m)
  for (let k = 0; k < m; k++) {
    const i = pre[k]
    const j = post[k]
    const mx = (x[i] + x[j]) / 2
    const my = (y[i] + y[j]) / 2
    const dx = x[j] - x[i]
    const dy = y[j] - y[i]
    const bend = (rng() - 0.5) * 0.35
    cx[k] = mx - dy * bend
    cy[k] = my + dx * bend
  }

  return {
    n,
    m,
    width,
    height,
    x,
    y,
    region,
    typeIdx,
    inh,
    iBase,
    pre,
    post,
    w,
    delayMs,
    curves: { cx, cy },
    regionCount: Array.from(regionCount),
    trimmed,
  }
}

function addSynapse(i, j, d, rng, inh, preL, postL, wL, delayL, degree) {
  const forward = rng() < 0.5
  const a = forward ? i : j
  const b = forward ? j : i
  const w = inh[a] ? 0.12 + rng() * 0.2 : 0.022 + rng() * 0.05
  preL.push(a)
  postL.push(b)
  wL.push(w)
  delayL.push(Math.min(MAX_DELAY_MS, Math.max(1, d / V_CONDUCTION)))
  degree[a]++
  degree[b]++
}

export function buildPayload(net, stdp = true) {
  return {
    n: net.n,
    types: net.typeIdx.buffer,
    inh: net.inh.buffer,
    iBase: net.iBase.buffer,
    pre: net.pre.buffer,
    post: net.post.buffer,
    w: net.w.buffer,
    delayMs: net.delayMs.buffer,
    stdp,
  }
}
