// A JavaScript port of parallax-notan (notan_mass, resize_work, luminance, OKLab chroma) and
// notan-route (read, route, successor, basins, entry stability), plus notan-drainage's grid
// fields. Written to follow the Python step by step, including float32 rounding where numpy
// works in float32, scipy's Gaussian filter and boundary modes, skimage's anti-aliased resize,
// h_maxima and watershed (same heap, same neighbour order), and numpy's pairwise summation.
// Checked against the Python by tools/parity.mjs. Plain ES module: runs in a browser, a worker
// or Node. No dependencies.

const f32 = Math.fround;

// ---------- parameters (parallax-notan, notan-route, notan-drainage) ----------
export const WORK_PX = 512;
const NOTAN_SCALES = [4.0, 8.0, 16.0];
const CHROMA_WEIGHT = 0.5;
export const TAU_VOID = 0.06;
const CHROMA_DUST = 1e-6;
const EPS9 = 1e-9;
export const PARAMS = { sigma: 0.22, k_conn: 0.5, return_sigma: 0.11, return_damp: 0.85, floor: 0.02,
                        min_area: 0.005, tau_void: TAU_VOID };
const POLARITY_SIGMA = 8.0;
const EPS = 1e-12;
export const GRID_STEP = 4;

// ---------- numpy helpers ----------
// numpy's pairwise summation for a contiguous float64 array (blocks of 8 accumulators, split at 128)
export function pairwiseSum(a, start = 0, n = a.length - start) {
  if (n < 8) {
    let res = -0.0;                       // numpy starts from -0.0 for the short loop
    for (let i = 0; i < n; i++) res += a[start + i];
    return n === 0 ? 0 : res;
  }
  if (n <= 128) {
    const r = new Float64Array(8);
    for (let k = 0; k < 8; k++) r[k] = a[start + k];
    let i;
    for (i = 8; i < n - (n % 8); i += 8) for (let k = 0; k < 8; k++) r[k] += a[start + i + k];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[start + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2);
}

function median(a) {
  const s = Float64Array.from(a).sort();
  const n = s.length, h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function rint(x) {                        // round half to even, as np.rint and Python round()
  const r = Math.round(x);
  return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
}

// ---------- scipy.ndimage.gaussian_filter ----------
function gaussKernel(sigma, radius) {
  const s2 = sigma * sigma, n = 2 * radius + 1;
  const phi = new Float64Array(n);
  for (let i = 0; i < n; i++) { const x = i - radius; phi[i] = Math.exp(-0.5 / s2 * (x * x)); }
  const sum = pairwiseSum(phi);
  for (let i = 0; i < n; i++) phi[i] = phi[i] / sum;
  return phi;                             // symmetric, so the reversal scipy applies changes nothing
}

function mapIndex(i, n, mode) {           // scipy boundary extension
  if (n === 1) return 0;
  if (mode === 'reflect') {               // d c b a | a b c d | d c b a
    const p = 2 * n;
    i = ((i % p) + p) % p;
    return i < n ? i : p - 1 - i;
  }
  const p = 2 * n - 2;                    // mirror: d c b | a b c d | c b a
  i = ((i % p) + p) % p;
  return i < n ? i : p - i;
}

// one axis of a correlation over a strided field; `round` = f32 for float32 output
function correlateAxis(src, dst, shape, axis, w, radius, mode, round) {
  const dims = shape.length;
  const len = shape[axis];
  let stride = 1;
  for (let d = dims - 1; d > axis; d--) stride *= shape[d];
  const total = src.length, lines = total / len;
  const line = new Float64Array(len + 2 * radius);
  const outer = stride * len;
  for (let l = 0; l < lines; l++) {
    const base = Math.floor(l / stride) * outer + (l % stride);
    for (let k = -radius; k < len + radius; k++) line[k + radius] = src[base + mapIndex(k, len, mode) * stride];
    for (let k = 0; k < len; k++) {
      const c = k + radius;
      let t = line[c] * w[radius];
      for (let j = -radius; j < 0; j++) t += (line[c + j] + line[c - j]) * w[radius + j];
      dst[base + k * stride] = round ? round(t) : t;
    }
  }
}

export function gaussianFilter(src, shape, sigmas, mode = 'reflect', float32 = false) {
  let cur = src;
  for (let axis = 0; axis < shape.length; axis++) {
    const s = sigmas[axis];
    if (!(s > 1e-15)) continue;
    const radius = Math.floor(4.0 * s + 0.5);
    const out = float32 ? new Float32Array(src.length) : new Float64Array(src.length);
    correlateAxis(cur, out, shape, axis, gaussKernel(s, radius), radius, mode, float32 ? f32 : null);
    cur = out;
  }
  return cur === src ? (float32 ? Float32Array.from(src) : Float64Array.from(src)) : cur;
}

// ---------- parallax_notan.colour / notan ----------
// rgbU8: Uint8 (or Uint8Clamped) array with `channels` per pixel (3 or 4). Returns float32 RGB.
export function rgbFromU8(rgbU8, W, H, channels) {
  const out = new Float32Array(W * H * 3);
  for (let i = 0, j = 0; i < W * H; i++, j += channels) {
    out[3 * i] = f32(rgbU8[j] / 255.0);
    out[3 * i + 1] = f32(rgbU8[j + 1] / 255.0);
    out[3 * i + 2] = f32(rgbU8[j + 2] / 255.0);
  }
  return out;
}

// skimage.transform.resize(rgb, (h, w), order=1, anti_aliasing=True) on float32 RGB
export function resizeWork(rgb, W, H, workPx = WORK_PX) {
  if (Math.max(H, W) <= workPx) return { rgb, w: W, h: H };
  const s = workPx / Math.max(H, W);
  const h = Math.max(1, Math.floor(H * s)), w = Math.max(1, Math.floor(W * s));
  const fy = H / h, fx = W / w;
  const filtered = gaussianFilter(rgb, [H, W, 3], [Math.max(0, (fy - 1) / 2), Math.max(0, (fx - 1) / 2), 0],
                                  'mirror', true);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < rgb.length; i++) { if (rgb[i] < lo) lo = rgb[i]; if (rgb[i] > hi) hi = rgb[i]; }
  const out = new Float32Array(h * w * 3);
  const axis = (n, outN, zoom) => {        // ndi.zoom, grid_mode=True, order 1, mirror
    const i0 = new Int32Array(outN), i1 = new Int32Array(outN), w0 = new Float64Array(outN), w1 = new Float64Array(outN);
    for (let k = 0; k < outN; k++) {
      let cc = (k + 0.5) * zoom - 0.5;
      const st = Math.floor(cc), t = cc - st;
      i0[k] = mapIndex(st, n, 'mirror'); i1[k] = mapIndex(st + 1, n, 'mirror');
      w0[k] = 1.0 - t; w1[k] = t;
    }
    return { i0, i1, w0, w1 };
  };
  const ay = axis(H, h, H / h), ax = axis(W, w, W / w);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) for (let ch = 0; ch < 3; ch++) {
    const rows = [[ay.i0[r], ay.w0[r]], [ay.i1[r], ay.w1[r]]];
    const cols = [[ax.i0[c], ax.w0[c]], [ax.i1[c], ax.w1[c]]];
    const chs = [[ch, 1.0], [mapIndex(ch + 1, 3, 'mirror'), 0.0]];
    let t = 0.0;
    for (const [ri, rw] of rows) for (const [ci, cw] of cols) for (const [ki, kw] of chs)
      t += filtered[(ri * W + ci) * 3 + ki] * rw * cw * kw;
    let v = f32(t);
    if (v < lo) v = lo; else if (v > hi) v = hi;
    out[(r * w + c) * 3 + ch] = v;
  }
  return { rgb: out, w, h };
}

export function luminance(rgb, n) {       // float32 arithmetic, as numpy on a float32 array
  const a = f32(0.2126), b = f32(0.7152), c = f32(0.0722);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = f32(f32(f32(a * rgb[3 * i]) + f32(b * rgb[3 * i + 1])) + f32(c * rgb[3 * i + 2]));
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

const degamma = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function oklabChroma(rgb, n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = degamma(rgb[3 * i]), g = degamma(rgb[3 * i + 1]), bb = degamma(rgb[3 * i + 2]);
    const L = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bb;
    const M = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bb;
    const S = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bb;
    const l_ = Math.cbrt(Math.max(L, 0)), m_ = Math.cbrt(Math.max(M, 0)), s_ = Math.cbrt(Math.max(S, 0));
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    out[i] = Math.hypot(a, b);
  }
  return out;
}

function norm01(f) {
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Float64Array(f.length);
  if (hi - lo > EPS9) for (let i = 0; i < f.length; i++) out[i] = (f[i] - lo) / (hi - lo);
  return out;
}

export function notanMass(rgb, w, h) {
  const n = w * h;
  const lum = luminance(rgb, n), chroma = oklabChroma(rgb, n);
  const L = norm01(lum);
  let cmax = -Infinity; for (const v of chroma) if (v > cmax) cmax = v;
  const C = cmax >= CHROMA_DUST ? norm01(chroma) : new Float64Array(n);
  const Lb = median(L), Cb = median(C);
  const mass = new Float64Array(n);
  for (const s of NOTAN_SCALES) {
    const gL = gaussianFilter(L, [h, w], [s, s]), gC = gaussianFilter(C, [h, w], [s, s]);
    for (let i = 0; i < n; i++) mass[i] += Math.abs(gL[i] - Lb) + CHROMA_WEIGHT * Math.abs(gC[i] - Cb);
  }
  for (let i = 0; i < n; i++) mass[i] = mass[i] / NOTAN_SCALES.length;
  return { mass, lum };
}

// ---------- scipy.ndimage.label (8-connected), numbered in raster order ----------
export function label8(mask, w, h) {
  const lab = new Int32Array(w * h);
  let n = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    n++; let sp = 0; stack[sp++] = i; lab[i] = n;
    while (sp) {
      const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const q = yy * w + xx;
        if (mask[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
      }
    }
  }
  return { lab, n };
}

// ---------- heaps ----------
class MaxHeap {                           // for reconstruction (order does not change the result)
  constructor() { this.v = []; this.k = []; }
  get size() { return this.v.length; }
  push(val, key) {
    const v = this.v, k = this.k; let i = v.length; v.push(val); k.push(key);
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] >= v[i]) break;
      [v[p], v[i]] = [v[i], v[p]]; [k[p], k[i]] = [k[i], k[p]]; i = p; }
  }
  pop() {
    const v = this.v, k = this.k, topV = v[0], topK = k[0];
    const lv = v.pop(), lk = k.pop();
    if (v.length) { v[0] = lv; k[0] = lk; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < v.length && v[l] > v[m]) m = l; if (r < v.length && v[r] > v[m]) m = r;
        if (m === i) break; [v[m], v[i]] = [v[i], v[m]]; [k[m], k[i]] = [k[i], k[m]]; i = m; } }
    return [topV, topK];
  }
}

// skimage h_maxima(image, h) on float64 (grayscale reconstruction by dilation, 3x3)
export function hMaxima(img, w, h, hh) {
  let lo = Infinity, hi = -Infinity;
  for (const v of img) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Uint8Array(w * h);
  if (hh > hi - lo) return out;
  const resolution = 2 * 1e-15;            // 2 * np.finfo(float64).resolution
  const rec = new Float64Array(w * h);
  const heap = new MaxHeap();
  for (let i = 0; i < w * h; i++) { rec[i] = img[i] - hh - resolution * Math.abs(img[i]); heap.push(rec[i], i); }
  while (heap.size) {
    const [v, p] = heap.pop();
    if (v !== rec[p]) continue;
    const y = (p / w) | 0, x = p - y * w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if ((!dy && !dx) || yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
      const q = yy * w + xx, nv = Math.min(v, img[q]);
      if (nv > rec[q]) { rec[q] = nv; heap.push(nv, q); }
    }
  }
  for (let i = 0; i < w * h; i++) out[i] = img[i] - rec[i] >= hh ? 1 : 0;
  return out;
}

// skimage watershed(image, markers, mask, connectivity=2), compactness 0, no lines:
// the same binary heap, the same (value, age) order and the same neighbour order.
export function watershed(image, markers, mask, w, h) {
  const W = w + 2, H = h + 2, N = W * H;
  const img = new Float64Array(N), msk = new Uint8Array(N), out = new Int32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, j = (y + 1) * W + x + 1;
    img[j] = image[i]; msk[j] = mask[i] ? 1 : 0; out[j] = mask[i] ? markers[i] : 0;
  }
  const nb = [-W, -1, 1, W, -W - 1, -W + 1, W - 1, W + 1];
  // heap of items {value, age, index, source}, as heap_general.pxi
  const hv = [], ha = [], hi = [], hs = [];
  const smaller = (a, b) => (hv[a] !== hv[b] ? hv[a] < hv[b] : ha[a] < ha[b]);
  const swap = (a, b) => { [hv[a], hv[b]] = [hv[b], hv[a]]; [ha[a], ha[b]] = [ha[b], ha[a]];
                           [hi[a], hi[b]] = [hi[b], hi[a]]; [hs[a], hs[b]] = [hs[b], hs[a]]; };
  const push = (v, age, idx, src) => {
    let c = hv.length; hv.push(v); ha.push(age); hi.push(idx); hs.push(src);
    while (c > 0) { const p = ((c + 1) >> 1) - 1; if (smaller(c, p)) { swap(p, c); c = p; } else break; }
  };
  const pop = () => {
    const e = [hv[0], ha[0], hi[0], hs[0]];
    const last = hv.length - 1;
    if (last === 0) { hv.pop(); ha.pop(); hi.pop(); hs.pop(); return e; }
    swap(0, last); hv.pop(); ha.pop(); hi.pop(); hs.pop();
    let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let s = i;
      if (l < hv.length) { if (smaller(l, i)) s = l; if (r < hv.length && smaller(r, s)) s = r; } else break;
      if (s === i) break; swap(i, s); i = s; }
    return e;
  };
  for (let j = 0; j < N; j++) if (out[j]) push(img[j], 0, j, j);
  let age = 1;
  while (hv.length) {
    const [val, , idx] = pop();
    for (let k = 0; k < 8; k++) {
      const q = nb[k] + idx;
      if (!msk[q] || out[q]) continue;
      age += 1;
      let v = img[q];
      out[q] = out[idx];
      if (v < val) v = val;
      push(v, age, q, 0);
    }
  }
  const lab = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lab[y * w + x] = out[(y + 1) * W + x + 1];
  return lab;
}

function split(mass, region, w, h) {
  const n = w * h;
  let any = false;
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) if (region[i]) { m[i] = mass[i]; any = true; }
  if (!any) return { lab: new Int32Array(n), n: 0 };
  const hm = hMaxima(m, w, h, TAU_VOID);
  const mk = new Uint8Array(n);
  for (let i = 0; i < n; i++) mk[i] = hm[i] && region[i] ? 1 : 0;
  const { lab: markers, n: nm } = label8(mk, w, h);
  if (nm === 0) return label8(region, w, h);
  const neg = new Float64Array(n);
  for (let i = 0; i < n; i++) neg[i] = -m[i];
  const lab = watershed(neg, markers, region, w, h);
  const restMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) restMask[i] = region[i] && lab[i] === 0 ? 1 : 0;
  const { lab: rest, n: k } = label8(restMask, w, h);
  for (let i = 0; i < n; i++) if (rest[i] > 0) lab[i] = rest[i] + nm;
  return { lab, n: nm + k };
}

// Python round(x, 4): toFixed rounds the exact binary value, as Python does (ties do not occur)
const round4 = (x) => Number(x.toFixed(4));

// Python 3.12+ sum() of floats: Neumaier compensated summation
export function pySum(xs) {
  let f = 0.0, c = 0.0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x; else c += (x - t) + f;
    f = t;
  }
  return c && Number.isFinite(c) ? f + c : f;
}

// notan_route.read, from 8-bit pixels
export function read(rgbU8, W, H, channels = 4, onStage = () => {}) {
  return readRGB(rgbFromU8(rgbU8, W, H, channels), W, H, onStage);
}

// notan_route.read from float32 RGB in [0, 1] (what the Python reads after load_rgb)
export function readRGB(full, W, H, onStage = () => {}) {
  onStage('squinting');
  const { rgb, w, h } = resizeWork(full, W, H);
  const n = w * h;
  const { mass, lum } = notanMass(rgb, w, h);
  onStage('cutting masses');
  const sq = gaussianFilter(lum, [h, w], [POLARITY_SIGMA, POLARITY_SIGMA]);
  const med = median(lum);
  const darker = new Uint8Array(n), on = new Uint8Array(n);
  for (let i = 0; i < n; i++) { darker[i] = sq[i] < med ? 1 : 0; on[i] = mass[i] >= TAU_VOID ? 1 : 0; }
  const span = Math.max(h, w) - 1;
  const rd = { mass, onMass: on, darker, w, h, span, rgb, targets: [], labels: new Int32Array(n).fill(-1), conn: new Map() };
  const total = pairwiseSum(mass);
  const minPx = PARAMS.min_area * h * w;
  const raw = [];
  let nDrop = 0, dropMass = 0;
  for (const [pol, want] of [['dark', 1], ['light', 0]]) {
    const region = new Uint8Array(n);
    for (let i = 0; i < n; i++) region[i] = on[i] && darker[i] === want ? 1 : 0;
    const { lab, n: nl } = split(mass, region, w, h);
    const members = Array.from({ length: nl + 1 }, () => []);
    for (let i = 0; i < n; i++) if (lab[i] > 0) members[lab[i]].push(i);
    for (let k = 1; k <= nl; k++) {
      const idx = members[k], area = idx.length;
      const wts = Float64Array.from(idx, (i) => mass[i]);
      const m = pairwiseSum(wts);
      if (area < minPx) { nDrop++; dropMass += m; continue; }
      const cx = pairwiseSum(Float64Array.from(idx, (i, j) => (i % w) * wts[j])) / m;
      const cy = pairwiseSum(Float64Array.from(idx, (i, j) => ((i / w) | 0) * wts[j])) / m;
      let best = Infinity, bi = 0;
      for (let j = 0; j < area; j++) {
        const x = idx[j] % w, y = (idx[j] / w) | 0;
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 < best) { best = d2; bi = j; }
      }
      raw.push({ polarity: pol, mass: m, area, ax: idx[bi] % w, ay: (idx[bi] / w) | 0, cx, cy, idx });
    }
  }
  raw.sort((a, b) => (b.mass - a.mass) || (a.ay - b.ay) || (a.ax - b.ax));
  const top = raw.length ? raw[0].mass : 1.0;
  const toXY = (c, r) => [(c - (w - 1) / 2) / span, (r - (h - 1) / 2) / span];
  raw.forEach((r, i) => {
    for (const p of r.idx) rd.labels[p] = i;
    const [ax, ay] = toXY(r.ax, r.ay);
    const [gx, gy] = toXY(r.cx, r.cy);
    rd.targets.push({ id: i, polarity: r.polarity, _x: ax, _y: ay, _s: r.mass / top, _cx: gx, _cy: gy,
                      centroid: [round4(gx), round4(gy)],
                      strength: round4(r.mass / top), mass_share: total > EPS ? round4(r.mass / total) : 0,
                      area: round4(r.area / (h * w)) });
  });
  rd.dropped = { n: nDrop, mass_share: total > EPS ? round4(dropMass / total) : 0 };
  return rd;
}

export const toXY = (rd, c, r) => [(c - (rd.w - 1) / 2) / rd.span, (r - (rd.h - 1) / 2) / rd.span];
export const toPx = (rd, x, y) => [x * rd.span + (rd.w - 1) / 2, y * rd.span + (rd.h - 1) / 2];

// ---------- notan_route.route ----------
// connection along a straight segment (carried mass only; the flat run is not used by the score)
export function segment(rd, a, b) {
  const [c0, r0] = toPx(rd, a[0], a[1]), [c1, r1] = toPx(rd, b[0], b[1]);
  const n = Math.max(2, Math.ceil(Math.hypot(c1 - c0, r1 - r0)) + 1);
  const step = n > 1 ? { c: (c1 - c0) / (n - 1), r: (r1 - r0) / (n - 1) } : { c: 0, r: 0 };
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let cc = i === n - 1 ? c1 : (step.c === 0 ? (i * (c1 - c0)) / (n - 1) : i * step.c) + c0;
    let rr = i === n - 1 ? r1 : (step.r === 0 ? (i * (r1 - r0)) / (n - 1) : i * step.r) + r0;
    let ci = rint(cc), ri = rint(rr);
    ci = ci < 0 ? 0 : ci > rd.w - 1 ? rd.w - 1 : ci;
    ri = ri < 0 ? 0 : ri > rd.h - 1 ? rd.h - 1 : ri;
    m[i] = rd.mass[ri * rd.w + ci];
  }
  const ref = Math.min(m[0], m[n - 1]);
  if (!(ref > EPS)) return 0.0;
  for (let i = 0; i < n; i++) { const v = m[i] / ref; m[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  return pairwiseSum(m) / n;
}

function connIds(rd, i, j) {
  const a = Math.min(i, j), b = Math.max(i, j), key = a * 100000 + b;
  if (!rd.conn.has(key)) {
    const ta = rd.targets[a], tb = rd.targets[b];
    rd.conn.set(key, segment(rd, [ta._x, ta._y], [tb._x, tb._y]));
  }
  return rd.conn.get(key);
}

function score(rd, t, pin, pinId, takenXY, p, c) {
  const d2 = (t._x - pin[0]) ** 2 + (t._y - pin[1]) ** 2;
  const near = p.sigma !== null ? Math.exp(-d2 / (2.0 * p.sigma ** 2)) : 1.0;
  if (c === undefined) c = pinId !== null ? connIds(rd, pinId, t.id) : segment(rd, pin, [t._x, t._y]);
  let damp = 1.0;
  for (const [vx, vy] of takenXY) {
    const dv = (t._x - vx) ** 2 + (t._y - vy) ** 2;
    damp *= 1.0 - p.return_damp * Math.exp(-dv / (2.0 * p.return_sigma ** 2));
  }
  return t._s * near * (1.0 - p.k_conn + p.k_conn * c) * damp;
}

// connRow: optional precomputed connections from this point to every target
export function best(rd, pin, pinId, taken, takenXY, p = PARAMS, connRow = null) {
  let b = null, bs = -1.0;
  for (const t of rd.targets) {
    if (taken.has(t.id)) continue;
    const s = score(rd, t, pin, pinId, takenXY, p, connRow ? connRow[t.id] : undefined);
    if (s > bs + EPS) { b = t; bs = s; }
  }
  return [b, bs];
}

function startOf(rd, start) {
  if (start === 'centre') return [[0.0, 0.0], null];
  if (start === 'strongest') start = 0;
  const t = rd.targets[start];
  return [[t._x, t._y], start];
}

export function walk(rd, start, p = PARAMS) {
  let [pin, pinId] = startOf(rd, start);
  const taken = new Set(), takenXY = [], stops = [];
  if (pinId !== null) { const t = rd.targets[pinId]; stops.push(pinId); taken.add(pinId); takenXY.push([t._x, t._y]); }
  while (taken.size < rd.targets.length) {
    const [b, bs] = best(rd, pin, pinId, taken, takenXY, p);
    if (stops.length && bs < p.floor) break;
    stops.push(b.id); taken.add(b.id); takenXY.push([b._x, b._y]);
    pin = [b._x, b._y]; pinId = b.id;
  }
  return stops;
}

export function successors(rd, p = PARAMS) {
  const out = {};
  for (const t of rd.targets) {
    const [b, bs] = best(rd, [t._x, t._y], t.id, new Set([t.id]), [[t._x, t._y]], p);
    out[t.id] = b !== null && bs >= p.floor ? b.id : null;
  }
  return out;
}

export function basins(succ, rd) {
  const ends = new Map();
  const keys = Object.keys(succ).map(Number);
  for (const k of keys) {
    const path = [], seen = new Map();
    let cur = k;
    while (cur !== null && !seen.has(cur) && !ends.has(cur)) { seen.set(cur, path.length); path.push(cur); cur = succ[cur]; }
    let end;
    if (cur === null) end = [path[path.length - 1]];
    else if (ends.has(cur)) end = ends.get(cur);
    else {
      const cyc = path.slice(seen.get(cur));
      const i = cyc.indexOf(Math.min(...cyc));
      end = cyc.slice(i).concat(cyc.slice(0, i));
    }
    for (const q of path) ends.set(q, end);
  }
  const groups = new Map();
  for (const [k, e] of ends) { const key = e.join(','); if (!groups.has(key)) groups.set(key, { end: e, m: [] }); groups.get(key).m.push(k); }
  const share = Object.fromEntries(rd.targets.map((t) => [t.id, t.mass_share]));
  const tot = pySum(rd.targets.map((t) => t.mass_share)) || 1.0;
  const out = [];
  for (const { end, m } of groups.values()) {
    const members = m.sort((a, b) => a - b);
    const s = pySum(members.map((x) => share[x]));
    out.push({ end, kind: end.length > 1 ? 'cycle' : 'sink', members, mass_share: round4(s / tot), n_members: members.length });
  }
  const cmpEnd = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
  out.sort((a, b) => (b.n_members - a.n_members) || (b.mass_share - a.mass_share) || cmpEnd(a.end, b.end));
  return out;
}

export function entryStability(rd, p = PARAMS) {
  const sets = rd.targets.map((t) => new Set(walk(rd, t.id, p)));
  const n = sets.length, jac = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let inter = 0; for (const x of sets[i]) if (sets[j].has(x)) inter++;
    jac.push(inter / (sets[i].size + sets[j].size - inter));
  }
  if (!jac.length) return 1.0;
  return round4(pySum(jac) / jac.length);
}

export function notan3(rd) {
  const out = new Uint8ClampedArray(rd.w * rd.h);
  for (let i = 0; i < out.length; i++) {
    const v = rd.onMass[i] ? (rd.darker[i] ? 0.30 : 0.92) : 0.62;
    out[i] = Math.trunc(v * 255);                 // as (notan3 * 255).astype(uint8)
  }
  return out;
}

// ---------- notan-drainage: the whole data file, same schema as tools/export.py ----------
function gridOf(rd) {
  const cols = [], rows = [];
  for (let c = GRID_STEP / 2 - 0.5; c < rd.w - 0.5; c += GRID_STEP) cols.push(c);
  for (let r = GRID_STEP / 2 - 0.5; r < rd.h - 0.5; r += GRID_STEP) rows.push(r);
  return { cols, rows, gw: cols.length, gh: rows.length };
}

// The first-stop field alone (step 0), for the stability check.
export function landingField(rd, p = PARAMS) {
  const { cols, rows, gw, gh } = gridOf(rd);
  const g = new Int32Array(gw * gh);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const pt = toXY(rd, cols[c], rows[r]);
    const [b] = best(rd, pt, null, new Set(), [], p);
    g[r * gw + c] = b ? b.id : -1;
  }
  return { grid: g, gw, gh, cols, rows };
}

// Divides: the boundary between two side-by-side cells whose first stops differ. Each piece is
// returned at its midpoint, in route coordinates, with the two first stops either side.
export function divides(rd, lf) {
  const out = [];
  const { grid, gw, gh, cols, rows } = lf;
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const a = grid[r * gw + c];
    if (c + 1 < gw && grid[r * gw + c + 1] !== a) {
      const [x, y] = toXY(rd, (cols[c] + cols[c + 1]) / 2, rows[r]);
      out.push({ x, y, v: 1, a, b: grid[r * gw + c + 1], r, c });   // v=1: a vertical piece of divide
    }
    if (r + 1 < gh && grid[(r + 1) * gw + c] !== a) {
      const [x, y] = toXY(rd, cols[c], (rows[r] + rows[r + 1]) / 2);
      out.push({ x, y, v: 0, a, b: grid[(r + 1) * gw + c], r, c });
    }
  }
  return out;
}

export function drainage(rd, onStage = () => {}, p = PARAMS) {
  const succ = successors(rd, p);
  const bas = basins(succ, rd);
  const basinOf = {};
  bas.forEach((b, i) => { for (const m of b.members) basinOf[m] = i; });
  const { cols, rows, gw, gh } = gridOf(rd);
  const nc = gw * gh, nt = rd.targets.length;
  onStage('connections');
  // connection from each cell to each target does not depend on history: compute once
  const pts = new Array(nc), conn = new Array(nc), inside = new Array(nc);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const k = r * gw + c, pt = toXY(rd, cols[c], rows[r]);
    pts[k] = pt;
    const row = new Float64Array(nt);
    for (const t of rd.targets) row[t.id] = segment(rd, pt, [t._x, t._y]);
    conn[k] = row;
    inside[k] = rd.labels[rint(rows[r]) * rd.w + rint(cols[c])];
  }
  const field = (taken, takenXY, floor) => {
    const g = new Array(nc);
    for (let k = 0; k < nc; k++) {
      const [b, bs] = best(rd, pts[k], null, taken, takenXY, p, conn[k]);
      g[k] = b !== null && (!floor || bs >= p.floor) ? b.id : -1;
    }
    return g;
  };
  onStage('first-stop field');
  const landing = field(new Set(), [], false);
  const histories = {};
  for (const start of ['centre', 'strongest']) {
    const stops = walk(rd, start, p);
    const steps = [], check = [];
    for (let k = 1; k <= stops.length; k++) {
      onStage(`route from ${start}, step ${k} of ${stops.length}`);
      const taken = new Set(stops.slice(0, k));
      const takenXY = stops.slice(0, k).map((i) => [rd.targets[i]._x, rd.targets[i]._y]);
      steps.push(field(taken, takenXY, true));
      const here = rd.targets[stops[k - 1]];
      const [b, bs] = best(rd, [here._x, here._y], null, taken, takenXY, p);
      const got = b !== null && bs >= p.floor ? b.id : null;
      check.push(got === (k < stops.length ? stops[k] : null));
    }
    histories[start] = { stops, steps, next_stop_check: `${check.filter(Boolean).length}/${check.length}` };
  }
  onStage('entry stability');
  return {
    schema: 'notan-drainage/0.1',
    work_px: [rd.w, rd.h],
    span: rd.span,
    grid: { step: GRID_STEP, w: gw, h: gh, col0: cols[0], row0: rows[0] },
    landing, inside,
    targets: rd.targets.map((t) => ({ id: t.id, x: t._x, y: t._y, strength: t.strength, polarity: t.polarity,
                                      mass_share: t.mass_share, successor: succ[t.id], basin: basinOf[t.id] ?? null })),
    basins: bas,
    entry_stability: entryStability(rd, p),
    params: p,
    histories,
    dropped: rd.dropped,
    abstain: rd.targets.length === 0,
  };
}
