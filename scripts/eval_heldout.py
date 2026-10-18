"""Held-out evaluation & ablations for a trained NeuroRender checkpoint.

Intrinsic-selectivity gains only count if they survive conditions the
objective never saw.  This script takes a checkpoint written by
``scripts/run_demo.py`` (theta_best + mode) and probes it against:

1. **unseen noise seeds**  - seeds disjoint from training (seed+1000) and
   the in-demo eval (seed+500); mean +/- sd over seeds
2. **held-out intensities** - light/chem amplitudes different from the
   training panel (train: light 8.0, conc 1.0)
3. **conflicting stimuli**  - multimodal combinations the 6 training
   conditions never contained (light+chem opposite sides, bilaterals)
4. **parameter ablations**  - neutralise (gain := 1) one theta group at a
   time and measure the held-out reward drop, attributing gains to
   pathway / E-I / sensory / edge groups

Baseline (theta = 0) is evaluated on every panel with identical seeds so
all deltas are paired.

    python scripts/eval_heldout.py --ckpt out-fix6 --out out-agent2/heldout-fix6

Writes ``<out>/heldout.json`` and prints a table.  All outputs stay under
the given --out directory.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
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
    TrainConfig,
    build_conditions,
    build_network,
    run_eval,
)


# ---------------------------------------------------------------------------
# panels
# ---------------------------------------------------------------------------

def heldout_intensity_panel(train_conds: list[Condition]) -> list[Condition]:
    """Same modalities/sides as training, unseen amplitudes."""
    out = []
    for c in train_conds:
        if c.light_amp:
            out.append(Condition(f"{c.name}@hi", light_side=c.light_side,
                                 light_amp=c.light_amp * 1.5))
            out.append(Condition(f"{c.name}@lo", light_side=c.light_side,
                                 light_amp=c.light_amp * 0.5))
        if c.chem_conc:
            out.append(Condition(f"{c.name}@hi", chem_species=c.chem_species,
                                 chem_side=c.chem_side, chem_conc=c.chem_conc * 1.6))
            out.append(Condition(f"{c.name}@lo", chem_species=c.chem_species,
                                 chem_side=c.chem_side, chem_conc=c.chem_conc * 0.5))
    return out


def conflicting_panel() -> list[Condition]:
    """Multimodal / bilateral combinations absent from the training panel."""
    return [
        Condition("lightL+chemB-R", light_side="left", light_amp=8.0,
                  chem_species="B", chem_side="right", chem_conc=1.0),
        Condition("lightR+chemB-L", light_side="right", light_amp=8.0,
                  chem_species="B", chem_side="left", chem_conc=1.0),
        Condition("lightL+chemA-L", light_side="left", light_amp=8.0,
                  chem_species="A", chem_side="left", chem_conc=1.0),
        Condition("lightR+chemA-R", light_side="right", light_amp=8.0,
                  chem_species="A", chem_side="right", chem_conc=1.0),
        Condition("chemA-both", chem_species="A", chem_side="all", chem_conc=1.0),
        Condition("chemB-both", chem_species="B", chem_side="all", chem_conc=1.0),
        Condition("light-all", light_side="all", light_amp=8.0),
    ]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def eval_pair(net, sim, space, theta, conds, noise_seed, n_rep, reward_cfg):
    """Score baseline and trained theta on the same conditions+seed."""
    d = space.dim
    before, resp_b = run_eval(net, sim, conds, space, np.zeros((1, d)),
                              n_rep=n_rep, noise_seed=noise_seed,
                              reward_cfg=reward_cfg)
    after, resp_a = run_eval(net, sim, conds, space, np.atleast_2d(theta),
                             n_rep=n_rep, noise_seed=noise_seed,
                             reward_cfg=reward_cfg)
    return before, after, resp_b, resp_a


def stats_row(s) -> dict:
    return {
        "reward": round(s.reward, 4),
        "fisher": round(s.fisher, 4),
        "decoder_acc": round(s.decoder_acc, 4),
        "rate_global_hz": round(s.rate_global_hz, 2),
        "rate_readout_hz": round(s.rate_readout_hz, 2),
        "penalty": round(s.penalty, 4),
    }


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ckpt", default=str(ROOT / "out-fix6"),
                    help="directory containing checkpoint.json")
    ap.add_argument("--data", default=None,
                    help="connectome json (default: from checkpoint)")
    ap.add_argument("--out", default=str(ROOT / "out-agent2" / "heldout"))
    ap.add_argument("--noise", type=float, default=1.3)
    ap.add_argument("--dt", type=float, default=1.0)
    ap.add_argument("--t-stim", type=float, default=400.0)
    ap.add_argument("--t-base", type=float, default=40.0)
    ap.add_argument("--eval-reps", type=int, default=8)
    ap.add_argument("--n-seeds", type=int, default=6,
                    help="number of unseen noise seeds")
    ap.add_argument("--seed-base", type=int, default=9000,
                    help="first unseen noise seed (must not collide with "
                         "train seed+1000 or demo eval seed+500)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    log = (lambda *a, **k: None) if args.quiet else print
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    ckpt = json.loads((Path(args.ckpt) / "checkpoint.json").read_text())
    data = args.data or ckpt["data"]
    mode = ckpt["mode"]
    theta = np.asarray(ckpt["theta_best"], dtype=np.float64)[None, :]
    train_seed = ckpt.get("seed", 0)

    conn = Connectome.load(data)
    net = build_network(conn)
    train_conds = build_conditions(conn.stimuli)
    sim = IzhikevichSim(net, SimConfig(
        dt=args.dt, t_stim=args.t_stim, t_base=args.t_base,
        noise_sigma=args.noise,
    ))
    space = ParamSpace(net, mode)
    if theta.shape[1] != space.dim:
        raise SystemExit(
            f"checkpoint dim {theta.shape[1]} != {space.describe()}"
        )
    reward_cfg = TrainConfig().reward
    log(f"checkpoint: mode={mode} dim={space.dim} seed={train_seed} "
        f"tract_gains={ckpt.get('tract_gains')}")
    log(f"held-out noise seeds: {args.seed_base}..{args.seed_base + args.n_seeds - 1} "
        f"(train used {train_seed + 1000}, demo-eval used {train_seed + 500})")

    report: dict = {"checkpoint": str(args.ckpt), "mode": mode,
                    "noise_sigma": args.noise, "eval_reps": args.eval_reps}

    # -- 1. unseen noise seeds on the TRAINING panel ------------------------
    t0 = time.perf_counter()
    log("\n=== 1. unseen noise seeds (training conditions) ===")
    log(f"  {'seed':>6}  {'metric':<14}{'before':>9}{'after':>9}{'delta':>9}")
    rows_b, rows_a = [], []
    names = [c.name for c in train_conds]
    for i in range(args.n_seeds):
        seed = args.seed_base + i
        b, a, rb, ra = eval_pair(net, sim, space, theta, train_conds,
                                 noise_seed=seed, n_rep=args.eval_reps,
                                 reward_cfg=reward_cfg)
        rows_b.append(stats_row(b))
        rows_a.append(stats_row(a))
        for k in ("reward", "fisher", "decoder_acc"):
            log(f"  {seed:>6}  {k:<14}{getattr(b, k):9.3f}"
                f"{getattr(a, k):9.3f}{getattr(a, k) - getattr(b, k):+9.3f}")
    def agg(rows):
        return {k: {"mean": round(float(np.mean([r[k] for r in rows])), 4),
                    "sd": round(float(np.std([r[k] for r in rows])), 4)}
                for k in rows[0]}
    report["unseen_noise"] = {
        "seeds": [args.seed_base + i for i in range(args.n_seeds)],
        "before": agg(rows_b), "after": agg(rows_a),
    }
    log(f"  ({time.perf_counter() - t0:.1f}s)")

    # -- 2. held-out intensities --------------------------------------------
    t0 = time.perf_counter()
    log("\n=== 2. held-out intensities ===")
    iconds = heldout_intensity_panel(train_conds)
    # joint panel: all held-out intensities decoded together (per-condition
    # single panels would be vacuous - one class is always perfectly decoded)
    bj, aj, rbj, raj = eval_pair(net, sim, space, theta, iconds,
                                 noise_seed=args.seed_base + 100,
                                 n_rep=args.eval_reps, reward_cfg=reward_cfg)
    log(f"  joint panel ({len(iconds)} conds): "
        f"acc {bj.decoder_acc:.3f} -> {aj.decoder_acc:.3f}   "
        f"fisher {bj.fisher:.3f} -> {aj.fisher:.3f}   "
        f"reward {bj.reward:.3f} -> {aj.reward:.3f}")
    report["heldout_intensities"] = {
        "conditions": [c.name for c in iconds],
        "joint": {"before": stats_row(bj), "after": stats_row(aj)},
    }
    log(f"  ({time.perf_counter() - t0:.1f}s)")

    # -- 3. conflicting / multimodal stimuli --------------------------------
    t0 = time.perf_counter()
    log("\n=== 3. conflicting & multimodal stimuli ===")
    cconds = conflicting_panel()
    bc, ac, rbc, rac = eval_pair(net, sim, space, theta, cconds,
                                 noise_seed=args.seed_base + 101,
                                 n_rep=args.eval_reps, reward_cfg=reward_cfg)
    cnames = [c.name for c in cconds]
    log(f"  joint panel ({len(cconds)} conds): "
        f"acc {bc.decoder_acc:.3f} -> {ac.decoder_acc:.3f}   "
        f"fisher {bc.fisher:.3f} -> {ac.fisher:.3f}   "
        f"reward {bc.reward:.3f} -> {ac.reward:.3f}")
    log(f"  mean readout response (Hz), before -> after:")
    log(f"    {'condition':<16}" + "".join(f"{'r' + str(i):>13}"
                                          for i in range(rbc.shape[1])))
    for ci, name in enumerate(cnames):
        cells = "".join(f"{rbc[ci, i]:5.1f}->{rac[ci, i]:5.1f}"
                        for i in range(rbc.shape[1]))
        log(f"    {name:<16}{cells}")
    report["conflicting"] = {
        "conditions": cnames,
        "before": stats_row(bc), "after": stats_row(ac),
        "resp_before": np.round(rbc, 3).tolist(),
        "resp_after": np.round(rac, 3).tolist(),
    }
    log(f"  ({time.perf_counter() - t0:.1f}s)")

    # -- 4. ablations --------------------------------------------------------
    t0 = time.perf_counter()
    log("\n=== 4. ablations (neutralise one theta group) ===")
    log("  evaluated on training conditions, seed "
        f"{args.seed_base + 102}, reward delta vs full trained")
    full_b, full_a, _, _ = eval_pair(net, sim, space, theta, train_conds,
                                     noise_seed=args.seed_base + 102,
                                     n_rep=args.eval_reps, reward_cfg=reward_cfg)
    abls: list[tuple[str, list[int]]] = []
    # group names follow ParamSpace layout
    off = 0
    for ti, tname in enumerate(net.names["types"]):
        abls.append((f"tract:{tname}", off + ti))
    off += net.n_types
    if mode in ("default", "edges"):
        abls.append(("ei", off))
        off += 1
        for si, s in enumerate(net.sensory):
            abls.append((f"sens:{s}", off + si))
        off += len(net.sensory)
    if mode == "edges":
        # ablate edge gains in three tract-sized blocks for readability
        for ti, tname in enumerate(net.names["types"]):
            m = net.etype == ti
            if m.any():
                abls.append((f"edges:{tname}",
                             [off + int(j) for j in np.flatnonzero(m)]))
    abls = [(n, v if isinstance(v, list) else [v]) for n, v in abls]

    log(f"  {'ablation':<28}{'reward':>9}{'delta':>9}{'acc':>7}{'fisher':>9}")
    ablation_rows = []
    for name, idxs in abls:
        th = theta.copy()
        for j in idxs:
            th[0, j] = 0.0          # exp(0) = 1 = neutral gain
        _, s, _, _ = eval_pair(net, sim, space, th, train_conds,
                               noise_seed=args.seed_base + 102,
                               n_rep=args.eval_reps, reward_cfg=reward_cfg)
        d = s.reward - full_a.reward
        ablation_rows.append({"ablation": name,
                              "reward": round(s.reward, 4),
                              "delta": round(d, 4),
                              "decoder_acc": round(s.decoder_acc, 4),
                              "fisher": round(s.fisher, 4)})
        if abs(d) > 0.01:
            log(f"  {name:<28}{s.reward:9.3f}{d:+9.3f}"
                f"{s.decoder_acc:7.2f}{s.fisher:9.3f}")
        else:
            log(f"  {name:<28}{s.reward:9.3f}{d:+9.3f}   (~0, not shown above)")
    report["ablations"] = {
        "seed": args.seed_base + 102,
        "full_before": stats_row(full_b),
        "full_after": stats_row(full_a),
        "rows": ablation_rows,
    }
    log(f"  ({time.perf_counter() - t0:.1f}s)")

    # -- save ----------------------------------------------------------------
    (out / "heldout.json").write_text(json.dumps(report, indent=2))
    print(f"\nheld-out report written to {out / 'heldout.json'}")


if __name__ == "__main__":
    main()
