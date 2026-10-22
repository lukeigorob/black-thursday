// The inside of the Sperry ball turret: you curl up in a steel and glass ball that turns with your
// aim. Glass that looks like glass (faint reflections, smudges and scratches, more visible at the
// edges), a steel frame in rings round your line of sight (the middle stays clear), a riveted window
// ring, and the dark steel back half behind you. Built in the camera's frame (-Z = where you look).
import * as THREE from 'three';

const R = 0.56; // m, inside radius of the ball round your eye
const V = THREE.Vector3;

function smudgeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(255,255,255,0.05)'; // the glass itself: barely there
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) { // smudges and oil from the guns
    const x = rnd() * 512, y = rnd() * 512, r = 10 + rnd() * 45;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(235,235,225,${0.06 + rnd() * 0.1})`);
    grd.addColorStop(1, 'rgba(235,235,225,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 0.8; // fine scratches
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 512, y = rnd() * 512, a = rnd() * 6.28, l = 8 + rnd() * 40;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glass: transparent, glossy, and more opaque where you look across it (Fresnel), like real glass. */
export function glassMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    map: smudgeTexture(), color: 0xdfe8ec, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08,
    transparent: true, opacity: 1, depthWrite: false, side: THREE.BackSide, envMapIntensity: 1.6,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
      diffuseColor.a = clamp(diffuseColor.a + pow(1.0 - facing, 3.0) * 0.45, 0.0, 0.6);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'ball-glass';
  return m;
}

/** Ring of steel round the view axis at `deg` from straight ahead. */
function latitude(deg, tube) {
  const a = THREE.MathUtils.degToRad(deg), r = R * Math.sin(a);
  return new THREE.TorusGeometry(r, tube, 6, 64).translate(0, 0, -R * Math.cos(a));
}

export function buildBallTurret() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d38, roughness: 0.55, metalness: 0.7, envMapIntensity: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1b, roughness: 0.7, metalness: 0.5, envMapIntensity: 0.3 });
  // the glass: the front three-quarters of the ball
  const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(-Math.PI / 2), glassMaterial());
  glass.renderOrder = 3;
  // the steel back of the ball behind you (and the hatch you climbed in by)
  const back = new THREE.Mesh(new THREE.SphereGeometry(R + 0.01, 32, 16, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38).rotateX(-Math.PI / 2), dark);
  back.material.side = THREE.BackSide;
  // the frame: rings round your line of sight, the front window's ring heavier and riveted
  const frame = [latitude(28, 0.014), latitude(52, 0.01), latitude(78, 0.012), latitude(110, 0.016)];
  for (let k = 0; k < 8; k++) { // struts between the rings (none across the front window)
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const p0 = new V().setFromSphericalCoords(R - 0.005, THREE.MathUtils.degToRad(28), a), p1 = new V().setFromSphericalCoords(R - 0.005, THREE.MathUtils.degToRad(110), a);
    // spherical coords are about +Y: turn them so they're about the view axis (-Z)
    for (const p of [p0, p1]) p.set(p.x, p.z, -p.y);
    const len = p0.distanceTo(p1), strut = new THREE.CylinderGeometry(0.009, 0.009, len, 5);
    strut.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), p1.clone().sub(p0).normalize()));
    frame.push(strut.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2));
  }
  const a28 = THREE.MathUtils.degToRad(28);
  for (let k = 0; k < 24; k++) { // rivets round the front window
    const a = (k / 24) * Math.PI * 2, r = R * Math.sin(a28) + 0.018;
    frame.push(new THREE.SphereGeometry(0.006, 5, 4).translate(Math.cos(a) * r, Math.sin(a) * r, -R * Math.cos(a28) + 0.004));
  }
  for (const geo of frame) g.add(new THREE.Mesh(geo, steel));
  g.add(glass, back);
  g.position.set(0, 0, 0.06); // (your eye sits a little forward of the ball's centre, at the window)
  return g;
}
