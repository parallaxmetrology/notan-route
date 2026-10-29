"""Build the README figures into docs/images/. Run from the repo root:

    python tools/make_readme_images.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from parallax_notan.colour import load_rgb
from parallax_notan.notan import resize_work
from PIL import Image, ImageDraw, ImageFont

from notan_route import read, route, transition_field
from notan_route import scenes as S
from notan_route.draw import field_image, route_image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
PAINTINGS = ROOT / "docs" / "paintings"
BG, INK, SUB = (255, 255, 255), (30, 30, 30), (110, 110, 110)
GAP, TITLE_H = 14, 44
FONT = ImageFont.load_default(size=17)
SMALL = ImageFont.load_default(size=14)

WORKS = [
    ("caravaggio", "Caravaggio, The Calling of Saint Matthew, 1599-1600"),
    ("gauguin", "Gauguin, Vision after the Sermon, 1888"),
    ("bruegel", "After Bruegel, Landscape with the Fall of Icarus, c. 1560s"),
    ("jeong", "Jeong Seon, Clearing after Rain on Mount Inwang, 1751"),
]


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8))


def fit(im: Image.Image, h: int) -> Image.Image:
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def row(tiles, h: int, caption: str = "") -> Image.Image:
    ims = [fit(t[0], h) for t in tiles]
    w = sum(i.width for i in ims) + GAP * (len(ims) - 1)
    cap_h = 30 if caption else 0
    out = Image.new("RGB", (w, cap_h + TITLE_H + h), BG)
    d = ImageDraw.Draw(out)
    if caption:
        d.text((0, 4), caption, fill=INK, font=FONT)
    x = 0
    for im, (_, title, sub) in zip(ims, tiles):
        d.text((x, cap_h + 2), title, fill=INK, font=SMALL)
        d.text((x, cap_h + 22), sub, fill=SUB, font=SMALL)
        out.paste(im, (x, cap_h + TITLE_H))
        x += im.width + GAP
    return out


def stack(rows, pad: int = 26) -> Image.Image:
    w = max(r.width for r in rows) + 2 * pad
    h = sum(r.height for r in rows) + pad * (len(rows) + 1)
    out = Image.new("RGB", (w, h), BG)
    y = pad
    for r in rows:
        out.paste(r, (pad, y))
        y += r.height + pad
    return out


def basins_text(f: dict) -> str:
    sizes = [str(b["n_members"]) for b in f["basins"]]
    if len(sizes) == 1:
        return f"{f['n_targets']} targets, 1 basin"
    return f"{f['n_targets']} targets, {len(sizes)} basins of {', '.join(sizes[:-1])} and {sizes[-1]}"


def paintings() -> None:
    rows = []
    for name, title in WORKS:
        rgb = load_rgb(PAINTINGS / f"{name}.jpg")
        rd = read(rgb)
        f = transition_field(rd)
        r = route(rd)
        small = to_img(resize_work(rgb))
        rows.append(row([
            (small, "Painting", ""),
            (field_image(rd, f), "Transition field", basins_text(f)),
            (route_image(rd, r), "One route, from the centre (+)",
             f"{len(r['stops'])} stops, reach {r['reach']:.2f}"),
        ], 300, title))
    stack(rows).save(OUT / "paintings.jpg", quality=88)


def scenes() -> None:
    sc = S.build()
    picks = [("one", "One mass", "centre"), ("two", "Two masses", "centre"),
             ("proximity", "Kill test: strongest in the corner", "centre"),
             ("strength", "Strong beats near", "centre")]
    rows = []
    tiles = []
    for key, title, start in picks:
        img = sc[key][0]
        r = route(img, start=start)
        tiles.append((route_image(img, r), title, f"route: {len(r['stops'])} stop{'' if len(r['stops']) == 1 else 's'}"))
    rows.append(row(tiles, 240, "Known answers: one route each, from the centre (+)"))
    chain = sc["chain"][0]
    first = min(read(chain).targets, key=lambda t: t["x"])["id"]
    flat = sc["flat"][0]
    tiles = [(route_image(chain, route(chain, start=first)), "Chain, released at the left end", "walked in chain order"),
             (field_image(chain), "Chain: transition field", basins_text(transition_field(chain))),
             (field_image(sc["proximity"][0]), "Kill scene: transition field", "the corner mass is its own basin"),
             (route_image(flat), "Flat grey", "no targets: abstains")]
    rows.append(row(tiles, 240))
    stack(rows).save(OUT / "scenes.png")


def ablation() -> None:
    rd = read(load_rgb(PAINTINGS / "jeong.jpg"))
    tiles = []
    for title, ov in (("All terms", {}), ("Connection off (k_conn=0)", {"k_conn": 0.0}),
                      ("Proximity off (sigma=None)", {"sigma": None})):
        f = transition_field(rd, **ov)
        tiles.append((field_image(rd, f), title, basins_text(f)))
    stack([row(tiles, 260, "What each term does: Jeong Seon, transition field")]).save(OUT / "ablation.jpg", quality=88)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    paintings()
    scenes()
    ablation()
    print(OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
