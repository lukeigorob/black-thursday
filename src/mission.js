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
export const TIMES = { target: 330, initialPoint: 80, home: 360 }; // s: when the target reaches us, IP lead, homeward leg (the second fighter attack, then clear air)
const GROUND = -ALTITUDE;
const WIND = new V(0, 0, AIRSPEED); // the air (and the ground) stream past the formation at airspeed
const BOMB_DRAG = 1.25e-4; // 500 lb GP bomb: falls at up to ~280 m/s
const TRAIN = 0.12; // s between bombs in the train
const ON_TARGET = 305; // m: "within 1,000 feet of the aiming point", the measure used at the time
const FLAK_AHEAD = 11000, FLAK_BEHIND = 9000; // m from the target where the flak belt starts and ends

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

  spawn(p, squad, unseen = false) { // each bomb tumbles off the rack a little differently: ~100 m of scatter on the ground
    if (this.list.length < this.max) this.list.push({ p: p.clone(), v: new V(rand(-2, 2), 0, rand(-2, 2)), squad, unseen });
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
    const none = new V(0, 0, 0);
    this.list.forEach((b, i) => {
      q.setFromUnitVectors(down, rel.copy(b.v).sub(WIND).normalize()); // nose into the airflow
      this.mesh.setMatrixAt(i, this.m.compose(b.p, q, b.unseen ? none : one)); // (a far group's, its fall moved onto the target: not drawn)
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
    this.player = player; this.fighters = fighters;
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
    // the stages: outbound, the fighters and no flak; the flak belt, light at first and thickest over the
    // target, the fighters mostly standing off (a few brave it); out of it, a fresh wave of fighters; then
    // they turn for home, out of ammunition and fuel, and there's clear air to the coast
    flak.on = this.phase !== 'done' && -toGo < FLAK_BEHIND && toGo < FLAK_AHEAD;
    flak.heavy = toGo > 0 ? 0.12 + 0.88 * (1 - toGo / FLAK_AHEAD) ** 1.6 : Math.max(0.05, (1 + toGo / FLAK_BEHIND) ** 1.3);
    fighters.suppressed = flak.on; // fighters stood off while their own flak was firing
    if (this.flakWas && !flak.on && toGo < 0) { fighters.surge(); this.ui.log('Fighters! A fresh wave coming in, fully loaded!'); }
    this.flakWas = flak.on;
    // (no end to the attacks while any of the Luftwaffe's fighters are still to come: they all come, before the clear air)
    const spent = fighters.reserve.axis <= 0;
    // (and once they're all up and only a handful are still fighting (not counting yours, flying one of theirs), that's the end of it: no long wait in an empty sky)
    const thin = spent && this.homeT > 45 && fighters.axis.filter((f) => f.state !== 'rtb' && !f.player).length <= 3;
    if (this.phase === 'homeward' && ((this.homeT > 230 && spent) || thin || this.homeT > 300) && !fighters.noWaves) { fighters.noWaves = true; }
    if (this.phase === 'homeward' && ((this.homeT > 265 && spent) || thin || this.homeT > 318) && !fighters.leaving) { fighters.leaving = true; this.ui.log('The fighters are turning back. Out of ammo, out of fuel. Clear air from here.'); }

    // releases: every group on its lead bombardier; yours on you if you're at the sight
    const releasePressed = player.releasePressed;
    player.releasePressed = false; // a Space press only counts on the frame it happens
    // (every group on its own lead bombardier as it reaches the target: the wings behind yours, and the 3rd
    // Division, still bombing after your wing has rallied; the rally waits only for your own wing)
    if (this.phase === 'bombrun' || this.phase === 'rally' || this.phase === 'homeward') {
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
      const wing = this.playerBomber.squad.split('-')[0];
      if (this.phase === 'bombrun' && [...this.groups].filter(([sq]) => sq.split('-')[0] === wing).every(([, g]) => g.released)) {
        this.phase = 'rally';
        this.ui.log("The wing's bombs are away. Rally right, and keep it tight!");
      }
    }
    if (this.phase === 'rally' && -toGo > 4000) { this.phase = 'homeward'; this.ui.log('Through the target. Heading for home.'); }
    if (this.phase === 'homeward' && fighters.leaving && !fighters.axis.some((f) => f.state !== 'rtb' && !f.player)) this.quietT = (this.quietT ?? 0) + dt; // (all quiet: the last of them turned for home)
    if (this.phase === 'homeward' && ((this.homeT += dt) > TIMES.home || this.quietT > 15)) {
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
      // (a group far off to the side, the 3rd Division thirty miles away: its bombs are scored where its
      // lead aimed them, but not drawn falling out of the sky over yours)
      this.bombs.spawn(p, b === this.playerBomber ? 'player' : b.squad, Math.abs(b.dropping.dx) > 3000);
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
    if (this.phase === 'homeward') return `Homeward · ${this.flakWas ? 'flak' : this.fighters?.leaving ? 'clear air' : 'fighters'} · ${mmss(Math.max(0, TIMES.home - this.homeT))} to the coast`;
    return 'Mission complete';
  }

  /**
   * What the mission map (M) shows, in metres from the aiming point on the ground (x right, z back
   * along the route; the ground moves, so everything is measured from the target): the route's
   * points, the flak belt, and where `self` (a point in the formation's frame) is now.
   */
  mapData(time, turn = { heading: 0, at: -1500, angle: 0, rate: 1 }) {
    const t = this.target.center, along = this.sightError().along, h = turn.heading;
    // the route over the ground: in from England, the IP, over the target, the rally turn to the right
    // (an arc: the formation's own turning radius), and the long leg home on the new heading
    const start = AIRSPEED * TIMES.target + 3000, R = AIRSPEED / turn.rate, route = [[0, start], [0, turn.at]];
    for (let k = 1; k <= 16; k++) { const a = (turn.angle * k) / 16; route.push([R * (1 - Math.cos(a)), turn.at - R * Math.sin(a)]); }
    const end = route[route.length - 1], rest = Math.max(4000, AIRSPEED * TIMES.home - R * turn.angle);
    route.push([end[0] + Math.sin(turn.angle) * rest, end[1] - Math.cos(turn.angle) * rest]);
    const cos = Math.cos(-h), sin = Math.sin(-h);
    return {
      phase: { outbound: 'Outbound', bombrun: 'Bomb run', rally: 'Rally', homeward: 'Heading home', done: 'Mission complete' }[this.phase],
      toTarget: along > 0 ? along / AIRSPEED : null, // s until the target is in the bombsight
      start, // where the stream was when the game began (it came on from England)
      ip: AIRSPEED * TIMES.initialPoint, rally: route[1], home: route[route.length - 1], route,
      flak: [FLAK_AHEAD, -FLAK_BEHIND],
      // (a point in the formation's frame, on the ground's map: the formation's frame turns with it, so
      // after the turn it's turned back, as applyAxisAngle about +Y by -heading)
      rel: (p) => { const x = p.x - t.x, z = p.z - t.z; return [x * cos + z * sin, -x * sin + z * cos]; },
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
