// What's inside a fighter besides its flight (flight.js): the engine, the fuel, the pilot and the structure,
// after War Thunder's damage and its pilot's G model.
//  - The engine runs hot at full power, hotter at emergency power (WEP, the throttle past 100%) and slow; it's
//    cooled by the air past it. Past its limit it wears, losing power, and in the end it seizes. A hit can hole
//    the oil system (or a 109's coolant): then it runs hotter and hotter, and throttling back is what buys time.
//  - A holed tank leaks fuel; empty, the engine stops.
//  - Hits can shoot an aileron, the elevator or the rudder about, or cut a control cable: less control, or none.
//  - The pilot: hold high G and the blood leaves his head: grey, then black (no control until it comes back);
//    pushing hard, the red-out. Wounded, he takes less and his hands are slower.
//  - The structure: every airframe has its breaking load, less with a shot-up wing: pull past it and the wing
//    folds; close to it, it strains (the wings weaken). Past the never-exceed speed, flutter tears at the tail.
// No browser in here either: node can try it out.
import { WEP } from './flight.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * liquid: a liquid-cooled engine (a coolant system to hole), ultG: the airframe's breaking load (g), vne: the
 * never-exceed speed (indicated, m/s), fuelMin: minutes of fuel at full throttle.
 */
export const SYSTEMS = {
  bf109: { liquid: true, ultG: 11.5, vne: 208, fuelMin: 22 }, // (DB 601: glycol-cooled; 750 km/h)
  fw190: { liquid: false, ultG: 12, vne: 236, fuelMin: 20 }, // (BMW 801 radial; 850 km/h)
  p47: { liquid: false, ultG: 12, vne: 224, fuelMin: 30 }, // (R-2800 radial; 805 km/h)
};
const G_TOL = 6.0; // g a pilot holds as long as he likes (a wounded one less)
const G_RATE = 0.1; // how fast the grey comes on, per g over it per second (7 g: black in ~10 s; 9 g: ~3.5 s)
const NEG_TOL = 2.3; // -g before the red-out starts

export class Systems {
  constructor(kind) {
    this.s = SYSTEMS[kind];
    this.temp = 0.62; // the engine's temperature: 1 is its limit (the gauge's red line)
    this.wear = 0; this.seized = false; // its damage from running hot (1: seized)
    this.oil = 1; this.oilLeak = 0; this.coolant = 1; this.coolantLeak = 0; // left, and lost a second
    this.fuel = 1; this.fuelLeak = 0; this.dry = false;
    this.wound = 0; // the pilot: 0 unhurt .. 1 near dead
    this.gStress = 0; this.red = 0; this.blackout = false; this.redout = false;
    this.overspeedT = 0; this.strainT = 0;
  }

  get leaking() { return this.oilLeak > 0 || this.coolantLeak > 0 || this.fuelLeak > 0; }
  /** Too hurt to stay in a fight: leaking, the engine failing, or the controls going. */
  crippled(fm) { return this.leaking || this.wear > 0.35 || this.seized || this.dry || (fm && Math.min(fm.ctl.elev, (fm.ctl.ailL + fm.ctl.ailR) / 2) < 0.4); }

  /**
   * A round's hit on `part` (fighters.js damage), with frac of the part left (0..1). Rolls what else it broke:
   * a leak, a control surface, a cable. Returns what's new, for the pilot to be told: ['Oil leak', ...].
   */
  hit(part, frac, fm) {
    const news = [], r = Math.random(), ctl = fm?.ctl;
    if (part === 'engine') {
      if (r < 0.35 && !this.oilLeak) { this.oilLeak = rand(0.004, 0.014); news.push('Oil leak'); } // (70 s to 4 min to run dry)
      else if (this.s.liquid && r < 0.75 && !this.coolantLeak) { this.coolantLeak = rand(0.006, 0.02); news.push('Coolant leak'); }
      this.wear = Math.min(0.9, this.wear + 0.06); // (and the hit itself)
    } else if (part === 'fuel' && r < 0.55) {
      this.fuelLeak += rand(0.004, 0.01); news.push('Fuel leak');
    } else if ((part === 'wingL' || part === 'wingR') && ctl && r < 0.3) {
      const k = part === 'wingL' ? 'ailL' : 'ailR';
      ctl[k] = Math.max(0, ctl[k] - rand(0.35, 0.7)); news.push(`${part === 'wingL' ? 'Left' : 'Right'} aileron damaged`);
    } else if (part === 'tail' && ctl) {
      if (r < 0.22) { ctl.elev = Math.max(0, ctl.elev - rand(0.3, 0.6)); news.push('Elevator damaged'); }
      else if (r < 0.42) { ctl.rud = Math.max(0, ctl.rud - rand(0.4, 0.8)); news.push('Rudder damaged'); }
      else if (r < 0.5) { const k = Math.random() < 0.5 ? 'elev' : 'rud'; ctl[k] = Math.min(ctl[k], 0.08); news.push(`${k === 'elev' ? 'Elevator' : 'Rudder'} cable cut`); }
    } else if (part === 'fuselage' && ctl && r < 0.06) {
      ctl.ailL = Math.min(ctl.ailL, 0.12); ctl.ailR = Math.min(ctl.ailR, 0.12); news.push('Aileron cables cut');
    } else if (part === 'pilot' && frac > 0) {
      this.wound = Math.max(this.wound, 1 - frac); news.push('You\'re wounded');
    }
    return news;
  }

  /**
   * One frame: the engine's heat, the leaks and the fuel; the pilot under G; the airframe's limits. Sets what
   * of it the flight model feels (fm.thrust's engine share, fm.sluggish). wings: the weaker wing's share left
   * (0..1). Returns what happened: 'seized', 'dry', 'fold' (past the breaking load), 'strain' (near it),
   * 'flutter' (past the never-exceed speed), 'flutterBreak' (well past it, or too long).
   */
  update(dt, fm, throttle, wings = 1) {
    const ev = [], s = this.s;
    // fuel: burnt (a full tank lasts fuelMin at full throttle) and leaking
    this.fuel = Math.max(0, this.fuel - dt * (Math.min(throttle, WEP) / (s.fuelMin * 60) + this.fuelLeak));
    if (this.fuel <= 0 && !this.dry) { this.dry = true; ev.push('dry'); }
    // (a leak runs with the pressure behind it: throttled back, slower)
    const press = 0.35 + 0.65 * Math.min(1, throttle);
    this.oil = Math.max(0, this.oil - this.oilLeak * press * dt);
    this.coolant = Math.max(0, this.coolant - this.coolantLeak * press * dt);
    // the heat: settling (over ~40 s) towards what this power, this airspeed and what's left of the oil and
    // coolant give. Full power holds under the line; WEP crosses it in a minute or two; slow and hard, hotter.
    // A leak heats her in proportion to the power: throttled back, she lasts
    const thr = this.seized || this.dry ? 0 : Math.min(throttle, WEP);
    const air = clamp((fm.ias - 80) / 90, 0, 1), slow = clamp((100 - fm.ias) / 50, 0, 1);
    let eq = 0.42 + 0.45 * Math.min(thr, 1) + Math.max(0, thr - 1) * 2.0 - 0.12 * air + 0.1 * slow * thr;
    eq += ((1 - this.coolant) * 0.9 + (1 - this.oil) * 0.55) * (0.15 + 0.85 * Math.min(thr, 1));
    this.temp += (eq - this.temp) * (1 - Math.exp(-dt / 40));
    if (this.temp > 1) this.wear += (this.temp - 1) * dt * 0.12;
    if (this.oil < 0.05 && thr > 0) this.wear += dt * 0.05 * (0.2 + 0.8 * thr); // (no oil at all: a minute or so at full power)
    this.wear = Math.min(1, this.wear);
    if (this.wear >= 1 && !this.seized) { this.seized = true; ev.push('seized'); }
    fm.thrust = this.seized || this.dry ? 0 : 1 - 0.35 * this.wear; // (fighters.js takes off more for a hit engine)
    // the pilot under G: past his tolerance the grey creeps in; black at 1 (and back below 0.45)
    const tol = G_TOL - 1.6 * this.wound;
    if (fm.g > tol) this.gStress += (fm.g - tol) * G_RATE * dt;
    else this.gStress -= dt * (fm.g < 4 ? 0.25 : 0.08);
    this.gStress = clamp(this.gStress, 0, 1.3);
    if (this.gStress >= 1) this.blackout = true; else if (this.gStress < 0.45) this.blackout = false;
    if (fm.g < -NEG_TOL) this.red += (-fm.g - NEG_TOL) * 0.35 * dt; else this.red -= dt * 0.3;
    this.red = clamp(this.red, 0, 1.3);
    if (this.red >= 1) this.redout = true; else if (this.red < 0.45) this.redout = false;
    fm.sluggish = 1 + 0.9 * this.wound;
    // the structure: the breaking load, less with a shot-up wing (and a little less again if it's been strained)
    const limit = s.ultG * (0.4 + 0.6 * clamp(wings, 0, 1));
    if (fm.g > limit || fm.g < -0.5 * limit) ev.push('fold');
    else if (fm.g > 0.85 * limit) { this.strainT += dt; ev.push('strain'); }
    else this.strainT = Math.max(0, this.strainT - dt);
    // past the never-exceed speed: flutter, shaking the tail and the ailerons apart
    if (fm.ias > s.vne) {
      this.overspeedT += dt;
      ev.push(fm.ias > s.vne * 1.07 || this.overspeedT > 5 ? 'flutterBreak' : 'flutter');
    } else this.overspeedT = Math.max(0, this.overspeedT - dt * 0.5);
    return ev;
  }

  /** How dim the pilot's sight is: { grey 0..1 (1 black), red 0..1 }. */
  vision() {
    return { grey: this.blackout ? 1 : clamp((this.gStress - 0.35) / 0.65, 0, 1), red: this.redout ? 1 : clamp((this.red - 0.35) / 0.65, 0, 1), wound: this.wound };
  }
}
