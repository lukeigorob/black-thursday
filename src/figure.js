// A B-17 crewman of 14 October 1943 (public/models/crew/crewman1943.glb): a realistic young man (MPFB /
// MakeHuman, CC0: a proper face, skin and body, on a game-engine skeleton) in the kit the research says
// each station wore that day (hackathon/CREW_GEAR_RESEARCH.md), every piece modelled on him in Blender
// and baked to textures (scripts/crew/: build_crew.py, bake_export.py), all skinned to the one skeleton:
// - outfits (one shown per man, OUTFITS): the B-3 sheepskin jacket and A-3 trousers (the waist and tail
//   gunners at their open windows), the olive B-10 with its mouton collar and olive trousers, the pilots'
//   A-2 with knit cuffs, or the ball gunner's blue F-1 heated suit alone;
// - on his head (HEADGEAR): the B-6 helmet (its sheepskin lining turned out round the face, the earphones,
//   the chin strap) with the goggles up on it, or, for the pilots (opts.cap), the officer's cap crushed
//   under an HS-38 headset, his short hair showing;
// - on everyone: the A-10 Revised mask on its head straps, its corrugated hose, A-6 boots, leather gloves
//   with gauntlets, and the plain olive drab parachute harness with its leg loops, snaps and D-rings;
// - the yellow B-4 Mae West (all but the ball gunner), and the dark green M1 flak vest with its red pull
//   for the men who had one (opts.flak).
// Only the face is left of the body: everything else is always under the clothes, so nothing pokes through.
//
// The figure is posed through a simple joint rig (userData.j: hips, torso, head, arms, legs, as before)
// that pose() and the crew code drive; syncFigures() copies it onto the skeleton each frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { insideLight } from './cabinlook.js';

const V = THREE.Vector3, Q = THREE.Quaternion;
let BASE = null; // the dressed model, loaded once: cloned for each man
const figures = new Set();

// the meshes of each outfit, and the kit every man wears (the GLB's mesh names)
const OUTFITS = { sheep: ['gear_b3', 'gear_a3'], b3od: ['gear_b3', 'gear_od'], b10: ['gear_b10', 'gear_od'], a2: ['gear_a2', 'gear_od'], f1: ['gear_f1'] };
const WORN = ['Human', 'gear_boots', 'gear_gloves', 'gear_mask', 'gear_harness'];
// on his head: the B-6 helmet and goggles, or (the pilots, opts.cap) the crushed officer's cap and HS-38
// headset, his hair showing under it
const HEADGEAR = { helmet: ['gear_helmet', 'gear_goggles'], cap: ['gear_cap', 'gear_headset', 'Humanshort02'] }; // (three.js drops the dot from the glTF's names)
const CHEST = ['gear_maewest', 'gear_flak']; // (off on your own body: they sat round your eyes)
const SCALE = 1.05; // the model is 1.65 m: a man of 1.73, the airmen's average
// inside the bomber the crew catch more of the light from the windows than the hull round them does (cabinlook.js
// INSIDE_AMBIENT 0.3): without it a man in brown leather seen from behind is a black shape
const CREW_AMBIENT = 0.5;

/** Load the crewman (once, before any figure is made). */
export async function loadCrewModel() {
  if (BASE) return;
  const gltf = await new GLTFLoader().loadAsync('models/crew/crewman1943.glb');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const done = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true;
    for (const m of [o.material].flat()) {
      if (done.has(m)) continue;
      done.add(m);
      m.envMapIntensity = 0.35;
      if (/eyebrow|eyelash|short/i.test(o.name)) { m.transparent = false; m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.depthWrite = true; }
      if (/mask|maewest|flak/.test(o.name)) m.side = THREE.DoubleSide; // (thin shells: seen from inside at their edges)
      insideLight(m, CREW_AMBIENT);
    }
  });
  let top = 0;
  scene.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); top = Math.max(top, o.geometry.boundingBox.max.y); } });
  BASE = { scene, info: { height: top * SCALE } };
}

export const crewInfo = () => BASE?.info;

// ---- the pose rig: the same joints the crew code has always driven
function makeRig(root) {
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.22).translate(0, 0.13, 0)); // (head size, for fitting him under the roof)
  marker.visible = false; head.add(marker);
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 0.53, 0); torso.add(sh);
    const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
    return { sh, el };
  };
  const leg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0, 0); hips.add(hip);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    return { hip, knee };
  };
  return { hips, torso, head, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1) };
}

const _q = new Q(), _q2 = new Q(), _v = new V(), _m = new THREE.Matrix4(), _t = new V(), _s = new V();
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

/**
 * opts.outfit: 'sheep' | 'b10' | 'a2' | 'f1' (OUTFITS; opts.pilot: the A-2). opts.flak: the M1 vest over the
 * Mae West. opts.self: your own body (no head: it would sit round your eyes). Feet at the origin, facing -Z.
 */
export function makeFigure(opts = {}) {
  if (!BASE) throw new Error('loadCrewModel() first');
  const root = new THREE.Group();
  const j = makeRig(root);
  const model = cloneSkinned(BASE.scene);
  model.rotation.y = Math.PI; // the model faces +Z; the crew face -Z
  root.add(model);
  model.scale.setScalar(SCALE);
  const kind = OUTFITS[opts.outfit] ? opts.outfit : opts.pilot ? 'a2' : 'sheep';
  const show = new Set([...WORN, ...OUTFITS[kind], ...HEADGEAR[opts.cap ? 'cap' : 'helmet']]);
  if (kind !== 'f1') show.add('gear_maewest'); // (the ball gunner wore none in his turret)
  if (opts.flak) show.add('gear_flak');
  let skel = null;
  const chest = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name.replace(/_\d+$/, '');
    const face = /^Human|eye|low-poly/i.test(name) && !/short/.test(name); // (the face, its eyes, brows and lashes; not the hair)
    o.visible = face || show.has(name);
    if (CHEST.includes(name) && o.visible) { o.userData.on = true; chest.push(o); }
    if (o.isSkinnedMesh) skel ??= o.skeleton;
  });
  const bones = Object.fromEntries(skel.bones.map((b) => [b.name, b]));
  if (opts.self) { // (your own: no head, and no chest kit round your eyes when you look down)
    bones.Head.scale.setScalar(0.001);
    root.userData.self = true;
    for (const c of chest) c.userData.on = false;
  }

  // bind the rig to the skeleton: put the rig in the model's rest pose (its limbs pointing the way the
  // bones do), and remember, for each bone, its rotation relative to its rig joint
  root.updateMatrixWorld(true);
  // where the mask's hose ends, clipped to the harness on his chest (build_crew.py: 26 cm under the neck,
  // 12 cm to his left, 15 cm out in front), carried by the upper spine: the oxygen line runs on from there
  const clip = bones.spine_03.worldToLocal(bones.neck_01.getWorldPosition(new V())
    .add(new V(0.12, -0.26, 0.15).multiplyScalar(SCALE).applyQuaternion(model.getWorldQuaternion(new Q())).multiply(root.getWorldScale(new V()))));
  const hose = makeHose(); root.add(hose);
  const dirOf = (a, b) => bones[b].getWorldPosition(new V()).sub(bones[a].getWorldPosition(new V())).normalize();
  const aim = (joint, dir) => { // turn a joint so its -Y (down the limb) points along dir (world)
    joint.parent.getWorldQuaternion(_q).invert();
    joint.quaternion.setFromUnitVectors(new V(0, -1, 0), dir.clone().applyQuaternion(_q));
    joint.updateMatrixWorld(true);
  };
  aim(j.armL.sh, dirOf('upperarm_l', 'lowerarm_l')); aim(j.armL.el, dirOf('lowerarm_l', 'hand_l'));
  aim(j.armR.sh, dirOf('upperarm_r', 'lowerarm_r')); aim(j.armR.el, dirOf('lowerarm_r', 'hand_r'));
  aim(j.legL.hip, dirOf('thigh_l', 'calf_l')); aim(j.legL.knee, dirOf('calf_l', 'foot_l'));
  aim(j.legR.hip, dirOf('thigh_r', 'calf_r')); aim(j.legR.knee, dirOf('calf_r', 'foot_r'));
  const map = [ // [bone, rig joint], parents before children
    ['pelvis', j.hips], ['spine_01', j.torso], ['spine_02', j.torso], ['spine_03', j.torso], ['neck_01', j.head], ['Head', j.head],
    ['clavicle_l', j.torso], ['upperarm_l', j.armL.sh], ['lowerarm_l', j.armL.el], ['hand_l', j.armL.el],
    ['clavicle_r', j.torso], ['upperarm_r', j.armR.sh], ['lowerarm_r', j.armR.el], ['hand_r', j.armR.el],
    ['thigh_l', j.legL.hip], ['calf_l', j.legL.knee], ['foot_l', j.legL.knee], ['thigh_r', j.legR.hip], ['calf_r', j.legR.knee], ['foot_r', j.legR.knee],
  ].map(([name, joint]) => {
    const bone = bones[name];
    const off = joint.getWorldQuaternion(new Q()).invert().multiply(bone.getWorldQuaternion(new Q()));
    return { bone, joint, off };
  });
  const pelvisAt = j.hips.worldToLocal(bones.pelvis.getWorldPosition(new V())); // the pelvis in the hips joint's frame
  // each finger joint's own bend axis, from the skeleton in its rest pose: it curls the finger towards
  // the palm (whose normal comes from the hand's forward and across directions); the thumb across it
  const fingers = [], W = (n) => bones[n].getWorldPosition(new V());
  for (const s of ['l', 'r']) {
    const hand = W(`hand_${s}`), across = W(`index_01_${s}`).sub(W(`pinky_01_${s}`)).normalize();
    const along = W(`middle_01_${s}`).sub(hand).normalize();
    const palm = new V().crossVectors(along, across).normalize();
    if (palm.y > 0) palm.negate(); // (the rest pose holds the arms out, palms down)
    for (const f of [...FINGERS, 'thumb']) for (let k = 1; k <= 3; k++) {
      const b = bones[`${f}_0${k}_${s}`], c = bones[`${f}_0${k + 1}_${s}`] ?? bones[`${f}_04_leaf_${s}`];
      if (!b || !c) continue;
      const dir = W(c.name).sub(W(b.name)).normalize();
      const toward = f === 'thumb' ? palm.clone().multiplyScalar(0.7).addScaledVector(across, -0.7).normalize() : palm; // the thumb closes across the palm
      const axis = new V().crossVectors(dir, toward).normalize().applyQuaternion(b.getWorldQuaternion(new Q()).invert());
      fingers.push({ b, rest: b.quaternion.clone(), axis, thumb: f === 'thumb', k });
    }
  }
  // the arms' bone lengths, for reaching the grips (two-bone IK)
  const arm = (s) => ({ upper: bones[`upperarm_${s}`], lower: bones[`lowerarm_${s}`], hand: bones[`hand_${s}`], a: W(`upperarm_${s}`).distanceTo(W(`lowerarm_${s}`)), b: W(`lowerarm_${s}`).distanceTo(W(`hand_${s}`)) });
  const arms = { l: arm('l'), r: arm('r') };
  // the rig back to its neutral pose (pose() sets it from here)
  for (const g of [j.armL.sh, j.armL.el, j.armR.sh, j.armR.el, j.legL.hip, j.legL.knee, j.legR.hip, j.legR.knee]) g.quaternion.identity();
  root.userData.j = j;
  root.userData.model = model;
  root.userData.rig = { map, bones, pelvisAt, fingers, arms, grip: 0.35, root, reach: null, chest, clip, hose };
  figures.add(root);
  return root;
}

/**
 * Put his hands on the grips: [left, right] world positions (or null to let the pose's arms be). The
 * arms reach with two-bone IK each frame, the elbows down and out, and the fingers close round them.
 */
export function reachFor(fig, grips) {
  const rig = fig.userData.rig;
  if (!rig) return;
  if (!grips) { rig.reach = null; return; }
  rig.reach ??= [new V(), new V()];
  rig.free = [!grips[0], !grips[1]]; // (a null hand stays as posed)
  for (let i = 0; i < 2; i++) if (grips[i]) rig.reach[i].copy(grips[i]);
  rig.grip = 1;
}

/** Curl the fingers: 0 open, 1 a fist round a grip. */
export function grip(fig, amount) { if (fig.userData.rig) fig.userData.rig.grip = amount; }

/** Copy each figure's rig pose onto its skeleton (call once a frame, before drawing). */
export function syncFigures() {
  for (const fig of figures) {
    if (!fig.visible || !fig.parent) continue;
    let o = fig.parent, shown = true;
    while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
    if (shown) sync(fig);
  }
}

function sync(fig) {
  const { map, bones, pelvisAt, fingers, chest, grip: g } = fig.userData.rig;
  fig.updateMatrixWorld(true);
  // the pelvis follows the hips joint
  const pelvis = bones.pelvis;
  pelvis.position.copy(pelvis.parent.worldToLocal(fig.userData.j.hips.localToWorld(_v.copy(pelvisAt))));
  // (parents before children, each bone's world matrix worked out once from its parent's, which is
  // already this frame's: no climbing back up the chain or down through the fingers for every bone)
  for (const { bone, joint, off } of map) {
    joint.matrixWorld.decompose(_t, _q, _s); _q.multiply(off); // where the bone should point, in the world
    bone.parent.matrixWorld.decompose(_t, _q2, _s); _q2.invert();
    bone.quaternion.copy(_q2.multiply(_q));
    bone.updateMatrix(); bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
  }
  if (fig.userData.self) bones.Head.scale.setScalar(0.001); // (your own: never drawn round your eyes)
  else bones.Head.scale.setScalar(fig.userData.noHead ? 0.01 : 1);
  for (const c of chest) c.visible = c.userData.on && !fig.userData.noHead; // (and the Mae West under your chin)
  if (fig.userData.rig.reach) reach(fig.userData.rig, fig);
  for (const f of fingers) { // curl about each joint's own bend axis: more at the knuckle, a fist at 1
    f.b.quaternion.copy(f.rest).multiply(_q.setFromAxisAngle(f.axis, g * (f.thumb ? 0.45 : [0, 1.15, 1.3, 0.9][f.k])));
  }
  oxygenLine(fig);
}

// ---- the oxygen line: from the clip on his chest to the A-12 regulator at his post (the nearest outlet
// the cabin has, interiordetail.js), a rubber hose hanging slack between them. Away from any (moving
// through the ship, bailing out) he's off the line, as men were on a walk-around bottle.
const HOSE_LEN = 1.7, HOSE_SEG = 200, HOSE_SIDES = 8, HOSE_R = 0.011; // (rings close enough to draw its corrugations)
const hoseMat = new THREE.MeshStandardMaterial({ color: 0x1b1b19, roughness: 0.55 });
insideLight(hoseMat, CREW_AMBIENT);
function makeHose() {
  const g = new THREE.BufferGeometry(), n = (HOSE_SEG + 1) * HOSE_SIDES, idx = [];
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  for (let i = 0; i < HOSE_SEG; i++) for (let k = 0; k < HOSE_SIDES; k++) {
    const a = i * HOSE_SIDES + k, b = i * HOSE_SIDES + (k + 1) % HOSE_SIDES;
    idx.push(a, b, a + HOSE_SIDES, b, b + HOSE_SIDES, a + HOSE_SIDES);
  }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, hoseMat);
  m.frustumCulled = false; m.visible = false;
  return m;
}
const _A = new V(), _B = new V(), _D = new V(), _P1 = new V(), _P2 = new V(), _pt = new V(), _tan = new V(), _n1 = new V(), _n2 = new V(), _prev = new V(), _iq = new Q();
function oxygenLine(fig) {
  const { hose, clip, bones } = fig.userData.rig, par = fig.parent, outlets = par?.userData.oxygen;
  hose.visible = false;
  if (!outlets) return;
  // in the figure's own frame: the clip, the nearest outlet, and "down" (the bomber's)
  _A.copy(clip).applyMatrix4(bones.spine_03.matrixWorld);
  par.worldToLocal(_pt.copy(_A));
  let best = null, bd = HOSE_LEN * 0.95;
  for (const o of outlets) { const d = o.distanceTo(_pt); if (d < bd) { bd = d; best = o; } }
  if (!best) return;
  fig.worldToLocal(_A);
  fig.worldToLocal(par.localToWorld(_B.copy(best)));
  fig.getWorldQuaternion(_iq).invert();
  _D.set(0, -1, 0).transformDirection(par.matrixWorld).applyQuaternion(_iq);
  const k = 1 / fig.getWorldScale(_pt).x; // (the hose is the cabin's size, not his)
  // hanging: a cubic from the chest down and round to the outlet, the slack deeper the closer they are
  const sag = 0.5 * Math.sqrt(Math.max(0, HOSE_LEN * HOSE_LEN - bd * bd)) * k;
  _P1.copy(_A).addScaledVector(_D, 0.12 * k + sag * 0.7);
  _P2.copy(_B).addScaledVector(_D, sag * 0.8);
  const pos = hose.geometry.attributes.position.array, nor = hose.geometry.attributes.normal.array;
  const bez = (t, out) => {
    const u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(_A, u * u * u).addScaledVector(_P1, 3 * u * u * t).addScaledVector(_P2, 3 * u * t * t).addScaledVector(_B, t * t * t);
  };
  const r = HOSE_R * k;
  _n1.set(1, 0, 0);
  for (let i = 0; i <= HOSE_SEG; i++) {
    bez(i / HOSE_SEG, _pt);
    bez(Math.min(1, (i + 1) / HOSE_SEG), _tan); if (i === HOSE_SEG) _tan.sub(bez((i - 1) / HOSE_SEG, _prev)); else _tan.sub(_pt);
    _tan.normalize();
    _n1.addScaledVector(_tan, -_n1.dot(_tan)); // (a frame carried along the hose: no twisting)
    if (_n1.lengthSq() < 1e-6) _n1.set(0, 1, 0).addScaledVector(_tan, -_tan.y);
    _n1.normalize(); _n2.crossVectors(_tan, _n1);
    for (let s = 0; s < HOSE_SIDES; s++) {
      const a = (s / HOSE_SIDES) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), o = (i * HOSE_SIDES + s) * 3;
      const nx = _n1.x * c + _n2.x * sn, ny = _n1.y * c + _n2.y * sn, nz = _n1.z * c + _n2.z * sn;
      const rr = i % 2 ? r * 0.82 : r; // (corrugated: every other ring drawn in)
      pos[o] = _pt.x + nx * rr; pos[o + 1] = _pt.y + ny * rr; pos[o + 2] = _pt.z + nz * rr;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    }
  }
  hose.geometry.attributes.position.needsUpdate = true; hose.geometry.attributes.normal.needsUpdate = true;
  hose.visible = true;
}

const _S = new V(), _T = new V(), _E = new V(), _u = new V(), _p = new V(), _cur = new V(), _want = new V(), _qa = new Q(), _qf = new Q();
/** Two-bone IK: turn upper and lower arm so the hand lands on its grip, the elbow bending down and out. */
function reach(rig, fig) {
  const { arms, reach: targets } = rig;
  [['l', 0, -1], ['r', 1, 1]].forEach(([s, i, side]) => {
    if (rig.free?.[i]) return;
    fig.getWorldQuaternion(_qf);
    const A = arms[s];
    A.upper.getWorldPosition(_S);
    _T.copy(targets[i]);
    // the wrist goes a hand's length short of the grip, so it's the palm that closes round it
    _u.subVectors(_T, _S).normalize();
    _T.addScaledVector(_u, -0.075);
    const k = fig.getWorldScale(_E).x; // (bone lengths were measured at full size)
    const a = A.a * k, b = A.b * k, d = Math.min(_S.distanceTo(_T), (a + b) * 0.999);
    // the elbow: down, out to his side and a little back (in the world, from his body's frame); reaching up
    // to a grip above his shoulder (the radio hatch gun) it swings out and forward instead, never back
    // behind his head
    const up = _v.set(0, 1, 0).applyQuaternion(_qf).dot(_u), hi = THREE.MathUtils.clamp((up - 0.1) / 0.5, 0, 1);
    _p.set(side * (0.6 + 0.5 * hi), -1 + 0.6 * hi, 0.35 - 0.9 * hi).applyQuaternion(_qf);
    _p.addScaledVector(_u, -_p.dot(_u)).normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_p, a * Math.sqrt(1 - cosA * cosA));
    aimBone(A.upper, A.lower, _E);
    aimBone(A.lower, A.hand, _T.copy(_S).addScaledVector(_u, d));
  });
}

/** Turn `bone` (in the world) so its child `tip` lands at world point `to`. */
function aimBone(bone, tip, to) {
  bone.getWorldPosition(_v);
  tip.getWorldPosition(_cur);
  _cur.sub(_v).normalize();
  _want.subVectors(to, _v).normalize();
  const world = bone.getWorldQuaternion(_q2).premultiply(_q.setFromUnitVectors(_cur, _want));
  bone.parent.getWorldQuaternion(_qa).invert();
  bone.quaternion.copy(_qa.multiply(world));
  bone.updateMatrixWorld(true);
}

export { figures };
