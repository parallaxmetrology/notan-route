// What if: change one mass in the picture's own pixels, so the reader can read the result.
// The mass is the region notan-route cut for it (its label at the 512 px working size). The
// edge is softened by a Gaussian of 1.5 working pixels so the change does not cut a hard new
// edge of its own. The change is a stand-in for repainting, not a model of paint.
//   lighter:   p + a * m * (255 - p)
//   darker:    p * (1 - a * m)
//   paint out: p + m * (c - p), c = the mean colour of a ring just outside the mass
import { gaussianFilter } from './notan-route.js';

export const OPS = ['lighter', 'darker', 'paint out'];
export const EDGE_SIGMA = 1.5;   // working pixels
export const RING_PX = 6;        // working pixels

// work-size mask -> full-size coordinates, as the reader's resize maps them (grid mode)
function sampler(f, w, h, W, H) {
  const sx = w / W, sy = h / H;
  return (X, Y) => {
    const u = Math.min(w - 1, Math.max(0, (X + 0.5) * sx - 0.5));
    const v = Math.min(h - 1, Math.max(0, (Y + 0.5) * sy - 0.5));
    const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = u - x0, fy = v - y0;
    return (f[y0 * w + x0] * (1 - fx) + f[y0 * w + x1] * fx) * (1 - fy) +
           (f[y1 * w + x0] * (1 - fx) + f[y1 * w + x1] * fx) * fy;
  };
}

// pixels: RGBA 8-bit, W x H. labels: Int32Array w x h from the reader (mass id or -1).
export function applyEdit(pixels, W, H, labels, w, h, mass, op, amount) {
  if (!OPS.includes(op)) throw new Error('unknown change ' + op);
  const n = w * h;
  const region = new Float64Array(n);
  let area = 0;
  for (let i = 0; i < n; i++) if (labels[i] === mass) { region[i] = 1; area++; }
  if (!area) throw new Error(`mass ${mass} has no pixels`);
  const soft = gaussianFilter(region, [h, w], [EDGE_SIGMA, EDGE_SIGMA], 'reflect');
  const m = sampler(soft, w, h, W, H);
  const out = new Uint8ClampedArray(pixels);
  let c = null;
  if (op === 'paint out') {
    // ring: within RING_PX of the mass, outside it
    const ring = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue;
      for (let dy = -RING_PX; dy <= RING_PX; dy++) for (let dx = -RING_PX; dx <= RING_PX; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || dx * dx + dy * dy > RING_PX * RING_PX) continue;
        if (!region[Y * w + X]) ring[Y * w + X] = 1;
      }
    }
    const s = [0, 0, 0]; let k = 0;
    const sx = w / W, sy = h / H;
    for (let Y = 0; Y < H; Y++) {
      const v = Math.min(h - 1, Math.max(0, Math.round((Y + 0.5) * sy - 0.5)));
      for (let X = 0; X < W; X++) {
        const u = Math.min(w - 1, Math.max(0, Math.round((X + 0.5) * sx - 0.5)));
        if (!ring[v * w + u]) continue;
        const i = 4 * (Y * W + X);
        s[0] += pixels[i]; s[1] += pixels[i + 1]; s[2] += pixels[i + 2]; k++;
      }
    }
    if (!k) throw new Error('no ground around the mass to paint it out with');
    c = s.map((x) => x / k);
  }
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const a = m(X, Y);
    if (a < 1e-4) continue;
    const i = 4 * (Y * W + X);
    for (let ch = 0; ch < 3; ch++) {
      const p = pixels[i + ch];
      out[i + ch] = Math.round(op === 'lighter' ? p + amount * a * (255 - p)
                              : op === 'darker' ? p * (1 - amount * a)
                              : p + a * (c[ch] - p));
    }
  }
  return { pixels: out, area_share: area / n, ring_colour: c && c.map(Math.round) };
}
