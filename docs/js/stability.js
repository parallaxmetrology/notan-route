// Which divides hold under small changes to the input. The changes are notan-route's own
// (tools/stability.py): a 2% crop on every side, JPEG at quality 60, gamma 0.8 and 1.25, and
// half resolution (every second pixel). The crop and gamma and half size follow the Python
// exactly; the JPEG is whatever encoder the caller supplies (in the page: the browser's).
import { readRGB, landingField, divides, successors, basins } from './notan-route.js';

export const CHANGES = ['crop 2%', 'JPEG 60', 'gamma 0.8', 'gamma 1.25', 'half size'];
export const TOL_ENDS = 0.05;        // notan-route's basin-end tolerance
export const TOLS = [0.01, 0.02, 0.05]; // a divide piece is kept if a changed divide lies this close (frame's long side)

const f32 = Math.fround;

export function cropRGB(rgb, W, H) {
  const c = Math.trunc(0.02 * Math.min(H, W));
  const w = W - 2 * c, h = H - 2 * c;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) out.set(rgb.subarray(((y + c) * W + c) * 3, ((y + c) * W + c + w) * 3), y * w * 3);
  return { rgb: out, W: w, H: h, c };
}

export function gammaRGB(rgb, g) {      // numpy: float32 array ** python float -> float32 power
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = f32(Math.pow(rgb[i], g));
  return out;
}

export function halfRGB(rgb, W, H) {    // rgb[::2, ::2]
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++)
    out[(y * w + x) * 3 + k] = rgb[((2 * y) * W + 2 * x) * 3 + k];
  return { rgb: out, W: w, H: h };
}

// route coordinates read on a crop, back to the uncropped frame (stability.py's to_original)
function cropMapper(H, W, c) {
  const h = H - 2 * c, w = W - 2 * c, Lc = Math.max(h, w) - 1, L = Math.max(H, W) - 1;
  return (x, y) => {
    const col = x * Lc + (w - 1) / 2 + c, row = y * Lc + (h - 1) / 2 + c;
    return [(col - (W - 1) / 2) / L, (row - (H - 1) / 2) / L];
  };
}

function readOne(rgb, W, H, map) {
  const rd = readRGB(rgb, W, H);
  const lf = landingField(rd);
  const dv = divides(rd, lf).map((d) => { const [x, y] = map(d.x, d.y); return { ...d, x, y }; });
  const bas = basins(successors(rd), rd);
  const ends = bas.map((b) => ({ pts: b.end.map((i) => map(...rd.targets[i].centroid)), n: b.n_members }));
  return { rd, lf, dv, bas, ends, n_targets: rd.targets.length };
}

const sameEnds = (a, b) => a.length === b.length &&
  a.every((p) => Math.min(...b.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))) <= TOL_ENDS);

// spatial hash of divide midpoints, for "is there a divide within tol of here"
function hashOf(pts, tol) {
  const m = new Map();
  for (const p of pts) {
    const k = `${Math.floor(p.x / tol)},${Math.floor(p.y / tol)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  return (x, y) => {
    const i = Math.floor(x / tol), j = Math.floor(y / tol);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const p of m.get(`${i + a},${j + b}`) || []) if (Math.hypot(p.x - x, p.y - y) <= tol) return true;
    }
    return false;
  };
}

// rgb: float32 RGB of the picture as read; jpegRGB: the same picture after JPEG 60 (or null to skip)
export function stability(rgb, W, H, jpegRGB, onStage = () => {}) {
  const id = (x, y) => [x, y];
  onStage('reading the picture as is');
  const base = readOne(rgb, W, H, id);
  const readings = {};
  for (const label of CHANGES) {
    onStage(`reading after ${label}`);
    if (label === 'crop 2%') { const cr = cropRGB(rgb, W, H); readings[label] = readOne(cr.rgb, cr.W, cr.H, cropMapper(H, W, cr.c)); }
    else if (label === 'JPEG 60') { if (jpegRGB) readings[label] = readOne(jpegRGB, W, H, id); }
    else if (label === 'gamma 0.8') readings[label] = readOne(gammaRGB(rgb, 0.8), W, H, id);
    else if (label === 'gamma 1.25') readings[label] = readOne(gammaRGB(rgb, 1.25), W, H, id);
    else if (label === 'half size') { const hf = halfRGB(rgb, W, H); readings[label] = readOne(hf.rgb, hf.W, hf.H, id); }
  }
  const labels = Object.keys(readings);
  // basin ends, as stability.py
  const basinsHeld = {};
  for (const l of labels) {
    const got = readings[l].ends;
    const held = base.ends.filter((b) => got.some((g) => sameEnds(b.pts, g.pts))).length;
    basinsHeld[l] = { held, of: base.ends.length, extra: Math.max(0, got.length - held) };
  }
  // divides: for each piece of the picture's own divide, which changes keep a divide within tol
  const basinOf = {};
  base.bas.forEach((b, i) => b.members.forEach((m) => { basinOf[m] = i; }));
  const near = Object.fromEntries(TOLS.map((t) => [t, Object.fromEntries(labels.map((l) => [l, hashOf(readings[l].dv, t)]))]));
  const pieces = base.dv.map((d) => ({
    r: d.r, c: d.c, v: d.v, a: d.a, b: d.b, between_basins: basinOf[d.a] !== basinOf[d.b],
    kept: Object.fromEntries(TOLS.map((t) => [t, labels.filter((l) => near[t][l](d.x, d.y))])),
  }));
  const n = pieces.length || 1;
  const byTol = Object.fromEntries(TOLS.map((t) => {
    const bb = pieces.filter((p) => p.between_basins);
    return [t, {
      held_by_all: pieces.filter((p) => p.kept[t].length === labels.length).length,
      between_basins: bb.length,
      between_basins_held_by_all: bb.filter((p) => p.kept[t].length === labels.length).length,
      per_change: Object.fromEntries(labels.map((l) => [l, pieces.filter((p) => p.kept[t].includes(l)).length / n])),
    }];
  }));
  return {
    changes: labels, tols: TOLS, tol_ends: TOL_ENDS,
    grid: { w: base.lf.gw, h: base.lf.gh }, n_pieces: pieces.length, pieces, by_tol: byTol,
    basins_held: basinsHeld,
    n_targets: Object.fromEntries([['as is', base.n_targets], ...labels.map((l) => [l, readings[l].n_targets])]),
    _readings: readings, _base: base,
  };
}
