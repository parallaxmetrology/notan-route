# Drainage: the notan-route demo

Where a picture's masses lead, drawn as flow lines. The field is
[notan-route](https://github.com/parallaxmetrology/notan-route)'s own rule, drawn with
[anvaka/streamlines](https://github.com/anvaka/streamlines) (MIT, Jobard-Lefer evenly spaced
streamlines, vendored unchanged in `vendor/streamlines/` with its licence).

**Live:** https://parallaxmetrology.github.io/notan-route/ (drop in your own picture; it is read
in the browser and never uploaded).

**Locally:** from the repo root, `python3 -m http.server 7543 --directory docs`, then open
http://localhost:7543.

## What the lines are

- **landing**: every point heads straight for the mass notan-route would take first if a
  route started there (`route(start=(x, y))`, first stop: strength × proximity × connection,
  no history). Lines end at that mass.
- **onward**: the same, except inside a mass the line heads for that mass's successor
  (the transition field's memoryless next step), so lines run on to the basin ends.
- Colour is the basin the line's destination drains into (Okabe–Ito, as in notan-route's figures).
  Line weight grows towards where the line drains.

Nothing is random: anvaka/streamlines picks a random first seed by default; here every
drawing is seeded from a fixed lattice.

## Files

- `tools/export.py` runs notan-route unchanged and writes `data/<name>.json` (a 4 px grid of
  landing targets and the mass each cell lies in), the 3-value Notan and a work-size copy of the
  picture. It re-checks 40 cells against the public `route()` call and records the result.
- `index.html` draws the field. PNG and SVG (polylines, for a plotter) export.
- `vendor/streamlines/` the library source, unchanged, with its LICENSE.
- `paintings/` the four public-domain paintings, shared with the README figures.

Add a picture: drop it on the page (read in the browser, never uploaded), or bake it into
`data/` with the Python:
```
python docs/tools/export.py path/to/picture.jpg     # from the repo root, with notan-route installed
```

## The JavaScript port

`js/notan-route.js` ports parallax-notan's Notan mass (with its resize, luminance and OKLab
chroma) and notan-route's reader, route, successors, basins and entry stability, plus this
project's grid fields. `js/worker.js` runs it off the page's main thread. It follows the Python
step by step: float32 rounding where numpy works in float32, scipy's Gaussian kernel, summation
order and boundary modes (`reflect`, `mirror`), skimage's anti-aliased resize (`ndi.zoom`,
grid mode), `h_maxima` as an exact grayscale reconstruction, skimage's watershed with the same
binary heap, (value, age) order and neighbour order, numpy's pairwise summation and Python's
compensated `sum()`. Versions it was checked against: numpy 2.5.4, scipy 1.18.1,
scikit-image 0.26.0, Python 3.14.

### Parity (2026-10-29)

Re-checked on 2026-10-30 after the demo moved into this repo's `docs/`: on the Bruegel, the resized
pixels, mass, labels, targets, basins, all 10,624 grid cells and both routes are again identical.

`tools/dump_reference.py` writes the Python's decoded pixels, resized image, mass and labels;
`node tools/parity.mjs REFDIR bruegel caravaggio gauguin jeong` runs the port on the same pixels
and writes `PARITY.json`.

| | resized image | mass, max difference | labels | targets, basins, entry stability | landing + every step, both routes | JS time | Python time |
|---|---|---|---|---|---|---|---|
| Bruegel | bit-identical | 4e-16 | identical | identical | identical | 2.7 s | 38 s |
| Caravaggio | bit-identical | 3e-16 | identical | identical | identical | 9.1 s | 159 s |
| Gauguin | 626,687 of 626,688 values identical; one off by one float32 step | 8e-12 | identical | identical | identical | 7.0 s | 139 s |
| Jeong Seon | bit-identical | 2e-15 | identical | identical | identical | 3.9 s | 126 s |

The remaining mass differences come from `exp`, `pow` and `cbrt` differing in the last bit
between libraries, and the one Gauguin value from the order of the four bilinear terms; none of
them changes a target, a label or a grid cell.

`tools/browser-parity.html` (open it from the running page's server) does the same with the
browser's own JPEG decoding instead of Pillow's. In Chrome 152 on macOS all four paintings
give identical targets, basins, entry stability, routes and grid cells at every step. A
512 px picture (no resize) was also checked against the Python: identical.

Not checked: other browsers' JPEG decoders (Safari, Firefox) and pictures with an embedded
colour profile, which the page reads without conversion (`colorSpaceConversion: 'none'`) while
Pillow also ignores the profile; HEIC and other formats Pillow cannot open. Pictures above 40
megapixels are refused, since the port reads at full size before resizing, as the Python does.

## Receipt (2026-10-29)

| | masses | basins | cells | checked vs `route()` | export time |
|---|---|---|---|---|---|
| Bruegel | 13 | 3 | 10,624 | 40/40 | 5.9 s |
| Caravaggio | 23 | 2 | 15,488 | 40/40 | 15.3 s |
| Gauguin | 22 | 2 | 13,056 | 40/40 | 11.8 s |
| Jeong Seon | 22 | 2 | 9,472 | 40/40 | 8.1 s |

Basin counts match notan-route's README.

## Observed: catchment

Catchment = share of grid cells whose first stop is that mass.

| | masses with no catchment | three largest catchments | 3 strongest masses hold |
|---|---|---|---|
| Bruegel | 8 of 13 | 0.46, 0.29, 0.15 | 0.90 |
| Caravaggio | 14 of 23 | 0.23, 0.17, 0.15 | 0.42 |
| Gauguin | 13 of 22 | 0.23, 0.18, 0.15 | 0.50 |
| Jeong Seon | 15 of 22 | 0.31, 0.25, 0.21 | 0.77 |

On all four pictures, more than half the masses are never the first stop from any point in the
frame, including points inside those masses: a route started on a weak mass leaves it for a
stronger neighbour. These masses are reached only later in a route, once stronger neighbours are
taken and damped. This is a property of notan-route's point start (strength × proximity, no
history), shown here, not changed.

## Route so far (step fields)

The page replays a route (from the centre, or from the strongest mass). At step *k* the
route's first *k* stops are taken and damp their neighbourhood exactly as in notan-route's
`_walk`. From every cell, the line heads for the route's next pick
(`_best(point, taken, taken_xy)`); where the best score is under the floor the route would
end, and no line is drawn. `onward` applies at step 0 only.

Receipt: the same rule, evaluated at each stop's own position, must give the route's actual
next stop (and nothing after the last stop).

| | centre route | check | strongest route | check |
|---|---|---|---|---|
| Bruegel | 4 stops | 4/4 | 4 stops (the same route) | 4/4 |
| Caravaggio | 6 stops | 6/6 | 7 stops | 7/7 |
| Gauguin | 8 stops | 8/8 | 7 stops | 7/7 |
| Jeong Seon | 11 stops | 11/11 | 11 stops (the same route) | 11/11 |

Centre-route lengths match notan-route's README.

### Observed: catchment as the route proceeds

Masses with catchment at step 0, then the number that have had catchment at any step of the
route, and the share of the frame from which the route would end at its last step.

| | step 0 | any step, centre route | any step, strongest route | never, on either route | frame where the route ends, last step (centre) |
|---|---|---|---|---|---|
| Bruegel | 5 of 13 | 9 | 9 | 4 | 33% |
| Caravaggio | 9 of 23 | 15 | 15 | 7 | 14% |
| Gauguin | 9 of 22 | 14 | 14 | 8 | 10% |
| Jeong Seon | 7 of 22 | 13 | 13 | 9 | 40% |

- History widens the catchment: taking and damping stops hands their ground to masses that had
  none (Bruegel 5 to 9, Caravaggio 9 to 15, Gauguin 9 to 14, Jeong Seon 7 to 13).
- At any one step, fewer masses hold catchment than at step 0 on most steps (for example Jeong
  Seon 7, 6, 5, 6, 6, 6, 5, 5, 4, 4, 3, 2): the taken masses drop out and the rest share the
  ground.
- The masses that never get catchment on either route (28 across the four) are the weakest
  (strength 0.01 to 0.21). On Caravaggio two more get catchment on one route only (13 on the
  strongest route, 11 on the centre route).
  On Jeong Seon the split is clean: all nine are at 0.06 or below, every other mass is at 0.11 or above.
- 26 of the 28 have visitation 1/n in the transition field: no release reaches them except the
  one started on the mass itself. Gauguin 10 (visitation 0.45) and Gauguin 13 (0.09) are reached
  from other starts, but not on these two routes.

## Divides: which hold

A divide is the boundary between two side-by-side grid cells whose first stops differ (step 0).
**test the divides** re-reads the picture after notan-route's own five changes
(`tools/stability.py`: a 2% crop on every side, JPEG quality 60, gamma 0.8, gamma 1.25, every
second pixel) and keeps, for each piece of divide, the changes whose reading has a divide within
a chosen distance (0.01, 0.02 or 0.05 of the frame's long side; one grid cell is about 0.008).
Crop readings are mapped back to the full frame as in `stability.py`. Drawn: solid where all
five changes keep the piece, dashed for three or four, dotted for two or fewer. A kept divide
is a divide in the same place; the masses either side are not required to be the same ones.

Code: `js/stability.js` (runs in the page's worker). In the page the JPEG change uses the
browser's own encoder.

### Parity (2026-10-29)

`tools/stability_reference.py` computes, in Python, each change's reading (target count,
first-stop grid, basin ends) and saves Pillow's JPEG-60 pixels; `tools/stability_parity.mjs`
runs the port on the same pixels (`STABILITY_PARITY.json`).

- All 20 changed readings (4 paintings × 5 changes): same number of targets, every first-stop
  cell identical, basin ends identical.
- The basin-end check reproduces notan-route's README stability table entry for entry
  (Caravaggio 1/2, 2/2, 1/2, 0/2 (+1), 1/2; Gauguin and Bruegel all held; Jeong Seon 1/2 (+1),
  2/2, 1/2 (+1), 1/2 (+1), 2/2).
- The browser's JPEG is not Pillow's. In Chrome 152: Bruegel's JPEG reading keeps 100% of the
  divide, as with Pillow; Jeong Seon's keeps 54% (Pillow: 54.5%). Read the JPEG column as
  encoder-dependent.

### Observed

Share of divide pieces kept by all five changes (Pillow JPEG):

| | pieces | within 0.01 | within 0.02 | within 0.05 | between-basin pieces kept by all, at 0.02 | at 0.05 |
|---|---|---|---|---|---|---|
| Bruegel | 326 | 13% | 47% | 71% | 151 of 235 | 223 of 235 |
| Caravaggio | 641 | 4% | 43% | 69% | 0 of 100 | 1 of 100 |
| Gauguin | 536 | 47% | 89% | 100% | 156 of 158 | 158 of 158 |
| Jeong Seon | 393 | 9% | 21% | 78% | 0 of 121 | 94 of 121 |

Share kept by each change, within 0.02:

| | crop 2% | JPEG 60 | gamma 0.8 | gamma 1.25 | half size |
|---|---|---|---|---|---|
| Bruegel | 96% | 100% | 50% | 90% | 100% |
| Caravaggio | 82% | 93% | 55% | 66% | 98% |
| Gauguin | 96% | 100% | 97% | 95% | 100% |
| Jeong Seon | 84% | 55% | 42% | 48% | 100% |

- The share depends strongly on the distance allowed. Gauguin's divides hold most at every
  distance; the order of the other three changes with the distance.
- Half size keeps 98 to 100% on all four; gamma 0.8 keeps the least on three of four (42 to 55%).
- Between basins: Gauguin's and most of Bruegel's basin divides hold at 0.02. Jeong Seon's
  basin divide is kept by no piece at 0.02 and by 94 of 121 at 0.05: under the changes it moves
  by between about 10 and 25 working pixels and stays near. Caravaggio's basin divide is kept by
  at most 1 of 100 pieces even at 0.05, matching its basins' own changes in the table above.

## What if, and Compare

Every reading on the page is a version: one of the paintings, a picture dropped in, or an edit.
**What if** changes one mass and reads the result; **Compare** puts any two versions side by side
and lists what moved from A to B.

- **What if** (`js/whatif.js`): click a mass, choose *lighter*, *darker* or *paint out*, and
  **try it**. The change is made to the picture's own pixels inside the mass as the reader cut it
  (its region at the 512 px working size, edge softened by a Gaussian of 1.5 working pixels, mapped
  to full size bilinearly). *Lighter* moves each pixel the chosen share of the way to white,
  *darker* the chosen share of the way to black, *paint out* replaces it with the mean colour of a
  ring 6 working pixels wide just outside the mass. The changed picture is read from the start
  by the port. Edits chain: open an edit and change it again. The page keeps the eight most
  recent edits.
- For the four baked paintings the port reads the picture once to get the mass map; the receipt
  states whether its first-stop field equals the baked one (it does on all four).
- **Compare** (`js/compare.js`) matches masses between A and B (same polarity, nearest first,
  within 0.05 of the frame's long side, one to one) and reports:
  - **first stop changed**: the share of B's cells whose first stop is not the match of A's first
    stop at the same place (tinted on B);
  - **where it comes to rest**: each of A's basins holds if B has a basin ending within 0.05 of
    the same place, as in notan-route's stability check;
  - **masses that changed** (catchment by 2 points or more, strength by 0.05 or more; masses
    under 0.1 strength and 1% catchment are counted, not listed);
  - **divides**: A's pieces with a B divide within 0.02 (the rest dashed red on A), and B's new
    pieces (red on B);
  - **centre route** in A's numbering.
  Two readings of different sizes are compared at the same place in the frame.
- PNG export saves A and B side by side when comparing.

The edit is a stand-in for repainting, not a model of paint: a brush change will differ.

### Check (2026-10-29)

`node tools/whatif_check.mjs REFDIR name`. On all four paintings: the port's first-stop field
equals the baked one, and a reading compared with itself gives 0% changed, all masses matched, all
basins held, no divide lost or new, the same route. In the browser, a dropped copy of Jeong Seon
compared with the baked Jeong Seon gives the same result.

### Observed: one change to the mass at the end of basin 1

Each painting's mass 0 (the strongest, at the end of basin 1); lighter and darker by 40%.

| | mass | change | first stop changed | basins of A held | new basins | A's divide kept within 0.02 | centre route |
|---|---|---|---|---|---|---|---|
| Bruegel | light, 28% of frame | lighter | 37% | 1 of 3 | 0 | 41 of 326 | same |
| | | darker | 62% | 1 of 3 | 1 | 109 of 326 | differs from stop 1 |
| | | paint out | 47% | 2 of 3 | 0 | 172 of 326 | differs from stop 1 |
| Caravaggio | light, 6% | lighter | 11% | 2 of 2 | 0 | 470 of 641 | same |
| | | darker | 13% | 0 of 2 | 1 | 504 of 641 | same, one stop longer |
| | | paint out | 24% | 0 of 2 | 1 | 498 of 641 | first 2 stops agree |
| Gauguin | light, 11% | lighter | 51% | 1 of 2 | 1 | 227 of 536 | differs from stop 1 |
| | | darker | 27% | 1 of 2 | 1 | 367 of 536 | first stop agrees |
| | | paint out | 30% | 1 of 2 | 1 | 294 of 536 | first stop agrees |
| Jeong Seon | dark, 15% | lighter | 67% | 0 of 2 | 3 | 54 of 393 | differs from stop 1 |
| | | darker | 38% | 0 of 2 | 2 | 156 of 393 | first stop agrees |
| | | paint out | 66% | 0 of 2 | 3 | 63 of 393 | differs from stop 1 |

- One change to one mass moves the first stop for 11 to 67% of the frame.
- Pushing a mass further the way it already leans (darker on Jeong Seon's dark mass) still
  changes the ending: the strongest mass's lead grows and both basins re-form.
- On Gauguin, *lighter* on the light mass leaves no match for it within 0.05: the mass grows or
  merges, and its centre moves. On Bruegel the same change keeps the match and widens its
  catchment (46% to 56%).
- Caravaggio's mass 0 is the smallest of the four (6% of the frame); changes to it move the
  first stop least.


- The lines picture notan-route's rule. They make no claim about eyes, gaze or viewing order.
- The field is read on a 4 px grid at notan-route's 512 px working size; a cell takes its
  centre's first stop, so divides are placed to within about 2 px.
- In **onward** mode a basin that ends in a pair sends lines back and forth between the two
  masses; the streamline rule stops them where they would cross their own path.
- Everything inherited from notan-route's operating window holds (polarity relative to the
  median tone, sigma sets the scale, marks under 0.5% of the frame dropped).
