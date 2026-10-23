// The sky, sun, haze, ground far below and layered clouds.
// The formation stays near the origin; the ground and clouds scroll past instead.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

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
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH));
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
    scene.add(new THREE.HemisphereLight(0xc4d8f0, 0x6a6458, 0.2));

    this.buildGround(renderer);
    this.cloudTextures = [0, 1, 2, 3].map(cloudTexture);
    this.clouds = [];
  }

  buildSky(renderer) {
    // render the physical sky once into a cube map: crisp background + PBR reflections, no depth issues
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(100);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.2;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    if (u.cloudCoverage) u.cloudCoverage.value = 0.25; // faint high cirrus
    // no physical sun disc: it is thousands of times brighter than anything else and would make the
    // bloom wash out the whole screen (and every metal glow). A sprite sun with sane brightness instead.
    if (u.showSunDisc) u.showSunDisc.value = false;
    envScene.add(sky);
    const rt = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 1000, rt).update(renderer, envScene);
    this.scene.background = rt.texture;
    this.scene.backgroundIntensity = SKY_DIM;
    this.buildSun();
    const envRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 1000, envRT).update(renderer, envScene);
    this.scene.environment = new THREE.PMREMGenerator(renderer).fromCubemap(envRT.texture).texture;
    this.scene.environmentIntensity = 0.6;

    // haze matched to the sky just above the horizon, so the far ground melts into the sky
    this.scene.fog = new THREE.FogExp2((horizonColor(renderer, envScene) ?? HAZE).multiplyScalar(SKY_DIM), FOG_DENSITY);
  }

  buildSun() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.12, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,240,215,0.25)');
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
  }

  buildGround(renderer) {
    const tex = groundTexture();
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.repeat.set(400000 / GROUND_TILE, 400000 / GROUND_TILE);
    this.groundTex = tex;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, envMapIntensity: 0.3 });
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

  setQuality(q) {
    this.sun.castShadow = q.shadows > 0;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.setCloudCount(q.clouds);
  }

  setCloudCount(n) {
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
    const layer = Math.random();
    let y, size, opacity = 1, bright = 1.55; // sunlit cloud, a little brighter than the dimmed horizon
    if (layer < 0.5) { y = rand(-2700, -2200); size = rand(700, 1500); bright = 1.35; } // broken deck far below
    else if (layer < 0.85) { y = rand(-1500, -350); size = rand(250, 650); } // cumulus we fly over
    else { y = rand(350, 900); size = rand(400, 900); opacity = 0.35; } // thin wisps above
    let x = rand(-9000, 9000);
    if (Math.abs(x) < 350 && y > -500) x += Math.sign(x || 1) * 700; // keep the formation's own air clear
    c.position.set(x, y, z);
    c.scale.set(size * rand(1.2, 1.8), size * (layer < 0.5 ? 0.45 : 0.8), 1);
    c.material.opacity = opacity;
    c.material.color.setScalar(bright);
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

  update(dt, speed) {
    this.groundTex.offset.y += (speed * dt) / GROUND_TILE;
    for (const c of this.clouds) {
      c.position.z += speed * dt;
      if (c.position.z > CLOUD_RECYCLE_Z) this.placeCloud(c, c.position.z - CLOUD_SPAN_Z);
    }
  }
}

function rand(a, b) { return a + Math.random() * (b - a); }

/** Average sky colour a couple of degrees above the horizon, away from the sun (linear HDR). */
function horizonColor(renderer, envScene) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;
  const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
  const cam = new THREE.PerspectiveCamera(10, 1, 1, 1000);
  cam.lookAt(new THREE.Vector3(Math.sin(SUN_AZIMUTH * Math.PI / 180 + Math.PI), 0.035, Math.cos(SUN_AZIMUTH * Math.PI / 180 + Math.PI)));
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
function groundTexture() {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrap = (draw) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); draw(); g.restore(); } };
  const CROPS = ['#5f7036', '#6d7b3a', '#7f8a44', '#8c8a4e', '#a39a5c', '#b5a464', '#76653f', '#6a5a3a', '#586a34', '#90955a', '#9a8a52'];

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
  const ROOFS = ['#7a4a3a', '#8a5a44', '#6c6a66', '#9a8a7a', '#704036'];
  const houses = villages.flatMap((v) => Array.from({ length: v.n }, () => {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * (12 + v.n * 0.9);
    return { x: v.x + Math.cos(a) * d, y: v.y + Math.sin(a) * d, rot: rnd() * 3, len: 5 + rnd() * 3, col: ROOFS[Math.floor(rnd() * ROOFS.length)] };
  }));

  // then draw it (the same every time round the wrap)
  g.fillStyle = '#5d6a39';
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
          g.strokeStyle = 'rgba(40,34,20,0.18)'; g.lineWidth = 1;
          g.beginPath();
          for (let k = 3; k < f.w; k += 5) { g.moveTo(f.x + k, f.y); g.lineTo(f.x + k, f.y + f.h); }
          g.stroke();
        }
        g.strokeStyle = 'rgba(38,52,26,0.75)'; g.lineWidth = 2.2; // hedgerow
        g.strokeRect(f.x, f.y, f.w, f.h);
      }
      g.restore();
    }
    for (const t of crowns) { // woods
      g.fillStyle = t.dark ? 'rgba(34,48,26,0.85)' : 'rgba(44,58,30,0.85)';
      g.beginPath(); g.arc(t.x, t.y, t.r, 0, 7); g.fill();
    }
    // a river: a slow meander right across the tile (it joins up with the next tile)
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-10, 300);
    for (let x = 0; x <= S + 10; x += 32) g.lineTo(x, 300 + Math.sin((x / S) * Math.PI * 6) * 140 + Math.sin((x / S) * Math.PI * 18) * 40);
    g.strokeStyle = 'rgba(60,80,60,0.5)'; g.lineWidth = 14; g.stroke(); // banks and water meadows
    g.strokeStyle = '#56686e'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = 'rgba(178,168,140,0.8)'; g.lineWidth = 2; // roads between the villages
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
