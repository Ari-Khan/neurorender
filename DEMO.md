# 5-minute judge demo

Everything runs locally — no accounts, no network, no commits.

```bash
npm install
npm run dev        # open the printed localhost URL
```

## The walkthrough

1. **Load the organism** — click **“Load demo organism”** (top right).
   The synthetic *Hypsibius exemplaris* connectome (90 soma, 288 tracts,
   brain / ventral cord / outer-nerve regions) renders instantly as a
   3-layer nerve map — no drawing required. “New organism” still lets
   you draw your own map from scratch.

2. **Simulate** — press **“Simulate organism”** → *Start simulation*
   (defaults are fine). Neurons flash green as they spike; the right
   rail shows a live raster and per-layer firing rates.

3. **Poke it** — use the **Stimulus** bar (bottom left):
   - **Light ▸ left/right** — photoreceptor current into that side’s
     afferents (layer spikes up visibly),
   - **Chem A ▸ …** — excitatory ligand,
   - **Chem B ▸ …** — inhibitory ligand (that side quiets down),
   - **Rest** — baseline.

   Drive updates live, mid-run — no restart. Stimulus name appears in
   the stats panel.

4. **Show the training** — click **“Training results”** (top bar).
   Held-out numbers (paired, unseen noise seeds 9000–9005, 8 reps):
   decoder accuracy 0.69 → 0.74, reward 0.87 → 1.01, plus conflicting
   stimulus combinations, the reward curve, and the response figure.
   The held-out-intensity regression is listed openly — honesty is
   part of the pitch (see `README-neuro.md`).

## Also worth showing

- `python scripts/test_contamination.py` — simulator integrity invariants.
- `python scripts/run_demo.py --gens 60 --pop 20 --reps 6 --seed 0 --out out-run`
  — live training run (~2 min).
- **Layers: separate** toggle in the footer — the 3 regions split apart.

## Backup

Training artifacts + Python core are backed up at
`~/projects/neurorender-training-backup-20261018.tar.gz`.
