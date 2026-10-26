// More of what fills a real B-17: the stringers and conduit along the walls and ceiling, dome lights,
// the throttle pedestal, rudder pedals and armour plate in the cockpit, the navigator's instruments,
// ammunition cans, oxygen bottles and an extinguisher in the nose, spent .50 cases rolling on the
// waist and tail floors, flak helmets and vests, a first-aid kit, the radio operator's lamp and log,
// the tail gunner's knee pads and seat; the Norden's knobs and the bombardier's panel, oxygen
// regulators and interphone boxes at every post, the engineer's panel, frames round the side windows
// (found from the model's window cut-outs), the catwalk's supports, bomb shackles, the radio sets on
// their racks, chest packs and Mae Wests on hooks, fire extinguishers, rivets along the frames, and
// wear and oil stains on the floor. All decoration: no colliders, clear of the walkway and the gun
// views, merged per material (each material is one draw call however many parts use it).
import * as THREE from 'three';

const std = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 0.15 });
const M = {
  stringer: std(0x7a7f6c, 0.6, 0.4),
  brass: std(0xb58a3c, 0.35, 0.9),
  white: std(0xd8d4c6, 0.8),
  od: std(0x4a4f33, 0.75, 0.1),
  helmet: std(0x4d5236, 0.6, 0.2),
  knob: std(0x8a1c14, 0.5),
  black: std(0x161616, 0.6),
  paper: std(0xd9cfae, 0.95),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd88a, emissiveIntensity: 0.6, roughness: 0.4 }),
  mae: std(0xc29a2a, 0.75),
  stain: null, // made on first use (a canvas texture)
};

function stainMaterial() { // a soft dark blot: oil, hydraulic fluid, scuffs from boots
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(20,16,10,0.55)'); grd.addColorStop(0.6, 'rgba(25,20,12,0.25)'); grd.addColorStop(1, 'rgba(25,20,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
}

let seed = 2024;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rand = (a, b) => a + rnd() * (b - a);

function dialPlate(n) { // a little instrument board: rows of dials on black
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1a'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < n; i++) {
    const x = 34 + (i % 4) * 62, y = 34 + Math.floor(i / 4) * 60;
    g.fillStyle = '#080808'; g.beginPath(); g.arc(x, y, 25, 0, 7); g.fill();
    g.strokeStyle = '#d8d4c4'; g.lineWidth = 2;
    for (let k = 0; k < 10; k++) { const a = k * 0.63; g.beginPath(); g.moveTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.lineTo(x + Math.cos(a) * 23, y + Math.sin(a) * 23); g.stroke(); }
    const a = rnd() * 6.28; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, envMapIntensity: 0.1 });
}

/** it = the Interior (its add / box / rod / cylinder helpers and hull table), MAT its materials. */
export function addMoreDetail(it, MAT, DECKS) {
  seed = 2024;
  const deckAt = (z) => DECKS.find((d) => z >= d.z0 && z < d.z1);
  const wallX = (z, y, inset = 0.02) => it.hw(z, y) - inset;

  // ---- structure: stringers along the walls between the frames (not across the windows)
  const windows = [[1.3, 2.3, 0.5, 1.25], [-2.5, -1.4, 0.9, 1.6]]; // waist windows, radio room window: z0, z1, height band above the deck
  for (const s of [-1, 1]) for (const up of [0.22, 0.6, 1.0, 1.45]) {
    let prev = null;
    for (let z = -2.5; z <= 9.4; z += 0.25) {
      const d = deckAt(z);
      if (!d) { prev = null; continue; }
      const y = d.y + up, w = wallX(z, y);
      const blocked = windows.some(([z0, z1, h0, h1]) => z > z0 && z < z1 && up > h0 && up < h1);
      if (!(w > 0.2) || !Number.isFinite(w) || blocked) { prev = null; continue; }
      const p = [s * w, y, z];
      if (prev && Math.abs(prev[1] - p[1]) < 0.3) it.rod(prev, p, 0.011, M.stringer, 4);
      prev = p;
    }
  }
  // conduit along the ceiling with junction boxes, and the dome lights
  let prev = null;
  for (let z = -2.4; z <= 4.4; z += 0.5) { // (the tail is too low for it: it would hang at head height)
    const d = deckAt(z);
    if (!d || (z > -2.45 && z < -0.9)) { prev = null; continue; } // (not across the radio room's gun hatch)
    const y = it.ceilingAt(z, 0.18, d.y + 0.3) - 0.06;
    const p = [0.18, y, z];
    if (prev && Math.abs(prev[1] - y) < 0.4) it.rod(prev, p, 0.016, M.od, 6);
    prev = p;
    if (Math.abs(z % 2) < 0.01) it.add(M.od, new THREE.BoxGeometry(0.1, 0.06, 0.12).translate(0.18, y - 0.03, z));
  }
  for (const z of [-2.5, 0.6, 3.6]) { // (the radio room's ahead of its gun hatch) // (none in the tail passage: the roof is so low there it hung right in your eye line)
    const d = deckAt(z), y = it.ceilingAt(z, 0, d.y + 0.3);
    it.add(M.black, new THREE.CylinderGeometry(0.07, 0.08, 0.04, 14).translate(-0.12, y - 0.02, z));
    it.add(M.lamp, new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(-0.12, y - 0.04, z));
  }

  // ---- cockpit (the panel, wheels, pedestal and seats are in cockpitb17.js): side consoles
  const cf = -0.40;
  const plate = dialPlate(8);
  for (const s of [-1, 1]) { // side consoles along the walls, with their dials
    const x = s * Math.min(0.9, wallX(-7.9, cf + 0.35, 0.12));
    it.box(x - 0.09, x + 0.09, cf, cf + 0.42, -8.35, -7.45, MAT.dark, false);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.16), plate);
    face.rotation.x = -Math.PI / 2; face.position.set(x, cf + 0.425, -7.9);
    it.group.add(face);
  }

  // ---- nose: ammunition for the cheek and nose guns, the oxygen bottles, a fire extinguisher, the
  // Norden's stabiliser and eyepiece on their stand
  const nf = -0.72;
  for (const s of [-1, 1]) it.box(s * 0.55 - 0.13, s * 0.55 + 0.13, nf, nf + 0.28, -9.95, -9.65, MAT.ammo, false);
  for (const [x, z] of [[-0.42, -10.35], [0.5, -10.3]]) { // spare boxes for the nose guns, on the floor by the glass
    it.box(x - 0.1, x + 0.1, nf, nf + 0.2, z - 0.13, z + 0.13, MAT.ammo, false);
    it.box(x - 0.105, x + 0.105, nf + 0.2, nf + 0.215, z - 0.135, z + 0.135, MAT.dark, false); // (the lid)
  }
  for (const [i, y] of [[0, -0.42], [1, -0.26]]) { // two yellow A-4 oxygen bottles strapped along the right wall
    const z = -9.55 - i * 0.02, x = wallX(z, y, 0.13);
    it.add(M.mae, new THREE.CapsuleGeometry(0.075, 0.3, 4, 14).rotateX(Math.PI / 2).translate(x, y, z));
    it.cylinder(0.012, 0.04, x, y, z - 0.25, 'z', MAT.metal, 8); // its valve
  }
  for (const z of [-9.45, -9.68]) it.rod([wallX(z, -0.5, 0.03), -0.5, z], [wallX(z, -0.16, 0.03), -0.16, z], 0.006, M.black, 4); // the straps
  { // the fire extinguisher on its bracket, left wall by the bulkhead
    const z = -9.05, y = -0.35, x = -wallX(z, y, 0.08);
    it.add(M.knob, new THREE.CylinderGeometry(0.05, 0.05, 0.36, 14).translate(x, y, z));
    it.add(M.knob, new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y + 0.18, z));
    it.add(M.black, new THREE.BoxGeometry(0.03, 0.06, 0.1).translate(x, y + 0.24, z)); // the head and its handle
    it.rod([x, y + 0.22, z + 0.04], [x + 0.05, y + 0.05, z + 0.07], 0.007, M.black, 5); // the hose
    for (const dy of [-0.1, 0.1]) it.box(x - 0.06, x - 0.045, y + dy - 0.01, y + dy + 0.01, z - 0.06, z + 0.06, MAT.metal, false);
  }
  // the Norden: the stabiliser on the stand, the sight head on it with the telescope and the eyepiece
  it.box(-0.12, 0.12, -0.27, -0.2, -10.62, -10.34, M.black, false);
  it.cylinder(0.035, 0.12, 0, -0.18, -10.62, 'z', MAT.metal, 12); // the telescope's barrel, out ahead
  it.cylinder(0.022, 0.06, 0, 0.03, -10.4, 'y', M.black, 12); // the eyepiece on top, with its rubber cup
  it.add(M.black, new THREE.TorusGeometry(0.024, 0.008, 6, 14).rotateX(Math.PI / 2).translate(0, 0.065, -10.4));
  for (const s of [-1, 1]) it.box(s * 0.13 - 0.01, s * 0.13 + 0.01, -0.2, -0.04, -10.56, -10.46, MAT.metal, false); // (the side plates the knobs are on)

  // ---- the waist: spent cases on the floor round the guns, helmets and flak vests, a first-aid kit
  const cases = (n, x0, x1, z0, z1, y) => {
    for (let i = 0; i < n; i++) {
      const g = new THREE.CylinderGeometry(0.0065, 0.0065, 0.1, 6).rotateZ(Math.PI / 2).rotateY(rand(0, Math.PI));
      it.add(M.brass, g.translate(rand(x0, x1), y + 0.007, rand(z0, z1)));
    }
  };
  for (const s of [-1, 1]) cases(70, s > 0 ? 0.2 : -0.75, s > 0 ? 0.75 : -0.2, 1.2, 2.7, -1.95);
  cases(40, -0.3, 0.3, 9.2, 10.0, -2.32);
  cases(14, -0.5, 0.5, -7.0, -6.5, -0.40); // under the top turret
  for (const [x, z] of [[-0.62, 3.35], [0.66, 0.4]]) { // M4 flak helmets on the floor
    it.add(M.helmet, new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, -1.95, z));
  }
  for (const s of [-1, 1]) { // flak vests hung on the wall behind each gunner
    const z = 2.85, y = -1.25, x = s * wallX(z, y, 0.05);
    it.add(M.od, new THREE.BoxGeometry(0.04, 0.5, 0.36).translate(x, y, z));
    it.rod([x, y + 0.25, z], [s * wallX(z, y + 0.4, 0.02), y + 0.36, z], 0.006, MAT.metal);
  }
  { // the first-aid kit, white with its red cross
    const z = 4.4, y = -1.15, x = wallX(z, y, 0.05);
    it.add(M.white, new THREE.BoxGeometry(0.06, 0.24, 0.32).translate(x, y, z));
    it.add(M.knob, new THREE.BoxGeometry(0.004, 0.14, 0.04).translate(x - 0.031, y, z));
    it.add(M.knob, new THREE.BoxGeometry(0.004, 0.04, 0.14).translate(x - 0.031, y, z));
  }

  // ---- the tail gunner's knee pads, and his little seat behind him on its post
  for (const s of [-1, 1]) it.box(s * 0.13 - 0.07, s * 0.13 + 0.07, -2.32, -2.26, 9.85, 10.1, MAT.leather, false);
  it.cylinder(0.02, 0.3, 0, -2.17, 9.3, 'y', MAT.metal, 8);
  it.box(-0.11, 0.11, -2.03, -1.98, 9.2, 9.42, MAT.leather, false);

  const plates = dialPlate(8);
  const panel = (w, h, x, y, z, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plates); m.position.set(x, y, z); m.rotation.y = rotY; it.group.add(m); };

  // ---- the nose: the Norden's knobs, the bombardier's panel on the left wall
  for (const s of [-1, 1]) it.cylinder(0.022, 0.03, s * 0.125, -0.14, -10.5, 'x', M.black, 10);
  it.box(-0.04, 0.04, -0.06, 0.0, -10.62, -10.56, M.black, false);
  { const z = -10.15, y = -0.25, x = -wallX(z, y, 0.06); it.box(x - 0.03, x + 0.02, y - 0.1, y + 0.1, z - 0.17, z + 0.17, MAT.dark, false); panel(0.32, 0.18, x + 0.021, y, z, Math.PI / 2); }

  // ---- the cockpit: the engineer's panel on the right wall behind the co-pilot
  { const z = -6.95, y = 0.35, x = wallX(z, y, 0.06); it.box(x - 0.02, x + 0.03, y - 0.15, y + 0.15, z - 0.24, z + 0.24, MAT.dark, false); panel(0.46, 0.28, x - 0.021, y, z, -Math.PI / 2); }

  // ---- frames round the side windows (where the model's skin is cut for glass)
  const frame = (side, z0, z1, y0, y1, splits = []) => {
    const P = (z, y) => [side * wallX(z, y, 0.012), y, z];
    it.rod(P(z0, y0), P(z1, y0), 0.009, MAT.metal); it.rod(P(z0, y1), P(z1, y1), 0.009, MAT.metal);
    for (const z of [z0, ...splits, z1]) it.rod(P(z, y0), P(z, y1), 0.009, MAT.metal);
  };
  for (const side of [-1, 1]) {
    frame(side, -8.75, -6.3, 0.27, 0.67, [-7.6]); // the pilots' side windows (the front one slides)
    frame(side, -9.4, -8.2, -0.72, -0.38); // the nose's side windows
    frame(side, -2.52, -2.08, -0.25, 0.06); // the radio room's
  }

  // ---- the bomb bay: posts and braces under the catwalk
  for (let z = -5.5; z <= -2.7; z += 0.6) for (const x of [-0.12, 0.12]) {
    it.rod([x, -2.2, z], [x, -1.66, z], 0.012, MAT.metal);
    it.rod([x, -2.2, z], [x, -1.7, z + 0.6], 0.008, MAT.metal);
  }
  // (the bombs' shackles and racks: interior.js buildBombBay)

  // ---- the radio room (its sets are in stations.js): the shelf under the command sets
  it.box(wallX(-1.75, -1.25, 0.08) - 0.1, wallX(-1.75, -1.25, 0.08) + 0.04, -1.25, -1.22, -1.98, -1.52, MAT.metal, false); // the shelf

  // ---- oxygen regulators and interphone jack boxes at every post, on the nearest wall
  const posts = [[-10.25, -0.35, -1], [-9.5, 0.05, -1], [-7.55, 0.2, -1], [-7.55, 0.2, 1], [-6.75, 0.45, 1], [-2.3, -1.25, -1], [2.45, -1.45, -1], [2.45, -1.45, 1], [9.2, -1.85, 1], [-0.2, -1.5, 1]];
  const reg = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), dialPlate(1));
  for (const [z, y, side] of posts) {
    const x = side * wallX(z, y, 0.035);
    it.add(M.od, new THREE.BoxGeometry(0.05, 0.14, 0.1).translate(x, y, z));
    const face = reg.clone(); face.position.set(x - side * 0.026, y + 0.03, z); face.rotation.y = -side * Math.PI / 2; it.group.add(face);
    it.rod([x - side * 0.02, y - 0.07, z], [x - side * 0.12, y - 0.35, z + 0.15], 0.01, M.black); // its hose
    const jx = side * wallX(z + 0.16, y - 0.05, 0.03);
    it.add(M.black, new THREE.BoxGeometry(0.04, 0.08, 0.06).translate(jx, y - 0.05, z + 0.16)); // interphone jack box
    it.rod([jx - side * 0.02, y - 0.09, z + 0.16], [jx - side * 0.08, y - 0.3, z + 0.22], 0.004, M.black);
  }

  // ---- chest packs and Mae Wests on their hooks, fire extinguishers
  for (const [z, y, side] of [[-1.55, -1.05, -1], [3.85, -1.15, -1], [3.85, -1.15, 1], [-9.0, -0.05, 1], [-7.0, 0.1, -1]]) {
    const x = side * wallX(z, y, 0.08);
    it.add(M.od, new THREE.BoxGeometry(0.11, 0.22, 0.32).translate(x, y, z));
    for (const dz of [-0.09, 0.09]) it.add(MAT.metal, new THREE.TorusGeometry(0.018, 0.005, 4, 8).rotateY(Math.PI / 2).translate(x - side * 0.06, y + 0.06, z + dz));
    const mz = z + 0.32, mx = side * wallX(mz, y, 0.06);
    for (const dz of [-0.05, 0.05]) it.add(M.mae, new THREE.CapsuleGeometry(0.04, 0.22, 3, 8).translate(mx, y - 0.05, mz + dz));
    it.rod([mx, y + 0.12, mz], [side * wallX(mz, y + 0.2, 0.02), y + 0.2, mz], 0.005, MAT.metal); // the hook
  }
  for (const [x, y, z] of [[0.72, -0.18, -7.05], [-0.7, -1.7, 4.05], [0.36, -1.95, 8.65]]) {
    it.cylinder(0.06, 0.36, x, y, z, 'y', MAT.red, 12);
    it.cylinder(0.015, 0.06, x, y + 0.21, z, 'y', M.black, 6);
  }

  // ---- rivets along the fuselage frames, from the radio room to the tail
  for (let z = -2.5; z < 9.5; z += 0.5) {
    const deck = deckAt(z);
    if (!deck) continue;
    const [, , pts] = it.outline(z, deck.y + 0.9, 0.03);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      if (p.y < deck.y + 0.05) continue;
      it.add(MAT.metal, new THREE.SphereGeometry(0.006, 4, 3).translate(p.x, p.y, z + 0.035));
    }
  }

  // ---- quilted insulation on the radio room's walls, between the frames below the window
  const patch = (side, z0, z1, y0, y1, mat) => { // a strip of wall lining following the hull's curve
    const pts = [], uv = [], idx = [];
    const rows = 6;
    for (let i = 0; i <= rows; i++) for (const [k, z] of [[0, z0], [1, z1]]) {
      const y = y0 + (y1 - y0) * (i / rows);
      pts.push(side * wallX(z, y, 0.045), y, z); uv.push(k, i / rows);
    }
    for (let i = 0; i < rows; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(side < 0 ? idx : idx.map((_, j) => idx[j - (j % 3) + [0, 2, 1][j % 3]]));
    g.computeVertexNormals();
    it.add(mat, g.toNonIndexed());
  };
  for (const side of [-1, 1]) for (let z = -2.45; z < -1.4; z += 0.5) patch(side, z + 0.05, z + 0.45, -1.7, -0.95, MAT.pad);

  // ---- pulleys on the control cables, every two metres along both walls
  for (const s of [-1, 1]) for (let z = 0; z <= 8; z += 2) {
    const d = deckAt(z), y = d.y + 1.32, x = s * (it.hw(z, y) - 0.06);
    if (!Number.isFinite(x) || Math.abs(x) < 0.2) continue;
    it.add(M.black, new THREE.TorusGeometry(0.03, 0.008, 5, 14).rotateY(Math.PI / 2).translate(x, y, z));
    it.add(MAT.metal, new THREE.BoxGeometry(0.02, 0.07, 0.03).translate(x + s * 0.03, y, z));
  }

  // ---- wear and oil on the floor: under the guns, along the walkway, round the turrets
  M.stain ??= stainMaterial();
  const stains = [[0, -1.95, 1.9, 1.2], [-0.45, -1.95, 2.3, 0.6], [0.45, -1.95, 2.0, 0.6], [0, -1.95, 3.6, 0.9], [0, -1.8, -1.9, 0.7], [0.1, -1.95, 0.9, 0.8], [0, -2.32, 9.6, 0.5], [0, -0.4, -6.75, 0.8], [0.2, -0.72, -9.3, 0.7], [0, -2.15, 6.6, 0.5]];
  for (const [x, y, z, size] of stains) it.add(M.stain, new THREE.PlaneGeometry(size * rand(0.8, 1.3), size).rotateX(-Math.PI / 2).rotateY(rand(0, 3)).translate(x, y + 0.003, z));
}
