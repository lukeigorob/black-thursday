// The inside of the Sperry upper turret: you stand with your head up in a low glass dome that turns
// with the guns but stays level when they elevate, as the real one does. Glass like the ball turret's
// (faint reflections, smudges, brighter at the edges), a heavy riveted steel ring round its base just
// under your line of sight, frame bars over the back only (the front stays clear) meeting a small
// crown ring, and the reflector sight in front of you, which does tilt with the guns.
// Built in the camera's frame (-Z = where you look); `userData.level` is the part kept level.
import * as THREE from 'three';
import { glassMaterial } from './ballturret.js';

const R = 0.6; // m, radius of the dome
const H = 0.56; // m, height of the dome above its base ring
const BASE = -0.3; // m, the base ring is this far below your eye (the guns run out just above it)

export function buildTopTurret() {
  const g = new THREE.Group();
  const shell = new THREE.Group(); // turns with the turret, kept level (player.js)
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d38, roughness: 0.55, metalness: 0.7, envMapIntensity: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1b, roughness: 0.7, metalness: 0.5, envMapIntensity: 0.3 });
  // the dome: a flattened half-sphere of glass
  const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, H / R, 1).translate(0, BASE, 0), glassMaterial());
  glass.renderOrder = 3;
  // the steel skirt the dome sits on, down into the fuselage
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.01, R - 0.04, 0.3, 40, 1, true).translate(0, BASE - 0.15, 0), dark);
  skirt.material = dark.clone();
  skirt.material.side = THREE.BackSide;
  const frame = [new THREE.TorusGeometry(R - 0.005, 0.022, 8, 64).rotateX(Math.PI / 2).translate(0, BASE + 0.01, 0)];
  // a point on the dome at elevation `el` and bearing `az` (0 = ahead, -Z)
  const on = (el, az, r = 0.995) => new THREE.Vector3(-Math.sin(az) * Math.cos(el) * R * r, BASE + Math.sin(el) * H * r, -Math.cos(az) * Math.cos(el) * R * r);
  const CROWN = THREE.MathUtils.degToRad(68);
  // frame bars over the back half, base ring to crown ring (none in the front 120 degrees)
  for (const deg of [65, 110, 150, 180, 210, 250, 295]) {
    const az = THREE.MathUtils.degToRad(deg), pts = [];
    for (let k = 0; k <= 12; k++) pts.push(on((k / 12) * CROWN, az));
    frame.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, deg === 180 ? 0.014 : 0.009, 5));
  }
  const crown = [];
  for (let k = 0; k <= 48; k++) crown.push(on(CROWN, (k / 48) * Math.PI * 2));
  frame.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(crown, true), 48, 0.01, 5, true));
  for (let k = 0; k < 36; k++) { // rivets round the base ring
    const a = (k / 36) * Math.PI * 2;
    frame.push(new THREE.SphereGeometry(0.006, 5, 4).translate(Math.cos(a) * (R - 0.03), BASE + 0.032, Math.sin(a) * (R - 0.03)));
  }
  for (const geo of frame) shell.add(new THREE.Mesh(geo, steel));
  shell.add(glass, skirt);
  // the reflector sight on the guns, low in front of you, tilting with your aim
  const sight = new THREE.Group();
  // (small, between the guns and below your line of sight: the target is never behind it)
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.08), dark);
  housing.position.set(0, -0.17, -0.36);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.034), new THREE.MeshPhysicalMaterial({
    color: 0xbfd8e0, transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  plate.position.set(0, -0.137, -0.37);
  plate.rotation.x = -0.35;
  plate.renderOrder = 4;
  sight.add(housing, plate);
  g.add(shell, sight);
  g.userData.level = shell;
  return g;
}
