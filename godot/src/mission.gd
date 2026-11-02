extends RefCounted
# The mission: outbound under fighter attack, the initial point, the bomb run through flak, bombs away,
# the rally and the way home, then the debrief.
# Bombs keep the bomber's forward speed as they fall 7.6 km (~45 s), so they hit ~3 km ahead of where
# they were let go. The Norden sight's crosshair shows exactly that point; the target slides into it.

const Bomber := preload("res://src/bomber.gd")
const World := preload("res://src/world.gd")
const City := preload("res://src/city.gd")
const Self := preload("res://src/mission.gd")

const AIRSPEED := Bomber.AIRSPEED
static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)
const TIMES := {target = 330.0, initial_point = 80.0, home = 360.0} # s: when the target reaches us, IP lead, homeward leg (the second fighter attack, then clear air)
static var GROUND: float = -World.ALTITUDE
const WIND := Vector3(0, 0, AIRSPEED) # the air (and the ground) stream past the formation at airspeed
const BOMB_DRAG := 1.25e-4 # 500 lb GP bomb: falls at up to ~280 m/s
const TRAIN := 0.12 # s between bombs in the train
const ON_TARGET := 305.0 # m: "within 1,000 feet of the aiming point", the measure used at the time
const FLAK_AHEAD := 11000.0 # m from the target where the flak belt starts
const FLAK_BEHIND := 9000.0 # and ends

## Where a bomb let go from `p0` (formation frame) hits, and how long it takes.
static func fall(p0: Vector3) -> Dictionary:
	var p := p0
	var v := Vector3.ZERO
	var dt := 0.05
	var t := 0.0
	while p.y > GROUND and t < 120:
		var rel := v - WIND
		v += rel * (-BOMB_DRAG * rel.length() * dt)
		v.y -= 9.81 * dt
		p += v * dt
		t += dt
	return {p = p, t = t}

## The ground point that a bomb released right now would hit, as it is now (it moves with the ground).
static var _aim_cache := {}
static func aim_offset(y: float) -> Vector3:
	var key := roundi(y / 10)
	if not _aim_cache.has(key):
		var r := fall(Vector3(0, key * 10, 0))
		_aim_cache[key] = Vector3(r.p.x, GROUND - key * 10, r.p.z - AIRSPEED * r.t)
	return _aim_cache[key]

## Every bomb in the air.
class Bombs:
	var mesh: MultiMeshInstance3D
	var list: Array = []
	var max := 2400
	var _buf := PackedFloat32Array()

	func _init(scene: Node) -> void:
		var st := SurfaceTool.new()
		var body := CylinderMesh.new()
		body.top_radius = 0.18; body.bottom_radius = 0.18; body.height = 1.0; body.radial_segments = 10; body.rings = 1
		var nose := SphereMesh.new()
		nose.radius = 0.18; nose.height = 0.36; nose.radial_segments = 10; nose.rings = 6
		var tail := CylinderMesh.new()
		tail.top_radius = 0.0; tail.bottom_radius = 0.18; tail.height = 0.45; tail.radial_segments = 10; tail.rings = 1
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		st.append_from(body, 0, Transform3D(Basis.IDENTITY, Vector3(0, -0.1, 0)))
		st.append_from(nose, 0, Transform3D(Basis.IDENTITY, Vector3(0, -0.6, 0)))
		st.append_from(tail, 0, Transform3D(Basis(Vector3.RIGHT, PI), Vector3(0, 0.62, 0)))
		var m := StandardMaterial3D.new()
		m.albedo_color = Color.hex(0x4b5230ff)
		m.roughness = 0.6
		st.set_material(m)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = st.commit()
		mm.mesh.surface_set_material(0, m)
		mm.instance_count = max
		mm.visible_instance_count = 0
		mesh = MultiMeshInstance3D.new()
		mesh.multimesh = mm
		mesh.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
		scene.add_child(mesh)
		_buf.resize(max * 12)

	func spawn(p: Vector3, squad, unseen := false) -> void: # each bomb tumbles off the rack a little differently: ~100 m of scatter on the ground
		if list.size() < max:
			list.append({p = p, v = Vector3(Self.rand(-2, 2), 0, Self.rand(-2, 2)), squad = squad, unseen = unseen})

	func update(dt: float, impact: Callable) -> void:
		for i in range(list.size() - 1, -1, -1):
			var b: Dictionary = list[i]
			var rel: Vector3 = b.v - WIND
			b.v += rel * (-BOMB_DRAG * rel.length() * dt)
			b.v.y -= 9.81 * dt
			b.p += b.v * dt
			if b.p.y <= Self.GROUND:
				b.p.y = Self.GROUND
				impact.call(b.p, b.squad)
				list.remove_at(i)
		for i in list.size():
			var b: Dictionary = list[i]
			var dir: Vector3 = (b.v - WIND).normalized()
			var q := Quaternion(Vector3.DOWN, dir) if dir.dot(Vector3.DOWN) > -0.9999 else Quaternion(Vector3.RIGHT, PI) # nose into the airflow
			var bs := Basis(q) if not b.unseen else Basis.from_scale(Vector3.ZERO) # (a far group's, its fall moved onto the target: not drawn)
			var t := Transform3D(bs, b.p)
			var o := i * 12
			_buf[o] = t.basis.x.x; _buf[o + 1] = t.basis.y.x; _buf[o + 2] = t.basis.z.x; _buf[o + 3] = t.origin.x
			_buf[o + 4] = t.basis.x.y; _buf[o + 5] = t.basis.y.y; _buf[o + 6] = t.basis.z.y; _buf[o + 7] = t.origin.y
			_buf[o + 8] = t.basis.x.z; _buf[o + 9] = t.basis.y.z; _buf[o + 10] = t.basis.z.z; _buf[o + 11] = t.origin.z
		mesh.multimesh.buffer = _buf
		mesh.multimesh.visible_instance_count = list.size()

var effects
var audio
var ui
var bombers: Array
var player_bomber
var target
var bombs: Bombs
var groups := {}
var phase := "outbound"
var stats := {dropped = 0, on_target = 0, player_dropped = 0, player_on_target = 0}
var home_t := 0.0
var quiet_t := 0.0
var flak_was := false
var listeners: Array = []
var player = null
var fighters = null

func _init(scene: Node, o: Dictionary) -> void:
	effects = o.get("effects"); audio = o.get("audio"); ui = o.get("ui"); bombers = o.bombers; player_bomber = o.player_bomber
	# put the target where the player's group will be over it at TIMES.target
	var aim: Vector3 = player_bomber.base + aim_offset(player_bomber.base.y)
	target = City.new(scene, Vector3(aim.x + rand(-160, 160), GROUND, aim.z - AIRSPEED * TIMES.target))
	bombs = Bombs.new(scene)
	for b in bombers:
		# each lead bombardier's aiming error (m, along / across track): smoke, haze, nerves and flak
		if not groups.has(b.squad):
			groups[b.squad] = {bombers = [], released = false, err = rand(-520, 520), wide = rand(-320, 320)}
		groups[b.squad].bombers.append(b)

func on_end(fn: Callable) -> void:
	listeners.append(fn)

## Rebuild who bombs with whom: swap_bombers moves `squad` between bomber objects.
func regroup() -> void:
	for g in groups.values():
		g.bombers.clear()
	for b in bombers:
		if groups.has(b.squad):
			groups[b.squad].bombers.append(b)

## The point on the ground the bombs of bomber `b` would hit if released now (formation frame).
func aim_point(b) -> Vector3:
	return b.group.position + aim_offset(b.group.position.y)

func group_lead(g: Dictionary):
	for b in g.bombers:
		if b.lead and not b.down:
			return b
	for b in g.bombers:
		if not b.down:
			return b
	return null

var at_sight: bool:
	get:
		return player != null and player.get("station") != null and player.station.get("sight") and player.blend > 0.8

## How far the target is from our crosshair: along (+ = still to come) and across (+ = right).
func sight_error() -> Dictionary:
	var p := aim_point(player_bomber)
	var t: Vector3 = target.center
	return {along = p.z - t.z, across = t.x - p.x}

func update(dt: float, ctx: Dictionary) -> void:
	player = ctx.player
	fighters = ctx.fighters
	var time: float = ctx.time
	var flak = ctx.flak
	target.update(dt, effects)
	var mine = groups.get(player_bomber.squad)

	# steering on the bomb run: the bombardier flies it through the autopilot (A / D at the sight);
	# otherwise the lead bombardier lines the group up on the target by himself
	if phase == "bombrun" and not mine.released:
		if at_sight:
			var keys: Dictionary = player.keys
			target.center.x -= ((1 if keys.get("KeyD", false) else 0) - (1 if keys.get("KeyA", false) else 0)) * 7 * dt
		else:
			var off: float = sight_error().across - mine.wide * 0.3
			target.center.x -= clampf(off, -4 * dt, 4 * dt)

	# phases
	var to_go: float = sight_error().along # metres before the target reaches the crosshair
	if phase == "outbound" and time > TIMES.target - TIMES.initial_point:
		phase = "bombrun"
		ui.log("Initial point. Bomb run, bomb doors open!")
	if player:
		player.sight_ok = phase == "bombrun" and mine and not mine.released # (the Norden: only on the bomb run, until the bombs are away)
	# the stages: outbound, the fighters and no flak; the flak belt, light at first and thickest over the
	# target, the fighters mostly standing off (a few brave it); out of it, a fresh wave of fighters; then
	# they turn for home, out of ammunition and fuel, and there's clear air to the coast
	flak.on = phase != "done" and -to_go < FLAK_BEHIND and to_go < FLAK_AHEAD
	flak.heavy = 0.12 + 0.88 * pow(1 - to_go / FLAK_AHEAD, 1.6) if to_go > 0 else maxf(0.05, pow(1 + to_go / FLAK_BEHIND, 1.3))
	fighters.suppressed = flak.on # fighters stood off while their own flak was firing
	if flak_was and not flak.on and to_go < 0:
		fighters.surge()
		ui.log("Fighters! A fresh wave coming in, fully loaded!")
	flak_was = flak.on
	# (no end to the attacks while any of the Luftwaffe's fighters are still to come: they all come, before the clear air)
	var spent: bool = fighters.reserve.axis <= 0
	# (and once they're all up and only a handful are still fighting (not counting yours, flying one of theirs), that's the end of it: no long wait in an empty sky)
	var thin: bool = spent and home_t > 45 and fighters.axis.filter(func(f): return f.state != "rtb" and not f.player).size() <= 3
	if phase == "homeward" and ((home_t > 230 and spent) or thin or home_t > 300) and not fighters.no_waves:
		fighters.no_waves = true
	if phase == "homeward" and ((home_t > 265 and spent) or thin or home_t > 318) and not fighters.leaving:
		fighters.leaving = true
		ui.log("The fighters are turning back. Out of ammo, out of fuel. Clear air from here.")

	# releases: every group on its lead bombardier; yours on you if you're at the sight
	var release_pressed: bool = player != null and player.release_pressed
	if player:
		player.release_pressed = false # a Space press only counts on the frame it happens
	# (every group on its own lead bombardier as it reaches the target: the wings behind yours, and the 3rd
	# Division, still bombing after your wing has rallied; the rally waits only for your own wing)
	if phase == "bombrun" or phase == "rally" or phase == "homeward":
		for squad in groups:
			var g: Dictionary = groups[squad]
			if g.released:
				continue
			var lead = group_lead(g)
			if not lead:
				g.released = true
				continue
			var along: float = aim_point(lead).z - target.center.z
			if is_same(g, mine) and at_sight:
				if player.firing or release_pressed:
					release(squad, 0.0)
				elif along < -400:
					release(squad, 0.0) # overshot: the toggliers drop anyway
			elif along <= g.err * (0.5 if is_same(g, mine) else 1.0):
				var across: float = 0.0 if is_same(g, mine) else target.center.x - aim_point(lead).x + g.wide
				release(squad, across)
		var wing: String = player_bomber.squad.split("-")[0]
		if phase == "bombrun":
			var all := true
			for sq in groups:
				if sq.split("-")[0] == wing and not groups[sq].released:
					all = false
			if all:
				phase = "rally"
				ui.log("The wing's bombs are away. Rally right, and keep it tight!")
	if phase == "rally" and -to_go > 4000:
		phase = "homeward"
		ui.log("Through the target. Heading for home.")
	if phase == "homeward" and fighters.leaving and not fighters.axis.any(func(f): return f.state != "rtb" and not f.player):
		quiet_t += dt # (all quiet: the last of them turned for home)
	if phase == "homeward":
		home_t += dt
		if home_t > TIMES.home or quiet_t > 15:
			phase = "done"
			for fn in listeners:
				fn.call(debrief())

	# bombs leaving the racks, falling and landing
	for b in bombers:
		if b.dropping == null or b.down:
			continue
		b.dropping.t -= dt
		if b.dropping.t > 0 or b.bombs <= 0:
			continue
		b.dropping.t += TRAIN
		b.bombs -= 1
		var p: Vector3 = b.group.transform * Vector3(b.dropping.dx, -1.8, -4.5)
		# (a group far off to the side, the 3rd Division thirty miles away: its bombs are scored where its
		# lead aimed them, but not drawn falling out of the sky over yours)
		bombs.spawn(p, "player" if b == player_bomber else b.squad, absf(b.dropping.dx) > 3000)
		if b.bombs <= 0:
			b.dropping = null
	bombs.update(dt, func(p, who): impact(p, who))

func release(squad: String, across: float) -> void:
	var g: Dictionary = groups[squad]
	g.released = true
	for b in g.bombers:
		if not b.down and b.bombs > 0:
			b.dropping = {t = rand(0, 0.4), dx = across}
	if squad == player_bomber.squad:
		ui.log("Bombs away!")
		if audio:
			audio.reload(true)
		if player_bomber.interior:
			player_bomber.interior.empty_bomb_bay()

func impact(p: Vector3, who) -> void:
	var d := Vector2(p.x - target.center.x, p.z - target.center.z).length()
	stats.dropped += 1
	if d < ON_TARGET:
		stats.on_target += 1
	if who == "player":
		stats.player_dropped += 1
		if d < ON_TARGET:
			stats.player_on_target += 1
	target.blast(p)
	if effects:
		effects.ground_burst(p)
	if who == "player" and stats.player_dropped == 1 and audio:
		audio.explosion(World.ALTITUDE)

static func _mmss(s: float) -> String:
	return "%d:%02d" % [floori(s / 60), floori(fmod(s, 60))]

## HUD line for the current part of the mission.
func status(time: float) -> String:
	var along: float = sight_error().along
	if phase == "outbound":
		return "Outbound · initial point in %s" % _mmss(maxf(0, TIMES.target - TIMES.initial_point - time))
	if phase == "bombrun":
		return "Bomb run · target %.1f km%s" % [maxf(0, along) / 1000, " · bombs away" if groups[player_bomber.squad].released else ""]
	if phase == "rally":
		return "Rally · leaving the target"
	if phase == "homeward":
		return "Homeward · %s · %s to the coast" % ["flak" if flak_was else "clear air" if fighters and fighters.leaving else "fighters", _mmss(maxf(0, TIMES.home - home_t))]
	return "Mission complete"

## What the mission map (M) shows, in metres from the aiming point on the ground (x right, z back
## along the route; the ground moves, so everything is measured from the target): the route's
## points, the flak belt, and where `self` (a point in the formation's frame) is now.
func map_data(time: float, turn := {heading = 0.0, at = -1500.0, angle = 0.0, rate = 1.0}) -> Dictionary:
	var t: Vector3 = target.center
	var along: float = sight_error().along
	var h: float = turn.heading
	# the route over the ground: in from England, the IP, over the target, the rally turn to the right
	# (an arc: the formation's own turning radius), and the long leg home on the new heading
	var start: float = AIRSPEED * TIMES.target + 3000
	var R: float = AIRSPEED / turn.rate
	var route := [[0.0, start], [0.0, turn.at]]
	for k in range(1, 17):
		var a: float = turn.angle * k / 16.0
		route.append([R * (1 - cos(a)), turn.at - R * sin(a)])
	var end: Array = route[route.size() - 1]
	var rest := maxf(4000, AIRSPEED * TIMES.home - R * turn.angle)
	route.append([end[0] + sin(turn.angle) * rest, end[1] - cos(turn.angle) * rest])
	var c := cos(-h)
	var s := sin(-h)
	return {
		phase = {outbound = "Outbound", bombrun = "Bomb run", rally = "Rally", homeward = "Heading home", done = "Mission complete"}[phase],
		to_target = along / AIRSPEED if along > 0 else null, # s until the target is in the bombsight
		start = start, # where the stream was when the game began (it came on from England)
		ip = AIRSPEED * TIMES.initial_point, rally = route[1], home = route[route.size() - 1], route = route,
		flak = [FLAK_AHEAD, -FLAK_BEHIND],
		# (a point in the formation's frame, on the ground's map: the formation's frame turns with it, so
		# after the turn it's turned back, as a rotation about +Y by -heading)
		rel = func(p: Vector3) -> Array:
			var x := p.x - t.x
			var z := p.z - t.z
			return [x * c + z * s, -x * s + z * c],
		city = target.layout, wrecked = target.destroyed, buildings = target.buildings.size(),
		time = time,
	}

## Point the camera down through the Norden sight (crosshair = where the bombs would hit now).
func sight_camera(camera: Camera3D, p, view_fov := 72.0):
	var on := at_sight
	var fov := 14.0 if on else view_fov # the telescope shows ~1 km of ground round the crosshair
	if camera.fov != fov:
		camera.fov = fov
	if not on:
		return null
	camera.look_at(aim_point(player_bomber)) # the bombers sit in the scene root: formation frame = world
	camera.rotate_object_local(Vector3.UP, p.s_yaw)
	camera.rotate_object_local(Vector3.RIGHT, p.s_pitch)
	var e := sight_error()
	var g: Dictionary = groups[player_bomber.squad]
	return {along = e.along, across = e.across, bombs = player_bomber.bombs, released = g.released, phase = phase}

func debrief() -> Dictionary:
	var out := stats.duplicate()
	out.buildings = target.buildings.size()
	out.destroyed = target.destroyed
	return out
