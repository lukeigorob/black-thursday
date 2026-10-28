// First-person crew member. Lives in the bomber's LOCAL space (feet position relative to the plane),
// so the plane can move and rock without the player sliding or falling through the floor.
import * as THREE from 'three';
import { makeFigure, pose, spotFor } from './crew.js';
import { reachFor } from './figure.js';
import { turretPoint, PASSAGES, TAILWAY, turretFloor } from './interior.js';

const R = 0.2; // body radius
const STAND_EYE = 1.58, MIN_EYE = 0.42, MIN_HEADROOM = 0.55;
// where on you a hit lands, and how much worse (or less bad) than one in the body it is: the head is the
// worst, the chest and belly as they were, an arm or a leg much less
export const ZONES = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
const ZONE_HARM = { head: 2.2, torso: 1, armL: 0.45, armR: 0.45, legL: 0.45, legR: 0.45 };
const noWounds = () => Object.fromEntries(ZONES.map((z) => [z, 0]));
const STEP = 0.42, WALK = 1.7, GRAVITY = 9.8, LOOK = 0.0022;
const _sh = new THREE.Vector3(), _sh2 = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const OUT_BY = { tail: TAILWAY.fwd }; // positions you leave by crawling straight out (E at the tail gun: back to the waist)
// a crawl's progress against time: easing in and out over its first and last 12%, steady between
const easeEnds = (k, a = 0.12) => { const v = 1 / (1 - a); return k < a ? v * k * k / (2 * a) : k > 1 - a ? 1 - v * (1 - k) ** 2 / (2 * a) : v * (k - a / 2); };
const BODY_DROP = 0.14, BODY_BACK = 0.22; // m: your body's neck sits this far below and behind your eye
const TO_STATION = 4; // 1 / seconds to move into a gun position
const HEAD_YAW = THREE.MathUtils.degToRad(150); // pilots free-looking (C): as far round as a head turns in the seat
const GUN_HEAD = { yaw: THREE.MathUtils.degToRad(100), up: 0.7, down: -0.6 }; // at a gun: your head turns, the gun stays put
const TURRET_HEAD = { yaw: 0.9, up: 0.5, down: -0.5 }; // (curled up in a turret there's less room to turn)
const _head = new THREE.Quaternion(), _headInv = new THREE.Quaternion();
const EDGE = 0.9; // without mouse capture: only the outer edge of the screen keeps turning the view
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const NOSE_KEYS = ['cheekL', 'noseL', 'noseR', 'cheekR', 'bombsight']; // (keys 1 - 5 in the nose: the guns left to right, then the sight)
const _crawlAt = new THREE.Vector3(), _crawlQ = new THREE.Quaternion(), _third = new THREE.Vector3();
const THIRD_BACK = 36, THIRD_UP = 6; // m: the third-person view from the pilot's seat, behind and above your bomber
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
    this.learned = new Set(); // the positions you've taken this game (their E no longer shown)
    this.firing = false; // left mouse held
    this.reloadPressed = false;
    this.recoil = 0;
    this.aimYaw = 0; this.aimPitch = 0; // pilot's aim, in the formation's frame
    this.headYaw = 0; this.headPitch = 0; // pilot's free look (hold C), on top of the aim
    this.throttle = 0.5;
    this.wounded = false; // down on the floor, waiting for first aid
    this.health = 1; // 0..1: hits take it down; at nothing you're down (wounded)
    this.wounds = noWounds(); // how hurt each part of you is, 0..1 (ZONES): what the figure on the HUD shows
    this.woundLeft = 0;
    this.dead = false;
    // your own body: look down and you see your chest, arms and boots (the head is left off)
    this.body = makeFigure({ self: true }); // (no head or collar: they'd sit round your eyes)
    this.it.group.add(this.body);
    this.stride = 0;

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' && this.enabled && !e.repeat) this.use();
      if (e.code === 'KeyB' && this.enabled && !e.repeat) this.useSight(); // the bombsight, from anywhere in the nose (on the bomb run)
      if (/^Digit[1-5]$/.test(e.code) && this.enabled && !e.repeat && this.inNose) this.noseSwitch(+e.code.slice(5)); // the bombardier's guns and sight
      if (e.code === 'KeyR' && this.enabled && !e.repeat) this.reloadPressed = true;
      if (/^Digit[1-4]$/.test(e.code) && this.enabled && this.station?.flies && !e.repeat) this.bottlePressed = +e.code.slice(5) - 1;
      if (e.code === 'KeyT' && this.enabled && this.station?.flies && !e.repeat) this.extinguishPressed = true; // the worst engine's fire bottle
      if (e.code === 'KeyF' && this.enabled && this.station?.flies && !e.repeat) this.featherPressed = true; // feather the worst engine
      if (e.code === 'Space' && this.enabled && this.station?.sight) { e.preventDefault(); this.releasePressed = true; } // bombs away
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.firing = false; this.zoom = false; });
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.enabled && this.hatch && !this.wounded) { this.onHatch?.(); return; } // (a click at a lit hatch: out)
      if (e.button === 0 && this.enabled && !this.station && (this.passage || this.near) && !this.crawl && !this.wounded) { this.interact(); return; } // (a click at a crawlway or a position takes it, as E does)
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

  /**
   * A powered turret (the ball): its motors drive it towards where you're aiming, getting up to speed
   * and slowing to a stop rather than snapping there (about 60 degrees a second at most).
   */
  drive(dt) {
    const s = this.station;
    if (s?.whine && dt > 0) { // (the ball follows the mouse directly: its motors' whine goes with how fast it's turning)
      const sp = this._drove ? Math.hypot(wrap(this.sYaw - this._drove[0]), this.sPitch - this._drove[1]) / dt : 0;
      this.turretSpeed = (this.turretSpeed ?? 0) + (Math.min(sp, 2) - (this.turretSpeed ?? 0)) * Math.min(1, dt * 12);
      this._drove = [this.sYaw, this.sPitch];
      return;
    }
    if (!s?.powered || !(dt > 0)) { this.turretSpeed = 0; this.tYaw = this.tPitch = undefined; this.vYaw = this.vPitch = 0; this._drove = undefined; return; }
    if (this.tYaw === undefined || this._drove === undefined || Math.abs(wrap(this.sYaw - this._drove[0])) > 1e-6 || Math.abs(this.sPitch - this._drove[1]) > 1e-6) { this.tYaw = this.sYaw; this.tPitch = this.sPitch; } // (set from outside: start from there)
    const MAX = 1.05, ACC = 4.5, step = (v, err) => { const want = clamp(err * 7, -MAX, MAX); return v + clamp(want - v, -ACC * dt, ACC * dt); };
    this.vYaw = step(this.vYaw ?? 0, wrap(this.tYaw - this.sYaw)); this.vPitch = step(this.vPitch ?? 0, this.tPitch - this.sPitch);
    this.sYaw = wrap(this.sYaw + this.vYaw * dt); this.sPitch = clamp(this.sPitch + this.vPitch * dt, s.pitch[0], s.pitch[1]);
    this.turretSpeed = Math.hypot(this.vYaw, this.vPitch);
    this._drove = [this.sYaw, this.sPitch];
  }

  /** Holding C at a station: looking round with your head, the gun (or the plane) left as it was. */
  get freeLooking() { return !!this.station && !!this.keys.KeyC && this.blend > 0.9; }

  look(dYaw, dPitch) {
    if (this.station?.flies && this.keys.KeyC) { // hold C: look round without touching the controls
      this.headYaw = clamp(this.headYaw + dYaw, -HEAD_YAW, HEAD_YAW);
      this.headPitch = clamp(this.headPitch + dPitch, -0.5, 0.6); // (the cockpit roof is close overhead)
    } else if (this.station && this.keys.KeyC) { // at a gun or the sight: the same, the gun stays where it points
      const h = this.station.attach === 'ballCockpit' || this.station.attach === 'topCockpit' ? TURRET_HEAD : GUN_HEAD;
      this.headYaw = clamp(this.headYaw + dYaw, -h.yaw, h.yaw);
      this.headPitch = clamp(this.headPitch + dPitch, h.down, h.up);
    } else if (this.station?.flies) { // War Thunder style: the mouse points where you want to fly
      this.aimYaw = wrap(this.aimYaw + dYaw);
      this.aimPitch = clamp(this.aimPitch + dPitch, -0.6, 0.6);
    } else if (this.station?.powered) { // a powered turret: the mouse sets where it's going, its motors take it there (drive)
      const s = this.station;
      this.tYaw = wrap((this.tYaw ?? this.sYaw) + dYaw); this.tPitch = clamp((this.tPitch ?? this.sPitch) + dPitch, s.pitch[0], s.pitch[1]);
      // (no winding the target far ahead of the turret)
      const ey = wrap(this.tYaw - this.sYaw); if (Math.abs(ey) > 0.5) this.tYaw = wrap(this.sYaw + Math.sign(ey) * 0.5);
      if (Math.abs(this.tPitch - this.sPitch) > 0.4) this.tPitch = this.sPitch + Math.sign(this.tPitch - this.sPitch) * 0.4;
    } else if (this.station) {
      const s = this.station;
      this.sYaw = s.yawLim >= Math.PI ? wrap(this.sYaw + dYaw) : clamp(this.sYaw + dYaw, -s.yawLim, s.yawLim);
      this.sPitch = clamp(this.sPitch + dPitch, turretFloor(s, this.sYaw), s.pitch[1]);
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
  /** A blast close by: the whole view jolted (k 0..1). */
  jolt(k) { this.shake = Math.min(1, (this.shake ?? 0) + k); }

  /**
   * Hit near you: `amount` of your health gone (and the pain of it). At nothing you're down. Returns how
   * bad it was: 'hurt' or 'down' (or null if nothing happened).
   */
  hurt(amount, zone = 'torso') {
    if (this.wounded || this.dead || amount <= 0) return null;
    amount *= ZONE_HARM[zone] ?? 1;
    this.wounds[zone] = Math.min(1, (this.wounds[zone] ?? 0) + amount * 1.6);
    this.lastZone = zone;
    this.health = Math.max(0, this.health - amount);
    this.hurtAt = performance.now();
    if (this.health > 0) return 'hurt';
    if (this.patched) { this.wound(); return 'dead'; } // (patched up once already: this one kills you)
    this.wound();
    return 'down';
  }

  /**
   * The part of you a hit at `at` (bomber space) lands on: by its height up your body as you stand, sit or
   * crouch (your eye's height: head above the chin, legs below the hips), and the side it's on; in the
   * chest's height a third of them take an arm instead. doubt: 0..1, how little `at` says about the height
   * (a round striking the skin near you rather than you: anywhere up you, leaning to its height).
   */
  zoneAt(at, doubt = 0) {
    const tall = Math.max(0.5, this.eye + 0.12), h0 = THREE.MathUtils.clamp((at.y - this.feet.y) / tall, 0, 1), h = h0 * (1 - doubt) + Math.random() * doubt;
    const side = at.x < this.feet.x ? 'L' : 'R';
    if (h > 0.88) return 'head';
    if (h > 0.5) return Math.random() < 0.33 ? `arm${side}` : 'torso';
    return `leg${side}`;
  }

  /** Hit by enemy fire: you go down where you are and have 30 s unless someone patches you up. */
  wound(time = 30) {
    if (this.wounded || this.dead) return;
    if (this.station) this.interact(); // knocked off the gun
    if (this.patched) { this.dead = true; this.firing = false; return; } // the second time: no getting up from it
    this.wounded = true;
    this.woundLeft = time;
    this.firing = false;
    this.vel.set(0, 0, 0);
  }

  revive() {
    this.wounded = false;
    this.woundLeft = 0;
    this.health = 0.6; // (patched up, not new)
    this.patched = true; // (once: another wound like that and you're dead)
  }

  /** Start again as another man of the crew, at his post. */
  becomes(stand, yaw) {
    this.detachAll();
    this.dead = false;
    this.wounded = false;
    // a man who died at a gun can't leave it himself (interact() ignores the dead): start clean
    this.station = null; this.lastStation = null; this.blend = 0; this.crawl = null;
    this.firing = false; this.vy = 0; this.woundLeft = 0; this.health = 1; this.wounds = noWounds(); this.lastZone = null;
    this.reloadPressed = this.releasePressed = false;
    this.eye = STAND_EYE; this.camY = stand.y + STAND_EYE;
    this.feet.copy(stand);
    this.safe.copy(stand);
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
  }

  /** E: as interact(), but from the tail gun straight out along the crawl to the waist (not while she's
   * going down: then you're left in the tail, by its door). */
  use() {
    const p = this.station && OUT_BY[this.station.id];
    if (p && this.blend > 0.95 && !this.hatches && !this.hatch && !this.wounded && !this.dead && !this.crawl) { this.crawlOut(p); return; }
    this.interact();
  }

  /** Off a position and into a crawl from it: from your eye where it is, back the way in, then the crawl. */
  crawlOut(p) {
    const s = this.station, from = this.camera.position.clone(), yaw = s.yaw + this.sYaw, pitch = this.sPitch;
    this.feet.copy(s.stand); this.vel.set(0, 0, 0);
    this.station = null; this.lastStation = null; this.blend = 0;
    this.startCrawl(p, { from, via: s.entry ? [...s.entry.path].reverse() : [], yaw, pitch });
  }

  interact() {
    if (this.hatch && !this.wounded && !this.dead) { this.onHatch?.(); return; } // (going down: out through the hatch)
    this.firing = false;
    if (this.wounded || this.dead || this.crawl) return;
    if (!this.station && this.passage) { this.startCrawl(this.passage); return; }
    if (this.station) { // leave: stand up where you came in, looking the way the gun pointed
      this.yaw = this.station.yaw + this.sYaw;
      this.pitch = clamp(this.sPitch, -1.45, 1.45);
      this.feet.copy(this.station.stand);
      this.vel.set(0, 0, 0);
      this.station = null;
    } else if (this.near) {
      const s = (this.station = this.near);
      if (!this.learned.has(s.id)) { this.learned.add(s.id); this.leaveHintUntil = performance.now() + 4500; } // (the first time here)
      if (s.flies) {
        const f = this.bomber.flight;
        this.aimYaw = f.heading; this.aimPitch = f.pitch; this.throttle = f.throttle;
      }
      const rel = wrap(this.yaw - s.yaw);
      this.sYaw = s.yawLim >= Math.PI ? rel : clamp(rel, -s.yawLim, s.yawLim);
      this.sPitch = clamp(this.pitch, s.pitch[0], s.pitch[1]);
    }
  }

  /**
   * An "E" hanging over each crawlway's opening while you're near it, brighter when you can take it; and
   * one at every position (the guns, the seats, the sight) until you've taken it once this game.
   */
  passageMarks() {
    if (!this.marks) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(12,12,10,0.72)'; g.strokeStyle = '#e8d8a8'; g.lineWidth = 6;
      g.beginPath(); g.roundRect(14, 14, 100, 100, 16); g.fill(); g.stroke();
      g.fillStyle = '#f4ead0'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('E', 64, 70);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.marks = PASSAGES.map((p) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
        s.scale.setScalar(0.16); s.position.set(p.from[0], p.floor + (p.floor < -1.5 ? 0.62 : p === PASSAGES[0] ? 0.14 : 0.4), p.from[1]); s.renderOrder = 6; s.userData.p = p; // (the flight deck's: just over its hatch)
        this.it.group.add(s);
        return s;
      });
      // the positions': over the gun, the seat or the sight, a little below where your eye goes
      for (const st of this.it.stations) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
        s.scale.setScalar(0.13); s.renderOrder = 7; s.userData.st = st;
        s.position.copy(st.eye).add(new THREE.Vector3(0, st.seat ? -0.15 : -0.22, 0));
        if (st.id === 'ball') s.position.set(st.stand.x, st.stand.y + 0.25, st.stand.z); // (the ball's hatch, in the floor)
        if (st.id === 'top') s.position.set(st.stand.x, st.stand.y + 1.25, st.stand.z);
        this.it.group.add(s);
        this.marks.push(s);
      }
    }
    const t = performance.now() / 1000;
    for (const s of this.marks) {
      const st = s.userData.st;
      if (st) { // a position's: near it, not yet learned
        const d = Math.hypot(this.feet.x - st.stand.x, this.feet.z - st.stand.z);
        const on = !this.station && !this.crawl && !this.away && !this.wounded && !this.dead && !this.learned.has(st.id) && d < 2.0 && Math.abs(this.feet.y - st.stand.y) < 0.6;
        const k = on ? (this.near === st ? 1 : 0.45) : 0;
        s.material.opacity += (k - s.material.opacity) * 0.15;
        s.visible = s.material.opacity > 0.02;
        s.scale.setScalar(this.near === st ? 0.13 + 0.01 * Math.sin(t * 5) : 0.11);
        continue;
      }
      const p = s.userData.p, d = Math.hypot(this.feet.x - p.from[0], this.feet.z - p.from[1]);
      const on = !this.station && !this.crawl && !this.away && Math.abs(this.feet.y - p.floor) < 0.3 && d < 2.6;
      const k = on ? (this.passage === p ? 1 : 0.55) : 0;
      s.material.opacity += (k - s.material.opacity) * 0.15;
      s.visible = s.material.opacity > 0.02;
      s.scale.setScalar(this.passage === p ? 0.16 + 0.012 * Math.sin(t * 5) : 0.14);
    }
  }

  /** Going down: a red "E" over every bail-out hatch, pulsing, brightest at the one you're at. */
  hatchMarks() {
    if (!this.hatchSprites && this.hatches) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(150,20,10,0.85)'; g.strokeStyle = '#ffb0a0'; g.lineWidth = 6;
      g.beginPath(); g.roundRect(14, 14, 100, 100, 16); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('E', 64, 70);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.hatchSprites = this.hatches.map((h) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
        s.position.copy(h.pos).add(new THREE.Vector3(0, 0.55, 0)); s.renderOrder = 8; s.userData.h = h;
        this.it.group.add(s);
        return s;
      });
    }
    if (!this.hatchSprites) return;
    const t = performance.now() / 1000;
    for (const s of this.hatchSprites) {
      s.visible = !!this.hatches;
      s.scale.setScalar((this.hatch === s.userData.h ? 0.2 : 0.15) * (1 + 0.12 * Math.sin(t * 7)));
    }
  }

  /** Down through the hatch and forward under the flight deck to the nose (or back): the eye along the way. */
  startCrawl(p, o = {}) {
    const V = (q) => new THREE.Vector3(...q), st = p.station && this.it.stations.find((s) => s.id === p.station);
    const mid = [...(o.via ?? []).map(V), ...p.path.map(V)];
    let end;
    if (st) { // onto a position: on along its way in, ending at its eye (no standing up first)
      mid.push(...(st.entry?.path ?? []).map(V));
      end = st.eye.clone();
    } else { // onto your feet: as high as the room there lets you stand
      const room = this.it.headroom(p.to[0], p.to[2], p.to[1], R, STEP);
      end = V(p.to).setY(p.to[1] + clamp(room - 0.12, MIN_EYE, STAND_EYE));
      // a big rise at the end (out of the nose crawlway): most of it early, slowing as you straighten up
      const last = mid.at(-1);
      if (last && end.y - last.y > 0.3) mid.push(last.clone().lerp(end, 0.55).setY(last.y + (end.y - last.y) * 0.8));
    }
    const pts = [o.from ?? new THREE.Vector3(this.feet.x, this.camY, this.feet.z), ...mid, end];
    this.crawl = { p, t: 0, st, endY: end.y, curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), yaw0: o.yaw ?? this.yaw, pitch0: o.pitch ?? this.pitch };
    this.vel.set(0, 0, 0);
    this.onCrawl?.(p);
  }

  endCrawl() {
    const { p, st, endY } = this.crawl;
    this.crawl = null;
    this.feet.set(...p.to); this.safe.copy(this.feet); this.vy = 0;
    this.camY = endY; this.eye = endY - this.feet.y; // (on from the height the crawl left you at: no second rise)
    this.room = this.it.headroom(this.feet.x, this.feet.z, this.feet.y, R, STEP); // (here's: not where the crawl began)
    this.yaw = p.yaw; this.pitch = 0;
    if (st) { // and straight onto the gun you crawled back to: you're already at its eye
      this.near = st; this.passage = null; this.interact();
      this.gunEye = null; // (the last gun's eye, till the guns work out this one's: not a frame back at that one)
      this.blend = 1; this.lastStation = st;
    }
  }

  get location() { return this.station ? this.station.name : this.it.zoneAt(this.feet.z); }

  /** The controls while you fly (null when you're not at the controls). */
  get controls() {
    if (!this.station?.flies || this.blend < 0.5 || this.wounded || this.dead) return null;
    const k = this.keys;
    return { aimYaw: this.aimYaw, aimPitch: this.aimPitch, throttle: this.throttle, roll: (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) };
  }

  /** 1 - 5 in the nose: straight to that gun (left and right nose guns, left and right cheek guns) or the Norden. */
  noseSwitch(n) {
    const id = NOSE_KEYS[n - 1];
    if (this.station?.id === id || this.crawl || this.wounded || this.dead) return;
    if (id === 'bombsight') { this.useSight(); return; }
    const st = this.it.stations.find((s) => s.id === id);
    if (!st) return;
    if (this.station) this.interact(); // (off the one you're on)
    this.feet.copy(st.stand); this.passage = null;
    this.near = st;
    this.interact();
  }

  /** In the nose (the bomb bay's forward bulkhead on): the Norden is in reach. */
  get inNose() { return (this.station ? this.station.stand.z : this.feet.z) < -9.2 && !this.station?.flies; }

  /**
   * B in the nose: down onto the Norden bombsight (or back up from it). Only from the initial point on:
   * before that there's nothing to aim at (main sets sightOK on the bomb run).
   */
  useSight() {
    if (this.station?.sight) { this.interact(); return; }
    const sight = this.it.stations.find((s) => s.sight);
    if (!sight || !this.inNose) return;
    if (!this.sightOK) { this.onSightRefused?.(); return; } // (main: says when it'll be ready)
    if (this.station) this.interact(); // (off his gun first)
    this.near = sight;
    this.interact();
  }

  get prompt() {
    if (this.wounded || this.dead) return '';
    if (this.hatch) return `<b>E</b> or <b>click</b> Bail out through ${this.hatch.name}`;
    if (this.hatches && this.station?.flies) return '<span style="color:#ff8a70">Bail out! <b>E</b> out of the seat, then the red <b>E</b> at the crawlway down to the nose hatch, or the bomb bay</span>';
    if (this.hatches) return '<span style="color:#ff8a70">Bail out! Get to a hatch: the red <b>E</b></span>';
    if (this.firstAid) return this.firstAid;
    if (this.station?.flies) { // engine trouble: what you can do about the worst of it
      const t = this.bomber.engineTrouble;
      if (t) {
        const n = t.i + 1, b = this.bomber.bottles, acts = [];
        if (t.fire) acts.push(b > 0 ? `<b>T</b> Extinguish fire (engine ${n}) · ${b} bottle${b === 1 ? '' : 's'} left` : `Engine ${n} on fire · no bottles left`);
        if (t.feather) acts.push(`<b>F</b> Feather engine ${n}`);
        if (acts.length) return acts.join('&nbsp;&nbsp;&nbsp;');
      }
    }
    // in the nose, the bombardier's keys: his four guns and the sight
    const sight = !this.inNose ? '' : `&nbsp;&nbsp;&nbsp;<b>1</b><b>2</b><b>3</b><b>4</b> guns, left to right ${this.sightOK ? '<b>5</b> bombsight' : '<span class="dim"><b>5</b> bombsight from the initial point</span>'}`;
    if (this.crawl) return '';
    if (this.passage) return `<b>E</b> or <b>click</b> ${this.passage.name}`;
    // (taking a position: only its E, there over it; leaving: "E Leave" a moment, the first time at each)
    const leave = this.station && performance.now() < (this.leaveHintUntil ?? 0) ? `<b>E</b> Leave${this.station.sight ? ' (or <b>B</b>)' : ''}` : '';
    if (this.station) return (leave + sight).replace(/^(&nbsp;)+/, '');
    return this.inNose ? sight.replace(/^(&nbsp;)+/, '') : '';
  }

  edgeTurn(dt) {
    const c = this.cursor;
    if (!c || !this.freeLook || document.pointerLockElement) return;
    const push = (v) => (Math.abs(v) > EDGE ? Math.sign(v) * (Math.abs(v) - EDGE) / (1 - EDGE) : 0);
    this.look(-push(c.x) * 2.4 * dt, -push(c.y) * 1.6 * dt);
  }

  update(dt) {
    if (this.enabled) this.edgeTurn(dt);
    if (!this.keys.KeyC || !this.station) { // let go of C: the view eases back to the aim (~0.3 s)
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
    } else if (this.enabled && !this.station && !this.dead && !this.crawl) this.walk(dt);
    this.near = this.station || this.wounded || this.crawl ? null : this.it.nearestStation(this.feet);
    if (this.near?.id === 'tail' && this.bomber.noTail) this.near = null; // (the tail's gone: nothing back there to take)
    // the crawlway: its hatch (or its mouth in the nose) in reach, and nearer than any station
    this.passage = null;
    if (!this.station && !this.wounded && !this.dead && !this.crawl && !this.away) {
      for (const p of PASSAGES) {
        if (p.station === 'tail' && this.bomber.noTail) continue;
        const d = Math.hypot(this.feet.x - p.from[0], this.feet.z - p.from[1]);
        if (d < (p.reach ?? 0.38) && Math.abs(this.feet.y - p.floor) < 0.1 && (!this.near || d < this.near.stand.distanceTo(this.feet) || d < 0.3 || this.pitch < -0.35)) { this.passage = p; this.near = null; } // (over it, or looking down at it: the crawlway, not the seat beside it)
      }
    }
    // going down: the nearest lit hatch in reach
    this.hatch = null;
    if (this.hatches && !this.wounded && !this.dead) for (const h of this.hatches) if (Math.hypot(this.feet.x - h.pos.x, this.feet.z - h.pos.z) < 0.85 && Math.abs(this.feet.y - h.pos.y) < 0.8) this.hatch = h;
    this.hatchMarks();
    if (this.crawl && (this.crawl.t += dt / this.crawl.p.time) >= 1) this.endCrawl();
    this.passageMarks(); // (the E over each crawlway's opening)
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
    // things that turn with your aim: the ball and upper turrets you sit in
    const iron = this.blend > 0.6 && this.station?.attach ? this.it[this.station.attach] : null;
    if (iron !== this.ironOn) {
      if (this.ironOn) { this.camera.remove(this.ironOn); this.ironOn.position.copy(this.ironOn.userData.at); this.ironOn.quaternion.identity(); }
      if (iron) { this.camera.add(iron); iron.userData.at ??= iron.position.clone(); }
      this.ironOn = iron;
    }
    if (this.it.topDome) this.it.topDome.visible = iron !== this.it.topCockpit; // (in the turret, the dome is on your camera)
    this.drive(dt);
    this.pose(dt);
    // what rides on the guns (the turret you sit in) stays with them while your head
    // turns: it's held against the head's turn, about your eye
    if (this.ironOn) {
      _headInv.copy(_head.setFromEuler(_euler.set(this.station?.flies ? 0 : this.headPitch, this.station?.flies ? 0 : this.headYaw, 0, 'YXZ'))).invert();
      this.ironOn.quaternion.copy(_headInv);
      this.ironOn.position.copy(this.ironOn.userData.at).applyQuaternion(_headInv);
    }
    // the upper turret's dome turns with the guns but doesn't tilt when they elevate
    const level = this.ironOn?.userData.level;
    if (level) level.rotation.x = -this.sPitch;
    this.updateBody(dt);
  }

  updateBody(dt) {
    const b = this.body, j = b.userData.j, s = this.station;
    if (this.dead) { b.visible = false; return; }
    // crawling or climbing into a cramped position, the camera takes its own way: don't let it pass
    // through your own body on the way
    const entering = ((this.station ?? this.lastStation)?.entry && this.blend > 0.02 && this.blend < 0.92) || this.crawl;
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
      // looking round over your shoulder from the pilots' seats (C): your own shoulders and collar would fill the
      // view from inside, so you don't see yourself then
      if (s.flies && !this.third && Math.abs(this.headYaw) > 1.0) b.visible = false;
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
  eyeAt(s) {
    // in the ball your eye turns and tilts with it (your aim is its aim)
    if (s.eyeTurret && this.station === s) return turretPoint(s.pivot, s.yaw + this.sYaw, this.sPitch, s.eyeTurret, this.turretEye ??= new THREE.Vector3());
    return (s.eyeBehind || s.lean) && this.gunEye && this.station === s ? this.gunEye : s.eye;
  }

  pose(dt) {
    // smooth the camera height so steps and crouching don't snap
    const walkY = this.feet.y + this.eye;
    this.camY += (walkY - this.camY) * (1 - Math.exp(-dt * 8));
    // the eye never goes through the roof or into the curving wall, whatever the smoothing is doing
    if (this.room != null) this.camY = Math.min(this.camY, this.feet.y + this.room - 0.09);
    const wall = Math.max(0, this.it.hwSmooth(this.feet.z, this.camY) - 0.09);
    const walkPos = _walkPos.set(clamp(this.feet.x, -wall, wall), this.camY, this.feet.z);
    const walkRot = _walkRot.setFromEuler(_euler.set(this.pitch, this.yaw, 0, 'YXZ'));
    if (this.crawl) { // on hands and knees through the crawlway: the eye along its path, looking the way you go
      const c = this.crawl, k = easeEnds(clamp(c.t, 0, 1));
      c.curve.getPointAt(k, this.camera.position);
      // (hands and knees: the bob comes in once you're down and dies away before you arrive)
      this.camera.position.y += Math.sin(k * Math.PI * 10) * 0.02 * THREE.MathUtils.smoothstep(k, 0.05, 0.18) * (1 - THREE.MathUtils.smoothstep(k, 0.7, 0.85));
      const ahead = c.curve.getPointAt(Math.min(1, k + 0.08), _crawlAt).sub(this.camera.position);
      const look = Math.hypot(ahead.x, ahead.z) > 0.02 ? Math.atan2(-ahead.x, -ahead.z) : c.p.yaw;
      // (turning from where you looked to the way through, and at the end the way you come out facing)
      const w0 = THREE.MathUtils.smoothstep(k, 0, 0.18), w1 = THREE.MathUtils.smoothstep(k, 0.8, 1);
      const pitch = clamp(Math.atan2(ahead.y, Math.hypot(ahead.x, ahead.z)) * 0.6, -0.9, 0.6);
      _crawlQ.setFromEuler(_euler.set(pitch, look, 0, 'YXZ'));
      this.camera.quaternion.setFromEuler(_euler.set(c.pitch0, c.yaw0, 0, 'YXZ')).slerp(_crawlQ, w0).slerp(_walkRot.setFromEuler(_euler.set(0, c.p.yaw, 0, 'YXZ')), w1);
      return;
    }
    const t = THREE.MathUtils.smoothstep(this.blend, 0, 1);
    const s = this.station ?? this.lastStation;
    if (this.station) this.lastStation = this.station;
    if (!s || t === 0) {
      this.camera.position.copy(walkPos);
      this.camera.quaternion.copy(walkRot);
      return;
    }
    if (this.station?.finCut) { // (the radio gun: not down into the fin and tailplane, just astern)
      const [yh, pm] = this.station.finCut.map((v) => v * Math.PI / 180), k = 1 - Math.abs(this.sYaw) / yh;
      if (k > 0) this.sPitch = Math.max(this.sPitch, pm * Math.sqrt(k));
    }
    if (this.station?.roundArc) { // the waist windows: the corners of the gun's arc are cut off by the frame
      const pl = this.sPitch >= 0 ? s.pitch[1] : -s.pitch[0], e = Math.hypot(this.sYaw / s.yawLim, this.sPitch / pl);
      if (e > 1) { this.sYaw /= e; this.sPitch /= e; }
    }
    const yaw = this.station ? s.yaw + this.sYaw : this.yaw, pitch = this.station ? this.sPitch : this.pitch;
    const gunRot = _gunRot.setFromEuler(_euler.set(pitch, yaw, 0, 'YXZ'));
    if (this.station && !this.station.flies && (this.headYaw || this.headPitch)) gunRot.multiply(_head.setFromEuler(_euler.set(this.headPitch, this.headYaw, 0, 'YXZ'))); // (free look)
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
    if (this.third && this.station?.flies && t > 0.999) { // third person: out behind your bomber, looking where you fly (C still looks round her)
      this.camera.quaternion.copy(gunRot);
      this.camera.position.set(0, 0.5, -1).add(_third.set(0, THIRD_UP, THIRD_BACK).applyQuaternion(gunRot));
      return;
    }
    // recoil shake: small random jolts that die away quickly
    if (this.shake > 0.01) { // a flak burst close by: a hard jolt that dies away
      const r = this.shake * 0.03;
      this.camera.rotateX((Math.random() - 0.5) * r); this.camera.rotateZ((Math.random() - 0.5) * r * 0.6);
      this.camera.translateY((Math.random() - 0.5) * r * 1.5);
      this.shake *= Math.exp(-dt * 9);
    }
    this.recoil *= Math.exp(-dt * 14);
    if (this.recoil > 0.01) {
      const r = this.recoil * 0.0012;
      this.camera.rotateX((Math.random() - 0.3) * r);
      this.camera.rotateY((Math.random() - 0.5) * r);
      this.camera.translateZ(Math.random() * r * 6);
    }
  }
}
