// The Focke-Wulf Fw 190 A-8, built in code (no model file): the BMW 801's big round cowling with its
// cooling fan, the spinner with its white spiral and a broad three-bladed VDM propeller, the low wing
// with its wide-track undercarriage doors, the bubble canopy, the two MG 131s over the engine and the
// four MG 151/20s in the wings. Painted in the 1944 day-fighter scheme by a shader: RLM 74/75 grey
// splinter on top, RLM 76 below with mottled sides, black-and-white Balkenkreuze, a yellow
// Reichsverteidigung band round the rear fuselage and the yellow under-cowl. Same frame as the
// other fighters: nose -Z, the prop's axis at y = 0, metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;

// the fuselage's sections: [z, half-width, half-height, centre height]
const BODY = [
  [-4.02, 0.5, 0.5, 0], [-3.96, 0.6, 0.6, 0], [-3.6, 0.645, 0.645, 0], [-3.0, 0.645, 0.65, 0.0], [-2.5, 0.6, 0.66, 0.02],
  [-1.8, 0.53, 0.67, 0.07], [-1.0, 0.48, 0.66, 0.1], [-0.2, 0.46, 0.63, 0.1], [0.7, 0.42, 0.58, 0.07], [1.6, 0.36, 0.52, 0.06],
  [2.5, 0.29, 0.45, 0.07], [3.3, 0.22, 0.37, 0.1], [4.0, 0.14, 0.27, 0.13], [4.4, 0.06, 0.15, 0.15], [4.55, 0.01, 0.03, 0.16],
];

/** A loft through elliptical sections (seg points round each). */
function loft(rings, seg) {
  const pos = [], idx = [];
  for (const [z, rx, ry, yc] of rings) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * rx, yc + Math.sin(a) * ry, z);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < seg; k++) {
    const a = r * (seg + 1) + k, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat outline (points in its own x/y) given thickness, then placed: for the wings and the tail. */
function slab(points, thick, bevel = 0.02) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  return g.translate(0, 0, -thick / 2);
}

/** The wing's planform (right side, x out, z aft) with a rounded tip: laid flat, a little dihedral. */
function wing(side, lod) {
  const pts = [[0.42, -1.78], [2.6, -1.42], [4.6, -1.08], [5.08, -0.96], [5.28, -0.78], [5.33, -0.5], [5.22, -0.26], [4.8, -0.18], [2.6, 0.12], [0.42, 0.46]];
  // (x, z) -> shape (x, -z) so the extrusion is along +y once turned
  const g = slab(pts.map(([x, z]) => [x, -z]), 0.15, lod ? 0 : 0.03).rotateX(-Math.PI / 2);
  // thinner towards the tip, and the dihedral
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), t = (x - 0.42) / 4.9;
    p.setY(i, p.getY(i) * (1 - 0.55 * t) + x * Math.tan(THREE.MathUtils.degToRad(5.5)));
  }
  g.computeVertexNormals();
  if (side < 0) { g.scale(-1, 1, 1); flip(g); }
  return g.translate(0, -0.47, 0);
}

/** Mirrored geometry turns inside out: put its faces back the right way round. */
function flip(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]]; g.index.needsUpdate = true; } else {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) for (const att of Object.values(g.attributes)) {
      const s = att.itemSize;
      for (let k = 0; k < s; k++) { const t = att.array[(i + 1) * s + k]; att.array[(i + 1) * s + k] = att.array[(i + 2) * s + k]; att.array[(i + 2) * s + k] = t; }
    }
  }
  g.computeVertexNormals();
}

/** The camouflage, the markings and the yellow, worked out per pixel from where it is on the plane. */
function paint(m, spinner = false) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; varying vec3 vObjN;
      // a Balkenkreuz: 0 nothing, 1 the white outline, 2 the black cross (p in the plane of the marking)
      float cross2(vec2 p, float s) {
        vec2 a = abs(p);
        float arm = max(a.x, a.y), w = min(a.x, a.y);
        if (arm < s && w < s * 0.2) return 2.0;
        if (arm < s * 1.05 && w < s * 0.33) return 1.0;
        return 0.0;
      }`).replace('#include <map_fragment>', spinner ? `#include <map_fragment>
      { float a = atan(vObj.y, vObj.x) / 6.2832 + vObj.z * 1.6; // the white spiral on the black-green spinner
        diffuseColor.rgb = fract(a) < 0.18 ? vec3(0.72) : vec3(0.012, 0.02, 0.012); }` : `#include <map_fragment>
      {
        vec3 p = vObj, n = normalize(vObjN);
        vec3 c74 = vec3(0.034, 0.041, 0.045), c75 = vec3(0.078, 0.074, 0.094), c76 = vec3(0.27, 0.33, 0.37), yel = vec3(0.8, 0.5, 0.02);
        // the splinter pattern: straight-edged patches, shuffled so they don't make a chequerboard
        vec2 cell = floor(vec2(p.x * 0.9 + p.z * 0.38, p.z * 0.82 - p.x * 0.52) + 0.3);
        float s = step(0.5, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
        vec3 top = mix(c75, c74, s);
        float mot = smoothstep(0.55, 0.8, 0.5 + 0.5 * sin(p.z * 6.5 + sin(p.y * 9.0) * 2.2) * sin(p.y * 7.5 + sin(p.z * 5.0) * 1.7)); // mottled sides
        vec3 side = mix(c76, mix(c75, c74, step(0.5, fract(p.z * 0.9))), mot * 0.85);
        float up = n.y;
        vec3 c = up > 0.45 ? top : up < -0.25 ? c76 : mix(side, top, smoothstep(0.1, 0.45, up));
        bool body = abs(p.x) < 0.7;
        if (body && p.z < -2.55 && p.y < -0.12) c = yel; // the yellow under-cowl
        if (body && p.z > 2.45 && p.z < 2.95) c = yel; // the Reichsverteidigung band
        float k = 0.0;
        if (body && abs(n.x) > 0.35) k = cross2(vec2(p.z - 1.45, p.y - 0.06), 0.4); // on the fuselage sides
        if (abs(p.x) > 2.6) k = max(k, cross2(vec2(abs(p.x) - 3.55, p.z + 0.72), 0.5)); // on the wings, top and bottom
        if (k > 1.5) c = vec3(0.012); else if (k > 0.5) c = vec3(0.75);
        diffuseColor.rgb = c;
      }`);
  };
  m.customProgramCacheKey = () => (spinner ? 'fw190-spinner' : 'fw190-paint');
  return m;
}

/** Glass for the canopy. */
const glass = () => new THREE.MeshPhysicalMaterial({ color: 0xc8d8e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });

/**
 * The whole aeroplane. lod: the low-detail copy for far away (fewer sections, no guns or fan).
 * Named parts: 'Fw190_Blades' (the propeller) and 'Fake_Blades' (its blur disc), as the game spins them.
 */
export function buildFw190({ lod = false } = {}) {
  const root = new THREE.Group();
  root.name = 'Fw190';
  const skin = paint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.15 }));
  const dark = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.55, metalness: 0.6 });
  const seg = lod ? 12 : 28;
  const body = [loft(BODY, seg)];
  // the wings, the tailplane and the fin (all in the same paint)
  body.push(wing(1, lod), wing(-1, lod));
  const tp = [[0.15, -0.45], [1.0, -0.33], [1.62, -0.18], [1.78, 0.02], [1.7, 0.22], [1.1, 0.35], [0.15, 0.42]];
  for (const s of [1, -1]) {
    const g = slab(tp.map(([x, z]) => [x, -z]), 0.07, lod ? 0 : 0.015).rotateX(-Math.PI / 2).translate(0, 0.2, 3.95);
    if (s < 0) { g.scale(-1, 1, 1); flip(g); }
    body.push(g);
  }
  const fin = [[-0.55, 0.15], [-0.25, 0.75], [0.0, 1.12], [0.25, 1.22], [0.45, 1.12], [0.62, 0.7], [0.68, 0.15]];
  body.push(slab(fin.map(([z, y]) => [-z, y]), 0.08, lod ? 0 : 0.015).rotateY(Math.PI / 2).translate(0, 0.08, 3.85));
  // the spine behind the canopy, rising to the headrest
  body.push(loft([[-0.2, 0.0, 0.0, 0.62], [0.05, 0.2, 0.14, 0.6], [0.8, 0.2, 0.12, 0.56], [1.8, 0.12, 0.06, 0.47], [2.4, 0.01, 0.01, 0.4]], lod ? 6 : 14));
  if (!lod) {
    // the bulges over the MG 131s, in front of the windscreen
    for (const s of [-1, 1]) body.push(loft([[-2.6, 0.01, 0.01, 0.6], [-2.35, 0.1, 0.08, 0.63], [-1.4, 0.1, 0.08, 0.68], [-1.15, 0.01, 0.01, 0.7]], 10).translate(s * 0.17, 0, 0));
    // the wheel doors on the wing's underside (the legs folded inwards), and the radio mast
    for (const s of [-1, 1]) body.push(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20).translate(s * 1.25, -0.6, -0.95));
  }
  const bodyMesh = new THREE.Mesh(mergeGeometries(body.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; })), skin);
  bodyMesh.name = 'Fw190_Body';
  root.add(bodyMesh);
  // the cowling's open front: the cooling fan behind the lip, dark, its blades just showing
  const front = [new THREE.CircleGeometry(0.5, seg).translate(0, 0, -3.98)];
  if (!lod) for (let k = 0; k < 12; k++) front.push(new THREE.BoxGeometry(0.05, 0.36, 0.02).translate(0, 0.27, -3.94).rotateZ((k / 12) * Math.PI * 2));
  root.add(new THREE.Mesh(mergeGeometries(front.map((g) => g.index ? g.toNonIndexed() : g).map((g) => { g.deleteAttribute('uv'); return g; })), dark));
  // the spinner, and the three broad VDM blades
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.34, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 1.35).translate(0, 0, -4.0),
    paint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }), true));
  root.add(spinner);
  const blades = new THREE.Group();
  blades.name = 'Fw190_Blades';
  blades.position.set(0, 0, -4.1);
  const blade = new THREE.Shape([[0.0, 0.25], [0.12, 0.3], [0.17, 0.9], [0.15, 1.5], [0.07, 1.7], [-0.05, 1.68], [-0.12, 1.3], [-0.12, 0.4], [-0.06, 0.25]].map(([x, y]) => new THREE.Vector2(x, y)));
  const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.03, bevelEnabled: false }).translate(0, 0, -0.015).rotateY(0.35);
  for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(bg, dark); b.rotation.z = (k / 3) * Math.PI * 2; blades.add(b); }
  root.add(blades);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  disc.name = 'Fake_Blades';
  disc.position.set(0, 0, -4.12);
  disc.visible = false;
  root.add(disc);
  // the bubble canopy and the armoured windscreen's frame, the exhausts down the sides
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, lod ? 10 : 24, lod ? 6 : 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.33, 0.36, 0.95).translate(0, 0.62, -0.18), glass());
  canopy.renderOrder = 2;
  root.add(canopy);
  if (!lod) {
    const frame = [new THREE.TorusGeometry(0.34, 0.018, 6, 24, Math.PI).translate(0, 0.62, -0.95).scale(1, 1.05, 1),
      new THREE.BoxGeometry(0.03, 0.34, 0.03).translate(0, 0.8, -1.02).rotateX(-0.6),
      new THREE.TorusGeometry(0.33, 0.016, 6, 24, Math.PI).translate(0, 0.62, 0.55)];
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) frame.push(new THREE.BoxGeometry(0.06, 0.04, 0.16).translate(s * 0.6, 0.12 - k * 0.07, -2.45 + k * 0.05));
    root.add(new THREE.Mesh(mergeGeometries(frame.map((g) => g.toNonIndexed ? (g.index ? g.toNonIndexed() : g) : g).map((g) => { g.deleteAttribute('uv'); return g; })), dark));
    // the guns: the MG 131s' muzzles in their troughs, the MG 151s out of the wing roots and further out
    const guns = [];
    for (const s of [-1, 1]) {
      guns.push(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8).rotateX(Math.PI / 2).translate(s * 0.17, 0.62, -2.75));
      guns.push(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8).rotateX(Math.PI / 2).translate(s * 0.95, -0.46, -2.0));
      guns.push(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8).rotateX(Math.PI / 2).translate(s * 2.05, -0.38, -1.62));
    }
    root.add(new THREE.Mesh(mergeGeometries(guns.map((g) => g.index ? g.toNonIndexed() : g).map((g) => { g.deleteAttribute('uv'); return g; })), dark));
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = !lod; });
  return root;
}
