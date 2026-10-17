function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="row-value">
        {format ? format(value) : Math.round(value * 100) / 100}
      </span>
    </div>
  )
}

function Color({ label, value, onChange }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="row row-toggle">
      <span className="row-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export default function SettingsPanel({
  open,
  settings,
  onChange,
  onToggle,
  onResetView,
}) {
  const set = (key) => (value) => onChange({ [key]: value })

  return (
    <aside className={`panel ${open ? 'open' : ''}`}>
      <div className="panel-head">
        <h3>Scene settings</h3>
        <button type="button" className="icon-btn" onClick={onToggle}>
          {open ? '×' : '⚙'}
        </button>
      </div>
      {open && (
        <div className="panel-body">
          <section>
            <h4>Grid</h4>
            <Slider
              label="Cell size"
              value={settings.cellSize}
              min={1}
              max={30}
              step={0.5}
              onChange={set('cellSize')}
            />
            <Slider
              label="Section size"
              value={settings.sectionSize}
              min={5}
              max={120}
              step={1}
              onChange={set('sectionSize')}
            />
            <Color label="Cell color" value={settings.cellColor} onChange={set('cellColor')} />
            <Color
              label="Section color"
              value={settings.sectionColor}
              onChange={set('sectionColor')}
            />
            <Slider
              label="Fade distance"
              value={settings.fadeDistance}
              min={50}
              max={3000}
              step={10}
              onChange={set('fadeDistance')}
            />
            <Toggle
              label="Infinite grid"
              checked={settings.infiniteGrid}
              onChange={set('infiniteGrid')}
            />
            <Toggle
              label="Vertical grids (3D)"
              checked={settings.verticalGrids}
              onChange={set('verticalGrids')}
            />
          </section>

          <section>
            <h4>Space</h4>
            <Slider
              label="World size"
              value={settings.worldSize}
              min={20}
              max={1000}
              step={10}
              onChange={set('worldSize')}
            />
            <Color
              label="Background"
              value={settings.background}
              onChange={set('background')}
            />
            <Toggle label="Fog" checked={settings.fog} onChange={set('fog')} />
            <Toggle
              label="Bounds box"
              checked={settings.showBounds}
              onChange={set('showBounds')}
            />
            <Color
              label="Bounds color"
              value={settings.boundsColor}
              onChange={set('boundsColor')}
            />
            <Toggle label="Axes" checked={settings.showAxes} onChange={set('showAxes')} />
          </section>

          <section>
            <h4>Navigation</h4>
            <Slider
              label="Move speed"
              value={settings.moveSpeed}
              min={5}
              max={200}
              step={5}
              onChange={set('moveSpeed')}
            />
            <Slider
              label="Rotate sensitivity"
              value={settings.rotateSpeed}
              min={0.2}
              max={4}
              step={0.1}
              onChange={set('rotateSpeed')}
            />
            <Slider
              label="Zoom sensitivity"
              value={settings.zoomSpeed}
              min={0.2}
              max={4}
              step={0.1}
              onChange={set('zoomSpeed')}
            />
            <Slider
              label="Damping"
              value={settings.damping}
              min={2}
              max={20}
              step={0.5}
              onChange={set('damping')}
            />
            <button type="button" className="panel-btn" onClick={onResetView}>
              Reset view
            </button>
          </section>
        </div>
      )}
    </aside>
  )
}
