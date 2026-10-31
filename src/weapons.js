// Browning M2 .50 calibre guns: firing, ballistics (muzzle velocity, gravity, air drag), tracers,
// muzzle flash, ammo, reloading and overheating. The model's guns swing to follow the aim.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRSPEED, PARTS } from './bomber.js';
import { buildBrowning, buildYoke } from './browning.js';
import { insideLight } from './cabinlook.js';
import { turretPoint, turretFloor } from './interior.js';

const V = THREE.Vector3;
const _inv = new THREE.Matrix4();
const tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), tmp4 = new THREE.Vector3(), _inv2 = new THREE.Matrix4(), _ear = new THREE.Vector3();
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Vector3(), _rm = new THREE.Matrix4();
// the parts of the airframe a gun mustn't fire through: wings (from the wing roots), engines, the fin
// and the tailplanes (bomber space; the fuselage itself is kept out of the guns' arcs by their limits)
const AIRFRAME = PARTS.filter((p) => p.kind === 'wing' || p.kind === 'engine' || p.kind === 'tail')
  .flatMap((p) => p.boxes).map((q) => new THREE.Box3(new THREE.Vector3(q[0], q[2], q[4]), new THREE.Vector3(q[1], q[3], q[5])));
const _bi = new THREE.Matrix4(), _bo = new THREE.Vector3(), _bd = new THREE.Vector3(), _br = new THREE.Ray();
const HANDLE_MAT = new THREE.MeshStandardMaterial({ color: 0x1d1b18, roughness: 0.6, metalness: 0.3 }); // black bakelite grips
const UP = new V(0, 1, 0), FWD = new V(0, 0, -1);
const MUZZLE_SPEED = 890; // m/s
const GRAVITY = 9.81;
const DRAG = 0.00025; // simple quadratic drag on the bullet's speed through the air
const WIND = new V(0, 0, AIRSPEED); // the air streams past the formation (which stays at the origin)
const LIFE = 2.5; // seconds a round is simulated (~1.7 km, well past effective range)
const TRACER_EVERY = 5; // (every fifth round a tracer, as the belts were loaded)
const TRACER_RANGE = 500; // m from the camera
const CONVERGENCE = 350; // m: guns are harmonised so rounds cross the sight line here
const SPREAD = 0.0018; // rad, gun dispersion
// the same numbers the lead indicator uses to predict where a round goes
export const BALLISTICS = { MUZZLE_SPEED, GRAVITY, DRAG, WIND };
const MAX_BULLETS = 6000, MAX_TRACERS = 1000;
const ALLIED_TRACER = [1, 0.42, 0.12], ENEMY_TRACER = [0.75, 1, 0.45]; // red-orange vs. German yellow-green

// per position: rounds per load (all guns of the position together) and reload time
const LOADS = { twin: { ammo: 500, reload: 5 }, single: { ammo: 250, reload: 3.5 } };
const RPM = 750;
const HEAT_PER_SHOT = 1 / 45; // at 12.5 rounds/s a barrel overheats after ~6 s of non-stop fire
const COOL = 0.12; // per second (so short bursts never overheat)
const UNJAM = 0.45; // an overheated gun fires again below this heat

/** All rounds in flight. Tracers are drawn as glowing streaks; ball rounds are only simulated. */
export class Bullets {
  constructor(scene) {
    this.p = new Float32Array(MAX_BULLETS * 3);
    this.v = new Float32Array(MAX_BULLETS * 3);
    this.age = new Float32Array(MAX_BULLETS);
    this.tracer = new Uint8Array(MAX_BULLETS);
    this.team = []; this.owner = []; this.src = []; this.cannon = new Uint8Array(MAX_BULLETS);
    this.count = 0;
    this.playerFired = 0;
    const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5); // (thin: a streak, not a bar)
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(60), // far above the bloom threshold
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_TRACERS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRACERS * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    // glowing head: a few pixels wide at any distance, so tracers seen end-on still show
    this.heads = new Float32Array(MAX_TRACERS * 3);
    this.headColors = new Float32Array(MAX_TRACERS * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.heads, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.headColors, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      map: glowTexture(), size: 7, sizeAttenuation: false, color: new THREE.Color(1, 1, 1).multiplyScalar(40), vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
  }

  /**
   * team 'allied' | 'enemy'; owner = who gets the credit ('player', 'crew', a fighter); cannon = 20 mm shell;
   * src = the aircraft it was fired from (its own rounds can't hit it); life = seconds to simulate it.
   */
  spawn(pos, vel, tracer, team = 'allied', owner = null, cannon = false, src = null, life = LIFE) {
    if (this.count >= MAX_BULLETS) return;
    const i = this.count++, j = i * 3;
    this.p[j] = pos.x; this.p[j + 1] = pos.y; this.p[j + 2] = pos.z;
    this.v[j] = vel.x; this.v[j + 1] = vel.y; this.v[j + 2] = vel.z;
    this.age[i] = LIFE - life;
    this.tracer[i] = tracer ? 1 : 0;
    this.team[i] = team; this.owner[i] = owner; this.src[i] = src; this.cannon[i] = cannon ? 1 : 0;
    if (owner === 'player') this.playerFired++; // (for your accuracy)
  }

  /**
   * camPos: tracers keep a minimum on-screen width (a real tracer's glow stays visible far away).
   * collide(a, b, team, owner, cannon): tests this frame's path of a round, true = it hit something.
   */
  update(dt, camPos, collide) {
    const p = this.p, v = this.v, dir = new V(), pos = new V(), scale = new V(1, 1, 1), from = new V(), to = new V();
    let t = 0;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      if ((this.age[i] += dt) > LIFE) { this.remove(i--); continue; }
      from.set(p[j], p[j + 1], p[j + 2]);
      // drag acts on the speed through the air, gravity pulls down
      const rx = v[j] - WIND.x, ry = v[j + 1] - WIND.y, rz = v[j + 2] - WIND.z;
      const k = DRAG * Math.hypot(rx, ry, rz) * dt;
      v[j] -= rx * k; v[j + 1] -= ry * k + GRAVITY * dt; v[j + 2] -= rz * k;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      // test the whole path since last frame, so fast rounds can't skip through a plane
      if (collide && collide(from, to.set(p[j], p[j + 1], p[j + 2]), this.team[i], this.owner[i], this.cannon[i], this.src[i])) {
        this.remove(i--);
        continue;
      }
      // tracers are drawn only within TRACER_RANGE of you: further off they cluttered the whole sky
      const near = !camPos || (p[j] - camPos.x) ** 2 + (p[j + 1] - camPos.y) ** 2 + (p[j + 2] - camPos.z) ** 2 < TRACER_RANGE * TRACER_RANGE;
      if (this.tracer[i] && near && t < MAX_TRACERS) {
        dir.set(v[j], v[j + 1], v[j + 2]);
        const speed = dir.length();
        pos.set(p[j], p[j + 1], p[j + 2]);
        const w = camPos ? Math.max(1, pos.distanceTo(camPos) * 0.0011 / 0.03) : 1;
        scale.set(w, w, Math.min(speed * 0.022, 20)); // streak length ~ motion blur
        this.q.setFromUnitVectors(FWD, dir.divideScalar(speed));
        this.mesh.setMatrixAt(t, this.m.compose(pos, this.q, scale));
        const c = this.team[i] === 'enemy' ? ENEMY_TRACER : ALLIED_TRACER;
        // dimmer close by: your own guns' tracers, metres from your eye, bloomed into broad white bars
        const d = camPos ? pos.distanceTo(camPos) : 999, f = Math.min(1, 0.06 + Math.max(0, d - 5) / 80);
        this.mesh.instanceColor.setXYZ(t, c[0] * f, c[1] * f, c[2] * f);
        this.heads[t * 3] = pos.x; this.heads[t * 3 + 1] = pos.y; this.heads[t * 3 + 2] = pos.z;
        this.headColors[t * 3] = c[0] * f; this.headColors[t * 3 + 1] = c[1] * f; this.headColors[t * 3 + 2] = c[2] * f;
        t++;
      }
    }
    this.mesh.count = t;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.points.geometry.setDrawRange(0, t);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  remove(i) { // swap with the last round
    const last = --this.count;
    if (i === last) return;
    for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[last * 3 + k]; this.v[i * 3 + k] = this.v[last * 3 + k]; }
    this.age[i] = this.age[last];
    this.tracer[i] = this.tracer[last];
    this.team[i] = this.team[last]; this.owner[i] = this.owner[last]; this.src[i] = this.src[last]; this.cannon[i] = this.cannon[last];
  }
}

/** Main axis of a set of points (power iteration on the covariance). */
function principalAxis(pts) {
  const c = pts.reduce((a, p) => a.add(p), new V()).divideScalar(pts.length);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) m[r * 3 + s] += d[r] * d[s];
  }
  let a = new V(0.3, 0.2, 1).normalize();
  for (let n = 0; n < 30; n++) {
    a = new V(m[0] * a.x + m[1] * a.y + m[2] * a.z, m[3] * a.x + m[4] * a.y + m[5] * a.z, m[6] * a.x + m[7] * a.y + m[8] * a.z).normalize();
  }
  return { centre: c, axis: a };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/**
 * The muzzle flash of a .50 seen end-on: a hot white core and five ragged prongs of flame, yellow going
 * to orange at their tips (each shot's sprite turned and sized at random, so no two look alike).
 */
function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) { // the prongs: tapering, a little crooked
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.3, len = 44 + rnd() * 18, w = 7 + rnd() * 4;
    const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grd.addColorStop(0, 'rgba(255,250,225,1)'); grd.addColorStop(0.35, 'rgba(255,205,110,0.85)'); grd.addColorStop(1, 'rgba(255,110,30,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w);
    g.quadraticCurveTo(Math.cos(a + 0.12) * len * 0.5, Math.sin(a + 0.12) * len * 0.5, Math.cos(a) * len, Math.sin(a) * len);
    g.quadraticCurveTo(Math.cos(a - 0.12) * len * 0.5, Math.sin(a - 0.12) * len * 0.5, Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w);
    g.fill();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  core.addColorStop(0, 'rgba(255,255,245,1)'); core.addColorStop(0.4, 'rgba(255,225,160,0.7)'); core.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = core; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The flame out of the muzzle seen from the side: a short tongue, bright at the muzzle, ragged at the end. */
function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const w = 26 - i * 3, h = 120 - i * 14, grd = g.createLinearGradient(0, 128, 0, 128 - h);
    grd.addColorStop(0, 'rgba(255,245,210,0.55)'); grd.addColorStop(0.5, 'rgba(255,180,80,0.3)'); grd.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(32 - w / 2, 128); g.quadraticCurveTo(32 - w * 0.7, 128 - h * 0.5, 32 + (i % 2 ? 4 : -4), 128 - h); g.quadraticCurveTo(32 + w * 0.7, 128 - h * 0.5, 32 + w / 2, 128); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FLAME_GEO = (() => { // two crossed quads along -Z from the muzzle
  const q = (rot) => new THREE.PlaneGeometry(0.16, 0.42).translate(0, 0.21, 0).rotateX(-Math.PI / 2).rotateZ(rot);
  return mergeGeometries([q(0), q(Math.PI / 2)]);
})();
const FLAME_MAT = new THREE.MeshBasicMaterial({ map: flameTexture(), color: new THREE.Color(1, 0.85, 0.6).multiplyScalar(6), blending: THREE.AdditiveBlending,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });

/**
 * Spent cases and links: they fly out of the guns' ejection ports as they fire, tumble, and fall to the
 * floor (where they bounce and lie a while) or, from the turrets outside, away out of sight. Kept in
 * the bomber's own space, so they lie still on its floor however it moves.
 */
class Casings {
  constructor(parent, interior) {
    const MAX = this.MAX = 1500; // (after a fight the floor is covered in brass: the oldest go first)
    const brass = new THREE.MeshStandardMaterial({ color: 0xb58a3c, roughness: 0.35, metalness: 0.9, envMapIntensity: 0.6 });
    const link = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.7 });
    this.cases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.1, 6), brass, MAX);
    this.links = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.006, 0.016), link, MAX);
    for (const m of [this.cases, this.links]) { m.count = 0; m.frustumCulled = false; parent.add(m); m.castShadow = false; }
    this.items = [];
    this.it = interior;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.one = new V(1, 1, 1);
    // already some brass and links on the floor round the hand-held guns, from the last fight
    for (const s of interior?.stations ?? []) {
      if (s.browning !== 'flex' && !s.socket) continue;
      for (let k = 0; k < 16; k++) {
        const at = new V(s.stand.x + (Math.random() - 0.5) * 0.9, s.stand.y, s.stand.z + (Math.random() - 0.5) * 0.9);
        const floor = interior.floorAt(at.x, at.z, at.y + 0.3);
        if (!Number.isFinite(floor)) continue;
        at.y = floor + 0.007;
        this.items.push({ p: at, v: new V(), r: new V(Math.PI / 2, Math.random() * 6, 0), w: new V(), link: k % 3 === 0, out: false, age: 0, rest: true, floor, old: true });
      }
    }
  }

  /** at, vel: bomber space. isLink: a link rather than a case. outside: no floor under it. */
  spawn(at, vel, isLink, outside) {
    if (this.items.length >= this.MAX * 2) this.items.splice(this.items.findIndex((x) => x.rest) >>> 0, 1); // (the oldest lying there)
    this.items.push({ p: at.clone(), v: vel, r: new V(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new V((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40),
      link: isLink, out: outside, age: 0, rest: false, floor: outside ? -Infinity : (this.it?.floorAt(at.x, at.z, at.y) ?? -Infinity) });
  }

  /**
   * ear: where you're listening from (bomber space), or null (not aboard): each case that lands near you
   * pings as it hits the floor (the first, hardest bounces; a few a frame at most).
   */
  update(dt, ear = null, audio = null) {
    let nc = 0, nl = 0, pings = 0;
    this.lying = 0;
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i];
      c.age += dt;
      if (c.out && c.age > 1.5) { this.items.splice(i--, 1); continue; } // (out of the window: gone; on the floor they stay)
      if (!c.rest) {
        c.v.y -= 9.8 * dt;
        if (c.out) c.v.z += 40 * dt; // (outside, the slipstream takes it)
        c.p.addScaledVector(c.v, dt);
        c.r.addScaledVector(c.w, dt);
        if (c.p.y < c.floor + 0.007) { // bounce, and soon lie still
          if (ear && pings < 4 && c.v.y < -0.6) { // (the clink of it)
            const d = c.p.distanceTo(ear), vol = Math.min(1, -c.v.y / 2.5) / (1 + d * d * 0.35);
            if (vol > 0.03) { audio?.caseTink(vol, c.link); pings++; }
          }
          c.p.y = c.floor + 0.007; c.v.y *= -0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.4);
          if (Math.abs(c.v.y) < 0.25) { c.rest = true; c.r.set(Math.PI / 2, c.r.y, 0); }
        }
      }
      if (c.rest) this.lying++;
      this.m.compose(c.p, this.q.setFromEuler(this.e.set(c.r.x, c.r.y, c.r.z)), this.one);
      if (c.link) { if (nl < this.MAX) this.links.setMatrixAt(nl++, this.m); } else if (nc < this.MAX) this.cases.setMatrixAt(nc++, this.m);
    }
    this.cases.count = nc; this.links.count = nl;
    this.cases.instanceMatrix.needsUpdate = this.links.instanceMatrix.needsUpdate = true;
  }
}

const FLASH_TEX = flashTexture();

let CAN_MAT = null, MOUNT_MAT = null, CHUTE_MAT = null;
const CHUTE = { rings: 46, sides: 10 };
const _ci = new THREE.Matrix4(), _cB = new V(), _cU = new V(), _cW = new V(), _c1 = new V(), _c2 = new V(), _cT = new V(), _cP = new V(), _cN = new V(), _cM = new V();

/** A nose gun in its ball socket: no gun in the model, so one laid out from the station itself. */
function socketGun(station) {
  const breech = new V(...station.pivot), axis = new V(...station.rest).normalize();
  return { mesh: null, axis, breech, muzzle: breech.clone().addScaledVector(axis, station.front ?? 1) };
}

/** One gun position on a bomber: its barrels, the pivot they turn on, ammo, heat and reload state. */
class GunPosition {
  constructor(bomber, station) {
    this.station = station;
    this.dome = station.id === 'top' ? bomber.interior?.topDome : null; // the glass dome seen from inside, turns with the turret
    const model = bomber.model;
    bomber.group.updateMatrixWorld(true);
    const toLocal = bomber.group.matrixWorld.clone().invert();
    const fwd = new V(-Math.sin(station.yaw), 0, -Math.cos(station.yaw));

    // barrels: every mesh under the named gun nodes
    const barrels = [];
    for (const n of station.guns) model.getObjectByName(n)?.traverse((o) => { if (o.isMesh) barrels.push(o); });
    const info = station.socket ? [socketGun(station)] : barrels.map((b) => {
      const pos = b.geometry.attributes.position, pts = [], m = new THREE.Matrix4().multiplyMatrices(toLocal, b.matrixWorld);
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 600))) pts.push(new V().fromBufferAttribute(pos, i).applyMatrix4(m));
      const { centre, axis } = principalAxis(pts);
      if (axis.dot(fwd) < 0) axis.negate(); // point out of the aircraft
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const d = p.clone().sub(centre).dot(axis); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      return { mesh: b, axis, muzzle: centre.clone().addScaledVector(axis, hi), breech: centre.clone().addScaledVector(axis, lo) };
    });
    this.restDir = station.rest ? new V(...station.rest) : info.reduce((a, g) => a.add(g.axis), new V()).normalize();
    // (a twin turret whose two barrels the model made as one mesh: a pair all the same)
    if (station.twin && info.length === 1) info.push({ ...info[0], axis: info[0].axis.clone(), breech: info[0].breech.clone(), muzzle: info[0].muzzle.clone() });
    const pivotPos = station.pivot ? new V(...station.pivot) : info.reduce((a, g) => a.add(g.breech), new V()).divideScalar(info.length);
    if (station.twin) { // a turret's guns where the real ones are (its own layout), parallel, side by side
      const [side, up, j0, j1] = station.twin, p = pivotPos.toArray();
      const y0 = Math.atan2(-this.restDir.x, -this.restDir.z), p0 = Math.asin(THREE.MathUtils.clamp(this.restDir.y, -1, 1));
      info.sort((a, b) => a.breech.clone().sub(pivotPos).dot(new V(Math.cos(y0), 0, -Math.sin(y0))) - b.breech.clone().sub(pivotPos).dot(new V(Math.cos(y0), 0, -Math.sin(y0))));
      info.forEach((g, i) => {
        const s = i ? side : -side;
        turretPoint(p, y0, p0, [s, up, j0], g.breech);
        turretPoint(p, y0, p0, [s, up, j1], g.muzzle);
        g.axis.copy(this.restDir);
      });
    }

    // pivot the guns turn on; parts listed in `turret` turn with them (yaw only or fully)
    this.pivot = new THREE.Object3D();
    this.pivot.position.copy(pivotPos);
    model.add(this.pivot);
    this.pivot.updateMatrixWorld(true);
    for (const g of info) if (g.mesh) this.pivot.attach(g.mesh);
    this.yawPart = this.makeTurret(model, station.turret?.yaw, pivotPos);
    this.fullPart = this.makeTurret(model, station.turret?.full, pivotPos);
    // the model's guns are a few low-poly tubes: in their place, Brownings (browning.js). A flexible
    // gun is the whole gun on its mount; of a turret's only the jacketed barrels show.
    const flex = station.browning === 'flex';
    for (const g of info) {
      if (g.mesh) g.mesh.visible = false;
      const front = flex ? station.front ?? 1.5 : g.breech.distanceTo(g.muzzle);
      if (flex && station.rest) g.axis.copy(this.restDir); // (on its own mount: laid out by the station, not the model's barrel)
      const gun = buildBrowning(flex ? 'flex' : station.twin?.[4] ? 'turret' : 'barrel', front, station.twin?.[4] ?? station.gunRear ?? 0.12, flex, { feed: station.feed, bag: station.bag });
      const zAxis = g.axis.clone().negate(), xAxis = new V().crossVectors(UP, zAxis).normalize(), yAxis = new V().crossVectors(zAxis, xAxis);
      gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      gun.position.copy(flex ? pivotPos : g.breech).sub(pivotPos);
      this.pivot.add(gun);
      g.gun = gun;
      if (station.socket) { // a hand-held nose gun carries its ammunition can on its left side, the belt into the feed tray
        CAN_MAT ??= insideLight(new THREE.MeshStandardMaterial({ color: 0x4a4f33, roughness: 0.7, metalness: 0.2 }));
        const r = station.gunRear;
        const can = new THREE.Mesh(mergeGeometries([
          new THREE.BoxGeometry(0.09, 0.15, 0.22).translate(-0.15, -0.02, r - 0.24),
          new THREE.BoxGeometry(0.04, 0.03, 0.08).translate(-0.1, 0.05, r - 0.22), // the belt's chute into the tray
        ].map((x) => x.toNonIndexed())), CAN_MAT);
        can.castShadow = true;
        gun.add(can);
      }
      if (flex) g.muzzle.copy(pivotPos).addScaledVector(g.axis, front);
    }

    this.guns = info.map((g, i) => {
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: FLASH_TEX, color: new THREE.Color(1, 0.8, 0.5).multiplyScalar(9), blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); // (bright, but not a white-out through the bloom)
      flash.position.copy(g.muzzle).sub(pivotPos).addScaledVector(g.axis, 0.1);
      flash.visible = false;
      this.pivot.add(flash);
      const flame = new THREE.Mesh(FLAME_GEO, FLAME_MAT);
      flame.position.copy(g.muzzle).sub(pivotPos);
      flame.quaternion.setFromUnitVectors(new V(0, 0, -1), g.axis);
      flame.visible = false;
      this.pivot.add(flame);
      // where its spent cases come out: a flexible gun's ejection port, a turret gun's breech
      g.gun?.updateMatrix();
      const port = g.gun?.userData.receiver ? g.gun.userData.receiver.clone().applyMatrix4(g.gun.matrix) : g.breech.clone().sub(pivotPos).addScaledVector(g.axis, 0.1);
      return { muzzle: g.muzzle.clone().sub(pivotPos), flash, flame, port, gun: g.gun, gunAt: g.gun?.position.clone(), kick: 0, timer: (i * 60) / RPM / info.length, heat: 0, jammed: false };
    });
    this.light = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.light.position.copy(this.guns.reduce((a, g) => a.add(g.muzzle), new V()).divideScalar(this.guns.length));
    this.pivot.add(this.light);

    this.load = LOADS[this.guns.length > 1 ? 'twin' : 'single'];
    this.ammo = this.load.ammo;
    this.reloadLeft = 0;
    this.rounds = 0;
    this.aimQ = new THREE.Quaternion();
    // the guns traverse (yaw) and elevate (pitch) like a real mount, so they never roll about the barrel
    this.yaw0 = Math.atan2(-this.restDir.x, -this.restDir.z);
    this.pitch0 = Math.asin(THREE.MathUtils.clamp(this.restDir.y, -1, 1));
    this.elevAxis = new V(Math.cos(this.yaw0), 0, -Math.sin(this.yaw0));
    this.yaw = this.yaw0; this.pitch = this.pitch0;
    this.qYaw = new THREE.Quaternion(); this.qPitch = new THREE.Quaternion();
    // the grips, in the pivot's frame: a pair of spade grips behind the breech (one each side of a
    // twin mount's guns). The top turret's control handles are elsewhere (see gripsWorld).
    const rear = info.reduce((a, g) => a.add(g.breech), new V()).divideScalar(info.length).addScaledVector(this.restDir, -0.07);
    const side = new V().crossVectors(this.restDir, new V(0, 1, 0)).normalize();
    const spread = info.length > 1 ? Math.max(0.12, info[0].breech.distanceTo(info[1].breech) / 2 + 0.03) : 0.075;
    this.gripLocal = [-1, 1].map((s) => rear.clone().addScaledVector(side, s * spread).add(new V(0, -0.02, 0)).sub(pivotPos));
    if (flex) { // the Browning's own spade grips
      const gun = info[0].gun; gun.updateMatrix();
      this.gripLocal = gun.userData.grips.map((p) => p.clone().applyMatrix4(gun.matrix));
      this.gripLocal.sort((a, b) => a.dot(side) - b.dot(side)); // [left, right] from behind it
      this.receiver = gun.userData.receiver.clone().applyMatrix4(gun.matrix);
    }
    this.bomber = bomber;
    // the handles themselves (the model has none): spade grips on the guns, the top turret's control
    // handles on their yoke
    if (station.id !== 'ball' && !flex) {
      const yoke = station.id === 'top' || station.id === 'tail', g = [], bar = station.id === 'top' ? 0.34 : station.id === 'tail' ? 0.3 : spread * 2;
      for (const s of [-1, 1]) g.push(new THREE.CylinderGeometry(0.013, 0.015, 0.1, 8).translate(s * bar / 2, -0.02, 0));
      g.push(new THREE.CylinderGeometry(0.01, 0.01, bar, 6).rotateZ(Math.PI / 2).translate(0, 0.035, 0));
      this.handles = new THREE.Mesh(mergeGeometries(g.map((x) => x.toNonIndexed())), HANDLE_MAT);
      if (yoke) bomber.interior?.group.add(this.handles); // (placed each frame: they turn with the guns, kept level)
      else {
        this.pivot.add(this.handles);
        this.handles.position.copy(this.gripLocal[0]).add(this.gripLocal[1]).multiplyScalar(0.5);
        this.handles.quaternion.setFromUnitVectors(new V(1, 0, 0), side); // (across the gun)
      }
    }
    // a flexible gun's mount stands where the station puts it (the waist guns are staggered, and sit
    // higher in the window than the model's): everything on the pivot moves with it
    if (station.mount) this.pivot.position.add(new V(...station.mount));
    if (flex && bomber.interior && station.sill != null) this.buildMount(bomber, station);
    else if (flex && bomber.interior && !station.socket) { // its post (a nose gun's mount is its ball socket in the glass: buildNoseGlazing), down from the pivot to the window sill, braced to the wall
      bomber.group.updateMatrixWorld(true);
      const p = bomber.interior.group.worldToLocal(this.pivot.getWorldPosition(new V())), out = Math.sign(p.x), mat = insideLight(new THREE.MeshStandardMaterial({ color: 0x2c2e2a, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.3 }));
      const post = new THREE.Mesh(mergeGeometries([
        new THREE.CylinderGeometry(0.022, 0.026, 0.3, 10).translate(p.x, p.y - 0.25, p.z),
        new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).translate(p.x, p.y - 0.12, p.z), // the swivel
        new THREE.BoxGeometry(0.16, 0.04, 0.1).translate(p.x + out * 0.06, p.y - 0.4, p.z), // its foot on the sill
      ].map((x) => x.toNonIndexed())), mat);
      post.castShadow = true;
      bomber.interior.group.add(post);
    }
  }

  /**
   * Where the gunner's hands go, in world space: [left, right]. On a gun's spade grips they swing and
   * elevate with it; the top turret's handles turn with the turret but stay level.
   */
  gripsWorld(out = [new V(), new V()]) {
    const id = this.station.id, m = this.bomber.group.matrixWorld;
    if (id === 'top') {
      const f = new V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), sd = new V(-f.z, 0, f.x);
      for (const [i, s] of [[0, -1], [1, 1]]) out[i].set(0, 1.06, -6.71).addScaledVector(f, 0.3).addScaledVector(sd, s * 0.17).applyMatrix4(m);
      if (this.handles) { // the handles on their yoke, in front of the gunner, turned with the turret
        this.handles.position.set(0, 1.06, -6.71).addScaledVector(f, 0.3);
        this.handles.rotation.set(0, this.yaw, 0);
      }
    } else if (id === 'tail') {
      // the tail gunner's handles on their yoke, linked to the guns and the sight: they swing with
      // his aim, so they stay low in front of him (his hands at the bottom of his view, never over
      // the sight) wherever he points
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const f = _f.set(-sy * cp, sp, -cy * cp), up = _u.set(-sy * -sp, cp, -cy * -sp), sd = _s.crossVectors(f, up);
      const c = _c.copy(this.station.eye).addScaledVector(f, 0.12).addScaledVector(up, -0.3); // (just inside the rear window, under its sill)
      c.y -= Math.max(0, sp) * (this.station.duck ?? 0); // (down with his head as he ducks to aim up)
      for (const [i, s] of [[0, 1], [1, -1]]) out[i].copy(c).addScaledVector(sd, -s * 0.15).applyMatrix4(m);
      if (this.handles) { this.handles.position.copy(c); this.handles.quaternion.setFromRotationMatrix(_rm.makeBasis(sd, up, f)); }
    } else {
      this.pivot.updateWorldMatrix(true, false);
      for (let i = 0; i < 2; i++) this.pivot.localToWorld(out[i].copy(this.gripLocal[i]));
    }
    return out;
  }

  /**
   * A waist gun's mount in its window: the socket bolted to the sill (fixed), the yoke on its pintle,
   * turning with the gun in traverse only (aim()), and the flexible steel chute from the ammunition box
   * up into the gun's feed tray, bent each frame as the gun swings (updateChute).
   */
  buildMount(bomber, station) {
    const it = bomber.interior, p = new V(...station.pivot), out = Math.sign(p.x), sill = station.sill;
    MOUNT_MAT ??= insideLight(new THREE.MeshStandardMaterial({ color: 0x2c2e2a, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.3 }));
    const socket = new THREE.Mesh(mergeGeometries([
      new THREE.CylinderGeometry(0.036, 0.04, 0.1, 14).translate(p.x, sill + 0.05, p.z), // the socket the pintle drops into
      new THREE.CylinderGeometry(0.05, 0.05, 0.015, 14).translate(p.x, sill + 0.007, p.z), // its flange
      new THREE.BoxGeometry(0.2, 0.025, 0.16).translate(p.x + out * 0.03, sill - 0.012, p.z), // the plate on the sill
      ...[-1, 1].flatMap((s) => [-1, 1].map((t) => new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6).translate(p.x + out * 0.03 + s * 0.08, sill + 0.006, p.z + t * 0.06))), // its bolts
      new THREE.BoxGeometry(0.03, 0.22, 0.05).translate(p.x - out * 0.05, sill - 0.12, p.z), // a gusset down the wall under it
    ].map((x) => x.toNonIndexed())), MOUNT_MAT);
    socket.castShadow = true;
    it.group.add(socket);
    const drop = Math.max(0.05, p.y - 0.16 - (sill + 0.03));
    this.yoke = new THREE.Object3D();
    this.yoke.position.copy(this.pivot.position);
    this.pivot.parent.add(this.yoke);
    const y = buildYoke(drop);
    y.rotation.y = this.yaw0; // (built facing -Z: turned to the gun's rest direction)
    this.yoke.add(y);
    if (station.feedBox) {
      const n = CHUTE.rings * CHUTE.sides, geo = new THREE.BufferGeometry(), idx = [];
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      for (let i = 0; i < CHUTE.rings - 1; i++) for (let k = 0; k < CHUTE.sides; k++) {
        const a = i * CHUTE.sides + k, b = i * CHUTE.sides + (k + 1) % CHUTE.sides;
        idx.push(a, a + CHUTE.sides, b, b, a + CHUTE.sides, b + CHUTE.sides);
      }
      geo.setIndex(idx);
      CHUTE_MAT ??= insideLight(new THREE.MeshStandardMaterial({ color: 0x3c3f38, roughness: 0.7, metalness: 0.35, envMapIntensity: 0.1, side: THREE.DoubleSide }));
      this.chute = new THREE.Mesh(geo, CHUTE_MAT);
      this.chute.frustumCulled = false; this.chute.castShadow = true;
      this.chuteFrom = new V(...station.feedBox);
      it.group.add(this.chute);
      this.chuteIt = it.group;
    }
    this.updateChute();
  }

  /** Bend the feed chute from its box to where the gun's feed tray is now. */
  updateChute() {
    const g = this.guns?.[0]?.gun;
    if (!this.chute || !g?.userData.feed) return;
    g.updateWorldMatrix(true, false); this.chuteIt.updateWorldMatrix(true, false);
    _ci.copy(this.chuteIt.matrixWorld).invert();
    const B = _cB.copy(g.userData.feed).applyMatrix4(g.matrixWorld).applyMatrix4(_ci); // the chute's end, at the feed tray
    const up = _cU.set(0, 1, 0).transformDirection(g.matrixWorld).transformDirection(_ci); // (into the tray from below)
    const along = _cW.set(0, 0, 1).transformDirection(g.matrixWorld).transformDirection(_ci); // (the belt's rounds lie along the gun)
    const A = this.chuteFrom, d = A.distanceTo(B);
    _c1.copy(A).add(_cT.set(0, d * 0.55, 0)); // up out of the box
    _c2.copy(B).addScaledVector(up, -d * 0.45).addScaledVector(_cT.set(g.userData.feedSide * 0.5, 0, 0).transformDirection(g.matrixWorld).transformDirection(_ci), d * 0.2);
    const pos = this.chute.geometry.attributes.position.array, nor = this.chute.geometry.attributes.normal.array;
    const R = CHUTE.rings, S = CHUTE.sides, bez = (t, o) => { const u = 1 - t; return o.set(0, 0, 0).addScaledVector(A, u * u * u).addScaledVector(_c1, 3 * u * u * t).addScaledVector(_c2, 3 * u * t * t).addScaledVector(B, t * t * t); };
    for (let i = 0; i < R; i++) {
      const t = i / (R - 1);
      bez(t, _cP); bez(Math.min(1, t + 0.01), _cT); if (t >= 1) { bez(t - 0.01, _cT); _cT.subVectors(_cP, _cT); } else _cT.sub(_cP);
      _cT.normalize();
      // the chute's flat: its wide side across the belt (the rounds lie along the box, then along the gun)
      _cN.set(Math.sign(A.x) || 1, 0, 0).multiplyScalar(-1).lerp(along, t * t).addScaledVector(_cT, -_cN.dot(_cT)).normalize();
      _cM.crossVectors(_cT, _cN);
      const link = i % 3 === 0 ? 1.12 : 1; // (its articulated links: a lip every few centimetres)
      for (let k = 0; k < S; k++) {
        const a = (k / S) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        // a rounded rectangle: 6 cm by 2.5 cm across
        const w = Math.sign(c) * Math.abs(c) ** 0.35 * 0.06 * link, h = Math.sign(sn) * Math.abs(sn) ** 0.35 * 0.025 * link, o = (i * S + k) * 3;
        pos[o] = _cP.x + _cN.x * w + _cM.x * h; pos[o + 1] = _cP.y + _cN.y * w + _cM.y * h; pos[o + 2] = _cP.z + _cN.z * w + _cM.z * h;
        nor[o] = _cN.x * c + _cM.x * sn; nor[o + 1] = _cN.y * c + _cM.y * sn; nor[o + 2] = _cN.z * c + _cM.z * sn;
      }
    }
    this.chute.geometry.attributes.position.needsUpdate = true; this.chute.geometry.attributes.normal.needsUpdate = true;
  }

  makeTurret(model, names, pivotPos) {
    if (!names) return null;
    const part = new THREE.Object3D();
    part.position.copy(pivotPos);
    model.add(part);
    part.updateMatrixWorld(true);
    for (const n of names) for (const o of [model.getObjectByName(n), model.getObjectByName(`${n}_lining`)]) if (o) part.attach(o);
    return part;
  }

  get heat() { return Math.max(...this.guns.map((g) => g.heat)); }
  get jammed() { return this.guns.every((g) => g.jammed); }
  get reloading() { return this.reloadLeft > 0; }

  reload() {
    if (this.reloading || this.ammo === this.load.ammo) return false;
    this.reloadLeft = this.load.reload;
    return true;
  }

  /** Turn the guns towards a direction given in bomber space (smoothly, like a real traverse). */
  aim(dirLocal, yawRel, dt, instant = false) {
    const k = instant ? 1 : 1 - Math.exp(-dt * 16);
    const yaw = Math.atan2(-dirLocal.x, -dirLocal.z), pitch = Math.asin(THREE.MathUtils.clamp(dirLocal.y, -1, 1));
    // the short way round, so a turret passing behind you doesn't spin all the way back
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * k;
    this.pitch += (pitch - this.pitch) * k;
    if (this.station.floor) this.pitch = Math.max(this.pitch, turretFloor(this.station, this.yaw - this.station.yaw)); // (the top turret's guns never down into the cockpit)
    this.qYaw.setFromAxisAngle(UP, this.yaw - this.yaw0);
    this.qPitch.setFromAxisAngle(this.elevAxis, this.pitch - this.pitch0);
    this.aimQ.multiplyQuaternions(this.qYaw, this.qPitch);
    this.pivot.quaternion.copy(this.aimQ);
    if (this.yoke) { this.yoke.quaternion.copy(this.qYaw); this.updateChute(); } // (the mount turns in traverse only)
    if (this.fullPart) this.fullPart.quaternion.copy(this.aimQ);
    if (this.yawPart) this.yawPart.rotation.y = this.yaw - this.yaw0;
    if (this.dome) this.dome.rotation.y = this.yaw;
  }
}

/** Runs every gun position of the player's bomber (AI gunners will reuse the same positions later). */
export class Weapons {
  constructor(scene, audio) {
    this.bullets = new Bullets(scene);
    this.audio = audio;
    this.positions = new Map(); // station id -> GunPosition
  }

  attach(bomber) {
    this.bomber = bomber;
    if (!this.casings && bomber.interior) this.casings = new Casings(bomber.interior.group, bomber.interior);
    const pivots = bomber.model.getObjectByName('LateralGunPivots'); // (the waist guns bring their own mounts)
    if (pivots) pivots.visible = false;
    for (const s of bomber.interior.stations) if (s.guns) this.positions.set(s.id, new GunPosition(bomber, s));
  }

  /** Fresh ammo and cool barrels: the player has moved to another bomber's guns. */
  rearm() {
    for (const gp of this.positions.values()) {
      gp.ammo = gp.load.ammo;
      gp.reloadLeft = 0;
      for (const g of gp.guns) { g.heat = 0; g.jammed = false; }
    }
  }

  /** The player's current gun position (or null). */
  current(player) { return player.station ? this.positions.get(player.station.id) ?? null : null; }

  /** Runs every gun position of the player's bomber: the player's own, and the AI gunners' (crew). */
  update(dt, player, camera, crew, fighters) {
    const tmp = new V(), aimPoint = new V(), dir = new V();
    for (const gp of this.positions.values()) {
      // cool down, reload, flashes off
      for (const g of gp.guns) {
        g.heat = Math.max(0, g.heat - COOL * dt);
        if (g.jammed && g.heat < UNJAM) g.jammed = false;
        g.flash.visible = false;
        g.flame.visible = false;
        if (g.gun) { // the recoil: back on its mount with each round, and forward again
          g.kick *= Math.exp(-dt * 28);
          g.gun.position.copy(g.gunAt).addScaledVector(gp.restAxis ?? (gp.restAxis = gp.restDir.clone()), -0.022 * g.kick);
        }
      }
      gp.light.intensity = 0;
      if (gp.reloadLeft > 0 && (gp.reloadLeft -= dt) <= 0) {
        gp.reloadLeft = 0;
        gp.ammo = gp.load.ammo;
        this.audio.reload(false, this.volume(gp, camera));
      }
      if (gp.ammo === 0 && !gp.reloading) { gp.reload(); this.audio.reload(true, this.volume(gp, camera)); }
      // an AI gunner works every manned gun the player isn't on
      if (gp !== this.current(player) && crew?.manned(gp.station.id, player) && !this.bomber.down && dt > 0) {
        const a = crew.aim(gp.station, fighters, dt);
        if (a) gp.aim(a.dir, a.yawRel, dt);
        if (a?.fire) this.fire(gp, a.aimPoint, dt, 'crew', null, camera); else this.stagger(gp);
        crew.animateGunner(gp.station.id, gp, !!a?.fire && gp.ammo > 0 && !gp.reloading);
      } else if (gp !== this.current(player)) crew?.animateGunner(gp.station.id, gp, false); // (idle at his gun: hands on it all the same)
      if (gp === this.current(player)) {
        player.gripTargets = gp.gripsWorld(player.gripTargets ?? undefined); // (your own hands on your gun)
        // at a flexible gun you stand behind it, your eye following it round its mount
        if (gp.station.eyeBehind) {
          const toLocal = _inv.copy(this.bomber.group.matrixWorld).invert(), pv = gp.pivot.getWorldPosition(tmp).applyMatrix4(toLocal);
          const cp = Math.cos(gp.pitch);
          // ...close behind it (your head at the window, leaning into it), on the gun's own line: that
          // passes through the mount in the window, so the frame never crosses your sight line, however
          // far forward or back you swing it
          const b = gp.station.eyeBehind;
          player.gunEye = (player.gunEye ?? new V()).set(-Math.sin(gp.yaw) * cp, Math.sin(gp.pitch), -Math.cos(gp.yaw) * cp).multiplyScalar(-b).add(pv);
          // and over it, square to the gun (so aimed down your head goes out over it, not up into the roof)
          const sp = Math.sin(gp.pitch);
          player.gunEye.add(tmp.set(Math.sin(gp.yaw) * sp, cp, Math.cos(gp.yaw) * sp).multiplyScalar(gp.station.eyeUp ?? 0.22));
          // (high over the gun: your hands on its grips sit low in the view), and always inside the hull,
          // which narrows towards the roof
          const it = this.bomber.interior, e = player.gunEye;
          if (it) { const w = it.hw(e.z, e.y + 0.05) - 0.07; if (Math.abs(e.x) > w && w > 0.2) e.x = Math.sign(e.x) * w; }
          if (it && gp.station.socket) { // (in the nose: your head stays under its roof and inside the glass, however the gun swings)
            e.y = Math.min(e.y, it.ceilingAt(e.z, 0, -0.5) - 0.14); // (the roof along the middle: out at the side the hull's too narrow to measure from)
            const c = it.noseCone;
            // (inside the cone, and just behind it: inside its base ring there)
            if (c && e.z < c.z0 + 0.5) { const r = c.radius(e.x, e.y, e.z) - 0.14, cy = c.cy + 0.16 * Math.max(0, (c.z0 - e.z) / c.L) ** 2, dx = e.x, dy = e.y - cy, d = Math.hypot(dx, dy); if (d > r && r > 0.05) { e.x = dx * r / d; e.y = cy + dy * r / d; } }
          }
        } else if (gp.station.lean) { // (the tail gunner leans in towards the window as he swings his guns out to the side)
          const cp = Math.cos(gp.pitch), f = tmp.set(-Math.sin(gp.yaw) * cp, Math.sin(gp.pitch), -Math.cos(gp.yaw) * cp);
          const k = Math.min(1, Math.acos(THREE.MathUtils.clamp(f.dot(gp.restDir), -1, 1)) / 0.55);
          player.gunEye = (player.gunEye ?? new V()).copy(gp.station.eye).addScaledVector(f, gp.station.lean * k);
          // aiming up he ducks his head, so he looks up out through the rear window (not into its roof)
          if (gp.station.duck) player.gunEye.y -= Math.max(0, Math.sin(gp.pitch)) * gp.station.duck;
        } else player.gunEye = null;
      }
    }

    // (heard only aboard: `ear`, the camera, set by the game while you're in the bomber)
    this.casings?.update(dt, this.ear && this.bomber ? this.ear.getWorldPosition(_ear).applyMatrix4(_inv2.copy(this.bomber.group.matrixWorld).invert()) : null, this.audio);
    const gp = this.current(player);
    if (!gp) { player.reloadPressed = false; player.gripTargets = null; return; } // R away from a gun doesn't carry over
    // aim the model's guns where the player looks
    const s = gp.station, yaw = s.yaw + player.sYaw, pitch = player.sPitch;
    // (in a turret you sit in, the guns are fixed to it: they turn exactly with your view)
    gp.aim(dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)), player.sYaw, dt, s.id === 'ball' || s.id === 'top');

    if (player.reloadPressed) {
      player.reloadPressed = false;
      if (gp.reload()) this.audio.reload(true);
    }
    if (!(player.firing && player.blend > 0.9) || !this.bomber.turretWorks(s.id)) { this.stagger(gp); return; } // (a knocked-out turret won't fire)
    // rounds converge on the sight line, so the crosshair is where they go (the guns' line, not your
    // head's: free-looking with C, they fire where they point)
    camera.getWorldPosition(tmp);
    if (player.headYaw || player.headPitch) aimPoint.copy(dir).transformDirection(this.bomber.group.matrixWorld).multiplyScalar(CONVERGENCE).add(tmp);
    else camera.getWorldDirection(aimPoint).multiplyScalar(CONVERGENCE).add(tmp);
    this.fire(gp, aimPoint, dt, 'player', player, camera);
  }

  /** Keep twin guns staggered for the next burst. */
  stagger(gp) { gp.guns.forEach((g, i) => { g.timer = Math.max(g.timer, (i * 60) / RPM / gp.guns.length); }); }

  /** Loudness of a gun position for the camera (the player's own gun = 1). */
  volume(gp, camera) {
    const d = gp.pivot.getWorldPosition(new V()).distanceTo(camera.getWorldPosition(new V()));
    return THREE.MathUtils.clamp(2.5 / Math.max(d, 1), 0.12, 1);
  }

  /** Fire the guns of a position at a point (world space) for one frame. */
  blockedByAirframe(gp, aimPoint) {
    const inv = _bi.copy(this.bomber.group.matrixWorld).invert();
    gp.pivot.getWorldPosition(_bo).applyMatrix4(inv);
    _bd.copy(aimPoint).applyMatrix4(inv).sub(_bo).normalize();
    _br.origin.copy(_bo).addScaledVector(_bd, 1.0); _br.direction.copy(_bd);
    return AIRFRAME.some((b) => _br.intersectsBox(b));
  }

  fire(gp, aimPoint, dt, owner, player, camera) {
    if (gp.reloading || gp.ammo <= 0) return;
    // the crew's guns hold fire when the line goes through their own wing, engines or tail, as the
    // turrets' cut-out cams made them do (you at a gun can still shoot your own plane)
    if (owner === 'crew' && this.blockedByAirframe(gp, aimPoint)) return;
    const tmp = new V(), dir = new V(), vol = player ? 1 : this.volume(gp, camera);
    for (const g of gp.guns) {
      g.timer -= dt;
      while (g.timer <= 0 && gp.ammo > 0 && !g.jammed) {
        g.timer += 60 / RPM;
        const muzzle = gp.pivot.localToWorld(tmp.copy(g.muzzle));
        dir.subVectors(aimPoint, muzzle).normalize();
        dir.x += (Math.random() - 0.5) * SPREAD * 2;
        dir.y += (Math.random() - 0.5) * SPREAD * 2;
        dir.z += (Math.random() - 0.5) * SPREAD * 2;
        this.bullets.spawn(muzzle, dir.normalize().multiplyScalar(MUZZLE_SPEED), gp.rounds++ % TRACER_EVERY === 0, 'allied', owner, false, this.bomber);
        if (!this.infinite) gp.ammo--; // (the Options' infinite ammunition: the belt never runs out)
        g.heat += HEAT_PER_SHOT;
        if (g.heat >= 1) { g.jammed = true; if (player) this.audio.overheat(); }
        // the flash: the star end-on, the flame from the side, each round a little different; the
        // muzzle's light on everything round it, a puff of smoke, the gun kicking back on its mount
        g.flash.visible = true;
        g.flash.scale.setScalar(0.28 + Math.random() * 0.3);
        g.flash.material.rotation = Math.random() * Math.PI * 2;
        g.flame.visible = Math.random() < 0.85;
        g.flame.scale.set(0.7 + Math.random() * 0.6, 0.7 + Math.random() * 0.6, 0.6 + Math.random() * 0.8);
        g.flame.rotation.z = Math.random() * Math.PI;
        gp.light.intensity = 22 + Math.random() * 16;
        g.kick = 1;
        if (this.effects && gp.rounds % 2 === 0) this.effects.smoke.emit(muzzle, tmp2.copy(dir).normalize().multiplyScalar(4), { life: 0.9 + Math.random() * 0.6, s0: 0.12, s1: 0.9, a0: 0.28, c0: [0.55, 0.53, 0.5], drag: 2.5 });
        if (this.casings) { // the M2 throws its spent case and the belt's link out underneath it
          const it = this.bomber.interior, port = gp.pivot.localToWorld(tmp3.copy(g.port)).applyMatrix4(_inv2.copy(this.bomber.group.matrixWorld).invert());
          const out = !it || Math.abs(port.x) > it.hw(port.z, port.y) - 0.02 || gp.station.id === 'ball';
          if (!g.gun?.userData.bag) this.casings.spawn(port, new V((Math.random() - 0.5) * 0.6, -0.8 - Math.random() * 0.8, (Math.random() - 0.5) * 0.6), false, out); // (with a bag under it the cases go in the bag: only the links fall)
          this.casings.spawn(port.clone().add(tmp4.set(0, -0.02, 0)), new V((Math.random() - 0.5) * 0.3, -0.6, (Math.random() - 0.5) * 0.3), true, out);
        }
        if (player || gp.rounds % 3 === 0) this.audio.gunshot(vol); // AI guns: fewer sounds, same rhythm
        player?.kick(gp.guns.length > 1 ? 0.6 : 1);
      }
      if (g.jammed) g.timer = Math.max(g.timer, 0);
    }
  }

  /** HUD info for the player's gun position. */
  status(player) {
    const gp = this.current(player);
    if (!gp) return null;
    return {
      ammo: gp.ammo, max: gp.load.ammo, heat: Math.min(1, gp.heat), jammed: gp.jammed,
      reloading: gp.reloading, reloadLeft: gp.reloadLeft, reloadTime: gp.load.reload,
    };
  }
}
