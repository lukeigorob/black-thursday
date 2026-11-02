extends RefCounted
# The B-17's instrument faces, drawn to the real ones: black dials with white (radium-painted)
# figures, each with its own scale: the airspeed indicator in mph, the three-pointer altimeter, the
# rate-of-climb, the dual-needle manifold pressure and tachometer gauges, the engine gauge unit
# (fuel pressure, oil pressure and oil temperature on one face), cylinder-head and carburettor air
# temperatures, fuel quantity, flap position, suction, the clock and so on. Live needles (and the
# gyro horizon's card) are separate meshes turned by cockpitb17.gd; the rest have theirs painted on.
# Every face is drawn into a canvas (src/core/canvas2d.gd) at (cx, cy) with radius r in pixels.

const INK := "#ece6d2"
const DIM := "#b9b29c"
const LUM := "#d6e0b8" # white figures, the dimmer sub-scales, radium paint

## Where on its face a needle at value v points (canvas angle, 0 = 3 o'clock, clockwise).
static func dial_angle(kind: String, v: float) -> float:
	if not SCALES.has(kind):
		return 0.0
	var s: Dictionary = SCALES[kind]
	var f: float = (v - s.min) / (s.max - s.min)
	return s.a0 + f * s.sweep

# a0: the angle of the scale's start (canvas: clockwise from 3 o'clock); sweep: its length
const _TOP := -PI / 2
const SCALES := {
	airspeed = {min = 0.0, max = 400.0, a0 = _TOP, sweep = TAU * 0.9}, # (mph, 0 at the top: the B-17's ASI goes round past 400)
	altimeter = {min = 0.0, max = 1000.0, a0 = _TOP, sweep = TAU}, # (the long hand: hundreds of feet)
	climb = {min = -6.0, max = 6.0, a0 = PI, sweep = TAU * 0.92}, # (thousands ft/min, 0 at 9 o'clock)
	manifold = {min = 10.0, max = 70.0, a0 = PI * 0.62, sweep = PI * 1.76}, # (inches of mercury)
	tach = {min = 5.0, max = 45.0, a0 = PI * 0.62, sweep = PI * 1.76}, # (RPM x 100)
	dual = {min = 0.0, max = 1.0, a0 = PI * 0.75, sweep = PI * 1.5},
	gyro = {min = 0.0, max = 360.0, a0 = _TOP, sweep = TAU},
	compass = {min = 0.0, max = 360.0, a0 = _TOP, sweep = TAU},
	clock = {min = 0.0, max = 12.0, a0 = _TOP, sweep = TAU},
	suction = {min = 0.0, max = 10.0, a0 = PI * 0.75, sweep = PI * 1.5},
	hydraulic = {min = 0.0, max = 1200.0, a0 = PI * 0.75, sweep = PI * 1.5},
	cht = {min = 0.0, max = 350.0, a0 = PI * 0.75, sweep = PI * 1.5},
	carb = {min = -50.0, max = 150.0, a0 = PI * 0.75, sweep = PI * 1.5},
	freeair = {min = -50.0, max = 50.0, a0 = PI * 0.75, sweep = PI * 1.5},
	fuel = {min = 0.0, max = 425.0, a0 = PI * 0.75, sweep = PI * 1.5},
	flaps = {min = 0.0, max = 45.0, a0 = -PI / 2, sweep = PI},
	turn = {min = -1.0, max = 1.0, a0 = PI * 1.5 - 0.6, sweep = 1.2},
	oilT = {min = 0.0, max = 100.0, a0 = PI * 0.75, sweep = PI * 1.5},
	amps = {min = 0.0, max = 300.0, a0 = PI * 0.75, sweep = PI * 1.5},
	volts = {min = 0.0, max = 30.0, a0 = PI * 0.75, sweep = PI * 1.5},
	oxygen = {min = 0.0, max = 500.0, a0 = PI * 0.75, sweep = PI * 1.5},
}

static func _arc(g, cx: float, cy: float, r: float, a0: float, a1: float, w: float, col: String) -> void:
	g.stroke_style = col; g.line_width = w; g.begin_path(); g.arc(cx, cy, r, a0, a1); g.stroke()

static func _text(g, s: String, x: float, y: float, px: float, col: String = INK, weight: String = "bold", font: String = "Arial Narrow, Arial") -> void:
	g.fill_style = col; g.font = "%s %dpx %s" % [weight, maxi(6, roundi(px)), font]; g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(s, x, y)

## Ticks round a scale: n divisions, every `major` one long, `numbers` written at the majors.
static func _scale(g, cx: float, cy: float, r: float, kind: String, n: int, major: int, numbers, opts: Dictionary = {}) -> void:
	var s: Dictionary = SCALES[kind]
	var r0: float = opts.get("r", 0.9)
	for k in n + 1:
		if s.sweep >= TAU - 1e-6 and k == n:
			break
		var a: float = s.a0 + (s.sweep * k) / n
		var big := k % major == 0
		var mid: bool = not big and opts.has("mid") and k % int(opts.mid) == 0
		g.stroke_style = INK; g.line_width = r * (0.035 if big else 0.018)
		var l := 0.15 if big else (0.1 if mid else 0.06)
		g.begin_path(); g.move_to(cx + cos(a) * r * r0, cy + sin(a) * r * r0); g.line_to(cx + cos(a) * r * (r0 - l), cy + sin(a) * r * (r0 - l)); g.stroke()
		if big and numbers != null:
			var t = numbers.call(k / major)
			if t != null:
				var nr: float = opts.get("nr", 0.6)
				_text(g, t, cx + cos(a) * r * nr, cy + sin(a) * r * nr, r * opts.get("px", 0.17))

static func _band(g, cx: float, cy: float, r: float, kind: String, v0: float, v1: float, col: String, rr: float = 0.82, w: float = 0.07) -> void:
	_arc(g, cx, cy, r * rr, dial_angle(kind, v0), dial_angle(kind, v1), r * w, col)

## A painted needle (for the gauges that aren't live).
static func needle(g, cx: float, cy: float, r: float, a: float, len: float = 0.8, w: float = 0.05, col: String = INK, tail: float = 0.18) -> void:
	g.save(); g.translate(cx, cy); g.rotate(a)
	g.fill_style = col; g.begin_path()
	g.move_to(-r * tail, -r * w * 0.8); g.line_to(r * len * 0.82, -r * w * 0.5); g.line_to(r * len, 0); g.line_to(r * len * 0.82, r * w * 0.5); g.line_to(-r * tail, r * w * 0.8)
	g.close_path(); g.fill()
	g.restore()

# (the JS's `paint` closure in drawFace)
static func _paint(g, cx: float, cy: float, r: float, live: bool, k: String, val: float, len: float, w: float, col: String = INK) -> void:
	if not live:
		needle(g, cx, cy, r, dial_angle(k, val), len, w, col)

static func _hub(g, cx: float, cy: float, r: float) -> void:
	var h = g.create_radial_gradient(cx - r * 0.03, cy - r * 0.03, 0, cx, cy, r * 0.1)
	h.add_color_stop(0, "#6a6a64"); h.add_color_stop(1, "#1a1a19")
	g.fill_style = h; g.begin_path(); g.arc(cx, cy, r * 0.09, 0, TAU); g.fill()

## One instrument face. opts.live: its needles are meshes (not painted). opts.v: the painted needles' values
## ({a, h, m}). opts.label, and per kind pair / side / what.
static func draw_face(g, cx: float, cy: float, r: float, kind: String, opts: Dictionary = {}) -> bool:
	var live: bool = opts.get("live", false)
	var v: Dictionary = opts.get("v", {})
	var label = opts.get("label")
	# the dial: matt black, very slightly lighter towards the middle (the lacquer)
	var d = g.create_radial_gradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r)
	d.add_color_stop(0, "#191a18"); d.add_color_stop(1, "#0a0a09")
	g.fill_style = d; g.begin_path(); g.arc(cx, cy, r, 0, TAU); g.fill()
	match kind:
		"airspeed":
			_band(g, cx, cy, r, kind, 100, 180, "#2f8a3a"); _band(g, cx, cy, r, kind, 180, 230, "#c9a227"); _band(g, cx, cy, r, kind, 228, 232, "#c4281c", 0.82, 0.12)
			_scale(g, cx, cy, r, kind, 80, 4, func(i): return str(i * 20) if i % 2 == 0 and i > 0 and i < 20 else null, {mid = 2, px = 0.15, nr = 0.6})
			_text(g, "AIR SPEED", cx, cy - r * 0.3, r * 0.1, DIM); _text(g, "MILES PER HOUR", cx, cy + r * 0.3, r * 0.08, DIM)
			_paint(g, cx, cy, r, live, "airspeed", v.get("a", 160.0), 0.82, 0.06)
		"altimeter":
			_scale(g, cx, cy, r, kind, 50, 5, func(i): return str(i), {px = 0.2, nr = 0.64})
			# the barometric window and its scale
			g.fill_style = "#d9d2bc"; g.fill_rect(cx + r * 0.3, cy - r * 0.07, r * 0.32, r * 0.14)
			_text(g, "29.92", cx + r * 0.46, cy, r * 0.09, "#111")
			_text(g, "ALT", cx, cy - r * 0.33, r * 0.1, DIM); _text(g, "100 FT", cx, cy + r * 0.33, r * 0.08, DIM)
			_paint(g, cx, cy, r, live, "altimeter", 0, 0.86, 0.045); _paint(g, cx, cy, r, live, "altimeter", 250, 0.6, 0.065); _paint(g, cx, cy, r, live, "altimeter", 25, 0.4, 0.09)
		"climb":
			_scale(g, cx, cy, r, kind, 48, 4, func(i): return str(absi(i - 6)), {mid = 2, px = 0.2})
			_text(g, "UP", cx - r * 0.38, cy - r * 0.38, r * 0.11, DIM); _text(g, "DOWN", cx - r * 0.36, cy + r * 0.4, r * 0.1, DIM)
			_text(g, "RATE OF CLIMB", cx + r * 0.08, cy - r * 0.2, r * 0.075, DIM); _text(g, "1000 FT PER MIN", cx + r * 0.08, cy + r * 0.2, r * 0.065, DIM)
			_paint(g, cx, cy, r, live, "climb", 0, 0.84, 0.06)
		"manifold", "tach":
			var man := kind == "manifold"
			if man:
				_band(g, cx, cy, r, kind, 25, 46, "#2f8a3a"); _band(g, cx, cy, r, kind, 46, 49, "#c4281c", 0.82, 0.1)
			else:
				_band(g, cx, cy, r, kind, 14, 25, "#2f8a3a"); _band(g, cx, cy, r, kind, 25, 28, "#c9a227"); _band(g, cx, cy, r, kind, 28, 28.6, "#c4281c", 0.82, 0.12)
			if man:
				_scale(g, cx, cy, r, kind, 60, 10, func(i): return str(10 + i * 10), {mid = 5, px = 0.15, nr = 0.62})
			else:
				_scale(g, cx, cy, r, kind, 40, 5, func(i): return str(5 + i * 5), {px = 0.15, nr = 0.62})
			_text(g, "MANIFOLD" if man else "TACHOMETER", cx, cy - r * 0.3, r * 0.085, DIM)
			_text(g, "PRESSURE" if man else "R.P.M. X 100", cx, cy - r * 0.18, r * 0.075, DIM)
			_text(g, opts.get("pair", "1  2"), cx, cy + r * 0.38, r * 0.12, INK)
			_text(g, opts.get("side", ""), cx, cy + r * 0.56, r * 0.08, DIM)
			if not live:
				_paint(g, cx, cy, r, live, kind, 31 if man else 23, 0.8, 0.05); _paint(g, cx, cy, r, live, kind, 31.5 if man else 23.2, 0.8, 0.05, "#e9c86a")
		"engine": # the engine gauge unit: fuel pressure, oil pressure (top left/right), oil temperature below
			var sub := func(x: float, y: float, rr: float, name: String, nums: Array, val: float) -> void:
				g.stroke_style = "#3a3a36"; g.line_width = r * 0.02; g.begin_path(); g.arc(x, y, rr, 0, TAU); g.stroke()
				for k in 11:
					var a: float = PI * 0.8 + (PI * 1.4 * k) / 10
					g.stroke_style = INK; g.line_width = r * (0.012 if k % 5 else 0.025); g.begin_path(); g.move_to(x + cos(a) * rr * 0.92, y + sin(a) * rr * 0.92); g.line_to(x + cos(a) * rr * (0.78 if k % 5 else 0.68), y + sin(a) * rr * (0.78 if k % 5 else 0.68)); g.stroke()
				_arc(g, x, y, rr * 0.85, PI * 0.8 + PI * 1.4 * 0.45, PI * 0.8 + PI * 1.4 * 0.75, r * 0.03, "#2f8a3a")
				_text(g, nums[0], x - rr * 0.55, y + rr * 0.5, r * 0.07); _text(g, nums[1], x + rr * 0.55, y + rr * 0.5, r * 0.07)
				_text(g, name, x, y + rr * 0.35, r * 0.065, DIM)
				needle(g, x, y, rr, PI * 0.8 + PI * 1.4 * val, 0.82, 0.08)
				g.fill_style = "#2a2a28"; g.begin_path(); g.arc(x, y, rr * 0.1, 0, TAU); g.fill()
			sub.call(cx - r * 0.42, cy - r * 0.3, r * 0.46, "FUEL", ["0", "25"], 0.62)
			sub.call(cx + r * 0.42, cy - r * 0.3, r * 0.46, "OIL", ["0", "200"], 0.57)
			sub.call(cx, cy + r * 0.42, r * 0.46, "OIL °C", ["0", "100"], 0.6)
			_text(g, "ENGINE GAUGE", cx, cy + r * 0.04, r * 0.07, DIM)
			return _finish(g, cx, cy, r, label)
		"cht", "carb", "freeair", "fuel", "suction", "hydraulic", "oilT", "amps", "volts", "oxygen":
			var N: Array = {cht = [7, func(i): return str(i * 50)], carb = [4, func(i): return str(-50 + i * 50)], freeair = [4, func(i): return str(-50 + i * 25)], fuel = [5, func(i): return str(i * 85)], suction = [5, func(i): return str(i * 2)],
				hydraulic = [6, func(i): return str(i * 2)], oilT = [5, func(i): return str(i * 20)], amps = [3, func(i): return str(i * 100)], volts = [3, func(i): return str(i * 10)], oxygen = [5, func(i): return str(i * 100)]}[kind]
			if kind == "cht":
				_band(g, cx, cy, r, kind, 150, 232, "#2f8a3a"); _band(g, cx, cy, r, kind, 232, 260, "#c4281c", 0.82, 0.1)
			if kind == "carb":
				_band(g, cx, cy, r, kind, -10, 5, "#c9a227"); _band(g, cx, cy, r, kind, 15, 38, "#2f8a3a")
			if kind == "suction":
				_band(g, cx, cy, r, kind, 3.75, 4.25, "#2f8a3a")
			if kind == "hydraulic":
				_band(g, cx, cy, r, kind, 600, 800, "#2f8a3a")
			if kind == "oxygen":
				_band(g, cx, cy, r, kind, 400, 450, "#2f8a3a")
			_scale(g, cx, cy, r, kind, N[0] * 5, 5, N[1], {px = 0.17, nr = 0.58})
			var name: String = {cht = "CYL TEMP", carb = "CARB AIR", freeair = "FREE AIR", fuel = "FUEL GALS", suction = "SUCTION", hydraulic = "HYD PRESS", oilT = "OIL TEMP", amps = "AMPERES", volts = "VOLTS", oxygen = "OXYGEN"}[kind]
			_text(g, name, cx, cy + r * 0.38, r * 0.11, DIM)
			_text(g, {cht = "°C", carb = "°C", freeair = "°C", fuel = "U.S.", suction = "IN. HG", hydraulic = "X 100", oilT = "°C", amps = "", volts = "D.C.", oxygen = "P.S.I."}[kind], cx, cy - r * 0.3, r * 0.09, DIM)
			_paint(g, cx, cy, r, live, kind, v.get("a", {cht = 195, carb = 25, freeair = -30, fuel = 300, suction = 4, hydraulic = 700, oilT = 70, amps = 150, volts = 28, oxygen = 410}[kind]), 0.78, 0.07)
		"flaps": # UP at the top, DOWN at the bottom, the needle on the right
			_scale(g, cx, cy, r, kind, 9, 9, null, {mid = 3})
			_text(g, "UP", cx, cy - r * 0.6, r * 0.2); _text(g, "DOWN", cx, cy + r * 0.6, r * 0.2)
			_text(g, "FLAP", cx - r * 0.3, cy - r * 0.12, r * 0.1, DIM); _text(g, "POSITION", cx - r * 0.3, cy + r * 0.04, r * 0.08, DIM)
			_paint(g, cx, cy, r, live, "flaps", 0, 0.78, 0.07)
		"clock":
			_scale(g, cx, cy, r, kind, 60, 5, func(i): return str(i if i else 12), {px = 0.22, nr = 0.66})
			# the elapsed-time sub-dial
			g.stroke_style = DIM; g.line_width = r * 0.015; g.begin_path(); g.arc(cx, cy - r * 0.32, r * 0.17, 0, TAU); g.stroke()
			_paint(g, cx, cy, r, live, "clock", v.get("h", 11.2), 0.5, 0.08); _paint(g, cx, cy, r, live, "clock", v.get("m", 1.4), 0.8, 0.05)
			needle(g, cx, cy, r, dial_angle("clock", 7.6), 0.85, 0.02, "#c4281c", 0.25)
		"gyro": # the directional gyro: a card seen edge-on through a window, here a drum of figures
			g.fill_style = "#050505"; g.fill_rect(cx - r * 0.8, cy - r * 0.25, r * 1.6, r * 0.5)
			if not live:
				for k in range(-2, 3):
					_text(g, ["33", "N", "3", "6", "E"][k + 2], cx + k * r * 0.32, cy, r * 0.2)
			g.stroke_style = "#e8b13a"; g.line_width = r * 0.04; g.begin_path(); g.move_to(cx, cy - r * 0.42); g.line_to(cx, cy - r * 0.25); g.stroke()
			_text(g, "DIRECTIONAL GYRO", cx, cy - r * 0.55, r * 0.08, DIM)
			g.stroke_style = "#8a8a82"; g.line_width = r * 0.03; g.stroke_rect(cx - r * 0.8, cy - r * 0.25, r * 1.6, r * 0.5)
			# the caging knob's legend
			_text(g, "CAGE · PUSH", cx, cy + r * 0.62, r * 0.08, DIM)
			return _finish(g, cx, cy, r, label)
		"horizon": # the gyro horizon: its card is a live mesh behind the mask; here the mask and the little aeroplane
			g.fill_style = "#121211"; g.begin_path(); g.arc(cx, cy, r, 0, TAU); g.arc(cx, cy, r * 0.78, 0, TAU, true); g.fill("evenodd")
			for a in [-60, -30, -20, -10, 10, 20, 30, 60]:
				var t: float = (a - 90) * PI / 180
				g.stroke_style = INK; g.line_width = r * 0.03; g.begin_path(); g.move_to(cx + cos(t) * r * 0.8, cy + sin(t) * r * 0.8); g.line_to(cx + cos(t) * r * 0.93, cy + sin(t) * r * 0.93); g.stroke()
			g.fill_style = "#e8b13a"; g.begin_path(); g.move_to(cx, cy - r * 0.93); g.line_to(cx - r * 0.06, cy - r * 0.8); g.line_to(cx + r * 0.06, cy - r * 0.8); g.fill()
			return _finish(g, cx, cy, r, label)
		"turn": # turn and bank: the needle above, the ball in its curved glass tube below
			for dd in [-1, 1]:
				g.fill_style = INK; g.fill_rect(cx + dd * r * 0.24 - r * 0.04, cy - r * 0.86, r * 0.08, r * 0.18)
			g.fill_style = INK; g.fill_rect(cx - r * 0.02, cy - r * 0.86, r * 0.04, r * 0.14)
			g.stroke_style = "#6a6a62"; g.line_width = r * 0.16; g.begin_path(); g.arc(cx, cy - r * 0.55, r * 1.05, PI * 0.37, PI * 0.63); g.stroke()
			g.stroke_style = "#050505"; g.line_width = r * 0.12; g.begin_path(); g.arc(cx, cy - r * 0.55, r * 1.05, PI * 0.37, PI * 0.63); g.stroke()
			for dd in [-1, 1]:
				var a: float = PI / 2 + dd * 0.08
				g.stroke_style = INK; g.line_width = r * 0.025; g.begin_path(); g.move_to(cx + cos(a) * r * 0.98, cy - r * 0.55 + sin(a) * r * 0.98); g.line_to(cx + cos(a) * r * 1.12, cy - r * 0.55 + sin(a) * r * 1.12); g.stroke()
			if not live:
				g.fill_style = "#111"; g.begin_path(); g.arc(cx, cy + r * 0.5, r * 0.07, 0, TAU); g.fill(); needle(g, cx, cy + r * 0.1, r, -PI / 2, 0.85, 0.05)
			_text(g, "TURN", cx - r * 0.45, cy - r * 0.15, r * 0.09, DIM); _text(g, "BANK", cx + r * 0.45, cy - r * 0.15, r * 0.09, DIM)
			return _finish(g, cx, cy, r, label)
		"compass", "radiocompass": # the fluxgate compass repeater / the radio compass: a card of headings
			var s: Dictionary = SCALES.compass
			for k in 72:
				var a: float = s.a0 + (TAU * k) / 72
				var big := k % 6 == 0
				g.stroke_style = INK; g.line_width = r * (0.03 if big else 0.015)
				g.begin_path(); g.move_to(cx + cos(a) * r * 0.9, cy + sin(a) * r * 0.9); g.line_to(cx + cos(a) * r * (0.76 if big else 0.82), cy + sin(a) * r * (0.76 if big else 0.82)); g.stroke()
				if big:
					_text(g, ["N", "3", "6", "E", "12", "15", "S", "21", "24", "W", "30", "33"][k / 6], cx + cos(a) * r * 0.62, cy + sin(a) * r * 0.62, r * 0.15)
			_text(g, "FLUX GATE" if kind == "compass" else "RADIO COMPASS", cx, cy + r * 0.25, r * 0.07, DIM)
			_paint(g, cx, cy, r, live, "compass", v.get("a", 95.0), 0.76, 0.05, INK if kind == "compass" else "#e9c86a")
		"dual": # fuel or oil pressure, two needles (the left engines' or the right's), 1-2 / 3-4
			var oil: bool = opts.get("what") == "oil"
			_band(g, cx, cy, r, "dual", 0.35 if oil else 0.5, 0.45 if oil else 0.75, "#2f8a3a")
			_scale(g, cx, cy, r, "dual", 40 if oil else 25, 5, func(i): return str(i * (40 if oil else 5)), {px = 0.16, nr = 0.6})
			_text(g, "OIL" if oil else "FUEL", cx, cy - r * 0.3, r * 0.1, DIM); _text(g, "PRESSURE", cx, cy - r * 0.18, r * 0.08, DIM)
			_text(g, opts.get("side", ""), cx, cy + r * 0.4, r * 0.08, DIM)
			needle(g, cx, cy, r, dial_angle("dual", 0.38 if oil else 0.6), 0.8, 0.05); needle(g, cx, cy, r, dial_angle("dual", 0.39 if oil else 0.62), 0.8, 0.05, "#e9c86a")
		"butterfly": # the twin-arc temperature faces: two mirrored scales, a needle swinging over each
			for s in [-1, 1]:
				for k in 11: # (the scale runs down the face's side: a tick per tenth)
					var px: float = cx + s * (r * 0.15 + k * r * 0.06)
					var py: float = cy - r * 0.7 + k * r * 0.12
					g.stroke_style = INK; g.line_width = r * (0.015 if k % 5 else 0.03)
					g.begin_path(); g.move_to(px, py); g.line_to(px + s * r * (0.08 if k % 5 else 0.14), py - r * 0.03); g.stroke()
				_arc(g, cx + s * r * 0.15, cy + r * 0.1, r * 0.55, -PI * 0.5 if s > 0 else PI * 1.5, -PI * 0.2 if s > 0 else PI * 1.2, r * 0.05, "#2f8a3a")
				needle(g, cx, cy + r * 0.55, r, -PI / 2 + s * 0.42, 0.95, 0.04)
			_text(g, opts.get("what", ""), cx, cy + r * 0.72, r * 0.1, DIM)
			_text(g, "ENG " + opts.get("pair", "1-2"), cx, cy + r * 0.86, r * 0.08, DIM)
			return _finish(g, cx, cy, r, label)
		"blinker": # the oxygen flow indicator: a white window whose lids blink open with each breath
			g.fill_style = "#d8d2bf"; g.fill_rect(cx - r * 0.6, cy - r * 0.32, r * 1.2, r * 0.5)
			g.fill_style = "#1a1a19"; g.fill_rect(cx - r * 0.6, cy - r * 0.07, r * 1.2, r * 0.05)
			_text(g, "BLINKER", cx, cy - r * 0.48, r * 0.15, "#111", "bold"); g.fill_style = "#111"
			_text(g, "OXYGEN FLOW", cx, cy + r * 0.38, r * 0.11, DIM); _text(g, "INDICATOR", cx, cy + r * 0.54, r * 0.1, DIM)
			return _finish(g, cx, cy, r, label)
		"pdi": # the pilot's direction indicator from the bombardier's Norden: one needle, L / R
			for k in range(-5, 6):
				var a: float = -PI / 2 + k * 0.12
				g.stroke_style = INK; g.line_width = r * (0.02 if k % 5 else 0.04); g.begin_path(); g.move_to(cx + cos(a) * r * 0.86, cy + r * 0.3 + sin(a) * r * 0.86); g.line_to(cx + cos(a) * r * 0.72, cy + r * 0.3 + sin(a) * r * 0.72); g.stroke()
			_text(g, "L", cx - r * 0.55, cy - r * 0.15, r * 0.18); _text(g, "R", cx + r * 0.55, cy - r * 0.15, r * 0.18)
			_text(g, "P.D.I.", cx, cy + r * 0.55, r * 0.12, DIM)
			if not live:
				needle(g, cx, cy + r * 0.3, r, -PI / 2, 0.8, 0.05)
			return _finish(g, cx, cy, r, label)
		_:
			_scale(g, cx, cy, r, "suction", 25, 5, null)
	if not live:
		_hub(g, cx, cy, r)
	return _finish(g, cx, cy, r, label)

static func _finish(g, cx: float, cy: float, r: float, label) -> bool:
	# the label plate under the bezel
	if label:
		_text(g, label, cx, cy + r * 1.33, maxf(9, r * 0.17), "#c9c2a8")
	return true
