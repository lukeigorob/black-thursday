extends RefCounted
# More of what fills a real B-17: the stringers and conduit along the walls and ceiling, dome lights,
# the throttle pedestal, rudder pedals and armour plate in the cockpit, the navigator's instruments,
# ammunition cans, oxygen bottles and an extinguisher in the nose, spent .50 cases rolling on the
# waist and tail floors, flak helmets and vests, a first-aid kit, the radio operator's lamp and log,
# the tail gunner's knee pads and seat; the Norden's knobs and the bombardier's panel, oxygen
# regulators and interphone boxes at every post, the engineer's panel, frames round the side windows
# (found from the model's window cut-outs), the catwalk's supports, bomb shackles, the radio sets on
# their racks, chest packs and Mae Wests on hooks, fire extinguishers, rivets along the frames, and
# wear and oil stains on the floor. All decoration: no colliders, clear of the walkway and the gun
# views, merged per material (each material is one draw call however many parts use it).

const Geo := preload("res://src/core/geo.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Cabinlook := preload("res://src/cabinlook.gd")

static func std(c, r := 0.7, m := 0.0) -> ShaderMaterial:
	return Cabinlook.std({color = c, roughness = r, metalness = m})
static var M := {}
static func _materials() -> void:
	if not M.is_empty():
		return
	M = {
		stringer = std(0x7a7f6c, 0.6, 0.4),
		brass = std(0xb58a3c, 0.35, 0.9),
		white = std(0xd8d4c6, 0.8),
		od = std(0x4a4f33, 0.75, 0.1),
		helmet = std(0x4d5236, 0.6, 0.2),
		knob = std(0x8a1c14, 0.5),
		black = std(0x161616, 0.6),
		paper = std(0xd9cfae, 0.95),
		lamp = Cabinlook.std({color = 0xfff1c8, emissive = 0xffd88a, emissiveIntensity = 0.6, roughness = 0.4}),
		mae = std(0xc29a2a, 0.75),
		stain = null, # made on first use (a canvas texture)
	}

static func stain_material() -> ShaderMaterial: # a soft dark blot: oil, hydraulic fluid, scuffs from boots
	var g := Canvas2D.new(64, 64)
	var grd = g.create_radial_gradient(32, 32, 2, 32, 32, 31)
	grd.add_color_stop(0, "rgba(20,16,10,0.55)"); grd.add_color_stop(0.6, "rgba(25,20,12,0.25)"); grd.add_color_stop(1, "rgba(25,20,12,0)")
	g.fill_style = grd; g.fill_rect(0, 0, 64, 64)
	var m := Cabinlook.std({map = g.texture(true), transparent = true, depthWrite = false, roughness = 0.4})
	m.set_shader_parameter("lift", 0.0015) # (Three's polygonOffset)
	return m

static var seed_ := 2024
static func rnd() -> float:
	seed_ = (seed_ * 16807) % 2147483647
	return float(seed_) / 2147483647
static func rand(a: float, b: float) -> float:
	return a + rnd() * (b - a)

static func dial_plate(n: int) -> ShaderMaterial: # a little instrument board: rows of dials on black
	var g := Canvas2D.new(256, 128)
	g.fill_style = "#1b1b1a"; g.fill_rect(0, 0, 256, 128)
	for i in n:
		var x := 34 + (i % 4) * 62
		var y := 34 + floori(i / 4.0) * 60
		g.fill_style = "#080808"; g.begin_path(); g.arc(x, y, 25, 0, 7); g.fill()
		g.stroke_style = "#d8d4c4"; g.line_width = 2
		for k in 10:
			var a := k * 0.63
			g.begin_path(); g.move_to(x + cos(a) * 18, y + sin(a) * 18); g.line_to(x + cos(a) * 23, y + sin(a) * 23); g.stroke()
		var a := rnd() * 6.28
		g.line_width = 3; g.begin_path(); g.move_to(x, y); g.line_to(x + cos(a) * 17, y + sin(a) * 17); g.stroke()
	return Cabinlook.std({map = g.texture(true), roughness = 0.5})

## it = the Interior (its add / box / rod / cylinder helpers and hull table), MAT its materials.
static func add_more_detail(it, MAT: Dictionary, DECKS: Array) -> void:
	_materials()
	seed_ = 2024
	var deck_at := func(z: float):
		for d in DECKS:
			if z >= d.z0 and z < d.z1:
				return d
		return null
	var wall_x := func(z: float, y: float, inset := 0.02) -> float: return it.hw(z, y) - inset

	# ---- structure: stringers along the walls between the frames (not across the windows)
	var windows := [[1.3, 2.3, 0.5, 1.25], [-2.5, -1.4, 0.9, 1.6]] # waist windows, radio room window: z0, z1, height band above the deck
	for s in [-1, 1]:
		for up in [0.22, 0.6, 1.0, 1.45]:
			var prev = null
			var z := -2.5
			while z <= 9.4:
				var d = deck_at.call(z)
				if d == null:
					prev = null
					z += 0.25
					continue
				var y: float = d.y + up
				var w: float = wall_x.call(z, y)
				var blocked := windows.any(func(q): return z > q[0] and z < q[1] and up > q[2] and up < q[3]) or (z > -1.2 and z < 5.15) # (the waist's own: waist.js)
				if not (w > 0.2) or not is_finite(w) or blocked:
					prev = null
					z += 0.25
					continue
				var p := [s * w, y, z]
				if prev != null and absf(prev[1] - p[1]) < 0.3:
					it.rod(prev, p, 0.011, M.stringer, 4)
				prev = p
				z += 0.25
	# conduit along the ceiling with junction boxes, and the dome lights
	var prev = null
	var z := -2.4
	while z <= 4.4: # (the tail is too low for it: it would hang at head height)
		var d = deck_at.call(z)
		if d == null or (z > -2.45 and z < -0.9): # (not across the radio room's gun hatch)
			prev = null
			z += 0.5
			continue
		var y: float = it.ceiling_at(z, 0.18, d.y + 0.3) - 0.06
		var p := [0.18, y, z]
		if prev != null and absf(prev[1] - y) < 0.4:
			it.rod(prev, p, 0.016, M.od, 6)
		prev = p
		if absf(fmod(z, 2)) < 0.01:
			it.add(M.od, it.box_geo(0.1, 0.06, 0.12).translate(0.18, y - 0.03, z))
		z += 0.5
	for lz in [-2.5, 0.6, 3.6]: # (the radio room's ahead of its gun hatch) // (none in the tail passage: the roof is so low there it hung right in your eye line)
		var d = deck_at.call(lz)
		var y: float = it.ceiling_at(lz, 0, d.y + 0.3)
		it.add(M.black, it.cyl_geo(0.07, 0.08, 0.04, 14).translate(-0.12, y - 0.02, lz))
		it.add(M.lamp, Geo.sphere(0.05, 12, 6, 0, PI * 2, PI / 2, PI / 2).translate(-0.12, y - 0.04, lz))

	# (the cockpit's panel, controls, seats, side panels and padding are in cockpitb17.js)

	# ---- nose: ammunition for the cheek and nose guns, the oxygen bottles, a fire extinguisher, the
	# Norden's stabiliser and eyepiece on their stand
	var nf := -0.72
	for s in [-1, 1]:
		it.box(s * 0.55 - 0.13, s * 0.55 + 0.13, nf, nf + 0.28, -9.95, -9.65, MAT.ammo, false)
	for xz in [[-0.42, -10.35], [0.5, -10.3]]: # spare boxes for the nose guns, on the floor by the glass
		var x: float = xz[0]
		var bz: float = xz[1]
		it.box(x - 0.1, x + 0.1, nf, nf + 0.2, bz - 0.13, bz + 0.13, MAT.ammo, false)
		it.box(x - 0.105, x + 0.105, nf + 0.2, nf + 0.215, bz - 0.135, bz + 0.135, MAT.dark, false) # (the lid)
	for iy in [[0, -0.42], [1, -0.26]]: # two yellow A-4 oxygen bottles strapped along the right wall
		var bz: float = -9.55 - iy[0] * 0.02
		var y: float = iy[1]
		var x: float = wall_x.call(bz, y, 0.13)
		it.add(M.mae, Geo.capsule(0.075, 0.3, 4, 14).rotate_x(PI / 2).translate(x, y, bz))
		it.cylinder(0.012, 0.04, x, y, bz - 0.25, "z", MAT.metal, 8) # its valve
	for sz in [-9.45, -9.68]:
		it.rod([wall_x.call(sz, -0.5, 0.03), -0.5, sz], [wall_x.call(sz, -0.16, 0.03), -0.16, sz], 0.006, M.black, 4) # the straps
	if true: # the fire extinguisher on its bracket, left wall by the bulkhead
		var ez := -9.05
		var y := -0.35
		var x: float = -wall_x.call(ez, y, 0.08)
		it.add(M.knob, it.cyl_geo(0.05, 0.05, 0.36, 14).translate(x, y, ez))
		it.add(M.knob, Geo.sphere(0.05, 12, 6, 0, PI * 2, 0, PI / 2).translate(x, y + 0.18, ez))
		it.add(M.black, it.box_geo(0.03, 0.06, 0.1).translate(x, y + 0.24, ez)) # the head and its handle
		it.rod([x, y + 0.22, ez + 0.04], [x + 0.05, y + 0.05, ez + 0.07], 0.007, M.black, 5) # the hose
		for dy in [-0.1, 0.1]:
			it.box(x - 0.06, x - 0.045, y + dy - 0.01, y + dy + 0.01, ez - 0.06, ez + 0.06, MAT.metal, false)
	# the Norden: the stabiliser on the stand, the sight head on it with the telescope and the eyepiece
	it.box(-0.12, 0.12, -0.27, -0.2, -10.62, -10.34, M.black, false)
	it.cylinder(0.035, 0.12, 0, -0.18, -10.62, "z", MAT.metal, 12) # the telescope's barrel, out ahead
	it.cylinder(0.022, 0.06, 0, 0.03, -10.4, "y", M.black, 12) # the eyepiece on top, with its rubber cup
	it.add(M.black, Geo.torus(0.024, 0.008, 6, 14).rotate_x(PI / 2).translate(0, 0.065, -10.4))
	for s in [-1, 1]:
		it.box(s * 0.13 - 0.01, s * 0.13 + 0.01, -0.2, -0.04, -10.56, -10.46, MAT.metal, false) # (the side plates the knobs are on)

	# ---- the waist: spent cases on the floor round the guns, helmets and flak vests, a first-aid kit
	var cases := func(n: int, x0: float, x1: float, z0: float, z1: float, y: float) -> void:
		for i in n:
			var g = it.cyl_geo(0.0065, 0.0065, 0.1, 6).rotate_z(PI / 2).rotate_y(rand(0, PI))
			it.add(M.brass, g.translate(rand(x0, x1), y + 0.007, rand(z0, z1)))
	for s in [-1, 1]:
		cases.call(70, 0.2 if s > 0 else -0.75, 0.75 if s > 0 else -0.2, 1.2, 2.7, -1.95)
	cases.call(40, -0.3, 0.3, 9.2, 10.0, -2.32)
	cases.call(14, -0.5, 0.5, -7.0, -6.5, -0.40) # under the top turret
	for xz in [[-0.62, 3.35], [0.66, 0.4]]: # M4 flak helmets on the floor
		it.add(M.helmet, Geo.sphere(0.13, 12, 6, 0, PI * 2, 0, PI / 2).translate(xz[0], -1.95, xz[1]))
	for s in [-1, 1]: # flak vests hung on the wall behind each gunner
		var vz := 2.85
		var y := -1.25
		var x: float = s * wall_x.call(vz, y, 0.05)
		it.add(M.od, it.box_geo(0.04, 0.5, 0.36).translate(x, y, vz))
		it.rod([x, y + 0.25, vz], [s * wall_x.call(vz, y + 0.4, 0.02), y + 0.36, vz], 0.006, MAT.metal)
	if true: # the first-aid kit, white with its red cross (on the left wall: the main door's on the right, there)
		var fz := 4.4
		var y := -1.15
		var x: float = -wall_x.call(fz, y, 0.05)
		it.add(M.white, it.box_geo(0.06, 0.24, 0.32).translate(x, y, fz))
		it.add(M.knob, it.box_geo(0.004, 0.14, 0.04).translate(x + 0.031, y, fz))
		it.add(M.knob, it.box_geo(0.004, 0.04, 0.14).translate(x + 0.031, y, fz))

	# ---- the tail gunner's knee pads, and his little seat behind him on its post
	for s in [-1, 1]:
		it.box(s * 0.13 - 0.07, s * 0.13 + 0.07, -2.32, -2.26, 9.85, 10.1, MAT.leather, false)
	it.cylinder(0.02, 0.3, 0, -2.17, 9.3, "y", MAT.metal, 8)
	it.box(-0.11, 0.11, -2.03, -1.98, 9.2, 9.42, MAT.leather, false)

	var plates := dial_plate(8)
	var panel := func(w: float, h: float, x: float, y: float, pz: float, rot_y: float) -> void:
		var m: MeshInstance3D = it.mesh_of(Geo.plane(w, h), plates, it.group)
		m.position = Vector3(x, y, pz); m.rotation.y = rot_y

	# ---- the nose: the Norden's knobs, the bombardier's panel on the left wall
	for s in [-1, 1]:
		it.cylinder(0.022, 0.03, s * 0.125, -0.14, -10.5, "x", M.black, 10)
	it.box(-0.04, 0.04, -0.06, 0.0, -10.62, -10.56, M.black, false)
	if true:
		var pz := -10.15
		var y := -0.25
		var x: float = -wall_x.call(pz, y, 0.06)
		it.box(x - 0.03, x + 0.02, y - 0.1, y + 0.1, pz - 0.17, pz + 0.17, MAT.dark, false); panel.call(0.32, 0.18, x + 0.021, y, pz, PI / 2)

	# ---- the cockpit: the engineer's panel on the right wall behind the co-pilot
	if true:
		var pz := -6.95
		var y := 0.35
		var x: float = wall_x.call(pz, y, 0.06)
		it.box(x - 0.02, x + 0.03, y - 0.15, y + 0.15, pz - 0.24, pz + 0.24, MAT.dark, false); panel.call(0.46, 0.28, x - 0.021, y, pz, -PI / 2)

	# ---- frames round the side windows (where the model's skin is cut for glass)
	var frame := func(side: int, z0: float, z1: float, y0: float, y1: float, splits := []) -> void:
		var P := func(fz: float, y: float) -> Array: return [side * wall_x.call(fz, y, 0.012), y, fz]
		it.rod(P.call(z0, y0), P.call(z1, y0), 0.009, MAT.metal); it.rod(P.call(z0, y1), P.call(z1, y1), 0.009, MAT.metal)
		for fz in [z0] + splits + [z1]:
			it.rod(P.call(fz, y0), P.call(fz, y1), 0.009, MAT.metal)
	for side in [-1, 1]:
		frame.call(side, -9.4, -8.2, -0.72, -0.38) # the nose's side windows
		frame.call(side, -2.52, -2.08, -0.25, 0.06) # the radio room's

	# ---- the bomb bay: posts and braces under the catwalk
	var bz := -5.5
	while bz <= -2.7:
		for x in [-0.12, 0.12]:
			it.rod([x, -2.2, bz], [x, -1.66, bz], 0.012, MAT.metal)
			it.rod([x, -2.2, bz], [x, -1.7, bz + 0.6], 0.008, MAT.metal)
		bz += 0.6
	# (the bombs' shackles and racks: interior.js buildBombBay)

	# ---- the radio room (its sets are in stations.js): the shelf under the command sets
	var sx: float = wall_x.call(-1.75, -1.25, 0.08)
	it.box(sx - 0.1, sx + 0.04, -1.25, -1.22, -1.98, -1.52, MAT.metal, false) # the shelf

	# ---- oxygen regulators and interphone jack boxes at every post, on the nearest wall
	var posts := [[-10.25, -0.35, -1], [-9.5, 0.05, -1], [-7.55, 0.2, -1], [-7.55, 0.2, 1], [-6.75, 0.45, 1], [-2.3, -1.25, -1], [9.2, -1.85, 1], [-0.2, -1.5, 1]]
	var reg_mat := dial_plate(1)
	var outlets := [] # (where each man's mask hose plugs in: figure.js runs it to him)
	it.group.set_meta("oxygen", outlets)
	for q in posts:
		var pz: float = q[0]
		var y: float = q[1]
		var side: int = q[2]
		var x: float = side * wall_x.call(pz, y, 0.035)
		it.add(M.od, it.box_geo(0.05, 0.14, 0.1).translate(x, y, pz))
		var face: MeshInstance3D = it.mesh_of(Geo.plane(0.07, 0.07), reg_mat, it.group)
		face.position = Vector3(x - side * 0.026, y + 0.03, pz); face.rotation.y = -side * PI / 2
		it.rod([x - side * 0.02, y - 0.07, pz], [x - side * 0.03, y - 0.1, pz], 0.012, M.black) # its outlet
		outlets.append(Vector3(x - side * 0.03, y - 0.1, pz))
		var jx: float = side * wall_x.call(pz + 0.16, y - 0.05, 0.03)
		it.add(M.black, it.box_geo(0.04, 0.08, 0.06).translate(jx, y - 0.05, pz + 0.16)) # interphone jack box
		it.rod([jx - side * 0.02, y - 0.09, pz + 0.16], [jx - side * 0.08, y - 0.3, pz + 0.22], 0.004, M.black)

	# ---- chest packs and Mae Wests on their hooks, fire extinguishers
	for q in [[-1.55, -1.05, -1], [3.85, -1.15, -1], [3.85, -1.15, 1], [-9.0, -0.05, 1], [-7.0, 0.1, -1]]:
		var pz: float = q[0]
		var y: float = q[1]
		var side: int = q[2]
		var x: float = side * wall_x.call(pz, y, 0.08)
		it.add(M.od, it.box_geo(0.11, 0.22, 0.32).translate(x, y, pz))
		for dz in [-0.09, 0.09]:
			it.add(MAT.metal, Geo.torus(0.018, 0.005, 4, 8).rotate_y(PI / 2).translate(x - side * 0.06, y + 0.06, pz + dz))
		var mz := pz + 0.32
		var mx: float = side * wall_x.call(mz, y, 0.06)
		for dz in [-0.05, 0.05]:
			it.add(M.mae, Geo.capsule(0.04, 0.22, 3, 8).translate(mx, y - 0.05, mz + dz))
		it.rod([mx, y + 0.12, mz], [side * wall_x.call(mz, y + 0.2, 0.02), y + 0.2, mz], 0.005, MAT.metal) # the hook
	for q in [[0.72, -0.18, -7.05], [-0.7, -1.7, 4.05], [0.36, -1.95, 8.65]]:
		it.cylinder(0.06, 0.36, q[0], q[1], q[2], "y", MAT.red, 12)
		it.cylinder(0.015, 0.06, q[0], q[1] + 0.21, q[2], "y", M.black, 6)

	# ---- rivets along the fuselage frames, from the radio room to the tail
	var rz := -2.5
	while rz < 9.5:
		var deck = deck_at.call(rz)
		if deck != null and (it.frame_zs.is_empty() or it.frame_zs.has(rz)): # (no frame here, across a window or the gun hatch: no rivets hanging in the air)
			var pts: Array = it.outline(rz, deck.y + 0.9, 0.03)[2]
			for i in range(0, pts.size(), 2):
				var p: Vector2 = pts[i]
				if p.y < deck.y + 0.05:
					continue
				it.add(MAT.metal, Geo.sphere(0.006, 4, 3).translate(p.x, p.y, rz + 0.035))
		rz += 0.5

	# ---- quilted insulation on the radio room's walls, between the frames below the window
	var patch := func(side: int, z0: float, z1: float, y0: float, y1: float, mat) -> void: # a strip of wall lining following the hull's curve
		var pts := PackedVector3Array()
		var uv := PackedVector2Array()
		var idx := PackedInt32Array()
		var rows := 6
		for i in rows + 1:
			for kz in [[0, z0], [1, z1]]:
				var y := y0 + (y1 - y0) * (float(i) / rows)
				pts.append(Vector3(side * wall_x.call(kz[1], y, 0.045), y, kz[1])); uv.append(Vector2(kz[0], float(i) / rows))
		for i in rows:
			var a := i * 2
			idx.append_array([a, a + 1, a + 2, a + 1, a + 3, a + 2])
		if side > 0:
			var flipped := PackedInt32Array()
			for j in idx.size():
				flipped.append(idx[j - (j % 3) + [0, 2, 1][j % 3]])
			idx = flipped
		var g = Geo.from_arrays(pts, null, uv, idx)
		g.compute_vertex_normals()
		it.add(mat, g.to_non_indexed())
	for side in [-1, 1]:
		var pz := -2.45
		while pz < -1.4:
			patch.call(side, pz + 0.05, pz + 0.45, -1.7, -0.95, MAT.pad)
			pz += 0.5

	# ---- pulleys on the control cables, every two metres along both walls
	for s in [-1, 1]:
		for pz in [0, 2, 4, 6, 8]:
			if pz > 1 and pz < 2.6:
				continue # (not in the waist window)
			var d = deck_at.call(pz)
			var y: float = d.y + 1.32
			var x: float = s * (it.hw(pz, y) - 0.06)
			if not is_finite(x) or absf(x) < 0.2:
				continue
			it.add(M.black, Geo.torus(0.03, 0.008, 5, 14).rotate_y(PI / 2).translate(x, y, pz))
			it.add(MAT.metal, it.box_geo(0.02, 0.07, 0.03).translate(x + s * 0.03, y, pz))

	# ---- wear and oil on the floor: under the guns, along the walkway, round the turrets
	if M.stain == null:
		M.stain = stain_material()
	var stains := [[0, -1.95, 1.9, 1.2], [-0.45, -1.95, 2.3, 0.6], [0.45, -1.95, 2.0, 0.6], [0, -1.95, 3.6, 0.9], [0, -1.8, -1.9, 0.7], [0.1, -1.95, 0.9, 0.8], [0, -2.32, 9.6, 0.5], [0, -0.4, -6.75, 0.8], [0.2, -0.72, -9.3, 0.7], [0, -2.15, 6.6, 0.5]]
	for q in stains:
		it.add(M.stain, Geo.plane(q[3] * rand(0.8, 1.3), q[3]).rotate_x(-PI / 2).rotate_y(rand(0, 3)).translate(q[0], q[1] + 0.003, q[2]))
