// The ten men of every bomber: who mans which gun, being wounded, first aid, and the AI gunners.
// In the player's bomber the crew are visible figures who walk to help the wounded; in every other
// bomber the same rules run without figures.
import * as THREE from 'three';
import { SECTIONS } from './bomber.js';

const V = THREE.Vector3, D = Math.PI / 180;
const _ab = new V(), _ap = new V(), _los = new V(), _cross = new V();
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const WOUND_TIME = 30, REVIVE_TIME = 4, WALK = 1.2; // s, s, m/s
const GUN_RANGE = 900, FIRE_RANGE = 650, AI_RPM = 750, AI_SPREAD = 0.006;
const AIM_ERROR = 0.03; // rad: real bomber gunners hit very little at range (grows with crossing speed)
const ACQUIRE = [0.8, 2.2], BURST = [0.5, 1.3], PAUSE = [1.4, 3.5], SPRAY = 0.1; // s, s, s, chance of a burst at nothing much
const ACTIVE_RANGE = 1200; // bombers further than this from the player don't simulate their gunners
export const tally = { saved: 0, savedByYou: 0 }; // for the debrief

export const ROLES = [
  { id: 'pilot', title: 'Pilot', rank: 'Lt.', station: 'pilot' },
  { id: 'copilot', title: 'Co-pilot', rank: 'Lt.', station: 'copilot' },
  { id: 'bombardier', title: 'Bombardier', rank: 'Lt.', station: 'chin' },
  { id: 'navigator', title: 'Navigator', rank: 'Lt.', station: 'cheekL' },
  { id: 'engineer', title: 'Engineer', rank: 'T/Sgt.', station: 'top' },
  { id: 'radio', title: 'Radio operator', rank: 'T/Sgt.', station: null },
  { id: 'ball', title: 'Ball gunner', rank: 'S/Sgt.', station: 'ball' },
  { id: 'waistL', title: 'Left waist', rank: 'S/Sgt.', station: 'waistL' },
  { id: 'waistR', title: 'Right waist', rank: 'S/Sgt.', station: 'waistR' },
  { id: 'tail', title: 'Tail gunner', rank: 'S/Sgt.', station: 'tail' },
];
const SURNAMES = ['Miller', 'Kowalski', 'Brennan', 'Haskell', 'DeLuca', 'Ostrowski', 'Reyes', 'Lindqvist', 'Murphy', 'Abbott', 'Fischer',
  'Grady', 'Novak', 'Turner', 'Callahan', 'Whitfield', 'Romano', 'Sorensen', 'Jablonski', 'Barlow', 'Dunn', 'Kessler', 'McKay', 'Stroud'];

// where each man is in the player's bomber: spot = feet, pose, yaw (0 = facing the nose); lie = where he falls
const SPOTS = {
  pilot: { at: [-0.55, 0.05, -7.6], pose: 'sit', yaw: 0, lie: [-0.55, 0.05, -7.6], liePose: 'slump', help: [-0.18, -0.40, -7.2] },
  copilot: { at: [0.55, 0.05, -7.6], pose: 'sit', yaw: 0, lie: [0.55, 0.05, -7.6], liePose: 'slump', help: [0.18, -0.40, -7.2] },
  bombardier: { at: [0, -0.3, -10.19], pose: 'sit', yaw: 0, lie: [0.05, -0.72, -9.6], liePose: 'lie' },
  navigator: { at: [-0.35, -0.72, -9.45], pose: 'crouch', yaw: 70 * D, lie: [-0.2, -0.72, -9.1], liePose: 'lie' },
  engineer: { at: [0, -0.28, -6.78], pose: 'stand', yaw: 0, lie: [0.1, -0.40, -7.05], liePose: 'lie' },
  radio: { at: [-0.67, -1.35, -1.57], pose: 'sit', yaw: 90 * D, lie: [-0.1, -1.80, -1.8], liePose: 'lie' },
  ball: { at: [0, -2.2, -0.13], pose: 'hidden', yaw: 0, lie: [0.05, -1.95, 0.95], liePose: 'lie' }, // pulled out of the turret
  waistL: { at: [-0.35, -1.95, 1.75], pose: 'gun', yaw: 90 * D, lie: [-0.2, -1.95, 2.3], liePose: 'lie' },
  waistR: { at: [0.35, -1.95, 1.85], pose: 'gun', yaw: -90 * D, lie: [0.2, -1.95, 1.3], liePose: 'lie' },
  tail: { at: [0, -2.32, 9.75], pose: 'kneel', yaw: 180 * D, lie: [0, -2.32, 9.3], liePose: 'lie' },
};

// the walkway through the fuselage, nose to tail, through the doors and round the ball turret
const CORRIDOR = [[0, -0.72, -10.0], [0, -0.72, -8.8], [0, -0.40, -8.4], [0, -0.40, -6.6], [0, -0.72, -6.22], [0, -1.02, -5.97],
  [0, -1.32, -5.72], [0, -1.62, -5.4], [0, -1.62, -2.75], [0, -1.80, -2.45], [0, -1.80, -1.4], [0, -1.95, -1.05], [0.6, -1.95, -0.7],
  [0.6, -1.95, 0.4], [0, -1.95, 0.8], [0, -1.95, 5.0], [0, -2.15, 5.4], [0, -2.15, 8.0], [0, -2.32, 8.4], [0, -2.32, 9.5]].map((p) => new V(...p));

/** How the man at a station sits or stands there (for the player's own body). */
export function spotFor(stationId) {
  const role = ROLES.find((r) => r.station === stationId);
  return role ? SPOTS[role.id] : null;
}

function sectionAt(z) { return SECTIONS.find(([, z0, z1]) => z >= z0 && z < z1)?.[0] ?? 'waist'; }

function walkPath(from, to) {
  const near = (p) => CORRIDOR.reduce((bi, c, i) => (c.distanceTo(p) < CORRIDOR[bi].distanceTo(p) ? i : bi), 0);
  const a = near(from), b = near(to), pts = [from.clone()];
  for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) pts.push(CORRIDOR[i].clone());
  pts.push(to.clone());
  return pts;
}

// ---------- figures ----------
const fmat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r, envMapIntensity: 0.1 });
const FM = { suit: fmat(0x56482f), jacket: fmat(0x4a3220, 0.65), fleece: fmat(0xcfc4a8, 1), skin: fmat(0xbf9175, 0.7), helmet: fmat(0x3b2a1c, 0.6), boot: fmat(0x1e1a16, 0.6), mask: fmat(0x3d4237, 0.5) };

function limb(len, r, mat) { // a capsule hanging down from its joint
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 3, 8).translate(0, -len / 2, 0), mat);
  m.receiveShadow = true; // not cast: ~120 extra draw calls in the shadow pass for very little
  return m;
}

/** A low-poly airman in flight gear. Feet at the origin, facing -Z. */
export function makeFigure() {
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const body = limb(0.62, 0.19, FM.jacket); body.position.y = 0.62; torso.add(body);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.06, 6, 12).rotateX(Math.PI / 2), FM.fleece); collar.position.y = 0.6; torso.add(collar);
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10).translate(0, 0.12, 0), FM.skin); head.add(face);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, 0.13, 0.01), FM.helmet); head.add(helmet);
  const mask = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.07).translate(0, 0.07, -0.1), FM.mask); head.add(mask);
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.55, 0); torso.add(sh);
    sh.add(limb(0.32, 0.065, FM.jacket));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    el.add(limb(0.3, 0.055, FM.suit));
    return { sh, el };
  };
  const leg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, 0, 0); hips.add(hip);
    hip.add(limb(0.46, 0.085, FM.suit));
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    knee.add(limb(0.44, 0.075, FM.suit));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.26).translate(0, -0.46, -0.05), FM.boot); knee.add(boot);
    return { hip, knee };
  };
  root.userData.j = { hips, torso, head, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1) };
  return root;
}

/** Set a pose: joint angles in radians (x = forward/back, z = sideways). `t` animates walking. */
export function pose(fig, name, t = 0) {
  const j = fig.userData.j;
  const set = (o, x = 0, z = 0) => o.rotation.set(x, 0, z);
  fig.visible = name !== 'hidden';
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
    case 'gun': // standing at a gun, both hands on the spade grips
      for (const a of [j.armL, j.armR]) { set(a.sh, 1.1, 0); set(a.el, 0.6); }
      set(j.torso, 0.12);
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
    const names = [...SURNAMES].sort(() => Math.random() - 0.5);
    this.members = ROLES.map((role, i) => ({
      role, name: `${role.rank} ${names[i]}`, state: role.id === playerRole ? 'player' : 'ok',
      woundLeft: 0, task: 'station', spot: SPOTS[role.id],
    }));
    this.gunners = new Map(); // station id -> aim state
    this.listeners = [];
    if (visible) {
      for (const m of this.members) {
        m.fig = makeFigure();
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
    const at = player?.station?.id === 'bombsight' ? 'chin' : player?.station?.id; // the bombardier mans both
    if (player && at === stationId) return false;
    const m = this.members.find((x) => x.role.station === stationId);
    return !!m && m.state === 'ok' && m.task === 'station';
  }

  /** A round struck the bomber at `local` (bomber space): anyone close by in that section may be hurt. */
  onHit(part, local, cannon, player) {
    if (part.kind !== 'section') return;
    for (const m of this.members) {
      if (m.state !== 'ok') continue;
      const p = new V(...(m.task === 'station' ? m.spot.at : m.pos?.toArray() ?? m.spot.at)).add(new V(0, 0.9, 0));
      if (sectionAt(p.z) !== part.section) continue;
      const near = Math.max(0, 1 - p.distanceTo(local) / 2.2);
      if (Math.random() < near * (cannon ? 0.6 : 0.3)) this.wound(m);
    }
    if (player && !player.wounded && !player.dead) {
      const p = player.feet.clone().add(new V(0, 0.9, 0));
      const near = Math.max(0, 1 - p.distanceTo(local) / 2.0);
      if (Math.random() < near * (cannon ? 0.6 : 0.3)) { player.wound(); this.emit("You're hit!"); this.findHelper({ player }); }
    }
  }

  wound(m) {
    const walking = m.task !== 'station' && m.pos; // hit on his way somewhere: he falls where he is
    m.state = 'wounded';
    m.woundLeft = WOUND_TIME;
    m.task = 'down';
    m.pos = walking ? m.pos.clone() : new V(...m.spot.lie);
    if (walking) m.spot = { ...m.spot, lie: m.pos.toArray() };
    if (this.visible) this.place(m);
    this.emit(`${m.role.title}'s hit!`);
    this.findHelper({ member: m });
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
      helper.path = walkPath(helper.pos, where.clone().add(new V(0.3, 0, 0)));
    } else helper.walkT = rand(4, 18); // time to get there and work, in a bomber we don't see
  }

  update(dt, { player, time }) {
    this.frame = (this.frame ?? 0) + 1;
    for (const m of this.members) {
      if (m.state === 'wounded' && (m.woundLeft -= dt) <= 0) {
        m.state = 'dead';
        this.emit(`${m.role.title} ${m.name} is dead.`);
        if (this.visible) this.place(m);
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
    // at the patient: kneel and work on him
    pose(m.fig, 'kneel');
    if ((m.reviveT += dt) >= REVIVE_TIME) this.revive(p);
  }

  revive(p, byPlayer = false) {
    if (this.visible) tally.saved++;
    if (byPlayer) tally.savedByYou++;
    if (p.player) { p.player.revive(); this.emit("You're patched up. Back to your post!"); } else {
      p.member.state = 'ok';
      p.member.task = 'station';
      p.member.woundLeft = 0;
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
    pose(m.fig, m.pos.z > 5.2 ? 'crouch' : 'walk', time);
    if (!m.path.length) arrive?.();
  }

  /** Put a figure where his state says he should be. */
  place(m) {
    if (!m.fig) return;
    const s = m.spot;
    if (m.state === 'player' || m.state === 'bailed') { m.fig.visible = false; return; } // (you, or out of the plane)
    const down = m.state === 'wounded' || m.state === 'dead';
    m.fig.position.set(...(down ? s.lie : s.at));
    m.fig.rotation.y = s.yaw + (down && s.liePose === 'lie' ? 1.2 : 0);
    pose(m.fig, down ? s.liePose : s.pose);
    m.fig.visible = !(m.displaced && !down) && !(down ? false : s.pose === 'hidden');
  }

  /** The player has taken (or left) this man's gun: he steps out of the way meanwhile. */
  setDisplaced(stationId) {
    if (stationId === 'bombsight') stationId = 'chin'; // the bombardier's seat is right at the sight
    for (const m of this.members) {
      const was = m.displaced;
      m.displaced = m.role.station === stationId && m.state === 'ok' && m.task === 'station';
      if (was !== m.displaced) this.place(m);
    }
  }

  /** The player has moved to `other`'s bomber: hand over the visible figures (and the interior). */
  handFiguresTo(other) {
    this.members.forEach((m, i) => { other.members[i].fig = m.fig; m.fig = null; });
    Object.assign(other, { visible: true, interior: this.interior });
    Object.assign(this, { visible: false, interior: null });
    for (const m of this.members) { // the crew left behind carries on unseen
      if (m.task === 'helping') m.walkT = rand(4, 12);
      if (m.task === 'returning') m.task = 'station';
    }
    for (const m of other.members) { // the crew we join: at their posts, or where they fell
      if (m.task === 'helping' || m.task === 'returning') { m.task = 'station'; m.patient = null; }
      if (m.state === 'wounded' || m.state === 'dead') { m.task = 'down'; m.pos = new V(...m.spot.lie); }
      other.place(m);
    }
    // then send helpers (in a second pass, so resetting a later man can't cancel one just sent)
    for (const m of other.members) if (m.state === 'wounded') other.findHelper({ member: m });
  }

  /** The player takes this man's place (a living AI crewman). The man you were is `previous`. */
  becomePlayer(m) {
    m.state = 'player';
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
      me.spot = { ...me.spot, lie: player.feet.toArray(), liePose: 'lie' }; // he lies where you fell
      this.place(me);
    }
    next.state = 'player';
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
    if (this.bomber.down || !this.bomber.gunsActive || this.bomber.group.position.distanceTo(playerPos) > ACTIVE_RANGE) return;
    for (const s of stations) {
      if (!s.guns || !this.manned(s.id)) continue;
      const a = this.aim(s, fighters, dt);
      const g = this.gunners.get(s.id);
      if (!a?.fire) { g.timer = 0; continue; }
      g.timer = (g.timer ?? 0) - dt;
      while (g.timer <= 0) {
        g.timer += 60 / AI_RPM; // one simulated stream per position, even for twin guns, to save work
        const d = a.aimPoint.clone().sub(a.origin).normalize();
        d.x += rand(-1, 1) * AI_SPREAD; d.y += rand(-1, 1) * AI_SPREAD; d.z += rand(-1, 1) * AI_SPREAD;
        bullets.spawn(a.origin.clone().addScaledVector(d, 1.5), d.normalize().multiplyScalar(890), (g.n = (g.n ?? 0) + 1) % 4 === 0, 'allied', 'crew', false, this.bomber, 1.4);
      }
      if (Math.random() < dt * 6) audio.distantGun(a.origin.distanceTo(playerPos));
    }
  }
}

export { WOUND_TIME, REVIVE_TIME };
