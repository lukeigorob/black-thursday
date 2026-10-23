// A B-17 in the formation: the model, spinning props, the gentle rocking of a heavy bomber,
// and battle damage, part by part: each engine, the inner wings (with their fuel tanks) and the outer
// wings either side, the tail, the turrets, and the fuselage section by section. Each part fails in
// its own way: engines smoke, burn or stop; wings leak fuel, burn and break off; a shot-up tail makes
// her sloppy to fly, then goes; fires in the fuselage grow until she breaks up.
// Everything inside (interior, player) is a child of `group`, so it moves and rocks with the plane.
import * as THREE from 'three';
import { Interior } from './interior.js';

export const AIRSPEED = 75; // m/s: 270 km/h (~170 mph), a loaded B-17's cruise at altitude
const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const MAX_BANK = 0.6; // rad (~35 degrees): a loaded B-17 turns gently
const clamp = THREE.MathUtils.clamp, wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _vel = new V(), _at = new V(), _w = new V(), _d = new V(), _rock = new THREE.Euler(), _fe = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export const ENGINE_X = [-7.16, -3.93, 3.94, 7.15]; // engines 1-4, numbered left to right as the pilot sees them
export const SECTIONS = [['nose', -11.4, -8.6], ['cockpit', -8.6, -6.35], ['bombbay', -6.35, -2.6], ['radio', -2.6, -1.25], ['waist', -1.25, 5.2], ['tail', 5.2, 11.4]];

// hit boxes in bomber space [x0, x1, y0, y1, z0, z1] (nose -Z), from the model's measurements
export const PARTS = [
  // a B-17 could take a lot: hit points are rounds of .30/.50 (a 20 mm shell counts 3)
  ...ENGINE_X.map((x, i) => ({ name: `engine${i + 1}`, kind: 'engine', engine: i, box: [x - 0.85, x + 0.85, -1.45, 0.3, -8.8, -3.3], hp: 32 })),
  // the inner wings carry the fuel tanks round the engines; the outer wings, the tips
  { name: 'wingLi', kind: 'wing', side: -1, inner: true, box: [-8.0, -1.25, -1.5, -0.1, -7.3, -1.3], hp: 70 },
  { name: 'wingRi', kind: 'wing', side: 1, inner: true, box: [1.25, 8.0, -1.5, -0.1, -7.3, -1.3], hp: 70 },
  { name: 'wingLo', kind: 'wing', side: -1, box: [-16.3, -8.0, -1.5, -0.1, -7.3, -1.3], hp: 80 },
  { name: 'wingRo', kind: 'wing', side: 1, box: [8.0, 16.3, -1.5, -0.1, -7.3, -1.3], hp: 80 },
  { name: 'tailplane', kind: 'tail', box: [-6.5, 6.5, -2.2, 3.2, 6.0, 10.5], hp: 45 },
  { name: 'ball', kind: 'turret', turret: 'ball', box: [-0.55, 0.55, -2.95, -1.95, -0.75, 0.5], hp: 22 },
  { name: 'top', kind: 'turret', turret: 'top', box: [-0.62, 0.62, 1.0, 1.75, -7.35, -6.05], hp: 22 },
  ...SECTIONS.map(([name, z0, z1]) => ({ name, kind: 'section', section: name, box: [-1.25, 1.25, -2.45, 1.8, z0, z1], hp: 60 })),
];

// everything that makes a bomber "that bomber" (where it flies, its damage), but not how it's drawn
const STATE = ['base', 'home', 'flight', 'bottles', 'leak', 'fx', 'spiral', 'phase', 'label', 'squad', 'lead', 'bombs', 'dropping', 'hp', 'engines', 'tankFire', 'down', 'gone', 'drift', 'roll', 'rollRate', 'downT', 'chutes',
  'lost', 'secFire', 'secFireLimit', 'turretOut', 'dive', 'warned'];
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
    for (const p of x.props) if (p) p.userData.stopped = false;
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
  turretWorks(stationId) { return !this.turretOut[stationId]; }

  /** Give this bomber a model to draw (a mid-detail one from the pool), or take it away (null). */
  setModel(model) {
    if (this.model) this.group.remove(this.model);
    this.model = model;
    if (model) this.group.add(model);
    this.props = model ? [1, 2, 3, 4].map((i) => model.getObjectByName(`Prop_${i}`)) : [];
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
    if (Math.random() < 0.8) { e.state = 'dead'; this.emit(`Fire's out on ${i + 1}, feathering ${i + 1}.`); }
    else this.emit(`${i + 1} is still burning! (${this.bottles} bottle${this.bottles === 1 ? '' : 's'} left)`);
  }

  /** Noticeably shot up: any part below 70% of its strength. */
  get damaged() { return PARTS.some((p) => this.hp[p.name] < p.hp * 0.7); }

  get deadEngines() { return this.engines.filter((e) => e.state === 'dead' || e.state === 'fire').length; }
  get burning() { return this.engines.some((e) => e.state === 'fire') || this.tankFire[-1] > 0 || this.tankFire[1] > 0; }

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
        this.dive = true;
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
      if (FUSELAGE.includes(sec) && hp <= 0) this.breakUp(sec);
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
      if (this.props[i]) this.props[i].userData.stopped = e.state === 'dead' || e.state === 'fire';
      if (e.state === 'ok') return;
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
          if (e.fireT > 20) {
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
      if (e.type === 'wing') effects.wreck(_at.set(e.side * (e.x ?? 12), -0.8, -4.3).applyMatrix4(m), vel, 5, _w.set(4, 0.35, 2.2), 0.5, _q);
      if (e.type === 'tail') effects.wreck(_at.set(0, 0.6, 9).applyMatrix4(m), vel, 4, _w.set(3, 0.3, 1.6), 0.2, _q);
      if (e.type === 'blowup') effects.explosion(_at.set(e.side * 5.5, -0.8, -4.5).applyMatrix4(m).clone(), vel.clone(), 3);
      if (e.type === 'breakup') {
        effects.explosion(_at.set(0, 0, e.z).applyMatrix4(m).clone(), vel.clone(), 2.5);
        effects.wreck(_at.set(0, 0, e.z).applyMatrix4(m), vel, 7, _w.set(2.2, 1.6, 2.5), 0.6, _q);
      }
    }
    // stragglers: each engine out costs speed and height, so the bomber falls out of the box
    const n = this.deadEngines;
    this.drift.set(0, n >= 2 ? -2 : 0, [0, 1.5, 4, 8, 8][n]);
    if (this.down) {
      this.downT += dt;
      // falling in a spiral: round and round as it goes down (tight and fast with a wing gone)
      const sp = (this.spiral ??= { r: rand(15, 40), w: rand(0.2, 0.45), side: Math.random() < 0.5 ? -1 : 1 });
      const a = this.downT * sp.w * sp.side, v = sp.r * sp.w * Math.min(1, this.downT / 4);
      this.drift.set(Math.cos(a) * v * (this.dive ? 0.4 : 1), -Math.min(this.dive ? 75 : 45, 4 + this.downT * (this.dive ? 5 : 2.5)), 22 + Math.sin(a) * v);
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
      speed = 50 + f.throttle * 45 - this.deadEngines * 7;
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
      f.throttle = 0.5;
    }
    // a shot-up tail: she wanders and answers the controls slowly; damaged engines give less power
    const tail = this.lost.tailplane ? 0 : Math.max(0, this.hp.tailplane) / PART.tailplane.hp;
    if (tail < 0.7) {
      const wander = (0.7 - tail) * 0.06;
      heading += Math.sin(this.phase + performance.now() * 0.0007) * wander;
      pitch += Math.sin(this.phase * 1.7 + performance.now() * 0.0011) * wander * 0.5;
    }
    speed -= this.engines.filter((e) => e.state === 'smoking').length * 3;
    // a heavy bomber: banks to turn, rolls slowly, and the bank angle sets the rate of turn
    const err = wrapA(heading - f.heading);
    const bankT = input?.roll ? input.roll * MAX_BANK : clamp(err * 2.5, -MAX_BANK, MAX_BANK);
    f.bank += (bankT - f.bank) * (1 - Math.exp(-dt * 1.1 * (0.35 + 0.65 * Math.min(1, tail / 0.7))));
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
    for (const [i, p] of this.props.entries()) if (p && !p.userData.stopped) p.rotation.z += dt * (31 + i * 0.4);
    const s = t + this.phase;
    // slow swells plus a little turbulence; small enough to walk around comfortably
    const turb = Math.sin(s * 2.3) * Math.sin(s * 1.7);
    this.group.position.set(this.base.x + Math.sin(s * 0.21) * 0.4, this.base.y + Math.sin(s * 0.37) * 0.25 + turb * 0.04, this.base.z);
    _rock.set(
      Math.sin(s * 0.29) * 0.008 + turb * 0.0015 - (this.down ? Math.min(this.dive ? 1.1 : 0.35, this.downT * (this.dive ? 0.09 : 0.02)) : 0),
      Math.sin(s * 0.13) * 0.004 + (this.down && this.spiral ? this.downT * this.spiral.w * this.spiral.side * Math.min(1, this.downT / 4) : 0),
      Math.sin(s * 0.23) * 0.018 + Math.sin(s * 0.9) * 0.002 + this.roll + (this.deadEngines ? (this.engines[0].state !== 'ok' || this.engines[1].state !== 'ok' ? 0.02 : -0.02) : 0),
    );
    const f = this.flight;
    if (f.heading || f.pitch || f.bank) { // flown off the formation's course: heading, then pitch, then bank
      _q.setFromEuler(_fe.set(f.pitch, f.heading, f.bank, 'YXZ'));
      this.group.quaternion.multiplyQuaternions(_q, _q2.setFromEuler(_rock));
    } else this.group.rotation.copy(_rock);
  }
}
