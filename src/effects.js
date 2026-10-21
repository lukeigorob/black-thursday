// Particles: smoke, fire, explosions and impact sparks. Pooled, one draw call per kind.
// Everything is left behind in the air, so it streams aft with the wind past the formation.
import * as THREE from 'three';
import { AIRSPEED } from './bomber.js';

const V = THREE.Vector3;

function puffTexture(soft) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < (soft ? 9 : 1); i++) { // a few blobs = lumpy smoke
    const x = 32 + (soft ? (Math.random() - 0.5) * 22 : 0), y = 32 + (soft ? (Math.random() - 0.5) * 22 : 0), r = soft ? 14 + Math.random() * 12 : 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${soft ? 0.45 : 1})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
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
    gl_PointSize = size * scale / -mvPosition.z;
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
    gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
    #include <fog_fragment>
  }`;

/** One pool of point sprites (smoke or fire). */
class ParticlePool {
  constructor(scene, max, { additive, soft }) {
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
    this.mat.uniforms.map.value = puffTexture(soft);
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** c0 -> c1 colour over life (linear, may be HDR), alpha fades a0 -> 0, size s0 -> s1. */
  emit(p, v, { life, s0, s1, a0 = 1, c0, c1 = c0, drag = 0.6, grav = 0 }) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
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

const SMOKE_GREY = [0.32, 0.32, 0.32], SMOKE_BLACK = [0.05, 0.05, 0.05], SMOKE_WHITE = [0.85, 0.86, 0.88];
const FIRE_HOT = [40, 22, 6], FIRE_DIM = [6, 1.2, 0.2];

function chuteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4d6'; // silk canopy
  g.beginPath(); g.ellipse(32, 22, 26, 16, 0, Math.PI, 0); g.fill();
  g.strokeStyle = '#bdb6a3'; g.lineWidth = 1;
  for (let x = 8; x <= 56; x += 8) { g.beginPath(); g.moveTo(x, 22); g.lineTo(32, 52); g.stroke(); } // shroud lines
  g.fillStyle = '#4a4130'; g.fillRect(29, 50, 6, 10); // the airman
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticlePool(scene, 6000, { additive: false, soft: true });
    this.fire = new ParticlePool(scene, 3000, { additive: true, soft: false });
    this.chutes = [];
    this.chuteMat = new THREE.SpriteMaterial({ map: chuteTexture(), fog: true });
  }

  /** An airman bailing out: falls a few seconds, then the chute opens and drifts back and down. */
  parachute(p) {
    if (this.chutes.length > 120) return;
    const s = new THREE.Sprite(this.chuteMat);
    s.position.copy(p);
    s.scale.setScalar(1.2);
    this.scene.add(s);
    this.chutes.push({ s, age: 0, open: 2 + Math.random() * 3, sway: Math.random() * 6 });
  }

  setPixelScale(heightPx, fovDeg) { // point size in world metres -> pixels
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.smoke.mat.uniforms.scale.value = s;
    this.fire.mat.uniforms.scale.value = s;
  }

  /** Continuous trail behind a damaged plane: kind = 'smoke' | 'black' | 'fire' | 'glycol'. */
  trail(p, v, kind, dt) {
    // spread puffs evenly along the path flown this frame so the trail is continuous
    const n = Math.ceil(dt * (kind === 'fire' ? 160 : 110));
    const jitter = () => new V((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    for (let i = 0; i < n; i++) {
      const q = p.clone().addScaledVector(v, -((i + Math.random()) / n) * dt);
      const w = v.clone().multiplyScalar(0.3).add(jitter());
      if (kind === 'fire') {
        this.fire.emit(q, w, { life: 0.3 + Math.random() * 0.3, s0: 3.2, s1: 1, c0: FIRE_HOT, c1: FIRE_DIM, drag: 2 });
        this.smoke.emit(q, w, { life: 6 + Math.random() * 4, s0: 4, s1: 22, a0: 0.8, c0: SMOKE_BLACK, drag: 1.2 });
      } else {
        const c = kind === 'black' ? SMOKE_BLACK : kind === 'glycol' ? SMOKE_WHITE : SMOKE_GREY;
        this.smoke.emit(q, w, { life: 4 + Math.random() * 2, s0: 2.5, s1: kind === 'glycol' ? 12 : 16, a0: kind === 'glycol' ? 0.5 : 0.7, c0: c, drag: 1.2 });
      }
    }
  }

  /** Small flash and sparks where a round strikes. */
  impact(p, big = false) {
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const v = new V(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(big ? 30 : 18);
      this.fire.emit(p, v, { life: 0.12 + Math.random() * 0.15, s0: big ? 0.5 : 0.3, s1: 0.05, c0: [60, 40, 15], c1: [8, 3, 0.5], drag: 3, grav: 9.8 });
    }
    this.smoke.emit(p, new V(), { life: 0.8, s0: 0.4, s1: 2, a0: 0.5, c0: SMOKE_GREY, drag: 1 });
  }

  /** A plane blowing up: fireball, debris sparks and a hanging cloud of black smoke. */
  explosion(p, v = new V(), scale = 1) {
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
      this.smoke.emit(p.clone().add(d), d.clone().multiplyScalar(0.8).add(new V(0, 0, AIRSPEED)),
        { life: 28 + Math.random() * 12, s0: 40, s1: 170, a0: 0.85, c0: [0.32, 0.28, 0.22], c1: [0.45, 0.43, 0.4], drag: 0.6 });
    }
  }

  /** Smoke rising from a burning building. */
  groundSmoke(p) {
    this.smoke.emit(p, new V(Math.random() - 0.5, 6, Math.random() - 0.5).add(new V(0, 0, AIRSPEED)),
      { life: 25, s0: 25, s1: 120, a0: 0.75, c0: [0.08, 0.07, 0.06], c1: [0.25, 0.24, 0.23], drag: 0.3 });
    if (Math.random() < 0.5) this.fire.emit(p, new V(0, 3, AIRSPEED), { life: 0.6, s0: 18, s1: 6, c0: [30, 12, 3], c1: [4, 1, 0.2], drag: 1 });
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
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      const c = this.chutes[i];
      c.age += dt;
      const open = c.age > c.open;
      c.s.scale.setScalar(open ? 8 : 1.2);
      c.s.position.x += Math.sin(c.age * 0.7 + c.sway) * dt;
      c.s.position.y -= (open ? 6 : 40) * dt;
      c.s.position.z += AIRSPEED * dt; // left behind in the air
      if (c.age > 150) { this.scene.remove(c.s); this.chutes.splice(i, 1); }
    }
  }
}
