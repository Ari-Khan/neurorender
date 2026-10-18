// Turns a cleared organism map into a living neuron network with dendrites.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import useIzhikevichSimulation from '../hooks/useIzhikevichSimulation'
import { LAYER_COLORS, setNetworkLayout } from '../sim/simData'
import { DEFAULT_STIMULI } from '../sim/stimuli'

// Layout and look-and-feel tuning for the sampled network.
const LAYER_ALLOCATION = [0.35, 0.4, 0.25]
const LAYER_DENSITY = [1.2, 1.2, 0.8]
const AREA_ALLOCATION_WEIGHT = 0.6
const MIN_LAYER_ALLOCATION = 0.08
const CONNECTION_DISTANCE = [0.028, 0.04, 0.08]
const CROSS_LAYER_DISTANCE = 0.032
const LAYER_ANIMATION_STEPS = 60
const LAYER_FRAME_INTERVAL = 1
const HIGH_CONTRAST_COLORS = ['#ff4d4d', '#4db8ff', '#ff9d3d']
const FLASH_GREEN = new THREE.Color('#39ff14')
const SELECT_PURPLE = new THREE.Color('#b44cff')
const SELECT_PURPLE_HEX = '#b44cff'
const FLASH_DURATION = 100
const FLASH_GLOW_SIZE = 3.6
const SELECT_MARKER_SIZE = FLASH_GLOW_SIZE * 2
const SYNAPSE_SIZE = 0.34
const PICK_MIN_PX = 8
const PICK_SCALE = 1.4

// Scratch color plus a helper for a neuron's resting color.
const baseColorScratch = new THREE.Color()

function layerBaseColor(layer, highContrast) {
  if (highContrast) baseColorScratch.set(HIGH_CONTRAST_COLORS[layer])
  else baseColorScratch.set('#d6d6d6')
  return baseColorScratch
}

// Simple RGB distance, used to sort map pixels into layers.
function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// Cheap deterministic pseudo-random in [0, 1) for stable jitter and noise.
function hash01(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

// Picks a spread-out subset of candidates so neurons don't clump together.
function selectScattered(candidates, count) {
  if (candidates.length <= count) return candidates
  const bounds = candidates.reduce((result, candidate) => ({
    minX: Math.min(result.minX, candidate.x),
    maxX: Math.max(result.maxX, candidate.x),
    minY: Math.min(result.minY, candidate.y),
    maxY: Math.max(result.maxY, candidate.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  })
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  const columns = Math.max(1, Math.round(Math.sqrt(count * width / height)))
  const rows = Math.max(1, Math.ceil(count / columns))
  const buckets = Array.from({ length: columns * rows }, () => [])

  const bucketIndexOf = (candidate) => {
    const column = Math.min(
      columns - 1,
      Math.floor(((candidate.x - bounds.minX) / width) * columns),
    )
    const row = Math.min(
      rows - 1,
      Math.floor(((candidate.y - bounds.minY) / height) * rows),
    )
    return row * columns + column
  }

  candidates.forEach((candidate) => {
    buckets[bucketIndexOf(candidate)].push(candidate)
  })

  const picked = new Set()
  const selected = []
  const pickCounts = Array.from({ length: buckets.length }, () => 0)
  const pickFrom = (bucket, bucketIndex) => {
    if (bucket.length === 0) return false
    const column = bucketIndex % columns
    const row = Math.floor(bucketIndex / columns)
    const targetX = bounds.minX
      + ((column + hash01(bucketIndex * 7 + pickCounts[bucketIndex] + 3)) * width) / columns
    const targetY = bounds.minY
      + ((row + hash01(bucketIndex * 13 + pickCounts[bucketIndex] + 5)) * height) / rows
    let closest = null
    let closestDistance = Infinity
    for (const candidate of bucket) {
      if (picked.has(candidate)) continue
      const distance = (candidate.x - targetX) ** 2 + (candidate.y - targetY) ** 2
      if (distance < closestDistance) {
        closestDistance = distance
        closest = candidate
      }
    }
    if (!closest) return false
    picked.add(closest)
    selected.push(closest)
    pickCounts[bucketIndex] += 1
    return true
  }

  buckets.forEach((bucket, bucketIndex) => pickFrom(bucket, bucketIndex))

  while (selected.length > count) {
    let removeIndex = 0
    let removeScore = -Infinity
    selected.forEach((candidate, index) => {
      const score = hash01(candidate.x * 97 + candidate.y * 31 + index)
      if (score > removeScore) {
        removeScore = score
        removeIndex = index
      }
    })
    const removed = selected[removeIndex]
    picked.delete(removed)
    pickCounts[bucketIndexOf(removed)] -= 1
    selected.splice(removeIndex, 1)
  }

  while (selected.length < count) {
    let bestBucket = -1
    let bestScore = Infinity
    buckets.forEach((bucket, bucketIndex) => {
      let remaining = 0
      bucket.forEach((candidate) => {
        if (!picked.has(candidate)) remaining += 1
      })
      if (remaining === 0) return
      const score = pickCounts[bucketIndex] + hash01(bucketIndex * 17 + 1) * 0.4
      if (score < bestScore) {
        bestScore = score
        bestBucket = bucketIndex
      }
    })
    if (bestBucket < 0 || !pickFrom(buckets[bestBucket], bestBucket)) break
  }

  return selected
}

// Reads the traced map and turns it into node positions across the three layers.
function sampleMask(data, width, height, count, length, depthPercent) {
  const candidates = []
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4
      if (data[index + 3] < 30) continue
      const color = [data[index], data[index + 1], data[index + 2]]
      let layer = 0
      let nearest = colorDistance(color, LAYER_COLORS[0])
      for (let index = 1; index < LAYER_COLORS.length; index += 1) {
        const next = colorDistance(color, LAYER_COLORS[index])
        if (next < nearest) {
          nearest = next
          layer = index
        }
      }
      if (nearest < 120) candidates.push({ x, y, layer })
    }
  }

  if (candidates.length === 0) return []
  const widthInWorld = length * Math.max(0.15, height / width) * 0.75
  const depth = length * Math.max(0.01, depthPercent / 100)
  const layerCandidates = [[], [], []]
  candidates.forEach((candidate) => layerCandidates[candidate.layer].push(candidate))
  const brainOutline = new Uint8Array(width * height)
  for (const candidate of candidates) {
    if (candidate.layer !== 0) continue
    for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
      for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
        const x = candidate.x + offsetX
        const y = candidate.y + offsetY
        if (x >= 0 && x < width && y >= 0 && y < height) {
          brainOutline[y * width + x] = 1
        }
      }
    }
  }
  const outside = new Uint8Array(width * height)
  const queue = []
  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const index = y * width + x
    if (outside[index] || brainOutline[index]) return
    outside[index] = 1
    queue.push(index)
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }
  while (queue.length > 0) {
    const index = queue.pop()
    const x = index % width
    const y = Math.floor(index / width)
    enqueue(x - 1, y)
    enqueue(x + 1, y)
    enqueue(x, y - 1)
    enqueue(x, y + 1)
  }
  for (let y = 1; y < height - 1; y += 2) {
    let left = width
    let right = -1
    for (let x = 1; x < width - 1; x += 1) {
      if (brainOutline[y * width + x]) {
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
    }
    for (let x = 1; x < width - 1; x += 2) {
      const index = y * width + x
      const insideOutline = x > left && x < right
      if (insideOutline && !brainOutline[index]) {
        layerCandidates[0].push({ x, y, layer: 0 })
      }
    }
  }
  const targetCount = Math.min(count, 2500)
  const selected = []
  const presentLayers = layerCandidates
    .map((layer, layerIndex) => ({ layer, layerIndex }))
    .filter(({ layer }) => layer.length > 0)
  const totalArea = presentLayers.reduce(
    (total, { layer, layerIndex }) => total + layer.length * LAYER_DENSITY[layerIndex],
    0,
  )
  const totalBaseline = presentLayers.reduce(
    (total, { layerIndex }) => total + LAYER_ALLOCATION[layerIndex],
    0,
  )
  const allocations = presentLayers.map(({ layer, layerIndex }) => {
    const baselineShare = LAYER_ALLOCATION[layerIndex] / totalBaseline
    const areaShare = (layer.length * LAYER_DENSITY[layerIndex]) / totalArea
    return {
      layer,
      layerIndex,
      share: Math.max(
        MIN_LAYER_ALLOCATION,
        baselineShare * (1 - AREA_ALLOCATION_WEIGHT) + areaShare * AREA_ALLOCATION_WEIGHT,
      ),
    }
  })
  const allocationTotal = allocations.reduce((total, item) => total + item.share, 0)
  const layerCounts = allocations.map(({ layer, share }) => {
    const raw = (targetCount * share) / allocationTotal
    return {
      layer,
      count: Math.min(layer.length, Math.floor(raw)),
      priority: raw - Math.floor(raw),
    }
  })
  let remaining = targetCount - layerCounts.reduce((total, item) => total + item.count, 0)
  while (remaining !== 0) {
    let best = null
    for (const item of layerCounts) {
      if (remaining > 0 && item.count >= item.layer.length) continue
      if (remaining < 0 && item.count <= 0) continue
      if (!best || item.priority > best.priority) best = item
    }
    if (!best) break
    best.count += remaining > 0 ? 1 : -1
    best.priority = remaining > 0 ? -Infinity : Infinity
    remaining += remaining > 0 ? -1 : 1
  }
  layerCounts.forEach(({ layer, count }) => {
    selectScattered(layer, count).forEach((candidate) => {
      selected.push({ candidate, index: selected.length })
    })
  })
  return selected.map(({ candidate, index }) => {
    const jitterX = (hash01(index * 12.9898 + 1) - 0.5) * 4
    const jitterY = (hash01(index * 78.233 + 2) - 0.5) * 4
    const wave = Math.sin(candidate.x * 0.035 + Math.cos(candidate.y * 0.021) * 2.4) * 0.5
    const grain = (hash01(index * 5.19 + 9.7) - 0.5) * 0.4
    return {
      layer: candidate.layer,
      position: new THREE.Vector3(
        (((candidate.x + jitterX) / width) - 0.5) * length,
        (0.5 - (candidate.y + jitterY) / height) * widthInWorld,
        (wave + grain) * depth * 0.5,
      ),
    }
  })
}

// Builds a tapered tube geometry for one dendrite strand.
function createDendriteGeometry(curve, startColor, endColor) {
  const tubularSegments = 8
  const radialSegments = 5
  const radius = 0.045
  const frames = curve.computeFrenetFrames(tubularSegments, false)
  const positions = []
  const indices = []
  const colors = []
  const colorStart = startColor ? new THREE.Color(startColor) : null
  const colorEnd = endColor ? new THREE.Color(endColor) : colorStart
  const shade = new THREE.Color()

  for (let segment = 0; segment <= tubularSegments; segment += 1) {
    const t = segment / tubularSegments
    const center = curve.getPointAt(t)
    const taper = 0.35 + 0.65 * Math.abs(2 * t - 1)
    if (colorStart) shade.copy(colorStart).lerp(colorEnd, t)
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = (radial / radialSegments) * Math.PI * 2
      const offset = frames.normals[segment].clone().multiplyScalar(
        Math.cos(angle) * radius * taper,
      )
      offset.addScaledVector(
        frames.binormals[segment],
        Math.sin(angle) * radius * taper,
      )
      positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z)
      if (colorStart) colors.push(shade.r, shade.g, shade.b)
    }
  }

  for (let segment = 0; segment < tubularSegments; segment += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments
      const currentRow = segment * radialSegments
      const nextRow = (segment + 1) * radialSegments
      indices.push(
        currentRow + radial,
        nextRow + radial,
        currentRow + next,
        currentRow + next,
        nextRow + radial,
        nextRow + next,
      )
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colorStart) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Pushes each layer apart along Z when the layers toggle flips.
function layerOffset(node, separation, depth, length) {
  return (node.layer - 1) * separation * Math.max(depth * 0.8, length * 0.12)
}

// Node position in world space, including the current layer separation.
function worldPosition(node, separation, depth, length) {
  const position = node.position.clone()
  position.z += layerOffset(node, separation, depth, length)
  return position
}

// Key for the spatial grid used when wiring up dendrites.
function spatialKey(x, y, z) {
  return `${x},${y},${z}`
}

// A single dendrite strand linking two neurons.
const DendriteLink = memo(function DendriteLink({ connection, nodes, separation, depth, length, highContrast }) {
  const [startIndex, endIndex] = connection.split('-').map(Number)
  const startLayer = nodes[startIndex].layer
  const endLayer = nodes[endIndex].layer
  const geometry = useMemo(() => {
    const start = worldPosition(nodes[startIndex], separation, depth, length)
    const end = worldPosition(nodes[endIndex], separation, depth, length)
    const midpoint = start.clone().lerp(end, 0.5)
    midpoint.y += Math.sin(endIndex * 1.7) * 0.35
    const curve = new THREE.CatmullRomCurve3([start, midpoint, end])
    if (!highContrast) return createDendriteGeometry(curve)
    return createDendriteGeometry(
      curve,
      HIGH_CONTRAST_COLORS[startLayer],
      HIGH_CONTRAST_COLORS[endLayer],
    )
  }, [nodes, separation, depth, length, highContrast, startIndex, endIndex, startLayer, endLayer])

  return (
    <mesh>
      <primitive object={geometry} attach="geometry" />
      <meshBasicMaterial
        key={highContrast ? 'high' : 'normal'}
        color={highContrast ? '#ffffff' : '#9b9b9b'}
        vertexColors={highContrast}
        transparent
        opacity={highContrast ? 0.9 : 0.42}
      />
    </mesh>
  )
})

// Figures out which neurons connect, then fades the dendrites in slowly.
function NetworkLinks({
  nodes,
  separation,
  depth,
  length,
  highContrast,
  onLoadingChange,
  onNetworkStats,
}) {
  const connections = useMemo(() => {
    const connections = new Set()
    const worldPositions = nodes.map((node) => worldPosition(node, 0, depth, length))
    const cellSize = length * Math.max(...CONNECTION_DISTANCE)
    const cells = new Map()
    worldPositions.forEach((position, index) => {
      const cell = [
        Math.floor(position.x / cellSize),
        Math.floor(position.y / cellSize),
        Math.floor(position.z / cellSize),
      ]
      const key = spatialKey(cell[0], cell[1], cell[2])
      const members = cells.get(key) || []
      members.push(index)
      cells.set(key, members)
    })
    for (let first = 0; first < nodes.length; first += 1) {
      const position = worldPositions[first]
      const cellX = Math.floor(position.x / cellSize)
      const cellY = Math.floor(position.y / cellSize)
      const cellZ = Math.floor(position.z / cellSize)
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            const members = cells.get(spatialKey(
              cellX + offsetX,
              cellY + offsetY,
              cellZ + offsetZ,
            ))
            if (!members) continue
            for (const second of members) {
              if (second <= first) continue
              const sameLayer = nodes[first].layer === nodes[second].layer
              const threshold = length * (
                sameLayer
                  ? CONNECTION_DISTANCE[nodes[first].layer]
                  : CROSS_LAYER_DISTANCE
              )
              if (position.distanceTo(worldPositions[second]) <= threshold) {
                connections.add(`${first}-${second}`)
              }
            }
          }
        }
      }
    }
    const linked = new Array(nodes.length).fill(false)
    connections.forEach((connection) => {
      const [first, second] = connection.split('-').map(Number)
      linked[first] = true
      linked[second] = true
    })
    nodes.forEach((_, first) => {
      if (linked[first]) return
      let best = -1
      let bestDistance = Infinity
      nodes.forEach((_, second) => {
        if (second === first) return
        const distance = worldPositions[first].distanceToSquared(worldPositions[second])
        if (distance < bestDistance) {
          bestDistance = distance
          best = second
        }
      })
      if (best >= 0) {
        connections.add(`${Math.min(first, best)}-${Math.max(first, best)}`)
        linked[first] = true
        linked[best] = true
      }
    })
    const parents = nodes.map((_, index) => index)
    const find = (index) => {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]]
        index = parents[index]
      }
      return index
    }
    const union = (first, second) => {
      const firstRoot = find(first)
      const secondRoot = find(second)
      if (firstRoot === secondRoot) return false
      parents[secondRoot] = firstRoot
      return true
    }
    connections.forEach((connection) => {
      const [first, second] = connection.split('-').map(Number)
      union(first, second)
    })
    while (new Set(parents.map((_, index) => find(index))).size > 1) {
      let bestFirst = -1
      let bestSecond = -1
      let bestDistance = Infinity
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          if (find(first) === find(second)) continue
          const distance = worldPositions[first].distanceToSquared(worldPositions[second])
          if (distance < bestDistance) {
            bestFirst = first
            bestSecond = second
            bestDistance = distance
          }
        }
      }
      if (bestFirst < 0) break
      connections.add(`${bestFirst}-${bestSecond}`)
      union(bestFirst, bestSecond)
    }
    return Array.from(connections)
  }, [nodes, depth, length])

  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    onNetworkStats?.({ neurons: nodes.length, dendrites: connections.length })
    onLoadingChange?.(connections.length > 0)
    if (connections.length === 0) {
      onLoadingChange?.(false)
      return undefined
    }
    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(connections.length, current + 12)
        if (next === connections.length) onLoadingChange?.(false)
        return next
      })
    }, 24)
    return () => window.clearInterval(timer)
  }, [connections, nodes.length, onLoadingChange, onNetworkStats])

  return (
    <group>
      {connections.slice(0, visibleCount).map((connection) => (
        <DendriteLink
          key={connection}
          connection={connection}
          nodes={nodes}
          separation={separation}
          depth={depth}
          length={length}
          highContrast={highContrast}
        />
      ))}
    </group>
  )
}

// The whole neuron network: samples the organism, animates layers, runs the sim.
export default function NeuronNetwork({
  organism,
  layersSeparated = false,
  highContrast = false,
  simulationEnabled = false,
  simulationParams = null,
  simulationSpeed = 1,
  stimuli = DEFAULT_STIMULI,
  selectedNeuron = null,
  onSelectNeuron = null,
  onLoadingChange,
  onLayerLoading,
  onNetworkStats,
}) {
  // Sampled nodes plus the animated layer separation value.
  const [nodes, setNodes] = useState([])
  const [separation, setSeparation] = useState(0)
  const separationRef = useRef(0)
  const layerFrameRef = useRef(0)
  const layerLoadingRef = useRef(false)
  const depth = organism.length * Math.max(0.01, organism.depthPercent / 100)
  // Eases the layers apart or back together when the toggle changes.
  useFrame(() => {
    const target = layersSeparated ? 1 : 0
    const current = separationRef.current
    if (current === target) {
      layerFrameRef.current = 0
      if (layerLoadingRef.current) {
        layerLoadingRef.current = false
        onLayerLoading?.(false)
      }
      return
    }

    if (!layerLoadingRef.current) {
      layerLoadingRef.current = true
      onLayerLoading?.(true)
    }
    layerFrameRef.current += 1
    if (layerFrameRef.current < LAYER_FRAME_INTERVAL) return

    layerFrameRef.current = 0
    const direction = target > current ? 1 : -1
    const step = 1 / LAYER_ANIMATION_STEPS
    const next = Math.abs(target - current) <= step
      ? target
      : current + direction * step
    separationRef.current = next
    setSeparation(next)
    if (next === target) {
      layerLoadingRef.current = false
      onLayerLoading?.(false)
    }
  })

  // Loads the organism drawing and samples it into nodes.
  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const next = sampleMask(
        pixels.data,
        canvas.width,
        canvas.height,
        organism.neuronCount,
        organism.length,
        organism.depthPercent,
      )
      if (!cancelled) setNodes(next)
    }
    image.src = organism.drawing
    return () => {
      cancelled = true
    }
  }, [organism])

  // Mirrors the sampled layout into the shared stats store.
  useEffect(() => {
    const count = nodes.length
    const layers = new Int8Array(count)
    const positions = new Float32Array(count * 3)
    const layerCounts = [0, 0, 0]
    for (let i = 0; i < count; i += 1) {
      const node = nodes[i]
      layers[i] = node.layer
      layerCounts[node.layer] += 1
      positions[i * 3] = node.position.x
      positions[i * 3 + 1] = node.position.y
      positions[i * 3 + 2] = node.position.z
    }
    setNetworkLayout({ layers, positions, layerCounts, neuronCount: count })
  }, [nodes])

  // Cached node positions for the distance-based wiring below.
  const worldPositions = useMemo(() => nodes.map((node) => node.position), [nodes])
  // Links every neuron to its nearest neighbor for the simulation graph.
  const simulationConnections = useMemo(() => {
    if (nodes.length === 0) return []
    const connectionsSet = new Set()
    for (let i = 0; i < nodes.length; i += 1) {
      let bestJ = -1
      let bestDist = Infinity
      for (let j = i + 1; j < nodes.length; j += 1) {
        const d = worldPositions[i].distanceToSquared(worldPositions[j])
        if (d < bestDist) {
          bestDist = d
          bestJ = j
        }
      }
      if (bestJ >= 0) connectionsSet.add(`${i}-${bestJ}`)
    }
    return Array.from(connectionsSet)
  }, [nodes, worldPositions])

  // Hook that steps the Izhikevich model and records every spike.
  const simulation = useIzhikevichSimulation({
    nodes,
    connections: simulationConnections,
    enabled: simulationEnabled,
    speed: simulationSpeed,
    stimulus: 4,
    couplingStrength: 0.02,
    stimuli,
  })

  // Starts a fresh run whenever the sim turns on or the params change.
  const { init: initSim, getTime } = simulation
  useEffect(() => {
    if (!simulationEnabled) return
    if (nodes.length === 0) return
    const paramsPerNeuron = nodes.map(() => simulationParams || null)
    initSim(paramsPerNeuron)
  }, [simulationEnabled, nodes, simulationParams, initSim])

  const spikeTimesRef = simulation.spikeTimes

  // Soft radial sprite reused by the spike flashes and the selection marker.
  const glowTexture = useMemo(() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.72)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.26)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // Point buffers for the neurons plus the additive glow layer.
  const { pointGeometry, glowGeometry } = useMemo(() => {
    const pos = new Float32Array(nodes.length * 3)
    const colors = new Float32Array(nodes.length * 3)
    const baseColors = new Float32Array(nodes.length * 3)
    const glowColors = new Float32Array(nodes.length * 3)
    const base = new THREE.Color()
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      const position = node.position.clone()
      position.z += layerOffset(node, separation, depth, organism.length)
      pos[i * 3] = position.x
      pos[i * 3 + 1] = position.y
      pos[i * 3 + 2] = position.z

      if (highContrast) base.set(HIGH_CONTRAST_COLORS[node.layer])
      else base.set('#d6d6d6')
      colors[i * 3] = base.r
      colors[i * 3 + 1] = base.g
      colors[i * 3 + 2] = base.b
      baseColors[i * 3] = base.r
      baseColors[i * 3 + 1] = base.g
      baseColors[i * 3 + 2] = base.b
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.setAttribute('baseColor', new THREE.BufferAttribute(baseColors, 3))
    const glow = new THREE.BufferGeometry()
    glow.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3))
    glow.setAttribute('color', new THREE.BufferAttribute(glowColors, 3))
    return { pointGeometry: geom, glowGeometry: glow }
  }, [nodes, separation, depth, organism.length, highContrast])

  // Refs to the rendered objects we mutate during the frame loop.
  const pointsRef = useRef(null)
  const glowRef = useRef(null)
  const highlightRef = useRef(null)
  // Tracks what the color buffers currently hold so we only repaint on change.
  const flashActiveRef = useRef(false)
  const appliedSelRef = useRef(null)
  const appliedGeomRef = useRef(null)

  // Screen-space picking: grabs whichever neuron sits nearest the cursor in 2D.
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const element = gl.domElement
    const down = { x: 0, y: 0, button: 0, active: false }
    const onPointerDown = (event) => {
      down.x = event.clientX
      down.y = event.clientY
      down.button = event.button
      down.active = true
    }
    const onPointerCancel = () => {
      down.active = false
    }
    const onPointerUp = (event) => {
      if (!down.active) return
      down.active = false
      if (down.button !== 0 || event.button !== 0) return
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return
      const points = pointsRef.current
      const attribute = points?.geometry?.attributes?.position
      if (!attribute) return
      points.updateWorldMatrix(true, false)
      const rect = element.getBoundingClientRect()
      const width = rect.width || 1
      const height = rect.height || 1
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad((camera.fov || 55) * 0.5))
      const array = attribute.array
      const count = attribute.count
      const v = new THREE.Vector3()
      let best = -1
      let bestDist2 = Infinity
      let bestDepth = Infinity
      for (let i = 0; i < count; i += 1) {
        const i3 = i * 3
        v.set(array[i3], array[i3 + 1], array[i3 + 2])
        v.applyMatrix4(points.matrixWorld)
        const dist = v.distanceTo(camera.position)
        if (dist <= 0.0001) continue
        const radiusPx = (SYNAPSE_SIZE * 0.5 * height) / (2 * tanHalfFov * dist)
        const thresholdPx = Math.max(PICK_MIN_PX, radiusPx * PICK_SCALE)
        v.project(camera)
        if (v.z < -1 || v.z > 1) continue
        const sx = (v.x * 0.5 + 0.5) * width
        const sy = (0.5 - v.y * 0.5) * height
        const dx = sx - mouseX
        const dy = sy - mouseY
        const dist2 = dx * dx + dy * dy
        if (dist2 > thresholdPx * thresholdPx) continue
        if (dist2 < bestDist2 - 1 || (dist2 <= bestDist2 + 1 && v.z < bestDepth)) {
          best = i
          bestDist2 = dist2
          bestDepth = v.z
        }
      }
      if (best < 0) return
      onSelectNeuron?.(best === selectedNeuron ? null : best)
    }
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerCancel)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [camera, gl, nodes, selectedNeuron, onSelectNeuron])

  // Per-frame update: selection highlight, spike flashes, and glow.
  useFrame(() => {
    const points = pointsRef.current
    const glow = glowRef.current
    if (!points || !glow) return
    const currentPointGeometry = points.geometry
    const currentGlowGeometry = glow.geometry
    const selected = selectedNeuron != null
      && selectedNeuron >= 0
      && selectedNeuron < nodes.length
      ? selectedNeuron
      : null
    if (appliedSelRef.current !== selected || appliedGeomRef.current !== currentPointGeometry) {
      const baseAttr = currentPointGeometry.attributes.baseColor
      const colorAttr = currentPointGeometry.attributes.color
      const baseArr = baseAttr.array
      const colorArr = colorAttr.array
      const sameGeometry = appliedGeomRef.current === currentPointGeometry
      const previous = appliedSelRef.current
      if (sameGeometry && previous != null && previous !== selected
        && previous * 3 + 2 < baseArr.length) {
        const shade = layerBaseColor(nodes[previous].layer, highContrast)
        baseArr[previous * 3] = shade.r
        baseArr[previous * 3 + 1] = shade.g
        baseArr[previous * 3 + 2] = shade.b
        colorArr[previous * 3] = shade.r
        colorArr[previous * 3 + 1] = shade.g
        colorArr[previous * 3 + 2] = shade.b
      }
      if (selected != null) {
        const i3 = selected * 3
        baseArr[i3] = SELECT_PURPLE.r
        baseArr[i3 + 1] = SELECT_PURPLE.g
        baseArr[i3 + 2] = SELECT_PURPLE.b
        colorArr[i3] = SELECT_PURPLE.r
        colorArr[i3 + 1] = SELECT_PURPLE.g
        colorArr[i3 + 2] = SELECT_PURPLE.b
      }
      baseAttr.needsUpdate = true
      colorAttr.needsUpdate = true
      appliedSelRef.current = selected
      appliedGeomRef.current = currentPointGeometry
    }
    const highlight = highlightRef.current
    if (highlight) {
      if (selected != null) {
        const posArr = currentPointGeometry.attributes.position.array
        const si3 = selected * 3
        highlight.position.set(posArr[si3], posArr[si3 + 1], posArr[si3 + 2])
        highlight.visible = true
      } else {
        highlight.visible = false
      }
    }
    const colors = currentPointGeometry.attributes.color.array
    const base = currentPointGeometry.attributes.baseColor.array
    const glowColors = currentGlowGeometry.attributes.color.array
    const active = simulationEnabled && colors.length > 0
    const wasActive = flashActiveRef.current
    if (!active && !wasActive) return
    let any = false
    colors.set(base)
    glowColors.fill(0)
    if (active) {
      const simMs = getTime() * 1000
      const spikeTimes = spikeTimesRef.current
      for (let i = 0; i < nodes.length; i += 1) {
        const st = spikeTimes[i]
        const age = st ? simMs - st : Infinity
        if (age >= FLASH_DURATION) continue
        const flash = Math.exp(-age / 24)
        const k = Math.min(1, flash)
        const i3 = i * 3
        colors[i3] += (FLASH_GREEN.r - colors[i3]) * k
        colors[i3 + 1] += (FLASH_GREEN.g - colors[i3 + 1]) * k
        colors[i3 + 2] += (FLASH_GREEN.b - colors[i3 + 2]) * k
        const glowLevel = Math.min(1, flash * 1.4)
        glowColors[i3] = FLASH_GREEN.r * glowLevel
        glowColors[i3 + 1] = FLASH_GREEN.g * glowLevel
        glowColors[i3 + 2] = FLASH_GREEN.b * glowLevel
        any = true
      }
    }
    currentPointGeometry.attributes.color.needsUpdate = true
    currentGlowGeometry.attributes.color.needsUpdate = true
    glow.visible = any
    flashActiveRef.current = any
  })

  // Nothing to draw until the organism map has been sampled.
  if (nodes.length === 0) return null
  return (
    <group position={[0, 0.08, 0]}>
      {/* The neurons themselves. */}
      <points ref={pointsRef} geometry={pointGeometry} frustumCulled={false}>
        <pointsMaterial
          color="#ffffff"
          vertexColors
          size={SYNAPSE_SIZE}
          sizeAttenuation
        />
      </points>
      {/* Additive glow that lights up when neurons fire. */}
      <points ref={glowRef} geometry={glowGeometry} frustumCulled={false} visible={false}>
        <pointsMaterial
          vertexColors
          map={glowTexture}
          size={FLASH_GLOW_SIZE}
          sizeAttenuation
          transparent
          opacity={1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
      {/* Big purple marker showing the currently selected neuron. */}
      <sprite ref={highlightRef} visible={false} scale={SELECT_MARKER_SIZE}>
        <spriteMaterial
          map={glowTexture}
          color={SELECT_PURPLE_HEX}
          transparent
          opacity={1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      {/* Dendrites scaffolding the neurons together. */}
      <NetworkLinks
        nodes={nodes}
        separation={separation}
        depth={depth}
        length={organism.length}
        highContrast={highContrast}
        onLoadingChange={onLoadingChange}
        onNetworkStats={onNetworkStats}
      />
    </group>
  )
}
