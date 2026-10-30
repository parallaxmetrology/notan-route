// Compare two readings (A and B) of the same picture or of two versions of it: which masses
// match, where the first stop changed, whether the basins still end in the same place, how much
// of the divide stays, and how the centre route changes. Works on the page's data files (the
// schema tools/export.py and the JS port both write), so the two readings may differ in size.

export const TOL_MASS = 0.05;   // as notan-route's basin-end tolerance (frame's long side)
export const TOL_DIV = 0.02;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// one-to-one, nearest first, same polarity, within tol
export function matchMasses(A, B, tol = TOL_MASS) {
  const pairs = [];
  for (const a of A.targets) for (const b of B.targets) {
    if (a.polarity !== b.polarity) continue;
    const d = dist([a.x, a.y], [b.x, b.y]);
    if (d <= tol) pairs.push([d, a.id, b.id]);
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const ab = new Map(), ba = new Map();
  for (const [, a, b] of pairs) if (!ab.has(a) && !ba.has(b)) { ab.set(a, b); ba.set(b, a); }
  return { ab, ba };
}

const cellXY = (d, c, r) => {
  const [w, h] = d.work_px, g = d.grid;
  return [(g.col0 + c * g.step - (w - 1) / 2) / d.span, (g.row0 + r * g.step - (h - 1) / 2) / d.span];
};
export function cellOf(d, x, y) {
  const [w, h] = d.work_px, g = d.grid;
  const c = Math.round((x * d.span + (w - 1) / 2 - g.col0) / g.step);
  const r = Math.round((y * d.span + (h - 1) / 2 - g.row0) / g.step);
  return c < 0 || r < 0 || c >= g.w || r >= g.h ? -1 : r * g.w + c;
}

export function catchment(d) {
  const n = d.landing.length, out = new Map();
  for (const t of d.landing) if (t >= 0) out.set(t, (out.get(t) || 0) + 1 / n);
  return out;
}

export function dividesOf(d) {
  const g = d.grid, L = d.landing, out = [];
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    const a = L[r * g.w + c];
    if (c + 1 < g.w && L[r * g.w + c + 1] !== a) {
      const [x0, y] = cellXY(d, c, r), [x1] = cellXY(d, c + 1, r);
      out.push({ x: (x0 + x1) / 2, y, v: 1, r, c });
    }
    if (r + 1 < g.h && L[(r + 1) * g.w + c] !== a) {
      const [x, y0] = cellXY(d, c, r), [, y1] = cellXY(d, c, r + 1);
      out.push({ x, y: (y0 + y1) / 2, v: 0, r, c });
    }
  }
  return out;
}

function nearAny(pts, tol) {
  const m = new Map();
  for (const p of pts) {
    const k = `${Math.floor(p.x / tol)},${Math.floor(p.y / tol)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  return (x, y) => {
    const i = Math.floor(x / tol), j = Math.floor(y / tol);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      for (const p of m.get(`${i + a},${j + b}`) || []) if (Math.hypot(p.x - x, p.y - y) <= tol) return true;
    return false;
  };
}

const endsXY = (d, b) => b.end.map((i) => [d.targets[i].x, d.targets[i].y]);
const sameEnds = (p, q, tol) => p.length === q.length && p.every((a) => Math.min(...q.map((b) => dist(a, b))) <= tol);

export function compare(A, B, { tolMass = TOL_MASS, tolDiv = TOL_DIV } = {}) {
  const { ab, ba } = matchMasses(A, B, tolMass);
  // first stop, on B's grid: does the matching cell of A lead to the matching mass?
  const changedB = new Uint8Array(B.landing.length);
  let nCells = 0, nChanged = 0;
  for (let r = 0; r < B.grid.h; r++) for (let c = 0; c < B.grid.w; c++) {
    const k = r * B.grid.w + c;
    const [x, y] = cellXY(B, c, r);
    const ka = cellOf(A, x, y);
    if (ka < 0) continue;
    nCells++;
    const la = A.landing[ka], lb = B.landing[k];
    const same = la < 0 ? lb < 0 : ab.get(la) === lb;
    if (!same) { changedB[k] = 1; nChanged++; }
  }
  // masses
  const cA = catchment(A), cB = catchment(B);
  const masses = A.targets.map((a) => {
    const b = ab.has(a.id) ? B.targets[ab.get(a.id)] : null;
    return { a: a.id, b: b ? b.id : null, polarity: a.polarity,
             strength: [a.strength, b ? b.strength : 0], catchment: [cA.get(a.id) || 0, b ? cB.get(b.id) || 0 : 0],
             basin: [a.basin, b ? b.basin : null] };
  });
  const added = B.targets.filter((b) => !ba.has(b.id)).map((b) => ({ b: b.id, polarity: b.polarity, strength: b.strength, catchment: cB.get(b.id) || 0 }));
  // basins: does each of A's basins still end in the same place (as notan-route's stability check)?
  const usedB = new Set();
  const basins = A.basins.map((ba_, i) => {
    const pa = endsXY(A, ba_);
    const j = B.basins.findIndex((bb, jj) => !usedB.has(jj) && sameEnds(pa, endsXY(B, bb), tolMass));
    if (j >= 0) usedB.add(j);
    return { a: i, b: j >= 0 ? j : null, ends_a: ba_.end, ends_b: j >= 0 ? B.basins[j].end : null,
             share: [ba_.mass_share, j >= 0 ? B.basins[j].mass_share : null], kind: ba_.kind };
  });
  const newBasins = B.basins.map((b, j) => j).filter((j) => !usedB.has(j))
    .map((j) => ({ b: j, ends_b: B.basins[j].end, share: B.basins[j].mass_share, kind: B.basins[j].kind }));
  // divides
  const dA = dividesOf(A), dB = dividesOf(B);
  const nearB = nearAny(dB, tolDiv), nearA = nearAny(dA, tolDiv);
  const lostA = dA.filter((p) => !nearB(p.x, p.y));
  const newB = dB.filter((p) => !nearA(p.x, p.y));
  // routes
  const route = (d) => (d.histories && d.histories.centre ? d.histories.centre.stops : []);
  const rA = route(A), rB = route(B);
  let agree = 0;
  while (agree < Math.min(rA.length, rB.length) && ab.get(rA[agree]) === rB[agree]) agree++;
  return {
    tol_mass: tolMass, tol_div: tolDiv,
    matched: ab.size, n_a: A.targets.length, n_b: B.targets.length,
    first_stop_changed: nCells ? nChanged / nCells : 0, changed_b: changedB,
    masses, added, basins, new_basins: newBasins,
    divides: { a: dA.length, b: dB.length, kept_a: dA.length - lostA.length, lost_a: lostA, new_b: newB },
    route: { a: rA, b: rB, b_as_a: rB.map((i) => (ba.has(i) ? ba.get(i) : null)), agree },
  };
}
