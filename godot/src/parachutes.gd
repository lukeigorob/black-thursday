extends RefCounted
# Parachutes: a dome of silk gores, shroud lines down to the four risers, the risers down to the
# harness on the airman's shoulders, and the airman hanging in it: arms up holding the risers, legs
# dangling, helmet and yellow Mae West. They open from a streamer to a full canopy in about a second, breathe gently and swing
# like a pendulum. Everyone's chutes are instanced (four draw calls however many there are);
# your own chute in the eject view uses the same model.
#
# (Godot: the script is the Parachutes class, `Parachutes.new(scene)`; the instancing is MultiMeshInstance3D's.)

const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")
const Bomber := preload("res://src/bomber.gd")

const R := 4.2
const DROP := 6.8 # m: canopy radius; the harness hangs this far below the canopy's centre
const LINK := DROP - 1.0 # m below the canopy's centre: where the shroud lines meet the risers
const GORES := 12
const MAX := 160
const OPEN_TIME := 1.0 # s from streamer to full canopy

## The canopy: a flattened dome of alternating white and cream panels (vertex colours), centre at the origin.
static func canopy_geometry():
	var g = Geo.sphere(R, GORES * 2, 7, 0, TAU, 0, PI * 0.44).to_non_indexed()
	g.scale(1, 0.62, 1)
	var p: PackedVector3Array = g.positions
	var col := PackedColorArray()
	col.resize(p.size())
	for t in range(0, p.size(), 3): # colour each triangle by the gore its centre is in
		var c3 := (p[t] + p[t + 1] + p[t + 2]) / 3
		var gore := int(floor(((atan2(c3.z, c3.x) + PI) / TAU) * GORES)) % 2
		var c := Color(0.94, 0.92, 0.86) if gore else Color(0.84, 0.8, 0.7)
		for k in 3:
			col[t + k] = c
	g.colors = col
	return g

## A unit cylinder or box turned to run from B up to A and placed between them.
static func _between(g, A: Vector3, B: Vector3):
	g.apply_quaternion(_arc(Vector3(0, 1, 0), (A - B).normalized()))
	var m := (A + B) / 2
	return g.translate(m.x, m.y, m.z)

static func _arc(a: Vector3, b: Vector3) -> Quaternion: # (Three's setFromUnitVectors)
	var r := a.dot(b) + 1.0
	if r < 1e-6:
		return Quaternion(1, 0, 0, 0) if absf(a.x) <= absf(a.z) else Quaternion(0, 0, 1, 0)
	var c := a.cross(b)
	return Quaternion(c.x, c.y, c.z, r).normalized()

## The shroud lines, from the rim down to the risers over the airman's shoulders.
static func lines_geometry(to_y := -LINK):
	var rim_r := R * sin(PI * 0.44)
	var rim_y := R * 0.62 * cos(PI * 0.44)
	var parts := []
	for k in GORES:
		var a := (float(k) / GORES) * TAU
		var A := Vector3(cos(a) * rim_r, rim_y, sin(a) * rim_r)
		var sz := signf(sin(a)) if sin(a) != 0 else 1.0
		var B := Vector3(signf(cos(a)) * 0.2, to_y, sz * 0.1) # (to the nearest of the four risers)
		var c = Geo.cylinder(0.018, 0.018, A.distance_to(B), 3, 1, true)
		_between(c, A, B)
		c.delete_attribute("uv")
		parts.append(c.to_non_indexed())
	return Geo.merge(parts)

## The four risers: webbing from the harness at his shoulders up to where the lines meet.
static func risers_geometry(from_y := -DROP + 0.05, to_y := -LINK, w := 0.17, front := 0.05):
	var parts := []
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			var A := Vector3(sx * w, from_y, -front if sz < 0 else 0.05)
			var B := Vector3(sx * 0.2, to_y, -maxf(0.1, front) if sz < 0 else 0.1) # (front: how far forward the front pair run, through the hands)
			var g = Geo.box(0.032, A.distance_to(B), 0.005)
			g.apply_quaternion(_arc(Vector3(0, 1, 0), (B - A).normalized()))
			var m := (A + B) / 2
			g.translate(m.x, m.y, m.z)
			g.delete_attribute("uv")
			parts.append(g.to_non_indexed())
	return Geo.merge(parts)

## The airman in his harness, as he hangs: helmet and face, his body in its jacket with the yellow Mae
## West and the harness straps over it, arms up to the risers with gloved hands on them, legs apart and
## dangling a little forward, boots. Coloured by vertex (one draw call for everyone's).
static func figure_geometry():
	var y0 := -DROP
	var parts := []
	var add := func(g, c: Color) -> void:
		g.delete_attribute("uv")
		var n = g.to_non_indexed() if not g.indices.is_empty() else g
		var col := PackedColorArray()
		col.resize(n.positions.size())
		col.fill(c)
		n.colors = col
		parts.append(n)
	var limb := func(a: Vector3, b: Vector3, r: float, c: Color) -> void:
		var g = Geo.capsule(r, maxf(0.01, a.distance_to(b) - 2 * r), 3, 7)
		g.apply_quaternion(_arc(Vector3(0, 1, 0), (b - a).normalized()))
		var m := (a + b) / 2
		g.translate(m.x, m.y, m.z)
		add.call(g, c)
	var JACKET := Color(0.25, 0.16, 0.09)
	var TROUSERS := Color(0.2, 0.19, 0.12)
	var SKIN := Color(0.62, 0.45, 0.35)
	var LEATHER := Color(0.16, 0.1, 0.06)
	var MAE := Color(0.75, 0.55, 0.12)
	var WEB := Color(0.5, 0.46, 0.3)
	var BOOT := Color(0.06, 0.05, 0.04)
	add.call(Geo.capsule(0.19, 0.42, 3, 10).scale(1, 1, 0.75).translate(0, y0 - 0.42, 0), JACKET) # the body
	add.call(Geo.sphere(0.115, 10, 8).translate(0, y0 - 0.02, 0), SKIN) # the head
	add.call(Geo.sphere(0.125, 10, 6, 0, TAU, 0, PI * 0.55).translate(0, y0 - 0.0, 0.01), LEATHER) # the helmet
	for s in [-1.0, 1.0]:
		add.call(Geo.capsule(0.07, 0.16, 3, 8).scale(1.1, 1, 0.8).translate(s * 0.08, y0 - 0.28, -0.12), MAE) # the Mae West
		add.call(Geo.box(0.04, 0.6, 0.02).translate(s * 0.1, y0 - 0.4, -0.15), WEB) # the harness straps
		limb.call(Vector3(s * 0.1, y0 - 0.7, 0), Vector3(s * 0.15, y0 - 1.12, -0.12), 0.075, TROUSERS) # thighs, a little forward
		limb.call(Vector3(s * 0.15, y0 - 1.12, -0.12), Vector3(s * 0.16, y0 - 1.55, -0.02), 0.065, TROUSERS) # shins hanging
		add.call(Geo.box(0.1, 0.09, 0.22).translate(s * 0.16, y0 - 1.6, -0.06), BOOT) # boots
		limb.call(Vector3(s * 0.2, y0 - 0.2, 0), Vector3(s * 0.21, y0 + 0.18, 0.02), 0.05, JACKET) # upper arms, up the risers
		limb.call(Vector3(s * 0.21, y0 + 0.18, 0.02), Vector3(s * 0.19, y0 + 0.5, 0), 0.045, JACKET) # forearms
		add.call(Geo.sphere(0.05, 8, 6).translate(s * 0.19, y0 + 0.55, 0), LEATHER) # gloved hands on the risers
	add.call(Geo.box(0.34, 0.04, 0.03).translate(0, y0 - 0.62, -0.14), WEB) # the chest strap
	return Geo.merge(parts)

static var SILK := Mat.standard({vertexColors = true, roughness = 0.9, side = Mat.DOUBLE}) # (envMapIntensity 0.4: no per-material switch in Godot)
static var CORD := Mat.standard({color = 0xd9d3c0, roughness = 0.9})
static var FLIGHT_SUIT := Mat.standard({vertexColors = true, roughness = 0.85})
static var WEBBING := Mat.standard({color = 0x8a8060, roughness = 0.9})

const BODY := Vector3(0, -DROP - 0.6, 0) # the airman's middle, in the chute's frame

## How far open a chute is (0 streamer .. 1 full), its breathing, and its swing at time t since it opened.
static func chute_shape(t: float) -> Vector3:
	var k := clampf(t / OPEN_TIME, 0, 1)
	var e := 1 - (1 - k) ** 3
	var breathe := 1 + 0.045 * sin(t * 2.3) * e
	return Vector3((0.1 + 0.9 * e) * breathe, 1.9 - 0.9 * e + 0.03 * sin(t * 2.3 + 1), (0.1 + 0.9 * e) * breathe)

static func chute_swing(t: float, phase: float) -> Quaternion:
	var amp := 0.2 * exp(-t / 25) + 0.07 # a big swing as it opens, settling to a gentle sway
	var axis := Vector3(cos(t * 0.13 + phase), 0, sin(t * 0.13 + phase))
	return Quaternion(axis, amp * sin(t * 1.55 + phase))

var items: Array = []
var canopy: MultiMeshInstance3D
var lines: MultiMeshInstance3D
var risers: MultiMeshInstance3D
var figure: MultiMeshInstance3D

func _init(scene: Node3D) -> void:
	var mk := func(geo, mat: Material) -> MultiMeshInstance3D:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = geo.to_mesh(mat)
		mm.instance_count = MAX
		mm.visible_instance_count = 0
		var m := MultiMeshInstance3D.new()
		m.multimesh = mm
		m.extra_cull_margin = 16384.0 # (frustumCulled = false)
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		scene.add_child(m)
		return m
	canopy = mk.call(canopy_geometry(), SILK)
	lines = mk.call(lines_geometry(), CORD)
	risers = mk.call(risers_geometry(), WEBBING)
	figure = mk.call(figure_geometry(), FLIGHT_SUIT)

## Someone bailing out at p: a free fall of a few seconds, then the chute opens.
func add(p: Vector3) -> void:
	if items.size() >= MAX:
		items.pop_front()
	items.append({pos = p + Vector3(0, DROP, 0), age = 0.0, open = 2 + randf() * 3, phase = randf() * 6})

func update(dt: float) -> void:
	var n := 0
	for i in range(items.size() - 1, -1, -1):
		var c: Dictionary = items[i]
		c.age += dt
		var open: bool = c.age > c.open
		var t: float = c.age - c.open
		c.pos.y -= (6 + 30 * exp(-t * 3) if open else 45.0) * dt # the opening shock slows him from ~45 m/s to 6
		c.pos.z += Bomber.AIRSPEED * dt # left behind in the air as the bombers fly on
		if c.age > 150:
			items.remove_at(i)
	var hide := Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO)
	for c in items:
		var open: bool = c.age > c.open
		var t: float = c.age - c.open
		var q: Quaternion
		if open:
			q = chute_swing(t, c.phase) # swinging under the canopy: everything turns about the canopy
			figure.multimesh.set_instance_transform(n, Transform3D(Basis(q), c.pos))
		else: # tumbling in free fall, about himself: place the pivot at the airman
			q = Quaternion(Vector3(1, 0, 0.3).normalized(), c.age * 2.5)
			figure.multimesh.set_instance_transform(n, Transform3D(Basis(q), -(q * BODY) + BODY + c.pos))
		var sh := chute_shape(t)
		lines.multimesh.set_instance_transform(n, Transform3D(Basis(q).scaled_local(Vector3(sh.x, 1, sh.z)), c.pos) if open else hide)
		risers.multimesh.set_instance_transform(n, Transform3D(Basis(q), c.pos) if open else hide)
		canopy.multimesh.set_instance_transform(n, Transform3D(Basis(q).scaled_local(sh), c.pos) if open else hide)
		n += 1
	for m in [canopy, lines, risers, figure]:
		m.multimesh.visible_instance_count = n
