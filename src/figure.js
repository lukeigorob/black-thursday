// A B-17 crewman: a real rigged human (Quaternius' CC0 base character, see CREDITS.md: a face, eyes,
// hands with fingers) dressed in 1944 flight gear. The clothes are skinned to the same skeleton, made
// from the body itself: a sheepskin B-3 jacket with fleece at the collar, cuffs and hem (or the blue
// heated suit), flying trousers, fleece-lined boots, gloves thin enough to show the fingers, and the
// leather A-11 helmet, each pushed out from the skin by its own thickness. On the bones: the goggles
// pushed up on the helmet, the earphones, the green A-14 oxygen mask and its hose, the yellow Mae West
// (or a flak vest), and the parachute harness with its D-rings and leg straps.
//
// The figure is posed through a simple joint rig (userData.j: hips, torso, head, arms, legs, as before)
// that pose() and the crew code drive; syncFigures() copies it onto the skeleton each frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { insideLight } from './cabinlook.js';

const V = THREE.Vector3, Q = THREE.Quaternion;
let BASE = null; // the dressed model, built once: cloned for each man
const figures = new Set();

// ---- the clothes: regions of the body and what covers them
const REGION = { skin: 0, helmet: 1, jacket: 2, fleece: 3, trousers: 4, boot: 5, glove: 6, gauntlet: 7 };
const THICK = [0, 0.009, 0.034, 0.045, 0.018, 0.026, 0.006, 0.046]; // m out from the skin (a sheepskin jacket is thick; the glove's gauntlet goes over the sleeve)
const BLUE_SUIT = 2; // the heated suit's palette (below)
const SMOOTH = [false, false, true, true, true, true, false, true]; // garments that hide the body's contours under them
const PALETTES = [ // per region: helmet, jacket, fleece, trousers, boots, gloves
  { 1: 0x4a3322, 2: 0x553724, 3: 0xb5a584, 4: 0x5f5a3e, 5: 0x2e251d, 6: 0x6a4a2e, 7: 0x5f4229 }, // B-3 sheepskin, dark brown leather
  { 1: 0x42301f, 2: 0x6b4a2e, 3: 0xbcad8c, 4: 0x5a5a40, 5: 0x352b22, 6: 0x6a4a2e, 7: 0x5f4229 }, // a lighter, more worn jacket
  { 1: 0x4a3322, 2: 0x44506a, 3: 0x8a877e, 4: 0x44506a, 5: 0x2e251d, 6: 0x6a4a2e, 7: 0x5f4229 }, // the blue heated suit
  { 1: 0x3c2a1c, 2: 0x4a3020, 3: 0xad9e7e, 4: 0x625a40, 5: 0x2a221b, 6: 0x6a4a2e, 7: 0x5f4229 }, // almost black leather
];

function dominantBone(geo, skeleton, i) {
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  let best = 0, w = -1;
  for (let k = 0; k < 4; k++) { const x = sw.getComponent(i, k); if (x > w) { w = x; best = si.getComponent(i, k); } }
  return skeleton.bones[best].name;
}

/** Decide which garment covers each vertex of the body (rest pose, model facing +Z). */
function regions(geo, skeleton, world, M) {
  const n = geo.attributes.position.count, out = new Uint8Array(n), p = new V();
  const handL = M.bones.hand_l, handR = M.bones.hand_r;
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(geo.attributes.position, i).applyMatrix4(world);
    const b = dominantBone(geo, skeleton, i);
    let r;
    if (b === 'Head' || b === 'neck_01') {
      const face = p.z > M.faceZ - 0.06 && p.y > M.chinY && p.y < M.browY && Math.abs(p.x) < 0.07;
      r = face ? REGION.skin : p.y > M.chinY - 0.07 ? REGION.helmet : p.y > M.bones.neck_01.y - 0.06 ? REGION.fleece : REGION.jacket; // (the helmet's chin piece round the jaw; the collar comes up round the neck below it)
    } else if (/^(index|middle|ring|pinky|thumb)_|^hand_/.test(b)) r = REGION.glove;
    else if (/^lowerarm/.test(b)) r = p.distanceTo(b.endsWith('_l') ? handL : handR) < 0.12 ? REGION.gauntlet : REGION.jacket; // the flying glove's gauntlet, over the sleeve
    else if (/^(spine|clavicle|upperarm)/.test(b)) r = p.distanceTo(M.bones.neck_01) < 0.1 && p.y > M.bones.neck_01.y - 0.025 && p.z > M.bones.neck_01.z - 0.02 ? REGION.fleece : p.y < M.hemY + 0.04 ? REGION.fleece : REGION.jacket; // the collar round the neck, the hem
    else if (/^calf/.test(b)) r = p.y < M.bootY ? REGION.boot : p.y < M.bootY + 0.04 ? REGION.fleece : REGION.trousers;
    else if (/^(foot|ball)/.test(b)) r = REGION.boot;
    else r = p.y > M.hemY ? REGION.jacket : REGION.trousers; // pelvis, thighs
    out[i] = r;
  }
  return out;
}

/**
 * The clothes: the body's own mesh, smoothed where cloth hangs over it (so a jacket doesn't show the
 * muscles under it), then each vertex pushed out by its garment's thickness; the face left bare.
 * Vertices split at UV seams are welded first, so the cloth doesn't crack open along them.
 */
function gearGeometry(geo, region) {
  const g = geo.clone();
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
  // weld: one group per position
  const key = new Map(), group = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!key.has(k)) key.set(k, key.size);
    group[i] = key.get(k);
  }
  const G = key.size, gp = new Float32Array(G * 3), gn = new Float32Array(G * 3), greg = new Uint8Array(G), nb = Array.from({ length: G }, () => new Set());
  for (let i = 0; i < n; i++) {
    const k = group[i] * 3;
    gp[k] = pos.getX(i); gp[k + 1] = pos.getY(i); gp[k + 2] = pos.getZ(i);
    gn[k] += nor.getX(i); gn[k + 1] += nor.getY(i); gn[k + 2] += nor.getZ(i);
    greg[group[i]] = Math.max(greg[group[i]], region[i]);
  }
  const tri = geo.index.array;
  for (let t = 0; t < tri.length; t += 3) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) nb[group[tri[t + a]]].add(group[tri[t + b]]);
  const tmp = new Float32Array(G * 3);
  for (let it = 0; it < 14; it++) { // Laplacian smoothing of the cloth
    tmp.set(gp);
    for (let v = 0; v < G; v++) {
      if (!SMOOTH[greg[v]]) continue;
      let x = 0, y = 0, z = 0;
      for (const w of nb[v]) { x += gp[w * 3]; y += gp[w * 3 + 1]; z += gp[w * 3 + 2]; }
      const c = nb[v].size || 1;
      tmp[v * 3] += (x / c - gp[v * 3]) * 0.5; tmp[v * 3 + 1] += (y / c - gp[v * 3 + 1]) * 0.5; tmp[v * 3 + 2] += (z / c - gp[v * 3 + 2]) * 0.5;
    }
    gp.set(tmp);
  }
  // each garment's thickness, blended a little across the borders between them: a step from the
  // jacket's 3 cm to the fleece's 4.5 cm would stand the border's triangles up on end (spikes)
  let th = Float32Array.from(greg, (r) => THICK[r]);
  for (let it = 0; it < 4; it++) {
    const nt = th.slice();
    for (let v = 0; v < G; v++) {
      if (!greg[v]) continue; // (the bare face keeps its edge)
      let sum = th[v], c = 1;
      for (const w of nb[v]) if (greg[w]) { sum += th[w]; c++; }
      nt[v] = sum / c;
    }
    th = nt;
  }
  for (let i = 0; i < n; i++) {
    const k = group[i] * 3, l = Math.hypot(gn[k], gn[k + 1], gn[k + 2]) || 1, t = region[i] ? th[group[i]] : 0;
    pos.setXYZ(i, gp[k] + (gn[k] / l) * t, gp[k + 1] + (gn[k + 1] / l) * t, gp[k + 2] + (gn[k + 2] / l) * t);
  }
  g.computeVertexNormals();
  const idx = g.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) if (region[idx[t]] || region[idx[t + 1]] || region[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  g.setIndex(keep);
  g.setAttribute('region', new THREE.BufferAttribute(Float32Array.from(region), 1));
  return g;
}

/**
 * The oxygen mask, shaped on the face it sits on: the face's own triangles over the nose, mouth and
 * chin, raised off the skin most in the middle (the mask's cup) and least at its rubber edge.
 */
function faceMask(geo, world, H, fz) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index.array;
  const nm = new THREE.Matrix3().getNormalMatrix(world), p = new V(), n = new V();
  const cy = H.y + 0.002, ry = 0.045, rx = 0.042;
  const inside = (i) => { p.fromBufferAttribute(pos, i).applyMatrix4(world); n.fromBufferAttribute(nor, i).applyMatrix3(nm); const u = p.x / rx, v = (p.y - cy) / ry; return u * u + v * v < 1 && p.z > fz - 0.06 && n.z > 0.15; }; // (the face only, facing forward: not the back of the neck)
  const out = [], norms = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (!inside(idx[t]) || !inside(idx[t + 1]) || !inside(idx[t + 2])) continue;
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k];
      p.fromBufferAttribute(pos, i).applyMatrix4(world);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const u = p.x / rx, v = (p.y - cy) / ry, cup = Math.max(0, 1 - (u * u + v * v));
      p.addScaledVector(n, 0.004 + 0.016 * Math.sqrt(cup)).z += 0.004 * cup;
      out.push(p.x, p.y, p.z); norms.push(n.x, n.y, n.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.length / 3 * 2), 2));
  g.computeVertexNormals();
  return g;
}

function colourise(g, palette) {
  const reg = g.attributes.region, col = new Float32Array(reg.count * 3), c = new THREE.Color();
  // the fleece's edge is drawn per pixel (see the gear material), not by blending vertex colours
  // across the body's big triangles, which gave it a jagged saw-tooth edge: so each vertex carries
  // the colour of the garment under the fleece, the fleece's colour, and how much it is fleece
  const fl = new Float32Array(reg.count), flc = new Float32Array(reg.count * 3), f = new THREE.Color().setHex(palette[3]);
  for (let i = 0; i < reg.count; i++) {
    const r = reg.getX(i), fleece = r === 3;
    c.setHex(fleece ? palette[2] : palette[r] ?? palette[1]); // (setHex already gives linear colour; the bare face's edge takes the helmet's, not white)
    col.set([c.r, c.g, c.b], i * 3);
    fl[i] = fleece ? 1 : 0; flc.set([f.r, f.g, f.b], i * 3);
  }
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.setIndex(g.index);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aFleece', new THREE.BufferAttribute(fl, 1));
  out.setAttribute('aFleeceCol', new THREE.BufferAttribute(flc, 3));
  return out;
}

const std = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 0.2 });

/** Load the crewman and dress him (once, before any figure is made). */
export async function loadCrewModel() {
  if (BASE) return;
  const gltf = await new GLTFLoader().loadAsync('/models/crew/crewman.glb');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let body = null, extras = [];
  scene.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) { if (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count) { if (body) extras.push(body); body = o; } else extras.push(o); } });
  const skeleton = body.skeleton, bones = Object.fromEntries(skeleton.bones.map((b) => [b.name, b]));
  const wp = (b) => b.getWorldPosition(new V());
  // measurements, from the model itself
  const head = wp(bones.Head), world = body.matrixWorld, H0 = head, bindM = world.clone(); // (bindM: as it stands now, at load)
  const M = { bones: Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, wp(b)])), faceZ: -Infinity, chinY: head.y - 0.02, browY: head.y + 0.1, collarY: wp(bones.neck_01).y - 0.04, hemY: wp(bones.pelvis).y + 0.03, bootY: wp(bones.calf_l).y * 0.6, chestZ: -Infinity, headHalfW: 0, top: 0 };
  const p = new V(), pos = body.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(world);
    const b = dominantBone(body.geometry, skeleton, i);
    if ((b === 'Head') && Math.abs(p.x) < 0.02 && p.y > head.y && p.y < head.y + 0.08) M.faceZ = Math.max(M.faceZ, p.z);
    if (b === 'Head' && Math.abs(p.y - (head.y + 0.06)) < 0.015) M.headHalfW = Math.max(M.headHalfW, Math.abs(p.x));
    if (/^spine_0[23]/.test(b) && Math.abs(p.x) < 0.06 && Math.abs(p.y - (M.collarY - 0.15)) < 0.03) M.chestZ = Math.max(M.chestZ, p.z);
    M.top = Math.max(M.top, p.y);
  }
  const region = regions(body.geometry, skeleton, world, M);
  const gear = gearGeometry(body.geometry, region);
  // the body itself is only drawn where it isn't dressed (the face): elsewhere it would show through
  // the cloth wherever smoothing has pulled it in over a muscle
  { const tri = body.geometry.index.array, keep = [];
    for (let t = 0; t < tri.length; t += 3) if (!region[tri[t]] || !region[tri[t + 1]] || !region[tri[t + 2]]) keep.push(tri[t], tri[t + 1], tri[t + 2]);
    body.geometry = body.geometry.clone(); body.geometry.setIndex(keep); }
  // the cloth: the garment colours, with the leather's grain and its light-and-dark wear on top
  // (the leather texture's brightness only: its own colour is a tan)
  const tl = new THREE.TextureLoader(), leatherN = tl.load('/textures/leather_normal.jpg'), leatherC = tl.load('/textures/leather_color.jpg');
  for (const t of [leatherN, leatherC]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); }
  leatherC.colorSpace = THREE.SRGBColorSpace;
  const gearMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.18, map: leatherC, normalMap: leatherN, normalScale: new THREE.Vector2(0.9, 0.9) });
  const f = (x) => x.toFixed(3), chestY0 = M.collarY - 0.15;
  gearMat.onBeforeCompile = (sh) => {
    // the pattern (zip, pockets, stitching, fur) is laid out on the body as it stands in its rest
    // pose, so it moves with him
    sh.uniforms.uBindM = { value: bindM };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region; attribute float aFleece; attribute vec3 aFleeceCol; uniform mat4 uBindM; varying float vReg; varying float vFl; varying vec3 vFlC; varying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = region; vFl = aFleece; vFlC = aFleeceCol; vBind = (uBindM * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vReg; varying float vFl; varying vec3 vFlC; varying vec3 vBind;
      float gh(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float gn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(gh(i), gh(i + vec3(1,0,0)), f.x), mix(gh(i + vec3(0,1,0)), gh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(gh(i + vec3(0,0,1)), gh(i + vec3(1,0,1)), f.x), mix(gh(i + vec3(0,1,1)), gh(i + vec3(1,1,1)), f.x), f.y), f.z); }
      // a dashed line of stitches at distance d (m) from a seam, running along coordinate t
      float stitch(float d, float t) { return (1.0 - smoothstep(0.0006, 0.0014, abs(d))) * step(0.45, fract(t * 140.0)); }`)
      .replace('#include <color_fragment>', `
      diffuseColor.rgb *= mix(vec3(vColor.rgb), vFlC, fleeceW);`)
      .replace('#include <map_fragment>', `
      // the fleece where it is (a frayed, woolly edge, not the triangles' saw-tooth)
      float fleeceW = smoothstep(0.4, 0.6, vFl + (gn3(vBind * 160.0) - 0.5) * 0.25);
      #ifdef USE_MAP
      vec4 lt = texture2D(map, vMapUv);
      float reg = fleeceW > 0.5 ? 3.0 : floor(vReg + 0.5) == 3.0 ? 2.0 : floor(vReg + 0.5);
      vec3 b = vBind;
      if (reg == 3.0) {
        // sheepskin fleece: soft, dense curls, no grain of leather
        float curl = gn3(b * 260.0) * 0.55 + gn3(b * 90.0) * 0.45;
        diffuseColor.rgb *= 0.72 + 0.42 * curl;
      } else {
        diffuseColor.rgb *= 0.45 + 1.2 * dot(lt.rgb, vec3(0.3, 0.55, 0.15));
      }
      if (reg == 2.0 && b.z > ${f(M.bones.spine_03.z + 0.03)}) { // (the front: forward of his spine)
        // the jacket's front: the zip up the middle, stitched down both sides
        float onFront = step(${f(M.hemY + 0.02)}, b.y) * step(b.y, ${f(M.collarY - 0.02)});
        float zip = (1.0 - smoothstep(0.004, 0.0055, abs(b.x))) * onFront;
        float teeth = step(0.5, fract(b.y * 260.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.05), vec3(0.32, 0.3, 0.26), teeth * step(abs(b.x), 0.0028)), zip);
        float st = stitch(abs(b.x) - 0.011, b.y) * onFront;
        // two chest pockets with buttoned flaps, stitched round
        vec2 q = vec2(abs(b.x) - 0.095, b.y - ${f(chestY0 - 0.06)});
        vec2 e = abs(q) - vec2(0.048, 0.055);
        float box = max(e.x, e.y);
        st += stitch(box + 0.004, q.x + q.y);
        float flap = (1.0 - smoothstep(0.0, 0.002, abs(q.y - 0.03))) * step(box, 0.0);
        diffuseColor.rgb *= 1.0 - flap * 0.45 - (1.0 - smoothstep(-0.002, 0.0, box)) * 0.07;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.42), st * 0.8);
      }
      if (reg == 1.0) { // the leather helmet: stitched panels over the crown and round the ear cups
        float crown = stitch(abs(b.x) - 0.004, b.z) * step(${f(H0.y + 0.07)}, b.y);
        float band = stitch(b.y - ${f(H0.y + 0.075)}, b.x + b.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.42, 0.3), (crown + band) * 0.7);
        diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.003, abs(abs(b.x) - 0.004))) * step(${f(H0.y + 0.07)}, b.y) * 0.3; // the seam's groove
      }
    #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (fleeceW > 0.5) roughnessFactor = 1.0;`);
  };
  gearMat.customProgramCacheKey = () => 'crew-gear';
  insideLight(gearMat);
  const variants = PALETTES.map((pal) => colourise(gear, pal));
  // the skin: the model's own, and its lighter version for some of the crew
  const skinDark = body.material;
  skinDark.envMapIntensity = 0.25;
  const lightTex = gltf.parser.json.extras?.lightSkinTexture != null ? await gltf.parser.getDependency('texture', gltf.parser.json.extras.lightSkinTexture) : null;
  const skinLight = skinDark.clone();
  if (lightTex) { lightTex.colorSpace = THREE.SRGBColorSpace; lightTex.flipY = false; skinLight.map = lightTex; }
  for (const m of [skinDark, skinLight, ...extras.map((e) => e.material)]) insideLight(m);
  // the rigid gear, built in the rest pose's world space then hung on its bone
  const kit = {
    steel: std(0x8c8c84, 0.4, 0.8), lens: std(0x1c2428, 0.12, 0.3), leather: std(0x3b2a1c, 0.55), mask: std(0x3f4636, 0.5), mae: std(0xc29a2a, 0.75),
    web: std(0x857a55, 0.9), flak: std(0x4b4f37, 0.8, 0.1), hose: std(0x1a1a1a, 0.85), fleece: std(0xb3a382, 1),
  };
  for (const m of Object.values(kit)) insideLight(m);
  // one mesh per bone for all its rigid gear (each piece coloured by its vertices): one draw call
  const kitMat = insideLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.25 }));
  const hang = (boneName, geos) => { // merged, attached to the bone keeping its world placement
    const bone = bones[boneName], parts = [], c = new THREE.Color();
    for (const [mat, list] of geos) for (const g0 of list) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      c.copy(mat.color);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
      parts.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), kitMat);
    mesh.receiveShadow = true;
    mesh.userData.gear = boneName;
    scene.add(mesh); mesh.updateMatrixWorld(); bone.attach(mesh);
  };
  const H = head, hw = Math.max(0.075, M.headHalfW), fz = M.faceZ, cz = M.chestZ + 0.02;
  // head: goggles up on the forehead, their strap, the earphones, the mask and its valve
  const headKit = new Map([[kit.steel, []], [kit.lens, []], [kit.leather, []], [kit.mask, []]]);
  for (const s of [-1, 1]) {
    headKit.get(kit.steel).push(new THREE.TorusGeometry(0.024, 0.006, 5, 14).translate(s * 0.036, H.y + 0.105, fz - 0.005));
    headKit.get(kit.lens).push(new THREE.CircleGeometry(0.022, 14).translate(s * 0.036, H.y + 0.105, fz - 0.002));
    headKit.get(kit.leather).push(new THREE.CylinderGeometry(0.036, 0.036, 0.026, 14).rotateZ(Math.PI / 2).translate(s * (hw + 0.012), H.y + 0.04, H.z + 0.005)); // earphones
    headKit.get(kit.leather).push(new THREE.BoxGeometry(0.012, 0.08, 0.018).translate(s * (hw - 0.01), H.y - 0.02, fz - 0.05)); // chin straps
  }
  headKit.get(kit.leather).push(new THREE.TorusGeometry(hw + 0.012, 0.006, 4, 24).rotateX(Math.PI / 2 - 0.2).translate(0, H.y + 0.1, H.z)); // goggle strap
  headKit.get(kit.mask).push(faceMask(body.geometry, world, H, fz)); // the A-14 mask, moulded over nose and mouth
  headKit.get(kit.mask).push(new THREE.CylinderGeometry(0.014, 0.018, 0.028, 10).rotateX(Math.PI / 2).translate(0, H.y - 0.008, fz + 0.03)); // its valve
  hang('Head', headKit);
  // chest: the fleece collar, the Mae West or a flak vest, the harness, the oxygen hose down to its clip
  const neck = M.bones.neck_01, chestY = M.collarY - 0.15;
  const makeChest = (flak) => {
    const m = new Map([[kit.web, []], [kit.steel, []], [kit.hose, []], [flak ? kit.flak : kit.mae, []]]);
    // (no separate fleece ring: the jacket's own collar is the fleece, and a ring poked out through his back as he leaned)
    if (flak) {
      m.get(kit.flak).push(new THREE.BoxGeometry(0.4, 0.44, 0.035).translate(0, chestY - 0.08, cz + 0.02), new THREE.BoxGeometry(0.4, 0.44, 0.035).translate(0, chestY - 0.08, M.bones.spine_03.z - 0.15));
    } else {
      for (const s of [-1, 1]) m.get(kit.mae).push(new THREE.CapsuleGeometry(0.055, 0.17, 4, 10).scale(1.1, 1, 0.75).translate(s * 0.08, chestY - 0.02, cz + 0.028));
    }
    const front = cz + (flak ? 0.04 : 0.065);
    for (const s of [-1, 1]) {
      m.get(kit.web).push(new THREE.BoxGeometry(0.035, 0.42, 0.01).translate(s * 0.1, chestY - 0.12, front));
      m.get(kit.steel).push(new THREE.TorusGeometry(0.02, 0.005, 4, 10).translate(s * 0.1, chestY - 0.16, front + 0.006));
    }
    m.get(kit.web).push(new THREE.BoxGeometry(0.3, 0.035, 0.01).translate(0, chestY - 0.01, front + 0.003));
    const hose = new THREE.CatmullRomCurve3([[0.01, H.y - 0.03, fz + 0.04], [0.06, chestY + 0.12, cz + 0.09], [0.12, chestY - 0.02, cz + 0.08], [0.13, chestY - 0.12, front]].map((q) => new V(...q)));
    m.get(kit.hose).push(new THREE.TubeGeometry(hose, 12, 0.012, 6));
    return m;
  };
  // two versions of the chest kit: each man wears one (the other is hidden)
  hang('spine_03', makeChest(false));
  for (const c of bones.spine_03.children.filter((c) => c.userData.gear)) c.userData.kit = 'maewest';
  hang('spine_03', makeChest(true));
  for (const c of bones.spine_03.children.filter((c) => c.userData.gear && !c.userData.kit)) c.userData.kit = 'flak';
  // the leg straps of the harness, round each thigh
  for (const s of ['l', 'r']) {
    const t = M.bones[`thigh_${s}`], c = M.bones[`calf_${s}`];
    const at = t.clone().lerp(c, 0.2);
    hang(`thigh_${s}`, new Map([[kit.web, [new THREE.TorusGeometry(0.095, 0.012, 4, 16).rotateX(Math.PI / 2).translate(at.x, at.y, at.z)]]]));
  }
  // the dressed body: the clothes skinned to the same skeleton
  const gearMesh = new THREE.SkinnedMesh(variants[0], gearMat);
  gearMesh.name = 'gear';
  body.parent.add(gearMesh);
  gearMesh.bind(skeleton, body.bindMatrix);
  gearMesh.receiveShadow = body.receiveShadow = true;
  scene.traverse((o) => { o.frustumCulled = false; if (o.isMesh) o.castShadow = false; });
  BASE = { scene, variants, skin: [skinDark, skinLight], M, info: { height: M.top, faceZ: M.faceZ, chestZ: M.chestZ, headHalfW: M.headHalfW, bootY: M.bootY, collarY: M.collarY, hemY: M.hemY } };
}

export const crewInfo = () => BASE?.info;

// ---- the pose rig: the same joints the crew code has always driven
function makeRig(root) {
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.22).translate(0, 0.13, 0)); // (head size, for fitting him under the roof)
  marker.visible = false; head.add(marker);
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 0.53, 0); torso.add(sh);
    const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
    return { sh, el };
  };
  const leg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0, 0); hips.add(hip);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    return { hip, knee };
  };
  return { hips, torso, head, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1) };
}

const _q = new Q(), _q2 = new Q(), _v = new V(), _m = new THREE.Matrix4();
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

/**
 * opts.self: your own body (no head: it would sit round your eyes). opts.flak: a flak vest instead of
 * the Mae West. opts.seed picks the gear colours and skin. Feet at the origin, facing -Z.
 */
export function makeFigure(opts = {}) {
  if (!BASE) throw new Error('loadCrewModel() first');
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const root = new THREE.Group();
  const j = makeRig(root);
  const model = cloneSkinned(BASE.scene);
  model.rotation.y = Math.PI; // the model faces +Z; the crew face -Z
  root.add(model);
  let body = null, gear = null;
  model.traverse((o) => {
    if (o.name === 'gear') gear = o;
    else if (o.isSkinnedMesh && (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = o;
  });
  let variant = seed % BASE.variants.length;
  if (opts.noBlue && variant === BLUE_SUIT) variant = 0; // (the sheepskin instead)
  gear.geometry = BASE.variants[variant];
  body.material = BASE.skin[(seed >> 3) % 2];
  const flak = opts.flak ?? ((seed >> 5) % 3 === 0);
  const bones = Object.fromEntries(body.skeleton.bones.map((b) => [b.name, b]));
  for (const c of bones.spine_03.children) if (c.userData.kit) c.visible = c.userData.on = c.userData.kit === (flak ? 'flak' : 'maewest');
  if (opts.self) { // (and the helmet, goggles and mask with it; and the collar and Mae West, which sat round your eyes as a pale blob when you looked down)
    bones.Head.scale.setScalar(0.001);
    root.userData.self = true;
    for (const c of bones.spine_03.children) if (c.userData.kit) c.userData.on = false;
  }

  // bind the rig to the skeleton: put the rig in the model's rest pose (its limbs pointing the way the
  // bones do), and remember, for each bone, its rotation relative to its rig joint
  root.updateMatrixWorld(true);
  const dirOf = (a, b) => bones[b].getWorldPosition(new V()).sub(bones[a].getWorldPosition(new V())).normalize();
  const aim = (joint, dir) => { // turn a joint so its -Y (down the limb) points along dir (world)
    joint.parent.getWorldQuaternion(_q).invert();
    joint.quaternion.setFromUnitVectors(new V(0, -1, 0), dir.clone().applyQuaternion(_q));
    joint.updateMatrixWorld(true);
  };
  aim(j.armL.sh, dirOf('upperarm_l', 'lowerarm_l')); aim(j.armL.el, dirOf('lowerarm_l', 'hand_l'));
  aim(j.armR.sh, dirOf('upperarm_r', 'lowerarm_r')); aim(j.armR.el, dirOf('lowerarm_r', 'hand_r'));
  aim(j.legL.hip, dirOf('thigh_l', 'calf_l')); aim(j.legL.knee, dirOf('calf_l', 'foot_l'));
  aim(j.legR.hip, dirOf('thigh_r', 'calf_r')); aim(j.legR.knee, dirOf('calf_r', 'foot_r'));
  const map = [ // [bone, rig joint], parents before children
    ['pelvis', j.hips], ['spine_01', j.torso], ['spine_02', j.torso], ['spine_03', j.torso], ['neck_01', j.head], ['Head', j.head],
    ['clavicle_l', j.torso], ['upperarm_l', j.armL.sh], ['lowerarm_l', j.armL.el], ['hand_l', j.armL.el],
    ['clavicle_r', j.torso], ['upperarm_r', j.armR.sh], ['lowerarm_r', j.armR.el], ['hand_r', j.armR.el],
    ['thigh_l', j.legL.hip], ['calf_l', j.legL.knee], ['foot_l', j.legL.knee], ['thigh_r', j.legR.hip], ['calf_r', j.legR.knee], ['foot_r', j.legR.knee],
  ].map(([name, joint]) => {
    const bone = bones[name];
    const off = joint.getWorldQuaternion(new Q()).invert().multiply(bone.getWorldQuaternion(new Q()));
    return { bone, joint, off };
  });
  const pelvisAt = j.hips.worldToLocal(bones.pelvis.getWorldPosition(new V())); // the pelvis in the hips joint's frame
  // each finger joint's own bend axis, from the skeleton in its rest pose: it curls the finger towards
  // the palm (whose normal comes from the hand's forward and across directions); the thumb across it
  const fingers = [], W = (n) => bones[n].getWorldPosition(new V());
  for (const s of ['l', 'r']) {
    const hand = W(`hand_${s}`), across = W(`index_01_${s}`).sub(W(`pinky_01_${s}`)).normalize();
    const along = W(`middle_01_${s}`).sub(hand).normalize();
    const palm = new V().crossVectors(along, across).normalize();
    if (palm.y > 0) palm.negate(); // (the rest pose holds the arms out, palms down)
    for (const f of [...FINGERS, 'thumb']) for (let k = 1; k <= 3; k++) {
      const b = bones[`${f}_0${k}_${s}`], c = bones[`${f}_0${k + 1}_${s}`] ?? bones[`${f}_04_leaf_${s}`];
      if (!b || !c) continue;
      const dir = W(c.name).sub(W(b.name)).normalize();
      const toward = f === 'thumb' ? palm.clone().multiplyScalar(0.7).addScaledVector(across, -0.7).normalize() : palm; // the thumb closes across the palm
      const axis = new V().crossVectors(dir, toward).normalize().applyQuaternion(b.getWorldQuaternion(new Q()).invert());
      fingers.push({ b, rest: b.quaternion.clone(), axis, thumb: f === 'thumb', k });
    }
  }
  // the arms' bone lengths, for reaching the grips (two-bone IK)
  const arm = (s) => ({ upper: bones[`upperarm_${s}`], lower: bones[`lowerarm_${s}`], hand: bones[`hand_${s}`], a: W(`upperarm_${s}`).distanceTo(W(`lowerarm_${s}`)), b: W(`lowerarm_${s}`).distanceTo(W(`hand_${s}`)) });
  const arms = { l: arm('l'), r: arm('r') };
  // the rig back to its neutral pose (pose() sets it from here)
  for (const g of [j.armL.sh, j.armL.el, j.armR.sh, j.armR.el, j.legL.hip, j.legL.knee, j.legR.hip, j.legR.knee]) g.quaternion.identity();
  root.userData.j = j;
  root.userData.model = model;
  root.userData.rig = { map, bones, pelvisAt, fingers, arms, grip: 0.35, root, reach: null };
  figures.add(root);
  return root;
}

/**
 * Put his hands on the grips: [left, right] world positions (or null to let the pose's arms be). The
 * arms reach with two-bone IK each frame, the elbows down and out, and the fingers close round them.
 */
export function reachFor(fig, grips) {
  const rig = fig.userData.rig;
  if (!rig) return;
  if (!grips) { rig.reach = null; return; }
  rig.reach ??= [new V(), new V()];
  rig.reach[0].copy(grips[0]); rig.reach[1].copy(grips[1]);
  rig.grip = 1;
}

/** Curl the fingers: 0 open, 1 a fist round a grip. */
export function grip(fig, amount) { if (fig.userData.rig) fig.userData.rig.grip = amount; }

/** Copy each figure's rig pose onto its skeleton (call once a frame, before drawing). */
export function syncFigures() {
  for (const fig of figures) {
    if (!fig.visible || !fig.parent) continue;
    let o = fig.parent, shown = true;
    while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
    if (shown) sync(fig);
  }
}

function sync(fig) {
  const { map, bones, pelvisAt, fingers, grip: g } = fig.userData.rig;
  fig.updateMatrixWorld(true);
  // the pelvis follows the hips joint
  const pelvis = bones.pelvis;
  pelvis.position.copy(pelvis.parent.worldToLocal(fig.userData.j.hips.localToWorld(_v.copy(pelvisAt))));
  for (const { bone, joint, off } of map) {
    joint.getWorldQuaternion(_q).multiply(off); // where the bone should point, in the world
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(_q2).invert();
    bone.quaternion.copy(_q2.multiply(_q));
    bone.updateMatrixWorld(true);
  }
  if (fig.userData.self) bones.Head.scale.setScalar(0.001); // (your own: never drawn round your eyes)
  else bones.Head.scale.setScalar(fig.userData.noHead ? 0.01 : 1);
  for (const c of bones.spine_03.children) if (c.userData.kit) c.visible = c.userData.on && !fig.userData.noHead; // (and the Mae West under your chin)
  if (fig.userData.rig.reach) reach(fig.userData.rig, fig);
  for (const f of fingers) { // curl about each joint's own bend axis: more at the knuckle, a fist at 1
    f.b.quaternion.copy(f.rest).multiply(_q.setFromAxisAngle(f.axis, g * (f.thumb ? 0.45 : [0, 1.15, 1.3, 0.9][f.k])));
  }
}

const _S = new V(), _T = new V(), _E = new V(), _u = new V(), _p = new V(), _cur = new V(), _want = new V(), _qa = new Q(), _qf = new Q();
/** Two-bone IK: turn upper and lower arm so the hand lands on its grip, the elbow bending down and out. */
function reach(rig, fig) {
  const { arms, reach: targets } = rig;
  [['l', 0, -1], ['r', 1, 1]].forEach(([s, i, side]) => {
    fig.getWorldQuaternion(_qf);
    const A = arms[s];
    A.upper.getWorldPosition(_S);
    _T.copy(targets[i]);
    // the wrist goes a hand's length short of the grip, so it's the palm that closes round it
    _u.subVectors(_T, _S).normalize();
    _T.addScaledVector(_u, -0.075);
    const d = Math.min(_S.distanceTo(_T), (A.a + A.b) * 0.999), a = A.a, b = A.b;
    // the elbow: down, out to his side and a little back (in the world, from his body's frame)
    _p.set(side * 0.6, -1, 0.35).applyQuaternion(_qf);
    _p.addScaledVector(_u, -_p.dot(_u)).normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_p, a * Math.sqrt(1 - cosA * cosA));
    aimBone(A.upper, A.lower, _E);
    aimBone(A.lower, A.hand, _T.copy(_S).addScaledVector(_u, d));
  });
}

/** Turn `bone` (in the world) so its child `tip` lands at world point `to`. */
function aimBone(bone, tip, to) {
  bone.getWorldPosition(_v);
  tip.getWorldPosition(_cur);
  _cur.sub(_v).normalize();
  _want.subVectors(to, _v).normalize();
  const world = bone.getWorldQuaternion(_q2).premultiply(_q.setFromUnitVectors(_cur, _want));
  bone.parent.getWorldQuaternion(_qa).invert();
  bone.quaternion.copy(_qa.multiply(world));
  bone.updateMatrixWorld(true);
}

export { figures };
