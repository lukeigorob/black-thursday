// Bombers coming apart: a wing folding off at the outer joint or snapping at the root, the tail
// breaking away, the fuselage parting where a fire has burnt through. The parts really leave.
//  - The bomber (its own model, whichever detail it has) has the lost region cut away in its shaders,
//    the torn edge charred and glowing, the inside of the skin dark where you look into it.
//  - Each lost part is a copy of the same model that keeps only that region, given its own
//    tumble and fall, trailing fire and smoke, with a little debris.
// Bombers far off (drawn by the instanced Fleet, which can't be cut) get a low-detail model of their
// own once they break up. Copies share the models' geometry, so a break-up costs no loading.
import * as THREE from 'three';

const V = THREE.Vector3;
const MAX_PIECES = 8, FAR = 2500; // pieces at once; past FAR a wreck stays in the instanced Fleet (a lost wing is a few pixels there)

// the parts a B-17 comes apart at, in bomber space (x right, y up, z back): [min], [max]
export const REGIONS = {
  wingLo: [[-40, -3, -10], [-8.0, 2, 0]], // outer wing, beyond engine 1
  wingRo: [[8.0, -3, -10], [40, 2, 0]],
  wingLi: [[-40, -3, -10], [-1.3, 2, 0]], // the whole wing at the root, engines and all
  wingRi: [[1.3, -3, -10], [40, 2, 0]],
  tail: [[-8, -4, 6.0], [8, 6, 20]], // fin, tailplanes and the tail gun
};
/** The fuselage parting at z: everything behind it goes. */
export const behind = (z) => [[-8, -4, z], [8, 6, 20]];

// GLSL: up to 4 boxes; keep = 1 draws only inside the boxes (a piece), 0 draws only outside (what's left)
const MAXB = 4;
function cutMaterial(src, cuts) {
  const m = src.clone();
  m.side = THREE.DoubleSide; // (through the torn end you see the inside of the skin)
  m.transparent = src.transparent; m.depthWrite = src.depthWrite;
  const prev = src.onBeforeCompile, prevKey = src.customProgramCacheKey?.bind(src);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(src, sh, r);
    sh.uniforms.uCutMin = { value: cuts.min };
    sh.uniforms.uCutMax = { value: cuts.max };
    sh.uniforms.uCutN = cuts.n;
    sh.uniforms.uCutKeep = cuts.keep;
    sh.uniforms.uCutInv = cuts.inv;
    sh.uniforms.uCutT = cuts.t;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uCutInv; varying vec3 vCutP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vCutP = (uCutInv * modelMatrix * wp).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uCutMin[${MAXB}]; uniform vec3 uCutMax[${MAXB}]; uniform int uCutN; uniform float uCutKeep; uniform float uCutT;
      varying vec3 vCutP;
      float ch(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float cn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(ch(i), ch(i + vec3(1,0,0)), f.x), mix(ch(i + vec3(0,1,0)), ch(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(ch(i + vec3(0,0,1)), ch(i + vec3(1,0,1)), f.x), mix(ch(i + vec3(0,1,1)), ch(i + vec3(1,1,1)), f.x), f.y), f.z); }
      // signed distance (m) into the cut region (> 0 inside), the boundary ragged like torn metal
      float cutDist(vec3 p) {
        float best = -1e3;
        for (int i = 0; i < ${MAXB}; i++) {
          if (i >= uCutN) break;
          vec3 d = min(p - uCutMin[i], uCutMax[i] - p);
          best = max(best, min(min(d.x, d.y), d.z));
        }
        return best + (cn(p * 5.0) - 0.5) * 0.35 + (cn(p * 23.0) - 0.5) * 0.08;
      }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float cutD = cutDist(vCutP);
      if (uCutKeep > 0.5 ? cutD < 0.0 : cutD > 0.0) discard;
      float cutEdge = 1.0 - smoothstep(0.0, 0.45, abs(cutD));`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(1.0, 0.12, cutEdge); // scorched round the tear
      if (!gl_FrontFacing) diffuseColor.rgb *= 0.18; // the inside of the skin`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // the torn edge glows where it's still burning, flickering
      float glow = (1.0 - smoothstep(0.0, 0.12, abs(cutD))) * (0.5 + 0.5 * cn(vCutP * 9.0 + vec3(0.0, uCutT * 3.0, 0.0)));
      totalEmissiveRadiance += vec3(4.0, 1.4, 0.3) * glow * max(0.0, 1.0 - uCutT / 40.0);`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cut`;
  m.userData = { ...src.userData, cutFrom: src };
  return m;
}

/** The cut state shared by one model's materials: the boxes, which side to keep, its inverse matrix. */
function cutState(boxes, keep) {
  const s = { min: Array.from({ length: MAXB }, () => new V()), max: Array.from({ length: MAXB }, () => new V()),
    n: { value: 0 }, keep: { value: keep ? 1 : 0 }, inv: { value: new THREE.Matrix4() }, t: { value: 0 } };
  setBoxes(s, boxes);
  return s;
}
function setBoxes(s, boxes) {
  boxes.slice(0, MAXB).forEach(([a, b], i) => { s.min[i].set(...a); s.max[i].set(...b); });
  s.n.value = Math.min(MAXB, boxes.length);
}

/** Swap every material under `root` for a cut copy using `state` (originals kept to put back). */
function applyCut(root, state) {
  const cache = new Map();
  root.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || o.isSkinnedMesh || o.userData.noCut) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((mat) => {
      if (!mat || mat.isShaderMaterial || mat.isMeshBasicMaterial && mat.blending === THREE.AdditiveBlending) return mat;
      if (!cache.has(mat)) cache.set(mat, cutMaterial(mat.userData.cutFrom ?? mat, state));
      return cache.get(mat);
    });
    o.userData.uncut ??= o.material;
    o.material = Array.isArray(o.material) ? out : out[0];
    o.userData.depthWas ??= o.customDepthMaterial ?? null;
    o.castShadow = false; o.userData.noShadow = true;
    o.customDepthMaterial = undefined;
  });
}
function removeCut(root) {
  root.traverse((o) => {
    if (!o.userData.uncut) return;
    o.material = o.userData.uncut; o.userData.uncut = null;
    o.customDepthMaterial = o.userData.depthWas ?? undefined; o.userData.depthWas = null; o.userData.noShadow = false;
  });
}

export class Breakup {
  /** sources: { lod, mid }: model scenes to copy for pieces (and for far bombers' bodies). */
  constructor(scene, effects, sources) {
    Object.assign(this, { scene, effects, sources });
    this.pieces = [];
  }

  /** Compile the cut shaders now (both details, body and piece), not mid-battle on the first break-up. */
  warm(renderer, camera) {
    // (in the real scene: its lights and shadows are part of each program)
    const roots = [];
    for (const src of [this.sources.mid, this.sources.lod]) for (const keep of [true, false]) {
      const root = src.clone(true);
      applyCut(root, cutState([REGIONS.tail], keep));
      root.position.set(0, -50000, 0); // (out of sight)
      this.scene.add(root); roots.push(root);
    }
    try { renderer.compile(this.scene, camera); } catch { /* (only a warm-up) */ }
    for (const r of roots) this.scene.remove(r);
  }

  /** Compile the cut versions of everything in `root` (your own bomber, its cabin) now, not when it first breaks up. */
  async warmCut(root, renderer, camera) {
    applyCut(root, cutState([REGIONS.tail], true));
    try { await renderer.compileAsync(this.scene, camera); } catch { /* (only a warm-up) */ }
    removeCut(root);
  }

  /**
   * Bomber `b` has lost a part: kind 'wingo' / 'wingi' (side -1 left, 1 right), 'tail', or 'fuselage'
   * (parting at z). Called from its damage fx with the velocity its wreckage starts with.
   */
  lose(b, kind, side, z, vel) {
    b.cutBoxes ??= [];
    const s = side < 0 ? 'L' : 'R', had = (k) => b.lostParts?.has(k);
    b.lostParts ??= new Set();
    let boxes;
    if (kind === 'wingo') boxes = had('wing' + s + 'o') || had('wing' + s + 'i') ? [] : [REGIONS[`wing${s}o`]];
    else if (kind === 'wingi') {
      if (had('wing' + s + 'i')) boxes = [];
      else { // (the outer panel may have gone already: this piece is the rest of the wing)
        const r = REGIONS[`wing${s}i`].map((v) => [...v]);
        if (had('wing' + s + 'o')) { if (side < 0) r[0][0] = REGIONS.wingLo[1][0]; else r[1][0] = REGIONS.wingRo[0][0]; }
        boxes = [r];
      }
    } else if (kind === 'tail') boxes = had('tail') ? [] : [REGIONS.tail];
    else boxes = had('fuselage') ? [] : [[[-1.7, -4, z], [1.7, 4, 20]], REGIONS.tail]; // (the rear fuselage and its tail)
    if (!boxes.length || b.cutBoxes.length + boxes.length > MAXB) return;
    b.lostParts.add(kind === 'wingo' || kind === 'wingi' ? `wing${s}${kind.at(-1)}` : kind);
    if (kind === 'fuselage') b.lostParts.add('tail');
    b.cutBoxes.push(...boxes);
    this.cutBody(b);
    const piece = this.spawnPiece(b, boxes, kind, side, z, vel);
    if (kind === 'tail' || kind === 'fuselage') b.tailPiece = piece;
  }

  /** Keep the bomber's own drawing cut, whatever model it has right now. */
  cutBody(b) {
    if (!b.cutBoxes?.length) return;
    if (!b.model && !b.wreckBody && this.camPos && b.group.position.distanceTo(this.camPos) > FAR) return; // (too far to see it: the Fleet draws it whole)
    if (!b.model && !b.wreckBody) { // a far one, drawn by the Fleet: give it a model of its own
      b.wreckBody = this.sources.lod.clone(true);
      b.group.add(b.wreckBody);
      if (!b.group.parent) this.scene.add(b.group);
    }
    const root = b.model ?? b.wreckBody;
    if (b.cutRoot !== root) { // (a new model: cut it the same)
      if (b.cutRoot) removeCut(b.cutRoot);
      b.cutState = cutState(b.cutBoxes, false);
      applyCut(root, b.cutState);
      if (b.model && b.interior) applyCut(b.interior.group, b.cutState); // your own bomber's cabin goes with it
      b.cutRoot = root;
    } else setBoxes(b.cutState, b.cutBoxes);
    // the propellers out on a lost wing go with it
    for (const p of b.props ?? []) if (p) p.visible = !b.cutBoxes.some(([a, c]) => p.position.x > a[0] && p.position.x < c[0] && p.position.z > a[2] && p.position.z < c[2]);
  }

  /** A model handed back to the pool, or a bomber gone: put the materials back. */
  release(b) {
    if (b.cutRoot) removeCut(b.cutRoot);
    if (b.interior) removeCut(b.interior.group);
    b.cutRoot = null;
    if (b.wreckBody) { b.group.remove(b.wreckBody); b.wreckBody = null; }
  }

  spawnPiece(b, boxes, kind, side, z, vel) {
    if (this.pieces.length >= MAX_PIECES) this.drop(this.pieces[0]);
    // (copied from a clean source model: a cut one's materials can't be cloned through userData)
    const far = this.camPos && b.group.position.distanceTo(this.camPos) > 400;
    const root = (far || !this.sources.mid ? this.sources.lod : this.sources.mid).clone(true); // (low detail unless it's close)
    const state = cutState(boxes, true);
    applyCut(root, state);
    const g = new THREE.Group();
    g.add(root);
    b.group.updateMatrixWorld(true);
    b.group.matrixWorld.decompose(g.position, g.quaternion, g.scale);
    this.scene.add(g);
    // where it tore off (in the piece's own space), for its fire and smoke, and its middle
    const tear = kind === 'tail' ? new V(0, 0.3, 6.0) : kind === 'wingo' ? new V(side * 8.0, -0.6, -4.5)
      : kind === 'wingi' ? new V(side * 1.4, -0.7, -4.6) : new V(0, 0, z);
    const centre = kind === 'tail' ? new V(0, 0.8, 8.5) : kind === 'wingo' ? new V(side * 12, -0.6, -4.5)
      : kind === 'wingi' ? new V(side * 7, -0.6, -4.5) : new V(0, 0.3, (z + 11) / 2);
    // spin about its middle: a wing flips over and over, the tail tumbles end over end
    const spin = kind.startsWith('wing') ? new V(THREE.MathUtils.randFloat(-0.6, 0.6), THREE.MathUtils.randFloat(-0.4, 0.4), side * THREE.MathUtils.randFloat(1.6, 2.6))
      : new V(THREE.MathUtils.randFloat(1.0, 1.8) * (Math.random() < 0.5 ? -1 : 1), THREE.MathUtils.randFloat(-0.5, 0.5), THREE.MathUtils.randFloat(-0.6, 0.6));
    const v = vel.clone().add(new V(side * (kind.startsWith('wing') ? 6 : 0), THREE.MathUtils.randFloat(-2, 3), kind === 'tail' ? 8 : 4));
    const piece = { g, root, state, v, spin, centre, tear, t: 0, kind, burn: Math.random() < 0.85 };
    this.pieces.push(piece);
    // the moment it goes: a burst of fire and pieces of skin at the tear
    const at = g.localToWorld(tear.clone()), near = this.camPos ? THREE.MathUtils.clamp(at.distanceTo(this.camPos) / 30, 0.2, 1) : 1;
    this.effects.explosion(at, vel.clone(), (kind === 'tail' ? 1.2 : 1.6) * near); // (smaller right by your eye: from inside, a full one whites out the cabin)
    return piece;
  }

  drop(p) {
    this.scene.remove(p.g);
    this.pieces.splice(this.pieces.indexOf(p), 1);
  }

  update(dt, camPos) {
    this.camPos = camPos;
    for (const p of [...this.pieces]) {
      p.t += dt;
      p.state.t.value = p.t;
      // falls: gravity to a tumbling piece's terminal speed, the air stream carrying it back
      p.v.y = Math.max(p.v.y - 9.8 * dt, p.kind === 'tail' ? -60 : -45);
      p.v.z += (25 - p.v.z) * Math.min(1, dt * 0.25);
      // turn about its centre of mass, not the bomber's origin
      const c = _c.copy(p.centre).applyQuaternion(p.g.quaternion).add(p.g.position);
      _q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
      p.g.quaternion.multiply(_q);
      p.g.position.copy(c).sub(_c2.copy(p.centre).applyQuaternion(p.g.quaternion));
      p.g.position.addScaledVector(p.v, dt);
      p.g.updateMatrixWorld(true);
      p.state.inv.value.copy(p.g.matrixWorld).invert();
      const at = p.g.localToWorld(_c.copy(p.tear));
      if (p.burn && p.t < 40 && !(camPos && at.distanceTo(camPos) < 18)) { // (not right by your eye: it whites out the view)
        this.effects.trail(at, _c2.set(0, 0, 3), 'fire', dt * 0.8);
        this.effects.trail(at, _c2.set(0, 0, 3), 'black', dt);
      }
      if (p.t > 60 || (camPos && p.g.position.distanceTo(camPos) > FAR + 500)) this.drop(p);
    }
  }

  /** Each frame, for every broken bomber: keep its cut's matrix on it. */
  track(bombers) {
    for (const b of bombers) {
      if (!b.cutBoxes?.length) continue;
      if (b.gone) { this.release(b); continue; }
      if (b.wreckBody && this.camPos && b.group.position.distanceTo(this.camPos) > FAR + 300) { this.release(b); continue; }
      this.cutBody(b);
      if (!b.cutRoot) continue; // (far: drawn whole by the Fleet)
      if (b.wreckBody && b.model) { b.group.remove(b.wreckBody); b.wreckBody = null; this.cutBody(b); }
      b.cutState.t.value = b.downT ?? 0;
      b.group.updateMatrixWorld(true);
      b.cutState.inv.value.copy(b.group.matrixWorld).invert();
    }
  }
}
const _c = new V(), _c2 = new V(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
