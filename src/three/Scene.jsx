import { Canvas } from '@react-three/fiber'
import { memo } from 'react'
import CameraRig from './CameraRig.jsx'
import GridSpace from './GridSpace.jsx'
import NeuronNetwork from './NeuronNetwork.jsx'

const Scene = memo(function Scene({
  settings,
  resetKey,
  onCamera,
  organism,
  gridVisible,
  layersSeparated,
  highContrast,
  simulationEnabled,
  simulationParams,
  simulationSpeed = 1,
  selectedNeuron,
  onSelectNeuron,
  onNetworkLoading,
  onLayerLoading,
  onNetworkStats,
}) {
  const background = '#000000'
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ fov: 55, near: 0.5, far: 20000, position: [70, 45, 70] }}
    >
      <color attach="background" args={[background]} />
      <CameraRig settings={settings} resetKey={resetKey} onCamera={onCamera} />
      <GridSpace settings={settings} visible={gridVisible} />
      {organism && (
        <NeuronNetwork
          organism={organism}
          layersSeparated={layersSeparated}
          highContrast={highContrast}
          simulationEnabled={simulationEnabled}
          simulationParams={simulationParams}
          simulationSpeed={simulationSpeed}
          selectedNeuron={selectedNeuron}
          onSelectNeuron={onSelectNeuron}
          onLoadingChange={onNetworkLoading}
          onLayerLoading={onLayerLoading}
          onNetworkStats={onNetworkStats}
        />
      )}
    </Canvas>
  )
})

export default Scene
