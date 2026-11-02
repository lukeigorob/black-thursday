extends RefCounted
# The Fw 190 A-8's cockpit, for flying one in first person, built to photographs of the surviving
# aircraft (and the A-8 handbook's panel layout):
# - the windscreen: a trapezoid of 50 mm armour glass between raked posts, triangular quarter panes back
#   to the canopy's front arch, the blown sliding hood behind it, the head armour with its padded rest;
# - the tubular hoop arching over the panel's shroud;
# - the two-tier panel in RLM 66, each instrument behind its hole with four screws round it. Upper:
#   the SZKK 4 ammunition counters, then AFN 2, Fahrtmesser, künstlicher Horizont, Tochterkompass,
#   Steigmesser; Fein-Grob-Höhenmesser, Luftschraubenstellung (the VDM "clock"), Ladedruck, Drehzahl.
#   Lower: Kraftstoff- und Schmierstoffdruck, Schmierstofftemperatur, Kraftstoffvorrat, Borduhr and the
#   red fuel warning lamp. Their needles read the flight (IAS from the air's density, boost and rpm from
#   the Kommandogerät, which set boost, rpm, pitch, mixture and the supercharger's gear from the one lever);
#   the radium paint glows at night;
# - the Revi 16B on the shroud (pilot.gd draws its reticle on the guns' line);
# - the stick (KG 13 B grip) and the throttle moving under your hands; the consoles: the throttle quadrant,
#   the gear and flap buttons, the trim, the fuel cock on the left; the breaker panel, FuG 16Z, oxygen and
#   the canopy crank on the right; the cast rudder pedals, the seat, harness and armour.
# Everything that doesn't move is merged: one draw call per material.
#
# Godot differences (deliberate): the cockpit casts and receives real shadows (the JS turned them off); the
# rivets' bump map becomes a normal map; the dials' radium glow is the material's emission (multiplied by the
# dial atlas, as Three's emissiveMap).

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Env := preload("res://src/environment.gd") # (wet_glass)

## Park–Miller, as the JS: a callable giving the next number in 0..1.
static func rng(seed: int) -> Callable:
	var st := [seed]
	return func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return (st[0] - 1) / 2147483646.0

# the airframe round you, relative to the eye (as TYPES.fw190 in cockpit.gd): stations [z, half width, top,
# widest at, bottom, sill?], the MG 131 humps, the paint, the wing, the exhausts
const T := {
	eye = [0.0, 0.86, -0.22], prop = 3.85, n = 2.05,
	body = [[-3.85, 0.6, -0.2, -0.78, -1.36], [-3.3, 0.64, -0.16, -0.78, -1.4], [-2.3, 0.63, -0.17, -0.78, -1.39], [-1.55, 0.56, -0.175, -0.74, -1.32],
		[-0.95, 0.49, -0.17, -0.7, -1.26], [-0.6, 0.46, -0.16, -0.68, -1.22], [-0.48, 0.46, -0.15, -0.68, -1.22, -0.14], [0.8, 0.43, -0.1, -0.66, -1.2, -0.12],
		[0.95, 0.42, 0.1, -0.66, -1.18], [1.8, 0.36, 0.0, -0.6, -1.05], [2.7, 0.27, -0.08, -0.55, -0.92]],
	bumps = [[0.12, -0.17, -1.3, 0.34, 0.085, 0.05], [-0.12, -0.17, -1.3, 0.34, 0.085, 0.05]],
	top = 0x4a4f55, side = 0x6a7178, belly = 0x9aa6b0, mottle = 0x58654e,
	wing = [-1.3, 5.2, 2.25, 1.15, -1.45, 0.3], exhausts = [0.58, -1.0, -2.15, -1.7, 4],
}
const RLM66 := 0x3e4246 # Schwarzgrau, the cockpit's paint
const AMMO := [475, 475, 250, 250] # the SZKK 4's guns: the two MG 131s, the inner MG 151/20s

static func _num(s: Dictionary, k: String) -> float:
	var v = s.get(k)
	return float(v) if v != null else 0.0

# ---------- the engine as the instruments see it

## The Kommandogerät: one lever, and the box behind it sets boost, rpm, pitch, mixture, ignition and the
## supercharger's gear. The BMW 801 D-2: 1.42 ata and 2,700 U/min for Start- und Notleistung, 1.32 / 2,400
## Steig- und Kampfleistung; the second gear's full-pressure height ~5.7 km, the boost falling above it,
## a dip as the gear changes over (~2.6 km). Indicated airspeed from the true with the air's density (ISA).
static func readings(s: Dictionary) -> Dictionary:
	var t := clampf(_num(s, "throttle"), 0, 1)
	var alt := maxf(0, _num(s, "alt"))
	var dead := false
	if s.get("damage"):
		dead = true
	var rpm := 1300 + 1400 * pow(t, 0.85) - (250.0 if dead else 0.0)
	var avail := 1.42 if alt < 5700 else 1.42 * exp(-(alt - 5700) / 7000)
	var shift := 0.12 * exp(-pow((alt - 2600) / 150, 2))
	var boost := maxf(0.55, minf(0.6 + 0.82 * t, avail) - shift * t)
	var sigma := pow(maxf(0.15, 1 - 2.2558e-5 * alt), 4.2559)
	var speed := _num(s, "speed")
	var ias := speed * sqrt(sigma) * 3.6
	var J := speed / maxf(1, (rpm / 60) * 3.3) # the propeller's advance ratio
	var time := _num(s, "time")
	var ammo := []
	var sa = s.get("ammo")
	for i in AMMO.size():
		var m: float = AMMO[i]
		var v = sa[i] if sa != null and i < sa.size() and sa[i] != null else m
		ammo.append(clampf(float(v) / m, 0, 1))
	return {
		ias = ias, rpm = rpm, boost = boost, alt = alt, climb = _num(s, "climb"), heading = _num(s, "heading"),
		bank = _num(s, "bank"), pitch = _num(s, "pitch"), time = time,
		slip = clampf(_num(s, "stickX") * 0.35, -1, 1),
		pitch_h = 8.5 + J * 3.2, # the VDM clock's hours (12:00 about climbing pitch)
		oil_t = 62 + 22 * t + (38.0 if dead else 0.0),
		oil_p = maxf(0.6, 3.5 - time * 0.01) if dead else 3.2 + 5 * (rpm - 1300) / 1400,
		fuel_p = 1.45 + (sin(time * 7) * 0.25 if dead else 0.0),
		fuel = clampf(250 - time * 0.11, 0, 292), # the rear tank, ~400 l/h
		clock = 14 * 3600 + 18 * 60 + time, # Black Thursday: over Germany at twenty past two
		ammo = ammo,
	}

# ---------- the instrument faces: an atlas drawn live, each dial a cell of it

const AW := 1024 # atlas px, a cell, a dial's radius in px
const AH := 512
const CS := 170
const CR := 80
const DIALS := ["speed", "horizon", "compass", "climb", "afn", "alt", "pitch", "boost", "rpm", "press", "oilt", "fuel", "clock"]
const SZKK := [180, 350, 340, 120] # the ammunition counters' box in the atlas: x, y, w, h
const PAINT := "#e8ecdc" # radium paint, a little green-white
const FONT := '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "Helvetica Neue", Arial, sans-serif'

class DialArt:
	var c # the canvas (in Canvas2D the canvas and its context are one object)
	var g
	var tex: ImageTexture
	var bg

	static func cell_of(kind: String) -> Vector2:
		var i := DIALS.find(kind)
		return Vector2((i % 6) * CS + CS / 2.0, floorf(i / 6.0) * CS + CS / 2.0)

	## JS's String(number): integers without the ".0".
	static func js_str(v: float) -> String:
		return str(int(v)) if v == floorf(v) and absf(v) < 1e15 else str(v)

	func _init() -> void:
		c = Canvas2D.new(AW, AH)
		g = c
		tex = c.texture() # (sRGB as Three's colorSpace; anisotropy comes from the material's filter)
		bg = Canvas2D.new(AW, AH)
		var b = bg
		b.fill_style = "#0c0c0c"; b.fill_rect(0, 0, AW, AH)
		for k in DIALS:
			var p := cell_of(k)
			b.save(); b.translate(p.x, p.y); face(b, k); b.restore()
		szkk_face(b)

	# drawing helpers, about the dial's centre
	func tick(g, a: float, r0: float, r1: float, w: float) -> void:
		g.line_width = w; g.begin_path(); g.move_to(cos(a) * r0, sin(a) * r0); g.line_to(cos(a) * r1, sin(a) * r1); g.stroke()
	func num(g, a: float, rr: float, t: String, size: float, weight := 700) -> void:
		g.font = "%d %spx %s" % [weight, js_str(size), FONT]; g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(t, cos(a) * rr, sin(a) * rr + size * 0.06)
	func text(g, x: float, y: float, t: String, size: float, weight := 600) -> void:
		g.font = "%d %spx %s" % [weight, js_str(size), FONT]; g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(t, x, y)
	## A scale: ticks every `minor`, longer every `mid`, numbered every `major` (fmt), along v -> angle.
	func scale(g, mn: float, mx: float, ang: Callable, minor: float, mid: float, major: float, fmt, size := 17.0, rn := 0.66) -> void:
		var v := mn
		while v <= mx + 1e-6:
			var a: float = ang.call(v)
			var is_maj := absf(v / major - roundf(v / major)) < 1e-4
			var is_mid := absf(v / mid - roundf(v / mid)) < 1e-4
			tick(g, a, CR * (0.78 if is_maj else 0.83 if is_mid else 0.87), CR * 0.95, 3.2 if is_maj else 2.2 if is_mid else 1.3)
			if is_maj and fmt != null:
				num(g, a, CR * rn, fmt.call(v), size)
			v += minor
	## A German needle: a white lance, luminous to its tip, on a black hub.
	func needle(g, a: float, ln: float, w := 5.0, tail := 0.18, col := PAINT) -> void:
		g.save(); g.rotate(a); g.fill_style = col
		g.begin_path(); g.move_to(-CR * tail, -w * 0.6); g.line_to(CR * ln * 0.82, -w / 2); g.line_to(CR * ln, 0); g.line_to(CR * ln * 0.82, w / 2); g.line_to(-CR * tail, w * 0.6); g.close_path(); g.fill()
		g.fill_style = "#00000055"; g.fill_rect(-CR * tail, -0.6, CR * ln * 0.5, 1.2) # (its spine)
		g.restore()
	func hub(g, r := 7.0) -> void:
		g.fill_style = "#050505"; g.begin_path(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke_style = "#3a3a3a"; g.line_width = 1.5; g.stroke()

	# a 270 degree dial from bottom left
	const A0 := PI * 0.75
	const SW := PI * 1.5
	func _lin(mn: float, mx: float) -> Callable:
		return func(v: float) -> float: return A0 + ((v - mn) / (mx - mn)) * SW

	## The static face of each dial: its black face, scale, numbers and markings.
	func face(g, kind: String) -> void:
		var gr = g.create_radial_gradient(-CR * 0.2, -CR * 0.2, 0, 0, 0, CR)
		gr.add_color_stop(0, "#1b1c1b"); gr.add_color_stop(1, "#0a0a0a")
		g.fill_style = gr; g.begin_path(); g.arc(0, 0, CR, 0, TAU); g.fill()
		g.stroke_style = PAINT; g.fill_style = PAINT; g.line_cap = "butt"
		match kind:
			"speed": # Fahrtmesser, 100..750 km/h round most of the dial, opened out at the low end
				var ang := func(v: float) -> float: return DialArt.speed_ang(v)
				scale(g, 100, 750, ang, 10, 50, 100, func(v): return js_str(v / 100), 21)
				text(g, 0, CR * 0.34, "km/h", 14)
				g.fill_style = "#c02a1c"; g.begin_path()
				var a: float = ang.call(750)
				g.arc(cos(a) * CR * 0.9, sin(a) * CR * 0.9, 4, 0, TAU); g.fill()
			"climb": # Steigmesser: nought at nine o'clock, climb above, sink below, opened out near nought
				var ang := func(v: float) -> float: return DialArt.climb_ang(v)
				for s in [-1, 1]:
					for v in [1, 2, 3, 4, 6, 7, 8, 9, 15, 25]:
						tick(g, ang.call(s * v), CR * 0.87, CR * 0.95, 1.3)
					for v in [5, 10, 20, 30]:
						tick(g, ang.call(s * v), CR * 0.78, CR * 0.95, 3); num(g, ang.call(s * v), CR * 0.64, str(v), 17)
				tick(g, PI, CR * 0.7, CR * 0.95, 4); num(g, PI, CR * 0.56, "0", 18)
				text(g, CR * 0.3, 0, "m/s", 14)
				text(g, -CR * 0.12, -CR * 0.3, "↑", 13); text(g, -CR * 0.12, CR * 0.3, "↓", 13)
			"alt": # Fein-Grob-Höhenmesser: the long hand round once a km (0..9: hundreds of metres)
				for k in 50:
					var a := -PI / 2 + (k / 50.0) * TAU
					tick(g, a, CR * (0.87 if k % 5 else 0.78), CR * 0.95, 1.3 if k % 5 else 3.0)
				for k in 10:
					num(g, -PI / 2 + (k / 10.0) * TAU, CR * 0.64, str(k), 21)
				text(g, 0, -CR * 0.3, "km", 13)
				g.fill_style = "#000"; g.fill_rect(-19, CR * 0.3, 38, 15); g.stroke_style = "#555"; g.line_width = 1; g.stroke_rect(-19, CR * 0.3, 38, 15) # the pressure window
				g.fill_style = "#d8d4c0"; text(g, 0, CR * 0.3 + 8, "1013", 11, 700); g.fill_style = PAINT
				text(g, 0, CR * 0.58, "mb", 9)
			"boost": # Ladedruckmesser, ata, with the decimal comma; red at Start- und Notleistung
				var ang := _lin(0.6, 1.8)
				scale(g, 0.6, 1.8, ang, 0.05, 0.1, 0.2, func(v): return ("%.1f" % v).replace(".", ","), 15)
				text(g, 0, CR * 0.38, "ata", 15)
				red_mark(g, ang.call(1.42))
			"rpm": # Drehzahlmesser, U/min x 100
				var ang := _lin(0, 36)
				scale(g, 0, 36, ang, 1, 2, 4, func(v): return js_str(v), 16)
				text(g, 0, CR * 0.32, "U/min", 12); text(g, 0, CR * 0.48, "x 100", 11)
				red_mark(g, ang.call(27))
			"oilt": # Schmierstofftemperatur (Eintritt)
				var ang := _lin(0, 130)
				g.stroke_style = "#3d8f4a"; g.line_width = 5; g.begin_path(); g.arc(0, 0, CR * 0.9, ang.call(40), ang.call(85)); g.stroke(); g.stroke_style = PAINT
				scale(g, 0, 130, ang, 5, 10, 20, func(v): return js_str(v), 15)
				red_mark(g, ang.call(95))
				text(g, 0, CR * 0.3, "°C", 14); text(g, 0, CR * 0.48, "Schmierst.", 10)
			"fuel": # Kraftstoffvorratsanzeiger (the selected tank)
				var ang := _lin(0, 300)
				scale(g, 0, 300, ang, 10, 50, 100, func(v): return js_str(v), 16)
				text(g, 0, CR * 0.3, "Liter", 13); text(g, 0, CR * 0.48, "Kraftstoff", 10)
				g.stroke_style = "#c02a1c"; g.line_width = 5; g.begin_path(); g.arc(0, 0, CR * 0.9, ang.call(0), ang.call(40)); g.stroke(); g.stroke_style = PAINT
			"press": # Kraftstoff- und Schmierstoffdruckmesser: K (0..3) above, S (0..15) below
				var k := func(v: float) -> float: return PI * 1.17 + (v / 3) * PI * 0.66
				var s_a := func(v: float) -> float: return PI * 0.83 - (v / 15) * PI * 0.66
				scale(g, 0, 3, k, 0.25, 0.5, 1, func(v): return js_str(v), 15)
				scale(g, 0, 15, s_a, 1, 5, 5, func(v): return js_str(v), 15)
				text(g, 0, -CR * 0.36, "K", 17, 800); text(g, 0, CR * 0.36, "S", 17, 800)
				text(g, CR * 0.42, 0, "kg/cm²", 9)
			"pitch": # Luftschraubenstellungsanzeiger: the VDM propeller's pitch read like a clock
				for k in 60:
					tick(g, -PI / 2 + (k / 60.0) * TAU, CR * (0.88 if k % 5 else 0.79), CR * 0.95, 1.2 if k % 5 else 3.0)
				for k in range(1, 13):
					num(g, -PI / 2 + (k / 12.0) * TAU, CR * 0.65, str(k), 17)
				text(g, 0, CR * 0.3, "VDM", 11)
			"clock": # Borduhr
				for k in 60:
					tick(g, -PI / 2 + (k / 60.0) * TAU, CR * (0.88 if k % 5 else 0.78), CR * 0.95, 1.2 if k % 5 else 3.4)
				for k in range(1, 13):
					num(g, -PI / 2 + (k / 12.0) * TAU, CR * 0.64, str(k), 18)
				for k in 12:
					var a := -PI / 2 + (k / 12.0) * TAU
					g.begin_path(); g.arc(cos(a) * CR * 0.98, sin(a) * CR * 0.98, 2.5, 0, TAU); g.fill() # (the radium dots)
			"afn": # AFN 2: the homing indicator, left/right of the beacon
				g.line_width = 2; g.begin_path(); g.arc(0, CR * 0.55, CR * 0.95, PI * 1.32, PI * 1.68); g.stroke()
				for k in range(-4, 5):
					var a := -PI / 2 + k * 0.09
					g.save(); g.translate(0, CR * 0.55); tick(g, a, CR * 0.95, CR * (1.05 if k else 1.12), 1.5 if k else 3.0); g.restore()
				text(g, -CR * 0.55, -CR * 0.1, "L", 16, 800); text(g, CR * 0.55, -CR * 0.1, "R", 16, 800)
				text(g, 0, CR * 0.62, "AFN 2", 12)
			_: # "horizon", "compass": (all drawn live)
				pass

	func red_mark(g, a: float) -> void:
		g.save(); g.rotate(a); g.fill_style = "#c42a1b"; g.begin_path(); g.move_to(CR * 0.97, 0); g.line_to(CR * 0.84, -5); g.line_to(CR * 0.84, 5); g.fill(); g.restore(); g.fill_style = PAINT

	## The SZKK 4's box: four windows with their scales; the tapes are drawn live.
	func szkk_face(g) -> void:
		var x: float = SZKK[0]
		var y: float = SZKK[1]
		var w: float = SZKK[2]
		var h: float = SZKK[3]
		g.fill_style = "#121212"; g.fill_rect(x, y, w, h)
		g.stroke_style = "#333"; g.line_width = 3; g.stroke_rect(x + 1.5, y + 1.5, w - 3, h - 3)
		for i in 4:
			var cx := x + 18 + i * 82
			var wy := y + 12
			var wh := h - 34
			g.fill_style = "#040404"; g.fill_rect(cx, wy, 30, wh)
			g.stroke_style = PAINT; g.fill_style = PAINT
			for k in 11:
				var yy := wy + wh - (k / 10.0) * wh
				g.line_width = 1 if k % 5 else 2; g.begin_path(); g.move_to(cx + 32, yy); g.line_to(cx + (38 if k % 5 else 42), yy); g.stroke()
			var mx: int = AMMO[i]
			text(g, cx + 54, wy + 4, str(mx), 11, 700); text(g, cx + 54, wy + wh / 2, str(roundi(mx / 2.0)), 10); text(g, cx + 50, wy + wh - 3, "0", 10)
			text(g, cx + 22, y + h - 11, "MG 131" if i < 2 else "MG 151", 11, 700)

	# the angles of the non-linear scales
	static func speed_ang(v: float) -> float:
		return PI * 0.6 if v < 100 else PI * 0.65 + pow((minf(v, 760) - 100) / 650, 0.85) * PI * 1.7
	static func climb_ang(v: float) -> float:
		return PI + signf(v) * pow(minf(absf(v), 31) / 30, 0.7) * PI * 0.82

	## The live parts: the needles, the horizon, the compass card, the counters' tapes, and the glass's glint.
	func draw(e: Dictionary) -> void:
		# (Canvas2D keeps the calls it's given: start afresh each time, as the background covers it all anyway)
		g.clear_rect(0, 0, AW, AH)
		g.draw_image(bg, 0, 0)
		for k in DIALS:
			var p := cell_of(k)
			g.save(); g.translate(p.x, p.y); live(g, k, e); glint(g); g.restore()
		var x: float = SZKK[0]
		var y: float = SZKK[1]
		var h: float = SZKK[3]
		for i in 4:
			var cx := x + 18 + i * 82
			var wy := y + 12
			var wh := h - 34
			var f: float = e.ammo[i]
			g.fill_style = "#ebe6d2"; g.fill_rect(cx + 3, wy + wh * (1 - f), 24, wh * f)
			if f < 0.15:
				g.fill_style = "#b02518"; g.fill_rect(cx + 3, wy + wh * (1 - f), 24, wh * f)
		tex = c.texture() # (needsUpdate: redraws into the same texture)

	func glint(g) -> void:
		var gl = g.create_linear_gradient(-CR, -CR, CR * 0.2, CR * 0.3)
		gl.add_color_stop(0, "#ffffff1c"); gl.add_color_stop(0.42, "#ffffff07"); gl.add_color_stop(0.46, "#ffffff00")
		g.fill_style = gl; g.begin_path(); g.arc(0, 0, CR, 0, TAU); g.fill()

	func _lv(v: float, mn: float, mx: float) -> float:
		return A0 + ((clampf(v, mn, mx) - mn) / (mx - mn)) * SW

	func live(g, kind: String, e: Dictionary) -> void:
		match kind:
			"speed":
				needle(g, speed_ang(e.ias), 0.86); hub(g)
			"climb":
				needle(g, climb_ang(e.climb), 0.86); hub(g)
			"alt":
				needle(g, -PI / 2 + (e.alt / 10000) * TAU, 0.5, 9, 0.12) # the km
				needle(g, -PI / 2 + (fmod(e.alt, 1000) / 1000) * TAU, 0.88, 4, 0.22) # the hundreds
				hub(g, 8)
			"boost":
				needle(g, _lv(e.boost, 0.6, 1.8), 0.86); hub(g)
			"rpm":
				needle(g, _lv(e.rpm / 100, 0, 36), 0.86); hub(g)
			"oilt":
				needle(g, _lv(e.oil_t, 0, 130), 0.84); hub(g)
			"fuel":
				needle(g, _lv(e.fuel, 0, 300), 0.84); hub(g)
			"press":
				needle(g, PI * 1.17 + (clampf(e.fuel_p, 0, 3) / 3) * PI * 0.66, 0.82, 4)
				needle(g, PI * 0.83 - (clampf(e.oil_p, 0, 15) / 15) * PI * 0.66, 0.82, 4)
				hub(g)
			"pitch":
				var h: float = e.pitch_h
				needle(g, -PI / 2 + (fmod(h, 12) / 12) * TAU, 0.5, 7, 0.1)
				needle(g, -PI / 2 + fmod(h, 1) * TAU, 0.84, 4, 0.15)
				hub(g)
			"clock":
				var t: float = e.clock
				needle(g, -PI / 2 + fmod(t / 3600, 12) / 12 * TAU, 0.5, 7, 0.1)
				needle(g, -PI / 2 + fmod(t / 60, 60) / 60 * TAU, 0.82, 4.5, 0.12)
				g.save(); g.rotate(-PI / 2 + fmod(floorf(t), 60) / 60 * TAU); g.fill_style = "#d24a2a"; g.fill_rect(-CR * 0.2, -1, CR * 1.08, 2); g.restore()
				hub(g, 6)
			"afn":
				g.save(); g.translate(0, CR * 0.55)
				needle(g, -PI / 2 + sin(e.time * 0.23) * 0.06 + sin(e.time * 1.7) * 0.012, 1.05, 4, 0)
				g.restore()
				g.fill_style = "#050505"; g.begin_path(); g.arc(0, CR * 0.55, 9, 0, TAU); g.fill()
			"horizon":
				g.save(); g.begin_path(); g.arc(0, 0, CR * 0.97, 0, TAU); g.clip()
				g.rotate(-e.bank)
				var k := CR * 1.6
				var p := clampf(e.pitch, -0.5, 0.5) * k
				g.fill_style = "#1e2a35"; g.fill_rect(-CR * 2, -CR * 3 + p, CR * 4, CR * 3)
				g.fill_style = "#16120d"; g.fill_rect(-CR * 2, p, CR * 4, CR * 3)
				g.stroke_style = PAINT; g.line_width = 4; g.begin_path(); g.move_to(-CR, p); g.line_to(CR, p); g.stroke()
				g.line_width = 1.6
				for d in [-20, -10, 10, 20]:
					var y: float = p - (d * PI / 180) * k
					var hw := CR * (0.18 if absi(d) == 10 else 0.28)
					g.begin_path(); g.move_to(-hw, y); g.line_to(hw, y); g.stroke()
				g.fill_style = PAINT; g.begin_path(); g.move_to(0, -CR * 0.8); g.line_to(-6, -CR * 0.68); g.line_to(6, -CR * 0.68); g.fill() # the bank pointer, on the card
				g.restore()
				g.stroke_style = PAINT # the bank scale, fixed to the case
				for d in [0, 10, 20, 30, 45, 60]:
					for s in ([-1, 1] if d else [1]):
						tick(g, -PI / 2 + s * d * PI / 180, CR * 0.84, CR * 0.96, 1.6 if d % 30 else 3.0)
				g.stroke_style = "#000"; g.line_width = 7; g.line_join = "round" # the little aircraft, outlined
				var plane := func() -> void:
					g.begin_path(); g.move_to(-CR * 0.56, 0); g.line_to(-CR * 0.2, 0); g.line_to(0, CR * 0.11); g.line_to(CR * 0.2, 0); g.line_to(CR * 0.56, 0); g.stroke()
				plane.call(); g.stroke_style = "#f0d9a0"; g.line_width = 3.5; plane.call()
				g.fill_style = "#f0d9a0"; g.begin_path(); g.arc(0, 0, 4, 0, TAU); g.fill()
				# the slip ball in its curved glass, at the bottom
				g.stroke_style = "#2c2e2c"; g.line_width = 13; g.line_cap = "round"; g.begin_path(); g.arc(0, -CR * 0.05, CR * 0.8, PI * 0.36, PI * 0.64); g.stroke(); g.line_cap = "butt"
				g.stroke_style = PAINT; g.line_width = 1.2
				for s in [-1, 1]:
					tick(g, PI / 2 + s * 0.07, CR * 0.7, CR * 0.88, 1.2)
				var ba: float = PI / 2 - e.slip * 0.12 * PI
				g.fill_style = "#050505"; g.begin_path(); g.arc(cos(ba) * CR * 0.8, -CR * 0.05 + sin(ba) * CR * 0.8, 5, 0, TAU); g.fill()
			"compass": # the repeater: the card turns, the lubber line stays
				g.save(); g.rotate(-e.heading); g.stroke_style = PAINT; g.fill_style = PAINT
				for k in 72:
					var a := -PI / 2 + (k / 72.0) * TAU
					tick(g, a, CR * (0.88 if k % 2 else 0.8), CR * 0.95, 1.3 if k % 6 else 2.6)
				for k in 12:
					var a := -PI / 2 + (k / 12.0) * TAU
					var t: String = str(k * 3) if k % 3 else "NOSW"[k / 3]
					g.save(); g.rotate(a + PI / 2); text(g, 0, -CR * 0.64, t, 15 if k % 3 else 21, 600 if k % 3 else 800); g.restore()
				g.restore()
				g.fill_style = "#e09a3a"; g.begin_path(); g.move_to(0, -CR * 0.98); g.line_to(-6, -CR * 0.8); g.line_to(6, -CR * 0.8); g.fill() # the lubber mark
				g.stroke_style = PAINT; g.line_width = 3; g.begin_path(); g.move_to(0, -CR * 0.3); g.line_to(0, CR * 0.32); g.move_to(-CR * 0.26, -CR * 0.05); g.line_to(CR * 0.26, -CR * 0.05); g.move_to(-CR * 0.1, CR * 0.28); g.line_to(CR * 0.1, CR * 0.28); g.stroke()
			_:
				pass

# ---------- the console labels, placards and small static faces: drawn once

const LW := 1024
const LBL := {
	breakers = [0, 0, 512, 256], gear = [512, 0, 256, 256], quadrant = [768, 0, 256, 128], fug = [768, 128, 256, 128],
	trim = [0, 256, 128, 128], o2 = [128, 256, 128, 128], c3 = [256, 256, 256, 64], canopy = [256, 320, 256, 64],
	pedestal = [512, 256, 256, 256], magneto = [768, 256, 128, 128], o2flow = [896, 256, 128, 128],
}
static var LABELS: ImageTexture = null
static var _labels_canvas = null # (kept while it draws)

static func label_tex() -> ImageTexture:
	if LABELS:
		return LABELS
	var c = Canvas2D.new(LW, LW)
	var g = c
	var r := rng(19)
	var base := "#3a3e42"
	g.fill_style = base; g.fill_rect(0, 0, LW, LW)
	var txt := func(x: float, y: float, t: String, size: float, col := "#e6e2d2", weight := 700, align := "center") -> void:
		g.font = "%d %spx %s" % [weight, DialArt.js_str(size), FONT]; g.fill_style = col; g.text_align = align; g.text_baseline = "middle"; g.fill_text(t, x, y)
	var plate := func(x: float, y: float, w: float, h: float, col := "#d9d4bf") -> void:
		g.fill_style = col; g.fill_rect(x, y, w, h); g.stroke_style = "#00000055"; g.line_width = 2; g.stroke_rect(x + 1, y + 1, w - 2, h - 2)
	var screw := func(x: float, y: float, rr := 5.0) -> void:
		g.fill_style = "#26282a"; g.begin_path(); g.arc(x, y, rr, 0, TAU); g.fill(); g.stroke_style = "#000"; g.line_width = 1.5; g.begin_path(); g.move_to(x - rr * 0.7, y); g.line_to(x + rr * 0.7, y); g.stroke()
	var grain := func(x0: float, y0: float, w: float, h: float) -> void:
		var i := 0
		while i < w * h / 60:
			g.fill_style = "#ffffff08" if r.call() < 0.5 else "#00000012"; g.fill_rect(x0 + r.call() * w, y0 + r.call() * h, 2, 2)
			i += 1
	var dial := func(cx: float, cy: float, R: float) -> void:
		g.fill_style = "#0b0b0b"; g.begin_path(); g.arc(cx, cy, R, 0, TAU); g.fill(); g.stroke_style = "#222"; g.line_width = 4; g.stroke(); g.stroke_style = PAINT; g.fill_style = PAINT
	if true: # the Selbstschalter: the breaker panel's face, three rows of six, each labelled
		var x: float = LBL.breakers[0]; var y: float = LBL.breakers[1]; var w: float = LBL.breakers[2]; var h: float = LBL.breakers[3]
		g.fill_style = "#1a1b1c"; g.fill_rect(x, y, w, h); grain.call(x, y, w, h)
		var names := [["Batterie", "Generator", "Fahrwerk", "Landekl.", "Höhenfl.", "Staurohr"], ["Pumpe v.", "Pumpe h.", "Instrum.", "FuG 16", "FuG 25", "Revi"], ["Waffen", "MG 131", "MG 151", "ETC", "Kennl.", "Anlasser"]]
		for j in 3:
			for i in 6:
				var cx := x + 44 + i * 82
				var cy := y + 50 + j * 78
				g.stroke_style = "#555"; g.line_width = 2; g.begin_path(); g.arc(cx, cy, 15, 0, TAU); g.stroke()
				plate.call(cx - 36, cy + 20, 72, 17, "#cfcab4"); txt.call(cx, cy + 29, names[j][i], 13, "#111")
		for sp in [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]:
			screw.call(x + sp[0], y + sp[1], 6)
	if true: # the gear and flap buttons' plate (Fahrwerk / Landeklappen), with their lamps
		var x: float = LBL.gear[0]; var y: float = LBL.gear[1]; var w: float = LBL.gear[2]; var h: float = LBL.gear[3]
		g.fill_style = base; g.fill_rect(x, y, w, h); grain.call(x, y, w, h)
		txt.call(x + w / 2, y + 22, "FAHRWERK", 20); txt.call(x + 70, y + 92, "EIN", 15); txt.call(x + 186, y + 92, "AUS", 15)
		txt.call(x + w / 2, y + 138, "LANDEKLAPPEN", 19); txt.call(x + 50, y + 228, "EIN", 14); txt.call(x + 128, y + 228, "START", 14); txt.call(x + 206, y + 228, "AUS", 14)
		for sp in [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]:
			screw.call(x + sp[0], y + sp[1], 5)
	if true: # the throttle quadrant's side plate
		var x: float = LBL.quadrant[0]; var y: float = LBL.quadrant[1]; var w: float = LBL.quadrant[2]; var h: float = LBL.quadrant[3]
		g.fill_style = "#2d3033"; g.fill_rect(x, y, w, h); grain.call(x, y, w, h)
		g.fill_style = "#0a0a0a"; g.fill_rect(x + 12, y + 56, w - 24, 14) # the slot
		var marks := [["ABSTELLEN", 0.06], ["LEERLAUF", 0.24], ["STEIGEN", 0.68], ["START", 0.9]]
		for mk in marks:
			var xx: float = x + 12 + mk[1] * (w - 24)
			g.fill_style = "#e6e2d2"; g.fill_rect(xx - 1, y + 44, 2, 10); txt.call(xx, y + 30, mk[0], 13)
		g.fill_style = "#b8261a"; g.fill_rect(x + 12 + 0.82 * (w - 24), y + 74, 0.18 * (w - 24) - 2, 6) # (the emergency power's red band)
		txt.call(x + w / 2, y + 100, "KOMMANDOGERÄT", 14, "#c9c4ae", 600)
	if true: # the FuG 16Z's control unit: channel selector, volume
		var x: float = LBL.fug[0]; var y: float = LBL.fug[1]; var w: float = LBL.fug[2]
		g.fill_style = "#1d1e1f"; g.fill_rect(x, y, w, LBL.fug[3]); grain.call(x, y, w, LBL.fug[3])
		txt.call(x + w / 2, y + 16, "FuG 16 Z", 16, "#d8d4c0")
		dial.call(x + 66, y + 74, 38)
		for k in 4:
			var a := -PI * 0.8 + k * 0.5
			txt.call(x + 66 + cos(a) * 28, y + 74 + sin(a) * 28, "IVHY"[k], 12)
		txt.call(x + 66, y + 122, "Kanal", 12, "#d8d4c0", 600)
		dial.call(x + 186, y + 74, 30); txt.call(x + 186, y + 122, "Lautst.", 12, "#d8d4c0", 600)
	if true: # the tailplane trim indicator (Höhenflosse)
		var x: float = LBL.trim[0]; var y: float = LBL.trim[1]; var w: float = LBL.trim[2]; var h: float = LBL.trim[3]
		var cx := x + w / 2
		var cy := y + h / 2
		dial.call(cx, cy, 58)
		for k in range(-4, 5):
			var a := PI + k * 0.17
			g.line_width = 1.5 if k else 3.0; g.begin_path(); g.move_to(cx + cos(a) * 40, cy + sin(a) * 40); g.line_to(cx + cos(a) * 52, cy + sin(a) * 52); g.stroke()
		txt.call(cx + 8, cy - 30, "kopfl.", 10, PAINT, 600); txt.call(cx + 8, cy + 32, "schwanzl.", 10, PAINT, 600)
		g.fill_style = PAINT; g.save(); g.translate(cx + 22, cy); g.rotate(PI - 0.06); g.fill_rect(0, -2, 48, 4); g.restore()
		txt.call(cx + 22, cy, "Höhenfl.", 9, PAINT, 600)
	if true: # the oxygen pressure gauge (Sauerstoff, kg/cm²: full at 150)
		var x: float = LBL.o2[0]; var y: float = LBL.o2[1]; var w: float = LBL.o2[2]; var h: float = LBL.o2[3]
		var cx := x + w / 2
		var cy := y + h / 2
		dial.call(cx, cy, 58)
		for k in 11:
			var a := PI * 0.75 + (k / 10.0) * PI * 1.5
			g.line_width = 1.5 if k % 2 else 3.0; g.begin_path(); g.move_to(cx + cos(a) * 42, cy + sin(a) * 42); g.line_to(cx + cos(a) * 54, cy + sin(a) * 54); g.stroke()
			if not (k % 2):
				txt.call(cx + cos(a) * 30, cy + sin(a) * 30, str(k * 20), 11, PAINT)
		g.save(); g.translate(cx, cy); g.rotate(PI * 0.75 + 0.62 * PI * 1.5); g.fill_style = PAINT; g.fill_rect(-6, -2, 50, 4); g.restore()
		txt.call(cx, cy + 22, "O₂", 13, "#7aa4d8"); txt.call(cx, cy + 38, "kg/cm²", 9, PAINT, 600)
	if true: # the oxygen flow blinker
		var x: float = LBL.o2flow[0]; var y: float = LBL.o2flow[1]; var w: float = LBL.o2flow[2]; var h: float = LBL.o2flow[3]
		var cx := x + w / 2
		var cy := y + h / 2
		dial.call(cx, cy, 56); g.fill_style = "#e8e4d0"; g.fill_rect(cx - 30, cy - 8, 26, 16); g.fill_rect(cx + 4, cy - 8, 26, 16)
		txt.call(cx, cy + 30, "Durchfluss", 10, PAINT, 600)
	if true: # the magneto switch's plate (Zündschalter: 0, M1, M2, M1+2)
		var x: float = LBL.magneto[0]; var y: float = LBL.magneto[1]; var w: float = LBL.magneto[2]; var h: float = LBL.magneto[3]
		var cx := x + w / 2
		var cy := y + h / 2
		g.fill_style = "#1a1a1a"; g.begin_path(); g.arc(cx, cy, 60, 0, TAU); g.fill()
		for ta in [["0", -PI * 0.8], ["M1", -PI * 0.6], ["M2", -PI * 0.4], ["M1+2", -PI * 0.2]]:
			txt.call(cx + cos(ta[1]) * 44, cy + sin(ta[1]) * 44, ta[0], 13)
		txt.call(cx, cy + 40, "ZÜNDUNG", 12)
	if true: # the armament pedestal's switch plate
		var x: float = LBL.pedestal[0]; var y: float = LBL.pedestal[1]; var w: float = LBL.pedestal[2]; var h: float = LBL.pedestal[3]
		g.fill_style = "#26282a"; g.fill_rect(x, y, w, h); grain.call(x, y, w, h)
		txt.call(x + w / 2, y + 26, "WAFFEN", 22)
		for i in 3:
			txt.call(x + 48 + i * 80, y + 120, ["Rumpf", "Flügel i.", "Flügel a."][i], 14); txt.call(x + 48 + i * 80, y + 64, "EIN", 12, "#c9c4ae", 600); txt.call(x + 48 + i * 80, y + 98, "AUS", 12, "#c9c4ae", 600)
		txt.call(x + w / 2, y + 170, "ABWURF", 18); plate.call(x + 40, y + 200, w - 80, 30); txt.call(x + w / 2, y + 215, "NUR IM NOTFALL", 14, "#111")
	if true: # the placards: the fuel grade triangle and the canopy's
		var x: float = LBL.c3[0]; var y: float = LBL.c3[1]; var w: float = LBL.c3[2]; var h: float = LBL.c3[3]
		plate.call(x, y, w, h, "#d6c86a"); txt.call(x + w / 2, y + 22, "KRAFTSTOFF C 3", 22, "#111", 800); txt.call(x + w / 2, y + 48, "96 OKTAN  —  232 L / 292 L", 15, "#111", 700)
		x = LBL.canopy[0]; y = LBL.canopy[1]; w = LBL.canopy[2]; h = LBL.canopy[3]
		plate.call(x, y, w, h, "#cfcab4"); txt.call(x + w / 2, y + 20, "ACHTUNG! VOR DEM NOTABWURF", 16, "#7a1410", 800); txt.call(x + w / 2, y + 44, "KOPF NACH VORN NEHMEN", 16, "#7a1410", 800)
	_labels_canvas = c
	LABELS = c.texture(true) # (sRGB; anisotropic filtering on the material)
	return LABELS

## A w x h plane showing one region of the labels' texture.
static func label_geo(region: Array, w: float, h: float):
	var x: float = region[0]
	var y: float = region[1]
	var rw: float = region[2]
	var rh: float = region[3]
	var g = Geo.plane(w, h)
	var uv: PackedVector2Array = g.uvs
	for i in uv.size():
		var u: Vector2 = uv[i]
		uv[i] = Vector2((x + u.x * rw) / LW, 1 - (y + (1 - u.y) * rh) / LW)
	g.uvs = uv
	return g

# ---------- the procedural textures: worn paint and the skin's rivets

static var WEAR: ImageTexture = null
static var RIVETS: ImageTexture = null
static var RIVETS_NORMAL: ImageTexture = null # (Godot has no bumpMap: the rivets as a normal map)
static var _keep: Array = [] # (the canvases, kept while they draw)

static func wear_tex() -> ImageTexture:
	if WEAR:
		return WEAR
	var c = Canvas2D.new(512, 512)
	var g = c
	var r := rng(23)
	g.fill_style = "#dadada"; g.fill_rect(0, 0, 512, 512)
	for i in 260: # grime
		var x: float = r.call() * 512
		var y: float = r.call() * 512
		var rr: float = 10 + r.call() * 60
		var gr = g.create_radial_gradient(x, y, 0, x, y, rr)
		gr.add_color_stop(0, "rgba(0,0,0,%s)" % (0.05 + r.call() * 0.09)); gr.add_color_stop(1, "rgba(0,0,0,0)"); g.fill_style = gr; g.fill_rect(x - rr, y - rr, rr * 2, rr * 2)
	for i in 14000: # grain
		var v := int(200 + r.call() * 55)
		g.fill_style = "rgba(%d,%d,%d,0.25)" % [v, v, v]; g.fill_rect(r.call() * 512, r.call() * 512, 1.5, 1.5)
	g.line_cap = "round" # chips through to the primer and the bare metal, scuffs where hands and boots go
	for i in 220:
		var x: float = r.call() * 512
		var y: float = r.call() * 512
		g.stroke_style = "rgba(255,255,255,0.55)" if r.call() < 0.7 else "rgba(150,160,140,0.6)"; g.line_width = 0.6 + r.call() * 1.8; g.begin_path(); g.move_to(x, y); g.line_to(x + (r.call() - 0.5) * 26, y + (r.call() - 0.5) * 8); g.stroke()
	_keep.append(c)
	WEAR = c.texture(true) # (repeat wrapping is the material's default; sRGB)
	return WEAR

static func rivet_tex() -> ImageTexture:
	if RIVETS:
		return RIVETS
	var c = Canvas2D.new(256, 256)
	var g = c
	g.fill_style = "#808080"; g.fill_rect(0, 0, 256, 256)
	g.fill_style = "#5a5a5a"; g.fill_rect(0, 0, 256, 2); g.fill_rect(0, 0, 2, 256)
	g.fill_style = "#a8a8a8"
	for k in range(6, 256, 9):
		g.begin_path(); g.arc(k, 7, 1.6, 0, 7); g.fill(); g.begin_path(); g.arc(7, k, 1.6, 0, 7); g.fill(); g.begin_path(); g.arc(k, 128, 1.4, 0, 7); g.fill()
	_keep.append(c)
	RIVETS = c.texture(true)
	var flat := Image.create(1, 1, false, Image.FORMAT_RGBA8)
	flat.fill(Color(0.5, 0.5, 1.0))
	RIVETS_NORMAL = ImageTexture.create_from_image(flat)
	_to_normal(c, RIVETS_NORMAL, 6.0)
	return RIVETS

## A canvas's height (its red) into a normal map, once it has drawn.
static func _to_normal(c, into: ImageTexture, strength: float) -> void:
	var img: Image = await c.image()
	img = img.duplicate()
	img.bump_map_to_normal_map(strength)
	img.generate_mipmaps()
	into.set_image(img)

static var SPIRAL: ImageTexture = null
static func spiral_tex() -> ImageTexture:
	if SPIRAL:
		return SPIRAL
	var c = Canvas2D.new(256, 256)
	var g = c
	var img = g.create_image_data(256, 256)
	var data: PackedByteArray = img.data
	for y in 256:
		for x in 256:
			var i := (y * 256 + x) * 4
			var w := fmod(x / 256.0 + (y / 256.0) * 0.9, 1) < 0.16
			var v := 255 if w else 60
			data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
	img.data = data
	g.put_image_data(img, 0, 0)
	_keep.append(c)
	SPIRAL = c.texture(true)
	return SPIRAL

# ---------- geometry helpers

## Bring a geometry to the shared layout (non-indexed, position, normal, uv, and colour if wanted) so it can be merged.
static func tidy(geo, colour):
	var g = geo.to_non_indexed() if not geo.indices.is_empty() else geo
	for s in 4:
		if g.custom_size[s]:
			g.delete_attribute(str(s))
	if g.normals.is_empty():
		g.compute_vertex_normals()
	if g.uvs.is_empty():
		var uv := PackedVector2Array()
		uv.resize(g.positions.size())
		g.uvs = uv
	if colour and g.colors.is_empty():
		var cl := PackedColorArray()
		cl.resize(g.positions.size())
		cl.fill(Color(1, 1, 1))
		g.colors = cl
	if not colour and not g.colors.is_empty():
		g.delete_attribute("color")
	g.clear_groups()
	return g

## A box-section bar from a to b (w across, d deep), its depth turned towards `out`.
static func bar_geo(a: Vector3, b: Vector3, w: float, d: float, out := Vector3(0, 1, 0)):
	var dir := b - a
	var ln := dir.length()
	var geo = Geo.box(w, d, ln + w * 0.5)
	var z := dir.normalized()
	var x := out.cross(z).normalized()
	if x.length_squared() < 1e-6:
		x = Vector3(1, 0, 0)
	var y := z.cross(x)
	geo.apply_transform(Transform3D(Basis(x, y, z), (a + b) * 0.5))
	return geo

## A flat pane through three or four corners.
static func quad_geo(a: Vector3, b: Vector3, c: Vector3, d = null):
	var pts := [a, b, c, a, c, d] if d != null else [a, b, c]
	var uv := [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] if d != null else [0, 0, 1, 0, 1, 1]
	var g = Geo.from_arrays(PackedVector3Array(pts), null, uv)
	g.compute_vertex_normals()
	return g

static func width_at(z: float) -> float:
	var b: Array = T.body
	for i in range(1, b.size()):
		if z <= b[i][0]:
			var k: float = (z - b[i - 1][0]) / (b[i][0] - b[i - 1][0])
			return b[i - 1][1] + (b[i][1] - b[i - 1][1]) * k
	return b[b.size() - 1][1]

## A Three colour from hex, as Three holds it (linear): the vertex colours below are worked in linear as in
## Three, and their materials read them as linear (vertex_color_is_srgb = false).
static func _lin(hex: int) -> Color:
	return Mat.color(hex).srgb_to_linear()

## The fuselage: superelliptic sections, open above the sill over the cockpit, the MG 131 humps pushed out of it.
static func fuselage_geo():
	var N := 48
	var n: float = T.n
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	var top := _lin(T.top)
	var side := _lin(T.side)
	var belly := _lin(T.belly)
	var mottle := _lin(T.mottle)
	var pe := func(v: float, e: float) -> float: return signf(v) * pow(absf(v), e)
	var at := func(st: Array, th: float) -> Array:
		var w: float = st[1]
		var yt: float = st[2]
		var ym: float = st[3]
		var yb: float = st[4]
		var s := sin(th)
		var c := cos(th)
		return [w * pe.call(s, 2 / n), ym + (yt - ym) * pow(absf(c), 2 / n) if c >= 0 else ym - (ym - yb) * pow(absf(c), 2 / n)]
	var r := rng(3)
	var body: Array = T.body
	var last := -1
	for i in body.size():
		if body[i].size() > 5:
			last = i
	var rear_top: float = body[last + 1][2]
	var sill_y: float = body[last][5]
	var opens := body.map(func(st): return st.size() > 5)
	for i in body.size():
		var st0: Array = body[i]
		var st: Array = [st0[0], st0[1], rear_top, st0[3], st0[4]] if opens[i] else st0
		var z: float = st[0]
		var yt: float = st[2]
		var ym: float = st[3]
		var along := 0.0
		var has_prev := false
		var px := 0.0
		var py := 0.0
		for k in N + 1:
			var xy: Array = at.call(st, (float(k) / N) * PI * 2)
			var x: float = xy[0]
			var y: float = xy[1]
			for bump in T.bumps:
				var bx: float = bump[0]
				var by: float = bump[1]
				var bz: float = bump[2]
				var bl: float = bump[3]
				var bw: float = bump[4]
				var bh: float = bump[5]
				var f := bh * exp(-pow((z - bz) / bl, 2) - (pow(x - bx, 2) + pow(y - by, 2)) / (bw * bw))
				if f > 1e-4:
					var nx := x
					var ny := y - ym
					var l := sqrt(nx * nx + ny * ny)
					if l == 0:
						l = 1
					x += (nx / l) * f
					y += (ny / l) * f
			if opens[i]:
				y = minf(y, sill_y)
			if has_prev:
				along += sqrt((x - px) * (x - px) + (y - py) * (y - py))
			has_prev = true
			px = x
			py = y
			pos.append(Vector3(x, y, z)); uv.append(Vector2(along / 0.5, z / 0.5))
			var h := (y - ym) / maxf(0.01, yt - ym)
			var c: Color = top.lerp(side, clampf((0.8 - h) / 0.45, 0, 1)) if h > 0.35 else side.lerp(belly, clampf((0.1 - h) / 0.4, 0, 1))
			if h > -0.1 and h < 0.6 and r.call() < 0.35:
				c = c.lerp(mottle, 0.35)
			col.append(Color(c.r, c.g, c.b))
		if i:
			for k in N:
				var a := (i - 1) * (N + 1) + k
				var b := a + N + 1
				if opens[i] and opens[i - 1] and minf(minf(pos[a].y, pos[a + 1].y), minf(pos[b].y, pos[b + 1].y)) > sill_y - 1e-4:
					continue
				idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	var g = Geo.from_arrays(pos, null, uv, idx, col)
	g.compute_vertex_normals()
	return g

## A tapered wing with a real airfoil and 6 degrees of dihedral, out to one side.
static func wing_geo(s: float):
	var wy: float = T.wing[0]
	var span: float = T.wing[1]
	var root: float = T.wing[2]
	var tip: float = T.wing[3]
	var le: float = T.wing[4]
	var sweep: float = T.wing[5]
	var M := 24
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	var top_c := _lin(T.top)
	var bot_c := _lin(T.belly)
	var foil := func(x: float, t: float) -> float: return 5 * t * (0.2969 * sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * pow(x, 3) - 0.1015 * pow(x, 4))
	var rows := [[0.36, root, le, 0.12], [span, tip, le + sweep, 0.09]]
	for j in rows.size():
		var x: float = rows[j][0]
		var chord: float = rows[j][1]
		var z0: float = rows[j][2]
		var t: float = rows[j][3]
		var y0 := wy + (x - 0.36) * tan(deg_to_rad(6))
		for k in M + 1:
			var u := float(k) / M
			var a := 1 - u * 2 if u < 0.5 else (u - 0.5) * 2
			var xc := (1 - cos(a * PI)) / 2
			var up := 1.0 if u < 0.5 else -1.0
			pos.append(Vector3(s * x, y0 + up * foil.call(xc, t) * chord, z0 + xc * chord)); uv.append(Vector2(z0 / 0.5 + xc * chord / 0.5, x / 0.5))
			var c := top_c if up > 0 else bot_c
			col.append(Color(c.r, c.g, c.b))
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

## A gloved hand, closed round a grip: a palm, a thumb, the curl of the fingers, the gauntlet's cuff.
static func hand(mat: Material) -> MeshInstance3D:
	var list := []
	for x in [
		Geo.rounded_box(0.08, 0.042, 0.095, 2, 0.015),
		Geo.capsule(0.021, 0.066, 3, 8).rotate_z(PI / 2).translate(0, 0.02, -0.053),
		Geo.capsule(0.013, 0.04, 3, 6).rotate_x(0.8).translate(-0.046, 0.02, -0.02),
		Geo.cylinder(0.036, 0.031, 0.08, 10).rotate_x(PI / 2).translate(0, -0.004, 0.085),
		Geo.capsule(0.03, 0.08, 3, 8).rotate_x(PI / 2).translate(0, -0.006, 0.16),
	]:
		var y = x.to_non_indexed() if not x.indices.is_empty() else x
		y.delete_attribute("uv")
		list.append(y)
	var m := MeshInstance3D.new()
	m.mesh = Geo.merge(list).to_mesh(mat)
	return m

## A cast rudder pedal: a plate with its lightening cut-outs, toe strap and heel cup (shape in x/y, metres).
static func pedal_geo():
	var w := 0.095
	var h := 0.17
	var rr := 0.014
	var s := Shapes.Shape.new()
	s.move_to(-w / 2 + rr, -h / 2); s.line_to(w / 2 - rr, -h / 2); s.quadratic_curve_to(w / 2, -h / 2, w / 2, -h / 2 + rr)
	s.line_to(w / 2, h / 2 - rr); s.quadratic_curve_to(w / 2, h / 2, w / 2 - rr, h / 2); s.line_to(-w / 2 + rr, h / 2)
	s.quadratic_curve_to(-w / 2, h / 2, -w / 2, h / 2 - rr); s.line_to(-w / 2, -h / 2 + rr); s.quadratic_curve_to(-w / 2, -h / 2, -w / 2 + rr, -h / 2)
	var slot := func(y: float, sw: float, sh: float):
		var p := Shapes.Path.new()
		var r2 := sh / 2
		p.move_to(-sw / 2 + r2, y - r2); p.line_to(sw / 2 - r2, y - r2); p.absarc(sw / 2 - r2, y, r2, -PI / 2, PI / 2, false); p.line_to(-sw / 2 + r2, y + r2); p.absarc(-sw / 2 + r2, y, r2, PI / 2, PI * 1.5, false)
		return p
	for y in [0.05, 0.005, -0.04]:
		s.holes.append(slot.call(y, 0.06, 0.024))
	var tri := Shapes.Path.new()
	tri.move_to(-0.018, 0.068); tri.line_to(0.018, 0.068); tri.line_to(0, 0.08); tri.close_path(); s.holes.append(tri)
	var g = Geo.extrude(s, {depth = 0.008, bevelEnabled = true, bevelThickness = 0.002, bevelSize = 0.002, bevelSegments = 1, curveSegments = 6})
	g.translate(0, 0, -0.004)
	return g

## An instrument panel: a plate w x h with round holes for the dials and chamfered top corners.
static func panel_geo(w: float, h: float, holes: Array, chamfer := 0.03):
	var s := Shapes.Shape.new()
	s.move_to(-w / 2, -h / 2); s.line_to(w / 2, -h / 2); s.line_to(w / 2, h / 2 - chamfer); s.line_to(w / 2 - chamfer, h / 2)
	s.line_to(-w / 2 + chamfer, h / 2); s.line_to(-w / 2, h / 2 - chamfer); s.close_path()
	for hole in holes:
		var p := Shapes.Path.new()
		p.absarc(hole[0], hole[1], hole[2], 0, TAU, true)
		s.holes.append(p)
	var g = Geo.extrude(s, {depth = 0.006, bevelEnabled = true, bevelThickness = 0.0015, bevelSize = 0.0015, bevelSegments = 1, curveSegments = 32})
	g.translate(0, 0, -0.006)
	var uv: PackedVector2Array = g.uvs
	for i in uv.size():
		uv[i] = uv[i] * 2
	g.uvs = uv
	return g

## A MeshStandardMaterial, with the anisotropic filtering the JS's textures asked for.
static func _std(o: Dictionary) -> StandardMaterial3D:
	var m := Mat.standard(o)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m

## The material under a hooked one (environment.gd's wet_glass turns a material into a ShaderMaterial).
static func _base(m: Material) -> Material:
	return m.get_meta("hook_base") if m.has_meta("hook_base") else m

## The Fw 190 A-8 cockpit; call .get_meta("update").call(state, dt) every frame and .get_meta("night").call(k)
## as the light changes.
static func build_fw190_cockpit() -> Node3D:
	var root := Node3D.new() # (placed on the fighter each frame: pilot.gd)
	var g := Node3D.new() # everything below is relative to the eye
	g.position = Vector3(T.eye[0], T.eye[1], T.eye[2])
	root.add_child(g)
	var wear := wear_tex()
	var rivets := rivet_tex()
	var labels := label_tex()

	# ---- materials
	var skin := _std({vertexColors = true, map = wear, normalMap = RIVETS_NORMAL, normalScale = 0.6, roughness = 0.62, metalness = 0.15, side = Mat.FRONT}) # (bumpMap: rivets, bumpScale 0.6)
	skin.vertex_color_is_srgb = false
	var inside := _std({color = RLM66, vertexColors = true, map = wear, normalMap = RIVETS_NORMAL, normalScale = 0.2, roughness = 0.95, metalness = 0.1, side = Mat.BACK}) # (seen edge-on, a smoother paint mirrored the sky)
	inside.vertex_color_is_srgb = false
	inside.metallic_specular = 0.5 * 0.25 # (envMapIntensity 0.25: Godot has no per-material sky reflection strength; a lower specular does that)
	var paint := _std({color = RLM66, map = wear, roughness = 0.72, metalness = 0.25}) # the fittings, RLM 66
	var panel_paint := _std({color = 0x33373a, map = wear, roughness = 0.66, metalness = 0.25}) # the panels, a little darker and smoother
	var black := _std({color = 0x141414, map = wear, roughness = 0.55, metalness = 0.3})
	var bakelite := _std({color = 0x0f0d0c, roughness = 0.32, metalness = 0.05}) # the grips and knobs
	var steel := _std({color = 0x777b7e, roughness = 0.38, metalness = 0.85})
	var dark_steel := _std({color = 0x2c2e30, roughness = 0.45, metalness = 0.7})
	var alu := _std({color = 0xa4a8aa, map = wear, roughness = 0.42, metalness = 0.8}) # the cast pedals, bare
	var leather := _std({color = 0x3b2a1e, roughness = 0.82})
	var pad := _std({color = 0x6e4e30, map = wear, roughness = 0.78}) # the headrest's tan leather
	var rubber := _std({color = 0x1a1a1a, roughness = 0.9})
	var webbing := _std({color = 0xa8976e, map = wear, roughness = 0.95}) # the harness's canvas
	var suit := _std({color = 0x3e3a30, roughness = 0.95})
	var red := _std({color = 0x9a1f16, roughness = 0.5})
	var yellow := _std({color = 0xc9a227, roughness = 0.5}) # fuel: the German colour code
	var blue := _std({color = 0x2c5a8c, roughness = 0.5}) # oxygen
	var white := _std({color = 0xd8d4c4, roughness = 0.6})
	var exhaust := _std({color = 0x3a2a22, roughness = 0.9, metalness = 0.4})
	var label_mat := _std({map = labels, roughness = 0.6, metalness = 0.15})
	var hoop_mat := _std({color = 0x5f676e, map = wear, roughness = 0.5, metalness = 0.45}) # the hoop: RLM 66 worn thin, catching the light
	var frame_out := _std({color = T.top, map = wear, roughness = 0.6, metalness = 0.25})
	var frame_in := _std({color = RLM66, map = wear, roughness = 0.7, metalness = 0.25})
	var glass: Material = Env.wet_glass(Mat.physical({color = 0xcfe0e6, transparent = true, opacity = 0.06, roughness = 0.03, depthWrite = false, side = Mat.DOUBLE}))
	var armour: Material = Env.wet_glass(Mat.physical({color = 0xe4efe8, transparent = true, opacity = 0.05, roughness = 0.02, depthWrite = false, side = Mat.DOUBLE}))
	var armour_edge := Mat.physical({color = 0x4d6b5c, transparent = true, opacity = 0.32, roughness = 0.05, depthWrite = false})
	var lens := Mat.physical({color = 0xbcd8e0, transparent = true, opacity = 0.16, roughness = 0.03, depthWrite = false, side = Mat.DOUBLE})
	var filter := Mat.physical({color = 0x5a4a28, transparent = true, opacity = 0.55, roughness = 0.1, depthWrite = false, side = Mat.DOUBLE})
	var lamp_green := _std({color = 0x1a3a1c, emissive = 0x2bd14a, emissiveIntensity = 0.15, roughness = 0.3})
	var lamp_red := _std({color = 0x3a1210, emissive = 0xff2a14, emissiveIntensity = 0.6, roughness = 0.3}) # (the gear's up-and-locked lamps: lit)
	var warn := _std({color = 0x3a1210, emissive = 0xff2a14, emissiveIntensity = 0, roughness = 0.3}) # the fuel warning lamp
	var art := DialArt.new()
	var dial_mat := _std({map = art.tex, emissiveMap = art.tex, emissive = 0x000000, roughness = 0.3, metalness = 0.05})
	dial_mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY # (Three multiplies emissive by its map; Godot adds unless told)

	# the static parts, by material, merged at the end
	var parts := {}
	var add := func(mat: Material, geo):
		if not parts.has(mat):
			parts[mat] = []
		parts[mat].append(geo)
		return geo
	var put := func(mat: Material, geo, x := 0.0, y := 0.0, z := 0.0, rx := 0.0, ry := 0.0, rz := 0.0, sx := 1.0, sy := 1.0, sz := 1.0):
		var o := Transform3D(Basis.from_euler(Vector3(rx, ry, rz), EULER_ORDER_XYZ) * Basis.from_scale(Vector3(sx, sy, sz)), Vector3(x, y, z))
		return add.call(mat, geo.clone().apply_transform(o))
	var put_m := func(mat: Material, geo, m: Transform3D): return add.call(mat, geo.clone().apply_transform(m))
	var box := func(w: float, h: float, d: float): return Geo.box(w, h, d)
	var rbox := func(w: float, h: float, d: float, r := 0.006): return Geo.rounded_box(w, h, d, 2, minf(minf(r, w / 2 - 1e-4), minf(h / 2 - 1e-4, d / 2 - 1e-4)))
	var cyl := func(r0: float, r1: float, h: float, s := 14): return Geo.cylinder(r0, r1, h, s)
	var P := func(x: float, y: float, z: float) -> Vector3: return Vector3(x, y, z)
	var bar := func(mat: Material, a: Vector3, b: Vector3, w := 0.03, d := 0.04, out := Vector3(0, 1, 0)): return add.call(mat, bar_geo(a, b, w, d, out))
	var sill := -0.14
	var wall := func(z: float) -> float: return width_at(z) - 0.035
	var M4 := func(x: float, y: float, z: float, rx := 0.0, ry := 0.0, rz := 0.0) -> Transform3D: return Transform3D(Basis.from_euler(Vector3(rx, ry, rz), EULER_ORDER_XYZ), Vector3(x, y, z))

	# ---- outside: the fuselage skin (painted outside, RLM 66 inside), the spinner and fan, the propeller's blur, the exhausts, the wings
	var body = fuselage_geo()
	add.call(skin, body)
	if true: # the inside of the skin, darkened where little light gets in: under the coaming ahead, down by the floor
		var ib = body.clone()
		var c: PackedColorArray = ib.colors
		for i in ib.positions.size():
			var p: Vector3 = ib.positions[i]
			var k := (0.3 if p.z < -0.46 else 1.0) * clampf(1 + (p.y + 0.5) * 0.9, 0.45, 1)
			c[i] = Color(k, k, k)
		ib.colors = c
		add.call(inside, ib)
	var front: Array = T.body[0]
	var cy: float = front[3]
	var prop: float = -T.prop
	var spinner := _std({color = 0x1e2a1e, roughness = 0.45, metalness = 0.3, map = spiral_tex()})
	put.call(spinner, Geo.sphere(front[1] * 0.95, 24, 12, 0, TAU, 0, PI / 2).rotate_x(-PI / 2).scale(1, 1, 2.1), 0, cy, prop + 0.05)
	put.call(black, Geo.circle(front[1] * 0.98, 32), 0, cy, front[0] + 0.12) # the cooling fan behind the spinner
	for k in 12:
		put.call(steel, box.call(0.05, front[1] * 0.85, 0.01), 0, cy, front[0] + 0.1, 0, 0.5, (k / 12.0) * TAU)
	var blur := Mat.basic({color = 0x202020, transparent = true, opacity = 0.08, depthWrite = false, side = Mat.DOUBLE})
	var disc := MeshInstance3D.new()
	disc.mesh = Geo.ring(front[1] * 0.6, 1.6, 48).to_mesh(blur)
	disc.position = Vector3(0, cy, prop - 0.05)
	disc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(disc)
	if true:
		var ex: float = T.exhausts[0]
		var ey: float = T.exhausts[1]
		var ea: float = T.exhausts[2]
		var eb: float = T.exhausts[3]
		var en: int = T.exhausts[4]
		for s in [-1, 1]:
			for k in en:
				var z := ea + (float(k) / maxi(1, en - 1)) * (eb - ea)
				put.call(exhaust, box.call(0.07, 0.05, 0.085), s * ex, ey, z, 0.25, 0, s * -0.35)
				put.call(black, box.call(0.05, 0.03, 0.03), s * (ex + 0.035), ey - 0.01, z + 0.03, 0.25, 0, s * -0.35)
	for s in [-1, 1]:
		add.call(skin, wing_geo(s))

	# ---- the tub: frames and stringers on the walls, the forward bulkhead behind the panel, the floor, the
	# canopy rails, the turtle deck behind the head armour
	for z in [-0.42, -0.12, 0.18, 0.5]:
		for s in [-1, 1]:
			put.call(paint, box.call(0.022, 0.8, 0.03), s * (wall.call(z) - 0.005), sill - 0.42, z)
	for y in [sill - 0.2, sill - 0.55]:
		for s in [-1, 1]:
			put.call(paint, box.call(0.018, 0.022, 1.25), s * (wall.call(0) - 0.004), y, 0.05)
	put.call(panel_paint, box.call(0.86, 0.85, 0.02), 0, -0.63, -0.76) # the bulkhead ahead of your knees
	put.call(black, box.call(0.86, 0.02, 1.5), 0, -1.08, -0.25) # the floor (the wing's spar box under you)
	for s in [-1, 1]:
		put.call(frame_in, box.call(0.045, 0.03, 1.27), s * (width_at(0.2) - 0.022), sill + 0.012, 0.185) # the canopy rails, along the sills
		put.call(dark_steel, box.call(0.01, 0.01, 1.22), s * (width_at(0.2) - 0.05), sill + 0.024, 0.185) # (their tracks)
	put.call(paint, box.call(0.78, 0.012, 0.62), 0, sill - 0.012, 0.56) # the deck behind the armour

	# ---- the hoop: the tube arching over the panel's shroud from wall to wall
	var hoop_pts := [P.call(-0.39, -0.46, -0.48), P.call(-0.37, -0.22, -0.5), P.call(-0.26, -0.12, -0.53), P.call(0, -0.095, -0.55), P.call(0.26, -0.12, -0.53), P.call(0.37, -0.22, -0.5), P.call(0.39, -0.46, -0.48)]
	add.call(hoop_mat, Geo.tube(Shapes.CatmullRomCurve3.new(hoop_pts), 48, 0.02, 12))
	for s in [-1, 1]:
		put.call(dark_steel, cyl.call(0.026, 0.026, 0.03, 12), s * 0.39, -0.46, -0.5) # (its feet)

	# ---- the panels: upper (main) and lower, recessed dials behind their holes, four screws round each
	var UP := {x = 0.0, y = -0.268, z = -0.645, w = 0.46, h = 0.23, tilt = -0.15}
	var LO := {x = 0.0, y = -0.47, z = -0.672, w = 0.37, h = 0.12, tilt = -0.5}
	# [panel, kind, x, y, r] in the panel's own metres (from its centre)
	var DIAL_AT := [
		[UP, "afn", -0.192, 0.03, 0.024], [UP, "speed", -0.122, 0.03, 0.04], [UP, "horizon", -0.031, 0.03, 0.041], [UP, "compass", 0.06, 0.03, 0.04], [UP, "climb", 0.15, 0.03, 0.037],
		[UP, "alt", -0.137, -0.066, 0.04], [UP, "pitch", -0.051, -0.072, 0.03], [UP, "boost", 0.033, -0.07, 0.035], [UP, "rpm", 0.123, -0.068, 0.037],
		[LO, "press", -0.135, 0.0, 0.029], [LO, "oilt", -0.068, 0.0, 0.029], [LO, "fuel", 0.004, 0.0, 0.033], [LO, "clock", 0.08, 0.0, 0.03],
	]
	var pmat := func(p: Dictionary) -> Transform3D: return M4.call(p.x, p.y, p.z, p.tilt)
	for p in [UP, LO]:
		var holes := []
		for d in DIAL_AT:
			if is_same(d[0], p):
				holes.append([d[2], d[3], d[4] + 0.003])
		var m: Transform3D = pmat.call(p)
		put_m.call(panel_paint, panel_geo(p.w, p.h, holes, 0.035 if is_same(p, UP) else 0.02), m)
		put_m.call(black, box.call(p.w - 0.01, p.h - 0.01, 0.002).translate(0, 0, -0.03), m) # (the dark behind the holes)
		for sxy in [[-1, -1], [1, -1], [-1, 1], [1, 1]]:
			put_m.call(rubber, cyl.call(0.009, 0.009, 0.016, 10).rotate_x(PI / 2).translate(sxy[0] * (p.w / 2 - 0.012), sxy[1] * (p.h / 2 - 0.012), 0.004), m) # the shock mounts
	var faces := []
	for d in DIAL_AT:
		var p: Dictionary = d[0]
		var kind: String = d[1]
		var x: float = d[2]
		var y: float = d[3]
		var r: float = d[4]
		var m: Transform3D = pmat.call(p)
		var cell := DialArt.cell_of(kind)
		var face = Geo.circle(r, 40)
		var fuv: PackedVector2Array = face.uvs
		for i in fuv.size():
			var u: Vector2 = fuv[i]
			fuv[i] = Vector2((cell.x + (u.x * 2 - 1) * CR) / AW, 1 - (cell.y - (u.y * 2 - 1) * CR) / AH)
		face.uvs = fuv
		faces.append(face.translate(x, y, -0.011).apply_transform(m))
		put_m.call(black, Geo.cylinder(r + 0.003, r + 0.003, 0.012, 32, 1, true).rotate_x(PI / 2).translate(x, y, -0.006), m) # the instrument's can in the hole
		put_m.call(black, Geo.torus(r + 0.0015, 0.0022, 6, 36).translate(x, y, -0.004), m) # its bezel ring
		for k in 4:
			var a := PI / 4 + (k * PI) / 2
			var dd := r + 0.009
			put_m.call(dark_steel, cyl.call(0.0028, 0.0028, 0.002, 8).rotate_x(PI / 2).translate(x + cos(a) * dd, y + sin(a) * dd, 0.001), m)
	if true: # the SZKK 4's box on the panel's top band, left of the sight
		var sx: float = SZKK[0]
		var sy: float = SZKK[1]
		var sw: float = SZKK[2]
		var sh: float = SZKK[3]
		var w := 0.115
		var h := w * sh / sw
		var m: Transform3D = pmat.call(UP)
		var q = Geo.plane(w, h)
		var quv: PackedVector2Array = q.uvs
		for i in quv.size():
			var u: Vector2 = quv[i]
			quv[i] = Vector2((sx + u.x * sw) / AW, 1 - (sy + (1 - u.y) * sh) / AH)
		q.uvs = quv
		faces.append(q.translate(-0.085, 0.087, 0.006).apply_transform(m))
		put_m.call(black, rbox.call(w + 0.01, h + 0.01, 0.012, 0.003).translate(-0.085, 0.087, 0.0), m)
	var dial_mesh := MeshInstance3D.new()
	dial_mesh.mesh = Geo.merge(faces.map(func(f): return tidy(f, false))).to_mesh(dial_mat)
	g.add_child(dial_mesh)
	if true: # the upper panel's small fittings: the clock's winder, toggles and lamps on the top band right of the sight
		var m: Transform3D = pmat.call(UP)
		put_m.call(black, cyl.call(0.006, 0.006, 0.014, 10).rotate_x(PI / 2).translate(0.08 + 0.022, -0.0 - 0.0, 0.007), pmat.call(LO)) # the clock's winding knob
		for k in 3:
			put_m.call(dark_steel, cyl.call(0.006, 0.006, 0.006, 10).rotate_x(PI / 2).translate(0.07 + k * 0.03, 0.094, 0.003), m); put_m.call(steel, cyl.call(0.0022, 0.003, 0.02, 6).translate(0, 0.01, 0).rotate_z(0.0).rotate_x(-0.5).translate(0.07 + k * 0.03, 0.094, 0.008), m)
		put_m.call(lamp_green, Geo.sphere(0.0055, 10, 8).translate(0.165, 0.094, 0.004), m)
		put_m.call(label_mat, label_geo(LBL.canopy, 0.1, 0.025), M4.call(-0.17, -0.17, -0.63, -0.15)) # the canopy placard, top left
	if true: # the lower panel: the fuel warning lamp, the tank selector, the fuel-grade placard
		var m: Transform3D = pmat.call(LO)
		var wl := MeshInstance3D.new()
		wl.mesh = Geo.sphere(0.008, 12, 8, 0, TAU, 0, PI / 2).rotate_x(PI / 2).apply_transform(Transform3D(Basis(), Vector3(0.132, 0.02, 0.002))).apply_transform(m).to_mesh(warn)
		g.add_child(wl)
		put_m.call(dark_steel, cyl.call(0.011, 0.011, 0.005, 16).rotate_x(PI / 2).translate(0.132, 0.02, 0.0), m)
		put_m.call(black, cyl.call(0.008, 0.008, 0.008, 12).rotate_x(PI / 2).translate(0.15, -0.025, 0.004), m) # the fuel gauge's selector: vorn / hinten
		put_m.call(steel, box.call(0.004, 0.018, 0.006).translate(0.15, -0.025, 0.01).rotate_z(0), m)
		put_m.call(label_mat, label_geo(LBL.c3, 0.07, 0.0175), m * Transform3D(Basis(), Vector3(-0.1, -0.048, 0.002)))
	# the shroud over the upper panel: a curved hood from the bulkhead back to the hoop, its lip rolled
	var hood = Geo.cylinder(0.34, 0.34, 0.16, 28, 1, true, -PI * 0.5, PI).rotate_x(PI / 2).scale(1, 0.12, 1)
	put.call(panel_paint, hood, 0, -0.158, -0.66)
	put.call(panel_paint, cyl.call(0.009, 0.009, 0.68, 8), 0, -0.158, -0.58, 0, 0, PI / 2, 1, 1, 1)
	# either side of the upper panel, under the hoop: the side panels, the magneto switch, the starter
	for s in [-1, 1]:
		put.call(panel_paint, box.call(0.15, 0.24, 0.012), s * 0.31, -0.29, -0.69, -0.1, s * 0.35, 0)
	put.call(label_mat, label_geo(LBL.magneto, 0.055, 0.055), 0.29, -0.25, -0.676, -0.1, -0.35, 0)
	put.call(bakelite, rbox.call(0.012, 0.03, 0.012, 0.004), 0.29, -0.25, -0.668, -0.1, -0.35, -0.6) # the magneto switch's key
	put.call(black, cyl.call(0.01, 0.01, 0.014, 12), -0.3, -0.24, -0.68, PI / 2 - 0.1, 0.35, 0) # the starter's button (Anlasser)
	put.call(red, cyl.call(0.007, 0.007, 0.006, 12), -0.3, -0.24, -0.672, PI / 2 - 0.1, 0.35, 0)
	put.call(label_mat, label_geo(LBL.o2flow, 0.05, 0.05), -0.3, -0.33, -0.682, -0.1, 0.35, 0) # the oxygen flow blinker
	# the centre pedestal under the lower panel: the armament switches
	put.call(panel_paint, box.call(0.12, 0.3, 0.12), 0, -0.68, -0.69)
	put.call(label_mat, label_geo(LBL.pedestal, 0.11, 0.11), 0, -0.6, -0.629, -0.15)
	for k in 3:
		put.call(dark_steel, cyl.call(0.005, 0.005, 0.006, 8), -0.035 + k * 0.035, -0.607, -0.627, PI / 2 - 0.15); put.call(steel, cyl.call(0.002, 0.0028, 0.018, 6), -0.035 + k * 0.035, -0.6, -0.62, 0.9)
	put.call(red, rbox.call(0.03, 0.012, 0.018, 0.004), 0, -0.648, -0.623) # the emergency jettison (Abwurf), under its guard

	# ---- the Revi 16B on the shroud, on the gun line: its base, the body with the lamp and dimmer, the lens
	# looking up at the reflector glass, the folded sun filter, the rubber pad
	put.call(dark_steel, box.call(0.056, 0.014, 0.07), 0, -0.155, -0.49)
	put.call(black, rbox.call(0.05, 0.075, 0.08, 0.008), 0, -0.11, -0.49)
	put.call(black, cyl.call(0.016, 0.018, 0.035, 16), 0.012, -0.135, -0.44, PI / 2) # the lamp housing, back towards you
	put.call(black, cyl.call(0.022, 0.024, 0.012, 20), 0, -0.067, -0.495) # the collimator's lens mount
	put.call(steel, cyl.call(0.008, 0.008, 0.012, 12), 0.031, -0.12, -0.47, 0, 0, PI / 2) # the dimmer
	put.call(white, box.call(0.002, 0.004, 0.006), 0.0375, -0.115, -0.47)
	put.call(rubber, rbox.call(0.044, 0.032, 0.026, 0.01), 0, -0.1, -0.438) # the crash pad
	put.call(filter, Geo.plane(0.056, 0.045), 0, -0.058, -0.535, -1.25) # the sun filter, folded down ahead
	put.call(dark_steel, cyl.call(0.0035, 0.0035, 0.058, 8), 0, -0.06, -0.513, 0, 0, PI / 2) # its hinge
	if true: # the reflector glass in its thin frame, leaning back towards you
		var rm: Transform3D = M4.call(0, -0.03, -0.493, -0.62)
		var w := 0.062
		var h := 0.058
		put_m.call(black, box.call(w + 0.004, 0.005, 0.004).translate(0, -h / 2, 0), rm) # (its foot; the glass's sides and top are bare)
		for sx in [-1, 1]:
			put_m.call(black, box.call(0.0025, h * 0.45, 0.003).translate(sx * w / 2, -h * 0.27, 0), rm)
		for sx in [-1, 1]:
			put.call(black, box.call(0.004, 0.035, 0.008), sx * 0.029, -0.06, -0.5, 0.2) # its side arms
		var reflector := MeshInstance3D.new()
		reflector.mesh = Geo.plane(w, h).apply_transform(rm).to_mesh(lens)
		reflector.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		g.add_child(reflector)
	add.call(black, Geo.tube(Shapes.CatmullRomCurve3.new([P.call(0.012, -0.135, -0.42), P.call(0.035, -0.15, -0.44), P.call(0.045, -0.152, -0.52), P.call(0.05, -0.148, -0.63)]), 12, 0.004, 6)) # its lamp's cable

	# ---- the windscreen: the armour glass between raked posts, the quarter panes back to the canopy's front arch
	var zA := -0.45 # the arch
	var fl: Vector3 = P.call(-0.2, -0.165, -0.73)
	var fr: Vector3 = P.call(0.2, -0.165, -0.73)
	var tl: Vector3 = P.call(-0.135, 0.15, zA)
	var tr: Vector3 = P.call(0.135, 0.15, zA)
	var sl: Vector3 = P.call(-(width_at(zA) - 0.02), sill + 0.005, zA)
	var sr: Vector3 = P.call(width_at(zA) - 0.02, sill + 0.005, zA)
	if true: # 50 mm of armour glass: two faces, and the green of its edges where you look through the slab edge-on
		var n := (fr - fl).cross(tl - fl).normalized()
		var d := 0.025
		var off := func(p: Vector3, k: float) -> Vector3: return p + n * k
		for k in [-d, d]:
			add.call(armour, quad_geo(off.call(fl, k), off.call(fr, k), off.call(tr, k), off.call(tl, k)))
		for ab in [[fl, fr], [fr, tr], [tr, tl], [tl, fl]]:
			add.call(armour_edge, quad_geo(off.call(ab[0], -d), off.call(ab[1], -d), off.call(ab[1], d), off.call(ab[0], d)))
	add.call(glass, quad_geo(fl, sl, tl)); add.call(glass, quad_geo(fr, tr, sr))
	var fo := Vector3(0, 0.5, -1).normalized()
	for abw in [[fl, tl, 0.034], [fr, tr, 0.034], [tl, tr, 0.03], [fl, fr, 0.03]]:
		bar.call(frame_in, abw[0], abw[1], abw[2], 0.06, fo) # the armour glass's heavy frame
	for ab in [[sl, tl], [sr, tr], [fl, sl], [fr, sr]]:
		bar.call(frame_in, ab[0], ab[1], 0.026, 0.03, P.call(0, 0, 1)) # the quarter panes' frames, the arch
	for ab in [[fl, tl], [fr, tr], [tl, tr]]:
		for k in range(1, 6):
			var p: Vector3 = ab[0].lerp(ab[1], k / 6.0)
			put.call(dark_steel, cyl.call(0.003, 0.003, 0.004, 6), p.x, p.y, p.z + 0.03, PI / 2 - 0.9) # (its bolts)

	# ---- the sliding hood: lofted from the arch back to its rear frame, frameless between
	var rear_z := 0.82
	var K := 22
	var MM := 20
	var arch_pts := [] # the arch sampled evenly along sl -> tl -> tr -> sr
	if true:
		var segs := [[sl, tl], [tl, tr], [tr, sr]]
		var lens_ := segs.map(func(ab): return ab[0].distance_to(ab[1]))
		var tot: float = lens_[0] + lens_[1] + lens_[2]
		for k in MM + 1:
			var d := (float(k) / MM) * tot
			var i := 0
			while i < 2 and d > lens_[i]:
				d -= lens_[i]
				i += 1
			arch_pts.append(segs[i][0].lerp(segs[i][1], clampf(d / lens_[i], 0, 1)))
	var hw := func(z: float) -> float: return width_at(z) - 0.02
	var hh := func(z: float) -> float:
		var k := (z - zA) / (rear_z - zA)
		return 0.15 + 0.13 * sin(minf(1, k * 2.2) * PI / 2) - (pow((k - 0.45) / 0.55, 1.4) * 0.16 if k > 0.45 else 0.0)
	var ell := func(z: float, k: int) -> Vector3:
		var a := -PI / 2 + (float(k) / MM) * PI
		return Vector3(hw.call(z) * sin(a), sill + 0.005 + (hh.call(z) - sill) * pow(cos(a), 0.75), z)
	var section := func(z: float) -> Array:
		var b := smoothstep(zA, zA + 0.3, z)
		var out := []
		for k in MM + 1:
			var a: Vector3 = arch_pts[k]
			out.append(Vector3(a.x, a.y, z).lerp(ell.call(z, k), b))
		return out
	if true:
		var pos := PackedVector3Array()
		var idx := PackedInt32Array()
		for j in K + 1:
			var z := zA + (float(j) / K) * (rear_z - zA)
			for p in section.call(z):
				pos.append(p)
			if j:
				for k in MM:
					var a := (j - 1) * (MM + 1) + k
					var b := a + MM + 1
					idx.append_array([a, b, a + 1, a + 1, b, b + 1])
		var cg = Geo.from_arrays(pos, null, null, idx)
		cg.compute_vertex_normals()
		add.call(glass, cg)
		var rear: Array = section.call(rear_z)
		for k in MM:
			bar.call(frame_out, rear[k], rear[k + 1], 0.028, 0.032, P.call(0, 0, 1)) # its rear frame
		var front2: Array = section.call(zA + 0.02)
		for k in MM:
			bar.call(frame_in, front2[k], front2[k + 1], 0.014, 0.022, P.call(0, 0, 1)) # (its front edge, over the arch)
		for s in [-1, 1]:
			bar.call(frame_in, P.call(s * hw.call(zA), sill + 0.02, zA), P.call(s * hw.call(rear_z), sill + 0.02, rear_z), 0.03, 0.026, P.call(0, 1, 0)) # its bottom frames
	# the head armour in the hood, just behind your head: a shaped plate, its padded rest, its struts
	if true:
		var s := Shapes.Shape.new()
		s.move_to(-0.15, -0.18); s.line_to(0.15, -0.18); s.line_to(0.15, 0.1); s.quadratic_curve_to(0.14, 0.2, 0, 0.21); s.quadratic_curve_to(-0.14, 0.2, -0.15, 0.1); s.close_path()
		put.call(dark_steel, Geo.extrude(s, {depth = 0.012, bevelEnabled = false, curveSegments = 10}), 0, 0.0, 0.29, -0.1)
	put.call(pad, rbox.call(0.17, 0.11, 0.05, 0.022), 0, 0.03, 0.265, -0.1) # the headrest
	for k in [-1, 0, 1]:
		put.call(leather, box.call(0.0015, 0.095, 0.002), k * 0.045, 0.03, 0.2395, -0.1) # (its stitched tucks)
	for s in [-1, 1]:
		bar.call(dark_steel, P.call(s * 0.1, 0.18, 0.31), P.call(s * 0.13, hh.call(0.4) - 0.01, 0.4), 0.014, 0.01, P.call(0, 0, 1))

	# ---- the seat and its armour, the harness, your legs
	put.call(paint, Geo.cylinder(0.22, 0.2, 0.46, 18, 1, true, -PI * 0.55, PI * 1.1).rotate_y(PI), 0, -0.74, 0.3, 0, 0, 0, 1, 1, 0.55)
	put.call(paint, box.call(0.42, 0.025, 0.4), 0, -0.98, 0.16)
	put.call(dark_steel, box.call(0.44, 0.6, 0.008), 0, -0.6, 0.42, 0.12) # the back armour (8 mm)
	for s in [-1, 1]:
		put.call(suit, Geo.capsule(0.075, 0.42, 4, 10), s * 0.12, -0.69, -0.105, -1.19) # the thighs, rising to the knees
		put.call(suit, Geo.capsule(0.06, 0.42, 4, 10), s * 0.13, -0.76, -0.565, 0.98) # the shins, down to the pedals
		put.call(leather, rbox.call(0.1, 0.09, 0.26, 0.03), s * 0.13, -0.98, -0.82, -0.35) # the boots
		bar.call(webbing, P.call(s * 0.2, -0.72, 0.15), P.call(s * 0.04, -0.62, -0.02), 0.045, 0.004, P.call(0, 1, 0.3)) # the lap straps
		bar.call(webbing, P.call(s * 0.12, -0.32, 0.12), P.call(s * 0.05, -0.6, -0.04), 0.045, 0.004, P.call(0, 0.3, -1)) # the shoulder straps, down your chest
	put.call(steel, cyl.call(0.035, 0.035, 0.012, 20), 0, -0.6, -0.04, 1.2) # the harness's quick release (Schloss)

	# ---- the rudder pedals: cast, with their cut-outs, on their arms
	var pg = pedal_geo()
	for s in [-1, 1]:
		put.call(alu, pg, s * 0.13, -0.93, -0.92, -0.45)
		put.call(alu, box.call(0.1, 0.022, 0.03), s * 0.13, -0.99, -0.88, -0.45) # the heel bar
		put.call(leather, box.call(0.1, 0.01, 0.03), s * 0.13, -0.88, -0.94, -0.45) # the toe strap
		put.call(steel, cyl.call(0.009, 0.009, 0.22, 8), s * 0.13, -0.9, -1.04, PI / 2 - 0.5) # the arm
		put.call(steel, cyl.call(0.014, 0.014, 0.05, 10), s * 0.13, -0.84, -1.13, 0, 0, PI / 2) # its pivot

	# ---- the left console: gear and flap buttons, the throttle quadrant (the Kommandogerät's lever), the
	# tailplane trim switch and indicator, the fuel cock
	var L: float = -(wall.call(-0.2) - 0.075)
	var R := -L
	var top := -0.46
	for s in [-1, 1]:
		put.call(paint, rbox.call(0.15, 0.06, 0.82, 0.008), s * (wall.call(-0.2) - 0.075), top - 0.03, -0.24) # the console's shelf
		put.call(paint, box.call(0.15, 0.3, 0.012), s * (wall.call(-0.2) - 0.075), top - 0.18, -0.65) # its front
	put.call(label_mat, label_geo(LBL.gear, 0.11, 0.11), L, top + 0.002, -0.55, -PI / 2)
	for bbm in [[-0.022, -0.586, black], [0.022, -0.586, black], [-0.03, -0.537, black], [0, -0.537, black], [0.03, -0.537, black]]:
		put.call(dark_steel, cyl.call(0.008, 0.008, 0.004, 12), L + bbm[0], top + 0.004, bbm[1]); put.call(bbm[2], cyl.call(0.006, 0.006, 0.01, 12), L + bbm[0], top + 0.009, bbm[1])
	for bm in [[-0.04, lamp_red], [-0.03, lamp_red], [0.03, lamp_green], [0.04, lamp_green]]:
		put.call(bm[1], Geo.sphere(0.0045, 8, 6), L + bm[0], top + 0.005, -0.6)
	put.call(paint, rbox.call(0.04, 0.06, 0.28, 0.006), L - 0.03, top + 0.03, -0.32) # the quadrant's housing
	put.call(label_mat, label_geo(LBL.quadrant, 0.26, 0.13), L - 0.0095, top + 0.03, -0.32, 0, PI / 2, 0, 1, 0.45, 1)
	put.call(black, box.call(0.006, 0.01, 0.24), L - 0.03, top + 0.061, -0.32) # its slot
	put.call(black, rbox.call(0.035, 0.025, 0.06), L + 0.005, top + 0.012, -0.08) # the trim switch's box
	put.call(steel, cyl.call(0.003, 0.004, 0.022, 6), L + 0.005, top + 0.03, -0.08, 0.3)
	put.call(label_mat, label_geo(LBL.trim, 0.06, 0.06), -(wall.call(-0.05) - 0.002), top + 0.09, -0.05, 0, PI / 2, 0) # the trim indicator, on the wall
	put.call(yellow, rbox.call(0.012, 0.01, 0.05, 0.003), L + 0.01, top + 0.02, 0.05, 0, 0.3, 0) # the fuel cock's lever (yellow: fuel)
	put.call(dark_steel, cyl.call(0.016, 0.016, 0.008, 16), L + 0.0, top + 0.01, 0.04)
	add.call(yellow, Geo.tube(Shapes.CatmullRomCurve3.new([P.call(L - 0.05, top - 0.05, 0.2), P.call(L - 0.05, top - 0.12, -0.2), P.call(L - 0.04, top - 0.2, -0.6)]), 16, 0.005, 6)) # the fuel line along the wall

	# ---- the right console: the breaker panel and its lid, the FuG 16Z, the oxygen, the canopy crank, the jettison
	put.call(black, rbox.call(0.13, 0.03, 0.26, 0.004), R, top + 0.004, -0.46)
	put.call(label_mat, label_geo(LBL.breakers, 0.24, 0.12), R, top + 0.0195, -0.46, -PI / 2, 0, -PI / 2)
	for j in 3:
		for i in 6: # the breakers' buttons (as the label's grid, turned along the console)
			var x := R + 0.04 - j * 0.0365
			var z := -0.46 - 0.12 + 0.0206 + i * 0.0385
			put.call(black, cyl.call(0.0065, 0.0065, 0.014, 10), x, top + 0.026, z); put.call(white, cyl.call(0.0055, 0.0055, 0.002, 10), x, top + 0.034, z)
	put.call(paint, box.call(0.004, 0.11, 0.26), R + 0.07, top + 0.07, -0.46, 0, 0, -0.35) # its lid, open against the wall
	put.call(black, rbox.call(0.11, 0.06, 0.12, 0.006), R, top + 0.03, -0.2) # the FuG 16Z control box
	put.call(label_mat, label_geo(LBL.fug, 0.11, 0.055), R, top + 0.0605, -0.2, -PI / 2, 0, -PI / 2)
	for dzr in [[-0.025, 0.012], [0.027, 0.01]]:
		put.call(bakelite, cyl.call(dzr[1], dzr[1] * 0.9, 0.014, 16), R - 0.0, top + 0.068, -0.2 + dzr[0])
	put.call(label_mat, label_geo(LBL.o2, 0.06, 0.06), wall.call(0.0) - 0.002, top + 0.1, 0.0, 0, -PI / 2, 0) # the oxygen pressure gauge, on the wall
	put.call(blue, cyl.call(0.01, 0.01, 0.03, 10), R + 0.02, top + 0.015, 0.06) # the oxygen valve (blue)
	add.call(blue, Geo.tube(Shapes.CatmullRomCurve3.new([P.call(R + 0.02, top + 0.02, 0.07), P.call(R - 0.05, top - 0.02, 0.14), P.call(R - 0.14, -0.6, 0.12)]), 12, 0.009, 8)) # the oxygen hose
	if true: # the canopy crank on the wall
		var cx: float = wall.call(0.12) - 0.03
		put.call(black, Geo.torus(0.05, 0.006, 8, 24), cx, top + 0.1, 0.12, 0, PI / 2, 0)
		for k in 3:
			put.call(black, box.call(0.006, 0.1, 0.008), cx, top + 0.1, 0.12, (k / 3.0) * PI, 0, 0)
		put.call(bakelite, cyl.call(0.009, 0.009, 0.05, 10), cx - 0.028, top + 0.13, 0.15, 0, 0, PI / 2)
	put.call(red, rbox.call(0.03, 0.014, 0.06, 0.005), R + 0.03, top + 0.12, -0.62, 0, 0, -0.5) # the canopy jettison (Notabwurf), red

	# ---- the stick (the KG 13 B grip) and the throttle, with your hands on them
	var stick := Node3D.new()
	stick.rotation_order = EULER_ORDER_XYZ
	stick.position = Vector3(0, -0.96, -0.3)
	g.add_child(stick)
	var sp := func(geo, mat: Material, x := 0.0, y := 0.0, z := 0.0, rx := 0.0) -> MeshInstance3D:
		var m := MeshInstance3D.new()
		m.mesh = geo.to_mesh(mat)
		m.rotation_order = EULER_ORDER_XYZ
		m.position = Vector3(x, y, z)
		m.rotation.x = rx
		stick.add_child(m)
		return m
	for k in 5:
		sp.call(Geo.torus(0.05 - k * 0.006, 0.012, 6, 18).rotate_x(PI / 2), rubber, 0, 0.01 + k * 0.022) # the gaiter's bellows
	sp.call(cyl.call(0.014, 0.017, 0.42, 12).translate(0, 0.21, 0), dark_steel)
	sp.call(cyl.call(0.019, 0.016, 0.03, 12), steel, 0, 0.42) # the grip's collar
	var grip := Node3D.new()
	grip.rotation_order = EULER_ORDER_XYZ
	grip.position = Vector3(0, 0.43, 0)
	grip.rotation.x = -0.18
	stick.add_child(grip)
	var gp := func(geo, mat: Material, x := 0.0, y := 0.0, z := 0.0, rx := 0.0) -> MeshInstance3D:
		var m := MeshInstance3D.new()
		m.mesh = geo.to_mesh(mat)
		m.rotation_order = EULER_ORDER_XYZ
		m.position = Vector3(x, y, z)
		m.rotation.x = rx
		grip.add_child(m)
		return m
	gp.call(Geo.capsule(0.019, 0.09, 4, 12), bakelite, 0, 0.06, 0)
	gp.call(rbox.call(0.036, 0.03, 0.05, 0.01), bakelite, 0, 0.115, -0.006) # its head
	gp.call(box.call(0.008, 0.035, 0.012), steel, 0, 0.07, -0.028, 0.2) # the trigger (the MG 131s)
	gp.call(cyl.call(0.007, 0.007, 0.008, 10), red, 0, 0.133, -0.012) # the button on top (the cannon)
	gp.call(box.call(0.024, 0.003, 0.026), steel, 0, 0.142, 0.004, -0.6) # its flip cover, open
	gp.call(cyl.call(0.006, 0.006, 0.01, 10), black, 0.0, 0.118, 0.022, PI / 2) # the bomb button, at the back
	var rh := hand(leather)
	rh.rotation_order = EULER_ORDER_XYZ
	rh.position = Vector3(0.012, 0.075, 0.02); rh.rotation = Vector3(0.6, 0, -1.45)
	grip.add_child(rh)
	var throttle := Node3D.new()
	throttle.position = Vector3(L - 0.03, top + 0.03, -0.32)
	g.add_child(throttle)
	var lever := Node3D.new()
	lever.rotation_order = EULER_ORDER_XYZ
	throttle.add_child(lever)
	var lever_bar := MeshInstance3D.new()
	lever_bar.mesh = box.call(0.008, 0.12, 0.016).translate(0, 0.06, 0).to_mesh(dark_steel)
	lever.add_child(lever_bar)
	var tgrip := MeshInstance3D.new()
	tgrip.mesh = Geo.capsule(0.019, 0.07, 4, 12).rotate_z(PI / 2 - 0.25).translate(0.03, 0.13, 0).to_mesh(bakelite)
	lever.add_child(tgrip)
	var rocker := MeshInstance3D.new()
	rocker.mesh = box.call(0.012, 0.008, 0.02).to_mesh(steel)
	rocker.position = Vector3(0.012, 0.152, 0); lever.add_child(rocker) # the thumb rocker (the propeller's pitch by hand)
	var lh := hand(leather)
	lh.rotation_order = EULER_ORDER_XYZ
	lh.position = Vector3(0.035, 0.14, 0.02); lh.rotation = Vector3(0.6, 0.35, 0.3)
	lever.add_child(lh)

	# ---- merge: one mesh per material (glass drawn after the rest)
	for mat in parts:
		var b: BaseMaterial3D = _base(mat)
		var coloured := b.vertex_color_use_as_albedo
		var list: Array = parts[mat].map(func(x): return tidy(x, coloured))
		var m := MeshInstance3D.new()
		m.mesh = Geo.merge(list).to_mesh(mat)
		if b.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
			mat.render_priority = 2 # (renderOrder 2)
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF # (the glass casts no shadow)
		g.add_child(m)

	# ---- what moves: the dials (redrawn ~15 times a second), the stick, the throttle, the lamps, the night glow
	var st := {redraw = 0.0, e = readings({})}
	art.draw(st.e)
	var update := func(s: Dictionary, dt: float) -> void:
		st.redraw -= dt
		if st.redraw <= 0:
			st.redraw = 1.0 / 15
			st.e = readings(s)
			art.draw(st.e)
			warn.emission_energy_multiplier = 1.6 if st.e.fuel < 60 else 0.0 # the rear tank's warning lamp
		stick.rotation.x = clampf(-_num(s, "stickY"), -1, 1) * 0.22
		stick.rotation.z = clampf(-_num(s, "stickX"), -1, 1) * 0.25
		lever.rotation.x = 0.5 - clampf(_num(s, "throttle"), 0, 1) * 1.0 # back to idle, forward to Start
	var night := func(k: float) -> void:
		dial_mat.emission = Color(0.62, 0.95, 0.7).linear_to_srgb() # the radium paint (Three's linear 0.62, 0.95, 0.7)
		dial_mat.emission_energy_multiplier = k * 1.5
		lamp_green.emission_energy_multiplier = 0.15 + k * 0.4
	root.set_meta("update", update)
	root.set_meta("night", night)
	# (the JS turned every shadow off here; in Godot the cockpit casts and receives them: the glass excepted)
	return root
