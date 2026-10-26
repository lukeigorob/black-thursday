// Flak: 88 mm shells bursting at the formation's height, fired in four-gun salvos, thicker the nearer the
// target. Each burst: a white-hot flash, a short fireball, a cloud of thick oily black smoke that swells,
// drifts back past the bombers and slowly fades, and fragments streaking out glowing. Close to you: the
// crack of it, the thump through the airframe, the view jolted, the fragments rattling on the skin like
// gravel, and shrapnel through the part nearest the burst and anyone by it. Bombers near a burst take
// shrapnel; a close one can be fatal. At night the flashes light the bombers round them; in cloud and
// rain they're muffled. All pooled and capped (one draw call per kind, nothing allocated per burst).
// The mission switches it on (`flak.on`) over the flak belt round the target, and sets how heavy (`heavy`).
import * as THREE from 'three';
import { PARTS, AIRSPEED } from './bomber.js';
import { ParticlePool } from './effects.js';

const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const LETHAL = 55; // m: shrapnel reaches this far
const CLOSE = 160; // m: nearer than this you feel it
const SALVO = 6, QUEUE = 200; // shells a battery fires together; bursts waiting to go off
const BATTERIES = 3; // batteries firing at once: their salvos overlap
const FRAGS = 2600; // glowing fragments in the air at once
const DIRECT = 2.5; // m from her skin: a shell bursting this close is as good as a direct hit
const FRAG_RANGE = 110; // m: fragments still go through a fuselage this far off (weaker the further)
const FRAGS_OUT = 3000; // fragments flung out every way from a burst (those whose path crosses a fuselage go through it)

/** The fragments: short glowing streaks flying out of a burst, fading as they cool. One draw call. */
class Fragments {
  constructor(scene, max) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.line = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.line, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    this.mesh.frustumCulled = false;
    g.setDrawRange(0, 0);
    scene.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, life) {
    if (this.n >= this.max) return;
    const i = this.n++, j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.age[i] = 0; this.life[i] = life;
  }

  update(dt) {
    const d = Math.exp(-dt * 1.2);
    for (let i = 0; i < this.n; i++) {
      const k = (this.age[i] += dt) / this.life[i];
      if (k >= 1) { this.kill(i--); continue; }
      const j = i * 3, p = this.pos, v = this.vel;
      v[j] *= d; v[j + 1] = v[j + 1] * d - 9.8 * dt; v[j + 2] = AIRSPEED + (v[j + 2] - AIRSPEED) * d;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      // a streak back along its path (relative to the air: the formation flies through them), cooling as it goes
      const l = i * 6, s = 0.025, h = (1 - k) * (1 - k) * 14;
      this.line[l] = p[j]; this.line[l + 1] = p[j + 1]; this.line[l + 2] = p[j + 2];
      this.line[l + 3] = p[j] - v[j] * s; this.line[l + 4] = p[j + 1] - v[j + 1] * s; this.line[l + 5] = p[j + 2] - (v[j + 2] - AIRSPEED) * s;
      this.col[l] = h; this.col[l + 1] = h * 0.45; this.col[l + 2] = h * 0.12;
      this.col[l + 3] = h * 0.2; this.col[l + 4] = h * 0.06; this.col[l + 5] = 0;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.n * 2);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }

  kill(i) {
    const l = --this.n;
    if (i === l) return;
    this.age[i] = this.age[l]; this.life[i] = this.life[l];
    this.pos.copyWithin(i * 3, l * 3, l * 3 + 3); this.vel.copyWithin(i * 3, l * 3, l * 3 + 3);
    this.line.copyWithin(i * 6, l * 6, l * 6 + 6); this.col.copyWithin(i * 6, l * 6, l * 6 + 6);
  }
}

const _at = new V(), _v = new V(), _l = new V(), _c = new V(), _m = new V(), _p = new V();
const C_FLASH = [70, 58, 42], C_BALL0 = [34, 15, 3.5], C_BALL1 = [2.2, 0.5, 0.08], C_SMOKE0 = [0.022, 0.019, 0.016], C_SMOKE1 = [0.1, 0.095, 0.09];
const opts = { life: 0, s0: 0, s1: 0, a0: 1, c0: C_FLASH, c1: C_FLASH, drag: 0, grav: 0 };

export class Flak {
  constructor({ effects, audio, ui, bombers, playerBomber, onBomberHit, onClose, onShrapnel }) {
    Object.assign(this, { effects, audio, ui, bombers, playerBomber, onBomberHit, onClose, onShrapnel });
    this.timer = 0;
    this.active = false;
    this.on = false;
    this.heavy = 0.5; // 0..1: how thick it is (the mission: heaviest over the target)
    this.night = 0; // 0..1: the flashes light the bombers round them
    this.muffle = 0; // 0..1: in cloud and rain, the flashes are dimmed and blurred
    const scene = effects.scene;
    this.flash = new ParticlePool(scene, 160, { additive: true, soft: false });
    this.ball = new ParticlePool(scene, 900, { additive: true, soft: true });
    this.smoke = new ParticlePool(scene, 5000, { additive: false, soft: true });
    effects.extraPools.push(this.flash, this.ball, this.smoke);
    this.frags = new Fragments(scene, FRAGS);
    // the light of the nearest flash (at nothing by day: always in the scene, so no shader rebuilds)
    this.light = new THREE.PointLight(0xffb070, 0, 900, 1.5);
    scene.add(this.light);
    this.lightK = 0;
    this.queue = Array.from({ length: QUEUE }, () => ({ t: -1, at: new V() }));
    this.near = []; this.nearT = 0;
    this.barrageT = 4; // s to the next box barrage
    this.heard = 0; // bursts heard lately (far ones beyond a few a moment aren't each given a sound)
  }

  update(dt) {
    const on = this.on;
    if (on !== this.active) {
      this.active = on;
      this.ui.log(on ? 'Flak! Flak dead ahead!' : "We're through the flak.");
    }
    // the bursts already on their way
    for (const q of this.queue) if (q.t >= 0 && (q.t -= dt) < 0) this.burst(q.at);
    this.flash.update(dt); this.ball.update(dt); this.smoke.update(dt); this.frags.update(dt);
    this.lightK *= Math.exp(-dt * 12);
    this.heard = Math.max(0, this.heard - dt * 12);
    // (not inside your bomber: through her skin its light lit up the bomb bay and the tunnel to the tail)
    this.light.intensity = this.inside ? 0 : this.lightK * this.night * (1 - 0.6 * this.muffle);
    if (!on || (this.timer -= dt) > 0) return;
    // the batteries below fire at the part of the stream around us, several salvos in the air at once;
    // over the target a wall of it: box barrages put up across the stream's path, which it must fly through
    const h = Math.max(0.1, this.heavy); // (light at the edge of the belt, a wall over the target)
    this.timer = rand(0.12, 0.45) / h;
    if ((this.barrageT -= this.timer) <= 0 && h > 0.5) { this.barrageT = rand(5, 9) / h; this.barrage(h); }
    if ((this.nearT -= 1) <= 0) { // (who's in range, now and then)
      this.nearT = 8;
      this.near.length = 0;
      for (const b of this.bombers) if (!b.down && b.base.distanceTo(this.playerBomber.base) < 1500) this.near.push(b);
    }
    for (let bat = 0; bat < BATTERIES; bat++) {
      // (a battery on the bomber you're in now and then: the near ones' crack and jolt much more often)
      const aimed = Math.random() < 0.06 ? this.playerBomber : this.near[Math.floor(Math.random() * this.near.length)];
      if (!aimed || aimed.down) continue;
      this.salvo(aimed);
    }
  }

  /** One battery's salvo at `aimed`: predicted fire, the error mostly in height and range. */
  salvo(aimed) {
    // predicted fire: the error is mostly in height and range; the salvo's shells close round that point
    // (and the barrage put up ahead of the stream: you fly into the smoke of the salvos before yours)
    _c.copy(aimed.group.position).add(_v.set(rand(-110, 110), rand(-70, 70), Math.random() < 0.6 ? rand(-900, -150) : rand(-140, 140)));
    for (let s = 0; s < SALVO; s++) {
      const q = this.queue.find((x) => x.t < 0);
      if (!q) break;
      q.t = rand(0, 0.7);
      q.at.copy(_c).add(_v.set(rand(-45, 45), rand(-30, 30), rand(-55, 55)));
    }
  }

  /** A box barrage: a wall of bursts across the stream's path just ahead, at its height, over a second or two. */
  barrage(h) {
    const at = this.playerBomber.group.position, n = Math.round(22 + 26 * h);
    const ahead = rand(250, 700);
    for (let s = 0; s < n; s++) {
      const q = this.queue.find((x) => x.t < 0);
      if (!q) break;
      q.t = rand(0, 1.8);
      q.at.copy(at).add(_v.set(rand(-650, 650), rand(-120, 140), -ahead + rand(-220, 220)));
    }
  }

  burst(at) {
    const m = this.muffle;
    // the flash, the fireball (both dimmer and softer in cloud), the black smoke swelling and drifting aft
    Object.assign(opts, { life: 0.09, s0: 40, s1: 70, a0: 1 - 0.55 * m, c0: C_FLASH, c1: C_FLASH, drag: 0, grav: 0 });
    this.flash.emit(at, _v.set(0, 0, AIRSPEED), opts);
    for (let i = 0; i < 4; i++) {
      Object.assign(opts, { life: rand(0.22, 0.45), s0: rand(4, 7), s1: rand(11, 16), a0: 1 - 0.4 * m, c0: C_BALL0, c1: C_BALL1, drag: 3 });
      this.ball.emit(_p.copy(at).add(_l.set(rand(-2, 2), rand(-2, 2), rand(-2, 2))), _v.set(rand(-8, 8), rand(-6, 8), AIRSPEED + rand(-8, 8)), opts);
    }
    for (let i = 0; i < 5; i++) { // (five puffs, each a little bigger: the same cloud for fewer of them)
      const r = i < 3 ? 3 : 7;
      Object.assign(opts, { life: rand(14, 24), s0: rand(9, 13), s1: rand(34, 48), a0: rand(0.8, 0.95), c0: C_SMOKE0, c1: C_SMOKE1, drag: 2.2 });
      this.smoke.emit(_p.copy(at).add(_l.set(rand(-r, r), rand(-r, r), rand(-r, r))), _v.set(rand(-9, 9), rand(-5, 10), AIRSPEED + rand(-9, 9)), opts);
    }
    for (let i = 0; i < 26; i++) { // the fragments, out in every direction
      _l.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(110, 240));
      this.frags.emit(at.x, at.y, at.z, _l.x, _l.y, _l.z + AIRSPEED, rand(0.35, 0.8));
    }
    if (this.night > 0) { this.lightK = 1.2e6; this.light.position.copy(at); } // (the last one lights the bombers round it)
    const d = at.distanceTo(this.playerBomber.group.position);
    if (d < 600 || this.heard < 3) { this.heard++; this.audio.flak(d, m); } // (the far ones: a few at a time, or the sound would clip)
    if (d < CLOSE) this.onClose?.(1 - d / CLOSE, d); // the thump, the jolt, the rattle
    for (const b of this.bombers) {
      if (b.down || b.gone) continue;
      const dist = at.distanceTo(b.group.position);
      if (dist > FRAG_RANGE) continue;
      const local = b.group.worldToLocal(_m.copy(at));
      // the fragments through her hull: the men inside take them (crew.js shrapnel), even from a burst some way off
      this.onShrapnel?.(b, local, FRAGS_OUT);
      if (dist > LETHAL + 20) continue;
      // shrapnel: the parts nearest the burst take most of it
      const near = PARTS.map((p) => {
        let c = null, d = Infinity; // (the nearest point of the part to the burst)
        for (const q of p.boxes) {
          const e = new V().set(THREE.MathUtils.clamp(local.x, q[0], q[1]), THREE.MathUtils.clamp(local.y, q[2], q[3]), THREE.MathUtils.clamp(local.z, q[4], q[5])), de = e.distanceTo(local);
          if (de < d) { c = e; d = de; }
        }
        return { p, c, d };
      }).filter((x) => x.d < LETHAL).sort((x, y) => x.d - y.d);
      const bias = b === this.playerBomber ? 1 : (this.lossBias ?? 1) * (this.groupBias?.get(b.squad) ?? 1);
      if (near[0] && near[0].d < DIRECT && Math.random() < (b === this.playerBomber ? 0.3 : 0.55 * Math.min(1, bias))) { // as good as a direct hit: that part's torn out (a wing tank, an engine: she may go down then and there)
        const { p, c } = near[0];
        for (let i = 0; i < p.hp + 6; i++) b.hit(p, true);
        this.onBomberHit?.(b, p, c, true, new V((p.box[0] + p.box[1]) / 2, (p.box[2] + p.box[3]) / 2, (p.box[4] + p.box[5]) / 2).sub(c));
      }
      for (const { p, c, d: pd } of near.slice(0, 4)) {
        const hits = Math.round(rand(0, 1) * (1 - pd / LETHAL) * (pd < 10 ? 14 : 6) * bias);
        for (let i = 0; i < hits; i++) {
          b.hit(p, pd < 8);
          this.onBomberHit?.(b, p, c, pd < 8, new V((p.box[0] + p.box[1]) / 2, (p.box[2] + p.box[3]) / 2, (p.box[4] + p.box[5]) / 2).sub(c)); // (the shrapnel flies in from the burst)
        }
        if (hits && b === this.playerBomber) this.audio.impact(pd < 10);
      }
    }
  }
}
