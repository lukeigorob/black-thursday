// Particles: smoke, fire, explosions and impact sparks. Pooled, one draw call per kind.
// Everything is left behind in the air, so it streams aft with the wind past the formation.
import * as THREE from 'three';
import { AIRSPEED } from './bomber.js';
import { Parachutes } from './parachutes.js';

const V = THREE.Vector3;

function puffTexture(soft) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < (soft ? 9 : 1); i++) { // a few blobs = lumpy smoke
    const x = 32 + (soft ? (Math.random() - 0.5) * 22 : 0), y = 32 + (soft ? (Math.random() - 0.5) * 22 : 0), r = soft ? 14 + Math.random() * 12 : 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${soft ? 0.45 : 1})`);
    if (!soft) { grd.addColorStop(0.35, 'rgba(255,255,255,0.5)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.13)'); } // (a bright core falling off fast: HDR fire on a linear ramp read as a flat hard-edged disc)
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

/** A smooth glow with no core or edge: close-up flames, many overlapping into one flame. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 8; i++) grd.addColorStop(i / 8, `rgba(255,255,255,${(Math.exp(-((i / 8) ** 2) * 4.5) - Math.exp(-4.5)).toFixed(3)})`); // (a gaussian, down to 0 at the rim)
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const vertexShader = `
  attribute float size; attribute float alpha; attribute vec3 tint;
  varying float vAlpha; varying vec3 vTint;
  uniform float scale;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vAlpha = alpha; vTint = tint;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = -mvPosition.z;
    // a puff right at the eye (your own bomber burning round you, smoke streaming past the turret glass)
    // fades out before it fills the view: a flat sheet of smoke, or a fire sprite blown up to a hard disc
    vAlpha *= smoothstep(0.25 * size, 0.8 * size, dist) * smoothstep(0.3, 1.2, dist);
    gl_PointSize = size * scale / dist;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;
const fragmentShader = `
  uniform sampler2D map;
  varying float vAlpha; varying vec3 vTint;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(map, gl_PointCoord);
    t.a *= 1.0 - smoothstep(0.38, 0.5, length(gl_PointCoord - 0.5)); // (round: a smoke puff's blobs reach the texture's edge, which showed as a square)
    gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
    #include <fog_fragment>
  }`;

/** One pool of point sprites (smoke or fire). */
export class ParticlePool {
  constructor(scene, max, { additive, soft, glow = false }) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, scale: { value: 600 } }]),
      vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat.uniforms.map.value = glow ? glowTexture() : puffTexture(soft);
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** c0 -> c1 colour over life (linear, may be HDR), alpha fades a0 -> 0, size s0 -> s1. */
  emit(p, v, { life, s0, s1, a0 = 1, c0, c1 = c0, drag = 0.6, grav = 0 }) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const j = i * 3;
    this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
    this.vel[j] = v.x; this.vel[j + 1] = v.y; this.vel[j + 2] = v.z;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.c0.set(c0, i * 3); this.c1.set(c1, i * 3);
    this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const a = (this.age[i] += dt), k = a / this.life[i];
      if (k >= 1) { this.kill(i--); continue; }
      const j = i * 3, d = Math.exp(-this.drag[i] * dt);
      // velocity relaxes towards the wind (still air streams past at AIRSPEED)
      this.vel[j] *= d; this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt; this.vel[j + 2] = AIRSPEED + (this.vel[j + 2] - AIRSPEED) * d;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(k);
      this.alpha[i] = this.a0[i] * (1 - k) * Math.min(1, a * 12);
      for (let c = 0; c < 3; c++) this.tint[j + c] = this.c0[j + c] + (this.c1[j + c] - this.c0[j + c]) * k;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const n of ['position', 'size', 'alpha', 'tint']) g.attributes[n].needsUpdate = true;
  }

  kill(i) { // move the last particle into slot i
    const l = --this.n;
    if (i === l) return;
    for (const arr of [this.size, this.alpha, this.age, this.life, this.s0, this.s1, this.a0, this.drag, this.grav]) arr[i] = arr[l];
    for (const arr of [this.pos, this.vel, this.tint, this.c0, this.c1]) arr.copyWithin(i * 3, l * 3, l * 3 + 3);
  }
}

const _q = new V(), _w = new V(), _v = new V();
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Pieces of aircraft: wing panels, a tailplane, chunks of fuselage. Tumbling, falling, some trailing
 * fire, all in one instanced mesh.
 */
class Wreckage {
  constructor(scene) {
    this.max = 260;
    this.items = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x45483b, roughness: 0.65, metalness: 0.45, envMapIntensity: 0.5 }), this.max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.dq = new THREE.Quaternion(); this.e = new THREE.Euler();
  }

  /** size: V3 in metres; quat: the orientation it broke off at (or random). */
  add(pos, vel, size, burning = false, quat = null) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      pos: pos.clone(), vel: vel.clone(), size: size.clone(), burnT: burning ? rnd(3, 7) : 0, life: rnd(20, 30),
      q: quat ? quat.clone() : new THREE.Quaternion().setFromEuler(this.e.set(rnd(0, 6), rnd(0, 6), rnd(0, 6))),
      spin: new V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(rnd(1, 4) / Math.max(1, size.x * 0.25)),
    });
  }

  update(dt, effects) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const w = items[i];
      if ((w.life -= dt) <= 0) { items.splice(i, 1); continue; }
      // falls; the air drags it back towards the wind's speed (a flat panel flutters down slowly)
      const d = Math.exp(-dt * 0.35);
      w.vel.x *= d; w.vel.z = AIRSPEED + (w.vel.z - AIRSPEED) * d;
      w.vel.y = Math.max(w.vel.y - 9.81 * dt, -60);
      w.pos.addScaledVector(w.vel, dt);
      w.q.multiply(this.dq.setFromEuler(this.e.set(w.spin.x * dt, w.spin.y * dt, w.spin.z * dt)));
      if (w.burnT > 0) { w.burnT -= dt; effects.trail(w.pos, w.vel, 'ember', dt); } // burns for a few seconds
    }
    const n = Math.min(items.length, this.max);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this.m.compose(items[i].pos, items[i].q, items[i].size));
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const SMOKE_GREY = [0.32, 0.32, 0.32], SMOKE_BLACK = [0.05, 0.05, 0.05], SMOKE_WHITE = [0.85, 0.86, 0.88];
const FIRE_HOT = [40, 22, 6], FIRE_DIM = [6, 1.2, 0.2];
const _hot = [0, 0, 0], _dim = [0, 0, 0], _fHot = [0, 0, 0], _fDim = [0, 0, 0], _ws = new V(); // (a trail's flame colours, dimmed up close)


export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.groundVel = new V(0, 0, AIRSPEED); // (how the ground moves past: swung round in a turn, main.js)
    this.smoke = new ParticlePool(scene, 12000, { additive: false, soft: true });
    this.fire = new ParticlePool(scene, 6000, { additive: true, soft: false });
    this.flame = new ParticlePool(scene, 4000, { additive: true, glow: true }); // (a trail's flames close to the eye: soft, overlapping into one)
    this.camPos = null; // set each frame: far trails use fewer, bigger puffs so burning planes show from km away
    this.wreckage = new Wreckage(scene);
    this.parachutes = new Parachutes(scene); // everyone who bails out
    this.extraPools = []; // (other modules' pools, the flak's: sized with these)
  }

  /** An airman bailing out: a few seconds of free fall, then the chute opens and drifts back and down. */
  parachute(p) { this.parachutes.add(p); }

  setPixelScale(heightPx, fovDeg) { // point size in world metres -> pixels
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    for (const p of [this.smoke, this.fire, this.flame, ...this.extraPools]) p.mat.uniforms.scale.value = s;
  }

  /** Continuous trail behind a damaged plane: kind = 'smoke' | 'black' | 'fire' | 'glycol'. */
  trail(p, v, kind, dt) {
    const dist = this.camPos ? p.distanceTo(this.camPos) : 0;
    if (dist > 9000) return;
    const far = Math.min(6, Math.max(1, dist / 500)); // fewer, bigger puffs far away: same look, less work
    // when the smoke pool fills up (a big battle), trails thin out instead of crowding out hits and explosions
    const load = this.smoke.n / this.smoke.max, thin = load > 0.7 ? Math.max(0.1, (1 - load) / 0.3) : 1;
    const c = this.camPos ? Math.min(1, Math.max(0, (dist - 15) / 45)) : 1; // 0 close to the eye .. 1 from 60 m
    const dense = kind === 'fire' ? 1 + 2 * (1 - c) : 1; // (up close, smaller flames and more of them: one flame, not a row of bright discs)
    // spread puffs evenly along the path flown this frame so the trail is continuous;
    // round at random so the rate doesn't depend on the frame rate
    const rate = (kind === 'fire' ? 160 : kind === 'ember' ? 30 : 110) * dense;
    const n = Math.floor((dt * rate * thin) / far + Math.random());
    // close to the eye (your own engine burning outside the cockpit glass): the flames at their real size
    // and brightness, not blown up to be seen from kilometres off (up close they were a white glare), and
    // the smoke leaves small and is torn straight back by the slipstream instead of hanging by the window
    // in puffs that fill it
    const fs = 0.22 + 0.78 * c, fb = 0.18 + 0.82 * c, ss0 = 0.25 + 0.75 * c, ss1 = 0.55 + 0.45 * c, sa = 0.65 + 0.35 * c;
    const hot = _hot, dim = _dim;
    for (let k = 0; k < 3; k++) { hot[k] = FIRE_HOT[k] * fb; dim[k] = FIRE_DIM[k] * fb; _fHot[k] = FIRE_HOT[k] * 0.05; _fDim[k] = FIRE_DIM[k] * 0.05; }
    for (let i = 0; i < n; i++) {
      const q = _q.copy(p).addScaledVector(v, -((i + Math.random()) / n) * dt);
      const w = _w.copy(v).multiplyScalar(0.3);
      w.x += (Math.random() - 0.5) * 2; w.y += (Math.random() - 0.5) * 2; w.z += (Math.random() - 0.5) * 2;
      const ws = _ws.copy(w); ws.z += (1 - c) * (AIRSPEED * 0.8 - ws.z); // (smoke up close: already moving with the air, streaming back; the flames cling to her)
      if (kind === 'ember') { // a burning piece of wreckage: flames and a short wisp of smoke
        this.fire.emit(q, w, { life: 0.4 + Math.random() * 0.3, s0: 1.6 * far * fs, s1: 0.5 * far * fs, c0: hot, c1: dim, drag: 2 });
        this.smoke.emit(q, ws, { life: 2.5 + Math.random() * 1.5, s0: 1.5 * far * ss0, s1: 7 * far * ss1, a0: 0.6 * sa, c0: SMOKE_BLACK, drag: 1.2 });
      } else if (kind === 'fire') {
        if (Math.random() > c) this.flame.emit(q, w, { life: 0.25 + Math.random() * 0.25, s0: 1.1, s1: 0.4, c0: _fHot, c1: _fDim, drag: 2 }); // (close: soft and overlapping, each dim: together one flame)
        else this.fire.emit(q, w, { life: (0.3 + Math.random() * 0.3) * Math.sqrt(far), s0: 3.6 * far * fs, s1: 1.2 * far * fs, c0: hot, c1: dim, drag: 2 });
        if (dense > 1 && Math.random() * dense > 1) continue; // (the smoke at its usual rate)
        this.smoke.emit(q, ws, { life: 7 + Math.random() * 5, s0: 4 * far * ss0, s1: 26 * far * ss1, a0: 0.85 * sa, c0: SMOKE_BLACK, drag: 1.2 });
      } else if (kind === 'fuel') { // fuel streaming from a holed tank: a thin white vapour that hangs a long way back
        this.smoke.emit(q, ws, { life: 5 + Math.random() * 3, s0: 0.9 * far * ss0, s1: 7 * far * ss1, a0: 0.35 * sa, c0: SMOKE_WHITE, drag: 1.5 });
      } else {
        const col = kind === 'black' ? SMOKE_BLACK : kind === 'glycol' ? SMOKE_WHITE : SMOKE_GREY;
        this.smoke.emit(q, ws, { life: 4 + Math.random() * 2, s0: 2.5 * far * ss0, s1: (kind === 'glycol' ? 12 : 16) * far * ss1, a0: (kind === 'glycol' ? 0.5 : 0.7) * sa, c0: col, drag: 1.2 });
      }
    }
  }

  /**
   * Where a round strikes: a flash, sparks, a puff of smoke and bits of skin flying off. The same for
   * everyone's rounds; scaled with the distance so it looks the same size on the screen near or far:
   * you see your bombers being hit across the formation, and the gunners' hits on the fighters.
   */
  impact(p, big = false) {
    const far = this.camPos ? Math.min(20, Math.max(1, p.distanceTo(this.camPos) / 150)) : 1;
    this.fire.emit(p, _v.set(0, 0, 0), { life: far > 2 ? 0.11 : 0.07, s0: (big ? 1.6 : 0.8) * far, s1: 0.2 * far, c0: [90, 70, 35], c1: [20, 8, 2], drag: 1 }); // the flash
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const v = _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar((big ? 30 : 18) * Math.sqrt(far)); // (the sparks fly as far on the screen too)
      this.fire.emit(p, v, { life: 0.12 + Math.random() * 0.15, s0: (big ? 0.5 : 0.3) * far, s1: 0.05, c0: [60, 40, 15], c1: [8, 3, 0.5], drag: 3, grav: 9.8 });
    }
    for (let i = 0; i < (big ? 4 : 2); i++) { // fragments of skin and rivets
      const v = _v.set(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(big ? 26 : 14);
      this.smoke.emit(p, v, { life: 1.2 + Math.random(), s0: 0.22 * far, s1: 0.18 * far, a0: 0.95, c0: [0.06, 0.06, 0.05], drag: 0.4, grav: 9.8 });
    }
    this.smoke.emit(p, _v.set(0, 0, 0), { life: 0.8, s0: 0.4 * far, s1: 2 * far, a0: 0.5, c0: SMOKE_GREY, drag: 1 });
  }

  /** An aircraft breaking up: n pieces of `size` (V3, m) flung from `at` with the plane's velocity. */
  wreck(at, vel, n, size, burning = 0.4, quat = null) {
    for (let i = 0; i < n; i++) {
      const s = _w.copy(size).multiplyScalar(rnd(0.5, 1));
      const v = _q.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).multiplyScalar(rnd(4, 16)).add(vel);
      this.wreckage.add(at, v, s, Math.random() < burning, i === 0 ? quat : null);
    }
  }

  /** A plane blowing up: fireball, debris sparks and a hanging cloud of black smoke. */
  explosion(p, v = new V(), scale = 1) {
    // far away it's drawn bigger (fewer pixels would hide it), and pieces fly out of it
    if (this.camPos) scale *= Math.min(3, Math.max(1, p.distanceTo(this.camPos) / 700));
    this.wreck(p, v, Math.round(3 + scale * 2), _v.set(1.6 * scale, 0.25, 1.1 * scale), 0.5);
    for (let i = 0; i < 40; i++) {
      const d = new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.fire.emit(p, d.clone().multiplyScalar(6 + Math.random() * 14).add(v.clone().multiplyScalar(0.4)),
        { life: 0.5 + Math.random() * 0.6, s0: (4 + Math.random() * 5) * scale, s1: 1.5 * scale, c0: [60, 32, 10], c1: [5, 1, 0.2], drag: 2.5 });
    }
    for (let i = 0; i < 60; i++) { // burning debris
      const d = new V(Math.random() - 0.5, Math.random() - 0.4, Math.random() - 0.5).normalize();
      this.fire.emit(p, d.multiplyScalar(25 + Math.random() * 45).add(v.clone().multiplyScalar(0.6)),
        { life: 1 + Math.random() * 1.5, s0: 0.5, s1: 0.2, c0: [40, 18, 5], c1: [3, 0.6, 0.1], drag: 0.6, grav: 9.8 });
    }
    for (let i = 0; i < 30; i++) {
      const d = new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14 * scale);
      this.smoke.emit(p.clone().add(d), d.clone().multiplyScalar(0.4).add(v.clone().multiplyScalar(0.3)),
        { life: 8 + Math.random() * 6, s0: 6 * scale, s1: 26 * scale, a0: 0.85, c0: [0.08, 0.07, 0.06], c1: [0.2, 0.2, 0.2], drag: 0.8 });
    }
  }

  /** A 500 lb bomb going off on the ground: a flash and a column of dust and smoke. */
  groundBurst(p) {
    this.fire.emit(p.clone().setY(p.y + 10), new V(), { life: 0.35, s0: 70, s1: 30, c0: [70, 40, 14], c1: [8, 3, 0.6], drag: 1 });
    for (let i = 0; i < 3; i++) {
      const d = new V(Math.random() - 0.5, Math.random() * 0.6 + 0.3, Math.random() - 0.5).multiplyScalar(25);
      this.smoke.emit(p.clone().add(d), d.clone().multiplyScalar(0.8).add(this.groundVel),
        { life: 28 + Math.random() * 12, s0: 40, s1: 170, a0: 0.85, c0: [0.32, 0.28, 0.22], c1: [0.45, 0.43, 0.4], drag: 0.6 });
    }
  }

  /** Smoke rising from a burning building. */
  groundSmoke(p) {
    this.smoke.emit(p, new V(Math.random() - 0.5, 6, Math.random() - 0.5).add(this.groundVel),
      { life: 25, s0: 25, s1: 120, a0: 0.75, c0: [0.08, 0.07, 0.06], c1: [0.25, 0.24, 0.23], drag: 0.3 });
    if (Math.random() < 0.5) this.fire.emit(p, new V(0, 3, 0).add(this.groundVel), { life: 0.6, s0: 18, s1: 6, c0: [30, 12, 3], c1: [4, 1, 0.2], drag: 1 });
  }

  /** An 88 mm burst: a bright flash and a lingering ball of black smoke. */
  flakBurst(p) {
    for (let i = 0; i < 6; i++) {
      const d = new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5);
      this.fire.emit(p.clone().add(d), d, { life: 0.12 + Math.random() * 0.08, s0: 9, s1: 3, c0: [80, 50, 20], c1: [10, 4, 1], drag: 4 });
    }
    for (let i = 0; i < 9; i++) {
      const d = new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(7);
      this.smoke.emit(p.clone().add(d), d.clone().multiplyScalar(1.5).add(new V(0, 0, AIRSPEED)),
        { life: 14 + Math.random() * 8, s0: 7, s1: 26, a0: 0.9, c0: [0.04, 0.04, 0.04], c1: [0.14, 0.14, 0.14], drag: 3 });
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.fire.update(dt);
    this.flame.update(dt);
    this.wreckage.update(dt, this);
    this.parachutes.update(dt);
  }
}
