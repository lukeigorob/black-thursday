// The B-17G's flight deck, built to the Pilot Training Manual's drawings and photographs of the
// surviving aircraft:
// - the main instrument panel in its three shock-mounted sections (the pilot's flight instruments, the
//   engine instruments in the middle, the co-pilot's side), each instrument drawn to the real face
//   (b17gauges.js) in a raised black bezel with four screws, under its own glass; the needles that
//   matter move (airspeed, altitude, climb, the gyro horizon's card, the directional gyro, turn and
//   bank, manifold pressure and rpm), and the figures glow by night;
// - the switch rows along the bottom (ignition, starters, boost pumps), the four red feathering
//   buttons, the warning lights, the glare shield's padded lip with the bombardier's call light, the
//   pilot's direction indicator and the standby compass on the centre post;
// - the control columns with their canvas boots, the B-17's half wheels (the cross-bar through the
//   hub with the AAF emblem, the rim below, upright black grips at its ends), the rudder pedals;
// - the centre pedestal: the throttles (the inboard pair's bar, the outboard pair's knobs), propeller
//   and mixture levers, the turbo-supercharger boost dial, the tubular frame over the quadrant, the
//   C-1 autopilot's control panel low on its back, the trim tab wheels on its sides;
// - the seats on their rails, in olive drab with leather cushions, belts and the armour behind them;
// - the pilot's and co-pilot's side panels, quilted padding on the walls and roof, the frames round
//   the windscreen and side windows, oxygen regulators and interphone boxes.
// Everything that doesn't move is merged per material (it.add); the needles are a handful of meshes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { drawFace, dialAngle } from './b17gauges.js';

/** (The radio sets' meters, stations.js: the older names for the faces.) */
export function drawGauge(g, cx, cy, r, kind, label) {
  drawFace(g, cx, cy, r, { pressure: 'hydraulic', temp: 'freeair', gyro: 'radiocompass' }[kind] ?? kind, { label });
}

const V = THREE.Vector3;
const F = -0.40; // the flight deck's floor
// The panel is laid out from the B-17G maintenance manual's photograph of it (and the Pilot Training
// Manual's key): every position below is in that photograph's pixels (1930 x 749), scaled to the
// aircraft: S metres a pixel, its bottom edge at Y0.
const S = 0.00082, PX0 = 20, PY1 = 630, PY0 = 80, Y0 = 0.17;
const pm = (px, py) => [-0.77 + (px - PX0) * S, Y0 + (PY1 - py) * S]; // photograph px -> bomber x, y
export const PANEL = { x0: -0.77, x1: -0.77 + 1880 * S, y0: Y0, y1: Y0 + (PY1 - PY0) * S, z: -8.5 };
const W = 4096, K = W / 1880, H = Math.round((PY1 - PY0) * K); // texture px (K texture px per photograph px)
// its outline: straight along the bottom, up the pilot's end, the long diagonal and the shallow arch over
// the middle, the co-pilot's angled panel stepping down at the far right
const OUTLINE = [[20, 630], [20, 410], [80, 330], [200, 240], [350, 170], [500, 125], [620, 100], [800, 88], [1140, 80], [1400, 92], [1570, 100], [1580, 190], [1740, 215], [1900, 430], [1900, 630]];
const SEAMS = [610, 1140, 1578]; // the joints between the pilot's section, the centre (flight), the engine section and the co-pilot's panel
const FACE_DZ = 0.008; // (the instruments' faces stand this far out of the panel's plane, in their bezels)

/*
 * The instruments: [px, py, radius px, kind, label, live?, extra]. 3 1/8 in. dials are r 45-50 px, 2 1/4 in. ~33.
 */
const GAUGES = [
  // ---- the pilot's section: radio compass, flux gate compass, the P.D.I.; voltmeter, hydraulic pressure,
  // suction; along the bottom both pilots' oxygen blinkers and pressure gauges
  [250, 320, 45, 'radiocompass', 'RADIO COMPASS'], [425, 255, 45, 'compass', 'FLUX GATE COMPASS'], [530, 250, 42, 'pdi', "PILOT'S DIRECTION", 'pdi'],
  [232, 445, 32, 'volts', 'A.C. VOLTMETER'], [405, 450, 33, 'hydraulic', 'HYD. PRESS. MAIN'], [490, 450, 33, 'suction', 'SUCTION'],
  [255, 540, 33, 'blinker', "PILOT'S OXYGEN"], [360, 540, 33, 'oxygen', 'PRESSURE'], [465, 540, 33, 'blinker', "CO-PILOT'S OXYGEN"], [560, 540, 33, 'oxygen', 'PRESSURE'],
  // ---- the centre (flight) section: the directional gyro and the flight indicator above; altimeter,
  // airspeed, turn and bank, rate of climb in a row; the feathering buttons under them
  [830, 185, 42, 'gyro', 'DIRECTIONAL GYRO', 'dg'], [970, 195, 54, 'horizon', 'FLIGHT INDICATOR', 'horizon'],
  [690, 330, 46, 'altimeter', 'ALTIMETER', 'alt'], [800, 335, 46, 'airspeed', 'AIR SPEED', 'ias'], [905, 335, 46, 'turn', 'TURN & BANK', 'turn'], [1005, 335, 46, 'climb', 'RATE OF CLIMB', 'climb'],
  // ---- the engine section: manifold pressure over the tachometers (left engines', right engines'), the
  // flap indicator; fuel pressure, oil pressure and oil temperature in pairs; cylinder-head and carburettor air
  // temperatures along the bottom; free air temperature and the fuel gauge at the right
  [1095, 190, 43, 'manifold', 'MANIFOLD PRESS.', 'man12', { pair: '1   2', side: 'LEFT ENGINES' }], [1180, 190, 43, 'manifold', 'MANIFOLD PRESS.', 'man34', { pair: '3   4', side: 'RIGHT ENGINES' }],
  [1095, 300, 43, 'tach', 'TACHOMETER', 'rpm12', { pair: '1   2', side: 'LEFT ENGINES' }], [1180, 300, 43, 'tach', 'TACHOMETER', 'rpm34', { pair: '3   4', side: 'RIGHT ENGINES' }],
  [1180, 410, 42, 'flaps', 'FLAP POSITION'],
  [1270, 205, 45, 'dual', 'FUEL PRESS.', null, { what: 'fuel', side: 'LEFT ENGINES' }], [1385, 205, 45, 'dual', 'FUEL PRESS.', null, { what: 'fuel', side: 'RIGHT ENGINES' }],
  [1275, 320, 45, 'dual', 'OIL PRESS.', null, { what: 'oil', side: 'LEFT ENGINES' }], [1385, 320, 45, 'dual', 'OIL PRESS.', null, { what: 'oil', side: 'RIGHT ENGINES' }],
  [1275, 425, 45, 'butterfly', 'OIL TEMP.', null, { what: 'OIL °C', pair: '1-2' }], [1385, 425, 45, 'butterfly', 'OIL TEMP.', null, { what: 'OIL °C', pair: '3-4' }],
  [1180, 525, 45, 'butterfly', 'CYL. TEMP.', null, { what: 'CYL °C', pair: '1-2' }], [1280, 525, 45, 'butterfly', 'CYL. TEMP.', null, { what: 'CYL °C', pair: '3-4' }],
  [1390, 525, 45, 'butterfly', 'CARB. AIR', null, { what: 'CARB °C', pair: '1-2' }], [1500, 525, 45, 'butterfly', 'CARB. AIR', null, { what: 'CARB °C', pair: '3-4' }],
  [1500, 235, 33, 'freeair', 'AIR TEMP.'],
];
// warning lights: [px, py, colour, label]
const LIGHTS = [
  [362, 325, '#c4281c', 'HYD. PRESS. WARN'], [458, 325, '#c9a227', 'BOMB DOORS'], [405, 375, '#c9a227', 'BOMB RELEASE'], [490, 375, '#c4281c', 'VACUUM WARN'],
  [308, 555, '#c9a227', 'SUPPLY'], [510, 555, '#c9a227', 'SUPPLY'],
  [735, 272, '#dfe6f0', 'BEACON'], [1012, 413, '#2f8a3a', 'GEAR DOWN'], [1048, 413, '#c9a227', 'TAIL WHEEL'], [1082, 410, '#c4281c', 'BOMBER CALL'],
];
// knobs (the instruments' setting knobs, the panel lights' rheostats): [px, py, radius px]
const KNOBS = [[383, 292, 11], [1030, 245, 13], [655, 372, 10], [830, 240, 11], [150, 445, 24], [150, 525, 24], [1120, 405, 9]];
// the feathering buttons: two and two under the flight instruments
const FEATHER = [[682, 410], [737, 410], [855, 410], [907, 410]];
// placards: [px, py, w, h, lines, dark?]
const PLACARDS = [
  [150, 397, 130, 44, ['Boeing', 'FLYING FORTRESS'], true], [118, 598, 190, 58, ['WARNING', 'THE INDICATED DIVING SPEED WITH NORMAL LOADS', 'AND FLAPS UP SHALL NOT EXCEED 305 M.P.H.', 'DO NOT FLY THE AIRPLANE WITH ANY OF THE INTERNAL', 'BOMB RACKS REMOVED'], true],
  [578, 437, 44, 70, ['AIRSPEED', 'TUBE', 'STATIC', 'PRESSURE', 'SELECTOR', 'VALVE'], true], [700, 195, 100, 84, ['CUTOUT FOR', 'VISUAL INDICATOR', 'BLIND LANDING EQUIP.'], true],
  [1068, 130, 70, 58, ['WARNING', 'THE FOLLOWING', 'INSTRUMENTS ARE', 'NOT TO BE USED', 'FOR NAVIGATION'], true],
  [1660, 450, 140, 72, ['CARBURETOR', 'AIR CLEANER', 'FILTER "OFF" FOR', 'TAKE-OFF AND LANDING'], true], [1640, 585, 120, 100, ['FUEL TRANSFER VALVES', 'OPEN WHEN TANKS TO', 'BE PUMPED ARE', 'SELECTED', 'MUST BE CLOSED', 'EXCEPT WHEN', 'TRANSFERRING'], true],
  [1500, 470, 120, 22, ['SERVICE THIS AIRPLANE WITH 100 OCTANE FUEL ONLY'], true], [1680, 300, 60, 120, ['ENG 1', 'ENG 2', 'ENG 3', 'ENG 4', 'OIL', 'DILUTE'], true],
  [1810, 470, 120, 36, ['ENGINE', 'STARTERS'], true], [1815, 565, 140, 84, ['FIRE EXTINGUISHER', 'SELECT ENGINE · PULL'], true],
];
// toggles: [px, py, guarded?]
const TOGGLES = [[1655, 250], [1655, 285], [1655, 320], [1655, 355], [1600, 392], [1790, 395, true], [1840, 395, true], [1790, 430, true], [1840, 430, true]];

let seed = 17;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** The panel: colour (worn black paint, the faces, placards), its glow by night, and a height field for the normal map. */
function panelTextures() {
  seed = 17;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const h = document.createElement('canvas'); h.width = W / 2; h.height = H / 2;
  const hg = h.getContext('2d');
  for (const x of [g]) { x.setTransform(K, 0, 0, K, -PX0 * K, -PY0 * K); }
  for (const x of [hg]) { x.setTransform(K / 2, 0, 0, K / 2, -PX0 * K / 2, -PY0 * K / 2); }
  // dull black phenolic, a little worn: flecks, scuffs lighter where hands go, the edges rubbed
  g.fillStyle = '#1b1c1a'; g.fillRect(PX0, PY0, 1880, 550);
  g.fillStyle = g.createPattern(fleckTile(), 'repeat'); g.save(); g.scale(1 / K, 1 / K); g.fillRect(PX0 * K, PY0 * K, 1880 * K, 550 * K); g.restore();
  for (let i = 0; i < 40; i++) { const x = PX0 + rnd() * 1880, y = PY0 + 200 + rnd() * 350, gr = g.createRadialGradient(x, y, 0, x, y, 20 + rnd() * 40); gr.addColorStop(0, 'rgba(120,115,100,0.07)'); gr.addColorStop(1, 'rgba(120,115,100,0)'); g.fillStyle = gr; g.fillRect(x - 60, y - 60, 120, 120); }
  hg.fillStyle = '#808080'; hg.fillRect(PX0, PY0, 1880, 550);
  // the joints between the sections, and the screws round each
  for (const sx of SEAMS) {
    g.fillStyle = '#0a0a09'; g.fillRect(sx - 2, PY0, 4, 550);
    hg.fillStyle = '#303030'; hg.fillRect(sx - 2, PY0, 4, 550);
    for (let y = 150; y < 620; y += 70) for (const d of [-9, 9]) screw(g, hg, sx + d, y);
  }
  for (let x = 60; x < 1880; x += 85) screw(g, hg, x, 618);
  // the instruments' faces (the bezels and glass are geometry)
  for (const [px, py, r, kind, label, live, extra] of GAUGES) {
    drawFace(g, px, py, r, kind, { live: !!live, label, ...(extra ?? {}) });
    hg.fillStyle = '#404040'; hg.beginPath(); hg.arc(px, py, r * 1.04, 0, 7); hg.fill();
  }
  // the fuel quantity gauge: the tall oblong liquidometer, its sector scale at the top, the tank selector under it
  {
    const x = 1500, y = 380, w = 80, hh = 150;
    g.fillStyle = '#0e0e0d'; roundRect(g, x - w / 2, y - hh / 2, w, hh, 30); g.fill();
    g.strokeStyle = '#3c3c38'; g.lineWidth = 4; roundRect(g, x - w / 2, y - hh / 2, w, hh, 30); g.stroke();
    g.fillStyle = '#0a0a09'; roundRect(g, x - w / 2 + 8, y - hh / 2 + 10, w - 16, 60, 20); g.fill();
    for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 - 0.9 + k * 0.18; g.strokeStyle = '#ece6d2'; g.lineWidth = k % 5 ? 1 : 2; g.beginPath(); g.moveTo(x + Math.cos(a) * 26, y - 30 + Math.sin(a) * 26); g.lineTo(x + Math.cos(a) * 33, y - 30 + Math.sin(a) * 33); g.stroke(); }
    g.fillStyle = '#ece6d2'; g.font = 'bold 9px Arial'; g.textAlign = 'center'; g.fillText('FUEL QUANTITY', x, y + 4); g.fillText('U.S. GALS.', x, y + 15);
    g.fillStyle = '#ece6d2'; g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x + 26 * Math.cos(-Math.PI / 2 + 0.3), y - 30 + 26 * Math.sin(-Math.PI / 2 + 0.3)); g.lineWidth = 2.5; g.strokeStyle = '#ece6d2'; g.stroke();
    for (const [t, a] of [['1', -2.3], ['2', -1.9], ['3', -1.2], ['4', -0.8]]) g.fillText(t, x + Math.cos(a) * 24, y + 52 + Math.sin(a) * 24);
    hg.fillStyle = '#b0b0b0'; roundRect(hg, x - w / 2, y - hh / 2, w, hh, 30); hg.fill();
  }
  // the lights' legends, the placards
  for (const [px, py, , t] of LIGHTS) { g.fillStyle = '#c9c2a8'; g.font = 'bold 8px Arial Narrow, Arial'; g.textAlign = 'center'; g.textBaseline = 'top'; for (const [i, w] of t.split(' ').entries()) g.fillText(w, px, py + 15 + i * 9); }
  for (const [px, py, w, hh, lines, dark] of PLACARDS) {
    g.fillStyle = dark ? '#121211' : '#c4bda4'; g.fillRect(px - w / 2, py - hh / 2, w, hh);
    g.strokeStyle = dark ? '#c9c2a8' : '#6f6a5c'; g.lineWidth = 1.2; g.strokeRect(px - w / 2 + 2, py - hh / 2 + 2, w - 4, hh - 4);
    const fs = Math.min((hh - 6) / lines.length * 0.82, 15);
    lines.forEach((t, i) => { g.fillStyle = dark ? '#ddd6c0' : '#1c1c1a'; g.font = `bold ${i === 0 && lines.length > 1 ? fs * 1.15 : fs}px Arial Narrow, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, px, py - hh / 2 + 3 + (hh - 6) * (i + 0.5) / lines.length, w - 8); });
    hg.fillStyle = '#9a9a9a'; hg.fillRect(px - w / 2, py - hh / 2, w, hh);
    for (const [sx, sy] of [[px - w / 2 + 4, py - hh / 2 + 4], [px + w / 2 - 4, py + hh / 2 - 4]]) screw(g, hg, sx, sy, 2.2);
  }
  for (const [px, py, t] of [[255, 512, "PILOT'S OXYGEN"], [465, 512, "CO-PILOT'S OXYGEN"], [150, 485, 'FLUORESCENT LIGHTS'], [150, 420, "PILOT'S PANEL"], [150, 555, 'FLIGHT PANEL'], [795, 430, 'FEATHERING SWITCHES'], [1665, 205, 'ENGINE'], [1600, 410, 'FILTER']]) {
    g.fillStyle = '#c9c2a8'; g.font = 'bold 9px Arial Narrow, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, px, py);
  }
  const col = new THREE.CanvasTexture(c); col.colorSpace = THREE.SRGBColorSpace; col.anisotropy = 8;
  return { color: col, normal: heightToNormal(h, 2.4) };
}
/** The crackle finish's grain: a tile of fine light and dark flecks. */
function fleckTile() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = rnd(); if (v < 0.08) { const l = rnd() < 0.5 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = l; d[i + 3] = 8 + rnd() * 16; } }
  g.putImageData(img, 0, 0);
  return c;
}
function screw(g, hg, x, y, r = 3.2) {
  g.fillStyle = '#77746b'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.strokeStyle = '#2a2a28'; g.lineWidth = r * 0.35; g.beginPath(); g.moveTo(x - r * 0.75, y - r * 0.2); g.lineTo(x + r * 0.75, y + r * 0.2); g.stroke();
  hg.fillStyle = '#d0d0d0'; hg.beginPath(); hg.arc(x, y, r, 0, 7); hg.fill();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function label(g, t, x, y, px, col, align = 'center') { g.fillStyle = col; g.font = `bold ${px}px Arial Narrow, Arial`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); }

/** A tangent-space normal map from a grey height canvas. */
export function heightToNormal(canvas, strength = 2) {
  const w = canvas.width, h = canvas.height, src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const og = out.getContext('2d'), img = og.createImageData(w, h), d = img.data;
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / len * 0.5 + 0.5) * 255; d[i + 1] = (dy / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(out);
}

/**
 * The padding: cotton fabric over kapok batts, tube-stitched in parallel channels (the 1943 blankets,
 * snapped to the frames), Berry Bros. bronze green faded towards olive. Colour and normal.
 */
function quiltTextures() {
  const S = 512, N = 6, P = S / N; // 6 channels across the tile
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const h = document.createElement('canvas'); h.width = h.height = S;
  const hg = h.getContext('2d'), img = hg.createImageData(S, S), d = img.data;
  const ci = g.createImageData(S, S), cd = ci.data;
  seed = 5;
  const noise = new Float32Array(S * S).map(() => rnd());
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (y / P) % 1, e = Math.min(u, 1 - u); // (channels run along the tile's x: lengthwise along the fuselage)
    const lump = 0.06 * Math.sin(x / S * Math.PI * 6 + Math.floor(y / P) * 1.7); // (the batting's not quite even)
    const ht = Math.pow(Math.min(1, e / 0.5), 0.5) * (0.94 + lump);
    const n = noise[y * S + x], i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.round(ht * 225 + n * 12); d[i + 3] = 255;
    const weave = ((x + y) % 4 < 2 ? 1 : 0.95) * ((x - y + S) % 4 < 2 ? 1 : 0.96); // the cotton's twill
    const shade = (0.6 + 0.4 * ht + (n - 0.5) * 0.08) * weave, seam = e < 0.02 ? 0.5 : 1;
    cd[i] = 60 * shade * seam; cd[i + 1] = 68 * shade * seam; cd[i + 2] = 48 * shade * seam; cd[i + 3] = 255;
    if (e < 0.02 && (x % 10) < 5) { cd[i] = 92; cd[i + 1] = 92; cd[i + 2] = 72; } // the stitching
  }
  hg.putImageData(img, 0, 0); g.putImageData(ci, 0, 0);
  const col = new THREE.CanvasTexture(c); col.colorSpace = THREE.SRGBColorSpace;
  const nrm = heightToNormal(h, 7);
  for (const t of [col, nrm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { color: col, normal: nrm };
}

/** The control wheel's hub cap: Boeing's winged totem (BOEING down the totem, wings either side), aluminium on black. */
function hubTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const rim = g.createRadialGradient(110, 100, 20, 128, 128, 128);
  rim.addColorStop(0, '#d9dbd6'); rim.addColorStop(0.8, '#9a9c96'); rim.addColorStop(1, '#55574f');
  g.fillStyle = rim; g.beginPath(); g.arc(128, 128, 127, 0, 7); g.fill();
  g.fillStyle = '#121212'; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.fill();
  g.fillStyle = '#c9cbc4';
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { // the wings: swept feathers
    g.beginPath(); g.moveTo(128 + s * 20, 92 + k * 8); g.lineTo(128 + s * (98 - k * 10), 70 + k * 12); g.lineTo(128 + s * (94 - k * 10), 78 + k * 12); g.lineTo(128 + s * 20, 100 + k * 8); g.closePath(); g.fill();
  }
  g.fillRect(110, 60, 36, 140); // the totem
  g.fillStyle = '#121212'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...'BOEING'].forEach((ch, i) => g.fillText(ch, 128, 72 + i * 23));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The C-1 autopilot's control panel: its knobs and switches, the legends round them. */
function autopilotTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1c1a'; g.fillRect(0, 0, 512, 320);
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`; g.fillRect(Math.random() * 512, Math.random() * 320, 2, 1); }
  g.strokeStyle = '#4a4a44'; g.lineWidth = 4; g.strokeRect(4, 4, 504, 312);
  label(g, 'AUTOMATIC FLIGHT CONTROL — C-1', 256, 22, 18, '#d2ccb8');
  const cols = ['AILERON', 'RUDDER', 'ELEVATOR'];
  for (let i = 0; i < 3; i++) {
    const x = 100 + i * 156;
    label(g, cols[i], x, 52, 16, '#d2ccb8');
    for (const [y, t] of [[110, 'SENSITIVITY'], [200, 'CENTERING'], [275, 'TRIM']]) {
      g.strokeStyle = '#d2ccb8'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 30, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      for (let k = 0; k <= 8; k++) { const a = Math.PI * 0.75 + k * Math.PI * 1.5 / 8; g.beginPath(); g.moveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30); g.lineTo(x + Math.cos(a) * 36, y + Math.sin(a) * 36); g.stroke(); }
      label(g, t, x, y + 40, 12, '#b9b29c');
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** A data plate / placard (black on cream, or white stencil on black). */
function placardTexture(lines, w = 512, h = 128, dark = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = dark ? '#161615' : '#cbc4aa'; g.fillRect(0, 0, w, h);
  g.strokeStyle = dark ? '#555' : '#6f6a5c'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  lines.forEach((t, i) => label(g, t, w / 2, (h / (lines.length + 1)) * (i + 1), Math.min(h / (lines.length + 1.2), 44), dark ? '#ddd6c0' : '#1c1c1a'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const GLOW = { value: 0 }; // the radium figures' glow (by night)
const std = (c, r = 0.7, m = 0.1, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 0.25, ...extra });
// Dull Dark Green, the cockpit's 1943 paint; the black of the panel and the bakelite; bare and painted steel
const M = {
  panel: null, ddg: std(0x343d2a, 0.62, 0.2), od: std(0x4a4d33, 0.75, 0.1), black: std(0x161716, 0.5, 0.3), bakelite: std(0x0c0c0c, 0.32, 0.05),
  green: std(0x55603f, 0.42, 0.35), red: std(0x9a1d12, 0.42, 0.05), redLens: std(0x8a1a12, 0.15, 0, { emissive: 0x300000 }), steel: std(0x8f918a, 0.32, 0.85), alu: std(0xa7aaa3, 0.38, 0.8),
  brass: std(0xb08a43, 0.3, 0.9), white: std(0xd8d2be, 0.6), knobW: std(0xc9c3b0, 0.35, 0.05), yellow: std(0xc19a2a, 0.5),
  leather: std(0x5a3d26, 0.55, 0.0), webbing: std(0x6a6648, 0.9, 0.0), canvas: std(0x8a7d5c, 0.95, 0.0), rubber: std(0x1d1d1c, 0.85, 0),
  armour: std(0x3d4430, 0.55, 0.5), bezel: std(0x101010, 0.38, 0.55), screw: std(0x6e6c66, 0.35, 0.8),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fb0b0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 1.1 }),
  needle: new THREE.MeshStandardMaterial({ color: 0xf0ebdc, roughness: 0.5, emissive: 0x96d27a, emissiveIntensity: 0 }),
  needleY: new THREE.MeshStandardMaterial({ color: 0xe9c86a, roughness: 0.5, emissive: 0x96d27a, emissiveIntensity: 0 }),
  lens: {}, pad: null, hub: null, ap: null,
};
M.glass.userData.outside = true; // (a glint of the sky: not darkened like the cabin)

/** it = the Interior (add/box/rod/cylinder helpers, the hull table). Returns the live parts. */
export function buildB17Cockpit(it) {
  const live = { needles: [], night: [] };
  buildPanel(it, live);
  buildGlareShield(it);
  for (const s of [-1, 1]) buildControls(it, s);
  buildPedestal(it);
  for (const s of [-1, 1]) buildSeat(it, s);
  for (const s of [-1, 1]) buildSidePanel(it, s);
  buildPadding(it);
  buildFrames(it);
  buildOverhead(it);
  buildFloor(it);
  it.cockpitLive = (state, dt) => updateLive(live, state, dt);
  it.cockpitNight = (k) => { for (const m of live.night) m.emissiveIntensity = m.userData.full * k; GLOW.value = 0.5 * k; };
  return live;
}

// ---------------------------------------------------------------------------------------------------
// the instrument panel

function buildPanel(it, live) {
  const z = PANEL.z;
  const tex = panelTextures();
  M.panel ??= new THREE.MeshStandardMaterial({ map: tex.color, normalMap: tex.normal, normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.66, metalness: 0.1, envMapIntensity: 0.3 });
  // the dials' faces: the same paint, but their white figures are radium paint, glowing green by night
  M.faces ??= Object.assign(M.panel.clone(), { normalMap: null });
  M.faces.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = GLOW;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 gt = texture2D(map, vMapUv).rgb; totalEmissiveRadiance += vec3(0.45, 0.8, 0.38) * smoothstep(0.35, 0.75, dot(gt, vec3(0.333))) * uGlow; }`);
  };
  M.faces.customProgramCacheKey = () => 'b17-faces';
  // the face: the panel's outline, its texture mapped by position
  const shape = new THREE.Shape(OUTLINE.map(([px, py]) => new THREE.Vector2(...pm(px, py))));
  const fg = new THREE.ShapeGeometry(shape);
  const uv = fg.attributes.uv, p = fg.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - PANEL.x0) / (PANEL.x1 - PANEL.x0), (p.getY(i) - PANEL.y0) / (PANEL.y1 - PANEL.y0));
  const face = new THREE.Mesh(fg.translate(0, 0, z), M.panel);
  face.receiveShadow = true; it.group.add(face);
  // its thickness, and the frame behind (all solid): from the outline back to the bulkhead
  it.add(M.black, new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z - 0.1005));
  it.boxes.push(new THREE.Box3(new V(PANEL.x0, F, z - 0.14), new V(PANEL.x1, PANEL.y1, z)));
  // between the panel's arch and the windscreen's sill: the coaming, Dull Dark Green, and under the panel down to the floor the well the pedals stand in
  const sill = 0.665, top = OUTLINE.slice(1, -1).map(([px, py]) => pm(px, py));
  const coam = new THREE.Shape([new THREE.Vector2(PANEL.x0 - 0.2, sill + 0.01), ...top.map(([x, y]) => new THREE.Vector2(x, y)), new THREE.Vector2(PANEL.x1 + 0.2, top[top.length - 1][1]), new THREE.Vector2(PANEL.x1 + 0.2, sill + 0.01)]);
  it.add(M.ddg, new THREE.ShapeGeometry(coam).translate(0, 0, z - 0.05));
  // the glare shield's top: a deck from the coaming forward under the windscreen's foot, so looking down past the
  // panel you see it and not the nose compartment below (facing up only: the nose crew see nothing of it)
  it.add(M.ddg, new THREE.PlaneGeometry(PANEL.x1 - PANEL.x0 + 0.4, 0.2).rotateX(-Math.PI / 2).translate((PANEL.x0 + PANEL.x1) / 2, sill + 0.01, z - 0.15));
  it.add(M.ddg, new THREE.BoxGeometry(PANEL.x1 - PANEL.x0 + 0.4, PANEL.y0 - F, 0.04).translate((PANEL.x0 + PANEL.x1) / 2, (F + PANEL.y0) / 2, z - 0.12));
  // the padded roll along the arch: leather over a rubber core
  const roll = new THREE.CatmullRomCurve3(top.map(([x, y]) => new V(x, y + 0.012, z + 0.006)));
  it.add(M.leather, new THREE.TubeGeometry(roll, 80, 0.016, 10));
  // the joints between the sections: a raised strip
  for (const sx of SEAMS) { const [x] = pm(sx, 0); const yt = topAt(x); it.box(x - 0.004, x + 0.004, PANEL.y0, yt, z, z + 0.004, M.black, false); }
  // ---- the instruments: bezels (raised rings), the glass, setting knobs
  seed = 99;
  const bez = [], glass = [], cases = [];
  const zz = z + FACE_DZ;
  for (const [px, py, rp, kind, , liveKind] of GAUGES) {
    const [x, y] = pm(px, py), r = rp * S;
    // the instrument's face stands out in its case through the panel; the bezel's lip over the glass
    cases.push(new THREE.CylinderGeometry(r * 1.02, r * 1.02, FACE_DZ, 32, 1, true).rotateX(Math.PI / 2).translate(x, y, z + FACE_DZ / 2));
    const prof = [[r * 1.0, 0], [r * 1.12, 0], [r * 1.14, 0.004], [r * 1.1, 0.008], [r * 1.02, 0.009], [r * 0.97, 0.007]].map(([a, b]) => new THREE.Vector2(a, b));
    bez.push(new THREE.LatheGeometry(prof, 40).rotateX(Math.PI / 2).translate(x, y, zz));
    glass.push(new THREE.CircleGeometry(r * 1.0, 32).translate(x, y, zz + 0.005));
    if (liveKind) addLive(it, live, x, y, zz, r, kind, liveKind);
  }
  // the face itself, raised: a disc of the panel's own texture at the instrument's depth
  const faces = [];
  for (const [px, py, rp] of GAUGES) { const [x, y] = pm(px, py), r = rp * S * 1.01; faces.push(new THREE.CircleGeometry(r, 36).translate(x, y, zz)); }
  const fgeo = merge(faces), fu = fgeo.attributes.uv, fp = fgeo.attributes.position;
  for (let i = 0; i < fp.count; i++) fu.setXY(i, (fp.getX(i) - PANEL.x0) / (PANEL.x1 - PANEL.x0), (fp.getY(i) - PANEL.y0) / (PANEL.y1 - PANEL.y0));
  it.group.add(new THREE.Mesh(fgeo, M.faces));
  for (const g of bez) it.add(M.bezel, g);
  for (const g of cases) it.add(M.bezel, g);
  const gm = new THREE.Mesh(merge(glass), M.glass); gm.renderOrder = 3; it.group.add(gm);
  for (const [px, py, rp] of KNOBS) { // knurled black knobs
    const [x, y] = pm(px, py), r = rp * S;
    it.add(M.bakelite, new THREE.CylinderGeometry(r, r * 1.1, 0.014, 16).rotateX(Math.PI / 2).translate(x, y, z + 0.007));
    it.add(M.steel, new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.002, 8).rotateX(Math.PI / 2).translate(x, y, z + 0.0145));
  }
  // the warning lights: jewelled lenses in chrome rims
  for (const [px, py, col] of LIGHTS) {
    const [x, y] = pm(px, py);
    const lm = (M.lens[col] ??= Object.assign(std(new THREE.Color(col).multiplyScalar(0.6), 0.12, 0, { emissive: new THREE.Color(col), emissiveIntensity: 0 }), { userData: { full: 0.7 } }));
    if (!live.night.includes(lm)) live.night.push(lm);
    it.add(M.steel, new THREE.CylinderGeometry(0.0105, 0.0115, 0.012, 16).rotateX(Math.PI / 2).translate(x, y, z + 0.006));
    it.add(lm, new THREE.SphereGeometry(0.0082, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).rotateX(Math.PI / 2).translate(x, y, z + 0.012));
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; it.add(lm, new THREE.BoxGeometry(0.0015, 0.0015, 0.0015).translate(x + Math.cos(a) * 0.004, y + Math.sin(a) * 0.004, z + 0.0175)); } // (the jewel's facets)
  }
  // the four feathering buttons: big round red caps in their collars, a guard bar over them
  for (const [px, py] of FEATHER) {
    const [x, y] = pm(px, py);
    it.add(M.steel, new THREE.CylinderGeometry(0.019, 0.02, 0.008, 22).rotateX(Math.PI / 2).translate(x, y, z + 0.004));
    it.add(M.red, new THREE.CylinderGeometry(0.0165, 0.017, 0.014, 22).rotateX(Math.PI / 2).translate(x, y, z + 0.015));
    it.add(M.red, new THREE.SphereGeometry(0.0165, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1).rotateX(Math.PI / 2).translate(x, y, z + 0.022));
  }
  { const [x0, y] = pm(660, 440), [x1] = pm(930, 440); it.rod([x0, y, z + 0.03], [x1, y, z + 0.03], 0.004, M.steel, 8); for (const x of [x0, x1]) it.rod([x, y, z], [x, y, z + 0.03], 0.004, M.steel, 6); }
  // the toggles on the co-pilot's panel (oil dilution, the filter, the starters in their red guards)
  for (const [px, py, guard] of TOGGLES) {
    const [x, y] = pm(px, py);
    it.add(M.steel, new THREE.CylinderGeometry(0.006, 0.006, 0.006, 10).rotateX(Math.PI / 2).translate(x, y, z + 0.003));
    it.add(M.steel, new THREE.CylinderGeometry(0.0022, 0.0035, 0.024, 8).translate(0, 0.012, 0).rotateX(Math.PI / 2).rotateX(rnd() < 0.5 ? -0.45 : 0.45).translate(x, y, z + 0.005));
    if (guard) for (const s of [-1, 1]) it.box(x + s * 0.01 - 0.0015, x + s * 0.01 + 0.0015, y - 0.013, y + 0.013, z, z + 0.018, M.red, false);
  }
  // the fuel gauge's tank selector (a T-handle) and the fire extinguisher's red selector and pull handles
  { const [x, y] = pm(1500, 432); it.add(M.bakelite, new THREE.CylinderGeometry(0.012, 0.014, 0.012, 14).rotateX(Math.PI / 2).translate(x, y, z + 0.006)); it.add(M.bakelite, new THREE.BoxGeometry(0.034, 0.007, 0.012).translate(x, y, z + 0.016)); }
  { const [x, y] = pm(1815, 540); it.add(M.red, new THREE.CylinderGeometry(0.016, 0.017, 0.012, 16).rotateX(Math.PI / 2).translate(x, y, z + 0.006)); it.add(M.red, new THREE.BoxGeometry(0.036, 0.008, 0.01).translate(x, y, z + 0.016)); }
  for (const px of [1745, 1880]) { const [x, y] = pm(px, 600); it.rod([x, y, z], [x, y, z + 0.03], 0.003, M.steel, 6); it.add(M.red, new THREE.BoxGeometry(0.04, 0.01, 0.01).translate(x, y, z + 0.033)); }
  // two hooded fluorescent (ultraviolet) lamps clamped on the coaming over the pilot's section, aimed down at the dials
  for (const px of [330, 400]) {
    const [x, y] = pm(px, 150), yy = topAt(x) + 0.03;
    it.rod([x, topAt(x) + 0.005, z + 0.01], [x, yy, z + 0.03], 0.004, M.black, 6);
    it.add(M.white, new THREE.CapsuleGeometry(0.014, 0.03, 4, 10).rotateX(-0.9).translate(x, yy, z + 0.05));
    it.add(M.black, new THREE.CylinderGeometry(0.016, 0.016, 0.015, 12).rotateX(-0.9).translate(x, yy + 0.012, z + 0.04));
    void y;
  }
}
/** The panel's top edge (its arch) at x. */
function topAt(x) {
  const pts = OUTLINE.slice(1, -1).map(([px, py]) => pm(px, py));
  for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i][0] && x <= pts[i + 1][0]) { const k = (x - pts[i][0]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0]); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k; }
  return pts[pts.length - 1][1];
}

/** A live needle (or the horizon's card, the gyro's drum, the turn needle and ball) on gauge (x, y). */
function addLive(it, live, x, y, zz, r, kind, key) {
  const mk = (len, w, mat = M.needle, tail = 0.2) => {
    const s = new THREE.Shape([new THREE.Vector2(-r * tail, -w * 0.7), new THREE.Vector2(len * 0.85, -w * 0.45), new THREE.Vector2(len, 0), new THREE.Vector2(len * 0.85, w * 0.45), new THREE.Vector2(-r * tail, w * 0.7)]);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
    m.position.set(x, y, zz + 0.002); it.group.add(m);
    return m;
  };
  const cap = () => { const c = new THREE.Mesh(new THREE.CircleGeometry(r * 0.09, 12), M.bezel); c.position.set(x, y, zz + 0.0028); it.group.add(c); };
  if (kind === 'horizon') {
    // the card behind the mask: sky over earth, the horizon bar, pitch lines; turned and moved by the bank and pitch
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#c9c4b2'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#1d1d1b'; g.fillRect(0, 128, 256, 128);
    g.fillStyle = '#f2eee2'; g.fillRect(0, 124, 256, 8);
    g.strokeStyle = '#4a4a46'; g.lineWidth = 3; for (const d of [-48, -24, 24, 48]) { g.beginPath(); g.moveTo(98, 128 + d); g.lineTo(158, 128 + d); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0x96d27a, emissiveIntensity: 0, emissiveMap: t });
    mat.userData.full = 0.25; live.night.push(mat);
    const card = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 32), mat);
    card.position.set(x, y, zz + 0.0012); it.group.add(card);
    // the little aeroplane over it, fixed
    const plane = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([[-0.55, 0.02], [-0.15, 0.02], [-0.08, -0.08], [0, -0.04], [0.08, -0.08], [0.15, 0.02], [0.55, 0.02], [0.55, -0.03], [-0.55, -0.03]].map(([a, b]) => new THREE.Vector2(a * r, b * r)))), M.needleY);
    plane.position.set(x, y, zz + 0.003); it.group.add(plane);
    live.needles.push({ key, kind, m: card, r });
    return;
  }
  if (kind === 'gyro') { // the drum's figures scroll past the window: a strip texture, its offset is the heading
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#060606'; g.fillRect(0, 0, 1024, 64);
    for (let k = 0; k < 72; k++) {
      const px = (k / 72) * 1024; g.fillStyle = '#ece6d2'; g.fillRect(px - 1, 0, 2, k % 2 ? 10 : 18);
      if (k % 2 === 0) { const hd = k * 5; label(g, hd % 90 === 0 ? 'NESW'[hd / 90] : String(hd / 10), px, 40, 24, '#ece6d2'); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(0.18, 1);
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0x96d27a, emissiveIntensity: 0, emissiveMap: t });
    mat.userData.full = 0.4; live.night.push(mat);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.56, r * 0.46), mat);
    strip.position.set(x, y, zz + 0.0012); it.group.add(strip);
    live.needles.push({ key, kind, m: strip, tex: t });
    return;
  }
  if (kind === 'turn') {
    const n = mk(r * 0.82, r * 0.07); n.position.y = y - r * 0.1; n.rotation.z = Math.PI / 2;
    const ball = new THREE.Mesh(new THREE.CircleGeometry(r * 0.07, 12), M.black);
    ball.position.set(x, y + r * 0.5, zz + 0.0022); it.group.add(ball);
    live.needles.push({ key, kind, m: n, ball, x, y, r });
    return;
  }
  if (kind === 'altimeter') {
    const a = mk(r * 0.86, r * 0.05), b = mk(r * 0.6, r * 0.09), c = mk(r * 0.4, r * 0.12);
    c.position.z += 0.0002; b.position.z += 0.0004; a.position.z += 0.0006;
    cap(); live.needles.push({ key, kind, m: [a, b, c] });
    return;
  }
  if (kind === 'manifold' || kind === 'tach') {
    const a = mk(r * 0.8, r * 0.06), b = mk(r * 0.8, r * 0.06, M.needleY); b.position.z += 0.0003;
    cap(); live.needles.push({ key, kind, m: [a, b] });
    return;
  }
  if (kind === 'pdi') { const n = mk(r * 0.8, r * 0.07); n.position.y = y - r * 0.3; live.needles.push({ key, kind, m: n }); return; }
  const n = mk(r * 0.82, r * 0.07); cap();
  live.needles.push({ key, kind, m: n });
}

const _e = new THREE.Euler();
function updateLive(live, s, dt) {
  // canvas angles are clockwise from 3 o'clock with y down: a mesh turns anticlockwise, so it's the negative
  const set = (m, kind, v) => { m.rotation.z = -dialAngle(kind, v); };
  live.t = (live.t ?? 0) + dt;
  const t = live.t;
  for (const n of live.needles) {
    switch (n.key) {
      case 'ias': set(n.m, 'airspeed', s.ias + Math.sin(t * 1.3) * 0.6); break;
      case 'alt': { const ft = s.feet; set(n.m[0], 'altimeter', ft % 1000); set(n.m[1], 'altimeter', (ft / 10) % 1000); set(n.m[2], 'altimeter', (ft / 100) % 1000); break; }
      case 'climb': set(n.m, 'climb', THREE.MathUtils.clamp(s.climb / 1000, -6, 6)); break;
      case 'man12': set(n.m[0], 'manifold', s.mp[0]); set(n.m[1], 'manifold', s.mp[1]); break;
      case 'man34': set(n.m[0], 'manifold', s.mp[2]); set(n.m[1], 'manifold', s.mp[3]); break;
      case 'rpm12': set(n.m[0], 'tach', s.rpm[0] / 100); set(n.m[1], 'tach', s.rpm[1] / 100); break;
      case 'rpm34': set(n.m[0], 'tach', s.rpm[2] / 100); set(n.m[1], 'tach', s.rpm[3] / 100); break;
      case 'horizon': {
        n.m.rotation.z = s.bank; // (the card banks the other way to the aeroplane: seen from behind, it stays with the earth)
        n.m.material.map.offset.y = THREE.MathUtils.clamp(s.pitch * 0.8, -0.2, 0.2); n.m.material.map.center.set(0.5, 0.5);
        break;
      }
      case 'dg': n.tex.offset.x = ((s.heading / 360) - 0.09 + 1) % 1; break;
      case 'turn': {
        n.m.rotation.z = Math.PI / 2 - THREE.MathUtils.clamp(s.turn * 6, -0.6, 0.6);
        const sl = THREE.MathUtils.clamp(s.slip, -1, 1) * 0.45;
        n.ball.position.x = n.x + Math.sin(sl) * n.r * 1.05; n.ball.position.y = n.y - n.r * 0.55 - Math.cos(sl) * n.r * 1.05 + n.r * 2.1;
        break;
      }
      case 'pdi': n.m.rotation.z = Math.PI / 2 + THREE.MathUtils.clamp(s.pdi ?? 0, -0.5, 0.5); break;
    }
  }
}

function merge(geos) {
  const m = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of m) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const n = m[0].attributes[name].itemSize, arr = new Float32Array(m.reduce((s, g) => s + g.attributes.position.count, 0) * n);
    let o = 0; for (const g of m) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// over the panel

function buildGlareShield(it) {
  // the instrument box over the coaming, on the centre line at the foot of the windscreen's post: the
  // eight-day clock, the standby magnetic compass read through its window, the de-icer pressure gauge
  const z = PANEL.z - 0.07, y = 0.745, w = 0.3, h = 0.11;
  M.box ??= new THREE.MeshStandardMaterial({ map: overheadBoxTexture(), roughness: 0.55, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0 });
  it.add(M.black, new RoundedBoxGeometry(w + 0.02, h + 0.02, 0.07, 3, 0.012).translate(0, y, z - 0.035));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.box); f.position.set(0, y, z + 0.0005); it.group.add(f);
  for (const dx of [-0.095, 0, 0.095]) {
    it.add(M.bezel, new THREE.TorusGeometry(0.041, 0.005, 8, 32).translate(dx, y, z + 0.003));
    it.add(M.glass, new THREE.CircleGeometry(0.04, 28).translate(dx, y, z + 0.006));
  }
  it.add(M.bakelite, new THREE.CylinderGeometry(0.008, 0.009, 0.012, 12).rotateX(Math.PI / 2).translate(0, y - 0.047, z + 0.006)); // the clock's winding knob
  for (const s of [-1, 1]) it.rod([s * 0.13, y + 0.06, z - 0.03], [s * 0.05, 0.98, -8.86], 0.006, M.ddg, 6); // its brackets up to the post
  // either side on the coaming: the IFF control box on the left, a switch box on the right
  it.add(M.black, new RoundedBoxGeometry(0.1, 0.05, 0.05, 2, 0.006).translate(-0.33, 0.69, z - 0.02));
  it.add(M.white, new THREE.PlaneGeometry(0.06, 0.012).translate(-0.33, 0.705, z + 0.006));
  it.add(M.bakelite, new THREE.CylinderGeometry(0.01, 0.011, 0.012, 12).rotateX(Math.PI / 2).translate(-0.33, 0.685, z + 0.01));
  it.add(M.ddg, new RoundedBoxGeometry(0.08, 0.05, 0.05, 2, 0.006).translate(0.3, 0.69, z - 0.02));
  it.add(M.steel, new THREE.CylinderGeometry(0.0022, 0.0035, 0.02, 6).rotateX(Math.PI / 2 - 0.4).translate(0.3, 0.69, z + 0.012));
}

/** The box over the coaming: clock, magnetic compass, de-icer pressure, on black. */
function overheadBoxTexture() {
  const c = document.createElement('canvas'); c.width = 768; c.height = 282;
  const g = c.getContext('2d');
  g.fillStyle = '#161615'; g.fillRect(0, 0, 768, 282);
  const r = 100, cy = 141;
  drawFace(g, 141, cy, r, 'clock', {});
  drawFace(g, 627, cy, r, 'hydraulic', {});
  // the compass: a horizontal card read through a window, the lubber line across it
  g.fillStyle = '#0a0a09'; g.beginPath(); g.arc(384, cy, r, 0, 7); g.fill();
  g.fillStyle = '#d9d2bc'; g.fillRect(384 - 80, cy - 40, 160, 80);
  for (let k = -4; k <= 4; k++) { g.fillStyle = '#111'; g.fillRect(384 + k * 18 - 1, cy - 40, 2, k % 2 ? 12 : 22); }
  g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#111'; g.fillText('E', 384 - 36, cy + 14); g.fillText('12', 384 + 36, cy + 14);
  g.fillStyle = '#c4281c'; g.fillRect(383, cy - 46, 3, 92);
  g.fillStyle = '#c9c2a8'; g.font = 'bold 18px Arial'; g.fillText('DE-ICER', 627, cy + 72); g.fillText('COMPASS', 384, cy + 72);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------------------------------------------------------------------------------------------------
// the control columns, the wheels and the rudder pedals (s: -1 the pilot's, +1 the co-pilot's)

// (crew.js puts the pilots' hands on the grips: x ± r, y hubY + 0.04)
export const WHEEL = { hubY: 0.255, z: -8.09, cz: -8.3, r: 0.175 };
function buildControls(it, s) {
  const x = s * 0.55, { hubY, z, cz, r } = WHEEL;
  // the column: a stout tube up from the floor in front of his knees (the conduit up its side, the
  // aileron lock pin in its clips), a canvas boot closing the slot in the floor round its foot
  it.add(M.ddg, new THREE.CylinderGeometry(0.038, 0.042, hubY - 0.04 - (F + 0.16), 22).translate(x, (hubY - 0.04 + F + 0.16) / 2, cz));
  it.rod([x + s * 0.045, F + 0.18, cz + 0.005], [x + s * 0.045, hubY - 0.07, cz + 0.005], 0.007, M.ddg, 6);
  for (const y of [F + 0.35, F + 0.5]) it.add(M.steel, new THREE.TorusGeometry(0.041, 0.004, 6, 20).rotateX(Math.PI / 2).translate(x, y, cz));
  it.rod([x - s * 0.046, F + 0.33, cz + 0.01], [x - s * 0.046, F + 0.52, cz + 0.01], 0.005, M.steel, 6);
  const boot = [[0.11, 0], [0.108, 0.02], [0.092, 0.035], [0.098, 0.05], [0.08, 0.07], [0.084, 0.085], [0.066, 0.105], [0.068, 0.12], [0.052, 0.14], [0.047, 0.17], [0.042, 0.185]];
  it.add(M.canvas, new THREE.LatheGeometry(boot.map(([a, b]) => new THREE.Vector2(a, b)), 22).translate(x, F, cz));
  // its head: the housing of the aileron sprocket and chain, the shaft aft out of it to the wheel
  it.add(M.ddg, new RoundedBoxGeometry(0.11, 0.09, 0.12, 3, 0.022).translate(x, hubY - 0.02, cz + 0.02));
  it.add(M.steel, new THREE.CylinderGeometry(0.019, 0.019, cz + 0.075 - (z - 0.025), 16).rotateX(Math.PI / 2).translate(x, hubY, (cz + 0.075 + z - 0.025) / 2));
  it.add(M.rubber, new THREE.CylinderGeometry(0.026, 0.03, 0.03, 16).rotateX(Math.PI / 2).translate(x, hubY, cz + 0.085));
  // the wheel: the hub, the straight cross-bar out to each side, turning up there into the grips and down
  // into the U of the rim; one spoke straight down from the hub to the rim's bottom
  it.add(M.bakelite, new THREE.CylinderGeometry(0.046, 0.05, 0.04, 28).rotateX(Math.PI / 2).translate(x, hubY, z));
  M.hub ??= new THREE.MeshStandardMaterial({ map: hubTexture(), roughness: 0.3, metalness: 0.6, envMapIntensity: 0.45 });
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.042, 32), M.hub); cap.position.set(x, hubY, z + 0.0205); it.group.add(cap);
  it.add(M.alu, new THREE.TorusGeometry(0.042, 0.003, 8, 32).translate(x, hubY, z + 0.02));
  const T = 0.0125; // the section of the bar and the rim
  it.add(M.bakelite, new THREE.CylinderGeometry(T, T, 2 * r, 12).rotateZ(Math.PI / 2).translate(x, hubY, z + 0.006));
  const rim = new THREE.CatmullRomCurve3(Array.from({ length: 21 }, (_, i) => { const a = Math.PI * (i / 20); return new V(x + Math.cos(a) * r, hubY - Math.sin(a) * r * 1.02, z + 0.006); }));
  it.add(M.bakelite, new THREE.TubeGeometry(rim, 48, T, 12));
  it.add(M.bakelite, new THREE.CylinderGeometry(T * 0.9, T * 0.9, r, 10).translate(x, hubY - r / 2 - 0.02, z + 0.006));
  for (const d of [-1, 1]) {
    it.add(M.bakelite, new THREE.SphereGeometry(T * 1.15, 12, 8).translate(x + d * r, hubY, z + 0.006)); // the corner
    // the grip: a short horn up from the corner, finger ridges, a rounded cap
    const prof = [[0.0, 0], [0.017, 0.0], [0.019, 0.015], [0.016, 0.025], [0.0195, 0.038], [0.016, 0.05], [0.0195, 0.063], [0.016, 0.074], [0.012, 0.082], [0.0, 0.085]];
    it.add(M.bakelite, new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 18).rotateZ(-d * 0.1).translate(x + d * r, hubY + 0.006, z + 0.006));
  }
  // the microphone (interphone) push button, on the left of the wheel by the grip
  it.add(M.red, new THREE.CylinderGeometry(0.0075, 0.008, 0.012, 14).rotateX(Math.PI / 2).translate(x - r + 0.03, hubY + 0.004, z + 0.02));
  it.add(M.steel, new THREE.CylinderGeometry(0.011, 0.011, 0.006, 14).rotateX(Math.PI / 2).translate(x - r + 0.03, hubY + 0.004, z + 0.014));
  // ---- the rudder pedals: hung from the cross tube under the panel (buildPedestal), each a broad dished
  // plate on its arm, the toe brake the plate's upper part pivoting onto its master cylinder
  for (const d of [-1, 1]) {
    const px = x + d * 0.15, pz = -8.33, py = F + 0.14;
    it.rod([px, PEDAL_TUBE.y, PEDAL_TUBE.z], [px, py + 0.1, pz - 0.03], 0.013, M.ddg, 10);
    it.add(M.ddg, new THREE.CylinderGeometry(0.02, 0.02, 0.05, 12).rotateZ(Math.PI / 2).translate(px, PEDAL_TUBE.y, PEDAL_TUBE.z)); // its clamp on the tube
    const plate = new RoundedBoxGeometry(0.12, 0.2, 0.016, 3, 0.008);
    const pp = plate.attributes.position; for (let i = 0; i < pp.count; i++) pp.setZ(i, pp.getZ(i) + 0.9 * pp.getX(i) * pp.getX(i)); // (dished)
    plate.computeVertexNormals();
    it.add(M.ddg, plate.rotateX(-0.42).translate(px, py, pz));
    for (let k = 0; k < 6; k++) it.add(M.rubber, new THREE.BoxGeometry(0.1, 0.007, 0.006).translate(0, -0.075 + k * 0.03, 0.011).rotateX(-0.42).translate(px, py, pz)); // the tread
    it.add(M.steel, new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8).rotateX(-1.2).translate(px, py + 0.11, pz - 0.06)); // the brake's master cylinder
    it.add(M.steel, new THREE.BoxGeometry(0.012, 0.03, 0.012).translate(px + d * 0.066, py - 0.04, pz - 0.01)); // the adjusting clip
  }
}

// ---------------------------------------------------------------------------------------------------
// the centre pedestal (as in the Pilot Training Manual's figures and the wartime photographs): the upper
// pedestal's switch panel at the panel's foot, the throttle quadrant sloping down and aft from it, and
// the lower pedestal at knee height with the C-1 autopilot's panel on its back

const PEDAL_TUBE = { y: -0.02, z: -8.47 };
function buildPedestal(it) {
  const zf = -8.5, za = -7.84, xu = 0.22, xl = 0.15;
  // the cross tube the rudder pedals hang from, right across under the panel
  it.add(M.ddg, new THREE.CylinderGeometry(0.019, 0.019, 1.6, 14).rotateZ(Math.PI / 2).translate(0, PEDAL_TUBE.y, PEDAL_TUBE.z));
  for (const x of [-0.78, 0.78]) it.add(M.ddg, new RoundedBoxGeometry(0.05, 0.08, 0.06, 2, 0.01).translate(x, PEDAL_TUBE.y, PEDAL_TUBE.z));
  // ---- the lower pedestal: knee height, solid (you go round it, to the hatch behind it)
  it.box(-xl, xl, F, -0.07, zf + 0.06, za, M.ddg);
  for (const x of [-xl, xl]) for (const y of [F + 0.1, F + 0.3]) it.add(M.steel, new THREE.CylinderGeometry(0.004, 0.004, 0.003, 8).rotateZ(Math.PI / 2).translate(x, y, -8.1));
  // the C-1 autopilot (AFCE) panel on its back, facing the pilots: knobs in three rows, engaging toggles
  M.ap ??= new THREE.MeshStandardMaterial({ map: autopilotTexture(), roughness: 0.55, metalness: 0.2 });
  it.box(-0.11, 0.11, F + 0.07, F + 0.29, za, za + 0.03, M.black, false);
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.21), M.ap); ap.position.set(0, F + 0.18, za + 0.0305); it.group.add(ap);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const kx = -0.035 + i * 0.05, ky = F + 0.215 - j * 0.052;
    it.add(M.bakelite, new THREE.CylinderGeometry(0.0095, 0.011, 0.014, 14).rotateX(Math.PI / 2).translate(kx, ky, za + 0.037));
    it.add(M.white, new THREE.BoxGeometry(0.0018, 0.007, 0.002).translate(kx, ky + 0.006, za + 0.0445));
  }
  for (let k = 0; k < 7; k++) { const ky = F + 0.265 - k * 0.026; it.add(M.steel, new THREE.CylinderGeometry(0.0045, 0.0045, 0.005, 8).rotateX(Math.PI / 2).translate(-0.085, ky, za + 0.033)); it.add(M.steel, new THREE.CylinderGeometry(0.0018, 0.0026, 0.016, 6).translate(0, 0.008, 0).rotateX(Math.PI / 2 + (k % 3 ? 0.4 : -0.4)).translate(-0.085, ky, za + 0.035)); }
  for (const [kx, col] of [[-0.05, M.redLens], [0.0, M.redLens], [0.05, M.redLens]]) it.add(col, new THREE.SphereGeometry(0.0045, 8, 6).translate(kx, F + 0.268, za + 0.034));
  // ---- the upper pedestal: a wider box at the panel's foot, its top the black switch panel tilted to the pilots
  const yt0 = 0.17, yt1 = 0.105, zt1 = -8.22; // the switch panel: from the panel's foot back and down
  it.box(-xu, xu, -0.07, yt1, zf, zt1, M.ddg);
  const tilt = Math.atan2(yt0 - yt1, zt1 - zf);
  const swLen = Math.hypot(yt0 - yt1, zt1 - zf);
  M.sw ??= new THREE.MeshStandardMaterial({ map: switchPanelTexture(), roughness: 0.6, metalness: 0.15 });
  const sw = new THREE.Mesh(new THREE.PlaneGeometry(2 * xu, swLen), M.sw);
  sw.rotation.x = -Math.PI / 2 + tilt; sw.position.set(0, (yt0 + yt1) / 2 + 0.002, (zf + zt1) / 2); it.group.add(sw);
  it.add(M.ddg, new THREE.BoxGeometry(2 * xu, 0.02, swLen).rotateX(tilt).translate(0, (yt0 + yt1) / 2 - 0.01, (zf + zt1) / 2));
  const onTop = (u, v) => [u, yt0 + (yt1 - yt0) * v + 0.004, zf + (zt1 - zf) * v]; // u across, v 0 fore - 1 aft
  // the two ignition switch units (rotary, two engines each) at its front left, the boost pump and
  // fuel shut-off rows, the landing gear and flap switches at the right, the lights' switches
  for (const u of [-0.17, -0.1]) { const [x, y, z] = onTop(u, 0.25); it.add(M.bakelite, new THREE.CylinderGeometry(0.022, 0.024, 0.012, 18).translate(x, y + 0.006, z)); it.add(M.bakelite, new THREE.BoxGeometry(0.036, 0.012, 0.009).rotateY(0.6).translate(x, y + 0.016, z)); }
  const tog = (u, v, up, red) => {
    const [x, y, z] = onTop(u, v);
    it.add(M.steel, new THREE.CylinderGeometry(0.005, 0.005, 0.005, 10).translate(x, y + 0.002, z));
    it.add(M.steel, new THREE.CylinderGeometry(0.002, 0.003, 0.02, 6).translate(0, 0.01, 0).rotateX(up ? -0.45 : 0.45).translate(x, y + 0.004, z));
    if (red) for (const d of [-1, 1]) it.box(x + d * 0.009 - 0.0013, x + d * 0.009 + 0.0013, y, y + 0.014, z - 0.011, z + 0.011, M.red, false);
  };
  for (let i = 0; i < 4; i++) { tog(-0.04 + i * 0.028, 0.2, i % 2 === 0); tog(-0.04 + i * 0.028, 0.55, true, true); }
  tog(0.12, 0.25, false, true); tog(0.17, 0.25, true); // the landing gear, the flaps
  for (let i = 0; i < 3; i++) tog(0.1 + i * 0.035, 0.65, i !== 1);
  for (let i = 0; i < 4; i++) { const [x, y, z] = onTop(-0.17 + i * 0.024, 0.75); it.add(M.bakelite, new THREE.BoxGeometry(0.008, 0.016, 0.03).translate(x, y + 0.008, z)); } // the cowl flap valves
  // ---- the throttle quadrant: the black face sloping down and aft from the switch panel, its slots
  const qz0 = zt1, qz1 = za - 0.02, qy0 = yt1, qy1 = -0.07;
  const qt = Math.atan2(qy0 - qy1, qz1 - qz0), qLen = Math.hypot(qy0 - qy1, qz1 - qz0);
  it.add(M.black, new THREE.BoxGeometry(2 * xu - 0.04, 0.012, qLen).rotateX(qt).translate(0, (qy0 + qy1) / 2, (qz0 + qz1) / 2));
  { // (the body under it: a wedge, its sides the quadrant's cheeks)
    const wedge = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(qz0, qy0), new THREE.Vector2(qz0, qy1), new THREE.Vector2(qz1, qy1)]), { depth: 2 * xu - 0.04, bevelEnabled: false });
    it.add(M.ddgD ??= Object.assign(M.ddg.clone(), { side: THREE.DoubleSide }), wedge.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -xu + 0.02, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)));
  }
  const onQ = (u, v) => [u, qy0 + (qy1 - qy0) * v + 0.008, qz0 + (qz1 - qz0) * v]; // on the quadrant's face
  const qn = new V(0, Math.cos(qt), Math.sin(qt)); // its normal, up and aft
  for (let i = 0; i < 12; i++) { const u = -0.18 + i * 0.0327, [x, y, z] = onQ(u, 0.5); it.add(M.alu, new THREE.BoxGeometry(0.003, 0.002, qLen * 0.8).rotateX(qt).translate(x, y - 0.003, z)); }
  const lever = (u, v, len, lean, knob) => { // a lever out of its slot, leaning aft (+) or forward (-), its knob at the tip
    const [x, y, z] = onQ(u, v), dir = qn.clone().applyAxisAngle(new V(1, 0, 0), -lean), tip = new V(x, y, z).addScaledVector(dir, len);
    it.rod([x, y, z], tip.toArray(), 0.0045, M.steel, 8);
    knob?.(tip, dir);
    return tip;
  };
  // the turbo boost selector (the G's single dial, left of the mixture levers... here at the quadrant's left)
  { const [x, y, z] = onQ(-0.17, 0.3); it.add(M.bakelite, new THREE.CylinderGeometry(0.028, 0.03, 0.022, 26).rotateX(qt).translate(x, y + 0.01, z)); it.add(M.white, new THREE.BoxGeometry(0.003, 0.003, 0.024).rotateX(qt).translate(x, y + 0.022, z - 0.006)); it.add(M.knobW, new THREE.CylinderGeometry(0.034, 0.034, 0.002, 26, 1, true).rotateX(qt).translate(x, y + 0.001, z)); }
  // the throttles: two long bar grips, the left over engines 1 and 2, the right over 3 and 4 (green, as built)
  const tips = [];
  for (let i = 0; i < 4; i++) tips.push(lever(-0.1 + i * 0.033, 0.45, 0.15, -0.35));
  for (const [a, b] of [[tips[0], tips[1]], [tips[2], tips[3]]]) it.add(M.green, new THREE.CylinderGeometry(0.0135, 0.0135, 0.07, 16).rotateZ(Math.PI / 2).translate((a.x + b.x) / 2, a.y + 0.012, a.z));
  // the mixture levers: four tall levers with black knobs lettered LEAN / RICH, at the right
  for (let i = 0; i < 4; i++) lever(0.065 + i * 0.035, 0.4, 0.17, 0.1, (t) => it.add(M.bakelite, new RoundedBoxGeometry(0.022, 0.045, 0.013, 2, 0.004).translate(t.x, t.y + 0.015, t.z)));
  // the propeller levers: short, small square black knobs, low and aft
  for (let i = 0; i < 4; i++) lever(-0.08 + i * 0.04, 0.85, 0.06, 0.2, (t) => it.add(M.bakelite, new RoundedBoxGeometry(0.017, 0.017, 0.017, 2, 0.003).translate(t.x, t.y + 0.006, t.z)));
  // the locks: the throttle lock's lever on the quadrant's left side, the propeller lock on its right
  for (const [x, col] of [[-xu + 0.005, M.red], [xu - 0.005, M.red]]) { const [, y, z] = onQ(x, 0.55); it.rod([x, y, z], [x + Math.sign(x) * 0.02, y + 0.06, z + 0.02], 0.004, M.steel, 6); it.add(col, new THREE.SphereGeometry(0.01, 10, 8).translate(x + Math.sign(x) * 0.02, y + 0.065, z + 0.022)); }
  // the warning placard at the quadrant's foot
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshStandardMaterial({ map: placardTexture(['WARNING — THIS AIRPLANE HAS SUPERCHARGED ENGINES', 'OPERATE IN ACCORDANCE WITH "OPERATION INSTRUCTIONS"'], 768, 192, true), roughness: 0.6 }));
  { const [x, y, z] = onQ(0, 0.96); pl.position.set(x, y + 0.002, z); pl.rotation.x = -Math.PI / 2 + qt; it.group.add(pl); }
  // ---- the trim controls: the elevator's big knurled wheel on the lower pedestal's left side, rolling
  // fore and aft; the rudder's lying flat at the pedestal's foot under its guard
  const wheel = (x, y, z, r, flat) => {
    const parts = [new THREE.TorusGeometry(r, r * 0.11, 10, 48), new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.3, 16).rotateX(Math.PI / 2)];
    for (let k = 0; k < 3; k++) parts.push(new THREE.BoxGeometry(r * 2, r * 0.12, r * 0.06).rotateZ(k * Math.PI / 3));
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; parts.push(new THREE.BoxGeometry(r * 0.05, r * 0.07, r * 0.24).rotateZ(a).translate(Math.cos(a) * r * 1.09, Math.sin(a) * r * 1.09, 0)); } // the knurling
    for (const p of parts) { if (flat) p.rotateX(Math.PI / 2); else p.rotateY(Math.PI / 2); it.add(M.bakelite, p.translate(x, y, z)); }
  };
  wheel(-xl - 0.02, F + 0.2, -8.12, 0.12, false);
  it.add(M.ddg, new THREE.CylinderGeometry(0.02, 0.02, 0.04, 12).rotateZ(Math.PI / 2).translate(-xl - 0.005, F + 0.2, -8.12));
  M.trimPl ??= new THREE.MeshStandardMaterial({ map: placardTexture(['NOSE DOWN', 'ELEVATOR TAB', 'NOSE UP'], 256, 192, true), roughness: 0.6 });
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.052), M.trimPl); m.position.set(-xl - 0.001, F + 0.36, -8.12); m.rotation.y = -Math.PI / 2; it.group.add(m); }
  wheel(xl + 0.07, F + 0.05, -8.2, 0.08, true);
  it.add(M.ddg, new THREE.TorusGeometry(0.1, 0.008, 6, 20, Math.PI).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(xl + 0.07, F + 0.09, -8.2)); // its guard
  // the elevator and rudder lock on the floor at the pedestal's left, the tail wheel lock at its right
  it.rod([-xl - 0.04, F + 0.01, -7.95], [-xl - 0.05, F + 0.14, -8.05], 0.008, M.steel, 6); it.add(M.red, new THREE.SphereGeometry(0.015, 10, 8).translate(-xl - 0.05, F + 0.15, -8.06));
  it.rod([xl + 0.04, F + 0.01, -7.95], [xl + 0.05, F + 0.12, -8.02], 0.008, M.steel, 6); it.add(M.bakelite, new THREE.SphereGeometry(0.015, 10, 8).translate(xl + 0.05, F + 0.13, -8.03));
}

/** The upper pedestal's switch panel: legends round its switches. */
function switchPanelTexture() {
  const c = document.createElement('canvas'); c.width = 768; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#181917'; g.fillRect(0, 0, 768, 512);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`; g.fillRect(Math.random() * 768, Math.random() * 512, 2, 1); }
  g.strokeStyle = '#4a4a44'; g.lineWidth = 5; g.strokeRect(3, 3, 762, 506);
  const L = (t, x, y, px = 18) => label(g, t, x, y, px, '#d2ccb8');
  // (u across -0.22..0.22 -> 0..768, v fore 0 -> aft 1 -> 0..512 top to bottom)
  const X = (u) => (u + 0.22) / 0.44 * 768, Y = (v) => v * 512;
  L('IGNITION', X(-0.135), Y(0.08)); L('1-2', X(-0.17), Y(0.4), 15); L('3-4', X(-0.1), Y(0.4), 15);
  L('FUEL BOOSTER PUMPS', X(0.002), Y(0.08)); L('FUEL SHUT-OFF VALVES', X(0.002), Y(0.45));
  for (let i = 0; i < 4; i++) { L(String(i + 1), X(-0.04 + i * 0.028), Y(0.3), 14); L(String(i + 1), X(-0.04 + i * 0.028), Y(0.67), 14); }
  L('LANDING GEAR', X(0.12), Y(0.08), 15); L('FLAPS', X(0.17), Y(0.4), 15); L('UP', X(0.12), Y(0.4), 14);
  L('LIGHTS', X(0.135), Y(0.52), 15); L('COWL FLAPS', X(-0.135), Y(0.62), 15); L('OPEN · LOCKED · CLOSE', X(-0.135), Y(0.92), 13);
  label(g, 'RECOGNITION · LANDING', X(0.135), Y(0.82), 13, '#b9b29c');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------------------------------------------------------------------------------------------------
// the seats: tubular and sheet-aluminium buckets on their pedestals, in dark green, a seat-pack's depth;
// leather cushions; the armour plate behind each, up past his head; the adjusting handle outboard

function buildSeat(it, s) {
  const x = s * 0.55, z0 = -7.86, z1 = -7.34, top = F + 0.43; // (the crew sit at y 0.05: the cushion's top)
  for (const d of [-1, 1]) { // the pedestal's tubes and the rails on the floor
    it.box(x + d * 0.19 - 0.015, x + d * 0.19 + 0.015, F, F + 0.025, z0 - 0.06, z1 + 0.06, M.alu, false);
    it.rod([x + d * 0.19, F + 0.025, z0 + 0.03], [x + d * 0.19, top - 0.1, z0 + 0.08], 0.017, M.ddg, 10);
    it.rod([x + d * 0.19, F + 0.025, z1 - 0.03], [x + d * 0.19, top - 0.1, z1 - 0.08], 0.017, M.ddg, 10);
    it.rod([x + d * 0.19, F + 0.14, z0 + 0.05], [x + d * 0.19, F + 0.14, z1 - 0.05], 0.012, M.ddg, 8);
    it.rod([x + d * 0.19, F + 0.025, z0 + 0.03], [x + d * 0.19, top - 0.1, z1 - 0.08], 0.01, M.ddg, 6); // (the diagonal brace)
  }
  it.box(x - 0.24, x + 0.24, F, top - 0.05, z0 + 0.02, z1 - 0.02, null); // (solid: the seat's a seat)
  // the bucket: deep sides and a rolled lip
  it.add(M.ddg, new RoundedBoxGeometry(0.47, 0.15, 0.5, 3, 0.03).translate(x, top - 0.09, (z0 + z1) / 2));
  for (const d of [-1, 1]) it.add(M.ddg, new RoundedBoxGeometry(0.02, 0.2, 0.46, 2, 0.008).translate(x + d * 0.235, top + 0.03, (z0 + z1) / 2 + 0.01)); // the bucket's sides, up round his hips
  // the cushions: leather, piped, buttoned
  it.add(M.leather, new RoundedBoxGeometry(0.43, 0.07, 0.46, 5, 0.03).translate(x, top - 0.005, (z0 + z1) / 2 - 0.01));
  it.add(M.leather, new RoundedBoxGeometry(0.42, 0.5, 0.07, 5, 0.03).rotateX(-0.12).translate(x, top + 0.29, z1 - 0.02));
  for (const [dx, dy] of [[-0.1, 0.17], [0.1, 0.17], [-0.1, 0.39], [0.1, 0.39], [0, 0.28]]) it.add(M.rubber, new THREE.SphereGeometry(0.007, 8, 6).translate(x + dx, top + dy, z1 - 0.058 + dy * 0.12));
  // the back's frame, and the armour plate behind it, up past his head, its bolts
  it.add(M.ddg, new RoundedBoxGeometry(0.47, 0.58, 0.03, 2, 0.01).rotateX(-0.12).translate(x, top + 0.3, z1 + 0.025));
  it.add(M.armour, new RoundedBoxGeometry(0.46, 0.78, 0.012, 2, 0.004).rotateX(-0.1).translate(x, top + 0.42, z1 + 0.06));
  for (const [dx, dy] of [[-0.2, 0.08], [0.2, 0.08], [-0.2, 0.76], [0.2, 0.76], [-0.2, 0.42], [0.2, 0.42]]) it.add(M.steel, new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8).rotateX(Math.PI / 2 - 0.1).translate(x + dx, top + dy, z1 + 0.072 + dy * 0.1));
  it.add(M.leather, new RoundedBoxGeometry(0.22, 0.12, 0.05, 3, 0.02).rotateX(-0.1).translate(x, top + 0.7, z1 + 0.01)); // the headrest pad
  it.box(x - 0.25, x + 0.25, top, top + 0.85, z1, z1 + 0.09, null); // (solid)
  // the adjusting handle on the outboard side
  const ox = x + s * 0.25;
  it.rod([ox, top - 0.06, z0 + 0.15], [ox + s * 0.02, top + 0.02, z0 + 0.05], 0.006, M.steel, 6);
  it.add(M.bakelite, new THREE.SphereGeometry(0.014, 10, 8).translate(ox + s * 0.02, top + 0.025, z0 + 0.045));
  // the safety belt: its two halves lying on the cushion, the buckle
  for (const d of [-1, 1]) {
    const belt = new THREE.CatmullRomCurve3([new V(x + d * 0.22, top + 0.01, z1 - 0.08), new V(x + d * 0.16, top + 0.035, z1 - 0.2), new V(x + d * 0.05, top + 0.035, z0 + 0.12), new V(x + d * 0.015, top + 0.04, z0 + 0.06)]);
    const b = new THREE.TubeGeometry(belt, 16, 0.012, 4);
    const bp = b.attributes.position; for (let i = 0; i < bp.count; i++) { /* (flattened onto the cushion) */ const yy = bp.getY(i); bp.setY(i, top + 0.035 + (yy - top - 0.035) * 0.3); }
    b.computeVertexNormals();
    it.add(M.webbing, b);
  }
  it.add(M.steel, new THREE.BoxGeometry(0.05, 0.008, 0.035).translate(x, top + 0.043, z0 + 0.07));
  // the oxygen shut-off valve on the pilot's seat frame
  if (s < 0) it.add(M.red, new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12).rotateZ(Math.PI / 2).translate(x - 0.25, F + 0.2, z0 + 0.1));
}

// ---------------------------------------------------------------------------------------------------
// the side panels below the windows: the pilot's (oxygen, interphone, the suit heater, the lights)
// and the co-pilot's (the turbo and cowl flap controls, the hydraulic hand pump)

function buildSidePanel(it, s) {
  const zA = -8.38, zB = -7.42, y0 = F + 0.18, y1 = F + 0.58;
  const wall = (z, y) => it.hw(z, y) - 0.012;
  // a console along the wall: a sloped top with its switch plate, the box under it
  const xi = s * (wall(-7.9, y1) - 0.17);
  const xo = s * wall(-7.9, y0);
  const x0 = Math.min(xi, xo), x1 = Math.max(xi, xo);
  it.box(x0, x1, F, y0, zA, zB, M.ddg, false);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(zB - zA, 0.24), sidePanelMaterial(s));
  plate.rotation.set(-Math.PI / 2, 0, s < 0 ? -Math.PI / 2 : Math.PI / 2);
  plate.position.set((x0 + x1) / 2, y0 + 0.0305, (zA + zB) / 2);
  it.group.add(plate);
  it.add(M.ddg, new THREE.BoxGeometry(x1 - x0, 0.03, zB - zA).translate((x0 + x1) / 2, y0 + 0.015, (zA + zB) / 2));
  seed = s > 0 ? 41 : 43;
  // knobs, toggles and levers on it
  const pt = (u, v) => { // u along (0 fore - 1 aft), v across (0 inboard - 1 outboard): a point on the sloping plate
    const zz = zA + 0.04 + u * (zB - zA - 0.08), xx = THREE.MathUtils.lerp(xi, xo, 0.12 + v * 0.76);
    return [xx, y0 + 0.03, zz];
  };
  for (let i = 0; i < 7; i++) { const [xx, yy, zz] = pt(0.08 + i * 0.13, 0.3); it.add(M.steel, new THREE.CylinderGeometry(0.0025, 0.0035, 0.022, 6).rotateZ(s * (rnd() < 0.5 ? 0.45 : -0.45)).translate(xx, yy + 0.012, zz)); it.add(M.steel, new THREE.CylinderGeometry(0.006, 0.006, 0.006, 10).translate(xx, yy + 0.002, zz)); }
  for (let i = 0; i < 4; i++) { const [xx, yy, zz] = pt(0.15 + i * 0.22, 0.7); it.add(i % 2 ? M.red : M.bakelite, new THREE.CylinderGeometry(0.012, 0.014, 0.018, 14).translate(xx, yy + 0.009, zz)); }
  if (s > 0) { // the co-pilot's: the cowl flap levers, the hydraulic hand pump's handle along the wall
    for (let i = 0; i < 2; i++) { const [xx, yy, zz] = pt(0.3 + i * 0.12, 0.5); it.rod([xx, yy, zz], [xx, yy + 0.09, zz + 0.04], 0.004, M.steel, 6); it.add(M.red, new THREE.SphereGeometry(0.01, 10, 8).translate(xx, yy + 0.093, zz + 0.042)); }
    it.rod([s * wall(-7.3, F + 0.25) - s * 0.05, F + 0.25, -7.35], [s * wall(-7.0, F + 0.3) - s * 0.05, F + 0.32, -7.0], 0.009, M.steel, 8);
    it.add(M.bakelite, new THREE.CapsuleGeometry(0.014, 0.06, 4, 8).rotateX(Math.PI / 2).translate(s * wall(-7.0, F + 0.3) - s * 0.05, F + 0.32, -6.97));
  } else { // the pilot's: the emergency brake handle and the oxygen regulator's red emergency knob
    const [xx, yy, zz] = pt(0.85, 0.5);
    it.rod([xx, yy, zz], [xx, yy + 0.06, zz], 0.006, M.steel, 6); it.add(M.red, new THREE.BoxGeometry(0.05, 0.016, 0.02).translate(xx, yy + 0.065, zz));
  }
  // ---- on the wall over it: the oxygen regulator (A-12 demand type, the blinker and the pressure gauge),
  // the interphone jack box, the suit heater outlet
  const reg = (zz, yy) => {
    const xx = s * wall(zz, yy);
    it.add(M.ddg, new RoundedBoxGeometry(0.03, 0.14, 0.11, 2, 0.008).translate(xx - s * 0.015, yy, zz));
    it.add(M.bakelite, new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16).rotateZ(Math.PI / 2).translate(xx - s * 0.033, yy + 0.035, zz - 0.02)); // pressure gauge
    it.add(M.white, new THREE.CylinderGeometry(0.018, 0.018, 0.002, 16).rotateZ(Math.PI / 2).translate(xx - s * 0.04, yy + 0.035, zz - 0.02));
    it.add(M.yellow, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 14).rotateZ(Math.PI / 2).translate(xx - s * 0.033, yy + 0.035, zz + 0.025)); // the blinker
    it.add(M.red, new THREE.BoxGeometry(0.012, 0.02, 0.04).translate(xx - s * 0.033, yy - 0.035, zz)); // the emergency valve
    it.add(M.rubber, new THREE.TorusGeometry(0.014, 0.006, 6, 12, Math.PI * 1.4).rotateY(Math.PI / 2).translate(xx - s * 0.035, yy - 0.075, zz + 0.02)); // the hose's start
  };
  reg(-7.6, F + 0.75);
  const jx = s * wall(-7.95, F + 0.75);
  it.add(M.black, new RoundedBoxGeometry(0.03, 0.08, 0.1, 2, 0.006).translate(jx - s * 0.015, F + 0.75, -7.98)); // the interphone jack box
  it.add(M.bakelite, new THREE.CylinderGeometry(0.012, 0.013, 0.014, 12).rotateZ(Math.PI / 2).translate(jx - s * 0.033, F + 0.76, -7.98));
  it.add(M.steel, new THREE.CylinderGeometry(0.0045, 0.0045, 0.014, 8).rotateZ(Math.PI / 2).translate(jx - s * 0.033, F + 0.725, -7.96));
}

function sidePanelMaterial(s) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1c1a'; g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`; g.fillRect(Math.random() * 1024, Math.random() * 256, 2, 1); }
  g.strokeStyle = '#3c3c38'; g.lineWidth = 6; g.strokeRect(3, 3, 1018, 250);
  const legends = s < 0 ? ['LANDING LIGHTS', 'PASSING LIGHT', 'POSITION', 'FORMATION', 'RECOGNITION', 'PITOT HEAT', 'SUIT HEAT'] : ['COWL FLAPS', 'DE-ICER', 'PROP ANTI-ICE', 'INVERTERS', 'BOMB DOOR', 'WING FLAPS', 'TAIL WHEEL'];
  legends.forEach((t, i) => label(g, t, 70 + i * 135, 80, 20, '#d2ccb8'));
  label(g, s < 0 ? "PILOT'S CONTROL PANEL" : "CO-PILOT'S CONTROL PANEL", 512, 230, 22, '#b9b29c');
  for (let i = 0; i < 4; i++) label(g, s < 0 ? ['RHEOSTAT', 'OXYGEN', 'INTERPHONE', 'EMERG'][i] : ['LEFT', 'RIGHT', 'OPEN', 'CLOSED'][i], 140 + i * 230, 170, 18, '#b9b29c');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.2 });
}

// ---------------------------------------------------------------------------------------------------
// the quilted padding on the walls (under the side windows, behind the seats) and the roof

function buildPadding(it) {
  const q = quiltTextures();
  M.pad ??= new THREE.MeshStandardMaterial({ map: q.color, normalMap: q.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.58, metalness: 0.05, envMapIntensity: 0.18 });
  const TILE = 0.48; // m per texture tile (4 diamonds: 12 cm each)
  // a padded sheet over the hull between z0 and z1 and heights y0 to y1 on one side, inset from the skin
  const sheet = (s, z0, z1, y0, y1, inset = 0.022, nz = 14, ny = 10) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= nz; i++) for (let j = 0; j <= ny; j++) {
      const z = z0 + (z1 - z0) * (i / nz), y = y0 + (y1 - y0) * (j / ny);
      const x = s * Math.max(0.02, it.hwSmooth(z, y) - inset);
      pos.push(x, y, z); uv.push(z / TILE, y / TILE);
    }
    for (let i = 0; i < nz; i++) for (let j = 0; j < ny; j++) {
      const a = i * (ny + 1) + j, b = a + ny + 1;
      if (s < 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    it.add(M.pad, g);
    // the piping round its edges
    const edge = (pts) => it.add(M.rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([z, y]) => new V(s * Math.max(0.02, it.hwSmooth(z, y) - inset + 0.004), y, z))), pts.length * 3, 0.008, 6));
    const along = (y) => Array.from({ length: 8 }, (_, k) => [z0 + (z1 - z0) * k / 7, y]), up = (z) => Array.from({ length: 6 }, (_, k) => [z, y0 + (y1 - y0) * k / 5]);
    edge(along(y0)); edge(along(y1)); edge(up(z0)); edge(up(z1));
  };
  for (const s of [-1, 1]) {
    sheet(s, -7.4, -6.45, F + 0.32, 0.64); // the wall behind each seat, below the window
    sheet(s, -8.38, -7.42, F + 0.6, 0.64, 0.022, 10, 3); // the strip over the side panel
  }
  // the roof: from over the windscreen back to the turret's ring, one sheet across the crown
  const z0 = -8.12, z1 = -7.26, nz = 10, nc = 22, pos = [], uv = [], idx = [];
  for (let i = 0; i <= nz; i++) {
    const z = z0 + (z1 - z0) * (i / nz), crown = it.ceilingAt(z, 0, 0.5) - 0.028;
    for (let j = 0; j <= nc; j++) {
      const a = -1 + 2 * (j / nc); // -1 the left window's top, 0 the crown, +1 the right
      const yy = THREE.MathUtils.lerp(1.0, crown, Math.sin((1 - Math.abs(a)) * Math.PI / 2));
      const x = Math.sign(a) * Math.max(0, it.hwSmooth(z, Math.min(yy, crown - 0.005)) - 0.022);
      pos.push(x, yy, z); uv.push(z / TILE, a * 0.9 / TILE);
    }
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nc; j++) { const a = i * (nc + 1) + j, b = a + nc + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // (facing down, into the cockpit)
  const n = g.attributes.normal; let flip = 0; for (let i = 0; i < n.count; i++) flip += n.getY(i);
  if (flip > 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
  it.add(M.pad, g);
}

// ---------------------------------------------------------------------------------------------------
// the frames round the windscreen and the side windows (the model's skin is cut for the glass)

function buildFrames(it) {
  const P = (s, z, y, inset = 0.012) => new V(s * (it.hwSmooth(z, y) - inset), y, z);
  for (const s of [-1, 1]) {
    // the side window: sill, header, and the posts (the front pane slides aft past the fixed one)
    const sill = 0.675, head = 0.975;
    for (const y of [sill, head]) it.add(M.ddg, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, k) => P(s, -8.2 + k * (1.9 / 8), y))), 24, 0.011, 6));
    for (const z of [-8.2, -7.05, -6.3]) it.add(M.ddg, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 5 }, (_, k) => P(s, z, sill + k * (head - sill) / 4))), 8, 0.018, 6));
    // the sliding window's track and its latch handle
    it.add(M.steel, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 6 }, (_, k) => P(s, -8.15 + k * 0.2, sill + 0.02, 0.03))), 12, 0.005, 5));
    const h = P(s, -7.12, sill + 0.12, 0.04); it.add(M.black, new RoundedBoxGeometry(0.02, 0.06, 0.03, 2, 0.006).translate(h.x, h.y, h.z));
  }
  // the windscreen's centre post, down the middle from the roof to the glare shield
  const post = new THREE.CatmullRomCurve3([new V(0, 0.69, -8.66), new V(0, 0.85, -8.82), new V(0, 1.03, -8.93), new V(0, 1.16, -8.78), new V(0, 1.24, -8.58)]);
  it.add(M.ddg, new THREE.TubeGeometry(post, 20, 0.022, 8));
}

// ---------------------------------------------------------------------------------------------------
// overhead: the switch box between the pilots, the dome light, the hand-holds

function buildOverhead(it) {
  const oz = -7.9, oy = it.ceilingAt(oz, 0, 0.5) - 0.035;
  it.add(M.black, new RoundedBoxGeometry(0.16, 0.045, 0.2, 2, 0.008).translate(0, oy - 0.02, oz));
  for (let i = 0; i < 8; i++) {
    const x = -0.055 + (i % 4) * 0.037, z = oz - 0.05 + Math.floor(i / 4) * 0.1;
    it.add(M.steel, new THREE.CylinderGeometry(0.0025, 0.0035, 0.02, 6).rotateX(i % 3 ? 0.4 : -0.4).translate(x, oy - 0.05, z));
  }
  it.add(M.redLens, new THREE.SphereGeometry(0.01, 10, 6).translate(0.05, oy - 0.045, oz + 0.05));
  // the dome light, aft over the hatch
  const dz = -7.4, dy = it.ceilingAt(dz, 0, 0.5) - 0.03;
  it.add(M.black, new THREE.CylinderGeometry(0.05, 0.055, 0.03, 18).translate(0, dy, dz));
  it.add(M.white, new THREE.SphereGeometry(0.04, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, dy - 0.015, dz));
}

// ---------------------------------------------------------------------------------------------------
// the floor under the pilots' feet: unpainted aluminium sheet, riveted down (the plywood's further aft,
// round the top turret); the aileron trim crank on its stand at the pilot's left

function buildFloor(it) {
  M.floorAl ??= new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.42, metalness: 0.75, envMapIntensity: 0.3 });
  for (const s of [-1, 1]) {
    const x0 = s * 0.21, x1 = s * 0.92, g = new THREE.PlaneGeometry(Math.abs(x1 - x0), 1.1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, F + 0.002, -7.85);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 1.5, p.getZ(i) * 1.5);
    const m = new THREE.Mesh(g, M.floorAl); m.receiveShadow = true; it.group.add(m);
  }
  // the aileron tab crank: a little stand on the floor outboard of the pilot's seat, its handle and indicator
  const x = -0.86, z = -7.95;
  it.rod([x, F, z], [x, F + 0.32, z], 0.012, M.ddg, 8);
  it.add(M.black, new RoundedBoxGeometry(0.05, 0.07, 0.07, 2, 0.008).translate(x, F + 0.35, z));
  it.add(M.bakelite, new THREE.CylinderGeometry(0.03, 0.03, 0.01, 18).rotateZ(Math.PI / 2).translate(x + 0.03, F + 0.35, z));
  it.rod([x + 0.035, F + 0.35, z], [x + 0.035, F + 0.37, z + 0.025], 0.003, M.steel, 6);
  it.add(M.bakelite, new THREE.CylinderGeometry(0.007, 0.007, 0.025, 8).rotateZ(Math.PI / 2).translate(x + 0.05, F + 0.37, z + 0.025));
}
function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#9a9d98'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '30,30,26'},${0.03 + Math.random() * 0.06})`; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 30, 1); } // brushed, scuffed
  for (let i = 0; i < 26; i++) { const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 60, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,36,28,0.22)'); gr.addColorStop(1, 'rgba(40,36,28,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } // boots, oil
  g.strokeStyle = 'rgba(30,30,28,0.6)'; g.lineWidth = 2; g.strokeRect(1, 1, 510, 510); // the sheet's joints
  for (let k = 8; k < 512; k += 24) for (const [x, y] of [[k, 8], [k, 504], [8, k], [504, k]]) { g.fillStyle = '#c6c8c2'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + 1, y + 1, 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
