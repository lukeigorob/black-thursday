// A B-17 in the formation: the model, spinning props, the gentle rocking of a heavy bomber,
// and battle damage, part by part: each engine, the inner wings (with their fuel tanks) and the outer
// wings either side, the tail, the turrets, and the fuselage section by section. Each part fails in
// its own way: engines smoke, burn or stop; wings leak fuel, burn and break off; a shot-up tail makes
// her sloppy to fly, then goes; fires in the fuselage grow until she breaks up.
// Everything inside (interior, player) is a child of `group`, so it moves and rocks with the plane.
import * as THREE from 'three';
import { Interior } from './interior.js';
import { applyMarkings } from './markings.js';

export const AIRSPEED = 75; // m/s: 270 km/h (~170 mph), a loaded B-17's cruise at altitude
export const FORMATION = { bank: 0 }; // (the whole formation banked in a turn: rad, + right wing down; main.js)
const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const MAX_BANK = 0.6; // rad (~35 degrees): a loaded B-17 turns gently
const clamp = THREE.MathUtils.clamp, wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _up = new V(0, 1, 0);
const SPEED_PER_POWER = 40; // m/s more (or less) than the formation's speed per unit of power above (below) cruise

/** Turn a prop's blades about their own length: 0 = in flight pitch, 1 = feathered, edge-on. */
function featherBlades(prop, k) {
  prop.userData.shown = k;
  prop.userData.blades ??= prop.children.filter((c) => c.isMesh).map((b) => {
    b.geometry.computeBoundingBox();
    const axis = b.geometry.boundingBox.getCenter(new V()).setZ(0).normalize(); // (out along the blade from the hub)
    return { b, axis, q0: b.quaternion.clone() };
  });
  for (const { b, axis, q0 } of prop.userData.blades) b.quaternion.copy(q0).multiply(_q3.setFromAxisAngle(axis, k * 1.2));
}

// A running prop as the eye sees it: a faint disc, the three blades smeared into ghosts, the yellow tips a
// ring. (Drawn crisp each frame, real blades only ever looked frozen.) One texture and material for all.
let _blurMat = null;
function blurMaterial() {
  if (_blurMat) return _blurMat;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, r = Math.hypot(dx, dy), i = (y * S + x) * 4;
    if (r > 1 || r < 0.13) continue;
    const ghost = Math.pow(Math.cos(Math.atan2(dy, dx) * 1.5) ** 2, 6); // (three blades, each trailing a smear)
    const tip = r > 0.9 ? 1 : 0;
    const a = (0.08 + 0.42 * ghost) * Math.min(1, (1 - r) * 30) * (r < 0.25 ? (r - 0.13) / 0.12 : 1);
    img.data.set(tip ? [200, 160, 50, 255 * a * 0.7] : [24, 24, 22, 255 * a], i);
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  // (lit like the rest of her: dark by night, not glowing)
  return (_blurMat = new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
}
/** The disc's place on its prop: the blades' radius and how far along the shaft they sit (measured once). */
function discOf(prop) {
  if (prop.userData.discAt) return prop.userData.discAt;
  const box = new THREE.Box3();
  for (const m of prop.children) if (m.isMesh) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix)); }
  return (prop.userData.discAt = { R: Math.max(-box.min.x, box.max.x, -box.min.y, box.max.y), z: (box.min.z + box.max.z) / 2 });
}

/**
 * Every running prop of every bomber as its blur disc: one instanced mesh, one draw call for the lot (each
 * prop's blades, which it replaces, were a draw call of their own). update() after the bombers have moved
 * and their matrices are fresh (main.js, after the contrails).
 */
export class PropBlur {
  constructor(scene, bombers) {
    this.bombers = bombers;
    this.mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 40), blurMaterial(), bombers.length * 4);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update() {
    let k = 0;
    for (const b of this.bombers) {
      if (b.gone || !b.group.visible) continue;
      for (const p of b.props) {
        if (!p?.userData.blurred) continue;
        const d = discOf(p), u = p.userData;
        _dm.makeRotationZ(u.discA ?? 0).setPosition(0, 0, d.z).scale(_ds.setScalar(d.R));
        this.mesh.setMatrixAt(k++, _dm.premultiply(p.matrixWorld));
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const _dm = new THREE.Matrix4(), _ds = new THREE.Vector3();

/**
 * Wrap a model's ball and top turrets in pivots (once per model): the ball and its guns turn and tilt
 * about the ball's centre, its yoke and the top turret (with its guns) turn about their own axes.
 */
function rigTurrets(model) {
  model.updateMatrixWorld(true);
  const toLocal = model.matrixWorld.clone().invert(), out = {};
  const wrap = (names, at) => {
    const p = new THREE.Object3D(); p.position.set(...at); model.add(p); p.updateMatrixWorld(true);
    for (const n of names) { const o = model.getObjectByName(n); if (o) p.attach(o); }
    return p;
  };
  const restOf = (names, at) => { // which way the guns point at rest, from their middle
    const merged = model.getObjectByName(names[0])?.userData.guns; // (a merged turret knows where its guns are)
    if (merged) return new V(...merged).sub(new V(...at)).normalize();
    const b = new THREE.Box3();
    for (const n of names.slice(1)) { const o = model.getObjectByName(n); if (o) b.expandByObject(o); }
    if (b.isEmpty()) return new V(0, -1, -0.01).normalize();
    return b.getCenter(new V()).applyMatrix4(toLocal).sub(new V(...at)).normalize();
  };
  const ball = [0, -2.3, -0.13], ballGuns = ['GunBarrel004', 'GunBarrel14'];
  if (model.getObjectByName('BallTurret')) {
    const d = restOf(['BallTurret', ...ballGuns], ball), yaw0 = Math.atan2(-d.x, -d.z), pitch0 = Math.asin(clamp(d.y, -1, 1));
    const full = wrap(['BallTurret', ...ballGuns], ball), yawPart = wrap(['BallStabilizer1'], ball);
    out.ball = { full, yawPart, yaw0, pitch0, yaw: yaw0, pitch: pitch0, elev: new V(Math.cos(yaw0), 0, -Math.sin(yaw0)) };
  }
  const top = [0, 1.43, -6.71];
  if (model.getObjectByName('TopTurret')) {
    const d = restOf(['TopTurret', 'TopGuns'], top), yaw0 = Math.atan2(-d.x, -d.z);
    out.top = { yawPart: wrap(['TopTurret', 'TopGuns'], top), full: null, yaw0, pitch0: 0, yaw: yaw0, pitch: 0, elev: new V(1, 0, 0) };
  }
  return out;
}
const _vel = new V(), _at = new V(), _w = new V(), _d = new V(), _rock = new THREE.Euler(), _fe = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export const ENGINE_X = [-7.16, -3.93, 3.94, 7.15]; // engines 1-4, numbered left to right as the pilot sees them
export const SECTIONS = [['nose', -11.4, -8.6], ['cockpit', -8.6, -6.35], ['bombbay', -6.35, -2.6], ['radio', -2.6, -1.25], ['waist', -1.25, 5.2], ['tail', 5.2, 11.4]];

// Hit boxes in bomber space [x0, x1, y0, y1, z0, z1] (nose -Z), measured from the model: each part is a
// few boxes following its shape (`boxes`: what a round must pass through to hit it), `box` the lot's bounds.
// The fuselage, station by station [z, half-width, bottom, top]: round the nose, widest at the wing, the
// spine falling away aft and the tail cone narrowing to the tail gun
const HULL = [[-11.6, 0.55, -0.8, 0.5], [-10.6, 0.95, -1.1, 0.85], [-10.0, 1.0, -1.8, 0.95], [-8.6, 1.1, -1.85, 1.0], [-8.0, 1.15, -1.9, 1.05],
  [-6.0, 1.2, -2.0, 1.05], [-4.0, 1.15, -2.2, 0.85], [-2.5, 1.1, -2.3, 0.55], [-1.0, 1.0, -2.45, 0.25], [1.0, 0.95, -2.5, 0.05], [3.0, 0.9, -2.5, -0.2],
  [6.0, 0.82, -2.55, -0.25], [8.5, 0.62, -2.6, -0.8], [10.0, 0.45, -2.62, -1.15], [11.4, 0.3, -2.62, -1.8]];
/** The fuselage between z0 and z1: a box for each stretch between stations, as big as its bigger end. */
function hullBoxes(z0, z1) {
  const out = [];
  for (let i = 0; i < HULL.length - 1; i++) {
    const [za, wa, ba, ta] = HULL[i], [zb, wb, bb, tb] = HULL[i + 1], lo = Math.max(z0, za), hi = Math.min(z1, zb);
    if (hi - lo < 0.01) continue;
    const at = (z) => { const t = (z - za) / (zb - za); return [wa + (wb - wa) * t, ba + (bb - ba) * t, ta + (tb - ta) * t]; };
    const [w1, b1, t1] = at(lo), [w2, b2, t2] = at(hi), w = Math.max(w1, w2);
    out.push([-w, w, Math.min(b1, b2), Math.max(t1, t2), lo, hi]);
  }
  return out;
}
// the wing, span-wise in stretches [|x| from, to, leading edge z, trailing edge z, bottom, top]: thick at the
// root, thin and swept back to the rounded tip
const WING = [[1.1, 3.0, -6.8, -1.5, -1.65, -0.35], [3.0, 5.5, -6.5, -1.8, -1.55, -0.4], [5.5, 8.0, -6.2, -2.1, -1.45, -0.45],
  [8.0, 10.5, -5.95, -2.1, -1.3, -0.5], [10.5, 13.0, -5.45, -2.25, -1.15, -0.55], [13.0, 15.0, -5.2, -2.35, -1.05, -0.6], [15.0, 16.4, -4.9, -2.6, -1.0, -0.65]];
const wingBoxes = (side, from, to) => WING.filter(([a]) => a >= from && a < to).map(([a, b, le, te, y0, y1]) => (side < 0 ? [-b, -a, y0, y1, le, te] : [a, b, y0, y1, le, te]));
// the tail: the fin (thin, its leading edge swept up from the dorsal fillet) and the two tailplanes
const FIN = [[4.6, 6.0, -0.6, 0.3], [6.0, 6.8, -0.6, 0.9], [6.8, 7.6, -0.8, 1.7], [7.6, 8.3, -0.9, 2.7], [8.3, 10.0, -1.0, 3.05], [10.0, 10.4, -1.1, 2.6]].map(([z0, z1, y0, y1]) => [-0.28, 0.28, y0, y1, z0, z1]);
const STAB = [[0.3, 2.2, 5.9, 9.4], [2.2, 4.4, 6.4, 9.4], [4.4, 6.8, 6.9, 9.3]].flatMap(([a, b, z0, z1]) => [[a, b, -2.0, -1.3, z0, z1], [-b, -a, -2.0, -1.3, z0, z1]]);
const bounds = (boxes) => [0, 1, 2, 3, 4, 5].map((k) => (k % 2 ? Math.max : Math.min)(...boxes.map((q) => q[k])));
export const PARTS = [
  // a B-17 could take a lot: hit points are rounds of .30/.50 (a 20 mm shell counts 3)
  ...ENGINE_X.map((x, i) => ({ name: `engine${i + 1}`, kind: 'engine', engine: i, boxes: [[x - 0.7, x + 0.7, -1.4, 0.0, -9.1, -4.6]], hp: 32 })),
  // the inner wings carry the fuel tanks round the engines; the outer wings, the tips
  { name: 'wingLi', kind: 'wing', side: -1, inner: true, boxes: wingBoxes(-1, 0, 8), hp: 70 },
  { name: 'wingRi', kind: 'wing', side: 1, inner: true, boxes: wingBoxes(1, 0, 8), hp: 70 },
  { name: 'wingLo', kind: 'wing', side: -1, boxes: wingBoxes(-1, 8, 99), hp: 80 },
  { name: 'wingRo', kind: 'wing', side: 1, boxes: wingBoxes(1, 8, 99), hp: 80 },
  { name: 'tailplane', kind: 'tail', boxes: [...FIN, ...STAB], hp: 45 },
  { name: 'ball', kind: 'turret', turret: 'ball', boxes: [[-0.55, 0.55, -2.95, -1.95, -0.75, 0.5]], hp: 22 },
  { name: 'top', kind: 'turret', turret: 'top', boxes: [[-0.62, 0.62, 1.0, 1.75, -7.35, -6.05]], hp: 22 },
  // (the cockpit with its canopy over it)
  ...SECTIONS.map(([name, z0, z1]) => ({ name, kind: 'section', section: name, boxes: [...hullBoxes(z0, z1), ...(name === 'cockpit' ? [[-0.9, 0.9, 1.0, 1.6, -8.4, -6.4]] : [])], hp: 60 })),
].map((p) => ({ ...p, box: bounds(p.boxes) }));

// everything that makes a bomber "that bomber" (where it flies, its damage), but not how it's drawn
const STATE = ['base', 'home', 'slot0', 'noTail', 'pilotless', 'pilotlessT', 'flown', 'flight', 'bottles', 'leak', 'fx', 'spiral', 'phase', 'label', 'squad', 'lead', 'bombs', 'dropping', 'hp', 'engines', 'tankFire', 'down', 'gone', 'drift', 'roll', 'rollRate', 'downT', 'chutes',
  'lost', 'secFire', 'secFireLimit', 'turretOut', 'dive', 'warned', 'lastHitBy', 'lastHitT', 'playerHitT', 'crashed', 'unit', 'ident', 'histRecord', 'histCrew', 'cutBoxes', 'lostParts']; // (the last two: what break-up has cut away, breakup.js)
const STRAGGLE = 180, STRAG_BACK = 320; // m: a straggler; how far back behind her slot one falls at most // m from her slot in the box: a straggler
export const PART = Object.fromEntries(PARTS.map((p) => [p.name, p]));
const FUSELAGE = ['bombbay', 'radio', 'waist', 'tail']; // the sections a fire can take hold in and break her up
const NAMES = { nose: 'the nose', cockpit: 'the cockpit', bombbay: 'the bomb bay', radio: 'the radio room', waist: 'the waist', tail: 'the tail' };

/**
 * Swap two bombers' identities. The player's bomber (full model, interior, guns) takes over another
 * bomber's place in the formation, damage and all; that bomber gets the old one's (maybe falling) state.
 */
export function swapBombers(a, b) {
  for (const k of STATE) [a[k], b[k]] = [b[k], a[k]];
  for (const x of [a, b]) {
    x.group.visible = !x.gone;
    x.group.position.copy(x.base);
    for (const p of x.props) if (p) p.userData.spin = null;
    if (x.model) applyMarkings(x.model, x.ident); // (the identity moved: so do her markings)
  }
}

export class Bomber {
  /** model = null for a far-away bomber drawn by the Fleet (instanced low-detail copies). */
  constructor(model, { position = new V(), interior = false, label = '', squad = '', lead = false } = {}) {
    this.group = new THREE.Group();
    if (model) this.group.add(model);
    this.model = model;
    this.label = label;
    this.squad = squad; // the 18-ship group it bombs with
    this.lead = lead; // that group's lead (its bombardier aims for the whole group)
    this.bombs = 12; // 12 x 500 lb
    this.base = position.clone();
    this.home = position.clone(); // its slot in the formation (base leaves it while the player flies)
    this.slot0 = position.clone(); // where that slot is in the box (home drifts away from it with a straggler)
    // heading/pitch/bank relative to the formation's course; only the player's own pilot changes them
    this.flight = { heading: 0, pitch: 0, bank: 0, speed: AIRSPEED, throttle: 0.5 };
    this.bottles = 3; // engine fire extinguisher shots
    this.manualFires = false; // the player is the pilot: fighting engine fires is his job
    this.group.position.copy(this.base);
    this.phase = Math.random() * 100;
    this.props = model ? [1, 2, 3, 4].map((i) => model.getObjectByName(`Prop_${i}`)) : [];
    if (interior) {
      this.interior = new Interior(model);
      this.group.add(this.interior.group);
    }
    this.hp = Object.fromEntries(PARTS.map((p) => [p.name, p.hp]));
    this.engines = ENGINE_X.map(() => ({ state: 'ok', fireT: 0 })); // ok | smoking | dead | fire
    this.tankFire = { '-1': 0, 1: 0 }; // seconds a wing tank has been burning (0 = not burning)
    this.leak = { '-1': 0, 1: 0 }; // seconds of fuel still streaming from a holed tank
    this.fx = []; // things to show next frame: a wing or the tail breaking off, a tank blowing up
    this.spiral = null; // how it falls once it's going down
    this.down = false; // shot down: leaving the formation for good
    this.gone = false; // fallen out of sight
    this.drift = new V(); // a straggler falls back and down
    this.roll = 0;
    this.lost = {}; // parts gone: a wing, the tail, a section broken away
    this.secFire = {}; // fuselage section -> seconds it's been burning
    this.turretOut = {}; // a turret knocked out
    this.dive = false; // going down nose first (tail or cockpit gone) rather than spinning
    this.warned = {};
    this.listeners = [];
  }

  /** 0 (untouched) .. 1 (destroyed) for one part, for the damage diagram. */
  damage(name) { return this.lost[name] ? 1 : 1 - Math.max(0, this.hp[name]) / PART[name].hp; }

  /** Is this gun's turret still working? */
  turretWorks(stationId) { return !this.turretOut[stationId] && !(stationId === 'tail' && this.noTail); } // (the tail gun went with the tail)

  /** Give this bomber a model to draw (a mid-detail one from the pool), or take it away (null). */
  setModel(model) {
    if (this.model) this.group.remove(this.model);
    this.model = model;
    if (model) this.group.add(model);
    this.props = model ? [1, 2, 3, 4].map((i) => model.getObjectByName(`Prop_${i}`)) : [];
    if (model && !this.interior) model.userData.turrets ??= rigTurrets(model);
    if (model) applyMarkings(model, this.ident); // (her own codes and numbers: markings.js)
  }

  /**
   * A bomber seen from outside: its ball and top turrets turn (and the ball tilts) towards where its
   * gunners aim, guns and all. dir: bomber space, or null to search the sky slowly.
   */
  aimTurret(id, dir, dt, t) {
    const r = this.model?.userData.turrets?.[id];
    if (!r) return;
    let yaw, pitch;
    if (dir) { yaw = Math.atan2(-dir.x, -dir.z); pitch = Math.asin(clamp(dir.y, -1, 1)); } else { // (scanning: a slow sweep, different on every bomber)
      yaw = r.yaw0 + Math.sin(t * 0.21 + this.phase * 3) * (id === 'top' ? 2.2 : 1.6);
      pitch = id === 'top' ? 0.25 + Math.sin(t * 0.37 + this.phase) * 0.2 : -0.6 + Math.sin(t * 0.33 + this.phase) * 0.45;
    }
    const k = 1 - Math.exp(-dt * 3);
    r.yaw += wrapA(yaw - r.yaw) * k; r.pitch += (pitch - r.pitch) * k;
    r.yawPart.rotation.y = r.yaw - r.yaw0;
    if (r.full) r.full.quaternion.setFromAxisAngle(_up, r.yaw - r.yaw0).multiply(_q2.setFromAxisAngle(r.elev, r.pitch - r.pitch0));
  }

  /** Called with (message) for things the crew would call out (only used for the player's bomber). */
  onEvent(fn) { this.listeners.push(fn); }
  emit(msg) { for (const fn of this.listeners) fn(msg); }

  /** 0..1: how much of the airframe is left (for the health bar). */
  get health() {
    if (this.down) return 0;
    let have = 0, max = 0;
    for (const p of PARTS) { have += Math.max(0, this.hp[p.name]) / p.hp * (p.kind === 'section' ? 1 : 1.5); max += p.kind === 'section' ? 1 : 1.5; }
    // the parts that bring her down count for more: the weakest wing, the tail, three engines
    const crit = Math.min(...['wingLi', 'wingRi', 'wingLo', 'wingRo', 'tailplane', 'cockpit'].map((n) => Math.max(0, this.hp[n]) / PART[n].hp));
    return Math.max(0, Math.min(have / max, crit * 1.2, 1 - this.deadEngines / 3));
  }

  /** The pilot pulls the fire bottle on engine i. */
  pullBottle(i) {
    const e = this.engines[i];
    if (e?.state !== 'fire') { this.emit(`Engine ${i + 1} isn't burning.`); return; }
    if (this.bottles <= 0) { this.emit('No extinguisher bottles left!'); return; }
    this.bottles--;
    // (it goes out more surely on a feathered engine: no fuel and air being pumped through it)
    if (Math.random() < (e.feathered ? 0.9 : 0.75)) { e.state = 'dead'; this.emit(e.feathered ? `Fire's out on ${i + 1}.` : `Fire's out on ${i + 1}. Feather it!`); }
    else this.emit(`${i + 1} is still burning! (${this.bottles} bottle${this.bottles === 1 ? '' : 's'} left)`);
  }

  /** Feather engine i: the prop's blades turn edge-on to the air and it stops windmilling (and dragging). */
  feather(i) {
    const e = this.engines[i];
    if (!e || e.feathered) return;
    if (e.state === 'ok') { this.emit(`Engine ${i + 1} is running fine.`); return; }
    e.feathered = true;
    if (e.state === 'smoking') e.state = 'dead'; // (shut down before it burns)
    this.emit(`Feathering ${i + 1}.`);
  }

  /**
   * The engine the pilot should deal with first, or null: one on fire, then one dead and windmilling,
   * then one smoking. { i, fire, feather } says what can be done about it.
   */
  get engineTrouble() {
    const rank = (e) => (e.state === 'fire' ? 3 : e.state === 'dead' && !e.feathered ? 2 : e.state === 'smoking' ? 1 : 0);
    let best = -1;
    this.engines.forEach((e, i) => { if (rank(e) > 0 && (best < 0 || rank(e) > rank(this.engines[best]))) best = i; });
    if (best < 0) return null;
    const e = this.engines[best];
    return { i: best, fire: e.state === 'fire', feather: !e.feathered, state: e.state };
  }

  /**
   * Thrust, as a multiple of what holds the formation's speed: each running engine gives cruise power
   * at half throttle and up to 1.6 times that at full; a smoking one three quarters of it; a dead one
   * nothing, and one still windmilling (not feathered) drags. 1 = cruise with all four.
   */
  power(throttle) {
    const p = throttle <= 0.5 ? throttle * 2 : 1 + (throttle - 0.5) * 1.2;
    let sum = 0;
    for (const e of this.engines) sum += e.state === 'ok' ? p : e.state === 'smoking' ? p * 0.75 : e.feathered ? 0 : -0.25;
    return sum / 4;
  }

  /** The throttle the pilot needs to hold the formation's speed (above 1: he can't). */
  get throttleNeeded() {
    let good = 0, drag = 0;
    for (const e of this.engines) { if (e.state === 'ok') good += 1; else if (e.state === 'smoking') good += 0.75; else if (!e.feathered) drag += 0.25; }
    if (good <= 0) return 2;
    const p = (4 + drag) / good;
    return p <= 1 ? p / 2 : 0.5 + (p - 1) / 1.2;
  }

  /** Noticeably shot up: any part below 70% of its strength. */
  get damaged() { return PARTS.some((p) => this.hp[p.name] < p.hp * 0.7); }

  get deadEngines() { return this.engines.filter((e) => e.state === 'dead' || e.state === 'fire').length; }
  get burning() { return this.engines.some((e) => e.state === 'fire') || this.tankFire[-1] > 0 || this.tankFire[1] > 0; }
  /** How likely she is to go down from the damage she already has (0 sound .. 0.9): a burning wing tank
   *  or fuselage, an engine fire, two engines out, falling out of the formation, nobody at the controls. */
  get peril() {
    if (this.down || this.gone) return 0;
    const tank = this.tankFire[-1] > 0 || this.tankFire[1] > 0 || Object.values(this.secFire).some((t) => t > 0);
    return Math.min(0.9, (tank ? 0.7 : 0) + (this.engines.some((e) => e.state === 'fire') ? 0.3 : 0) + (this.deadEngines >= 2 ? 0.4 : 0) + (this.straggling ? 0.3 : 0) + (this.pilotless && !this.flown ? 0.9 : 0));
  }

  /** Flak splinters through engine `i`'s cowling: a cut fuel or oil line, and it's alight then and there. */
  igniteEngine(i) {
    const e = this.engines[i];
    if (this.down || !e || e.state === 'fire' || e.state === 'dead') return false;
    e.state = 'fire';
    e.fireT = 0;
    e.feathered = !this.manualFires;
    e.fireLimit = rand(6, 12);
    this.emit(`Engine ${i + 1} on fire!`);
    return true;
  }

  /** A round hit `part` (from PARTS). Returns the part so the crew can work out who was hurt. */
  hit(part, cannon) {
    if (this.down || this.lost[part.name]) return part;
    const dmg = cannon ? 3 : 1;
    const hp = (this.hp[part.name] -= dmg), frac = hp / part.hp;
    const once = (key, msg) => { if (!this.warned[key]) { this.warned[key] = true; this.emit(msg); } };
    const sideName = part.side < 0 ? 'left' : 'right';
    if (part.kind === 'engine') {
      const e = this.engines[part.engine];
      if (e.state === 'ok' && frac < 0.6) { e.state = 'smoking'; this.emit(`Engine ${part.engine + 1} is smoking!`); }
      if ((e.state === 'ok' || e.state === 'smoking') && hp <= 0) {
        e.state = Math.random() < 0.4 ? 'fire' : 'dead';
        e.fireT = 0;
        e.feathered = !this.manualFires; // (the AI pilots feather at once; you have to do it yourself)
        e.fireLimit = rand(6, 12); // how long before it either goes out or spreads
        this.emit(e.state === 'fire' ? `Engine ${part.engine + 1} on fire!` : `Engine ${part.engine + 1} is out, feathering ${part.engine + 1}!`);
      }
    } else if (part.kind === 'wing' && part.inner) {
      // the tanks: self-sealing, each hit leaks a little, and may set the fuel alight (the worse the wing, the likelier)
      this.leak[part.side] = Math.max(this.leak[part.side], cannon ? 30 : 12); // holed: fuel streams out
      if (this.tankFire[part.side] === 0 && (frac < 0.3 || Math.random() < (cannon ? 0.06 : 0.01))) {
        this.tankFire[part.side] = 0.001;
        this.emit(`Fire in the ${sideName} wing!`);
      }
      if (frac < 0.4) once(part.name, `The ${sideName} wing root's badly shot up!`);
      if (hp <= 0) this.loseWing(part.side, true, `The ${sideName} wing has broken off!`);
    } else if (part.kind === 'wing') {
      if (frac < 0.4) once(part.name, `The ${sideName} wingtip's shot to pieces!`);
      if (hp <= 0) this.loseWing(part.side, false, `The ${sideName} wing is folding up!`);
    } else if (part.kind === 'tail') {
      if (frac < 0.5) once('tail', 'The tail is shot up, she\'s sluggish on the controls!');
      if (hp <= 0) {
        this.lost.tailplane = true;
        this.fx.push({ type: 'tail' });
        this.dive = true; this.noTail = true; // (with no tail she can't be held: the nose goes straight down)
        this.goDown('The tail\'s been shot off!');
      }
    } else if (part.kind === 'turret') {
      if (hp <= 0 && !this.turretOut[part.turret]) {
        this.turretOut[part.turret] = true;
        this.emit(`The ${part.turret === 'ball' ? 'ball' : 'top'} turret's knocked out!`);
      }
    } else if (part.kind === 'section') {
      const sec = part.section;
      if ((sec === 'cockpit' || sec === 'nose') && hp <= 0) { this.dive = true; this.goDown(sec === 'cockpit' ? 'The pilots are hit!' : 'The nose is shot away!'); }
      // a hit through the oxygen, the hydraulics or the flares can start a fire in there
      if (FUSELAGE.includes(sec) && !this.secFire[sec] && frac < 0.55 && Math.random() < (cannon ? 0.18 : 0.04)) {
        this.secFire[sec] = 0.001;
        this.secFireLimit = rand(25, 50);
        this.emit(`Fire in ${NAMES[sec]}!`);
      }
      if (FUSELAGE.includes(sec) && hp <= 0) { if (sec === 'tail' || sec === 'waist') this.noTail = true; this.breakUp(sec); }
    }
    if (this.deadEngines >= 3) this.goDown('Three engines out, we can\'t hold her!');
    return part;
  }

  /** A wing breaks: the outer panel folds up, or the whole wing goes at the root. She rolls over and spins in. */
  loseWing(side, root, msg) {
    if (this.down) return;
    const s = side < 0 ? 'L' : 'R';
    this.lost[`wing${s}o`] = true;
    if (root) this.lost[`wing${s}i`] = true;
    this.fx.push({ type: 'wing', side, x: root ? 6 : 12 });
    this.spiral = { r: root ? 18 : 30, w: root ? 1.0 : 0.7, side };
    this.goDown(msg);
  }

  /** The fuselage fails at `sec` (fire or shell damage): she breaks in two and falls in pieces. */
  breakUp(sec) {
    if (this.down) return;
    this.lost[sec] = true;
    const [, z0, z1] = SECTIONS.find(([n]) => n === sec);
    this.fx.push({ type: 'breakup', z: (z0 + z1) / 2 });
    this.dive = true;
    this.goDown('She\'s breaking up!');
  }

  goDown(reason) {
    if (this.down) return;
    this.down = true;
    this.downT = 0;
    this.roll = 0;
    this.rollRate = this.spiral ? this.spiral.side * -rand(0.5, 0.9) : rand(0.05, 0.25) * (Math.random() < 0.5 ? -1 : 1);
    this.chutes = Math.floor(rand(0, 10.99)); // how many of the crew get out
    this.emit(reason);
    this.emit('Bail out! Bail out!');
  }

  /** Engine fires, burning tanks and fuselage, stragglers falling back, and the final fall. */
  updateDamage(dt, effects) {
    if (this.gone) return;
    const m = this.group.matrixWorld, vel = _vel.set(0, 0, AIRSPEED * 0.15).add(this.drift); // trails stream back
    this.engines.forEach((e, i) => {
      if (e.state === 'ok') return;
      if (!this.manualFires && e.state !== 'smoking') e.feathered = true; // (an AI pilot at the controls feathers it)
      const at = _at.set(ENGINE_X[i], -0.6, -4.2).applyMatrix4(m);
      if (e.state === 'smoking') effects?.trail(at, vel, 'smoke', dt);
      if (e.state === 'dead') effects?.trail(at, vel, 'black', dt * 0.5);
      if (e.state === 'fire') {
        // flames out of the cowling's gills and over the nacelle, streaming back, under thick black smoke
        effects?.trail(at, vel, 'fire', dt);
        effects?.trail(_at.set(ENGINE_X[i], -0.15, -5.4).applyMatrix4(m), vel, 'fire', dt * 0.7);
        effects?.trail(_at.set(ENGINE_X[i], -0.3, -3.2).applyMatrix4(m), vel, 'black', dt * 0.8);
        // the pilot pulls the fire bottle: often it goes out, sometimes it spreads to the wing tank.
        // When the player is the pilot that's his job (1-4), and a fire left alone spreads.
        e.fireT += dt;
        if (this.manualFires) {
          if (e.fireT > (e.feathered ? 32 : 20)) { // (feathered, it burns slower)
            e.state = 'dead';
            const side = i < 2 ? -1 : 1;
            if (!this.tankFire[side]) { this.tankFire[side] = 0.001; this.emit(`The fire's spreading into the ${side < 0 ? 'left' : 'right'} wing!`); }
          }
        } else if (e.fireT > (e.fireLimit ?? 8)) {
          if (Math.random() < 0.55) { e.state = 'dead'; this.emit(`Fire's out on ${i + 1}.`); } else {
            e.state = 'dead';
            const side = i < 2 ? -1 : 1;
            if (!this.tankFire[side]) { this.tankFire[side] = 0.001; this.emit(`The fire's spreading into the ${side < 0 ? 'left' : 'right'} wing!`); }
          }
        }
      }
    });
    for (const side of [-1, 1]) {
      if (!this.tankFire[side]) continue;
      this.tankFire[side] += dt;
      effects?.trail(_at.set(side * 5.5, -0.8, -4.5).applyMatrix4(m), vel, 'fire', dt);
      if (this.tankFire[side] > 25 && !this.down) { // the fire reaches the main tank: it blows, and the wing goes
        this.fx.push({ type: 'blowup', side }, { type: 'wing', side });
        this.spiral = { r: 30, w: 0.7, side };
        this.goDown('The wing\'s burning through!');
      }
    }
    // fires in the fuselage: they eat at the section until the crew get them out, or she breaks up
    for (const sec of FUSELAGE) {
      if (!this.secFire[sec] || this.down) continue;
      this.secFire[sec] += dt;
      this.hp[sec] -= dt * 0.8;
      const [, z0, z1] = SECTIONS.find(([n]) => n === sec), z = (z0 + z1) / 2;
      // out through the windows and holes, seen from other planes (not from inside her or close by: its
      // big flames, through the open waist windows, would white out the view; inside it's cabinFire)
      const near = effects?.camPos && this.group.position.distanceToSquared(effects.camPos) < 225;
      if (!near) effects?.trail(_at.set(Math.random() < 0.5 ? -1.7 : 1.7, -0.9, z).applyMatrix4(m), vel, 'fire', dt * 0.5);
      if (this.interior && effects) this.cabinFire(sec, z0, z1, effects, dt);
      if (this.hp[sec] <= 0) this.breakUp(sec);
      else if (this.secFire[sec] > (this.secFireLimit ?? 40) && this.hp[sec] > PART[sec].hp * 0.25) { // put out
        this.secFire[sec] = 0;
        this.emit(`The fire in ${NAMES[sec]} is out.`);
      }
    }
    for (const side of [-1, 1]) { // fuel streaming from a holed tank
      if (this.leak[side] > 0 && !this.tankFire[side]) {
        this.leak[side] -= dt;
        effects?.trail(_at.set(side * 6.5, -0.7, -4.0).applyMatrix4(m), vel, 'fuel', dt);
      }
    }
    // the moments it breaks up: pieces fly off, a tank goes up in a fireball
    while (this.fx.length && effects) {
      const e = this.fx.shift();
      _q.setFromRotationMatrix(m);
      // the part itself leaves (breakup.js), with smaller wreckage flying off the tear
      if (e.type === 'wing') { this.onBreak?.(e.x === 6 ? 'wingi' : 'wingo', e.side, 0, vel); effects.wreck(_at.set(e.side * (e.x ?? 12), -0.8, -4.3).applyMatrix4(m), vel, 3, _w.set(1.4, 0.2, 0.9), 0.5, _q); }
      if (e.type === 'tail') { this.onBreak?.('tail', 0, 0, vel); effects.wreck(_at.set(0, 0.6, 7).applyMatrix4(m), vel, 3, _w.set(1.2, 0.2, 0.8), 0.2, _q); }
      if (e.type === 'blowup') effects.explosion(_at.set(e.side * 5.5, -0.8, -4.5).applyMatrix4(m).clone(), vel.clone(), 3);
      if (e.type === 'breakup') {
        effects.explosion(_at.set(0, 0, e.z).applyMatrix4(m).clone(), vel.clone(), 2.5);
        effects.wreck(_at.set(0, 0, e.z).applyMatrix4(m), vel, 4, _w.set(1.2, 0.8, 1.2), 0.6, _q);
        this.onBreak?.('fuselage', 0, Math.max(e.z, -1.2), vel); // (forward of the wing's trailing edge she parts behind it)
      }
    }
    // stragglers: the AI pilot opens up the good engines to hold the formation's speed; when even full
    // throttle won't do it (two engines out), she drops back, and sinks. (You at the controls set your
    // own throttle: see fly.)
    const n = this.deadEngines, short = this.manualFires ? 0 : Math.max(0, 1 - this.power(1)) * SPEED_PER_POWER;
    this.drift.set(0, n >= 2 ? -1.5 : 0, short);
    if (this.aborting) this.drift.copy(this.aborting); // (turned back: out of the box, down and away home: main.js)
    if (!this.down && !this.aborting && this.drift.z > 0 && this.base.z - this.slot0.z > STRAG_BACK) this.drift.z = 0; // (an abort goes on back: main.js) // (fallen back behind her group as far as she will: she hangs on there)
    this.stragT = this.straggling && !this.down ? (this.stragT ?? 0) + dt : 0;
    if (this.pilotless && !this.flown && !this.down) { // nobody at the controls: a long, slow, wandering glide down and out of the box
      this.pilotlessT = (this.pilotlessT ?? 0) + dt;
      this.drift.set(Math.sin(this.pilotlessT * 0.05) * 3, -Math.min(9, 1 + this.pilotlessT * 0.15), Math.min(18, 3 + this.pilotlessT * 0.3));
      this.roll = Math.sin(this.pilotlessT * 0.12) * 0.25;
      if (this.pilotlessT > 150) this.goDown('Nobody at the controls: she\'s going in!');
    }
    if (!this.manualFires) this.flight.throttle = Math.min(1, this.throttleNeeded);
    if (this.down) {
      this.downT += dt;
      // falling in a spiral: round and round as it goes down (tight and fast with a wing gone)
      const sp = (this.spiral ??= { r: rand(15, 40), w: rand(0.2, 0.45), side: Math.random() < 0.5 ? -1 : 1 });
      const a = this.downT * sp.w * sp.side, v = sp.r * sp.w * Math.min(1, this.downT / 4);
      this.drift.set(Math.cos(a) * v * (this.dive ? 0.4 : 1), -Math.min(this.dive ? 80 : 45, (this.noTail ? 12 : 4) + this.downT * (this.noTail ? 14 : this.dive ? 5 : 2.5)), 22 + Math.sin(a) * v);
      this.roll += this.rollRate * dt * (1 + this.downT * 0.08);
      if (this.chutes > 0 && this.downT > 3 && Math.random() < dt * 0.8) {
        this.chutes--;
        effects?.parachute(new V(rand(-1, 1), -2.5, rand(-2, 6)).applyMatrix4(m));
      }
      if (this.downT > 6 && Math.random() < dt * 0.05) effects?.explosion(this.group.position.clone(), new V(), 2);
      if (this.base.y < -3000) {
        this.gone = true;
        this.group.visible = false;
      }
    }
    this.base.addScaledVector(this.drift, dt);
    this.home.addScaledVector(this.drift, dt);
  }

  /**
   * Flames and smoke inside a burning section of the bomber you're in (so you see it from inside; the
   * crew and you get burnt standing in it, see Crew). Few particles: the pools are shared with the battle.
   */
  cabinFire(sec, z0, z1, effects, dt) {
    const deck = { bombbay: -1.62, radio: -1.8, waist: -1.95, tail: -2.15 }[sec];
    // (dim, small flames: full-strength fire particles a metre from your eye would white out the screen;
    // drag 0: in the still air of the cabin they mustn't be blown back with the airstream outside)
    // a few seats of fire in the section (on the floor, against the walls), each a tight cluster of flames
    const spots = ((this.fireSpots ??= {})[sec] ??= [0, 1, 2].map(() => [rand(-0.55, 0.55), rand(z0 + 0.4, z1 - 0.4)]));
    const m = this.group.matrixWorld, n = Math.floor(dt * 110 + Math.random());
    for (let i = 0; i < n; i++) {
      const [sx, sz] = spots[i % spots.length];
      const p = _at.set(sx + rand(-0.14, 0.14), deck + rand(0, 0.2), sz + rand(-0.14, 0.14)).applyMatrix4(m);
      effects.fire.emit(p, _w.set(rand(-0.1, 0.1), rand(0.7, 1.5), rand(-0.1, 0.1)), { life: rand(0.25, 0.5), s0: 0.2, s1: 0.04, c0: [5, 2, 0.5], c1: [1.2, 0.35, 0.08], drag: 0 });
      if (Math.random() < 0.3) effects.smoke.emit(p, _w.set(rand(-0.12, 0.12), rand(0.3, 0.55), rand(-0.12, 0.12)), { life: rand(2, 3.5), s0: 0.3, s1: 1.5, a0: 0.6, c0: [0.05, 0.045, 0.04], c1: [0.16, 0.15, 0.14], drag: 0 });
    }
  }

  /**
   * Out of the box: flown away from it (the player at the controls), or dropped back and down, crippled.
   * Alone, without the box's massed guns round her, she's what the fighters look for.
   */
  get straggling() { return !this.down && !this.gone && this.base.distanceToSquared(this.slot0) > STRAGGLE * STRAGGLE; }

  /** Off its slot or course: the autopilot has work to do. */
  get offStation() { const f = this.flight; return f.heading !== 0 || f.pitch !== 0 || f.bank !== 0 || this.base.distanceToSquared(this.home) > 0.01; }

  /**
   * Fly the bomber for one frame. `input` = the player at the controls { aimYaw, aimPitch, throttle, roll },
   * or null: the autopilot (the AI pilot) brings her back to her slot in the formation.
   */
  fly(dt, input) {
    const f = this.flight;
    if (this.down || this.gone || dt <= 0) return;
    let heading, pitch, speed;
    if (input) {
      heading = input.aimYaw; pitch = input.aimPitch;
      f.throttle = input.throttle;
      speed = AIRSPEED + (this.power(f.throttle) - 1) * SPEED_PER_POWER;
    } else {
      if (!this.offStation) return;
      // steer for the slot: close the gap at up to 12 m/s relative to the formation
      _d.subVectors(this.home, this.base);
      const dist = _d.length();
      if (dist < 0.5 && Math.abs(f.heading) < 0.005 && Math.abs(f.bank) < 0.005 && Math.abs(f.pitch) < 0.005) {
        f.heading = f.pitch = f.bank = 0; f.speed = AIRSPEED; this.base.copy(this.home);
        return;
      }
      _d.multiplyScalar(Math.min(0.12, 12 / Math.max(dist, 1e-3)));
      _d.z -= AIRSPEED; // through the air the formation flies towards -Z
      heading = Math.atan2(-_d.x, -_d.z);
      pitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
      speed = _d.length();
      f.throttle = Math.min(1, this.throttleNeeded);
    }
    // a shot-up tail: she wanders and answers the controls slowly; damaged engines give less power
    const tail = this.lost.tailplane ? 0 : Math.max(0, this.hp.tailplane) / PART.tailplane.hp;
    if (tail < 0.7) {
      const wander = (0.7 - tail) * 0.06;
      heading += Math.sin(this.phase + performance.now() * 0.0007) * wander;
      pitch += Math.sin(this.phase * 1.7 + performance.now() * 0.0011) * wander * 0.5;
    }
    // a heavy bomber: banks to turn, rolls slowly, and the bank angle sets the rate of turn
    const err = wrapA(heading - f.heading);
    const bankT = input?.roll ? input.roll * MAX_BANK : clamp(err * 2.5, -MAX_BANK, MAX_BANK);
    f.bank += (bankT - f.bank) * (1 - Math.exp(-dt * 1.1 * (0.35 + 0.65 * Math.min(1, tail / 0.7))));
    if (this.knock?.t > 0) { // knocked by another B-17: the nose swung and a wing thrown up, fading as you get her back
      const kn = this.knock, k = (kn.t -= dt) / kn.T;
      f.bank += kn.roll * k * Math.sin(kn.t * 5) * dt * 3;
      f.heading = wrapA(f.heading + kn.yaw * k * dt);
    }
    f.heading = wrapA(f.heading + (9.81 * Math.tan(f.bank) / Math.max(f.speed, 30)) * dt);
    f.pitch += (clamp(pitch, -0.22, 0.16) - f.pitch) * (1 - Math.exp(-dt * 0.9));
    speed -= Math.sin(f.pitch) * 25; // climbing costs speed, diving gains it
    f.speed += (clamp(speed, 45, 115) - f.speed) * (1 - Math.exp(-dt * (input ? 0.15 : 0.6)));
    // move relative to the formation, which flies -Z at AIRSPEED while the world scrolls past
    const cp = Math.cos(f.pitch);
    this.base.x -= Math.sin(f.heading) * cp * f.speed * dt;
    this.base.y += Math.sin(f.pitch) * f.speed * dt;
    this.base.z += (AIRSPEED - Math.cos(f.heading) * cp * f.speed) * dt;
  }

  update(t, dt) {
    // the props: running, windmilling (a dead engine not yet feathered turns over slowly in the
    // airstream), or feathered: stopped, the blades turned edge-on
    for (const [i, p] of this.props.entries()) {
      if (!p) continue;
      const e = this.engines[i], u = p.userData, want = e.state === 'ok' || e.state === 'smoking' ? 31 + i * 0.4 : e.feathered ? 0 : 8;
      u.spin = u.spin == null ? want : u.spin + (want - u.spin) * (1 - Math.exp(-dt * 0.8));
      p.rotation.z += dt * u.spin;
      // up to speed, the blades give way to the blur disc (PropBlur draws it, turning a little slower than
      // the prop, so the ghosts are seen to go round, as a film camera catches them); windmilling or
      // stopped, the blades
      const blur = u.spin > 18;
      if (blur) u.discA = ((u.discA ?? 0) - dt * u.spin * 0.8) % (Math.PI * 2);
      if (u.blurred !== blur) { u.blurred = blur; for (const m of p.children) if (m.isMesh) m.visible = !blur; }
      const f = e.feathered && e.state !== 'ok' ? 1 : 0;
      u.feather = (u.feather ?? f) + Math.sign(f - (u.feather ?? f)) * Math.min(Math.abs(f - (u.feather ?? f)), dt / 3); // (takes a few seconds)
      if (u.feather !== u.shown) featherBlades(p, u.feather);
    }
    const s = t + this.phase;
    // slow swells plus a little turbulence; small enough to walk around comfortably
    const turb = Math.sin(s * 2.3) * Math.sin(s * 1.7);
    // and each pilot keeping station by hand: never exactly in his slot, always correcting, a few metres
    // out and back over half a minute or a minute, each in his own time (in your own bomber only a hint
    // of it: the formation is seen from her). His corrections across show as a little bank.
    const keep = this.interior ? 0.1 : 1, w = this.keepW ??= [0.09 + 0.07 * Math.random(), 0.11 + 0.08 * Math.random(), 0.07 + 0.06 * Math.random()];
    const sx = Math.sin(s * w[0]) * 4 + Math.sin(s * w[0] * 2.7) * 1.2, sy = Math.sin(s * w[1] + 1.3) * 2.5, sz = Math.sin(s * w[2] + 2.1) * 6;
    this.group.position.set(this.base.x + Math.sin(s * 0.21) * 0.4 + sx * keep, this.base.y + Math.sin(s * 0.37) * 0.25 + turb * 0.04 + sy * keep, this.base.z + sz * keep);
    const slip = (Math.cos(s * w[0]) * 4 * w[0] + Math.cos(s * w[0] * 2.7) * 1.2 * w[0] * 2.7) * keep; // (m/s across: banked into it)
    _rock.set(
      Math.sin(s * 0.29) * 0.008 + turb * 0.0015 - (this.down ? Math.min(this.noTail ? 1.35 : this.dive ? 1.1 : 0.35, this.downT * (this.noTail ? 0.7 : this.dive ? 0.09 : 0.02)) : 0),
      Math.sin(s * 0.13) * 0.004 + (this.down && this.spiral ? this.downT * this.spiral.w * this.spiral.side * Math.min(1, this.downT / 4) : 0),
      Math.sin(s * 0.23) * 0.018 + Math.sin(s * 0.9) * 0.002 - slip * 0.05 - (this.down ? 0 : FORMATION.bank) + this.roll + (this.deadEngines ? (this.engines[0].state !== 'ok' || this.engines[1].state !== 'ok' ? 0.02 : -0.02) : 0),
    );
    const f = this.flight;
    if (f.heading || f.pitch || f.bank) { // flown off the formation's course: heading, then pitch, then bank
      _q.setFromEuler(_fe.set(f.pitch, f.heading, f.bank, 'YXZ'));
      this.group.quaternion.multiplyQuaternions(_q, _q2.setFromEuler(_rock));
    } else this.group.rotation.copy(_rock);
  }
}
