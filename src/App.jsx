import { useCallback, useEffect, useState } from 'react'
import Scene from './three/Scene.jsx'
import OrganismPanel from './components/OrganismPanel.jsx'
import { loadSettings } from './settings.js'
import './App.css'

function ScaleReadout({ cameraInfo }) {
  const worldUnitsPerPixel = cameraInfo?.horizontalWorldUnitsPerPixel || 1
  const targetLength = worldUnitsPerPixel * 100
  const exponent = Math.floor(Math.log10(targetLength))
  const base = 10 ** exponent
  const scaleLength = [1, 2, 5, 10]
    .reverse()
    .map((factor) => factor * base)
    .find((value) => value <= targetLength) || base / 10

  return (
    <div className="scale-readout" aria-label="Organism scale">
      <span className="scale-line" />
      <span>{Number(scaleLength.toPrecision(3))} μm</span>
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
  const [networkStats, setNetworkStats] = useState({ neurons: 0, dendrites: 0 })
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
        <div className="brand-group">
          <div className="brand">NeuroRender</div>
          <div className="network-stats" aria-label="Network statistics">
            <span>{organism ? networkStats.neurons : 0} neurons</span>
            <span>{organism ? networkStats.dendrites : 0} dendrites</span>
          </div>
        </div>
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
          onNetworkStats={setNetworkStats}
          onCamera={setCameraInfo}
        />
        {organism && (
          <ScaleReadout cameraInfo={cameraInfo} />
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
        <div className="controls" aria-label="Navigation controls">
          <span>Left drag: rotate</span>
          <span>Right drag: pan</span>
          <span>Scroll: zoom</span>
          <span>WASD: move</span>
          <span>Q/E: roll</span>
        </div>
        <div className="statusbar-group statusbar-view-actions">
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
        </div>
      </footer>
    </div>
  )
}

export default App
