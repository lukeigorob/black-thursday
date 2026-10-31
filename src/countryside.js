// The villages and towns of the Franconian countryside, where the ground's layout put them (ground.js: every
// 2-3 km, down in the valleys by the water, the roads running between them). Each is its painted plan
// (villages.js: one atlas, one instanced quad each, a few hundred of them in one draw call) lying on the
// fields; the ones near you also stand up in 3D, the same houses on the same plan: walls, a tiled roof, the
// church tower and its spire. The layout wraps every 82 km: each place is shown at its copy nearest to you.
import * as THREE from 'three';
import { snowy } from './environment.js';
import { MACRO, aerial } from './ground.js';
import { paintAtlas, BY_KIND, ATLAS } from './villages.js';
import { mainZ } from './river.js';

const KEEP_OUT = 6500; // m round the target: the city has its own outskirts (city.js)
const NEAR_R = 6500; // m: the villages this close to you are built in 3D
const POOL = 9000, SPIRES = 64; // 3D buildings and spires at most

/** A unit gable roof: ridge along Z, eaves at y 0, ridge at y 1. */
function gable() {
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

const WALL = [null, [0xa89c82, 0x9c8e74, 0xb0a48b, 0x8f826a, 0xa3967c], [0x7a6b55, 0x6e604c, 0x82745c], [0xb3a890, 0xa79c85]];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0), _f = new THREE.Vector3();

export class Countryside {
  /** drift: the turning ground's group (world.js); groundY: the ground's height in it; layout: ground.js's. */
  constructor(drift, groundY, layout) {
    this.group = new THREE.Group(); // (moved as the ground scrolls; the layout's 0, 0 is at its origin)
    this.group.position.y = groundY;
    drift.add(this.group);
    const atlas = paintAtlas();
    this.paintMs = atlas.ms;
    this.plans = atlas.plans;
    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const n = layout.villages.length;
    // the plans on the ground: one quad each, its cell of the atlas
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const cells = new Float32Array(n * 4);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4));
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color(1.05, 1.02, 1.0), roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uv * aCell.zw + aCell.xy;');
    };
    mat.customProgramCacheKey = () => 'village-atlas';
    this.decals = new THREE.InstancedMesh(geo, aerial(snowy(mat, 0.62)), n);
    this.decals.frustumCulled = false; this.decals.renderOrder = 1;
    this.group.add(this.decals);
    // the near ones in 3D
    const mesh = (g, m, k) => { const x = new THREE.InstancedMesh(g, aerial(snowy(m)), k); x.frustumCulled = false; x.receiveShadow = true; x.setMatrixAt(0, _m.makeScale(0, 0, 0)); x.count = 1; this.group.add(x); return x; }; // (one hidden till the first near village: its shader made behind the loading screen)
    this.walls = mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), POOL);
    this.roofs = mesh(gable(), new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), POOL);
    this.spires = mesh(new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a5a52, roughness: 0.6, metalness: 0.25 }), SPIRES);
    for (const m of [this.walls, this.roofs]) { m.setColorAt(0, _c.set(0xffffff)); }
    // the places: the layout's villages, each its plan and turn
    this.places = layout.villages.map((v, i) => {
      const plan = BY_KIND[v.kind][v.variant % BY_KIND[v.kind].length];
      cells.set(this.plans[plan].cell, i * 4);
      return { i, kind: v.kind, plan, turn: v.turn, tx: v.x, tz: v.z, x: v.x, z: v.z, shown: null, ox: NaN, oz: NaN };
    });
    this.near = '';
    this.next = 0;
    this.keepOut = null;
    for (const p of this.places) this.put(p, 0, 0);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Set place p at its copy nearest (fx, fz) (the ground's frame), hidden if the target town is there. */
  put(p, fx, fz) {
    const x = p.tx + MACRO * Math.round((fx - p.tx) / MACRO), z = p.tz + MACRO * Math.round((fz - p.tz) / MACRO);
    const k = this.keepOut, gp = this.group.position;
    const cx = x + gp.x - (k?.x ?? 0), cz = z + gp.z - (k?.z ?? 0); // (from the target town: it and its river kept clear)
    const hide = !!k && (Math.hypot(cx, cz) < KEEP_OUT || (Math.abs(cx) < 31000 && Math.abs(cz - mainZ(cx)) < 450));
    if (x === p.x && z === p.z && p.shown === !hide) return false;
    p.x = x; p.z = z; p.shown = !hide;
    const s = this.plans[p.plan].size;
    this.decals.setMatrixAt(p.i, hide ? _m.makeScale(0, 0, 0) : _m.compose(_p.set(x, 0, z), _q.setFromAxisAngle(_up, p.turn), _s.set(s, 1, s)));
    return true;
  }

  /**
   * Each frame: (sx, sz) the ground's move this frame (world.update); keepOut: where the target city is, in
   * the same frame; focus: where you are (in the scene). The places re-placed a few a frame (they move
   * across the wrap far off), the near ones built in 3D.
   */
  update(sx, sz, keepOut = null, focus = null) {
    this.group.position.x += sx; this.group.position.z += sz;
    this.keepOut = keepOut;
    const gp = this.group.position;
    let fx = -gp.x, fz = -gp.z;
    if (focus && this.group.parent) { this.group.parent.worldToLocal(_f.copy(focus)); fx = _f.x - gp.x; fz = _f.z - gp.z; }
    let moved = false;
    for (let k = 0; k < 40; k++) { const p = this.places[(this.next = (this.next + 1) % this.places.length)]; moved = this.put(p, fx, fz) || moved; }
    if (moved) this.decals.instanceMatrix.needsUpdate = true;
    if ((this.tick = (this.tick ?? 0) + 1) % 20 === 0) this.build3D(fx, fz);
  }

  /** Stand up in 3D the villages nearest (fx, fz), as many as the pool holds (nothing done if they're the same ones). */
  build3D(fx, fz) {
    const near = this.places.filter((p) => p.shown && Math.hypot(p.x - fx, p.z - fz) < NEAR_R + this.plans[p.plan].size / 2)
      .sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz));
    const key = near.map((p) => `${p.i}@${p.x},${p.z}`).join('|');
    if (key === this.near) return;
    this.near = key;
    let n = 0, ns = 0;
    for (const p of near) {
      const plan = this.plans[p.plan], c = Math.cos(p.turn), s = Math.sin(p.turn);
      for (const b of plan.buildings) {
        if (n >= POOL) break;
        const x = p.x + b.x * c + b.z * s, z = p.z - b.x * s + b.z * c, th = Math.PI / 2 - b.ang + p.turn;
        _q.setFromAxisAngle(_up, th);
        this.walls.setMatrixAt(n, _m.compose(_p.set(x, 0, z), _q, _s.set(b.wid, b.h, b.len)));
        const wc = WALL[b.wall]; this.walls.setColorAt(n, _c.setHex(wc[(n * 7) % wc.length]));
        this.roofs.setMatrixAt(n, b.rh > 0 ? _m.compose(_p.set(x, b.h, z), _q, _s.set(b.wid, b.rh, b.len)) : _m.makeScale(0, 0, 0));
        this.roofs.setColorAt(n, _c.set(b.roof));
        n++;
      }
      for (const sp of plan.spires) {
        if (ns >= SPIRES) break;
        const x = p.x + sp.x * c + sp.z * s, z = p.z - sp.x * s + sp.z * c;
        this.spires.setMatrixAt(ns++, _m.compose(_p.set(x, sp.y, z), _q.identity(), _s.set(sp.r, sp.h, sp.r)));
      }
    }
    this.walls.count = this.roofs.count = n; this.spires.count = ns;
    for (const m of [this.walls, this.roofs, this.spires]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}

export { ATLAS };
