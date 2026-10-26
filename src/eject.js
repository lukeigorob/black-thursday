// Bailing out: a short free fall, the chute opens, and you hang under it watching the battle go on
// overhead while you drift down and back behind the bomber stream (the air streams past at AIRSPEED).
import * as THREE from 'three';
import { AIRSPEED } from './bomber.js';
import { canopyGeometry, linesGeometry, chuteShape, chuteSwing, SILK, CORD, DROP, LINK } from './parachutes.js';
import { makeFigure, reachFor } from './figure.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FREEFALL = 1.8, HANG = 6; // s: falling before the chute opens; then hanging before you can go again
const LOOK = 0.0022;
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _qv = new THREE.Quaternion(), _s = new THREE.Vector3(), _o = new THREE.Vector3();
const EYE = DROP - 0.35; // m from the canopy's centre down to your eyes

/** Your risers: from the harness on your shoulders (just behind your eye) straight up to the lines. */
function ownRisers() {
  const parts = [];
  for (const sx of [-1, 1]) for (const [z0, z1] of [[0.08, -0.04], [0.26, 0.08]]) { // (front pair, back pair)
    const A = new THREE.Vector3(sx * 0.19, -EYE - 0.2, z0), B = new THREE.Vector3(sx * 0.2, -LINK, z1), len = A.distanceTo(B);
    const g = new THREE.BoxGeometry(0.032, len, 0.005);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    parts.push(g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2));
  }
  return mergeGeometries(parts);
}

export class Eject {
  constructor(scene) {
    this.active = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.lookScale = 1; this.freeLook = false;
    // your own chute above you: look up and you see the canopy and the lines running down to you
    this.canopy = new THREE.Group();
    // the lines down to the risers, the risers down to your harness: you hold them, your hands up in the
    // corners of your view; look down and your legs and boots hang under you
    this.canopy.add(new THREE.Mesh(canopyGeometry(), SILK), new THREE.Mesh(linesGeometry(-LINK), CORD),
      new THREE.Mesh(ownRisers(), new THREE.MeshStandardMaterial({ color: 0x8a8060, roughness: 0.9 })));
    this.canopy.visible = false;
    this.centre = new THREE.Vector3();
    scene.add(this.canopy);
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !(document.pointerLockElement || this.freeLook)) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.yaw -= e.movementX * LOOK * this.lookScale;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK * this.lookScale, -1.4, 1.5);
    });
    addEventListener('mousedown', (e) => { if (this.active && e.button === 0 && this.t > 0.6) this.onDone?.(); }); // click: go again now
  }

  /** Out of the plane at `pos`, moving with `vel`; onDone() when you're ready to go again. from: 'fighter' | 'crew'. */
  start(pos, vel, from, onDone) {
    this.active = true;
    this.pos.copy(pos);
    this.vel.copy(vel);
    this.from = from;
    this.onDone = onDone;
    this.t = 0;
    this.ready = false;
    this.openAt = null; // when the ripcord was pulled (J); a static line opens it for you at 7 s
    // look up at the bomber stream flying on ahead (you drift back behind it)
    this.yaw = 0;
    this.pitch = 0.35;
  }

  stop() { this.active = false; this.canopy.visible = false; this.onDone = null; }

  /** J in free fall: pull the ripcord (after the first moment: clear of the plane). */
  pull() { if (this.active && this.openAt == null) this.openAt = Math.max(this.t, 0.6); } // (clear of the plane first: a pull in the first moment opens it just after)
  get falling() { return this.active && this.openAt == null; }

  /** You, in the harness: hands up on the risers, legs dangling and swinging a little. */
  hang(t) {
    if (!this.body) {
      try { this.body = makeFigure({ self: true }); } catch { return; } // (the crew's model: loaded by now)
      this.canopy.add(this.body);
    }
    const b = this.body, j = b.userData.j;
    // the neck just under your eye, as in the bomber (player.js): the body hangs straight down from it
    b.position.set(0, -EYE - (j.hips.position.y + 0.6) - 0.14, 0.18);
    for (const [l, s] of [[j.legL, 1], [j.legR, -1]]) { // legs a little apart, hanging forward, swaying
      l.hip.rotation.set(0.25 + 0.12 * Math.sin(t * 1.3 + s), 0, s * -0.08);
      l.knee.rotation.set(-0.35 - 0.1 * Math.sin(t * 1.1 + s * 2), 0, 0);
    }
    j.torso.rotation.set(-0.05, 0, 0);
    this.canopy.updateMatrixWorld(true);
    this.grips ??= [new THREE.Vector3(), new THREE.Vector3()];
    for (const [i, s] of [[0, -1], [1, 1]]) this.canopy.localToWorld(this.grips[i].set(s * 0.2, -EYE + 0.3, 0.05)); // (your hands on the front risers, just over your head)
    reachFor(b, this.grips);
  }

  update(dt, camera) {
    if (!this.active) return;
    this.t += dt;
    if (this.openAt == null && this.t > 7) this.openAt = this.t;
    const open = this.openAt != null && this.t > this.openAt + 0.35, t0 = (this.openAt ?? FREEFALL) + 0.35;
    if (!open) { // tumbling out: gravity, and the air quickly takes away the plane's speed
      const d = Math.exp(-dt * 1.2);
      this.vel.x *= d; this.vel.z = AIRSPEED + (this.vel.z - AIRSPEED) * d;
      this.vel.y = Math.max(this.vel.y - 9.81 * dt, -50);
    } else { // under the canopy: a few m/s down, carried with the wind
      const d = Math.exp(-dt * 2.5);
      this.vel.x *= d; this.vel.y = -6 + (this.vel.y + 6) * d; this.vel.z = AIRSPEED + (this.vel.z - AIRSPEED) * d;
    }
    this.pos.addScaledVector(this.vel, dt);
    const look = _qv.setFromEuler(_e.set(this.pitch + (open ? 0 : Math.sin(this.t * 9) * 0.08), this.yaw, 0));
    this.canopy.visible = open;
    if (!open) { camera.position.copy(this.pos); camera.quaternion.copy(look); }
    else { // you hang under the canopy and swing with it like a pendulum
      const t = this.t - t0;
      this.centre.copy(this.pos).y += EYE;
      chuteSwing(t, 0.7, _q);
      this.canopy.position.copy(this.centre);
      this.canopy.quaternion.copy(_q);
      this.canopy.children[0].scale.copy(chuteShape(t, _s));
      this.canopy.children[1].scale.copy(_s).setY(1);
      camera.position.copy(this.centre).add(_o.set(0, -EYE, 0).applyQuaternion(_q));
      camera.quaternion.copy(_q).multiply(look); // your view swings with you
      this.hang(t);
    }
    this.ready = open && this.t > t0 + HANG;
  }
}
