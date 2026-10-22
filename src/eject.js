// Bailing out: a short free fall, the chute opens, and you hang under it watching the battle go on
// overhead while you drift down and back behind the bomber stream (the air streams past at AIRSPEED).
import * as THREE from 'three';
import { AIRSPEED } from './bomber.js';
import { canopyGeometry, linesGeometry, chuteShape, chuteSwing, SILK, CORD, DROP } from './parachutes.js';

const FREEFALL = 1.8, HANG = 6; // s: falling before the chute opens; then hanging before you can go again
const LOOK = 0.0022;
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _qv = new THREE.Quaternion(), _s = new THREE.Vector3(), _o = new THREE.Vector3();
const EYE = DROP - 0.35; // m from the canopy's centre down to your eyes

export class Eject {
  constructor(scene) {
    this.active = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.lookScale = 1; this.freeLook = false;
    // your own chute above you: look up and you see the canopy and the lines running down to you
    this.canopy = new THREE.Group();
    // (the lines stop at the risers above your head: ending right by your eyes, they smeared across the view)
    this.canopy.add(new THREE.Mesh(canopyGeometry(), SILK), new THREE.Mesh(linesGeometry(-EYE + 1.1), CORD));
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
    // look up at the bomber stream flying on ahead (you drift back behind it)
    this.yaw = 0;
    this.pitch = 0.35;
  }

  stop() { this.active = false; this.canopy.visible = false; this.onDone = null; }

  update(dt, camera) {
    if (!this.active) return;
    this.t += dt;
    const open = this.t > FREEFALL;
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
      const t = this.t - FREEFALL;
      this.centre.copy(this.pos).y += EYE;
      chuteSwing(t, 0.7, _q);
      this.canopy.position.copy(this.centre);
      this.canopy.quaternion.copy(_q);
      this.canopy.children[0].scale.copy(chuteShape(t, _s));
      this.canopy.children[1].scale.copy(_s).setY(1);
      camera.position.copy(this.centre).add(_o.set(0, -EYE, 0).applyQuaternion(_q));
      camera.quaternion.copy(_q).multiply(look); // your view swings with you
    }
    this.ready = this.t > FREEFALL + HANG;
  }
}
