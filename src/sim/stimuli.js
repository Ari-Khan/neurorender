// Extracellular chemical stimuli layered on top of the Izhikevich model.
// Sodium shifts the driving force, potassium depolarises and can block, and
// TTX blocks the voltage-gated sodium channels. All three feed I_eff and v_peak.

// Selectable stimuli for the panel.
export const STIMULI_OPTIONS = [
  { id: 'none', label: 'No stimuli' },
  { id: 'sodium', label: 'Sodium (extracellular Na⁺)' },
  { id: 'potassium', label: 'Potassium (extracellular K⁺)' },
  { id: 'ttx', label: 'TTX (tetrodotoxin)' },
]

// Per-option slider range plus a short explanation of the expected behaviour.
export const STIMULI_INFO = {
  none: {
    summary: 'Baseline behaviour — no chemical modulation applied.',
  },
  sodium: {
    summary: 'Lower outside Na⁺ weakens and slows spikes until spread fails; higher Na⁺ makes them slightly bigger.',
    min: 0.1,
    max: 2,
    step: 0.05,
    format: (value) => `ρ = ${value.toFixed(2)}`,
  },
  potassium: {
    summary: 'Raising K⁺ first makes neurons fire more, then depolarisation block silences them; lowering it quiets them.',
    min: 0.1,
    max: 5,
    step: 0.05,
    format: (value) => `ρ = ${value.toFixed(2)}`,
  },
  ttx: {
    summary: 'Blocks sodium channels: spikes shrink, then stop past the safety factor. Wash out (0) to recover.',
    min: 0,
    max: 1,
    step: 0.05,
    format: (value) => `${value.toFixed(2)} μM`,
  },
}

// Baseline chemical state; only the selected option is active.
export const DEFAULT_STIMULI = {
  type: 'none',
  sodium: 1,
  potassium: 1,
  ttx: 0,
}

// Physiology constants (assumed where the model needs a concrete number).
export const E_NA_REF = 55 // sodium reversal at baseline (mV)
export const V_REST = -65 // resting membrane potential (mV)
export const V_PEAK_REF = 30 // baseline spike peak (mV)
export const KAPPA = 0.15 // how strongly a shift in E_K drives I_K
export const A_CRIT = 0.3 // sodium availability below which spikes die out
export const IC50_TTX = 1 // TTX concentration at half block
export const Z_HALF = -45 // half-activation voltage of the K block gate (mV)
export const Z_SLOPE = 5 // steepness of that gate (mV)
export const Z_TAU = 30 // gate time constant (ms)
export const TTX_K_ON = 0.05 // TTX binding rate

function clamp01(value) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

// Creates the mutable per-run stimulus state carried alongside the simulation.
export function createStimuliState(count) {
  return {
    ttxBlock: 0,
    zinact: new Float32Array(count),
  }
}

// Computes the per-frame derived quantities and advances the slow state.
// Called once per frame (not per substep); mutates `state` in place.
export function computeStimuliFrame(stimuli, state, vArr, count, frameMs) {
  // TTX block relaxes toward its Hill equilibrium, so wash-out recovers on its own.
  const conc = stimuli.type === 'ttx' ? Math.max(0, stimuli.ttx) : 0
  const kOff = TTX_K_ON * IC50_TTX
  const kTotal = TTX_K_ON * conc + kOff
  const blockEq = kTotal > 0 ? (TTX_K_ON * conc) / kTotal : 0
  state.ttxBlock += (blockEq - state.ttxBlock) * (1 - Math.exp(-kTotal * frameMs))
  if (state.ttxBlock < 1e-4) state.ttxBlock = 0
  const aNa = 1 - state.ttxBlock

  // Sodium raises/lowers E_Na, which scales the effective drive and the spike peak.
  let deltaENa = 0
  if (stimuli.type === 'sodium') {
    deltaENa = 58 * Math.log10(Math.max(1e-6, stimuli.sodium))
  }
  const eNa = E_NA_REF + deltaENa
  const fNa = clamp01((eNa - V_REST) / (E_NA_REF - V_REST))

  // Potassium adds a depolarising current; a slow gating variable adds the block.
  let iK = 0
  let potassiumActive = false
  if (stimuli.type === 'potassium') {
    const deltaEK = 58 * Math.log10(Math.max(1e-6, stimuli.potassium))
    iK = KAPPA * deltaEK
    potassiumActive = deltaEK > 0
  }
  if (potassiumActive) {
    const alpha = 1 - Math.exp(-frameMs / Z_TAU)
    const zinact = state.zinact
    for (let i = 0; i < count; i += 1) {
      const zInf = 1 / (1 + Math.exp(-(vArr[i] - Z_HALF) / Z_SLOPE))
      const z = clamp01(zinact[i] + (zInf - zinact[i]) * alpha)
      zinact[i] = z
    }
  }

  // Spike peak drops with the sodium safety factor; below A_CRIT no spike starts.
  const vPeakRef = V_PEAK_REF + deltaENa
  let vPeak = V_REST + aNa * (vPeakRef - V_REST)
  let vCeil = vPeakRef
  if (aNa < A_CRIT) {
    vPeak = Infinity
    vCeil = vPeakRef
  }

  return { fNa, aNa, iK, potassiumActive, vPeak, vCeil }
}
