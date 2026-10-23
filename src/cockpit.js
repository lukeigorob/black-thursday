// The fighter pilot's cockpit, for flying a Bf 109 or a P-51 in first person: the instrument panel with
// its dials, the gunsight on the coaming, the windscreen and canopy frame (never across the middle of
// the sight), the long engine cowling out in front with the spinner and the blur of the propeller, and
// the wings out to the sides. The aircraft models have no cockpit, so this is built here and shown in
// their place. Built in the model's frame (-Z = forward), round the pilot's eye.
import * as THREE from 'three';

const TYPES = {
  // eye: the pilot's eye in the model. prop: m ahead of the eye. wing: m below the eye, and its span.
  // The 109's canopy is heavily framed with an armour plate behind your head; the P-51D's is a clear bubble.
  bf109: { eye: [0, 0.75, -0.8], prop: 3.3, cowl: [0.4, 0.5], wing: [-1.3, 5.2, 1.9, 0.9], skin: 0x6f7a6a, inside: 0x50544f, framed: true },
  p51: { eye: [0, 0.85, -0.1], prop: 4.2, cowl: [0.42, 0.52], wing: [-1.15, 5.6, 2.4, 1.0], skin: 0xb9bdc0, inside: 0x56614a, framed: false },
};

const V2 = THREE.Vector2;

function dialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
  g.strokeStyle = '#d8d4c4'; g.lineWidth = 3;
  for (let k = 0; k < 12; k++) { // the scale
    const a = (k / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); g.stroke();
  }
  g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + 40, 64 - 22); g.stroke(); // the needle
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A bar from a to b (eye-relative points). */
function bar(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export function buildCockpit(kind) {
  const T = TYPES[kind];
  const root = new THREE.Group();
  root.matrixAutoUpdate = false; // placed on the fighter each frame (pilot.js)
  const g = new THREE.Group(); // everything below is relative to the eye
  g.position.fromArray(T.eye);
  root.add(g);
  const skin = new THREE.MeshStandardMaterial({ color: T.skin, roughness: 0.6, metalness: kind === 'p51' ? 0.6 : 0.2 });
  const inside = new THREE.MeshStandardMaterial({ color: T.inside, roughness: 0.8, metalness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
  const frameMat = new THREE.MeshStandardMaterial({ color: kind === 'p51' ? 0x8c9094 : 0x3c4038, roughness: 0.5, metalness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.07, roughness: 0.04, depthWrite: false, side: THREE.DoubleSide });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  // the engine cowling: from the firewall (behind the instrument panel) out to the spinner, its top
  // rising just above the coaming and falling away to the nose, under the line of sight
  const [rf, rb] = T.cowl, back = 0.66, len = T.prop - back, cy = -0.19 - rb * 0.92;
  add(new THREE.CylinderGeometry(rf, rb, len, 32, 1, true).rotateX(-Math.PI / 2).scale(1, 0.92, 1), skin, 0, cy, -back - len / 2);
  add(new THREE.CircleGeometry(rb, 32).scale(1, 0.92, 1), skin, 0, cy, -back); // the firewall closes it off
  add(new THREE.ConeGeometry(rf * 0.55, 0.6, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: kind === 'p51' ? 0xd8c030 : 0xe8e4d8, roughness: 0.5 }), 0, cy, -T.prop - 0.3); // the spinner
  const blur = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  add(new THREE.RingGeometry(rf * 0.5, 1.6, 48), blur, 0, cy, -T.prop);
  // exhaust stacks along the sides of the cowling
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    add(new THREE.BoxGeometry(0.05, 0.04, 0.09), black, s * (rb - 0.02), cy + rb * 0.4, -0.95 - k * 0.2);
  }
  // the wings, low on each side, tapering to the tips
  const [wy, span, root0, tip] = T.wing;
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape([new V2(0.35, -root0 * 0.35), new V2(span, -tip * 0.4), new V2(span, tip * 0.6), new V2(0.35, root0 * 0.65)]);
    const wing = add(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).rotateX(Math.PI / 2), skin, 0, wy + 0.06, -0.5);
    wing.scale.x = s;
    wing.material = skin.clone(); wing.material.side = THREE.DoubleSide;
  }
  // the fuselage round you: its sides from the sills down to the wing, and the decking behind
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 1.2, 1.7), inside, s * 0.38, -0.72, 0.05);
  add(new THREE.BoxGeometry(0.84, 0.3, 1.6), skin, 0, -0.42, 1.25);
  // the instrument panel under the coaming, its dials, and the coaming's padded lip
  add(new THREE.BoxGeometry(0.66, 0.26, 0.04), inside, 0, -0.34, -0.63);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10).rotateZ(Math.PI / 2), black, 0, -0.205, -0.61);
  const dial = new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.4 });
  for (const [x, y, r] of [[-0.21, -0.29, 0.042], [-0.1, -0.29, 0.042], [0.1, -0.29, 0.042], [0.21, -0.29, 0.042], [-0.21, -0.39, 0.036], [-0.1, -0.39, 0.036], [0, -0.37, 0.05], [0.1, -0.39, 0.036], [0.21, -0.39, 0.036]]) {
    add(new THREE.CircleGeometry(r, 20), dial, x, y, -0.608);
  }
  // the stick and the throttle quadrant (seen when you look down)
  add(new THREE.CylinderGeometry(0.014, 0.018, 0.55, 8), black, 0, -0.62, -0.32).rotation.x = -0.2;
  add(new THREE.BoxGeometry(0.06, 0.08, 0.3), black, -0.34, -0.24, -0.15);
  // the gunsight on the coaming: the body below your line of sight, its glass plate just reaching it
  add(new THREE.BoxGeometry(0.07, 0.07, 0.14), black, 0, -0.15, -0.53);
  const plate = add(new THREE.PlaneGeometry(0.09, 0.08), glass.clone(), 0, -0.08, -0.55);
  plate.rotation.x = -0.4;
  plate.material.opacity = 0.14;

  // the windscreen and canopy frame: posts out at the corners, so the middle of the sight stays clear
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const fl = P(-0.3, -0.15, -0.55), fr = P(0.3, -0.15, -0.55), tl = P(-0.22, 0.24, -0.3), tr = P(0.22, 0.24, -0.3);
  g.add(bar(fl, tl, 0.016, frameMat), bar(fr, tr, 0.016, frameMat), bar(fl, fr, 0.014, frameMat), bar(tl, tr, 0.014, frameMat));
  const screen = add(new THREE.BufferGeometry().setFromPoints([fl, fr, tr, fl, tr, tl]), glass);
  screen.geometry.computeVertexNormals();
  if (T.framed) { // the 109's boxy canopy: rails, cross bars overhead, the armour plate behind your head
    const bl = P(-0.33, 0.24, 0.5), br = P(0.33, 0.24, 0.5), sl = P(-0.38, -0.12, 0.55), sr = P(0.38, -0.12, 0.55);
    g.add(bar(tl, bl, 0.014, frameMat), bar(tr, br, 0.014, frameMat), bar(fl, sl, 0.014, frameMat), bar(fr, sr, 0.014, frameMat));
    g.add(bar(P(-0.3, 0.27, 0.1), P(0.3, 0.27, 0.1), 0.014, frameMat), bar(bl, br, 0.014, frameMat));
    g.add(bar(P(-0.36, 0.06, -0.42), P(-0.36, 0.06, 0.55), 0.012, frameMat), bar(P(0.36, 0.06, -0.42), P(0.36, 0.06, 0.55), 0.012, frameMat));
    add(new THREE.BoxGeometry(0.5, 0.45, 0.03), new THREE.MeshStandardMaterial({ color: 0x2c2e2a, roughness: 0.6, metalness: 0.6 }), 0, 0.02, 0.32); // head armour
  } else { // the P-51D's bubble: one hoop and the rails, and the headrest behind you
    for (const s of [-1, 1]) g.add(bar(P(s * 0.34, -0.12, -0.5), P(s * 0.36, -0.12, 0.9), 0.012, frameMat));
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.012, 6, 32, Math.PI), frameMat);
    hoop.position.set(0, -0.12, 0.85);
    g.add(hoop);
    add(new THREE.BoxGeometry(0.28, 0.22, 0.08), black, 0, -0.04, 0.3);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}
