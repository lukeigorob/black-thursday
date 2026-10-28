// The walkable inside of a B-17, lined up with the outer model.
// - Walls: the real hull mesh is drawn a second time from the inside with interior paint
//   (the outer skin is made front-face only), so windows and shapes match exactly.
// - The hull's cross-section is measured at load time; the player is kept inside it.
// - Floors, steps, bulkheads, seats and racks are box colliders (Box3) in bomber space.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windowCutout } from './models.js';
import { buildBallTurret } from './ballturret.js';
import { buildTopTurret } from './topturret.js';
import { addMoreDetail } from './interiordetail.js';
import { buildB17Cockpit } from './cockpitb17.js';
import { buildStations } from './stations.js';
import { wetGlass } from './environment.js';
import { hullPaint, insideLight, planks, leather, propWear } from './cabinlook.js';
import { SCARS, SCAR_MAX } from './scars.js';

const V = THREE.Vector3, D = Math.PI / 180;
const HULL = /^(MainFuselage2|Nose|Tail|TailGunPod|SideGunPanels|FrontGunPanels|TopTurret)$/;

// Floors (bomber space, nose towards -Z), measured from the hull cross-sections.
export const DECKS = [
  { name: 'Nose', z0: -10.9, z1: -8.6, y: -0.72, hw: 0.9 }, // right up to the nose glass
  { name: 'Cockpit', z0: -8.6, z1: -6.35, y: -0.40, hw: 1.0 },
  { name: 'Bomb bay', z0: -5.6, z1: -2.6, y: -1.62, hw: 0.13 }, // the narrow catwalk
  { name: 'Radio room', z0: -2.6, z1: -1.25, y: -1.80, hw: 0.9 },
  { name: 'Waist', z0: -1.25, z1: 5.2, y: -1.95, hw: 0.9 }, // starts with the ball turret well
  { name: 'Tail', z0: 5.2, z1: 8.2, y: -2.15, hw: 0.6 },
  { name: 'Tail gun', z0: 8.2, z1: 10.25, y: -2.32, hw: 0.5 },
];
const STEPS = [ // from the flight deck down into the bomb bay
  { z0: -6.35, z1: -6.1, y: -0.72 }, { z0: -6.1, z1: -5.85, y: -1.02 }, { z0: -5.85, z1: -5.6, y: -1.32 },
];
const TURRET_CUT = { z: -6.71, y: 0.9, r: 0.5, ring: 1.14 }; // the hole in the cockpit roof up into the top turret

/** Discard everything of a mesh below bomber-space height y (offsetY = the mesh's own height). */
function cutBelow(m, offsetY, y) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      varying float vCutY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vCutY = position.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vCutY;`)
      .replace('void main() {', `void main() {
        if (vCutY + ${offsetY.toFixed(3)} < ${y.toFixed(3)}) discard;`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cut${y}`;
}
/**
 * The tail gunner's cab replaces the model's skin aft of CAB.z0 under the fin (its window cut-outs had
 * ragged edges, and a broad strip of metal between them filled the middle of his view): discard the
 * skin there. Below the fin root as far as the step down to the gun pod, then below the pod's top.
 */
const CAB = { z0: 9.55, step: 10.3, podTop: -1.4 };
const cabCut = (z) => (z < CAB.step - 0.02 ? -1.17 - 0.2 * (z - 9.3) : CAB.podTop); // just over the fin root
function cutTailCab(m, offset) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vCabP;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      vCabP = position + vec3(${offset.x.toFixed(4)}, ${offset.y.toFixed(4)}, ${offset.z.toFixed(4)});`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vCabP;`).replace('void main() {', `void main() {
        if (vCabP.z > ${CAB.z0.toFixed(3)} && vCabP.y < (vCabP.z < ${(CAB.step - 0.02).toFixed(3)} ? -1.17 - 0.2 * (vCabP.z - 9.3) : ${CAB.podTop.toFixed(3)})) discard;`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cab`;
}
// the radio room's gun hatch: the opening in the roof over the room (bomber space), the gun's mount
// at its forward end, the slipstream deflector ahead of it
export const RADIO_HATCH = { x: 0.44, z0: -2.32, z1: -0.98, y: 0.15 };
/** Cut the radio room's gun hatch out of a hull material (its skin or its lining): you see the sky through it. */
function cutRadioHatch(m, offset) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m), h = RADIO_HATCH;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vRadP;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      vRadP = position + vec3(${offset.x.toFixed(4)}, ${offset.y.toFixed(4)}, ${offset.z.toFixed(4)});`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vRadP;`).replace('void main() {', `void main() {
        if (vRadP.y > ${h.y.toFixed(2)} && abs(vRadP.x) < ${h.x.toFixed(2)} && vRadP.z > ${h.z0.toFixed(2)} && vRadP.z < ${h.z1.toFixed(2)}) discard;`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|radiohatch`;
}
const ROOF = 1.12; // m: just under the top of the fuselage at the cockpit (the turret dome rises above it)
// the crawlway from the flight deck to the nose: down through the hatch in the floor between the
// pilots' seats, forward on hands and knees under the flight deck, out under the instrument panel.
// `hatch` / `mouth` = where you start the crawl from (x, z), `path` = the way through for the eye
export const CRAWLWAY = {
  hatch: { x0: -0.2, x1: 0.2, z0: -7.82, z1: -7.38 }, tunnel: { x: 0.32, y0: -1.02, y1: -0.43, z0: -8.66, z1: -7.36 },
  down: { from: [0, -7.55], reach: 0.7, floor: -0.40, to: [0, -0.72, -9.2], yaw: 0, time: 3.8, name: 'Crawl down to the nose',
    path: [[0, -0.05, -7.5], [0, -0.55, -7.6], [0, -0.72, -7.95], [0, -0.74, -8.45], [0, -0.55, -8.8]] },
  up: { from: [0, -8.95], reach: 0.7, floor: -0.72, to: [0, -0.40, -7.18], yaw: Math.PI, time: 3.8, name: 'Crawl up to the flight deck',
    path: [[0, -0.42, -8.82], [0, -0.74, -8.45], [0, -0.72, -7.95], [0, -0.55, -7.6], [0, -0.05, -7.5]] },
};

// the tail: shut off from the waist by a bulkhead with a low opening in it (the tail wheel's well
// behind it), and back from there on hands and knees down the narrowing fuselage to the tail gun
export const TAILWAY = {
  z: 5.15, mouth: { x: 0.26, y0: -1.95, y1: -1.45 },
  // (down on your knees before the opening, under it, and on along the narrowing tail into the gunner's
  // seat: the crawl ends at the gun's eye, player.js startCrawl, so you never stand up under the tail's roof)
  aft: { from: [0, 4.85], floor: -1.95, to: [0, -2.32, 9.6], yaw: Math.PI, time: 5.6, name: 'Crawl back to the tail gun', station: 'tail',
    path: [[0, -0.8, 4.88], [0, -1.3, 4.93], [0, -1.6, 5.05], [0, -1.68, 5.35], [0, -1.85, 6.2], [0, -1.88, 7.2], [0, -1.95, 8.2], [0, -2.0, 8.9]] },
  // (out through the opening low, and up once your head's clear of it, slowing as you straighten: only part
  // way, the roof's low at the waist's after end; walking on forward you straighten the rest)
  fwd: { from: [0, 9.1], floor: -2.32, to: [0, -1.95, 4.25], yaw: 0, time: 5.2, name: 'Crawl forward to the waist',
    path: [[0, -1.95, 8.9], [0, -1.95, 8.2], [0, -1.88, 7.2], [0, -1.85, 6.2], [0, -1.68, 5.35], [0, -1.62, 5.0], [0, -1.38, 4.8], [0, -1.08, 4.55]] },
  // (and from anywhere along the tail, up at the bulkhead: back through its opening to the waist)
  back: { from: [0, 5.55], reach: 0.6, floor: -2.15, to: [0, -1.95, 4.25], yaw: 0, time: 3.0, name: 'Crawl forward through to the waist',
    path: [[0, -1.85, 5.45], [0, -1.7, 5.28], [0, -1.62, 5.0], [0, -1.38, 4.8], [0, -1.08, 4.55]] },
};
/** The lowest a turret may aim at yaw (radians off its station's direction): its floor ahead, else its own limit. */
export function turretFloor(s, yawRel) {
  if (!s.floor) return s.pitch[0];
  const a = Math.abs(Math.atan2(Math.sin(yawRel), Math.cos(yawRel))), cone = s.floor[0] * Math.PI / 180, k = a < cone * 0.75 ? 1 : a > cone ? 0 : (cone - a) / (cone * 0.25);
  return s.pitch[0] + (s.floor[1] * Math.PI / 180 - s.pitch[0]) * k;
}
export const PASSAGES = [CRAWLWAY.down, CRAWLWAY.up, TAILWAY.aft, TAILWAY.fwd, TAILWAY.back];

const BULKHEADS = [ // door: [x0, x1, height above floor]
  { z: -6.35, floor: -0.40, door: [-0.32, 0.32, 1.45] },
  { z: -2.6, floor: -1.62, door: [-0.3, 0.3, 1.75] },
  { z: -1.25, floor: -1.80, door: [-0.32, 0.32, 1.65] },
];

/**
 * A point fixed to a turret aimed at (yaw, pitch), bomber space: `at` = [right, up, forward] metres from
 * its pivot in the turret's own frame. (The guns of the ball and upper turrets, and the ball gunner's eye.)
 */
export function turretPoint(pivot, yaw, pitch, [r, u, f], out = new THREE.Vector3()) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  return out.set(pivot[0] + cy * r + sy * sp * u - sy * cp * f, pivot[1] + cp * u + sp * f, pivot[2] - sy * r + cy * sp * u - cy * cp * f);
}

// Crew positions. stand = where you press E, eye = view at the position,
// yaw: 0 = forward (-Z), 90 = left, 180 = backwards. guns = node names in b17.glb.
// pivot = what the guns turn about (default: their breech); turret = parts that turn with them.
// twin = a turret's pair of Brownings laid out in its own frame: [out to each side, up, jacket start,
// muzzle, receiver length] (m from the pivot); eyeTurret = the gunner's eye fixed in the turret too.
export const STATIONS = [
  // the B-17F's nose guns: two hand-held Brownings out through ball sockets in the nose glass, side by
  // side at the same height, left and right of the Norden (the right one the bombardier's). socket = no
  // gun in the model: the gun is built on the ball (pivot) pointing `rest`, its receiver inside, `front`
  // m of jacket out through it
  { id: 'noseL', name: 'Nose gun, left', stand: [-0.24, -0.72, -9.82], eye: [-0.28, 0.32, -10.5], yaw: 8, yawLim: 25, pitch: [-18, 28], guns: [], socket: true,
    ball: true, pivot: [-0.28, 0.1, -11.29], rest: [-0.1392, 0, -0.9903], browning: 'flex', front: 0.9, gunRear: 0.55, eyeBehind: 0.82, eyeUp: 0.22 },
  { id: 'noseR', name: 'Nose gun, right', stand: [0.24, -0.72, -9.82], eye: [0.28, 0.32, -10.5], yaw: -8, yawLim: 25, pitch: [-18, 28], guns: [], socket: true,
    ball: true, pivot: [0.28, 0.1, -11.29], rest: [0.1392, 0, -0.9903], browning: 'flex', front: 0.9, gunRear: 0.55, eyeBehind: 0.82, eyeUp: 0.22 },
  // the radio room gun: a flexible Browning on its mount at the forward end of the hatch in the roof,
  // firing up and aft (finCut: [yaw, pitch] the fin and tailplane stand in: aimed within that yaw of
  // dead astern, no lower than that pitch). The radio operator mans it.
  { id: 'radio', name: 'Radio room gun', stand: [0.15, -1.8, -2.2], eye: [0, -0.1, -2.3], yaw: 180, yawLim: 45, pitch: [25, 85], guns: [], socket: true,
    pivot: [0, 0.32, -1.72], rest: [0, 0.7071, 0.7071], browning: 'flex', front: 0.9, gunRear: 0.4, eyeBehind: 0.62, eyeUp: 0.22, finCut: [15, 34] },
  // the Norden bombsight: a telescope looking down-ahead to where the bombs would land (no gun)
  { id: 'bombsight', name: 'Norden bombsight', stand: [0.32, -0.72, -9.82], eye: [0, -0.42, -11.05], yaw: 0, yawLim: 4, pitch: [-4, 4], sight: true,
    hide: ['FrontGunPanels', 'NoseCone', 'NoseFlat'] }, // looks down through the flat panel in the nose bottom (a telescope: no glass in its view)
  // the cheek guns: a flexible Browning in each nose window on its own mount, as the waist guns are
  { id: 'cheekL', name: 'Left cheek gun', stand: [-0.35, -0.72, -9.45], eye: [-0.55, 0.1, -10.0], yaw: 70, yawLim: 35, pitch: [-35, 30], guns: ['GunBarrel16'], ghost: ['FrontGunPanels'],
    browning: 'flex', gunRear: 0.08, eyeBehind: 0.3, eyeUp: 0.2, roundArc: true },
  { id: 'cheekR', name: 'Right cheek gun', stand: [0.35, -0.72, -9.45], eye: [0.55, 0.1, -10.0], yaw: -70, yawLim: 35, pitch: [-35, 30], guns: ['GunBarrel002'], ghost: ['FrontGunPanels'],
    browning: 'flex', gunRear: 0.08, eyeBehind: 0.3, eyeUp: 0.2, roundArc: true },
  { id: 'pilot', name: 'Pilot seat', stand: [-0.18, -0.40, -7.2], eye: [-0.55, 0.88, -7.72], yaw: 0, yawLim: 120, pitch: [-40, 40], seat: true, flies: true },
  { id: 'copilot', name: 'Co-pilot seat', stand: [0.18, -0.40, -7.2], eye: [0.55, 0.88, -7.72], yaw: 0, yawLim: 120, pitch: [-40, 40], seat: true, flies: true },
  { id: 'top', name: 'Top turret', stand: [0, -0.28, -6.78], eye: [0, 1.4, -6.71], yaw: 0, yawLim: 180, pitch: [-5, 85], guns: ['TopGuns'], floor: [55, 9], // (forward of the beam its guns can't come down into the cockpit roof: no lower than 9 degrees within 55 of dead ahead)
    entry: { time: 0.8, path: [[0, 0.85, -6.85]], bob: 0.02, bobs: 1 }, // step up onto the platform, head up into the dome
    pivot: [0, 1.43, -6.71], turret: { yaw: ['TopTurret'] }, twin: [0.27, -0.07, 0.12, 0.81, 0.42], // (barrels shortened with the model's: models.js BARREL_K) either side of your head, as in the real one: the receivers by your temples, the barrels out through the dome's slots (topturret.js SLOT_X)
    hide: ['TopTurret'], attach: 'topCockpit' }, // inside, the model's dome is replaced by a glass one (topturret.js)
  { id: 'ball', name: 'Ball turret', stand: [0, -1.95, 0.6], eye: [0, -2.42, -0.1], yaw: 0, yawLim: 180, pitch: [-89, 0], guns: ['GunBarrel004', 'GunBarrel14'], // (down from the horizon: up there her belly fills the top of the window)
    entry: { time: 1.2, path: [[0, -1.05, 0.3], [0, -1.75, 0.08], [0, -2.25, -0.02]], bob: 0.015, bobs: 2 }, // kneel at the hatch, down into the ball
    pivot: [0, -2.3, -0.13], turret: { full: ['BallTurret'], yaw: ['BallStabilizer1'] }, // (the ball's own centre: it, its guns and its yoke all turn about it, bomber.js rigTurrets the same)
    // the two guns either side of you, out through the ball's sides; you curl up between them, your eye
    // at the window: it all turns and tilts together
    twin: [0.3, -0.15, 0.35, 1.45, 0.45], eyeTurret: [0, -0.17, 0.2], whine: true, // (the guns out through the front of the ball, your head between them at the window) // (the guns beside you, as the cockpit draws them: ballturret.js; turned by its motors: player.js drive) // (the guns outside the ball either side, level with your eye, as in the photos)
    // inside, the model's ball is replaced by a glass and steel one that turns with your aim (ballturret.js)
    hide: ['BallTurret', 'BallStabilizer1', 'BallTurretTracks', 'BallCap'], attach: 'ballCockpit' },
  // the waist guns: Brownings on their mounts, staggered as in the B-17G (the right gun forward, the
  // left aft, so the two gunners aren't back to back) and higher in the window than the model's
  { id: 'waistL', name: 'Left waist gun', stand: [-0.3, -1.95, 1.93], eye: [-0.9, -0.83, 1.93], yaw: 90, yawLim: 65, pitch: [-55, 50], guns: ['GunBarrel10'], hide: ['SideGunPanels'], eyeBehind: 0.32, eyeUp: 0.22, roundArc: true, // behind the gun, swinging round its mount with it
    browning: 'flex', gunRear: 0.08, mount: [0, 0.05, 0.12] },
  { id: 'waistR', name: 'Right waist gun', stand: [0.3, -1.95, 1.67], eye: [0.9, -0.81, 1.67], yaw: -90, yawLim: 65, pitch: [-55, 50], guns: ['GunBarrel005'], hide: ['SideGunPanels'], eyeBehind: 0.32, eyeUp: 0.22, roundArc: true,
    browning: 'flex', gunRear: 0.08, mount: [0, 0.05, -0.12] },
  { id: 'tail', name: 'Tail gun', stand: [0, -2.32, 9.6], eye: [0, -1.55, 10.1], lean: 0.05, duck: 0.3, // (up close behind the rear window: you see where the guns point, up too)
    yaw: 180, yawLim: 50, pitch: [-40, 35], roundArc: true, // (wider than the real one's: more fun; the corners cut off by the cab's frames)
    guns: ['GunBarrel007', 'GunBarrel12'], // (aimed with the plain crosshair, as the other guns are)
    entry: { time: 1.5, path: [[0, -1.5, 9.66], [0, -1.6, 9.82], [0, -1.58, 9.98]], bob: 0.035, bobs: 3 } }, // crawl back under the tail on your knees, up onto the seat (the cab: buildTailCab)
].map((s) => ({ ...s, stand: new V(...s.stand), eye: new V(...s.eye), yaw: s.yaw * D, yawLim: s.yawLim * D, pitch: [s.pitch[0] * D, s.pitch[1] * D] }));

// hull cross-section table: half-width of the cabin at (z, y), 10 cm x 5 cm cells
const T = { z0: -11.4, dz: 0.1, nz: 229, y0: -2.7, dy: 0.05, ny: 89 };

function measureHull(meshes, root) {
  const hw = new Float32Array(T.nz * T.ny).fill(Infinity);
  const inv = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(), a = new V(), b = new V(), c = new V(), cut = [];
  const edge = (p, q, z) => {
    if ((p.z <= z && q.z > z) || (q.z <= z && p.z > z)) {
      const t = (z - p.z) / (q.z - p.z);
      cut.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
    }
  };
  for (const mesh of meshes) {
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m);
      const k0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - T.z0) / T.dz));
      const k1 = Math.min(T.nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - T.z0) / T.dz));
      for (let k = k0; k <= k1; k++) {
        const z = T.z0 + k * T.dz;
        cut.length = 0;
        edge(a, b, z); edge(b, c, z); edge(c, a, z);
        if (cut.length < 4) continue;
        const [x1, y1, x2, y2] = cut;
        const r0 = Math.max(0, Math.ceil((Math.min(y1, y2) - T.y0) / T.dy));
        const r1 = Math.min(T.ny - 1, Math.floor((Math.max(y1, y2) - T.y0) / T.dy));
        for (let r = r0; r <= r1; r++) {
          const y = T.y0 + r * T.dy;
          const x = y1 === y2 ? Math.min(Math.abs(x1), Math.abs(x2)) : x1 + ((x2 - x1) * (y - y1)) / (y2 - y1);
          const j = k * T.ny + r;
          if (x >= 0 && x < hw[j]) hw[j] = x;
        }
      }
    }
  }
  for (let j = 0; j < hw.length; j++) if (!Number.isFinite(hw[j])) hw[j] = 0;
  return hw;
}

// ---------- materials ----------
// low envMapIntensity: the sky reflection must not light the cabin as if the hull weren't there
const std = (color, roughness = 0.8, metalness = 0.1) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.07 });
const MAT = {
  floor: planks(std(0x9a8a70, 0.85)), // wooden planks (cabinlook.js)
  metal: std(0x767a70, 0.55, 0.6),
  green: std(0x5d6640, 0.75),
  deck: std(0x45695f, 0.65, 0.15), // (the flight deck's bronze-green paint, as the lining's there: cabinlook.js)
  dark: std(0x232323, 0.6, 0.3),
  well: Object.assign(std(0x2a2b28, 0.7, 0.4), { side: THREE.DoubleSide }), // seen from below, from inside
  leather: leather(std(0x5b3b24, 0.7)),
  bomb: std(0x495031, 0.6, 0.2),
  bombBand: std(0xb8932c, 0.6), // only on the bombs, so the whole load can be hidden after the drop
  bombFuze: std(0x6f6a5e, 0.45, 0.7), // their fuzes, vanes and lugs (hidden with them)
  catwalk: std(0x8b9088, 0.5, 0.6), // the bare aluminium keel beam
  yellow: std(0xb8932c, 0.6),
  radio: std(0x3d3f38, 0.5, 0.4),
  ammo: std(0x4b5230, 0.7, 0.15), // olive drab ammunition boxes
  chute: std(0x4d5048, 0.6, 0.55), // flexible steel feed chutes
  hose: std(0x161616, 0.85, 0.0), // rubber oxygen hoses
  cable: std(0x2a2a28, 0.4, 0.8),
  red: std(0x8a1c14, 0.5, 0.2),
  pad: new THREE.MeshStandardMaterial({ map: quiltTexture(), roughness: 0.95, envMapIntensity: 0.05 }), // quilted insulation
  canvas: leather(std(0x6b5f47, 0.95)), // the tail guns' canvas boot
};

function liningMaterial(src, inverted, offset = new V()) {
  // interior paint, cut out where the outer skin has windows; worn: blotchy, scuffed through to
  // bare aluminium here and there (noise from the position, so no extra texture)
  const m = windowCutout(new THREE.MeshStandardMaterial({
    color: 0x6f7462, roughness: 0.75, metalness: 0.3, envMapIntensity: 0.08,
    side: inverted ? THREE.FrontSide : THREE.BackSide, map: src.map,
  }), false);
  const cutout = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    cutout(sh, r);
    // windows only: the paint's alpha is speckled, and a lone speck cut through let the sky show
    // through the wall in white flecks. Cut where the texels round about are see-through too.
    sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.a = texel.a < 0.95 ? 0.0 : 1.0;', `
      vec2 o = vec2(0.003, 0.0);
      float aa = max(max(texel.a, max(texture2D(map, vMapUv + o).a, texture2D(map, vMapUv - o).a)), max(texture2D(map, vMapUv + o.yx).a, texture2D(map, vMapUv - o.yx).a));
      diffuseColor.a = aa < 0.95 ? 0.0 : 1.0;`);
    // the opening up into the top turret: the roof is cut away round its ring (bomber space: + offset)
    sh.uniforms.uOff = { value: offset };
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform vec3 uOff;
      void main() {
        vec3 pb = vPosM + uOff;
        if (pb.y > ${TURRET_CUT.y.toFixed(2)} && length(pb.xz - vec2(0.0, ${TURRET_CUT.z.toFixed(2)})) < ${TURRET_CUT.r.toFixed(2)}) discard;
`);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPosM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosM = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPosM;
      float h3(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float blotch = n3(vPosM * 2.3) * 0.6 + n3(vPosM * 9.0) * 0.4;
      diffuseColor.rgb *= 0.9 + 0.14 * blotch; // (a little: blotchy paint looks like camouflage)
      float worn = smoothstep(0.8, 0.92, n3(vPosM * 5.0 + 3.1) * 0.8 + n3(vPosM * 23.0) * 0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.51, 0.48), worn * 0.35); // scuffed through to the metal (subtle: bright patches read as holes)`);
    hullPaint(sh, 'vPosM + uOff'); // the worn green paint, rivet rows and seams (cabinlook.js)
    // the holes the rounds and shrapnel have punched through (scars.js keeps the list): the skin torn
    // inward round each, bare metal, and daylight through the hole
    sh.uniforms.uHits = SCARS.hits; sh.uniforms.uScarOn = SCARS.detail; sh.uniforms.uHoleLight = SCARS.light;
    sh.fragmentShader = sh.fragmentShader.replace('uniform vec3 uOff;', `uniform vec3 uOff; uniform vec4 uHits[${SCAR_MAX}]; uniform float uScarOn, uHoleLight;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (uScarOn > 0.5) {
        vec3 bp = vPosM + uOff;
        for (int i = 0; i < ${SCAR_MAX}; i++) {
          vec4 h = uHits[i];
          if (h.w <= 0.0) continue;
          float l = length(bp - h.xyz);
          if (l > h.w * 2.5) continue;
          float rag = n3(bp * 80.0) * 0.6 + n3(bp * 21.0) * 0.4;
          float hole = 1.0 - smoothstep(h.w * (0.2 + 0.15 * rag), h.w * (0.28 + 0.15 * rag), l);
          float petal = (1.0 - smoothstep(h.w * 0.3, h.w * (0.6 + 0.5 * rag), l)) * (1.0 - hole);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.51, 0.49), petal * 0.65);
          diffuseColor.rgb *= 1.0 - hole;
          totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * hole * uHoleLight * 2.5;
        }
      }`);
  };
  m.customProgramCacheKey = () => 'lining-worn';
  return m;
}

/** Copy of geo without the end caps: triangles beyond zFront / zBack (bomber space) facing along Z. */
function openEnds(geo, offsetZ, zFront, zBack) {
  const p = geo.attributes.position, idx = geo.index;
  if (!idx) return geo;
  const a = new V(), b = new V(), c = new V(), n = new V(), keep = [];
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
    const z = (a.z + b.z + c.z) / 3 + offsetZ;
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    if ((z < zFront || z > zBack) && Math.abs(n.z) > 0.6) continue;
    keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  const out = geo.clone();
  out.setIndex(keep);
  return out;
}

/** True if most normals point towards the middle of the mesh instead of away from it. */
function facesInward(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  if (!n) return false;
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new V()), v = new V(), nv = new V();
  let s = 0;
  for (let i = 0; i < p.count; i++) s += nv.fromBufferAttribute(n, i).dot(v.fromBufferAttribute(p, i).sub(c));
  return s < 0;
}

function quiltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5e5a44'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(30,28,20,0.55)'; g.lineWidth = 2;
  for (let k = -128; k < 256; k += 32) { // diamond stitching
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(k + 128, 0); g.lineTo(k, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A stencilled marking: white or yellow letters on a transparent plate. */
/**
 * Plexiglas: clear, but you can tell it's there. Faint where you look straight through it, brighter and
 * reflecting the sky towards grazing angles, fine scratches that catch the light, and a little grime
 * gathered towards the edges of the window.
 */
function plexiglas(holes = null, side = THREE.DoubleSide, base = 0.13) {
  return wetGlass(plexiglasBase(holes, side, base)); // (and drops on it in the rain)
}
function plexiglasBase(holes, side, base) {
  const m = new THREE.MeshStandardMaterial({ color: 0xc9d8cf, roughness: 0.04, metalness: 0, transparent: true, opacity: 1,
    depthWrite: false, side, envMapIntensity: 1.3, map: holes });
  m.onBeforeCompile = (sh) => {
    // holes: the skin's paint texture; the glass is only drawn in its windows (see windowCutout)
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', holes ? `
      vec2 ho = vec2(0.003, 0.0);
      float ha = max(max(texture2D(map, vMapUv).a, max(texture2D(map, vMapUv + ho).a, texture2D(map, vMapUv - ho).a)), max(texture2D(map, vMapUv + ho.yx).a, texture2D(map, vMapUv - ho.yx).a));
      if (ha >= 0.95) discard;` : '');
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGP; varying vec2 vGUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position; vGUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGP; varying vec2 vGUv;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <opaque_fragment>', `
      vec3 vd = normalize(vViewPosition);
      float fres = pow(1.0 - abs(dot(normalize(normal), vd)), 4.0);
      // fine scratches: long thin streaks in two directions, only some catch the light
      vec2 q = vGP.xy * 38.0 + vGP.zz * 21.0;
      float sc = smoothstep(0.985, 1.0, gn(vec2(q.x * 0.08, q.y * 3.0))) + smoothstep(0.988, 1.0, gn(vec2(q.x * 2.6 + q.y, q.y * 0.07)));
      // grime towards the window's edges, and a faint mottle all over
      float edge = ${holes ? '0.25' : '1.0 - smoothstep(0.0, 0.22, min(min(vGUv.x, 1.0 - vGUv.x), min(vGUv.y, 1.0 - vGUv.y)))'};
      float grime = edge * (0.5 + 0.5 * gn(vGP.xy * 18.0)) * 0.12 + gn(vGP.xz * 60.0) * 0.012;
      // (thin: in a dim light a denser glass drew as dark slabs over the sky)
      float ga = clamp(${base.toFixed(3)} + fres * 0.16 + sc * 0.5 + grime, 0.0, 0.34);
      outgoingLight = mix(outgoingLight, vec3(0.32, 0.31, 0.27) * (0.4 + outgoingLight), clamp(grime / max(ga, 0.01), 0.0, 1.0));
      #include <opaque_fragment>
      // (the sky's reflection added on top, stronger towards grazing angles, so the glass shows)
      gl_FragColor.rgb += reflectedLight.indirectSpecular * (1.4 + 1.2 * fres) / max(ga, 0.08) * 0.35;
      gl_FragColor.a = ga;`);
  };
  m.customProgramCacheKey = () => `plexiglas${holes ? '-holes' : ''}${side}${base}`;
  m.userData.outside = true; // (it reflects the open sky: not darkened like the cabin)
  return m;
}

function stencilTexture(lines, colour = '#e8e2c8') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64 * lines.length;
  const g = c.getContext('2d');
  g.fillStyle = colour; g.font = 'bold 44px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, 128, 32 + i * 64, 248));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/**
 * Remove zero-area triangles (non-indexed geometry). Filling an outline whose wall runs straight puts
 * several points in a line, and the triangulation then makes slivers with no area, so they have no
 * normal: lighting them gives NaN, and the bloom pass spread that one pixel into a black screen.
 */
function dropDegenerate(geo) {
  const pos = geo.attributes.position, keep = [];
  const a = new V(), b = new V(), c = new V();
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
    if (c.sub(a).cross(b.sub(a)).lengthSq() > 1e-12) keep.push(t);
  }
  if (keep.length * 3 === pos.count) return geo;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const n = attr.itemSize, arr = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, k) => { for (let v = 0; v < 3; v++) for (let j = 0; j < n; j++) arr[(k * 3 + v) * n + j] = attr.array[(t + v) * n + j]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  // any normal still zero-length (a vertex averaged from opposite faces) points up instead of NaN
  const nm = out.attributes.normal;
  if (nm) for (let i = 0; i < nm.count; i++) if (Math.hypot(nm.getX(i), nm.getY(i), nm.getZ(i)) < 1e-6) nm.setXYZ(i, 0, 1, 0);
  return out;
}

const _sd = new V(), _sd2 = new V(), _up = new V(0, 1, 0);
const ghosts = new Map();
function ghostOf(m) {
  if (!ghosts.has(m)) {
    ghosts.set(m, new THREE.MeshStandardMaterial({
      map: m.map, color: 0xb8c8d0, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6,
    }));
  }
  return ghosts.get(m);
}

// ---------- the interior ----------
export class Interior {
  constructor(model) {
    this.model = model;
    model.updateMatrixWorld(true);
    const hull = [];
    model.traverse((o) => { if (o.isMesh && HULL.test(o.name)) hull.push(o); });
    this.table = measureHull(hull, model);
    this.hullMeshes = hull;
    this.boxes = [];
    this.people = []; // the crew standing or sitting about: you brush past them (Player), not through (Crew keeps it up to date)
    this.group = new THREE.Group();
    this.group.name = 'Interior';
    this.geos = new Map(); // material -> geometries to merge
    this.stations = STATIONS;

    this.lineHull(hull);
    this.buildRibs();
    this.buildFloors();
    this.buildBulkheads();
    this.buildNose();
    this.buildCockpit();
    this.buildBombBay();
    this.buildRadioRoom();
    this.buildWaist();
    this.buildTail();
    this.cutTailplanes(model);
    this.buildDetails();
    addMoreDetail(this, MAT, DECKS);

    this.bombMeshes = [];
    for (const [mat, geos] of this.geos) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = mat !== MAT.floor; // (the floor's planks would shade themselves: no window light on them)
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (mat === MAT.bomb || mat === MAT.bombBand || mat === MAT.bombFuze) this.bombMeshes.push(mesh);
    }
    // the cabin is dark inside: the sun through the windows lights it, not the sky (cabinlook.js)
    // grime and worn edges on the boxes, cans, bottles, radio sets and seats (not the floor, glass, lamps)
    this.group.traverse((o) => { if (o.isMesh && o.geometry.attributes.aEdge && !o.material.transparent && !o.material.emissiveMap && o.material !== MAT.floor && !(o.material.emissiveIntensity > 0 && o.material.emissive?.getHex())) propWear(o.material); });
    this.group.traverse((o) => { if (o.isMesh && !o.material.userData?.outside) insideLight(o.material); });
    for (const [outer, lining] of this.parts.values()) if (lining) insideLight(lining.material);
  }

  /** Bombs away: the racks are empty (or full again, for a fresh bomber). */
  emptyBombBay(empty = true) { for (const m of this.bombMeshes) m.visible = !empty; }

  // ----- helpers -----
  hw(z, y) {
    const k = Math.round((z - T.z0) / T.dz), r = Math.round((y - T.y0) / T.dy);
    return k < 0 || k >= T.nz || r < 0 || r >= T.ny ? 0 : this.table[k * T.ny + r];
  }

  /** Half-width blended between table cells, so walls and ceilings are smooth to walk along. */
  hwSmooth(z, y) {
    const fz = (z - T.z0) / T.dz, fy = (y - T.y0) / T.dy;
    const k = Math.floor(fz), r = Math.floor(fy), tz = fz - k, ty = fy - r;
    const cell = (k, r) => (k < 0 || k >= T.nz || r < 0 || r >= T.ny ? 0 : this.table[k * T.ny + r]);
    // open cells (Infinity) can't be blended: take the nearer one
    const mix = (a, b, t) => (a === Infinity || b === Infinity ? (t < 0.5 ? a : b) : a + (b - a) * t);
    return mix(mix(cell(k, r), cell(k + 1, r), tz), mix(cell(k, r + 1), cell(k + 1, r + 1), tz), ty);
  }

  /** Narrowest half-width of the cabin between heights y0 and y1 at z. */
  wallLimit(z, y0, y1) {
    let m = Infinity;
    for (let y = y0; y <= y1 + 1e-6; y += T.dy) m = Math.min(m, this.hwSmooth(z, y));
    return Math.min(m, this.hwSmooth(z, y1));
  }

  /** First height above y0 where the hull is too narrow for a head at x. */
  ceilingAt(z, x, y0) {
    const top = T.y0 + T.ny * T.dy, need = Math.abs(x) + 0.15; // 0.15 = half a head; the thin tail fin is not headroom
    let y = y0, prev = this.hwSmooth(z, y) - need;
    if (prev < 0) return y;
    while (y < top) {
      const g = this.hwSmooth(z, y + T.dy) - need;
      if (g < 0) return y + (Number.isFinite(prev) ? T.dy * prev / (prev - g) : 0); // where the wall crosses
      prev = g;
      y += T.dy;
    }
    return y;
  }

  /** Highest box top under (x, z) that is no higher than maxY. */
  floorAt(x, z, maxY) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= maxY && b.max.y > best) best = b.max.y;
    }
    return best;
  }

  /** Does a vertical cylinder (radius r, from y0 to y1) at (x, z) hit any box? */
  blocked(x, z, r, y0, y1) {
    for (const b of this.boxes) {
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  /** Pushes a circle (radius r, centre p.x/p.z) out of every box between heights y0 and y1, so you slide round corners. */
  pushOut(p, r, y0, y1) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of this.boxes) {
        if (b.max.y <= y0 || b.min.y >= y1) continue;
        const dx = p.x - Math.max(b.min.x, Math.min(p.x, b.max.x)), dz = p.z - Math.max(b.min.z, Math.min(p.z, b.max.z));
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const k = (r - Math.sqrt(d2)) / Math.sqrt(d2);
          p.x += dx * k; p.z += dz * k;
        } else { // centre inside the box: leave through the nearest side
          const out = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z], i = out.indexOf(Math.min(...out));
          if (i === 0) p.x = b.min.x - r; else if (i === 1) p.x = b.max.x + r; else if (i === 2) p.z = b.min.z - r; else p.z = b.max.z + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return p;
  }

  /** Free height above the feet at (x, z): hull ceiling or the underside of a box overhead. */
  /** The roof over (x, z) above y0: the hull's, or anything solid lower down (the deck under the windscreen). */
  roofAt(z, x, y0) {
    let c = this.ceilingAt(z, x, y0);
    for (const b of this.boxes) if (!b.walkOnly && b.min.y > y0 && b.min.y < c && x > b.min.x - 0.1 && x < b.max.x + 0.1 && z > b.min.z - 0.1 && z < b.max.z + 0.1) c = b.min.y;
    return c;
  }

  headroom(x, z, feet, r, step) {
    let c = this.ceilingAt(z, x, feet + 0.3);
    for (const b of this.boxes) {
      if (b.min.y < feet + step) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) c = Math.min(c, b.min.y);
    }
    return c - feet;
  }

  zoneAt(z) {
    if (z >= -6.35 && z < -5.6) return 'Bomb bay';
    return DECKS.find((d) => z >= d.z0 && z < d.z1)?.name ?? '';
  }

  nearestStation(feet, maxDist = 1.1) {
    let best = null, bd = maxDist;
    for (const s of this.stations) {
      if (Math.abs(feet.y - s.stand.y) > 0.7 || s.sight) continue; // (the bombsight has its own key, B)
      const d = Math.hypot(feet.x - s.stand.x, feet.z - s.stand.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Adds a box: `mat` draws it (null = invisible), `solid` makes it a collider. */
  box(x0, x1, y0, y1, z0, z1, mat, solid = true) {
    if (solid) this.boxes.push(new THREE.Box3(new V(x0, y0, z0), new V(x1, y1, z1)));
    if (mat) this.add(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  }

  add(mat, geo) {
    if (!this.geos.has(mat)) this.geos.set(mat, []);
    // which of its UVs run to an edge, for the worn edges (cabinlook.js propWear): a box's both ways
    // round each face, a can's or bottle's only top and bottom
    const edge = geo.type === 'BoxGeometry' ? [1, 1] : geo.type === 'CylinderGeometry' ? [0, 1] : [0, 0];
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).map((_, i) => edge[i % 2]), 2));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.geos.get(mat).push(dropDegenerate(g)); // extrusions are non-indexed
  }

  cylinder(r, len, x, y, z, axis, mat, seg = 14) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    this.add(mat, g.translate(x, y, z));
  }

  // ----- parts -----
  lineHull(hull) {
    this.parts = new Map(); // name -> [outer mesh, lining] so stations can hide what blocks the view
    for (const mesh of hull) {
      if (mesh.material.userData.glass) continue; // glass needs no lining
      // the fuselage is closed with painted caps behind the nose glass and in front of the tail pod:
      // open them up (in this bomber only) so the bombardier and tail gunner can see out
      if (mesh.name === 'MainFuselage2') mesh.geometry = openEnds(mesh.geometry, mesh.position.z, -10.5, 10.1);
      this.parts.set(mesh.name, [mesh]);
      // some parts (e.g. the nose glass) were modelled with their faces pointing inwards
      const inverted = facesInward(mesh.geometry);
      const outer = mesh.material.clone(); // clone() drops the shader hook, so re-apply it
      if (mesh.material.alphaTest) windowCutout(outer);
      outer.side = inverted ? THREE.BackSide : THREE.FrontSide; // the outside skin no longer hides the cabin
      outer.shadowSide = THREE.DoubleSide; // (one-sided, its shadow would be the belly's alone: the roof and its windows must cast)
      mesh.material = outer;
      // the top turret isn't cabin: no lining (from below you look up through its ring into the glass
      // dome, see buildTopDome), and its floor under the ring is cut away, so it doesn't shut the opening
      if (mesh.name === 'TopTurret') { cutBelow(outer, mesh.position.y, TURRET_CUT.ring); continue; }
      if (mesh.name === 'MainFuselage2' || mesh.name === 'Tail') cutTailCab(outer, mesh.position); // (the gunner's cab: buildTailCab)
      cutRadioHatch(outer, mesh.position); // (and the radio room's gun hatch, open to the sky)
      const lining = new THREE.Mesh(mesh.geometry, liningMaterial(outer, inverted, mesh.position));
      if (mesh.name === 'MainFuselage2' || mesh.name === 'Tail') cutTailCab(lining.material, mesh.position);
      cutRadioHatch(lining.material, mesh.position);
      lining.name = `${mesh.name}_lining`;
      lining.position.copy(mesh.position);
      lining.quaternion.copy(mesh.quaternion);
      lining.scale.copy(mesh.scale);
      lining.receiveShadow = true;
      lining.castShadow = false; lining.userData.noShadow = true; // (the skin's shadow has the window cut-outs; a second one wouldn't)
      mesh.parent.add(lining);
      this.parts.get(mesh.name).push(lining);
    }
  }

  /** Hide (or show again) hull parts by name, e.g. the painted tail cap while at the tail gun. */
  setHidden(names, hidden) {
    for (const n of names) for (const m of this.parts.get(n) ?? [this.model.getObjectByName(n) ?? this.group.getObjectByName(n)]) if (m) m.visible = !hidden;
  }

  /** Turret shells turn to faint glass while you're in them, so the frame never blocks the view. */
  setGhost(names, on) {
    for (const n of names) {
      const [outer, lining] = this.parts.get(n) ?? [this.model.getObjectByName(n)];
      if (lining) lining.visible = !on;
      outer?.traverse((o) => {
        if (!o.isMesh) return;
        if (on && !o.userData.solid) {
          o.userData.solid = o.material;
          o.material = ghostOf(o.material);
          o.castShadow = false;
        } else if (!on && o.userData.solid) {
          o.material = o.userData.solid;
          o.userData.solid = null;
          o.castShadow = true;
        }
      });
    }
  }

  buildFloors() {
    for (const d of DECKS) {
      this.box(-d.hw, d.hw, d.y - 0.1, d.y, d.z0, d.z1, null);
      if (d.name === 'Bomb bay') continue; // (its catwalk is a metal beam: buildBombBay)
      for (let z = d.z0; z < d.z1 - 0.01; z += 0.25) { // planks follow the hull's width
        const z1 = Math.min(z + 0.25, d.z1), w = Math.min(d.hw, this.hw((z + z1) / 2, d.y + 0.06) - 0.01);
        const h = CRAWLWAY.hatch;
        if (d.name === 'Cockpit' && z < h.z1 && z1 > h.z0) { // (the hatch: the planks either side of it)
          for (const s of [-1, 1]) if (w > h.x1) this.add(MAT.floor, new THREE.BoxGeometry(w - h.x1, 0.04, z1 - z - 0.01).translate(s * (w + h.x1) / 2, d.y - 0.02, (z + z1) / 2));
          continue;
        }
        if (w > 0.05) this.add(MAT.floor, new THREE.BoxGeometry(w * 2, 0.04, z1 - z - 0.01).translate(0, d.y - 0.02, (z + z1) / 2));
      }
    }
    for (const s of STEPS) this.box(-0.3, 0.3, -2.0, s.y, s.z0, s.z1, MAT.floor);
  }

  /** Cabin outline at z (shrunk by `inset`), as points going round: [lo, hi, points]. */
  outline(z, mid, inset, maxY = Infinity) {
    let lo = mid, hi = mid;
    while (this.hw(z, lo - 0.05) > 0.08 + inset && lo > T.y0) lo -= 0.05;
    while (this.hw(z, hi + 0.05) > 0.08 + inset && hi < T.y0 + T.ny * T.dy && hi + 0.05 <= maxY) hi += 0.05;
    const pts = [];
    for (let y = lo; y <= hi + 1e-6; y += 0.05) pts.push(new THREE.Vector2(this.hw(z, y) - inset, y));
    for (let y = hi; y >= lo - 1e-6; y -= 0.05) pts.push(new THREE.Vector2(-(this.hw(z, y) - inset), y));
    return [lo, hi, pts];
  }

  buildRibs() {
    // fuselage frames every 50 cm from the radio room to the tail, following the hull's shape
    // (the waist windows sit between two frames: those run either side of them, not across them)
    const zs = [];
    for (let z = -2.5; z < 9.5; z += 0.5) zs.push((z > 1.4 && z < 2.2) || (z > RADIO_HATCH.z0 && z < RADIO_HATCH.z1) ? null : z); // (none across the radio room's gun hatch either)
    for (let z of [...zs.filter((x) => x !== null), 1.37, 2.24]) {
      const deck = DECKS.find((d) => z >= d.z0 && z < d.z1);
      if (!deck) continue;
      const [, , outer] = this.outline(z, deck.y + 0.3, 0.01);
      const [, , inner] = this.outline(z, deck.y + 0.3, 0.07);
      if (outer.length < 8 || inner.length < 8) continue;
      const shape = new THREE.Shape(outer);
      shape.holes.push(new THREE.Path(inner));
      // lightening holes punched through the web, every 15 cm or so round the frame
      const [, , mid] = this.outline(z, deck.y + 0.3, 0.04);
      let last = null;
      for (const p of mid) {
        if (p.y < deck.y + 0.08 || (last && last.distanceTo(p) < 0.15)) continue;
        shape.holes.push(new THREE.Path().absarc(p.x, p.y, 0.014, 0, Math.PI * 2, true));
        last = p;
      }
      this.add(MAT.metal, new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, z));
      // the inner flange: the frame is a channel, its edge turned over
      const [, , lip] = this.outline(z, deck.y + 0.3, 0.062);
      if (lip.length >= 8) {
        const flange = new THREE.Shape(lip);
        flange.holes.push(new THREE.Path(inner));
        this.add(MAT.metal, new THREE.ExtrudeGeometry(flange, { depth: 0.045, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z - 0.015));
      }
    }
  }

  buildBulkheads() {
    for (const b of BULKHEADS) {
      // stop at the fuselage roof: the hull table also holds the top turret's dome, and a bulkhead
      // traced up into it stood right behind the turret gunner's head, filling his view aft
      const [, hi, pts] = this.outline(b.z, b.floor + 0.6, 0.01, ROOF);
      const shape = new THREE.Shape(pts);
      const [x0, x1, h] = b.door, top = Math.min(b.floor + h, hi - 0.1);
      shape.holes.push(new THREE.Path([new THREE.Vector2(x0, b.floor), new THREE.Vector2(x1, b.floor),
        new THREE.Vector2(x1, top), new THREE.Vector2(x0, top)]));
      this.add(MAT.green, new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, b.z - 0.02));
      this.box(-2, x0, -3, 3, b.z - 0.05, b.z + 0.05, null);
      this.box(x1, 2, -3, 3, b.z - 0.05, b.z + 0.05, null);
      this.box(x0, x1, top, 3, b.z - 0.05, b.z + 0.05, null);
      for (const x of [x0, x1]) this.box(x - 0.03, x + 0.03, b.floor, top, b.z - 0.04, b.z + 0.04, MAT.metal, false); // door frame
    }
  }

  buildNose() {
    const f = -0.72;
    this.box(-0.95, -0.55, f, 0.02, -9.4, -8.85, null); // navigator's table (drawn in stations.js)
    this.box(-0.18, 0.18, f, -0.3, -10.3, -10.08, MAT.leather); // bombardier's seat
    this.box(-0.18, 0.18, -0.3, 0.4, -10.3, -10.08, null); // (no climbing onto it)
    this.box(-1.0, 1.0, f, 1.0, -11.8, -10.82, null); // the nose glass: you can't walk out past the end of the floor
    this.box(-0.09, 0.09, f, -0.25, -10.55, -10.42, MAT.metal); // bomb-sight stand
    this.box(-0.11, 0.11, -0.25, -0.02, -10.6, -10.36, MAT.dark, false); // Norden bomb sight
  }

  /**
   * The crawlway: the hatch in the flight deck floor between the seats, its raised frame and its lid
   * laid open aft; under the floor a low tunnel forward to the nose, its mouth low in the bulkhead
   * under the instrument panel. The bulkhead closes off the cockpit: no seeing (or walking) through.
   */
  buildCrawlway() {
    const { hatch: h, tunnel: t } = CRAWLWAY, f = -0.40;
    // the tunnel: floor, walls and roof (the flight deck's underside), the aft wall under the hatch
    this.add(MAT.floor, new THREE.BoxGeometry(t.x * 2, 0.03, t.z1 - t.z0).translate(0, t.y0 - 0.015, (t.z0 + t.z1) / 2));
    for (const s of [-1, 1]) this.add(MAT.green, new THREE.BoxGeometry(0.02, t.y1 - t.y0, t.z1 - t.z0).translate(s * (t.x + 0.01), (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2));
    this.add(MAT.green, new THREE.BoxGeometry(t.x * 2, 0.02, h.z0 - t.z0).translate(0, t.y1 + 0.01, (t.z0 + h.z0) / 2));
    this.add(MAT.green, new THREE.BoxGeometry(t.x * 2, t.y1 - t.y0, 0.02).translate(0, (t.y0 + t.y1) / 2, t.z1 + 0.01));
    for (const z of [-8.3, -7.95]) for (const s of [-1, 1]) this.rod([s * (t.x - 0.01), t.y0, z], [s * (t.x - 0.01), t.y1, z], 0.012, MAT.metal, 5); // its frames
    // the well down through the floor, the raised frame round the hatch, the lid laid open aft on its hinge
    for (const s of [-1, 1]) this.add(MAT.green, new THREE.BoxGeometry(0.02, f - t.y1, h.z1 - h.z0).translate(s * (h.x1 + 0.01), (f + t.y1) / 2, (h.z0 + h.z1) / 2));
    for (const [x0, x1, z0, z1] of [[h.x0 - 0.035, h.x1 + 0.035, h.z0 - 0.035, h.z0], [h.x0 - 0.035, h.x1 + 0.035, h.z1, h.z1 + 0.035], [h.x0 - 0.035, h.x0, h.z0, h.z1], [h.x1, h.x1 + 0.035, h.z0, h.z1]])
      this.box(x0, x1, f, f + 0.045, z0, z1, MAT.metal, false);
    const lid = [
      new THREE.BoxGeometry(h.x1 - h.x0, 0.02, h.z1 - h.z0).translate(0, 0.01, (h.z1 - h.z0) / 2),
      new THREE.BoxGeometry(0.02, 0.025, h.z1 - h.z0 - 0.06).translate(-0.08, 0.03, (h.z1 - h.z0) / 2), // its stiffeners
      new THREE.BoxGeometry(0.02, 0.025, h.z1 - h.z0 - 0.06).translate(0.08, 0.03, (h.z1 - h.z0) / 2),
    ];
    for (const g of lid) this.add(MAT.metal, g.rotateX(-0.36).translate(0, f + 0.045, h.z1 + 0.035));
    this.rod([-0.06, f + 0.09, h.z1 + 0.3], [0.06, f + 0.09, h.z1 + 0.3], 0.008, MAT.dark, 6); // its handle
    this.cylinder(0.012, h.x1 - h.x0, 0, f + 0.045, h.z1 + 0.035, 'x', MAT.dark, 8); // the hinge
    // the bulkhead under the panel, seen from the nose, with the tunnel's mouth low in it
    const z = t.z0 - 0.005, [, , pts] = this.outline(z, 0, 0.01, 0.62), shape = new THREE.Shape(pts);
    shape.holes.push(new THREE.Path([new THREE.Vector2(-t.x, -0.72), new THREE.Vector2(t.x, -0.72), new THREE.Vector2(t.x, t.y1), new THREE.Vector2(-t.x, t.y1)]));
    this.add(MAT.green, new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z - 0.03));
    for (const [a, b] of [[[-t.x, -0.72], [-t.x, t.y1]], [[t.x, -0.72], [t.x, t.y1]], [[-t.x, t.y1], [t.x, t.y1]]]) this.rod([a[0], a[1], z - 0.035], [b[0], b[1], z - 0.035], 0.016, MAT.metal, 6); // (its edge, worn bright)
    this.stencil(['CRAWLWAY'], 0.13, [0, t.y1 + 0.06, z - 0.04], Math.PI, '#e8e2c8');
    // and a wall right across: the cockpit ends at its panel (no walking through it, either way)
    this.box(-1.3, 1.3, t.y1, 1.4, t.z0 - 0.02, -8.4, null);
    // over the top of the panel: the deck under the windscreen, forward from the glare shield to where
    // it meets the skin (the cockpit is closed in, as in the real one: no looking down into the nose)
    const L = [], R = [];
    let dz = -8.64, y = 0.665;
    for (; dz > -10.4; dz -= 0.05, y += 0.05 * 0.3) {
      const roof = this.ceilingAt(dz, 0, y - 0.3), w = this.hw(dz, Math.min(y, roof - 0.01)) - 0.004;
      if (roof < y + 0.01 || !(w > 0.05)) { y = roof; L.push(new V(-0.04, y, dz)); R.push(new V(0.04, y, dz)); break; } // (the skin comes down to it: done)
      L.push(new V(-w, y, dz)); R.push(new V(w, y, dz));
    }
    const dp = [];
    for (let i = 0; i < L.length - 1; i++) for (const q of [L[i], R[i], R[i + 1], L[i], R[i + 1], L[i + 1]]) dp.push(q.x, q.y, q.z);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); dg.computeVertexNormals();
    const dm = new THREE.Mesh(dg, MAT.deck); dm.material.side = THREE.DoubleSide; this.group.add(dm);
    if (L.length) this.box(-1.3, 1.3, 0.66, 1.5, L[L.length - 1].z, -8.6, null); // (its underside: the nose's ceiling there)
  }

  buildCockpit() {
    const f = -0.40;
    buildB17Cockpit(this); // the panel, glare shield, wheels, pedestal and seats (cockpitb17.js)
    this.buildCrawlway();
    // top turret: the engineer's standing platform, and above him the opening in the roof up into the
    // turret: the ring and its lip, and ammunition boxes either side
    this.box(-0.32, 0.32, f, f + 0.12, -7.0, -6.55, MAT.metal);
    this.add(MAT.metal, new THREE.TorusGeometry(TURRET_CUT.r + 0.02, 0.035, 8, 40).rotateX(Math.PI / 2).translate(0, 1.15, TURRET_CUT.z));
    this.add(MAT.well, new THREE.CylinderGeometry(TURRET_CUT.r + 0.01, TURRET_CUT.r + 0.01, 0.06, 40, 1, true).translate(0, 1.15, TURRET_CUT.z)); // the ring's lip (open below: you see the engineer up in it)
    // walking about, the ring is your ceiling: your head never goes up into the dome (and out over the
    // fuselage). Only climbing into the turret takes you up there (the station's way in)
    this.box(-0.75, 0.75, 1.05, 3, TURRET_CUT.z - 0.75, TURRET_CUT.z + 0.75, null);
    this.boxes[this.boxes.length - 1].walkOnly = true;
    for (const s of [-1, 1]) {
      this.box(s * 0.42 - 0.1, s * 0.42 + 0.1, 0.62, 0.92, TURRET_CUT.z - 0.22, TURRET_CUT.z + 0.22, MAT.ammo, false); // ammunition boxes on the turret
      this.rod([s * 0.38, 0.92, TURRET_CUT.z], [s * 0.18, 1.12, TURRET_CUT.z - 0.05], 0.03, MAT.chute, 8); // feed chutes up to the guns
    }
  }

  /**
   * The bomb bay as in the photos: the bombs hung in tiers on the racks either side of the catwalk,
   * each an M43/M64 general-purpose bomb (ogive nose and its fuze, a body tapering to the tail, two
   * yellow bands at the nose and one at the tail, the suspension lugs on top, the box fin with the tail
   * fuze's arming vane), held in its shackle to the rack's uprights; the narrow riveted keel-beam
   * catwalk on its V-supports, and a handrail along each side.
   */
  buildBombBay() {
    const f = -1.62;
    for (const s of [-1, 1]) this.box(s > 0 ? 0.3 : -1.2, s > 0 ? 1.2 : -0.3, -2.2, 0.8, -6.35, -2.6, null); // bomb racks: stay on the catwalk
    // one bomb, nose towards -Z, centred on the origin: its parts by material
    const profile = [[0, -0.66], [0.02, -0.655], [0.028, -0.62], [0.05, -0.6], [0.095, -0.56], [0.135, -0.5], [0.163, -0.42],
      [0.178, -0.32], [0.181, -0.2], [0.181, 0.12], [0.172, 0.22], [0.145, 0.32], [0.1, 0.41], [0.055, 0.47], [0.03, 0.5], [0, 0.52]];
    const body = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 20).rotateX(Math.PI / 2); // (turned about Y: laid along Z)
    const parts = { bomb: [body], band: [], fuze: [] };
    for (const z of [-0.43, -0.38, 0.17]) parts.band.push(new THREE.CylinderGeometry(0.1835, 0.1835, 0.022, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, z));
    parts.fuze.push(new THREE.CylinderGeometry(0.018, 0.028, 0.05, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.67)); // nose fuze
    parts.fuze.push(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8).rotateX(Math.PI / 2).translate(0, 0, 0.55)); // tail fuze
    for (const a of [0, Math.PI / 2]) parts.fuze.push(new THREE.BoxGeometry(0.07, 0.004, 0.018).rotateZ(a + 0.3).translate(0, 0, 0.585)); // its arming vane
    for (let k = 0; k < 4; k++) { // the box fin: four fins in an X, joined by the square box round their tips
      parts.bomb.push(new THREE.BoxGeometry(0.004, 0.17, 0.3).translate(0, 0.1, 0.5).rotateZ(Math.PI / 4 + (k * Math.PI) / 2));
      parts.bomb.push(new THREE.BoxGeometry(0.235, 0.004, 0.17).translate(0, 0.118, 0.58).rotateZ((k * Math.PI) / 2));
    }
    for (const z of [-0.12, 0.1]) parts.fuze.push(new THREE.BoxGeometry(0.03, 0.03, 0.025).translate(0, 0.19, z)); // suspension lugs
    const M = { bomb: MAT.bomb, band: MAT.bombBand, fuze: MAT.bombFuze };
    // the racks: on each side two bombs fore and aft in tiers four high, hung slightly nose down
    const tilt = new THREE.Matrix4().makeRotationX(-0.05), at = new THREE.Matrix4();
    const rows = [-1.48, -1.08, -0.68, -0.28];
    for (const s of [-1, 1]) for (const z of [-4.95, -3.55]) {
      for (const y of rows) {
        at.makeTranslation(s * 0.58, y, z).multiply(tilt);
        for (const [k, list] of Object.entries(parts)) for (const g of list) this.add(M[k], g.clone().applyMatrix4(at));
        // its shackle: the release unit on the rack's upright, hooks down round both lugs
        const sy = y + 0.25;
        this.box(Math.min(s * 0.36, s * 0.42), Math.max(s * 0.36, s * 0.42), sy - 0.03, sy + 0.04, z - 0.2, z + 0.18, MAT.dark, false);
        for (const lz of [-0.12, 0.1]) {
          this.rod([s * 0.4, sy, z + lz], [s * 0.58, sy - 0.02, z + lz - 0.01], 0.007, MAT.metal, 5);
          this.rod([s * 0.58, sy - 0.02, z + lz - 0.01], [s * 0.58, y + 0.2, z + lz - 0.01], 0.006, MAT.metal, 5);
        }
        this.cylinder(0.008, 0.06, s * 0.43, sy + 0.05, z - 0.02, 'z', MAT.red, 6); // the arming wire's clip
      }
      // the rack's uprights (a channel section) and the braces between them
      for (const dz of [-0.2, 0.18]) {
        this.box(s * 0.34 - 0.02, s * 0.34 + 0.02, -1.75, 0.0, z + dz - 0.03, z + dz + 0.03, MAT.metal, false);
        this.box(s * 0.34 - 0.025, s * 0.34 + 0.025, -1.75, 0.0, z + dz - 0.004, z + dz + 0.004, MAT.dark, false);
      }
      for (const y of rows) this.rod([s * 0.34, y + 0.05, z - 0.2], [s * 0.34, y + 0.38, z + 0.18], 0.007, MAT.metal, 5);
    }
    // the catwalk: a keel beam, its top plate punched with lightening holes and riveted, webs and flanges below
    const plate = new THREE.Shape([new THREE.Vector2(-0.13, -6.35), new THREE.Vector2(0.13, -6.35), new THREE.Vector2(0.13, -2.6), new THREE.Vector2(-0.13, -2.6)]);
    for (let z = -6.2; z < -2.7; z += 0.25) plate.holes.push(new THREE.Path().absellipse(0, z, 0.045, 0.07, 0, Math.PI * 2, true));
    this.add(MAT.catwalk, new THREE.ExtrudeGeometry(plate, { depth: 0.012, bevelEnabled: false, curveSegments: 10 }).rotateX(Math.PI / 2).translate(0, f, 0));
    for (const x of [-0.12, 0.12]) {
      this.box(x - 0.006, x + 0.006, f - 0.2, f - 0.012, -6.35, -2.6, MAT.catwalk, false); // webs
      this.box(x - 0.03, x + 0.03, f - 0.212, f - 0.2, -6.35, -2.6, MAT.catwalk, false); // flanges
      for (let z = -6.3; z < -2.6; z += 0.05) this.add(MAT.metal, new THREE.SphereGeometry(0.004, 4, 3).translate(x, f + 0.003, z)); // rivets along it
    }
    // the handrails: a tube each side at hip height, on posts down to the catwalk
    for (const x of [-0.2, 0.2]) {
      this.rod([x, f + 0.85, -6.3], [x, f + 0.85, -2.65], 0.014, MAT.green, 8);
      for (const z of [-5.6, -4.25, -2.9]) this.rod([x, f + 0.85, z], [Math.sign(x) * 0.13, f, z], 0.011, MAT.green, 6);
    }
  }

  buildRadioRoom() {
    const f = -1.80;
    this.buildRadioHatch();
    // the desk, its sets and the chair are drawn in stations.js; these keep you out of them
    this.box(-1.0, -0.42, f, -1.05, -2.5, -1.8, null); // desk
    this.box(-0.97, -0.6, -1.05, -0.3, -2.45, -1.94, null); // the sets on it
    this.box(-0.85, -0.5, f, f + 0.45, -1.72, -1.42, null); // operator's chair
  }

  /**
   * The radio room's gun hatch: the opening in the roof with its riveted frame inside and out, the
   * slipstream deflector standing up ahead of it (seen from outside too), the gun's mount at its
   * forward end, and the ammunition box and feed chute on the wall by it.
   */
  buildRadioHatch() {
    const h = RADIO_HATCH, skin = (z) => 0.525 - (z + 2.2) * 0.17; // (the roof's top there, measured)
    const st = STATIONS.find((s) => s.id === 'radio'), p = new V(...st.pivot);
    // the frame round the opening, on the skin
    const c = [[-h.x, h.z0], [h.x, h.z0], [h.x, h.z1], [-h.x, h.z1]].map(([x, z]) => new V(x, skin(z) - 0.02, z));
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      this.rod(a.toArray(), b.toArray(), 0.01, MAT.dark, 6); // (slim: it's all round the view)
      const L = a.distanceTo(b);
      for (let t = 0.05; t < L; t += 0.06) this.add(MAT.metal, new THREE.SphereGeometry(0.006, 5, 3).translate(...a.clone().lerp(b, t / L).add(new V(0, 0.022, 0)).toArray()));
    }
    // the deflector: a curved plate standing up ahead of the opening, leaning back, braced to the skin
    const def = new THREE.CylinderGeometry(0.9, 0.9, h.x * 2 + 0.1, 16, 1, true, -0.28, 0.56).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
    def.translate(0, skin(h.z0) - 0.62, h.z0 - 0.92 + 0.14);
    this.add(MAT.metal, def);
    for (const s of [-1, 1]) this.rod([s * (h.x + 0.04), skin(h.z0 - 0.12), h.z0 - 0.12], [s * (h.x + 0.04), skin(h.z0) + 0.2, h.z0 - 0.02], 0.01, MAT.dark, 5);
    // the mount: a cradle under the pivot, braced out to the hatch's side frames (nothing in the room,
    // nothing across the view)
    for (const s of [-1, 1]) this.rod([s * 0.05, p.y - 0.1, p.z], [s * (h.x - 0.01), skin(p.z) - 0.04, p.z], 0.016, MAT.dark, 6);
    this.cylinder(0.035, 0.06, p.x, p.y - 0.09, p.z, 'y', MAT.metal, 10);
    // its ammunition box on the right wall, the feed chute up to the gun
    const bz = -2.0, by = -0.75, bx = this.hw(bz, by) - 0.14;
    this.box(bx - 0.11, bx + 0.11, by - 0.15, by + 0.15, bz - 0.2, bz + 0.2, MAT.ammo, false);
    const chute = new THREE.CatmullRomCurve3([new V(bx - 0.05, by + 0.15, bz), new V(bx - 0.15, by + 0.6, bz + 0.1), new V(0.18, p.y - 0.25, p.z - 0.15), new V(0.07, p.y - 0.05, p.z - 0.2)]);
    this.add(MAT.chute, new THREE.TubeGeometry(chute, 18, 0.028, 5, false));
    this.stencil(['CAL .50'], 0.12, [bx - 0.111, by + 0.05, bz], -Math.PI / 2, '#d8d0a8');
    // two passenger seats folded down along the right wall aft of it, and equipment cases on the floor
    for (const z of [-1.62, -1.32]) {
      const x = this.hw(z, -1.4) - 0.2;
      this.box(x - 0.18, x + 0.18, -1.38, -1.33, z - 0.13, z + 0.13, MAT.leather, false); // the seat
      this.box(x + 0.15, x + 0.19, -1.33, -0.92, z - 0.13, z + 0.13, MAT.leather, false); // its back on the wall
      for (const dz of [-0.1, 0.1]) this.rod([x - 0.16, -1.8, z + dz], [x - 0.16, -1.36, z + dz], 0.01, MAT.metal, 5); // its legs
    }
    for (const [x, z, y, w, h, d] of [[0.5, -2.42, -1.8, 0.32, 0.26, 0.24], [0.5, -2.42, -1.54, 0.24, 0.18, 0.2]]) { // (forward, on the right: clear of the gun and the operator's chair)
      this.box(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, MAT.green);
      this.box(x - 0.04, x + 0.04, y + h, y + h + 0.012, z - d / 2 - 0.005, z - d / 2 + 0.02, MAT.metal, false); // a catch
    }
  }

  /**
   * The tailplanes run right through the fuselage in the model (and they're two-sided): crawling down
   * the tail you'd have them as walls either side. Inside the fuselage they're cut away (your bomber only).
   */
  cutTailplanes(model) {
    model.updateMatrixWorld(true);
    const toModel = new THREE.Matrix4(), inv = model.matrixWorld.clone().invert();
    model.traverse((o) => {
      if (!o.isMesh || o.material?.name !== 'RearWings') return;
      const m = o.material.clone(), prev = o.material.onBeforeCompile, prevKey = o.material.customProgramCacheKey?.bind(o.material);
      toModel.multiplyMatrices(inv, o.matrixWorld);
      const M = toModel.clone();
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        sh.uniforms.uToBomber = { value: M };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform mat4 uToBomber; varying vec3 vTpP;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
vTpP = (uToBomber * vec4(position, 1.0)).xyz;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vTpP;`)
          .replace('void main() {', `void main() {
  if (vTpP.z > 4.8 && vTpP.y < -0.9 && abs(vTpP.x) < 0.78 - 0.045 * (vTpP.z - 5.0)) discard;`);
      };
      m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|tailplane-in`;
      o.material = m;
    });
  }

  /** The bulkhead shutting off the tail, its low opening framed and stencilled, solid all but that. */
  buildTailway() {
    const { z, mouth: m } = TAILWAY, [, , pts] = this.outline(z, -1.6, 0.01), shape = new THREE.Shape(pts);
    shape.holes.push(new THREE.Path([new THREE.Vector2(-m.x, m.y0), new THREE.Vector2(m.x, m.y0), new THREE.Vector2(m.x, m.y1), new THREE.Vector2(-m.x, m.y1)]));
    this.add(MAT.green, new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z - 0.015));
    for (const [a, b] of [[[-m.x, m.y0], [-m.x, m.y1]], [[m.x, m.y0], [m.x, m.y1]], [[-m.x, m.y1], [m.x, m.y1]]]) this.rod([a[0], a[1], z - 0.02], [b[0], b[1], z - 0.02], 0.016, MAT.metal, 6);
    this.stencil(['TAIL GUNNER'], 0.16, [0, m.y1 + 0.08, z - 0.02], Math.PI, '#e8e2c8');
    this.box(-1.3, -m.x, -2.4, 1.5, z - 0.03, z + 0.03, null); // (solid: only the crawl through the opening)
    this.box(m.x, 1.3, -2.4, 1.5, z - 0.03, z + 0.03, null);
    this.box(-m.x, m.x, m.y1 - 0.17, 1.5, z - 0.03, z + 0.03, null); // (too low to walk through from either side: the tail's floor is lower)
  }

  buildWaist() {
    this.buildTailway();
    const f = -1.95;
    this.box(-0.36, 0.36, f, -1.2, -0.5, 0.24, null); // ball turret and its support stick up through the floor
    this.add(MAT.metal, new THREE.TorusGeometry(0.5, 0.04, 8, 32).rotateX(Math.PI / 2).translate(0, f + 0.02, -0.13));
    // the ball's steel top where it comes up through the floor (the model's ball is glass up here, and
    // seen from the waist it mirrored the sky). Hidden while you're in the ball yourself.
    const rc = 0.57, cy = -2.15, top = Math.acos(THREE.MathUtils.clamp((f - cy) / rc, -1, 1));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(rc, 36, 10, 0, Math.PI * 2, 0, top).translate(0, cy, -0.13), std(0x5a5e56, 0.55, 0.55));
    cap.name = 'BallCap';
    cap.receiveShadow = true;
    this.group.add(cap);
    this.add(MAT.dark, new THREE.CylinderGeometry(0.08, 0.1, 0.05, 16).translate(0, cy + rc - 0.01, -0.13)); // its hub
    for (const s of [-1, 1]) {
      this.box(s > 0 ? 0.5 : -0.74, s > 0 ? 0.74 : -0.5, f, f + 0.35, 2.75, 3.15, MAT.green); // ammo boxes
      this.cylinder(0.11, 0.55, s * 0.72, -1.15, 0.8, 'y', MAT.yellow); // oxygen bottles
      this.cylinder(0.11, 0.55, s * 0.72, -1.15, 1.05, 'y', MAT.yellow);
    }
  }

  /** A thin rod (cable, hose, chute) from a to b. */
  rod(a, b, r, mat, seg = 6) {
    const A = new V(...a), B = new V(...b), len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), B.clone().sub(A).normalize()));
    this.add(mat, g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2));
  }

  /** A stencilled marking on a flat surface (facing +Z when rotY = 0). */
  stencil(lines, w, pos, rotY = 0, colour) {
    const h = (w / 4) * lines.length;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
      map: stencilTexture(lines, colour), transparent: true, alphaTest: 0.3, roughness: 0.8, envMapIntensity: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(...pos); m.rotation.y = rotY;
    this.group.add(m);
  }

  /**
   * The clutter of a real B-17: ammunition boxes and feed chutes at the guns, oxygen bottles and hoses,
   * control cables along the walls, the ball turret's support, the radio sets, padding and stencils.
   * All decoration (no colliders), kept clear of the walkway and every gun position's view.
   */
  buildDetails() {
    // waist guns: an ammo box on the floor just aft of each (staggered) gun, and the flexible steel
    // chute that carries the belt up into the gun's feed tray, on its left side
    for (const [s, z0, feed] of [[-1, 2.3, [-1.01, -1.03, 2.005]], [1, 1.9, [1.0, -1.01, 1.595]]]) {
      const bx = s * 0.66;
      this.box(bx - 0.13, bx + 0.13, -1.95, -1.62, z0, z0 + 0.36, MAT.ammo, false);
      this.box(bx - 0.135, bx + 0.135, -1.64, -1.6, z0 - 0.005, z0 + 0.365, MAT.dark, false); // the lid
      this.stencil(['CAL .50', 'LINKED'], 0.2, [bx, -1.76, z0 - 0.002], Math.PI);
      const A = new V(bx, -1.6, z0 + 0.12), F = new V(...feed);
      const curve = new THREE.CatmullRomCurve3([A, new V(bx * 1.05, -1.35, z0 + 0.06), F.clone().add(new V(-s * 0.05, -0.18, (F.z - A.z) * 0.15)), F]);
      this.add(MAT.chute, new THREE.TubeGeometry(curve, 24, 0.034, 4, false));
      for (let i = 1; i < 24; i++) { // the chute's links: a ring every few centimetres
        const p = curve.getPointAt(i / 24), t = curve.getTangentAt(i / 24);
        this.add(MAT.dark, new THREE.TorusGeometry(0.037, 0.005, 3, 4).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), t)).translate(p.x, p.y, p.z));
      }
    }
    // tail guns: boxes along the walls, chutes forward to the guns
    for (const s of [-1, 1]) {
      this.box(s * 0.32 - 0.12, s * 0.32 + 0.12, -2.32, -2.02, 8.55, 9.15, MAT.ammo, false);
      this.rod([s * 0.3, -2.05, 9.1], [s * 0.18, -2.12, 9.85], 0.04, MAT.chute, 8);
    }
    // the ball turret hangs in a yoke from a heavy fuselage frame either side: braces from its ring up
    // to the frame at the walls, nothing across the walkway at head height
    { const z = -0.13, f = -1.95;
      for (const sd of [-1, 1]) {
        const pts = [];
        for (let y = f; y <= f + 1.05 + 1e-6; y += 0.05) pts.push(new THREE.Vector2(sd * (this.hw(z, y) - 0.01), y));
        for (let y = f + 1.05; y >= f - 1e-6; y -= 0.05) pts.push(new THREE.Vector2(sd * (this.hw(z, y) - 0.1), y));
        const heavy = new THREE.Shape(sd > 0 ? pts : pts.reverse()); // the heavy frame up the wall
        for (const dz of [-0.2, 0.2]) this.add(MAT.metal, new THREE.ExtrudeGeometry(heavy, { depth: 0.035, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z + dz - 0.017));
        const top = f + 0.85, wx = sd * (this.hw(z, top) - 0.06);
        for (const dz of [-0.2, 0.2]) {
          this.rod([sd * 0.44, f + 0.06, z + dz * 0.6], [wx, top, z + dz], 0.028, MAT.metal, 8); // the yoke's arms
          this.box(wx - 0.04, wx + 0.04, top - 0.06, top + 0.06, z + dz - 0.04, z + dz + 0.04, MAT.dark, false); // bolted to the frame
        }
        this.rod([wx, top, z - 0.2], [wx, top, z + 0.2], 0.022, MAT.metal, 8); // and tied together along the wall
        this.box(sd * 0.44 - 0.05, sd * 0.44 + 0.05, f, f + 0.1, z - 0.16, z + 0.16, MAT.dark, false); // the trunnion block on the ring
      }
    }
    // oxygen: yellow bottles in the cockpit and radio room, hoses to each crew position
    for (const [x, y, z] of [[-0.85, -0.15, -7.05], [0.85, -0.15, -7.05], [0.8, -1.5, -2.2], [0.8, -1.5, -1.95]]) {
      this.cylinder(0.1, 0.5, x, y, z, 'y', MAT.yellow, 12);
      this.rod([x, y + 0.27, z], [x * 0.92, y + 0.55, z + 0.25], 0.012, MAT.hose);
    }
    this.stencil(['OXYGEN'], 0.2, [0.69, -1.45, -2.08], -Math.PI / 2, '#1a1a1a');
    for (const s of [-1, 1]) this.rod([s * 0.62, -1.75, 1.05], [s * 0.86, -1.45, 1.3], 0.012, MAT.hose); // waist gunners' hoses (low along the wall, behind the gun: clear of the view out)
    // fire extinguisher by the radio room door
    this.cylinder(0.07, 0.42, 0.55, -1.58, -1.4, 'y', MAT.red, 12);
    this.stencil(['FIRE', 'EXTINGUISHER'], 0.26, [0.55, -1.1, -1.32], 0);
    // control cables to the tail, along both walls just under the windows
    for (const s of [-1, 1]) {
      let prev = null;
      for (let z = -1.0; z <= 9.0; z += 0.5) {
        const deck = DECKS.find((d) => z >= d.z0 && z < d.z1) ?? DECKS.at(-1);
        const y = deck.y + 1.32, x = s * (this.hw(z, y) - 0.06);
        if (!Number.isFinite(x) || Math.abs(x) < 0.2) { prev = null; continue; }
        if (prev && !(z > 1.3 && z < 2.3)) this.rod(prev, [x, y, z], 0.006, MAT.cable, 4); // (not across the waist windows)
        prev = [x, y, z];
      }
    }
    buildStations(this, MAT); // the navigator's and radio operator's stations (stations.js)
    // padded walls: quilted insulation on the radio room bulkheads, either side of the doors
    for (const [z, dir] of [[-2.57, 1], [-1.28, -1]]) for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.42, 1.0); if (dir < 0) g.rotateY(Math.PI);
      this.add(MAT.pad, g.translate(s * 0.58, -1.2, z));
    }
    // stencils: the things painted on every B-17
    this.stencil(['NO SMOKING'], 0.36, [0, -0.25, -6.31], Math.PI);
    this.stencil(['DANGER', 'BOMB BAY'], 0.3, [0.5, -0.95, -2.56], 0);
    this.stencil(['WALK ON', 'CATWALK ONLY'], 0.3, [-0.5, -0.95, -2.64], Math.PI);
    this.stencil(['42-31909'], 0.3, [0.68, -0.6, 4.0], -Math.PI / 2, '#d8c86a');
    // data plates, riveted on by the doors and at the stations, and the bottles' and boxes' stencils
    const plate = (lines, w, [x, y, z], rot) => {
      const h = (w / 4) * lines.length + 0.02, n = new V(Math.sin(rot), 0, Math.cos(rot));
      const g = new THREE.BoxGeometry(w + 0.02, h, 0.004).rotateY(rot).translate(x - n.x * 0.003, y, z - n.z * 0.003);
      this.add(MAT.dark, g);
      this.stencil(lines, w, [x + n.x * 0.0005, y, z + n.z * 0.0005], rot, '#cfc8b0');
    };
    plate(['BOEING B-17G-35-BO', 'AAF SER. NO. 42-31909', 'SEATTLE WASH.'], 0.16, [-0.45, -0.95, -1.32], 0);
    plate(['EMERGENCY EXIT', 'PULL HANDLE'], 0.14, [0.62, -1.0, 6.18], Math.PI);
    plate(['FUEL TRANSFER', 'VALVE - DO NOT', 'OPERATE IN FLIGHT'], 0.15, [0.5, -0.55, -2.62], Math.PI);
    plate(['A-12 OXYGEN', 'REGULATOR', '400 PSI MAX'], 0.12, [-0.7, -1.25, 1.2], Math.PI / 2);
    for (const [x, y, z] of [[-0.85, -0.15, -7.05], [0.85, -0.15, -7.05], [0.8, -1.5, -2.2], [0.8, -1.5, -1.95]]) {
      const rot = x < 0 ? Math.PI / 2 : -Math.PI / 2; // (facing into the cabin)
      this.stencil(['OXYGEN'], 0.1, [x - Math.sign(x) * 0.102, y, z], rot, '#1a1a1a');
    }
    for (const s of [-1, 1]) this.stencil(['CAL .50', 'M2 LINKED'], 0.16, [s * 0.32, -2.17, 8.549], Math.PI, '#d8d0a8');
  }

  /** Sunlight falling through the windows: soft shafts that follow the sun as the bomber turns. */
  buildShafts() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,240,210,0.0)'); grd.addColorStop(0.15, 'rgba(255,240,210,1)'); grd.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
    const map = new THREE.CanvasTexture(c);
    // (the waist windows only: the radio room's showed as a pale slab across the floor)
    this.shafts = [[-1.0, -1.0, 1.78, -1], [1.0, -1.0, 1.82, 1]].map(([x, y, z, side]) => {
      const geo = new THREE.CylinderGeometry(0.28, 0.45, 2.4, 10, 1, true).translate(0, -1.2, 0); // from the window inwards
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      mesh.position.set(x, y, z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      return { mesh, side };
    });
  }

  /** sunLocal: the direction to the sun in bomber space. A shaft shows when the sun is on its side. */
  updateShafts(sunLocal) {
    if (!this.shafts) this.buildShafts();
    const down = _sd.copy(sunLocal).negate();
    for (const { mesh, side } of this.shafts) {
      mesh.quaternion.setFromUnitVectors(_up, _sd2.copy(down).negate()); // its axis points back up the sun ray
      mesh.material.opacity = 0.03 * THREE.MathUtils.clamp(sunLocal.x * side, 0, 1);
    }
  }

  /**
   * By night the cabin has its own dim lights: the instrument glow in the cockpit, a lamp at the
   * navigator's table and the radio desk, and low lamps down the waist and in the tail. (Added only
   * at night: every light costs every lit surface something.)
   */
  setNight(k) {
    // (always in the scene, at nothing by day: adding lights later would rebuild every shader, a freeze)
    if (!this.nightLights) {
      this.nightLights = [
        [0xffa860, 0.28, 1.4, [0, 0.62, -8.0]], // the instrument panels: a little warm light on the dials
        [0xffc890, 0.22, 1.2, [-0.4, 0.1, -9.6]], // the navigator's lamp, over his table
        [0xffc890, 0.22, 1.3, [-0.5, -0.8, -1.9]], // the radio desk
        [0xff9a70, 0.12, 2.5, [0, -0.6, 2.2]], // the waist
        [0xff9a70, 0.1, 1.6, [0, -1.5, 8.6]], // the tail
      ].map(([c, i, d, p]) => { const l = new THREE.PointLight(c, 0, d, 2); l.position.set(...p); l.userData.full = i; return l; });
      for (const l of this.nightLights) this.group.add(l);
    }
    for (const l of this.nightLights) l.intensity = l.userData.full * k;
  }

  buildTail() {
    this.box(-0.25, 0.25, -2.32, -2.17, 9.65, 9.95, MAT.leather); // knee pad
    // (the compartment itself, its windows, frames and armour: buildTailCab)
    this.buildTailGlazing();
    this.buildTailCab();
    this.buildNoseGlazing();
    this.ballCockpit = buildBallTurret(); // the inside of the ball turret, mounted on the camera while you're in it
    this.topCockpit = buildTopTurret(); // and the upper turret's dome
    this.buildTopDome();
  }

  /**
   * The tail gunner's fittings: the canvas boot where the guns go out through the armour, the padding,
   * the oxygen regulator and its hose, the interphone box, a little lamp and the stencils.
   */
  buildTailGlazing() {
    const fz = 10.5;
    for (const m of this.parts.get('TailGunPod') ?? []) m.visible = false; // (the cab has its own pod: buildTailCab)
    // the canvas boot round the guns where they pass out through the armour, gathered in folds
    const boot = new THREE.CylinderGeometry(0.1, 0.16, 0.12, 16, 3, true).rotateX(Math.PI / 2);
    const bp = boot.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const a = Math.atan2(bp.getY(i), bp.getX(i)), f = 1 + 0.08 * Math.sin(a * 9) * (0.5 + bp.getZ(i) * 4);
      bp.setXY(i, bp.getX(i) * f * 1.3, bp.getY(i) * f * 0.75);
    }
    boot.computeVertexNormals();
    this.add(MAT.canvas, boot.translate(0, -2.36, fz - 0.07));
    // quilted padding on the compartment's walls
    for (const sd of [-1, 1]) {
      const x = sd * (this.hw(9.85, -1.95) - 0.02);
      const g = new THREE.PlaneGeometry(0.5, 0.32); g.rotateY(-sd * Math.PI / 2);
      this.add(MAT.pad, g.translate(x, -1.95, 9.78));
    }
    // the A-12 oxygen regulator, its blinker and hose; the interphone jack box
    const rx = -(this.hw(9.55, -1.8) - 0.04), jx = this.hw(9.55, -1.85) - 0.04;
    this.box(rx - 0.03, rx + 0.03, -1.86, -1.74, 9.5, 9.62, MAT.dark, false);
    this.cylinder(0.022, 0.012, rx + 0.032, -1.8, 9.56, 'x', MAT.metal, 12);
    this.rod([rx + 0.02, -1.86, 9.56], [rx + 0.1, -2.05, 9.7], 0.011, MAT.hose);
    this.box(jx - 0.025, jx + 0.025, -1.9, -1.8, 9.5, 9.58, MAT.green, false);
    this.cylinder(0.008, 0.02, jx - 0.03, -1.83, 9.54, 'x', MAT.metal, 8);
    // a small lamp on the roof, and the seat cushion he half sits on
    this.cylinder(0.03, 0.025, 0, this.ceilingAt(9.45, 0, -2.3) - 0.02, 9.45, 'y', MAT.dark, 10);
    this.box(-0.15, 0.15, -2.06, -1.99, 9.5, 9.66, MAT.leather, false);
    this.stencil(['CAL .50 AMMUNITION'], 0.2, [-0.32, -2.12, 9.151], 0, '#d8d0a8');
    this.stencil(['OXYGEN'], 0.08, [rx + 0.031, -1.765, 9.56], Math.PI / 2, '#d8c86a');
    this.stencil(['INTERPHONE'], 0.07, [jx - 0.026, -1.88, 9.54], -Math.PI / 2, '#e8e2c8');
  }

  /**
   * The tail gunner's cab, as the B-17G's Cheyenne tail was built: a skin of riveted panels on ring
   * frames and stringers, with Plexiglas side windows in two panes each, the big rear window above the
   * guns, the gun pod below it with the armour plate and its bolts, the slot the guns go out through,
   * and every pane in a riveted frame at its edges (the middle of the gunner's view is all glass).
   * Inside: the frames, the stringers, the feed tracks from the ammunition boxes to the guns and the
   * knee pads he kneels on. The cab follows the hull's own shape (the cross-section table).
   */
  buildTailCab() {
    const NT = 40, top = (z) => (z > CAB.step ? -1.84 : cabCut(z) + 0.03); // (the pod: no higher than the rear window's sill)
    // a cross-section ring at z: rays out from the middle to the skin (up to just over the fin root)
    const ring = (z, cy) => {
      const pts = [];
      for (let k = 0; k <= NT; k++) {
        const a = (k / NT) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
        let r = 0.02;
        while (r < 1 && cy + dy * r < top(z) && Math.abs(dx * r) < this.hwSmooth(z, cy + dy * r) - 0.003) r += 0.005;
        pts.push(new V(dx * r, cy + dy * r, z));
      }
      for (let pass = 0; pass < 2; pass++) { const c = pts.map((p) => p.clone()); for (let k = 0; k < NT; k++) pts[k].lerpVectors(c[(k + NT - 1) % NT], c[(k + 1) % NT], 0.5).lerp(c[k], 0.5); pts[NT].copy(pts[0]); }
      return pts;
    };
    const skinOut = std(0x4b5135, 0.75, 0.15), skinIn = Object.assign(std(0x6f7462, 0.75, 0.3), { side: THREE.BackSide });
    skinOut.userData.outside = true;
    const glass = plexiglas(null, THREE.DoubleSide, 0.07);
    const metal = [], panes = [];
    // the body, z0 .. the step, and the pod, the step .. its end
    const loft = (z0, z1, n, cy, glassAt) => {
      const rings = []; for (let i = 0; i <= n; i++) rings.push(ring(z0 + ((z1 - z0) * i) / n, cy));
      for (let i = 0; i < n; i++) for (let k = 0; k < NT; k++) {
        const q = [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]];
        const c = q.reduce((a, p) => a.add(p), new V()).multiplyScalar(0.25);
        (glassAt?.(c) ? panes : metal).push(q);
      }
      return rings;
    };
    const SIDE = { z0: 9.64, z1: 10.285, zMid: 9.94, y0: -2.0 }; // the side windows (two panes a side)
    const sideGlass = (c) => c.z > SIDE.z0 && c.z < SIDE.z1 && Math.abs(c.z - SIDE.zMid) > 0.02 && c.y > SIDE.y0 && c.y < top(c.z) - 0.07 && Math.abs(c.x) > 0.12;
    const body = loft(CAB.z0, CAB.step, 15, -1.95, sideGlass);
    const pod = loft(CAB.step + 0.03, 10.55, 5, -2.15, null);
    // the rear face at the step: the big rear window above the pod, metal round it
    const rear = body[body.length - 1], wy = -1.86, rc = new V(0, -1.62, CAB.step);
    // the glass: one pane right down to the sill, fanned from the sill's middle out to the frame (and to
    // where the frame meets the sill), so there's no gap above the sill; metal below it
    const sill = new V(0, wy, CAB.step), cut = (a, b) => a.clone().lerp(b, (wy - a.y) / (b.y - a.y));
    for (let k = 0; k < NT; k++) {
      const a = rear[k], b = rear[k + 1];
      if (a.y > wy && b.y > wy) panes.push([sill, b, a]);
      else if (a.y > wy || b.y > wy) panes.push(a.y > wy ? [sill, cut(a, b), a] : [sill, b, cut(a, b)]); // (the piece of a frame segment above the sill)
      if (a.y <= wy || b.y <= wy) metal.push([rc.clone().setY(-1.95), b, a]); // (wound the other way: flipped below, its normal points aft)
    }
    // the pod's end: a cap with the slot the guns go out through
    const end = pod[pod.length - 1], ec = new V(0, -2.15, 10.55);
    for (let k = 0; k < NT; k++) metal.push([ec, end[k + 1], end[k]]);
    const geo = (list, flip) => {
      const pos = [], uv = [];
      for (const poly of list) for (let t = 1; t < poly.length - 1; t++) for (const p of flip ? [poly[0], poly[t + 1], poly[t]] : [poly[0], poly[t], poly[t + 1]]) { pos.push(p.x, p.y, p.z); uv.push(0.5, 0.5); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    };
    const mg = geo(metal, true); // (wound so the normals point out)
    const outer = new THREE.Mesh(mg, skinOut), inner = new THREE.Mesh(mg, skinIn);
    outer.castShadow = true; outer.receiveShadow = inner.receiveShadow = true;
    outer.name = inner.name = 'TailCab';
    const gm = new THREE.Mesh(geo(panes, true), glass); gm.renderOrder = 4; gm.name = 'TailCab_glass';
    this.group.add(outer, inner, gm);
    // the frames round every pane, riveted: along the window edges (where glass meets metal) and between panes
    const edge = (a, b) => {
      this.rod(a.toArray(), b.toArray(), 0.011, MAT.dark, 5);
      const L = a.distanceTo(b);
      for (let t = 0.02; t < L; t += 0.045) this.add(MAT.metal, new THREE.SphereGeometry(0.0042, 4, 3).translate(...a.clone().lerp(b, t / L).toArray()));
    };
    const inset = (p, d = 0.008) => p.clone().sub(new V(0, p.z > CAB.step ? -2.15 : -1.95, p.z).setZ(p.z)).multiplyScalar(-d).add(p);
    const isGlass = new Set(panes.map((q) => q.map((p) => p.toArray().join()).join('|')));
    const quadAt = (i, k) => [body[i][k], body[i + 1][k], body[i + 1][k + 1], body[i][k + 1]];
    const glassQ = (i, k) => i >= 0 && i < body.length - 1 && isGlass.has(quadAt(i, (k + NT) % NT).map((p) => p.toArray().join()).join('|'));
    for (let i = 0; i < body.length - 1; i++) for (let k = 0; k < NT; k++) {
      if (!glassQ(i, k)) continue;
      const q = quadAt(i, k);
      if (!glassQ(i - 1, k)) edge(inset(q[0]), inset(q[3])); // fore edge
      if (!glassQ(i + 1, k)) edge(inset(q[1]), inset(q[2])); // aft edge
      if (!glassQ(i, k - 1)) edge(inset(q[0]), inset(q[1])); // lower / upper edges
      if (!glassQ(i, k + 1)) edge(inset(q[3]), inset(q[2]));
    }
    for (let k = 0; k < NT; k++) { const a = rear[k], b = rear[k + 1]; if (a.y > wy || b.y > wy) edge(inset(a, 0.01).setZ(CAB.step - 0.01), inset(b, 0.01).setZ(CAB.step - 0.01)); }
    { let xl = Infinity, xr = -Infinity; for (const p of rear) if (Math.abs(p.y - wy) < 0.06) { xl = Math.min(xl, p.x); xr = Math.max(xr, p.x); } // the rear window's sill
      if (Number.isFinite(xl)) edge(new V(xl + 0.02, wy, CAB.step - 0.012), new V(xr - 0.02, wy, CAB.step - 0.012)); }
    // ring frames and stringers inside the cab, clear of the windows' middle
    for (const i of [0, 5, 10, 15]) {
      const r = body[Math.min(i, body.length - 1)];
      for (let k = 0; k < NT; k++) if (!(glassQ(i, k) || glassQ(i - 1, k))) this.rod(inset(r[k], 0.03).toArray(), inset(r[k + 1], 0.03).toArray(), 0.01, MAT.metal, 4);
    }
    for (const k of [Math.round(NT * 0.62), Math.round(NT * 0.75), Math.round(NT * 0.88)]) for (let i = 0; i < body.length - 1; i++) this.rod(inset(body[i][k], 0.015).toArray(), inset(body[i + 1][k], 0.015).toArray(), 0.007, MAT.metal, 4); // (stringers along the floor and lower walls)
    // the armour plate across the pod under the rear window, bolted, with the slot for the guns
    const az = CAB.step - 0.03;
    for (const [x0, x1, y0, y1] of [[-0.38, -0.16, -2.42, -1.87], [0.16, 0.38, -2.42, -1.87], [-0.16, 0.16, -2.04, -1.87], [-0.16, 0.16, -2.5, -2.42]]) {
      this.box(x0, x1, y0, y1, az - 0.012, az + 0.012, MAT.metal, false);
      for (const x of [x0 + 0.025, x1 - 0.025]) for (const y of [y0 + 0.025, y1 - 0.025]) this.cylinder(0.008, 0.012, x, y, az - 0.016, 'z', MAT.dark, 6); // bolt heads
    }
    // the feed tracks: from the ammunition boxes forward along the floor and up to each gun's feed
    for (const sd of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([new V(sd * 0.3, -2.02, 9.1), new V(sd * 0.27, -2.15, 9.6), new V(sd * 0.2, -2.25, 10.0), new V(sd * 0.1, -2.34, CAB.step + 0.08)]);
      this.add(MAT.chute, new THREE.TubeGeometry(c, 20, 0.03, 4, false));
      for (let i = 1; i < 20; i++) { const p = c.getPointAt(i / 20), t = c.getTangentAt(i / 20); this.add(MAT.dark, new THREE.TorusGeometry(0.033, 0.004, 3, 4).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), t)).translate(p.x, p.y, p.z)); }
      this.box(sd * 0.18 - 0.07, sd * 0.18 + 0.07, -2.32, -2.27, 9.72, 9.98, MAT.leather, false); // a knee pad
    }
  }

  /**
   * The B-17F's nose: one blown Plexiglas cone (the model's is a faint, faceted sheet that read as open
   * air), round and smooth from the fuselage's last frame to its tip, with the riveted ring that holds
   * it to the fuselage, short struts over the top and below (its middle clear), the two gun sockets, and low
   * in front of the Norden the optically flat bomb-aiming panel in its own frame. Plexiglas in the cheek
   * gun windows too (found the way the tail's are, see glazeWindows).
   */
  buildNoseGlazing() {
    const z0 = -10.62, L = 0.76, NU = 24, NT = 48;
    // the base ring: the fuselage's own cross-section where the cone meets it, measured round its middle
    let lo = 0.6, hi = -1.2;
    for (let y = -1.2; y <= 0.8; y += 0.02) if (this.hwSmooth(z0, y) > 0.03) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const cy = (lo + hi) / 2, r0 = [];
    for (let k = 0; k <= NT; k++) {
      const a = (k / NT) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let r = 0;
      while (r < 1.2 && Math.abs(dx * (r + 0.01)) < this.hwSmooth(z0, cy + dy * (r + 0.01))) r += 0.01;
      r0.push(r);
    }
    for (let pass = 0; pass < 4; pass++) { // (the measured outline steps from cell to cell: smooth it round)
      const c = r0.slice();
      for (let k = 0; k <= NT; k++) r0[k] = (c[(k + NT - 1) % NT] + 2 * c[k % NT] + c[(k + 1) % NT]) / 4;
    }
    r0[NT] = r0[0];
    // the cone: an ellipsoid on that ring, its middle rising a little towards the tip (as the real one's does)
    const at = (u, k, inset = 0) => {
      const a = (k / NT) * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - u * u)), r = Math.max(0, r0[k] * s - inset);
      return new V(Math.cos(a) * r, cy + 0.16 * u * u + Math.sin(a) * r, z0 - L * u);
    };
    // (the cone's radius towards a point, for keeping a gunner's head inside it: weapons.js)
    this.noseCone = { z0, L, cy, radius: (x, y, z) => { const u = THREE.MathUtils.clamp((z0 - z) / L, 0, 0.999), k = ((Math.atan2(y - cy - 0.16 * u * u, x) / (Math.PI * 2) + 1) % 1) * NT; return r0[Math.round(k)] * Math.sqrt(1 - u * u); } };
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= NU; i++) {
      const u = Math.sin((i / NU) * Math.PI / 2) ** 1.4 * 0.999; // (rows closer together near the tip)
      for (let k = 0; k <= NT; k++) { const p = at(u, k); pos.push(p.x, p.y, p.z); uv.push(u * 0.5, 0.5); }
    }
    for (let i = 0; i < NU; i++) for (let k = 0; k < NT; k++) {
      const a = i * (NT + 1) + k, b = a + NT + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const cone = new THREE.BufferGeometry();
    cone.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cone.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cone.setIndex(idx); cone.computeVertexNormals();
    const glass = plexiglas(null, THREE.DoubleSide, 0.09); // (a touch more there than the tail's: it's all round you)
    const mesh = new THREE.Mesh(cone, glass);
    mesh.renderOrder = 4; mesh.name = 'NoseCone';
    this.group.add(mesh);
    const nose = this.model.getObjectByName('Nose'); // (this one replaces it, in your bomber)
    if (nose) nose.visible = false;
    // the frames: a heavy riveted ring at the base, two ribs over the top, a ring frame round the middle
    const ringAt = (u, inset, r, mat, rivets) => {
      for (let k = 0; k < NT; k++) {
        const a = at(u, k, inset), b = at(u, k + 1, inset);
        this.rod(a.toArray(), b.toArray(), r, mat, 6);
        if (rivets) this.add(MAT.metal, new THREE.SphereGeometry(0.005, 5, 3).translate(...at(u, k + 0.5, inset + r).toArray()));
      }
    };
    ringAt(0.004, 0.012, 0.018, MAT.dark, true);
    // the struts, short of the middle (the guns and the sight look out through clear glass): two over
    // the top, two down either side of the flat panel below
    for (const [k, u1] of [[NT * 0.25 - 3, 0.55], [NT * 0.25 + 3, 0.55], [NT * 0.75 - 5, 0.5], [NT * 0.75 + 5, 0.5]]) for (let i = 0; i < 8; i++) {
      const u0 = i / 8 * u1, u2 = (i + 1) / 8 * u1;
      this.rod(at(u0, k, 0.008).toArray(), at(u2, k, 0.008).toArray(), 0.008, MAT.dark, 5);
    }
    // the two gun sockets: a steel ball in a heavy collar set into the glass, a doubler ring round it
    // (the Browning's jacket goes out through the ball: weapons.js, socketGun)
    for (const st of STATIONS) {
      if (!st.ball) continue;
      const c = new V(...st.pivot), n = c.clone().sub(new V(0, cy, z0)).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), n);
      this.add(MAT.metal, new THREE.SphereGeometry(0.062, 16, 10).translate(c.x, c.y, c.z));
      this.add(MAT.dark, new THREE.TorusGeometry(0.07, 0.016, 8, 24).applyQuaternion(q).translate(c.x, c.y, c.z));
      this.add(MAT.dark, new THREE.TorusGeometry(0.12, 0.008, 6, 28).applyQuaternion(q).translate(...c.clone().addScaledVector(n, 0.012).toArray()));
      for (let i = 0; i < 8; i++) { // its bolts through the glass
        const a = (i / 8) * Math.PI * 2, b = new V(Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0.012).applyQuaternion(q).add(c);
        this.add(MAT.metal, new THREE.SphereGeometry(0.006, 5, 3).translate(b.x, b.y, b.z));
      }
    }
    // the optically flat panel, low at the front: a flat pane just inside the cone, in a riveted frame
    const pc = at(0.6, NT * 0.75, 0.012);
    const n = new V().subVectors(at(0.6, NT * 0.75), at(0.6, NT * 0.75, 0.05)).normalize(); // outward
    const ex = new V(1, 0, 0), ey = new V().crossVectors(n, ex).normalize(); // across, and up the slope
    const w = 0.15, h = 0.12, corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([a, b]) => pc.clone().addScaledVector(ex, a).addScaledVector(ey, b));
    const flat = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
    flat.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    flat.computeVertexNormals();
    const fm = new THREE.Mesh(flat, glass); fm.renderOrder = 4; fm.name = 'NoseFlat'; this.group.add(fm);
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      this.rod(a.toArray(), b.toArray(), 0.011, MAT.dark, 6);
      for (let t = 0.1; t < 1; t += 0.2) this.add(MAT.metal, new THREE.SphereGeometry(0.0045, 5, 3).translate(...a.clone().lerp(b, t).addScaledVector(n, -0.01).toArray()));
    }
    // the cheek windows: where the side panels' paint marks a window, Plexiglas in it (as the tail pod's)
    const [cheeks] = this.parts.get('FrontGunPanels') ?? [];
    if (cheeks) {
      if (!cheeks.material.alphaTest) cheeks.material = windowCutout(cheeks.material.clone());
      const cg = new THREE.Mesh(cheeks.geometry, plexiglas(cheeks.material.map));
      cg.position.copy(cheeks.position); cg.quaternion.copy(cheeks.quaternion); cg.scale.copy(cheeks.scale);
      cg.renderOrder = 4; cg.name = 'FrontGunPanels_glass';
      cheeks.parent.add(cg);
      this.parts.get('FrontGunPanels').push(cg); // (hidden and ghosted with them)
    }
  }

  /**
   * The top turret's glass dome as seen from inside the bomber (from below, through the ring): the
   * same dome you have round your head in the turret, fixed on the ring and turned with the turret,
   * so you see the engineer's head and shoulders up in the glass and the sky beyond. (Hidden while
   * you're in the turret yourself: then it's on your camera.)
   */
  buildTopDome() {
    const s = STATIONS.find((x) => x.id === 'top');
    this.topDome = buildTopTurret();
    this.topDome.remove(this.topDome.children[1]); // (not the gunsight: that rides with the gunner's head)
    this.topDome.position.copy(s.eye);
    this.group.add(this.topDome);
  }
}
