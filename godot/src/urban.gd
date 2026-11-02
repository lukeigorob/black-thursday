extends RefCounted
# A town or city as it looks from the air, painted onto a canvas. It grew district by district, each with its
# streets at its own angle (often the old field strips': the new streets ran along them), the streets long
# and gently bent, the cross streets staggered (T-junctions, not a chessboard), and the houses along the
# streets: closed rows of four- and five-storey houses round dark courtyards in the middle, terraces and
# semis with front and back gardens further out, villas and cottages in big gardens at the edge, factory
# halls and sheds by the railways. Out at the fringe the allotment colonies, a cemetery, a sports field;
# then the fields. The edge is ragged, the town running out in fingers along its roads.
# Every roof is drawn with its soft shadow (that's what gives a town depth from five miles up), most of
# them weathered red-brown tile, some slate, the halls grey. The buildings near the middle come back as
# footprints, for the 3D town (city.gd) to stand on the same streets.

const Canvas2D := preload("res://src/core/canvas2d.gd")

## A seeded random number source, 0..1: `var r := Urban.rng(seed)`, then `r.next()` (the JS's closure `r()`).
class Rng:
	var s: int
	func _init(seed: int) -> void:
		s = seed % 2147483647
		if s == 0:
			s = 1
	func next() -> float:
		s = (s * 16807) % 2147483647
		return float(s) / 2147483647.0

static func rng(seed: int) -> Rng:
	return Rng.new(seed)

## Smooth value noise, about 0..1, varying over ~1 unit: `noise(r).at(x, y)`.
class Noise:
	const N := 64
	var g := PackedFloat32Array()
	func _init(r: Rng) -> void:
		g.resize(N * N)
		for i in N * N:
			g[i] = r.next()
	func at(x: float, y: float) -> float:
		var x0 := floori(x)
		var y0 := floori(y)
		var fx := x - x0
		var fy := y - y0
		var sx := fx * fx * (3 - 2 * fx)
		var sy := fy * fy * (3 - 2 * fy)
		var i0 := posmod(x0, N)
		var i1 := posmod(x0 + 1, N)
		var j0 := posmod(y0, N) * N
		var j1 := posmod(y0 + 1, N) * N
		return (g[j0 + i0] * (1 - sx) + g[j0 + i1] * sx) * (1 - sy) + (g[j1 + i0] * (1 - sx) + g[j1 + i1] * sx) * sy

static func noise(r: Rng) -> Noise:
	return Noise.new(r)

## Distance from (x, z) to a polyline [[x, z], ...].
static func dist_to_line(x: float, z: float, pts: Array) -> float:
	var best := INF
	for i in range(1, pts.size()):
		var ax: float = pts[i - 1][0]
		var az: float = pts[i - 1][1]
		var dx: float = pts[i][0] - ax
		var dz: float = pts[i][1] - az
		var L := dx * dx + dz * dz
		var t := clampf(((x - ax) * dx + (z - az) * dz) / L, 0, 1) if L else 0.0
		best = minf(best, Vector2(x - ax - dx * t, z - az - dz * t).length())
	return best

const ROOF_TILE := ["#94583f", "#8a523c", "#9c6346", "#7f4e3d", "#8d5b47", "#a0684d", "#86503e"]
const ROOF_SLATE := ["#55565a", "#5d5a57", "#4f5054"]
const ROOF_FLAT := ["#77736b", "#6c6962"]
const HALL := ["#71685c", "#665e54", "#7a7062", "#625a50"]

## Paint a town. o: { size (m across), px (canvas px), seed, density(x, z) -> 0..1 (how built-up; under
## `threshold` it's fields), threshold, skip(x, z) -> true where something else is drawn (the river, the
## works...), industrial(x, z) -> true by the railways, roads: main roads [[x, z]...] (drawn wide, tree-lined),
## keep(x, z) -> true for buildings to return as footprints, cell: the districts' street spacing (m) }.
## Returns { canvas, buildings: [{ x, z, w, d, rot, h, kind, col }] }. (The functions are Callables.)
static func paint_urban(o: Dictionary) -> Dictionary:
	var T0 := Time.get_ticks_usec()
	var tm := {}
	var lap := func(k: String) -> void: tm[k] = int((Time.get_ticks_usec() - T0) / 1000.0)
	var r := rng(o.seed)
	var n := noise(rng(o.seed + 7))
	var n2 := noise(rng(o.seed + 13))
	var T: float = o.get("threshold", 0.35)
	var size: float = o.size
	var px: int = o.px
	var skip: Callable = o.get("skip", Callable())
	var has_skip := skip.is_valid()
	var c := Canvas2D.new(px, px)
	var g := c
	var s := px / size
	var X := func(m: float) -> float: return px / 2.0 + m * s
	var pick := func(a: Array): return a[floori(r.next() * a.size())]
	var rand := func(a: float, b: float) -> float: return a + r.next() * (b - a)
	# (the edge ragged: the density pushed about by two scales of noise, the ground under it warped)
	# (the town's own density worked out on a coarse grid first, 44 m apart, and read between)
	var B := 160
	var base := PackedFloat32Array()
	base.resize((B + 1) * (B + 1))
	var density: Callable = o.density
	for j in B + 1:
		for i in B + 1:
			base[j * (B + 1) + i] = density.call((float(i) / B - 0.5) * size, (float(j) / B - 0.5) * size)
	var base_at := func(x: float, z: float) -> float:
		var u := clampf((x / size + 0.5) * B, 0, B - 1e-6)
		var v := clampf((z / size + 0.5) * B, 0, B - 1e-6)
		var i := floori(u)
		var j := floori(v)
		var fu := u - i
		var fv := v - j
		var k := j * (B + 1) + i
		return (base[k] * (1 - fu) + base[k + 1] * fu) * (1 - fv) + (base[k + B + 1] * (1 - fu) + base[k + B + 2] * fu) * fv
	var dens := func(x: float, z: float) -> float:
		var wx := x + (n2.at(x / 900 + 3, z / 900 + 3) - 0.5) * 900
		var wz := z + (n2.at(x / 900 + 40, z / 900 + 40) - 0.5) * 900
		return base_at.call(wx, wz) * (0.6 + 0.55 * n.at(x / 600 + 50, z / 600 + 50) + 0.35 * (n.at(x / 160 + 9, z / 160 + 9) - 0.5))
	var roof := func() -> String: return pick.call(ROOF_TILE) if r.next() < 0.78 else pick.call(ROOF_SLATE) if r.next() < 0.85 else pick.call(ROOF_FLAT)
	var buildings := []
	# where things are already: streets and houses (2 m cells), so nothing is built on a street or another house
	var OC := 2.0
	var ON := ceili(size / OC)
	var occ := PackedByteArray()
	occ.resize(ON * ON)
	var oi := func(x: float, z: float) -> int:
		var i := floori((x + size / 2) / OC)
		var j := floori((z + size / 2) / OC)
		return -1 if i < 0 or j < 0 or i >= ON or j >= ON else j * ON + i
	var mark_line := func(pts: Array, w: float) -> void:
		for k in range(1, pts.size()):
			var ax: float = pts[k - 1][0]
			var az: float = pts[k - 1][1]
			var bx: float = pts[k][0]
			var bz: float = pts[k][1]
			var L := Vector2(bx - ax, bz - az).length()
			var nx := -(bz - az) / L
			var nz := (bx - ax) / L
			var t := 0.0
			while t <= L:
				var x := ax + ((bx - ax) * t) / L
				var z := az + ((bz - az) * t) / L
				var oo := -w / 2
				while oo <= w / 2:
					var q: int = oi.call(x + nx * oo, z + nz * oo)
					if q >= 0:
						occ[q] = 1
					oo += 1.5
				t += 1.5
	const FREE_PTS := [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, -0.45], [0, 0.45], [-0.45, 0], [0.45, 0]]
	var free := func(x: float, z: float, w: float, d: float, rot: float) -> bool: # (the rectangle's corners, edges and middle all clear)
		var ca := cos(rot)
		var sa := sin(rot)
		for uv in FREE_PTS:
			var q: int = oi.call(x + ca * uv[0] * w - sa * uv[1] * d, z + sa * uv[0] * w + ca * uv[1] * d)
			if q < 0 or occ[q]:
				return false
		return true
	var mark := func(x: float, z: float, w: float, d: float, rot: float) -> void:
		var ca := cos(rot)
		var sa := sin(rot)
		var u := -w / 2 + 0.6
		while u <= w / 2 - 0.6:
			var v := -d / 2 + 0.6
			while v <= d / 2 - 0.6:
				var q: int = oi.call(x + ca * u - sa * v, z + sa * u + ca * v)
				if q >= 0:
					occ[q] = 1
				v += 1.5
			u += 1.5

	# ---- the ground under the town: courtyards and yards in the middle, gardens further out (mottled), and
	# the mask of where the town is at all (soft-edged, a little ragged)
	var M := 320
	var gc := Canvas2D.new(M, M)
	var img := gc.create_image_data(M, M)
	var mask := Canvas2D.new(M, M)
	var mimg := mask.create_image_data(M, M)
	var D0 := PackedFloat32Array()
	D0.resize(M * M)
	var id := img.data
	var md := mimg.data
	for j in M:
		for i in M:
			var x := ((i + 0.5) / M - 0.5) * size
			var z := ((j + 0.5) / M - 0.5) * size
			var d: float = dens.call(x, z)
			var k := j * M + i
			D0[k] = d
			var t := clampf((d - T) / 0.4, 0, 1)
			var m := n.at(x / 40 + 3, z / 40 + 7)
			var sk := d > T - 0.03 and has_skip and skip.call(x, z)
			# gardens (green-brown) → yards and courtyards (grey-brown) as it thickens
			var u := clampf((t - 0.3) / 0.5, 0, 1)
			var q := k * 4
			id[q] = _u8((80 + m * 16) * (1 - u) + (96 + m * 14) * u); id[q + 1] = _u8((80 + m * 12) * (1 - u) + (88 + m * 12) * u); id[q + 2] = _u8((56 + m * 8) * (1 - u) + (76 + m * 10) * u); id[q + 3] = 255
			md[q] = 255; md[q + 1] = 255; md[q + 2] = 255; md[q + 3] = 0 if sk else _u8(clampf((d - (T - 0.02)) / 0.04, 0, 1) * 255)
	img.data = id
	mimg.data = md
	gc.put_image_data(img, 0, 0); mask.put_image_data(mimg, 0, 0)
	g.image_smoothing_enabled = true; g.draw_image(gc, 0, 0, px, px)
	lap.call("ground")

	# ---- the districts: each its own angle and street spacing; long streets along it, staggered cross streets
	var DN := maxi(3, roundi(size / 650))
	var seeds := []
	for i in DN * DN:
		var x: float = (((i % DN) + 0.5 + rand.call(-0.45, 0.45)) / DN - 0.5) * size
		var z: float = ((floori(float(i) / DN) + 0.5 + rand.call(-0.45, 0.45)) / DN - 0.5) * size
		seeds.append({x = x, z = z, a = rand.call(-0.6, 0.6) + (0.0 if r.next() < 0.5 else PI / 2)})
	var NS := PackedInt32Array() # (each ground texel's district, looked up rather than searched for: only the seeds near it tried)
	NS.resize(M * M)
	for j in M:
		for i in M:
			var x := ((i + 0.5) / M - 0.5) * size
			var z := ((j + 0.5) / M - 0.5) * size
			var ci := floori(((i + 0.5) / M) * DN)
			var cj := floori(((j + 0.5) / M) * DN)
			var b := 0
			var bd := INF
			for b2 in range(maxi(0, cj - 2), mini(DN - 1, cj + 2) + 1):
				for a2 in range(maxi(0, ci - 2), mini(DN - 1, ci + 2) + 1):
					var k := b2 * DN + a2
					var qq: Dictionary = seeds[k]
					var dd: float = (qq.x - x) * (qq.x - x) + (qq.z - z) * (qq.z - z)
					if dd < bd:
						bd = dd
						b = k
			NS[j * M + i] = b
	var gi := func(x: float, z: float) -> int: return clampi(floori((x / size + 0.5) * M), 0, M - 1) + clampi(floori((z / size + 0.5) * M), 0, M - 1) * M
	var nearest := func(x: float, z: float) -> int: return NS[gi.call(x, z)]
	var dens_g := func(x: float, z: float) -> float: return D0[gi.call(x, z)]
	var streets := []
	var ok := func(x: float, z: float, k: int) -> bool: return absf(x) < size / 2 - 10 and absf(z) < size / 2 - 10 and nearest.call(x, z) == k and dens_g.call(x, z) > T - 0.03 and not (has_skip and skip.call(x, z))
	for k in seeds.size():
		var q: Dictionary = seeds[k]
		var ca := cos(q.a)
		var sa := sin(q.a)
		var dq: float = dens.call(q.x, q.z)
		var sp: float = o.get("cell", 80) * (1.0 if dq > 0.7 else 0.9 if dq > 0.5 else 0.8) * rand.call(0.85, 1.15)
		var reach := (size / DN) * 1.15
		var at := func(u: float, v: float) -> Array: return [q.x + u * ca - v * sa, q.z + u * sa + v * ca]
		var ph: float = rand.call(0, 6.28)
		var amp: float = rand.call(4, 16)
		var lam: float = rand.call(250, 600)
		var off := func(u: float, kk: int) -> float: return amp * sin(u / lam + ph + kk * 0.7) + 0.4 * amp * sin(u / (lam * 0.37) + kk)
		var lines := {}
		var kn := ceili(reach / sp)
		for kk in range(-kn, kn + 1):
			var v0: float = kk * sp + rand.call(-sp * 0.12, sp * 0.12)
			var run := []
			var runs := []
			var u := -reach
			while u <= reach:
				var p: Array = at.call(u, v0 + off.call(u, kk))
				if ok.call(p[0], p[1], k):
					run.append(p)
				else:
					if run.size() > 4:
						runs.append(run)
					run = []
				u += 10
			if run.size() > 4:
				runs.append(run)
			lines[kk] = {v0 = v0, kk = kk}
			for rn in runs: # (out where it thins, the streets are short: a few built up, the rest not yet)
				var mid: Array = rn[floori(rn.size() / 2.0)]
				var dm: float = dens_g.call(mid[0], mid[1])
				if dm > 0.5:
					streets.append({pts = rn, w = 13.0 if dm > 0.68 else 9.0})
					continue
				var a := 0
				while a < rn.size():
					var L := 12 + floori(r.next() * 30)
					var piece: Array = rn.slice(a, a + L)
					if piece.size() > 4 and r.next() < 0.62:
						streets.append({pts = piece, w = 8.0})
					a += L + (0 if r.next() < 0.5 else 4 + floori(r.next() * 10))
		# the cross streets: between two long streets now and then, never two in line across a third
		for kk in range(-kn, kn):
			var la = lines.get(kk)
			var lb = lines.get(kk + 1)
			if la == null or lb == null:
				continue
			var u: float = -reach + rand.call(0, 200)
			while u < reach:
				var p0: Array = at.call(u, la.v0 + off.call(u, kk))
				var p1: Array = at.call(u + rand.call(-12, 12), lb.v0 + off.call(u, kk + 1))
				var mid := [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
				if ok.call(p0[0], p0[1], k) and ok.call(p1[0], p1[1], k) and ok.call(mid[0], mid[1], k):
					streets.append({pts = [p0, mid, p1], w = 8.0})
				u += rand.call(110, 260)
	lap.call("streets")
	for st in streets:
		mark_line.call(st.pts, st.w * 0.7)
	for road in o.get("roads", []):
		mark_line.call(road, 14)

	# ---- the shadows go on their own layer, laid on blurred in one go
	var sh := Canvas2D.new(px, px)
	var sg := sh
	sg.fill_style = "#000"
	var roofs := [] # [x, z, w, d, rot, col, kind] painted after the shadows
	var trees := []
	var keep: Callable = o.get("keep", Callable())
	var house := func(x: float, z: float, w: float, d: float, rot: float, h: float, kind: String, col = null) -> bool:
		if col == null:
			col = roof.call()
		if not free.call(x, z, w, d, rot):
			return false
		mark.call(x, z, w, d, rot)
		roofs.append([x, z, w, d, rot, col, kind])
		sg.save(); sg.translate(X.call(x + h * 0.22), X.call(z + h * 0.34)); sg.rotate(rot); sg.fill_rect((-w / 2) * s, (-d / 2) * s, w * s, d * s); sg.restore()
		if keep.is_valid() and keep.call(x, z):
			buildings.append({x = x, z = z, w = w, d = d, rot = rot, h = h, kind = kind, col = col})
		return true

	# ---- the buildings along every street, by how thick the town is there
	var industrial: Callable = o.get("industrial", Callable())
	for st in streets:
		var pts: Array = st.pts
		for k in range(1, pts.size()):
			var ax: float = pts[k - 1][0]
			var az: float = pts[k - 1][1]
			var bx: float = pts[k][0]
			var bz: float = pts[k][1]
			var L := Vector2(bx - ax, bz - az).length()
			var tx := (bx - ax) / L
			var tz := (bz - az) / L
			var rot := atan2(tz, tx)
			var a := 0.0
			while a < L:
				var x := ax + tx * a
				var z := az + tz * a
				var d: float = dens_g.call(x, z)
				var ind: bool = industrial.is_valid() and industrial.call(x, z) and r.next() < 0.6
				var step: float
				if ind: # halls and sheds, their yards
					var hw: float = rand.call(25, 90)
					var hd: float = rand.call(18, 50)
					for side in [-1, 1]:
						var nx: float = -tz * side
						var nz: float = tx * side
						var off2: float = st.w / 2 + hd / 2 + rand.call(4, 12)
						house.call(x + tx * hw / 2 + nx * off2, z + tz * hw / 2 + nz * off2, hw, hd, rot, rand.call(8, 15), "hall", pick.call(HALL))
					step = hw + rand.call(6, 20)
				elif d > 0.68: # closed rows, wings into the courtyards behind
					var w: float = rand.call(9, 16)
					var dp: float = rand.call(11, 15)
					var h: float = rand.call(15, 21)
					var col: String = roof.call()
					for side in [-1, 1]:
						var nx: float = -tz * side
						var nz: float = tx * side
						var off2: float = st.w / 2 + dp / 2 + 0.5
						if r.next() < 0.95 and house.call(x + tx * w / 2 + nx * off2, z + tz * w / 2 + nz * off2, w - 0.3, dp, rot, h + rand.call(-2, 2), "block", col if r.next() < 0.5 else roof.call()) and r.next() < 0.45:
							var wl: float = rand.call(8, 18)
							var bo := off2 + dp / 2 + wl / 2
							house.call(x + tx * w / 2 + nx * bo, z + tz * w / 2 + nz * bo, rand.call(6, 8), wl, rot, rand.call(9, 14), "block", roof.call())
					step = w
				elif d > 0.48: # terraces and semis behind front gardens, sheds and trees in the back gardens
					var w: float = rand.call(9, 13)
					var dp: float = rand.call(9, 11)
					for side in [-1, 1]:
						var nx: float = -tz * side
						var nz: float = tx * side
						var off2: float = st.w / 2 + rand.call(3, 6) + dp / 2
						if r.next() < 0.9:
							house.call(x + tx * w / 2 + nx * off2, z + tz * w / 2 + nz * off2, w - 0.4, dp, rot, rand.call(9, 12), "house")
						if r.next() < 0.3:
							house.call(x + tx * w / 2 + nx * (off2 + dp / 2 + rand.call(8, 14)), z + tz * w / 2 + nz * (off2 + dp / 2 + rand.call(8, 14)), rand.call(4, 6), rand.call(3, 5), rot, 3.0, "shed")
						if r.next() < 0.35:
							trees.append([x + nx * (off2 + rand.call(12, 25)), z + nz * (off2 + rand.call(12, 25)), rand.call(2.5, 4)])
					step = w + (rand.call(3, 8) if r.next() < 0.3 else 0.3)
				else: # villas and cottages in their gardens
					var w: float = rand.call(9, 13)
					var dp: float = rand.call(8, 11)
					for side in [-1, 1]:
						var nx: float = -tz * side
						var nz: float = tx * side
						var off2: float = st.w / 2 + rand.call(6, 11) + dp / 2
						if r.next() < 0.8:
							house.call(x + tx * w / 2 + nx * off2, z + tz * w / 2 + nz * off2, w, dp, rot + (PI / 2 if r.next() < 0.25 else 0.0), rand.call(7, 10), "house")
						for t in 2:
							if r.next() < 0.6:
								trees.append([x + tx * rand.call(-8, 8) + nx * (off2 + rand.call(8, 30)), z + tz * rand.call(-8, 8) + nz * (off2 + rand.call(8, 30)), rand.call(2.5, 4.5)])
					step = w + rand.call(8, 18)
				a += step
	lap.call("houses")
	# ---- out at the fringe: allotment colonies (little strip gardens, a hut on each), a cemetery or two, a sports field
	var fringe := []
	var kf := 0
	while kf < 900 and fringe.size() < roundi(size / 220):
		kf += 1
		var x: float = rand.call(-size * 0.45, size * 0.45)
		var z: float = rand.call(-size * 0.45, size * 0.45)
		var d: float = dens_g.call(x, z)
		if d > T - 0.02 and d < T + 0.14 and not (has_skip and skip.call(x, z)) and free.call(x, z, 30, 30, 0):
			fringe.append([x, z])
	var ag := [] # allotment plots: [x, z, w, d, rot, colour]
	for i in fringe.size():
		var x: float = fringe[i][0]
		var z: float = fringe[i][1]
		var a: float = seeds[nearest.call(x, z)].a
		var ca := cos(a)
		var sa := sin(a)
		if i % 7 == 3: # a cemetery: grass, paths, rows of trees, the chapel
			var W: float = rand.call(90, 160)
			var Dd: float = rand.call(70, 120)
			if not free.call(x, z, W, Dd, a):
				continue
			mark.call(x, z, W, Dd, a)
			ag.append([x, z, W, Dd, a, "#56603e"])
			var u := -W / 2 + 6
			while u < W / 2:
				for v in [-Dd / 2 + 4, Dd / 2 - 4, 0.0]:
					trees.append([x + ca * u - sa * v, z + sa * u + ca * v, rand.call(2.5, 3.5)])
				u += 12
			roofs.append([x, z, 14.0, 8.0, a, pick.call(ROOF_SLATE), "house"])
			continue
		if i % 7 == 5: # a sports field
			if not free.call(x, z, 110, 75, a):
				continue
			mark.call(x, z, 110, 75, a); ag.append([x, z, 110.0, 75.0, a, "#6c7646"]); ag.append([x, z, 96.0, 62.0, a, "#728048"])
			continue
		var rows := 2 + floori(r.next() * 4)
		var cols := 4 + floori(r.next() * 8)
		for i2 in cols:
			for j in rows:
				var u := (i2 - cols / 2.0) * 11
				var v := (j - rows / 2.0) * 24
				var px2 := x + ca * u - sa * v
				var pz := z + sa * u + ca * v
				if not free.call(px2, pz, 10, 22, a):
					continue
				mark.call(px2, pz, 10, 22, a)
				ag.append([px2, pz, 9.6, 21.5, a, pick.call(["#5e6a3c", "#6a6440", "#5a5f3a", "#73694a", "#56663a"])])
				if r.next() < 0.7:
					roofs.append([px2 + ca * 2, pz + sa * 2 + 8, 3.0, 2.5, a, pick.call(["#6a5a4a", "#5a5550", "#7a6650"]), "shed"])
				if r.next() < 0.5:
					trees.append([px2 + rand.call(-3, 3), pz + rand.call(-8, 8), rand.call(1.8, 2.8)])
	for p in ag:
		g.save(); g.translate(X.call(p[0]), X.call(p[1])); g.rotate(p[4]); g.fill_style = p[5]; g.fill_rect((-p[2] / 2) * s, (-p[3] / 2) * s, p[2] * s, p[3] * s); g.restore()

	# ---- the streets: grey cobbles and tar in the middle, paler gravel out at the edge
	var poly := func(ctx, pts: Array) -> void:
		ctx.begin_path()
		for i in pts.size():
			if i:
				ctx.line_to(X.call(pts[i][0]), X.call(pts[i][1]))
			else:
				ctx.move_to(X.call(pts[i][0]), X.call(pts[i][1]))
	g.line_cap = "round"; g.line_join = "round"
	for st in streets:
		var mid: Array = st.pts[floori(st.pts.size() / 2.0)]
		var dm: float = dens_g.call(mid[0], mid[1])
		g.stroke_style = "#7a7062" if dm > 0.6 else "#7d7364" if dm > 0.45 else "#74695a"
		g.line_width = maxf(1, st.w * (0.75 if dm > 0.45 else 0.55) * s); poly.call(g, st.pts); g.stroke()
	# the main roads: wide, metalled, an avenue of trees each side where they run through the town
	for road in o.get("roads", []):
		g.stroke_style = "#857a68"; g.line_width = maxf(2, 16 * s)
		poly.call(g, road); g.stroke()
		for i in range(1, road.size()):
			var ax: float = road[i - 1][0]
			var az: float = road[i - 1][1]
			var bx: float = road[i][0]
			var bz: float = road[i][1]
			var L := Vector2(bx - ax, bz - az).length()
			var nx := -(bz - az) / L
			var nz := (bx - ax) / L
			var t := 0.0
			while t < L:
				var x := ax + ((bx - ax) * t) / L
				var z := az + ((bz - az) * t) / L
				t += 12
				if dens_g.call(x, z) < T or (has_skip and skip.call(x, z)):
					continue
				trees.append([x + nx * 11, z + nz * 11, 3.2]); trees.append([x - nx * 11, z - nz * 11, 3.2])
	lap.call("lines")
	# ---- the shadows (houses and trees), then the trees and the roofs over them
	for t in trees:
		sg.begin_path(); sg.arc(X.call(t[0] + t[2] * 0.6), X.call(t[1] + t[2]), t[2] * s, 0, 7); sg.fill()
	g.save(); g.global_alpha = 0.45; g.filter = "blur(%.1fpx)" % maxf(0.5, 1.1 * s); g.draw_image(sh, 0, 0); g.restore()
	for t in trees:
		g.fill_style = pick.call(["#46512b", "#4e562c", "#5d5a2c", "#6a5c2e", "#3f4a28"]); g.begin_path(); g.arc(X.call(t[0]), X.call(t[1]), maxf(0.7, t[2] * s), 0, 7); g.fill()
	for rf in roofs:
		var w: float = rf[2]
		var d: float = rf[3]
		var kind: String = rf[6]
		g.save(); g.translate(X.call(rf[0]), X.call(rf[1])); g.rotate(rf[4])
		var W := w * s
		var Dd := d * s
		g.fill_style = rf[5]; g.fill_rect(-W / 2, -Dd / 2, W, Dd)
		if kind == "hall":
			if W > 6: # (sawtooth roof lights)
				g.fill_style = "rgba(0,0,0,0.18)"
				var u := -W / 2
				while u < W / 2:
					g.fill_rect(u, -Dd / 2, 3 * s, Dd)
					u += 8 * s
		elif kind != "shed" and W > 2: # the far slope in shade (the ridge along the long side)
			g.fill_style = "rgba(20,12,8,0.24)"
			if w >= d:
				g.fill_rect(-W / 2, 0, W, Dd / 2)
			else:
				g.fill_rect(0, -Dd / 2, W / 2, Dd)
		g.restore()
	lap.call("roofs")
	# ---- the town ends where its last gardens do: the mask, blurred a little
	var fm := Canvas2D.new(px, px)
	var fg := fm
	fg.image_smoothing_enabled = true; fg.filter = "blur(%.1fpx)" % (6 * s); fg.draw_image(mask, 0, 0, px, px)
	for st in streets:
		fg.stroke_style = "#fff"; fg.line_width = st.w * 2.2 * s; poly.call(fg, st.pts); fg.stroke()
	fg.filter = "none"
	for p in ag:
		fg.save(); fg.translate(X.call(p[0]), X.call(p[1])); fg.rotate(p[4]); fg.fill_style = "#fff"; fg.fill_rect((-p[2] / 2 - 2) * s, (-p[3] / 2 - 2) * s, (p[2] + 4) * s, (p[3] + 4) * s); fg.restore()
	for rf in roofs:
		fg.save(); fg.translate(X.call(rf[0]), X.call(rf[1])); fg.rotate(rf[4]); fg.fill_style = "#fff"; fg.fill_rect((-rf[2] / 2 - 3) * s, (-rf[3] / 2 - 3) * s, (rf[2] + 6) * s, (rf[3] + 6) * s); fg.restore()
	g.global_composite_operation = "destination-in"; g.draw_image(fm, 0, 0); g.global_composite_operation = "source-over"
	lap.call("mask")
	return {canvas = c, buildings = buildings, tm = tm}

## (Uint8ClampedArray: a number stored as the nearest 0..255)
static func _u8(v: float) -> int:
	return clampi(roundi(v), 0, 255)
