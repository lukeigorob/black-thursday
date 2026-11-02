// The German fighters' radio (the FuG 16): what you hear flying a Bf 109 or an Fw 190. Real voices: a
// night fighter crew's radio traffic recorded in 1944 (the static taken out), cut into its calls. Their
// cover words were the same by day: the ground station calling, "Pauke, Pauke!" as a man goes in to
// attack, "Viktor" for understood. Each is said only when it's so: "Pauke" when a fighter near you really
// does start his attack on the bombers. public/audio/funk/<id>.mp3, from the recording published as
// "Original Luftwaffe Radio Chatter 1944 / Nightfighter" (youtube.com/watch?v=PXwbmkS9kYA), denoised.
const URL = 'audio/funk';
const CLIPS = {
  leit: { ids: ['leit_1', 'leit_2'], text: 'Bodenstelle: "… Delta …"', note: 'ground control calling' },
  pauke: { ids: ['pauke_1', 'pauke_2', 'pauke_3', 'pauke_4'], text: '"Pauke, Pauke!"', note: 'going in to attack' },
  viktor: { ids: ['viktor_1', 'viktor_2'], text: '"Viktor, Viktor."', note: 'understood' },
  vor: { ids: ['vorwaerts'], text: '"Vorwärts!"', note: 'go in!' },
};
const rand = (a, b) => a + Math.random() * (b - a);
const PAUKE_GAP = 20; // s between two "Pauke"s (a gaggle all going in at once: one call)
const PAUKE_NEAR = 2500; // m: a man close enough to be in your Staffel

export class Funk {
  /** log: the game's log, for what was said and what it means. */
  constructor(audio, log) {
    Object.assign(this, { audio, log });
    this.on = false; this.t = 0;
    this.reset();
  }

  reset() {
    this.q = []; this.playing?.h?.stop(); this.playing = null; this.busyT = 0;
    this.leitT = rand(3, 6); this.paukeT = -1e9; this.vorSaid = false; this.going = new WeakSet(); this.last = {};
  }

  /** Each frame. s: { on (flying a German fighter, alive), me (your fighter), fighters, bombers }. */
  update(dt, s) {
    this.t += dt;
    if (s.on !== this.on) {
      this.on = s.on;
      this.reset();
      if (this.on && !this.warmed) { this.warmed = true; for (const c of Object.values(CLIPS)) for (const id of c.ids) this.audio.voiceClip(id, URL); }
    }
    if (!this.on || !s.me) return;
    this.notice(dt, s);
    if ((this.busyT -= dt) > 0) return;
    this.playing = null;
    this.q = this.q.filter((x) => this.t - x.at < 6); // (old news, unsaid)
    const i = this.q.findIndex((x) => x.at <= this.t);
    if (i < 0) return;
    const x = this.q[i], c = CLIPS[x.kind];
    // which take: any but the one heard last
    let id = c.ids[Math.floor(Math.random() * c.ids.length)];
    if (c.ids.length > 1 && id === this.last[x.kind]) id = c.ids[(c.ids.indexOf(id) + 1) % c.ids.length];
    const buf = this.audio.voiceClip(id, URL);
    if (buf === null) return; // (still on its way)
    this.q.splice(i, 1);
    const h = buf && this.audio.voice(id, { url: URL, vol: 0.9 });
    if (!h) return;
    this.last[x.kind] = id;
    this.playing = { h };
    this.busyT = h.dur + rand(0.4, 1);
    this.log(`Funk: ${c.text} (${c.note})`);
    // ground control answered, as often as not
    if (x.kind === 'leit' && Math.random() < 0.65) this.say('viktor', h.dur + rand(0.6, 1.4));
  }

  say(kind, delay = 0) {
    if (kind === 'pauke') this.q = this.q.filter((x) => x.kind !== 'leit'); // (the fight before the chatter)
    this.q.push({ kind, at: this.t + delay });
    if (this.q.length > 3) this.q.shift();
  }

  notice(dt, s) {
    const me = s.me.pos;
    // a man of yours going in on the bombers
    if (this.t - this.paukeT > PAUKE_GAP) {
      const f = s.fighters.axis.find((x) => x !== s.me && x.alive && x.state === 'attack' && x.target && !this.going.has(x) && x.pos.distanceTo(me) < PAUKE_NEAR);
      if (f) { this.going.add(f); this.paukeT = this.t; this.say('pauke', rand(0.2, 0.8)); }
    }
    for (const f of s.fighters.axis) if (f.state !== 'attack') this.going.delete(f); // (his next attack is news again)
    // closing on the bombers the first time: go in
    if (!this.vorSaid && s.bombers.some((b) => !b.down && b.group.position.distanceTo(me) < 4000)) { this.vorSaid = true; this.say('vor', 0.5); }
    // the ground station between the fights
    if ((this.leitT -= dt) <= 0) {
      this.leitT = rand(45, 80);
      if (this.t - this.paukeT > 15) this.say('leit');
    }
  }
}
