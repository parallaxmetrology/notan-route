"""Command line for notan-route.

    notan-route field IMAGE...                 transition field as JSON (the main readout)
    notan-route route IMAGE [--start S]        one route as JSON
    notan-route targets IMAGE                  the masses the route walks over
    notan-route draw IMAGE -o OUT.png          field and route side by side
"""
from __future__ import annotations

import argparse
import json
import sys

from PIL import Image

from .draw import field_image, route_image
from .route import read, route, targets, transition_field


def _start(s: str):
    if s in ("centre", "center", "strongest"):
        return s
    if "," in s:
        x, y = s.split(",", 1)
        return (float(x), float(y))
    return int(s)


def _dump(results: dict, paths: list[str]) -> None:
    out = results[paths[0]] if len(paths) == 1 else results
    print(json.dumps(out, indent=2))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="notan-route", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("field", help="release the route from every target and print the field as JSON")
    f.add_argument("images", nargs="+")
    r = sub.add_parser("route", help="print one route as JSON")
    r.add_argument("images", nargs="+")
    r.add_argument("--start", default="centre", help="centre (default), strongest, a target id, or x,y")
    t = sub.add_parser("targets", help="print the masses (targets) as JSON")
    t.add_argument("images", nargs="+")
    d = sub.add_parser("draw", help="save the field and the route side by side as a PNG")
    d.add_argument("image")
    d.add_argument("-o", "--output", required=True)
    d.add_argument("--start", default="centre")
    args = p.parse_args(argv)

    if args.cmd == "draw":
        rd = read(args.image)
        a = field_image(rd)
        b = route_image(rd, start=_start(args.start))
        im = Image.new("RGB", (a.width + b.width + 16, a.height), (255, 255, 255))
        im.paste(a, (0, 0))
        im.paste(b, (a.width + 16, 0))
        im.save(args.output)
        print(args.output)
        return 0
    fn = {"field": transition_field, "targets": targets,
          "route": lambda img: route(img, start=_start(args.start))}[args.cmd]
    _dump({path: fn(path) for path in args.images}, args.images)
    return 0


if __name__ == "__main__":
    sys.exit(main())
