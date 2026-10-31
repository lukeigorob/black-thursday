// The P-47D razorback's cockpit, for flying one in first person, built to the photographs of the real one
// (the restored panels, the labelled cockpit guides) and set in the aeroplane itself: what you see of the
// nose, the wings and the spine round you is p47.js's own model, so it's the same aircraft inside and out.
// - The big, roomy cockpit of the Thunderbolt in dull dark green, with no floor: below the seat and the
//   rudder pedals you look down into the fuselage, its frames and stringers, the turbo's ducts running
//   forward under you.
// - The black instrument panel: every dial drawn once, face and markings, into one texture, with their
//   needles moving every frame (one instanced mesh of needles, one of bars, one of dots: no redrawing):
//   the clock, the directional gyro's card, the gyro horizon, airspeed, altimeter, turn and bank with its
//   ball, rate of climb, the turbo's tachometer, manifold pressure, the engine's rpm, the three-in-one
//   engine gauge, carburettor air and cylinder head temperatures, the accelerometer, suction, fuel,
//   hydraulic and oxygen pressure and the oxygen blinker, the standby compass; fluorescent at night.
// - The N-3B reflector sight on the coaming, its glass on your eye line (pilot.js puts the reticle on the
//   guns' line through it) and its rubber pad stencilled NO HAND HOLD.
// - The stick between your knees and the throttle quadrant on the left (the turbo's boost lever outboard
//   of the throttle, the propeller and mixture levers inboard), moving under your hands; the trim wheels,
//   the gear and flap handles, the radio's control box, the oxygen regulator, the canopy crank.
// - The razorback's framed canopy round you: the flat armoured windscreen, its quarter panes, the sliding
//   hood, the mirror on the bow; the armour plate and the spine behind your head.
// Same interface as cockpit.js's buildCockpit: a group placed on the fighter each frame, .userData.update(state, dt)
// and .userData.night(k).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wetGlass } from './environment.js';
import { buildP47, canopyGlass, canopyFrameSegments, windscreen, fusePoint, fuse, SILL, WS_Z } from './p47.js';

const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
// the panel: its size (m), where it stands (its centre), leaning back at the top; the canvas it's drawn in
const PW = 0.8, PH = 0.38, PANEL_AT = [0, 0.64, -0.7], PANEL_TILT = -0.21, CW = 2048, CH = 973, PX = CW / PW;
const INK = '#ece7d6';

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const clamp = THREE.MathUtils.clamp;

// ---------- geometry helpers

/** A geometry ready to merge: non-indexed, position and normal, and a vertex colour shaded darker the deeper it is in the cockpit. */
function paintGeo(geo, hex, ao = true) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(hex), p = g.attributes.position, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // (light falls in from above through the canopy: the deep fuselage is dark)
    const k = ao ? clamp(0.18 + (p.getY(i) + 0.55) / 1.45, 0.18, 1) : 1;
    a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** A rod from a to b (radius r, r1 at b). */
function rod(a, b, r, seg = 8, r1 = r) {
  const d = new V3().subVectors(b, a), g = new THREE.CylinderGeometry(r1, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A flat pane through four corners (two triangles). */
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((p) => p.toArray()), 3));
  g.computeVertexNormals();
  return g;
}

/** A gloved hand, closed round a grip: palm, thumb, the curl of the fingers. */
function handGeo() {
  return [
    new RoundedBoxGeometry(0.085, 0.05, 0.1, 2, 0.018),
    new THREE.CapsuleGeometry(0.023, 0.07, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.022, -0.055),
    new THREE.CapsuleGeometry(0.015, 0.045, 3, 6).rotateX(0.8).translate(-0.05, 0.022, -0.02),
  ];
}

// ---------- the instrument faces

/** Where panel point (x, y) (m, from the panel's centre, y up) is on the canvas. */
const px = (x, y) => [(x / PW + 0.5) * CW, (0.5 - y / PH) * CH];

/**
 * The dials: [id, x, y, r] in metres on the panel. Laid out as the P-47D's: the clock and accelerometer top
 * left, the directional gyro and the gyro horizon top centre over airspeed, altimeter, turn and bank and rate of
 * climb, the engine's instruments on the right, fuel, hydraulics, the compass and oxygen below.
 */
const DIALS = [
  ['clock', -0.315, 0.125, 0.026], ['accel', -0.315, 0.035, 0.026], ['suction', -0.315, -0.05, 0.02],
  ['dg', -0.06, 0.12, 0.04], ['horizon', 0.06, 0.12, 0.04], ['carb', 0.215, 0.135, 0.023], ['cht', 0.305, 0.135, 0.023],
  ['speed', -0.2, 0.03, 0.04], ['alt', -0.1, 0.03, 0.04], ['turn', 0, 0.025, 0.034], ['climb', 0.1, 0.03, 0.04],
  ['turbo', 0.205, 0.04, 0.027], ['boost', 0.305, 0.04, 0.034], ['rpm', 0.305, -0.055, 0.034], ['engine', 0.205, -0.06, 0.03],
  ['fuel', -0.2, -0.065, 0.03], ['hyd', -0.09, -0.075, 0.021], ['oxy', 0.1, -0.075, 0.021],
];
const COMPASS = [0, -0.08, 0.06, 0.042]; // the B-16 standby compass, a box below the turn and bank: x, y, w, h

/** Draws the panel's face once: black crinkle paint, the dials' faces and scales, placards, switch plates. */
function panelArt() {
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d'), r = rng(5);
  g.fillStyle = '#121212'; g.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 26000; i++) { g.fillStyle = r() < 0.5 ? '#ffffff07' : '#00000018'; g.fillRect(r() * CW, r() * CH, 2 + r() * 2, 2 + r() * 2); } // the crinkle finish
  g.strokeStyle = '#ffffff14'; g.lineWidth = 2; // worn along its edges
  for (let i = 0; i < 90; i++) { const x = r() * CW, y = r() < 0.5 ? r() * 30 : CH - r() * 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 + r() * 40, y + (r() - 0.5) * 5); g.stroke(); }
  // the shock-mounted centre panel's edge and its screws
  g.strokeStyle = '#000'; g.lineWidth = 4; const [ax, ay] = px(-0.255, 0.18), [bx, by] = px(0.255, -0.11); g.strokeRect(ax, ay, bx - ax, by - ay);
  for (let x = ax + 20; x < bx; x += 90) for (const y of [ay + 14, by - 14]) screw(g, x, y, 6);
  for (const [id, x, y, rr] of DIALS) dial(g, id, ...px(x, y), rr * PX);
  compassFace(g);
  // the placards and labels, white on black, as stencilled and engraved
  const label = (x, y, text, size = 15, col = INK) => { g.fillStyle = col; g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, ...px(x, y)); };
  const plate = (x, y, w, h, lines, bg = '#d6d0ba', fg = '#151515') => {
    const [x0, y0] = px(x - w / 2, y + h / 2); g.fillStyle = bg; g.fillRect(x0, y0, w * PX, h * PX);
    g.fillStyle = fg; g.font = `700 ${Math.round(h * PX / (lines.length + 0.6))}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((t, i) => g.fillText(t, x0 + w * PX / 2, y0 + (i + 0.8) * h * PX / (lines.length + 0.6)));
    screw(g, x0 + 6, y0 + 6, 3); screw(g, x0 + w * PX - 6, y0 + 6, 3);
  };
  plate(-0.06, 0.172, 0.13, 0.016, ['NEVER EXCEED 500 M.P.H. I.A.S.']);
  plate(0.27, -0.165, 0.16, 0.026, ['USE 100 OCTANE FUEL', 'WATER INJ. OFF']);
  plate(-0.2, -0.165, 0.14, 0.026, ['AIRCRAFT NO. 42-75855', 'P-47D-6-RE']);
  label(-0.235, 0.155, 'WHEELS', 12); label(-0.235, 0.105, 'UP  DOWN', 11);
  for (const s of [-1, 1]) { const [x, y] = px(-0.235 + s * 0.012, 0.13); g.fillStyle = '#222'; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill(); }
  // the ignition switch and the starter's, the primer, battery and generator switches across the bottom
  label(-0.33, -0.112, 'IGNITION', 12);
  for (const [t, a] of [['OFF', -60], ['L', -20], ['R', 20], ['BOTH', 60]]) label(-0.33 + Math.sin(a * DEG) * 0.03, -0.14 + Math.cos(a * DEG) * 0.03, t, 10);
  for (const [i, t] of ['BATTERY', 'GENERATOR', 'STARTER', 'PRIMER', 'GUN HEAT', 'PITOT HT'].entries()) label(-0.1 + i * 0.045, -0.13, t, 9);
  label(0.205, -0.112, 'ENGINE GAUGE', 10);
  return c;
}

function screw(g, x, y, r, col = '#3a3c3e') {
  g.fillStyle = '#000a'; g.beginPath(); g.arc(x + 1, y + 1, r, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.strokeStyle = '#0c0c0c'; g.lineWidth = Math.max(1, r * 0.3); g.beginPath(); g.moveTo(x - r * 0.7, y - r * 0.2); g.lineTo(x + r * 0.7, y + r * 0.2); g.stroke();
}

/** Angle (deg, clockwise from 12 o'clock) to canvas offsets at radius R. */
const at = (a, R) => [Math.sin(a * DEG) * R, -Math.cos(a * DEG) * R];

/**
 * A scale: ticks from min to max over angles a0..a1, numbers every `major`. Coloured arcs: [from, to, colour].
 * The value's angle is lin(v) (or the scale's own map).
 */
function scale(g, R, { min, max, a0, a1, major, minor, num = (v) => v, numEvery = major, arcs = [], map = null, size = 0.2, rad = 0.66 }) {
  const ang = map ?? ((v) => a0 + ((v - min) / (max - min)) * (a1 - a0));
  for (const [f, t, col] of arcs) { g.strokeStyle = col; g.lineWidth = R * 0.07; g.beginPath(); for (let v = f; v <= t + 1e-6; v += (t - f) / 24) { const [x, y] = at(ang(v), R * 0.86); v === f ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
  g.strokeStyle = INK; g.fillStyle = INK; g.lineCap = 'butt';
  const eq = (v, step) => Math.abs((v - min) / step - Math.round((v - min) / step)) < 1e-4;
  for (let i = 0, n = Math.round((max - min) / minor); i <= n; i++) {
    const v = +(min + i * minor).toFixed(4), big = eq(v, major), a = ang(v);
    g.lineWidth = big ? R * 0.045 : R * 0.022;
    const [x0, y0] = at(a, R * (big ? 0.76 : 0.83)), [x1, y1] = at(a, R * 0.95);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    if (eq(v, numEvery)) { g.font = `700 ${Math.round(R * size)}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(num(v), ...at(a, R * rad)); }
  }
  return ang;
}

function text(g, s, x, y, size, col = INK) { g.fillStyle = col; g.font = `700 ${Math.round(size)}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); }

// the scales' maps, shared by the faces and the needles (degrees clockwise from 12 o'clock)
const MAP = {
  speed: (v) => -150 + (clamp(v, 40, 600) - 40) / 560 * 315, // mph, indicated
  climb: (v) => -90 + clamp(v, -6, 6) / 6 * 170, // thousands of ft/min: 0 at 9 o'clock, up clockwise
  boost: (v) => -140 + (clamp(v, 10, 75) - 10) / 65 * 280, // in. Hg
  rpm: (v) => -140 + clamp(v, 0, 35) / 35 * 280, // hundreds
  turbo: (v) => -135 + clamp(v, 0, 30) / 30 * 270, // thousands
  carb: (v) => -135 + (clamp(v, -50, 150) + 50) / 200 * 270, // deg C
  cht: (v) => -135 + clamp(v, 0, 350) / 350 * 270,
  accel: (v) => -90 + (clamp(v, -5, 12) + 5) / 17 * 300 - 60,
  suction: (v) => -120 + clamp(v, 0, 10) / 10 * 240,
  fuel: (v) => -120 + clamp(v, 0, 300) / 300 * 240, // US gallons
  hyd: (v) => -120 + clamp(v, 0, 2000) / 2000 * 240,
  oxy: (v) => -120 + clamp(v, 0, 500) / 500 * 240,
};

/** One instrument's face: its flange and screws, the black face, its scale and lettering. */
function dial(g, id, cx, cy, R) {
  g.save(); g.translate(cx, cy);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screw(g, a * (R + 9) * 0.86, b * (R + 9) * 0.86, Math.max(4, R * 0.06));
  g.fillStyle = '#050505'; g.beginPath(); g.arc(0, 0, R * 1.08, 0, 7); g.fill(); // (the bezel's opening: the 3D bezel sits on its edge)
  g.fillStyle = '#0d0d0d'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  const lab = (s, y, k = 0.13) => text(g, s, 0, R * y, R * k);
  switch (id) {
    case 'clock':
      scale(g, R, { min: 0, max: 60, a0: 0, a1: 360, major: 5, minor: 1, num: (v) => (v ? v / 5 : 12), numEvery: 5, size: 0.24, rad: 0.62 });
      lab('8 DAY', 0.32, 0.12); break;
    case 'accel':
      scale(g, R, { min: -5, max: 12, map: MAP.accel, major: 1, minor: 1, num: (v) => v, numEvery: 5, size: 0.22, arcs: [[-5, -3, '#b02020'], [8, 12, '#b02020']] });
      lab('G', -0.25, 0.22); lab('ACCELERATION', 0.38, 0.11); break;
    case 'suction':
      scale(g, R, { min: 0, max: 10, map: MAP.suction, major: 2, minor: 1, arcs: [[3.75, 4.25, '#2e8a3a']], size: 0.25 });
      lab('SUCTION', 0.4, 0.15); break;
    case 'dg': // the directional gyro: its card turns behind a window; the caging knob below
      g.fillStyle = '#000'; g.fillRect(-R * 0.66, -R * 0.36, R * 1.32, R * 0.52);
      g.strokeStyle = '#888'; g.lineWidth = 2; g.strokeRect(-R * 0.66, -R * 0.36, R * 1.32, R * 0.52);
      lab('DIRECTIONAL GYRO', -0.6, 0.12); lab('PUSH TO CAGE', 0.42, 0.11); lab('SET', 0.64, 0.12); break;
    case 'horizon': // the Sperry gyro horizon: the bank scale round the top, the window black, the bar and aeroplane over it
      for (const a of [-90, -60, -30, -20, -10, 0, 10, 20, 30, 60, 90]) { g.strokeStyle = INK; g.lineWidth = a % 30 ? R * 0.025 : R * 0.05; g.beginPath(); g.moveTo(...at(a, R * 0.82)); g.lineTo(...at(a, R * 0.96)); g.stroke(); }
      g.strokeStyle = '#555'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R * 0.8, 0, 7); g.stroke();
      lab('GYRO HORIZON', 0.6, 0.11); break;
    case 'speed':
      scale(g, R, { min: 40, max: 600, map: MAP.speed, major: 50, minor: 10, num: (v) => v, numEvery: 100, size: 0.17, arcs: [[495, 505, '#c02020']] });
      lab('AIR SPEED', -0.32, 0.12); lab('M.P.H.', 0.34, 0.12); break;
    case 'alt':
      scale(g, R, { min: 0, max: 10, a0: 0, a1: 360, major: 1, minor: 0.2, num: (v) => (v < 10 ? v : ''), numEvery: 1, size: 0.22, rad: 0.62 });
      lab('ALTITUDE', -0.3, 0.11); lab('FEET', 0.3, 0.11);
      g.fillStyle = '#000'; g.fillRect(R * 0.32, -R * 0.08, R * 0.32, R * 0.16); text(g, '29.9', R * 0.48, 0, R * 0.11); break; // (the Kollsman window)
    case 'turn': // turn and bank: the needle's index marks, the ball's glass tube
      for (const a of [-20, 0, 20]) { g.strokeStyle = INK; g.lineWidth = R * 0.05; g.beginPath(); g.moveTo(...at(a, R * 0.78)); g.lineTo(...at(a, R * 0.94)); g.stroke(); }
      g.fillStyle = '#d8d2c0'; g.beginPath(); g.ellipse(0, R * 0.5, R * 0.62, R * 0.16, 0, 0, 7); g.fill(); // the tube
      g.fillStyle = '#9a9278'; g.beginPath(); g.ellipse(0, R * 0.5, R * 0.62, R * 0.07, 0, 0, Math.PI); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 3; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * R * 0.14, R * 0.36); g.lineTo(s * R * 0.14, R * 0.64); g.stroke(); }
      lab('L', -0.1, 0.2); text(g, 'L', -R * 0.5, -R * 0.15, R * 0.2); text(g, 'R', R * 0.5, -R * 0.15, R * 0.2); lab('TURN', 0.2, 0.12); break;
    case 'climb':
      scale(g, R, { min: -6, max: 6, map: MAP.climb, major: 1, minor: 0.5, num: (v) => Math.abs(v), numEvery: 1, size: 0.18 });
      lab('UP', -0.3, 0.13); lab('DOWN', 0.3, 0.13); lab('RATE OF CLIMB', 0.04, 0.09); text(g, '1000 FT PER MIN', R * 0.28, R * 0.55, R * 0.08); break;
    case 'turbo':
      scale(g, R, { min: 0, max: 30, map: MAP.turbo, major: 5, minor: 1, num: (v) => v, numEvery: 10, size: 0.24, arcs: [[22, 30, '#c02020'], [8, 20, '#2e8a3a']] });
      lab('TURBO', -0.3, 0.15); lab('RPM x1000', 0.4, 0.12); break;
    case 'boost':
      scale(g, R, { min: 10, max: 75, map: MAP.boost, major: 5, minor: 1, num: (v) => v, numEvery: 10, size: 0.2, arcs: [[28, 42, '#2e8a3a'], [52, 56, '#c02020']] });
      lab('MANIFOLD', -0.3, 0.12); lab('PRESSURE', -0.15, 0.1); lab('IN. HG.', 0.36, 0.11); break;
    case 'rpm':
      scale(g, R, { min: 0, max: 35, map: MAP.rpm, major: 5, minor: 1, num: (v) => v, numEvery: 5, size: 0.2, arcs: [[20, 25.5, '#2e8a3a'], [26.8, 27.2, '#c02020']] });
      lab('TACHOMETER', -0.3, 0.11); lab('R.P.M. x100', 0.38, 0.11); break;
    case 'engine': { // the engine gauge unit: fuel pressure, oil pressure, oil temperature in one case
      for (const [ox, oy, s, max, l] of [[-0.42, -0.3, 'FUEL', 25, 'LBS'], [0.42, -0.3, 'OIL', 200, 'LBS'], [0, 0.38, 'OIL', 100, '°C']]) {
        g.save(); g.translate(ox * R, oy * R);
        g.strokeStyle = '#444'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, R * 0.46, 0, 7); g.stroke();
        scale(g, R * 0.46, { min: 0, max, a0: -110, a1: 110, major: max / 5, minor: max / 10, num: (v) => v, numEvery: max / 5 * (max === 200 ? 2 : 1), size: 0.3, rad: 0.6 });
        text(g, s, 0, R * 0.15, R * 0.11); text(g, l, 0, R * 0.27, R * 0.08);
        g.restore();
      }
      break;
    }
    case 'carb':
      scale(g, R, { min: -50, max: 150, map: MAP.carb, major: 50, minor: 10, num: (v) => v, numEvery: 50, size: 0.24, arcs: [[15, 38, '#2e8a3a']] });
      lab('CARB. AIR', 0.36, 0.14); break;
    case 'cht':
      scale(g, R, { min: 0, max: 350, map: MAP.cht, major: 50, minor: 25, num: (v) => v, numEvery: 100, size: 0.24, arcs: [[150, 232, '#2e8a3a'], [260, 270, '#c02020']] });
      lab('CYL. TEMP', 0.36, 0.14); break;
    case 'fuel':
      scale(g, R, { min: 0, max: 300, map: MAP.fuel, major: 50, minor: 25, num: (v) => v, numEvery: 100, size: 0.22 });
      lab('FUEL', -0.3, 0.15); lab('U.S. GALLONS', 0.36, 0.12); lab('MAIN', 0.55, 0.12); break;
    case 'hyd':
      scale(g, R, { min: 0, max: 2000, map: MAP.hyd, major: 500, minor: 250, num: (v) => v / 100, numEvery: 1000, size: 0.26, arcs: [[800, 1100, '#2e8a3a']] });
      lab('HYD.', 0.4, 0.17); break;
    case 'oxy':
      scale(g, R, { min: 0, max: 500, map: MAP.oxy, major: 100, minor: 50, num: (v) => v / 100, numEvery: 100, size: 0.26, arcs: [[400, 425, '#2e8a3a']] });
      lab('OXYGEN', 0.4, 0.15); break;
    default: break;
  }
  // the glass's glint
  const gl = g.createLinearGradient(-R, -R, R * 0.4, R * 0.3); gl.addColorStop(0, '#ffffff1c'); gl.addColorStop(0.5, '#ffffff05'); gl.addColorStop(0.55, '#ffffff00');
  g.fillStyle = gl; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.restore();
}

function compassFace(g) {
  const [x, y, w, h] = COMPASS, [x0, y0] = px(x - w / 2, y + h / 2);
  g.fillStyle = '#1a1a1a'; g.fillRect(x0 - 6, y0 - 6, w * PX + 12, h * PX + 12);
  g.fillStyle = '#000'; g.fillRect(x0 + w * PX * 0.12, y0 + h * PX * 0.2, w * PX * 0.76, h * PX * 0.5);
  text(g, 'COMPASS', x0 + w * PX / 2, y0 + h * PX * 0.86, 14);
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) screw(g, x0 + a * w * PX, y0 + b * h * PX, 4);
}

/** A heading card on a strip (for the gyro and the compass): ticks every 5 degrees, numbers every 30, N E S W. */
function cardTex(bg = '#0e0e0e', ink = INK) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 2048, 128);
  g.strokeStyle = ink; g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 5) {
    const x = d / 360 * 2048, big = d % 10 === 0;
    g.lineWidth = big ? 4 : 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, big ? 34 : 22); g.stroke();
    if (d % 30 === 0) { g.font = '700 54px "Arial Narrow", Arial, sans-serif'; g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10), x, 84); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** The N-3B's crash pad lettering: NO HAND HOLD, white on the black rubber. */
function padTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#141414'; g.fillRect(0, 0, 256, 128);
  text(g, 'NO', 128, 34, 34, '#d8d4c6'); text(g, 'HAND HOLD', 128, 84, 34, '#d8d4c6');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let GRAIN = null;
/** Paint grain and wear (a multiplier on the colour): made once. */
function grainTex() {
  if (GRAIN) return GRAIN;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), r = rng(19);
  g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) { const x = r() * 256, y = r() * 256, rr = 6 + r() * 30, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(0,0,0,${0.05 + r() * 0.08})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  for (let i = 0; i < 5000; i++) { const v = 190 + r() * 65 | 0; g.fillStyle = `rgba(${v},${v},${v},0.3)`; g.fillRect(r() * 256, r() * 256, 1.2, 1.2); }
  GRAIN = new THREE.CanvasTexture(c); GRAIN.wrapS = GRAIN.wrapT = THREE.RepeatWrapping; GRAIN.colorSpace = THREE.SRGBColorSpace;
  return GRAIN;
}

/** Triplanar-ish uv in metres (so the grain is the same size everywhere): from position, by the face's main axis. */
function boxUV(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax > ay && ax > az ? [p.getZ(i), p.getY(i)] : ay > az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * 2.5; uv[i * 2 + 1] = v * 2.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------- the cockpit

/** The P-47's cockpit; call .userData.update(state, dt) every frame and .userData.night(k) when the light changes. */
export function buildCockpitP47() {
  const root = new THREE.Group();
  root.matrixAutoUpdate = false; // placed on the fighter each frame (pilot.js); everything in the model's own frame
  // ---- the aeroplane round you: p47.js's model, without its pilot and outside glass; the propeller a faint blur
  const shell = buildP47();
  for (const n of ['P47_Pilot', 'P47_Canopy', 'P47_Frames']) shell.getObjectByName(n)?.removeFromParent();
  shell.getObjectByName('P47_Blades').visible = false;
  const disc = shell.getObjectByName('Fake_Blades');
  disc.visible = true; disc.material = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
  const hub = shell.getObjectByName('P47_Spinner');
  root.add(shell);

  const grain = grainTex();
  const fit = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 0.78, metalness: 0.15, side: THREE.DoubleSide }); // paint, rubber, leather, cloth
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 0.38, metalness: 0.85 }); // steel, aluminium
  const parts = { fit: [], metal: [] };
  const put = (list, geo, hex, ao = true) => parts[list].push(boxUV(paintGeo(geo, hex, ao)));
  const GREEN = 0x3b4a32, ZINC = 0x56683e, BLACK = 0x141414, LEATHER = 0x3a2618, SUIT = 0x5f5640, KHAKI = 0x7d7158, STEEL = 0x707478, ALU = 0x9a9ea2;
  const P = (x, y, z) => new V3(x, y, z);

  // ---- the inside of the fuselage: its skin, frames and stringers from the windscreen back past the seat,
  // down into the belly (no floor), the ducts under you
  const Z0 = -1.25, Z1 = 0.75, inner = (z, a, k = 0.975) => { const p = fusePoint(z, a), [, , mid] = fuse(z); return P(p.x * k, mid + (p.y - mid) * k, z); };
  {
    const rows = [], seg = 40, zs = [];
    for (let z = Z0; z <= Z1 + 1e-6; z += 0.1) zs.push(z);
    for (const z of zs) { const row = []; for (let k = 0; k <= seg; k++) { const p = inner(z, -Math.PI / 2 + (k / seg) * Math.PI * 2); p.y = Math.min(p.y, SILL - 0.01); row.push(p); } rows.push(row); }
    const pos = [];
    for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < seg; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
      if (Math.min(a.y, b.y, c.y, d.y) > SILL - 0.0105) continue; // (open above the sills)
      pos.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray());
    }
    const skinIn = new THREE.BufferGeometry(); skinIn.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); skinIn.computeVertexNormals();
    put('fit', skinIn, GREEN);
    // the frames: a deep flange round the inside at each station, and the stringers along it
    for (const z of [-1.2, -0.92, -0.62, -0.32, -0.02, 0.28, 0.58]) {
      const fr = [];
      for (let k = 0; k <= 32; k++) { const a = -Math.PI / 2 + (k / 32) * Math.PI * 2; const o = inner(z, a), i = inner(z, a, 0.9); if (o.y > SILL - 0.01) { o.y = SILL - 0.01; i.y = SILL - 0.01; } fr.push([o, i]); }
      for (let k = 0; k < 32; k++) { const [o0, i0] = fr[k], [o1, i1] = fr[k + 1]; if (o0.y >= SILL - 0.011 && o1.y >= SILL - 0.011) continue; put('fit', quad(o0, o1, i1, i0), ZINC); put('fit', quad(i0, i1, i1.clone().setZ(z + 0.02), i0.clone().setZ(z + 0.02)), ZINC); }
    }
    for (let k = 0; k < 18; k++) { const a = -Math.PI / 2 + (k / 18) * Math.PI * 2, p0 = inner(Z0, a, 0.96), p1 = inner(Z1, a, 0.96); if (p0.y > SILL - 0.05) continue; put('fit', rod(p0, p1, 0.008, 4), ZINC); }
    // the cockpit's sills: a broad, padded edge either side, the canopy rails on them
    for (const s of [-1, 1]) {
      const x = Math.abs(inner(-0.2, 0, 1).x);
      put('fit', new THREE.BoxGeometry(0.06, 0.03, Z1 - WS_Z).translate(s * (x - 0.03), SILL - 0.02, (Z1 + WS_Z) / 2), GREEN);
    }
    // the turbo's ducts running forward under the cockpit to the engine, and the belly's keel
    for (const s of [-1, 1]) put('fit', rod(P(s * 0.24, -0.62, Z0), P(s * 0.22, -0.6, Z1), 0.13, 14), 0x5e605a);
    put('metal', rod(P(0, -0.92, Z0), P(0, -0.86, Z1), 0.03, 6), 0x55585a);
    // the firewall ahead of your feet, behind the panel
    const fw = []; for (let k = 0; k <= 24; k++) fw.push(inner(-1.25, -Math.PI / 2 + (k / 24) * Math.PI * 2, 0.98));
    for (let k = 0; k < 24; k++) put('fit', new THREE.BufferGeometry().setFromPoints([P(0, 0, -1.25), fw[k + 1], fw[k]]), 0x2b3326);
  }

  // ---- the seat on its rails, the parachute pack in it, the armour plate and headrest behind your head; the
  // shoulder harness and lap belt
  put('fit', new THREE.CylinderGeometry(0.25, 0.23, 0.42, 20, 1, true, -Math.PI * 0.55, Math.PI * 1.1).rotateY(Math.PI).scale(1, 1, 0.6).translate(0, 0.5, 0.2), ZINC);
  put('fit', new THREE.BoxGeometry(0.46, 0.03, 0.42).translate(0, 0.28, 0.06), ZINC);
  put('fit', new RoundedBoxGeometry(0.4, 0.1, 0.38, 2, 0.03).translate(0, 0.33, 0.06), 0x50483a); // the seat-pack parachute
  for (const s of [-1, 1]) put('metal', rod(P(s * 0.2, 0.0, 0.28), P(s * 0.2, 0.28, 0.2), 0.015, 6), STEEL);
  put('metal', new THREE.BoxGeometry(0.42, 0.6, 0.014).rotateX(0.08).translate(0, 0.92, 0.2), 0x55595c); // the armour plate
  put('fit', new RoundedBoxGeometry(0.2, 0.13, 0.06, 2, 0.02).translate(0, 1.1, 0.16), LEATHER); // the headrest
  for (const s of [-1, 1]) {
    put('fit', rod(P(s * 0.1, 0.9, 0.16), P(s * 0.12, 0.85, -0.05), 0.022, 4), KHAKI); // the shoulder straps over you
    put('fit', rod(P(s * 0.12, 0.85, -0.05), P(s * 0.08, 0.5, -0.12), 0.022, 4), KHAKI);
    put('fit', rod(P(s * 0.2, 0.36, 0.0), P(s * 0.05, 0.42, -0.14), 0.025, 4), KHAKI); // the lap belt
  }
  put('metal', new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14).rotateX(Math.PI / 2 - 0.3).translate(0, 0.45, -0.15), ALU); // the harness's buckle

  // ---- you: the chest of your jacket, your legs on the rudder pedals
  put('fit', new THREE.CapsuleGeometry(0.15, 0.18, 4, 12).scale(1.2, 1, 0.75).translate(0, 0.62, 0.02), 0x4a3424); // (the A-2 jacket)
  for (const s of [-1, 1]) {
    const hip = P(s * 0.11, 0.38, -0.02), knee = P(s * 0.15, 0.5, -0.5), heel = P(s * 0.16, 0.04, -0.86);
    put('fit', rod(hip, knee, 0.075, 12, 0.062), SUIT); put('fit', new THREE.SphereGeometry(0.066, 12, 8).translate(knee.x, knee.y, knee.z), SUIT);
    put('fit', rod(knee, heel, 0.058, 12, 0.05), SUIT);
    put('fit', new RoundedBoxGeometry(0.1, 0.09, 0.28, 2, 0.03).rotateX(0.5).translate(heel.x, heel.y + 0.0, heel.z - 0.06), 0x2a1d14); // the boot
    // the rudder pedal: its frame, the tread, the heel rest
    put('fit', new THREE.BoxGeometry(0.12, 0.2, 0.02).rotateX(0.5).translate(heel.x, heel.y + 0.02, heel.z - 0.13), BLACK);
    put('metal', rod(P(heel.x, -0.15, -0.95), P(heel.x, heel.y - 0.05, heel.z - 0.18), 0.012, 6), STEEL);
  }
  put('metal', rod(P(-0.3, -0.15, -0.95), P(0.3, -0.15, -0.95), 0.018, 8), STEEL); // the pedals' cross shaft

  // ---- the left side: the throttle quadrant (boost lever outboard, then the throttle, propeller and mixture),
  // the trim tab wheels (elevator, rudder, aileron), the landing gear and flap handles, the fuel selector
  const wallX = (z, y) => { // the inside of the fuselage's wall at z, y high
    const [hw, top, mid, bot] = fuse(z), n = 2.4, k = Math.min(1, Math.abs((y - mid) / (y > mid ? top - mid : mid - bot)));
    return hw * (1 - k ** n) ** (1 / n) * 0.96;
  };
  const QX = -wallX(-0.42, 0.6) + 0.1, QY = 0.6, QZ = -0.44;
  put('fit', new RoundedBoxGeometry(0.09, 0.07, 0.3, 2, 0.012).translate(QX, QY, QZ), BLACK); // the quadrant's box
  put('fit', new THREE.BoxGeometry(0.2, 0.02, 0.6).translate(QX - 0.05, QY - 0.045, -0.3), GREEN); // the shelf it's on
  for (let k = 0; k < 4; k++) put('metal', new THREE.BoxGeometry(0.005, 0.004, 0.22).translate(QX - 0.03 + k * 0.02, QY + 0.036, QZ), 0x222222); // the levers' slots
  const T = { x: QX - 0.012, y: QY + 0.035, z: QZ };
  const wheel = (x, y, z, r, hex = BLACK) => { put('fit', new THREE.TorusGeometry(r, r * 0.13, 8, 28).rotateY(Math.PI / 2).translate(x, y, z), hex); for (let k = 0; k < 3; k++) put('fit', new THREE.BoxGeometry(0.006, r * 2, r * 0.12).rotateX((k / 3) * Math.PI).translate(x, y, z), hex); put('fit', new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.02, 10).rotateZ(Math.PI / 2).translate(x, y, z), hex); };
  const LX = -wallX(0, 0.6) + 0.04;
  wheel(LX, 0.6, -0.08, 0.085); // the elevator's trim tab wheel, big, on the wall
  wheel(LX + 0.02, 0.66, 0.09, 0.05); // the rudder's
  put('fit', new THREE.CylinderGeometry(0.02, 0.022, 0.03, 12).rotateZ(Math.PI / 2).translate(LX + 0.06, 0.7, 0.2), BLACK); // the aileron's trim knob
  put('fit', new RoundedBoxGeometry(0.06, 0.1, 0.12, 2, 0.01).translate(LX + 0.01, 0.6, 0.09), GREEN); // their housing
  // the landing gear handle (its knob the shape of a wheel) and the flap handle (an aerofoil), forward on the left
  put('metal', rod(P(LX + 0.05, 0.52, -0.72), P(LX + 0.09, 0.62, -0.66), 0.008), STEEL);
  put('fit', new THREE.CylinderGeometry(0.028, 0.028, 0.016, 16).rotateZ(Math.PI / 2).translate(LX + 0.09, 0.625, -0.66), BLACK);
  put('metal', rod(P(LX + 0.05, 0.5, -0.58), P(LX + 0.08, 0.6, -0.55), 0.007), STEEL);
  put('fit', new RoundedBoxGeometry(0.05, 0.016, 0.03, 2, 0.006).translate(LX + 0.08, 0.605, -0.55), BLACK);
  put('fit', new THREE.BoxGeometry(0.1, 0.12, 0.2).translate(LX + 0.03, 0.52, -0.64), GREEN); // their box
  put('fit', new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).translate(-0.24, 0.12, -0.6), 0x8a2016); // the fuel selector's red dial
  put('metal', new THREE.BoxGeometry(0.08, 0.012, 0.016).translate(-0.24, 0.135, -0.6), ALU);
  // ---- the right side: the radio's control box (four buttons, A to D, and OFF), the oxygen regulator, the switch
  // box, the cowl flap lever, the canopy's crank on the sill
  const RX = wallX(-0.3, 0.7) - 0.11;
  put('fit', new THREE.BoxGeometry(0.2, 0.02, 0.62).translate(RX + 0.04, 0.65, -0.3), GREEN); // the shelf
  put('fit', new RoundedBoxGeometry(0.11, 0.08, 0.18, 2, 0.01).translate(RX, 0.7, -0.34), BLACK); // the SCR-522's box
  for (let k = 0; k < 5; k++) put('fit', new THREE.BoxGeometry(0.011, 0.01, 0.014).translate(RX - 0.036 + k * 0.018, 0.744, -0.4), k === 0 ? 0x8a2016 : 0xb8b2a0); // (OFF, red; A, B, C, D)
  put('fit', new THREE.CylinderGeometry(0.005, 0.005, 0.01, 6).translate(RX + 0.03, 0.745, -0.3), 0x2a8a2a);
  put('fit', new THREE.CylinderGeometry(0.055, 0.055, 0.06, 18).rotateZ(Math.PI / 2).translate(RX + 0.06, 0.66, -0.66), 0x2a3022); // the A-12 oxygen regulator
  put('fit', new THREE.CylinderGeometry(0.042, 0.042, 0.004, 18).rotateZ(Math.PI / 2).translate(RX + 0.028, 0.66, -0.66), 0xcfc8b0);
  put('fit', new THREE.BoxGeometry(0.1, 0.06, 0.16).translate(RX, 0.69, -0.12), BLACK); // the switch box
  for (let k = 0; k < 6; k++) put('metal', rod(P(RX - 0.03 + (k % 3) * 0.03, 0.72, -0.16 + Math.floor(k / 3) * 0.06), P(RX - 0.03 + (k % 3) * 0.03, 0.75, -0.17 + Math.floor(k / 3) * 0.06), 0.004, 5), ALU);
  put('metal', rod(P(RX + 0.03, 0.62, 0.08), P(RX, 0.74, 0.05), 0.008), STEEL); put('fit', new THREE.SphereGeometry(0.018, 10, 8).translate(RX, 0.745, 0.05), BLACK); // the cowl flap lever
  { const cx = wallX(-0.1, 0.78) - 0.06; put('fit', new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateZ(Math.PI / 2).translate(cx, 0.74, 0.02), BLACK); put('metal', rod(P(cx - 0.02, 0.74, 0.02), P(cx - 0.02, 0.69, 0.05), 0.006), STEEL); put('fit', new THREE.CylinderGeometry(0.012, 0.012, 0.04, 8).rotateZ(Math.PI / 2).translate(cx - 0.04, 0.69, 0.05), BLACK); } // the canopy crank
  put('fit', new THREE.BoxGeometry(0.03, 0.2, 0.32).translate(wallX(0.1, 0.6) - 0.03, 0.55, 0.15), 0x4b4232); // the map case

  // ---- the instrument panel: one textured face, the dials' bezels and glasses standing out of it, the coaming
  // over it, the N-3B sight on top
  const pg = new THREE.Group();
  pg.position.fromArray(PANEL_AT); pg.rotation.x = PANEL_TILT;
  root.add(pg);
  pg.updateMatrix();
  const pm = pg.matrix;
  const art = panelArt(), faceTex = new THREE.CanvasTexture(art);
  faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 8;
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, emissiveMap: faceTex, emissive: 0x000000, roughness: 0.62, metalness: 0.1 });
  // the panel's outline: square below, its top corners cut away under the sills
  const outline = [[-PW / 2, -PH / 2], [PW / 2, -PH / 2], [PW / 2, 0.06], [0.33, PH / 2], [-0.33, PH / 2], [-PW / 2, 0.06]];
  const faceGeo = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))));
  { const p = faceGeo.attributes.position, uv = faceGeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / PW + 0.5, p.getY(i) / PH + 0.5); }
  const face = new THREE.Mesh(faceGeo, faceMat);
  pg.add(face);
  const back = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x * 1.02, y * 1.04))), { depth: 0.05, bevelEnabled: false }).translate(0, 0, -0.052);
  parts.fit.push(boxUV(paintGeo(back.applyMatrix4(pm), BLACK, false)));
  // the bezels round each dial, their screws standing out; the glass over each
  const glassGeo = [];
  for (const [, x, y, r] of DIALS) {
    parts.fit.push(boxUV(paintGeo(new THREE.TorusGeometry(r * 1.06, 0.0035, 6, 36).scale(1, 1, 2.2).translate(x, y, 0.004).applyMatrix4(pm), 0x1c1c1c, false)));
    glassGeo.push(new THREE.CircleGeometry(r * 1.04, 32).translate(x, y, 0.009));
  }
  { const [x, y, w, h] = COMPASS; parts.fit.push(boxUV(paintGeo(new RoundedBoxGeometry(w + 0.012, h + 0.012, 0.035, 2, 0.004).translate(x, y, 0.012).applyMatrix4(pm), 0x1a1a1a, false))); }
  // the switches along the bottom: toggles, the ignition's rotary switch, the primer's knob
  for (let i = 0; i < 6; i++) { const x = -0.1 + i * 0.045; parts.fit.push(boxUV(paintGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10).rotateX(Math.PI / 2).translate(x, -0.15, 0.006).applyMatrix4(pm), 0x333333, false))); parts.metal.push(boxUV(paintGeo(rod(P(x, -0.15, 0.01), P(x, -0.142, 0.038), 0.0035, 6).applyMatrix4(pm), ALU, false))); }
  parts.fit.push(boxUV(paintGeo(new THREE.CylinderGeometry(0.022, 0.024, 0.025, 18).rotateX(Math.PI / 2).translate(-0.33, -0.14, 0.012).applyMatrix4(pm), 0x1a1a1a, false)));
  parts.fit.push(boxUV(paintGeo(new THREE.BoxGeometry(0.008, 0.032, 0.012).rotateZ(-0.8).translate(-0.33, -0.14, 0.03).applyMatrix4(pm), 0x2a2a2a, false)));
  for (const [x, y] of [[-0.06, 0.12], [0.06, 0.12]]) parts.fit.push(boxUV(paintGeo(new THREE.CylinderGeometry(0.008, 0.009, 0.018, 12).rotateX(Math.PI / 2).translate(x + 0.03, y - 0.034, 0.012).applyMatrix4(pm), 0x222222, false))); // the gyros' knobs
  for (const s of [-1, 1]) parts.fit.push(boxUV(paintGeo(new THREE.SphereGeometry(0.008, 10, 6).translate(-0.235 + s * 0.012, 0.13, 0.004).applyMatrix4(pm), 0x2a3a2a, false))); // the gear's lamps (dark: wheels up)
  const coverMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e6ec, transparent: true, opacity: 0.08, roughness: 0.04, metalness: 0, depthWrite: false, clearcoat: 1 });
  const covers = new THREE.Mesh(mergeGeometries(glassGeo), coverMat);
  covers.renderOrder = 1;
  pg.add(covers);
  // the coaming: a padded black hood over the panel from its top edge forward to the windscreen's foot
  {
    const rows = [];
    for (const [z, k] of [[-0.735, 1.0], [-0.79, 0.98], [-0.86, 0.94]]) { const row = []; for (let j = 0; j <= 20; j++) { const x = -0.36 + (j / 20) * 0.72; row.push(P(x * k, 0.81 + 0.035 * (1 - (x / 0.36) ** 2) + (z + 0.735) * 0.25, z)); } rows.push(row); }
    const pos = [];
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < 20; j++) { const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1]; pos.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...b.toArray(), ...d.toArray(), ...c.toArray()); }
    const hood = new THREE.BufferGeometry(); hood.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hood.computeVertexNormals();
    put('fit', hood, 0x161616, false);
    const lip = []; for (let j = 0; j <= 20; j++) { const x = -0.36 + (j / 20) * 0.72; lip.push(P(x, 0.8 + 0.035 * (1 - (x / 0.36) ** 2), -0.73)); }
    for (let j = 0; j < 20; j++) put('fit', rod(lip[j], lip[j + 1], 0.016, 8), 0x231a12, false); // its leather roll
  }
  // the N-3B reflector sight: its body on a bracket on the coaming, the lamp housing below and behind, the
  // dimmer's knob, the reflector glass on your eye line, the sun filter folded down ahead of it, the crash pad
  // (its body sits on the coaming, the glass rising out of its top to your eye line; the lamp housing reaches
  // forward under the windscreen)
  const SY = 0.925, SZ = -0.68;
  put('fit', new RoundedBoxGeometry(0.068, 0.075, 0.12, 2, 0.01).translate(0, SY, SZ), 0x161616, false);
  put('fit', new THREE.CylinderGeometry(0.026, 0.026, 0.1, 16).rotateX(Math.PI / 2).translate(0, SY - 0.01, SZ - 0.1), 0x161616, false);
  put('fit', new THREE.BoxGeometry(0.05, 0.08, 0.09).translate(0, SY - 0.07, SZ - 0.01), 0x222222, false); // the bracket
  put('metal', new THREE.CylinderGeometry(0.011, 0.011, 0.018, 12).rotateZ(Math.PI / 2).translate(-0.043, SY + 0.012, SZ + 0.01), ALU, false); // the dimmer
  put('fit', new THREE.CylinderGeometry(0.016, 0.016, 0.01, 16).rotateZ(Math.PI / 2).translate(0.04, SY - 0.01, SZ), BLACK, false);
  for (const s of [-1, 1]) put('fit', new THREE.BoxGeometry(0.005, 0.03, 0.03).translate(s * 0.045, SY + 0.05, SZ - 0.02), 0x161616, false); // the glass's clamps
  put('fit', new THREE.BoxGeometry(0.095, 0.007, 0.03).translate(0, SY + 0.04, SZ - 0.02), 0x161616, false);
  const reflector = new THREE.Mesh(new THREE.PlaneGeometry(0.088, 0.15), new THREE.MeshPhysicalMaterial({ color: 0xa8c8cc, transparent: true, opacity: 0.16, roughness: 0.02, depthWrite: false, side: THREE.DoubleSide }));
  reflector.position.set(0, 1.035, SZ - 0.05); reflector.rotation.x = -0.72; reflector.renderOrder = 2;
  root.add(reflector);
  reflector.add(new THREE.Mesh(mergeGeometries([-1, 1].map((x) => paintGeo(new THREE.BoxGeometry(0.003, 0.15, 0.006).translate(x * 0.0445, 0, 0), 0x2a3a3c, false))), fit)); // (its edges, catching the light)
  const filter = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.05), new THREE.MeshPhysicalMaterial({ color: 0x6a5a30, transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  filter.position.set(0, SY + 0.05, SZ - 0.075); filter.rotation.x = -1.45; filter.renderOrder = 2; // (the sun filter, folded down ahead of it)
  root.add(filter);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.066, 0.036, 0.026, 3, 0.01), new THREE.MeshStandardMaterial({ color: 0xffffff, map: padTex(), roughness: 0.9 }));
  pad.position.set(0, SY + 0.03, SZ + 0.065); pad.rotation.x = -0.5;
  root.add(pad);

  // ---- the moving needles: three instanced meshes (needles, bars, dots) on the panel
  const needleShape = new THREE.Shape([[-0.06, -0.2], [0.06, -0.2], [0.05, 0], [0.018, 0.82], [0, 1], [-0.018, 0.82], [-0.05, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
  const handMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0x000000 });
  const hands = [], bars = [], dots = [];
  // a needle on dial id: value(s) -> angle (deg, clockwise from 12), its length and width (fractions of r), colour, its centre's offset
  const D = Object.fromEntries(DIALS.map(([id, x, y, r]) => [id, { x, y, r }]));
  const needle = (id, fn, len = 0.82, w = 0.85, col = 0xece7d6, ox = 0, oy = 0) => hands.push({ ...D[id], fn, len, w, col, ox, oy });
  const IAS = (s) => s.speed * 2.237 * Math.exp(-s.alt / 17000); // mph indicated (the thin air up here)
  needle('clock', (s) => (s.clockH % 12) * 30 + s.clockM * 0.5, 0.5, 1.3);
  needle('clock', (s) => s.clockM * 6, 0.78, 1.0);
  needle('clock', (s) => s.clockS * 6, 0.86, 0.5, 0xc03020);
  needle('accel', (s) => MAP.accel(s.g), 0.8, 0.9);
  needle('accel', (s) => MAP.accel(s.gMax), 0.72, 0.6, 0xb0a890);
  needle('accel', (s) => MAP.accel(s.gMin), 0.72, 0.6, 0xb0a890);
  needle('suction', (s) => MAP.suction(s.damage ? 2.6 : 4.0), 0.8);
  needle('speed', (s) => MAP.speed(IAS(s)), 0.84);
  needle('alt', (s) => (s.ft % 1000) / 1000 * 360, 0.86, 0.75); // hundreds
  needle('alt', (s) => (s.ft % 10000) / 10000 * 360, 0.55, 1.4); // thousands
  needle('alt', (s) => (s.ft % 100000) / 100000 * 360, 0.92, 0.35, 0xb0a890); // ten thousands
  needle('turn', (s) => clamp(s.turnRate / (3 * DEG) * 20, -40, 40), 0.8, 0.9, 0xece7d6, 0, -0.42);
  needle('climb', (s) => MAP.climb(s.climb * 196.85 / 1000), 0.84);
  needle('turbo', (s) => MAP.turbo(s.turbo), 0.82);
  needle('boost', (s) => MAP.boost(s.mp), 0.84);
  needle('rpm', (s) => MAP.rpm(s.rpm / 100), 0.84);
  needle('engine', (s) => -110 + clamp(s.fuelP / 25, 0, 1) * 220, 0.36, 0.5, 0xece7d6, -0.42, 0.3);
  needle('engine', (s) => -110 + clamp(s.oilP / 200, 0, 1) * 220, 0.36, 0.5, 0xece7d6, 0.42, 0.3);
  needle('engine', (s) => -110 + clamp(s.oilT / 100, 0, 1) * 220, 0.36, 0.5, 0xece7d6, 0, -0.38);
  needle('carb', (s) => MAP.carb(s.carbT), 0.8);
  needle('cht', (s) => MAP.cht(s.cht), 0.8);
  needle('fuel', (s) => MAP.fuel(s.fuel), 0.82);
  needle('hyd', (s) => MAP.hyd(s.damage ? 700 : 1000), 0.8);
  needle('oxy', (s) => MAP.oxy(s.oxy), 0.8);
  // bars: [x, y, w, h, colour, fn(s) -> [dx, dy, angle(deg)]] (in metres on the panel)
  const H = D.horizon;
  bars.push({ x: H.x, y: H.y, w: H.r * 1.3, h: 0.0028, col: 0xece7d6, fn: (s) => { const p = clamp(s.pitch, -0.5, 0.5) * H.r * 1.1; return [Math.sin(s.bank) * p, -Math.cos(s.bank) * p, s.bank / DEG]; } }); // the horizon bar
  bars.push({ x: H.x, y: H.y, w: 0.004, h: 0.009, col: 0xe08a30, fn: (s) => { const a = clamp(s.bank, -1.6, 1.6); return [Math.sin(a) * H.r * 0.74, Math.cos(a) * H.r * 0.74, -a / DEG]; } }); // the sky pointer
  bars.push({ x: H.x, y: H.y, w: H.r * 0.9, h: 0.003, col: 0xe08a30, fn: () => [0, 0, 0] }); // the little aeroplane, fixed
  bars.push({ x: H.x, y: H.y + 0.004, w: 0.004, h: 0.008, col: 0xe08a30, fn: () => [0, 0, 0] });
  bars.push({ x: D.dg.x, y: D.dg.y + 0.0, w: 0.0018, h: 0.022, col: 0xe08a30, fn: () => [0, 0, 0] }); // the gyro's lubber line
  bars.push({ x: COMPASS[0], y: COMPASS[1] + 0.003, w: 0.0016, h: 0.022, col: 0xe08a30, fn: () => [0, 0, 0] }); // the compass's
  bars.push({ x: D.oxy.x + 0.034, y: D.oxy.y - 0.02, w: 0.012, h: 0.012, col: 0x1a1a1a, fn: (s) => [0, 0, Math.floor(s.time / 2) % 2 ? 0 : 45] }); // the oxygen blinker, opening and shutting with your breathing
  dots.push({ x: D.turn.x, y: D.turn.y - D.turn.r * 0.5, r: 0.0042, col: 0x101010, fn: (s) => [clamp(s.slip, -1, 1) * D.turn.r * 0.48, -Math.abs(clamp(s.slip, -1, 1)) * 0.002] }); // the ball
  const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, handMat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; pg.add(m); return m; };
  const handMesh = mk(new THREE.ShapeGeometry(needleShape), hands.length), barMesh = mk(new THREE.PlaneGeometry(1, 1), bars.length), dotMesh = mk(new THREE.CircleGeometry(1, 16), dots.length);
  const _c = new THREE.Color();
  hands.forEach((h, i) => handMesh.setColorAt(i, _c.set(h.col))); bars.forEach((b, i) => barMesh.setColorAt(i, _c.set(b.col))); dots.forEach((d, i) => dotMesh.setColorAt(i, _c.set(d.col)));
  // the cards: the directional gyro's and the compass's, turning behind their windows
  const cardDG = cardTex(), cardC = cardTex('#d4ccb2', '#121212');
  cardDG.repeat.x = cardC.repeat.x = 50 / 360;
  const card = (tex, x, y, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x000000, roughness: 0.6 })); m.position.set(x, y, 0.0015); pg.add(m); return m; };
  const dgCard = card(cardDG, D.dg.x, D.dg.y - 0.0045, D.dg.r * 1.3, D.dg.r * 0.5), cCard = card(cardC, COMPASS[0], COMPASS[1] + 0.002, COMPASS[2] * 0.76, COMPASS[3] * 0.5);

  // ---- the stick, pivoting at the floor, your right hand on its grip; the throttle quadrant's levers, your left hand on the throttle
  const fitMesh = (list) => new THREE.Mesh(mergeGeometries(list), fit);
  const stick = new THREE.Group();
  stick.position.set(0, 0.0, -0.52);
  root.add(stick);
  stick.add(fitMesh([
    paintGeo(rod(P(0, 0, 0), P(0, 0.5, 0.02), 0.016, 10), ZINC), // the stick, zinc-chromate green
    paintGeo(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 14).translate(0, 0.05, 0), 0x2a2a24), // its boot
    paintGeo(new THREE.CylinderGeometry(0.022, 0.025, 0.13, 12).rotateX(0.15).translate(0, 0.58, 0.03), BLACK), // the grip
    paintGeo(new THREE.BoxGeometry(0.014, 0.03, 0.02).translate(0, 0.55, -0.005), 0x333333), // the trigger
    paintGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8).translate(0, 0.652, 0.035), 0x8a2016), // the bomb button on top
    ...handGeo().map((g) => paintGeo(g.rotateZ(-1.4).rotateX(-0.25).translate(0.025, 0.58, 0.04), LEATHER)),
  ]));
  // a lever on the quadrant: pivot at (x, y, z), length, knob; returned so it can be moved
  const lever = (x, len, knob, hex) => {
    const g = new THREE.Group(); g.position.set(x, T.y, T.z); root.add(g);
    g.add(fitMesh([paintGeo(new THREE.BoxGeometry(0.008, len, 0.012).translate(0, len / 2, 0), 0x2a2a2a), paintGeo(knob.translate(0, len, 0), hex)]));
    return g;
  };
  const boostL = lever(T.x - 0.03, 0.12, new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10).rotateZ(Math.PI / 2), BLACK);
  const throttleL = lever(T.x - 0.01, 0.15, new THREE.CylinderGeometry(0.024, 0.026, 0.07, 12).rotateZ(Math.PI / 2).translate(0.025, 0, 0), BLACK);
  const propL = lever(T.x + 0.01, 0.12, new THREE.SphereGeometry(0.016, 10, 8).scale(1, 0.8, 1.3), 0x1c2a4a);
  const mixL = lever(T.x + 0.03, 0.11, new THREE.SphereGeometry(0.016, 10, 8), 0x8a2016);
  propL.rotation.x = -0.45; mixL.rotation.x = -0.3;
  throttleL.add(fitMesh(handGeo().map((g) => paintGeo(g.rotateZ(1.3).rotateY(-0.3).translate(0.03, 0.15, 0.02), LEATHER))));
  // your forearms, from the elbows to the wrists on the grips (placed every frame), the sleeves of the flying suit
  const arm = () => { const m = new THREE.Mesh(paintGeo(new THREE.CylinderGeometry(0.042, 0.05, 1, 12).translate(0, 0.5, 0), SUIT), fit); root.add(m); return m; };
  const arms = [{ m: arm(), elbow: P(-0.3, 0.6, -0.06), hand: throttleL, at: P(0.03, 0.15, 0.06) }, { m: arm(), elbow: P(0.24, 0.56, -0.08), hand: stick, at: P(0.03, 0.56, 0.08) }];

  // ---- the canopy round you: the glass (wet in the rain), the armoured windscreen's thick slab; the mirror's glass
  const glass = wetGlass(new THREE.MeshPhysicalMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.05, roughness: 0.03, depthWrite: false, side: THREE.DoubleSide }));
  const glassMesh = new THREE.Mesh(canopyGlass(), glass);
  glassMesh.renderOrder = 2;
  root.add(glassMesh);
  {
    const ws = windscreen(), c = ws.fbl.clone().add(ws.fbr).add(ws.ftl).add(ws.ftr).multiplyScalar(0.25);
    const up = ws.ftl.clone().sub(ws.fbl), m = new THREE.Matrix4().makeRotationX(-Math.atan2(up.z, up.y)).setPosition(c.x, c.y, c.z + 0.025);
    const edge = new THREE.MeshPhysicalMaterial({ color: 0x4d6b5c, transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false });
    const w = 0.33, h = up.length(), d = 0.04, eg = [];
    for (const s of [-1, 1]) { eg.push(new THREE.BoxGeometry(w, 0.005, d).translate(0, s * (h / 2 - 0.0025), 0)); eg.push(new THREE.BoxGeometry(0.005, h, d).translate(s * (w / 2 - 0.0025), 0, 0)); }
    const slab = new THREE.Mesh(mergeGeometries(eg).applyMatrix4(m), edge); slab.renderOrder = 2;
    root.add(slab);
    const back2 = new THREE.Mesh(new THREE.PlaneGeometry(w, h).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, d / 2)).applyMatrix4(m), glass); back2.renderOrder = 2;
    root.add(back2);
  }
  put('metal', new THREE.BoxGeometry(0.095, 0.022, 0.004).rotateX(0.25).translate(0, 1.31, -0.575), 0x5a666c, false); // the mirror's glass, facing you
  // the frames as you see them from the seat: slim box sections, edge on to your eye (rods this close fill the view)
  const eye = P(0, 1.05, -0.2);
  for (const [a, b, k] of canopyFrameSegments()) {
    const mid = a.clone().add(b).multiplyScalar(0.5), z = b.clone().sub(a), len = z.length(); z.normalize();
    const toEye = eye.clone().sub(mid).normalize(), x = new V3().crossVectors(toEye, z).normalize(), y = new V3().crossVectors(z, x);
    const geo = new THREE.BoxGeometry(0.011 * k + 0.003, 0.026 * k, len + 0.012).applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(mid.addScaledVector(y, 0.006)));
    put('fit', geo, 0x4a4a34, false);
  }

  // ---- merge the static parts: one mesh per material
  for (const [k, mat] of [['fit', fit], ['metal', metal]]) root.add(new THREE.Mesh(mergeGeometries(parts[k]), mat));
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  // ---- what moves
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new V3(), _s = new V3(), _z = new V3(0, 0, 1), _y = new V3(0, 1, 0);
  const st = { gMax: 1, gMin: 1, g: 1, heading: null, turnRate: 0, slip: 0, bankWas: 0 };
  root.userData.update = (s, dt) => {
    // what the instruments read, from the flight: time of day (the bombers crossed the coast about 13:00), turn rate
    // from the heading, g from the turn, the engine's figures from the throttle and the height
    if (dt > 0) {
      let dh = st.heading === null ? 0 : s.heading - st.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      st.turnRate += (dh / dt - st.turnRate) * (1 - Math.exp(-dt * 3));
      const g = 1 / Math.max(0.3, Math.cos(clamp(s.bank, -1.3, 1.3))) + (Math.random() - 0.5) * 0.04;
      st.g += (g - st.g) * (1 - Math.exp(-dt * 4));
      st.slip += ((s.bank - st.bankWas) / dt * 0.15 - st.slip) * (1 - Math.exp(-dt * 2.5));
      st.bankWas = s.bank;
    }
    st.heading = s.heading;
    st.gMax = Math.max(st.gMax, st.g); st.gMin = Math.min(st.gMin, st.g);
    const clock = 13 * 3600 + 5 * 60 + s.time, thr = s.throttle, hot = s.damage ? 1 : 0;
    const v = Object.assign(st, s, {
      clockH: Math.floor(clock / 3600), clockM: (clock / 60) % 60, clockS: Math.floor(clock % 60), ft: Math.max(0, s.alt * 3.281),
      mp: 24 + thr * 28 - hot * 4, rpm: 2050 + thr * 650, turbo: (9 + thr * 12) * clamp(0.6 + s.alt / 20000, 0.6, 1),
      fuelP: hot ? 12 : 17, oilP: hot ? 30 + Math.random() * 15 : 75, oilT: 68 + thr * 12 + hot * 25 + s.heat * 3, carbT: 12 + thr * 14,
      cht: 195 + thr * 40 + hot * 70, fuel: Math.max(0, 205 - s.time * 0.035), oxy: Math.max(0, 410 - s.time * 0.05),
    });
    hands.forEach((h, i) => {
      const a = h.fn(v) * DEG;
      _m.compose(_p.set(h.x + h.ox * h.r, h.y + h.oy * h.r, 0.004 + i * 0.00002), _q.setFromAxisAngle(_z, -a), _s.set(h.r * h.w * 0.1 * 6, h.r * h.len, 1));
      handMesh.setMatrixAt(i, _m);
    });
    bars.forEach((b, i) => {
      const [dx, dy, a] = b.fn(v);
      _m.compose(_p.set(b.x + dx, b.y + dy, 0.0045 + i * 0.0002), _q.setFromAxisAngle(_z, -a * DEG), _s.set(b.w, b.h, 1));
      barMesh.setMatrixAt(i, _m);
    });
    dots.forEach((d, i) => { const [dx, dy] = d.fn(v); _m.compose(_p.set(d.x + dx, d.y + dy, 0.006), _q.identity(), _s.set(d.r, d.r, 1)); dotMesh.setMatrixAt(i, _m); });
    handMesh.instanceMatrix.needsUpdate = barMesh.instanceMatrix.needsUpdate = dotMesh.instanceMatrix.needsUpdate = true;
    const hdg = ((s.heading / DEG) % 360 + 360) % 360;
    cardDG.offset.x = (hdg - 25) / 360; cardC.offset.x = (hdg - 25 + Math.sin(s.time * 0.7) * 2) / 360; // (the compass swings a little)
    // the stick: back to pull up, over to roll; the quadrant: the boost lever hooked to the throttle
    stick.rotation.x = clamp(-s.stickY, -1, 1) * 0.2;
    stick.rotation.z = clamp(-s.stickX, -1, 1) * 0.22;
    throttleL.rotation.x = 0.55 - thr * 1.1;
    boostL.rotation.x = 0.55 - thr * 1.05;
    for (const a of arms) { // each forearm from its elbow to the wrist, wherever the hand has gone
      a.hand.updateMatrix(); _p.copy(a.at).applyMatrix4(a.hand.matrix);
      _s.subVectors(_p, a.elbow); const len = _s.length();
      a.m.position.copy(a.elbow); a.m.quaternion.setFromUnitVectors(_y, _s.divideScalar(len)); a.m.scale.set(1, len, 1);
    }
    hub.visible = true;
  };
  root.userData.night = (k) => { // the panel's fluorescent markings under the cockpit's ultraviolet lamps
    const e = new THREE.Color(0.55, 1.0, 0.62).multiplyScalar(k * 4);
    faceMat.emissive.copy(e); handMat.emissive.copy(e).multiplyScalar(0.8);
    dgCard.material.emissive.copy(e).multiplyScalar(0.7); cCard.material.emissive.copy(e).multiplyScalar(0.25);
  };
  return root;
}
