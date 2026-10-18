import { useCallback, useEffect, useState } from 'react'
import Scene from './three/Scene.jsx'
import OrganismPanel from './components/OrganismPanel.jsx'
import { loadSettings } from './settings.js'
import './App.css'

function ScaleReadout({ organismLength, cameraInfo }) {
  const viewDistance = cameraInfo?.dist || organismLength
  const targetLength = Math.max(1, Math.min(organismLength, viewDistance * 0.2))
  const exponent = Math.floor(Math.log10(targetLength))
  const scaleLength = Math.max(1, 10 ** exponent)
  const width = Math.min(150, Math.max(50, (scaleLength / targetLength) * 100))

  return (
    <div className="scale-readout" aria-label="Organism scale">
      <span className="scale-line" style={{ width: `${width}px` }} />
      <span>{scaleLength} μm</span>
    </div>
  )
}

function App() {
  const [settings] = useState(loadSettings)
  const [resetKey, setResetKey] = useState(0)
  const [newOrganismOpen, setNewOrganismOpen] = useState(false)
  const [panelMode, setPanelMode] = useState('new')
  const [gridVisible, setGridVisible] = useState(true)
  const [layersSeparated, setLayersSeparated] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [networkLoading, setNetworkLoading] = useState(false)
  const [layerLoading, setLayerLoading] = useState(false)
  const [cameraInfo, setCameraInfo] = useState(null)
  const [organism, setOrganism] = useState(() => {
    try {
      const saved = localStorage.getItem('neurorender.organism.v1')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('neurorender.settings.v1', JSON.stringify(settings))
    } catch {
      // storage unavailable — ignore
    }
  }, [settings])

  useEffect(() => {
    try {
      if (organism) localStorage.setItem('neurorender.organism.v1', JSON.stringify(organism))
      else localStorage.removeItem('neurorender.organism.v1')
    } catch {
      // storage unavailable - keep the current organism in memory
    }
  }, [organism])

  const resetView = useCallback(() => setResetKey((k) => k + 1), [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">NeuroRender</div>
        <div className="topbar-actions">
          <button
            type="button"
            className="edit-organism-btn"
            disabled={!organism}
            onClick={() => {
              setPanelMode('edit')
              setNewOrganismOpen(true)
            }}
          >
            Edit organism
          </button>
          <button type="button" className="load-organism-btn">
            Load organism
          </button>
          <button
            type="button"
            className="new-organism-btn"
            onClick={() => {
              setPanelMode('new')
              setNewOrganismOpen(true)
            }}
          >
            New organism
          </button>
        </div>
      </header>

      <div className="viewport">
        <Scene
          settings={settings}
          resetKey={resetKey}
          organism={organism}
          gridVisible={gridVisible}
          layersSeparated={layersSeparated}
          highContrast={highContrast}
          onNetworkLoading={setNetworkLoading}
          onLayerLoading={setLayerLoading}
          onCamera={setCameraInfo}
        />
        {organism && (
          <ScaleReadout organismLength={organism.length} cameraInfo={cameraInfo} />
        )}
        {networkLoading && (
          <div className="network-loading" role="status">
            Building dendrites…
          </div>
        )}
        {layerLoading && (
          <div className="network-loading layer-loading" role="status">
            {layersSeparated ? 'Separating layers…' : 'Combining layers…'}
          </div>
        )}
        {newOrganismOpen && (
          <OrganismPanel
            key={panelMode}
            initialOrganism={panelMode === 'edit' ? organism : null}
            onClose={(nextOrganism) => {
              if (nextOrganism) setOrganism(nextOrganism)
              setNewOrganismOpen(false)
            }}
          />
        )}
      </div>

      <footer className="statusbar">
        <button
          type="button"
          className="tbtn contrast-toggle"
          onClick={() => setHighContrast((enabled) => !enabled)}
        >
          Contrast {highContrast ? 'high' : 'normal'}
        </button>
        <button
          type="button"
          className="tbtn layer-toggle"
          onClick={() => setLayersSeparated((separated) => !separated)}
        >
          Layers {layersSeparated ? 'separate' : 'combined'}
        </button>
        <button
          type="button"
          className="tbtn grid-toggle"
          onClick={() => setGridVisible((visible) => !visible)}
        >
          Grid {gridVisible ? 'on' : 'off'}
        </button>
        <button type="button" className="tbtn" onClick={resetView}>
          Reset view
        </button>
      </footer>
    </div>
  )
}

export default App
