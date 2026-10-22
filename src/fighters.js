// Fighters on both sides.
//  Bf 109 raiders make attack passes on the bombers (head-on, high side, from behind, from the beam).
//  Bf 109 hunters go after the escorts. P-51 escorts patrol round the formation and engage any
//  109 that comes near. Anyone with an enemy on their tail breaks hard to shake it off.
// All of them fly the same simple model: coordinated banking turns, cowl/wing guns, part damage,
// and going down in flames. Positions are in the formation's frame: the air streams past at
// AIRSPEED, so a fighter's motion = its airspeed vector + the wind (head-on passes close fast).
import * as THREE from 'three';
import { AIRSPEED, PARTS as BOMBER_PARTS } from './bomber.js';
import { loadModel } from './models.js';

const V = THREE.Vector3;
const WIND = new V(0, 0, AIRSPEED);
const UP = new V(0, 1, 0);
const FIRE_RANGE = 650, BREAK_RANGE = 170, DOGFIGHT_RANGE = 450;
const SPREAD = 0.012; // rad
const AXIS_ACTIVE = 36, HUNTERS = 9, ALLIED_ACTIVE = 22;
const FIRST_WAVE = 8, RESPAWN = [6, 14], ESCORT_RESPAWN = [18, 30]; // s
const CELL = 100, CELL_PAD = 65; // m: bombers are filed in a grid so a round only tests the ones near it
const LOD_DISTANCE = 800; // m: beyond this a fighter uses the low-detail model

const KINDS = {
  bf109: {
    side: 'axis', name: 'Bf 109', cruise: 150, setup: 200, attack: 185, max: 235, turn: 0.5, combat: 0.8, breakTurn: 0.95, muzzle: 780,
    // hit boxes in the fighter's own space (nose -Z, prop axis at y = 0), measured from the model
    parts: {
      pilot: { box: [-0.33, 0.33, 0.05, 0.8, -1.5, -0.3], hp: 2 },
      engine: { box: [-0.42, 0.42, -0.55, 0.45, -4.1, -2.3], hp: 14 },
      fuel: { box: [-0.4, 0.4, -0.5, 0.05, -0.6, 0.6], hp: 6 },
      tail: { box: [-1.7, 1.7, -0.2, 1.55, 3.3, 4.5], hp: 10 },
      wingL: { box: [-5.2, -0.4, -0.35, 0.25, -2.4, 0.0], hp: 16 },
      wingR: { box: [0.4, 5.2, -0.35, 0.25, -2.4, 0.0], hp: 16 },
      fuselage: { box: [-0.42, 0.42, -0.53, 0.6, -2.3, 3.3], hp: 30 },
    },
    guns: [ // two MG 17s on the cowl, an MG 151/20 cannon through the spinner
      { at: [-0.2, 0.35, -3.1], rpm: 1100, tracer: 3 }, { at: [0.2, 0.35, -3.1], rpm: 1100, tracer: 3 },
      { at: [0, 0, -4.5], rpm: 700, tracer: 2, cannon: true },
    ],
    smokeAt: [0, -0.3, -3], fireAt: [0, 0, -1.5],
  },
  p51: {
    side: 'allied', name: 'P-51', cruise: 165, setup: 210, attack: 200, max: 245, turn: 0.5, combat: 0.85, breakTurn: 1.0, muzzle: 880,
    parts: {
      pilot: { box: [-0.35, 0.35, 0.05, 0.75, -0.9, 0.5], hp: 2 },
      engine: { box: [-0.42, 0.42, -0.85, 0.6, -4.6, -2.4], hp: 14 },
      fuel: { box: [-0.4, 0.4, -0.6, 0.05, 0.5, 1.4], hp: 6 },
      tail: { box: [-1.8, 1.8, -0.35, 1.6, 3.6, 4.92], hp: 10 },
      wingL: { box: [-5.6, -0.45, -0.85, -0.2, -2.2, 0.6], hp: 16 },
      wingR: { box: [0.45, 5.6, -0.85, -0.2, -2.2, 0.6], hp: 16 },
      fuselage: { box: [-0.45, 0.45, -1.2, 0.6, -2.4, 3.7], hp: 30 },
    },
    guns: [1.7, 2.0, 2.3].flatMap((x) => [-x, x]).map((x) => ({ at: [x, -0.64, -2.1], rpm: 800, tracer: 5 })), // six .50s in the wings
    smokeAt: [0, -0.4, -3.4], fireAt: [0, -0.3, -1],
  },
};
const ATTACKS = [['headOn', 3], ['high', 3], ['tail', 2], ['beam', 2]];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => { let r = Math.random() * list.reduce((s, [, w]) => s + w, 0); return list.find(([, w]) => (r -= w) < 0)[0]; };

/** Where a segment a->b first enters box [x0,x1,y0,y1,z0,z1] (0..1), or -1. */
function segBox(a, b, box) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const o = a.getComponent(k), d = b.getComponent(k) - o, lo = box[k * 2], hi = box[k * 2 + 1];
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
    let u = (lo - o) / d, w = (hi - o) / d;
    if (u > w) [u, w] = [w, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, w);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Shortest distance from point p to segment a-b, and the closest point. */
function segPoint(a, b, p, out) {
  const ab = _ab.subVectors(b, a), t = THREE.MathUtils.clamp(_ap.subVectors(p, a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
  out.copy(a).addScaledVector(ab, t);
  return out.distanceTo(p);
}

const _near = new V(), _ab = new V(), _ap = new V();
const cellKey = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);

function clock(bomber, p) {
  const d = bomber.group.worldToLocal(p.clone());
  let h = Math.round((Math.atan2(-d.x, -d.z) * -6) / Math.PI); // 12 = dead ahead, 3 = right
  h = ((h % 12) + 12) % 12 || 12;
  return { h, level: d.y > 150 ? 'high' : d.y < -150 ? 'low' : 'level' };
}

class Fighter {
  constructor(kind, obj, full, pos, dir) {
    this.kind = kind;
    this.k = KINDS[kind];
    this.side = this.k.side;
    this.obj = obj; // THREE.LOD (full model up close, low-detail far away)
    this.pos = pos.clone();
    this.dir = dir.clone().normalize(); // where the nose points (air-relative heading)
    this.speed = this.k.cruise;
    this.up = UP.clone();
    this.roll = 0;
    this.state = 'approach';
    this.timer = 0;
    this.parts = Object.fromEntries(Object.entries(this.k.parts).map(([n, p]) => [n, p.hp]));
    this.smoking = false; this.burning = false; this.engineDead = false; this.pilotDead = false;
    this.spin = 0;
    this.gunTimers = this.k.guns.map(() => Math.random() * 0.1);
    this.rounds = 0;
    this.disc = full.getObjectByName('Fake_Blades');
    this.blades = full.getObjectByName('BF109_F2_Blades');
    this.spinner = kind === 'p51' ? full.getObjectByName('Nose') : null;
    this.inv = new THREE.Matrix4();
  }

  get alive() { return this.state !== 'down' && this.state !== 'gone'; }
  get velocity() { return this.dir.clone().multiplyScalar(this.speed).add(WIND); }

  /** Turn the nose towards `want` at up to `rate` rad/s; the wings bank into the turn. */
  steer(want, rate, dt) {
    if (!(dt > 0) || want.lengthSq() < 1e-9) return;
    want = want.clone().normalize();
    const old = this.dir.clone();
    const angle = old.angleTo(want);
    if (angle > 1e-4) {
      const axis = new V().crossVectors(old, want);
      // turning exactly round: any axis at right angles to the nose will do (pull "up" if we can)
      if (axis.lengthSq() < 1e-10) axis.crossVectors(old, Math.abs(old.y) < 0.9 ? UP : new V(1, 0, 0));
      this.dir.applyAxisAngle(axis.normalize(), Math.min(angle, rate * dt)).normalize();
    }
    // coordinated turn: the lift (the plane's "up") points along gravity-cancelling + turning force
    const accel = this.dir.clone().sub(old).divideScalar(dt).multiplyScalar(this.speed);
    const lift = accel.add(new V(0, 9.81, 0));
    lift.addScaledVector(this.dir, -lift.dot(this.dir));
    // straight up or down there is no "up" from gravity: keep the wings where they were
    if (lift.lengthSq() > 1e-6) this.up.lerp(lift.normalize(), 1 - Math.exp(-dt * 4)).normalize();
  }

  pose() {
    const z = this.dir.clone().negate(); // the models' noses are -Z
    let up = this.up.clone().addScaledVector(this.dir, -this.up.dot(this.dir));
    if (up.lengthSq() < 1e-8) up = new V(1, 0, 0).addScaledVector(this.dir, -this.dir.x); // nose along "up"
    up.normalize();
    this.up.copy(up);
    if (this.roll) up.applyAxisAngle(this.dir, this.roll);
    const x = new V().crossVectors(up, z).normalize();
    const y = new V().crossVectors(z, x);
    this.obj.matrix.makeBasis(x, y, z).setPosition(this.pos);
    this.obj.updateMatrixWorld(true);
    this.inv.copy(this.obj.matrixWorld).invert();
  }
}

export class Fighters {
  constructor(scene, { effects, bullets, audio, ui, bombers, playerBomber }) {
    Object.assign(this, { scene, effects, bullets, audio, ui, bombers, playerBomber });
    this.list = [];
    // a slot per fighter in the air; 0 = flying, > 0 = seconds until a replacement arrives
    this.axisSlots = Array.from({ length: AXIS_ACTIVE }, (_, i) => FIRST_WAVE + i * 1.2);
    this.alliedSlots = Array.from({ length: ALLIED_ACTIVE }, (_, i) => 0.2 + i * 0.1);
    this.kills = 0;
    this.lastCall = -99;
    this.lastFriendsCall = -99;
    this.time = 0;
  }

  /** Where the action is: the player's bomber (it can change place in the stream). */
  get center() { return this.playerBomber.group.position; }

  /** Bombers close enough to the player that a fight there is worth seeing (refreshed every few s). */
  nearBombers() {
    if (!this.near || this.time - this.nearAt > 5) {
      this.nearAt = this.time;
      this.near = this.bombers.filter((b) => !b.down && b.base.distanceTo(this.playerBomber.base) < 1300);
    }
    return this.near;
  }

  async spawn(kind, slot) {
    const [{ scene: full }, { scene: low }] = await Promise.all([loadModel(kind), loadModel(kind, { lod: true })]);
    full.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    low.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
    const obj = new THREE.LOD();
    obj.addLevel(full, 0);
    obj.addLevel(low, LOD_DISTANCE);
    obj.matrixAutoUpdate = false;
    let f;
    const c = this.center;
    if (kind === 'p51') { // escorts are already on station round the formation when they arrive
      const a = rand(0, Math.PI * 2), r = rand(700, 1300);
      const pos = new V(Math.cos(a) * r, rand(350, 800), Math.sin(a) * r).add(c);
      f = new Fighter(kind, obj, full, pos, new V(-Math.sin(a), 0, Math.cos(a)));
      f.station = { a, r, h: pos.y - c.y, rate: rand(0.06, 0.1) * (Math.random() < 0.5 ? -1 : 1) };
      f.state = 'patrol';
    } else { // 109s come in from somewhere ahead or to the side, 3.5 km out, a little above
      const a = rand(-2.2, 2.2), dist = rand(3200, 4200);
      const off = new V(Math.sin(a) * dist, rand(200, 900), -Math.cos(a) * dist);
      f = new Fighter(kind, obj, full, off.clone().add(c), off.clone().negate());
      f.role = slot < HUNTERS ? 'hunter' : 'raider';
      if (f.role === 'raider') this.newAttack(f); else f.state = 'hunt';
    }
    f.slot = slot;
    this.scene.add(obj);
    this.list.push(f);
  }

  newAttack(f) {
    if (this.suppressed && Math.random() < 0.7) { // their own flak is up: most stand off and wait
      f.state = 'extend';
      f.timer = rand(6, 10);
      return;
    }
    // fighters went for stragglers (engines out, falling behind) first, then the bombers round the player
    const near = this.nearBombers().filter((b) => !b.down);
    const stragglers = near.filter((b) => b.deadEngines > 0);
    const r = Math.random();
    f.target = !this.playerBomber.down && r < 0.35 ? this.playerBomber
      : stragglers.length && r < 0.6 ? stragglers[Math.floor(Math.random() * stragglers.length)]
        : near[Math.floor(Math.random() * near.length)] ?? this.playerBomber;
    f.attack = pick(ATTACKS);
    f.side3 = Math.random() < 0.5 ? -1 : 1;
    const o = { headOn: [rand(-200, 200), rand(250, 550), -2600], high: [f.side3 * rand(500, 900), rand(800, 1100), rand(-900, -300)],
      tail: [rand(-300, 300), rand(60, 300), 1900], beam: [f.side3 * 1600, rand(-50, 250), rand(-300, 200)] }[f.attack];
    f.setup = new V(...o);
    f.aimOffset = new V(rand(-2, 2), rand(-1, 1), rand(-8, 8)); // somewhere on the airframe
    f.state = 'approach';
  }

  update(dt, player) {
    this.time += dt;
    this.fileBombers();
    // who's flying on each side, and who's already being chased (instead of searching per fighter)
    this.axis = this.list.filter((g) => g.alive && g.side === 'axis');
    this.allied = this.list.filter((g) => g.alive && g.side === 'allied');
    this.chased = new Set(this.list.map((g) => g.prey).filter(Boolean));
    this.tickSlots(this.axisSlots, 'bf109', dt);
    this.tickSlots(this.alliedSlots, 'p51', dt);
    let nearest = Infinity, closing = 0;
    const cam = player.camera.getWorldPosition(new V());
    for (const f of this.list) {
      if (f.alive) {
        if (f.state !== 'evade' && f.state !== 'break' && this.threatened(f)) { f.resume = f.state; this.startEvade(f); }
        this.fly(f, dt);
      } else this.fall(f, dt);
      if (f.state === 'gone') continue;
      f.pos.addScaledVector(f.velocity, dt);
      if (!Number.isFinite(f.pos.x + f.pos.y + f.pos.z + f.dir.x + f.dir.y + f.dir.z)) { f.state = 'gone'; continue; } // never let a bad number spread
      f.pose();
      this.spinProp(f, dt);
      this.damageTrails(f, dt);
      const d = f.pos.distanceTo(cam);
      if (d < nearest) { nearest = d; closing = -f.velocity.dot(f.pos.clone().sub(cam).normalize()); }
    }
    for (const f of this.list.filter((g) => g.state === 'gone')) {
      this.scene.remove(f.obj);
      this.list.splice(this.list.indexOf(f), 1);
      if (f.side === 'axis') this.axisSlots[f.slot] = rand(...RESPAWN);
      else this.alliedSlots[f.slot] = rand(...ESCORT_RESPAWN);
    }
    this.audio.fighterDrone(nearest, closing);
  }

  tickSlots(slots, kind, dt) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] > 0 && (slots[i] -= dt) <= 0) { slots[i] = 0; this.spawn(kind, i); }
    }
  }

  enemies(f) { return (f.side === 'axis' ? this.allied : this.axis) ?? []; }

  /** An enemy fighter sitting on our tail, close and pointing at us? */
  threatened(f) {
    for (const e of this.enemies(f)) {
      const d = f.pos.distanceTo(e.pos);
      if (d > 600) continue;
      const toUs = f.pos.clone().sub(e.pos).normalize();
      if (e.dir.dot(toUs) > 0.94 && f.dir.dot(toUs) > 0.2) return true; // its nose on us, and it's behind
    }
    return false;
  }

  startEvade(f) {
    f.state = 'evade';
    f.timer = rand(2, 3.5);
    const s = Math.random() < 0.5 ? -1 : 1;
    f.breakDir = new V().crossVectors(f.dir, UP).normalize().multiplyScalar(s).add(new V(0, rand(-0.9, 0.2), 0)).add(f.dir.clone().multiplyScalar(0.2));
  }

  fly(f, dt) {
    const k = f.k;
    switch (f.state) {
      case 'approach': { // raider getting into position for its pass
        if (f.target.down || f.target.gone) { this.newAttack(f); break; } // already going down: pick another
        const p = f.target.group.position.clone().add(f.setup);
        f.speed += (k.setup - f.speed) * dt * 0.5; // full throttle to get ahead of the bombers
        f.steer(p.clone().sub(f.pos), k.turn, dt);
        if (f.pos.distanceTo(p) < 450) {
          f.state = 'attack';
          if (f.target === this.playerBomber && this.time - this.lastCall > 6) {
            this.lastCall = this.time;
            const c = clock(this.playerBomber, f.pos);
            this.ui.toast(`Fighters, ${c.h} o'clock ${c.level}!`);
          }
        }
        break;
      }
      case 'attack': { // diving at a bomber, guns firing
        if (f.target.down) { this.startBreak(f); break; } // it's finished: go and find another
        const tgt = f.target.group.position.clone().add(f.aimOffset), toTgt = tgt.clone().sub(f.pos), dist = toTgt.length();
        f.speed += (k.attack - f.speed) * dt * 0.6;
        f.steer(toTgt, k.combat - 0.1, dt);
        if (dist < FIRE_RANGE && f.dir.angleTo(toTgt) < 0.07) this.shoot(f, dt);
        const closure = f.velocity.dot(toTgt.clone().normalize());
        if (dist < BREAK_RANGE || (closure > 0 && dist / closure < 0.9) || dist > 3500) this.startBreak(f);
        break;
      }
      case 'break': // pull away under or past the bombers
        f.speed = Math.min(k.max, f.speed + dt * 12);
        f.steer(f.breakDir, k.breakTurn, dt);
        if ((f.timer -= dt) <= 0) { f.state = 'extend'; f.timer = rand(3, 5); }
        break;
      case 'extend': { // run out, climb back, then come round again
        const out = f.pos.clone().sub(this.center).setY(0);
        out.lengthSq() < 1 ? out.set(1, 0, 0) : out.normalize();
        f.speed += (k.cruise - f.speed) * dt * 0.3;
        f.steer(out.setY(0.35), k.turn, dt);
        if ((f.timer -= dt) <= 0 && f.pos.distanceTo(this.center) > 1500) this.newAttack(f);
        break;
      }
      case 'evade':
        f.speed = Math.min(k.max, f.speed + dt * 8);
        f.steer(f.breakDir, k.breakTurn, dt);
        if ((f.timer -= dt) <= 0) {
          if (f.role === 'raider') { f.state = 'extend'; f.timer = rand(2, 4); } else f.state = f.side === 'allied' ? 'patrol' : 'hunt';
        }
        break;
      case 'patrol': { // escort weaving round its station above the formation
        const s = f.station;
        s.a += s.rate * dt;
        const p = new V(Math.cos(s.a + s.rate * 4) * s.r, s.h, Math.sin(s.a + s.rate * 4) * s.r).add(this.center);
        f.speed += (k.cruise - f.speed) * dt * 0.4;
        f.steer(p.sub(f.pos), k.turn, dt);
        const bandit = this.pickPrey(f, 2500);
        if (bandit) {
          f.prey = bandit;
          f.state = 'engage';
          f.timer = 25;
          this.chased.add(bandit);
          const c = clock(this.playerBomber, f.pos);
          if (f.pos.distanceTo(this.playerBomber.group.position) < 1500 && this.time - this.lastFriendsCall > 20) {
            this.lastFriendsCall = this.time;
            this.ui.toast(`Little friends at ${c.h} o'clock!`);
          }
        }
        break;
      }
      case 'hunt': { // 109 hunter: find an escort and get on its tail
        if (!f.prey?.alive) { f.prey = this.pickPrey(f, 3500); if (f.prey) this.chased.add(f.prey); }
        if (!f.prey) { f.role = 'raider'; this.newAttack(f); break; }
        f.state = 'engage';
        f.timer = 30;
        break;
      }
      case 'engage': { // dogfight: lead pursuit on the prey, fire when the nose is on it
        const e = f.prey;
        if (!e?.alive || (f.timer -= dt) <= 0 || e.pos.distanceTo(f.pos) > 4000) {
          f.prey = null;
          f.state = f.side === 'allied' ? 'patrol' : 'hunt';
          break;
        }
        const dist = f.pos.distanceTo(e.pos);
        const lead = e.pos.clone().addScaledVector(e.velocity.sub(f.velocity), dist / k.muzzle);
        const to = lead.sub(f.pos);
        f.speed += ((dist > 600 ? k.max : k.attack) - f.speed) * dt * 0.5;
        f.steer(to, k.combat, dt);
        if (dist < DOGFIGHT_RANGE && f.dir.angleTo(to) < 0.05) this.shoot(f, dt);
        if (dist < 70 && f.velocity.dot(e.pos.clone().sub(f.pos)) > 0) this.startEvade(f); // overshoot: pull off
        break;
      }
      default: break;
    }
  }

  startBreak(f) {
    f.state = 'break';
    f.timer = rand(2, 3);
    const away = new V().crossVectors(f.dir, UP).normalize().multiplyScalar(f.side3);
    f.breakDir = f.dir.clone().add(new V(0, f.attack === 'high' ? -1.4 : -0.9, 0)).add(away.multiplyScalar(0.8));
  }

  /** Nearest enemy fighter (within range of the formation) that nobody is already chasing. */
  pickPrey(f, range) {
    let best = null, bd = Infinity;
    for (const e of this.enemies(f)) {
      if (e.pos.distanceTo(this.center) > range) continue;
      if (this.chased.has(e)) continue; // one chaser each, so some raiders get through

      const d = e.pos.distanceTo(f.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  shoot(f, dt) {
    const vel = f.velocity, team = f.side === 'axis' ? 'enemy' : 'allied';
    f.k.guns.forEach((g, i) => {
      f.gunTimers[i] -= dt;
      while (f.gunTimers[i] <= 0) {
        f.gunTimers[i] += 60 / g.rpm;
        const muzzle = new V(...g.at).applyMatrix4(f.obj.matrixWorld);
        const d = f.dir.clone().add(new V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(SPREAD)).normalize();
        this.bullets.spawn(muzzle, d.multiplyScalar(f.k.muzzle).add(vel), f.rounds++ % g.tracer === 0, team, f, g.cannon, f, 1.8);
      }
    });
    if (Math.random() < dt * 10) this.audio.distantGun(f.pos.distanceTo(this.playerBomber.group.position));
  }

  /** A round's path a -> b this frame. Returns true if it hit something (the round is used up). */
  collide(a, b, team, owner, cannon, src) {
    // friendly fire is on: any round can hit any aircraft except the one that fired it
    const hitB = this.hitBomber(a, b, cannon, src);
    if (hitB) {
      if (team === 'allied' && owner === 'player' && this.time - (this.lastFF ?? -99) > 4) {
        this.lastFF = this.time;
        this.ui.toast("Cease fire! You're hitting our own bombers!", 'kill');
      }
      return true;
    }
    const near = _near, reach = a.distanceTo(b) + 8;
    for (const f of this.list) {
      if (f.state === 'gone' || f === src) continue;
      const dx = a.x - f.pos.x, dy = a.y - f.pos.y, dz = a.z - f.pos.z;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue; // cheap reject first: most rounds are nowhere near
      if (segPoint(a, b, f.pos, near) > 7) continue;
      const la = a.clone().applyMatrix4(f.inv), lb = b.clone().applyMatrix4(f.inv);
      let best = null, bt = 2;
      for (const [k, p] of Object.entries(f.k.parts)) {
        const t = segBox(la, lb, p.box);
        if (t >= 0 && t < bt) { bt = t; best = k; }
      }
      if (!best) continue;
      this.effects.impact(a.clone().lerp(b, bt));
      const wasAlive = f.alive;
      if (wasAlive) this.damage(f, best, owner, team);
      if (owner === 'player') {
        this.ui.hitMarker(wasAlive && !f.alive);
        if (f.side === 'allied' && this.time - (this.lastFF ?? -99) > 4) { this.lastFF = this.time; this.ui.toast("Cease fire! That's a P-51!", 'kill'); }
      }
      return true;
    }
    return false;
  }

  damage(f, part, owner, team) {
    if ((team === 'enemy') === (f.side === 'axis')) owner = 'friendly'; // shot by its own side: nobody's kill
    f.parts[part] -= 1;
    const hp = f.parts[part], full = f.k.parts[part].hp;
    if (part === 'engine' && hp < full * 0.5) f.smoking = true;
    if (part === 'engine' && hp <= 0 && !f.engineDead) { f.engineDead = true; if (Math.random() < 0.5) f.burning = true; }
    if (part === 'fuel' && hp <= 0) { f.burning = true; f.fuse = rand(2.5, 6); }
    if (part === 'pilot' && hp <= 0) f.pilotDead = true;
    if ((part === 'wingL' || part === 'wingR') && hp <= 0) { f.burning = true; f.spin = (part === 'wingL' ? -1 : 1) * rand(2.5, 4); }
    if (part === 'tail' && hp <= 0) f.spin = rand(-1.5, 1.5);
    if (part === 'fuselage' && hp <= 0) f.burning = true;
    if (f.engineDead || f.pilotDead || f.parts.wingL <= 0 || f.parts.wingR <= 0 || f.parts.tail <= 0 || f.parts.fuselage <= 0 || f.burning) {
      this.shotDown(f, owner);
    }
  }

  shotDown(f, owner) {
    f.state = 'down';
    f.killedBy = owner;
    const t = (this.tally ??= { player: 0, crew: 0, escorts: 0, axisLost: 0, alliedLost: 0 });
    if (f.side === 'axis') {
      t.axisLost++;
      if (owner === 'player') t.player++; else if (owner === 'crew') t.crew++; else if (owner !== 'friendly') t.escorts++;
    } else t.alliedLost++;
    f.downTime = rand(8, 14);
    if (!f.spin) f.spin = rand(-0.8, 0.8);
    if (owner === 'player') {
      this.kills++;
      this.ui.kill(this.kills, f.k.name);
    } else if (f.pos.distanceTo(this.playerBomber.group.position) < 1500 && Math.random() < 0.6) {
      this.ui.toast(f.side === 'axis' ? 'Escort got one!' : 'Little friend going down!');
    }
  }

  fall(f, dt) {
    // out of control: the nose drops, speed builds, it rolls or spins; burning ones may blow up
    f.speed = Math.min(f.k.max + 30, f.speed + dt * 9);
    f.steer(f.dir.clone().add(new V(0, -0.9, 0)), f.engineDead && !f.burning ? 0.12 : 0.3, dt);
    f.roll += f.spin * dt;
    if (f.fuse !== undefined && (f.fuse -= dt) <= 0) { this.explode(f); return; }
    if ((f.downTime -= dt) <= 0 || f.pos.y < -2500) {
      if (f.burning && f.pos.distanceTo(this.playerBomber.group.position) < 2500) this.explode(f);
      else f.state = 'gone';
    }
  }

  explode(f) {
    this.effects.explosion(f.pos, f.velocity, 1);
    this.audio.explosion(f.pos.distanceTo(this.playerBomber.group.position));
    f.state = 'gone';
  }

  spinProp(f, dt) {
    const turning = !f.engineDead;
    if (f.disc) { f.disc.visible = turning; f.disc.rotation.z += dt * 40; }
    if (f.blades) { f.blades.visible = !turning; f.blades.rotation.z += dt * (f.state === 'down' ? 3 : 0); }
    if (f.spinner) f.spinner.rotation.z += dt * (turning ? 45 : 3);
  }

  damageTrails(f, dt) {
    const e = this.effects, m = f.obj.matrixWorld, v = f.velocity;
    if (f.burning) e.trail(new V(...f.k.fireAt).applyMatrix4(m), v, 'fire', dt);
    else if (f.engineDead) e.trail(new V(...f.k.smokeAt).applyMatrix4(m), v, 'black', dt);
    else if (f.smoking) e.trail(new V(...f.k.smokeAt).applyMatrix4(m), v, 'glycol', dt);
  }

  // ----- German rounds against the bombers -----
  /** File every bomber into the grid cells it (plus a frame's flight of a round) reaches. Once per frame. */
  fileBombers() {
    const grid = (this.grid ??= new Map());
    for (const list of grid.values()) list.length = 0;
    for (const bomber of this.bombers) {
      if (bomber.gone) continue;
      const g = bomber.group.position;
      bomber.group.updateMatrixWorld();
      (bomber._inv ??= new THREE.Matrix4()).copy(bomber.group.matrixWorld).invert();
      const x0 = Math.floor((g.x - CELL_PAD) / CELL), x1 = Math.floor((g.x + CELL_PAD) / CELL);
      const y0 = Math.floor((g.y - CELL_PAD) / CELL), y1 = Math.floor((g.y + CELL_PAD) / CELL);
      const z0 = Math.floor((g.z - CELL_PAD) / CELL), z1 = Math.floor((g.z + CELL_PAD) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const key = cellKey(x, y, z);
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(bomber);
      }
    }
  }

  hitBomber(a, b, cannon, src) {
    if (!this.grid) this.fileBombers();
    const list = this.grid.get(cellKey(Math.floor(a.x / CELL), Math.floor(a.y / CELL), Math.floor(a.z / CELL)));
    if (!list?.length) return false;
    const reach = a.distanceTo(b) + 20;
    for (const bomber of list) {
      if (bomber.gone || bomber === src) continue;
      const g = bomber.group.position;
      const dx = a.x - g.x, dy = a.y - g.y, dz = a.z - g.z;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue; // quick reject
      if (segPoint(a, b, g, _near) > 20) continue;
      const inv = bomber._inv;
      const la = a.clone().applyMatrix4(inv), lb = b.clone().applyMatrix4(inv);
      let part = null, t = 2;
      for (const p of BOMBER_PARTS) {
        const u = segBox(la, lb, p.box);
        if (u >= 0 && u < t) { t = u; part = p; }
      }
      if (!part) continue;
      this.effects.impact(a.clone().lerp(b, t), cannon);
      bomber.hit(part, cannon);
      this.onBomberHit?.(bomber, part, la.clone().lerp(lb, t), cannon);
      if (bomber === this.playerBomber) this.audio.impact(cannon);
      return true;
    }
    return false;
  }
}
