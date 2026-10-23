// The target: a German industrial town of about 2.4 by 2.4 km. Its aircraft factory is the aiming point,
// with the halls, sheds, chimneys and power house of the works round it. A rail yard runs along the
// south of the works. North of the river (three bridges) is the old town round its church spire and
// market square, and housing blocks round green courtyards fill the streets in between, thinning out to
// villas in their gardens, and the town fades into the fields at its edge.
// Every building is one instance (walls, and a roof for the pitched ones), so the town costs a handful
// of draw calls. Bombs wreck what they land near: walls knocked down, roofs gone, rubble charred.
import * as THREE from 'three';
import { AIRSPEED } from './bomber.js';

const V = THREE.Vector3;
export const SIZE = 2400; // m across
const TEX = 2048; // px across the ground texture
export const BLAST = 38; // m: a building this close to a hit is wrecked
export const FACTORY = { x0: -420, x1: 420, z0: -300, z1: 260 }; // the works, round the aiming point (0, 0)
export const RAIL = { z0: 290, z1: 405 };
export const OLD_TOWN = { x: -250, z: -900, r: 300 };
const BRIDGES = [-760, -60, 620];
/** The river's middle line (z) at x, and its width. */
export const riverZ = (x) => -480 + 90 * Math.sin(x / 380) + 40 * Math.sin(x / 150 + 1);
const RIVER_W = 70;

let seed = 1944;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rand = (a, b) => a + rnd() * (b - a);
const pick = (a) => a[Math.floor(rnd() * a.length)];

/** The town's ground; `gardens` = [x, z, w, d] green plots (courtyards, villa gardens). */
function groundTexture(gardens) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');
  const px = (m) => (m / SIZE) * TEX, X = (x) => px(x + SIZE / 2);
  g.fillStyle = '#6b6654'; g.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 1400; i++) { // yards, lots, allotments
    g.fillStyle = ['#625f4c', '#716b5a', '#5d6343', '#6f6a58'][i % 4];
    g.fillRect(rnd() * TEX, rnd() * TEX, 6 + rnd() * 30, 6 + rnd() * 30);
  }
  for (const [x, z, w, d] of gardens) { // courtyards and gardens
    g.fillStyle = pick(['#55613d', '#5c6842', '#4e5a38']);
    g.fillRect(X(x - w / 2), X(z - d / 2), px(w), px(d));
  }
  g.strokeStyle = '#8a8577'; // streets: a grid between the blocks, pale on the dark ground
  g.lineWidth = px(14);
  for (let k = -SIZE / 2; k <= SIZE / 2; k += 130) {
    g.beginPath(); g.moveTo(X(k - 65), 0); g.lineTo(X(k - 65), TEX); g.stroke();
    g.beginPath(); g.moveTo(0, X(k - 65)); g.lineTo(TEX, X(k - 65)); g.stroke();
  }
  // the works: concrete aprons
  g.fillStyle = '#77736a'; g.fillRect(X(FACTORY.x0), X(FACTORY.z0), px(FACTORY.x1 - FACTORY.x0), px(FACTORY.z1 - FACTORY.z0));
  // the old town: narrow winding lanes on darker ground
  g.fillStyle = '#58544b'; g.beginPath(); g.arc(X(OLD_TOWN.x), X(OLD_TOWN.z), px(OLD_TOWN.r + 30), 0, 7); g.fill();
  g.strokeStyle = '#7f7a6d'; g.lineWidth = px(7);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath(); g.moveTo(X(OLD_TOWN.x), X(OLD_TOWN.z));
    g.quadraticCurveTo(X(OLD_TOWN.x + Math.cos(a + 0.3) * 160), X(OLD_TOWN.z + Math.sin(a + 0.3) * 160), X(OLD_TOWN.x + Math.cos(a) * 330), X(OLD_TOWN.z + Math.sin(a) * 330));
    g.stroke();
  }
  g.fillStyle = '#9a9483'; g.beginPath(); g.arc(X(OLD_TOWN.x), X(OLD_TOWN.z + 40), px(38), 0, 7); g.fill(); // the market square
  // the rail yard: tracks fanning out of the line
  g.fillStyle = '#4c4a44'; g.fillRect(0, X(RAIL.z0), TEX, px(RAIL.z1 - RAIL.z0));
  g.strokeStyle = '#2f2e2b'; g.lineWidth = px(2.2);
  for (let k = 0; k < 14; k++) { const z = RAIL.z0 + 8 + k * 7.5; g.beginPath(); g.moveTo(0, X(z)); g.lineTo(TEX, X(z)); g.stroke(); }
  // the river, with its banks
  for (const [w, col] of [[RIVER_W + 16, '#4f5646'], [RIVER_W, '#34424a']]) {
    g.strokeStyle = col; g.lineWidth = px(w); g.beginPath();
    for (let x = -SIZE / 2; x <= SIZE / 2; x += 20) g[x === -SIZE / 2 ? 'moveTo' : 'lineTo'](X(x), X(riverZ(x)));
    g.stroke();
  }
  // the town thins out into the fields: its edge fades, so there's no hard square
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(TEX / 2, TEX / 2, TEX * 0.38, TEX / 2, TEX / 2, TEX * 0.5);
  edge.addColorStop(0, '#000'); edge.addColorStop(1, '#0000');
  g.fillStyle = edge; g.fillRect(0, 0, TEX, TEX);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A unit gable roof: ridge along Z, eaves at y 0, ridge at y 1. */
function gable() {
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

export class City {
  constructor(scene, center) {
    seed = 1944;
    this.center = center; // the aiming point, on the ground, in the formation's frame
    this.group = new THREE.Group();
    const b = (this.buildings = []), gardens = [], trees = [];
    // [x, z, w, d, h, colour, roof colour or null (flat), roof height]
    const add = (x, z, w, d, h, col, roof = null, rh = 0) => b.push({ x, z, w, d, h, col, roof, rh, alive: true });
    const PLASTER = [0xb5a888, 0xa69676, 0xbfb49a, 0x978b75, 0xab9b7e], TILE = [0x7e4230, 0x6e3a2a, 0x664034], SLATE = [0x3d3f44, 0x46484b, 0x4a423c];
    const BRICK = [0x7a5444, 0x6c4a3c, 0x85624f], WORKS = [0x8a8478, 0x7c7a72, 0x96907f];

    // the works: big assembly halls with low pitched roofs, long sheds, workshops, chimneys, a power house
    for (const z of [-170, -60]) for (const x of [-300, -100, 100, 300]) add(x, z, 130, 55, 16, pick(WORKS), 0x50524f, 4);
    for (const x of [-280, -60, 160]) add(x, 80, 180, 35, 12, pick(WORKS), 0x5b5c58, 3);
    add(360, 185, 60, 40, 26, pick(BRICK));
    for (let i = 0; i < 6; i++) add(rand(-380, 380), rand(130, 240), 6, 6, rand(40, 60), 0x6a4a3c);
    for (let i = 0; i < 40; i++) add(rand(-400, 300), rand(150, 245), rand(15, 40), rand(10, 25), rand(6, 10), pick(WORKS));
    for (let i = 0; i < 20; i++) add(rand(-400, 400), rand(-290, -240), rand(12, 30), rand(8, 18), rand(5, 9), pick(WORKS));

    // the rail yard: wagons on the tracks, the goods sheds and the engine shed
    for (let i = 0; i < 150; i++) add(rand(-1000, 1000), RAIL.z0 + 8 + Math.floor(rand(0, 14)) * 7.5, rand(10, 15), 3, 3.6, pick([0x5a3a2c, 0x4a4038, 0x3c3a36]));
    add(-700, RAIL.z1 + 22, 140, 26, 9, pick(BRICK), 0x4d5056, 4);
    add(720, RAIL.z1 + 25, 90, 34, 14, pick(BRICK), 0x44464a, 5);

    // the old town: crowded houses with steep tiled roofs, the church and its spire on the market
    const OT = OLD_TOWN;
    for (let x = OT.x - OT.r; x <= OT.x + OT.r; x += 19) for (let z = OT.z - OT.r; z <= OT.z + OT.r; z += 17) {
      const hx = x + rand(-3, 3), hz = z + rand(-3, 3);
      const d = Math.hypot(hx - OT.x, hz - OT.z);
      const a = Math.atan2(hz - OT.z, hx - OT.x), edge = OT.r * (0.84 + 0.1 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7)); // a ragged edge, not a circle
      if (d > edge || Math.hypot(hx - OT.x, hz - OT.z - 40) < 48 || Math.hypot(hx - OT.x, hz - OT.z + 30) < 45 || rnd() < 0.12) continue;
      add(hx, hz, rand(10, 16), rand(9, 13), rand(9, 15), pick(PLASTER), pick(TILE), rand(5, 7));
    }
    add(OT.x, OT.z - 30, 22, 60, 20, 0xb9ad94, 0x4f4a44, 12); // the nave
    this.church = b.length;
    add(OT.x, OT.z - 66, 13, 13, 46, 0xb9ad94); // the tower (its spire is a mesh of its own)

    // housing blocks round courtyards on the street grid, thinning to villas out at the edge
    for (let cx = -SIZE / 2 + 65; cx < SIZE / 2; cx += 130) for (let cz = -SIZE / 2 + 65; cz < SIZE / 2; cz += 130) {
      if (cx > FACTORY.x0 - 60 && cx < FACTORY.x1 + 60 && cz > FACTORY.z0 - 60 && cz < FACTORY.z1 + 40) continue;
      if (cz > RAIL.z0 - 40 && cz < RAIL.z1 + 70) continue;
      if (Math.hypot(cx - OT.x, cz - OT.z) < OT.r + 70) continue;
      if (Math.abs(cz - riverZ(cx)) < RIVER_W / 2 + 60) continue;
      const out = Math.hypot(cx, cz);
      if (out > 1120) continue; // (the ground fades out here)
      if (out > 820) { // villas in their gardens
        gardens.push([cx, cz, 104, 104]);
        for (let k = 0; k < 4; k++) {
          const x = cx + rand(-38, 38), z = cz + rand(-38, 38);
          if (rnd() < 0.75) add(x, z, rand(9, 13), rand(9, 12), rand(6, 8), pick(PLASTER), pick(TILE), rand(3, 5));
          trees.push([x + rand(-14, 14), z + rand(-14, 14), rand(4, 7)]);
        }
        continue;
      }
      const col = pick(PLASTER), roof = rnd() < 0.7 ? pick(SLATE) : pick(TILE), L = 100, D = 14, gap = Math.floor(rand(0, 6)); // (a side missing now and then)
      const sides = [[cx, cz - (L - D) / 2, L, D], [cx, cz + (L - D) / 2, L, D], [cx - (L - D) / 2, cz, D, L - 2 * D], [cx + (L - D) / 2, cz, D, L - 2 * D]];
      sides.forEach(([x, z, w, d], k) => { if (k !== gap) add(x, z, w, d, rand(14, 21), col, roof, 5); });
      gardens.push([cx, cz, L - 2 * D - 4, L - 2 * D - 4]);
      for (let k = 0; k < 3; k++) trees.push([cx + rand(-28, 28), cz + rand(-28, 28), rand(4, 6)]);
    }
    // the bridges over the river
    for (const x of BRIDGES) add(x, riverZ(x), 16, RIVER_W + 40, 4, 0x8a8478);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ map: groundTexture(gardens), roughness: 1, transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.5;
    ground.receiveShadow = true;
    this.group.add(ground);
    // trees in the courtyards and gardens
    const wood = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), trees.length);
    const tm = new THREE.Matrix4(), tc = new THREE.Color();
    trees.forEach(([x, z, r], i) => {
      wood.setMatrixAt(i, tm.makeScale(r, r * 1.2, r).setPosition(x, 0, z));
      wood.setColorAt(i, tc.setHex(pick([0x3d4f2a, 0x46592e, 0x37472a])));
    });
    wood.frustumCulled = false;
    this.group.add(wood);
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), b.length);
    const roofs = new THREE.InstancedMesh(gable(), new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), b.length);
    for (const m of [walls, roofs]) { m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); }
    Object.assign(this, { walls, roofs, _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _c: new THREE.Color() });
    b.forEach((x, i) => this.place(i));
    // the church spire
    const tower = b[this.church];
    this.spire = new THREE.Mesh(new THREE.ConeGeometry(7.5, 34, 8).translate(0, 17, 0), new THREE.MeshStandardMaterial({ color: 0x3f5a50, roughness: 0.6, metalness: 0.3 }));
    this.spire.position.set(tower.x, tower.h, tower.z);
    this.group.add(this.spire);

    this.group.position.copy(center);
    scene.add(this.group);
    this.burning = [];
  }

  place(i) {
    const b = this.buildings[i], m = this._m, c = this._c;
    const turn = b.w > b.d; // the ridge runs along the long side
    m.compose(_p.set(b.x, 0, b.z), this._q.identity(), _s.set(b.w, b.alive ? b.h : b.h * 0.15, b.d));
    this.walls.setMatrixAt(i, m);
    this.walls.setColorAt(i, b.alive ? c.setHex(b.col) : c.setHex(0x2e2a26));
    if (b.roof && b.alive) {
      this._q.setFromAxisAngle(_up, turn ? Math.PI / 2 : 0);
      m.compose(_p.set(b.x, b.h, b.z), this._q, _s.set(turn ? b.d : b.w, b.rh, turn ? b.w : b.d));
      this.roofs.setColorAt(i, c.setHex(b.roof));
    } else m.makeScale(0, 0, 0);
    this.roofs.setMatrixAt(i, m);
    for (const x of [this.walls, this.roofs]) {
      x.instanceMatrix.needsUpdate = true;
      if (x.instanceColor) x.instanceColor.needsUpdate = true;
    }
  }

  get destroyed() { return this.buildings.filter((b) => !b.alive).length; }

  /** A bomb burst at p: wreck what's close. Returns how many buildings it took. */
  blast(p) {
    let n = 0;
    const lx = p.x - this.center.x, lz = p.z - this.center.z;
    this.buildings.forEach((b, i) => {
      if (!b.alive) return;
      const dx = Math.max(Math.abs(lx - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(lz - b.z) - b.d / 2, 0);
      if (dx < BLAST && dz < BLAST && Math.hypot(dx, dz) < BLAST) {
        b.alive = false; this.place(i); n++;
        this.burning.push({ i, t: rand(40, 90), e: 0 });
        if (i === this.church) this.spire.visible = false;
      }
    });
    return n;
  }

  update(dt, effects) {
    this.center.z += AIRSPEED * dt;
    this.group.position.copy(this.center);
    // wrecked buildings burn and smoke for a while (a few dozen fires at a time, spread through the list)
    const step = Math.max(1, Math.ceil(this.burning.length / 50));
    for (let k = this.burning.length - 1; k >= 0; k--) {
      const f = this.burning[k];
      if ((f.t -= dt) <= 0) { this.burning.splice(k, 1); continue; }
      if (k % step || (f.e -= dt * step) > 0) continue;
      f.e = rand(0.4, 0.9);
      const b = this.buildings[f.i];
      effects.groundSmoke(_p.copy(this.center).add(_s.set(b.x, b.h * 0.15, b.z)).clone());
    }
  }

  /** What the mission map draws, in the town's own frame (m, aiming point at 0, 0). */
  get layout() {
    return { size: SIZE, factory: FACTORY, rail: RAIL, oldTown: OLD_TOWN, riverZ, riverW: RIVER_W, bridges: BRIDGES };
  }
}

const _p = new V(), _s = new V(), _up = new V(0, 1, 0);
