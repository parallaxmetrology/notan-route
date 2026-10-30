"""Write the Python reference for the JS parity check (tools/parity.mjs).

For each picture: the decoded 8-bit RGB the Python reads (EXIF-transposed, as parallax-notan's
load_rgb), the resized float32 RGB, the Notan mass (float64), the target labels (int32).
Run with the notan-route venv:
  python docs/tools/dump_reference.py OUTDIR docs/paintings/*.jpg     (from the repo root)
"""
import json
import sys
from pathlib import Path

import numpy as np
from parallax_notan.colour import load_rgb
from parallax_notan.notan import resize_work
from PIL import Image, ImageOps

from notan_route.route import read

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for arg in sys.argv[2:]:
    p = Path(arg)
    u8 = np.asarray(ImageOps.exif_transpose(Image.open(p)).convert("RGB"), dtype=np.uint8)
    rgb = load_rgb(p)
    assert np.array_equal((u8.astype(np.float32) / 255.0), rgb)
    small = resize_work(rgb).astype(np.float32)
    rd = read(str(p))
    u8.tofile(out / f"{p.stem}.u8")
    small.tofile(out / f"{p.stem}.small.f32")
    rd.mass.astype(np.float64).tofile(out / f"{p.stem}.mass.f64")
    rd.labels.astype(np.int32).tofile(out / f"{p.stem}.labels.i32")
    (out / f"{p.stem}.json").write_text(json.dumps({"W": u8.shape[1], "H": u8.shape[0],
                                                    "w": rd.w, "h": rd.h}))
    print(p.stem, u8.shape, (rd.h, rd.w))
