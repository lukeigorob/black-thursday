// The mission: outbound under fighter attack, the initial point, the bomb run through flak, bombs away,
// the rally and the way home, then the debrief.
// Bombs keep the bomber's forward speed as they fall 7.6 km (~45 s), so they hit ~3 km ahead of where
// they were let go. The Norden sight's crosshair shows exactly that point; the target slides into it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRSPEED } from './bomber.js';
import { ALTITUDE } from './world.js';
import { City } from './city.js';

const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
export const TIMES = { target: 330, initialPoint: 80, home: 110 }; // s: when the target reaches us, IP lead, homeward leg
const GROUND = -ALTITUDE;
const WIND = new V(0, 0, AIRSPEED); // the air (and the ground) stream past the formation at airspeed
const BOMB_DRAG = 1.25e-4; // 500 lb GP bomb: falls at up to ~280 m/s
const TRAIN = 0.12; // s between bombs in the train
const ON_TARGET = 305; // m: "within 1,000 feet of the aiming point", the measure used at the time
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
    this.target = new City(scene, new V(aim.x + rand(-160, 160), GROUND, aim.z - AIRSPEED * TIMES.target));
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

  /** Rebuild who bombs with whom: swapBombers moves `squad` between bomber objects. */
  regroup() {
    for (const g of this.groups.values()) g.bombers.length = 0;
    for (const b of this.bombers) this.groups.get(b.squad)?.bombers.push(b);
  }

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
      this.ui.log('Initial point. Bomb run, bomb doors open!');
    }
    player.sightOK = this.phase === 'bombrun' && !mine?.released; // (the Norden: only on the bomb run, until the bombs are away)
    flak.on = this.phase !== 'done' && -toGo < FLAK_BEHIND && toGo < FLAK_AHEAD;
    flak.heavy = toGo > 0 ? Math.min(1, Math.max(0.3, 1.2 - toGo / 8000)) : Math.max(0.3, 1 + toGo / FLAK_BEHIND); // (thickest over the target)
    fighters.suppressed = flak.on; // fighters stood off while their own flak was firing

    // releases: every group on its lead bombardier; yours on you if you're at the sight
    const releasePressed = player.releasePressed;
    player.releasePressed = false; // a Space press only counts on the frame it happens
    if (this.phase === 'bombrun') {
      for (const [squad, g] of this.groups) {
        if (g.released) continue;
        const lead = this.groupLead(g);
        if (!lead) { g.released = true; continue; }
        const along = this.aimPoint(lead).z - this.target.center.z;
        if (g === mine && this.atSight) {
          if (player.firing || releasePressed) this.release(squad, 0);
          else if (along < -400) this.release(squad, 0); // overshot: the toggliers drop anyway
        } else if (along <= g.err * (g === mine ? 0.5 : 1)) {
          const across = g === mine ? 0 : this.target.center.x - this.aimPoint(lead).x + g.wide;
          this.release(squad, across);
        }
      }
      if ([...this.groups.values()].every((g) => g.released)) {
        this.phase = 'rally';
        this.ui.log('All groups away. Rally right, and keep it tight!');
      }
    }
    if (this.phase === 'rally' && -toGo > 4000) { this.phase = 'homeward'; this.ui.log('Through the target. Heading for home.'); }
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
      this.ui.log('Bombs away!');
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

  /**
   * What the mission map (M) shows, in metres from the aiming point on the ground (x right, z back
   * along the route; the ground moves, so everything is measured from the target): the route's
   * points, the flak belt, and where `self` (a point in the formation's frame) is now.
   */
  mapData(time) {
    const t = this.target.center, along = this.sightError().along;
    return {
      phase: { outbound: 'Outbound', bombrun: 'Bomb run', rally: 'Rally', homeward: 'Heading home', done: 'Mission complete' }[this.phase],
      toTarget: along > 0 ? along / AIRSPEED : null, // s until the target is in the bombsight
      start: AIRSPEED * TIMES.target + 3000, // where the stream was when the game began (it came on from England)
      ip: AIRSPEED * TIMES.initialPoint, rally: -4000, home: -4000 - AIRSPEED * TIMES.home,
      flak: [FLAK_AHEAD, -FLAK_BEHIND],
      rel: (p) => [p.x - t.x, p.z - t.z],
      city: this.target.layout, wrecked: this.target.destroyed, buildings: this.target.buildings.length,
      time,
    };
  }

  /** Point the camera down through the Norden sight (crosshair = where the bombs would hit now). */
  sightCamera(camera, player, viewFov = 72) {
    const on = this.atSight;
    const fov = on ? 14 : viewFov; // the telescope shows ~1 km of ground round the crosshair
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
