// All sound is made with the Web Audio API (no files). Starts only after the player clicks Start.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// (a setting eased toward `v`, as setTargetAtTime: but not again if it's already heading there. Called
// every frame, each call is one more event on the param's timeline for the browser to work through)
const glide = (p, v, t, tau) => { if (p._to !== undefined && Math.abs(v - p._to) <= Math.abs(p._to) * 0.005 + 1e-5) return; p._to = v; p.setTargetAtTime(v, t, tau); };
export const MIX = { guns: 1, engines: 1, battle: 1, crew: 1, ui: 0.8 }; // the channels of the mix, at full

/**
 * Two seconds of an electric alarm bell, made once, to loop: a steel gong's ringing tones (a struck bell's
 * partials aren't harmonics of each other: that's its clang), each struck again 18 times a second by the
 * hammer before it's died away, so it rings on continuously; the hammer's tick on each stroke, a little
 * uneven, the same every two seconds so the loop doesn't show.
 */
function bellBuffer(ctx) {
  const sr = ctx.sampleRate, n = Math.round(sr * 2), RATE = 18, F0 = 820;
  const MODES = [[1, 1, 3.2], [1.51, 0.55, 4], [2.02, 0.4, 5], [2.76, 0.5, 6], [3.79, 0.28, 8], [5.4, 0.18, 11], [7.1, 0.1, 14]]; // [freq x F0, level, decay /s]
  const strikes = RATE * 2, hit = Array.from({ length: strikes }, (_, k) => 0.82 + 0.18 * Math.abs(Math.sin(k * 12.9898) * 43758.5453 % 1)); // (each stroke a little harder or softer)
  const out = new Float32Array(n);
  // each ringing tone a resonator the hammer's strokes keep going (it never dies between them); run four
  // seconds and keep the last two, by when it's ringing steadily, so the loop's ends meet
  const at = (i) => { const p = (i % n) / sr * RATE, k = Math.floor(p); return p - k < RATE / sr ? hit[k % strikes] : 0; }; // (a stroke: one sample's kick)
  for (const [m, v, d] of MODES) {
    const w = (2 * Math.PI * F0 * m) / sr, r = Math.exp(-d / sr), c1 = 2 * r * Math.cos(w), c2 = -r * r;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < 2 * n; i++) {
      const y = c1 * y1 + c2 * y2 + at(i) * v * Math.sin(w);
      y2 = y1; y1 = y;
      if (i >= n) out[i - n] += y;
    }
  }
  // the hammer's tick on each stroke: a few milliseconds of hard click
  for (let k = 0; k < strikes; k++) {
    const i0 = Math.round((k / RATE) * sr);
    for (let j = 0; j < sr * 0.004 && i0 + j < n; j++) out[i0 + j] += (Math.sin(j * 1.7) * 0.6 + Math.sin(j * 0.9)) * hit[k] * 0.9 * (1 - j / (sr * 0.004));
  }
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] = Math.tanh((out[i] / peak) * 1.6) / Math.tanh(1.6); // (a little hard, as a bell is up close)
  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(out, 0);
  return buf;
}

export class GameAudio {
  constructor() { this.volume = 1; this.muted = false; this.mix = { ...MIX }; }

  /**
   * The volume (0..1, 1 = as loud as it was made) and mute, and the mix: each channel's own level
   * (guns, engines, battle: flak, hits and explosions, crew: voices, heartbeat, the turret's motor).
   * Applied at once if sound is running.
   */
  setVolume(volume, muted, mix = this.mix) {
    this.volume = clamp(volume, 0, 1); this.muted = muted; this.mix = { ...MIX, ...mix };
    if (this.master) this.master.gain.value = this.level;
    if (this.bus) for (const k of Object.keys(MIX)) this.bus[k].gain.value = clamp(this.mix[k], 0, 1);
  }

  get level() { return this.muted ? 0 : 0.5 * this.volume; }

  start() {
    if (this.enginesOn) return this.resume();
    this.ensure();
    this.enginesOn = true;
    this.engines();
    this.resume();
  }

  /** The sound system itself, without the engines yet (the menus' clicks, from the first click on). */
  ensure() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.level;
    this.master.connect(ctx.destination);
    this.bus = {};
    for (const k of Object.keys(MIX)) { const g = (this.bus[k] = ctx.createGain()); g.gain.value = clamp(this.mix[k], 0, 1); g.connect(this.master); }
  }

  /**
   * The bail-out bell, on (true) or off: the B-17's alarm bell was an electric one, a hammer on a steel gong
   * buzzing at it twenty times a second, a fire or school bell's continuous clanging ring. Rung while it's
   * on; let go, it rings on a moment and dies away.
   */
  bellRing(on) {
    const ctx = this.ctx;
    if (!ctx || !!on === !!this.bellOn) return;
    const t = ctx.currentTime;
    if (on) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = this.bellBuf ??= bellBuffer(ctx);
      src.loop = true;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.02);
      src.connect(g).connect(this.bus.crew);
      src.start(t);
      this.bellOn = { src, g };
    } else {
      const { src, g } = this.bellOn;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0, t, 0.12); // (the gong rings out)
      src.stop(t + 0.8);
      this.bellOn = null;
    }
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
    lp.connect(gain).connect(this.bus.engines);
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
    noise.connect(bp).connect(ng).connect(this.bus.engines);
    noise.start();
  }

  /**
   * Your own fighter's engine, or null back in the B-17. A V12 heard from the cockpit: the firing note
   * (rises with throttle) over an exhaust crackle an octave down. The 109's DB 601 runs lower and rougher
   * than the P-47's R-2800. The slipstream gets louder with speed.
   */
  ownEngine(kind, throttle = 0, speed = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!kind) {
      if (this.ownKind === null) return; // already back in the B-17
      this.fighterEng && glide(this.fighterEng.gain.gain, 0, t, 0.3); // (kept, silent, for the next sortie)
      this.bomberGain && glide(this.bomberGain.gain, 0.22, t, 0.5);
      this.windGain && glide(this.windGain.gain, 0.35, t, 0.5);
      this.ownKind = null;
      return;
    }
    if (!this.fighterEng) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      lp.connect(gain).connect(this.bus.engines);
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
      e.voices.forEach((v, i) => glide(v.g.gain, mix[i], t, 0.1));
      glide(e.lp.frequency, kind === 'bf109' ? 1100 : kind === 'fw190' ? 900 : 1600, t, 0.1);
      this.ownKind = kind;
    }
    const base = (kind === 'bf109' ? 82 : kind === 'fw190' ? 68 : 96) * (0.7 + 0.55 * throttle); // Hz (the BMW radial deeper still)
    for (const v of e.voices) glide(v.o.frequency, base * v.m, t, 0.15);
    glide(e.gain.gain, 0.16 + throttle * 0.08, t, 0.2);
    this.bomberGain && glide(this.bomberGain.gain, 0, t, 0.4); // the bombers' drone is outside now
    this.windGain && glide(this.windGain.gain, clamp(speed / 260, 0.15, 1) * 0.45, t, 0.3);
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
      o.connect(g).connect(this.bus.crew);
      o.start(t + at); o.stop(t + at + 0.4);
    }
  }

  /** A powered turret's motors: a soft electric hum under everything, rising with how fast it's turning (0 = still). */
  turretWhine(speed) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.whine) { // (rounded waves through a low-pass: a hum, not a buzz)
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'triangle'; o2.type = 'sine'; bp.type = 'bandpass'; bp.Q.value = 1.2; lp.type = 'lowpass'; lp.frequency.value = 700; g.gain.value = 0;
      o.connect(bp); o2.connect(bp); bp.connect(lp).connect(g).connect(this.bus.crew); o.start(); o2.start();
      this.whine = { o, o2, bp, g };
    }
    const k = Math.min(1, speed / 1.05), t = ctx.currentTime, w = this.whine;
    glide(w.o.frequency, 120 + 220 * k, t, 0.1); glide(w.o2.frequency, 242 + 440 * k, t, 0.1);
    glide(w.bp.frequency, 300 + 500 * k, t, 0.1);
    glide(w.g.gain, k > 0.02 ? 0.006 + 0.014 * k : 0, t, 0.08); // (about a quarter of what it was)
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
    out.connect(this.bus.guns);
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
    out.connect(this.bus.guns);
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
      o.connect(g).connect(this.bus.crew);
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
    n.connect(hp).connect(g).connect(this.bus.guns);
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
      lp.connect(g).connect(this.bus.engines);
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
    glide(this.drone.g.gain, vol * 0.6, t, 0.1);
    for (const [o, m] of this.drone.oscs) glide(o.frequency, 95 * m * doppler, t, 0.1);
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
    n.connect(bp).connect(g).connect(this.bus.guns);
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
    n.connect(hp).connect(g).connect(this.bus.battle);
    n.start(t, Math.random() * 0.5, 0.06);
    // the skin tearing: a short rasp of torn aluminium (no ring: thin skin punched through doesn't ring)
    const r = this.noise(), bp = ctx.createBiquadFilter(), rg = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 900; bp.Q.value = 1.2;
    rg.gain.setValueAtTime(0.55 * vol, t + 0.004); rg.gain.exponentialRampToValueAtTime(0.001, t + 0.07 + Math.random() * 0.04);
    r.connect(bp).connect(rg).connect(this.bus.battle);
    r.start(t + 0.004, Math.random() * 0.5, 0.12);
    // and the knock of it through the airframe: a dull thud
    const k = this.noise(), lp = ctx.createBiquadFilter(), kg = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    kg.gain.setValueAtTime(0.7 * vol, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    k.connect(lp).connect(kg).connect(this.bus.battle);
    k.start(t, Math.random() * 0.5, 0.1);
    if (cannon) { // the shell bursting: a deep bang
      const m = this.noise(), lp = ctx.createBiquadFilter(), mg = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 520;
      mg.gain.setValueAtTime(1.3 * vol, t + 0.01); mg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      m.connect(lp).connect(mg).connect(this.bus.battle);
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
    out.connect(this.bus.crew);
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
    // (louder close by; far off it dies away fast, the air soaking it up: a barrage 3 km off is a distant rumble)
    const g = ctx.createGain(), v = Math.min(1.6, 180 / Math.max(dist, 30)) * Math.exp(-dist / 1800);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9 + Math.min(1, dist / 800));
    n.connect(lp).connect(g).connect(this.bus.battle);
    n.start(t, Math.random() * 0.3, 2);
    if (dist < 400) { // close: the crack of the shell itself
      const c = this.noise(), hp = ctx.createBiquadFilter(), cg = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1500;
      cg.gain.setValueAtTime(Math.min(1.2, 90 / Math.max(dist, 20)), t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      c.connect(hp).connect(cg).connect(this.bus.battle);
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
    o.connect(og).connect(this.bus.battle); o.start(t); o.stop(t + 0.5);
    const ticks = Math.round(6 + k * 26);
    for (let i = 0; i < ticks; i++) { // the rattle: fragments arrive a little after the blast, spread out
      const at = t + 0.06 + Math.random() * (0.15 + 0.35 * Math.random()), n = this.noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2500 + Math.random() * 3500; bp.Q.value = 2.5;
      g.gain.setValueAtTime((0.25 + 0.5 * Math.random()) * k, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.012 + Math.random() * 0.02);
      n.connect(bp).connect(g).connect(this.bus.battle); n.start(at, Math.random() * 0.5, 0.04);
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
    n.connect(lp).connect(g).connect(this.bus.battle);
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
    n.connect(lp).connect(g).connect(this.bus.battle);
    n.start(t);
    n.stop(t + dur + 0.1);
  }

  /**
   * A recorded line (scripts/voices: one small MP3 a clip): fetched and decoded the first time it's
   * wanted, and the last few dozen kept. Returns the AudioBuffer, null while it's still on its way, or
   * false if there's no such recording. Decoded at 22 kHz (the intercom carries nothing above 3 kHz):
   * a quarter of the memory of the 48 kHz sound system's own rate.
   */
  voiceClip(id, url = 'audio/voice') {
    const clips = (this.clips ??= new Map());
    let c = clips.get(id);
    if (c) { clips.delete(id); clips.set(id, c); return c.failed ? false : c.buf; } // (to the back: the most recently wanted)
    c = { buf: null, failed: false };
    clips.set(id, c);
    this.decoder ??= new OfflineAudioContext(1, 1, 22050);
    fetch(`${url}/${id}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => this.decoder.decodeAudioData(data)).then((buf) => { c.buf = buf; })
      .catch((e) => { c.failed = true; console.warn(`crew voice ${id} not loaded:`, e.message); });
    for (const [k, o] of clips) { if (clips.size <= 400) break; if (o.buf || o.failed) clips.delete(k); } // (the oldest go: never one still on its way)
    return null;
  }

  /**
   * Fetch every crew clip once, quietly, a few at a time, so the browser has them all on disk (public/_headers
   * lets it keep them) and no line waits on the network in the middle of a fight. ids: clip ids.
   */
  prefetchVoices(ids, url = 'audio/voice') {
    const todo = [...ids];
    const next = () => { const id = todo.shift(); if (id) fetch(`${url}/${id}.mp3`, { priority: 'low' }).then((r) => r.arrayBuffer()).catch(() => {}).then(next); };
    for (let k = 0; k < 4; k++) next();
  }

  /**
   * One line on the intercom: the clip `id` through a headset and an amplifier (300 Hz to 3 kHz, a little
   * overdriven), a hiss of static under it, a click as the mike is keyed and a burst of squelch after.
   * rate: played a touch faster or slower (makes the man); far: the command radio, thinner and noisier.
   * Returns { dur, stop } or null (not loaded yet, or no such clip: see voiceClip).
   */
  voice(id, { rate = 1, far = false, vol = 1, url } = {}) {
    const ctx = this.ctx, buf = this.voiceClip(id, url);
    if (!ctx || !buf) return null;
    const t = ctx.currentTime + 0.06, dur = buf.duration / rate;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.bus.crew);
    // the voice: band-limited, a presence peak, driven into the amplifier a little
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), sh = ctx.createWaveShaper(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate;
    hp.type = 'highpass'; hp.frequency.value = far ? 450 : 300; hp.Q.value = 0.7;
    lp.type = 'lowpass'; lp.frequency.value = far ? 2600 : 3400; lp.Q.value = 0.8;
    pk.type = 'peaking'; pk.frequency.value = 1800; pk.Q.value = 0.7; pk.gain.value = 3;
    sh.curve = this.driveCurve(far ? 2.6 : 1.4); sh.oversample = '2x'; // (a touch: hard driving makes a voice buzz like a machine)
    g.gain.value = far ? 0.6 : 0.8;
    src.connect(hp).connect(pk).connect(lp).connect(sh).connect(g).connect(out);
    src.start(t);
    // the static under it, from the key going down to the squelch
    const hiss = this.noise(), hb = ctx.createBiquadFilter(), hg = ctx.createGain();
    hiss.loop = true;
    hb.type = 'bandpass'; hb.frequency.value = 1900; hb.Q.value = 0.5;
    const hl = far ? 0.07 : 0.022;
    hg.gain.setValueAtTime(0, t - 0.05); hg.gain.linearRampToValueAtTime(hl, t - 0.03);
    hg.gain.setValueAtTime(hl, t + dur + 0.03); hg.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    hiss.connect(hb).connect(hg).connect(out);
    hiss.start(t - 0.05); hiss.stop(t + dur + 0.25);
    // the click of the mike keyed, and the squelch tail as it's let go
    const burst = (at0, len0, f, v) => {
      const n = this.noise(), b = ctx.createBiquadFilter(), bg = ctx.createGain();
      b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 0.7;
      bg.gain.setValueAtTime(v, at0); bg.gain.exponentialRampToValueAtTime(0.001, at0 + len0);
      n.connect(b).connect(bg).connect(out); n.start(at0, Math.random() * 0.5, len0 + 0.02);
    };
    burst(t - 0.05, 0.02, 2500, 0.25);
    burst(t + dur + 0.04, far ? 0.18 : 0.11, 2200, far ? 0.22 : 0.15);
    return { dur: dur + 0.15, stop: () => { const n = ctx.currentTime; try { src.stop(n); hiss.stop(n + 0.05); } catch { /* (already over) */ } out.gain.setTargetAtTime(0, n, 0.01); } };
  }

  driveCurve(k) { // soft clipping (tanh): the amplifier pushed a little
    this.curves ??= {};
    if (!this.curves[k]) { const c = new Float32Array(1024); for (let i = 0; i < c.length; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } this.curves[k] = c; }
    return this.curves[k];
  }

  /**
   * A spent .50 cal case hitting the floor (link: a belt link, duller steel): the bright ping of thin brass,
   * two or three high partials that die away almost at once, and the tick of it landing. vol 0..1.
   */
  caseTink(vol, link = false) {
    const ctx = this.ctx;
    if (!ctx || vol < 0.01) return;
    const t = ctx.currentTime + Math.random() * 0.02, f = link ? 1900 + Math.random() * 900 : 3300 + Math.random() * 2400;
    const out = ctx.createGain();
    out.gain.value = vol * (link ? 0.5 : 0.7) * 0.4; // (well under the guns: a tinkle at your feet, not a bell)
    out.connect(this.bus.guns);
    for (const [m, a, d] of link ? [[1, 1, 0.03], [2.31, 0.4, 0.02]] : [[1, 1, 0.09 + Math.random() * 0.07], [2.72, 0.5, 0.05], [5.1, 0.25, 0.03]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f * m;
      g.gain.setValueAtTime(0.09 * a, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.01);
    }
    const n = this.noise(), hp = ctx.createBiquadFilter(), ng = ctx.createGain(); // the tick of it landing
    hp.type = 'highpass'; hp.frequency.value = 4000;
    ng.gain.setValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    n.connect(hp).connect(ng).connect(out); n.start(t, Math.random() * 0.8, 0.02);
  }

  /**
   * The brass lying on the floor, rolling and chinking against itself: a scatter of small quiet tinks, more
   * of them the more brass there is (lying 0..1) and the more she moves (motion 0..1: banking, bumps, flak).
   */
  brass(dt, lying, motion) {
    if (!this.ctx || lying <= 0) return;
    this.brassT = (this.brassT ?? 0) - dt;
    const rate = lying * (0.3 + 10 * motion); // tinks a second (a quiet background chink, now and then)
    while (this.brassT <= 0) {
      this.brassT += -Math.log(1 - Math.random()) / Math.max(rate, 0.01);
      this.caseTink((0.05 + 0.12 * Math.random()) * Math.min(1, 0.4 + motion), Math.random() < 0.3);
    }
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
