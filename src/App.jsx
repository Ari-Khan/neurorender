// Top-level app: owns all UI state (organism, settings, simulation, selection)
// and lays out the top bar, 3D viewport, and status bar.
import { useCallback, useEffect, useRef, useState } from 'react'
import Scene from './three/Scene.jsx'
import OrganismPanel from './components/OrganismPanel.jsx'
import SimulationPanel from './components/SimulationPanel.jsx'
import StatsPanel from './components/StatsPanel.jsx'
import { resetSimData } from './sim/simData.js'
import { DEFAULT_STIMULI } from './sim/stimuli.js'
import { loadSettings } from './settings.js'
import './App.css'

// Loads the saved organism library, seeding it from the last used organism.
function loadOrganisms() {
  try {
    const raw = localStorage.getItem('neurorender.organisms.v1')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
    const current = localStorage.getItem('neurorender.organism.v1')
    if (current) {
      const organism = JSON.parse(current)
      if (organism) return [{ ...organism, name: organism.name || 'Organism 1' }]
    }
    return []
  } catch {
    return []
  }
}

// Picks the next free "Organism N" style default name.
function nextOrganismName(organisms) {
  const used = new Set(organisms.map((item) => item.name))
  let index = organisms.length + 1
  while (used.has(`Organism ${index}`)) index += 1
  return `Organism ${index}`
}

// Shows a scale bar, choosing a round "1/2/5 × 10ⁿ μm" length near 100 px.
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
  const [simulationEnabled, setSimulationEnabled] = useState(false)
  const [simulationParams, setSimulationParams] = useState(null)
  const [simulationOpen, setSimulationOpen] = useState(false)
  const [simSpeed, setSimSpeed] = useState(1)
  const [organism, setOrganism] = useState(() => {
    try {
      const saved = localStorage.getItem('neurorender.organism.v1')
      if (!saved) return null
      const parsed = JSON.parse(saved)
      if (parsed && !parsed.name) parsed.name = 'Organism 1'
      return parsed
    } catch {
      return null
    }
  })
  const [selectedNeuron, setSelectedNeuron] = useState(null)
  const [stimuli, setStimuli] = useState(DEFAULT_STIMULI)
  const [organisms, setOrganisms] = useState(loadOrganisms)
  const [loadOpen, setLoadOpen] = useState(false)
  const lastOrganismRef = useRef(organism)

  // Switching organism wipes the sim and any selection.
  useEffect(() => {
    if (lastOrganismRef.current === organism) return
    lastOrganismRef.current = organism
    resetSimData()
    setSelectedNeuron(null)
    setNetworkStats({ neurons: 0, dendrites: 0 })
  }, [organism])

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

  useEffect(() => {
    try {
      localStorage.setItem('neurorender.organisms.v1', JSON.stringify(organisms))
    } catch {
      // storage unavailable — ignore
    }
  }, [organisms])

  const resetView = useCallback(() => setResetKey((k) => k + 1), [])

  // First click opens the setup modal; while running it just stops.
  const handleSimulateClick = useCallback(() => {
    if (simulationEnabled) {
      setSimulationEnabled(false)
      return
    }
    setSimulationOpen(true)
  }, [simulationEnabled])

  const handleSimulationStart = useCallback((params) => {
    setSimulationParams(params)
    setSimulationEnabled(true)
    setSimulationOpen(false)
  }, [])

  const handleLoadOrganism = useCallback((saved) => {
    setOrganism(saved)
    setLoadOpen(false)
  }, [])

  // Save from the organism editor: replace the same-named entry and make it current.
  const handleOrganismClose = useCallback((nextOrganism) => {
    setNewOrganismOpen(false)
    if (!nextOrganism) return
    setOrganism(nextOrganism)
    setOrganisms((current) => {
      const previousName = panelMode === 'edit' ? organism?.name : null
      return current
        .filter((item) => item.name !== nextOrganism.name && item.name !== previousName)
        .concat(nextOrganism)
    })
  }, [panelMode, organism])

  const defaultOrganismName = panelMode === 'edit' && organism?.name
    ? organism.name
    : nextOrganismName(organisms)

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
            className="simulate-organism-btn"
            disabled={!organism}
            onClick={handleSimulateClick}
          >
            {simulationEnabled ? 'Stop simulation' : 'Simulate organism'}
          </button>
          <button
            type="button"
            className="clear-organism-btn"
            disabled={!organism}
            onClick={() => setOrganism(null)}
            title="Clear organism"
          >
            Clear organism
          </button>
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
          <div className="load-menu-wrap">
            <button
              type="button"
              className="load-organism-btn"
              disabled={organisms.length === 0}
              onClick={() => setLoadOpen((open) => !open)}
            >
              Load organism
            </button>
            {loadOpen && organisms.length > 0 && (
              <>
                <div
                  className="load-menu-backdrop"
                  onClick={() => setLoadOpen(false)}
                />
                <div className="load-menu" role="menu" aria-label="Saved organisms">
                  {organisms.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      role="menuitem"
                      className={`load-menu-item${organism?.name === item.name ? ' active' : ''}`}
                      onClick={() => handleLoadOrganism(item)}
                    >
                      {item.name || 'Untitled organism'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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
          simulationEnabled={simulationEnabled}
          simulationParams={simulationParams}
          simulationSpeed={simSpeed}
          stimuli={stimuli}
          selectedNeuron={selectedNeuron}
          onSelectNeuron={setSelectedNeuron}
          onNetworkLoading={setNetworkLoading}
          onLayerLoading={setLayerLoading}
          onNetworkStats={setNetworkStats}
          onCamera={setCameraInfo}
        />
        {organism && (
          <StatsPanel
            networkStats={networkStats}
            selectedNeuron={selectedNeuron}
            onClearSelection={() => setSelectedNeuron(null)}
            simulationEnabled={simulationEnabled}
            speed={simSpeed}
            stimuli={stimuli}
            onStimuliChange={setStimuli}
          />
        )}
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
            defaultName={defaultOrganismName}
            onClose={handleOrganismClose}
          />
        )}
        {simulationOpen && (
          <SimulationPanel
            onStart={handleSimulationStart}
            onCancel={() => setSimulationOpen(false)}
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
        <div className="statusbar-group sim-speed-group" aria-label="Simulation speed">
          <span className="sim-speed-label">Simulation speed</span>
          {[1, 0.5, 0.25, 0.1].map((speed) => (
            <button
              key={speed}
              type="button"
              className={`tbtn small sim-speed-btn${simSpeed === speed ? ' active' : ''}`}
              onClick={() => setSimSpeed(speed)}
            >
              {speed}x
            </button>
          ))}
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
