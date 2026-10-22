// Parachutes: a dome of silk gores, shroud lines down to the harness and a small airman hanging
// under it. They open from a streamer to a full canopy in about a second, breathe gently and swing
// like a pendulum. Everyone's chutes are instanced (three draw calls however many there are);
// your own chute in the eject view uses the same model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRSPEED } from './bomber.js';

export const R = 4.2, DROP = 6.8; // m: canopy radius; the harness hangs this far below the canopy's centre
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
export function linesGeometry(toY = -DROP) {
  const rimR = R * Math.sin(Math.PI * 0.44), rimY = R * 0.62 * Math.cos(Math.PI * 0.44);
  const parts = [];
  for (let k = 0; k < GORES; k++) {
    const a = (k / GORES) * Math.PI * 2;
    const A = new V(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR), B = new V(Math.cos(a) * 0.18, toY, Math.sin(a) * 0.18);
    const len = A.distanceTo(B);
    const c = new THREE.CylinderGeometry(0.018, 0.018, len, 3, 1, true);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), A.clone().sub(B).normalize()));
    c.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    c.deleteAttribute('uv');
    parts.push(c);
  }
  return mergeGeometries(parts.map((c) => c.toNonIndexed()));
}

/** The airman in his harness: body, legs, arms up on the risers. */
function figureGeometry() {
  const body = new THREE.CapsuleGeometry(0.2, 0.55, 3, 8).translate(0, -DROP - 0.5, 0);
  const legs = new THREE.CapsuleGeometry(0.11, 0.55, 3, 6).translate(0, -DROP - 1.25, 0.05);
  const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, -DROP - 0.02, 0);
  const arms = [-1, 1].map((s) => new THREE.CapsuleGeometry(0.06, 0.45, 2, 5).rotateZ(s * 0.25).translate(s * 0.22, -DROP + 0.05, 0));
  return mergeGeometries([body, legs, head, ...arms].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
}

export const SILK = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.4 });
export const CORD = new THREE.MeshStandardMaterial({ color: 0xd9d3c0, roughness: 0.9 });
const FLIGHT_SUIT = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.85 });

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
      this.canopy.setMatrixAt(n, open ? _m.compose(c.pos, _q, chuteShape(t, _s)) : _m.makeScale(0, 0, 0));
      n++;
    }
    for (const m of [this.canopy, this.lines, this.figure]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
  }
}
