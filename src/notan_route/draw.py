"""Pictures of the readout: the transition field and one route, drawn over the 3-value Notan."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_dilation

from .route import Reading, read, route, transition_field

# Okabe-Ito, colour-blind safe, one per basin (repeats after eight)
BASIN = [(230, 159, 0), (86, 180, 233), (0, 158, 115), (213, 94, 0),
         (204, 121, 167), (0, 114, 178), (240, 228, 66), (120, 120, 120)]
INK = (25, 25, 25)
SCALE = 2


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:                       # Pillow < 10.1
        return ImageFont.load_default()


def notan3(rd: Reading) -> np.ndarray:
    """3-value Notan from the reading itself: dark mass, flat ground, light mass."""
    img = np.full((rd.h, rd.w), 0.62)
    img[rd.on_mass & rd.darker] = 0.30
    img[rd.on_mass & ~rd.darker] = 0.92
    return img


def _base(rd: Reading, fill_by: dict[int, tuple] | None) -> Image.Image:
    g = notan3(rd)
    rgb = np.repeat(g[:, :, None], 3, axis=2) * 255.0
    if fill_by:
        for tid, col in fill_by.items():
            sel = rd.labels == tid
            rgb[sel] = 0.55 * rgb[sel] + 0.45 * np.array(col, float)
    edge = np.zeros((rd.h, rd.w), bool)
    if rd.labels is not None:
        lab = rd.labels
        edge[:, 1:] |= lab[:, 1:] != lab[:, :-1]
        edge[1:, :] |= lab[1:, :] != lab[:-1, :]
        edge &= binary_dilation(lab >= 0)
    rgb[edge] = 0.5 * rgb[edge] + 0.5 * np.array(INK, float)
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    return im.resize((rd.w * SCALE, rd.h * SCALE), Image.NEAREST)


def _px(rd: Reading, x: float, y: float) -> tuple[float, float]:
    c, r = rd.to_px(x, y)
    return (c * SCALE + SCALE / 2, r * SCALE + SCALE / 2)


def _arrow(d: ImageDraw.ImageDraw, a, b, col, width: int, head: float, shorten: float = 0.0):
    ax, ay = a
    bx, by = b
    L = float(np.hypot(bx - ax, by - ay))
    if L < 1e-6:
        return
    ux, uy = (bx - ax) / L, (by - ay) / L
    bx, by = bx - ux * shorten, by - uy * shorten
    ax, ay = ax + ux * shorten, ay + uy * shorten
    d.line([(ax, ay), (bx, by)], fill=col, width=width)
    px, py = -uy, ux
    d.polygon([(bx, by), (bx - ux * head + px * head * 0.5, by - uy * head + py * head * 0.5),
               (bx - ux * head - px * head * 0.5, by - uy * head - py * head * 0.5)], fill=col)


def field_image(image, field: dict | None = None) -> Image.Image:
    """Targets tinted by basin; an arrow from every target to its memoryless successor;
    the basin's end (a mutual pair or a dead end) ringed."""
    rd = read(image)
    f = field or transition_field(rd)
    colour = {}
    for i, b in enumerate(f["basins"]):
        for m in b["members"]:
            colour[m] = BASIN[i % len(BASIN)]
    im = _base(rd, colour)
    d = ImageDraw.Draw(im)
    r0 = 5 * SCALE
    for t in rd.targets:
        s = f["nodes"][t["id"]]["successor"]
        if s is not None:
            u = rd.targets[s]
            _arrow(d, _px(rd, t["x"], t["y"]), _px(rd, u["x"], u["y"]), INK, SCALE, 7 * SCALE, shorten=r0)
    ends = {m for b in f["basins"] for m in b["end"]}
    for t in rd.targets:
        cx, cy = _px(rd, t["x"], t["y"])
        rr = r0 * (1.6 if t["id"] in ends else 1.0)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=colour.get(t["id"], (255, 255, 255)),
                  outline=INK, width=SCALE * (2 if t["id"] in ends else 1))
    return im


def route_image(image, r: dict | None = None, start="centre") -> Image.Image:
    """One route: numbered stops joined in order, from the start point."""
    rd = read(image)
    r = r or route(rd, start=start)
    im = _base(rd, None)
    d = ImageDraw.Draw(im)
    font = _font(10 * SCALE)
    pts = [_px(rd, s["x"], s["y"]) for s in r["stops"]]
    if r["stops"] and r["start"]["target"] is None:
        sx, sy = _px(rd, r["start"]["x"], r["start"]["y"])
        d.line([(sx - 6 * SCALE, sy), (sx + 6 * SCALE, sy)], fill=INK, width=SCALE)
        d.line([(sx, sy - 6 * SCALE), (sx, sy + 6 * SCALE)], fill=INK, width=SCALE)
        pts_all = [(sx, sy)] + pts
    else:
        pts_all = pts
    rr = 9 * SCALE
    for a, b in zip(pts_all, pts_all[1:]):
        _arrow(d, a, b, (200, 30, 30), 2 * SCALE, 8 * SCALE, shorten=rr)
    for k, (x, y) in enumerate(pts):
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255), outline=(200, 30, 30), width=2 * SCALE)
        label = str(k + 1)
        bb = d.textbbox((0, 0), label, font=font)
        d.text((x - (bb[2] - bb[0]) / 2 - bb[0], y - (bb[3] - bb[1]) / 2 - bb[1]), label, fill=INK, font=font)
    return im
