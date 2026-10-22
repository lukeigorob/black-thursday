// Flying a fighter yourself, a Bf 109 or a P-51: War Thunder style mouse aim (the mouse points where
// you want to go, the plane banks and turns there), throttle, the type's real guns with ammo and
// overheating, a chase camera and a nose view with a gunsight.
import * as THREE from 'three';
import { ALTITUDE } from './world.js';

const V = THREE.Vector3;
const LOOK = 0.0022; // rad per pixel of mouse movement
const SPREAD = 0.003; // rad: your own guns are better harmonised than the AI's
const HEAT_TIME = 9, COOL = 0.12, UNJAM = 0.45; // s of non-stop fire to overheat; heat lost per s
// rounds per gun: Bf 109 F: 2 x MG 17 (1,000 each), MG 151/20 (200); P-51D: 6 x .50 (inner 400, others 270)
const AMMO = { bf109: [1000, 1000, 200], p51: [400, 400, 270, 270, 270, 270] };
const EYE = { bf109: [0, 0.75, -0.8], p51: [0, 0.85, -0.1] }; // pilot's eye in the model, for the nose view
const CHASE_BACK = 20, CHASE_UP = 4.5; // m behind and above, along the aim
const _aim = new V(), _t = new V(), _m = new THREE.Matrix4();

export class Pilot {
  constructor(audio) {
    this.audio = audio;
    this.active = false;
    this.f = null;
    this.keys = {};
    this.aimYaw = 0; this.aimPitch = 0;
    this.throttle = 0.85;
    this.firing = false; this.zoom = false; this.lookScale = 1; this.freeLook = false;
    this.view = 'chase';
    this.camPos = new V();
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyV' && !e.repeat) this.view = this.view === 'chase' ? 'nose' : 'chase';
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.firing = false; this.zoom = false; });
    addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.zoom = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; if (e.button === 2) this.zoom = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !(document.pointerLockElement || this.freeLook)) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return; // a bogus jump (Chrome on Windows)
      this.aimYaw -= e.movementX * LOOK * this.lookScale;
      this.aimPitch = THREE.MathUtils.clamp(this.aimPitch - e.movementY * LOOK * this.lookScale, -1.45, 1.45);
    });
  }

  /** Take the controls of fighter f (just spawned for you). */
  start(f, fighters) {
    this.f = f;
    this.fighters = fighters;
    f.player = true;
    f.state = 'player';
    this.aimYaw = Math.atan2(-f.dir.x, -f.dir.z);
    this.aimPitch = Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1));
    this.throttle = 0.85;
    this.ammo = [...AMMO[f.kind]];
    this.heat = this.ammo.map(() => 0);
    this.jammed = this.ammo.map(() => false);
    this.timers = this.ammo.map(() => Math.random() * 0.05);
    this.view = 'chase';
    this.camPos.copy(f.pos).addScaledVector(f.dir, -CHASE_BACK).y += CHASE_UP;
    this.active = true;
  }

  stop() { this.active = false; this.firing = false; this.keys = {}; }

  get alive() { return !!this.f && this.f.alive; }

  aimDir(out = _aim) {
    const cp = Math.cos(this.aimPitch);
    return out.set(-Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * cp);
  }

  /** One frame of flight for the player's fighter (called by Fighters.update; it then moves the plane). */
  fly(f, dt) {
    const k = f.k, keys = this.keys;
    this.throttle = THREE.MathUtils.clamp(this.throttle + ((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)) * dt * 0.5, 0, 1);
    // the instructor: turn the nose towards the aim at the type's combat turn rate; the wings bank by themselves
    f.steer(this.aimDir(), k.combat, dt);
    // A / D roll on top of that (a barrel roll, or rolling to look), easing back level when let go
    const roll = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
    f.roll = roll ? f.roll - roll * 2.6 * dt : f.roll * Math.exp(-dt * 3);
    // throttle sets the speed it settles at; climbing costs speed, diving gains it
    const want = THREE.MathUtils.lerp(k.cruise * 0.75, k.max, this.throttle);
    f.speed += (want - f.speed) * (1 - Math.exp(-dt * 0.45)) - f.dir.y * 9.81 * dt * 0.7;
    f.speed = THREE.MathUtils.clamp(f.speed, 70, k.max + 45); // (a dive can overspeed a little)
    if (this.firing) this.fireGuns(f, dt);
    else this.timers.forEach((t, i) => { this.timers[i] = Math.max(t, 0); });
    for (let i = 0; i < this.heat.length; i++) {
      this.heat[i] = Math.max(0, this.heat[i] - COOL * dt);
      if (this.jammed[i] && this.heat[i] < UNJAM) this.jammed[i] = false;
    }
    if (ALTITUDE + f.pos.y < 30 && f.alive) { this.fighters.shotDown(f, 'ground'); this.fighters.explode(f); } // flew into the ground
  }

  fireGuns(f, dt) {
    const guns = f.k.guns, team = f.side === 'axis' ? 'enemy' : 'allied', vel = f.velocity;
    guns.forEach((g, i) => {
      if (this.ammo[i] <= 0 || this.jammed[i]) return;
      this.timers[i] -= dt;
      while (this.timers[i] <= 0 && this.ammo[i] > 0 && !this.jammed[i]) {
        this.timers[i] += 60 / g.rpm;
        const muzzle = _t.fromArray(g.at).applyMatrix4(f.obj.matrixWorld);
        const d = _aim.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(SPREAD * 2).add(f.dir).normalize();
        this.fighters.bullets.spawn(muzzle, d.multiplyScalar(f.k.muzzle).add(vel), f.rounds++ % g.tracer === 0, team, 'player', g.cannon, f, 2.2);
        this.ammo[i]--;
        this.heat[i] += 60 / g.rpm / HEAT_TIME;
        if (this.heat[i] >= 1) { this.jammed[i] = true; this.audio.overheat(); }
        if (g.cannon || f.rounds % 2 === 0) this.audio.gunshot(g.cannon ? 0.9 : 0.55);
      }
    });
  }

  /** Chase view (behind the plane, looking along the aim) or nose view (the pilot's eye, through the gunsight). */
  updateCamera(camera, dt) {
    const f = this.f;
    if (!f) return;
    const nose = this.view === 'nose' && f.alive;
    f.obj.visible = !nose; // no cockpit in the model: in the nose view you see through the gunsight only
    if (nose) {
      camera.position.fromArray(EYE[f.kind]).applyMatrix4(f.obj.matrixWorld);
      camera.quaternion.setFromRotationMatrix(_m.extractRotation(f.obj.matrixWorld));
      return;
    }
    const aim = f.alive ? this.aimDir() : _aim.copy(f.dir);
    _t.copy(f.pos).addScaledVector(aim, -CHASE_BACK);
    _t.y += CHASE_UP;
    this.camPos.lerp(_t, 1 - Math.exp(-dt * 14));
    // keep up with the plane exactly along its flight (only the offset is smoothed, so it never lags behind)
    camera.position.copy(this.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(_t.copy(f.pos).addScaledVector(aim, 150));
  }

  /** What the HUD needs. */
  status(camera) {
    const f = this.f;
    const parts = f.k.parts;
    let have = 0, max = 0;
    for (const [n, p] of Object.entries(parts)) { have += Math.max(0, f.parts[n]) / p.hp; max++; }
    const pt = (p) => { const s = _t.copy(p).project(camera); return camera.getWorldDirection(_aim).dot(_t.copy(p).sub(camera.position)) > 0 && Math.abs(s.x) < 1.2 && Math.abs(s.y) < 1.2 ? { x: (s.x + 1) / 2, y: (1 - s.y) / 2 } : null; };
    // in the chase view the screen centre is the aim and the ring shows the nose; in the nose view it's the other way round
    const marker = pt((this.view === 'nose' ? this.aimDir(new V()) : new V().copy(f.dir)).multiplyScalar(600).add(f.pos));
    const byType = {};
    f.k.guns.forEach((g, i) => { const key = g.cannon ? 'cannon' : 'mg'; (byType[key] ??= { n: 0, max: 0 }).n += this.ammo[i]; byType[key].max += AMMO[f.kind][i]; });
    return {
      kind: f.k.name, view: this.view, speed: f.speed, alt: (ALTITUDE + f.pos.y) * 3.281, throttle: this.throttle,
      health: f.alive ? have / max : 0, heat: Math.max(...this.heat), jammed: this.jammed.some(Boolean), ammo: byType, marker,
      damage: f.burning ? 'ON FIRE' : f.engineDead ? 'ENGINE OUT' : f.smoking ? 'ENGINE HIT' : '',
    };
  }
}
