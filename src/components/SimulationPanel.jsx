// Modal for choosing an Izhikevich firing pattern (or tuning a, b, c, d by hand)
// before starting the simulation.
import { useMemo, useState } from 'react'
import { DEFAULT_PARAMS, IZH_DESCRIPTIONS, IZH_PRESETS, IZH_RANGES } from '../sim/izhikevich'

const PARAM_ORDER = ['a', 'b', 'c', 'd']

export default function SimulationPanel({ onStart, onCancel }) {
  const [presetId, setPresetId] = useState(DEFAULT_PARAMS.id || IZH_PRESETS[0].id)
  const [params, setParams] = useState(DEFAULT_PARAMS)

  // Picking a preset loads its four parameters wholesale.
  const handlePresetChange = (event) => {
    const id = event.target.value
    setPresetId(id)
    const preset = IZH_PRESETS.find((p) => p.id === id)
    if (preset) setParams(preset)
  }

  // Editing any field drops us into "Custom" and updates just that value.
  const handleParamChange = (key, value) => {
    const num = parseFloat(value)
    if (isNaN(num)) return
    setPresetId('custom')
    setParams((p) => ({ ...p, [key]: num }))
  }

  const selectedPreset = useMemo(
    () => IZH_PRESETS.find((p) => p.id === presetId),
    [presetId],
  )

  const start = () => {
    onStart?.(params)
  }

  return (
    <div className="organism-overlay" role="dialog" aria-modal="true">
      <div className="organism-panel simulation-panel">
        <header className="organism-panel-head">
          <div>
            <h2>Izhikevich Simulation</h2>
            <p>Choose a firing pattern or tune the a, b, c, d parameters yourself</p>
          </div>
          <button type="button" className="organism-panel-close" onClick={onCancel} aria-label="Close">×</button>
        </header>

        <div className="simulation-body">
          <div className="sim-section">
            <div className="sim-field">
              <label htmlFor="izh-preset">Pattern</label>
              <select
                id="izh-preset"
                className="sim-select"
                value={presetId}
                onChange={handlePresetChange}
              >
                {IZH_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {presetId === 'custom' && <option value="custom">Custom</option>}
              </select>
            </div>
            <p className="sim-description">
              {selectedPreset
                ? selectedPreset.description
                : 'Custom parameters — edit the values below to define your own firing pattern.'}
            </p>
          </div>

          <div className="sim-section">
            <div className="sim-section-title">Parameters</div>
            <div className="sim-grid">
              {PARAM_ORDER.map((key) => {
                const range = IZH_RANGES[key]
                return (
                  <div className="sim-field" key={key}>
                    <label htmlFor={`izh-${key}`}>{range.label}</label>
                    <input
                      id={`izh-${key}`}
                      className="sim-input"
                      type="number"
                      min={range.min}
                      max={range.max}
                      step={range.step}
                      value={params[key]}
                      onChange={(e) => handleParamChange(key, e.target.value)}
                    />
                    <span className="sim-range">
                      {range.min} – {range.max}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="sim-section">
            <div className="sim-section-title">What the parameters do</div>
            <dl className="sim-help">
              {PARAM_ORDER.map((key) => (
                <div className="sim-help-row" key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {IZH_DESCRIPTIONS[key]}{' '}
                    <span className="sim-range">
                      typical range {IZH_RANGES[key].min}–{IZH_RANGES[key].max}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="sim-equations">
            dv/dt = 0.04 v² + 5 v + 140 − u + I · du/dt = a (b v − u) · spike when v ≥ 30: v ← c, u ← u + d
          </div>
        </div>

        <footer className="organism-panel-foot simulation-foot">
          <span>Spiking neurons flash green while the simulation runs.</span>
          <button type="button" className="tbtn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="simulate-organism-btn" onClick={start}>
            Start simulation
          </button>
        </footer>
      </div>
    </div>
  )
}
