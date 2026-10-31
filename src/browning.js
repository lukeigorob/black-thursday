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
    parker: new THREE.MeshStandardMaterial({ color: 0x2c2e2b, roughness: 0.72, metalness: 0.55, envMapIntensity: 0.25 }), // the receiver's parkerised finish
    grip: new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 0.45, metalness: 0.05, envMapIntensity: 0.4 }), // bakelite spade grips
    canvas: new THREE.MeshStandardMaterial({ color: 0x7a6e52, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), // the case bag
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
export function buildBrowning(kind, front, rear = 0.12, inside = false, opts = {}) {
  const M = inside ? (MATS.inside ??= Object.fromEntries(Object.entries(materials()).map(([k, m]) => [k, insideLight(m)]))) : MATS.outside;
  const steel = [], parker = [], grip = [], jacket = [], brass = [], canvas = [];
  const g = new THREE.Group();
  let j0 = 0; // where the jacket starts
  if (kind === 'flex') {
    // the receiver: the trunnion block at its front (on the mount's pins, at the pivot), the back plate
    // `rear` behind; the belt comes in on the `feed` side (-1 its left, 1 its right, from behind it)
    const fd = opts.feed ?? -1, r0 = rear, r1 = Math.max(rear - 0.55, -front + 0.95), L = r0 - r1, zm = (r0 + r1) / 2;
    parker.push(box(0.1, 0.13, L, 0, 0.005, zm)); // the box
    for (const s of [-1, 1]) {
      parker.push(box(0.005, 0.112, L * 0.94, s * 0.0515, 0.003, zm)); // its side plates, riveted on
      for (let k = 0; k < 9; k++) for (const y of [-0.042, 0.048]) steel.push(new THREE.SphereGeometry(0.0045, 5, 3).translate(s * 0.054, y, r1 + 0.04 + (k / 8) * (L - 0.08)));
    }
    parker.push(box(0.106, 0.024, L * 0.58, 0, 0.081, r0 - L * 0.31)); // the top cover, hinged at its front
    steel.push(cyl(0.008, 0.008, -0.056, 0.056, 8).rotateY(Math.PI / 2).translate(0, 0.084, r0 - L * 0.6)); // its hinge pin
    steel.push(box(0.03, 0.014, 0.03, 0, 0.098, r0 - 0.035)); // and the latch at its back
    parker.push(box(0.045, 0.03, 0.12, fd * 0.07, 0.055, r0 - L * 0.38)); // the feed tray, out on the belt's side
    steel.push(box(0.012, 0.03, 0.05, fd * 0.093, 0.06, r0 - L * 0.38)); // its belt-holding pawl
    steel.push(box(0.05, 0.004, 0.11, 0, -0.061, r0 - L * 0.4)); // the case ejection slot, underneath
    steel.push(box(0.012, 0.024, L * 0.62, -fd * 0.06, 0.02, r0 - L * 0.42)); // the charging slide, on the other side
    steel.push(cyl(0.011, 0.011, 0, 0.05, 8).rotateY(Math.PI / 2).translate(-fd * 0.068, 0.02, r0 - L * 0.2)); // its handle
    steel.push(new THREE.SphereGeometry(0.016, 8, 6).translate(-fd * 0.12, 0.02, r0 - L * 0.2)); // (the knob)
    steel.push(box(0.126, 0.162, 0.022, 0, 0.004, r0 + 0.011)); // back plate
    steel.push(cyl(0.022, 0.02, r0 + 0.02, r0 + 0.06, 12).translate(0, 0.015, 0)); // the buffer tube out of it
    // the spade grips: a bracket each side of the back plate, a handle hanging from it, leaning back
    for (const s of [-1, 1]) {
      steel.push(box(0.016, 0.022, 0.08, s * 0.058, 0.052, r0 + 0.05), box(0.016, 0.018, 0.07, s * 0.058, -0.088, r0 + 0.045));
      grip.push(cyl(0.017, 0.015, -0.065, 0.065, 10).rotateX(Math.PI / 2 - 0.3).translate(s * 0.058, -0.02, r0 + 0.085));
      grip.push(new THREE.SphereGeometry(0.018, 8, 5).translate(s * 0.058, -0.083, r0 + 0.066)); // (its rounded foot)
    }
    // the butterfly trigger between them: two wings, thumbed down to fire
    for (const s of [-1, 1]) steel.push(box(0.04, 0.006, 0.03, 0, 0, 0).rotateZ(s * 0.25).translate(s * 0.019, 0.018, r0 + 0.05));
    steel.push(box(0.012, 0.03, 0.012, 0, -0.002, r0 + 0.035));
    // the ring sight: rings and cross wires on a bracket off the cover; the post, a bead out on the jacket
    // (at SIGHT over the bore line: the gunner's eye looks through the ring onto the bead)
    const rz = r0 - 0.12;
    steel.push(new THREE.TorusGeometry(0.045, 0.0028, 5, 32).translate(0, SIGHT, rz), new THREE.TorusGeometry(0.015, 0.002, 4, 18).translate(0, SIGHT, rz));
    for (let k = 0; k < 4; k++) steel.push(box(0.0018, 0.03, 0.0018, 0, 0.03, 0).rotateZ(k * Math.PI / 2).translate(0, SIGHT, rz));
    steel.push(box(0.008, SIGHT - 0.14, 0.012, 0, (SIGHT + 0.093 - 0.045) / 2, rz), box(0.03, 0.01, 0.04, 0, 0.098, rz)); // its stem and clamp
    steel.push(box(0.004, SIGHT - 0.03, 0.004, 0, (SIGHT + 0.03) / 2, -front + 0.3), new THREE.SphereGeometry(0.006, 8, 5).translate(0, SIGHT, -front + 0.3)); // the bead post
    steel.push(cyl(0.04, 0.04, -front + 0.33, -front + 0.27, 14)); // (its clamp on the jacket)
    // the trunnion block, its pins in the mount's yoke, and the recoil adapter under it: a spring buffer
    // that lets the gun kick back in the mount
    steel.push(box(0.12, 0.155, 0.085, 0, 0.0, r1 - 0.04));
    steel.push(cyl(0.017, 0.017, -0.09, 0.09, 10).rotateY(Math.PI / 2).translate(0, -0.01, 0));
    steel.push(cyl(0.028, 0.028, -0.12, 0.14, 12).translate(0, -0.09, 0));
    for (let k = 0; k < 6; k++) steel.push(new THREE.TorusGeometry(0.031, 0.004, 4, 12).translate(0, -0.09, -0.1 + k * 0.045));
    steel.push(box(0.07, 0.04, 0.05, 0, -0.065, 0.12)); // (and its clamp up to the receiver)
    j0 = r1 - 0.082;
    g.userData.grips = [new THREE.Vector3(-0.058, -0.03, r0 + 0.08), new THREE.Vector3(0.058, -0.03, r0 + 0.08)];
    // the belt: into the feed tray from the chute's mouth, a few rounds side by side in their links
    for (let k = 0; k < 6; k++) {
      const x = fd * (0.09 + k * 0.022), y = 0.055 - (k / 5) ** 2 * 0.07;
      brass.push(cyl(0.0065, 0.0065, -0.05, 0.05, 6).translate(x, y, r0 - L * 0.38));
      steel.push(box(0.008, 0.004, 0.08, x, y + 0.008, r0 - L * 0.38));
    }
    steel.push(box(0.06, 0.05, 0.13, fd * 0.205, -0.03, r0 - L * 0.38)); // the chute's end fitting, latched to the tray
    g.userData.feed = new THREE.Vector3(fd * 0.205, -0.055, r0 - L * 0.38); // where the chute (weapons.js) comes up to
    g.userData.feedSide = fd;
    g.userData.receiver = new THREE.Vector3(0, -0.07, r0 - L * 0.4); // the ejection slot, underneath
    if (opts.bag) { // a canvas bag under the slot to catch the cases, hung from a frame clipped to the receiver
      steel.push(box(0.07, 0.012, 0.15, 0, -0.072, r0 - L * 0.4));
      const prof = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.035 + Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.62) * 0.05 * (1 - t * t * 0.9), -t * 0.3)); }
      prof.push(new THREE.Vector2(0.001, -0.305));
      const sack = new THREE.LatheGeometry(prof, 14).scale(1, 1, 1.7);
      const sp = sack.attributes.position; // (slack: pulled about, sagging to the back)
      for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); sp.setXYZ(i, sp.getX(i) * (1 + Math.sin(i * 1.7) * 0.06), y, sp.getZ(i) - y * y * 0.4); }
      sack.computeVertexNormals();
      canvas.push(sack.translate(0, -0.075, r0 - L * 0.4));
      g.userData.bag = true;
    }
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
  if (kind === 'flex') steel.push(cyl(0.03, 0.03, -front + 0.2, -front + 0.15, 12), cyl(0.012, 0.016, -front, -front - 0.012, 10)); // (its locking collar, the bore's lip)
  // (a turret's or a fixed barrel's solid parts in one mesh, one draw: the receiver's parkerising and
  // the grips are dark enough to share the steel. A flexible gun, seen up close, gets each its own)
  const flex = kind === 'flex';
  for (const [list, mat] of [[flex ? steel : [...steel, ...parker, ...grip], M.steel], [flex ? parker : [], M.parker], [flex ? grip : [], M.grip], [jacket, M.jacket], [brass, M.brass], [canvas, M.canvas]]) {
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

/**
 * The flexible gun's mount, the part that turns with it in traverse only: the yoke whose two arms carry
 * the trunnion pins (at the origin, the gun's pivot), its cross bar, and the pintle down `drop` metres
 * into the socket on the window sill (weapons.js). Built facing -Z.
 */
export function buildYoke(drop, inside = true) {
  const M = inside ? (MATS.inside ??= Object.fromEntries(Object.entries(materials()).map(([k, m]) => [k, insideLight(m)]))) : MATS.outside;
  const steel = [], parker = [];
  for (const s of [-1, 1]) {
    parker.push(box(0.022, 0.15, 0.06, s * 0.1, -0.075, 0)); // an arm
    steel.push(cyl(0.026, 0.026, -0.016, 0.016, 12).rotateY(Math.PI / 2).translate(s * 0.1, -0.01, 0)); // its pin boss
    steel.push(cyl(0.007, 0.007, -0.006, 0.006, 6).rotateY(Math.PI / 2).translate(s * 0.118, -0.01, 0)); // (the pin's head)
  }
  parker.push(box(0.222, 0.035, 0.07, 0, -0.16, 0)); // the cross bar
  steel.push(new THREE.CylinderGeometry(0.02, 0.02, drop, 12).translate(0, -0.16 - drop / 2, 0)); // the pintle
  steel.push(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 14).translate(0, -0.2, 0)); // its thrust collar
  steel.push(box(0.02, 0.04, 0.02, 0.035, -0.205, 0)); // the traverse lock's lever
  const g = new THREE.Group();
  for (const [list, mat] of [[steel, M.steel], [parker, M.parker]]) {
    const m = new THREE.Mesh(mergeGeometries(list.map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; }), false), mat);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
