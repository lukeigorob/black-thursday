// The sky, sun, haze, ground far below and layered clouds.
// The formation stays near the origin; the ground and clouds scroll past instead.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TIMES, WEATHER, SNOW, nightSkyScene, moonTexture, moonGlowTexture, Rain, Lightning } from './environment.js';

export const ALTITUDE = 7600; // ~25,000 ft
const SUN_ELEVATION = 38, SUN_AZIMUTH = 150; // degrees
const CLOUD_RECYCLE_Z = 4000, CLOUD_SPAN_Z = 18000;
const GROUND_TILE = 6000; // m of countryside per texture tile (blended at a second scale so it doesn't repeat)
const HAZE = new THREE.Color(0.32, 0.42, 0.56); // linear
// at 25,000 ft the sky is a deep blue: draw it darker than the raw sky model so planes, smoke and
// fires stand out against it instead of being lost in the glare
const SKY_DIM = 0.55, FOG_DENSITY = 2.4e-5; // half the old haze: you can see the battle 2-3x further

export class World {
  constructor(renderer, scene) {
    this.scene = scene;
    this.renderer = renderer;
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH));
    this.look = { ...TIMES.day, overcast: 0, fog: 1, cover: 1, deck: 0.5 };
    this.buildSky(renderer);

    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.2);
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    const s = this.sun.shadow;
    s.camera.left = s.camera.bottom = -45;
    s.camera.right = s.camera.top = 45;
    s.camera.near = 50;
    s.camera.far = 400;
    s.bias = -0.0003;
    s.normalBias = 0.04;
    s.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xc4d8f0, 0x6a6458, 0.2);
    scene.add(this.hemi);

    this.buildGround(renderer);
    this.cloudTextures = [0, 1, 2, 3].map(cloudTexture);
    this.clouds = [];
    this.cloudCount = 0;
    this.rain = new Rain(scene, 0);
    this.lightning = new Lightning();
    this.flash = 0;
  }

  /**
   * The hour, season and weather (environment.js): the sky is drawn afresh, the sun (or the moon) moves
   * and changes colour, the haze, the cloud cover and the ground follow. Returns the exposure to use.
   */
  setEnv(env) {
    const L = TIMES[env.time], W = WEATHER[env.weather], o = W.overcast, winter = env.season === 'winter';
    this.env = env;
    this.look = { ...L, overcast: o, fog: W.fog, cover: W.cover, deck: W.deck, rain: W.rain, storm: W.storm, winter };
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - L.elev), THREE.MathUtils.degToRad(L.az));
    this.buildSky(this.renderer);
    // the sun (or by night the moon): dimmed and its shadows softened under cloud; colder in winter
    const c = new THREE.Color(...L.sun);
    if (winter) c.multiply(new THREE.Color(0.93, 0.97, 1.06));
    this.sun.color.copy(c);
    this.sun.intensity = L.sunI * (1 - 0.7 * o);
    this.hemi.color.setHex(L.hemi[0]); this.hemi.groundColor.setHex(winter ? 0x8a8e94 : L.hemi[1]);
    this.hemi.intensity = this.hemiBase = L.hemi[2] * (1 + 1.6 * o) * (winter && !L.night ? 1.25 : 1);
    this.scene.environmentIntensity = L.env * (1 - 0.3 * o);
    // the clouds: how many, how low, and how lit
    this.cloudTint = new THREE.Color(...L.cloud).multiplyScalar(1 - 0.5 * o);
    this.setCloudCount(this.cloudCount, true);
    // snow on the fields and the town
    SNOW.value = winter ? 1 : 0;
    this.groundMat.map = winter ? this.winterGround() : this.groundTex;
    this.groundMat.needsUpdate = true;
    return L.exp * (1 + 0.25 * o);
  }

  buildSky(renderer) {
    // render the physical sky once into a cube map: crisp background + PBR reflections, no depth issues
    const L = this.look, o = L.overcast, mix = (a, b) => a + (b - a) * o;
    let envScene;
    if (L.night) envScene = nightSkyScene(); // a dark sky and its stars
    else {
      envScene = new THREE.Scene();
      const sky = new Sky();
      sky.scale.setScalar(100);
      const u = sky.material.uniforms;
      // under cloud the sky goes milky grey: more haze, less blue
      u.turbidity.value = mix(L.turb, 20);
      u.rayleigh.value = mix(L.ray, 0.35);
      u.mieCoefficient.value = mix(L.mie, 0.04);
      u.mieDirectionalG.value = L.elev < 15 ? 0.74 : 0.82; // (a low sun: a softer glow round it, not a white-out)
      u.sunPosition.value.copy(this.sunDir);
      if (u.cloudCoverage) u.cloudCoverage.value = 0.25; // faint high cirrus
      // no physical sun disc: it is thousands of times brighter than anything else and would make the
      // bloom wash out the whole screen (and every metal glow). A sprite sun with sane brightness instead.
      if (u.showSunDisc) u.showSunDisc.value = false;
      envScene.add(sky);
    }
    if (o) { // the overcast: a grey lid over the sky (and the stars)
      const lid = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.MeshBasicMaterial({
        color: L.night ? new THREE.Color(0.01, 0.011, 0.014) : new THREE.Color(0.62, 0.65, 0.7), transparent: true, opacity: Math.min(0.95, o * 0.95), side: THREE.BackSide, depthWrite: false }));
      lid.renderOrder = 1;
      envScene.add(lid);
    }
    for (const t of [this.skyRT, this.envRT]) t?.dispose();
    if (this.envTex) this.envTex.dispose();
    const rt = this.skyRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 1000, rt).update(renderer, envScene);
    this.scene.background = rt.texture;
    this.scene.backgroundIntensity = this.skyBase = L.night ? 1 : L.dim * (1 - 0.35 * o);
    this.buildSun();
    const envRT = this.envRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 1000, envRT).update(renderer, envScene);
    this.scene.environment = this.envTex = (this.pmrem ??= new THREE.PMREMGenerator(renderer)).fromCubemap(envRT.texture).texture;
    this.scene.environmentIntensity = 0.6;

    // haze matched to the sky just above the horizon, so the far ground melts into the sky (grey in
    // overcast and rain, near black at night), thicker in bad weather
    const haze = L.night ? new THREE.Color(0.012, 0.016, 0.03) : (horizonColor(renderer, envScene, L.az) ?? HAZE.clone()).multiplyScalar(L.dim);
    if (o) haze.lerp(new THREE.Color(0.2, 0.215, 0.235).multiplyScalar(L.night ? 0.08 : L.dim * 1.6), o * 0.8);
    if (this.scene.fog) { this.scene.fog.color.copy(haze); this.scene.fog.density = FOG_DENSITY * L.fog; } else this.scene.fog = new THREE.FogExp2(haze, FOG_DENSITY);
    this.fogBase = this.scene.fog.color.clone();
  }

  buildSun() {
    // the sun's sprite (and the moon's): made once, then moved and shown or hidden with the hour
    const L = this.look;
    if (this.sunSprite) {
      this.sunSprite.position.copy(this.sunDir).multiplyScalar(90000);
      this.sunSprite.material.color.setRGB(...L.sun).multiplyScalar(L.elev < 5 ? 2.2 : L.elev < 15 ? 3 : 6); // (bright, but not a white-out through the bloom)
      this.sunSprite.visible = !L.night && L.overcast < 0.7;
      this.moon ??= new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), color: new THREE.Color(1.15, 1.15, 1.2), fog: false, depthWrite: false, transparent: true }));
      this.moonGlow ??= new THREE.Sprite(new THREE.SpriteMaterial({ map: moonGlowTexture(), color: new THREE.Color(1.1, 1.15, 1.35), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.moon.position.copy(this.sunDir).multiplyScalar(90000);
      this.moonGlow.position.copy(this.sunDir).multiplyScalar(91000);
      this.moon.scale.setScalar(6800); // (a big moon: the way it looms over the clouds at night)
      this.moonGlow.scale.setScalar(70000); // (its glow)
      this.moon.renderOrder = -1; this.moonGlow.renderOrder = -2;
      this.moon.visible = this.moonGlow.visible = !!L.night && L.overcast < 0.7;
      if (!this.moon.parent) this.scene.add(this.moonGlow, this.moon);
      return;
    }
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.12, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,240,215,0.12)');
    grd.addColorStop(1, 'rgba(255,230,200,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(18), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    sun.position.copy(this.sunDir).multiplyScalar(90000);
    sun.scale.setScalar(9000);
    sun.renderOrder = -1;
    this.scene.add(sun);
    this.sunSprite = sun;
  }

  buildGround(renderer) {
    const tex = groundTexture();
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.repeat.set(400000 / GROUND_TILE, 400000 / GROUND_TILE);
    this.groundTex = tex;
    const mat = this.groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, envMapIntensity: 0.3 });
    // break up the tiling: blend the same farmland at a second, rotated scale, under a slow
    // patchwork of lighter and darker country (all in the shader, one texture)
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
        vec2 uvA = vMapUv;
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.37 + vec2(0.31, 0.71);
        float n = sin(vMapUv.x * 0.61 + sin(vMapUv.y * 0.43) * 2.0) * sin(vMapUv.y * 0.53 + sin(vMapUv.x * 0.37) * 2.0);
        vec4 a = texture2D(map, uvA), b = texture2D(map, uvB);
        vec4 texel = mix(a, b, smoothstep(-0.35, 0.35, n));
        texel.rgb *= 0.92 + 0.16 * sin(vMapUv.x * 0.21 + vMapUv.y * 0.17); // big gentle variations
        diffuseColor *= texel;
      #endif`);
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -ALTITUDE;
    this.scene.add(ground);
  }

  /** The snow-covered countryside's texture (painted once, the first time it's needed or in idle time). */
  winterGround() {
    if (!this.winterTex) { this.winterTex = this.tile(groundTexture(true)); this.renderer.initTexture(this.winterTex); }
    return this.winterTex;
  }

  /** Draw the other kinds of sky once now (the night sky's shader), so switching to them later doesn't stall. */
  warmSkies() {
    const rt = new THREE.WebGLCubeRenderTarget(16, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 1000, rt).update(this.renderer, nightSkyScene());
    rt.dispose();
  }

  /** A ground texture set up to tile like the first (anisotropy, repeat; the offset shared, so both scroll). */
  tile(t) {
    t.anisotropy = this.groundTex.anisotropy;
    t.repeat.copy(this.groundTex.repeat);
    t.offset = this.groundTex.offset;
    return t;
  }

  setQuality(q) {
    this.sun.castShadow = q.shadows > 0;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.setCloudCount(q.clouds);
  }

  /** base: the quality setting's count (the weather scales it). again: re-place all of them (the weather changed). */
  setCloudCount(base, again = false) {
    this.cloudCount = base;
    const n = Math.min(520, Math.round(base * (this.look.cover ?? 1)));
    if (again) for (const c of this.clouds) this.placeCloud(c, c.position.z);
    while (this.clouds.length > n) { const c = this.clouds.pop(); this.scene.remove(c); c.material.dispose(); }
    while (this.clouds.length < n) {
      const c = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.cloudTextures[this.clouds.length % 4], depthWrite: false, fog: true }));
      this.placeCloud(c, rand(-CLOUD_SPAN_Z + CLOUD_RECYCLE_Z, CLOUD_RECYCLE_Z));
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  placeCloud(c, z) {
    const layer = Math.random(), L = this.look, deck = L.deck ?? 0.5, o = L.overcast ?? 0;
    let y, size, opacity = 1, bright = 1.55; // sunlit cloud, a little brighter than the dimmed horizon
    if (layer < deck) { y = rand(-2700, -2200); size = rand(700, 1500) * (1 + o * 0.6); bright = 1.35; } // the deck far below (solid under overcast)
    else if (layer < deck + (1 - deck) * 0.7) { y = rand(-1500, -350); size = rand(250, 650); } // cumulus we fly over
    else { y = rand(350, 900 + o * 1500); size = rand(400, 900) * (1 + o); opacity = 0.35 + o * 0.5; } // wisps above (a grey ceiling in rain)
    let x = rand(-9000, 9000);
    if (Math.abs(x) < 350 && y > -500) x += Math.sign(x || 1) * 700; // keep the formation's own air clear
    c.position.set(x, y, z);
    c.scale.set(size * rand(1.2, 1.8), size * (layer < 0.5 ? 0.45 : 0.8), 1);
    c.material.opacity = opacity;
    c.material.color.copy(this.cloudTint ?? WHITE).multiplyScalar(bright / 1.55);
    c.userData.color = c.material.color.clone();
  }

  /** Keep the sun's shadow box on the player's bomber, wherever in the stream it is. */
  follow(pos, inside = false) {
    // inside the bomber the box closes in on it (span and length): four times the texels, so the
    // sun through the windows and gun hatches lands as crisp shapes, not soft blobs
    const half = inside ? 17 : 45, c = this.sun.shadow.camera;
    if (c.right !== half) {
      c.left = c.bottom = -half; c.right = c.top = half;
      this.sun.shadow.radius = inside ? 1.5 : 3;
      this.sun.shadow.normalBias = inside ? 0.015 : 0.04;
      c.updateProjectionMatrix();
    }
    this.sun.target.position.copy(pos);
    this.sun.position.copy(this.sunDir).multiplyScalar(200).add(pos);
  }

  /**
   * camPos: rain falls round it; inv: your bomber's inverse matrix (no rain inside it), or null.
   * onStrike(distance): lightning has struck (thunder follows).
   */
  weather(dt, camPos, inv, onStrike) {
    const L = this.look;
    this.rain.update(dt, camPos, L.rain ?? 0, inv);
    const f = this.lightning.update(dt, !!L.storm, onStrike);
    if (f === this.flash) return;
    this.flash = f;
    // a flash lights everything for a moment: the sky, the clouds, the haze, the planes
    this.hemi.intensity = this.hemiBase + f * 3;
    this.scene.backgroundIntensity = this.skyBase + f * 1.6;
    this.scene.fog.color.copy(this.fogBase).addScalar(f * 0.12);
    for (const c of this.clouds) c.material.color.copy(c.userData.color).addScalar(f * 1.4);
  }

  update(dt, speed) {
    this.rain.uniforms.uSpeed.value = speed;
    this.groundTex.offset.y += (speed * dt) / GROUND_TILE;
    for (const c of this.clouds) {
      c.position.z += speed * dt;
      if (c.position.z > CLOUD_RECYCLE_Z) this.placeCloud(c, c.position.z - CLOUD_SPAN_Z);
    }
  }
}

function rand(a, b) { return a + Math.random() * (b - a); }
const WHITE = new THREE.Color(1.55, 1.55, 1.55);

/** Average sky colour a couple of degrees above the horizon, away from the sun (linear HDR). */
function horizonColor(renderer, envScene, az = SUN_AZIMUTH) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;
  const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
  const cam = new THREE.PerspectiveCamera(10, 1, 1, 1000);
  cam.lookAt(new THREE.Vector3(Math.sin(az * Math.PI / 180 + Math.PI), 0.035, Math.cos(az * Math.PI / 180 + Math.PI)));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(envScene, cam);
  renderer.setRenderTarget(prev);
  const px = new Float32Array(8 * 8 * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, 8, 8, px);
  rt.dispose();
  const c = new THREE.Color(0, 0, 0);
  for (let i = 0; i < 64; i++) { c.r += px[i * 4] / 64; c.g += px[i * 4 + 1] / 64; c.b += px[i * 4 + 2] / 64; }
  return c.r + c.g + c.b > 0 ? c : null;
}

function cloudTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 34; i++) {
    const r = 26 + rnd() * 58;
    const x = 128 + (rnd() - 0.5) * 150, y = 140 + (rnd() - 0.5) * 70 - r * 0.25;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'source-atop'; // shade the underside
  const lg = g.createLinearGradient(0, 70, 0, 220);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(1, 'rgba(140,150,168,0.65)');
  g.fillStyle = lg;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Farmland seen from 25,000 ft, tileable: patchwork fields (crops, pasture, ploughed earth) edged with
 * hedgerows, woods, villages along the roads, and a river. Everything is laid out first, then drawn
 * wrapped round the edges, so the tiles join without a seam.
 */
function groundTexture(winter = false) {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrap = (draw) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); draw(); g.restore(); } };
  const CROPS = winter ? ['#e6eaee', '#dde2e6', '#eef1f3', '#d6dbdf', '#cfd3d4', '#c4c6c2', '#e2e5e7', '#bcbdb6', '#d9dde0', '#e9ecee', '#c9ccc9']
    : ['#5f7036', '#6d7b3a', '#7f8a44', '#8c8a4e', '#a39a5c', '#b5a464', '#76653f', '#6a5a3a', '#586a34', '#90955a', '#9a8a52'];

  // lay it all out
  const blocks = []; // blocks of land at their own angle, cut into strips and parcels (old field systems)
  for (let by = 0; by < S; by += 256) for (let bx = 0; bx < S; bx += 256) {
    const fields = [];
    const split = (x, y, w, h, depth) => {
      if (depth > 4 || (w < 90 && h < 90) || (depth > 2 && rnd() < 0.25)) {
        fields.push({ x, y, w, h, col: CROPS[Math.floor(rnd() * CROPS.length)], furrows: rnd() < 0.35 });
        return;
      }
      if (w > h ? rnd() < 0.8 : rnd() < 0.2) { const k = w * (0.3 + rnd() * 0.4); split(x, y, k, h, depth + 1); split(x + k, y, w - k, h, depth + 1); }
      else { const k = h * (0.3 + rnd() * 0.4); split(x, y, w, k, depth + 1); split(x, y + k, w, h - k, depth + 1); }
    };
    split(-170, -170, 340, 340, 0);
    blocks.push({ x: bx + 128 + rnd() * 40, y: by + 128 + rnd() * 40, a: (rnd() - 0.5) * 1.2, fields });
  }
  const crowns = [];
  for (let i = 0; i < 60; i++) {
    const x = rnd() * S, y = rnd() * S, r = 25 + rnd() * 70, n = 20 + Math.floor(rnd() * 50);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r;
      crowns.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, r: 6 + rnd() * 10, dark: rnd() < 0.5 });
    }
  }
  const villages = Array.from({ length: 14 }, () => ({ x: rnd() * S, y: rnd() * S, n: 12 + Math.floor(rnd() * 40) }));
  const roads = villages.map((v, i) => {
    const w = villages[(i + 1) % villages.length];
    return { v, w, cx: (v.x + w.x) / 2 + (rnd() - 0.5) * 300, cy: (v.y + w.y) / 2 + (rnd() - 0.5) * 300 };
  });
  const ROOFS = winter ? ['#e4e7ea', '#d8dcdf', '#cfd2d4', '#e9ebed', '#9a948c'] : ['#7a4a3a', '#8a5a44', '#6c6a66', '#9a8a7a', '#704036'];
  const houses = villages.flatMap((v) => Array.from({ length: v.n }, () => {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * (12 + v.n * 0.9);
    return { x: v.x + Math.cos(a) * d, y: v.y + Math.sin(a) * d, rot: rnd() * 3, len: 5 + rnd() * 3, col: ROOFS[Math.floor(rnd() * ROOFS.length)] };
  }));

  // then draw it (the same every time round the wrap)
  g.fillStyle = winter ? '#d8dcdf' : '#5d6a39';
  g.fillRect(0, 0, S, S);
  wrap(() => {
    for (const b of blocks) {
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.a);
      for (const f of b.fields) {
        g.fillStyle = f.col;
        g.fillRect(f.x, f.y, f.w, f.h);
        if (f.furrows) { // ploughed or harvested: faint furrows
          g.strokeStyle = winter ? 'rgba(90,86,78,0.22)' : 'rgba(40,34,20,0.18)'; g.lineWidth = 1;
          g.beginPath();
          for (let k = 3; k < f.w; k += 5) { g.moveTo(f.x + k, f.y); g.lineTo(f.x + k, f.y + f.h); }
          g.stroke();
        }
        g.strokeStyle = winter ? 'rgba(70,64,58,0.7)' : 'rgba(38,52,26,0.75)'; g.lineWidth = 2.2; // hedgerow (bare in winter)
        g.strokeRect(f.x, f.y, f.w, f.h);
      }
      g.restore();
    }
    for (const t of crowns) { // woods
      g.fillStyle = winter ? (t.dark ? 'rgba(52,62,50,0.8)' : 'rgba(104,96,88,0.7)') : t.dark ? 'rgba(34,48,26,0.85)' : 'rgba(44,58,30,0.85)'; // (in winter: bare woods, the odd dark pine)
      g.beginPath(); g.arc(t.x, t.y, t.r, 0, 7); g.fill();
    }
    // a river: a slow meander right across the tile (it joins up with the next tile)
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-10, 300);
    for (let x = 0; x <= S + 10; x += 32) g.lineTo(x, 300 + Math.sin((x / S) * Math.PI * 6) * 140 + Math.sin((x / S) * Math.PI * 18) * 40);
    g.strokeStyle = winter ? 'rgba(150,154,156,0.5)' : 'rgba(60,80,60,0.5)'; g.lineWidth = 14; g.stroke(); // banks and water meadows
    g.strokeStyle = winter ? '#8a979d' : '#56686e'; g.lineWidth = 6; g.stroke(); // (iced over in winter)
    g.strokeStyle = winter ? 'rgba(150,146,138,0.8)' : 'rgba(178,168,140,0.8)'; g.lineWidth = 2; // roads between the villages
    for (const r of roads) { g.beginPath(); g.moveTo(r.v.x, r.v.y); g.quadraticCurveTo(r.cx, r.cy, r.w.x, r.w.y); g.stroke(); }
    for (const h of houses) {
      g.fillStyle = h.col;
      g.save(); g.translate(h.x, h.y); g.rotate(h.rot); g.fillRect(-2.5, -1.8, h.len, 3.6); g.restore();
    }
    g.fillStyle = '#8f8a80';
    for (const v of villages) g.fillRect(v.x - 3, v.y - 3, 6, 6); // the church
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
