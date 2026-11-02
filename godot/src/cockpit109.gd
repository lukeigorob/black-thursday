extends RefCounted
# The Bf 109 G-6's cockpit as it was over Schweinfurt in October 1943 (hackathon/BF109_COCKPIT_SPEC.md),
# built to the photographs of restored and museum 109s:
# - RLM 66 Schwarzgrau throughout, worn, darker down in the tub (baked into the vertex colours: the web game
#   has no shadows in here and no lights may be added; in Godot the parts also cast and take the sun's shadows
#   on top of that);
# - the instrument panel in two plates, the upper shock-mounted: real holes with the instruments' faces
#   set back in them, black bezels, glass, the screws; German faces whose needles move with the real
#   values; the SZKK 4 ammunition counter's tapes running down as you fire; the luminous paint glowing at
#   night (pilot.night);
# - the Revi 16B on its bracket over the panel, its reflector glass at eye level (pilot.gd puts the
#   reticle on the guns' line), the sun filter folded down, the crash pad;
# - the KG 13A stick (trigger, cannon button, leather boot) and the throttle with your hands on them,
#   the big trim and flap wheels on the left wall, the breaker panel, the FuG 16Z box and the blue
#   Höhenatmer with its yellow hose on the right, the rudder pedals and floor plates, the seat and harness;
# - the old framed hood (the Erla Haube and the Galland-Panzer came in 1944), its armoured windscreen,
#   the head armour bolted to the hood.
# Port of src/cockpit109.js. Cockpit109.build_109(ctx) -> {update = Callable(s, dt), night = Callable(k)}.

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Mat := preload("res://src/core/mat.gd")
const Cockpit := preload("res://src/cockpit.gd")

const CELL := 256
const ATLAS := 1024 # the instruments' faces: 4 x 4 cells of 256 px
const CELLS := ["alt", "turn", "boost", "speed", "compass", "rpm", "prop", "coolant", "oil", "press", "fuel", "o2", "blink", "szkk"]
const INK := "#ece4cc"
const RED := "#c8261c"
const RLM66 := 0x3b3e41

static func FONT(px: float, w: int = 700) -> String:
	return "%d %spx \"Arial Narrow\", Arial, sans-serif" % [w, _js_str(px)]

# the upper panel (shock-mounted) and the lower, each placed by its top edge's centre, tilted back
const UP := {w = 0.5, wb = 0.46, h = 0.29, top = Vector3(0, -0.155, -0.635), tilt = -0.22}
const LO := {w = 0.44, wb = 0.38, h = 0.12, top = Vector3(0, -0.447, -0.578), tilt = -0.5}
# the instruments: [cell, x, y, face radius] in the plate's own frame (m, from its centre)
const UPPER := [["alt", -0.13, 0.02, 0.04], ["turn", 0, 0.02, 0.04], ["boost", 0.13, 0.02, 0.04],
	["speed", -0.13, -0.086, 0.04], ["compass", 0, -0.086, 0.04], ["rpm", 0.13, -0.086, 0.04], ["prop", 0.13, 0.104, 0.021]]
const LOWER := [["coolant", -0.152, -0.004, 0.027], ["oil", -0.084, -0.004, 0.027], ["press", 0.084, -0.004, 0.027], ["fuel", 0.152, -0.004, 0.027]]
const SZKK := {x = -0.12, y = 0.106, w = 0.11, h = 0.05} # the ammunition counter's window plate, top left of the upper panel

## Where a point of a plate (its own x, y; z out of it) is in the cockpit.
static func plate_matrix(pl: Dictionary) -> Transform3D:
	var q := Quaternion.from_euler(Vector3(pl.tilt, 0, 0)) # (one axis: the order doesn't matter)
	var c: Vector3 = pl.top - q * Vector3(0, pl.h / 2, 0)
	return Transform3D(Basis(q), c)

## JS's String(number): integers without a decimal point.
static func _js_str(v: float) -> String:
	if v == floorf(v) and absf(v) < 1e15:
		return str(int(v))
	return str(v)

## THREE.MathUtils.smoothstep (its way round: below min 0, at or above max 1, even when min > max).
static func _smoothstep(x: float, mn: float, mx: float) -> float:
	if x <= mn:
		return 0.0
	if x >= mx:
		return 1.0
	x = (x - mn) / (mx - mn)
	return x * x * (3 - 2 * x)

static func _vc(mat) -> bool:
	return mat is BaseMaterial3D and mat.vertex_color_use_as_albedo

# ---------- the instruments' faces (static, drawn once) and their needles (meshes, turned each frame)

## A dial's ticks between angles a0 and a1 (canvas angles: 0 at 3 o'clock, clockwise), and its numbers.
static func scale(g, R: float, from: float, to: float, a0: float, a1: float, step: float, every: int, label: Callable, rr: float = 0.66, px: float = 30) -> Callable:
	g.stroke_style = INK
	g.fill_style = INK
	g.line_cap = "butt"
	var at := func(v: float) -> float: return a0 + ((v - from) / (to - from)) * (a1 - a0)
	var v := from
	var k := 0
	while v <= to + 1e-6:
		var a: float = at.call(v)
		var big := k % every == 0
		var mid := not big and every % 2 == 0 and k % (every / 2) == 0
		g.line_width = 5.0 if big else (3.5 if mid else 2.2)
		var r0 := R * 0.8 if big else (R * 0.85 if mid else R * 0.89)
		g.begin_path(); g.move_to(cos(a) * r0, sin(a) * r0); g.line_to(cos(a) * R * 0.97, sin(a) * R * 0.97); g.stroke()
		if big:
			var t = label.call(v)
			if t != null:
				g.font = FONT(px); g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(t, cos(a) * R * rr, sin(a) * R * rr)
		k += 1
		v = from + k * step
	return at

static func red_mark(g, R: float, a: float, w: float = 7) -> void:
	g.stroke_style = RED; g.line_width = w; g.begin_path(); g.move_to(cos(a) * R * 0.78, sin(a) * R * 0.78); g.line_to(cos(a) * R * 0.98, sin(a) * R * 0.98); g.stroke()

static func text(g, t: String, x: float, y: float, px: float, w: int = 700) -> void:
	g.fill_style = INK; g.font = FONT(px, w); g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(t, x, y)

const A0 := PI * 0.75 # a 270 degree scale from 7:30 round to 4:30
const A1 := PI * 2.25
const TOP := -PI / 2

## The Fahrtmesser's scale: the first 100 km/h squeezed into the bottom of it, 100 to 750 spread round.
static func speed_angle(v: float) -> float:
	return TOP + (0.07 * v / 100 if v < 100 else 0.07 + 0.89 * (minf(v, 750) - 100) / 650) * PI * 2

## Every face, drawn once into the atlas; returns the angle functions the needles need.
static func draw_faces(c, card) -> Dictionary:
	var g = c
	var R := 118.0
	var fn := {}
	for i in CELLS.size():
		var name: String = CELLS[i]
		g.save(); g.translate((i % 4) * CELL + CELL / 2.0, (i >> 2) * CELL + CELL / 2.0)
		if name == "szkk": # the SZKK 4's face: three windows (the tapes are meshes behind them), a scale by each
			g.fill_style = "#26282a"; g.fill_rect(-128, -51, 256, 102)
			for j in 3:
				var cx := -80 + j * 80
				g.fill_style = "#050505"; g.fill_rect(cx - 22, -44, 44, 80)
				g.fill_style = INK
				for t in 11:
					g.fill_rect(cx + 23, 36 - t * 7.6, 4 if t % 5 else 9, 1.6)
				g.font = FONT(14); g.text_align = "center"; g.fill_text("MG 151" if j == 1 else "MG", cx, -48)
			g.restore()
			continue
		var bg = g.create_radial_gradient(0, -30, 10, 0, 0, 128); bg.add_color_stop(0, "#1b1b1b"); bg.add_color_stop(1, "#070707")
		g.fill_style = bg; g.fill_rect(-128, -128, 256, 256)
		match name:
			"alt": # Feinhöhenmesser: the long hand round once a kilometre, the short once in ten; the millibar window
				scale(g, R, 0, 10, TOP, TOP + PI * 2, 0.2, 5, func(v): return str(roundi(v)) if v < 9.5 else null, 0.64, 34)
				g.fill_style = "#000"; g.fill_rect(-26, 34, 52, 24); g.stroke_style = "#666"; g.line_width = 2; g.stroke_rect(-26, 34, 52, 24)
				text(g, "1013", 0, 47, 18); text(g, "km", 0, -34, 20); text(g, "mb", 0, 72, 13, 600)
			"speed": # Fahrtmesser, km/h
				g.stroke_style = INK; g.fill_style = INK
				var v := 0
				while v <= 750:
					var a := speed_angle(v)
					var big := v % 100 == 0
					var mid := v % 50 == 0
					g.line_width = 5.0 if big else (3.5 if mid else 2.0)
					var r0 := R * 0.8 if big else (R * 0.85 if mid else R * 0.9)
					g.begin_path(); g.move_to(cos(a) * r0, sin(a) * r0); g.line_to(cos(a) * R * 0.97, sin(a) * R * 0.97); g.stroke()
					if big and v > 0:
						text(g, str(v / 100), cos(a) * R * 0.64, sin(a) * R * 0.64, 34)
					v += 50 if v < 100 else 10
				text(g, "km/h", 0, 38, 20); text(g, "x 100", 0, 58, 14, 600)
			"boost": # Ladedruckmesser, ata: the red line at 1.42, the G-6's combat power
				var at := scale(g, R, 0.6, 1.8, A0, A1, 0.05, 4, func(v): return ("%.1f" % v).replace(".", ","), 0.62, 26)
				red_mark(g, R, at.call(1.42)); text(g, "ata", 0, 46, 22); fn.boost = at
			"rpm": # Drehzahlmesser, x 100 U/min: the red line at 2800
				var at := scale(g, R, 6, 36, A0, A1, 1, 4, func(v): return _js_str(v), 0.64, 28)
				red_mark(g, R, at.call(28)); text(g, "U/min", 0, 40, 18); text(g, "x 100", 0, 60, 14, 600); fn.rpm = at
			"turn": # Wendezeiger: the turn needle's index marks over the top, the ball's curved tube below
				g.stroke_style = INK
				for k in [-2, -1, 0, 1, 2]:
					var a: float = TOP + k * 0.33
					g.line_width = 6 if k else 9
					g.begin_path(); g.move_to(cos(a) * R * 0.74, sin(a) * R * 0.74 + 10); g.line_to(cos(a) * R * 0.97, sin(a) * R * 0.97); g.stroke()
				g.line_cap = "round"; g.stroke_style = "#d8d0b4"; g.line_width = 26; g.begin_path(); g.arc(0, -140, 222, PI / 2 - 0.36, PI / 2 + 0.36); g.stroke()
				g.stroke_style = "#111"; g.line_width = 3
				for s in [-1, 1]:
					var a: float = PI / 2 + s * 0.07
					g.begin_path(); g.move_to(cos(a) * 208, -140 + sin(a) * 208); g.line_to(cos(a) * 236, -140 + sin(a) * 236); g.stroke()
				g.line_cap = "butt"
			"compass":
				pass # (the card: below, a disc of its own that turns)
			"prop": # the prop pitch "clock": hours and minutes
				g.stroke_style = INK
				for k in 60:
					var a := (k / 60.0) * PI * 2
					g.line_width = 3 if k % 5 else 7
					var r0 := R * 0.88 if k % 5 else R * 0.78
					g.begin_path(); g.move_to(cos(a) * r0, sin(a) * r0); g.line_to(cos(a) * R * 0.97, sin(a) * R * 0.97); g.stroke()
				for h in range(1, 13):
					var a := TOP + (h / 12.0) * PI * 2
					text(g, str(h), cos(a) * R * 0.6, sin(a) * R * 0.6, 36)
			"coolant", "oil": # the temperatures, °C
				var at := scale(g, R, 0, 130, A0, A1, 5, 4, func(v): return _js_str(v), 0.62, 30)
				red_mark(g, R, at.call(105 if name == "oil" else 115), 8)
				text(g, "Öl" if name == "oil" else "Kühlstoff", 0, 44, 30 if name == "oil" else 24); text(g, "°C", 0, 74, 20); fn[name] = at
			"press": # Doppeldruckmesser: Kraftstoff over the top, Öl under the bottom (kg/cm²)
				fn.fuelP = scale(g, R, 0, 3, PI * 1.08, PI * 1.92, 0.25, 4, func(v): return _js_str(v), 0.64, 30)
				fn.oilP = scale(g, R, 0, 10, PI * 0.92, PI * 0.08, 0.5, 4, func(v): return _js_str(v), 0.64, 30)
				g.stroke_style = INK; g.line_width = 2; g.begin_path(); g.move_to(-R * 0.95, 0); g.line_to(R * 0.95, 0); g.stroke()
				text(g, "Kraftst.", 0, -34, 22); text(g, "Öl", 0, 34, 26)
			"fuel": # Kraftstoffvorrat, Liter
				fn.fuel = scale(g, R, 0, 400, A0, A1, 20, 5, func(v): return _js_str(v), 0.62, 28)
				red_mark(g, R, fn.fuel.call(100), 6); text(g, "Liter", 0, 46, 24)
			"o2": # Sauerstoff, the bottle's pressure
				fn.o2 = scale(g, R, 0, 250, A0, A1, 10, 5, func(v): return _js_str(v), 0.62, 30); text(g, "Sauerstoff", 0, 46, 20); text(g, "kg/cm²", 0, 70, 16, 600)
			"blink":
				text(g, "Atem", 0, -60, 26) # the flow indicator: its flaps drawn live
		g.restore()
	# the repeater compass's card (Führertochterkompass): O for Ost
	var k = card
	k.translate(CELL / 2.0, CELL / 2.0); k.fill_style = "#0b0b0b"; k.begin_path(); k.arc(0, 0, 128, 0, 7); k.fill()
	k.stroke_style = INK; k.fill_style = INK
	for d in range(0, 360, 5):
		var a := TOP + deg_to_rad(d)
		var big := d % 30 == 0
		k.line_width = 2 if d % 10 else 4
		var r0 := R * 0.78 if big else (R * 0.9 if d % 10 else R * 0.84)
		k.begin_path(); k.move_to(cos(a) * r0, sin(a) * r0); k.line_to(cos(a) * R * 0.98, sin(a) * R * 0.98); k.stroke()
		if big:
			k.save(); k.translate(cos(a) * R * 0.6, sin(a) * R * 0.6); k.rotate(a + PI / 2); k.font = FONT(28 if d % 90 else 40); k.text_align = "center"; k.text_baseline = "middle"
			k.fill_text(str(d / 10) if d % 90 else "NOSW"[d / 90], 0, 0); k.restore()
	var ci := CELLS.find("compass")
	g.draw_image(card, (ci % 4) * CELL, (ci >> 2) * CELL)
	# the glass over every face: a soft glint across the top (not the compass's: its card turns)
	for i in CELLS.size():
		var name: String = CELLS[i]
		if name == "compass" or name == "szkk":
			continue
		g.save(); g.translate((i % 4) * CELL + CELL / 2.0, (i >> 2) * CELL + CELL / 2.0)
		var gl = g.create_linear_gradient(-120, -120, 30, 30); gl.add_color_stop(0, "#ffffff1c"); gl.add_color_stop(0.5, "#ffffff05"); gl.add_color_stop(0.55, "#ffffff00")
		g.fill_style = gl; g.begin_path(); g.arc(0, 0, 124, 0, 7); g.fill(); g.restore()
	return fn

## A needle along +x from its pivot (a lance with a counterweight), in a face's pixels (256 across).
static func needle_geo(ln: float, w: float):
	var s := Shapes.Shape.new()
	s.move_to(-ln * 0.24, -w * 0.8); s.line_to(ln * 0.7, -w / 2); s.line_to(ln, 0); s.line_to(ln * 0.7, w / 2); s.line_to(-ln * 0.24, w * 0.8); s.close_path()
	return Geo.shape(s)

# ---------- the panel plates' paint: worn RLM 66, rivets, the placards

## labels: called with {plate, label, to, g, k} (Callables plate(x, y, w, lines), label(x, y, t, px), to(x, y)).
static func plate_canvas(pl: Dictionary, px: int, labels: Callable):
	var c := Canvas2D.new(px, roundi(px * pl.h / pl.w))
	var g = c
	var r: Callable = Cockpit.rng(31)
	var W: float = c.width
	var H: float = c.height
	var k: float = W / pl.w
	g.fill_style = "#3b3e41"; g.fill_rect(0, 0, W, H)
	for i in 7000:
		g.fill_style = "#ffffff07" if r.call() < 0.5 else "#00000012"
		g.fill_rect(r.call() * W, r.call() * H, 1 + r.call() * 3, 1 + r.call() * 3)
	g.stroke_style = "#9a9a8c55"; g.line_cap = "round" # worn to the metal along the edges, where hands go
	for i in 90:
		var x: float = r.call() * W
		var y: float = r.call() * 14 if r.call() < 0.5 else H - r.call() * 14
		g.line_width = 1 + r.call() * 2; g.begin_path(); g.move_to(x, y); g.line_to(x + 4 + r.call() * 22, y + (r.call() - 0.5) * 3); g.stroke()
	var x := 14
	while x < W: # rivets
		for y in [8.0, H - 8]:
			g.fill_style = "#00000055"; g.begin_path(); g.arc(x + 1, y + 1, 3.2, 0, 7); g.fill(); g.fill_style = "#56595c"; g.begin_path(); g.arc(x, y, 3, 0, 7); g.fill()
		x += 34
	var to := func(x2: float, y2: float) -> Array: return [(x2 + pl.w / 2) * k, (pl.h / 2 - y2) * k]
	var plate := func(x2: float, y2: float, w: float, lines: Array) -> void: # a placard, its text in German
		var bg := "#d6cfb4"
		var fg := "#16140f"
		var p: Array = to.call(x2, y2)
		var h: float = lines.size() * 15 + 6
		var ww: float = w * k
		g.fill_style = "#0006"; g.fill_rect(p[0] - ww / 2 + 2, p[1] - h / 2 + 2, ww, h); g.fill_style = bg; g.fill_rect(p[0] - ww / 2, p[1] - h / 2, ww, h)
		g.fill_style = fg; g.font = "700 12px \"Arial Narrow\", Arial, sans-serif"; g.text_align = "center"; g.text_baseline = "middle"
		for i in lines.size():
			g.fill_text(lines[i], p[0], p[1] - h / 2 + 10.5 + i * 15)
	var label := func(x2: float, y2: float, t: String, px2: float) -> void:
		var p: Array = to.call(x2, y2)
		g.fill_style = "#e4ddc6"; g.font = "700 %spx \"Arial Narrow\", Arial, sans-serif" % _js_str(px2); g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(t, p[0], p[1])
	labels.call({plate = plate, label = label, to = to, g = g, k = k})
	return c

## A plate's outline (a little narrower at the bottom, rounded corners), its holes for the instruments.
static func plate_geo(pl: Dictionary, holes: Array):
	var s := Shapes.Shape.new()
	var w: float = pl.w / 2
	var wb: float = pl.wb / 2
	var h: float = pl.h / 2
	var c := 0.014
	s.move_to(-wb + c, -h); s.line_to(wb - c, -h); s.quadratic_curve_to(wb, -h, wb + (w - wb) * 0.1, -h + c)
	s.line_to(w, h - c); s.quadratic_curve_to(w, h, w - c, h); s.line_to(-w + c, h); s.quadratic_curve_to(-w, h, -w, h - c)
	s.line_to(-wb - (w - wb) * 0.1, -h + c); s.quadratic_curve_to(-wb, -h, -wb + c, -h)
	for hl in holes:
		s.holes.append(Shapes.Path.new().absarc(hl[0], hl[1], hl[2], 0, PI * 2, true))
	var geo = Geo.extrude(s, {depth = 0.006, bevelEnabled = true, bevelThickness = 0.0015, bevelSize = 0.0015, bevelSegments = 1, curveSegments = 28})
	geo.translate(0, 0, -0.0075)
	var uv: PackedVector2Array = geo.uvs # (the paint's canvas across the plate)
	for i in geo.positions.size():
		var p: Vector3 = geo.positions[i]
		uv[i] = Vector2((p.x + w) / (2 * w), (p.y + h) / (2 * h))
	geo.uvs = uv
	return geo

## A bezel: the ring standing out of the panel and the short tube down to the face, turned round z.
static func bezel_geo(r: float):
	var pts := [[r + 0.0006, -0.013], [r + 0.0006, 0.001], [r + 0.0016, 0.0045], [r + 0.0042, 0.0062], [r + 0.0072, 0.0052], [r + 0.0092, 0.0022], [r + 0.0098, -0.0004]].map(func(p): return Vector2(p[0], p[1]))
	return Geo.lathe(pts, 40).rotate_x(PI / 2)

## A face disc, its uv in the atlas cell.
static func face_geo(r: float, cell: String):
	var geo = Geo.circle(r, 40)
	var uv: PackedVector2Array = geo.uvs
	var i0 := CELLS.find(cell)
	var col := i0 % 4
	var row := i0 >> 2
	for i in uv.size():
		uv[i] = Vector2((col + uv[i].x) / 4, 1 - (row + 1 - uv[i].y) / 4)
	geo.uvs = uv
	return geo

## Light and shade baked into the vertices: darker down in the tub, under the panel, in the corners.
static func shade(geo, m: Variant = null) -> void:
	var c: PackedColorArray = geo.colors
	var p: PackedVector3Array = geo.positions
	for i in p.size():
		var v: Vector3 = p[i]
		if m != null:
			v = m * v
		var k := 1 - 0.68 * _smoothstep(-v.y, 0.12, 0.75) # (deeper is darker)
		if v.z < -0.45 and v.y < -0.17:
			k *= 0.72 + 0.28 * _smoothstep(v.z, -0.75, -0.45) # (under the panel and the coaming)
		k *= 0.85 + 0.15 * _smoothstep(absf(v.x), 0.42, 0.25) # (into the walls)
		c[i] = Color(c[i].r * k, c[i].g * k, c[i].b * k, c[i].a)
	geo.colors = c

## A gloved hand closed round a grip whose axis is y (radius gr), the cuff and the leather sleeve going back to the elbow.
static func hand_geo(gr: float, mirror: bool, sleeve_dir: Vector3) -> Dictionary:
	var parts := []
	var f0 := -1.0 if mirror else 1.0
	parts.append(Geo.rounded_box(0.03, 0.085, 0.075, 2, 0.012).translate(f0 * (gr + 0.018), -0.005, 0.012)) # the palm and the back of the hand
	for k in 4: # the fingers round the front of the grip
		var t = Geo.torus(gr + 0.0095, 0.0095 - k * 0.0006, 6, 14, PI * 1.35).rotate_x(PI / 2).rotate_y(-2.39 if mirror else 3.49)
		parts.append(t.translate(0, 0.026 - k * 0.019, 0))
	parts.append(Geo.capsule(0.0105, 0.04, 3, 8).rotate_z(PI / 2).rotate_y(-0.6 if mirror else 0.6).translate(f0 * 0.012, 0.05, 0.004)) # the thumb over the top
	var d := sleeve_dir.normalized()
	var q := Quaternion(Vector3(0, 1, 0), d) # (setFromUnitVectors)
	var cp := d * 0.06 + Vector3(f0 * 0.035, -0.02, 0.03)
	var cuff = Geo.cylinder(0.036, 0.04, 0.07, 12).apply_quaternion(q).translate(cp.x, cp.y, cp.z)
	parts.append(cuff)
	var sp := d * 0.22 + Vector3(f0 * 0.035, -0.02, 0.03)
	return {
		glove = Geo.merge(parts.map(func(x): return Cockpit.tidy(x, true))),
		sleeve = Cockpit.tidy(Geo.capsule(0.045, 0.24, 4, 12).apply_quaternion(q).translate(sp.x, sp.y, sp.z), true),
	}

## A small canvas texture for a side panel's placards.
static func side_canvas(w: int, h: int, draw: Callable) -> Texture2D:
	var c := Canvas2D.new(w, h)
	var g = c
	var r: Callable = Cockpit.rng(57)
	g.fill_style = "#3b3e41"; g.fill_rect(0, 0, w, h)
	for i in int(ceil(w * h / 60.0)):
		g.fill_style = "#ffffff07" if r.call() < 0.5 else "#00000012"
		g.fill_rect(r.call() * w, r.call() * h, 1 + r.call() * 2, 1 + r.call() * 2)
	g.text_align = "center"; g.text_baseline = "middle"
	draw.call(g)
	return c.texture(true) # (sRGB, mipmapped: the material filters it anisotropically)

# ---------- small helpers for the build (the JS's closures over `parts`)

static func _std(o: Dictionary) -> StandardMaterial3D:
	var m := Mat.standard(o.merged({vertexColors = true}))
	# (Three treats vertex colours as linear: the baked shade multiplies the light, not the sRGB value)
	m.vertex_color_is_srgb = false
	if o.has("map") and o.map:
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m

static func _add(pa: Dictionary, mat, geo, m: Variant = null):
	var t = Cockpit.tidy(geo.clone(), _vc(mat))
	if m != null:
		t.apply_transform(m)
	if not pa.has(mat):
		pa[mat] = []
	pa[mat].append(t)
	return t

static func _put(pa: Dictionary, mat, geo, x: float = 0, y: float = 0, z: float = 0, rx: float = 0, ry: float = 0, rz: float = 0, s: float = 1):
	var m := Transform3D(Basis.from_euler(Vector3(rx, ry, rz), EULER_ORDER_XYZ) * Basis.from_scale(Vector3(s, s, s)), Vector3(x, y, z))
	return _add(pa, mat, geo, m)

static func _bar(pa: Dictionary, mat, a: Vector3, b: Vector3, w: float = 0.028, d: float = 0.032, out: Vector3 = Vector3(0, 1, 0)):
	return _add(pa, mat, Cockpit.bar_geo(a, b, w, d, out))

static func _box(w: float, h: float, d: float):
	return Geo.box(w, h, d)

static func _rbox(w: float, h: float, d: float, r: float = 0.006):
	return Geo.rounded_box(w, h, d, 2, r)

static func _cyl(r0: float, r1: float, h: float, s: int = 14):
	return Geo.cylinder(r0, r1, h, s)

static func _compose(p: Vector3, euler: Vector3, order: int, s: float) -> Transform3D:
	return Transform3D(Basis.from_euler(euler, order) * Basis.from_scale(Vector3(s, s, s)), p)

static func _mesh(geo, mat) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = geo.to_mesh(mat)
	mi.rotation_order = EULER_ORDER_XYZ
	return mi

static func _plate_group(plates: Dictionary, g: Node3D, m: Transform3D) -> Node3D:
	if not plates.has(m):
		var p := Node3D.new()
		p.transform = m
		g.add_child(p)
		plates[m] = p
	return plates[m]

static func _instrument(pa: Dictionary, M: Dictionary, dials: Dictionary, m: Transform3D, spec: Array) -> void:
	var cell: String = spec[0]
	var x: float = spec[1]
	var y: float = spec[2]
	var r: float = spec[3]
	dials[cell] = {m = m, x = x, y = y, r = r}
	_add(pa, M.face, face_geo(r, cell).translate(x, y, -0.012), m)
	_add(pa, M.bezel, bezel_geo(r).translate(x, y, 0), m)
	_add(pa, M.dial, Geo.circle(r + 0.001, 32).translate(x, y, 0.0035), m)
	for k in 4:
		var a := PI / 4 + k * PI / 2
		var d := r + 0.0145
		_add(pa, M.steel, _cyl(0.0028, 0.0028, 0.0025, 8).rotate_x(PI / 2).translate(x + cos(a) * d, y + sin(a) * d, 0.001), m)

## A needle on its pivot (ox, oy: the pivot off the face's centre, in its pixels).
static func _hand(pa: Dictionary, M: Dictionary, dials: Dictionary, plates: Dictionary, g: Node3D, cell: String, ln: float, w: float, ox: float = 0, oy: float = 0, hub: float = 13) -> Node3D:
	var d: Dictionary = dials[cell]
	var k: float = d.r / 128
	var piv := Node3D.new()
	piv.rotation_order = EULER_ORDER_XYZ
	piv.position = Vector3(d.x + ox * k, d.y - oy * k, -0.0105)
	piv.add_child(_mesh(needle_geo(ln, w).scale(k, k, 1), M.needle))
	_plate_group(plates, g, d.m).add_child(piv)
	_add(pa, M.bezel, _cyl(hub * k, hub * k, 0.003, 12).rotate_x(PI / 2).translate(piv.position.x, piv.position.y, -0.0092), d.m)
	return piv

static func turn_to(piv: Node3D, a: float) -> void:
	piv.rotation.z = -a # (the faces' angles are the canvas's: clockwise from 3 o'clock)

## Three's bumpMap as a normal map (Godot has none): a height image turned to normals.
static func _bump_image(mat: BaseMaterial3D, img: Image, strength: float) -> void:
	img = img.duplicate()
	if img.has_mipmaps():
		img.clear_mipmaps()
	img.convert(Image.FORMAT_RGBA8)
	img.bump_map_to_normal_map(strength)
	img.generate_mipmaps()
	mat.normal_enabled = true
	mat.normal_texture = ImageTexture.create_from_image(img)

# (the hose's ribs: Three's bumpScale 1.2 as Image.bump_map_to_normal_map's strength, matched by eye, not by
# formula: Three scales the height's slope on screen, Godot the slope per texel)
const RIBS_STRENGTH := 20.0

## The 109's cockpit, into the shared cockpit group: the static parts are merged by material here, the
## moving ones (stick, throttle) added as nodes. Returns {update = Callable(s, dt), night = Callable(k)}.
## ctx: {g, T, body (the fuselage's Geo), width_at, sill, wear, rivets, glass, armour, armour_edge}
static func build_109(ctx: Dictionary) -> Dictionary:
	var g: Node3D = ctx.g
	var body = ctx.body
	var width_at: Callable = ctx.width_at
	var sill: float = ctx.sill
	var wear: Texture2D = ctx.get("wear")
	var rivets: Texture2D = ctx.get("rivets") # (a normal map: cockpit.gd's rivet_normal())
	var M := {
		inside = _std({color = 0x2b2e31, map = wear, roughnessMap = wear, roughness = 0.85, metalness = 0.12, side = Mat.BACK}),
		paint = _std({color = RLM66, map = wear, roughness = 0.78, metalness = 0.18}),
		frame = _std({color = 0x2f3235, map = wear, roughness = 0.8, metalness = 0.15}),
		bakelite = _std({color = 0x141312, roughness = 0.38, metalness = 0.05}),
		bezel = _std({color = 0x101010, roughness = 0.32, metalness = 0.45, side = Mat.DOUBLE}),
		steel = _std({color = 0x7c8084, roughness = 0.38, metalness = 0.8}),
		dark = _std({color = 0x1c1d1e, map = wear, roughness = 0.6, metalness = 0.3}),
		leather = _std({color = 0x4a2e1b, roughness = 0.72}), # the stick's boot
		pad = _std({color = 0x2a1e16, roughness = 0.8}), # the Revi's crash pad, dark and rubbed
		glove = _std({color = 0x3b2618, roughness = 0.78}),
		jacket = _std({color = 0x52361f, roughness = 0.82}), # the brown leather flying jacket
		trousers = _std({color = 0x4b4838, roughness = 0.92}),
		boots = _std({color = 0x161412, roughness = 0.55}),
		webbing = _std({color = 0x8c7f5b, roughness = 0.95}), # the harness
		red = _std({color = 0x9c1b12, roughness = 0.45}),
		yellow = _std({color = 0xd9a51a, roughness = 0.5}),
		blue = _std({color = 0x2c4f8f, roughness = 0.55, metalness = 0.2}), # the Höhenatmer
		white = _std({color = 0xd8d2bc, roughness = 0.6}),
		rubber = _std({color = 0x0c0c0c, roughness = 0.85}),
	}
	# (the inside's rivets: Three's bumpMap, bumpScale 0.25; here ctx.rivets is cockpit.gd's normal map made from
	# the same height canvas, its strength the bumpScale as cockpit.gd does it)
	if rivets:
		M.inside.normal_enabled = true
		M.inside.normal_texture = rivets
		M.inside.normal_scale = 0.25
	# the hose: yellow, ribbed (a bump map of rings along it: as in the web game, the canvas's rings lie across
	# its v, which on a tube runs round it, and repeat 160 times along u, where it's flat)
	var ribs := Image.create(8, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		var v := roundi(128 + 110 * sin((y / 64.0) * PI * 2)) / 255.0
		for x in 8:
			ribs.set_pixel(x, y, Color(v, v, v))
	M.hose = _std({color = 0xd6a51c, roughness = 0.55})
	M.hose.uv1_scale = Vector3(160, 1, 1) # (repeat.set(160, 1))
	_bump_image(M.hose, ribs, RIBS_STRENGTH)

	# the instruments' faces: one atlas drawn once (the needles, the compass card, the tapes are meshes over them)
	var faces := Canvas2D.new(ATLAS, ATLAS)
	var card := Canvas2D.new(CELL, CELL)
	var fn := draw_faces(faces, card)
	var atlas_tex := faces.texture(true)
	# (a little light of their own by day so the faces read in the shade under the coaming; the luminous paint's glow by night)
	var day_glow := Color(0.07, 0.07, 0.07).linear_to_srgb() # (Three's Color(r, g, b) is linear; Godot's emission colour is sRGB)
	M.face = Mat.standard({map = atlas_tex, emissiveMap = atlas_tex, emissive = day_glow, roughness = 0.55, metalness = 0.0})
	M.face.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY # (Three multiplies emissive by its map)
	M.face.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	M.needle = Mat.standard({color = INK, emissive = day_glow, roughness = 0.5}) # (luminous paint, like the faces')
	M.dial = Mat.standard({color = 0xffffff, transparent = true, opacity = 0.1, roughness = 0.05, metalness = 0.1, depthWrite = false})
	var lamp_red := Mat.standard({color = 0x5a0d08, emissive = 0xff2a10, emissiveIntensity = 0.25, roughness = 0.3})
	var lamp_fuel := Mat.standard({color = 0x5a0d08, emissive = 0xff2a10, emissiveIntensity = 0.0, roughness = 0.3})

	var pa := {} # material: [geos], merged at the end
	var wall := func(z: float) -> float: return width_at.call(z) - 0.03

	# ---- the tub: the fuselage's inside, its frames and stringers, the floor plates, the seat and its armour
	var b0 = body.clone()
	b0.delete_attribute("color")
	_add(pa, M.inside, b0) # (its paint is the outside's)
	for z in [-0.42, -0.12, 0.18, 0.48]:
		for s in [-1, 1]:
			_put(pa, M.paint, _box(0.022, 0.8, 0.04), s * (wall.call(z) - 0.008), sill - 0.44, z)
	for y in [sill - 0.2, sill - 0.48, sill - 0.75]:
		for s in [-1, 1]:
			_put(pa, M.paint, _box(0.018, 0.022, 1.0), s * (wall.call(0) - 0.01), y, 0.03)
	for s in [-1, 1]: # the floor: two grooved tread plates running forward to the pedals
		var a := Vector3(s * 0.15, -1.04, -0.4)
		var b := Vector3(s * 0.15, -0.98, -0.95)
		_bar(pa, M.dark, a, b, 0.15, 0.012)
		for k in range(1, 12):
			var p := a.lerp(b, k / 12.0)
			_put(pa, M.paint, _box(0.13, 0.008, 0.012), p.x, p.y + 0.008, p.z)
	_put(pa, M.paint, _box(0.5, 0.02, 0.7), 0, -1.12, 0.05) # (the floor under the seat)
	# the seat: a pressed bucket with lightening holes round its rim, the parachute pack you sit on
	_put(pa, M.paint, Geo.cylinder(0.235, 0.215, 0.42, 20, 1, true, -PI * 0.55, PI * 1.1).rotate_y(PI), 0, -0.86, 0.3, 0, 0, 0, 1)
	_put(pa, M.paint, _box(0.42, 0.025, 0.38), 0, -1.06, 0.18)
	for k in 6:
		var a := -0.9 + k * 0.36
		_put(pa, M.dark, _cyl(0.022, 0.022, 0.004, 12).rotate_x(PI / 2).rotate_y(a), sin(a) * 0.23, -0.73, 0.3 + cos(a) * 0.1)
	_put(pa, M.webbing, _rbox(0.38, 0.1, 0.34, 0.03), 0, -0.99, 0.17)
	_put(pa, M.paint, _box(0.44, 0.52, 0.009), 0, -0.48, 0.32, 0.1) # the back armour (8 mm)
	for s in [-1, 1]:
		for y in [-0.28, -0.66]:
			_put(pa, M.steel, _cyl(0.007, 0.007, 0.012, 8).rotate_x(PI / 2), s * 0.19, y, 0.31)

	# ---- the panel plates, the instruments in them, the coaming over them
	var mU := plate_matrix(UP)
	var mL := plate_matrix(LO)
	var upper_paint = plate_canvas(UP, 1024, func(f: Dictionary) -> void:
		f.plate.call(0.205, 0.105, 0.075, ["C 3", "96 Okt."]) # (the fuel's grade)
		f.plate.call(-0.212, 0.045, 0.056, ["Ladedruck", "max 1,42"])
		f.plate.call(0.212, -0.025, 0.055, ["Fahrwerk"])
		f.plate.call(-0.212, -0.06, 0.056, ["Revi", "Licht"])
		f.label.call(-0.205, 0.128, "SZKK 4", 11)
	)
	var lower_paint = plate_canvas(LO, 768, func(f: Dictionary) -> void:
		f.plate.call(0, 0.035, 0.07, ["Brandhahn"]); f.label.call(-0.028, -0.032, "ZU", 14); f.label.call(0.028, -0.032, "AUF", 14)
	)
	var upper_mat := _std({map = upper_paint.texture(true), roughness = 0.75, metalness = 0.15})
	var lower_mat := _std({map = lower_paint.texture(true), roughness = 0.75, metalness = 0.15})
	var holes := func(list: Array) -> Array: return list.map(func(i): return [i[1], i[2], i[3] + 0.0012])
	_add(pa, upper_mat, plate_geo(UP, holes.call(UPPER)), mU)
	_add(pa, lower_mat, plate_geo(LO, holes.call(LOWER)), mL)
	for mp in [[mU, UP], [mL, LO]]: # the box behind each plate (the instruments' cases), the rubber shock mounts
		var m: Transform3D = mp[0]
		var pl: Dictionary = mp[1]
		_add(pa, M.dark, _box(pl.w - 0.02, pl.h - 0.02, 0.12).translate(0, 0, -0.077), m)
		for s in [-1, 1]:
			for t in [-1, 1]:
				_add(pa, M.rubber, _cyl(0.009, 0.009, 0.012, 10).rotate_x(PI / 2).translate(s * (pl.wb / 2 - 0.012), t * (pl.h / 2 - 0.012), 0.001), m)
	var dials := {} # cell: {m (its plate), x, y, r}
	for i in UPPER:
		_instrument(pa, M, dials, mU, i)
	for i in LOWER:
		_instrument(pa, M, dials, mL, i)
	# the SZKK 4: a box over the panel's top left, its tapes behind three windows (the tapes: below)
	if true:
		var x: float = SZKK.x
		var y: float = SZKK.y
		var w: float = SZKK.w
		var h: float = SZKK.h
		var i0 := CELLS.find("szkk")
		var col := i0 % 4
		var row := i0 >> 2
		_add(pa, M.dark, _rbox(w + 0.012, h + 0.012, 0.03, 0.004).translate(x, y, -0.008), mU)
		var q = Geo.plane(w, h)
		var uv: PackedVector2Array = q.uvs
		for i in uv.size():
			uv[i] = Vector2((col + uv[i].x) / 4, 1 - (row + 1 - (0.3 + uv[i].y * 0.4)) / 4) # (the cell's middle band: 256 x 102 px)
		q.uvs = uv
		_add(pa, M.face, q.translate(x, y, 0.0075), mU)
		_add(pa, M.dial, Geo.plane(w, h).translate(x, y, 0.0085), mU)
	# the lamps: the gear's (red: up) and the low-fuel warning
	for k in [-1, 1]:
		_add(pa, M.bezel, _cyl(0.0085, 0.0085, 0.008, 12).rotate_x(PI / 2).translate(0.212 + k * 0.014, -0.058, 0.002), mU)
		_add(pa, lamp_red, Geo.sphere(0.0062, 10, 6).translate(0.212 + k * 0.014, -0.058, 0.005), mU)
	_add(pa, M.bezel, _cyl(0.009, 0.009, 0.008, 12).rotate_x(PI / 2).translate(0.203, 0.03, 0.002), mL); _add(pa, lamp_fuel, Geo.sphere(0.0068, 10, 6).translate(0.203, 0.03, 0.005), mL)
	# the Revi's light switch and dimmer by it, the fuel cock (Brandhahn) on the lower plate: its yellow lever
	_add(pa, M.bakelite, _cyl(0.009, 0.011, 0.014, 12).rotate_x(PI / 2).translate(-0.212, -0.1, 0.006), mU)
	_add(pa, M.steel, _cyl(0.016, 0.016, 0.006, 16).rotate_x(PI / 2).translate(0, -0.012, 0.002), mL)
	_add(pa, M.yellow, _rbox(0.012, 0.05, 0.012, 0.005).rotate_z(-0.9).translate(0.014, -0.004, 0.012), mL)
	# the coaming over the upper plate, under the windscreen
	_put(pa, M.paint, _box(0.56, 0.016, 0.09), 0, -0.146, -0.62)
	_put(pa, M.rubber, _cyl(0.009, 0.009, 0.52, 10), 0, -0.14, -0.578, 0, 0, PI / 2) # (its rubbed edge)

	# ---- the left side: the throttle quadrant, the starter and primer panel, the big wheels, the canopy's levers
	var L: float = -wall.call(-0.2)
	var left_plate := side_canvas(512, 256, func(x) -> void:
		x.fill_style = "#d6cfb4"
		for e in [[96, 34, "Zündung"], [256, 34, "Anlasser"], [416, 34, "Einspritzpumpe"], [128, 150, "Fahrwerk"], [384, 150, "Kraftstoffpumpe"]]:
			x.fill_rect(e[0] - 62, e[1] - 11, 124, 22); x.fill_style = "#16140f"; x.font = "700 15px Arial"; x.fill_text(e[2], e[0], e[1]); x.fill_style = "#d6cfb4"
		x.fill_style = "#e4ddc6"; x.font = "700 13px Arial"
		for e in [[60, 120, "M1"], [96, 128, "0"], [132, 120, "M2"], [96, 70, "M1+2"], [90, 228, "AUS"], [166, 228, "EIN"], [350, 228, "AUS"], [418, 228, "EIN"]]:
			x.fill_text(e[2], e[0], e[1])
	)
	var lp_mat := _std({map = left_plate, roughness = 0.75, metalness = 0.15})
	var mLP := _compose(Vector3(L + 0.075, -0.33, -0.47), Vector3(-0.5, 0.95, 0), EULER_ORDER_YXZ, 1)
	_add(pa, lp_mat, _box(0.2, 0.1, 0.008), mLP)
	_add(pa, M.bakelite, _cyl(0.016, 0.018, 0.012, 16).rotate_x(PI / 2).translate(-0.062, 0.006, 0.008), mLP) # the magneto switch and its bar
	_add(pa, M.bakelite, _rbox(0.032, 0.008, 0.01, 0.003).translate(-0.062, 0.006, 0.016), mLP)
	_add(pa, M.steel, _cyl(0.004, 0.004, 0.04, 8).rotate_x(PI / 2).translate(0, 0.012, 0.022), mLP); _add(pa, M.bakelite, _rbox(0.03, 0.01, 0.012, 0.004).translate(0, 0.012, 0.042), mLP) # the starter's T-handle
	_add(pa, M.steel, _cyl(0.005, 0.005, 0.035, 8).rotate_x(PI / 2).translate(0.062, 0.012, 0.02), mLP); _add(pa, M.bakelite, Geo.sphere(0.012, 12, 8).translate(0.062, 0.012, 0.04), mLP) # the primer's knob
	for pp in [[-0.058, -0.03], [-0.036, -0.03], [0.04, -0.03], [0.066, -0.03]]: # the toggles
		_add(pa, M.bezel, _cyl(0.007, 0.007, 0.008, 10).rotate_x(PI / 2).translate(pp[0], pp[1], 0.006), mLP)
		_add(pa, M.steel, _cyl(0.0022, 0.003, 0.02, 6).rotate_x(PI / 2 - 0.4).translate(pp[0], pp[1] + 0.003, 0.014), mLP)
	# the throttle quadrant: the slotted plate along the wall under the sill, its lever moving in it
	_put(pa, M.dark, _rbox(0.035, 0.05, 0.3, 0.01), L + 0.02, -0.4, -0.3)
	_put(pa, M.rubber, _box(0.006, 0.006, 0.26), L + 0.038, -0.375, -0.3)
	_put(pa, M.white, _box(0.002, 0.012, 0.006), L + 0.04, -0.388, -0.41); _put(pa, M.red, _box(0.002, 0.012, 0.006), L + 0.04, -0.388, -0.19) # (the stops: full and cut-off)
	# the tail trim and flap wheels: outboard the bigger flap wheel, inboard the trim wheel with its white index
	var wheel_at := Vector3(L + 0.03, -0.64, 0.04)
	var wheel := func(x: float, r: float, mat, n: int) -> void:
		_put(pa, mat, Geo.torus(r, r * 0.08, 8, 40), x, wheel_at.y, wheel_at.z, 0, PI / 2, 0)
		_put(pa, mat, _cyl(r * 0.18, r * 0.18, 0.02, 16), x, wheel_at.y, wheel_at.z, 0, 0, PI / 2)
		for k in n:
			_put(pa, mat, _box(0.006, r * 1.9, r * 0.09), x, wheel_at.y, wheel_at.z, (float(k) / n) * PI)
		for k in 18: # (the grip's knurls)
			var a := (k / 18.0) * PI * 2
			_put(pa, mat, Geo.sphere(r * 0.075, 6, 4), x, wheel_at.y + cos(a) * r, wheel_at.z + sin(a) * r)
	wheel.call(wheel_at.x - 0.012, 0.15, M.bakelite, 3)
	wheel.call(wheel_at.x + 0.012, 0.12, M.dark, 4)
	for k in 6: # the trim wheel's white stripes
		_put(pa, M.white, _box(0.004, 0.025, 0.012), wheel_at.x + 0.02, wheel_at.y + cos(k * 1.05) * 0.112, wheel_at.z + sin(k * 1.05) * 0.112, k * 1.05)
	_put(pa, M.steel, _cyl(0.012, 0.012, 0.06, 12), wheel_at.x - 0.01, wheel_at.y, wheel_at.z, 0, 0, PI / 2)
	var trim_plate := side_canvas(256, 128, func(x) -> void:
		x.fill_style = "#d6cfb4"; x.fill_rect(8, 8, 240, 112); x.fill_style = "#16140f"; x.font = "700 18px Arial"; x.fill_text("Höhenflosse", 128, 30); x.fill_text("kopflastig", 128, 62)
		x.font = "700 22px Arial"; x.fill_text("0", 128, 84); x.font = "700 18px Arial"; x.fill_text("schwanzlastig", 128, 106)
	)
	_put(pa, _std({map = trim_plate, roughness = 0.7}), _box(0.004, 0.06, 0.12), L + 0.004, -0.5, -0.17, 0, 0, 0)
	# the canopy's red jettison handle and its lever, on the left up front
	_put(pa, M.red, _rbox(0.02, 0.05, 0.02, 0.006), L + 0.03, -0.2, -0.46, 0.3)
	_put(pa, M.dark, _cyl(0.005, 0.005, 0.06, 8), L + 0.025, -0.18, -0.08, 0, 0, PI / 2 - 0.3); _put(pa, M.bakelite, Geo.sphere(0.011, 10, 6), L + 0.05, -0.165, -0.08)

	# ---- the right side: the breaker panel, the radio's box, the oxygen regulator and its hose
	var R: float = wall.call(-0.2)
	var breakers := side_canvas(512, 256, func(x) -> void:
		var names := [["Batterie", "Generator", "Funk", "Revi", "Waffen"], ["Staurohr", "Instr.-Bel.", "Kraftst.-P.", "Pos.-Licht", "Höhenatm."]]
		x.font = "700 14px Arial"
		for j in names.size():
			for i in names[j].size():
				var px := 52 + i * 102
				var py := 30 + j * 128
				x.fill_style = "#d6cfb4"; x.fill_rect(px - 46, py - 10, 92, 20); x.fill_style = "#16140f"; x.fill_text(names[j][i], px, py)
		x.fill_style = "#d6cfb4"; x.fill_rect(150, 226, 212, 22); x.fill_style = "#16140f"; x.font = "700 15px Arial"; x.fill_text("Selbstschalter", 256, 237)
	)
	var mRP := _compose(Vector3(R - 0.05, -0.33, -0.32), Vector3(-0.45, -1.15, 0), EULER_ORDER_YXZ, 0.8)
	_add(pa, _std({map = breakers, roughness = 0.75, metalness = 0.15}), _box(0.22, 0.11, 0.008), mRP)
	_add(pa, M.dark, _box(0.23, 0.12, 0.05).translate(0, 0, -0.03), mRP)
	for j in 2:
		for i in 5: # the breakers: black toggles with white tips
			var px := -0.088 + i * 0.044
			var py := 0.012 - j * 0.055
			_add(pa, M.bakelite, _rbox(0.022, 0.026, 0.012, 0.004).translate(px, py, 0.008), mRP)
			_add(pa, M.bakelite, _rbox(0.007, 0.02, 0.007, 0.003).rotate_x(-0.5).translate(px, py + 0.008, 0.02), mRP)
			_add(pa, M.white, _box(0.0075, 0.005, 0.0075).translate(px, py + 0.017, 0.026), mRP)
	# the FuG 16Z's control box, the radio's: its tuning knob and the volume
	_put(pa, M.dark, _rbox(0.06, 0.1, 0.17, 0.008), R - 0.03, -0.48, 0.02)
	_put(pa, M.bakelite, _cyl(0.022, 0.022, 0.018, 18), R - 0.065, -0.47, -0.01, 0, 0, PI / 2)
	_put(pa, M.bakelite, _cyl(0.012, 0.012, 0.016, 14), R - 0.065, -0.48, 0.07, 0, 0, PI / 2)
	_put(pa, M.white, _box(0.004, 0.03, 0.08), R - 0.061, -0.42, 0.03)
	# the Höhenatmer: the blue regulator low on the wall, its gauge and flow indicator above on a small plate
	_put(pa, M.blue, _rbox(0.07, 0.12, 0.14, 0.012), R - 0.035, -0.66, -0.2)
	_put(pa, M.blue, _cyl(0.035, 0.035, 0.04, 18), R - 0.075, -0.64, -0.2, 0, 0, PI / 2)
	_put(pa, M.bakelite, _cyl(0.02, 0.02, 0.02, 16), R - 0.1, -0.64, -0.2, 0, 0, PI / 2)
	_put(pa, M.steel, _cyl(0.015, 0.015, 0.03, 12), R - 0.04, -0.585, -0.2)
	var mO2 := _compose(Vector3(R - 0.05, -0.47, -0.5), Vector3(-0.55, -0.85, 0), EULER_ORDER_YXZ, 1)
	_add(pa, M.paint, _box(0.14, 0.075, 0.008).translate(0, 0, -0.02), mO2)
	_add(pa, M.dark, _box(0.13, 0.065, 0.06).translate(0, 0, -0.055), mO2)
	_instrument(pa, M, dials, mO2, ["o2", -0.033, 0, 0.022])
	_instrument(pa, M, dials, mO2, ["blink", 0.033, 0, 0.018])
	# the yellow hose: out of the regulator, up the wall, across to the mask on your face
	var hose := Shapes.CatmullRomCurve3.new([Vector3(R - 0.04, -0.57, -0.2), Vector3(R - 0.06, -0.47, -0.16), Vector3(R - 0.13, -0.42, -0.05), Vector3(0.18, -0.38, 0.02), Vector3(0.1, -0.27, 0.01), Vector3(0.05, -0.15, -0.02)])
	_add(pa, M.hose, Geo.tube(hose, 64, 0.014, 10))
	for t in [0.0, 1.0]: # (its unions)
		var hp: Vector3 = hose.get_point(t)
		_put(pa, M.dark, Geo.sphere(0.019, 10, 8), hp.x, hp.y, hp.z)

	# ---- the rudder pedals: cast, with their straps, on their arms
	for s in [-1, 1]:
		var x := s * 0.15
		var y := -0.9
		var z := -0.98
		_put(pa, M.dark, _rbox(0.1, 0.17, 0.022, 0.008), x, y, z, 0.35)
		for k in 3:
			_put(pa, M.rubber, _box(0.084, 0.012, 0.006), x, y - 0.05 + k * 0.05, z + 0.012, 0.35)
		_put(pa, M.leather, _rbox(0.104, 0.03, 0.04, 0.006), x, y + 0.03, z + 0.025, 0.35)
		_put(pa, M.paint, _cyl(0.012, 0.012, 0.3, 8), x, -1.04, z + 0.05, PI / 2 - 0.25)

	# ---- the canopy: the armoured windscreen and the old framed hood, its frames RLM 66 inside
	var glass = ctx.glass
	var yb := sill - 0.01
	var fl := Vector3(-0.165, yb, -0.6)
	var fr := Vector3(0.165, yb, -0.6)
	var tl := Vector3(-0.135, 0.2, -0.37)
	var tr := Vector3(0.135, 0.2, -0.37)
	var bl := Vector3(-wall.call(-0.3) - 0.01, yb, -0.3)
	var br := Vector3(wall.call(-0.3) + 0.01, yb, -0.3)
	var btl := Vector3(-0.215, 0.235, -0.3)
	var btr := Vector3(0.215, 0.235, -0.3)
	var out := Vector3(0, 0.4, -1).normalized()
	_add(pa, glass, Cockpit.quad_geo(fl, fr, tr, tl)); _add(pa, glass, Cockpit.quad_geo(bl, fl, tl, btl)); _add(pa, glass, Cockpit.quad_geo(fr, br, btr, tr)); _add(pa, glass, Cockpit.quad_geo(tl, tr, btr, btl))
	for ab in [[fl, tl], [fr, tr], [tl, tr], [fl, fr]]:
		_bar(pa, M.frame, ab[0], ab[1], 0.03, 0.04, out)
	for ab in [[tl, btl], [tr, btr], [fl, bl], [fr, br]]: # (its back edge is the hood's front bow)
		_bar(pa, M.frame, ab[0], ab[1], 0.024, 0.026, Vector3(0, 1, 0))
	# the 50 mm armoured glass of the front pane (green only along its edges)
	var agm := Transform3D(Basis(Vector3(1, 0, 0), atan2(tl.z - fl.z, tl.y - fl.y)), Vector3(0, (yb + 0.2) / 2 + 0.012, (-0.6 - 0.37) / 2 + 0.02))
	var sh := Vector2(tl.z - fl.z, tl.y - fl.y).length() - 0.02
	var sw := 0.27
	_add(pa, ctx.armour, Geo.plane(sw, sh).translate(0, 0, 0.025), agm) # (its inner face: the front pane is the outer)
	for s in [-1, 1]:
		_add(pa, ctx.armour_edge, _box(sw, 0.005, 0.05).translate(0, s * (sh / 2 - 0.0025), 0), agm)
		_add(pa, ctx.armour_edge, _box(0.005, sh, 0.05).translate(s * (sw / 2 - 0.0025), 0, 0), agm)
	# the hood: a flat roof pane, each side split by one bar, its bows front and back; hinged on the right
	var rear := 0.5
	var hood := func(z: float) -> Dictionary:
		var wz: float = wall.call(z)
		return {sl = Vector3(-wz - 0.01, yb, z), ml = Vector3(-(wz + 0.215) / 2 - 0.02, 0.055, z), tl = Vector3(-0.215, 0.235, z), tr = Vector3(0.215, 0.235, z), mr = Vector3((wz + 0.215) / 2 + 0.02, 0.055, z), sr = Vector3(wz + 0.01, yb, z)}
	var hf: Dictionary = hood.call(-0.3)
	var hb: Dictionary = hood.call(rear)
	for h in [hf, hb]:
		for ab in [[h.sl, h.ml], [h.ml, h.tl], [h.tl, h.tr], [h.tr, h.mr], [h.mr, h.sr]]:
			_bar(pa, M.frame, ab[0], ab[1], 0.028, 0.03, Vector3(0, 0, 1))
	for k in ["sl", "ml", "tl", "tr", "mr", "sr"]:
		_bar(pa, M.frame, hf[k], hb[k], 0.024, 0.028, Vector3(1, 0.3, 0) if k[1] == "l" or k == "sl" else Vector3(-1, 0.3, 0))
	for q in [[hb.sl, hf.sl, hf.ml, hb.ml], [hb.ml, hf.ml, hf.tl, hb.tl], [hf.tl, hf.tr, hb.tr, hb.tl], [hf.tr, hf.mr, hb.mr, hb.tr], [hf.mr, hf.sr, hb.sr, hb.mr]]:
		_add(pa, glass, Cockpit.quad_geo(q[0], q[1], q[2], q[3]))
	for z in [-0.15, 0.15, 0.4]: # the hinges
		_put(pa, M.frame, _box(0.03, 0.02, 0.05), hf.sr.x - 0.012, yb + 0.02, z)
	# behind the hood the fixed glazing, down to the spine
	var sp := Vector3(0, 0.07, 1.0)
	var spl := Vector3(-0.13, 0.03, 1.0)
	var spr := Vector3(0.13, 0.03, 1.0)
	_add(pa, glass, Cockpit.quad_geo(hb.sl, hb.tl, spl, spl)); _add(pa, glass, Cockpit.quad_geo(hb.tl, hb.tr, spr, spl)); _add(pa, glass, Cockpit.quad_geo(hb.tr, hb.sr, spr, spr))
	for ab in [[hb.tl, spl], [hb.tr, spr], [spl, sp], [sp, spr]]:
		_bar(pa, M.frame, ab[0], ab[1], 0.024, 0.026, Vector3(0, 1, 0))
	# the head armour, bolted to the hood behind your head: steel, its top rounded to the hood
	if true:
		var s := Shapes.Shape.new()
		s.move_to(-0.2, -0.13); s.line_to(0.2, -0.13); s.line_to(0.2, 0.12); s.quadratic_curve_to(0.19, 0.215, 0, 0.222); s.quadratic_curve_to(-0.19, 0.215, -0.2, 0.12); s.close_path()
		var plate = Geo.extrude(s, {depth = 0.012, bevelEnabled = true, bevelThickness = 0.002, bevelSize = 0.002, bevelSegments = 1, curveSegments = 16})
		_put(pa, M.paint, plate, 0, -0.005, 0.42, -0.05)
		for xy in [[-0.16, 0.1], [0.16, 0.1], [-0.16, -0.09], [0.16, -0.09]]:
			_put(pa, M.steel, _cyl(0.008, 0.008, 0.006, 10).rotate_x(PI / 2), xy[0], xy[1] - 0.005, 0.418)
		for s2 in [-1, 1]:
			_bar(pa, M.frame, Vector3(s2 * 0.14, 0.2, 0.425), Vector3(s2 * 0.17, 0.235, rear), 0.02, 0.012, Vector3(0, 0, 1))

	# ---- the Revi 16B on its bracket over the panel: the reflector glass at eye level, the crash pad behind
	_put(pa, M.dark, _box(0.05, 0.012, 0.15), 0, -0.153, -0.52) # the bracket, from the panel's top back over it
	_put(pa, M.dark, _rbox(0.068, 0.085, 0.085, 0.008), 0, -0.106, -0.442) # the body
	_put(pa, M.dark, _rbox(0.078, 0.024, 0.08, 0.006), 0, -0.052, -0.442) # the head
	_put(pa, M.dark, _cyl(0.02, 0.02, 0.07, 16), -0.045, -0.115, -0.46, 0, 0, PI / 2) # the lamp housing
	_put(pa, M.steel, _cyl(0.016, 0.016, 0.01, 16), -0.082, -0.115, -0.46, 0, 0, PI / 2)
	_put(pa, M.bakelite, _cyl(0.012, 0.012, 0.014, 14), 0.04, -0.085, -0.44, 0, 0, PI / 2) # the dimmer knob
	_put(pa, M.bezel, _cyl(0.024, 0.024, 0.006, 24), 0, -0.039, -0.442) # the lens's ring
	_put(pa, Mat.standard({color = 0x9fb8c4, transparent = true, opacity = 0.5, roughness = 0.05, depthWrite = false}), Geo.circle(0.02, 24), 0, -0.0355, -0.442, -PI / 2)
	_put(pa, M.dark, _box(0.08, 0.008, 0.012), 0, -0.042, -0.448) # the glass's clamp
	_put(pa, M.pad, _rbox(0.058, 0.044, 0.03, 0.012), 0, -0.102, -0.39) # the crash pad
	var sight_glass := Mat.standard({color = 0x9fc4c8, transparent = true, opacity = 0.32, roughness = 0.02, metalness = 0.2, depthWrite = false, side = Mat.DOUBLE})
	_put(pa, sight_glass, Geo.plane(0.076, 0.09), 0, -0.012, -0.415, PI / 4) # the reflector glass, leaning back to you
	_put(pa, Mat.standard({color = 0x4a3418, transparent = true, opacity = 0.55, roughness = 0.05, depthWrite = false, side = Mat.DOUBLE}), Geo.plane(0.07, 0.05), 0, -0.07, -0.49, -0.25) # the sun filter, folded down in front
	_put(pa, M.steel, _cyl(0.004, 0.004, 0.075, 8), 0, -0.046, -0.485, 0, 0, PI / 2) # (its hinge)

	# ---- you: shoulders and arms in the leather jacket, the harness over them, legs to the pedals
	for s in [-1, 1]:
		_put(pa, M.jacket, Geo.capsule(0.075, 0.12, 4, 12), s * 0.19, -0.27, 0.13, 0, 0, PI / 2 + s * 0.25)
		_bar(pa, M.webbing, Vector3(s * 0.12, -0.18, 0.3), Vector3(s * 0.11, -0.2, 0.06), 0.045, 0.006, Vector3(0, 1, 0)) # the shoulder straps, over and down
		_bar(pa, M.webbing, Vector3(s * 0.11, -0.2, 0.06), Vector3(s * 0.06, -0.55, -0.02), 0.045, 0.006, Vector3(0, 0, -1))
		_put(pa, M.steel, _box(0.04, 0.03, 0.006), s * 0.09, -0.36, 0.02) # (their adjusters)
		_put(pa, M.trousers, Geo.capsule(0.075, 0.42, 4, 12), s * 0.12, -0.74, -0.12, PI / 2 - 0.42) # the thighs, the knees up under the panel
		_put(pa, M.trousers, Geo.capsule(0.058, 0.38, 4, 12), s * 0.14, -0.86, -0.6, 0.62)
		_put(pa, M.boots, _rbox(0.1, 0.12, 0.2, 0.04), s * 0.15, -0.94, -0.88, 0.35)
	_put(pa, M.steel, _cyl(0.04, 0.04, 0.02, 20), 0, -0.6, -0.04, PI / 2 - 0.3) # the harness's quick-release buckle
	for s in [-1, 1]: # the lap straps
		_bar(pa, M.webbing, Vector3(s * 0.22, -0.82, 0.12), Vector3(s * 0.03, -0.62, -0.05), 0.05, 0.006, Vector3(0, 1, 0))
	for s in [-1, 1]: # the upper arms
		_put(pa, M.jacket, Geo.capsule(0.055, 0.2, 4, 10), s * 0.24, -0.43, 0.06, 0.3, 0, -s * 0.2)

	# ---- what moves: the stick (KG 13A grip), the throttle, with your gloved hands on them
	# (their shade is baked as the web game bakes it: each group's own position only, before it moves)
	var stick := Node3D.new()
	stick.rotation_order = EULER_ORDER_XYZ
	stick.position = Vector3(0, -1.02, -0.27)
	g.add_child(stick)
	var stick_m := Transform3D(Basis(), stick.position)
	var sp2 := func(mat, geo) -> MeshInstance3D:
		var t = Cockpit.tidy(geo, true)
		if _vc(mat):
			shade(t, stick_m)
		var m := _mesh(t, mat)
		stick.add_child(m)
		return m
	sp2.call(M.leather, Geo.lathe([[0.07, 0], [0.068, 0.02], [0.055, 0.03], [0.058, 0.045], [0.044, 0.055], [0.046, 0.07], [0.032, 0.08], [0.033, 0.095], [0.02, 0.11], [0.016, 0.12]].map(func(p): return Vector2(p[0], p[1])), 18)) # the leather boot
	sp2.call(M.dark, _cyl(0.014, 0.017, 0.46, 12).translate(0, 0.33, 0))
	sp2.call(M.steel, _cyl(0.019, 0.019, 0.025, 12).translate(0, 0.5, 0)) # (the collar)
	var grip = Geo.lathe([[0, 0], [0.019, 0], [0.021, 0.02], [0.019, 0.05], [0.021, 0.08], [0.024, 0.1], [0.022, 0.115], [0, 0.12]].map(func(p): return Vector2(p[0], p[1])), 16).translate(0, 0.51, 0)
	sp2.call(M.bakelite, grip)
	sp2.call(M.bakelite, _rbox(0.044, 0.026, 0.05, 0.01).rotate_x(-0.25).translate(0, 0.635, -0.008)) # the head of the grip
	sp2.call(M.red, _cyl(0.008, 0.008, 0.008, 12).translate(-0.012, 0.652, 0.004)) # the cannon button under your thumb
	sp2.call(M.dark, _rbox(0.018, 0.005, 0.022, 0.002).rotate_x(-0.3).translate(0.008, 0.653, -0.012)) # the bomb button's flip cover
	sp2.call(M.steel, Geo.torus(0.022, 0.0035, 6, 12, PI * 0.9).rotate_y(PI / 2).translate(0, 0.6, -0.03)) # the MG trigger, its bow round the front
	var rh := hand_geo(0.021, false, Vector3(0.35, -0.45, 0.82))
	for gm in [[rh.glove, M.glove], [rh.sleeve, M.jacket]]:
		shade(gm[0], stick_m)
		var m := _mesh(gm[0], gm[1])
		m.position = Vector3(0, 0.58, 0)
		stick.add_child(m)
	# the throttle: its lever pivots in the quadrant, the knob with the prop-pitch thumb rocker
	var throttle := Node3D.new()
	throttle.position = Vector3(L + 0.035, -0.4, -0.3)
	g.add_child(throttle)
	var throttle_m := Transform3D(Basis(), throttle.position)
	var lever := Node3D.new()
	lever.rotation_order = EULER_ORDER_XYZ
	throttle.add_child(lever)
	var lm := func(mat, geo) -> MeshInstance3D:
		var t = Cockpit.tidy(geo, true)
		if _vc(mat):
			shade(t, throttle_m)
		var m := _mesh(t, mat)
		lever.add_child(m)
		return m
	lm.call(M.bakelite, _cyl(0.007, 0.009, 0.13, 8).translate(0, 0.065, 0).rotate_z(-0.45))
	var kp := Vector3(0.058, 0.118, 0)
	lm.call(M.bakelite, Geo.sphere(0.026, 14, 10).scale(1, 0.85, 1.25).translate(kp.x, kp.y, kp.z))
	lm.call(M.steel, _rbox(0.012, 0.008, 0.02, 0.003).translate(kp.x + 0.012, kp.y + 0.022, kp.z)) # (the rocker)
	var lh := hand_geo(0.026, true, Vector3(-0.2, -0.5, 0.85))
	for gm in [[lh.glove, M.glove], [lh.sleeve, M.jacket]]:
		shade(gm[0], throttle_m)
		var m := _mesh(gm[0], gm[1])
		m.position = kp + Vector3(0, -0.012, 0)
		m.rotation = Vector3(0, 0, -0.45)
		lever.add_child(m)

	# ---- live: the needles, the compass card, the slip ball, the flow indicator's flaps, the ammunition tapes:
	# small meshes over the faces (no texture to upload each frame), on nodes that carry each plate's frame
	var plates := {}
	var N := {
		speed = _hand(pa, M, dials, plates, g, "speed", 108, 9), altKm = _hand(pa, M, dials, plates, g, "alt", 66, 14, 0, 0, 15), alt = _hand(pa, M, dials, plates, g, "alt", 110, 8, 0, 0, 15),
		boost = _hand(pa, M, dials, plates, g, "boost", 104, 9), rpm = _hand(pa, M, dials, plates, g, "rpm", 104, 9),
		turn = _hand(pa, M, dials, plates, g, "turn", 100, 12, 0, 10), propH = _hand(pa, M, dials, plates, g, "prop", 66, 14), propM = _hand(pa, M, dials, plates, g, "prop", 104, 9),
		coolant = _hand(pa, M, dials, plates, g, "coolant", 104, 9), oil = _hand(pa, M, dials, plates, g, "oil", 104, 9),
		fuelP = _hand(pa, M, dials, plates, g, "press", 100, 9), oilP = _hand(pa, M, dials, plates, g, "press", 100, 9), fuel = _hand(pa, M, dials, plates, g, "fuel", 104, 9), o2 = _hand(pa, M, dials, plates, g, "o2", 104, 9),
	}
	# the compass card turning under its lubber mark and the course cross
	var cd: Dictionary = dials.compass
	var ck: float = cd.r / 128
	var compass := _mesh(face_geo(cd.r * 0.995, "compass"), M.face)
	compass.position = Vector3(cd.x, cd.y, -0.0114)
	_plate_group(plates, g, cd.m).add_child(compass)
	if true:
		var t := Shapes.Shape.new()
		t.move_to(0, 84); t.line_to(-11, 112); t.line_to(11, 112); t.close_path()
		_add(pa, M.needle, Geo.shape(t).scale(ck, ck, 1).translate(cd.x, cd.y, -0.0105), cd.m)
	for wh in [[80, 3], [3, 70]]:
		_add(pa, M.red, _box(wh[0] * ck, wh[1] * ck, 0.0004).translate(cd.x, cd.y, -0.0106), cd.m)
	# the slip ball in its tube
	var td: Dictionary = dials.turn
	var tk: float = td.r / 128
	var ball := _mesh(Cockpit.tidy(Geo.sphere(12 * tk, 10, 8), true), M.rubber)
	_plate_group(plates, g, td.m).add_child(ball)
	# the flow indicator's flaps, opening as you breathe
	var bd: Dictionary = dials.blink
	var bk: float = bd.r / 128
	var flaps := []
	for sd in [-1, 1]:
		var f := _mesh(Geo.plane(60 * bk, 60 * bk).translate(-sd * 30 * bk, 0, 0), M.needle)
		f.position = Vector3(bd.x + sd * 60 * bk, bd.y - 10 * bk, -0.0106)
		_plate_group(plates, g, bd.m).add_child(f)
		flaps.append(f)
	# the SZKK 4's tapes: one a gun, running down as it fires
	var kx: float = SZKK.w / 256.0
	var ky: float = SZKK.h / 102.4
	var tapes := []
	for i in 3:
		var t := _mesh(Geo.plane(36 * kx, 76 * ky).translate(0, 38 * ky, 0), M.needle)
		t.position = Vector3(SZKK.x + (-80 + i * 80) * kx, SZKK.y - 36 * ky, 0.0079)
		_plate_group(plates, g, mU).add_child(t)
		tapes.append(t)

	# ---- merge: one mesh per material, the shade baked in (glass drawn after the rest: Godot draws every
	# transparent surface after the opaque ones, back to front, as Three does with the same renderOrder)
	for mat in pa:
		var geo = Geo.merge(pa[mat])
		if _vc(mat):
			shade(geo)
		var m := MeshInstance3D.new()
		m.mesh = geo.to_mesh(mat)
		if mat is BaseMaterial3D and mat.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF # (the canopy's and the dials' glass)
		g.add_child(m)

	var st := {coolant = 85.0, oil = 70.0, fuel = 330.0, bank = 0.0, ball = 0.0, ammo = null, t = 0.0}
	var update := func(s: Dictionary, dt: float) -> void:
		var ammo = s.get("ammo")
		if not is_same(ammo, st.ammo): # (a new sortie: a fresh tank)
			if st.ammo != null:
				st.fuel = 330.0
			st.ammo = ammo
		st.t += dt
		var throttle_v: float = s.throttle
		var damaged: bool = true if s.get("damage") else false
		var speed: float = s.speed
		var k := 1 - exp(-dt * 0.08)
		st.coolant += (82 + throttle_v * 18 + (38 if damaged else 0) - st.coolant) * k
		st.oil += (64 + throttle_v * 16 + (30 if damaged else 0) - st.oil) * k
		st.fuel = maxf(0, st.fuel - dt * (0.04 + throttle_v * 0.085)) # l/s: the DB 605 at full power drinks ~7 l a minute
		var roll: float = (s.bank - st.bank) / maxf(dt, 1e-3)
		st.bank = s.bank
		st.ball += (clampf(-roll * 0.12, -1, 1) - st.ball) * (1 - exp(-dt * 3))
		lamp_fuel.emission_energy_multiplier = 2.2 if st.fuel < 100 else 0.0
		var ias := speed * 3.6 * sqrt(maxf(0.05, pow(1 - 2.2558e-5 * maxf(0, s.alt), 4.2559))) # (the Fahrtmesser reads indicated airspeed: thinner air up here)
		turn_to(N.speed, speed_angle(ias))
		var km := maxf(0, s.alt) / 1000
		turn_to(N.altKm, TOP + (km / 10) * PI * 2); turn_to(N.alt, TOP + fmod(km, 1.0) * PI * 2)
		turn_to(N.boost, fn.boost.call(clampf(0.6 + throttle_v * 0.82 - (0.15 if damaged else 0.0), 0.6, 1.8)))
		turn_to(N.rpm, fn.rpm.call(clampf(1600 + throttle_v * 1200 + (speed - 130) * 2, 600, 3000) / 100))
		var rate := (9.81 * tan(clampf(s.bank, -1.4, 1.4))) / maxf(60, speed) # rad/s
		turn_to(N.turn, TOP + clampf(rate / 0.105, -1, 1) * 0.66)
		var ba: float = PI / 2 + clampf(st.ball, -1, 1) * 0.3
		ball.position = Vector3(td.x + cos(ba) * 222 * tk, td.y - (-140 + sin(ba) * 222) * tk, -0.0106)
		compass.rotation.z = s.heading
		var h := 11.5 + (speed - 120) / 90 + (1 - throttle_v) * 0.6
		turn_to(N.propH, TOP + (h / 12) * PI * 2); turn_to(N.propM, TOP + fmod(h, 1.0) * PI * 2)
		turn_to(N.coolant, fn.coolant.call(st.coolant)); turn_to(N.oil, fn.oil.call(st.oil))
		turn_to(N.fuelP, fn.fuelP.call(1.2 + throttle_v * 0.3)); turn_to(N.oilP, fn.oilP.call(2.5 if damaged else 5.5 + throttle_v * 2))
		turn_to(N.fuel, fn.fuel.call(st.fuel)); turn_to(N.o2, fn.o2.call(140 - st.t * 0.02))
		var open := pow(maxf(0, sin(st.t * 1.6)), 0.5)
		for f in flaps:
			f.scale.x = maxf(0.001, 1 - open)
		var am = s.get("ammo")
		var am_max = s.get("ammoMax")
		for i in tapes.size():
			var j: int = [0, 2, 1][i]
			var left := 1.0
			if am and am_max and j < am.size():
				left = float(am[j]) / float(am_max[j])
			tapes[i].scale.y = maxf(0.001, left)
		stick.rotation.x = clampf(s.stickY, -1, 1) * 0.2 # (back to pull up)
		stick.rotation.z = clampf(-s.stickX, -1, 1) * 0.22
		lever.rotation.x = 0.45 - throttle_v * 0.9 # (forward for full throttle)
	var night := func(k: float) -> void:
		# the luminous paint glowing green-white under the UV lamps; the lamps showing up in the dark
		M.face.emission = Color(0.07 + 0.5 * k, 0.07 + 1.0 * k, 0.07 + 0.62 * k).linear_to_srgb()
		M.needle.emission = M.face.emission
		lamp_red.emission_energy_multiplier = 0.25 + 1.2 * k
	return {update = update, night = night}
