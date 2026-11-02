// AI fighter pilots for the dogfight scenarios: basic fighter manoeuvres flown through the same flight model and
// mouse-aim instructor as yours (flight.js), so they have the same energy to spend and the same limits.
// Every so often (quicker the better the pilot) he sizes up the fight and picks a manoeuvre for it:
//   on the attack: lead pursuit to shoot, lag pursuit and the high yo-yo so as not to overshoot, the low yo-yo to
//   cut across a turning target; boom and zoom for the heavy, fast types (dive through, zoom back up, again);
//   the head-on pass, and after it a turn back (the turners) or an Immelmann / an extension (the others);
//   on the defence: the break turn into an attacker, the scissors once he's overshot, the Split-S and a dive
//   to get away (the types that dive well);
//   and a wingman: in formation on his leader, until his leader's in trouble or a fight comes to him.
import * as THREE from 'three';
import { SKILLS } from './scenario.js';

const V = THREE.Vector3, UP = new V(0, 1, 0), DOWN = new V(0, -1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
// how each type likes to fight: turner (a turning fight suits it), energy (fight up and down: boom and zoom),
// dive (dives away well), corner (m/s: the speed it turns best at, up here: faster and the stick's too heavy and
// the turn too wide, slower and the wing hasn't the lift)
const STYLE = {
  bf109: { turner: 0.85, energy: 0.45, dive: 0.4, corner: 140 },
  fw190: { turner: 0.3, energy: 0.8, dive: 0.75, corner: 165 },
  p47: { turner: 0.35, energy: 1, dive: 1, corner: 155 },
};
const GUN_RANGE = 550; // m: he opens fire inside this
const _a = new V(), _b = new V(), _c = new V(), _h = new V();

/** Heading (unit, level) of a direction. */
const flat = (v, out) => { out.set(v.x, 0, v.z); if (out.lengthSq() < 1e-6) out.set(0, 0, -1); return out.normalize(); };

export class Brain {
  /** f: his fighter (with f.fm). fighters: the Fighters. leader: whose wing he flies on (null: a leader). */
  constructor(f, fighters, { skill = 'veteran', leader = null, wingSide = 1, ground = 7600 } = {}) {
    Object.assign(this, { f, fighters, leader, wingSide });
    this.ground = ground; // m: how far below the scene's origin the ground is (world.js ALTITUDE)
    this.skill = SKILLS[skill] ?? SKILLS.veteran;
    this.style = STYLE[f.kind];
    this.aim = f.dir.clone();
    this.throttle = 1;
    this.maxG = this.skill.g;
    this.man = leader ? 'formation' : 'pursuit';
    this.manT = 0; // s in the manoeuvre
    this.thinkT = rand(0, this.skill.react);
    this.target = null; this.threat = null;
    this.turnFightT = 0; // s spent in a turning fight that's going nowhere
    this.phase = 0; this.hdg0 = new V(0, 0, -1);
    this.loop = false; // a manoeuvre that goes over the top or through the bottom (instruct: no turning it into a turn)
    this.firing = false;
  }

  get alt() { return this.ground + this.f.pos.y; }

  /** The enemy fighters still flying. */
  enemies() { return this.fighters.list.filter((e) => e.alive && e.side !== this.f.side); }
  friends() { return this.fighters.list.filter((e) => e.alive && e.side === this.f.side && e !== this.f); }

  /** Angle off his nose (rad) of the line from `from` (fighter) to point p. */
  ata(from, p) { return from.dir.angleTo(_a.copy(p).sub(from.pos)); }

  /** The most dangerous enemy: close, his nose on me, and behind my wings (or very close). */
  findThreat() {
    let best = null, score = 0;
    for (const e of this.enemies()) {
      const d = e.pos.distanceTo(this.f.pos);
      if (d > 1600) continue;
      const hisAta = this.ata(e, this.f.pos), myAta = this.ata(this.f, e.pos);
      if (hisAta > 0.6) continue; // (his nose isn't on me)
      if (myAta < 1.4 && d > 450) continue; // (he's out in front: a head-on, not a threat on my tail)
      const s = (1600 - d) * (0.6 - hisAta + 0.4);
      if (s > score) { score = s; best = e; }
    }
    return best;
  }

  /** Who to go for: whoever's on a friend's tail first, then the easiest shot (close, in front). Some loyalty. */
  pickTarget() {
    const mine = this.f, list = this.enemies();
    if (!list.length) return null;
    const cover = this.leader?.alive ? [this.leader] : this.friends();
    let best = null, bs = Infinity;
    for (const e of list) {
      let s = e.pos.distanceTo(mine.pos) * (1 + this.ata(mine, e.pos) * 0.6);
      for (const fr of cover) if (e.pos.distanceTo(fr.pos) < 1200 && this.ata(e, fr.pos) < 0.5) s *= 0.35; // (on a friend's tail: him first)
      if (e === this.target) s *= 0.7;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  /** Where to point the guns for the rounds to meet t: his lead, judged as well as this pilot can, wandering a little. */
  leadPoint(t, out) {
    const f = this.f, d = t.pos.distanceTo(f.pos), tof = d / (f.k.muzzle + f.speed * 0.5);
    out.copy(t.pos).addScaledVector(_b.copy(t.velocity).sub(f.velocity), tof * this.skill.lead);
    out.y += 0.5 * 9.81 * tof * tof * 0.6; // (a little for the drop)
    return out.add(this.fighters.wobble(f, d, 0.01 * this.skill.aim));
  }

  begin(man) {
    if (man === this.man) return;
    this.man = man; this.manT = 0; this.phase = 0;
    flat(this.f.dir, this.hdg0);
  }

  /** Size up the fight and pick a manoeuvre (not every frame: he takes his time to see and answer). */
  think() {
    const f = this.f, st = this.style;
    // committed: a Split-S, an Immelmann, a yo-yo or an extension is flown through before anything else
    if ((this.man === 'splitS' || this.man === 'immelmann') && this.manT < 9) return;
    if ((this.man === 'highYoyo' || this.man === 'lowYoyo') && this.manT < 2.2) return;
    if (this.man === 'reversal' && this.manT < 6 && this.target && this.ata(f, this.target.pos) > 0.8) return;
    if (this.alt < 1300 && f.dir.y < 0.15) return this.begin('recover');
    this.threat = this.findThreat();
    this.target = this.pickTarget();
    const th = this.threat, tg = this.target;
    // hurt (leaking, the engine failing, the controls going): out of the fight, running for it
    if (f.sys?.crippled(f.fm)) return this.begin('extend');
    if (th) {
      const d = th.pos.distanceTo(f.pos), hisAta = this.ata(th, f.pos), myAta = this.ata(f, th.pos);
      // he's overshot: now out in front of my wings, and his nose off me. Scissors, or take him
      if (myAta < 1.3 && hisAta > 0.5) return this.begin(d < 500 ? 'scissors' : 'pursuit');
      // the types that dive well get out downhill (after a turn that's not shaking him); the others turn and fight
      if (this.man === 'break' && this.manT > 4 && this.alt > 2600 && Math.random() < st.dive * 0.6) return this.begin('splitS'); // (a Split-S needs 1,500 m or more to come out of)
      if (this.man === 'extend' && st.dive > 0.7 && d > 600) return; // (running for it: keep running)
      return this.begin(d < 900 || hisAta < 0.15 ? 'break' : st.dive > 0.7 && f.speed > 140 ? 'extend' : 'break');
    }
    if (this.leader?.alive && (!tg || tg.pos.distanceTo(f.pos) > 1800) && this.leader.pos.distanceTo(f.pos) < 4000) return this.begin('formation');
    if (!tg) return this.begin('patrol');
    const d = tg.pos.distanceTo(f.pos), myAta = this.ata(f, tg.pos), aa = tg.dir.angleTo(_a.copy(tg.pos).sub(f.pos)); // aa: 0 = right behind him
    const closure = -_b.copy(tg.velocity).sub(f.velocity).dot(_c.copy(tg.pos).sub(f.pos).normalize());
    const above = f.pos.y - tg.pos.y, faster = f.speed - tg.speed;
    // the energy fighters: keep the fight up and down, never a slow turning one
    if (st.energy > 0.7) {
      if (this.man === 'extend' && (d < 2300 && this.manT < 12)) return;
      if (this.man === 'zoom' && above < 500 && f.speed > 115 && this.manT < 14) return;
      if (f.speed < 105 && myAta > 0.8 && d < 1500) return this.begin('extend'); // (too slow to turn with him: get out, get the speed back)
      if (d > 2000 && above < 300 && myAta < 1.2) return this.begin('zoom'); // (out of range: climb, come down on him)
    }
    // nose to nose: the head-on pass
    if (aa > 2.3 && myAta < 0.6 && d < 3500) return this.begin('headOn');
    // just past him in a head-on: the turners turn back at once; the others go up (fast) or out (slow)
    if (this.man === 'headOn' && myAta > 1.6) {
      if (st.turner > 0.6 || d < 400) return this.begin('pursuit');
      return this.begin(f.speed > 145 ? 'immelmann' : 'extend');
    }
    if (myAta < 1.0) {
      // closing fast inside his turn: up out of the plane of it, so as not to fly past him
      if (this.skill.react < 0.8 && closure > 60 && d < 800 && aa > 0.7) return this.begin('highYoyo');
      // falling behind a turning target: nose down inside his turn, cut the corner, gain speed
      if (myAta > 0.35 && d > 550 && closure < 5 && faster < 15 && this.alt > 2000) return this.begin('lowYoyo');
      if (closure > 70 && d < 300) return this.begin('lag');
      return this.begin('pursuit');
    }
    // he's off to the side or behind me (not on my tail): turn after him; a turning fight going nowhere,
    // the energy types get out of it
    if (st.energy > 0.7 && this.turnFightT > 14) { this.turnFightT = 0; return this.begin('extend'); }
    // fast, and he's behind me: a climbing turn back (the speed into height, and a tighter turn than a flat one)
    if (myAta > 1.6 && f.speed > st.corner + 15) return this.begin('reversal');
    return this.begin('pursuit');
  }

  update(dt) {
    const f = this.f;
    this.manT += dt;
    // the ground coming up: pull out now, whatever he was doing (no waiting for his next look round)
    if (this.alt < 900 && f.dir.y < 0 && this.man !== 'recover') this.begin('recover');
    if ((this.thinkT -= dt) <= 0) { this.thinkT = this.skill.react * rand(0.7, 1.3); this.think(); }
    const tg = this.target?.alive ? this.target : null, th = this.threat?.alive ? this.threat : null;
    if (tg && this.ata(f, tg.pos) > 0.9 && (this.man === 'pursuit' || this.man === 'lag')) this.turnFightT += dt; else this.turnFightT = Math.max(0, this.turnFightT - dt * 2);
    this.maxG = this.skill.g;
    this.throttle = 1;
    this.loop = false;
    this.firing = false;
    const aim = this.aim, pos = f.pos;
    switch (this.man) {
      case 'pursuit': case 'headOn': { // lead pursuit: the nose onto where he'll be
        if (!tg) { this.begin('patrol'); break; }
        this.leadPoint(tg, _c);
        aim.copy(_c).sub(pos).normalize();
        const d = tg.pos.distanceTo(pos);
        // head-on: at the last moment a little off to the right and up (not into him)
        if (this.man === 'headOn' && d < 260) aim.addScaledVector(f.fm.right, 0.35).addScaledVector(UP, 0.15).normalize();
        // the old hands keep their speed in hand: near the type's corner speed, and closing no faster than they can
        // stop (throttle back), or they'll fly straight past him
        if (this.man === 'pursuit' && d < 1600 && this.skill.react < 0.8) {
          const closure = -_b.copy(tg.velocity).sub(f.velocity).dot(_a.copy(tg.pos).sub(pos).normalize());
          const aa = tg.dir.angleTo(_c.copy(tg.pos).sub(pos)); // (0: right behind him; more: he's turning across)
          let over = (closure - (25 + d * 0.05)) / 60; // (closing faster than he can stop in the distance left)
          if (aa > 0.6 && closure > 10) over = Math.max(over, (f.speed - this.style.corner - 20) / 40); // (him turning: no faster than turns best)
          this.leadPoint(tg, _c); // (put back: the lead, for the gunsight below)
          this.throttle = THREE.MathUtils.clamp(1 - over, 0.15, 1);
        }
        this.firing = d < GUN_RANGE && f.dir.angleTo(_a.copy(_c).sub(pos)) < 0.035 + 0.015 * this.skill.aim;
        break;
      }
      case 'reversal': { // fast, him behind: a climbing turn round to him
        const e = tg ?? th;
        if (!e) { this.begin('patrol'); break; }
        flat(_c.copy(e.pos).sub(pos), aim);
        aim.addScaledVector(UP, THREE.MathUtils.clamp((f.speed - this.style.corner) / 60, 0.2, 0.8)).normalize();
        if (this.ata(f, e.pos) < 0.6) this.begin('pursuit');
        break;
      }
      case 'lag': { // lag pursuit: aim behind him, close the angle without flying past
        if (!tg) { this.begin('patrol'); break; }
        aim.copy(tg.pos).addScaledVector(tg.dir, -140).sub(pos).normalize();
        this.throttle = 0.6;
        break;
      }
      case 'highYoyo': { // up out of his turn, then back down onto his tail
        if (!tg) { this.begin('patrol'); break; }
        aim.copy(tg.pos).addScaledVector(tg.dir, -100).sub(pos).normalize().addScaledVector(UP, this.manT < 1.3 ? 0.8 : 0.1).normalize();
        this.throttle = 0.8;
        break;
      }
      case 'lowYoyo': { // nose down inside his turn: cut across, gain speed, then up onto him
        if (!tg) { this.begin('patrol'); break; }
        this.leadPoint(tg, _c);
        aim.copy(_c).sub(pos).normalize().addScaledVector(DOWN, this.manT < 1.5 ? 0.45 : 0).normalize();
        break;
      }
      case 'break': { // a hard turn into the attacker (he'll overshoot or have to pull more than he can), nose a little low
        if (!th) { this.begin('pursuit'); break; }
        aim.copy(th.pos).sub(pos).normalize();
        flat(aim, _h); aim.copy(_h).addScaledVector(DOWN, this.alt > 2200 ? 0.18 : -0.05).normalize(); // (nose low for speed, while there's height to spend)
        this.maxG = this.skill.g + 0.5;
        break;
      }
      case 'scissors': { // he's overshot: turn back into him, again and again, slowing so he ends up in front
        const e = th ?? tg;
        if (!e) { this.begin('patrol'); break; }
        aim.copy(e.pos).sub(pos).normalize();
        const side = Math.floor(this.manT / 2.4) % 2 ? 1 : -1;
        aim.addScaledVector(_h.crossVectors(aim, UP).normalize(), side * 0.25).normalize();
        this.throttle = 0.3;
        this.firing = tg && tg.pos.distanceTo(pos) < GUN_RANGE && f.dir.angleTo(_a.copy(this.leadPoint(tg, _c)).sub(pos)) < 0.05;
        if (this.manT > 9) this.begin('pursuit');
        break;
      }
      case 'splitS': { // half roll to inverted and pull through: heading reversed, lower and faster
        this.loop = true;
        const pitch = Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1));
        if (this.phase === 0) { aim.copy(DOWN).addScaledVector(this.hdg0, -0.25).normalize(); if (pitch < -0.95) this.phase = 1; }
        else { aim.copy(this.hdg0).negate().addScaledVector(DOWN, 0.08).normalize(); if (pitch > -0.15) this.begin(this.style.dive > 0.7 ? 'extend' : 'pursuit'); }
        break;
      }
      case 'immelmann': { // half loop up and a half roll at the top: heading reversed, higher, slower
        this.loop = true;
        const pitch = Math.asin(THREE.MathUtils.clamp(f.dir.y, -1, 1));
        if (this.phase === 0) { aim.copy(UP).addScaledVector(this.hdg0, 0.15).normalize(); if (pitch > 1.2 || f.speed < 95) this.phase = 1; }
        else { aim.copy(this.hdg0).negate().addScaledVector(UP, 0.05).normalize(); if (pitch < 0.3 && f.dir.dot(this.hdg0) < -0.6) this.begin('pursuit'); }
        if (this.manT > 12) this.begin('pursuit');
        break;
      }
      case 'extend': { // unload and run: away from them, a little downhill, full throttle, gentle on the stick
        const away = _c.set(0, 0, 0);
        for (const e of this.enemies()) if (e.pos.distanceTo(pos) < 3000) away.add(_a.copy(pos).sub(e.pos).normalize());
        if (away.lengthSq() < 1e-4) away.copy(f.dir);
        flat(away, aim); aim.addScaledVector(DOWN, this.alt > 2500 ? 0.12 : this.alt < 1800 ? -0.1 : 0).normalize();
        this.maxG = 3;
        break;
      }
      case 'zoom': { // climb back up for height, towards him but above him
        const to = tg ? _c.copy(tg.pos).sub(pos) : _c.copy(f.dir);
        flat(to, aim); aim.addScaledVector(UP, 0.5).normalize();
        break;
      }
      case 'formation': { // on his leader's wing: abreast, a little back, matching speed
        const l = this.leader;
        if (!l?.alive) { this.leader = null; this.begin('patrol'); break; }
        const lr = _h.set(-l.dir.z, 0, l.dir.x).normalize(); // (the leader's right, level)
        const slot = _c.copy(l.pos).addScaledVector(lr, 70 * this.wingSide).addScaledVector(l.dir, -45).add(_b.set(0, 8, 0));
        const to = _a.copy(slot).sub(pos), along = to.dot(l.dir);
        aim.copy(slot).addScaledVector(l.dir, 260).sub(pos).normalize();
        this.throttle = THREE.MathUtils.clamp(0.8 + along * 0.012 + (l.speed - f.speed) * 0.03, 0.2, 1);
        this.maxG = 4;
        break;
      }
      case 'recover': { // too low: wings level and climb
        flat(f.dir, aim); aim.addScaledVector(UP, 0.9).normalize();
        this.maxG = this.skill.g + 1; // (whatever it takes)
        this.throttle = f.dir.y < -0.3 ? 0.3 : 1; // (diving: off the power, or she'll be too fast to pull out)
        if (this.alt > 2000 || this.manT > 10) this.begin('patrol');
        break;
      }
      default: { // patrol: towards the fight if there is one, else a gentle circle
        const e = this.enemies()[0];
        if (e) aim.copy(e.pos).sub(pos).normalize();
        else { flat(f.dir, aim); aim.addScaledVector(_h.crossVectors(aim, UP), 0.3).normalize(); }
        this.throttle = 0.85;
      }
    }
    if (!Number.isFinite(aim.x + aim.y + aim.z) || aim.lengthSq() < 0.5) aim.copy(f.dir);
    // (the aim leads its own motion: the instructor turns in proportion to how far off the aim is, so an aim that
    // keeps moving, a turning target's lead, is always chased a little behind; a pilot pulls ahead of it)
    this.raw ??= aim.clone();
    const tracking = this.man === 'pursuit' || this.man === 'headOn' || this.man === 'scissors' || this.man === 'lowYoyo';
    if (tracking && dt > 0) {
      const moved = _b.copy(aim).sub(this.raw), rate = moved.length() / dt;
      this.raw.copy(aim);
      if (rate < 1.2) aim.addScaledVector(moved, (0.45 * (1.2 - this.skill.react * 0.6)) / dt).normalize();
    } else this.raw.copy(aim);
    if (this.firing) this.fighters.shoot(f, dt);
  }
}
