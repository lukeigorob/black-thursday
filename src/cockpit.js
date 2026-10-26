// The fighter pilot's cockpit, for flying a Bf 109, an Fw 190 or a P-51 in first person: an instrument
// panel whose needles move with the real values (airspeed, altitude, climb, compass, boost, rpm, oil
// and coolant), glowing at night; the reflector gunsight (Revi 16B for the German fighters, K-14 for the
// P-51) with its lit ring and dot on the guns' line; the canopy frame and the armoured glass; the stick
// and throttle moving with your hands on them, your knees; the side consoles and trim wheels in the
// right colours (RLM 66 for the German fighters, interior green and black for the P-51); the cowling out
// in front with the spinner and the propeller's blur, and the wings out to the sides. The aircraft
// models have no cockpit, so this is built here and shown in their place, round the pilot's eye.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wetGlass } from './environment.js';

const TYPES = {
  // eye: the pilot's eye in the model. prop: m ahead of the eye. cowl: front / back radius. wing: m below
  // the eye, span, root and tip chord. units: km/h and km (German) or mph and feet. canopy: its style.
  bf109: { eye: [0, 0.75, -0.8], prop: 3.3, cowl: [0.4, 0.5], wing: [-1.3, 5.2, 1.9, 0.9], skin: 0x5c6470, inside: 0x3c3f42, panel: 0x26282a,
    units: 'metric', canopy: 'framed', sight: 'revi', guns: [[-0.11, -0.12], [0.11, -0.12]] },
  fw190: { eye: [0, 0.86, -0.22], prop: 3.85, cowl: [0.6, 0.64], wing: [-1.3, 5.3, 2.2, 1.1], skin: 0x4a4e58, inside: 0x3c3f42, panel: 0x232527,
    units: 'metric', canopy: 'bubbleArmour', sight: 'revi', guns: [[-0.17, -0.2], [0.17, -0.2]] },
  p51: { eye: [0, 0.85, -0.1], prop: 4.2, cowl: [0.42, 0.52], wing: [-1.15, 5.6, 2.4, 1.0], skin: 0xb9bdc0, inside: 0x56614a, panel: 0x161616,
    units: 'imperial', canopy: 'bubble', sight: 'k14', guns: [] },
};
const V2 = THREE.Vector2, V3 = THREE.Vector3;
const PANEL_W = 1024, PANEL_H = 420; // canvas pixels for the panel (0.7 m x 0.29 m)

/** The panel's dials for each type: [x, y, r, gauge] in canvas pixels. */
const LAYOUT = {
  metric: [[150, 120, 92, 'speed'], [355, 120, 92, 'alt'], [560, 120, 92, 'horizon'], [765, 120, 92, 'climb'], [920, 210, 70, 'compass'],
    [150, 320, 70, 'boost'], [310, 320, 70, 'rpm'], [470, 320, 62, 'oil'], [620, 320, 62, 'coolant'], [775, 330, 62, 'fuel']],
  imperial: [[150, 120, 92, 'speed'], [355, 120, 92, 'horizon'], [560, 120, 92, 'alt'], [765, 120, 92, 'climb'], [920, 210, 70, 'compass'],
    [150, 320, 70, 'boost'], [310, 320, 70, 'rpm'], [470, 320, 62, 'coolant'], [620, 320, 62, 'oil'], [775, 330, 62, 'fuel']],
};

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
  }

  draw(s) {
    const g = this.g, T = this.type, metric = T.units === 'metric';
    const pc = new THREE.Color(T.panel);
    g.fillStyle = `rgb(${pc.r * 255 | 0},${pc.g * 255 | 0},${pc.b * 255 | 0})`;
    g.fillRect(0, 0, PANEL_W, PANEL_H);
    // the panel's screws and its shock-mount panel lines
    g.fillStyle = '#0006';
    for (const [x, y] of [[14, 14], [PANEL_W - 14, 14], [14, PANEL_H - 14], [PANEL_W - 14, PANEL_H - 14]]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    for (const [cx, cy, r, kind] of LAYOUT[T.units]) this.dial(cx, cy, r, kind, s, metric);
    // the placards
    g.fillStyle = '#c9c2a8'; g.font = '600 15px "Courier New", monospace'; g.textAlign = 'left';
    g.fillText(metric ? 'NICHT RAUCHEN' : 'DO NOT EXCEED 505 MPH', 860, 400);
    this.tex.needsUpdate = true;
  }

  /** One gauge: a black face, a white scale with its numbers, the needle. */
  dial(cx, cy, r, kind, s, metric) {
    const g = this.g;
    g.save(); g.translate(cx, cy);
    g.fillStyle = '#353535'; g.beginPath(); g.arc(0, 0, r + 6, 0, 7); g.fill(); // the bezel
    g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
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
    g.restore();
  }
}

/** A bar from a to b. */
function bar(a, b, r, mat) {
  const d = new V3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  return m;
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
  const skin = new THREE.MeshStandardMaterial({ color: T.skin, roughness: 0.6, metalness: kind === 'p51' ? 0.6 : 0.25 });
  const inside = new THREE.MeshStandardMaterial({ color: T.inside, roughness: 0.8, metalness: 0.15 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85 });
  const suit = new THREE.MeshStandardMaterial({ color: kind === 'p51' ? 0x5a5040 : 0x3e3a30, roughness: 0.95 });
  const frameMat = new THREE.MeshStandardMaterial({ color: kind === 'p51' ? 0x8c9094 : 0x34373a, roughness: 0.5, metalness: 0.5 });
  const glass = wetGlass(new THREE.MeshPhysicalMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.07, roughness: 0.04, depthWrite: false, side: THREE.DoubleSide }));
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const P = (x, y, z) => new V3(x, y, z);

  // ---- outside: the cowling out to the spinner, the propeller's blur, exhausts, the wings
  const [rf, rb] = T.cowl, back = 0.66, len = T.prop - back, cy = -0.19 - rb * 0.92;
  add(new THREE.CylinderGeometry(rf, rb, len, 40, 1, true).rotateX(-Math.PI / 2).scale(1, 0.92, 1), skin, 0, cy, -back - len / 2);
  add(new THREE.CircleGeometry(rb, 40).scale(1, 0.92, 1), skin, 0, cy, -back);
  const spinnerCol = kind === 'p51' ? 0xd8c030 : kind === 'fw190' ? 0x1a2018 : 0xe8e4d8;
  add(new THREE.ConeGeometry(rf * 0.55, 0.6, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: spinnerCol, roughness: 0.5 }), 0, cy, -T.prop - 0.3);
  const blur = new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  add(new THREE.RingGeometry(rf * 0.5, 1.6, 48), blur, 0, cy, -T.prop);
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.05, 0.04, 0.09), black, s * (rb - 0.02), cy + rb * 0.4, -0.95 - k * 0.2);
  for (const [x, y] of T.guns) { // the cowl guns' troughs and barrels just under your line of sight
    add(new THREE.BoxGeometry(0.08, 0.05, 1.1), skin, x, y + 0.01, -1.25);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8).rotateX(Math.PI / 2), black, x, y + 0.04, -1.6);
  }
  const [wy, span, root0, tip] = T.wing;
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape([new V2(0.35, -root0 * 0.35), new V2(span, -tip * 0.4), new V2(span, tip * 0.6), new V2(0.35, root0 * 0.65)]);
    const wing = add(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).rotateX(Math.PI / 2), skin.clone(), 0, wy + 0.06, -0.5);
    wing.scale.x = s; wing.material.side = THREE.DoubleSide;
  }

  // ---- the tub: sides, the decking behind you, the floor; the seat; the side consoles with their trim
  // wheels, levers and switches
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 1.0, 1.9), inside, s * 0.4, -0.72, 0.05);
    add(new THREE.BoxGeometry(0.16, 0.06, 0.75), inside, s * 0.31, -0.5, -0.18); // the console shelf
    for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 8), black, s * 0.31 + (k % 2) * 0.04 - 0.02, -0.455, -0.4 + k * 0.1); // switches and knobs
  }
  add(new THREE.BoxGeometry(0.84, 0.3, 1.6), skin, 0, -0.42, 1.25);
  add(new THREE.BoxGeometry(0.7, 0.04, 1.4), inside, 0, -1.05, -0.05);
  add(new THREE.BoxGeometry(0.44, 0.08, 0.4), leather, 0, -0.78, 0.25); // the seat pan and its back
  add(new THREE.BoxGeometry(0.44, 0.55, 0.06), inside, 0, -0.5, 0.45);
  // the trim wheels, left side: elevator trim (and the German fighters' second, the flaps), with spokes
  const wheel = (x, y, z, r) => {
    const w = add(new THREE.TorusGeometry(r, 0.012, 6, 24), black, x, y, z);
    w.rotation.y = Math.PI / 2;
    for (let k = 0; k < 4; k++) { const sp = add(new THREE.BoxGeometry(0.006, r * 2, 0.008), black, x, y, z); sp.rotation.x = (k / 4) * Math.PI; }
    return w;
  };
  wheel(-0.37, -0.47, -0.05, 0.075);
  if (kind !== 'p51') wheel(-0.37, -0.47, 0.13, 0.075);
  else { wheel(-0.36, -0.46, 0.1, 0.05); wheel(-0.36, -0.46, 0.2, 0.04); } // the P-51: rudder and aileron trim too

  // ---- the instrument panel: its face drawn live (PanelArt), glowing at night
  const art = new PanelArt(T);
  const panelMat = new THREE.MeshStandardMaterial({ map: art.tex, emissiveMap: art.tex, emissive: 0x000000, roughness: 0.55, metalness: 0.2 });
  const panel = add(new THREE.PlaneGeometry(0.7, 0.287), panelMat, 0, -0.36, -0.62);
  panel.rotation.x = -0.12;
  add(new THREE.BoxGeometry(0.74, 0.31, 0.03), new THREE.MeshStandardMaterial({ color: T.panel, roughness: 0.7 }), 0, -0.36, -0.637).rotation.x = -0.12;
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.76, 10).rotateZ(Math.PI / 2), leather, 0, -0.205, -0.61); // the coaming's padded lip
  add(new THREE.BoxGeometry(0.76, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: T.panel, roughness: 0.75 }), 0, -0.2, -0.72);

  // ---- the gunsight on the coaming: the body and its reflector glass (the ring and dot: pilot.js puts
  // them on the guns' line, collimated, so they sit where the rounds converge)
  if (T.sight === 'revi') {
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.15, 14).rotateX(Math.PI / 2), black, 0, -0.165, -0.5);
    add(new THREE.BoxGeometry(0.05, 0.035, 0.07), black, 0, -0.16, -0.43);
  } else {
    add(new THREE.BoxGeometry(0.09, 0.08, 0.18), black, 0, -0.16, -0.48); // the K-14's gyro box
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 10), black, 0.06, -0.12, -0.48);
  }
  const plate = add(new THREE.PlaneGeometry(0.075, 0.07), new THREE.MeshPhysicalMaterial({ color: 0xbcd8e0, transparent: true, opacity: 0.16, roughness: 0.03, depthWrite: false, side: THREE.DoubleSide }), 0, -0.095, -0.52);
  plate.rotation.x = -0.6;

  // ---- the stick and the throttle, with your hands on them, and your knees
  const stick = new THREE.Group();
  stick.position.set(0, -0.95, -0.28);
  g.add(stick);
  add(new THREE.CylinderGeometry(0.014, 0.02, 0.5, 8).translate(0, 0.25, 0), black, 0, 0, 0, stick);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10).translate(0, 0.53, 0), leather, 0, 0, 0, stick); // the grip
  add(new THREE.BoxGeometry(0.03, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.5 }), 0, 0.6, -0.02, stick); // the gun button
  const rh = hand(leather);
  rh.position.set(0.02, 0.54, 0.02); rh.rotation.set(-0.3, 0, -1.4);
  stick.add(rh);
  const throttle = new THREE.Group();
  throttle.position.set(-0.33, -0.48, -0.25);
  g.add(throttle);
  add(new THREE.BoxGeometry(0.05, 0.03, 0.3), black, 0, -0.02, 0.05, throttle);
  const lever = add(new THREE.CylinderGeometry(0.01, 0.012, 0.16, 8).translate(0, 0.08, 0), black, 0, 0, 0, throttle);
  add(new THREE.SphereGeometry(0.026, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }), 0, 0.17, 0, lever);
  const lh = hand(leather);
  lh.position.set(0.02, 0.15, 0.03); lh.rotation.set(-0.4, 0, 0.6);
  lever.add(lh);
  for (const s of [-1, 1]) { // the knees, either side of the stick, under the panel
    add(new THREE.CapsuleGeometry(0.075, 0.45, 4, 10).rotateX(Math.PI / 2 - 0.35), suit, s * 0.13, -0.78, -0.12);
    add(new THREE.CapsuleGeometry(0.06, 0.4, 4, 10), suit, s * 0.13, -0.95, -0.43);
  }

  // ---- the windscreen, the armoured glass and the canopy frame: posts out at the corners, so the
  // middle of the sight stays clear
  const fl = P(-0.3, -0.15, -0.55), fr = P(0.3, -0.15, -0.55), tl = P(-0.22, 0.24, -0.3), tr = P(0.22, 0.24, -0.3);
  g.add(bar(fl, tl, 0.016, frameMat), bar(fr, tr, 0.016, frameMat), bar(fl, fr, 0.014, frameMat), bar(tl, tr, 0.014, frameMat));
  const screen = add(new THREE.BufferGeometry().setFromPoints([fl, fr, tr, fl, tr, tl]), glass);
  screen.geometry.computeVertexNormals();
  if (T.canopy !== 'bubble') { // the 50 mm armoured glass block behind the windscreen, greenish at its edges
    const ag = add(new THREE.BoxGeometry(0.34, 0.24, 0.05), new THREE.MeshPhysicalMaterial({ color: 0x9ec8b4, transparent: true, opacity: 0.12, roughness: 0.03, depthWrite: false }), 0, 0.02, -0.47);
    ag.rotation.x = -0.55;
    for (const [a, b] of [[P(-0.17, -0.09, -0.4), P(0.17, -0.09, -0.4)], [P(-0.17, 0.13, -0.53), P(0.17, 0.13, -0.53)], [P(-0.17, -0.09, -0.4), P(-0.17, 0.13, -0.53)], [P(0.17, -0.09, -0.4), P(0.17, 0.13, -0.53)]]) g.add(bar(a, b, 0.004, frameMat));
  }
  if (T.canopy === 'framed') { // the 109's boxy canopy: rails, cross bars overhead, the armour plate behind your head
    const bl = P(-0.33, 0.24, 0.5), br = P(0.33, 0.24, 0.5), sl = P(-0.38, -0.12, 0.55), sr = P(0.38, -0.12, 0.55);
    g.add(bar(tl, bl, 0.014, frameMat), bar(tr, br, 0.014, frameMat), bar(fl, sl, 0.014, frameMat), bar(fr, sr, 0.014, frameMat));
    g.add(bar(P(-0.3, 0.27, 0.1), P(0.3, 0.27, 0.1), 0.014, frameMat), bar(bl, br, 0.014, frameMat));
    g.add(bar(P(-0.36, 0.06, -0.42), P(-0.36, 0.06, 0.55), 0.012, frameMat), bar(P(0.36, 0.06, -0.42), P(0.36, 0.06, 0.55), 0.012, frameMat));
    add(new THREE.BoxGeometry(0.5, 0.45, 0.03), new THREE.MeshStandardMaterial({ color: 0x2c2e2a, roughness: 0.6, metalness: 0.6 }), 0, 0.02, 0.32);
  } else { // a bubble: the rails, one hoop, the headrest behind you (the Fw 190's an armoured one)
    for (const s of [-1, 1]) g.add(bar(P(s * 0.34, -0.12, -0.5), P(s * 0.36, -0.12, 0.9), 0.012, frameMat));
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.012, 6, 32, Math.PI), frameMat);
    hoop.position.set(0, -0.12, 0.85);
    g.add(hoop);
    add(new THREE.BoxGeometry(0.3, 0.26, T.canopy === 'bubbleArmour' ? 0.03 : 0.08), T.canopy === 'bubbleArmour' ? frameMat : black, 0, -0.03, 0.32);
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

/**
 * The reflector sight's image: the lit ring and dot, collimated (at infinity, so it sits on the guns'
 * line wherever your head is). Put on the camera's parent by pilot.js and placed each frame.
 */
export function buildReticle(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d'), col = kind === 'p51' ? 'rgba(255,170,90,1)' : 'rgba(255,190,80,1)';
  x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 5; x.shadowColor = col; x.shadowBlur = 8;
  x.beginPath(); x.arc(128, 128, 96, 0, 7); x.stroke();
  x.beginPath(); x.arc(128, 128, 6, 0, 7); x.fill();
  if (kind !== 'p51') { // the Revi's cross with a gap in the middle
    for (const [a, b, cc, d] of [[128, 20, 128, 100], [128, 156, 128, 236], [20, 128, 100, 128], [156, 128, 236, 128]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(cc, d); x.stroke(); }
  } else { // the K-14's diamonds round the ring
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; x.beginPath(); x.arc(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96, 7, 0, 7); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(4.5, 2.2, 0.7), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  m.renderOrder = 10;
  m.frustumCulled = false;
  return m;
}
