// The inside of the Sperry ball turret, as the gunner saw it, curled up on his back in the ball with
// his knees drawn up: the big round armoured-glass window between his feet, in its heavy riveted ring;
// the K-4 reflector sight hung from the roof right in front of his face, its amber reticle on the
// slanted glass; the two Brownings along either side of him (their receivers and feed chutes at the
// edges of his view, the barrels running out through the ball's sides), the ammunition boxes beside
// them; the control handles over his head with his gloved hands on them, the firing buttons under his
// thumbs; his knees and boots in the stirrups either side of the window. All round, the inside of the
// steel ball: worn interior green, bare metal at its edges, its frames, a couple of small side panes.
// Built in the camera's frame (-Z = where you look, your eye at the origin) and turned with your aim.
// It's drawn after the world and over it (the ball is closer than anything outside), so nothing of
// the bomber shows through its steel; only the window and side panes show the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wetGlass } from './environment.js';
import { insideLight } from './cabinlook.js';

const R = 0.56; // m, inside radius of the ball round your eye
export const WIN = 37; // degrees off your aim: the round window's edge
const V = THREE.Vector3, D = THREE.MathUtils.degToRad;
const PANES = [new V(-0.8, 0.52, -0.3), new V(0.8, 0.52, -0.3)].map((p) => p.normalize()); // the small side panes, up either side
const PANE = 9; // their radius, degrees
const GUN = { x: 0.3, y: 0.02 }; // the guns' bores beside you (interior.js: the ball's twin layout matches)

function smudgeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) { // smudges and oil from the guns
    const x = rnd() * 512, y = rnd() * 512, r = 10 + rnd() * 45;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(235,230,215,${0.05 + rnd() * 0.09})`);
    grd.addColorStop(1, 'rgba(235,230,215,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // oil streaks running back from the edge (the slipstream drags them round the ball)
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r0 = 200 + rnd() * 50, l = 20 + rnd() * 50;
    g.strokeStyle = `rgba(60,45,20,${0.08 + rnd() * 0.1})`; g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(256 + Math.cos(a) * r0, 256 + Math.sin(a) * r0); g.lineTo(256 + Math.cos(a) * (r0 - l), 256 + Math.sin(a) * (r0 - l)); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 0.8; // fine scratches
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
  return wetGlass(m);
}

/** The amber K-4 reticle: a cross with a gap in the middle and a dot at its centre, on black (drawn additively). */
function reticleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), m = 128;
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.shadowColor = '#ffb040'; g.shadowBlur = 6;
  g.strokeStyle = '#ffd08a'; g.lineWidth = 4.5;
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; g.beginPath(); g.moveTo(m + Math.cos(a) * 22, m + Math.sin(a) * 22); g.lineTo(m + Math.cos(a) * 104, m + Math.sin(a) * 104); g.stroke(); }
  g.fillStyle = '#ffe2b0'; g.beginPath(); g.arc(m, m, 4.5, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The steel shell round you: worn interior green, its frames, bare metal round the window; holes for the glass. */
function shellMaterial() {
  const m = insideLight(new THREE.MeshStandardMaterial({ color: 0x3a4230, roughness: 0.78, metalness: 0.35, envMapIntensity: 0.15, side: THREE.BackSide }), 0.45);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBall = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vBall;
      float bh(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float bn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(bh(i), bh(i + vec3(1,0,0)), f.x), mix(bh(i + vec3(0,1,0)), bh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(bh(i + vec3(0,0,1)), bh(i + vec3(1,0,1)), f.x), mix(bh(i + vec3(0,1,1)), bh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('void main() {', `void main() {
        vec3 bd = normalize(vBall);
        float th = acos(clamp(-bd.z, -1.0, 1.0));
        if (th < ${D(WIN).toFixed(4)}) discard; // the window
        ${PANES.map((p) => `if (dot(bd, vec3(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})) > ${Math.cos(D(PANE)).toFixed(5)}) discard;`).join('\n')}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float ph = atan(bd.y, bd.x);
        // the frames: meridians every 45 degrees and two rings, darker; bare metal round the window
        float mer = smoothstep(0.035, 0.0, abs(fract(ph / 0.7854 + 0.5) - 0.5) * 0.7854 * sin(th));
        float rings = smoothstep(0.02, 0.0, abs(th - 1.15)) + smoothstep(0.02, 0.0, abs(th - 1.75));
        float frame = clamp(mer * step(${D(WIN + 7).toFixed(3)}, th) + rings, 0.0, 1.0);
        float wear = bn(vBall * 26.0) * 0.6 + bn(vBall * 90.0) * 0.4;
        float chip = smoothstep(0.8, 0.86, wear) * (0.25 + frame) * 0.6;
        float rim = smoothstep(${D(WIN + 9).toFixed(3)}, ${D(WIN + 2).toFixed(3)}, th);
        diffuseColor.rgb *= 0.88 + 0.16 * bn(vBall * 7.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, frame);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.43, 0.4), max(chip, rim * 0.6) * 0.75);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.45, max(chip, rim * 0.6));`);
  };
  const pk = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${pk ? pk() : ''}|ball-shell`;
  return m;
}

const std = (color, roughness, metalness = 0) => insideLight(new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.4 }), 0.5);
/** A rounded-off box (bevelled edges catch the light). */
const rbox = (w, h, d, r = 0.006) => {
  const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2);
  s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  return new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 2, curveSegments: 3 }).translate(0, 0, -(d - 2 * r) / 2);
};
const rod = (a, b, r, seg = 8) => {
  const A = new V(...a), B = new V(...b), g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
};
const limb = (a, b, r) => {
  const A = new V(...a), B = new V(...b), g = new THREE.CapsuleGeometry(r, Math.max(0.005, A.distanceTo(B) - r), 4, 10);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
};
const merge = (list) => mergeGeometries(list.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const a of ['uv', 'uv1']) if (n.attributes[a]) n.deleteAttribute(a); return n; }));

/** Ring of steel round the view axis at `deg` from straight ahead. */
function latitude(deg, tube, r = R) {
  const a = D(deg);
  return new THREE.TorusGeometry(r * Math.sin(a), tube, 8, 72).translate(0, 0, -r * Math.cos(a));
}

export function buildBallTurret() {
  const g = new THREE.Group();
  const M = {
    steel: std(0x34372f, 0.45, 0.75), dark: std(0x1b1c19, 0.6, 0.5), bakelite: std(0x141210, 0.35, 0.1),
    red: std(0x8a1a12, 0.4), parker: std(0x2a2b28, 0.5, 0.6), ammo: std(0x4a5237, 0.75, 0.2), brass: std(0x9c7a36, 0.35, 0.85),
    glove: std(0x4a2f1d, 0.62), sleeve: std(0x5a3a22, 0.7), fleece: std(0xbfae88, 0.95), trousers: std(0x4f513a, 0.85), boot: std(0x1c1612, 0.5),
    sightBody: std(0x2b2d2c, 0.4, 0.55),
  };
  const add = (geo, mat, order = 1003) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; g.add(m); return m; };

  // ---- the steel ball round you, its window and side panes
  const shell = add(new THREE.SphereGeometry(R, 72, 40), shellMaterial(), 1000);
  const glass = add(new THREE.SphereGeometry(R - 0.004, 48, 12, 0, Math.PI * 2, 0, D(WIN + 1)).rotateX(-Math.PI / 2), glassMaterial(), 1001);
  const paneGlass = glassMaterial(); paneGlass.color.set(0x7d8a8e); // (seen across: darker)
  for (const p of PANES) {
    const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 0, -1), p);
    add(new THREE.SphereGeometry(R - 0.004, 24, 6, 0, Math.PI * 2, 0, D(PANE + 1)).rotateX(-Math.PI / 2).applyQuaternion(q), paneGlass, 1001);
    add(new THREE.TorusGeometry(R * Math.sin(D(PANE)), 0.01, 6, 40).translate(0, 0, -R * Math.cos(D(PANE)) + 0.006).applyQuaternion(q), M.steel, 1002);
  }
  // the window's heavy ring: its frame, the flange round it and two rows of rivets
  const ringG = [latitude(WIN, 0.026, R - 0.012), latitude(WIN + 5.5, 0.012, R - 0.006)];
  for (const [n, deg, rr, size] of [[44, WIN + 2.6, R - 0.03, 0.006], [44, WIN + 6.6, R - 0.016, 0.0045]]) for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (size < 0.005 ? Math.PI / n : 0), t = D(deg), r = rr * Math.sin(t);
    ringG.push(new THREE.SphereGeometry(size, 6, 4).translate(Math.cos(a) * r, Math.sin(a) * r, -rr * Math.cos(t)));
  }
  add(merge(ringG), M.steel, 1002);

  // ---- the two Brownings either side of you: receivers, feed covers, charging handles, the jackets out
  // to the ball's side slots (outside, the guns' own barrels carry on: weapons.js)
  const guns = [], feed = [], ammo = [], brass = [];
  for (const s of [-1, 1]) {
    const x = s * GUN.x, y = GUN.y;
    guns.push(rbox(0.1, 0.13, 0.5, 0.01).translate(x, y, 0.06)); // receiver, running back past you
    for (const dz of [-0.12, 0.0, 0.12]) guns.push(rbox(0.006, 0.11, 0.012, 0.002).translate(x - s * 0.052, y, 0.06 + dz)); // its side plate's stiffeners, facing you
    for (const [dz, dy] of [[-0.16, 0.04], [-0.16, -0.04], [0.2, 0.04], [0.2, -0.04], [0.04, 0.045], [0.04, -0.045]]) guns.push(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 8).rotateZ(Math.PI / 2).translate(x - s * 0.054, y + dy, 0.06 + dz)); // its bolts
    guns.push(rbox(0.11, 0.14, 0.02, 0.005).translate(x, y, 0.31)); // the back plate
    for (const sy of [-1, 1]) guns.push(rod([x + sy * 0.035, y - 0.02, 0.32], [x + sy * 0.04, y - 0.1, 0.36], 0.012)); // its spade grips (the guns are fired from the handles: these hang idle)
    guns.push(rbox(0.115, 0.03, 0.3, 0.006).translate(x, y + 0.09, 0.1)); // feed cover
    guns.push(rbox(0.13, 0.17, 0.08, 0.01).translate(x, y, -0.22)); // trunnion block
    guns.push(rod([x + s * 0.068, y + 0.02, 0.18], [x + s * 0.068, y + 0.02, -0.02], 0.009)); // charging handle slide
    guns.push(rod([x, y, -0.25], [x, y, -0.5], 0.032, 14)); // the jacket to the slot
    for (let k = 0; k < 9; k++) guns.push(new THREE.TorusGeometry(0.033, 0.004, 4, 14).translate(x, y, -0.28 - k * 0.025)); // its cooling holes' rims
    guns.push(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 18).rotateX(Math.PI / 2).translate(x, y, -Math.sqrt(R * R - x * x - y * y) + 0.012)); // the slot plate in the ball's side
    // the ammunition box outboard, above the gun, and the belt chute down into the feed tray
    ammo.push(rbox(0.1, 0.16, 0.26, 0.008).translate(s * 0.42, 0.17, 0.12));
    for (let k = 0; k < 3; k++) ammo.push(rbox(0.105, 0.01, 0.01, 0.003).translate(s * 0.42, 0.11 + k * 0.055, -0.015)); // its straps
    const chute = new THREE.CatmullRomCurve3([new V(s * 0.41, 0.09, 0.06), new V(s * 0.37, 0.04, 0.06), new V(s * 0.33, y + 0.09, 0.08)]);
    feed.push(new THREE.TubeGeometry(chute, 10, 0.026, 6, false));
    for (let i = 1; i < 10; i++) { const p = chute.getPointAt(i / 10), tn = chute.getTangentAt(i / 10); feed.push(new THREE.TorusGeometry(0.029, 0.004, 3, 8).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 0, 1), tn)).translate(p.x, p.y, p.z)); }
    for (let k = 0; k < 6; k++) brass.push(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6).rotateZ(Math.PI / 2).translate(s * (0.36 - k * 0.004), 0.06 - k * 0.012, 0.07)); // the belt's rounds showing
  }
  add(merge(guns), M.parker); // (in the ball's light: the sun through the window and the panes) add(merge(feed), M.dark); add(merge(ammo), M.ammo); add(merge(brass), M.brass);

  // ---- your knees drawn up and your boots in the stirrups, either side of the window, low in the view
  const legs = [], boots = [], stir = [];
  for (const s of [-1, 1]) {
    const hip = [s * 0.16, -0.4, 0.16], knee = [s * 0.29, -0.27, -0.3], ankle = [s * 0.29, -0.41, -0.38];
    legs.push(limb(hip, knee, 0.075), limb(knee, ankle, 0.06), new THREE.SphereGeometry(0.078, 12, 10).translate(...knee));
    boots.push(limb(ankle, [s * 0.3, -0.45, -0.48], 0.055), new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.8, 1.2).translate(s * 0.3, -0.46, -0.49));
    stir.push(new THREE.TorusGeometry(0.055, 0.008, 6, 18).rotateX(Math.PI / 2 - 0.4).translate(s * 0.3, -0.5, -0.48)); // the stirrup
    stir.push(rod([s * 0.3, -0.51, -0.43], [s * 0.38, -0.4, -0.38], 0.008));
  }
  add(merge(legs), M.trousers); add(merge(boots), M.boot); add(merge(stir), M.steel);

  // ---- the control handles over your head, your gloved hands on them, thumbs on the firing buttons
  const bar = [], grips = [], buttons = [], gloves = [], sleeves = [], cuffs = [];
  bar.push(rod([-0.22, 0.27, -0.16], [0.22, 0.27, -0.16], 0.014)); // the cross bar
  bar.push(rod([0, 0.27, -0.16], [0, 0.42, -0.1], 0.02)); // up to the control box
  bar.push(rbox(0.12, 0.08, 0.1, 0.01).translate(0, 0.44, -0.08));
  for (const s of [-1, 1]) {
    const gx = s * 0.17;
    grips.push(limb([gx, 0.27, -0.16], [gx + s * 0.01, 0.17, -0.19], 0.019)); // the grip, angled down and forward
    buttons.push(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12).translate(gx + s * 0.008, 0.285, -0.158)); // the firing button on top
    // the glove round the grip: palm, four curled fingers, the thumb up on the button
    gloves.push(new THREE.SphereGeometry(0.04, 12, 10).scale(1, 1.35, 0.85).translate(gx + s * 0.02, 0.22, -0.16));
    for (let f = 0; f < 4; f++) gloves.push(limb([gx - s * 0.015, 0.25 - f * 0.022, -0.2], [gx - s * 0.03, 0.245 - f * 0.022, -0.17], 0.012));
    gloves.push(limb([gx + s * 0.02, 0.25, -0.15], [gx + s * 0.008, 0.29, -0.155], 0.012));
    // the gauntlet and the jacket sleeve, going back up out of the view
    cuffs.push(limb([gx + s * 0.03, 0.2, -0.13], [gx + s * 0.05, 0.22, -0.06], 0.045));
    sleeves.push(limb([gx + s * 0.05, 0.22, -0.06], [gx + s * 0.12, 0.3, 0.12], 0.052));
  }
  add(merge(bar), M.steel); add(merge(grips), M.bakelite); add(merge(buttons), M.red);
  add(merge(gloves), M.glove, 1004); add(merge(cuffs), M.fleece, 1004); add(merge(sleeves), M.sleeve, 1004);

  // ---- the K-4 sight hung from the roof right in front of your face, its reflector glass across your line of sight
  const body = [rbox(0.1, 0.06, 0.12, 0.01).translate(0, 0.16, -0.21), rbox(0.04, 0.1, 0.04, 0.008).translate(0, 0.23, -0.22)]; // the computing head, its hanger
  for (const [x, z] of [[-0.058, -0.18], [0.058, -0.18], [0.058, -0.24]]) body.push(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 14).rotateZ(Math.PI / 2).translate(x, 0.155, z)); // its knobs
  body.push(new THREE.CylinderGeometry(0.02, 0.02, 0.016, 18).rotateX(Math.PI / 2).translate(0.03, 0.165, -0.145)); // the range drum's face
  body.push(rbox(0.09, 0.012, 0.012, 0.004).translate(0, 0.122, -0.24)); // the glass's holder
  add(merge(body), M.sightBody, 1005);
  const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xa8c0c8, roughness: 0.04, transparent: true, opacity: 0.06, clearcoat: 1, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false });
  add(new THREE.PlaneGeometry(0.085, 0.07).rotateX(-0.85).translate(0, 0.095, -0.215), plateMat, 1006); // the slanted reflector glass
  // the reticle: projected at infinity, so it sits on your aim (scaled with the range drum: setRange)
  const ret = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: reticleTexture(), color: new THREE.Color(5, 2.9, 1.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  const RET = 0.2, base = (RET * Math.tan(0.05)) / (96 / 128) * 2; // (a ring of 50 mils radius at the default range)
  ret.position.set(0, 0, -RET); ret.scale.setScalar(base); ret.renderOrder = 1007;
  g.add(ret);

  // ---- a little oxygen regulator and the interphone box up on the frames
  add(merge([rbox(0.07, 0.09, 0.03, 0.006).translate(-0.33, 0.33, -0.18), rbox(0.06, 0.05, 0.03, 0.006).translate(0.34, 0.32, -0.16)]), M.dark);
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14).rotateZ(Math.PI / 2 - 0.4).translate(-0.31, 0.35, -0.164), M.red); // the regulator's blinker

  // drawn over the world: the shell first (writing its depth), the parts inside it after, against that
  shell.material.depthTest = false; shell.material.depthWrite = true; shell.material.transparent = true;
  for (const m of g.children) {
    m.castShadow = false; m.receiveShadow = true;
    if (m === shell || m === ret) continue;
    m.material.transparent = true;
    if (m.material === glass.material || m.material === paneGlass) m.material.depthTest = false;
    else if (m.material !== plateMat) m.material.depthWrite = true;
  }
  g.userData.setRange = (k) => ret.scale.setScalar(base * k); // the range ring: 1 = the default
  return g;
}
