// Your score: for each life (each sortie, or each crewman you play) and for the whole mission.
// Counters only; the fighters and the bombers report into it.

export const POINTS = { kill: 100, bomber: 300, assist: 50, crit: 25 };
export const ASSIST_WINDOW = 20; // s: you hit it, someone else finished it within this time

const blank = (role = '') => ({ role, kills: 0, bombers: 0, assists: 0, crits: 0, hits: 0, fired: 0, damage: 0, points: 0, time: 0 });

export class Stats {
  constructor() {
    this.life = blank();
    this.mission = blank();
    this.lives = 0;
  }

  /** A new life starts: a fresh sortie, or another crewman. */
  newLife(role) { this.life = blank(role); this.lives++; }

  add(key, n = 1) { this.life[key] += n; this.mission[key] += n; }

  fired(n) { if (n) this.add('fired', n); }
  /** dmg: damage points of the round (a 20 mm shell counts 3). */
  hit(dmg) { this.add('hits'); this.add('damage', dmg); }
  kill(bomber = false) { this.add(bomber ? 'bombers' : 'kills'); this.add('points', bomber ? POINTS.bomber : POINTS.kill); }
  assist() { this.add('assists'); this.add('points', POINTS.assist); }
  crit() { this.add('crits'); this.add('points', POINTS.crit); }
  tick(dt) { this.life.time += dt; this.mission.time += dt; }

  static accuracy(s) { return s.fired ? (100 * s.hits) / s.fired : 0; }
}
