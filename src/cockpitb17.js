// The B-17's flight deck, built to the photos of the real thing: the big black instrument panel across
// both pilots (flight instruments in front of each, the engine instruments in the middle), drawn as
// one high-resolution texture with a matching normal map so the bezels stand out of the panel; the
// glare shield over it with the autopilot unit; the U-shaped control wheels with their hubs on the
// columns; the centre pedestal with the throttles, propeller, mixture and turbo levers; the seats
// with their yellow cushions and armour plate; the overhead switch panel. Knobs and switches are real
// geometry. Everything merges per material (it.add), so it's a handful of draw calls.
import * as THREE from 'three';

const V = THREE.Vector3;
const PANEL = { x0: -0.74, x1: 0.74, y0: 0.06, y1: 0.62, z: -8.5 }; // the panel's face (bomber space)
const W = 2048, H = Math.round(W * (PANEL.y1 - PANEL.y0) / (PANEL.x1 - PANEL.x0)); // texture px
const CRAWL = { x0: -0.26, x1: 0.26, y1: 0.28 }; // the cut-out under the middle: the crawlway to the nose

// the gauges: [x, y] in metres on the panel (0, 0 = its bottom middle), radius, kind, label
const GAUGES = (() => {
  const g = [];
  const side = (s) => { // the flight instruments, the same each side (the co-pilot's set is plainer)
    const x0 = s * 0.52;
    g.push([x0 - s * 0.11, 0.44, 0.042, 'airspeed', 'AIR SPEED'], [x0, 0.44, 0.045, 'horizon', 'GYRO HORIZON'], [x0 + s * 0.11, 0.44, 0.042, 'climb', 'RATE OF CLIMB'],
      [x0 - s * 0.11, 0.33, 0.042, 'altimeter', 'ALTIMETER'], [x0, 0.33, 0.042, 'gyro', 'DIRECTIONAL GYRO'], [x0 + s * 0.11, 0.33, 0.038, 'turn', 'TURN & BANK'],
      [x0 - s * 0.12, 0.215, 0.03, 'suction', 'SUCTION'], [x0 - s * 0.04, 0.215, 0.03, 'clock', 'CLOCK'], [x0 + s * 0.04, 0.215, 0.03, 'compass', 'FLUX GATE'], [x0 + s * 0.12, 0.215, 0.03, 'temp', 'FREE AIR'],
      [x0 - s * 0.1, 0.11, 0.025, 'pressure', 'HYD PRESS'], [x0, 0.11, 0.025, 'temp', 'CARB AIR'], [x0 + s * 0.1, 0.11, 0.025, 'pressure', 'DE-ICER']);
  };
  side(-1); side(1);
  for (let i = 0; i < 4; i++) { // the engine instruments, four of each in the middle
    const x = -0.2 + (i % 2) * 0.1 + (i >= 2 ? 0.2 : 0);
    g.push([x, 0.5, 0.034, 'manifold', i % 2 ? 'MANIFOLD 3-4' : 'MANIFOLD 1-2'], [x, 0.415, 0.034, 'tach', i % 2 ? 'TACH 3-4' : 'TACH 1-2']);
  }
  for (let i = 0; i < 4; i++) { // (above the crawlway cut-out, which comes up to 0.22)
    const x = -0.15 + i * 0.1;
    g.push([x, 0.345, 0.024, 'engine', `ENGINE ${i + 1}`], [x, 0.283, 0.019, 'cht', 'CYL TEMP']);
  }
  g.push([0, 0.555, 0.03, 'compass', 'COMPASS']);
  return g;
})();

function toPx(x, y) { return [(x - PANEL.x0) / (PANEL.x1 - PANEL.x0) * W, (1 - (y + PANEL.y0 - PANEL.y0) / (PANEL.y1 - PANEL.y0)) * H]; }
const pxPerM = W / (PANEL.x1 - PANEL.x0);

let seed = 17;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** One gauge face, drawn at (cx, cy) radius r (px): bezel, scale, numerals, coloured arcs, needle. */
export function drawGauge(g, cx, cy, r, kind, label) {
  // the bezel and its screws
  const bez = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r * 1.18);
  bez.addColorStop(0, '#3c3d3a'); bez.addColorStop(1, '#141413');
  g.fillStyle = bez; g.beginPath(); g.arc(cx, cy, r * 1.18, 0, 7); g.fill();
  g.fillStyle = '#9a968a';
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; g.beginPath(); g.arc(cx + Math.cos(a) * r * 1.32, cy + Math.sin(a) * r * 1.32, r * 0.07, 0, 7); g.fill(); }
  // the dial
  g.fillStyle = '#0b0b0a'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  if (kind === 'horizon') { // the gyro horizon: sky over earth, the little aeroplane
    g.save(); g.beginPath(); g.arc(cx, cy, r * 0.9, 0, 7); g.clip();
    g.fillStyle = '#d7d2c2'; g.fillRect(cx - r, cy - r, r * 2, r);
    g.fillStyle = '#1a1a19'; g.fillRect(cx - r, cy, r * 2, r);
    g.restore();
    g.strokeStyle = '#e8b13a'; g.lineWidth = r * 0.08;
    g.beginPath(); g.moveTo(cx - r * 0.55, cy); g.lineTo(cx - r * 0.15, cy); g.arc(cx, cy, r * 0.15, Math.PI, 0, true); g.lineTo(cx + r * 0.55, cy); g.stroke();
  } else {
    const a0 = kind === 'altimeter' || kind === 'clock' || kind === 'gyro' || kind === 'compass' ? -Math.PI / 2 : Math.PI * 0.75;
    const sweep = a0 === -Math.PI / 2 ? Math.PI * 2 : Math.PI * 1.5;
    // coloured arcs: green the normal range, yellow caution, red the limit
    if (['manifold', 'tach', 'engine', 'cht', 'oil', 'airspeed', 'pressure'].includes(kind)) {
      for (const [f0, f1, col] of [[0.35, 0.72, '#3c8a3a'], [0.72, 0.86, '#c9a62a'], [0.86, 0.9, '#b42a1e']]) {
        g.strokeStyle = col; g.lineWidth = r * 0.1;
        g.beginPath(); g.arc(cx, cy, r * 0.8, a0 + sweep * f0, a0 + sweep * f1); g.stroke();
      }
    }
    g.strokeStyle = '#e4dfcf'; g.fillStyle = '#e4dfcf';
    const n = kind === 'clock' ? 12 : 10;
    for (let k = 0; k <= n * 5; k++) { // the scale
      const a = a0 + (sweep * k) / (n * 5), big = k % 5 === 0;
      g.lineWidth = big ? r * 0.05 : r * 0.025;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * (big ? 0.72 : 0.8), cy + Math.sin(a) * r * (big ? 0.72 : 0.8)); g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); g.stroke();
      if (big && r > 40 && k < n * 5) { // numerals on the bigger gauges
        g.font = `${Math.round(r * 0.2)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(kind === 'clock' ? k / 5 || 12 : k / 5), cx + Math.cos(a) * r * 0.56, cy + Math.sin(a) * r * 0.56);
      }
    }
    // the needle(s)
    const needle = (f, len, w) => { const a = a0 + sweep * f; g.lineWidth = w; g.beginPath(); g.moveTo(cx - Math.cos(a) * r * 0.15, cy - Math.sin(a) * r * 0.15); g.lineTo(cx + Math.cos(a) * r * len, cy + Math.sin(a) * r * len); g.stroke(); };
    g.strokeStyle = '#f0ebdd';
    needle(0.3 + rnd() * 0.4, 0.82, r * 0.06);
    if (['manifold', 'tach', 'altimeter', 'clock', 'engine'].includes(kind)) needle(rnd(), 0.6, r * 0.05);
    g.fillStyle = '#2a2a28'; g.beginPath(); g.arc(cx, cy, r * 0.1, 0, 7); g.fill();
  }
  // glass glint
  const glint = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  glint.addColorStop(0, 'rgba(255,255,255,0.10)'); glint.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = glint; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  // the label under it
  g.fillStyle = '#cfc9b6'; g.font = `bold ${Math.max(9, Math.round(r * 0.17))}px Arial`; g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillText(label, cx, cy + r * 1.36);
}

/** The panel: colour (instruments, placards, worn black paint) and a height field for the normal map. */
function panelTextures() {
  seed = 17;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const h = document.createElement('canvas'); h.width = W / 2; h.height = H / 2;
  const hg = h.getContext('2d');
  // crackle-black paint, worn at the edges
  g.fillStyle = '#1d1e1c'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.03})`; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 14, 1 + rnd() * 4); }
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, W / 2, H / 2);
  // the panel's sections: shock-mounted plates with a raised edge and screws
  const plates = [[-0.74, -0.28, 0.06, 0.62], [-0.27, 0.27, 0.12, 0.62], [0.28, 0.74, 0.06, 0.62]];
  for (const [x0, x1, y0, y1] of plates) {
    const [a, b] = toPx(x0, y1), [c2, d] = toPx(x1, y0);
    g.strokeStyle = '#30312e'; g.lineWidth = 6; g.strokeRect(a + 6, b + 6, c2 - a - 12, d - b - 12);
    hg.strokeStyle = '#b0b0b0'; hg.lineWidth = 3; hg.strokeRect(a / 2 + 3, b / 2 + 3, (c2 - a) / 2 - 6, (d - b) / 2 - 6);
    g.fillStyle = '#8d8a80';
    for (const [sx, sy] of [[a + 18, b + 18], [c2 - 18, b + 18], [a + 18, d - 18], [c2 - 18, d - 18]]) { g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.fill(); }
  }
  // the crawlway cut-out under the middle: drawn dark (the geometry leaves it open)
  { const [a, b] = toPx(CRAWL.x0, CRAWL.y1), [c2, d] = toPx(CRAWL.x1, PANEL.y0); g.fillStyle = '#060606'; g.fillRect(a, b, c2 - a, d - b + 2); }
  for (const [x, y, r, kind, label] of GAUGES) {
    const [cx, cy] = toPx(x, y + PANEL.y0), rp = r * pxPerM;
    drawGauge(g, cx, cy, rp, kind, label);
    // height: the bezel ring stands up, the glass sits back
    hg.fillStyle = '#d8d8d8'; hg.beginPath(); hg.arc(cx / 2, cy / 2, rp * 1.18 / 2, 0, 7); hg.fill();
    hg.fillStyle = '#5a5a5a'; hg.beginPath(); hg.arc(cx / 2, cy / 2, rp / 2, 0, 7); hg.fill();
  }
  // placards and the data plate
  g.font = 'bold 15px Arial'; g.textAlign = 'center';
  for (const [x, y, t] of [[-0.52, 0.035, 'DO NOT EXCEED 305 MPH I.A.S.'], [0.52, 0.035, 'LANDING GEAR WARNING'], [0, 0.6, 'BOEING B-17G'], [0, 0.035, 'FUEL BOOSTER PUMPS']]) {
    const [px, py] = toPx(x, y + PANEL.y0);
    g.fillStyle = '#c9c2a8'; g.fillRect(px - 120, py - 11, 240, 22);
    g.fillStyle = '#1a1a1a'; g.fillText(t, px, py + 5);
  }
  const col = new THREE.CanvasTexture(c);
  col.colorSpace = THREE.SRGBColorSpace;
  col.anisotropy = 8;
  return { color: col, normal: heightToNormal(h, 2.2) };
}

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

function hubTexture() { // the control wheel's hub: the Boeing emblem
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#151515'; g.beginPath(); g.arc(64, 64, 63, 0, 7); g.fill();
  g.strokeStyle = '#b9a872'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
  g.fillStyle = '#c8b77e'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BOEING', 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function autopilotTexture() { // the C-1 autopilot controller on the glare shield
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#20211f'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#d2ccb8'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.fillText('AUTOMATIC PILOT', 128, 16);
  for (let i = 0; i < 3; i++) { g.strokeStyle = '#d2ccb8'; g.lineWidth = 2; g.beginPath(); g.arc(56 + i * 72, 58, 22, 0, 7); g.stroke(); g.fillText(['AILERON', 'RUDDER', 'ELEVATOR'][i], 56 + i * 72, 92); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const std = (c, r = 0.7, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 0.25 });
const M = {
  panel: null, green: std(0x4c5638, 0.75, 0.15), black: std(0x161716, 0.55, 0.25), knob: std(0x111111, 0.4, 0.1),
  red: std(0x8a1a12, 0.5), steel: std(0x8f918a, 0.4, 0.75), cushion: std(0xc9a033, 0.85), armour: std(0x3b4230, 0.6, 0.45),
  hub: null, ap: null, white: std(0xd8d2be, 0.6),
};

/** it = the Interior (add/box/rod/cylinder helpers). */
export function buildB17Cockpit(it) {
  const f = -0.40, z = PANEL.z;
  // ---- the instrument panel: one textured face (left, middle, right), cut out at the crawlway
  const tex = panelTextures();
  M.panel ??= new THREE.MeshStandardMaterial({ map: tex.color, normalMap: tex.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.55, metalness: 0.2, envMapIntensity: 0.35 });
  const face = new THREE.Shape([new THREE.Vector2(PANEL.x0, PANEL.y0), new THREE.Vector2(CRAWL.x0, PANEL.y0), new THREE.Vector2(CRAWL.x0, CRAWL.y1), new THREE.Vector2(CRAWL.x1, CRAWL.y1),
    new THREE.Vector2(CRAWL.x1, PANEL.y0), new THREE.Vector2(PANEL.x1, PANEL.y0), new THREE.Vector2(PANEL.x1, PANEL.y1), new THREE.Vector2(PANEL.x0, PANEL.y1)]);
  const fg = new THREE.ShapeGeometry(face);
  const uv = fg.attributes.uv, pos = fg.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - PANEL.x0) / (PANEL.x1 - PANEL.x0), (pos.getY(i) - PANEL.y0) / (PANEL.y1 - PANEL.y0));
  const panel = new THREE.Mesh(fg.translate(0, 0, z), M.panel);
  panel.receiveShadow = true;
  it.group.add(panel);
  // its frame and back (a solid: you crawl under the middle, not through the panel)
  it.box(PANEL.x0, CRAWL.x0, PANEL.y0, PANEL.y1, z - 0.12, z - 0.005, M.black);
  it.box(CRAWL.x1, PANEL.x1, PANEL.y0, PANEL.y1, z - 0.12, z - 0.005, M.black);
  it.box(CRAWL.x0, CRAWL.x1, CRAWL.y1, PANEL.y1, z - 0.12, z - 0.005, M.black);
  for (const [x0, x1, y0, y1] of [[PANEL.x0 - 0.02, PANEL.x1 + 0.02, PANEL.y1, PANEL.y1 + 0.02], [PANEL.x0 - 0.02, PANEL.x0, PANEL.y0, PANEL.y1], [PANEL.x1, PANEL.x1 + 0.02, PANEL.y0, PANEL.y1]]) it.box(x0, x1, y0, y1, z - 0.02, z + 0.012, M.green, false);
  // knobs at the gauges and rows of toggle switches along the bottom, as real geometry
  seed = 99;
  for (const [x, y, r] of GAUGES) if (r > 0.03 && rnd() < 0.6) it.cylinder(0.006, 0.014, x + r * 0.95, y + PANEL.y0 - r * 0.95, z + 0.008, 'z', M.knob, 8);
  for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) {
    const x = sx * (0.34 + i * 0.038), y = PANEL.y0 + 0.035;
    it.add(M.steel, new THREE.CylinderGeometry(0.0025, 0.002, 0.022, 5).rotateX(Math.PI / 2 - 0.5).translate(x, y + 0.004, z + 0.012));
    it.add(M.black, new THREE.BoxGeometry(0.014, 0.018, 0.006).translate(x, y, z + 0.003));
  }
  for (let i = 0; i < 4; i++) it.cylinder(0.008, 0.012, -0.075 + i * 0.05, PANEL.y0 + 0.31, z + 0.006, 'z', M.red, 8); // the feathering buttons
  // ---- the glare shield, padded, with the autopilot controller in the middle
  it.box(PANEL.x0 - 0.04, PANEL.x1 + 0.04, PANEL.y1 + 0.02, PANEL.y1 + 0.05, z - 0.18, z + 0.04, M.black, false);
  it.cylinder(0.025, (PANEL.x1 - PANEL.x0) + 0.08, 0, PANEL.y1 + 0.04, z + 0.04, 'x', M.black, 10);
  M.ap ??= new THREE.MeshStandardMaterial({ map: autopilotTexture(), roughness: 0.6 });
  it.box(-0.13, 0.13, PANEL.y1 + 0.05, PANEL.y1 + 0.13, z - 0.1, z + 0.02, M.black, false);
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.075), M.ap);
  ap.position.set(0, PANEL.y1 + 0.09, z + 0.021);
  it.group.add(ap);
  // ---- the control columns and their U-shaped wheels with the Boeing hub
  M.hub ??= new THREE.MeshStandardMaterial({ map: hubTexture(), roughness: 0.5, metalness: 0.3 });
  for (const x of [-0.55, 0.55]) {
    it.cylinder(0.035, 0.48, x, f + 0.24, -8.2, 'y', M.green, 12); // the column
    it.box(x - 0.06, x + 0.06, f, f + 0.04, -8.28, -8.12, M.green, false); // its foot
    it.cylinder(0.018, 0.12, x, 0.15, -8.2 + 0.05, 'z', M.steel, 8); // the shaft to the wheel
    const yoke = new THREE.CatmullRomCurve3([[-0.15, 0.1], [-0.155, 0.04], [-0.13, -0.02], [-0.07, -0.045], [0, -0.05], [0.07, -0.045], [0.13, -0.02], [0.155, 0.04], [0.15, 0.1]].map(([a, b]) => new V(x + a, 0.2 + b, -8.09)));
    it.add(M.black, new THREE.TubeGeometry(yoke, 32, 0.014, 8));
    for (const s of [-1, 1]) it.add(M.black, new THREE.CapsuleGeometry(0.019, 0.07, 3, 8).translate(x + s * 0.15, 0.32, -8.09)); // the grips
    it.add(M.black, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20).rotateX(Math.PI / 2).translate(x, 0.17, -8.1));
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.046, 24), M.hub);
    hub.position.set(x, 0.17, -8.084);
    it.group.add(hub);
    for (const s of [-1, 1]) it.box(x + s * 0.13 - 0.04, x + s * 0.13 + 0.04, f + 0.05, f + 0.17, -8.48, -8.42, M.steel, false); // rudder pedals
  }
  // ---- the centre pedestal: throttles with their bar, propeller and mixture levers, the turbo boost dial
  it.box(-0.14, 0.14, f, 0.0, -8.38, -7.8, M.green, false);
  it.add(M.green, new THREE.BoxGeometry(0.28, 0.05, 0.42).rotateX(0.32).translate(0, 0.03, -8.12));
  it.add(M.black, new THREE.BoxGeometry(0.22, 0.012, 0.3).rotateX(0.32).translate(0, 0.058, -8.12)); // the quadrant's slots
  for (let i = 0; i < 4; i++) {
    const x = -0.075 + i * 0.05;
    it.rod([x, 0.05, -8.02], [x, 0.2, -8.08], 0.006, M.steel); // throttle
    it.rod([x + 0.012, 0.03, -8.24], [x + 0.012, 0.14, -8.3], 0.005, M.steel); // propeller
    it.add(M.red, new THREE.SphereGeometry(0.011, 8, 6).translate(x + 0.012, 0.145, -8.302));
    it.rod([x - 0.012, 0.03, -8.24], [x - 0.012, 0.12, -8.28], 0.005, M.steel); // mixture
    it.add(M.white, new THREE.SphereGeometry(0.01, 8, 6).translate(x - 0.012, 0.125, -8.282));
  }
  it.rod([-0.1, 0.205, -8.083], [0.1, 0.205, -8.083], 0.01, M.black); // the throttle bar
  it.cylinder(0.03, 0.02, 0.1, 0.02, -7.92, 'y', M.black, 16); // turbo boost selector
  it.cylinder(0.035, 0.02, -0.15, -0.15, -7.95, 'x', M.black, 14); // the trim wheel on the side
  // ---- the seats: frames, yellow cushions, armoured backs
  for (const x of [-0.55, 0.55]) {
    it.box(x - 0.24, x + 0.24, f, f + 0.36, -7.85, -7.35, M.green); // the frame (a solid, as before)
    it.box(x - 0.23, x + 0.23, f + 0.36, f + 0.45, -7.84, -7.36, M.cushion, false);
    it.box(x - 0.23, x + 0.23, f + 0.47, f + 1.02, -7.37, -7.29, M.cushion);
    it.box(x - 0.24, x + 0.24, f + 0.42, f + 1.15, -7.29, -7.24, M.armour, false);
    for (const s of [-1, 1]) it.box(x + s * 0.25 - 0.015, x + s * 0.25 + 0.015, f + 0.36, f + 0.62, -7.8, -7.4, M.green, false); // armrests
  }
  // ---- the overhead switch panel between the pilots
  // (small and up against the roof, just behind the windscreen, so it isn't in the pilots' view)
  const oz = -7.95, oy = it.ceilingAt(oz, 0, 0) - 0.01;
  it.box(-0.1, 0.1, oy - 0.022, oy, oz - 0.06, oz + 0.06, M.black, false);
  for (let i = 0; i < 6; i++) it.add(M.steel, new THREE.CylinderGeometry(0.0025, 0.002, 0.016, 5).translate(-0.06 + (i % 3) * 0.06, oy - 0.03, oz - 0.025 + Math.floor(i / 3) * 0.05));
}
