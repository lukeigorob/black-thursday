// The inside of the Sperry upper turret, as in the photos of a real one: you stand with your head up in a
// low dome of glass panes in a frame of riveted arches (zinc-chromate green, worn to bare metal at the
// edges), which turns with the guns but stays level when they elevate, as the real one does. The tall
// front pane between two heavy frames; either side of it the vertical slot the gun's barrel runs up and
// down in; over your head the arches meeting. The guns themselves (weapons.js, browning.js) sit either side
// of your head, their jacketed barrels out through the slots. Between them, low in front of you, the yoke
// that ties them together with the reflector sight on it, which tilts with them; down at your sides the
// steel deflector plates, and the canvas ammunition bag hanging on the left.
// Built in the camera's frame (-Z = where you look); `userData.level` is the part kept level.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glassMaterial } from './ballturret.js';

const R = 0.6; // m, radius of the dome
const H = 0.56; // m, height of the dome above its base ring
const BASE = -0.3; // m, the base ring is this far below your eye
export const SLOT_X = 0.27; // m either side of the middle: the guns' plane, and the slots up the dome in it (interior.js twin)
const SLOT_W = 0.032; // m, half the slot's width

const D = THREE.MathUtils.degToRad;
const solid = (list) => mergeGeometries(list.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (k !== 'position' && k !== 'normal') y.deleteAttribute(k); return y; }));

export function buildTopTurret() {
  const g = new THREE.Group();
  const shell = new THREE.Group(); // turns with the turret, kept level (player.js)
  const green = new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 0.72, metalness: 0.3, envMapIntensity: 0.4 }); // zinc chromate, worn
  const steel = new THREE.MeshStandardMaterial({ color: 0x6c705e, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.6 }); // rivet heads (painted over, worn bright), plates
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1b, roughness: 0.7, metalness: 0.5, envMapIntensity: 0.3 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0x6b6a4a, roughness: 0.95, metalness: 0 });
  // a point on the dome at elevation `el` and bearing `az` (0 = ahead, -Z, + to the left)
  const on = (el, az, r = 0.995) => new THREE.Vector3(-Math.sin(az) * Math.cos(el) * R * r, BASE + Math.sin(el) * H * r, -Math.cos(az) * Math.cos(el) * R * r);
  // the glass: the dome, open along the two gun slots (straight up the dome in the guns' planes, x = +-SLOT_X,
  // ahead of you: the barrels run up and down in them as they elevate)
  const dome = new THREE.SphereGeometry(R, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, H / R, 1).translate(0, BASE, 0).toNonIndexed();
  const P = dome.attributes.position, keep = [];
  for (let t = 0; t < P.count; t += 3) {
    let x = 0, z = 0; for (let k = 0; k < 3; k++) { x += P.getX(t + k) / 3; z += P.getZ(t + k) / 3; }
    if (z < 0 && Math.abs(Math.abs(x) - SLOT_X) < SLOT_W) continue;
    for (let k = 0; k < 3; k++) keep.push(P.getX(t + k), P.getY(t + k), P.getZ(t + k));
  }
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  glassGeo.computeVertexNormals();
  const glass = new THREE.Mesh(glassGeo, glassMaterial());
  glass.renderOrder = 3;
  // the steel skirt the dome sits on, down into the fuselage
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.01, R - 0.04, 0.3, 40, 1, true).translate(0, BASE - 0.15, 0), dark.clone());
  skirt.material.side = THREE.BackSide;
  // the frame: a box-section bar along the dome from one point to the next, and rivets along it
  const frame = [], rivets = [];
  const arch = (pts, w = 0.018, d = 0.014, every = 0.035) => {
    let left = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      const z = b.clone().sub(a).normalize(), out = mid.clone().sub(new THREE.Vector3(0, BASE, 0)).normalize();
      const x = new THREE.Vector3().crossVectors(out, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
      frame.push(new THREE.BoxGeometry(w, d, len + 0.004).applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(mid.clone().addScaledVector(out, -d / 2))));
      for (left += len; left > every; left -= every) { // round-head rivets in two rows down the bar
        const p = a.clone().lerp(b, 1 - left / len).addScaledVector(out, -d - 0.002);
        for (const s of [-1, 1]) rivets.push(new THREE.SphereGeometry(0.0026, 5, 3).translate(p.x + x.x * s * w * 0.3, p.y + x.y * s * w * 0.3, p.z + x.z * s * w * 0.3));
      }
    }
  };
  const meridian = (az, el1 = D(80), n = 14) => Array.from({ length: n + 1 }, (_, k) => on((k / n) * el1, az));
  // a line straight up the dome's front at x (a slot's edge): from the base ring to near the crown
  const upright = (x, n = 16) => Array.from({ length: n + 1 }, (_, k) => {
    const y = BASE + 0.01 + (k / n) * H * 0.9, rh = R * Math.sqrt(Math.max(0, 1 - ((y - BASE) / H) ** 2)) * 0.995;
    return new THREE.Vector3(x, y, -Math.sqrt(Math.max(0, rh * rh - x * x)));
  }).filter((p, k, a) => k === 0 || p.z < -0.02 || a[k - 1].z < -0.02);
  // the heavy frames either side of the front pane (the slots' inner edges), and the slots' outer edges
  for (const s of [-1, 1]) { arch(upright(s * (SLOT_X - SLOT_W - 0.014)), 0.026, 0.018); arch(upright(s * (SLOT_X + SLOT_W + 0.012)), 0.02, 0.016); }
  // the front pane's arched head between the heavy frames, high up, and the arches over the top
  { const top = upright(SLOT_X - SLOT_W - 0.014).at(-1); arch(Array.from({ length: 9 }, (_, k) => { const x = top.x * (1 - (2 * k) / 8); const y = top.y + 0.04 * Math.sin((k / 8) * Math.PI); const rh = R * Math.sqrt(Math.max(0, 1 - ((y - BASE) / H) ** 2)) * 0.995; return new THREE.Vector3(x, y, -Math.sqrt(Math.max(0.0001, rh * rh - x * x))); }), 0.022, 0.016); }
  for (const deg of [70, 110, 150, 180, 210, 250, 290]) arch(meridian(D(deg), D(76), 12), deg === 180 ? 0.022 : 0.016, 0.013, 0.05);
  arch(Array.from({ length: 41 }, (_, k) => on(D(76), (k / 40) * Math.PI * 2)), 0.016, 0.013, 0.06); // the crown ring the arches meet
  shell.add(new THREE.Mesh(solid(frame), green), new THREE.Mesh(solid(rivets), steel));
  // the riveted base ring, under your line of sight, all the way round: it stands proud of the fuselage's
  // decking (raised clear of it: the hull's top hid its back half), depth-tested like everything else
  const ring = [new THREE.TorusGeometry(R - 0.01, 0.022, 8, 64).rotateX(Math.PI / 2).translate(0, BASE + 0.07, 0)], ringRivets = [];
  for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; ringRivets.push(new THREE.SphereGeometry(0.0035, 5, 3).translate(Math.cos(a) * (R - 0.034), BASE + 0.098, Math.sin(a) * (R - 0.034))); }
  shell.add(new THREE.Mesh(solid(ring), green), new THREE.Mesh(solid(ringRivets), steel));
  // down at your sides: the steel deflector plates angled in under the guns, and the canvas ammo bag on the left
  const plates = [];
  for (const s of [-1, 1]) {
    plates.push(new THREE.BoxGeometry(0.008, 0.34, 0.3).rotateZ(s * 0.35).translate(s * 0.36, BASE - 0.12, -0.08));
    plates.push(new THREE.BoxGeometry(0.2, 0.008, 0.26).rotateZ(s * -0.5).translate(s * 0.24, BASE - 0.02, -0.12));
  }
  shell.add(new THREE.Mesh(solid(plates), steel));
  const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10).scale(1, 1, 0.6).rotateZ(0.15).translate(-0.48, BASE - 0.22, 0.12), canvas);
  shell.add(glass, skirt, bag);
  // the yoke between the guns and the reflector sight on it, low in front of you, tilting with your aim
  const sight = new THREE.Group();
  const yoke = [
    new THREE.BoxGeometry(0.5, 0.03, 0.05).translate(0, -0.2, -0.16), // the cross-beam tying the guns together
    new THREE.BoxGeometry(0.06, 0.08, 0.05).translate(0, -0.165, -0.16), // its centre post
    new THREE.BoxGeometry(0.05, 0.035, 0.085).translate(0, -0.12, -0.2), // the sight's housing
    new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10).rotateX(Math.PI / 2).translate(0, -0.13, -0.15), // its lamp
  ];
  sight.add(new THREE.Mesh(solid(yoke), dark));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.036), new THREE.MeshPhysicalMaterial({
    color: 0xbfd8e0, transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  plate.position.set(0, -0.088, -0.23);
  plate.rotation.x = -0.35;
  plate.renderOrder = 4;
  sight.add(plate);
  g.add(shell, sight);
  g.userData.level = shell;
  return g;
}
