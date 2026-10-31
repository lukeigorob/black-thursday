// The villages and little towns of Lower Franconia as they look from the air, painted once into one atlas
// (countryside.js lays them on the ground and stands the near ones up in 3D from the same plans).
// A village (Haufendorf) is a knot of farmsteads along a few crooked lanes round its church: each farmstead
// a house with its gable to the lane, a stable down one side and a big barn across the back of the yard,
// the kitchen garden behind. Round it all the orchards (Streuobst), fruit trees in rough rows in the grass:
// the dark ring that marks a village from five miles up. Some villages are strung along one street
// (Straßendorf) or round a long green with its pond (Angerdorf); a hamlet is a handful of farms on a bend.
// A small town has its old walled town, packed solid round the market and the church, the old wall a ring
// of trees, and the newer houses in their gardens out along the roads.
// Every roof is weathered red-brown plain tile (some slate, the barns darker), its far slope in shade; the
// buildings and trees throw a soft shadow. The edges fade into the fields the shader draws under them.
import { distToLine } from './urban.js';

export const ATLAS = 4096;

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rand = (a, b) => a + rnd() * (b - a);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const ROOF = ['#9a4f33', '#8c4630', '#a0573a', '#83472f', '#7e4c38', '#944f34', '#88402a', '#a35c3e', '#734a3a'];
const BARN = ['#6e4636', '#68503f', '#5e4638', '#774e36', '#625246', '#7a4f36'];
const SLATE = ['#55565a', '#4d4f54'];
const YARD = ['#5c5244', '#574e41', '#615646'];
const LANE = '#6f6654', STREET = '#67605a';
const GRASS = ['#424c2b', '#465030', '#3f492a', '#4a532f'];
const TREE = ['#343f22', '#3a4524', '#4c4c25', '#585024', '#303a20', '#424523', '#5c4e28'];
const GARDEN = ['#5e4e38', '#525e32', '#6a5a40', '#4e5a33', '#6e6248', '#5f6a3a'];

/**
 * One village or town's plan, painted on its own canvas. kind: 'hamlet' | 'haufen' | 'strassen' | 'anger' | 'town'.
 * Returns { canvas, size (m across), buildings: [{ x, z, len, wid, ang, h, rh, wall, roof, tower? }], spires: [{ x, z, r, h, y }] }.
 */
export function paintPlace(kind, px, s0) {
  seed = s0;
  const S = kind === 'hamlet' ? 520 : kind === 'town' ? 2100 : kind === 'strassen' ? 1150 : 1000;
  const P = px, sc = P / S, X = (m) => P / 2 + m * sc;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = P; return c; };
  const main = mk(), g = main.getContext('2d');
  const shadowC = mk(), sg = shadowC.getContext('2d');
  const maskC = mk(), mg = maskC.getContext('2d');
  const lanes = [], plots = [], buildings = [], trees = [], spires = [], gardens = [], yards = [], greens = [];

  // ---------------- the lanes ----------------
  const wiggle = (pts, amp) => pts.map(([x, z], i) => (i === 0 || i === pts.length - 1 ? [x, z] : [x + rand(-amp, amp), z + rand(-amp, amp)]));
  const smooth = (pts, n = 3) => { let l = pts; for (let it = 0; it < n; it++) { const o = [l[0]]; for (let k = 0; k < l.length - 1; k++) { const [a, b] = l[k], [c, d] = l[k + 1]; o.push([a * 0.75 + c * 0.25, b * 0.75 + d * 0.25], [a * 0.25 + c * 0.75, b * 0.25 + d * 0.75]); } o.push(l[l.length - 1]); l = o; } return l; };
  const ray = (a, r0, r1, amp = 18) => { const n = 6, pts = []; for (let k = 0; k <= n; k++) { const r = r0 + ((r1 - r0) * k) / n, aa = a + Math.sin(k * 0.9) * 0.08; pts.push([Math.cos(aa) * r, Math.sin(aa) * r]); } return smooth(wiggle(pts, amp), 2); };
  const lane = (pts, w, wide = false) => { lanes.push({ pts, w, wide }); return pts; };
  let core = 160, church = [0, 0];
  if (kind === 'haufen' || kind === 'hamlet') {
    const arms = kind === 'hamlet' ? 2 : 3 + (rnd() < 0.6), a0 = rand(0, 6.28);
    for (let i = 0; i < arms; i++) lane(ray(a0 + (i / arms) * 6.28 + rand(-0.4, 0.4), 0, S * 0.49, kind === 'hamlet' ? 10 : 22), kind === 'hamlet' ? 5 : 7);
    if (kind === 'haufen') { // crooked lanes between them, round the middle
      for (let i = 0; i < 6; i++) {
        const a = rand(0, 6.28), r = rand(60, 200), da = rand(0.7, 1.6);
        const pts = []; for (let k = 0; k <= 6; k++) { const aa = a + (da * k) / 6, rr = r * (1 + 0.15 * Math.sin(k)); pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]); }
        lane(smooth(wiggle(pts, 10), 2), 5);
      }
      core = rand(190, 270);
    } else core = rand(70, 110);
    church = kind === 'hamlet' ? null : [rand(-15, 15), rand(-15, 15)];
  } else if (kind === 'strassen' || kind === 'anger') {
    const L = S * 0.47, bend = rand(-50, 50);
    const street = smooth(wiggle([[-L, 0], [-L * 0.5, bend * 0.5], [0, bend], [L * 0.5, bend * 0.4], [L, 0]], 15), 3);
    if (kind === 'anger') { // the street parts round a long green and meets again
      const gw = rand(28, 40), gl = rand(150, 210);
      const up = [], dn = [];
      for (let k = 0; k <= 12; k++) { const t = -1 + (2 * k) / 12, x = t * gl, half = gw * Math.sqrt(Math.max(0, 1 - t * t)) + 6; up.push([x, bend - half]); dn.push([x, bend + half]); }
      lane(street.filter(([x]) => x < -gl), 7); lane(street.filter(([x]) => x > gl), 7);
      lane(up, 6); lane(dn, 6);
      greens.push({ x: 0, z: bend, rx: gl, rz: gw });
      church = [rand(-40, 40), bend];
    } else {
      lane(street, 7);
      church = [rand(-120, 120), bend + rand(-6, 6)];
      if (rnd() < 0.7) lane(smooth(wiggle([[-L * 0.7, 75], [0, 80 + bend * 0.6], [L * 0.6, 70]], 12), 2), 4); // (the back lane)
    }
    lane(ray(rand(1.2, 1.9), 25, S * 0.49), 5); lane(ray(rand(4.3, 5.1), 25, S * 0.49), 5); // (side roads out)
    core = L * 0.8;
  } else { // the town
    core = 0;
  }

  // ---------------- the farmsteads along the lanes ----------------
  const near = (x, z, r) => plots.some((p) => Math.hypot(p.x - x, p.z - z) < r + p.r);
  // (plots as turned rectangles: two overlap unless one of their four axes parts them)
  const overlap = (a, b) => {
    if (Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r) return false;
    if (!a.tx || !b.tx) return Math.hypot(a.x - b.x, a.z - b.z) < Math.min(a.r, b.r) + 4;
    for (const [ux, uz] of [[a.tx, a.tz], [a.nx, a.nz], [b.tx, b.tz], [b.nx, b.nz]]) {
      const ext = (q) => Math.abs(q.tx * ux + q.tz * uz) * q.f / 2 + Math.abs(q.nx * ux + q.nz * uz) * q.D / 2;
      if (Math.abs((a.x - b.x) * ux + (a.z - b.z) * uz) > ext(a) + ext(b) + 1) return false;
    }
    return true;
  };
  const inPlot = (x, z) => plots.some((p) => p.tx && Math.abs((x - p.x) * p.tx + (z - p.z) * p.tz) < p.f / 2 && Math.abs((x - p.x) * p.nx + (z - p.z) * p.nz) < p.D / 2);
  const laneDist = (x, z, self) => Math.min(...lanes.filter((l) => l !== self).map((l) => distToLine(x, z, l.pts) - l.w / 2));
  const farm = (l, x, z, tx, tz, side, small, depth = 0) => {
    const nx = -tz * side, nz = tx * side; // (away from the lane)
    const f = small ? rand(11, 15) : rand(18, 28), yard = small ? 0 : rand(14, 22), bd = rand(9, 12), gd = depth ? 0 : rand(8, 26);
    const D = small ? rand(16, 22) : yard + bd + gd + 3;
    const ox = x + nx * (l.w / 2 + 1.5), oz = z + nz * (l.w / 2 + 1.5); // the plot's front, at the lane
    const cx = ox + (nx * D) / 2, cz = oz + (nz * D) / 2;
    const plot = { x: cx, z: cz, r: Math.hypot(f, D) / 2, ox, oz, nx, nz, tx, tz, f, D };
    const clear = !plots.some((p) => overlap(plot, p)) && laneDist(ox + nx * D * 0.75, oz + nz * D * 0.75, l) > 2 && laneDist(cx, cz, l) > 2 && laneDist(ox + nx * D, oz + nz * D, l) > 1
      && (!church || Math.hypot(cx - church[0], cz - church[1]) > 30 + plot.r);
    if (!clear) return !small && !depth ? farm(l, x, z, tx, tz, side, false, 1) || farm(l, x, z, tx, tz, side, true, 1) : false;
    plots.push(plot);
    const at = (a, b) => [ox + tx * a + nx * b, oz + tz * a + nz * b];
    const angT = Math.atan2(tz, tx), angN = Math.atan2(nz, nx);
    const tile = () => (rnd() < 0.07 ? pick(SLATE) : pick(ROOF));
    if (small) {
      const [hx, hz] = at(rand(-1, 1), 6.5); buildings.push({ x: hx, z: hz, len: rand(9, 11), wid: rand(7, 8), ang: rnd() < 0.5 ? angN : angT, h: 5.5, rh: 4.5, roof: tile(), wall: 1 });
      const [sx2, sz2] = at(rand(-3, 3), D - 4); buildings.push({ x: sx2, z: sz2, len: rand(5, 7), wid: 4.5, ang: angT, h: 3, rh: 2.5, roof: pick(BARN), wall: 2 });
      const [gx, gz] = at(0, D / 2 + 3); gardens.push({ x: gx, z: gz, w: f, d: D - 6, ang: angT });
      return true;
    }
    const hl = rand(12, 15), hw = rand(8.5, 10.5), hs = rnd() < 0.5 ? -1 : 1;
    const [yx, yz] = at(0, 1 + yard / 2); yards.push({ x: yx, z: yz, w: f, d: yard + 2, ang: angT });
    let [bx, bz] = at(hs * (f / 2 - hw / 2 - 0.5), hl / 2 + 0.5);
    buildings.push({ x: bx, z: bz, len: hl, wid: hw, ang: angN, h: rand(6.5, 8.5), rh: rand(5.5, 7), roof: tile(), wall: 1 }); // the house, gable to the lane
    if (rnd() < 0.75) { const sl = rand(10, yard + 2); [bx, bz] = at(-hs * (f / 2 - 3.6), 2 + sl / 2); buildings.push({ x: bx, z: bz, len: sl, wid: rand(6, 7.5), ang: angN, h: rand(4, 5), rh: 3.5, roof: pick(BARN), wall: 2 }); } // the stable
    [bx, bz] = at(rand(-1, 1), yard + 1 + bd / 2); buildings.push({ x: bx, z: bz, len: f - rand(0.5, 3), wid: bd, ang: angT, h: rand(6, 8), rh: rand(6, 7.5), roof: pick(BARN), wall: 2 }); // the barn across the back
    const [gx, gz] = at(0, yard + bd + 2 + gd / 2); gardens.push({ x: gx, z: gz, w: f, d: gd, ang: angT });
    // the orchard behind, out into the grass
    const od = rnd() < 0.5 ? rand(15, 70) * (kind === 'town' ? 0.5 : 1) : 0;
    for (let b = D + 4; b < D + od; b += rand(9, 12)) for (let a = -f / 2 + 4; a < f / 2; a += rand(9, 12)) if (rnd() < 0.85) { const [tx2, tz2] = at(a + rand(-1.5, 1.5), b + rand(-1.5, 1.5)); trees.push([tx2, tz2, rand(2.8, 4.2), 'orchard']); }
    if (od > 15) greens.push({ x: at(0, D + od / 2)[0], z: at(0, D + od / 2)[1], w: f + rand(0, 8), d: od + 6, ang: angT, rect: true });
    return true;
  };
  const alongLanes = (filter, spacing, small) => {
    for (const l of lanes) {
      const pts = l.pts;
      let acc = rand(0, spacing);
      for (let k = 1; k < pts.length; k++) {
        const [ax, az] = pts[k - 1], [bx, bz] = pts[k], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
        for (; acc < L; acc += spacing * rand(0.8, 1.25)) {
          const x = ax + tx * acc, z = az + tz * acc;
          if (!filter(x, z)) continue;
          for (const side of [-1, 1]) if (rnd() < 0.93) farm(l, x, z, tx, tz, side, small || rnd() < 0.15);
        }
        acc -= L;
      }
    }
  };
  if (kind !== 'town') {
    alongLanes((x, z) => Math.hypot(x, z) < core * (0.75 + 0.5 * rnd()), 16, false);
    alongLanes((x, z) => Math.hypot(x, z) < core * 0.9, 12, false); // (and again: the gaps filled)
    alongLanes((x, z) => Math.hypot(x, z) < core * 1.5 && rnd() < 0.35, 30, true); // (cottages at the ends)
  }

  // ---------------- the town: its walled old town, the newer houses out along the roads ----------------
  let oldTown = null;
  if (kind === 'town') {
    const rx = rand(250, 320), rz = rand(170, 220), ta = rand(-0.5, 0.5), ca = Math.cos(ta), sa = Math.sin(ta);
    const T = (u, v) => [u * ca - v * sa, u * sa + v * ca];
    const ph = rand(0, 6.28), ph2 = rand(0, 6.28), rim = (a) => 1 + 0.07 * Math.sin(3 * a + ph) + 0.045 * Math.sin(5 * a + ph2); // (not an ellipse: the wall followed the ground)
    oldTown = { rx, rz, ta, rim, inside: (x, z) => { const u = x * ca + z * sa, v = -x * sa + z * ca; return (u / rx) ** 2 + (v / rz) ** 2 < rim(Math.atan2(v / rz, u / rx)) ** 2; } };
    // the streets inside: the main street gate to gate (widening into the market), two along it, lanes across
    const st = [];
    st.push(lane(smooth(wiggle([T(-rx - 30, 0), T(-rx * 0.4, rand(-12, 12)), T(0, rand(-8, 8)), T(rx * 0.45, rand(-12, 12)), T(rx + 30, 0)], 8), 2), 10, true));
    for (const v of [-rz * 0.5, rz * 0.48]) st.push(lane(smooth(wiggle([T(-rx * 0.85, v * 0.8), T(-rx * 0.3, v), T(rx * 0.35, v * 1.02), T(rx * 0.85, v * 0.8)], 6), 2), 6.5));
    for (let i = 0; i < 7; i++) { const u = -rx * 0.75 + (i / 6) * rx * 1.5 + rand(-25, 25), top = rnd() < 0.5; st.push(lane(smooth(wiggle([T(u, top ? -rz * 0.95 : rand(-rz * 0.6, 0)), T(u + rand(-25, 25), rand(-20, 20)), T(u + rand(-45, 45), top ? rand(0, rz * 0.6) : rz * 0.95)], 12), 2), rand(4, 6))); }
    lane(smooth(wiggle(Array.from({ length: 25 }, (_, k) => { const a = (k / 24) * 6.2832, m = oldTown.rim(a); return T(Math.cos(a) * (rx * m - 8), Math.sin(a) * (rz * m - 8)); }), 3), 1), 5); // (the lane inside the wall)
    church = T(rand(-40, 40), -rz * 0.12);
    // the roads out of the gates, and the newer town along them
    const gates = [T(-rx - 30, 0), T(rx + 30, 0), T(rand(-60, 60), -rz - 20), T(rand(-60, 60), rz + 20)];
    for (const [gx, gz] of gates) { const a = Math.atan2(gz, gx) + rand(-0.3, 0.3); lane(smooth(wiggle([[gx, gz], [gx + Math.cos(a) * 300, gz + Math.sin(a) * 300], [Math.cos(a) * S * 0.49, Math.sin(a) * S * 0.49]], 25), 2), 8); }
    for (let i = 0; i < 5; i++) { const a = rand(0, 6.28), r = rand(rx + 90, rx + 300); const pts = []; for (let k = 0; k <= 5; k++) { const aa = a + k * 0.16; pts.push([Math.cos(aa) * r * 1.0, Math.sin(aa) * r * 0.8]); } lane(smooth(wiggle(pts, 12), 2), 6); }
    // houses shoulder to shoulder along every street of the old town, back buildings behind them
    for (const l of lanes) {
      const pts = l.pts;
      for (let k = 1; k < pts.length; k++) {
        const [ax, az] = pts[k - 1], [bx, bz] = pts[k], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let a = 0; a < L; a += rand(7, 11)) {
          const x = ax + tx * a, z = az + tz * a;
          for (const side of [-1, 1]) {
            const nx = -tz * side, nz = tx * side, d = rand(10, 14), off = l.w / 2 + 0.5 + d / 2;
            const hx = x + nx * off, hz = z + nz * off;
            if (!oldTown.inside(hx, hz) || Math.hypot(hx - church[0], hz - church[1]) < 40) continue;
            if (l.wide && Math.hypot(hx, hz) < 55) continue; // (the market)
            buildings.push({ x: hx, z: hz, len: rand(7.5, 10.5), wid: d, ang: Math.atan2(tz, tx), h: rand(9, 14), rh: rand(5, 7), roof: rnd() < 0.1 ? pick(SLATE) : pick(ROOF), wall: 1, town: true });
            if (rnd() < 0.55) { const bb = off + d / 2 + rand(3, 9); buildings.push({ x: x + nx * bb, z: z + nz * bb, len: rand(5, 9), wid: rand(5, 7), ang: Math.atan2(tz, tx) + (rnd() < 0.5 ? 1.5708 : 0), h: rand(4, 7), rh: 3, roof: pick(BARN), wall: 2, town: true }); }
          }
        }
      }
    }
    buildings.push({ x: T(25, 4)[0], z: T(25, 4)[1], len: 26, wid: 13, ang: ta, h: 12, rh: 8, roof: pick(SLATE), wall: 3 }); // the town hall on the market
    // newer houses in their gardens out along the roads beyond the wall, the odd workshop
    for (const l of lanes) {
      const pts = l.pts;
      for (let k = 1; k < pts.length; k++) {
        const [ax, az] = pts[k - 1], [bx, bz] = pts[k], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let a = rand(0, 10); a < L; a += rand(15, 24)) {
          const x = ax + tx * a, z = az + tz * a, r = Math.hypot(x, z);
          if (oldTown.inside(x * 0.88, z * 0.88) || r > rx + 520 + rand(-150, 150)) continue;
          for (const side of [-1, 1]) {
            if (rnd() < 0.2) continue;
            const nx = -tz * side, nz = tx * side, off = l.w / 2 + rand(5, 9), hx = x + nx * (off + 5), hz = z + nz * (off + 5);
            if (near(hx, hz, 7) || laneDist(hx, hz, l) < 8) continue;
            if (rnd() < 0.08 && r > rx + 120) { buildings.push({ x: hx + nx * 10, z: hz + nz * 10, len: rand(20, 40), wid: rand(12, 18), ang: Math.atan2(tz, tx), h: rand(6, 9), rh: 2.5, roof: pick(['#6f6c66', '#77746c', '#5f5d58']), wall: 2 }); plots.push({ x: hx + nx * 10, z: hz + nz * 10, r: 18 }); continue; }
            plots.push({ x: hx, z: hz, r: 8 });
            buildings.push({ x: hx, z: hz, len: rand(10, 13), wid: rand(8.5, 10.5), ang: Math.atan2(tz, tx) + (rnd() < 0.3 ? 1.5708 : 0), h: rand(7, 10), rh: rand(4.5, 6.5), roof: rnd() < 0.15 ? pick(SLATE) : pick(ROOF), wall: 1 });
            const [gx, gz] = [hx + nx * 16, hz + nz * 16]; gardens.push({ x: gx, z: gz, w: rand(14, 20), d: rand(18, 30), ang: Math.atan2(tz, tx) });
            for (let t = 0; t < 3; t++) if (rnd() < 0.7) trees.push([gx + rand(-9, 9), gz + rand(-12, 12), rand(2.5, 4), 'garden']);
          }
        }
      }
    }
    // the old wall: a ring of trees round the old town (its moat gardens), the orchards and gardens beyond
    for (let n = 0; n < 2600; n++) { // the back buildings filling the old town's yards
      const x = rand(-rx * 1.1, rx * 1.1), z = rand(-rx * 1.1, rx * 1.1);
      if (!oldTown.inside(x, z) || Math.hypot(x - church[0], z - church[1]) < 38 || Math.hypot(x, z) < 50 || Math.min(...lanes.map((l) => distToLine(x, z, l.pts) - l.w / 2)) < 3) continue;
      buildings.push({ x, z, len: rand(5, 11), wid: rand(4.5, 8), ang: ta + (rnd() < 0.5 ? 1.5708 : 0) + rand(-0.2, 0.2), h: rand(4, 8), rh: rand(2.5, 4), roof: rnd() < 0.6 ? pick(BARN) : pick(ROOF), wall: 2, town: true });
    }
    for (let k = 0; k < 140; k++) { const a = (k / 140) * 6.2832, m = oldTown.rim(a), [x, z] = T(Math.cos(a) * (rx * m + 14), Math.sin(a) * (rz * m + 14)); trees.push([x + rand(-2, 2), z + rand(-2, 2), rand(4, 6), 'big']); }
    for (let i = 0; i < 26; i++) { const a = rand(0, 6.28), r = rand(rx + 250, rx + 560), x = Math.cos(a) * r, z = Math.sin(a) * r * 0.85;
      const w = rand(40, 110), d = rand(50, 140), ang = rand(0, 3.14), c2 = Math.cos(ang), s2 = Math.sin(ang);
      greens.push({ x, z, w: d, d: w, ang, rect: true });
      for (let u = -d / 2 + 5; u < d / 2; u += rand(8.5, 11)) for (let v = -w / 2 + 5; v < w / 2; v += rand(8.5, 11)) if (rnd() < 0.8) trees.push([x + c2 * u - s2 * v + rand(-1, 1), z + s2 * u + c2 * v + rand(-1, 1), rand(2.8, 4), 'orchard']); }
    core = rx + 300;
  }

  // ---------------- the church in its walled churchyard, and its linden trees ----------------
  if (church) {
    const [cx, cz] = church, a = rand(0, 6.28), big = kind === 'town', ca = Math.cos(a), sa = Math.sin(a);
    const nl = big ? 46 : rand(20, 26), nw = big ? 17 : rand(9, 11);
    greens.push({ x: cx, z: cz, rx: big ? 50 : 30, rz: big ? 44 : 26, ang: a, yard: true });
    buildings.push({ x: cx, z: cz, len: nl, wid: nw, ang: a, h: big ? 16 : 9, rh: big ? 12 : 7, roof: big ? pick(SLATE) : pick(ROOF), wall: 3 });
    const tx = cx - ca * (nl / 2 + 3), tz = cz - sa * (nl / 2 + 3), tw = big ? 11 : 7;
    buildings.push({ x: tx, z: tz, len: tw, wid: tw, ang: a, h: big ? 44 : rand(20, 26), rh: 0, roof: '#58554e', wall: 3, tower: true });
    spires.push({ x: tx, z: tz, r: tw * 0.62, h: big ? 26 : rand(10, 15), y: big ? 44 : buildings[buildings.length - 1].h });
    for (let k = 0; k < (big ? 10 : 6); k++) { const t = rand(0, 6.28); trees.push([cx + Math.cos(t) * rand(18, big ? 44 : 26), cz + Math.sin(t) * rand(14, big ? 38 : 22), rand(4.5, 6.5), 'big']); }
  }
  // the orchard ring and odd trees round a village (where there's grass and no farm)
  if (kind !== 'town') {
    for (let i = 0; i < (kind === 'hamlet' ? 6 : 16); i++) { // (orchard parcels round the edge: rows of fruit trees in the grass)
      const a = rand(0, 6.28), r = core * rand(0.8, 1.25) + 30, x = Math.cos(a) * r, z = Math.sin(a) * r, w = rand(25, 60), d = rand(40, 90), ang = a + rand(-0.3, 0.3), ca = Math.cos(ang), sa = Math.sin(ang);
      if (near(x, z, 15)) continue;
      greens.push({ x, z, w: d, d: w, ang, rect: true });
      for (let u = -d / 2 + 5; u < d / 2; u += rand(8.5, 11)) for (let v = -w / 2 + 5; v < w / 2; v += rand(8.5, 11)) if (rnd() < 0.82) trees.push([x + ca * u - sa * v + rand(-1, 1), z + sa * u + ca * v + rand(-1, 1), rand(2.8, 4), 'orchard']);
    }
    for (const p of plots) if (rnd() < 0.3) trees.push([p.x + rand(-8, 8), p.z + rand(-8, 8), rand(4, 6), 'big']); // (the walnut or linden in the yard)
    // the orchard belt: fruit trees thick in the grass all round the farms (the dark ring that marks a village from the air)
    const ld = (x, z) => Math.min(...lanes.map((l) => distToLine(x, z, l.pts) - l.w / 2));
    for (const p of plots) {
      if (Math.hypot(p.x, p.z) < core * 0.6 && kind !== 'hamlet') continue; // (not in the middle of the village)
      for (let k = 0; k < 26; k++) {
        const a = rand(0, 6.28), d = p.r + rand(4, kind === 'hamlet' ? 60 : 90), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (inPlot(x, z) || ld(x, z) < 4 || (church && Math.hypot(x - church[0], z - church[1]) < 40)) continue;
        trees.push([x, z, rand(3, 4.6), 'orchard']);
        if (k % 4 === 0) greens.push({ x, z, rx: rand(14, 24), rz: rand(12, 20), ang: rand(0, 3), soft: true });
      }
    }
  }

  for (let k = trees.length - 1; k >= 0; k--) if (trees[k][3] === 'orchard' && inPlot(trees[k][0], trees[k][1])) trees.splice(k, 1);

  // ---------------- paint ----------------
  const rect = (ctx, x, z, w, d, ang) => { ctx.save(); ctx.translate(X(x), X(z)); ctx.rotate(ang); ctx.fillRect((-w / 2) * sc, (-d / 2) * sc, w * sc, d * sc); ctx.restore(); };
  const ell = (ctx, e) => { ctx.beginPath(); ctx.ellipse(X(e.x), X(e.z), e.rx * sc, e.rz * sc, e.ang ?? 0, 0, 7); ctx.fill(); };
  const stroke = (ctx, pts, w) => { ctx.lineWidth = Math.max(1, w * sc); ctx.beginPath(); pts.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](X(x), X(z))); ctx.stroke(); };
  g.lineCap = mg.lineCap = 'round'; g.lineJoin = mg.lineJoin = 'round';
  // the mask: where the village is (its plots, its grass, its lanes, fading out at the ends of the lanes)
  mg.fillStyle = '#fff'; mg.strokeStyle = '#fff';
  for (const p of plots) { mg.beginPath(); mg.arc(X(p.x), X(p.z), (p.r + 6) * sc, 0, 7); mg.fill(); }
  for (const e of greens) if (e.rect) rect(mg, e.x, e.z, e.w + 6, e.d + 6, e.ang); else ell(mg, { ...e, rx: e.rx + 4, rz: e.rz + 4 });
  for (const b of buildings) rect(mg, b.x, b.z, b.len + 8, b.wid + 8, b.ang);
  for (const t of trees) { mg.beginPath(); mg.arc(X(t[0]), X(t[1]), (t[2] + 3) * sc, 0, 7); mg.fill(); }
  if (oldTown) { mg.save(); mg.translate(X(0), X(0)); mg.rotate(oldTown.ta); mg.beginPath(); mg.ellipse(0, 0, (oldTown.rx * 1.12 + 22) * sc, (oldTown.rz * 1.12 + 22) * sc, 0, 0, 7); mg.fill(); mg.restore(); }
  for (const l of lanes) stroke(mg, l.pts, l.w + 2);
  // the grass under the orchards and round the church, the gardens, the yards
  for (const e of greens) { g.fillStyle = e.yard ? '#6d7149' : pick(GRASS); if (e.rect) rect(g, e.x, e.z, e.w, e.d, e.ang); else ell(g, e); }
  if (oldTown) { // the old town's ground (yards, packed), the green ring of the old wall round it
    const rimPath = (ctx, add) => { ctx.save(); ctx.translate(X(0), X(0)); ctx.rotate(oldTown.ta); ctx.beginPath(); for (let k = 0; k <= 64; k++) { const a = (k / 64) * 6.2832, m = oldTown.rim(a); ctx.lineTo(Math.cos(a) * (oldTown.rx * m + add) * sc, Math.sin(a) * (oldTown.rz * m + add) * sc); } ctx.restore(); };
    g.strokeStyle = '#56603a'; g.lineWidth = 26 * sc; rimPath(g, 13); g.stroke();
    g.fillStyle = '#6a5a4c'; rimPath(g, 0); g.fill(); }
  for (const gd of gardens) { // (beds in strips)
    const n = Math.max(2, Math.round(gd.w / 4));
    for (let k = 0; k < n; k++) { g.fillStyle = pick(GARDEN); const ca = Math.cos(gd.ang), sa = Math.sin(gd.ang), o = -gd.w / 2 + (k + 0.5) * (gd.w / n); rect(g, gd.x + ca * o, gd.z + sa * o, gd.w / n - 0.4, gd.d, gd.ang); }
  }
  for (const y of yards) { g.fillStyle = pick(YARD); rect(g, y.x, y.z, y.w, y.d, y.ang); }
  // the lanes: unmetalled, pale; the town's streets cobbled grey; the market and the churchyard
  for (const l of lanes) { g.strokeStyle = l.wide || kind === 'town' ? STREET : LANE; stroke(g, l.pts, l.w); }
  if (kind === 'town') { g.fillStyle = STREET; g.beginPath(); g.ellipse(X(0), X(0), 50 * sc, 34 * sc, oldTown.ta, 0, 7); g.fill(); }
  for (const e of greens) if (e.yard) { g.strokeStyle = '#9a917e'; g.lineWidth = Math.max(1, 1.5 * sc); g.beginPath(); g.ellipse(X(e.x), X(e.z), e.rx * sc, e.rz * sc, e.ang, 0, 7); g.stroke(); }
  for (const e of greens) if (e.pond) { g.fillStyle = '#3d4b4c'; ell(g, e); }
  if (kind === 'anger') { const e = greens.find((q) => !q.soft && !q.yard); if (e) { g.fillStyle = '#3d4b4c'; ell(g, { x: e.x + e.rx * 0.45, z: e.z, rx: 14, rz: 9 }); } }
  // shadows: every building and tree's, down and to the right a little, blurred (laid on in one go)
  sg.fillStyle = '#000';
  const so = 0.55;
  for (const b of buildings) { const h = b.h + b.rh * 0.6; rect(sg, b.x + h * so * 0.6, b.z + h * so, b.len, b.wid, b.ang); }
  for (const t of trees) { sg.beginPath(); sg.arc(X(t[0] + t[2] * 0.9), X(t[1] + t[2] * 1.4), t[2] * sc, 0, 7); sg.fill(); }
  g.save(); g.globalAlpha = 0.42; g.filter = `blur(${Math.max(0.6, 1.2 * sc).toFixed(1)}px)`; g.drawImage(shadowC, 0, 0); g.restore();
  // the trees: the orchards' fruit trees, bigger ones in the yards and round the church (autumn colours)
  for (const t of trees) {
    const col = pick(TREE);
    g.fillStyle = col; g.beginPath(); g.arc(X(t[0]), X(t[1]), t[2] * sc, 0, 7); g.fill();
    if (t[2] * sc > 1.6) { g.fillStyle = 'rgba(255,240,200,0.13)'; g.beginPath(); g.arc(X(t[0] - t[2] * 0.3), X(t[1] - t[2] * 0.3), t[2] * 0.55 * sc, 0, 7); g.fill(); }
  }
  // the roofs: the far slope in shade, the ridge, the weathering
  for (const b of buildings) {
    g.save(); g.translate(X(b.x), X(b.z)); g.rotate(b.ang);
    const L = b.len * sc, W = b.wid * sc;
    g.fillStyle = b.roof; g.fillRect(-L / 2, -W / 2, L, W);
    if (!b.tower && b.rh > 2.6) { g.fillStyle = 'rgba(20,12,8,0.28)'; g.fillRect(-L / 2, 0, L, W / 2); g.fillStyle = 'rgba(255,230,200,0.07)'; g.fillRect(-L / 2, -W / 2, L, W / 2); }
    if (rnd() < 0.5) { g.fillStyle = `rgba(${rnd() < 0.5 ? '40,40,36' : '90,80,60'},${rand(0.05, 0.15).toFixed(2)})`; g.fillRect(-L / 2 + rand(0, L / 2), -W / 2, L * rand(0.2, 0.5), W); }
    g.restore();
  }
  for (const sp of spires) { g.fillStyle = '#4b5a52'; g.beginPath(); g.arc(X(sp.x), X(sp.z), sp.r * sc, 0, 7); g.fill(); }
  // fade the edge into the fields: the mask, blurred
  const fm = mk(), fg = fm.getContext('2d');
  fg.filter = `blur(${(9 * sc).toFixed(1)}px)`; fg.drawImage(maskC, 0, 0);
  fg.filter = 'none'; fg.globalCompositeOperation = 'destination-in';
  const edge = fg.createRadialGradient(P / 2, P / 2, P * 0.38, P / 2, P / 2, P * 0.5); edge.addColorStop(0, '#000'); edge.addColorStop(1, '#0000');
  fg.fillStyle = edge; fg.fillRect(0, 0, P, P);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(fm, 0, 0); g.globalCompositeOperation = 'source-over';
  return { canvas: main, size: S, buildings, spires, kind };
}

/** The plans: eight villages and hamlets in the atlas's top half, two towns in the bottom half (each its cell's uv rectangle). */
export const VARIANTS = [
  ['hamlet', 0], ['hamlet', 1], ['haufen', 2], ['haufen', 3], ['haufen', 4], ['strassen', 5], ['strassen', 6], ['anger', 7], ['town', 8], ['town', 9],
];
/** The variants each kind of place picks from (hamlet, village, village, town). */
export const BY_KIND = [[0, 1], [2, 3, 4, 7], [5, 6, 2, 4], [8, 9]];

export function paintAtlas() {
  const t0 = performance.now();
  const c = document.createElement('canvas'); c.width = c.height = ATLAS;
  const g = c.getContext('2d');
  const plans = VARIANTS.map(([kind, i]) => {
    const town = kind === 'town', px = town ? 2048 : 1024;
    const cx = town ? (i - 8) * 2048 : (i % 4) * 1024, cy = town ? 2048 : Math.floor(i / 4) * 1024;
    const p = paintPlace(kind, px, 7919 * (i + 3));
    g.drawImage(p.canvas, cx, cy);
    p.canvas = null;
    // (uv: canvas rows run down, the texture's v up)
    p.cell = [cx / ATLAS, 1 - (cy + px) / ATLAS, px / ATLAS, px / ATLAS];
    return p;
  });
  return { canvas: c, plans, ms: performance.now() - t0 };
}
