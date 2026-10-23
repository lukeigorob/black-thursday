// Browning M2 .50 calibre guns: firing, ballistics (muzzle velocity, gravity, air drag), tracers,
// muzzle flash, ammo, reloading and overheating. The model's guns swing to follow the aim.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRSPEED, PARTS } from './bomber.js';

const V = THREE.Vector3;
const _inv = new THREE.Matrix4();
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Vector3(), _rm = new THREE.Matrix4();
// the parts of the airframe a gun mustn't fire through: wings (from the wing roots), engines, the fin
// and the tailplanes (bomber space; the fuselage itself is kept out of the guns' arcs by their limits)
const AIRFRAME = PARTS.filter((p) => p.kind === 'wing' || p.kind === 'engine' || p.kind === 'tail')
  .map((p) => new THREE.Box3(new THREE.Vector3(p.box[0], p.box[2], p.box[4]), new THREE.Vector3(p.box[1], p.box[3], p.box[5])));
const _bi = new THREE.Matrix4(), _bo = new THREE.Vector3(), _bd = new THREE.Vector3(), _br = new THREE.Ray();
const HANDLE_MAT = new THREE.MeshStandardMaterial({ color: 0x1d1b18, roughness: 0.6, metalness: 0.3 }); // black bakelite grips
const UP = new V(0, 1, 0), FWD = new V(0, 0, -1);
const MUZZLE_SPEED = 890; // m/s
const GRAVITY = 9.81;
const DRAG = 0.00025; // simple quadratic drag on the bullet's speed through the air
const WIND = new V(0, 0, AIRSPEED); // the air streams past the formation (which stays at the origin)
const LIFE = 2.5; // seconds a round is simulated (~1.7 km, well past effective range)
const TRACER_EVERY = 4;
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
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
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
        const w = camPos ? Math.max(1, pos.distanceTo(camPos) * 0.0011 / 0.05) : 1;
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

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,210,140,0.9)');
  grd.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,220,160,0.8)';
  g.lineWidth = 3;
  for (let i = 0; i < 4; i++) { // star-shaped flash
    const a = (i * Math.PI) / 4;
    g.beginPath(); g.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30); g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FLASH_TEX = flashTexture();

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
    const info = barrels.map((b) => {
      const pos = b.geometry.attributes.position, pts = [], m = new THREE.Matrix4().multiplyMatrices(toLocal, b.matrixWorld);
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 600))) pts.push(new V().fromBufferAttribute(pos, i).applyMatrix4(m));
      const { centre, axis } = principalAxis(pts);
      if (axis.dot(fwd) < 0) axis.negate(); // point out of the aircraft
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const d = p.clone().sub(centre).dot(axis); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      return { mesh: b, axis, muzzle: centre.clone().addScaledVector(axis, hi), breech: centre.clone().addScaledVector(axis, lo) };
    });
    this.restDir = info.reduce((a, g) => a.add(g.axis), new V()).normalize();
    const pivotPos = station.pivot ? new V(...station.pivot) : info.reduce((a, g) => a.add(g.breech), new V()).divideScalar(info.length);

    // pivot the guns turn on; parts listed in `turret` turn with them (yaw only or fully)
    this.pivot = new THREE.Object3D();
    this.pivot.position.copy(pivotPos);
    model.add(this.pivot);
    this.pivot.updateMatrixWorld(true);
    for (const g of info) this.pivot.attach(g.mesh);
    this.yawPart = this.makeTurret(model, station.turret?.yaw, pivotPos);
    this.fullPart = this.makeTurret(model, station.turret?.full, pivotPos);

    this.guns = info.map((g, i) => {
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: FLASH_TEX, color: new THREE.Color(1, 0.8, 0.5).multiplyScalar(9), blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); // (bright, but not a white-out through the bloom)
      flash.position.copy(g.muzzle).sub(pivotPos).addScaledVector(g.axis, 0.12);
      flash.visible = false;
      this.pivot.add(flash);
      return { muzzle: g.muzzle.clone().sub(pivotPos), flash, timer: (i * 60) / RPM / info.length, heat: 0, jammed: false };
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
    // twin mount's guns). The top turret's control handles and the chin turret's yoke are elsewhere
    // (see gripsWorld).
    const rear = info.reduce((a, g) => a.add(g.breech), new V()).divideScalar(info.length).addScaledVector(this.restDir, -0.07);
    const side = new V().crossVectors(this.restDir, new V(0, 1, 0)).normalize();
    const spread = info.length > 1 ? Math.max(0.12, info[0].breech.distanceTo(info[1].breech) / 2 + 0.03) : 0.075;
    this.gripLocal = [-1, 1].map((s) => rear.clone().addScaledVector(side, s * spread).add(new V(0, -0.02, 0)).sub(pivotPos));
    this.bomber = bomber;
    // the handles themselves (the model has none): spade grips on the guns, the top turret's control
    // handles on their yoke; the chin turret's yoke is part of the nose (interiordetail.js)
    if (station.id !== 'chin' && station.id !== 'ball') {
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
  }

  /**
   * Where the gunner's hands go, in world space: [left, right]. On a gun's spade grips they swing and
   * elevate with it; the top turret's handles turn with the turret but stay level, the chin turret's
   * yoke hangs in front of the bombardier.
   */
  gripsWorld(out = [new V(), new V()]) {
    const id = this.station.id, m = this.bomber.group.matrixWorld;
    if (id === 'top') {
      const f = new V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), sd = new V(-f.z, 0, f.x);
      for (const [i, s] of [[0, -1], [1, 1]]) out[i].set(0, 1.12, -6.71).addScaledVector(f, 0.3).addScaledVector(sd, s * 0.17).applyMatrix4(m);
      if (this.handles) { // the handles on their yoke, in front of the gunner, turned with the turret
        this.handles.position.set(0, 1.12, -6.71).addScaledVector(f, 0.3);
        this.handles.rotation.set(0, this.yaw, 0);
      }
    } else if (id === 'tail') {
      // the tail gunner's handles on their yoke, linked to the guns and the sight: they swing with
      // his aim, so they stay low in front of him (his hands at the bottom of his view, never over
      // the sight) wherever he points
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const f = _f.set(-sy * cp, sp, -cy * cp), up = _u.set(-sy * -sp, cp, -cy * -sp), sd = _s.crossVectors(f, up);
      const c = _c.copy(this.station.eye).addScaledVector(f, 0.34).addScaledVector(up, -0.31);
      for (const [i, s] of [[0, 1], [1, -1]]) out[i].copy(c).addScaledVector(sd, -s * 0.15).applyMatrix4(m);
      if (this.handles) { this.handles.position.copy(c); this.handles.quaternion.setFromRotationMatrix(_rm.makeBasis(sd, up, f)); }
    } else if (id === 'chin') {
      for (const [i, s] of [[0, -1], [1, 1]]) out[i].set(s * 0.13, -0.14, -10.5).applyMatrix4(m);
    } else {
      this.pivot.updateWorldMatrix(true, false);
      for (let i = 0; i < 2; i++) this.pivot.localToWorld(out[i].copy(this.gripLocal[i]));
    }
    return out;
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
  aim(dirLocal, yawRel, dt) {
    const k = 1 - Math.exp(-dt * 16);
    const yaw = Math.atan2(-dirLocal.x, -dirLocal.z), pitch = Math.asin(THREE.MathUtils.clamp(dirLocal.y, -1, 1));
    // the short way round, so a turret passing behind you doesn't spin all the way back
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.qYaw.setFromAxisAngle(UP, this.yaw - this.yaw0);
    this.qPitch.setFromAxisAngle(this.elevAxis, this.pitch - this.pitch0);
    this.aimQ.multiplyQuaternions(this.qYaw, this.qPitch);
    this.pivot.quaternion.copy(this.aimQ);
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
          player.gunEye = (player.gunEye ?? new V()).set(-Math.sin(gp.yaw) * cp, Math.sin(gp.pitch), -Math.cos(gp.yaw) * cp).multiplyScalar(-gp.station.eyeBehind).add(pv);
          player.gunEye.y += 0.17;
        } else if (gp.station.lean) { // (the tail gunner leans in towards the window as he swings his guns out to the side)
          const cp = Math.cos(gp.pitch), f = tmp.set(-Math.sin(gp.yaw) * cp, Math.sin(gp.pitch), -Math.cos(gp.yaw) * cp);
          const k = Math.min(1, Math.acos(THREE.MathUtils.clamp(f.dot(gp.restDir), -1, 1)) / 0.55);
          player.gunEye = (player.gunEye ?? new V()).copy(gp.station.eye).addScaledVector(f, gp.station.lean * k);
        } else player.gunEye = null;
      }
    }

    const gp = this.current(player);
    if (!gp) { player.reloadPressed = false; player.gripTargets = null; return; } // R away from a gun doesn't carry over
    // aim the model's guns where the player looks
    const s = gp.station, yaw = s.yaw + player.sYaw, pitch = player.sPitch;
    gp.aim(dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)), player.sYaw, dt);

    if (player.reloadPressed) {
      player.reloadPressed = false;
      if (gp.reload()) this.audio.reload(true);
    }
    if (!(player.firing && player.blend > 0.9) || !this.bomber.turretWorks(s.id)) { this.stagger(gp); return; } // (a knocked-out turret won't fire)
    // rounds converge on the sight line, so the crosshair is where they go
    camera.getWorldPosition(tmp);
    camera.getWorldDirection(aimPoint).multiplyScalar(CONVERGENCE).add(tmp);
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
        gp.ammo--;
        g.heat += HEAT_PER_SHOT;
        if (g.heat >= 1) { g.jammed = true; if (player) this.audio.overheat(); }
        g.flash.visible = true;
        g.flash.scale.setScalar(0.35 + Math.random() * 0.35);
        g.flash.material.rotation = Math.random() * Math.PI;
        gp.light.intensity = 30;
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
