// Flying a fighter yourself, a Bf 109, an Fw 190 or a P-47: from the cockpit (cockpit.js), your view
// fixed to the aircraft as in a real one, so when it banks and rolls the horizon tilts and the world
// turns round you. The mouse moves an aim mark across the screen and the plane flies to it, banking into
// the turn; the reflector gunsight's ring and dot stay on the guns' line. Throttle, the type's real
// guns with ammo and overheating, free look on C (look round without steering), and a chase view only
// once you've been shot down, to watch the end.
import * as THREE from 'three';
import { ALTITUDE } from './world.js';
import { buildCockpit, buildReticle } from './cockpit.js';

const V = THREE.Vector3;
const LOOK = 0.0022; // rad per pixel of mouse movement
const SPREAD = 0.003; // rad: your own guns are better harmonised than the AI's
const HEAT_TIME = 9, COOL = 0.12, UNJAM = 0.45; // s of non-stop fire to overheat; heat lost per s
// rounds per gun: Bf 109 F: 2 x MG 17 (1,000 each), MG 151/20 (200); P-47D: 8 x .50 (425 each)
// Fw 190 A-8: 2 x MG 131 (475 each), 4 x MG 151/20 (inner 250, outer 140)
const AMMO = { bf109: [1000, 1000, 200], p47: [425, 425, 425, 425, 425, 425, 425, 425], fw190: [475, 475, 250, 250, 140, 140] };
const EYE = { bf109: [0, 0.75, -0.8], p47: [0, 1.05, -0.2], fw190: [0, 0.86, -0.22] }; // pilot's eye in the model (as in cockpit.js)
const PLAYER_TURN = 0.5; // rad/s: the nose follows your aim this fast, in whichever fighter (an escort's combat turn)
const CHASE_BACK = 20, CHASE_UP = 4.5; // m behind and above: watching your plane go down
const THIRD_BACK = 14, THIRD_UP = 3.2; // m behind and above: the third-person view (V)
const HEAD_YAW = THREE.MathUtils.degToRad(150), HEAD_UP = 1.2, HEAD_DOWN = -0.5; // free look (C) limits, rad
const DEAD_ZONE = 0.002, SETTLE = 0.2; // rad: no steering inside the dead zone; full turn rate beyond SETTLE
const _aim = new V(), _t = new V(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _ax = new V(), _ay = new V(), _fq = new THREE.Quaternion(), _l = new V(), _hq = new THREE.Quaternion();
const AIM_MAX = 0.7; // rad: the aim mark can lead the nose by this much at most (~40 degrees: it stays on the screen)
const RETICLE_AT = 3; // m ahead of the eye the collimated sight image is drawn (its size scales with it)

export class Pilot {
  constructor(audio) {
    this.audio = audio;
    this.active = false;
    this.f = null;
    this.keys = {};
    this.aimYaw = 0; this.aimPitch = 0;
    this.aimV = new V(0, 0, -1); // where the mouse is taking the plane (world direction)
    this.camQ = new THREE.Quaternion(); // the view last frame: the mouse moves the aim across it
    this.night = 0; // instrument glow, 0..1
    this.plainSight = false; // a plain crosshair instead of the reflector sight (the Options tab)
    this.third = false; // the third-person view instead of the cockpit (V, or the Options tab)
    this.throttle = 0.85;
    this.firing = false; this.zoom = false; this.lookScale = 1; this.freeLook = false;
    this.view = 'nose';
    this.headYaw = 0; this.headPitch = 0; // free look (hold C), relative to the plane
    this.cockpits = {};
    this.reticles = {};
    this.camPos = new V();
    addEventListener('keydown', (e) => { if (this.active) this.keys[e.code] = true; });
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
      if (this.keys.KeyC) { // hold C: turn your head, the plane flies on towards the aim
        this.headYaw = THREE.MathUtils.clamp(this.headYaw - e.movementX * LOOK * this.lookScale, -HEAD_YAW, HEAD_YAW);
        this.headPitch = THREE.MathUtils.clamp(this.headPitch - e.movementY * LOOK * this.lookScale, HEAD_DOWN, HEAD_UP);
        return;
      }
      // the aim moves across the screen as you move the mouse, however the plane is rolled
      _ax.set(0, 1, 0).applyQuaternion(this.camQ); _ay.set(1, 0, 0).applyQuaternion(this.camQ);
      this.aimV.applyAxisAngle(_ax, -e.movementX * LOOK * this.lookScale).applyAxisAngle(_ay, -e.movementY * LOOK * this.lookScale).normalize();
      this.limitAim();
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
    this.aimV.copy(f.dir);
    this.throttle = 0.85;
    this.ammo = [...AMMO[f.kind]];
    this.heat = this.ammo.map(() => 0);
    this.jammed = this.ammo.map(() => false);
    this.timers = this.ammo.map(() => Math.random() * 0.05);
    this.headYaw = this.headPitch = 0;
    this.camPos.copy(f.pos).addScaledVector(f.dir, -CHASE_BACK).y += CHASE_UP;
    this.active = true;
  }

  stop() {
    this.active = false; this.firing = false; this.keys = {};
    this.showCockpit(null);
    for (const r of Object.values(this.reticles)) r.visible = false;
  }

  /** Every type's cockpit and sight, built now and handed over to be compiled (the loading screen's warm-up). */
  warmParts() {
    const parts = [];
    for (const kind of ['bf109', 'fw190', 'p47']) {
      const c = (this.cockpits[kind] ??= buildCockpit(kind)), r = (this.reticles[kind] ??= buildReticle(kind));
      c.userData.update?.({ speed: 120, alt: 7600, climb: 0, heading: 0, bank: 0, pitch: 0, throttle: 0.8, heat: 0, damage: false, time: 0, stickX: 0, stickY: 0 }, 1);
      parts.push(c, r);
    }
    return parts;
  }

  /** The cockpit of `f`'s type round the pilot's eye, in place of the plane's own model (null: none). */
  showCockpit(f) {
    if (this.shown && this.shown !== f) this.shown.obj.visible = true;
    for (const c of Object.values(this.cockpits)) c.visible = false;
    this.shown = f;
    if (!f) return null;
    f.obj.visible = false;
    const c = (this.cockpits[f.kind] ??= buildCockpit(f.kind));
    c.visible = true;
    return c;
  }

  get alive() { return !!this.f && this.f.alive; }

  aimDir(out = _aim) { return out.copy(this.aimV); }

  /** Keep the aim within reach of the nose (it can't wander behind you). */
  limitAim() {
    const f = this.f;
    if (!f) return;
    const a = this.aimV.angleTo(f.dir);
    if (a > AIM_MAX) this.aimV.lerp(f.dir, 1 - AIM_MAX / a).normalize();
  }

  /** One frame of flight for the player's fighter (called by Fighters.update; it then moves the plane). */
  fly(f, dt) {
    const k = f.k, keys = this.keys;
    this.throttle = THREE.MathUtils.clamp(this.throttle + ((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)) * dt * 0.5, 0, 1);
    // the instructor: turn the nose towards the aim at the type's combat turn rate; the wings bank by themselves
    // (eased in the last few degrees so the nose settles on the aim without a wobble; a tiny dead zone)
    const off = f.dir.angleTo(this.aimDir());
    // (every type answers the stick as the escort does: the same turn rate, the same easing)
    f.steer(_aim, PLAYER_TURN * Math.min(1, 0.25 + off / SETTLE), dt, true); // (always: with the aim ahead it rolls the wings level)
    // A / D roll on top of that (a barrel roll, or rolling to look), easing back level when let go
    const roll = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
    // (kept within half a turn either way: let go after a full roll and it levels out the short way, it doesn't unwind)
    f.roll = Math.atan2(Math.sin(f.roll), Math.cos(f.roll));
    f.roll = roll ? f.roll - roll * 2.6 * dt : f.roll * Math.exp(-dt * 3);
    // where the stick is: how far off the nose the aim is, across and up, in the plane's own frame, and the roll keys
    f.obj.matrixWorld.decompose(_t, _fq, _l);
    _l.copy(this.aimV).applyQuaternion(_fq.invert());
    this.stickX = THREE.MathUtils.clamp(_l.x * 4 - roll * 0.8, -1, 1);
    this.stickY = THREE.MathUtils.clamp(_l.y * 4, -1, 1);
    this.limitAim();
    // throttle sets the speed it settles at, the same speeds the AI flies the type at: full throttle is
    // its attack speed. Climbing costs speed, diving gains it, up to the AI's top speed in a dive.
    const want = THREE.MathUtils.lerp(k.cruise * 0.75, k.attack, this.throttle);
    f.speed += (want - f.speed) * (1 - Math.exp(-dt * 0.45)) - f.dir.y * 9.81 * dt * 0.7;
    f.speed = THREE.MathUtils.clamp(f.speed, 70, k.max);
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
        if (!this.infinite) this.ammo[i]--; // (the Options' infinite ammunition)
        this.heat[i] += 60 / g.rpm / HEAT_TIME;
        if (this.heat[i] >= 1) { this.jammed[i] = true; this.audio.overheat(); }
        if (g.cannon || f.rounds % 2 === 0) this.audio.gunshot(g.cannon ? 0.9 : 0.55);
      }
    });
  }

  /**
   * From the cockpit: the pilot's eye, fixed to the aircraft (the world rolls round you as it banks),
   * plus a free look on C. The reflector sight's image sits out ahead on the guns' line.
   */
  updateCamera(camera, dt) {
    const f = this.f;
    if (!f) return;
    if (!this.keys.KeyC) { // let go of C: the view eases back over the nose (~0.3 s)
      const k = Math.exp(-dt * 10);
      this.headYaw *= k; this.headPitch *= k;
    }
    if (f.alive && this.third) { // third person: behind and above your plane, rolling with it; C swings the view round it
      this.showCockpit(null);
      for (const r of Object.values(this.reticles)) r.visible = false;
      f.obj.matrixWorld.decompose(_t, _fq, _l);
      _q.copy(_fq).multiply(_hq.setFromEuler(_e.set(this.headPitch, this.headYaw, 0, 'YXZ')));
      camera.position.copy(f.pos).add(_l.set(0, THIRD_UP, THIRD_BACK).applyQuaternion(_q));
      camera.up.set(0, 1, 0).applyQuaternion(_fq);
      camera.lookAt(_t.copy(f.pos).add(_aim.set(0, 0, -60).applyQuaternion(_q)));
      this.camQ.copy(_fq);
      this.camPos.copy(camera.position);
      this.view = 'third';
      return;
    }
    if (f.alive) {
      const c = this.showCockpit(f);
      if (!c.parent && camera.parent) camera.parent.add(c);
      c.matrix.copy(f.obj.matrixWorld);
      c.matrixWorldNeedsUpdate = true;
      this.camPos.copy(f.pos).addScaledVector(f.dir, -CHASE_BACK).y += CHASE_UP; // (for the end, if it comes)
      camera.position.fromArray(EYE[f.kind]).applyMatrix4(f.obj.matrixWorld);
      f.obj.matrixWorld.decompose(_t, _fq, _l);
      camera.quaternion.copy(_fq).multiply(_q.setFromEuler(_e.set(this.headPitch, this.headYaw, 0, 'YXZ')));
      this.camQ.copy(_fq); // (the mouse moves the aim across the plane's own view, not the head's)
      camera.up.set(0, 1, 0).applyQuaternion(_fq);
      this.view = Math.abs(this.headYaw) + Math.abs(this.headPitch) > 0.03 ? 'look' : 'aim';
      // the instruments, the stick and throttle, the night glow
      const vel = f.velocity, right = _ax.set(1, 0, 0).applyQuaternion(_fq), up = _ay.set(0, 1, 0).applyQuaternion(_fq);
      c.userData.update({
        speed: f.speed, alt: ALTITUDE + f.pos.y, climb: vel.y, heading: Math.atan2(f.dir.x, -f.dir.z), bank: Math.atan2(-right.y, up.y),
        pitch: Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1)), throttle: this.throttle, heat: Math.max(...this.heat), damage: f.smoking || f.engineDead,
        time: this.fighters?.time ?? 0, stickX: this.stickX ?? 0, stickY: this.stickY ?? 0,
      }, dt);
      if (c.userData.nightK !== this.night) { c.userData.nightK = this.night; c.userData.night(this.night); }
      // the gunsight's image, collimated: out along the guns' line from your eye, facing you
      const r = (this.reticles[f.kind] ??= buildReticle(f.kind));
      if (!r.parent && camera.parent) camera.parent.add(r);
      r.visible = !this.plainSight;
      r.position.copy(camera.position).addScaledVector(f.dir, RETICLE_AT);
      r.quaternion.copy(_fq);
      r.scale.setScalar(RETICLE_AT * Math.tan(THREE.MathUtils.degToRad(2.9)) / 0.375); // the ring ~100 mils across
      return;
    }
    for (const r of Object.values(this.reticles)) r.visible = false;
    // shot down: out of the cockpit, to watch your plane go
    this.showCockpit(null);
    this.view = 'chase';
    if (f.killedBy === 'collision' || f.wingGone || f.tailGone || f.state === 'gone') { // torn apart: watch the wreck from a little way off, level, swinging slowly round it
      if (!this.wreckT) { this.wreckAt = f.pos.clone(); this.wreckV = f.velocity.clone(); this.camPos.copy(camera.position); } // (where the pieces go: on with her speed, slowing, falling)
      this.wreckT = (this.wreckT ?? 0) + dt;
      this.wreckV.multiplyScalar(Math.exp(-dt * 0.25)); this.wreckV.y -= 9.81 * dt * 0.6;
      this.wreckAt.addScaledVector(this.wreckV, dt);
      const a = this.wreckT * 0.35, r = 30 + this.wreckT * 4;
      _t.set(this.wreckAt.x + Math.sin(a) * r, this.wreckAt.y + 8, this.wreckAt.z + Math.cos(a) * r);
      this.camPos.lerp(_t, 1 - Math.exp(-dt * 5)).addScaledVector(this.wreckV, dt);
      camera.position.copy(this.camPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(this.wreckAt);
      return;
    }
    this.wreckT = 0;
    const aim = f.alive ? this.aimDir() : _aim.copy(f.dir);
    _t.copy(f.pos).addScaledVector(aim, -CHASE_BACK);
    _t.y += CHASE_UP;
    this.camPos.lerp(_t, 1 - Math.exp(-dt * 14));
    // keep up with the plane exactly along its flight (only the offset is smoothed, so it never lags behind)
    camera.position.copy(this.camPos);
    camera.up.set(0, 1, 0).transformDirection(f.obj.matrixWorld); // (rolled with the plane as it goes down)
    camera.lookAt(_t.copy(f.pos).addScaledVector(aim, 150));
  }

  /** What the HUD needs. */
  status(camera) {
    const f = this.f;
    const parts = f.k.parts;
    let have = 0, max = 0;
    for (const [n, p] of Object.entries(parts)) { have += Math.max(0, f.parts[n]) / p.hp; max++; }
    const pt = (p) => { const s = _t.copy(p).project(camera); return camera.getWorldDirection(_aim).dot(_ax.copy(p).sub(camera.position)) > 0 /* (not _t: that's s) */ && Math.abs(s.x) < 1.2 && Math.abs(s.y) < 1.2 ? { x: (s.x + 1) / 2, y: (1 - s.y) / 2 } : null; };
    // the gunsight sits on the nose (where the guns point); the aim point is where the mouse is taking you
    const marker = pt(new V().copy(f.dir).multiplyScalar(600).add(f.pos));
    const aim = pt(this.aimDir(new V()).multiplyScalar(600).add(f.pos));
    const byType = {};
    f.k.guns.forEach((g, i) => { const key = g.cannon ? 'cannon' : 'mg'; (byType[key] ??= { n: 0, max: 0 }).n += this.ammo[i]; byType[key].max += AMMO[f.kind][i]; });
    return {
      kind: f.k.name, view: this.view, speed: f.speed, alt: (ALTITUDE + f.pos.y) * 3.281, throttle: this.throttle,
      health: f.alive ? have / max : 0, heat: Math.max(...this.heat), jammed: this.jammed.some(Boolean), ammo: byType, marker, aim, reflector: !this.plainSight && !this.third,
      damage: f.burning ? 'ON FIRE' : f.engineDead ? 'ENGINE OUT' : f.smoking ? 'ENGINE HIT' : '',
    };
  }
}
