extends RefCounted
# The Browning M2 .50 calibre, as mounted in a B-17: the flexible guns at the waist windows and in the
# nose cheeks (receiver, back plate and spade grips, the ring-and-post sight, the feed tray and the
# perforated barrel jacket with its muzzle booster), the turret guns (receiver, feed and jacketed barrel:
# the turret has the grips and the sight), and guns of which only the jacketed barrel shows. Built along -Z (where it fires) with the mount's pivot at the origin.
const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")
const CabinLook := preload("res://src/cabinlook.gd")

## The jacket's cooling holes: rows of slots round a dark steel tube (cut out by alpha, so the barrel shows
## through). The browser drew black ovals on a white canvas and used it as an alpha map; here the same
## ovals are the texture's own alpha (Godot has no separate alpha map), worked out per pixel.
static func jacket_texture() -> ImageTexture:
	var img := Image.create(128, 512, false, Image.FORMAT_RGBA8)
	img.fill(Color(1, 1, 1, 1))
	for row in 16:
		for k in 4: # staggered oval slots
			var x := (k + (row % 2) * 0.5) * 32 + 4 + 12
			var y := row * 32 + 8 + 8
			for py in range(y - 7, y + 8):
				for px in range(floori(x) - 10, floori(x) + 11):
					var dx := (px + 0.5 - x) / 9.0
					var dy := (py + 0.5 - y) / 6.0
					var d := sqrt(dx * dx + dy * dy)
					if d < 1.08:
						var a := clampf((d - 0.92) / 0.16, 0, 1) # (an antialiased edge, as the canvas's)
						var wx := posmod(px, 128)
						var old := img.get_pixel(wx, py).a
						img.set_pixel(wx, py, Color(1, 1, 1, minf(old, a)))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

static var HOLES: ImageTexture = jacket_texture()

static func materials() -> Dictionary:
	var jacket := Mat.standard({color = 0x282927, roughness = 0.45, metalness = 0.75, side = Mat.DOUBLE})
	jacket.albedo_texture = HOLES
	jacket.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	jacket.alpha_scissor_threshold = 0.5
	return {
		steel = Mat.standard({color = 0x232423, roughness = 0.5, metalness = 0.7}), # blued, worn
		brass = Mat.standard({color = 0xb58a3c, roughness = 0.35, metalness = 0.9}),
		parker = Mat.standard({color = 0x2c2e2b, roughness = 0.72, metalness = 0.55}), # the receiver's parkerised finish
		grip = Mat.standard({color = 0x241c15, roughness = 0.45, metalness = 0.05}), # bakelite spade grips
		canvas = Mat.standard({color = 0x7a6e52, roughness = 0.95, metalness = 0, side = Mat.DOUBLE}), # the case bag
		jacket = jacket,
	}
static var MATS := {outside = materials(), inside = null} # (inside the cabin they're lit by the cabin, see cabinlook.gd)

static func _mats(inside: bool) -> Dictionary:
	if not inside:
		return MATS.outside
	if MATS.inside == null:
		var m := materials()
		for k in m:
			m[k] = CabinLook.inside_light(m[k])
		MATS.inside = m
	return MATS.inside

const SIGHT := 0.22 # m: the sight line over the bore (the waist gunner's eye, interior.gd)

static func cyl(r0: float, r1: float, z0: float, z1: float, seg := 12, open := false):
	return Geo.cylinder(r1, r0, absf(z1 - z0), seg, 1, open).rotate_x(-PI / 2).translate(0, 0, (z0 + z1) / 2)

static func box(w: float, h: float, d: float, x: float, y: float, z: float):
	return Geo.box(w, h, d).translate(x, y, z)

## kind 'flex': the whole gun, its back plate `rear` metres behind the pivot (z > 0) and its muzzle at
## `-front`. kind 'barrel': only the jacketed barrel, from the pivot (z = 0) out to the muzzle at -front.
## kind 'turret': the jacketed barrel from z = 0, and the receiver `rear` metres long behind it.
## Returns a Node3D; its meta grips = the spade grips (pivot space), receiver = where the cases eject (and
## feed, feed_side: where the belt's chute comes up to; bag: a bag catches the cases).
static func build_browning(kind: String, front: float, rear := 0.12, inside := false, opts := {}) -> Node3D:
	var M := _mats(inside)
	var steel: Array = []
	var parker: Array = []
	var grip: Array = []
	var jacket: Array = []
	var brass: Array = []
	var canvas: Array = []
	var g := Node3D.new()
	var j0 := 0.0 # where the jacket starts
	if kind == "flex":
		# the receiver: the trunnion block at its front (on the mount's pins, at the pivot), the back plate
		# `rear` behind; the belt comes in on the `feed` side (-1 its left, 1 its right, from behind it)
		var fd: float = opts.get("feed", -1) if opts.get("feed") != null else -1.0
		var r0 := rear
		var r1 := maxf(rear - 0.55, -front + 0.95)
		var L := r0 - r1
		var zm := (r0 + r1) / 2
		parker.append(box(0.1, 0.13, L, 0, 0.005, zm)) # the box
		for s in [-1, 1]:
			parker.append(box(0.005, 0.112, L * 0.94, s * 0.0515, 0.003, zm)) # its side plates, riveted on
			for k in 9:
				for y in [-0.042, 0.048]:
					steel.append(Geo.sphere(0.0045, 5, 3).translate(s * 0.054, y, r1 + 0.04 + (k / 8.0) * (L - 0.08)))
		parker.append(box(0.106, 0.024, L * 0.58, 0, 0.081, r0 - L * 0.31)) # the top cover, hinged at its front
		steel.append(cyl(0.008, 0.008, -0.056, 0.056, 8).rotate_y(PI / 2).translate(0, 0.084, r0 - L * 0.6)) # its hinge pin
		steel.append(box(0.03, 0.014, 0.03, 0, 0.098, r0 - 0.035)) # and the latch at its back
		parker.append(box(0.045, 0.03, 0.12, fd * 0.07, 0.055, r0 - L * 0.38)) # the feed tray, out on the belt's side
		steel.append(box(0.012, 0.03, 0.05, fd * 0.093, 0.06, r0 - L * 0.38)) # its belt-holding pawl
		steel.append(box(0.05, 0.004, 0.11, 0, -0.061, r0 - L * 0.4)) # the case ejection slot, underneath
		steel.append(box(0.012, 0.024, L * 0.62, -fd * 0.06, 0.02, r0 - L * 0.42)) # the charging slide, on the other side
		steel.append(cyl(0.011, 0.011, 0, 0.05, 8).rotate_y(PI / 2).translate(-fd * 0.068, 0.02, r0 - L * 0.2)) # its handle
		steel.append(Geo.sphere(0.016, 8, 6).translate(-fd * 0.12, 0.02, r0 - L * 0.2)) # (the knob)
		steel.append(box(0.126, 0.162, 0.022, 0, 0.004, r0 + 0.011)) # back plate
		steel.append(cyl(0.022, 0.02, r0 + 0.02, r0 + 0.06, 12).translate(0, 0.015, 0)) # the buffer tube out of it
		# the spade grips: a bracket each side of the back plate, a handle hanging from it, leaning back
		for s in [-1, 1]:
			steel.append(box(0.016, 0.022, 0.08, s * 0.058, 0.052, r0 + 0.05))
			steel.append(box(0.016, 0.018, 0.07, s * 0.058, -0.088, r0 + 0.045))
			grip.append(cyl(0.017, 0.015, -0.065, 0.065, 10).rotate_x(PI / 2 - 0.3).translate(s * 0.058, -0.02, r0 + 0.085))
			grip.append(Geo.sphere(0.018, 8, 5).translate(s * 0.058, -0.083, r0 + 0.066)) # (its rounded foot)
		# the butterfly trigger between them: two wings, thumbed down to fire
		for s in [-1, 1]:
			steel.append(box(0.04, 0.006, 0.03, 0, 0, 0).rotate_z(s * 0.25).translate(s * 0.019, 0.018, r0 + 0.05))
		steel.append(box(0.012, 0.03, 0.012, 0, -0.002, r0 + 0.035))
		# the ring sight: rings and cross wires on a bracket off the cover; the post, a bead out on the jacket
		# (at SIGHT over the bore line: the gunner's eye looks through the ring onto the bead)
		var rz := r0 - 0.12
		steel.append(Geo.torus(0.045, 0.0028, 5, 32).translate(0, SIGHT, rz))
		steel.append(Geo.torus(0.015, 0.002, 4, 18).translate(0, SIGHT, rz))
		for k in 4:
			steel.append(box(0.0018, 0.03, 0.0018, 0, 0.03, 0).rotate_z(k * PI / 2).translate(0, SIGHT, rz))
		steel.append(box(0.008, SIGHT - 0.14, 0.012, 0, (SIGHT + 0.093 - 0.045) / 2, rz)) # its stem and clamp
		steel.append(box(0.03, 0.01, 0.04, 0, 0.098, rz))
		steel.append(box(0.004, SIGHT - 0.03, 0.004, 0, (SIGHT + 0.03) / 2, -front + 0.3)) # the bead post
		steel.append(Geo.sphere(0.006, 8, 5).translate(0, SIGHT, -front + 0.3))
		steel.append(cyl(0.04, 0.04, -front + 0.33, -front + 0.27, 14)) # (its clamp on the jacket)
		# the trunnion block, its pins in the mount's yoke, and the recoil adapter under it: a spring buffer
		# that lets the gun kick back in the mount
		steel.append(box(0.12, 0.155, 0.085, 0, 0.0, r1 - 0.04))
		steel.append(cyl(0.017, 0.017, -0.09, 0.09, 10).rotate_y(PI / 2).translate(0, -0.01, 0))
		steel.append(cyl(0.028, 0.028, -0.12, 0.14, 12).translate(0, -0.09, 0))
		for k in 6:
			steel.append(Geo.torus(0.031, 0.004, 4, 12).translate(0, -0.09, -0.1 + k * 0.045))
		steel.append(box(0.07, 0.04, 0.05, 0, -0.065, 0.12)) # (and its clamp up to the receiver)
		j0 = r1 - 0.082
		g.set_meta("grips", [Vector3(-0.058, -0.03, r0 + 0.08), Vector3(0.058, -0.03, r0 + 0.08)])
		# the belt: into the feed tray from the chute's mouth, a few rounds side by side in their links
		for k in 6:
			var x := fd * (0.09 + k * 0.022)
			var y := 0.055 - pow(k / 5.0, 2) * 0.07
			brass.append(cyl(0.0065, 0.0065, -0.05, 0.05, 6).translate(x, y, r0 - L * 0.38))
			steel.append(box(0.008, 0.004, 0.08, x, y + 0.008, r0 - L * 0.38))
		steel.append(box(0.06, 0.05, 0.13, fd * 0.205, -0.03, r0 - L * 0.38)) # the chute's end fitting, latched to the tray
		g.set_meta("feed", Vector3(fd * 0.205, -0.055, r0 - L * 0.38)) # where the chute (weapons.gd) comes up to
		g.set_meta("feed_side", fd)
		g.set_meta("receiver", Vector3(0, -0.07, r0 - L * 0.4)) # the ejection slot, underneath
		if opts.get("bag", false): # a canvas bag under the slot to catch the cases, hung from a frame clipped to the receiver
			steel.append(box(0.07, 0.012, 0.15, 0, -0.072, r0 - L * 0.4))
			var prof: Array = []
			for i in 11:
				var t := i / 10.0
				prof.append(Vector2(0.035 + sin(minf(1, t * 1.25) * PI * 0.62) * 0.05 * (1 - t * t * 0.9), -t * 0.3))
			prof.append(Vector2(0.001, -0.305))
			var sack = Geo.lathe(prof, 14).scale(1, 1, 1.7)
			var sp: PackedVector3Array = sack.positions # (slack: pulled about, sagging to the back)
			for i in sp.size():
				var y := sp[i].y
				sp[i] = Vector3(sp[i].x * (1 + sin(i * 1.7) * 0.06), y, sp[i].z - y * y * 0.4)
			sack.positions = sp
			sack.compute_vertex_normals()
			canvas.append(sack.translate(0, -0.075, r0 - L * 0.4))
			g.set_meta("bag", true)
	if kind == "turret": # the receiver behind the jacket, its feed cover and the belt coming in from the side
		parker.append(box(0.085, 0.115, rear, 0, 0, rear / 2 + 0.02))
		parker.append(box(0.088, 0.018, rear * 0.5, 0, 0.066, rear * 0.35))
		steel.append(box(0.092, 0.125, 0.018, 0, 0, rear + 0.03)) # back plate, trunnion block
		steel.append(box(0.095, 0.13, 0.05, 0, 0, 0.02))
		steel.append(box(0.025, 0.025, rear * 0.55, 0.055, 0.02, rear * 0.6)) # the charging handle's slide
		steel.append(box(0.012, 0.05, 0.012, 0.072, 0.02, rear * 0.82)) # its T-handle
		steel.append(box(0.04, 0.012, 0.012, 0.085, 0.045, rear * 0.82))
		steel.append(cyl(0.008, 0.008, -0.048, 0.048, 8).rotate_y(PI / 2).translate(0, 0.074, rear * 0.62)) # the feed cover's hinge pin
		steel.append(cyl(0.022, 0.022, rear + 0.04, rear + 0.1, 10)) # the buffer tube out of the back plate
		for k in 7: # rivets down the side plates
			for s in [-1, 1]:
				for y in [-0.035, 0.035]:
					steel.append(Geo.sphere(0.005, 5, 3).translate(s * 0.0435, y, 0.04 + (k / 6.0) * (rear - 0.06)))
		parker.append(box(0.05, 0.045, 0.1, -0.065, 0.01, rear * 0.4)) # the feed tray, the belt coming in from the side
		g.set_meta("receiver", Vector3(0.06, 0.02, rear * 0.45))
	var j_len := maxf(0.2, front - 0.22 + j0)
	jacket.append(cyl(0.032, 0.032, j0, j0 - j_len, 14, true))
	steel.append(cyl(0.034, 0.034, j0, j0 - 0.025, 14)) # the jacket's end collars
	steel.append(cyl(0.034, 0.034, j0 - j_len + 0.02, j0 - j_len, 14))
	steel.append(cyl(0.012, 0.012, j0, -front + 0.06, 8)) # the barrel inside it
	steel.append(cyl(0.026, 0.018, -front + 0.2, -front, 12)) # muzzle booster
	if kind == "flex": # (its locking collar, the bore's lip)
		steel.append(cyl(0.03, 0.03, -front + 0.2, -front + 0.15, 12))
		steel.append(cyl(0.012, 0.016, -front, -front - 0.012, 10))
	# (a turret's or a fixed barrel's solid parts in one mesh, one draw: the receiver's parkerising and
	# the grips are dark enough to share the steel. A flexible gun, seen up close, gets each its own)
	var flex := kind == "flex"
	for pair in [[steel if flex else steel + parker + grip, M.steel], [parker if flex else [], M.parker], [grip if flex else [], M.grip], [jacket, M.jacket], [brass, M.brass], [canvas, M.canvas]]:
		var list: Array = pair[0]
		if not list.size():
			continue
		var geo = Geo.merge(list.map(func(x): return x.to_non_indexed().delete_attribute("uv")))
		if pair[1] == M.jacket:
			geo = jacket_uv(geo)
		var m := MeshInstance3D.new()
		m.mesh = geo.to_mesh(pair[1])
		g.add_child(m)
	return g

## UVs for the jacket: round the tube and along it, the slots repeated every few cm.
static func jacket_uv(geo):
	var p: PackedVector3Array = geo.positions
	var uv := PackedVector2Array()
	uv.resize(p.size())
	for i in p.size():
		uv[i] = Vector2((atan2(p[i].y, p[i].x) / TAU + 0.5) * 2, p[i].z / 0.12)
	geo.uvs = uv
	return geo

## The flexible gun's mount, the part that turns with it in traverse only: the yoke whose two arms carry
## the trunnion pins (at the origin, the gun's pivot), its cross bar, and the pintle down `drop` metres
## into the socket on the window sill (weapons.gd). Built facing -Z.
static func build_yoke(drop: float, inside := true) -> Node3D:
	var M := _mats(inside)
	var steel: Array = []
	var parker: Array = []
	for s in [-1, 1]:
		parker.append(box(0.022, 0.15, 0.06, s * 0.1, -0.075, 0)) # an arm
		steel.append(cyl(0.026, 0.026, -0.016, 0.016, 12).rotate_y(PI / 2).translate(s * 0.1, -0.01, 0)) # its pin boss
		steel.append(cyl(0.007, 0.007, -0.006, 0.006, 6).rotate_y(PI / 2).translate(s * 0.118, -0.01, 0)) # (the pin's head)
	parker.append(box(0.222, 0.035, 0.07, 0, -0.16, 0)) # the cross bar
	steel.append(Geo.cylinder(0.02, 0.02, drop, 12).translate(0, -0.16 - drop / 2, 0)) # the pintle
	steel.append(Geo.cylinder(0.032, 0.032, 0.03, 14).translate(0, -0.2, 0)) # its thrust collar
	steel.append(box(0.02, 0.04, 0.02, 0.035, -0.205, 0)) # the traverse lock's lever
	var g := Node3D.new()
	for pair in [[steel, M.steel], [parker, M.parker]]:
		var m := MeshInstance3D.new()
		m.mesh = Geo.merge(pair[0].map(func(x): return x.to_non_indexed().delete_attribute("uv"))).to_mesh(pair[1])
		g.add_child(m)
	return g
