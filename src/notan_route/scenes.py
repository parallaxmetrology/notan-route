"""Synthetic scenes with known answers, used by the gates and the README figures.

Every scene is soft round masses (Gaussian mounds) on a flat ground, so the Notan mass has
clean regions and the right answer is set by construction. Coordinates are fractions of the
frame (0..1, origin top left). No randomness except where a seeded texture is the point.

    python -m notan_route.scenes OUTDIR    writes them as PNGs with EXPECTED.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

SIZE = 400
GROUND = 0.12   # dark ground; masses are lighter than it unless a value says otherwise


def paint(blobs, size: int = SIZE, ground: float = GROUND, width: int | None = None) -> np.ndarray:
    """blobs: (fx, fy, radius_fraction, value). value is the blob's peak tone in 0..1; it is
    blended over the ground, so a value below the ground makes a dark mass."""
    h, w = size, (width or size)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    img = np.full((h, w), ground, np.float64)
    for fx, fy, r, v in blobs:
        g = np.exp(-((xx - fx * w) ** 2 + (yy - fy * h) ** 2) / (2.0 * (r * size) ** 2))
        img = img * (1.0 - g) + v * g
    return np.repeat(np.clip(img, 0, 1)[:, :, None], 3, axis=2).astype(np.float32)


# Positions used by the gates, so tests and figures agree.
ONE = [(0.30, 0.40, 0.08, 0.92)]
TWO = [(0.25, 0.50, 0.07, 0.92), (0.75, 0.50, 0.07, 0.92)]
# Proximity scene: the strongest mass (largest, brightest) sits in the far corner; three
# weaker masses sit near the centre, the nearest being the weakest, so distance order and
# strength order disagree. A strongest-first ranking visits the corner first and then the
# three by strength; a route started at the centre should do neither.
PROXIMITY = [(0.12, 0.14, 0.09, 0.95),
             (0.56, 0.52, 0.05, 0.60), (0.74, 0.62, 0.05, 0.65), (0.84, 0.40, 0.05, 0.70)]
# Chain: six masses along an arc with deliberately mixed strengths, so chain order differs
# from strongest-first order. Released at the first link, the route should walk the chain.
CHAIN = [(0.10, 0.70, 0.045, 0.60), (0.26, 0.52, 0.045, 0.90), (0.42, 0.40, 0.045, 0.55),
         (0.58, 0.36, 0.045, 0.95), (0.74, 0.40, 0.045, 0.50), (0.90, 0.52, 0.045, 0.80)]
# Strength over nearness: from the centre, a weak small mass close by and a strong large
# mass a little farther. A nearest-first tour takes the weak one first; the route should not.
STRENGTH = [(0.60, 0.50, 0.04, 0.45), (0.27, 0.50, 0.08, 0.95)]
# Polarity: one light and one dark mass on a mid-grey ground.
POLARITY = [(0.30, 0.50, 0.08, 0.92), (0.70, 0.50, 0.08, 0.02)]
POLARITY_GROUND = 0.5
# Gap: two masses with flat ground between them, and the same two with a third mass
# placed on the line between them (not touching either).
GAP_ENDS = [(0.15, 0.50, 0.06, 0.92), (0.85, 0.50, 0.06, 0.92)]
GAP_BRIDGE = GAP_ENDS + [(0.50, 0.50, 0.08, 0.92)]


def texture(size: int = SIZE, seed: int = 0) -> np.ndarray:
    """Fine uniform noise and nothing else: no mass should survive the squint."""
    rng = np.random.default_rng(seed)
    g = rng.random((size, size))
    return np.repeat(g[:, :, None], 3, axis=2).astype(np.float32)


def build() -> dict[str, tuple[np.ndarray, str]]:
    return {
        "one": (paint(ONE), "One mass off centre: the route starts on it."),
        "two": (paint(TWO), "Two equal masses: both are visited."),
        "flat": (np.full((SIZE, SIZE, 3), 0.5, np.float32), "Flat grey: no masses, the route abstains."),
        "texture": (texture(), "Fine noise only: no masses survive, the route abstains."),
        "proximity": (paint(PROXIMITY), "Strongest mass in the far corner: a route from the centre departs "
                                        "from strongest-first order (the kill test)."),
        "chain": (paint(CHAIN), "Six masses on an arc, mixed strengths: released at the left end, "
                                "the route walks them in chain order."),
        "strength": (paint(STRENGTH), "A weak mass near the centre, a strong one farther: from the centre the "
                                      "route takes the strong one first (departs from nearest-first)."),
        "polarity": (paint(POLARITY, ground=POLARITY_GROUND), "One light and one dark mass on mid grey: "
                                                              "two targets, polarity kept."),
        "gap": (paint(GAP_ENDS), "Two masses, flat ground between: low connection."),
        "gap_bridged": (paint(GAP_BRIDGE), "Same two masses with a third between them: higher connection."),
    }


def main(argv=None) -> int:
    from PIL import Image
    argv = sys.argv[1:] if argv is None else argv
    out = Path(argv[0] if argv else "scenes")
    out.mkdir(parents=True, exist_ok=True)
    expected = {}
    for name, (img, note) in build().items():
        Image.fromarray((img * 255).round().astype(np.uint8)).save(out / f"{name}.png")
        expected[name] = note
    (out / "EXPECTED.json").write_text(json.dumps(expected, indent=2) + "\n")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
