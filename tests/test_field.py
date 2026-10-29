"""Gates for the transition field, the main readout. A single route is one sample of it."""
from __future__ import annotations

from notan_route import route, transition_field
from notan_route import scenes as S


def test_two_equal_masses_one_cycle():
    f = transition_field(S.paint(S.TWO))
    assert f["n_basins"] == 1, f["basins"]
    b = f["basins"][0]
    assert b["kind"] == "cycle" and sorted(b["end"]) == [0, 1] and b["members"] == [0, 1]


def test_isolated_mass_is_its_own_basin():
    """The far corner mass in the proximity scene leads nowhere above the floor."""
    f = transition_field(S.paint(S.PROXIMITY))
    corner = [b for b in f["basins"] if 0 in b["members"]]
    assert len(corner) == 1 and corner[0]["members"] == [0] and corner[0]["kind"] == "sink", f["basins"]
    others = [b for b in f["basins"] if 0 not in b["members"]]
    assert len(others) == 1 and others[0]["members"] == [1, 2, 3], f["basins"]


def test_equal_chain_walked_from_both_ends():
    """Equal masses on the arc: released at either end, the route walks the whole chain in order."""
    blobs = [(fx, fy, r, 0.9) for fx, fy, r, _ in S.CHAIN]
    f = transition_field(S.paint(blobs))
    assert f["n_targets"] == 6
    left = min(f["nodes"], key=lambda n: n["x"])["id"]
    right = max(f["nodes"], key=lambda n: n["x"])["id"]
    by_x = [n["id"] for n in sorted(f["nodes"], key=lambda n: n["x"])]
    assert f["releases"][str(left)] == by_x, f["releases"]
    assert f["releases"][str(right)] == by_x[::-1], f["releases"]


def test_mixed_chain_right_end_skips_the_weakest_link():
    """Documented behaviour, not a known answer: from the right end of the mixed chain the
    route jumps the weakest link (value 0.50) for the strongest (0.95) beside it."""
    f = transition_field(S.paint(S.CHAIN))
    by_x = [n["id"] for n in sorted(f["nodes"], key=lambda n: n["x"])]
    tour = f["releases"][str(by_x[-1])]
    assert tour[1] == by_x[3] and by_x[4] not in tour, tour


def test_route_is_one_sample_of_the_field():
    img = S.paint(S.CHAIN)
    f = transition_field(img)
    for k, tour in f["releases"].items():
        assert [s["id"] for s in route(img, start=int(k))["stops"]] == tour


def test_bounds_and_saturation_reported():
    for img in (S.paint(S.CHAIN), S.paint(S.PROXIMITY), S.paint(S.TWO)):
        f = transition_field(img)
        assert 0.0 <= f["entry_stability"] <= 1.0
        assert all(0.0 <= n["visitation"] <= 1.0 for n in f["nodes"])
        sat = f["saturation"]
        for k in ("connection_at_1", "connection_at_0", "visitation_at_1", "entry_stability_at_1"):
            assert k in sat
        # every target belongs to exactly one basin
        members = sorted(m for b in f["basins"] for m in b["members"])
        assert members == list(range(f["n_targets"]))
