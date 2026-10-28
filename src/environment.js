// The weather and the hour: time of day (morning, day, twilight, night), season (summer, autumn, winter) and
// weather (clear, cloudy, rain, thunderstorm). Chosen on the menus, remembered, and applied by World:
// the sky, sun or moon, haze, cloud cover, the ground's snow, rain past the windows, lightning.
import * as THREE from 'three';

const KEY = 'bomber.env';
export const ENV_OPTIONS = {
  time: [['morning', 'Morning'], ['day', 'Day'], ['twilight', 'Twilight'], ['night', 'Night']],
  season: [['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']],
  weather: [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['thunder', 'Thunderstorm']],
};

export function loadEnv() {
  const env = { time: 'day', season: 'autumn', weather: 'clear' };
  try { Object.assign(env, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* (defaults) */ }
  const def = { time: 'day', season: 'autumn', weather: 'clear' };
  for (const k of Object.keys(ENV_OPTIONS)) if (!ENV_OPTIONS[k].some(([v]) => v === env[k])) env[k] = def[k];
  return env;
}
export function saveEnv(env) { try { localStorage.setItem(KEY, JSON.stringify(env)); } catch { /* (not remembered) */ } }

// how the mission's conditions are picked: 'default' (autumn, day, clear: 14 October 1943), 'choose' (as set), 'random' (rolled anew each mission)
const MODE_KEY = 'bomber.envMode';
export const DEFAULT_ENV = { time: 'day', season: 'autumn', weather: 'clear' };
export function loadEnvMode() {
  try { const m = localStorage.getItem(MODE_KEY); if (['default', 'choose', 'random'].includes(m)) return m; } catch { /* (default) */ }
  return 'default';
}
export function saveEnvMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* (not remembered) */ } }
/** A random hour, season and weather (the daylight hours and fair weather a little likelier). */
export function rollEnv() {
  const pick = (list) => { let r = Math.random() * list.reduce((s, [, w]) => s + w, 0); return list.find(([, w]) => (r -= w) < 0)[0]; };
  return { time: pick([['morning', 2], ['day', 3], ['twilight', 2], ['night', 2]]), season: pick([['summer', 1], ['autumn', 1], ['winter', 1]]),
    weather: pick([['clear', 3], ['cloudy', 3], ['rain', 2], ['thunder', 1]]) };
}
/** "Rain · Night · Winter" */
export function envLabel(env) {
  const name = (k) => ENV_OPTIONS[k].find(([v]) => v === env[k])[1];
  return `${name('weather')} · ${name('time')} · ${name('season')}`;
}

// the light of each hour: sun (or moon) elevation / azimuth in degrees, its colour and strength, the
// sky model's haze, how bright the sky is drawn, exposure, the ambient (sky / ground) and how sunlit
// the clouds look
export const TIMES = {
  morning: { elev: 9, az: 100, sun: [1, 0.74, 0.5], sunI: 2.5, turb: 5, ray: 2.6, mie: 0.0045, dim: 0.62, exp: 0.6, hemi: [0x9fb2d6, 0x564a3a, 0.22], cloud: [1.35, 1.12, 0.95], env: 0.55 },
  day: { elev: 38, az: 150, sun: [1, 0.95, 0.88], sunI: 3.2, turb: 2.2, ray: 1.6, mie: 0.004, dim: 0.55, exp: 0.55, hemi: [0xc4d8f0, 0x6a6458, 0.2], cloud: [1.55, 1.55, 1.55], env: 0.6 },
  twilight: { elev: 4, az: 255, sun: [1, 0.52, 0.3], sunI: 1.7, turb: 8, ray: 3, mie: 0.011, dim: 0.75, exp: 1.15, hemi: [0x7c84b8, 0x3e3228, 0.4], cloud: [1.1, 0.74, 0.66], env: 0.55 }, // (dusk, but you can still see: the cabins weren't black)
  night: { night: true, elev: 32, az: 210, sun: [0.55, 0.66, 0.95], sunI: 0.42, dim: 1, exp: 1.05, hemi: [0x1e2846, 0x0a0a0c, 0.14], cloud: [0.09, 0.1, 0.14], env: 0.12 },
};
// cover: clouds against the quality setting's count; deck: how many lie in the low deck; fog: haze
// thickness; overcast 0..1 greys the sky and dims the sun; rain: streak density
export const WEATHER = {
  clear: { cover: 0.35, deck: 0.35, fog: 1, overcast: 0, rain: 0, storm: false },
  cloudy: { cover: 1.5, deck: 0.7, fog: 1.6, overcast: 0.35, rain: 0, storm: false },
  rain: { cover: 1.7, deck: 0.8, fog: 4.5, overcast: 0.85, rain: 1, storm: false },
  thunder: { cover: 1.9, deck: 0.85, fog: 5.5, overcast: 1, rain: 1.3, storm: true },
};

// ---------- snow on the ground and on the town: one switch every snowy material shares ----------
export const SNOW = { value: 0 };
const snowKey = new WeakSet();
/** Snow on whatever faces up (roofs, the ground, tree tops) when it's winter. */
export function snowy(m, amount = 0.92) {
  if (!m || snowKey.has(m)) return m;
  snowKey.add(m);
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uSnow = SNOW;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSnow; varying float vUp;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.9), uSnow * ${amount.toFixed(2)} * smoothstep(0.35, 0.8, vUp));`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|snow`;
  return m;
}

// ---------- rain on the glass: drops on the real panes (not over the whole screen) ----------
export const WET = { value: 0 }; // 0 dry .. 1 wet: every glass material shares it
const wetKey = new WeakSet();
/**
 * Raindrops on a glass material: beads scattered over the pane (fixed to the glass, so they move
 * with it), a little brighter and more opaque than the clear glass round them. Chains any shader
 * hook the material already has.
 */
export function wetGlass(m) {
  if (!m || wetKey.has(m)) return m;
  wetKey.add(m);
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uWet = WET;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet; varying vec3 vWetP;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uWet > 0.0) {
          float drops = 0.0;
          for (int k = 0; k < 2; k++) { // two sizes of bead
            vec3 wp = vWetP * (k == 0 ? 24.0 : 55.0);
            vec3 cell = floor(wp), f = fract(wp);
            float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            vec3 c = vec3(fract(h * 7.13), fract(h * 3.71), fract(h * 5.37)) * 0.6 + 0.2;
            float r = (0.09 + 0.11 * fract(h * 11.0));
            drops = max(drops, step(1.0 - uWet * 0.4, h) * smoothstep(r, r * 0.5, length(f - c)));
          }
          // (lit by what's round it: a bead catches the light, it doesn't glow by itself at night)
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 1.5 + reflectedLight.indirectSpecular * 0.4, drops * 0.6);
          gl_FragColor.a = max(gl_FragColor.a, drops * 0.28);
        }`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|wet`;
  return m;
}

// ---------- the night sky: a dark gradient, stars, the moon ----------
/** A scene to render into the sky cube at night: the deep blue-black of high altitude and a few thousand stars. */
export function nightSkyScene() {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; void main() {
      float h = clamp(vDir.y, -1.0, 1.0);
      vec3 zenith = vec3(0.004, 0.007, 0.02), horizon = vec3(0.022, 0.03, 0.055), below = vec3(0.006, 0.007, 0.01);
      vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.45)) : mix(horizon, below, pow(-h, 0.35));
      gl_FragColor = vec4(c, 1.0);
    }`,
  }));
  s.add(sky);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = rnd() * 1.05 - 0.05, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 90, y * 90, Math.sin(a) * r * 90], i * 3);
    const b = Math.pow(rnd(), 9) * 1.6 + 0.05, warm = rnd(); // (most faint, a few bright)
    col.set([b * (0.85 + warm * 0.2), b * 0.92, b * (1.1 - warm * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  s.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
  return s;
}

/**
 * The moon's disc, as it looks from 25,000 feet on a clear night: a bright, slightly gibbous moon, its
 * dark seas where they are on the real near side (Imbrium, Serenitatis, Tranquillitatis, Crisium,
 * Procellarum, Nubium...), bright young craters with their rays (Tycho's down in the south, Copernicus,
 * Kepler), a mottled highland grain, the limb a little darker, the terminator soft. Drawn once.
 */
export function moonTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), R = S * 0.46, cx = S / 2, cy = S / 2;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
  // the highlands: warm grey-white, a fine grain all over
  g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) { const v = 200 + rnd() * 55 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`; g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3); }
  // the seas: overlapping soft dark blotches (x, y in disc radii from the centre, size)
  const seas = [[-0.38, -0.35, 0.3], [-0.1, -0.42, 0.22], [0.14, -0.3, 0.2], [0.22, -0.05, 0.24], [0.55, -0.12, 0.13], [-0.55, 0.05, 0.36],
    [-0.62, -0.18, 0.22], [-0.2, 0.25, 0.18], [0.05, 0.12, 0.12], [0.38, 0.2, 0.16], [-0.42, 0.42, 0.14], [-0.05, -0.05, 0.1]];
  for (const [x, y, r] of seas) for (let k = 0; k < 7; k++) {
    const px = cx + (x + (rnd() - 0.5) * r * 0.6) * R, py = cy + (y + (rnd() - 0.5) * r * 0.6) * R, pr = r * R * (0.55 + rnd() * 0.5);
    const gr = g.createRadialGradient(px, py, 0, px, py, pr);
    gr.addColorStop(0, 'rgba(88,92,102,0.5)'); gr.addColorStop(0.7, 'rgba(104,108,116,0.3)'); gr.addColorStop(1, 'rgba(120,120,125,0)');
    g.fillStyle = gr; g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  // craters: small dark-rimmed pits, and the bright young ones with rays
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, r = 1 + rnd() ** 3 * 9;
    g.fillStyle = 'rgba(120,118,112,0.2)'; g.beginPath(); g.arc(x + r * 0.2, y + r * 0.2, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,253,245,0.35)'; g.beginPath(); g.arc(x - r * 0.15, y - r * 0.15, r * 0.75, 0, 7); g.fill();
  }
  for (const [x, y, n, len] of [[-0.12, 0.66, 26, 0.9], [-0.28, -0.08, 16, 0.45], [-0.58, -0.02, 10, 0.3], [0.62, -0.42, 8, 0.25]]) { // Tycho, Copernicus, Kepler, a fourth
    const px = cx + x * R, py = cy + y * R;
    g.strokeStyle = 'rgba(255,255,250,0.13)';
    for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, l = R * len * (0.4 + rnd() * 0.6); g.lineWidth = 1 + rnd() * 2.5; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); }
    g.fillStyle = 'rgba(255,255,252,0.95)'; g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill();
  }
  // the limb a little darker and cooler; the terminator, soft, just past full on the left
  const limb = g.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  limb.addColorStop(0, 'rgba(0,0,0,0)'); limb.addColorStop(1, 'rgba(40,46,70,0.38)');
  g.fillStyle = limb; g.fillRect(0, 0, S, S);
  const term = g.createLinearGradient(cx - R, 0, cx - R * 0.55, 0);
  term.addColorStop(0, 'rgba(6,8,16,0.92)'); term.addColorStop(1, 'rgba(6,8,16,0)');
  g.fillStyle = term; g.fillRect(0, 0, S, S);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The moon's glow: a soft cold light round it, fading smoothly to nothing. */
export function moonGlowTexture() {
  // a soft glow round the moon, falling smoothly away to nothing: no halo ring, and dithered so its
  // 8-bit steps don't show as rings either
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, m = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x + 0.5 - m, y + 0.5 - m) / m;
    const a = r >= 1 ? 0 : (0.5 * Math.exp(-r / 0.045) + 0.2 * Math.exp(-r / 0.16) + 0.05 * Math.exp(-r / 0.4)) * (1 - r * r) ** 2;
    const k = (y * S + x) * 4, n = Math.random() - 0.5;
    d[k] = 205 - 60 * Math.min(1, r * 2); d[k + 1] = 218 - 55 * Math.min(1, r * 2); d[k + 2] = 250 - 30 * Math.min(1, r * 2);
    d[k + 3] = Math.max(0, Math.min(255, a * 255 + n));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- rain streaking past ----------
/**
 * Rain round the camera: thousands of short streaks drawn in one call, moved entirely on the GPU (the
 * air streams past at the formation's speed, the drops fall). Never inside your own bomber's fuselage.
 */
export class Rain {
  constructor(scene, airspeed) {
    const N = 6000, B = 46; // streaks, half the box they fill round the camera (m)
    const base = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const x = (rnd() * 2 - 1) * B, y = (rnd() * 2 - 1) * B, z = (rnd() * 2 - 1) * B;
      base.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uniforms = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: B }, uSpeed: { value: airspeed },
      uInv: { value: new THREE.Matrix4() }, uExclude: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.6, 0.66) }, uDensity: { value: 1 },
    };
    this.mesh = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform float uTime, uBox, uSpeed, uExclude, uDensity; uniform vec3 uCam; uniform mat4 uInv;
        attribute float aEnd; varying float vA;
        void main() {
          float id = float(gl_VertexID / 2);
          vec3 flow = vec3(0.0, -9.0, uSpeed); // falling, and the air streaming past aft
          vec3 p = position + flow * uTime;
          p = mod(p - uCam + uBox, 2.0 * uBox) - uBox + uCam; // wrapped round the camera
          vec3 dir = normalize(flow);
          p -= dir * aEnd * (1.6 + fract(id * 0.618) * 1.4); // a streak, as the eye sees a drop at speed
          vec3 local = (uInv * vec4(p, 1.0)).xyz; // inside your own fuselage: not drawn
          bool inside = uExclude > 0.5 && abs(local.x) < 1.7 && local.y > -2.9 && local.y < 1.9 && local.z > -11.8 && local.z < 11.6;
          vA = (inside || fract(id * 0.7548) > uDensity) ? 0.0 : (1.0 - smoothstep(uBox * 0.6, uBox, length(p - uCam))) * (aEnd > 0.5 ? 0.1 : 0.55);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main() { if (vA <= 0.001) discard; gl_FragColor = vec4(uColor, vA); }',
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** amount: 0 none, 1 rain, more is heavier. inv: your bomber's inverse world matrix (or null). */
  update(dt, camPos, amount, inv) {
    this.mesh.visible = amount > 0;
    if (!amount) return;
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 1000;
    u.uCam.value.copy(camPos);
    u.uDensity.value = Math.min(1, amount * 0.75);
    u.uExclude.value = inv ? 1 : 0;
    if (inv) u.uInv.value.copy(inv);
  }
}

/** Lightning: now and then a flash (two or three flickers) somewhere in the storm; thunder follows it. */
export class Lightning {
  constructor() { this.t = 4; this.flash = 0; this.flicker = []; }

  /** Returns the flash brightness this frame (0..1); onStrike(distance m) when a bolt goes. */
  update(dt, on, onStrike) {
    if (!on) { this.flash = 0; this.flicker.length = 0; return 0; }
    if ((this.t -= dt) <= 0) {
      this.t = 5 + Math.random() * 12;
      const d = 1500 + Math.random() * 9000, k = Math.min(1, 4000 / d) * (0.6 + Math.random() * 0.4);
      this.flicker = [[0, k], [0.07, k * 0.25], [0.12, k * 0.9], [0.22, k * 0.15], [0.3, k * 0.6]].map(([at, v]) => [at + Math.random() * 0.03, v]);
      this.age = 0;
      onStrike?.(d);
    }
    if (this.flicker.length) {
      this.age += dt;
      let v = 0;
      for (const [at, k] of this.flicker) if (this.age >= at) v = k * Math.exp(-(this.age - at) * 14);
      this.flash = v;
      if (this.age > 1) this.flicker.length = 0;
    } else this.flash = 0;
    return this.flash;
  }
}
