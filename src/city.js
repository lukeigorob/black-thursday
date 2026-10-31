// The target: Schweinfurt, a German industrial town on the Main. Its ball-bearing works (the Kugelfischer
// and VKF plants) are the aiming point, with the halls, sheds, chimneys and power house round them, and the
// marshalling yard along their south side. North of the river (three bridges) is the old town round its
// church spire and market square. Round all that, the town itself (urban.js): districts of streets each at
// its own angle, closed blocks round courtyards in the middle, terraces and then houses in gardens further
// out, factory halls by the railways, the outline ragged along the main roads and out to its suburbs.
// Near the middle every building is one instance (walls, and a roof), so the town costs a handful of
// draw calls; the rest is painted with its roofs' shadows. Bombs wreck what they land near.
import * as THREE from 'three';
import { snowy } from './environment.js';
import { AIRSPEED } from './bomber.js';
import { paintUrban, distToLine } from './urban.js';
import { aerial } from './ground.js';
import { riverZ, mainZ } from './river.js';
export { riverZ, mainZ };

const V = THREE.Vector3;
export const SIZE = 2400; // m across
export const BLAST = 38; // m: a building this close to a hit is wrecked
export const FACTORY = { x0: -420, x1: 420, z0: -300, z1: 260 }; // the works, round the aiming point (0, 0)
export const RAIL = { z0: 290, z1: 405 };
export const OLD_TOWN = { x: -250, z: -900, r: 300 };
const BRIDGES = [-760, -60, 620];
const RIVER_W = 70;

let seed = 1944;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rand = (a, b) => a + rnd() * (b - a);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ---- round the town: the Main valley, the railways and roads out of it, the suburbs (16 km across) ----
export const REGION = 24000;
const REGION_TEX = 2048;
/**
 * The main lines out of the marshalling yard (double track): west to Gemünden, south-west over the Main
 * to Würzburg, north to Bad Kissingen, east to Bamberg. Each a list of points, m, from the yard out.
 */
export const RAILWAYS = (() => {
  const yz = (RAIL.z0 + RAIL.z1) / 2, line = (x0, pts) => [[x0, yz], ...pts];
  return [
    line(-700, [[-2400, yz + 40], [-3800, yz + 300], [-5600, yz + 900], [-8000, yz + 1500]]), // Gemünden
    line(-700, [[-2000, yz - 100], [-2700, -600], [-3200, -2200], [-3900, -4400], [-4800, -8000]]), // Würzburg, over the river
    line(-700, [[-1700, yz + 300], [-2000, 1600], [-2100, 3600], [-1800, 6000], [-1500, 8000]]), // Bad Kissingen
    line(700, [[2600, yz + 60], [4200, yz - 300], [6000, -900], [8000, -1700]]), // Bamberg
  ];
})();
const ROADS = [[[0, -1200], [400, -3500], [1500, -8000]], [[-1000, -300], [-4500, -800], [-8000, -1800]], [[1000, -600], [4000, -2600], [8000, -4500]],
  [[300, 1200], [900, 4000], [2400, 8000]], [[-800, 1000], [-4400, 4200], [-7000, 8000]], [[1100, 900], [5200, 2600], [8000, 4800]]];
/** A line carried on out the way its last stretch runs, to `to` m from the town (the railways and roads out into the country). */
const onward = (l, to = 12000) => { const [ax, az] = l[l.length - 2], [bx, bz] = l[l.length - 1], L = Math.hypot(bx - ax, bz - az), k = Math.max(0, to - Math.hypot(bx, bz)); return [...l, [bx + ((bx - ax) / L) * k * 0.5 + ((bz - az) / L) * k * 0.08, bz + ((bz - az) / L) * k * 0.5 - ((bx - ax) / L) * k * 0.08], [bx + ((bx - ax) / L) * k, bz + ((bz - az) / L) * k]]; };
for (const l of [...RAILWAYS, ...ROADS]) l.splice(0, l.length, ...onward(l));

/** The ground round the town (under its own): see REGION. */
function regionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = REGION_TEX;
  const g = c.getContext('2d');
  const s = REGION_TEX / REGION, X = (m) => REGION_TEX / 2 + m * s;
  g.clearRect(0, 0, REGION_TEX, REGION_TEX);
  // the main roads out of town: pale, metalled
  g.strokeStyle = '#a89c84'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = Math.max(3, 18 * s);
  for (const r of ROADS) { g.beginPath(); r.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](X(x), X(z))); g.stroke(); }
  // (the Main itself is a ribbon of its own: riverRibbon)
  // the railways: a grey ballast bed, two dark tracks on it
  for (const r of RAILWAYS) {
    for (const [w, col] of [[34, '#8f846f'], [16, '#3a332b']]) {
      g.strokeStyle = col; g.lineWidth = Math.max(w === 34 ? 4 : 2, w * s); g.beginPath();
      r.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](X(x), X(z))); g.stroke();
    }
  }
  // fade out at the edge into the countryside
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(REGION_TEX / 2, REGION_TEX / 2, REGION_TEX * 0.3, REGION_TEX / 2, REGION_TEX / 2, REGION_TEX * 0.5);
  edge.addColorStop(0, '#000'); edge.addColorStop(1, '#0000');
  g.fillStyle = edge; g.fillRect(0, 0, REGION_TEX, REGION_TEX);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The Main, out of the town and on across the country 30 km each way (the ground's own streams and roads
 * run under it): its water meadows, a wet green fading out at their edge, and the water, glinting.
 */
function riverRibbon() {
  const group = new THREE.Group(), R = 30000;
  const band = (half, fade, col, y, rough) => {
    const pos = [], cols = [], idx = [];
    const c = new THREE.Color(col);
    for (let x = -R, k = 0; x <= R; x += 60, k++) {
      const z = mainZ(x), dz = (mainZ(x + 1) - mainZ(x - 1)) / 2, L = Math.hypot(1, dz), nx = -dz / L, nz = 1 / L;
      const end = Math.min(1, (R - Math.abs(x)) / 3000);
      for (const [o, a] of [[-half - fade, 0], [-half, 1], [half, 1], [half + fade, 0]]) { pos.push(x + nx * o, y, z + nz * o); cols.push(1, 1, 1, a * end); } // (the colour's the material's: the vertices only fade it out)
      if (k) for (let q = 0; q < 3; q++) { const a0 = (k - 1) * 4 + q, b0 = k * 4 + q; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); } // (wound to face up: the snow lies on it)
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, aerial(snowy(new THREE.MeshStandardMaterial({ color: c, vertexColors: true, transparent: true, depthWrite: false, roughness: rough, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), rough > 0.5 ? 0.85 : 0)));
    m.renderOrder = 1; m.frustumCulled = false;
    return m;
  };
  group.add(band(170, 140, '#4c5834', 0.25, 1), band(RIVER_W / 2 + 6, 4, '#465036', 0.3, 1), band(RIVER_W / 2, 2, '#34444a', 0.35, 0.22));
  return group;
}

// ---- the town itself (urban.js), 7 km across, round the works, the yard and the old town ----
export const URBAN = 7000;
const URBAN_PX = 4096;
const CORE = { x: -100, z: -350 }; // the middle of the town (between the old town and the works)
const SUBURBS = [[-2700, -2300, 420], [-2400, -2050, 300], [2400, 1900, 380], [2650, 2150, 260], [2900, -1700, 360], [2700, -1500, 260], [-2500, 2300, 330], [300, 2700, 300]]; // [x, z, radius]: the villages it swallowed (two or three bumps each: not round)
/** How built-up the town is at (x, z): thick in the middle, out along the main roads, round its suburbs. */
function cityDensity(x, z) {
  if (Math.abs(z - mainZ(x)) < RIVER_W / 2 + 30) return 0;
  // not a disc: the town spreads along the river's north bank, round the old town and up the slope; the
  // works side is the factories, the yard and the workers' streets; out along the roads, and its swallowed villages
  const north = Math.exp(-(((x + 350) / 2300) ** 2 + ((z + 1150) / 1150) ** 2) * 1.1);
  const works = 0.85 * Math.exp(-(((x - 100) / 1700) ** 2 + ((z - 450) / 750) ** 2) * 1.2);
  const r = Math.hypot(x - CORE.x, z - CORE.z);
  let d = 1.08 * Math.max(north, works);
  for (const road of ROADS) d = Math.max(d, 0.6 * Math.exp(-((distToLine(x, z, road) / 150) ** 2)) * Math.exp(-r / 2600));
  for (const [sx, sz, sr] of SUBURBS) d = Math.max(d, 0.58 * Math.exp(-((Math.hypot(x - sx, z - sz) / sr) ** 2)));
  return d;
}
const inWorks = (x, z) => x > FACTORY.x0 - 50 && x < FACTORY.x1 + 50 && z > FACTORY.z0 - 50 && z < FACTORY.z1 + 30;
const inYard = (x, z) => Math.abs(x) < 1300 && z > RAIL.z0 - 30 && z < RAIL.z1 + 50;
/** The old town's wall line at angle a (m from its middle): wider east-west, never a circle. */
const otRim = (a) => OLD_TOWN.r * (0.88 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 7 + 2)) * Math.hypot(1.22 * Math.cos(a), 0.86 * Math.sin(a)) / Math.hypot(Math.cos(a), Math.sin(a));
const inOldTown = (x, z, pad = 20) => Math.hypot(x - OLD_TOWN.x, z - OLD_TOWN.z) < otRim(Math.atan2(z - OLD_TOWN.z, x - OLD_TOWN.x)) + pad;
/** The old town's lanes: the main street through it east to west, two more along it, crooked lanes across (seeded: the same every time). */
const OT_LANES = (() => {
  let k = 77; const r = () => ((k = (k * 16807) % 2147483647) / 2147483647), R = (a, b) => a + r() * (b - a);
  const O = OLD_TOWN, L = [];
  const bend = (pts) => pts.map(([x, z], i) => (i && i < pts.length - 1 ? [x + R(-14, 14), z + R(-14, 14)] : [x, z]));
  L.push({ w: 11, pts: bend([[O.x - 420, O.z + 30], [O.x - 200, O.z + 40], [O.x, O.z + 40], [O.x + 200, O.z + 30], [O.x + 420, O.z + 20]]) });
  for (const dz of [-120, 150]) L.push({ w: 7, pts: bend([[O.x - 300, O.z + dz * 0.8], [O.x - 120, O.z + dz], [O.x + 100, O.z + dz * 1.05], [O.x + 300, O.z + dz * 0.8]]) });
  for (let i = 0; i < 8; i++) { const x = O.x - 300 + i * 86 + R(-20, 20); L.push({ w: 5.5, pts: bend([[x + R(-30, 30), O.z - 260], [x + R(-20, 20), O.z - 60], [x + R(-25, 25), O.z + 100], [x + R(-30, 30), O.z + 260]]) }); }
  L.push({ w: 6, pts: Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * Math.PI * 2, m = otRim(a) - 12; return [O.x + Math.cos(a) * m, O.z + Math.sin(a) * m]; }) });
  return L;
})();

/**
 * The town's ground texture, and the buildings near the middle (to stand in 3D on the same streets): the
 * town painted (urban.js), then over it the works, the yard and its tracks, the old town's lanes, the river,
 * the railways out, and the roofs of `special` (the works, the yard's sheds, the old town: 3D already).
 */
function townTexture(special) {
  const u = paintUrban({
    size: URBAN, px: URBAN_PX, seed: 1944, density: cityDensity, threshold: 0.33, cell: 82, roads: ROADS,
    skip: (x, z) => inWorks(x, z) || inYard(x, z) || inOldTown(x, z),
    industrial: (x, z) => (Math.hypot(x, z) < 2000 && RAILWAYS.some((l) => distToLine(x, z, l) < 200)) || (Math.abs(x) < 800 && z > -420 && z < 520), // (by the yard and the works, not all down the lines)
    keep: (x, z) => Math.hypot(x - CORE.x, z - CORE.z) < 1300,
  });
  const g = u.canvas.getContext('2d'), s = URBAN_PX / URBAN, X = (m) => URBAN_PX / 2 + m * s;
  const line = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = Math.max(1.5, w * s); g.beginPath(); pts.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](X(x), X(z))); g.stroke(); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  // the works: concrete aprons and yards
  g.fillStyle = '#76695a'; g.fillRect(X(FACTORY.x0 - 30), X(FACTORY.z0 - 30), (FACTORY.x1 - FACTORY.x0 + 60) * s, (FACTORY.z1 - FACTORY.z0 + 50) * s);
  // the marshalling yard: ballast, and its tracks fanning out of the main lines
  g.fillStyle = '#5f564a'; g.fillRect(X(-1300), X(RAIL.z0), 2600 * s, (RAIL.z1 - RAIL.z0) * s);
  g.strokeStyle = '#2f2e2b'; g.lineWidth = Math.max(1, 2.2 * s);
  for (let k = 0; k < 14; k++) { const z = RAIL.z0 + 8 + k * 7.5; g.beginPath(); g.moveTo(X(-1300 + (k % 3) * 60), X(z)); g.lineTo(X(1300 - (k % 4) * 50), X(z)); g.stroke(); }
  // the old town: packed inside its old wall line (a ring of trees now), its crooked lanes to the market
  const rimPath = (pad) => { g.beginPath(); for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2, m = otRim(a) + pad; g.lineTo(X(OLD_TOWN.x + Math.cos(a) * m), X(OLD_TOWN.z + Math.sin(a) * m)); } };
  g.strokeStyle = '#56603a'; g.lineWidth = 30 * s; rimPath(16); g.stroke();
  g.fillStyle = '#5c5246'; rimPath(0); g.fill();
  for (const l of OT_LANES) line(l.pts, l.w, '#77716a');
  g.fillStyle = '#857f74'; g.beginPath(); g.ellipse(X(OLD_TOWN.x), X(OLD_TOWN.z + 40), 46 * s, 30 * s, 0.1, 0, 7); g.fill(); // the market square
  for (let i = 0; i < 160; i++) { const a = (i / 160) * Math.PI * 2, m = otRim(a) + 16 + (i % 2 ? 6 : -6); g.fillStyle = i % 3 ? '#46522c' : '#5a5a2c'; g.beginPath(); g.arc(X(OLD_TOWN.x + Math.cos(a) * m), X(OLD_TOWN.z + Math.sin(a) * m), 5 * s, 0, 7); g.fill(); } // (the promenade's trees)
  // the roofs of the works, the yard's sheds and wagons, the old town (each with its shadow, as the town's)
  for (const b of special) {
    g.save(); g.translate(X(b.x), X(b.z)); g.rotate(b.rot);
    g.fillStyle = 'rgba(22, 20, 17, 0.45)'; g.fillRect((-b.w / 2 + b.h * 0.18) * s, (-b.d / 2 + b.h * 0.28) * s, b.w * s, b.d * s);
    g.fillStyle = `#${(b.roof ?? b.col).toString(16).padStart(6, '0')}`; g.fillRect((-b.w / 2) * s, (-b.d / 2) * s, b.w * s, b.d * s);
    if (b.saw) { g.fillStyle = 'rgba(0,0,0,0.22)'; for (let u = -b.w / 2; u < b.w / 2; u += 7) g.fillRect(u * s, (-b.d / 2) * s, 2.5 * s, b.d * s); g.fillStyle = 'rgba(200,210,220,0.12)'; for (let u = -b.w / 2 + 3; u < b.w / 2; u += 7) g.fillRect(u * s, (-b.d / 2) * s, 1.2 * s, b.d * s); }
    if (b.roof && b.rh > 3) { g.fillStyle = 'rgba(20,12,8,0.24)'; if (b.w >= b.d) g.fillRect((-b.w / 2) * s, 0, b.w * s, (b.d / 2) * s); else g.fillRect(0, (-b.d / 2) * s, (b.w / 2) * s, b.d * s); }
    g.restore();
  }
  // the river through the town, and the railways out of the yard (only where there's town: beyond, the country's own, regionTexture)
  g.globalCompositeOperation = 'source-atop';
  const river = []; for (let x = -URBAN / 2; x <= URBAN / 2; x += 30) river.push([x, mainZ(x)]);
  line(river, RIVER_W + 22, '#55604a'); line(river, RIVER_W, '#33424b');
  for (const r of RAILWAYS) { line(r, 30, '#8f846f'); line(r, 14, '#3a332b'); }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(u.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, buildings: u.buildings, tm: u.tm };
}

/** A unit gable roof: ridge along Z, eaves at y 0, ridge at y 1. */
function gable() {
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

export class City {
  constructor(scene, center) {
    const t0 = performance.now();
    seed = 1944;
    this.center = center; // the aiming point, on the ground, in the formation's frame
    this.group = new THREE.Group();
    const b = (this.buildings = []);
    // [x, z, w, d, h, colour, roof colour or null (flat), roof height, turned (rad, as the town's streets: urban.js)]
    const add = (x, z, w, d, h, col, roof = null, rh = 0, rot = 0) => b.push({ x, z, w, d, h, col, roof, rh, rot, alive: true });
    const PLASTER = [0x9a8d72, 0x8e7f64, 0xa39883, 0x82775f, 0x958569], TILE = [0x8e4a33, 0x7e432f, 0x8a5038, 0x94563c, 0x76463a], SLATE = [0x3d3f44, 0x46484b, 0x4a423c];
    const BRICK = [0x7a5444, 0x6c4a3c, 0x85624f], WORKS = [0x8a7f6e, 0x7c7366, 0x948a78];

    // the works: big assembly halls with low pitched roofs, long sheds, workshops, chimneys, a power house
    for (const z of [-170, -60]) for (const x of [-300, -100, 100, 300]) add(x, z, 130, 55, 16, pick(WORKS), 0x50524f, 4);
    for (const x of [-280, -60, 160]) add(x, 80, 180, 35, 12, pick(WORKS), 0x5b5c58, 3);
    add(360, 185, 60, 40, 26, pick(BRICK));
    for (let i = 0; i < 6; i++) add(rand(-380, 380), rand(130, 240), 6, 6, rand(40, 60), 0x6a4a3c);
    for (let i = 0; i < 40; i++) add(rand(-400, 300), rand(150, 245), rand(15, 40), rand(10, 25), rand(6, 10), pick(WORKS));
    for (let i = 0; i < 20; i++) add(rand(-400, 400), rand(-290, -240), rand(12, 30), rand(8, 18), rand(5, 9), pick(WORKS));
    // and the works packed with more of them: sawtooth-roofed shops in rows between the big halls, a yard track or two
    const taken = b.slice(), overlaps = (x, z, w, d) => taken.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 6 && Math.abs(q.z - z) < (q.d + d) / 2 + 6);
    for (let i = 0; i < 400; i++) {
      const w = rand(30, 90), d = rand(18, 40), x = rand(FACTORY.x0 + w / 2, FACTORY.x1 - w / 2), z = rand(FACTORY.z0 + d / 2, FACTORY.z1 - d / 2);
      if (overlaps(x, z, w, d)) continue;
      add(x, z, w, d, rand(8, 12), pick(WORKS), pick([0x5a5c58, 0x626360, 0x56544f]), 2.5);
      b[b.length - 1].saw = true; taken.push(b[b.length - 1]);
    }

    // the rail yard: wagons on the tracks, the goods sheds and the engine shed
    for (let i = 0; i < 150; i++) add(rand(-1000, 1000), RAIL.z0 + 8 + Math.floor(rand(0, 14)) * 7.5, rand(10, 15), 3, 3.6, pick([0x5a3a2c, 0x4a4038, 0x3c3a36]));
    add(-700, RAIL.z1 + 22, 140, 26, 9, pick(BRICK), 0x4d5056, 4);
    add(720, RAIL.z1 + 25, 90, 34, 14, pick(BRICK), 0x44464a, 5);

    // the old town: crowded houses with steep tiled roofs, the church and its spire on the market
    const OT = OLD_TOWN, occ = new Set(), cell = (x, z) => `${Math.round(x / 3)},${Math.round(z / 3)}`;
    const clearOf = (x, z, w, d, rot, mark) => { const c = Math.cos(rot), sn = Math.sin(rot); for (let u = -w / 2 + 1; u < w / 2; u += 2.5) for (let v = -d / 2 + 1; v < d / 2; v += 2.5) { const k = cell(x + c * u - sn * v, z + sn * u + c * v); if (mark) occ.add(k); else if (occ.has(k)) return false; } return true; };
    const keepClear = (x, z) => Math.hypot(x - OT.x, z - OT.z - 40) < 50 || Math.hypot(x - OT.x, z - OT.z + 40) < 42 || !inOldTown(x, z, -6);
    for (const l of OT_LANES) for (let k = 0; k < l.pts.length - 1; k++) clearOf((l.pts[k][0] + l.pts[k + 1][0]) / 2, (l.pts[k][1] + l.pts[k + 1][1]) / 2, Math.hypot(l.pts[k + 1][0] - l.pts[k][0], l.pts[k + 1][1] - l.pts[k][1]), l.w, Math.atan2(l.pts[k + 1][1] - l.pts[k][1], l.pts[k + 1][0] - l.pts[k][0]), true);
    const otHouse = (x, z, w, d, rot, h, roof) => { if (keepClear(x, z) || !clearOf(x, z, w, d, rot, false)) return false; clearOf(x, z, w, d, rot, true); add(x, z, w, d, h, pick(PLASTER), roof, rand(5, 7), rot); return true; };
    for (const l of OT_LANES) for (let k = 0; k < l.pts.length - 1; k++) { // the houses shoulder to shoulder along each lane, gables to it
      const [ax, az] = l.pts[k], [bx, bz] = l.pts[k + 1], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, rot = Math.atan2(tz, tx);
      for (let a = 0; a < L;) {
        const w = rand(8, 12), d = rand(11, 15);
        for (const side of [-1, 1]) { const nx = -tz * side, nz = tx * side, off = l.w / 2 + d / 2 + 0.6; otHouse(ax + tx * (a + w / 2) + nx * off, az + tz * (a + w / 2) + nz * off, w - 0.3, d, rot, rand(10, 15), rnd() < 0.12 ? pick(SLATE) : pick(TILE)); }
        a += w;
      }
    }
    for (let i = 0; i < 1400; i++) { const x = OT.x + rand(-1.3, 1.3) * OT.r, z = OT.z + rand(-1, 1) * OT.r; otHouse(x, z, rand(6, 12), rand(5, 9), rand(-0.2, 0.2) + (rnd() < 0.5 ? 0 : Math.PI / 2), rand(5, 9), pick(TILE)); } // (the back houses and sheds in the yards)
    add(OT.x, OT.z - 30, 22, 60, 20, 0xb9ad94, 0x4f4a44, 12); // the nave
    this.church = b.length;
    add(OT.x, OT.z - 66, 13, 13, 46, 0xb9ad94); // the tower (its spire is a mesh of its own)

    // the bridges over the river
    for (const x of BRIDGES) add(x, riverZ(x), 16, RIVER_W + 40, 4, 0x8a8478);

    // trains on the main lines out of the yard: goods wagons in strings, on the straight stretches
    for (const [x0, x1, z] of [[-2300, -1500, (RAIL.z0 + RAIL.z1) / 2 + 30], [1400, 2400, (RAIL.z0 + RAIL.z1) / 2 + 30], [-2200, -1700, (RAIL.z0 + RAIL.z1) / 2 - 4]]) {
      for (let x = x0; x < x1; x += 14) if (rnd() < 0.92) add(x, z + rand(-1, 1), 12, 3, 3.6, pick([0x5a3a2c, 0x4a4038, 0x3c3a36, 0x5c4a3a]));
    }
    // the country round the town: the Main valley, the railways and roads out, the suburbs (under the town's own ground)
    const region = new THREE.Mesh(new THREE.PlaneGeometry(REGION, REGION), aerial(snowy(new THREE.MeshStandardMaterial({ map: regionTexture(), roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 0.85)));
    region.rotation.x = -Math.PI / 2;
    region.position.y = 0.3;
    region.renderOrder = 1;
    this.group.add(region);
    this.group.add(riverRibbon());
    // the town round all that: painted, and near the middle its buildings in 3D on the same streets
    const tt = performance.now();
    const town = townTexture(b);
    this.tm = { ...town.tm, before: Math.round(tt - t0), town: Math.round(performance.now() - tt) };
    for (const u of town.buildings) {
      const hall = u.kind === 'hall';
      add(u.x, u.z, u.w, u.d, u.h, hall ? pick(WORKS) : pick(PLASTER), parseInt(u.col.slice(1), 16), hall ? 2.5 : u.kind === 'block' ? 5 : 4, u.rot);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(URBAN, URBAN), aerial(snowy(new THREE.MeshStandardMaterial({ map: town.texture, color: new THREE.Color(1.38, 1.34, 1.3), roughness: 1, transparent: true, depthWrite: false }), 0.7) /* (painted for the eye, lifted to the fields' brightness under the haze) */));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.5;
    ground.renderOrder = 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), aerial(snowy(new THREE.MeshStandardMaterial({ roughness: 0.9 }))), b.length);
    const roofs = new THREE.InstancedMesh(gable(), aerial(snowy(new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }))), b.length); // (snow on the roofs in winter)
    for (const m of [walls, roofs]) { m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); }
    Object.assign(this, { walls, roofs, _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _c: new THREE.Color() });
    b.forEach((x, i) => this.place(i));
    // the church spire
    const tower = b[this.church];
    this.spire = new THREE.Mesh(new THREE.ConeGeometry(7.5, 34, 8).translate(0, 17, 0), aerial(new THREE.MeshStandardMaterial({ color: 0x3f5a50, roughness: 0.6, metalness: 0.3 })));
    this.spire.position.set(tower.x, tower.h, tower.z);
    this.group.add(this.spire);

    this.group.position.copy(center);
    scene.add(this.group);
    this.burning = [];
    this.buildMs = performance.now() - t0; // (how long the town took to make: the loading screen waits on it)
  }

  place(i) {
    const b = this.buildings[i], m = this._m, c = this._c;
    const turn = b.w > b.d; // the ridge runs along the long side
    // (turned as its street: urban.js turns the canvas by rot, which about +Y is -rot)
    m.compose(_p.set(b.x, 0, b.z), this._q.setFromAxisAngle(_up, -b.rot), _s.set(b.w, b.alive ? b.h : b.h * 0.15, b.d));
    this.walls.setMatrixAt(i, m);
    this.walls.setColorAt(i, b.alive ? c.setHex(b.col) : c.setHex(0x2e2a26));
    if (b.roof && b.alive) {
      this._q.setFromAxisAngle(_up, -b.rot + (turn ? Math.PI / 2 : 0));
      m.compose(_p.set(b.x, b.h, b.z), this._q, _s.set(turn ? b.d : b.w, b.rh, turn ? b.w : b.d));
      this.roofs.setColorAt(i, c.setHex(b.roof));
    } else m.makeScale(0, 0, 0);
    this.roofs.setMatrixAt(i, m);
    for (const x of [this.walls, this.roofs]) {
      x.instanceMatrix.needsUpdate = true;
      if (x.instanceColor) x.instanceColor.needsUpdate = true;
    }
  }

  get destroyed() { return this.buildings.filter((b) => !b.alive).length; }

  /** A bomb burst at p: wreck what's close. Returns how many buildings it took. */
  blast(p) {
    let n = 0;
    const l = this.group.worldToLocal(p.clone()), lx = l.x, lz = l.z; // (in the town's own frame: turned with the ground)
    this.buildings.forEach((b, i) => {
      if (!b.alive) return;
      const ox = lx - b.x, oz = lz - b.z, c = Math.cos(b.rot), sn = Math.sin(b.rot); // (into the building's own frame)
      const dx = Math.max(Math.abs(ox * c + oz * sn) - b.w / 2, 0), dz = Math.max(Math.abs(-ox * sn + oz * c) - b.d / 2, 0);
      if (dx < BLAST && dz < BLAST && Math.hypot(dx, dz) < BLAST) {
        b.alive = false; this.place(i); n++;
        this.burning.push({ i, t: rand(40, 90), e: 0 });
        if (i === this.church) this.spire.visible = false;
      }
    });
    return n;
  }

  update(dt, effects) {
    this.center.z += AIRSPEED * dt;
    // (the centre is where the town is from the formation; the town hangs in the turned ground, drift)
    if (this.group.parent?.isScene) this.group.position.copy(this.center);
    else { this.group.parent.worldToLocal(this.group.position.copy(this.center)); this.group.rotation.y = 0; }
    // wrecked buildings burn and smoke for a while (a few dozen fires at a time, spread through the list)
    const step = Math.max(1, Math.ceil(this.burning.length / 50));
    for (let k = this.burning.length - 1; k >= 0; k--) {
      const f = this.burning[k];
      if ((f.t -= dt) <= 0) { this.burning.splice(k, 1); continue; }
      if (k % step || (f.e -= dt * step) > 0) continue;
      f.e = rand(0.4, 0.9);
      const b = this.buildings[f.i];
      effects.groundSmoke(this.group.localToWorld(_s.set(b.x, b.h * 0.15 - this.group.position.y + this.center.y, b.z)).clone()); // (where the building is, the ground turned or not)
    }
  }

  /** What the mission map draws, in the town's own frame (m, aiming point at 0, 0). */
  get layout() {
    return { size: SIZE, factory: FACTORY, rail: RAIL, oldTown: OLD_TOWN, riverZ, riverW: RIVER_W, bridges: BRIDGES };
  }
}

const _p = new V(), _s = new V(), _up = new V(0, 1, 0);
