// The mission: outbound under fighter attack, the initial point, the bomb run through flak, bombs away,
// the rally and the way home, then the debrief.
// Bombs keep the bomber's forward speed as they fall 7.6 km (~45 s), so they hit ~3 km ahead of where
// they were let go. The Norden sight's crosshair shows exactly that point; the target slides into it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRSPEED } from './bomber.js';
import { ALTITUDE } from './world.js';

const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
export const TIMES = { target: 330, initialPoint: 80, home: 110 }; // s: when the target reaches us, IP lead, homeward leg
const GROUND = -ALTITUDE;
const WIND = new V(0, 0, AIRSPEED); // the air (and the ground) stream past the formation at airspeed
const BOMB_DRAG = 1.25e-4; // 500 lb GP bomb: falls at up to ~280 m/s
const TRAIN = 0.12; // s between bombs in the train
const ON_TARGET = 305; // m: "within 1,000 feet of the aiming point", the measure used at the time
const BLAST = 38; // m: a building this close to a hit is wrecked
const FLAK_AHEAD = 16000, FLAK_BEHIND = 3000; // m from the target where the flak belt starts and ends

/** Where a bomb let go from `p` (formation frame) hits, and how long it takes. */
function fall(p0) {
  const p = p0.clone(), v = new V(), rel = new V(), dt = 0.05;
  let t = 0;
  while (p.y > GROUND && t < 120) {
    rel.subVectors(v, WIND);
    v.addScaledVector(rel, -BOMB_DRAG * rel.length() * dt);
    v.y -= 9.81 * dt;
    p.addScaledVector(v, dt);
    t += dt;
  }
  return { p, t };
}

/** The ground point that a bomb released right now would hit, as it is now (it moves with the ground). */
const aimCache = new Map();
function aimOffset(y) {
  const key = Math.round(y / 10);
  if (!aimCache.has(key)) {
    const { p, t } = fall(new V(0, key * 10, 0));
    aimCache.set(key, new V(p.x, GROUND - key * 10, p.z - AIRSPEED * t));
  }
  return aimCache.get(key);
}

function industryTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#5d5a52'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) { // yards, lots and rubble
    g.fillStyle = ['#66625a', '#4f4c46', '#706a5f', '#58554d'][i % 4];
    g.fillRect(Math.random() * 512, Math.random() * 512, 8 + Math.random() * 40, 8 + Math.random() * 40);
  }
  g.strokeStyle = '#3b3a36'; g.lineWidth = 2; // rail tracks fanning into the yard
  for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(0, 330 + i * 6); g.bezierCurveTo(200, 330 + i * 6, 300, 300 + i * 9, 512, 290 + i * 11); g.stroke(); }
  g.strokeStyle = '#8d877a'; g.lineWidth = 5; // roads
  for (const y of [90, 210]) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y + 30); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The target: an aircraft-industry complex with factory halls, workshops and a rail yard. */
class Target {
  constructor(scene, center) {
    this.center = center; // the aiming point, on the ground, in the formation's frame
    this.group = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1900, 1900), new THREE.MeshStandardMaterial({ map: industryTexture(), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.5;
    this.group.add(ground);
    const b = [];
    for (let i = 0; i < 6; i++) b.push([((i % 3) - 1) * 150 + rand(-10, 10), Math.floor(i / 3) * 110 - 55, 120, 18, 70]); // the main halls
    for (let i = 0; i < 90; i++) {
      const a = rand(0, Math.PI * 2), r = rand(140, 700);
      b.push([Math.cos(a) * r, Math.sin(a) * r, rand(18, 70), rand(6, 16), rand(14, 45)]);
    }
    for (let i = 0; i < 60; i++) b.push([rand(-650, 650), rand(260, 330), rand(14, 20), 4, 3.5]); // wagons in the rail yard
    this.buildings = b.map(([x, z, w, h, d]) => ({ x, z, w, h, d, alive: true }));
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x8a7f70, roughness: 0.9 }), this.buildings.length);
    this.mesh.frustumCulled = false;
    this.buildings.forEach((x, i) => this.place(i));
    this.group.add(this.mesh);
    this.group.position.copy(center);
    scene.add(this.group);
    this.burning = [];
  }

  place(i) {
    const b = this.buildings[i];
    const m = new THREE.Matrix4().compose(new V(b.x, 0, b.z), new THREE.Quaternion(), new V(b.w, b.alive ? b.h : b.h * 0.15, b.d));
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get destroyed() { return this.buildings.filter((b) => !b.alive).length; }

  /** A bomb burst at p: wreck what's close. Returns how many buildings it took. */
  blast(p) {
    let n = 0;
    this.buildings.forEach((b, i) => {
      if (!b.alive) return;
      const dx = Math.max(Math.abs(p.x - this.center.x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(p.z - this.center.z - b.z) - b.d / 2, 0);
      if (Math.hypot(dx, dz) < BLAST) { b.alive = false; this.place(i); n++; this.burning.push({ i, t: rand(40, 90), e: 0 }); }
    });
    return n;
  }

  update(dt, effects) {
    this.center.z += AIRSPEED * dt;
    this.group.position.copy(this.center);
    for (let k = this.burning.length - 1; k >= 0; k--) { // wrecked buildings burn and smoke for a while
      const f = this.burning[k];
      if ((f.t -= dt) <= 0) { this.burning.splice(k, 1); continue; }
      if ((f.e -= dt) > 0 || k > 40) continue;
      f.e = rand(0.4, 0.9);
      const b = this.buildings[f.i];
      effects.groundSmoke(this.center.clone().add(new V(b.x, b.h, b.z)));
    }
  }
}

/** Every bomb in the air. */
class Bombs {
  constructor(scene) {
    const max = 2400;
    const body = new THREE.CylinderGeometry(0.18, 0.18, 1.0, 10).translate(0, -0.1, 0);
    const nose = new THREE.SphereGeometry(0.18, 10, 6).translate(0, -0.6, 0);
    const tail = new THREE.ConeGeometry(0.18, 0.45, 10).rotateX(Math.PI).translate(0, 0.62, 0);
    const geo = mergeGeometries([body, nose, tail].map((g) => g.toNonIndexed()));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x4b5230, roughness: 0.6 }), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.list = [];
    this.max = max;
    this.m = new THREE.Matrix4();
  }

  spawn(p, squad) { // each bomb tumbles off the rack a little differently: ~100 m of scatter on the ground
    if (this.list.length < this.max) this.list.push({ p: p.clone(), v: new V(rand(-2, 2), 0, rand(-2, 2)), squad });
  }

  update(dt, impact) {
    const rel = new V(), q = new THREE.Quaternion(), down = new V(0, -1, 0), one = new V(1, 1, 1);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      rel.subVectors(b.v, WIND);
      b.v.addScaledVector(rel, -BOMB_DRAG * rel.length() * dt);
      b.v.y -= 9.81 * dt;
      b.p.addScaledVector(b.v, dt);
      if (b.p.y <= GROUND) { impact(b.p.setY(GROUND), b.squad); this.list.splice(i, 1); }
    }
    this.list.forEach((b, i) => {
      q.setFromUnitVectors(down, rel.copy(b.v).sub(WIND).normalize()); // nose into the airflow
      this.mesh.setMatrixAt(i, this.m.compose(b.p, q, one));
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Mission {
  constructor(scene, { effects, audio, ui, bombers, playerBomber }) {
    Object.assign(this, { effects, audio, ui, bombers, playerBomber });
    // put the target where the player's group will be over it at TIMES.target
    const aim = playerBomber.base.clone().add(aimOffset(playerBomber.base.y));
    this.target = new Target(scene, new V(aim.x + rand(-160, 160), GROUND, aim.z - AIRSPEED * TIMES.target));
    this.bombs = new Bombs(scene);
    this.groups = new Map();
    for (const b of bombers) {
      // each lead bombardier's aiming error (m, along / across track): smoke, haze, nerves and flak
      if (!this.groups.has(b.squad)) this.groups.set(b.squad, { bombers: [], released: false, err: rand(-520, 520), wide: rand(-320, 320) });
      this.groups.get(b.squad).bombers.push(b);
    }
    this.phase = 'outbound';
    this.stats = { dropped: 0, onTarget: 0, playerDropped: 0, playerOnTarget: 0 };
    this.homeT = 0;
    this.listeners = [];
  }

  onEnd(fn) { this.listeners.push(fn); }

  /** The point on the ground the bombs of bomber `b` would hit if released now (formation frame). */
  aimPoint(b) { return b.group.position.clone().add(aimOffset(b.group.position.y)); }

  groupLead(g) { return g.bombers.find((b) => b.lead && !b.down) ?? g.bombers.find((b) => !b.down); }

  get atSight() { return this.player?.station?.sight && this.player.blend > 0.8; }

  /** How far the target is from our crosshair: along (+ = still to come) and across (+ = right). */
  sightError() {
    const p = this.aimPoint(this.playerBomber), t = this.target.center;
    return { along: p.z - t.z, across: t.x - p.x };
  }

  update(dt, { player, time, flak, fighters }) {
    this.player = player;
    this.target.update(dt, this.effects);
    const mine = this.groups.get(this.playerBomber.squad);

    // steering on the bomb run: the bombardier flies it through the autopilot (A / D at the sight);
    // otherwise the lead bombardier lines the group up on the target by himself
    if (this.phase === 'bombrun' && !mine.released) {
      if (this.atSight) this.target.center.x -= ((player.keys.KeyD ? 1 : 0) - (player.keys.KeyA ? 1 : 0)) * 7 * dt;
      else {
        const off = this.sightError().across - mine.wide * 0.3;
        this.target.center.x -= clamp(off, -4 * dt, 4 * dt);
      }
    }

    // phases
    const toGo = this.sightError().along; // metres before the target reaches the crosshair
    if (this.phase === 'outbound' && time > TIMES.target - TIMES.initialPoint) {
      this.phase = 'bombrun';
      this.ui.toast('Initial point. Bomb run, bomb doors open!');
    }
    flak.on = this.phase !== 'done' && -toGo < FLAK_BEHIND && toGo < FLAK_AHEAD;
    fighters.suppressed = flak.on; // fighters stood off while their own flak was firing

    // releases: every group on its lead bombardier; yours on you if you're at the sight
    if (this.phase === 'bombrun') {
      for (const [squad, g] of this.groups) {
        if (g.released) continue;
        const lead = this.groupLead(g);
        if (!lead) { g.released = true; continue; }
        const along = this.aimPoint(lead).z - this.target.center.z;
        if (g === mine && this.atSight) {
          if (player.firing || player.releasePressed) this.release(squad, 0);
          else if (along < -400) this.release(squad, 0); // overshot: the toggliers drop anyway
        } else if (along <= g.err * (g === mine ? 0.5 : 1)) {
          const across = g === mine ? 0 : this.target.center.x - this.aimPoint(lead).x + g.wide;
          this.release(squad, across);
        }
      }
      player.releasePressed = false;
      if ([...this.groups.values()].every((g) => g.released)) {
        this.phase = 'rally';
        this.ui.toast('All groups away. Rally right, and keep it tight!');
      }
    }
    if (this.phase === 'rally' && -toGo > 4000) { this.phase = 'homeward'; this.ui.toast('Through the target. Heading for home.'); }
    if (this.phase === 'homeward' && (this.homeT += dt) > TIMES.home) {
      this.phase = 'done';
      for (const fn of this.listeners) fn(this.debrief());
    }

    // bombs leaving the racks, falling and landing
    for (const b of this.bombers) {
      if (!b.dropping || b.down) continue;
      if ((b.dropping.t -= dt) > 0 || b.bombs <= 0) continue;
      b.dropping.t += TRAIN;
      b.bombs--;
      const p = new V(b.dropping.dx, -1.8, -4.5).applyMatrix4(b.group.matrixWorld);
      this.bombs.spawn(p, b === this.playerBomber ? 'player' : b.squad);
      if (b.bombs <= 0) b.dropping = null;
    }
    this.bombs.update(dt, (p, who) => this.impact(p, who));
  }

  release(squad, across) {
    const g = this.groups.get(squad);
    g.released = true;
    for (const b of g.bombers) if (!b.down && b.bombs > 0) b.dropping = { t: rand(0, 0.4), dx: across };
    if (squad === this.playerBomber.squad) {
      this.ui.toast('Bombs away!');
      this.audio.reload(true);
      this.playerBomber.interior?.emptyBombBay();
    }
  }

  impact(p, who) {
    const d = Math.hypot(p.x - this.target.center.x, p.z - this.target.center.z);
    this.stats.dropped++;
    if (d < ON_TARGET) this.stats.onTarget++;
    if (who === 'player') { this.stats.playerDropped++; if (d < ON_TARGET) this.stats.playerOnTarget++; }
    this.target.blast(p);
    this.effects.groundBurst(p);
    if (who === 'player' && this.stats.playerDropped === 1) this.audio.explosion(ALTITUDE);
  }

  /** HUD line for the current part of the mission. */
  status(time) {
    const along = this.sightError().along;
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    if (this.phase === 'outbound') return `Outbound · initial point in ${mmss(Math.max(0, TIMES.target - TIMES.initialPoint - time))}`;
    if (this.phase === 'bombrun') return `Bomb run · target ${(Math.max(0, along) / 1000).toFixed(1)} km${this.groups.get(this.playerBomber.squad).released ? ' · bombs away' : ''}`;
    if (this.phase === 'rally') return 'Rally · leaving the target';
    if (this.phase === 'homeward') return `Homeward · ${mmss(Math.max(0, TIMES.home - this.homeT))} to the coast`;
    return 'Mission complete';
  }

  /** Point the camera down through the Norden sight (crosshair = where the bombs would hit now). */
  sightCamera(camera, player) {
    const on = this.atSight;
    const fov = on ? 14 : 72; // the telescope shows ~1 km of ground round the crosshair
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (!on) return null;
    camera.lookAt(this.aimPoint(this.playerBomber)); // the bombers sit in the scene root: formation frame = world
    camera.rotateY(player.sYaw);
    camera.rotateX(player.sPitch);
    const e = this.sightError(), g = this.groups.get(this.playerBomber.squad);
    return { along: e.along, across: e.across, bombs: this.playerBomber.bombs, released: g.released, phase: this.phase };
  }

  debrief() {
    return { ...this.stats, buildings: this.target.buildings.length, destroyed: this.target.destroyed };
  }
}
