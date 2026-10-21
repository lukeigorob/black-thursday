// Loads each aircraft GLB once and hands out clones (geometry and materials are shared).
// If a file fails to load, a simple placeholder plane is used so the game never shows a blank screen.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// real-world sizes in metres (the conversion script already scales the GLBs to these)
export const MODELS = {
  b17: { url: '/models/b17.glb', label: 'B-17 Flying Fortress', length: 22.7, span: 32.6, color: 0x6b6f48 },
  bf109: { url: '/models/bf109.glb', label: 'Bf 109 F-2', length: 8.94, span: 10.4, color: 0x7a8288 },
  p51: { url: '/models/p51.glb', label: 'P-51 Mustang', length: 9.83, span: 11.2, color: 0xb8bcc0 },
};

// big meshes that mix skin with windows. Their opacity maps mark glass at ~82% opacity, which reads as
// a solid speckled panel, so anything under 95% becomes an open cut-out (also in the shadow pass,
// so sunlight falls through the windows into the cabin).
const WINDOWED = new Set(['MainHull', 'Tail_TBTurrets', 'BallTurret_WSupport']);

/** Turn a material's base-colour alpha into a hard window cut-out. `keepColor` false = alpha only. */
export function windowCutout(material, keepColor = true) {
  material.transparent = false;
  material.alphaHash = false;
  material.alphaTest = 0.5;
  material.depthWrite = true;
  material.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
      vec4 texel = texture2D( map, vMapUv );
      ${keepColor ? 'diffuseColor.rgb *= texel.rgb;' : ''}
      diffuseColor.a = texel.a < 0.95 ? 0.0 : 1.0;
    #endif`);
  };
  material.customProgramCacheKey = () => `window-cutout-${keepColor}`;
  return material;
}

// parts whose "glass" is painted solid in the source model: swapped for real glass
const GLASS_PARTS = new Set(['Nose']);
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x9fb4bf, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18,
  envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide,
});
glass.userData.glass = true;

const loader = new GLTFLoader();
const cache = new Map();
const depthMats = new Map();

function prepare(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const m = o.material;
    if (GLASS_PARTS.has(o.name)) {
      o.material = glass;
      o.castShadow = false;
    } else if (WINDOWED.has(m.name)) {
      windowCutout(m);
      if (!depthMats.has(m)) {
        depthMats.set(m, windowCutout(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map }), false));
      }
      o.customDepthMaterial = depthMats.get(m);
    }
  });
  return root;
}

/**
 * Merge every mesh of a model into one mesh per material (a B-17 has ~90 parts = ~90 draw calls,
 * this makes it ~10). Nodes matching `keep` (e.g. propeller hubs that spin) stay separate.
 */
function mergeByMaterial(root, keep) {
  root.updateMatrixWorld(true);
  const kept = [];
  root.traverse((o) => { if (o !== root && keep?.test(o.name) && !kept.some((k) => isUnder(o, k))) kept.push(o); });
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh || kept.some((k) => isUnder(o, k))) return;
    const src = o.geometry, g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv']) {
      g.setAttribute(n, src.attributes[n] ?? new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * (n === 'uv' ? 2 : 3)), n === 'uv' ? 2 : 3));
    }
    g.setIndex(src.index ?? [...Array(src.attributes.position.count).keys()]);
    g.applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.customDepthMaterial = depthMats.get(mat);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  }
  for (const k of kept) { // hubs have no rotation of their own (baked in the conversion)
    const c = k.clone();
    c.position.copy(k.getWorldPosition(new THREE.Vector3()));
    out.add(c);
  }
  return out;
}
const isUnder = (o, p) => { for (let x = o; x; x = x.parent) if (x === p) return true; return false; };

function placeholder(name) {
  const { length, span, color } = MODELS[name];
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });
  const add = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  const r = length * 0.06;
  add(r * 2, r * 2, length, 0, 0, 0);
  add(span, r * 0.4, length * 0.18, 0, 0, -length * 0.08);
  add(span * 0.35, r * 0.3, length * 0.1, 0, r * 0.5, length * 0.44);
  add(r * 0.3, r * 3, length * 0.12, 0, r * 1.8, length * 0.43);
  g.name = `${name}_placeholder`;
  return g;
}

/**
 * Resolves to { scene, ok } — `scene` is a fresh clone, or a placeholder when loading failed.
 * lod: the low-detail version (decimated, small textures) for planes far away;
 * mid: the in-between version for nearby wingmen (B-17 only).
 */
export async function loadModel(name, { lod = false, mid = false } = {}) {
  const suffix = lod ? '_lod' : mid ? '_mid' : '';
  const key = name + suffix;
  const url = MODELS[name].url.replace('.glb', `${suffix}.glb`);
  if (!cache.has(key)) {
    cache.set(
      key,
      loader
        .loadAsync(url)
        // lower-detail versions are only looked at, never taken apart: merge them for speed
        .then((gltf) => ({ scene: suffix ? mergeByMaterial(prepare(gltf.scene), /^Prop_\d$/) : prepare(gltf.scene), ok: true }))
        .catch((err) => {
          console.warn(`Could not load ${url}, using a placeholder.`, err);
          return { scene: placeholder(name), ok: false };
        }),
    );
  }
  const { scene, ok } = await cache.get(key);
  return { scene: scene.clone(true), ok };
}
