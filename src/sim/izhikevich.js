// Izhikevich (2003) spiking neuron model — presets, ranges, and the step function.

// Named firing patterns; each is just an (a, b, c, d) tuple.
export const IZH_PRESETS = [
  {
    id: 'regular-spiking',
    name: 'Regular Spiking (RS)',
    description: 'Tonic firing with adaptation; common excitatory neuron',
    a: 0.02,
    b: 0.2,
    c: -65,
    d: 8,
  },
  {
    id: 'intrinsically-bursting',
    name: 'Intrinsically Bursting (IB)',
    description: 'Bursts of spikes followed by regular firing',
    a: 0.02,
    b: 0.2,
    c: -55,
    d: 4,
  },
  {
    id: 'chattering',
    name: 'Chattering (CH)',
    description: 'High-frequency bursts (chattering)',
    a: 0.02,
    b: 0.2,
    c: -50,
    d: 2,
  },
  {
    id: 'fast-spiking',
    name: 'Fast Spiking (FS)',
    description: 'Fast, non-adapting spiking (often inhibitory-like)',
    a: 0.1,
    b: 0.2,
    c: -65,
    d: 2,
  },
  {
    id: 'low-threshold-spiking',
    name: 'Low-Threshold Spiking (LTS)',
    description: 'Bursts driven by low threshold',
    a: 0.02,
    b: 0.25,
    c: -65,
    d: 2,
  },
]

export const DEFAULT_PARAMS = IZH_PRESETS[0]

export const IZH_RANGES = {
  a: { min: 0.01, max: 0.2, step: 0.001, label: 'a' },
  b: { min: 0.01, max: 0.3, step: 0.001, label: 'b' },
  c: { min: -90, max: -40, step: 0.5, label: 'c (mV)' },
  d: { min: 0, max: 20, step: 0.1, label: 'd' },
}

export const IZH_DESCRIPTIONS = {
  a: 'Time scale of recovery variable u (smaller = slower adaptation). Higher a means u changes faster.',
  b: 'Sensitivity of u to subthreshold fluctuations (coupling between v and u). Affects resting and rebound.',
  c: 'Reset value of membrane voltage v (mV) after spike.',
  d: 'Increment to recovery variable u after spike (controls post-spike adaptation/bursting).',
}

// Advances one neuron by dt. `v` is membrane voltage, `u` a recovery variable.
// vPeak/vCeil are normally 30 but shift when chemicals move the spike threshold.
export function izhikevichStep(v, u, a, b, c, d, I, dt, vPeak = 30, vCeil = 30) {
  let vv = v
  let uu = u
  let spiked = false
  const dv = 0.04 * vv * vv + 5 * vv + 140 - uu + I
  const du = a * (b * vv - uu)
  vv += dt * dv
  uu += dt * du
  if (vv >= vPeak) {
    vv = c
    uu = uu + d
    spiked = true
  } else if (vv > vCeil) {
    // Holds v at the shifted peak when spikes are suppressed (TTX block).
    vv = vCeil
  }
  return { v: vv, u: uu, spiked }
}

// Gap-junction current: pulls v toward the neighbour's voltage, scaled by g.
export function getCouplingCurrent(v, vj, g) {
  return g * (vj - v)
}
