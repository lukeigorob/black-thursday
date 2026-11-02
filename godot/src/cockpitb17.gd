extends RefCounted
# The B-17G's flight deck, built to the Pilot Training Manual's drawings and photographs of the
# surviving aircraft:
# - the main instrument panel in its three shock-mounted sections (the pilot's flight instruments, the
#   engine instruments in the middle, the co-pilot's side), each instrument drawn to the real face
#   (b17gauges.gd) in a raised black bezel with four screws, under its own glass; the needles that
#   matter move (airspeed, altitude, climb, the gyro horizon's card, the directional gyro, turn and
#   bank, manifold pressure and rpm), and the figures glow by night;
# - the switch rows along the bottom (ignition, starters, boost pumps), the four red feathering
#   buttons, the warning lights, the glare shield's padded lip with the bombardier's call light, the
#   pilot's direction indicator and the standby compass on the centre post;
# - the control columns with their canvas boots, the B-17's half wheels (the cross-bar through the
#   hub with the AAF emblem, the rim below, upright black grips at its ends), the rudder pedals;
# - the centre pedestal: the throttles (the inboard pair's bar, the outboard pair's knobs), propeller
#   and mixture levers, the turbo-supercharger boost dial, the tubular frame over the quadrant, the
#   C-1 autopilot's control panel low on its back, the trim tab wheels on its sides;
# - the seats on their rails, in olive drab with leather cushions, belts and the armour behind them;
# - the pilot's and co-pilot's side panels, quilted padding on the walls and roof, the frames round
#   the windscreen and side windows, oxygen regulators and interphone boxes.
# Everything that doesn't move is merged per material (it.add); the needles are a handful of meshes.
#
# (Godot: the canvases are Canvas2D (src/core/canvas2d.gd), drawn on the GPU a frame or two after the build;
# the bump (height) canvases become normal maps when their pixels are ready (height_to_normal). The dials'
# radium glow (the JS's onBeforeCompile with its uGlow uniform) is a small ShaderMaterial with a `glow`
# parameter. The cockpit casts and receives shadows (the web game's doesn't cast).)

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Mat := preload("res://src/core/mat.gd")
const B17Gauges := preload("res://src/b17gauges.gd")

## (The radio sets' meters, stations.gd: the older names for the faces.)
static func draw_gauge(g, cx: float, cy: float, r: float, kind: String, label) -> void:
	B17Gauges.draw_face(g, cx, cy, r, {pressure = "hydraulic", temp = "freeair", gyro = "radiocompass"}.get(kind, kind), {label = label})

const F := -0.40 # the flight deck's floor
# The panel is laid out from the B-17G maintenance manual's photograph of it (and the Pilot Training
# Manual's key): every position below is in that photograph's pixels (1930 x 749), scaled to the
# aircraft: S metres a pixel, its bottom edge at Y0.
const S := 0.00082
const PX0 := 20
const PY1 := 630
const PY0 := 80
const Y0 := 0.17
## photograph px -> bomber [x, y]
static func pm(px: float, py: float) -> Vector2:
	return Vector2(-0.77 + (px - PX0) * S, Y0 + (PY1 - py) * S)
const PANEL := {x0 = -0.77, x1 = -0.77 + 1880 * S, y0 = Y0, y1 = Y0 + (PY1 - PY0) * S, z = -8.5}
const W := 4096
const K := W / 1880.0
static var H := roundi((PY1 - PY0) * K) # texture px (K texture px per photograph px)
# its outline: straight along the bottom, up the pilot's end, the long diagonal and the shallow arch over
# the middle, the co-pilot's angled panel stepping down at the far right
const OUTLINE := [[20, 630], [20, 410], [80, 330], [200, 240], [350, 170], [500, 125], [620, 100], [800, 88], [1140, 80], [1400, 92], [1570, 100], [1580, 190], [1740, 215], [1900, 430], [1900, 630]]
const SEAMS := [610, 1140, 1578] # the joints between the pilot's section, the centre (flight), the engine section and the co-pilot's panel
const FACE_DZ := 0.008 # (the instruments' faces stand this far out of the panel's plane, in their bezels)

#
# The instruments: [px, py, radius px, kind, label, live?, extra]. 3 1/8 in. dials are r 45-50 px, 2 1/4 in. ~33.
#
const GAUGES := [
	# ---- the pilot's section: radio compass, flux gate compass, the P.D.I.; voltmeter, hydraulic pressure,
	# suction; along the bottom both pilots' oxygen blinkers and pressure gauges
	[250, 320, 45, "radiocompass", "RADIO COMPASS"], [425, 255, 45, "compass", "FLUX GATE COMPASS"], [530, 250, 42, "pdi", "PILOT'S DIRECTION", "pdi"],
	[232, 445, 32, "volts", "A.C. VOLTMETER"], [405, 450, 33, "hydraulic", "HYD. PRESS. MAIN"], [490, 450, 33, "suction", "SUCTION"],
	[255, 540, 33, "blinker", "PILOT'S OXYGEN"], [360, 540, 33, "oxygen", "PRESSURE"], [465, 540, 33, "blinker", "CO-PILOT'S OXYGEN"], [560, 540, 33, "oxygen", "PRESSURE"],
	# ---- the centre (flight) section: the directional gyro and the flight indicator above; altimeter,
	# airspeed, turn and bank, rate of climb in a row; the feathering buttons under them
	[830, 185, 42, "gyro", "DIRECTIONAL GYRO", "dg"], [970, 195, 54, "horizon", "FLIGHT INDICATOR", "horizon"],
	[690, 330, 46, "altimeter", "ALTIMETER", "alt"], [800, 335, 46, "airspeed", "AIR SPEED", "ias"], [905, 335, 46, "turn", "TURN & BANK", "turn"], [1005, 335, 46, "climb", "RATE OF CLIMB", "climb"],
	# ---- the engine section: manifold pressure over the tachometers (left engines', right engines'), the
	# flap indicator; fuel pressure, oil pressure and oil temperature in pairs; cylinder-head and carburettor air
	# temperatures along the bottom; free air temperature and the fuel gauge at the right
	[1095, 190, 43, "manifold", "MANIFOLD PRESS.", "man12", {pair = "1   2", side = "LEFT ENGINES"}], [1180, 190, 43, "manifold", "MANIFOLD PRESS.", "man34", {pair = "3   4", side = "RIGHT ENGINES"}],
	[1095, 300, 43, "tach", "TACHOMETER", "rpm12", {pair = "1   2", side = "LEFT ENGINES"}], [1180, 300, 43, "tach", "TACHOMETER", "rpm34", {pair = "3   4", side = "RIGHT ENGINES"}],
	[1180, 410, 42, "flaps", "FLAP POSITION"],
	[1270, 205, 45, "dual", "FUEL PRESS.", null, {what = "fuel", side = "LEFT ENGINES"}], [1385, 205, 45, "dual", "FUEL PRESS.", null, {what = "fuel", side = "RIGHT ENGINES"}],
	[1275, 320, 45, "dual", "OIL PRESS.", null, {what = "oil", side = "LEFT ENGINES"}], [1385, 320, 45, "dual", "OIL PRESS.", null, {what = "oil", side = "RIGHT ENGINES"}],
	[1275, 425, 45, "butterfly", "OIL TEMP.", null, {what = "OIL °C", pair = "1-2"}], [1385, 425, 45, "butterfly", "OIL TEMP.", null, {what = "OIL °C", pair = "3-4"}],
	[1180, 525, 45, "butterfly", "CYL. TEMP.", null, {what = "CYL °C", pair = "1-2"}], [1280, 525, 45, "butterfly", "CYL. TEMP.", null, {what = "CYL °C", pair = "3-4"}],
	[1390, 525, 45, "butterfly", "CARB. AIR", null, {what = "CARB °C", pair = "1-2"}], [1500, 525, 45, "butterfly", "CARB. AIR", null, {what = "CARB °C", pair = "3-4"}],
	[1500, 235, 33, "freeair", "AIR TEMP."],
]
# warning lights: [px, py, colour, label]
const LIGHTS := [
	[362, 325, "#c4281c", "HYD. PRESS. WARN"], [458, 325, "#c9a227", "BOMB DOORS"], [405, 375, "#c9a227", "BOMB RELEASE"], [490, 375, "#c4281c", "VACUUM WARN"],
	[308, 555, "#c9a227", "SUPPLY"], [510, 555, "#c9a227", "SUPPLY"],
	[735, 272, "#dfe6f0", "BEACON"], [1012, 413, "#2f8a3a", "GEAR DOWN"], [1048, 413, "#c9a227", "TAIL WHEEL"], [1082, 410, "#c4281c", "BOMBER CALL"],
]
# knobs (the instruments' setting knobs, the panel lights' rheostats): [px, py, radius px]
const KNOBS := [[383, 292, 11], [1030, 245, 13], [655, 372, 10], [830, 240, 11], [150, 445, 24], [150, 525, 24], [1120, 405, 9]]
# the feathering buttons: two and two under the flight instruments
const FEATHER := [[682, 410], [737, 410], [855, 410], [907, 410]]
# placards: [px, py, w, h, lines, dark?]
const PLACARDS := [
	[150, 397, 130, 44, ["Boeing", "FLYING FORTRESS"], true], [118, 598, 190, 58, ["WARNING", "THE INDICATED DIVING SPEED WITH NORMAL LOADS", "AND FLAPS UP SHALL NOT EXCEED 305 M.P.H.", "DO NOT FLY THE AIRPLANE WITH ANY OF THE INTERNAL", "BOMB RACKS REMOVED"], true],
	[578, 437, 44, 70, ["AIRSPEED", "TUBE", "STATIC", "PRESSURE", "SELECTOR", "VALVE"], true], [700, 195, 100, 84, ["CUTOUT FOR", "VISUAL INDICATOR", "BLIND LANDING EQUIP."], true],
	[1068, 130, 70, 58, ["WARNING", "THE FOLLOWING", "INSTRUMENTS ARE", "NOT TO BE USED", "FOR NAVIGATION"], true],
	[1660, 450, 140, 72, ["CARBURETOR", "AIR CLEANER", "FILTER \"OFF\" FOR", "TAKE-OFF AND LANDING"], true], [1640, 585, 120, 100, ["FUEL TRANSFER VALVES", "OPEN WHEN TANKS TO", "BE PUMPED ARE", "SELECTED", "MUST BE CLOSED", "EXCEPT WHEN", "TRANSFERRING"], true],
	[1500, 470, 120, 22, ["SERVICE THIS AIRPLANE WITH 100 OCTANE FUEL ONLY"], true], [1680, 300, 60, 120, ["ENG 1", "ENG 2", "ENG 3", "ENG 4", "OIL", "DILUTE"], true],
	[1810, 470, 120, 36, ["ENGINE", "STARTERS"], true], [1815, 565, 140, 84, ["FIRE EXTINGUISHER", "SELECT ENGINE · PULL"], true],
]
# toggles: [px, py, guarded?]
const TOGGLES := [[1655, 250], [1655, 285], [1655, 320], [1655, 355], [1600, 392], [1790, 395, true], [1840, 395, true], [1790, 430, true], [1840, 430, true]]

static var seed := 17
static func rnd() -> float:
	seed = (seed * 16807) % 2147483647
	return seed / 2147483647.0

# (an entry of one of the tables above, or `def` past its end: the JS's destructuring of shorter rows)
static func _at(a: Array, i: int, def = null):
	return a[i] if i < a.size() else def

## The panel: colour (worn black paint, the faces, placards), its glow by night, and a height field for the normal map.
static func _panel_textures() -> Dictionary:
	seed = 17
	var g := Canvas2D.new(W, H)
	var hg := Canvas2D.new(W / 2, H / 2)
	g.set_transform(K, 0, 0, K, -PX0 * K, -PY0 * K)
	hg.set_transform(K / 2, 0, 0, K / 2, -PX0 * K / 2, -PY0 * K / 2)
	# dull black phenolic, a little worn: flecks, scuffs lighter where hands go, the edges rubbed
	g.fill_style = "#1b1c1a"; g.fill_rect(PX0, PY0, 1880, 550)
	g.fill_style = g.create_pattern(_fleck_tile(), "repeat"); g.save(); g.scale(1 / K, 1 / K); g.fill_rect(PX0 * K, PY0 * K, 1880 * K, 550 * K); g.restore()
	for i in 40:
		var x := PX0 + rnd() * 1880
		var y := PY0 + 200 + rnd() * 350
		var gr = g.create_radial_gradient(x, y, 0, x, y, 20 + rnd() * 40)
		gr.add_color_stop(0, "rgba(120,115,100,0.07)"); gr.add_color_stop(1, "rgba(120,115,100,0)"); g.fill_style = gr; g.fill_rect(x - 60, y - 60, 120, 120)
	hg.fill_style = "#808080"; hg.fill_rect(PX0, PY0, 1880, 550)
	# the joints between the sections, and the screws round each
	for sx in SEAMS:
		g.fill_style = "#0a0a09"; g.fill_rect(sx - 2, PY0, 4, 550)
		hg.fill_style = "#303030"; hg.fill_rect(sx - 2, PY0, 4, 550)
		for y in range(150, 620, 70):
			for d in [-9, 9]:
				_screw(g, hg, sx + d, y)
	for x in range(60, 1880, 85):
		_screw(g, hg, x, 618)
	# the instruments' faces (the bezels and glass are geometry)
	for e in GAUGES:
		var px: float = e[0]
		var py: float = e[1]
		var r: float = e[2]
		var opts := {live = _at(e, 5) != null, label = e[4]}
		opts.merge(_at(e, 6, {}))
		B17Gauges.draw_face(g, px, py, r, e[3], opts)
		hg.fill_style = "#404040"; hg.begin_path(); hg.arc(px, py, r * 1.04, 0, 7); hg.fill()
	# the fuel quantity gauge: the tall oblong liquidometer, its sector scale at the top, the tank selector under it
	if true:
		var x := 1500.0
		var y := 380.0
		var w := 80.0
		var hh := 150.0
		g.fill_style = "#0e0e0d"; _round_rect(g, x - w / 2, y - hh / 2, w, hh, 30); g.fill()
		g.stroke_style = "#3c3c38"; g.line_width = 4; _round_rect(g, x - w / 2, y - hh / 2, w, hh, 30); g.stroke()
		g.fill_style = "#0a0a09"; _round_rect(g, x - w / 2 + 8, y - hh / 2 + 10, w - 16, 60, 20); g.fill()
		for k in 11:
			var a := -PI / 2 - 0.9 + k * 0.18
			g.stroke_style = "#ece6d2"; g.line_width = 1 if k % 5 else 2; g.begin_path(); g.move_to(x + cos(a) * 26, y - 30 + sin(a) * 26); g.line_to(x + cos(a) * 33, y - 30 + sin(a) * 33); g.stroke()
		g.fill_style = "#ece6d2"; g.font = "bold 9px Arial"; g.text_align = "center"; g.fill_text("FUEL QUANTITY", x, y + 4); g.fill_text("U.S. GALS.", x, y + 15)
		g.fill_style = "#ece6d2"; g.begin_path(); g.move_to(x, y - 30); g.line_to(x + 26 * cos(-PI / 2 + 0.3), y - 30 + 26 * sin(-PI / 2 + 0.3)); g.line_width = 2.5; g.stroke_style = "#ece6d2"; g.stroke()
		for ta in [["1", -2.3], ["2", -1.9], ["3", -1.2], ["4", -0.8]]:
			g.fill_text(ta[0], x + cos(ta[1]) * 24, y + 52 + sin(ta[1]) * 24)
		hg.fill_style = "#b0b0b0"; _round_rect(hg, x - w / 2, y - hh / 2, w, hh, 30); hg.fill()
	# the lights' legends, the placards
	for e in LIGHTS:
		g.fill_style = "#c9c2a8"; g.font = "bold 8px Arial Narrow, Arial"; g.text_align = "center"; g.text_baseline = "top"
		var words: PackedStringArray = (e[3] as String).split(" ")
		for i in words.size():
			g.fill_text(words[i], e[0], e[1] + 15 + i * 9)
	for e in PLACARDS:
		var px: float = e[0]
		var py: float = e[1]
		var w: float = e[2]
		var hh: float = e[3]
		var lines: Array = e[4]
		var dark: bool = e[5]
		g.fill_style = "#121211" if dark else "#c4bda4"; g.fill_rect(px - w / 2, py - hh / 2, w, hh)
		g.stroke_style = "#c9c2a8" if dark else "#6f6a5c"; g.line_width = 1.2; g.stroke_rect(px - w / 2 + 2, py - hh / 2 + 2, w - 4, hh - 4)
		var fs := minf((hh - 6) / lines.size() * 0.82, 15)
		for i in lines.size():
			g.fill_style = "#ddd6c0" if dark else "#1c1c1a"; g.font = "bold %spx Arial Narrow, Arial" % _num(fs * 1.15 if i == 0 and lines.size() > 1 else fs); g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(lines[i], px, py - hh / 2 + 3 + (hh - 6) * (i + 0.5) / lines.size(), w - 8)
		hg.fill_style = "#9a9a9a"; hg.fill_rect(px - w / 2, py - hh / 2, w, hh)
		for sp in [[px - w / 2 + 4, py - hh / 2 + 4], [px + w / 2 - 4, py + hh / 2 - 4]]:
			_screw(g, hg, sp[0], sp[1], 2.2)
	for e in [[255, 512, "PILOT'S OXYGEN"], [465, 512, "CO-PILOT'S OXYGEN"], [150, 485, "FLUORESCENT LIGHTS"], [150, 420, "PILOT'S PANEL"], [150, 555, "FLIGHT PANEL"], [795, 430, "FEATHERING SWITCHES"], [1665, 205, "ENGINE"], [1600, 410, "FILTER"]]:
		g.fill_style = "#c9c2a8"; g.font = "bold 9px Arial Narrow, Arial"; g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(e[2], e[0], e[1])
	var col := _texture(g)
	return {color = col, normal = height_to_normal(hg, 2.4)}

# Canvas2D.texture() fills the texture from a coroutine on the canvas itself, which stops if the canvas (a
# RefCounted) is freed first: the builders' canvases are local, so each is kept here until it has rendered
# (and a frame more, for the texture's fill to finish).
static var _drawing: Array = []
static func _texture(g) -> ImageTexture:
	_drawing.append(g)
	var t: ImageTexture = g.texture(true)
	g.rendered.connect(_drawn.bind(g), CONNECT_ONE_SHOT)
	return t

static var _done: Array = []
static func _drawn(g) -> void:
	_done.append(g)
	var tree := Engine.get_main_loop() as SceneTree
	if not tree.process_frame.is_connected(_forget):
		tree.process_frame.connect(_forget, CONNECT_ONE_SHOT)

static func _forget() -> void:
	for g in _done:
		_drawing.erase(g)
	_done = []

# (a CSS font size as the browser prints a number: no trailing zeros)
static func _num(v: float) -> String:
	return str(snappedf(v, 0.0001))

## The crackle finish's grain: a tile of fine light and dark flecks.
static func _fleck_tile():
	var g := Canvas2D.new(256, 256)
	var img = g.create_image_data(256, 256)
	var d: PackedByteArray = img.data
	for i in range(0, d.size(), 4):
		var v := rnd()
		if v < 0.08:
			var l := 255 if rnd() < 0.5 else 0
			d[i] = l; d[i + 1] = l; d[i + 2] = l; d[i + 3] = int(8 + rnd() * 16)
	img.data = d
	g.put_image_data(img, 0, 0)
	return g

static func _screw(g, hg, x: float, y: float, r: float = 3.2) -> void:
	g.fill_style = "#77746b"; g.begin_path(); g.arc(x, y, r, 0, 7); g.fill()
	g.stroke_style = "#2a2a28"; g.line_width = r * 0.35; g.begin_path(); g.move_to(x - r * 0.75, y - r * 0.2); g.line_to(x + r * 0.75, y + r * 0.2); g.stroke()
	hg.fill_style = "#d0d0d0"; hg.begin_path(); hg.arc(x, y, r, 0, 7); hg.fill()

static func _round_rect(g, x: float, y: float, w: float, h: float, r: float) -> void:
	g.begin_path(); g.move_to(x + r, y); g.arc_to(x + w, y, x + w, y + h, r); g.arc_to(x + w, y + h, x, y + h, r); g.arc_to(x, y + h, x, y, r); g.arc_to(x, y, x + w, y, r); g.close_path()

static func _label(g, t: String, x: float, y: float, px: float, col: String, align: String = "center") -> void:
	g.fill_style = col; g.font = "bold %spx Arial Narrow, Arial" % _num(px); g.text_align = align; g.text_baseline = "middle"; g.fill_text(t, x, y)

## A tangent-space normal map from a grey height canvas (a Canvas2D, or an Image). Returns the texture at
## once; from a Canvas2D it's filled in when the canvas's pixels are ready (it's drawn on the GPU), flat
## until then.
static func height_to_normal(canvas, strength: float = 2.0) -> ImageTexture:
	var flat := Image.create(1, 1, false, Image.FORMAT_RGBA8)
	flat.fill(Color(0.5, 0.5, 1.0))
	var tex := ImageTexture.create_from_image(flat)
	if canvas is Image:
		_fill_normal(tex, canvas, strength)
	else:
		_normal_when_ready(canvas, tex, strength)
	return tex

static func _normal_when_ready(canvas, tex: ImageTexture, strength: float) -> void:
	var img: Image = await canvas.image()
	if img != null:
		_fill_normal(tex, img, strength)

# The JS takes central differences, (h[x+1] - h[x-1]) * strength, and wraps at the edges; Godot's
# bump_map_to_normal_map (native, so fast enough for the 2048-wide panel) takes the forward difference
# with the same signs and wrapping: twice the strength gives the same slopes.
static func _fill_normal(tex: ImageTexture, src: Image, strength: float) -> void:
	var img := src.duplicate() as Image
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	img.bump_map_to_normal_map(strength * 2.0)
	img.convert(Image.FORMAT_RGBA8)
	img.generate_mipmaps()
	tex.set_image(img)

## The padding: cotton fabric over kapok batts, tube-stitched in parallel channels (the 1943 blankets,
## snapped to the frames), Berry Bros. bronze green faded towards olive. Colour and normal.
static func _quilt_textures() -> Dictionary:
	var SZ := 512
	var N := 6
	var P := SZ / float(N) # 6 channels across the tile
	# (the JS paints both into canvases with putImageData: here straight into Images)
	var d := PackedByteArray()
	d.resize(SZ * SZ * 4)
	var cd := PackedByteArray()
	cd.resize(SZ * SZ * 4)
	seed = 5
	var noise := PackedFloat32Array()
	noise.resize(SZ * SZ)
	for i in SZ * SZ:
		noise[i] = rnd()
	for y in SZ:
		var u := fmod(y / P, 1.0)
		var e := minf(u, 1 - u) # (channels run along the tile's x: lengthwise along the fuselage)
		for x in SZ:
			var lump := 0.06 * sin(float(x) / SZ * PI * 6 + floorf(y / P) * 1.7) # (the batting's not quite even)
			var ht := pow(minf(1, e / 0.5), 0.5) * (0.94 + lump)
			var n: float = noise[y * SZ + x]
			var i := (y * SZ + x) * 4
			var hv := _u8(roundf(ht * 225 + n * 12))
			d[i] = hv; d[i + 1] = hv; d[i + 2] = hv; d[i + 3] = 255
			var weave := (1.0 if (x + y) % 4 < 2 else 0.95) * (1.0 if (x - y + SZ) % 4 < 2 else 0.96) # the cotton's twill
			var shade := (0.6 + 0.4 * ht + (n - 0.5) * 0.08) * weave
			var seam := 0.5 if e < 0.02 else 1.0
			cd[i] = _u8(60 * shade * seam); cd[i + 1] = _u8(68 * shade * seam); cd[i + 2] = _u8(48 * shade * seam); cd[i + 3] = 255
			if e < 0.02 and (x % 10) < 5: # the stitching
				cd[i] = 92; cd[i + 1] = 92; cd[i + 2] = 72
	var h := Image.create_from_data(SZ, SZ, false, Image.FORMAT_RGBA8, d)
	var c := Image.create_from_data(SZ, SZ, false, Image.FORMAT_RGBA8, cd)
	c.generate_mipmaps()
	var col := ImageTexture.create_from_image(c)
	var nrm := height_to_normal(h, 7)
	return {color = col, normal = nrm}

# (a Uint8ClampedArray store: clamped, rounded)
static func _u8(v: float) -> int:
	return clampi(roundi(v), 0, 255)

## The control wheel's hub cap: Boeing's winged totem (BOEING down the totem, wings either side), aluminium on black.
static func _hub_texture() -> ImageTexture:
	var g := Canvas2D.new(256, 256)
	var rim = g.create_radial_gradient(110, 100, 20, 128, 128, 128)
	rim.add_color_stop(0, "#d9dbd6"); rim.add_color_stop(0.8, "#9a9c96"); rim.add_color_stop(1, "#55574f")
	g.fill_style = rim; g.begin_path(); g.arc(128, 128, 127, 0, 7); g.fill()
	g.fill_style = "#121212"; g.begin_path(); g.arc(128, 128, 112, 0, 7); g.fill()
	g.fill_style = "#c9cbc4"
	for s in [-1, 1]:
		for k in 6: # the wings: swept feathers
			g.begin_path(); g.move_to(128 + s * 20, 92 + k * 8); g.line_to(128 + s * (98 - k * 10), 70 + k * 12); g.line_to(128 + s * (94 - k * 10), 78 + k * 12); g.line_to(128 + s * 20, 100 + k * 8); g.close_path(); g.fill()
	g.fill_rect(110, 60, 36, 140) # the totem
	g.fill_style = "#121212"; g.font = "bold 20px Arial"; g.text_align = "center"; g.text_baseline = "middle"
	var word := "BOEING"
	for i in word.length():
		g.fill_text(word[i], 128, 72 + i * 23)
	return _texture(g)

## The C-1 autopilot's control panel: its knobs and switches, the legends round them.
static func _autopilot_texture() -> ImageTexture:
	var g := Canvas2D.new(512, 320)
	g.fill_style = "#1b1c1a"; g.fill_rect(0, 0, 512, 320)
	for i in 1600:
		g.fill_style = "rgba(255,255,255,%s)" % (0.02 + randf() * 0.03); g.fill_rect(randf() * 512, randf() * 320, 2, 1)
	g.stroke_style = "#4a4a44"; g.line_width = 4; g.stroke_rect(4, 4, 504, 312)
	_label(g, "AUTOMATIC FLIGHT CONTROL — C-1", 256, 22, 18, "#d2ccb8")
	var cols := ["AILERON", "RUDDER", "ELEVATOR"]
	for i in 3:
		var x := 100 + i * 156
		_label(g, cols[i], x, 52, 16, "#d2ccb8")
		for yt in [[110, "SENSITIVITY"], [200, "CENTERING"], [275, "TRIM"]]:
			var y: float = yt[0]
			g.stroke_style = "#d2ccb8"; g.line_width = 2; g.begin_path(); g.arc(x, y, 30, PI * 0.75, PI * 2.25); g.stroke()
			for k in 9:
				var a := PI * 0.75 + k * PI * 1.5 / 8
				g.begin_path(); g.move_to(x + cos(a) * 30, y + sin(a) * 30); g.line_to(x + cos(a) * 36, y + sin(a) * 36); g.stroke()
			_label(g, yt[1], x, y + 40, 12, "#b9b29c")
	return _texture(g)

## A data plate / placard (black on cream, or white stencil on black).
static func _placard_texture(lines: Array, w: int = 512, h: int = 128, dark: bool = false) -> ImageTexture:
	var g := Canvas2D.new(w, h)
	g.fill_style = "#161615" if dark else "#cbc4aa"; g.fill_rect(0, 0, w, h)
	g.stroke_style = "#555" if dark else "#6f6a5c"; g.line_width = 6; g.stroke_rect(3, 3, w - 6, h - 6)
	for i in lines.size():
		_label(g, lines[i], w / 2.0, (float(h) / (lines.size() + 1)) * (i + 1), minf(h / (lines.size() + 1.2), 44), "#ddd6c0" if dark else "#1c1c1a")
	return _texture(g)

## the radium figures' glow (by night): the faces' shader parameter `glow` (the JS's GLOW uniform)
static var GLOW := 0.0
# The dials' faces: the panel's paint (map, roughness 0.66, metalness 0.1, no normal map), its light figures
# glowing green by night: the web game's onBeforeCompile on a clone of the panel's material, as a shader.
# (`inside` is what cabinlook.gd's inside_light sets on a ShaderMaterial: the indirect light kept inside.)
const _FACES_SHADER := """
shader_type spatial;
uniform sampler2D map : source_color, filter_linear_mipmap_anisotropic;
uniform float glow = 0.0;
uniform float inside = 1.0;
void fragment() {
	vec3 c = texture(map, UV).rgb;
	ALBEDO = c;
	ROUGHNESS = 0.66;
	METALLIC = 0.1;
	SPECULAR = 0.5;
	EMISSION = vec3(0.45, 0.8, 0.38) * smoothstep(0.35, 0.75, dot(c, vec3(0.333))) * glow;
	AO = inside;
	AO_LIGHT_AFFECT = 0.0;
}
"""

static func _std(c, r: float = 0.7, m: float = 0.1, extra: Dictionary = {}) -> StandardMaterial3D:
	var o := {color = c, roughness = r, metalness = m}
	o.merge(extra, true)
	return Mat.standard(o)

# Dull Dark Green, the cockpit's 1943 paint; the black of the panel and the bakelite; bare and painted steel
static var M := {}
static func _materials() -> void:
	if not M.is_empty():
		return
	M = {
		panel = null, ddg = _std(0x343d2a, 0.62, 0.2), od = _std(0x4a4d33, 0.75, 0.1), black = _std(0x161716, 0.5, 0.3), bakelite = _std(0x0c0c0c, 0.32, 0.05),
		green = _std(0x55603f, 0.42, 0.35), red = _std(0x9a1d12, 0.42, 0.05), redLens = _std(0x8a1a12, 0.15, 0, {emissive = 0x300000}), steel = _std(0x8f918a, 0.32, 0.85), alu = _std(0xa7aaa3, 0.38, 0.8),
		brass = _std(0xb08a43, 0.3, 0.9), white = _std(0xd8d2be, 0.6), knobW = _std(0xc9c3b0, 0.35, 0.05), yellow = _std(0xc19a2a, 0.5),
		leather = _std(0x5a3d26, 0.55, 0.0), webbing = _std(0x6a6648, 0.9, 0.0), canvas = _std(0x8a7d5c, 0.95, 0.0), rubber = _std(0x1d1d1c, 0.85, 0),
		armour = _std(0x3d4430, 0.55, 0.5), bezel = _std(0x101010, 0.38, 0.55), screw = _std(0x6e6c66, 0.35, 0.8),
		glass = Mat.standard({color = 0x9fb0b0, roughness = 0.05, metalness = 0, transparent = true, opacity = 0.1, depthWrite = false}),
		needle = Mat.standard({color = 0xf0ebdc, roughness = 0.5, emissive = 0x96d27a, emissiveIntensity = 0}),
		needleY = Mat.standard({color = 0xe9c86a, roughness = 0.5, emissive = 0x96d27a, emissiveIntensity = 0}),
		lens = {}, pad = null, hub = null, ap = null,
	}
	M.glass.set_meta("outside", true) # (a glint of the sky: not darkened like the cabin)

# Three's BoxGeometry and CylinderGeometry, tagged with their type: the Interior's add() reads it for the worn
# edges (the JS reads geo.type)
static func _box_geo(w: float, h: float, d: float):
	var g = Geo.box(w, h, d)
	g.set_meta("type", "box")
	return g

static func _cyl_geo(rt: float, rb: float, h: float, seg: int = 32, hseg: int = 1, open: bool = false):
	var g = Geo.cylinder(rt, rb, h, seg, hseg, open)
	g.set_meta("type", "cyl")
	return g

static func _mesh(geo, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = geo.to_mesh(mat)
	mi.rotation_order = EULER_ORDER_XYZ
	return mi

## it = the Interior (add/box/rod helpers, the hull table). Returns the live parts.
static func build_b17_cockpit(it) -> Dictionary:
	_materials()
	var live := {needles = [], night = []}
	_build_panel(it, live)
	_build_glare_shield(it)
	for s in [-1, 1]:
		_build_controls(it, s)
	_build_pedestal(it)
	for s in [-1, 1]:
		_build_seat(it, s)
	for s in [-1, 1]:
		_build_side_panel(it, s)
	_build_padding(it)
	_build_frames(it)
	_build_overhead(it)
	_build_floor(it)
	it.cockpit_live = func(state: Dictionary, dt: float) -> void: _update_live(live, state, dt)
	it.cockpit_night = func(k: float) -> void: _night(live, k)
	return live

static func _night(live: Dictionary, k: float) -> void:
	for m in live.night:
		m.emission_energy_multiplier = m.get_meta("full") * k
	GLOW = 0.5 * k
	if M.get("faces"):
		M.faces.set_shader_parameter("glow", GLOW)

# ---------------------------------------------------------------------------------------------------
# the instrument panel

static func _v2s(pts: Array) -> Array:
	return pts.map(func(p): return pm(p[0], p[1]))

static func _build_panel(it, live: Dictionary) -> void:
	var z: float = PANEL.z
	if M.panel == null:
		var tex := _panel_textures()
		M.panel = Mat.standard({map = tex.color, normalMap = tex.normal, normalScale = Vector2(1.0, 1.0), roughness = 0.66, metalness = 0.1})
		M.panel.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	# the dials' faces: the same paint, but their white figures are radium paint, glowing green by night
	if not M.has("faces"):
		var sh := Shader.new()
		sh.code = _FACES_SHADER
		M.faces = ShaderMaterial.new()
		M.faces.shader = sh
		M.faces.set_shader_parameter("map", M.panel.albedo_texture)
		M.faces.set_shader_parameter("glow", GLOW)
	# the face: the panel's outline, its texture mapped by position
	var shape := Shapes.Shape.new(_v2s(OUTLINE))
	var fg = Geo.shape(shape)
	for i in fg.positions.size():
		var p: Vector3 = fg.positions[i]
		fg.uvs[i] = Vector2((p.x - PANEL.x0) / (PANEL.x1 - PANEL.x0), (p.y - PANEL.y0) / (PANEL.y1 - PANEL.y0))
	var face := _mesh(fg.translate(0, 0, z), M.panel)
	it.group.add_child(face)
	# its thickness, and the frame behind (all solid): from the outline back to the bulkhead
	it.add(M.black, Geo.extrude(shape, {depth = 0.1, bevelEnabled = false, curveSegments = 1}).translate(0, 0, z - 0.1005))
	it.box(PANEL.x0, PANEL.x1, F, PANEL.y1, z - 0.14, z, null) # (the JS pushes the Box3 onto it.boxes: the same, whatever the Interior keeps them as)
	# between the panel's arch and the windscreen's sill: the coaming, Dull Dark Green, and under the panel down to the floor the well the pedals stand in
	var sill := 0.665
	var top := _v2s(OUTLINE.slice(1, -1))
	var cpts := [Vector2(PANEL.x0 - 0.2, sill + 0.01)]
	cpts.append_array(top)
	cpts.append(Vector2(PANEL.x1 + 0.2, top[top.size() - 1].y))
	cpts.append(Vector2(PANEL.x1 + 0.2, sill + 0.01))
	it.add(M.ddg, Geo.shape(Shapes.Shape.new(cpts)).translate(0, 0, z - 0.05))
	# the glare shield's top: a deck from the coaming forward under the windscreen's foot, so looking down past the
	# panel you see it and not the nose compartment below (facing up only: the nose crew see nothing of it)
	it.add(M.ddg, Geo.plane(PANEL.x1 - PANEL.x0 + 0.4, 0.2).rotate_x(-PI / 2).translate((PANEL.x0 + PANEL.x1) / 2, sill + 0.01, z - 0.15))
	it.add(M.ddg, _box_geo(PANEL.x1 - PANEL.x0 + 0.4, PANEL.y0 - F, 0.04).translate((PANEL.x0 + PANEL.x1) / 2, (F + PANEL.y0) / 2, z - 0.12))
	# the padded roll along the arch: leather over a rubber core
	var roll := Shapes.CatmullRomCurve3.new(top.map(func(p): return Vector3(p.x, p.y + 0.012, z + 0.006)))
	it.add(M.leather, Geo.tube(roll, 80, 0.016, 10))
	# the joints between the sections: a raised strip
	for sx in SEAMS:
		var x := pm(sx, 0).x
		var yt := _top_at(x)
		it.box(x - 0.004, x + 0.004, PANEL.y0, yt, z, z + 0.004, M.black, false)
	# ---- the instruments: bezels (raised rings), the glass, setting knobs
	seed = 99
	var bez := []
	var glass := []
	var cases := []
	var zz := z + FACE_DZ
	for e in GAUGES:
		var p := pm(e[0], e[1])
		var x := p.x
		var y := p.y
		var r: float = e[2] * S
		var kind: String = e[3]
		var live_kind = _at(e, 5)
		# the instrument's face stands out in its case through the panel; the bezel's lip over the glass
		cases.append(_cyl_geo(r * 1.02, r * 1.02, FACE_DZ, 32, 1, true).rotate_x(PI / 2).translate(x, y, z + FACE_DZ / 2))
		var prof := [[r * 1.0, 0], [r * 1.12, 0], [r * 1.14, 0.004], [r * 1.1, 0.008], [r * 1.02, 0.009], [r * 0.97, 0.007]].map(func(ab): return Vector2(ab[0], ab[1]))
		bez.append(Geo.lathe(prof, 40).rotate_x(PI / 2).translate(x, y, zz))
		glass.append(Geo.circle(r * 1.0, 32).translate(x, y, zz + 0.005))
		if live_kind:
			_add_live(it, live, x, y, zz, r, kind, live_kind)
	# the face itself, raised: a disc of the panel's own texture at the instrument's depth
	var faces := []
	for e in GAUGES:
		var p := pm(e[0], e[1])
		var r: float = e[2] * S * 1.01
		faces.append(Geo.circle(r, 36).translate(p.x, p.y, zz))
	var fgeo = Geo.merge(faces)
	for i in fgeo.positions.size():
		var p: Vector3 = fgeo.positions[i]
		fgeo.uvs[i] = Vector2((p.x - PANEL.x0) / (PANEL.x1 - PANEL.x0), (p.y - PANEL.y0) / (PANEL.y1 - PANEL.y0))
	it.group.add_child(_mesh(fgeo, M.faces))
	for g in bez:
		it.add(M.bezel, g)
	for g in cases:
		it.add(M.bezel, g)
	var gm := _mesh(Geo.merge(glass), M.glass)
	gm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	gm.sorting_offset = 3 # (Three's renderOrder 3: after the other see-through things)
	it.group.add_child(gm)
	for e in KNOBS: # knurled black knobs
		var p := pm(e[0], e[1])
		var r: float = e[2] * S
		it.add(M.bakelite, _cyl_geo(r, r * 1.1, 0.014, 16).rotate_x(PI / 2).translate(p.x, p.y, z + 0.007))
		it.add(M.steel, _cyl_geo(r * 0.3, r * 0.3, 0.002, 8).rotate_x(PI / 2).translate(p.x, p.y, z + 0.0145))
	# the warning lights: jewelled lenses in chrome rims
	for e in LIGHTS:
		var p := pm(e[0], e[1])
		var x := p.x
		var y := p.y
		var col: String = e[2]
		if not M.lens.has(col):
			# (Three's Color(col).multiplyScalar(0.6) scales the linear colour)
			var c := Color.html(col).srgb_to_linear()
			c = Color(c.r * 0.6, c.g * 0.6, c.b * 0.6).linear_to_srgb()
			var lmat := _std(c, 0.12, 0, {emissive = Color.html(col), emissiveIntensity = 0})
			lmat.set_meta("full", 0.7)
			M.lens[col] = lmat
		var lm: StandardMaterial3D = M.lens[col]
		if not live.night.has(lm):
			live.night.append(lm)
		it.add(M.steel, _cyl_geo(0.0105, 0.0115, 0.012, 16).rotate_x(PI / 2).translate(x, y, z + 0.006))
		it.add(lm, Geo.sphere(0.0082, 14, 7, 0, PI * 2, 0, PI / 2).scale(1, 0.75, 1).rotate_x(PI / 2).translate(x, y, z + 0.012))
		for k in 6: # (the jewel's facets)
			var a := k * PI / 3
			it.add(lm, _box_geo(0.0015, 0.0015, 0.0015).translate(x + cos(a) * 0.004, y + sin(a) * 0.004, z + 0.0175))
	# the four feathering buttons: big round red caps in their collars, a guard bar over them
	for e in FEATHER:
		var p := pm(e[0], e[1])
		it.add(M.steel, _cyl_geo(0.019, 0.02, 0.008, 22).rotate_x(PI / 2).translate(p.x, p.y, z + 0.004))
		it.add(M.red, _cyl_geo(0.0165, 0.017, 0.014, 22).rotate_x(PI / 2).translate(p.x, p.y, z + 0.015))
		it.add(M.red, Geo.sphere(0.0165, 18, 6, 0, PI * 2, 0, PI / 2).scale(1, 0.3, 1).rotate_x(PI / 2).translate(p.x, p.y, z + 0.022))
	if true:
		var p0 := pm(660, 440)
		var x1 := pm(930, 440).x
		it.rod([p0.x, p0.y, z + 0.03], [x1, p0.y, z + 0.03], 0.004, M.steel, 8)
		for x in [p0.x, x1]:
			it.rod([x, p0.y, z], [x, p0.y, z + 0.03], 0.004, M.steel, 6)
	# the toggles on the co-pilot's panel (oil dilution, the filter, the starters in their red guards)
	for e in TOGGLES:
		var p := pm(e[0], e[1])
		var x := p.x
		var y := p.y
		it.add(M.steel, _cyl_geo(0.006, 0.006, 0.006, 10).rotate_x(PI / 2).translate(x, y, z + 0.003))
		it.add(M.steel, _cyl_geo(0.0022, 0.0035, 0.024, 8).translate(0, 0.012, 0).rotate_x(PI / 2).rotate_x(-0.45 if rnd() < 0.5 else 0.45).translate(x, y, z + 0.005))
		if _at(e, 2, false):
			for s in [-1, 1]:
				it.box(x + s * 0.01 - 0.0015, x + s * 0.01 + 0.0015, y - 0.013, y + 0.013, z, z + 0.018, M.red, false)
	# the fuel gauge's tank selector (a T-handle) and the fire extinguisher's red selector and pull handles
	if true:
		var p := pm(1500, 432)
		it.add(M.bakelite, _cyl_geo(0.012, 0.014, 0.012, 14).rotate_x(PI / 2).translate(p.x, p.y, z + 0.006)); it.add(M.bakelite, _box_geo(0.034, 0.007, 0.012).translate(p.x, p.y, z + 0.016))
	if true:
		var p := pm(1815, 540)
		it.add(M.red, _cyl_geo(0.016, 0.017, 0.012, 16).rotate_x(PI / 2).translate(p.x, p.y, z + 0.006)); it.add(M.red, _box_geo(0.036, 0.008, 0.01).translate(p.x, p.y, z + 0.016))
	for px in [1745, 1880]:
		var p := pm(px, 600)
		it.rod([p.x, p.y, z], [p.x, p.y, z + 0.03], 0.003, M.steel, 6); it.add(M.red, _box_geo(0.04, 0.01, 0.01).translate(p.x, p.y, z + 0.033))
	# two hooded fluorescent (ultraviolet) lamps clamped on the coaming over the pilot's section, aimed down at the dials
	for px in [330, 400]:
		var x := pm(px, 150).x
		var yy := _top_at(x) + 0.03
		it.rod([x, _top_at(x) + 0.005, z + 0.01], [x, yy, z + 0.03], 0.004, M.black, 6)
		it.add(M.white, Geo.capsule(0.014, 0.03, 4, 10).rotate_x(-0.9).translate(x, yy, z + 0.05))
		it.add(M.black, _cyl_geo(0.016, 0.016, 0.015, 12).rotate_x(-0.9).translate(x, yy + 0.012, z + 0.04))

## The panel's top edge (its arch) at x.
static func _top_at(x: float) -> float:
	var pts := _v2s(OUTLINE.slice(1, -1))
	for i in pts.size() - 1:
		if x >= pts[i].x and x <= pts[i + 1].x:
			var k: float = (x - pts[i].x) / maxf(1e-6, pts[i + 1].x - pts[i].x)
			return pts[i].y + (pts[i + 1].y - pts[i].y) * k
	return pts[pts.size() - 1].y

# (addLive's mk: a needle's shape, tail behind the pivot)
static func _needle_mesh(it, x: float, y: float, zz: float, r: float, len: float, w: float, mat: Material, tail: float) -> MeshInstance3D:
	var s := Shapes.Shape.new([Vector2(-r * tail, -w * 0.7), Vector2(len * 0.85, -w * 0.45), Vector2(len, 0), Vector2(len * 0.85, w * 0.45), Vector2(-r * tail, w * 0.7)])
	var m := _mesh(Geo.shape(s), mat)
	m.position = Vector3(x, y, zz + 0.002); it.group.add_child(m)
	return m

## A live needle (or the horizon's card, the gyro's drum, the turn needle and ball) on gauge (x, y).
static func _add_live(it, live: Dictionary, x: float, y: float, zz: float, r: float, kind: String, key: String) -> void:
	var mk := func(len: float, w: float, mat: Material) -> MeshInstance3D: return _needle_mesh(it, x, y, zz, r, len, w, mat, 0.2)
	var cap := func() -> void:
		var c := _mesh(Geo.circle(r * 0.09, 12), M.bezel); c.position = Vector3(x, y, zz + 0.0028); it.group.add_child(c)
	if kind == "horizon":
		# the card behind the mask: sky over earth, the horizon bar, pitch lines; turned and moved by the bank and pitch
		var g := Canvas2D.new(256, 256)
		g.fill_style = "#c9c4b2"; g.fill_rect(0, 0, 256, 128); g.fill_style = "#1d1d1b"; g.fill_rect(0, 128, 256, 128)
		g.fill_style = "#f2eee2"; g.fill_rect(0, 124, 256, 8)
		g.stroke_style = "#4a4a46"; g.line_width = 3
		for dd in [-48, -24, 24, 48]:
			g.begin_path(); g.move_to(98, 128 + dd); g.line_to(158, 128 + dd); g.stroke()
		var t := _texture(g)
		var mat := Mat.standard({map = t, roughness = 0.6, emissive = 0x96d27a, emissiveIntensity = 0, emissiveMap = t})
		mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY # (Three: emissive x emissiveMap)
		mat.texture_repeat = false # (Three's default clamp: the card's offset by the pitch)
		mat.set_meta("full", 0.25); live.night.append(mat)
		var card := _mesh(Geo.circle(r * 0.78, 32), mat)
		card.position = Vector3(x, y, zz + 0.0012); it.group.add_child(card)
		# the little aeroplane over it, fixed
		var pl := [[-0.55, 0.02], [-0.15, 0.02], [-0.08, -0.08], [0, -0.04], [0.08, -0.08], [0.15, 0.02], [0.55, 0.02], [0.55, -0.03], [-0.55, -0.03]].map(func(ab): return Vector2(ab[0] * r, ab[1] * r))
		var plane := _mesh(Geo.shape(Shapes.Shape.new(pl)), M.needleY)
		plane.position = Vector3(x, y, zz + 0.003); it.group.add_child(plane)
		live.needles.append({key = key, kind = kind, m = card, r = r})
		return
	if kind == "gyro": # the drum's figures scroll past the window: a strip texture, its offset is the heading
		var g := Canvas2D.new(1024, 64)
		g.fill_style = "#060606"; g.fill_rect(0, 0, 1024, 64)
		for k in 72:
			var px := (k / 72.0) * 1024
			g.fill_style = "#ece6d2"; g.fill_rect(px - 1, 0, 2, 10 if k % 2 else 18)
			if k % 2 == 0:
				var hd := k * 5
				_label(g, "NESW"[hd / 90] if hd % 90 == 0 else str(hd / 10), px, 40, 24, "#ece6d2")
		var t := _texture(g)
		var mat := Mat.standard({map = t, roughness = 0.6, emissive = 0x96d27a, emissiveIntensity = 0, emissiveMap = t})
		mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
		mat.uv1_scale = Vector3(0.18, 1, 1) # (repeat 0.18 across, wrapping)
		mat.set_meta("full", 0.4); live.night.append(mat)
		var strip := _mesh(Geo.plane(r * 1.56, r * 0.46), mat)
		strip.position = Vector3(x, y, zz + 0.0012); it.group.add_child(strip)
		live.needles.append({key = key, kind = kind, m = strip, tex = mat})
		return
	if kind == "turn":
		var n: MeshInstance3D = mk.call(r * 0.82, r * 0.07, M.needle); n.position.y = y - r * 0.1; n.rotation.z = PI / 2
		var ball := _mesh(Geo.circle(r * 0.07, 12), M.black)
		ball.position = Vector3(x, y + r * 0.5, zz + 0.0022); it.group.add_child(ball)
		live.needles.append({key = key, kind = kind, m = n, ball = ball, x = x, y = y, r = r})
		return
	if kind == "altimeter":
		var a: MeshInstance3D = mk.call(r * 0.86, r * 0.05, M.needle)
		var b: MeshInstance3D = mk.call(r * 0.6, r * 0.09, M.needle)
		var c: MeshInstance3D = mk.call(r * 0.4, r * 0.12, M.needle)
		c.position.z += 0.0002; b.position.z += 0.0004; a.position.z += 0.0006
		cap.call(); live.needles.append({key = key, kind = kind, m = [a, b, c]})
		return
	if kind == "manifold" or kind == "tach":
		var a: MeshInstance3D = mk.call(r * 0.8, r * 0.06, M.needle)
		var b: MeshInstance3D = mk.call(r * 0.8, r * 0.06, M.needleY); b.position.z += 0.0003
		cap.call(); live.needles.append({key = key, kind = kind, m = [a, b]})
		return
	if kind == "pdi":
		var n: MeshInstance3D = mk.call(r * 0.8, r * 0.07, M.needle); n.position.y = y - r * 0.3; live.needles.append({key = key, kind = kind, m = n})
		return
	var n: MeshInstance3D = mk.call(r * 0.82, r * 0.07, M.needle); cap.call()
	live.needles.append({key = key, kind = kind, m = n})

# canvas angles are clockwise from 3 o'clock with y down: a mesh turns anticlockwise, so it's the negative
static func _set_dial(m: Node3D, kind: String, v: float) -> void:
	m.rotation.z = -B17Gauges.dial_angle(kind, v)

static func _update_live(live: Dictionary, s: Dictionary, dt: float) -> void:
	live.t = live.get("t", 0.0) + dt
	var t: float = live.t
	for n in live.needles:
		match n.key:
			"ias": _set_dial(n.m, "airspeed", s.ias + sin(t * 1.3) * 0.6)
			"alt":
				var ft: float = s.feet
				_set_dial(n.m[0], "altimeter", fmod(ft, 1000)); _set_dial(n.m[1], "altimeter", fmod(ft / 10, 1000)); _set_dial(n.m[2], "altimeter", fmod(ft / 100, 1000))
			"climb": _set_dial(n.m, "climb", clampf(s.climb / 1000.0, -6, 6))
			"man12": _set_dial(n.m[0], "manifold", s.mp[0]); _set_dial(n.m[1], "manifold", s.mp[1])
			"man34": _set_dial(n.m[0], "manifold", s.mp[2]); _set_dial(n.m[1], "manifold", s.mp[3])
			"rpm12": _set_dial(n.m[0], "tach", s.rpm[0] / 100.0); _set_dial(n.m[1], "tach", s.rpm[1] / 100.0)
			"rpm34": _set_dial(n.m[0], "tach", s.rpm[2] / 100.0); _set_dial(n.m[1], "tach", s.rpm[3] / 100.0)
			"horizon":
				n.m.rotation.z = s.bank # (the card banks the other way to the aeroplane: seen from behind, it stays with the earth)
				# (Three's map.offset.y; Godot's v runs the other way)
				var mat: StandardMaterial3D = n.m.mesh.surface_get_material(0)
				mat.uv1_offset.y = -clampf(s.pitch * 0.8, -0.2, 0.2)
			"dg": n.tex.uv1_offset.x = fposmod((s.heading / 360.0) - 0.09 + 1, 1.0)
			"turn":
				n.m.rotation.z = PI / 2 - clampf(s.turn * 6, -0.6, 0.6)
				var sl := clampf(s.slip, -1, 1) * 0.45
				n.ball.position.x = n.x + sin(sl) * n.r * 1.05; n.ball.position.y = n.y - n.r * 0.55 - cos(sl) * n.r * 1.05 + n.r * 2.1
			"pdi": n.m.rotation.z = PI / 2 + clampf(s.get("pdi", 0.0), -0.5, 0.5)

# ---------------------------------------------------------------------------------------------------
# over the panel

static func _build_glare_shield(it) -> void:
	# the instrument box over the coaming, on the centre line at the foot of the windscreen's post: the
	# eight-day clock, the standby magnetic compass read through its window, the de-icer pressure gauge
	var z: float = PANEL.z - 0.07
	var y := 0.745
	var w := 0.3
	var h := 0.11
	if M.get("box") == null:
		M.box = Mat.standard({map = _overhead_box_texture(), roughness = 0.55, metalness = 0.15, emissive = 0xffffff, emissiveIntensity = 0})
		M.box.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	it.add(M.black, Geo.rounded_box(w + 0.02, h + 0.02, 0.07, 3, 0.012).translate(0, y, z - 0.035))
	var f := _mesh(Geo.plane(w, h), M.box); f.position = Vector3(0, y, z + 0.0005); it.group.add_child(f)
	for dx in [-0.095, 0, 0.095]:
		it.add(M.bezel, Geo.torus(0.041, 0.005, 8, 32).translate(dx, y, z + 0.003))
		it.add(M.glass, Geo.circle(0.04, 28).translate(dx, y, z + 0.006))
	it.add(M.bakelite, _cyl_geo(0.008, 0.009, 0.012, 12).rotate_x(PI / 2).translate(0, y - 0.047, z + 0.006)) # the clock's winding knob
	for s in [-1, 1]:
		it.rod([s * 0.13, y + 0.06, z - 0.03], [s * 0.05, 0.98, -8.86], 0.006, M.ddg, 6) # its brackets up to the post
	# either side on the coaming: the IFF control box on the left, a switch box on the right
	it.add(M.black, Geo.rounded_box(0.1, 0.05, 0.05, 2, 0.006).translate(-0.33, 0.69, z - 0.02))
	it.add(M.white, Geo.plane(0.06, 0.012).translate(-0.33, 0.705, z + 0.006))
	it.add(M.bakelite, _cyl_geo(0.01, 0.011, 0.012, 12).rotate_x(PI / 2).translate(-0.33, 0.685, z + 0.01))
	it.add(M.ddg, Geo.rounded_box(0.08, 0.05, 0.05, 2, 0.006).translate(0.3, 0.69, z - 0.02))
	it.add(M.steel, _cyl_geo(0.0022, 0.0035, 0.02, 6).rotate_x(PI / 2 - 0.4).translate(0.3, 0.69, z + 0.012))

## The box over the coaming: clock, magnetic compass, de-icer pressure, on black.
static func _overhead_box_texture() -> ImageTexture:
	var g := Canvas2D.new(768, 282)
	g.fill_style = "#161615"; g.fill_rect(0, 0, 768, 282)
	var r := 100.0
	var cy := 141.0
	B17Gauges.draw_face(g, 141, cy, r, "clock", {})
	B17Gauges.draw_face(g, 627, cy, r, "hydraulic", {})
	# the compass: a horizontal card read through a window, the lubber line across it
	g.fill_style = "#0a0a09"; g.begin_path(); g.arc(384, cy, r, 0, 7); g.fill()
	g.fill_style = "#d9d2bc"; g.fill_rect(384 - 80, cy - 40, 160, 80)
	for k in range(-4, 5):
		g.fill_style = "#111"; g.fill_rect(384 + k * 18 - 1, cy - 40, 2, 12 if k % 2 else 22)
	g.font = "bold 26px Arial"; g.text_align = "center"; g.text_baseline = "middle"; g.fill_style = "#111"; g.fill_text("E", 384 - 36, cy + 14); g.fill_text("12", 384 + 36, cy + 14)
	g.fill_style = "#c4281c"; g.fill_rect(383, cy - 46, 3, 92)
	g.fill_style = "#c9c2a8"; g.font = "bold 18px Arial"; g.fill_text("DE-ICER", 627, cy + 72); g.fill_text("COMPASS", 384, cy + 72)
	return _texture(g)

# ---------------------------------------------------------------------------------------------------
# the control columns, the wheels and the rudder pedals (s: -1 the pilot's, +1 the co-pilot's)

# (crew.gd puts the pilots' hands on the grips: x ± r, y hubY + 0.04; hub_y is the same, by its ported name)
const WHEEL := {hubY = 0.255, hub_y = 0.255, z = -8.09, cz = -8.3, r = 0.175}
static func _build_controls(it, s: int) -> void:
	var x := s * 0.55
	var hub_y: float = WHEEL.hubY
	var z: float = WHEEL.z
	var cz: float = WHEEL.cz
	var r: float = WHEEL.r
	# the column: a stout tube up from the floor in front of his knees (the conduit up its side, the
	# aileron lock pin in its clips), a canvas boot closing the slot in the floor round its foot
	it.add(M.ddg, _cyl_geo(0.038, 0.042, hub_y - 0.04 - (F + 0.16), 22).translate(x, (hub_y - 0.04 + F + 0.16) / 2, cz))
	it.rod([x + s * 0.045, F + 0.18, cz + 0.005], [x + s * 0.045, hub_y - 0.07, cz + 0.005], 0.007, M.ddg, 6)
	for y in [F + 0.35, F + 0.5]:
		it.add(M.steel, Geo.torus(0.041, 0.004, 6, 20).rotate_x(PI / 2).translate(x, y, cz))
	it.rod([x - s * 0.046, F + 0.33, cz + 0.01], [x - s * 0.046, F + 0.52, cz + 0.01], 0.005, M.steel, 6)
	var boot := [[0.11, 0], [0.108, 0.02], [0.092, 0.035], [0.098, 0.05], [0.08, 0.07], [0.084, 0.085], [0.066, 0.105], [0.068, 0.12], [0.052, 0.14], [0.047, 0.17], [0.042, 0.185]]
	it.add(M.canvas, Geo.lathe(boot.map(func(ab): return Vector2(ab[0], ab[1])), 22).translate(x, F, cz))
	# its head: the housing of the aileron sprocket and chain, the shaft aft out of it to the wheel
	it.add(M.ddg, Geo.rounded_box(0.11, 0.09, 0.12, 3, 0.022).translate(x, hub_y - 0.02, cz + 0.02))
	it.add(M.steel, _cyl_geo(0.019, 0.019, cz + 0.075 - (z - 0.025), 16).rotate_x(PI / 2).translate(x, hub_y, (cz + 0.075 + z - 0.025) / 2))
	it.add(M.rubber, _cyl_geo(0.026, 0.03, 0.03, 16).rotate_x(PI / 2).translate(x, hub_y, cz + 0.085))
	# the wheel: the hub, the straight cross-bar out to each side, turning up there into the grips and down
	# into the U of the rim; one spoke straight down from the hub to the rim's bottom
	it.add(M.bakelite, _cyl_geo(0.046, 0.05, 0.04, 28).rotate_x(PI / 2).translate(x, hub_y, z))
	if M.hub == null:
		M.hub = Mat.standard({map = _hub_texture(), roughness = 0.3, metalness = 0.6})
	var cap := _mesh(Geo.circle(0.042, 32), M.hub); cap.position = Vector3(x, hub_y, z + 0.0205); it.group.add_child(cap)
	it.add(M.alu, Geo.torus(0.042, 0.003, 8, 32).translate(x, hub_y, z + 0.02))
	var T := 0.0125 # the section of the bar and the rim
	it.add(M.bakelite, _cyl_geo(T, T, 2 * r, 12).rotate_z(PI / 2).translate(x, hub_y, z + 0.006))
	var rim_pts := []
	for i in 21:
		var a := PI * (i / 20.0)
		rim_pts.append(Vector3(x + cos(a) * r, hub_y - sin(a) * r * 1.02, z + 0.006))
	it.add(M.bakelite, Geo.tube(Shapes.CatmullRomCurve3.new(rim_pts), 48, T, 12))
	it.add(M.bakelite, _cyl_geo(T * 0.9, T * 0.9, r, 10).translate(x, hub_y - r / 2 - 0.02, z + 0.006))
	for d in [-1, 1]:
		it.add(M.bakelite, Geo.sphere(T * 1.15, 12, 8).translate(x + d * r, hub_y, z + 0.006)) # the corner
		# the grip: a short horn up from the corner, finger ridges, a rounded cap
		var prof := [[0.0, 0], [0.017, 0.0], [0.019, 0.015], [0.016, 0.025], [0.0195, 0.038], [0.016, 0.05], [0.0195, 0.063], [0.016, 0.074], [0.012, 0.082], [0.0, 0.085]]
		it.add(M.bakelite, Geo.lathe(prof.map(func(ab): return Vector2(ab[0], ab[1])), 18).rotate_z(-d * 0.1).translate(x + d * r, hub_y + 0.006, z + 0.006))
	# the microphone (interphone) push button, on the left of the wheel by the grip
	it.add(M.red, _cyl_geo(0.0075, 0.008, 0.012, 14).rotate_x(PI / 2).translate(x - r + 0.03, hub_y + 0.004, z + 0.02))
	it.add(M.steel, _cyl_geo(0.011, 0.011, 0.006, 14).rotate_x(PI / 2).translate(x - r + 0.03, hub_y + 0.004, z + 0.014))
	# ---- the rudder pedals: hung from the cross tube under the panel (build_pedestal), each a broad dished
	# plate on its arm, the toe brake the plate's upper part pivoting onto its master cylinder
	for d in [-1, 1]:
		var px: float = x + d * 0.15
		var pz := -8.33
		var py := F + 0.14
		it.rod([px, PEDAL_TUBE.y, PEDAL_TUBE.z], [px, py + 0.1, pz - 0.03], 0.013, M.ddg, 10)
		it.add(M.ddg, _cyl_geo(0.02, 0.02, 0.05, 12).rotate_z(PI / 2).translate(px, PEDAL_TUBE.y, PEDAL_TUBE.z)) # its clamp on the tube
		var plate = Geo.rounded_box(0.12, 0.2, 0.016, 3, 0.008)
		for i in plate.positions.size(): # (dished)
			var p: Vector3 = plate.positions[i]
			plate.positions[i] = Vector3(p.x, p.y, p.z + 0.9 * p.x * p.x)
		plate.compute_vertex_normals()
		it.add(M.ddg, plate.rotate_x(-0.42).translate(px, py, pz))
		for k in 6: # the tread
			it.add(M.rubber, _box_geo(0.1, 0.007, 0.006).translate(0, -0.075 + k * 0.03, 0.011).rotate_x(-0.42).translate(px, py, pz))
		it.add(M.steel, _cyl_geo(0.008, 0.008, 0.06, 8).rotate_x(-1.2).translate(px, py + 0.11, pz - 0.06)) # the brake's master cylinder
		it.add(M.steel, _box_geo(0.012, 0.03, 0.012).translate(px + d * 0.066, py - 0.04, pz - 0.01)) # the adjusting clip

# ---------------------------------------------------------------------------------------------------
# the centre pedestal (as in the Pilot Training Manual's figures and the wartime photographs): the upper
# pedestal's switch panel at the panel's foot, the throttle quadrant sloping down and aft from it, and
# the lower pedestal at knee height with the C-1 autopilot's panel on its back

const PEDAL_TUBE := {y = -0.02, z = -8.47}
static func _build_pedestal(it) -> void:
	var zf := -8.5
	var za := -7.84
	var xu := 0.22
	var xl := 0.15
	# the cross tube the rudder pedals hang from, right across under the panel
	it.add(M.ddg, _cyl_geo(0.019, 0.019, 1.6, 14).rotate_z(PI / 2).translate(0, PEDAL_TUBE.y, PEDAL_TUBE.z))
	for x in [-0.78, 0.78]:
		it.add(M.ddg, Geo.rounded_box(0.05, 0.08, 0.06, 2, 0.01).translate(x, PEDAL_TUBE.y, PEDAL_TUBE.z))
	# ---- the lower pedestal: knee height, solid (you go round it, to the hatch behind it)
	it.box(-xl, xl, F, -0.07, zf + 0.06, za, M.ddg)
	for x in [-xl, xl]:
		for y in [F + 0.1, F + 0.3]:
			it.add(M.steel, _cyl_geo(0.004, 0.004, 0.003, 8).rotate_z(PI / 2).translate(x, y, -8.1))
	# the C-1 autopilot (AFCE) panel on its back, facing the pilots: knobs in three rows, engaging toggles
	if M.ap == null:
		M.ap = Mat.standard({map = _autopilot_texture(), roughness = 0.55, metalness = 0.2})
	it.box(-0.11, 0.11, F + 0.07, F + 0.29, za, za + 0.03, M.black, false)
	var ap := _mesh(Geo.plane(0.21, 0.21), M.ap); ap.position = Vector3(0, F + 0.18, za + 0.0305); it.group.add_child(ap)
	for i in 3:
		for j in 3:
			var kx := -0.035 + i * 0.05
			var ky := F + 0.215 - j * 0.052
			it.add(M.bakelite, _cyl_geo(0.0095, 0.011, 0.014, 14).rotate_x(PI / 2).translate(kx, ky, za + 0.037))
			it.add(M.white, _box_geo(0.0018, 0.007, 0.002).translate(kx, ky + 0.006, za + 0.0445))
	for k in 7:
		var ky := F + 0.265 - k * 0.026
		it.add(M.steel, _cyl_geo(0.0045, 0.0045, 0.005, 8).rotate_x(PI / 2).translate(-0.085, ky, za + 0.033)); it.add(M.steel, _cyl_geo(0.0018, 0.0026, 0.016, 6).translate(0, 0.008, 0).rotate_x(PI / 2 + (0.4 if k % 3 else -0.4)).translate(-0.085, ky, za + 0.035))
	for kc in [[-0.05, M.redLens], [0.0, M.redLens], [0.05, M.redLens]]:
		it.add(kc[1], Geo.sphere(0.0045, 8, 6).translate(kc[0], F + 0.268, za + 0.034))
	# ---- the upper pedestal: a wider box at the panel's foot, its top the black switch panel tilted to the pilots
	var yt0 := 0.17
	var yt1 := 0.105
	var zt1 := -8.22 # the switch panel: from the panel's foot back and down
	it.box(-xu, xu, -0.07, yt1, zf, zt1, M.ddg)
	var tilt := atan2(yt0 - yt1, zt1 - zf)
	var sw_len := Vector2(yt0 - yt1, zt1 - zf).length()
	if M.get("sw") == null:
		M.sw = Mat.standard({map = _switch_panel_texture(), roughness = 0.6, metalness = 0.15})
		M.sw.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	var sw := _mesh(Geo.plane(2 * xu, sw_len), M.sw)
	sw.rotation.x = -PI / 2 + tilt; sw.position = Vector3(0, (yt0 + yt1) / 2 + 0.002, (zf + zt1) / 2); it.group.add_child(sw)
	it.add(M.ddg, _box_geo(2 * xu, 0.02, sw_len).rotate_x(tilt).translate(0, (yt0 + yt1) / 2 - 0.01, (zf + zt1) / 2))
	var on_top := func(u: float, v: float) -> Vector3: return Vector3(u, yt0 + (yt1 - yt0) * v + 0.004, zf + (zt1 - zf) * v) # u across, v 0 fore - 1 aft
	# the two ignition switch units (rotary, two engines each) at its front left, the boost pump and
	# fuel shut-off rows, the landing gear and flap switches at the right, the lights' switches
	for u in [-0.17, -0.1]:
		var p: Vector3 = on_top.call(u, 0.25)
		it.add(M.bakelite, _cyl_geo(0.022, 0.024, 0.012, 18).translate(p.x, p.y + 0.006, p.z)); it.add(M.bakelite, _box_geo(0.036, 0.012, 0.009).rotate_y(0.6).translate(p.x, p.y + 0.016, p.z))
	var tog := func(u: float, v: float, up: bool, red: bool) -> void:
		var p: Vector3 = on_top.call(u, v)
		it.add(M.steel, _cyl_geo(0.005, 0.005, 0.005, 10).translate(p.x, p.y + 0.002, p.z))
		it.add(M.steel, _cyl_geo(0.002, 0.003, 0.02, 6).translate(0, 0.01, 0).rotate_x(-0.45 if up else 0.45).translate(p.x, p.y + 0.004, p.z))
		if red:
			for d in [-1, 1]:
				it.box(p.x + d * 0.009 - 0.0013, p.x + d * 0.009 + 0.0013, p.y, p.y + 0.014, p.z - 0.011, p.z + 0.011, M.red, false)
	for i in 4:
		tog.call(-0.04 + i * 0.028, 0.2, i % 2 == 0, false); tog.call(-0.04 + i * 0.028, 0.55, true, true)
	tog.call(0.12, 0.25, false, true); tog.call(0.17, 0.25, true, false) # the landing gear, the flaps
	for i in 3:
		tog.call(0.1 + i * 0.035, 0.65, i != 1, false)
	for i in 4: # the cowl flap valves
		var p: Vector3 = on_top.call(-0.17 + i * 0.024, 0.75)
		it.add(M.bakelite, _box_geo(0.008, 0.016, 0.03).translate(p.x, p.y + 0.008, p.z))
	# ---- the throttle quadrant: the black face sloping down and aft from the switch panel, its slots
	var qz0 := zt1
	var qz1 := za - 0.02
	var qy0 := yt1
	var qy1 := -0.07
	var qt := atan2(qy0 - qy1, qz1 - qz0)
	var q_len := Vector2(qy0 - qy1, qz1 - qz0).length()
	it.add(M.black, _box_geo(2 * xu - 0.04, 0.012, q_len).rotate_x(qt).translate(0, (qy0 + qy1) / 2, (qz0 + qz1) / 2))
	if true: # (the body under it: a wedge, its sides the quadrant's cheeks)
		var wedge = Geo.extrude(Shapes.Shape.new([Vector2(qz0, qy0), Vector2(qz0, qy1), Vector2(qz1, qy1)]), {depth = 2 * xu - 0.04, bevelEnabled = false})
		if M.get("ddgD") == null:
			M.ddgD = M.ddg.duplicate()
			M.ddgD.cull_mode = BaseMaterial3D.CULL_DISABLED
		# (Matrix4.set(0, 0, 1, -xu + 0.02,  0, 1, 0, 0,  1, 0, 0, 0,  0, 0, 0, 1): x <- the depth, z <- the shape's x)
		it.add(M.ddgD, wedge.apply_transform(Transform3D(Basis(Vector3(0, 0, 1), Vector3(0, 1, 0), Vector3(1, 0, 0)), Vector3(-xu + 0.02, 0, 0))))
	var on_q := func(u: float, v: float) -> Vector3: return Vector3(u, qy0 + (qy1 - qy0) * v + 0.008, qz0 + (qz1 - qz0) * v) # on the quadrant's face
	var qn := Vector3(0, cos(qt), sin(qt)) # its normal, up and aft
	for i in 12:
		var u := -0.18 + i * 0.0327
		var p: Vector3 = on_q.call(u, 0.5)
		it.add(M.alu, _box_geo(0.003, 0.002, q_len * 0.8).rotate_x(qt).translate(p.x, p.y - 0.003, p.z))
	var lever := func(u: float, v: float, len: float, lean: float, knob) -> Vector3: # a lever out of its slot, leaning aft (+) or forward (-), its knob at the tip
		var p: Vector3 = on_q.call(u, v)
		var dir := qn.rotated(Vector3(1, 0, 0), -lean)
		var tip := p + dir * len
		it.rod([p.x, p.y, p.z], [tip.x, tip.y, tip.z], 0.0045, M.steel, 8)
		if knob != null:
			knob.call(tip, dir)
		return tip
	# the turbo boost selector (the G's single dial, left of the mixture levers... here at the quadrant's left)
	if true:
		var p: Vector3 = on_q.call(-0.17, 0.3)
		it.add(M.bakelite, _cyl_geo(0.028, 0.03, 0.022, 26).rotate_x(qt).translate(p.x, p.y + 0.01, p.z)); it.add(M.white, _box_geo(0.003, 0.003, 0.024).rotate_x(qt).translate(p.x, p.y + 0.022, p.z - 0.006)); it.add(M.knobW, _cyl_geo(0.034, 0.034, 0.002, 26, 1, true).rotate_x(qt).translate(p.x, p.y + 0.001, p.z))
	# the throttles: two long bar grips, the left over engines 1 and 2, the right over 3 and 4 (green, as built)
	var tips := []
	for i in 4:
		tips.append(lever.call(-0.1 + i * 0.033, 0.45, 0.15, -0.35, null))
	for ab in [[tips[0], tips[1]], [tips[2], tips[3]]]:
		var a: Vector3 = ab[0]
		var b: Vector3 = ab[1]
		it.add(M.green, _cyl_geo(0.0135, 0.0135, 0.07, 16).rotate_z(PI / 2).translate((a.x + b.x) / 2, a.y + 0.012, a.z))
	# the mixture levers: four tall levers with black knobs lettered LEAN / RICH, at the right
	for i in 4:
		lever.call(0.065 + i * 0.035, 0.4, 0.17, 0.1, func(t: Vector3, _d: Vector3) -> void: it.add(M.bakelite, Geo.rounded_box(0.022, 0.045, 0.013, 2, 0.004).translate(t.x, t.y + 0.015, t.z)))
	# the propeller levers: short, small square black knobs, low and aft
	for i in 4:
		lever.call(-0.08 + i * 0.04, 0.85, 0.06, 0.2, func(t: Vector3, _d: Vector3) -> void: it.add(M.bakelite, Geo.rounded_box(0.017, 0.017, 0.017, 2, 0.003).translate(t.x, t.y + 0.006, t.z)))
	# the locks: the throttle lock's lever on the quadrant's left side, the propeller lock on its right
	for xc in [[-xu + 0.005, M.red], [xu - 0.005, M.red]]:
		var x: float = xc[0]
		var p: Vector3 = on_q.call(x, 0.55)
		it.rod([x, p.y, p.z], [x + signf(x) * 0.02, p.y + 0.06, p.z + 0.02], 0.004, M.steel, 6); it.add(xc[1], Geo.sphere(0.01, 10, 8).translate(x + signf(x) * 0.02, p.y + 0.065, p.z + 0.022))
	# the warning placard at the quadrant's foot
	var pl := _mesh(Geo.plane(0.16, 0.04), Mat.standard({map = _placard_texture(["WARNING — THIS AIRPLANE HAS SUPERCHARGED ENGINES", "OPERATE IN ACCORDANCE WITH \"OPERATION INSTRUCTIONS\""], 768, 192, true), roughness = 0.6}))
	if true:
		var p: Vector3 = on_q.call(0, 0.96)
		pl.position = Vector3(p.x, p.y + 0.002, p.z); pl.rotation.x = -PI / 2 + qt; it.group.add_child(pl)
	# ---- the trim controls: the elevator's big knurled wheel on the lower pedestal's left side, rolling
	# fore and aft; the rudder's lying flat at the pedestal's foot under its guard
	var wheel := func(x: float, y: float, z: float, r: float, flat: bool) -> void:
		var parts := [Geo.torus(r, r * 0.11, 10, 48), _cyl_geo(r * 0.2, r * 0.2, r * 0.3, 16).rotate_x(PI / 2)]
		for k in 3:
			parts.append(_box_geo(r * 2, r * 0.12, r * 0.06).rotate_z(k * PI / 3))
		for k in 40: # the knurling
			var a := (k / 40.0) * PI * 2
			parts.append(_box_geo(r * 0.05, r * 0.07, r * 0.24).rotate_z(a).translate(cos(a) * r * 1.09, sin(a) * r * 1.09, 0))
		for p in parts:
			if flat:
				p.rotate_x(PI / 2)
			else:
				p.rotate_y(PI / 2)
			it.add(M.bakelite, p.translate(x, y, z))
	wheel.call(-xl - 0.02, F + 0.2, -8.12, 0.12, false)
	it.add(M.ddg, _cyl_geo(0.02, 0.02, 0.04, 12).rotate_z(PI / 2).translate(-xl - 0.005, F + 0.2, -8.12))
	if M.get("trimPl") == null:
		M.trimPl = Mat.standard({map = _placard_texture(["NOSE DOWN", "ELEVATOR TAB", "NOSE UP"], 256, 192, true), roughness = 0.6})
	if true:
		var m := _mesh(Geo.plane(0.07, 0.052), M.trimPl); m.position = Vector3(-xl - 0.001, F + 0.36, -8.12); m.rotation.y = -PI / 2; it.group.add_child(m)
	wheel.call(xl + 0.07, F + 0.05, -8.2, 0.08, true)
	it.add(M.ddg, Geo.torus(0.1, 0.008, 6, 20, PI).rotate_x(-PI / 2).rotate_y(PI).translate(xl + 0.07, F + 0.09, -8.2)) # its guard
	# the elevator and rudder lock on the floor at the pedestal's left, the tail wheel lock at its right
	it.rod([-xl - 0.04, F + 0.01, -7.95], [-xl - 0.05, F + 0.14, -8.05], 0.008, M.steel, 6); it.add(M.red, Geo.sphere(0.015, 10, 8).translate(-xl - 0.05, F + 0.15, -8.06))
	it.rod([xl + 0.04, F + 0.01, -7.95], [xl + 0.05, F + 0.12, -8.02], 0.008, M.steel, 6); it.add(M.bakelite, Geo.sphere(0.015, 10, 8).translate(xl + 0.05, F + 0.13, -8.03))

## The upper pedestal's switch panel: legends round its switches.
static func _switch_panel_texture() -> ImageTexture:
	var g := Canvas2D.new(768, 512)
	g.fill_style = "#181917"; g.fill_rect(0, 0, 768, 512)
	for i in 3000:
		g.fill_style = "rgba(255,255,255,%s)" % (0.02 + randf() * 0.03); g.fill_rect(randf() * 768, randf() * 512, 2, 1)
	g.stroke_style = "#4a4a44"; g.line_width = 5; g.stroke_rect(3, 3, 762, 506)
	var L := func(t: String, x: float, y: float, px: float) -> void: _label(g, t, x, y, px, "#d2ccb8")
	# (u across -0.22..0.22 -> 0..768, v fore 0 -> aft 1 -> 0..512 top to bottom)
	var X := func(u: float) -> float: return (u + 0.22) / 0.44 * 768
	var Y := func(v: float) -> float: return v * 512
	L.call("IGNITION", X.call(-0.135), Y.call(0.08), 18); L.call("1-2", X.call(-0.17), Y.call(0.4), 15); L.call("3-4", X.call(-0.1), Y.call(0.4), 15)
	L.call("FUEL BOOSTER PUMPS", X.call(0.002), Y.call(0.08), 18); L.call("FUEL SHUT-OFF VALVES", X.call(0.002), Y.call(0.45), 18)
	for i in 4:
		L.call(str(i + 1), X.call(-0.04 + i * 0.028), Y.call(0.3), 14); L.call(str(i + 1), X.call(-0.04 + i * 0.028), Y.call(0.67), 14)
	L.call("LANDING GEAR", X.call(0.12), Y.call(0.08), 15); L.call("FLAPS", X.call(0.17), Y.call(0.4), 15); L.call("UP", X.call(0.12), Y.call(0.4), 14)
	L.call("LIGHTS", X.call(0.135), Y.call(0.52), 15); L.call("COWL FLAPS", X.call(-0.135), Y.call(0.62), 15); L.call("OPEN · LOCKED · CLOSE", X.call(-0.135), Y.call(0.92), 13)
	_label(g, "RECOGNITION · LANDING", X.call(0.135), Y.call(0.82), 13, "#b9b29c")
	return _texture(g)

# ---------------------------------------------------------------------------------------------------
# the seats: tubular and sheet-aluminium buckets on their pedestals, in dark green, a seat-pack's depth;
# leather cushions; the armour plate behind each, up past his head; the adjusting handle outboard

static func _build_seat(it, s: int) -> void:
	var x := s * 0.55
	var z0 := -7.86
	var z1 := -7.34
	var top := F + 0.43 # (the crew sit at y 0.05: the cushion's top)
	for d in [-1, 1]: # the pedestal's tubes and the rails on the floor
		it.box(x + d * 0.19 - 0.015, x + d * 0.19 + 0.015, F, F + 0.025, z0 - 0.06, z1 + 0.06, M.alu, false)
		it.rod([x + d * 0.19, F + 0.025, z0 + 0.03], [x + d * 0.19, top - 0.1, z0 + 0.08], 0.017, M.ddg, 10)
		it.rod([x + d * 0.19, F + 0.025, z1 - 0.03], [x + d * 0.19, top - 0.1, z1 - 0.08], 0.017, M.ddg, 10)
		it.rod([x + d * 0.19, F + 0.14, z0 + 0.05], [x + d * 0.19, F + 0.14, z1 - 0.05], 0.012, M.ddg, 8)
		it.rod([x + d * 0.19, F + 0.025, z0 + 0.03], [x + d * 0.19, top - 0.1, z1 - 0.08], 0.01, M.ddg, 6) # (the diagonal brace)
	it.box(x - 0.24, x + 0.24, F, top - 0.05, z0 + 0.02, z1 - 0.02, null) # (solid: the seat's a seat)
	# the bucket: deep sides and a rolled lip
	it.add(M.ddg, Geo.rounded_box(0.47, 0.15, 0.5, 3, 0.03).translate(x, top - 0.09, (z0 + z1) / 2))
	for d in [-1, 1]:
		it.add(M.ddg, Geo.rounded_box(0.02, 0.2, 0.46, 2, 0.008).translate(x + d * 0.235, top + 0.03, (z0 + z1) / 2 + 0.01)) # the bucket's sides, up round his hips
	# the cushions: leather, piped, buttoned
	it.add(M.leather, Geo.rounded_box(0.43, 0.07, 0.46, 5, 0.03).translate(x, top - 0.005, (z0 + z1) / 2 - 0.01))
	it.add(M.leather, Geo.rounded_box(0.42, 0.5, 0.07, 5, 0.03).rotate_x(-0.12).translate(x, top + 0.29, z1 - 0.02))
	for dd in [[-0.1, 0.17], [0.1, 0.17], [-0.1, 0.39], [0.1, 0.39], [0, 0.28]]:
		it.add(M.rubber, Geo.sphere(0.007, 8, 6).translate(x + dd[0], top + dd[1], z1 - 0.058 + dd[1] * 0.12))
	# the back's frame, and the armour plate behind it, up past his head, its bolts
	it.add(M.ddg, Geo.rounded_box(0.47, 0.58, 0.03, 2, 0.01).rotate_x(-0.12).translate(x, top + 0.3, z1 + 0.025))
	it.add(M.armour, Geo.rounded_box(0.46, 0.78, 0.012, 2, 0.004).rotate_x(-0.1).translate(x, top + 0.42, z1 + 0.06))
	for dd in [[-0.2, 0.08], [0.2, 0.08], [-0.2, 0.76], [0.2, 0.76], [-0.2, 0.42], [0.2, 0.42]]:
		it.add(M.steel, _cyl_geo(0.008, 0.008, 0.01, 8).rotate_x(PI / 2 - 0.1).translate(x + dd[0], top + dd[1], z1 + 0.072 + dd[1] * 0.1))
	it.add(M.leather, Geo.rounded_box(0.22, 0.12, 0.05, 3, 0.02).rotate_x(-0.1).translate(x, top + 0.7, z1 + 0.01)) # the headrest pad
	it.box(x - 0.25, x + 0.25, top, top + 0.85, z1, z1 + 0.09, null) # (solid)
	# the adjusting handle on the outboard side
	var ox := x + s * 0.25
	it.rod([ox, top - 0.06, z0 + 0.15], [ox + s * 0.02, top + 0.02, z0 + 0.05], 0.006, M.steel, 6)
	it.add(M.bakelite, Geo.sphere(0.014, 10, 8).translate(ox + s * 0.02, top + 0.025, z0 + 0.045))
	# the safety belt: its two halves lying on the cushion, the buckle
	for d in [-1, 1]:
		var belt := Shapes.CatmullRomCurve3.new([Vector3(x + d * 0.22, top + 0.01, z1 - 0.08), Vector3(x + d * 0.16, top + 0.035, z1 - 0.2), Vector3(x + d * 0.05, top + 0.035, z0 + 0.12), Vector3(x + d * 0.015, top + 0.04, z0 + 0.06)])
		var b = Geo.tube(belt, 16, 0.012, 4)
		for i in b.positions.size(): # (flattened onto the cushion)
			var p: Vector3 = b.positions[i]
			b.positions[i] = Vector3(p.x, top + 0.035 + (p.y - top - 0.035) * 0.3, p.z)
		b.compute_vertex_normals()
		it.add(M.webbing, b)
	it.add(M.steel, _box_geo(0.05, 0.008, 0.035).translate(x, top + 0.043, z0 + 0.07))
	# the oxygen shut-off valve on the pilot's seat frame
	if s < 0:
		it.add(M.red, _cyl_geo(0.012, 0.012, 0.01, 12).rotate_z(PI / 2).translate(x - 0.25, F + 0.2, z0 + 0.1))

# ---------------------------------------------------------------------------------------------------
# the side panels below the windows: the pilot's (oxygen, interphone, the suit heater, the lights)
# and the co-pilot's (the turbo and cowl flap controls, the hydraulic hand pump)

static func _build_side_panel(it, s: int) -> void:
	var zA := -8.38
	var zB := -7.42
	var y0 := F + 0.18
	var y1 := F + 0.58
	var wall := func(z: float, y: float) -> float: return it.hw(z, y) - 0.012
	# a console along the wall: a sloped top with its switch plate, the box under it
	var xi: float = s * (wall.call(-7.9, y1) - 0.17)
	var xo: float = s * wall.call(-7.9, y0)
	var x0 := minf(xi, xo)
	var x1 := maxf(xi, xo)
	it.box(x0, x1, F, y0, zA, zB, M.ddg, false)
	var plate := _mesh(Geo.plane(zB - zA, 0.24), _side_panel_material(s))
	plate.rotation = Vector3(-PI / 2, 0, -PI / 2 if s < 0 else PI / 2)
	plate.position = Vector3((x0 + x1) / 2, y0 + 0.0305, (zA + zB) / 2)
	it.group.add_child(plate)
	it.add(M.ddg, _box_geo(x1 - x0, 0.03, zB - zA).translate((x0 + x1) / 2, y0 + 0.015, (zA + zB) / 2))
	seed = 41 if s > 0 else 43
	# knobs, toggles and levers on it
	var pt := func(u: float, v: float) -> Vector3: # u along (0 fore - 1 aft), v across (0 inboard - 1 outboard): a point on the sloping plate
		var zz := zA + 0.04 + u * (zB - zA - 0.08)
		var xx := lerpf(xi, xo, 0.12 + v * 0.76)
		return Vector3(xx, y0 + 0.03, zz)
	for i in 7:
		var p: Vector3 = pt.call(0.08 + i * 0.13, 0.3)
		it.add(M.steel, _cyl_geo(0.0025, 0.0035, 0.022, 6).rotate_z(s * (0.45 if rnd() < 0.5 else -0.45)).translate(p.x, p.y + 0.012, p.z)); it.add(M.steel, _cyl_geo(0.006, 0.006, 0.006, 10).translate(p.x, p.y + 0.002, p.z))
	for i in 4:
		var p: Vector3 = pt.call(0.15 + i * 0.22, 0.7)
		it.add(M.red if i % 2 else M.bakelite, _cyl_geo(0.012, 0.014, 0.018, 14).translate(p.x, p.y + 0.009, p.z))
	if s > 0: # the co-pilot's: the cowl flap levers, the hydraulic hand pump's handle along the wall
		for i in 2:
			var p: Vector3 = pt.call(0.3 + i * 0.12, 0.5)
			it.rod([p.x, p.y, p.z], [p.x, p.y + 0.09, p.z + 0.04], 0.004, M.steel, 6); it.add(M.red, Geo.sphere(0.01, 10, 8).translate(p.x, p.y + 0.093, p.z + 0.042))
		it.rod([s * wall.call(-7.3, F + 0.25) - s * 0.05, F + 0.25, -7.35], [s * wall.call(-7.0, F + 0.3) - s * 0.05, F + 0.32, -7.0], 0.009, M.steel, 8)
		it.add(M.bakelite, Geo.capsule(0.014, 0.06, 4, 8).rotate_x(PI / 2).translate(s * wall.call(-7.0, F + 0.3) - s * 0.05, F + 0.32, -6.97))
	else: # the pilot's: the emergency brake handle and the oxygen regulator's red emergency knob
		var p: Vector3 = pt.call(0.85, 0.5)
		it.rod([p.x, p.y, p.z], [p.x, p.y + 0.06, p.z], 0.006, M.steel, 6); it.add(M.red, _box_geo(0.05, 0.016, 0.02).translate(p.x, p.y + 0.065, p.z))
	# ---- on the wall over it: the oxygen regulator (A-12 demand type, the blinker and the pressure gauge),
	# the interphone jack box, the suit heater outlet
	var reg := func(zz: float, yy: float) -> void:
		var xx: float = s * wall.call(zz, yy)
		it.add(M.ddg, Geo.rounded_box(0.03, 0.14, 0.11, 2, 0.008).translate(xx - s * 0.015, yy, zz))
		it.add(M.bakelite, _cyl_geo(0.022, 0.022, 0.012, 16).rotate_z(PI / 2).translate(xx - s * 0.033, yy + 0.035, zz - 0.02)) # pressure gauge
		it.add(M.white, _cyl_geo(0.018, 0.018, 0.002, 16).rotate_z(PI / 2).translate(xx - s * 0.04, yy + 0.035, zz - 0.02))
		it.add(M.yellow, _cyl_geo(0.014, 0.014, 0.012, 14).rotate_z(PI / 2).translate(xx - s * 0.033, yy + 0.035, zz + 0.025)) # the blinker
		it.add(M.red, _box_geo(0.012, 0.02, 0.04).translate(xx - s * 0.033, yy - 0.035, zz)) # the emergency valve
		it.add(M.rubber, Geo.torus(0.014, 0.006, 6, 12, PI * 1.4).rotate_y(PI / 2).translate(xx - s * 0.035, yy - 0.075, zz + 0.02)) # the hose's start
	reg.call(-7.6, F + 0.75)
	var jx: float = s * wall.call(-7.95, F + 0.75)
	it.add(M.black, Geo.rounded_box(0.03, 0.08, 0.1, 2, 0.006).translate(jx - s * 0.015, F + 0.75, -7.98)) # the interphone jack box
	it.add(M.bakelite, _cyl_geo(0.012, 0.013, 0.014, 12).rotate_z(PI / 2).translate(jx - s * 0.033, F + 0.76, -7.98))
	it.add(M.steel, _cyl_geo(0.0045, 0.0045, 0.014, 8).rotate_z(PI / 2).translate(jx - s * 0.033, F + 0.725, -7.96))

static func _side_panel_material(s: int) -> StandardMaterial3D:
	var g := Canvas2D.new(1024, 256)
	g.fill_style = "#1b1c1a"; g.fill_rect(0, 0, 1024, 256)
	for i in 3000:
		g.fill_style = "rgba(255,255,255,%s)" % (0.02 + randf() * 0.03); g.fill_rect(randf() * 1024, randf() * 256, 2, 1)
	g.stroke_style = "#3c3c38"; g.line_width = 6; g.stroke_rect(3, 3, 1018, 250)
	var legends := ["LANDING LIGHTS", "PASSING LIGHT", "POSITION", "FORMATION", "RECOGNITION", "PITOT HEAT", "SUIT HEAT"] if s < 0 else ["COWL FLAPS", "DE-ICER", "PROP ANTI-ICE", "INVERTERS", "BOMB DOOR", "WING FLAPS", "TAIL WHEEL"]
	for i in legends.size():
		_label(g, legends[i], 70 + i * 135, 80, 20, "#d2ccb8")
	_label(g, "PILOT'S CONTROL PANEL" if s < 0 else "CO-PILOT'S CONTROL PANEL", 512, 230, 22, "#b9b29c")
	for i in 4:
		_label(g, ["RHEOSTAT", "OXYGEN", "INTERPHONE", "EMERG"][i] if s < 0 else ["LEFT", "RIGHT", "OPEN", "CLOSED"][i], 140 + i * 230, 170, 18, "#b9b29c")
	var m := Mat.standard({map = _texture(g), roughness = 0.6, metalness = 0.2})
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m

# ---------------------------------------------------------------------------------------------------
# the quilted padding on the walls (under the side windows, behind the seats) and the roof

static func _build_padding(it) -> void:
	if M.pad == null:
		var q := _quilt_textures()
		M.pad = Mat.standard({map = q.color, normalMap = q.normal, normalScale = Vector2(1.2, 1.2), roughness = 0.58, metalness = 0.05})
		M.pad.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC # (and repeating, Godot's default)
	var TILE := 0.48 # m per texture tile (4 diamonds: 12 cm each)
	# a padded sheet over the hull between z0 and z1 and heights y0 to y1 on one side, inset from the skin
	var sheet := func(s: int, z0: float, z1: float, y0: float, y1: float, inset: float, nz: int, ny: int) -> void:
		var pos := PackedVector3Array()
		var uv := PackedVector2Array()
		var idx := PackedInt32Array()
		for i in nz + 1:
			for j in ny + 1:
				var z := z0 + (z1 - z0) * (float(i) / nz)
				var y := y0 + (y1 - y0) * (float(j) / ny)
				var x: float = s * maxf(0.02, it.hw_smooth(z, y) - inset)
				pos.append(Vector3(x, y, z)); uv.append(Vector2(z / TILE, y / TILE))
		for i in nz:
			for j in ny:
				var a := i * (ny + 1) + j
				var b := a + ny + 1
				if s < 0:
					idx.append_array([a, b, a + 1, b, b + 1, a + 1])
				else:
					idx.append_array([a, a + 1, b, b, a + 1, b + 1])
		var g = Geo.from_arrays(pos, null, uv, idx)
		g.compute_vertex_normals()
		it.add(M.pad, g)
		# the piping round its edges
		var edge := func(pts: Array) -> void:
			var v3 := pts.map(func(p): return Vector3(s * maxf(0.02, it.hw_smooth(p[0], p[1]) - inset + 0.004), p[1], p[0]))
			it.add(M.rubber, Geo.tube(Shapes.CatmullRomCurve3.new(v3), pts.size() * 3, 0.008, 6))
		var along := func(y: float) -> Array:
			var a := []
			for k in 8:
				a.append([z0 + (z1 - z0) * k / 7.0, y])
			return a
		var up := func(z: float) -> Array:
			var a := []
			for k in 6:
				a.append([z, y0 + (y1 - y0) * k / 5.0])
			return a
		edge.call(along.call(y0)); edge.call(along.call(y1)); edge.call(up.call(z0)); edge.call(up.call(z1))
	for s in [-1, 1]:
		sheet.call(s, -7.4, -6.45, F + 0.32, 0.64, 0.022, 14, 10) # the wall behind each seat, below the window
		sheet.call(s, -8.38, -7.42, F + 0.6, 0.64, 0.022, 10, 3) # the strip over the side panel
	# the roof: from over the windscreen back to the turret's ring, one sheet across the crown
	var z0 := -8.12
	var z1 := -7.26
	var nz := 10
	var nc := 22
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for i in nz + 1:
		var z := z0 + (z1 - z0) * (float(i) / nz)
		var crown: float = it.ceiling_at(z, 0, 0.5) - 0.028
		for j in nc + 1:
			var a := -1 + 2 * (float(j) / nc) # -1 the left window's top, 0 the crown, +1 the right
			var yy := lerpf(1.0, crown, sin((1 - absf(a)) * PI / 2))
			var x: float = signf(a) * maxf(0, it.hw_smooth(z, minf(yy, crown - 0.005)) - 0.022)
			pos.append(Vector3(x, yy, z)); uv.append(Vector2(z / TILE, a * 0.9 / TILE))
	for i in nz:
		for j in nc:
			var a := i * (nc + 1) + j
			var b := a + nc + 1
			idx.append_array([a, a + 1, b, b, a + 1, b + 1])
	var g = Geo.from_arrays(pos, null, uv, idx)
	g.compute_vertex_normals()
	# (facing down, into the cockpit)
	var flip := 0.0
	for n in g.normals:
		flip += n.y
	if flip > 0:
		var fl := PackedInt32Array()
		for k in idx.size():
			fl.append(idx[k - (k % 3) + [0, 2, 1][k % 3]])
		g.set_index(fl)
		g.compute_vertex_normals()
	it.add(M.pad, g)

# ---------------------------------------------------------------------------------------------------
# the frames round the windscreen and the side windows (the model's skin is cut for the glass)

static func _build_frames(it) -> void:
	var P := func(s: int, z: float, y: float, inset: float) -> Vector3: return Vector3(s * (it.hw_smooth(z, y) - inset), y, z)
	for s in [-1, 1]:
		# the side window: sill, header, and the posts (the front pane slides aft past the fixed one)
		var sill := 0.675
		var head := 0.975
		for y in [sill, head]:
			var pts := []
			for k in 9:
				pts.append(P.call(s, -8.2 + k * (1.9 / 8), y, 0.012))
			it.add(M.ddg, Geo.tube(Shapes.CatmullRomCurve3.new(pts), 24, 0.011, 6))
		for z in [-8.2, -7.05, -6.3]:
			var pts := []
			for k in 5:
				pts.append(P.call(s, z, sill + k * (head - sill) / 4, 0.012))
			it.add(M.ddg, Geo.tube(Shapes.CatmullRomCurve3.new(pts), 8, 0.018, 6))
		# the sliding window's track and its latch handle
		var tr := []
		for k in 6:
			tr.append(P.call(s, -8.15 + k * 0.2, sill + 0.02, 0.03))
		it.add(M.steel, Geo.tube(Shapes.CatmullRomCurve3.new(tr), 12, 0.005, 5))
		var h: Vector3 = P.call(s, -7.12, sill + 0.12, 0.04)
		it.add(M.black, Geo.rounded_box(0.02, 0.06, 0.03, 2, 0.006).translate(h.x, h.y, h.z))
	# the windscreen's centre post, down the middle from the roof to the glare shield
	var post := Shapes.CatmullRomCurve3.new([Vector3(0, 0.69, -8.66), Vector3(0, 0.85, -8.82), Vector3(0, 1.03, -8.93), Vector3(0, 1.16, -8.78), Vector3(0, 1.24, -8.58)])
	it.add(M.ddg, Geo.tube(post, 20, 0.022, 8))

# ---------------------------------------------------------------------------------------------------
# overhead: the switch box between the pilots, the dome light, the hand-holds

static func _build_overhead(it) -> void:
	var oz := -7.9
	var oy: float = it.ceiling_at(oz, 0, 0.5) - 0.035
	it.add(M.black, Geo.rounded_box(0.16, 0.045, 0.2, 2, 0.008).translate(0, oy - 0.02, oz))
	for i in 8:
		var x := -0.055 + (i % 4) * 0.037
		var z := oz - 0.05 + floori(i / 4.0) * 0.1
		it.add(M.steel, _cyl_geo(0.0025, 0.0035, 0.02, 6).rotate_x(0.4 if i % 3 else -0.4).translate(x, oy - 0.05, z))
	it.add(M.redLens, Geo.sphere(0.01, 10, 6).translate(0.05, oy - 0.045, oz + 0.05))
	# the dome light, aft over the hatch
	var dz := -7.4
	var dy: float = it.ceiling_at(dz, 0, 0.5) - 0.03
	it.add(M.black, _cyl_geo(0.05, 0.055, 0.03, 18).translate(0, dy, dz))
	it.add(M.white, Geo.sphere(0.04, 14, 6, 0, PI * 2, PI / 2, PI / 2).translate(0, dy - 0.015, dz))

# ---------------------------------------------------------------------------------------------------
# the floor under the pilots' feet: unpainted aluminium sheet, riveted down (the plywood's further aft,
# round the top turret); the aileron trim crank on its stand at the pilot's left

static func _build_floor(it) -> void:
	if M.get("floorAl") == null:
		M.floorAl = Mat.standard({map = _floor_texture(), roughness = 0.42, metalness = 0.75})
		M.floorAl.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	for s in [-1, 1]:
		var x0: float = s * 0.21
		var x1: float = s * 0.92
		var g = Geo.plane(absf(x1 - x0), 1.1).rotate_x(-PI / 2).translate((x0 + x1) / 2, F + 0.002, -7.85)
		for i in g.positions.size():
			var p: Vector3 = g.positions[i]
			g.uvs[i] = Vector2(p.x * 1.5, p.z * 1.5)
		var m := _mesh(g, M.floorAl); it.group.add_child(m)
	# the aileron tab crank: a little stand on the floor outboard of the pilot's seat, its handle and indicator
	var x := -0.86
	var z := -7.95
	it.rod([x, F, z], [x, F + 0.32, z], 0.012, M.ddg, 8)
	it.add(M.black, Geo.rounded_box(0.05, 0.07, 0.07, 2, 0.008).translate(x, F + 0.35, z))
	it.add(M.bakelite, _cyl_geo(0.03, 0.03, 0.01, 18).rotate_z(PI / 2).translate(x + 0.03, F + 0.35, z))
	it.rod([x + 0.035, F + 0.35, z], [x + 0.035, F + 0.37, z + 0.025], 0.003, M.steel, 6)
	it.add(M.bakelite, _cyl_geo(0.007, 0.007, 0.025, 8).rotate_z(PI / 2).translate(x + 0.05, F + 0.37, z + 0.025))

static func _floor_texture() -> ImageTexture:
	var g := Canvas2D.new(512, 512)
	g.fill_style = "#9a9d98"; g.fill_rect(0, 0, 512, 512)
	for i in 9000: # brushed, scuffed
		g.fill_style = "rgba(%s,%s)" % ["255,255,255" if randf() < 0.5 else "30,30,26", 0.03 + randf() * 0.06]; g.fill_rect(randf() * 512, randf() * 512, 1 + randf() * 30, 1)
	for i in 26: # boots, oil
		var x := randf() * 512
		var y := randf() * 512
		var r := 20 + randf() * 60
		var gr = g.create_radial_gradient(x, y, 0, x, y, r)
		gr.add_color_stop(0, "rgba(40,36,28,0.22)"); gr.add_color_stop(1, "rgba(40,36,28,0)"); g.fill_style = gr; g.fill_rect(x - r, y - r, 2 * r, 2 * r)
	g.stroke_style = "rgba(30,30,28,0.6)"; g.line_width = 2; g.stroke_rect(1, 1, 510, 510) # the sheet's joints
	for k in range(8, 512, 24):
		for xy in [[k, 8], [k, 504], [8, k], [504, k]]:
			g.fill_style = "#c6c8c2"; g.begin_path(); g.arc(xy[0], xy[1], 3, 0, 7); g.fill(); g.fill_style = "rgba(0,0,0,0.3)"; g.begin_path(); g.arc(xy[0] + 1, xy[1] + 1, 3, 0, 7); g.fill()
	return _texture(g)
