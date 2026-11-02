// A fighter's flight, done by forces rather than by turning its nose round: lift from the wings' angle of
// attack, drag (and the drag of lift: hard turns bleed speed), the engine's thrust, gravity (climbing costs
// speed, diving gains it), and the airframe's inertia in roll, pitch and yaw. The pilot (you, through the
// mouse-aim instructor below, or an AI) asks for an angle of attack, a roll rate and a sideslip; the airframe
// gets there as fast as the air lets it (slower when it's slow), and the wings stall past their limit.
// After War Thunder's realistic model: the stick gets heavy at high speed (and near the speed of sound the
// elevator loses its bite and the nose tucks under: the dive you can't pull out of), the propeller's torque
// rolls her at low speed and full power, combat flaps, emergency power, a stall that drops a wing and spins
// her if she's mishandled, and controls that answer less when they're shot about. No browser in here: the
// same code flies the player and the AI, and can be tried out in node.
import * as THREE from 'three';

const V = THREE.Vector3;
const G = 9.81;
const CL_ALPHA = 4.6; // lift per radian of angle of attack (a 3D wing)
const REF_ALT = 7600; // m: where each type's top speed is given (the raid's height, ~25,000 ft)
const VREF = 120; // m/s: the speed the response times are given at (slower air: slower answers)
const FLAP_CL = 0.3, FLAP_CD = 0.03; // combat flaps down: this much more lift, and drag
export const WEP = 1.1; // throttle past the gate: emergency power, 10% more (and heat: airframe.js)

/**
 * The types. mass (kg, in combat trim), wing area (m²), clMax (the wing's best lift: with the 109's slats a
 * little more), cd0 (drag of the airframe), k (drag of lift: 1/(pi e AR)), vmax (m/s level at REF_ALT, full
 * throttle), roll: the best roll rate (rad/s) between lo and hi m/s, falling off beyond hi as the ailerons
 * stiffen (stiff: per m/s), pitch: the most the nose can be pulled round (rad/s), maxG / negG: what the
 * instructor will pull (and push) at most, stick: the indicated airspeeds (m/s) where the elevator starts to
 * get heavy and where it's as good as locked, mcrit: the Mach number where compressibility sets in, torque:
 * how hard the propeller rolls her over at low speed and full power (rad/s²), flapsIAS: flaps down faster than
 * this (indicated, m/s) and they're torn off.
 */
export const AIRFRAMES = {
  // the Bf 109 F: light, the best turner of the three, ailerons and elevator that go solid at high speed
  bf109: { mass: 2800, wing: 16.05, clMax: 1.5, cd0: 0.023, k: 0.065, vmax: 167, roll: { peak: 1.9, lo: 85, hi: 135, stiff: 0.011 }, pitch: 1.3, maxG: 7, negG: -3,
    stick: [125, 215], mcrit: 0.74, torque: 0.35, flapsIAS: 125 },
  // the Fw 190 A-8: heavy, fast, the famous roll and a light stick to go with it; it doesn't like a slow turning fight
  fw190: { mass: 4300, wing: 18.3, clMax: 1.35, cd0: 0.025, k: 0.066, vmax: 180, roll: { peak: 2.8, lo: 90, hi: 165, stiff: 0.007 }, pitch: 1.15, maxG: 7, negG: -3,
    stick: [140, 240], mcrit: 0.75, torque: 0.45, flapsIAS: 120 },
  // the P-47 D: very heavy, a big wing; dives like a brick and keeps its speed, rolls well when fast, but past
  // ~Mach 0.7 the compressibility had it nose-down and the stick like a post
  p47: { mass: 5600, wing: 27.9, clMax: 1.4, cd0: 0.024, k: 0.071, vmax: 192, roll: { peak: 1.65, lo: 95, hi: 175, stiff: 0.005 }, pitch: 1.1, maxG: 7, negG: -3,
    stick: [145, 225], mcrit: 0.70, torque: 0.55, flapsIAS: 110 },
};

/** Air density (kg/m³) at altitude h (m), the standard atmosphere. */
export const density = (h) => 1.225 * Math.pow(Math.max(0.05, 1 - 2.2558e-5 * Math.max(0, h)), 4.2559);
/** The speed of sound (m/s) at altitude h (m). */
export const soundSpeed = (h) => 20.05 * Math.sqrt(Math.max(216.65, 288.15 - 0.0065 * Math.max(0, h)));

// each type's engine, worked out from its top speed: the power that holds vmax level at REF_ALT
for (const a of Object.values(AIRFRAMES)) {
  const rho = density(REF_ALT), q = 0.5 * rho * a.vmax * a.vmax, cl = (a.mass * G) / (q * a.wing);
  a.power = q * a.wing * (a.cd0 + a.k * cl * cl) * a.vmax; // W (the propeller's losses folded in)
  a.alphaStall = a.clMax / CL_ALPHA; // (the wing's own angle: the fuselage flies this much flatter, a.incidence)
  a.incidence = 0.035; // rad: the wing is rigged ~2 degrees nose-up on the fuselage, so in cruise the nose sits on the flight path
}

/** The type's best roll rate (rad/s) at airspeed v. */
export function rollRate(a, v) {
  const r = a.roll, slow = THREE.MathUtils.clamp((v - 25) / (r.lo - 25), 0.15, 1);
  const stiff = v > r.hi ? Math.max(0.35, 1 - (v - r.hi) * r.stiff) : 1;
  return r.peak * slow * stiff;
}

/** Lift coefficient at the wing's angle of attack alpha (flaps down: dcl more): straight up to the stall, then falling away. */
function liftCoef(a, alpha, dcl = 0) {
  const s = a.alphaStall;
  if (alpha > s) return (a.clMax + dcl) * Math.max(0.45, 1 - (alpha - s) * 2.2);
  if (alpha < -0.6 * s) return -0.6 * a.clMax * Math.max(0.45, 1 - (-alpha - 0.6 * s) * 2.2);
  return CL_ALPHA * alpha + dcl;
}

const _v = new V(), _l = new V(), _s = new V(), _a = new V(), _r = new V();
const UP = new V(0, 1, 0);

export class FlightModel {
  /** kind: 'bf109' | 'fw190' | 'p47'. dir, up: the nose and the wings' up; speed: m/s along the nose. */
  constructor(kind, dir, up, speed) {
    this.a = AIRFRAMES[kind];
    this.fwd = dir.clone().normalize();
    this.up = up.clone().addScaledVector(this.fwd, -up.dot(this.fwd)).normalize();
    this.right = new V().crossVectors(this.fwd, this.up);
    this.vAir = this.fwd.clone().multiplyScalar(speed); // through the air
    this.p = 0; // roll rate, rad/s (+: rolling right)
    this.alpha = 0; this.beta = 0; this.g = 1; // angle of attack, sideslip (rad), load factor
    this.ias = speed; this.mach = 0; // indicated airspeed (m/s), Mach number
    this.throttle = 0.85; // 0..1, past 1 (to WEP): emergency power
    this.stalled = false;
    this.spin = 0; // 0..1: a stalled wing dropped and autorotating (a spin: push to stop it)
    // what the pilot asks for (the instructor's or an AI's): angle of attack, roll stick (-1..1), sideslip
    this.cmd = { alpha: 0, aileron: 0, beta: 0 };
    this.flaps = 0; this.flapsWant = 0; this.flapsBroken = false; // combat flaps (0..1), where they're going
    // what's left of her (airframe.js sets these from her damage)
    this.thrust = 1; // the engine's share: less when hit or hot, 0 when it's stopped
    this.rollBias = 0; // rad/s²: a wing shot about pulls her over one way
    this.lift = 1; // the wings' share left (shot-up wings lift less)
    this.pitchScale = 1; // a holed tail answers slower
    this.ctl = { ailL: 1, ailR: 1, elev: 1, rud: 1 }; // the control surfaces (and their cables): 1 whole, 0 gone
    this.sluggish = 1; // more than 1: slower hands (a wounded pilot)
    this.authority = 1; // how much of the elevator's travel there is: the stick's weight at speed, compressibility, damage
  }

  get speed() { return this.vAir.length(); }
  get dcl() { return this.flaps * FLAP_CL * (this.flapsBroken ? 0 : 1); }

  /** The angles the air meets the airframe at, from vAir. */
  angles() {
    const v = _v.copy(this.vAir).normalize();
    this.alpha = Math.atan2(-v.dot(this.up), v.dot(this.fwd));
    this.beta = Math.atan2(v.dot(this.right), v.dot(this.fwd));
  }

  /** Airspeeds and how much elevator there is to use: the stick's weight, compressibility, the elevator's state. */
  air(alt) {
    const a = this.a, v = this.speed, rho = density(alt);
    this.ias = v * Math.sqrt(rho / 1.225);
    this.mach = v / soundSpeed(alt);
    const heavy = THREE.MathUtils.clamp((this.ias - a.stick[0]) / (a.stick[1] - a.stick[0]), 0, 1);
    const comp = this.mach > a.mcrit ? Math.max(0.15, 1 - (this.mach - a.mcrit) * 7) : 1;
    this.authority = (1 - 0.65 * heavy) * comp * (0.15 + 0.85 * this.ctl.elev);
    return rho;
  }

  /** The angle of attack (the fuselage's) that makes n g, here and now. */
  alphaFor(n, alt) {
    const a = this.a, v = Math.max(20, this.speed), qs = 0.5 * density(alt) * v * v * a.wing * this.lift;
    return (n * a.mass * G) / (qs * CL_ALPHA) - this.dcl / CL_ALPHA - a.incidence;
  }

  /** The g that angle of attack (the fuselage's) makes, here and now. */
  gFor(alpha, alt) {
    const a = this.a, v = Math.max(20, this.speed), qs = 0.5 * density(alt) * v * v * a.wing * this.lift;
    return ((CL_ALPHA * (alpha + a.incidence) + this.dcl) * qs) / (a.mass * G);
  }

  /**
   * The angle of attack that holds the nose's path straight against gravity, and how far either side of it
   * the stick will go: the instructor's G limits (none by hand: then only the wing's own limit, the stall),
   * and what the elevator has to give at this speed.
   */
  limits(alt, maxG = this.a.maxG, negG = this.a.negG, manual = false) {
    const a = this.a;
    this.air(alt);
    const trim = this.alphaFor(this.up.dot(UP), alt); // (banked, the wings carry gravity's share across their own up only)
    const stall = a.alphaStall - this.dcl / CL_ALPHA - a.incidence; // (flaps down: the same lift sooner)
    // (the instructor flies her to 96% of the stall; by hand, a little past it)
    let max = Math.min(stall * (manual ? 1.06 : 0.96), manual ? Infinity : this.alphaFor(maxG, alt));
    let min = Math.max(-0.6 * a.alphaStall * (manual ? 1.06 : 0.96) - a.incidence, manual ? -Infinity : this.alphaFor(negG, alt));
    // (by hand, both hands on the stick: a quarter more than the instructor will haul, at speed)
    const auth = Math.min(1, this.authority * (manual ? 1.25 : 1));
    max = trim + (max - trim) * auth; min = trim + (min - trim) * auth;
    return { trim, max: Math.max(max, trim), min: Math.min(min, trim) };
  }

  /** One step of dt seconds at altitude alt (m). Returns the change of position through the air (m). */
  step(dt, alt) {
    const a = this.a, c = this.cmd, ctl = this.ctl;
    let v = this.vAir.length();
    if (v < 20) { this.vAir.setLength(20); v = 20; } // (never stopped dead: no direction left to fly)
    const rho = this.air(alt);
    const slow = THREE.MathUtils.clamp((VREF / v) ** 2, 0.6, 4) * this.sluggish; // slower air (or hands), slower answers
    // the flaps going down or up (and torn off, down at too high a speed)
    this.flaps += THREE.MathUtils.clamp((this.flapsBroken ? 0 : this.flapsWant) - this.flaps, -dt * 0.6, dt * 0.6);
    if (this.flaps > 0.2 && this.ias > a.flapsIAS && !this.flapsBroken) { this.flapsBroken = true; this.onFlapsBroken?.(); }
    // ---- the airframe turns: roll (with inertia), pitch towards the angle of attack asked for, yaw the same
    const comp = this.mach > a.mcrit ? Math.max(0.3, 1 - (this.mach - a.mcrit) * 5) : 1;
    const ail = (ctl.ailL + ctl.ailR) / 2;
    const pMax = rollRate(a, v) * comp * (0.1 + 0.9 * ail);
    const pWant = THREE.MathUtils.clamp(c.aileron, -1, 1) * pMax;
    // what rolls her besides the stick: shot-up wings, an aileron hanging off, and the propeller's torque
    // (at full power and low speed, over to the left)
    const torque = -a.torque * Math.min(this.throttle, WEP) * this.thrust * THREE.MathUtils.clamp((90 - v) / 60, 0, 1);
    this.p += (pWant - this.p) * (1 - Math.exp(-dt / (0.16 * Math.min(slow, 2)))) + (this.rollBias + (ctl.ailL - ctl.ailR) * 0.25 + torque) * dt;
    this.up.applyAxisAngle(this.fwd, this.p * dt);
    this.angles();
    let alphaWant = THREE.MathUtils.clamp(c.alpha, -0.6 * a.alphaStall * 1.4 - a.incidence, a.alphaStall * 1.4 - a.incidence);
    if (this.mach > a.mcrit) alphaWant -= (this.mach - a.mcrit) * 0.6; // compressibility: the nose tucks under
    let pitch = (alphaWant - this.alpha) * (1 - Math.exp(-dt / ((0.14 * slow) / Math.max(0.3, ctl.elev))));
    const pitchMax = a.pitch * this.pitchScale * Math.min(1, v / 70) * Math.max(0.25, ctl.elev) * dt;
    pitch = THREE.MathUtils.clamp(pitch, -pitchMax, pitchMax);
    this.right.crossVectors(this.fwd, this.up).normalize();
    this.fwd.applyAxisAngle(this.right, pitch); this.up.applyAxisAngle(this.right, pitch);
    const yaw = -(this.beta - THREE.MathUtils.clamp(c.beta, -0.08, 0.08) * ctl.rud) * (1 - Math.exp(-dt / ((0.3 * slow) / Math.max(0.25, ctl.rud))));
    this.fwd.applyAxisAngle(this.up, yaw);
    // a spin: the dropped wing keeps her rolling and yawing round
    if (this.spin > 0) {
      const sd = Math.sign(this.p || this.beta || 1);
      this.p += sd * this.spin * 3 * dt;
      this.fwd.applyAxisAngle(this.up, -sd * this.spin * 0.9 * dt);
    }
    this.fwd.normalize();
    this.up.addScaledVector(this.fwd, -this.up.dot(this.fwd)).normalize();
    this.right.crossVectors(this.fwd, this.up).normalize();
    // ---- the forces, from the angles the air now meets her at
    this.angles();
    const vn = _v.copy(this.vAir).divideScalar(v), q = 0.5 * rho * v * v, S = a.wing;
    const aw = this.alpha + a.incidence; // (the wing's angle to the air)
    const cl = liftCoef(a, aw, this.dcl) * this.lift;
    this.stalled = aw > a.alphaStall || aw < -0.6 * a.alphaStall;
    // stalled and mishandled (slipping, rolling, or the stick still over): she departs; unstalled, she comes out of it
    if (this.stalled && (Math.abs(this.beta) > 0.04 || Math.abs(this.p) > 0.6 || Math.abs(c.aileron) > 0.6)) this.spin = Math.min(1, this.spin + dt * 1.2);
    else if (!this.stalled) this.spin = Math.max(0, this.spin - dt * 0.9);
    const L = q * S * cl;
    const lift = _l.copy(this.up).addScaledVector(vn, -this.up.dot(vn)); // across the flight path, the wings' way up
    if (lift.lengthSq() > 1e-8) lift.normalize();
    const side = _s.copy(this.right).addScaledVector(vn, -this.right.dot(vn));
    if (side.lengthSq() > 1e-8) side.normalize();
    const Y = -q * S * 0.9 * this.beta; // the fuselage's side force (sideslip pushes the path round)
    const wave = this.mach > a.mcrit ? 22 * (this.mach - a.mcrit) ** 2 : 0; // compressibility's drag, rising fast (it caps a dive)
    const D = q * S * (a.cd0 + a.k * cl * cl + 0.6 * this.beta * this.beta + (this.stalled ? 0.08 : 0) + FLAP_CD * this.flaps + wave);
    const T = (Math.min(this.throttle, WEP) * this.thrust * a.power) / Math.max(v, 45);
    const acc = _a.set(0, -G, 0)
      .addScaledVector(lift, L / a.mass).addScaledVector(side, Y / a.mass)
      .addScaledVector(vn, -D / a.mass).addScaledVector(this.fwd, T / a.mass);
    this.g = L / (a.mass * G);
    this.vAir.addScaledVector(acc, dt);
    // a stalled wing drops: a slow roll off one way (which way: whichever she was going)
    if (this.stalled) this.p += Math.sign(this.p || 1) * 0.8 * dt;
    return _r.copy(this.vAir).multiplyScalar(dt);
  }
}

const _d = new V(), _A = new V(), _g = new V();
const TURN_GAIN = 4.5; // 1/s: the turn rate asked for per radian the aim is off the nose (a few degrees off: all the wing has)
/**
 * The mouse-aim instructor (War Thunder's): fly the nose to `aim` (a world direction). It works out the pull it
 * wants: towards the aim (a turn rate in proportion to how far off it is) plus 1 g against gravity, all across
 * the nose. Then it rolls the wings' lift onto that pull and pulls exactly as hard as the part of it the wings
 * are already lined up with: a turn is a bank and a pull, a level turn stays level, the nose near the aim
 * levels the wings by itself (gravity's share is most of the pull then), and a little way down it pushes over
 * rather than rolling upside down. All of it under the stall and the G limit; the last degrees with a touch
 * of rudder. opts: maxG (the most it will pull), roll (-1..1: your own aileron, overriding its roll), loop
 * (true: over the top or through the bottom as asked, a Split-S or an Immelmann, not turned into a level turn),
 * pitch (-1..1: your own elevator on top of the instructor's: + pulls harder, all the way to the stall at full (past
 * any G limit: only the wing and the stick's weight stop it, so you can over-G), - takes the pull off), hold
 * (true: no roll of its own, the bank held where it is: while you pitch by hand).
 * Sets fm.cmd; returns how far off the nose the aim is (rad).
 */
const _hr = new V(), _ai = new V();
export function instruct(fm, aim, alt, { maxG, roll = 0, loop = false, pitch = 0, hold = false } = {}) {
  const a = fm.a, fwd = fm.fwd, up = fm.up, right = fm.right, v = Math.max(30, fm.speed);
  const nMax = maxG ?? a.maxG;
  const offTrue = Math.acos(THREE.MathUtils.clamp(aim.dot(fwd), -1, 1));
  // well behind: not a loop (nothing up here has the speed to finish one) but a turn round to it, at its height.
  // Fly at a point out to the side, the aim's way (kept once picked: no flip-flopping when it's dead astern)
  if (!loop && offTrue > 1.6 && Math.abs(aim.y) < 0.85) {
    const hr = _hr.set(-fwd.z, 0, fwd.x); // (the horizontal right of the heading)
    if (hr.lengthSq() < 1e-6) hr.copy(right).setY(0);
    hr.normalize();
    const across = aim.dot(hr);
    if (!fm.turnSide || Math.abs(across) > 0.25) fm.turnSide = Math.sign(across) || 1;
    const el = Math.asin(THREE.MathUtils.clamp(aim.y, -1, 1));
    aim = _ai.copy(hr).multiplyScalar(fm.turnSide * Math.cos(el)).setY(Math.sin(el)).normalize();
  } else fm.turnSide = 0;
  const z = THREE.MathUtils.clamp(aim.dot(fwd), -1, 1), off = Math.acos(z);
  // which way across the nose the aim is (straight behind: over the top, the wings' up)
  const d = _d.copy(aim).addScaledVector(fwd, -z);
  if (d.lengthSq() < 1e-6) d.copy(up); else d.normalize();
  // the pull wanted: the turn (rate x speed), capped at what's left after holding gravity off: of the G limit,
  // or of all the wings (and the stick, at speed) can give (holding the height comes first, the turn gets the rest)
  const lim = fm.limits(alt, nMax);
  const nAvail = Math.min(nMax, fm.gFor(lim.max, alt));
  const g = _g.set(0, G, 0).addScaledVector(fwd, -fwd.y * G); // gravity's share across the nose, to hold off
  const turnMax = Math.sqrt(Math.max(0, (nAvail * G) ** 2 - g.lengthSq()));
  const A = _A.copy(d).multiplyScalar(Math.min(TURN_GAIN * off * v, turnMax));
  A.add(g);
  const ax = A.dot(right), ay = A.dot(up);
  // pushing: the pull wanted points down through the canopy, and not far off: push, wings where they are
  const push = ay < 0 && off < 0.3 && Math.abs(ax) < -ay;
  const wrap = (r) => Math.atan2(Math.sin(r), Math.cos(r));
  const rollErr = push ? wrap(Math.atan2(ax, ay) - Math.PI) : Math.atan2(ax, ay);
  const pMax = rollRate(a, v);
  // the stick: a roll rate in proportion to how far there is to go, damped by the roll already on
  fm.cmd.aileron = roll || (hold ? THREE.MathUtils.clamp(-fm.p * 0.3, -1, 1) : THREE.MathUtils.clamp((rollErr * 3.4 - fm.p * 0.5) / Math.max(pMax, 0.4), -1, 1));
  // the pull: as much g as the wanted pull has along the wings' up as they are now
  fm.cmd.alpha = THREE.MathUtils.clamp(fm.alphaFor(ay / G, alt), lim.min, lim.max);
  // your own elevator, on top of the instructor's pull: S pulls harder, all the way to the stall at full (past the
  // G limit, as far as the stick will go at this speed: the over-G); W takes the pull off, to a push at full
  if (pitch) {
    const m = fm.limits(alt, Infinity, -Infinity, true), at = fm.cmd.alpha;
    fm.cmd.alpha = pitch > 0 ? at + pitch * (Math.max(m.max, at) - at) : at + pitch * (at - Math.min(m.min, at));
  }
  // the rudder: only for the last few degrees, onto the aim (otherwise the ball in the middle)
  const x = aim.dot(right);
  fm.cmd.beta = -THREE.MathUtils.clamp(Math.atan2(x, Math.max(z, 1e-3)) * 1.5, -0.03, 0.03) * (1 - THREE.MathUtils.smoothstep(off, 0.02, 0.1));
  return offTrue;
}
