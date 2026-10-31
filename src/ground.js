// The Franconian countryside from five miles up, drawn in the ground's own shader so it never repeats where
// you can see it: Gewann blocks of a few hundred metres, each cut into long narrow strips (6-25 m, the
// fields split lengthwise at every inheritance), most strips of a block in the same crop, the next block's
// strips at another angle; pale field tracks along some of the block edges, grass baulks between the strips.
// Woods on the hills, their edges following the blocks (the forest is owned by the parcel, as the fields are)
// with the shadow of the trees on the field beside them; meadows down the valleys; streams winding down to
// the rivers, lined with alders; the roads from village to village, fruit trees along them. The villages
// (countryside.js) stand where this lays them out. All of it is one layout, 81.92 km square, that wraps:
// a texture for what changes slowly (woods, meadows), and the streams and roads as line segments the shader
// measures its distance to exactly (crisp from 25,000 ft and from a fighter at 500 m alike).
// aerial(): the haze between you and the ground (every ground material shares it), the blue-grey veil
// that, five miles up, lies even over the ground straight below.
import * as THREE from 'three';
import { SNOW } from './environment.js';

export const MACRO = 81920; // m: the layout's size (it wraps)
const MAP = 1024; // texels across the woods and meadows map (80 m each)
const CELL = 160, GRID = MACRO / CELL, SLOTS = 8; // the streams and roads: which segments pass near each 160 m cell
const SEGW = 2048; // segments texture width (2 texels a segment)

/** The haze over the ground: how much thicker it lies on the ground than the scene's fog (shared, so it can be tuned at once). */
export const AIR = { value: 0.32 };

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rand = (a, b) => a + rnd() * (b - a);

/** Wrapped value noise on the layout: u, v in [0, 1) round it, n lattice cells across (so it wraps), 0..1. */
function periodic(n, s) {
  const g = new Float32Array(n * n);
  let k = s;
  for (let i = 0; i < n * n; i++) { k = (k * 16807) % 2147483647; g[i] = k / 2147483647; }
  return (u, v) => {
    const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    return (a(x0, y0) * (1 - sx) + a(x0 + 1, y0) * sx) * (1 - sy) + (a(x0, y0 + 1) * (1 - sx) + a(x0 + 1, y0 + 1) * sx) * sy;
  };
}

/** The shortest way from a to b round the wrapped layout. */
const wrapD = (d) => d - MACRO * Math.round(d / MACRO);

/**
 * Lay out the country: the hills and woods, the streams and the river, the villages and the roads between
 * them. Returns { macro (texture), grid, segs (textures), villages: [{ x, z, kind, variant, turn }] }.
 */
export function layoutCountry() {
  const t0 = performance.now(), tm = {}, lap = (k) => { tm[k] = Math.round(performance.now() - t0); };
  seed = 1943;
  // ---- the lie of the land: low hills (the woods keep to their tops), and the woods themselves
  const h1 = periodic(6, 11), h2 = periodic(14, 23), h3 = periodic(31, 37), f1 = periodic(48, 41), f2 = periodic(110, 43);
  const hill = (u, v) => 0.55 * h1(u, v) + 0.3 * h2(u, v) + 0.15 * h3(u, v);
  const raw = new Float32Array(MAP * MAP), H = MAP / 2, half = new Float32Array(H * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) { const u = (i + 0.5) / H, v = (j + 0.5) / H; half[j * H + i] = 0.62 * hill(u, v) + 0.26 * f1(u, v) + 0.12 * f2(u, v); }
  for (let j = 0; j < MAP; j++) for (let i = 0; i < MAP; i++) { // (worked out at half the size, filled in between: it's smooth)
    const x = i / 2 - 0.25, y = j / 2 - 0.25, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a0 = (x0 + H) % H, a1 = (x0 + 1) % H, b0 = ((y0 + H) % H) * H, b1 = ((y0 + 1) % H) * H;
    raw[j * MAP + i] = (half[b0 + a0] * (1 - fx) + half[b0 + a1] * fx) * (1 - fy) + (half[b1 + a0] * (1 - fx) + half[b1 + a1] * fx) * fy;
  }
  // about a fifth of it wooded (the Gäu plateaus are mostly ploughed: the woods are on the hills)
  const thr = (() => { // (the level a fifth of the map lies above: from a histogram, not a sort of a million)
    let lo = Infinity, hi = -Infinity; for (const v of half) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const hist = new Uint32Array(1024); for (const v of half) hist[Math.min(1023, Math.floor(((v - lo) / (hi - lo)) * 1024))]++;
    let acc = 0; for (let k = 1023; k >= 0; k--) { acc += hist[k]; if (acc >= half.length * 0.2) return lo + ((k + 0.5) / 1024) * (hi - lo); }
    return 0.5;
  })();
  const forest = (u, v) => { // (0.5 at the woods' edge)
    const i = ((Math.floor(u * MAP) % MAP) + MAP) % MAP, j = ((Math.floor(v * MAP) % MAP) + MAP) % MAP;
    return 0.5 + (raw[j * MAP + i] - thr) * 9;
  };

  lap('woods');
  // ---- the water: streams running down off the hills (meandering, joining), and a river right across
  const segs = []; // [x0, z0, x1, z1, half width, kind (0 water, 1 lane, 2 main road)]
  const pts = new Map(); // (where the water already runs: streams join it)
  const key = (x, z) => `${Math.floor(((x % MACRO) + MACRO) % MACRO / 200)},${Math.floor(((z % MACRO) + MACRO) % MACRO / 200)}`;
  const water = []; // [x, z, half width]: points along all of it (for the meadows and the villages)
  const river = [];
  {
    const A = rand(0, 6.28), B = rand(0, 6.28), C = rand(0, 6.28), z0 = rand(0, MACRO);
    for (let x = 0; x <= MACRO; x += 120) {
      const t = (x / MACRO) * Math.PI * 2;
      river.push([x, z0 + 2600 * Math.sin(t + A) + 900 * Math.sin(3 * t + B) + 350 * Math.sin(8 * t + C) + 120 * Math.sin(21 * t + B)]);
    }
    for (let k = 1; k < river.length; k++) segs.push([...river[k - 1], ...river[k], 30, 0]);
    for (const [x, z] of river) { water.push([x, z, 30]); pts.set(key(x, z), true); }
  }
  const grad = (x, z) => { const u = x / MACRO, v = z / MACRO, e = 60 / MACRO; return [(hill(u + e, v) - hill(u - e, v)), (hill(u, v + e) - hill(u, v - e))]; };
  for (let s = 0; s < 150; s++) {
    let x = rand(0, MACRO), z = rand(0, MACRO);
    if (hill(x / MACRO, z / MACRO) < 0.5) continue; // (springs in the hills)
    let [dx, dz] = [rand(-1, 1), rand(-1, 1)], len = 0, hw = 1.4;
    const line = [[x, z]], ph = rand(0, 6.28);
    for (let k = 0; k < 400; k++) {
      const [gx, gz] = grad(x, z), gl = Math.hypot(gx, gz) || 1;
      const m = Math.sin(len / 260 + ph) * 0.9 + Math.sin(len / 90 + ph * 2) * 0.35; // (the meander)
      let nx = dx * 0.75 - (gx / gl) * 0.6, nz = dz * 0.75 - (gz / gl) * 0.6;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const c = Math.cos(m * 0.5), sn = Math.sin(m * 0.5);
      dx = nx; dz = nz;
      x += (nx * c - nz * sn) * 70; z += (nx * sn + nz * c) * 70; len += 70;
      line.push([x, z]);
      if (k > 3 && pts.has(key(x, z))) break; // (into a stream or the river)
    }
    if (len < 2500) continue;
    for (let k = 1; k < line.length; k++) {
      hw = Math.min(5, 1.4 + (k / line.length) * 3.2);
      segs.push([...line[k - 1], ...line[k], hw, 0]);
      water.push([line[k][0], line[k][1], hw]);
    }
    for (const [px, pz] of line) pts.set(key(px, pz), true);
  }

  lap('streams');
  // ---- the meadows down the valleys (and the woods kept off the water)
  const mead = new Float32Array(MAP * MAP), T = MACRO / MAP;
  for (const [x, z, hw] of water) {
    const r = 70 + hw * 30, ri = Math.ceil(r / T) + 1, ci = Math.floor(x / T), cj = Math.floor(z / T);
    for (let j = cj - ri; j <= cj + ri; j++) for (let i = ci - ri; i <= ci + ri; i++) {
      const d = Math.hypot((i + 0.5) * T - x, (j + 0.5) * T - z), w = Math.max(0, 1 - d / r);
      const k = (((j % MAP) + MAP) % MAP) * MAP + (((i % MAP) + MAP) % MAP);
      if (w > mead[k]) mead[k] = w;
    }
  }

  lap('meadows');
  // ---- the villages: every 2-3 km, in the valleys by the water rather than up in the woods
  const WN = Math.ceil(MACRO / 1000), near = Array.from({ length: WN * WN }, () => []); // (water points by 1 km cell, for how far a place is from it)
  const wk = (i, j) => (((j % WN) + WN) % WN) * WN + (((i % WN) + WN) % WN);
  for (const w of water) near[wk(Math.floor(w[0] / 1000), Math.floor(w[1] / 1000))].push(w);
  const waterDist = (x, z) => {
    let best = 3000;
    const ci = Math.floor(x / 1000), cj = Math.floor(z / 1000);
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) for (const w of near[wk(i, j)]) best = Math.min(best, Math.hypot(wrapD(w[0] - x), wrapD(w[1] - z)) - w[2]);
    return best;
  };
  const villages = [];
  const VN = Math.round(MACRO / 4000), vgrid = Array.from({ length: VN * VN }, () => []), vk = (i, j) => (((j % VN) + VN) % VN) * VN + (((i % VN) + VN) % VN); // (the places by 4 km cell)
  const crowded = (x, z, r) => {
    const ci = Math.floor(x / 4000), cj = Math.floor(z / 4000);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      for (const v of vgrid[vk(i, j)]) if (Math.hypot(wrapD(v.x - x), wrapD(v.z - z)) < Math.max(r, v.r)) return true;
    }
    return false;
  };
  for (let n = 0; n < 60000 && villages.length < 1000; n++) {
    const x = rand(0, MACRO), z = rand(0, MACRO), u = x / MACRO, v = z / MACRO;
    if (forest(u, v) > 0.32 || forest(u + 300 / MACRO, v) > 0.45 || forest(u - 300 / MACRO, v) > 0.45 || forest(u, v + 300 / MACRO) > 0.45 || forest(u, v - 300 / MACRO) > 0.45) continue;
    const r0 = rnd(), kind = r0 < 0.045 ? 3 : r0 < 0.3 ? 0 : r0 < 0.7 ? 1 : 2; // (a market town now and then; hamlets; villages)
    const r = kind === 3 ? 3800 : kind === 0 ? 1500 : 2050;
    if (crowded(x, z, r)) continue;
    if (kind === 3 && [0, 1, 2, 3, 4, 5, 6, 7].some((k) => forest(u + (Math.cos(k * 0.785) * 900) / MACRO, v + (Math.sin(k * 0.785) * 900) / MACRO) > 0.42)) continue; // (a market town in open country, not a clearing)
    const wd = waterDist(x, z);
    if (wd < 120 || rnd() > 0.3 + 0.7 * Math.exp(-wd / 900)) continue;
    const p = { x, z, kind, r, turn: rand(0, Math.PI * 2), variant: Math.floor(rnd() * 64), idx: villages.length };
    villages.push(p);
    vgrid[vk(Math.floor(x / 4000), Math.floor(z / 4000))].push(p);
  }

  lap('villages');
  // ---- the roads: each village to its nearest two or three (the lanes winding a little), towns by main roads
  const edges = new Set();
  for (let a = 0; a < villages.length; a++) {
    const A = villages[a];
    const nb = [];
    const ci = Math.floor(A.x / 4000), cj = Math.floor(A.z / 4000);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      for (const B of vgrid[vk(i, j)]) {
        if (B === A) continue;
        const d = Math.hypot(wrapD(B.x - A.x), wrapD(B.z - A.z));
        if (d < 5200) nb.push([d, B]);
      }
    }
    nb.sort((p, q) => p[0] - q[0]);
    const want = A.kind === 3 ? 5 : A.kind === 0 ? 1 + (rnd() < 0.5) : 2 + (rnd() < 0.5);
    // (not one that runs nearly the same way as a nearer one: two roads out of the same side of the village)
    const taken = [];
    for (const [d, B] of nb) {
      if (taken.length >= want) break;
      const ang = Math.atan2(wrapD(B.z - A.z), wrapD(B.x - A.x));
      if (taken.some((t) => Math.abs(wrapD(((t - ang) * MACRO) / (Math.PI * 2)) / MACRO * Math.PI * 2) < 0.6)) continue;
      taken.push(ang);
      const b = B.idx, id = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edges.has(id)) continue;
      edges.add(id);
      const main = A.kind === 3 || B.kind === 3;
      const dx = wrapD(B.x - A.x), dz = wrapD(B.z - A.z), L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
      let line = [[A.x, A.z]];
      for (let k = 1; k < 4; k++) { const t = k / 4, o = rand(-0.07, 0.07) * L; line.push([A.x + dx * t + nx * o, A.z + dz * t + nz * o]); }
      line.push([A.x + dx, A.z + dz]);
      for (let it = 0; it < 3; it++) { // (smoothed into easy curves)
        const out = [line[0]];
        for (let k = 0; k < line.length - 1; k++) { const [px, pz] = line[k], [qx, qz] = line[k + 1]; out.push([px * 0.75 + qx * 0.25, pz * 0.75 + qz * 0.25], [px * 0.25 + qx * 0.75, pz * 0.25 + qz * 0.75]); }
        out.push(line[line.length - 1]); line = out;
      }
      for (let k = 1; k < line.length; k++) segs.push([...line[k - 1], ...line[k], main ? 3.2 : 2.3, main ? 2 : 1]);
    }
  }

  lap('roads');
  // ---- the woods and meadows map: R the woods (0.5 at the edge), G the valley meadows
  const data = new Uint8Array(MAP * MAP * 4);
  for (let k = 0; k < MAP * MAP; k++) {
    const m = mead[k], f = 0.5 + (raw[k] - thr) * 9 - m * 0.9;
    data[k * 4] = Math.max(0, Math.min(255, f * 255));
    data[k * 4 + 1] = m * 255;
    data[k * 4 + 2] = 0; data[k * 4 + 3] = 255;
  }
  const macro = new THREE.DataTexture(data, MAP, MAP, THREE.RGBAFormat);
  macro.wrapS = macro.wrapT = THREE.RepeatWrapping;
  macro.magFilter = THREE.LinearFilter; macro.minFilter = THREE.LinearMipmapLinearFilter; macro.generateMipmaps = true;
  macro.needsUpdate = true;

  // ---- the streams and roads by cell: each cell lists the segments that pass within reach of it (copies
  // of a segment moved a whole layout over, where it crosses the wrap)
  const cells = new Array(GRID * GRID);
  const entries = []; // [x0, z0, x1, z1, hw, kind]
  const R = 16; // m of reach beyond the line (its trees)
  for (const s of segs) {
    const [x0, z0, x1, z1, hw] = s;
    const minx = Math.min(x0, x1) - hw - R, maxx = Math.max(x0, x1) + hw + R, minz = Math.min(z0, z1) - hw - R, maxz = Math.max(z0, z1) + hw + R;
    const byShift = [-1, -1, -1, -1, -1, -1, -1, -1, -1]; // (this segment's copy for each wrap: -1, 0, +1 layouts over in x and in z)
    for (let cj = Math.floor(minz / CELL); cj <= Math.floor(maxz / CELL); cj++) for (let ci = Math.floor(minx / CELL); ci <= Math.floor(maxx / CELL); ci++) {
      const wi = ((ci % GRID) + GRID) % GRID, wj = ((cj % GRID) + GRID) % GRID, sx = (wi - ci) * CELL, sz = (wj - cj) * CELL;
      const sk = (Math.round(sx / MACRO) + 1) * 3 + Math.round(sz / MACRO) + 1;
      let e = byShift[sk];
      if (e < 0) { e = entries.length; entries.push([x0 + sx, z0 + sz, x1 + sx, z1 + sz, hw, s[5]]); byShift[sk] = e; }
      const c = wj * GRID + wi;
      (cells[c] ??= []).push(e);
    }
  }
  const grid = new Float32Array(GRID * 2 * GRID * 4).fill(-1);
  const prio = (e) => (entries[e][5] === 0 ? (entries[e][4] > 10 ? 0 : 2) : entries[e][5] === 2 ? 1 : 3);
  for (let c = 0; c < cells.length; c++) {
    const l = cells[c];
    if (!l) continue;
    if (l.length > SLOTS) l.sort((a, b) => prio(a) - prio(b));
    const ci = c % GRID, cj = Math.floor(c / GRID);
    for (let k = 0; k < Math.min(SLOTS, l.length); k++) grid[((cj * GRID * 2) + ci * 2 + (k >> 2)) * 4 + (k & 3)] = l[k];
  }
  lap('cells');
  const rows = Math.ceil((entries.length * 2) / SEGW);
  const sd = new Float32Array(SEGW * rows * 4);
  entries.forEach((e, i) => { sd.set([e[0], e[1], e[2], e[3]], i * 8); sd.set([e[4], e[5], 0, 0], i * 8 + 4); });
  const tex = (d, w, h) => { const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
  const out = { macro, grid: tex(grid, GRID * 2, GRID), segs: tex(sd, SEGW, rows), villages, river, ms: performance.now() - t0, tm, count: { segs: segs.length, entries: entries.length, villages: villages.length } };
  out.forestAt = (x, z) => forest(x / MACRO, z / MACRO);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// The colours: sRGB as you'd pick them, made linear for the shader
const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; }; // (THREE.Color from hex is linear already)
// (how common each crop is: pickCrop below; the far colour of a field is their mix in these proportions)
const CROP_SHARE = [0.2, 0.13, 0.15, 0.14, 0.07, 0.06, 0.04, 0.08, 0.08, 0.05];
const mean = (list) => { const c = new THREE.Color(0, 0, 0); list.forEach((h, i) => c.add(new THREE.Color(h).multiplyScalar(CROP_SHARE[i]))); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const arr = (name, list) => `const vec3 ${name}[${list.length}] = vec3[${list.length}](${list.map(lin).join(', ')});`;
// summer: wheat and barley ripening, potatoes and beet, clover, meadow, hay cut, fallow
const SUMMER = ['#a8935a', '#9a8a54', '#80834a', '#566238', '#5c6a3a', '#5f6e3d', '#687642', '#938a56', '#7a744a', '#6e5d42'];
// mid-October: ploughed loess, darker plough, stubble, the winter corn just through, beet and potatoes, clover, meadow, fallow, grey limestone soil
const AUTUMN = ['#76593f', '#664d38', '#958560', '#73704c', '#56603a', '#5b673c', '#626c42', '#7c744e', '#857a62', '#6e4f3c'];

const GROUND_GLSL = /* glsl */ `
uniform sampler2D uMacro;
uniform highp sampler2D uGrid, uSegs;
uniform vec3 uCity; // the target town (x, z, radius) in the ground's frame: no woods or lanes of ours there
uniform vec3 uSunL; // towards the sun, in the ground's frame
uniform float uSeason, uSnowG;
varying vec2 vGround;
const float MAC = ${MACRO.toFixed(1)};
${arr('CS', SUMMER)}
${arr('CA', AUTUMN)}
const vec3 CSM = ${mean(SUMMER)}, CAM = ${mean(AUTUMN)};
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// value noise wrapping every n cells (n lattice cells across the layout)
float vn(vec2 q, float n) { vec2 i = floor(q), f = fract(q), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(mod(i, n)), h12(mod(i + vec2(1, 0), n)), u.x), mix(h12(mod(i + vec2(0, 1), n)), h12(mod(i + vec2(1, 1), n)), u.x), u.y); }
float fbm(vec2 pt, float n) { return 0.55 * vn(pt * n / MAC, n) + 0.3 * vn(pt * 2.0 * n / MAC, 2.0 * n) + 0.15 * vn(pt * 4.0 * n / MAC, 4.0 * n); }
vec3 crop(float i) { int k = int(i); return mix(CS[k], CA[k], uSeason); }
// how much of a pixel (fw m across) a line half hw wide covers at distance d (thinner than a pixel: fainter, not gone)
float lineCov(float d, float hw, float fw) { float w = max(hw, 0.5 * fw); return smoothstep(w + 0.5 * fw, w - 0.5 * fw, d) * min(1.0, hw / w); }
const float VC = 819.2;
// which crop, by how common it is (mid-October: mostly ploughed and stubble, the winter corn coming up)
float pickCrop(float h) { return h < 0.2 ? 0.0 : h < 0.33 ? 1.0 : h < 0.48 ? 2.0 : h < 0.62 ? 3.0 : h < 0.69 ? 4.0 : h < 0.75 ? 5.0 : h < 0.79 ? 6.0 : h < 0.87 ? 7.0 : h < 0.95 ? 8.0 : 9.0; }
vec3 cropMean() { return mix(CSM, CAM, uSeason); }
// a Gewann: the rectangle of Voronoi cell cid (seed sp) that pt is in, cut by two to four splits in the
// cell's own turned frame. lc: its middle; lid: its hash; dk: m to its nearest split, nk the way to it; ax: the frame
void leafOf(vec2 pt, vec2 cid, vec2 sp, out vec2 lc, out float lid, out float dk, out vec2 nk, out vec2 ax) {
  float A = h12(cid + 0.71) * 3.1416;
  ax = vec2(cos(A), sin(A)); vec2 az = vec2(-ax.y, ax.x);
  vec2 q = vec2(dot(pt - sp, ax), dot(pt - sp, az));
  vec2 lo = vec2(-1e4), hi = vec2(1e4); float b = 1.0;
  float s1 = (h12(cid + 1.1) - 0.5) * 340.0;
  if (q.x < s1) hi.x = s1; else { lo.x = s1; b += 1.0; }
  float s2 = (h12(cid + b * 3.7 + 2.3) - 0.5) * 340.0;
  if (q.y < s2) hi.y = s2; else { lo.y = s2; b += 2.0; }
  if (h12(cid + b * 5.1 + 4.1) < 0.8) { float s3 = (lo.x < -9e3 ? hi.x - 120.0 - 220.0 * h12(cid + b * 1.9 + 6.7) : hi.x > 9e3 ? lo.x + 120.0 + 220.0 * h12(cid + b * 1.9 + 6.7) : mix(lo.x, hi.x, 0.5));
    if (abs(s3) < 9e3) { if (q.x < s3) hi.x = s3; else { lo.x = s3; b += 4.0; } } }
  if (h12(cid + b * 2.9 + 8.3) < 0.55) { float s4 = (lo.y < -9e3 ? hi.y - 120.0 - 220.0 * h12(cid + b * 2.3 + 9.1) : hi.y > 9e3 ? lo.y + 120.0 + 220.0 * h12(cid + b * 2.3 + 9.1) : mix(lo.y, hi.y, 0.5));
    if (q.y < s4) hi.y = s4; else { lo.y = s4; b += 8.0; } }
  lid = h12(cid * 1.37 + b * 7.77);
  vec4 e = vec4(q.x - lo.x, hi.x - q.x, q.y - lo.y, hi.y - q.y);
  dk = min(min(e.x, e.y), min(e.z, e.w));
  nk = dk == e.x ? -ax : dk == e.y ? ax : dk == e.z ? -az : az;
  vec2 c = (clamp(lo, -420.0, 420.0) + clamp(hi, -420.0, 420.0)) * 0.5;
  lc = sp + ax * c.x + az * c.y;
}
float gWater = 0.0;
vec3 groundColour(vec2 p, float fw) {
  vec2 pt = mod(p, MAC);
  vec4 M = texture2D(uMacro, pt / MAC);
  float city = smoothstep(uCity.z, uCity.z * 0.72, length(p - uCity.xy));
  // ---- the Gewann blocks: Voronoi cells (~800 m), each cut in its own turned frame into a few rectangles
  vec2 g = pt / VC, gi = floor(g), gf = fract(g);
  vec2 mr = vec2(0), mo = vec2(0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(i, j), r = o + 0.1 + 0.8 * h22(mod(gi + o, MAC / VC)) - gf; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mo = o; }
  }
  float ev = 8.0; vec2 nr = vec2(0), nv = vec2(1, 0), nid = vec2(0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = mo + vec2(i, j), c = mod(gi + o, MAC / VC), r = o + 0.1 + 0.8 * h22(c) - gf, dd = r - mr;
    if (dot(dd, dd) > 1e-5) { float e = dot(0.5 * (mr + r), normalize(dd)); if (e < ev) { ev = e; nr = r; nv = normalize(dd); nid = c; } }
  }
  ev *= VC;
  vec2 cid = mod(gi + mo, MAC / VC), sp = pt + mr * VC;
  vec2 lc, ax, nk, nlc, nax, nnk; float lid, dk, nlid, ndk;
  leafOf(pt, cid, sp, lc, lid, dk, nk, ax);
  // the Gewann over the nearest edge (a split of this cell's, or the next cell's)
  float ed; vec2 nn;
  if (dk < ev) { ed = dk; nn = nk; leafOf(pt + nk * (dk + 2.0), cid, sp, nlc, nlid, ndk, nnk, nax); }
  else { ed = ev; nn = nv; leafOf(pt + nv * (ev + 2.0), nid, pt + nr * VC, nlc, nlid, ndk, nnk, nax); }
  vec2 hb = h22(vec2(lid * 61.7, lid * 13.1)); float hb2 = h12(vec2(lid * 37.3, 1.7)), hb3 = h12(vec2(lid * 17.9, 4.3));
  // ---- woods: whole Gewanne mostly (the woods' edges are the parcels' edges), a little ragged
  float fp = M.r, fN = (fbm(pt, 400.0) - 0.5) * 0.2;
  float fb = texture2D(uMacro, lc / MAC).r, fnb = texture2D(uMacro, nlc / MAC).r;
  float fv = 0.75 * fb + 0.25 * fp + fN - city, fvN = 0.75 * fnb + 0.25 * fp + fN - city;
  float aa = 0.012 + fw * 0.0004;
  float wood = smoothstep(0.5 - aa, 0.5 + aa, fv);
  // ---- the strips, in groups (one owner's, one crop), most groups in the Gewann's own crop
  vec2 dir = hb.x < 0.5 ? ax : vec2(-ax.y, ax.x);
  float w = hb2 > 0.93 ? mix(35.0, 70.0, hb3) : mix(6.0, 22.0, hb2 * hb2);
  float W = w * floor(2.0 + hb3 * 5.0);
  float u = dot(pt - lc, dir), su = u / w, s = floor(su), sf = fract(su), gs = floor(u / W);
  float meadowB = step(hb.y, M.g * 1.6 - 0.2);
  float base = meadowB > 0.5 ? 6.0 : pickCrop(hb3);
  float hg = h12(vec2(gs, lid * 91.3)), hg2 = h12(vec2(gs + 0.37, lid * 53.1));
  float gc = (hg < 0.68 || meadowB > 0.5) ? base : pickCrop(hg2);
  float hs = h12(vec2(s, lid * 71.0)), hs2 = h12(vec2(s + 0.5, lid * 29.0));
  float ci = hs < 0.85 ? gc : pickCrop(hs2);
  float tone = 0.9 + 0.2 * hs2;
  vec3 strip = crop(ci) * tone * (0.94 + 0.12 * hg2);
  // soil and crop: wetter and drier patches, furrows along the strip, the grass baulk between strips
  float soil = 0.9 + 0.2 * fbm(pt, 1600.0) * (1.0 - smoothstep(4.0, 30.0, fw));
  strip *= soil;
  // (close to, the crop is never even: thicker and thinner growth in streaks down the strip, the drill rows)
  float along = dot(pt - lc, vec2(-dir.y, dir.x));
  strip *= 1.0 + (vn(vec2(u / 2.2, along / 26.0) + lid * 97.0, 8192.0) - 0.5) * 0.22 * (1.0 - smoothstep(0.8, 3.0, fw));
  float plough = step(ci, 1.5) + step(8.5, ci);
  strip *= 1.0 - plough * 0.09 * sin(u * 7.0) * (1.0 - smoothstep(0.15, 0.4, fw));
  float bd = min(sf, 1.0 - sf) * w;
  strip = mix(strip, crop(6.0) * 0.9, lineCov(bd, 0.4, fw) * 0.6);
  vec3 grp = (crop(gc) * 0.85 + cropMean() * 0.15) * (0.94 + 0.12 * hg2); // (its strips' colours, mixed: 85% the group's crop)
  vec3 col = mix(strip, grp, smoothstep(0.25 * w, 0.9 * w, fw));
  col = mix(col, (crop(base) * 0.58 + cropMean() * 0.42), smoothstep(0.25 * W, 0.9 * W, fw));
  // the country's slow changes of colour: soils, wetter and drier ground (a few km across)
  col *= 0.88 + 0.24 * fbm(pt, 14.0);
  // ---- field tracks along some Gewann edges (with a grassy verge)
  float track = step(h12(vec2(lid + nlid, lid * nlid * 7.0)), 0.5) * (1.0 - wood);
  col = mix(col, crop(6.0) * 0.85, lineCov(ed, 2.6, fw) * track * 0.6);
  col = mix(col, ${lin('#9d927a')} * (0.92 + 0.08 * hs), lineCov(ed, 1.3, fw) * track * 0.85);
  // lone trees in the fields and on the baulks
  float tc = 64.0; vec2 tq = pt / tc, ti = floor(tq); float th = h12(mod(ti, MAC / tc) + 5.1);
  if (th < 0.05 && fw < 6.0) { vec2 to = (ti + 0.2 + 0.6 * h22(ti + 2.0)) * tc; float tr = 3.5 + 3.0 * h12(ti + 8.0);
    float d = length(pt - to); col = mix(col, ${lin('#3b4527')} * (1.0 + 0.4 * dot(normalize(pt - to + 1e-4), uSunL.xz)), smoothstep(tr + fw, tr - fw, d) * (1.0 - wood)); }
  // ---- the woods: each stand (block) its own mix of beech, oak and pine; crowns lit on the sun's side
  {
    float con = clamp(vn(pt * 40.0 / MAC, 40.0) * 1.4 - 0.3 + (hb.y - 0.5) * 0.8, 0.0, 1.0);
    vec3 dec = mix(${lin('#46542a')}, mix(${lin('#7a5e30')}, ${lin('#5e5a2c')}, hb.x), uSeason);
    vec3 fcol = mix(dec, ${lin('#2e3a25')}, con);
    vec3 fmean = fcol * 0.74;
    if (fw < 4.0) {
      float cs = 6.4; vec2 cq = pt / cs, cf = fract(cq), cqi = floor(cq); float cm = 8.0; vec2 co = vec2(0); float ch = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 o = vec2(i, j), r = o + 0.15 + 0.7 * h22(mod(cqi + o, MAC / cs)) - cf; float d = dot(r, r); if (d < cm) { cm = d; co = r; ch = h12(mod(cqi + o, MAC / cs)); } }
      float lit = 0.75 + 0.5 * dot(normalize(-co + 1e-4), uSunL.xz) * smoothstep(0.0, 0.5, sqrt(cm));
      vec3 crown = mix(fcol * (0.8 + 0.4 * ch), (ch < con ? ${lin('#2a3522')} : fcol * 1.15), 0.4) * lit * (1.0 - 0.45 * smoothstep(0.35, 0.8, sqrt(cm)));
      fcol = mix(crown, fmean, smoothstep(1.0, 4.0, fw));
    } else fcol = fmean;
    fcol *= 0.85 + 0.3 * vn(pt * 600.0 / MAC, 600.0) * (1.0 - smoothstep(20.0, 60.0, fw));
    // (the canopy's grain further off: clumps of crowns and the gaps between, after the single crowns are too small to see)
    fcol *= 1.0 + (fbm(pt, 3200.0) - 0.5) * 0.5 * smoothstep(1.5, 5.0, fw) * (1.0 - smoothstep(18.0, 45.0, fw));
    col = mix(col, fcol, wood);
  }
  // the woods' shadow over the field beside them (the trees 22 m tall, the sun where it is)
  float slen = clamp(22.0 * length(uSunL.xz) / max(uSunL.y, 0.08), 0.0, 140.0);
  float sw = smoothstep(0.5 - aa, 0.5 + aa, fvN) * (1.0 - wood) * step(0.0, dot(nn, uSunL.xz));
  col *= 1.0 - 0.45 * sw * smoothstep(slen * dot(nn, normalize(uSunL.xz + 1e-4)) + fw, slen * dot(nn, normalize(uSunL.xz + 1e-4)) * 0.6 - fw, ed);
  // ---- the streams, the river and the roads (to the line, from the segments that pass near this cell)
  float dw = 1e4, hww = 0.0, dr = 1e4, hwr = 0.0, rk = 0.0;
  ivec2 cel = ivec2(floor(pt / ${CELL.toFixed(1)}));
  for (int k = 0; k < 2; k++) {
    vec4 ids = texelFetch(uGrid, ivec2(cel.x * 2 + k, cel.y), 0);
    for (int q = 0; q < 4; q++) {
      float fi = ids[q];
      if (fi < 0.0) break;
      int t = int(fi + 0.5) * 2;
      vec4 a = texelFetch(uSegs, ivec2(t % ${SEGW}, t / ${SEGW}), 0), b = texelFetch(uSegs, ivec2((t + 1) % ${SEGW}, (t + 1) / ${SEGW}), 0);
      vec2 pa = pt - a.xy, ba = a.zw - a.xy; float d = length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
      if (b.y < 0.5) { if (d - b.x < dw - hww) { dw = d; hww = b.x; } }
      else if (d - b.x < dr - hwr) { dr = d; hwr = b.x; rk = b.y; }
    }
  }
  float keep = 1.0 - city;
  // the alders and willows along the water, the fruit trees along the roads: crowns in a row
  float tq2 = 9.0; vec2 aq = pt / tq2, af = fract(aq) - 0.5; float ah = h12(mod(floor(aq), MAC / tq2));
  float crownD = length(af + (h22(floor(aq)) - 0.5) * 0.5) * tq2;
  float band = smoothstep(hww + 14.0, hww + 9.0, dw) * step(1.5, dw - hww) * step(0.35, ah) + smoothstep(hwr + 9.0, hwr + 6.0, dr) * step(hwr + 3.5, dr) * step(0.45, ah) * step(1.5, rk);
  col = mix(col, ${lin('#3a4428')} * (0.9 + 0.3 * ah), band * keep * (fw < 5.0 ? smoothstep(4.0, 2.4, crownD) : 0.35) * (1.0 - wood * 0.7));
  float wc = lineCov(dw, hww, fw) * keep;
  col = mix(col, crop(6.0) * 0.8, lineCov(dw, hww + 4.0, fw) * keep * 0.6); // (the wet grass of the banks)
  col = mix(col, ${lin('#3c4b4d')}, wc);
  gWater = wc;
  float rc = lineCov(dr, hwr, fw) * keep;
  col = mix(col, rk > 1.5 ? ${lin('#8e8b82')} : ${lin('#a39a83')}, rc);
  // ---- snow: the fields white (the furrows and baulks just showing), the woods dark through it, the
  // roads trodden grey, the water dark
  // (the scene's light and grading are cool: the ground's own colour kept rich and warm under them)
  col = max(mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 1.18) * vec3(1.06, 0.99, 0.86), 0.0);
  if (uSnowG > 0.0) {
    // (thinner on the stubble and the ridges of the ploughland, so the strips still show; the woods dark through it)
    vec3 snow = vec3(0.79, 0.81, 0.84) * (0.86 + 0.09 * hg2 + 0.05 * hs2) * (1.0 - 0.1 * plough * (1.0 - smoothstep(0.2 * w, 0.9 * w, fw)));
    float cover = 1.0 - wood * 0.72 - wc * 0.8 - rc * 0.15 - band * 0.6 - 0.25 * lineCov(ed, 1.3, fw) * track;
    col = mix(col, snow, uSnowG * cover);
  }
  return col;
}
`;

/**
 * The ground: 400 km of it under the formation, drawn by groundColour above. origin: where the layout's
 * 0, 0 is, in the ground's frame (the countryside's group position: it moves as the ground scrolls).
 */
export function groundMaterial(layout) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.3 });
  const u = m.userData.ground = {
    uMacro: { value: layout.macro }, uGrid: { value: layout.grid }, uSegs: { value: layout.segs },
    uOrigin: { value: new THREE.Vector2() }, uCity: { value: new THREE.Vector3(0, 0, -1) }, uSunL: { value: new THREE.Vector3(0, 1, 0) },
    uSeason: { value: 1 }, uSnowG: SNOW,
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 uOrigin; varying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz - uOrigin;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GROUND_GLSL}`)
      .replace('#include <map_fragment>', 'float gfw = max(length(fwidth(vGround)), 0.02);\ndiffuseColor.rgb *= groundColour(vGround, gfw);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, gWater);');
  };
  m.customProgramCacheKey = () => 'ground-v1';
  return aerial(m);
}

const airKey = new WeakSet();
/**
 * The haze over the ground on material m: the scene's fog, and over it a veil that grows with distance from
 * the first metre (exponential, not the fog's squared falloff that leaves the near ground untouched), so the
 * ground five miles below lies under a light blue-grey haze, the far country under a thick one.
 */
export function aerial(m) {
  if (!m || airKey.has(m)) return m;
  airKey.add(m);
  m.envMapIntensity = Math.min(m.envMapIntensity, 0.3); // (lit by the sky as the ground is: not tinted blue by it)
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uAir = AIR;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uAir;')
      // (the town's and villages' painted ground graded as the fields' colours are: kept rich and warm under the cool light)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), diffuseColor.rgb, 1.3) * vec3(1.08, 1.0, 0.82), 0.0);')
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogD = length(vViewPosition);
          float fogFactor = max(1.0 - exp(-fogDensity * fogDensity * fogD * fogD), 1.0 - exp(-uAir * fogDensity * fogD));
        #else
          float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|air`;
  return m;
}
