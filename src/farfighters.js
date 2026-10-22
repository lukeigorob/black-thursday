// Fighters far away are drawn as instanced low-detail copies (one draw call per part per type), like
// the bomber Fleet; only the ones near the camera (and the player's own) use their full model.
// With a hundred fighters in the air this keeps the draw calls and the scene graph small.
import * as THREE from 'three';
import { loadModel } from './models.js';

export const NEAR = 800; // m: closer than this a fighter is drawn with its own full model
const MAX = 160; // instances per type

export class FarFighters {
  constructor(scene) {
    this.scene = scene;
    this.parts = {}; // kind -> [{ mesh, local }] once its low-detail model has loaded
    this.loading = {};
    this.m = new THREE.Matrix4();
  }

  load(kind) {
    this.loading[kind] ??= loadModel(kind, { lod: true }).then(({ scene: low }) => {
      low.updateMatrixWorld(true);
      const parts = [];
      low.traverse((o) => {
        if (!o.isMesh) return;
        const mesh = new THREE.InstancedMesh(o.geometry, o.material, MAX);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.castShadow = mesh.receiveShadow = false;
        this.scene.add(mesh);
        parts.push({ mesh, local: o.matrixWorld.clone() });
      });
      this.parts[kind] = parts;
    });
    return this.loading[kind];
  }

  /** Each fighter: its own model up close (in the scene), an instance far away (taken out of the scene). */
  update(list, camPos) {
    const n = {};
    for (const f of list) {
      if (f.state === 'gone') continue;
      const parts = this.parts[f.kind];
      const near = f.player || !parts || f.pos.distanceToSquared(camPos) < NEAR * NEAR;
      if (near) {
        if (!f.obj.parent) this.scene.add(f.obj);
        continue;
      }
      if (f.obj.parent) this.scene.remove(f.obj);
      const i = n[f.kind] ?? 0;
      if (i >= MAX) continue;
      for (const { mesh, local } of parts) mesh.setMatrixAt(i, this.m.multiplyMatrices(f.obj.matrixWorld, local));
      n[f.kind] = i + 1;
    }
    for (const [kind, parts] of Object.entries(this.parts)) {
      for (const { mesh } of parts) { mesh.count = n[kind] ?? 0; mesh.instanceMatrix.needsUpdate = true; }
    }
  }
}
