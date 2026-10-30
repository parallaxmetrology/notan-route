// What if + compare check: the port's reading of a painting must equal the baked one; a reading
// compared with itself must show no change; then three edits of the strongest mass of basin 1.
//   node tools/whatif_check.mjs REFDIR name   (REFDIR from tools/dump_reference.py)
import { readFileSync } from 'node:fs';
import { read, drainage } from '../js/notan-route.js';
import { applyEdit } from '../js/whatif.js';
import { compare } from '../js/compare.js';
const ref = process.argv[2], name = process.argv[3];
const meta = JSON.parse(readFileSync(`${ref}/${name}.json`));
const rgb = new Uint8Array(readFileSync(`${ref}/${name}.u8`));
const { W, H } = meta, px = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { px[4*i]=rgb[3*i]; px[4*i+1]=rgb[3*i+1]; px[4*i+2]=rgb[3*i+2]; px[4*i+3]=255; }
let t = Date.now();
const rd = read(px, W, H, 4); const A = drainage(rd);
const baked = JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
console.log('JS read', (Date.now()-t)/1000, 's; landing equals baked:', JSON.stringify(A.landing) === JSON.stringify(baked.landing));
const self = compare(A, A);
console.log('A vs A: changed', self.first_stop_changed, 'matched', self.matched, '/', self.n_a, 'lost', self.divides.lost_a.length, 'new', self.divides.new_b.length, 'basins held', self.basins.filter(b=>b.b!==null).length, 'route agree', self.route.agree);
const bakedVsJs = compare(baked, A);
console.log('baked vs JS: changed', bakedVsJs.first_stop_changed);
const m = A.basins[0].end[0];
for (const [op, amt] of [['lighter', 0.4], ['darker', 0.4], ['paint out', 1]]) {
  t = Date.now();
  const e = applyEdit(px, W, H, rd.labels, rd.w, rd.h, m, op, amt);
  const B = drainage(read(e.pixels, W, H, 4));
  const c = compare(A, B);
  console.log(`${op} mass ${m} (${A.targets[m].polarity}, area ${(100*e.area_share).toFixed(1)}%):`, (Date.now()-t)/1000, 's',
    `| masses ${c.n_a}->${c.n_b}, matched ${c.matched}, first stop changed ${(100*c.first_stop_changed).toFixed(0)}%`,
    `| mass ${m} strength ${c.masses[m].strength.join('->')} catch ${c.masses[m].catchment.map(x=>x.toFixed(2)).join('->')}`,
    `| basins held ${c.basins.filter(b=>b.b!==null).length}/${c.basins.length} new ${c.new_basins.length}`,
    `| divide kept ${c.divides.kept_a}/${c.divides.a} new ${c.divides.new_b.length} | route ${c.route.a.join(',')} vs ${c.route.b_as_a.join(',')}`);
}
