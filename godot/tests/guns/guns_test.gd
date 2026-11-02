extends Node3D
# The guns, firing: every gun position of a B-17 (with its interior) fires in turn, seen from outside and
# from the gunner's place; then the effects (hits, an explosion, flak, a burning trail, wreckage); then
# everything at once for the frame time. Screenshots to --out, numbers printed.
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/guns/guns_test.tscn -- --out=<folder>
# --only=<station id> fires just that one; --quick skips the frame timing.

const TestKit := preload("res://src/core/test_kit.gd")
const Args := preload("res://src/core/args.gd")
const Models := preload("res://src/models.gd")
const Bomber := preload("res://src/bomber.gd")
const Weapons := preload("res://src/weapons.gd")
const Effects := preload("res://src/effects.gd")
const GameAudio := preload("res://src/audio.gd")

## The player as weapons.gd sees him.
class FakePlayer:
	var station = null
	var s_yaw := 0.0
	var s_pitch := 0.0
	var firing := false
	var blend := 1.0
	var reload_pressed := false
	var grip_targets = null
	var gun_eye = null
	var head_yaw := 0.0
	var head_pitch := 0.0
	var kicks := 0
	func kick(_k: float) -> void:
		kicks += 1

var cam: Camera3D
var bomber
var weapons
var effects
var audio
var player := FakePlayer.new()
var hits := 0
var t := 0.0
var auto_all := false

func _ready() -> void:
	get_window().size = Vector2i(1920, 1080)
	cam = TestKit.stage(self)
	var env: Environment = (find_children("*", "WorldEnvironment", false, false)[0] as WorldEnvironment).environment
	env.glow_enabled = true # (the tracers and flashes bloom, as the web game's do)
	env.glow_hdr_threshold = 1.0
	audio = GameAudio.new()
	add_child(audio)
	audio.ensure()
	var m = Models.load_model("b17")
	print("b17 model ok: ", m.ok)
	bomber = Bomber.new(m.scene, {interior = true})
	add_child(bomber.group)
	bomber.group.position = Vector3.ZERO
	effects = Effects.new(self)
	weapons = Weapons.new(self, audio)
	weapons.effects = effects
	var t0 := Time.get_ticks_msec()
	weapons.attach(bomber)
	print("weapons attached in %d ms: %s" % [Time.get_ticks_msec() - t0, ", ".join(weapons.positions.keys())])
	while not audio.bank_ready():
		await get_tree().process_frame
	await run()
	get_tree().quit()

func _process(dt: float) -> void:
	if not weapons:
		return
	t += dt
	effects.cam_pos = cam.global_position
	if auto_all: # every gun firing at a point circling the bomber, as the crew would at a fighter
		var aim := Vector3(sin(t * 0.7) * 300, 80 + sin(t * 1.3) * 60, cos(t * 0.7) * 300)
		for gp in weapons.positions.values():
			if gp == weapons.current(player):
				continue
			var d: Vector3 = (aim - Weapons.world_xf(gp.pivot).origin).normalized()
			gp.aim(Weapons.world_xf(bomber.group).basis.inverse() * d, 0.0, dt)
			weapons.fire(gp, aim, dt, "crew", null, cam)
	weapons.update(dt, player, cam, null, null)
	weapons.bullets.update(dt, cam.global_position, collide)
	effects.update(dt)

## Rounds hitting a ball where a fighter would be (the hits drawn as the game draws them).
var target := Vector3(0, 0, -1e9)
func collide(a: Vector3, b: Vector3, _team, _owner, cannon: bool, _src) -> bool:
	var ab := b - a
	var k := clampf((target - a).dot(ab) / maxf(ab.length_squared(), 1e-9), 0, 1)
	if (a + ab * k).distance_to(target) < 4.0:
		hits += 1
		effects.impact(a + ab * k, cannon)
		return true
	return false

func look(from: Vector3, at: Vector3, fov := 60.0) -> void:
	cam.global_position = from
	cam.look_at(at, Vector3.UP)
	cam.fov = fov

## Fire station `id` for `secs`, aimed `yaw`/`pitch` off its rest (degrees), from your own place at it
## (the screenshot from the gunner's eye) and from outside.
func fire_station(id: String, yaw_deg: float, pitch_deg: float, outside_from: Vector3, outside_at: Vector3) -> void:
	var s = null
	for x in bomber.interior.stations:
		if x.id == id:
			s = x
	if s == null or not weapons.positions.has(id):
		print("no gun position ", id)
		return
	player.station = s
	player.s_yaw = deg_to_rad(yaw_deg)
	player.s_pitch = deg_to_rad(pitch_deg)
	var gp = weapons.positions[id]
	gp.ammo = gp.loadout.ammo
	var y: float = s.yaw + player.s_yaw
	var dir := Vector3(-sin(y) * cos(player.s_pitch), sin(player.s_pitch), -cos(y) * cos(player.s_pitch))
	target = Weapons.world_xf(gp.pivot).origin + dir * 300
	# from outside
	look(outside_from, outside_at, 50)
	player.firing = true
	hits = 0
	await TestKit.wait(self, 0.9)
	await TestKit.shot(self, "gun_%s_outside" % id)
	# from the gunner's eye
	var eye: Vector3 = player.gun_eye if player.gun_eye != null else s.eye
	cam.global_position = Weapons.world_xf(bomber.group) * eye
	cam.global_basis = Basis.looking_at(Weapons.world_xf(bomber.group).basis * dir, Vector3.UP)
	cam.fov = 70
	await TestKit.wait(self, 0.6)
	await TestKit.shot(self, "gun_%s_eye" % id)
	player.firing = false
	var st = weapons.status(player)
	print("%s: %d guns, ammo %d/%d, heat %.2f, hits %d, kicks %d, cases lying %d" % [id, gp.guns.size(), st.ammo, st.max, st.heat, hits, player.kicks, weapons.casings.lying if weapons.casings else 0])
	player.kicks = 0
	await TestKit.wait(self, 0.4)

func run() -> void:
	var only = Args.param("only")
	# (positions: from outside, looking at the gun; the bomber's nose is -Z, its left wing -X)
	var plan := [
		["waistL", 0, 5, Vector3(-9, 1.5, -6), Vector3(-1, -1, 2)],
		["waistR", -10, 0, Vector3(9, 0.5, -5), Vector3(1, -1, 1.6)],
		["top", -30, 15, Vector3(-7, 5, -14), Vector3(0, 1.4, -6.7)],
		["ball", 60, -30, Vector3(-8, -5, -6), Vector3(0, -2.3, 0)],
		["tail", 15, 5, Vector3(-6, 1, 16), Vector3(0, -1.5, 10)],
		["cheekL", 0, -5, Vector3(-7, 0, -16), Vector3(-0.6, 0, -10)],
		["noseL", 0, 0, Vector3(-4, 1, -18), Vector3(0, 0, -11)],
		["radio", 0, 30, Vector3(-6, 4, -8), Vector3(0, 0.2, -1.7)],
	]
	for p in plan:
		if only and p[0] != only:
			continue
		await fire_station(p[0], p[1], p[2], p[3], p[4])
	player.station = null
	# reload and overheating: the waist gun held down until it jams, then reloaded
	for x in bomber.interior.stations:
		if x.id == "waistL":
			player.station = x
	player.s_yaw = 0.0
	player.firing = true
	var gp = weapons.positions["waistL"]
	gp.ammo = gp.loadout.ammo
	var jam_t := 0.0
	while not gp.jammed and jam_t < 12:
		await get_tree().process_frame
		jam_t += get_process_delta_time()
	print("waistL jammed after %.1f s of fire: %s (heat %.2f, %d rounds left)" % [jam_t, gp.jammed, gp.heat, gp.ammo])
	player.firing = false
	player.reload_pressed = true
	await TestKit.wait(self, 0.2)
	print("reloading: ", gp.reloading, " (%.1f s)" % gp.reload_left)
	await TestKit.wait(self, 4.0)
	print("after reload: ammo %d, unjammed: %s" % [gp.ammo, not gp.jammed])
	# the brass on the floor by the waist guns
	look(Weapons.world_xf(bomber.group) * Vector3(0, -0.9, 3.2), Weapons.world_xf(bomber.group) * Vector3(-0.6, -1.9, 1.8), 70)
	await TestKit.wait(self, 0.3)
	await TestKit.shot(self, "brass_on_floor")
	player.station = null
	# the effects, out in the air beside the bomber
	look(Vector3(-60, 10, 40), Vector3(-60, 0, -40), 60)
	var at := Vector3(-60, 0, -40)
	for i in 6:
		effects.impact(at + Vector3(randf_range(-6, 6), randf_range(-3, 3), 0), i % 2 == 0)
	await TestKit.wait(self, 0.05)
	await TestKit.shot(self, "fx_impacts")
	effects.explosion(at, Vector3.ZERO, 1)
	await TestKit.wait(self, 0.25)
	await TestKit.shot(self, "fx_explosion")
	await TestKit.wait(self, 2.0)
	await TestKit.shot(self, "fx_explosion_smoke")
	look(Vector3(-200, 60, 60), Vector3(-200, 0, -200), 60)
	for i in 5:
		effects.flak_burst(Vector3(-200 + i * 40 - 80, randf_range(-20, 20), -200 - i * 30))
		await TestKit.wait(self, 0.1)
	await TestKit.wait(self, 0.3)
	await TestKit.shot(self, "fx_flak")
	# a burning plane flying past: its trail
	look(Vector3(0, 30, 80), Vector3(0, 0, -60), 60)
	var trail_t := 0.0
	while trail_t < 3.0:
		var dt := get_process_delta_time()
		trail_t += dt
		var p := Vector3(-80 + trail_t * 50, 0, -60)
		effects.trail(p, Vector3(50, 0, -75), "fire", dt)
		effects.trail(p + Vector3(0, 0, 30), Vector3(50, 0, -75), "glycol", dt)
		if trail_t > 2 and trail_t - dt <= 2:
			effects.wreck(p, Vector3(50, 0, -75), 6, Vector3(2.2, 0.3, 1.2), 0.5)
		await get_tree().process_frame
	await TestKit.shot(self, "fx_trails")
	print("particles alive: smoke %d, fire %d, flame %d" % [effects.smoke.n, effects.fire.n, effects.flame.n])
	if Args.has("quick"):
		return
	# everything at once: every gun firing, trails, flak, explosions, from the waist gunner's place
	auto_all = true
	look(Weapons.world_xf(bomber.group) * Vector3(-0.3, -0.84, 2.6), Weapons.world_xf(bomber.group) * Vector3(-5, -0.5, 0), 70)
	var load_t := 0.0
	var timing := {}
	var timer := get_tree().create_timer(6.0)
	var spam := func() -> void:
		while timer.time_left > 0:
			var dt := get_process_delta_time()
			for k in 8:
				effects.trail(Vector3(-300 + k * 80, -50 + k * 10, -400 + fmod(t * 60, 400)), Vector3(0, 0, -60), "fire" if k % 2 else "black", dt)
			if randf() < dt * 3:
				effects.flak_burst(Vector3(randf_range(-500, 500), randf_range(-100, 100), randf_range(-800, -200)))
			if randf() < dt * 0.5:
				effects.explosion(Vector3(randf_range(-300, 300), 0, randf_range(-600, -300)), Vector3.ZERO, 1)
			await get_tree().process_frame
	spam.call()
	await TestKit.wait(self, 1.0)
	var bullets_before: int = weapons.bullets.count
	var us := Time.get_ticks_usec()
	weapons.bullets.update(0.0, cam.global_position, collide)
	print("bullets in flight: %d (one update with them all: %.2f ms)" % [bullets_before, (Time.get_ticks_usec() - us) / 1000.0])
	timing = await TestKit.time_frames(self, 4.0, "all guns firing + effects, 1920x1080")
	await TestKit.shot(self, "all_guns_firing")
	print("particles alive: smoke %d, fire %d, flame %d; bullets %d; cases %d" % [effects.smoke.n, effects.fire.n, effects.flame.n, weapons.bullets.count, weapons.casings.items.size()])
	auto_all = false
