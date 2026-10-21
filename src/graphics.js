// Renderer, post-processing (bloom, vignette, ACES tone mapping) and the Low / Medium / High setting.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, shadows: 0, clouds: 60, bloom: false, msaa: 0 },
  medium: { label: 'Medium', pixelRatio: 1.25, shadows: 2048, clouds: 140, bloom: true, msaa: 4 },
  high: { label: 'High', pixelRatio: 2, shadows: 4096, clouds: 260, bloom: true, msaa: 4 },
};
const KEY = 'bomber.quality';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.35 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.8, 0.2, length(vUv - 0.5) * 1.3);
      c.rgb *= mix(1.0 - strength, 1.0, v);
      gl_FragColor = c;
    }`,
};

export class Graphics {
  constructor() {
    // A cockpit 30 cm away and bombers 3 km away need a lot of depth precision. A reversed float
    // depth buffer gives it for free; the logarithmic one (fallback) disables the GPU's early depth
    // test, so every hidden layer behind the cabin walls gets fully shaded (much slower).
    const probe = document.createElement('canvas').getContext('webgl2');
    this.reversed = !!probe?.getExtension('EXT_clip_control');
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, powerPreference: 'high-performance',
      reversedDepthBuffer: this.reversed, logarithmicDepthBuffer: !this.reversed,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(innerWidth, innerHeight);
    document.body.prepend(this.renderer.domElement);
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    this.qualityName = QUALITY[saved] ? saved : 'medium';
    this.listeners = [];
    addEventListener('resize', () => this.resize());
  }

  get quality() { return QUALITY[this.qualityName]; }

  /** Call once the scene and camera exist; rebuilds the post-processing chain for the quality level. */
  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.setQuality(this.qualityName);
  }

  setQuality(name) {
    this.qualityName = name;
    try { localStorage.setItem(KEY, name); } catch { /* storage blocked */ }
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.dispose();
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    if (this.reversed) target.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType); // 32-bit float depth
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.bloom) {
      // threshold is above the bright horizon sky, so only the sun, tracers and fire glow
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.4, 20);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new ShaderPass(VignetteShader));
    this.composer.addPass(new OutputPass());
    this.resize();
    for (const fn of this.listeners) fn(q);
  }

  onQualityChange(fn) { this.listeners.push(fn); }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    if (this.camera) {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    }
  }

  render() { this.composer.render(); }
}
