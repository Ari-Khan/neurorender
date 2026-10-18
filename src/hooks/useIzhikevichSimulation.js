// Drives the Izhikevich simulation: steps everyone in a rAF loop, applies the
// chemical stimuli, and pushes spikes into the shared store.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PARAMS, izhikevichStep } from '../sim/izhikevich'
import { beginRun, endRun, pushSpike, recordFrame } from '../sim/simData'
import {
  DEFAULT_STIMULI,
  computeStimuliFrame,
  createStimuliState,
} from '../sim/stimuli'

// Clamps so a stalled tab doesn't try to simulate a huge backlog at once.
const MAX_FRAME_ELAPSED = 100
const MAX_STEPS_PER_FRAME = 1000

// Cheap deterministic 0..1 noise, used for per-neuron jitter.
function hash01(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

export default function useIzhikevichSimulation({
  nodes = [],
  connections = [],
  enabled = false,
  dt = 0.5,
  couplingStrength = 0.01,
  stimulus = 0,
  speed = 1,
  stimuli = DEFAULT_STIMULI,
}) {
  const [running, setRunning] = useState(false)
  const simRef = useRef({
    v: [],
    u: [],
    drive: [],
    params: [],
    spikeTimes: [],
    time: 0,
    stimuli: createStimuliState(0),
  })
  const spikeTimesRef = useRef([])
  const frameRef = useRef(null)
  const lastStepRef = useRef(0)
  const stepAccumRef = useRef(0)
  const stepRef = useRef(null)

  // (Re)builds all per-neuron state and starts a run.
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
      const baseDrive = stimulus > 0 ? stimulus : 10
      for (let i = 0; i < count; i += 1) {
        const r = hash01(i + 1)
        v[i] = -66 + r * 5
        u[i] = params[i].b * v[i] + (hash01(i + 7) - 0.5) * 2
        drive[i] = baseDrive * (0.72 + 0.56 * hash01(i + 13))
      }
      sim.v = v
      sim.u = u
      sim.drive = drive
      sim.params = params
      sim.spikeTimes = spikeTimes
      sim.time = 0
      sim.stimuli = createStimuliState(count)
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
        stimulus,
        coupling: couplingStrength,
        dt,
        speed,
      })
      setRunning(true)
    },
    [nodes.length, stimulus, couplingStrength, dt, speed],
  )

  // Halts the loop and marks the run stopped in the store.
  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    endRun()
    setRunning(false)
  }, [])

  // One animation frame: figure out how many fixed dt substeps to run, advance
  // the neurons, then schedule the next frame.
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
      // Undirected adjacency list built fresh each frame (cheap, keeps refs simple).
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
      // Chemical modifiers are derived once per frame, not every substep.
      const frameMs = steps * dt
      const { fNa, aNa, iK, potassiumActive, vPeak, vCeil } = computeStimuliFrame(
        stimuli,
        sim.stimuli,
        vArr,
        nodes.length,
        frameMs,
      )
      const zinact = sim.stimuli.zinact
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
          // Sodium/TTX scale the drive; potassium adds a current and gating block.
          I = I * fNa * aNa + iK
          if (potassiumActive) I *= 1 - zinact[i]
          const p = params[i] || DEFAULT_PARAMS
          const res = izhikevichStep(vArr[i], uArr[i], p.a, p.b, p.c, p.d, I, dt, vPeak, vCeil)
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
    [enabled, dt, couplingStrength, speed, nodes.length, connections, stimuli, stop],
  )

  // Keep the rAF callback pointed at the latest step closure.
  useEffect(() => {
    stepRef.current = step
  }, [step])

  // Start/stop the loop when the sim is toggled on or off.
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

  // Current sim clock in seconds; refs stay live across renders.
  const getTime = useCallback(() => simRef.current.time, [])

  return {
    spikeTimes: spikeTimesRef,
    running,
    init: initState,
    stop,
    getTime,
  }
}
