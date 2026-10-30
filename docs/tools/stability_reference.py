"""Python reference for the stability parity check (tools/stability_parity.mjs).

For each picture and each of notan-route's five changes (tools/stability.py): the first-stop
grid, the number of targets and the basin ends; plus Pillow's JPEG-60 pixels so the JS can be
fed the same JPEG. Run with the notan-route venv:
  python docs/tools/stability_reference.py OUTDIR docs/paintings/*.jpg     (from the repo root)
"""
import io
import json
import sys
from pathlib import Path

import numpy as np
from parallax_notan.colour import load_rgb
from PIL import Image

from notan_route import transition_field
from notan_route.route import _best, params, read

STEP = 4


def jpeg(rgb, q):                       # as notan-route/tools/stability.py
    buf = io.BytesIO()
    Image.fromarray((rgb * 255).round().astype(np.uint8)).save(buf, "JPEG", quality=q)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB"), np.float32) / 255


def landing(rd):
    p = params()
    cols = np.arange(STEP / 2 - 0.5, rd.w - 0.5, STEP)
    rows = np.arange(STEP / 2 - 0.5, rd.h - 0.5, STEP)
    g = []
    for row in rows:
        for col in cols:
            b, _ = _best(rd, rd.to_xy(col, row), None, set(), [], p)
            g.append(b["id"] if b is not None else -1)
    return g


out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for arg in sys.argv[2:]:
    name = Path(arg).stem
    rgb = load_rgb(arg)
    H, W = rgb.shape[:2]
    c = int(0.02 * min(H, W))
    jp = jpeg(rgb, 60)
    (jp * 255).round().astype(np.uint8).tofile(out / f"{name}.jpeg60.u8")
    res = {}
    for label, img in (("crop 2%", rgb[c:H - c, c:W - c]), ("JPEG 60", jp), ("gamma 0.8", rgb ** 0.8),
                       ("gamma 1.25", rgb ** 1.25), ("half size", rgb[::2, ::2])):
        rd = read(img)
        f = transition_field(rd)
        res[label] = {"n_targets": len(rd.targets), "landing": landing(rd),
                      "ends": [[rd.targets[i]["centroid"] for i in b["end"]] for b in f["basins"]],
                      "work_px": [rd.w, rd.h]}
        print(name, label, len(rd.targets), "targets", flush=True)
    (out / f"{name}.stability.json").write_text(json.dumps(res))
