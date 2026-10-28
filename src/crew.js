// The ten men of every bomber: who mans which gun, being wounded, first aid, and the AI gunners.
// In the player's bomber the crew are visible figures who walk to help the wounded; in every other
// bomber the same rules run without figures.
import * as THREE from 'three';

// flak fragments through the hull: the fuselage's box in bomber space, a man's half-width round his chest,
// and who wears a flak vest (the gunners in the waist, the tail and the ball)
const HULL = [-1.25, 1.25, -2.45, 1.8, -11.4, 11.4], BODY = 0.4, VEST = /waist|tail|ball/;
const _chest = new THREE.Vector3(0, 0.95, 0), _fd = new THREE.Vector3(), _fp = new THREE.Vector3(), _fa = new THREE.Vector3(), _fu = new THREE.Vector3(), _fw = new THREE.Vector3();
const HULL_R = Math.hypot(1.25, 2.45, 11.4); // m: the hull's bounding sphere, round the bomber's origin
/** Where a path from `o` along `d` enters the fuselage's box (its distance), or null if it misses it. */
function slab(o, d) {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const oa = o.getComponent(a), da = d.getComponent(a), lo = HULL[a * 2], hi = HULL[a * 2 + 1];
    if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return null; continue; }
    let ta = (lo - oa) / da, tb = (hi - oa) / da;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
import { SECTIONS } from './bomber.js';
import { makeFigure, reachFor } from './figure.js';
import { SURNAMES } from './lines.js';

const V = THREE.Vector3, D = Math.PI / 180;
const _ab = new V(), _ap = new V(), _los = new V(), _cross = new V();
const _sa = new V(), _sb = new V(), _sc = new V(), _sd = new V(), _se = new V(), _hd = new V();
// how far a hand sits from its shoulder at a grip, as a share of his reach: elbow bent but not folded
const FAR = 0.85, NEAR = 0.5;
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const WOUND_TIME = 30, REVIVE_TIME = 4, WALK = 1.2; // s, s, m/s
const GUN_RANGE = 900, FIRE_RANGE = 650, AI_RPM = 750, AI_SPREAD = 0.006;
const AIM_ERROR = 0.03; // rad: real bomber gunners hit very little at range (grows with crossing speed)
const ACQUIRE = [0.8, 2.2], BURST = [0.5, 1.3], PAUSE = [1.4, 3.5], SPRAY = 0.1; // s, s, s, chance of a burst at nothing much
const ACTIVE_RANGE = 1200; // bombers further than this from the player don't simulate their gunners
export const tally = { saved: 0, savedByYou: 0 }; // for the debrief

// What each man wears over his F-1 heated suit on 14 October 1943, by his station (hackathon/
// CREW_GEAR_RESEARCH.md, its station table): the waist and tail gunners at their open windows in full
// sheepskin, the cockpit in A-2 jackets, the nose, the engineer and the radio operator in B-10s (or an A-2),
// the ball gunner in his F-1 alone. The pilots in their officer's caps, crushed, with an HS-38 headset over
// them (as the 303rd's pilots wore them that first year in England); everyone else in a B-6 helmet; every
// man in the A-10 Revised mask. Flak vests: the waist gunners and the radio operator (as the 8th's crews
// were issued them through 1943), the bombardier for his bomb run; never the top or ball turret gunner,
// who had none.
const KIT = {
  pilot: { outfit: 'a2', flak: false, cap: true }, copilot: { outfit: 'a2', flak: false, cap: true },
  bombardier: { outfit: 'b10', flak: true }, navigator: { outfit: 'a2', flak: false },
  engineer: { outfit: 'b3od', flak: false }, radio: { outfit: 'b10', flak: true },
  ball: { outfit: 'f1', flak: false }, waistL: { outfit: 'sheep', flak: true }, waistR: { outfit: 'sheep', flak: true }, tail: { outfit: 'sheep', flak: false },
};
export const ROLES = [
  { id: 'pilot', title: 'Pilot', rank: 'Lt.', station: 'pilot' },
  { id: 'copilot', title: 'Co-pilot', rank: 'Lt.', station: 'copilot' },
  { id: 'bombardier', title: 'Bombardier', rank: 'Lt.', station: 'noseR' },
  { id: 'navigator', title: 'Navigator', rank: 'Lt.', station: 'cheekL' }, // (on the B-17F he manned the left cheek gun, beside his table)
  { id: 'engineer', title: 'Engineer', rank: 'T/Sgt.', station: 'top' },
  { id: 'radio', title: 'Radio operator', rank: 'T/Sgt.', station: 'radio' },
  { id: 'ball', title: 'Ball gunner', rank: 'S/Sgt.', station: 'ball' },
  { id: 'waistL', title: 'Left waist', rank: 'S/Sgt.', station: 'waistL' },
  { id: 'waistR', title: 'Right waist', rank: 'S/Sgt.', station: 'waistR' },
  { id: 'tail', title: 'Tail gunner', rank: 'S/Sgt.', station: 'tail' },
];
// (the surnames: lines.js, where their calls are recorded)
const WHERE = { head: 'the head', torso: 'the chest', armL: 'the left arm', armR: 'the right arm', legL: 'the left leg', legR: 'the right leg' }; // (the parts of you, player.js)

// where each man is in the player's bomber: spot = feet, pose, yaw (0 = facing the nose); lie = where he falls
// (his feet: lying, he stretches 1.8 m forward of them, so the men in the nose lie well back in it)
const SPOTS = {
  pilot: { at: [-0.55, 0.05, -7.6], pose: 'sit', yaw: 0, lie: [-0.55, 0.05, -7.6], liePose: 'slump', help: [-0.18, -0.40, -7.2] },
  copilot: { at: [0.55, 0.05, -7.6], pose: 'sit', yaw: 0, lie: [0.55, 0.05, -7.6], liePose: 'slump', help: [0.18, -0.40, -7.2] },
  bombardier: { at: [0.26, -0.72, -9.9], pose: 'kneel', yaw: 0, lie: [0.24, -0.72, -8.75], liePose: 'lie' }, // (kneeling upright behind the right nose gun: standing, the low nose bent him double)
  navigator: { at: [-0.38, -0.72, -9.45], pose: 'kneel', yaw: 70 * D, lie: [-0.26, -0.72, -8.7], liePose: 'lie' }, // (kneeling at the left cheek gun, as the bombardier does behind his)
  engineer: { at: [0, -0.28, -6.78], pose: 'stand', yaw: 0, lie: [0.1, -0.40, -7.05], liePose: 'lie' },
  radio: { at: [0.1, -1.8, -2.25], pose: 'gun', yaw: Math.PI, lie: [-0.1, -1.80, -1.8], liePose: 'lie' }, // at his gun under the roof hatch, facing aft
  ball: { at: [0, -2.2, -0.13], pose: 'hidden', yaw: 0, lie: [0.05, -1.95, 0.95], liePose: 'lie' }, // pulled out of the turret
  // (well out at their windows: the walkway between them stays half a metre wide)
  waistL: { at: [-0.3, -1.95, 1.93], pose: 'gun', yaw: 90 * D, lie: [-0.2, -1.95, 2.6], liePose: 'lie' }, // (staggered: the right gun is forward)
  waistR: { at: [0.3, -1.95, 1.67], pose: 'gun', yaw: -90 * D, lie: [0.2, -1.95, 1.1], liePose: 'lie' },
  tail: { at: [0, -2.32, 9.98], pose: 'kneel', yaw: 180 * D, lie: [0, -2.32, 9.3], liePose: 'lie' },
};

// the walkway through the fuselage, nose to tail, through the doors and round the ball turret
// (from the nose through the crawlway under the flight deck, up through the hatch between the seats)
export const CORRIDOR = [[0, -0.72, -9.75], [0, -0.72, -8.95], [0, -1.0, -8.55], [0, -1.0, -7.62], [0, -0.40, -7.5], [0, -0.40, -6.6], [0, -0.72, -6.22], [0, -1.02, -5.97],
  [0, -1.32, -5.72], [0, -1.62, -5.4], [0, -1.62, -2.75], [0, -1.80, -2.45], [0, -1.80, -1.4], [0, -1.95, -1.05], [0.6, -1.95, -0.7],
  [0.6, -1.95, 0.4], [0, -1.95, 0.8], [0, -1.95, 5.0], [0, -2.15, 5.4], [0, -2.15, 8.0], [0, -2.32, 8.4], [0, -2.32, 9.5]].map((p) => new V(...p));

/** How the man at a station sits or stands there (for the player's own body). */
export function spotFor(stationId) {
  const role = ROLES.find((r) => r.station === stationId);
  return role ? SPOTS[role.id] : null;
}

/** Down in the crawlway under the flight deck (on hands and knees there). */
const inCrawlway = (p) => (p.y < -0.6 && p.z > -8.9 && p.z < -7.4) || (p.z > 5.0 && p.z < 9.3); // (and the tail, beyond its bulkhead)

function sectionAt(z) { return SECTIONS.find(([, z0, z1]) => z >= z0 && z < z1)?.[0] ?? 'waist'; }

function walkPath(from, to) {
  const near = (p) => CORRIDOR.reduce((bi, c, i) => (c.distanceTo(p) < CORRIDOR[bi].distanceTo(p) ? i : bi), 0);
  const a = near(from), b = near(to), pts = [from.clone()];
  for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) pts.push(CORRIDOR[i].clone());
  pts.push(to.clone());
  return pts;
}

// ---------- figures ----------
export { makeFigure }; // (the airman himself is built in figure.js)
const _box = new THREE.Box3(), _inv = new THREE.Matrix4(), _c = new V();

/**
 * Fit a posed man under the roof: the B-17 is cramped (the waist is barely head height, the tail gunner
 * kneels in a space half that), so if his head would go through the hull he bends his knees, then
 * leans forward over his gun, until it's clear. `interior` measures the hull round him.
 */
export function fitUnderRoof(fig, interior, poseName) {
  const standing = poseName === 'gun' || poseName === 'stand';
  const j = fig.userData.j, parent = fig.parent;
  if (!parent || !interior) return;
  const headTop = () => {
    fig.updateWorldMatrix(true, true);
    _box.setFromObject(j.head).applyMatrix4(_inv.copy(parent.matrixWorld).invert());
    _box.getCenter(_c);
    return _box.max.y;
  };
  // (torso.rotation.x < 0 leans him forward)
  const lean0 = j.torso.rotation.x;
  let dir = -1;
  for (let k = 0; k < 40; k++) {
    const top = headTop(), roof = interior.roofAt(_c.z, _c.x, fig.position.y + 0.3) - 0.05;
    if (top <= roof) return;
    const h = j.hips.position.y;
    if (standing && h > 0.5) { // bend the knees: a squat that keeps the feet under him
      const H = h - 0.05, a = Math.acos(THREE.MathUtils.clamp(H / 0.92, 0, 1));
      j.hips.position.y = H;
      for (const l of [j.legL, j.legR]) { l.hip.rotation.x = a; l.knee.rotation.x = -2 * a; }
      j.torso.rotation.x = Math.min(lean0, -a * 0.45);
    } else if (poseName === 'kneel' && h > 0.3) { // sit back on the heels, shins flat on the floor
      const H = h - 0.04, a = Math.acos(THREE.MathUtils.clamp((H - 0.06) / 0.44, 0, 1));
      j.hips.position.y = H;
      for (const l of [j.legL, j.legR]) { l.hip.rotation.x = a; l.knee.rotation.x = -Math.PI / 2 - a; }
    } else if (Math.abs(j.torso.rotation.x) < 1.2) { // lean over the gun, head tipped up to keep looking ahead
      j.torso.rotation.x += dir * 0.08;
      j.head.rotation.x = -j.torso.rotation.x * 0.7;
    } else if (dir < 0) { // no room leaning forward (the hull curves in there): sit back instead
      dir = 1;
      j.torso.rotation.x = lean0;
    } else return;
  }
}

/** Set a pose: joint angles in radians (x = forward/back, z = sideways). `t` animates walking. */
export function pose(fig, name, t = 0) {
  const j = fig.userData.j;
  const set = (o, x = 0, z = 0) => o.rotation.set(x, 0, z);
  fig.visible = name !== 'hidden';
  if (fig.userData.rig) { // hands half closed, or relaxed; at a gun, animateGunner puts them on the grips
    fig.userData.rig.grip = ['gun', 'kneel', 'crouch', 'sit', 'slump'].includes(name) ? 0.6 : 0.3;
    fig.userData.rig.reach = null;
  }
  fig.rotation.x = 0;
  j.hips.position.set(0, 0.95, 0);
  set(j.torso); set(j.head);
  for (const a of [j.armL, j.armR]) { set(a.sh, 0, 0); set(a.el); }
  for (const l of [j.legL, j.legR]) { set(l.hip); set(l.knee); }
  j.armL.sh.rotation.z = -0.12; j.armR.sh.rotation.z = 0.12;
  switch (name) {
    case 'sit': case 'slump':
      j.hips.position.y = 0.05;
      for (const l of [j.legL, j.legR]) { set(l.hip, 1.5); set(l.knee, -1.5); }
      for (const a of [j.armL, j.armR]) { set(a.sh, 0.9); set(a.el, 0.5); }
      if (name === 'slump') { set(j.torso, 0.55); set(j.head, 0.5); for (const a of [j.armL, j.armR]) set(a.sh, 0.2); }
      break;
    case 'gun': // standing square to a gun, feet apart, knees a little bent, both hands on the spade grips
      j.hips.position.y = 0.91;
      set(j.legL.hip, 0.14, -0.1); set(j.legR.hip, 0.14, 0.1);
      set(j.legL.knee, -0.3); set(j.legR.knee, -0.3);
      for (const a of [j.armL, j.armR]) { set(a.sh, 1.1, 0); set(a.el, 0.6); }
      set(j.torso, -0.06);
      break;
    case 'kneel':
      j.hips.position.y = 0.5;
      for (const l of [j.legL, j.legR]) { set(l.hip, 0); set(l.knee, -1.55); }
      for (const a of [j.armL, j.armR]) { set(a.sh, 1.2); set(a.el, 0.4); }
      set(j.torso, 0.25);
      break;
    case 'crouch':
      j.hips.position.y = 0.62;
      for (const l of [j.legL, j.legR]) { set(l.hip, 1.0); set(l.knee, -1.6); }
      set(j.torso, 0.4);
      for (const a of [j.armL, j.armR]) { set(a.sh, 1.0); set(a.el, 0.5); }
      break;
    case 'walk': {
      const s = Math.sin(t * 7);
      set(j.legL.hip, s * 0.45); set(j.legR.hip, -s * 0.45);
      set(j.legL.knee, -Math.max(0, -s) * 0.6); set(j.legR.knee, -Math.max(0, s) * 0.6);
      set(j.armL.sh, -s * 0.35, -0.12); set(j.armR.sh, s * 0.35, 0.12);
      set(j.torso, 0.08);
      break;
    }
    case 'crawl': { // on hands and knees, as through the crawlway: arms and legs going in turn
      const s = Math.sin(t * 5);
      j.hips.position.y = 0.46;
      set(j.torso, 1.45); set(j.head, -1.1);
      set(j.armL.sh, 1.45 + s * 0.3, -0.1); set(j.armR.sh, 1.45 - s * 0.3, 0.1);
      for (const [l, k] of [[j.legL, -s], [j.legR, s]]) { set(l.hip, 0.15 + k * 0.2); set(l.knee, -1.6); }
      break;
    }
    case 'lie': // on his back on the floor
      fig.rotation.x = -Math.PI / 2;
      j.hips.position.y = 0.95; // rotated: this lifts him 15 cm off the floor plane
      fig.position.y += 0.15;
      set(j.legL.hip, 0.15); set(j.legR.knee, -0.5); set(j.legR.hip, 0.4);
      set(j.armL.sh, 0.3, -0.5); set(j.armR.sh, -0.2, 0.9);
      set(j.head, -0.3);
      break;
    default: break;
  }
}

// ---------- crew ----------
export class Crew {
  /** visible = the player's bomber (figures + walking). playerRole = the role the player plays. */
  constructor(bomber, { visible = false, playerRole = null, interior = null } = {}) {
    this.bomber = bomber;
    this.visible = visible;
    this.interior = interior;
    // the men: the real crew where the records have them (history.js: bomber.histCrew, their names and ranks
    // as recorded: no rank where none is), and for a man not on record a placeholder name, marked as one
    const names = [...SURNAMES].sort(() => Math.random() - 0.5), real = bomber.histCrew ?? {};
    this.members = ROLES.map((role, i) => {
      const h = real[role.id];
      return {
        role, name: h ? (h.rank ? `${h.rank} ${h.name}` : h.name) : `${role.rank} ${names[i]}`, state: role.id === playerRole ? 'player' : 'ok',
        historical: h ? { confidence: h.confidence, fate: h.fate } : null, placeholder: !h,
        woundLeft: 0, task: 'station', spot: SPOTS[role.id],
      };
    });
    this.gunners = new Map(); // station id -> aim state
    this.listeners = [];
    if (visible) {
      for (const m of this.members) {
        m.fig = makeFigure({ seed: ROLES.indexOf(m.role) * 7 + 3, ...KIT[m.role.id] });
        // (the model's waist is barely 1.7 m under the roof, its windows low: the men who stand at
        // their guns there are on the short side, as many gunners were)
        if (m.role.id.startsWith('waist')) m.fig.scale.setScalar(0.92);
        interior.group.add(m.fig);
        this.place(m);
      }
    }
  }

  onEvent(fn) { this.listeners.push(fn); }
  emit(msg) { if (this.visible) for (const fn of this.listeners) fn(msg); } // only your own crew's calls are heard

  member(roleId) { return this.members.find((m) => m.role.id === roleId); }
  get alive() { return this.members.filter((m) => m.state === 'ok' || m.state === 'wounded' || m.state === 'player'); }

  /** Is this gun crewed right now (by an AI man at his post)? */
  manned(stationId, player) {
    const at = player?.station?.id === 'bombsight' ? 'noseR' : player?.station?.id; // the bombardier mans both
    if (player && at === stationId) return false;
    if (this.bomber.turretWorks && !this.bomber.turretWorks(stationId)) return false; // knocked out
    const m = this.members.find((x) => x.role.station === stationId);
    return !!m && (m.state === 'ok' || (m.state === 'player' && m.standIn)) && m.task === 'station';
  }

  /** A round struck the bomber at `local` (bomber space): anyone close by in that section may be hurt. */
  onHit(part, local, cannon, player) {
    if (part.kind !== 'section') return;
    // how much a round does to a man: more the closer it strikes, a 20 mm shell's splinters far more
    const harm = (near) => (Math.random() < near * (cannon ? 0.9 : 0.55) ? near * (cannon ? 0.75 : 0.32) * (0.6 + Math.random() * 0.8) : 0);
    for (const m of this.members) {
      if (m.state !== 'ok') continue;
      const p = new V(...(m.task === 'station' ? m.spot.at : m.pos?.toArray() ?? m.spot.at)).add(new V(0, 0.9, 0));
      if (sectionAt(p.z) !== part.section) continue;
      const d = harm(Math.max(0, 1 - p.distanceTo(local) / 2.2));
      if (!d) continue;
      m.health = (m.health ?? 1) - d;
      if (m.health <= 0) m.patched ? this.kill(m) : this.wound(m); // (down the first time; patched up once, the next one kills him)
      else this.onSound?.('hurt', m);
    }
    if (player && !player.wounded && !player.dead) {
      const p = player.feet.clone().add(new V(0, 0.9, 0));
      const how = player.hurt(harm(Math.max(0, 1 - p.distanceTo(local) / 2.0)), player.zoneAt(local, 0.6));
      if (how) this.onSound?.(how === 'down' ? 'down' : 'hurt', null);
      if (how === 'hurt') this.emit(`You're hit in ${WHERE[player.lastZone]}!`);
      if (how === 'down') { this.emit(`You're hit in ${WHERE[player.lastZone]}! You're down!`); this.findHelper({ player }); }
      if (how === 'dead') this.emit("You're hit again. You didn't make it.");
    }
  }

  /**
   * Flak fragments through the fuselage: n of them flung every way from the burst at `from` (bomber space);
   * those whose path crosses the hull go through it (so a burst close by sprays her near side, one further
   * off sends a few through). The first man (or you) within a body's width of a fragment's path takes it, harder
   * the less hull it has come through; a flak vest takes some of it. Returns where up to three of them
   * came in (for the holes in her skin): [{ at, dir }].
   */
  shrapnel(from, n, player) {
    const holes = [], men = [];
    for (const m of this.members) {
      if (m.state !== 'ok') continue;
      men.push({ m, p: new V(...(m.task === 'station' ? m.spot.at : m.pos?.toArray() ?? m.spot.at)).add(_chest), vest: VEST.test(m.role.id) });
    }
    if (player && !player.wounded && !player.dead) men.push({ player, p: player.feet.clone().add(_chest), vest: VEST.test(player.role ?? '') });
    // only those flung towards her can reach her: the cone round the hull's bounding sphere (the same share
    // of the n as that cone is of all directions), each evenly spread through it
    const dist = from.length(), cosA = dist > HULL_R ? Math.sqrt(1 - (HULL_R / dist) ** 2) : -1;
    const toward = Math.round(n * (1 - cosA) / 2 + Math.random() - 0.5), axis = _fa.copy(from).negate().normalize();
    const u = _fu.set(1, 0, 0).cross(axis); if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(axis); u.normalize();
    const w = _fw.crossVectors(axis, u);
    for (let i = 0; i < toward; i++) {
      const ct = 1 - Math.random() * (1 - cosA), st = Math.sqrt(1 - ct * ct), ph = Math.random() * Math.PI * 2;
      const dir = _fd.copy(axis).multiplyScalar(ct).addScaledVector(u, st * Math.cos(ph)).addScaledVector(w, st * Math.sin(ph));
      const tIn = slab(from, dir);
      if (tIn == null) continue;
      if (holes.length < 3) holes.push({ at: from.clone().addScaledVector(dir, tIn), dir: dir.clone() });
      let hit = null, ht = Infinity;
      for (const x of men) { // the first man along its path
        const t = _fp.copy(x.p).sub(from).dot(dir);
        if (t < tIn || t >= ht) continue;
        if (_fp.copy(from).addScaledVector(dir, t).distanceTo(x.p) > BODY) continue;
        hit = x; ht = t;
      }
      if (!hit) continue;
      // (slowed by the air on the way, by the hull and what's inside, by a flak vest)
      const force = THREE.MathUtils.clamp(1.15 - tIn / 90, 0.25, 1) * THREE.MathUtils.clamp(1 - (ht - tIn) / 4.5, 0.15, 1) * (hit.vest ? 0.6 : 1);
      const harm = rand(0.3, 0.95) * force;
      tally.fragments = (tally.fragments ?? 0) + 1;
      if (hit.player) {
        const how = hit.player.hurt(harm, hit.player.zoneAt(_fp.copy(from).addScaledVector(dir, ht), 0.3)); // (about where its path crosses you)
        if (how) this.onSound?.(how === 'hurt' ? 'hurt' : 'down', null);
        if (how === 'hurt') this.emit(`Flak! You're hit in ${WHERE[hit.player.lastZone]}!`);
        if (how === 'down') { this.emit(`Flak! You're hit in ${WHERE[hit.player.lastZone]}! You're down!`); this.findHelper({ player: hit.player }); }
        if (how === 'dead') this.emit("You're hit again. You didn't make it.");
        if (how && how !== 'hurt') men.splice(men.indexOf(hit), 1);
      } else {
        const m = hit.m;
        m.health = (m.health ?? 1) - harm;
        if (m.health <= 0) { m.patched ? this.kill(m) : this.wound(m); men.splice(men.indexOf(hit), 1); } else this.onSound?.('hurt', m);
      }
    }
    return holes;
  }

  /** Killed outright. */
  kill(m) {
    const was = m.state;
    if (was !== 'wounded') this.wound(m, true);
    m.state = 'dead';
    this.emit(`${m.role.title} ${m.name} is dead.`);
    if (this.visible) this.place(m);
    this.checkPilots();
  }

  /** Going down: every man who can goes for the nearest hatch and out (some don't make it: hit, trapped). */
  bailOut(hatches, effects) {
    this.bailFx = effects;
    for (const m of this.members) {
      if (m.state !== 'ok' || m.state === 'player') continue;
      if (Math.random() < 0.2) continue; // (trapped, too badly hurt to move, or held by the forces of her fall)
      const from = m.pos ?? new V(...(m.task === 'station' ? m.spot.at : m.spot.at));
      let best = hatches[0], bd = Infinity;
      for (const h of hatches) { const d = Math.abs(h.pos.z - from.z); if (d < bd) { bd = d; best = h; } }
      m.pos = from.clone(); m.task = 'bailing'; m.hatch = best;
      if (this.visible) { m.path = walkPath(m.pos, best.pos.clone()); } else m.walkT = rand(3, 12);
    }
  }

  /**
   * Both pilots dead: in a bomber you're not in, the engineer (or the bombardier, or the navigator) takes the
   * controls, as they did, and flies her on; with none of them left, or in yours (unless you take the
   * controls), nobody flies her: she glides down out of the box.
   */
  checkPilots() {
    const gone = (id) => { const p = this.members.find((x) => x.role.id === id); return !p || p.state === 'dead' || p.state === 'bailed'; };
    if (!gone('pilot') || !gone('copilot') || this.bomber.pilotless) return;
    if (!this.visible && this.relief?.state !== 'ok') {
      this.relief = ['engineer', 'bombardier', 'navigator'].map((id) => this.members.find((x) => x.role.id === id)).find((x) => x?.state === 'ok');
      if (this.relief) this.emit(`Both pilots are dead! ${this.relief.role.title} ${this.relief.name} is on the controls!`);
    }
    if (this.visible || this.relief?.state !== 'ok') { this.bomber.pilotless = true; this.emit('Both pilots are dead! Somebody get on the controls!'); }
  }

  wound(m, quiet = false) {
    if (!quiet) this.onSound?.('down', m);
    const walking = m.task !== 'station' && m.pos; // hit on his way somewhere: he falls where he is
    m.state = 'wounded';
    m.woundLeft = WOUND_TIME;
    m.task = 'down';
    m.pos = walking ? m.pos.clone() : new V(...m.spot.lie);
    if (walking) m.spot = { ...m.spot, lie: m.pos.toArray() };
    if (this.visible) this.place(m);
    this.emit(`${m.role.title}'s hit!`);
    this.findHelper({ member: m });
    if (m === this.relief) this.checkPilots(); // (the man flying her in the pilots' place)
  }

  /**
   * A fire in the fuselage burns whoever is in that section: the men at their posts there get hurt
   * before long, and so do you if you stand in it more than a few seconds.
   */
  burns(dt, player) {
    const fire = this.bomber.secFire;
    if (!fire || !Object.values(fire).some(Boolean)) { this.burnT = 0; return; }
    for (const m of this.members) {
      if (m.state !== 'ok') continue;
      const z = m.task === 'station' ? m.spot.at[2] : m.pos?.z;
      if (z != null && fire[sectionAt(z)] && Math.random() < dt * 0.04) { this.wound(m); this.emit(`${m.role.title}'s burnt!`); }
    }
    if (player && !player.wounded && !player.dead && fire[sectionAt(player.feet.z)]) {
      if ((this.burnT = (this.burnT ?? 0) + dt) > 4) { this.burnT = 0; player.wound(); this.emit("You're burnt! Get out of the fire!"); this.findHelper({ player }); }
    } else this.burnT = Math.max(0, (this.burnT ?? 0) - dt);
  }

  /**
   * The men you can see are solid: a box round each one standing or sitting about (not the ones lying
   * on the floor: you can step over them), so you walk round the engineer instead of through him.
   */
  solid(camera) {
    // a slim box round each man's body as he's posed (hips to head: a man leaning out of his window
    // takes his body with him, and his crouched legs don't count), for Player to brush past
    const list = this.interior?.people, parent = this.interior?.group;
    if (!list || !parent) return;
    list.length = 0;
    parent.updateWorldMatrix(true, false);
    _inv.copy(parent.matrixWorld).invert();
    for (const m of this.members) {
      const f = m.fig;
      if (!f?.visible || m.state === 'wounded' || m.state === 'dead') continue;
      const j = f.userData.j;
      f.updateWorldMatrix(true, true);
      const hip = j.hips.getWorldPosition(_c).applyMatrix4(_inv), hx = hip.x, hz = hip.z, hy = hip.y;
      const head = j.head.getWorldPosition(_hd).applyMatrix4(_inv);
      const cx = (hx + head.x) / 2, cz = (hz + head.z) / 2;
      const b = (m.box ??= new THREE.Box3());
      b.min.set(cx - 0.13, Math.min(hy, head.y) - 0.1, cz - 0.13);
      b.max.set(cx + 0.13, Math.max(hy, head.y) + 0.28, cz + 0.13);
      list.push(b);
      // squeezing past him: don't show the inside of his body; and right behind his head (it would
      // fill the screen) he isn't drawn either
      if (f.userData.model) {
        const eye = camera ? camera.getWorldPosition(_c).applyMatrix4(_inv) : null;
        f.userData.model.visible = !(eye && (b.distanceToPoint(eye) < 0.2 || Math.hypot(eye.x - head.x, eye.y - head.y - 0.08, eye.z - head.z) < 0.38)); // (his shoulders and arms are wider than the box)
      }
    }
  }

  /** Send the nearest able man (not a pilot: someone has to fly) to give first aid. */
  findHelper(patient) {
    const where = patient.player ? patient.player.feet : patient.member.pos;
    const free = this.members.filter((m) => m.state === 'ok' && m.task === 'station' && m.role.id !== 'pilot' && m.role.id !== 'copilot');
    if (!free.length) return;
    const helper = free.reduce((a, b) => (new V(...a.spot.at).distanceTo(where) < new V(...b.spot.at).distanceTo(where) ? a : b));
    helper.task = 'helping';
    helper.patient = patient;
    helper.reviveT = 0;
    if (this.visible) {
      helper.pos = new V(...(helper.spot.help ?? helper.spot.at));
      // (he kneels at the wounded man's side by his chest, not on top of him: a man lying stretches forward of his feet)
      const lying = patient.member && patient.member.spot.liePose === 'lie';
      const at = lying ? where.clone().add(new V(where.x > 0 ? -0.36 : 0.36, 0, -0.75)) : where.clone().add(new V(0.3, 0, 0));
      helper.path = walkPath(helper.pos, at);
    } else helper.walkT = rand(4, 18); // time to get there and work, in a bomber we don't see
  }

  update(dt, { player, time }) {
    this.frame = (this.frame ?? 0) + 1;
    this.burns(dt, player);
    if (this.visible) { this.solid(player?.camera); this.radioWork(dt, time); this.pilotWork(dt); }
    for (const m of this.members) {
      if (m.state === 'wounded' && (m.woundLeft -= dt) <= 0) {
        m.state = 'dead';
        this.emit(`${m.role.title} ${m.name} is dead.`);
        if (this.visible) this.place(m);
        this.checkPilots();
      }
      if (m.task === 'bailing' && m.state === 'ok') { // making for his hatch, then out
        const out = () => { m.state = 'bailed'; m.task = 'down'; this.checkPilots(); if (this.visible) this.place(m); this.bailFx?.parachute(m.hatch.pos.clone().applyMatrix4(this.bomber.group.matrixWorld)); };
        if (!this.visible) { if ((m.walkT -= dt) <= 0) out(); } else if (m.path?.length) this.walk(m, dt, time); else out();
        continue;
      }
      if (m.task === 'helping') this.updateHelper(m, dt, player, time);
      else if (m.task === 'returning') this.walk(m, dt, time, () => { m.task = 'station'; this.place(m); });
    }
    // a helper can be hit, or nobody was free at the time: look again about once a second
    if ((this.recheck = (this.recheck ?? rand(0, 1)) - dt) <= 0) {
      this.recheck = 1;
      const helped = (pat) => this.members.some((h) => h.task === 'helping' && (h.patient?.member === pat.member && h.patient?.player === pat.player));
      for (const m of this.members) if (m.state === 'wounded' && !helped({ member: m })) this.findHelper({ member: m });
      if (player?.wounded && !helped({ player })) this.findHelper({ player });
    }
  }

  updateHelper(m, dt, player, time) {
    const p = m.patient;
    const done = p.player ? !p.player.wounded : p.member.state !== 'wounded';
    if (done) return this.goBack(m);
    if (!this.visible) {
      if ((m.walkT -= dt) <= 0) this.revive(p);
      return;
    }
    if (m.path?.length) return this.walk(m, dt, time);
    // at the patient: kneel and work on him, facing him
    pose(m.fig, 'kneel');
    const w = p.member?.spot.liePose === 'lie' ? p.member.pos : null;
    if (w) m.fig.rotation.y = Math.atan2(-(w.x - m.pos.x), -(w.z - 0.75 - m.pos.z));
    if ((m.reviveT += dt) >= REVIVE_TIME) this.revive(p);
  }

  revive(p, byPlayer = false) {
    if (this.visible) tally.saved++;
    if (byPlayer) tally.savedByYou++;
    if (p.player) {
      p.player.revive();
      const me = this.members.find((m) => m.state === 'player');
      if (me) me.patched = true;
      this.emit("You're patched up, but another hit like that will finish you. Back to your post!");
    } else {
      p.member.patched = true; // (once: the next wound like that kills him)
      p.member.state = 'ok';
      p.member.task = 'station';
      p.member.woundLeft = 0;
      p.member.health = 0.6;
      if (this.visible) this.place(p.member);
      this.emit(`${p.member.role.title}'s patched up and back on his gun.`);
    }
  }

  goBack(m) {
    m.patient = null;
    if (!this.visible) { m.task = 'station'; return; }
    m.task = 'returning';
    m.path = walkPath(m.pos, new V(...(m.spot.help ?? m.spot.at)));
  }

  /** Move a figure along its path; `arrive` runs at the end. */
  walk(m, dt, time, arrive) {
    let step = WALK * dt;
    while (step > 0 && m.path.length) {
      const next = m.path[0], d = m.pos.distanceTo(next);
      if (d <= step) { m.pos.copy(next); m.path.shift(); step -= d; continue; }
      const dir = next.clone().sub(m.pos).normalize();
      m.pos.addScaledVector(dir, step);
      if (Math.abs(dir.x) + Math.abs(dir.z) > 0.1) m.fig.rotation.y = Math.atan2(-dir.x, -dir.z);
      step = 0;
    }
    m.fig.position.copy(m.pos);
    pose(m.fig, inCrawlway(m.pos) ? 'crawl' : m.pos.z > 5.2 ? 'crouch' : 'walk', time);
    if (!m.path.length) arrive?.();
  }

  /** Put a figure where his state says he should be. */
  place(m) {
    if (!m.fig || m.onTail) return; // (he went down with the tail: his figure rides the falling piece)
    const s = m.spot;
    // (you, or out of the plane; when you've walked away from your own post, a stand-in mans it)
    if ((m.state === 'player' && !m.standIn) || m.state === 'bailed') { m.fig.visible = false; return; }
    const down = m.state === 'wounded' || m.state === 'dead';
    m.fig.position.set(...(down ? s.lie : s.at));
    m.fig.rotation.y = s.yaw + (down && s.liePose === 'lie' ? 0.3 : 0); // (lying, turned only a little on his side: rolled further his outflung arm stood up in the air)
    pose(m.fig, down ? s.liePose : s.pose);
    if (!down) fitUnderRoof(m.fig, this.interior, s.pose);
    m.fig.visible = !(m.displaced && !down) && !(down ? false : s.pose === 'hidden');
    const j = m.fig.userData.j; // the pose as placed: animateGunner works on top of it
    m.fig.userData.base = down ? null : { hip: j.hips.position.y, shL: j.armL.sh.rotation.x, shR: j.armR.sh.rotation.x, head: j.head.rotation.x, torso: j.torso.rotation.x, pos: m.fig.position.clone(), yaw: m.fig.rotation.y };
  }

  /**
   * The player has taken (or left) this man's gun: he steps out of the way meanwhile. And your own
   * post never stands empty: walk away from it (`feet` = where you are) and a man takes it over until
   * you come back to it.
   */
  setDisplaced(stationId, feet = null) {
    if (stationId === 'bombsight') stationId = 'noseR'; // the bombardier's gun is right by the sight
    for (const m of this.members) {
      if (m.state === 'player') {
        // (the bombardier's post is the whole nose: its four guns and the sight)
        const atPost = feet && (m.role.id === 'bombardier' ? /^(nose|cheek)/.test(stationId ?? '') || feet.z < -9.2 : m.role.station ? stationId === m.role.station : _c.set(...m.spot.at).distanceTo(feet) < 1.2);
        const standIn = !!feet && !atPost;
        if (standIn !== !!m.standIn) { m.standIn = standIn; m.task = 'station'; this.place(m); }
        continue;
      }
      const was = m.displaced;
      m.displaced = m.role.station === stationId && m.state === 'ok' && m.task === 'station';
      if (was !== m.displaced) this.place(m);
    }
  }

  /**
   * A gunner you can see, at his gun: he turns with it (the top turret gunner all the way round with
   * the turret, the others from the hips), his arms and head follow its elevation, hands on the grips,
   * and he shakes with the recoil while it fires. gp = the gun position (yaw / pitch in bomber space).
   */
  animateGunner(stationId, gp, firing) {
    if (!this.visible) return;
    const m = this.members.find((x) => x.role.station === stationId);
    const b = m?.fig?.userData.base;
    if (!b || !m.fig.visible || m.task !== 'station' || !(m.state === 'ok' || m.standIn)) return;
    const j = m.fig.userData.j, top = stationId === 'top';
    const rel = wrap(gp.yaw - m.spot.yaw);
    m.fig.rotation.y = b.yaw + rel * (top ? 1 : 0.6);
    const arms = top ? 1.45 : 0, lift = THREE.MathUtils.clamp(gp.pitch, -0.8, 1.2) * 0.85;
    j.armL.sh.rotation.x = (arms || b.shL) + lift;
    j.armR.sh.rotation.x = (arms || b.shR) + lift;
    if (top) { j.armL.el.rotation.x = j.armR.el.rotation.x = 0.7; }
    j.head.rotation.x = b.head + THREE.MathUtils.clamp(gp.pitch, -0.6, 0.9) * 0.5;
    reachFor(m.fig, gp.gripsWorld(m.grips ??= [new V(), new V()])); // both hands on the grips, wherever the gun points
    // he leans in to his grips: his shoulders (where they'd be standing straight) a forearm and a bit
    // short of them, so the arms are never stretched straight and the hands never fall short. He bends
    // at the waist first, and only steps in for the rest, his feet kept inside the hull.
    const rig = m.fig.userData.rig, par = m.fig.parent, lean = (m.lean ??= new V());
    m.bend ??= 0;
    if (rig && par) {
      const shL = par.worldToLocal(rig.arms.l.upper.getWorldPosition(_sa)).sub(m.fig.position).add(b.pos);
      const shR = par.worldToLocal(rig.arms.r.upper.getWorldPosition(_sb)).sub(m.fig.position).add(b.pos);
      const sh = _sd.copy(shL).add(shR).multiplyScalar(0.5);
      const want = par.worldToLocal(_sc.copy(m.grips[0]).add(m.grips[1]).multiplyScalar(0.5)).sub(sh);
      const dh = Math.hypot(want.x, want.z);
      const ux = dh ? want.x / dh : 0, uz = dh ? want.z / dh : 0;
      // each hand to its own grip, from where his shoulder would be standing straight (last frame's
      // bend undone: his shoulders had already come that far). He wants every hand within a comfortable
      // reach, elbow bent (FAR of his arm), and none so close the arm folds up into the gun (NEAR): he
      // leans or steps in for the far one, and steps back from a gun that's on top of him.
      const L = (rig.arms.l.a + rig.arms.l.b) * m.fig.getWorldScale(_se).x + 0.075; // (the wrist stops a hand short)
      const fwd = Math.sin(m.bend) * 0.5;
      let go = 0, back = 0;
      for (const [s, g] of [[shL, m.grips[0]], [shR, m.grips[1]]]) {
        const gl = par.worldToLocal(_se.copy(g));
        const d = Math.hypot(gl.x - s.x + ux * fwd, gl.y - s.y, gl.z - s.z + uz * fwd);
        go = Math.max(go, d - FAR * L); back = Math.max(back, NEAR * L - d);
      }
      if (go <= 0) go = top ? 0 : -Math.min(back, 0.2); // (in the turret he can't step back: the Sperry's grips are close to his chest)
      // (a waist gunner stands up to his gun: he steps in to it rather than stooping over it)
      const waist = stationId.startsWith('waist'), bendGo = THREE.MathUtils.clamp(go, 0, waist ? 0.15 : 0.26);
      const bend = Math.asin(bendGo / 0.5), step = Math.min(go - bendGo, stationId === 'tail' || waist || stationId.startsWith('cheek') ? 0.45 : 0.3); // (the cheek guns are well forward of the navigator's table)
      // a waist gunner gets down to a low gun by bending his knees, feet flat on the floor
      const sink = waist ? THREE.MathUtils.clamp(-(want.y + 0.12) * 0.7, 0, 0.16) : 0;
      want.set(ux * step, THREE.MathUtils.clamp((want.y + 0.1) * 0.5, stationId === 'tail' ? -0.12 : 0, 0.05), uz * step); // (up a little, on his toes at most; only the kneeling tail gunner sinks to his)
      m.sink = (m.sink ?? sink) + (sink - (m.sink ?? sink)) * (m.leanSet ? 0.2 : 1);
      if (waist) {
        const H = b.hip - m.sink, a = Math.acos(THREE.MathUtils.clamp(H / 0.92, 0, 1));
        j.hips.position.y = H;
        for (const l of [j.legL, j.legR]) { l.hip.rotation.x = a; l.knee.rotation.x = -2 * a; }
      }
      const it = this.interior, fx = b.pos.x + want.x, fz = b.pos.z + want.z;
      if (it) { // (knees and boots out in front of him: a good way in from the skin)
        const lim = Math.max(Math.abs(b.pos.x), it.hw(fz, b.pos.y + 0.4) - (waist ? 0.34 : 0.42));
        if (Math.abs(fx) > lim) want.x = Math.sign(fx) * lim - b.pos.x;
      }
      const k = m.leanSet ? 0.2 : 1;
      lean.lerp(want, k); m.bend += (bend - m.bend) * k; m.leanSet = true;
    }
    const torso = b.torso - m.bend;
    if (firing) { // the guns hammer him about
      m.fig.position.set(b.pos.x + rand(-1, 1) * 0.005, b.pos.y + rand(-1, 1) * 0.004, b.pos.z + rand(-1, 1) * 0.005).add(lean);
      j.torso.rotation.x = torso + rand(-1, 1) * 0.025;
    } else {
      m.fig.position.copy(b.pos).add(lean);
      j.torso.rotation.x = torso;
    }
    // and his head stays inside: where the hull's low (the nose, the cheek windows) he stoops under it
    const room = this.interior;
    if (room && par && /^(nose|cheek)/.test(stationId)) { // (only in the nose, under its low glass: elsewhere it pulled men down through the floor)
      m.fig.updateMatrixWorld(true);
      const h = par.worldToLocal(j.head.getWorldPosition(_sa)), over = h.y + 0.24 - room.roofAt(h.z, h.x, b.pos.y + 0.4);
      m.duck = THREE.MathUtils.clamp((m.duck ?? 0) + (over > 0 ? over * 0.5 : -0.01), 0, 0.35); // (eased, and never more than a stoop)
      if (m.duck > 0) m.fig.position.y -= m.duck;
    }
  }

  /**
   * The radio operator at his desk is never still: he tunes the receiver, taps out on the Morse key,
   * writes up his log, holds an earphone to his ear to hear through the noise, and now and then looks
   * up through the hatch overhead. Each a few seconds, his hands easing from one to the next.
   */
  /**
   * The pilots fly her: both hands on the wheel (the pilot's right on the throttles), and now and then
   * a look round, out of his side window, across the other way, up at the formation, then ahead again.
   */
  pilotWork(dt) {
    const it = this.interior?.group;
    if (!it) return;
    for (const id of ['pilot', 'copilot']) {
      const m = this.member(id), f = m?.fig, b = f?.userData.base;
      if (!b || !f.visible || m.task !== 'station' || !(m.state === 'ok' || m.standIn)) continue;
      const s = id === 'pilot' ? -1 : 1, x = s * 0.55;
      m.wheel ??= [new V(), new V()];
      m.wheel[0].set(x - 0.15, 0.32, -8.09); m.wheel[1].set(x + 0.15, 0.32, -8.09);
      if (id === 'pilot') m.wheel[1].set(-0.06, 0.21, -8.06); // (his right hand on the throttles)
      for (const w of m.wheel) it.localToWorld(w);
      reachFor(f, m.wheel);
      // he sits forward to the wheel (and the pilot over to his throttles) until the farther hand is in
      // easy reach, his back off the seat, rather than his arm stretched out short of it
      const rig = f.userData.rig;
      if (rig) {
        const L = (rig.arms.l.a + rig.arms.l.b) * f.getWorldScale(_se).x + 0.075;
        const d = Math.max(rig.arms.l.upper.getWorldPosition(_sa).distanceTo(m.wheel[0]), rig.arms.r.upper.getWorldPosition(_sb).distanceTo(m.wheel[1]));
        m.sitLean = THREE.MathUtils.clamp((m.sitLean ?? 0) + (d - FAR * L) * 0.6, 0, 0.5);
        f.userData.j.torso.rotation.x = b.torso - m.sitLean;
      }
      if ((m.lookT = (m.lookT ?? rand(1, 4)) - dt) <= 0) {
        m.lookT = rand(2.5, 7);
        const r = Math.random();
        m.lookAt = r < 0.4 ? [0, 0] : r < 0.75 ? [-s * rand(0.6, 1.2), rand(-0.1, 0.15)] : r < 0.9 ? [s * rand(0.3, 0.6), 0] : [-s * rand(0.1, 0.4), rand(0.25, 0.45)];
      }
      const [ly, lp] = m.lookAt ?? [0, 0], k = 1 - Math.exp(-dt * 2.5), j = f.userData.j;
      m.headY = (m.headY ?? 0) + (ly - (m.headY ?? 0)) * k; m.headP = (m.headP ?? 0) + (lp - (m.headP ?? 0)) * k;
      j.head.rotation.y = m.headY; j.head.rotation.x = b.head + m.headP + (m.sitLean ?? 0); // (eyes kept ahead as he sits forward)
    }
  }

  radioWork(dt, time) {
    const m = this.member('radio'), f = m?.fig, b = f?.userData.base;
    if (!b || !f.visible || m.task !== 'station' || !(m.state === 'ok' || m.standIn) || !this.interior) return;
    if (m.role.station) return; // (he's at his gun under the roof hatch, not his desk)
    if ((m.jobT = (m.jobT ?? 0) - dt) <= 0) {
      const jobs = ['tune', 'key', 'write', 'listen', 'tune', 'write', 'look'].filter((j) => j !== m.job);
      m.job = jobs[Math.floor(Math.random() * jobs.length)];
      m.jobT = rand(2.5, 5.5);
    }
    const j = f.userData.j, it = this.interior.group, job = m.job;
    // (desk-top height: his hands rest on it between jobs)
    const restL = _sa.set(-0.8, -1.03, -1.92), restR = _sb.set(-0.56, -1.03, -1.9);
    let L = restL, R = restR, lean = 0.25, head = 0.35, turn = 0;
    if (job === 'tune') { R = _sb.set(-0.6, -0.953 + Math.sin(time * 1.3) * 0.004, -2.12 + Math.sin(time * 0.7) * 0.02); lean = 0.6; head = 0.15; turn = -0.15; }
    else if (job === 'key') { R = _sb.set(-0.47, -1.0 + Math.max(0, Math.sin(time * 19) * Math.sin(time * 2.3)) * 0.012, -2.095); lean = 0.55; head = 0.25; }
    else if (job === 'write') { R = _sb.set(-0.6 + Math.sin(time * 6) * 0.015, -1.035, -1.94 + Math.sin(time * 0.9) * 0.04); L = _sa.set(-0.7, -1.035, -1.86); lean = 0.45; head = 0.55; turn = 0.1; }
    else if (job === 'listen') {
      f.updateWorldMatrix(true, true);
      L = it.worldToLocal(j.head.getWorldPosition(_sa)).add(_sc.set(-0.11, 0.08, 0.02));
      head = 0.15; lean = 0.15; turn = 0.15;
    } else if (job === 'look') { head = -0.6; lean = 0.05; turn = 0.3; }
    const k = 1 - Math.exp(-dt * 4);
    (m.handL ??= L.clone()).lerp(L, k); (m.handR ??= R.clone()).lerp(R, k);
    m.workLean = (m.workLean ?? lean) + (lean - (m.workLean ?? lean)) * k;
    j.torso.rotation.x = b.torso - m.workLean; // (negative leans him forward)
    j.head.rotation.x = -(m.headX = (m.headX ?? head) + (head - (m.headX ?? head)) * k) + m.workLean * 0.6; // (headX > 0 looks down)
    j.head.rotation.y = (m.headY = (m.headY ?? turn) + (turn - (m.headY ?? turn)) * k);
    m.hands ??= [new V(), new V()];
    reachFor(f, [it.localToWorld(m.hands[0].copy(m.handL)), it.localToWorld(m.hands[1].copy(m.handR))]);
    f.userData.rig.grip = job === 'write' ? 0.8 : job === 'tune' ? 0.6 : 0.35;
  }

  /** The player has moved to `other`'s bomber: hand over the visible figures (and the interior). */
  handFiguresTo(other) {
    this.members.forEach((m, i) => {
      if (m.fig && m.fig.parent !== this.interior.group) this.interior.group.add(m.fig); // (a figure that went down with the tail comes back aboard: it's now another man)
      other.members[i].fig = m.fig; m.fig = null;
    });
    Object.assign(other, { visible: true, interior: this.interior });
    Object.assign(this, { visible: false, interior: null });
    for (const m of this.members) { // the crew left behind carries on unseen
      if (m.task === 'helping') m.walkT = rand(4, 12);
      if (m.task === 'bailing') m.walkT = rand(2, 8); // (his walk to the hatch, unseen)
      if (m.task === 'returning') m.task = 'station';
    }
    for (const m of other.members) { // the crew we join: at their posts, or where they fell
      if (m.task === 'helping' || m.task === 'returning') { m.task = 'station'; m.patient = null; }
      if (m.task === 'bailing' && m.state === 'ok') m.path = walkPath(m.pos, m.hatch.pos.clone()); // (on his way out: seen walking there now)
      if (m.state === 'wounded' || m.state === 'dead') { m.task = 'down'; m.pos = new V(...m.spot.lie); }
      other.place(m);
    }
    // then send helpers (in a second pass, so resetting a later man can't cancel one just sent)
    for (const m of other.members) if (m.state === 'wounded') other.findHelper({ member: m });
  }

  /** The player takes this man's place (a living AI crewman). The man you were is `previous`. */
  becomePlayer(m) {
    m.state = 'player';
    m.standIn = false;
    m.task = 'station';
    this.place(m);
  }

  /** The player died: become another living man of this crew (gunners first). Returns him or null. */
  takeOver(player) {
    const me = this.members.find((m) => m.state === 'player');
    const order = ['tail', 'waistL', 'waistR', 'ball', 'engineer', 'navigator', 'bombardier', 'copilot', 'pilot'];
    const next = order.map((id) => this.member(id)).find((m) => m.state === 'ok');
    if (!next) return null;
    if (me) {
      me.state = 'dead';
      me.standIn = false;
      me.spot = { ...me.spot, lie: player.feet.toArray(), liePose: 'lie' }; // he lies where you fell
      this.place(me);
    }
    next.state = 'player';
    next.standIn = false;
    next.task = 'station';
    this.place(next);
    return next;
  }

  // ---------- gunnery ----------
  /**
   * Aim for an AI gunner at `station`: picks a fighter in his arc, leads it, fires in bursts.
   * Returns { dir (bomber space), yawRel, fire, aimPoint (world) } or null when there's nothing to shoot.
   */
  aim(station, fighters, dt) {
    const g = this.gunners.get(station.id) ?? { target: null, retarget: 0, burst: 0, pause: rand(0, 1), err: new V(), lead: 1 };
    this.gunners.set(station.id, g);
    const bm = this.bomber.group.matrixWorld;
    const local = station.local ?? (station.local = new V(...(station.pivot ?? station.eye.toArray())));
    const origin = local.clone().applyMatrix4(bm);
    if (this.invAt !== this.frame) { this.invAt = this.frame; this.inv = (this.inv ?? new THREE.Matrix4()).copy(bm).invert(); } // once a frame
    const inv = this.inv;
    const inArc = (f) => {
      const d = f.pos.clone().applyMatrix4(inv).sub(local).normalize();
      const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      return Math.abs(wrap(yaw - station.yaw)) <= station.yawLim && pitch >= station.pitch[0] && pitch <= station.pitch[1];
    };
    if ((g.retarget -= dt) <= 0 || !g.target?.alive || !inArc(g.target) || g.target.pos.distanceTo(origin) > GUN_RANGE) {
      g.retarget = rand(1, 2);
      let best = null, score = Infinity;
      for (const f of fighters.list) {
        if (!f.alive || f.side !== 'axis') continue;
        const d = f.pos.distanceTo(origin);
        if (d > GUN_RANGE || !inArc(f)) continue;
        const s = d * (f.target === this.bomber && f.state === 'attack' ? 0.5 : 1); // the one coming at us first
        if (s < score) { score = s; best = f; }
      }
      // a new target takes him a moment: spotting it, swinging the guns round, getting it in the sight
      if (best && best !== g.target) g.pause = Math.max(g.pause, rand(...ACQUIRE));
      g.target = best;
    }
    if (!g.target) return null;
    const f = g.target, dist = f.pos.distanceTo(origin), vel = f.velocity;
    // how fast it crosses his line of sight: the hard deflection shots are where gunners missed most
    const los = _los.copy(f.pos).sub(origin).normalize();
    const crossing = _cross.copy(vel).addScaledVector(los, -vel.dot(los)).length();
    // a human lead, judged by eye (each burst a bit under or over), plus an aiming error that grows with
    // range and crossing speed and shrinks as he walks his tracers onto the target
    const aimPoint = f.pos.clone().addScaledVector(vel, (dist / 850) * g.lead).add(g.err);
    if (g.pause > 0) {
      if ((g.pause -= dt) <= 0) {
        g.burst = rand(...BURST);
        g.lead = rand(0.45, 1.25);
        const spray = Math.random() < SPRAY ? 4 : 1; // a nervous burst at nothing much
        g.err.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(dist * AIM_ERROR * (1 + crossing / 90) * spray);
        // friendly fire is real: a gunner holds his burst if another B-17 is in the line of fire
        g.clear = this.lineClear(origin, aimPoint, fighters.nearBombers());
      }
    } else {
      g.err.multiplyScalar(Math.exp(-dt * 0.6)); // walking the tracers in
      if ((g.burst -= dt) <= 0) g.pause = rand(...PAUSE);
    }
    const dir = aimPoint.clone().applyMatrix4(inv).sub(local).normalize();
    const yawRel = wrap(Math.atan2(-dir.x, -dir.z) - station.yaw);
    return { dir, yawRel, fire: g.pause <= 0 && dist < FIRE_RANGE && g.clear !== false, aimPoint, origin };
  }

  /** No other bomber within 30 m of the line from `from` to `to`? */
  lineClear(from, to, bombers) {
    const ab = _ab.subVectors(to, from), len2 = ab.lengthSq() || 1;
    for (const b of bombers) {
      if (b === this.bomber || b.gone) continue;
      const t = THREE.MathUtils.clamp(_ap.subVectors(b.group.position, from).dot(ab) / len2, 0, 1);
      if (_ap.copy(from).addScaledVector(ab, t).distanceToSquared(b.group.position) < 900) return false;
    }
    return true;
  }

  /** AI gunners of a bomber we don't see from inside: fire straight from their positions. */
  fireUnseen(stations, fighters, bullets, audio, playerPos, dt) {
    const shown = this.bomber.model && !this.bomber.down; // (near enough to have a model: its turrets turn as they aim)
    this.turretT = (this.turretT ?? 0) + dt;
    if (this.bomber.down || !this.bomber.gunsActive || this.bomber.group.position.distanceTo(playerPos) > ACTIVE_RANGE) {
      if (shown) for (const id of ['ball', 'top']) this.bomber.aimTurret(id, null, dt, this.turretT);
      return;
    }
    for (const s of stations) {
      if (!s.guns || !this.manned(s.id)) continue;
      const a = this.aim(s, fighters, dt);
      if (shown && (s.id === 'ball' || s.id === 'top')) this.bomber.aimTurret(s.id, a?.dir ?? null, dt, this.turretT);
      const g = this.gunners.get(s.id);
      if (!a?.fire) { g.timer = 0; continue; }
      g.timer = (g.timer ?? 0) - dt;
      while (g.timer <= 0) {
        g.timer += 60 / AI_RPM; // one simulated stream per position, even for twin guns, to save work
        const d = a.aimPoint.clone().sub(a.origin).normalize();
        d.x += rand(-1, 1) * AI_SPREAD; d.y += rand(-1, 1) * AI_SPREAD; d.z += rand(-1, 1) * AI_SPREAD;
        bullets.spawn(a.origin.clone().addScaledVector(d, 1.5), d.normalize().multiplyScalar(890), (g.n = (g.n ?? 0) + 1) % 5 === 0, 'allied', 'crew', false, this.bomber, 1.4);
      }
      if (Math.random() < dt * 6) audio.distantGun(a.origin.distanceTo(playerPos));
    }
  }
}

export { WOUND_TIME, REVIVE_TIME };
