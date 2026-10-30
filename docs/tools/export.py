"""Export a picture's drainage field from notan-route, unchanged.

For every cell of a grid over the picture:
  landing[c] = the first stop of notan_route.route(start=cell centre)   (exact library call path)
  inside[c]  = the target the cell lies in (-1 on flat ground or dropped marks)
The page draws streamlines towards landing[c]; with "onward" on, a cell inside target i
points to successor[i] instead, so lines carry on through the masses to the basin ends.

Run with the notan-route venv:
  python docs/tools/export.py docs/paintings/*.jpg     (from the repo root)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from notan_route import route as nr_route
from notan_route import transition_field
from notan_route.draw import notan3
from notan_route.route import _best, params, read

STEP = 4          # grid cell, in work pixels (work size is 512 on the long side)
CHECKS = 40       # cells re-checked against the public route() call


def export(path: Path, out: Path) -> dict:
    t0 = time.time()
    rd = read(str(path))
    p = params()
    field = transition_field(rd)
    succ = {int(k): v for k, v in field["successor"].items()}
    basin_of = {}
    for bi, b in enumerate(field["basins"]):
        for m in b["members"]:
            basin_of[m] = bi

    cols = np.arange(STEP / 2 - 0.5, rd.w - 0.5, STEP)
    rows = np.arange(STEP / 2 - 0.5, rd.h - 0.5, STEP)
    gw, gh = len(cols), len(rows)
    landing = np.full((gh, gw), -1, int)
    inside = np.full((gh, gw), -1, int)
    for r, row in enumerate(rows):
        for c, col in enumerate(cols):
            x, y = rd.to_xy(col, row)
            best, _ = _best(rd, (x, y), None, set(), [], p)   # same call as route(start=(x, y))'s first stop
            landing[r, c] = best["id"] if best is not None else -1
            inside[r, c] = rd.labels[int(round(row)), int(round(col))]

    # receipt: the grid agrees with the public API on a fixed spread of cells
    agree, idx = 0, np.linspace(0, gw * gh - 1, CHECKS).astype(int)
    for k in idx:
        r, c = divmod(int(k), gw)
        x, y = rd.to_xy(cols[c], rows[r])
        first = nr_route(rd, start=(x, y))["stops"][0]["id"]
        agree += int(first == landing[r, c])

    # Step fields: a route's first k stops taken (and damped) as in notan-route's _walk.
    # From each cell, the next stop that route would pick with that history; -1 where the
    # best score is under the floor (the route would end there).
    histories = {}
    for label, start in (("centre", "centre"), ("strongest", "strongest")):
        stops = [s["id"] for s in nr_route(rd, start=start)["stops"]]
        steps, check = [], []
        for k in range(1, len(stops) + 1):
            taken = set(stops[:k])
            taken_xy = [(rd.targets[i]["_x"], rd.targets[i]["_y"]) for i in stops[:k]]
            g = np.full((gh, gw), -1, int)
            for r, row in enumerate(rows):
                for c, col in enumerate(cols):
                    best, bs = _best(rd, rd.to_xy(col, row), None, taken, taken_xy, p)
                    if best is not None and bs >= p["floor"]:
                        g[r, c] = best["id"]
            steps.append(g.ravel().tolist())
            # receipt: the same rule, evaluated at stop k's own position, gives the route's stop k+1
            here = rd.targets[stops[k - 1]]
            best, bs = _best(rd, (here["_x"], here["_y"]), None, taken, taken_xy, p)
            got = best["id"] if best is not None and bs >= p["floor"] else None
            check.append(got == (stops[k] if k < len(stops) else None))
        histories[label] = {"stops": stops, "steps": steps,
                            "next_stop_check": f"{sum(check)}/{len(check)}"}

    name = path.stem
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray((notan3(rd) * 255).astype(np.uint8)).save(out / f"{name}_notan.png")
    Image.open(path).convert("RGB").resize((rd.w, rd.h), Image.LANCZOS).save(out / f"{name}_image.jpg", quality=90)
    lab = rd.labels.astype(np.int16)
    edge = np.zeros_like(rd.on_mass)
    edge[:-1] |= lab[:-1] != lab[1:]
    edge[:, :-1] |= lab[:, :-1] != lab[:, 1:]

    data = {
        "schema": "notan-drainage/0.1",
        "source": path.name,
        "work_px": [rd.w, rd.h],
        "span": rd.span,
        "grid": {"step": STEP, "w": gw, "h": gh, "col0": float(cols[0]), "row0": float(rows[0])},
        "landing": landing.ravel().tolist(),
        "inside": inside.ravel().tolist(),
        "targets": [{"id": t["id"], "x": t["_x"], "y": t["_y"], "strength": round(t["_s"], 4),
                     "polarity": t.get("polarity"), "mass_share": t["mass_share"],
                     "successor": succ.get(t["id"]), "basin": basin_of.get(t["id"])}
                    for t in rd.targets],
        "basins": field["basins"],
        "entry_stability": field.get("entry_stability"),
        "params": p,
        "histories": histories,
        "receipt": {"cells": gw * gh, "checked_against_route": len(idx), "agree": agree,
                    "seconds": round(time.time() - t0, 1)},
        "abstain": field["abstain"],
    }
    (out / f"{name}.json").write_text(json.dumps(data))
    return data


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent
    names = []
    for arg in sys.argv[1:]:
        d = export(Path(arg), here / "data")
        names.append(Path(arg).stem)
        print(f"{Path(arg).name}: {len(d['targets'])} targets, {len(d['basins'])} basins, "
              f"receipt {d['receipt']}; "
              + ", ".join(f"{k} {len(v['stops'])} stops, next-stop check {v['next_stop_check']}"
                          for k, v in d["histories"].items()))
    idx = here / "data" / "index.json"
    old = json.loads(idx.read_text()) if idx.exists() else []
    idx.write_text(json.dumps(sorted(set(old) | set(names))))
