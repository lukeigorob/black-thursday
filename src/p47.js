// The Republic P-47D Thunderbolt "razorback" as the 56th Fighter Group flew it in October 1943, built in
// code (no model file):
// - the deep, egg-shaped cowling of the R-2800 Double Wasp: the engine's two rows of cylinders behind the
//   round upper opening, the chin intake under it split in three (the oil coolers either side, the
//   turbocharger's air in the middle), the cowl flaps round its back edge;
// - the deep fuselage (the turbo's ducts run under the cockpit to the engine), the intercooler doors and
//   oil-cooler shutters on its sides, the waste gates under the wing root and the turbo's exhaust hood
//   under the rear fuselage, all streaking soot aft;
// - the framed canopy: the flat armoured windscreen and its quarter panes, the sliding hood, and behind it
//   the high spine that gave the razorback its name, with its small fixed windows;
// - the semi-elliptical wing on a real airfoil (15 % thick at the root, 9 % at the tip), four .50s in each
//   side, staggered; the tailplanes and the fin from the same airfoil;
// - the Curtiss Electric propeller of 1943, four narrow "toothpick" blades, 12 ft 2 in across;
// - painted by a shader: faded olive drab over neutral grey, panel lines, the 8th Air Force's white bands
//   (cowling front, fin and tailplanes), the star and bars (in the red surround of the summer, or the blue
//   that replaced it from August 1943: both were about that autumn), the 56th's white codes and a yellow
//   serial on the fin, different on each aircraft.
// Same frame as the other fighters: nose -Z, the prop's axis at y = 0, metres; 11.0 m long, 12.42 m span.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;

// ---------- the shape

// the fuselage's stations: [z, half-width, top, height of the widest point, bottom]. Over the cockpit the top
// is cut away at the sill; behind it the spine (SPINE) stands on top
const FUSE = [
  [-4.33, 0.655, 0.69, -0.11, -0.89], [-4.26, 0.705, 0.75, -0.11, -0.97], [-4.05, 0.73, 0.785, -0.11, -1.01], [-3.5, 0.74, 0.8, -0.11, -1.03],
  [-2.8, 0.745, 0.81, -0.11, -1.045], [-2.2, 0.725, 0.83, -0.12, -1.055], [-1.5, 0.695, 0.86, -0.13, -1.06], [-0.86, 0.67, 0.9, -0.13, -1.06],
  [-0.2, 0.645, 0.92, -0.12, -1.045], [0.45, 0.615, 0.9, -0.1, -1.0], [1.3, 0.565, 0.84, -0.06, -0.9], [2.2, 0.495, 0.8, -0.01, -0.74],
  [3.1, 0.415, 0.76, 0.05, -0.55], [4.0, 0.325, 0.72, 0.12, -0.35], [4.8, 0.235, 0.68, 0.2, -0.14], [5.5, 0.145, 0.63, 0.28, 0.08],
  [6.0, 0.07, 0.57, 0.35, 0.27], [6.2, 0.012, 0.5, 0.41, 0.37],
];
// the razorback: [z, half-width, top] of the narrow spine from the hood back to the fin, standing on the fuselage
const SPINE = [[0.4, 0.375, 1.36], [0.9, 0.335, 1.3], [1.8, 0.265, 1.18], [2.8, 0.19, 1.04], [3.8, 0.12, 0.9], [4.6, 0.06, 0.8], [5.05, 0.015, 0.74]];
const SPINE_Y = 0.66;
// the canopy: the windscreen's foot and top, the hood from there back to the spine; the sill, the hood's top
export const WS_Z = -0.86, WS_TOP_Z = -0.58, HOOD_Z = 0.42, SILL = 0.8, HOOD_TOP = 1.36;
// the cowl flaps: hinged at FLAP0, their trailing edges standing a little proud at FLAP1
const FLAP0 = -2.95, FLAP1 = -2.62;
// the wing: chord line at the root, dihedral; the semi-span; the quarter-chord line nearly straight
const WING_Y = -0.62, DIHEDRAL = Math.tan(THREE.MathUtils.degToRad(4.5)), SEMI = 6.21;
const wChord = (s) => 2.84 * Math.sqrt(Math.max(0, 1 - (s / SEMI) ** 2.4));
const wQuarter = (s) => -1.25 + 0.04 * s;
const wingY = (s) => WING_Y + s * DIHEDRAL;
/** The wing's leading edge at span s (the guns come out of it). */
const leadingEdge = (s) => wQuarter(s) - 0.25 * wChord(s);
// the tailplane and the fin
const tChord = (s) => 1.45 * Math.sqrt(Math.max(0, 1 - (s / 2.36) ** 2.6)), tQuarter = (s) => 5.0 + 0.05 * s, TAIL_Y = 0.4;
const fChord = (s) => (1.95 - 0.5 * s) * Math.sqrt(Math.max(0, 1 - (s / 1.74) ** 5)), fTrail = (s) => 6.17 - 0.03 * s, FIN_Y = 0.42;
// the guns' spanwise stations, inboard to outboard (outboard of the main wheels, as in the real wing)
export const P47_GUN_X = [2.55, 2.8, 3.05, 3.3];
const PROP_Z = -4.55, PROP_R = 1.855; // the Curtiss Electric's plane and radius (12 ft 2 in)

/** Catmull-Rom through table rows (the first column the key): a function of the key giving the other columns. */
function curve(rows) {
  const n = rows.length;
  return (z) => {
    let i = 0;
    while (i < n - 2 && z > rows[i + 1][0]) i++;
    const t = THREE.MathUtils.clamp((z - rows[i][0]) / (rows[i + 1][0] - rows[i][0]), 0, 1), t2 = t * t, t3 = t2 * t;
    const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(n - 1, i + 2)], out = [];
    for (let c = 1; c < p1.length; c++) {
      const a = p0[c], b = p1[c], d = p2[c], e = p3[c];
      out.push(0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (3 * b - a - 3 * d + e) * t3));
    }
    return out;
  };
}
/** The fuselage at z: [half-width, top, widest at, bottom]. */
export const fuse = curve(FUSE);
const spineAt = curve(SPINE);
const pe = (v, e) => Math.sign(v) * Math.abs(v) ** e;
/** The cowl flaps standing open a little: how much wider the section is at z. */
const flaps = (z) => (z > FLAP0 && z < FLAP1 ? 1 + 0.03 * (z - FLAP0) / (FLAP1 - FLAP0) : 1);

/** A point on the fuselage's section at z, angle a (0 = the right side, going up over the top). */
export function fusePoint(z, a, out = new V()) {
  const [hw, top, mid, bot] = fuse(z), c = Math.cos(a), s = Math.sin(a), f = flaps(z);
  const n = z < FLAP1 ? 2.25 : 2.4; // (the cowling rounder, the fuselage's sides flatter)
  return out.set(hw * f * pe(c, 2 / n), mid + (s >= 0 ? top - mid : mid - bot) * f * pe(s, 2 / n), z);
}

/** The skin's height at z, x across: on top (up) or underneath. */
export function skinY(z, x, up) {
  const [hw, top, mid, bot] = fuse(z), n = z < FLAP1 ? 2.25 : 2.4, f = flaps(z), k = Math.max(0, 1 - Math.min(1, Math.abs(x) / (hw * f)) ** n) ** (1 / n);
  return up ? mid + (top - mid) * f * k : mid - (mid - bot) * f * k;
}

/** Indexed grid geometry from rows of points (each row the same length), faces skipped where skip(i, k) says. */
function grid(rows, skip) {
  const m = rows[0].length, pos = [], idx = [];
  for (const r of rows) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < m - 1; k++) {
    if (skip?.(i, k)) continue;
    const a = i * m + k, b = a + m;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The fuselage's skin, open over the cockpit above the sill (and capped at the tail). */
function fuselageGeo(seg, dz) {
  const zs = new Set();
  for (let z = FUSE[0][0]; z < 6.2; z += dz) zs.add(+z.toFixed(4));
  for (const z of [6.2, FLAP0, FLAP1 - 0.002, FLAP1 + 0.002, WS_Z, HOOD_Z, -3.72, 0.0]) zs.add(z);
  const list = [...zs].sort((a, b) => a - b), rows = [];
  const open = (z) => z >= WS_Z - 1e-4 && z <= HOOD_Z + 1e-4;
  for (const z of list) {
    const row = [];
    for (let k = 0; k <= seg; k++) {
      const p = fusePoint(z, -Math.PI / 2 + (k / seg) * Math.PI * 2); // (the seam along the belly)
      if (open(z) && p.y > SILL) p.y = SILL;
      row.push(p);
    }
    rows.push(row);
  }
  return grid(rows, (i, k) => open(list[i]) && open(list[i + 1]) && rows[i][k].y >= SILL - 1e-5 && rows[i][k + 1].y >= SILL - 1e-5 && rows[i + 1][k].y >= SILL - 1e-5 && rows[i + 1][k + 1].y >= SILL - 1e-5);
}

/** The spine: narrow, its sides sloping up to a rounded top, from the hood back to the fin. */
function spineGeo(seg, n) {
  const rows = [];
  for (let j = 0; j <= n; j++) {
    const z = SPINE[0][0] + (j / n) * (SPINE[SPINE.length - 1][0] - SPINE[0][0]), [hw, top] = spineAt(z), row = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI; // (the upper half only: the lower half would be inside the fuselage)
      row.push(new V(hw * pe(Math.cos(a), 2 / 1.8), SPINE_Y + (top - SPINE_Y) * pe(Math.sin(a), 2 / 1.8), z));
    }
    rows.push(row);
  }
  return grid(rows);
}

/** An airfoil section at u (0..1: from the trailing edge along the top to the nose, back along the bottom): [x/c, y/c]. */
function foil(u, t, m = 0.02, p = 0.4) {
  const a = u < 0.5 ? 1 - u * 2 : (u - 0.5) * 2, x = (1 - Math.cos(a * Math.PI)) / 2;
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
  return [x, yc + (u < 0.5 ? yt : -yt)];
}

/**
 * A lifting surface from s0 out to its tip at b, where the chord runs to nothing (the tip closes itself):
 * chord(s), quarter(s) the quarter-chord line's z, thick(s), place(s, y, z) -> [x, y, z] with y off the
 * chord line ("up" for the airfoil's top). Stations closer together towards the tip, where it curves.
 */
function surface({ s0, b, chord, quarter, thick, camber = 0.02, place }, N, M) {
  const rows = [];
  for (let j = 0; j <= N; j++) {
    const s = s0 + (b - s0) * Math.sin((j / N) * Math.PI / 2), c = chord(s), le = quarter(s) - 0.25 * c, t = thick(s), row = [];
    for (let k = 0; k <= M; k++) { const [x, y] = foil(k / M, t, camber); row.push(new V(...place(s, y * c, le + x * c))); }
    rows.push(row);
  }
  const g = grid(rows);
  // the right way out: the top's normal must point "up"
  const k = Math.round(M / 4), j = 1, n = g.attributes.normal, i = j * (M + 1) + k, s = s0 + (b - s0) * Math.sin(Math.PI / 2 / N);
  const up = new V(...place(s, 1, 0)).sub(new V(...place(s, 0, 0)));
  if (n.getX(i) * up.x + n.getY(i) * up.y + n.getZ(i) * up.z < 0) flip(g);
  return g;
}

/** Mirrored or wrongly wound geometry turned the right way out. */
function flip(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]]; g.index.needsUpdate = true; } else {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) for (const att of Object.values(g.attributes)) {
      const s = att.itemSize;
      for (let k = 0; k < s; k++) { const t = att.array[(i + 1) * s + k]; att.array[(i + 1) * s + k] = att.array[(i + 2) * s + k]; att.array[(i + 2) * s + k] = t; }
    }
  }
  g.computeVertexNormals();
}

const wingGeo = (side, lod) => surface({ s0: 0.3, b: SEMI, chord: wChord, quarter: wQuarter, thick: (s) => 0.15 - 0.06 * s / SEMI, place: (s, y, z) => [side * s, wingY(s) + y, z] }, lod ? 8 : 18, lod ? 12 : 30);
const tailGeo = (side, lod) => surface({ s0: 0.05, b: 2.36, chord: tChord, quarter: tQuarter, thick: () => 0.11, camber: 0, place: (s, y, z) => [side * s, TAIL_Y + y, z] }, lod ? 5 : 12, lod ? 10 : 22);
const finGeo = (lod) => surface({ s0: 0, b: 1.74, chord: fChord, quarter: (s) => fTrail(s) - 0.75 * fChord(s), thick: () => 0.1, camber: 0, place: (s, y, z) => [y, FIN_Y + s, z] }, lod ? 5 : 12, lod ? 10 : 22);

/** A rod from a to b (radius r). */
function rod(a, b, r, seg = 6, r1 = r) {
  const d = new V().subVectors(b, a), g = new THREE.CylinderGeometry(r1, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** The hood's section at z: from the sill on one side over the top to the other (k from 0 to M). */
export function hoodPoint(z, k, M) {
  const a = -Math.PI / 2 + (k / M) * Math.PI, w = 0.37 + 0.012 * (z - WS_TOP_Z) / (HOOD_Z - WS_TOP_Z);
  // (the top: up from the windscreen's quickly, then level back to the spine)
  const kz = Math.min(1, ((z - WS_TOP_Z) / (HOOD_Z - WS_TOP_Z)) * 2.6), top = 1.24 + (HOOD_TOP - 1.24) * Math.sin(kz * Math.PI / 2);
  return new V(w * pe(Math.sin(a), 0.8), SILL + (top - SILL) * Math.abs(Math.cos(a)) ** 0.7, z);
}

/** The windscreen's corners: the flat armoured front panel and the quarter panes back to the hood's bow. */
export function windscreen() {
  const fbl = new V(-0.19, 0.865, WS_Z), fbr = new V(0.19, 0.865, WS_Z), ftl = new V(-0.15, 1.24, WS_TOP_Z), ftr = new V(0.15, 1.24, WS_TOP_Z);
  const sbl = new V(-0.37, SILL, WS_TOP_Z), sbr = new V(0.37, SILL, WS_TOP_Z), stl = hoodPoint(WS_TOP_Z, 3, 12), str = hoodPoint(WS_TOP_Z, 9, 12);
  return { fbl, fbr, ftl, ftr, sbl, sbr, stl, str };
}

/** A flat pane through four corners (two triangles). */
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((p) => p.toArray()), 3));
  g.computeVertexNormals();
  return g;
}

/** The sliding hood's glass, from the windscreen back to the spine. */
function hoodGeo(M, K) {
  const rows = [];
  for (let j = 0; j <= K; j++) { const z = WS_TOP_Z + (j / K) * (HOOD_Z - WS_TOP_Z), row = []; for (let k = 0; k <= M; k++) row.push(hoodPoint(z, k, M)); rows.push(row); }
  return grid(rows);
}

/** The canopy's glass: the windscreen's panes and the hood (the cockpit puts it in its own glass). */
export function canopyGlass(lod = false) {
  const ws = windscreen();
  return merge([quad(ws.fbl, ws.fbr, ws.ftr, ws.ftl), quad(ws.sbl, ws.fbl, ws.ftl, ws.stl), quad(ws.fbr, ws.sbr, ws.str, ws.ftr), hoodGeo(lod ? 8 : 20, lod ? 5 : 14)]);
}

/**
 * The canopy's frames as segments [a, b, size]: round the windscreen's panes, the hood's bows and its two
 * shoulder frames, the rails on the sills. (Rods outside; the cockpit makes them slim bars.)
 */
export function canopyFrameSegments() {
  const ws = windscreen(), f = [], M = 12;
  for (const [a, b] of [[ws.fbl, ws.ftl], [ws.fbr, ws.ftr], [ws.ftl, ws.ftr], [ws.fbl, ws.fbr], [ws.ftl, ws.stl], [ws.ftr, ws.str], [ws.sbl, ws.fbl], [ws.sbr, ws.fbr]]) f.push([a, b, 1]);
  for (const z of [WS_TOP_Z + 0.005, -0.08, HOOD_Z - 0.01]) for (let k = 0; k < M; k++) f.push([hoodPoint(z, k, M), hoodPoint(z, k + 1, M), z === -0.08 ? 0.6 : 1]);
  for (const k of [3, M - 3]) for (let j = 0; j < 8; j++) f.push([hoodPoint(WS_TOP_Z + (j / 8) * (HOOD_Z - WS_TOP_Z), k, M), hoodPoint(WS_TOP_Z + ((j + 1) / 8) * (HOOD_Z - WS_TOP_Z), k, M), 0.7]);
  for (const s of [-1, 1]) f.push([new V(s * 0.37, SILL + 0.01, WS_TOP_Z - 0.02), new V(s * 0.385, SILL + 0.01, HOOD_Z + 0.25), 1.1]); // the hood's rails on the sills
  return f;
}
const canopyFrames = () => merge(canopyFrameSegments().map(([a, b, k]) => tint(rod(a, b, 0.017 * k), 0x4b4a35)));

// ---------- materials

/** Paint the colour of a geometry into its vertex colours (the details share one material). */
function tint(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Merge into one geometry, keeping position and normal (and colour, when all have it). */
function merge(list) {
  const colour = list.every((g) => g.attributes.color);
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(colour && k === 'color')) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }));
}

// the aircraft of the 56th: squadron code (61st FS HV, 62nd LM, 63rd UN), its letter, the serial on the fin
// (the tail number: 42-xxxxx less its 4), and the insignia's surround (the old red, or the new blue)
const CODES = [['UN', 'M', '275855', 1], ['LM', 'S', '28487', 0], ['HV', 'A', '275510', 1], ['LM', 'Z', '28369', 0],
  ['HV', 'P', '22533', 1], ['UN', 'Z', '28461', 0], ['LM', 'C', '275237', 1], ['HV', 'D', '28405', 1]];
let CODE_TEX = null;
/** The codes and serials, white on black in rows of 128 px: [code | letter | serial]. Made once. */
function codeTex() {
  if (CODE_TEX) return CODE_TEX;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  CODES.forEach(([sq, l, ser], r) => {
    const y = r * 128 + 66;
    g.font = '700 124px "Arial Narrow", Arial, sans-serif';
    for (let k = 0; k < 2; k++) g.fillText(sq[k], 64 + k * 128, y, 104);
    g.fillText(l, 320, y, 104);
    g.font = '700 116px "Arial Narrow", Arial, sans-serif';
    for (let k = 0; k < ser.length; k++) g.fillText(ser[k], 384 + 53 + k * 106, y, 84);
  });
  CODE_TEX = new THREE.CanvasTexture(c);
  CODE_TEX.anisotropy = 4;
  return CODE_TEX;
}

const GLSL_SHAPE = `
  float wChord(float s) { return 2.84 * sqrt(max(0.0, 1.0 - pow(min(s / ${SEMI.toFixed(2)}, 1.0), 2.4))); }
  float wLE(float s) { return -1.25 + 0.04 * s - 0.25 * wChord(s); }
  float tChord(float s) { return 1.45 * sqrt(max(0.0, 1.0 - pow(min(s / 2.36, 1.0), 2.6))); }
  float fChord(float s) { return (1.95 - 0.5 * s) * sqrt(max(0.0, 1.0 - pow(clamp(s / 1.74, 0.0, 1.0), 5.0))); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  // a panel line d (m) from its centre, w half-wide, faded out when it's thinner than a pixel
  float line(float d, float w) { float f = fwidth(d) + 1e-5; return (1.0 - smoothstep(w - f, w + f, abs(d))) * clamp(w * 2.5 / f, 0.0, 1.0); }
  float box2(vec2 p, vec2 a, vec2 b, float w) { // a rectangle's outline (a door, a panel)
    if (p.x < a.x - w || p.x > b.x + w || p.y < a.y - w || p.y > b.y + w) return 0.0;
    return max(max(line(p.x - a.x, w), line(p.x - b.x, w)), max(line(p.y - a.y, w), line(p.y - b.y, w)));
  }
  // inside a five-pointed star of outer radius r, a point straight up
  bool star5(vec2 p, float r) {
    float seg = 1.2566371, a = abs(mod(atan(p.x, p.y) + seg * 0.5, seg) - seg * 0.5);
    vec2 q = length(p) * vec2(sin(a), cos(a)), o = vec2(0.0, r), e = 0.381966 * r * vec2(0.5878, 0.809) - o, w = q - o;
    return e.x * w.y - e.y * w.x <= 0.0;
  }
  // the star and bars of 1943: 0 nothing, 1 the surround, 2 the blue disc, 3 white
  float insignia(vec2 p, float r) {
    vec2 a = abs(p);
    float L = length(p), o = r * 0.125;
    if (L < r) return star5(p, r) ? 3.0 : 2.0;
    if (a.x < 2.0 * r && a.y < r * 0.25) return 3.0;
    if (L < r + o || (a.x < 2.0 * r + o && a.y < r * 0.25 + o)) return 1.0;
    return 0.0;
  }
`;

/**
 * The paint, the panel lines, the weathering and the markings, worked out per pixel from where it is on the
 * plane (object space). uCode picks the aircraft's row of codes; uBlue the insignia's new blue surround.
 */
function paint(m, code = 0) {
  const tex = codeTex();
  m.userData.code = code;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCodeTex = { value: tex };
    sh.uniforms.uCode = { value: code };
    sh.uniforms.uBlue = { value: CODES[code][3] };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; varying vec3 vObjN;
      uniform sampler2D uCodeTex; uniform float uCode; uniform float uBlue;
      float gloss = 0.0;
      ${GLSL_SHAPE}
      // a letter cell of the codes' atlas: col (in 128 px cells), cols wide, at local (u, v) in 0..1
      float codeAt(float col, float cols, vec2 uv) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
        return texture2D(uCodeTex, vec2((col + uv.x * cols) / 8.0, 1.0 - (uCode + 1.0) / 8.0 + uv.y / 8.0)).r;
      }`).replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 p = vObj, n = normalize(vObjN);
        vec3 od = vec3(0.075, 0.07, 0.034), grey = vec3(0.2, 0.205, 0.2), wht = vec3(0.72, 0.72, 0.69);
        float ax = abs(p.x);
        bool wing = ax > 0.6 && p.y < 0.05 && p.z > -2.3 && p.z < 1.1 && (ax > 0.78 || abs(n.y) > 0.6);
        bool tail = p.z > 4.3 && abs(p.y - ${TAIL_Y.toFixed(2)}) < 0.12 && (ax > 0.3 || (ax > 0.12 && abs(n.y) > 0.6));
        bool fin = p.z > 3.9 && ax < 0.11 && p.y > 0.74;
        bool body = !wing && !tail && !fin;
        // olive drab down the sides to the wing (a soft sprayed edge), neutral grey under it; the wings and
        // tail by which way they face
        float top = body ? smoothstep(-0.36, -0.22, p.y + 0.03 * sin(p.z * 2.3)) : smoothstep(-0.25, 0.1, n.y);
        if (fin) top = 1.0;
        // faded unevenly panel by panel in the sun, the grey less so; a little grime
        float fade = hash(floor(vec2(p.z * 1.6, p.x * 1.2 + p.y * 1.7)));
        vec3 c = mix(grey * (0.95 + 0.08 * fade), od * (0.88 + 0.26 * fade), top);
        c *= 0.92 + 0.12 * vnoise(p.xz * 3.0 + p.y * 2.0);
        float lines = 0.0;
        if (body) {
          vec2 q = vec2(p.z, p.y);
          for (int i = 0; i < 12; i++) { // the frames' joints round the fuselage
            float z = i == 0 ? -3.72 : i == 1 ? -3.2 : i == 2 ? ${FLAP0.toFixed(2)} : i == 3 ? ${FLAP1.toFixed(2)} : i == 4 ? -1.9 : i == 5 ? -1.2 : i == 6 ? 0.47 : i == 7 ? 1.35 : i == 8 ? 2.05 : i == 9 ? 2.95 : i == 10 ? 3.85 : 4.7;
            lines = max(lines, line(p.z - z, 0.006));
          }
          if (p.z > -2.6 && p.z < 4.6) lines = max(lines, line(p.y - 0.36, 0.005)); // and along it
          if (p.z > -2.6 && p.z < 3.0) lines = max(lines, line(p.y + 0.6, 0.005));
          if (p.z < ${FLAP0.toFixed(2)}) { lines = max(lines, line(p.y - 0.42, 0.005)); lines = max(lines, line(p.y + 0.5, 0.005)); if (p.y > 0.55) lines = max(lines, line(p.x, 0.005)); }
          if (p.z > ${FLAP0.toFixed(2)} && p.z < ${FLAP1.toFixed(2)}) { float a = atan(p.y + 0.11, p.x) / 0.314159; lines = max(lines, line(fract(a + 0.5) - 0.5, 0.03)); } // the cowl flaps
          lines = max(lines, box2(vec2(p.z, p.y), vec2(-2.38, -0.56), vec2(-1.86, -0.2), 0.005)); // the intercooler doors
          if (p.y > 0.84 && p.z > 0.4) lines = max(lines, line(p.x, 0.004)); // the spine's seam
          lines *= 0.38;
          // the white band round the cowling's front
          if (p.z < -3.72) c = wht * (0.95 + 0.05 * fade);
          // exhaust soot: from the waste gates aft along the belly, from the oil coolers' shutters along the
          // lower sides, from the turbo's hood aft
          float soot = 0.0;
          for (int s = -1; s <= 1; s += 2) {
            float sx = float(s), dz = p.z + 1.95;
            if (dz > 0.0 && p.y < -0.6) soot = max(soot, (1.0 - smoothstep(0.08 + 0.05 * dz, 0.16 + 0.09 * dz, abs(p.x - sx * 0.3))) * exp(-dz * 0.55));
            float dz2 = p.z + 2.62;
            if (dz2 > 0.0 && sx * p.x > 0.0) soot = max(soot, (1.0 - smoothstep(0.06, 0.12 + 0.05 * dz2, abs(p.y + 0.74 - 0.06 * dz2))) * exp(-dz2 * 0.9) * 0.8);
          }
          if (p.z > 2.05 && p.y < -0.5) soot = max(soot, (1.0 - smoothstep(0.1 + 0.04 * (p.z - 2.05), 0.2 + 0.08 * (p.z - 2.05), ax)) * exp(-(p.z - 2.05) * 0.7));
          soot *= 0.55 + 0.45 * vnoise(vec2(p.x * 38.0, p.z * 2.0));
          c = mix(c, vec3(0.022, 0.019, 0.016), clamp(soot, 0.0, 0.85));
          // the fixed windows in the spine behind the hood
          float st = 1.36 - 0.135 * (p.z - 0.4);
          if (p.z > 0.47 && p.y > 0.98 + 0.32 * (p.z - 0.47) && p.y < st - 0.06 && ax > 0.03) { c = vec3(0.012, 0.016, 0.02) + 0.03 * vec3(n.y + 0.5); gloss = 1.0; }
        }
        if (wing) {
          float s = ax, fr = (p.z - wLE(s)) / max(wChord(s), 0.01);
          bool topS = n.y > 0.0;
          for (int i = 0; i < 3; i++) lines = max(lines, line(fr - (i == 0 ? 0.07 : i == 1 ? 0.3 : 0.6), 0.004 / max(wChord(s), 0.3)));
          if (s > 0.75 && s < 5.85) lines = max(lines, line(fr - (s < 3.85 ? 0.74 : 0.76), 0.006 / max(wChord(s), 0.3))); // the flaps' and ailerons' hinges
          if (fr > 0.72) { lines = max(lines, line(s - 3.85, 0.006)); lines = max(lines, line(s - 5.85, 0.006)); if (s > 4.6 && s < 5.1) lines = max(lines, line(fr - 0.9, 0.003)); } // (and a trim tab)
          lines = max(lines, line(fract(s / 0.42 + 0.5) - 0.5, 0.012) * 0.35); // the ribs, faintly
          if (topS) { lines = max(lines, box2(vec2(s, fr), vec2(2.35, 0.06), vec2(3.6, 0.3), 0.004)); lines = max(lines, box2(vec2(s, fr), vec2(3.6, 0.07), vec2(4.45, 0.3), 0.004)); } // gun bay and ammunition doors
          else lines = max(lines, box2(vec2(s, fr), vec2(0.72, 0.12), vec2(2.25, 0.6), 0.003)); // the main wheel doors
          lines *= 0.4;
          // the paint worn through at the wing root, where the pilot climbed in, and along the leading edges
          float chip = vnoise(p.xz * 46.0) * vnoise(p.xz * 9.0 + 3.1);
          if (topS && s < 1.45 && fr > 0.15 && fr < 0.75 && p.x < 0.0) c = mix(c, vec3(0.2, 0.2, 0.19), smoothstep(0.62, 0.66, chip) * 0.5);
          if (fr < 0.03) c = mix(c, vec3(0.24, 0.245, 0.25), smoothstep(0.6, 0.66, chip) * 0.6);
          // the star and bars: over the left wing and under the right, the star's point forward
          if ((p.x < -2.0 && topS) || (p.x > 2.0 && !topS)) { float k = insignia(vec2(s - 4.3, -(p.z + 1.04)), 0.5); if (k > 0.5) c = k > 2.5 ? wht : k > 1.5 ? vec3(0.012, 0.018, 0.06) : (uBlue > 0.5 ? vec3(0.012, 0.018, 0.06) : vec3(0.3, 0.012, 0.012)); }
        }
        if (tail) {
          float s = ax, fr = (p.z - (5.0 + 0.05 * s - 0.25 * tChord(s))) / max(tChord(s), 0.01);
          lines = max(lines, line(fr - 0.66, 0.004)) * 0.5;
          if (s > 1.25 && s < 1.63) c = wht; // the white band across the tailplanes, top and bottom
        }
        if (fin) {
          float s = p.y - ${FIN_Y.toFixed(2)}, fr = 1.0 - (${'6.17'} - 0.03 * s - p.z) / max(fChord(s), 0.01);
          lines = max(lines, line(fr - 0.62, 0.004)) * 0.5;
          if (p.y > 1.3 && p.y < 1.6) c = wht; // and across the fin and the rudder
          // the serial, yellow, on both sides under it
          float ser = codeAt(3.0, 5.0, vec2(p.x > 0.0 ? (6.02 - p.z) / 1.25 : (p.z - 4.77) / 1.25, (p.y - 0.98) / 0.2));
          c = mix(c, vec3(0.55, 0.36, 0.0), smoothstep(0.35, 0.6, ser));
        }
        // on the fuselage: the star and bars, the squadron's code ahead of it and the aircraft's letter behind
        // (read nose-first on both sides), in white
        if (body && abs(n.x) > 0.3 && p.z > 0.4 && p.z < 3.8) {
          float k = insignia(vec2(p.z - 2.3, p.y - 0.06), 0.36);
          if (k > 0.5) c = k > 2.5 ? wht : k > 1.5 ? vec3(0.012, 0.018, 0.06) : (uBlue > 0.5 ? vec3(0.012, 0.018, 0.06) : vec3(0.3, 0.012, 0.012));
          float zc = p.x < 0.0 ? (p.z - 0.62) / 0.84 : (1.46 - p.z) / 0.84, zl = p.x < 0.0 ? (p.z - 3.12) / 0.42 : (3.54 - p.z) / 0.42;
          float t = max(codeAt(0.0, 2.0, vec2(zc, (p.y + 0.18) / 0.5)), codeAt(2.0, 1.0, vec2(zl, (p.y + 0.18) / 0.5)));
          c = mix(c, wht * 0.92, smoothstep(0.35, 0.6, t));
        }
        c *= 1.0 - 0.6 * lines;
        diffuseColor.rgb = c;
      }`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, gloss);');
    m.userData.shader = sh;
  };
  m.customProgramCacheKey = () => 'p47-paint';
  // each aircraft its own copy of the paint (its own codes): made the first time it's drawn, the same program
  m.onBeforeRender = (r, sc, cam, geo, obj) => {
    if (obj.userData.ownPaint || obj.isInstancedMesh) return;
    obj.userData.ownPaint = true;
    obj.material = paint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: m.roughness, metalness: m.metalness }), (nextCode++) % CODES.length);
  };
  return m;
}
let nextCode = 1;

/** The Curtiss blades: black, with the yellow tips that warned the ground crew of them. */
function bladePaint(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = length(vObj.xy) > ${(PROP_R - 0.11).toFixed(3)} ? vec3(0.75, 0.48, 0.02) : vec3(0.014);`);
  };
  m.customProgramCacheKey = () => 'p47-blade';
  return m;
}

// ---------- the parts

/** One Curtiss Electric "toothpick" blade along +y: a round shank, then a narrow, thin, twisted blade with a rounded tip. */
function bladeGeo(lod) {
  const pts = [[0, 0.3], [0.1, 0.36], [0.115, 0.6], [0.11, 1.1], [0.095, 1.5], [0.07, 1.74], [0.035, PROP_R - 0.005]];
  const outline = [...pts.map(([w, y]) => [w * 1.1, y]), ...pts.slice().reverse().map(([w, y]) => [-w * 0.9, y])];
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.03, bevelEnabled: !lod, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 4, steps: 1 });
  g.translate(0, 0, -0.015);
  // the twist: steep at the root, flatter towards the tip
  const p = g.attributes.position, v = new V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = 0.95 - 0.55 * THREE.MathUtils.clamp((v.y - 0.3) / 1.5, 0, 1), c = Math.cos(a), s = Math.sin(a);
    p.setXYZ(i, v.x * c - v.z * s, v.y, v.x * s + v.z * c);
  }
  g.computeVertexNormals();
  const shank = new THREE.CylinderGeometry(0.06, 0.07, 0.24, lod ? 6 : 12).translate(0, 0.27, 0);
  return merge([g, shank]);
}

/** The R-2800's face in the cowling's mouth, and the intake under it (vertex-coloured, for the detail mesh). */
function engineFace(lod, seg) {
  const out = [], dark = 0x0b0b0b, steel = 0x2c2d2e, black = 0x111111;
  // the mouth: the cowling's lip rolled in, a dark duct back to the engine
  const ring = (z, k) => { const r = []; for (let i = 0; i <= seg; i++) { const p = fusePoint(-4.33, -Math.PI / 2 + (i / seg) * Math.PI * 2); r.push(new V(p.x * k, (p.y + 0.11) * k - 0.11, z)); } return r; };
  out.push(tint(grid([ring(-4.33, 1), ring(-4.3, 0.93)]), 0xb8b8b2)); // (white, with the band)
  out.push(tint(grid([ring(-4.3, 0.93), ring(-4.05, 0.87)]), dark));
  // the back of the mouth, and the lip across it over the intake
  out.push(tint(new THREE.CircleGeometry(1, seg).scale(0.66, 0.9, 1).rotateY(Math.PI).translate(0, -0.11, -4.03), dark));
  out.push(tint(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 10, 1).rotateZ(Math.PI / 2).scale(1, 0.8, 1.6).translate(0, -0.45, -4.27), 0x8e8e88));
  if (lod) return out;
  // the intake's splitters (the oil coolers' ducts either side, the turbo's air in the middle)
  for (const s of [-1, 1]) out.push(tint(new THREE.BoxGeometry(0.025, 0.4, 0.3).translate(s * 0.19, -0.7, -4.12), 0x2e2e2a));
  // the engine: the front row of nine cylinders with their heads, the rear row's between, the gear case, the ignition ring
  for (let k = 0; k < 18; k++) {
    const front = k % 2 === 0, a = (k / 18) * Math.PI * 2, r = 0.37, x = Math.sin(a), y = Math.cos(a), z = front ? -4.16 : -4.08;
    const cyl = new THREE.CylinderGeometry(0.075, 0.075, 0.24, 10).rotateZ(-a).translate(x * r, 0.05 + y * r, z);
    out.push(tint(cyl, front ? steel : 0x1c1d1e));
    for (let f = 0; f < 4 && front; f++) out.push(tint(new THREE.TorusGeometry(0.083, 0.008, 4, 12).rotateX(Math.PI / 2).rotateZ(-a).translate(x * (r - 0.08 + f * 0.05), 0.05 + y * (r - 0.08 + f * 0.05), z), black)); // its fins
    if (front) out.push(tint(new THREE.BoxGeometry(0.1, 0.07, 0.12).rotateZ(-a).translate(x * (r + 0.13), 0.05 + y * (r + 0.13), z + 0.01), 0x3a3b3c)); // the rocker boxes
    if (front) out.push(tint(rod(new V(x * 0.2, 0.05 + y * 0.2, -4.18), new V(x * (r + 0.1), 0.05 + y * (r + 0.1), -4.2), 0.012, 5), 0x6a6a64)); // the push rods
  }
  out.push(tint(new THREE.TorusGeometry(0.28, 0.012, 5, 30).translate(0, 0.05, -4.21), 0x7a6a40)); // the ignition harness
  out.push(tint(new THREE.SphereGeometry(0.27, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.55).translate(0, 0.05, -4.2), 0x3a3b3c)); // the reduction gear's case
  for (const s of [-1, 1]) out.push(tint(new THREE.BoxGeometry(0.09, 0.1, 0.11).translate(s * 0.13, 0.25, -4.3), 0x1e1e1e)); // the magnetos
  out.push(tint(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10).rotateX(Math.PI / 2).translate(0, 0.27, -4.32), 0x2a2a2a)); // the governor
  return out;
}

/** Under and round the fuselage: doors, shutters, the waste gates, the turbo's exhaust hood (in the paint, plus dark and steel details). */
function bellyParts() {
  const paintParts = [], detail = [];
  for (const s of [-1, 1]) {
    // the intercooler's exit doors, standing a little open
    const door = new THREE.BoxGeometry(0.02, 0.36, 0.5).translate(0, 0, 0.25).rotateY(s * 0.18).translate(s * fuse(-2.38)[0] * 0.97, -0.38, -2.38);
    paintParts.push(door);
    detail.push(tint(new THREE.BoxGeometry(0.01, 0.34, 0.4).translate(s * (fuse(-2.1)[0] - 0.01), -0.38, -2.12), 0x080808)); // (the dark gap behind it)
    // the oil coolers' shutters under the cowling's back edge
    const sh = new THREE.BoxGeometry(0.32, 0.015, 0.22).translate(0, 0, 0.11).rotateX(0.25).rotateZ(s * 0.5).translate(s * 0.42, skinY(-2.66, 0.42, false), -2.66);
    paintParts.push(sh);
    // the waste gates: a short pipe out of the belly under the wing's root, blackened
    const wy = skinY(-1.92, 0.3, false);
    detail.push(tint(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 10).rotateX(Math.PI / 2 - 0.25).translate(s * 0.3, wy - 0.02, -1.92), 0x2a2420));
    detail.push(tint(new THREE.CircleGeometry(0.05, 10).rotateX(-0.25).translate(s * 0.3, wy - 0.045, -1.82), 0x050505));
  }
  // the turbo's exhaust hood: a stainless shroud on the belly behind the wing, its outlet dark
  detail.push(tint(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.2, 0.12, 0.34).translate(0, fuse(1.8)[3] + 0.04, 1.8), 0x8d8c86));
  detail.push(tint(new THREE.BoxGeometry(0.34, 0.01, 0.5).translate(0, fuse(2.3)[3] + 0.005, 2.3), 0x77756e));
  detail.push(tint(new THREE.CircleGeometry(0.07, 10).translate(0, fuse(1.8)[3] - 0.03, 2.1), 0x050505));
  // the tail wheel's doors and the main wheels' wells' doors are panel lines in the paint; the landing light under the left wing
  detail.push(tint(new THREE.CircleGeometry(0.09, 12).rotateX(Math.PI / 2).translate(-4.1, wingY(4.1) - 0.1, -0.85), 0xb8c0c4));
  return { paintParts, detail };
}

/** The pilot and his cockpit seen through the glass: leather helmet, the oxygen mask, shoulders, the armour and headrest behind him. */
function pilotParts() {
  const p = [];
  p.push(tint(new THREE.BoxGeometry(0.66, 0.02, 1.2).translate(0, 0.5, -0.2), 0x1a1f16)); // (the dark well of the cockpit)
  for (const s of [-1, 1]) p.push(tint(new THREE.BoxGeometry(0.02, 0.3, 1.25).translate(s * 0.33, 0.66, -0.2), 0x37432e)); // its walls, dull dark green
  p.push(tint(new THREE.BoxGeometry(0.66, 0.1, 0.12).translate(0, 0.82, -0.72), 0x161616)); // the coaming over the panel
  p.push(tint(new THREE.BoxGeometry(0.08, 0.1, 0.13).translate(0, 0.92, -0.6), 0x161616)); // the gunsight
  p.push(tint(new THREE.SphereGeometry(0.105, 14, 10).scale(0.95, 1.05, 1.05).translate(0, 1.08, -0.13), 0x4a3020)); // the helmet
  p.push(tint(new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI).rotateZ(Math.PI).rotateX(-0.2).translate(0, 1.13, -0.16), 0x2a2a28)); // the goggles up on it
  p.push(tint(new THREE.SphereGeometry(0.05, 10, 6).scale(1, 1, 0.8).translate(0, 1.02, -0.22), 0x34392c)); // the oxygen mask
  p.push(tint(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10).rotateZ(Math.PI / 2).translate(0, 0.88, -0.08), 0x5a5040)); // the shoulders
  p.push(tint(new THREE.BoxGeometry(0.4, 0.42, 0.03).translate(0, 0.98, 0.14), 0x2c2e2c)); // the head armour
  p.push(tint(new THREE.BoxGeometry(0.2, 0.12, 0.06).translate(0, 1.1, 0.1), 0x3a2a1e)); // the headrest
  return p;
}

/** Where each gun's muzzle is, [x, y, z], left wing's four then the right's, inboard to outboard. */
export function p47Muzzles() {
  const out = [];
  // staggered: each gun a little further back than the one inboard of it, so the belts could feed side by side
  for (const s of [-1, 1]) P47_GUN_X.forEach((x, k) => out.push([s * x, wingY(x) - 0.03, leadingEdge(x) - 0.42 + k * 0.08]));
  return out;
}

/**
 * The whole aeroplane. lod: the low-detail copy for far away (fewer sections; the skin, the dark front, the
 * glass and the propeller's disc only). Named parts: 'P47_Blades' (the propeller), 'P47_Spinner' (its hub),
 * 'Fake_Blades' (the blur disc), as the game spins them; 'P47_Body' (the painted skin and frames),
 * 'P47_Detail', 'P47_Frames', 'P47_Pilot' and 'P47_Canopy' (the glass; the cockpit view leaves the last three out).
 */
export function buildP47({ lod = false } = {}) {
  const root = new THREE.Group();
  root.name = 'P47';
  const skin = paint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.05 }));
  const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
  const seg = lod ? 14 : 44;
  const body = [fuselageGeo(seg, lod ? 0.45 : 0.11), spineGeo(lod ? 6 : 16, lod ? 4 : 14)];
  body.push(new THREE.CircleGeometry(1, lod ? 8 : 20, 0, Math.PI).rotateY(Math.PI).scale(SPINE[0][1], SPINE[0][2] - SPINE_Y, 1).translate(0, SPINE_Y, SPINE[0][0])); // (the spine's front, behind the hood)
  body.push(wingGeo(1, lod), wingGeo(-1, lod), tailGeo(1, lod), tailGeo(-1, lod), finGeo(lod));
  const detail = engineFace(lod, seg);
  if (!lod) {
    const b = bellyParts();
    body.push(...b.paintParts);
    detail.push(...b.detail);
    // the guns: four .50s out of each wing's leading edge, staggered, each in its blast tube
    for (const [x, y, z] of p47Muzzles()) {
      detail.push(tint(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 8).rotateX(Math.PI / 2).translate(x, y, z + 0.37), 0x1a1a1a));
      detail.push(tint(new THREE.CylinderGeometry(0.028, 0.032, 0.22, 10).rotateX(Math.PI / 2).translate(x, y, leadingEdge(Math.abs(x)) + 0.02), 0x1e1e1c));
    }
    // the pitot tube under the left wing's tip, the navigation lights, the aerial mast and its wire to the fin
    detail.push(tint(rod(new V(-5.3, wingY(5.3) - 0.08, leadingEdge(5.3) + 0.25), new V(-5.3, wingY(5.3) - 0.08, leadingEdge(5.3) - 0.35), 0.01), 0x9a9a96));
    detail.push(tint(new THREE.SphereGeometry(0.035, 8, 6).translate(-SEMI + 0.03, wingY(SEMI), wQuarter(SEMI) - 0.05), 0xff2010));
    detail.push(tint(new THREE.SphereGeometry(0.035, 8, 6).translate(SEMI - 0.03, wingY(SEMI), wQuarter(SEMI) - 0.05), 0x10ff40));
    detail.push(tint(rod(new V(0, 1.22, 1.05), new V(0, 1.62, 1.3), 0.018, 6, 0.008), 0x3a3a2a));
    detail.push(tint(rod(new V(0, 1.6, 1.3), new V(0, FIN_Y + 1.66, 5.85), 0.004, 3), 0x111111));
    // the rear-view mirror on top of the windscreen's bow
    detail.push(tint(new THREE.BoxGeometry(0.012, 0.05, 0.012).translate(0, 1.27, WS_TOP_Z + 0.02), 0x3a3a2a));
    detail.push(tint(new THREE.BoxGeometry(0.11, 0.035, 0.012).rotateX(0.25).translate(0, 1.31, WS_TOP_Z + 0.02), 0x3a3a2a));
  }
  const bodyMesh = new THREE.Mesh(merge(body), skin);
  bodyMesh.name = 'P47_Body';
  root.add(bodyMesh);
  const detailMesh = new THREE.Mesh(merge(detail), detailMat);
  detailMesh.name = 'P47_Detail';
  root.add(detailMesh);
  if (!lod) { // the canopy's frames, olive drab (the cockpit has its own, slimmer as seen from the seat)
    const frames = new THREE.Mesh(canopyFrames(), detailMat);
    frames.name = 'P47_Frames';
    root.add(frames);
  }
  // the pilot in his cockpit (or, far away, just its dark opening)
  const pilot = new THREE.Mesh(merge(lod ? [tint(new THREE.BoxGeometry(0.66, 0.02, 1.2).translate(0, 0.78, -0.2), 0x111111)] : pilotParts()), lod ? new THREE.MeshBasicMaterial({ color: 0x0a0a0a }) : detailMat);
  pilot.name = 'P47_Pilot';
  root.add(pilot);
  // the Curtiss Electric's hub, and its four blades
  const spinner = new THREE.Mesh(merge([new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10).rotateX(Math.PI / 2).translate(0, 0, -4.38), new THREE.CylinderGeometry(0.2, 0.22, 0.2, lod ? 8 : 20).rotateX(Math.PI / 2).translate(0, 0, PROP_Z + 0.02), new THREE.SphereGeometry(0.2, lod ? 8 : 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.9).translate(0, 0, PROP_Z - 0.08)]),
    new THREE.MeshStandardMaterial({ color: 0x24251f, roughness: 0.45, metalness: 0.5 }));
  spinner.name = 'P47_Spinner';
  root.add(spinner);
  const blades = new THREE.Group();
  blades.name = 'P47_Blades';
  blades.position.set(0, 0, PROP_Z);
  if (!lod) { // (far away it's only ever the blur)
    const bg = bladeGeo(lod), all = [];
    for (let k = 0; k < 4; k++) all.push(bg.clone().rotateZ((k / 4) * Math.PI * 2 + Math.PI / 4));
    blades.add(new THREE.Mesh(merge(all), bladePaint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }))));
  }
  root.add(blades);
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.2, PROP_R, 48, 1), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide }));
  disc.name = 'Fake_Blades';
  disc.position.set(0, 0, PROP_Z - 0.02);
  disc.visible = false;
  root.add(disc);
  const canopy = new THREE.Mesh(canopyGlass(lod), new THREE.MeshPhysicalMaterial({ color: 0xc8d8e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }));
  canopy.name = 'P47_Canopy';
  canopy.renderOrder = 2;
  root.add(canopy);
  root.traverse((o) => { if (o.isMesh) o.castShadow = !lod && o !== disc && o !== canopy; });
  return root;
}
