// The Fw 190 A-8's cockpit, for flying one in first person, built to photographs of the surviving
// aircraft (and the A-8 handbook's panel layout):
// - the windscreen: a trapezoid of 50 mm armour glass between raked posts, triangular quarter panes back
//   to the canopy's front arch, the blown sliding hood behind it, the head armour with its padded rest;
// - the tubular hoop arching over the panel's shroud;
// - the two-tier panel in RLM 66, each instrument behind its hole with four screws round it. Upper:
//   the SZKK 4 ammunition counters, then AFN 2, Fahrtmesser, künstlicher Horizont, Tochterkompass,
//   Steigmesser; Fein-Grob-Höhenmesser, Luftschraubenstellung (the VDM "clock"), Ladedruck, Drehzahl.
//   Lower: Kraftstoff- und Schmierstoffdruck, Schmierstofftemperatur, Kraftstoffvorrat, Borduhr and the
//   red fuel warning lamp. Their needles read the flight (IAS from the air's density, boost and rpm from
//   the Kommandogerät, which set boost, rpm, pitch, mixture and the supercharger's gear from the one lever);
//   the radium paint glows at night;
// - the Revi 16B on the shroud (pilot.js draws its reticle on the guns' line);
// - the stick (KG 13 B grip) and the throttle moving under your hands; the consoles: the throttle quadrant,
//   the gear and flap buttons, the trim, the fuel cock on the left; the breaker panel, FuG 16Z, oxygen and
//   the canopy crank on the right; the cast rudder pedals, the seat, harness and armour.
// Everything that doesn't move is merged: one draw call per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wetGlass } from './environment.js';

const V3 = THREE.Vector3, clamp = THREE.MathUtils.clamp;
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// the airframe round you, relative to the eye (as TYPES.fw190 in cockpit.js): stations [z, half width, top,
// widest at, bottom, sill?], the MG 131 humps, the paint, the wing, the exhausts
const T = {
  eye: [0, 0.86, -0.22], prop: 3.85, n: 2.05,
  body: [[-3.85, 0.6, -0.2, -0.78, -1.36], [-3.3, 0.64, -0.16, -0.78, -1.4], [-2.3, 0.63, -0.17, -0.78, -1.39], [-1.55, 0.56, -0.175, -0.74, -1.32],
    [-0.95, 0.49, -0.17, -0.7, -1.26], [-0.6, 0.46, -0.16, -0.68, -1.22], [-0.48, 0.46, -0.15, -0.68, -1.22, -0.14], [0.8, 0.43, -0.1, -0.66, -1.2, -0.12],
    [0.95, 0.42, 0.1, -0.66, -1.18], [1.8, 0.36, 0.0, -0.6, -1.05], [2.7, 0.27, -0.08, -0.55, -0.92]],
  bumps: [[0.12, -0.17, -1.3, 0.34, 0.085, 0.05], [-0.12, -0.17, -1.3, 0.34, 0.085, 0.05]],
  top: 0x4a4f55, side: 0x6a7178, belly: 0x9aa6b0, mottle: 0x58654e,
  wing: [-1.3, 5.2, 2.25, 1.15, -1.45, 0.3], exhausts: [0.58, -1.0, -2.15, -1.7, 4],
};
const RLM66 = 0x3e4246; // Schwarzgrau, the cockpit's paint
const AMMO = [475, 475, 250, 250]; // the SZKK 4's guns: the two MG 131s, the inner MG 151/20s

// ---------- the engine as the instruments see it

/**
 * The Kommandogerät: one lever, and the box behind it sets boost, rpm, pitch, mixture, ignition and the
 * supercharger's gear. The BMW 801 D-2: 1.42 ata and 2,700 U/min for Start- und Notleistung, 1.32 / 2,400
 * Steig- und Kampfleistung; the second gear's full-pressure height ~5.7 km, the boost falling above it,
 * a dip as the gear changes over (~2.6 km). Indicated airspeed from the true with the air's density (ISA).
 */
function readings(s) {
  const t = clamp(s.throttle ?? 0, 0, 1), alt = Math.max(0, s.alt ?? 0);
  const dead = !!s.damage;
  const rpm = 1300 + 1400 * t ** 0.85 - (dead ? 250 : 0);
  const avail = alt < 5700 ? 1.42 : 1.42 * Math.exp(-(alt - 5700) / 7000);
  const shift = 0.12 * Math.exp(-(((alt - 2600) / 150) ** 2));
  const boost = Math.max(0.55, Math.min(0.6 + 0.82 * t, avail) - shift * t);
  const sigma = Math.max(0.15, 1 - 2.2558e-5 * alt) ** 4.2559;
  const ias = (s.speed ?? 0) * Math.sqrt(sigma) * 3.6;
  const J = (s.speed ?? 0) / Math.max(1, (rpm / 60) * 3.3); // the propeller's advance ratio
  const time = s.time ?? 0;
  return {
    ias, rpm, boost, alt, climb: s.climb ?? 0, heading: s.heading ?? 0, bank: s.bank ?? 0, pitch: s.pitch ?? 0, time,
    slip: clamp((s.stickX ?? 0) * 0.35, -1, 1),
    pitchH: 8.5 + J * 3.2, // the VDM clock's hours (12:00 about climbing pitch)
    oilT: 62 + 22 * t + (dead ? 38 : 0),
    oilP: dead ? Math.max(0.6, 3.5 - time * 0.01) : 3.2 + 5 * (rpm - 1300) / 1400,
    fuelP: 1.45 + (dead ? Math.sin(time * 7) * 0.25 : 0),
    fuel: clamp(250 - time * 0.11, 0, 292), // the rear tank, ~400 l/h
    clock: 14 * 3600 + 18 * 60 + time, // Black Thursday: over Germany at twenty past two
    ammo: AMMO.map((m, i) => clamp((s.ammo?.[i] ?? m) / m, 0, 1)),
  };
}

// ---------- the instrument faces: an atlas drawn live, each dial a cell of it

const AW = 1024, AH = 512, CS = 170, CR = 80; // atlas px, a cell, a dial's radius in px
const DIALS = ['speed', 'horizon', 'compass', 'climb', 'afn', 'alt', 'pitch', 'boost', 'rpm', 'press', 'oilt', 'fuel', 'clock'];
const cellOf = (kind) => { const i = DIALS.indexOf(kind); return [(i % 6) * CS + CS / 2, Math.floor(i / 6) * CS + CS / 2]; };
const SZKK = [180, 350, 340, 120]; // the ammunition counters' box in the atlas: x, y, w, h
const PAINT = '#e8ecdc'; // radium paint, a little green-white
const FONT = '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "Helvetica Neue", Arial, sans-serif';
const TAU = Math.PI * 2;

class DialArt {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = AW; this.c.height = AH;
    this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.bg = document.createElement('canvas');
    this.bg.width = AW; this.bg.height = AH;
    const g = this.bg.getContext('2d');
    g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, AW, AH);
    for (const k of DIALS) { const [x, y] = cellOf(k); g.save(); g.translate(x, y); this.face(g, k); g.restore(); }
    this.szkkFace(g);
  }

  // drawing helpers, about the dial's centre
  tick(g, a, r0, r1, w) { g.lineWidth = w; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); }
  num(g, a, rr, text, size, weight = 700) { g.font = `${weight} ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, Math.cos(a) * rr, Math.sin(a) * rr + size * 0.06); }
  text(g, x, y, text, size, weight = 600) { g.font = `${weight} ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y); }
  /** A scale: ticks every `minor`, longer every `mid`, numbered every `major` (fmt), along v -> angle. */
  scale(g, min, max, ang, minor, mid, major, fmt, size = 17, rn = 0.66) {
    for (let v = min; v <= max + 1e-6; v += minor) {
      const a = ang(v), isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-4, isMid = Math.abs(v / mid - Math.round(v / mid)) < 1e-4;
      this.tick(g, a, CR * (isMaj ? 0.78 : isMid ? 0.83 : 0.87), CR * 0.95, isMaj ? 3.2 : isMid ? 2.2 : 1.3);
      if (isMaj && fmt) this.num(g, a, CR * rn, fmt(v), size);
    }
  }
  /** A German needle: a white lance, luminous to its tip, on a black hub. */
  needle(g, a, len, w = 5, tail = 0.18, col = PAINT) {
    g.save(); g.rotate(a); g.fillStyle = col;
    g.beginPath(); g.moveTo(-CR * tail, -w * 0.6); g.lineTo(CR * len * 0.82, -w / 2); g.lineTo(CR * len, 0); g.lineTo(CR * len * 0.82, w / 2); g.lineTo(-CR * tail, w * 0.6); g.closePath(); g.fill();
    g.fillStyle = '#00000055'; g.fillRect(-CR * tail, -0.6, CR * len * 0.5, 1.2); // (its spine)
    g.restore();
  }
  hub(g, r = 7) { g.fillStyle = '#050505'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.strokeStyle = '#3a3a3a'; g.lineWidth = 1.5; g.stroke(); }

  /** The static face of each dial: its black face, scale, numbers and markings. */
  face(g, kind) {
    const gr = g.createRadialGradient(-CR * 0.2, -CR * 0.2, 0, 0, 0, CR);
    gr.addColorStop(0, '#1b1c1b'); gr.addColorStop(1, '#0a0a0a');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, CR, 0, TAU); g.fill();
    g.strokeStyle = PAINT; g.fillStyle = PAINT; g.lineCap = 'butt';
    const A0 = Math.PI * 0.75, SW = Math.PI * 1.5; // a 270 degree dial from bottom left
    const lin = (min, max, a0 = A0, sw = SW) => (v) => a0 + ((v - min) / (max - min)) * sw;
    switch (kind) {
      case 'speed': { // Fahrtmesser, 100..750 km/h round most of the dial, opened out at the low end
        const ang = DialArt.speedAng;
        this.scale(g, 100, 750, ang, 10, 50, 100, (v) => String(v / 100), 21);
        this.text(g, 0, CR * 0.34, 'km/h', 14);
        g.fillStyle = '#c02a1c'; g.beginPath(); const a = ang(750); g.arc(Math.cos(a) * CR * 0.9, Math.sin(a) * CR * 0.9, 4, 0, TAU); g.fill();
        break;
      }
      case 'climb': { // Steigmesser: nought at nine o'clock, climb above, sink below, opened out near nought
        const ang = DialArt.climbAng;
        for (const s of [-1, 1]) {
          for (const v of [1, 2, 3, 4, 6, 7, 8, 9, 15, 25]) this.tick(g, ang(s * v), CR * 0.87, CR * 0.95, 1.3);
          for (const v of [5, 10, 20, 30]) { this.tick(g, ang(s * v), CR * 0.78, CR * 0.95, 3); this.num(g, ang(s * v), CR * 0.64, String(v), 17); }
        }
        this.tick(g, Math.PI, CR * 0.7, CR * 0.95, 4); this.num(g, Math.PI, CR * 0.56, '0', 18);
        this.text(g, CR * 0.3, 0, 'm/s', 14);
        this.text(g, -CR * 0.12, -CR * 0.3, '↑', 13); this.text(g, -CR * 0.12, CR * 0.3, '↓', 13);
        break;
      }
      case 'alt': { // Fein-Grob-Höhenmesser: the long hand round once a km (0..9: hundreds of metres)
        for (let k = 0; k < 50; k++) { const a = -Math.PI / 2 + (k / 50) * TAU; this.tick(g, a, CR * (k % 5 ? 0.87 : 0.78), CR * 0.95, k % 5 ? 1.3 : 3); }
        for (let k = 0; k < 10; k++) this.num(g, -Math.PI / 2 + (k / 10) * TAU, CR * 0.64, String(k), 21);
        this.text(g, 0, -CR * 0.3, 'km', 13);
        g.fillStyle = '#000'; g.fillRect(-19, CR * 0.3, 38, 15); g.strokeStyle = '#555'; g.lineWidth = 1; g.strokeRect(-19, CR * 0.3, 38, 15); // the pressure window
        g.fillStyle = '#d8d4c0'; this.text(g, 0, CR * 0.3 + 8, '1013', 11, 700); g.fillStyle = PAINT;
        this.text(g, 0, CR * 0.58, 'mb', 9);
        break;
      }
      case 'boost': { // Ladedruckmesser, ata, with the decimal comma; red at Start- und Notleistung
        const ang = lin(0.6, 1.8);
        this.scale(g, 0.6, 1.8, ang, 0.05, 0.1, 0.2, (v) => v.toFixed(1).replace('.', ','), 15);
        this.text(g, 0, CR * 0.38, 'ata', 15);
        this.redMark(g, ang(1.42));
        break;
      }
      case 'rpm': { // Drehzahlmesser, U/min x 100
        const ang = lin(0, 36);
        this.scale(g, 0, 36, ang, 1, 2, 4, (v) => String(v), 16);
        this.text(g, 0, CR * 0.32, 'U/min', 12); this.text(g, 0, CR * 0.48, 'x 100', 11);
        this.redMark(g, ang(27));
        break;
      }
      case 'oilt': { // Schmierstofftemperatur (Eintritt)
        const ang = lin(0, 130);
        g.strokeStyle = '#3d8f4a'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, CR * 0.9, ang(40), ang(85)); g.stroke(); g.strokeStyle = PAINT;
        this.scale(g, 0, 130, ang, 5, 10, 20, (v) => String(v), 15);
        this.redMark(g, ang(95));
        this.text(g, 0, CR * 0.3, '°C', 14); this.text(g, 0, CR * 0.48, 'Schmierst.', 10);
        break;
      }
      case 'fuel': { // Kraftstoffvorratsanzeiger (the selected tank)
        const ang = lin(0, 300);
        this.scale(g, 0, 300, ang, 10, 50, 100, (v) => String(v), 16);
        this.text(g, 0, CR * 0.3, 'Liter', 13); this.text(g, 0, CR * 0.48, 'Kraftstoff', 10);
        g.strokeStyle = '#c02a1c'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, CR * 0.9, ang(0), ang(40)); g.stroke(); g.strokeStyle = PAINT;
        break;
      }
      case 'press': { // Kraftstoff- und Schmierstoffdruckmesser: K (0..3) above, S (0..15) below
        const k = (v) => Math.PI * 1.17 + (v / 3) * Math.PI * 0.66, sA = (v) => Math.PI * 0.83 - (v / 15) * Math.PI * 0.66;
        this.scale(g, 0, 3, k, 0.25, 0.5, 1, (v) => String(v), 15);
        this.scale(g, 0, 15, sA, 1, 5, 5, (v) => String(v), 15);
        this.text(g, 0, -CR * 0.36, 'K', 17, 800); this.text(g, 0, CR * 0.36, 'S', 17, 800);
        this.text(g, CR * 0.42, 0, 'kg/cm²', 9);
        break;
      }
      case 'pitch': { // Luftschraubenstellungsanzeiger: the VDM propeller's pitch read like a clock
        for (let k = 0; k < 60; k++) this.tick(g, -Math.PI / 2 + (k / 60) * TAU, CR * (k % 5 ? 0.88 : 0.79), CR * 0.95, k % 5 ? 1.2 : 3);
        for (let k = 1; k <= 12; k++) this.num(g, -Math.PI / 2 + (k / 12) * TAU, CR * 0.65, String(k), 17);
        this.text(g, 0, CR * 0.3, 'VDM', 11);
        break;
      }
      case 'clock': { // Borduhr
        for (let k = 0; k < 60; k++) this.tick(g, -Math.PI / 2 + (k / 60) * TAU, CR * (k % 5 ? 0.88 : 0.78), CR * 0.95, k % 5 ? 1.2 : 3.4);
        for (let k = 1; k <= 12; k++) this.num(g, -Math.PI / 2 + (k / 12) * TAU, CR * 0.64, String(k), 18);
        for (let k = 0; k < 12; k++) { const a = -Math.PI / 2 + (k / 12) * TAU; g.beginPath(); g.arc(Math.cos(a) * CR * 0.98, Math.sin(a) * CR * 0.98, 2.5, 0, TAU); g.fill(); } // (the radium dots)
        break;
      }
      case 'afn': { // AFN 2: the homing indicator, left/right of the beacon
        g.lineWidth = 2; g.beginPath(); g.arc(0, CR * 0.55, CR * 0.95, Math.PI * 1.32, Math.PI * 1.68); g.stroke();
        for (let k = -4; k <= 4; k++) { const a = -Math.PI / 2 + k * 0.09; g.save(); g.translate(0, CR * 0.55); this.tick(g, a, CR * 0.95, CR * (k ? 1.05 : 1.12), k ? 1.5 : 3); g.restore(); }
        this.text(g, -CR * 0.55, -CR * 0.1, 'L', 16, 800); this.text(g, CR * 0.55, -CR * 0.1, 'R', 16, 800);
        this.text(g, 0, CR * 0.62, 'AFN 2', 12);
        break;
      }
      case 'horizon': case 'compass': default: break; // (all drawn live)
    }
  }

  redMark(g, a) { g.save(); g.rotate(a); g.fillStyle = '#c42a1b'; g.beginPath(); g.moveTo(CR * 0.97, 0); g.lineTo(CR * 0.84, -5); g.lineTo(CR * 0.84, 5); g.fill(); g.restore(); g.fillStyle = PAINT; }

  /** The SZKK 4's box: four windows with their scales; the tapes are drawn live. */
  szkkFace(g) {
    const [x, y, w, h] = SZKK;
    g.fillStyle = '#121212'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    for (let i = 0; i < 4; i++) {
      const cx = x + 18 + i * 82, wy = y + 12, wh = h - 34;
      g.fillStyle = '#040404'; g.fillRect(cx, wy, 30, wh);
      g.strokeStyle = PAINT; g.fillStyle = PAINT;
      for (let k = 0; k <= 10; k++) { const yy = wy + wh - (k / 10) * wh; g.lineWidth = k % 5 ? 1 : 2; g.beginPath(); g.moveTo(cx + 32, yy); g.lineTo(cx + (k % 5 ? 38 : 42), yy); g.stroke(); }
      const max = AMMO[i];
      this.text(g, cx + 54, wy + 4, String(max), 11, 700); this.text(g, cx + 54, wy + wh / 2, String(Math.round(max / 2)), 10); this.text(g, cx + 50, wy + wh - 3, '0', 10);
      this.text(g, cx + 22, y + h - 11, i < 2 ? 'MG 131' : 'MG 151', 11, 700);
    }
  }

  // the angles of the non-linear scales
  static speedAng(v) { return v < 100 ? Math.PI * 0.6 : Math.PI * 0.65 + ((Math.min(v, 760) - 100) / 650) ** 0.85 * Math.PI * 1.7; }
  static climbAng(v) { return Math.PI + Math.sign(v) * (Math.min(Math.abs(v), 31) / 30) ** 0.7 * Math.PI * 0.82; }

  /** The live parts: the needles, the horizon, the compass card, the counters' tapes, and the glass's glint. */
  draw(e) {
    const g = this.g;
    g.drawImage(this.bg, 0, 0);
    for (const k of DIALS) { const [x, y] = cellOf(k); g.save(); g.translate(x, y); this.live(g, k, e); this.glint(g); g.restore(); }
    const [x, y, , h] = SZKK;
    for (let i = 0; i < 4; i++) {
      const cx = x + 18 + i * 82, wy = y + 12, wh = h - 34, f = e.ammo[i];
      g.fillStyle = '#ebe6d2'; g.fillRect(cx + 3, wy + wh * (1 - f), 24, wh * f);
      if (f < 0.15) { g.fillStyle = '#b02518'; g.fillRect(cx + 3, wy + wh * (1 - f), 24, wh * f); }
    }
    this.tex.needsUpdate = true;
  }

  glint(g) {
    const gl = g.createLinearGradient(-CR, -CR, CR * 0.2, CR * 0.3);
    gl.addColorStop(0, '#ffffff1c'); gl.addColorStop(0.42, '#ffffff07'); gl.addColorStop(0.46, '#ffffff00');
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, CR, 0, TAU); g.fill();
  }

  live(g, kind, e) {
    const A0 = Math.PI * 0.75, SW = Math.PI * 1.5, lin = (v, min, max) => A0 + ((clamp(v, min, max) - min) / (max - min)) * SW;
    switch (kind) {
      case 'speed': this.needle(g, DialArt.speedAng(e.ias), 0.86); this.hub(g); break;
      case 'climb': this.needle(g, DialArt.climbAng(e.climb), 0.86); this.hub(g); break;
      case 'alt':
        this.needle(g, -Math.PI / 2 + (e.alt / 10000) * TAU, 0.5, 9, 0.12); // the km
        this.needle(g, -Math.PI / 2 + ((e.alt % 1000) / 1000) * TAU, 0.88, 4, 0.22); // the hundreds
        this.hub(g, 8); break;
      case 'boost': this.needle(g, lin(e.boost, 0.6, 1.8), 0.86); this.hub(g); break;
      case 'rpm': this.needle(g, lin(e.rpm / 100, 0, 36), 0.86); this.hub(g); break;
      case 'oilt': this.needle(g, lin(e.oilT, 0, 130), 0.84); this.hub(g); break;
      case 'fuel': this.needle(g, lin(e.fuel, 0, 300), 0.84); this.hub(g); break;
      case 'press':
        this.needle(g, Math.PI * 1.17 + (clamp(e.fuelP, 0, 3) / 3) * Math.PI * 0.66, 0.82, 4);
        this.needle(g, Math.PI * 0.83 - (clamp(e.oilP, 0, 15) / 15) * Math.PI * 0.66, 0.82, 4);
        this.hub(g); break;
      case 'pitch': {
        const h = e.pitchH;
        this.needle(g, -Math.PI / 2 + ((h % 12) / 12) * TAU, 0.5, 7, 0.1);
        this.needle(g, -Math.PI / 2 + (h % 1) * TAU, 0.84, 4, 0.15);
        this.hub(g); break;
      }
      case 'clock': {
        const t = e.clock;
        this.needle(g, -Math.PI / 2 + ((t / 3600) % 12) / 12 * TAU, 0.5, 7, 0.1);
        this.needle(g, -Math.PI / 2 + ((t / 60) % 60) / 60 * TAU, 0.82, 4.5, 0.12);
        g.save(); g.rotate(-Math.PI / 2 + (Math.floor(t) % 60) / 60 * TAU); g.fillStyle = '#d24a2a'; g.fillRect(-CR * 0.2, -1, CR * 1.08, 2); g.restore();
        this.hub(g, 6); break;
      }
      case 'afn': {
        g.save(); g.translate(0, CR * 0.55);
        this.needle(g, -Math.PI / 2 + Math.sin(e.time * 0.23) * 0.06 + Math.sin(e.time * 1.7) * 0.012, 1.05, 4, 0);
        g.restore();
        g.fillStyle = '#050505'; g.beginPath(); g.arc(0, CR * 0.55, 9, 0, TAU); g.fill();
        break;
      }
      case 'horizon': {
        g.save(); g.beginPath(); g.arc(0, 0, CR * 0.97, 0, TAU); g.clip();
        g.rotate(-e.bank);
        const k = CR * 1.6, p = clamp(e.pitch, -0.5, 0.5) * k;
        g.fillStyle = '#1e2a35'; g.fillRect(-CR * 2, -CR * 3 + p, CR * 4, CR * 3);
        g.fillStyle = '#16120d'; g.fillRect(-CR * 2, p, CR * 4, CR * 3);
        g.strokeStyle = PAINT; g.lineWidth = 4; g.beginPath(); g.moveTo(-CR, p); g.lineTo(CR, p); g.stroke();
        g.lineWidth = 1.6;
        for (const d of [-20, -10, 10, 20]) { const y = p - (d * Math.PI / 180) * k, hw = CR * (Math.abs(d) === 10 ? 0.18 : 0.28); g.beginPath(); g.moveTo(-hw, y); g.lineTo(hw, y); g.stroke(); }
        g.fillStyle = PAINT; g.beginPath(); g.moveTo(0, -CR * 0.8); g.lineTo(-6, -CR * 0.68); g.lineTo(6, -CR * 0.68); g.fill(); // the bank pointer, on the card
        g.restore();
        g.strokeStyle = PAINT; // the bank scale, fixed to the case
        for (const d of [0, 10, 20, 30, 45, 60]) for (const s of d ? [-1, 1] : [1]) this.tick(g, -Math.PI / 2 + s * d * Math.PI / 180, CR * 0.84, CR * 0.96, d % 30 ? 1.6 : 3);
        g.strokeStyle = '#000'; g.lineWidth = 7; g.lineJoin = 'round'; // the little aircraft, outlined
        const plane = () => { g.beginPath(); g.moveTo(-CR * 0.56, 0); g.lineTo(-CR * 0.2, 0); g.lineTo(0, CR * 0.11); g.lineTo(CR * 0.2, 0); g.lineTo(CR * 0.56, 0); g.stroke(); };
        plane(); g.strokeStyle = '#f0d9a0'; g.lineWidth = 3.5; plane();
        g.fillStyle = '#f0d9a0'; g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.fill();
        // the slip ball in its curved glass, at the bottom
        g.strokeStyle = '#2c2e2c'; g.lineWidth = 13; g.lineCap = 'round'; g.beginPath(); g.arc(0, -CR * 0.05, CR * 0.8, Math.PI * 0.36, Math.PI * 0.64); g.stroke(); g.lineCap = 'butt';
        g.strokeStyle = PAINT; g.lineWidth = 1.2; for (const s of [-1, 1]) this.tick(g, Math.PI / 2 + s * 0.07, CR * 0.7, CR * 0.88, 1.2);
        const ba = Math.PI / 2 - e.slip * 0.12 * Math.PI;
        g.fillStyle = '#050505'; g.beginPath(); g.arc(Math.cos(ba) * CR * 0.8, -CR * 0.05 + Math.sin(ba) * CR * 0.8, 5, 0, TAU); g.fill();
        break;
      }
      case 'compass': { // the repeater: the card turns, the lubber line stays
        g.save(); g.rotate(-e.heading); g.strokeStyle = PAINT; g.fillStyle = PAINT;
        for (let k = 0; k < 72; k++) { const a = -Math.PI / 2 + (k / 72) * TAU; this.tick(g, a, CR * (k % 2 ? 0.88 : 0.8), CR * 0.95, k % 6 ? 1.3 : 2.6); }
        for (let k = 0; k < 12; k++) {
          const a = -Math.PI / 2 + (k / 12) * TAU, t = k % 3 ? String(k * 3) : 'NOSW'[k / 3];
          g.save(); g.rotate(a + Math.PI / 2); this.text(g, 0, -CR * 0.64, t, k % 3 ? 15 : 21, k % 3 ? 600 : 800); g.restore();
        }
        g.restore();
        g.fillStyle = '#e09a3a'; g.beginPath(); g.moveTo(0, -CR * 0.98); g.lineTo(-6, -CR * 0.8); g.lineTo(6, -CR * 0.8); g.fill(); // the lubber mark
        g.strokeStyle = PAINT; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -CR * 0.3); g.lineTo(0, CR * 0.32); g.moveTo(-CR * 0.26, -CR * 0.05); g.lineTo(CR * 0.26, -CR * 0.05); g.moveTo(-CR * 0.1, CR * 0.28); g.lineTo(CR * 0.1, CR * 0.28); g.stroke();
        break;
      }
      default: break;
    }
  }
}

// ---------- the console labels, placards and small static faces: drawn once

const LW = 1024;
const LBL = {
  breakers: [0, 0, 512, 256], gear: [512, 0, 256, 256], quadrant: [768, 0, 256, 128], fug: [768, 128, 256, 128],
  trim: [0, 256, 128, 128], o2: [128, 256, 128, 128], c3: [256, 256, 256, 64], canopy: [256, 320, 256, 64],
  pedestal: [512, 256, 256, 256], magneto: [768, 256, 128, 128], o2flow: [896, 256, 128, 128],
};
let LABELS = null;
function labelTex() {
  if (LABELS) return LABELS;
  const c = document.createElement('canvas'); c.width = c.height = LW;
  const g = c.getContext('2d'), r = rng(19);
  const base = '#3a3e42';
  g.fillStyle = base; g.fillRect(0, 0, LW, LW);
  const txt = (x, y, t, size, col = '#e6e2d2', weight = 700, align = 'center') => { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  const plate = (x, y, w, h, col = '#d9d4bf') => { g.fillStyle = col; g.fillRect(x, y, w, h); g.strokeStyle = '#00000055'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2); };
  const screw = (x, y, rr = 5) => { g.fillStyle = '#26282a'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - rr * 0.7, y); g.lineTo(x + rr * 0.7, y); g.stroke(); };
  const grain = (x0, y0, w, h) => { for (let i = 0; i < w * h / 60; i++) { g.fillStyle = r() < 0.5 ? '#ffffff08' : '#00000012'; g.fillRect(x0 + r() * w, y0 + r() * h, 2, 2); } };
  const dial = (cx, cy, R) => { g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 4; g.stroke(); g.strokeStyle = PAINT; g.fillStyle = PAINT; };
  { // the Selbstschalter: the breaker panel's face, three rows of six, each labelled
    const [x, y, w, h] = LBL.breakers;
    g.fillStyle = '#1a1b1c'; g.fillRect(x, y, w, h); grain(x, y, w, h);
    const names = [['Batterie', 'Generator', 'Fahrwerk', 'Landekl.', 'Höhenfl.', 'Staurohr'], ['Pumpe v.', 'Pumpe h.', 'Instrum.', 'FuG 16', 'FuG 25', 'Revi'], ['Waffen', 'MG 131', 'MG 151', 'ETC', 'Kennl.', 'Anlasser']];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
      const cx = x + 44 + i * 82, cy = y + 50 + j * 78;
      g.strokeStyle = '#555'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 15, 0, TAU); g.stroke();
      plate(cx - 36, cy + 20, 72, 17, '#cfcab4'); txt(cx, cy + 29, names[j][i], 13, '#111');
    }
    for (const [sx, sy] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) screw(x + sx, y + sy, 6);
  }
  { // the gear and flap buttons' plate (Fahrwerk / Landeklappen), with their lamps
    const [x, y, w, h] = LBL.gear;
    g.fillStyle = base; g.fillRect(x, y, w, h); grain(x, y, w, h);
    txt(x + w / 2, y + 22, 'FAHRWERK', 20); txt(x + 70, y + 92, 'EIN', 15); txt(x + 186, y + 92, 'AUS', 15);
    txt(x + w / 2, y + 138, 'LANDEKLAPPEN', 19); txt(x + 50, y + 228, 'EIN', 14); txt(x + 128, y + 228, 'START', 14); txt(x + 206, y + 228, 'AUS', 14);
    for (const [sx, sy] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) screw(x + sx, y + sy, 5);
  }
  { // the throttle quadrant's side plate
    const [x, y, w, h] = LBL.quadrant;
    g.fillStyle = '#2d3033'; g.fillRect(x, y, w, h); grain(x, y, w, h);
    g.fillStyle = '#0a0a0a'; g.fillRect(x + 12, y + 56, w - 24, 14); // the slot
    const marks = [['ABSTELLEN', 0.06], ['LEERLAUF', 0.24], ['STEIGEN', 0.68], ['START', 0.9]];
    for (const [t, f] of marks) { const xx = x + 12 + f * (w - 24); g.fillStyle = '#e6e2d2'; g.fillRect(xx - 1, y + 44, 2, 10); txt(xx, y + 30, t, 13); }
    g.fillStyle = '#b8261a'; g.fillRect(x + 12 + 0.82 * (w - 24), y + 74, 0.18 * (w - 24) - 2, 6); // (the emergency power's red band)
    txt(x + w / 2, y + 100, 'KOMMANDOGERÄT', 14, '#c9c4ae', 600);
  }
  { // the FuG 16Z's control unit: channel selector, volume
    const [x, y, w, h] = LBL.fug;
    g.fillStyle = '#1d1e1f'; g.fillRect(x, y, w, h); grain(x, y, w, h);
    txt(x + w / 2, y + 16, 'FuG 16 Z', 16, '#d8d4c0');
    dial(x + 66, y + 74, 38); for (let k = 0; k < 4; k++) { const a = -Math.PI * 0.8 + k * 0.5; txt(x + 66 + Math.cos(a) * 28, y + 74 + Math.sin(a) * 28, 'IVHY'[k], 12); }
    txt(x + 66, y + 122, 'Kanal', 12, '#d8d4c0', 600);
    dial(x + 186, y + 74, 30); txt(x + 186, y + 122, 'Lautst.', 12, '#d8d4c0', 600);
  }
  { // the tailplane trim indicator (Höhenflosse)
    const [x, y, w, h] = LBL.trim; const cx = x + w / 2, cy = y + h / 2;
    dial(cx, cy, 58);
    for (let k = -4; k <= 4; k++) { const a = Math.PI + k * 0.17; g.lineWidth = k ? 1.5 : 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52); g.stroke(); }
    txt(cx + 8, cy - 30, 'kopfl.', 10, PAINT, 600); txt(cx + 8, cy + 32, 'schwanzl.', 10, PAINT, 600);
    g.fillStyle = PAINT; g.save(); g.translate(cx + 22, cy); g.rotate(Math.PI - 0.06); g.fillRect(0, -2, 48, 4); g.restore();
    txt(cx + 22, cy, 'Höhenfl.', 9, PAINT, 600);
  }
  { // the oxygen pressure gauge (Sauerstoff, kg/cm²: full at 150)
    const [x, y, w, h] = LBL.o2; const cx = x + w / 2, cy = y + h / 2;
    dial(cx, cy, 58);
    for (let k = 0; k <= 10; k++) { const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5; g.lineWidth = k % 2 ? 1.5 : 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42); g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54); g.stroke(); if (!(k % 2)) txt(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, String(k * 20), 11, PAINT); }
    g.save(); g.translate(cx, cy); g.rotate(Math.PI * 0.75 + 0.62 * Math.PI * 1.5); g.fillStyle = PAINT; g.fillRect(-6, -2, 50, 4); g.restore();
    txt(cx, cy + 22, 'O₂', 13, '#7aa4d8'); txt(cx, cy + 38, 'kg/cm²', 9, PAINT, 600);
  }
  { // the oxygen flow blinker
    const [x, y, w, h] = LBL.o2flow; const cx = x + w / 2, cy = y + h / 2;
    dial(cx, cy, 56); g.fillStyle = '#e8e4d0'; g.fillRect(cx - 30, cy - 8, 26, 16); g.fillRect(cx + 4, cy - 8, 26, 16);
    txt(cx, cy + 30, 'Durchfluss', 10, PAINT, 600);
  }
  { // the magneto switch's plate (Zündschalter: 0, M1, M2, M1+2)
    const [x, y, w, h] = LBL.magneto; const cx = x + w / 2, cy = y + h / 2;
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(cx, cy, 60, 0, TAU); g.fill();
    for (const [t, a] of [['0', -Math.PI * 0.8], ['M1', -Math.PI * 0.6], ['M2', -Math.PI * 0.4], ['M1+2', -Math.PI * 0.2]]) txt(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44, t, 13);
    txt(cx, cy + 40, 'ZÜNDUNG', 12);
  }
  { // the armament pedestal's switch plate
    const [x, y, w, h] = LBL.pedestal;
    g.fillStyle = '#26282a'; g.fillRect(x, y, w, h); grain(x, y, w, h);
    txt(x + w / 2, y + 26, 'WAFFEN', 22);
    for (let i = 0; i < 3; i++) { txt(x + 48 + i * 80, y + 120, ['Rumpf', 'Flügel i.', 'Flügel a.'][i], 14); txt(x + 48 + i * 80, y + 64, 'EIN', 12, '#c9c4ae', 600); txt(x + 48 + i * 80, y + 98, 'AUS', 12, '#c9c4ae', 600); }
    txt(x + w / 2, y + 170, 'ABWURF', 18); plate(x + 40, y + 200, w - 80, 30); txt(x + w / 2, y + 215, 'NUR IM NOTFALL', 14, '#111');
  }
  { // the placards: the fuel grade triangle and the canopy's
    let [x, y, w, h] = LBL.c3;
    plate(x, y, w, h, '#d6c86a'); txt(x + w / 2, y + 22, 'KRAFTSTOFF C 3', 22, '#111', 800); txt(x + w / 2, y + 48, '96 OKTAN  —  232 L / 292 L', 15, '#111', 700);
    [x, y, w, h] = LBL.canopy;
    plate(x, y, w, h, '#cfcab4'); txt(x + w / 2, y + 20, 'ACHTUNG! VOR DEM NOTABWURF', 16, '#7a1410', 800); txt(x + w / 2, y + 44, 'KOPF NACH VORN NEHMEN', 16, '#7a1410', 800);
  }
  LABELS = new THREE.CanvasTexture(c);
  LABELS.colorSpace = THREE.SRGBColorSpace; LABELS.anisotropy = 8;
  return LABELS;
}

/** A w x h plane showing one region of the labels' texture. */
function labelGeo(region, w, h) {
  const [x, y, rw, rh] = region, g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * rw) / LW, 1 - (y + (1 - uv.getY(i)) * rh) / LW);
  return g;
}

// ---------- the procedural textures: worn paint and the skin's rivets

let WEAR = null, RIVETS = null;
function wearTex() {
  if (WEAR) return WEAR;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), r = rng(23);
  g.fillStyle = '#dadada'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) { const x = r() * 512, y = r() * 512, rr = 10 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(0,0,0,${0.05 + r() * 0.09})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); } // grime
  for (let i = 0; i < 14000; i++) { const v = 200 + r() * 55 | 0; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(r() * 512, r() * 512, 1.5, 1.5); } // grain
  g.lineCap = 'round'; // chips through to the primer and the bare metal, scuffs where hands and boots go
  for (let i = 0; i < 220; i++) { const x = r() * 512, y = r() * 512; g.strokeStyle = r() < 0.7 ? 'rgba(255,255,255,0.55)' : 'rgba(150,160,140,0.6)'; g.lineWidth = 0.6 + r() * 1.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 26, y + (r() - 0.5) * 8); g.stroke(); }
  WEAR = new THREE.CanvasTexture(c);
  WEAR.wrapS = WEAR.wrapT = THREE.RepeatWrapping; WEAR.colorSpace = THREE.SRGBColorSpace; WEAR.anisotropy = 4;
  return WEAR;
}
function rivetTex() {
  if (RIVETS) return RIVETS;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256);
  g.fillStyle = '#a8a8a8';
  for (let k = 6; k < 256; k += 9) { g.beginPath(); g.arc(k, 7, 1.6, 0, 7); g.fill(); g.beginPath(); g.arc(7, k, 1.6, 0, 7); g.fill(); g.beginPath(); g.arc(k, 128, 1.4, 0, 7); g.fill(); }
  RIVETS = new THREE.CanvasTexture(c);
  RIVETS.wrapS = RIVETS.wrapT = THREE.RepeatWrapping; RIVETS.anisotropy = 4;
  return RIVETS;
}
let SPIRAL = null;
function spiralTex() {
  if (SPIRAL) return SPIRAL;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4, w = ((x / 256 + (y / 256) * 0.9) % 1) < 0.16; img.data[i] = img.data[i + 1] = img.data[i + 2] = w ? 255 : 60; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  SPIRAL = new THREE.CanvasTexture(c); SPIRAL.colorSpace = THREE.SRGBColorSpace;
  return SPIRAL;
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
  g.clearGroups();
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

/** A flat pane through three or four corners. */
function quadGeo(a, b, c, d = null) {
  const g = new THREE.BufferGeometry(), pts = d ? [a, b, c, a, c, d] : [a, b, c];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => p.toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d ? [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] : [0, 0, 1, 0, 1, 1], 2));
  g.computeVertexNormals();
  return g;
}

/** The fuselage: superelliptic sections, open above the sill over the cockpit, the MG 131 humps pushed out of it. */
function fuselageGeo() {
  const N = 48, n = T.n, pos = [], uv = [], col = [], idx = [];
  const top = new THREE.Color(T.top), side = new THREE.Color(T.side), belly = new THREE.Color(T.belly), mottle = new THREE.Color(T.mottle);
  const pe = (v, e) => Math.sign(v) * Math.abs(v) ** e;
  const at = (st, th) => { const [, w, yt, ym, yb] = st, s = Math.sin(th), c = Math.cos(th); return [w * pe(s, 2 / n), c >= 0 ? ym + (yt - ym) * Math.abs(c) ** (2 / n) : ym - (ym - yb) * Math.abs(c) ** (2 / n)]; };
  const r = rng(3);
  const last = T.body.findLastIndex((st) => st.length > 5), rearTop = T.body[last + 1][2];
  const sillY = T.body[last][5], opens = T.body.map((st) => st.length > 5);
  T.body.forEach((st0, i) => {
    const st = opens[i] ? [st0[0], st0[1], rearTop, st0[3], st0[4]] : st0, [z, , yt, ym] = st;
    let along = 0, prev = null;
    for (let k = 0; k <= N; k++) {
      let [x, y] = at(st, (k / N) * Math.PI * 2);
      for (const [bx, by, bz, bl, bw, bh] of T.bumps) {
        const f = bh * Math.exp(-(((z - bz) / bl) ** 2) - ((x - bx) ** 2 + (y - by) ** 2) / (bw * bw));
        if (f > 1e-4) { const nx = x, ny = y - ym, l = Math.hypot(nx, ny) || 1; x += (nx / l) * f; y += (ny / l) * f; }
      }
      if (opens[i]) y = Math.min(y, sillY);
      if (prev) along += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
      pos.push(x, y, z); uv.push(along / 0.5, z / 0.5);
      const h = (y - ym) / Math.max(0.01, yt - ym);
      const c = h > 0.35 ? top.clone().lerp(side, clamp((0.8 - h) / 0.45, 0, 1)) : side.clone().lerp(belly, clamp((0.1 - h) / 0.4, 0, 1));
      if (h > -0.1 && h < 0.6 && r() < 0.35) c.lerp(mottle, 0.35);
      col.push(c.r, c.g, c.b);
    }
    if (i) for (let k = 0; k < N; k++) {
      const a = (i - 1) * (N + 1) + k, b = a + N + 1;
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

/** A tapered wing with a real airfoil and 6 degrees of dihedral, out to one side. */
function wingGeo(s) {
  const [wy, span, root, tip, le, sweep] = T.wing, M = 24, pos = [], uv = [], col = [], idx = [];
  const topC = new THREE.Color(T.top), botC = new THREE.Color(T.belly);
  const foil = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  [[0.36, root, le, 0.12], [span, tip, le + sweep, 0.09]].forEach(([x, chord, z0, t], j) => {
    const y0 = wy + (x - 0.36) * Math.tan(THREE.MathUtils.degToRad(6));
    for (let k = 0; k <= M; k++) {
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

/** A gloved hand, closed round a grip: a palm, a thumb, the curl of the fingers, the gauntlet's cuff. */
function hand(mat) {
  const g = mergeGeometries([
    new RoundedBoxGeometry(0.08, 0.042, 0.095, 2, 0.015),
    new THREE.CapsuleGeometry(0.021, 0.066, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.02, -0.053),
    new THREE.CapsuleGeometry(0.013, 0.04, 3, 6).rotateX(0.8).translate(-0.046, 0.02, -0.02),
    new THREE.CylinderGeometry(0.036, 0.031, 0.08, 10).rotateX(Math.PI / 2).translate(0, -0.004, 0.085),
    new THREE.CapsuleGeometry(0.03, 0.08, 3, 8).rotateX(Math.PI / 2).translate(0, -0.006, 0.16),
  ].map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; }));
  return new THREE.Mesh(g, mat);
}

/** A cast rudder pedal: a plate with its lightening cut-outs, toe strap and heel cup (shape in x/y, metres). */
function pedalGeo() {
  const w = 0.095, h = 0.17, rr = 0.014, s = new THREE.Shape();
  s.moveTo(-w / 2 + rr, -h / 2); s.lineTo(w / 2 - rr, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr);
  s.lineTo(w / 2, h / 2 - rr); s.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2); s.lineTo(-w / 2 + rr, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr); s.lineTo(-w / 2, -h / 2 + rr); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
  const slot = (y, sw, sh) => { const p = new THREE.Path(), r2 = sh / 2; p.moveTo(-sw / 2 + r2, y - r2); p.lineTo(sw / 2 - r2, y - r2); p.absarc(sw / 2 - r2, y, r2, -Math.PI / 2, Math.PI / 2, false); p.lineTo(-sw / 2 + r2, y + r2); p.absarc(-sw / 2 + r2, y, r2, Math.PI / 2, Math.PI * 1.5, false); return p; };
  for (const y of [0.05, 0.005, -0.04]) s.holes.push(slot(y, 0.06, 0.024));
  const tri = new THREE.Path(); tri.moveTo(-0.018, 0.068); tri.lineTo(0.018, 0.068); tri.lineTo(0, 0.08); tri.closePath(); s.holes.push(tri);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -0.004);
  return g;
}

/** An instrument panel: a plate w x h with round holes for the dials and chamfered top corners. */
function panelGeo(w, h, holes, chamfer = 0.03) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2 - chamfer); s.lineTo(w / 2 - chamfer, h / 2);
  s.lineTo(-w / 2 + chamfer, h / 2); s.lineTo(-w / 2, h / 2 - chamfer); s.closePath();
  for (const [x, y, r] of holes) { const p = new THREE.Path(); p.absarc(x, y, r, 0, TAU, true); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 32 });
  g.translate(0, 0, -0.006);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  return g;
}

/** The Fw 190 A-8 cockpit; call .userData.update(state, dt) every frame and .userData.night(k) as the light changes. */
export function buildFw190Cockpit() {
  const root = new THREE.Group();
  root.matrixAutoUpdate = false; // placed on the fighter each frame (pilot.js)
  const g = new THREE.Group(); // everything below is relative to the eye
  g.position.fromArray(T.eye);
  root.add(g);
  const wear = wearTex(), rivets = rivetTex(), labels = labelTex();

  // ---- materials
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const skin = std({ vertexColors: true, map: wear, bumpMap: rivets, bumpScale: 0.6, roughness: 0.62, metalness: 0.15, side: THREE.FrontSide });
  const inside = std({ color: RLM66, vertexColors: true, map: wear, bumpMap: rivets, bumpScale: 0.2, roughness: 0.95, metalness: 0.1, envMapIntensity: 0.25, side: THREE.BackSide }); // (seen edge-on, a smoother paint mirrored the sky)
  const paint = std({ color: RLM66, map: wear, roughness: 0.72, metalness: 0.25 }); // the fittings, RLM 66
  const panelPaint = std({ color: 0x33373a, map: wear, roughness: 0.66, metalness: 0.25 }); // the panels, a little darker and smoother
  const black = std({ color: 0x141414, map: wear, roughness: 0.55, metalness: 0.3 });
  const bakelite = std({ color: 0x0f0d0c, roughness: 0.32, metalness: 0.05 }); // the grips and knobs
  const steel = std({ color: 0x777b7e, roughness: 0.38, metalness: 0.85 });
  const darkSteel = std({ color: 0x2c2e30, roughness: 0.45, metalness: 0.7 });
  const alu = std({ color: 0xa4a8aa, map: wear, roughness: 0.42, metalness: 0.8 }); // the cast pedals, bare
  const leather = std({ color: 0x3b2a1e, roughness: 0.82 });
  const pad = std({ color: 0x6e4e30, map: wear, roughness: 0.78 }); // the headrest's tan leather
  const rubber = std({ color: 0x1a1a1a, roughness: 0.9 });
  const webbing = std({ color: 0xa8976e, map: wear, roughness: 0.95 }); // the harness's canvas
  const suit = std({ color: 0x3e3a30, roughness: 0.95 });
  const red = std({ color: 0x9a1f16, roughness: 0.5 });
  const yellow = std({ color: 0xc9a227, roughness: 0.5 }); // fuel: the German colour code
  const blue = std({ color: 0x2c5a8c, roughness: 0.5 }); // oxygen
  const white = std({ color: 0xd8d4c4, roughness: 0.6 });
  const exhaust = std({ color: 0x3a2a22, roughness: 0.9, metalness: 0.4 });
  const labelMat = std({ map: labels, roughness: 0.6, metalness: 0.15 });
  const hoopMat = std({ color: 0x5f676e, map: wear, roughness: 0.5, metalness: 0.45 }); // the hoop: RLM 66 worn thin, catching the light
  const frameOut = std({ color: T.top, map: wear, roughness: 0.6, metalness: 0.25 });
  const frameIn = std({ color: RLM66, map: wear, roughness: 0.7, metalness: 0.25 });
  const glass = wetGlass(new THREE.MeshPhysicalMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.06, roughness: 0.03, depthWrite: false, side: THREE.DoubleSide }));
  const armour = wetGlass(new THREE.MeshPhysicalMaterial({ color: 0xe4efe8, transparent: true, opacity: 0.05, roughness: 0.02, depthWrite: false, side: THREE.DoubleSide }));
  const armourEdge = new THREE.MeshPhysicalMaterial({ color: 0x4d6b5c, transparent: true, opacity: 0.32, roughness: 0.05, depthWrite: false });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xbcd8e0, transparent: true, opacity: 0.16, roughness: 0.03, depthWrite: false, side: THREE.DoubleSide });
  const filter = new THREE.MeshPhysicalMaterial({ color: 0x5a4a28, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const lampGreen = std({ color: 0x1a3a1c, emissive: 0x2bd14a, emissiveIntensity: 0.15, roughness: 0.3 });
  const lampRed = std({ color: 0x3a1210, emissive: 0xff2a14, emissiveIntensity: 0.6, roughness: 0.3 }); // (the gear's up-and-locked lamps: lit)
  const warn = std({ color: 0x3a1210, emissive: 0xff2a14, emissiveIntensity: 0, roughness: 0.3 }); // the fuel warning lamp
  const art = new DialArt();
  const dialMat = std({ map: art.tex, emissiveMap: art.tex, emissive: 0x000000, roughness: 0.3, metalness: 0.05 });

  // the static parts, by material, merged at the end
  const parts = new Map();
  const _o = new THREE.Object3D();
  const add = (mat, geo) => { (parts.get(mat) ?? parts.set(mat, []).get(mat)).push(geo); return geo; };
  const put = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.set(sx, sy, sz); _o.updateMatrix();
    return add(mat, geo.clone().applyMatrix4(_o.matrix));
  };
  const putM = (mat, geo, m) => add(mat, geo.clone().applyMatrix4(m));
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.006) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const cyl = (r0, r1, h, s = 14) => new THREE.CylinderGeometry(r0, r1, h, s);
  const P = (x, y, z) => new V3(x, y, z);
  const bar = (mat, a, b, w = 0.03, d = 0.04, out) => add(mat, barGeo(a, b, w, d, out));
  const widthAt = (z) => { const b = T.body; for (let i = 1; i < b.length; i++) if (z <= b[i][0]) { const k = (z - b[i - 1][0]) / (b[i][0] - b[i - 1][0]); return b[i - 1][1] + (b[i][1] - b[i - 1][1]) * k; } return b[b.length - 1][1]; };
  const sill = -0.14, wall = (z) => widthAt(z) - 0.035;
  const M4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(P(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(1, 1, 1));

  // ---- outside: the fuselage skin (painted outside, RLM 66 inside), the spinner and fan, the propeller's blur, the exhausts, the wings
  const body = fuselageGeo();
  add(skin, body);
  { // the inside of the skin, darkened where little light gets in: under the coaming ahead, down by the floor
    const ib = body.clone(), p = ib.attributes.position, c = ib.attributes.color;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i), k = (z < -0.46 ? 0.3 : 1) * clamp(1 + (y + 0.5) * 0.9, 0.45, 1); c.setXYZ(i, k, k, k); }
    add(inside, ib);
  }
  const front = T.body[0], cy = front[3], prop = -T.prop;
  const spinner = std({ color: 0x1e2a1e, roughness: 0.45, metalness: 0.3, map: spiralTex() });
  put(spinner, new THREE.SphereGeometry(front[1] * 0.95, 24, 12, 0, TAU, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 2.1), 0, cy, prop + 0.05);
  put(black, new THREE.CircleGeometry(front[1] * 0.98, 32), 0, cy, front[0] + 0.12); // the cooling fan behind the spinner
  for (let k = 0; k < 12; k++) put(steel, box(0.05, front[1] * 0.85, 0.01), 0, cy, front[0] + 0.1, 0, 0.5, (k / 12) * TAU);
  const blur = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.RingGeometry(front[1] * 0.6, 1.6, 48), blur);
  disc.position.set(0, cy, prop - 0.05); g.add(disc);
  { const [ex, ey, ea, eb, en] = T.exhausts;
    for (const s of [-1, 1]) for (let k = 0; k < en; k++) {
      const z = ea + (k / Math.max(1, en - 1)) * (eb - ea);
      put(exhaust, box(0.07, 0.05, 0.085), s * ex, ey, z, 0.25, 0, s * -0.35);
      put(black, box(0.05, 0.03, 0.03), s * (ex + 0.035), ey - 0.01, z + 0.03, 0.25, 0, s * -0.35);
    } }
  for (const s of [-1, 1]) add(skin, wingGeo(s));

  // ---- the tub: frames and stringers on the walls, the forward bulkhead behind the panel, the floor, the
  // canopy rails, the turtle deck behind the head armour
  for (const z of [-0.42, -0.12, 0.18, 0.5]) for (const s of [-1, 1]) put(paint, box(0.022, 0.8, 0.03), s * (wall(z) - 0.005), sill - 0.42, z);
  for (const y of [sill - 0.2, sill - 0.55]) for (const s of [-1, 1]) put(paint, box(0.018, 0.022, 1.25), s * (wall(0) - 0.004), y, 0.05);
  put(panelPaint, box(0.86, 0.85, 0.02), 0, -0.63, -0.76); // the bulkhead ahead of your knees
  put(black, box(0.86, 0.02, 1.5), 0, -1.08, -0.25); // the floor (the wing's spar box under you)
  for (const s of [-1, 1]) {
    put(frameIn, box(0.045, 0.03, 1.27), s * (widthAt(0.2) - 0.022), sill + 0.012, 0.185); // the canopy rails, along the sills
    put(darkSteel, box(0.01, 0.01, 1.22), s * (widthAt(0.2) - 0.05), sill + 0.024, 0.185); // (their tracks)
  }
  put(paint, box(0.78, 0.012, 0.62), 0, sill - 0.012, 0.56); // the deck behind the armour

  // ---- the hoop: the tube arching over the panel's shroud from wall to wall
  const hoopPts = [P(-0.39, -0.46, -0.48), P(-0.37, -0.22, -0.5), P(-0.26, -0.12, -0.53), P(0, -0.095, -0.55), P(0.26, -0.12, -0.53), P(0.37, -0.22, -0.5), P(0.39, -0.46, -0.48)];
  add(hoopMat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hoopPts), 48, 0.02, 12));
  for (const s of [-1, 1]) put(darkSteel, cyl(0.026, 0.026, 0.03, 12), s * 0.39, -0.46, -0.5); // (its feet)

  // ---- the panels: upper (main) and lower, recessed dials behind their holes, four screws round each
  const UP = { x: 0, y: -0.268, z: -0.645, w: 0.46, h: 0.23, tilt: -0.15 };
  const LO = { x: 0, y: -0.47, z: -0.672, w: 0.37, h: 0.12, tilt: -0.5 };
  // [panel, kind, x, y, r] in the panel's own metres (from its centre)
  const DIAL_AT = [
    [UP, 'afn', -0.192, 0.03, 0.024], [UP, 'speed', -0.122, 0.03, 0.04], [UP, 'horizon', -0.031, 0.03, 0.041], [UP, 'compass', 0.06, 0.03, 0.04], [UP, 'climb', 0.15, 0.03, 0.037],
    [UP, 'alt', -0.137, -0.066, 0.04], [UP, 'pitch', -0.051, -0.072, 0.03], [UP, 'boost', 0.033, -0.07, 0.035], [UP, 'rpm', 0.123, -0.068, 0.037],
    [LO, 'press', -0.135, 0.0, 0.029], [LO, 'oilt', -0.068, 0.0, 0.029], [LO, 'fuel', 0.004, 0.0, 0.033], [LO, 'clock', 0.08, 0.0, 0.03],
  ];
  const pmat = (p) => M4(p.x, p.y, p.z, p.tilt);
  for (const p of [UP, LO]) {
    const holes = DIAL_AT.filter((d) => d[0] === p).map(([, , x, y, r]) => [x, y, r + 0.003]);
    const m = pmat(p);
    putM(panelPaint, panelGeo(p.w, p.h, holes, p === UP ? 0.035 : 0.02), m);
    putM(black, box(p.w - 0.01, p.h - 0.01, 0.002).translate(0, 0, -0.03), m); // (the dark behind the holes)
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) putM(rubber, cyl(0.009, 0.009, 0.016, 10).rotateX(Math.PI / 2).translate(sx * (p.w / 2 - 0.012), sy * (p.h / 2 - 0.012), 0.004), m); // the shock mounts
  }
  const faces = [];
  for (const [p, kind, x, y, r] of DIAL_AT) {
    const m = pmat(p), [cx, cy2] = cellOf(kind);
    const face = new THREE.CircleGeometry(r, 40), uv = face.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + (uv.getX(i) * 2 - 1) * CR) / AW, 1 - (cy2 - (uv.getY(i) * 2 - 1) * CR) / AH);
    faces.push(face.translate(x, y, -0.011).applyMatrix4(m));
    putM(black, new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.012, 32, 1, true).rotateX(Math.PI / 2).translate(x, y, -0.006), m); // the instrument's can in the hole
    putM(black, new THREE.TorusGeometry(r + 0.0015, 0.0022, 6, 36).translate(x, y, -0.004), m); // its bezel ring
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2, d = r + 0.009; putM(darkSteel, cyl(0.0028, 0.0028, 0.002, 8).rotateX(Math.PI / 2).translate(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.001), m); }
  }
  { // the SZKK 4's box on the panel's top band, left of the sight
    const [sx, sy, sw, sh] = SZKK, w = 0.115, h = w * sh / sw, m = pmat(UP);
    const q = new THREE.PlaneGeometry(w, h), uv = q.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (sx + uv.getX(i) * sw) / AW, 1 - (sy + (1 - uv.getY(i)) * sh) / AH);
    faces.push(q.translate(-0.085, 0.087, 0.006).applyMatrix4(m));
    putM(black, rbox(w + 0.01, h + 0.01, 0.012, 0.003).translate(-0.085, 0.087, 0.0), m);
  }
  const dialMesh = new THREE.Mesh(mergeGeometries(faces.map((f) => tidy(f, false))), dialMat);
  g.add(dialMesh);
  { // the upper panel's small fittings: the clock's winder, toggles and lamps on the top band right of the sight
    const m = pmat(UP);
    putM(black, cyl(0.006, 0.006, 0.014, 10).rotateX(Math.PI / 2).translate(0.08 + 0.022, -0.0 - 0.0, 0.007), pmat(LO)); // the clock's winding knob
    for (let k = 0; k < 3; k++) { putM(darkSteel, cyl(0.006, 0.006, 0.006, 10).rotateX(Math.PI / 2).translate(0.07 + k * 0.03, 0.094, 0.003), m); putM(steel, cyl(0.0022, 0.003, 0.02, 6).translate(0, 0.01, 0).rotateZ(0.0).rotateX(-0.5).translate(0.07 + k * 0.03, 0.094, 0.008), m); }
    putM(lampGreen, new THREE.SphereGeometry(0.0055, 10, 8).translate(0.165, 0.094, 0.004), m);
    putM(labelMat, labelGeo(LBL.canopy, 0.1, 0.025), M4(-0.17, -0.17, -0.63, -0.15)); // the canopy placard, top left
  }
  { // the lower panel: the fuel warning lamp, the tank selector, the fuel-grade placard
    const m = pmat(LO);
    const wl = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2).applyMatrix4(new THREE.Matrix4().makeTranslation(0.132, 0.02, 0.002)).applyMatrix4(m), warn);
    g.add(wl);
    putM(darkSteel, cyl(0.011, 0.011, 0.005, 16).rotateX(Math.PI / 2).translate(0.132, 0.02, 0.0), m);
    putM(black, cyl(0.008, 0.008, 0.008, 12).rotateX(Math.PI / 2).translate(0.15, -0.025, 0.004), m); // the fuel gauge's selector: vorn / hinten
    putM(steel, box(0.004, 0.018, 0.006).translate(0.15, -0.025, 0.01).rotateZ(0), m);
    putM(labelMat, labelGeo(LBL.c3, 0.07, 0.0175), new THREE.Matrix4().makeTranslation(-0.1, -0.048, 0.002).premultiply(m));
  }
  // the shroud over the upper panel: a curved hood from the bulkhead back to the hoop, its lip rolled
  const hood = new THREE.CylinderGeometry(0.34, 0.34, 0.16, 28, 1, true, -Math.PI * 0.5, Math.PI).rotateX(Math.PI / 2).scale(1, 0.12, 1);
  put(panelPaint, hood, 0, -0.158, -0.66);
  put(panelPaint, cyl(0.009, 0.009, 0.68, 8), 0, -0.158, -0.58, 0, 0, Math.PI / 2, 1, 1, 1);
  // either side of the upper panel, under the hoop: the side panels, the magneto switch, the starter
  for (const s of [-1, 1]) put(panelPaint, box(0.15, 0.24, 0.012), s * 0.31, -0.29, -0.69, -0.1, s * 0.35, 0);
  put(labelMat, labelGeo(LBL.magneto, 0.055, 0.055), 0.29, -0.25, -0.676, -0.1, -0.35, 0);
  put(bakelite, rbox(0.012, 0.03, 0.012, 0.004), 0.29, -0.25, -0.668, -0.1, -0.35, -0.6); // the magneto switch's key
  put(black, cyl(0.01, 0.01, 0.014, 12), -0.3, -0.24, -0.68, Math.PI / 2 - 0.1, 0.35, 0); // the starter's button (Anlasser)
  put(red, cyl(0.007, 0.007, 0.006, 12), -0.3, -0.24, -0.672, Math.PI / 2 - 0.1, 0.35, 0);
  put(labelMat, labelGeo(LBL.o2flow, 0.05, 0.05), -0.3, -0.33, -0.682, -0.1, 0.35, 0); // the oxygen flow blinker
  // the centre pedestal under the lower panel: the armament switches
  put(panelPaint, box(0.12, 0.3, 0.12), 0, -0.68, -0.69);
  put(labelMat, labelGeo(LBL.pedestal, 0.11, 0.11), 0, -0.6, -0.629, -0.15);
  for (let k = 0; k < 3; k++) { put(darkSteel, cyl(0.005, 0.005, 0.006, 8), -0.035 + k * 0.035, -0.607, -0.627, Math.PI / 2 - 0.15); put(steel, cyl(0.002, 0.0028, 0.018, 6), -0.035 + k * 0.035, -0.6, -0.62, 0.9); }
  put(red, rbox(0.03, 0.012, 0.018, 0.004), 0, -0.648, -0.623); // the emergency jettison (Abwurf), under its guard

  // ---- the Revi 16B on the shroud, on the gun line: its base, the body with the lamp and dimmer, the lens
  // looking up at the reflector glass, the folded sun filter, the rubber pad
  put(darkSteel, box(0.056, 0.014, 0.07), 0, -0.155, -0.49);
  put(black, rbox(0.05, 0.075, 0.08, 0.008), 0, -0.11, -0.49);
  put(black, cyl(0.016, 0.018, 0.035, 16), 0.012, -0.135, -0.44, Math.PI / 2); // the lamp housing, back towards you
  put(black, cyl(0.022, 0.024, 0.012, 20), 0, -0.067, -0.495); // the collimator's lens mount
  put(steel, cyl(0.008, 0.008, 0.012, 12), 0.031, -0.12, -0.47, 0, 0, Math.PI / 2); // the dimmer
  put(white, box(0.002, 0.004, 0.006), 0.0375, -0.115, -0.47);
  put(rubber, rbox(0.044, 0.032, 0.026, 0.01), 0, -0.1, -0.438); // the crash pad
  put(filter, new THREE.PlaneGeometry(0.056, 0.045), 0, -0.058, -0.535, -1.25); // the sun filter, folded down ahead
  put(darkSteel, cyl(0.0035, 0.0035, 0.058, 8), 0, -0.06, -0.513, 0, 0, Math.PI / 2); // its hinge
  { // the reflector glass in its thin frame, leaning back towards you
    const rm = M4(0, -0.03, -0.493, -0.62), w = 0.062, h = 0.058;
    putM(black, box(w + 0.004, 0.005, 0.004).translate(0, -h / 2, 0), rm); // (its foot; the glass's sides and top are bare)
    for (const sx of [-1, 1]) putM(black, box(0.0025, h * 0.45, 0.003).translate(sx * w / 2, -h * 0.27, 0), rm);
    for (const sx of [-1, 1]) put(black, box(0.004, 0.035, 0.008), sx * 0.029, -0.06, -0.5, 0.2); // its side arms
    const reflector = new THREE.Mesh(new THREE.PlaneGeometry(w, h).applyMatrix4(rm), lens);
    g.add(reflector);
  }
  add(black, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([P(0.012, -0.135, -0.42), P(0.035, -0.15, -0.44), P(0.045, -0.152, -0.52), P(0.05, -0.148, -0.63)]), 12, 0.004, 6)); // its lamp's cable

  // ---- the windscreen: the armour glass between raked posts, the quarter panes back to the canopy's front arch
  const zA = -0.45; // the arch
  const fl = P(-0.2, -0.165, -0.73), fr = P(0.2, -0.165, -0.73), tl = P(-0.135, 0.15, zA), tr = P(0.135, 0.15, zA);
  const sl = P(-(widthAt(zA) - 0.02), sill + 0.005, zA), sr = P(widthAt(zA) - 0.02, sill + 0.005, zA);
  { // 50 mm of armour glass: two faces, and the green of its edges where you look through the slab edge-on
    const n = new V3().crossVectors(new V3().subVectors(fr, fl), new V3().subVectors(tl, fl)).normalize(), d = 0.025;
    const off = (p, k) => p.clone().addScaledVector(n, k);
    for (const k of [-d, d]) add(armour, quadGeo(off(fl, k), off(fr, k), off(tr, k), off(tl, k)));
    for (const [a, b] of [[fl, fr], [fr, tr], [tr, tl], [tl, fl]]) add(armourEdge, quadGeo(off(a, -d), off(b, -d), off(b, d), off(a, d)));
  }
  add(glass, quadGeo(fl, sl, tl)); add(glass, quadGeo(fr, tr, sr));
  const fo = P(0, 0.5, -1).normalize();
  for (const [a, b, w] of [[fl, tl, 0.034], [fr, tr, 0.034], [tl, tr, 0.03], [fl, fr, 0.03]]) bar(frameIn, a, b, w, 0.06, fo); // the armour glass's heavy frame
  for (const [a, b] of [[sl, tl], [sr, tr], [fl, sl], [fr, sr]]) bar(frameIn, a, b, 0.026, 0.03, P(0, 0, 1)); // the quarter panes' frames, the arch
  for (const [a, b] of [[fl, tl], [fr, tr], [tl, tr]]) for (let k = 1; k < 6; k++) { const p = a.clone().lerp(b, k / 6); put(darkSteel, cyl(0.003, 0.003, 0.004, 6), p.x, p.y, p.z + 0.03, Math.PI / 2 - 0.9); } // (its bolts)

  // ---- the sliding hood: lofted from the arch back to its rear frame, frameless between
  const rearZ = 0.82, K = 22, MM = 20;
  const archPts = (() => { // the arch sampled evenly along sl -> tl -> tr -> sr
    const segs = [[sl, tl], [tl, tr], [tr, sr]], lens = segs.map(([a, b]) => a.distanceTo(b)), tot = lens.reduce((a, b) => a + b), out = [];
    for (let k = 0; k <= MM; k++) { let d = (k / MM) * tot, i = 0; while (i < 2 && d > lens[i]) d -= lens[i++]; out.push(segs[i][0].clone().lerp(segs[i][1], clamp(d / lens[i], 0, 1))); }
    return out;
  })();
  const hw = (z) => widthAt(z) - 0.02;
  const hh = (z) => { const k = (z - zA) / (rearZ - zA); return 0.15 + 0.13 * Math.sin(Math.min(1, k * 2.2) * Math.PI / 2) - (k > 0.45 ? ((k - 0.45) / 0.55) ** 1.4 * 0.16 : 0); };
  const ell = (z, k) => { const a = -Math.PI / 2 + (k / MM) * Math.PI; return P(hw(z) * Math.sin(a), sill + 0.005 + (hh(z) - sill) * Math.cos(a) ** 0.75, z); };
  const section = (z) => { const b = THREE.MathUtils.smoothstep(z, zA, zA + 0.3); const out = []; for (let k = 0; k <= MM; k++) out.push(archPts[k].clone().setZ(z).lerp(ell(z, k), b)); return out; };
  {
    const pos = [], idx = [];
    for (let j = 0; j <= K; j++) {
      const z = zA + (j / K) * (rearZ - zA);
      for (const p of section(z)) pos.push(p.x, p.y, p.z);
      if (j) for (let k = 0; k < MM; k++) { const a = (j - 1) * (MM + 1) + k, b = a + MM + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(idx); cg.computeVertexNormals();
    add(glass, cg);
    const rear = section(rearZ);
    for (let k = 0; k < MM; k++) bar(frameOut, rear[k], rear[k + 1], 0.028, 0.032, P(0, 0, 1)); // its rear frame
    const front2 = section(zA + 0.02);
    for (let k = 0; k < MM; k++) bar(frameIn, front2[k], front2[k + 1], 0.014, 0.022, P(0, 0, 1)); // (its front edge, over the arch)
    for (const s of [-1, 1]) bar(frameIn, P(s * hw(zA), sill + 0.02, zA), P(s * hw(rearZ), sill + 0.02, rearZ), 0.03, 0.026, P(0, 1, 0)); // its bottom frames
  }
  // the head armour in the hood, just behind your head: a shaped plate, its padded rest, its struts
  { const s = new THREE.Shape(); s.moveTo(-0.15, -0.18); s.lineTo(0.15, -0.18); s.lineTo(0.15, 0.1); s.quadraticCurveTo(0.14, 0.2, 0, 0.21); s.quadraticCurveTo(-0.14, 0.2, -0.15, 0.1); s.closePath();
    put(darkSteel, new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 10 }), 0, 0.0, 0.29, -0.1); }
  put(pad, rbox(0.17, 0.11, 0.05, 0.022), 0, 0.03, 0.265, -0.1); // the headrest
  for (const k of [-1, 0, 1]) put(leather, box(0.0015, 0.095, 0.002), k * 0.045, 0.03, 0.2395, -0.1); // (its stitched tucks)
  for (const s of [-1, 1]) bar(darkSteel, P(s * 0.1, 0.18, 0.31), P(s * 0.13, hh(0.4) - 0.01, 0.4), 0.014, 0.01, P(0, 0, 1));

  // ---- the seat and its armour, the harness, your legs
  put(paint, new THREE.CylinderGeometry(0.22, 0.2, 0.46, 18, 1, true, -Math.PI * 0.55, Math.PI * 1.1).rotateY(Math.PI), 0, -0.74, 0.3, 0, 0, 0, 1, 1, 0.55);
  put(paint, box(0.42, 0.025, 0.4), 0, -0.98, 0.16);
  put(darkSteel, box(0.44, 0.6, 0.008), 0, -0.6, 0.42, 0.12); // the back armour (8 mm)
  for (const s of [-1, 1]) {
    put(suit, new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), s * 0.12, -0.69, -0.105, -1.19); // the thighs, rising to the knees
    put(suit, new THREE.CapsuleGeometry(0.06, 0.42, 4, 10), s * 0.13, -0.76, -0.565, 0.98); // the shins, down to the pedals
    put(leather, rbox(0.1, 0.09, 0.26, 0.03), s * 0.13, -0.98, -0.82, -0.35); // the boots
    bar(webbing, P(s * 0.2, -0.72, 0.15), P(s * 0.04, -0.62, -0.02), 0.045, 0.004, P(0, 1, 0.3)); // the lap straps
    bar(webbing, P(s * 0.12, -0.32, 0.12), P(s * 0.05, -0.6, -0.04), 0.045, 0.004, P(0, 0.3, -1)); // the shoulder straps, down your chest
  }
  put(steel, cyl(0.035, 0.035, 0.012, 20), 0, -0.6, -0.04, 1.2); // the harness's quick release (Schloss)

  // ---- the rudder pedals: cast, with their cut-outs, on their arms
  const pg = pedalGeo();
  for (const s of [-1, 1]) {
    put(alu, pg, s * 0.13, -0.93, -0.92, -0.45);
    put(alu, box(0.1, 0.022, 0.03), s * 0.13, -0.99, -0.88, -0.45); // the heel bar
    put(leather, box(0.1, 0.01, 0.03), s * 0.13, -0.88, -0.94, -0.45); // the toe strap
    put(steel, cyl(0.009, 0.009, 0.22, 8), s * 0.13, -0.9, -1.04, Math.PI / 2 - 0.5); // the arm
    put(steel, cyl(0.014, 0.014, 0.05, 10), s * 0.13, -0.84, -1.13, 0, 0, Math.PI / 2); // its pivot
  }

  // ---- the left console: gear and flap buttons, the throttle quadrant (the Kommandogerät's lever), the
  // tailplane trim switch and indicator, the fuel cock
  const L = -(wall(-0.2) - 0.075), R = -L, top = -0.46;
  for (const s of [-1, 1]) {
    put(paint, rbox(0.15, 0.06, 0.82, 0.008), s * (wall(-0.2) - 0.075), top - 0.03, -0.24); // the console's shelf
    put(paint, box(0.15, 0.3, 0.012), s * (wall(-0.2) - 0.075), top - 0.18, -0.65); // its front
  }
  put(labelMat, labelGeo(LBL.gear, 0.11, 0.11), L, top + 0.002, -0.55, -Math.PI / 2);
  for (const [bx, bz, mat] of [[-0.022, -0.586, black], [0.022, -0.586, black], [-0.03, -0.537, black], [0, -0.537, black], [0.03, -0.537, black]]) {
    put(darkSteel, cyl(0.008, 0.008, 0.004, 12), L + bx, top + 0.004, bz); put(mat, cyl(0.006, 0.006, 0.01, 12), L + bx, top + 0.009, bz);
  }
  for (const [bx, mat] of [[-0.04, lampRed], [-0.03, lampRed], [0.03, lampGreen], [0.04, lampGreen]]) put(mat, new THREE.SphereGeometry(0.0045, 8, 6), L + bx, top + 0.005, -0.6);
  put(paint, rbox(0.04, 0.06, 0.28, 0.006), L - 0.03, top + 0.03, -0.32); // the quadrant's housing
  put(labelMat, labelGeo(LBL.quadrant, 0.26, 0.13), L - 0.0095, top + 0.03, -0.32, 0, Math.PI / 2, 0, 1, 0.45, 1);
  put(black, box(0.006, 0.01, 0.24), L - 0.03, top + 0.061, -0.32); // its slot
  put(black, rbox(0.035, 0.025, 0.06), L + 0.005, top + 0.012, -0.08); // the trim switch's box
  put(steel, cyl(0.003, 0.004, 0.022, 6), L + 0.005, top + 0.03, -0.08, 0.3);
  put(labelMat, labelGeo(LBL.trim, 0.06, 0.06), -(wall(-0.05) - 0.002), top + 0.09, -0.05, 0, Math.PI / 2, 0); // the trim indicator, on the wall
  put(yellow, rbox(0.012, 0.01, 0.05, 0.003), L + 0.01, top + 0.02, 0.05, 0, 0.3, 0); // the fuel cock's lever (yellow: fuel)
  put(darkSteel, cyl(0.016, 0.016, 0.008, 16), L + 0.0, top + 0.01, 0.04);
  add(yellow, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([P(L - 0.05, top - 0.05, 0.2), P(L - 0.05, top - 0.12, -0.2), P(L - 0.04, top - 0.2, -0.6)]), 16, 0.005, 6)); // the fuel line along the wall

  // ---- the right console: the breaker panel and its lid, the FuG 16Z, the oxygen, the canopy crank, the jettison
  put(black, rbox(0.13, 0.03, 0.26, 0.004), R, top + 0.004, -0.46);
  put(labelMat, labelGeo(LBL.breakers, 0.24, 0.12), R, top + 0.0195, -0.46, -Math.PI / 2, 0, -Math.PI / 2);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) { // the breakers' buttons (as the label's grid, turned along the console)
    const x = R + 0.04 - j * 0.0365, z = -0.46 - 0.12 + 0.0206 + i * 0.0385;
    put(black, cyl(0.0065, 0.0065, 0.014, 10), x, top + 0.026, z); put(white, cyl(0.0055, 0.0055, 0.002, 10), x, top + 0.034, z);
  }
  put(paint, box(0.004, 0.11, 0.26), R + 0.07, top + 0.07, -0.46, 0, 0, -0.35); // its lid, open against the wall
  put(black, rbox(0.11, 0.06, 0.12, 0.006), R, top + 0.03, -0.2); // the FuG 16Z control box
  put(labelMat, labelGeo(LBL.fug, 0.11, 0.055), R, top + 0.0605, -0.2, -Math.PI / 2, 0, -Math.PI / 2);
  for (const [dz, rr] of [[-0.025, 0.012], [0.027, 0.01]]) put(bakelite, cyl(rr, rr * 0.9, 0.014, 16), R - 0.0, top + 0.068, -0.2 + dz);
  put(labelMat, labelGeo(LBL.o2, 0.06, 0.06), wall(0.0) - 0.002, top + 0.1, 0.0, 0, -Math.PI / 2, 0); // the oxygen pressure gauge, on the wall
  put(blue, cyl(0.01, 0.01, 0.03, 10), R + 0.02, top + 0.015, 0.06); // the oxygen valve (blue)
  add(blue, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([P(R + 0.02, top + 0.02, 0.07), P(R - 0.05, top - 0.02, 0.14), P(R - 0.14, -0.6, 0.12)]), 12, 0.009, 8)); // the oxygen hose
  { // the canopy crank on the wall
    const cx = wall(0.12) - 0.03;
    put(black, new THREE.TorusGeometry(0.05, 0.006, 8, 24), cx, top + 0.1, 0.12, 0, Math.PI / 2, 0);
    for (let k = 0; k < 3; k++) put(black, box(0.006, 0.1, 0.008), cx, top + 0.1, 0.12, (k / 3) * Math.PI, 0, 0);
    put(bakelite, cyl(0.009, 0.009, 0.05, 10), cx - 0.028, top + 0.13, 0.15, 0, 0, Math.PI / 2);
  }
  put(red, rbox(0.03, 0.014, 0.06, 0.005), R + 0.03, top + 0.12, -0.62, 0, 0, -0.5); // the canopy jettison (Notabwurf), red

  // ---- the stick (the KG 13 B grip) and the throttle, with your hands on them
  const stick = new THREE.Group();
  stick.position.set(0, -0.96, -0.3);
  g.add(stick);
  const sp = (geo, mat, x = 0, y = 0, z = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; stick.add(m); return m; };
  for (let k = 0; k < 5; k++) sp(new THREE.TorusGeometry(0.05 - k * 0.006, 0.012, 6, 18).rotateX(Math.PI / 2), rubber, 0, 0.01 + k * 0.022); // the gaiter's bellows
  sp(cyl(0.014, 0.017, 0.42, 12).translate(0, 0.21, 0), darkSteel);
  sp(cyl(0.019, 0.016, 0.03, 12), steel, 0, 0.42); // the grip's collar
  const grip = new THREE.Group(); grip.position.set(0, 0.43, 0); grip.rotation.x = -0.18; stick.add(grip);
  const gp = (geo, mat, x = 0, y = 0, z = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; grip.add(m); return m; };
  gp(new THREE.CapsuleGeometry(0.019, 0.09, 4, 12), bakelite, 0, 0.06, 0);
  gp(rbox(0.036, 0.03, 0.05, 0.01), bakelite, 0, 0.115, -0.006); // its head
  gp(box(0.008, 0.035, 0.012), steel, 0, 0.07, -0.028, 0.2); // the trigger (the MG 131s)
  gp(cyl(0.007, 0.007, 0.008, 10), red, 0, 0.133, -0.012); // the button on top (the cannon)
  gp(box(0.024, 0.003, 0.026), steel, 0, 0.142, 0.004, -0.6); // its flip cover, open
  gp(cyl(0.006, 0.006, 0.01, 10), black, 0.0, 0.118, 0.022, Math.PI / 2); // the bomb button, at the back
  const rh = hand(leather);
  rh.position.set(0.012, 0.075, 0.02); rh.rotation.set(0.6, 0, -1.45);
  grip.add(rh);
  const throttle = new THREE.Group();
  throttle.position.set(L - 0.03, top + 0.03, -0.32);
  g.add(throttle);
  const lever = new THREE.Group(); throttle.add(lever);
  lever.add(new THREE.Mesh(box(0.008, 0.12, 0.016).translate(0, 0.06, 0), darkSteel));
  const tgrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 4, 12).rotateZ(Math.PI / 2 - 0.25).translate(0.03, 0.13, 0), bakelite);
  lever.add(tgrip);
  const rocker = new THREE.Mesh(box(0.012, 0.008, 0.02), steel); rocker.position.set(0.012, 0.152, 0); lever.add(rocker); // the thumb rocker (the propeller's pitch by hand)
  const lh = hand(leather);
  lh.position.set(0.035, 0.14, 0.02); lh.rotation.set(0.6, 0.35, 0.3);
  lever.add(lh);

  // ---- merge: one mesh per material (glass drawn after the rest)
  for (const [mat, list] of parts) {
    const coloured = !!mat.vertexColors;
    const m = new THREE.Mesh(mergeGeometries(list.map((x) => tidy(x, coloured))), mat);
    if (mat.transparent) m.renderOrder = 2;
    g.add(m);
  }

  // ---- what moves: the dials (redrawn ~15 times a second), the stick, the throttle, the lamps, the night glow
  let redraw = 0, e = readings({});
  art.draw(e);
  root.userData.update = (s, dt) => {
    if ((redraw -= dt) <= 0) {
      redraw = 1 / 15; e = readings(s); art.draw(e);
      warn.emissiveIntensity = e.fuel < 60 ? 1.6 : 0; // the rear tank's warning lamp
    }
    stick.rotation.x = clamp(-(s.stickY ?? 0), -1, 1) * 0.22;
    stick.rotation.z = clamp(-(s.stickX ?? 0), -1, 1) * 0.25;
    lever.rotation.x = 0.5 - clamp(s.throttle ?? 0, 0, 1) * 1.0; // back to idle, forward to Start
  };
  root.userData.night = (k) => {
    dialMat.emissive.setRGB(0.62, 0.95, 0.7).multiplyScalar(k * 1.5); // the radium paint
    lampGreen.emissiveIntensity = 0.15 + k * 0.4;
  };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}
