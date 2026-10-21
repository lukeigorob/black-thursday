// First-person crew member. Lives in the bomber's LOCAL space (feet position relative to the plane),
// so the plane can move and rock without the player sliding or falling through the floor.
import * as THREE from 'three';

const R = 0.2; // body radius
const STAND_EYE = 1.58, MIN_EYE = 0.42, MIN_HEADROOM = 0.55;
const STEP = 0.42, WALK = 1.7, GRAVITY = 9.8, LOOK = 0.0022;
const TO_STATION = 4; // 1 / seconds to move into a gun position
const EDGE = 0.75; // without mouse capture: the outer quarter of the screen keeps turning the view
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

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
    this.wounded = false; // down on the floor, waiting for first aid
    this.woundLeft = 0;
    this.dead = false;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' && this.enabled && !e.repeat) this.interact();
      if (e.code === 'KeyR' && this.enabled && !e.repeat) this.reloadPressed = true;
      if (e.code === 'Space' && this.enabled && this.station?.sight) { e.preventDefault(); this.releasePressed = true; } // bombs away
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.firing = false; });
    addEventListener('mousedown', (e) => { if (e.button === 0 && this.enabled) this.firing = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
    // fallback when the browser won't capture the mouse: moving the mouse still turns the view,
    // and holding the cursor near a screen edge keeps turning (so you never run out of screen)
    this.freeLook = false;
    this.cursor = null; // -1..1 screen position, null when outside the window
    document.addEventListener('mousemove', (e) => {
      this.cursor = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
      if (!this.enabled) return;
      if (document.pointerLockElement || this.freeLook) this.look(-e.movementX * LOOK, -e.movementY * LOOK);
    });
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.cursor = null; }); // left the window
  }

  look(dYaw, dPitch) {
    if (this.station) {
      const s = this.station;
      this.sYaw = s.yawLim >= Math.PI ? wrap(this.sYaw + dYaw) : clamp(this.sYaw + dYaw, -s.yawLim, s.yawLim);
      this.sPitch = clamp(this.sPitch + dPitch, s.pitch[0], s.pitch[1]);
    } else {
      this.yaw = wrap(this.yaw + dYaw);
      this.pitch = clamp(this.pitch + dPitch, -1.45, 1.45);
    }
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
    this.dead = false;
    this.wounded = false;
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
      const rel = wrap(this.yaw - s.yaw);
      this.sYaw = s.yawLim >= Math.PI ? rel : clamp(rel, -s.yawLim, s.yawLim);
      this.sPitch = clamp(this.pitch, s.pitch[0], s.pitch[1]);
    }
  }

  get location() { return this.station ? this.station.name : this.it.zoneAt(this.feet.z); }

  get prompt() {
    if (this.wounded || this.dead) return '';
    if (this.firstAid) return this.firstAid;
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
    if (this.wounded) {
      if ((this.woundLeft -= dt) <= 0) { this.wounded = false; this.dead = true; }
      this.firing = false;
      this.eye += (0.3 - this.eye) * (1 - Math.exp(-dt * 3)); // lying on the floor
    } else if (this.enabled && !this.station && !this.dead) this.walk(dt);
    this.near = this.station || this.wounded ? null : this.it.nearestStation(this.feet);
    this.blend = clamp(this.blend + (this.station ? 1 : -1) * dt * TO_STATION, 0, 1);
    // hide hull parts that block the view from this position (only while settled in it)
    const hide = this.blend > 0.6 ? this.station?.hide : null;
    if (hide !== this.hidden) {
      if (this.hidden) this.it.setHidden(this.hidden, false);
      if (hide) this.it.setHidden(hide, true);
      this.hidden = hide;
    }
    this.pose(dt);
  }

  walk(dt) {
    const k = this.keys, it = this.it;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const crouch = clamp(this.eye / STAND_EYE, 0.45, 1);
    const speed = WALK * crouch * (k.ShiftLeft || k.ShiftRight ? 1.5 : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const want = new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    this.vel.lerp(want, 1 - Math.exp(-dt * 12));

    // horizontal: one axis at a time so you slide along walls
    this.tryMove(this.feet.x + this.vel.x * dt, this.feet.z);
    this.tryMove(this.feet.x, this.feet.z + this.vel.z * dt);

    // vertical: step up onto anything low enough, otherwise fall
    const floor = it.floorAt(this.feet.x, this.feet.z, this.feet.y + STEP);
    if (floor >= this.feet.y) { this.feet.y = floor; this.vy = 0; }
    else {
      this.vy -= GRAVITY * dt;
      this.feet.y = Math.max(floor, this.feet.y + this.vy * dt);
      if (this.feet.y === floor) this.vy = 0;
    }
    if (!(this.feet.y > -6)) { this.feet.copy(this.safe); this.vy = 0; } // fell out of the world
    else if (this.vy === 0) this.safe.copy(this.feet);

    // crouch automatically under low ceilings
    const room = it.headroom(this.feet.x, this.feet.z, this.feet.y, R, STEP);
    const target = clamp(room - 0.12, MIN_EYE, STAND_EYE);
    this.eye += (target - this.eye) * (1 - Math.exp(-dt * (target < this.eye ? 14 : 5)));
  }

  tryMove(x, z) {
    const it = this.it;
    // judge the move from the floor we'd be standing on there (so stepping up onto a deck works)
    const feet = Math.max(this.feet.y, it.floorAt(x, z, this.feet.y + STEP));
    // only things below chest height block; anything higher you duck under (headroom check)
    if (it.blocked(x, z, R, feet + STEP, feet + MIN_HEADROOM)) return;
    if (it.headroom(x, z, feet, R, STEP) < MIN_HEADROOM) return;
    // the body (up to the shoulders) must fit between the hull walls; the head is checked by headroom
    const lim = it.wallLimit(z, feet + 0.3, feet + Math.max(this.eye - 0.25, 0.35)) - R;
    if (lim <= 0.02) return;
    this.feet.x = clamp(x, -lim, lim);
    this.feet.z = z;
  }

  pose(dt) {
    // smooth the camera height so steps and crouching don't snap
    const walkY = this.feet.y + this.eye;
    this.camY += (walkY - this.camY) * (1 - Math.exp(-dt * 12));
    const walkPos = new THREE.Vector3(this.feet.x, this.camY, this.feet.z);
    const walkRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const t = THREE.MathUtils.smoothstep(this.blend, 0, 1);
    const s = this.station ?? this.lastStation;
    if (this.station) this.lastStation = this.station;
    if (!s || t === 0) {
      this.camera.position.copy(walkPos);
      this.camera.quaternion.copy(walkRot);
      return;
    }
    const yaw = this.station ? s.yaw + this.sYaw : this.yaw, pitch = this.station ? this.sPitch : this.pitch;
    const gunRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    this.camera.position.lerpVectors(walkPos, s.eye, t);
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
