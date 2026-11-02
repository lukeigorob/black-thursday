extends Node3D
# The crew and you, end to end in your own B-17 (the real Bomber and Interior): walk her length nose to
# tail, take every station, crawl to the nose and the tail, be wounded and patched up, bail out through
# the main door, free fall and hang under the chute; then the crews seen from outside and the frame time.
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/crew/crew_test.tscn -- --out=<folder> [--sweep]
# Screenshots: <out>/crew_<moment>.png, to set beside the web game's (tests/crew/web_shots.mjs).

const TestKit := preload("res://src/core/test_kit.gd")
const Args := preload("res://src/core/args.gd")
const Models := preload("res://src/models.gd")
const Bomber := preload("res://src/bomber.gd")
const Interior := preload("res://src/interior.gd")
const Figure := preload("res://src/figure.gd")
const CrewM := preload("res://src/crew.gd")
const PlayerM := preload("res://src/player.gd")
const EjectM := preload("res://src/eject.gd")
const ParachutesM := preload("res://src/parachutes.gd")
const CrowdM := preload("res://src/crowd.gd")
const WalkSweep := preload("res://src/walksweep.gd")

class Fx: # (effects.gd's parachute(): everyone who bails out)
	var chutes
	func parachute(p: Vector3) -> void: chutes.add(p)

var cam: Camera3D
var bomber
var crew
var player
var eject
var chutes
var crowds
var time := 0.0
var live := true
var log_lines := []

func _ready() -> void:
	cam = TestKit.stage(self)
	cam.fov = 70 # (the web game's VIEW_FOV, as the crew see it)
	Figure.load_crew_model()
	var t0 := Time.get_ticks_msec()
	var m: Node3D = Models.load_model("b17").scene
	bomber = Bomber.new(m, {interior = true})
	add_child(bomber.group)
	print("bomber + interior built in %d ms" % (Time.get_ticks_msec() - t0))
	t0 = Time.get_ticks_msec()
	crew = CrewM.new(bomber, {visible = true, interior = bomber.interior, player_role = "radio"})
	crew.on_event(func(msg): log_lines.append(msg); print("CREW: ", msg))
	player = PlayerM.new(bomber, cam)
	add_child(player)
	player.enabled = true
	chutes = ParachutesM.new(self)
	eject = EjectM.new(self)
	add_child(eject)
	crowds = CrowdM.new(self, bomber.interior)
	print("crew, you, chutes in %d ms" % (Time.get_ticks_msec() - t0))
	_run()

func _process(dt: float) -> void:
	if not live:
		return
	time += dt
	if eject.active:
		eject.update(dt, cam)
	else:
		player.update(dt)
	crew.set_displaced(player.station.id if player.station else null, player.feet if not player.wounded and not eject.active else null)
	crew.update(dt, {player = player if not eject.active else null, time = time})
	chutes.update(dt)
	Figure.sync_figures()

func _shot(name: String) -> void:
	await TestKit.shot(self, "crew_" + name)

func _wait(s: float) -> void:
	await TestKit.wait(self, s)

func _station(id: String):
	for s in bomber.interior.stations:
		if s.id == id:
			return s
	return null

## Walk to `target` (bomber space) the way a player does: facing it, W held.
func _walk_to(target: Vector3, limit := 12.0) -> bool:
	var t := 0.0
	while Vector2(target.x - player.feet.x, target.z - player.feet.z).length() > 0.22:
		player.yaw = atan2(-(target.x - player.feet.x), -(target.z - player.feet.z))
		player.pitch = 0.0
		player.keys = {KeyW = true}
		await get_tree().process_frame
		t += get_process_delta_time()
		if t > limit:
			player.keys = {}
			return false
	player.keys = {}
	return true

func _place(feet: Vector3, yaw: float, pitch := 0.0) -> void:
	player.detach_all()
	player.becomes(feet, yaw)
	player.pitch = pitch

func _take(id: String) -> void:
	var s = _station(id)
	player.becomes(s.stand, s.yaw)
	player.near = s
	player.passage = null
	player.interact()

func _run() -> void:
	await _wait(1.5)
	# 1. where you start: the radio room, facing aft along the waist
	await _shot("01_radio_room")
	# 2. down the waist, the gunners at their windows
	_place(Vector3(0, -1.95, -0.9), PI, -0.08)
	await _wait(0.8)
	await _shot("02_waist")
	# 3. the length of her, nose to tail on foot (through the crawlway under the flight deck, the bomb bay
	# catwalk, the doors, round the ball turret, into the tail on hands and knees)
	_place(CrewM.CORRIDOR[0], 0.0)
	await _wait(0.4)
	await _shot("03_nose")
	var t0 := Time.get_ticks_msec()
	var ok := true
	var shots := {4: "04_under_flight_deck", 9: "05_bomb_bay", 13: "06_into_waist", 17: "07_tail_bulkhead"}
	for i in range(1, CrewM.CORRIDOR.size()):
		if not await _walk_to(CrewM.CORRIDOR[i]):
			print("WALK held up on the way to ", CrewM.CORRIDOR[i], " at ", player.feet)
			ok = false
			break
		if shots.has(i):
			await _shot(shots[i])
	print("WALK nose to tail: %s in %.1f s" % ["ok" if ok else "FAILED", (Time.get_ticks_msec() - t0) / 1000.0])
	# 4. every station: E at its spot, settle, look
	for s in bomber.interior.stations:
		_take(s.id)
		await _wait(1.6 if s.get("entry") else 0.9)
		print("STATION %s: eye %s blend %.2f" % [s.id, cam.position, player.blend])
		await _shot("st_" + s.id)
		player.detach_all()
	# 5. the crawlways: down to the nose from the flight deck, and back to the tail gun
	player.becomes(Vector3(0, -0.40, -7.55), 0.0)
	player.start_crawl(Interior.CRAWLWAY.down)
	await _wait(1.9)
	await _shot("08_crawl_to_nose")
	await _wait(2.4)
	print("CRAWL ended at ", player.feet, " eye ", player.eye)
	player.becomes(Vector3(0, -1.95, 4.85), PI)
	player.start_crawl(Interior.TAILWAY.aft)
	await _wait(3.0)
	await _shot("09_crawl_to_tail")
	await _wait(3.2)
	print("CRAWL to tail: at station ", player.station.id if player.station else null)
	player.detach_all()
	# 6. wounded in the waist: down on the floor, a man comes to patch you up
	player.becomes(Vector3(0, -1.95, 3.0), 0.0)
	await _wait(0.5)
	var how = player.hurt(1.2, "torso")
	print("HURT: ", how, " wounds ", player.wounds)
	crew.find_helper({player = player})
	await _wait(1.2)
	await _shot("10_wounded")
	await _wait(3.0)
	await _shot("11_first_aid")
	await _wait(5.0)
	print("WOUNDED: still down? ", player.wounded, " patched ", player.patched)
	# 7. bail out: the hatches lit, through the main door, the free fall, the chute
	var hatches := [{name = "the main door", at = [0.72, 4.45]}, {name = "the tail door", at = [0.45, 8.6]}, {name = "the bomb bay", at = [0, -4.4]}, {name = "the nose hatch", at = [-0.35, -8.25]},
		{name = "the nose hatch, down the crawlway", at = [0, -7.55], y = -0.40}]
	for h in hatches:
		h.pos = Vector3(h.at[0], h.get("y", bomber.interior.floor_at(h.at[0], h.at[1], 2)), h.at[1])
	player.becomes(Vector3(0.2, -1.95, 4.0), -PI / 2)
	player.hatches = hatches
	var fx := Fx.new()
	fx.chutes = chutes
	crew.bail_out(hatches, fx)
	await _wait(0.6)
	await _shot("12_hatches_lit")
	player.on_hatch = func(_h):
		var p: Vector3 = cam.global_position
		cam.reparent(self)
		player.detach_all(); player.enabled = false
		eject.start(p + Vector3(0, 2, 0), Vector3(0, 0, -Bomber.AIRSPEED) * 0, "crew", func(): pass)
	await _walk_to(hatches[0].pos)
	player.start_exit(hatches[0])
	await _wait(PlayerM.EXIT_TIME * 0.45)
	await _shot("13_in_the_door")
	await _wait(PlayerM.EXIT_TIME * 0.4)
	await _shot("14_going_out")
	await _wait(PlayerM.EXIT_TIME * 0.4 + 0.7)
	print("EJECT active ", eject.active, " falling ", eject.falling)
	await _shot("15_free_fall")
	eject.pull()
	await _wait(2.0)
	eject.pitch = 1.2
	await _wait(0.6)
	await _shot("16_under_the_chute_up")
	eject.pitch = -1.0
	await _wait(0.4)
	await _shot("17_under_the_chute_down")
	print("CHUTES in the air: ", chutes.items.size())
	# 8. the crews seen from outside: your own from out behind her, from the pilot's seat (third person)
	eject.stop()
	cam.reparent(bomber.group)
	player.enabled = true
	player.hatches = null
	# (a fresh crew: the one that went out of the hatches is gone)
	crew = CrewM.new(bomber, {visible = false, player_role = "pilot"})
	var t1 := Time.get_ticks_msec()
	crowds.build()
	print("crowds baked in %d ms" % (Time.get_ticks_msec() - t1))
	bomber.interior.group.visible = false
	_take("pilot")
	player.third = true
	await _wait(1.2)
	crowds.update(cam, {bombers = [bomber], mine = bomber, crews = {bomber: crew}, fighters = {list = []}, mine_outside = true})
	await _wait(0.2)
	await _shot("18_third_person_own_crew")
	player.third = false
	player.detach_all()
	bomber.interior.group.visible = true
	# 9. frame time in the waist, the crew posed round you (a fresh visible crew at their posts)
	for mm in crowds.own.get_children():
		mm.queue_free()
	crowds.own.visible = false
	_place(Vector3(0, -1.95, -0.9), PI, -0.08)
	await _wait(1.0)
	await TestKit.time_frames(self, 6.0, "frame time, waist, crew and you")
	if Args.has("sweep"):
		live = false
		var t2 := Time.get_ticks_msec()
		var r := WalkSweep.walk_sweep(player)
		print("SWEEP %d spots, %d walks in %d ms: %d problems %s" % [r.starts, r.runs, Time.get_ticks_msec() - t2, r.total, r.by_kind])
		for rt in r.routes:
			print("  route ", rt)
		for i in r.issues.slice(0, 30):
			print("  ", i)
	get_tree().quit()
