extends Node3D
# The fighters' test: the large battle's fighters (165 German, 20 escorts) attacking a stand-in formation of
# 291 B-17s, and you flying a Bf 109, an Fw 190 and a P-47 (an autopilot moves the aim as the mouse would).
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/fighters/fighters_test.tscn -- --out=<folder> [--mode=battle|fly|pose] [--kind=bf109] [--secs=60]
# battle: screenshots of attacks on the formation, then frame times (the whole frame, and the fighters' own
# share of it). fly: you in the type's cockpit, then the third-person view, then an attack. pose: each type
# side by side at a fixed pose and light (to put next to the web game's same view).
# The bombers, rounds, effects, sound and HUD here are stand-ins (tests/fighters/stand_ins and below): only the
# fighters are the real thing.

const TestKit := preload("res://src/core/test_kit.gd")
const Args := preload("res://src/core/args.gd")
const Models := preload("res://src/models.gd")
const Fighters := preload("res://src/fighters.gd")
const Pilot := preload("res://src/pilot.gd")
const Tags := preload("res://src/tags.gd")
const Weapons := preload("res://src/weapons.gd")
const Bomber := preload("res://tests/fighters/stand_ins/bomber.gd") # (a light B-17: the real one needs the whole game round it)

class Effects:
	var n := {}
	func _count(k: String) -> void: n[k] = n.get(k, 0) + 1
	func impact(_p, _big = false) -> void: _count("impact")
	func wreck(_p, _v, _n, _s, _spin) -> void: _count("wreck")
	func explosion(_p, _v, _k) -> void: _count("explosion")
	func parachute(_p) -> void: _count("parachute")
	func trail(_p, _v, kind, _dt) -> void: _count("trail_" + kind)

class Audio:
	func fighter_drone(_d, _c) -> void: pass
	func distant_gun(_d) -> void: pass
	func impact(_c, _v = 1.0) -> void: pass
	func pain(_v = 1.0, _s = false, _d = 0.0) -> void: pass
	func explosion(_d) -> void: pass
	func overheat() -> void: print("AUDIO overheat")
	func gunshot(_v = 1.0) -> void: pass

class UI:
	var t0 := Time.get_ticks_msec()
	func log(s: String) -> void: print("[%.1f] LOG %s" % [(Time.get_ticks_msec() - t0) / 1000.0, s])
	func hit_marker(big) -> void: print("HIT", " (down)" if big else "")
	func kill(n) -> void: print("KILL ", n)
	func hit_flash(_k) -> void: pass

var cam: Camera3D
var fighters
var bullets
var pilot
var tags
var bombers: Array = []
var player_bomber
var mode: String
var kind: String
var fighter_ms := PackedFloat32Array()
var t := 0.0
var autopilot := false

func _ready() -> void:
	mode = Args.param("mode") if Args.param("mode") else "battle"
	kind = Args.param("kind") if Args.param("kind") else "bf109"
	cam = TestKit.stage(self)
	cam.fov = 60 # (the game's view)
	if mode == "pose":
		await _pose()
		get_tree().quit()
		return
	_formation()
	bullets = Weapons.Bullets.new(self)
	fighters = Fighters.new(self, {effects = Effects.new(), bullets = bullets, audio = Audio.new(), ui = UI.new(), bombers = bombers, player_bomber = player_bomber})
	var layer := CanvasLayer.new()
	add_child(layer)
	tags = Tags.new()
	layer.add_child(tags)
	pilot = Pilot.new(Audio.new())
	add_child(pilot)
	fighters.pilot = pilot
	if mode == "fly":
		await _fly()
	else:
		await _battle()
	print("TALLY ", fighters.tally, " COUNTS ", fighters.counts(), " EFFECTS ", fighters.effects.n)
	get_tree().quit()

## 291 stand-in B-17s in 16 boxes of up to 18 (the large battle), yours at the origin; full models round you.
func _formation() -> void:
	var placeholder: Node3D = Models.load_model("b17", {lod = true}).scene
	var full: Node3D = Models.load_model("b17").scene
	var n := 0
	for sq in 17:
		var gx := (sq % 4) - 1.5
		var gz := float(sq / 4) - 1.5
		for i in 18:
			if n >= 291:
				break
			var b = Bomber.make()
			b.squad = sq
			b.base = Vector3(gx * 520 + (i % 6 - 2.5) * 36, (i / 6) * -18.0 + gz * 40, gz * 650 + (i / 6) * 42 + (i % 2) * 8)
			if sq == 5 and i == 8:
				b.base = Vector3.ZERO
			b.group.position = b.base
			add_child(b.group)
			bombers.append(b)
			n += 1
	player_bomber = bombers.filter(func(b): return b.base == Vector3.ZERO)[0]
	for b in bombers:
		var near: bool = b.base.length() < 300
		b.group.add_child((full if near else placeholder).duplicate())

func _tick(dt: float) -> void:
	for b in bombers:
		b.update(dt)
	var t0 := Time.get_ticks_usec()
	fighters.update(dt, {camera = cam})
	if pilot.active:
		pilot.update_camera(cam, dt)
	var t1 := Time.get_ticks_usec()
	tags.update(cam, fighters.list, {"side": pilot.f.side if pilot.active else "allied", "lead": pilot.active, "self": pilot.f if pilot.active else null, "bombers": bombers if pilot.active else null})
	var t2 := Time.get_ticks_usec()
	fighter_ms.append((t2 - t0) / 1000.0)
	bullets.update(dt, cam.global_position, fighters.collide)
	if fighters.prof != null:
		fighters.prof.tags = fighters.prof.get("tags", 0.0) + (t2 - t1) / 1000.0
		fighters.prof.bullets_collide = fighters.prof.get("bullets_collide", 0.0) + (Time.get_ticks_usec() - t2) / 1000.0
		fighters.prof.frames = fighters.prof.get("frames", 0) + 1

func _process(dt: float) -> void:
	if fighters == null:
		return
	t += dt
	if autopilot:
		_autopilot(dt)
	_tick(dt)

## Run the battle, shooting the attacks, then time it.
func _battle() -> void:
	var secs := float(Args.param("secs")) if Args.param("secs") else 70.0
	cam.global_position = Vector3(120, 40, 200)
	cam.look_at(Vector3.ZERO)
	var shots := 0
	var next_shot := 25.0
	while t < secs:
		await get_tree().process_frame
		# a camera alongside an attacker in its pass, looking past him at his bomber
		if t > next_shot and shots < 4:
			var att = null
			for f in fighters.list:
				if f.alive and f.state == "attack" and f.target and f.pos.distance_to(f.target.group.position) < 700:
					att = f
					break
			if att:
				var tgt: Vector3 = att.target.group.position
				var side: Vector3 = att.dir.cross(Vector3.UP).normalized()
				cam.global_position = att.pos - att.dir * 35 + side * 14 + Vector3(0, 6, 0)
				cam.look_at(tgt.lerp(att.pos, 0.3))
				await TestKit.shot(self, "battle_attack_%d" % shots)
				shots += 1
				next_shot = t + 4
		if absf(t - 40) < 0.02:
			cam.global_position = player_bomber.group.position + Vector3(-260, 120, 380)
			cam.look_at(player_bomber.group.position + Vector3(0, 0, -300))
			await TestKit.shot(self, "battle_wide")
	print("battle: %d fighters in the air, %d attacking" % [fighters.list.size(), fighters.list.filter(func(f): return f.state == "attack").size()])
	cam.global_position = player_bomber.group.position + Vector3(-80, 30, 160)
	cam.look_at(player_bomber.group.position + Vector3(0, 0, -400))
	fighter_ms.clear()
	fighters.prof = {}
	await TestKit.time_frames(self, 15.0, "battle 1920x1080 (whole frame)")
	_report_fighter_ms("battle")
	var pf: Dictionary = fighters.prof
	for k in pf:
		if k != "frames":
			print("  %s: %.2f ms a frame" % [k, pf[k] / pf.frames])

func _report_fighter_ms(label: String) -> void:
	var a := fighter_ms.duplicate()
	a.sort()
	var s := 0.0
	for v in a:
		s += v
	print("%s: fighters.update + tags + pilot: avg %.2f ms, p95 %.2f, worst %.2f (%d frames)" % [label, s / a.size(), a[int(a.size() * 0.95)], a[a.size() - 1], a.size()])

## You fly `kind`: the cockpit, the third-person view, then an attack.
func _fly() -> void:
	# let the first gaggles come up and the escorts get on station
	while t < 12:
		await get_tree().process_frame
	var f = await fighters.spawn_player(kind)
	pilot.start(f, fighters)
	fighters.crew_view = false
	fighters.player_side = f.side
	autopilot = true
	await TestKit.wait(self, 3)
	await TestKit.shot(self, "%s_cockpit" % kind)
	pilot.third = true
	await TestKit.wait(self, 1.5)
	await TestKit.shot(self, "%s_third" % kind)
	pilot.third = false
	var t_end := t + 40
	var shot := false
	while t < t_end and pilot.alive:
		await get_tree().process_frame
		if not shot and pilot.firing:
			await TestKit.wait(self, 0.4)
			await TestKit.shot(self, "%s_attack" % kind)
			pilot.third = true
			await TestKit.wait(self, 0.3)
			await TestKit.shot(self, "%s_attack_third" % kind)
			pilot.third = false
			shot = true
	print("%s: alive %s, speed %.0f m/s, alt %.0f ft, ammo %s, kills %d, fired %d, status %s" % [kind, pilot.alive, f.speed, (7600 + f.pos.y) * 3.281, pilot.ammo, fighters.kills, bullets.player_fired, pilot.status(cam)])
	fighter_ms.clear()
	await TestKit.time_frames(self, 8.0, "%s flying 1920x1080 (whole frame)" % kind)
	_report_fighter_ms(kind)

## The mouse, as a pilot would move it: onto the nearest enemy (a bomber for a German), fire when on.
func _autopilot(_dt: float) -> void:
	var f = pilot.f
	if not f or not f.alive:
		pilot.firing = false
		return
	var best = null
	var bd := INF
	for e in pilot.enemies(f):
		var d: float = e.pos.distance_to(f.pos)
		if d < bd and (e.pos - f.pos).angle_to(f.dir) < 1.2:
			bd = d; best = e
	if best == null:
		pilot.aim_v = (player_bomber.group.position + Vector3(0, 200, 0) - f.pos).normalized()
		pilot.limit_aim()
		pilot.firing = false
		return
	var lead: Dictionary = pilot.lead_dir(f, best)
	pilot.aim_v = lead.dir
	pilot.limit_aim()
	pilot.throttle = 1.0
	pilot.firing = bd < 650 and f.dir.angle_to(lead.dir) < 0.04
	if bd < 120: # (break off: don't fly into him)
		pilot.aim_v = (f.dir + Vector3(0, -0.8, 0)).normalized()
		pilot.limit_aim()

## Each type at the same pose and light, the camera 14 m behind and 3.2 m above (the third-person view's place).
func _pose() -> void:
	var models := []
	for k in ["bf109", "fw190", "p47"]:
		var m: Node3D = Models.load_model(k).scene
		add_child(m)
		models.append(m)
	for i in models.size():
		for j in models.size():
			models[j].visible = j == i
		var k: String = ["bf109", "fw190", "p47"][i]
		for view in ["third", "side", "front_q"]:
			match view:
				"third": cam.global_position = Vector3(0, 3.2, 14)
				"side": cam.global_position = Vector3(-14, 1.5, 0)
				"front_q": cam.global_position = Vector3(8, 2.5, -10)
			cam.look_at(Vector3(0, 0, 0) if view != "third" else Vector3(0, 0, -60))
			await TestKit.wait(self, 0.3)
			await TestKit.shot(self, "pose_%s_%s" % [k, view])
	# the P-47's codes atlas (canvas2d), as drawn
	var P47 = load("res://src/p47.gd")
	var ci: Image = P47.CODE_TEX.get_image()
	ci.save_png(TestKit.out_dir().path_join("p47_codes.png"))
	print("p47 codes atlas: ", ci.get_size(), " corner ", ci.get_pixel(5, 5), " in a letter's row ", ci.get_pixel(64, 66), " mipmaps ", ci.has_mipmaps())
