extends Node3D
# The B-17's inside on its own: the bomber as models.gd loads it, its Interior (interior.gd) and the dust in
# the cabin air (dust.gd), with a camera at each crew station looking its way, and along each crawl passage,
# then the frame time in the waist. The same views as the web game's (tests/interior/web_views.mjs).
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/interior/interior.tscn -- --out=<folder> [--only=waistL]

const TestKit := preload("res://src/core/test_kit.gd")
const Args := preload("res://src/core/args.gd")
const Models := preload("res://src/models.gd")
const Interior := preload("res://src/interior.gd")
const Dust := preload("res://src/dust.gd")
const Views := preload("res://tests/interior/views.gd")

var cam: Camera3D
var bomber: Node3D
var it
var dust
var sun: DirectionalLight3D

func _ready() -> void:
	get_window().size = Vector2i(1920, 1080)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	var sky := ProceduralSkyMaterial.new()
	sky.sky_top_color = Color(0.23, 0.42, 0.72)
	sky.sky_horizon_color = Color(0.62, 0.72, 0.84)
	sky.ground_horizon_color = Color(0.55, 0.6, 0.62)
	sky.ground_bottom_color = Color(0.3, 0.34, 0.3)
	env.sky.sky_material = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.ssao_enabled = true
	env.ssao_radius = 0.6
	env.ssao_intensity = 2.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.basis = Basis.looking_at(-Views.SUN.normalized(), Vector3.UP)
	sun.shadow_enabled = true
	sun.light_energy = 2.2
	sun.directional_shadow_max_distance = 60
	sun.shadow_bias = 0.02
	sun.shadow_normal_bias = 0.6
	add_child(sun)
	bomber = Node3D.new()
	bomber.name = "Bomber"
	add_child(bomber)
	var t0 := Time.get_ticks_usec()
	var model: Node3D = Models.load_model("b17").scene
	bomber.add_child(model)
	var t1 := Time.get_ticks_usec()
	it = Interior.new(model)
	bomber.add_child(it.group)
	var t2 := Time.get_ticks_usec()
	print("BUILD model %.0f ms, interior %.0f ms" % [(t1 - t0) / 1000.0, (t2 - t1) / 1000.0])
	dust = Dust.new(it)
	it.set_night(0.0)
	cam = Camera3D.new()
	cam.near = 0.02
	cam.far = 20000.0
	cam.fov = Views.FOV
	cam.rotation_order = EULER_ORDER_YXZ
	bomber.add_child(cam)
	cam.make_current()
	var only = Args.param("only")
	# (the views for the web game's side: web_views.mjs reads them)
	var vj := []
	for v in Views.list(Interior):
		vj.append({name = v.name, eye = [v.eye.x, v.eye.y, v.eye.z], yaw = v.yaw, pitch = v.pitch, station = v.station.id if v.has("station") else null})
	var fa := FileAccess.open(TestKit.out_dir().path_join("views.json"), FileAccess.WRITE)
	fa.store_string(JSON.stringify({views = vj, sun = [Views.SUN.x, Views.SUN.y, Views.SUN.z], fov = Views.FOV}))
	fa.close()
	for v in Views.list(Interior):
		if only != null and v.name != only:
			continue
		_apply(v, true)
		await _settle(1.2)
		await TestKit.shot(self, "godot_" + v.name)
		_apply(v, false)
	if only == null or only == "waistL":
		var waist: Dictionary = Views.list(Interior).filter(func(v): return v.name == "waistL")[0]
		_apply(waist, true)
		await _settle(1.0)
		var r: Dictionary = await TestKit.time_frames(self, 5.0, "interior, waist view, 1920x1080")
		print("FRAME avg %.2f ms p95 %.2f worst %.2f" % [r.avg, r.p95, r.max])
		_apply(waist, false)
		var walk: Dictionary = Views.list(Interior).filter(func(v): return v.name == "walk_radio")[0]
		_apply(walk, true)
		await _settle(1.0)
		r = await TestKit.time_frames(self, 5.0, "interior, radio room looking aft, 1920x1080")
		print("FRAME2 avg %.2f ms p95 %.2f worst %.2f" % [r.avg, r.p95, r.max])
	get_tree().quit()

## Put the camera at a view and set the cabin up as the station does (what it hides or ghosts, its window).
func _apply(v: Dictionary, on: bool) -> void:
	var s = v.get("station")
	if s:
		if s.has("hide"):
			it.set_hidden(s.hide, on)
		if s.has("ghost"):
			it.set_ghost(s.ghost, on)
		if s.id == "waistL" or s.id == "waistR":
			it.set_waist_wide("L" if s.id == "waistL" else "R", on)
		if s.has("attach"):
			var inside: Node3D = it.get(s.attach)
			if on:
				cam.add_child(inside)
				if s.id == "top":
					it.top_dome.visible = false
			else:
				cam.remove_child(inside)
				it.top_dome.visible = true
	if on:
		cam.position = v.eye
		cam.rotation = Vector3(v.pitch, v.yaw, 0)

func _settle(seconds: float) -> void:
	var end := Time.get_ticks_msec() + int(seconds * 1000)
	var last := Time.get_ticks_msec()
	while Time.get_ticks_msec() < end:
		await get_tree().process_frame
		var now := Time.get_ticks_msec()
		var sun_local: Vector3 = Views.SUN.normalized()
		dust.update((now - last) / 1000.0, cam, sun_local, true)
		it.update_shafts(sun_local)
		last = now
