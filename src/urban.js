// A town or city as it looks from the air, painted onto a canvas. It grew district by district, each with its
// streets at its own angle (often the old field strips': the new streets ran along them), the streets long
// and gently bent, the cross streets staggered (T-junctions, not a chessboard), and the houses along the
// streets: closed rows of four- and five-storey houses round dark courtyards in the middle, terraces and
// semis with front and back gardens further out, villas and cottages in big gardens at the edge, factory
// halls and sheds by the railways. Out at the fringe the allotment colonies, a cemetery, a sports field;
// then the fields. The edge is ragged, the town running out in fingers along its roads.
// Every roof is drawn with its soft shadow (that's what gives a town depth from five miles up), most of
// them weathered red-brown tile, some slate, the halls grey. The buildings near the middle come back as
// footprints, for the 3D town (city.js) to stand on the same streets.

/** A seeded random number source, 0..1. */
export function rng(seed) { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/** Smooth value noise, about 0..1, varying over ~1 unit. */
export function noise(r) {
  const N = 64, g = Float32Array.from({ length: N * N }, () => r());
  const at = (a, b) => g[(((b % N) + N) % N) * N + (((a % N) + N) % N)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
}

/** Distance from (x, z) to a polyline [[x, z], ...]. */
export function distToLine(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const ROOF_TILE = ['#94583f', '#8a523c', '#9c6346', '#7f4e3d', '#8d5b47', '#a0684d', '#86503e'], ROOF_SLATE = ['#55565a', '#5d5a57', '#4f5054'], ROOF_FLAT = ['#77736b', '#6c6962'];
const HALL = ['#71685c', '#665e54', '#7a7062', '#625a50'];

/**
 * Paint a town. o: { size (m across), px (canvas px), seed, density(x, z) -> 0..1 (how built-up; under
 * `threshold` it's fields), threshold, skip(x, z) -> true where something else is drawn (the river, the
 * works...), industrial(x, z) -> true by the railways, roads: main roads [[x, z]...] (drawn wide, tree-lined),
 * keep(x, z) -> true for buildings to return as footprints, cell: the districts' street spacing (m) }.
 * Returns { canvas, buildings: [{ x, z, w, d, rot, h, kind, col }] }.
 */
export function paintUrban(o) {
  const T0 = performance.now(), tm = {}, lap = (k) => { tm[k] = Math.round(performance.now() - T0); };
  const r = rng(o.seed), n = noise(rng(o.seed + 7)), n2 = noise(rng(o.seed + 13)), T = o.threshold ?? 0.35, size = o.size, px = o.px;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = px; return c; };
  const c = mk(), g = c.getContext('2d'), s = px / size, X = (m) => px / 2 + m * s;
  const pick = (a) => a[Math.floor(r() * a.length)], rand = (a, b) => a + r() * (b - a);
  // (the edge ragged: the density pushed about by two scales of noise, the ground under it warped)
  // (the town's own density worked out on a coarse grid first, 44 m apart, and read between)
  const B = 160, base = new Float32Array((B + 1) * (B + 1));
  for (let j = 0; j <= B; j++) for (let i = 0; i <= B; i++) base[j * (B + 1) + i] = o.density((i / B - 0.5) * size, (j / B - 0.5) * size);
  const baseAt = (x, z) => {
    const u = Math.min(B - 1e-6, Math.max(0, (x / size + 0.5) * B)), v = Math.min(B - 1e-6, Math.max(0, (z / size + 0.5) * B)), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * (B + 1) + i;
    return (base[k] * (1 - fu) + base[k + 1] * fu) * (1 - fv) + (base[k + B + 1] * (1 - fu) + base[k + B + 2] * fu) * fv;
  };
  const dens = (x, z) => {
    const wx = x + (n2(x / 900 + 3, z / 900 + 3) - 0.5) * 900, wz = z + (n2(x / 900 + 40, z / 900 + 40) - 0.5) * 900;
    return baseAt(wx, wz) * (0.6 + 0.55 * n(x / 600 + 50, z / 600 + 50) + 0.35 * (n(x / 160 + 9, z / 160 + 9) - 0.5));
  };
  const roof = () => (r() < 0.78 ? pick(ROOF_TILE) : r() < 0.85 ? pick(ROOF_SLATE) : pick(ROOF_FLAT));
  const buildings = [];
  // where things are already: streets and houses (4 m cells), so nothing is built on a street or another house
  const OC = 2, ON = Math.ceil(size / OC), occ = new Uint8Array(ON * ON);
  const oi = (x, z) => { const i = Math.floor((x + size / 2) / OC), j = Math.floor((z + size / 2) / OC); return i < 0 || j < 0 || i >= ON || j >= ON ? -1 : j * ON + i; };
  const markLine = (pts, w) => { for (let k = 1; k < pts.length; k++) { const [ax, az] = pts[k - 1], [bx, bz] = pts[k], L = Math.hypot(bx - ax, bz - az); const nx = -(bz - az) / L, nz = (bx - ax) / L; for (let t = 0; t <= L; t += 1.5) { const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L; for (let o = -w / 2; o <= w / 2; o += 1.5) { const dx = nx * o, dz = nz * o; const q = oi(x + dx, z + dz); if (q >= 0) occ[q] = 1; } } } };
  const free = (x, z, w, d, rot) => { // (the rectangle's corners, edges and middle all clear)
    const ca = Math.cos(rot), sa = Math.sin(rot);
    for (const [u, v] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, -0.45], [0, 0.45], [-0.45, 0], [0.45, 0]]) {
      const q = oi(x + ca * u * w - sa * v * d, z + sa * u * w + ca * v * d);
      if (q < 0 || occ[q]) return false;
    }
    return true;
  };
  const mark = (x, z, w, d, rot) => { const ca = Math.cos(rot), sa = Math.sin(rot); for (let u = -w / 2 + 0.6; u <= w / 2 - 0.6; u += 1.5) for (let v = -d / 2 + 0.6; v <= d / 2 - 0.6; v += 1.5) { const q = oi(x + ca * u - sa * v, z + sa * u + ca * v); if (q >= 0) occ[q] = 1; } };

  // ---- the ground under the town: courtyards and yards in the middle, gardens further out (mottled), and
  // the mask of where the town is at all (soft-edged, a little ragged)
  const M = 320, gc = document.createElement('canvas'); gc.width = gc.height = M;
  const gg = gc.getContext('2d'), img = gg.createImageData(M, M);
  const mask = document.createElement('canvas'); mask.width = mask.height = M;
  const mgx = mask.getContext('2d'), mimg = mgx.createImageData(M, M);
  const D0 = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = ((i + 0.5) / M - 0.5) * size, z = ((j + 0.5) / M - 0.5) * size, d = dens(x, z), k = j * M + i;
    D0[k] = d;
    const t = Math.max(0, Math.min(1, (d - T) / 0.4)), m = n(x / 40 + 3, z / 40 + 7), skip = d > T - 0.03 && o.skip?.(x, z);
    // gardens (green-brown) → yards and courtyards (grey-brown) as it thickens
    const u = Math.min(1, Math.max(0, (t - 0.3) / 0.5)), q = k * 4, id = img.data, md = mimg.data;
    id[q] = (80 + m * 16) * (1 - u) + (96 + m * 14) * u; id[q + 1] = (80 + m * 12) * (1 - u) + (88 + m * 12) * u; id[q + 2] = (56 + m * 8) * (1 - u) + (76 + m * 10) * u; id[q + 3] = 255;
    md[q] = md[q + 1] = md[q + 2] = 255; md[q + 3] = Math.max(0, Math.min(1, (d - (T - 0.02)) / 0.04)) * (skip ? 0 : 255);
  }
  gg.putImageData(img, 0, 0); mgx.putImageData(mimg, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(gc, 0, 0, px, px);
  lap('ground');

  // ---- the districts: each its own angle and street spacing; long streets along it, staggered cross streets
  const DN = Math.max(3, Math.round(size / 650));
  const seeds = [];
  for (let i = 0; i < DN * DN; i++) {
    const x = (((i % DN) + 0.5 + rand(-0.45, 0.45)) / DN - 0.5) * size, z = ((Math.floor(i / DN) + 0.5 + rand(-0.45, 0.45)) / DN - 0.5) * size;
    seeds.push({ x, z, a: rand(-0.6, 0.6) + (r() < 0.5 ? 0 : Math.PI / 2) });
  }
  const NS = new Uint16Array(M * M); // (each ground texel's district, looked up rather than searched for: only the seeds near it tried)
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = ((i + 0.5) / M - 0.5) * size, z = ((j + 0.5) / M - 0.5) * size, ci = Math.floor(((i + 0.5) / M) * DN), cj = Math.floor(((j + 0.5) / M) * DN);
    let b = 0, bd = Infinity;
    for (let b2 = Math.max(0, cj - 2); b2 <= Math.min(DN - 1, cj + 2); b2++) for (let a2 = Math.max(0, ci - 2); a2 <= Math.min(DN - 1, ci + 2); a2++) {
      const k = b2 * DN + a2, q = seeds[k], dd = (q.x - x) ** 2 + (q.z - z) ** 2; if (dd < bd) { bd = dd; b = k; }
    }
    NS[j * M + i] = b;
  }
  const gi = (x, z) => Math.min(M - 1, Math.max(0, Math.floor((x / size + 0.5) * M))) + Math.min(M - 1, Math.max(0, Math.floor((z / size + 0.5) * M))) * M;
  const nearest = (x, z) => NS[gi(x, z)];
  const densG = (x, z) => D0[gi(x, z)];
  const streets = [];
  const ok = (x, z, k) => Math.abs(x) < size / 2 - 10 && Math.abs(z) < size / 2 - 10 && nearest(x, z) === k && densG(x, z) > T - 0.03 && !o.skip?.(x, z);
  seeds.forEach((q, k) => {
    const ca = Math.cos(q.a), sa = Math.sin(q.a), dq = dens(q.x, q.z);
    const sp = (o.cell ?? 80) * (dq > 0.7 ? 1 : dq > 0.5 ? 0.9 : 0.8) * rand(0.85, 1.15);
    const reach = (size / DN) * 1.15, at = (u, v) => [q.x + u * ca - v * sa, q.z + u * sa + v * ca];
    const ph = rand(0, 6.28), amp = rand(4, 16), lam = rand(250, 600);
    const off = (u, kk) => amp * Math.sin(u / lam + ph + kk * 0.7) + 0.4 * amp * Math.sin(u / (lam * 0.37) + kk);
    const lines = [];
    for (let kk = -Math.ceil(reach / sp); kk <= Math.ceil(reach / sp); kk++) {
      const v0 = kk * sp + rand(-sp * 0.12, sp * 0.12);
      let run = [];
      const runs = [];
      for (let u = -reach; u <= reach; u += 10) {
        const [x, z] = at(u, v0 + off(u, kk));
        if (ok(x, z, k)) run.push([x, z]);
        else { if (run.length > 4) runs.push(run); run = []; }
      }
      if (run.length > 4) runs.push(run);
      lines[kk] = { v0, kk };
      for (const rn of runs) { // (out where it thins, the streets are short: a few built up, the rest not yet)
        const dm = densG(...rn[Math.floor(rn.length / 2)]);
        if (dm > 0.5) { streets.push({ pts: rn, w: dm > 0.68 ? 13 : 9 }); continue; }
        for (let a = 0; a < rn.length;) { const L = 12 + Math.floor(r() * 30), piece = rn.slice(a, a + L); if (piece.length > 4 && r() < 0.62) streets.push({ pts: piece, w: 8 }); a += L + (r() < 0.5 ? 0 : 4 + Math.floor(r() * 10)); }
      }
    }
    // the cross streets: between two long streets now and then, never two in line across a third
    for (let kk = -Math.ceil(reach / sp); kk < Math.ceil(reach / sp); kk++) {
      const a = lines[kk], b = lines[kk + 1];
      if (!a || !b) continue;
      for (let u = -reach + rand(0, 200); u < reach; u += rand(110, 260)) {
        const p0 = at(u, a.v0 + off(u, kk)), p1 = at(u + rand(-12, 12), b.v0 + off(u, kk + 1));
        const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        if (ok(...p0, k) && ok(...p1, k) && ok(...mid, k)) streets.push({ pts: [p0, mid, p1], w: 8 });
      }
    }
  });
  lap('streets');
  for (const st of streets) markLine(st.pts, st.w * 0.7);
  for (const road of o.roads ?? []) markLine(road, 14);

  // ---- the shadows go on their own layer, laid on blurred in one go
  const sh = mk(), sg = sh.getContext('2d'); sg.fillStyle = '#000';
  const roofs = []; // [x, z, w, d, rot, col, kind] painted after the shadows
  const trees = [];
  const house = (x, z, w, d, rot, h, kind, col = roof()) => {
    if (!free(x, z, w, d, rot)) return false;
    mark(x, z, w, d, rot);
    roofs.push([x, z, w, d, rot, col, kind]);
    sg.save(); sg.translate(X(x + h * 0.22), X(z + h * 0.34)); sg.rotate(rot); sg.fillRect((-w / 2) * s, (-d / 2) * s, w * s, d * s); sg.restore();
    if (o.keep?.(x, z)) buildings.push({ x, z, w, d, rot, h, kind, col });
    return true;
  };

  // ---- the buildings along every street, by how thick the town is there
  for (const st of streets) {
    const pts = st.pts;
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, rot = Math.atan2(tz, tx);
      for (let a = 0; a < L;) {
        const x = ax + tx * a, z = az + tz * a, d = densG(x, z);
        const ind = o.industrial?.(x, z) && r() < 0.6;
        let step;
        if (ind) { // halls and sheds, their yards
          const hw = rand(25, 90), hd = rand(18, 50);
          for (const side of [-1, 1]) { const nx = -tz * side, nz = tx * side, off = st.w / 2 + hd / 2 + rand(4, 12); house(x + tx * hw / 2 + nx * off, z + tz * hw / 2 + nz * off, hw, hd, rot, rand(8, 15), 'hall', pick(HALL)); }
          step = hw + rand(6, 20);
        } else if (d > 0.68) { // closed rows, wings into the courtyards behind
          const w = rand(9, 16), dp = rand(11, 15), h = rand(15, 21), col = roof();
          for (const side of [-1, 1]) {
            const nx = -tz * side, nz = tx * side, off = st.w / 2 + dp / 2 + 0.5;
            if (r() < 0.95 && house(x + tx * w / 2 + nx * off, z + tz * w / 2 + nz * off, w - 0.3, dp, rot, h + rand(-2, 2), 'block', r() < 0.5 ? col : roof()) && r() < 0.45) {
              const wl = rand(8, 18), bo = off + dp / 2 + wl / 2;
              house(x + tx * w / 2 + nx * bo, z + tz * w / 2 + nz * bo, rand(6, 8), wl, rot, rand(9, 14), 'block', roof());
            }
          }
          step = w;
        } else if (d > 0.48) { // terraces and semis behind front gardens, sheds and trees in the back gardens
          const w = rand(9, 13), dp = rand(9, 11);
          for (const side of [-1, 1]) {
            const nx = -tz * side, nz = tx * side, off = st.w / 2 + rand(3, 6) + dp / 2;
            if (r() < 0.9) house(x + tx * w / 2 + nx * off, z + tz * w / 2 + nz * off, w - 0.4, dp, rot, rand(9, 12), 'house');
            if (r() < 0.3) house(x + tx * w / 2 + nx * (off + dp / 2 + rand(8, 14)), z + tz * w / 2 + nz * (off + dp / 2 + rand(8, 14)), rand(4, 6), rand(3, 5), rot, 3, 'shed');
            if (r() < 0.35) trees.push([x + nx * (off + rand(12, 25)), z + nz * (off + rand(12, 25)), rand(2.5, 4)]);
          }
          step = w + (r() < 0.3 ? rand(3, 8) : 0.3);
        } else { // villas and cottages in their gardens
          const w = rand(9, 13), dp = rand(8, 11);
          for (const side of [-1, 1]) {
            const nx = -tz * side, nz = tx * side, off = st.w / 2 + rand(6, 11) + dp / 2;
            if (r() < 0.8) house(x + tx * w / 2 + nx * off, z + tz * w / 2 + nz * off, w, dp, rot + (r() < 0.25 ? Math.PI / 2 : 0), rand(7, 10), 'house');
            for (let t = 0; t < 2; t++) if (r() < 0.6) trees.push([x + tx * rand(-8, 8) + nx * (off + rand(8, 30)), z + tz * rand(-8, 8) + nz * (off + rand(8, 30)), rand(2.5, 4.5)]);
          }
          step = w + rand(8, 18);
        }
        a += step;
      }
    }
  }
  lap('houses');
  // ---- out at the fringe: allotment colonies (little strip gardens, a hut on each), a cemetery or two, a sports field
  const fringe = [];
  for (let k = 0; k < 900 && fringe.length < Math.round(size / 220); k++) {
    const x = rand(-size * 0.45, size * 0.45), z = rand(-size * 0.45, size * 0.45), d = densG(x, z);
    if (d > T - 0.02 && d < T + 0.14 && !o.skip?.(x, z) && free(x, z, 30, 30, 0)) fringe.push([x, z]);
  }
  const ag = []; // allotment plots: [x, z, w, d, rot, colour]
  fringe.forEach(([x, z], i) => {
    const a = seeds[nearest(x, z)].a, ca = Math.cos(a), sa = Math.sin(a);
    if (i % 7 === 3) { // a cemetery: grass, paths, rows of trees, the chapel
      const W = rand(90, 160), Dd = rand(70, 120);
      if (!free(x, z, W, Dd, a)) return;
      mark(x, z, W, Dd, a);
      ag.push([x, z, W, Dd, a, '#56603e']);
      for (let u = -W / 2 + 6; u < W / 2; u += 12) for (const v of [-Dd / 2 + 4, Dd / 2 - 4, 0]) trees.push([x + ca * u - sa * v, z + sa * u + ca * v, rand(2.5, 3.5)]);
      roofs.push([x, z, 14, 8, a, pick(ROOF_SLATE), 'house']);
      return;
    }
    if (i % 7 === 5) { // a sports field
      if (!free(x, z, 110, 75, a)) return;
      mark(x, z, 110, 75, a); ag.push([x, z, 110, 75, a, '#6c7646']); ag.push([x, z, 96, 62, a, '#728048']);
      return;
    }
    const rows = 2 + Math.floor(r() * 4), cols = 4 + Math.floor(r() * 8);
    for (let i2 = 0; i2 < cols; i2++) for (let j = 0; j < rows; j++) {
      const u = (i2 - cols / 2) * 11, v = (j - rows / 2) * 24, px2 = x + ca * u - sa * v, pz = z + sa * u + ca * v;
      if (!free(px2, pz, 10, 22, a)) continue;
      mark(px2, pz, 10, 22, a);
      ag.push([px2, pz, 9.6, 21.5, a, pick(['#5e6a3c', '#6a6440', '#5a5f3a', '#73694a', '#56663a'])]);
      if (r() < 0.7) roofs.push([px2 + ca * 2, pz + sa * 2 + 8, 3, 2.5, a, pick(['#6a5a4a', '#5a5550', '#7a6650']), 'shed']);
      if (r() < 0.5) trees.push([px2 + rand(-3, 3), pz + rand(-8, 8), rand(1.8, 2.8)]);
    }
  });
  for (const [x, z, w, d, rot, col] of ag) { g.save(); g.translate(X(x), X(z)); g.rotate(rot); g.fillStyle = col; g.fillRect((-w / 2) * s, (-d / 2) * s, w * s, d * s); g.restore(); }

  // ---- the streets: grey cobbles and tar in the middle, paler gravel out at the edge
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const st of streets) {
    const dm = densG(...st.pts[Math.floor(st.pts.length / 2)]);
    g.strokeStyle = dm > 0.6 ? '#7a7062' : dm > 0.45 ? '#7d7364' : '#74695a';
    g.lineWidth = Math.max(1, st.w * (dm > 0.45 ? 0.75 : 0.55) * s); g.beginPath(); st.pts.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](X(x), X(z))); g.stroke();
  }
  // the main roads: wide, metalled, an avenue of trees each side where they run through the town
  for (const road of o.roads ?? []) {
    g.strokeStyle = '#857a68'; g.lineWidth = Math.max(2, 16 * s);
    g.beginPath(); road.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](X(x), X(z))); g.stroke();
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1], [bx, bz] = road[i], L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let t = 0; t < L; t += 12) {
        const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
        if (densG(x, z) < T || o.skip?.(x, z)) continue;
        trees.push([x + nx * 11, z + nz * 11, 3.2]); trees.push([x - nx * 11, z - nz * 11, 3.2]);
      }
    }
  }
  lap('lines');
  // ---- the shadows (houses and trees), then the trees and the roofs over them
  for (const [x, z, rr] of trees) { sg.beginPath(); sg.arc(X(x + rr * 0.6), X(z + rr), rr * s, 0, 7); sg.fill(); }
  g.save(); g.globalAlpha = 0.45; g.filter = `blur(${Math.max(0.5, 1.1 * s).toFixed(1)}px)`; g.drawImage(sh, 0, 0); g.restore();
  for (const [x, z, rr] of trees) { g.fillStyle = pick(['#46512b', '#4e562c', '#5d5a2c', '#6a5c2e', '#3f4a28']); g.beginPath(); g.arc(X(x), X(z), Math.max(0.7, rr * s), 0, 7); g.fill(); }
  for (const [x, z, w, d, rot, col, kind] of roofs) {
    g.save(); g.translate(X(x), X(z)); g.rotate(rot);
    const W = w * s, Dd = d * s;
    g.fillStyle = col; g.fillRect(-W / 2, -Dd / 2, W, Dd);
    if (kind === 'hall') { if (W > 6) { g.fillStyle = 'rgba(0,0,0,0.18)'; for (let u = -W / 2; u < W / 2; u += 8 * s) g.fillRect(u, -Dd / 2, 3 * s, Dd); } } // (sawtooth roof lights)
    else if (kind !== 'shed' && W > 2) { // the far slope in shade (the ridge along the long side)
      g.fillStyle = 'rgba(20,12,8,0.24)';
      if (w >= d) g.fillRect(-W / 2, 0, W, Dd / 2); else g.fillRect(0, -Dd / 2, W / 2, Dd);
    }
    g.restore();
  }
  lap('roofs');
  // ---- the town ends where its last gardens do: the mask, blurred a little
  const fm = mk(), fg = fm.getContext('2d');
  fg.imageSmoothingEnabled = true; fg.filter = `blur(${(6 * s).toFixed(1)}px)`; fg.drawImage(mask, 0, 0, px, px);
  for (const st of streets) { fg.strokeStyle = '#fff'; fg.lineWidth = st.w * 2.2 * s; fg.beginPath(); st.pts.forEach(([x, z], i) => fg[i ? 'lineTo' : 'moveTo'](X(x), X(z))); fg.stroke(); }
  fg.filter = 'none';
  for (const [x, z, w, d, rot] of ag) { fg.save(); fg.translate(X(x), X(z)); fg.rotate(rot); fg.fillStyle = '#fff'; fg.fillRect((-w / 2 - 2) * s, (-d / 2 - 2) * s, (w + 4) * s, (d + 4) * s); fg.restore(); }
  for (const [x, z, w, d, rot] of roofs) { fg.save(); fg.translate(X(x), X(z)); fg.rotate(rot); fg.fillStyle = '#fff'; fg.fillRect((-w / 2 - 3) * s, (-d / 2 - 3) * s, (w + 6) * s, (d + 6) * s); fg.restore(); }
  g.globalCompositeOperation = 'destination-in'; g.drawImage(fm, 0, 0); g.globalCompositeOperation = 'source-over';
  lap('mask');
  return { canvas: c, buildings, tm };
}
