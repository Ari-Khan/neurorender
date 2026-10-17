export const TYPE_ORDER = ['RS', 'IB', 'CH', 'FS', 'LTS']

export const CELL_TYPES = {
  RS: { a: 0.02, b: 0.2, c: -65, d: 8 },
  IB: { a: 0.02, b: 0.2, c: -55, d: 4 },
  CH: { a: 0.02, b: 0.2, c: -50, d: 2 },
  FS: { a: 0.1, b: 0.2, c: -65, d: 2 },
  LTS: { a: 0.02, b: 0.25, c: -65, d: 2 },
}

export const DT = 0.5

const V_TH = 30
const E_EXC = 0
const E_INH = -70
const TAU_PRE = 20
const TAU_POST = 20
const A_PLUS = 0.008
const A_MINUS = 0.01
const W_MAX_EXC = 0.25
const W_MAX_INH = 0.4
const W_MIN = 0.005
const INJ_DECAY = Math.exp(-DT / 6)

export class NeuronNetwork {
  constructor({
    types,
    inh,
    iBase,
    pre,
    post,
    w,
    delayMs,
    stdp = false,
    noise = { p: 0.008, amp: 12 },
  }) {
    const n = types.length
    const m = pre.length
    if (n === 0) throw new Error('network needs at least one neuron')
    if (post.length !== m || w.length !== m || delayMs.length !== m) {
      throw new Error('synapse arrays must have equal length')
    }

    this.n = n
    this.m = m
    this.stdp = stdp
    this.noise = noise

    this.a = new Float32Array(n)
    this.b = new Float32Array(n)
    this.c = new Float32Array(n)
    this.d = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = CELL_TYPES[TYPE_ORDER[types[i]]] ?? CELL_TYPES.RS
      this.a[i] = t.a
      this.b[i] = t.b
      this.c[i] = t.c
      this.d[i] = t.d
    }

    this.iBase = iBase.slice()
    this.inh = inh
    this.pre = pre
    this.post = post
    this.w = w.slice()
    this.w0 = w.slice()

    this.synE = new Float32Array(m)
    for (let k = 0; k < m; k++) {
      this.synE[k] = inh[pre[k]] ? E_INH : E_EXC
    }

    this.delaySteps = new Uint32Array(m)
    let maxDelay = 1
    for (let k = 0; k < m; k++) {
      const s = Math.max(1, Math.round(delayMs[k] / DT))
      this.delaySteps[k] = s
      if (s > maxDelay) maxDelay = s
    }
    this.q = maxDelay + 1
    this.buckets = Array.from({ length: this.q }, () => [])

    this.outPtr = new Int32Array(n + 1)
    this.inPtr = new Int32Array(n + 1)
    for (let k = 0; k < m; k++) {
      this.outPtr[pre[k] + 1]++
      this.inPtr[post[k] + 1]++
    }
    for (let i = 0; i < n; i++) {
      this.outPtr[i + 1] += this.outPtr[i]
      this.inPtr[i + 1] += this.inPtr[i]
    }
    const outFill = Int32Array.from(this.outPtr.subarray(0, n))
    const inFill = Int32Array.from(this.inPtr.subarray(0, n))
    this.outIdx = new Int32Array(m)
    this.inIdx = new Int32Array(m)
    for (let k = 0; k < m; k++) {
      this.outIdx[outFill[pre[k]]++] = k
      this.inIdx[inFill[post[k]]++] = k
    }

    this.v = new Float32Array(n)
    this.u = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      this.v[i] = this.c[i]
      this.u[i] = this.b[i] * this.c[i]
    }

    this.isyn = new Float32Array(n)
    this.inj = new Float32Array(n)
    this.preTrace = new Float32Array(n)
    this.postTrace = new Float32Array(n)

    this._kPre = Math.exp(-DT / TAU_PRE)
    this._kPost = Math.exp(-DT / TAU_POST)
    this._spikes = []
    this.stepIdx = 0
  }

  poke(ids, amp = 40) {
    for (let j = 0; j < ids.length; j++) {
      const i = ids[j]
      if (i >= 0 && i < this.n) this.inj[i] += amp
    }
  }

  reset() {
    for (let i = 0; i < this.n; i++) {
      this.v[i] = this.c[i]
      this.u[i] = this.b[i] * this.c[i]
      this.inj[i] = 0
      this.preTrace[i] = 0
      this.postTrace[i] = 0
    }
    this.w.set(this.w0)
    for (let q = 0; q < this.q; q++) this.buckets[q].length = 0
    this.isyn.fill(0)
    this.stepIdx = 0
    this._spikes.length = 0
  }

  step() {
    const n = this.n
    const v = this.v
    const u = this.u
    const a = this.a
    const b = this.b
    const c = this.c
    const d = this.d
    const iBase = this.iBase
    const isyn = this.isyn
    const inj = this.inj
    const buckets = this.buckets
    const q = this.q
    const stepIdx = this.stepIdx

    const bkt = buckets[stepIdx % q]
    for (let k = 0; k < bkt.length; k += 3) {
      const post = bkt[k]
      isyn[post] += bkt[k + 1] * (bkt[k + 2] - v[post])
    }
    bkt.length = 0

    const stdp = this.stdp
    const preTrace = this.preTrace
    const postTrace = this.postTrace
    if (stdp) {
      const kp = this._kPre
      const ko = this._kPost
      for (let i = 0; i < n; i++) {
        preTrace[i] *= kp
        postTrace[i] *= ko
      }
    }

    const noiseP = this.noise.p * DT
    const noiseAmp = this.noise.amp
    const spikes = this._spikes

    for (let i = 0; i < n; i++) {
      let I = iBase[i] + isyn[i] + inj[i]
      inj[i] *= INJ_DECAY
      if (Math.random() < noiseP) I += noiseAmp

      const v0 = v[i]
      let vm = v0 + DT * (0.04 * v0 * v0 + 5 * v0 + 140 - u[i] + I)
      let um = u[i] + DT * a[i] * (b[i] * vm - u[i])

      if (vm >= V_TH) {
        spikes.push(i, stepIdx)
        vm = c[i]
        um += d[i]

        for (let e = this.outPtr[i]; e < this.outPtr[i + 1]; e++) {
          const k = this.outIdx[e]
          buckets[(stepIdx + this.delaySteps[k]) % q].push(
            this.post[k],
            this.w[k],
            this.synE[k],
          )
        }

        if (stdp) {
          const isExcPre = !this.inh[i]
          if (isExcPre) {
            const w = this.w
            for (let e = this.outPtr[i]; e < this.outPtr[i + 1]; e++) {
              const k = this.outIdx[e]
              if (this.synE[k] === E_EXC) {
                w[k] -= A_MINUS * postTrace[this.post[k]]
                if (w[k] < W_MIN) w[k] = W_MIN
                else if (w[k] > W_MAX_EXC) w[k] = W_MAX_EXC
              }
            }
          }
          const w2 = this.w
          for (let e = this.inPtr[i]; e < this.inPtr[i + 1]; e++) {
            const k = this.inIdx[e]
            if (this.synE[k] === E_EXC) {
              w2[k] += A_PLUS * preTrace[this.pre[k]]
              if (w2[k] < W_MIN) w2[k] = W_MIN
              else if (w2[k] > W_MAX_EXC) w2[k] = W_MAX_EXC
            }
          }
          preTrace[i] = 1
          postTrace[i] = 1
        }
      }

      if (!(vm > -500 && vm < 500)) vm = c[i]
      v[i] = vm
      u[i] = um
    }

    isyn.fill(0)
    this.stepIdx = stepIdx + 1
  }

  runSteps(steps) {
    this._spikes.length = 0
    for (let s = 0; s < steps; s++) this.step()
    return Int32Array.from(this._spikes)
  }

  get voltages() {
    return this.v.slice()
  }

  simTimeMs() {
    return this.stepIdx * DT
  }
}
