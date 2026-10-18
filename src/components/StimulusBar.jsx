const BUTTONS = [
  { kind: 'rest', side: 'all', label: 'Rest', hint: 'Baseline drive, no stimulus.' },
  { kind: 'light', side: 'left', label: 'Light ▸ left', hint: 'Photoreceptor current, left afferents.' },
  { kind: 'light', side: 'right', label: 'Light ▸ right', hint: 'Photoreceptor current, right afferents.' },
  { kind: 'chemA', side: 'left', label: 'Chem A ▸ left', hint: 'Excitatory ligand, left chemosensory.' },
  { kind: 'chemA', side: 'right', label: 'Chem A ▸ right', hint: 'Excitatory ligand, right chemosensory.' },
  { kind: 'chemB', side: 'left', label: 'Chem B ▸ left', hint: 'Inhibitory ligand, left chemosensory.' },
  { kind: 'chemB', side: 'right', label: 'Chem B ▸ right', hint: 'Inhibitory ligand, right chemosensory.' },
]

export default function StimulusBar({ value, onChange }) {
  return (
    <div className="stimulus-bar" role="group" aria-label="Stimulus conditions">
      <span className="stimulus-title">Stimulus</span>
      {BUTTONS.map((button) => {
        const active = value?.kind === button.kind && value?.side === button.side
        return (
          <button
            key={`${button.kind}-${button.side}`}
            type="button"
            className={`tbtn small stimulus-btn${active ? ' active' : ''}`}
            title={button.hint}
            onClick={() => onChange({ ...button })}
          >
            {button.label}
          </button>
        )
      })}
    </div>
  )
}
