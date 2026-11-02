extends RefCounted
# The inside of the Sperry upper turret, as in the photos of a real one: you stand with your head up in a
# low dome of glass panes in a frame of riveted arches (zinc-chromate green, worn to bare metal at the
# edges), which turns with the guns but stays level when they elevate, as the real one does. The tall
# front pane between two heavy frames; either side of it the vertical slot the gun's barrel runs up and
# down in; over your head the arches meeting. The guns themselves (weapons.js, browning.js) sit either side
# of your head, their jacketed barrels out through the slots. Between them, low in front of you, the yoke
# that ties them together with the reflector sight on it, which tilts with them; down at your sides the
# steel deflector plates, and the canvas ammunition bag hanging on the left.
# Built in the camera's frame (-Z = where you look); meta "level" is the part kept level.

const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")
const Cabinlook := preload("res://src/cabinlook.gd")
const BallTurret := preload("res://src/ballturret.gd")

const R := 0.6 # m, radius of the dome
const H := 0.56 # m, height of the dome above its base ring
const BASE := -0.3 # m, the base ring is this far below your eye
const SLOT_X := 0.27 # m either side of the middle: the guns' plane, and the slots up the dome in it (interior.js twin)
const SLOT_W := 0.032 # m, half the slot's width

static func D(deg: float) -> float:
	return deg * PI / 180.0

## Merged, positions and normals only.
static func solid(list: Array):
	var out := []
	for x in list:
		var y = x.to_non_indexed() if not x.indices.is_empty() else x
		y.uvs = PackedVector2Array()
		y.colors = PackedColorArray()
		if y.normals.is_empty():
			y.compute_vertex_normals()
		out.append(y)
	return Geo.merge(out)

static func _mesh(geo, mat: Material) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = geo.to_mesh(mat)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return m

static func build_top_turret() -> Node3D:
	var g := Node3D.new()
	g.name = "TopCockpit"
	var shell := Node3D.new() # turns with the turret, kept level (player.js)
	var green := Cabinlook.std({color = 0x55603a, roughness = 0.72, metalness = 0.3}) # zinc chromate, worn
	var steel := Cabinlook.std({color = 0x6c705e, roughness = 0.5, metalness = 0.7}) # rivet heads (painted over, worn bright), plates
	var dark := Cabinlook.std({color = 0x1c1d1b, roughness = 0.7, metalness = 0.5})
	var canvas := Cabinlook.std({color = 0x6b6a4a, roughness = 0.95, metalness = 0})
	# a point on the dome at elevation `el` and bearing `az` (0 = ahead, -Z, + to the left)
	var on := func(el: float, az: float, r := 0.995) -> Vector3: return Vector3(-sin(az) * cos(el) * R * r, BASE + sin(el) * H * r, -cos(az) * cos(el) * R * r)
	# the glass: the dome, open along the two gun slots (straight up the dome in the guns' planes, x = +-SLOT_X,
	# ahead of you: the barrels run up and down in them as they elevate)
	var dome = Geo.sphere(R, 96, 32, 0, PI * 2, 0, PI / 2).scale(1, H / R, 1).translate(0, BASE, 0).to_non_indexed()
	var P: PackedVector3Array = dome.positions
	var keep := PackedVector3Array()
	for t in range(0, P.size(), 3):
		var x := (P[t].x + P[t + 1].x + P[t + 2].x) / 3
		var z := (P[t].z + P[t + 1].z + P[t + 2].z) / 3
		if z < 0 and absf(absf(x) - SLOT_X) < SLOT_W:
			continue
		keep.append_array([P[t], P[t + 1], P[t + 2]])
	var glass_geo = Geo.from_arrays(keep)
	glass_geo.compute_vertex_normals()
	var glass_mat := BallTurret.glass_material()
	glass_mat.render_priority = 3
	var glass := _mesh(glass_geo, glass_mat)
	# the steel skirt the dome sits on, down into the fuselage
	var skirt_mat: ShaderMaterial = dark.duplicate()
	Cabinlook.refeature(skirt_mat, {cull = "front"})
	var skirt := _mesh(Geo.cylinder(R + 0.01, R - 0.04, 0.3, 40, 1, true).translate(0, BASE - 0.15, 0), skirt_mat)
	# the frame: a box-section bar along the dome from one point to the next, and rivets along it
	var frame := []
	var rivets := []
	var arch := func(pts: Array, w := 0.018, d := 0.014, every := 0.035) -> void:
		var left := 0.0
		for k in pts.size() - 1:
			var a: Vector3 = pts[k]
			var b: Vector3 = pts[k + 1]
			var mid := (a + b) * 0.5
			var len := a.distance_to(b)
			var z := (b - a).normalized()
			var out := (mid - Vector3(0, BASE, 0)).normalized()
			var x := out.cross(z).normalized()
			var y := z.cross(x)
			frame.append(Geo.box(w, d, len + 0.004).apply_transform(Transform3D(Basis(x, y, z), mid + out * (-d / 2))))
			left += len
			while left > every: # round-head rivets in two rows down the bar
				var p := a.lerp(b, 1 - left / len) + out * (-d - 0.002)
				for s in [-1, 1]:
					rivets.append(Geo.sphere(0.0026, 5, 3).translate(p.x + x.x * s * w * 0.3, p.y + x.y * s * w * 0.3, p.z + x.z * s * w * 0.3))
				left -= every
	var meridian := func(az: float, el1: float = D(80), n := 14) -> Array:
		var out := []
		for k in n + 1:
			out.append(on.call((float(k) / n) * el1, az))
		return out
	# a line straight up the dome's front at x (a slot's edge): from the base ring to near the crown
	var upright := func(x: float, n := 16) -> Array:
		var pts := []
		for k in n + 1:
			var y := BASE + 0.01 + (float(k) / n) * H * 0.9
			var rh := R * sqrt(maxf(0, 1 - pow((y - BASE) / H, 2))) * 0.995
			pts.append(Vector3(x, y, -sqrt(maxf(0, rh * rh - x * x))))
		var out := []
		for k in pts.size():
			if k == 0 or pts[k].z < -0.02 or pts[k - 1].z < -0.02:
				out.append(pts[k])
		return out
	# the heavy frames either side of the front pane (the slots' inner edges), and the slots' outer edges
	for s in [-1, 1]:
		arch.call(upright.call(s * (SLOT_X - SLOT_W - 0.014)), 0.026, 0.018); arch.call(upright.call(s * (SLOT_X + SLOT_W + 0.012)), 0.02, 0.016)
	# the front pane's arched head between the heavy frames, high up, and the arches over the top
	if true:
		var up: Array = upright.call(SLOT_X - SLOT_W - 0.014)
		var top: Vector3 = up[up.size() - 1]
		var pts := []
		for k in 9:
			var x := top.x * (1 - (2.0 * k) / 8)
			var y := top.y + 0.04 * sin((k / 8.0) * PI)
			var rh := R * sqrt(maxf(0, 1 - pow((y - BASE) / H, 2))) * 0.995
			pts.append(Vector3(x, y, -sqrt(maxf(0.0001, rh * rh - x * x))))
		arch.call(pts, 0.022, 0.016)
	for deg in [70, 110, 150, 180, 210, 250, 290]:
		arch.call(meridian.call(D(deg), D(76), 12), 0.022 if deg == 180 else 0.016, 0.013, 0.05)
	var crown := []
	for k in 41:
		crown.append(on.call(D(76), (k / 40.0) * PI * 2))
	arch.call(crown, 0.016, 0.013, 0.06) # the crown ring the arches meet
	shell.add_child(_mesh(solid(frame), green))
	shell.add_child(_mesh(solid(rivets), steel))
	# the riveted base ring, under your line of sight, all the way round: it stands proud of the fuselage's
	# decking (raised clear of it: the hull's top hid its back half), depth-tested like everything else
	var ring := [Geo.torus(R - 0.01, 0.022, 8, 64).rotate_x(PI / 2).translate(0, BASE + 0.07, 0)]
	var ring_rivets := []
	for k in 64:
		var a := (k / 64.0) * PI * 2
		ring_rivets.append(Geo.sphere(0.0035, 5, 3).translate(cos(a) * (R - 0.034), BASE + 0.098, sin(a) * (R - 0.034)))
	shell.add_child(_mesh(solid(ring), green))
	shell.add_child(_mesh(solid(ring_rivets), steel))
	# down at your sides: the steel deflector plates angled in under the guns, and the canvas ammo bag on the left
	var plates := []
	for s in [-1, 1]:
		plates.append(Geo.box(0.008, 0.34, 0.3).rotate_z(s * 0.35).translate(s * 0.36, BASE - 0.12, -0.08))
		plates.append(Geo.box(0.2, 0.008, 0.26).rotate_z(s * -0.5).translate(s * 0.24, BASE - 0.02, -0.12))
	shell.add_child(_mesh(solid(plates), steel))
	var bag := _mesh(Geo.capsule(0.11, 0.26, 4, 10).scale(1, 1, 0.6).rotate_z(0.15).translate(-0.48, BASE - 0.22, 0.12), canvas)
	shell.add_child(glass)
	shell.add_child(skirt)
	shell.add_child(bag)
	# the yoke between the guns and the reflector sight on it, low in front of you, tilting with your aim
	var sight := Node3D.new()
	var yoke := [
		Geo.box(0.5, 0.03, 0.05).translate(0, -0.2, -0.16), # the cross-beam tying the guns together
		Geo.box(0.06, 0.08, 0.05).translate(0, -0.165, -0.16), # its centre post
		Geo.box(0.05, 0.035, 0.085).translate(0, -0.12, -0.2), # the sight's housing
		Geo.cylinder(0.014, 0.014, 0.05, 10).rotate_x(PI / 2).translate(0, -0.13, -0.15), # its lamp
	]
	sight.add_child(_mesh(solid(yoke), dark))
	var plate_mat := Mat.physical({color = 0xbfd8e0, transparent = true, opacity = 0.12, roughness = 0.05, depthWrite = false, side = Mat.DOUBLE})
	plate_mat.render_priority = 4
	var plate := _mesh(Geo.plane(0.05, 0.036), plate_mat)
	plate.position = Vector3(0, -0.088, -0.23)
	plate.rotation.x = -0.35
	sight.add_child(plate)
	g.add_child(shell)
	g.add_child(sight)
	g.set_meta("level", shell)
	return g
