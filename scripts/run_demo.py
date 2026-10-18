"""End-to-end demo: load points+connections+types -> train -> report.

    python scripts/run_demo.py --data data/sample_tardigrade.json
    python scripts/run_demo.py --gens 50 --mode edges   # richer parameter space

Steps: load/validate schema -> build network -> simulate baseline (theta=0)
-> CMA-ES on intrinsic selectivity -> re-evaluate -> print comparison and
save figures/checkpoint under out/.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurorender import (  # noqa: E402
    Connectome,
    IzhikevichSim,
    ParamSpace,
    SimConfig,
    TrainConfig,
    build_conditions,
    build_network,
    run_eval,
    train,
)
from neurorender import metrics  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=str(ROOT / "data" / "sample_tardigrade.json"))
    ap.add_argument("--out", default=str(ROOT / "out"))
    ap.add_argument("--mode", default="default", choices=["pathway", "default", "edges"])
    ap.add_argument("--gens", type=int, default=30)
    ap.add_argument("--pop", type=int, default=None)
    ap.add_argument("--reps", type=int, default=3, help="replicates per condition")
    ap.add_argument("--eval-reps", type=int, default=6)
    ap.add_argument("--sigma", type=float, default=0.35)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dt", type=float, default=1.0, help="integration step, ms")
    ap.add_argument("--t-stim", type=float, default=400.0, help="stimulus window, ms")
    ap.add_argument("--t-base", type=float, default=40.0, help="baseline, ms")
    ap.add_argument("--noise", type=float, default=1.3, help="noise sigma")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    log = (lambda *a, **k: None) if args.quiet else print
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # -- 1. anatomy ---------------------------------------------------------
    conn = Connectome.load(args.data)
    net = build_network(conn)
    log(conn.summary())
    conditions = build_conditions(conn.stimuli)
    log("conditions: " + ", ".join(c.name for c in conditions))

    # -- 2. simulator -------------------------------------------------------
    sim_cfg = SimConfig(
        dt=args.dt, t_stim=args.t_stim, t_base=args.t_base,
        noise_sigma=args.noise,
    )
    sim = IzhikevichSim(net, sim_cfg)
    space = ParamSpace(net, args.mode)
    log(f"sim: dt={sim_cfg.dt}ms  steps={sim_cfg.n_base + sim_cfg.n_stim}  "
        f"window={sim_cfg.t_stim}ms  {space.describe()}")

    # -- 3. baseline (untrained, theta = 0) ---------------------------------
    t0 = time.perf_counter()
    theta0 = space.dim
    import numpy as np
    before, resp_b = run_eval(
        net, sim, conditions, space, np.zeros((1, theta0)),
        n_rep=args.eval_reps, noise_seed=args.seed + 500,
        reward_cfg=TrainConfig().reward,
    )
    log(f"baseline: reward={before.reward:.3f} fisher={before.fisher:.2f} "
        f"acc={before.decoder_acc:.2f} rate={before.rate_global_hz:.1f}Hz "
        f"({time.perf_counter() - t0:.1f}s)")

    # -- 4. train -----------------------------------------------------------
    t0 = time.perf_counter()
    result = train(net, sim, conditions, TrainConfig(
        mode=args.mode, gens=args.gens, pop=args.pop, sigma=args.sigma,
        seed=args.seed, reps=args.reps, eval_reps=args.eval_reps,
    ), log=log)
    dt_train = time.perf_counter() - t0
    log(f"trained in {dt_train:.1f}s "
        f"({dt_train / max(1, args.gens):.1f}s/generation)")

    # -- 5. after -----------------------------------------------------------
    after, resp_a = run_eval(
        net, sim, conditions, space, result.theta_best,
        n_rep=args.eval_reps, noise_seed=args.seed + 500,
        reward_cfg=TrainConfig().reward,
    )
    names = [c.name for c in conditions]
    print()
    print(metrics.comparison_text(before, after, names, resp_b, resp_a))
    print()

    # -- 6. artefacts -------------------------------------------------------
    metrics.save_json(result.history, out / "history.json")
    tract_gain = np.exp(np.clip(result.theta_best[:3], -3, 3))
    checkpoint = {
        "data": str(args.data),
        "mode": result.mode,
        "dim": result.dim,
        "seed": args.seed,
        "theta_best": result.theta_best.tolist(),
        "tract_gains": dict(zip(("brain", "ventral_nerve", "outer_nerve"),
                                np.round(tract_gain, 4).tolist())),
        "before": vars(before),
        "after": vars(after),
        "train_seconds": round(dt_train, 2),
    }
    metrics.save_json(checkpoint, out / "checkpoint.json")
    metrics.plot_history(result.history, out / "curve.png")
    metrics.plot_responses(resp_b, resp_a, names, out / "responses.png")
    print(f"artefacts in {out}/: history.json, checkpoint.json, curve.png, "
          f"responses.png")


if __name__ == "__main__":
    main()
