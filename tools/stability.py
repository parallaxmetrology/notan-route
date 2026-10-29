"""Do the field's basins survive small changes to the input? Prints a Markdown table.

    python tools/stability.py

Each painting is read as is and after five changes: a 2% crop on every side, JPEG
re-encoding at quality 60, gamma 0.8 and 1.25, and half resolution. A basin "holds" when
the changed reading has a basin whose end lies at the same place: every end target's
centroid within 0.05 of the frame's longest side of one in the original.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
from parallax_notan.colour import load_rgb
from PIL import Image

from notan_route import read, transition_field

ROOT = Path(__file__).resolve().parents[1]
WORKS = ["caravaggio", "gauguin", "bruegel", "jeong"]
TOL = 0.05


def ends(rgb, crop: float = 0.0):
    rd = read(rgb)
    f = transition_field(rd)
    out = []
    for b in f["basins"]:
        pts = []
        for i in b["end"]:
            cx, cy = rd.targets[i]["centroid"]
            pts.append((cx, cy))
        out.append((pts, b["n_members"]))
    return out


def to_original(pts, H, W, c):
    """Map centroids read on a crop back to the uncropped frame's coordinates."""
    h, w = H - 2 * c, W - 2 * c
    Lc, L = max(h, w) - 1, max(H, W) - 1
    res = []
    for x, y in pts:
        col = x * Lc + (w - 1) / 2 + c
        row = y * Lc + (h - 1) / 2 + c
        res.append(((col - (W - 1) / 2) / L, (row - (H - 1) / 2) / L))
    return res


def same(a, b) -> bool:
    return len(a) == len(b) and all(min(np.hypot(p[0] - q[0], p[1] - q[1]) for q in b) <= TOL for p in a)


def jpeg(rgb, q):
    buf = io.BytesIO()
    Image.fromarray((rgb * 255).round().astype(np.uint8)).save(buf, "JPEG", quality=q)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB"), np.float32) / 255


def main() -> int:
    changes = ["crop 2%", "JPEG 60", "gamma 0.8", "gamma 1.25", "half size"]
    print("| painting | basins | " + " | ".join(changes) + " |")
    print("|---|---|" + "---|" * len(changes))
    for name in WORKS:
        rgb = load_rgb(ROOT / "docs" / "paintings" / f"{name}.jpg")
        H, W = rgb.shape[:2]
        c = int(0.02 * min(H, W))
        base = ends(rgb)
        cells = []
        for label in changes:
            if label == "crop 2%":
                got = [(to_original(p, H, W, c), n) for p, n in ends(rgb[c:H - c, c:W - c])]
            else:
                img = {"JPEG 60": lambda: jpeg(rgb, 60), "gamma 0.8": lambda: rgb ** 0.8,
                       "gamma 1.25": lambda: rgb ** 1.25, "half size": lambda: rgb[::2, ::2]}[label]()
                got = ends(img)
            held = sum(any(same(b[0], g[0]) for g in got) for b in base)
            cells.append(f"{held}/{len(base)}" + (f" (+{len(got) - held})" if len(got) > held else ""))
        print(f"| {name} | {len(base)} | " + " | ".join(cells) + " |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
