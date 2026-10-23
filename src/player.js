// First-person crew member. Lives in the bomber's LOCAL space (feet position relative to the plane),
// so the plane can move and rock without the player sliding or falling through the floor.
import * as THREE from 'three';
import { makeFigure, pose, spotFor } from './crew.js';
import { reachFor } from './figure.js';

const R = 0.2; // body radius
const STAND_EYE = 1.58, MIN_EYE = 0.42, MIN_HEADROOM = 0.55;
const STEP = 0.42, WALK = 1.7, GRAVITY = 9.8, LOOK = 0.0022;
const _sh = new THREE.Vector3(), _sh2 = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const BODY_DROP = 0.14, BODY_BACK = 0.22; // m: your body's neck sits this far below and behind your eye
const TO_STATION = 4; // 1 / seconds to move into a gun position
const HEAD_YAW = THREE.MathUtils.degToRad(150); // pilots free-looking (C): as far round as a head turns in the seat
const EDGE = 0.9; // without mouse capture: only the outer edge of the screen keeps turning the view
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const _inv = new THREE.Quaternion(), _walkPos = new THREE.Vector3(), _walkRot = new THREE.Quaternion(), _gunRot = new THREE.Quaternion(), _euler = new THREE.Euler();

export class Player {
  constructor(bomber, camera) {
    this.bomber = bomber;
    this.it = bomber.interior;
    this.camera = camera;
    camera.rotation.order = 'YXZ';
    bomber.group.add(camera);
    this.feet = new THREE.Vector3(0, -1.80, -1.8); // radio room
    this.safe = this.feet.clone();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.yaw = Math.PI; // face aft, towards the waist
    this.pitch = 0;
    this.eye = STAND_EYE;
    this.camY = this.feet.y + this.eye;
    this.station = null;
    this.sYaw = 0; this.sPitch = 0; // look angles at a station, relative to its direction
    this.blend = 0; // 0 walking .. 1 at the station
    this.keys = {};
    this.enabled = false;
    this.near = null;
    this.firing = false; // left mouse held
    this.reloadPressed = false;
    this.recoil = 0;
    this.aimYaw = 0; this.aimPitch = 0; // pilot's aim, in the formation's frame
    this.headYaw = 0; this.headPitch = 0; // pilot's free look (hold C), on top of the aim
    this.throttle = 0.5;
    this.wounded = false; // down on the floor, waiting for first aid
    this.woundLeft = 0;
    this.dead = false;
    // your own body: look down and you see your chest, arms and boots (the head is left off)
    this.body = makeFigure({ self: true }); // (no head or collar: they'd sit round your eyes)
    this.it.group.add(this.body);
    this.stride = 0;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' && this.enabled && !e.repeat) this.interact();
      if (e.code === 'KeyR' && this.enabled && !e.repeat) this.reloadPressed = true;
      if (/^Digit[1-4]$/.test(e.code) && this.enabled && this.station?.flies && !e.repeat) this.bottlePressed = +e.code.slice(5) - 1;
      if (e.code === 'Space' && this.enabled && this.station?.sight) { e.preventDefault(); this.releasePressed = true; } // bombs away
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.firing = false; this.zoom = false; });
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.enabled) this.firing = true;
      if (e.button === 2 && this.enabled) this.zoom = true; // hold right click to zoom in
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; if (e.button === 2) this.zoom = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    this.zoom = false;
    this.lookScale = 1; // mouse turns slower while zoomed
    // fallback when the browser won't capture the mouse: moving the mouse still turns the view,
    // and holding the cursor near a screen edge keeps turning (so you never run out of screen)
    this.freeLook = false;
    this.cursor = null; // -1..1 screen position, null when outside the window
    document.addEventListener('mousemove', (e) => {
      this.cursor = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
      if (!this.enabled) return;
      // Chrome on Windows sometimes reports one huge bogus jump (on capture, or a stray event): skip it
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      if (document.pointerLockElement || this.freeLook) this.look(-e.movementX * LOOK * this.lookScale, -e.movementY * LOOK * this.lookScale);
    });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.cursor = null; }); // left the window
  }

  look(dYaw, dPitch) {
    if (this.station?.flies && this.keys.KeyC) { // hold C: look round without touching the controls
      this.headYaw = clamp(this.headYaw + dYaw, -HEAD_YAW, HEAD_YAW);
      this.headPitch = clamp(this.headPitch + dPitch, -0.5, 0.6); // (the cockpit roof is close overhead)
    } else if (this.station?.flies) { // War Thunder style: the mouse points where you want to fly
      this.aimYaw = wrap(this.aimYaw + dYaw);
      this.aimPitch = clamp(this.aimPitch + dPitch, -0.6, 0.6);
    } else if (this.station) {
      const s = this.station;
      this.sYaw = s.yawLim >= Math.PI ? wrap(this.sYaw + dYaw) : clamp(this.sYaw + dYaw, -s.yawLim, s.yawLim);
      this.sPitch = clamp(this.sPitch + dPitch, s.pitch[0], s.pitch[1]);
    } else {
      this.yaw = wrap(this.yaw + dYaw);
      this.pitch = clamp(this.pitch + dPitch, -1.45, 1.45);
    }
  }

  /**
   * Out of any station at once, cleanly: nothing left on the camera (the tail's iron sight, the ball and
   * top turret cockpits) and the hull parts a station hid or made see-through put back. For bailing out,
   * dying, changing role or bomber: anything that leaves a station without the usual walk away.
   */
  detachAll() {
    if (this.station) { this.station = null; this.lastStation = null; }
    this.blend = 0;
    if (this.ironOn) { this.camera.remove(this.ironOn); this.ironOn = null; }
    if (this.hidden) { this.it.setHidden(this.hidden, false); this.hidden = null; }
    if (this.ghosted) { this.it.setGhost(this.ghosted, false); this.ghosted = null; }
    if (this.it.topDome) this.it.topDome.visible = true;
  }

  /** Recoil from one shot: the view shakes while the guns hammer. */
  kick(amount) { this.recoil = Math.min(this.recoil + amount, 4); }

  /** Hit by enemy fire: you go down where you are and have 30 s unless someone patches you up. */
  wound(time = 30) {
    if (this.wounded || this.dead) return;
    if (this.station) this.interact(); // knocked off the gun
    this.wounded = true;
    this.woundLeft = time;
    this.firing = false;
    this.vel.set(0, 0, 0);
  }

  revive() {
    this.wounded = false;
    this.woundLeft = 0;
  }

  /** Start again as another man of the crew, at his post. */
  becomes(stand, yaw) {
    this.detachAll();
    this.dead = false;
    this.wounded = false;
    // a man who died at a gun can't leave it himself (interact() ignores the dead): start clean
    this.station = null; this.lastStation = null; this.blend = 0;
    this.firing = false; this.vy = 0; this.woundLeft = 0;
    this.reloadPressed = this.releasePressed = false;
    this.eye = STAND_EYE; this.camY = stand.y + STAND_EYE;
    this.feet.copy(stand);
    this.safe.copy(stand);
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
  }

  interact() {
    this.firing = false;
    if (this.wounded || this.dead) return;
    if (this.station) { // leave: stand up where you came in, looking the way the gun pointed
      this.yaw = this.station.yaw + this.sYaw;
      this.pitch = clamp(this.sPitch, -1.45, 1.45);
      this.feet.copy(this.station.stand);
      this.vel.set(0, 0, 0);
      this.station = null;
    } else if (this.near) {
      const s = (this.station = this.near);
      if (s.flies) {
        const f = this.bomber.flight;
        this.aimYaw = f.heading; this.aimPitch = f.pitch; this.throttle = f.throttle;
      }
      const rel = wrap(this.yaw - s.yaw);
      this.sYaw = s.yawLim >= Math.PI ? rel : clamp(rel, -s.yawLim, s.yawLim);
      this.sPitch = clamp(this.pitch, s.pitch[0], s.pitch[1]);
    }
  }

  get location() { return this.station ? this.station.name : this.it.zoneAt(this.feet.z); }

  /** The controls while you fly (null when you're not at the controls). */
  get controls() {
    if (!this.station?.flies || this.blend < 0.5 || this.wounded || this.dead) return null;
    const k = this.keys;
    return { aimYaw: this.aimYaw, aimPitch: this.aimPitch, throttle: this.throttle, roll: (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) };
  }

  get prompt() {
    if (this.wounded || this.dead) return '';
    if (this.firstAid) return this.firstAid;
    if (this.station?.flies) {
      const fire = this.bomber.engines.findIndex((e) => e.state === 'fire');
      if (fire >= 0) return `<b>${fire + 1}</b> Pull the fire bottle on engine ${fire + 1} (${this.bomber.bottles} left)`;
    }
    if (this.station) return `<b>E</b> Leave the ${this.station.name.toLowerCase()}`;
    if (this.near) return `<b>E</b> ${this.near.seat ? 'Sit in the' : 'Take the'} ${this.near.name.toLowerCase()}`;
    return '';
  }

  edgeTurn(dt) {
    const c = this.cursor;
    if (!c || !this.freeLook || document.pointerLockElement) return;
    const push = (v) => (Math.abs(v) > EDGE ? Math.sign(v) * (Math.abs(v) - EDGE) / (1 - EDGE) : 0);
    this.look(-push(c.x) * 2.4 * dt, -push(c.y) * 1.6 * dt);
  }

  update(dt) {
    if (this.enabled) this.edgeTurn(dt);
    if (!this.keys.KeyC || !this.station?.flies) { // let go of C: the view eases back to the aim (~0.3 s)
      const k = Math.exp(-dt * 10);
      this.headYaw *= k; this.headPitch *= k;
    }
    if (this.station?.flies && this.enabled) { // W / S: throttle
      const k = this.keys;
      this.throttle = clamp(this.throttle + ((k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0)) * dt * 0.4, 0, 1);
    }
    if (this.wounded) {
      if ((this.woundLeft -= dt) <= 0) { this.wounded = false; this.dead = true; }
      this.firing = false;
      this.eye += (0.3 - this.eye) * (1 - Math.exp(-dt * 3)); // lying on the floor
    } else if (this.enabled && !this.station && !this.dead) this.walk(dt);
    this.near = this.station || this.wounded ? null : this.it.nearestStation(this.feet);
    const rate = 1 / ((this.station ?? this.lastStation)?.entry?.time ?? 1 / TO_STATION); // (crawling into the tail takes a while)
    this.blend = clamp(this.blend + (this.station ? 1 : -1) * dt * rate, 0, 1);
    // hide hull parts that block the view from this position (only while settled in it)
    const hide = this.blend > 0.6 ? this.station?.hide : null;
    if (hide !== this.hidden) {
      if (this.hidden) this.it.setHidden(this.hidden, false);
      if (hide) this.it.setHidden(hide, true);
      this.hidden = hide;
    }
    const ghost = this.blend > 0.3 ? this.station?.ghost : null;
    if (ghost !== this.ghosted) {
      if (this.ghosted) this.it.setGhost(this.ghosted, false);
      if (ghost) this.it.setGhost(ghost, true);
      this.ghosted = ghost;
    }
    // things that turn with your aim: the tail's iron sight, the ball and upper turrets you sit in
    const iron = this.blend > 0.6 && this.station?.attach ? this.it[this.station.attach] : null;
    if (iron !== this.ironOn) {
      if (this.ironOn) this.camera.remove(this.ironOn);
      if (iron) this.camera.add(iron);
      this.ironOn = iron;
    }
    if (this.it.topDome) this.it.topDome.visible = iron !== this.it.topCockpit; // (in the turret, the dome is on your camera)
    this.pose(dt);
    // the upper turret's dome turns with the guns but doesn't tilt when they elevate
    const level = this.ironOn?.userData.level;
    if (level) level.rotation.x = -_euler.setFromQuaternion(this.camera.quaternion, 'YXZ').x;
    this.updateBody(dt);
  }

  updateBody(dt) {
    const b = this.body, j = b.userData.j, s = this.station;
    if (this.dead) { b.visible = false; return; }
    // crawling or climbing into a cramped position, the camera takes its own way: don't let it pass
    // through your own body on the way
    const entering = (this.station ?? this.lastStation)?.entry && this.blend > 0.02 && this.blend < 0.92;
    b.visible = !entering && !this.away; // (and not while you're out of the plane)
    if (entering) return;
    j.legL.hip.visible = j.legR.hip.visible = true;
    if (this.wounded) {
      b.position.copy(this.feet);
      b.rotation.y = this.yaw;
      pose(b, 'lie');
      return;
    }
    if (s && this.blend > 0.5) {
      const spot = spotFor(s.id);
      if (!spot || spot.pose === 'hidden') { b.visible = false; return; }
      // pick the pose that puts the neck just under the gun position's eye point
      const E = this.eyeAt(s);
      const need = E.y - 0.7 - spot.at.y;
      const name = spot.pose === 'sit' ? 'sit' : need > 0.8 ? 'gun' : need > 0.56 ? 'crouch' : 'kneel';
      pose(b, name);
      const yaw = s.yaw + this.sYaw * (s.yawLim >= Math.PI ? 1 : 0.6);
      const y = E.y - 0.6 - BODY_DROP - j.hips.position.y;
      b.rotation.y = yaw;
      b.position.set(E.x + Math.sin(yaw) * BODY_BACK, y, E.z + Math.cos(yaw) * BODY_BACK);
      if (spot.at.y - y > 0.3) j.legL.hip.visible = j.legR.hip.visible = false; // cramped: legs would go through the floor
      b.userData.noHead = false;
      const rig = b.userData.rig;
      if (s.guns && this.gripTargets && rig && b.parent) {
        // at a gun you lean in over it: your shoulders just under and behind your eye (where your
        // head would fill the view, so it isn't drawn), close enough that your hands reach the grips
        // (the shoulders in the body's own frame, from the last sync: the pose doesn't change)
        const sh = b.worldToLocal(rig.arms.l.upper.getWorldPosition(_sh).add(rig.arms.r.upper.getWorldPosition(_sh2)).multiplyScalar(0.5));
        b.updateMatrix();
        sh.applyMatrix3(_m3.setFromMatrix4(b.matrix)); // (turned and scaled as the body now is)
        b.position.set(E.x + Math.sin(yaw) * 0.1, E.y - 0.24, E.z + Math.cos(yaw) * 0.1).sub(sh);
        b.userData.noHead = true;
        reachFor(b, this.gripTargets); // your hands on your gun's grips
      }
      return;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.stride += speed * dt;
    pose(b, this.eye < 1.3 ? 'crouch' : speed > 0.15 ? 'walk' : 'stand', this.stride * 0.55);
    // empty-handed, your arms hang at your sides even crouched (held out in front they'd fill the
    // bottom corners of the screen)
    if (this.eye < 1.3) for (const a of [j.armL, j.armR]) { a.sh.rotation.x = 0.2; a.el.rotation.x = 0.25; }
    b.rotation.y = this.yaw;
    // the neck always sits just under and behind the eye, however low you duck, so the camera
    // never ends up inside your own shoulders (arms flashing across the view as you walk)
    const y = this.camY - (j.hips.position.y + 0.6) - BODY_DROP;
    b.position.set(this.feet.x + Math.sin(this.yaw) * BODY_BACK, y, this.feet.z + Math.cos(this.yaw) * BODY_BACK);
  }

  walk(dt) {
    const k = this.keys, it = this.it;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const crouch = clamp(this.eye / STAND_EYE, 0.45, 1);
    const speed = WALK * crouch * (k.ShiftLeft || k.ShiftRight ? 1.5 : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const want = (this._want ??= new THREE.Vector3()).set(-sin * f + cos * s, 0, -cos * f - sin * s);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    this.vel.lerp(want, 1 - Math.exp(-dt * 12));

    // horizontal: small fixed sub-steps so a slow frame can't jump through anything
    const n = Math.min(8, Math.ceil(dt * 120)), h = dt / n;
    const crowd = this.brushPast(); // squeezing past a crewman: under half speed
    for (let i = 0; i < n; i++) this.move(this.vel.x * h * crowd, this.vel.z * h * crowd);

    // vertical: step up onto anything low enough, step down small drops, otherwise fall
    const floor = it.floorAt(this.feet.x, this.feet.z, this.feet.y + STEP);
    if (floor >= this.feet.y || (this.vy === 0 && floor >= this.feet.y - STEP)) { this.feet.y = floor; this.vy = 0; }
    else {
      this.vy -= GRAVITY * dt;
      this.feet.y = Math.max(floor, this.feet.y + this.vy * dt);
      if (this.feet.y === floor) this.vy = 0;
    }
    if (!(this.feet.y > -6)) { this.feet.copy(this.safe); this.vy = 0; } // fell out of the world
    else if (this.vy === 0) this.safe.copy(this.feet);

    // crouch automatically under low ceilings
    const room = (this.room = it.headroom(this.feet.x, this.feet.z, this.feet.y, R, STEP));
    const target = clamp(room - 0.12, MIN_EYE, STAND_EYE);
    this.eye += (target - this.eye) * (1 - Math.exp(-dt * (target < this.eye ? 14 : 5)));
  }

  /**
   * The crew are soft obstacles: in a B-17 you squeeze past people. Walking into a man slows you to
   * under half speed while you shoulder past him, but never stops you (pushing round him could leave
   * you wedged beside a door). Crew hides a man while your eye is inside him. Returns the speed factor.
   */
  brushPast() {
    for (const b of this.it.people) {
      if (b.max.y <= this.feet.y + 0.3 || b.min.y >= this.feet.y + this.eye) continue;
      const cx = Math.max(b.min.x, Math.min(this.feet.x, b.max.x)), cz = Math.max(b.min.z, Math.min(this.feet.z, b.max.z));
      if (Math.hypot(this.feet.x - cx, this.feet.z - cz) < R) return 0.4;
    }
    return 1;
  }

  /** One small step: the whole move if it fits, otherwise slide along whichever axis does. */
  move(dx, dz) {
    if (dx === 0 && dz === 0) return;
    if (this.tryMove(this.feet.x + dx, this.feet.z + dz)) return;
    if (Math.abs(dx) > Math.abs(dz)) this.tryMove(this.feet.x + dx, this.feet.z) || this.tryMove(this.feet.x, this.feet.z + dz);
    else this.tryMove(this.feet.x, this.feet.z + dz) || this.tryMove(this.feet.x + dx, this.feet.z);
  }

  tryMove(x, z) {
    const it = this.it, p = (this._p ??= new THREE.Vector3()).set(x, 0, z);
    // judge the move from the floor we'd be standing on there (so stepping up onto a deck works)
    const feet = Math.max(this.feet.y, it.floorAt(x, z, this.feet.y + STEP));
    // only things below chest height block; anything higher you duck under (headroom check).
    // Boxes push you out sideways instead of stopping you dead, so you glide round corners and through doors.
    it.pushOut(p, R, feet + STEP, feet + MIN_HEADROOM);
    if (Math.hypot(p.x - this.feet.x, p.z - this.feet.z) > 0.1) return false; // squeezed between boxes
    if (it.blocked(p.x, p.z, R * 0.95, feet + STEP, feet + MIN_HEADROOM)) return false;
    if (it.headroom(p.x, p.z, feet, R, STEP) < MIN_HEADROOM) return false;
    // the body (up to the shoulders) must fit between the hull walls; the head is checked by headroom
    const lim = it.wallLimit(p.z, feet + 0.3, feet + Math.max(this.eye - 0.25, 0.35)) - R;
    if (lim <= 0.02) return false;
    this.feet.x = clamp(p.x, -lim, lim);
    this.feet.z = p.z;
    return true;
  }

  /** Where your eye is at a station: its eye point, or behind a flexible gun, following it round. */
  eyeAt(s) { return (s.eyeBehind || s.lean) && this.gunEye && this.station === s ? this.gunEye : s.eye; }

  pose(dt) {
    // smooth the camera height so steps and crouching don't snap
    const walkY = this.feet.y + this.eye;
    this.camY += (walkY - this.camY) * (1 - Math.exp(-dt * 8));
    // the eye never goes through the roof or into the curving wall, whatever the smoothing is doing
    if (this.room != null) this.camY = Math.min(this.camY, this.feet.y + this.room - 0.09);
    const wall = Math.max(0, this.it.hwSmooth(this.feet.z, this.camY) - 0.09);
    const walkPos = _walkPos.set(clamp(this.feet.x, -wall, wall), this.camY, this.feet.z);
    const walkRot = _walkRot.setFromEuler(_euler.set(this.pitch, this.yaw, 0, 'YXZ'));
    const t = THREE.MathUtils.smoothstep(this.blend, 0, 1);
    const s = this.station ?? this.lastStation;
    if (this.station) this.lastStation = this.station;
    if (!s || t === 0) {
      this.camera.position.copy(walkPos);
      this.camera.quaternion.copy(walkRot);
      return;
    }
    const yaw = this.station ? s.yaw + this.sYaw : this.yaw, pitch = this.station ? this.sPitch : this.pitch;
    const gunRot = _gunRot.setFromEuler(_euler.set(pitch, yaw, 0, 'YXZ'));
    if (this.station?.flies) { // the view follows the aim through the sky, steady while the plane banks under you
      gunRot.setFromEuler(_euler.set(clamp(this.aimPitch + this.headPitch, -1.45, 1.45), this.aimYaw + this.headYaw, 0, 'YXZ')).premultiply(_inv.copy(this.bomber.group.quaternion).invert());
    }
    if (s.entry) { // the way in: a crawl, a climb, a step up (and the same way out)
      const e = s.entry;
      e.curve ??= new THREE.CatmullRomCurve3([new THREE.Vector3(), ...e.path.map((p) => new THREE.Vector3(...p)), new THREE.Vector3()]);
      e.curve.points[0].copy(walkPos);
      e.curve.points[e.curve.points.length - 1].copy(this.eyeAt(s));
      const k = clamp(this.blend, 0, 1); // (even pace along the way, not eased)
      e.curve.getPoint(k, this.camera.position);
      if (k > 0 && k < 1) this.camera.position.y += Math.sin(k * Math.PI * 2 * e.bobs) * e.bob * (1 - k * 0.6); // hands and knees
    } else this.camera.position.lerpVectors(walkPos, this.eyeAt(s), t);
    this.camera.quaternion.slerpQuaternions(walkRot, gunRot, t);
    // recoil shake: small random jolts that die away quickly
    this.recoil *= Math.exp(-dt * 14);
    if (this.recoil > 0.01) {
      const r = this.recoil * 0.0012;
      this.camera.rotateX((Math.random() - 0.3) * r);
      this.camera.rotateY((Math.random() - 0.5) * r);
      this.camera.translateZ(Math.random() * r * 6);
    }
  }
}
