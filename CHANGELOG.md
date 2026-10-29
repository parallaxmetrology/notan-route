# Changelog

## 0.1.0 (2026-10-29)

First release. A rebuild, on the public Notan mass, of an idea from a private walk in the Image Structure Reader; none of that walk's code or calibrated inputs are used.

- `targets`, `connection`, `route`, `transition_field`, `params`, and the drawings in `notan_route.draw`.
- `notan-route` CLI: `field`, `route`, `targets`, `draw`.
- Known-answer scenes (`notan_route.scenes`) and the gates in `tests/`.
- Written while building, before any painting was read:
  - Cutting the mass only at Notan's flat threshold merged neighbouring masses through their blurred halos (the six-mass chain read as one target). Masses are now also split at saddles at least that threshold deep, and connection became continuous (mass carried relative to the weaker end) because split neighbours touch.
  - The first kill-test scene put the three near masses in the same order by distance and by strength, so it could not show a departure from strongest-first. The scene was corrected (nearest is weakest); the gate is unchanged.
  - On the corrected scene the route equals a plain nearest-first tour, so a second control was added: a strong mass a little farther must beat a weak one close by (`test_route_departs_from_nearest_first`).
  - A field test that expected both ends of the mixed-strength chain to walk the whole chain was wrong: from the right end the route jumps the weakest link. It was replaced by an equal-strength chain (a known answer) plus a test that documents the jump.
