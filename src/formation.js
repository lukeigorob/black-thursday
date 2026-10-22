// The bomber stream, laid out like an Eighth Air Force formation of 1943-44:
//   element  = a V of three bombers (lead, wingmen stepped down left / up right)
//   squadron = two elements, the second trailing below the first          (6 bombers)
//   group    = lead squadron, high squadron above-right, low squadron below-left   (18, the "combat box")
//   wing     = lead group, high group above-right, low group below-left    (54, the "combat wing")
//   stream   = combat wings following each other a few km apart
// Only the player's bomber uses the full model, its close neighbours a mid-detail one; everything
// else is drawn as instanced low-detail copies (one draw call per part) to keep the frame rate up.
import * as THREE from 'three';
import { BATTLE } from './battle.js';

const ELEMENT = [[0, 0, 0], [-29, -5, 18], [29, 5, 18]];
const SQUADRON = [[0, 0, 0], [0, -16, 50]];
const GROUP = [[0, 0, 0, 'Lead'], [92, 36, 58, 'High'], [-92, -36, 58, 'Low']];
const WING = [[0, 0, 0, 'Lead'], [250, 120, 180, 'High'], [-250, -120, 180, 'Low']];
// ours, one ahead, one behind, and a wing either side: 5 combat wings, 270 bombers
// packed close, the way the bombers flew for mutual protection: wings a few hundred metres apart
const STREAM = [[0, 0, 0, ''], [-90, 70, -780, 'Leading wing, '], [110, -70, 760, 'Trailing wing, '],
  [-720, 160, -260, 'Left wing, '], [740, -150, 240, 'Right wing, ']];
const NEAR = 150; // m from the player's bomber: closer than this gets the full model

/** Every slot in the stream, shifted so the player's bomber sits at the origin. */
export function formationSlots() {
  const slots = [];
  for (const [wi, w] of STREAM.slice(0, BATTLE.wings).entries()) for (const g of WING) for (const s of GROUP) for (const [ei, e] of SQUADRON.entries()) for (const [pi, p] of ELEMENT.entries()) {
    slots.push({
      pos: new THREE.Vector3(w[0] + g[0] + s[0] + e[0] + p[0], w[1] + g[1] + s[1] + e[1] + p[1], w[2] + g[2] + s[2] + e[2] + p[2]),
      label: `${w[3]}${g[3]} group, ${s[3]} squadron`,
      group: `${wi}-${g[3]}`, // the 18-ship group: it bombs together, on its lead bombardier
      lead: s[3] === 'Lead' && ei === 0 && pi === 0,
      player: wi === 0 && g[3] === 'Lead' && s[3] === 'Lead' && ei === 0 && pi === 1, // left wingman of the lead
    });
  }
  const origin = slots.find((s) => s.player).pos.clone();
  for (const s of slots) {
    s.pos.sub(origin);
    s.near = s.pos.length() < NEAR;
  }
  return slots;
}

/** Draws many far-away bombers with one InstancedMesh per part of the low-detail model. */
export class Fleet {
  constructor(scene, lodModel, bombers) {
    this.bombers = bombers;
    lodModel.updateMatrixWorld(true);
    this.parts = [];
    lodModel.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingSphere();
      if (o.geometry.boundingSphere.radius < 0.8) return; // guns, blades, fairings: sub-pixel at range
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, bombers.length);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = false;
      scene.add(mesh);
      this.parts.push({ mesh, local: o.matrixWorld.clone() });
    });
    this.m = new THREE.Matrix4();
  }

  update() {
    for (const b of this.bombers) if (!b.model) b.group.updateMatrixWorld();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { mesh, local } of this.parts) {
      // bombers drawn with their own model right now (the player's and its neighbours) are skipped
      this.bombers.forEach((b, i) => mesh.setMatrixAt(i, b.gone || b.model ? hidden : this.m.multiplyMatrices(b.group.matrixWorld, local)));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/**
 * Hands a pool of mid-detail models to the bombers nearest the player's, wherever that is
 * (the player can move to another bomber, and stragglers drift out of the box).
 */
export class Detail {
  /** models: the mid-detail models to hand out (count = how many neighbours get one). */
  constructor(scene, bombers, player, models) {
    Object.assign(this, { scene, bombers, player, size: models.length, pool: [...models] });
    this.timer = 0;
  }

  assign() {
    const here = this.player.base;
    const keep = this.bombers.filter((b) => b !== this.player && !b.gone)
      .sort((a, b) => a.base.distanceToSquared(here) - b.base.distanceToSquared(here))
      .slice(0, this.size);
    for (const b of this.bombers) { // free models from bombers that are no longer close
      if (b === this.player || !b.model || keep.includes(b)) continue;
      this.pool.push(b.model);
      b.setModel(null);
      this.scene.remove(b.group);
    }
    for (const b of keep) {
      if (b.model || !this.pool.length) continue;
      b.setModel(this.pool.pop());
      this.scene.add(b.group);
    }
    for (const b of this.bombers) { // only the bombers right round the player cast shadows
      if (!b.model) continue;
      const casts = b === this.player || b.base.distanceTo(here) < 75;
      b.model.traverse((o) => { if (o.isMesh) o.castShadow = casts; });
    }
  }

  update(dt) { if ((this.timer -= dt) <= 0) { this.timer = 2; this.assign(); } }
}

function contrailTexture() { // alpha along the trail: forms a little behind the engine, fades out far back
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  // v = 1 at the engine end of the ribbon, 0 at the far end
  const grd = g.createLinearGradient(0, 256, 0, 0);
  grd.addColorStop(0, 'rgb(0,0,0)');
  grd.addColorStop(0.65, 'rgb(90,90,90)');
  grd.addColorStop(0.95, 'rgb(150,150,150)');
  grd.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

const ENGINES = [-7.16, -3.93, 3.94, 7.15]; // engine x in the B-17 model
const TRAIL = 260, TRAIL_START = 70, TRAIL_WIDTH = 3.2; // m: thin, short wisps that start well behind the tail

/** Four condensation trails behind every bomber (two crossed ribbons each, one draw call). */
export class Contrails {
  constructor(scene, bombers) {
    this.bombers = bombers;
    const quad = (rot) => {
      const g = new THREE.PlaneGeometry(1, 1, 1, 8).rotateX(-Math.PI / 2).translate(0, 0, 0.5); // z 0..1
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (0.25 + p.getZ(i) * 0.75)); // spreads as it ages
      return g.rotateZ(rot);
    };
    const geo = quad(0);
    const second = quad(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = geo.attributes[name], b = second.attributes[name];
      const arr = new Float32Array(a.array.length + b.array.length);
      arr.set(a.array); arr.set(b.array, a.array.length);
      merged.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    const n = geo.attributes.position.count;
    merged.setIndex([...geo.index.array, ...Array.from(second.index.array, (i) => i + n)]);
    this.mesh = new THREE.InstancedMesh(merged, new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.35, 1.38, 1.45), alphaMap: contrailTexture(), transparent: true, opacity: 0.4, // wispy, not a wall
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    }), bombers.length * ENGINES.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // trails condense a few dozen metres behind the engines (and so don't fill the tail gunner's view)
    this.locals = ENGINES.map((x) => new THREE.Matrix4().compose(new THREE.Vector3(x, -0.6, TRAIL_START), new THREE.Quaternion(), new THREE.Vector3(TRAIL_WIDTH, TRAIL_WIDTH, TRAIL)));
    this.m = new THREE.Matrix4();
  }

  update() {
    let k = 0;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const b of this.bombers) {
      if (b.model) b.group.updateMatrixWorld();
      b.engines.forEach((e, i) => { // a dead engine makes no contrail; a falling bomber neither
        const off = b.down || e.state === 'dead' || e.state === 'fire';
        this.mesh.setMatrixAt(k++, off ? hidden : this.m.multiplyMatrices(b.group.matrixWorld, this.locals[i]));
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
