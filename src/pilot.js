// Flying a fighter yourself, a Bf 109, an Fw 190 or a P-47, by mouse aim as in War Thunder: the mouse moves
// the view, and where you look is where the plane goes. The instructor (flight.js) rolls and pulls her round to
// it through a flight model with real energy, inertia and a stall, so a hard turn bleeds speed and she takes
// a moment to roll. In the cockpit the view rolls with her; behind her (V) the horizon stays level. A / D roll
// her yourself (the instructor keeps the pull), W / S pitch her yourself (S pulls, W pushes), Q / E rudder,
// Shift / Ctrl throttle, C looks round without steering.
// The reflector gunsight's ring and dot stay on the guns' line; the type's real guns, ammo and overheating;
// and a chase view once you've been shot down, to watch the end.
import * as THREE from 'three';
import { ALTITUDE } from './world.js';
import { buildCockpit, buildReticle } from './cockpit.js';
import { BALLISTICS } from './weapons.js';
import { WEP } from './flight.js';
import { SYSTEMS } from './airframe.js';

const V = THREE.Vector3;
const LOOK = 0.0022; // rad per pixel of mouse movement
const SPREAD = 0.003; // rad: your own guns are better harmonised than the AI's
const HEAT_TIME = 9, COOL = 0.12, UNJAM = 0.45; // s of non-stop fire to overheat; heat lost per s
// rounds per gun: Bf 109 F: 2 x MG 17 (1,000 each), MG 151/20 (200); P-47D: 8 x .50 (425 each)
// Fw 190 A-8: 2 x MG 131 (475 each), 4 x MG 151/20 (inner 250, outer 140)
const AMMO = { bf109: [1000, 1000, 200], p47: [425, 425, 425, 425, 425, 425, 425, 425], fw190: [475, 475, 250, 250, 140, 140] };
const EYE = { bf109: [0, 0.75, -0.8], p47: [0, 1.05, -0.2], fw190: [0, 0.86, -0.22] }; // pilot's eye in the model (as in cockpit.js)
const CHASE_BACK = 20, CHASE_UP = 4.5; // m behind and above: watching your plane go down
const THIRD_BACK = 14, THIRD_UP = 3.2; // m behind and above: the third-person view (V)
const _aim = new V(), _t = new V();
const _ax = new V(), _ay = new V(), _fq = new THREE.Quaternion(), _l = new V(), _cu = new V();
const AIM_MAX = 2.45; // rad: how far round from the nose the aim can be (~140 degrees: well round, not dead astern)
const RETICLE_AT = 3; // m ahead of the eye the collimated sight image is drawn (its size scales with it)
// middle click: lock on (aim assist), a toggle (click again to let go). Picks the enemy nearest the aim within
// this cone and range, then draws the aim onto where to point for the bullets to meet him (his lead); the
// mouse still steers on top
const LOCK_CONE = THREE.MathUtils.degToRad(25), LOCK_RANGE = 1500, LOCK_KEEP = 2200, LOCK_OFF = THREE.MathUtils.degToRad(70), ASSIST = 3.5;

export class Pilot {
  constructor(audio) {
    this.audio = audio;
    this.active = false;
    this.f = null;
    this.keys = {};
    this.aimYaw = 0; this.aimPitch = 0;
    this.aimV = new V(0, 0, -1); // where the mouse is taking the plane (world direction): where you look
    this.viewV = new V(0, 0, -1); // where the camera looks: the aim, or round about with C held (eased between)
    this.lookV = new V(0, 0, -1); // free look's own direction (C)
    this.camQ = new THREE.Quaternion(); // the view last frame: the mouse moves the aim across it
    this.night = 0; // instrument glow, 0..1
    this.plainSight = false; // a plain crosshair instead of the reflector sight (the Options tab)
    this.third = false; // the third-person view instead of the cockpit (V, or the Options tab)
    this.throttle = 0.85;
    this.firing = false; this.zoom = false; this.lookScale = 1; this.freeLook = false;
    this.view = 'nose';
    this.cockpits = {};
    this.reticles = {};
    this.camPos = new V();
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.ctrlKey || e.metaKey) e.preventDefault(); // (Ctrl is the throttle: no Ctrl+S, Ctrl+D... while you fly)
      if (e.code === 'KeyC' && !this.keys.KeyC) this.lookV.copy(this.viewV);
      if (e.code === 'KeyF' && !e.repeat && this.f?.fm && this.f.alive) this.f.fm.flapsWant = this.f.fm.flapsWant ? 0 : 1; // combat flaps
      this.keys[e.code] = true;
    });
    // Ctrl+W closes the tab and no page can stop that, except in full screen with the keyboard locked: so in full
    // screen the flight keys are the game's (Chrome, Edge). Esc still pauses; holding it leaves full screen
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) navigator.keyboard?.lock?.(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'KeyV', 'KeyJ'])?.catch?.(() => {});
      else navigator.keyboard?.unlock?.();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.firing = false; this.zoom = false; this.locking = false; this.locked = null; });
    addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 1) { // middle click: lock on / let go (and no browser autoscroll)
        e.preventDefault();
        if (this.locking) { this.locking = false; this.locked = null; } else this.locking = true;
      }
      if (e.button === 2) this.zoom = true; // hold right click: zoom in (main.js eases the view's FOV)
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; if (e.button === 2) this.zoom = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !(document.pointerLockElement || this.freeLook)) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return; // a bogus jump (Chrome on Windows)
      // the mouse turns the view (the camera's own up and right, however it's rolled): with C held, just the view
      // (the plane flies on to the aim); otherwise the aim with it, and the plane follows
      _ax.set(0, 1, 0).applyQuaternion(this.camQ); _ay.set(1, 0, 0).applyQuaternion(this.camQ);
      const v = this.keys.KeyC ? this.lookV : this.aimV;
      v.applyAxisAngle(_ax, -e.movementX * LOOK * this.lookScale).applyAxisAngle(_ay, -e.movementY * LOOK * this.lookScale).normalize();
      if (!this.keys.KeyC) this.limitAim();
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
    this.aimV.copy(f.dir); this.viewV.copy(f.dir); this.lookV.copy(f.dir);
    this.throttle = 0.85;
    if (!f.fm || f.fm.speed < 135) fighters.physics(f, Math.max(f.fm?.speed ?? f.speed, 135)); // (on the flight model, flight.js: with some speed to fight with)
    this.ammo = [...AMMO[f.kind]];
    this.heat = this.ammo.map(() => 0);
    this.jammed = this.ammo.map(() => false);
    this.timers = this.ammo.map(() => Math.random() * 0.05);
    this.camPos.copy(f.pos).addScaledVector(f.dir, -CHASE_BACK).y += CHASE_UP;
    this.active = true;
  }

  stop() {
    this.active = false; this.firing = false; this.zoom = false; this.keys = {}; this.locking = false; this.locked = null;
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
    const up = keys.ShiftLeft || keys.ShiftRight, down = keys.ControlLeft || keys.ControlRight;
    // (hold Shift on past 100%: emergency power, WEP, up to 110%: more power, and the engine heats fast)
    this.throttle = THREE.MathUtils.clamp(this.throttle + ((up ? 1 : 0) - (down ? 1 : 0)) * dt * 0.5, 0, WEP);
    // W / S: your own elevator on top of the mouse aim's pull (S harder, to an over-G if you hold it; W eases it
    // off, to a push). The mouse keeps flying her the whole time; quick in and out (an eighth of a second)
    const pitchKey = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    this.elevator = (this.elevator ?? 0) + THREE.MathUtils.clamp(pitchKey - (this.elevator ?? 0), -dt * 8, dt * 8);
    if (Math.abs(this.elevator) < 1e-3 && !pitchKey) this.elevator = 0;
    this.assist(f, dt); // (the lock-on pulls the aim onto his lead first)
    // the instructor flies her to the aim through the flight model; A / D take the roll yourself (it keeps the
    // pull), Q / E the rudder
    const roll = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), rudder = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
    this.fighters.flyPhysics(f, this.aimDir(), this.throttle, dt, { roll, rudder, pitch: this.elevator });
    // where the stick is: the ailerons, and the pull (the g she's pulling)
    this.stickX = THREE.MathUtils.clamp(f.fm.cmd.aileron, -1, 1);
    this.stickY = THREE.MathUtils.clamp((f.fm.g - 1) / 5, -1, 1);
    this.limitAim();
    void k;
    if (this.firing && !(f.sys?.blackout || f.sys?.redout)) this.fireGuns(f, dt); // (blacked out: nobody on the trigger)
    else this.timers.forEach((t, i) => { this.timers[i] = Math.max(t, 0); });
    for (let i = 0; i < this.heat.length; i++) {
      this.heat[i] = Math.max(0, this.heat[i] - COOL * dt);
      if (this.jammed[i] && this.heat[i] < UNJAM) this.jammed[i] = false;
    }
    if (ALTITUDE + f.pos.y < 30 && f.alive) { this.fighters.shotDown(f, 'ground'); this.fighters.explode(f); } // flew into the ground
  }

  /** The enemies you can lock on to: their fighters, and for a German, the bombers too. [{ obj, pos, vel }] */
  enemies(f) {
    const out = [];
    for (const x of this.fighters.list) if (x !== f && x.side !== f.side && x.alive) out.push({ obj: x, pos: x.pos, vel: x.velocity, far: 1 });
    if (f.side === 'axis') for (const b of this.fighters.bombers) if (!b.down && !b.gone) out.push({ obj: b, pos: b.group.position, vel: null, far: 1.4 });
    return out;
  }

  /**
   * Middle click (a toggle): lock on to the enemy nearest the aim (within LOCK_CONE and LOCK_RANGE), and draw
   * the aim onto his lead, where the guns must point for the bullets to meet him. Click again, or he's down,
   * out of range or well off the nose, and the lock's gone.
   */
  assist(f, dt) {
    if (!this.locking || !f.alive) { this.locked = null; return; }
    const all = this.enemies(f);
    let t = this.locked && all.find((e) => e.obj === this.locked);
    if (t && (t.pos.distanceTo(f.pos) > LOCK_KEEP * t.far || _t.copy(t.pos).sub(f.pos).angleTo(f.dir) > LOCK_OFF)) t = null;
    if (!t && !this.locked) { // (one press, one lock: a target lost stays lost until you press again)
      let best = LOCK_CONE;
      for (const e of all) {
        if (e.pos.distanceTo(f.pos) > LOCK_RANGE * e.far) continue;
        const a = _t.copy(e.pos).sub(f.pos).angleTo(this.aimV);
        if (a < best) { best = a; t = e; }
      }
      if (!t) { this.locking = false; return; } // (nothing there: no lock)
    }
    this.locked = t ? t.obj : null;
    if (!t) { this.locking = false; return; }
    // his lead: the direction to point the guns for the bullets to meet him (pull the aim onto it)
    this.leadDir(f, t, _l);
    this.aimV.lerp(_l, 1 - Math.exp(-dt * ASSIST)).normalize();
    this.limitAim();
  }

  /**
   * The intercept: which way to point the guns so a round meets target t ({ pos, vel }). Worked in the air's
   * frame (the bullets' drag is against the air): the round leaves at the guns' muzzle speed plus our own
   * airspeed, slows under BALLISTICS' quadratic drag and drops under gravity, while he flies on at his
   * velocity. A few rounds of fixed-point iteration on the time of flight. Writes the unit direction to `out`
   * and the meeting point (world) to this.leadAt; returns the time of flight.
   */
  leadDir(f, t, out) {
    const { DRAG, GRAVITY, WIND } = BALLISTICS, m = f.k.muzzle;
    const uf = _ax.copy(f.dir).multiplyScalar(f.speed); // our airspeed vector (f.velocity less the wind)
    const ut = _ay.copy(WIND).negate(); // his, through the air (a bomber: still over the ground, flying through the air)
    if (t.vel) ut.add(t.vel);
    const r = _t.copy(t.pos).sub(f.pos); // where he is now (air frame, from us)
    let tof = r.length() / (m + f.speed);
    for (let i = 0; i < 4; i++) {
      // where he'll be then, plus the drop to allow for: the line the round must leave on
      out.copy(r).addScaledVector(ut, tof);
      out.y += 0.5 * GRAVITY * tof * tof;
      const d = out.length(), e = out.divideScalar(d || 1);
      // the round's speed on that line: |v0 e - uf| = m, so v0 = e.uf + sqrt((e.uf)^2 - uf.uf + m^2)
      const eu = e.dot(uf), v0 = eu + Math.sqrt(Math.max(0, eu * eu - uf.lengthSq() + m * m));
      // with dv/dt = -k v^2 it covers d in (e^(k d) - 1) / (k v0)
      tof = Math.min(3, (Math.exp(DRAG * d) - 1) / (DRAG * v0));
      if (i === 3) {
        this.leadAt = (this.leadAt ?? new V()).copy(t.pos); // (world: where he'll be when the rounds arrive)
        if (t.vel) this.leadAt.addScaledVector(t.vel, tof);
        out.multiplyScalar(v0).sub(uf).normalize(); // the gun line: launch velocity less our own speed
      }
    }
    return tof;
  }

  /** Where the locked target is now (for its brackets on the screen), or null. */
  get lockPos() { const l = this.locked; return l ? (l.pos ?? l.group?.position ?? null) : null; }

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
    // where the camera looks: the aim (mouse aim: the view is the aim), or with C held wherever you've looked;
    // let go and it swings back to the aim (~0.25 s)
    const looking = this.keys.KeyC && f.alive;
    if (looking) this.viewV.copy(this.lookV);
    else { this.viewV.lerp(this.aimV, 1 - Math.exp(-dt * 12)).normalize(); this.lookV.copy(this.viewV); }
    if (f.alive) f.obj.matrixWorld.decompose(_t, _fq, _l);
    if (f.alive && this.third) { // third person: behind your plane along the view, the horizon level (War Thunder's)
      this.showCockpit(null);
      for (const r of Object.values(this.reticles)) r.visible = false;
      const view = this.viewV;
      camera.position.copy(f.pos).addScaledVector(view, -THIRD_BACK).add(_l.set(0, THIRD_UP, 0));
      camera.up.set(0, 1, 0);
      if (Math.abs(view.y) > 0.985) camera.up.copy(f.dir).multiplyScalar(-Math.sign(view.y)); // (looking straight up or down: no "up" there)
      camera.lookAt(_t.copy(f.pos).addScaledVector(view, 60));
      this.camQ.copy(camera.quaternion);
      this.camPos.copy(camera.position);
      this.view = looking ? 'look' : 'third';
      return;
    }
    if (f.alive) {
      const c = this.showCockpit(f);
      if (!c.parent && camera.parent) camera.parent.add(c);
      c.matrix.copy(f.obj.matrixWorld);
      c.matrixWorldNeedsUpdate = true;
      this.camPos.copy(f.pos).addScaledVector(f.dir, -CHASE_BACK).y += CHASE_UP; // (for the end, if it comes)
      camera.position.fromArray(EYE[f.kind]).applyMatrix4(f.obj.matrixWorld);
      // your head turned to where you're looking, the view rolled with her (the cockpit's own up)
      const view = this.viewV, cu = _cu.set(0, 1, 0).applyQuaternion(_fq);
      if (Math.abs(view.dot(cu)) > 0.985) cu.copy(f.dir).multiplyScalar(-Math.sign(view.dot(cu))); // (straight up through the canopy)
      camera.up.copy(cu);
      camera.lookAt(_t.copy(camera.position).add(view));
      this.camQ.copy(camera.quaternion); // (the mouse turns the view as you see it)
      this.view = looking ? 'look' : 'aim';
      // the instruments, the stick and throttle, the night glow
      const vel = f.velocity, right = _ax.set(1, 0, 0).applyQuaternion(_fq), up = _ay.set(0, 1, 0).applyQuaternion(_fq);
      c.userData.update({
        speed: f.speed, alt: ALTITUDE + f.pos.y, climb: vel.y, heading: Math.atan2(f.dir.x, -f.dir.z), bank: Math.atan2(-right.y, up.y),
        pitch: Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1)), throttle: Math.min(1, this.throttle), heat: Math.max(...this.heat), damage: f.smoking || f.engineDead,
        time: this.fighters?.time ?? 0, stickX: this.stickX ?? 0, stickY: this.stickY ?? 0, ammo: this.ammo, ammoMax: AMMO[f.kind],
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
    const fm = f.fm, sys = f.sys, warn = [];
    if (fm && sys) {
      if (sys.blackout) warn.push('BLACKED OUT'); else if (sys.redout) warn.push('RED-OUT');
      if (fm.spin > 0.3) warn.push('SPIN: PUSH'); else if (fm.stalled) warn.push('STALL');
      if (fm.ias > SYSTEMS[f.kind].vne * 0.95) warn.push('OVERSPEED');
      if (fm.mach > fm.a.mcrit) warn.push('COMPRESSIBILITY');
      if (sys.temp > 0.95) warn.push('ENGINE HOT');
      if (sys.oilLeak) warn.push('OIL LEAK'); if (sys.coolantLeak) warn.push('COOLANT LEAK'); if (sys.fuelLeak) warn.push('FUEL LEAK');
      const c = fm.ctl;
      if (Math.min(c.ailL, c.ailR) < 0.6) warn.push('AILERON'); if (c.elev < 0.6) warn.push('ELEVATOR'); if (c.rud < 0.6) warn.push('RUDDER');
      if (fm.flapsBroken) warn.push('FLAPS GONE');
      if (sys.wound > 0) warn.push('WOUNDED');
    }
    return {
      kind: f.k.name, view: this.view, speed: f.speed, alt: (ALTITUDE + f.pos.y) * 3.281, throttle: this.throttle,
      wep: this.throttle > 1.001, g: fm?.g ?? 1, gStress: sys?.gStress ?? 0, temp: sys?.temp ?? 0, fuel: sys?.fuel ?? 1,
      flaps: fm ? fm.flaps : 0, ias: fm?.ias ?? f.speed, warn,
      health: f.alive ? have / max : 0, heat: Math.max(...this.heat), jammed: this.jammed.some(Boolean), ammo: byType, marker, aim, reflector: !this.plainSight && !this.third,
      damage: f.burning ? 'ON FIRE' : f.engineDead ? 'ENGINE OUT' : f.smoking ? 'ENGINE HIT' : '',
    };
  }
}
