extends RefCounted
# The fighter pilot's cockpit, for flying a Bf 109, an Fw 190 or a P-47 in first person, built to the
# photographs of the real ones:
# - the fuselage round you as one shaped skin from the spinner to behind your head (painted outside in the
#   type's colours, the interior colour inside), its gun fairings shaped into the cowling (the 109G's
#   "Beulen", the Fw 190's MG 131 humps), the exhaust stubs, the wings with their airfoil and dihedral;
# - the canopy: the 109G's Erla Haube with its armoured head glass, the Fw 190's bubble, the P-47
#   razorback's framed sliding hood with the high spine behind your head, the windscreens with their
#   thick bulletproof glass, in box-section frames;
# - the instrument panel whose needles move with the real values (airspeed, altitude, climb, compass,
#   boost, rpm, oil and coolant), its bezels standing out of it, glowing at night; the coaming over it;
# - the gunsight (Revi 16B in the German fighters, the N-3B reflector sight in the P-47), whose reticle
#   pilot.gd puts on the guns' line;
# - the stick and throttle moving with your hands on them, your knees, the seat, the rudder pedals, the
#   side consoles (trim wheels, levers, switch panels, the Fw 190's breaker panel, the P-47's radio);
# - paint with wear and rivets (procedural textures); RLM 66 inside the German fighters, dull dark green
#   and a black panel in the P-47.
# The aircraft models have no cockpit, so this is built here and shown in their place, round the pilot's
# eye. Everything that doesn't move is merged: one draw call per material.
#
# (Godot: the rivets' bump map is a normal map made from the same height canvas; the cockpit casts and
# receives shadows, the glass excepted; the panel's night glow is its emission.)

const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Environment_ := preload("res://src/environment.gd") # (wet_glass)
const Self := preload("res://src/cockpit.gd") # (for the inner classes: they reach this script's static functions through it)
# (cockpit109.gd, cockpitfw190.gd and cockpitp47.gd are loaded in build_cockpit: cockpit109.gd preloads
# this file for its helpers, so a preload here would be a cycle)

#
# Each type, relative to the pilot's eye (x right, y up, -z ahead):
# - eye: the eye in the model; prop: m ahead of the eye.
# - body: the fuselage's stations [z, half width, top, widest at, bottom, sill?]; with a sill the top is
#   open there (the cockpit). n: how square its sections are.
# - bumps: fairings shaped into the skin [x, y, z, along, across, height].
# - top / side / belly: paint colours, metal: bare metal, glare: an anti-glare panel ahead of the windscreen.
# - hub: a propeller hub's radius instead of a spinner (the P-47's Curtiss), prop_r: the propeller's radius,
#   face: a radial's dark face in the cowling's open front.
# - wing [y, span, root chord, tip chord, leading edge at the root, sweep of the leading edge].
# - exhausts [x, y, z0, z1, n].
#
const TYPES := {
	bf109 = {
		eye = [0, 0.75, -0.8], prop = 3.3, n = 2.5, spinner = 0x1e2a1e, spiral = true,
		body = [[-3.3, 0.22, -0.44, -0.62, -0.84], [-3.05, 0.33, -0.31, -0.6, -0.98], [-2.6, 0.38, -0.25, -0.6, -1.08], [-1.9, 0.41, -0.21, -0.6, -1.15],
			[-1.1, 0.42, -0.19, -0.6, -1.18], [-0.62, 0.42, -0.165, -0.58, -1.2], [-0.5, 0.42, -0.16, -0.58, -1.2, -0.14], [0.6, 0.4, -0.1, -0.58, -1.15, -0.13],
			[0.72, 0.39, 0.06, -0.58, -1.12], [1.6, 0.32, -0.04, -0.55, -1.0], [2.6, 0.24, -0.12, -0.5, -0.88]],
		bumps = [[0.3, -0.27, -1.15, 0.36, 0.11, 0.075], [-0.3, -0.27, -1.15, 0.36, 0.11, 0.075]], # the "Beulen" over the MG 131s' breeches
		top = 0x50555a, side = 0x6f767c, belly = 0x9aa6b0, mottle = 0x5d6a52, metal = false,
		inside = 0x393c3f, panel = 0x2a2d2f, units = "metric", canopy = "erla", sight = "revi",
		wing = [-1.2, 4.9, 1.95, 1.05, -1.25, 0.25], exhausts = [0.41, -0.66, -2.8, -1.85, 6],
	},
	fw190 = {
		eye = [0, 0.86, -0.22], prop = 3.85, n = 2.05, spinner = 0x1e2a1e, spiral = true,
		body = [[-3.85, 0.6, -0.2, -0.78, -1.36], [-3.3, 0.64, -0.16, -0.78, -1.4], [-2.3, 0.63, -0.17, -0.78, -1.39], [-1.55, 0.56, -0.175, -0.74, -1.32],
			[-0.95, 0.49, -0.17, -0.7, -1.26], [-0.6, 0.46, -0.16, -0.68, -1.22], [-0.48, 0.46, -0.15, -0.68, -1.22, -0.14], [0.8, 0.43, -0.1, -0.66, -1.2, -0.12],
			[0.95, 0.42, 0.1, -0.66, -1.18], [1.8, 0.36, 0.0, -0.6, -1.05], [2.7, 0.27, -0.08, -0.55, -0.92]],
		bumps = [[0.12, -0.17, -1.3, 0.34, 0.085, 0.05], [-0.12, -0.17, -1.3, 0.34, 0.085, 0.05]], # the MG 131 humps on the upper cowl
		top = 0x4a4f55, side = 0x6a7178, belly = 0x9aa6b0, mottle = 0x58654e, metal = false,
		inside = 0x393c3f, panel = 0x262829, units = "metric", canopy = "fw", sight = "revi", fan = true,
		wing = [-1.3, 5.2, 2.25, 1.15, -1.45, 0.3], exhausts = [0.58, -1.0, -2.15, -1.7, 4],
	},
	# the P-47D razorback (p47.gd): a big, roomy cockpit high in the deep fuselage, the cowling's top well
	# below your eye but a long nose ahead of it; behind the hood the spine rises to the head armour, so
	# there's little to see straight behind (the mirror on the windscreen's bow helps)
	p47 = {
		eye = [0, 1.05, -0.2], prop = 4.27, n = 2.4, spinner = 0x2b2b26, hub = 0.28, prop_r = 1.98, face = true,
		body = [[-4.12, 0.64, -0.4, -1.12, -1.84], [-4.02, 0.7, -0.34, -1.12, -1.91], [-3.6, 0.73, -0.29, -1.11, -1.94], [-2.8, 0.72, -0.25, -1.09, -1.95],
			[-2.0, 0.69, -0.22, -1.07, -1.96], [-1.2, 0.65, -0.2, -1.05, -1.97], [-0.67, 0.62, -0.19, -1.05, -1.97], [-0.55, 0.61, -0.185, -1.05, -1.97, -0.2],
			[0.55, 0.55, -0.13, -1.03, -1.93, -0.2], [0.65, 0.54, 0.23, -1.0, -1.9], [1.2, 0.5, 0.16, -1.0, -1.84], [2.2, 0.42, 0.05, -0.95, -1.69], [3.2, 0.34, -0.08, -0.89, -1.51]],
		bumps = [],
		top = 0x4b4c33, side = 0x4b4c33, belly = 0x8a8d88, glare = 0x3a3b28, metal = false,
		inside = 0x3c4630, panel = 0x161616, units = "imperial", canopy = "razorback", sight = "n3b",
		wing = [-1.67, 6.0, 2.84, 1.0, -1.76, 0.9], exhausts = [0.62, -1.75, -2.75, -2.55, 2], # (the turbo's waste-gate outlets, low behind the cowl flaps)
	},
}
const PANEL_W := 1024
const PANEL_H := 420 # canvas pixels for the panel (0.7 m x 0.29 m)
const PW := 0.7
const PH := 0.287 # the panel, m

## The panel's dials for each type: [x, y, r, gauge] in canvas pixels.
const LAYOUT := {
	metric = [[150, 120, 92, "speed"], [355, 120, 92, "alt"], [560, 120, 92, "horizon"], [765, 120, 92, "climb"], [920, 210, 70, "compass"],
		[150, 320, 70, "boost"], [310, 320, 70, "rpm"], [470, 320, 62, "oil"], [620, 320, 62, "coolant"], [775, 330, 62, "fuel"]],
	imperial = [[150, 120, 92, "speed"], [355, 120, 92, "horizon"], [560, 120, 92, "alt"], [765, 120, 92, "climb"], [920, 210, 70, "compass"],
		[150, 320, 70, "boost"], [310, 320, 70, "rpm"], [470, 320, 62, "coolant"], [620, 320, 62, "oil"], [775, 330, 62, "fuel"]],
}

## The JS's Park–Miller generator, the same sequence: r.call() gives the next number in [0, 1).
## (seed * 16807 stays well inside int64, as it stays exact in the JS's doubles)
static func rng(seed: int) -> Callable:
	var st := [seed]
	return func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return (st[0] - 1) / 2147483646.0

## A number as the JS's canvas prints it (fillText of a number): 5, not 5.0.
static func _js_num(v) -> String:
	if v is String:
		return v
	if v == floorf(v):
		return str(int(v))
	return String.num(v)

## Three's `new Color(hex)`: the hex as sRGB, the components linear.
static func _lin(hex: int) -> Color:
	return Mat.color(hex).srgb_to_linear()

## A state value by its JS key, or its snake_case twin (pilot.gd passes stick_x / stick_y).
static func _sv(s: Dictionary, key: String, alt: String) -> float:
	return float(s.get(key, s.get(alt, 0.0)))


## Draws the panel's dials into a canvas, with the needles where the values say.
class PanelArt:
	var type: Dictionary
	var g # Canvas2D
	var tex: ImageTexture
	var bg # Canvas2D

	func _init(t: Dictionary) -> void:
		type = t
		g = Canvas2D.new(PANEL_W, PANEL_H)
		tex = g.texture(true) # (anisotropy: the material's texture filter)
		bg = background()

	## The panel itself, drawn once: worn paint, its screws and seams, switches, placards and labels.
	func background():
		var T := type
		var metric: bool = T.units == "metric"
		var c = Canvas2D.new(PANEL_W, PANEL_H)
		var r := Self.rng(7)
		var pc := Self._lin(T.panel)
		c.fill_style = "rgb(%d,%d,%d)" % [int(pc.r * 255), int(pc.g * 255), int(pc.b * 255)]
		c.fill_rect(0, 0, PANEL_W, PANEL_H)
		for i in 9000: # the paint's grain
			c.fill_style = "#ffffff06" if r.call() < 0.5 else "#00000010"
			c.fill_rect(r.call() * PANEL_W, r.call() * PANEL_H, 2 + r.call() * 3, 2 + r.call() * 3)
		c.stroke_style = "#ffffff1a"; c.line_width = 1.5 # worn edges and scuffs
		for i in 60:
			var x: float = r.call() * PANEL_W
			var y: float = r.call() * 18 if r.call() < 0.5 else PANEL_H - r.call() * 18
			c.begin_path(); c.move_to(x, y); c.line_to(x + 6 + r.call() * 30, y + (r.call() - 0.5) * 4); c.stroke()
		# the panel's seams (the shock-mounted centre section) and its screws
		c.stroke_style = "#00000080"; c.line_width = 2
		c.stroke_rect(40, 22, 840, 380)
		for x in range(52, 880, 72):
			for y in [32, 392]:
				screw(c, x, y, 4)
		for p in [[14, 14], [PANEL_W - 14, 14], [14, PANEL_H - 14], [PANEL_W - 14, PANEL_H - 14]]:
			screw(c, p[0], p[1], 6)
		# toggle switches and a magneto switch, right of the dials
		for k in 4:
			var x := 900 + (k % 2) * 46
			var y := 300 + floori(k / 2.0) * 52
			screw(c, x, y, 9, "#444")
			c.stroke_style = "#ccc"; c.line_width = 5; c.begin_path(); c.move_to(x, y); c.line_to(x + 3, y - 18); c.stroke()
		c.fill_style = "#111"; c.begin_path(); c.arc(860, 70, 26, 0, 7); c.fill(); c.fill_style = "#ddd"; c.fill_rect(856, 46, 8, 28) # the magneto switch
		c.fill_style = "#c9c2a8"; c.font = '600 13px "Courier New", monospace'; c.text_align = "center"
		c.fill_text("ZÜNDUNG" if metric else "IGNITION", 860, 112)
		# the placards, white on the paint
		var plate := func(x: float, y: float, w: float, text: String) -> void:
			c.fill_style = "#d8d2bc"; c.fill_rect(x, y, w, 20); c.fill_style = "#1a1a1a"; c.font = '700 12px "Courier New", monospace'; c.text_align = "center"; c.fill_text(text, x + w / 2, y + 14)
		plate.call(820, 392 - 22, 190, "NICHT RAUCHEN" if metric else "DO NOT EXCEED 505 MPH")
		if metric:
			plate.call(40, 4, 230, "C 3 KRAFTSTOFF 96 OKT")
		else:
			plate.call(40, 4, 210, "USE 100/130 GRADE FUEL")
		return c

	func screw(c, x: float, y: float, r: float, col := "#55585a") -> void:
		c.fill_style = "#0008"; c.begin_path(); c.arc(x + 1, y + 1, r, 0, 7); c.fill()
		c.fill_style = col; c.begin_path(); c.arc(x, y, r, 0, 7); c.fill()
		c.stroke_style = "#111"; c.line_width = maxf(1, r * 0.3); c.begin_path(); c.move_to(x - r * 0.7, y); c.line_to(x + r * 0.7, y); c.stroke()

	func draw(s: Dictionary) -> void:
		var T := type
		var metric: bool = T.units == "metric"
		g.width = PANEL_W # (a fresh canvas each time, as the browser's is drawn over by the background: the recorded calls don't pile up)
		g.draw_image(bg, 0, 0)
		for d in LAYOUT[T.units]:
			dial(d[0], d[1], d[2], d[3], s, metric)
		g.texture(true) # (needsUpdate: redrawn into the same texture)

	# the dial's scale: ticks, numbers and its label
	func _scale(r: float, mn: float, mx: float, a0: float, a1: float, major: float, minor: float, label: String, fmt := Callable()) -> void:
		var v := mn
		while v <= mx + 1e-6:
			var a := a0 + ((v - mn) / (mx - mn)) * (a1 - a0)
			var big := absf((v - mn) / major - roundf((v - mn) / major)) < 1e-6
			g.line_width = 3 if big else 1.5
			g.begin_path(); g.move_to(cos(a) * r * (0.76 if big else 0.84), sin(a) * r * (0.76 if big else 0.84)); g.line_to(cos(a) * r * 0.94, sin(a) * r * 0.94); g.stroke()
			if big:
				g.font = "600 %dpx system-ui" % roundi(r * 0.19); g.text_align = "center"; g.text_baseline = "middle"
				g.fill_text(Self._js_num(fmt.call(v) if fmt.is_valid() else v), cos(a) * r * 0.58, sin(a) * r * 0.58)
			v += minor
		g.font = "600 %dpx system-ui" % roundi(r * 0.14); g.text_align = "center"; g.fill_text(label, 0, r * 0.42)

	func _needle(r: float, a: float, len := 0.82, w := 4.0) -> void:
		g.save(); g.rotate(a); g.fill_style = "#f0ead6"
		g.begin_path(); g.move_to(-r * 0.12, -w / 2); g.line_to(r * len, -1); g.line_to(r * len, 1); g.line_to(-r * 0.12, w / 2); g.fill()
		g.restore(); g.fill_style = "#222"; g.begin_path(); g.arc(0, 0, r * 0.08, 0, 7); g.fill(); g.fill_style = "#e8e2cc"

	## One gauge: its mounting flange and screws, a black face, a white scale with its numbers, the needle, the glass's glint.
	func dial(cx: float, cy: float, r: float, kind: String, s: Dictionary, metric: bool) -> void:
		g.save(); g.translate(cx, cy)
		for ab in [[-1, -1], [1, -1], [-1, 1], [1, 1]]:
			screw(g, ab[0] * (r + 4) * 0.84, ab[1] * (r + 4) * 0.84, maxf(3, r * 0.055), "#3c3f41")
		var bez = g.create_linear_gradient(0, -r - 8, 0, r + 8); bez.add_color_stop(0, "#5a5d60"); bez.add_color_stop(0.5, "#262829"); bez.add_color_stop(1, "#151617")
		g.fill_style = bez; g.begin_path(); g.arc(0, 0, r + 8, 0, 7); g.fill() # the bezel
		g.fill_style = "#0b0b0b"; g.begin_path(); g.arc(0, 0, r, 0, 7); g.fill()
		g.stroke_style = "#e8e2cc"; g.fill_style = "#e8e2cc"; g.line_cap = "round"
		const A0 := PI * 0.75
		const A1 := PI * 2.25 # a 270 degree dial from bottom left
		var at := func(v: float, mn: float, mx: float) -> float: return A0 + (clampf(v, mn, mx) - mn) / (mx - mn) * (A1 - A0)
		match kind:
			"speed":
				var v: float = s.speed * 3.6 if metric else s.speed * 2.237
				var mx := 750.0 if metric else 500.0
				_scale(r, 0, mx, A0, A1, 100 if metric else 50, 25 if metric else 10, "km/h" if metric else "MPH")
				_needle(r, at.call(v, 0, mx))
			"alt": # two needles: thousands and hundreds
				var v: float = s.alt / 1000.0 if metric else s.alt * 3.281 / 1000.0 # km or thousands of feet
				_scale(r, 0, 10, -PI / 2, PI * 1.5 - 0.0001, 1, 0.5, "km" if metric else "ALT x1000", func(x: float): return x if x < 10 else "")
				_needle(r, -PI / 2 + fmod(v, 10) / 10 * PI * 2, 0.55, 6)
				_needle(r, -PI / 2 + fmod(v * 10, 10) / 10 * PI * 2, 0.86, 3)
			"climb":
				var v: float = s.climb
				var mx := 30.0 if metric else 6.0 # m/s, or thousands of ft/min
				_scale(r, -mx, mx, PI * 0.9, PI * 2.1, 10 if metric else 2, 5 if metric else 1, "m/s" if metric else "CLIMB", func(x: float): return absf(x))
				_needle(r, PI * 1.5 + clampf(v if metric else v * 196.85 / 1000, -mx, mx) / mx * PI * 0.6)
			"boost":
				var v: float = 0.6 + s.throttle * 0.82 if metric else 15 + s.throttle * 46 # ata, or inches of mercury
				var mn := 0.6 if metric else 10.0
				var mx := 1.8 if metric else 75.0
				_scale(r, mn, mx, A0, A1, 0.2 if metric else 10, 0.1 if metric else 5, "ata" if metric else "MAN. PRESS", func(x: float): return ("%.1f" % x) if metric else x)
				_needle(r, at.call(v, mn, mx))
			"rpm":
				var v: float = 1400 + s.throttle * 1400 + (s.speed - 120) * 2
				_scale(r, 0, 36, A0, A1, 4, 2, "U/min x100".replace("U/min", "U/min" if metric else "RPM"))
				_needle(r, at.call(v / 100, 0, 36))
			"oil", "coolant":
				var hot: float = 50 + s.heat * 25 + s.throttle * 25 if kind == "oil" else 70 + s.heat * 15 + s.throttle * 30 + (25 if s.damage else 0)
				_scale(r, 0, 130, A0, A1, 20, 10, ("Öl °C" if metric else "OIL °C") if kind == "oil" else ("Kühl °C" if metric else "COOLANT"))
				_needle(r, at.call(hot, 0, 130))
			"fuel":
				_scale(r, 0, 400, A0, A1, 100, 50, "Liter" if metric else "GAL x2")
				_needle(r, at.call(400 - s.time * 0.4, 0, 400))
			"compass":
				g.save(); g.rotate(-s.heading) # the card turns
				for k in 36:
					var a := (k / 36.0) * PI * 2 - PI / 2
					g.line_width = 1.5 if k % 3 else 3.0
					g.begin_path(); g.move_to(cos(a) * r * 0.78, sin(a) * r * 0.78); g.line_to(cos(a) * r * 0.94, sin(a) * r * 0.94); g.stroke()
					if k % 9 == 0:
						g.font = "700 %dpx system-ui" % roundi(r * 0.24); g.text_align = "center"; g.text_baseline = "middle"
						g.fill_text("NOSW"[k / 9], cos(a) * r * 0.56, sin(a) * r * 0.56)
				g.restore()
				g.stroke_style = "#ff9a3a"; g.line_width = 3; g.begin_path(); g.move_to(0, -r); g.line_to(0, -r * 0.7); g.stroke()
			"horizon": # the artificial horizon: sky over earth, rolled and pitched
				g.save(); g.begin_path(); g.arc(0, 0, r * 0.94, 0, 7); g.clip()
				g.rotate(-s.bank)
				var p := clampf(s.pitch, -0.6, 0.6) * r * 1.4
				g.fill_style = "#3d5f86"; g.fill_rect(-r, -r * 2 + p, r * 2, r * 2)
				g.fill_style = "#4a3b2a"; g.fill_rect(-r, p, r * 2, r * 2)
				g.stroke_style = "#eee"; g.line_width = 2; g.begin_path(); g.move_to(-r, p); g.line_to(r, p); g.stroke()
				for k in [-2, -1, 1, 2]:
					g.begin_path(); g.move_to(-r * 0.2, p - k * r * 0.25); g.line_to(r * 0.2, p - k * r * 0.25); g.stroke()
				g.restore()
				g.stroke_style = "#ffb040"; g.line_width = 4 # the little aeroplane
				g.begin_path(); g.move_to(-r * 0.5, 0); g.line_to(-r * 0.15, 0); g.line_to(0, r * 0.1); g.line_to(r * 0.15, 0); g.line_to(r * 0.5, 0); g.stroke()
			_:
				pass
		# the glass over it: a soft glint across the top
		var gl = g.create_linear_gradient(-r, -r, r * 0.3, r * 0.2); gl.add_color_stop(0, "#ffffff22"); gl.add_color_stop(0.45, "#ffffff08"); gl.add_color_stop(0.5, "#ffffff00")
		g.fill_style = gl; g.begin_path(); g.arc(0, 0, r, 0, 7); g.fill()
		g.restore()


# ---------- the procedural textures: worn paint (colour and roughness) and the skin's rivets and panel lines

static var WEAR: ImageTexture = null
static var RIVETS: ImageTexture = null # (the height, as drawn)
static var RIVETS_N: ImageTexture = null # (Godot has no bump map: the same height as a normal map)
static var _rivets_canvas = null
static var _wear_canvas = null # (the canvases kept: a canvas draws over the next frames, and only while it's held)

## Paint wear: grime and lighter chips (a multiplier for the colour; also the roughness). Made once.
static func wear_tex() -> ImageTexture:
	if WEAR:
		return WEAR
	var g = Canvas2D.new(512, 512)
	var r := rng(11)
	g.fill_style = "#d9d9d9"; g.fill_rect(0, 0, 512, 512)
	for i in 260: # grime
		var x: float = r.call() * 512
		var y: float = r.call() * 512
		var rr: float = 10 + r.call() * 60
		var gr = g.create_radial_gradient(x, y, 0, x, y, rr)
		gr.add_color_stop(0, "rgba(0,0,0,%s)" % String.num(0.05 + r.call() * 0.08)); gr.add_color_stop(1, "rgba(0,0,0,0)")
		g.fill_style = gr; g.fill_rect(x - rr, y - rr, rr * 2, rr * 2)
	for i in 14000: # grain
		var v := int(200 + r.call() * 55)
		g.fill_style = "rgba(%d,%d,%d,0.25)" % [v, v, v]; g.fill_rect(r.call() * 512, r.call() * 512, 1.5, 1.5)
	g.stroke_style = "rgba(255,255,255,0.55)"; g.line_cap = "round" # chips and scratches down to the primer
	for i in 180:
		var x: float = r.call() * 512
		var y: float = r.call() * 512
		g.line_width = 0.6 + r.call() * 1.6; g.begin_path(); g.move_to(x, y); g.line_to(x + (r.call() - 0.5) * 26, y + (r.call() - 0.5) * 8); g.stroke()
	_wear_canvas = g
	WEAR = g.texture(true) # (repeat and anisotropy: the materials' settings)
	return WEAR

## The skin's rivet rows and panel lines (a bump map): 0.5 m square tiles.
static func rivet_tex() -> ImageTexture:
	if RIVETS:
		return RIVETS
	var g = Canvas2D.new(256, 256)
	g.fill_style = "#808080"; g.fill_rect(0, 0, 256, 256)
	g.fill_style = "#5a5a5a"; g.fill_rect(0, 0, 256, 2); g.fill_rect(0, 0, 2, 256) # the panel joints
	g.fill_style = "#a8a8a8"
	for k in range(6, 256, 9): # rows of rivets
		g.begin_path(); g.arc(k, 7, 1.6, 0, 7); g.fill(); g.begin_path(); g.arc(7, k, 1.6, 0, 7); g.fill(); g.begin_path(); g.arc(k, 128, 1.4, 0, 7); g.fill()
	_rivets_canvas = g
	RIVETS = g.texture(true)
	return RIVETS

## The rivets as a normal map (Three's bumpMap): flat until the canvas has drawn, then filled in.
static func rivet_normal() -> ImageTexture:
	if RIVETS_N:
		return RIVETS_N
	rivet_tex()
	var flat := Image.create(256, 256, true, Image.FORMAT_RGBA8)
	flat.fill(Color(0.5, 0.5, 1.0))
	flat.generate_mipmaps()
	RIVETS_N = ImageTexture.create_from_image(flat)
	_fill_normal(_rivets_canvas, RIVETS_N, 2.0)
	return RIVETS_N

static func _fill_normal(c, tex: ImageTexture, strength: float) -> void:
	var img: Image = await c.image()
	if img == null:
		return
	var n := img.duplicate()
	n.bump_map_to_normal_map(strength)
	n.convert(Image.FORMAT_RGBA8)
	n.generate_mipmaps()
	tex.set_image(n)

# ---------- geometry helpers

## Bring a geometry to the shared layout (non-indexed, position, normal, uv, and colour if wanted) so it can be merged.
static func tidy(geo, colour: bool):
	var g = geo.to_non_indexed() if not geo.indices.is_empty() else geo
	for s in 4: # (only position, normal, uv and colour stay)
		if g.custom_size[s] != 0:
			g.delete_attribute(str(s))
	if g.normals.is_empty():
		g.compute_vertex_normals()
	if g.uvs.is_empty():
		var uv := PackedVector2Array()
		uv.resize(g.positions.size())
		g.uvs = uv
	if colour and g.colors.is_empty():
		var c := PackedColorArray()
		c.resize(g.positions.size())
		c.fill(Color(1, 1, 1))
		g.colors = c
	if not colour and not g.colors.is_empty():
		g.delete_attribute("color")
	return g

## A box-section bar from a to b (w across, d deep), its depth turned towards `out`.
static func bar_geo(a: Vector3, b: Vector3, w: float, d: float, out := Vector3(0, 1, 0)):
	var dir := b - a
	var len := dir.length()
	var geo = Geo.box(w, d, len + w * 0.5)
	var z := dir.normalized()
	var x := out.cross(z).normalized()
	if x.length_squared() < 1e-6:
		x = Vector3(1, 0, 0)
	var y := z.cross(x)
	geo.apply_transform(Transform3D(Basis(x, y, z), (a + b) * 0.5))
	return geo

## A flat pane through four corners (two triangles), its uv across it.
static func quad_geo(a: Vector3, b: Vector3, c: Vector3, d: Vector3):
	var g = Geo.from_arrays(PackedVector3Array([a, b, c, a, c, d]), null, PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 0), Vector2(1, 1), Vector2(0, 1)]))
	g.compute_vertex_normals()
	return g

##
## The fuselage: superelliptic sections through the stations, open over the cockpit where a station has a
## sill, with fairings pushed out of it. uv: metres (so the textures tile at their real size); colours:
## the paint (top / side / belly, the anti-glare panel).
## (the colours are mixed in linear as Three does, then stored as sRGB: the material reads them as sRGB)
##
static func fuselage_geo(T: Dictionary):
	var N := 48
	var n: float = T.n
	var pos := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	var top := _lin(T.top)
	var side := _lin(T.side)
	var belly := _lin(T.belly)
	var glare = _lin(T.glare) if T.has("glare") else null
	var mottle = _lin(T.mottle) if T.has("mottle") else null
	var pe := func(v: float, e: float) -> float: return signf(v) * pow(absf(v), e)
	var at := func(st: Array, th: float) -> Array: # the section's point at angle th (0 = top, clockwise seen from behind)
		var w: float = st[1]
		var yt: float = st[2]
		var ym: float = st[3]
		var yb: float = st[4]
		var s := sin(th)
		var c := cos(th)
		return [w * pe.call(s, 2 / n), ym + (yt - ym) * pow(absf(c), 2 / n) if c >= 0 else ym - (ym - yb) * pow(absf(c), 2 / n)]
	var r := rng(3)
	# over the cockpit the sections are drawn whole (topped like the decking behind it), and the skin above
	# the sill is left out there: the cockpit's opening
	var body: Array = T.body
	var last := -1
	for i in body.size():
		if body[i].size() > 5:
			last = i
	var rear_top: float = body[last + 1][2]
	var sill_y: float = body[last][5]
	var opens := []
	for st in body:
		opens.append(st.size() > 5)
	for i in body.size():
		var st0: Array = body[i]
		var st: Array = [st0[0], st0[1], rear_top, st0[3], st0[4]] if opens[i] else st0
		var z: float = st[0]
		var yt: float = st[2]
		var ym: float = st[3]
		var along := 0.0
		var prev = null
		for k in N + 1:
			var th := (float(k) / N) * PI * 2
			var xy: Array = at.call(st, th)
			var x: float = xy[0]
			var y: float = xy[1]
			for bp in T.bumps: # the fairings, out along the section's normal
				var bx: float = bp[0]; var by: float = bp[1]; var bz: float = bp[2]; var bl: float = bp[3]; var bw: float = bp[4]; var bh: float = bp[5]
				var f := bh * exp(-pow((z - bz) / bl, 2) - (pow(x - bx, 2) + pow(y - by, 2)) / (bw * bw))
				if f > 1e-4:
					var nx := x
					var ny := y - ym
					var l := sqrt(nx * nx + ny * ny)
					if l == 0:
						l = 1
					x += (nx / l) * f; y += (ny / l) * f
			if opens[i]:
				y = minf(y, sill_y) # (the open sections end at the sill)
			if prev != null:
				along += sqrt(pow(x - prev[0], 2) + pow(y - prev[1], 2))
			prev = [x, y]
			pos.append(x); pos.append(y); pos.append(z)
			uv.append(along / 0.5); uv.append(z / 0.5)
			var h := (y - ym) / maxf(0.01, yt - ym) # the paint: top colour above, belly below, blended on the sides
			var c: Color = top.lerp(side, clampf((0.8 - h) / 0.45, 0, 1)) if h > 0.35 else side.lerp(belly, clampf((0.1 - h) / 0.4, 0, 1))
			if mottle != null and h > -0.1 and h < 0.6 and r.call() < 0.35:
				c = c.lerp(mottle, 0.35) # the 109's and 190's mottling down the sides
			if glare != null and absf(x) < 0.2 and h > 0.85 and z < -0.55:
				c = glare # the olive drab anti-glare panel ahead of the windscreen
			col.append(c.linear_to_srgb())
		if i:
			for k in N:
				var a := (i - 1) * (N + 1) + k
				var b := a + N + 1
				# (the opening: up to the last open station, the skin above the sill isn't there)
				if opens[i] and opens[i - 1] and minf(minf(pos[a * 3 + 1], pos[(a + 1) * 3 + 1]), minf(pos[b * 3 + 1], pos[(b + 1) * 3 + 1])) > sill_y - 1e-4:
					continue
				idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	var g = Geo.from_arrays(pos, null, uv, idx, col)
	g.compute_vertex_normals()
	return g

## A tapered wing with a real airfoil (12 % thick at the root, 9 % at the tip) and 6 degrees of dihedral, out to one side.
static func wing_geo(T: Dictionary, s: float):
	var wy: float = T.wing[0]
	var span: float = T.wing[1]
	var root: float = T.wing[2]
	var tip: float = T.wing[3]
	var le: float = T.wing[4]
	var sweep: float = T.wing[5]
	var M := 24
	var pos := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	var top_c := Mat.color(T.top) # (sRGB: as stored, the material reads them as sRGB)
	var bot_c := Mat.color(T.belly)
	var foil := func(x: float, t: float) -> float: return 5 * t * (0.2969 * sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * pow(x, 3) - 0.1015 * pow(x, 4))
	var sections := [[0.36, root, le, 0.12], [span, tip, le + sweep, 0.09]]
	for j in sections.size():
		var x: float = sections[j][0]
		var chord: float = sections[j][1]
		var z0: float = sections[j][2]
		var t: float = sections[j][3]
		var y0 := wy + (x - 0.36) * tan(deg_to_rad(6))
		for k in M + 1: # round the airfoil: along the top from the trailing edge, back along the bottom
			var u := float(k) / M
			var a := 1 - u * 2 if u < 0.5 else (u - 0.5) * 2
			var xc := (1 - cos(a * PI)) / 2
			var up := 1.0 if u < 0.5 else -1.0
			pos.append(s * x); pos.append(y0 + up * foil.call(xc, t) * chord); pos.append(z0 + xc * chord)
			uv.append(z0 / 0.5 + xc * chord / 0.5); uv.append(x / 0.5)
			col.append(top_c if up > 0 else bot_c)
		if j:
			for k in M:
				var a := k
				var b := M + 1 + k
				if s > 0:
					idx.append_array([a, b, a + 1, a + 1, b, b + 1])
				else:
					idx.append_array([a, a + 1, b, a + 1, b + 1, b])
	var g = Geo.from_arrays(pos, null, uv, idx, col)
	g.compute_vertex_normals()
	return g

## A bubble canopy's glass: from the sill on one side over to the other, its height along it given by top(z).
static func bubble_geo(z0: float, z1: float, w: Callable, sill: float, top: Callable, M := 18, K := 16):
	var pos := PackedFloat64Array()
	var idx := PackedInt32Array()
	for j in K + 1:
		var z := z0 + (float(j) / K) * (z1 - z0)
		var h: float = top.call(z)
		var ww: float = w.call(z)
		for k in M + 1:
			var a := -PI / 2 + (float(k) / M) * PI
			pos.append(ww * sin(a)); pos.append(sill + (h - sill) * pow(cos(a), 0.8)); pos.append(z)
		if j:
			for k in M:
				var a := (j - 1) * (M + 1) + k
				var b := a + M + 1
				idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	var g = Geo.from_arrays(pos, null, null, idx)
	g.compute_vertex_normals()
	return g

## A gloved hand, closed round a grip: a palm, a thumb and the curl of the fingers.
static func hand(mat: Material) -> MeshInstance3D:
	var list := []
	for x in [
		Geo.box(0.085, 0.045, 0.1),
		Geo.capsule(0.022, 0.07, 3, 8).rotate_z(PI / 2).translate(0, 0.02, -0.055),
		Geo.capsule(0.014, 0.04, 3, 6).rotate_x(0.8).translate(-0.05, 0.02, -0.02),
		Geo.capsule(0.035, 0.12, 3, 8).rotate_x(PI / 2).translate(0, -0.005, 0.12), # the cuff and sleeve
	]:
		var y = x.to_non_indexed() if not x.indices.is_empty() else x
		y.delete_attribute("uv")
		list.append(y)
	var m := MeshInstance3D.new()
	m.mesh = Geo.merge(list).to_mesh(mat)
	return m

# (a material as Three saw it, through wet_glass's ShaderMaterial wrapper)
static func _base(mat: Material) -> Material:
	return mat.get_meta("hook_base") if mat.has_meta("hook_base") else mat

static func _transparent(mat: Material) -> bool:
	var b := _base(mat)
	return b is BaseMaterial3D and (b as BaseMaterial3D).transparency == BaseMaterial3D.TRANSPARENCY_ALPHA

static func _aniso(m: BaseMaterial3D, n := BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC) -> BaseMaterial3D:
	m.texture_filter = n
	return m


## The static parts, by material, merged at the end (put / putM / bar / slab).
class Parts:
	var parts := {} # material -> Array of geos (insertion order kept)
	var armour: Material
	var armour_edge: Material

	func list(mat: Material) -> Array:
		if not parts.has(mat):
			parts[mat] = []
		return parts[mat]

	func put(mat: Material, geo, x := 0.0, y := 0.0, z := 0.0, rx := 0.0, ry := 0.0, rz := 0.0, sx := 1.0, sy := 1.0, sz := 1.0):
		var t := Transform3D(Basis.from_euler(Vector3(rx, ry, rz), EULER_ORDER_XYZ) * Basis.from_scale(Vector3(sx, sy, sz)), Vector3(x, y, z))
		var gg = geo.clone().apply_transform(t)
		list(mat).append(gg)
		return gg

	func put_m(mat: Material, geo, m: Transform3D) -> void:
		list(mat).append(geo.clone().apply_transform(m))

	func bar(mat: Material, a: Vector3, b: Vector3, w := 0.03, d := 0.04, out := Vector3(0, 1, 0)) -> void:
		put_m(mat, Self.bar_geo(a, b, w, d, out), Transform3D())

	## a slab of bulletproof glass w x h x d, placed by m: its two faces, and its four edges (the green of it)
	func slab(w: float, h: float, d: float, m: Transform3D) -> void:
		for s in [-1, 1]:
			put_m(armour, Geo.plane(w, h).translate(0, 0, s * d / 2), m)
		for s in [-1, 1]:
			put_m(armour_edge, Geo.box(w, 0.005, d).translate(0, s * (h / 2 - 0.0025), 0), m)
			put_m(armour_edge, Geo.box(0.005, h, d).translate(s * (w / 2 - 0.0025), 0, 0), m)


## The cockpit for one type; call its meta "update" (Callable(state, dt)) every frame (it manages its own
## refresh rate for the panel) and "night" (Callable(k)).
static func build_cockpit(kind: String) -> Node3D:
	if kind == "fw190":
		return load("res://src/cockpitfw190.gd").build_fw190_cockpit() # (its own file: cockpitfw190.gd)
	if kind == "p47":
		return load("res://src/cockpitp47.gd").build_cockpit_p47() # (its own file: cockpitp47.gd)
	var T: Dictionary = TYPES[kind]
	var root := Node3D.new() # placed on the fighter each frame (pilot.gd)
	root.name = "Cockpit_" + kind
	var g := Node3D.new() # everything below is relative to the eye
	g.position = Vector3(T.eye[0], T.eye[1], T.eye[2])
	root.add_child(g)
	var wear := wear_tex()
	var rivets := rivet_normal()
	var skin := _aniso(Mat.standard({vertexColors = true, map = wear, normalMap = rivets, normalScale = 0.6, roughness = 0.38 if T.metal else 0.62, metalness = 0.75 if T.metal else 0.15, side = Mat.FRONT}))
	var inside := _aniso(Mat.standard({color = T.inside, map = wear, roughnessMap = wear, normalMap = rivets, normalScale = 0.35, roughness = 0.85, metalness = 0.2, side = Mat.BACK}))
	var paint := _aniso(Mat.standard({color = T.inside, map = wear, roughness = 0.8, metalness = 0.2})) # the interior's fittings
	var black := _aniso(Mat.standard({color = 0x151515, map = wear, roughness = 0.65, metalness = 0.3}))
	var steel := Mat.standard({color = 0x6a6d70, roughness = 0.4, metalness = 0.85})
	var leather := Mat.standard({color = 0x3a2a1e, roughness = 0.85})
	var suit := Mat.standard({color = 0x5a5040 if kind == "p47" else 0x3e3a30, roughness = 0.95})
	var exhaust := Mat.standard({color = 0x3a2a22, roughness = 0.9, metalness = 0.4})
	var red := Mat.standard({color = 0x8a1c14, roughness = 0.5})
	var white := Mat.standard({color = 0xd8d4c4, roughness = 0.6})
	var frame_out := _aniso(Mat.standard({color = 0x9da2a6 if T.metal else T.top, map = wear, roughness = 0.35 if T.metal else 0.6, metalness = 0.75 if T.metal else 0.25}))
	var glass: Material = Environment_.wet_glass(Mat.physical({color = 0xcfe0e6, transparent = true, opacity = 0.06, roughness = 0.03, depthWrite = false, side = Mat.DOUBLE}))
	# thick bulletproof glass: through its faces nearly clear (a faint sheen), green only along its edges,
	# where you look through the whole slab of it edge-on
	var armour: Material = Environment_.wet_glass(Mat.physical({color = 0xe4efe8, transparent = true, opacity = 0.045, roughness = 0.02, depthWrite = false, side = Mat.DOUBLE}))
	var armour_edge: Material = Mat.physical({color = 0x4d6b5c, transparent = true, opacity = 0.2, roughness = 0.05, depthWrite = false})

	# the static parts, by material, merged at the end
	var P := Parts.new()
	P.armour = armour
	P.armour_edge = armour_edge
	var I := Transform3D()
	var box := func(w: float, h: float, d: float): return Geo.box(w, h, d)
	var cyl := func(r0: float, r1: float, h: float, s: int): return Geo.cylinder(r0, r1, h, s) # (Three's default: 12 segments, passed as 12)
	var width_at := func(z: float) -> float:
		var b: Array = T.body
		for i in range(1, b.size()):
			if z <= b[i][0]:
				var k: float = (z - b[i - 1][0]) / (b[i][0] - b[i - 1][0])
				return b[i - 1][1] + (b[i][1] - b[i - 1][1]) * k
		return b[b.size() - 1][1]
	var open: Array = T.body.filter(func(s): return s.size() > 5)
	var sill: float = open[0][5]
	var z0: float = open[0][0]
	var z1: float = open[open.size() - 1][0]

	# ---- outside: the fuselage skin (painted outside, the interior colour inside), spinner, propeller blur, exhausts, wings
	var body = fuselage_geo(T)
	P.put_m(skin, body, I)
	if kind != "bf109":
		P.put_m(inside, tidy(body.clone(), false), I) # (the 109's: cockpit109.gd, shaded)
	var front: Array = T.body[0]
	var cy: float = front[3]
	var prop: float = -T.prop
	var spinner := Mat.standard({color = T.spinner, roughness = 0.45, metalness = 0.3, map = spiral_tex() if T.get("spiral", false) else null})
	P.put(spinner, Geo.sphere(T.get("hub", front[1] * 0.95), 24, 12, 0, PI * 2, 0, PI / 2).rotate_x(-PI / 2).scale(1, 1, 1.2 if T.has("hub") else 2.1), 0, cy, prop + 0.05)
	if T.get("face", false):
		P.put(black, Geo.circle(front[1] * 0.98, 32), 0, cy, front[0] + 0.03) # the P-47's open cowling: the engine's dark face behind the lip
	if T.get("fan", false): # the Fw 190's cooling fan behind the spinner, in the cowl's open front
		P.put(black, Geo.circle(front[1] * 0.98, 32), 0, cy, front[0] + 0.12)
		for k in 12:
			P.put(steel, box.call(0.05, front[1] * 0.85, 0.01), 0, cy, front[0] + 0.1, 0, 0.5, (k / 12.0) * PI * 2)
	var blur := Mat.basic({color = 0x202020, transparent = true, opacity = 0.08, depthWrite = false, side = Mat.DOUBLE})
	var disc := MeshInstance3D.new()
	disc.mesh = Geo.ring(T.get("hub", front[1] * 0.6), T.get("prop_r", 1.6), 48).to_mesh(blur)
	disc.position = Vector3(0, cy, prop - 0.05); g.add_child(disc)
	if true: # the exhaust stubs down both sides of the cowl
		var ex: float = T.exhausts[0]
		var ey: float = T.exhausts[1]
		var ea: float = T.exhausts[2]
		var eb: float = T.exhausts[3]
		var en: int = T.exhausts[4]
		for s in [-1, 1]:
			for k in en:
				var z := ea + (float(k) / maxi(1, en - 1)) * (eb - ea)
				P.put(exhaust, box.call(0.07, 0.05, 0.085), s * ex, ey, z, 0.25, 0, s * -0.35)
				P.put(black, box.call(0.05, 0.03, 0.03), s * (ex + 0.035), ey - 0.01, z + 0.03, 0.25, 0, s * -0.35) # (its sooty mouth)
	for s in [-1, 1]:
		P.put_m(skin, wing_geo(T, s), I)

	# the Bf 109 G-6's cockpit is its own (cockpit109.gd); what follows to the merge is the Fw 190's and the P-47's
	var live: Dictionary # what moves each frame (needles, stick, throttle) and the night glow: {update(s, dt), night(k)}
	if kind == "bf109":
		live = load("res://src/cockpit109.gd").build_109({g = g, T = T, body = body, width_at = width_at, sill = sill, wear = wear,
			rivets = rivets, rivets_height = rivet_tex(), glass = glass, armour = armour, armour_edge = armour_edge})
	else:
		# ---- the tub: ribs and stringers on the walls, the floor, the canopy rails on the sills, the seat and the
		# armour behind it, the rudder pedals
		var wall := func(z: float) -> float: return width_at.call(z) - 0.03
		for z in [z0 + 0.12, -0.15, 0.2, z1 - 0.1]:
			for s in [-1, 1]:
				P.put(paint, box.call(0.025, 0.75, 0.035), s * (wall.call(z) - 0.01), sill - 0.42, z)
		for y in [sill - 0.25, sill - 0.6]:
			for s in [-1, 1]:
				P.put(paint, box.call(0.02, 0.025, z1 - z0), s * (wall.call(0) - 0.012), y, (z0 + z1) / 2)
		P.put(paint, box.call(0.66, 0.03, 1.5), 0, -1.08, -0.2)
		for s in [-1, 1]: # the canopy rails, box section along the sills
			P.put(frame_out, box.call(0.05, 0.032, z1 - z0 + 0.05), s * (width_at.call(0) - 0.02), sill + 0.012, (z0 + z1) / 2)
			P.put(black, box.call(0.012, 0.012, z1 - z0), s * (width_at.call(0) - 0.05), sill + 0.02, (z0 + z1) / 2) # (the rail's track)
		# the seat: a pressed bucket, the cushion of the parachute pack in it, and the armour plate behind
		var seat_z := 0.4 if kind == "p47" else 0.32 # (the P-47's cockpit was famously roomy)
		P.put(paint, Geo.cylinder(0.24, 0.22, 0.5, 18, 1, true, -PI * 0.55, PI * 1.1).rotate_y(PI), 0, -0.72, seat_z, 0, 0, 0, 1, 1, 0.55)
		P.put(paint, box.call(0.44, 0.03, 0.4), 0, -0.98, seat_z - 0.15)
		P.put(leather, box.call(0.38, 0.09, 0.34), 0, -0.92, seat_z - 0.14)
		P.put(steel, box.call(0.46, 0.62, 0.012), 0, -0.6, seat_z + 0.15, 0.08)
		for s in [-1, 1]: # the rudder pedals, their straps
			P.put(black, box.call(0.1, 0.16, 0.025), s * 0.15, -1.0, -0.88, 0.35)
			P.put(leather, box.call(0.105, 0.025, 0.035), s * 0.15, -0.98, -0.87, 0.35)
			P.put(paint, cyl.call(0.012, 0.012, 0.3, 8), s * 0.15, -1.03, -0.72, PI / 2 - 0.2)

		# ---- the side consoles
		for s in [-1, 1]:
			P.put(paint, box.call(0.12, 0.05, 0.75), s * (wall.call(-0.1) - 0.07), sill - 0.36, -0.15)
		var wheel := func(x: float, y: float, z: float, r: float, mat: Material) -> void: # a trim wheel turned edge-on to you, with spokes and a white index
			P.put(mat, Geo.torus(r, r * 0.12, 8, 28), x, y, z, 0, PI / 2, 0)
			for k in 4:
				P.put(mat, Geo.box(0.006, r * 2, r * 0.12), x, y, z, (k / 4.0) * PI, 0, 0)
			P.put(white, Geo.box(0.004, r * 0.25, r * 0.12), x + 0.006, y + r * 0.88, z)
		var switches := func(x: float, y: float, z: float, cols: int, rows: int, mat: Material) -> void:
			for i in cols:
				for j in rows:
					P.put(black, Geo.cylinder(0.009, 0.009, 0.012, 8), x + i * 0.028, y, z + j * 0.035)
					P.put(mat, Geo.cylinder(0.003, 0.004, 0.035, 6), x + i * 0.028, y + 0.017, z + j * 0.035, -0.3)
		var L: float = -(wall.call(-0.1) - 0.07)
		var R := -L
		var top := sill - 0.33
		if kind == "bf109":
			# the 109's two big trim wheels on the left wall (tailplane trim and the flaps), side by side
			wheel.call(L - 0.04, top - 0.12, 0.05, 0.13, black); wheel.call(L - 0.01, top - 0.12, 0.2, 0.11, black)
			P.put(paint, box.call(0.08, 0.1, 0.24), L, top - 0.02, -0.3) # the throttle quadrant
			P.put(steel, cyl.call(0.025, 0.025, 0.02, 14), L + 0.02, top + 0.03, -0.42, 0, 0, PI / 2) # the fuel cock
			P.put(paint, box.call(0.1, 0.11, 0.18), R, top, -0.32) # the electrics: switches and breakers
			switches.call(R - 0.04, top + 0.06, -0.39, 3, 3, steel)
			P.put(black, cyl.call(0.045, 0.045, 0.06, 18), R - 0.02, top + 0.03, 0.02); P.put(white, cyl.call(0.035, 0.035, 0.002, 18), R - 0.02, top + 0.061, 0.02) # the oxygen regulator
		elif kind == "fw190":
			P.put(paint, box.call(0.1, 0.09, 0.26), L, top - 0.02, -0.3)
			P.put(steel, box.call(0.02, 0.03, 0.08), L + 0.03, top + 0.04, -0.4) # the trim switch
			# the Fw 190's breaker panel on the right console: rows of white-capped buttons
			P.put(black, box.call(0.12, 0.04, 0.3), R, top + 0.01, -0.2)
			for i in 3:
				for j in 7:
					P.put(white, cyl.call(0.008, 0.008, 0.012, 8), R - 0.035 + i * 0.035, top + 0.036, -0.33 + j * 0.038)
			switches.call(R - 0.03, top + 0.03, 0.02, 2, 2, steel)
		else:
			# the P-47: throttle quadrant (throttle, prop, mixture, the turbo's boost), the trim tab wheels (elevator, rudder, aileron), the radio
			P.put(paint, box.call(0.1, 0.1, 0.28), L, top - 0.02, -0.3)
			for k in 2:
				P.put(steel, cyl.call(0.006, 0.008, 0.12, 6), L + 0.01 + k * 0.025, top + 0.07, -0.38 + k * 0.03, -0.4)
			for k in 2:
				P.put(red, Geo.sphere(0.015, 8, 6), L + 0.01 + k * 0.025, top + 0.12, -0.4 + k * 0.03)
			wheel.call(L - 0.02, top - 0.06, 0.06, 0.07, black); wheel.call(L - 0.01, top - 0.04, 0.17, 0.05, black); P.put(black, cyl.call(0.04, 0.04, 0.02, 16), L + 0.02, top + 0.02, 0.24)
			P.put(black, box.call(0.11, 0.09, 0.2), R, top + 0.02, -0.3) # the SCR-522 radio's control box
			for k in 4:
				P.put(white, box.call(0.02, 0.012, 0.025), R - 0.03 + k * 0.022, top + 0.07, -0.36)
			switches.call(R - 0.03, top + 0.03, 0.0, 3, 2, steel)

		# ---- the instrument panel: its face drawn live (PanelArt), on a deep panel with the bezels standing out
		# of it, under the coaming, glowing at night
		var art := PanelArt.new(T)
		var panel_mat := _aniso(Mat.standard({map = art.tex, emissiveMap = art.tex, emissive = 0x000000, roughness = 0.55, metalness = 0.2}))
		const PY := -0.36
		const PZ := -0.62
		const TILT := -0.12
		var pm := Transform3D(Basis.from_euler(Vector3(TILT, 0, 0), EULER_ORDER_XYZ), Vector3(0, PY, PZ))
		var panel := MeshInstance3D.new()
		panel.mesh = Geo.plane(PW, PH).to_mesh(panel_mat)
		panel.rotation_order = EULER_ORDER_XYZ
		panel.position = Vector3(0, PY, PZ); panel.rotation.x = TILT
		g.add_child(panel)
		var panel_back := _aniso(Mat.standard({color = T.panel, map = wear, roughness = 0.7, metalness = 0.2}))
		P.put_m(panel_back, box.call(PW + 0.04, PH + 0.03, 0.04).translate(0, 0, -0.022), pm)
		for d in LAYOUT[T.units]: # the bezels, out of the panel
			var x: float = (d[0] / float(PANEL_W) - 0.5) * PW
			var y: float = (0.5 - d[1] / float(PANEL_H)) * PH
			var rr: float = ((d[2] + 8) / float(PANEL_W)) * PW
			P.put_m(black, Geo.torus(rr, 0.0045, 6, 32).scale(1, 1, 1.6).translate(x, y, 0.004), pm)
		# the coaming: a hood over the panel, its padded lip along the top
		var hood = Geo.cylinder(0.4, 0.4, 0.26, 24, 1, true, -PI * 0.42, PI * 0.84).rotate_x(PI / 2).scale(1, 0.28, 1)
		P.put(panel_back, hood, 0, -0.2 - 0.4 * 0.28 * 0.8, -0.73)
		P.put(leather, cyl.call(0.028, 0.028, 0.66, 10), 0, -0.198, -0.6, 0, 0, PI / 2)

		# ---- the gunsight on the coaming: its body, the reflector glass (the reticle: pilot.gd puts it on the
		# guns' line, collimated, so it sits where the rounds converge) and a crash pad
		if T.sight == "revi": # the Revi 16B: lamp housing, the head with its reflector and sun filter, the pad
			P.put(black, Geo.rounded_box(0.065, 0.075, 0.13, 3, 0.012), 0, -0.16, -0.53)
			P.put(black, cyl.call(0.028, 0.032, 0.09, 16), 0, -0.2, -0.51, PI / 2)
			P.put(black, Geo.rounded_box(0.075, 0.028, 0.06, 2, 0.008), 0, -0.11, -0.55)
			P.put(steel, cyl.call(0.007, 0.007, 0.08, 8), 0, -0.1, -0.515, 0, 0, PI / 2) # the filter's hinge
			P.put(leather, Geo.rounded_box(0.05, 0.045, 0.03, 2, 0.012), 0, -0.165, -0.455)
			P.put(Mat.physical({color = 0x705a30, transparent = true, opacity = 0.45, roughness = 0.1, depthWrite = false, side = Mat.DOUBLE}), Geo.plane(0.07, 0.05), 0, -0.07, -0.5, 0.9) # the sun filter, folded up
		elif T.sight == "n3b": # the N-3B: the lamp housing, a short tube lying fore and aft on its bracket, the reflector glass over its lens, the pad
			P.put(black, cyl.call(0.032, 0.032, 0.15, 16), 0, -0.165, -0.55, PI / 2)
			P.put(black, cyl.call(0.04, 0.036, 0.03, 16), 0, -0.165, -0.625, PI / 2) # (its lens end, the glass's mount)
			P.put(paint, box.call(0.05, 0.035, 0.1), 0, -0.2, -0.56) # the bracket on the coaming
			P.put(steel, cyl.call(0.009, 0.009, 0.075, 8), 0.045, -0.15, -0.52, 0, 0, PI / 2) # the dimmer's knob
			P.put(leather, Geo.rounded_box(0.06, 0.05, 0.03, 2, 0.012), 0, -0.165, -0.46) # the crash pad
		else: # the K-14: the big gyro box, its range knob, the pad on its back, two glasses
			P.put(black, Geo.rounded_box(0.11, 0.1, 0.24, 3, 0.018), 0, -0.175, -0.54)
			P.put(black, Geo.rounded_box(0.09, 0.045, 0.08, 2, 0.01), 0, -0.105, -0.61)
			P.put(steel, cyl.call(0.02, 0.02, 0.025, 14), 0.068, -0.18, -0.5, 0, 0, PI / 2) # the range knob
			P.put(leather, Geo.rounded_box(0.1, 0.07, 0.045, 3, 0.02), 0, -0.18, -0.405) # the crash pad
		var plate := MeshInstance3D.new()
		plate.mesh = Geo.plane(0.075 if T.sight == "revi" else (0.085 if T.sight == "n3b" else 0.09), 0.07).to_mesh(Mat.physical({color = 0xbcd8e0, transparent = true, opacity = 0.16, roughness = 0.03, depthWrite = false, side = Mat.DOUBLE}))
		plate.rotation_order = EULER_ORDER_XYZ
		plate.position = Vector3(0, -0.1 if T.sight == "n3b" else -0.06, -0.53 if T.sight == "revi" else -0.6); plate.rotation.x = -0.6
		g.add_child(plate)

		# ---- the stick and the throttle, with your hands on them, and your knees
		var stick := Node3D.new()
		stick.rotation_order = EULER_ORDER_XYZ
		stick.position = Vector3(0, -0.98, -0.28)
		g.add_child(stick)
		var sp := func(geo, mat: Material, x: float, y: float, z: float) -> MeshInstance3D:
			var m := MeshInstance3D.new()
			m.mesh = geo.to_mesh(mat)
			m.position = Vector3(x, y, z)
			stick.add_child(m)
			return m
		sp.call(cyl.call(0.035, 0.05, 0.08, 12), leather, 0, 0.03, 0) # the rubber boot
		sp.call(cyl.call(0.013, 0.017, 0.5, 10).translate(0, 0.25, 0), black, 0, 0, 0)
		sp.call(cyl.call(0.022, 0.026, 0.13, 12).translate(0, 0.55, 0), black, 0, 0, 0) # the grip
		sp.call(box.call(0.03, 0.02, 0.03), red, 0, 0.6, -0.025) # the gun button
		sp.call(box.call(0.012, 0.035, 0.02), steel, 0, 0.55, -0.03) # the trigger
		var rh := hand(leather)
		rh.rotation_order = EULER_ORDER_XYZ
		rh.position = Vector3(0.02, 0.56, 0.02); rh.rotation = Vector3(-0.3, 0, -1.4)
		stick.add_child(rh)
		var throttle := Node3D.new()
		throttle.position = Vector3(L + 0.02, top + 0.03, -0.25)
		g.add_child(throttle)
		var lever := MeshInstance3D.new()
		lever.rotation_order = EULER_ORDER_XYZ
		lever.mesh = cyl.call(0.01, 0.012, 0.16, 8).translate(0, 0.08, 0).to_mesh(black)
		throttle.add_child(lever)
		var knob := MeshInstance3D.new()
		knob.mesh = Geo.sphere(0.026, 12, 8).to_mesh(Mat.standard({color = 0x1a1a1a, roughness = 0.4}))
		knob.position.y = 0.17; lever.add_child(knob)
		var lh := hand(leather)
		lh.rotation_order = EULER_ORDER_XYZ
		lh.position = Vector3(0.02, 0.15, 0.03); lh.rotation = Vector3(-0.4, 0, 0.6)
		lever.add_child(lh)
		for s in [-1, 1]: # the knees, either side of the stick, under the panel
			P.put(suit, Geo.capsule(0.075, 0.45, 4, 10), s * 0.13, -0.8, -0.12, PI / 2 - 0.35)
			P.put(suit, Geo.capsule(0.06, 0.4, 4, 10), s * 0.13, -0.97, -0.43)

		# ---- the windscreen, the bulletproof glass, the canopy in box-section frames
		var ws: Dictionary
		if T.canopy == "razorback":
			ws = {z = z0 - 0.1, x0 = 0.18, x1 = width_at.call(z0) - 0.05, yt = 0.17, zt = -0.36}
		elif T.canopy == "bubble":
			ws = {z = z0 - 0.08, x0 = 0.16, x1 = width_at.call(z0) - 0.03, yt = 0.2, zt = -0.4}
		elif T.canopy == "fw":
			ws = {z = z0 - 0.08, x0 = 0.19, x1 = width_at.call(z0) - 0.04, yt = 0.2, zt = -0.36}
		else:
			ws = {z = z0 - 0.1, x0 = 0.17, x1 = width_at.call(z0) - 0.04, yt = 0.21, zt = -0.36}
		var yb := sill - 0.01
		# the windscreen's corners: the flat front panel between the inner posts, the side panes out to the sills
		var fl := Vector3(-ws.x0, yb, ws.z)
		var fr := Vector3(ws.x0, yb, ws.z)
		var tl := Vector3(-ws.x0 * 0.85, ws.yt, ws.zt)
		var tr := Vector3(ws.x0 * 0.85, ws.yt, ws.zt)
		var sl := Vector3(-ws.x1, yb, ws.z + 0.12)
		var sr := Vector3(ws.x1, yb, ws.z + 0.12)
		var stl := Vector3(-(ws.x1 - 0.07), ws.yt - 0.03, ws.zt + 0.06)
		var str_ := Vector3(ws.x1 - 0.07, ws.yt - 0.03, ws.zt + 0.06)
		var bubble: bool = T.canopy != "erla" and T.canopy != "razorback" # (a bubble's windscreen bow is the bubble's own forward frame)
		P.put_m(glass, quad_geo(fl, fr, tr, tl), I)
		if T.canopy != "razorback": # (the razorback's own slimmer windscreen frame and side panes: below)
			var frames := [[fl, tl], [fr, tr], [fl, fr]] if bubble else [[fl, tl], [fr, tr], [sl, stl], [sr, str_], [tl, tr], [tl, stl], [tr, str_], [fl, fr]]
			for ab in frames:
				P.bar(frame_out, ab[0], ab[1], 0.024, 0.026, Vector3(0, 0.4, -1).normalized())
			P.put_m(glass, quad_geo(sl, fl, tl, stl), I)
			P.put_m(glass, quad_geo(fr, sr, str_, tr), I)
		# the thick bulletproof glass: inside the 109's windscreen, outside the Fw 190's, the P-47's front panel itself
		var agm := Transform3D(Basis(Vector3(1, 0, 0), atan2(ws.zt - ws.z, ws.yt - yb)), # (leaning back with the windscreen)
			Vector3(0, (yb + ws.yt) / 2 + 0.005, (ws.z + ws.zt) / 2 + (0.06 if kind == "bf109" else (-0.03 if kind == "fw190" else 0.0))))
		P.slab(ws.x0 * 1.7, 0.27, 0.05, agm)
		for sx in [-1, 1]:
			P.put_m(frame_out, box.call(0.012, 0.29, 0.06).translate(sx * ws.x0 * 0.86, 0, 0), agm) # its frame's edges
		var rear_z := z1 + 0.02
		var H: float = {erla = 0.24, fw = 0.27, bubble = 0.33, razorback = 0.27}[T.canopy]
		if T.canopy == "erla":
			# the Erla Haube: big clear side and top panels in a light frame; at the back the head armour, steel
			# below and armoured glass above
			var tlb := Vector3(-0.27, H, rear_z)
			var trb := Vector3(0.27, H, rear_z)
			var slb := Vector3(-width_at.call(rear_z) + 0.02, yb, rear_z)
			var srb := Vector3(width_at.call(rear_z) - 0.02, yb, rear_z)
			var ul := Vector3(-0.36, H - 0.1, rear_z)
			var ur := Vector3(0.36, H - 0.1, rear_z)
			var ulf := Vector3(-(ws.x1 - 0.05), ws.yt - 0.08, ws.zt + 0.12)
			var urf := Vector3(ws.x1 - 0.05, ws.yt - 0.08, ws.zt + 0.12)
			for ab in [[stl, tlb], [str_, trb], [tlb, trb], [slb, ul], [ul, tlb], [srb, ur], [ur, trb]]:
				P.bar(frame_out, ab[0], ab[1], 0.02, 0.022, Vector3(0, 1, 0))
			P.put_m(glass, quad_geo(sl, slb, ul, ulf), I); P.put_m(glass, quad_geo(ulf, ul, tlb, stl), I)
			P.put_m(glass, quad_geo(srb, sr, urf, ur), I); P.put_m(glass, quad_geo(ur, urf, str_, trb), I)
			P.put_m(glass, quad_geo(stl, tlb, trb, str_), I)
			P.put(steel, box.call(0.5, 0.2, 0.012), 0, sill + 0.06, rear_z - 0.04)
			P.slab(0.46, 0.17, 0.05, Transform3D(Basis(), Vector3(0, sill + 0.245, rear_z - 0.04)))
			for ab in [[Vector3(-0.24, sill + 0.16, rear_z - 0.04), Vector3(-0.24, sill + 0.33, rear_z - 0.04)], [Vector3(0.24, sill + 0.16, rear_z - 0.04), Vector3(0.24, sill + 0.33, rear_z - 0.04)], [Vector3(-0.24, sill + 0.33, rear_z - 0.04), Vector3(0.24, sill + 0.33, rear_z - 0.04)]]:
				P.bar(steel, ab[0], ab[1], 0.022, 0.06, Vector3(0, 0, 1))
		elif T.canopy == "razorback":
			# the P-47D razorback as you see it from the seat: a slim framed windscreen (the flat armoured panel
			# between two thin posts, an angled pane either side back to the windscreen's bow), then the sliding
			# hood, clear all round with one slim hoop over your head and thin rails on the sills, and only behind
			# your head the solid spine (the fuselage's own). Nothing crosses the view ahead or to the sides.
			var fw := 0.016
			var fd := 0.018 # (the frames: a couple of cm, as on the real one)
			var wr := func(z: float) -> float: return width_at.call(z) - 0.08 # the hood's foot, just inside the sill rails
			var zb: float = ws.zt + 0.18 # the windscreen's bow, where the hood begins: nearly over your head, out of the view ahead (0.3 m ahead it ringed the top of the view)
			var h := func(z: float) -> float: return ws.yt + 0.02 + (H - ws.yt - 0.02) * sin(minf(1, maxf(0, (z - zb) / 0.3)) * PI / 2)
			var hoop := func(z: float) -> Array: # (n = 12)
				var p := []
				for k in 13:
					var a := -PI / 2 + (k / 12.0) * PI
					p.append(Vector3(wr.call(z) * sin(a), yb + (h.call(z) - yb) * pow(cos(a), 0.8), z))
				return p
			var bow: Array = hoop.call(zb)
			# the side panes, from the front posts back to the bow, and the small roof pane over the front one
			P.put_m(glass, quad_geo(bow[0], fl, tl, bow[4]), I); P.put_m(glass, quad_geo(fr, bow[12], bow[8], tr), I)
			for k in range(4, 8):
				P.put_m(glass, quad_geo(tl, bow[k], bow[k + 1], bow[k + 1]), I)
			P.put_m(glass, quad_geo(tl, bow[8], tr, tr), I)
			for ab in [[fl, tl], [fr, tr], [tl, tr], [fl, fr], [tl, bow[4]], [tr, bow[8]]]:
				P.bar(frame_out, ab[0], ab[1], fw, fd, Vector3(0, 0.4, -1).normalized())
			for k in 12:
				P.bar(frame_out, bow[k], bow[k + 1], 0.011, 0.012, Vector3(0, 0, 1)) # (slimmer still: seen this close, a couple of cm fills a lot of the view)
			# the hood: its glass, its one hoop (just behind your head, where it was: in front of the eye it read as
			# a thick beam across the top of the view), its back frame where it meets the spine
			P.put_m(glass, bubble_geo(zb, rear_z, wr, yb, h), I)
			for z in [0.18, rear_z]:
				var r: Array = hoop.call(z)
				for k in 12:
					P.bar(frame_out, r[k], r[k + 1], 0.014, fd, Vector3(0, 0, 1))
			P.put(steel, box.call(0.32, 0.3, 0.012), 0, sill + 0.03, z1 - 0.15, -0.08) # the head armour
			P.put(leather, box.call(0.2, 0.12, 0.05), 0, sill + 0.05, z1 - 0.18) # the headrest pad
			# the rear-view mirror, out on top of the windscreen's bow on a short stem: a dark frame, its glass
			# dim (a bright face read as a slab of sky)
			var my: float = h.call(zb) + 0.05
			P.put(steel, box.call(0.01, 0.04, 0.01), 0, h.call(zb) + 0.025, zb)
			P.put(frame_out, box.call(0.1, 0.032, 0.01), 0, my, zb, 0.25)
			P.put(Mat.standard({color = 0x556066, roughness = 0.3, metalness = 0.8}), box.call(0.09, 0.022, 0.004), 0, my, zb + 0.006, 0.25)
		else:
			# a bubble: frameless, its back in a frame; the headrest and armour plate behind your head
			var w := func(z: float) -> float: return width_at.call(z) - 0.02
			var h := func(z: float) -> float:
				var k: float = (z - ws.zt) / (rear_z - ws.zt)
				return ws.yt - 0.02 + (H - ws.yt) * sin(minf(1, k * 1.6) * PI / 2) - ((k - 0.6) * (0.35 if T.canopy == "bubble" else 0.2) if k > 0.6 else 0.0)
			P.put_m(glass, bubble_geo(ws.zt + 0.04, rear_z, w, yb, h), I)
			var arch := []
			for k in 13:
				var a := -PI / 2 + (k / 12.0) * PI
				arch.append(Vector3(w.call(rear_z) * sin(a), yb + (h.call(rear_z) - yb) * pow(cos(a), 0.8), rear_z))
			for k in 12:
				P.bar(frame_out, arch[k], arch[k + 1], 0.024, 0.03, Vector3(0, 0, 1))
			var front2 := []
			for k in 11:
				var a := -PI / 2 + (k / 10.0) * PI
				var z: float = ws.zt
				front2.append(Vector3(w.call(z) * sin(a), yb + (h.call(z) - yb) * pow(cos(a), 0.8), z))
			for k in 10:
				P.bar(frame_out, front2[k], front2[k + 1], 0.022, 0.024, Vector3(0, 0, 1)) # the bubble's forward edge, along the windscreen's bow
			P.put(steel, box.call(0.32, 0.3, 0.014 if kind == "fw190" else 0.012), 0, sill + 0.03, z1 - 0.15, -0.08) # the head armour
			P.put(leather, box.call(0.2, 0.12, 0.05), 0, sill + 0.05, z1 - 0.18) # the headrest pad
			if kind == "fw190":
				for s in [-1, 1]:
					P.bar(steel, Vector3(s * 0.15, sill - 0.1, z1 - 0.13), Vector3(s * 0.12, sill + 0.16, z1 - 0.16), 0.02, 0.02, Vector3(0, 0, 1))

		# ---- what moves: the needles (redrawn ~15 times a second), stick, throttle, and the night glow
		var st := {redraw = 0.0}
		var glow := Color(0.7, 1.0, 0.75).linear_to_srgb() # (Three's emissive is linear; Godot's emission colour is sRGB)
		live = {
			update = func(s: Dictionary, dt: float) -> void:
				st.redraw -= dt
				if st.redraw <= 0:
					st.redraw = 1.0 / 15; art.draw(s)
				stick.rotation.x = clampf(-_sv(s, "stickY", "stick_y"), -1, 1) * 0.22 # back to pull up
				stick.rotation.z = clampf(-_sv(s, "stickX", "stick_x"), -1, 1) * 0.25
				lever.rotation.x = -0.6 + s.throttle * 1.0,
			night = func(k: float) -> void: # the radium paint
				panel_mat.emission = glow
				panel_mat.emission_energy_multiplier = k * 1.4,
		}

	# ---- merge: one mesh per material (glass drawn after the rest)
	for mat in P.parts:
		var coloured: bool = _base(mat) is BaseMaterial3D and _base(mat).vertex_color_use_as_albedo
		var list := []
		for x in P.parts[mat]:
			list.append(tidy(x, coloured))
		var m := MeshInstance3D.new()
		m.mesh = Geo.merge(list).to_mesh(mat)
		if _transparent(mat):
			mat.render_priority = 2
		g.add_child(m)

	root.set_meta("update", live.update)
	root.set_meta("night", live.night)
	# (the JS turned the cockpit's shadows off; here it casts and receives them, the glass excepted)
	_shadows(root)
	return root

static func _shadows(n: Node) -> void:
	if n is MeshInstance3D and n.mesh:
		var see_through := false
		for i in n.mesh.get_surface_count():
			var mt = n.mesh.surface_get_material(i)
			if mt and _transparent(mt):
				see_through = true
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if see_through else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for c in n.get_children():
		_shadows(c)

static var SPIRAL: ImageTexture = null
## The German fighters' spinner: black-green with the white spiral.
static func spiral_tex() -> ImageTexture:
	if SPIRAL:
		return SPIRAL
	# (the pixels straight into an Image: the JS's putImageData of the whole canvas)
	var img := Image.create(256, 256, false, Image.FORMAT_RGBA8)
	# (the sphere's uv: u round it, v from the tip back; the stripe's u moves on with v)
	for y in 256:
		for x in 256:
			var w := fmod(x / 256.0 + (y / 256.0) * 0.9, 1.0) < 0.16
			var v := 255 if w else 60
			img.set_pixel(x, y, Color8(v, v, v, 255))
	img.generate_mipmaps()
	SPIRAL = ImageTexture.create_from_image(img)
	return SPIRAL

const _RETICLE_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_test_disabled, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
uniform sampler2D map : source_color, filter_linear_mipmap;
uniform vec3 col; // linear, may go over 1 (Three's Color(4.5, 2.2, 0.7)): it blooms
void fragment() {
	vec4 t = texture(map, UV);
	ALBEDO = t.rgb * col;
	ALPHA = t.a;
}
"""
static var _reticle_shader: Shader = null

##
## The reflector sight's image: a lit cross with a gap in the middle and a dot at its centre, collimated
## (at infinity, so it sits on the guns' line wherever your head is). Put on the camera's parent by
## pilot.gd and placed each frame.
##
static func build_reticle(kind: String) -> MeshInstance3D:
	var x = Canvas2D.new(256, 256)
	var col := "rgba(255,170,90,1)" if kind == "p47" else "rgba(255,190,80,1)"
	x.stroke_style = col; x.fill_style = col; x.line_width = 5; x.shadow_color = col; x.shadow_blur = 8; x.line_cap = "round"
	if kind == "p47":
		for l in [[128, 30, 128, 104], [128, 152, 128, 226], [30, 128, 104, 128], [152, 128, 226, 128]]:
			x.begin_path(); x.move_to(l[0], l[1]); x.line_to(l[2], l[3]); x.stroke()
		x.line_width = 4; x.begin_path(); x.arc(128, 128, 88, 0, 7); x.stroke() # the N-3B's ring round the pip
	else: # the Revi 16B's: the ring, the cross broken at the middle, its bars out past the ring either side and below
		for l in [[128, 34, 128, 106], [128, 150, 128, 250], [6, 128, 106, 128], [150, 128, 250, 128]]:
			x.begin_path(); x.move_to(l[0], l[1]); x.line_to(l[2], l[3]); x.stroke()
		x.line_width = 4; x.begin_path(); x.arc(128, 128, 96, 0, 7); x.stroke()
	x.begin_path(); x.arc(128, 128, 7, 0, 7); x.fill()
	var t: ImageTexture = x.texture(true)
	# (MeshBasicMaterial, additive, no depth test, no fog, its colour over 1: a small shader does exactly that)
	if _reticle_shader == null:
		_reticle_shader = Shader.new()
		_reticle_shader.code = _RETICLE_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = _reticle_shader
	mat.set_shader_parameter("map", t)
	mat.set_shader_parameter("col", Vector3(4.5, 2.2, 0.7))
	mat.render_priority = 10 # (renderOrder 10)
	var m := MeshInstance3D.new()
	m.mesh = Geo.plane(1, 1).to_mesh(mat)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	m.extra_cull_margin = 16384.0 # (frustumCulled = false)
	m.set_meta("canvas", x) # (held while it draws)
	return m
