extends RefCounted
# The B-17's waist, as the photos of the real ones show it (hackathon/WAIST_SPEC.md): the open gun
# windows, open holes cut wide (nothing in them: the guns and the gunner's view are clear) in riveted frames,
# armour plate under the sills; the tall 1943 ammunition boxes on their
# racks under each window (the feed chutes up to the guns are weapons.js's, they move with the guns);
# dense Z-section stringers in zinc chromate between the frames; an A-12 oxygen regulator and a BC-366
# interphone jack box at each gunner; the yellow oxygen bottles strapped by the ball turret; the ball's
# azimuth drum, crank and support column up to its beam under the roof; aluminium treads on the walkway;
# the radio room's door standing open against its bulkhead.

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Cabinlook := preload("res://src/cabinlook.gd")

static func std(color, roughness := 0.7, metalness := 0.2) -> ShaderMaterial:
	return Cabinlook.std({color = color, roughness = roughness, metalness = metalness})

# the waist windows' openings (bomber space, z and y; the same both sides). Normally the model's own (WIN_SMALL,
# traced from its paint's cut-out); while you're at a waist gun, its window is cut wider (WAIST_WINDOW: interior.js
# cuts it out of the skin and its lining, setWaistWide), so you have the sky round your gun
const WIN_SMALL := [[1.43, -1.29], [1.52, -1.33], [1.85, -1.35], [2.13, -1.345], [2.24, -1.3], [2.26, -1.0], [2.26, -0.76], [2.17, -0.705],
	[1.8, -0.675], [1.55, -0.655], [1.46, -0.675], [1.425, -0.76], [1.425, -1.0]]
const WAIST_WINDOW := {z0 = 1.15, z1 = 2.48, y0 = -1.47, y1 = -0.5, r = 0.07}
static var WIN: Array = _win() # its outline, going round, the corners rounded
static func _win() -> Array:
	var w := WAIST_WINDOW
	var pts := []
	for c in [[w.z1 - w.r, w.y0 + w.r, -PI / 2], [w.z1 - w.r, w.y1 - w.r, 0.0], [w.z0 + w.r, w.y1 - w.r, PI / 2], [w.z0 + w.r, w.y0 + w.r, PI]]:
		for k in 4:
			var a: float = c[2] + (k / 3.0) * (PI / 2)
			pts.append([c[0] + cos(a) * w.r, c[1] + sin(a) * w.r])
	return pts

static var M := {}
static func materials() -> Dictionary:
	return {
		zinc = std(0x7d874c, 0.6, 0.35), # zinc chromate on the bare structure
		alu = std(0x7a7e78, 0.55, 0.6), # bare aluminium: treads, rack angles
		armour = std(0x3e4232, 0.65, 0.45), # the plate, olive drab over steel
		od = std(0x4a4e33, 0.75, 0.15),
		black = std(0x151515, 0.6, 0.2),
		steel = std(0x3a3c38, 0.5, 0.6),
		red = std(0x8a1c14, 0.5, 0.2),
		yellow = std(0xb8932c, 0.55, 0.15),
		webbing = std(0x5f5a44, 0.95, 0),
		regulator = face_material(regulator_face()),
		jackbox = face_material(jack_face()),
	}

static func face_material(c) -> ShaderMaterial:
	return Cabinlook.std({map = c.texture(true), roughness = 0.55})

## The A-12 demand regulator's face: its pressure gauge, the blinker, the AUTO-MIX lever and the red emergency knob.
static func regulator_face():
	var g := Canvas2D.new(128, 192)
	g.fill_style = "#2f3324"; g.fill_rect(0, 0, 128, 192)
	g.fill_style = "#0b0b0b"; g.begin_path(); g.arc(64, 54, 38, 0, 7); g.fill() # the pressure gauge
	g.stroke_style = "#ddd8c4"; g.line_width = 2
	for k in 11:
		var a := PI * (0.75 + k * 0.15)
		g.begin_path(); g.move_to(64 + cos(a) * 28, 54 + sin(a) * 28); g.line_to(64 + cos(a) * 35, 54 + sin(a) * 35); g.stroke()
	g.line_width = 3; g.begin_path(); g.move_to(64, 54); g.line_to(64 + cos(PI * 1.9) * 27, 54 + sin(PI * 1.9) * 27); g.stroke()
	g.fill_style = "#ddd8c4"; g.font = "bold 11px sans-serif"; g.text_align = "center"; g.fill_text("OXYGEN", 64, 78); g.font = "9px sans-serif"; g.fill_text("LBS. PER SQ. IN.", 64, 88)
	g.fill_style = "#0b0b0b"; g.begin_path(); g.arc(40, 128, 17, 0, 7); g.fill() # the blinker: its lids open and shut as he breathes
	g.fill_style = "#d9c84a"; g.fill_rect(29, 124, 22, 8)
	g.fill_style = "#ddd8c4"; g.font = "9px sans-serif"; g.fill_text("FLOW", 40, 156)
	g.fill_text("AUTO-MIX", 92, 112); g.fill_style = "#bdb8a4"; g.fill_rect(84, 120, 16, 26); g.fill_style = "#ddd8c4"; g.fill_text("ON", 78, 160); g.fill_text("OFF", 106, 160)
	g.font = "bold 10px sans-serif"; g.fill_text("TYPE A-12", 64, 182)
	return g

## The BC-366 jack box: its volume knob's scale, the two jacks, the call switch.
static func jack_face():
	var g := Canvas2D.new(96, 128)
	g.fill_style = "#1d1e1b"; g.fill_rect(0, 0, 96, 128)
	g.stroke_style = "#d8d4c4"; g.fill_style = "#d8d4c4"; g.line_width = 2
	g.begin_path(); g.arc(48, 46, 26, PI * 0.8, PI * 2.2); g.stroke()
	for k in 9:
		var a := PI * (0.8 + k * 0.175)
		g.begin_path(); g.move_to(48 + cos(a) * 26, 46 + sin(a) * 26); g.line_to(48 + cos(a) * 31, 46 + sin(a) * 31); g.stroke()
	g.font = "9px sans-serif"; g.text_align = "center"; g.fill_text("VOLUME", 48, 84); g.fill_text("PHONES   MIC", 48, 118)
	g.font = "bold 9px sans-serif"; g.fill_text("BC-366", 48, 12)
	return g

static func _v(a) -> Vector3:
	return a if a is Vector3 else Vector3(a[0], a[1], a[2])

## Build it all into the interior `it` (its add / box / rod / cylinder helpers, hull table and stations).
static func build_waist_section(it, MAT: Dictionary) -> void:
	if M.is_empty():
		M = materials()
	var f := -1.95
	var wall_x := func(z: float, y: float, inset := 0.02) -> float: return it.hw(z, y) - inset
	if not it.group.has_meta("oxygen"):
		it.group.set_meta("oxygen", [])
	var outlets: Array = it.group.get_meta("oxygen")
	# a beam of w x h section from a to b, its h side along `n` (the way it stands off the wall)
	# what's drawn only with a window at one size: [side][state] = [[material, geometry], ...] (put() sends to it
	# while `into` is set), made into meshes at the end for interior.js setWaistWide to swap
	var swap := {-1: {small = [], wide = []}, 1: {small = [], wide = []}}
	var st := {into = null} # (a lambda can't assign a captured local: the current list lives in here)
	var put := func(mat, g) -> void:
		if st.into != null:
			st.into.append([mat, g])
		else:
			it.add(mat, g)
	var beam := func(a, b, w: float, h: float, n: Vector3, mat) -> void:
		var A := _v(a)
		var B := _v(b)
		var t := B - A
		var len := t.length()
		if len < 1e-4:
			return
		t /= len
		var y := (n - t * n.dot(t)).normalized()
		var x := y.cross(t)
		var g = it.box_geo(w, h, len).apply_transform(Transform3D(Basis(x, y, t), Vector3.ZERO))
		put.call(mat, g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2))
	var inward := func(s: int) -> Vector3: return Vector3(-s, 0, 0)

	# ---- the gun windows: open holes, a riveted frame round each (nothing in them: the guns and the gunner's view are clear)
	for s in [-1, 1]:
		for sw in [["small", WIN_SMALL], ["wide", WIN]]: # (a frame round each size of opening, the one showing drawn)
			st.into = swap[s][sw[0]]
			var win: Array = sw[1]
			var ring := win.map(func(p): return Vector3(s * wall_x.call(p[0], p[1], 0.012), p[1], p[0]))
			var lip := win.map(func(p): return Vector3(s * wall_x.call(p[0], p[1], 0.05), p[1], p[0]))
			for i in win.size():
				var j := (i + 1) % win.size()
				beam.call(ring[i], ring[j], 0.03, 0.022, inward.call(s), MAT.metal) # the frame on the skin
				beam.call(lip[i], lip[j], 0.012, 0.03, inward.call(s), MAT.metal) # its turned-in lip
				var a: Vector3 = ring[i]
				var b: Vector3 = ring[j]
				var L := a.distance_to(b)
				var t := 0.02
				while t < L:
					var q := a.lerp(b, t / L) + Vector3(-s * 0.012, 0, 0)
					put.call(MAT.metal, Geo.sphere(0.0055, 5, 3).translate(q.x, q.y, q.z))
					t += 0.045
			st.into = null
		# armour plate under the sill: a curved slab on the wall, bolted round its edge
		var y := -1.86
		while y < WAIST_WINDOW.y0 - 0.06:
			var yc := y + 0.03
			var x: float = s * wall_x.call(1.84, yc, 0.032)
			it.add(M.armour, it.box_geo(0.014, 0.062, 0.84).translate(x, yc, 1.84))
			y += 0.06
		for z in [1.46, 1.65, 1.84, 2.03, 2.22]:
			for yy in [-1.84, WAIST_WINDOW.y0 - 0.06]:
				it.cylinder(0.008, 0.012, s * (wall_x.call(z, yy, 0.04) - 0.0), yy, z, "x", M.steel, 6)
		it.stencil(["ARMOR PLATE"], 0.16, [s * wall_x.call(1.84, -1.7, 0.042), -1.7, 1.84], -s * PI / 2, "#d8d0a8")

	# ---- the ammunition boxes under the windows, on their racks: the tall boxes of 1943, the chute out of the top
	var ammo_box := func(cx: float, cz: float, s: int, h := 0.53, w := 0.22, d := 0.36, chute := true) -> void:
		var y0 := f
		var y1 := f + h
		it.box(cx - w / 2, cx + w / 2, y0 + 0.02, y1 - 0.02, cz - d / 2, cz + d / 2, MAT.ammo, true)
		it.add(MAT.ammo, it.box_geo(w + 0.01, 0.025, d + 0.01).translate(cx, y1 - 0.012, cz)) # the lid
		it.add(MAT.dark, it.box_geo(w + 0.012, 0.012, d + 0.012).translate(cx, y0 + 0.03, cz)) # the base rim
		for dz in [-d / 2 + 0.04, d / 2 - 0.04]:
			it.add(MAT.metal, it.box_geo(0.02, 0.05, 0.03).translate(cx - s * (w / 2 + 0.008), y1 - 0.05, cz + dz)) # its latches
		it.rod([cx - s * (w / 2 + 0.02), y1 - 0.14, cz - 0.07], [cx - s * (w / 2 + 0.02), y1 - 0.14, cz + 0.07], 0.007, MAT.dark, 6) # the carrying handle
		for dz in [-0.07, 0.07]:
			it.rod([cx - s * (w / 2 + 0.002), y1 - 0.14, cz + dz], [cx - s * (w / 2 + 0.02), y1 - 0.14, cz + dz], 0.006, MAT.dark, 4)
		# the rack: aluminium angles round its foot, a strap over it to the wall
		for dz in [-d / 2 - 0.012, d / 2 + 0.012]:
			it.add(M.alu, it.box_geo(w + 0.04, 0.05, 0.008).translate(cx, y0 + 0.025, cz + dz))
		for dx in [-w / 2 - 0.012, w / 2 + 0.012]:
			it.add(M.alu, it.box_geo(0.008, 0.05, d + 0.04).translate(cx + dx, y0 + 0.025, cz))
		it.rod([cx - s * w / 2, y1 - 0.2, cz], [cx - s * w / 2, y1 + 0.004, cz], 0.004, M.webbing, 4)
		it.add(M.webbing, it.box_geo(w + 0.004, 0.006, 0.05).translate(cx, y1 + 0.003, cz))
		it.rod([cx + s * w / 2, y1 + 0.003, cz], [s * wall_x.call(cz, y1 + 0.1, 0.01), y1 + 0.1, cz], 0.006, M.webbing, 4)
		if chute: # the chute's fitting on the lid
			it.add(MAT.metal, it.box_geo(0.14, 0.04, 0.07).translate(cx, y1 + 0.015, cz))
			it.add(MAT.dark, it.box_geo(0.16, 0.012, 0.09).translate(cx, y1 + 0.002, cz))
		it.stencil(["CAL. .50 AMMUNITION", "M2 BALL  M1 TRACER", "400 RDS LINKED"], 0.17, [cx - s * (w / 2 + 0.002), f + h * 0.55, cz], -s * PI / 2, "#d8d0a8")
	for sta in it.stations:
		if not sta.has("feed_box"):
			continue
		var fb: Array = sta.feed_box
		var x: float = fb[0]
		var y: float = fb[1]
		var z: float = fb[2]
		var s := int(signf(x))
		fb[0] = s * minf(absf(x), wall_x.call(z, f + 0.01, 0.15)) # (in from the skin, which curves in at the floor: weapons.js's chute starts here too)
		ammo_box.call(fb[0], z, s, y - f)
	for sz in [[-1, 3.1], [1, 3.25]]:
		ammo_box.call(sz[0] * wall_x.call(sz[1], f + 0.01, 0.14), sz[1], sz[0], 0.4, 0.2, 0.32, false) # spare boxes, aft
	it.add(MAT.ammo, it.box_geo(0.2, 0.36, 0.32).rotate_z(1.2).translate(0.5, f + 0.1, 3.75)) # (one on its side, kicked over)

	# ---- the structure: Z-section stringers all the way round between the frames, in zinc chromate
	var in_win := func(z: float, y: float) -> bool: return z > WAIST_WINDOW.z0 - 0.06 and z < WAIST_WINDOW.z1 + 0.06 and y > WAIST_WINDOW.y0 - 0.04 and y < WAIST_WINDOW.y1 + 0.04
	var in_small := func(z: float, y: float) -> bool: return z > 1.36 and z < 2.3 and y > -1.38 and y < -0.62 # (the model's own window, give or take)
	for s in [-1, 1]:
		var up := 0.1
		while up < 1.72:
			var prev = null
			var z := -1.15
			while z <= 5.15:
				var y := f + up
				var w: float = wall_x.call(z, y, 0.012)
				if not is_finite(w) or w < 0.5 or in_small.call(z, y) or (z > -0.2 and z < 0.12 and up < 1.05): # (and not through the ball's heavy frame)
					prev = null
					z += 0.25
					continue
				var p := Vector3(s * w, y, z)
				if prev != null:
					st.into = swap[s].small if in_win.call(z, y) or in_win.call(prev.z, prev.y) else null # (where the wide window opens: only while it's the small one)
					beam.call(prev, p, 0.004, 0.03, inward.call(s), M.zinc) # its web
					beam.call(Vector3(prev.x - s * 0.028, prev.y, prev.z), Vector3(p.x - s * 0.028, p.y, p.z), 0.004, 0.022, Vector3(0, 1, 0), M.zinc) # its flange
					st.into = null
				prev = p
				z += 0.25
			up += 0.125
	for x in [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42]: # and along the roof
		var prev = null
		var z := -1.15
		while z <= 4.6:
			var y: float = it.ceiling_at(z, x, f + 0.5) - 0.012
			var p := Vector3(x, y, z)
			if not is_finite(y) or y > 1:
				prev = null
				z += 0.25
				continue
			if prev != null and absf(prev.y - y) < 0.2:
				beam.call(prev, p, 0.004, 0.03, Vector3(0, -1, 0), M.zinc)
				beam.call(Vector3(prev.x, prev.y - 0.028, prev.z), Vector3(p.x, p.y - 0.028, p.z), 0.022, 0.004, Vector3(0, -1, 0), M.zinc)
			prev = p
			z += 0.25

	# ---- the walkway: aluminium treads across its planks, angle along its edges
	var tz := -1.1
	while tz < 5.05:
		if not (tz > -0.8 and tz < 0.55): # (round the ball)
			it.add(M.alu, it.box_geo(0.58, 0.007, 0.025).translate(0, f + 0.0035, tz))
			for x in [-0.27, 0.27]:
				it.add(MAT.metal, it.cyl_geo(0.005, 0.005, 0.009, 6).translate(x, f + 0.005, tz))
		tz += 0.3
	for x in [-0.31, 0.31]:
		it.add(M.alu, it.box_geo(0.03, 0.012, 3.7).translate(x, f + 0.006, 2.7 + 0.15))
		it.add(M.alu, it.box_geo(0.03, 0.012, 0.4).translate(x, f + 0.006, -1.0))

	# ---- oxygen and interphone at each gunner: the A-12 regulator, its hose outlet; the BC-366 jack box, its cord
	for sta in it.stations:
		if not sta.has("feed_box"):
			continue
		var s := signf(sta.pivot[0])
		var z: float = WAIST_WINDOW.z1 + 0.16 # (aft of the window, clear of it)
		var y := -0.98
		var x: float = s * wall_x.call(z, y, 0.045)
		it.add(M.od, it.box_geo(0.075, 0.17, 0.115).translate(x, y, z))
		var face: MeshInstance3D = it.mesh_of(Geo.plane(0.105, 0.158), M.regulator, it.group)
		face.position = Vector3(x - s * 0.0385, y, z); face.rotation.y = -s * PI / 2
		it.cylinder(0.012, 0.02, x - s * 0.045, y - 0.045, z + 0.03, "x", M.red, 10) # the emergency knob
		it.add(MAT.metal, it.box_geo(0.02, 0.03, 0.03).translate(x, y + 0.1, z)) # the supply line's union on top
		it.rod([x, y + 0.11, z], [s * wall_x.call(z, y + 0.5, 0.03), y + 0.5, z + 0.05], 0.007, MAT.metal, 6) # up the wall to the system
		it.rod([x - s * 0.02, y - 0.085, z], [x - s * 0.04, y - 0.13, z], 0.013, MAT.hose, 8) # the outlet
		it.add(MAT.metal, it.cyl_geo(0.016, 0.016, 0.02, 10).translate(x - s * 0.04, y - 0.14, z)) # (its bayonet coupling)
		outlets.append(Vector3(x - s * 0.04, y - 0.15, z))
		var jz := z + 0.17
		var jy := -1.22
		var jx: float = s * wall_x.call(jz, jy, 0.032)
		it.add(M.black, it.box_geo(0.05, 0.13, 0.1).translate(jx, jy, jz))
		var jf: MeshInstance3D = it.mesh_of(Geo.plane(0.095, 0.125), M.jackbox, it.group)
		jf.position = Vector3(jx - s * 0.0255, jy, jz); jf.rotation.y = -s * PI / 2
		it.cylinder(0.014, 0.02, jx - s * 0.035, jy + 0.025, jz, "x", M.black, 12) # the volume knob
		for dz in [-0.022, 0.022]:
			it.cylinder(0.006, 0.012, jx - s * 0.03, jy - 0.042, jz + dz, "x", MAT.metal, 8) # the jacks
		# the headset's cord: plugged in, hanging in a loop
		var cord := Shapes.CatmullRomCurve3.new([Vector3(jx - s * 0.04, jy - 0.042, jz - 0.022), Vector3(jx - s * 0.1, jy - 0.3, jz - 0.05), Vector3(jx - s * 0.2, jy - 0.35, jz - 0.1), Vector3(jx - s * 0.28, jy - 0.15, jz - 0.2)])
		it.add(M.black, Geo.tube(cord, 16, 0.004, 4, false))
		it.stencil(["OXYGEN"], 0.08, [x - s * 0.04, y + 0.115, z], -s * PI / 2, "#d8c86a")

	# ---- the oxygen bottles by the ball, standing in their brackets, strapped to the wall
	for s in [-1, 1]:
		for z in [0.62, 0.88]: # (forward of the window, clear of it)
			var y := -1.2
			var x: float = s * minf(wall_x.call(z, y, 0.13), minf(wall_x.call(z, y - 0.32, 0.12), wall_x.call(z, y + 0.32, 0.12)))
			it.add(M.yellow, Geo.capsule(0.1, 0.4, 6, 18).translate(x, y, z))
			it.cylinder(0.022, 0.05, x, y + 0.32, z, "y", MAT.metal, 10) # its valve
			it.cylinder(0.03, 0.012, x, y + 0.355, z, "y", MAT.dark, 10) # (the handwheel)
			it.rod([x, y + 0.34, z], [s * wall_x.call(z, y + 0.6, 0.03), y + 0.6, z], 0.006, MAT.metal, 5) # its line up the wall
			for dy in [-0.14, 0.12]:
				it.add(M.webbing, Geo.torus(0.103, 0.008, 4, 22).rotate_x(PI / 2).translate(x, y + dy, z)) # a strap round it
				it.add(MAT.dark, it.box_geo(0.1, 0.03, 0.02).translate(x + s * 0.12, y + dy, z)) # to its bracket on the wall
			it.add(MAT.dark, it.cyl_geo(0.11, 0.11, 0.02, 18).translate(x, y - 0.32, z)) # the cup it stands in
			it.rod([x, y - 0.33, z], [s * wall_x.call(z, y - 0.33, 0.01), y - 0.33, z], 0.012, MAT.metal, 6) # (its cup's arm to the wall)
	it.stencil(["OXYGEN"], 0.14, [-wall_x.call(0.75, -1.2, 0.235), -1.2, 0.75], PI / 2, "#1a1a1a")

	# ---- the ball turret: the azimuth drum on its top, the hand crank, and the support column up to its beam
	if true:
		var z := -0.13
		var top := -1.58
		var roof: float = it.ceiling_at(z, 0, f + 0.5)
		it.cylinder(0.17, 0.12, 0, top + 0.06, z, "y", M.steel, 24) # the drum: the azimuth ring gear's housing
		it.add(MAT.dark, Geo.torus(0.17, 0.012, 6, 28).rotate_x(PI / 2).translate(0, top + 0.12, z))
		for k in 12:
			var a := (k / 12.0) * PI * 2
			it.add(MAT.metal, Geo.sphere(0.008, 5, 3).translate(cos(a) * 0.155, top + 0.122, z + sin(a) * 0.155))
		it.cylinder(0.045, 0.1, 0.2, top + 0.05, z, "x", M.steel, 12) # the hand crank's gearbox
		it.rod([0.25, top + 0.05, z], [0.25, top + 0.05, z + 0.13], 0.01, MAT.metal, 6) # its arm
		it.cylinder(0.014, 0.09, 0.25, top + 0.095, z + 0.13, "y", MAT.dark, 8) # and handle
		it.cylinder(0.042, roof - (top + 0.12), 0, (roof + top + 0.12) / 2, z, "y", M.zinc, 14) # the column
		for y in [top + 0.16, roof - 0.06]:
			it.cylinder(0.06, 0.04, 0, y, z, "y", MAT.metal, 14) # its collars
		var by := roof - 0.04
		var bw: float = wall_x.call(z, by, 0.02)
		if is_finite(bw):
			beam.call([-bw, by, z], [bw, by, z], 0.07, 0.05, Vector3(0, 1, 0), M.zinc) # the beam across under the roof
			for s in [-1, 1]:
				beam.call([s * 0.05, by - 0.02, z], [s * 0.3, by - 0.02, z], 0.008, 0.09, Vector3(0, 0, 1), M.zinc) # (gussets either side of the column)
		it.stencil(["BALL TURRET", "HAND CRANK"], 0.12, [0.25, top + 0.15, z + 0.01], 0, "#d8d0a8")

	# ---- the radio room's door, swung open flat against the aft face of its bulkhead (left of the doorway)
	if true:
		var bz := -1.25 + 0.04
		var hx := -0.33
		var y0 := -1.78
		var y1 := -0.3
		var wd := minf(0.56, wall_x.call(bz, y1, 0.04) + hx)
		var x1 := hx - wd
		it.add(MAT.green, it.box_geo(wd, y1 - y0, 0.022).translate((hx + x1) / 2, (y0 + y1) / 2, bz + 0.012))
		for ab in [[[hx, y0, bz + 0.03], [x1, y0, bz + 0.03]], [[hx, y1, bz + 0.03], [x1, y1, bz + 0.03]], [[hx, y0, bz + 0.03], [hx, y1, bz + 0.03]], [[x1, y0, bz + 0.03], [x1, y1, bz + 0.03]], [[hx, (y0 + y1) / 2, bz + 0.03], [x1, (y0 + y1) / 2, bz + 0.03]]]:
			beam.call(ab[0], ab[1], 0.035, 0.012, Vector3(0, 0, 1), M.zinc) # its frame
		for y in [y0 + 0.2, y1 - 0.2]:
			it.cylinder(0.014, 0.1, hx + 0.005, y, bz + 0.01, "y", MAT.dark, 8) # the hinges
		it.add(MAT.metal, it.box_geo(0.03, 0.12, 0.03).translate(x1 + 0.05, (y0 + y1) / 2 + 0.1, bz + 0.05)) # the latch handle
		it.stencil(["RADIO", "COMPARTMENT"], 0.2, [(hx + x1) / 2, y1 - 0.35, bz + 0.041], 0, "#d8d0a8")

	# ---- the parts drawn with one size of window or the other (interior.js setWaistWide swaps them)
	it.waist_parts = {}
	for s in [-1, 1]:
		var parts := {}
		it.waist_parts["L" if s < 0 else "R"] = parts
		for state in ["small", "wide"]:
			var g := Node3D.new()
			parts[state] = g
			var by_mat := {}
			var order := []
			for mg in swap[s][state]:
				if not by_mat.has(mg[0]):
					by_mat[mg[0]] = []
					order.append(mg[0])
				var geo = mg[1]
				by_mat[mg[0]].append(geo.to_non_indexed() if not geo.indices.is_empty() else geo)
			for mat in order:
				var m := MeshInstance3D.new()
				var list: Array = by_mat[mat]
				for geo in list: # (all alike for the merge: no uv or custom attributes on these)
					geo.uvs = PackedVector2Array()
					geo.colors = PackedColorArray()
				m.mesh = Geo.merge(list).to_mesh(mat)
				m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
				g.add_child(m)
			g.visible = state == "small"
			it.group.add_child(g)
