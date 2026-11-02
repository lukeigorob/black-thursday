extends Node3D
# The cockpits from the pilot's eye, as the web game's own reference page draws them (the same camera, light
# and states): each fighter's cockpit (cockpit.gd) and the B-17's flight deck (cockpitb17.gd), looking ahead,
# left, right and down, by night, and twice more with the gauges moved, then the frame time.
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/cockpits/cockpits.tscn -- --out=<folder> [--kind=bf109]

const TestKit := preload("res://src/core/test_kit.gd")
const Args := preload("res://src/core/args.gd")
const Mat := preload("res://src/core/mat.gd")
const Geo := preload("res://src/core/geo.gd")

const EYE := {bf109 = Vector3(0, 0.75, -0.8), p47 = Vector3(0, 1.05, -0.2), fw190 = Vector3(0, 0.86, -0.22), b17 = Vector3(-0.55, 0.88, -7.72)}
const LOOK := {ahead = Vector2(0, -0.15), left = Vector2(1.1, -0.25), right = Vector2(-1.1, -0.25), down = Vector2(0, -0.6)}
# the fighters' state (the same as the reference page's), and a second one to see the needles move
const S1 := {speed = 120.0, alt = 7600.0, climb = 3.0, heading = 0.6, bank = 0.25, pitch = 0.05, throttle = 0.8, heat = 0.3, damage = false, time = 300.0, stickX = 0.3, stickY = -0.2, ammo = [300, 300, 120, 150], ammoMax = [475, 475, 250, 250]}
const S2 := {speed = 175.0, alt = 5200.0, climb = -12.0, heading = 2.4, bank = -0.6, pitch = -0.2, throttle = 1.0, heat = 0.8, damage = true, time = 900.0, stickX = -0.8, stickY = 0.7, ammo = [60, 90, 10, 40], ammoMax = [475, 475, 250, 250]}
const C1 := {feet = 22000.0, heading = 74.0, bank = 0.12, pitch = 0.03, ias = 152.0, climb = 300.0, turn = 0.05, slip = 0.1, mp = [42.0, 42.0, 41.0, 42.0], rpm = [2300.0, 2300.0, 2310.0, 2300.0]}
const C2 := {feet = 14500.0, heading = 205.0, bank = -0.4, pitch = -0.1, ias = 185.0, climb = -900.0, turn = -0.15, slip = -0.4, mp = [30.0, 46.0, 11.2, 44.0], rpm = [2100.0, 2500.0, 0.0, 2450.0]}

var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var update_fn: Callable # (state, dt)
var night_fn: Callable
var state: Dictionary

func _ready() -> void:
	get_window().size = Vector2i(1920, 1080)
	_stage()
	var only = Args.param("kind")
	var kinds := ["bf109", "fw190", "p47", "b17"] if only == null else [only]
	var times := {}
	for kind in kinds:
		var node := _build(kind)
		add_child(node)
		cam.position = EYE[kind]
		state = (C1 if kind == "b17" else S1).duplicate(true)
		for look in LOOK:
			_aim(LOOK[look])
			await _settle(1.0)
			await TestKit.shot(self, "godot_%s_%s" % [kind, look])
		_aim(LOOK.ahead)
		# the gauges moving: the second state, then back
		state = (C2 if kind == "b17" else S2).duplicate(true)
		await _settle(1.0)
		await TestKit.shot(self, "godot_%s_moved" % kind)
		state = (C1 if kind == "b17" else S1).duplicate(true)
		await _settle(0.5)
		times[kind] = await TestKit.time_frames(self, 4.0, "%s cockpit, 1920x1080" % kind)
		_night(1.0)
		await _settle(1.0)
		await TestKit.shot(self, "godot_%s_night" % kind)
		_night(0.0)
		remove_child(node)
		node.queue_free()
	for k in times:
		print("FRAME %s avg %.2f ms p95 %.2f worst %.2f" % [k, times[k].avg, times[k].p95, times[k].max])
	get_tree().quit()

## Waits `seconds`, updating the cockpit every frame (its needles and controls follow the state).
func _settle(seconds: float) -> void:
	var end := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < end:
		await get_tree().process_frame

func _process(dt: float) -> void:
	if update_fn.is_valid():
		update_fn.call(state, dt)

func _aim(l: Vector2) -> void:
	cam.rotation = Vector3(l.y, l.x, 0) # (YXZ, as the reference page's camera)

func _night(k: float) -> void:
	# the night: the sky dark, the lights at 4 % (as the reference page), the panel's glow on
	env.background_color = Color.hex(0x0a0f1aff) if k > 0.0 else Color.hex(0x8fb3d8ff)
	sun.light_energy = (0.04 if k > 0.0 else 1.0) * SUN
	env.ambient_light_energy = (0.04 if k > 0.0 else 1.0) * AMBIENT
	if night_fn.is_valid():
		night_fn.call(k)

const SUN := 2.2
const AMBIENT := 1.0

## The reference page's world: a plain sky colour, a hemisphere light (sky blue over brown-grey ground)
## and the sun from behind on the left, a flat green ground 1.5 km below.
func _stage() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.hex(0x8fb3d8ff)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color.hex(0xcfe3ffff).lerp(Color.hex(0x5a5448ff), 0.35)
	env.ambient_light_energy = AMBIENT
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.light_color = Color.hex(0xfff2dcff)
	sun.light_energy = SUN
	sun.basis = Basis.looking_at(-Vector3(-0.55, 0.45, 0.7).normalized(), Vector3.UP)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 30.0
	add_child(sun)
	var ground := MeshInstance3D.new()
	ground.mesh = Geo.plane(40000, 40000).rotate_x(-PI / 2).to_mesh(Mat.lambert({color = 0x55603f}))
	ground.position.y = -1500
	add_child(ground)
	cam = Camera3D.new()
	cam.fov = 70
	cam.near = 0.02
	cam.far = 50000
	add_child(cam)
	cam.make_current()

## What models.js's prepare() does to the B-17 that shows from the flight deck (models.gd, when it's in, does
## it for the game): the parts it removes, the glass nose, the windows cut out of the hull's texture.
func _prepare(model: Node) -> void:
	for n in ["FrontGunCapsule", "LowerFrontGuns", "NavigationKnob"]:
		var o := model.find_child(n, true, false)
		if o:
			o.get_parent().remove_child(o)
			o.free()
	var glass := Mat.physical({color = 0xcfe0e6, transparent = true, opacity = 0.08, roughness = 0.03, depthWrite = false, side = Mat.DOUBLE})
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		if mi.name == "Nose":
			mi.material_override = glass
			continue
		for i in mi.mesh.get_surface_count():
			var m = mi.mesh.surface_get_material(i)
			if m is BaseMaterial3D and m.resource_name in ["MainHull", "Tail_TBTurrets"]:
				m = m.duplicate()
				m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				m.alpha_scissor_threshold = 0.95
				mi.set_surface_override_material(i, m)

func _build(kind: String) -> Node3D:
	update_fn = Callable()
	night_fn = Callable()
	if kind != "b17":
		var c: Node3D = load("res://src/cockpit.gd").build_cockpit(kind)
		update_fn = c.get_meta("update")
		night_fn = c.get_meta("night")
		return c
	# the B-17: the bomber's model outside, the flight deck in it (built on the Interior; interior.gd when
	# it's there, else the stand-in with the hull's measured shape)
	var root := Node3D.new()
	var model: Node3D = load("res://models/b17.glb").instantiate()
	_prepare(model)
	root.add_child(model)
	var it
	if ResourceLoader.exists("res://src/interior.gd"):
		it = load("res://src/interior.gd").new(model)
	else:
		it = load("res://tests/cockpits/interior_standin.gd").new()
		load("res://src/cockpitb17.gd").build_b17_cockpit(it)
		it.finish()
	root.add_child(it.group)
	update_fn = func(s, dt): if it.cockpit_live.is_valid(): it.cockpit_live.call(s, dt)
	night_fn = func(k): if it.cockpit_night.is_valid(): it.cockpit_night.call(k)
	return root
