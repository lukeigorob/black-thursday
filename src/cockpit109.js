// The Bf 109 G-6's cockpit as it was over Schweinfurt in October 1943 (hackathon/BF109_COCKPIT_SPEC.md),
// built to the photographs of restored and museum 109s:
// - RLM 66 Schwarzgrau throughout, worn, darker down in the tub (baked into the vertex colours: there are
//   no shadows in here, and no lights may be added);
// - the instrument panel in two plates, the upper shock-mounted: real holes with the instruments' faces
//   set back in them, black bezels, glass, the screws; German faces whose needles move with the real
//   values; the SZKK 4 ammunition counter's tapes running down as you fire; the luminous paint glowing at
//   night (pilot.night);
// - the Revi 16B on its bracket over the panel, its reflector glass at eye level (pilot.js puts the
//   reticle on the guns' line), the sun filter folded down, the crash pad;
// - the KG 13A stick (trigger, cannon button, leather boot) and the throttle with your hands on them,
//   the big trim and flap wheels on the left wall, the breaker panel, the FuG 16Z box and the blue
//   Höhenatmer with its yellow hose on the right, the rudder pedals and floor plates, the seat and harness;
// - the old framed hood (the Erla Haube and the Galland-Panzer came in 1944), its armoured windscreen,
//   the head armour bolted to the hood.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tidy, barGeo, quadGeo, rng } from './cockpit.js';

const V3 = THREE.Vector3, P = (x, y, z) => new V3(x, y, z);
const CELL = 256, ATLAS = 1024; // the instruments' faces: 4 x 4 cells of 256 px
const CELLS = ['alt', 'turn', 'boost', 'speed', 'compass', 'rpm', 'prop', 'coolant', 'oil', 'press', 'fuel', 'o2', 'blink', 'szkk'];
const INK = '#ece4cc', RED = '#c8261c';
const FONT = (px, w = 700) => `${w} ${px}px "Arial Narrow", Arial, sans-serif`;
const RLM66 = 0x3b3e41;

// the upper panel (shock-mounted) and the lower, each placed by its top edge's centre, tilted back
const UP = { w: 0.5, wb: 0.46, h: 0.29, top: P(0, -0.155, -0.635), tilt: -0.22 };
const LO = { w: 0.44, wb: 0.38, h: 0.12, top: P(0, -0.447, -0.578), tilt: -0.5 };
// the instruments: [cell, x, y, face radius] in the plate's own frame (m, from its centre)
const UPPER = [['alt', -0.13, 0.02, 0.04], ['turn', 0, 0.02, 0.04], ['boost', 0.13, 0.02, 0.04],
  ['speed', -0.13, -0.086, 0.04], ['compass', 0, -0.086, 0.04], ['rpm', 0.13, -0.086, 0.04], ['prop', 0.13, 0.104, 0.021]];
const LOWER = [['coolant', -0.152, -0.004, 0.027], ['oil', -0.084, -0.004, 0.027], ['press', 0.084, -0.004, 0.027], ['fuel', 0.152, -0.004, 0.027]];
const SZKK = { x: -0.12, y: 0.106, w: 0.11, h: 0.05 }; // the ammunition counter's window plate, top left of the upper panel

/** Where a point of a plate (its own x, y; z out of it) is in the cockpit. */
const plateMatrix = (pl) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pl.tilt, 0, 0));
  const c = pl.top.clone().sub(new V3(0, pl.h / 2, 0).applyQuaternion(q));
  return new THREE.Matrix4().compose(c, q, new V3(1, 1, 1));
};

// ---------- the instruments' faces (static, drawn once) and their needles (drawn ~15 times a second)

/** A dial's ticks between angles a0 and a1 (canvas angles: 0 at 3 o'clock, clockwise), and its numbers. */
function scale(g, R, from, to, a0, a1, step, every, label, rr = 0.66, px = 30) {
  g.strokeStyle = INK; g.fillStyle = INK; g.lineCap = 'butt';
  const at = (v) => a0 + ((v - from) / (to - from)) * (a1 - a0);
  for (let v = from, k = 0; v <= to + 1e-6; v = from + ++k * step) {
    const a = at(v), big = k % every === 0, mid = !big && every % 2 === 0 && k % (every / 2) === 0;
    g.lineWidth = big ? 5 : mid ? 3.5 : 2.2;
    const r0 = big ? R * 0.8 : mid ? R * 0.85 : R * 0.89;
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97); g.stroke();
    const t = big && label(v);
    if (t !== false && t !== undefined && t !== null) { g.font = FONT(px); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, Math.cos(a) * R * rr, Math.sin(a) * R * rr); }
  }
  return at;
}
const redMark = (g, R, a, w = 7) => { g.strokeStyle = RED; g.lineWidth = w; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78); g.lineTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98); g.stroke(); };
const text = (g, t, x, y, px, w = 700) => { g.fillStyle = INK; g.font = FONT(px, w); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); };
const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25; // a 270 degree scale from 7:30 round to 4:30
const TOP = -Math.PI / 2;
/** The Fahrtmesser's scale: the first 100 km/h squeezed into the bottom of it, 100 to 750 spread round. */
const speedAngle = (v) => TOP + (v < 100 ? 0.07 * v / 100 : 0.07 + 0.89 * (Math.min(v, 750) - 100) / 650) * Math.PI * 2;

/** Every face, drawn once into the atlas; returns the angle functions the needles need. */
function drawFaces(c, card) {
  const g = c.getContext('2d'), R = 118, fn = {};
  CELLS.forEach((name, i) => {
    g.save(); g.translate((i % 4) * CELL + CELL / 2, (i >> 2) * CELL + CELL / 2);
    if (name === 'szkk') { // the SZKK 4's face: three windows (the tapes are meshes behind them), a scale by each
      g.fillStyle = '#26282a'; g.fillRect(-128, -51, 256, 102);
      for (let i = 0; i < 3; i++) {
        const cx = -80 + i * 80; g.fillStyle = '#050505'; g.fillRect(cx - 22, -44, 44, 80);
        g.fillStyle = INK; for (let t = 0; t <= 10; t++) g.fillRect(cx + 23, 36 - t * 7.6, t % 5 ? 4 : 9, 1.6);
        g.font = FONT(14); g.textAlign = 'center'; g.fillText(i === 1 ? 'MG 151' : 'MG', cx, -48);
      }
      g.restore(); return;
    }
    const bg = g.createRadialGradient(0, -30, 10, 0, 0, 128); bg.addColorStop(0, '#1b1b1b'); bg.addColorStop(1, '#070707');
    g.fillStyle = bg; g.fillRect(-128, -128, 256, 256);
    switch (name) {
      case 'alt': { // Feinhöhenmesser: the long hand round once a kilometre, the short once in ten; the millibar window
        scale(g, R, 0, 10, TOP, TOP + Math.PI * 2, 0.2, 5, (v) => (v < 9.5 ? String(Math.round(v)) : null), 0.64, 34);
        g.fillStyle = '#000'; g.fillRect(-26, 34, 52, 24); g.strokeStyle = '#666'; g.lineWidth = 2; g.strokeRect(-26, 34, 52, 24);
        text(g, '1013', 0, 47, 18); text(g, 'km', 0, -34, 20); text(g, 'mb', 0, 72, 13, 600);
        break;
      }
      case 'speed': { // Fahrtmesser, km/h
        g.strokeStyle = INK; g.fillStyle = INK;
        for (let v = 0; v <= 750; v += v < 100 ? 50 : 10) {
          const a = speedAngle(v), big = v % 100 === 0, mid = v % 50 === 0;
          g.lineWidth = big ? 5 : mid ? 3.5 : 2; const r0 = big ? R * 0.8 : mid ? R * 0.85 : R * 0.9;
          g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97); g.stroke();
          if (big && v > 0) text(g, String(v / 100), Math.cos(a) * R * 0.64, Math.sin(a) * R * 0.64, 34);
        }
        text(g, 'km/h', 0, 38, 20); text(g, 'x 100', 0, 58, 14, 600);
        break;
      }
      case 'boost': { // Ladedruckmesser, ata: the red line at 1.42, the G-6's combat power
        const at = scale(g, R, 0.6, 1.8, A0, A1, 0.05, 4, (v) => v.toFixed(1).replace('.', ','), 0.62, 26);
        redMark(g, R, at(1.42)); text(g, 'ata', 0, 46, 22); fn.boost = at;
        break;
      }
      case 'rpm': { // Drehzahlmesser, x 100 U/min: the red line at 2800
        const at = scale(g, R, 6, 36, A0, A1, 1, 4, (v) => String(v), 0.64, 28);
        redMark(g, R, at(28)); text(g, 'U/min', 0, 40, 18); text(g, 'x 100', 0, 60, 14, 600); fn.rpm = at;
        break;
      }
      case 'turn': { // Wendezeiger: the turn needle's index marks over the top, the ball's curved tube below
        g.strokeStyle = INK;
        for (const k of [-2, -1, 0, 1, 2]) {
          const a = TOP + k * 0.33; g.lineWidth = k ? 6 : 9;
          g.beginPath(); g.moveTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74 + 10); g.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97); g.stroke();
        }
        g.lineCap = 'round'; g.strokeStyle = '#d8d0b4'; g.lineWidth = 26; g.beginPath(); g.arc(0, -140, 222, Math.PI / 2 - 0.36, Math.PI / 2 + 0.36); g.stroke();
        g.strokeStyle = '#111'; g.lineWidth = 3; for (const s of [-1, 1]) { const a = Math.PI / 2 + s * 0.07; g.beginPath(); g.moveTo(Math.cos(a) * 208, -140 + Math.sin(a) * 208); g.lineTo(Math.cos(a) * 236, -140 + Math.sin(a) * 236); g.stroke(); }
        g.lineCap = 'butt';
        break;
      }
      case 'compass': break; // (the card: below, a disc of its own that turns)
      case 'prop': { // the prop pitch "clock": hours and minutes
        g.strokeStyle = INK;
        for (let k = 0; k < 60; k++) { const a = (k / 60) * Math.PI * 2; g.lineWidth = k % 5 ? 3 : 7; const r0 = k % 5 ? R * 0.88 : R * 0.78; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97); g.stroke(); }
        for (let h = 1; h <= 12; h++) { const a = TOP + (h / 12) * Math.PI * 2; text(g, String(h), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, 36); }
        break;
      }
      case 'coolant': case 'oil': { // the temperatures, °C
        const at = scale(g, R, 0, 130, A0, A1, 5, 4, (v) => String(v), 0.62, 30);
        redMark(g, R, at(name === 'oil' ? 105 : 115), 8);
        text(g, name === 'oil' ? 'Öl' : 'Kühlstoff', 0, 44, name === 'oil' ? 30 : 24); text(g, '°C', 0, 74, 20); fn[name] = at;
        break;
      }
      case 'press': { // Doppeldruckmesser: Kraftstoff over the top, Öl under the bottom (kg/cm²)
        fn.fuelP = scale(g, R, 0, 3, Math.PI * 1.08, Math.PI * 1.92, 0.25, 4, (v) => String(v), 0.64, 30);
        fn.oilP = scale(g, R, 0, 10, Math.PI * 0.92, Math.PI * 0.08, 0.5, 4, (v) => String(v), 0.64, 30);
        g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(-R * 0.95, 0); g.lineTo(R * 0.95, 0); g.stroke();
        text(g, 'Kraftst.', 0, -34, 22); text(g, 'Öl', 0, 34, 26);
        break;
      }
      case 'fuel': { // Kraftstoffvorrat, Liter
        fn.fuel = scale(g, R, 0, 400, A0, A1, 20, 5, (v) => String(v), 0.62, 28);
        redMark(g, R, fn.fuel(100), 6); text(g, 'Liter', 0, 46, 24);
        break;
      }
      case 'o2': { // Sauerstoff, the bottle's pressure
        fn.o2 = scale(g, R, 0, 250, A0, A1, 10, 5, (v) => String(v), 0.62, 30); text(g, 'Sauerstoff', 0, 46, 20); text(g, 'kg/cm²', 0, 70, 16, 600);
        break;
      }
      case 'blink': text(g, 'Atem', 0, -60, 26); break; // the flow indicator: its flaps drawn live
      default: break;
    }
    g.restore();
  });
  // the repeater compass's card (Führertochterkompass): O for Ost
  const k = card.getContext('2d');
  k.translate(CELL / 2, CELL / 2); k.fillStyle = '#0b0b0b'; k.beginPath(); k.arc(0, 0, 128, 0, 7); k.fill();
  k.strokeStyle = INK; k.fillStyle = INK;
  for (let d = 0; d < 360; d += 5) {
    const a = TOP + THREE.MathUtils.degToRad(d), big = d % 30 === 0; k.lineWidth = d % 10 ? 2 : 4;
    const r0 = big ? R * 0.78 : d % 10 ? R * 0.9 : R * 0.84; k.beginPath(); k.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); k.lineTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98); k.stroke();
    if (big) { k.save(); k.translate(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6); k.rotate(a + Math.PI / 2); k.font = FONT(d % 90 ? 28 : 40); k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText(d % 90 ? String(d / 10) : 'NOSW'[d / 90], 0, 0); k.restore(); }
  }
  g.drawImage(card, (CELLS.indexOf('compass') % 4) * CELL, (CELLS.indexOf('compass') >> 2) * CELL);
  // the glass over every face: a soft glint across the top (not the compass's: its card turns)
  CELLS.forEach((name, i) => {
    if (name === 'compass' || name === 'szkk') return;
    g.save(); g.translate((i % 4) * CELL + CELL / 2, (i >> 2) * CELL + CELL / 2);
    const gl = g.createLinearGradient(-120, -120, 30, 30); gl.addColorStop(0, '#ffffff1c'); gl.addColorStop(0.5, '#ffffff05'); gl.addColorStop(0.55, '#ffffff00');
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, 124, 0, 7); g.fill(); g.restore();
  });
  return fn;
}

/** A needle along +x from its pivot (a lance with a counterweight), in a face's pixels (256 across). */
function needleGeo(len, w) {
  const s = new THREE.Shape();
  s.moveTo(-len * 0.24, -w * 0.8); s.lineTo(len * 0.7, -w / 2); s.lineTo(len, 0); s.lineTo(len * 0.7, w / 2); s.lineTo(-len * 0.24, w * 0.8); s.closePath();
  return new THREE.ShapeGeometry(s);
}

// ---------- the panel plates' paint: worn RLM 66, rivets, the placards

function plateCanvas(pl, px, labels) {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * pl.h / pl.w);
  const g = c.getContext('2d'), r = rng(31), W = c.width, H = c.height, k = W / pl.w;
  g.fillStyle = '#3b3e41'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 7000; i++) { g.fillStyle = r() < 0.5 ? '#ffffff07' : '#00000012'; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  g.strokeStyle = '#9a9a8c55'; g.lineCap = 'round'; // worn to the metal along the edges, where hands go
  for (let i = 0; i < 90; i++) { const x = r() * W, y = r() < 0.5 ? r() * 14 : H - r() * 14; g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4 + r() * 22, y + (r() - 0.5) * 3); g.stroke(); }
  for (let x = 14; x < W; x += 34) for (const y of [8, H - 8]) { g.fillStyle = '#00000055'; g.beginPath(); g.arc(x + 1, y + 1, 3.2, 0, 7); g.fill(); g.fillStyle = '#56595c'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } // rivets
  const to = (x, y) => [(x + pl.w / 2) * k, (pl.h / 2 - y) * k];
  const plate = (x, y, w, lines, bg = '#d6cfb4', fg = '#16140f') => { // a placard, its text in German
    const [px0, py0] = to(x, y), h = lines.length * 15 + 6, ww = w * k;
    g.fillStyle = '#0006'; g.fillRect(px0 - ww / 2 + 2, py0 - h / 2 + 2, ww, h); g.fillStyle = bg; g.fillRect(px0 - ww / 2, py0 - h / 2, ww, h);
    g.fillStyle = fg; g.font = '700 12px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((t, i) => g.fillText(t, px0, py0 - h / 2 + 10.5 + i * 15));
  };
  const label = (x, y, t, px2 = 13) => { const [a, b] = to(x, y); g.fillStyle = '#e4ddc6'; g.font = `700 ${px2}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, a, b); };
  labels({ plate, label, to, g, k });
  return c;
}

/** A plate's outline (a little narrower at the bottom, rounded corners), its holes for the instruments. */
function plateGeo(pl, holes) {
  const s = new THREE.Shape(), w = pl.w / 2, wb = pl.wb / 2, h = pl.h / 2, c = 0.014;
  s.moveTo(-wb + c, -h); s.lineTo(wb - c, -h); s.quadraticCurveTo(wb, -h, wb + (w - wb) * 0.1, -h + c);
  s.lineTo(w, h - c); s.quadraticCurveTo(w, h, w - c, h); s.lineTo(-w + c, h); s.quadraticCurveTo(-w, h, -w, h - c);
  s.lineTo(-wb - (w - wb) * 0.1, -h + c); s.quadraticCurveTo(-wb, -h, -wb + c, -h);
  for (const [x, y, r] of holes) s.holes.push(new THREE.Path().absarc(x, y, r, 0, Math.PI * 2, true));
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 28 });
  geo.translate(0, 0, -0.0075);
  const p = geo.attributes.position, uv = geo.attributes.uv; // (the paint's canvas across the plate)
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w) / (2 * w), (p.getY(i) + h) / (2 * h));
  return geo;
}

/** A bezel: the ring standing out of the panel and the short tube down to the face, turned round z. */
function bezelGeo(r) {
  const pts = [[r + 0.0006, -0.013], [r + 0.0006, 0.001], [r + 0.0016, 0.0045], [r + 0.0042, 0.0062], [r + 0.0072, 0.0052], [r + 0.0092, 0.0022], [r + 0.0098, -0.0004]].map(([a, b]) => new THREE.Vector2(a, b));
  return new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2);
}

/** A face disc, its uv in the atlas cell. */
function faceGeo(r, cell) {
  const geo = new THREE.CircleGeometry(r, 40), uv = geo.attributes.uv, i0 = CELLS.indexOf(cell), col = i0 % 4, row = i0 >> 2;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 4);
  return geo;
}

/** Light and shade baked into the vertices: darker down in the tub, under the panel, in the corners. */
function shade(geo, m) {
  const p = geo.attributes.position, c = geo.attributes.color, v = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m);
    let k = 1 - 0.68 * THREE.MathUtils.smoothstep(-v.y, 0.12, 0.75); // (deeper is darker)
    if (v.z < -0.45 && v.y < -0.17) k *= 0.72 + 0.28 * THREE.MathUtils.smoothstep(v.z, -0.75, -0.45); // (under the panel and the coaming)
    k *= 0.85 + 0.15 * THREE.MathUtils.smoothstep(Math.abs(v.x), 0.42, 0.25); // (into the walls)
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

/** A gloved hand closed round a grip whose axis is y (radius gr), the cuff and the leather sleeve going back to the elbow. */
function handGeo(gr, mirror, sleeveDir) {
  const parts = [];
  const f0 = mirror ? -1 : 1;
  parts.push(new RoundedBoxGeometry(0.03, 0.085, 0.075, 2, 0.012).translate(f0 * (gr + 0.018), -0.005, 0.012)); // the palm and the back of the hand
  for (let k = 0; k < 4; k++) { // the fingers round the front of the grip
    const t = new THREE.TorusGeometry(gr + 0.0095, 0.0095 - k * 0.0006, 6, 14, Math.PI * 1.35).rotateX(Math.PI / 2).rotateY(mirror ? -2.39 : 3.49);
    parts.push(t.translate(0, 0.026 - k * 0.019, 0));
  }
  parts.push(new THREE.CapsuleGeometry(0.0105, 0.04, 3, 8).rotateZ(Math.PI / 2).rotateY(mirror ? -0.6 : 0.6).translate(f0 * 0.012, 0.05, 0.004)); // the thumb over the top
  const d = sleeveDir.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d);
  const cuff = new THREE.CylinderGeometry(0.036, 0.04, 0.07, 12).applyQuaternion(q).translate(...d.clone().multiplyScalar(0.06).add(new V3(f0 * 0.035, -0.02, 0.03)).toArray());
  parts.push(cuff);
  return { glove: mergeGeometries(parts.map((x) => tidy(x, true))), sleeve: tidy(new THREE.CapsuleGeometry(0.045, 0.24, 4, 12).applyQuaternion(q).translate(...d.clone().multiplyScalar(0.22).add(new V3(f0 * 0.035, -0.02, 0.03)).toArray()), true) };
}

/** A small canvas texture for a side panel's placards. */
function sideCanvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), r = rng(57);
  g.fillStyle = '#3b3e41'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 60; i++) { g.fillStyle = r() < 0.5 ? '#ffffff07' : '#00000012'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/**
 * The 109's cockpit, into the shared cockpit group: the static parts are merged by material here, the
 * moving ones (stick, throttle) added as groups. Returns { update(s, dt), night(k) }.
 * ctx: { g, T, body (the fuselage's geometry), widthAt, sill, wear, rivets, glass, armour, armourEdge }
 */
export function build109(ctx) {
  const { g, body, widthAt, sill, wear, rivets } = ctx;
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const M = {
    inside: std({ color: 0x2b2e31, map: wear, roughnessMap: wear, bumpMap: rivets, bumpScale: 0.25, roughness: 0.85, metalness: 0.12, side: THREE.BackSide }),
    paint: std({ color: RLM66, map: wear, roughness: 0.78, metalness: 0.18 }),
    frame: std({ color: 0x2f3235, map: wear, roughness: 0.8, metalness: 0.15 }),
    bakelite: std({ color: 0x141312, roughness: 0.38, metalness: 0.05 }),
    bezel: std({ color: 0x101010, roughness: 0.32, metalness: 0.45, side: THREE.DoubleSide }),
    steel: std({ color: 0x7c8084, roughness: 0.38, metalness: 0.8 }),
    dark: std({ color: 0x1c1d1e, map: wear, roughness: 0.6, metalness: 0.3 }),
    leather: std({ color: 0x4a2e1b, roughness: 0.72 }), // the stick's boot
    pad: std({ color: 0x2a1e16, roughness: 0.8 }), // the Revi's crash pad, dark and rubbed
    glove: std({ color: 0x3b2618, roughness: 0.78 }),
    jacket: std({ color: 0x52361f, roughness: 0.82 }), // the brown leather flying jacket
    trousers: std({ color: 0x4b4838, roughness: 0.92 }),
    boots: std({ color: 0x161412, roughness: 0.55 }),
    webbing: std({ color: 0x8c7f5b, roughness: 0.95 }), // the harness
    red: std({ color: 0x9c1b12, roughness: 0.45 }),
    yellow: std({ color: 0xd9a51a, roughness: 0.5 }),
    blue: std({ color: 0x2c4f8f, roughness: 0.55, metalness: 0.2 }), // the Höhenatmer
    white: std({ color: 0xd8d2bc, roughness: 0.6 }),
    rubber: std({ color: 0x0c0c0c, roughness: 0.85 }),
  };
  // the hose: yellow, ribbed (a bump map of rings along it)
  const ribs = (() => { const c = document.createElement('canvas'); c.width = 8; c.height = 64; const x = c.getContext('2d'); for (let y = 0; y < 64; y++) { const v = 128 + 110 * Math.sin((y / 64) * Math.PI * 2); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(0, y, 8, 1); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(160, 1); return t; })();
  M.hose = std({ color: 0xd6a51c, roughness: 0.55, bumpMap: ribs, bumpScale: 1.2 });

  // the instruments' faces: one atlas drawn once (the needles, the compass card, the tapes are meshes over them)
  const faces = document.createElement('canvas'); faces.width = faces.height = ATLAS;
  const card = document.createElement('canvas'); card.width = card.height = CELL;
  const fn = drawFaces(faces, card);
  const atlasTex = new THREE.CanvasTexture(faces); atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 8;
  // (a little light of their own by day so the faces read in the shade under the coaming; the luminous paint's glow by night)
  M.face = new THREE.MeshStandardMaterial({ map: atlasTex, emissiveMap: atlasTex, emissive: new THREE.Color(0.07, 0.07, 0.07), roughness: 0.55, metalness: 0.0 });
  M.needle = new THREE.MeshStandardMaterial({ color: INK, emissive: new THREE.Color(0.07, 0.07, 0.07), roughness: 0.5 }); // (luminous paint, like the faces')
  M.dial = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const lampRed = new THREE.MeshStandardMaterial({ color: 0x5a0d08, emissive: 0xff2a10, emissiveIntensity: 0.25, roughness: 0.3 });
  const lampFuel = new THREE.MeshStandardMaterial({ color: 0x5a0d08, emissive: 0xff2a10, emissiveIntensity: 0, roughness: 0.3 });

  const parts = new Map(), _o = new THREE.Object3D();
  const add = (mat, geo, m) => { const t = tidy(geo.clone(), !!mat.vertexColors); if (m) t.applyMatrix4(m); (parts.get(mat) ?? parts.set(mat, []).get(mat)).push(t); return t; };
  const put = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => { _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(s); _o.updateMatrix(); return add(mat, geo, _o.matrix); };
  const bar = (mat, a, b, w = 0.028, d = 0.032, out = P(0, 1, 0)) => add(mat, barGeo(a, b, w, d, out));
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.006) => new RoundedBoxGeometry(w, h, d, 2, r);
  const cyl = (r0, r1, h, s = 14) => new THREE.CylinderGeometry(r0, r1, h, s);
  const wall = (z) => widthAt(z) - 0.03;

  // ---- the tub: the fuselage's inside, its frames and stringers, the floor plates, the seat and its armour
  { const b = body.clone(); b.deleteAttribute('color'); add(M.inside, b); } // (its paint is the outside's)
  for (const z of [-0.42, -0.12, 0.18, 0.48]) for (const s of [-1, 1]) put(M.paint, box(0.022, 0.8, 0.04), s * (wall(z) - 0.008), sill - 0.44, z);
  for (const y of [sill - 0.2, sill - 0.48, sill - 0.75]) for (const s of [-1, 1]) put(M.paint, box(0.018, 0.022, 1.0), s * (wall(0) - 0.01), y, 0.03);
  for (const s of [-1, 1]) { // the floor: two grooved tread plates running forward to the pedals
    const a = P(s * 0.15, -1.04, -0.4), b = P(s * 0.15, -0.98, -0.95);
    bar(M.dark, a, b, 0.15, 0.012);
    for (let k = 1; k < 12; k++) { const p = a.clone().lerp(b, k / 12); put(M.paint, box(0.13, 0.008, 0.012), p.x, p.y + 0.008, p.z); }
  }
  put(M.paint, box(0.5, 0.02, 0.7), 0, -1.12, 0.05); // (the floor under the seat)
  // the seat: a pressed bucket with lightening holes round its rim, the parachute pack you sit on
  put(M.paint, new THREE.CylinderGeometry(0.235, 0.215, 0.42, 20, 1, true, -Math.PI * 0.55, Math.PI * 1.1).rotateY(Math.PI), 0, -0.86, 0.3, 0, 0, 0, 1);
  put(M.paint, box(0.42, 0.025, 0.38), 0, -1.06, 0.18);
  for (let k = 0; k < 6; k++) { const a = -0.9 + k * 0.36; put(M.dark, cyl(0.022, 0.022, 0.004, 12).rotateX(Math.PI / 2).rotateY(a), Math.sin(a) * 0.23, -0.73, 0.3 + Math.cos(a) * 0.1); }
  put(M.webbing, rbox(0.38, 0.1, 0.34, 0.03), 0, -0.99, 0.17);
  put(M.paint, box(0.44, 0.52, 0.009), 0, -0.48, 0.32, 0.1); // the back armour (8 mm)
  for (const s of [-1, 1]) for (const y of [-0.28, -0.66]) put(M.steel, cyl(0.007, 0.007, 0.012, 8).rotateX(Math.PI / 2), s * 0.19, y, 0.31);

  // ---- the panel plates, the instruments in them, the coaming over them
  const mU = plateMatrix(UP), mL = plateMatrix(LO);
  const upperPaint = plateCanvas(UP, 1024, ({ plate, label }) => {
    plate(0.205, 0.105, 0.075, ['C 3', '96 Okt.']); // (the fuel's grade)
    plate(-0.212, 0.045, 0.056, ['Ladedruck', 'max 1,42']);
    plate(0.212, -0.025, 0.055, ['Fahrwerk']);
    plate(-0.212, -0.06, 0.056, ['Revi', 'Licht']);
    label(-0.205, 0.128, 'SZKK 4', 11);
  });
  const lowerPaint = plateCanvas(LO, 768, ({ plate, label }) => {
    plate(0, 0.035, 0.07, ['Brandhahn']); label(-0.028, -0.032, 'ZU', 14); label(0.028, -0.032, 'AUF', 14);
  });
  const paintTex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const upperMat = std({ map: paintTex(upperPaint), roughness: 0.75, metalness: 0.15 });
  const lowerMat = std({ map: paintTex(lowerPaint), roughness: 0.75, metalness: 0.15 });
  const holes = (list, extra = []) => [...list.map(([, x, y, r]) => [x, y, r + 0.0012]), ...extra];
  add(upperMat, plateGeo(UP, holes(UPPER)), mU);
  add(lowerMat, plateGeo(LO, holes(LOWER)), mL);
  for (const [m, pl] of [[mU, UP], [mL, LO]]) { // the box behind each plate (the instruments' cases), the rubber shock mounts
    add(M.dark, box(pl.w - 0.02, pl.h - 0.02, 0.12).translate(0, 0, -0.077), m);
    for (const s of [-1, 1]) for (const t of [-1, 1]) add(M.rubber, cyl(0.009, 0.009, 0.012, 10).rotateX(Math.PI / 2).translate(s * (pl.wb / 2 - 0.012), t * (pl.h / 2 - 0.012), 0.001), m);
  }
  const dials = {}; // cell: { m (its plate), x, y, r }
  const instrument = (m, [cell, x, y, r]) => {
    dials[cell] = { m, x, y, r };
    add(M.face, faceGeo(r, cell).translate(x, y, -0.012), m);
    add(M.bezel, bezelGeo(r).translate(x, y, 0), m);
    add(M.dial, new THREE.CircleGeometry(r + 0.001, 32).translate(x, y, 0.0035), m);
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, d = r + 0.0145; add(M.steel, cyl(0.0028, 0.0028, 0.0025, 8).rotateX(Math.PI / 2).translate(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.001), m); }
  };
  for (const i of UPPER) instrument(mU, i);
  for (const i of LOWER) instrument(mL, i);
  // the SZKK 4: a box over the panel's top left, its tapes behind three windows (the tapes: below)
  {
    const { x, y, w, h } = SZKK, i0 = CELLS.indexOf('szkk'), col = i0 % 4, row = i0 >> 2;
    add(M.dark, rbox(w + 0.012, h + 0.012, 0.03, 0.004).translate(x, y, -0.008), mU);
    const q = new THREE.PlaneGeometry(w, h), uv = q.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - (0.3 + uv.getY(i) * 0.4)) / 4); // (the cell's middle band: 256 x 102 px)
    add(M.face, q.translate(x, y, 0.0075), mU);
    add(M.dial, new THREE.PlaneGeometry(w, h).translate(x, y, 0.0085), mU);
  }
  // the lamps: the gear's (red: up) and the low-fuel warning
  for (const k of [-1, 1]) { add(M.bezel, cyl(0.0085, 0.0085, 0.008, 12).rotateX(Math.PI / 2).translate(0.212 + k * 0.014, -0.058, 0.002), mU); add(lampRed, new THREE.SphereGeometry(0.0062, 10, 6).translate(0.212 + k * 0.014, -0.058, 0.005), mU); }
  add(M.bezel, cyl(0.009, 0.009, 0.008, 12).rotateX(Math.PI / 2).translate(0.203, 0.03, 0.002), mL); add(lampFuel, new THREE.SphereGeometry(0.0068, 10, 6).translate(0.203, 0.03, 0.005), mL);
  // the Revi's light switch and dimmer by it, the fuel cock (Brandhahn) on the lower plate: its yellow lever
  add(M.bakelite, cyl(0.009, 0.011, 0.014, 12).rotateX(Math.PI / 2).translate(-0.212, -0.1, 0.006), mU);
  add(M.steel, cyl(0.016, 0.016, 0.006, 16).rotateX(Math.PI / 2).translate(0, -0.012, 0.002), mL);
  add(M.yellow, rbox(0.012, 0.05, 0.012, 0.005).rotateZ(-0.9).translate(0.014, -0.004, 0.012), mL);
  // the coaming over the upper plate, under the windscreen
  put(M.paint, box(0.56, 0.016, 0.09), 0, -0.146, -0.62);
  put(M.rubber, cyl(0.009, 0.009, 0.52, 10), 0, -0.14, -0.578, 0, 0, Math.PI / 2); // (its rubbed edge)

  // ---- the left side: the throttle quadrant, the starter and primer panel, the big wheels, the canopy's levers
  const L = -wall(-0.2);
  const leftPlate = sideCanvas(512, 256, (x) => {
    x.fillStyle = '#d6cfb4'; for (const [px, py, t] of [[96, 34, 'Zündung'], [256, 34, 'Anlasser'], [416, 34, 'Einspritzpumpe'], [128, 150, 'Fahrwerk'], [384, 150, 'Kraftstoffpumpe']]) { x.fillRect(px - 62, py - 11, 124, 22); x.fillStyle = '#16140f'; x.font = '700 15px Arial'; x.fillText(t, px, py); x.fillStyle = '#d6cfb4'; }
    x.fillStyle = '#e4ddc6'; x.font = '700 13px Arial'; for (const [px, py, t] of [[60, 120, 'M1'], [96, 128, '0'], [132, 120, 'M2'], [96, 70, 'M1+2'], [90, 228, 'AUS'], [166, 228, 'EIN'], [350, 228, 'AUS'], [418, 228, 'EIN']]) x.fillText(t, px, py);
  });
  const lpMat = std({ map: leftPlate, roughness: 0.75, metalness: 0.15 });
  const mLP = new THREE.Matrix4().compose(P(L + 0.075, -0.33, -0.47), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0.95, 0, 'YXZ')), new V3(1, 1, 1));
  add(lpMat, box(0.2, 0.1, 0.008), mLP);
  add(M.bakelite, cyl(0.016, 0.018, 0.012, 16).rotateX(Math.PI / 2).translate(-0.062, 0.006, 0.008), mLP); // the magneto switch and its bar
  add(M.bakelite, rbox(0.032, 0.008, 0.01, 0.003).translate(-0.062, 0.006, 0.016), mLP);
  add(M.steel, cyl(0.004, 0.004, 0.04, 8).rotateX(Math.PI / 2).translate(0, 0.012, 0.022), mLP); add(M.bakelite, rbox(0.03, 0.01, 0.012, 0.004).translate(0, 0.012, 0.042), mLP); // the starter's T-handle
  add(M.steel, cyl(0.005, 0.005, 0.035, 8).rotateX(Math.PI / 2).translate(0.062, 0.012, 0.02), mLP); add(M.bakelite, new THREE.SphereGeometry(0.012, 12, 8).translate(0.062, 0.012, 0.04), mLP); // the primer's knob
  for (const [px, py] of [[-0.058, -0.03], [-0.036, -0.03], [0.04, -0.03], [0.066, -0.03]]) { add(M.bezel, cyl(0.007, 0.007, 0.008, 10).rotateX(Math.PI / 2).translate(px, py, 0.006), mLP); add(M.steel, cyl(0.0022, 0.003, 0.02, 6).rotateX(Math.PI / 2 - 0.4).translate(px, py + 0.003, 0.014), mLP); } // the toggles
  // the throttle quadrant: the slotted plate along the wall under the sill, its lever moving in it
  put(M.dark, rbox(0.035, 0.05, 0.3, 0.01), L + 0.02, -0.4, -0.3);
  put(M.rubber, box(0.006, 0.006, 0.26), L + 0.038, -0.375, -0.3);
  put(M.white, box(0.002, 0.012, 0.006), L + 0.04, -0.388, -0.41); put(M.red, box(0.002, 0.012, 0.006), L + 0.04, -0.388, -0.19); // (the stops: full and cut-off)
  // the tail trim and flap wheels: outboard the bigger flap wheel, inboard the trim wheel with its white index
  const wheelAt = P(L + 0.03, -0.64, 0.04);
  const wheel = (x, r, mat, n) => {
    put(mat, new THREE.TorusGeometry(r, r * 0.08, 8, 40), x, wheelAt.y, wheelAt.z, 0, Math.PI / 2, 0);
    put(mat, cyl(r * 0.18, r * 0.18, 0.02, 16), x, wheelAt.y, wheelAt.z, 0, 0, Math.PI / 2);
    for (let k = 0; k < n; k++) put(mat, box(0.006, r * 1.9, r * 0.09), x, wheelAt.y, wheelAt.z, (k / n) * Math.PI);
    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; put(mat, new THREE.SphereGeometry(r * 0.075, 6, 4), x, wheelAt.y + Math.cos(a) * r, wheelAt.z + Math.sin(a) * r); } // (the grip's knurls)
  };
  wheel(wheelAt.x - 0.012, 0.15, M.bakelite, 3);
  wheel(wheelAt.x + 0.012, 0.12, M.dark, 4);
  for (let k = 0; k < 6; k++) put(M.white, box(0.004, 0.025, 0.012), wheelAt.x + 0.02, wheelAt.y + Math.cos(k * 1.05) * 0.112, wheelAt.z + Math.sin(k * 1.05) * 0.112, k * 1.05); // the trim wheel's white stripes
  put(M.steel, cyl(0.012, 0.012, 0.06, 12), wheelAt.x - 0.01, wheelAt.y, wheelAt.z, 0, 0, Math.PI / 2);
  const trimPlate = sideCanvas(256, 128, (x) => { x.fillStyle = '#d6cfb4'; x.fillRect(8, 8, 240, 112); x.fillStyle = '#16140f'; x.font = '700 18px Arial'; x.fillText('Höhenflosse', 128, 30); x.fillText('kopflastig', 128, 62); x.font = '700 22px Arial'; x.fillText('0', 128, 84); x.font = '700 18px Arial'; x.fillText('schwanzlastig', 128, 106); });
  put(std({ map: trimPlate, roughness: 0.7 }), box(0.004, 0.06, 0.12), L + 0.004, -0.5, -0.17, 0, 0, 0);
  // the canopy's red jettison handle and its lever, on the left up front
  put(M.red, rbox(0.02, 0.05, 0.02, 0.006), L + 0.03, -0.2, -0.46, 0.3);
  put(M.dark, cyl(0.005, 0.005, 0.06, 8), L + 0.025, -0.18, -0.08, 0, 0, Math.PI / 2 - 0.3); put(M.bakelite, new THREE.SphereGeometry(0.011, 10, 6), L + 0.05, -0.165, -0.08);

  // ---- the right side: the breaker panel, the radio's box, the oxygen regulator and its hose
  const R = wall(-0.2);
  const breakers = sideCanvas(512, 256, (x) => {
    const names = [['Batterie', 'Generator', 'Funk', 'Revi', 'Waffen'], ['Staurohr', 'Instr.-Bel.', 'Kraftst.-P.', 'Pos.-Licht', 'Höhenatm.']];
    x.font = '700 14px Arial';
    names.forEach((row, j) => row.forEach((t, i) => { const px = 52 + i * 102, py = 30 + j * 128; x.fillStyle = '#d6cfb4'; x.fillRect(px - 46, py - 10, 92, 20); x.fillStyle = '#16140f'; x.fillText(t, px, py); }));
    x.fillStyle = '#d6cfb4'; x.fillRect(150, 226, 212, 22); x.fillStyle = '#16140f'; x.font = '700 15px Arial'; x.fillText('Selbstschalter', 256, 237);
  });
  const mRP = new THREE.Matrix4().compose(P(R - 0.05, -0.33, -0.32), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, -1.15, 0, 'YXZ')), new V3(0.8, 0.8, 0.8));
  add(std({ map: breakers, roughness: 0.75, metalness: 0.15 }), box(0.22, 0.11, 0.008), mRP);
  add(M.dark, box(0.23, 0.12, 0.05).translate(0, 0, -0.03), mRP);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) { // the breakers: black toggles with white tips
    const px = -0.088 + i * 0.044, py = 0.012 - j * 0.055;
    add(M.bakelite, rbox(0.022, 0.026, 0.012, 0.004).translate(px, py, 0.008), mRP);
    add(M.bakelite, rbox(0.007, 0.02, 0.007, 0.003).rotateX(-0.5).translate(px, py + 0.008, 0.02), mRP);
    add(M.white, box(0.0075, 0.005, 0.0075).translate(px, py + 0.017, 0.026), mRP);
  }
  // the FuG 16Z's control box, the radio's: its tuning knob and the volume
  put(M.dark, rbox(0.06, 0.1, 0.17, 0.008), R - 0.03, -0.48, 0.02);
  put(M.bakelite, cyl(0.022, 0.022, 0.018, 18), R - 0.065, -0.47, -0.01, 0, 0, Math.PI / 2);
  put(M.bakelite, cyl(0.012, 0.012, 0.016, 14), R - 0.065, -0.48, 0.07, 0, 0, Math.PI / 2);
  put(M.white, box(0.004, 0.03, 0.08), R - 0.061, -0.42, 0.03);
  // the Höhenatmer: the blue regulator low on the wall, its gauge and flow indicator above on a small plate
  put(M.blue, rbox(0.07, 0.12, 0.14, 0.012), R - 0.035, -0.66, -0.2);
  put(M.blue, cyl(0.035, 0.035, 0.04, 18), R - 0.075, -0.64, -0.2, 0, 0, Math.PI / 2);
  put(M.bakelite, cyl(0.02, 0.02, 0.02, 16), R - 0.1, -0.64, -0.2, 0, 0, Math.PI / 2);
  put(M.steel, cyl(0.015, 0.015, 0.03, 12), R - 0.04, -0.585, -0.2);
  const mO2 = new THREE.Matrix4().compose(P(R - 0.05, -0.47, -0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, -0.85, 0, 'YXZ')), new V3(1, 1, 1));
  add(M.paint, box(0.14, 0.075, 0.008).translate(0, 0, -0.02), mO2);
  add(M.dark, box(0.13, 0.065, 0.06).translate(0, 0, -0.055), mO2);
  instrument(mO2, ['o2', -0.033, 0, 0.022]);
  instrument(mO2, ['blink', 0.033, 0, 0.018]);
  // the yellow hose: out of the regulator, up the wall, across to the mask on your face
  const hose = new THREE.CatmullRomCurve3([P(R - 0.04, -0.57, -0.2), P(R - 0.06, -0.47, -0.16), P(R - 0.13, -0.42, -0.05), P(0.18, -0.38, 0.02), P(0.1, -0.27, 0.01), P(0.05, -0.15, -0.02)]);
  add(M.hose, new THREE.TubeGeometry(hose, 64, 0.014, 10));
  for (const t of [0, 1]) put(M.dark, new THREE.SphereGeometry(0.019, 10, 8), ...hose.getPoint(t).toArray()); // (its unions)

  // ---- the rudder pedals: cast, with their straps, on their arms
  for (const s of [-1, 1]) {
    const x = s * 0.15, y = -0.9, z = -0.98;
    put(M.dark, rbox(0.1, 0.17, 0.022, 0.008), x, y, z, 0.35);
    for (let k = 0; k < 3; k++) put(M.rubber, box(0.084, 0.012, 0.006), x, y - 0.05 + k * 0.05, z + 0.012, 0.35);
    put(M.leather, rbox(0.104, 0.03, 0.04, 0.006), x, y + 0.03, z + 0.025, 0.35);
    put(M.paint, cyl(0.012, 0.012, 0.3, 8), x, -1.04, z + 0.05, Math.PI / 2 - 0.25);
  }

  // ---- the canopy: the armoured windscreen and the old framed hood, its frames RLM 66 inside
  const yb = sill - 0.01;
  const fl = P(-0.165, yb, -0.6), fr = P(0.165, yb, -0.6), tl = P(-0.135, 0.2, -0.37), tr = P(0.135, 0.2, -0.37);
  const bl = P(-wall(-0.3) - 0.01, yb, -0.3), br = P(wall(-0.3) + 0.01, yb, -0.3), btl = P(-0.215, 0.235, -0.3), btr = P(0.215, 0.235, -0.3);
  const I = new THREE.Matrix4(), out = P(0, 0.4, -1).normalize();
  add(ctx.glass, quadGeo(fl, fr, tr, tl)); add(ctx.glass, quadGeo(bl, fl, tl, btl)); add(ctx.glass, quadGeo(fr, br, btr, tr)); add(ctx.glass, quadGeo(tl, tr, btr, btl));
  for (const [a, b] of [[fl, tl], [fr, tr], [tl, tr], [fl, fr]]) bar(M.frame, a, b, 0.03, 0.04, out);
  for (const [a, b] of [[tl, btl], [tr, btr], [fl, bl], [fr, br]]) bar(M.frame, a, b, 0.024, 0.026, P(0, 1, 0)); // (its back edge is the hood's front bow)
  // the 50 mm armoured glass of the front pane (green only along its edges)
  const agm = new THREE.Matrix4().makeRotationX(Math.atan2(tl.z - fl.z, tl.y - fl.y)).setPosition(0, (yb + 0.2) / 2 + 0.012, (-0.6 - 0.37) / 2 + 0.02);
  const sh = Math.hypot(tl.z - fl.z, tl.y - fl.y) - 0.02, sw = 0.27;
  add(ctx.armour, new THREE.PlaneGeometry(sw, sh).translate(0, 0, 0.025), agm); // (its inner face: the front pane is the outer)
  for (const s of [-1, 1]) { add(ctx.armourEdge, box(sw, 0.005, 0.05).translate(0, s * (sh / 2 - 0.0025), 0), agm); add(ctx.armourEdge, box(0.005, sh, 0.05).translate(s * (sw / 2 - 0.0025), 0, 0), agm); }
  // the hood: a flat roof pane, each side split by one bar, its bows front and back; hinged on the right
  const rear = 0.5, hood = (z) => ({ sl: P(-wall(z) - 0.01, yb, z), ml: P(-(wall(z) + 0.215) / 2 - 0.02, 0.055, z), tl: P(-0.215, 0.235, z), tr: P(0.215, 0.235, z), mr: P((wall(z) + 0.215) / 2 + 0.02, 0.055, z), sr: P(wall(z) + 0.01, yb, z) });
  const hf = hood(-0.3), hb = hood(rear);
  for (const h of [hf, hb]) for (const [a, b] of [[h.sl, h.ml], [h.ml, h.tl], [h.tl, h.tr], [h.tr, h.mr], [h.mr, h.sr]]) bar(M.frame, a, b, 0.028, 0.03, P(0, 0, 1));
  for (const k of ['sl', 'ml', 'tl', 'tr', 'mr', 'sr']) bar(M.frame, hf[k], hb[k], 0.024, 0.028, k[1] === 'l' || k === 'sl' ? P(1, 0.3, 0) : P(-1, 0.3, 0));
  for (const [a, b, c, d] of [[hb.sl, hf.sl, hf.ml, hb.ml], [hb.ml, hf.ml, hf.tl, hb.tl], [hf.tl, hf.tr, hb.tr, hb.tl], [hf.tr, hf.mr, hb.mr, hb.tr], [hf.mr, hf.sr, hb.sr, hb.mr]]) add(ctx.glass, quadGeo(a, b, c, d));
  for (const z of [-0.15, 0.15, 0.4]) put(M.frame, box(0.03, 0.02, 0.05), hf.sr.x - 0.012, yb + 0.02, z); // the hinges
  // behind the hood the fixed glazing, down to the spine
  const sp = P(0, 0.07, 1.0), spl = P(-0.13, 0.03, 1.0), spr = P(0.13, 0.03, 1.0);
  add(ctx.glass, quadGeo(hb.sl, hb.tl, spl, spl)); add(ctx.glass, quadGeo(hb.tl, hb.tr, spr, spl)); add(ctx.glass, quadGeo(hb.tr, hb.sr, spr, spr));
  for (const [a, b] of [[hb.tl, spl], [hb.tr, spr], [spl, sp], [sp, spr]]) bar(M.frame, a, b, 0.024, 0.026, P(0, 1, 0));
  // the head armour, bolted to the hood behind your head: steel, its top rounded to the hood
  {
    const s = new THREE.Shape(); s.moveTo(-0.2, -0.13); s.lineTo(0.2, -0.13); s.lineTo(0.2, 0.12); s.quadraticCurveTo(0.19, 0.215, 0, 0.222); s.quadraticCurveTo(-0.19, 0.215, -0.2, 0.12); s.closePath();
    const plate = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 16 });
    put(M.paint, plate, 0, -0.005, 0.42, -0.05);
    for (const [x, y] of [[-0.16, 0.1], [0.16, 0.1], [-0.16, -0.09], [0.16, -0.09]]) put(M.steel, cyl(0.008, 0.008, 0.006, 10).rotateX(Math.PI / 2), x, y - 0.005, 0.418);
    for (const s2 of [-1, 1]) bar(M.frame, P(s2 * 0.14, 0.2, 0.425), P(s2 * 0.17, 0.235, rear), 0.02, 0.012, P(0, 0, 1));
  }

  // ---- the Revi 16B on its bracket over the panel: the reflector glass at eye level, the crash pad behind
  put(M.dark, box(0.05, 0.012, 0.15), 0, -0.153, -0.52); // the bracket, from the panel's top back over it
  put(M.dark, rbox(0.068, 0.085, 0.085, 0.008), 0, -0.106, -0.442); // the body
  put(M.dark, rbox(0.078, 0.024, 0.08, 0.006), 0, -0.052, -0.442); // the head
  put(M.dark, cyl(0.02, 0.02, 0.07, 16), -0.045, -0.115, -0.46, 0, 0, Math.PI / 2); // the lamp housing
  put(M.steel, cyl(0.016, 0.016, 0.01, 16), -0.082, -0.115, -0.46, 0, 0, Math.PI / 2);
  put(M.bakelite, cyl(0.012, 0.012, 0.014, 14), 0.04, -0.085, -0.44, 0, 0, Math.PI / 2); // the dimmer knob
  put(M.bezel, cyl(0.024, 0.024, 0.006, 24), 0, -0.039, -0.442); // the lens's ring
  put(new THREE.MeshStandardMaterial({ color: 0x9fb8c4, transparent: true, opacity: 0.5, roughness: 0.05, depthWrite: false }), new THREE.CircleGeometry(0.02, 24), 0, -0.0355, -0.442, -Math.PI / 2);
  put(M.dark, box(0.08, 0.008, 0.012), 0, -0.042, -0.448); // the glass's clamp
  put(M.pad, rbox(0.058, 0.044, 0.03, 0.012), 0, -0.102, -0.39); // the crash pad
  const sightGlass = new THREE.MeshStandardMaterial({ color: 0x9fc4c8, transparent: true, opacity: 0.32, roughness: 0.02, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  put(sightGlass, new THREE.PlaneGeometry(0.076, 0.09), 0, -0.012, -0.415, Math.PI / 4); // the reflector glass, leaning back to you
  put(new THREE.MeshStandardMaterial({ color: 0x4a3418, transparent: true, opacity: 0.55, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }), new THREE.PlaneGeometry(0.07, 0.05), 0, -0.07, -0.49, -0.25); // the sun filter, folded down in front
  put(M.steel, cyl(0.004, 0.004, 0.075, 8), 0, -0.046, -0.485, 0, 0, Math.PI / 2); // (its hinge)

  // ---- you: shoulders and arms in the leather jacket, the harness over them, legs to the pedals
  for (const s of [-1, 1]) {
    put(M.jacket, new THREE.CapsuleGeometry(0.075, 0.12, 4, 12), s * 0.19, -0.27, 0.13, 0, 0, Math.PI / 2 + s * 0.25);
    bar(M.webbing, P(s * 0.12, -0.18, 0.3), P(s * 0.11, -0.2, 0.06), 0.045, 0.006, P(0, 1, 0)); // the shoulder straps, over and down
    bar(M.webbing, P(s * 0.11, -0.2, 0.06), P(s * 0.06, -0.55, -0.02), 0.045, 0.006, P(0, 0, -1));
    put(M.steel, box(0.04, 0.03, 0.006), s * 0.09, -0.36, 0.02); // (their adjusters)
    put(M.trousers, new THREE.CapsuleGeometry(0.075, 0.42, 4, 12), s * 0.12, -0.74, -0.12, Math.PI / 2 - 0.42); // the thighs, the knees up under the panel
    put(M.trousers, new THREE.CapsuleGeometry(0.058, 0.38, 4, 12), s * 0.14, -0.86, -0.6, 0.62);
    put(M.boots, rbox(0.1, 0.12, 0.2, 0.04), s * 0.15, -0.94, -0.88, 0.35);
  }
  put(M.steel, cyl(0.04, 0.04, 0.02, 20), 0, -0.6, -0.04, Math.PI / 2 - 0.3); // the harness's quick-release buckle
  for (const s of [-1, 1]) bar(M.webbing, P(s * 0.22, -0.82, 0.12), P(s * 0.03, -0.62, -0.05), 0.05, 0.006, P(0, 1, 0)); // the lap straps
  for (const s of [-1, 1]) put(M.jacket, new THREE.CapsuleGeometry(0.055, 0.2, 4, 10), s * 0.24, -0.43, 0.06, 0.3, 0, -s * 0.2); // the upper arms

  // ---- what moves: the stick (KG 13A grip), the throttle, with your gloved hands on them
  const stick = new THREE.Group(); stick.position.set(0, -1.02, -0.27); g.add(stick);
  const sp2 = (mat, geo) => { const m = new THREE.Mesh(tidy(geo, true), mat); stick.add(m); return m; };
  sp2(M.leather, new THREE.LatheGeometry([[0.07, 0], [0.068, 0.02], [0.055, 0.03], [0.058, 0.045], [0.044, 0.055], [0.046, 0.07], [0.032, 0.08], [0.033, 0.095], [0.02, 0.11], [0.016, 0.12]].map(([a, b]) => new THREE.Vector2(a, b)), 18)); // the leather boot
  sp2(M.dark, cyl(0.014, 0.017, 0.46, 12).translate(0, 0.33, 0));
  sp2(M.steel, cyl(0.019, 0.019, 0.025, 12).translate(0, 0.5, 0)); // (the collar)
  const grip = new THREE.LatheGeometry([[0, 0], [0.019, 0], [0.021, 0.02], [0.019, 0.05], [0.021, 0.08], [0.024, 0.1], [0.022, 0.115], [0, 0.12]].map(([a, b]) => new THREE.Vector2(a, b)), 16).translate(0, 0.51, 0);
  sp2(M.bakelite, grip);
  sp2(M.bakelite, rbox(0.044, 0.026, 0.05, 0.01).rotateX(-0.25).translate(0, 0.635, -0.008)); // the head of the grip
  sp2(M.red, cyl(0.008, 0.008, 0.008, 12).translate(-0.012, 0.652, 0.004)); // the cannon button under your thumb
  sp2(M.dark, rbox(0.018, 0.005, 0.022, 0.002).rotateX(-0.3).translate(0.008, 0.653, -0.012)); // the bomb button's flip cover
  sp2(M.steel, new THREE.TorusGeometry(0.022, 0.0035, 6, 12, Math.PI * 0.9).rotateY(Math.PI / 2).translate(0, 0.6, -0.03)); // the MG trigger, its bow round the front
  const rh = handGeo(0.021, false, P(0.35, -0.45, 0.82));
  for (const [geo, mat] of [[rh.glove, M.glove], [rh.sleeve, M.jacket]]) { const m = new THREE.Mesh(geo, mat); m.position.set(0, 0.58, 0); stick.add(m); }
  // the throttle: its lever pivots in the quadrant, the knob with the prop-pitch thumb rocker
  const throttle = new THREE.Group(); throttle.position.set(L + 0.035, -0.4, -0.3); g.add(throttle);
  const lever = new THREE.Group(); throttle.add(lever);
  const lm = (mat, geo) => { const m = new THREE.Mesh(tidy(geo, true), mat); lever.add(m); return m; };
  lm(M.bakelite, cyl(0.007, 0.009, 0.13, 8).translate(0, 0.065, 0).rotateZ(-0.45));
  const kp = new V3(0.058, 0.118, 0);
  lm(M.bakelite, new THREE.SphereGeometry(0.026, 14, 10).scale(1, 0.85, 1.25).translate(kp.x, kp.y, kp.z));
  lm(M.steel, rbox(0.012, 0.008, 0.02, 0.003).translate(kp.x + 0.012, kp.y + 0.022, kp.z)); // (the rocker)
  const lh = handGeo(0.026, true, P(-0.2, -0.5, 0.85));
  for (const [geo, mat] of [[lh.glove, M.glove], [lh.sleeve, M.jacket]]) { const m = new THREE.Mesh(geo, mat); m.position.copy(kp).add(P(0, -0.012, 0)); m.rotation.set(0, 0, -0.45); lever.add(m); }

  // ---- live: the needles, the compass card, the slip ball, the flow indicator's flaps, the ammunition tapes:
  // small meshes over the faces (no texture to upload each frame), on groups that carry each plate's frame
  const plates = new Map();
  const plateGroup = (m) => { if (!plates.has(m)) { const p = new THREE.Group(); p.matrixAutoUpdate = false; p.matrix.copy(m); g.add(p); plates.set(m, p); } return plates.get(m); };
  const hand = (cell, len, w, ox = 0, oy = 0, hub = 13) => { // a needle on its pivot (ox, oy: the pivot off the face's centre, in its pixels)
    const d = dials[cell], k = d.r / 128, piv = new THREE.Group();
    piv.position.set(d.x + ox * k, d.y - oy * k, -0.0105);
    piv.add(new THREE.Mesh(needleGeo(len, w).scale(k, k, 1), M.needle));
    plateGroup(d.m).add(piv);
    add(M.bezel, cyl(hub * k, hub * k, 0.003, 12).rotateX(Math.PI / 2).translate(piv.position.x, piv.position.y, -0.0092), d.m);
    return piv;
  };
  const N = {
    speed: hand('speed', 108, 9), altKm: hand('alt', 66, 14, 0, 0, 15), alt: hand('alt', 110, 8, 0, 0, 15), boost: hand('boost', 104, 9), rpm: hand('rpm', 104, 9),
    turn: hand('turn', 100, 12, 0, 10), propH: hand('prop', 66, 14), propM: hand('prop', 104, 9), coolant: hand('coolant', 104, 9), oil: hand('oil', 104, 9),
    fuelP: hand('press', 100, 9), oilP: hand('press', 100, 9), fuel: hand('fuel', 104, 9), o2: hand('o2', 104, 9),
  };
  // the compass card turning under its lubber mark and the course cross
  const cd = dials.compass, ck = cd.r / 128;
  const compass = new THREE.Mesh(faceGeo(cd.r * 0.995, 'compass'), M.face); compass.position.set(cd.x, cd.y, -0.0114); plateGroup(cd.m).add(compass);
  { const t = new THREE.Shape(); t.moveTo(0, 84); t.lineTo(-11, 112); t.lineTo(11, 112); t.closePath(); add(M.needle, new THREE.ShapeGeometry(t).scale(ck, ck, 1).translate(cd.x, cd.y, -0.0105), cd.m); }
  for (const [w, h] of [[80, 3], [3, 70]]) add(M.red, box(w * ck, h * ck, 0.0004).translate(cd.x, cd.y, -0.0106), cd.m);
  // the slip ball in its tube
  const td = dials.turn, tk = td.r / 128;
  const ball = new THREE.Mesh(tidy(new THREE.SphereGeometry(12 * tk, 10, 8), true), M.rubber); plateGroup(td.m).add(ball);
  // the flow indicator's flaps, opening as you breathe
  const bd = dials.blink, bk = bd.r / 128;
  const flaps = [-1, 1].map((sd) => { const f = new THREE.Mesh(new THREE.PlaneGeometry(60 * bk, 60 * bk).translate(-sd * 30 * bk, 0, 0), M.needle); f.position.set(bd.x + sd * 60 * bk, bd.y - 10 * bk, -0.0106); plateGroup(bd.m).add(f); return f; });
  // the SZKK 4's tapes: one a gun, running down as it fires
  const kx = SZKK.w / 256, ky = SZKK.h / 102.4;
  const tapes = [0, 1, 2].map((i) => { const t = new THREE.Mesh(new THREE.PlaneGeometry(36 * kx, 76 * ky).translate(0, 38 * ky, 0), M.needle); t.position.set(SZKK.x + (-80 + i * 80) * kx, SZKK.y - 36 * ky, 0.0079); plateGroup(mU).add(t); return t; });

  // ---- merge: one mesh per material, the shade baked in (glass drawn after the rest)
  for (const [mat, list] of parts) {
    const geo = mergeGeometries(list);
    if (mat.vertexColors) shade(geo);
    const m = new THREE.Mesh(geo, mat);
    if (mat.transparent) m.renderOrder = 2;
    g.add(m);
  }
  for (const grp of [stick, throttle]) { grp.updateMatrixWorld(true); grp.traverse((o) => { if (o.isMesh && o.material.vertexColors) shade(o.geometry, new THREE.Matrix4().makeTranslation(grp.position)); }); }

  const st = { coolant: 85, oil: 70, fuel: 330, bank: 0, ball: 0, ammo: null, t: 0 };
  const turnTo = (piv, a) => { piv.rotation.z = -a; }; // (the faces' angles are the canvas's: clockwise from 3 o'clock)
  return {
    update(s, dt) {
      if (s.ammo !== st.ammo) { if (st.ammo) st.fuel = 330; st.ammo = s.ammo; } // (a new sortie: a fresh tank)
      st.t += dt;
      const k = 1 - Math.exp(-dt * 0.08);
      st.coolant += (82 + s.throttle * 18 + (s.damage ? 38 : 0) - st.coolant) * k;
      st.oil += (64 + s.throttle * 16 + (s.damage ? 30 : 0) - st.oil) * k;
      st.fuel = Math.max(0, st.fuel - dt * (0.04 + s.throttle * 0.085)); // l/s: the DB 605 at full power drinks ~7 l a minute
      const roll = (s.bank - st.bank) / Math.max(dt, 1e-3); st.bank = s.bank;
      st.ball += (THREE.MathUtils.clamp(-roll * 0.12, -1, 1) - st.ball) * (1 - Math.exp(-dt * 3));
      lampFuel.emissiveIntensity = st.fuel < 100 ? 2.2 : 0;
      const ias = s.speed * 3.6 * Math.sqrt(Math.max(0.05, (1 - 2.2558e-5 * Math.max(0, s.alt)) ** 4.2559)); // (the Fahrtmesser reads indicated airspeed: thinner air up here)
      turnTo(N.speed, speedAngle(ias));
      const km = Math.max(0, s.alt) / 1000; turnTo(N.altKm, TOP + (km / 10) * Math.PI * 2); turnTo(N.alt, TOP + (km % 1) * Math.PI * 2);
      turnTo(N.boost, fn.boost(THREE.MathUtils.clamp(0.6 + s.throttle * 0.82 - (s.damage ? 0.15 : 0), 0.6, 1.8)));
      turnTo(N.rpm, fn.rpm(THREE.MathUtils.clamp(1600 + s.throttle * 1200 + (s.speed - 130) * 2, 600, 3000) / 100));
      const rate = (9.81 * Math.tan(THREE.MathUtils.clamp(s.bank, -1.4, 1.4))) / Math.max(60, s.speed); // rad/s
      turnTo(N.turn, TOP + THREE.MathUtils.clamp(rate / 0.105, -1, 1) * 0.66);
      const ba = Math.PI / 2 + THREE.MathUtils.clamp(st.ball, -1, 1) * 0.3; ball.position.set(td.x + Math.cos(ba) * 222 * tk, td.y - (-140 + Math.sin(ba) * 222) * tk, -0.0106);
      compass.rotation.z = s.heading;
      const h = 11.5 + (s.speed - 120) / 90 + (1 - s.throttle) * 0.6; turnTo(N.propH, TOP + (h / 12) * Math.PI * 2); turnTo(N.propM, TOP + (h % 1) * Math.PI * 2);
      turnTo(N.coolant, fn.coolant(st.coolant)); turnTo(N.oil, fn.oil(st.oil));
      turnTo(N.fuelP, fn.fuelP(1.2 + s.throttle * 0.3)); turnTo(N.oilP, fn.oilP(s.damage ? 2.5 : 5.5 + s.throttle * 2));
      turnTo(N.fuel, fn.fuel(st.fuel)); turnTo(N.o2, fn.o2(140 - st.t * 0.02));
      const open = Math.max(0, Math.sin(st.t * 1.6)) ** 0.5; for (const f of flaps) f.scale.x = Math.max(0.001, 1 - open);
      tapes.forEach((t, i) => { const j = [0, 2, 1][i], left = s.ammo && s.ammoMax && j < s.ammo.length ? s.ammo[j] / s.ammoMax[j] : 1; t.scale.y = Math.max(0.001, left); });
      stick.rotation.x = THREE.MathUtils.clamp(s.stickY, -1, 1) * 0.2; // (back to pull up)
      stick.rotation.z = THREE.MathUtils.clamp(-s.stickX, -1, 1) * 0.22;
      lever.rotation.x = 0.45 - s.throttle * 0.9; // (forward for full throttle)
    },
    night(k) {
      // the luminous paint glowing green-white under the UV lamps; the lamps showing up in the dark
      M.face.emissive.setRGB(0.07 + 0.5 * k, 0.07 + 1.0 * k, 0.07 + 0.62 * k); M.needle.emissive.copy(M.face.emissive);
      lampRed.emissiveIntensity = 0.25 + 1.2 * k;
    },
  };
}
