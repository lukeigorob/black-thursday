// Fighters on both sides.
//  Bf 109 raiders make attack passes on the bombers (head-on, high side, from behind, from the beam).
//  Bf 109 hunters go after the escorts. P-51 escorts patrol round the formation and engage any
//  109 that comes near. Anyone with an enemy on their tail breaks hard to shake it off.
// All of them fly the same simple model: coordinated banking turns, cowl/wing guns, part damage,
// and going down in flames. Positions are in the formation's frame: the air streams past at
// AIRSPEED, so a fighter's motion = its airspeed vector + the wind (head-on passes close fast).
import * as THREE from 'three';
import { AIRSPEED, PARTS as BOMBER_PARTS } from './bomber.js';
import { loadModel } from './models.js';
import { FarFighters } from './farfighters.js';
import { BATTLE } from './battle.js';

const V = THREE.Vector3;
const WIND = new V(0, 0, AIRSPEED);
const UP = new V(0, 1, 0), X_AXIS = new V(1, 0, 0);
const FIRE_RANGE = 650, BREAK_RANGE = 170, DOGFIGHT_RANGE = 450;
const SPREAD = 0.015; // rad
const WOBBLE = 0.014, PASS_WOBBLE = 0.026; // rad: a pilot can't hold his sight dead on a target while he flies
// (diving through the bombers' return fire at a closing speed of 200 m/s, he holds it even worse)
const F_BURST = [0.6, 1.4], F_PAUSE = [0.5, 1.6]; // s: fighters fire in bursts too
// the Luftwaffe outnumbers the escorts several times over
const AXIS_ACTIVE = BATTLE.axisActive, ALLIED_ACTIVE = BATTLE.alliedActive, HUNTER_SHARE = 0.2; // a fifth of each gaggle goes for the escorts
const GAGGLE = BATTLE.gaggle, FIRST_WAVE = 8, WAVE_GAP = [5, 10], ESCORT_RESPAWN = [18, 30]; // fighters, s
const FREE = -1; // an axis slot waiting for the next gaggle
// each side's strength for the whole mission: when the reserves are gone, no more come up
export const AXIS_TOTAL = BATTLE.axisTotal, ALLIED_TOTAL = BATTLE.alliedTotal; // (from the battle size)
const CELL = 100, CELL_PAD = 65; // m: bombers are filed in a grid so a round only tests the ones near it
const FCELL = 100, FCELL_PAD = 60; // m: fighters are filed too (a frame's flight of a round plus a wingspan)
const RAM = 6; // m between two fighters' centres: closer than that their wings or props meet
const RAM_PAD = 2.5; // m added round a B-17's hit boxes for a fighter's size
const AI_RAM_CHANCE = 0.06, AI_MIDAIR_CHANCE = 0.3; // AI pilots mostly just miss (rolled once per close pass)
const BOMBER_RAM = 11; // m between two B-17s' centres: a crippled or falling one drifting into another (their bodies, not their spans)
const CONTACT_NEAR = 35; // m between centres: closer than this, your B-17's shape is tested against hers
const BRUSH = 5, SMASH = 14, WING_OFF = 9; // how hard (m/s closing + 6 x depth in m): a brush below BRUSH, a big hit above SMASH; wings off above WING_OFF

// the shapes that can touch (wings, tailplane, fuselage) and points spread through each, in bomber space
const SOLID = BOMBER_PARTS.filter((p) => p.kind === 'wing' || p.kind === 'tail' || p.kind === 'section');
const SAMPLES = SOLID.map((p) => {
  const pts = [], n = (a, b, step) => Math.max(2, Math.ceil((b - a) / step) + 1);
  for (const [x0, x1, y0, y1, z0, z1] of p.boxes) {
    const nx = n(x0, x1, 1.4), ny = n(y0, y1, 1.6), nz = n(z0, z1, 1.4);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) pts.push(new THREE.Vector3(x0 + (x1 - x0) * i / (nx - 1), y0 + (y1 - y0) * j / (ny - 1), z0 + (z1 - z0) * k / (nz - 1)));
  }
  return { part: p, pts };
});
const _cv = new THREE.Vector3(), _cw = new THREE.Vector3(), _cn = new THREE.Vector3(), _cp = new THREE.Vector3(), _cs = new THREE.Vector3(), _cm = new THREE.Matrix4();
/**
 * Does any of b's shape reach into a's? Points through b's wings, tailplane and fuselage, taken into a's
 * frame and tested against a's. The deepest: { a: a's part, b: b's part, depth, at (world), la, lb (local) }
 * (swap: the parts given the other way round, so `a` is always the first bomber's).
 */
function contact(a, b, swap = false) {
  _cm.multiplyMatrices(a._inv, b.group.matrix); // b's space into a's
  let best = null;
  for (const { part: pbp, pts } of SAMPLES) {
    if (b.lost[pbp.name]) continue;
    for (const p of pts) {
      const l = _cs.copy(p).applyMatrix4(_cm);
      for (const pa of SOLID) {
        if (a.lost[pa.name]) continue;
        for (const q of pa.boxes) {
          if (l.x <= q[0] || l.x >= q[1] || l.y <= q[2] || l.y >= q[3] || l.z <= q[4] || l.z >= q[5]) continue;
          const depth = Math.min(l.x - q[0], q[1] - l.x, l.y - q[2], q[3] - l.y, l.z - q[4], q[5] - l.z);
          if (!best || depth > best.depth) best = { pa, pb: pbp, depth, la: l.clone(), lb: p.clone() };
        }
      }
    }
  }
  if (!best) return null;
  const at = best.la.clone().applyMatrix4(a.group.matrix);
  return swap ? { a: best.pb, b: best.pa, depth: best.depth, at, la: best.lb, lb: best.la } : { a: best.pa, b: best.pb, depth: best.depth, at, la: best.la, lb: best.lb };
}
let nextId = 1;
const SPREAD_CHECKS = 3; // the pairwise checks (on my tail? who to chase?) run every 3rd frame per fighter

const KINDS = {
  bf109: {
    // m/s through the air: cruise ~410 km/h, flat out ~600 km/h at 25,000 ft; turn rates in rad/s (sustained,
    // in a fight, and a hard break)
    side: 'axis', name: 'Bf 109', roll: 2.8, pitchRate: 1.15, yawRate: 0.35, cruise: 114, setup: 155, attack: 150, max: 167, turn: 0.32, combat: 0.5, breakTurn: 0.62, muzzle: 780,
    // hit boxes in the fighter's own space (nose -Z, prop axis at y = 0), measured from the model
    parts: {
      pilot: { box: [-0.33, 0.33, 0.05, 0.8, -1.5, -0.3], hp: 2 },
      engine: { box: [-0.42, 0.42, -0.55, 0.45, -4.1, -2.3], hp: 14 },
      fuel: { box: [-0.4, 0.4, -0.5, 0.05, -0.6, 0.6], hp: 6 },
      tail: { box: [-1.7, 1.7, -0.2, 1.55, 3.3, 4.5], hp: 10 },
      wingL: { box: [-5.2, -0.4, -0.35, 0.25, -2.4, 0.0], hp: 16 },
      wingR: { box: [0.4, 5.2, -0.35, 0.25, -2.4, 0.0], hp: 16 },
      fuselage: { box: [-0.42, 0.42, -0.53, 0.6, -2.3, 3.3], hp: 30 },
    },
    guns: [ // two MG 17s on the cowl, an MG 151/20 cannon through the spinner
      { at: [-0.2, 0.35, -3.1], rpm: 1100, tracer: 3 }, { at: [0.2, 0.35, -3.1], rpm: 1100, tracer: 3 },
      { at: [0, 0, -4.5], rpm: 700, tracer: 2, cannon: true },
    ],
    smokeAt: [0, -0.3, -3], fireAt: [0, 0, -1.5],
  },
  fw190: {
    // the Fw 190 A-8: heavier, armoured, a little faster than the 109 but not so good a climber up here;
    // the Sturmgruppen took the bombers head-on in tight groups
    side: 'axis', name: 'Fw 190', roll: 3.8, pitchRate: 1.05, yawRate: 0.33, cruise: 118, setup: 158, attack: 155, max: 180, turn: 0.3, combat: 0.47, breakTurn: 0.58, muzzle: 800,
    parts: {
      pilot: { box: [-0.34, 0.34, 0.1, 0.9, -1.0, 0.4], hp: 4 }, // (armoured glass and plate)
      engine: { box: [-0.62, 0.62, -0.62, 0.62, -4.0, -2.3], hp: 20 }, // the radial takes a lot of hits
      fuel: { box: [-0.42, 0.42, -0.55, 0.1, -1.6, -0.2], hp: 8 },
      tail: { box: [-1.8, 1.8, -0.1, 1.3, 3.3, 4.55], hp: 12 },
      wingL: { box: [-5.3, -0.45, -0.6, 0.0, -1.8, 0.45], hp: 20 },
      wingR: { box: [0.45, 5.3, -0.6, 0.0, -1.8, 0.45], hp: 20 },
      fuselage: { box: [-0.5, 0.5, -0.62, 0.7, -2.3, 3.3], hp: 38 },
    },
    guns: [ // two MG 131s over the engine, four MG 151/20 cannon in the wings
      { at: [-0.17, 0.62, -3.0], rpm: 900, tracer: 3 }, { at: [0.17, 0.62, -3.0], rpm: 900, tracer: 3 },
      { at: [-0.95, -0.46, -2.3], rpm: 720, tracer: 2, cannon: true }, { at: [0.95, -0.46, -2.3], rpm: 720, tracer: 2, cannon: true },
      { at: [-2.05, -0.38, -1.8], rpm: 700, tracer: 2, cannon: true }, { at: [2.05, -0.38, -1.8], rpm: 700, tracer: 2, cannon: true },
    ],
    smokeAt: [0, -0.3, -3], fireAt: [0, 0, -1.5],
  },
  p51: {
    // cruise ~430 km/h, flat out ~700 km/h: faster than the 109 up here, turns about as well
    side: 'allied', name: 'P-51', roll: 3.1, pitchRate: 1.2, yawRate: 0.36, cruise: 120, setup: 175, attack: 170, max: 194, turn: 0.31, combat: 0.5, breakTurn: 0.6, muzzle: 880,
    parts: {
      pilot: { box: [-0.35, 0.35, 0.05, 0.75, -0.9, 0.5], hp: 2 },
      engine: { box: [-0.42, 0.42, -0.85, 0.6, -4.6, -2.4], hp: 14 },
      fuel: { box: [-0.4, 0.4, -0.6, 0.05, 0.5, 1.4], hp: 6 },
      tail: { box: [-1.8, 1.8, -0.35, 1.6, 3.6, 4.92], hp: 10 },
      wingL: { box: [-5.6, -0.45, -0.85, -0.2, -2.2, 0.6], hp: 16 },
      wingR: { box: [0.45, 5.6, -0.85, -0.2, -2.2, 0.6], hp: 16 },
      fuselage: { box: [-0.45, 0.45, -1.2, 0.6, -2.4, 3.7], hp: 30 },
    },
    guns: [1.7, 2.0, 2.3].flatMap((x) => [-x, x]).map((x) => ({ at: [x, -0.64, -2.1], rpm: 800, tracer: 5 })), // six .50s in the wings
    smokeAt: [0, -0.4, -3.4], fireAt: [0, -0.3, -1],
  },
};
const ATTACKS = [['headOn', 3], ['high', 3], ['tail', 2], ['beam', 2]];
const FW_TOTAL = 50; // Fw 190s among the Luftwaffe's reserve: they come up as whole gaggles of their own
const FW_ATTACKS = [['headOn', 6], ['high', 2], ['tail', 1]]; // and mostly take the bombers head-on

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => { let r = Math.random() * list.reduce((s, [, w]) => s + w, 0); return list.find(([, w]) => (r -= w) < 0)[0]; };

/** Where a segment a->b first enters box [x0,x1,y0,y1,z0,z1] (0..1), or -1. */
function segBox(a, b, box) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const o = a.getComponent(k), d = b.getComponent(k) - o, lo = box[k * 2], hi = box[k * 2 + 1];
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
    let u = (lo - o) / d, w = (hi - o) / d;
    if (u > w) [u, w] = [w, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, w);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Shortest distance from point p to segment a-b, and the closest point. */
function segPoint(a, b, p, out) {
  const ab = _ab.subVectors(b, a), t = THREE.MathUtils.clamp(_ap.subVectors(p, a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
  out.copy(a).addScaledVector(ab, t);
  return out.distanceTo(p);
}

const _near = new V(), _ab = new V(), _ap = new V(), _la = new V(), _lb = new V(), _t = new V(), _t2 = new V();
const _want = new V(), _old = new V(), _axis = new V(), _lift = new V(), _x = new V(), _y = new V(), _z = new V(), _up = new V();
const cellKey = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);

// Grid cells are reused frame to frame. Only the cells used last frame are emptied (aircraft fly through
// thousands of cells over a mission: clearing them all each frame grew to 10 ms), and when the map
// has collected many stale cells it is dropped and rebuilt.
function resetGrid(grid, keys) {
  if (grid.size > keys.length * 4 + 256) grid.clear();
  else for (const k of keys) { const l = grid.get(k); if (l) l.length = 0; }
  keys.length = 0;
}
function fileIn(grid, keys, key, item) {
  let list = grid.get(key);
  if (!list) grid.set(key, (list = []));
  if (list.length === 0) keys.push(key);
  list.push(item);
}

/**
 * How badly a fighter is hurt short of going down (a crit is a step up): engine smoking, a wing or the
 * tail nearly shot through, the fuel tank holed. (Fire, a dead engine or a lost wing bring it down.)
 */
function critLevel(f) {
  const p = f.parts, k = f.k.parts;
  return Number(f.smoking) + Number(p.wingL < k.wingL.hp * 0.4) + Number(p.wingR < k.wingR.hp * 0.4) + Number(p.tail < k.tail.hp * 0.4) + Number(p.fuel < k.fuel.hp * 0.5);
}

function clock(bomber, p) {
  const d = bomber.group.worldToLocal(p.clone());
  let h = Math.round((Math.atan2(-d.x, -d.z) * -6) / Math.PI); // 12 = dead ahead, 3 = right
  h = ((h % 12) + 12) % 12 || 12;
  return { h, level: d.y > 150 ? 'high' : d.y < -150 ? 'low' : 'level' };
}

const _lvl = new V(), _flyU = new V(), _flyR = new V(), BANK_MAX = THREE.MathUtils.degToRad(70); // (the player's fighter: its steepest bank in a turn)

class Fighter {
  constructor(kind, obj, full, pos, dir) {
    this.kind = kind;
    this.k = KINDS[kind];
    this.side = this.k.side;
    this.obj = obj; // THREE.LOD (full model up close, low-detail far away)
    this.pos = pos.clone();
    this.dir = dir.clone().normalize(); // where the nose points (air-relative heading)
    this.speed = this.k.cruise;
    this.up = UP.clone();
    this.roll = 0;
    this.state = 'approach';
    this.timer = 0;
    this.parts = Object.fromEntries(Object.entries(this.k.parts).map(([n, p]) => [n, p.hp]));
    this.smoking = false; this.burning = false; this.engineDead = false; this.pilotDead = false;
    this.spin = 0;
    this.gunTimers = this.k.guns.map(() => Math.random() * 0.1);
    this.rounds = 0;
    this.disc = full.getObjectByName('Fake_Blades');
    this.blades = full.getObjectByName('BF109_F2_Blades') ?? full.getObjectByName('Fw190_Blades');
    this.spinner = kind === 'p51' ? full.getObjectByName('Nose') : null;
    this.inv = new THREE.Matrix4();
    this._vel = new V();
    this.id = nextId++;
  }

  get alive() { return this.state !== 'down' && this.state !== 'gone'; }
  /** Motion in the formation's frame: airspeed along the nose plus the wind. (A shared vector: copy it to keep it.) */
  get velocity() { return this._vel.copy(this.dir).multiplyScalar(this.speed).add(WIND); }

  /**
   * Turn the nose towards `want` at up to `rate` rad/s; the wings bank into the turn. push: when the turn
   * is nose-down, push over (the wings stay put) rather than roll inverted to pull through (the player's).
   */
  steer(want, rate, dt, push = false) {
    if (!(dt > 0) || want.lengthSq() < 1e-9) return;
    want = _want.copy(want).normalize();
    if (push) return this.fly(want, rate, dt);
    const old = _old.copy(this.dir);
    const angle = old.angleTo(want);
    if (angle > 1e-4) {
      const axis = _axis.crossVectors(old, want);
      // turning exactly round: any axis at right angles to the nose will do (pull "up" if we can)
      if (axis.lengthSq() < 1e-10) axis.crossVectors(old, Math.abs(old.y) < 0.9 ? UP : X_AXIS);
      this.dir.applyAxisAngle(axis.normalize(), Math.min(angle, rate * dt)).normalize();
    }
    // coordinated turn: the lift (the plane's "up") points along gravity-cancelling + turning force
    const lift = _lift.copy(this.dir).sub(old).multiplyScalar(this.speed / dt);
    lift.y += 9.81;
    lift.addScaledVector(this.dir, -lift.dot(this.dir));
    // straight up or down there is no "up" from gravity: keep the wings where they were
    if (lift.lengthSq() > 1e-6) {
      lift.normalize();
      // (pushing the nose down harder than gravity pulls it: negative g, the wings stay where they are.
      // Turned towards that downward pull instead, the wings would roll a little more every frame: a spin)
      if (push && lift.dot(this.up) < 0) lift.copy(this.up);
      if (push) { // (yours: banked no further than 60 degrees into a turn, and eased into it: a bank, not a roll)
        const level = _lvl.copy(UP).addScaledVector(this.dir, -this.dir.y);
        if (level.lengthSq() > 0.04) {
          level.normalize();
          const a = Math.acos(THREE.MathUtils.clamp(lift.dot(level), -1, 1));
          if (a > BANK_MAX) lift.lerp(level, 1 - BANK_MAX / a).normalize();
        }
      }
      this.up.lerp(lift, 1 - Math.exp(-dt * (push ? 2.2 : 4))).normalize();
    }
  }

  /**
   * Yours, flown as the mouse-aim games fly it (War Thunder's "instructor", the MouseFlight scheme): the
   * aim is a point the plane chases and catches. Elevator, rudder and ailerons all at once, each rate in
   * proportion to how far the aim is off in its own axis (quick, and no crawl over the last degrees): the
   * nose pulled round to it, a little rudder for the fine part, and the roll blended from "wings level"
   * when the aim's near the nose to "the aim over your head" when it's well off, so a turn is always a bank
   * INTO it, banked as far as it needs. Behind or straight up: full rate, the shortest way round.
   */
  fly(want, rate, dt) {
    const k = this.k, fwd = this.dir, up = _flyU.copy(this.up).addScaledVector(fwd, -this.up.dot(fwd)).normalize();
    const right = _flyR.crossVectors(fwd, up).normalize();
    const ax = want.dot(right), ay = want.dot(up), az = want.dot(fwd), off = Math.acos(THREE.MathUtils.clamp(az, -1, 1));
    const pitchRate = k.pitchRate ?? 1.1, yawRate = k.yawRate ?? 0.35, rr = k.roll ?? 3;
    // the roll: wings level near the nose, the aim overhead once it's more than ~10 degrees off
    const level = _lvl.copy(UP).addScaledVector(fwd, -fwd.y), hasLevel = level.lengthSq() > 0.04;
    if (hasLevel) level.normalize();
    const bank = hasLevel ? Math.atan2(-level.dot(right), level.dot(up)) : 0; // + = right wing down
    const toAim = Math.atan2(ax, ay), wings = THREE.MathUtils.smoothstep(off, 0.03, 0.18);
    const rollErr = THREE.MathUtils.lerp(-bank, toAim, wings);
    const roll = THREE.MathUtils.clamp(rollErr * 5, -rr, rr) * dt;
    up.applyAxisAngle(fwd, roll); // (+: roll right, the right wing down)
    right.crossVectors(fwd, up).normalize();
    // the elevator and the rudder: rates in proportion to the error, up to the type's (pushing: less)
    const pitchErr = Math.atan2(want.dot(up), want.dot(fwd)), yawErr = Math.atan2(want.dot(right), want.dot(fwd));
    const pitch = THREE.MathUtils.clamp(pitchErr * 6, -pitchRate * 0.5, pitchRate) * dt;
    const yaw = THREE.MathUtils.clamp(yawErr * 6, -yawRate, yawRate) * dt;
    fwd.applyAxisAngle(right, pitch); up.applyAxisAngle(right, pitch);
    fwd.applyAxisAngle(up, -yaw);
    fwd.normalize();
    this.up.copy(up).addScaledVector(fwd, -up.dot(fwd)).normalize();
    void rate;
  }

  pose() {
    const z = _z.copy(this.dir).negate(); // the models' noses are -Z
    const up = _up.copy(this.up).addScaledVector(this.dir, -this.up.dot(this.dir));
    if (up.lengthSq() < 1e-8) up.copy(X_AXIS).addScaledVector(this.dir, -this.dir.x); // nose along "up"
    up.normalize();
    this.up.copy(up);
    if (this.roll) up.applyAxisAngle(this.dir, this.roll);
    const x = _x.crossVectors(up, z).normalize();
    const y = _y.crossVectors(z, x);
    this.obj.matrix.makeBasis(x, y, z).setPosition(this.pos);
    // the obj sits in the scene root, so its world matrix is its matrix. The renderer updates the parts
    // inside it (and only for the fighters near enough to be drawn with their full model).
    this.obj.matrixWorld.copy(this.obj.matrix);
    this.obj.matrixWorldNeedsUpdate = true;
    this.inv.copy(this.obj.matrixWorld).invert();
  }
}

export class Fighters {
  constructor(scene, { effects, bullets, audio, ui, bombers, playerBomber }) {
    Object.assign(this, { scene, effects, bullets, audio, ui, bombers, playerBomber });
    this.list = [];
    this.far = new FarFighters(scene);
    this.axis = []; this.allied = []; this.chased = new Set(); this.frame = 0;
    // a slot per fighter in the air; 0 = flying, > 0 = seconds until a replacement arrives
    this.axisSlots = Array.from({ length: AXIS_ACTIVE }, () => FREE);
    this.waveT = FIRST_WAVE;
    this.alliedSlots = Array.from({ length: ALLIED_ACTIVE }, (_, i) => 0.2 + i * 0.1);
    this.kills = 0;
    this.lastCall = -99;
    this.lastFriendsCall = -99;
    this.time = 0;
    this.crewView = true; // you're in a B-17 (crew callouts); false while you fly a fighter
    this.report = null; // (kind, name, dmg) -> your score: 'hit' | 'crit' | 'kill' | 'assist'
    this.reserve = { axis: AXIS_TOTAL, allied: ALLIED_TOTAL }; // still to come up (the player's own fighter doesn't count)
    this.fwLeft = FW_TOTAL; // of the axis reserve, how many are Fw 190s
    this.playerSide = 'allied';
  }

  /** Where the action is: the player's bomber (it can change place in the stream). */
  get center() { return this.playerBomber.group.position; }

  /** Bombers close enough to the player that a fight there is worth seeing (refreshed every few s). */
  nearBombers() {
    if (!this.near || this.time - this.nearAt > 5) {
      this.nearAt = this.time;
      this.near = this.bombers.filter((b) => !b.down && b.base.distanceTo(this.playerBomber.base) < 1300);
    }
    return this.near;
  }

  async spawn(kind, slot, plan = null, idx = 0, count = 1) {
    const [{ scene: full }] = await Promise.all([loadModel(kind), this.far.load(kind)]);
    full.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const obj = new THREE.Group(); // its full model; far away it's drawn as an instance instead (FarFighters)
    obj.add(full);
    obj.matrixAutoUpdate = false;
    let f;
    const c = this.center;
    if (kind === 'p51') { // escorts are already on station round the formation when they arrive
      const a = rand(0, Math.PI * 2), r = rand(700, 1300);
      const pos = new V(Math.cos(a) * r, rand(350, 800), Math.sin(a) * r).add(c);
      f = new Fighter(kind, obj, full, pos, new V(-Math.sin(a), 0, Math.cos(a)));
      f.station = { a, r, h: pos.y - c.y, rate: rand(0.04, 0.07) * (Math.random() < 0.5 ? -1 : 1) }; // slow enough to hold at cruise
      f.state = 'patrol';
    } else { // 109s come in as a gaggle from ahead or the side, 4 km out, above: loose lines abreast
      const from = plan ? plan.from : new V(rand(-3000, 3000), rand(300, 900), -4000).add(c);
      const toward = _t.copy(c).sub(from).setY(0).normalize(), side = _t2.crossVectors(toward, UP).normalize();
      const row = Math.floor(idx / 5), col = (idx % 5) - 2;
      const pos = from.clone().addScaledVector(side, col * 60 + rand(-10, 10)).addScaledVector(toward, -row * 70).add(new V(0, rand(-30, 30) + row * 25, 0));
      f = new Fighter(kind, obj, full, pos, toward);
      f.plan = plan;
      f.role = idx < Math.round(count * HUNTER_SHARE) ? 'hunter' : 'raider';
      if (f.role === 'raider') this.newAttack(f); else f.state = 'hunt';
    }
    f.slot = slot;
    this.list.push(f); // (FarFighters puts it in the scene when it's near)
    return f;
  }

  /** A fighter for the player: a P-51 joins the escort round the bombers; a 109 starts out a few km off. */
  async spawnPlayer(kind) {
    const f = await this.spawn(kind, -1);
    f.prey = null; f.target = null;
    return f;
  }

  /**
   * A bomber out of the box draws them: fighters near her peel off from whatever they were setting up and
   * come at her (from astern and below), several at once and again and again, until she's back in the box
   * or going down. Now and then a P-51 or two breaks off to help her.
   */
  pounce() {
    for (const b of this.nearBombers()) {
      if (!b.straggling) continue;
      const at = b.group.position;
      let on = 0;
      for (const f of this.axis) if (f.target === b && !f.player) on++;
      const want = b === this.playerBomber ? 6 : 3; // (yours, alone, draws them most: the fight's round you)
      if (on < want) {
        const free = this.axis.filter((f) => !f.player && f.target !== b && (f.state === 'extend' || f.state === 'approach' || f.state === 'hunt') && f.pos.distanceTo(at) < 3500)
          .sort((p, q) => p.pos.distanceToSquared(at) - q.pos.distanceToSquared(at));
        for (const f of free.slice(0, want - on)) { f.role = 'raider'; f.plan = null; this.newAttack(f, b); }
      }
      if (on && Math.random() < 0.35) { // the escort sees it
        const attacker = this.axis.find((f) => f.target === b && !this.chased.has(f));
        const esc = attacker && this.allied.filter((f) => !f.player && f.state === 'patrol').sort((p, q) => p.pos.distanceToSquared(at) - q.pos.distanceToSquared(at))[0];
        if (esc && esc.pos.distanceTo(at) < 4000) { esc.prey = attacker; esc.state = 'engage'; esc.timer = 25; this.chased.add(attacker); }
      }
    }
  }

  newAttack(f, onto = null) {
    if ((this.suppressed || this.leaving) && !onto && Math.random() < 0.85) { // (their own flak up: most stand off and wait; a few brave it) // their own flak is up: most stand off and wait
      f.state = 'extend';
      f.timer = rand(6, 10);
      return;
    }
    // fighters went for stragglers (engines out, falling behind) first, then the bombers round the player
    const near = this.nearBombers().filter((b) => !b.down);
    const plan = f.plan;
    f.plan = null; // the gaggle attacks together once; after that each one picks his own
    const group = plan?.squad ? near.filter((b) => b.squad === plan.squad) : [];
    // a bomber out of the box first, almost always (alone, without the box's guns round her: easy meat);
    // then a crippled one; then any in the box
    const out = near.filter((b) => b.straggling), crippled = near.filter((b) => b.deadEngines > 0);
    const r = Math.random();
    // (no extra share for the bomber you're in while she keeps her place: it takes its chances like any
    // other in the box. The fight is only ever round you, so an extra share made yours far likelier to go down)
    f.target = onto ?? (out.length && r < 0.85 ? out[Math.floor(Math.random() * out.length)]
      : group.length ? group[Math.floor(Math.random() * group.length)]
        : crippled.length && r < 0.6 ? crippled[Math.floor(Math.random() * crippled.length)]
          : near[Math.floor(Math.random() * near.length)] ?? this.playerBomber);
    // a straggler: from astern and from below, pressed in close
    f.attack = f.target.straggling && !plan ? (Math.random() < 0.6 ? 'tail' : 'low') : plan?.attack ?? pick(ATTACKS);
    f.side3 = plan?.side3 ?? (Math.random() < 0.5 ? -1 : 1);
    const o = { headOn: [rand(-200, 200), rand(250, 550), -2600], high: [f.side3 * rand(500, 900), rand(800, 1100), rand(-900, -300)],
      tail: [rand(-300, 300), rand(60, 300), 1900], beam: [f.side3 * 1600, rand(-50, 250), rand(-300, 200)],
      low: [rand(-250, 250), rand(-480, -260), rand(1000, 1600)] }[f.attack];
    f.setup = new V(...o);
    f.aimOffset = new V(rand(-2, 2), rand(-1, 1), rand(-8, 8)); // somewhere on the airframe
    f.state = 'approach';
  }

  update(dt, player) {
    this.time += dt;
    this.frame++;
    this.fileBombers();
    // who's flying on each side, and who's already being chased (instead of searching per fighter)
    this.axis.length = 0; this.allied.length = 0; this.chased.clear();
    for (const g of this.list) {
      if (g.alive) (g.side === 'axis' ? this.axis : this.allied).push(g);
      if (g.prey) this.chased.add(g.prey);
    }
    this.tickWaves(dt);
    this.tickSlots(this.alliedSlots, 'p51', dt);
    if ((this.pounceT = (this.pounceT ?? 0) - dt) <= 0) { this.pounceT = 1.5; this.pounce(); }
    let nearest = Infinity, closing = 0;
    const cam = player.camera.getWorldPosition(_t2);
    for (const f of this.list) {
      if (f.player && f.alive) this.pilot?.fly(f, dt); // the player's own fighter
      else if (f.alive) {
        const check = (this.frame + f.slot) % SPREAD_CHECKS === 0;
        if (check && f.state !== 'evade' && f.state !== 'break' && this.threatened(f)) { f.resume = f.state; this.startEvade(f); }
        if (this.leaving && f.side === 'axis' && f.state !== 'attack' && f.state !== 'rtb' && f.state !== 'evade') f.state = 'rtb';
        // fuel: a German fighter has so long over the bombers, then heads home (and the next comes up in his place)
        if (f.side === 'axis' && (f.fuel = (f.fuel ?? rand(140, 230)) - dt) <= 0 && f.state !== 'attack' && f.state !== 'rtb') f.state = 'rtb';
        f.checkNow = check;
        this.fly(f, dt);
      } else this.fall(f, dt);
      if (f.state === 'gone') continue;
      f.pos.addScaledVector(f.velocity, dt);
      if (!Number.isFinite(f.pos.x + f.pos.y + f.pos.z + f.dir.x + f.dir.y + f.dir.z)) { f.state = 'gone'; continue; } // never let a bad number spread
      f.pose();
      this.spinProp(f, dt);
      this.damageTrails(f, dt);
      if (f.player) continue; // (its engine is heard as your own)
      const d = f.pos.distanceTo(cam);
      if (d < nearest) { nearest = d; closing = -f.velocity.dot(_t.copy(f.pos).sub(cam).normalize()); }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      if (f.state !== 'gone') continue;
      if (f.obj.parent) this.scene.remove(f.obj);
      this.list.splice(i, 1);
      if (f.player) continue; // the player's fighter has no slot
      if (f.side === 'axis') this.freeAxisSlot(f.slot); else this.alliedSlots[f.slot] = rand(...ESCORT_RESPAWN);
    }
    this.far.update(this.list, cam);
    this.fileFighters();
    this.collisions(dt);
    this.audio.fighterDrone(nearest, closing);
  }

  freeAxisSlot(slot) { this.axisSlots[slot] = FREE; }

  /** Out of the flak belt: a fresh attack, gaggle after gaggle, fully armed. */
  surge() { this.surgeT = 45; this.waveT = 0; }

  /** Each side's strength: in the air, shot down, still to come. */
  counts() {
    const t = this.tally ?? {}, c = { axis: { air: 0 }, allied: { air: 0 } };
    c.axis.fw = 0;
    for (const f of this.list) if (f.alive && !f.player) { c[f.side].air++; if (f.kind === 'fw190') c.axis.fw++; }
    c.axis.down = t.axisLost ?? 0; c.allied.down = t.alliedLost ?? 0;
    c.axis.reserve = this.reserve.axis; c.allied.reserve = this.reserve.allied;
    c.axis.total = AXIS_TOTAL; c.allied.total = ALLIED_TOTAL;
    return c;
  }

  /** Bf 109s arrive in gaggles: when enough are missing, a whole group comes in together from one direction. */
  tickWaves(dt) {
    if (this.noWaves) return; // (the end of the day: no more coming up)
    this.surgeT = Math.max(0, (this.surgeT ?? 0) - dt);
    if ((this.waveT -= dt) > 0) return;
    if (this.suppressed && Math.random() < 0.8) { this.waveT = rand(...WAVE_GAP); return; } // (over the flak belt, only the odd gaggle)
    const free = [];
    for (let i = 0; i < this.axisSlots.length; i++) if (this.axisSlots[i] === FREE) free.push(i);
    if (free.length < GAGGLE[0]) { this.waveT = 2; return; }
    const n = Math.min(free.length, Math.round(rand(...GAGGLE)), this.reserve.axis);
    if (n <= 0) { this.waveT = 5; return; } // the Luftwaffe has nothing left to send
    const c = this.center, a = rand(-2.2, 2.2), dist = rand(3600, 4600);
    const near = this.nearBombers();
    const pickOne = near[Math.floor(Math.random() * near.length)];
    // a gaggle of Fw 190s now and then (in proportion to how many are left), the rest Bf 109s
    const fw = this.fwLeft > 0 && Math.random() < this.fwLeft / Math.max(1, this.reserve.axis);
    const kind = fw ? 'fw190' : 'bf109', count = fw ? Math.min(n, this.fwLeft) : n;
    const plan = { // they come in together and pick on one group of bombers
      from: new V(Math.sin(a) * dist, rand(300, 1000), -Math.cos(a) * dist).add(c),
      attack: pick(fw ? FW_ATTACKS : ATTACKS), side3: Math.random() < 0.5 ? -1 : 1, squad: pickOne?.squad,
    };
    this.reserve.axis -= count;
    if (fw) this.fwLeft -= count;
    for (let i = 0; i < count; i++) { this.axisSlots[free[i]] = 0; this.spawn(kind, free[i], plan, i, count); }
    this.waveT = this.surgeT > 0 ? rand(1.5, 3.5) : rand(...WAVE_GAP);
    if (this.crewView && this.time > 20) this.ui.log(`Large formation of ${fw ? 'Fw 190s' : 'fighters'} coming in! ${count} of them.`);
  }

  tickSlots(slots, kind, dt) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] > 0 && (slots[i] -= dt) <= 0) {
        if (this.reserve.allied <= 0) { slots[i] = -1; continue; } // no more escorts to send
        this.reserve.allied--;
        slots[i] = 0; this.spawn(kind, i);
      }
    }
  }

  enemies(f) { return (f.side === 'axis' ? this.allied : this.axis) ?? []; }

  /** An enemy fighter sitting on our tail, close and pointing at us? */
  threatened(f) {
    for (const e of this.enemies(f)) {
      const d = f.pos.distanceTo(e.pos);
      if (d > 600) continue;
      const toUs = _t.copy(f.pos).sub(e.pos).normalize();
      if (e.dir.dot(toUs) > 0.94 && f.dir.dot(toUs) > 0.2) return true; // its nose on us, and it's behind
    }
    return false;
  }

  startEvade(f) {
    f.state = 'evade';
    f.timer = rand(2, 3.5);
    const s = Math.random() < 0.5 ? -1 : 1;
    f.breakDir = new V().crossVectors(f.dir, UP).normalize().multiplyScalar(s).add(new V(0, rand(-0.9, 0.2), 0)).add(f.dir.clone().multiplyScalar(0.2));
  }

  fly(f, dt) {
    const k = f.k;
    switch (f.state) {
      case 'approach': { // raider getting into position for its pass
        if (f.target.down || f.target.gone) { this.newAttack(f); break; } // already going down: pick another
        const p = f.target.group.position.clone().add(f.setup);
        f.speed += (k.setup - f.speed) * dt * 0.5; // full throttle to get ahead of the bombers
        f.steer(p.clone().sub(f.pos), k.turn, dt);
        if (f.pos.distanceTo(p) < 450) {
          f.state = 'attack';
          if (this.crewView && f.target === this.playerBomber && this.time - this.lastCall > 6) {
            this.lastCall = this.time;
            const c = clock(this.playerBomber, f.pos);
            this.ui.log(`Fighters, ${c.h} o'clock ${c.level}!`);
          }
        }
        break;
      }
      case 'attack': { // diving at a bomber, guns firing
        if (f.target.down) { this.startBreak(f); break; } // it's finished: go and find another
        const tgt = f.target.group.position.clone().add(f.aimOffset), dist0 = tgt.distanceTo(f.pos);
        tgt.add(this.wobble(f, dist0, PASS_WOBBLE)); // his aim wanders while he dives in
        const toTgt = tgt.clone().sub(f.pos), dist = toTgt.length();
        f.speed += (k.attack - f.speed) * dt * 0.6;
        f.steer(toTgt, k.combat - 0.1, dt);
        if (dist < FIRE_RANGE && f.dir.angleTo(toTgt) < 0.07) this.shoot(f, dt);
        const closure = f.velocity.dot(toTgt.clone().normalize());
        const alone = f.target.straggling; // (a straggler can't hit back much: they come in to point-blank)
        if (dist < (alone ? 90 : BREAK_RANGE) || (closure > 0 && dist / closure < (alone ? 0.45 : 0.9)) || dist > 3500) this.startBreak(f);
        break;
      }
      case 'break': // pull away under or past the bombers
        f.speed = Math.min(k.max, f.speed + dt * 6);
        f.steer(f.breakDir, k.breakTurn, dt);
        if ((f.timer -= dt) <= 0) { f.state = 'extend'; f.timer = rand(3, 5); }
        break;
      case 'extend': { // run out, climb back, then come round again
        if (f.target?.straggling) { // (on a straggler: only out a little way and straight back in)
          const away = f.pos.clone().sub(f.target.group.position).setY(0);
          away.lengthSq() < 1 ? away.set(1, 0, 0) : away.normalize();
          f.speed += (k.cruise - f.speed) * dt * 0.3;
          f.steer(away.setY(0.25), k.turn, dt);
          if ((f.timer -= dt) <= 0 && f.pos.distanceTo(f.target.group.position) > 900) this.newAttack(f);
          break;
        }
        const out = f.pos.clone().sub(this.center).setY(0), far = out.length();
        out.lengthSq() < 1 ? out.set(1, 0, 0) : out.normalize();
        // (out to a couple of km, then round the stream rather than further away: never lost out of the fight)
        if (far > 2200) out.set(-out.z, 0, out.x).multiplyScalar(f.side3 ?? 1).addScaledVector(out, -0.3).normalize();
        f.speed += (k.cruise - f.speed) * dt * 0.3;
        f.steer(out.setY(far > 2200 ? 0.05 : 0.35), k.turn, dt);
        if (far > 3200 && f.timer <= 0) { this.newAttack(f); break; }
        if ((f.timer -= dt) <= 0 && f.pos.distanceTo(this.center) > 1500) this.newAttack(f);
        break;
      }
      case 'evade':
        f.speed = Math.min(k.max, f.speed + dt * 8);
        f.steer(f.breakDir, k.breakTurn, dt);
        if ((f.timer -= dt) <= 0) {
          if (f.role === 'raider') { f.state = 'extend'; f.timer = rand(2, 4); } else f.state = f.side === 'allied' ? 'patrol' : 'hunt';
        }
        break;
      case 'patrol': { // escort weaving round its station above the formation
        const s = f.station;
        s.a += s.rate * dt;
        const p = new V(Math.cos(s.a + s.rate * 4) * s.r, s.h, Math.sin(s.a + s.rate * 4) * s.r).add(this.center);
        f.speed += (k.cruise - f.speed) * dt * 0.4;
        f.steer(p.sub(f.pos), k.turn, dt);
        const bandit = f.checkNow ? this.pickPrey(f, 2500) : null;
        if (bandit) {
          f.prey = bandit;
          f.state = 'engage';
          f.timer = 25;
          this.chased.add(bandit);
          const c = clock(this.playerBomber, f.pos);
          if (this.crewView && f.pos.distanceTo(this.playerBomber.group.position) < 1500 && this.time - this.lastFriendsCall > 20) {
            this.lastFriendsCall = this.time;
            this.ui.log(`Little friends at ${c.h} o'clock!`);
          }
        }
        break;
      }
      case 'rtb': { // out of ammunition (or the end of the day): away from the bombers, climbing, and gone
        const away = f.pos.clone().sub(this.center).setY(0);
        away.lengthSq() < 1 ? away.set(1, 0, 0) : away.normalize();
        f.speed += (k.cruise - f.speed) * dt * 0.3;
        f.steer(away.setY(0.15), k.turn, dt);
        if (f.pos.distanceTo(this.center) > 6500) f.state = 'gone';
        break;
      }
      case 'hunt': { // 109 hunter: find an escort and get on its tail
        if (!f.prey?.alive) { f.prey = this.pickPrey(f, 3500); if (f.prey) this.chased.add(f.prey); }
        if (!f.prey) { f.role = 'raider'; this.newAttack(f); break; }
        f.state = 'engage';
        f.timer = 30;
        break;
      }
      case 'engage': { // dogfight: lead pursuit on the prey, fire when the nose is on it
        const e = f.prey;
        if (!e?.alive || (f.timer -= dt) <= 0 || e.pos.distanceTo(f.pos) > 4000) {
          f.prey = null; f.leadSkill = undefined;
          f.state = f.side === 'allied' ? 'patrol' : 'hunt';
          break;
        }
        const dist = f.pos.distanceTo(e.pos);
        f.leadSkill ??= rand(0.55, 1.2); // deflection shooting: few pilots had the eye for it
        const lead = e.pos.clone().addScaledVector(e.velocity.sub(f.velocity), (dist / k.muzzle) * f.leadSkill).add(this.wobble(f, dist));
        const to = lead.sub(f.pos);
        f.speed += ((dist > 600 ? k.max : k.attack) - f.speed) * dt * 0.5;
        f.steer(to, k.combat, dt);
        if (dist < DOGFIGHT_RANGE && f.dir.angleTo(to) < 0.05) this.shoot(f, dt);
        if (dist < 70 && f.velocity.dot(e.pos.clone().sub(f.pos)) > 0) this.startEvade(f); // overshoot: pull off
        break;
      }
      default: break;
    }
  }

  startBreak(f) {
    f.state = 'break';
    f.timer = rand(2, 3);
    const away = new V().crossVectors(f.dir, UP).normalize().multiplyScalar(f.side3);
    f.breakDir = f.dir.clone().add(new V(0, f.attack === 'high' ? -1.4 : -0.9, 0)).add(away.multiplyScalar(0.8));
  }

  /** Nearest enemy fighter (within range of the formation) that nobody is already chasing. */
  pickPrey(f, range) {
    let best = null, bd = Infinity;
    for (const e of this.enemies(f)) {
      if (e.pos.distanceTo(this.center) > range) continue;
      if (this.chased.has(e)) continue; // one chaser each, so some raiders get through

      const d = e.pos.distanceTo(f.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** How far off his aim point a pilot's sight wanders (slow weaving, different for each pilot). */
  wobble(f, dist, amount = WOBBLE) {
    const t = this.time, w = dist * amount;
    return _t.set(Math.sin(t * 1.9 + f.id), Math.sin(t * 1.4 + f.id * 1.7), Math.sin(t * 1.1 + f.id * 2.3)).multiplyScalar(w);
  }

  shoot(f, dt) {
    // trigger discipline: bursts with pauses between them
    if (f.pauseT > 0) { f.pauseT -= dt; return; }
    if (f.side === 'axis' && (f.fireLeft = (f.fireLeft ?? (f.kind === 'fw190' ? 13 : 16)) - dt) <= 0) { f.state = 'rtb'; return; } // out of ammunition: home
    if ((f.burstT = (f.burstT ?? rand(...F_BURST)) - dt) <= 0) { f.burstT = rand(...F_BURST); f.pauseT = rand(...F_PAUSE); }
    const vel = f.velocity, team = f.side === 'axis' ? 'enemy' : 'allied';
    f.k.guns.forEach((g, i) => {
      f.gunTimers[i] -= dt;
      while (f.gunTimers[i] <= 0) {
        f.gunTimers[i] += 60 / g.rpm;
        const muzzle = _la.fromArray(g.at).applyMatrix4(f.obj.matrixWorld);
        const d = _lb.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(SPREAD).add(f.dir).normalize();
        this.bullets.spawn(muzzle, d.multiplyScalar(f.k.muzzle).add(vel), f.rounds++ % g.tracer === 0, team, f, g.cannon, f, 1.6);
      }
    });
    if (Math.random() < dt * 10) this.audio.distantGun(f.pos.distanceTo(this.playerBomber.group.position));
  }

  /** A round's path a -> b this frame. Returns true if it hit something (the round is used up). */
  collide(a, b, team, owner, cannon, src) {
    // friendly fire is on: any round can hit any aircraft except the one that fired it
    const hitB = this.hitBomber(a, b, cannon, src, owner);
    if (hitB) {
      if (this.playerSide === 'allied' && owner === 'player' && this.time - (this.lastFF ?? -99) > 4) {
        this.lastFF = this.time;
        this.ui.log("Cease fire! You're hitting our own bombers!");
      }
      return true;
    }
    const cand = this.fgrid?.get(cellKey(Math.floor(a.x / FCELL), Math.floor(a.y / FCELL), Math.floor(a.z / FCELL)));
    if (!cand?.length) return false;
    const near = _near, reach = a.distanceTo(b) + 8;
    for (const f of cand) {
      if (f.state === 'gone' || f === src) continue;
      const dx = a.x - f.pos.x, dy = a.y - f.pos.y, dz = a.z - f.pos.z;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue; // cheap reject first: most rounds are nowhere near
      if (segPoint(a, b, f.pos, near) > 7) continue;
      const la = _la.copy(a).applyMatrix4(f.inv), lb = _lb.copy(b).applyMatrix4(f.inv);
      let best = null, bt = 2;
      for (const [k, p] of Object.entries(f.k.parts)) {
        const t = segBox(la, lb, p.box);
        if (t >= 0 && t < bt) { bt = t; best = k; }
      }
      if (!best) continue;
      this.effects.impact(_t.copy(a).lerp(b, bt));
      const wasAlive = f.alive, mine = owner === 'player' && f.side !== this.playerSide;
      const crits = mine ? critLevel(f) : 0;
      if (wasAlive) this.damage(f, best, owner, team);
      if (mine && wasAlive) { // your round on an enemy: a hit; set it on fire, kill the engine or take a wing off: a crit
        f.playerHitT = this.time;
        this.report?.('hit', f.k.name, cannon ? 3 : 1);
        if (f.alive && critLevel(f) > crits) this.report?.('crit', f.k.name);
      }
      if (owner === 'player') {
        if (f.side !== this.playerSide) this.ui.hitMarker(wasAlive && !f.alive); // (no marker for hitting your own side)
        if (f.side === this.playerSide && this.time - (this.lastFF ?? -99) > 4) { this.lastFF = this.time; this.ui.log(`Cease fire! That's one of ours, a ${f.k.name}!`); }
      }
      return true;
    }
    return false;
  }

  damage(f, part, owner, team) {
    if ((team === 'enemy') === (f.side === 'axis')) owner = 'friendly'; // shot by its own side: nobody's kill
    f.parts[part] -= 1;
    if (f.player) { // your own fighter hit: you hear it strike, and feel it if it's the cockpit
      this.audio.impact(false, 0.8);
      if (part === 'pilot') { this.audio.pain(1, f.parts.pilot <= 0, 0.3); this.ui.hitFlash(1); }
    }
    const hp = f.parts[part], full = f.k.parts[part].hp;
    if (part === 'engine' && hp < full * 0.5) f.smoking = true;
    if (part === 'engine' && hp <= 0 && !f.engineDead) { f.engineDead = true; if (Math.random() < 0.5) f.burning = true; }
    if (part === 'fuel' && hp <= 0) { f.burning = true; f.fuse = rand(2.5, 6); }
    if (part === 'pilot' && hp <= 0) f.pilotDead = true;
    if ((part === 'wingL' || part === 'wingR') && hp <= 0 && !f.wingGone) { // the wing tears off and tumbles away
      f.wingGone = true; f.burning = true; f.spin = (part === 'wingL' ? -1 : 1) * rand(2.5, 4);
      this.effects.wreck(_t.set(part === 'wingL' ? -3 : 3, 0, -1.2).applyMatrix4(f.obj.matrixWorld), f.velocity, 2, _t2.set(3.5, 0.2, 1.6), 0.6);
    }
    if (part === 'tail' && hp <= 0 && !f.tailGone) {
      f.tailGone = true; f.spin = rand(-1.5, 1.5);
      this.effects.wreck(_t.set(0, 0.6, 4).applyMatrix4(f.obj.matrixWorld), f.velocity, 2, _t2.set(2.2, 0.15, 1.0), 0.2);
    }
    if (part === 'fuselage' && hp <= 0) f.burning = true;
    if (f.engineDead || f.pilotDead || f.parts.wingL <= 0 || f.parts.wingR <= 0 || f.parts.tail <= 0 || f.parts.fuselage <= 0 || f.burning) {
      this.shotDown(f, owner);
    }
  }

  shotDown(f, owner) {
    // a 109 the player shoots down on its way in to the bombers: an attack broken up, bombers saved
    if (owner === 'player' && f.side === 'axis' && (f.state === 'attack' || f.state === 'approach')) this.saved = (this.saved ?? 0) + 1;
    f.state = 'down';
    f.killedBy = owner;
    const t = (this.tally ??= { player: 0, crew: 0, escorts: 0, axisLost: 0, alliedLost: 0 });
    if (f.side === 'axis') {
      t.axisLost++;
      if (owner === 'player') t.player++; else if (owner === 'crew') t.crew++; else if (!['friendly', 'bailout', 'collision', 'ground'].includes(owner)) t.escorts++;
    } else t.alliedLost++;
    f.downTime = rand(8, 14);
    // the pilot gets out (if he's alive and the plane isn't in pieces at once)
    if (!f.pilotDead && owner !== 'collision' && Math.random() < 0.55) f.bailT = rand(1.5, 4.5);
    if (!f.spin) f.spin = rand(-0.8, 0.8);
    if (owner === 'player' && f.side !== this.playerSide) {
      this.kills++;
      this.ui.kill(this.kills);
      this.report?.('kill', f.k.name);
    } else if (f.side !== this.playerSide && owner !== 'player' && f.playerHitT > this.time - 20) {
      this.report?.('assist', f.k.name); // you damaged it, someone else finished it
    } else if (this.crewView && !['collision', 'friendly', 'ground', 'bailout'].includes(owner) && f.pos.distanceTo(this.playerBomber.group.position) < 1500 && Math.random() < 0.6) {
      this.ui.log(f.side === 'axis' ? 'Escort got one!' : 'Little friend going down!');
    }
  }

  fall(f, dt) {
    // out of control: the nose drops, speed builds, it rolls or spins; burning ones may blow up
    f.speed = Math.min(f.k.max + 40, f.speed + dt * 7);
    f.steer(f.dir.clone().add(new V(0, -0.9, 0)), f.engineDead && !f.burning ? 0.12 : 0.3, dt);
    f.roll += f.spin * dt;
    if (f.bailT !== undefined && (f.bailT -= dt) <= 0) { this.effects.parachute(f.pos.clone().add(_t.set(0, 3, 0))); f.bailT = undefined; }
    if (f.fuse !== undefined && (f.fuse -= dt) <= 0) { this.explode(f); return; }
    if ((f.downTime -= dt) <= 0 || f.pos.y < -2500) {
      if (f.burning && f.pos.distanceTo(this.playerBomber.group.position) < 2500) this.explode(f);
      else f.state = 'gone';
    }
  }

  explode(f) {
    this.effects.explosion(f.pos, f.velocity, 1);
    this.effects.wreck(f.pos, f.velocity, 4, _t.set(2.2, 0.3, 1.2), 0.4); // the plane in pieces
    this.audio.explosion(f.pos.distanceTo(this.playerBomber.group.position));
    f.state = 'gone';
  }

  spinProp(f, dt) {
    if (!f.obj.parent) return; // drawn as a far-away instance: no prop to see
    const turning = !f.engineDead;
    if (f.disc) { f.disc.visible = turning; f.disc.rotation.z += dt * 40; }
    if (f.blades) { f.blades.visible = !turning; f.blades.rotation.z += dt * (f.state === 'down' ? 3 : 0); }
    if (f.spinner) f.spinner.rotation.z += dt * (turning ? 45 : 3);
  }

  damageTrails(f, dt) {
    if (!f.burning && !f.engineDead && !f.smoking) return;
    const e = this.effects, m = f.obj.matrixWorld, v = f.velocity;
    if (f.burning) e.trail(_t.fromArray(f.k.fireAt).applyMatrix4(m), v, 'fire', dt);
    else if (f.engineDead) e.trail(_t.fromArray(f.k.smokeAt).applyMatrix4(m), v, 'black', dt);
    else e.trail(_t.fromArray(f.k.smokeAt).applyMatrix4(m), v, 'glycol', dt);
  }

  // ----- German rounds against the bombers -----
  /** File every bomber into the grid cells it (plus a frame's flight of a round) reaches. Once per frame. */
  fileBombers() {
    const grid = (this.grid ??= new Map());
    resetGrid(grid, (this.gridKeys ??= []));
    for (const bomber of this.bombers) {
      if (bomber.gone) continue;
      const g = bomber.group.position;
      // the bomber's own transform only (it sits in the scene root): its parts are the renderer's job
      bomber.group.updateMatrix();
      (bomber._inv ??= new THREE.Matrix4()).copy(bomber.group.matrix).invert();
      const x0 = Math.floor((g.x - CELL_PAD) / CELL), x1 = Math.floor((g.x + CELL_PAD) / CELL);
      const y0 = Math.floor((g.y - CELL_PAD) / CELL), y1 = Math.floor((g.y + CELL_PAD) / CELL);
      const z0 = Math.floor((g.z - CELL_PAD) / CELL), z1 = Math.floor((g.z + CELL_PAD) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        fileIn(grid, this.gridKeys, cellKey(x, y, z), bomber);
      }
    }
  }

  /**
   * Mid-air collisions. Fighter with fighter: both lose a wing or the tail and go down. Fighter with a B-17:
   * the fighter is wrecked and the bomber badly damaged where it hit (a 109 pilot ramming counts as his kill).
   * B-17 with B-17: only possible while you fly yours out of its slot; both go down.
   */
  collisions(dt = 0) {
    const key = (p) => cellKey(Math.floor(p.x / FCELL), Math.floor(p.y / FCELL), Math.floor(p.z / FCELL));
    for (const f of this.list) {
      if (!f.alive) continue;
      for (const g of this.fgrid.get(key(f.pos)) ?? []) {
        if (g === f || !g.alive || g.id < f.id) continue; // each pair once
        if (f.pos.distanceToSquared(g.pos) > RAM * RAM) continue;
        if (!f.player && !g.player && !this.closeCall(f, AI_MIDAIR_CHANCE)) continue;
        this.ram(f); this.ram(g);
        this.callCollision(f.pos, `Mid-air! A ${f.k.name} and a ${g.k.name} collided!`);
        break;
      }
      if (!f.alive) continue;
      for (const b of this.grid?.get(key(f.pos)) ?? []) {
        if (b.gone) continue;
        const l = _la.copy(f.pos).applyMatrix4(b._inv);
        const part = BOMBER_PARTS.find(({ box: q }) => l.x > q[0] - RAM_PAD && l.x < q[1] + RAM_PAD && l.y > q[2] - RAM_PAD && l.y < q[3] + RAM_PAD && l.z > q[4] - RAM_PAD && l.z < q[5] + RAM_PAD);
        if (!part) continue;
        if (!f.player && !this.closeCall(f, AI_RAM_CHANCE)) continue;
        b.lastHitBy = f.player ? 'player' : 'collision'; b.lastHitT = this.time;
        for (let i = 0; i < 34; i++) b.hit(part, true); // tons of fighter at 200 m/s: wings and tails break
        if (part.section === 'nose' || part.section === 'cockpit') b.goDown('Rammed head-on! The cockpit is gone!');
        for (let i = 0; i < 3; i++) this.onBomberHit?.(b, part, l, true); // the crew near the impact
        if (b === this.playerBomber) this.audio.impact(true);
        this.ram(f);
        this.explode(f);
        this.callCollision(f.pos, b === this.playerBomber && this.crewView ? "We've been rammed!" : `A ${f.k.name} has rammed a B-17!`);
        break;
      }
    }
    // a crippled bomber drifting out of the box, or one falling, can hit another on the way
    for (const b of this.bombers) {
      if (b.gone || b.crashed || !(b.down || b.deadEngines >= 2) || Math.random() < 0.7) continue; // (checked now and then: most near things miss)
      for (const o of this.grid?.get(key(b.group.position)) ?? []) {
        if (o === b || o.gone || o.crashed || o.group.position.distanceToSquared(b.group.position) > BOMBER_RAM * BOMBER_RAM) continue;
        b.crashed = o.crashed = true; // (they go down together; checked once)
        const mid = _t.copy(b.group.position).add(o.group.position).multiplyScalar(0.5);
        this.effects.explosion(mid.clone(), _t2.set(0, -10, 30), 2.5);
        this.effects.wreck(mid, _t2.set(0, -5, 25), 8, _la.set(5, 0.4, 2.5), 0.5);
        if (!o.down) o.goDown('Mid-air collision!'); if (!b.down) b.goDown('Mid-air collision!');
        if (this.crewView && (o === this.playerBomber || b === this.playerBomber)) this.ui.log("We've collided with another B-17!");
        else this.callCollision(mid, 'Two B-17s have collided!');
        break;
      }
    }
    this.bomberContact(dt);
  }

  /**
   * You flying your B-17 into another: contact between their real shapes (wings, tailplane, fuselage), not
   * their centres, and as bad as it was hard. A brush (a wingtip, a scrape): a jolt, a little damage, both
   * knocked apart and the controls kicked for a moment. A real hit: heavy damage where they met, an engine
   * or a wingtip gone, a long fight for control. Wing into wing hard: those wing panels come off. Only a big
   * hit into a fuselage takes both straight down.
   */
  bomberContact(dt) {
    const pb = this.playerBomber;
    if (!pb.offStation || pb.down || pb.gone || dt <= 0) { this.lastPb = null; return; }
    const at = pb.group.position;
    const vA = _cv.copy(at).sub(this.lastPb ?? at).divideScalar(dt); // (your velocity through the box)
    (this.lastPb ??= new V()).copy(at);
    for (const b of this.bombers) {
      if (b === pb || b.down || b.gone || b.group.position.distanceToSquared(at) > CONTACT_NEAR * CONTACT_NEAR) continue;
      if ((b.bumpedUntil ?? 0) > this.time) continue; // (just knocked apart: not the same contact twice)
      const c = contact(pb, b) ?? contact(b, pb, true);
      if (!c) continue;
      // how hard: the closing speed along the line between them, and how deep they went into each other
      const vB = _cw.copy(b.group.position).sub(b.lastAt ?? b.group.position).divideScalar(dt);
      const n = _cn.copy(b.group.position).sub(at).normalize();
      const closing = Math.max(0, vA.dot(n) - vB.dot(n)), hard = closing + c.depth * 6;
      this.lastBump = { hard, closing, depth: c.depth, mine: c.a.name, theirs: c.b.name }; // (for the tests)
      this.bump(pb, b, c, n, hard);
    }
    for (const b of this.bombers) if (!b.gone && b.group.position.distanceToSquared(at) < CONTACT_NEAR * CONTACT_NEAR * 4) (b.lastAt ??= new V()).copy(b.group.position);
  }

  bump(pb, b, c, n, hard) {
    const mine = c.a, theirs = c.b; // the parts that met: yours, hers
    const wings = mine.kind === 'wing' && theirs.kind === 'wing', hull = mine.kind === 'section' || theirs.kind === 'section';
    const where = _cp.copy(c.at);
    // knocked apart, both of them (her AI pilot then takes her back to her slot)
    const push = c.depth * 0.6 + 0.5 + Math.min(4, hard * 0.15);
    pb.base.addScaledVector(n, -push); b.base.addScaledVector(n, push);
    pb.bumpedUntil = b.bumpedUntil = this.time + 1.5;
    const level = hard < BRUSH ? 0 : hard < SMASH ? 1 : 2;
    const k = [0.35, 0.8, 1][level], T = [1.6, 4.5, 6][level];
    for (const x of [pb, b]) x.knock = { t: T, T, yaw: (Math.random() < 0.5 ? -1 : 1) * [0.08, 0.22, 0.35][level], roll: (Math.random() < 0.5 ? -1 : 1) * [0.25, 0.6, 0.9][level] };
    this.effects.impact(where, true); this.effects.impact(where.clone().addScaledVector(n, 1), level > 0);
    if (level > 0) this.effects.wreck(where, _t2.set(0, -3, 20), level === 2 ? 6 : 3, _la.set(1.2, 0.15, 0.8), 0.15);
    this.onBumped?.(k, level);
    // the damage where they met (and an engine on that stretch of wing)
    const hits = [2, 8, 20][level]; // (each as a cannon shell: 3 points. A brush dents her; a hit takes a third of a wing panel; a big one tears it open)
    const engines = (part, l) => (part.kind === 'wing' ? BOMBER_PARTS.filter((p) => p.kind === 'engine' && Math.abs((p.box[0] + p.box[1]) / 2 - l.x) < 1.6) : []);
    for (const [x, part, l] of [[pb, mine, c.la], [b, theirs, c.lb]]) {
      for (let i = 0; i < hits; i++) x.hit(part, true);
      if (level > 0) for (const e of engines(part, l)) for (let i = 0; i < hits * 0.6; i++) x.hit(e, true);
      this.onBomberHit?.(x, part, l, level > 0, n.clone().multiplyScalar(x === pb ? -1 : 1));
    }
    const side = (p) => (p.side < 0 ? 'left' : 'right');
    let msg;
    if (level === 2 && hull) { // into her fuselage, hard: both finished
      b.goDown('Mid-air collision!'); pb.goDown('Mid-air collision! We hit another B-17!');
      msg = "We've collided with another B-17! She's breaking up!";
    } else if (level >= 1 && wings && hard > WING_OFF) { // wing into wing: those panels come off
      b.loseWing(theirs.side, !!theirs.inner, 'Mid-air collision: her wing is gone!');
      pb.loseWing(mine.side, !!mine.inner, `Mid-air collision! We've lost the ${side(mine)} wing!`);
      msg = `We've lost the ${side(mine)} wing!`;
    } else if (level === 0) msg = mine.kind === 'wing' ? `We scraped her wingtip! Our ${side(mine)} wing's dented.` : 'We bumped another B-17! Ease off!';
    else msg = `We've hit another B-17! ${mine.kind === 'wing' ? `The ${side(mine)} wing is` : mine.kind === 'tail' ? 'The tail is' : 'We are'} badly damaged!`;
    this.lastBump.level = level; this.lastBump.msg = msg;
    if (this.crewView) this.ui.log(msg); else this.callCollision(where, 'Two B-17s have touched!');
  }

  /** An AI pilot's close pass: one roll per pass (a second), and most of the time he just misses. */
  closeCall(f, chance) {
    if (f.passUntil > this.time) return false;
    f.passUntil = this.time + 1;
    return Math.random() < chance;
  }

  /** A fighter's collision: a wing or the tail is gone, maybe a fire; it goes down (nobody's kill). */
  ram(f) {
    if (!f.alive) return;
    const lost = ['wingL', 'wingR', 'tail'][Math.floor(Math.random() * 3)];
    f.parts[lost] = 0;
    f.spin = lost === 'tail' ? rand(-1.5, 1.5) : (lost === 'wingL' ? -1 : 1) * rand(2.5, 4);
    if (Math.random() < 0.5) f.burning = true;
    this.shotDown(f, 'collision');
  }

  callCollision(at, text) {
    if (this.pilot?.f && at.distanceTo(this.pilot.f.pos) < 30 && !this.crewView) this.ui.log('You collided!');
    else if (at.distanceTo(this.crewView ? this.playerBomber.group.position : (this.pilot?.f?.pos ?? at)) < 1500) this.ui.log(text);
  }

  /** File the fighters into grid cells too, once a frame after they've moved. */
  fileFighters() {
    const grid = (this.fgrid ??= new Map());
    resetGrid(grid, (this.fgridKeys ??= []));
    for (const f of this.list) {
      if (f.state === 'gone') continue;
      const p = f.pos;
      const x0 = Math.floor((p.x - FCELL_PAD) / FCELL), x1 = Math.floor((p.x + FCELL_PAD) / FCELL);
      const y0 = Math.floor((p.y - FCELL_PAD) / FCELL), y1 = Math.floor((p.y + FCELL_PAD) / FCELL);
      const z0 = Math.floor((p.z - FCELL_PAD) / FCELL), z1 = Math.floor((p.z + FCELL_PAD) / FCELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        fileIn(grid, this.fgridKeys, cellKey(x, y, z), f);
      }
    }
  }

  hitBomber(a, b, cannon, src, owner) {
    if (!this.grid) this.fileBombers();
    const list = this.grid.get(cellKey(Math.floor(a.x / CELL), Math.floor(a.y / CELL), Math.floor(a.z / CELL)));
    if (!list?.length) return false;
    const reach = a.distanceTo(b) + 20;
    for (const bomber of list) {
      if (bomber.gone || bomber === src) continue;
      const g = bomber.group.position;
      const dx = a.x - g.x, dy = a.y - g.y, dz = a.z - g.z;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue; // quick reject
      if (segPoint(a, b, g, _near) > 20) continue;
      const inv = bomber._inv;
      const la = _la.copy(a).applyMatrix4(inv), lb = _lb.copy(b).applyMatrix4(inv);
      let part = null, t = 2;
      for (const p of BOMBER_PARTS) {
        if (segBox(la, lb, p.box) < 0) continue; // (not near it at all)
        for (const q of p.boxes) { const u = segBox(la, lb, q); if (u >= 0 && u < t) { t = u; part = p; } }
      }
      if (!part) continue;
      this.effects.impact(_t.copy(a).lerp(b, t), cannon);
      const mine = owner === 'player' && this.playerSide === 'axis' && !bomber.down;
      const crits = mine ? bomber.deadEngines + (bomber.burning ? 10 : 0) : 0;
      // (the enemy's fire on the rest of the stream, weighted to keep the mission's losses on course: main.js)
      // (never shielding a straggler: alone, she gets the full weight of it)
      const k = owner !== 'player' && bomber !== this.playerBomber ? (this.lossBias ?? 1) * (this.groupBias?.get(bomber.squad) ?? 1) : 1;
      for (let n = Math.floor(k) + (Math.random() < k % 1 ? 1 : 0); n > 0; n--) bomber.hit(part, cannon);
      if (mine) {
        this.ui.hitMarker(bomber.down); // a 109 pilot's rounds on a B-17 (red and bigger if that brought it down)
        bomber.playerHitT = this.time;
        this.report?.('hit', 'B-17', cannon ? 3 : 1);
        if (!bomber.down && bomber.deadEngines + (bomber.burning ? 10 : 0) > crits) this.report?.('crit', 'B-17');
      }
      bomber.lastHitBy = owner; bomber.lastHitT = this.time; // for the fighter pilots' score
      this.onBomberHit?.(bomber, part, la.clone().lerp(lb, t), cannon, lb.clone().sub(la));
      if (bomber === this.playerBomber) this.audio.impact(cannon);
      return true;
    }
    return false;
  }
}
