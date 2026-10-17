import { Grid } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { heightFor } from '../settings.js'

export default function GridSpace({ settings }) {
  const {
    worldSize,
    cellSize,
    sectionSize,
    cellColor,
    sectionColor,
    sectionThickness = 1.2,
    fadeDistance,
    infiniteGrid,
    showBounds,
    boundsColor,
    showAxes,
    verticalGrids,
  } = settings

  const height = heightFor(worldSize)

  const boundsGeometry = useMemo(() => {
    const geo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(worldSize, height, worldSize),
    )
    return geo
  }, [worldSize, height])

  const axisSize = Math.max(8, worldSize * 0.18)

  const gridProps = {
    args: [worldSize, worldSize],
    cellSize,
    cellThickness: 0.75,
    cellColor,
    sectionSize,
    sectionThickness,
    sectionColor,
    fadeDistance,
    fadeStrength: 1.2,
    infiniteGrid,
    side: THREE.DoubleSide,
  }

  return (
    <>
      <Grid {...gridProps} />
      {verticalGrids && (
        <>
          <Grid {...gridProps} rotation={[Math.PI / 2, 0, 0]} position={[0, height / 2, 0]} />
          <Grid {...gridProps} rotation={[0, 0, Math.PI / 2]} position={[0, height / 2, 0]} />
        </>
      )}
      {showBounds && (
        <lineSegments geometry={boundsGeometry} position={[0, height / 2, 0]}>
          <lineBasicMaterial
            color={boundsColor}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </lineSegments>
      )}
      {showAxes && <axesHelper args={[axisSize]} position={[0, 0.05, 0]} />}
    </>
  )
}
