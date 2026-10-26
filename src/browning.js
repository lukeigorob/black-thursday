// The Browning M2 .50 calibre, as mounted in a B-17: the flexible guns at the waist windows and in the
// nose cheeks (receiver, back plate and spade grips, the ring-and-post sight, the feed tray and the
// perforated barrel jacket with its muzzle booster), the turret guns (receiver, feed and jacketed barrel:
// the turret has the grips and the sight), and guns of which only the jacketed barrel shows. Built along -Z (where it fires) with the mount's pivot at the origin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { insideLight } from './cabinlook.js';

/** The jacket's cooling holes: rows of slots round a dark steel tube (alpha cut out, so the barrel shows through). */
function jacketTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#000';
  for (let row = 0; row < 16; row++) for (let k = 0; k < 4; k++) { // staggered oval slots
    const x = (k + (row % 2) * 0.5) * 32 + 4, y = row * 32 + 8;
    g.beginPath(); g.ellipse(x + 12, y + 8, 9, 6, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const HOLES = jacketTexture();
function materials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0x232423, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.3 }), // blued, worn
    brass: new THREE.MeshStandardMaterial({ color: 0xb58a3c, roughness: 0.35, metalness: 0.9, envMapIntensity: 0.6 }),
    jacket: new THREE.MeshStandardMaterial({ color: 0x282927, roughness: 0.45, metalness: 0.75, envMapIntensity: 0.3, alphaMap: HOLES, alphaTest: 0.5, side: THREE.DoubleSide }),
  };
}
const MATS = { outside: materials(), inside: null }; // (inside the cabin they're lit by the cabin, see cabinlook.js)

export const SIGHT = 0.22; // m: the sight line over the bore (the waist gunner's eye, interior.js)
const cyl = (r0, r1, z0, z1, seg = 12, open = false) => new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open).rotateX(-Math.PI / 2).translate(0, 0, (z0 + z1) / 2);
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/**
 * kind 'flex': the whole gun, its back plate `rear` metres behind the pivot (z > 0) and its muzzle at
 * `-front`. kind 'barrel': only the jacketed barrel, from the pivot (z = 0) out to the muzzle at -front.
 * kind 'turret': the jacketed barrel from z = 0, and the receiver `rear` metres long behind it.
 * Returns a Group; userData.grips = the spade grips (pivot space), userData.receiver = where the cases eject.
 */
export function buildBrowning(kind, front, rear = 0.12, inside = false) {
  const M = inside ? (MATS.inside ??= Object.fromEntries(Object.entries(materials()).map(([k, m]) => [k, insideLight(m)]))) : MATS.outside;
  const steel = [], parker = [], grip = [], jacket = [], brass = [];
  const g = new THREE.Group();
  let j0 = 0; // where the jacket starts
  if (kind === 'flex') {
    const r0 = rear, r1 = Math.max(rear - 0.62, -front + 0.95); // the receiver: back plate to trunnion block
    parker.push(box(0.105, 0.14, r0 - r1, 0, 0.01, (r0 + r1) / 2)); // receiver body
    parker.push(box(0.11, 0.025, (r0 - r1) * 0.55, 0, 0.09, r0 - (r0 - r1) * 0.3)); // the feed cover on top
    parker.push(box(0.05, 0.02, 0.12, -0.075, 0.05, r0 - 0.22)); // the feed tray, the belt comes in from the side
    steel.push(box(0.12, 0.16, 0.02, 0, 0.005, r0 + 0.01)); // back plate
    steel.push(box(0.04, 0.03, 0.18, 0.06, 0.03, r0 - 0.15)); // the charging handle's slide
    steel.push(box(0.12, 0.17, 0.08, 0, 0.0, r1 - 0.04)); // trunnion block
    for (const s of [-1, 1]) { // spade grips, angled back and out, the trigger between them
      grip.push(cyl(0.016, 0.013, 0, 0.11, 8).rotateX(-1.2).translate(s * 0.055, -0.02, r0 + 0.04));
      steel.push(box(0.01, 0.06, 0.05, s * 0.055, 0.01, r0 + 0.035));
    }
    steel.push(box(0.04, 0.012, 0.03, 0, -0.02, r0 + 0.05)); // butterfly trigger
    // the ring-and-post sight: the ring over the receiver, the post out on the jacket
    // (at SIGHT over the bore line: the gunner's eye looks through the ring onto the post)
    const ring = new THREE.TorusGeometry(0.035, 0.0025, 5, 28).translate(0, SIGHT, r0 - 0.16);
    steel.push(ring, box(0.006, SIGHT - 0.135, 0.006, 0, (SIGHT - 0.035 + 0.1) / 2, r0 - 0.16), box(0.004, SIGHT - 0.032, 0.004, 0, (SIGHT + 0.032) / 2, -front + 0.33));
    // the mount's cradle under the receiver, at the pivot, and its trunnion cheeks
    steel.push(box(0.12, 0.035, 0.18, 0, -0.085, 0));
    for (const s of [-1, 1]) steel.push(box(0.012, 0.09, 0.09, s * 0.062, -0.045, 0));
    j0 = r1 - 0.08;
    g.userData.grips = [new THREE.Vector3(-0.055, -0.04, r0 + 0.08), new THREE.Vector3(0.055, -0.04, r0 + 0.08)];
    // the belt: out of the feed tray on the left, sagging away down to its box, rounds side by side in their links
    const belt = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.1, 0.05, r0 - 0.22), new THREE.Vector3(-0.3, -0.05, r0 - 0.2), new THREE.Vector3(-0.32, -0.45, r0 - 0.12));
    for (let k = 0; k <= 22; k++) {
      const p = belt.getPoint(k / 22), t = belt.getTangent(k / 22);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t);
      brass.push(new THREE.CylinderGeometry(0.0065, 0.0065, 0.1, 6).rotateX(Math.PI / 2).applyQuaternion(q).translate(p.x, p.y, p.z)); // a round (case and bullet), across the belt
      steel.push(new THREE.BoxGeometry(0.01, 0.003, 0.03).applyQuaternion(q).translate(p.x, p.y, p.z)); // its link
    }
    g.userData.receiver = new THREE.Vector3(0.06, 0.03, r0 - 0.28); // the ejection port, on the right
  }
  if (kind === 'turret') { // the receiver behind the jacket, its feed cover and the belt coming in from the side
    parker.push(box(0.085, 0.115, rear, 0, 0, rear / 2 + 0.02));
    parker.push(box(0.088, 0.018, rear * 0.5, 0, 0.066, rear * 0.35));
    steel.push(box(0.092, 0.125, 0.018, 0, 0, rear + 0.03), box(0.095, 0.13, 0.05, 0, 0, 0.02)); // back plate, trunnion block
    steel.push(box(0.025, 0.025, rear * 0.55, 0.055, 0.02, rear * 0.6)); // the charging handle's slide
    steel.push(box(0.012, 0.05, 0.012, 0.072, 0.02, rear * 0.82), box(0.04, 0.012, 0.012, 0.085, 0.045, rear * 0.82)); // its T-handle
    steel.push(cyl(0.008, 0.008, -0.048, 0.048, 8).rotateY(Math.PI / 2).translate(0, 0.074, rear * 0.62)); // the feed cover's hinge pin
    steel.push(cyl(0.022, 0.022, rear + 0.04, rear + 0.1, 10)); // the buffer tube out of the back plate
    for (let k = 0; k < 7; k++) for (const s of [-1, 1]) for (const y of [-0.035, 0.035]) steel.push(new THREE.SphereGeometry(0.005, 5, 3).translate(s * 0.0435, y, 0.04 + (k / 6) * (rear - 0.06))); // rivets down the side plates
    parker.push(box(0.05, 0.045, 0.1, -0.065, 0.01, rear * 0.4)); // the feed tray, the belt coming in from the side
    g.userData.receiver = new THREE.Vector3(0.06, 0.02, rear * 0.45);
  }
  const jLen = Math.max(0.2, front - 0.22 + j0);
  jacket.push(cyl(0.032, 0.032, j0, j0 - jLen, 14, true));
  steel.push(cyl(0.034, 0.034, j0, j0 - 0.025, 14), cyl(0.034, 0.034, j0 - jLen + 0.02, j0 - jLen, 14)); // the jacket's end collars
  steel.push(cyl(0.012, 0.012, j0, -front + 0.06, 8)); // the barrel inside it
  steel.push(cyl(0.026, 0.018, -front + 0.2, -front, 12)); // muzzle booster
  // (all the solid parts in one mesh, one draw: the receiver's parkerising and the grips' wood are dark enough to share the steel)
  for (const [list, mat] of [[[...steel, ...parker, ...grip], M.steel], [jacket, M.jacket], [brass, M.brass]]) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list.map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; }), false), mat);
    if (mat === M.jacket) m.geometry = jacketUV(m.geometry, jLen);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** UVs for the jacket: round the tube and along it, the slots repeated every few cm. */
function jacketUV(geo, len) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (Math.atan2(p.getY(i), p.getX(i)) / (Math.PI * 2) + 0.5) * 2;
    uv[i * 2 + 1] = p.getZ(i) / 0.12;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
