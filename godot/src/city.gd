extends RefCounted
# The target: Schweinfurt, a German industrial town on the Main. Its ball-bearing works (the Kugelfischer
# and VKF plants) are the aiming point, with the halls, sheds, chimneys and power house round them, and the
# marshalling yard along their south side. North of the river (three bridges) is the old town round its
# church spire and market square. Round all that, the town itself (urban.gd): districts of streets each at
# its own angle, closed blocks round courtyards in the middle, terraces and then houses in gardens further
# out, factory halls by the railways, the outline ragged along the main roads and out to its suburbs.
# Near the middle every building is one instance (walls, and a roof), so the town costs a handful of
# draw calls; the rest is painted with its roofs' shadows. Bombs wreck what they land near.

const Env := preload("res://src/environment.gd")
const Bomber := preload("res://src/bomber.gd")
const Urban := preload("res://src/urban.gd")
const Ground := preload("res://src/ground.gd")
const River := preload("res://src/river.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")

static func river_z(x: float) -> float:
	return River.river_z(x)
static func main_z(x: float) -> float:
	return River.main_z(x)

const SIZE := 2400 # m across
const BLAST := 38.0 # m: a building this close to a hit is wrecked
const FACTORY := {x0 = -420, x1 = 420, z0 = -300, z1 = 260} # the works, round the aiming point (0, 0)
const RAIL := {z0 = 290, z1 = 405}
const OLD_TOWN := {x = -250, z = -900, r = 300}
const BRIDGES := [-760, -60, 620]
const RIVER_W := 70.0

static var _seed := 1944
static func rnd() -> float:
	_seed = (_seed * 16807) % 2147483647
	return float(_seed) / 2147483647.0
static func rand(a: float, b: float) -> float:
	return a + rnd() * (b - a)
static func pick(a: Array):
	return a[floori(rnd() * a.size())]

# ---- round the town: the Main valley, the railways and roads out of it, the suburbs (16 km across) ----
const REGION := 24000.0
const REGION_TEX := 2048

## A line carried on out the way its last stretch runs, to `to` m from the town (the railways and roads out into the country).
static func onward(l: Array, to := 12000.0) -> Array:
	var ax: float = l[l.size() - 2][0]
	var az: float = l[l.size() - 2][1]
	var bx: float = l[l.size() - 1][0]
	var bz: float = l[l.size() - 1][1]
	var L := Vector2(bx - ax, bz - az).length()
	var k := maxf(0, to - Vector2(bx, bz).length())
	return l + [[bx + ((bx - ax) / L) * k * 0.5 + ((bz - az) / L) * k * 0.08, bz + ((bz - az) / L) * k * 0.5 - ((bx - ax) / L) * k * 0.08], [bx + ((bx - ax) / L) * k, bz + ((bz - az) / L) * k]]

## The main lines out of the marshalling yard (double track): west to Gemünden, south-west over the Main
## to Würzburg, north to Bad Kissingen, east to Bamberg. Each a list of points, m, from the yard out.
static var RAILWAYS: Array = _railways()
static func _railways() -> Array:
	var yz: float = (RAIL.z0 + RAIL.z1) / 2.0
	var line := func(x0: float, pts: Array) -> Array: return [[x0, yz]] + pts
	return [
		line.call(-700, [[-2400, yz + 40], [-3800, yz + 300], [-5600, yz + 900], [-8000, yz + 1500]]), # Gemünden
		line.call(-700, [[-2000, yz - 100], [-2700, -600], [-3200, -2200], [-3900, -4400], [-4800, -8000]]), # Würzburg, over the river
		line.call(-700, [[-1700, yz + 300], [-2000, 1600], [-2100, 3600], [-1800, 6000], [-1500, 8000]]), # Bad Kissingen
		line.call(700, [[2600, yz + 60], [4200, yz - 300], [6000, -900], [8000, -1700]]), # Bamberg
	].map(onward)
static var ROADS: Array = [[[0, -1200], [400, -3500], [1500, -8000]], [[-1000, -300], [-4500, -800], [-8000, -1800]], [[1000, -600], [4000, -2600], [8000, -4500]],
	[[300, 1200], [900, 4000], [2400, 8000]], [[-800, 1000], [-4400, 4200], [-7000, 8000]], [[1100, 900], [5200, 2600], [8000, 4800]]].map(onward)

## (a polyline on a canvas: X maps metres to its pixels)
static func _path(g, pts: Array, X: Callable) -> void:
	g.begin_path()
	for i in pts.size():
		if i:
			g.line_to(X.call(pts[i][0]), X.call(pts[i][1]))
		else:
			g.move_to(X.call(pts[i][0]), X.call(pts[i][1]))

## The ground round the town (under its own): see REGION.
static func region_texture() -> Texture2D:
	var g := Canvas2D.new(REGION_TEX, REGION_TEX)
	var s := REGION_TEX / REGION
	var X := func(m: float) -> float: return REGION_TEX / 2.0 + m * s
	g.clear_rect(0, 0, REGION_TEX, REGION_TEX)
	# the main roads out of town: pale, metalled
	g.stroke_style = "#a89c84"; g.line_cap = "round"; g.line_join = "round"; g.line_width = maxf(3, 18 * s)
	for r in ROADS:
		_path(g, r, X); g.stroke()
	# (the Main itself is a ribbon of its own: river_ribbon)
	# the railways: a grey ballast bed, two dark tracks on it
	for r in RAILWAYS:
		for wc in [[34, "#8f846f"], [16, "#3a332b"]]:
			g.stroke_style = wc[1]; g.line_width = maxf(4 if wc[0] == 34 else 2, wc[0] * s)
			_path(g, r, X); g.stroke()
	# fade out at the edge into the countryside
	g.global_composite_operation = "destination-in"
	var edge = g.create_radial_gradient(REGION_TEX / 2.0, REGION_TEX / 2.0, REGION_TEX * 0.3, REGION_TEX / 2.0, REGION_TEX / 2.0, REGION_TEX * 0.5)
	edge.add_color_stop(0, "#000"); edge.add_color_stop(1, "#0000")
	g.fill_style = edge; g.fill_rect(0, 0, REGION_TEX, REGION_TEX)
	return g.texture(true)

## The Main, out of the town and on across the country 30 km each way (the ground's own streams and roads
## run under it): its water meadows, a wet green fading out at their edge, and the water, glinting.
static func river_ribbon() -> Node3D:
	var group := Node3D.new()
	var R := 30000.0
	var band := func(half: float, fade: float, col: String, y: float, rough: float, prio: int) -> MeshInstance3D:
		var pos := PackedFloat64Array()
		var cols := PackedFloat64Array()
		var idx := PackedInt32Array()
		var x := -R
		var k := 0
		while x <= R:
			var z := main_z(x)
			var dz := (main_z(x + 1) - main_z(x - 1)) / 2
			var L := Vector2(1, dz).length()
			var nx := -dz / L
			var nz := 1 / L
			var end := minf(1, (R - absf(x)) / 3000)
			for oa in [[-half - fade, 0], [-half, 1], [half, 1], [half + fade, 0]]:
				pos.append_array([x + nx * oa[0], y, z + nz * oa[0]])
				cols.append_array([1, 1, 1, oa[1] * end]) # (the colour's the material's: the vertices only fade it out)
			if k:
				for q in 3:
					var a0 := (k - 1) * 4 + q
					var b0 := k * 4 + q
					idx.append_array([a0, a0 + 1, b0, a0 + 1, b0 + 1, b0]) # (wound to face up: the snow lies on it)
			x += 60
			k += 1
		var geo = Geo.from_arrays(pos, null, null, idx, cols, 4)
		geo.compute_vertex_normals()
		var m := MeshInstance3D.new()
		var mat = Ground.aerial(Env.snowy(Mat.standard({color = col, vertexColors = true, transparent = true, depthWrite = false, roughness = rough}), 0.85 if rough > 0.5 else 0.0))
		mat.render_priority = prio # (renderOrder: the region under them, the town's own ground over them)
		m.mesh = geo.to_mesh(mat)
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.extra_cull_margin = 16384 # (frustumCulled = false)
		return m
	group.add_child(band.call(170, 140, "#4c5834", 0.25, 1, 2))
	group.add_child(band.call(RIVER_W / 2 + 6, 4, "#465036", 0.3, 1, 3))
	group.add_child(band.call(RIVER_W / 2, 2, "#34444a", 0.35, 0.22, 4))
	return group

# ---- the town itself (urban.gd), 7 km across, round the works, the yard and the old town ----
const URBAN := 7000.0
const URBAN_PX := 4096
const CORE := {x = -100, z = -350} # the middle of the town (between the old town and the works)
const SUBURBS := [[-2700, -2300, 420], [-2400, -2050, 300], [2400, 1900, 380], [2650, 2150, 260], [2900, -1700, 360], [2700, -1500, 260], [-2500, 2300, 330], [300, 2700, 300]] # [x, z, radius]: the villages it swallowed (two or three bumps each: not round)

## How built-up the town is at (x, z): thick in the middle, out along the main roads, round its suburbs.
static func city_density(x: float, z: float) -> float:
	if absf(z - main_z(x)) < RIVER_W / 2 + 30:
		return 0.0
	# not a disc: the town spreads along the river's north bank, round the old town and up the slope; the
	# works side is the factories, the yard and the workers' streets; out along the roads, and its swallowed villages
	var north := exp(-(pow((x + 350) / 2300, 2) + pow((z + 1150) / 1150, 2)) * 1.1)
	var works := 0.85 * exp(-(pow((x - 100) / 1700, 2) + pow((z - 450) / 750, 2)) * 1.2)
	var r := Vector2(x - CORE.x, z - CORE.z).length()
	var d := 1.08 * maxf(north, works)
	for road in ROADS:
		d = maxf(d, 0.6 * exp(-pow(Urban.dist_to_line(x, z, road) / 150, 2)) * exp(-r / 2600))
	for sb in SUBURBS:
		d = maxf(d, 0.58 * exp(-pow(Vector2(x - sb[0], z - sb[1]).length() / sb[2], 2)))
	return d

static func in_works(x: float, z: float) -> bool:
	return x > FACTORY.x0 - 50 and x < FACTORY.x1 + 50 and z > FACTORY.z0 - 50 and z < FACTORY.z1 + 30
static func in_yard(x: float, z: float) -> bool:
	return absf(x) < 1300 and z > RAIL.z0 - 30 and z < RAIL.z1 + 50
## The old town's wall line at angle a (m from its middle): wider east-west, never a circle.
static func ot_rim(a: float) -> float:
	return OLD_TOWN.r * (0.88 + 0.08 * sin(a * 3 + 1) + 0.05 * sin(a * 7 + 2)) * Vector2(1.22 * cos(a), 0.86 * sin(a)).length() / Vector2(cos(a), sin(a)).length()
static func in_old_town(x: float, z: float, pad := 20.0) -> bool:
	return Vector2(x - OLD_TOWN.x, z - OLD_TOWN.z).length() < ot_rim(atan2(z - OLD_TOWN.z, x - OLD_TOWN.x)) + pad

## The old town's lanes: the main street through it east to west, two more along it, crooked lanes across (seeded: the same every time).
static var OT_LANES: Array = _ot_lanes()
static func _ot_lanes() -> Array:
	var st := [77]
	var r := func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return float(st[0]) / 2147483647.0
	var R := func(a: float, b: float) -> float: return a + r.call() * (b - a)
	var O := OLD_TOWN
	var L := []
	var bend := func(pts: Array) -> Array:
		var out := []
		for i in pts.size():
			out.append([pts[i][0] + R.call(-14, 14), pts[i][1] + R.call(-14, 14)] if i and i < pts.size() - 1 else [pts[i][0], pts[i][1]])
		return out
	L.append({w = 11.0, pts = bend.call([[O.x - 420, O.z + 30], [O.x - 200, O.z + 40], [O.x, O.z + 40], [O.x + 200, O.z + 30], [O.x + 420, O.z + 20]])})
	for dz in [-120, 150]:
		L.append({w = 7.0, pts = bend.call([[O.x - 300, O.z + dz * 0.8], [O.x - 120, O.z + dz], [O.x + 100, O.z + dz * 1.05], [O.x + 300, O.z + dz * 0.8]])})
	for i in 8:
		var x: float = O.x - 300 + i * 86 + R.call(-20, 20)
		# (the four points' offsets drawn in the order the JS's array literal draws them)
		var p0 := [x + R.call(-30, 30), O.z - 260]
		var p1 := [x + R.call(-20, 20), O.z - 60]
		var p2 := [x + R.call(-25, 25), O.z + 100]
		var p3 := [x + R.call(-30, 30), O.z + 260]
		L.append({w = 5.5, pts = bend.call([p0, p1, p2, p3])})
	var ring := []
	for i in 41:
		var a := (i / 40.0) * PI * 2
		var m := ot_rim(a) - 12
		ring.append([O.x + cos(a) * m, O.z + sin(a) * m])
	L.append({w = 6.0, pts = ring})
	return L

## The town's ground texture, and the buildings near the middle (to stand in 3D on the same streets): the
## town painted (urban.gd), then over it the works, the yard and its tracks, the old town's lanes, the river,
## the railways out, and the roofs of `special` (the works, the yard's sheds, the old town: 3D already).
static func town_texture(special: Array) -> Dictionary:
	var u := Urban.paint_urban({
		size = URBAN, px = URBAN_PX, seed = 1944, density = city_density, threshold = 0.33, cell = 82, roads = ROADS,
		skip = func(x: float, z: float) -> bool: return in_works(x, z) or in_yard(x, z) or in_old_town(x, z),
		industrial = func(x: float, z: float) -> bool: # (by the yard and the works, not all down the lines)
			if absf(x) < 800 and z > -420 and z < 520:
				return true
			if Vector2(x, z).length() < 2000:
				for l in RAILWAYS:
					if Urban.dist_to_line(x, z, l) < 200:
						return true
			return false,
		keep = func(x: float, z: float) -> bool: return Vector2(x - CORE.x, z - CORE.z).length() < 1300,
	})
	var g = u.canvas
	var s := URBAN_PX / URBAN
	var X := func(m: float) -> float: return URBAN_PX / 2.0 + m * s
	var line := func(pts: Array, w: float, col: String) -> void:
		g.stroke_style = col; g.line_width = maxf(1.5, w * s); _path(g, pts, X); g.stroke()
	g.line_cap = "round"; g.line_join = "round"
	# the works: concrete aprons and yards
	g.fill_style = "#76695a"; g.fill_rect(X.call(FACTORY.x0 - 30), X.call(FACTORY.z0 - 30), (FACTORY.x1 - FACTORY.x0 + 60) * s, (FACTORY.z1 - FACTORY.z0 + 50) * s)
	# the marshalling yard: ballast, and its tracks fanning out of the main lines
	g.fill_style = "#5f564a"; g.fill_rect(X.call(-1300), X.call(RAIL.z0), 2600 * s, (RAIL.z1 - RAIL.z0) * s)
	g.stroke_style = "#2f2e2b"; g.line_width = maxf(1, 2.2 * s)
	for k in 14:
		var z: float = RAIL.z0 + 8 + k * 7.5
		g.begin_path(); g.move_to(X.call(-1300 + (k % 3) * 60), X.call(z)); g.line_to(X.call(1300 - (k % 4) * 50), X.call(z)); g.stroke()
	# the old town: packed inside its old wall line (a ring of trees now), its crooked lanes to the market
	var rim_path := func(pad: float) -> void:
		g.begin_path()
		for i in 73:
			var a := (i / 72.0) * PI * 2
			var m := ot_rim(a) + pad
			g.line_to(X.call(OLD_TOWN.x + cos(a) * m), X.call(OLD_TOWN.z + sin(a) * m))
	g.stroke_style = "#56603a"; g.line_width = 30 * s; rim_path.call(16); g.stroke()
	g.fill_style = "#5c5246"; rim_path.call(0); g.fill()
	for l in OT_LANES:
		line.call(l.pts, l.w, "#77716a")
	g.fill_style = "#857f74"; g.begin_path(); g.ellipse(X.call(OLD_TOWN.x), X.call(OLD_TOWN.z + 40), 46 * s, 30 * s, 0.1, 0, 7); g.fill() # the market square
	for i in 160: # (the promenade's trees)
		var a := (i / 160.0) * PI * 2
		var m := ot_rim(a) + 16 + (6 if i % 2 else -6)
		g.fill_style = "#46522c" if i % 3 else "#5a5a2c"; g.begin_path(); g.arc(X.call(OLD_TOWN.x + cos(a) * m), X.call(OLD_TOWN.z + sin(a) * m), 5 * s, 0, 7); g.fill()
	# the roofs of the works, the yard's sheds and wagons, the old town (each with its shadow, as the town's)
	for b in special:
		g.save(); g.translate(X.call(b.x), X.call(b.z)); g.rotate(b.rot)
		g.fill_style = "rgba(22, 20, 17, 0.45)"; g.fill_rect((-b.w / 2 + b.h * 0.18) * s, (-b.d / 2 + b.h * 0.28) * s, b.w * s, b.d * s)
		g.fill_style = "#%06x" % (b.roof if b.roof != null else b.col); g.fill_rect((-b.w / 2) * s, (-b.d / 2) * s, b.w * s, b.d * s)
		if b.get("saw", false):
			g.fill_style = "rgba(0,0,0,0.22)"
			var uu: float = -b.w / 2
			while uu < b.w / 2:
				g.fill_rect(uu * s, (-b.d / 2) * s, 2.5 * s, b.d * s)
				uu += 7
			g.fill_style = "rgba(200,210,220,0.12)"
			uu = -b.w / 2 + 3
			while uu < b.w / 2:
				g.fill_rect(uu * s, (-b.d / 2) * s, 1.2 * s, b.d * s)
				uu += 7
		if b.roof != null and b.rh > 3:
			g.fill_style = "rgba(20,12,8,0.24)"
			if b.w >= b.d:
				g.fill_rect((-b.w / 2) * s, 0, b.w * s, (b.d / 2) * s)
			else:
				g.fill_rect(0, (-b.d / 2) * s, (b.w / 2) * s, b.d * s)
		g.restore()
	# the river through the town, and the railways out of the yard (only where there's town: beyond, the country's own, region_texture)
	g.global_composite_operation = "source-atop"
	var river := []
	var x := -URBAN / 2
	while x <= URBAN / 2:
		river.append([x, main_z(x)])
		x += 30
	line.call(river, RIVER_W + 22, "#55604a"); line.call(river, RIVER_W, "#33424b")
	for r in RAILWAYS:
		line.call(r, 30, "#8f846f"); line.call(r, 14, "#3a332b")
	g.global_composite_operation = "source-over"
	return {texture = g.texture(true), buildings = u.buildings, tm = u.tm}

## A unit gable roof: ridge along Z, eaves at y 0, ridge at y 1.
static func gable():
	var s := Shapes.Shape.new([Vector2(-0.5, 0), Vector2(0.5, 0), Vector2(0, 1)])
	return Geo.extrude(s, {depth = 1, bevelEnabled = false}).translate(0, 0, -0.5)

var center: Vector3 # the aiming point, on the ground, in the formation's frame
var group: Node3D
var buildings: Array = []
var church := 0
var spire: MeshInstance3D
var walls: MultiMeshInstance3D
var roofs: MultiMeshInstance3D
var burning: Array = []
var build_ms := 0.0 # (how long the town took to make: the loading screen waits on it)
var tm := {}
var _scene: Node3D

## [x, z, w, d, h, colour, roof colour or null (flat), roof height, turned (rad, as the town's streets: urban.gd)]
func add(x: float, z: float, w: float, d: float, h: float, col: int, roof = null, rh := 0.0, rot := 0.0) -> void:
	buildings.append({x = x, z = z, w = w, d = d, h = h, col = col, roof = roof, rh = rh, rot = rot, alive = true})

func _init(scene: Node3D, center_: Vector3) -> void:
	var t0 := Time.get_ticks_usec()
	_seed = 1944
	center = center_
	_scene = scene
	group = Node3D.new()
	group.name = "city"
	var b := buildings
	const PLASTER := [0x9a8d72, 0x8e7f64, 0xa39883, 0x82775f, 0x958569]
	const TILE := [0x8e4a33, 0x7e432f, 0x8a5038, 0x94563c, 0x76463a]
	const SLATE := [0x3d3f44, 0x46484b, 0x4a423c]
	const BRICK := [0x7a5444, 0x6c4a3c, 0x85624f]
	const WORKS := [0x8a7f6e, 0x7c7366, 0x948a78]

	# the works: big assembly halls with low pitched roofs, long sheds, workshops, chimneys, a power house
	for z in [-170, -60]:
		for x in [-300, -100, 100, 300]:
			add(x, z, 130, 55, 16, pick(WORKS), 0x50524f, 4)
	for x in [-280, -60, 160]:
		add(x, 80, 180, 35, 12, pick(WORKS), 0x5b5c58, 3)
	add(360, 185, 60, 40, 26, pick(BRICK))
	for i in 6:
		add(rand(-380, 380), rand(130, 240), 6, 6, rand(40, 60), 0x6a4a3c)
	for i in 40:
		add(rand(-400, 300), rand(150, 245), rand(15, 40), rand(10, 25), rand(6, 10), pick(WORKS))
	for i in 20:
		add(rand(-400, 400), rand(-290, -240), rand(12, 30), rand(8, 18), rand(5, 9), pick(WORKS))
	# and the works packed with more of them: sawtooth-roofed shops in rows between the big halls, a yard track or two
	var taken := b.duplicate()
	var overlaps := func(x: float, z: float, w: float, d: float) -> bool:
		for q in taken:
			if absf(q.x - x) < (q.w + w) / 2 + 6 and absf(q.z - z) < (q.d + d) / 2 + 6:
				return true
		return false
	for i in 400:
		var w := rand(30, 90)
		var d := rand(18, 40)
		var x := rand(FACTORY.x0 + w / 2, FACTORY.x1 - w / 2)
		var z := rand(FACTORY.z0 + d / 2, FACTORY.z1 - d / 2)
		if overlaps.call(x, z, w, d):
			continue
		var h := rand(8, 12)
		var col: int = pick(WORKS)
		add(x, z, w, d, h, col, pick([0x5a5c58, 0x626360, 0x56544f]), 2.5)
		b[b.size() - 1].saw = true
		taken.append(b[b.size() - 1])

	# the rail yard: wagons on the tracks, the goods sheds and the engine shed
	for i in 150:
		var x := rand(-1000, 1000)
		var z: float = RAIL.z0 + 8 + floorf(rand(0, 14)) * 7.5
		add(x, z, rand(10, 15), 3, 3.6, pick([0x5a3a2c, 0x4a4038, 0x3c3a36]))
	add(-700, RAIL.z1 + 22, 140, 26, 9, pick(BRICK), 0x4d5056, 4)
	add(720, RAIL.z1 + 25, 90, 34, 14, pick(BRICK), 0x44464a, 5)

	# the old town: crowded houses with steep tiled roofs, the church and its spire on the market
	var OT := OLD_TOWN
	var occ := {}
	var cell := func(x: float, z: float) -> Vector2i: return Vector2i(roundi(x / 3), roundi(z / 3))
	var clear_of := func(x: float, z: float, w: float, d: float, rot: float, mark: bool) -> bool:
		var c := cos(rot)
		var sn := sin(rot)
		var uu := -w / 2 + 1
		while uu < w / 2:
			var v := -d / 2 + 1
			while v < d / 2:
				var k: Vector2i = cell.call(x + c * uu - sn * v, z + sn * uu + c * v)
				if mark:
					occ[k] = true
				elif occ.has(k):
					return false
				v += 2.5
			uu += 2.5
		return true
	var keep_clear := func(x: float, z: float) -> bool: return Vector2(x - OT.x, z - OT.z - 40).length() < 50 or Vector2(x - OT.x, z - OT.z + 40).length() < 42 or not in_old_town(x, z, -6)
	for l in OT_LANES:
		var p: Array = l.pts
		for k in p.size() - 1:
			clear_of.call((p[k][0] + p[k + 1][0]) / 2, (p[k][1] + p[k + 1][1]) / 2, Vector2(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]).length(), l.w, atan2(p[k + 1][1] - p[k][1], p[k + 1][0] - p[k][0]), true)
	var ot_house := func(x: float, z: float, w: float, d: float, rot: float, h: float, roof: int) -> bool:
		if keep_clear.call(x, z) or not clear_of.call(x, z, w, d, rot, false):
			return false
		clear_of.call(x, z, w, d, rot, true)
		var col: int = pick(PLASTER)
		add(x, z, w, d, h, col, roof, rand(5, 7), rot)
		return true
	for l in OT_LANES: # the houses shoulder to shoulder along each lane, gables to it
		var p: Array = l.pts
		for k in p.size() - 1:
			var ax: float = p[k][0]
			var az: float = p[k][1]
			var bx: float = p[k + 1][0]
			var bz: float = p[k + 1][1]
			var L := Vector2(bx - ax, bz - az).length()
			var tx := (bx - ax) / L
			var tz := (bz - az) / L
			var rot := atan2(tz, tx)
			var a := 0.0
			while a < L:
				var w := rand(8, 12)
				var d := rand(11, 15)
				for side in [-1, 1]:
					var nx: float = -tz * side
					var nz: float = tx * side
					var off: float = l.w / 2 + d / 2 + 0.6
					var h := rand(10, 15)
					var roof: int = pick(SLATE) if rnd() < 0.12 else pick(TILE)
					ot_house.call(ax + tx * (a + w / 2) + nx * off, az + tz * (a + w / 2) + nz * off, w - 0.3, d, rot, h, roof)
				a += w
	for i in 1400: # (the back houses and sheds in the yards)
		var x: float = OT.x + rand(-1.3, 1.3) * OT.r
		var z: float = OT.z + rand(-1, 1) * OT.r
		var w := rand(6, 12)
		var d := rand(5, 9)
		var rot := rand(-0.2, 0.2) + (0.0 if rnd() < 0.5 else PI / 2)
		var h := rand(5, 9)
		ot_house.call(x, z, w, d, rot, h, pick(TILE))
	add(OT.x, OT.z - 30, 22, 60, 20, 0xb9ad94, 0x4f4a44, 12) # the nave
	church = b.size()
	add(OT.x, OT.z - 66, 13, 13, 46, 0xb9ad94) # the tower (its spire is a mesh of its own)

	# the bridges over the river
	for x in BRIDGES:
		add(x, river_z(x), 16, RIVER_W + 40, 4, 0x8a8478)

	# trains on the main lines out of the yard: goods wagons in strings, on the straight stretches
	for t in [[-2300, -1500, (RAIL.z0 + RAIL.z1) / 2.0 + 30], [1400, 2400, (RAIL.z0 + RAIL.z1) / 2.0 + 30], [-2200, -1700, (RAIL.z0 + RAIL.z1) / 2.0 - 4]]:
		var x: float = t[0]
		while x < t[1]:
			if rnd() < 0.92:
				var z: float = t[2] + rand(-1, 1)
				add(x, z, 12, 3, 3.6, pick([0x5a3a2c, 0x4a4038, 0x3c3a36, 0x5c4a3a]))
			x += 14
	# the country round the town: the Main valley, the railways and roads out, the suburbs (under the town's own ground)
	var region := MeshInstance3D.new()
	var rmat = Ground.aerial(Env.snowy(Mat.standard({map = region_texture(), roughness = 1, transparent = true, depthWrite = false}), 0.85))
	rmat.render_priority = 1
	region.mesh = Geo.plane(REGION, REGION).to_mesh(rmat)
	region.rotation.x = -PI / 2
	region.position.y = 0.3
	region.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	group.add_child(region)
	group.add_child(river_ribbon())
	# the town round all that: painted, and near the middle its buildings in 3D on the same streets
	var tt := Time.get_ticks_usec()
	var town := town_texture(b)
	tm = town.tm.duplicate()
	tm.before = roundi((tt - t0) / 1000.0)
	tm.town = roundi((Time.get_ticks_usec() - tt) / 1000.0)
	for u in town.buildings:
		var hall: bool = u.kind == "hall"
		var col: int = pick(WORKS) if hall else pick(PLASTER)
		add(u.x, u.z, u.w, u.d, u.h, col, String(u.col).substr(1).hex_to_int(), 2.5 if hall else 5.0 if u.kind == "block" else 4.0, u.rot)
	var ground := MeshInstance3D.new()
	# (painted for the eye, lifted to the fields' brightness under the haze)
	var gmat = Ground.aerial(Env.snowy(Mat.standard({map = town.texture, color = Color(1.38, 1.34, 1.3), roughness = 1, transparent = true, depthWrite = false}), 0.7))
	gmat.render_priority = 5
	ground.mesh = Geo.plane(URBAN, URBAN).to_mesh(gmat)
	ground.rotation.x = -PI / 2
	ground.position.y = 0.5
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	group.add_child(ground)
	walls = _instanced(Geo.box(1, 1, 1).translate(0, 0.5, 0), Ground.aerial(Env.snowy(Mat.standard({roughness = 0.9, vertexColors = true}))), b.size())
	roofs = _instanced(gable(), Ground.aerial(Env.snowy(Mat.standard({roughness = 0.85, side = Mat.DOUBLE, vertexColors = true}))), b.size()) # (snow on the roofs in winter)
	for i in b.size():
		place(i)
	# the church spire
	var tower: Dictionary = b[church]
	spire = MeshInstance3D.new()
	spire.mesh = Geo.cone(7.5, 34, 8).translate(0, 17, 0).to_mesh(Ground.aerial(Mat.standard({color = 0x3f5a50, roughness = 0.6, metalness = 0.3})))
	spire.position = Vector3(tower.x, tower.h, tower.z)
	group.add_child(spire)

	group.position = center
	scene.add_child(group)
	burning = []
	build_ms = (Time.get_ticks_usec() - t0) / 1000.0

## (an InstancedMesh: a MultiMeshInstance3D with a colour each, never culled, its shadows on it)
func _instanced(geo, mat: Material, n: int) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = geo.to_mesh(mat)
	mm.instance_count = n
	var x := MultiMeshInstance3D.new()
	x.multimesh = mm
	x.extra_cull_margin = 16384 # (frustumCulled = false)
	group.add_child(x)
	return x

func place(i: int) -> void:
	var b: Dictionary = buildings[i]
	var turn: bool = b.w > b.d # the ridge runs along the long side
	# (turned as its street: urban.gd turns the canvas by rot, which about +Y is -rot)
	var basis := Basis(Vector3.UP, -b.rot)
	walls.multimesh.set_instance_transform(i, Transform3D(basis.scaled_local(Vector3(b.w, b.h if b.alive else b.h * 0.15, b.d)), Vector3(b.x, 0, b.z)))
	walls.multimesh.set_instance_color(i, Color.hex((b.col << 8) | 0xff) if b.alive else Color.hex(0x2e2a26ff))
	if b.roof != null and b.alive:
		var q := Basis(Vector3.UP, -b.rot + (PI / 2 if turn else 0.0))
		roofs.multimesh.set_instance_transform(i, Transform3D(q.scaled_local(Vector3(b.d if turn else b.w, b.rh, b.w if turn else b.d)), Vector3(b.x, b.h, b.z)))
		roofs.multimesh.set_instance_color(i, Color.hex((int(b.roof) << 8) | 0xff))
	else:
		roofs.multimesh.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))

var destroyed: int:
	get:
		var n := 0
		for b in buildings:
			if not b.alive:
				n += 1
		return n

## A bomb burst at p: wreck what's close. Returns how many buildings it took.
func blast(p: Vector3) -> int:
	var n := 0
	var l := group.to_local(p) # (in the town's own frame: turned with the ground)
	for i in buildings.size():
		var b: Dictionary = buildings[i]
		if not b.alive:
			continue
		var ox: float = l.x - b.x
		var oz: float = l.z - b.z
		var c := cos(b.rot)
		var sn := sin(b.rot) # (into the building's own frame)
		var dx := maxf(absf(ox * c + oz * sn) - b.w / 2, 0)
		var dz := maxf(absf(-ox * sn + oz * c) - b.d / 2, 0)
		if dx < BLAST and dz < BLAST and Vector2(dx, dz).length() < BLAST:
			b.alive = false
			place(i)
			n += 1
			burning.append({i = i, t = rand(40, 90), e = 0.0})
			if i == church:
				spire.visible = false
	return n

func update(dt: float, effects) -> void:
	center.z += Bomber.AIRSPEED * dt
	# (the centre is where the town is from the formation; the town hangs in the turned ground, drift)
	var parent := group.get_parent()
	if parent == _scene or not parent is Node3D:
		group.position = center
	else:
		group.position = (parent as Node3D).to_local(center)
		group.rotation.y = 0
	# wrecked buildings burn and smoke for a while (a few dozen fires at a time, spread through the list)
	var step := maxi(1, ceili(burning.size() / 50.0))
	for k in range(burning.size() - 1, -1, -1):
		var f: Dictionary = burning[k]
		f.t -= dt
		if f.t <= 0:
			burning.remove_at(k)
			continue
		if k % step:
			continue
		f.e -= dt * step
		if f.e > 0:
			continue
		f.e = rand(0.4, 0.9)
		var b: Dictionary = buildings[f.i]
		if effects:
			effects.ground_smoke(group.to_global(Vector3(b.x, b.h * 0.15 - group.position.y + center.y, b.z))) # (where the building is, the ground turned or not)

## What the mission map draws, in the town's own frame (m, aiming point at 0, 0).
var layout: Dictionary:
	get:
		return {size = SIZE, factory = FACTORY, rail = RAIL, old_town = OLD_TOWN, river_z = river_z, river_w = RIVER_W, bridges = BRIDGES}
