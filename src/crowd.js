// The men seen from outside: the crews of the B-17s near you at their stations (the pilots in their seats,
// the nose men kneeling at their guns, the engineer up in the top turret, the radio, waist and tail gunners
// at theirs), your own crew seen from out behind her (the third-person view from the pilots' seats, where
// her cabin isn't drawn), and the pilot in a fighter that comes close. Each is the crewman's light copy
// (figure.js), posed once at his station as in your own bomber and baked into plain meshes: no skeletons to
// update, one draw a material for all the bombers' crews together (instanced), one for all the pilots. Only
// the nearest few are drawn, none further than you could make out a man through a window.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeFigure, bakeFigures, crewInfo } from './figure.js';
import { ROLES, KIT, SPOTS, pose, fitUnderRoof } from './crew.js';

const BOMBER_NEAR = 150, BOMBERS_MAX = 5; // m from the camera, and at most this many crews drawn
const FIGHTER_NEAR = 120, FIGHTERS_MAX = 6;
const EYE = { bf109: [0, 0.75, -0.8], p47: [0, 1.05, -0.2], fw190: [0, 0.86, -0.22] }; // (the pilot's eye in each: pilot.js)
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _cam = new THREE.Vector3();

export class Crowds {
  /** interior: your own bomber's (the hull the men are fitted under: every B-17's the same). */
  constructor(scene, interior) {
    Object.assign(this, { scene, interior });
    this.ready = false;
  }

  /** Bake the men (once the crewman has loaded). */
  build() {
    if (this.ready || !crewInfo()) return;
    // a bomber's crew at their stations (the ball gunner is down in his turret: not seen)
    const frame = new THREE.Group(); frame.updateMatrixWorld(true);
    const roles = ROLES.filter((r) => r.id !== 'ball');
    const men = roles.map((r, i) => {
      const s = SPOTS[r.id], fig = makeFigure({ seed: i * 7 + 3, ...KIT[r.id], lod: true });
      if (r.id.startsWith('waist')) fig.scale.setScalar(0.92);
      frame.add(fig);
      fig.position.set(...s.at); fig.rotation.y = s.yaw;
      if (r.id === 'tail') { fig.position.z -= 1.0; fig.position.y += 0.1; } // (a little further in, where her tail's tall enough for a kneeling man: at his post he'd come through her skin)
      pose(fig, s.pose);
      fitUnderRoof(fig, this.interior, s.pose);
      // (the tail and radio gunners' hands down on their grips: raised, they'd come up through her skin, or
      // look like a man putting his hands up)
      if (r.id === 'tail' || r.id === 'radio') { const j = fig.userData.j; for (const a of [j.armL, j.armR]) { a.sh.rotation.x = 0.55; a.el.rotation.x = 0.9; } }
      return fig;
    });
    const baked = bakeFigures(men, frame);
    this.byRole = new Map(roles.map((r, i) => [r.id, baked.get(men[i])])); // (your own crew: only the men at their posts)
    this.bombers = this.instanced(byMaterial([...baked.values()]), BOMBERS_MAX);
    this.own = new THREE.Group(); this.own.matrixAutoUpdate = false; this.own.visible = false;
    this.scene.add(this.own);
    // a fighter pilot in his seat (helmet and goggles, a leather jacket), baked with his eye at the origin
    const pf = makeFigure({ seed: 11, outfit: 'a2', lod: true });
    frame.add(pf);
    pose(pf, 'sit');
    pf.userData.j.armL.sh.rotation.x = pf.userData.j.armR.sh.rotation.x = 0.7; // (a hand on the stick, one on the throttle)
    frame.updateMatrixWorld(true);
    const eye = pf.userData.j.head.getWorldPosition(new THREE.Vector3()).add(pf.userData.rig.dims.eye);
    pf.position.sub(eye);
    this.pilots = this.instanced(byMaterial([...bakeFigures([pf], frame).values()]), FIGHTERS_MAX);
    for (const f of [...men, pf]) f.removeFromParent();
    this.ready = true;
  }

  /** One instanced mesh a material, for up to `max` copies. */
  instanced(byMat, max) {
    const group = new THREE.Group(), meshes = [];
    for (const [mat, geos] of byMat) {
      const im = new THREE.InstancedMesh(geos.length > 1 ? mergeGeometries(geos) : geos[0].clone(), mat, max);
      im.count = 0; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im); meshes.push(im);
    }
    this.scene.add(group);
    return meshes;
  }

  /** Your own crew as drawn from outside: the men at their posts now (put together again when that changes). */
  ownCrew(crew) {
    const at = crew ? crew.members.filter((m) => (m.state === 'ok' || m.state === 'player') && this.byRole.has(m.role.id)).map((m) => m.role.id) : [];
    const key = at.join();
    if (key === this.ownKey) return;
    this.ownKey = key;
    for (const c of [...this.own.children]) { c.geometry.dispose(); this.own.remove(c); }
    for (const [mat, geos] of byMaterial(at.map((id) => this.byRole.get(id)))) {
      const m = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0].clone(), mat);
      m.frustumCulled = false;
      this.own.add(m);
    }
  }

  /**
   * Each frame, after everything's moved. camera; bombers (all of them), mine (yours), crews (bomber ->
   * Crew), fighters (fighters.js), me (your own fighter: not drawn while you're in its cockpit), mineOutside
   * (her cabin isn't drawn, seen from out behind her: her crew are drawn from here instead).
   */
  update(camera, { bombers, mine, crews, fighters, me = null, mineOutside = false }) {
    if (!this.ready) { this.build(); if (!this.ready) return; }
    camera.getWorldPosition(_cam);
    // your own crew, from out behind her
    this.own.visible = mineOutside && !mine.down;
    if (this.own.visible) { this.ownCrew(crews?.get(mine)); this.own.matrix.copy(mine.group.matrixWorld); this.own.matrixWorldNeedsUpdate = true; }
    // the other crews: the nearest few bombers, flying and still crewed
    const near = [];
    for (const b of bombers) {
      if (b === mine || b.down || b.gone || !b.model) continue;
      const d = b.group.position.distanceTo(_cam);
      if (d > BOMBER_NEAR) continue;
      if (crews?.get(b)?.members.every((m) => m.state === 'bailed' || m.state === 'dead')) continue;
      near.push([d, b]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const nb = Math.min(near.length, BOMBERS_MAX);
    for (const im of this.bombers) {
      for (let i = 0; i < nb; i++) im.setMatrixAt(i, near[i][1].group.matrixWorld);
      im.count = nb; im.instanceMatrix.needsUpdate = true;
    }
    // the fighter pilots: the nearest few, still in their seats
    const close = [];
    for (const f of fighters.list) {
      if (!f.obj?.parent || !EYE[f.kind] || f === me || !(f.alive || f.bailT !== undefined)) continue;
      const d = _p.setFromMatrixPosition(f.obj.matrixWorld).distanceTo(_cam); // (where he's drawn)
      if (d < FIGHTER_NEAR) close.push([d, f]);
    }
    close.sort((a, b) => a[0] - b[0]);
    const nf = Math.min(close.length, FIGHTERS_MAX);
    for (let i = 0; i < nf; i++) {
      const f = close[i][1], o = f.obj;
      o.matrixWorld.decompose(_p, _q, _s);
      _p.fromArray(EYE[f.kind]).applyMatrix4(o.matrixWorld); // (his eye where the cockpit's is, at his own size)
      _m.compose(_p, _q, _one);
      for (const im of this.pilots) im.setMatrixAt(i, _m);
    }
    for (const im of this.pilots) { im.count = nf; im.instanceMatrix.needsUpdate = true; }
  }
}

/** Several men's baked meshes put together: Map(material -> [geometry]). */
function byMaterial(list) {
  const out = new Map();
  for (const m of list) for (const [mat, g] of m) { if (!out.has(mat)) out.set(mat, []); out.get(mat).push(g); }
  return out;
}
