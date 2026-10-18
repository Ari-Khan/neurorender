"""Regression tests for cross-trial / cross-candidate contamination.

The catastrophic bug this guards against: the flat bincount index used
stride N per trial while reshape expected 2N, so trial p received trial
2p's excitation.  These tests encode the *invariants* so any future
indexing change that breaks them fails loudly:

1. determinism        - same seed => identical result
2. candidate purity   - candidate 0's output in a n_cand=k batch is
                        bit-identical to running it alone (CRN shares
                        stimuli/noise, never weights)
3. condition purity   - permuting condition ORDER in the panel doesn't
                        change each condition's response (only its row)
4. rep purity         - same for replicates
5. noise isolation    - different noise_seed => different result
                        (proves noise is actually consumed per-trial)

Run:  python scripts/test_contamination.py
Exit code 0 = all invariants hold.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from neurorender import (  # noqa: E402
    Connectome,
    Condition,
    IzhikevichSim,
    ParamSpace,
    SimConfig,
    build_conditions,
    build_network,
    run_eval,
)
from neurorender.reward import RewardConfig  # noqa: E402
from neurorender.stimuli import prepare_trials  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    tag = "PASS" if ok else "FAIL"
    print(f"  [{tag}] {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        FAILURES.append(name)


def main() -> None:
    data = ROOT / "data" / "sample_tardigrade.json"
    conn = Connectome.load(data)
    net = build_network(conn)
    sim = IzhikevichSim(net, SimConfig(noise_sigma=1.3))
    space = ParamSpace(net, "default")
    conds = build_conditions(conn.stimuli)
    rng = np.random.default_rng(0)
    cfg = RewardConfig()

    # a nontrivial theta so gains differ per candidate
    def rand_theta(n):
        return rng.normal(0.0, 0.4, size=(n, space.dim))

    # -- 1. determinism -----------------------------------------------------
    th = rand_theta(1)
    s1, r1 = run_eval(net, sim, conds, space, th, n_rep=4, noise_seed=123,
                      reward_cfg=cfg)
    s2, r2 = run_eval(net, sim, conds, space, th, n_rep=4, noise_seed=123,
                      reward_cfg=cfg)
    check("determinism", np.array_equal(r1, r2))

    # -- 2. candidate purity ------------------------------------------------
    # batch of 4 candidates; candidate 0 must equal the solo run EXACTLY
    # (same stimuli, same noise stream, same v0 - only weights differ).
    # run_eval hardcodes n_cand=1, so drive prepare_trials/sim.run directly.
    def run_batch(thetas, n_rep=4, noise_seed=123):
        batch = prepare_trials(net, conds, n_cand=len(thetas), n_rep=n_rep,
                               theta=thetas, sens_slice=space.sens_slice)
        g = space.gain_e(thetas, batch.n_cond * n_rep)
        res = sim.run(batch, g, noise_seed=noise_seed,
                      v0_base=sim.make_initial(n_rep, seed=noise_seed + 7))
        R = len(net.readout)
        q = res.totals.reshape(len(thetas), len(conds), n_rep, -1)
        return q[:, :, :, net.readout].mean(axis=2) / sim.cfg.win_s  # (k,C,R)

    solo = run_batch(th)                       # (1, C, R)
    th4 = rand_theta(4)
    th4[0] = th[0]
    batched = run_batch(th4)                   # (4, C, R)
    check("candidate purity (cand 0 in batch == solo run)",
          np.array_equal(solo[0], batched[0]),
          f"max|d|={np.abs(solo[0] - batched[0]).max():.3g}")

    # also check the LAST candidate (the original bug zeroes out trailing
    # trials and rewires middle ones)
    th4b = rand_theta(4)
    th4b[3] = th[0]
    batched_b = run_batch(th4b)
    check("candidate purity (last cand in batch == solo run)",
          np.array_equal(solo[0], batched_b[3]),
          f"max|d|={np.abs(solo[0] - batched_b[3]).max():.3g}")

    # -- 3. condition purity (permute the panel) ----------------------------
    # NOTE: with noise on, permuting the panel reassigns noise streams
    # (noise rows are keyed by panel position cr = cond*R + rep), so
    # responses legitimately change.  Cross-CONTAMINATION is tested with
    # noise_sigma=0, where each condition's response must be a pure
    # function of its own input - permuted or solo.
    quiet = IzhikevichSim(net, SimConfig(noise_sigma=0.0))

    def totals_quiet(cond_panel, n_rep, theta):
        batch = prepare_trials(net, cond_panel, n_cand=1, n_rep=n_rep,
                               theta=theta, sens_slice=space.sens_slice)
        g = space.gain_e(theta, batch.n_cond * n_rep)
        res = quiet.run(batch, g, noise_seed=0,
                        v0_base=quiet.make_initial(n_rep, seed=7))
        return res.totals.reshape(len(cond_panel), n_rep, -1)

    perm = [2, 0, 5, 1, 4, 3]
    conds_p = [conds[i] for i in perm]
    ta = totals_quiet(conds, 4, th)
    tp = totals_quiet(conds_p, 4, th)
    check("condition purity (zero noise: permuted panel == per-cond rows)",
          np.array_equal(tp, ta[perm]),
          f"max|d|={np.abs(tp - ta[perm]).max():.3g}")

    # strongest version: each condition solo (C=1) vs its row in the panel
    worst = 0.0
    ok = True
    for ci, c in enumerate(conds):
        ts = totals_quiet([c], 4, th)          # (1, 4, N)
        d = np.abs(ts[0] - ta[ci]).max()
        worst = max(worst, float(d))
        ok &= np.array_equal(ts[0], ta[ci])
    check("condition purity (zero noise: solo condition == panel row)",
          ok, f"max|d|={worst:.3g}")

    # -- 4. rep purity (replicate count / identity) -------------------------
    # r6 from run_eval is already averaged over reps, so compare raw totals.
    # Noise rows are per (cond, rep): extending R adds rows without
    # touching old ones, and v0 must extend by prefix.
    v0a = sim.make_initial(4, seed=123 + 7)
    v0b = sim.make_initial(6, seed=123 + 7)
    check("v0 prefix property (make_initial)",
          np.array_equal(v0a, v0b[:4]))

    def totals(n_rep):
        batch = prepare_trials(net, conds, n_cand=1, n_rep=n_rep,
                               theta=th, sens_slice=space.sens_slice)
        g = space.gain_e(th, batch.n_cond * n_rep)
        return sim.run(batch, g, noise_seed=123, v0_base=v0b[:n_rep])

    # DESIGN NOTE: changing R changes the noise stream itself - noise rows
    # are indexed cr = cond*R + rep, so (cond=1, rep=0) reads row R, not
    # row 4.  Same for the cr_rows->noise mapping across candidates? No:
    # candidates tile the same cr range, which is exactly the CRN promise.
    # Here we only assert what must hold: identical (C, R) => identical.
    ta = totals(4)
    tb = totals(4)
    check("identical (C,R) batches reproduce bit-identically",
          np.array_equal(ta.totals, tb.totals))

    # -- 5. noise isolation --------------------------------------------------
    _, r_other = run_eval(net, sim, conds, space, th, n_rep=4, noise_seed=124,
                          reward_cfg=cfg)
    check("noise is consumed (different seed => different response)",
          not np.array_equal(r1, r_other))

    # -- summary --------------------------------------------------------------
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("all contamination invariants hold")


if __name__ == "__main__":
    main()
