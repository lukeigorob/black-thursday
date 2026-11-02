extends RefCounted
# The navigator's and the radio operator's stations, as in the photos of the real B-17. The navigator:
# his chart table with the chart, plotter and dividers, the astro compass on its stand, the drift
# meter, his instrument board on the wall and his lamp. The radio operator: his desk with the BC-348
# receiver, the BC-375 liaison transmitter on its shelf above, the command sets on the far wall, the
# Morse key, his headset and log, his chair, and the cables. All the faces (dials, tuning windows,
# nameplates, the chart) are drawn on one texture atlas, so the lot is a few draw calls.

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Mat := preload("res://src/core/mat.gd")
const Cabinlook := preload("res://src/cabinlook.gd")
const CockpitB17 := preload("res://src/cockpitb17.gd")

const AW := 2048
const AH := 1024
# atlas regions [x, y, w, h] in px
const R := {receiver = [0, 0, 640, 384], transmitter = [640, 0, 640, 512], command = [1280, 0, 256, 384], navPanel = [1536, 0, 512, 256], chart = [0, 512, 640, 512], log = [640, 512, 256, 320], plate = [1536, 256, 256, 128]}

static func crackle(g, r: Array, base: String) -> void:
	var x: float = r[0]; var y: float = r[1]; var w: float = r[2]; var h: float = r[3]
	g.fill_style = base; g.fill_rect(x, y, w, h)
	for i in int(w * h / 600):
		g.fill_style = "rgba(%s,%s)" % ["255,255,255" if randf() < 0.5 else "0,0,0", 0.03 + randf() * 0.04]
		g.fill_rect(x + randf() * w, y + randf() * h, 1 + randf() * 6, 1 + randf() * 2)
	g.stroke_style = "rgba(0,0,0,0.6)"; g.line_width = 6; g.stroke_rect(x + 3, y + 3, w - 6, h - 6)

static func knob(g, x: float, y: float, r: float) -> void:
	var k = g.create_radial_gradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
	k.add_color_stop(0, "#5a5a56"); k.add_color_stop(1, "#0d0d0c")
	g.fill_style = k; g.begin_path(); g.arc(x, y, r, 0, 7); g.fill()
	g.stroke_style = "#d9d4c2"; g.line_width = 2; g.begin_path(); g.move_to(x, y); g.line_to(x, y - r); g.stroke()

static func label(g, t: String, x: float, y: float, size := 14, col := "#d9d4c2") -> void:
	g.fill_style = col; g.font = "bold %dpx Arial" % size; g.text_align = "center"; g.text_baseline = "middle"; g.fill_text(t, x, y)

static func tuning_window(g, x: float, y: float, w: float, h: float) -> void: # a backlit tuning scale
	g.fill_style = "#1a140b"; g.fill_rect(x - 4, y - 4, w + 8, h + 8)
	var gl = g.create_linear_gradient(x, y, x, y + h); gl.add_color_stop(0, "#e8d6a2"); gl.add_color_stop(1, "#c9b27a")
	g.fill_style = gl; g.fill_rect(x, y, w, h)
	g.stroke_style = "#2a2014"; g.line_width = 1.5
	for i in 61:
		var px := x + 6 + (i / 60.0) * (w - 12)
		g.begin_path(); g.move_to(px, y + h * 0.55); g.line_to(px, y + h * (0.75 if i % 5 else 0.9)); g.stroke()
	g.fill_style = "#2a2014"; g.font = "11px Arial"; g.text_align = "center"
	for i in 13:
		g.fill_text(str(200 + i * 50), x + 6 + (i / 12.0) * (w - 12), y + h * 0.35)
	g.stroke_style = "#b02a1a"; g.line_width = 2; g.begin_path(); g.move_to(x + w * 0.43, y + 2); g.line_to(x + w * 0.43, y + h - 2); g.stroke()

static func atlas() -> Texture2D:
	var g := Canvas2D.new(AW, AH)
	# the BC-348 receiver
	if true:
		var r: Array = R.receiver
		var x: float = r[0]; var y: float = r[1]; var w: float = r[2]
		crackle(g, r, "#2b2c29")
		tuning_window(g, x + 150, y + 60, 340, 90)
		label(g, "RADIO RECEIVER BC-348-R", x + w / 2, y + 30, 16)
		for i in 6:
			knob(g, x + 70 + i * 100, y + 260, 38 if i == 2 else 26)
		var names := ["BAND", "VOLUME", "TUNING", "CRYSTAL", "BEAT OSC", "SENS."]
		for i in names.size():
			label(g, names[i], x + 70 + i * 100, y + 318, 12)
		g.fill_style = "#111"; g.begin_path(); g.arc(x + 560, y + 105, 30, 0, 7); g.fill(); label(g, "PHONES", x + 560, y + 150, 11)
		CockpitB17.draw_gauge(g, x + 80, y + 110, 34, "pressure", "OUTPUT")
	# the BC-375 liaison transmitter
	if true:
		var r: Array = R.transmitter
		var x: float = r[0]; var y: float = r[1]; var w: float = r[2]
		crackle(g, r, "#262725")
		label(g, "RADIO TRANSMITTER BC-375-E", x + w / 2, y + 30, 17)
		for i in 3:
			CockpitB17.draw_gauge(g, x + 130 + i * 190, y + 130, 52, "tach" if i == 1 else "pressure", ["PLATE CURRENT", "ANTENNA CURRENT", "FILAMENT"][i])
		for i in 4:
			knob(g, x + 100 + i * 145, y + 330, 42); label(g, ["MASTER OSC", "P.A. TUNING", "ANT. COUPLING", "ANT. TUNING"][i], x + 100 + i * 145, y + 392, 12)
		g.fill_style = "#c9c2a8"; g.fill_rect(x + 220, y + 430, 200, 46); label(g, "TUNING UNIT TU-5-B", x + 320, y + 453, 14, "#1a1a1a")
	# a command set
	if true:
		var r: Array = R.command
		var x: float = r[0]; var y: float = r[1]; var w: float = r[2]
		crackle(g, r, "#2a2b28")
		label(g, "BC-453-B", x + w / 2, y + 26, 14)
		g.fill_style = "#d8cfa8"; g.begin_path(); g.arc(x + w / 2, y + 130, 70, 0, 7); g.fill() # its round tuning dial
		g.stroke_style = "#222"; g.line_width = 1.5
		for i in 40:
			var a := (i / 40.0) * 6.283
			g.begin_path(); g.move_to(x + w / 2 + cos(a) * 58, y + 130 + sin(a) * 58); g.line_to(x + w / 2 + cos(a) * 68, y + 130 + sin(a) * 68); g.stroke()
		knob(g, x + w / 2, y + 290, 34); label(g, "TUNE", x + w / 2, y + 340, 12)
	# the navigator's instrument board
	if true:
		var r: Array = R.navPanel
		var x: float = r[0]; var y: float = r[1]
		crackle(g, r, "#1e1f1d")
		var kinds := ["airspeed", "altimeter", "compass", "clock", "temp", "gyro"]
		var labels := ["AIR SPEED", "ALTIMETER", "COMPASS", "CLOCK", "FREE AIR", "RADIO COMPASS"]
		for i in kinds.size():
			CockpitB17.draw_gauge(g, x + 50 + (i % 3) * 160 + (i % 3) * 3, y + 70 + floori(i / 3.0) * 110, 36, kinds[i], labels[i])
	# the chart: the North Sea and the course to the target, pencilled
	if true:
		var x: float = R.chart[0]; var y: float = R.chart[1]; var w: float = R.chart[2]; var h: float = R.chart[3]
		g.fill_style = "#e9e1c5"; g.fill_rect(x, y, w, h)
		g.fill_style = "#c9d6c5"; g.begin_path(); g.move_to(x, y + 80); g.bezier_curve_to(x + 200, y + 160, x + 140, y + 330, x, y + 420); g.close_path(); g.fill() # England
		g.fill_style = "#d8ccaa"; g.begin_path(); g.move_to(x + w, y + 40); g.bezier_curve_to(x + 430, y + 180, x + 520, y + 300, x + 470, y + h); g.line_to(x + w, y + h); g.close_path(); g.fill() # the Continent
		g.stroke_style = "rgba(80,80,90,0.35)"; g.line_width = 1
		for i in range(1, 10):
			g.begin_path(); g.move_to(x + i * 64, y); g.line_to(x + i * 64, y + h); g.stroke(); g.begin_path(); g.move_to(x, y + i * 51); g.line_to(x + w, y + i * 51); g.stroke()
		g.stroke_style = "#33302a"; g.line_width = 2.5; g.begin_path(); g.move_to(x + 110, y + 260); g.line_to(x + 330, y + 230); g.line_to(x + 520, y + 300); g.line_to(x + 560, y + 180); g.stroke()
		g.stroke_style = "#a8281c"; g.line_width = 3; g.begin_path(); g.arc(x + 520, y + 300, 14, 0, 7); g.stroke()
		g.fill_style = "#33302a"; g.font = "italic 16px Georgia"; g.text_align = "left"
		g.fill_text("I.P. 1102", x + 300, y + 220); g.fill_text("TGT", x + 538, y + 318); g.fill_text("ETA 1131", x + 470, y + 340)
		g.stroke_style = "#555"; g.begin_path(); g.arc(x + 90, y + 450, 40, 0, 7); g.stroke(); label(g, "N", x + 90, y + 400, 14, "#333")
	# the radio log
	if true:
		var x: float = R.log[0]; var y: float = R.log[1]; var w: float = R.log[2]; var h: float = R.log[3]
		g.fill_style = "#ece6d2"; g.fill_rect(x, y, w, h); g.fill_style = "#7b7564"
		label(g, "RADIO LOG", x + w / 2, y + 20, 13, "#333")
		for i in 14:
			g.fill_rect(x + 12, y + 44 + i * 19, w - 24, 1)
			if i < 9:
				g.fill_style = "#2b3a6a"; g.font = "12px Courier"; g.text_align = "left"; g.fill_text("10%d  QTE %d  R5" % [20 + i * 3, 100 + i * 7], x + 16, y + 40 + i * 19); g.fill_style = "#7b7564"
	# a black nameplate for the sets' sides
	crackle(g, R.plate, "#2a2b28")
	return g.texture(true)

## A flat face (w x h metres) showing atlas region `r`; build it facing +Z then place it.
static func face(r: Array, w: float, h: float):
	var g = Geo.plane(w, h)
	var x: float = r[0]; var y: float = r[1]; var rw: float = r[2]; var rh: float = r[3]
	for i in g.uvs.size():
		var u: Vector2 = g.uvs[i]
		g.uvs[i] = Vector2((x + u.x * rw) / AW, 1 - (y + (1 - u.y) * rh) / AH)
	return g

static func std(c, r := 0.7, m := 0.1) -> ShaderMaterial:
	return Cabinlook.std({color = c, roughness = r, metalness = m})
static var M := {}
static func _materials() -> void:
	if not M.is_empty():
		return
	M = {atlas = null, set = std(0x2b2c29, 0.55, 0.35), green = std(0x4c5638, 0.75, 0.15), black = std(0x151515, 0.6, 0.2), steel = std(0x8f918a, 0.4, 0.7), brass = std(0xb08a3e, 0.4, 0.8), glass = null, cushion = Cabinlook.leather(std(0x4a3222, 0.7)), wood = std(0x7a5f43, 0.7)}

## it = the Interior; MAT its materials (for the planks).
static func build_stations(it, MAT: Dictionary) -> void:
	_materials()
	if M.atlas == null:
		M.atlas = Cabinlook.std({map = atlas(), roughness = 0.6, metalness = 0.1})
	if M.glass == null:
		M.glass = Cabinlook.std({color = 0xc8d8d0, transparent = true, opacity = 0.35, roughness = 0.1, depthWrite = false})
	var wall_x := func(z: float, y: float, inset: float) -> float: return it.hw(z, y) - inset
	var add := func(mat, geo) -> void: it.add(mat, geo)
	var box_geo := func(w: float, h: float, d: float): return it.box_geo(w, h, d)

	# ======== the navigator (left side of the nose) ========
	var nf := -0.72
	# his chart table: a wooden top with a lip, on a green frame with drawers under it
	add.call(MAT.floor, box_geo.call(0.42, 0.035, 0.57).translate(-0.75, 0.0, -9.125))
	for q in [[0, -0.29, 0.42, 0.015], [0, 0.29, 0.42, 0.015], [0.21, 0, 0.015, 0.57]]:
		add.call(M.green, box_geo.call(q[2], 0.05, q[3]).translate(-0.75 + q[0], 0.02, -9.125 + q[1]))
	add.call(M.green, box_geo.call(0.38, 0.5, 0.53).translate(-0.76, -0.27, -9.125))
	for i in 3:
		add.call(M.black, box_geo.call(0.004, 0.012, 0.08).translate(-0.565, -0.12 - i * 0.15, -9.125)); add.call(M.set, box_geo.call(0.003, 0.13, 0.48).translate(-0.568, -0.12 - i * 0.15, -9.125))
	# the chart, a plotter, dividers and pencils on it
	add.call(M.atlas, face(R.chart, 0.4, 0.32).rotate_x(-PI / 2).rotate_y(PI / 2 + 0.06).translate(-0.75, 0.019, -9.12))
	add.call(M.glass, box_geo.call(0.003, 0.002, 0.3).translate(-0.7, 0.022, -9.05))
	it.rod([-0.66, 0.026, -9.25], [-0.8, 0.026, -9.3], 0.0025, M.steel); it.rod([-0.66, 0.026, -9.25], [-0.78, 0.026, -9.2], 0.0025, M.steel) # dividers
	it.rod([-0.62, 0.024, -8.95], [-0.74, 0.024, -8.99], 0.004, _pencil()) # a yellow pencil
	# the astro compass on its stand at the table's corner
	it.cylinder(0.035, 0.05, -0.6, 0.045, -9.36, "y", M.black, 16)
	add.call(M.glass, Geo.sphere(0.04, 16, 8, 0, PI * 2, 0, PI / 2).translate(-0.6, 0.07, -9.36))
	for s in [-1, 1]:
		add.call(M.steel, box_geo.call(0.003, 0.06, 0.012).translate(-0.6 + s * 0.03, 0.1, -9.36))
	# the B-3 drift meter on the floor ahead of the table, its eyepiece angled up
	it.box(-0.5, -0.36, nf, nf + 0.05, -9.62, -9.48, M.black, false)
	it.cylinder(0.055, 0.45, -0.43, nf + 0.27, -9.55, "y", M.set, 16)
	it.rod([-0.43, nf + 0.5, -9.55], [-0.38, nf + 0.62, -9.5], 0.025, M.black, 12)
	it.cylinder(0.03, 0.03, -0.43, nf + 0.4, -9.49, "z", M.brass, 10)
	# his instrument board on the wall above the table, and his gooseneck lamp
	if true:
		var z := -9.05
		var y := 0.18
		var x: float = -wall_x.call(z, y, 0.04)
		it.box(x - 0.025, x + 0.012, y - 0.13, y + 0.13, z - 0.22, z + 0.22, M.black, false)
		add.call(M.atlas, face(R.navPanel, 0.42, 0.21).rotate_y(PI / 2).translate(x + 0.013, y, z))
		var lx: float = -wall_x.call(-9.32, 0.3, 0.03)
		it.box(lx - 0.01, lx + 0.02, 0.27, 0.33, -9.35, -9.29, M.black, false)
		var neck := Shapes.CatmullRomCurve3.new([Vector3(lx + 0.02, 0.3, -9.32), Vector3(lx + 0.12, 0.36, -9.3), Vector3(lx + 0.2, 0.3, -9.27), Vector3(lx + 0.22, 0.2, -9.25)])
		add.call(M.black, Geo.tube(neck, 12, 0.007, 6))
		add.call(M.black, Geo.cone(0.04, 0.06, 12, 1, true).translate(lx + 0.22, 0.17, -9.25))
	# his swivel stool
	it.cylinder(0.02, 0.32, -0.42, nf + 0.16, -8.95, "y", M.steel, 8)
	it.cylinder(0.12, 0.05, -0.42, nf + 0.34, -8.95, "y", M.cushion, 16)

	# ======== the radio operator (left side of the radio room) ========
	var rf := -1.8
	# his desk: a wooden top on a green frame
	add.call(MAT.floor, box_geo.call(0.6, 0.035, 0.72).translate(-0.71, -1.068, -2.15))
	add.call(M.green, box_geo.call(0.5, 0.7, 0.3).translate(-0.73, rf + 0.38, -2.31)) # (the front open: his knees go under it)
	# the BC-348 receiver on the desk, its face to the aisle
	if true:
		var x0 := -0.97; var x1 := -0.62; var y0 := -1.05; var y1 := -0.75; var z0 := -2.42; var z1 := -1.94
		it.box(maxf(x0, -wall_x.call(-2.18, -0.9, 0.02)), x1, y0, y1, z0, z1, M.set, false)
		add.call(M.atlas, face(R.receiver, z1 - z0, y1 - y0).rotate_y(PI / 2).translate(x1 + 0.002, (y0 + y1) / 2, (z0 + z1) / 2))
		# (on the drawn knobs: the face runs from z1 at its left edge, as you look at it)
		for i in 6:
			it.cylinder(0.02 if i == 2 else 0.014, 0.025, x1 + 0.012, y1 - (260.0 / 384) * (y1 - y0), z1 - ((70.0 + i * 100) / 640) * (z1 - z0), "x", M.black, 12)
	# the BC-375 transmitter on its shelf above
	if true:
		var y0 := -0.7; var y1 := -0.3; var z0 := -2.45; var z1 := -1.95; var x1 := -0.64
		var x0: float = -wall_x.call(-2.2, -0.5, 0.03)
		it.box(x0, x1 + 0.05, y0 - 0.025, y0, z0 - 0.02, z1 + 0.02, M.green, false)
		it.box(x0, x1, y0, y1, z0, z1, M.set, false)
		add.call(M.atlas, face(R.transmitter, z1 - z0, y1 - y0).rotate_y(PI / 2).translate(x1 + 0.002, (y0 + y1) / 2, (z0 + z1) / 2))
		for i in 4:
			it.cylinder(0.022, 0.03, x1 + 0.015, y1 - (330.0 / 512) * (y1 - y0), z1 - ((100.0 + i * 145) / 640) * (z1 - z0), "x", M.black, 14)
		for i in 4:
			it.rod([x0 + 0.05, y1 - 0.02, z0 + 0.1 + i * 0.1], [x0 + 0.02, y1 + 0.2, z0 + 0.05 + i * 0.12], 0.008, M.black) # cables up to the junction box
	# the Morse key, his log and headset on the desk
	it.box(-0.56, -0.47, -1.05, -1.035, -2.13, -2.06, M.black, false)
	it.rod([-0.55, -1.03, -2.095], [-0.47, -1.02, -2.095], 0.004, M.brass)
	it.add(M.black, it.cyl_geo(0.012, 0.012, 0.012, 10).translate(-0.47, -1.012, -2.095))
	add.call(M.atlas, face(R.log, 0.16, 0.2).rotate_x(-PI / 2).rotate_y(PI / 2 - 0.2).translate(-0.6, -1.049, -1.92))
	add.call(M.black, Geo.torus(0.075, 0.009, 5, 16, PI).rotate_y(PI / 2).translate(-0.6, -0.97, -2.43))
	for s in [-1, 1]:
		it.cylinder(0.03, 0.02, -0.6, -1.04, -2.43 + s * 0.075, "x", M.black, 12)
	# his chair: a leather seat and back on a post
	it.cylinder(0.025, 0.4, -0.68, rf + 0.2, -1.57, "y", M.steel, 8)
	it.box(-0.84, -0.52, rf + 0.38, rf + 0.46, -1.73, -1.41, M.cushion, false)
	it.box(-0.84, -0.52, rf + 0.46, rf + 0.85, -1.43, -1.38, M.cushion, false)
	# the command sets on the far wall, with their faces
	for i in 3:
		var z := -1.88 + i * 0.12
		var y := -1.07
		var x: float = wall_x.call(z, y, 0.16)
		it.box(x - 0.09, x + 0.09, y - 0.13, y + 0.13, z - 0.055, z + 0.055, M.set, false)
		add.call(M.atlas, face(R.command, 0.105, 0.24).rotate_y(-PI / 2).translate(x - 0.092, y, z))
	for k in M:
		Cabinlook.inside_light(M[k])

static var _pencil_mat: ShaderMaterial
static func _pencil() -> ShaderMaterial:
	if _pencil_mat == null:
		_pencil_mat = std(0xc8a032, 0.6) # (made once: the web game made one each build)
	return _pencil_mat
