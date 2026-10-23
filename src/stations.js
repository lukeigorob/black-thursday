// The navigator's and the radio operator's stations, as in the photos of the real B-17. The navigator:
// his chart table with the chart, plotter and dividers, the astro compass on its stand, the drift
// meter, his instrument board on the wall and his lamp. The radio operator: his desk with the BC-348
// receiver, the BC-375 liaison transmitter on its shelf above, the command sets on the far wall, the
// Morse key, his headset and log, his chair, and the cables. All the faces (dials, tuning windows,
// nameplates, the chart) are drawn on one texture atlas, so the lot is a few draw calls.
import * as THREE from 'three';
import { drawGauge } from './cockpitb17.js';
import { insideLight, leather } from './cabinlook.js';

const AW = 2048, AH = 1024;
// atlas regions [x, y, w, h] in px
const R = { receiver: [0, 0, 640, 384], transmitter: [640, 0, 640, 512], command: [1280, 0, 256, 384], navPanel: [1536, 0, 512, 256], chart: [0, 512, 640, 512], log: [640, 512, 256, 320], plate: [1536, 256, 256, 128] };

function crackle(g, [x, y, w, h], base) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  for (let i = 0; i < w * h / 600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.04})`; g.fillRect(x + Math.random() * w, y + Math.random() * h, 1 + Math.random() * 6, 1 + Math.random() * 2); }
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
}
function knob(g, x, y, r) {
  const k = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  k.addColorStop(0, '#5a5a56'); k.addColorStop(1, '#0d0d0c');
  g.fillStyle = k; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.strokeStyle = '#d9d4c2'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - r); g.stroke();
}
function label(g, t, x, y, size = 14, col = '#d9d4c2') { g.fillStyle = col; g.font = `bold ${size}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); }
function tuningWindow(g, x, y, w, h) { // a backlit tuning scale
  g.fillStyle = '#1a140b'; g.fillRect(x - 4, y - 4, w + 8, h + 8);
  const gl = g.createLinearGradient(x, y, x, y + h); gl.addColorStop(0, '#e8d6a2'); gl.addColorStop(1, '#c9b27a');
  g.fillStyle = gl; g.fillRect(x, y, w, h);
  g.strokeStyle = '#2a2014'; g.lineWidth = 1.5;
  for (let i = 0; i <= 60; i++) { const px = x + 6 + (i / 60) * (w - 12); g.beginPath(); g.moveTo(px, y + h * 0.55); g.lineTo(px, y + h * (i % 5 ? 0.75 : 0.9)); g.stroke(); }
  g.fillStyle = '#2a2014'; g.font = '11px Arial'; g.textAlign = 'center';
  for (let i = 0; i <= 12; i++) g.fillText(String(200 + i * 50), x + 6 + (i / 12) * (w - 12), y + h * 0.35);
  g.strokeStyle = '#b02a1a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w * 0.43, y + 2); g.lineTo(x + w * 0.43, y + h - 2); g.stroke();
}

function atlas() {
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  // the BC-348 receiver
  { const r = R.receiver, [x, y, w, h] = r; crackle(g, r, '#2b2c29');
    tuningWindow(g, x + 150, y + 60, 340, 90);
    label(g, 'RADIO RECEIVER BC-348-R', x + w / 2, y + 30, 16);
    for (let i = 0; i < 6; i++) knob(g, x + 70 + i * 100, y + 260, i === 2 ? 38 : 26);
    ['BAND', 'VOLUME', 'TUNING', 'CRYSTAL', 'BEAT OSC', 'SENS.'].forEach((t, i) => label(g, t, x + 70 + i * 100, y + 318, 12));
    g.fillStyle = '#111'; g.beginPath(); g.arc(x + 560, y + 105, 30, 0, 7); g.fill(); label(g, 'PHONES', x + 560, y + 150, 11);
    drawGauge(g, x + 80, y + 110, 34, 'pressure', 'OUTPUT'); }
  // the BC-375 liaison transmitter
  { const r = R.transmitter, [x, y, w, h] = r; crackle(g, r, '#262725');
    label(g, 'RADIO TRANSMITTER BC-375-E', x + w / 2, y + 30, 17);
    for (let i = 0; i < 3; i++) drawGauge(g, x + 130 + i * 190, y + 130, 52, i === 1 ? 'tach' : 'pressure', ['PLATE CURRENT', 'ANTENNA CURRENT', 'FILAMENT'][i]);
    for (let i = 0; i < 4; i++) { knob(g, x + 100 + i * 145, y + 330, 42); label(g, ['MASTER OSC', 'P.A. TUNING', 'ANT. COUPLING', 'ANT. TUNING'][i], x + 100 + i * 145, y + 392, 12); }
    g.fillStyle = '#c9c2a8'; g.fillRect(x + 220, y + 430, 200, 46); label(g, 'TUNING UNIT TU-5-B', x + 320, y + 453, 14, '#1a1a1a'); }
  // a command set
  { const r = R.command, [x, y, w, h] = r; crackle(g, r, '#2a2b28');
    label(g, 'BC-453-B', x + w / 2, y + 26, 14);
    g.fillStyle = '#d8cfa8'; g.beginPath(); g.arc(x + w / 2, y + 130, 70, 0, 7); g.fill(); // its round tuning dial
    g.strokeStyle = '#222'; g.lineWidth = 1.5; for (let i = 0; i < 40; i++) { const a = (i / 40) * 6.283; g.beginPath(); g.moveTo(x + w / 2 + Math.cos(a) * 58, y + 130 + Math.sin(a) * 58); g.lineTo(x + w / 2 + Math.cos(a) * 68, y + 130 + Math.sin(a) * 68); g.stroke(); }
    knob(g, x + w / 2, y + 290, 34); label(g, 'TUNE', x + w / 2, y + 340, 12); }
  // the navigator's instrument board
  { const r = R.navPanel, [x, y, w, h] = r; crackle(g, r, '#1e1f1d');
    ['airspeed', 'altimeter', 'compass', 'clock', 'temp', 'gyro'].forEach((k, i) => drawGauge(g, x + 50 + (i % 3) * 160 + (i % 3) * 3, y + 70 + Math.floor(i / 3) * 110, 36, k, ['AIR SPEED', 'ALTIMETER', 'COMPASS', 'CLOCK', 'FREE AIR', 'RADIO COMPASS'][i])); }
  // the chart: the North Sea and the course to the target, pencilled
  { const [x, y, w, h] = R.chart;
    g.fillStyle = '#e9e1c5'; g.fillRect(x, y, w, h);
    g.fillStyle = '#c9d6c5'; g.beginPath(); g.moveTo(x, y + 80); g.bezierCurveTo(x + 200, y + 160, x + 140, y + 330, x, y + 420); g.closePath(); g.fill(); // England
    g.fillStyle = '#d8ccaa'; g.beginPath(); g.moveTo(x + w, y + 40); g.bezierCurveTo(x + 430, y + 180, x + 520, y + 300, x + 470, y + h); g.lineTo(x + w, y + h); g.closePath(); g.fill(); // the Continent
    g.strokeStyle = 'rgba(80,80,90,0.35)'; g.lineWidth = 1;
    for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(x + i * 64, y); g.lineTo(x + i * 64, y + h); g.stroke(); g.beginPath(); g.moveTo(x, y + i * 51); g.lineTo(x + w, y + i * 51); g.stroke(); }
    g.strokeStyle = '#33302a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x + 110, y + 260); g.lineTo(x + 330, y + 230); g.lineTo(x + 520, y + 300); g.lineTo(x + 560, y + 180); g.stroke();
    g.strokeStyle = '#a8281c'; g.lineWidth = 3; g.beginPath(); g.arc(x + 520, y + 300, 14, 0, 7); g.stroke();
    g.fillStyle = '#33302a'; g.font = 'italic 16px Georgia'; g.textAlign = 'left';
    g.fillText('I.P. 1102', x + 300, y + 220); g.fillText('TGT', x + 538, y + 318); g.fillText('ETA 1131', x + 470, y + 340);
    g.strokeStyle = '#555'; g.beginPath(); g.arc(x + 90, y + 450, 40, 0, 7); g.stroke(); label(g, 'N', x + 90, y + 400, 14, '#333'); }
  // the radio log
  { const [x, y, w, h] = R.log; g.fillStyle = '#ece6d2'; g.fillRect(x, y, w, h); g.fillStyle = '#7b7564';
    label(g, 'RADIO LOG', x + w / 2, y + 20, 13, '#333');
    for (let i = 0; i < 14; i++) { g.fillRect(x + 12, y + 44 + i * 19, w - 24, 1); if (i < 9) { g.fillStyle = '#2b3a6a'; g.font = '12px Courier'; g.textAlign = 'left'; g.fillText(`10${20 + i * 3}  QTE ${100 + i * 7}  R5`, x + 16, y + 40 + i * 19); g.fillStyle = '#7b7564'; } } }
  // a black nameplate for the sets' sides
  { const r = R.plate; crackle(g, r, '#2a2b28'); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** A flat face (w x h metres) showing atlas region `r`; build it facing +Z then place it. */
function face(r, w, h) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [x, y, rw, rh] = r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * rw) / AW, 1 - (y + (1 - uv.getY(i)) * rh) / AH);
  return g;
}

const std = (c, r = 0.7, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 0.25 });
const M = { atlas: null, set: std(0x2b2c29, 0.55, 0.35), green: std(0x4c5638, 0.75, 0.15), black: std(0x151515, 0.6, 0.2), steel: std(0x8f918a, 0.4, 0.7), brass: std(0xb08a3e, 0.4, 0.8), glass: null, cushion: leather(std(0x4a3222, 0.7)), wood: std(0x7a5f43, 0.7) };

/** it = the Interior; MAT its materials (for the planks). */
export function buildStations(it, MAT) {
  M.atlas ??= new THREE.MeshStandardMaterial({ map: atlas(), roughness: 0.6, metalness: 0.1, envMapIntensity: 0.2 });
  M.glass ??= new THREE.MeshStandardMaterial({ color: 0xc8d8d0, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false });
  const wallX = (z, y, inset) => it.hw(z, y) - inset;
  const add = (mat, geo) => it.add(mat, geo);

  // ======== the navigator (left side of the nose) ========
  const nf = -0.72;
  // his chart table: a wooden top with a lip, on a green frame with drawers under it
  add(MAT.floor, new THREE.BoxGeometry(0.42, 0.035, 0.57).translate(-0.75, 0.0, -9.125));
  for (const [dx, dz, w, d] of [[0, -0.29, 0.42, 0.015], [0, 0.29, 0.42, 0.015], [0.21, 0, 0.015, 0.57]]) add(M.green, new THREE.BoxGeometry(w, 0.05, d).translate(-0.75 + dx, 0.02, -9.125 + dz));
  add(M.green, new THREE.BoxGeometry(0.38, 0.5, 0.53).translate(-0.76, -0.27, -9.125));
  for (let i = 0; i < 3; i++) { add(M.black, new THREE.BoxGeometry(0.004, 0.012, 0.08).translate(-0.565, -0.12 - i * 0.15, -9.125)); add(M.set, new THREE.BoxGeometry(0.003, 0.13, 0.48).translate(-0.568, -0.12 - i * 0.15, -9.125)); }
  // the chart, a plotter, dividers and pencils on it
  add(M.atlas, face(R.chart, 0.4, 0.32).rotateX(-Math.PI / 2).rotateY(Math.PI / 2 + 0.06).translate(-0.75, 0.019, -9.12));
  add(M.glass, new THREE.BoxGeometry(0.003, 0.002, 0.3).translate(-0.7, 0.022, -9.05));
  it.rod([-0.66, 0.026, -9.25], [-0.8, 0.026, -9.3], 0.0025, M.steel); it.rod([-0.66, 0.026, -9.25], [-0.78, 0.026, -9.2], 0.0025, M.steel); // dividers
  it.rod([-0.62, 0.024, -8.95], [-0.74, 0.024, -8.99], 0.004, std(0xc8a032, 0.6)); // a yellow pencil
  // the astro compass on its stand at the table's corner
  it.cylinder(0.035, 0.05, -0.6, 0.045, -9.36, 'y', M.black, 16);
  add(M.glass, new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.6, 0.07, -9.36));
  for (const s of [-1, 1]) add(M.steel, new THREE.BoxGeometry(0.003, 0.06, 0.012).translate(-0.6 + s * 0.03, 0.1, -9.36));
  // the B-3 drift meter on the floor ahead of the table, its eyepiece angled up
  it.box(-0.5, -0.36, nf, nf + 0.05, -9.62, -9.48, M.black, false);
  it.cylinder(0.055, 0.45, -0.43, nf + 0.27, -9.55, 'y', M.set, 16);
  it.rod([-0.43, nf + 0.5, -9.55], [-0.38, nf + 0.62, -9.5], 0.025, M.black, 12);
  it.cylinder(0.03, 0.03, -0.43, nf + 0.4, -9.49, 'z', M.brass, 10);
  // his instrument board on the wall above the table, and his gooseneck lamp
  { const z = -9.05, y = 0.18, x = -wallX(z, y, 0.04);
    it.box(x - 0.025, x + 0.012, y - 0.13, y + 0.13, z - 0.22, z + 0.22, M.black, false);
    add(M.atlas, face(R.navPanel, 0.42, 0.21).rotateY(Math.PI / 2).translate(x + 0.013, y, z));
    const lx = -wallX(-9.32, 0.3, 0.03);
    it.box(lx - 0.01, lx + 0.02, 0.27, 0.33, -9.35, -9.29, M.black, false);
    const neck = new THREE.CatmullRomCurve3([[lx + 0.02, 0.3, -9.32], [lx + 0.12, 0.36, -9.3], [lx + 0.2, 0.3, -9.27], [lx + 0.22, 0.2, -9.25]].map((p) => new THREE.Vector3(...p)));
    add(M.black, new THREE.TubeGeometry(neck, 12, 0.007, 6));
    add(M.black, new THREE.ConeGeometry(0.04, 0.06, 12, 1, true).translate(lx + 0.22, 0.17, -9.25)); }
  // his swivel stool
  it.cylinder(0.02, 0.32, -0.42, nf + 0.16, -8.95, 'y', M.steel, 8);
  it.cylinder(0.12, 0.05, -0.42, nf + 0.34, -8.95, 'y', M.cushion, 16);

  // ======== the radio operator (left side of the radio room) ========
  const rf = -1.8;
  // his desk: a wooden top on a green frame
  add(MAT.floor, new THREE.BoxGeometry(0.6, 0.035, 0.72).translate(-0.71, -1.068, -2.15));
  add(M.green, new THREE.BoxGeometry(0.5, 0.7, 0.62).translate(-0.73, rf + 0.38, -2.15));
  // the BC-348 receiver on the desk, its face to the aisle
  { const x0 = -0.97, x1 = -0.62, y0 = -1.05, y1 = -0.75, z0 = -2.42, z1 = -1.94;
    it.box(Math.max(x0, -wallX(-2.18, -0.9, 0.02)), x1, y0, y1, z0, z1, M.set, false);
    add(M.atlas, face(R.receiver, z1 - z0, y1 - y0).rotateY(Math.PI / 2).translate(x1 + 0.002, (y0 + y1) / 2, (z0 + z1) / 2));
    // (on the drawn knobs: the face runs from z1 at its left edge, as you look at it)
    for (let i = 0; i < 6; i++) it.cylinder(i === 2 ? 0.02 : 0.014, 0.025, x1 + 0.012, y1 - (260 / 384) * (y1 - y0), z1 - ((70 + i * 100) / 640) * (z1 - z0), 'x', M.black, 12); }
  // the BC-375 transmitter on its shelf above
  { const y0 = -0.7, y1 = -0.3, z0 = -2.45, z1 = -1.95, x1 = -0.64, x0 = -wallX(-2.2, -0.5, 0.03);
    it.box(x0, x1 + 0.05, y0 - 0.025, y0, z0 - 0.02, z1 + 0.02, M.green, false);
    it.box(x0, x1, y0, y1, z0, z1, M.set, false);
    add(M.atlas, face(R.transmitter, z1 - z0, y1 - y0).rotateY(Math.PI / 2).translate(x1 + 0.002, (y0 + y1) / 2, (z0 + z1) / 2));
    for (let i = 0; i < 4; i++) it.cylinder(0.022, 0.03, x1 + 0.015, y1 - (330 / 512) * (y1 - y0), z1 - ((100 + i * 145) / 640) * (z1 - z0), 'x', M.black, 14);
    for (let i = 0; i < 4; i++) it.rod([x0 + 0.05, y1 - 0.02, z0 + 0.1 + i * 0.1], [x0 + 0.02, y1 + 0.2, z0 + 0.05 + i * 0.12], 0.008, M.black); } // cables up to the junction box
  // the Morse key, his log and headset on the desk
  it.box(-0.56, -0.47, -1.05, -1.035, -2.13, -2.06, M.black, false);
  it.rod([-0.55, -1.03, -2.095], [-0.47, -1.02, -2.095], 0.004, M.brass);
  it.add(M.black, new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10).translate(-0.47, -1.012, -2.095));
  add(M.atlas, face(R.log, 0.16, 0.2).rotateX(-Math.PI / 2).rotateY(Math.PI / 2 - 0.2).translate(-0.6, -1.049, -1.92));
  add(M.black, new THREE.TorusGeometry(0.075, 0.009, 5, 16, Math.PI).rotateY(Math.PI / 2).translate(-0.6, -0.97, -2.43));
  for (const s of [-1, 1]) it.cylinder(0.03, 0.02, -0.6, -1.04, -2.43 + s * 0.075, 'x', M.black, 12);
  // his chair: a leather seat and back on a post
  it.cylinder(0.025, 0.4, -0.68, rf + 0.2, -1.57, 'y', M.steel, 8);
  it.box(-0.84, -0.52, rf + 0.38, rf + 0.46, -1.73, -1.41, M.cushion, false);
  it.box(-0.84, -0.52, rf + 0.46, rf + 0.85, -1.43, -1.38, M.cushion, false);
  // the command sets on the far wall, with their faces
  for (let i = 0; i < 3; i++) {
    const z = -1.88 + i * 0.12, y = -1.07, x = wallX(z, y, 0.16);
    it.box(x - 0.09, x + 0.09, y - 0.13, y + 0.13, z - 0.055, z + 0.055, M.set, false);
    add(M.atlas, face(R.command, 0.105, 0.24).rotateY(-Math.PI / 2).translate(x - 0.092, y, z));
  }
  for (const m of Object.values(M)) insideLight(m);
}
