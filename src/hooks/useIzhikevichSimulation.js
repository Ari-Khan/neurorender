import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PARAMS, izhikevichStep } from '../sim/izhikevich'
import { beginRun, endRun, pushSpike, recordFrame, simData } from '../sim/simData'

const MAX_FRAME_ELAPSED = 100
const MAX_STEPS_PER_FRAME = 1000

function hash01(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

// Stimulus spec: { kind: 'rest'|'light'|'chemA'|'chemB', side, label }.
// Mirrors the Python trial builder (neurorender/stimuli.py): light and
// excitatory chem inject current into afferents on one side, chemB is
// inhibitory. Afferents are the outer-nerve layer (layer 2); the side
// comes from the neuron's world x coordinate.
export function driveFor(node, index, stimulus) {
  const base = 6 * (0.72 + 0.56 * hash01(index + 13))
  const spec = stimulus && typeof stimulus === 'object' ? stimulus : null
  if (!spec || spec.kind === 'rest') return base
  const isAfferent = node.layer === 2
  if (!isAfferent) return base
  const x = node.position?.x ?? 0
  const sideMatch = spec.side === 'all'
    || (spec.side === 'left' && x < 0)
    || (spec.side === 'right' && x >= 0)
  if (!sideMatch) return base
  if (spec.kind === 'light') return base + 9
  if (spec.kind === 'chemA') return base + 7
  if (spec.kind === 'chemB') return base - 4
  return base
}

function stimulusLabel(stimulus) {
  if (stimulus && typeof stimulus === 'object') return stimulus.label || stimulus.kind || '—'
  return stimulus
}

export default function useIzhikevichSimulation({
  nodes = [],
  connections = [],
  enabled = false,
  dt = 0.5,
  couplingStrength = 0.01,
  stimulus = 0,
  speed = 1,
}) {
  const [running, setRunning] = useState(false)
  const simRef = useRef({
    v: [],
    u: [],
    drive: [],
    params: [],
    spikeTimes: [],
    time: 0,
  })
  const spikeTimesRef = useRef([])
  const frameRef = useRef(null)
  const lastStepRef = useRef(0)
  const stepAccumRef = useRef(0)
  const stepRef = useRef(null)
  const stimulusRef = useRef(stimulus)

  useEffect(() => {
    stimulusRef.current = stimulus
  }, [stimulus])

  const initState = useCallback(
    (paramsPerNeuron) => {
      const count = nodes.length
      const sim = simRef.current
      const v = new Array(count)
      const u = new Array(count)
      const drive = new Array(count)
      const params = new Array(count)
        .fill(null)
        .map((_, i) => paramsPerNeuron[i] || DEFAULT_PARAMS)
      const spikeTimes = new Array(count).fill(0)
      for (let i = 0; i < count; i += 1) {
        const r = hash01(i + 1)
        v[i] = -66 + r * 5
        u[i] = params[i].b * v[i] + (hash01(i + 7) - 0.5) * 2
        drive[i] = driveFor(nodes[i] || { layer: 0, position: null }, i, stimulusRef.current)
      }
      sim.v = v
      sim.u = u
      sim.drive = drive
      sim.params = params
      sim.spikeTimes = spikeTimes
      sim.time = 0
      spikeTimesRef.current = spikeTimes
      stepAccumRef.current = 0
      beginRun({
        neuronCount: count,
        spikeCounts: new Int32Array(count),
        firstSpike: new Float64Array(count),
        lastSpike: new Float64Array(count),
        spikeTimes,
        params,
        drive,
        v,
        u,
        stimulus: stimulusLabel(stimulusRef.current),
        coupling: couplingStrength,
        dt,
        speed,
      })
      setRunning(true)
    },
    [nodes, couplingStrength, dt, speed],
  )

  // Re-apply drive live when the stimulus changes mid-run (no restart).
  useEffect(() => {
    const sim = simRef.current
    if (sim.drive.length === 0 || sim.drive.length !== nodes.length) return
    for (let i = 0; i < nodes.length; i += 1) {
      sim.drive[i] = driveFor(nodes[i] || { layer: 0, position: null }, i, stimulus)
    }
    simData.stimulus = stimulusLabel(stimulus)
  }, [stimulus, nodes])

  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    endRun()
    setRunning(false)
  }, [])

  const step = useCallback(
    (now) => {
      if (!enabled) {
        stop()
        return
      }
      if (lastStepRef.current === 0) lastStepRef.current = now
      const elapsed = Math.min(now - lastStepRef.current, MAX_FRAME_ELAPSED)
      lastStepRef.current = now
      if (nodes.length === 0) {
        frameRef.current = requestAnimationFrame(stepRef.current)
        return
      }
      stepAccumRef.current = Math.min(
        stepAccumRef.current + elapsed * speed,
        MAX_STEPS_PER_FRAME * dt,
      )
      const steps = Math.floor(stepAccumRef.current / dt)
      if (steps <= 0) {
        frameRef.current = requestAnimationFrame(stepRef.current)
        return
      }
      stepAccumRef.current -= steps * dt
      const sim = simRef.current
      const vArr = sim.v
      const uArr = sim.u
      const drive = sim.drive
      const params = sim.params
      const spikeTimes = sim.spikeTimes
      const neighborMap = new Map()
      connections.forEach((conn) => {
        const [a, b] = conn.split('-')
        const ai = parseInt(a)
        const bi = parseInt(b)
        if (isNaN(ai) || isNaN(bi)) return
        if (!neighborMap.has(ai)) neighborMap.set(ai, [])
        if (!neighborMap.has(bi)) neighborMap.set(bi, [])
        neighborMap.get(ai).push(bi)
        neighborMap.get(bi).push(ai)
      })
      let simTime = sim.time
      for (let sStep = 0; sStep < steps; sStep += 1) {
        simTime += dt / 1000
        for (let i = 0; i < nodes.length; i += 1) {
          const noise = (hash01(i * 3.1 + simTime * 17.3) - 0.5) * 3
          let I = drive[i] + noise
          const neighbors = neighborMap.get(i)
          if (neighbors) {
            for (let ni = 0; ni < neighbors.length; ni += 1) {
              const j = neighbors[ni]
              I += couplingStrength * (vArr[j] - vArr[i])
            }
          }
          const p = params[i] || DEFAULT_PARAMS
          const res = izhikevichStep(vArr[i], uArr[i], p.a, p.b, p.c, p.d, I, dt)
          vArr[i] = res.v
          uArr[i] = res.u
          if (res.spiked) {
            const tMs = simTime * 1000
            spikeTimes[i] = tMs
            pushSpike(i, tMs)
          }
        }
      }
      sim.time = simTime
      recordFrame(simTime * 1000, speed)
      frameRef.current = requestAnimationFrame(stepRef.current)
    },
    [enabled, dt, couplingStrength, speed, nodes.length, connections, stop],
  )

  useEffect(() => {
    stepRef.current = step
  }, [step])

  useEffect(() => {
    if (!enabled) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      endRun()
      return undefined
    }
    if (frameRef.current) return undefined
    lastStepRef.current = 0
    stepAccumRef.current = 0
    frameRef.current = requestAnimationFrame(stepRef.current)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [enabled])

  const getTime = useCallback(() => simRef.current.time, [])

  return {
    spikeTimes: spikeTimesRef,
    running,
    init: initState,
    stop,
    getTime,
  }
}
