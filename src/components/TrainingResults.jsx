import heldout from '../../out-demo-v2/heldout/heldout.json'

function fmt(v) {
  return Number(v).toFixed(3)
}

function sd(v) {
  return `±${Number(v).toFixed(3)}`
}

function Pair({ before, after, higherIsBetter = true }) {
  const improved = higherIsBetter
    ? after.mean > before.mean
    : after.mean < before.mean
  return (
    <span className={`heldout-pair${improved ? ' better' : ''}`}>
      {fmt(before.mean)} {sd(before.sd)} → <strong>{fmt(after.mean)} {sd(after.sd)}</strong>
    </span>
  )
}

export default function TrainingResults({ onClose }) {
  const unseen = heldout.unseen_noise
  const joint = heldout.heldout_intensities.joint
  const conflicting = heldout.conflicting

  return (
    <div className="organism-overlay" role="dialog" aria-modal="true" onClick={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <div className="organism-panel training-panel">
        <header className="organism-panel-head">
          <div>
            <h2>Training results — checkpoint “{heldout.checkpoint}”</h2>
            <p>
              CMA-ES on an intrinsic-selectivity reward (Fisher discriminability +
              leave-one-out decoding). All numbers below are held-out: paired
              before/after, identical seeds, {heldout.eval_reps} replicates.
            </p>
          </div>
          <button type="button" className="organism-panel-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="training-body">
          <section className="training-section">
            <h3>Unseen noise seeds ({unseen.seeds.join(', ')})</h3>
            <div className="heldout-grid">
              <div>
                <span className="heldout-label">Decoder accuracy</span>
                <Pair before={unseen.before.decoder_acc} after={unseen.after.decoder_acc} />
              </div>
              <div>
                <span className="heldout-label">Reward</span>
                <Pair before={unseen.before.reward} after={unseen.after.reward} />
              </div>
              <div>
                <span className="heldout-label">Fisher separability</span>
                <Pair before={unseen.before.fisher} after={unseen.after.fisher} />
              </div>
              <div>
                <span className="heldout-label">Readout rate</span>
                <Pair
                  before={unseen.before.rate_readout_hz}
                  after={unseen.after.rate_readout_hz}
                  higherIsBetter={false}
                />
              </div>
            </div>
          </section>

          <section className="training-section">
            <h3>Conflicting stimulus combinations ({conflicting.conditions.length} conditions)</h3>
            <p className="training-note">
              e.g. light-left + chemB-right — never seen in training.
            </p>
            <div className="heldout-grid">
              <div>
                <span className="heldout-label">Decoder accuracy</span>
                <Pair before={conflicting.before.decoder_acc} after={conflicting.after.decoder_acc} />
              </div>
              <div>
                <span className="heldout-label">Reward</span>
                <Pair before={conflicting.before.reward} after={conflicting.after.reward} />
              </div>
            </div>
          </section>

          <section className="training-section">
            <h3>Held-out intensities (0.5×/1.5× amplitudes)</h3>
            <p className="training-note">
              Known weakness: decoder accuracy regresses here (chance ≈ 0.083).
              Tracked honestly rather than hidden — the reward still improves on
              Fisher separability ({fmt(joint.before.fisher)} → {fmt(joint.after.fisher)}).
            </p>
          </section>

          <section className="training-section training-figures">
            <figure>
              <img src="demo/curve.png" alt="Training reward curve across CMA-ES generations" />
              <figcaption>Reward across generations</figcaption>
            </figure>
            <figure>
              <img src="demo/responses.png" alt="Motor-pool responses per stimulus" />
              <figcaption>Readout responses by stimulus</figcaption>
            </figure>
          </section>
        </div>

        <footer className="organism-panel-foot simulation-foot">
          <span>Synthetic connectome, intrinsic-only reward — see README-neuro.md.</span>
          <button type="button" className="tbtn" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  )
}
