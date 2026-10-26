// Parachutes: a dome of silk gores, shroud lines down to the four risers, the risers down to the
// harness on the airman's shoulders, and the airman hanging in it: arms up holding the risers, legs
// dangling, helmet and yellow Mae West. They open from a streamer to a full canopy in about a second, breathe gently and swing
// like a pendulum. Everyone's chutes are instanced (three draw calls however many there are);
// your own chute in the eject view uses the same model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRSPEED } from './bomber.js';

export const R = 4.2, DROP = 6.8; // m: canopy radius; the harness hangs this far below the canopy's centre
export const LINK = DROP - 1.0; // m below the canopy's centre: where the shroud lines meet the risers
const GORES = 12, MAX = 160, OPEN_TIME = 1.0; // s from streamer to full canopy
const V = THREE.Vector3;

/** The canopy: a flattened dome of alternating white and cream panels (vertex colours), centre at the origin. */
export function canopyGeometry() {
  const g = new THREE.SphereGeometry(R, GORES * 2, 7, 0, Math.PI * 2, 0, Math.PI * 0.44).toNonIndexed();
  g.scale(1, 0.62, 1);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let t = 0; t < p.count; t += 3) { // colour each triangle by the gore its centre is in
    const x = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, z = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
    const gore = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * GORES) % 2;
    const c = gore ? [0.94, 0.92, 0.86] : [0.84, 0.8, 0.7];
    for (let k = 0; k < 3; k++) col.set(c, (t + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** The shroud lines, from the rim down to the risers over the airman's shoulders. */
export function linesGeometry(toY = -LINK) {
  const rimR = R * Math.sin(Math.PI * 0.44), rimY = R * 0.62 * Math.cos(Math.PI * 0.44);
  const parts = [];
  for (let k = 0; k < GORES; k++) {
    const a = (k / GORES) * Math.PI * 2;
    const A = new V(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR), B = new V(Math.sign(Math.cos(a)) * 0.2, toY, Math.sign(Math.sin(a) || 1) * 0.1); // (to the nearest of the four risers)
    const len = A.distanceTo(B);
    const c = new THREE.CylinderGeometry(0.018, 0.018, len, 3, 1, true);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), A.clone().sub(B).normalize()));
    c.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    c.deleteAttribute('uv');
    parts.push(c);
  }
  return mergeGeometries(parts.map((c) => c.toNonIndexed()));
}

/** The four risers: webbing from the harness at his shoulders up to where the lines meet. */
export function risersGeometry(fromY = -DROP + 0.05, toY = -LINK, w = 0.17, front = 0.05) {
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const A = new V(sx * w, fromY, sz < 0 ? -front : 0.05), B = new V(sx * 0.2, toY, sz < 0 ? -Math.max(0.1, front) : 0.1), len = A.distanceTo(B); // (front: how far forward the front pair run, through the hands)
    const g = new THREE.BoxGeometry(0.032, len, 0.005);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), B.clone().sub(A).normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    g.deleteAttribute('uv');
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts);
}

/**
 * The airman in his harness, as he hangs: helmet and face, his body in its jacket with the yellow Mae
 * West and the harness straps over it, arms up to the risers with gloved hands on them, legs apart and
 * dangling a little forward, boots. Coloured by vertex (one draw call for everyone's).
 */
function figureGeometry() {
  const y0 = -DROP, parts = [];
  const add = (g, c) => { g.deleteAttribute('uv'); const n = g.index ? g.toNonIndexed() : g; n.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 3).map((_, i) => c[i % 3]), 3)); parts.push(n); };
  const limb = (a, b, r, c) => { const A = new V(...a), B = new V(...b), g = new THREE.CapsuleGeometry(r, Math.max(0.01, A.distanceTo(B) - 2 * r), 3, 7); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), B.clone().sub(A).normalize())); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); add(g, c); };
  const JACKET = [0.25, 0.16, 0.09], TROUSERS = [0.2, 0.19, 0.12], SKIN = [0.62, 0.45, 0.35], LEATHER = [0.16, 0.1, 0.06], MAE = [0.75, 0.55, 0.12], WEB = [0.5, 0.46, 0.3], BOOT = [0.06, 0.05, 0.04];
  add(new THREE.CapsuleGeometry(0.19, 0.42, 3, 10).scale(1, 1, 0.75).translate(0, y0 - 0.42, 0), JACKET); // the body
  add(new THREE.SphereGeometry(0.115, 10, 8).translate(0, y0 - 0.02, 0), SKIN); // the head
  add(new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, y0 - 0.0, 0.01), LEATHER); // the helmet
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.07, 0.16, 3, 8).scale(1.1, 1, 0.8).translate(s * 0.08, y0 - 0.28, -0.12), MAE); // the Mae West
    add(new THREE.BoxGeometry(0.04, 0.6, 0.02).translate(s * 0.1, y0 - 0.4, -0.15), WEB); // the harness straps
    limb([s * 0.1, y0 - 0.7, 0], [s * 0.15, y0 - 1.12, -0.12], 0.075, TROUSERS); // thighs, a little forward
    limb([s * 0.15, y0 - 1.12, -0.12], [s * 0.16, y0 - 1.55, -0.02], 0.065, TROUSERS); // shins hanging
    add(new THREE.BoxGeometry(0.1, 0.09, 0.22).translate(s * 0.16, y0 - 1.6, -0.06), BOOT); // boots
    limb([s * 0.2, y0 - 0.2, 0], [s * 0.21, y0 + 0.18, 0.02], 0.05, JACKET); // upper arms, up the risers
    limb([s * 0.21, y0 + 0.18, 0.02], [s * 0.19, y0 + 0.5, 0], 0.045, JACKET); // forearms
    add(new THREE.SphereGeometry(0.05, 8, 6).translate(s * 0.19, y0 + 0.55, 0), LEATHER); // gloved hands on the risers
  }
  add(new THREE.BoxGeometry(0.34, 0.04, 0.03).translate(0, y0 - 0.62, -0.14), WEB); // the chest strap
  return mergeGeometries(parts);
}

export const SILK = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.4 });
export const CORD = new THREE.MeshStandardMaterial({ color: 0xd9d3c0, roughness: 0.9 });
const FLIGHT_SUIT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const WEBBING = new THREE.MeshStandardMaterial({ color: 0x8a8060, roughness: 0.9 });

const BODY = new V(0, -DROP - 0.6, 0); // the airman's middle, in the chute's frame
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V(), _p = new V(), _axis = new V();

/** How far open a chute is (0 streamer .. 1 full), its breathing, and its swing at time t since it opened. */
export function chuteShape(t, out) {
  const k = THREE.MathUtils.clamp(t / OPEN_TIME, 0, 1), e = 1 - (1 - k) ** 3;
  const breathe = 1 + 0.045 * Math.sin(t * 2.3) * e;
  out.set((0.1 + 0.9 * e) * breathe, 1.9 - 0.9 * e + 0.03 * Math.sin(t * 2.3 + 1), (0.1 + 0.9 * e) * breathe);
  return out;
}
export function chuteSwing(t, phase, q) {
  const amp = 0.2 * Math.exp(-t / 25) + 0.07; // a big swing as it opens, settling to a gentle sway
  _axis.set(Math.cos(t * 0.13 + phase), 0, Math.sin(t * 0.13 + phase));
  return q.setFromAxisAngle(_axis, amp * Math.sin(t * 1.55 + phase));
}

export class Parachutes {
  constructor(scene) {
    this.items = [];
    const mk = (geo, mat) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX);
      m.frustumCulled = false; m.count = 0; m.castShadow = false;
      scene.add(m);
      return m;
    };
    this.canopy = mk(canopyGeometry(), SILK);
    this.lines = mk(linesGeometry(), CORD);
    this.risers = mk(risersGeometry(), WEBBING);
    this.figure = mk(figureGeometry(), FLIGHT_SUIT);
  }

  /** Someone bailing out at p: a free fall of a few seconds, then the chute opens. */
  add(p) {
    if (this.items.length >= MAX) this.items.shift();
    this.items.push({ pos: p.clone().add(_p.set(0, DROP, 0)), age: 0, open: 2 + Math.random() * 3, phase: Math.random() * 6 });
  }

  update(dt) {
    const items = this.items;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const c = items[i];
      c.age += dt;
      const open = c.age > c.open, t = c.age - c.open;
      c.pos.y -= (open ? 6 + 30 * Math.exp(-t * 3) : 45) * dt; // the opening shock slows him from ~45 m/s to 6
      c.pos.z += AIRSPEED * dt; // left behind in the air as the bombers fly on
      if (c.age > 150) { items.splice(i, 1); continue; }
    }
    for (const c of items) {
      const open = c.age > c.open, t = c.age - c.open;
      if (open) {
        chuteSwing(t, c.phase, _q); // swinging under the canopy: everything turns about the canopy
        this.figure.setMatrixAt(n, _m.compose(c.pos, _q, _s.set(1, 1, 1)));
      } else { // tumbling in free fall, about himself: place the pivot at the airman
        _q.setFromAxisAngle(_axis.set(1, 0, 0.3).normalize(), c.age * 2.5);
        _p.copy(BODY).applyQuaternion(_q).negate().add(BODY).add(c.pos);
        this.figure.setMatrixAt(n, _m.compose(_p, _q, _s.set(1, 1, 1)));
      }
      this.lines.setMatrixAt(n, open ? _m.compose(c.pos, _q, chuteShape(t, _s).setY(1)) : _m.makeScale(0, 0, 0));
      this.risers.setMatrixAt(n, open ? _m.compose(c.pos, _q, _s.set(1, 1, 1)) : _m.makeScale(0, 0, 0));
      this.canopy.setMatrixAt(n, open ? _m.compose(c.pos, _q, chuteShape(t, _s)) : _m.makeScale(0, 0, 0));
      n++;
    }
    for (const m of [this.canopy, this.lines, this.risers, this.figure]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
  }
}
