// The fighter pilot's cockpit, for flying a Bf 109, an Fw 190 or a P-51 in first person, built to the
// photographs of the real ones:
// - the fuselage round you as one shaped skin from the spinner to behind your head (painted outside in the
//   type's colours, the interior colour inside), its gun fairings shaped into the cowling (the 109G's
//   "Beulen", the Fw 190's MG 131 humps), the exhaust stubs, the wings with their airfoil and dihedral;
// - the canopy: the 109G's Erla Haube with its armoured head glass, the Fw 190's and P-51's bubbles, the
//   windscreens with their thick bulletproof glass, in box-section frames;
// - the instrument panel whose needles move with the real values (airspeed, altitude, climb, compass,
//   boost, rpm, oil and coolant), its bezels standing out of it, glowing at night; the coaming over it;
// - the gunsight (Revi 16B in the German fighters, the K-14's gyro box in the P-51), whose reticle
//   pilot.js puts on the guns' line;
// - the stick and throttle moving with your hands on them, your knees, the seat, the rudder pedals, the
//   side consoles (trim wheels, levers, switch panels, the Fw 190's breaker panel, the P-51's radio);
// - paint with wear and rivets (procedural textures); RLM 66 inside the German fighters, interior green
//   and black in the P-51.
// The aircraft models have no cockpit, so this is built here and shown in their place, round the pilot's
// eye. Everything that doesn't move is merged: one draw call per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wetGlass } from './environment.js';

/*
 * Each type, relative to the pilot's eye (x right, y up, -z ahead):
 * - eye: the eye in the model; prop: m ahead of the eye.
 * - body: the fuselage's stations [z, half width, top, widest at, bottom, sill?]; with a sill the top is
 *   open there (the cockpit). n: how square its sections are.
 * - bumps: fairings shaped into the skin [x, y, z, along, across, height].
 * - top / side / belly: paint colours, metal: bare metal (the P-51), glare: the P-51's olive drab panel.
 * - wing [y, span, root chord, tip chord, leading edge at the root, sweep of the leading edge].
 * - exhausts [x, y, z0, z1, n].
 */
const TYPES = {
  bf109: {
    eye: [0, 0.75, -0.8], prop: 3.3, n: 2.5, spinner: 0x1e2a1e, spiral: true,
    body: [[-3.3, 0.22, -0.44, -0.62, -0.84], [-3.05, 0.33, -0.31, -0.6, -0.98], [-2.6, 0.38, -0.25, -0.6, -1.08], [-1.9, 0.41, -0.21, -0.6, -1.15],
      [-1.1, 0.42, -0.19, -0.6, -1.18], [-0.62, 0.42, -0.165, -0.58, -1.2], [-0.5, 0.42, -0.16, -0.58, -1.2, -0.14], [0.6, 0.4, -0.1, -0.58, -1.15, -0.13],
      [0.72, 0.39, 0.06, -0.58, -1.12], [1.6, 0.32, -0.04, -0.55, -1.0], [2.6, 0.24, -0.12, -0.5, -0.88]],
    bumps: [[0.3, -0.27, -1.15, 0.36, 0.11, 0.075], [-0.3, -0.27, -1.15, 0.36, 0.11, 0.075]], // the "Beulen" over the MG 131s' breeches
    top: 0x50555a, side: 0x6f767c, belly: 0x9aa6b0, mottle: 0x5d6a52, metal: false,
    inside: 0x393c3f, panel: 0x2a2d2f, units: 'metric', canopy: 'erla', sight: 'revi',
    wing: [-1.2, 4.9, 1.95, 1.05, -1.25, 0.25], exhausts: [0.41, -0.66, -2.8, -1.85, 6],
  },
  fw190: {
    eye: [0, 0.86, -0.22], prop: 3.85, n: 2.05, spinner: 0x1e2a1e, spiral: true,
    body: [[-3.85, 0.6, -0.2, -0.78, -1.36], [-3.3, 0.64, -0.16, -0.78, -1.4], [-2.3, 0.63, -0.17, -0.78, -1.39], [-1.55, 0.56, -0.175, -0.74, -1.32],
      [-0.95, 0.49, -0.17, -0.7, -1.26], [-0.6, 0.46, -0.16, -0.68, -1.22], [-0.48, 0.46, -0.15, -0.68, -1.22, -0.14], [0.8, 0.43, -0.1, -0.66, -1.2, -0.12],
      [0.95, 0.42, 0.1, -0.66, -1.18], [1.8, 0.36, 0.0, -0.6, -1.05], [2.7, 0.27, -0.08, -0.55, -0.92]],
    bumps: [[0.12, -0.17, -1.3, 0.34, 0.085, 0.05], [-0.12, -0.17, -1.3, 0.34, 0.085, 0.05]], // the MG 131 humps on the upper cowl
    top: 0x4a4f55, side: 0x6a7178, belly: 0x9aa6b0, mottle: 0x58654e, metal: false,
    inside: 0x393c3f, panel: 0x262829, units: 'metric', canopy: 'fw', sight: 'revi', fan: true,
    wing: [-1.3, 5.2, 2.25, 1.15, -1.45, 0.3], exhausts: [0.58, -1.0, -2.15, -1.7, 4],
  },
  p51: {
    eye: [0, 0.85, -0.1], prop: 4.2, n: 2.6, spinner: 0xd8c030,
    body: [[-4.2, 0.22, -0.43, -0.66, -0.88], [-3.9, 0.33, -0.3, -0.66, -1.04], [-3.2, 0.39, -0.23, -0.66, -1.15], [-2.2, 0.41, -0.2, -0.66, -1.2],
      [-1.2, 0.42, -0.19, -0.66, -1.22], [-0.64, 0.42, -0.17, -0.66, -1.25], [-0.52, 0.42, -0.165, -0.66, -1.25, -0.15], [0.9, 0.41, -0.11, -0.66, -1.25, -0.15],
      [1.05, 0.4, -0.08, -0.66, -1.25], [2.0, 0.35, -0.13, -0.6, -1.3], [3.0, 0.27, -0.16, -0.55, -1.2]],
    bumps: [],
    top: 0xbfc4c8, side: 0xbfc4c8, belly: 0xb5babf, glare: 0x3f4430, metal: true,
    inside: 0x59653f, panel: 0x161616, units: 'imperial', canopy: 'bubble', sight: 'k14',
    wing: [-1.15, 5.4, 2.45, 1.05, -1.6, 0.18], exhausts: [0.405, -0.5, -3.25, -2.45, 6],
  },
};
const V2 = THREE.Vector2, V3 = THREE.Vector3;
const PANEL_W = 1024, PANEL_H = 420; // canvas pixels for the panel (0.7 m x 0.29 m)
const PW = 0.7, PH = 0.287; // the panel, m

/** The panel's dials for each type: [x, y, r, gauge] in canvas pixels. */
const LAYOUT = {
  metric: [[150, 120, 92, 'speed'], [355, 120, 92, 'alt'], [560, 120, 92, 'horizon'], [765, 120, 92, 'climb'], [920, 210, 70, 'compass'],
    [150, 320, 70, 'boost'], [310, 320, 70, 'rpm'], [470, 320, 62, 'oil'], [620, 320, 62, 'coolant'], [775, 330, 62, 'fuel']],
  imperial: [[150, 120, 92, 'speed'], [355, 120, 92, 'horizon'], [560, 120, 92, 'alt'], [765, 120, 92, 'climb'], [920, 210, 70, 'compass'],
    [150, 320, 70, 'boost'], [310, 320, 70, 'rpm'], [470, 320, 62, 'coolant'], [620, 320, 62, 'oil'], [775, 330, 62, 'fuel']],
};

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** Draws the panel's dials into a canvas, with the needles where the values say. */
class PanelArt {
  constructor(type) {
    this.type = type;
    this.c = document.createElement('canvas');
    this.c.width = PANEL_W; this.c.height = PANEL_H;
    this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.bg = this.background();
  }

  /** The panel itself, drawn once: worn paint, its screws and seams, switches, placards and labels. */
  background() {
    const c = document.createElement('canvas'), T = this.type, metric = T.units === 'metric';
    c.width = PANEL_W; c.height = PANEL_H;
    const g = c.getContext('2d'), r = rng(7), pc = new THREE.Color(T.panel);
    g.fillStyle = `rgb(${pc.r * 255 | 0},${pc.g * 255 | 0},${pc.b * 255 | 0})`;
    g.fillRect(0, 0, PANEL_W, PANEL_H);
    for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? '#ffffff06' : '#00000010'; g.fillRect(r() * PANEL_W, r() * PANEL_H, 2 + r() * 3, 2 + r() * 3); } // the paint's grain
    g.strokeStyle = '#ffffff1a'; g.lineWidth = 1.5; // worn edges and scuffs
    for (let i = 0; i < 60; i++) { const x = r() * PANEL_W, y = r() < 0.5 ? r() * 18 : PANEL_H - r() * 18; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + r() * 30, y + (r() - 0.5) * 4); g.stroke(); }
    // the panel's seams (the shock-mounted centre section) and its screws
    g.strokeStyle = '#00000080'; g.lineWidth = 2;
    g.strokeRect(40, 22, 840, 380);
    for (let x = 52; x < 880; x += 72) for (const y of [32, 392]) this.screw(g, x, y, 4);
    for (const [x, y] of [[14, 14], [PANEL_W - 14, 14], [14, PANEL_H - 14], [PANEL_W - 14, PANEL_H - 14]]) this.screw(g, x, y, 6);
    // toggle switches and a magneto switch, right of the dials
    for (let k = 0; k < 4; k++) { const x = 900 + (k % 2) * 46, y = 300 + Math.floor(k / 2) * 52; this.screw(g, x, y, 9, '#444'); g.strokeStyle = '#ccc'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y - 18); g.stroke(); }
    g.fillStyle = '#111'; g.beginPath(); g.arc(860, 70, 26, 0, 7); g.fill(); g.fillStyle = '#ddd'; g.fillRect(856, 46, 8, 28); // the magneto switch
    g.fillStyle = '#c9c2a8'; g.font = '600 13px "Courier New", monospace'; g.textAlign = 'center';
    g.fillText(metric ? 'ZÜNDUNG' : 'IGNITION', 860, 112);
    // the placards, white on the paint
    const plate = (x, y, w, text) => { g.fillStyle = '#d8d2bc'; g.fillRect(x, y, w, 20); g.fillStyle = '#1a1a1a'; g.font = '700 12px "Courier New", monospace'; g.textAlign = 'center'; g.fillText(text, x + w / 2, y + 14); };
    plate(820, 392 - 22, 190, metric ? 'NICHT RAUCHEN' : 'DO NOT EXCEED 505 MPH');
    if (metric) plate(40, 4, 230, 'C 3 KRAFTSTOFF 96 OKT'); else plate(40, 4, 210, 'USE 100/130 GRADE FUEL');
    return c;
  }

  screw(g, x, y, r, col = '#55585a') {
    g.fillStyle = '#0008'; g.beginPath(); g.arc(x + 1, y + 1, r, 0, 7); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = Math.max(1, r * 0.3); g.beginPath(); g.moveTo(x - r * 0.7, y); g.lineTo(x + r * 0.7, y); g.stroke();
  }

  draw(s) {
    const g = this.g, T = this.type, metric = T.units === 'metric';
    g.drawImage(this.bg, 0, 0);
    for (const [cx, cy, r, kind] of LAYOUT[T.units]) this.dial(cx, cy, r, kind, s, metric);
    this.tex.needsUpdate = true;
  }

  /** One gauge: its mounting flange and screws, a black face, a white scale with its numbers, the needle, the glass's glint. */
  dial(cx, cy, r, kind, s, metric) {
    const g = this.g;
    g.save(); g.translate(cx, cy);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.screw(g, a * (r + 4) * 0.84, b * (r + 4) * 0.84, Math.max(3, r * 0.055), '#3c3f41');
    const bez = g.createLinearGradient(0, -r - 8, 0, r + 8); bez.addColorStop(0, '#5a5d60'); bez.addColorStop(0.5, '#262829'); bez.addColorStop(1, '#151617');
    g.fillStyle = bez; g.beginPath(); g.arc(0, 0, r + 8, 0, 7); g.fill(); // the bezel
    g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.strokeStyle = '#e8e2cc'; g.fillStyle = '#e8e2cc'; g.lineCap = 'round';
    const scale = (min, max, a0, a1, major, minor, label, fmt = (v) => v) => {
      for (let v = min; v <= max + 1e-6; v += minor) {
        const a = a0 + ((v - min) / (max - min)) * (a1 - a0), big = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
        g.lineWidth = big ? 3 : 1.5;
        g.beginPath(); g.moveTo(Math.cos(a) * r * (big ? 0.76 : 0.84), Math.sin(a) * r * (big ? 0.76 : 0.84)); g.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94); g.stroke();
        if (big) { g.font = `600 ${Math.round(r * 0.19)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(fmt(v), Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58); }
      }
      g.font = `600 ${Math.round(r * 0.14)}px system-ui`; g.textAlign = 'center'; g.fillText(label, 0, r * 0.42);
    };
    const needle = (a, len = 0.82, w = 4) => {
      g.save(); g.rotate(a); g.fillStyle = '#f0ead6';
      g.beginPath(); g.moveTo(-r * 0.12, -w / 2); g.lineTo(r * len, -1); g.lineTo(r * len, 1); g.lineTo(-r * 0.12, w / 2); g.fill();
      g.restore(); g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, r * 0.08, 0, 7); g.fill(); g.fillStyle = '#e8e2cc';
    };
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25; // a 270 degree dial from bottom left
    const at = (v, min, max) => A0 + (THREE.MathUtils.clamp(v, min, max) - min) / (max - min) * (A1 - A0);
    switch (kind) {
      case 'speed': {
        const v = metric ? s.speed * 3.6 : s.speed * 2.237, max = metric ? 750 : 500;
        scale(0, max, A0, A1, metric ? 100 : 50, metric ? 25 : 10, metric ? 'km/h' : 'MPH');
        needle(at(v, 0, max)); break;
      }
      case 'alt': { // two needles: thousands and hundreds
        const v = metric ? s.alt / 1000 : s.alt * 3.281 / 1000; // km or thousands of feet
        scale(0, 10, -Math.PI / 2, Math.PI * 1.5 - 0.0001, 1, 0.5, metric ? 'km' : 'ALT x1000', (x) => (x < 10 ? x : ''));
        needle(-Math.PI / 2 + (v % 10) / 10 * Math.PI * 2, 0.55, 6);
        needle(-Math.PI / 2 + (v * 10 % 10) / 10 * Math.PI * 2, 0.86, 3); break;
      }
      case 'climb': {
        const v = s.climb, max = metric ? 30 : 6; // m/s, or thousands of ft/min
        scale(-max, max, Math.PI * 0.9, Math.PI * 2.1, metric ? 10 : 2, metric ? 5 : 1, metric ? 'm/s' : 'CLIMB', (x) => Math.abs(x));
        needle(Math.PI * 1.5 + THREE.MathUtils.clamp(metric ? v : v * 196.85 / 1000, -max, max) / max * Math.PI * 0.6); break;
      }
      case 'boost': {
        const v = metric ? 0.6 + s.throttle * 0.82 : 15 + s.throttle * 46; // ata, or inches of mercury
        const [min, max] = metric ? [0.6, 1.8] : [10, 75];
        scale(min, max, A0, A1, metric ? 0.2 : 10, metric ? 0.1 : 5, metric ? 'ata' : 'MAN. PRESS', (x) => (metric ? x.toFixed(1) : x));
        needle(at(v, min, max)); break;
      }
      case 'rpm': {
        const v = 1400 + s.throttle * 1400 + (s.speed - 120) * 2;
        scale(0, 36, A0, A1, 4, 2, 'U/min x100'.replace('U/min', metric ? 'U/min' : 'RPM'));
        needle(at(v / 100, 0, 36)); break;
      }
      case 'oil': case 'coolant': {
        const hot = kind === 'oil' ? 50 + s.heat * 25 + s.throttle * 25 : 70 + s.heat * 15 + s.throttle * 30 + (s.damage ? 25 : 0);
        scale(0, 130, A0, A1, 20, 10, kind === 'oil' ? (metric ? 'Öl °C' : 'OIL °C') : (metric ? 'Kühl °C' : 'COOLANT'));
        needle(at(hot, 0, 130)); break;
      }
      case 'fuel': {
        scale(0, 400, A0, A1, 100, 50, metric ? 'Liter' : 'GAL x2');
        needle(at(400 - s.time * 0.4, 0, 400)); break;
      }
      case 'compass': {
        g.save(); g.rotate(-s.heading); // the card turns
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2 - Math.PI / 2;
          g.lineWidth = k % 3 ? 1.5 : 3;
          g.beginPath(); g.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78); g.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94); g.stroke();
          if (k % 9 === 0) { g.font = `700 ${Math.round(r * 0.24)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NOSW'[k / 9], Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56); }
        }
        g.restore();
        g.strokeStyle = '#ff9a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -r); g.lineTo(0, -r * 0.7); g.stroke(); break;
      }
      case 'horizon': { // the artificial horizon: sky over earth, rolled and pitched
        g.save(); g.beginPath(); g.arc(0, 0, r * 0.94, 0, 7); g.clip();
        g.rotate(-s.bank);
        const p = THREE.MathUtils.clamp(s.pitch, -0.6, 0.6) * r * 1.4;
        g.fillStyle = '#3d5f86'; g.fillRect(-r, -r * 2 + p, r * 2, r * 2);
        g.fillStyle = '#4a3b2a'; g.fillRect(-r, p, r * 2, r * 2);
        g.strokeStyle = '#eee'; g.lineWidth = 2; g.beginPath(); g.moveTo(-r, p); g.lineTo(r, p); g.stroke();
        for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.moveTo(-r * 0.2, p - k * r * 0.25); g.lineTo(r * 0.2, p - k * r * 0.25); g.stroke(); }
        g.restore();
        g.strokeStyle = '#ffb040'; g.lineWidth = 4; // the little aeroplane
        g.beginPath(); g.moveTo(-r * 0.5, 0); g.lineTo(-r * 0.15, 0); g.lineTo(0, r * 0.1); g.lineTo(r * 0.15, 0); g.lineTo(r * 0.5, 0); g.stroke();
        break;
      }
      default: break;
    }
    // the glass over it: a soft glint across the top
    const gl = g.createLinearGradient(-r, -r, r * 0.3, r * 0.2); gl.addColorStop(0, '#ffffff22'); gl.addColorStop(0.45, '#ffffff08'); gl.addColorStop(0.5, '#ffffff00');
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.restore();
  }
}

// ---------- the procedural textures: worn paint (colour and roughness) and the skin's rivets and panel lines

let WEAR = null, RIVETS = null;
/** Paint wear: grime and lighter chips (a multiplier for the colour; also the roughness). Made once. */
function wearTex() {
  if (WEAR) return WEAR;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) { const x = r() * 512, y = r() * 512, rr = 10 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(0,0,0,${0.05 + r() * 0.08})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); } // grime
  for (let i = 0; i < 14000; i++) { const v = 200 + r() * 55 | 0; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(r() * 512, r() * 512, 1.5, 1.5); } // grain
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineCap = 'round'; // chips and scratches down to the primer
  for (let i = 0; i < 180; i++) { const x = r() * 512, y = r() * 512; g.lineWidth = 0.6 + r() * 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 26, y + (r() - 0.5) * 8); g.stroke(); }
  WEAR = new THREE.CanvasTexture(c);
  WEAR.wrapS = WEAR.wrapT = THREE.RepeatWrapping; WEAR.colorSpace = THREE.SRGBColorSpace; WEAR.anisotropy = 4;
  return WEAR;
}
/** The skin's rivet rows and panel lines (a bump map): 0.5 m square tiles. */
function rivetTex() {
  if (RIVETS) return RIVETS;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256); // the panel joints
  g.fillStyle = '#a8a8a8';
  for (let k = 6; k < 256; k += 9) { g.beginPath(); g.arc(k, 7, 1.6, 0, 7); g.fill(); g.beginPath(); g.arc(7, k, 1.6, 0, 7); g.fill(); g.beginPath(); g.arc(k, 128, 1.4, 0, 7); g.fill(); } // rows of rivets
  RIVETS = new THREE.CanvasTexture(c);
  RIVETS.wrapS = RIVETS.wrapT = THREE.RepeatWrapping; RIVETS.anisotropy = 4;
  return RIVETS;
}

// ---------- geometry helpers

/** Bring a geometry to the shared layout (non-indexed, position, normal, uv, and colour if wanted) so it can be merged. */
function tidy(geo, colour) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (colour && !g.attributes.color) { const c = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  if (!colour && g.attributes.color) g.deleteAttribute('color');
  return g;
}

/** A box-section bar from a to b (w across, d deep), its depth turned towards `out`. */
function barGeo(a, b, w, d, out = new V3(0, 1, 0)) {
  const dir = new V3().subVectors(b, a), len = dir.length();
  const geo = new THREE.BoxGeometry(w, d, len + w * 0.5);
  const z = dir.normalize(), x = new V3().crossVectors(out, z).normalize();
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  const y = new V3().crossVectors(z, x);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(a.clone().add(b).multiplyScalar(0.5)));
  return geo;
}

/** A flat pane through four corners (two triangles), its uv across it. */
function quadGeo(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((p) => p.toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  g.computeVertexNormals();
  return g;
}

/**
 * The fuselage: superelliptic sections through the stations, open over the cockpit where a station has a
 * sill, with fairings pushed out of it. uv: metres (so the textures tile at their real size); colours:
 * the paint (top / side / belly, the P-51's glare panel).
 */
function fuselageGeo(T) {
  const N = 48, n = T.n, pos = [], uv = [], col = [], idx = [];
  const top = new THREE.Color(T.top), side = new THREE.Color(T.side), belly = new THREE.Color(T.belly), glare = T.glare ? new THREE.Color(T.glare) : null, mottle = T.mottle ? new THREE.Color(T.mottle) : null;
  const pe = (v, e) => Math.sign(v) * Math.abs(v) ** e;
  const at = (st, th) => { // the section's point at angle th (0 = top, clockwise seen from behind)
    const [, w, yt, ym, yb] = st, s = Math.sin(th), c = Math.cos(th);
    return [w * pe(s, 2 / n), c >= 0 ? ym + (yt - ym) * Math.abs(c) ** (2 / n) : ym - (ym - yb) * Math.abs(c) ** (2 / n)];
  };
  const r = rng(3);
  // over the cockpit the sections are drawn whole (topped like the decking behind it), and the skin above
  // the sill is left out there: the cockpit's opening
  const last = T.body.findLastIndex((st) => st.length > 5), rearTop = T.body[last + 1][2];
  const sillY = T.body[last][5], opens = T.body.map((st) => st.length > 5);
  T.body.forEach((st0, i) => {
    const st = opens[i] ? [st0[0], st0[1], rearTop, st0[3], st0[4]] : st0, [z, , yt, ym] = st;
    let along = 0, prev = null;
    for (let k = 0; k <= N; k++) {
      const th = (k / N) * Math.PI * 2;
      let [x, y] = at(st, th);
      for (const [bx, by, bz, bl, bw, bh] of T.bumps) { // the fairings, out along the section's normal
        const f = bh * Math.exp(-(((z - bz) / bl) ** 2) - ((x - bx) ** 2 + (y - by) ** 2) / (bw * bw));
        if (f > 1e-4) { const nx = x, ny = y - ym, l = Math.hypot(nx, ny) || 1; x += (nx / l) * f; y += (ny / l) * f; }
      }
      if (opens[i]) y = Math.min(y, sillY); // (the open sections end at the sill)
      if (prev) along += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
      pos.push(x, y, z); uv.push(along / 0.5, z / 0.5);
      const h = (y - ym) / Math.max(0.01, yt - ym); // the paint: top colour above, belly below, blended on the sides
      const c = h > 0.35 ? top.clone().lerp(side, THREE.MathUtils.clamp((0.8 - h) / 0.45, 0, 1)) : side.clone().lerp(belly, THREE.MathUtils.clamp((0.1 - h) / 0.4, 0, 1));
      if (mottle && h > -0.1 && h < 0.6 && r() < 0.35) c.lerp(mottle, 0.35); // the 109's and 190's mottling down the sides
      if (glare && Math.abs(x) < 0.2 && h > 0.85 && z < -0.55) c.copy(glare); // the P-51's anti-glare panel ahead of the windscreen
      col.push(c.r, c.g, c.b);
    }
    if (i) for (let k = 0; k < N; k++) {
      const a = (i - 1) * (N + 1) + k, b = a + N + 1;
      // (the opening: up to the last open station, the skin above the sill isn't there)
      if (opens[i] && opens[i - 1] && Math.min(pos[a * 3 + 1], pos[(a + 1) * 3 + 1], pos[b * 3 + 1], pos[(b + 1) * 3 + 1]) > sillY - 1e-4) continue;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tapered wing with a real airfoil (12 % thick at the root, 9 % at the tip) and 6 degrees of dihedral, out to one side. */
function wingGeo(T, s) {
  const [wy, span, root, tip, le, sweep] = T.wing, M = 24, pos = [], uv = [], col = [], idx = [];
  const topC = new THREE.Color(T.top), botC = new THREE.Color(T.belly);
  const foil = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const sections = [[0.36, root, le, 0.12], [span, tip, le + sweep, 0.09]];
  sections.forEach(([x, chord, z0, t], j) => {
    const y0 = wy + (x - 0.36) * Math.tan(THREE.MathUtils.degToRad(6));
    for (let k = 0; k <= M; k++) { // round the airfoil: along the top from the trailing edge, back along the bottom
      const u = k / M, a = u < 0.5 ? 1 - u * 2 : (u - 0.5) * 2, xc = (1 - Math.cos(a * Math.PI)) / 2, up = u < 0.5 ? 1 : -1;
      pos.push(s * x, y0 + up * foil(xc, t) * chord, z0 + xc * chord); uv.push(z0 / 0.5 + xc * chord / 0.5, x / 0.5);
      const c = up > 0 ? topC : botC; col.push(c.r, c.g, c.b);
    }
    if (j) for (let k = 0; k < M; k++) { const a = k, b = M + 1 + k; if (s > 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A bubble canopy's glass: from the sill on one side over to the other, its height along it given by top(z). */
function bubbleGeo(z0, z1, w, sill, top, M = 18, K = 16) {
  const pos = [], idx = [];
  for (let j = 0; j <= K; j++) {
    const z = z0 + (j / K) * (z1 - z0), h = top(z), ww = w(z);
    for (let k = 0; k <= M; k++) { const a = -Math.PI / 2 + (k / M) * Math.PI; pos.push(ww * Math.sin(a), sill + (h - sill) * Math.cos(a) ** 0.8, z); }
    if (j) for (let k = 0; k < M; k++) { const a = (j - 1) * (M + 1) + k, b = a + M + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A gloved hand, closed round a grip: a palm, a thumb and the curl of the fingers. */
function hand(mat) {
  const g = mergeGeometries([
    new THREE.BoxGeometry(0.085, 0.045, 0.1),
    new THREE.CapsuleGeometry(0.022, 0.07, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.02, -0.055),
    new THREE.CapsuleGeometry(0.014, 0.04, 3, 6).rotateX(0.8).translate(-0.05, 0.02, -0.02),
    new THREE.CapsuleGeometry(0.035, 0.12, 3, 8).rotateX(Math.PI / 2).translate(0, -0.005, 0.12), // the cuff and sleeve
  ].map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; }));
  return new THREE.Mesh(g, mat);
}

/** The cockpit for one type; call .userData.update(state) every frame (cockpit.js manages its own refresh rate). */
export function buildCockpit(kind) {
  const T = TYPES[kind];
  const root = new THREE.Group();
  root.matrixAutoUpdate = false; // placed on the fighter each frame (pilot.js)
  const g = new THREE.Group(); // everything below is relative to the eye
  g.position.fromArray(T.eye);
  root.add(g);
  const wear = wearTex(), rivets = rivetTex();
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, map: wear, bumpMap: rivets, bumpScale: 0.6, roughness: T.metal ? 0.38 : 0.62, metalness: T.metal ? 0.75 : 0.15, side: THREE.FrontSide });
  const inside = new THREE.MeshStandardMaterial({ color: T.inside, map: wear, roughnessMap: wear, bumpMap: rivets, bumpScale: 0.35, roughness: 0.85, metalness: 0.2, side: THREE.BackSide });
  const paint = new THREE.MeshStandardMaterial({ color: T.inside, map: wear, roughness: 0.8, metalness: 0.2 }); // the interior's fittings
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, map: wear, roughness: 0.65, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a6d70, roughness: 0.4, metalness: 0.85 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85 });
  const suit = new THREE.MeshStandardMaterial({ color: kind === 'p51' ? 0x5a5040 : 0x3e3a30, roughness: 0.95 });
  const exhaust = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.9, metalness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.6 });
  const frameOut = new THREE.MeshStandardMaterial({ color: T.metal ? 0x9da2a6 : T.top, map: wear, roughness: T.metal ? 0.35 : 0.6, metalness: T.metal ? 0.75 : 0.25 });
  const glass = wetGlass(new THREE.MeshPhysicalMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.06, roughness: 0.03, depthWrite: false, side: THREE.DoubleSide }));
  // thick bulletproof glass: through its faces nearly clear (a faint sheen), green only along its edges,
  // where you look through the whole slab of it edge-on
  const armour = wetGlass(new THREE.MeshPhysicalMaterial({ color: 0xe4efe8, transparent: true, opacity: 0.045, roughness: 0.02, depthWrite: false, side: THREE.DoubleSide }));
  const armourEdge = new THREE.MeshPhysicalMaterial({ color: 0x4d6b5c, transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false });

  // the static parts, by material, merged at the end
  const parts = new Map();
  const _o = new THREE.Object3D();
  const put = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.set(sx, sy, sz); _o.updateMatrix();
    const gg = geo.clone().applyMatrix4(_o.matrix);
    (parts.get(mat) ?? parts.set(mat, []).get(mat)).push(gg);
    return gg;
  };
  const putM = (mat, geo, m) => { (parts.get(mat) ?? parts.set(mat, []).get(mat)).push(geo.clone().applyMatrix4(m)); };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r0, r1, h, s = 12) => new THREE.CylinderGeometry(r0, r1, h, s);
  const P = (x, y, z) => new V3(x, y, z);
  const bar = (mat, a, b, w = 0.03, d = 0.04, out) => putM(mat, barGeo(a, b, w, d, out), new THREE.Matrix4());
  // a slab of bulletproof glass w x h x d, placed by m: its two faces, and its four edges (the green of it)
  const slab = (w, h, d, m) => {
    for (const s of [-1, 1]) putM(armour, new THREE.PlaneGeometry(w, h).translate(0, 0, s * d / 2), m);
    for (const s of [-1, 1]) { putM(armourEdge, box(w, 0.005, d).translate(0, s * (h / 2 - 0.0025), 0), m); putM(armourEdge, box(0.005, h, d).translate(s * (w / 2 - 0.0025), 0, 0), m); }
  };
  const widthAt = (z) => { const b = T.body; for (let i = 1; i < b.length; i++) if (z <= b[i][0]) { const k = (z - b[i - 1][0]) / (b[i][0] - b[i - 1][0]); return b[i - 1][1] + (b[i][1] - b[i - 1][1]) * k; } return b[b.length - 1][1]; };
  const open = T.body.filter((s) => s.length > 5), sill = open[0][5], z0 = open[0][0], z1 = open[open.length - 1][0];

  // ---- outside: the fuselage skin (painted outside, the interior colour inside), spinner, propeller blur, exhausts, wings
  const body = fuselageGeo(T);
  putM(skin, body, new THREE.Matrix4());
  putM(inside, tidy(body.clone(), false), new THREE.Matrix4());
  const front = T.body[0], cy = front[3], prop = -T.prop;
  const spinner = new THREE.MeshStandardMaterial({ color: T.spinner, roughness: 0.45, metalness: 0.3, map: T.spiral ? spiralTex() : null });
  put(spinner, new THREE.SphereGeometry(front[1] * 0.95, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 2.1), 0, cy, prop + 0.05);
  if (T.fan) { // the Fw 190's cooling fan behind the spinner, in the cowl's open front
    put(black, new THREE.CircleGeometry(front[1] * 0.98, 32), 0, cy, front[0] + 0.12);
    for (let k = 0; k < 12; k++) put(steel, box(0.05, front[1] * 0.85, 0.01), 0, cy, front[0] + 0.1, 0, 0.5, (k / 12) * Math.PI * 2);
  }
  const blur = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.RingGeometry(front[1] * 0.6, 1.6, 48), blur);
  disc.position.set(0, cy, prop - 0.05); g.add(disc);
  { // the exhaust stubs down both sides of the cowl
    const [ex, ey, ea, eb, en] = T.exhausts;
    for (const s of [-1, 1]) for (let k = 0; k < en; k++) {
      const z = ea + (k / Math.max(1, en - 1)) * (eb - ea);
      put(exhaust, box(0.07, 0.05, 0.085), s * ex, ey, z, 0.25, 0, s * -0.35);
      put(black, box(0.05, 0.03, 0.03), s * (ex + 0.035), ey - 0.01, z + 0.03, 0.25, 0, s * -0.35); // (its sooty mouth)
    }
  }
  for (const s of [-1, 1]) putM(skin, wingGeo(T, s), new THREE.Matrix4());

  // ---- the tub: ribs and stringers on the walls, the floor, the canopy rails on the sills, the seat and the
  // armour behind it, the rudder pedals
  const wall = (z) => widthAt(z) - 0.03;
  for (const z of [z0 + 0.12, -0.15, 0.2, z1 - 0.1]) for (const s of [-1, 1]) put(paint, box(0.025, 0.75, 0.035), s * (wall(z) - 0.01), sill - 0.42, z);
  for (const y of [sill - 0.25, sill - 0.6]) for (const s of [-1, 1]) put(paint, box(0.02, 0.025, z1 - z0), s * (wall(0) - 0.012), y, (z0 + z1) / 2);
  put(paint, box(0.66, 0.03, 1.5), 0, -1.08, -0.2);
  for (const s of [-1, 1]) { // the canopy rails, box section along the sills
    put(frameOut, box(0.05, 0.032, z1 - z0 + 0.05), s * (widthAt(0) - 0.02), sill + 0.012, (z0 + z1) / 2);
    put(black, box(0.012, 0.012, z1 - z0), s * (widthAt(0) - 0.05), sill + 0.02, (z0 + z1) / 2); // (the rail's track)
  }
  // the seat: a pressed bucket, the cushion of the parachute pack in it, and the armour plate behind
  const seatZ = kind === 'p51' ? 0.38 : 0.32;
  put(paint, new THREE.CylinderGeometry(0.24, 0.22, 0.5, 18, 1, true, -Math.PI * 0.55, Math.PI * 1.1).rotateY(Math.PI), 0, -0.72, seatZ, 0, 0, 0, 1, 1, 0.55);
  put(paint, box(0.44, 0.03, 0.4), 0, -0.98, seatZ - 0.15);
  put(leather, box(0.38, 0.09, 0.34), 0, -0.92, seatZ - 0.14);
  put(steel, box(0.46, 0.62, 0.012), 0, -0.6, seatZ + 0.15, 0.08);
  for (const s of [-1, 1]) { // the rudder pedals, their straps
    put(black, box(0.1, 0.16, 0.025), s * 0.15, -1.0, -0.88, 0.35);
    put(leather, box(0.105, 0.025, 0.035), s * 0.15, -0.98, -0.87, 0.35);
    put(paint, cyl(0.012, 0.012, 0.3, 8), s * 0.15, -1.03, -0.72, Math.PI / 2 - 0.2);
  }

  // ---- the side consoles
  for (const s of [-1, 1]) put(paint, box(0.12, 0.05, 0.75), s * (wall(-0.1) - 0.07), sill - 0.36, -0.15);
  const wheel = (x, y, z, r, mat = black) => { // a trim wheel turned edge-on to you, with spokes and a white index
    put(mat, new THREE.TorusGeometry(r, r * 0.12, 8, 28), x, y, z, 0, Math.PI / 2, 0);
    for (let k = 0; k < 4; k++) put(mat, box(0.006, r * 2, r * 0.12), x, y, z, (k / 4) * Math.PI, 0, 0);
    put(white, box(0.004, r * 0.25, r * 0.12), x + 0.006, y + r * 0.88, z);
  };
  const switches = (x, y, z, cols, rows, mat = steel) => { for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { put(black, cyl(0.009, 0.009, 0.012, 8), x + i * 0.028, y, z + j * 0.035); put(mat, cyl(0.003, 0.004, 0.035, 6), x + i * 0.028, y + 0.017, z + j * 0.035, -0.3); } };
  const L = -(wall(-0.1) - 0.07), R = -L, top = sill - 0.33;
  if (kind === 'bf109') {
    // the 109's two big trim wheels on the left wall (tailplane trim and the flaps), side by side
    wheel(L - 0.04, top - 0.12, 0.05, 0.13); wheel(L - 0.01, top - 0.12, 0.2, 0.11);
    put(paint, box(0.08, 0.1, 0.24), L, top - 0.02, -0.3); // the throttle quadrant
    put(steel, cyl(0.025, 0.025, 0.02, 14), L + 0.02, top + 0.03, -0.42, 0, 0, Math.PI / 2); // the fuel cock
    put(paint, box(0.1, 0.11, 0.18), R, top, -0.32); // the electrics: switches and breakers
    switches(R - 0.04, top + 0.06, -0.39, 3, 3);
    put(black, cyl(0.045, 0.045, 0.06, 18), R - 0.02, top + 0.03, 0.02); put(white, cyl(0.035, 0.035, 0.002, 18), R - 0.02, top + 0.061, 0.02); // the oxygen regulator
  } else if (kind === 'fw190') {
    put(paint, box(0.1, 0.09, 0.26), L, top - 0.02, -0.3);
    put(steel, box(0.02, 0.03, 0.08), L + 0.03, top + 0.04, -0.4); // the trim switch
    // the Fw 190's breaker panel on the right console: rows of white-capped buttons
    put(black, box(0.12, 0.04, 0.3), R, top + 0.01, -0.2);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 7; j++) put(white, cyl(0.008, 0.008, 0.012, 8), R - 0.035 + i * 0.035, top + 0.036, -0.33 + j * 0.038);
    switches(R - 0.03, top + 0.03, 0.02, 2, 2);
  } else {
    // the P-51: throttle quadrant (throttle, prop, mixture), the trim tab wheels (elevator, rudder, aileron), the radio
    put(paint, box(0.1, 0.1, 0.28), L, top - 0.02, -0.3);
    for (let k = 0; k < 2; k++) put(steel, cyl(0.006, 0.008, 0.12, 6), L + 0.01 + k * 0.025, top + 0.07, -0.38 + k * 0.03, -0.4);
    for (let k = 0; k < 2; k++) put(red, new THREE.SphereGeometry(0.015, 8, 6), L + 0.01 + k * 0.025, top + 0.12, -0.4 + k * 0.03);
    wheel(L - 0.02, top - 0.06, 0.06, 0.07); wheel(L - 0.01, top - 0.04, 0.17, 0.05); put(black, cyl(0.04, 0.04, 0.02, 16), L + 0.02, top + 0.02, 0.24);
    put(black, box(0.11, 0.09, 0.2), R, top + 0.02, -0.3); // the SCR-522 radio's control box
    for (let k = 0; k < 4; k++) put(white, box(0.02, 0.012, 0.025), R - 0.03 + k * 0.022, top + 0.07, -0.36);
    switches(R - 0.03, top + 0.03, 0.0, 3, 2);
  }

  // ---- the instrument panel: its face drawn live (PanelArt), on a deep panel with the bezels standing out
  // of it, under the coaming, glowing at night
  const art = new PanelArt(T);
  const panelMat = new THREE.MeshStandardMaterial({ map: art.tex, emissiveMap: art.tex, emissive: 0x000000, roughness: 0.55, metalness: 0.2 });
  const PY = -0.36, PZ = -0.62, TILT = -0.12;
  const pm = new THREE.Matrix4().compose(P(0, PY, PZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT, 0, 0)), new V3(1, 1, 1));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), panelMat);
  panel.position.set(0, PY, PZ); panel.rotation.x = TILT;
  g.add(panel);
  const panelBack = new THREE.MeshStandardMaterial({ color: T.panel, map: wear, roughness: 0.7, metalness: 0.2 });
  putM(panelBack, box(PW + 0.04, PH + 0.03, 0.04).translate(0, 0, -0.022), pm);
  for (const [cx, cy2, r] of LAYOUT[T.units]) { // the bezels, out of the panel
    const x = (cx / PANEL_W - 0.5) * PW, y = (0.5 - cy2 / PANEL_H) * PH, rr = ((r + 8) / PANEL_W) * PW;
    putM(black, new THREE.TorusGeometry(rr, 0.0045, 6, 32).scale(1, 1, 1.6).translate(x, y, 0.004), pm);
  }
  // the coaming: a hood over the panel, its padded lip along the top
  const hood = new THREE.CylinderGeometry(0.4, 0.4, 0.26, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84).rotateX(Math.PI / 2).scale(1, 0.28, 1);
  put(panelBack, hood, 0, -0.2 - 0.4 * 0.28 * 0.8, -0.73);
  put(leather, cyl(0.028, 0.028, 0.66, 10), 0, -0.198, -0.6, 0, 0, Math.PI / 2);

  // ---- the gunsight on the coaming: its body, the reflector glass (the reticle: pilot.js puts it on the
  // guns' line, collimated, so it sits where the rounds converge) and a crash pad
  if (T.sight === 'revi') { // the Revi 16B: lamp housing, the head with its reflector and sun filter, the pad
    put(black, new RoundedBoxGeometry(0.065, 0.075, 0.13, 3, 0.012), 0, -0.16, -0.53);
    put(black, cyl(0.028, 0.032, 0.09, 16), 0, -0.2, -0.51, Math.PI / 2);
    put(black, new RoundedBoxGeometry(0.075, 0.028, 0.06, 2, 0.008), 0, -0.11, -0.55);
    put(steel, cyl(0.007, 0.007, 0.08, 8), 0, -0.1, -0.515, 0, 0, Math.PI / 2); // the filter's hinge
    put(leather, new RoundedBoxGeometry(0.05, 0.045, 0.03, 2, 0.012), 0, -0.165, -0.455);
    put(new THREE.MeshPhysicalMaterial({ color: 0x705a30, transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide }), new THREE.PlaneGeometry(0.07, 0.05), 0, -0.07, -0.5, 0.9); // the sun filter, folded up
  } else { // the K-14: the big gyro box, its range knob, the pad on its back, two glasses
    put(black, new RoundedBoxGeometry(0.11, 0.1, 0.24, 3, 0.018), 0, -0.175, -0.54);
    put(black, new RoundedBoxGeometry(0.09, 0.045, 0.08, 2, 0.01), 0, -0.105, -0.61);
    put(steel, cyl(0.02, 0.02, 0.025, 14), 0.068, -0.18, -0.5, 0, 0, Math.PI / 2); // the range knob
    put(leather, new RoundedBoxGeometry(0.1, 0.07, 0.045, 3, 0.02), 0, -0.18, -0.405); // the crash pad
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(T.sight === 'revi' ? 0.075 : 0.09, 0.07), new THREE.MeshPhysicalMaterial({ color: 0xbcd8e0, transparent: true, opacity: 0.16, roughness: 0.03, depthWrite: false, side: THREE.DoubleSide }));
  plate.position.set(0, -0.06, T.sight === 'revi' ? -0.53 : -0.6); plate.rotation.x = -0.6;
  g.add(plate);

  // ---- the stick and the throttle, with your hands on them, and your knees
  const stick = new THREE.Group();
  stick.position.set(0, -0.98, -0.28);
  g.add(stick);
  const sp = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); stick.add(m); return m; };
  sp(cyl(0.035, 0.05, 0.08, 12), leather, 0, 0.03, 0); // the rubber boot
  sp(cyl(0.013, 0.017, 0.5, 10).translate(0, 0.25, 0), black);
  sp(cyl(0.022, 0.026, 0.13, 12).translate(0, 0.55, 0), black); // the grip
  sp(box(0.03, 0.02, 0.03), red, 0, 0.6, -0.025); // the gun button
  sp(box(0.012, 0.035, 0.02), steel, 0, 0.55, -0.03); // the trigger
  const rh = hand(leather);
  rh.position.set(0.02, 0.56, 0.02); rh.rotation.set(-0.3, 0, -1.4);
  stick.add(rh);
  const throttle = new THREE.Group();
  throttle.position.set(L + 0.02, top + 0.03, -0.25);
  g.add(throttle);
  const lever = new THREE.Mesh(cyl(0.01, 0.012, 0.16, 8).translate(0, 0.08, 0), black);
  throttle.add(lever);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
  knob.position.y = 0.17; lever.add(knob);
  const lh = hand(leather);
  lh.position.set(0.02, 0.15, 0.03); lh.rotation.set(-0.4, 0, 0.6);
  lever.add(lh);
  for (const s of [-1, 1]) { // the knees, either side of the stick, under the panel
    put(suit, new THREE.CapsuleGeometry(0.075, 0.45, 4, 10), s * 0.13, -0.8, -0.12, Math.PI / 2 - 0.35);
    put(suit, new THREE.CapsuleGeometry(0.06, 0.4, 4, 10), s * 0.13, -0.97, -0.43);
  }

  // ---- the windscreen, the bulletproof glass, the canopy in box-section frames
  const ws = T.canopy === 'bubble' ? { z: z0 - 0.08, x0: 0.16, x1: widthAt(z0) - 0.03, yt: 0.2, zt: -0.4 } : T.canopy === 'fw' ? { z: z0 - 0.08, x0: 0.19, x1: widthAt(z0) - 0.04, yt: 0.2, zt: -0.36 } : { z: z0 - 0.1, x0: 0.17, x1: widthAt(z0) - 0.04, yt: 0.21, zt: -0.36 };
  const yb = sill - 0.01;
  // the windscreen's corners: the flat front panel between the inner posts, the side panes out to the sills
  const fl = P(-ws.x0, yb, ws.z), fr = P(ws.x0, yb, ws.z), tl = P(-ws.x0 * 0.85, ws.yt, ws.zt), tr = P(ws.x0 * 0.85, ws.yt, ws.zt);
  const sl = P(-ws.x1, yb, ws.z + 0.12), sr = P(ws.x1, yb, ws.z + 0.12), stl = P(-(ws.x1 - 0.07), ws.yt - 0.03, ws.zt + 0.06), str = P(ws.x1 - 0.07, ws.yt - 0.03, ws.zt + 0.06);
  const bubble = T.canopy !== 'erla'; // (a bubble's windscreen bow is the bubble's own forward frame)
  for (const [a, b] of bubble ? [[fl, tl], [fr, tr], [fl, fr]] : [[fl, tl], [fr, tr], [sl, stl], [sr, str], [tl, tr], [tl, stl], [tr, str], [fl, fr]]) bar(frameOut, a, b, 0.024, 0.026, P(0, 0.4, -1).normalize());
  putM(glass, quadGeo(fl, fr, tr, tl), new THREE.Matrix4());
  putM(glass, quadGeo(sl, fl, tl, stl), new THREE.Matrix4());
  putM(glass, quadGeo(fr, sr, str, tr), new THREE.Matrix4());
  // the thick bulletproof glass: inside the 109's windscreen, outside the Fw 190's, the P-51's front panel itself
  const agm = new THREE.Matrix4().makeRotationX(Math.atan2(ws.zt - ws.z, ws.yt - yb)) // (leaning back with the windscreen)
    .setPosition(0, (yb + ws.yt) / 2 + 0.005, (ws.z + ws.zt) / 2 + (kind === 'bf109' ? 0.06 : kind === 'fw190' ? -0.03 : 0));
  slab(ws.x0 * 1.7, 0.27, 0.05, agm);
  for (const sx of [-1, 1]) putM(frameOut, box(0.012, 0.29, 0.06).translate(sx * ws.x0 * 0.86, 0, 0), agm); // its frame's edges
  const rearZ = z1 + 0.02, H = { erla: 0.24, fw: 0.27, bubble: 0.33 }[T.canopy];
  if (T.canopy === 'erla') {
    // the Erla Haube: big clear side and top panels in a light frame; at the back the head armour, steel
    // below and armoured glass above
    const tlb = P(-0.27, H, rearZ), trb = P(0.27, H, rearZ), slb = P(-widthAt(rearZ) + 0.02, yb, rearZ), srb = P(widthAt(rearZ) - 0.02, yb, rearZ);
    const ul = P(-0.36, H - 0.1, rearZ), ur = P(0.36, H - 0.1, rearZ), ulf = P(-(ws.x1 - 0.05), ws.yt - 0.08, ws.zt + 0.12), urf = P(ws.x1 - 0.05, ws.yt - 0.08, ws.zt + 0.12);
    for (const [a, b] of [[stl, tlb], [str, trb], [tlb, trb], [slb, ul], [ul, tlb], [srb, ur], [ur, trb]]) bar(frameOut, a, b, 0.02, 0.022, P(0, 1, 0));
    putM(glass, quadGeo(sl, slb, ul, ulf), new THREE.Matrix4()); putM(glass, quadGeo(ulf, ul, tlb, stl), new THREE.Matrix4());
    putM(glass, quadGeo(srb, sr, urf, ur), new THREE.Matrix4()); putM(glass, quadGeo(ur, urf, str, trb), new THREE.Matrix4());
    putM(glass, quadGeo(stl, tlb, trb, str), new THREE.Matrix4());
    put(steel, box(0.5, 0.2, 0.012), 0, sill + 0.06, rearZ - 0.04);
    slab(0.46, 0.17, 0.05, new THREE.Matrix4().makeTranslation(0, sill + 0.245, rearZ - 0.04));
    for (const [a, b] of [[P(-0.24, sill + 0.16, rearZ - 0.04), P(-0.24, sill + 0.33, rearZ - 0.04)], [P(0.24, sill + 0.16, rearZ - 0.04), P(0.24, sill + 0.33, rearZ - 0.04)], [P(-0.24, sill + 0.33, rearZ - 0.04), P(0.24, sill + 0.33, rearZ - 0.04)]]) bar(steel, a, b, 0.022, 0.06, P(0, 0, 1));
  } else {
    // a bubble: frameless, its back in a frame; the headrest and armour plate behind your head
    const w = (z) => widthAt(z) - 0.02;
    const h = (z) => { const k = (z - ws.zt) / (rearZ - ws.zt); return ws.yt - 0.02 + (H - ws.yt) * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) - (k > 0.6 ? (k - 0.6) * (T.canopy === 'bubble' ? 0.35 : 0.2) : 0); };
    putM(glass, bubbleGeo(ws.zt + 0.04, rearZ, w, yb, h), new THREE.Matrix4());
    const arch = []; for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + (k / 12) * Math.PI; arch.push(P(w(rearZ) * Math.sin(a), yb + (h(rearZ) - yb) * Math.cos(a) ** 0.8, rearZ)); }
    for (let k = 0; k < 12; k++) bar(frameOut, arch[k], arch[k + 1], 0.024, 0.03, P(0, 0, 1));
    const front2 = []; for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI, z = ws.zt; front2.push(P(w(z) * Math.sin(a), yb + (h(z) - yb) * Math.cos(a) ** 0.8, z)); }
    for (let k = 0; k < 10; k++) bar(frameOut, front2[k], front2[k + 1], 0.022, 0.024, P(0, 0, 1)); // the bubble's forward edge, along the windscreen's bow
    put(steel, box(0.32, 0.3, kind === 'fw190' ? 0.014 : 0.012), 0, sill + 0.03, z1 - 0.15, -0.08); // the head armour
    put(leather, box(0.2, 0.12, 0.05), 0, sill + 0.05, z1 - 0.18); // the headrest pad
    if (kind === 'fw190') for (const s of [-1, 1]) bar(steel, P(s * 0.15, sill - 0.1, z1 - 0.13), P(s * 0.12, sill + 0.16, z1 - 0.16), 0.02, 0.02, P(0, 0, 1));
    if (kind === 'p51') put(new THREE.MeshStandardMaterial({ color: 0xaab4bb, roughness: 0.05, metalness: 1 }), box(0.14, 0.04, 0.008), 0, ws.yt + 0.005, ws.zt + 0.05, 0.2); // the rear-view mirror on the bow
  }

  // ---- merge: one mesh per material (glass drawn after the rest)
  for (const [mat, list] of parts) {
    const coloured = !!mat.vertexColors;
    const m = new THREE.Mesh(mergeGeometries(list.map((x) => tidy(x, coloured))), mat);
    if (mat.transparent) m.renderOrder = 2;
    g.add(m);
  }

  // ---- what moves: the needles (redrawn ~15 times a second), stick, throttle, and the night glow
  let redraw = 0;
  root.userData.update = (s, dt) => {
    if ((redraw -= dt) <= 0) { redraw = 1 / 15; art.draw(s); }
    stick.rotation.x = THREE.MathUtils.clamp(-s.stickY, -1, 1) * 0.22; // back to pull up
    stick.rotation.z = THREE.MathUtils.clamp(-s.stickX, -1, 1) * 0.25;
    lever.rotation.x = -0.6 + s.throttle * 1.0;
  };
  root.userData.night = (k) => { panelMat.emissive.setRGB(0.7, 1.0, 0.75).multiplyScalar(k * 1.4); }; // the radium paint
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}

let SPIRAL = null;
/** The German fighters' spinner: black-green with the white spiral. */
function spiralTex() {
  if (SPIRAL) return SPIRAL;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256);
  // (the sphere's uv: u round it, v from the tip back; the stripe's u moves on with v)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4, w = ((x / 256 + (y / 256) * 0.9) % 1) < 0.16; img.data[i] = img.data[i + 1] = img.data[i + 2] = w ? 255 : 60; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  SPIRAL = new THREE.CanvasTexture(c); SPIRAL.colorSpace = THREE.SRGBColorSpace;
  return SPIRAL;
}

/**
 * The reflector sight's image: a lit cross with a gap in the middle and a dot at its centre, collimated
 * (at infinity, so it sits on the guns' line wherever your head is). Put on the camera's parent by
 * pilot.js and placed each frame.
 */
export function buildReticle(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d'), col = kind === 'p51' ? 'rgba(255,170,90,1)' : 'rgba(255,190,80,1)';
  x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 5; x.shadowColor = col; x.shadowBlur = 8; x.lineCap = 'round';
  for (const [a, b, cc, d] of [[128, 30, 128, 104], [128, 152, 128, 226], [30, 128, 104, 128], [152, 128, 226, 128]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(cc, d); x.stroke(); }
  x.beginPath(); x.arc(128, 128, 7, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(4.5, 2.2, 0.7), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  m.renderOrder = 10;
  m.frustumCulled = false;
  return m;
}
