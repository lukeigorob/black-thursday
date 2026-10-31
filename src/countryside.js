// The Franconian countryside five miles down: villages every few kilometres and now and then a small
// town, each a knot of red-roofed houses along its lanes round a church, its gardens and orchards round
// it. They ride on the scrolling ground (in drift, as the clouds do) and the ones gone by behind are set
// down again far ahead. All of them in a handful of draw calls: walls, roofs, spires and the four kinds
// of village plan (their lanes and gardens painted on the ground) each one instanced mesh.
import * as THREE from 'three';
import { snowy } from './environment.js';

const AHEAD = 42000, BEHIND = 9000, SIDE = 26000; // m: the stretch of country kept dotted with them
const PLACES = 46, HOUSES = 240; // villages kept; houses a place at most (a town has the most)
const MIN_APART = 2600; // m between two places
const KEEP_OUT = 6500; // m round the target: the city has its own outskirts (city.js)
const PLAN_PX = 512;

let seed = 1943;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rand = (a, b) => a + rnd() * (b - a);
const pick = (a) => a[Math.floor(rnd() * a.length)];

/**
 * A village's plan: its lanes (straight-ish lines out from the middle, a loop now and then), where the
 * houses go along them, and its church in the middle. In metres from the middle; size: across.
 */
function makePlan(kind) {
  const size = kind === 'town' ? 1500 : kind === 'village' ? 760 : 460;
  const lanes = [], houses = [];
  const arms = kind === 'town' ? 6 : kind === 'village' ? 4 : 2;
  const a0 = rand(0, Math.PI);
  for (let i = 0; i < arms; i++) {
    const a = a0 + (i / arms) * Math.PI * 2 + rand(-0.35, 0.35), len = size * rand(0.32, 0.46), bend = rand(-0.4, 0.4);
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8, aa = a + bend * t; pts.push([Math.cos(aa) * len * t, Math.sin(aa) * len * t]); }
    lanes.push(pts);
  }
  if (kind !== 'hamlet') { // a ring lane round the middle (a town's old wall line)
    const r = size * (kind === 'town' ? 0.16 : 0.11), pts = [];
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; pts.push([Math.cos(a) * r * (1 + 0.15 * Math.sin(a * 3)), Math.sin(a) * r]); }
    lanes.push(pts);
  }
  // houses along the lanes, close in the middle and spacing out towards the ends, both sides, gables to the lane
  const want = kind === 'town' ? HOUSES : kind === 'village' ? 110 : 34;
  for (let n = 0; houses.length < want && n < want * 6; n++) {
    const lane = pick(lanes), k = Math.floor(Math.pow(rnd(), kind === 'town' ? 0.7 : 1.2) * (lane.length - 1)), t = rnd();
    const [x0, z0] = lane[k], [x1, z1] = lane[k + 1];
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, dir = Math.atan2(z1 - z0, x1 - x0), side = rnd() < 0.5 ? -1 : 1, off = rand(11, 20);
    const hx = x - Math.sin(dir) * off * side, hz = z + Math.cos(dir) * off * side;
    if (houses.some((h) => Math.hypot(h.x - hx, h.z - hz) < 13)) continue;
    houses.push({ x: hx, z: hz, rot: dir + (rnd() < 0.6 ? Math.PI / 2 : 0), w: rand(9, 14), d: rand(8, 11), h: rand(6, 9), barn: rnd() < 0.25 });
  }
  return { kind, size, lanes, houses };
}

/** The plan painted on the ground: fields round it fading out, orchards and gardens, the lanes, the churchyard. */
function planTexture(plan) {
  const c = document.createElement('canvas');
  c.width = c.height = PLAN_PX;
  const g = c.getContext('2d'), s = PLAN_PX / plan.size, X = (m) => PLAN_PX / 2 + m * s;
  g.clearRect(0, 0, PLAN_PX, PLAN_PX);
  // gardens and orchards behind the houses: darker green, a little ragged
  for (const h of plan.houses) {
    g.fillStyle = pick(['#4b5634', '#556039', '#48512f', '#5c5a3c']);
    g.beginPath(); g.arc(X(h.x), X(h.z), 26 * s * rand(0.7, 1.3), 0, 7); g.fill();
  }
  // the built-up ground: yards and farmyards round the houses
  for (const h of plan.houses) { g.fillStyle = pick(['#766f5e', '#6f6858', '#7c7461']); g.beginPath(); g.arc(X(h.x), X(h.z), 24 * s, 0, 7); g.fill(); }
  // the roofs, sheds and barns as seen from five miles up (the houses themselves stand on these: close to,
  // they're what you see; from the bombers, this is the village)
  for (const h of plan.houses) {
    for (let k = 0; k < 3; k++) {
      g.fillStyle = pick(['#7e4a36', '#8a5038', '#6c4031', '#57524b', '#7a5a46']);
      const w = (k ? rand(6, 10) : h.w) * s, d = (k ? rand(5, 8) : h.d) * s;
      g.fillRect(X(h.x + (k ? rand(-14, 14) : 0)) - w / 2, X(h.z + (k ? rand(-14, 14) : 0)) - d / 2, w, d);
    }
  }
  // the lanes: pale, unmetalled
  g.strokeStyle = '#a49c86'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const lane of plan.lanes) {
    g.lineWidth = Math.max(1.5, (plan.kind === 'town' ? 9 : 6) * s);
    g.beginPath(); lane.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](X(x), X(z))); g.stroke();
  }
  // the square and churchyard in the middle
  g.fillStyle = '#8f8873'; g.beginPath(); g.arc(X(0), X(0), (plan.kind === 'town' ? 46 : 24) * s, 0, 7); g.fill();
  // fade out at the edge, so it lies in the fields with no hard square
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(PLAN_PX / 2, PLAN_PX / 2, PLAN_PX * 0.3, PLAN_PX / 2, PLAN_PX / 2, PLAN_PX * 0.5);
  edge.addColorStop(0, '#000'); edge.addColorStop(1, '#0000');
  g.fillStyle = edge; g.fillRect(0, 0, PLAN_PX, PLAN_PX);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A unit gable roof: ridge along Z, eaves at y 0, ridge at y 1. */
function gable() {
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

const PLASTER = [0xb8ab8c, 0xa99a7a, 0xc2b79d, 0x9c907a, 0xb0a283], TILE = [0x82432f, 0x733c2a, 0x6b4234, 0x8a4c35];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);

export class Countryside {
  /** drift: the turning ground's group (world.js); groundY: the ground's height in it. */
  constructor(drift, groundY) {
    seed = 1943;
    this.group = new THREE.Group(); // (moved as the ground scrolls; the places in it are set where they belong)
    this.group.position.y = groundY;
    drift.add(this.group);
    // the kinds of place: hamlets and villages mostly, now and then a small town
    this.plans = [makePlan('hamlet'), makePlan('village'), makePlan('village'), makePlan('town')];
    this.decals = this.plans.map((p) => {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2),
        snowy(new THREE.MeshStandardMaterial({ map: planTexture(p), roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 0.85), PLACES);
      m.count = 0; m.renderOrder = 1; m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    const mesh = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); return m; };
    this.walls = mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), snowy(new THREE.MeshStandardMaterial({ roughness: 0.9 })), PLACES * HOUSES);
    this.roofs = mesh(gable(), snowy(new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide })), PLACES * HOUSES);
    this.towers = mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), snowy(new THREE.MeshStandardMaterial({ color: 0xbdb196, roughness: 0.9 })), PLACES);
    this.spires = mesh(new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a5a52, roughness: 0.6, metalness: 0.25 }), PLACES);
    this.places = [];
    this.keepOut = null;
    // dotted over the whole stretch from the start
    for (let i = 0; i < PLACES; i++) {
      const p = { i, kind: 0, x: 0, z: 0 };
      this.places.push(p);
      this.put(p, rand(-AHEAD, BEHIND));
    }
  }

  /**
   * Set place p down `along` m along the track (- ahead, + behind), somewhere across it, clear of the
   * others and the target; build its houses there. dir: the way the ground's going by, in the group's frame.
   */
  put(p, along, dir = this.dir ?? _p.set(0, 0, 1)) {
    const fx = dir.x, fz = dir.z, ox = this.group.position.x, oz = this.group.position.z;
    let x = 0, z = 0;
    for (let tries = 0; tries < 12; tries++) {
      const across = rand(-SIDE, SIDE), a = along + rand(-1500, 1500);
      x = fx * a - fz * across - ox; z = fz * a + fx * across - oz; // (in the group's own frame)
      const ok = this.places.every((q) => q === p || q.x === undefined || Math.hypot(q.x - x, q.z - z) > MIN_APART)
        && (!this.keepOut || Math.hypot(x + ox - this.keepOut.x, z + oz - this.keepOut.z) > KEEP_OUT);
      if (ok) break;
    }
    const r = rnd(), kind = r < 0.3 ? 0 : r < 0.92 ? 1 + (r < 0.6 ? 0 : 1) : 3, plan = this.plans[kind], turn = rand(0, Math.PI * 2);
    Object.assign(p, { kind, x, z, turn });
    // its ground plan (each kind of plan its own mesh: this place's slot in its own, the rest of its slots in the others hidden)
    this.decals.forEach((m, k) => {
      m.setMatrixAt(p.i, k === kind ? _m.compose(_p.set(x, 0, z), _q.setFromAxisAngle(_up, turn), _s.set(1, 1, 1)) : _m.makeScale(0, 0, 0));
      m.count = PLACES; m.instanceMatrix.needsUpdate = true;
    });
    // its houses: walls and a tiled roof each, a barn now and then (bigger, darker, a lower wall)
    const cos = Math.cos(turn), sin = Math.sin(turn);
    for (let k = 0; k < HOUSES; k++) {
      const h = plan.houses[k], i = p.i * HOUSES + k;
      if (!h) { this.walls.setMatrixAt(i, _m.makeScale(0, 0, 0)); this.roofs.setMatrixAt(i, _m); continue; }
      const hx = x + h.x * cos + h.z * sin, hz = z - h.x * sin + h.z * cos, w = h.barn ? h.w * 1.6 : h.w, d = h.barn ? h.d * 1.3 : h.d, ht = h.barn ? h.h * 0.8 : h.h;
      _q.setFromAxisAngle(_up, h.rot + turn);
      this.walls.setMatrixAt(i, _m.compose(_p.set(hx, 0, hz), _q, _s.set(w, ht, d)));
      this.walls.setColorAt(i, _c.setHex(h.barn ? 0x7d6a52 : pick(PLASTER)));
      this.roofs.setMatrixAt(i, _m.compose(_p.set(hx, ht, hz), _q, _s.set(w, ht * 0.75, d)));
      this.roofs.setColorAt(i, _c.setHex(h.barn ? 0x5e5248 : pick(TILE)));
    }
    // the church: its tower and spire by the square (a hamlet has a chapel at most)
    const big = kind === 3, tw = big ? 11 : 7, th = big ? 34 : kind === 0 ? 0 : 22;
    this.towers.setMatrixAt(p.i, th ? _m.compose(_p.set(x + 18 * cos, 0, z - 18 * sin), _q.identity(), _s.set(tw, th, tw)) : _m.makeScale(0, 0, 0));
    this.spires.setMatrixAt(p.i, th ? _m.compose(_p.set(x + 18 * cos, th, z - 18 * sin), _q, _s.set(tw * 0.62, th * 0.8, tw * 0.62)) : _m.makeScale(0, 0, 0));
    for (const m of [this.walls, this.roofs, this.towers, this.spires]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  /**
   * Each frame: (sx, sz) the ground's move this frame (world.update). keepOut: where the target city is, in
   * the same frame (none set down near it). Places gone by far behind are set down again far ahead.
   */
  update(sx, sz, keepOut = null) {
    this.group.position.x += sx; this.group.position.z += sz;
    this.keepOut = keepOut;
    const len = Math.hypot(sx, sz);
    if (len < 1e-6) return;
    const dir = (this.dir ??= new THREE.Vector3()).set(sx / len, 0, sz / len);
    // (a few a frame looked at: plenty, they go by slowly)
    for (let n = 0; n < 4; n++) {
      const p = this.places[(this.next = ((this.next ?? 0) + 1) % PLACES)];
      const wx = p.x + this.group.position.x, wz = p.z + this.group.position.z, along = wx * dir.x + wz * dir.z;
      if (along > BEHIND) this.put(p, along - AHEAD - BEHIND + rand(-2000, 0), dir);
      else if (keepOut && Math.hypot(wx - keepOut.x, wz - keepOut.z) < KEEP_OUT * 0.8) this.put(p, -AHEAD + rand(0, 4000), dir); // (the city coming: move out of its way)
    }
  }
}
