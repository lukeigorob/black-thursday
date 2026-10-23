// The walkable inside of a B-17, lined up with the outer model.
// - Walls: the real hull mesh is drawn a second time from the inside with interior paint
//   (the outer skin is made front-face only), so windows and shapes match exactly.
// - The hull's cross-section is measured at load time; the player is kept inside it.
// - Floors, steps, bulkheads, seats and racks are box colliders (Box3) in bomber space.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windowCutout } from './models.js';
import { buildBallTurret } from './ballturret.js';
import { buildTopTurret } from './topturret.js';
import { addMoreDetail } from './interiordetail.js';
import { buildB17Cockpit } from './cockpitb17.js';
import { buildStations } from './stations.js';
import { hullPaint, insideLight, planks, leather, propWear } from './cabinlook.js';

const V = THREE.Vector3, D = Math.PI / 180;
const HULL = /^(MainFuselage2|Nose|Tail|TailGunPod|SideGunPanels|FrontGunPanels|TopTurret)$/;

// Floors (bomber space, nose towards -Z), measured from the hull cross-sections.
export const DECKS = [
  { name: 'Nose', z0: -10.9, z1: -8.6, y: -0.72, hw: 0.9 }, // right up to the nose glass
  { name: 'Cockpit', z0: -8.6, z1: -6.35, y: -0.40, hw: 1.0 },
  { name: 'Bomb bay', z0: -5.6, z1: -2.6, y: -1.62, hw: 0.13 }, // the narrow catwalk
  { name: 'Radio room', z0: -2.6, z1: -1.25, y: -1.80, hw: 0.9 },
  { name: 'Waist', z0: -1.25, z1: 5.2, y: -1.95, hw: 0.9 }, // starts with the ball turret well
  { name: 'Tail', z0: 5.2, z1: 8.2, y: -2.15, hw: 0.6 },
  { name: 'Tail gun', z0: 8.2, z1: 10.25, y: -2.32, hw: 0.5 },
];
const STEPS = [ // from the flight deck down into the bomb bay
  { z0: -6.35, z1: -6.1, y: -0.72 }, { z0: -6.1, z1: -5.85, y: -1.02 }, { z0: -5.85, z1: -5.6, y: -1.32 },
];
const TURRET_CUT = { z: -6.71, y: 0.9, r: 0.5, ring: 1.14 }; // the hole in the cockpit roof up into the top turret

/** Discard everything of a mesh below bomber-space height y (offsetY = the mesh's own height). */
function cutBelow(m, offsetY, y) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      varying float vCutY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vCutY = position.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vCutY;`)
      .replace('void main() {', `void main() {
        if (vCutY + ${offsetY.toFixed(3)} < ${y.toFixed(3)}) discard;`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cut${y}`;
}
const ROOF = 1.12; // m: just under the top of the fuselage at the cockpit (the turret dome rises above it)
const BULKHEADS = [ // door: [x0, x1, height above floor]
  { z: -6.35, floor: -0.40, door: [-0.32, 0.32, 1.45] },
  { z: -2.6, floor: -1.62, door: [-0.3, 0.3, 1.75] },
  { z: -1.25, floor: -1.80, door: [-0.32, 0.32, 1.65] },
];

// Crew positions. stand = where you press E, eye = view at the position,
// yaw: 0 = forward (-Z), 90 = left, 180 = backwards. guns = node names in b17.glb.
// pivot = what the guns turn about (default: their breech); turret = parts that turn with them.
export const STATIONS = [
  { id: 'chin', name: 'Chin turret', stand: [0, -0.72, -9.85], eye: [0, -0.12, -10.78], yaw: 0, yawLim: 55, pitch: [-50, 15], guns: ['LowerFrontGuns'], // ahead of the Norden sight, in the nose glass
    pivot: [0, -1.09, -9.93], turret: { yaw: ['FrontGunCapsule'] } },
  // the Norden bombsight: a telescope looking down-ahead to where the bombs would land (no gun)
  { id: 'bombsight', name: 'Norden bombsight', stand: [0.32, -0.72, -10.05], eye: [0, -0.42, -11.05], yaw: 0, yawLim: 4, pitch: [-4, 4], sight: true,
    hide: ['FrontGunCapsule', 'FrontGunPanels'] }, // looks down through the flat panel in the nose bottom
  { id: 'cheekL', name: 'Left cheek gun', stand: [-0.35, -0.72, -9.45], eye: [-0.55, 0.1, -10.0], yaw: 70, yawLim: 35, pitch: [-35, 30], guns: ['GunBarrel16'], ghost: ['FrontGunPanels'] },
  { id: 'cheekR', name: 'Right cheek gun', stand: [0.35, -0.72, -9.45], eye: [0.55, 0.1, -10.0], yaw: -70, yawLim: 35, pitch: [-35, 30], guns: ['GunBarrel002'], ghost: ['FrontGunPanels'] },
  { id: 'pilot', name: 'Pilot seat', stand: [-0.18, -0.40, -7.2], eye: [-0.55, 0.88, -7.72], yaw: 0, yawLim: 120, pitch: [-40, 40], seat: true, flies: true },
  { id: 'copilot', name: 'Co-pilot seat', stand: [0.18, -0.40, -7.2], eye: [0.55, 0.88, -7.72], yaw: 0, yawLim: 120, pitch: [-40, 40], seat: true, flies: true },
  { id: 'top', name: 'Top turret', stand: [0, -0.28, -6.78], eye: [0, 1.4, -6.71], yaw: 0, yawLim: 180, pitch: [-5, 85], guns: ['TopGuns'],
    entry: { time: 0.8, path: [[0, 0.85, -6.85]], bob: 0.02, bobs: 1 }, // step up onto the platform, head up into the dome
    pivot: [0, 1.43, -6.71], turret: { yaw: ['TopTurret'] },
    hide: ['TopTurret'], attach: 'topCockpit' }, // inside, the model's dome is replaced by a glass one (topturret.js)
  { id: 'ball', name: 'Ball turret', stand: [0, -1.95, 0.6], eye: [0, -2.42, -0.1], yaw: 0, yawLim: 180, pitch: [-89, 5], guns: ['GunBarrel004', 'GunBarrel14'],
    entry: { time: 1.2, path: [[0, -1.05, 0.3], [0, -1.75, 0.08], [0, -2.25, -0.02]], bob: 0.015, bobs: 2 }, // kneel at the hatch, down into the ball
    pivot: [0, -2.15, -0.13], turret: { full: ['BallTurret'], yaw: ['BallStabilizer1'] },
    // inside, the model's ball is replaced by a glass and steel one that turns with your aim (ballturret.js)
    hide: ['BallTurret', 'BallStabilizer1', 'BallTurretTracks', 'BallCap'], attach: 'ballCockpit' },
  { id: 'waistL', name: 'Left waist gun', stand: [-0.3, -1.95, 1.75], eye: [-0.93, -0.98, 1.78], yaw: 90, yawLim: 75, pitch: [-55, 50], guns: ['GunBarrel10'], ghost: ['SideGunPanels', 'LateralGunPivots'], eyeBehind: 0.45 }, // behind the gun, swinging round its mount with it
  { id: 'waistR', name: 'Right waist gun', stand: [0.3, -1.95, 1.85], eye: [0.93, -0.98, 1.82], yaw: -90, yawLim: 75, pitch: [-55, 50], guns: ['GunBarrel005'], ghost: ['SideGunPanels', 'LateralGunPivots'], eyeBehind: 0.45 },
  { id: 'tail', name: 'Tail gun', stand: [0, -2.32, 9.6], eye: [0, -1.55, 9.8], lean: 0.16, yaw: 180, yawLim: 35, pitch: [-30, 25], guns: ['GunBarrel007', 'GunBarrel12'], attach: 'ironSight',
    entry: { time: 1.5, path: [[0, -1.5, 9.66], [0, -1.6, 9.74], [0, -1.58, 9.79]], bob: 0.035, bobs: 3 } }, // crawl back under the tail on your knees, up onto the seat // the pod turns to glass; its frame is built in buildTail
].map((s) => ({ ...s, stand: new V(...s.stand), eye: new V(...s.eye), yaw: s.yaw * D, yawLim: s.yawLim * D, pitch: [s.pitch[0] * D, s.pitch[1] * D] }));

// hull cross-section table: half-width of the cabin at (z, y), 10 cm x 5 cm cells
const T = { z0: -11.4, dz: 0.1, nz: 229, y0: -2.7, dy: 0.05, ny: 89 };

function measureHull(meshes, root) {
  const hw = new Float32Array(T.nz * T.ny).fill(Infinity);
  const inv = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(), a = new V(), b = new V(), c = new V(), cut = [];
  const edge = (p, q, z) => {
    if ((p.z <= z && q.z > z) || (q.z <= z && p.z > z)) {
      const t = (z - p.z) / (q.z - p.z);
      cut.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
    }
  };
  for (const mesh of meshes) {
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m);
      const k0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - T.z0) / T.dz));
      const k1 = Math.min(T.nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - T.z0) / T.dz));
      for (let k = k0; k <= k1; k++) {
        const z = T.z0 + k * T.dz;
        cut.length = 0;
        edge(a, b, z); edge(b, c, z); edge(c, a, z);
        if (cut.length < 4) continue;
        const [x1, y1, x2, y2] = cut;
        const r0 = Math.max(0, Math.ceil((Math.min(y1, y2) - T.y0) / T.dy));
        const r1 = Math.min(T.ny - 1, Math.floor((Math.max(y1, y2) - T.y0) / T.dy));
        for (let r = r0; r <= r1; r++) {
          const y = T.y0 + r * T.dy;
          const x = y1 === y2 ? Math.min(Math.abs(x1), Math.abs(x2)) : x1 + ((x2 - x1) * (y - y1)) / (y2 - y1);
          const j = k * T.ny + r;
          if (x >= 0 && x < hw[j]) hw[j] = x;
        }
      }
    }
  }
  for (let j = 0; j < hw.length; j++) if (!Number.isFinite(hw[j])) hw[j] = 0;
  return hw;
}

// ---------- materials ----------
// low envMapIntensity: the sky reflection must not light the cabin as if the hull weren't there
const std = (color, roughness = 0.8, metalness = 0.1) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.07 });
const MAT = {
  floor: planks(std(0x9a8a70, 0.85)), // wooden planks (cabinlook.js)
  metal: std(0x767a70, 0.55, 0.6),
  green: std(0x5d6640, 0.75),
  dark: std(0x232323, 0.6, 0.3),
  well: Object.assign(std(0x2a2b28, 0.7, 0.4), { side: THREE.DoubleSide }), // seen from below, from inside
  leather: leather(std(0x5b3b24, 0.7)),
  bomb: std(0x495031, 0.6, 0.2),
  bombBand: std(0xb8932c, 0.6), // only on the bombs, so the whole load can be hidden after the drop
  yellow: std(0xb8932c, 0.6),
  radio: std(0x3d3f38, 0.5, 0.4),
  ammo: std(0x4b5230, 0.7, 0.15), // olive drab ammunition boxes
  chute: std(0x8a8d82, 0.45, 0.7), // flexible steel feed chutes
  hose: std(0x161616, 0.85, 0.0), // rubber oxygen hoses
  cable: std(0x2a2a28, 0.4, 0.8),
  red: std(0x8a1c14, 0.5, 0.2),
  pad: new THREE.MeshStandardMaterial({ map: quiltTexture(), roughness: 0.95, envMapIntensity: 0.05 }), // quilted insulation
  canvas: leather(std(0x6b5f47, 0.95)), // the tail guns' canvas boot
};

function liningMaterial(src, inverted, offset = new V()) {
  // interior paint, cut out where the outer skin has windows; worn: blotchy, scuffed through to
  // bare aluminium here and there (noise from the position, so no extra texture)
  const m = windowCutout(new THREE.MeshStandardMaterial({
    color: 0x6f7462, roughness: 0.75, metalness: 0.3, envMapIntensity: 0.08,
    side: inverted ? THREE.FrontSide : THREE.BackSide, map: src.map,
  }), false);
  const cutout = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    cutout(sh, r);
    // windows only: the paint's alpha is speckled, and a lone speck cut through let the sky show
    // through the wall in white flecks. Cut where the texels round about are see-through too.
    sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.a = texel.a < 0.95 ? 0.0 : 1.0;', `
      vec2 o = vec2(0.003, 0.0);
      float aa = max(max(texel.a, max(texture2D(map, vMapUv + o).a, texture2D(map, vMapUv - o).a)), max(texture2D(map, vMapUv + o.yx).a, texture2D(map, vMapUv - o.yx).a));
      diffuseColor.a = aa < 0.95 ? 0.0 : 1.0;`);
    // the opening up into the top turret: the roof is cut away round its ring (bomber space: + offset)
    sh.uniforms.uOff = { value: offset };
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform vec3 uOff;
      void main() {
        vec3 pb = vPosM + uOff;
        if (pb.y > ${TURRET_CUT.y.toFixed(2)} && length(pb.xz - vec2(0.0, ${TURRET_CUT.z.toFixed(2)})) < ${TURRET_CUT.r.toFixed(2)}) discard;
`);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPosM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosM = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPosM;
      float h3(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float blotch = n3(vPosM * 2.3) * 0.6 + n3(vPosM * 9.0) * 0.4;
      diffuseColor.rgb *= 0.9 + 0.14 * blotch; // (a little: blotchy paint looks like camouflage)
      float worn = smoothstep(0.8, 0.92, n3(vPosM * 5.0 + 3.1) * 0.8 + n3(vPosM * 23.0) * 0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.51, 0.48), worn * 0.35); // scuffed through to the metal (subtle: bright patches read as holes)`);
    hullPaint(sh, 'vPosM + uOff'); // the worn green paint, rivet rows and seams (cabinlook.js)
  };
  m.customProgramCacheKey = () => 'lining-worn';
  return m;
}

/** Copy of geo without the end caps: triangles beyond zFront / zBack (bomber space) facing along Z. */
function openEnds(geo, offsetZ, zFront, zBack) {
  const p = geo.attributes.position, idx = geo.index;
  if (!idx) return geo;
  const a = new V(), b = new V(), c = new V(), n = new V(), keep = [];
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
    const z = (a.z + b.z + c.z) / 3 + offsetZ;
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    if ((z < zFront || z > zBack) && Math.abs(n.z) > 0.6) continue;
    keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  const out = geo.clone();
  out.setIndex(keep);
  return out;
}

/** True if most normals point towards the middle of the mesh instead of away from it. */
function facesInward(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  if (!n) return false;
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new V()), v = new V(), nv = new V();
  let s = 0;
  for (let i = 0; i < p.count; i++) s += nv.fromBufferAttribute(n, i).dot(v.fromBufferAttribute(p, i).sub(c));
  return s < 0;
}

function quiltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5e5a44'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(30,28,20,0.55)'; g.lineWidth = 2;
  for (let k = -128; k < 256; k += 32) { // diamond stitching
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(k + 128, 0); g.lineTo(k, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A stencilled marking: white or yellow letters on a transparent plate. */
/**
 * Plexiglas: clear, but you can tell it's there. Faint where you look straight through it, brighter and
 * reflecting the sky towards grazing angles, fine scratches that catch the light, and a little grime
 * gathered towards the edges of the window.
 */
function plexiglas(holes = null, side = THREE.DoubleSide) {
  const m = new THREE.MeshStandardMaterial({ color: 0xc9d8cf, roughness: 0.04, metalness: 0, transparent: true, opacity: 1,
    depthWrite: false, side, envMapIntensity: 1.3, map: holes });
  m.onBeforeCompile = (sh) => {
    // holes: the skin's paint texture; the glass is only drawn in its windows (see windowCutout)
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', holes ? `
      vec2 ho = vec2(0.003, 0.0);
      float ha = max(max(texture2D(map, vMapUv).a, max(texture2D(map, vMapUv + ho).a, texture2D(map, vMapUv - ho).a)), max(texture2D(map, vMapUv + ho.yx).a, texture2D(map, vMapUv - ho.yx).a));
      if (ha >= 0.95) discard;` : '');
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGP; varying vec2 vGUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position; vGUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGP; varying vec2 vGUv;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <opaque_fragment>', `
      vec3 vd = normalize(vViewPosition);
      float fres = pow(1.0 - abs(dot(normalize(normal), vd)), 4.0);
      // fine scratches: long thin streaks in two directions, only some catch the light
      vec2 q = vGP.xy * 38.0 + vGP.zz * 21.0;
      float sc = smoothstep(0.985, 1.0, gn(vec2(q.x * 0.08, q.y * 3.0))) + smoothstep(0.988, 1.0, gn(vec2(q.x * 2.6 + q.y, q.y * 0.07)));
      // grime towards the window's edges, and a faint mottle all over
      float edge = ${holes ? '0.25' : '1.0 - smoothstep(0.0, 0.22, min(min(vGUv.x, 1.0 - vGUv.x), min(vGUv.y, 1.0 - vGUv.y)))'};
      float grime = edge * (0.5 + 0.5 * gn(vGP.xy * 18.0)) * 0.22 + gn(vGP.xz * 60.0) * 0.015;
      float ga = clamp(0.13 + fres * 0.3 + sc * 0.6 + grime, 0.0, 0.6);
      outgoingLight = mix(outgoingLight, vec3(0.32, 0.31, 0.27) * (0.4 + outgoingLight), clamp(grime / max(ga, 0.01), 0.0, 1.0));
      #include <opaque_fragment>
      // (the sky's reflection added on top, stronger towards grazing angles, so the glass shows)
      gl_FragColor.rgb += reflectedLight.indirectSpecular * (1.4 + 1.2 * fres) / max(ga, 0.08) * 0.35;
      gl_FragColor.a = ga;`);
  };
  m.customProgramCacheKey = () => `plexiglas${holes ? '-holes' : ''}${side}`;
  m.userData.outside = true; // (it reflects the open sky: not darkened like the cabin)
  return m;
}

function stencilTexture(lines, colour = '#e8e2c8') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64 * lines.length;
  const g = c.getContext('2d');
  g.fillStyle = colour; g.font = 'bold 44px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, 128, 32 + i * 64, 248));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/**
 * Remove zero-area triangles (non-indexed geometry). Filling an outline whose wall runs straight puts
 * several points in a line, and the triangulation then makes slivers with no area, so they have no
 * normal: lighting them gives NaN, and the bloom pass spread that one pixel into a black screen.
 */
function dropDegenerate(geo) {
  const pos = geo.attributes.position, keep = [];
  const a = new V(), b = new V(), c = new V();
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
    if (c.sub(a).cross(b.sub(a)).lengthSq() > 1e-12) keep.push(t);
  }
  if (keep.length * 3 === pos.count) return geo;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const n = attr.itemSize, arr = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, k) => { for (let v = 0; v < 3; v++) for (let j = 0; j < n; j++) arr[(k * 3 + v) * n + j] = attr.array[(t + v) * n + j]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  // any normal still zero-length (a vertex averaged from opposite faces) points up instead of NaN
  const nm = out.attributes.normal;
  if (nm) for (let i = 0; i < nm.count; i++) if (Math.hypot(nm.getX(i), nm.getY(i), nm.getZ(i)) < 1e-6) nm.setXYZ(i, 0, 1, 0);
  return out;
}

const _sd = new V(), _sd2 = new V(), _up = new V(0, 1, 0);
const ghosts = new Map();
function ghostOf(m) {
  if (!ghosts.has(m)) {
    ghosts.set(m, new THREE.MeshStandardMaterial({
      map: m.map, color: 0xb8c8d0, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6,
    }));
  }
  return ghosts.get(m);
}

// ---------- the interior ----------
export class Interior {
  constructor(model) {
    this.model = model;
    model.updateMatrixWorld(true);
    const hull = [];
    model.traverse((o) => { if (o.isMesh && HULL.test(o.name)) hull.push(o); });
    this.table = measureHull(hull, model);
    this.hullMeshes = hull;
    this.boxes = [];
    this.people = []; // the crew standing or sitting about: you brush past them (Player), not through (Crew keeps it up to date)
    this.group = new THREE.Group();
    this.group.name = 'Interior';
    this.geos = new Map(); // material -> geometries to merge
    this.stations = STATIONS;

    this.lineHull(hull);
    this.buildRibs();
    this.buildFloors();
    this.buildBulkheads();
    this.buildNose();
    this.buildCockpit();
    this.buildBombBay();
    this.buildRadioRoom();
    this.buildWaist();
    this.buildTail();
    this.buildDetails();
    addMoreDetail(this, MAT, DECKS);

    this.bombMeshes = [];
    for (const [mat, geos] of this.geos) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = mat !== MAT.floor; // (the floor's planks would shade themselves: no window light on them)
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (mat === MAT.bomb || mat === MAT.bombBand) this.bombMeshes.push(mesh);
    }
    // the cabin is dark inside: the sun through the windows lights it, not the sky (cabinlook.js)
    // grime and worn edges on the boxes, cans, bottles, radio sets and seats (not the floor, glass, lamps)
    this.group.traverse((o) => { if (o.isMesh && o.geometry.attributes.aEdge && !o.material.transparent && !o.material.emissiveMap && o.material !== MAT.floor && !(o.material.emissiveIntensity > 0 && o.material.emissive?.getHex())) propWear(o.material); });
    this.group.traverse((o) => { if (o.isMesh && !o.material.userData?.outside) insideLight(o.material); });
    for (const [outer, lining] of this.parts.values()) if (lining) insideLight(lining.material);
  }

  /** Bombs away: the racks are empty (or full again, for a fresh bomber). */
  emptyBombBay(empty = true) { for (const m of this.bombMeshes) m.visible = !empty; }

  // ----- helpers -----
  hw(z, y) {
    const k = Math.round((z - T.z0) / T.dz), r = Math.round((y - T.y0) / T.dy);
    return k < 0 || k >= T.nz || r < 0 || r >= T.ny ? 0 : this.table[k * T.ny + r];
  }

  /** Half-width blended between table cells, so walls and ceilings are smooth to walk along. */
  hwSmooth(z, y) {
    const fz = (z - T.z0) / T.dz, fy = (y - T.y0) / T.dy;
    const k = Math.floor(fz), r = Math.floor(fy), tz = fz - k, ty = fy - r;
    const cell = (k, r) => (k < 0 || k >= T.nz || r < 0 || r >= T.ny ? 0 : this.table[k * T.ny + r]);
    // open cells (Infinity) can't be blended: take the nearer one
    const mix = (a, b, t) => (a === Infinity || b === Infinity ? (t < 0.5 ? a : b) : a + (b - a) * t);
    return mix(mix(cell(k, r), cell(k + 1, r), tz), mix(cell(k, r + 1), cell(k + 1, r + 1), tz), ty);
  }

  /** Narrowest half-width of the cabin between heights y0 and y1 at z. */
  wallLimit(z, y0, y1) {
    let m = Infinity;
    for (let y = y0; y <= y1 + 1e-6; y += T.dy) m = Math.min(m, this.hwSmooth(z, y));
    return Math.min(m, this.hwSmooth(z, y1));
  }

  /** First height above y0 where the hull is too narrow for a head at x. */
  ceilingAt(z, x, y0) {
    const top = T.y0 + T.ny * T.dy, need = Math.abs(x) + 0.15; // 0.15 = half a head; the thin tail fin is not headroom
    let y = y0, prev = this.hwSmooth(z, y) - need;
    if (prev < 0) return y;
    while (y < top) {
      const g = this.hwSmooth(z, y + T.dy) - need;
      if (g < 0) return y + (Number.isFinite(prev) ? T.dy * prev / (prev - g) : 0); // where the wall crosses
      prev = g;
      y += T.dy;
    }
    return y;
  }

  /** Highest box top under (x, z) that is no higher than maxY. */
  floorAt(x, z, maxY) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= maxY && b.max.y > best) best = b.max.y;
    }
    return best;
  }

  /** Does a vertical cylinder (radius r, from y0 to y1) at (x, z) hit any box? */
  blocked(x, z, r, y0, y1) {
    for (const b of this.boxes) {
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  /** Pushes a circle (radius r, centre p.x/p.z) out of every box between heights y0 and y1, so you slide round corners. */
  pushOut(p, r, y0, y1) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of this.boxes) {
        if (b.max.y <= y0 || b.min.y >= y1) continue;
        const dx = p.x - Math.max(b.min.x, Math.min(p.x, b.max.x)), dz = p.z - Math.max(b.min.z, Math.min(p.z, b.max.z));
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const k = (r - Math.sqrt(d2)) / Math.sqrt(d2);
          p.x += dx * k; p.z += dz * k;
        } else { // centre inside the box: leave through the nearest side
          const out = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z], i = out.indexOf(Math.min(...out));
          if (i === 0) p.x = b.min.x - r; else if (i === 1) p.x = b.max.x + r; else if (i === 2) p.z = b.min.z - r; else p.z = b.max.z + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return p;
  }

  /** Free height above the feet at (x, z): hull ceiling or the underside of a box overhead. */
  headroom(x, z, feet, r, step) {
    let c = this.ceilingAt(z, x, feet + 0.3);
    for (const b of this.boxes) {
      if (b.min.y < feet + step) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x)), cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) c = Math.min(c, b.min.y);
    }
    return c - feet;
  }

  zoneAt(z) {
    if (z >= -6.35 && z < -5.6) return 'Bomb bay';
    return DECKS.find((d) => z >= d.z0 && z < d.z1)?.name ?? '';
  }

  nearestStation(feet, maxDist = 1.1) {
    let best = null, bd = maxDist;
    for (const s of this.stations) {
      if (Math.abs(feet.y - s.stand.y) > 0.7) continue;
      const d = Math.hypot(feet.x - s.stand.x, feet.z - s.stand.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Adds a box: `mat` draws it (null = invisible), `solid` makes it a collider. */
  box(x0, x1, y0, y1, z0, z1, mat, solid = true) {
    if (solid) this.boxes.push(new THREE.Box3(new V(x0, y0, z0), new V(x1, y1, z1)));
    if (mat) this.add(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  }

  add(mat, geo) {
    if (!this.geos.has(mat)) this.geos.set(mat, []);
    // which of its UVs run to an edge, for the worn edges (cabinlook.js propWear): a box's both ways
    // round each face, a can's or bottle's only top and bottom
    const edge = geo.type === 'BoxGeometry' ? [1, 1] : geo.type === 'CylinderGeometry' ? [0, 1] : [0, 0];
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).map((_, i) => edge[i % 2]), 2));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.geos.get(mat).push(dropDegenerate(g)); // extrusions are non-indexed
  }

  cylinder(r, len, x, y, z, axis, mat, seg = 14) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    this.add(mat, g.translate(x, y, z));
  }

  // ----- parts -----
  lineHull(hull) {
    this.parts = new Map(); // name -> [outer mesh, lining] so stations can hide what blocks the view
    for (const mesh of hull) {
      if (mesh.material.userData.glass) continue; // glass needs no lining
      // the fuselage is closed with painted caps behind the nose glass and in front of the tail pod:
      // open them up (in this bomber only) so the bombardier and tail gunner can see out
      if (mesh.name === 'MainFuselage2') mesh.geometry = openEnds(mesh.geometry, mesh.position.z, -10.5, 10.1);
      this.parts.set(mesh.name, [mesh]);
      // some parts (e.g. the nose glass) were modelled with their faces pointing inwards
      const inverted = facesInward(mesh.geometry);
      const outer = mesh.material.clone(); // clone() drops the shader hook, so re-apply it
      if (mesh.material.alphaTest) windowCutout(outer);
      outer.side = inverted ? THREE.BackSide : THREE.FrontSide; // the outside skin no longer hides the cabin
      outer.shadowSide = THREE.DoubleSide; // (one-sided, its shadow would be the belly's alone: the roof and its windows must cast)
      mesh.material = outer;
      // the top turret isn't cabin: no lining (from below you look up through its ring into the glass
      // dome, see buildTopDome), and its floor under the ring is cut away, so it doesn't shut the opening
      if (mesh.name === 'TopTurret') { cutBelow(outer, mesh.position.y, TURRET_CUT.ring); continue; }
      const lining = new THREE.Mesh(mesh.geometry, liningMaterial(outer, inverted, mesh.position));
      lining.name = `${mesh.name}_lining`;
      lining.position.copy(mesh.position);
      lining.quaternion.copy(mesh.quaternion);
      lining.scale.copy(mesh.scale);
      lining.receiveShadow = true;
      lining.castShadow = false; lining.userData.noShadow = true; // (the skin's shadow has the window cut-outs; a second one wouldn't)
      mesh.parent.add(lining);
      this.parts.get(mesh.name).push(lining);
    }
  }

  /** Hide (or show again) hull parts by name, e.g. the painted tail cap while at the tail gun. */
  setHidden(names, hidden) {
    for (const n of names) for (const m of this.parts.get(n) ?? [this.model.getObjectByName(n) ?? this.group.getObjectByName(n)]) if (m) m.visible = !hidden;
  }

  /** Turret shells turn to faint glass while you're in them, so the frame never blocks the view. */
  setGhost(names, on) {
    for (const n of names) {
      const [outer, lining] = this.parts.get(n) ?? [this.model.getObjectByName(n)];
      if (lining) lining.visible = !on;
      outer?.traverse((o) => {
        if (!o.isMesh) return;
        if (on && !o.userData.solid) {
          o.userData.solid = o.material;
          o.material = ghostOf(o.material);
          o.castShadow = false;
        } else if (!on && o.userData.solid) {
          o.material = o.userData.solid;
          o.userData.solid = null;
          o.castShadow = true;
        }
      });
    }
  }

  buildFloors() {
    for (const d of DECKS) {
      this.box(-d.hw, d.hw, d.y - 0.1, d.y, d.z0, d.z1, null);
      for (let z = d.z0; z < d.z1 - 0.01; z += 0.25) { // planks follow the hull's width
        const z1 = Math.min(z + 0.25, d.z1), w = Math.min(d.hw, this.hw((z + z1) / 2, d.y + 0.06) - 0.01);
        if (w > 0.05) this.add(MAT.floor, new THREE.BoxGeometry(w * 2, 0.04, z1 - z - 0.01).translate(0, d.y - 0.02, (z + z1) / 2));
      }
    }
    for (const s of STEPS) this.box(-0.3, 0.3, -2.0, s.y, s.z0, s.z1, MAT.floor);
  }

  /** Cabin outline at z (shrunk by `inset`), as points going round: [lo, hi, points]. */
  outline(z, mid, inset, maxY = Infinity) {
    let lo = mid, hi = mid;
    while (this.hw(z, lo - 0.05) > 0.08 + inset && lo > T.y0) lo -= 0.05;
    while (this.hw(z, hi + 0.05) > 0.08 + inset && hi < T.y0 + T.ny * T.dy && hi + 0.05 <= maxY) hi += 0.05;
    const pts = [];
    for (let y = lo; y <= hi + 1e-6; y += 0.05) pts.push(new THREE.Vector2(this.hw(z, y) - inset, y));
    for (let y = hi; y >= lo - 1e-6; y -= 0.05) pts.push(new THREE.Vector2(-(this.hw(z, y) - inset), y));
    return [lo, hi, pts];
  }

  buildRibs() {
    // fuselage frames every 50 cm from the radio room to the tail, following the hull's shape
    for (let z = -2.5; z < 9.5; z += 0.5) {
      const deck = DECKS.find((d) => z >= d.z0 && z < d.z1);
      if (!deck) continue;
      const [, , outer] = this.outline(z, deck.y + 0.3, 0.01);
      const [, , inner] = this.outline(z, deck.y + 0.3, 0.07);
      if (outer.length < 8 || inner.length < 8) continue;
      const shape = new THREE.Shape(outer);
      shape.holes.push(new THREE.Path(inner));
      // lightening holes punched through the web, every 15 cm or so round the frame
      const [, , mid] = this.outline(z, deck.y + 0.3, 0.04);
      let last = null;
      for (const p of mid) {
        if (p.y < deck.y + 0.08 || (last && last.distanceTo(p) < 0.15)) continue;
        shape.holes.push(new THREE.Path().absarc(p.x, p.y, 0.014, 0, Math.PI * 2, true));
        last = p;
      }
      this.add(MAT.metal, new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, z));
      // the inner flange: the frame is a channel, its edge turned over
      const [, , lip] = this.outline(z, deck.y + 0.3, 0.062);
      if (lip.length >= 8) {
        const flange = new THREE.Shape(lip);
        flange.holes.push(new THREE.Path(inner));
        this.add(MAT.metal, new THREE.ExtrudeGeometry(flange, { depth: 0.045, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z - 0.015));
      }
    }
  }

  buildBulkheads() {
    for (const b of BULKHEADS) {
      // stop at the fuselage roof: the hull table also holds the top turret's dome, and a bulkhead
      // traced up into it stood right behind the turret gunner's head, filling his view aft
      const [, hi, pts] = this.outline(b.z, b.floor + 0.6, 0.01, ROOF);
      const shape = new THREE.Shape(pts);
      const [x0, x1, h] = b.door, top = Math.min(b.floor + h, hi - 0.1);
      shape.holes.push(new THREE.Path([new THREE.Vector2(x0, b.floor), new THREE.Vector2(x1, b.floor),
        new THREE.Vector2(x1, top), new THREE.Vector2(x0, top)]));
      this.add(MAT.green, new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, b.z - 0.02));
      this.box(-2, x0, -3, 3, b.z - 0.05, b.z + 0.05, null);
      this.box(x1, 2, -3, 3, b.z - 0.05, b.z + 0.05, null);
      this.box(x0, x1, top, 3, b.z - 0.05, b.z + 0.05, null);
      for (const x of [x0, x1]) this.box(x - 0.03, x + 0.03, b.floor, top, b.z - 0.04, b.z + 0.04, MAT.metal, false); // door frame
    }
  }

  buildNose() {
    const f = -0.72;
    this.box(-0.95, -0.55, f, 0.02, -9.4, -8.85, null); // navigator's table (drawn in stations.js)
    this.box(-0.18, 0.18, f, -0.3, -10.3, -10.08, MAT.leather); // bombardier's seat
    this.box(-0.18, 0.18, -0.3, 0.4, -10.3, -10.08, null); // (no climbing onto it)
    this.box(-1.0, 1.0, f, 1.0, -11.8, -10.82, null); // the nose glass: you can't walk out past the end of the floor
    this.box(-0.09, 0.09, f, -0.25, -10.55, -10.42, MAT.metal); // bomb-sight stand
    this.box(-0.11, 0.11, -0.25, -0.02, -10.6, -10.36, MAT.dark, false); // Norden bomb sight
  }

  buildCockpit() {
    const f = -0.40;
    buildB17Cockpit(this); // the panel, glare shield, wheels, pedestal and seats (cockpitb17.js)
    // top turret: the engineer's standing platform, and above him the opening in the roof up into the
    // turret: the ring and its lip, and ammunition boxes either side
    this.box(-0.32, 0.32, f, f + 0.12, -7.0, -6.55, MAT.metal);
    this.add(MAT.metal, new THREE.TorusGeometry(TURRET_CUT.r + 0.02, 0.035, 8, 40).rotateX(Math.PI / 2).translate(0, 1.15, TURRET_CUT.z));
    this.add(MAT.well, new THREE.CylinderGeometry(TURRET_CUT.r + 0.01, TURRET_CUT.r + 0.01, 0.06, 40, 1, true).translate(0, 1.15, TURRET_CUT.z)); // the ring's lip (open below: you see the engineer up in it)
    for (const s of [-1, 1]) {
      this.box(s * 0.42 - 0.1, s * 0.42 + 0.1, 0.62, 0.92, TURRET_CUT.z - 0.22, TURRET_CUT.z + 0.22, MAT.ammo, false); // ammunition boxes on the turret
      this.rod([s * 0.38, 0.92, TURRET_CUT.z], [s * 0.18, 1.12, TURRET_CUT.z - 0.05], 0.03, MAT.chute, 8); // feed chutes up to the guns
    }
  }

  buildBombBay() {
    for (const s of [-1, 1]) {
      this.box(s > 0 ? 0.3 : -1.2, s > 0 ? 1.2 : -0.3, -2.2, 0.8, -6.35, -2.6, null); // bomb racks: stay on the catwalk
      for (let z = -6.2; z <= -2.6; z += 1.2) this.box(s * 0.33 - 0.025, s * 0.33 + 0.025, -1.9, 0.7, z - 0.025, z + 0.025, MAT.metal, false);
      for (const z of [-4.9, -3.5]) for (const y of [-1.5, -1.1, -0.7, -0.3]) {
        this.cylinder(0.18, 0.95, s * 0.58, y, z, 'z', MAT.bomb);
        this.add(MAT.bomb, new THREE.SphereGeometry(0.18, 12, 8).translate(s * 0.58, y, z - 0.475));
        this.add(MAT.bomb, new THREE.ConeGeometry(0.18, 0.35, 12).rotateX(-Math.PI / 2).translate(s * 0.58, y, z + 0.65));
        this.cylinder(0.185, 0.05, s * 0.58, y, z - 0.25, 'z', MAT.bombBand);
      }
    }
    for (const x of [-0.13, 0.13]) this.cylinder(0.012, 3.0, x, -0.85, -4.1, 'z', MAT.dark, 6); // hand ropes
  }

  buildRadioRoom() {
    const f = -1.80;
    // the desk, its sets and the chair are drawn in stations.js; these keep you out of them
    this.box(-1.0, -0.42, f, -1.05, -2.5, -1.8, null); // desk
    this.box(-0.97, -0.6, -1.05, -0.3, -2.45, -1.94, null); // the sets on it
    this.box(-0.85, -0.5, f, f + 0.45, -1.72, -1.42, null); // operator's chair
  }

  buildWaist() {
    const f = -1.95;
    this.box(-0.36, 0.36, f, -1.2, -0.5, 0.24, null); // ball turret and its support stick up through the floor
    this.add(MAT.metal, new THREE.TorusGeometry(0.5, 0.04, 8, 32).rotateX(Math.PI / 2).translate(0, f + 0.02, -0.13));
    // the ball's steel top where it comes up through the floor (the model's ball is glass up here, and
    // seen from the waist it mirrored the sky). Hidden while you're in the ball yourself.
    const rc = 0.57, cy = -2.15, top = Math.acos(THREE.MathUtils.clamp((f - cy) / rc, -1, 1));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(rc, 36, 10, 0, Math.PI * 2, 0, top).translate(0, cy, -0.13), std(0x5a5e56, 0.55, 0.55));
    cap.name = 'BallCap';
    cap.receiveShadow = true;
    this.group.add(cap);
    this.add(MAT.dark, new THREE.CylinderGeometry(0.08, 0.1, 0.05, 16).translate(0, cy + rc - 0.01, -0.13)); // its hub
    for (const s of [-1, 1]) {
      this.box(s > 0 ? 0.5 : -0.74, s > 0 ? 0.74 : -0.5, f, f + 0.35, 2.75, 3.15, MAT.green); // ammo boxes
      this.cylinder(0.11, 0.55, s * 0.72, -1.15, 0.8, 'y', MAT.yellow); // oxygen bottles
      this.cylinder(0.11, 0.55, s * 0.72, -1.15, 1.05, 'y', MAT.yellow);
    }
  }

  /** A thin rod (cable, hose, chute) from a to b. */
  rod(a, b, r, mat, seg = 6) {
    const A = new V(...a), B = new V(...b), len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), B.clone().sub(A).normalize()));
    this.add(mat, g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2));
  }

  /** A stencilled marking on a flat surface (facing +Z when rotY = 0). */
  stencil(lines, w, pos, rotY = 0, colour) {
    const h = (w / 4) * lines.length;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
      map: stencilTexture(lines, colour), transparent: true, alphaTest: 0.3, roughness: 0.8, envMapIntensity: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(...pos); m.rotation.y = rotY;
    this.group.add(m);
  }

  /**
   * The clutter of a real B-17: ammunition boxes and feed chutes at the guns, oxygen bottles and hoses,
   * control cables along the walls, the ball turret's support, the radio sets, padding and stencils.
   * All decoration (no colliders), kept clear of the walkway and every gun position's view.
   */
  buildDetails() {
    // waist guns: an ammo box on the floor by each gun, the chute up to the gun's breech
    for (const s of [-1, 1]) {
      this.box(s * 0.62 - 0.14, s * 0.62 + 0.14, -1.95, -1.6, 2.15, 2.5, MAT.ammo, false);
      this.rod([s * 0.66, -1.6, 2.3], [s * 0.9, -1.3, 2.0], 0.045, MAT.chute, 8);
      this.rod([s * 0.9, -1.3, 2.0], [s * 1.0, -1.17, 1.88], 0.045, MAT.chute, 8);
      this.stencil(['CAL .50', 'LINKED'], 0.22, [s * 0.62, -1.75, s > 0 ? 2.151 : 2.149], s > 0 ? Math.PI : Math.PI);
    }
    // tail guns: boxes along the walls, chutes forward to the guns
    for (const s of [-1, 1]) {
      this.box(s * 0.32 - 0.12, s * 0.32 + 0.12, -2.32, -2.02, 8.55, 9.15, MAT.ammo, false);
      this.rod([s * 0.3, -2.05, 9.1], [s * 0.18, -2.12, 9.85], 0.04, MAT.chute, 8);
    }
    // the ball turret hangs from a beam across the fuselage on a post
    this.box(-0.85, 0.85, -0.55, -0.45, -0.2, -0.06, MAT.metal, false);
    this.cylinder(0.06, 0.9, 0, -1.0, -0.13, 'y', MAT.metal, 10);
    // oxygen: yellow bottles in the cockpit and radio room, hoses to each crew position
    for (const [x, y, z] of [[-0.85, -0.15, -7.05], [0.85, -0.15, -7.05], [0.8, -1.5, -2.2], [0.8, -1.5, -1.95]]) {
      this.cylinder(0.1, 0.5, x, y, z, 'y', MAT.yellow, 12);
      this.rod([x, y + 0.27, z], [x * 0.92, y + 0.55, z + 0.25], 0.012, MAT.hose);
    }
    this.stencil(['OXYGEN'], 0.2, [0.69, -1.45, -2.08], -Math.PI / 2, '#1a1a1a');
    for (const s of [-1, 1]) this.rod([s * 0.62, -1.2, 1.05], [s * 0.85, -0.95, 1.6], 0.012, MAT.hose); // waist gunners' hoses
    // fire extinguisher by the radio room door
    this.cylinder(0.07, 0.42, 0.55, -1.58, -1.4, 'y', MAT.red, 12);
    this.stencil(['FIRE', 'EXTINGUISHER'], 0.26, [0.55, -1.1, -1.32], 0);
    // control cables to the tail, along both walls just under the windows
    for (const s of [-1, 1]) {
      let prev = null;
      for (let z = -1.0; z <= 9.0; z += 0.5) {
        const deck = DECKS.find((d) => z >= d.z0 && z < d.z1) ?? DECKS.at(-1);
        const y = deck.y + 1.32, x = s * (this.hw(z, y) - 0.06);
        if (!Number.isFinite(x) || Math.abs(x) < 0.2) { prev = null; continue; }
        if (prev && !(z > 1.3 && z < 2.3)) this.rod(prev, [x, y, z], 0.006, MAT.cable, 4); // (not across the waist windows)
        prev = [x, y, z];
      }
    }
    buildStations(this, MAT); // the navigator's and radio operator's stations (stations.js)
    // padded walls: quilted insulation on the radio room bulkheads, either side of the doors
    for (const [z, dir] of [[-2.57, 1], [-1.28, -1]]) for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.42, 1.0); if (dir < 0) g.rotateY(Math.PI);
      this.add(MAT.pad, g.translate(s * 0.58, -1.2, z));
    }
    // stencils: the things painted on every B-17
    this.stencil(['NO SMOKING'], 0.36, [0, -0.25, -6.31], Math.PI);
    this.stencil(['DANGER', 'BOMB BAY'], 0.3, [0.5, -0.95, -2.56], 0);
    this.stencil(['WALK ON', 'CATWALK ONLY'], 0.3, [-0.5, -0.95, -2.64], Math.PI);
    this.stencil(['42-31909'], 0.3, [0.68, -0.6, 4.0], -Math.PI / 2, '#d8c86a');
    // data plates, riveted on by the doors and at the stations, and the bottles' and boxes' stencils
    const plate = (lines, w, [x, y, z], rot) => {
      const h = (w / 4) * lines.length + 0.02, n = new V(Math.sin(rot), 0, Math.cos(rot));
      const g = new THREE.BoxGeometry(w + 0.02, h, 0.004).rotateY(rot).translate(x - n.x * 0.003, y, z - n.z * 0.003);
      this.add(MAT.dark, g);
      this.stencil(lines, w, [x + n.x * 0.0005, y, z + n.z * 0.0005], rot, '#cfc8b0');
    };
    plate(['BOEING B-17G-35-BO', 'AAF SER. NO. 42-31909', 'SEATTLE WASH.'], 0.16, [-0.45, -0.95, -1.32], 0);
    plate(['EMERGENCY EXIT', 'PULL HANDLE'], 0.14, [0.62, -1.0, 6.18], Math.PI);
    plate(['FUEL TRANSFER', 'VALVE - DO NOT', 'OPERATE IN FLIGHT'], 0.15, [0.5, -0.55, -2.62], Math.PI);
    plate(['A-12 OXYGEN', 'REGULATOR', '400 PSI MAX'], 0.12, [-0.7, -1.25, 1.2], Math.PI / 2);
    for (const [x, y, z] of [[-0.85, -0.15, -7.05], [0.85, -0.15, -7.05], [0.8, -1.5, -2.2], [0.8, -1.5, -1.95]]) {
      const rot = x < 0 ? Math.PI / 2 : -Math.PI / 2; // (facing into the cabin)
      this.stencil(['OXYGEN'], 0.1, [x - Math.sign(x) * 0.102, y, z], rot, '#1a1a1a');
    }
    for (const s of [-1, 1]) this.stencil(['CAL .50', 'M2 LINKED'], 0.16, [s * 0.32, -2.17, 8.549], Math.PI, '#d8d0a8');
  }

  /** Sunlight falling through the windows: soft shafts that follow the sun as the bomber turns. */
  buildShafts() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,240,210,0.0)'); grd.addColorStop(0.15, 'rgba(255,240,210,1)'); grd.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
    const map = new THREE.CanvasTexture(c);
    this.shafts = [[-1.0, -1.0, 1.78, -1], [1.0, -1.0, 1.82, 1], [-1.0, -1.0, -1.9, -1], [1.0, -1.0, -1.9, 1]].map(([x, y, z, side]) => {
      const geo = new THREE.CylinderGeometry(0.28, 0.45, 2.4, 10, 1, true).translate(0, -1.2, 0); // from the window inwards
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      mesh.position.set(x, y, z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      return { mesh, side };
    });
  }

  /** sunLocal: the direction to the sun in bomber space. A shaft shows when the sun is on its side. */
  updateShafts(sunLocal) {
    if (!this.shafts) this.buildShafts();
    const down = _sd.copy(sunLocal).negate();
    for (const { mesh, side } of this.shafts) {
      mesh.quaternion.setFromUnitVectors(_up, _sd2.copy(down).negate()); // its axis points back up the sun ray
      mesh.material.opacity = 0.05 * THREE.MathUtils.clamp(sunLocal.x * side, 0, 1);
    }
  }

  buildTail() {
    this.box(-0.25, 0.25, -2.32, -2.17, 9.65, 9.95, MAT.leather); // knee pad
    // the tail gunner's compartment (the pod's skin turns to glass while you're in it, so this is what
    // you see): the framed rear window, small side windows, the armour panel with the guns' slot, and
    // the ring sight in front of your eye
    const fz = 10.5, r = 0.014;
    // rear window: one big pane, framed at the pod's edges (outside the gun's arc, so the frame never sits in your sight line)
    for (const [a, b] of [[[-0.33, -1.82, fz], [0.33, -1.82, fz]], [[-0.33, -2.27, fz], [0.33, -2.27, fz]], [[-0.33, -1.82, fz], [-0.33, -2.27, fz]], [[0.33, -1.82, fz], [0.33, -2.27, fz]]]) this.rod(a, b, r, MAT.dark, 5);
    for (const s of [-1, 1]) { // side windows
      const x = s * 0.35;
      for (const [a, b] of [[[x, -1.88, 10.3], [s * 0.31, -1.88, fz]], [[x, -2.15, 10.3], [s * 0.31, -2.15, fz]], [[x, -1.88, 10.3], [x, -2.15, 10.3]]]) this.rod(a, b, r, MAT.dark, 5);
      this.box(s > 0 ? 0.16 : -0.3, s > 0 ? 0.3 : -0.16, -2.55, -2.29, fz - 0.01, fz + 0.02, MAT.metal, false); // armour either side of the slot
    }
    this.box(-0.16, 0.16, -2.6, -2.5, fz - 0.01, fz + 0.02, MAT.metal, false); // under the slot
    this.box(-0.3, 0.3, -2.29, -2.27, fz - 0.02, fz + 0.02, MAT.dark, false); // window sill
    // the ring and bead sight rides on the guns, so it swings with your aim: it's mounted in front of
    // your eye (on the camera) while you're at the tail gun, the bead dead centre like the crosshair
    this.ironSight = new THREE.Group();
    // sized like the real thing as you see it: the ring ~11 degrees across, the bead under 1 degree
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.0009, 5, 48), MAT.dark);
    ring.position.set(0, 0, -0.21);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0016, 0.05, 5), MAT.dark);
    post.position.set(0, -0.0455, -0.212);
    // the front sight: a small open ring (not a solid bead), so the target stays visible in its middle
    const bead = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.00045, 4, 20), MAT.yellow);
    bead.position.set(0, 0, -0.32);
    const beadPost = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0008, 0.04, 4), MAT.dark);
    beadPost.position.set(0, -0.0222, -0.32);
    this.ironSight.add(ring, post, bead, beadPost);
    this.buildTailGlazing();
    this.ballCockpit = buildBallTurret(); // the inside of the ball turret, mounted on the camera while you're in it
    this.topCockpit = buildTopTurret(); // and the upper turret's dome
    this.buildTopDome();
  }

  /**
   * The tail gunner's glazing and fittings, as in the Cheyenne tail of the B-17G: Plexiglas over the
   * pod's windows (a liner that follows the inside of the tail cone, so wherever the skin has a window
   * there is glass in it, seen from inside and out), the thick rear pane in its riveted frame and
   * rubber seal, the canvas boot where the guns go out through the armour, the padding, the oxygen
   * regulator and its hose, the interphone box, a little lamp and the stencils.
   */
  buildTailGlazing() {
    // Plexiglas in the tail cone's open windows. The model leaves them as bare gaps, so they're found
    // here: a sheet following the cone 2 cm outside its skin (so the frames hide it), kept only in the cells the eye can
    // see without metal (skin, frame or pod) in the way.
    const z0 = 9.4, z1 = 10.44, nz = 26, yLo = -2.5, yHi = -1.45, ny = 42; // (the sides: over the top the rear pane covers it, and a sheet there met the eye edge-on)
    const eye = STATIONS.find((x) => x.id === 'tail').eye;
    const solid = [...this.hullMeshes, ...(this.parts.get('TailGunPod') ?? []).slice(0, 1)];
    const rc = new THREE.Raycaster(), wE = new V(eye.x, eye.y, eye.z).applyMatrix4(this.model.matrixWorld);
    const at = (i, k) => { const z = z0 + ((z1 - z0) * i) / nz, y = yLo + ((yHi - yLo) * k) / ny; return [z, y, this.hw(z, y)]; };
    const open = (x, y, z) => {
      const p = new V(x, y, z).applyMatrix4(this.model.matrixWorld), d = p.distanceTo(wE);
      rc.set(wE, p.sub(wE).normalize()); rc.far = d + 0.3;
      return !rc.intersectObjects(solid, false).some((h) => h.distance < d + 0.25 && !holeAt(h));
    };
    // (a hit on a window cut out of the skin's paint isn't metal)
    let holeCtx = new Map();
    const holeAt = (h) => {
      const map = h.object.material.map, img = map?.image;
      if (!img || !h.uv || !h.object.material.alphaTest) return false;
      if (!holeCtx.has(img)) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); holeCtx.set(img, x); }
      const u = ((h.uv.x % 1) + 1) % 1, v = ((h.uv.y % 1) + 1) % 1;
      return holeCtx.get(img).getImageData(Math.floor(u * img.width), Math.floor((map.flipY ? 1 - v : v) * img.height), 1, 1).data[3] < 242;
    };
    const sides = solid.map((o) => o.material.side); solid.forEach((o) => { o.material.side = THREE.DoubleSide; }); // (seen from inside: the skin's back faces count)
    const pos = [], uv = [], idx = [];
    for (const side of [-1, 1]) {
      const id = new Map();
      const vtx = (i, k) => {
        const key = i * 1000 + k;
        if (!id.has(key)) { const [z, y, w] = at(i, k); id.set(key, pos.length / 3); pos.push(side * (w + 0.02), y, z); uv.push(i / nz, k / ny); }
        return id.get(key);
      };
      for (let i = 0; i < nz; i++) for (let k = 0; k < ny; k++) {
        if ([[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]].some(([a, c]) => at(a, c)[2] < 0.02)) continue;
        const [z, y, w] = at(i + 0.5, k + 0.5);
        if (!open(side * (w - 0.02), y, z)) continue; // (metal there)
        const a = vtx(i, k), b = vtx(i + 1, k), c = vtx(i, k + 1), d = vtx(i + 1, k + 1);
        idx.push(a, b, c, b, d, c);
      }
    }
    solid.forEach((o, i) => { o.material.side = sides[i]; });
    const sheet = new THREE.BufferGeometry();
    sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sheet.setIndex(idx); sheet.computeVertexNormals();
    this.tailGlassCells = idx.length / 6;
    // and the rear window across the cone's open end, each row where the cone ends at that height
    const rp = [], ri = [], ru = [], rows = [];
    for (let k = 0; k <= 28; k++) {
      const y = -2.5 + k * 0.05;
      let zEnd = null, w = 0;
      for (let z = 9.6; z <= 10.5; z += 0.02) { const h = this.hw(z, y); if (h > 0.03) { zEnd = z; w = h; } }
      if (zEnd != null) rows.push([w + 0.01, y, zEnd + 0.03]);
    }
    rows.forEach(([w, y, z], k) => { rp.push(-w, y, z, w, y, z); ru.push(0, k / (rows.length - 1), 1, k / (rows.length - 1)); });
    for (let k = 0; k < rows.length - 1; k++) { const a = k * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const rear = new THREE.BufferGeometry();
    rear.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rear.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    rear.setIndex(ri); rear.computeVertexNormals();
    const glass = plexiglas();
    for (const geo of [sheet, rear]) { const gm = new THREE.Mesh(geo, glass); gm.renderOrder = 4; this.group.add(gm); }
    // the pod's own windows: its frame stays solid, and where its paint marks glass there's Plexiglas
    // (it used to be ghosted whole while you sat in it; from the raised seat its frame is out of your sight line)
    const [pod] = this.parts.get('TailGunPod') ?? [];
    if (pod) {
      pod.material = pod.material.alphaTest ? pod.material : windowCutout(pod.material.clone());
      const pg = new THREE.Mesh(pod.geometry, plexiglas(pod.material.map));
      pg.position.copy(pod.position); pg.quaternion.copy(pod.quaternion); pg.scale.copy(pod.scale);
      pg.renderOrder = 4; pg.name = 'TailGunPod_glass';
      pod.parent.add(pg);
    }
    // the rear pane: thick armour glass in the middle of the window, in its riveted frame
    const fz = 10.5, pw = 0.29, ph = 0.2, py = -2.04, gz = fz - 0.04;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(pw * 2, ph * 2, 0.035), glass);
    pane.position.set(0, py, gz);
    pane.renderOrder = 4;
    this.group.add(pane);
    const corners = [[-pw, py - ph], [pw, py - ph], [pw, py + ph], [-pw, py + ph]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      this.rod([ax, ay, gz], [bx, by, gz], 0.012, MAT.metal, 6); // the frame's channel
      this.rod([ax * 0.965, py + (ay - py) * 0.95, gz - 0.004], [bx * 0.965, py + (by - py) * 0.95, gz - 0.004], 0.005, MAT.hose, 5); // rubber seal
      const L = Math.hypot(bx - ax, by - ay);
      for (let t = 0.04; t < L; t += 0.06) { // rivets
        const f = t / L;
        this.add(MAT.metal, new THREE.SphereGeometry(0.004, 5, 3).translate(ax + (bx - ax) * f, ay + (by - ay) * f, gz - 0.014));
      }
    }
    // the canvas boot round the guns where they pass out through the armour, gathered in folds
    const boot = new THREE.CylinderGeometry(0.1, 0.16, 0.12, 16, 3, true).rotateX(Math.PI / 2);
    const bp = boot.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const a = Math.atan2(bp.getY(i), bp.getX(i)), f = 1 + 0.08 * Math.sin(a * 9) * (0.5 + bp.getZ(i) * 4);
      bp.setXY(i, bp.getX(i) * f * 1.3, bp.getY(i) * f * 0.75);
    }
    boot.computeVertexNormals();
    this.add(MAT.canvas, boot.translate(0, -2.36, fz - 0.07));
    // quilted padding on the compartment's walls
    for (const sd of [-1, 1]) {
      const x = sd * (this.hw(9.85, -1.95) - 0.02);
      const g = new THREE.PlaneGeometry(0.5, 0.32); g.rotateY(-sd * Math.PI / 2);
      this.add(MAT.pad, g.translate(x, -1.95, 9.78));
    }
    // the A-12 oxygen regulator, its blinker and hose; the interphone jack box
    const rx = -(this.hw(9.55, -1.8) - 0.04), jx = this.hw(9.55, -1.85) - 0.04;
    this.box(rx - 0.03, rx + 0.03, -1.86, -1.74, 9.5, 9.62, MAT.dark, false);
    this.cylinder(0.022, 0.012, rx + 0.032, -1.8, 9.56, 'x', MAT.metal, 12);
    this.rod([rx + 0.02, -1.86, 9.56], [rx + 0.1, -2.05, 9.7], 0.011, MAT.hose);
    this.box(jx - 0.025, jx + 0.025, -1.9, -1.8, 9.5, 9.58, MAT.green, false);
    this.cylinder(0.008, 0.02, jx - 0.03, -1.83, 9.54, 'x', MAT.metal, 8);
    // a small lamp on the roof, and the seat cushion he half sits on
    this.cylinder(0.03, 0.025, 0, this.ceilingAt(9.45, 0, -2.3) - 0.02, 9.45, 'y', MAT.dark, 10);
    this.box(-0.15, 0.15, -2.06, -1.99, 9.5, 9.66, MAT.leather, false);
    this.stencil(['CAL .50 AMMUNITION'], 0.2, [-0.32, -2.12, 9.151], 0, '#d8d0a8');
    this.stencil(['OXYGEN'], 0.08, [rx + 0.031, -1.765, 9.56], Math.PI / 2, '#d8c86a');
    this.stencil(['INTERPHONE'], 0.07, [jx - 0.026, -1.88, 9.54], -Math.PI / 2, '#e8e2c8');
  }

  /**
   * The top turret's glass dome as seen from inside the bomber (from below, through the ring): the
   * same dome you have round your head in the turret, fixed on the ring and turned with the turret,
   * so you see the engineer's head and shoulders up in the glass and the sky beyond. (Hidden while
   * you're in the turret yourself: then it's on your camera.)
   */
  buildTopDome() {
    const s = STATIONS.find((x) => x.id === 'top');
    this.topDome = buildTopTurret();
    this.topDome.remove(this.topDome.children[1]); // (not the gunsight: that rides with the gunner's head)
    this.topDome.position.copy(s.eye);
    this.group.add(this.topDome);
  }
}
