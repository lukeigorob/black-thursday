extends RefCounted
# For the test scenes in tests/: screenshots, frame times, waiting. A test runs as
#   Godot_v4.7.2-stable_win64_console.exe --path <your copy of godot/> res://tests/<area>/<test>.tscn -- --out=<folder>
# (with a window: rendering needs one), saves its PNGs to --out and prints its numbers.

const Args := preload("res://src/core/args.gd")

static func out_dir() -> String:
	var o = Args.param("out")
	return o if o else OS.get_user_data_dir()

## Save what's on screen as <out>/<name>.png (after the frame that's being drawn now).
static func shot(node: Node, name: String) -> void:
	await RenderingServer.frame_post_draw
	var path := out_dir().path_join(name + ".png")
	node.get_viewport().get_texture().get_image().save_png(path)
	print("SHOT ", path)

## Wait `seconds` of game time.
static func wait(node: Node, seconds: float) -> void:
	await node.get_tree().create_timer(seconds).timeout

## Times frames for `seconds` and prints average, 95th percentile and worst, in ms.
static func time_frames(node: Node, seconds: float, label := "frames") -> Dictionary:
	var ms := PackedFloat32Array()
	var end := Time.get_ticks_msec() + int(seconds * 1000.0)
	var last := Time.get_ticks_usec()
	while Time.get_ticks_msec() < end:
		await RenderingServer.frame_post_draw
		var now := Time.get_ticks_usec()
		ms.append((now - last) / 1000.0)
		last = now
	ms.sort()
	var sum := 0.0
	for v in ms:
		sum += v
	var r := {avg = sum / ms.size(), p95 = ms[int(ms.size() * 0.95)], max = ms[ms.size() - 1], n = ms.size()}
	print("%s: %d frames, avg %.2f ms, p95 %.2f, worst %.2f" % [label, r.n, r.avg, r.p95, r.max])
	return r

## A plain test stage: sky, sun and a camera, for looking at one part of the game on its own.
static func stage(root: Node3D, sun_dir := Vector3(-0.55, 0.45, 0.7)) -> Camera3D:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.sky.sky_material = ProceduralSkyMaterial.new()
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.basis = Basis.looking_at(-sun_dir.normalized(), Vector3.UP)
	sun.shadow_enabled = true
	root.add_child(sun)
	var cam := Camera3D.new()
	cam.near = 0.02
	cam.far = 200000.0
	root.add_child(cam)
	cam.make_current()
	return cam
