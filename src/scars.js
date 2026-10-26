// Battle damage you can see on the outside of the bomber, and the grime of hard flying:
//  - every hit leaves a hole: a dark puncture, the paint flaked round it to bare metal, and soot
//    blown back from it (cannon shells: bigger, ragged, scorched);
//  - each engine's exhaust has stained the nacelle and the wing behind it.
// All in the hull's shaders, from a list of the last hits in bomber space, so there's no extra
// geometry or draw call. Bomber space comes from a baked vertex attribute (`aBP`): the GLB's parts
// each have their own transform, but every clone of the model shares its geometry.
import * as THREE from 'three';
import { ENGINE_X } from './bomber.js';

const MAX = 32;
export const SCAR_MAX = MAX;
export const SCARS = {
  light: { value: 1 }, // daylight through a hole, seen from inside (dim by night: main)
  hits: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0, -100, 0, 0)) }, // xyz, w = radius (0: none)
  detail: { value: 1 }, // the quality setting: 0 turns it all off
  next: 0,
};
let ENG = null; // the exhaust stacks, under the cowling (made on first use: bomber.js imports the interior, which imports this)

/** Bake bomber-space positions into every mesh of a loaded B-17 (once per shared geometry). */
export function bakeBomberSpace(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.geometry.attributes.aBP) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position, a = new Float32Array(p.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(m).toArray(a, i * 3);
    o.geometry.setAttribute('aBP', new THREE.BufferAttribute(a, 3));
  });
}

/** Give a hull material the scars and the exhaust staining (chains its own shader hook). */
export function scarMaterial(mat) {
  if (!mat || mat.userData.scars || !(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) || mat.userData.glass) return mat;
  mat.userData.scars = true;
  ENG ??= ENGINE_X.map((x) => new THREE.Vector3(x, -0.85, -7.4));
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uHits = SCARS.hits;
    sh.uniforms.uScarOn = SCARS.detail;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aBP; varying vec3 vBP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = aBP;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vBP; uniform vec4 uHits[${MAX}]; uniform float uScarOn;
      float sh1(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float sn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(sh1(i), sh1(i + vec3(1,0,0)), f.x), mix(sh1(i + vec3(0,1,0)), sh1(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(sh1(i + vec3(0,0,1)), sh1(i + vec3(1,0,1)), f.x), mix(sh1(i + vec3(0,1,1)), sh1(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + scarRough, 0.0, 1.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float scarRough = 0.0;
      if (uScarOn > 0.5) {
        // exhaust: soot streaming back from each cowling over the nacelle and the wing behind
        ${ENG.map((e) => `{ vec3 q = vBP - vec3(${e.x.toFixed(2)}, ${e.y.toFixed(2)}, ${e.z.toFixed(2)});
          float along = smoothstep(-0.3, 0.4, q.z) * (1.0 - smoothstep(1.0, 5.2, q.z));
          float across = exp(-q.x * q.x / max(0.22 + 0.06 * q.z, 0.15)) * smoothstep(-1.0, -0.75, q.y) * (1.0 - smoothstep(0.25, 0.75, q.y)); // (the nacelle's belly and sides, not its top)
          float streak = 0.6 + 0.4 * sn3(vec3(q.x * 14.0, q.y * 14.0, q.z * 1.2));
          float s = along * across * streak;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.032, 0.03), s * 0.75); scarRough += s * 0.2; }`).join('\n')}
        // the hits
        for (int i = 0; i < ${MAX}; i++) {
          vec4 h = uHits[i];
          if (h.w <= 0.0) continue;
          vec3 d = vBP - h.xyz;
          float l = length(d);
          if (l > h.w * 4.0) continue;
          float rag = sn3(vBP * 90.0) * 0.5 + sn3(vBP * 23.0) * 0.5;
          float hole = 1.0 - smoothstep(h.w * (0.18 + 0.2 * rag), h.w * (0.26 + 0.2 * rag), l);
          float flake = (1.0 - smoothstep(h.w * (0.4 + 0.5 * rag), h.w * (0.55 + 0.6 * rag), l)) * (1.0 - hole);
          // soot blown back along the fuselage (+z) from the hole, streaky
          float back = clamp(d.z / (h.w * 3.5), 0.0, 1.0);
          float soot = exp(-(d.x * d.x + d.y * d.y) / (h.w * h.w * (0.5 + 2.0 * back))) * step(-h.w * 0.6, d.z) * (1.0 - smoothstep(h.w, h.w * 3.5, d.z)) * (0.55 + 0.45 * sn3(vBP * 30.0));
          soot = max(soot, 1.0 - smoothstep(h.w * 0.3, h.w * 1.3, l)) * (1.0 - hole);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.63, 0.6), flake * 0.85); // bare aluminium
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.025), soot * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.005), hole); // the hole itself
          scarRough += soot * 0.3 - flake * 0.25;
        }
      }`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|scars`;
  return mat;
}

const _ray = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
/**
 * A round hit the player's bomber at bomber-space point `local`, travelling `dir` (bomber space):
 * find the skin it went through (a ray against the model) and mark it there.
 */
export function addScar(bomber, local, dir, cannon) {
  const model = bomber.model;
  if (!model || !SCARS.detail.value) return;
  const meshes = (bomber._scarMeshes ??= collect(model));
  const m = bomber.group.matrixWorld;
  _d.copy(dir).normalize();
  _o.copy(local).addScaledVector(_d, -1.5).applyMatrix4(m);
  _ray.set(_o, _d.transformDirection(m));
  _ray.far = 4;
  const hit = _ray.intersectObjects(meshes, false)[0];
  if (!hit) return;
  const p = bomber.group.worldToLocal(hit.point.clone());
  SCARS.hits.value[SCARS.next].set(p.x, p.y, p.z, cannon ? 0.2 + Math.random() * 0.08 : 0.06 + Math.random() * 0.03);
  SCARS.next = (SCARS.next + 1) % MAX;
}
const collect = (model) => {
  const out = [];
  model.traverse((o) => { if (o.isMesh && o.visible && !o.name.endsWith('_lining') && !o.isSkinnedMesh && o.geometry.attributes.aBP) out.push(o); });
  return out;
};

/** A fresh bomber (or the player moved to another one): no holes. */
export function clearScars() {
  for (const h of SCARS.hits.value) h.set(0, -100, 0, 0);
  SCARS.next = 0;
}
