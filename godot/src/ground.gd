extends RefCounted
# The Franconian countryside from five miles up, drawn in the ground's own shader so it never repeats where
# you can see it: Gewann blocks of a few hundred metres, each cut into long narrow strips (6-25 m, the
# fields split lengthwise at every inheritance), most strips of a block in the same crop, the next block's
# strips at another angle; pale field tracks along some of the block edges, grass baulks between the strips.
# Woods on the hills, their edges following the blocks (the forest is owned by the parcel, as the fields are)
# with the shadow of the trees on the field beside them; meadows down the valleys; streams winding down to
# the rivers, lined with alders; the roads from village to village, fruit trees along them. The villages
# (countryside.gd) stand where this lays them out. All of it is one layout, 81.92 km square, that wraps:
# a texture for what changes slowly (woods, meadows), and the streams and roads as line segments the shader
# measures its distance to exactly (crisp from 25,000 ft and from a fighter at 500 m alike).
# aerial(): the haze between you and the ground (every ground material shares it), the blue-grey veil
# that, five miles up, lies even over the ground straight below.

const Env := preload("res://src/environment.gd")

const MACRO := 81920.0 # m: the layout's size (it wraps)
const MAP := 1024 # texels across the woods and meadows map (80 m each)
const CELL := 160.0
const GRID := 512 # (MACRO / CELL)
const SLOTS := 8 # the streams and roads: which segments pass near each 160 m cell
const SEGW := 2048 # segments texture width (2 texels a segment)

## The haze over the ground: how much thicker it lies on the ground than the scene's fog (shared, so it can be tuned at once).
static var AIR := Env.Shared.new("air", 0.32)

static var _seed := 1
static func rnd() -> float:
	_seed = (_seed * 16807) % 2147483647
	return float(_seed) / 2147483647.0
static func rand(a: float, b: float) -> float:
	return a + rnd() * (b - a)

## Wrapped value noise on the layout: u, v in [0, 1) round it, n lattice cells across (so it wraps), 0..1.
class Periodic:
	var n: int
	var g: PackedFloat32Array
	func _init(n_: int, s: int) -> void:
		n = n_
		g.resize(n * n)
		var k := s
		for i in n * n:
			k = (k * 16807) % 2147483647
			g[i] = float(k) / 2147483647.0
	func at(u: float, v: float) -> float:
		var x := u * n
		var y := v * n
		var x0 := floori(x)
		var y0 := floori(y)
		var fx := x - x0
		var fy := y - y0
		var sx := fx * fx * (3 - 2 * fx)
		var sy := fy * fy * (3 - 2 * fy)
		var i0 := posmod(x0, n)
		var i1 := posmod(x0 + 1, n)
		var j0 := posmod(y0, n) * n
		var j1 := posmod(y0 + 1, n) * n
		return (g[j0 + i0] * (1 - sx) + g[j0 + i1] * sx) * (1 - sy) + (g[j1 + i0] * (1 - sx) + g[j1 + i1] * sx) * sy

## The shortest way from a to b round the wrapped layout.
static func wrap_d(d: float) -> float:
	return d - MACRO * roundf(d / MACRO)

## The country's layout, worked out once (it's the same every time: seeded) and kept on disk after, so later
## starts read it back instead of working it out again (GDScript is slower at this than the browser was).
const CACHE := "user://ground_layout_v1.res"

class Layout:
	var macro: ImageTexture
	var grid: ImageTexture
	var segs: ImageTexture
	var villages: Array = [] # [{x, z, kind, r, turn, variant, idx}]
	var river: Array = []
	var ms := 0.0
	var tm := {}
	var count := {}
	var raw: PackedFloat32Array # (the woods field, for forest_at)
	var thr := 0.5
	func forest_at(x: float, z: float) -> float:
		var i := posmod(floori(x / MACRO * MAP), MAP)
		var j := posmod(floori(z / MACRO * MAP), MAP)
		return 0.5 + (raw[j * MAP + i] - thr) * 9

## Lay out the country: the hills and woods, the streams and the river, the villages and the roads between
## them. Returns a Layout { macro (texture), grid, segs (textures), villages: [{ x, z, kind, variant, turn }] }.
static func layout_country() -> Layout:
	var t0 := Time.get_ticks_usec()
	var cached := _load_cache()
	if cached:
		cached.ms = (Time.get_ticks_usec() - t0) / 1000.0
		cached.tm = {cached = true}
		return cached
	var out := _layout()
	out.ms = (Time.get_ticks_usec() - t0) / 1000.0
	_save_cache(out)
	return out

static func _layout() -> Layout:
	var t0 := Time.get_ticks_usec()
	var tm := {}
	var lap := func(k: String) -> void: tm[k] = int((Time.get_ticks_usec() - t0) / 1000.0)
	_seed = 1943
	# ---- the lie of the land: low hills (the woods keep to their tops), and the woods themselves
	var h1 := Periodic.new(6, 11)
	var h2 := Periodic.new(14, 23)
	var h3 := Periodic.new(31, 37)
	var f1 := Periodic.new(48, 41)
	var f2 := Periodic.new(110, 43)
	var hill := func(u: float, v: float) -> float: return 0.55 * h1.at(u, v) + 0.3 * h2.at(u, v) + 0.15 * h3.at(u, v)
	var raw := PackedFloat32Array()
	raw.resize(MAP * MAP)
	var H := MAP / 2
	var half := PackedFloat32Array()
	half.resize(H * H)
	for j in H:
		for i in H:
			var u := (i + 0.5) / H
			var v := (j + 0.5) / H
			half[j * H + i] = 0.62 * (0.55 * h1.at(u, v) + 0.3 * h2.at(u, v) + 0.15 * h3.at(u, v)) + 0.26 * f1.at(u, v) + 0.12 * f2.at(u, v)
	for j in MAP: # (worked out at half the size, filled in between: it's smooth)
		var y := j / 2.0 - 0.25
		var y0 := floori(y)
		var fy := y - y0
		var b0 := posmod(y0, H) * H
		var b1 := posmod(y0 + 1, H) * H
		for i in MAP:
			var x := i / 2.0 - 0.25
			var x0 := floori(x)
			var fx := x - x0
			var a0 := posmod(x0, H)
			var a1 := posmod(x0 + 1, H)
			raw[j * MAP + i] = (half[b0 + a0] * (1 - fx) + half[b0 + a1] * fx) * (1 - fy) + (half[b1 + a0] * (1 - fx) + half[b1 + a1] * fx) * fy
	# about a fifth of it wooded (the Gäu plateaus are mostly ploughed: the woods are on the hills)
	var thr := 0.5
	if true: # (the level a fifth of the map lies above: from a histogram, not a sort of a million)
		var lo := INF
		var hi := -INF
		for v in half:
			lo = minf(lo, v)
			hi = maxf(hi, v)
		var hist := PackedInt32Array()
		hist.resize(1024)
		for v in half:
			hist[mini(1023, floori(((v - lo) / (hi - lo)) * 1024))] += 1
		var acc := 0
		for k in range(1023, -1, -1):
			acc += hist[k]
			if acc >= half.size() * 0.2:
				thr = lo + ((k + 0.5) / 1024) * (hi - lo)
				break
	var forest := func(u: float, v: float) -> float: # (0.5 at the woods' edge)
		var i := posmod(floori(u * MAP), MAP)
		var j := posmod(floori(v * MAP), MAP)
		return 0.5 + (raw[j * MAP + i] - thr) * 9

	lap.call("woods")
	# ---- the water: streams running down off the hills (meandering, joining), and a river right across
	var segs := [] # [x0, z0, x1, z1, half width, kind (0 water, 1 lane, 2 main road)]
	var pts := {} # (where the water already runs: streams join it)
	var key := func(x: float, z: float) -> int: return floori(fposmod(x, MACRO) / 200) * 1000 + floori(fposmod(z, MACRO) / 200)
	var water := [] # [x, z, half width]: points along all of it (for the meadows and the villages)
	var river := []
	if true:
		var A := rand(0, 6.28)
		var B := rand(0, 6.28)
		var C := rand(0, 6.28)
		var z0 := rand(0, MACRO)
		var x := 0.0
		while x <= MACRO:
			var t := (x / MACRO) * PI * 2
			river.append([x, z0 + 2600 * sin(t + A) + 900 * sin(3 * t + B) + 350 * sin(8 * t + C) + 120 * sin(21 * t + B)])
			x += 120
		for k in range(1, river.size()):
			segs.append([river[k - 1][0], river[k - 1][1], river[k][0], river[k][1], 30.0, 0])
		for p in river:
			water.append([p[0], p[1], 30.0])
			pts[key.call(p[0], p[1])] = true
	var grad := func(x: float, z: float) -> Vector2:
		var u := x / MACRO
		var v := z / MACRO
		var e := 60 / MACRO
		return Vector2(hill.call(u + e, v) - hill.call(u - e, v), hill.call(u, v + e) - hill.call(u, v - e))
	for s in 150:
		var x := rand(0, MACRO)
		var z := rand(0, MACRO)
		if hill.call(x / MACRO, z / MACRO) < 0.5:
			continue # (springs in the hills)
		var dx := rand(-1, 1)
		var dz := rand(-1, 1)
		var len := 0.0
		var hw := 1.4
		var line := [[x, z]]
		var ph := rand(0, 6.28)
		for k in 400:
			var gv: Vector2 = grad.call(x, z)
			var gl := gv.length()
			if gl == 0:
				gl = 1
			var m := sin(len / 260 + ph) * 0.9 + sin(len / 90 + ph * 2) * 0.35 # (the meander)
			var nx := dx * 0.75 - (gv.x / gl) * 0.6
			var nz := dz * 0.75 - (gv.y / gl) * 0.6
			var nl := Vector2(nx, nz).length()
			if nl == 0:
				nl = 1
			nx /= nl
			nz /= nl
			var c := cos(m * 0.5)
			var sn := sin(m * 0.5)
			dx = nx
			dz = nz
			x += (nx * c - nz * sn) * 70
			z += (nx * sn + nz * c) * 70
			len += 70
			line.append([x, z])
			if k > 3 and pts.has(key.call(x, z)):
				break # (into a stream or the river)
		if len < 2500:
			continue
		for k in range(1, line.size()):
			hw = minf(5, 1.4 + (float(k) / line.size()) * 3.2)
			segs.append([line[k - 1][0], line[k - 1][1], line[k][0], line[k][1], hw, 0])
			water.append([line[k][0], line[k][1], hw])
		for p in line:
			pts[key.call(p[0], p[1])] = true

	lap.call("streams")
	# ---- the meadows down the valleys (and the woods kept off the water)
	var mead := PackedFloat32Array()
	mead.resize(MAP * MAP)
	var T := MACRO / MAP
	for w in water:
		var wx: float = w[0]
		var wz: float = w[1]
		var r: float = 70 + w[2] * 30
		var ri := ceili(r / T) + 1
		var ci := floori(wx / T)
		var cj := floori(wz / T)
		for j in range(cj - ri, cj + ri + 1):
			var dzz := (j + 0.5) * T - wz
			var row := posmod(j, MAP) * MAP
			for i in range(ci - ri, ci + ri + 1):
				var dxx := (i + 0.5) * T - wx
				var wgt := maxf(0, 1 - sqrt(dxx * dxx + dzz * dzz) / r)
				var k := row + posmod(i, MAP)
				if wgt > mead[k]:
					mead[k] = wgt

	lap.call("meadows")
	# ---- the villages: every 2-3 km, in the valleys by the water rather than up in the woods
	var WN := ceili(MACRO / 1000)
	var near := [] # (water points by 1 km cell, for how far a place is from it)
	near.resize(WN * WN)
	for i in WN * WN:
		near[i] = []
	var wk := func(i: int, j: int) -> int: return posmod(j, WN) * WN + posmod(i, WN)
	for w in water:
		near[wk.call(floori(w[0] / 1000), floori(w[1] / 1000))].append(w)
	var water_dist := func(x: float, z: float) -> float:
		var best := 3000.0
		var ci := floori(x / 1000)
		var cj := floori(z / 1000)
		for j in range(cj - 2, cj + 3):
			for i in range(ci - 2, ci + 3):
				for w in near[wk.call(i, j)]:
					best = minf(best, Vector2(wrap_d(w[0] - x), wrap_d(w[1] - z)).length() - w[2])
		return best
	var villages := []
	var VN := roundi(MACRO / 4000)
	var vgrid := [] # (the places by 4 km cell)
	vgrid.resize(VN * VN)
	for i in VN * VN:
		vgrid[i] = []
	var vk := func(i: int, j: int) -> int: return posmod(j, VN) * VN + posmod(i, VN)
	var crowded := func(x: float, z: float, r: float) -> bool:
		var ci := floori(x / 4000)
		var cj := floori(z / 4000)
		for j in range(cj - 1, cj + 2):
			for i in range(ci - 1, ci + 2):
				for v in vgrid[vk.call(i, j)]:
					if Vector2(wrap_d(v.x - x), wrap_d(v.z - z)).length() < maxf(r, v.r):
						return true
		return false
	var n := 0
	while n < 60000 and villages.size() < 1000:
		n += 1
		var x := rand(0, MACRO)
		var z := rand(0, MACRO)
		var u := x / MACRO
		var v := z / MACRO
		if forest.call(u, v) > 0.32 or forest.call(u + 300 / MACRO, v) > 0.45 or forest.call(u - 300 / MACRO, v) > 0.45 or forest.call(u, v + 300 / MACRO) > 0.45 or forest.call(u, v - 300 / MACRO) > 0.45:
			continue
		var r0 := rnd()
		var kind := 3 if r0 < 0.045 else 0 if r0 < 0.3 else 1 if r0 < 0.7 else 2 # (a market town now and then; hamlets; villages)
		var r := 3800.0 if kind == 3 else 1500.0 if kind == 0 else 2050.0
		if crowded.call(x, z, r):
			continue
		if kind == 3: # (a market town in open country, not a clearing)
			var clearing := false
			for k in 8:
				if forest.call(u + (cos(k * 0.785) * 900) / MACRO, v + (sin(k * 0.785) * 900) / MACRO) > 0.42:
					clearing = true
					break
			if clearing:
				continue
		var wd: float = water_dist.call(x, z)
		if wd < 120 or rnd() > 0.3 + 0.7 * exp(-wd / 900):
			continue
		var p := {x = x, z = z, kind = kind, r = r, turn = rand(0, PI * 2), variant = floori(rnd() * 64), idx = villages.size()}
		villages.append(p)
		vgrid[vk.call(floori(x / 4000), floori(z / 4000))].append(p)

	lap.call("villages")
	# ---- the roads: each village to its nearest two or three (the lanes winding a little), towns by main roads
	var edges := {}
	for a in villages.size():
		var A: Dictionary = villages[a]
		var nb := []
		var ci := floori(A.x / 4000)
		var cj := floori(A.z / 4000)
		for j in range(cj - 1, cj + 2):
			for i in range(ci - 1, ci + 2):
				for B in vgrid[vk.call(i, j)]:
					if B == A:
						continue
					var d := Vector2(wrap_d(B.x - A.x), wrap_d(B.z - A.z)).length()
					if d < 5200:
						nb.append([d, B])
		nb.sort_custom(func(p, q): return p[0] < q[0])
		var want: int = 5 if A.kind == 3 else (1 + int(rnd() < 0.5)) if A.kind == 0 else (2 + int(rnd() < 0.5))
		# (not one that runs nearly the same way as a nearer one: two roads out of the same side of the village)
		var taken := []
		for e in nb:
			if taken.size() >= want:
				break
			var B: Dictionary = e[1]
			var ang := atan2(wrap_d(B.z - A.z), wrap_d(B.x - A.x))
			var same := false
			for t in taken:
				if absf(wrap_d(((t - ang) * MACRO) / (PI * 2)) / MACRO * PI * 2) < 0.6:
					same = true
					break
			if same:
				continue
			taken.append(ang)
			var b: int = B.idx
			var id := "%d-%d" % [a, b] if a < b else "%d-%d" % [b, a]
			if edges.has(id):
				continue
			edges[id] = true
			var main: bool = A.kind == 3 or B.kind == 3
			var dx := wrap_d(B.x - A.x)
			var dz := wrap_d(B.z - A.z)
			var L := Vector2(dx, dz).length()
			var nx := -dz / L
			var nz := dx / L
			var line := [[A.x, A.z]]
			for k in range(1, 4):
				var t := k / 4.0
				var o := rand(-0.07, 0.07) * L
				line.append([A.x + dx * t + nx * o, A.z + dz * t + nz * o])
			line.append([A.x + dx, A.z + dz])
			for it in 3: # (smoothed into easy curves)
				var o2 := [line[0]]
				for k in line.size() - 1:
					var pp: Array = line[k]
					var qq: Array = line[k + 1]
					o2.append([pp[0] * 0.75 + qq[0] * 0.25, pp[1] * 0.75 + qq[1] * 0.25])
					o2.append([pp[0] * 0.25 + qq[0] * 0.75, pp[1] * 0.25 + qq[1] * 0.75])
				o2.append(line[line.size() - 1])
				line = o2
			for k in range(1, line.size()):
				segs.append([line[k - 1][0], line[k - 1][1], line[k][0], line[k][1], 3.2 if main else 2.3, 2 if main else 1])

	lap.call("roads")
	# ---- the woods and meadows map: R the woods (0.5 at the edge), G the valley meadows
	var data := PackedByteArray()
	data.resize(MAP * MAP * 4)
	for k in MAP * MAP:
		var m := mead[k]
		var f := 0.5 + (raw[k] - thr) * 9 - m * 0.9
		data[k * 4] = clampi(int(f * 255), 0, 255)
		data[k * 4 + 1] = int(m * 255)
		data[k * 4 + 2] = 0
		data[k * 4 + 3] = 255
	var mimg := Image.create_from_data(MAP, MAP, false, Image.FORMAT_RGBA8, data)
	mimg.generate_mipmaps()

	# ---- the streams and roads by cell: each cell lists the segments that pass within reach of it (copies
	# of a segment moved a whole layout over, where it crosses the wrap)
	var cells := {}
	var entries := [] # [x0, z0, x1, z1, hw, kind]
	var R := 16.0 # m of reach beyond the line (its trees)
	for s in segs:
		var x0: float = s[0]
		var z0: float = s[1]
		var x1: float = s[2]
		var z1: float = s[3]
		var hw: float = s[4]
		var minx := minf(x0, x1) - hw - R
		var maxx := maxf(x0, x1) + hw + R
		var minz := minf(z0, z1) - hw - R
		var maxz := maxf(z0, z1) + hw + R
		var by_shift := [-1, -1, -1, -1, -1, -1, -1, -1, -1] # (this segment's copy for each wrap: -1, 0, +1 layouts over in x and in z)
		for cj in range(floori(minz / CELL), floori(maxz / CELL) + 1):
			for ci in range(floori(minx / CELL), floori(maxx / CELL) + 1):
				var wi := posmod(ci, GRID)
				var wj := posmod(cj, GRID)
				var sx := (wi - ci) * CELL
				var sz := (wj - cj) * CELL
				var sk := (roundi(sx / MACRO) + 1) * 3 + roundi(sz / MACRO) + 1
				var e: int = by_shift[sk]
				if e < 0:
					e = entries.size()
					entries.append([x0 + sx, z0 + sz, x1 + sx, z1 + sz, hw, s[5]])
					by_shift[sk] = e
				var c := wj * GRID + wi
				if not cells.has(c):
					cells[c] = []
				cells[c].append(e)
	var grid := PackedFloat32Array()
	grid.resize(GRID * 2 * GRID * 4)
	grid.fill(-1)
	var prio := func(e: int) -> int: return (0 if entries[e][4] > 10 else 2) if entries[e][5] == 0 else 1 if entries[e][5] == 2 else 3
	for c in cells:
		var l: Array = cells[c]
		if l.size() > SLOTS:
			l.sort_custom(func(a, b): return prio.call(a) < prio.call(b))
		var ci: int = c % GRID
		var cj: int = c / GRID
		for k in mini(SLOTS, l.size()):
			grid[((cj * GRID * 2) + ci * 2 + (k >> 2)) * 4 + (k & 3)] = l[k]
	lap.call("cells")
	var rows := ceili((entries.size() * 2) / float(SEGW))
	var sd := PackedFloat32Array()
	sd.resize(SEGW * rows * 4)
	for i in entries.size():
		var e: Array = entries[i]
		sd[i * 8] = e[0]; sd[i * 8 + 1] = e[1]; sd[i * 8 + 2] = e[2]; sd[i * 8 + 3] = e[3]
		sd[i * 8 + 4] = e[4]; sd[i * 8 + 5] = e[5]
	var out := Layout.new()
	out.macro = ImageTexture.create_from_image(mimg)
	out.grid = ImageTexture.create_from_image(Image.create_from_data(GRID * 2, GRID, false, Image.FORMAT_RGBAF, grid.to_byte_array()))
	out.segs = ImageTexture.create_from_image(Image.create_from_data(SEGW, rows, false, Image.FORMAT_RGBAF, sd.to_byte_array()))
	out.villages = villages
	out.river = river
	out.tm = tm
	out.count = {segs = segs.size(), entries = entries.size(), villages = villages.size()}
	out.raw = raw
	out.thr = thr
	return out

static func _save_cache(l: Layout) -> void:
	var r := Resource.new()
	r.set_meta("v", {macro = l.macro.get_image(), grid = l.grid.get_image(), segs = l.segs.get_image(), villages = l.villages, river = l.river,
		raw = l.raw, thr = l.thr, count = l.count})
	ResourceSaver.save(r, CACHE, ResourceSaver.FLAG_COMPRESS)

static func _load_cache() -> Layout:
	if not ResourceLoader.exists(CACHE):
		return null
	var r = ResourceLoader.load(CACHE, "", ResourceLoader.CACHE_MODE_IGNORE)
	if r == null or not r.has_meta("v"):
		return null
	var v: Dictionary = r.get_meta("v")
	var l := Layout.new()
	l.macro = ImageTexture.create_from_image(v.macro)
	l.grid = ImageTexture.create_from_image(v.grid)
	l.segs = ImageTexture.create_from_image(v.segs)
	l.villages = v.villages
	l.river = v.river
	l.raw = v.raw
	l.thr = v.thr
	l.count = v.count
	return l

# ---------------------------------------------------------------------------------------------------------
# The colours: sRGB as you'd pick them, made linear for the shader
static func lin(hex: String) -> String:
	var c := Color.html(hex).srgb_to_linear()
	return "vec3(%.4f, %.4f, %.4f)" % [c.r, c.g, c.b]
# (how common each crop is: pickCrop below; the far colour of a field is their mix in these proportions)
const CROP_SHARE := [0.2, 0.13, 0.15, 0.14, 0.07, 0.06, 0.04, 0.08, 0.08, 0.05]
static func mean(list: Array) -> String:
	var c := Color(0, 0, 0)
	for i in list.size():
		var l := Color.html(list[i]).srgb_to_linear()
		c += Color(l.r * CROP_SHARE[i], l.g * CROP_SHARE[i], l.b * CROP_SHARE[i], 0)
	return "vec3(%.4f, %.4f, %.4f)" % [c.r, c.g, c.b]
static func arr(name: String, list: Array) -> String:
	return "const vec3 %s[%d] = vec3[%d](%s);" % [name, list.size(), list.size(), ", ".join(list.map(lin))]
# summer: wheat and barley ripening, potatoes and beet, clover, meadow, hay cut, fallow
const SUMMER := ["#a8935a", "#9a8a54", "#80834a", "#566238", "#5c6a3a", "#5f6e3d", "#687642", "#938a56", "#7a744a", "#6e5d42"]
# mid-October: ploughed loess, darker plough, stubble, the winter corn just through, beet and potatoes, clover, meadow, fallow, grey limestone soil
const AUTUMN := ["#76593f", "#664d38", "#958560", "#73704c", "#56603a", "#5b673c", "#626c42", "#7c744e", "#857a62", "#6e4f3c"]

## groundColour: the ground's colour at p (the JS's GROUND_GLSL), its {NAMES} filled in by ground_shader.
const GROUND_GLSL := """
uniform sampler2D uMacro : filter_linear_mipmap, repeat_enable;
uniform highp sampler2D uGrid : filter_nearest;
uniform highp sampler2D uSegs : filter_nearest;
uniform vec3 uCity; // the target town (x, z, radius) in the ground's frame: no woods or lanes of ours there
uniform vec3 uSunL; // towards the sun, in the ground's frame
uniform float uSeason;
const float MAC = {MAC};
{CS}
{CA}
const vec3 CSM = {CSM}, CAM = {CAM};
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// value noise wrapping every n cells (n lattice cells across the layout)
float vn(vec2 q, float n) { vec2 i = floor(q), f = fract(q), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(mod(i, n)), h12(mod(i + vec2(1, 0), n)), u.x), mix(h12(mod(i + vec2(0, 1), n)), h12(mod(i + vec2(1, 1), n)), u.x), u.y); }
float fbm(vec2 pt, float n) { return 0.55 * vn(pt * n / MAC, n) + 0.3 * vn(pt * 2.0 * n / MAC, 2.0 * n) + 0.15 * vn(pt * 4.0 * n / MAC, 4.0 * n); }
vec3 crop(float i) { int k = int(i); return mix(CS[k], CA[k], uSeason); }
// how much of a pixel (fw m across) a line half hw wide covers at distance d (thinner than a pixel: fainter, not gone)
float lineCov(float d, float hw, float fw) { float w = max(hw, 0.5 * fw); return smoothstep(w + 0.5 * fw, w - 0.5 * fw, d) * min(1.0, hw / w); }
const float VC = 819.2;
// which crop, by how common it is (mid-October: mostly ploughed and stubble, the winter corn coming up)
float pickCrop(float h) { return h < 0.2 ? 0.0 : h < 0.33 ? 1.0 : h < 0.48 ? 2.0 : h < 0.62 ? 3.0 : h < 0.69 ? 4.0 : h < 0.75 ? 5.0 : h < 0.79 ? 6.0 : h < 0.87 ? 7.0 : h < 0.95 ? 8.0 : 9.0; }
vec3 cropMean() { return mix(CSM, CAM, uSeason); }
// a Gewann: the rectangle of Voronoi cell cid (seed sp) that pt is in, cut by two to four splits in the
// cell's own turned frame. lc: its middle; lid: its hash; dk: m to its nearest split, nk the way to it; ax: the frame
void leafOf(vec2 pt, vec2 cid, vec2 sp, out vec2 lc, out float lid, out float dk, out vec2 nk, out vec2 ax) {
  float A = h12(cid + 0.71) * 3.1416;
  ax = vec2(cos(A), sin(A)); vec2 az = vec2(-ax.y, ax.x);
  vec2 q = vec2(dot(pt - sp, ax), dot(pt - sp, az));
  vec2 lo = vec2(-1e4), hi = vec2(1e4); float b = 1.0;
  float s1 = (h12(cid + 1.1) - 0.5) * 340.0;
  if (q.x < s1) hi.x = s1; else { lo.x = s1; b += 1.0; }
  float s2 = (h12(cid + b * 3.7 + 2.3) - 0.5) * 340.0;
  if (q.y < s2) hi.y = s2; else { lo.y = s2; b += 2.0; }
  if (h12(cid + b * 5.1 + 4.1) < 0.8) { float s3 = (lo.x < -9e3 ? hi.x - 120.0 - 220.0 * h12(cid + b * 1.9 + 6.7) : hi.x > 9e3 ? lo.x + 120.0 + 220.0 * h12(cid + b * 1.9 + 6.7) : mix(lo.x, hi.x, 0.5));
    if (abs(s3) < 9e3) { if (q.x < s3) hi.x = s3; else { lo.x = s3; b += 4.0; } } }
  if (h12(cid + b * 2.9 + 8.3) < 0.55) { float s4 = (lo.y < -9e3 ? hi.y - 120.0 - 220.0 * h12(cid + b * 2.3 + 9.1) : hi.y > 9e3 ? lo.y + 120.0 + 220.0 * h12(cid + b * 2.3 + 9.1) : mix(lo.y, hi.y, 0.5));
    if (q.y < s4) hi.y = s4; else { lo.y = s4; b += 8.0; } }
  lid = h12(cid * 1.37 + b * 7.77);
  vec4 e = vec4(q.x - lo.x, hi.x - q.x, q.y - lo.y, hi.y - q.y);
  dk = min(min(e.x, e.y), min(e.z, e.w));
  nk = dk == e.x ? -ax : dk == e.y ? ax : dk == e.z ? -az : az;
  vec2 c = (clamp(lo, -420.0, 420.0) + clamp(hi, -420.0, 420.0)) * 0.5;
  lc = sp + ax * c.x + az * c.y;
}
// (uSnowG: the snow, environment.gd SNOW; gWater out: how much of the pixel is water, for its gloss)
vec3 groundColour(vec2 p, float fw, float uSnowG, out float gWater) {
  vec2 pt = mod(p, MAC);
  vec4 M = texture(uMacro, pt / MAC);
  float city = smoothstep(uCity.z, uCity.z * 0.72, length(p - uCity.xy));
  // ---- the Gewann blocks: Voronoi cells (~800 m), each cut in its own turned frame into a few rectangles
  vec2 g = pt / VC, gi = floor(g), gf = fract(g);
  vec2 mr = vec2(0), mo = vec2(0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), r = o + 0.1 + 0.8 * h22(mod(gi + o, MAC / VC)) - gf; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mo = o; }
  }
  float ev = 8.0; vec2 nr = vec2(0), nv = vec2(1, 0), nid = vec2(0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = mo + vec2(float(i), float(j)), c = mod(gi + o, MAC / VC), r = o + 0.1 + 0.8 * h22(c) - gf, dd = r - mr;
    if (dot(dd, dd) > 1e-5) { float e = dot(0.5 * (mr + r), normalize(dd)); if (e < ev) { ev = e; nr = r; nv = normalize(dd); nid = c; } }
  }
  ev *= VC;
  vec2 cid = mod(gi + mo, MAC / VC), sp = pt + mr * VC;
  vec2 lc, ax, nk, nlc, nax, nnk; float lid, dk, nlid, ndk;
  leafOf(pt, cid, sp, lc, lid, dk, nk, ax);
  // the Gewann over the nearest edge (a split of this cell's, or the next cell's)
  float ed; vec2 nn;
  if (dk < ev) { ed = dk; nn = nk; leafOf(pt + nk * (dk + 2.0), cid, sp, nlc, nlid, ndk, nnk, nax); }
  else { ed = ev; nn = nv; leafOf(pt + nv * (ev + 2.0), nid, pt + nr * VC, nlc, nlid, ndk, nnk, nax); }
  vec2 hb = h22(vec2(lid * 61.7, lid * 13.1)); float hb2 = h12(vec2(lid * 37.3, 1.7)), hb3 = h12(vec2(lid * 17.9, 4.3));
  // ---- woods: whole Gewanne mostly (the woods' edges are the parcels' edges), a little ragged
  float fp = M.r, fN = (fbm(pt, 400.0) - 0.5) * 0.2;
  float fb = texture(uMacro, lc / MAC).r, fnb = texture(uMacro, nlc / MAC).r;
  float fv = 0.75 * fb + 0.25 * fp + fN - city, fvN = 0.75 * fnb + 0.25 * fp + fN - city;
  float aa = 0.012 + fw * 0.0004;
  float wood = smoothstep(0.5 - aa, 0.5 + aa, fv);
  // ---- the strips, in groups (one owner's, one crop), most groups in the Gewann's own crop
  vec2 dir = hb.x < 0.5 ? ax : vec2(-ax.y, ax.x);
  float w = hb2 > 0.93 ? mix(35.0, 70.0, hb3) : mix(6.0, 22.0, hb2 * hb2);
  float W = w * floor(2.0 + hb3 * 5.0);
  float u = dot(pt - lc, dir), su = u / w, s = floor(su), sf = fract(su), gs = floor(u / W);
  float meadowB = step(hb.y, M.g * 1.6 - 0.2);
  float base = meadowB > 0.5 ? 6.0 : pickCrop(hb3);
  float hg = h12(vec2(gs, lid * 91.3)), hg2 = h12(vec2(gs + 0.37, lid * 53.1));
  float gc = (hg < 0.68 || meadowB > 0.5) ? base : pickCrop(hg2);
  float hs = h12(vec2(s, lid * 71.0)), hs2 = h12(vec2(s + 0.5, lid * 29.0));
  float ci = hs < 0.85 ? gc : pickCrop(hs2);
  float tone = 0.9 + 0.2 * hs2;
  vec3 strip = crop(ci) * tone * (0.94 + 0.12 * hg2);
  // soil and crop: wetter and drier patches, furrows along the strip, the grass baulk between strips
  float soil = 0.9 + 0.2 * fbm(pt, 1600.0) * (1.0 - smoothstep(4.0, 30.0, fw));
  strip *= soil;
  // (close to, the crop is never even: thicker and thinner growth in streaks down the strip, the drill rows)
  float along = dot(pt - lc, vec2(-dir.y, dir.x));
  strip *= 1.0 + (vn(vec2(u / 2.2, along / 26.0) + lid * 97.0, 8192.0) - 0.5) * 0.22 * (1.0 - smoothstep(0.8, 3.0, fw));
  float plough = step(ci, 1.5) + step(8.5, ci);
  strip *= 1.0 - plough * 0.09 * sin(u * 7.0) * (1.0 - smoothstep(0.15, 0.4, fw));
  float bd = min(sf, 1.0 - sf) * w;
  strip = mix(strip, crop(6.0) * 0.9, lineCov(bd, 0.4, fw) * 0.6);
  vec3 grp = (crop(gc) * 0.85 + cropMean() * 0.15) * (0.94 + 0.12 * hg2); // (its strips' colours, mixed: 85% the group's crop)
  vec3 col = mix(strip, grp, smoothstep(0.25 * w, 0.9 * w, fw));
  col = mix(col, (crop(base) * 0.58 + cropMean() * 0.42), smoothstep(0.25 * W, 0.9 * W, fw));
  // the country's slow changes of colour: soils, wetter and drier ground (a few km across)
  col *= 0.88 + 0.24 * fbm(pt, 14.0);
  // ---- field tracks along some Gewann edges (with a grassy verge)
  float track = step(h12(vec2(lid + nlid, lid * nlid * 7.0)), 0.5) * (1.0 - wood);
  col = mix(col, crop(6.0) * 0.85, lineCov(ed, 2.6, fw) * track * 0.6);
  col = mix(col, {TRACK} * (0.92 + 0.08 * hs), lineCov(ed, 1.3, fw) * track * 0.85);
  // lone trees in the fields and on the baulks
  float tc = 64.0; vec2 tq = pt / tc, ti = floor(tq); float th = h12(mod(ti, MAC / tc) + 5.1);
  if (th < 0.05 && fw < 6.0) { vec2 to = (ti + 0.2 + 0.6 * h22(ti + 2.0)) * tc; float tr = 3.5 + 3.0 * h12(ti + 8.0);
    float d = length(pt - to); col = mix(col, {TREE1} * (1.0 + 0.4 * dot(normalize(pt - to + 1e-4), uSunL.xz)), smoothstep(tr + fw, tr - fw, d) * (1.0 - wood)); }
  // ---- the woods: each stand (block) its own mix of beech, oak and pine; crowns lit on the sun's side
  {
    float con = clamp(vn(pt * 40.0 / MAC, 40.0) * 1.4 - 0.3 + (hb.y - 0.5) * 0.8, 0.0, 1.0);
    vec3 dec = mix({DEC0}, mix({DEC1}, {DEC2}, hb.x), uSeason);
    vec3 fcol = mix(dec, {CON}, con);
    vec3 fmean = fcol * 0.74;
    if (fw < 4.0) {
      float cs = 6.4; vec2 cq = pt / cs, cf = fract(cq), cqi = floor(cq); float cm = 8.0; vec2 co = vec2(0); float ch = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 o = vec2(float(i), float(j)), r = o + 0.15 + 0.7 * h22(mod(cqi + o, MAC / cs)) - cf; float d = dot(r, r); if (d < cm) { cm = d; co = r; ch = h12(mod(cqi + o, MAC / cs)); } }
      float lit = 0.75 + 0.5 * dot(normalize(-co + 1e-4), uSunL.xz) * smoothstep(0.0, 0.5, sqrt(cm));
      vec3 crown = mix(fcol * (0.8 + 0.4 * ch), (ch < con ? {CON2} : fcol * 1.15), 0.4) * lit * (1.0 - 0.45 * smoothstep(0.35, 0.8, sqrt(cm)));
      fcol = mix(crown, fmean, smoothstep(1.0, 4.0, fw));
    } else fcol = fmean;
    fcol *= 0.85 + 0.3 * vn(pt * 600.0 / MAC, 600.0) * (1.0 - smoothstep(20.0, 60.0, fw));
    // (the canopy's grain further off: clumps of crowns and the gaps between, after the single crowns are too small to see)
    fcol *= 1.0 + (fbm(pt, 3200.0) - 0.5) * 0.5 * smoothstep(1.5, 5.0, fw) * (1.0 - smoothstep(18.0, 45.0, fw));
    col = mix(col, fcol, wood);
  }
  // the woods' shadow over the field beside them (the trees 22 m tall, the sun where it is)
  float slen = clamp(22.0 * length(uSunL.xz) / max(uSunL.y, 0.08), 0.0, 140.0);
  float sw = smoothstep(0.5 - aa, 0.5 + aa, fvN) * (1.0 - wood) * step(0.0, dot(nn, uSunL.xz));
  col *= 1.0 - 0.45 * sw * smoothstep(slen * dot(nn, normalize(uSunL.xz + 1e-4)) + fw, slen * dot(nn, normalize(uSunL.xz + 1e-4)) * 0.6 - fw, ed);
  // ---- the streams, the river and the roads (to the line, from the segments that pass near this cell)
  float dw = 1e4, hww = 0.0, dr = 1e4, hwr = 0.0, rk = 0.0;
  ivec2 cel = ivec2(floor(pt / {CELL}));
  for (int k = 0; k < 2; k++) {
    vec4 ids = texelFetch(uGrid, ivec2(cel.x * 2 + k, cel.y), 0);
    for (int q = 0; q < 4; q++) {
      float fi = ids[q];
      if (fi < 0.0) break;
      int t = int(fi + 0.5) * 2;
      vec4 a = texelFetch(uSegs, ivec2(t % {SEGW}, t / {SEGW}), 0), b = texelFetch(uSegs, ivec2((t + 1) % {SEGW}, (t + 1) / {SEGW}), 0);
      vec2 pa = pt - a.xy, ba = a.zw - a.xy; float d = length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
      if (b.y < 0.5) { if (d - b.x < dw - hww) { dw = d; hww = b.x; } }
      else if (d - b.x < dr - hwr) { dr = d; hwr = b.x; rk = b.y; }
    }
  }
  float keep = 1.0 - city;
  // the alders and willows along the water, the fruit trees along the roads: crowns in a row
  float tq2 = 9.0; vec2 aq = pt / tq2, af = fract(aq) - 0.5; float ah = h12(mod(floor(aq), MAC / tq2));
  float crownD = length(af + (h22(floor(aq)) - 0.5) * 0.5) * tq2;
  float band = smoothstep(hww + 14.0, hww + 9.0, dw) * step(1.5, dw - hww) * step(0.35, ah) + smoothstep(hwr + 9.0, hwr + 6.0, dr) * step(hwr + 3.5, dr) * step(0.45, ah) * step(1.5, rk);
  col = mix(col, {ALDER} * (0.9 + 0.3 * ah), band * keep * (fw < 5.0 ? smoothstep(4.0, 2.4, crownD) : 0.35) * (1.0 - wood * 0.7));
  float wc = lineCov(dw, hww, fw) * keep;
  col = mix(col, crop(6.0) * 0.8, lineCov(dw, hww + 4.0, fw) * keep * 0.6); // (the wet grass of the banks)
  col = mix(col, {WATER}, wc);
  gWater = wc;
  float rc = lineCov(dr, hwr, fw) * keep;
  col = mix(col, rk > 1.5 ? {ROAD2} : {ROAD1}, rc);
  // ---- snow: the fields white (the furrows and baulks just showing), the woods dark through it, the
  // roads trodden grey, the water dark
  // (the scene's light and grading are cool: the ground's own colour kept rich and warm under them)
  col = max(mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 1.18) * vec3(1.06, 0.99, 0.86), 0.0);
  if (uSnowG > 0.0) {
    // (thinner on the stubble and the ridges of the ploughland, so the strips still show; the woods dark through it)
    vec3 snow_c = vec3(0.79, 0.81, 0.84) * (0.86 + 0.09 * hg2 + 0.05 * hs2) * (1.0 - 0.1 * plough * (1.0 - smoothstep(0.2 * w, 0.9 * w, fw)));
    float cover = 1.0 - wood * 0.72 - wc * 0.8 - rc * 0.15 - band * 0.6 - 0.25 * lineCov(ed, 1.3, fw) * track;
    col = mix(col, snow_c, uSnowG * cover);
  }
  return col;
}
"""

## The ground's shader: groundColour (GROUND_GLSL) with the colours and sizes filled
## in, lit as the standard material was (roughness 1, the water glossy), hazed by aerial's fog.
static var _ground_shader: Shader
static func ground_shader() -> Shader:
	if _ground_shader:
		return _ground_shader
	Env.globals()
	var glsl := GROUND_GLSL.format({
		MAC = "%.1f" % MACRO, CS = arr("CS", SUMMER), CA = arr("CA", AUTUMN), CSM = mean(SUMMER), CAM = mean(AUTUMN),
		CELL = "%.1f" % CELL, SEGW = str(SEGW),
		TRACK = lin("#9d927a"), TREE1 = lin("#3b4527"), DEC0 = lin("#46542a"), DEC1 = lin("#7a5e30"), DEC2 = lin("#5e5a2c"),
		CON = lin("#2e3a25"), CON2 = lin("#2a3522"), ALDER = lin("#3a4428"), WATER = lin("#3c4b4d"), ROAD2 = lin("#8e8b82"), ROAD1 = lin("#a39a83"),
	})
	var sh := Shader.new()
	sh.code = """shader_type spatial;
render_mode blend_mix, cull_back, depth_draw_opaque;
uniform vec2 uOrigin;
varying vec2 vGround;
global uniform float snow;
global uniform float air;
global uniform vec3 fog_col;
global uniform float fog_dens;
uniform float env_ao = 0.4; // (envMapIntensity 0.3: the sky's light on the ground turned down, as in the JS)
%s
void vertex() {
  vGround = VERTEX.xz - uOrigin;
}
void fragment() {
  float gfw = max(length(fwidth(vGround)), 0.02);
  float gWater;
  ALBEDO = groundColour(vGround, gfw, snow, gWater);
  ROUGHNESS = mix(1.0, 0.2, gWater);
  METALLIC = 0.0;
  AO = env_ao;
  AO_LIGHT_AFFECT = 0.0;
  float fog_d = length(VERTEX);
  FOG = vec4(fog_col, max(1.0 - exp(-fog_dens * fog_dens * fog_d * fog_d), 1.0 - exp(-air * fog_dens * fog_d)));
}
""" % glsl
	_ground_shader = sh
	return sh

## The ground: 400 km of it under the formation, drawn by groundColour. Its uniforms (Three's userData.ground):
## uOrigin, where the layout's 0, 0 is, in the ground's frame (the countryside's group position: it moves as the
## ground scrolls); uCity, the target town; uSunL, towards the sun in the ground's frame; uSeason.
static func ground_material(layout: Layout) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = ground_shader()
	m.set_shader_parameter("uMacro", layout.macro)
	m.set_shader_parameter("uGrid", layout.grid)
	m.set_shader_parameter("uSegs", layout.segs)
	m.set_shader_parameter("uOrigin", Vector2())
	m.set_shader_parameter("uCity", Vector3(0, 0, -1))
	m.set_shader_parameter("uSunL", Vector3(0, 1, 0))
	m.set_shader_parameter("uSeason", 1.0)
	return m

## The haze over the ground on material m: the scene's fog, and over it a veil that grows with distance from
## the first metre (exponential, not the fog's squared falloff that leaves the near ground untouched), so the
## ground five miles below lies under a light blue-grey haze, the far country under a thick one. (And lit by the
## sky as the ground is: envMapIntensity at most 0.3, not tinted blue by it.)
static func aerial(m: Material) -> Material:
	var r := Env.hook(m, {air = true})
	if r is ShaderMaterial:
		r.set_shader_parameter("env_ao", 0.4)
	return r
