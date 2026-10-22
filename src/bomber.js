// A B-17 in the formation: the model, spinning props, the gentle rocking of a heavy bomber,
// and battle damage (engines, fuel tanks, wings, tail and fuselage sections).
// Everything inside (interior, player) is a child of `group`, so it moves and rocks with the plane.
import * as THREE from 'three';
import { Interior } from './interior.js';

export const AIRSPEED = 72; // m/s, ~160 mph cruise
const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const MAX_BANK = 0.6; // rad (~35 degrees): a loaded B-17 turns gently
const clamp = THREE.MathUtils.clamp, wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _vel = new V(), _at = new V(), _d = new V(), _rock = new THREE.Euler(), _fe = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export const ENGINE_X = [-7.16, -3.93, 3.94, 7.15]; // engines 1-4, numbered left to right as the pilot sees them
export const SECTIONS = [['nose', -11.4, -8.6], ['cockpit', -8.6, -6.35], ['bombbay', -6.35, -2.6], ['radio', -2.6, -1.25], ['waist', -1.25, 5.2], ['tail', 5.2, 11.4]];

// hit boxes in bomber space [x0, x1, y0, y1, z0, z1] (nose -Z), from the model's measurements
export const PARTS = [
  ...ENGINE_X.map((x, i) => ({ name: `engine${i + 1}`, kind: 'engine', engine: i, box: [x - 0.85, x + 0.85, -1.45, 0.3, -8.8, -3.3], hp: 22 })),
  { name: 'tankL', kind: 'tank', side: -1, box: [-8.0, -1.25, -1.35, -0.25, -6.8, -2.6], hp: 20 }, // wing tanks round the engines
  { name: 'tankR', kind: 'tank', side: 1, box: [1.25, 8.0, -1.35, -0.25, -6.8, -2.6], hp: 20 },
  { name: 'wingL', kind: 'wing', side: -1, box: [-16.3, -8.0, -1.5, -0.1, -7.3, -1.3], hp: 70 },
  { name: 'wingR', kind: 'wing', side: 1, box: [8.0, 16.3, -1.5, -0.1, -7.3, -1.3], hp: 70 },
  { name: 'tailplane', kind: 'tail', box: [-6.5, 6.5, -2.2, 3.2, 6.0, 10.5], hp: 45 },
  ...SECTIONS.map(([name, z0, z1]) => ({ name, kind: 'section', section: name, box: [-1.25, 1.25, -2.45, 1.8, z0, z1], hp: 60 })),
];

// everything that makes a bomber "that bomber" (where it flies, its damage), but not how it's drawn
const STATE = ['base', 'home', 'flight', 'bottles', 'phase', 'label', 'squad', 'lead', 'bombs', 'dropping', 'hp', 'engines', 'tankFire', 'down', 'gone', 'drift', 'roll', 'rollRate', 'downT', 'chutes'];

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
    this.down = false; // shot down: leaving the formation for good
    this.gone = false; // fallen out of sight
    this.drift = new V(); // a straggler falls back and down
    this.roll = 0;
    this.listeners = [];
  }

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
    const crit = Math.min(...['wingL', 'wingR', 'tailplane', 'cockpit'].map((n) => Math.max(0, this.hp[n]) / PARTS.find((p) => p.name === n).hp));
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
    if (this.down) return part;
    const dmg = cannon ? 3 : 1;
    const hp = (this.hp[part.name] -= dmg);
    if (part.kind === 'engine') {
      const e = this.engines[part.engine];
      if (e.state === 'ok' && hp < part.hp * 0.6) { e.state = 'smoking'; this.emit(`Engine ${part.engine + 1} is smoking!`); }
      if ((e.state === 'ok' || e.state === 'smoking') && hp <= 0) {
        e.state = Math.random() < 0.4 ? 'fire' : 'dead';
        e.fireT = 0;
        e.fireLimit = rand(6, 12); // how long before it either goes out or spreads
        this.emit(e.state === 'fire' ? `Engine ${part.engine + 1} on fire!` : `Engine ${part.engine + 1} is out, feathering ${part.engine + 1}!`);
      }
    } else if (part.kind === 'tank') {
      // self-sealing tanks: each hit leaks a little, and may set the fuel alight
      if (this.tankFire[part.side] === 0 && (hp <= 0 || Math.random() < (cannon ? 0.15 : 0.03))) {
        this.tankFire[part.side] = 0.001;
        this.emit(`Fire in the ${part.side < 0 ? 'left' : 'right'} wing!`);
      }
    } else if (part.kind === 'wing' && hp <= 0) this.goDown(`The ${part.side < 0 ? 'left' : 'right'} wing is coming apart!`);
    else if (part.kind === 'tail' && hp <= 0) this.goDown('We lost the tail controls!');
    else if (part.section === 'cockpit' && hp <= 0) this.goDown('The cockpit is hit!');
    if (this.deadEngines >= 3) this.goDown('Three engines out, we can\'t hold her!');
    return part;
  }

  goDown(reason) {
    if (this.down) return;
    this.down = true;
    this.downT = 0;
    this.roll = 0;
    this.rollRate = rand(0.05, 0.25) * (Math.random() < 0.5 ? -1 : 1);
    this.chutes = Math.floor(rand(0, 10.99)); // how many of the crew get out
    this.emit(reason);
    this.emit('Bail out! Bail out!');
  }

  /** Engine fires, burning tanks, stragglers falling back, and the final fall. */
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
        effects?.trail(at, vel, 'fire', dt);
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
      if (this.tankFire[side] > 25 && !this.down) this.goDown('The wing\'s burning through!');
    }
    // stragglers: each engine out costs speed and height, so the bomber falls out of the box
    const n = this.deadEngines;
    this.drift.set(0, n >= 2 ? -2 : 0, [0, 1.5, 4, 8, 8][n]);
    if (this.down) {
      this.downT += dt;
      this.drift.set(0, -Math.min(45, 4 + this.downT * 2.5), 22);
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
    // a heavy bomber: banks to turn, rolls slowly, and the bank angle sets the rate of turn
    const err = wrapA(heading - f.heading);
    const bankT = input?.roll ? input.roll * MAX_BANK : clamp(err * 2.5, -MAX_BANK, MAX_BANK);
    f.bank += (bankT - f.bank) * (1 - Math.exp(-dt * 1.1));
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
      Math.sin(s * 0.29) * 0.008 + turb * 0.0015 - (this.down ? Math.min(0.35, this.downT * 0.02) : 0),
      Math.sin(s * 0.13) * 0.004,
      Math.sin(s * 0.23) * 0.018 + Math.sin(s * 0.9) * 0.002 + this.roll + (this.deadEngines ? (this.engines[0].state !== 'ok' || this.engines[1].state !== 'ok' ? 0.02 : -0.02) : 0),
    );
    const f = this.flight;
    if (f.heading || f.pitch || f.bank) { // flown off the formation's course: heading, then pitch, then bank
      _q.setFromEuler(_fe.set(f.pitch, f.heading, f.bank, 'YXZ'));
      this.group.quaternion.multiplyQuaternions(_q, _q2.setFromEuler(_rock));
    } else this.group.rotation.copy(_rock);
  }
}
