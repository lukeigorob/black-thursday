// Screen-space ambient occlusion: the dark in the corners, under the shelves, round the ribs and
// where the crew stand against the walls. Worked out at half resolution from the depth the scene
// pass already wrote (no second scene render), blurred along edges, then laid over the picture
// before tone mapping. Needs the reversed float depth buffer (see graphics.js).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// view-space position from the depth buffer (reversed: 1 at the near plane, 0 at infinity)
const VIEW_POS = `
  uniform sampler2D tDepth; uniform mat4 invProj;
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = invProj * vec4(uv * 2.0 - 1.0, d, 1.0);
    return p.xyz / p.w;
  }`;

const AO_FRAG = `${VIEW_POS}
  uniform vec2 texel; uniform float radius; uniform float proj; uniform int samples;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float d0 = texture2D(tDepth, vUv).x;
    if (d0 <= 0.0) { gl_FragColor = vec4(1.0); return; } // sky
    vec3 p = viewPos(vUv);
    // the surface normal from the neighbouring depths (the smaller step on each axis, so edges hold)
    vec3 px = viewPos(vUv + vec2(texel.x, 0.0)) - p, nx = p - viewPos(vUv - vec2(texel.x, 0.0));
    vec3 py = viewPos(vUv + vec2(0.0, texel.y)) - p, ny = p - viewPos(vUv - vec2(0.0, texel.y));
    vec3 n = normalize(cross(abs(px.z) < abs(nx.z) ? px : nx, abs(py.z) < abs(ny.z) ? py : ny));
    // the sampling disc: 'radius' metres round the point, in screen terms (smaller far away)
    float r = radius * proj / -p.z;
    if (r < 2.0 * texel.y) { gl_FragColor = vec4(1.0); return; }
    r = min(r, 0.12);
    float a0 = hash(gl_FragCoord.xy) * 6.2832, occ = 0.0;
    for (int i = 0; i < 16; i++) {
      if (i >= samples) break;
      float f = (float(i) + 0.5) / float(samples);
      float a = a0 + float(i) * 2.39996; // golden-angle spiral
      vec2 o = vec2(cos(a), sin(a)) * r * sqrt(f);
      vec3 v = viewPos(vUv + o * vec2(texel.y / texel.x, 1.0)) - p;
      float l = length(v);
      // anything in front of the surface and close by shades it
      occ += max(0.0, dot(n, v / max(l, 1e-4)) - 0.08) * smoothstep(radius * 2.0, radius * 0.4, l);
    }
    float ao = 1.0 - occ / float(samples) * 3.2;
    gl_FragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
  }`;

// a small blur that keeps to surfaces at the same depth (so AO doesn't bleed round edges)
const BLUR_FRAG = `${VIEW_POS}
  uniform sampler2D tAO; uniform vec2 dir; varying vec2 vUv;
  void main() {
    float z = viewPos(vUv).z, sum = 0.0, w = 0.0;
    for (int i = -3; i <= 3; i++) {
      vec2 uv = vUv + dir * float(i);
      float k = exp(-float(i * i) / 6.0) / (1.0 + 40.0 * abs(viewPos(uv).z - z) / max(-z, 0.1));
      sum += texture2D(tAO, uv).r * k; w += k;
    }
    gl_FragColor = vec4(vec3(sum / w), 1.0);
  }`;

const APPLY_FRAG = `uniform sampler2D tDiffuse; uniform sampler2D tAO; uniform float strength; uniform float debug; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float ao = mix(1.0, texture2D(tAO, vUv).r, strength);
    gl_FragColor = debug > 0.5 ? vec4(vec3(ao * 0.6), 1.0) : vec4(c.rgb * ao, c.a); // (debug: the AO alone)
  }`;

export class SSAOPass extends Pass {
  /** samples: 8 (medium) or 14 (high); radius in metres. */
  constructor(camera, { samples = 8, radius = 0.45, strength = 0.9 } = {}) {
    super();
    this.camera = camera;
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blurTarget = this.aoTarget.clone();
    const shared = { tDepth: { value: null }, invProj: { value: new THREE.Matrix4() } };
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...shared, texel: { value: new THREE.Vector2() }, radius: { value: radius }, proj: { value: 1 }, samples: { value: samples } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...shared, tAO: { value: null }, dir: { value: new THREE.Vector2() } },
    });
    this.applyMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: APPLY_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, tAO: { value: null }, strength: { value: strength }, debug: { value: 0 } },
    });
    this.quad = new FullScreenQuad(null);
  }

  setSize(w, h) {
    const x = Math.max(1, Math.round(w / 2)), y = Math.max(1, Math.round(h / 2));
    this.aoTarget.setSize(x, y);
    this.blurTarget.setSize(x, y);
    this.aoMat.uniforms.texel.value.set(1 / x, 1 / y);
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera, depth = readBuffer.depthTexture;
    for (const m of [this.aoMat, this.blurMat]) {
      m.uniforms.tDepth.value = depth;
      m.uniforms.invProj.value.copy(cam.projectionMatrixInverse);
    }
    this.aoMat.uniforms.proj.value = cam.projectionMatrix.elements[5] * 0.5; // (metres at 1 m → screen fraction)
    const t = this.aoMat.uniforms.texel.value;
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.aoTarget); this.quad.render(renderer);
    this.blurMat.uniforms.tAO.value = this.aoTarget.texture; this.blurMat.uniforms.dir.value.set(t.x * 1.5, 0);
    this.quad.material = this.blurMat;
    renderer.setRenderTarget(this.blurTarget); this.quad.render(renderer);
    this.blurMat.uniforms.tAO.value = this.blurTarget.texture; this.blurMat.uniforms.dir.value.set(0, t.y * 1.5);
    renderer.setRenderTarget(this.aoTarget); this.quad.render(renderer);
    this.applyMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.applyMat.uniforms.tAO.value = this.aoTarget.texture;
    this.quad.material = this.applyMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.aoTarget.dispose(); this.blurTarget.dispose();
    this.aoMat.dispose(); this.blurMat.dispose(); this.applyMat.dispose(); this.quad.dispose();
  }
}
