// The walkable inside of a B-17, lined up with the outer model.
// - Walls: the real hull mesh is drawn a second time from the inside with interior paint
//   (the outer skin is made front-face only), so windows and shapes match exactly.
// - The hull's cross-section is measured at load time; the player is kept inside it.
// - Floors, steps, bulkheads, seats and racks are box colliders (Box3) in bomber space.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windowCutout } from './models.js';

const V = THREE.Vector3, D = Math.PI / 180;
const HULL = /^(MainFuselage2|Nose|Tail|TailGunPod|SideGunPanels|FrontGunPanels|TopTurret)$/;

// Floors (bomber space, nose towards -Z), measured from the hull cross-sections.
export const DECKS = [
  { name: 'Nose', z0: -10.4, z1: -8.6, y: -0.72, hw: 0.9 },
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
  { id: 'pilot', name: 'Pilot seat', stand: [-0.18, -0.40, -7.2], eye: [-0.55, 0.62, -7.7], yaw: 0, yawLim: 120, pitch: [-40, 40], seat: true, flies: true },
  { id: 'copilot', name: 'Co-pilot seat', stand: [0.18, -0.40, -7.2], eye: [0.55, 0.62, -7.7], yaw: 0, yawLim: 120, pitch: [-40, 40], seat: true, flies: true },
  { id: 'top', name: 'Top turret', stand: [0, -0.28, -6.78], eye: [0, 1.4, -6.71], yaw: 0, yawLim: 180, pitch: [-5, 85], guns: ['TopGuns'],
    pivot: [0, 1.43, -6.71], turret: { yaw: ['TopTurret'] }, ghost: ['TopTurret'] },
  { id: 'ball', name: 'Ball turret', stand: [0, -1.95, 0.6], eye: [0, -2.42, -0.1], yaw: 0, yawLim: 180, pitch: [-89, 5], guns: ['GunBarrel004', 'GunBarrel14'],
    pivot: [0, -2.15, -0.13], turret: { full: ['BallTurret'], yaw: ['BallStabilizer1'] }, ghost: ['BallTurret', 'BallStabilizer1', 'BallTurretTracks'] },
  { id: 'waistL', name: 'Left waist gun', stand: [-0.3, -1.95, 1.75], eye: [-0.93, -0.98, 1.78], yaw: 90, yawLim: 75, pitch: [-55, 50], guns: ['GunBarrel10'], ghost: ['SideGunPanels', 'LateralGunPivots'] }, // in the window, over the gun
  { id: 'waistR', name: 'Right waist gun', stand: [0.3, -1.95, 1.85], eye: [0.93, -0.98, 1.82], yaw: -90, yawLim: 75, pitch: [-55, 50], guns: ['GunBarrel005'], ghost: ['SideGunPanels', 'LateralGunPivots'] },
  { id: 'tail', name: 'Tail gun', stand: [0, -2.32, 9.6], eye: [0, -1.95, 10.15], yaw: 180, yawLim: 35, pitch: [-30, 25], guns: ['GunBarrel007', 'GunBarrel12'], hide: ['TailGunPod'] },
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
  floor: std(0x4f4a3f, 0.9),
  metal: std(0x767a70, 0.55, 0.6),
  green: std(0x5d6640, 0.75),
  dark: std(0x232323, 0.6, 0.3),
  leather: std(0x5b3b24, 0.7),
  bomb: std(0x495031, 0.6, 0.2),
  bombBand: std(0xb8932c, 0.6), // only on the bombs, so the whole load can be hidden after the drop
  yellow: std(0xb8932c, 0.6),
  radio: std(0x3d3f38, 0.5, 0.4),
};

function liningMaterial(src, inverted) {
  // interior paint, cut out where the outer skin has windows
  return windowCutout(new THREE.MeshStandardMaterial({
    color: 0x6f7462, roughness: 0.75, metalness: 0.3, envMapIntensity: 0.08,
    side: inverted ? THREE.FrontSide : THREE.BackSide, map: src.map,
  }), false);
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

function gauges() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1c1a'; g.fillRect(0, 0, 512, 160);
  for (let i = 0; i < 14; i++) {
    const x = 40 + (i % 7) * 72, y = 45 + Math.floor(i / 7) * 72;
    g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y, 27, 0, 7); g.fill();
    g.strokeStyle = '#d8d2bd'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 22, 0.7, 5.6); g.stroke();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 18 * Math.cos(i * 1.3), y + 18 * Math.sin(i * 1.3)); g.stroke();
  }
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
    this.boxes = [];
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

    this.bombMeshes = [];
    for (const [mat, geos] of this.geos) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      if (mat === MAT.bomb || mat === MAT.bombBand) this.bombMeshes.push(mesh);
    }
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
    this.geos.get(mat).push(dropDegenerate(geo.index ? geo.toNonIndexed() : geo)); // extrusions are non-indexed
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
      mesh.material = outer;
      const lining = new THREE.Mesh(mesh.geometry, liningMaterial(outer, inverted));
      lining.name = `${mesh.name}_lining`;
      lining.position.copy(mesh.position);
      lining.quaternion.copy(mesh.quaternion);
      lining.scale.copy(mesh.scale);
      lining.receiveShadow = true;
      mesh.parent.add(lining);
      this.parts.get(mesh.name).push(lining);
    }
  }

  /** Hide (or show again) hull parts by name, e.g. the painted tail cap while at the tail gun. */
  setHidden(names, hidden) {
    for (const n of names) for (const m of this.parts.get(n) ?? []) m.visible = !hidden;
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
      this.add(MAT.metal, new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z));
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
    this.box(-0.95, -0.55, f, -0.02, -9.4, -8.85, MAT.green); // navigator's table
    this.box(-0.93, -0.57, -0.02, 0.0, -9.38, -8.87, MAT.floor, false);
    this.box(-0.18, 0.18, f, -0.3, -10.3, -10.08, MAT.leather); // bombardier's seat
    this.box(-0.09, 0.09, f, -0.25, -10.55, -10.42, MAT.metal); // bomb-sight stand
    this.box(-0.11, 0.11, -0.25, -0.02, -10.6, -10.36, MAT.dark, false); // Norden bomb sight
  }

  buildCockpit() {
    const f = -0.40;
    // instrument panel: crawl under it to get into the nose, like the real crawlway
    this.box(-0.98, 0.98, 0.25, 0.8, -8.62, -8.5, MAT.dark);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), new THREE.MeshStandardMaterial({ map: gauges(), roughness: 0.5 }));
    panel.position.set(0, 0.53, -8.495);
    this.group.add(panel);
    this.box(-0.98, 0.98, 0.8, 0.86, -8.75, -8.45, MAT.dark, false); // glare shield
    for (const x of [-0.55, 0.55]) {
      this.box(x - 0.24, x + 0.24, f, f + 0.45, -7.85, -7.35, MAT.leather); // seat
      this.box(x - 0.24, x + 0.24, f + 0.45, f + 1.15, -7.35, -7.25, MAT.leather); // seat back
      this.box(x - 0.04, x + 0.04, f, 0.28, -8.25, -8.15, MAT.metal); // control column
      const wheel = new THREE.TorusGeometry(0.17, 0.025, 8, 24).translate(x, 0.33, -8.2);
      this.add(MAT.dark, wheel);
    }
    // top turret: standing platform, column and ring under the dome
    this.box(-0.32, 0.32, f, f + 0.12, -7.0, -6.55, MAT.metal);
    this.cylinder(0.05, 1.3, 0, 0.5, -6.72, 'y', MAT.metal);
    this.add(MAT.metal, new THREE.TorusGeometry(0.52, 0.04, 8, 32).rotateX(Math.PI / 2).translate(0, 1.15, -6.72));
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
    this.box(-1.0, -0.42, f, -1.05, -2.5, -1.8, MAT.green); // desk
    this.box(-0.95, -0.6, -1.05, -0.55, -2.45, -1.85, MAT.radio); // radio sets
    for (let i = 0; i < 4; i++) this.cylinder(0.025, 0.02, -0.59, -0.75 - (i % 2) * 0.15, -2.3 + Math.floor(i / 2) * 0.3, 'x', MAT.yellow, 10);
    this.box(-0.85, -0.5, f, f + 0.45, -1.72, -1.42, MAT.leather); // operator's chair
  }

  buildWaist() {
    const f = -1.95;
    this.box(-0.36, 0.36, f, -1.2, -0.5, 0.24, null); // ball turret and its support stick up through the floor
    this.add(MAT.metal, new THREE.TorusGeometry(0.5, 0.04, 8, 32).rotateX(Math.PI / 2).translate(0, f + 0.02, -0.13));
    for (const s of [-1, 1]) {
      this.box(s > 0 ? 0.5 : -0.74, s > 0 ? 0.74 : -0.5, f, f + 0.35, 2.75, 3.15, MAT.green); // ammo boxes
      this.cylinder(0.11, 0.55, s * 0.72, -1.15, 0.8, 'y', MAT.yellow); // oxygen bottles
      this.cylinder(0.11, 0.55, s * 0.72, -1.15, 1.05, 'y', MAT.yellow);
    }
  }

  buildTail() {
    this.box(-0.25, 0.25, -2.32, -2.17, 9.65, 9.95, MAT.leather); // knee pad
  }
}
