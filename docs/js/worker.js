// Runs the port off the main thread.
//   {pixels: RGBA Uint8ClampedArray, W, H}             -> stages, then {done, data, notan}
//   {stability: true, pixels, W, H}                     -> stages, then {done, stability}
//   {edit: {mass, op, amount, labels, w, h}, pixels, W, H} -> the changed pixels are read:
//                                                          {done, data, notan, labels, pixels, edit}
// Every reading also returns the reader's mass map (labels, working size) for later edits.
// For stability, the JPEG-60 change uses this browser's own JPEG encoder and decoder.
import { read, drainage, notan3, rgbFromU8 } from './notan-route.js';
import { stability } from './stability.js';
import { applyEdit } from './whatif.js';

async function jpeg60(pixels, W, H) {
  const c = new OffscreenCanvas(W, H);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const d = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  d.drawImage(bmp, 0, 0);
  return d.getImageData(0, 0, W, H).data;
}

self.onmessage = async (e) => {
  const { pixels, W, H } = e.data;
  const t0 = performance.now();
  const stage = (s) => self.postMessage({ stage: s });
  try {
    if (e.data.stability) {
      stage('JPEG 60 (this browser\'s encoder)');
      const jp = await jpeg60(pixels, W, H);
      const st = stability(rgbFromU8(pixels, W, H, 4), W, H, rgbFromU8(jp, W, H, 4), stage);
      delete st._readings; delete st._base;
      st.seconds = +((performance.now() - t0) / 1000).toFixed(1);
      self.postMessage({ done: true, stability: st });
      return;
    }
    let px = pixels, edit = null;
    if (e.data.edit) {
      const q = e.data.edit;
      stage(`${q.op} mass ${q.mass}`);
      const r = applyEdit(pixels, W, H, q.labels, q.w, q.h, q.mass, q.op, q.amount);
      px = r.pixels; edit = { mass: q.mass, op: q.op, amount: q.amount, area_share: r.area_share, ring_colour: r.ring_colour };
    }
    const rd = read(px, W, H, 4, stage);
    const data = drainage(rd, stage);
    data.receipt = { computed: 'in this browser, by the JavaScript port', source_px: [W, H],
                     seconds: +((performance.now() - t0) / 1000).toFixed(1) };
    const msg = { done: true, data, notan: notan3(rd), labels: rd.labels, w: rd.w, h: rd.h, edit };
    if (edit) msg.pixels = px;
    self.postMessage(msg, edit ? [rd.labels.buffer, px.buffer] : [rd.labels.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.stack || err) });
  }
};
