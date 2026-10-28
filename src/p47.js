// The Republic P-47D Thunderbolt of 1943, the "razorback", built in code (no model file): the big round
// cowling of the R-2800 Double Wasp with the oval chin intake under the engine, the four broad paddle
// blades of the Curtiss Electric propeller on its plain hub, the deep fuselage (the turbocharger's ducts
// run under the cockpit), the framed canopy with its sliding hood and the high spine behind it that gave
// the razorback its name, the semi-elliptical wing with four .50s in each side, staggered, and the
// rounded tail. Painted by a shader: olive drab on top, neutral grey below, the white star and bars of
// 1943 in their red surround, and the 8th Air Force's white identification bands of that year round the
// front of the cowling and across the fin, the rudder and the tailplanes. Same frame as the other
// fighters: nose -Z, the prop's axis at y = 0, metres; 11.0 m long, 12.4 m across the wings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;

// the fuselage's sections: [z, half-width, half-height, centre height]. Deep all the way, and fullest
// under the cockpit, where the ducts from the turbocharger in the rear fuselage run forward to the engine
const BODY = [
  [-4.32, 0.64, 0.72, -0.07], [-4.22, 0.7, 0.79, -0.07], [-3.8, 0.73, 0.83, -0.06], [-3.0, 0.72, 0.86, -0.04], [-2.2, 0.69, 0.89, -0.02],
  [-1.4, 0.65, 0.92, 0.0], [-0.6, 0.6, 0.92, 0.0], [0.2, 0.55, 0.9, 0.02], [1.0, 0.5, 0.84, 0.05], [2.0, 0.42, 0.74, 0.1],
  [3.0, 0.34, 0.62, 0.16], [4.0, 0.26, 0.5, 0.24], [5.0, 0.17, 0.37, 0.33], [5.7, 0.09, 0.25, 0.4], [6.05, 0.03, 0.1, 0.45], [6.12, 0.005, 0.02, 0.46],
];
// the razorback: the narrow, high spine from the back of the hood to the fin, over the round fuselage
const SPINE = [[0.3, 0.37, 0.46, 0.82], [0.8, 0.33, 0.44, 0.8], [1.8, 0.25, 0.38, 0.76], [3.0, 0.17, 0.32, 0.7], [4.2, 0.1, 0.22, 0.66], [5.0, 0.04, 0.08, 0.66]];
// the canopy: the windscreen's foot and top, the hood from there back to the spine; the hood's sill, its top
const WS_Z = -0.85, WS_TOP_Z = -0.56, HOOD_Z = 0.37, SILL = 0.78, HOOD_TOP = 1.32;
// the wing's centre height at the root, its dihedral
const WING_Y = -0.62, DIHEDRAL = Math.tan(THREE.MathUtils.degToRad(4.5));
// the leading edge of the wing's planform (right side, x out, z aft), from the root out round the tip, then the trailing edge back in
const WING = [[0.45, -1.96], [2.0, -1.84], [3.5, -1.68], [4.6, -1.52], [5.3, -1.38], [5.8, -1.2], [6.07, -0.95], [6.17, -0.7], [6.1, -0.46], [5.9, -0.28], [5.5, -0.16],
  [4.5, 0.05], [3.0, 0.38], [1.5, 0.68], [0.45, 0.88]];
// the guns' spanwise stations, inboard to outboard (outboard of the main wheels, as in the real wing)
export const P47_GUN_X = [2.55, 2.8, 3.05, 3.3];

/**
 * A loft through superelliptic sections (seg points round each): n = 2 is an ellipse, more is squarer
 * (the fuselage's flat, deep sides).
 */
function loft(rings, seg, n = 2) {
  const pos = [], idx = [], e = 2 / n, pe = (v) => Math.sign(v) * Math.abs(v) ** e;
  for (const [z, rx, ry, yc] of rings) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(pe(Math.cos(a)) * rx, yc + pe(Math.sin(a)) * ry, z);
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
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  return g.translate(0, 0, -thick / 2);
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

/** The wing's leading edge at x (the guns come out of it). */
function leadingEdge(x) {
  for (let i = 1; i < 8; i++) if (x <= WING[i][0]) { const [x0, z0] = WING[i - 1], [x1, z1] = WING[i]; return z0 + (z1 - z0) * (x - x0) / (x1 - x0); }
  return WING[7][1];
}

/** The wing's centre height at x (the dihedral). */
const wingY = (x) => WING_Y + x * DIHEDRAL;

/** Where each gun's muzzle is, [x, y, z], left wing's four then the right's, inboard to outboard. */
export function p47Muzzles() {
  const out = [];
  // staggered: each gun a little further back than the one inboard of it, so the belts could feed side by side
  for (const s of [-1, 1]) P47_GUN_X.forEach((x, k) => out.push([s * x, wingY(x) - 0.03, leadingEdge(x) - 0.42 + k * 0.08]));
  return out;
}

/** The wing (right side): thick at the root (the gear and the guns live in it), thinner out to the tip, the dihedral. */
function wing(side, lod) {
  // (x, z) -> shape (x, -z) so the extrusion is along +y once turned
  const g = slab(WING.map(([x, z]) => [x, -z]), 0.24, lod ? 0 : 0.03).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), t = (x - 0.45) / 5.75;
    p.setY(i, p.getY(i) * (1 - 0.6 * t) + x * DIHEDRAL);
  }
  g.computeVertexNormals();
  if (side < 0) { g.scale(-1, 1, 1); flip(g); }
  return g.translate(0, WING_Y, 0);
}

/** A rod from a to b (radius r): the canopy's frames, the aerial mast. */
function rod(a, b, r, seg = 6) {
  const d = new V().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** The hood's section at z: from the sill on one side over the top to the other (k from 0 to M). */
function hoodPoint(z, k, M) {
  const a = -Math.PI / 2 + (k / M) * Math.PI, w = 0.37 + 0.01 * (z - WS_TOP_Z) / (HOOD_Z - WS_TOP_Z);
  // (the top: up from the windscreen's quickly, then level back to the spine)
  const kz = Math.min(1, ((z - WS_TOP_Z) / (HOOD_Z - WS_TOP_Z)) * 3), top = 1.22 + (HOOD_TOP - 1.22) * Math.sin(kz * Math.PI / 2);
  return new V(w * Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.8, SILL + (top - SILL) * Math.cos(a) ** 0.7, z);
}

/** The sliding hood's glass, from the windscreen back to the spine. */
function hoodGeo(M, K) {
  const pos = [], idx = [];
  for (let j = 0; j <= K; j++) {
    const z = WS_TOP_Z + (j / K) * (HOOD_Z - WS_TOP_Z);
    for (let k = 0; k <= M; k++) pos.push(...hoodPoint(z, k, M).toArray());
    if (j) for (let k = 0; k < M; k++) { const a = (j - 1) * (M + 1) + k, b = a + M + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The windscreen's corners: the flat armoured front panel and the curved side panels down to the sills. */
function windscreen() {
  const fbl = new V(-0.17, 0.9, WS_Z), fbr = new V(0.17, 0.9, WS_Z), ftl = new V(-0.14, 1.22, WS_TOP_Z), ftr = new V(0.14, 1.22, WS_TOP_Z);
  const sbl = new V(-0.37, SILL, WS_TOP_Z), sbr = new V(0.37, SILL, WS_TOP_Z), stl = new V(-0.3, 1.13, WS_TOP_Z), str = new V(0.3, 1.13, WS_TOP_Z);
  return { fbl, fbr, ftl, ftr, sbl, sbr, stl, str };
}

/** A flat pane through four corners. */
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((p) => p.toArray()), 3));
  g.computeVertexNormals();
  return g;
}

/** The paint, the markings and the white bands, worked out per pixel from where it is on the plane. */
function paint(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; varying vec3 vObjN;
      // inside a five-pointed star of outer radius r, a point straight up: folded into one of its ten
      // half-points, a point is in if it's on the centre's side of the edge from the tip to the notch
      bool star5(vec2 p, float r) {
        float seg = 1.2566371, a = abs(mod(atan(p.x, p.y) + seg * 0.5, seg) - seg * 0.5);
        vec2 q = length(p) * vec2(sin(a), cos(a)), o = vec2(0.0, r), e = 0.381966 * r * vec2(0.5878, 0.809) - o, w = q - o;
        return e.x * w.y - e.y * w.x <= 0.0;
      }
      // the star and bars of 1943: 0 nothing, 1 the red surround, 2 the blue disc, 3 white (the star, the
      // bars). The bars are a radius long and half a radius deep; the surround an eighth of a radius wide
      float insignia(vec2 p, float r) {
        vec2 a = abs(p);
        float L = length(p), o = r * 0.125;
        if (L < r) return star5(p, r) ? 3.0 : 2.0;
        if (a.x < 2.0 * r && a.y < r * 0.25) return 3.0;
        if (L < r + o || (a.x < 2.0 * r + o && a.y < r * 0.25 + o)) return 1.0;
        return 0.0;
      }`).replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 p = vObj, n = normalize(vObjN);
        vec3 od = vec3(0.062, 0.062, 0.032), grey = vec3(0.23, 0.24, 0.23), wht = vec3(0.72);
        // the olive drab faded unevenly panel by panel in the sun; the grey less so
        float fade = fract(sin(dot(floor(vec2(p.z * 1.4, p.x * 1.1 + p.y * 1.6)), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 top = od * (0.9 + 0.22 * fade);
        // olive drab down the sides to about the wing, neutral grey under it
        vec3 c = mix(grey, top, smoothstep(-0.4, -0.15, n.y));
        bool body = abs(p.x) < 0.8;
        if (body && p.z < -3.7) c = wht; // the white cowling front
        if (p.z > 4.3 && abs(p.x) < 0.12 && p.y > 1.2 && p.y < 1.5) c = wht; // the band across the fin and the rudder
        if (p.z > 4.4 && abs(p.y - 0.42) < 0.12 && abs(p.x) > 1.25 && abs(p.x) < 1.6) c = wht; // and across the tailplanes
        float k = 0.0;
        if (abs(p.x) < 0.6 && abs(n.x) > 0.4 && p.z > 1.6 && p.z < 3.4) k = insignia(vec2(p.z - 2.5, p.y - 0.12), 0.36); // on the fuselage sides
        // on the wings: over the left wing and under the right, as the USAAF had them, the star's point forward
        if ((p.x < -3.0 && n.y > 0.2) || (p.x > 3.0 && n.y < -0.2)) k = max(k, insignia(vec2(abs(p.x) - 4.55, -(p.z + 0.75)), 0.5));
        if (k > 2.5) c = wht; else if (k > 1.5) c = vec3(0.012, 0.018, 0.06); else if (k > 0.5) c = vec3(0.3, 0.012, 0.012);
        diffuseColor.rgb = c;
      }`);
  };
  m.customProgramCacheKey = () => 'p47-paint';
  return m;
}

/** The Curtiss blades: black, with the yellow tips that warned the ground crew of them. */
function bladePaint(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = vObj.y > 1.8 ? vec3(0.75, 0.48, 0.02) : vec3(0.012);`);
  };
  m.customProgramCacheKey = () => 'p47-blade';
  return m;
}

/** Glass for the canopy. */
const glass = () => new THREE.MeshPhysicalMaterial({ color: 0xc8d8e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });

/** Merge into one geometry, keeping only position and normal (so every part can go in together). */
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); return g; }));

/**
 * The whole aeroplane. lod: the low-detail copy for far away (fewer sections, no guns, frames or engine).
 * Named parts: 'P47_Blades' (the propeller), 'P47_Spinner' (its hub cap) and 'Fake_Blades' (the blur
 * disc), as the game spins them; 'P47_Body' (the painted skin).
 */
export function buildP47({ lod = false } = {}) {
  const root = new THREE.Group();
  root.name = 'P47';
  const skin = paint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 }));
  const dark = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.55, metalness: 0.6 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x47472f, roughness: 0.7, metalness: 0.15 }); // (olive drab, as the hood's frames were)
  const seg = lod ? 12 : 32;
  const body = [loft(BODY, seg, 2.4), loft(SPINE, lod ? 8 : 18)];
  // the cowling's front, closed (the engine and the intake are set into it in the dark below)
  body.push(new THREE.CircleGeometry(1, seg).rotateY(Math.PI).scale(0.64, 0.72, 1).translate(0, -0.07, -4.32));
  // and the spine's front, closed behind the hood (it shows through the glass)
  body.push(new THREE.CircleGeometry(1, seg).rotateY(Math.PI).scale(SPINE[0][1], SPINE[0][2], 1).translate(0, SPINE[0][3], SPINE[0][0]));
  // the wings, the tailplane and the fin (all in the same paint)
  body.push(wing(1, lod), wing(-1, lod));
  const tp = [[0.1, 4.5], [1.0, 4.62], [1.8, 4.8], [2.2, 5.0], [2.32, 5.2], [2.25, 5.42], [1.9, 5.6], [1.0, 5.75], [0.1, 5.8]];
  for (const s of [1, -1]) {
    const g = slab(tp.map(([x, z]) => [x, -z]), 0.08, lod ? 0 : 0.015).rotateX(-Math.PI / 2).translate(0, 0.42, 0);
    if (s < 0) { g.scale(-1, 1, 1); flip(g); }
    body.push(g);
  }
  // the fin and rudder: swept, rounded at the top, the rudder's trailing edge almost upright
  const fin = [[4.0, 0.7], [4.6, 0.95], [5.1, 1.4], [5.35, 1.75], [5.55, 1.95], [5.75, 2.02], [5.95, 1.98], [6.1, 1.8], [6.17, 1.4], [6.18, 0.9], [6.12, 0.45], [5.6, 0.4]];
  body.push(slab(fin.map(([z, y]) => [-z, y]), 0.1, lod ? 0 : 0.015).rotateY(Math.PI / 2));
  if (!lod) {
    // the main wheels' covers under the wing roots, the turbocharger's exhaust hood under the belly
    for (const s of [-1, 1]) body.push(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 20).translate(s * 1.45, wingY(1.45) - 0.14, -0.6));
    body.push(new THREE.BoxGeometry(0.34, 0.12, 0.7).translate(0, -0.78, 1.9));
  }
  const bodyMesh = new THREE.Mesh(merge(body), skin);
  bodyMesh.name = 'P47_Body';
  root.add(bodyMesh);
  // the cowling's open front: the engine's face, and the oval chin intake under it (oil coolers and the
  // intercooler's air), split down the middle
  const front = [new THREE.CircleGeometry(0.55, seg).translate(0, 0.06, -4.33), new THREE.CircleGeometry(1, seg).scale(0.42, 0.15, 1).translate(0, -0.6, -4.33)];
  if (!lod) {
    front.push(new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.5).translate(0, 0.04, -4.33)); // the reduction gear's case
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; front.push(new THREE.BoxGeometry(0.11, 0.2, 0.1).rotateZ(a).translate(Math.sin(-a) * 0.4, 0.06 + Math.cos(a) * 0.4, -4.36)); } // the front row's cylinders
  }
  root.add(new THREE.Mesh(merge(front), dark));
  if (!lod) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.06).translate(0, -0.6, -4.33), skin); // (white, with the cowling)
    root.add(vane);
  }
  // the hub cap, and the four broad paddle blades of the Curtiss Electric propeller, 13 ft across
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.28, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 1.2).translate(0, 0, -4.44),
    new THREE.MeshStandardMaterial({ color: 0x2b2b26, roughness: 0.5, metalness: 0.4 }));
  spinner.name = 'P47_Spinner';
  root.add(spinner);
  const blades = new THREE.Group();
  blades.name = 'P47_Blades';
  blades.position.set(0, 0, -4.47);
  const blade = new THREE.Shape([[-0.05, 0.22], [0.06, 0.22], [0.1, 0.35], [0.16, 0.6], [0.17, 1.2], [0.16, 1.7], [0.13, 1.9], [0.07, 1.97], [-0.02, 1.98], [-0.1, 1.94],
    [-0.14, 1.8], [-0.15, 1.2], [-0.14, 0.6], [-0.1, 0.35]].map(([x, y]) => new THREE.Vector2(x, y)));
  const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.035, bevelEnabled: false }).translate(0, 0, -0.0175).rotateY(0.4);
  const bm = bladePaint(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.4 }));
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(bg, bm); b.rotation.z = (k / 4) * Math.PI * 2 + Math.PI / 4; blades.add(b); }
  root.add(blades);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.98, 32), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  disc.name = 'Fake_Blades';
  disc.position.set(0, 0, -4.5);
  disc.visible = false;
  root.add(disc);
  // the canopy: the windscreen's panes and the sliding hood, glass; inside, the dark of the cockpit
  const ws = windscreen();
  const panes = [quad(ws.fbl, ws.fbr, ws.ftr, ws.ftl), quad(ws.sbl, ws.fbl, ws.ftl, ws.stl), quad(ws.fbr, ws.sbr, ws.str, ws.ftr), hoodGeo(lod ? 8 : 18, lod ? 6 : 14)];
  const canopy = new THREE.Mesh(merge(panes), glass());
  canopy.renderOrder = 2;
  root.add(canopy);
  // (seen through the glass: the cockpit's dark opening over the fuselage's top, the head armour behind it)
  const tub = [new THREE.BoxGeometry(0.66, 0.05, 1.05).translate(0, 0.9, -0.2)];
  if (!lod) tub.push(new THREE.BoxGeometry(0.42, 0.34, 0.03).translate(0, 1.08, 0.3));
  root.add(new THREE.Mesh(merge(tub), dark));
  if (!lod) {
    // the frames: round the windscreen's panes, the hood's bow, a hoop half way and its back, the rails
    // along its shoulders (a framed hood, no bubble), and the aerial mast on the spine
    const P = (x, y, z) => new V(x, y, z), f = [];
    for (const [a, b] of [[ws.fbl, ws.ftl], [ws.fbr, ws.ftr], [ws.ftl, ws.ftr], [ws.fbl, ws.fbr], [ws.ftl, ws.stl], [ws.ftr, ws.str], [ws.sbl, ws.fbl], [ws.sbr, ws.fbr]]) f.push(rod(a, b, 0.016));
    const M = 12;
    for (const z of [WS_TOP_Z + 0.01, -0.1, HOOD_Z - 0.01]) for (let k = 0; k < M; k++) f.push(rod(hoodPoint(z, k, M), hoodPoint(z, k + 1, M), 0.016));
    for (const k of [3, M - 3]) for (let j = 0; j < 6; j++) f.push(rod(hoodPoint(WS_TOP_Z + (j / 6) * (HOOD_Z - WS_TOP_Z), k, M), hoodPoint(WS_TOP_Z + ((j + 1) / 6) * (HOOD_Z - WS_TOP_Z), k, M), 0.012));
    for (const s of [-1, 1]) f.push(rod(P(s * 0.37, SILL, WS_TOP_Z), P(s * 0.38, SILL, HOOD_Z), 0.018)); // the hood's rails on the sills
    f.push(rod(P(0, 1.22, 0.9), P(0, 1.58, 1.15), 0.02)); // the mast
    root.add(new THREE.Mesh(merge(f), frameMat));
    // the guns: four .50s out of each wing's leading edge, staggered
    const guns = p47Muzzles().map(([x, y, z]) => new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8).rotateX(Math.PI / 2).translate(x, y, z + 0.3));
    root.add(new THREE.Mesh(merge(guns), dark));
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = !lod; });
  return root;
}
