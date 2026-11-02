extends RefCounted
# The Republic P-47D Thunderbolt "razorback" as the 56th Fighter Group flew it in October 1943, built in
# code (no model file):
# - the deep, egg-shaped cowling of the R-2800 Double Wasp: the engine's two rows of cylinders behind the
#   round upper opening, the chin intake under it split in three (the oil coolers either side, the
#   turbocharger's air in the middle), the cowl flaps round its back edge;
# - the deep fuselage (the turbo's ducts run under the cockpit to the engine), the intercooler doors and
#   oil-cooler shutters on its sides, the waste gates under the wing root and the turbo's exhaust hood
#   under the rear fuselage, all streaking soot aft;
# - the framed canopy: the flat armoured windscreen and its quarter panes, the sliding hood, and behind it
#   the high spine that gave the razorback its name, with its small fixed windows;
# - the semi-elliptical wing on a real airfoil (15 % thick at the root, 9 % at the tip), four .50s in each
#   side, staggered; the tailplanes and the fin from the same airfoil;
# - the Curtiss Electric propeller of 1943, four narrow "toothpick" blades, 12 ft 2 in across;
# - painted by a shader: faded olive drab over neutral grey, panel lines, the 8th Air Force's white bands
#   (cowling front, fin and tailplanes), the star and bars (in the red surround of the summer, or the blue
#   that replaced it from August 1943: both were about that autumn), the 56th's white codes and a yellow
#   serial on the fin, different on each aircraft.
# Same frame as the other fighters: nose -Z, the prop's axis at y = 0, metres; 11.0 m long, 12.42 m span.

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")

# ---------- the shape

# the fuselage's stations: [z, half-width, top, height of the widest point, bottom]. Over the cockpit the top
# is cut away at the sill; behind it the spine (SPINE) stands on top
const FUSE := [
	[-4.33, 0.655, 0.69, -0.11, -0.89], [-4.26, 0.705, 0.75, -0.11, -0.97], [-4.05, 0.73, 0.785, -0.11, -1.01], [-3.5, 0.74, 0.8, -0.11, -1.03],
	[-2.8, 0.745, 0.81, -0.11, -1.045], [-2.2, 0.725, 0.83, -0.12, -1.055], [-1.5, 0.695, 0.86, -0.13, -1.06], [-0.86, 0.67, 0.9, -0.13, -1.06],
	[-0.2, 0.645, 0.92, -0.12, -1.045], [0.45, 0.615, 0.9, -0.1, -1.0], [1.3, 0.565, 0.84, -0.06, -0.9], [2.2, 0.495, 0.8, -0.01, -0.74],
	[3.1, 0.415, 0.76, 0.05, -0.55], [4.0, 0.325, 0.72, 0.12, -0.35], [4.8, 0.235, 0.68, 0.2, -0.14], [5.5, 0.145, 0.63, 0.28, 0.08],
	[6.0, 0.07, 0.57, 0.35, 0.27], [6.2, 0.012, 0.5, 0.41, 0.37],
]
# the razorback: [z, half-width, top] of the narrow spine from the hood back to the fin, standing on the fuselage
const SPINE := [[0.4, 0.375, 1.36], [0.9, 0.335, 1.3], [1.8, 0.265, 1.18], [2.8, 0.19, 1.04], [3.8, 0.12, 0.9], [4.6, 0.06, 0.8], [5.05, 0.015, 0.74]]
const SPINE_Y := 0.66
# the canopy: the windscreen's foot and top, the hood from there back to the spine; the sill, the hood's top
const WS_Z := -0.86
const WS_TOP_Z := -0.58
const HOOD_Z := 0.42
const SILL := 0.8
const HOOD_TOP := 1.36
# the cowl flaps: hinged at FLAP0, their trailing edges standing a little proud at FLAP1
const FLAP0 := -2.95
const FLAP1 := -2.62
# the wing: chord line at the root, dihedral; the semi-span; the quarter-chord line nearly straight
const WING_Y := -0.62
static var DIHEDRAL := tan(deg_to_rad(4.5))
const SEMI := 6.21
static func w_chord(s: float) -> float: return 2.84 * sqrt(maxf(0, 1 - pow(s / SEMI, 2.4)))
static func w_quarter(s: float) -> float: return -1.25 + 0.04 * s
static func wing_y(s: float) -> float: return WING_Y + s * DIHEDRAL
## The wing's leading edge at span s (the guns come out of it).
static func leading_edge(s: float) -> float: return w_quarter(s) - 0.25 * w_chord(s)
# the tailplane and the fin
static func t_chord(s: float) -> float: return 1.45 * sqrt(maxf(0, 1 - pow(s / 2.36, 2.6)))
static func t_quarter(s: float) -> float: return 5.0 + 0.05 * s
const TAIL_Y := 0.4
static func f_chord(s: float) -> float: return (1.95 - 0.5 * s) * sqrt(maxf(0, 1 - pow(s / 1.74, 5)))
static func f_trail(s: float) -> float: return 6.17 - 0.03 * s
const FIN_Y := 0.42
# the guns' spanwise stations, inboard to outboard (outboard of the main wheels, as in the real wing)
const P47_GUN_X := [2.55, 2.8, 3.05, 3.3]
const PROP_Z := -4.55 # the Curtiss Electric's plane and radius (12 ft 2 in)
const PROP_R := 1.855

## Catmull-Rom through table rows (the first column the key): the other columns at key z.
static func curve(rows: Array, z: float) -> Array:
	var n := rows.size()
	var i := 0
	while i < n - 2 and z > rows[i + 1][0]:
		i += 1
	var t := clampf((z - rows[i][0]) / (rows[i + 1][0] - rows[i][0]), 0, 1)
	var t2 := t * t
	var t3 := t2 * t
	var p0: Array = rows[maxi(0, i - 1)]
	var p1: Array = rows[i]
	var p2: Array = rows[i + 1]
	var p3: Array = rows[mini(n - 1, i + 2)]
	var out := []
	for c in range(1, p1.size()):
		var a: float = p0[c]; var b: float = p1[c]; var d: float = p2[c]; var e: float = p3[c]
		out.append(0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (3 * b - a - 3 * d + e) * t3))
	return out

## The fuselage at z: [half-width, top, widest at, bottom].
static func fuse(z: float) -> Array: return curve(FUSE, z)
static func spine_at(z: float) -> Array: return curve(SPINE, z)
static func pe(v: float, e: float) -> float: return signf(v) * pow(absf(v), e)
## The cowl flaps standing open a little: how much wider the section is at z.
static func flaps(z: float) -> float: return 1 + 0.03 * (z - FLAP0) / (FLAP1 - FLAP0) if z > FLAP0 and z < FLAP1 else 1.0

## A point on the fuselage's section at z, angle a (0 = the right side, going up over the top).
static func fuse_point(z: float, a: float) -> Vector3:
	var f4 := fuse(z)
	var hw: float = f4[0]; var top: float = f4[1]; var mid: float = f4[2]; var bot: float = f4[3]
	var c := cos(a); var s := sin(a); var f := flaps(z)
	var n := 2.25 if z < FLAP1 else 2.4 # (the cowling rounder, the fuselage's sides flatter)
	return Vector3(hw * f * pe(c, 2 / n), mid + (top - mid if s >= 0 else mid - bot) * f * pe(s, 2 / n), z)

## The skin's height at z, x across: on top (up) or underneath.
static func skin_y(z: float, x: float, up: bool) -> float:
	var f4 := fuse(z)
	var hw: float = f4[0]; var top: float = f4[1]; var mid: float = f4[2]; var bot: float = f4[3]
	var n := 2.25 if z < FLAP1 else 2.4
	var f := flaps(z)
	var k := pow(maxf(0, 1 - pow(minf(1, absf(x) / (hw * f)), n)), 1 / n)
	return mid + (top - mid) * f * k if up else mid - (mid - bot) * f * k

## Indexed grid geometry from rows of points (each row the same length), faces skipped where skip(i, k) says.
static func grid(rows: Array, skip = null):
	var m: int = rows[0].size()
	var pos := PackedVector3Array()
	var idx := PackedInt32Array()
	for r in rows:
		for p in r:
			pos.append(p)
	for i in rows.size() - 1:
		for k in m - 1:
			if skip != null and skip.call(i, k):
				continue
			var a := i * m + k
			var b := a + m
			idx.append_array([a, a + 1, b, a + 1, b + 1, b])
	var g = Geo.from_arrays(pos, null, null, idx)
	g.compute_vertex_normals()
	return g

## The fuselage's skin, open over the cockpit above the sill (and capped at the tail).
static func fuselage_geo(seg: int, dz: float):
	var zs := {}
	var z: float = FUSE[0][0]
	while z < 6.2:
		zs[snappedf(z, 0.0001)] = true
		z += dz
	for e in [6.2, FLAP0, FLAP1 - 0.002, FLAP1 + 0.002, WS_Z, HOOD_Z, -3.72, 0.0]:
		zs[e] = true
	var list: Array = zs.keys()
	list.sort()
	var rows := []
	var open := func(z_: float) -> bool: return z_ >= WS_Z - 1e-4 and z_ <= HOOD_Z + 1e-4
	for zz in list:
		var row := []
		for k in seg + 1:
			var p := fuse_point(zz, -PI / 2 + (float(k) / seg) * TAU) # (the seam along the belly)
			if open.call(zz) and p.y > SILL:
				p.y = SILL
			row.append(p)
		rows.append(row)
	return grid(rows, func(i, k): return open.call(list[i]) and open.call(list[i + 1]) and rows[i][k].y >= SILL - 1e-5 and rows[i][k + 1].y >= SILL - 1e-5 and rows[i + 1][k].y >= SILL - 1e-5 and rows[i + 1][k + 1].y >= SILL - 1e-5)

## The spine: narrow, its sides sloping up to a rounded top, from the hood back to the fin.
static func spine_geo(seg: int, n: int):
	var rows := []
	for j in n + 1:
		var z: float = SPINE[0][0] + (float(j) / n) * (SPINE[SPINE.size() - 1][0] - SPINE[0][0])
		var st := spine_at(z)
		var hw: float = st[0]; var top: float = st[1]
		var row := []
		for k in seg + 1:
			var a := (float(k) / seg) * PI # (the upper half only: the lower half would be inside the fuselage)
			row.append(Vector3(hw * pe(cos(a), 2 / 1.8), SPINE_Y + (top - SPINE_Y) * pe(sin(a), 2 / 1.8), z))
		rows.append(row)
	return grid(rows)

## An airfoil section at u (0..1: from the trailing edge along the top to the nose, back along the bottom): [x/c, y/c].
static func foil(u: float, t: float, m := 0.02, p := 0.4) -> Array:
	var a := 1 - u * 2 if u < 0.5 else (u - 0.5) * 2
	var x := (1 - cos(a * PI)) / 2
	var yt := 5 * t * (0.2969 * sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * pow(x, 3) - 0.1036 * pow(x, 4))
	var yc := (m / (p * p)) * (2 * p * x - x * x) if x < p else (m / pow(1 - p, 2)) * (1 - 2 * p + 2 * p * x - x * x)
	return [x, yc + (yt if u < 0.5 else -yt)]

## A lifting surface from s0 out to its tip at b, where the chord runs to nothing (the tip closes itself):
## chord(s), quarter(s) the quarter-chord line's z, thick(s), place(s, y, z) -> Vector3 with y off the
## chord line ("up" for the airfoil's top). Stations closer together towards the tip, where it curves.
static func surface(o: Dictionary, N: int, M: int):
	var s0: float = o.s0
	var b: float = o.b
	var camber: float = o.get("camber", 0.02)
	var rows := []
	for j in N + 1:
		var s := s0 + (b - s0) * sin((float(j) / N) * PI / 2)
		var c: float = o.chord.call(s)
		var le: float = o.quarter.call(s) - 0.25 * c
		var t: float = o.thick.call(s)
		var row := []
		for k in M + 1:
			var xy := foil(float(k) / M, t, camber)
			row.append(o.place.call(s, xy[1] * c, le + xy[0] * c))
		rows.append(row)
	var g = grid(rows)
	# the right way out: the top's normal must point "up"
	var kk := roundi(M / 4.0)
	var i := 1 * (M + 1) + kk
	var s1 := s0 + (b - s0) * sin(PI / 2 / N)
	var up: Vector3 = o.place.call(s1, 1, 0) - o.place.call(s1, 0, 0)
	if g.normals[i].dot(up) < 0:
		flip(g)
	return g

## Mirrored or wrongly wound geometry turned the right way out.
static func flip(g) -> void:
	if not g.indices.is_empty():
		var a: PackedInt32Array = g.indices
		for i in range(0, a.size(), 3):
			var s := a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = s
		g.indices = a
	else:
		var p: PackedVector3Array = g.positions
		var n: PackedVector3Array = g.normals
		var uv: PackedVector2Array = g.uvs
		var col: PackedColorArray = g.colors
		for i in range(0, p.size(), 3):
			var s := p[i + 1]; p[i + 1] = p[i + 2]; p[i + 2] = s
			if not n.is_empty():
				s = n[i + 1]; n[i + 1] = n[i + 2]; n[i + 2] = s
			if not uv.is_empty():
				var u := uv[i + 1]; uv[i + 1] = uv[i + 2]; uv[i + 2] = u
			if not col.is_empty():
				var cc := col[i + 1]; col[i + 1] = col[i + 2]; col[i + 2] = cc
		g.positions = p; g.normals = n; g.uvs = uv; g.colors = col
	g.compute_vertex_normals()

static func wing_geo(side: int, lod: bool):
	return surface({s0 = 0.3, b = SEMI, chord = w_chord, quarter = w_quarter, thick = func(s): return 0.15 - 0.06 * s / SEMI, place = func(s, y, z): return Vector3(side * s, wing_y(s) + y, z)}, 8 if lod else 18, 12 if lod else 30)
static func tail_geo(side: int, lod: bool):
	return surface({s0 = 0.05, b = 2.36, chord = t_chord, quarter = t_quarter, thick = func(_s): return 0.11, camber = 0.0, place = func(s, y, z): return Vector3(side * s, TAIL_Y + y, z)}, 5 if lod else 12, 10 if lod else 22)
static func fin_geo(lod: bool):
	return surface({s0 = 0.0, b = 1.74, chord = f_chord, quarter = func(s): return f_trail(s) - 0.75 * f_chord(s), thick = func(_s): return 0.1, camber = 0.0, place = func(s, y, z): return Vector3(y, FIN_Y + s, z)}, 5 if lod else 12, 10 if lod else 22)

## A rod from a to b (radius r).
static func rod(a: Vector3, b: Vector3, r: float, seg := 6, r1 = null):
	var d := b - a
	var g = Geo.cylinder(r if r1 == null else r1, r, d.length(), seg, 1)
	g.apply_quaternion(Quaternion(Vector3(0, 1, 0), d.normalized()))
	return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)

## The hood's section at z: from the sill on one side over the top to the other (k from 0 to M).
static func hood_point(z: float, k: float, M: float) -> Vector3:
	var a := -PI / 2 + (k / M) * PI
	var w := 0.37 + 0.012 * (z - WS_TOP_Z) / (HOOD_Z - WS_TOP_Z)
	# (the top: up from the windscreen's quickly, then level back to the spine)
	var kz := minf(1, ((z - WS_TOP_Z) / (HOOD_Z - WS_TOP_Z)) * 2.6)
	var top := 1.24 + (HOOD_TOP - 1.24) * sin(kz * PI / 2)
	return Vector3(w * pe(sin(a), 0.8), SILL + (top - SILL) * pow(absf(cos(a)), 0.7), z)

## The windscreen's corners: the flat armoured front panel and the quarter panes back to the hood's bow.
static func windscreen() -> Dictionary:
	return {
		fbl = Vector3(-0.19, 0.865, WS_Z), fbr = Vector3(0.19, 0.865, WS_Z), ftl = Vector3(-0.15, 1.24, WS_TOP_Z), ftr = Vector3(0.15, 1.24, WS_TOP_Z),
		sbl = Vector3(-0.37, SILL, WS_TOP_Z), sbr = Vector3(0.37, SILL, WS_TOP_Z), stl = hood_point(WS_TOP_Z, 3, 12), str = hood_point(WS_TOP_Z, 9, 12),
	}

## A flat pane through four corners (two triangles).
static func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3):
	var g = Geo.from_arrays(PackedVector3Array([a, b, c, a, c, d]))
	g.compute_vertex_normals()
	return g

## The sliding hood's glass, from the windscreen back to the spine.
static func hood_geo(M: int, K: int):
	var rows := []
	for j in K + 1:
		var z := WS_TOP_Z + (float(j) / K) * (HOOD_Z - WS_TOP_Z)
		var row := []
		for k in M + 1:
			row.append(hood_point(z, k, M))
		rows.append(row)
	return grid(rows)

## The canopy's glass: the windscreen's panes and the hood (the cockpit puts it in its own glass).
static func canopy_glass(lod := false):
	var ws := windscreen()
	return merge([quad(ws.fbl, ws.fbr, ws.ftr, ws.ftl), quad(ws.sbl, ws.fbl, ws.ftl, ws.stl), quad(ws.fbr, ws.sbr, ws.str, ws.ftr), hood_geo(8 if lod else 20, 5 if lod else 14)])

## The canopy's frames as segments [a, b, size]: round the windscreen's panes, the hood's bows and its two
## shoulder frames, the rails on the sills. (Rods outside; the cockpit makes them slim bars.)
static func canopy_frame_segments() -> Array:
	var ws := windscreen()
	var f := []
	var M := 12
	for ab in [[ws.fbl, ws.ftl], [ws.fbr, ws.ftr], [ws.ftl, ws.ftr], [ws.fbl, ws.fbr], [ws.ftl, ws.stl], [ws.ftr, ws.str], [ws.sbl, ws.fbl], [ws.sbr, ws.fbr]]:
		f.append([ab[0], ab[1], 1.0])
	for z in [WS_TOP_Z + 0.005, -0.08, HOOD_Z - 0.01]:
		for k in M:
			f.append([hood_point(z, k, M), hood_point(z, k + 1, M), 0.6 if z == -0.08 else 1.0])
	for k in [3, M - 3]:
		for j in 8:
			f.append([hood_point(WS_TOP_Z + (j / 8.0) * (HOOD_Z - WS_TOP_Z), k, M), hood_point(WS_TOP_Z + ((j + 1) / 8.0) * (HOOD_Z - WS_TOP_Z), k, M), 0.7])
	for s in [-1, 1]:
		f.append([Vector3(s * 0.37, SILL + 0.01, WS_TOP_Z - 0.02), Vector3(s * 0.385, SILL + 0.01, HOOD_Z + 0.25), 1.1]) # the hood's rails on the sills
	return f

static func canopy_frames():
	return merge(canopy_frame_segments().map(func(e): return tint(rod(e[0], e[1], 0.017 * e[2]), 0x4b4a35)))

# ---------- materials

## Paint the colour of a geometry into its vertex colours (the details share one material). (Kept as the
## sRGB colour: the material reads its vertex colours as sRGB, as Three turned the hex into linear.)
static func tint(g, hex: int):
	g = g.to_non_indexed() if not g.indices.is_empty() else g
	var c := Mat.color(hex)
	var a := PackedColorArray()
	a.resize(g.positions.size())
	a.fill(c)
	g.colors = a
	return g

## Merge into one geometry, keeping position and normal (and colour, when all have it).
static func merge(list: Array):
	var colour := list.all(func(g): return not g.colors.is_empty())
	return Geo.merge(list.map(func(g):
		var h = g.to_non_indexed() if not g.indices.is_empty() else g
		h.uvs = PackedVector2Array()
		if not colour:
			h.colors = PackedColorArray()
		if h.normals.is_empty():
			h.compute_vertex_normals()
		return h))

# the aircraft of the 56th: squadron code (61st FS HV, 62nd LM, 63rd UN), its letter, the serial on the fin
# (the tail number: 42-xxxxx less its 4), and the insignia's surround (the old red, or the new blue)
const CODES := [["UN", "M", "275855", 1], ["LM", "S", "28487", 0], ["HV", "A", "275510", 1], ["LM", "Z", "28369", 0],
	["HV", "P", "22533", 1], ["UN", "Z", "28461", 0], ["LM", "C", "275237", 1], ["HV", "D", "28405", 1]]
static var CODE_TEX: Texture2D = null
static var _code_canvas = null # (kept: the canvas draws into its texture over the next frames, and a freed one never finishes)
## The codes and serials, white on black in rows of 128 px: [code | letter | serial]. Made once.
static func code_tex() -> Texture2D:
	if CODE_TEX:
		return CODE_TEX
	var g = Canvas2D.new(1024, 1024)
	g.fill_style = "#000"; g.fill_rect(0, 0, 1024, 1024)
	g.fill_style = "#fff"; g.text_align = "center"; g.text_baseline = "middle"
	for r in CODES.size():
		var sq: String = CODES[r][0]; var l: String = CODES[r][1]; var ser: String = CODES[r][2]
		var y := r * 128 + 66
		g.font = '700 124px "Arial Narrow", Arial, sans-serif'
		for k in 2:
			g.fill_text(sq[k], 64 + k * 128, y, 104)
		g.fill_text(l, 320, y, 104)
		g.font = '700 116px "Arial Narrow", Arial, sans-serif'
		for k in ser.length():
			g.fill_text(ser[k], 384 + 53 + k * 106, y, 84)
	_code_canvas = g
	CODE_TEX = g.texture(true) # (mipmapped, as Three's CanvasTexture)
	return CODE_TEX

static var GLSL_SHAPE := """
float wChord(float s) { return 2.84 * sqrt(max(0.0, 1.0 - pow(min(s / %.2f, 1.0), 2.4))); }
float wLE(float s) { return -1.25 + 0.04 * s - 0.25 * wChord(s); }
float tChord(float s) { return 1.45 * sqrt(max(0.0, 1.0 - pow(min(s / 2.36, 1.0), 2.6))); }
float fChord(float s) { return (1.95 - 0.5 * s) * sqrt(max(0.0, 1.0 - pow(clamp(s / 1.74, 0.0, 1.0), 5.0))); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// a panel line d (m) from its centre, w half-wide, faded out when it's thinner than a pixel
float line(float d, float w) { float f = fwidth(d) + 1e-5; return (1.0 - smoothstep(w - f, w + f, abs(d))) * clamp(w * 2.5 / f, 0.0, 1.0); }
float box2(vec2 p, vec2 a, vec2 b, float w) { // a rectangle's outline (a door, a panel)
	if (p.x < a.x - w || p.x > b.x + w || p.y < a.y - w || p.y > b.y + w) return 0.0;
	return max(max(line(p.x - a.x, w), line(p.x - b.x, w)), max(line(p.y - a.y, w), line(p.y - b.y, w)));
}
// inside a five-pointed star of outer radius r, a point straight up
bool star5(vec2 p, float r) {
	float seg = 1.2566371, a = abs(mod(atan(p.x, p.y) + seg * 0.5, seg) - seg * 0.5);
	vec2 q = length(p) * vec2(sin(a), cos(a)), o = vec2(0.0, r), e = 0.381966 * r * vec2(0.5878, 0.809) - o, w = q - o;
	return e.x * w.y - e.y * w.x <= 0.0;
}
// the star and bars of 1943: 0 nothing, 1 the surround, 2 the blue disc, 3 white
float insignia(vec2 p, float r) {
	vec2 a = abs(p);
	float L = length(p), o = r * 0.125;
	if (L < r) return star5(p, r) ? 3.0 : 2.0;
	if (a.x < 2.0 * r && a.y < r * 0.25) return 3.0;
	if (L < r + o || (a.x < 2.0 * r + o && a.y < r * 0.25 + o)) return 1.0;
	return 0.0;
}
""" % SEMI

# The paint, the panel lines, the weathering and the markings, worked out per pixel from where it is on the
# plane (object space). uCode picks the aircraft's row of codes; uBlue the insignia's new blue surround.
# (The JS patched a MeshStandardMaterial and gave each aircraft its own copy on its first draw; here it is one
# spatial shader with uCode and uBlue per instance: own_paint() gives each aircraft its own.)
static var PAINT_CODE := """
shader_type spatial;
render_mode cull_back;
uniform float roughness = 0.78;
uniform float metalness = 0.05;
uniform sampler2D uCodeTex : source_color, filter_linear_mipmap_anisotropic;
instance uniform float uCode = 0.0;
instance uniform float uBlue = 1.0;
varying vec3 vObj;
varying vec3 vObjN;
void vertex() { vObj = VERTEX; vObjN = NORMAL; }
%s
// a letter cell of the codes' atlas: col (in 128 px cells), cols wide, at local (u, v) in 0..1
float codeAt(float col, float cols, vec2 uv) {
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
	return texture(uCodeTex, vec2((col + uv.x * cols) / 8.0, (uCode + 1.0) / 8.0 - uv.y / 8.0)).r;
}
void fragment() {
	float gloss = 0.0;
	vec3 p = vObj, n = normalize(vObjN);
	vec3 od = vec3(0.075, 0.07, 0.034), grey = vec3(0.2, 0.205, 0.2), wht = vec3(0.72, 0.72, 0.69);
	float ax = abs(p.x);
	bool wing = ax > 0.6 && p.y < 0.05 && p.z > -2.3 && p.z < 1.1 && (ax > 0.78 || abs(n.y) > 0.6);
	bool tail = p.z > 4.3 && abs(p.y - %.2f) < 0.12 && (ax > 0.3 || (ax > 0.12 && abs(n.y) > 0.6));
	bool fin = p.z > 3.9 && ax < 0.11 && p.y > 0.74;
	bool body = !wing && !tail && !fin;
	// olive drab down the sides to the wing (a soft sprayed edge), neutral grey under it; the wings and
	// tail by which way they face
	float top = body ? smoothstep(-0.36, -0.22, p.y + 0.03 * sin(p.z * 2.3)) : smoothstep(-0.25, 0.1, n.y);
	if (fin) top = 1.0;
	// faded unevenly panel by panel in the sun, the grey less so; a little grime
	float fade = hash(floor(vec2(p.z * 1.6, p.x * 1.2 + p.y * 1.7)));
	vec3 c = mix(grey * (0.95 + 0.08 * fade), od * (0.88 + 0.26 * fade), top);
	c *= 0.92 + 0.12 * vnoise(p.xz * 3.0 + p.y * 2.0);
	float lines = 0.0;
	if (body) {
		for (int i = 0; i < 12; i++) { // the frames' joints round the fuselage
			float z = i == 0 ? -3.72 : i == 1 ? -3.2 : i == 2 ? %.2f : i == 3 ? %.2f : i == 4 ? -1.9 : i == 5 ? -1.2 : i == 6 ? 0.47 : i == 7 ? 1.35 : i == 8 ? 2.05 : i == 9 ? 2.95 : i == 10 ? 3.85 : 4.7;
			lines = max(lines, line(p.z - z, 0.006));
		}
		if (p.z > -2.6 && p.z < 4.6) lines = max(lines, line(p.y - 0.36, 0.005)); // and along it
		if (p.z > -2.6 && p.z < 3.0) lines = max(lines, line(p.y + 0.6, 0.005));
		if (p.z < %.2f) { lines = max(lines, line(p.y - 0.42, 0.005)); lines = max(lines, line(p.y + 0.5, 0.005)); if (p.y > 0.55) lines = max(lines, line(p.x, 0.005)); }
		if (p.z > %.2f && p.z < %.2f) { float a = atan(p.y + 0.11, p.x) / 0.314159; lines = max(lines, line(fract(a + 0.5) - 0.5, 0.03)); } // the cowl flaps
		lines = max(lines, box2(vec2(p.z, p.y), vec2(-2.38, -0.56), vec2(-1.86, -0.2), 0.005)); // the intercooler doors
		if (p.y > 0.84 && p.z > 0.4) lines = max(lines, line(p.x, 0.004)); // the spine's seam
		lines *= 0.38;
		// the white band round the cowling's front
		if (p.z < -3.72) c = wht * (0.95 + 0.05 * fade);
		// exhaust soot: from the waste gates aft along the belly, from the oil coolers' shutters along the
		// lower sides, from the turbo's hood aft
		float soot = 0.0;
		for (int s = -1; s <= 1; s += 2) {
			float sx = float(s), dz = p.z + 1.95;
			if (dz > 0.0 && p.y < -0.6) soot = max(soot, (1.0 - smoothstep(0.08 + 0.05 * dz, 0.16 + 0.09 * dz, abs(p.x - sx * 0.3))) * exp(-dz * 0.55));
			float dz2 = p.z + 2.62;
			if (dz2 > 0.0 && sx * p.x > 0.0) soot = max(soot, (1.0 - smoothstep(0.06, 0.12 + 0.05 * dz2, abs(p.y + 0.74 - 0.06 * dz2))) * exp(-dz2 * 0.9) * 0.8);
		}
		if (p.z > 2.05 && p.y < -0.5) soot = max(soot, (1.0 - smoothstep(0.1 + 0.04 * (p.z - 2.05), 0.2 + 0.08 * (p.z - 2.05), ax)) * exp(-(p.z - 2.05) * 0.7));
		soot *= 0.55 + 0.45 * vnoise(vec2(p.x * 38.0, p.z * 2.0));
		c = mix(c, vec3(0.022, 0.019, 0.016), clamp(soot, 0.0, 0.85));
		// the fixed windows in the spine behind the hood
		float st = 1.36 - 0.135 * (p.z - 0.4);
		if (p.z > 0.47 && p.y > 0.98 + 0.32 * (p.z - 0.47) && p.y < st - 0.06 && ax > 0.03) { c = vec3(0.012, 0.016, 0.02) + 0.03 * vec3(n.y + 0.5); gloss = 1.0; }
	}
	if (wing) {
		float s = ax, fr = (p.z - wLE(s)) / max(wChord(s), 0.01);
		bool topS = n.y > 0.0;
		for (int i = 0; i < 3; i++) lines = max(lines, line(fr - (i == 0 ? 0.07 : i == 1 ? 0.3 : 0.6), 0.004 / max(wChord(s), 0.3)));
		if (s > 0.75 && s < 5.85) lines = max(lines, line(fr - (s < 3.85 ? 0.74 : 0.76), 0.006 / max(wChord(s), 0.3))); // the flaps' and ailerons' hinges
		if (fr > 0.72) { lines = max(lines, line(s - 3.85, 0.006)); lines = max(lines, line(s - 5.85, 0.006)); if (s > 4.6 && s < 5.1) lines = max(lines, line(fr - 0.9, 0.003)); } // (and a trim tab)
		lines = max(lines, line(fract(s / 0.42 + 0.5) - 0.5, 0.012) * 0.35); // the ribs, faintly
		if (topS) { lines = max(lines, box2(vec2(s, fr), vec2(2.35, 0.06), vec2(3.6, 0.3), 0.004)); lines = max(lines, box2(vec2(s, fr), vec2(3.6, 0.07), vec2(4.45, 0.3), 0.004)); } // gun bay and ammunition doors
		else lines = max(lines, box2(vec2(s, fr), vec2(0.72, 0.12), vec2(2.25, 0.6), 0.003)); // the main wheel doors
		lines *= 0.4;
		// the paint worn through at the wing root, where the pilot climbed in, and along the leading edges
		float chip = vnoise(p.xz * 46.0) * vnoise(p.xz * 9.0 + 3.1);
		if (topS && s < 1.45 && fr > 0.15 && fr < 0.75 && p.x < 0.0) c = mix(c, vec3(0.2, 0.2, 0.19), smoothstep(0.62, 0.66, chip) * 0.5);
		if (fr < 0.03) c = mix(c, vec3(0.24, 0.245, 0.25), smoothstep(0.6, 0.66, chip) * 0.6);
		// the star and bars: over the left wing and under the right, the star's point forward
		if ((p.x < -2.0 && topS) || (p.x > 2.0 && !topS)) { float k = insignia(vec2(s - 4.3, -(p.z + 1.04)), 0.5); if (k > 0.5) c = k > 2.5 ? wht : k > 1.5 ? vec3(0.012, 0.018, 0.06) : (uBlue > 0.5 ? vec3(0.012, 0.018, 0.06) : vec3(0.3, 0.012, 0.012)); }
	}
	if (tail) {
		float s = ax, fr = (p.z - (5.0 + 0.05 * s - 0.25 * tChord(s))) / max(tChord(s), 0.01);
		lines = max(lines, line(fr - 0.66, 0.004)) * 0.5;
		if (s > 1.25 && s < 1.63) c = wht; // the white band across the tailplanes, top and bottom
	}
	if (fin) {
		float s = p.y - %.2f, fr = 1.0 - (6.17 - 0.03 * s - p.z) / max(fChord(s), 0.01);
		lines = max(lines, line(fr - 0.62, 0.004)) * 0.5;
		if (p.y > 1.3 && p.y < 1.6) c = wht; // and across the fin and the rudder
		// the serial, yellow, on both sides under it
		float ser = codeAt(3.0, 5.0, vec2(p.x > 0.0 ? (6.02 - p.z) / 1.25 : (p.z - 4.77) / 1.25, (p.y - 0.98) / 0.2));
		c = mix(c, vec3(0.55, 0.36, 0.0), smoothstep(0.35, 0.6, ser));
	}
	// on the fuselage: the star and bars, the squadron's code ahead of it and the aircraft's letter behind
	// (read nose-first on both sides), in white
	if (body && abs(n.x) > 0.3 && p.z > 0.4 && p.z < 3.8) {
		float k = insignia(vec2(p.z - 2.3, p.y - 0.06), 0.36);
		if (k > 0.5) c = k > 2.5 ? wht : k > 1.5 ? vec3(0.012, 0.018, 0.06) : (uBlue > 0.5 ? vec3(0.012, 0.018, 0.06) : vec3(0.3, 0.012, 0.012));
		float zc = p.x < 0.0 ? (p.z - 0.62) / 0.84 : (1.46 - p.z) / 0.84, zl = p.x < 0.0 ? (p.z - 3.12) / 0.42 : (3.54 - p.z) / 0.42;
		float t = max(codeAt(0.0, 2.0, vec2(zc, (p.y + 0.18) / 0.5)), codeAt(2.0, 1.0, vec2(zl, (p.y + 0.18) / 0.5)));
		c = mix(c, wht * 0.92, smoothstep(0.35, 0.6, t));
	}
	c *= 1.0 - 0.6 * lines;
	ALBEDO = c;
	ROUGHNESS = mix(roughness, 0.12, gloss);
	METALLIC = metalness;
}
""" % [GLSL_SHAPE, TAIL_Y, FLAP0, FLAP1, FLAP0, FLAP0, FLAP1, FIN_Y]

static var _paint_shader: Shader
static var next_code := 1

static func paint(roughness: float, metalness: float) -> ShaderMaterial:
	if _paint_shader == null:
		_paint_shader = Shader.new()
		_paint_shader.code = PAINT_CODE
	var m := ShaderMaterial.new()
	m.shader = _paint_shader
	m.set_shader_parameter("roughness", roughness)
	m.set_shader_parameter("metalness", metalness)
	m.set_shader_parameter("uCodeTex", code_tex())
	return m

## Each aircraft its own codes (the JS did it on a mesh's first draw): the next row of CODES on every painted
## mesh under `root`. Called for each P-47 as it comes into the game (fighters.gd's spawn; the cockpit's shell).
static func own_paint(root: Node) -> void:
	var code := next_code % CODES.size()
	next_code += 1
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		var m = mi.mesh.surface_get_material(0) if mi.mesh and mi.mesh.get_surface_count() else null
		if m is ShaderMaterial and m.shader == _paint_shader:
			mi.set_instance_shader_parameter("uCode", float(code))
			mi.set_instance_shader_parameter("uBlue", float(CODES[code][3]))

## The Curtiss blades: black, with the yellow tips that warned the ground crew of them.
static func blade_paint() -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
varying vec3 vObj;
void vertex() { vObj = VERTEX; }
void fragment() {
	ALBEDO = length(vObj.xy) > %.3f ? vec3(0.75, 0.48, 0.02) : vec3(0.014);
	ROUGHNESS = 0.5;
	METALLIC = 0.3;
}
""" % (PROP_R - 0.11)
	var m := ShaderMaterial.new()
	m.shader = sh
	return m

# ---------- the parts

## One Curtiss Electric "toothpick" blade along +y: a round shank, then a narrow, thin, twisted blade with a rounded tip.
static func blade_geo(lod: bool):
	var pts := [[0, 0.3], [0.1, 0.36], [0.115, 0.6], [0.11, 1.1], [0.095, 1.5], [0.07, 1.74], [0.035, PROP_R - 0.005]]
	var outline := pts.map(func(p): return Vector2(p[0] * 1.1, p[1]))
	var rev := pts.duplicate()
	rev.reverse()
	outline.append_array(rev.map(func(p): return Vector2(-p[0] * 0.9, p[1])))
	var g = Geo.extrude(Shapes.Shape.new(outline), {depth = 0.03, bevelEnabled = not lod, bevelThickness = 0.008, bevelSize = 0.008, bevelSegments = 1, curveSegments = 4, steps = 1})
	g.translate(0, 0, -0.015)
	# the twist: steep at the root, flatter towards the tip
	var p: PackedVector3Array = g.positions
	for i in p.size():
		var v := p[i]
		var a := 0.95 - 0.55 * clampf((v.y - 0.3) / 1.5, 0, 1)
		var c := cos(a); var s := sin(a)
		p[i] = Vector3(v.x * c - v.z * s, v.y, v.x * s + v.z * c)
	g.positions = p
	g.compute_vertex_normals()
	var shank = Geo.cylinder(0.06, 0.07, 0.24, 6 if lod else 12).translate(0, 0.27, 0)
	return merge([g, shank])

## The R-2800's face in the cowling's mouth, and the intake under it (vertex-coloured, for the detail mesh).
static func engine_face(lod: bool, seg: int) -> Array:
	var out := []
	var dark := 0x0b0b0b
	var steel := 0x2c2d2e
	var black := 0x111111
	# the mouth: the cowling's lip rolled in, a dark duct back to the engine
	var ring := func(z: float, k: float) -> Array:
		var r := []
		for i in seg + 1:
			var p := fuse_point(-4.33, -PI / 2 + (float(i) / seg) * TAU)
			r.append(Vector3(p.x * k, (p.y + 0.11) * k - 0.11, z))
		return r
	out.append(tint(grid([ring.call(-4.33, 1.0), ring.call(-4.3, 0.93)]), 0xb8b8b2)) # (white, with the band)
	out.append(tint(grid([ring.call(-4.3, 0.93), ring.call(-4.05, 0.87)]), dark))
	# the back of the mouth, and the lip across it over the intake
	out.append(tint(Geo.circle(1, seg).scale(0.66, 0.9, 1).rotate_y(PI).translate(0, -0.11, -4.03), dark))
	out.append(tint(Geo.cylinder(0.035, 0.035, 1.1, 10, 1).rotate_z(PI / 2).scale(1, 0.8, 1.6).translate(0, -0.45, -4.27), 0x8e8e88))
	if lod:
		return out
	# the intake's splitters (the oil coolers' ducts either side, the turbo's air in the middle)
	for s in [-1, 1]:
		out.append(tint(Geo.box(0.025, 0.4, 0.3).translate(s * 0.19, -0.7, -4.12), 0x2e2e2a))
	# the engine: the front row of nine cylinders with their heads, the rear row's between, the gear case, the ignition ring
	for k in 18:
		var front := k % 2 == 0
		var a := (k / 18.0) * TAU
		var r := 0.37
		var x := sin(a); var y := cos(a)
		var z := -4.16 if front else -4.08
		var cyl = Geo.cylinder(0.075, 0.075, 0.24, 10).rotate_z(-a).translate(x * r, 0.05 + y * r, z)
		out.append(tint(cyl, steel if front else 0x1c1d1e))
		if front:
			for f in 4: # its fins
				out.append(tint(Geo.torus(0.083, 0.008, 4, 12).rotate_x(PI / 2).rotate_z(-a).translate(x * (r - 0.08 + f * 0.05), 0.05 + y * (r - 0.08 + f * 0.05), z), black))
			out.append(tint(Geo.box(0.1, 0.07, 0.12).rotate_z(-a).translate(x * (r + 0.13), 0.05 + y * (r + 0.13), z + 0.01), 0x3a3b3c)) # the rocker boxes
			out.append(tint(rod(Vector3(x * 0.2, 0.05 + y * 0.2, -4.18), Vector3(x * (r + 0.1), 0.05 + y * (r + 0.1), -4.2), 0.012, 5), 0x6a6a64)) # the push rods
	out.append(tint(Geo.torus(0.28, 0.012, 5, 30).translate(0, 0.05, -4.21), 0x7a6a40)) # the ignition harness
	out.append(tint(Geo.sphere(0.27, 18, 10, 0, TAU, 0, PI / 2).rotate_x(-PI / 2).scale(1, 1, 0.55).translate(0, 0.05, -4.2), 0x3a3b3c)) # the reduction gear's case
	for s in [-1, 1]:
		out.append(tint(Geo.box(0.09, 0.1, 0.11).translate(s * 0.13, 0.25, -4.3), 0x1e1e1e)) # the magnetos
	out.append(tint(Geo.cylinder(0.06, 0.07, 0.1, 10).rotate_x(PI / 2).translate(0, 0.27, -4.32), 0x2a2a2a)) # the governor
	return out

## Under and round the fuselage: doors, shutters, the waste gates, the turbo's exhaust hood (in the paint, plus dark and steel details).
static func belly_parts() -> Dictionary:
	var paint_parts := []
	var detail := []
	for s in [-1, 1]:
		# the intercooler's exit doors, standing a little open
		var door = Geo.box(0.02, 0.36, 0.5).translate(0, 0, 0.25).rotate_y(s * 0.18).translate(s * fuse(-2.38)[0] * 0.97, -0.38, -2.38)
		paint_parts.append(door)
		detail.append(tint(Geo.box(0.01, 0.34, 0.4).translate(s * (fuse(-2.1)[0] - 0.01), -0.38, -2.12), 0x080808)) # (the dark gap behind it)
		# the oil coolers' shutters under the cowling's back edge
		var sh = Geo.box(0.32, 0.015, 0.22).translate(0, 0, 0.11).rotate_x(0.25).rotate_z(s * 0.5).translate(s * 0.42, skin_y(-2.66, 0.42, false), -2.66)
		paint_parts.append(sh)
		# the waste gates: a short pipe out of the belly under the wing's root, blackened
		var wy := skin_y(-1.92, 0.3, false)
		detail.append(tint(Geo.cylinder(0.06, 0.07, 0.2, 10).rotate_x(PI / 2 - 0.25).translate(s * 0.3, wy - 0.02, -1.92), 0x2a2420))
		detail.append(tint(Geo.circle(0.05, 10).rotate_x(-0.25).translate(s * 0.3, wy - 0.045, -1.82), 0x050505))
	# the turbo's exhaust hood: a stainless shroud on the belly behind the wing, its outlet dark
	detail.append(tint(Geo.sphere(1, 14, 8, 0, TAU, PI / 2, PI / 2).scale(0.2, 0.12, 0.34).translate(0, fuse(1.8)[3] + 0.04, 1.8), 0x8d8c86))
	detail.append(tint(Geo.box(0.34, 0.01, 0.5).translate(0, fuse(2.3)[3] + 0.005, 2.3), 0x77756e))
	detail.append(tint(Geo.circle(0.07, 10).translate(0, fuse(1.8)[3] - 0.03, 2.1), 0x050505))
	# the tail wheel's doors and the main wheels' wells' doors are panel lines in the paint; the landing light under the left wing
	detail.append(tint(Geo.circle(0.09, 12).rotate_x(PI / 2).translate(-4.1, wing_y(4.1) - 0.1, -0.85), 0xb8c0c4))
	return {paint_parts = paint_parts, detail = detail}

## His cockpit seen through the glass: its dark well and walls, the coaming and gunsight, the armour and headrest behind him.
static func pilot_parts() -> Array:
	var p := []
	p.append(tint(Geo.box(0.66, 0.02, 1.2).translate(0, 0.5, -0.2), 0x1a1f16)) # (the dark well of the cockpit)
	for s in [-1, 1]:
		p.append(tint(Geo.box(0.02, 0.3, 1.25).translate(s * 0.33, 0.66, -0.2), 0x37432e)) # its walls, dull dark green
	p.append(tint(Geo.box(0.66, 0.1, 0.12).translate(0, 0.82, -0.72), 0x161616)) # the coaming over the panel
	p.append(tint(Geo.box(0.08, 0.1, 0.13).translate(0, 0.92, -0.6), 0x161616)) # the gunsight
	# (the pilot himself is the crewman, drawn in his seat when you're close enough to see him: crowd.gd)
	p.append(tint(Geo.box(0.4, 0.42, 0.03).translate(0, 0.98, 0.14), 0x2c2e2c)) # the head armour
	p.append(tint(Geo.box(0.2, 0.12, 0.06).translate(0, 1.1, 0.1), 0x3a2a1e)) # the headrest
	return p

## Where each gun's muzzle is, [x, y, z], left wing's four then the right's, inboard to outboard.
static func p47_muzzles() -> Array:
	var out := []
	# staggered: each gun a little further back than the one inboard of it, so the belts could feed side by side
	for s in [-1, 1]:
		for k in P47_GUN_X.size():
			var x: float = P47_GUN_X[k]
			out.append([s * x, wing_y(x) - 0.03, leading_edge(x) - 0.42 + k * 0.08])
	return out

static func _mesh(g, mat: Material, name: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = g.to_mesh(mat)
	mi.name = name
	return mi

## The whole aeroplane. lod: the low-detail copy for far away (fewer sections; the skin, the dark front, the
## glass and the propeller's disc only). Named parts: 'P47_Blades' (the propeller), 'P47_Spinner' (its hub),
## 'Fake_Blades' (the blur disc), as the game spins them; 'P47_Body' (the painted skin and frames),
## 'P47_Detail', 'P47_Frames', 'P47_Pilot' and 'P47_Canopy' (the glass; the cockpit view leaves the last three out).
static func build_p47(o := {}) -> Node3D:
	var lod: bool = o.get("lod", false)
	var root := Node3D.new()
	root.name = "P47"
	var skin := paint(0.78, 0.05)
	var detail_mat := Mat.standard({vertexColors = true, roughness = 0.6, metalness = 0.35, side = Mat.DOUBLE})
	var seg := 14 if lod else 44
	var body := [fuselage_geo(seg, 0.45 if lod else 0.11), spine_geo(6 if lod else 16, 4 if lod else 14)]
	body.append(Geo.circle(1, 8 if lod else 20, 0, PI).rotate_y(PI).scale(SPINE[0][1], SPINE[0][2] - SPINE_Y, 1).translate(0, SPINE_Y, SPINE[0][0])) # (the spine's front, behind the hood)
	body.append_array([wing_geo(1, lod), wing_geo(-1, lod), tail_geo(1, lod), tail_geo(-1, lod), fin_geo(lod)])
	var detail := engine_face(lod, seg)
	if not lod:
		var b := belly_parts()
		body.append_array(b.paint_parts)
		detail.append_array(b.detail)
		# the guns: four .50s out of each wing's leading edge, staggered, each in its blast tube
		for m in p47_muzzles():
			var x: float = m[0]; var y: float = m[1]; var z: float = m[2]
			detail.append(tint(Geo.cylinder(0.012, 0.012, 0.75, 8).rotate_x(PI / 2).translate(x, y, z + 0.37), 0x1a1a1a))
			detail.append(tint(Geo.cylinder(0.028, 0.032, 0.22, 10).rotate_x(PI / 2).translate(x, y, leading_edge(absf(x)) + 0.02), 0x1e1e1c))
		# the pitot tube under the left wing's tip, the navigation lights, the aerial mast and its wire to the fin
		detail.append(tint(rod(Vector3(-5.3, wing_y(5.3) - 0.08, leading_edge(5.3) + 0.25), Vector3(-5.3, wing_y(5.3) - 0.08, leading_edge(5.3) - 0.35), 0.01), 0x9a9a96))
		detail.append(tint(Geo.sphere(0.035, 8, 6).translate(-SEMI + 0.03, wing_y(SEMI), w_quarter(SEMI) - 0.05), 0xff2010))
		detail.append(tint(Geo.sphere(0.035, 8, 6).translate(SEMI - 0.03, wing_y(SEMI), w_quarter(SEMI) - 0.05), 0x10ff40))
		detail.append(tint(rod(Vector3(0, 1.22, 1.05), Vector3(0, 1.62, 1.3), 0.018, 6, 0.008), 0x3a3a2a))
		detail.append(tint(rod(Vector3(0, 1.6, 1.3), Vector3(0, FIN_Y + 1.66, 5.85), 0.004, 3), 0x111111))
		# the rear-view mirror on top of the windscreen's bow
		detail.append(tint(Geo.box(0.012, 0.05, 0.012).translate(0, 1.27, WS_TOP_Z + 0.02), 0x3a3a2a))
		detail.append(tint(Geo.box(0.11, 0.035, 0.012).rotate_x(0.25).translate(0, 1.31, WS_TOP_Z + 0.02), 0x3a3a2a))
	root.add_child(_mesh(merge(body), skin, "P47_Body"))
	root.add_child(_mesh(merge(detail), detail_mat, "P47_Detail"))
	if not lod: # the canopy's frames, olive drab (the cockpit has its own, slimmer as seen from the seat)
		root.add_child(_mesh(canopy_frames(), detail_mat, "P47_Frames"))
	# the pilot in his cockpit (or, far away, just its dark opening)
	var pilot := _mesh(merge([tint(Geo.box(0.66, 0.02, 1.2).translate(0, 0.78, -0.2), 0x111111)] if lod else pilot_parts()), Mat.basic({color = 0x0a0a0a}) if lod else detail_mat, "P47_Pilot")
	root.add_child(pilot)
	# the Curtiss Electric's hub, and its four blades
	var spinner := _mesh(merge([Geo.cylinder(0.1, 0.1, 0.2, 10).rotate_x(PI / 2).translate(0, 0, -4.38), Geo.cylinder(0.2, 0.22, 0.2, 8 if lod else 20).rotate_x(PI / 2).translate(0, 0, PROP_Z + 0.02), Geo.sphere(0.2, 8 if lod else 20, 8, 0, TAU, 0, PI / 2).rotate_x(-PI / 2).scale(1, 1, 0.9).translate(0, 0, PROP_Z - 0.08)]),
		Mat.standard({color = 0x24251f, roughness = 0.45, metalness = 0.5}), "P47_Spinner")
	root.add_child(spinner)
	var blades := Node3D.new()
	blades.name = "P47_Blades"
	blades.position = Vector3(0, 0, PROP_Z)
	if not lod: # (far away it's only ever the blur)
		var bg = blade_geo(lod)
		var all := []
		for k in 4:
			all.append(bg.clone().rotate_z((k / 4.0) * TAU + PI / 4))
		var bm := MeshInstance3D.new()
		bm.mesh = merge(all).to_mesh(blade_paint())
		blades.add_child(bm)
	root.add_child(blades)
	var disc := _mesh(Geo.ring(0.2, PROP_R, 48, 1), Mat.basic({color = 0x1a1a1a, transparent = true, opacity = 0.11, depthWrite = false, side = Mat.DOUBLE}), "Fake_Blades")
	disc.position = Vector3(0, 0, PROP_Z - 0.02)
	disc.visible = false
	root.add_child(disc)
	var glass := Mat.physical({color = 0xc8d8e0, roughness = 0.05, metalness = 0, transparent = true, opacity = 0.13, depthWrite = false, side = Mat.DOUBLE})
	glass.render_priority = 2 # (renderOrder 2)
	var canopy := _mesh(canopy_glass(lod), glass, "P47_Canopy")
	root.add_child(canopy)
	for m in root.find_children("*", "GeometryInstance3D", true, false):
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if not lod and m != disc and m != canopy else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return root
