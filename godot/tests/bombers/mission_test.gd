extends Node3D
# The bombers and the mission on their own (tests/bombers): the 291 B-17s of the large battle in their slots,
# with their identities from the records, the full / mid / low-detail models, the props, the contrails, and
# a mission flown through (outbound, the IP, the bomb run through the flak, bombs away, home) with the
# losses the stream battle and the flak give under main.js's loss governor.
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/bombers/mission_test.tscn -- --out=<folder> [--mode=views|mission|frames] [--speed=6]
# The fighters here are a stand-in (FightersUp): how many are up and when, as fighters.js has it, but their
# fire is the stream battle's abstract passes on every group (fighters.js's real rounds need the guns' bullets).
# main.js's parts it needs (the identities, the re-forming, the loss governor) are copied in below until main.gd.

const Kit := preload("res://src/core/test_kit.gd")
const Args := preload("res://src/core/args.gd")
const Bomber := preload("res://src/bomber.gd")
const Formation := preload("res://src/formation.gd")
const Models := preload("res://src/models.gd")
const History := preload("res://src/history.gd")
const Markings := preload("res://src/markings.gd")
const Scars := preload("res://src/scars.gd")
const Breakup := preload("res://src/breakup.gd")
const StreamBattle := preload("res://src/streambattle.gd")
const Mission := preload("res://src/mission.gd")
const Flak := preload("res://src/flak.gd")
const Effects := preload("res://src/effects.gd")
const FormationDebug := preload("res://src/formationdebug.gd")
const Oob := preload("res://src/oob.gd")

## How many axis fighters are up, as fighters.js runs its waves (AXIS_ACTIVE at once, AXIS_TOTAL in all,
## the fight from ~37 s when the escort turns back): what the mission and the stream battle read of them.
class FightersUp:
	var axis: Array = []
	var reserve := {axis = 470}
	var suppressed := false
	var leaving := false
	var no_waves := false
	var surge_t := 0.0
	var loss_bias := 1.0
	var group_bias = null
	var time := 0.0
	func surge() -> void:
		surge_t = 20.0
	func update(dt: float) -> void:
		time += dt
		surge_t -= dt
		for f in axis:
			f.t += dt
			if leaving or f.t > 240:
				f.state = "rtb"
		axis = axis.filter(func(f): return f.state != "rtb" or f.t < 300)
		if time < 37 or no_waves or leaving:
			return
		var up := axis.filter(func(f): return f.state != "rtb").size()
		if up < 165 and reserve.axis > 0 and randf() < dt * 6:
			axis.append({state = "attack", player = false, t = 0.0})
			reserve.axis -= 1

class PlayerStandIn:
	var keys := {}
	var release_pressed := false
	var firing := false
	var station = null
	var blend := 0.0
	var sight_ok := false
	var s_yaw := 0.0
	var s_pitch := 0.0

class UiStandIn:
	var t := 0.0
	var lines: Array = []
	func log(s: String) -> void:
		lines.append("%4d %s" % [t, s])
		print("LOG %4d %s" % [t, s])

var cam: Camera3D
var bombers: Array = []
var bomber
var slots: Array
var fleet
var detail
var contrails
var prop_blur
var effects
var breakup
var fighters: FightersUp
var flak
var mission
var stream
var debug
var ui := UiStandIn.new()
var player := PlayerStandIn.new()
var t := 0.0
var mission_time := 0.0
var loss_want := 0.0
var loss_t := 0.0
var flak_t := 0.0
var after_flak_t := 0.0
var reform_t := 8.0
var group_slots := {}
var mode: String
var out := []

func _ready() -> void:
	mode = Args.param("mode") if Args.param("mode") else "views"
	get_window().size = Vector2i(1920, 1080)
	cam = Kit.stage(self, Vector3(-0.35, 0.75, 0.55))
	cam.fov = 60
	var env: Environment = get_node("WorldEnvironment").environment if has_node("WorldEnvironment") else null
	for c in get_children():
		if c is WorldEnvironment:
			env = c.environment
	if env:
		env.fog_enabled = true
		env.fog_light_color = Color(0.62, 0.7, 0.8)
		env.fog_density = 0.00004
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(400000, 400000)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.32, 0.36, 0.26)
	ground.material_override = gm
	ground.position.y = -7600
	add_child(ground)
	await build()
	if mode == "views":
		await views()
	elif mode == "frames":
		await frames()
	else:
		await fly_mission()
	get_tree().quit()

func ms() -> float:
	return Time.get_ticks_usec() / 1000.0

func build() -> void:
	var t0 := ms()
	slots = Formation.formation_slots()
	var neighbours := slots.filter(func(s): return s.near and not s.player).size()
	var own: Dictionary = Models.load_model("b17")
	var t1 := ms()
	var lod: Dictionary = Models.load_model("b17", {lod = true})
	var t2 := ms()
	var mids := []
	for i in neighbours:
		mids.append(Models.load_model("b17", {mid = true}))
	var t3 := ms()
	print("LOAD full %.0f ms, lod %.0f ms, %d mid %.0f ms (ok %s %s %s)" % [t1 - t0, t2 - t1, neighbours, t3 - t2, own.ok, lod.ok, mids[0].ok if mids.size() else "-"])
	Scars.bake_bomber_space(own.scene) # (for the battle damage and exhaust stains drawn on her skin, scars.js)
	for s in slots:
		var b = Bomber.new(own.scene if s.player else null, {position = s.pos, interior = false, label = s.label, squad = s.group, lead = s.lead})
		b.unit = s.unit
		bombers.append(b)
	bomber = bombers[slots.find(slots.filter(func(s): return s.player)[0])]
	assign_history()
	Scars.scar_model(own.scene)
	add_child(bomber.group)
	Markings.apply_markings(own.scene, bomber.ident)
	fleet = Formation.Fleet.new(self, lod.scene, bombers)
	Bomber.flock = bombers # (the AI pilots keep clear of each other: Bomber.give_way)
	detail = Formation.Detail.new(self, bombers, bomber, mids.map(func(m): return m.scene))
	detail.assign()
	contrails = Formation.Contrails.new(self, bombers)
	prop_blur = Bomber.PropBlur.new(self, bombers, lod.scene)
	effects = Effects.new(self)
	breakup = Breakup.new(self, effects, {lod = lod.scene, mid = Models.load_model("b17", {mid = true}).scene})
	detail.on_free = func(b): breakup.release(b)
	breakup.warm()
	for b in bombers:
		var bb = b
		b.on_break = func(kind, side, z, vel): breakup.lose(bb, kind, side, z, vel)
	fighters = FightersUp.new()
	flak = Flak.new({effects = effects, audio = null, ui = ui, bombers = bombers, player_bomber = bomber})
	flak.on_burst = func(at: Vector3):
		for b in bombers:
			if b.down or b.gone:
				continue
			var d: float = b.group.position.distance_to(at)
			if d < 160:
				b.shudder = minf(1.0, b.shudder + pow(1 - d / 160, 1.5) * 1.2)
	mission = Mission.new(self, {effects = effects, audio = null, ui = ui, bombers = bombers, player_bomber = bomber})
	stream = StreamBattle.new({bombers = bombers, crews = null, effects = effects})
	StreamBattle.REAL = -1.0 # (no real fight here: the abstract one everywhere)
	for i in bombers.size():
		var u = slots[i].unit
		var b = bombers[i]
		if not group_slots.has(b.squad):
			group_slots[b.squad] = []
		group_slots[b.squad].append({pos = slots[i].pos, lead = b.lead, squadron = u.squadron if u else "lead", element = u.element if u else 0, wingman = u.wingman if u else (0 if b.lead else 1)})
	for list in group_slots.values():
		list.sort_custom(func(p, q): return p.lead and not q.lead)
	debug = FormationDebug.new(self, cam, bombers)
	debug.shown = false
	print("BUILT %d bombers in %.0f ms; identified %d, with serials %d, names %d" % [bombers.size(), ms() - t0, bombers.filter(func(b): return b.ident and b.ident.known).size(), bombers.filter(func(b): return b.ident and b.ident.get("serial")).size(), bombers.filter(func(b): return b.ident and b.ident.get("nickname")).size()])

## main.js: who each bomber was, the group's records into its slots (charted ones first), the lead ship into the lead slot.
func assign_history() -> void:
	var by_group := {}
	for b in bombers:
		if b.unit:
			if not by_group.has(b.unit.group):
				by_group[b.unit.group] = []
			by_group[b.unit.group].append(b)
	var lead_re := RegEx.create_from_string("(?i)(^|\\W)group lead|lead aircraft|Peaslee")
	var spare_re := RegEx.create_from_string("(?i)did not fly|ground spare")
	var text := func(r): return "%s %s" % [r.get("formation_position") if r.get("formation_position") else "", r.get("notes") if r.get("notes") else ""]
	var rank := func(r): return 0 if lead_re.search(text.call(r)) else 2 if r.get("mission_outcome") == "aborted" else 1
	for group in by_group:
		var list: Array = by_group[group]
		var records := History.group_aircraft(group).filter(func(r): return not r.get("did_not_fly") and not spare_re.search(text.call(r)))
		records.sort_custom(func(a, c): return rank.call(a) < rank.call(c))
		list.sort_custom(func(a, c): return a.lead and not c.lead)
		var give := func(b, r, chart):
			b.ident = History.identity_of(r, group)
			b.ident.unit = "%s%s" % [b.unit.group, ("-" + b.unit.part) if b.unit.part else ""]
			b.ident.slot_documented = chart != null or (r != null and rank.call(r) == 0 and b.lead)
			b.ident.slot_basis = chart.basis if chart else null
			b.hist_crew = History.crew_by_role(r)
			b.hist_record = r
		var placed := {}
		var used := {}
		for r in records:
			var c = History.CHARTED.get(r.serial_number) if r.get("serial_number") else null
			if not c:
				continue
			for x in list:
				if not placed.has(x) and x.unit.squadron == c.squadron and x.unit.element == c.element and x.unit.wingman == c.wingman:
					give.call(x, r, c)
					placed[x] = true
					used[r] = true
					break
		var rest := records.filter(func(r): return not used.has(r) and not (r.get("serial_number") and History.CHARTED.has(r.serial_number)))
		for b in list:
			if not placed.has(b):
				give.call(b, rest.pop_front() if rest.size() else null, null)

## main.js steerLosses: the losses by now, against Black Thursday's (aimed at 16%: the fires and collisions add a few).
const LOSS_GOAL := 0.16
func steer_losses() -> void:
	if flak.on:
		flak_t += 1
	elif flak_t > 0:
		after_flak_t += 1
	var share := 0.5 * minf(1, mission_time / 220) if not flak_t else 0.5 + 0.3 * minf(1, flak_t / 180) if not after_flak_t else 0.8 + 0.2 * minf(1, after_flak_t / 200)
	loss_want = LOSS_GOAL * share
	var down := bombers.filter(func(b): return (b.down or b.gone) and not b.aborted).size()
	var doomed := 0.0
	for b in bombers:
		doomed += b.peril
	fighters.loss_bias = clampf(1 + (loss_want - (down + doomed) / bombers.size()) * 25, 0.02, 3.5)
	flak.loss_bias = fighters.loss_bias
	flak.group_bias = stream.group_bias
	fighters.group_bias = stream.group_bias

## main.js reform: command passes on, remnants of a broken group join another of their wing.
func reform() -> void:
	var able := func(b): return not b.down and not b.gone and not b.pilotless and not b.flown and (b.dead_engines == 0 or (b.dead_engines == 1 and b.strag_t > 120)) and b.drift.y > -0.5
	var groups := {}
	var moved := false
	for b in bombers:
		if able.call(b):
			if not groups.has(b.squad):
				groups[b.squad] = []
			groups[b.squad].append(b)
	for g in groups.keys():
		if not groups.has(g):
			continue
		var list: Array = groups[g]
		if list.size() >= 4:
			continue
		var wing: String = g.split("-")[0]
		var best = null
		var bd := INF
		for h in groups:
			var other: Array = groups[h]
			if h == g or h.split("-")[0] != wing or other.size() < 4 or other.size() + list.size() > group_slots[h].size():
				continue
			var d: float = other[0].base.distance_to(list[0].base)
			if d < bd:
				bd = d
				best = h
		if best:
			for b in list:
				b.squad = best
				groups[best].append(b)
			groups.erase(g)
			moved = true
	if moved:
		mission.regroup()
	var go_to := func(b, slot):
		if b.home.distance_squared_to(slot.pos) > 4:
			b.home = slot.pos
			b.slot0 = slot.pos
	for g in groups:
		var list: Array = groups[g]
		var table: Array = group_slots.get(g, [])
		var held := {}
		var loose := []
		for b in list:
			var k := -1
			for i in table.size():
				if table[i].pos.distance_squared_to(b.slot0) < 4:
					k = i
					break
			if k >= 0 and not held.has(k):
				held[k] = b
			else:
				loose.append(b)
		var taken := {}
		for i in table.size():
			for b in bombers:
				if not b.down and not b.gone and not b in list and b.base.distance_squared_to(table[i].pos) < 1600:
					taken[i] = true
					break
		for b in loose:
			var k := -1
			var bd := INF
			for i in table.size():
				if held.has(i) or taken.has(i):
					continue
				var d: float = table[i].pos.distance_squared_to(b.base)
				if d < bd:
					bd = d
					k = i
			if k >= 0:
				held[k] = b
				go_to.call(b, table[k])
		for i in table.size():
			var tt: Dictionary = table[i]
			if held.has(i) or taken.has(i) or (tt.wingman != 0 and not tt.lead):
				continue
			var pick := func(ok: Callable) -> int:
				var best := -1
				var bd := INF
				for j in held:
					if not ok.call(table[j]) or table[j].lead:
						continue
					var d: float = held[j].base.distance_squared_to(tt.pos)
					if d < bd:
						bd = d
						best = j
				return best
			var j: int = pick.call(func(u): return u.squadron == tt.squadron and u.element == tt.element and u.wingman != 0)
			if j < 0:
				j = pick.call(func(u): return u.squadron == tt.squadron and (tt.lead or u.wingman != 0))
			if j < 0 and tt.lead:
				j = pick.call(func(_u): return true)
			if j < 0:
				continue
			var b = held[j]
			held.erase(j)
			held[i] = b
			go_to.call(b, tt)

var prof := {}
func _lap(name: String, t0: float) -> float:
	var t1 := ms()
	prof[name] = prof.get(name, 0.0) + t1 - t0
	return t1

## One step of the game, in main.js's order (the parts of it that are this area's).
func step(dt: float, live := true) -> void:
	var a := ms()
	t += dt
	ui.t = mission_time
	for b in bombers:
		if live:
			b.fly(dt, null)
		b.update(t, dt)
		if live:
			b.update_damage(dt, effects)
	a = _lap("bombers", a)
	if live:
		fighters.update(dt)
		mission_time += dt
		mission.update(dt, {player = player, time = mission_time, flak = flak, fighters = fighters})
		reform_t -= dt
		if reform_t <= 0:
			reform_t = 8
			reform()
		stream.update(dt, {center = bomber.group.position, want = loss_want, fighters = fighters, flak = flak, loss_bias = fighters.loss_bias})
		loss_t -= dt
		if loss_t <= 0:
			loss_t = 1
			steer_losses()
		flak.update(dt)
		a = _lap("mission", a)
	effects.cam_pos = cam.global_position
	effects.update(dt)
	breakup.update(dt, cam.global_position)
	breakup.track(bombers)
	a = _lap("breakup", a)
	fleet.update()
	a = _lap("fleet", a)
	detail.update(dt)
	contrails.update()
	prop_blur.update()
	Scars.flush_scars()
	a = _lap("draw", a)

func count_down() -> int:
	return bombers.filter(func(b): return (b.down or b.gone) and not b.aborted).size()

## A camera behind and above `b`, looking along the formation (the view the wingmen's waist gunners had).
func look_from(b, offset: Vector3, at_offset := Vector3(0, 0, -60)) -> void:
	cam.global_position = b.group.position + offset
	cam.look_at(b.group.position + at_offset)

func views() -> void:
	for i in 30:
		step(1 / 60.0, true)
		await get_tree().process_frame
	# 1. close: your bomber and its neighbours from behind, above and to the left
	look_from(bomber, Vector3(-40, 14, 70), Vector3(10, -6, -40))
	await Kit.shot(self, "g_close")
	# 2. the lead's wingman from the side, close enough to read her markings
	var near := bombers.filter(func(b): return b.model and b != bomber)
	near.sort_custom(func(x, y): return x.base.distance_to(bomber.base) < y.base.distance_to(bomber.base))
	var w = near[0]
	look_from(w, Vector3(-28, 3, 6), Vector3(0, 0, 2))
	for i in 3:
		await get_tree().process_frame
	await Kit.shot(self, "g_markings")
	print("MARKED %s %s %s" % [w.label, w.ident.get("serial"), w.ident.get("nickname")])
	# 3. the debug framings (?debug=formation's , and .): the force, the group, the neighbours
	debug.sel = bombers.find(bomber)
	for v in ["force", "wing", "group", "neighbours"]:
		debug.view = FormationDebug.VIEWS.find(v)
		var f = debug.frame()
		cam.global_position = f.at
		cam.look_at(f.look)
		for i in 3:
			step(1 / 60.0, false)
			await get_tree().process_frame
		await Kit.shot(self, "g_view_" + v)
	# 4. a damaged bomber close by: engines smoking and burning, then a wing coming off
	var d = near[1]
	d.hit(Bomber.PART.engine1, true)
	for i in 12:
		d.hit(Bomber.PART.engine1, true)
	d.ignite_engine(2)
	for i in 60 * 6:
		step(1 / 60.0, true)
		if i % 4 == 0:
			look_from(d, Vector3(-55, 10, 45), Vector3(0, 0, -5))
		await get_tree().process_frame
	look_from(d, Vector3(-55, 10, 45), Vector3(0, 0, -5))
	await Kit.shot(self, "g_engines")
	print("ENGINES %s" % [d.engines.map(func(e): return e.state)])
	for i in 90:
		d.hit(Bomber.PART.wingLo, true)
	for i in 60 * 4:
		step(1 / 60.0, true)
		look_from(d, Vector3(-80, 30, 90), Vector3(0, -20, 0))
		await get_tree().process_frame
		if i == 60:
			await Kit.shot(self, "g_wing_off")
	await Kit.shot(self, "g_falling")
	# 5. your own bomber's scars: a burst of hits along her side
	for i in 24:
		var p := Vector3(-1.2, -0.6 + randf() * 0.8, -6 + i * 0.6)
		Scars.add_scar(bomber, p, Vector3(1, 0, 0), i % 3 == 0)
	for i in 12:
		step(1 / 60.0, false)
		await get_tree().process_frame
	look_from(bomber, Vector3(-9, 1, 2), Vector3(0, -0.6, -1))
	await Kit.shot(self, "g_scars")
	await frames()

func frames() -> void:
	look_from(bomber, Vector3(-40, 14, 70), Vector3(10, -6, -40))
	var timing := [false]
	var run := func(): pass
	prof.clear()
	var label := "frames 1920x1080 outbound (real time, the whole force)"
	var r := await _timed(10.0, label)
	print("PROF ", _prof_line(r.n))
	# over the target: skip the mission on to the flak belt, then time it there
	var skip := TIMES_TARGET() - 60.0 - mission_time
	_skip(skip)
	for i in 120:
		step(1 / 60.0, true)
		await get_tree().process_frame
	prof.clear()
	r = await _timed(10.0, "frames 1920x1080 in the flak (%s, flak on %s)" % [mission.phase, flak.on])
	print("PROF ", _prof_line(r.n))

func TIMES_TARGET() -> float:
	return Mission.TIMES.target

## main.js game.skip: the mission's clock and its target moved on.
func _skip(s: float) -> void:
	mission_time += s
	mission.target.center.z += Bomber.AIRSPEED * s

func _timed(seconds: float, label: String) -> Dictionary:
	var msv := PackedFloat32Array()
	var end := Time.get_ticks_msec() + int(seconds * 1000)
	var last := Time.get_ticks_usec()
	while Time.get_ticks_msec() < end:
		var now := Time.get_ticks_usec()
		var dt := minf((now - last) / 1e6, 0.05)
		step(dt if dt > 0 else 1 / 60.0, true)
		await RenderingServer.frame_post_draw
		now = Time.get_ticks_usec()
		msv.append((now - last) / 1000.0)
		last = now
	msv.sort()
	var sum := 0.0
	for v in msv:
		sum += v
	var r := {avg = sum / msv.size(), p95 = msv[int(msv.size() * 0.95)], max = msv[msv.size() - 1], n = msv.size()}
	print("%s: %d frames, avg %.2f ms, p95 %.2f, worst %.2f; draw calls %d, primitives %d, video memory %d MB" % [label, r.n, r.avg, r.p95, r.max,
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / 1048576])
	return r

func _prof_line(n: int) -> String:
	var parts := []
	for k in prof:
		parts.append("%s %.2f" % [k, prof[k] / n])
	return "ms a frame: " + ", ".join(parts)

func fly_mission() -> void:
	var speed: int = int(Args.param("speed")) if Args.param("speed") else 6
	var next_report := 0.0
	var shots := {flak = false, fire = false, home = false}
	var burning_at = null
	while mission.phase != "done" and mission_time < 1300:
		for k in speed:
			step(0.05, true)
		# the camera rides with your bomber, behind and above, looking at the stream ahead
		look_from(bomber, Vector3(-60, 25, 110), Vector3(30, -20, -200))
		if mission_time >= next_report:
			next_report += 30
			var burning := bombers.filter(func(b): return not b.down and b.burning).size()
			var crippled := bombers.filter(func(b): return not b.down and b.dead_engines >= 2).size()
			print("T %4d %-9s down %3d (%.1f%%) burning %2d crippled %2d stragglers %2d bias %.2f want %.3f axis %d flak %s %.2f bombs %d" % [mission_time, mission.phase, count_down(), 100.0 * count_down() / bombers.size(), burning, crippled,
				bombers.filter(func(b): return b.straggling).size(), fighters.loss_bias, loss_want, fighters.axis.size(), flak.on, flak.heavy, mission.bombs.list.size()])
		if not shots.flak and mission.phase == "bombrun" and flak.on and flak.heavy > 0.6:
			shots.flak = true
			await Kit.shot(self, "g_mission_flak")
		if not shots.fire and mission_time > 150:
			var c := bombers.filter(func(b): return not b.down and b.burning and b.group.position.distance_to(bomber.group.position) < 900)
			if c.size():
				shots.fire = true
				var b = c[0]
				look_from(b, Vector3(-70, 20, 90), Vector3(0, 0, -10))
				await Kit.shot(self, "g_mission_burning")
		if not shots.home and mission.phase == "homeward" and mission.home_t > 60:
			shots.home = true
			await Kit.shot(self, "g_mission_home")
		await get_tree().process_frame
	await Kit.shot(self, "g_mission_end")
	var by := {}
	var order := []
	for b in bombers:
		var k: String = "%s%s" % [b.unit.group, ("-" + b.unit.part) if b.unit.part else ""] if b.unit else b.squad
		if not by.has(k):
			by[k] = [0, 0]
			order.append(k)
		by[k][1] += 1
		if (b.down or b.gone) and not b.aborted:
			by[k][0] += 1
	print("LOSSES %d of %d (%.1f%%) at %s, mission time %d s" % [count_down(), bombers.size(), 100.0 * count_down() / bombers.size(), mission.phase, mission_time])
	print("BY GROUP " + ", ".join(order.map(func(k): return "%s %d/%d" % [k, by[k][0], by[k][1]])))
	print("BOMBING ", mission.stats, " target destroyed ", mission.target.destroyed, "/", mission.target.buildings.size())
	print("EFFECTS ", effects.get("counts"))
