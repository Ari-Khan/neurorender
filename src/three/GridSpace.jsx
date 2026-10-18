// The reference grid: a floor grid plus optional vertical slices and axes.
import { Grid } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { heightFor } from '../settings.js'

export default function GridSpace({ settings, visible = true }) {
  const {
    worldSize,
    cellSize,
    sectionSize,
    sectionThickness = 1.2,
    infiniteGrid,
    showAxes,
    verticalGrids,
  } = settings

  const height = heightFor(worldSize)
  const gridSize = Math.max(worldSize * 16, 1920)
  const fadedCellColor = useMemo(() => new THREE.Color('#222222'), [])
  const fadedSectionColor = useMemo(() => new THREE.Color('#555555'), [])

  const axisSize = Math.max(8, worldSize * 0.18)

  // Shared props for the floor and the two vertical grids.
  const gridProps = {
    args: [gridSize, gridSize],
    cellSize,
    cellThickness: 0.5,
    cellColor: fadedCellColor,
    sectionSize,
    sectionThickness: Math.min(sectionThickness, 0.8),
    sectionColor: fadedSectionColor,
    fadeDistance: 100000,
    fadeStrength: 0,
    infiniteGrid,
    side: THREE.DoubleSide,
  }

  return (
    visible && (
      <>
      <Grid {...gridProps} />
      {verticalGrids && (
        <>
          <Grid {...gridProps} rotation={[Math.PI / 2, 0, 0]} position={[0, height / 2, 0]} />
          <Grid {...gridProps} rotation={[0, 0, Math.PI / 2]} position={[0, height / 2, 0]} />
        </>
      )}
      {showAxes && <axesHelper args={[axisSize]} position={[0, 0.05, 0]} />}
      </>
    )
  )
}
