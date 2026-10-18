// A single mutable store shared by the simulation and the UI. The sim writes to
// it every frame; the stats panel reads it. Kept out of React state on purpose —
// it changes far too often to re-render on.

// Spikes kept in the ring buffer before the oldest get overwritten.
export const HISTORY_CAPACITY = 80000

// Brain / VN / ON layer colors.
export const LAYER_COLORS = [
  [240, 138, 138],
  [127, 183, 238],
  [232, 199, 107],
]

const emptyI8 = () => new Int8Array(0)
const emptyF64 = () => new Float64Array(0)
const emptyI32 = () => new Int32Array(0)
const emptyF32 = () => new Float32Array(0)

export const simData = {
  running: false,
  neuronCount: 0,
  layers: emptyI8(),
  layerCounts: [0, 0, 0],
  positions: emptyF32(),
  simTimeMs: 0,
  totalSpikes: 0,
  histStart: 0,
  histCount: 0,
  histIdx: new Int32Array(HISTORY_CAPACITY),
  histT: new Float64Array(HISTORY_CAPACITY),
  spikeCounts: emptyI32(),
  firstSpike: emptyF64(),
  lastSpike: emptyF64(),
  spikeTimes: [],
  params: [],
  drive: emptyF32(),
  v: emptyF32(),
  u: emptyF32(),
  stimulus: 0,
  coupling: 0,
  dt: 0.5,
  speed: 1,
}

// Blanks the store back to "nothing running".
export function resetSimData() {
  simData.running = false
  simData.neuronCount = 0
  simData.layers = emptyI8()
  simData.layerCounts = [0, 0, 0]
  simData.positions = emptyF32()
  simData.simTimeMs = 0
  simData.totalSpikes = 0
  simData.histStart = 0
  simData.histCount = 0
  simData.spikeCounts = emptyI32()
  simData.firstSpike = emptyF64()
  simData.lastSpike = emptyF64()
  simData.spikeTimes = []
  simData.params = []
  simData.drive = emptyF32()
  simData.v = emptyF32()
  simData.u = emptyF32()
  simData.stimulus = 0
  simData.coupling = 0
  simData.dt = 0.5
  simData.speed = 1
}

// Points the store at a fresh run's arrays (reusing the ones the sim allocated).
export function beginRun(info) {
  simData.running = true
  simData.neuronCount = info.neuronCount
  simData.simTimeMs = 0
  simData.totalSpikes = 0
  simData.histStart = 0
  simData.histCount = 0
  simData.spikeCounts = info.spikeCounts
  simData.firstSpike = info.firstSpike
  simData.lastSpike = info.lastSpike
  simData.spikeTimes = info.spikeTimes
  simData.params = info.params
  simData.drive = info.drive
  simData.v = info.v
  simData.u = info.u
  simData.stimulus = info.stimulus
  simData.coupling = info.coupling
  simData.dt = info.dt
  simData.speed = info.speed
}

export function endRun() {
  simData.running = false
}

// Called once per rendered frame with the latest clock/speed.
export function recordFrame(simTimeMs, speed) {
  simData.running = true
  simData.simTimeMs = simTimeMs
  simData.speed = speed
}

// Records a spike: bumps counters and drops it into the ring buffer.
export function pushSpike(index, tMs) {
  simData.spikeCounts[index] += 1
  simData.totalSpikes += 1
  simData.lastSpike[index] = tMs
  if (simData.firstSpike[index] === 0) simData.firstSpike[index] = tMs
  if (simData.histCount < HISTORY_CAPACITY) {
    const pos = (simData.histStart + simData.histCount) % HISTORY_CAPACITY
    simData.histIdx[pos] = index
    simData.histT[pos] = tMs
    simData.histCount += 1
  } else {
    simData.histIdx[simData.histStart] = index
    simData.histT[simData.histStart] = tMs
    simData.histStart = (simData.histStart + 1) % HISTORY_CAPACITY
  }
}

// Publishes the sampled neuron layout so the stats panel knows what to draw.
export function setNetworkLayout(layout) {
  simData.layers = layout.layers
  simData.positions = layout.positions
  simData.layerCounts = layout.layerCounts
  simData.neuronCount = layout.neuronCount
}

// Walks the ring buffer oldest→newest and visits spikes inside [fromMs, toMs].
// Stops early once it passes toMs since the buffer is time-ordered.
export function forEachSpikeInRange(data, fromMs, toMs, visit) {
  const cap = data.histIdx.length
  const len = data.histCount
  const start = data.histStart
  for (let k = 0; k < len; k += 1) {
    const p = (start + k) % cap
    const t = data.histT[p]
    if (t < fromMs) continue
    if (t > toMs) break
    visit(data.histIdx[p], t)
  }
}

// Convenience count over the same range.
export function countSpikesInRange(data, fromMs, toMs) {
  let n = 0
  forEachSpikeInRange(data, fromMs, toMs, () => {
    n += 1
  })
  return n
}
