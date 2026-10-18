"""Generate data/sample_tardigrade.json - a tardigrade-flavoured schematic.

Anatomy (approximate, hand-drawn, NOT a reconstruction):

* brain        3 lobes, 36 neurons (protocerebrum + two lower lobes)
* ventral nerve 4 segmental ganglia x 5 neurons
* outer nerve  3-neuron lateral branches per ganglion side, 8 leg motors,
               2 eyes (light) and 4 chemosensory neurons
* wiring       local brain kNN, sensory -> brain afferents, brain -> ganglion
               descending, longitudinal connectives, commissures,
               ganglion <-> outer-nerve branches, intersegmental feedback

Run:  python scripts/make_sample.py [--out data/sample_tardigrade.json]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "sample_tardigrade.json"))
    ap.add_argument("--w-scale", type=float, default=1.0,
                    help="global multiplier on all synaptic weights")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    points: list[dict] = []
    edges: list[tuple[int, int, float]] = []

    def add(x: float, y: float, typ: str, role: str, **kw) -> int:
        pid = len(points)
        p = {"id": pid, "x": round(float(x), 3), "y": round(float(y), 3),
             "type": typ, "role": role, "nt": "E"}   # explicit Dale class
        p.update(kw)                                 # designed I cells pass nt="I"
        points.append(p)
        return pid

    def link(a: int, b: int, w: float) -> None:
        if a != b:
            edges.append((a, b, w))

    # ------------------------------------------------------------------ brain
    lobes = [
        ((0.0, 2.9), 1.5, 0.7, 14),   # protocerebrum (targets for eyes/chem)
        ((-0.9, 2.2), 0.9, 0.6, 11),  # lower left lobe
        ((0.9, 2.2), 0.9, 0.6, 11),   # lower right lobe
    ]
    brain: list[int] = []
    lobe_of: dict[int, int] = {}
    for li, ((cx, cy), rx, ry, k) in enumerate(lobes):
        for j in range(k):
            ang = rng.uniform(0, 2 * np.pi)
            rad = np.sqrt(rng.uniform(0, 1))
            pid = add(cx + rx * rad * np.cos(ang), cy + ry * rad * np.sin(ang),
                      "brain", "inter", bias=1.2)
            brain.append(pid)
            lobe_of[pid] = li

    # designed parenchymal inhibition: every 4th brain neuron is inhibitory
    # (deterministic - the schema's random E/I inference previously turned
    # principal tract relays inhibitory by chance and starved whole limbs)
    for k, pid in enumerate(brain):
        if k % 4 == 3:
            points[pid]["nt"] = "I"

    # crossed inhibitory commissural interneurons (one per hemisphere):
    # local excitation -> inhibition of the other hemisphere (reciprocal
    # inhibition), the standard motif for sharpening left/right contrast
    brain_cI = [
        add(-0.25, 2.6, "brain", "inter", nt="I"),
        add(0.25, 2.6, "brain", "inter", nt="I"),
    ]

    brain_xy = np.array([[points[i]["x"], points[i]["y"]] for i in brain])
    # local kNN (3 nearest, same hemisphere only - each hemisphere is a
    # local excitable pool, cross-midline exchange happens through the
    # weak commissure links below instead of dissolving the L/R pattern)
    seen: set[tuple[int, int]] = set()
    for i, pid in enumerate(brain):
        side = -1.0 if points[pid]["x"] < 0 else 1.0
        cand = [j for j in range(len(brain))
                if points[brain[j]]["x"] * side > 0]
        d = np.linalg.norm(brain_xy[cand] - brain_xy[i], axis=1)
        order = np.array(cand)[np.argsort(d)[:3]]
        for j in order:
            a, b = sorted((pid, brain[j]))
            if (a, b) not in seen:
                seen.add((a, b))
                link(a, b, 0.3)
    # long-range links within each hemisphere
    for side in (-1.0, 1.0):
        hemi = [p for p in brain if points[p]["x"] * side > 0]
        for _ in range(6):
            a, b = (int(x) for x in rng.choice(hemi, 2, replace=False))
            link(a, b, 0.3)
    # weak brain commissure: sparse cross-midline contacts (kept small so a
    # unilateral stimulus cannot ignite the opposite hemisphere)
    left_brain = [p for p in brain if points[p]["x"] < 0]
    right_brain = [p for p in brain if points[p]["x"] > 0]
    for _ in range(6):
        a = int(rng.choice(left_brain))
        b = int(rng.choice(right_brain))
        link(a, b, 0.04)

    # --------------------------------------------------------- ventral nerve
    ganglia: list[list[int]] = []
    for gy in (1.3, 0.3, -0.7, -1.7):
        g = [
            add(-0.45, gy, "ventral_nerve", "inter", bias=1.2),
            add(-0.15, gy, "ventral_nerve", "inter", bias=1.2),
            add(0.15, gy, "ventral_nerve", "inter", bias=1.2),
            add(0.45, gy, "ventral_nerve", "inter", bias=1.2),
            add(0.0, gy + 0.2, "ventral_nerve", "inter", bias=1.2),
        ]
        ganglia.append(g)

    # local inhibitory interneurons: the inner nodes of each ganglion are
    # inhibitory (E -> I -> E feedback loops for gain control).  Earlier
    # versions used crossed inhibitory cells here, but fixed-weight
    # reciprocal inhibition turned into winner-take-all and silenced one
    # side of the caudal cord entirely.
    for g in ganglia:
        points[g[1]]["nt"] = "I"
        points[g[2]]["nt"] = "I"

    # ----------------------------------------------------------- outer nerve
    branches: list[list[list[int]]] = []   # [segment][side][chain b1,b2,b3]
    for g in ganglia:
        gy = points[g[0]]["y"]
        sides = []
        for sgn in (-1, 1):
            chain = [
                add(sgn * 0.95, gy, "outer_nerve", "inter", bias=1.2),
                add(sgn * 1.45, gy + 0.1, "outer_nerve", "inter", bias=1.2),
                add(sgn * 1.95, gy + 0.2, "outer_nerve", "motor", bias=1.2),
            ]
            sides.append(chain)
        branches.append(sides)

    posterior = [
        add(-1.95, -2.5, "outer_nerve", "motor", bias=1.2),
        add(1.95, -2.5, "outer_nerve", "motor", bias=1.2),
    ]
    eyes = [
        add(-0.85, 3.5, "outer_nerve", "sensory", modality="light",
            bias=6.5),
        add(0.85, 3.5, "outer_nerve", "sensory", modality="light",
            bias=6.5),
    ]
    chem = [
        add(-0.5, 3.9, "outer_nerve", "sensory", modality="chemical",
            bias=6.0),
        add(0.5, 3.9, "outer_nerve", "sensory", modality="chemical",
            bias=6.0),
        add(-1.2, 3.3, "outer_nerve", "sensory", modality="chemical",
            bias=6.0),
        add(1.2, 3.3, "outer_nerve", "sensory", modality="chemical",
            bias=6.0),
    ]

    # ----------------------------------------------------------------- wiring
    def nearest(cands, x, y, k):
        xy = np.array([[points[i]["x"], points[i]["y"]] for i in cands])
        d = np.linalg.norm(xy - np.array([x, y]), axis=1)
        return [cands[i] for i in np.argsort(d)[:k]]

    def nearest_ipsi(cands, x, y, k):
        # Same-side nearest: keeps the left/right pattern intact along the
        # afferent and descending channels instead of mixing it in the
        # central protocerebrum.
        sgn = -1.0 if x < 0 else 1.0
        same = [c for c in cands if points[c]["x"] * sgn > 0]
        pool = same if len(same) >= k else cands
        return nearest(pool, x, y, k)

    # reciprocal inhibition between brain hemispheres: each hemisphere
    # drives a commissural inhibitory neuron that silences the other side
    bl, br = brain_cI
    for tgt in nearest_ipsi(brain, -0.25, 2.6, 3):
        link(tgt, bl, 0.4)
    for tgt in nearest(right_brain, 0.25, 2.6, 3):
        link(bl, tgt, 0.4)
    for tgt in nearest_ipsi(brain, 0.25, 2.6, 3):
        link(tgt, br, 0.4)
    for tgt in nearest(left_brain, -0.25, 2.6, 3):
        link(br, tgt, 0.4)

    # eyes / chem -> brain afferents (ipsilateral)
    for sid in eyes + chem:
        px, py = points[sid]["x"], points[sid]["y"]
        w = 1.2 if sid in eyes else 0.6   # photoreceptor axons are thick
        for tgt in nearest_ipsi(brain, px, py, 2):
            link(sid, tgt, w)

    # eyes / chem -> top ganglion: direct segmental reflex arc that keeps
    # the left/right pattern short-circuiting the long brain route.  The
    # reflex is deliberately weaker than the brain route's total drive:
    # at 1.2 it saturated the top ganglion (~50 Hz) and starved every
    # deeper segment of dynamic range.
    top = ganglia[0]
    for sid in eyes + chem:
        px, py = points[sid]["x"], points[sid]["y"]
        w = 0.9 if sid in eyes else 0.45
        for tgt in nearest_ipsi(top, px, py, 2):
            link(sid, tgt, w)

    # lower brain -> descending: nearest ganglion (strong) plus symmetric
    # branches to the deeper segmental ganglia so the caudal segments and
    # their leg motors are not starved of central drive - otherwise every
    # descending axon terminates in the top ganglion and only the first
    # leg pair carries the readout signal.  Two sources per deep lateral
    # node on each side keeps the left/right counts exactly balanced.
    lower = [p for p in brain if points[p]["y"] < 2.5]
    allg = [i for g in ganglia for i in g]
    lower_left = [p for p in lower if points[p]["x"] < 0]
    lower_right = [p for p in lower if points[p]["x"] > 0]
    for pid in lower:
        px, py = points[pid]["x"], points[pid]["y"]
        link(pid, nearest_ipsi(allg, px, py, 1)[0], 0.4)
    for gi, g in enumerate(ganglia[1:]):
        for k in range(2):
            src = lower_left[(2 * gi + k) % len(lower_left)]
            link(src, g[0], 0.25)
            link(src, g[1], 0.25)
            src = lower_right[(2 * gi + k) % len(lower_right)]
            link(src, g[2], 0.25)
            link(src, g[3], 0.25)
    for pid in ganglia[0]:
        for tgt in nearest_ipsi(brain, points[pid]["x"], points[pid]["y"], 2):
            link(pid, tgt, 0.35)

    # longitudinal connectives (both directions); strong enough that the
    # caudal ganglia follow the top ganglion's lateralised state instead
    # of idling at 1-4 Hz (the cord otherwise dies after the first segment)
    for i in range(len(ganglia) - 1):
        for a, bb in zip(ganglia[i], ganglia[i + 1]):
            link(a, bb, 0.875)
            link(bb, a, 0.875)

    # commissures within each ganglion (weaker than ipsilateral paths so
    # they average L/R without erasing the lateralised pattern)
    for g in ganglia:
        link(g[0], g[3], 0.08)

    # local inhibition: ipsilateral lateral node -> inner inhibitory
    # interneuron -> back onto the lateral node (feedback gain control;
    # stays ipsilateral so it cannot break left/right symmetry).  Kept
    # weak: strong loops clip each side's rate and the side contrast
    # decays to zero before reaching the caudal segments.
    for g in ganglia:
        link(g[0], g[1], 0.25)
        link(g[1], g[0], 0.2)
        link(g[3], g[2], 0.25)
        link(g[2], g[3], 0.2)

    # ganglion lateral nodes <-> outer-nerve branch (both directions)
    for gi, g in enumerate(ganglia):
        for side_i, chain in enumerate(branches[gi]):
            lat = g[0] if side_i == 0 else g[3]
            inner = g[1] if side_i == 0 else g[2]
            link(lat, chain[0], 0.35)
            link(chain[0], lat, 0.35)
            link(inner, chain[0], 0.15)  # local inhibition reaches the branch
            # branch chain: efferent distal + local feedback
            link(chain[0], chain[1], 0.5)
            link(chain[1], chain[2], 1.5)
            link(chain[1], chain[0], 0.30)
            # direct ganglion -> leg motor neuron (segmental motor pool);
            # strong so the motor pool faithfully follows the lateralised
            # segmental state instead of sitting on its own tonic drive
            link(lat, chain[2], 2.4)
            link(chain[2], lat, 0.4)

    # intersegmental outer-nerve coupling (anterior <-> posterior)
    for gi in range(len(ganglia) - 1):
        for side_i in range(2):
            a = branches[gi][side_i][1]
            b = branches[gi + 1][side_i][0]
            link(a, b, 0.3)
            link(b, a, 0.25)

    # posterior legs <- last ganglion (both directions)
    last_g = ganglia[-1]
    for m in posterior:
        src = nearest(last_g, points[m]["x"], points[m]["y"], 1)[0]
        link(src, m, 2.4)
        link(m, src, 0.4)

    # --------------------------------------------------------------- assemble
    # per-tract scale factors tuned so the untrained network carries
    # stimulus information all the way to the motor readout.  brain is
    # deliberately moderate: too strong recurrent gain turns the network
    # into a global ignition switch that erases left/right structure.
    TRACT_SCALE = {"brain": 2.5, "ventral_nerve": 1.5, "outer_nerve": 1.5}
    AFFERENT_SCALE = 4.0
    INTER_BIAS = 2.0    # graded tonic drive: alive but subcritical, so each
                        # hemisphere sits near threshold instead of silent
    sensory_bias = {"light": 7.3, "chemical": 6.8}

    type_of = {p["id"]: p["type"] for p in points}
    sensory_ids = {p["id"] for p in points if p.get("modality")}

    def edge_type(a: int, b: int) -> str:
        ta, tb = type_of[a], type_of[b]
        if "outer_nerve" in (ta, tb):
            return "outer_nerve"
        if "ventral_nerve" in (ta, tb):
            return "ventral_nerve"
        return "brain"

    conns = []
    for a, b, w in edges:
        if a in sensory_ids:
            scale = AFFERENT_SCALE
        else:
            scale = TRACT_SCALE[edge_type(a, b)]
        conns.append({"pre": a, "post": b,
                      "weight": round(w * scale * args.w_scale, 4)})

    for p in points:
        if p["role"] == "sensory":
            p["bias"] = sensory_bias[p["modality"]]
        else:
            p["bias"] = INTER_BIAS

    doc = {
        "name": "tardigrade-sample",
        "points": points,
        "connections": conns,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=2))

    n_type = {}
    for p in points:
        n_type[p["type"]] = n_type.get(p["type"], 0) + 1
    print(f"wrote {out}: {len(points)} points {n_type}, {len(edges)} connections")


if __name__ == "__main__":
    main()
