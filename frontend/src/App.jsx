import { useCallback, useEffect, useState } from 'react'
import Scene from './three/Scene.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import { DEFAULT_SETTINGS, loadSettings, heightFor } from './settings.js'
import './App.css'

const round = (n) => Math.round(n * 10) / 10

function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const [cam, setCam] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem('neurorender.settings.v1', JSON.stringify(settings))
    } catch {
      // storage unavailable — ignore
    }
  }, [settings])

  const update = useCallback((patch) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  const onCamera = useCallback((info) => setCam(info), [])
  const resetView = useCallback(() => setResetKey((k) => k + 1), [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>
            Neurorender<small>3D space · {settings.worldSize}×{heightFor(settings.worldSize)}×{settings.worldSize}</small>
          </span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="tbtn" onClick={resetView}>
            Reset view
          </button>
          <button
            type="button" className="tbtn"
            onClick={() => setPanelOpen((o) => !o)}
          >
            Settings
          </button>
        </div>
      </header>

      <div className="viewport">
        <Scene settings={settings} resetKey={resetKey} onCamera={onCamera} />

        <div className="hud">
          <div><b>Drag</b> rotate · <b>Right-drag</b> pan · <b>Wheel</b> zoom</div>
          <div><b>WASD</b> move · <b>Q/E</b> down/up · <b>Shift</b> sprint</div>
        </div>

        {cam && (
          <div className="readout">
            <span>
              target {round(cam.target[0])}, {round(cam.target[1])}, {round(cam.target[2])}
            </span>
            <span>dist {round(cam.dist)}</span>
          </div>
        )}

        <SettingsPanel
          open={panelOpen}
          settings={settings}
          onChange={update}
          onToggle={() => setPanelOpen((o) => !o)}
          onResetView={resetView}
        />
      </div>

      <footer className="statusbar">
        <span>Three.js · React Three Fiber</span>
        <span className="message">
          {settings.showBounds
            ? 'Neuron volume bounds shown — future neuron rendering will live inside this box'
            : 'axes off / bounds off'}
        </span>
        <button
          type="button"
          className="tbtn small"
          onClick={() => setSettings(DEFAULT_SETTINGS)}
        >
          Restore defaults
        </button>
      </footer>
    </div>
  )
}

export default App
