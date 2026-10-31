// How the inside of the bomber is painted and lit: the hull lining in worn interior-green paint with
// its rivet rows, frame seams and skin-panel seams (raised and sunk in the shader, so they catch the
// light), the walkway's wooden planks, and the cabin kept dark: indirect light (sky, haze) cut right
// down inside, so it's the sun through the windows and gun ports that lights it, as in the photos.
// The textures are ambientCG's (CC0, see CREDITS.md), mapped by position (the model's own UVs are
// laid out for its outside paint), loaded in the background.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
function tex(name, srgb) {
  if (!cache.has(name)) {
    const t = loader.load(`textures/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache.set(name, t);
  }
  return cache.get(name);
}

/** The quality setting's switch for the extra surface detail (worn edges, grime, oil streaks). */
export const DETAIL = { value: 1 };

export const INSIDE_AMBIENT = 0.3; // how much of the sky's indirect light reaches inside
const insideKey = new WeakSet();
/** Darken a material's indirect light (it's inside the fuselage). Chains any shader hook it has. */
export function insideLight(m, amount = INSIDE_AMBIENT) {
  if (!m || insideKey.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return m;
  insideKey.add(m);
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= ${amount.toFixed(3)}; reflectedLight.indirectSpecular *= ${(amount * 1.3).toFixed(3)};`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|inside${amount}`;
  return m;
}

/** A bump (height) of rivet rows and seams on the hull at bomber-space position p, as GLSL. */
const HULL_RELIEF = `
  // the fuselage's middle line: in the cockpit it's higher (its roof is), so the rows run round that
  float hullMid(float z) { return mix(mix(-0.9, 0.25, smoothstep(-6.2, -6.6, z)), -0.1, smoothstep(-8.6, -8.9, z)); }
  float deckK(float z) { return smoothstep(-6.2, -6.6, z) * smoothstep(-8.9, -8.6, z); } // (the flight deck only)
  float hullRelief(vec3 p) {
    // around the fuselage: an angle from its middle line (so rows run round the roof too)
    float s = atan(p.x, p.y - hullMid(p.z));
    // the frames every 50 cm, two rivet rows either side of each
    float fz = abs(fract(p.z * 2.0 + 0.5) - 0.5) / 2.0;      // metres to the nearest frame
    float rows = smoothstep(0.012, 0.0, abs(fz - 0.028));
    vec2 rv = vec2(fract(s / 0.045) - 0.5, 0.0);
    float rivet = rows * smoothstep(0.32, 0.12, abs(rv.x));
    // the skin panels' seams, lengthwise every 0.3 rad and across every metre, riveted too
    float seamS = abs(fract(s / 0.3) - 0.5) * 0.3;
    float seamZ = abs(fract(p.z + 0.25) - 0.5);
    float seam = smoothstep(0.004, 0.0, seamS) + smoothstep(0.003, 0.0, seamZ);
    float rivet2 = smoothstep(0.012, 0.004, seamS) * smoothstep(0.32, 0.12, abs(fract(p.z / 0.04) - 0.5));
    return (rivet + rivet2) * 0.7 - seam * 0.5;
  }
  vec3 bumpFrom(vec3 surfPos, vec3 n, float h) {
    vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1);
    vec2 dh = vec2(dFdx(h), dFdy(h));
    return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
  }`;

/**
 * The hull lining's paint: ambientCG's worn green paint (colour, roughness, normal) projected along
 * the fuselage, tinted to the B-17's interior green, plus the rivet and seam relief. `posVar` is the
 * GLSL expression for the bomber-space position in the fragment shader.
 */
export function hullPaint(sh, posVar) {
  sh.uniforms.uPaint = { value: tex('paint_color', true) };
  sh.uniforms.uPaintN = { value: tex('paint_normal', false) };
  sh.uniforms.uPaintR = { value: tex('paint_rough', false) };
  sh.uniforms.uDetailOn = DETAIL;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    uniform sampler2D uPaint, uPaintN, uPaintR; uniform float uDetailOn;${HULL_RELIEF}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 hp = ${posVar};
      // the flight deck (forward of the top turret's bulkhead): kept smart, as in the photos of the
      // real one, in smooth bronze-green paint over riveted panels, hardly worn
      float deck = deckK(hp.z);
      vec2 puv = vec2(hp.z, atan(hp.x, hp.y - hullMid(hp.z)) * 1.1) * mix(0.55, 1.4, deck);
      vec3 paint = texture2D(uPaint, puv).rgb;
      float luma = dot(paint, vec3(0.3, 0.55, 0.15));
      // tinted to interior green; where it's worn through (light, unsaturated) bare aluminium shows
      vec3 green = vec3(0.30, 0.34, 0.23) * (0.74 + 0.5 * luma); // (gently: big blotches read as camouflage)
      vec3 bronze = vec3(0.075, 0.13, 0.095) * (0.9 + 0.2 * luma); // (Boeing's dark green lacquer, Bronze Green 234G9)
      float bare = smoothstep(0.62, 0.8, luma) * mix(0.35, 0.08, deck);
      diffuseColor.rgb = mix(mix(green, bronze, deck), vec3(0.55, 0.56, 0.54), bare);
      if (uDetailOn > 0.5) {
        // grime in the panel seams and along the rivet rows, so each skin panel reads as a panel
        float rel = hullRelief(hp);
        diffuseColor.rgb *= 1.0 - clamp(-rel, 0.0, 1.0) * mix(0.35, 0.5, deck);
        // oil and hydraulic fluid run down the lower walls in thin streaks, darkest near the floor
        float side = abs(hp.x) / max(length(hp.xy + vec2(0.0, 0.9)), 0.01);
        float streak = smoothstep(0.55, 0.95, texture2D(uPaint, vec2(hp.z * 3.1, 0.37)).g * 0.5 + fract(sin(floor(hp.z * 14.0) * 91.7) * 43758.5) * 0.6);
        float low = smoothstep(-0.4, -1.6, hp.y) * smoothstep(0.55, 0.9, side);
        diffuseColor.rgb *= 1.0 - streak * low * 0.45 * (1.0 - deck);
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(0.45 + 0.5 * texture2D(uPaintR, puv).g, 0.32 + 0.18 * texture2D(uPaintR, puv).g, deckK(hp.z));`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 pn = texture2D(uPaintN, puv).xyz * 2.0 - 1.0;
      float pk = mix(0.25, 0.08, deckK(hp.z)); // (the flight deck's paint is smooth: the rivets and seams show)
      normal = normalize(normal + (pn.x * pk) * normalize(dFdx(-vViewPosition)) + (pn.y * pk) * normalize(dFdy(-vViewPosition)));
      normal = bumpFrom(-vViewPosition, normal, hullRelief(hp) * mix(0.004, 0.006, deckK(hp.z)));`);
}

/** The walkway and floors: ambientCG's planks, laid along the fuselage. */
export function planks(material) {
  material.color.set(0xb8aa96);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uWood = { value: tex('planks_color', true) };
    sh.uniforms.uWoodN = { value: tex('planks_normal', false) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorP;\nuniform sampler2D uWood, uWoodN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 fuv = vec2(vFloorP.x * 0.9, vFloorP.z * 0.45);
        diffuseColor.rgb *= texture2D(uWood, fuv).rgb;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 wn = texture2D(uWoodN, fuv).xyz * 2.0 - 1.0;
        normal = normalize(normal + (wn.x * 0.4) * normalize(dFdx(-vViewPosition)) + (wn.y * 0.4) * normalize(dFdy(-vViewPosition)));`);
  };
  material.customProgramCacheKey = () => 'cabin-planks';
  return material;
}

/** Leather (seats, jackets, pads): ambientCG's leather grain as a normal map on the material's own UVs. */
export function leather(material, repeat = 3) {
  const n = tex('leather_normal', false).clone();
  n.repeat.set(repeat, repeat);
  n.needsUpdate = true;
  material.normalMap = n;
  material.normalScale = new THREE.Vector2(0.6, 0.6);
  return material;
}


const WEAR_NOISE = `
  float wh1(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float wn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wh1(i), wh1(i + vec3(1,0,0)), f.x), mix(wh1(i + vec3(0,1,0)), wh1(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(wh1(i + vec3(0,0,1)), wh1(i + vec3(1,0,1)), f.x), mix(wh1(i + vec3(0,1,1)), wh1(i + vec3(1,1,1)), f.x), f.y), f.z); }`;

/**
 * Wear on the cabin's fittings (merged geometry with an `aEdge` attribute, see Interior.add): the
 * paint chipped back to bare metal along the edges and corners of boxes and the rims of cans and
 * bottles, scuffs and handling grime over the faces, and a rougher, dirtier finish in the creases.
 * The edge distance comes from the UVs (which run 0-1 across each face) scaled to metres on screen.
 */
export function propWear(material) {
  if (material.userData.wear) return material;
  material.userData.wear = true;
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey?.bind(material);
  const metal = material.metalness > 0.5; // bare steel/aluminium already: only darker grime, no chips
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uWearOn = DETAIL;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aEdge; varying vec2 vEdge; varying vec2 vWuv; varying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge; vWuv = uv; vWp = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uWearOn; varying vec2 vEdge; varying vec2 vWuv; varying vec3 vWp;${WEAR_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float wearRough = 0.0;
      if (uWearOn > 0.5) {
        // metres per UV unit, each way, from the screen derivatives
        vec2 mpu = vec2(length(dFdx(vWp)) / max(length(dFdx(vWuv)), 1e-5), length(dFdy(vWp)) / max(length(dFdy(vWuv)), 1e-5));
        float m = min(mpu.x, mpu.y);
        vec2 e = min(vWuv, 1.0 - vWuv) * m; // metres to each edge
        float d = min(vEdge.x > 0.5 ? e.x : 1.0, vEdge.y > 0.5 ? e.y : 1.0);
        float n = wn3(vWp * 60.0), n2 = wn3(vWp * 9.0 + 4.0);
        float chip = (1.0 - smoothstep(0.0015, 0.007, d + (n - 0.5) * 0.006)) * smoothstep(0.35, 0.6, n2) * ${metal ? '0.0' : '0.6'};
        float grime = n2 * 0.6 + wn3(vWp * 31.0) * 0.4;
        diffuseColor.rgb *= 0.78 + 0.34 * grime;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.26, 0.245), chip); // dull bare metal at the chipped edges
        float scuff = smoothstep(0.72, 0.9, wn3(vec3(vWp.x * 40.0, vWp.y * 6.0, vWp.z * 40.0)));
        diffuseColor.rgb *= 1.0 - scuff * 0.18;
        wearRough = chip * -0.15 + (1.0 - grime) * 0.12;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + wearRough, 0.05, 1.0);`)
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|wear${metal ? 'm' : ''}`;
  return material;
}
