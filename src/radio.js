// The intercom: the crew talking. Only a few things are said, and only when they're so: the fighters
// from where they really are, called by the man who can see them; the flak starting and stopping; the
// target; Forts burning and going down near us; our own bomber on fire, as the pilot sees it. What the
// game logs reaches here as a line of text; the ones a man would call are given to him and said aloud,
// his own voice every time, through the headset's crackle. One man talks at a time: the rest wait their
// turn, the urgent ones first, and stale ones are dropped. Long gaps between the calls: never a chatter.
import { LINES, SPEAKERS, allClips, clipId, clockCallers, nameKey, versions, words } from './lines.js';
import { clock } from './fighters.js';
import { surnameOf } from './history.js';

const rand = (a, b) => a + Math.random() * (b - a);
const BANDIT_GAP = 30; // s between two calls of where the fighters are
const MANY_GAP = 240; // s before a big fresh wave is called again even straight after another call
// a crewman by his role, as the game logs it ("Left waist's hit!"), and his surname (the last of his name)
const byTitle = (r, title) => r.crew?.members.find((x) => x.role.title === title);
const surname = (m) => (m ? surnameOf(m.name) : null);

// what the game logs, and what the crew make of it: [pattern, (match, radio) => the lines to say]
const HEARD = [
  [/^Engine (\d) on fire!$/, (m) => `engFire${m[1]}`],
  [/^Engine (\d) is smoking!$/, (m) => `engHit${m[1]}`],
  [/^The (left|right) (?:wing root's badly shot up|wingtip's shot to pieces)!$/, (m, r) => (r.called.has(`wingHole_${m[1]}`) ? null : (r.called.add(`wingHole_${m[1]}`), `wingHole_${m[1]}`))], // (once a wing)
  [/^(.+)'s hit!$/, (m, r) => { // (a placeholder by his name; a real man by his station, then his name)
    const who = byTitle(r, m[1]), n = surname(who);
    if (!who) return null;
    return LINES[`hit_${n}`] && who.placeholder ? { key: `hit_${n}`, note: m[1] } : [{ key: `hitRole_${who.role.id}`, note: who.name }, { key: `name_${nameKey(n)}` }];
  }],
  [/^(.+) is dead\.$/, (m, r) => { // (the man by his role and name as the game has him: "Tail gunner S/Sgt. John W. Hendry Jr. is dead.")
    const who = r.crew?.members.find((x) => m[0] === `${x.role.title} ${x.name} is dead.`), n = surname(who);
    if (!who) return null;
    return LINES[`dead_${n}`] && who.placeholder ? { key: `dead_${n}`, note: who.role.title } : [{ key: `deadRole_${who.role.id}`, note: who.name }, { key: `name_${nameKey(n)}` }];
  }],
  [/^(?:Fire in the|The fire's spreading into the) (left|right) wing!$/, (m) => `wingFire_${m[1]}`],
  [/^Initial point\. Bomb run/, (m, r) => (r.free('pilot') ? ['yourShip', { key: 'myShip', delay: 0.3 }] : null)], // (no "my ship" without the pilot's "your ship": you're the pilot, or he's gone)
  [/^Bombs away!$/, () => 'bombsAway'],
  [/^The Thunderbolts are turning back/, () => 'escortsHome'],
  [/^Flak! Flak dead ahead!$/, () => 'flakAhead'],
  [/^Fighters! A fresh wave/, (m, r) => { r.manyT = r.t; return 'flakStopping'; }], // (the big wave it warns of: no "so many" on top of it)
  [/^Large formation of (?:Fw 190s|fighters) coming in at (\d+) o'clock (high|level|low)! (\d+) of them\.$/, (m, r) => r.bandits(+m[1], m[2], +m[3] >= 6)],
  [/^Fighters, (\d+) o'clock (high|level|low)!$/, (m, r) => r.bandits(+m[1], m[2], false)],
];

export class Radio {
  /** log: puts a line in the game's log (the plain one, not this). */
  constructor(audio, log) {
    Object.assign(this, { audio, log });
    this.t = 0; this.on = false;
    this.queue = []; this.later = []; this.playing = null; this.busyT = 0;
    this.lastSaid = {}; this.lastVer = {};
    this.reset();
    // every man's clips fetched ahead, in the background once the game's loaded (the gunners' first: the
    // co-pilot's many are mostly names, said less often)
    setTimeout(() => audio.prefetchVoices(allClips().map((c) => c.id).sort((a, b) => a.endsWith('.copilot') - b.endsWith('.copilot'))), 6000);
  }

  /** A new life aboard: forget what's been said (the distance, the fighters seen, the Forts lost). */
  reset() {
    this.queue.length = 0; this.later.length = 0; this.playing?.h?.stop(); this.playing = null; this.busyT = 0; this.onCaption?.(null);
    this.called = new Set(); this.down = null; this.banditT = -1e9; this.manyT = -1e9; this.seenBandits = false;
    this.fireSaid = false; this.fireClearT = 0; this.fortT = -1e9; this.hellT = -1e9;
  }

  /** Who's aboard and which of them you are. on: you're in the bomber, alive, to hear it. */
  set(on, crew, me) {
    if (!on && this.on) { this.queue.length = 0; this.later.length = 0; this.playing?.h?.stop(); this.playing = null; this.busyT = 0; this.onCaption?.(null); }
    Object.assign(this, { on, crew, me });
  }

  /** Can this man talk? On the intercom, not hurt or dead, not gone, and not you. */
  free(id) {
    if (id === this.me) return false;
    const m = this.crew?.members.find((x) => x.role.id === id);
    return !!m && m.state === 'ok';
  }

  /**
   * A line the game logged: if it's one the crew would call, it's said (and logged as said, with who
   * said it), and this returns true; otherwise false, and the game logs it as it was.
   */
  hear(text) {
    if (!this.on) return false;
    for (const [re, fn] of HEARD) {
      const m = text.match(re);
      if (!m) continue;
      let lines = fn(m, this);
      if (!lines) return false;
      lines = (Array.isArray(lines) ? lines : [lines]).map((l) => (typeof l === 'string' ? { key: l } : l));
      for (const [i, l] of lines.entries()) if (!this.say(l.key, { ...l, fallback: i === 0 ? text : null })) break; // (the rest of a call only if its start was said)
      return true;
    }
    return false;
  }

  /**
   * Fighters coming at us from `h` o'clock, `level`, where they are now: just where, never how many ("a whole
   * gaggle", "so many of them": cut, they grated). The first of the fight or a big fresh wave (`big`) is
   * always called; after that only now and then, never a running commentary.
   */
  bandits(h, level, big) {
    const many = !this.seenBandits || (big && this.t - this.manyT > MANY_GAP);
    if (!many && this.t - this.banditT < BANDIT_GAP) return null; // (just said where they are: the log has it)
    this.seenBandits = true; this.banditT = this.t;
    if (many) this.manyT = this.t;
    return `bandits${h}_${level}`;
  }

  /**
   * Have a man say line `key`. by: who (else the first free man of the line's own); delay: s from now;
   * fallback: shown if nobody's free to say it.
   */
  say(key, { by, delay = 0, fallback = null, note = null } = {}) {
    if (!this.on || !LINES[key]) return false;
    if (delay > 0) { this.later.push({ key, by, fallback, note, at: this.t + delay }); return true; }
    const l = LINES[key];
    if (l.gap && this.t - (this.lastSaid[l.group ?? key] ?? -1e9) < l.gap) { if (fallback) this.log(fallback); return false; } // (said just now: not again yet)
    const free = (by ? [by, ...l.by] : l.by).filter((s) => l.by.includes(s) && this.free(s));
    const spk = (l.any ? free[Math.floor(Math.random() * free.length)] : free[0]) ?? null;
    if (!spk) { if (fallback) this.log(fallback); return false; } // (nobody left to say it: just the news)
    // which way he says it: any but the one said last
    const n = versions(key, spk).length, last = this.lastVer[`${key}.${spk}`];
    let i = Math.floor(Math.random() * n);
    if (n > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.lastVer[`${key}.${spk}`] = i;
    const text = words(key, spk, i);
    this.log(`${SPEAKERS[spk].label}: ${text}${note ? ` (${note})` : ''}`);
    this.lastSaid[key] = this.t;
    if (l.group) this.lastSaid[l.group] = this.t;
    // (a newer call of where the fighters are replaces the one still waiting)
    if (key.startsWith('bandits')) this.queue = this.queue.filter((q) => !q.key.startsWith('bandits'));
    const at = key.startsWith('bandits') ? this.fighters?.callAt ?? null : null; // (where they were called from: checked again when it's said)
    this.queue.push({ key, i, spk, pri: l.pri, ttl: l.ttl ?? (l.pri >= 3 ? 5 : l.pri === 2 ? 8 : 14), born: this.t, text, at });
    this.audio.voiceClip(clipId(key, i, SPEAKERS[spk].voice)); // (fetched now, ready by its turn)
    if (this.queue.length > 4) { // (too much at once: the least of it goes unsaid)
      this.queue.sort((a, b) => b.pri - a.pri || a.born - b.born);
      this.queue.length = 4;
    }
    // an urgent call cuts in over the rest
    if (l.pri >= 3 && this.playing && this.playing.pri <= 1) { this.playing.h?.stop(); this.playing = null; this.busyT = 0.15; this.onCaption?.(null); }
    return true;
  }

  /**
   * Each frame. s: { phase, toGo (m, the target from the crosshair), quietT (s since the last fighter
   * turned for home), bombers, bomber }.
   */
  update(dt, s) {
    this.t += dt;
    for (let i = this.later.length - 1; i >= 0; i--) if (this.later[i].at <= this.t) { const l = this.later.splice(i, 1)[0]; this.say(l.key, l); }
    if (this.on && s) this.notice(dt, s);
    // the next man on the intercom
    if (this.playing && this.t > this.playing.ends) this.onCaption?.(null);
    if ((this.busyT -= dt) > 0) return;
    this.playing = null;
    this.queue = this.queue.filter((q) => this.t - q.born < q.ttl); // (old news, unsaid)
    if (!this.on || !this.queue.length) return;
    this.queue.sort((a, b) => b.pri - a.pri || a.born - b.born);
    if (!this.stillThere(this.queue[0], s?.bomber)) { this.queue.shift(); return; }
    const q = this.queue[0], sp = SPEAKERS[q.spk], id = clipId(q.key, q.i ?? 0, sp.voice), buf = this.audio.voiceClip(id);
    if (buf === null && this.t - (q.asked ??= this.t) < 5) return; // (still on its way: a moment more)
    this.queue.shift();
    const h = buf ? this.audio.voice(id, { rate: sp.rate, far: sp.far }) : null;
    if (!h) return; // (not here in time, or failed: left unsaid. Never the browser's own voice: a robot, and not his)
    const dur = h.dur;
    this.playing = { ...q, h, ends: this.t + dur + 0.4 };
    this.busyT = dur + rand(0.4, 0.8);
    this.onCaption?.(sp.label, q.text);
  }

  /**
   * A call of where the fighters are, about to be said after waiting its turn: the clock again from where
   * they were called (the formation may have turned since). An hour out, it's said as it is now (if the
   * same man would call it); further, or high or low changed, it's old news: dropped.
   */
  stillThere(q, bomber) {
    if (!q.at || !bomber) return true;
    const m = /^(banditsMany|bandits)(\d+)_(\w+)$/.exec(q.key);
    if (!m) return true;
    const c = clock(bomber, q.at), off = Math.abs(c.h - +m[2]) % 12, hours = Math.min(off, 12 - off);
    if (hours === 0 && c.level === m[3]) return true;
    const key = `${m[1]}${c.h}_${c.level}`;
    if (hours > 1 || c.level !== m[3] || !LINES[key]?.by.includes(q.spk)) return false;
    q.key = key; q.text = words(key, q.spk, q.i);
    return true;
  }

  /** The things the crew call of their own accord, from what they can see. */
  notice(dt, s) {
    const once = (key, cond) => { if (cond && !this.called.has(key)) { this.called.add(key); this.say(key); } };
    // the navigator: twenty kilometres to the target
    if (s.phase === 'outbound' || s.phase === 'bombrun') once('km20', s.toGo < 20000 && s.toGo > 17000);
    // the fighters all gone home
    once('lastOfThem', s.phase === 'homeward' && s.quietT > 4);
    // the Forts near us: several burning at once; one going down (said by the man who can see it)
    let burning = 0;
    this.down ??= new Set(s.bombers.filter((b) => b.down)); // (a new life: the Forts already gone down aren't news)
    for (const b of s.bombers) {
      if (b === s.bomber || b.gone) continue;
      const dist = b.group.position.distanceTo(s.bomber.group.position);
      if (dist < 2500 && (b.burning || b.down)) burning++;
      if (!b.down || this.down.has(b)) continue;
      this.down.add(b);
      if (dist > 2000 || this.t - this.fortT < 60) continue; // (not every one: at most one a minute)
      this.fortT = this.t;
      const d = s.bomber.group.worldToLocal(b.group.position.clone()), up = Math.max(150, Math.hypot(d.x, d.z) * 0.14);
      const sees = clockCallers(clockOf(d), d.y > up ? 'high' : d.y < -up ? 'low' : 'level');
      this.say('fortDown', { by: sees.find((x) => this.free(x)) });
      if (this.t - this.hellT > 180) { this.hellT = this.t; this.say('giveEmHell', { delay: 3 }); }
    }
    // a gaggle diving on a Fort close by: "they're going for Miller's ship!" (her pilot), from the side it's on
    if (this.fighters && this.crews && this.t - (this.lastSaid.goingFor ?? -1e9) > 75) {
      const f = this.fighters.axis.find((x) => x.state === 'attack' && x.target && x.target !== s.bomber && !x.target.down && !x.player
        && x.target.group.position.distanceTo(s.bomber.group.position) < 700);
      const n = f && surname(this.crews.get(f.target)?.members.find((x) => x.role.id === 'pilot'));
      const real = n && LINES[`goingForP_${nameKey(n)}`] && !this.crews.get(f.target)?.members.find((x) => x.role.id === 'pilot')?.placeholder;
      if (real) this.say(`goingForP_${nameKey(n)}`); // (a real pilot's name: recorded by the top turret)
      else if (n && LINES[`goingFor_${n}`]) {
        const d = s.bomber.group.worldToLocal(f.target.group.position.clone());
        this.say(`goingFor_${n}`, { by: d.x < -60 ? 'waistL' : d.x > 60 ? 'waistR' : 'engineer' });
      }
    }
    // (once, until the sky's clear of burning Forts for a while and it happens again)
    if (burning >= 2 && !this.fireSaid) { this.fireSaid = true; this.say('fortsFire'); }
    this.fireClearT = burning ? 0 : this.fireClearT + dt;
    if (this.fireClearT > 45) this.fireSaid = false;
  }
}

const clockOf = (d) => { const h = Math.round((Math.atan2(-d.x, -d.z) * -6) / Math.PI); return ((h % 12) + 12) % 12 || 12; };
