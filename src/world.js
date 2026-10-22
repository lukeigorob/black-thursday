// The sky, sun, haze, ground far below and layered clouds.
// The formation stays near the origin; the ground and clouds scroll past instead.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const ALTITUDE = 7600; // ~25,000 ft
const SUN_ELEVATION = 38, SUN_AZIMUTH = 150; // degrees
const CLOUD_RECYCLE_Z = 4000, CLOUD_SPAN_Z = 18000;
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
    tex.repeat.set(400, 400); // 1 km per tile
    this.groundTex = tex;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400000, 400000),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, envMapIntensity: 0.3 }));
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
  follow(pos) {
    this.sun.target.position.copy(pos);
    this.sun.position.copy(this.sunDir).multiplyScalar(200).add(pos);
  }

  update(dt, speed) {
    this.groundTex.offset.y += (speed * dt) / 1000;
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

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const fields = ['#5d6b3f', '#6f7a46', '#7c7650', '#55603a', '#867f58', '#68744a', '#4d5a36'];
  for (let i = 0; i < 1400; i++) { // patchwork farmland
    g.fillStyle = fields[(Math.random() * fields.length) | 0];
    const w = 20 + Math.random() * 90, h = 20 + Math.random() * 90;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, w, h);
  }
  g.fillStyle = 'rgba(40,52,30,0.55)'; // woods
  for (let i = 0; i < 70; i++) {
    g.beginPath();
    g.ellipse(Math.random() * 1024, Math.random() * 1024, 20 + Math.random() * 60, 15 + Math.random() * 40, Math.random() * 3, 0, 7);
    g.fill();
  }
  g.strokeStyle = 'rgba(170,160,135,0.5)'; // roads
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(Math.random() * 1024, 0);
    g.bezierCurveTo(Math.random() * 1024, 340, Math.random() * 1024, 680, Math.random() * 1024, 1024);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
