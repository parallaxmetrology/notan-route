"""The route: the order in which a picture's Notan masses lead from one to the next.

What it computes, and nothing more:

1. Targets. The Notan mass (`parallax_notan.notan_mass`) is cut at its own flat threshold
   (TAU_VOID) and split by polarity (darker or lighter than the median ground, as in
   `parallax_notan.value_map`). Within one polarity, the mass is split again wherever it
   dips between two peaks by at least TAU_VOID (h-maxima markers, then a watershed), so
   two masses joined only by a blurred halo stay two. Each piece is a target. Pieces smaller
   than MIN_AREA of the frame are dropped and their share of the mass is reported. A
   target's strength is its summed mass divided by the strongest target's.

2. Connection. Along the straight segment between two anchors, the mean of the mass
   divided by the weaker anchor's mass, clipped to 0..1, and the longest stretch of flat
   ground (mass below TAU_VOID) on it. 1 means the mass never drops below the weaker end;
   0 means the segment is flat ground. Values clipped at 1 are counted in `saturation`.

3. The route. From a start point, every unvisited target is scored

       strength x exp(-d^2 / 2 SIGMA^2) x (1 - K_CONN + K_CONN x connection) x return_damping

   and the best one is taken. d is the distance from the current stop (fractions of the
   frame's longest side). return_damping lowers targets near stops already taken. No
   randomness; ties go to the stronger target. The route stops when every target is taken
   or the best score falls below FLOOR (the first stop is always taken).

4. The transition field. Release the route from every target, and separately follow the
   memoryless successor (the best next target from each target, with no history). Cycles
   and basins of that successor graph, how often each target is reached, and how much the
   set of visited targets depends on where the route starts. A single route is one sample
   of this field.

The route is a property of the mass map and these four parameters. It makes no claim about
eyes, gaze, attention or viewing order.
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from parallax_notan.colour import ensure_rgb01, load_rgb, luminance
from parallax_notan.notan import TAU_VOID, notan_mass, resize_work
from scipy.ndimage import gaussian_filter, label
from skimage.morphology import h_maxima
from skimage.segmentation import watershed

SIGMA = 0.22          # proximity falloff, fraction of the frame's longest side
K_CONN = 0.5          # weight of connection: a fully flat segment scores (1 - K_CONN) of a carried one
RETURN_SIGMA = 0.11   # radius of the damping around stops already taken
RETURN_DAMP = 0.85    # how hard a taken stop damps its neighbourhood (0..1)
FLOOR = 0.02          # the route ends when the best remaining score is below this
MIN_AREA = 0.005      # targets smaller than this fraction of the frame are dropped
POLARITY_SIGMA = 8.0  # blur for the darker/lighter split, as in parallax_notan.value_map
EPS = 1e-12
SCHEMA = "notan-route/0.1"


@dataclass
class Reading:
    """Everything the route needs from one image, computed once."""
    mass: np.ndarray
    on_mass: np.ndarray
    darker: np.ndarray
    h: int
    w: int
    targets: list = field(default_factory=list)
    labels: np.ndarray | None = None        # target id per pixel, -1 where there is no target
    dropped: dict = field(default_factory=dict)
    _conn: dict = field(default_factory=dict, repr=False)

    @property
    def span(self) -> int:
        return max(self.h, self.w) - 1

    def to_xy(self, col: float, row: float) -> tuple[float, float]:
        return ((col - (self.w - 1) / 2) / self.span, (row - (self.h - 1) / 2) / self.span)

    def to_px(self, x: float, y: float) -> tuple[float, float]:
        return (x * self.span + (self.w - 1) / 2, y * self.span + (self.h - 1) / 2)


def _rgb(image) -> np.ndarray:
    return ensure_rgb01(image) if isinstance(image, np.ndarray) else load_rgb(image)


def read(image) -> Reading:
    """Read an image (path or array) into masses. Accepts an existing Reading unchanged."""
    if isinstance(image, Reading):
        return image
    rgb = resize_work(_rgb(image))
    mass = notan_mass(rgb)
    lum = luminance(rgb).astype(np.float64)
    darker = gaussian_filter(lum, POLARITY_SIGMA) < float(np.median(lum))
    on = mass >= TAU_VOID
    h, w = mass.shape
    rd = Reading(mass=mass, on_mass=on, darker=darker, h=h, w=w)
    rd.labels = np.full((h, w), -1, int)
    total = float(mass.sum())
    min_px = MIN_AREA * h * w
    yy, xx = np.mgrid[0:h, 0:w]
    raw, n_drop, drop_mass = [], 0, 0.0
    eight = np.ones((3, 3), int)
    for pol, side in (("dark", darker), ("light", ~darker)):
        lab, n = _split(mass, on & side, eight)
        for k in range(1, n + 1):
            sel = lab == k
            area = int(sel.sum())
            m = float(mass[sel].sum())
            if area < min_px:
                n_drop += 1
                drop_mass += m
                continue
            wts = mass[sel]
            cx = float((xx[sel] * wts).sum() / m)
            cy = float((yy[sel] * wts).sum() / m)
            # anchor: the region's own pixel nearest its mass centroid, so it always lies on the mass
            d2 = (xx[sel] - cx) ** 2 + (yy[sel] - cy) ** 2
            i = int(np.argmin(d2))
            ax, ay = int(xx[sel][i]), int(yy[sel][i])
            ys, xs = np.nonzero(sel)
            raw.append({"polarity": pol, "mass": m, "area": area, "anchor_px": (ax, ay),
                        "centroid_px": (cx, cy),
                        "bbox_px": (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
                        "_sel": sel})
    raw.sort(key=lambda r: (-r["mass"], r["anchor_px"][1], r["anchor_px"][0]))
    top = raw[0]["mass"] if raw else 1.0
    for i, r in enumerate(raw):
        rd.labels[r["_sel"]] = i
        ax, ay = rd.to_xy(*r["anchor_px"])
        cx, cy = rd.to_xy(*r["centroid_px"])
        rd.targets.append({
            "id": i, "polarity": r["polarity"],
            "x": round(ax, 4), "y": round(ay, 4),
            "centroid": [round(cx, 4), round(cy, 4)],
            "strength": round(r["mass"] / top, 4),
            "mass_share": round(r["mass"] / total, 4) if total > EPS else 0.0,
            "area": round(r["area"] / (h * w), 4),
            "bbox_px": list(r["bbox_px"]),
            "_x": ax, "_y": ay, "_s": r["mass"] / top,
        })
    rd.dropped = {"n": n_drop, "mass_share": round(drop_mass / total, 4) if total > EPS else 0.0}
    return rd


def _split(mass: np.ndarray, region: np.ndarray, eight: np.ndarray) -> tuple[np.ndarray, int]:
    """Split one polarity's mass at saddles at least TAU_VOID deep."""
    m = np.where(region, mass, 0.0)
    if not region.any():
        return np.zeros(mass.shape, int), 0
    markers, n = label(h_maxima(m, TAU_VOID).astype(bool) & region, structure=eight)
    if n == 0:
        return label(region, structure=eight)
    lab = watershed(-m, markers, mask=region, connectivity=2)
    # a region with no marker (no peak TAU_VOID above its surround) gets its own label
    rest, k = label(region & (lab == 0), structure=eight)
    lab[rest > 0] = rest[rest > 0] + n
    return lab, n + k


def _segment(rd: Reading, a, b, ref: float | None = None) -> tuple[float, float]:
    (c0, r0), (c1, r1) = rd.to_px(*a), rd.to_px(*b)
    n = max(2, int(math.ceil(math.hypot(c1 - c0, r1 - r0))) + 1)
    cs = np.clip(np.rint(np.linspace(c0, c1, n)).astype(int), 0, rd.w - 1)
    rs = np.clip(np.rint(np.linspace(r0, r1, n)).astype(int), 0, rd.h - 1)
    m = rd.mass[rs, cs]
    on = rd.on_mass[rs, cs]
    if ref is None:                         # weaker end, read off the map
        ref = min(float(m[0]), float(m[-1]))
    carried = float(np.clip(m / ref, 0.0, 1.0).mean()) if ref > EPS else 0.0
    run = best = 0
    for v in on:
        run = 0 if v else run + 1
        best = max(best, run)
    step = math.hypot(a[0] - b[0], a[1] - b[1]) / (n - 1)
    return carried, best * step


def connection(image, a, b) -> dict:
    """Connection between points a and b (route coordinates: x, y centred on the frame and
    divided by its longest side). Returns the mass carried along the straight segment
    (0..1, relative to the weaker end) and the longest flat stretch on it, in the same units."""
    rd = read(image)
    c, gap = _segment(rd, a, b)
    return {"connection": round(c, 4), "longest_gap": round(gap, 4)}


def _conn(rd: Reading, i: int, j: int) -> float:
    key = (min(i, j), max(i, j))
    if key not in rd._conn:
        ti, tj = rd.targets[i], rd.targets[j]
        rd._conn[key] = _segment(rd, (ti["_x"], ti["_y"]), (tj["_x"], tj["_y"]))[0]
    return rd._conn[key]


def _score(rd: Reading, t: dict, pin, pin_id, taken_xy, p: dict) -> float:
    d2 = (t["_x"] - pin[0]) ** 2 + (t["_y"] - pin[1]) ** 2
    near = math.exp(-d2 / (2.0 * p["sigma"] ** 2)) if p["sigma"] is not None else 1.0
    c = _conn(rd, pin_id, t["id"]) if pin_id is not None else _segment(rd, pin, (t["_x"], t["_y"]))[0]
    damp = 1.0
    for (vx, vy) in taken_xy:
        dv = (t["_x"] - vx) ** 2 + (t["_y"] - vy) ** 2
        damp *= 1.0 - p["return_damp"] * math.exp(-dv / (2.0 * p["return_sigma"] ** 2))
    return t["_s"] * near * (1.0 - p["k_conn"] + p["k_conn"] * c) * damp


def _best(rd: Reading, pin, pin_id, taken: set, taken_xy, p: dict) -> tuple[dict | None, float]:
    best, bs = None, -1.0
    for t in rd.targets:                      # targets are in strength order, so a tie keeps the stronger
        if t["id"] in taken:
            continue
        s = _score(rd, t, pin, pin_id, taken_xy, p)
        if s > bs + EPS:
            best, bs = t, s
    return best, bs


def _kendall(order: list[int], reference: list[int]) -> float:
    """Share of pairs in `order` that `reference` puts the other way round (0 = same order)."""
    pos = {k: i for i, k in enumerate(reference)}
    seq = [pos[k] for k in order if k in pos]
    n = len(seq)
    if n < 2:
        return 0.0
    disc = sum(1 for i in range(n) for j in range(i + 1, n) if seq[i] > seq[j])
    return disc / (n * (n - 1) / 2)


def _nearest_first(rd: Reading, start_pin, start_id, ids: list[int]) -> list[int]:
    """Control: the same stops visited nearest-first from the same start (no strength, no connection)."""
    left = list(ids)
    out, pin = [], start_pin
    if start_id is not None:
        out.append(start_id)
        left.remove(start_id)
        t = rd.targets[start_id]
        pin = (t["_x"], t["_y"])
    while left:
        k = min(left, key=lambda i: ((rd.targets[i]["_x"] - pin[0]) ** 2 + (rd.targets[i]["_y"] - pin[1]) ** 2, i))
        out.append(k)
        left.remove(k)
        pin = (rd.targets[k]["_x"], rd.targets[k]["_y"])
    return out


def _start(rd: Reading, start):
    if start in (None, "centre", "center"):
        return (0.0, 0.0), None
    if start == "strongest":
        start = 0
    if isinstance(start, (int, np.integer)) and not isinstance(start, bool):
        if not 0 <= int(start) < len(rd.targets):
            raise ValueError(f"start target {start} does not exist ({len(rd.targets)} targets)")
        t = rd.targets[int(start)]
        return (t["_x"], t["_y"]), int(start)
    if isinstance(start, (tuple, list)) and len(start) == 2:
        return (float(start[0]), float(start[1])), None
    raise ValueError(f"unknown start {start!r}: use 'centre', 'strongest', a target id, or (x, y)")


def _public(t: dict) -> dict:
    return {k: v for k, v in t.items() if not k.startswith("_")}


def targets(image) -> dict:
    """The masses the route walks over, strongest first (id 0 is the strongest)."""
    rd = read(image)
    return {"schema": SCHEMA, "n_targets": len(rd.targets), "targets": [_public(t) for t in rd.targets],
            "dropped": rd.dropped, "work_px": [rd.w, rd.h], "abstain": not rd.targets}


def _walk(rd: Reading, start, p: dict) -> tuple[list[dict], str]:
    pin, pin_id = _start(rd, start)
    taken, taken_xy, stops = set(), [], []
    if pin_id is not None:
        t = rd.targets[pin_id]
        stops.append({**_public(t), "order": 0, "score": None, "connection_in": None})
        taken.add(pin_id)
        taken_xy.append((t["_x"], t["_y"]))
    stopped = "all targets taken"
    while len(taken) < len(rd.targets):
        best, bs = _best(rd, pin, pin_id, taken, taken_xy, p)
        if stops and bs < p["floor"]:
            stopped = "floor"
            break
        c = _conn(rd, pin_id, best["id"]) if pin_id is not None else _segment(rd, pin, (best["_x"], best["_y"]))[0]
        stops.append({**_public(best), "order": len(stops), "score": round(bs, 4), "connection_in": round(c, 4)})
        taken.add(best["id"])
        taken_xy.append((best["_x"], best["_y"]))
        pin, pin_id = (best["_x"], best["_y"]), best["id"]
    return stops, stopped


def route(image, start="centre", **overrides) -> dict:
    """One route. start: 'centre' (default), 'strongest', a target id, or a point (x, y).
    overrides: any of sigma, k_conn, return_sigma, return_damp, floor (see params())."""
    rd = read(image)
    p = params(**overrides)
    base = {"schema": SCHEMA, "n_targets": len(rd.targets), "dropped": rd.dropped,
            "work_px": [rd.w, rd.h], "params": p}
    if not rd.targets:
        return {**base, "start": start if isinstance(start, str) else list(start) if isinstance(start, tuple) else start,
                "stops": [], "abstain": True, "note": "abstain: no mass regions to walk"}
    pin, pin_id = _start(rd, start)
    stops, stopped = _walk(rd, start, p)
    order = [s["id"] for s in stops]
    near = _nearest_first(rd, pin, pin_id, order)
    reached = sum(rd.targets[i]["mass_share"] for i in order)
    total = sum(t["mass_share"] for t in rd.targets)
    return {
        **base,
        "start": {"x": round(pin[0], 4), "y": round(pin[1], 4), "target": pin_id},
        "stops": stops,
        "stopped_by": stopped,
        "reach": round(reached / total, 4) if total > EPS else 0.0,
        "departure_from_strongest_first": round(_kendall(order, sorted(order)), 4),
        "departure_from_nearest_first": round(_kendall(order, near), 4),
        "strongest_first": order[:1] == [0],
        "abstain": False,
        "note": "one sample of the transition field: the order depends on the start",
    }


def params(**overrides) -> dict:
    """The scoring parameters, with any overrides. sigma=None turns proximity off (every
    distance scores the same); k_conn=0 turns connection off."""
    p = {"sigma": SIGMA, "k_conn": K_CONN, "return_sigma": RETURN_SIGMA, "return_damp": RETURN_DAMP,
         "floor": FLOOR}
    bad = set(overrides) - set(p)
    if bad:
        raise ValueError(f"unknown parameters {sorted(bad)}; known: {sorted(p)}")
    p.update(overrides)
    return {**p, "min_area": MIN_AREA, "tau_void": TAU_VOID}


def _successor(rd: Reading, p: dict) -> dict[int, int | None]:
    """Memoryless successor: from each target, the best other target with no history."""
    out = {}
    for t in rd.targets:
        best, bs = _best(rd, (t["_x"], t["_y"]), t["id"], {t["id"]}, [(t["_x"], t["_y"])], p)
        out[t["id"]] = best["id"] if best is not None and bs >= p["floor"] else None
    return out


def _basins(succ: dict[int, int | None]) -> list[dict]:
    """Each target drains along successors into a terminal cycle or a dead end (a sink)."""
    ends: dict[int, tuple] = {}
    for k in succ:
        path, cur, seen = [], k, {}
        while cur is not None and cur not in seen and cur not in ends:
            seen[cur] = len(path)
            path.append(cur)
            cur = succ[cur]
        if cur is None:
            end = (path[-1],)                                  # dead end: the last node is a sink
        elif cur in ends:
            end = ends[cur]
        else:
            cyc = path[seen[cur]:]
            i = cyc.index(min(cyc))
            end = tuple(cyc[i:] + cyc[:i])
        for p in path:
            ends[p] = end
    groups: dict[tuple, list[int]] = {}
    for k, e in ends.items():
        groups.setdefault(e, []).append(k)
    return [{"end": list(e), "kind": "cycle" if len(e) > 1 else "sink", "members": sorted(m)}
            for e, m in groups.items()]


def transition_field(image, **overrides) -> dict:
    """The main readout: release the route from every target and read the flow."""
    rd = read(image)
    p = params(**overrides)
    base = {"schema": SCHEMA, "n_targets": len(rd.targets), "dropped": rd.dropped,
            "work_px": [rd.w, rd.h], "params": p}
    if not rd.targets:
        return {**base, "nodes": [], "successor": {}, "basins": [], "cycles": [], "abstain": True,
                "note": "abstain: no mass regions"}
    n = len(rd.targets)
    tours = [[s["id"] for s in _walk(rd, t["id"], p)[0]] for t in rd.targets]
    visit = Counter()
    for tr in tours:
        visit.update(set(tr))
    traffic = Counter()
    for tr in tours:
        traffic.update(zip(tr, tr[1:]))
    succ = _successor(rd, p)
    indeg = Counter(v for v in succ.values() if v is not None)
    basins = _basins(succ)
    share = {t["id"]: t["mass_share"] for t in rd.targets}
    tot = sum(share.values()) or 1.0
    for b in basins:
        b["mass_share"] = round(sum(share[m] for m in b["members"]) / tot, 4)
        b["n_members"] = len(b["members"])
    basins.sort(key=lambda b: (-b["n_members"], -b["mass_share"], b["end"]))
    sets = [set(tr) for tr in tours]
    jac = [len(sets[i] & sets[j]) / len(sets[i] | sets[j]) for i in range(n) for j in range(i + 1, n)]
    entry_stability = round(sum(jac) / len(jac), 4) if jac else 1.0
    deps = [_kendall(tr, sorted(tr)) for tr in tours]
    pairs = [_conn(rd, i, j) for i in range(n) for j in range(i + 1, n)]
    nodes = [{**_public(t), "in_degree": int(indeg.get(t["id"], 0)),
              "visitation": round(visit[t["id"]] / n, 4), "successor": succ[t["id"]]} for t in rd.targets]
    return {
        **base,
        "nodes": nodes,
        "successor": {str(k): v for k, v in succ.items()},
        "basins": basins,
        "n_basins": len(basins),
        "releases": {str(tr[0]): tr for tr in tours},
        "cycles": [b["end"] for b in basins if b["kind"] == "cycle"],
        "dominant_transitions": [{"from": a, "to": b, "share_of_releases": round(c / n, 4)}
                                 for (a, b), c in sorted(traffic.items(), key=lambda kv: (-kv[1], kv[0]))[:8]],
        "entry_stability": entry_stability,
        "mean_route_length": round(sum(len(tr) for tr in tours) / n, 3),
        "mean_departure_from_strongest_first": round(sum(deps) / n, 4),
        "saturation": {
            "connection_pairs": len(pairs),
            "connection_at_1": round(sum(c >= 1.0 for c in pairs) / len(pairs), 4) if pairs else None,
            "connection_at_0": round(sum(c <= 0.0 for c in pairs) / len(pairs), 4) if pairs else None,
            "visitation_at_1": round(sum(visit[t["id"]] == n for t in rd.targets) / n, 4),
            "entry_stability_at_1": entry_stability >= 1.0,
            "strength_note": "strength is divided by the strongest target, so target 0 is always 1.0",
        },
        "abstain": False,
        "note": ("released from every target. successor = best next target from each target with no "
                 "history; basins = where the successor graph drains (a cycle or a dead end); "
                 "visitation = share of releases that reach a target; entry_stability = mean Jaccard "
                 "of the visited sets (1 = the same targets whatever the start)"),
    }
