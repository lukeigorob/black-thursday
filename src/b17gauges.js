// The B-17's instrument faces, drawn to the real ones: black dials with white (radium-painted)
// figures, each with its own scale: the airspeed indicator in mph, the three-pointer altimeter, the
// rate-of-climb, the dual-needle manifold pressure and tachometer gauges, the engine gauge unit
// (fuel pressure, oil pressure and oil temperature on one face), cylinder-head and carburettor air
// temperatures, fuel quantity, flap position, suction, the clock and so on. Live needles (and the
// gyro horizon's card) are separate meshes turned by cockpitb17.js; the rest have theirs painted on.
// Every face is drawn into a canvas at (cx, cy) with radius r in pixels.

const TAU = Math.PI * 2;
const INK = '#ece6d2', DIM = '#b9b29c', LUM = '#d6e0b8'; // white figures, the dimmer sub-scales, radium paint

/** Where on its face a needle at value v points (canvas angle, 0 = 3 o'clock, clockwise). */
export function dialAngle(kind, v) {
  const s = SCALES[kind];
  if (!s) return 0;
  const f = (v - s.min) / (s.max - s.min);
  return s.a0 + f * s.sweep;
}

// a0: the angle of the scale's start (canvas: clockwise from 3 o'clock); sweep: its length
const top = -Math.PI / 2;
const SCALES = {
  airspeed: { min: 0, max: 400, a0: top, sweep: TAU * 0.9 }, // (mph, 0 at the top: the B-17's ASI goes round past 400)
  altimeter: { min: 0, max: 1000, a0: top, sweep: TAU }, // (the long hand: hundreds of feet)
  climb: { min: -6, max: 6, a0: Math.PI, sweep: TAU * 0.92 }, // (thousands ft/min, 0 at 9 o'clock)
  manifold: { min: 10, max: 70, a0: Math.PI * 0.62, sweep: Math.PI * 1.76 }, // (inches of mercury)
  tach: { min: 5, max: 45, a0: Math.PI * 0.62, sweep: Math.PI * 1.76 }, // (RPM x 100)
  dual: { min: 0, max: 1, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  gyro: { min: 0, max: 360, a0: top, sweep: TAU },
  compass: { min: 0, max: 360, a0: top, sweep: TAU },
  clock: { min: 0, max: 12, a0: top, sweep: TAU },
  suction: { min: 0, max: 10, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  hydraulic: { min: 0, max: 1200, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  cht: { min: 0, max: 350, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  carb: { min: -50, max: 150, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  freeair: { min: -50, max: 50, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  fuel: { min: 0, max: 425, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  flaps: { min: 0, max: 45, a0: -Math.PI / 2, sweep: Math.PI },
  turn: { min: -1, max: 1, a0: Math.PI * 1.5 - 0.6, sweep: 1.2 },
  oilT: { min: 0, max: 100, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  amps: { min: 0, max: 300, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  volts: { min: 0, max: 30, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
  oxygen: { min: 0, max: 500, a0: Math.PI * 0.75, sweep: Math.PI * 1.5 },
};

function arc(g, cx, cy, r, a0, a1, w, col) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke(); }
function text(g, s, x, y, px, col = INK, weight = 'bold', font = 'Arial Narrow, Arial') {
  g.fillStyle = col; g.font = `${weight} ${Math.max(6, Math.round(px))}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y);
}
/** Ticks round a scale: n divisions, every `major` one long, `numbers` written at the majors. */
function scale(g, cx, cy, r, kind, n, major, numbers, opts = {}) {
  const s = SCALES[kind], r0 = opts.r ?? 0.9;
  for (let k = 0; k <= n; k++) {
    if (s.sweep >= TAU - 1e-6 && k === n) break;
    const a = s.a0 + (s.sweep * k) / n, big = k % major === 0, mid = !big && opts.mid && k % opts.mid === 0;
    g.strokeStyle = INK; g.lineWidth = r * (big ? 0.035 : 0.018);
    const l = big ? 0.15 : mid ? 0.1 : 0.06;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r * r0, cy + Math.sin(a) * r * r0); g.lineTo(cx + Math.cos(a) * r * (r0 - l), cy + Math.sin(a) * r * (r0 - l)); g.stroke();
    if (big && numbers) {
      const t = numbers(k / major);
      if (t != null) text(g, t, cx + Math.cos(a) * r * (opts.nr ?? 0.6), cy + Math.sin(a) * r * (opts.nr ?? 0.6), r * (opts.px ?? 0.17));
    }
  }
}
function band(g, cx, cy, r, kind, v0, v1, col, rr = 0.82, w = 0.07) {
  arc(g, cx, cy, r * rr, dialAngle(kind, v0), dialAngle(kind, v1), r * w, col);
}
/** A painted needle (for the gauges that aren't live). */
export function needle(g, cx, cy, r, a, len = 0.8, w = 0.05, col = INK, tail = 0.18) {
  g.save(); g.translate(cx, cy); g.rotate(a);
  g.fillStyle = col; g.beginPath();
  g.moveTo(-r * tail, -r * w * 0.8); g.lineTo(r * len * 0.82, -r * w * 0.5); g.lineTo(r * len, 0); g.lineTo(r * len * 0.82, r * w * 0.5); g.lineTo(-r * tail, r * w * 0.8);
  g.closePath(); g.fill();
  g.restore();
}
function hub(g, cx, cy, r) {
  const h = g.createRadialGradient(cx - r * 0.03, cy - r * 0.03, 0, cx, cy, r * 0.1);
  h.addColorStop(0, '#6a6a64'); h.addColorStop(1, '#1a1a19');
  g.fillStyle = h; g.beginPath(); g.arc(cx, cy, r * 0.09, 0, TAU); g.fill();
}

/**
 * One instrument face. `live`: its needles are meshes (not painted). `v`: the painted needles' values.
 */
export function drawFace(g, cx, cy, r, kind, opts = {}) {
  const { live = false, v = {}, label } = opts;
  // the dial: matt black, very slightly lighter towards the middle (the lacquer)
  const d = g.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r);
  d.addColorStop(0, '#191a18'); d.addColorStop(1, '#0a0a09');
  g.fillStyle = d; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  const paint = (k, val, len, w, col) => { if (!live) needle(g, cx, cy, r, dialAngle(k, val), len, w, col); };
  switch (kind) {
    case 'airspeed': {
      band(g, cx, cy, r, kind, 100, 180, '#2f8a3a'); band(g, cx, cy, r, kind, 180, 230, '#c9a227'); band(g, cx, cy, r, kind, 228, 232, '#c4281c', 0.82, 0.12);
      scale(g, cx, cy, r, kind, 80, 4, (i) => (i % 2 === 0 && i > 0 && i < 20 ? String(i * 20) : null), { mid: 2, px: 0.15, nr: 0.6 });
      text(g, 'AIR SPEED', cx, cy - r * 0.3, r * 0.1, DIM); text(g, 'MILES PER HOUR', cx, cy + r * 0.3, r * 0.08, DIM);
      paint('airspeed', v.a ?? 160, 0.82, 0.06);
      break;
    }
    case 'altimeter': {
      scale(g, cx, cy, r, kind, 50, 5, (i) => String(i), { px: 0.2, nr: 0.64 });
      // the barometric window and its scale
      g.fillStyle = '#d9d2bc'; g.fillRect(cx + r * 0.3, cy - r * 0.07, r * 0.32, r * 0.14);
      text(g, '29.92', cx + r * 0.46, cy, r * 0.09, '#111');
      text(g, 'ALT', cx, cy - r * 0.33, r * 0.1, DIM); text(g, '100 FT', cx, cy + r * 0.33, r * 0.08, DIM);
      paint('altimeter', 0, 0.86, 0.045); paint('altimeter', 250, 0.6, 0.065); paint('altimeter', 25, 0.4, 0.09);
      break;
    }
    case 'climb': {
      scale(g, cx, cy, r, kind, 48, 4, (i) => String(Math.abs(i - 6)), { mid: 2, px: 0.2 });
      text(g, 'UP', cx - r * 0.38, cy - r * 0.38, r * 0.11, DIM); text(g, 'DOWN', cx - r * 0.36, cy + r * 0.4, r * 0.1, DIM);
      text(g, 'RATE OF CLIMB', cx + r * 0.08, cy - r * 0.2, r * 0.075, DIM); text(g, '1000 FT PER MIN', cx + r * 0.08, cy + r * 0.2, r * 0.065, DIM);
      paint('climb', 0, 0.84, 0.06);
      break;
    }
    case 'manifold': case 'tach': {
      const man = kind === 'manifold';
      if (man) { band(g, cx, cy, r, kind, 25, 46, '#2f8a3a'); band(g, cx, cy, r, kind, 46, 49, '#c4281c', 0.82, 0.1); }
      else { band(g, cx, cy, r, kind, 14, 25, '#2f8a3a'); band(g, cx, cy, r, kind, 25, 28, '#c9a227'); band(g, cx, cy, r, kind, 28, 28.6, '#c4281c', 0.82, 0.12); }
      if (man) scale(g, cx, cy, r, kind, 60, 10, (i) => String(10 + i * 10), { mid: 5, px: 0.15, nr: 0.62 });
      else scale(g, cx, cy, r, kind, 40, 5, (i) => String(5 + i * 5), { px: 0.15, nr: 0.62 });
      text(g, man ? 'MANIFOLD' : 'TACHOMETER', cx, cy - r * 0.3, r * 0.085, DIM);
      text(g, man ? 'PRESSURE' : 'R.P.M. X 100', cx, cy - r * 0.18, r * 0.075, DIM);
      text(g, opts.pair ?? '1  2', cx, cy + r * 0.38, r * 0.12, INK);
      text(g, opts.side ?? '', cx, cy + r * 0.56, r * 0.08, DIM);
      if (!live) { paint(kind, man ? 31 : 23, 0.8, 0.05); paint(kind, man ? 31.5 : 23.2, 0.8, 0.05, '#e9c86a'); }
      break;
    }
    case 'engine': { // the engine gauge unit: fuel pressure, oil pressure (top left/right), oil temperature below
      const sub = (x, y, rr, name, nums, val) => {
        g.strokeStyle = '#3a3a36'; g.lineWidth = r * 0.02; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
        for (let k = 0; k <= 10; k++) { const a = Math.PI * 0.8 + (Math.PI * 1.4 * k) / 10; g.strokeStyle = INK; g.lineWidth = r * (k % 5 ? 0.012 : 0.025); g.beginPath(); g.moveTo(x + Math.cos(a) * rr * 0.92, y + Math.sin(a) * rr * 0.92); g.lineTo(x + Math.cos(a) * rr * (k % 5 ? 0.78 : 0.68), y + Math.sin(a) * rr * (k % 5 ? 0.78 : 0.68)); g.stroke(); }
        arc(g, x, y, rr * 0.85, Math.PI * 0.8 + Math.PI * 1.4 * 0.45, Math.PI * 0.8 + Math.PI * 1.4 * 0.75, r * 0.03, '#2f8a3a');
        text(g, nums[0], x - rr * 0.55, y + rr * 0.5, r * 0.07); text(g, nums[1], x + rr * 0.55, y + rr * 0.5, r * 0.07);
        text(g, name, x, y + rr * 0.35, r * 0.065, DIM);
        needle(g, x, y, rr, Math.PI * 0.8 + Math.PI * 1.4 * val, 0.82, 0.08);
        g.fillStyle = '#2a2a28'; g.beginPath(); g.arc(x, y, rr * 0.1, 0, TAU); g.fill();
      };
      sub(cx - r * 0.42, cy - r * 0.3, r * 0.46, 'FUEL', ['0', '25'], 0.62);
      sub(cx + r * 0.42, cy - r * 0.3, r * 0.46, 'OIL', ['0', '200'], 0.57);
      sub(cx, cy + r * 0.42, r * 0.46, 'OIL °C', ['0', '100'], 0.6);
      text(g, 'ENGINE GAUGE', cx, cy + r * 0.04, r * 0.07, DIM);
      return finish(g, cx, cy, r, label);
    }
    case 'cht': case 'carb': case 'freeair': case 'fuel': case 'suction': case 'hydraulic': case 'oilT': case 'amps': case 'volts': case 'oxygen': {
      const N = { cht: [7, (i) => String(i * 50)], carb: [4, (i) => String(-50 + i * 50)], freeair: [4, (i) => String(-50 + i * 25)], fuel: [5, (i) => String(i * 85)], suction: [5, (i) => String(i * 2)],
        hydraulic: [6, (i) => String(i * 2)], oilT: [5, (i) => String(i * 20)], amps: [3, (i) => String(i * 100)], volts: [3, (i) => String(i * 10)], oxygen: [5, (i) => String(i * 100)] }[kind];
      if (kind === 'cht') { band(g, cx, cy, r, kind, 150, 232, '#2f8a3a'); band(g, cx, cy, r, kind, 232, 260, '#c4281c', 0.82, 0.1); }
      if (kind === 'carb') { band(g, cx, cy, r, kind, -10, 5, '#c9a227'); band(g, cx, cy, r, kind, 15, 38, '#2f8a3a'); }
      if (kind === 'suction') band(g, cx, cy, r, kind, 3.75, 4.25, '#2f8a3a');
      if (kind === 'hydraulic') band(g, cx, cy, r, kind, 600, 800, '#2f8a3a');
      if (kind === 'oxygen') band(g, cx, cy, r, kind, 400, 450, '#2f8a3a');
      scale(g, cx, cy, r, kind, N[0] * 5, 5, N[1], { px: 0.17, nr: 0.58 });
      const name = { cht: 'CYL TEMP', carb: 'CARB AIR', freeair: 'FREE AIR', fuel: 'FUEL GALS', suction: 'SUCTION', hydraulic: 'HYD PRESS', oilT: 'OIL TEMP', amps: 'AMPERES', volts: 'VOLTS', oxygen: 'OXYGEN' }[kind];
      text(g, name, cx, cy + r * 0.38, r * 0.11, DIM);
      text(g, { cht: '°C', carb: '°C', freeair: '°C', fuel: 'U.S.', suction: 'IN. HG', hydraulic: 'X 100', oilT: '°C', amps: '', volts: 'D.C.', oxygen: 'P.S.I.' }[kind], cx, cy - r * 0.3, r * 0.09, DIM);
      paint(kind, v.a ?? { cht: 195, carb: 25, freeair: -30, fuel: 300, suction: 4, hydraulic: 700, oilT: 70, amps: 150, volts: 28, oxygen: 410 }[kind], 0.78, 0.07);
      break;
    }
    case 'flaps': { // UP at the top, DOWN at the bottom, the needle on the right
      scale(g, cx, cy, r, kind, 9, 9, null, { mid: 3 });
      text(g, 'UP', cx, cy - r * 0.6, r * 0.2); text(g, 'DOWN', cx, cy + r * 0.6, r * 0.2);
      text(g, 'FLAP', cx - r * 0.3, cy - r * 0.12, r * 0.1, DIM); text(g, 'POSITION', cx - r * 0.3, cy + r * 0.04, r * 0.08, DIM);
      paint('flaps', 0, 0.78, 0.07);
      break;
    }
    case 'clock': {
      scale(g, cx, cy, r, kind, 60, 5, (i) => String(i || 12), { px: 0.22, nr: 0.66 });
      // the elapsed-time sub-dial
      g.strokeStyle = DIM; g.lineWidth = r * 0.015; g.beginPath(); g.arc(cx, cy - r * 0.32, r * 0.17, 0, TAU); g.stroke();
      paint('clock', v.h ?? 11.2, 0.5, 0.08); paint('clock', v.m ?? 1.4, 0.8, 0.05);
      needle(g, cx, cy, r, dialAngle('clock', 7.6), 0.85, 0.02, '#c4281c', 0.25);
      break;
    }
    case 'gyro': { // the directional gyro: a card seen edge-on through a window, here a drum of figures
      g.fillStyle = '#050505'; g.fillRect(cx - r * 0.8, cy - r * 0.25, r * 1.6, r * 0.5);
      if (!live) for (let k = -2; k <= 2; k++) text(g, ['33', 'N', '3', '6', 'E'][k + 2], cx + k * r * 0.32, cy, r * 0.2);
      g.strokeStyle = '#e8b13a'; g.lineWidth = r * 0.04; g.beginPath(); g.moveTo(cx, cy - r * 0.42); g.lineTo(cx, cy - r * 0.25); g.stroke();
      text(g, 'DIRECTIONAL GYRO', cx, cy - r * 0.55, r * 0.08, DIM);
      g.strokeStyle = '#8a8a82'; g.lineWidth = r * 0.03; g.strokeRect(cx - r * 0.8, cy - r * 0.25, r * 1.6, r * 0.5);
      // the caging knob's legend
      text(g, 'CAGE · PUSH', cx, cy + r * 0.62, r * 0.08, DIM);
      return finish(g, cx, cy, r, label, true);
    }
    case 'horizon': { // the gyro horizon: its card is a live mesh behind the mask; here the mask and the little aeroplane
      g.fillStyle = '#121211'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.arc(cx, cy, r * 0.78, 0, TAU, true); g.fill('evenodd');
      for (const a of [-60, -30, -20, -10, 10, 20, 30, 60]) { const t = (a - 90) * Math.PI / 180; g.strokeStyle = INK; g.lineWidth = r * 0.03; g.beginPath(); g.moveTo(cx + Math.cos(t) * r * 0.8, cy + Math.sin(t) * r * 0.8); g.lineTo(cx + Math.cos(t) * r * 0.93, cy + Math.sin(t) * r * 0.93); g.stroke(); }
      g.fillStyle = '#e8b13a'; g.beginPath(); g.moveTo(cx, cy - r * 0.93); g.lineTo(cx - r * 0.06, cy - r * 0.8); g.lineTo(cx + r * 0.06, cy - r * 0.8); g.fill();
      return finish(g, cx, cy, r, label, true);
    }
    case 'turn': { // turn and bank: the needle above, the ball in its curved glass tube below
      for (const d of [-1, 1]) { g.fillStyle = INK; g.fillRect(cx + d * r * 0.24 - r * 0.04, cy - r * 0.86, r * 0.08, r * 0.18); }
      g.fillStyle = INK; g.fillRect(cx - r * 0.02, cy - r * 0.86, r * 0.04, r * 0.14);
      g.strokeStyle = '#6a6a62'; g.lineWidth = r * 0.16; g.beginPath(); g.arc(cx, cy - r * 0.55, r * 1.05, Math.PI * 0.37, Math.PI * 0.63); g.stroke();
      g.strokeStyle = '#050505'; g.lineWidth = r * 0.12; g.beginPath(); g.arc(cx, cy - r * 0.55, r * 1.05, Math.PI * 0.37, Math.PI * 0.63); g.stroke();
      for (const d of [-1, 1]) { const a = Math.PI / 2 + d * 0.08; g.strokeStyle = INK; g.lineWidth = r * 0.025; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.98, cy - r * 0.55 + Math.sin(a) * r * 0.98); g.lineTo(cx + Math.cos(a) * r * 1.12, cy - r * 0.55 + Math.sin(a) * r * 1.12); g.stroke(); }
      if (!live) { g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy + r * 0.5, r * 0.07, 0, TAU); g.fill(); needle(g, cx, cy + r * 0.1, r, -Math.PI / 2, 0.85, 0.05); }
      text(g, 'TURN', cx - r * 0.45, cy - r * 0.15, r * 0.09, DIM); text(g, 'BANK', cx + r * 0.45, cy - r * 0.15, r * 0.09, DIM);
      return finish(g, cx, cy, r, label, live);
    }
    case 'compass': case 'radiocompass': { // the fluxgate compass repeater / the radio compass: a card of headings
      const s = SCALES.compass;
      for (let k = 0; k < 72; k++) {
        const a = s.a0 + (TAU * k) / 72, big = k % 6 === 0;
        g.strokeStyle = INK; g.lineWidth = r * (big ? 0.03 : 0.015);
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); g.lineTo(cx + Math.cos(a) * r * (big ? 0.76 : 0.82), cy + Math.sin(a) * r * (big ? 0.76 : 0.82)); g.stroke();
        if (big) text(g, ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'][k / 6], cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.15);
      }
      text(g, kind === 'compass' ? 'FLUX GATE' : 'RADIO COMPASS', cx, cy + r * 0.25, r * 0.07, DIM);
      paint('compass', v.a ?? 95, 0.76, 0.05, kind === 'compass' ? INK : '#e9c86a');
      break;
    }
    case 'dual': { // fuel or oil pressure, two needles (the left engines' or the right's), 1-2 / 3-4
      const oil = opts.what === 'oil';
      band(g, cx, cy, r, 'dual', oil ? 0.35 : 0.5, oil ? 0.45 : 0.75, '#2f8a3a');
      scale(g, cx, cy, r, 'dual', oil ? 40 : 25, 5, (i) => String(i * (oil ? 40 : 5)), { px: 0.16, nr: 0.6 });
      text(g, oil ? 'OIL' : 'FUEL', cx, cy - r * 0.3, r * 0.1, DIM); text(g, 'PRESSURE', cx, cy - r * 0.18, r * 0.08, DIM);
      text(g, opts.side ?? '', cx, cy + r * 0.4, r * 0.08, DIM);
      needle(g, cx, cy, r, dialAngle('dual', oil ? 0.38 : 0.6), 0.8, 0.05); needle(g, cx, cy, r, dialAngle('dual', oil ? 0.39 : 0.62), 0.8, 0.05, '#e9c86a');
      break;
    }
    case 'butterfly': { // the twin-arc temperature faces: two mirrored scales, a needle swinging over each
      for (const s of [-1, 1]) {
        for (let k = 0; k <= 10; k++) { // (the scale runs down the face's side: a tick per tenth)
          const px = cx + s * (r * 0.15 + k * r * 0.06), py = cy - r * 0.7 + k * r * 0.12;
          g.strokeStyle = INK; g.lineWidth = r * (k % 5 ? 0.015 : 0.03);
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * r * (k % 5 ? 0.08 : 0.14), py - r * 0.03); g.stroke();
        }
        arc(g, cx + s * r * 0.15, cy + r * 0.1, r * 0.55, s > 0 ? -Math.PI * 0.5 : Math.PI * 1.5, s > 0 ? -Math.PI * 0.2 : Math.PI * 1.2, r * 0.05, '#2f8a3a');
        needle(g, cx, cy + r * 0.55, r, -Math.PI / 2 + s * 0.42, 0.95, 0.04);
      }
      text(g, opts.what ?? '', cx, cy + r * 0.72, r * 0.1, DIM);
      text(g, 'ENG ' + (opts.pair ?? '1-2'), cx, cy + r * 0.86, r * 0.08, DIM);
      return finish(g, cx, cy, r, label);
    }
    case 'blinker': { // the oxygen flow indicator: a white window whose lids blink open with each breath
      g.fillStyle = '#d8d2bf'; g.fillRect(cx - r * 0.6, cy - r * 0.32, r * 1.2, r * 0.5);
      g.fillStyle = '#1a1a19'; g.fillRect(cx - r * 0.6, cy - r * 0.07, r * 1.2, r * 0.05);
      text(g, 'BLINKER', cx, cy - r * 0.48, r * 0.15, '#111', 'bold'); g.fillStyle = '#111';
      text(g, 'OXYGEN FLOW', cx, cy + r * 0.38, r * 0.11, DIM); text(g, 'INDICATOR', cx, cy + r * 0.54, r * 0.1, DIM);
      return finish(g, cx, cy, r, label);
    }
    case 'pdi': { // the pilot's direction indicator from the bombardier's Norden: one needle, L / R
      for (let k = -5; k <= 5; k++) { const a = -Math.PI / 2 + k * 0.12; g.strokeStyle = INK; g.lineWidth = r * (k % 5 ? 0.02 : 0.04); g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.86, cy + r * 0.3 + Math.sin(a) * r * 0.86); g.lineTo(cx + Math.cos(a) * r * 0.72, cy + r * 0.3 + Math.sin(a) * r * 0.72); g.stroke(); }
      text(g, 'L', cx - r * 0.55, cy - r * 0.15, r * 0.18); text(g, 'R', cx + r * 0.55, cy - r * 0.15, r * 0.18);
      text(g, 'P.D.I.', cx, cy + r * 0.55, r * 0.12, DIM);
      if (!live) needle(g, cx, cy + r * 0.3, r, -Math.PI / 2, 0.8, 0.05);
      return finish(g, cx, cy, r, label, live);
    }
    default: scale(g, cx, cy, r, 'suction', 25, 5, null);
  }
  if (!live) hub(g, cx, cy, r);
  return finish(g, cx, cy, r, label);
}

function finish(g, cx, cy, r, label) {
  // the label plate under the bezel
  if (label) text(g, label, cx, cy + r * 1.33, Math.max(9, r * 0.17), '#c9c2a8');
  return true;
}
