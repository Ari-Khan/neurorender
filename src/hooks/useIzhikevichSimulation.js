import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PARAMS, izhikevichStep } from '../sim/izhikevich'

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
}) {
  const [state, setState] = useState({
    v: [],
    u: [],
    params: [],
    drive: [],
    spikes: [],
    spikeTimes: [],
    time: 0,
    running: false,
  })
  const stateRef = useRef(state)
  const frameRef = useRef(null)
  const lastStepRef = useRef(0)
  const stepAccumRef = useRef(0)
  const stepRef = useRef(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const initState = useCallback(
    (paramsPerNeuron) => {
      const count = nodes.length
      const v = new Array(count)
      const u = new Array(count)
      const drive = new Array(count)
      const params = new Array(count)
        .fill(null)
        .map((_, i) => paramsPerNeuron[i] || DEFAULT_PARAMS)
      const spikes = new Array(count).fill(false)
      const spikeTimes = new Array(count).fill(0)
      const baseDrive = stimulus > 0 ? stimulus : 10
      for (let i = 0; i < count; i += 1) {
        const r = hash01(i + 1)
        v[i] = -66 + r * 5
        u[i] = params[i].b * v[i] + (hash01(i + 7) - 0.5) * 2
        drive[i] = baseDrive * (0.72 + 0.56 * hash01(i + 13))
      }
      const initial = {
        v,
        u,
        params,
        drive,
        spikes,
        spikeTimes,
        time: 0,
        running: true,
      }
      setState(initial)
      stateRef.current = initial
    },
    [nodes.length, stimulus],
  )

  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    setState((s) => ({ ...s, running: false }))
  }, [])

  const step = useCallback(
    (now) => {
      if (!enabled) {
        stop()
        return
      }
      if (lastStepRef.current === 0) lastStepRef.current = now
      const elapsed = now - lastStepRef.current
      lastStepRef.current = now
      const current = stateRef.current
      if (!current || nodes.length === 0) {
        frameRef.current = requestAnimationFrame(stepRef.current)
        return
      }
      stepAccumRef.current += elapsed * speed
      let steps = Math.floor(stepAccumRef.current / dt)
      if (steps > 40) steps = 40
      if (steps <= 0) {
        frameRef.current = requestAnimationFrame(stepRef.current)
        return
      }
      stepAccumRef.current -= steps * dt
      const vNext = current.v.slice()
      const uNext = current.u.slice()
      const spikesNext = new Array(current.spikes.length).fill(false)
      const spikeTimesNext = current.spikeTimes.slice()
      const timeNext = current.time + (dt * steps) / 1000
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
      let simTime = current.time
      for (let sStep = 0; sStep < steps; sStep += 1) {
        simTime += dt / 1000
        for (let i = 0; i < nodes.length; i += 1) {
          const noise = (hash01(i * 3.1 + simTime * 17.3) - 0.5) * 3
          let I = current.drive[i] + noise
          const neighbors = neighborMap.get(i)
          if (neighbors) {
            for (let ni = 0; ni < neighbors.length; ni += 1) {
              const j = neighbors[ni]
              I += couplingStrength * (vNext[j] - vNext[i])
            }
          }
          const p = current.params[i] || DEFAULT_PARAMS
          const res = izhikevichStep(vNext[i], uNext[i], p.a, p.b, p.c, p.d, I, dt)
          vNext[i] = res.v
          uNext[i] = res.u
          if (res.spiked) {
            spikesNext[i] = true
            spikeTimesNext[i] = now
          }
        }
      }
      setState({
        v: vNext,
        u: uNext,
        params: current.params,
        drive: current.drive,
        spikes: spikesNext,
        spikeTimes: spikeTimesNext,
        time: timeNext,
        running: true,
      })
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

  return {
    ...state,
    init: initState,
    stop,
  }
}
