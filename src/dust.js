// Dust in the cabin air: tiny motes drifting round you that only show where the sun falls on them.
// Each mote is lit by the real sun and its shadow map (the hull's shadow), facing the sun, with no
// sky light at all, so the ones in the shade vanish and the beams through the windows and gun
// hatches fill with slowly turning specks.
import * as THREE from 'three';

const COUNT = 700, RANGE = 2.6; // motes, and how far round your eye they float (m)
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _eye = new THREE.Vector3(), _sun = new THREE.Vector3();

function dot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Dust {
  constructor(interior) {
    this.it = interior;
    const mat = new THREE.MeshLambertMaterial({
      map: dot(), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    mat.color.setRGB(4, 3.7, 3.2); // (bright: a speck in the sun glints)
    this.uniforms = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSize: { value: 0.011 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uSun; uniform float uSize;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = uSun;') // (it faces the sun: lit fully or not at all)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(0.0);') // (the shadow is looked up at its centre)
        .replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mvPosition.xy += position.xy * uSize * smoothstep(0.45, 1.1, -mvPosition.z); // a billboard (none right at your eye: they'd be big blurry orbs)
          gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse = vec3(0.0);`);
    };
    mat.customProgramCacheKey = () => 'cabin-dust';
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, COUNT);
    this.mesh.receiveShadow = true; // (that's what makes the beams)
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    interior.group.add(this.mesh);
    this.pos = new Float32Array(COUNT * 3);
    this.vel = new Float32Array(COUNT * 3);
    this.phase = new Float32Array(COUNT).map(() => Math.random() * 6.3);
    this.t = 0;
    this.placed = false;
  }

  /** A fresh mote somewhere round the eye, inside the hull. */
  spawn(i, eye) {
    for (let k = 0; k < 6; k++) {
      const x = eye.x + (Math.random() * 2 - 1) * RANGE, y = eye.y + (Math.random() * 2 - 1) * RANGE * 0.6, z = eye.z + (Math.random() * 2 - 1) * RANGE;
      if (Math.abs(x) < this.it.hw(z, y) - 0.05) { this.pos.set([x, y, z], i * 3); break; }
      this.pos.set([eye.x, eye.y, eye.z + 50], i * 3); // (nowhere found: out of sight)
    }
    this.vel.set([(Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.03 + 0.01], i * 3);
  }

  /** camera: the eye; sunLocal: the direction to the sun in bomber space; on: the quality setting. */
  update(dt, camera, sunLocal, on) {
    this.mesh.visible = on;
    if (!on) return;
    this.t += dt;
    this.uniforms.uSun.value.copy(_sun.copy(sunLocal).normalize());
    this.it.group.worldToLocal(camera.getWorldPosition(_eye));
    const P = this.pos, Vv = this.vel;
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      if (!this.placed) this.spawn(i, _eye);
      // a slow drift and swirl in the draughts from the gun windows
      const w = this.phase[i] + this.t * 0.4;
      P[j] += (Vv[j] + Math.sin(w) * 0.01) * dt;
      P[j + 1] += (Vv[j + 1] + Math.cos(w * 1.3) * 0.006) * dt;
      P[j + 2] += (Vv[j + 2] + Math.sin(w * 0.7) * 0.01) * dt;
      const dx = P[j] - _eye.x, dy = P[j + 1] - _eye.y, dz = P[j + 2] - _eye.z;
      if (dx * dx + dz * dz > RANGE * RANGE || Math.abs(dy) > RANGE * 0.6 || Math.abs(P[j]) > this.it.hw(P[j + 2], P[j + 1])) this.spawn(i, _eye);
      this.mesh.setMatrixAt(i, _m.makeTranslation(_p.fromArray(P, j)));
    }
    this.placed = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
