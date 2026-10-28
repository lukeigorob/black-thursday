// The air battle across the whole stream. Round you it's fought for real (fighters.js: fighters, rounds,
// hits); everywhere else it's played out in the abstract, a group at a time, so the losses fall all
// down the stream as they did in the real raids, not only where you happen to be:
// - each second, each 18-ship group away from your fight may take a fighter pass (more while the
//   Luftwaffe has plenty up and is attacking, few over the flak belt, none once they've gone home) and
//   the flak where the route takes it;
// - a pass picks one bomber (a straggler or a damaged one far likelier) and puts a burst into one or two
//   of its parts, through the same damage as a real hit (bomber.hit: engines out, fires, a wing gone),
//   and the crew near it are hurt (crew.js);
// - the passes go mostly at a few "hot" groups at a time, changing every so often, weighted towards the
//   exposed ones (the lead group, the low groups, the trailing wings: "Purple Heart Corner");
// - a governor for each group as well as the stream: none wiped out by chance, none untouched.
import * as THREE from 'three';
import { PARTS } from './bomber.js';
import { FIGHT_RANGE } from './oob.js';

const rand = (a, b) => a + Math.random() * (b - a);
const REAL = FIGHT_RANGE; // m from your bomber: inside this the fight is the real one (all of the compact force)
// (the fighters and the flak both: the flak mostly by an engine set alight, the fire into the wing)
const PASS_RATE = 0.04; // fighter passes a second at a group, at full pressure
const FLAK_RATE = 0.15; // flak hits a second at a group, at the heaviest
const ENGINES = PARTS.filter((p) => p.kind === 'engine');
const HOT_EVERY = 40; // s: the fighters shift their attention to other groups

export class StreamBattle {
  constructor({ bombers, crews, effects }) {
    Object.assign(this, { bombers, crews, effects });
    this.t = 0; this.hotT = 0; this.hot = new Set();
    this.groups = new Map(); // group -> its bombers (who's in which group changes as they re-form)
    this.groupBias = new Map(); // group -> how hard it's being hit, against how it should be (1: as it should)
  }

  /** The exposure of a group by its place in the stream (its name: wing-position). */
  exposure(g) {
    const [wing, pos] = g.split('-');
    return (pos === 'Low' ? 1.4 : pos === 'Lead' ? 1.15 : 1) * (wing === '2' ? 1.25 : wing === '1' ? 1.1 : 1);
  }

  /**
   * dt: s. ctx: { center (your bomber's position), want (the share of the bombers lost by now, main.js),
   * fighters (their state: how many up, suppressed, leaving), flak ({ on, heavy }), lossBias }.
   */
  update(dt, ctx) {
    this.t += dt;
    if ((this.tick = (this.tick ?? 0) - dt) > 0) return;
    this.tick = 1;
    this.groups.clear();
    for (const b of this.bombers) if (!b.gone) (this.groups.get(b.squad) ?? this.groups.set(b.squad, []).get(b.squad)).push(b);
    if ((this.hotT -= 1) <= 0) { // a new set of groups the fighters go for
      this.hotT = HOT_EVERY;
      this.hot.clear();
      const names = [...this.groups.keys()];
      for (let k = 0; k < Math.max(2, Math.round(names.length * 0.3)); k++) {
        const w = names.map((g) => this.exposure(g)), sum = w.reduce((a, b) => a + b, 0);
        let r = Math.random() * sum, i = 0;
        while (r > w[i] && i < w.length - 1) r -= w[i++];
        this.hot.add(names[i]);
      }
    }
    const f = ctx.fighters, up = f.axis?.length ?? 0;
    // how hard the Luftwaffe is pressing: how many it has up, against the stage of the day
    const pressure = f.leaving ? 0 : Math.min(1.3, up / 120) * (f.suppressed ? 0.25 : 1) * ((f.surgeT ?? 0) > 0 ? 1.2 : 1);
    const want = ctx.want; // the share each group should have lost by now (main.js)
    for (const [g, list] of this.groups) {
      const alive = list.filter((b) => !b.down);
      if (!alive.length) continue;
      const lost = (list.length - alive.length + alive.reduce((n, b) => n + b.peril, 0)) / list.length; // (the crippled ones partly)
      // each group's own governor (the real fight round you uses it too: fighters.js, flak.js)
      this.groupBias.set(g, THREE.MathUtils.clamp(1 + (want - lost) * 25, 0.02, 2.2));
      const centre = alive[0].group.position;
      if (centre.distanceTo(ctx.center) < REAL) continue; // (the real fight's here)
      const bias = this.groupBias.get(g) * THREE.MathUtils.clamp(ctx.lossBias ?? 1, 0.1, 1.8);
      // the group's own guns keep them off: fewer passes the more of it is left
      const guns = alive.length / list.length;
      const passes = PASS_RATE * pressure * (this.hot.has(g) ? 2.2 : 0.6) * this.exposure(g) * bias * (1.25 - 0.5 * guns);
      if (Math.random() < passes) this.pass(alive);
      if (ctx.flak?.on && Math.random() < FLAK_RATE * ctx.flak.heavy * bias) this.flakHit(alive);
    }
  }

  /** A fighter pass at one bomber of the group: a burst into one or two of its parts, the crew near them hurt. */
  pass(alive) {
    const w = alive.map((b) => (b.straggling ? 5 : 1) * (b.deadEngines ? 2 : 1) * (b.burning ? 1.5 : 1) * (b.histK ?? 1)); // (histK: the records' fates, main.js)
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (r > w[i] && i < w.length - 1) r -= w[i++];
    const b = alive[i], cannon = Math.random() < 0.45;
    for (let k = Math.random() < 0.5 ? 1 : 2; k > 0; k--) {
      const part = PARTS[Math.floor(Math.random() * PARTS.length)];
      for (let n = Math.round(rand(6, 18)); n > 0; n--) b.hit(part, cannon);
      this.wound(b, part, cannon);
    }
    if (this.effects && b.group.visible !== false) this.effects.impact(b.group.position.clone(), true);
  }

  /** Flak: a burst near one bomber of the group. */
  flakHit(alive) {
    const b = alive[Math.floor(Math.random() * alive.length)];
    const part = Math.random() < 0.5 ? ENGINES[Math.floor(Math.random() * ENGINES.length)] : PARTS[Math.floor(Math.random() * PARTS.length)];
    for (let n = Math.round(rand(4, 14)); n > 0; n--) b.hit(part, Math.random() < 0.6);
    if (part.kind === 'engine' && Math.random() < 0.45) b.igniteEngine(part.engine); // (alight from the splinters)
    this.wound(b, part, true);
  }

  wound(b, part, cannon) {
    const c = this.crews.get(b);
    if (!c || part.kind !== 'section') return;
    const p = part.box, at = new THREE.Vector3((p[0] + p[1]) / 2, (p[2] + p[3]) / 2, (p[4] + p[5]) / 2);
    c.onHit(part, at, cannon, null);
  }
}
