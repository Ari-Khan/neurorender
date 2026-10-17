import { Canvas } from '@react-three/fiber'
import { memo } from 'react'
import CameraRig from './CameraRig.jsx'
import GridSpace from './GridSpace.jsx'

const Scene = memo(function Scene({ settings, resetKey, onCamera }) {
  const fogNear = settings.worldSize * 0.6
  const fogFar = settings.worldSize * 2.4
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ fov: 55, near: 0.5, far: 20000, position: [70, 45, 70] }}
    >
      <color attach="background" args={[settings.background]} />
      {settings.fog && (
        <fog attach="fog" args={[settings.background, fogNear, fogFar]} />
      )}
      <CameraRig settings={settings} resetKey={resetKey} onCamera={onCamera} />
      <GridSpace settings={settings} />
    </Canvas>
  )
})

export default Scene
