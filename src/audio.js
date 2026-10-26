// All sound is made with the Web Audio API (no files). Starts only after the player clicks Start.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class GameAudio {
  constructor() { this.volume = 1; this.muted = false; }

  /** The volume (0..1, 1 = as loud as it was made) and mute; applied at once if sound is running. */
  setVolume(volume, muted) {
    this.volume = clamp(volume, 0, 1); this.muted = muted;
    if (this.master) this.master.gain.value = this.level;
  }

  get level() { return this.muted ? 0 : 0.5 * this.volume; }

  start() {
    if (this.ctx) return this.resume();
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.level;
    this.master.connect(ctx.destination);
    this.engines();
  }

  /** Four Wright Cyclones heard through the fuselage: detuned low saws, beating slowly, plus wind. */
  engines() {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.7;
    const gain = (this.bomberGain = ctx.createGain()); // faded out while you fly a fighter
    gain.gain.value = 0.22;
    lp.connect(gain).connect(this.master);
    for (const [i, f] of [38.5, 39.1, 39.8, 40.3].entries()) {
      for (const [mult, type, level] of [[1, 'sawtooth', 0.5], [2, 'square', 0.12], [4.5, 'triangle', 0.05]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult;
        o.detune.value = i * 7;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(lp);
        o.start();
      }
    }
    // wind / slipstream rumble
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = last * 6; }
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 180;
    bp.Q.value = 0.5;
    const ng = (this.windGain = ctx.createGain());
    ng.gain.value = 0.35;
    noise.connect(bp).connect(ng).connect(this.master);
    noise.start();
  }

  /**
   * Your own fighter's engine, or null back in the B-17. A V12 heard from the cockpit: the firing note
   * (rises with throttle) over an exhaust crackle an octave down. The 109's DB 601 runs lower and rougher
   * than the P-51's Merlin. The slipstream gets louder with speed.
   */
  ownEngine(kind, throttle = 0, speed = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!kind) {
      if (this.ownKind === null) return; // already back in the B-17
      this.fighterEng?.gain.gain.setTargetAtTime(0, t, 0.3); // (kept, silent, for the next sortie)
      this.bomberGain?.gain.setTargetAtTime(0.22, t, 0.5);
      this.windGain?.gain.setTargetAtTime(0.35, t, 0.5);
      this.ownKind = null;
      return;
    }
    if (!this.fighterEng) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      lp.connect(gain).connect(this.master);
      const voices = [[1, 'sawtooth'], [0.5, 'square'], [2.01, 'triangle'], [0.25, 'sawtooth']].map(([m, type]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; g.gain.value = 0;
        o.connect(g).connect(lp); o.start();
        return { o, g, m };
      });
      // a slow wobble: the exhaust stacks beating
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 7; lg.gain.value = 6; lfo.connect(lg);
      for (const v of voices) lg.connect(v.o.detune);
      lfo.start();
      this.fighterEng = { gain, lp, voices };
    }
    const e = this.fighterEng;
    if (this.ownKind !== kind) { // the two engines' character: levels of each voice
      const mix = kind === 'bf109' ? [0.35, 0.3, 0.06, 0.22] : kind === 'fw190' ? [0.5, 0.26, 0.1, 0.16] : [0.45, 0.18, 0.1, 0.1];
      e.voices.forEach((v, i) => v.g.gain.setTargetAtTime(mix[i], t, 0.1));
      e.lp.frequency.setTargetAtTime(kind === 'bf109' ? 1100 : kind === 'fw190' ? 900 : 1600, t, 0.1);
      this.ownKind = kind;
    }
    const base = (kind === 'bf109' ? 82 : kind === 'fw190' ? 68 : 96) * (0.7 + 0.55 * throttle); // Hz (the BMW radial deeper still)
    for (const v of e.voices) v.o.frequency.setTargetAtTime(base * v.m, t, 0.15);
    e.gain.gain.setTargetAtTime(0.16 + throttle * 0.08, t, 0.2);
    this.bomberGain?.gain.setTargetAtTime(0, t, 0.4); // the bombers' drone is outside now
    this.windGain?.gain.setTargetAtTime(clamp(speed / 260, 0.15, 1) * 0.45, t, 0.3);
  }

  /** A short cue for your score: a kill (two rising notes), an assist (one soft note), a crit (a low ping). */
  chime(kind) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = { kill: [[660, 0], [990, 0.11]], assist: [[740, 0]], crit: [[330, 0]] }[kind] ?? [];
    for (const [f, at] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = kind === 'crit' ? 'triangle' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(kind === 'kill' ? 0.22 : 0.14, t + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + (kind === 'kill' ? 0.35 : 0.22));
      o.connect(g).connect(this.master);
      o.start(t + at); o.stop(t + at + 0.4);
    }
  }

  /** A powered turret's motors: an electric whine rising with how fast it's turning (0 = still). */
  turretWhine(speed) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.whine) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o2.type = 'square'; bp.type = 'bandpass'; bp.Q.value = 3; g.gain.value = 0;
      o.connect(bp); o2.connect(bp); bp.connect(g).connect(this.master); o.start(); o2.start();
      this.whine = { o, o2, bp, g };
    }
    const k = Math.min(1, speed / 1.05), t = ctx.currentTime, w = this.whine;
    w.o.frequency.setTargetAtTime(180 + 420 * k, t, 0.08); w.o2.frequency.setTargetAtTime(362 + 840 * k, t, 0.08);
    w.bp.frequency.setTargetAtTime(500 + 1300 * k, t, 0.08);
    w.g.gain.setTargetAtTime(k > 0.02 ? 0.025 + 0.06 * k : 0, t, 0.06);
  }

  noise() { // shared 1 s of white noise for gunshots and clanks
    if (!this.noiseBuf) {
      const ctx = this.ctx;
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    return s;
  }

  /** One .50 cal round: a sharp crack plus a low thump through the airframe. vol: 1 = your own gun. */
  gunshot(vol = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.master);
    const t = ctx.currentTime;
    const crack = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 500;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    crack.connect(bp).connect(g).connect(out);
    crack.start(t, Math.random() * 0.8, 0.1);

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(120, t);
    thump.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.7, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    thump.connect(tg).connect(out);
    thump.start(t);
    thump.stop(t + 0.12);
  }

  /** Metallic clanks: the old ammo can coming off (start) or the new belt locking in (end). */
  reload(start, vol = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.master);
    const hits = start ? [0, 0.18, 0.5] : [0, 0.12];
    for (const [i, dt] of hits.entries()) {
      const t = ctx.currentTime + dt;
      const n = this.noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (start ? 2400 : 3200) - i * 300;
      bp.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      n.connect(bp).connect(g).connect(out);
      n.start(t, Math.random() * 0.5, 0.15);
    }
  }

  /** Heartbeat while you're wounded: faster as time runs out (call each frame with 0..1). */
  heartbeat(urgency, dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.beatT = (this.beatT ?? 0) - dt;
    if (urgency <= 0 || this.beatT > 0) return;
    this.beatT = 1.1 - urgency * 0.6;
    for (const [i, d] of [0, 0.18].entries()) {
      const t = ctx.currentTime + d, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(60 - i * 8, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.12);
      g.gain.setValueAtTime(0.9 - i * 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.18);
    }
  }

  /** Hiss of an overheated barrel. */
  overheat() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t, 0, 0.95);
  }

  /** Snarl of the nearest Bf 109: louder as it closes, pitch shifted by closing speed (Doppler). */
  fighterDrone(dist, closing) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.drone) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0;
      lp.connect(g).connect(this.master);
      const oscs = [1, 1.5, 2.02].map((m, i) => {
        const o = ctx.createOscillator();
        o.type = i ? 'square' : 'sawtooth';
        const og = ctx.createGain();
        og.gain.value = [0.5, 0.15, 0.1][i];
        o.connect(og).connect(lp);
        o.start();
        return [o, m];
      });
      this.drone = { g, oscs };
    }
    const near = Number.isFinite(dist) ? dist : 1e9;
    const vol = Math.min(0.5, 120 / Math.max(near, 60)) ** 1.3;
    const doppler = 343 / Math.max(120, 343 - clamp(Number.isFinite(closing) ? closing : 0, -250, 250));
    const t = ctx.currentTime;
    this.drone.g.gain.setTargetAtTime(vol * 0.6, t, 0.1);
    for (const [o, m] of this.drone.oscs) o.frequency.setTargetAtTime(95 * m * doppler, t, 0.1);
  }

  /** German guns heard from a distance. */
  distantGun(dist) {
    const ctx = this.ctx;
    if (!ctx || dist > 900) return;
    const t = ctx.currentTime, n = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.4, 60 / dist), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.8, 0.13);
  }

  /**
   * A round striking our own airframe, clear over everything else: the sharp crack of it punching
   * through the aluminium, a metallic ring, and for a 20 mm shell the bang of it going off.
   */
  impact(cannon, vol = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // the crack: a very short bright burst
    const n = this.noise(), hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.06);
    // the skin tearing: a short rasp of torn aluminium (no ring: thin skin punched through doesn't ring)
    const r = this.noise(), bp = ctx.createBiquadFilter(), rg = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 900; bp.Q.value = 1.2;
    rg.gain.setValueAtTime(0.55 * vol, t + 0.004); rg.gain.exponentialRampToValueAtTime(0.001, t + 0.07 + Math.random() * 0.04);
    r.connect(bp).connect(rg).connect(this.master);
    r.start(t + 0.004, Math.random() * 0.5, 0.12);
    // and the knock of it through the airframe: a dull thud
    const k = this.noise(), lp = ctx.createBiquadFilter(), kg = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    kg.gain.setValueAtTime(0.7 * vol, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    k.connect(lp).connect(kg).connect(this.master);
    k.start(t, Math.random() * 0.5, 0.1);
    if (cannon) { // the shell bursting: a deep bang
      const m = this.noise(), lp = ctx.createBiquadFilter(), mg = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 520;
      mg.gain.setValueAtTime(1.3 * vol, t + 0.01); mg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      m.connect(lp).connect(mg).connect(this.master);
      m.start(t + 0.01, Math.random() * 0.4, 0.5);
    }
  }

  /**
   * A man hurt (severe: going down). A voiced grunt: a buzzy tone pushed through two vowel formants, its
   * pitch falling, with breath noise. vol 0..1 (far down the fuselage, quieter); deep varies the voice.
   */
  pain(vol = 1, severe = false, deep = 0) {
    const ctx = this.ctx;
    if (!ctx || vol < 0.03) return;
    const t = ctx.currentTime + 0.02, len = severe ? 0.75 : 0.28 + Math.random() * 0.12;
    const f0 = (severe ? 175 : 150) * (0.85 + deep * 0.3) * (0.92 + Math.random() * 0.16);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.15, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (severe ? 0.62 : 0.78), t + len);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.03);
    out.gain.setValueAtTime(0.5 * vol, t + len * 0.55);
    out.gain.exponentialRampToValueAtTime(0.0001, t + len);
    for (const [f, q, a] of [[severe ? 760 : 620, 6, 1], [severe ? 1180 : 1050, 8, 0.6], [2500, 10, 0.18]]) { // the "ah" / "uh"
      const bp = ctx.createBiquadFilter(), bg = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; bg.gain.value = a;
      o.connect(bp).connect(bg).connect(out);
    }
    const br = this.noise(), bf = ctx.createBiquadFilter(), bgain = ctx.createGain(); // breath
    bf.type = 'bandpass'; bf.frequency.value = 1400; bf.Q.value = 1;
    bgain.gain.value = 0.12;
    br.connect(bf).connect(bgain).connect(out);
    out.connect(this.master);
    o.start(t); o.stop(t + len + 0.05);
    br.start(t, Math.random() * 0.5, len + 0.05);
  }

  /** A flak burst: a hard crump, close ones loud and sharp, far ones a dull thud. */
  /** A flak burst at `dist` m: the deep crump of it (later and duller far off), a sharp crack on top when near. */
  flak(dist, muffle = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + Math.min(dist / 343, 3), n = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(140, (1600 - dist * 1.2) * (1 - 0.4 * muffle));
    const g = ctx.createGain(), v = Math.min(1.6, 180 / Math.max(dist, 30));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9 + Math.min(1, dist / 800));
    n.connect(lp).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.3, 2);
    if (dist < 400) { // close: the crack of the shell itself
      const c = this.noise(), hp = ctx.createBiquadFilter(), cg = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1500;
      cg.gain.setValueAtTime(Math.min(1.2, 90 / Math.max(dist, 20)), t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      c.connect(hp).connect(cg).connect(this.master);
      c.start(t, Math.random() * 0.4, 0.09);
    }
  }

  /**
   * A burst close to your bomber (k 0..1, nearer = 1): the thump through the airframe, and the fragments
   * rattling on the skin like thrown gravel, a scatter of small hard ticks.
   */
  flakClose(k) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator(), og = ctx.createGain(); // the airframe's thump
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(1.1 * k, t + 0.015); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.5);
    const ticks = Math.round(6 + k * 26);
    for (let i = 0; i < ticks; i++) { // the rattle: fragments arrive a little after the blast, spread out
      const at = t + 0.06 + Math.random() * (0.15 + 0.35 * Math.random()), n = this.noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2500 + Math.random() * 3500; bp.Q.value = 2.5;
      g.gain.setValueAtTime((0.25 + 0.5 * Math.random()) * k, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.012 + Math.random() * 0.02);
      n.connect(bp).connect(g).connect(this.master); n.start(at, Math.random() * 0.5, 0.04);
    }
  }

  /** A plane blowing up: a deep boom, quieter and duller with distance. */
  explosion(dist) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + Math.min(dist / 343, 4), n = this.noise(); // sound arrives late
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(150, 1200 - dist * 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1.2, 400 / Math.max(dist, 50)), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t, 0, 1);
  }

  /** Thunder: a crack if it's close, then a long low rumble, arriving late from `dist` m away. */
  thunder(dist) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + Math.min(dist / 343, 12), dur = 2.5 + Math.min(dist / 2500, 3);
    const n = ctx.createBufferSource();
    n.buffer = this.noise().buffer;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(dist < 3000 ? 900 : 380, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + dur);
    const g = ctx.createGain(), v = Math.min(1.1, 2600 / dist);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.08);
    g.gain.setValueAtTime(v * 0.5, t + 0.5);
    g.gain.linearRampToValueAtTime(v * 0.7, t + 1.1); // (the rumble rolls on)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + dur + 0.1);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
