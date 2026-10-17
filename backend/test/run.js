import { generateNetwork } from '../../frontend/src/net/sampling.js'
import { NeuronNetwork, DT } from '../Neuron.js'

const W = 400
const H = 300
const REGION_NAMES = ['brain', 'eye', 'nerve', 'spine', 'shell']

function makeMasks() {
  const idData = new Uint8ClampedArray(W * H * 4)
  const bgData = new Uint8ClampedArray(W * H * 4)
  const put = (x, y, rgb) => {
    const o = (y * W + x) * 4
    idData[o] = rgb[0]
    idData[o + 1] = rgb[1]
    idData[o + 2] = rgb[2]
    idData[o + 3] = 255
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const base = 30 + (x / W) * 40
      bgData[o] = base
      bgData[o + 1] = base + 5
      bgData[o + 2] = base + 10
      bgData[o + 3] = 255
      const dxe = (x - 60) / 25
      const dye = (y - 140) / 25
      if (dxe * dxe + dye * dye <= 1) put(x, y, [101, 0, 0])
      const dxb = (x - 160) / 70
      const dyb = (y - 150) / 55
      if (dxb * dxb + dyb * dyb <= 1) put(x, y, [50, 0, 0])
      if (x >= 230 && x <= 380 && Math.abs(y - 150) <= 12) put(x, y, [152, 0, 0])
    }
  }
  const eo = (140 * W + 60) * 4
  bgData[eo] = 230
  bgData[eo + 1] = 240
  bgData[eo + 2] = 250
  return { idData, bgData }
}

function runCase(label, stdp) {
  const { idData, bgData } = makeMasks()
  const netSpec = generateNetwork({
    idData,
    bgData,
    width: W,
    height: H,
    density: 1,
    seed: 42,
    rSom: 3,
  })
  console.log(
    `\n=== ${label} (stdp=${stdp}) === neurons=${netSpec.n} synapses=${netSpec.m} perRegion=${netSpec.regionCount}`,
  )

  const net = new NeuronNetwork({
    types: netSpec.typeIdx,
    inh: netSpec.inh,
    iBase: netSpec.iBase,
    pre: netSpec.pre,
    post: netSpec.post,
    w: netSpec.w,
    delayMs: netSpec.delayMs,
    stdp,
  })

  const winMs = 1000
  const winSteps = Math.round(winMs / DT)
  let totalSpikes = 0
  let allFinite = true
  const regionSpk = new Float64Array(REGION_NAMES.length)
  for (let s = 0; s < 5; s++) {
    const spikes = net.runSteps(winSteps)
    const cnt = spikes.length / 2
    totalSpikes += cnt
    if (s >= 3) {
      for (let k = 0; k < spikes.length; k += 2) regionSpk[netSpec.region[spikes[k]]]++
    }
    if (s === 4) {
      for (let i = 0; i < net.n; i++) {
        if (!Number.isFinite(net.v[i]) || !Number.isFinite(net.u[i])) allFinite = false
      }
    }
    console.log(
      `  t=${(s + 1) * winMs}ms  spikes/s=${cnt.toFixed(0)}  meanV=${(
        net.v.reduce((a, b) => a + b, 0) / net.n
      ).toFixed(1)}`,
    )
  }

  let wSum = 0
  let wMin = Infinity
  let wMax = -Infinity
  for (let k = 0; k < net.m; k++) {
    wSum += net.w[k]
    if (net.w[k] < wMin) wMin = net.w[k]
    if (net.w[k] > wMax) wMax = net.w[k]
  }
  console.log(
    `  meanRate=${(totalSpikes / 5 / net.n).toFixed(2)} Hz  finite=${allFinite}  wMean=${(
      wSum / Math.max(1, net.m)
    ).toFixed(4)}  wRange=[${wMin.toFixed(4)}, ${wMax.toFixed(4)}]`,
  )
  const regionRates = REGION_NAMES.map((name, r) => {
    const count = netSpec.regionCount[r] || 0
    if (!count) return `${name}=-`
    return `${name}=${(regionSpk[r] / 2 / count).toFixed(1)}Hz`
  })
  console.log(`  rates: ${regionRates.join('  ')}`)
}

runCase('baseline', false)
runCase('learning', true)
