import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const LAYER_COLORS = [
  [240, 138, 138],
  [127, 183, 238],
  [232, 199, 107],
]

const LAYER_ALLOCATION = [0.35, 0.4, 0.25]
const CONNECTION_DISTANCE = [0.022, 0.024, 0.026]
const CROSS_LAYER_DISTANCE = 0.022

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

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
  layerCandidates.forEach((layer, layerIndex) => {
    if (layer.length === 0) return
    const layerCount = Math.min(
      layer.length,
      Math.max(1, Math.round(targetCount * LAYER_ALLOCATION[layerIndex])),
    )
    const layerStep = layer.length / layerCount
    for (let index = 0; index < layerCount; index += 1) {
      selected.push({
        candidate: layer[Math.min(layer.length - 1, Math.floor(index * layerStep))],
        index: selected.length,
      })
    }
  })
  return selected.map(({ candidate, index }) => {
    const jitter = Math.sin(index * 12.9898) * 0.35
    return {
      layer: candidate.layer,
      position: new THREE.Vector3(
        ((candidate.x / width) - 0.5) * length,
        (0.5 - candidate.y / height) * widthInWorld,
        jitter * depth * 0.02,
      ),
    }
  })
}

function createDendriteGeometry(curve) {
  const tubularSegments = 8
  const radialSegments = 5
  const radius = 0.045
  const frames = curve.computeFrenetFrames(tubularSegments, false)
  const positions = []
  const indices = []

  for (let segment = 0; segment <= tubularSegments; segment += 1) {
    const t = segment / tubularSegments
    const center = curve.getPointAt(t)
    const taper = 0.35 + 0.65 * Math.abs(2 * t - 1)
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
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function layerOffset(node, separation, depth, length) {
  return (node.layer - 1) * separation * Math.max(depth * 0.08, length * 0.012)
}

function worldPosition(node, separation, depth, length) {
  const position = node.position.clone()
  position.z += layerOffset(node, separation, depth, length)
  return position
}

function spatialKey(x, y, z) {
  return `${x},${y},${z}`
}

function DendriteLink({ connection, nodes, separation, depth, length, highContrast }) {
  const geometry = useMemo(() => {
    const [startIndex, endIndex] = connection.split('-').map(Number)
    const start = worldPosition(nodes[startIndex], separation, depth, length)
    const end = worldPosition(nodes[endIndex], separation, depth, length)
    const midpoint = start.clone().lerp(end, 0.5)
    midpoint.y += Math.sin(endIndex * 1.7) * 0.35
    return createDendriteGeometry(new THREE.CatmullRomCurve3([start, midpoint, end]))
  }, [connection, nodes, separation, depth, length])

  const [startIndex, endIndex] = connection.split('-').map(Number)
  return (
    <mesh>
      <primitive object={geometry} attach="geometry" />
      <meshBasicMaterial
        color={
          highContrast
            ? (nodes[startIndex].layer === nodes[endIndex].layer ? '#ff9d3d' : '#4db8ff')
            : '#9b9b9b'
        }
        transparent
        opacity={highContrast ? 0.9 : 0.42}
      />
    </mesh>
  )
}

function NetworkLinks({ nodes, separation, depth, length, highContrast, onLoadingChange }) {
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
  }, [connections, onLoadingChange])

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

export default function NeuronNetwork({
  organism,
  layersSeparated = false,
  highContrast = false,
  onLoadingChange,
  onLayerLoading,
}) {
  const [nodes, setNodes] = useState([])
  const [separation, setSeparation] = useState(0)
  const separationRef = useRef(0)
  const layerBatchRef = useRef(0)
  const depth = organism.length * Math.max(0.01, organism.depthPercent / 100)
  useFrame(() => {
    const target = layersSeparated ? 1 : 0
    const current = separationRef.current
    if (Math.abs(current - target) > 0.01) {
      const next = current + (target - current) * 0.14
      separationRef.current = next
      layerBatchRef.current += Math.abs(next - current)
      onLayerLoading?.(true)
      if (layerBatchRef.current >= 0.04 || Math.abs(next - target) <= 0.01) {
        layerBatchRef.current = 0
        setSeparation(next)
      }
    } else if (current !== target) {
      separationRef.current = target
      layerBatchRef.current = 0
      setSeparation(target)
      onLayerLoading?.(false)
    }
  })

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

  const pointGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(nodes.flatMap((node) => {
        const position = node.position.clone()
        position.z += layerOffset(node, separation, depth, organism.length)
        return position.toArray()
      }), 3),
    )
    return geometry
  }, [nodes, separation, depth, organism.length])

  if (nodes.length === 0) return null
  return (
    <group position={[0, 0.08, 0]}>
      <points geometry={pointGeometry}>
        <pointsMaterial color="#d6d6d6" size={0.34} sizeAttenuation />
      </points>
      <NetworkLinks
        nodes={nodes}
        separation={separation}
        depth={depth}
        length={organism.length}
        highContrast={highContrast}
        onLoadingChange={onLoadingChange}
      />
    </group>
  )
}
