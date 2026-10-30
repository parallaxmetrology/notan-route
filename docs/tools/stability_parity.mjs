// Stability parity: the JS port against the Python for each of the five changes, on the same
// pixels (Pillow's JPEG-60 pixels for the JPEG change). Then the basin-end table and the
// divide hold shares the page shows.
//   node tools/stability_parity.mjs REFDIR name [name ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { rgbFromU8 } from '../js/notan-route.js';
import { stability, CHANGES } from '../js/stability.js';

const [refdir, ...names] = process.argv.slice(2);
const here = new URL('..', import.meta.url).pathname;
const out = {};
for (const name of names) {
  const meta = JSON.parse(readFileSync(`${refdir}/${name}.json`));
  const py = JSON.parse(readFileSync(`${refdir}/${name}.stability.json`));
  const rgb = rgbFromU8(new Uint8Array(readFileSync(`${refdir}/${name}.u8`)), meta.W, meta.H, 3);
  const jp = rgbFromU8(new Uint8Array(readFileSync(`${refdir}/${name}.jpeg60.u8`)), meta.W, meta.H, 3);
  const t0 = Date.now();
  const st = stability(rgb, meta.W, meta.H, jp);
  const rows = {};
  for (const l of CHANGES) {
    const r = st._readings[l], P = py[l];
    let agree = 0;
    for (let i = 0; i < P.landing.length; i++) agree += P.landing[i] === r.lf.grid[i];
    const jsEnds = r.bas.map((b) => b.end.map((i) => r.rd.targets[i].centroid));
    rows[l] = { targets: [P.n_targets, r.n_targets], landing: `${agree}/${P.landing.length}`,
                basin_ends_equal: JSON.stringify(P.ends) === JSON.stringify(jsEnds) };
  }
  const bh = Object.fromEntries(CHANGES.map((l) => { const b = st.basins_held[l]; return [l, `${b.held}/${b.of}` + (b.extra ? ` (+${b.extra})` : '')]; }));
  const tol = Object.fromEntries(st.tols.map((t) => { const b = st.by_tol[t]; return [t, {
    held_by_all: +(b.held_by_all / st.n_pieces).toFixed(3),
    between_basins: `${b.between_basins_held_by_all}/${b.between_basins}`,
    per_change: Object.fromEntries(Object.entries(b.per_change).map(([k, v]) => [k, +v.toFixed(3)])) }]; }));
  out[name] = { parity: rows, basins_held: bh, divide_pieces: st.n_pieces, by_tol: tol, seconds: (Date.now() - t0) / 1000 };
  console.log(name, JSON.stringify(out[name]));
}
writeFileSync(`${here}STABILITY_PARITY.json`, JSON.stringify(out, null, 1));
