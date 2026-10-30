// Parity: the JS port against the Python, stage by stage, on the same decoded pixels.
//   node tools/parity.mjs REFDIR name [name ...]
// REFDIR comes from tools/dump_reference.py; the Python field is data/<name>.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as nr from '../js/notan-route.js';

const [refdir, ...names] = process.argv.slice(2);
const here = new URL('..', import.meta.url).pathname;
const buf = (f, T) => { const b = readFileSync(f); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const report = {};

for (const name of names) {
  const meta = JSON.parse(readFileSync(`${refdir}/${name}.json`));
  const py = JSON.parse(readFileSync(`${here}data/${name}.json`));
  const u8 = buf(`${refdir}/${name}.u8`, Uint8Array);
  const t0 = performance.now();

  const full = nr.rgbFromU8(u8, meta.W, meta.H, 3);
  const { rgb, w, h } = nr.resizeWork(full, meta.W, meta.H);
  const small = buf(`${refdir}/${name}.small.f32`, Float32Array);
  let rgbDiff = 0, rgbExact = 0;
  for (let i = 0; i < small.length; i++) { const d = Math.abs(small[i] - rgb[i]); rgbDiff = Math.max(rgbDiff, d); rgbExact += d === 0; }

  const rd = nr.read(u8, meta.W, meta.H, 3);
  const mass = buf(`${refdir}/${name}.mass.f64`, Float64Array);
  let massDiff = 0;
  for (let i = 0; i < mass.length; i++) massDiff = Math.max(massDiff, Math.abs(mass[i] - rd.mass[i]));
  const labels = buf(`${refdir}/${name}.labels.i32`, Int32Array);
  let labAgree = 0;
  for (let i = 0; i < labels.length; i++) labAgree += labels[i] === rd.labels[i];
  const t1 = performance.now();

  const js = nr.drainage(rd);
  const t2 = performance.now();

  const tgt = (d) => d.targets.map((t) => [t.id, t.polarity, t.strength, t.mass_share, t.successor, t.basin]);
  let xyDiff = 0;
  py.targets.forEach((t, i) => { if (js.targets[i]) xyDiff = Math.max(xyDiff, Math.abs(t.x - js.targets[i].x), Math.abs(t.y - js.targets[i].y)); });
  const gridAgree = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] === b[i]; return `${s}/${a.length}`; };
  const hist = {};
  for (const k of Object.keys(py.histories)) {
    const P = py.histories[k], J = js.histories[k];
    hist[k] = { stops_equal: same(P.stops, J.stops), js_check: J.next_stop_check,
                steps: P.steps.map((g, i) => (J.steps[i] ? gridAgree(g, J.steps[i]) : 'missing')) };
  }
  const r = {
    size: `${meta.W}x${meta.H} -> ${w}x${h}`, size_equal: w === meta.w && h === meta.h,
    resized_rgb: { max_abs_diff: rgbDiff, exact: `${rgbExact}/${small.length}` },
    mass_max_abs_diff: massDiff,
    labels: `${labAgree}/${labels.length}`,
    n_targets: [py.targets.length, js.targets.length],
    targets_equal: same(tgt(py), tgt(js)), anchor_xy_max_diff: xyDiff,
    basins_equal: same(py.basins, js.basins),
    entry_stability: [py.entry_stability, js.entry_stability],
    landing: gridAgree(py.landing, js.landing), inside: gridAgree(py.inside, js.inside),
    histories: hist,
    seconds: { read: +((t1 - t0) / 1000).toFixed(2), field: +((t2 - t1) / 1000).toFixed(2) },
  };
  if (!r.targets_equal) r.first_target_diff = tgt(py).map((t, i) => [t, tgt(js)[i]]).filter(([a, b]) => !same(a, b)).slice(0, 3);
  if (!r.basins_equal) r.basins = [py.basins, js.basins];
  report[name] = r;
  console.log(name, JSON.stringify(r, null, 1));
}
writeFileSync(`${here}PARITY.json`, JSON.stringify({ date: new Date().toISOString().slice(0, 10), node: process.version, report }, null, 1));
