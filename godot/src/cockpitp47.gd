extends RefCounted
# The P-47D razorback's cockpit, for flying one in first person, built to the photographs of the real one
# (the restored panels, the labelled cockpit guides) and set in the aeroplane itself: what you see of the
# nose, the wings and the spine round you is p47.gd's own model, so it's the same aircraft inside and out.
# - The big, roomy cockpit of the Thunderbolt in dull dark green, with no floor: below the seat and the
#   rudder pedals you look down into the fuselage, its frames and stringers, the turbo's ducts running
#   forward under you.
# - The black instrument panel: every dial drawn once, face and markings, into one texture, with their
#   needles moving every frame (one multimesh of needles, one of bars, one of dots: no redrawing):
#   the clock, the directional gyro's card, the gyro horizon, airspeed, altimeter, turn and bank with its
#   ball, rate of climb, the turbo's tachometer, manifold pressure, the engine's rpm, the three-in-one
#   engine gauge, carburettor air and cylinder head temperatures, the accelerometer, suction, fuel,
#   hydraulic and oxygen pressure and the oxygen blinker, the standby compass; fluorescent at night.
# - The N-3B reflector sight on the coaming, its glass on your eye line (pilot.gd puts the reticle on the
#   guns' line through it) and its rubber pad stencilled NO HAND HOLD.
# - The stick between your knees and the throttle quadrant on the left (the turbo's boost lever outboard
#   of the throttle, the propeller and mixture levers inboard), moving under your hands; the trim wheels,
#   the gear and flap handles, the radio's control box, the oxygen regulator, the canopy crank.
# - The razorback's framed canopy round you: the flat armoured windscreen, its quarter panes, the sliding
#   hood, the mirror on the bow; the armour plate and the spine behind your head.
# Same interface as cockpit.gd's build_cockpit: a node placed on the fighter each frame, with metadata
# "update" (Callable(state: Dictionary, dt: float)) and "night" (Callable(k: float)).

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const P47 := preload("res://src/p47.gd")
const Env := preload("res://src/environment.gd") # (wet_glass)

const DEG := PI / 180
# the panel: its size (m), where it stands (its centre), leaning back at the top; the canvas it's drawn in
const PW := 0.8
const PH := 0.38
const PANEL_AT := Vector3(0, 0.64, -0.7)
const PANEL_TILT := -0.21
const CW := 2048
const CH := 973
const PX := CW / PW
const INK := "#ece7d6"
const FONT := "700 %dpx \"Arial Narrow\", Arial, sans-serif"

## Park–Miller, as the JS's rng(seed): a Callable giving the next number in [0, 1].
static func rng(seed: int) -> Callable:
	var st := [seed]
	return func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return (st[0] - 1) / 2147483646.0

## A number as JS's String(n) writes it (whole numbers without a point).
static func _js_str(v) -> String:
	if v is String:
		return v
	var f := float(v)
	if f == floorf(f) and absf(f) < 1e15:
		return str(int(f))
	return str(f)

## JS's Math.round (halves up).
static func _round(x: float) -> float:
	return floorf(x + 0.5)

# ---------- geometry helpers

## A geometry ready to merge: non-indexed, position and normal, and a vertex colour shaded darker the deeper it
## is in the cockpit. (Three keeps the colour linear; Godot's material reads vertex colours as sRGB, so the
## shaded linear colour goes back to sRGB.)
static func paint_geo(geo, hex: int, ao := true):
	var g = geo.to_non_indexed() if not geo.indices.is_empty() else geo.clone()
	g.uvs = PackedVector2Array()
	g.colors = PackedColorArray()
	for s in 4:
		g.delete_attribute(str(s))
	g.groups = []
	if g.normals.is_empty():
		g.compute_vertex_normals()
	var c := Mat.color(hex).srgb_to_linear()
	var n: int = g.positions.size()
	var a := PackedColorArray()
	a.resize(n)
	for i in n:
		# (light falls in from above through the canopy: the deep fuselage is dark)
		var k := clampf(0.18 + (g.positions[i].y + 0.55) / 1.45, 0.18, 1) if ao else 1.0
		a[i] = Color(c.r * k, c.g * k, c.b * k).linear_to_srgb()
	g.colors = a
	return g

## A rod from a to b (radius r, r1 at b).
static func rod(a: Vector3, b: Vector3, r: float, seg := 8, r1 = null):
	var d := b - a
	var g = Geo.cylinder(r if r1 == null else r1, r, d.length(), seg, 1)
	g.apply_quaternion(Quaternion(Vector3(0, 1, 0), d.normalized()))
	return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)

## A flat pane through four corners (two triangles).
static func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3):
	var g = Geo.from_arrays(PackedVector3Array([a, b, c, a, c, d]))
	g.compute_vertex_normals()
	return g

## A gloved hand, closed round a grip: palm, thumb, the curl of the fingers.
static func hand_geo() -> Array:
	return [
		Geo.rounded_box(0.085, 0.05, 0.1, 2, 0.018),
		Geo.capsule(0.023, 0.07, 3, 8).rotate_z(PI / 2).translate(0, 0.022, -0.055),
		Geo.capsule(0.015, 0.045, 3, 6).rotate_x(0.8).translate(-0.05, 0.022, -0.02),
	]

# ---------- the instrument faces

## Where panel point (x, y) (m, from the panel's centre, y up) is on the canvas.
static func px(x: float, y: float) -> Vector2:
	return Vector2((x / PW + 0.5) * CW, (0.5 - y / PH) * CH)

## The dials: [id, x, y, r] in metres on the panel. Laid out as the P-47D's: the clock and accelerometer top
## left, the directional gyro and the gyro horizon top centre over airspeed, altimeter, turn and bank and rate of
## climb, the engine's instruments on the right, fuel, hydraulics, the compass and oxygen below.
const DIALS := [
	["clock", -0.315, 0.125, 0.026], ["accel", -0.315, 0.035, 0.026], ["suction", -0.315, -0.05, 0.02],
	["dg", -0.06, 0.12, 0.04], ["horizon", 0.06, 0.12, 0.04], ["carb", 0.215, 0.135, 0.023], ["cht", 0.305, 0.135, 0.023],
	["speed", -0.2, 0.03, 0.04], ["alt", -0.1, 0.03, 0.04], ["turn", 0, 0.025, 0.034], ["climb", 0.1, 0.03, 0.04],
	["turbo", 0.205, 0.04, 0.027], ["boost", 0.305, 0.04, 0.034], ["rpm", 0.305, -0.055, 0.034], ["engine", 0.205, -0.06, 0.03],
	["fuel", -0.2, -0.065, 0.03], ["hyd", -0.09, -0.075, 0.021], ["oxy", 0.1, -0.075, 0.021],
]
const COMPASS := [0.0, -0.08, 0.06, 0.042] # the B-16 standby compass, a box below the turn and bank: x, y, w, h

## Draws the panel's face once: black crinkle paint, the dials' faces and scales, placards, switch plates.
static func panel_art():
	var g = Canvas2D.new(CW, CH)
	var r := rng(5)
	g.fill_style = "#121212"; g.fill_rect(0, 0, CW, CH)
	for i in 26000: # the crinkle finish
		g.fill_style = "#ffffff07" if r.call() < 0.5 else "#00000018"
		g.fill_rect(r.call() * CW, r.call() * CH, 2 + r.call() * 2, 2 + r.call() * 2)
	g.stroke_style = "#ffffff14"; g.line_width = 2 # worn along its edges
	for i in 90:
		var x: float = r.call() * CW
		var y: float = r.call() * 30 if r.call() < 0.5 else CH - r.call() * 30
		g.begin_path(); g.move_to(x, y); g.line_to(x + 8 + r.call() * 40, y + (r.call() - 0.5) * 5); g.stroke()
	# the shock-mounted centre panel's edge and its screws
	g.stroke_style = "#000"; g.line_width = 4
	var a := px(-0.255, 0.18)
	var b := px(0.255, -0.11)
	g.stroke_rect(a.x, a.y, b.x - a.x, b.y - a.y)
	var sx := a.x + 20
	while sx < b.x:
		for y in [a.y + 14, b.y - 14]:
			screw(g, sx, y, 6)
		sx += 90
	for d in DIALS:
		var p := px(d[1], d[2])
		dial(g, d[0], p.x, p.y, d[3] * PX)
	compass_face(g)
	# the placards and labels, white on black, as stencilled and engraved
	_plate(g, -0.06, 0.172, 0.13, 0.016, ["NEVER EXCEED 500 M.P.H. I.A.S."])
	_plate(g, 0.27, -0.165, 0.16, 0.026, ["USE 100 OCTANE FUEL", "WATER INJ. OFF"])
	_plate(g, -0.2, -0.165, 0.14, 0.026, ["AIRCRAFT NO. 42-75855", "P-47D-6-RE"])
	_label(g, -0.235, 0.155, "WHEELS", 12); _label(g, -0.235, 0.105, "UP  DOWN", 11)
	for s in [-1, 1]:
		var q := px(-0.235 + s * 0.012, 0.13)
		g.fill_style = "#222"; g.begin_path(); g.arc(q.x, q.y, 11, 0, 7); g.fill()
	# the ignition switch and the starter's, the primer, battery and generator switches across the bottom
	_label(g, -0.33, -0.112, "IGNITION", 12)
	for ta in [["OFF", -60], ["L", -20], ["R", 20], ["BOTH", 60]]:
		_label(g, -0.33 + sin(ta[1] * DEG) * 0.03, -0.14 + cos(ta[1] * DEG) * 0.03, ta[0], 10)
	var sw := ["BATTERY", "GENERATOR", "STARTER", "PRIMER", "GUN HEAT", "PITOT HT"]
	for i in sw.size():
		_label(g, -0.1 + i * 0.045, -0.13, sw[i], 9)
	_label(g, 0.205, -0.112, "ENGINE GAUGE", 10)
	return g

static func _label(g, x: float, y: float, t: String, size := 15, col := INK) -> void:
	g.fill_style = col; g.font = FONT % size; g.text_align = "center"; g.text_baseline = "middle"
	var p := px(x, y)
	g.fill_text(t, p.x, p.y)

static func _plate(g, x: float, y: float, w: float, h: float, lines: Array, bg := "#d6d0ba", fg := "#151515") -> void:
	var p0 := px(x - w / 2, y + h / 2)
	var x0 := p0.x
	var y0 := p0.y
	g.fill_style = bg; g.fill_rect(x0, y0, w * PX, h * PX)
	g.fill_style = fg; g.font = FONT % int(_round(h * PX / (lines.size() + 0.6))); g.text_align = "center"; g.text_baseline = "middle"
	for i in lines.size():
		g.fill_text(lines[i], x0 + w * PX / 2, y0 + (i + 0.8) * h * PX / (lines.size() + 0.6))
	screw(g, x0 + 6, y0 + 6, 3); screw(g, x0 + w * PX - 6, y0 + 6, 3)

static func screw(g, x: float, y: float, r: float, col := "#3a3c3e") -> void:
	g.fill_style = "#000a"; g.begin_path(); g.arc(x + 1, y + 1, r, 0, 7); g.fill()
	g.fill_style = col; g.begin_path(); g.arc(x, y, r, 0, 7); g.fill()
	g.stroke_style = "#0c0c0c"; g.line_width = maxf(1, r * 0.3); g.begin_path(); g.move_to(x - r * 0.7, y - r * 0.2); g.line_to(x + r * 0.7, y + r * 0.2); g.stroke()

## Angle (deg, clockwise from 12 o'clock) to canvas offsets at radius R.
static func at(a: float, R: float) -> Vector2:
	return Vector2(sin(a * DEG) * R, -cos(a * DEG) * R)

## A scale: ticks from min to max over angles a0..a1, numbers every `major`. Coloured arcs: [from, to, colour].
## The value's angle is lin(v) (or the scale's own map: `map` names one of MAP's).
static func scale(g, R: float, o: Dictionary) -> Callable:
	var mn: float = o["min"]
	var mx: float = o["max"]
	var a0: float = o.get("a0", 0.0)
	var a1: float = o.get("a1", 0.0)
	var major: float = o["major"]
	var minor: float = o["minor"]
	var num: Callable = o.get("num", func(v): return v)
	var num_every: float = o.get("numEvery", major)
	var arcs: Array = o.get("arcs", [])
	var map_id = o.get("map", null)
	var size: float = o.get("size", 0.2)
	var rad: float = o.get("rad", 0.66)
	var ang := func(v: float) -> float:
		return MAP(map_id, v) if map_id != null else a0 + ((v - mn) / (mx - mn)) * (a1 - a0)
	for arc in arcs:
		var f: float = arc[0]
		var t: float = arc[1]
		g.stroke_style = arc[2]; g.line_width = R * 0.07; g.begin_path()
		var v := f
		while v <= t + 1e-6:
			var p := at(ang.call(v), R * 0.86)
			if v == f:
				g.move_to(p.x, p.y)
			else:
				g.line_to(p.x, p.y)
			v += (t - f) / 24
		g.stroke()
	g.stroke_style = INK; g.fill_style = INK; g.line_cap = "butt"
	var eq := func(v: float, step: float) -> bool:
		return absf((v - mn) / step - _round((v - mn) / step)) < 1e-4
	var n := int(_round((mx - mn) / minor))
	for i in n + 1:
		var v := ("%.4f" % (mn + i * minor)).to_float()
		var big: bool = eq.call(v, major)
		var a: float = ang.call(v)
		g.line_width = R * 0.045 if big else R * 0.022
		var p0 := at(a, R * (0.76 if big else 0.83))
		var p1 := at(a, R * 0.95)
		g.begin_path(); g.move_to(p0.x, p0.y); g.line_to(p1.x, p1.y); g.stroke()
		if eq.call(v, num_every):
			g.font = FONT % int(_round(R * size)); g.text_align = "center"; g.text_baseline = "middle"
			var pt := at(a, R * rad)
			g.fill_text(_js_str(num.call(v)), pt.x, pt.y)
	return ang

static func text(g, s: String, x: float, y: float, size: float, col := INK) -> void:
	g.fill_style = col; g.font = FONT % int(_round(size)); g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(s, x, y)

## The scales' maps, shared by the faces and the needles (degrees clockwise from 12 o'clock).
static func MAP(id: String, v: float) -> float:
	match id:
		"speed": return -150 + (clampf(v, 40, 600) - 40) / 560 * 315 # mph, indicated
		"climb": return -90 + clampf(v, -6, 6) / 6 * 170 # thousands of ft/min: 0 at 9 o'clock, up clockwise
		"boost": return -140 + (clampf(v, 10, 75) - 10) / 65 * 280 # in. Hg
		"rpm": return -140 + clampf(v, 0, 35) / 35 * 280 # hundreds
		"turbo": return -135 + clampf(v, 0, 30) / 30 * 270 # thousands
		"carb": return -135 + (clampf(v, -50, 150) + 50) / 200 * 270 # deg C
		"cht": return -135 + clampf(v, 0, 350) / 350 * 270
		"accel": return -90 + (clampf(v, -5, 12) + 5) / 17 * 300 - 60
		"suction": return -120 + clampf(v, 0, 10) / 10 * 240
		"fuel": return -120 + clampf(v, 0, 300) / 300 * 240 # US gallons
		"hyd": return -120 + clampf(v, 0, 2000) / 2000 * 240
		"oxy": return -120 + clampf(v, 0, 500) / 500 * 240
	return 0.0

static func _lab(g, R: float, s: String, y: float, k := 0.13) -> void:
	text(g, s, 0, R * y, R * k)

static func _tick(g, a: float, r0: float, r1: float) -> void:
	var p0 := at(a, r0)
	var p1 := at(a, r1)
	g.begin_path(); g.move_to(p0.x, p0.y); g.line_to(p1.x, p1.y); g.stroke()

## One instrument's face: its flange and screws, the black face, its scale and lettering.
static func dial(g, id: String, cx: float, cy: float, R: float) -> void:
	g.save(); g.translate(cx, cy)
	for ab in [[-1, -1], [1, -1], [-1, 1], [1, 1]]:
		screw(g, ab[0] * (R + 9) * 0.86, ab[1] * (R + 9) * 0.86, maxf(4, R * 0.06))
	g.fill_style = "#050505"; g.begin_path(); g.arc(0, 0, R * 1.08, 0, 7); g.fill() # (the bezel's opening: the 3D bezel sits on its edge)
	g.fill_style = "#0d0d0d"; g.begin_path(); g.arc(0, 0, R, 0, 7); g.fill()
	var ident := func(v): return v
	match id:
		"clock":
			scale(g, R, {min = 0, max = 60, a0 = 0, a1 = 360, major = 5, minor = 1, num = func(v): return v / 5 if v else 12, numEvery = 5, size = 0.24, rad = 0.62})
			_lab(g, R, "8 DAY", 0.32, 0.12)
		"accel":
			scale(g, R, {min = -5, max = 12, map = "accel", major = 1, minor = 1, num = ident, numEvery = 5, size = 0.22, arcs = [[-5, -3, "#b02020"], [8, 12, "#b02020"]]})
			_lab(g, R, "G", -0.25, 0.22); _lab(g, R, "ACCELERATION", 0.38, 0.11)
		"suction":
			scale(g, R, {min = 0, max = 10, map = "suction", major = 2, minor = 1, arcs = [[3.75, 4.25, "#2e8a3a"]], size = 0.25})
			_lab(g, R, "SUCTION", 0.4, 0.15)
		"dg": # the directional gyro: its card turns behind a window; the caging knob below
			g.fill_style = "#000"; g.fill_rect(-R * 0.66, -R * 0.36, R * 1.32, R * 0.52)
			g.stroke_style = "#888"; g.line_width = 2; g.stroke_rect(-R * 0.66, -R * 0.36, R * 1.32, R * 0.52)
			_lab(g, R, "DIRECTIONAL GYRO", -0.6, 0.12); _lab(g, R, "PUSH TO CAGE", 0.42, 0.11); _lab(g, R, "SET", 0.64, 0.12)
		"horizon": # the Sperry gyro horizon: the bank scale round the top, the window black, the bar and aeroplane over it
			for a in [-90, -60, -30, -20, -10, 0, 10, 20, 30, 60, 90]:
				g.stroke_style = INK; g.line_width = R * 0.025 if a % 30 else R * 0.05
				_tick(g, a, R * 0.82, R * 0.96)
			g.stroke_style = "#555"; g.line_width = 2; g.begin_path(); g.arc(0, 0, R * 0.8, 0, 7); g.stroke()
			_lab(g, R, "GYRO HORIZON", 0.6, 0.11)
		"speed":
			scale(g, R, {min = 40, max = 600, map = "speed", major = 50, minor = 10, num = ident, numEvery = 100, size = 0.17, arcs = [[495, 505, "#c02020"]]})
			_lab(g, R, "AIR SPEED", -0.32, 0.12); _lab(g, R, "M.P.H.", 0.34, 0.12)
		"alt":
			scale(g, R, {min = 0, max = 10, a0 = 0, a1 = 360, major = 1, minor = 0.2, num = func(v): return v if v < 10 else "", numEvery = 1, size = 0.22, rad = 0.62})
			_lab(g, R, "ALTITUDE", -0.3, 0.11); _lab(g, R, "FEET", 0.3, 0.11)
			g.fill_style = "#000"; g.fill_rect(R * 0.32, -R * 0.08, R * 0.32, R * 0.16); text(g, "29.9", R * 0.48, 0, R * 0.11) # (the Kollsman window)
		"turn": # turn and bank: the needle's index marks, the ball's glass tube
			for a in [-20, 0, 20]:
				g.stroke_style = INK; g.line_width = R * 0.05
				_tick(g, a, R * 0.78, R * 0.94)
			g.fill_style = "#d8d2c0"; g.begin_path(); g.ellipse(0, R * 0.5, R * 0.62, R * 0.16, 0, 0, 7); g.fill() # the tube
			g.fill_style = "#9a9278"; g.begin_path(); g.ellipse(0, R * 0.5, R * 0.62, R * 0.07, 0, 0, PI); g.fill()
			g.stroke_style = "#111"; g.line_width = 3
			for s in [-1, 1]:
				g.begin_path(); g.move_to(s * R * 0.14, R * 0.36); g.line_to(s * R * 0.14, R * 0.64); g.stroke()
			_lab(g, R, "L", -0.1, 0.2); text(g, "L", -R * 0.5, -R * 0.15, R * 0.2); text(g, "R", R * 0.5, -R * 0.15, R * 0.2); _lab(g, R, "TURN", 0.2, 0.12)
		"climb":
			scale(g, R, {min = -6, max = 6, map = "climb", major = 1, minor = 0.5, num = func(v): return absf(v), numEvery = 1, size = 0.18})
			_lab(g, R, "UP", -0.3, 0.13); _lab(g, R, "DOWN", 0.3, 0.13); _lab(g, R, "RATE OF CLIMB", 0.04, 0.09); text(g, "1000 FT PER MIN", R * 0.28, R * 0.55, R * 0.08)
		"turbo":
			scale(g, R, {min = 0, max = 30, map = "turbo", major = 5, minor = 1, num = ident, numEvery = 10, size = 0.24, arcs = [[22, 30, "#c02020"], [8, 20, "#2e8a3a"]]})
			_lab(g, R, "TURBO", -0.3, 0.15); _lab(g, R, "RPM x1000", 0.4, 0.12)
		"boost":
			scale(g, R, {min = 10, max = 75, map = "boost", major = 5, minor = 1, num = ident, numEvery = 10, size = 0.2, arcs = [[28, 42, "#2e8a3a"], [52, 56, "#c02020"]]})
			_lab(g, R, "MANIFOLD", -0.3, 0.12); _lab(g, R, "PRESSURE", -0.15, 0.1); _lab(g, R, "IN. HG.", 0.36, 0.11)
		"rpm":
			scale(g, R, {min = 0, max = 35, map = "rpm", major = 5, minor = 1, num = ident, numEvery = 5, size = 0.2, arcs = [[20, 25.5, "#2e8a3a"], [26.8, 27.2, "#c02020"]]})
			_lab(g, R, "TACHOMETER", -0.3, 0.11); _lab(g, R, "R.P.M. x100", 0.38, 0.11)
		"engine": # the engine gauge unit: fuel pressure, oil pressure, oil temperature in one case
			for e in [[-0.42, -0.3, "FUEL", 25, "LBS"], [0.42, -0.3, "OIL", 200, "LBS"], [0, 0.38, "OIL", 100, "°C"]]:
				var mx: float = e[3]
				g.save(); g.translate(e[0] * R, e[1] * R)
				g.stroke_style = "#444"; g.line_width = 1.5; g.begin_path(); g.arc(0, 0, R * 0.46, 0, 7); g.stroke()
				scale(g, R * 0.46, {min = 0, max = mx, a0 = -110, a1 = 110, major = mx / 5, minor = mx / 10, num = ident, numEvery = mx / 5 * (2 if mx == 200 else 1), size = 0.3, rad = 0.6})
				text(g, e[2], 0, R * 0.15, R * 0.11); text(g, e[4], 0, R * 0.27, R * 0.08)
				g.restore()
		"carb":
			scale(g, R, {min = -50, max = 150, map = "carb", major = 50, minor = 10, num = ident, numEvery = 50, size = 0.24, arcs = [[15, 38, "#2e8a3a"]]})
			_lab(g, R, "CARB. AIR", 0.36, 0.14)
		"cht":
			scale(g, R, {min = 0, max = 350, map = "cht", major = 50, minor = 25, num = ident, numEvery = 100, size = 0.24, arcs = [[150, 232, "#2e8a3a"], [260, 270, "#c02020"]]})
			_lab(g, R, "CYL. TEMP", 0.36, 0.14)
		"fuel":
			scale(g, R, {min = 0, max = 300, map = "fuel", major = 50, minor = 25, num = ident, numEvery = 100, size = 0.22})
			_lab(g, R, "FUEL", -0.3, 0.15); _lab(g, R, "U.S. GALLONS", 0.36, 0.12); _lab(g, R, "MAIN", 0.55, 0.12)
		"hyd":
			scale(g, R, {min = 0, max = 2000, map = "hyd", major = 500, minor = 250, num = func(v): return v / 100, numEvery = 1000, size = 0.26, arcs = [[800, 1100, "#2e8a3a"]]})
			_lab(g, R, "HYD.", 0.4, 0.17)
		"oxy":
			scale(g, R, {min = 0, max = 500, map = "oxy", major = 100, minor = 50, num = func(v): return v / 100, numEvery = 100, size = 0.26, arcs = [[400, 425, "#2e8a3a"]]})
			_lab(g, R, "OXYGEN", 0.4, 0.15)
	# the glass's glint
	var gl = g.create_linear_gradient(-R, -R, R * 0.4, R * 0.3)
	gl.add_color_stop(0, "#ffffff1c"); gl.add_color_stop(0.5, "#ffffff05"); gl.add_color_stop(0.55, "#ffffff00")
	g.fill_style = gl; g.begin_path(); g.arc(0, 0, R, 0, 7); g.fill()
	g.restore()

static func compass_face(g) -> void:
	var x: float = COMPASS[0]
	var y: float = COMPASS[1]
	var w: float = COMPASS[2]
	var h: float = COMPASS[3]
	var p0 := px(x - w / 2, y + h / 2)
	var x0 := p0.x
	var y0 := p0.y
	g.fill_style = "#1a1a1a"; g.fill_rect(x0 - 6, y0 - 6, w * PX + 12, h * PX + 12)
	g.fill_style = "#000"; g.fill_rect(x0 + w * PX * 0.12, y0 + h * PX * 0.2, w * PX * 0.76, h * PX * 0.5)
	text(g, "COMPASS", x0 + w * PX / 2, y0 + h * PX * 0.86, 14)
	for ab in [[0, 0], [1, 0], [0, 1], [1, 1]]:
		screw(g, x0 + ab[0] * w * PX, y0 + ab[1] * h * PX, 4)

## A heading card on a strip (for the gyro and the compass): ticks every 5 degrees, numbers every 30, N E S W.
## (Its repeat and offset are the material's uv1_scale and uv1_offset.)
static func card_tex(bg := "#0e0e0e", ink := INK) -> Texture2D:
	var g = Canvas2D.new(2048, 128)
	g.fill_style = bg; g.fill_rect(0, 0, 2048, 128)
	g.stroke_style = ink; g.fill_style = ink; g.text_align = "center"; g.text_baseline = "middle"
	var names := {0: "N", 90: "E", 180: "S", 270: "W"}
	for d in range(0, 360, 5):
		var x := d / 360.0 * 2048
		var big := d % 10 == 0
		g.line_width = 4 if big else 2; g.begin_path(); g.move_to(x, 0); g.line_to(x, 34 if big else 22); g.stroke()
		if d % 30 == 0:
			g.font = FONT % 54
			g.fill_text(names.get(d, str(d / 10)), x, 84)
	_keep.append(g)
	return g.texture(true)

## The N-3B's crash pad lettering: NO HAND HOLD, white on the black rubber.
static func pad_tex() -> Texture2D:
	var g = Canvas2D.new(256, 128)
	g.fill_style = "#141414"; g.fill_rect(0, 0, 256, 128)
	text(g, "NO", 128, 34, 34, "#d8d4c6"); text(g, "HAND HOLD", 128, 84, 34, "#d8d4c6")
	_keep.append(g)
	return g.texture(true)

static var GRAIN: Texture2D = null
static var _grain_canvas = null # (kept: a canvas fills its texture a few frames later, and only while it lives)
## Paint grain and wear (a multiplier on the colour): made once.
static func grain_tex() -> Texture2D:
	if GRAIN:
		return GRAIN
	var g = Canvas2D.new(256, 256)
	var r := rng(19)
	g.fill_style = "#dcdcdc"; g.fill_rect(0, 0, 256, 256)
	for i in 90:
		var x: float = r.call() * 256
		var y: float = r.call() * 256
		var rr: float = 6 + r.call() * 30
		var gr = g.create_radial_gradient(x, y, 0, x, y, rr)
		gr.add_color_stop(0, "rgba(0,0,0,%s)" % str(0.05 + r.call() * 0.08)); gr.add_color_stop(1, "rgba(0,0,0,0)")
		g.fill_style = gr; g.fill_rect(x - rr, y - rr, rr * 2, rr * 2)
	for i in 5000:
		var v := int(190 + r.call() * 65)
		g.fill_style = "rgba(%d,%d,%d,0.3)" % [v, v, v]; g.fill_rect(r.call() * 256, r.call() * 256, 1.2, 1.2)
	_grain_canvas = g
	GRAIN = g.texture(true)
	return GRAIN

## Triplanar-ish uv in metres (so the grain is the same size everywhere): from position, by the face's main axis.
static func box_uv(g):
	var n: int = g.positions.size()
	var uv := PackedVector2Array()
	uv.resize(n)
	for i in n:
		var p: Vector3 = g.positions[i]
		var nn: Vector3 = g.normals[i]
		var ax := absf(nn.x)
		var ay := absf(nn.y)
		var az := absf(nn.z)
		var u: Vector2
		if ax > ay and ax > az:
			u = Vector2(p.z, p.y)
		elif ay > az:
			u = Vector2(p.x, p.z)
		else:
			u = Vector2(p.x, p.y)
		uv[i] = u * 2.5
	g.uvs = uv
	return g

# ---------- the cockpit

# the static parts while the cockpit is built, by material ("fit", "metal")
static var _parts := {}
# the canvases drawn while it's built: they fill their textures over the next frames, and only while they live,
# so the cockpit's root keeps them (meta "canvases"), as Three's CanvasTextures keep theirs
static var _keep := []

static func put(list: String, geo, hex: int, ao := true) -> void:
	_parts[list].append(box_uv(paint_geo(geo, hex, ao)))

static func P(x: float, y: float, z: float) -> Vector3:
	return Vector3(x, y, z)

const Z0 := -1.25
const Z1 := 0.75
## A point on the inside of the fuselage's skin.
static func inner(z: float, a: float, k := 0.975) -> Vector3:
	var p: Vector3 = P47.fuse_point(z, a)
	var mid: float = P47.fuse(z)[2]
	return Vector3(p.x * k, mid + (p.y - mid) * k, z)

## The inside of the fuselage's wall at z, y high.
static func wall_x(z: float, y: float) -> float:
	var f: Array = P47.fuse(z)
	var hw: float = f[0]
	var top: float = f[1]
	var mid: float = f[2]
	var bot: float = f[3]
	var n := 2.4
	var k := minf(1, absf((y - mid) / (top - mid if y > mid else mid - bot)))
	return hw * pow(1 - pow(k, n), 1 / n) * 0.96

static func wheel(x: float, y: float, z: float, r: float, hex := BLACK) -> void:
	put("fit", Geo.torus(r, r * 0.13, 8, 28).rotate_y(PI / 2).translate(x, y, z), hex)
	for k in 3:
		put("fit", Geo.box(0.006, r * 2, r * 0.12).rotate_x((k / 3.0) * PI).translate(x, y, z), hex)
	put("fit", Geo.cylinder(r * 0.25, r * 0.25, 0.02, 10).rotate_z(PI / 2).translate(x, y, z), hex)

const GREEN := 0x3b4a32
const ZINC := 0x56683e
const BLACK := 0x141414
const LEATHER := 0x3a2618
const SUIT := 0x5f5640
const KHAKI := 0x7d7158
const STEEL := 0x707478
const ALU := 0x9a9ea2

static func _mesh(geo, mat: Material) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = geo.to_mesh(mat)
	return m

static func _xyz(n: Node3D) -> Node3D:
	n.rotation_order = EULER_ORDER_XYZ
	return n

## The P-47's cockpit; call get_meta("update").call(state, dt) every frame and get_meta("night").call(k) when the
## light changes.
static func build_cockpit_p47() -> Node3D:
	var root := Node3D.new()
	root.name = "CockpitP47"
	# (placed on the fighter each frame by pilot.gd; everything in the model's own frame)
	# ---- the aeroplane round you: p47.gd's model, without its pilot and outside glass; the propeller a faint blur
	var shell: Node3D = P47.build_p47()
	for nm in ["P47_Pilot", "P47_Canopy", "P47_Frames"]:
		var n := shell.find_child(nm, true, false)
		if n:
			n.get_parent().remove_child(n)
			n.free()
	(shell.find_child("P47_Blades", true, false) as Node3D).visible = false
	var disc := shell.find_child("Fake_Blades", true, false) as MeshInstance3D
	disc.visible = true
	disc.material_override = Mat.basic({color = 0x202020, transparent = true, opacity = 0.06, depthWrite = false, side = Mat.DOUBLE})
	var hub := shell.find_child("P47_Spinner", true, false) as Node3D
	root.add_child(shell)

	var grain := grain_tex()
	var fit := Mat.standard({vertexColors = true, map = grain, roughness = 0.78, metalness = 0.15, side = Mat.DOUBLE}) # paint, rubber, leather, cloth
	var metal := Mat.standard({vertexColors = true, map = grain, roughness = 0.38, metalness = 0.85}) # steel, aluminium
	for m in [fit, metal]:
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	_parts = {fit = [], metal = []}
	_keep = []
	var parts := _parts

	# ---- the inside of the fuselage: its skin, frames and stringers from the windscreen back past the seat,
	# down into the belly (no floor), the ducts under you
	if true:
		var rows := []
		var seg := 40
		var zs := []
		var zz := Z0
		while zz <= Z1 + 1e-6:
			zs.append(zz)
			zz += 0.1
		for z in zs:
			var row := []
			for k in seg + 1:
				var p := inner(z, -PI / 2 + (float(k) / seg) * PI * 2)
				p.y = minf(p.y, P47.SILL - 0.01)
				row.append(p)
			rows.append(row)
		var pos := PackedVector3Array()
		for i in rows.size() - 1:
			for k in seg:
				var a: Vector3 = rows[i][k]
				var b: Vector3 = rows[i][k + 1]
				var c: Vector3 = rows[i + 1][k]
				var d: Vector3 = rows[i + 1][k + 1]
				if minf(minf(a.y, b.y), minf(c.y, d.y)) > P47.SILL - 0.0105:
					continue # (open above the sills)
				pos.append_array([a, c, b, b, c, d])
		var skin_in = Geo.from_arrays(pos)
		skin_in.compute_vertex_normals()
		put("fit", skin_in, GREEN)
		# the frames: a deep flange round the inside at each station, and the stringers along it
		for z in [-1.2, -0.92, -0.62, -0.32, -0.02, 0.28, 0.58]:
			var fr := []
			for k in 33:
				var a := -PI / 2 + (k / 32.0) * PI * 2
				var o := inner(z, a)
				var ii := inner(z, a, 0.9)
				if o.y > P47.SILL - 0.01:
					o.y = P47.SILL - 0.01
					ii.y = P47.SILL - 0.01
				fr.append([o, ii])
			for k in 32:
				var o0: Vector3 = fr[k][0]
				var i0: Vector3 = fr[k][1]
				var o1: Vector3 = fr[k + 1][0]
				var i1: Vector3 = fr[k + 1][1]
				if o0.y >= P47.SILL - 0.011 and o1.y >= P47.SILL - 0.011:
					continue
				put("fit", quad(o0, o1, i1, i0), ZINC)
				put("fit", quad(i0, i1, Vector3(i1.x, i1.y, z + 0.02), Vector3(i0.x, i0.y, z + 0.02)), ZINC)
		for k in 18:
			var a := -PI / 2 + (k / 18.0) * PI * 2
			var p0 := inner(Z0, a, 0.96)
			var p1 := inner(Z1, a, 0.96)
			if p0.y > P47.SILL - 0.05:
				continue
			put("fit", rod(p0, p1, 0.008, 4), ZINC)
		# the cockpit's sills: a broad, padded edge either side, the canopy rails on them
		for s in [-1, 1]:
			var x := absf(inner(-0.2, 0, 1).x)
			put("fit", Geo.box(0.06, 0.03, Z1 - P47.WS_Z).translate(s * (x - 0.03), P47.SILL - 0.02, (Z1 + P47.WS_Z) / 2), GREEN)
		# the turbo's ducts running forward under the cockpit to the engine, and the belly's keel
		for s in [-1, 1]:
			put("fit", rod(P(s * 0.24, -0.62, Z0), P(s * 0.22, -0.6, Z1), 0.13, 14), 0x5e605a)
		put("metal", rod(P(0, -0.92, Z0), P(0, -0.86, Z1), 0.03, 6), 0x55585a)
		# the firewall ahead of your feet, behind the panel
		var fw := []
		for k in 25:
			fw.append(inner(-1.25, -PI / 2 + (k / 24.0) * PI * 2, 0.98))
		for k in 24:
			put("fit", Geo.from_arrays(PackedVector3Array([P(0, 0, -1.25), fw[k + 1], fw[k]])), 0x2b3326)

	# ---- the seat on its rails, the parachute pack in it, the armour plate and headrest behind your head; the
	# shoulder harness and lap belt
	put("fit", Geo.cylinder(0.25, 0.23, 0.42, 20, 1, true, -PI * 0.55, PI * 1.1).rotate_y(PI).scale(1, 1, 0.6).translate(0, 0.5, 0.2), ZINC)
	put("fit", Geo.box(0.46, 0.03, 0.42).translate(0, 0.28, 0.06), ZINC)
	put("fit", Geo.rounded_box(0.4, 0.1, 0.38, 2, 0.03).translate(0, 0.33, 0.06), 0x50483a) # the seat-pack parachute
	for s in [-1, 1]:
		put("metal", rod(P(s * 0.2, 0.0, 0.28), P(s * 0.2, 0.28, 0.2), 0.015, 6), STEEL)
	put("metal", Geo.box(0.42, 0.6, 0.014).rotate_x(0.08).translate(0, 0.92, 0.2), 0x55595c) # the armour plate
	put("fit", Geo.rounded_box(0.2, 0.13, 0.06, 2, 0.02).translate(0, 1.1, 0.16), LEATHER) # the headrest
	for s in [-1, 1]:
		put("fit", rod(P(s * 0.1, 0.9, 0.16), P(s * 0.12, 0.85, -0.05), 0.022, 4), KHAKI) # the shoulder straps over you
		put("fit", rod(P(s * 0.12, 0.85, -0.05), P(s * 0.08, 0.5, -0.12), 0.022, 4), KHAKI)
		put("fit", rod(P(s * 0.2, 0.36, 0.0), P(s * 0.05, 0.42, -0.14), 0.025, 4), KHAKI) # the lap belt
	put("metal", Geo.cylinder(0.035, 0.035, 0.012, 14).rotate_x(PI / 2 - 0.3).translate(0, 0.45, -0.15), ALU) # the harness's buckle

	# ---- you: the chest of your jacket, your legs on the rudder pedals
	put("fit", Geo.capsule(0.15, 0.18, 4, 12).scale(1.2, 1, 0.75).translate(0, 0.62, 0.02), 0x4a3424) # (the A-2 jacket)
	for s in [-1, 1]:
		var hip := P(s * 0.11, 0.38, -0.02)
		var knee := P(s * 0.15, 0.5, -0.5)
		var heel := P(s * 0.16, 0.04, -0.86)
		put("fit", rod(hip, knee, 0.075, 12, 0.062), SUIT); put("fit", Geo.sphere(0.066, 12, 8).translate(knee.x, knee.y, knee.z), SUIT)
		put("fit", rod(knee, heel, 0.058, 12, 0.05), SUIT)
		put("fit", Geo.rounded_box(0.1, 0.09, 0.28, 2, 0.03).rotate_x(0.5).translate(heel.x, heel.y + 0.0, heel.z - 0.06), 0x2a1d14) # the boot
		# the rudder pedal: its frame, the tread, the heel rest
		put("fit", Geo.box(0.12, 0.2, 0.02).rotate_x(0.5).translate(heel.x, heel.y + 0.02, heel.z - 0.13), BLACK)
		put("metal", rod(P(heel.x, -0.15, -0.95), P(heel.x, heel.y - 0.05, heel.z - 0.18), 0.012, 6), STEEL)
	put("metal", rod(P(-0.3, -0.15, -0.95), P(0.3, -0.15, -0.95), 0.018, 8), STEEL) # the pedals' cross shaft

	# ---- the left side: the throttle quadrant (boost lever outboard, then the throttle, propeller and mixture),
	# the trim tab wheels (elevator, rudder, aileron), the landing gear and flap handles, the fuel selector
	var QX := -wall_x(-0.42, 0.6) + 0.1
	var QY := 0.6
	var QZ := -0.44
	put("fit", Geo.rounded_box(0.09, 0.07, 0.3, 2, 0.012).translate(QX, QY, QZ), BLACK) # the quadrant's box
	put("fit", Geo.box(0.2, 0.02, 0.6).translate(QX - 0.05, QY - 0.045, -0.3), GREEN) # the shelf it's on
	for k in 4:
		put("metal", Geo.box(0.005, 0.004, 0.22).translate(QX - 0.03 + k * 0.02, QY + 0.036, QZ), 0x222222) # the levers' slots
	var T := Vector3(QX - 0.012, QY + 0.035, QZ)
	var LX := -wall_x(0, 0.6) + 0.04
	wheel(LX, 0.6, -0.08, 0.085) # the elevator's trim tab wheel, big, on the wall
	wheel(LX + 0.02, 0.66, 0.09, 0.05) # the rudder's
	put("fit", Geo.cylinder(0.02, 0.022, 0.03, 12).rotate_z(PI / 2).translate(LX + 0.06, 0.7, 0.2), BLACK) # the aileron's trim knob
	put("fit", Geo.rounded_box(0.06, 0.1, 0.12, 2, 0.01).translate(LX + 0.01, 0.6, 0.09), GREEN) # their housing
	# the landing gear handle (its knob the shape of a wheel) and the flap handle (an aerofoil), forward on the left
	put("metal", rod(P(LX + 0.05, 0.52, -0.72), P(LX + 0.09, 0.62, -0.66), 0.008), STEEL)
	put("fit", Geo.cylinder(0.028, 0.028, 0.016, 16).rotate_z(PI / 2).translate(LX + 0.09, 0.625, -0.66), BLACK)
	put("metal", rod(P(LX + 0.05, 0.5, -0.58), P(LX + 0.08, 0.6, -0.55), 0.007), STEEL)
	put("fit", Geo.rounded_box(0.05, 0.016, 0.03, 2, 0.006).translate(LX + 0.08, 0.605, -0.55), BLACK)
	put("fit", Geo.box(0.1, 0.12, 0.2).translate(LX + 0.03, 0.52, -0.64), GREEN) # their box
	put("fit", Geo.cylinder(0.05, 0.05, 0.02, 16).translate(-0.24, 0.12, -0.6), 0x8a2016) # the fuel selector's red dial
	put("metal", Geo.box(0.08, 0.012, 0.016).translate(-0.24, 0.135, -0.6), ALU)
	# ---- the right side: the radio's control box (four buttons, A to D, and OFF), the oxygen regulator, the switch
	# box, the cowl flap lever, the canopy's crank on the sill
	var RX := wall_x(-0.3, 0.7) - 0.11
	put("fit", Geo.box(0.2, 0.02, 0.62).translate(RX + 0.04, 0.65, -0.3), GREEN) # the shelf
	put("fit", Geo.rounded_box(0.11, 0.08, 0.18, 2, 0.01).translate(RX, 0.7, -0.34), BLACK) # the SCR-522's box
	for k in 5:
		put("fit", Geo.box(0.011, 0.01, 0.014).translate(RX - 0.036 + k * 0.018, 0.744, -0.4), 0x8a2016 if k == 0 else 0xb8b2a0) # (OFF, red; A, B, C, D)
	put("fit", Geo.cylinder(0.005, 0.005, 0.01, 6).translate(RX + 0.03, 0.745, -0.3), 0x2a8a2a)
	put("fit", Geo.cylinder(0.055, 0.055, 0.06, 18).rotate_z(PI / 2).translate(RX + 0.06, 0.66, -0.66), 0x2a3022) # the A-12 oxygen regulator
	put("fit", Geo.cylinder(0.042, 0.042, 0.004, 18).rotate_z(PI / 2).translate(RX + 0.028, 0.66, -0.66), 0xcfc8b0)
	put("fit", Geo.box(0.1, 0.06, 0.16).translate(RX, 0.69, -0.12), BLACK) # the switch box
	for k in 6:
		put("metal", rod(P(RX - 0.03 + (k % 3) * 0.03, 0.72, -0.16 + floorf(k / 3.0) * 0.06), P(RX - 0.03 + (k % 3) * 0.03, 0.75, -0.17 + floorf(k / 3.0) * 0.06), 0.004, 5), ALU)
	put("metal", rod(P(RX + 0.03, 0.62, 0.08), P(RX, 0.74, 0.05), 0.008), STEEL); put("fit", Geo.sphere(0.018, 10, 8).translate(RX, 0.745, 0.05), BLACK) # the cowl flap lever
	if true: # the canopy crank
		var cx := wall_x(-0.1, 0.78) - 0.06
		put("fit", Geo.cylinder(0.05, 0.05, 0.02, 16).rotate_z(PI / 2).translate(cx, 0.74, 0.02), BLACK)
		put("metal", rod(P(cx - 0.02, 0.74, 0.02), P(cx - 0.02, 0.69, 0.05), 0.006), STEEL)
		put("fit", Geo.cylinder(0.012, 0.012, 0.04, 8).rotate_z(PI / 2).translate(cx - 0.04, 0.69, 0.05), BLACK)
	put("fit", Geo.box(0.03, 0.2, 0.32).translate(wall_x(0.1, 0.6) - 0.03, 0.55, 0.15), 0x4b4232) # the map case

	# ---- the instrument panel: one textured face, the dials' bezels and glasses standing out of it, the coaming
	# over it, the N-3B sight on top
	var pg := _xyz(Node3D.new())
	pg.name = "Panel"
	pg.position = PANEL_AT
	pg.rotation.x = PANEL_TILT
	root.add_child(pg)
	var pm := pg.transform
	var art = panel_art()
	_keep.append(art)
	var face_tex: Texture2D = art.texture(true)
	var face_mat := Mat.standard({map = face_tex, emissiveMap = face_tex, emissive = 0x000000, roughness = 0.62, metalness = 0.1})
	face_mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	face_mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY # (Three's emissive times emissiveMap; Godot adds them by default)
	# the panel's outline: square below, its top corners cut away under the sills
	var outline := [[-PW / 2, -PH / 2], [PW / 2, -PH / 2], [PW / 2, 0.06], [0.33, PH / 2], [-0.33, PH / 2], [-PW / 2, 0.06]]
	var pts := []
	var pts_back := []
	for o in outline:
		pts.append(Vector2(o[0], o[1]))
		pts_back.append(Vector2(o[0] * 1.02, o[1] * 1.04))
	var face_geo = Geo.shape(Shapes.Shape.new(pts))
	for i in face_geo.positions.size():
		var p: Vector3 = face_geo.positions[i]
		face_geo.uvs[i] = Vector2(p.x / PW + 0.5, p.y / PH + 0.5)
	var face := _mesh(face_geo, face_mat)
	face.name = "Face"
	pg.add_child(face)
	var back = Geo.extrude(Shapes.Shape.new(pts_back), {depth = 0.05, bevelEnabled = false}).translate(0, 0, -0.052)
	parts.fit.append(box_uv(paint_geo(back.apply_transform(pm), BLACK, false)))
	# the bezels round each dial, their screws standing out; the glass over each
	var glass_geo := []
	for d in DIALS:
		var x: float = d[1]
		var y: float = d[2]
		var r: float = d[3]
		parts.fit.append(box_uv(paint_geo(Geo.torus(r * 1.06, 0.0035, 6, 36).scale(1, 1, 2.2).translate(x, y, 0.004).apply_transform(pm), 0x1c1c1c, false)))
		glass_geo.append(Geo.circle(r * 1.04, 32).translate(x, y, 0.009))
	parts.fit.append(box_uv(paint_geo(Geo.rounded_box(COMPASS[2] + 0.012, COMPASS[3] + 0.012, 0.035, 2, 0.004).translate(COMPASS[0], COMPASS[1], 0.012).apply_transform(pm), 0x1a1a1a, false)))
	# the switches along the bottom: toggles, the ignition's rotary switch, the primer's knob
	for i in 6:
		var x := -0.1 + i * 0.045
		parts.fit.append(box_uv(paint_geo(Geo.cylinder(0.008, 0.008, 0.012, 10).rotate_x(PI / 2).translate(x, -0.15, 0.006).apply_transform(pm), 0x333333, false)))
		parts.metal.append(box_uv(paint_geo(rod(P(x, -0.15, 0.01), P(x, -0.142, 0.038), 0.0035, 6).apply_transform(pm), ALU, false)))
	parts.fit.append(box_uv(paint_geo(Geo.cylinder(0.022, 0.024, 0.025, 18).rotate_x(PI / 2).translate(-0.33, -0.14, 0.012).apply_transform(pm), 0x1a1a1a, false)))
	parts.fit.append(box_uv(paint_geo(Geo.box(0.008, 0.032, 0.012).rotate_z(-0.8).translate(-0.33, -0.14, 0.03).apply_transform(pm), 0x2a2a2a, false)))
	for xy in [[-0.06, 0.12], [0.06, 0.12]]: # the gyros' knobs
		parts.fit.append(box_uv(paint_geo(Geo.cylinder(0.008, 0.009, 0.018, 12).rotate_x(PI / 2).translate(xy[0] + 0.03, xy[1] - 0.034, 0.012).apply_transform(pm), 0x222222, false)))
	for s in [-1, 1]: # the gear's lamps (dark: wheels up)
		parts.fit.append(box_uv(paint_geo(Geo.sphere(0.008, 10, 6).translate(-0.235 + s * 0.012, 0.13, 0.004).apply_transform(pm), 0x2a3a2a, false)))
	var cover_mat := Mat.physical({color = 0xd8e6ec, transparent = true, opacity = 0.08, roughness = 0.04, metalness = 0, depthWrite = false, clearcoat = 1})
	cover_mat.render_priority = 1 # (renderOrder 1)
	var covers := _mesh(Geo.merge(glass_geo), cover_mat)
	covers.name = "Covers"
	pg.add_child(covers)
	# the coaming: a padded black hood over the panel from its top edge forward to the windscreen's foot
	if true:
		var rows := []
		for zk in [[-0.735, 1.0], [-0.79, 0.98], [-0.86, 0.94]]:
			var z: float = zk[0]
			var k: float = zk[1]
			var row := []
			for j in 21:
				var x := -0.36 + (j / 20.0) * 0.72
				row.append(P(x * k, 0.81 + 0.035 * (1 - pow(x / 0.36, 2)) + (z + 0.735) * 0.25, z))
			rows.append(row)
		var pos := PackedVector3Array()
		for i in rows.size() - 1:
			for j in 20:
				var a: Vector3 = rows[i][j]
				var b: Vector3 = rows[i][j + 1]
				var c: Vector3 = rows[i + 1][j]
				var d: Vector3 = rows[i + 1][j + 1]
				pos.append_array([a, b, c, b, d, c])
		var hood = Geo.from_arrays(pos)
		hood.compute_vertex_normals()
		put("fit", hood, 0x161616, false)
		var lip := []
		for j in 21:
			var x := -0.36 + (j / 20.0) * 0.72
			lip.append(P(x, 0.8 + 0.035 * (1 - pow(x / 0.36, 2)), -0.73))
		for j in 20:
			put("fit", rod(lip[j], lip[j + 1], 0.016, 8), 0x231a12, false) # its leather roll
	# the N-3B reflector sight: its body on a bracket on the coaming, the lamp housing below and behind, the
	# dimmer's knob, the reflector glass on your eye line, the sun filter folded down ahead of it, the crash pad
	# (its body sits on the coaming, the glass rising out of its top to your eye line; the lamp housing reaches
	# forward under the windscreen)
	var SY := 0.925
	var SZ := -0.68
	put("fit", Geo.rounded_box(0.068, 0.075, 0.12, 2, 0.01).translate(0, SY, SZ), 0x161616, false)
	put("fit", Geo.cylinder(0.026, 0.026, 0.1, 16).rotate_x(PI / 2).translate(0, SY - 0.01, SZ - 0.1), 0x161616, false)
	put("fit", Geo.box(0.05, 0.08, 0.09).translate(0, SY - 0.07, SZ - 0.01), 0x222222, false) # the bracket
	put("metal", Geo.cylinder(0.011, 0.011, 0.018, 12).rotate_z(PI / 2).translate(-0.043, SY + 0.012, SZ + 0.01), ALU, false) # the dimmer
	put("fit", Geo.cylinder(0.016, 0.016, 0.01, 16).rotate_z(PI / 2).translate(0.04, SY - 0.01, SZ), BLACK, false)
	for s in [-1, 1]:
		put("fit", Geo.box(0.005, 0.03, 0.03).translate(s * 0.045, SY + 0.05, SZ - 0.02), 0x161616, false) # the glass's clamps
	put("fit", Geo.box(0.095, 0.007, 0.03).translate(0, SY + 0.04, SZ - 0.02), 0x161616, false)
	var refl_mat := Mat.physical({color = 0xa8c8cc, transparent = true, opacity = 0.16, roughness = 0.02, depthWrite = false, side = Mat.DOUBLE})
	refl_mat.render_priority = 2 # (renderOrder 2)
	var reflector := _xyz(_mesh(Geo.plane(0.088, 0.15), refl_mat))
	reflector.name = "Reflector"
	reflector.position = Vector3(0, 1.035, SZ - 0.05); reflector.rotation.x = -0.72
	root.add_child(reflector)
	reflector.add_child(_mesh(Geo.merge([-1, 1].map(func(x): return paint_geo(Geo.box(0.003, 0.15, 0.006).translate(x * 0.0445, 0, 0), 0x2a3a3c, false))), fit)) # (its edges, catching the light)
	var filter_mat := Mat.physical({color = 0x6a5a30, transparent = true, opacity = 0.45, roughness = 0.1, depthWrite = false, side = Mat.DOUBLE})
	filter_mat.render_priority = 2
	var filter := _xyz(_mesh(Geo.plane(0.084, 0.05), filter_mat))
	filter.position = Vector3(0, SY + 0.05, SZ - 0.075); filter.rotation.x = -1.45 # (the sun filter, folded down ahead of it)
	root.add_child(filter)
	var pad := _xyz(_mesh(Geo.rounded_box(0.066, 0.036, 0.026, 3, 0.01), Mat.standard({color = 0xffffff, map = pad_tex(), roughness = 0.9})))
	pad.position = Vector3(0, SY + 0.03, SZ + 0.065); pad.rotation.x = -0.5
	root.add_child(pad)

	# ---- the moving needles: three multimeshes (needles, bars, dots) on the panel
	var needle_shape := Shapes.Shape.new([[-0.06, -0.2], [0.06, -0.2], [0.05, 0], [0.018, 0.82], [0, 1], [-0.018, 0.82], [-0.05, 0]].map(func(q): return Vector2(q[0], q[1])))
	var hand_mat := Mat.standard({color = 0xffffff, roughness = 0.5, emissive = 0x000000})
	hand_mat.vertex_color_use_as_albedo = true # (each instance's colour, as Three's instanceColor)
	hand_mat.vertex_color_is_srgb = true
	var hands := []
	var bars := []
	var dots := []
	# a needle on dial id: value(s) -> angle (deg, clockwise from 12), its length and width (fractions of r), colour, its centre's offset
	var D := {}
	for d in DIALS:
		D[d[0]] = {x = d[1], y = d[2], r = d[3]}
	var needle := func(id: String, fn: Callable, len := 0.82, w := 0.85, col := 0xece7d6, ox := 0.0, oy := 0.0) -> void:
		hands.append({x = D[id].x, y = D[id].y, r = D[id].r, fn = fn, len = len, w = w, col = col, ox = ox, oy = oy})
	var IAS := func(s) -> float: return s.speed * 2.237 * exp(-s.alt / 17000) # mph indicated (the thin air up here)
	needle.call("clock", func(s): return (s.clockH % 12) * 30 + s.clockM * 0.5, 0.5, 1.3)
	needle.call("clock", func(s): return s.clockM * 6, 0.78, 1.0)
	needle.call("clock", func(s): return s.clockS * 6, 0.86, 0.5, 0xc03020)
	needle.call("accel", func(s): return MAP("accel", s.g), 0.8, 0.9)
	needle.call("accel", func(s): return MAP("accel", s.gMax), 0.72, 0.6, 0xb0a890)
	needle.call("accel", func(s): return MAP("accel", s.gMin), 0.72, 0.6, 0xb0a890)
	needle.call("suction", func(s): return MAP("suction", 2.6 if s.damage else 4.0), 0.8)
	needle.call("speed", func(s): return MAP("speed", IAS.call(s)), 0.84)
	needle.call("alt", func(s): return fmod(s.ft, 1000) / 1000 * 360, 0.86, 0.75) # hundreds
	needle.call("alt", func(s): return fmod(s.ft, 10000) / 10000 * 360, 0.55, 1.4) # thousands
	needle.call("alt", func(s): return fmod(s.ft, 100000) / 100000 * 360, 0.92, 0.35, 0xb0a890) # ten thousands
	needle.call("turn", func(s): return clampf(s.turnRate / (3 * DEG) * 20, -40, 40), 0.8, 0.9, 0xece7d6, 0.0, -0.42)
	needle.call("climb", func(s): return MAP("climb", s.climb * 196.85 / 1000), 0.84)
	needle.call("turbo", func(s): return MAP("turbo", s.turbo), 0.82)
	needle.call("boost", func(s): return MAP("boost", s.mp), 0.84)
	needle.call("rpm", func(s): return MAP("rpm", s.rpm / 100), 0.84)
	needle.call("engine", func(s): return -110 + clampf(s.fuelP / 25, 0, 1) * 220, 0.36, 0.5, 0xece7d6, -0.42, 0.3)
	needle.call("engine", func(s): return -110 + clampf(s.oilP / 200, 0, 1) * 220, 0.36, 0.5, 0xece7d6, 0.42, 0.3)
	needle.call("engine", func(s): return -110 + clampf(s.oilT / 100, 0, 1) * 220, 0.36, 0.5, 0xece7d6, 0.0, -0.38)
	needle.call("carb", func(s): return MAP("carb", s.carbT), 0.8)
	needle.call("cht", func(s): return MAP("cht", s.cht), 0.8)
	needle.call("fuel", func(s): return MAP("fuel", s.fuel), 0.82)
	needle.call("hyd", func(s): return MAP("hyd", 700 if s.damage else 1000), 0.8)
	needle.call("oxy", func(s): return MAP("oxy", s.oxy), 0.8)
	# bars: [x, y, w, h, colour, fn(s) -> [dx, dy, angle(deg)]] (in metres on the panel)
	var H: Dictionary = D.horizon
	var Hr: float = H.r
	var none := func(_s): return [0.0, 0.0, 0.0]
	bars.append({x = H.x, y = H.y, w = Hr * 1.3, h = 0.0028, col = 0xece7d6, fn = func(s):
		var p := clampf(s.pitch, -0.5, 0.5) * Hr * 1.1
		return [sin(s.bank) * p, -cos(s.bank) * p, s.bank / DEG]}) # the horizon bar
	bars.append({x = H.x, y = H.y, w = 0.004, h = 0.009, col = 0xe08a30, fn = func(s):
		var a := clampf(s.bank, -1.6, 1.6)
		return [sin(a) * Hr * 0.74, cos(a) * Hr * 0.74, -a / DEG]}) # the sky pointer
	bars.append({x = H.x, y = H.y, w = Hr * 0.9, h = 0.003, col = 0xe08a30, fn = none}) # the little aeroplane, fixed
	bars.append({x = H.x, y = H.y + 0.004, w = 0.004, h = 0.008, col = 0xe08a30, fn = none})
	bars.append({x = D.dg.x, y = D.dg.y + 0.0, w = 0.0018, h = 0.022, col = 0xe08a30, fn = none}) # the gyro's lubber line
	bars.append({x = COMPASS[0], y = COMPASS[1] + 0.003, w = 0.0016, h = 0.022, col = 0xe08a30, fn = none}) # the compass's
	bars.append({x = D.oxy.x + 0.034, y = D.oxy.y - 0.02, w = 0.012, h = 0.012, col = 0x1a1a1a, fn = func(s): return [0.0, 0.0, 0.0 if int(floorf(s.time / 2)) % 2 else 45.0]}) # the oxygen blinker, opening and shutting with your breathing
	var Tr: float = D.turn.r
	dots.append({x = D.turn.x, y = D.turn.y - Tr * 0.5, r = 0.0042, col = 0x101010, fn = func(s): return [clampf(s.slip, -1, 1) * Tr * 0.48, -absf(clampf(s.slip, -1, 1)) * 0.002]}) # the ball
	var mk := func(geo, list: Array) -> MultiMesh:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = geo.to_mesh()
		mm.instance_count = list.size()
		for i in list.size():
			mm.set_instance_color(i, Mat.color(list[i].col))
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = hand_mat
		pg.add_child(mi)
		return mm
	var hand_mesh: MultiMesh = mk.call(Geo.shape(needle_shape), hands)
	var bar_mesh: MultiMesh = mk.call(Geo.plane(1, 1), bars)
	var dot_mesh: MultiMesh = mk.call(Geo.circle(1, 16), dots)
	# the cards: the directional gyro's and the compass's, turning behind their windows
	var card := func(tex: Texture2D, x: float, y: float, w: float, h: float) -> MeshInstance3D:
		var mat := Mat.standard({map = tex, emissiveMap = tex, emissive = 0x000000, roughness = 0.6})
		mat.uv1_scale = Vector3(50.0 / 360, 1, 1) # (the texture's repeat.x)
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
		var m := _mesh(Geo.plane(w, h), mat)
		m.position = Vector3(x, y, 0.0015)
		pg.add_child(m)
		return m
	var dg_card: MeshInstance3D = card.call(card_tex(), D.dg.x, D.dg.y - 0.0045, D.dg.r * 1.3, D.dg.r * 0.5)
	var c_card: MeshInstance3D = card.call(card_tex("#d4ccb2", "#121212"), COMPASS[0], COMPASS[1] + 0.002, COMPASS[2] * 0.76, COMPASS[3] * 0.5)
	var dg_mat: StandardMaterial3D = dg_card.mesh.surface_get_material(0)
	var c_mat: StandardMaterial3D = c_card.mesh.surface_get_material(0)

	# ---- the stick, pivoting at the floor, your right hand on its grip; the throttle quadrant's levers, your left hand on the throttle
	var fit_mesh := func(list: Array) -> MeshInstance3D: return _mesh(Geo.merge(list), fit)
	var stick := _xyz(Node3D.new())
	stick.name = "Stick"
	stick.position = Vector3(0, 0.0, -0.52)
	root.add_child(stick)
	var stick_parts := [
		paint_geo(rod(P(0, 0, 0), P(0, 0.5, 0.02), 0.016, 10), ZINC), # the stick, zinc-chromate green
		paint_geo(Geo.cylinder(0.06, 0.08, 0.1, 14).translate(0, 0.05, 0), 0x2a2a24), # its boot
		paint_geo(Geo.cylinder(0.022, 0.025, 0.13, 12).rotate_x(0.15).translate(0, 0.58, 0.03), BLACK), # the grip
		paint_geo(Geo.box(0.014, 0.03, 0.02).translate(0, 0.55, -0.005), 0x333333), # the trigger
		paint_geo(Geo.cylinder(0.007, 0.007, 0.012, 8).translate(0, 0.652, 0.035), 0x8a2016), # the bomb button on top
	]
	for g in hand_geo():
		stick_parts.append(paint_geo(g.rotate_z(-1.4).rotate_x(-0.25).translate(0.025, 0.58, 0.04), LEATHER))
	stick.add_child(fit_mesh.call(stick_parts))
	# a lever on the quadrant: pivot at (x, y, z), length, knob; returned so it can be moved
	var lever := func(x: float, len: float, knob, hex: int) -> Node3D:
		var g := _xyz(Node3D.new())
		g.position = Vector3(x, T.y, T.z)
		root.add_child(g)
		g.add_child(fit_mesh.call([paint_geo(Geo.box(0.008, len, 0.012).translate(0, len / 2, 0), 0x2a2a2a), paint_geo(knob.translate(0, len, 0), hex)]))
		return g
	var boost_l: Node3D = lever.call(T.x - 0.03, 0.12, Geo.cylinder(0.014, 0.014, 0.03, 10).rotate_z(PI / 2), BLACK)
	var throttle_l: Node3D = lever.call(T.x - 0.01, 0.15, Geo.cylinder(0.024, 0.026, 0.07, 12).rotate_z(PI / 2).translate(0.025, 0, 0), BLACK)
	var prop_l: Node3D = lever.call(T.x + 0.01, 0.12, Geo.sphere(0.016, 10, 8).scale(1, 0.8, 1.3), 0x1c2a4a)
	var mix_l: Node3D = lever.call(T.x + 0.03, 0.11, Geo.sphere(0.016, 10, 8), 0x8a2016)
	prop_l.rotation.x = -0.45; mix_l.rotation.x = -0.3
	throttle_l.add_child(fit_mesh.call(hand_geo().map(func(g): return paint_geo(g.rotate_z(1.3).rotate_y(-0.3).translate(0.03, 0.15, 0.02), LEATHER))))
	# your forearms, from the elbows to the wrists on the grips (placed every frame), the sleeves of the flying suit
	var arm := func() -> MeshInstance3D:
		var m := _mesh(paint_geo(Geo.cylinder(0.042, 0.05, 1, 12).translate(0, 0.5, 0), SUIT), fit)
		root.add_child(m)
		return m
	var arms := [{m = arm.call(), elbow = P(-0.3, 0.6, -0.06), hand = throttle_l, at = P(0.03, 0.15, 0.06)}, {m = arm.call(), elbow = P(0.24, 0.56, -0.08), hand = stick, at = P(0.03, 0.56, 0.08)}]

	# ---- the canopy round you: the glass (wet in the rain), the armoured windscreen's thick slab; the mirror's glass
	var glass: Material = Env.wet_glass(Mat.physical({color = 0xcfe0e6, transparent = true, opacity = 0.05, roughness = 0.03, depthWrite = false, side = Mat.DOUBLE}))
	glass.render_priority = 2
	var glass_mesh := _mesh(P47.canopy_glass(), glass)
	glass_mesh.name = "CanopyGlass"
	root.add_child(glass_mesh)
	if true:
		var ws: Dictionary = P47.windscreen()
		var c: Vector3 = (ws.fbl + ws.fbr + ws.ftl + ws.ftr) * 0.25
		var up: Vector3 = ws.ftl - ws.fbl
		var m := Transform3D(Basis(Vector3(1, 0, 0), -atan2(up.z, up.y)), Vector3(c.x, c.y, c.z + 0.025))
		var edge := Mat.physical({color = 0x4d6b5c, transparent = true, opacity = 0.14, roughness = 0.05, depthWrite = false})
		edge.render_priority = 2
		var w := 0.33
		var h := up.length()
		var d := 0.04
		var eg := []
		for s in [-1, 1]:
			eg.append(Geo.box(w, 0.005, d).translate(0, s * (h / 2 - 0.0025), 0))
			eg.append(Geo.box(0.005, h, d).translate(s * (w / 2 - 0.0025), 0, 0))
		var slab := _mesh(Geo.merge(eg).apply_transform(m), edge)
		root.add_child(slab)
		var back2 := _mesh(Geo.plane(w, h).apply_transform(Transform3D(Basis(), Vector3(0, 0, d / 2))).apply_transform(m), glass)
		root.add_child(back2)
	put("metal", Geo.box(0.095, 0.022, 0.004).rotate_x(0.25).translate(0, 1.31, -0.575), 0x5a666c, false) # the mirror's glass, facing you
	# the frames as you see them from the seat: slim box sections, edge on to your eye (rods this close fill the view)
	var eye := P(0, 1.05, -0.2)
	for e in P47.canopy_frame_segments():
		var a: Vector3 = e[0]
		var b: Vector3 = e[1]
		var k: float = e[2]
		var mid := (a + b) * 0.5
		var z := b - a
		var len := z.length()
		z = z.normalized()
		var to_eye := (eye - mid).normalized()
		var x := to_eye.cross(z).normalized()
		var y := z.cross(x)
		var geo = Geo.box(0.011 * k + 0.003, 0.026 * k, len + 0.012).apply_transform(Transform3D(Basis(x, y, z), mid + y * 0.006))
		put("fit", geo, 0x4a4a34, false)

	# ---- merge the static parts: one mesh per material
	for km in [["fit", fit], ["metal", metal]]:
		var mi := _mesh(Geo.merge(parts[km[0]]), km[1])
		mi.name = "Static_" + km[0]
		root.add_child(mi)
	_parts = {}
	root.set_meta("canvases", _keep)
	_keep = []
	# (Three turned the cockpit's shadows off; here the opaque parts cast them, so the canopy's frames, the
	# coaming and the fuselage shade the cockpit; the glass doesn't)
	for o in root.find_children("*", "GeometryInstance3D", true, false):
		var gi := o as GeometryInstance3D
		var mat: Material = gi.material_override
		if mat == null and gi is MeshInstance3D and (gi as MeshInstance3D).mesh and (gi as MeshInstance3D).mesh.get_surface_count() > 0:
			mat = (gi as MeshInstance3D).mesh.surface_get_material(0)
		var see_through := mat is ShaderMaterial or (mat is BaseMaterial3D and (mat as BaseMaterial3D).transparency != BaseMaterial3D.TRANSPARENCY_DISABLED)
		gi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if see_through or gi is MultiMeshInstance3D else GeometryInstance3D.SHADOW_CASTING_SETTING_ON

	# ---- what moves
	var st := {gMax = 1.0, gMin = 1.0, g = 1.0, heading = null, turnRate = 0.0, slip = 0.0, bankWas = 0.0}
	var update := func(s: Dictionary, dt: float) -> void:
		# what the instruments read, from the flight: time of day (the bombers crossed the coast about 13:00), turn rate
		# from the heading, g from the turn, the engine's figures from the throttle and the height
		if dt > 0:
			var dh: float = 0.0 if st.heading == null else s.heading - st.heading
			dh = atan2(sin(dh), cos(dh))
			st.turnRate += (dh / dt - st.turnRate) * (1 - exp(-dt * 3))
			var gg: float = 1 / maxf(0.3, cos(clampf(s.bank, -1.3, 1.3))) + (randf() - 0.5) * 0.04
			st.g += (gg - st.g) * (1 - exp(-dt * 4))
			st.slip += ((s.bank - st.bankWas) / dt * 0.15 - st.slip) * (1 - exp(-dt * 2.5))
			st.bankWas = s.bank
		st.heading = s.heading
		st.gMax = maxf(st.gMax, st.g); st.gMin = minf(st.gMin, st.g)
		var clock: float = 13 * 3600 + 5 * 60 + s.time
		var thr: float = s.throttle
		var hot := 1 if s.damage else 0
		st.merge(s, true) # (Object.assign(st, s, {...}): the state's own figures and these)
		st.merge({
			clockH = int(floorf(clock / 3600)), clockM = fmod(clock / 60, 60), clockS = floorf(fmod(clock, 60)), ft = maxf(0, s.alt * 3.281),
			mp = 24 + thr * 28 - hot * 4, rpm = 2050 + thr * 650, turbo = (9 + thr * 12) * clampf(0.6 + s.alt / 20000, 0.6, 1),
			fuelP = 12 if hot else 17, oilP = 30 + randf() * 15 if hot else 75, oilT = 68 + thr * 12 + hot * 25 + s.heat * 3, carbT = 12 + thr * 14,
			cht = 195 + thr * 40 + hot * 70, fuel = maxf(0, 205 - s.time * 0.035), oxy = maxf(0, 410 - s.time * 0.05),
		}, true)
		var v := st
		for i in hands.size():
			var h: Dictionary = hands[i]
			var a: float = h.fn.call(v) * DEG
			hand_mesh.set_instance_transform(i, Transform3D(Basis(Quaternion(Vector3(0, 0, 1), -a)) * Basis.from_scale(Vector3(h.r * h.w * 0.1 * 6, h.r * h.len, 1)), Vector3(h.x + h.ox * h.r, h.y + h.oy * h.r, 0.004 + i * 0.00002)))
		for i in bars.size():
			var b: Dictionary = bars[i]
			var r: Array = b.fn.call(v)
			bar_mesh.set_instance_transform(i, Transform3D(Basis(Quaternion(Vector3(0, 0, 1), -r[2] * DEG)) * Basis.from_scale(Vector3(b.w, b.h, 1)), Vector3(b.x + r[0], b.y + r[1], 0.0045 + i * 0.0002)))
		for i in dots.size():
			var d: Dictionary = dots[i]
			var r: Array = d.fn.call(v)
			dot_mesh.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(d.r, d.r, 1)), Vector3(d.x + r[0], d.y + r[1], 0.006)))
		var hdg := fposmod(s.heading / DEG, 360)
		dg_mat.uv1_offset.x = (hdg - 25) / 360; c_mat.uv1_offset.x = (hdg - 25 + sin(s.time * 0.7) * 2) / 360 # (the compass swings a little)
		# the stick: back to pull up, over to roll; the quadrant: the boost lever hooked to the throttle
		stick.rotation.x = clampf(-s.stickY, -1, 1) * 0.2
		stick.rotation.z = clampf(-s.stickX, -1, 1) * 0.22
		throttle_l.rotation.x = 0.55 - thr * 1.1
		boost_l.rotation.x = 0.55 - thr * 1.05
		for am in arms: # each forearm from its elbow to the wrist, wherever the hand has gone
			var p: Vector3 = (am.hand as Node3D).transform * (am.at as Vector3)
			var dv: Vector3 = p - am.elbow
			var len := dv.length()
			(am.m as Node3D).transform = Transform3D(Basis(Quaternion(Vector3(0, 1, 0), dv / len)) * Basis.from_scale(Vector3(1, len, 1)), am.elbow)
		hub.visible = true
	root.set_meta("update", update)
	var night := func(k: float) -> void: # the panel's fluorescent markings under the cockpit's ultraviolet lamps
		# (Three's emissive is linear, k * 4 times Color(0.55, 1.0, 0.62); Godot's emission colour is sRGB with
		# its strength in the energy multiplier)
		var e := Color(0.55, 1.0, 0.62).linear_to_srgb()
		face_mat.emission = e; face_mat.emission_energy_multiplier = k * 4
		hand_mat.emission = e; hand_mat.emission_energy_multiplier = k * 4 * 0.8
		dg_mat.emission = e; dg_mat.emission_energy_multiplier = k * 4 * 0.7
		c_mat.emission = e; c_mat.emission_energy_multiplier = k * 4 * 0.25
	root.set_meta("night", night)
	return root
