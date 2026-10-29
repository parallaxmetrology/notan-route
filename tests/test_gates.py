"""Known-answer gates, written before the route was trusted on any painting.

Each test encodes one way the idea could be wrong. Change a gate only with a reason in
CHANGELOG.md.

  1. one mass            the route starts on it
  2. two masses          both are visited
  3. flat image          no targets, the route abstains (also: texture only)
  4. same input          same route, byte for byte
  5. KILL TEST           on a scene built so proximity matters, the route departs from a
                         plain strongest-first ranking. If it never does, the route is a
                         sorted list and the instrument adds nothing.
  5b. second control     the route is not only a nearest-first tour: a strong mass a little
                         farther beats a weak one close by
  6. chain               a connected chain of masses is walked in chain order
  7. gap                 flat ground between two masses lowers their connection
  8. polarity            light and dark masses are separate targets with polarity kept
"""
from __future__ import annotations

import numpy as np

from notan_route import connection, route, targets, transition_field
from notan_route import scenes as S


def _frame(fx, fy, h=S.SIZE, w=S.SIZE):
    """Frame fraction -> route coordinates (centred, divided by the longest side)."""
    L = max(h, w) - 1
    return ((fx * w - (w - 1) / 2) / L, (fy * h - (h - 1) / 2) / L)


def _near(stop, fx, fy, tol=0.06):
    x, y = _frame(fx, fy)
    return abs(stop["x"] - x) <= tol and abs(stop["y"] - y) <= tol


def _which(stop, blobs):
    """Index of the blob a stop sits on, or None."""
    for i, (fx, fy, _, _) in enumerate(blobs):
        if _near(stop, fx, fy):
            return i
    return None


def test_one_mass_route_starts_on_it():
    r = route(S.paint(S.ONE))
    assert r["n_targets"] == 1, r
    assert r["stops"] and _near(r["stops"][0], *S.ONE[0][:2]), r["stops"]


def test_two_masses_both_visited():
    r = route(S.paint(S.TWO))
    hit = {_which(s, S.TWO) for s in r["stops"]}
    assert hit == {0, 1}, r["stops"]


def test_flat_abstains():
    r = route(np.full((S.SIZE, S.SIZE, 3), 0.5, np.float32))
    assert r["n_targets"] == 0 and r["stops"] == [] and r["abstain"], r
    f = transition_field(np.full((S.SIZE, S.SIZE, 3), 0.5, np.float32))
    assert f["n_targets"] == 0 and f["basins"] == [] and f["abstain"], f


def test_texture_only_abstains():
    r = route(S.texture())
    assert r["n_targets"] == 0 and r["abstain"], r


def test_same_input_same_route():
    img = S.paint(S.PROXIMITY)
    assert route(img) == route(img)
    assert transition_field(img) == transition_field(img)


def test_kill_route_departs_from_strongest_first():
    """The route from the centre must not reduce to strongest-first order."""
    img = S.paint(S.PROXIMITY)
    t = targets(img)
    strongest = t["targets"][0]
    assert _which(strongest, S.PROXIMITY) == 0, "the corner mass is built to be the strongest"
    r = route(img)
    assert len(r["stops"]) >= 3, r["stops"]
    assert r["departure_from_strongest_first"] > 0.0, "route == strongest-first: the route adds nothing"
    assert r["stops"][0]["id"] != strongest["id"], "strongest visited first from the centre"


def test_route_departs_from_nearest_first():
    img = S.paint(S.STRENGTH)
    r = route(img)
    assert _which(r["stops"][0], S.STRENGTH) == 1, r["stops"]
    assert r["departure_from_nearest_first"] > 0.0, r


def test_chain_walked_in_order():
    img = S.paint(S.CHAIN)
    t = targets(img)
    first = next(x["id"] for x in t["targets"] if _which(x, S.CHAIN) == 0)
    r = route(img, start=first)
    order = [_which(s, S.CHAIN) for s in r["stops"]]
    assert order == list(range(len(S.CHAIN))), order
    # and the strongest-first order is different, so this is not the ranking in disguise
    ranked = [_which(x, S.CHAIN) for x in t["targets"]]
    assert ranked != order


def test_gap_lowers_connection():
    a, b = _frame(*S.GAP_ENDS[0][:2]), _frame(*S.GAP_ENDS[1][:2])
    flat = connection(S.paint(S.GAP_ENDS), a, b)
    bridged = connection(S.paint(S.GAP_BRIDGE), a, b)
    assert flat["connection"] < bridged["connection"], (flat, bridged)
    assert flat["longest_gap"] > bridged["longest_gap"], (flat, bridged)
    # a wider gap lowers it further: move the ends closer and the connection rises
    near = [(0.35, 0.5, 0.06, 0.92), (0.65, 0.5, 0.06, 0.92)]
    closer = connection(S.paint(near), _frame(0.35, 0.5), _frame(0.65, 0.5))
    assert closer["connection"] > flat["connection"], (closer, flat)


def test_polarity_kept():
    t = targets(S.paint(S.POLARITY, ground=S.POLARITY_GROUND))
    assert t["n_targets"] == 2, t
    pol = {_which(x, S.POLARITY): x["polarity"] for x in t["targets"]}
    assert pol == {0: "light", 1: "dark"}, pol
