// The B-17's waist, as the photos of the real ones show it (hackathon/WAIST_SPEC.md): the open gun
// windows with their riveted frames, the hinged window panels swung up and latched under the roof and the
// wind deflectors ahead of them, armour plate under the sills; the tall 1943 ammunition boxes on their
// racks under each window (the feed chutes up to the guns are weapons.js's, they move with the guns);
// dense Z-section stringers in zinc chromate between the frames; an A-12 oxygen regulator and a BC-366
// interphone jack box at each gunner; the yellow oxygen bottles strapped by the ball turret; the ball's
// azimuth drum, crank and support column up to its beam under the roof; aluminium treads on the walkway;
// the radio room's door standing open against its bulkhead.
import * as THREE from 'three';

const V = THREE.Vector3;
const std = (color, roughness = 0.7, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.15 });

// the waist window's opening in the model's skin (bomber space, z and y; the same both sides), traced from
// the paint's cut-out: square at the bottom, its top edge falling away aft
const WIN = [[1.43, -1.29], [1.52, -1.33], [1.85, -1.35], [2.13, -1.345], [2.24, -1.3], [2.26, -1.0], [2.26, -0.76], [2.17, -0.705],
  [1.8, -0.675], [1.55, -0.655], [1.46, -0.675], [1.425, -0.76], [1.425, -1.0]];

let M = null;
function materials() {
  const outside = (m) => { m.userData.outside = true; return m; }; // (lit as the outside of the plane is)
  return {
    zinc: std(0x7d874c, 0.6, 0.35), // zinc chromate on the bare structure
    alu: std(0x7a7e78, 0.55, 0.6), // bare aluminium: treads, rack angles
    armour: std(0x3e4232, 0.65, 0.45), // the plate, olive drab over steel
    od: std(0x4a4e33, 0.75, 0.15),
    black: std(0x151515, 0.6, 0.2),
    steel: std(0x3a3c38, 0.5, 0.6),
    red: std(0x8a1c14, 0.5, 0.2),
    yellow: std(0xb8932c, 0.55, 0.15),
    webbing: std(0x5f5a44, 0.95, 0),
    glass: Object.assign(new THREE.MeshStandardMaterial({ color: 0xb8c4c8, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 0.6 }), { side: THREE.DoubleSide }),
    deflector: outside(std(0x4b5036, 0.7, 0.1)),
    regulator: faceMaterial(regulatorFace()),
    jackbox: faceMaterial(jackFace()),
  };
}

function faceMaterial(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, envMapIntensity: 0.1 });
}

/** The A-12 demand regulator's face: its pressure gauge, the blinker, the AUTO-MIX lever and the red emergency knob. */
function regulatorFace() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#2f3324'; g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(64, 54, 38, 0, 7); g.fill(); // the pressure gauge
  g.strokeStyle = '#ddd8c4'; g.lineWidth = 2;
  for (let k = 0; k <= 10; k++) { const a = Math.PI * (0.75 + k * 0.15); g.beginPath(); g.moveTo(64 + Math.cos(a) * 28, 54 + Math.sin(a) * 28); g.lineTo(64 + Math.cos(a) * 35, 54 + Math.sin(a) * 35); g.stroke(); }
  g.lineWidth = 3; g.beginPath(); g.moveTo(64, 54); g.lineTo(64 + Math.cos(Math.PI * 1.9) * 27, 54 + Math.sin(Math.PI * 1.9) * 27); g.stroke();
  g.fillStyle = '#ddd8c4'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText('OXYGEN', 64, 78); g.font = '9px sans-serif'; g.fillText('LBS. PER SQ. IN.', 64, 88);
  g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(40, 128, 17, 0, 7); g.fill(); // the blinker: its lids open and shut as he breathes
  g.fillStyle = '#d9c84a'; g.fillRect(29, 124, 22, 8);
  g.fillStyle = '#ddd8c4'; g.font = '9px sans-serif'; g.fillText('FLOW', 40, 156);
  g.fillText('AUTO-MIX', 92, 112); g.fillStyle = '#bdb8a4'; g.fillRect(84, 120, 16, 26); g.fillStyle = '#ddd8c4'; g.fillText('ON', 78, 160); g.fillText('OFF', 106, 160);
  g.font = 'bold 10px sans-serif'; g.fillText('TYPE A-12', 64, 182);
  return c;
}

/** The BC-366 jack box: its volume knob's scale, the two jacks, the call switch. */
function jackFace() {
  const c = document.createElement('canvas'); c.width = 96; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1d1e1b'; g.fillRect(0, 0, 96, 128);
  g.strokeStyle = '#d8d4c4'; g.fillStyle = '#d8d4c4'; g.lineWidth = 2;
  g.beginPath(); g.arc(48, 46, 26, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
  for (let k = 0; k <= 8; k++) { const a = Math.PI * (0.8 + k * 0.175); g.beginPath(); g.moveTo(48 + Math.cos(a) * 26, 46 + Math.sin(a) * 26); g.lineTo(48 + Math.cos(a) * 31, 46 + Math.sin(a) * 31); g.stroke(); }
  g.font = '9px sans-serif'; g.textAlign = 'center'; g.fillText('VOLUME', 48, 84); g.fillText('PHONES   MIC', 48, 118);
  g.font = 'bold 9px sans-serif'; g.fillText('BC-366', 48, 12);
  return c;
}

/** Build it all into the interior `it` (its add / box / rod / cylinder helpers, hull table and stations). */
export function buildWaistSection(it, MAT) {
  M ??= materials();
  const f = -1.95, wallX = (z, y, inset = 0.02) => it.hw(z, y) - inset;
  const outlets = it.group.userData.oxygen ?? (it.group.userData.oxygen = []);
  // a beam of w x h section from a to b, its h side along `n` (the way it stands off the wall)
  const beam = (a, b, w, h, n, mat) => {
    const A = new V(...a), B = new V(...b), t = B.clone().sub(A), len = t.length();
    if (len < 1e-4) return;
    t.divideScalar(len);
    const y = n.clone().addScaledVector(t, -n.dot(t)).normalize(), x = new V().crossVectors(y, t);
    const g = new THREE.BoxGeometry(w, h, len).applyMatrix4(new THREE.Matrix4().makeBasis(x, y, t));
    it.add(mat, g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2));
  };
  const inward = (s) => new V(-s, 0, 0);

  // ---- the gun windows: a riveted frame round each opening, the panel swung up inside, the deflector outside
  for (const s of [-1, 1]) {
    const ring = WIN.map(([z, y]) => [s * wallX(z, y, 0.012), y, z]), lip = WIN.map(([z, y]) => [s * wallX(z, y, 0.05), y, z]);
    for (let i = 0; i < WIN.length; i++) {
      const j = (i + 1) % WIN.length;
      beam(ring[i], ring[j], 0.03, 0.022, inward(s), MAT.metal); // the frame on the skin
      beam(lip[i], lip[j], 0.012, 0.03, inward(s), MAT.metal); // its turned-in lip
      const a = new V(...ring[i]), b = new V(...ring[j]), L = a.distanceTo(b);
      for (let t = 0.02; t < L; t += 0.045) it.add(MAT.metal, new THREE.SphereGeometry(0.0055, 5, 3).translate(...a.clone().lerp(b, t / L).add(new V(-s * 0.012, 0, 0)).toArray()));
    }
    // the window's panel: hinged along the top of the opening, swung in and up, latched under the roof
    const hy = -0.66, hx = s * wallX(1.85, hy, 0.03), th = 0.42, dir = new V(-s * Math.cos(th), Math.sin(th), 0), up = new V(s * Math.sin(th), Math.cos(th), 0);
    const P = (z, v, o = 0) => new V(hx, hy, z).addScaledVector(dir, v).addScaledVector(up, o).toArray();
    const z0 = 1.47, z1 = 2.22, w = 0.62;
    for (const [a, b] of [[P(z0, 0), P(z1, 0)], [P(z0, w), P(z1, w)], [P(z0, 0), P(z0, w)], [P(z1, 0), P(z1, w)]]) beam(a, b, 0.035, 0.022, up, M.od);
    beam(P(z0 + 0.06, w * 0.5), P(z1 - 0.06, w * 0.5), 0.03, 0.02, up, M.od); // its glazing bar
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([...P(z0 + 0.02, 0.02, 0.004), ...P(z1 - 0.02, 0.02, 0.004), ...P(z1 - 0.02, w - 0.02, 0.004), ...P(z0 + 0.02, w - 0.02, 0.004)], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]); quad.computeVertexNormals();
    it.group.add(new THREE.Mesh(quad, M.glass)); // its Plexiglas
    for (const z of [1.55, 2.14]) { // the hinges along the top of the opening
      it.cylinder(0.012, 0.07, hx, hy, z, 'z', MAT.dark, 8);
      beam([hx, hy, z], [s * wallX(z, hy + 0.05, 0.015), hy + 0.05, z], 0.05, 0.006, new V(0, 0, 1), MAT.dark);
    }
    const lz = 1.85, free = new V(...P(lz, w)), roof = it.ceilingAt(lz, free.x, f + 0.5);
    it.rod(free.toArray(), [free.x, roof - 0.01, lz], 0.005, MAT.cable, 4); // the latch strap up to the roof
    it.add(MAT.dark, new THREE.BoxGeometry(0.04, 0.015, 0.05).translate(free.x, roof - 0.012, lz)); // its clip
    it.add(MAT.dark, new THREE.BoxGeometry(0.03, 0.02, 0.06).translate(...P(lz, w, -0.012))); // the panel's latch
    // the wind deflector: a plate standing out from the skin at the window's forward edge, raked aft
    const dz = 1.4, x0 = s * (it.hw(dz, -1.0) + 0.01);
    for (const [ya, yb] of [[-1.3, -0.69]]) {
      const g = new THREE.BoxGeometry(0.005, yb - ya, 0.09).translate(0, 0, 0.045).rotateY(s * 0.95).translate(x0, (ya + yb) / 2, dz);
      it.add(M.deflector, g);
      it.add(M.deflector, new THREE.BoxGeometry(0.02, 0.02, 0.1).translate(x0 + s * 0.03, ya + 0.04, dz + 0.02));
    }
    // armour plate under the sill: a curved slab on the wall, bolted round its edge
    for (let y = -1.86; y < -1.38; y += 0.06) {
      const yc = y + 0.03, x = s * wallX(1.84, yc, 0.032);
      it.add(M.armour, new THREE.BoxGeometry(0.014, 0.062, 0.84).translate(x, yc, 1.84));
    }
    for (const z of [1.46, 1.65, 1.84, 2.03, 2.22]) for (const y of [-1.84, -1.42]) it.cylinder(0.008, 0.012, s * (wallX(z, y, 0.04) - 0.0), y, z, 'x', M.steel, 6);
    it.stencil(['ARMOR PLATE'], 0.16, [s * wallX(1.84, -1.62, 0.042), -1.62, 1.84], -s * Math.PI / 2, '#d8d0a8');
  }

  // ---- the ammunition boxes under the windows, on their racks: the tall boxes of 1943, the chute out of the top
  const ammoBox = (cx, cz, s, h = 0.53, w = 0.22, d = 0.36, chute = true) => {
    const y0 = f, y1 = f + h;
    it.box(cx - w / 2, cx + w / 2, y0 + 0.02, y1 - 0.02, cz - d / 2, cz + d / 2, MAT.ammo, true);
    it.add(MAT.ammo, new THREE.BoxGeometry(w + 0.01, 0.025, d + 0.01).translate(cx, y1 - 0.012, cz)); // the lid
    it.add(MAT.dark, new THREE.BoxGeometry(w + 0.012, 0.012, d + 0.012).translate(cx, y0 + 0.03, cz)); // the base rim
    for (const dz of [-d / 2 + 0.04, d / 2 - 0.04]) it.add(MAT.metal, new THREE.BoxGeometry(0.02, 0.05, 0.03).translate(cx - s * (w / 2 + 0.008), y1 - 0.05, cz + dz)); // its latches
    it.rod([cx - s * (w / 2 + 0.02), y1 - 0.14, cz - 0.07], [cx - s * (w / 2 + 0.02), y1 - 0.14, cz + 0.07], 0.007, MAT.dark, 6); // the carrying handle
    for (const dz of [-0.07, 0.07]) it.rod([cx - s * (w / 2 + 0.002), y1 - 0.14, cz + dz], [cx - s * (w / 2 + 0.02), y1 - 0.14, cz + dz], 0.006, MAT.dark, 4);
    // the rack: aluminium angles round its foot, a strap over it to the wall
    for (const dz of [-d / 2 - 0.012, d / 2 + 0.012]) it.add(M.alu, new THREE.BoxGeometry(w + 0.04, 0.05, 0.008).translate(cx, y0 + 0.025, cz + dz));
    for (const dx of [-w / 2 - 0.012, w / 2 + 0.012]) it.add(M.alu, new THREE.BoxGeometry(0.008, 0.05, d + 0.04).translate(cx + dx, y0 + 0.025, cz));
    it.rod([cx - s * w / 2, y1 - 0.2, cz], [cx - s * w / 2, y1 + 0.004, cz], 0.004, M.webbing, 4);
    it.add(M.webbing, new THREE.BoxGeometry(w + 0.004, 0.006, 0.05).translate(cx, y1 + 0.003, cz));
    it.rod([cx + s * w / 2, y1 + 0.003, cz], [s * wallX(cz, y1 + 0.1, 0.01), y1 + 0.1, cz], 0.006, M.webbing, 4);
    if (chute) { // the chute's fitting on the lid
      it.add(MAT.metal, new THREE.BoxGeometry(0.14, 0.04, 0.07).translate(cx, y1 + 0.015, cz));
      it.add(MAT.dark, new THREE.BoxGeometry(0.16, 0.012, 0.09).translate(cx, y1 + 0.002, cz));
    }
    it.stencil(['CAL. .50 AMMUNITION', 'M2 BALL  M1 TRACER', '400 RDS LINKED'], 0.17, [cx - s * (w / 2 + 0.002), f + h * 0.55, cz], -s * Math.PI / 2, '#d8d0a8');
  };
  for (const st of it.stations) {
    if (!st.feedBox) continue;
    const [x, y, z] = st.feedBox, s = Math.sign(x);
    st.feedBox[0] = s * Math.min(Math.abs(x), wallX(z, f + 0.01, 0.15)); // (in from the skin, which curves in at the floor: weapons.js's chute starts here too)
    ammoBox(st.feedBox[0], z, s, y - f);
  }
  for (const [s, z] of [[-1, 3.1], [1, 3.25]]) ammoBox(s * wallX(z, f + 0.01, 0.14), z, s, 0.4, 0.2, 0.32, false); // spare boxes, aft
  it.add(MAT.ammo, new THREE.BoxGeometry(0.2, 0.36, 0.32).rotateZ(1.2).translate(0.5, f + 0.1, 3.75)); // (one on its side, kicked over)

  // ---- the structure: Z-section stringers all the way round between the frames, in zinc chromate
  const inWin = (z, y) => z > 1.36 && z < 2.3 && y > -1.38 && y < -0.62;
  for (const s of [-1, 1]) for (let up = 0.1; up < 1.72; up += 0.125) {
    let prev = null;
    for (let z = -1.15; z <= 5.15; z += 0.25) {
      const y = f + up, w = wallX(z, y, 0.012);
      if (!Number.isFinite(w) || w < 0.5 || inWin(z, y) || (z > -0.2 && z < 0.12 && up < 1.05)) { prev = null; continue; } // (and not through the ball's heavy frame)
      const p = [s * w, y, z];
      if (prev) {
        beam(prev, p, 0.004, 0.03, inward(s), M.zinc); // its web
        beam([prev[0] - s * 0.028, prev[1], prev[2]], [p[0] - s * 0.028, p[1], p[2]], 0.004, 0.022, new V(0, 1, 0), M.zinc); // its flange
      }
      prev = p;
    }
  }
  for (const x of [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42]) { // and along the roof
    let prev = null;
    for (let z = -1.15; z <= 4.6; z += 0.25) {
      const y = it.ceilingAt(z, x, f + 0.5) - 0.012, p = [x, y, z];
      if (!Number.isFinite(y) || y > 1) { prev = null; continue; }
      if (prev && Math.abs(prev[1] - y) < 0.2) {
        beam(prev, p, 0.004, 0.03, new V(0, -1, 0), M.zinc);
        beam([prev[0], prev[1] - 0.028, prev[2]], [p[0], p[1] - 0.028, p[2]], 0.022, 0.004, new V(0, -1, 0), M.zinc);
      }
      prev = p;
    }
  }

  // ---- the walkway: aluminium treads across its planks, angle along its edges
  for (let z = -1.1; z < 5.05; z += 0.3) {
    if (z > -0.8 && z < 0.55) continue; // (round the ball)
    it.add(M.alu, new THREE.BoxGeometry(0.58, 0.007, 0.025).translate(0, f + 0.0035, z));
    for (const x of [-0.27, 0.27]) it.add(MAT.metal, new THREE.CylinderGeometry(0.005, 0.005, 0.009, 6).translate(x, f + 0.005, z));
  }
  for (const x of [-0.31, 0.31]) {
    it.add(M.alu, new THREE.BoxGeometry(0.03, 0.012, 3.7).translate(x, f + 0.006, 2.7 + 0.15));
    it.add(M.alu, new THREE.BoxGeometry(0.03, 0.012, 0.4).translate(x, f + 0.006, -1.0));
  }

  // ---- oxygen and interphone at each gunner: the A-12 regulator, its hose outlet; the BC-366 jack box, its cord
  for (const st of it.stations) {
    if (!st.feedBox) continue;
    const s = Math.sign(st.pivot[0]), z = st.pivot[2] + (s < 0 ? 0.6 : -0.46), y = -0.98, x = s * wallX(z, y, 0.045);
    it.add(M.od, new THREE.BoxGeometry(0.075, 0.17, 0.115).translate(x, y, z));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.158), M.regulator);
    face.position.set(x - s * 0.0385, y, z); face.rotation.y = -s * Math.PI / 2;
    it.group.add(face);
    it.cylinder(0.012, 0.02, x - s * 0.045, y - 0.045, z + 0.03, 'x', M.red, 10); // the emergency knob
    it.add(MAT.metal, new THREE.BoxGeometry(0.02, 0.03, 0.03).translate(x, y + 0.1, z)); // the supply line's union on top
    it.rod([x, y + 0.11, z], [s * wallX(z, y + 0.5, 0.03), y + 0.5, z + 0.05], 0.007, MAT.metal, 6); // up the wall to the system
    it.rod([x - s * 0.02, y - 0.085, z], [x - s * 0.04, y - 0.13, z], 0.013, MAT.hose, 8); // the outlet
    it.add(MAT.metal, new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10).translate(x - s * 0.04, y - 0.14, z)); // (its bayonet coupling)
    outlets.push(new V(x - s * 0.04, y - 0.15, z));
    const jz = z + (s < 0 ? 0.17 : -0.17), jy = -1.22, jx = s * wallX(jz, jy, 0.032);
    it.add(M.black, new THREE.BoxGeometry(0.05, 0.13, 0.1).translate(jx, jy, jz));
    const jf = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.125), M.jackbox);
    jf.position.set(jx - s * 0.0255, jy, jz); jf.rotation.y = -s * Math.PI / 2;
    it.group.add(jf);
    it.cylinder(0.014, 0.02, jx - s * 0.035, jy + 0.025, jz, 'x', M.black, 12); // the volume knob
    for (const dz of [-0.022, 0.022]) it.cylinder(0.006, 0.012, jx - s * 0.03, jy - 0.042, jz + dz, 'x', MAT.metal, 8); // the jacks
    // the headset's cord: plugged in, hanging in a loop
    const cord = new THREE.CatmullRomCurve3([new V(jx - s * 0.04, jy - 0.042, jz - 0.022), new V(jx - s * 0.1, jy - 0.3, jz - 0.05), new V(jx - s * 0.2, jy - 0.35, jz - 0.1), new V(jx - s * 0.28, jy - 0.15, jz - 0.2)]);
    it.add(M.black, new THREE.TubeGeometry(cord, 16, 0.004, 4, false));
    it.stencil(['OXYGEN'], 0.08, [x - s * 0.04, y + 0.115, z], -s * Math.PI / 2, '#d8c86a');
  }

  // ---- the oxygen bottles by the ball, standing in their brackets, strapped to the wall
  for (const s of [-1, 1]) for (const z of [0.8, 1.06]) {
    const y = -1.2, x = s * Math.min(wallX(z, y, 0.13), wallX(z, y - 0.32, 0.12), wallX(z, y + 0.32, 0.12));
    it.add(M.yellow, new THREE.CapsuleGeometry(0.1, 0.4, 6, 18).translate(x, y, z));
    it.cylinder(0.022, 0.05, x, y + 0.32, z, 'y', MAT.metal, 10); // its valve
    it.cylinder(0.03, 0.012, x, y + 0.355, z, 'y', MAT.dark, 10); // (the handwheel)
    it.rod([x, y + 0.34, z], [s * wallX(z, y + 0.6, 0.03), y + 0.6, z], 0.006, MAT.metal, 5); // its line up the wall
    for (const dy of [-0.14, 0.12]) {
      it.add(M.webbing, new THREE.TorusGeometry(0.103, 0.008, 4, 22).rotateX(Math.PI / 2).translate(x, y + dy, z)); // a strap round it
      it.add(MAT.dark, new THREE.BoxGeometry(0.1, 0.03, 0.02).translate(x + s * 0.12, y + dy, z)); // to its bracket on the wall
    }
    it.add(MAT.dark, new THREE.CylinderGeometry(0.11, 0.11, 0.02, 18).translate(x, y - 0.32, z)); // the cup it stands in
    it.rod([x, y - 0.33, z], [s * wallX(z, y - 0.33, 0.01), y - 0.33, z], 0.012, MAT.metal, 6); // (its cup's arm to the wall)
  }
  it.stencil(['OXYGEN'], 0.14, [-wallX(0.93, -1.2, 0.235), -1.2, 0.93], Math.PI / 2, '#1a1a1a');

  // ---- the ball turret: the azimuth drum on its top, the hand crank, and the support column up to its beam
  { const z = -0.13, top = -1.58, roof = it.ceilingAt(z, 0, f + 0.5);
    it.cylinder(0.17, 0.12, 0, top + 0.06, z, 'y', M.steel, 24); // the drum: the azimuth ring gear's housing
    it.add(MAT.dark, new THREE.TorusGeometry(0.17, 0.012, 6, 28).rotateX(Math.PI / 2).translate(0, top + 0.12, z));
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; it.add(MAT.metal, new THREE.SphereGeometry(0.008, 5, 3).translate(Math.cos(a) * 0.155, top + 0.122, z + Math.sin(a) * 0.155)); }
    it.cylinder(0.045, 0.1, 0.2, top + 0.05, z, 'x', M.steel, 12); // the hand crank's gearbox
    it.rod([0.25, top + 0.05, z], [0.25, top + 0.05, z + 0.13], 0.01, MAT.metal, 6); // its arm
    it.cylinder(0.014, 0.09, 0.25, top + 0.095, z + 0.13, 'y', MAT.dark, 8); // and handle
    it.cylinder(0.042, roof - (top + 0.12), 0, (roof + top + 0.12) / 2, z, 'y', M.zinc, 14); // the column
    for (const y of [top + 0.16, roof - 0.06]) it.cylinder(0.06, 0.04, 0, y, z, 'y', MAT.metal, 14); // its collars
    const by = roof - 0.04, bw = wallX(z, by, 0.02);
    if (Number.isFinite(bw)) {
      beam([-bw, by, z], [bw, by, z], 0.07, 0.05, new V(0, 1, 0), M.zinc); // the beam across under the roof
      for (const s of [-1, 1]) beam([s * 0.05, by - 0.02, z], [s * 0.3, by - 0.02, z], 0.008, 0.09, new V(0, 0, 1), M.zinc); // (gussets either side of the column)
    }
    it.stencil(['BALL TURRET', 'HAND CRANK'], 0.12, [0.25, top + 0.15, z + 0.01], 0, '#d8d0a8');
  }

  // ---- the radio room's door, swung open flat against the aft face of its bulkhead (left of the doorway)
  { const bz = -1.25 + 0.04, hx = -0.33, y0 = -1.78, y1 = -0.3, wd = Math.min(0.56, wallX(bz, y1, 0.04) + hx);
    const x1 = hx - wd;
    it.add(MAT.green, new THREE.BoxGeometry(wd, y1 - y0, 0.022).translate((hx + x1) / 2, (y0 + y1) / 2, bz + 0.012));
    for (const [a, b] of [[[hx, y0, bz + 0.03], [x1, y0, bz + 0.03]], [[hx, y1, bz + 0.03], [x1, y1, bz + 0.03]], [[hx, y0, bz + 0.03], [hx, y1, bz + 0.03]], [[x1, y0, bz + 0.03], [x1, y1, bz + 0.03]], [[hx, (y0 + y1) / 2, bz + 0.03], [x1, (y0 + y1) / 2, bz + 0.03]]]) beam(a, b, 0.035, 0.012, new V(0, 0, 1), M.zinc); // its frame
    for (const y of [y0 + 0.2, y1 - 0.2]) it.cylinder(0.014, 0.1, hx + 0.005, y, bz + 0.01, 'y', MAT.dark, 8); // the hinges
    it.add(MAT.metal, new THREE.BoxGeometry(0.03, 0.12, 0.03).translate(x1 + 0.05, (y0 + y1) / 2 + 0.1, bz + 0.05)); // the latch handle
    it.stencil(['RADIO', 'COMPARTMENT'], 0.2, [(hx + x1) / 2, y1 - 0.35, bz + 0.041], 0, '#d8d0a8');
  }
}
