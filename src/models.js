// Loads each aircraft GLB once and hands out clones (geometry and materials are shared).
// If a file fails to load, a simple placeholder plane is used so the game never shows a blank screen.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildFw190 } from './fw190.js';

// real-world sizes in metres (the conversion script already scales the GLBs to these)
export const MODELS = {
  b17: { url: '/models/b17.glb', label: 'B-17 Flying Fortress', length: 22.7, span: 32.6, color: 0x6b6f48 },
  bf109: { url: '/models/bf109.glb', label: 'Bf 109 F-2', length: 8.94, span: 10.4, color: 0x7a8288 },
  p51: { url: '/models/p51.glb', label: 'P-51 Mustang', length: 9.83, span: 11.2, color: 0xb8bcc0 },
  fw190: { build: buildFw190, label: 'Fw 190 A-8', length: 9.0, span: 10.5, color: 0x5a5a68 }, // (built in code: fw190.js)
};

// big meshes that mix skin with windows. Their opacity maps mark glass at ~82% opacity, which reads as
// a solid speckled panel, so anything under 95% becomes an open cut-out (also in the shadow pass,
// so sunlight falls through the windows into the cabin).
const WINDOWED = new Set(['MainHull', 'Tail_TBTurrets']);

/** Turn a material's base-colour alpha into a hard window cut-out. `keepColor` false = alpha only. */
export function windowCutout(material, keepColor = true) {
  material.transparent = false;
  material.alphaHash = false;
  material.alphaTest = 0.5;
  material.depthWrite = true;
  material.onBeforeCompile = (s) => {
    // (the full-size texture, not a mip level: seen small, as from the sun, the windows' alpha would
    // be averaged in with the skin's round them and no window would be cut out of the shadow)
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
      vec4 texel = ${keepColor ? 'texture2D( map, vMapUv )' : 'textureLod( map, vMapUv, 0.0 )'};
      ${keepColor ? 'diffuseColor.rgb *= texel.rgb;' : ''}
      diffuseColor.a = texel.a < 0.95 ? 0.0 : 1.0;
    #endif`);
  };
  material.customProgramCacheKey = () => `window-cutout-${keepColor}`;
  return material;
}

/**
 * The ball turret's shell (and the support it hangs from), as in the photos of the Sperry ball: bare,
 * slightly worn aluminium framing round big glass panes. The model's texture is pale blue-white (drawn
 * as glass all over), so its alpha says which is which, and only its light and dark detail (panel
 * lines, rivets) is kept on the metal. The panes are real glass: dark, glossy, reflecting the sky, and
 * a little see-through, so you get a hint of the guns and frames inside.
 */
function steelBall(material) {
  material.transparent = true; // (the panes)
  material.alphaTest = 0;
  material.depthWrite = true;
  material.color.set(0x9a9e9c); // bare aluminium, weathered: dull, not chrome
  material.metalness = 0.6;
  material.roughness = 0.5;
  material.envMapIntensity = 0.6;
  material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
      vec4 texel = texture2D( map, vMapUv );
      float detail = dot(texel.rgb, vec3(0.3, 0.55, 0.15));
      float pane = texel.a < 0.95 ? 1.0 : 0.0;
      // metal: aluminium with the texture's panel lines and a little wear; glass: dark, a bit see-through
      diffuseColor.rgb = mix(diffuseColor.rgb * (0.6 + 0.5 * detail), vec3(0.025, 0.03, 0.035), pane);
      diffuseColor.a = mix(1.0, 0.86, pane); // (the ball is empty inside: much more see-through and the sky shows through it)
    #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.04, pane);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.0, pane);`);
  };
  material.customProgramCacheKey = () => 'sperry-ball';
  return material;
}

// parts whose "glass" is painted solid in the source model: swapped for real glass
const GLASS_PARTS = new Set(['Nose']);
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x9fb4bf, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.14, clearcoat: 1, clearcoatRoughness: 0.05,
  envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide,
});
// the Plexiglas nose reads as glass from outside: the sky's reflection grows towards its curving edges
glass.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
    float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
    diffuseColor.a = clamp(diffuseColor.a + pow(1.0 - facing, 2.5) * 0.55, 0.0, 0.7);
    #include <opaque_fragment>`);
};
glass.customProgramCacheKey = () => 'nose-glass';
glass.userData.glass = true;

const loader = new GLTFLoader();
const cache = new Map();
const depthMats = new Map();

// the B-17G's chin turret: our B-17s have the F's nose (its guns are hand-held, out through the glass);
// and the spinner-like knob under the nose, which looked from the ball turret like a propeller hub
const REMOVED = ['FrontGunCapsule', 'LowerFrontGuns', 'NavigationKnob'];

function prepare(root) {
  for (const n of REMOVED) root.getObjectByName(n)?.removeFromParent();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const m = o.material;
    if (GLASS_PARTS.has(o.name)) {
      o.material = glass;
      o.castShadow = false;
    } else if (m.name === 'BallTurret_WSupport') {
      if (!m.userData.steel) { steelBall(m); m.userData.steel = true; }
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
// the wingmen close by keep their turrets apart from the rest (each merged on its own), so they can
// turn as their gunners aim (bomber.js)
const MID_TURRETS = { BallTurret: ['BallTurret', 'GunBarrel004', 'GunBarrel14'], BallStabilizer1: ['BallStabilizer1'], TopTurret: ['TopTurret', 'TopGuns'] };

/** One mesh per material from these meshes, in the root's frame (or `base`'s, its world matrix inverted). */
function mergeMeshes(meshes, base = null) {
  const byMat = new Map();
  for (const o of meshes) {
    const src = o.geometry, g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv']) {
      g.setAttribute(n, src.attributes[n] ?? new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * (n === 'uv' ? 2 : 3)), n === 'uv' ? 2 : 3));
    }
    g.setIndex(src.index ?? [...Array(src.attributes.position.count).keys()]);
    if (!src.attributes.normal) g.computeVertexNormals(); // zero normals would light as NaN
    g.applyMatrix4(base ? new THREE.Matrix4().multiplyMatrices(base, o.matrixWorld) : o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  }
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.customDepthMaterial = depthMats.get(mat);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

/**
 * Merge every mesh of a model into one mesh per material (a B-17 has ~90 parts = ~90 draw calls,
 * this makes it ~10). Nodes matching `keep` (e.g. propeller hubs that spin) stay separate; with
 * `turrets`, the turrets are merged on their own, as groups of those names.
 */
function mergeByMaterial(root, keep, turrets = null) {
  root.updateMatrixWorld(true);
  const kept = [], parts = {};
  root.traverse((o) => { if (o !== root && keep?.test(o.name) && !kept.some((k) => isUnder(o, k))) kept.push(o); });
  const turretOf = (o) => { for (const [k, names] of Object.entries(turrets ?? {})) for (let x = o; x; x = x.parent) if (names.includes(x.name)) return k; return null; };
  const rest = [];
  root.traverse((o) => {
    if (!o.isMesh || kept.some((k) => isUnder(o, k))) return;
    const t = turretOf(o);
    if (t) (parts[t] ??= []).push(o); else rest.push(o);
  });
  const out = mergeMeshes(rest);
  for (const [k, meshes] of Object.entries(parts)) {
    const grp = mergeMeshes(meshes);
    grp.name = k;
    const guns = new THREE.Box3(); // (which way its guns point at rest: from their middle)
    for (const o of meshes) if (/Gun/.test(o.name) || /Gun/.test(o.parent?.name)) guns.expandByObject(o);
    if (!guns.isEmpty()) grp.userData.guns = guns.getCenter(new THREE.Vector3()).toArray(); // (an array: userData is copied as JSON when the model is cloned)
    out.add(grp);
  }
  for (const k of kept) { // (placed where they were in the model, as the merged parts are; its own parts merged too: a propeller's blades and hub are one draw)
    const meshes = []; k.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const c = mergeMeshes(meshes, k.matrixWorld.clone().invert());
    c.name = k.name;
    k.matrixWorld.decompose(c.position, c.quaternion, c.scale);
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
  if (MODELS[name].build && !cache.has(key)) cache.set(key, Promise.resolve({ scene: MODELS[name].build({ lod }), ok: true }));
  const url = MODELS[name].url?.replace('.glb', `${suffix}.glb`);
  if (!cache.has(key)) {
    cache.set(
      key,
      loader
        .loadAsync(url)
        // lower-detail versions are only looked at, never taken apart: merge them for speed
        .then((gltf) => ({ scene: suffix ? mergeByMaterial(prepare(gltf.scene), /^Prop_\d$/, mid ? MID_TURRETS : null) : prepare(gltf.scene), ok: true }))
        .catch((err) => {
          console.warn(`Could not load ${url}, using a placeholder.`, err);
          return { scene: placeholder(name), ok: false };
        }),
    );
  }
  const { scene, ok } = await cache.get(key);
  const copy = scene.clone(true);
  // (clone() doesn't carry the shadow-pass material: without it the windows cast solid shadow and
  // no sun ever gets into the cabin)
  copy.traverse((o) => { if (o.isMesh && depthMats.has(o.material)) o.customDepthMaterial = depthMats.get(o.material); });
  return { scene: copy, ok };
}
