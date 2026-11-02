extends RefCounted
# Fighters on both sides.
#  Bf 109 raiders make attack passes on the bombers (head-on, high side, from behind, from the beam).
#  Bf 109 hunters go after the escorts. P-47 escorts patrol round the formation and engage any
#  109 that comes near. Anyone with an enemy on their tail breaks hard to shake it off.
# All of them fly the same simple model: coordinated banking turns, cowl/wing guns, part damage,
# and going down in flames. Positions are in the formation's frame: the air streams past at
# AIRSPEED, so a fighter's motion = its airspeed vector + the wind (head-on passes close fast).
# (The port of src/fighters.js: `Fighters.new(scene, {...})` is the JS `new Fighters(scene, {...})`; the
# Fighter class is `Fighters.Fighter`; `Fighters.clock(bomber, p)` and AXIS_TOTAL / ALLIED_TOTAL as exported.)

const Bomber := preload("res://src/bomber.gd")
const Models := preload("res://src/models.gd")
const FarFighters := preload("res://src/farfighters.gd")
const Battle := preload("res://src/battle.gd")
const Oob := preload("res://src/oob.gd")
const World := preload("res://src/world.gd")
const P47 := preload("res://src/p47.gd")

const WIND := Vector3(0, 0, Bomber.AIRSPEED)
const UP := Vector3(0, 1, 0)
const X_AXIS := Vector3(1, 0, 0)
const FIRE_RANGE := 650.0
const BREAK_RANGE := 170.0
const DOGFIGHT_RANGE := 450.0
const SPREAD := 0.015 # rad
const WOBBLE := 0.014 # rad: a pilot can't hold his sight dead on a target while he flies
const PASS_WOBBLE := 0.026 # (diving through the bombers' return fire at a closing speed of 200 m/s, he holds it even worse)
const F_BURST := [0.6, 1.4] # s: fighters fire in bursts too
const F_PAUSE := [0.5, 1.6]
# the Luftwaffe outnumbers the escorts several times over
static var AXIS_ACTIVE: int = Battle.BATTLE.axis_active
static var ALLIED_ACTIVE: int = Battle.BATTLE.allied_active
const HUNTER_SHARE := 0.2 # a fifth of each gaggle goes for the escorts
static var GAGGLE: Array = Battle.BATTLE.gaggle
const FIRST_WAVE := 8.0
const WAVE_GAP := [5.0, 10.0]
const ESCORT_RESPAWN := [18.0, 30.0] # fighters, s
const FREE := -1.0 # an axis slot waiting for the next gaggle
# each side's strength for the whole mission: when the reserves are gone, no more come up (from the battle size)
static var AXIS_TOTAL: int = Battle.BATTLE.axis_total
static var ALLIED_TOTAL: int = Battle.BATTLE.allied_total
const CELL := 100.0 # m: bombers are filed in a grid so a round only tests the ones near it
const CELL_PAD := 65.0
const FCELL := 100.0 # m: fighters are filed too (a frame's flight of a round plus a wingspan)
const FCELL_PAD := 60.0
const RAM := 6.0 # m between two fighters' centres: closer than that their wings or props meet
const RAM_PAD := 2.5 # m added round a B-17's hit boxes for a fighter's size
const AI_RAM_CHANCE := 0.06 # AI pilots mostly just miss (rolled once per close pass)
const AI_MIDAIR_CHANCE := 0.3
const BOMBER_RAM := 11.0 # m between two B-17s' centres: a crippled or falling one drifting into another (their bodies, not their spans)
const FLOOR := 1500.0 # m above the ground: an AI fighter lower than this climbs back up
# The fight goes on all through the force, not only round you (oob COMPACT: the whole of it within a
# few km): the fighters pick their bombers anywhere in FIGHT_RANGE of yours, work the part of the force
# they're over, and run out and come round from the force's middle (hub) rather than from you
static var FIGHT_RANGE: float = Oob.FIGHT_RANGE if Oob.COMPACT else 1300.0 # m from your bomber
static var SPAN: float = 1500.0 if Oob.COMPACT else 0.0 # m: the force's reach from its middle, added to the ranges measured from there
const LOCAL := 1400.0 # m: a fighter's next bomber is one near where he is, most of the time
static var PREY_RANGE: float = 3000.0 + SPAN # m from the formation: a dogfight further off than this is broken off
const BOMBER_RAM_CHANCE := 0.15 # (rolled once per close pass of a pair)
const CONTACT_NEAR := 35.0 # m between centres: closer than this, your B-17's shape is tested against hers
const BRUSH := 5.0 # how hard (m/s closing + 6 x depth in m): a brush below BRUSH, a big hit above SMASH; wings off above WING_OFF
const SMASH := 14.0
const WING_OFF := 9.0

# the shapes that can touch (wings, tailplane, fuselage) and points spread through each, in bomber space
static var SOLID: Array = Bomber.PARTS.filter(func(p): return p.kind == "wing" or p.kind == "tail" or p.kind == "section")
static var SAMPLES: Array = _samples()

static func _samples() -> Array:
	var out := []
	var n := func(a: float, b: float, step: float) -> int: return maxi(2, ceili((b - a) / step) + 1)
	for p in SOLID:
		var pts := PackedVector3Array()
		for q in p.boxes:
			var x0: float = q[0]; var x1: float = q[1]; var y0: float = q[2]; var y1: float = q[3]; var z0: float = q[4]; var z1: float = q[5]
			var nx: int = n.call(x0, x1, 1.4); var ny: int = n.call(y0, y1, 1.6); var nz: int = n.call(z0, z1, 1.4)
			for i in nx:
				for j in ny:
					for k in nz:
						pts.append(Vector3(x0 + (x1 - x0) * i / (nx - 1), y0 + (y1 - y0) * j / (ny - 1), z0 + (z1 - z0) * k / (nz - 1)))
		out.append({part = p, pts = pts})
	return out

## A node's world transform (the bombers and fighters sit in the scene root; out of the tree, its own).
static func _xf(n: Node3D) -> Transform3D:
	return n.global_transform if n.is_inside_tree() else n.transform

## Does any of b's shape reach into a's? Points through b's wings, tailplane and fuselage, taken into a's
## frame and tested against a's. The deepest: { a: a's part, b: b's part, depth, at (world), la, lb (local) }
## (swap: the parts given the other way round, so `a` is always the first bomber's).
func contact(a, b, swap := false):
	var cm: Transform3D = _binv[a] * _xf(b.group) # b's space into a's
	var best = null
	for s in SAMPLES:
		var pbp = s.part
		if b.lost.get(pbp.name, false):
			continue
		for p in s.pts:
			var l: Vector3 = cm * p
			for pa in SOLID:
				if a.lost.get(pa.name, false):
					continue
				for q in pa.boxes:
					if l.x <= q[0] or l.x >= q[1] or l.y <= q[2] or l.y >= q[3] or l.z <= q[4] or l.z >= q[5]:
						continue
					var depth: float = minf(minf(minf(l.x - q[0], q[1] - l.x), minf(l.y - q[2], q[3] - l.y)), minf(l.z - q[4], q[5] - l.z))
					if best == null or depth > best.depth:
						best = {pa = pa, pb = pbp, depth = depth, la = l, lb = p}
	if best == null:
		return null
	var at: Vector3 = _xf(a.group) * best.la
	if swap:
		return {a = best.pb, b = best.pa, depth = best.depth, at = at, la = best.lb, lb = best.la}
	return {a = best.pa, b = best.pb, depth = best.depth, at = at, la = best.la, lb = best.lb}

const SPREAD_CHECKS := 3 # the pairwise checks (on my tail? who to chase?) run every 3rd frame per fighter

const KINDS := {
	bf109 = {
		# m/s through the air: cruise ~410 km/h, flat out ~600 km/h at 25,000 ft; turn rates in rad/s (sustained,
		# in a fight, and a hard break)
		side = "axis", name = "Bf 109", roll = 2.8, pitch_rate = 1.15, yaw_rate = 0.35, cruise = 114.0, setup = 155.0, attack = 150.0, max = 167.0, turn = 0.32, combat = 0.5, break_turn = 0.62, muzzle = 780.0,
		# hit boxes in the fighter's own space (nose -Z, prop axis at y = 0), measured from the model
		parts = {
			pilot = {box = [-0.33, 0.33, 0.05, 0.8, -1.5, -0.3], hp = 2},
			engine = {box = [-0.42, 0.42, -0.55, 0.45, -4.1, -2.3], hp = 14},
			fuel = {box = [-0.4, 0.4, -0.5, 0.05, -0.6, 0.6], hp = 6},
			tail = {box = [-1.7, 1.7, -0.2, 1.55, 3.3, 4.5], hp = 10},
			wingL = {box = [-5.2, -0.4, -0.35, 0.25, -2.4, 0.0], hp = 16},
			wingR = {box = [0.4, 5.2, -0.35, 0.25, -2.4, 0.0], hp = 16},
			fuselage = {box = [-0.42, 0.42, -0.53, 0.6, -2.3, 3.3], hp = 30},
		},
		guns = [ # two MG 17s on the cowl, an MG 151/20 cannon through the spinner
			{at = Vector3(-0.2, 0.35, -3.1), rpm = 1100.0, tracer = 3, cannon = false}, {at = Vector3(0.2, 0.35, -3.1), rpm = 1100.0, tracer = 3, cannon = false},
			{at = Vector3(0, 0, -4.5), rpm = 700.0, tracer = 2, cannon = true},
		],
		smoke_at = Vector3(0, -0.3, -3), fire_at = Vector3(0, 0, -1.5),
	},
	fw190 = {
		# the Fw 190 A-8: heavier, armoured, a little faster than the 109 but not so good a climber up here;
		# the Sturmgruppen took the bombers head-on in tight groups
		side = "axis", name = "Fw 190", roll = 3.8, pitch_rate = 1.05, yaw_rate = 0.33, cruise = 118.0, setup = 158.0, attack = 155.0, max = 180.0, turn = 0.3, combat = 0.47, break_turn = 0.58, muzzle = 800.0,
		parts = {
			pilot = {box = [-0.34, 0.34, 0.1, 0.9, -1.0, 0.4], hp = 4}, # (armoured glass and plate)
			engine = {box = [-0.62, 0.62, -0.62, 0.62, -4.0, -2.3], hp = 20}, # the radial takes a lot of hits
			fuel = {box = [-0.42, 0.42, -0.55, 0.1, -1.6, -0.2], hp = 8},
			tail = {box = [-1.8, 1.8, -0.1, 1.3, 3.3, 4.55], hp = 12},
			wingL = {box = [-5.3, -0.45, -0.6, 0.0, -1.8, 0.45], hp = 20},
			wingR = {box = [0.45, 5.3, -0.6, 0.0, -1.8, 0.45], hp = 20},
			fuselage = {box = [-0.5, 0.5, -0.62, 0.7, -2.3, 3.3], hp = 38},
		},
		guns = [ # two MG 131s over the engine, four MG 151/20 cannon in the wings
			{at = Vector3(-0.17, 0.62, -3.0), rpm = 900.0, tracer = 3, cannon = false}, {at = Vector3(0.17, 0.62, -3.0), rpm = 900.0, tracer = 3, cannon = false},
			{at = Vector3(-0.95, -0.46, -2.3), rpm = 720.0, tracer = 2, cannon = true}, {at = Vector3(0.95, -0.46, -2.3), rpm = 720.0, tracer = 2, cannon = true},
			{at = Vector3(-2.05, -0.38, -1.8), rpm = 700.0, tracer = 2, cannon = true}, {at = Vector3(2.05, -0.38, -1.8), rpm = 700.0, tracer = 2, cannon = true},
		],
		smoke_at = Vector3(0, -0.3, -3), fire_at = Vector3(0, 0, -1.5),
	},
	p47 = {
		# the P-47D "razorback" of autumn 1943: big and heavy, fast up high and in a dive (the turbocharged
		# R-2800), rolls well, turns worse than the 109; very hard to bring down. Short-legged: without drop
		# tanks it could only see the bombers as far as the German border (ESCORT_FUEL)
		side = "allied", name = "P-47", roll = 3.0, pitch_rate = 1.1, yaw_rate = 0.33, cruise = 120.0, setup = 178.0, attack = 172.0, max = 192.0, turn = 0.28, combat = 0.45, break_turn = 0.56, muzzle = 880.0,
		parts = {
			pilot = {box = [-0.4, 0.4, 0.1, 0.85, -0.9, 0.6], hp = 3}, # (armour plate behind the seat)
			engine = {box = [-0.72, 0.72, -0.8, 0.7, -5.2, -3.1], hp = 24}, # the R-2800 radial: famous for coming home shot through
			fuel = {box = [-0.45, 0.45, -0.65, 0.1, -2.9, -1.3], hp = 8},
			tail = {box = [-2.2, 2.2, -0.3, 1.9, 4.4, 5.8], hp = 12},
			wingL = {box = [-6.2, -0.55, -0.85, -0.15, -2.6, 0.5], hp = 20},
			wingR = {box = [0.55, 6.2, -0.85, -0.15, -2.6, 0.5], hp = 20},
			fuselage = {box = [-0.6, 0.6, -1.0, 0.9, -3.1, 4.4], hp = 42},
		},
		guns = [ # eight .50s in the wings, outboard of the wheels (as p47.gd)
			{at = Vector3(-2.55, -0.45, -2.2), rpm = 800.0, tracer = 5, cannon = false}, {at = Vector3(2.55, -0.45, -2.2), rpm = 800.0, tracer = 5, cannon = false},
			{at = Vector3(-2.8, -0.43, -2.09), rpm = 800.0, tracer = 5, cannon = false}, {at = Vector3(2.8, -0.43, -2.09), rpm = 800.0, tracer = 5, cannon = false},
			{at = Vector3(-3.05, -0.41, -1.99), rpm = 800.0, tracer = 5, cannon = false}, {at = Vector3(3.05, -0.41, -1.99), rpm = 800.0, tracer = 5, cannon = false},
			{at = Vector3(-3.3, -0.39, -1.88), rpm = 800.0, tracer = 5, cannon = false}, {at = Vector3(3.3, -0.39, -1.88), rpm = 800.0, tracer = 5, cannon = false},
		],
		smoke_at = Vector3(0, -0.4, -4.2), fire_at = Vector3(0, -0.3, -2.2),
	},
}

const ATTACKS := [["headOn", 3], ["high", 3], ["tail", 2], ["beam", 2]]
# s after the first attack on the bombers: the P-47s are at the end of their fuel and turn back (near
# Aachen, on 14 October 1943), and the bombers go on alone
const ESCORT_FUEL := 75.0
const FW_TOTAL := 100 # Fw 190s among the Luftwaffe's reserve: they come up as whole gaggles of their own
const FW_ATTACKS := [["headOn", 6], ["high", 2], ["tail", 1]] # and mostly take the bombers head-on

static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)

static func pick(list: Array):
	var r := 0.0
	for e in list:
		r += e[1]
	r *= randf()
	for e in list:
		r -= e[1]
		if r < 0:
			return e[0]
	return list[list.size() - 1][0]

## (owner is a fighter, a bomber or a word: 'player', 'crew', 'collision'...; compared only when it's a word)
static func _is(v, s: String) -> bool:
	return v is String and v == s

static func _call(c: Callable, args := []) -> void:
	if c.is_valid():
		c.callv(args)

## Where a segment a->b first enters box [x0,x1,y0,y1,z0,z1] (0..1), or -1.
static func seg_box(a: Vector3, b: Vector3, box: Array) -> float:
	var t0 := 0.0
	var t1 := 1.0
	for k in 3:
		var o: float = a[k]
		var d: float = b[k] - o
		var lo: float = box[k * 2]
		var hi: float = box[k * 2 + 1]
		if absf(d) < 1e-9:
			if o < lo or o > hi:
				return -1.0
			continue
		var u := (lo - o) / d
		var w := (hi - o) / d
		if u > w:
			var s := u; u = w; w = s
		t0 = maxf(t0, u); t1 = minf(t1, w)
		if t0 > t1:
			return -1.0
	return t0

## Shortest distance from point p to segment a-b (the closest point: a + (b - a) * t).
static func seg_point(a: Vector3, b: Vector3, p: Vector3) -> float:
	var ab := b - a
	var l2 := ab.length_squared()
	var t := clampf((p - a).dot(ab) / (l2 if l2 != 0.0 else 1.0), 0.0, 1.0)
	return (a + ab * t).distance_to(p)

static func cell_key(x: int, y: int, z: int) -> int:
	return (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512)

static func _key(p: Vector3, cell: float) -> int:
	return cell_key(floori(p.x / cell), floori(p.y / cell), floori(p.z / cell))

# The grids hold, for each cell, the aircraft that reach into it. (The JS emptied and refilled the cells it
# had used every frame. Here an aircraft is only taken out of its cells and filed into new ones when the
# block of cells it reaches has changed, which for a bomber holding its slot is almost never and for a
# fighter a few times a second: refilling all of them each frame was 7 ms in GDScript. A cell left empty is
# dropped, so the grids stay as small as the fight.) `filed`: item -> [x0, x1, y0, y1, z0, z1] it's in.
static func refile(grid: Dictionary, filed: Dictionary, item, p: Vector3, cell: float, pad: float) -> void:
	var x0 := floori((p.x - pad) / cell); var x1 := floori((p.x + pad) / cell)
	var y0 := floori((p.y - pad) / cell); var y1 := floori((p.y + pad) / cell)
	var z0 := floori((p.z - pad) / cell); var z1 := floori((p.z + pad) / cell)
	var old = filed.get(item)
	if old != null:
		if old[0] == x0 and old[1] == x1 and old[2] == y0 and old[3] == y1 and old[4] == z0 and old[5] == z1:
			return
		unfile(grid, filed, item)
	for x in range(x0, x1 + 1):
		for y in range(y0, y1 + 1):
			for z in range(z0, z1 + 1):
				var k := cell_key(x, y, z)
				var l = grid.get(k)
				if l == null:
					grid[k] = [item]
				else:
					l.append(item)
	filed[item] = [x0, x1, y0, y1, z0, z1]

static func unfile(grid: Dictionary, filed: Dictionary, item) -> void:
	var old = filed.get(item)
	if old == null:
		return
	for x in range(old[0], old[1] + 1):
		for y in range(old[2], old[3] + 1):
			for z in range(old[4], old[5] + 1):
				var k := cell_key(x, y, z)
				var l = grid.get(k)
				if l != null:
					l.erase(item)
					if l.is_empty():
						grid.erase(k)
	filed.erase(item)

## How badly a fighter is hurt short of going down (a crit is a step up): engine smoking, a wing or the
## tail nearly shot through, the fuel tank holed. (Fire, a dead engine or a lost wing bring it down.)
static func crit_level(f) -> int:
	var p: Dictionary = f.parts
	var k: Dictionary = f.k.parts
	return int(f.smoking) + int(p.wingL < k.wingL.hp * 0.4) + int(p.wingR < k.wingR.hp * 0.4) + int(p.tail < k.tail.hp * 0.4) + int(p.fuel < k.fuel.hp * 0.5)

static func clock(bomber, p: Vector3) -> Dictionary:
	var d: Vector3 = _xf(bomber.group).affine_inverse() * p
	var h := int(roundf((atan2(-d.x, -d.z) * -6.0) / PI)) # 12 = dead ahead, 3 = right
	h = ((h % 12) + 12) % 12
	if h == 0:
		h = 12
	# high or low: more than 150 m above or below, or (far off, where that's nothing) 8 degrees up or down
	var up := maxf(150.0, Vector2(d.x, d.z).length() * 0.14)
	return {h = h, level = "high" if d.y > up else "low" if d.y < -up else "level"}

const BANK_MAX := 1.2217304763960306 # rad, 70 degrees (the player's fighter: its steepest bank in a turn)


class Fighter:
	static var next_id := 1

	var kind: String
	var k: Dictionary
	var side: String
	var obj: Node3D # its full model; far away it's drawn as an instance instead (FarFighters)
	var pos: Vector3
	var dir: Vector3 # where the nose points (air-relative heading)
	var speed: float
	var up := UP
	var roll := 0.0
	var state := "approach"
	var timer := 0.0
	var parts := {}
	var smoking := false
	var burning := false
	var engine_dead := false
	var pilot_dead := false
	var wing_gone := false
	var tail_gone := false
	var spin := 0.0
	var gun_timers: Array = []
	var rounds := 0
	var disc: Node3D
	var blades: Node3D
	var spinner: Node3D
	var xf := Transform3D() # where it is (its obj's world transform)
	var inv := Transform3D()
	var id: int
	# what it's doing (each only for the states that use it, as the JS sets them)
	var player := false
	var slot := -1
	var role := ""
	var plan = null
	var target = null # a bomber
	var prey = null # an enemy fighter
	var attack := ""
	var side3 = null # -1 | 1, which side it attacks from
	var setup := Vector3.ZERO
	var aim_offset := Vector3.ZERO
	var break_dir := Vector3.ZERO
	var station = null
	var resume := ""
	var fuel = null
	var check_now := false
	var lead_skill = null
	var pause_t := 0.0
	var burst_t = null
	var fire_left = null
	var player_hit_t := -INF
	var killed_by = null
	var down_time := 0.0
	var bail_t = null
	var fuse = null
	var pass_until := -INF

	var alive: bool:
		get: return state != "down" and state != "gone"
	## Motion in the formation's frame: airspeed along the nose plus the wind.
	var velocity: Vector3:
		get: return dir * speed + WIND

	func _init(kind_: String, obj_: Node3D, full: Node, pos_: Vector3, dir_: Vector3) -> void:
		kind = kind_
		k = KINDS[kind]
		side = k.side
		obj = obj_
		pos = pos_
		dir = dir_.normalized()
		speed = k.cruise
		for n in k.parts:
			parts[n] = k.parts[n].hp
		for g in k.guns:
			gun_timers.append(randf() * 0.1)
		disc = full.find_child("Fake_Blades", true, false)
		blades = full.find_child("BF109_F2_Blades", true, false)
		if blades == null:
			blades = full.find_child("Fw190_Blades", true, false)
		if blades == null:
			blades = full.find_child("P47_Blades", true, false)
		spinner = full.find_child("P47_Spinner", true, false)
		id = next_id
		next_id += 1

	## Turn the nose towards `want` at up to `rate` rad/s; the wings bank into the turn. push: when the turn
	## is nose-down, push over (the wings stay put) rather than roll inverted to pull through (the player's).
	func steer(want: Vector3, rate: float, dt: float, push := false) -> void:
		if not (dt > 0) or want.length_squared() < 1e-9:
			return
		want = want.normalized()
		if push:
			fly(want, rate, dt)
			return
		var old := dir
		var angle := old.angle_to(want)
		if angle > 1e-4:
			var axis := old.cross(want)
			# turning exactly round: any axis at right angles to the nose will do (pull "up" if we can)
			if axis.length_squared() < 1e-10:
				axis = old.cross(UP if absf(old.y) < 0.9 else X_AXIS)
			dir = dir.rotated(axis.normalized(), minf(angle, rate * dt)).normalized()
		# coordinated turn: the lift (the plane's "up") points along gravity-cancelling + turning force
		var lift := (dir - old) * (speed / dt)
		lift.y += 9.81
		lift -= dir * lift.dot(dir)
		# straight up or down there is no "up" from gravity: keep the wings where they were
		if lift.length_squared() > 1e-6:
			lift = lift.normalized()
			# (pushing the nose down harder than gravity pulls it: negative g, the wings stay where they are.
			# Turned towards that downward pull instead, the wings would roll a little more every frame: a spin)
			if push and lift.dot(up) < 0:
				lift = up
			if push: # (yours: banked no further than 60 degrees into a turn, and eased into it: a bank, not a roll)
				var level := UP - dir * dir.y
				if level.length_squared() > 0.04:
					level = level.normalized()
					var a := acos(clampf(lift.dot(level), -1, 1))
					if a > BANK_MAX:
						lift = lift.lerp(level, 1 - BANK_MAX / a).normalized()
			up = up.lerp(lift, 1 - exp(-dt * (2.2 if push else 4.0))).normalized()

	## Yours, flown as the mouse-aim games fly it (War Thunder's "instructor", the MouseFlight scheme): the
	## aim is a point the plane chases and catches. Elevator, rudder and ailerons all at once, each rate in
	## proportion to how far the aim is off in its own axis (quick, and no crawl over the last degrees): the
	## nose pulled round to it, a little rudder for the fine part, and the roll blended from "wings level"
	## when the aim's near the nose to "the aim over your head" when it's well off, so a turn is always a bank
	## INTO it, banked as far as it needs. Behind or straight up: full rate, the shortest way round.
	func fly(want: Vector3, _rate: float, dt: float) -> void:
		var fwd := dir
		var u := (up - fwd * up.dot(fwd)).normalized()
		var right := fwd.cross(u).normalized()
		var ax := want.dot(right)
		var ay := want.dot(u)
		var az := want.dot(fwd)
		var off := acos(clampf(az, -1, 1))
		var pitch_rate: float = k.get("pitch_rate", 1.1)
		var yaw_rate: float = k.get("yaw_rate", 0.35)
		var rr: float = k.get("roll", 3.0)
		# the roll: wings level near the nose, the aim overhead once it's more than ~10 degrees off
		var level := UP - fwd * fwd.y
		var has_level := level.length_squared() > 0.04
		if has_level:
			level = level.normalized()
		var bank := atan2(-level.dot(right), level.dot(u)) if has_level else 0.0 # + = right wing down
		var to_aim := atan2(ax, ay)
		var wings := smoothstep(0.03, 0.18, off)
		var roll_err := lerpf(-bank, to_aim, wings)
		var r := clampf(roll_err * 5, -rr, rr) * dt
		u = u.rotated(fwd, r) # (+: roll right, the right wing down)
		right = fwd.cross(u).normalized()
		# the elevator and the rudder: rates in proportion to the error, up to the type's (pushing: less)
		var pitch_err := atan2(want.dot(u), want.dot(fwd))
		var yaw_err := atan2(want.dot(right), want.dot(fwd))
		var pitch := clampf(pitch_err * 6, -pitch_rate * 0.5, pitch_rate) * dt
		var yaw := clampf(yaw_err * 6, -yaw_rate, yaw_rate) * dt
		fwd = fwd.rotated(right, pitch); u = u.rotated(right, pitch)
		fwd = fwd.rotated(u, -yaw)
		fwd = fwd.normalized()
		dir = fwd
		up = (u - fwd * u.dot(fwd)).normalized()

	func pose() -> void:
		var z := -dir # the models' noses are -Z
		var u := up - dir * up.dot(dir)
		if u.length_squared() < 1e-8:
			u = X_AXIS - dir * dir.x # nose along "up"
		u = u.normalized()
		up = u
		if roll:
			u = u.rotated(dir, roll)
		var x := u.cross(z).normalized()
		var y := z.cross(x)
		xf = Transform3D(Basis(x, y, z), pos)
		# the obj sits in the scene root, so its transform is its world transform
		obj.transform = xf
		inv = xf.affine_inverse()


var scene: Node3D
var effects
var bullets
var audio
var ui
var bombers: Array
var player_bomber
var list: Array = []
var far
var axis: Array = []
var allied: Array = []
var chased := {} # (a set: fighter -> true)
var frame := 0
var axis_slots: Array # a slot per fighter in the air; 0 = flying, > 0 = seconds until a replacement arrives
var wave_t := FIRST_WAVE
var allied_slots: Array
var kills := 0
var last_call := -99.0
var last_friends_call := -99.0
var time := 0.0
var crew_view := true # you're in a B-17 (crew callouts); false while you fly a fighter
var report := Callable() # (kind, name, dmg) -> your score: 'hit' | 'crit' | 'kill' | 'assist'
var reserve := {axis = AXIS_TOTAL, allied = ALLIED_TOTAL} # still to come up (the player's own fighter doesn't count)
var fw_left := FW_TOTAL # of the axis reserve, how many are Fw 190s
var player_side := "allied"
var pilot = null # the player's own fighter's controls (pilot.gd), set by main
# set from main / the mission
var suppressed := false
var leaving := false
var no_waves := false
var loss_bias = null
var group_bias = null # squad -> weight (a Dictionary)
var escorts_home := false
var fight_t = null
var surge_t := 0.0
var pounce_t := 0.0
var call_at = null
var last_ff := -99.0
var last_bump = null
var tally = null
var near = null
var near_at := 0.0
var _hub := Vector3.ZERO
# the hooks main.gd fills in (all optional)
var on_escorts_home := Callable()
var on_crew_kill := Callable()
var on_down := Callable()
var on_bail := Callable()
var on_bomber_hit := Callable()
var on_bumped := Callable()
var on_saved := Callable()
# the grids, and each bomber's inverse transform (and its contact bookkeeping) kept here, not on the bomber
var grid = null
var grid_filed := {}
var fgrid = null
var fgrid_filed := {}
var _binv := {}
var _near_until := {}
var _last_at := {}
var _bumped_until := {}
var last_pb = null
var prof = null # (a Dictionary: ms spent in each part of update, added up; for the frame-time tests)

func _lap(name: String, t0: int) -> int:
	var t1 := Time.get_ticks_usec()
	prof[name] = prof.get(name, 0.0) + (t1 - t0) / 1000.0
	return t1

func _init(scene_: Node3D, o: Dictionary) -> void:
	scene = scene_
	effects = o.get("effects"); bullets = o.get("bullets"); audio = o.get("audio"); ui = o.get("ui")
	bombers = o.get("bombers"); player_bomber = o.get("player_bomber")
	far = FarFighters.new(scene)
	axis_slots = []
	for i in AXIS_ACTIVE:
		axis_slots.append(FREE)
	allied_slots = []
	for i in ALLIED_ACTIVE:
		allied_slots.append(0.2 + i * 0.1)

## Where the action is: the player's bomber (it can change place in the stream).
var center: Vector3:
	get: return player_bomber.group.position

## Bombers close enough to the player that a fight there is worth seeing (refreshed every few s).
func near_bombers() -> Array:
	if near == null or time - near_at > 5:
		near_at = time
		near = bombers.filter(func(b): return not b.down and b.base.distance_to(player_bomber.base) < FIGHT_RANGE)
		# the middle of the force (where the fighters run out from and circle): the bombers in the fight
		var h := Vector3.ZERO
		for b in near:
			h += b.group.position
		_hub = h / near.size() if near.size() else center
	return near

## The middle of the fight: the force's centre (COMPACT), or your bomber.
var hub: Vector3:
	get:
		if Oob.COMPACT:
			near_bombers()
			return _hub
		return center

func spawn(kind: String, slot: int, plan = null, idx := 0, count := 1) -> Fighter:
	var full: Node3D = (await Models.load_model(kind)).scene
	await far.load(kind)
	for m in full.find_children("*", "GeometryInstance3D", true, false):
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	if kind == "p47":
		P47.own_paint(full) # (each its own codes: the JS gave each its own paint on its first draw)
	var obj := Node3D.new() # its full model; far away it's drawn as an instance instead (FarFighters)
	obj.add_child(full)
	var f: Fighter
	var c := center
	if kind == "p47": # escorts are already on station round the formation when they arrive
		var a := rand(0, TAU)
		var r := rand(700, 1300) + SPAN * rand(0.3, 0.9)
		var pos := Vector3(cos(a) * r, rand(350, 800), sin(a) * r) + hub
		f = Fighter.new(kind, obj, full, pos, Vector3(-sin(a), 0, cos(a)))
		f.station = {a = a, r = r, h = pos.y - c.y, rate = rand(0.04, 0.07) * (-1.0 if randf() < 0.5 else 1.0)} # slow enough to hold at cruise
		f.state = "patrol"
	else: # 109s come in as a gaggle from ahead or the side, 4 km out, above: loose lines abreast
		var from: Vector3 = plan.from if plan else Vector3(rand(-3000, 3000), rand(300, 900), -4000) + c
		var toward := Vector3(c.x - from.x, 0, c.z - from.z).normalized()
		var side := toward.cross(UP).normalized()
		var row := idx / 5
		var col := (idx % 5) - 2
		var pos := from + side * (col * 60 + rand(-10, 10)) + toward * (-row * 70) + Vector3(0, rand(-30, 30) + row * 25, 0)
		f = Fighter.new(kind, obj, full, pos, toward)
		f.plan = plan
		f.role = "hunter" if idx < roundi(count * HUNTER_SHARE) else "raider"
		if f.role == "raider":
			new_attack(f)
		else:
			f.state = "hunt"
	f.slot = slot
	list.append(f) # (FarFighters puts it in the scene when it's near)
	return f

## A fighter for the player: a P-47 joins the escort round the bombers; a 109 starts out a few km off.
func spawn_player(kind: String) -> Fighter:
	var f: Fighter = await spawn(kind, -1)
	f.prey = null; f.target = null
	if f.side == "axis": # (not on an attack line into the stream: hands off the controls, that flew him into a B-17)
		# off to one side, ahead and above: the attack is yours to set up
		f.pos = center + Vector3((-1.0 if randf() < 0.5 else 1.0) * 1800, 600, -1500)
		f.plan = null
	# facing the formation, level (above it, a 109 left alone passes over the bombers, not into one): you
	# start with the bombers in front of you, not flying off away from them
	var d := center - f.pos
	d.y = 0
	f.dir = d.normalized()
	return f

## A bomber out of the box draws them: fighters near her peel off from whatever they were setting up and
## come at her (from astern and below), several at once and again and again, until she's back in the box
## or going down. Now and then a P-47 or two breaks off to help her.
func pounce() -> void:
	for b in near_bombers():
		if not b.straggling:
			continue
		var at: Vector3 = b.group.position
		var on := 0
		for f in axis:
			if f.target == b and not f.player:
				on += 1
		var want := 6 if b == player_bomber else 3 # (yours, alone, draws them most: the fight's round you)
		if on < want:
			var free := axis.filter(func(f): return not f.player and f.target != b and (f.state == "extend" or f.state == "approach" or f.state == "hunt") and f.pos.distance_to(at) < 3500)
			free.sort_custom(func(p, q): return p.pos.distance_squared_to(at) < q.pos.distance_squared_to(at))
			for f in free.slice(0, want - on):
				f.role = "raider"; f.plan = null; new_attack(f, b)
		if on and randf() < 0.35: # the escort sees it
			var attacker = null
			for f in axis:
				if f.target == b and not chased.has(f):
					attacker = f
					break
			var esc = null
			if attacker:
				var pats := allied.filter(func(f): return not f.player and f.state == "patrol")
				pats.sort_custom(func(p, q): return p.pos.distance_squared_to(at) < q.pos.distance_squared_to(at))
				esc = pats[0] if pats.size() else null
			if esc and esc.pos.distance_to(at) < 4000:
				esc.prey = attacker; esc.state = "engage"; esc.timer = 25; chased[attacker] = true

func new_attack(f: Fighter, onto = null) -> void:
	if (suppressed or leaving) and not onto and randf() < 0.85: # (their own flak up: most stand off and wait; a few brave it)
		f.state = "extend"
		f.timer = rand(6, 10)
		return
	# fighters went for stragglers (engines out, falling behind) first, then the bombers round the player
	var all := near_bombers().filter(func(b): return not b.down)
	# (the part of the force he's over, most of the time: so the attacks go in all through it, not all at one place)
	var here := all.filter(func(b): return b.group.position.distance_squared_to(f.pos) < LOCAL * LOCAL) if Oob.COMPACT and not f.plan and randf() < 0.85 else all
	var nb: Array = here if here.size() else all
	var plan = f.plan
	f.plan = null # the gaggle attacks together once; after that each one picks his own
	var group: Array = nb.filter(func(b): return b.squad == plan.squad) if plan and plan.get("squad") != null else []
	# a bomber out of the box first, almost always (alone, without the box's guns round her: easy meat);
	# then a crippled one; then any in the box
	var out := nb.filter(func(b): return b.straggling)
	var crippled := nb.filter(func(b): return b.dead_engines > 0)
	var r := randf()
	# (no extra share for the bomber you're in while she keeps her place: it takes its chances like any
	# other in the box. The fight is only ever round you, so an extra share made yours far likelier to go down)
	if onto:
		f.target = onto
	elif out.size() and r < 0.85:
		f.target = out[randi() % out.size()]
	elif group.size():
		f.target = group[randi() % group.size()]
	elif crippled.size() and r < 0.6:
		f.target = crippled[randi() % crippled.size()]
	else:
		f.target = nb[randi() % nb.size()] if nb.size() else player_bomber
	# a straggler: from astern and from below, pressed in close
	if f.target.straggling and not plan:
		f.attack = "tail" if randf() < 0.6 else "low"
	else:
		f.attack = plan.attack if plan and plan.get("attack") else pick(ATTACKS)
	f.side3 = plan.side3 if plan and plan.get("side3") != null else (-1.0 if randf() < 0.5 else 1.0)
	var o: Array
	match f.attack:
		"headOn": o = [rand(-200, 200), rand(250, 550), -2600]
		"high": o = [f.side3 * rand(500, 900), rand(800, 1100), rand(-900, -300)]
		"tail": o = [rand(-300, 300), rand(60, 300), 1900]
		"beam": o = [f.side3 * 1600, rand(-50, 250), rand(-300, 200)]
		_: o = [rand(-250, 250), rand(-480, -260), rand(1000, 1600)] # low
	f.setup = Vector3(o[0], o[1], o[2])
	f.aim_offset = Vector3(rand(-2, 2), rand(-1, 1), rand(-8, 8)) # somewhere on the airframe
	f.state = "approach"

func update(dt: float, player) -> void:
	time += dt
	frame += 1
	var t0 := Time.get_ticks_usec() if prof != null else 0
	file_bombers()
	if prof != null: t0 = _lap("file_bombers", t0)
	# who's flying on each side, and who's already being chased (instead of searching per fighter)
	axis.clear(); allied.clear(); chased.clear()
	for g in list:
		if g.alive:
			(axis if g.side == "axis" else allied).append(g)
		if g.prey:
			chased[g.prey] = true
	tick_waves(dt)
	# the escort's fuel: soon after the fight starts they turn for home (your own P-47: main.gd)
	if fight_t == null and axis.any(func(f): return f.state == "attack"):
		fight_t = time
	if not escorts_home and fight_t != null and time - fight_t > ESCORT_FUEL:
		escorts_home = true
		for f in allied:
			if not f.player:
				f.state = "rtb"; f.prey = null
		ui.log("The Thunderbolts are turning back, they're out of fuel. We're on our own!")
		_call(on_escorts_home)
	if not escorts_home:
		tick_slots(allied_slots, "p47", dt)
	pounce_t -= dt
	if pounce_t <= 0:
		pounce_t = 1.5
		pounce()
	if prof != null: t0 = _lap("waves_slots", t0)
	var nearest := INF
	var closing := 0.0
	var cam: Vector3 = player.camera.global_position
	for f in list:
		if f.player and f.alive:
			if pilot:
				pilot.fly(f, dt) # the player's own fighter
		elif f.alive:
			var check: bool = (frame + f.slot) % SPREAD_CHECKS == 0
			if check and f.state != "evade" and f.state != "break" and threatened(f):
				f.resume = f.state; start_evade(f)
			if leaving and f.side == "axis" and f.state != "attack" and f.state != "rtb" and f.state != "evade":
				f.state = "rtb"
			# fuel: a German fighter has so long over the bombers, then heads home (and the next comes up in his place)
			if f.side == "axis":
				f.fuel = (f.fuel if f.fuel != null else rand(140, 230)) - dt
				if f.fuel <= 0 and f.state != "attack" and f.state != "rtb":
					f.state = "rtb"
			f.check_now = check
			fly(f, dt)
		else:
			fall(f, dt)
		if f.state == "gone":
			continue
		f.pos += f.velocity * dt
		if not is_finite(f.pos.x + f.pos.y + f.pos.z + f.dir.x + f.dir.y + f.dir.z): # never let a bad number spread
			f.state = "gone"
			continue
		f.pose()
		spin_prop(f, dt)
		damage_trails(f, dt)
		if f.player:
			continue # (its engine is heard as your own)
		var d: float = f.pos.distance_to(cam)
		if d < nearest:
			nearest = d
			closing = -f.velocity.dot((f.pos - cam).normalized())
	for i in range(list.size() - 1, -1, -1):
		var f: Fighter = list[i]
		if f.state != "gone":
			continue
		if f.obj.get_parent():
			f.obj.get_parent().remove_child(f.obj)
		f.obj.queue_free()
		list.remove_at(i)
		if fgrid != null:
			unfile(fgrid, fgrid_filed, f)
		if f.player:
			continue # the player's fighter has no slot
		if f.side == "axis":
			free_axis_slot(f.slot)
		else:
			allied_slots[f.slot] = -1.0 if escorts_home else rand(ESCORT_RESPAWN[0], ESCORT_RESPAWN[1])
	if prof != null: t0 = _lap("fly_pose", t0)
	far.update(list, cam)
	if prof != null: t0 = _lap("far", t0)
	file_fighters()
	if prof != null: t0 = _lap("file_fighters", t0)
	collisions(dt)
	if prof != null: t0 = _lap("collisions", t0)
	audio.fighter_drone(nearest, closing)

func free_axis_slot(slot: int) -> void:
	axis_slots[slot] = FREE

## Out of the flak belt: a fresh attack, gaggle after gaggle, fully armed.
func surge() -> void:
	surge_t = 45; wave_t = 0

## Each side's strength: in the air, shot down, still to come.
func counts() -> Dictionary:
	var t: Dictionary = tally if tally else {}
	var c := {axis = {air = 0, fw = 0}, allied = {air = 0}}
	for f in list:
		if f.alive and not f.player:
			c[f.side].air += 1
			if f.kind == "fw190":
				c.axis.fw += 1
	c.axis.down = t.get("axis_lost", 0); c.allied.down = t.get("allied_lost", 0)
	c.axis.reserve = reserve.axis; c.allied.reserve = reserve.allied
	c.axis.total = AXIS_TOTAL; c.allied.total = ALLIED_TOTAL
	return c

## Bf 109s arrive in gaggles: when enough are missing, a whole group comes in together from one direction.
func tick_waves(dt: float) -> void:
	if no_waves:
		return # (the end of the day: no more coming up)
	surge_t = maxf(0, surge_t - dt)
	wave_t -= dt
	if wave_t > 0:
		return
	if suppressed and randf() < 0.8: # (over the flak belt, only the odd gaggle)
		wave_t = rand(WAVE_GAP[0], WAVE_GAP[1])
		return
	var free := []
	for i in axis_slots.size():
		if axis_slots[i] == FREE:
			free.append(i)
	if free.size() < GAGGLE[0]:
		wave_t = 2
		return
	var n := mini(mini(free.size(), roundi(rand(GAGGLE[0], GAGGLE[1]))), reserve.axis)
	if n <= 0: # the Luftwaffe has nothing left to send
		wave_t = 5
		return
	var nb := near_bombers()
	# (a third of the gaggles come for the groups round you, the rest anywhere in the force: you're at its
	# front corner, so an even share left your guns with little to shoot at)
	var round_you: Array = nb.filter(func(b): return b.base.distance_to(player_bomber.base) < 900) if Oob.COMPACT and randf() < 0.33 else []
	var from: Array = round_you if round_you.size() else nb
	var pick_one = from[randi() % from.size()] if from.size() else null
	# (they come in on the group they've picked, wherever it is in the force)
	var c: Vector3 = pick_one.group.position if Oob.COMPACT and pick_one else center
	var a := rand(-2.2, 2.2)
	var dist := rand(3600, 4600)
	# a gaggle of Fw 190s now and then (in proportion to how many are left), the rest Bf 109s
	var fw := fw_left > 0 and randf() < float(fw_left) / maxi(1, reserve.axis)
	var kind := "fw190" if fw else "bf109"
	var count: int = mini(n, fw_left) if fw else n
	var plan := { # they come in together and pick on one group of bombers
		from = Vector3(sin(a) * dist, rand(300, 1000), -cos(a) * dist) + c,
		attack = pick(FW_ATTACKS if fw else ATTACKS), side3 = -1.0 if randf() < 0.5 else 1.0, squad = pick_one.squad if pick_one else null,
	}
	reserve.axis -= count
	if fw:
		fw_left -= count
	for i in count:
		axis_slots[free[i]] = 0.0
		spawn(kind, free[i], plan, i, count)
	wave_t = rand(1.5, 3.5) if surge_t > 0 else rand(WAVE_GAP[0], WAVE_GAP[1])
	if crew_view and time > 20 and not player_bomber.down and c.distance_to(center) < 2000: # (a gaggle for a group far off: not ours to call)
		var cl := clock(player_bomber, plan.from)
		call_at = plan.from # (where the call is from: the radio checks the clock again when it's said)
		ui.log("Large formation of %s coming in at %d o'clock %s! %d of them." % ["Fw 190s" if fw else "fighters", cl.h, cl.level, count])

func tick_slots(slots: Array, kind: String, dt: float) -> void:
	for i in slots.size():
		if slots[i] > 0:
			slots[i] -= dt
			if slots[i] <= 0:
				if reserve.allied <= 0: # no more escorts to send
					slots[i] = -1.0
					continue
				reserve.allied -= 1
				slots[i] = 0.0
				spawn(kind, i)

func enemies(f: Fighter) -> Array:
	return allied if f.side == "axis" else axis

## An enemy fighter sitting on our tail, close and pointing at us?
func threatened(f: Fighter) -> bool:
	for e in enemies(f):
		var d: float = f.pos.distance_to(e.pos)
		if d > 600:
			continue
		var to_us: Vector3 = (f.pos - e.pos).normalized()
		if e.dir.dot(to_us) > 0.94 and f.dir.dot(to_us) > 0.2:
			return true # its nose on us, and it's behind
	return false

func start_evade(f: Fighter) -> void:
	f.state = "evade"
	f.timer = rand(2, 3.5)
	var s := -1.0 if randf() < 0.5 else 1.0
	f.break_dir = f.dir.cross(UP).normalized() * s + Vector3(0, rand(-0.9, 0.2), 0) + f.dir * 0.2

func fly(f: Fighter, dt: float) -> void:
	var k := f.k
	# too near the ground (a dogfight spiralling down): climb out of it first, whatever he was doing
	if World.ALTITUDE + f.pos.y < FLOOR and f.dir.y < 0.35:
		f.speed += (k.max - f.speed) * dt * 0.5
		var w := Vector3(f.dir.x, 0, f.dir.z).normalized()
		w.y = 0.7
		f.steer(w, k.turn, dt)
		return
	# (the escort gone home for fuel: whatever it was doing, once clear of a fight it turns for home)
	if escorts_home and f.side == "allied" and f.state != "rtb" and f.state != "evade" and f.state != "gone":
		f.state = "rtb"; f.prey = null
	match f.state:
		"approach": # raider getting into position for its pass
			if f.target.down or f.target.gone: # already going down: pick another
				new_attack(f)
				return
			var p: Vector3 = f.target.group.position + f.setup
			f.speed += (k.setup - f.speed) * dt * 0.5 # full throttle to get ahead of the bombers
			f.steer(p - f.pos, k.turn, dt)
			if f.pos.distance_to(p) < 450:
				f.state = "attack"
				if crew_view and f.target == player_bomber and time - last_call > 6:
					last_call = time
					var c := clock(player_bomber, f.pos)
					call_at = f.pos
					ui.log("Fighters, %d o'clock %s!" % [c.h, c.level])
		"attack": # diving at a bomber, guns firing
			if f.target.down: # it's finished: go and find another
				start_break(f)
				return
			var tgt: Vector3 = f.target.group.position + f.aim_offset
			var dist0 := tgt.distance_to(f.pos)
			tgt += wobble(f, dist0, PASS_WOBBLE) # his aim wanders while he dives in
			var to_tgt := tgt - f.pos
			var dist := to_tgt.length()
			f.speed += (k.attack - f.speed) * dt * 0.6
			f.steer(to_tgt, k.combat - 0.1, dt)
			if dist < FIRE_RANGE and f.dir.angle_to(to_tgt) < 0.07:
				shoot(f, dt)
			var closure := f.velocity.dot(to_tgt.normalized())
			var alone: bool = f.target.straggling # (a straggler can't hit back much: they come in to point-blank)
			if dist < (90.0 if alone else BREAK_RANGE) or (closure > 0 and dist / closure < (0.45 if alone else 0.9)) or dist > 3500:
				start_break(f)
		"break": # pull away under or past the bombers
			f.speed = minf(k.max, f.speed + dt * 6)
			f.steer(f.break_dir, k.break_turn, dt)
			f.timer -= dt
			if f.timer <= 0:
				f.state = "extend"; f.timer = rand(3, 5)
		"extend": # run out, climb back, then come round again
			if f.target and f.target.straggling: # (on a straggler: only out a little way and straight back in)
				var away: Vector3 = f.pos - f.target.group.position
				away.y = 0
				away = Vector3(1, 0, 0) if away.length_squared() < 1 else away.normalized()
				f.speed += (k.cruise - f.speed) * dt * 0.3
				away.y = 0.25
				f.steer(away, k.turn, dt)
				f.timer -= dt
				if f.timer <= 0 and f.pos.distance_to(f.target.group.position) > 900:
					new_attack(f)
				return
			var out: Vector3 = f.pos - (f.target.group.position if Oob.COMPACT and f.target and not f.target.gone else center)
			out.y = 0
			var far_ := out.length()
			out = Vector3(1, 0, 0) if out.length_squared() < 1 else out.normalized()
			# (out to a couple of km, then round the stream rather than further away: never lost out of the fight)
			if far_ > 2200:
				out = (Vector3(-out.z, 0, out.x) * (f.side3 if f.side3 != null else 1.0) + out * -0.3).normalized()
			f.speed += (k.cruise - f.speed) * dt * 0.3
			out.y = 0.05 if far_ > 2200 else 0.35
			f.steer(out, k.turn, dt)
			if far_ > 3200 and f.timer <= 0:
				new_attack(f)
				return
			f.timer -= dt
			if f.timer <= 0 and far_ > 1500:
				new_attack(f)
		"evade":
			f.speed = minf(k.max, f.speed + dt * 8)
			f.steer(f.break_dir, k.break_turn, dt)
			f.timer -= dt
			if f.timer <= 0:
				if f.role == "raider":
					f.state = "extend"; f.timer = rand(2, 4)
				else:
					f.state = "patrol" if f.side == "allied" else "hunt"
		"patrol": # escort weaving round its station above the formation
			var s: Dictionary = f.station
			s.a += s.rate * dt
			var p := Vector3(cos(s.a + s.rate * 4) * s.r, s.h, sin(s.a + s.rate * 4) * s.r) + hub
			f.speed += (k.cruise - f.speed) * dt * 0.4
			f.steer(p - f.pos, k.turn, dt)
			var bandit = pick_prey(f, 2500) if f.check_now else null
			if bandit:
				f.prey = bandit
				f.state = "engage"
				f.timer = 25
				chased[bandit] = true
				var c := clock(player_bomber, f.pos)
				if crew_view and f.pos.distance_to(player_bomber.group.position) < 1500 and time - last_friends_call > 20:
					last_friends_call = time
					ui.log("Little friends at %d o'clock!" % c.h)
		"rtb": # out of ammunition (or the end of the day): away from the bombers, climbing, and gone
			var away := f.pos - hub
			away.y = 0
			away = Vector3(1, 0, 0) if away.length_squared() < 1 else away.normalized()
			f.speed += (k.cruise - f.speed) * dt * 0.3
			away.y = 0.15
			f.steer(away, k.turn, dt)
			if f.pos.distance_to(hub) > 6500 + SPAN:
				f.state = "gone"
		"hunt": # 109 hunter: find an escort and get on its tail
			if f.prey and f.prey.pos.distance_to(hub) > PREY_RANGE:
				f.prey = null # (gone off from the bombers: let him go)
			if not (f.prey and f.prey.alive):
				f.prey = pick_prey(f, 3500)
				if f.prey:
					chased[f.prey] = true
			if not f.prey:
				f.role = "raider"
				new_attack(f)
				return
			f.state = "engage"
			f.timer = 30
		"engage": # dogfight: lead pursuit on the prey, fire when the nose is on it
			var e = f.prey
			f.timer -= dt
			if not (e and e.alive) or f.timer <= 0 or e.pos.distance_to(f.pos) > 4000 or e.pos.distance_to(hub) > PREY_RANGE:
				f.prey = null; f.lead_skill = null
				f.state = "patrol" if f.side == "allied" else "hunt"
				return
			var dist := f.pos.distance_to(e.pos)
			if f.lead_skill == null:
				f.lead_skill = rand(0.55, 1.2) # deflection shooting: few pilots had the eye for it
			var lead: Vector3 = e.pos + (e.velocity - f.velocity) * ((dist / k.muzzle) * f.lead_skill) + wobble(f, dist)
			var to := lead - f.pos
			f.speed += ((k.max if dist > 600 else k.attack) - f.speed) * dt * 0.5
			f.steer(to, k.combat, dt)
			if dist < DOGFIGHT_RANGE and f.dir.angle_to(to) < 0.05:
				shoot(f, dt)
			if dist < 70 and f.velocity.dot(e.pos - f.pos) > 0:
				start_evade(f) # overshoot: pull off

func start_break(f: Fighter) -> void:
	f.state = "break"
	f.timer = rand(2, 3)
	var away: Vector3 = f.dir.cross(UP).normalized() * (f.side3 if f.side3 != null else NAN)
	f.break_dir = f.dir + Vector3(0, -1.4 if f.attack == "high" else -0.9, 0) + away * 0.8

## Nearest enemy fighter (within range of the formation) that nobody is already chasing.
func pick_prey(f: Fighter, range_: float):
	var best = null
	var bd := INF
	var h := hub
	for e in enemies(f):
		if e.pos.distance_to(h) > range_ + SPAN:
			continue
		if chased.has(e):
			continue # one chaser each, so some raiders get through
		var d: float = e.pos.distance_to(f.pos)
		if d < bd:
			bd = d; best = e
	return best

## How far off his aim point a pilot's sight wanders (slow weaving, different for each pilot).
func wobble(f: Fighter, dist: float, amount := WOBBLE) -> Vector3:
	var t := time
	var w := dist * amount
	return Vector3(sin(t * 1.9 + f.id), sin(t * 1.4 + f.id * 1.7), sin(t * 1.1 + f.id * 2.3)) * w

func shoot(f: Fighter, dt: float) -> void:
	# trigger discipline: bursts with pauses between them
	if f.pause_t > 0:
		f.pause_t -= dt
		return
	if f.side == "axis":
		f.fire_left = (f.fire_left if f.fire_left != null else (13.0 if f.kind == "fw190" else 16.0)) - dt
		if f.fire_left <= 0: # out of ammunition: home
			f.state = "rtb"
			return
	f.burst_t = (f.burst_t if f.burst_t != null else rand(F_BURST[0], F_BURST[1])) - dt
	if f.burst_t <= 0:
		f.burst_t = rand(F_BURST[0], F_BURST[1]); f.pause_t = rand(F_PAUSE[0], F_PAUSE[1])
	var vel := f.velocity
	var team := "enemy" if f.side == "axis" else "allied"
	var guns: Array = f.k.guns
	for i in guns.size():
		var g: Dictionary = guns[i]
		f.gun_timers[i] -= dt
		while f.gun_timers[i] <= 0:
			f.gun_timers[i] += 60.0 / g.rpm
			var muzzle: Vector3 = f.xf * g.at
			var d := (Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)) * SPREAD + f.dir).normalized()
			bullets.spawn(muzzle, d * f.k.muzzle + vel, f.rounds % g.tracer == 0, team, f, g.cannon, f, 1.6)
			f.rounds += 1
	if randf() < dt * 10:
		audio.distant_gun(f.pos.distance_to(player_bomber.group.position))

## A round's path a -> b this frame. Returns true if it hit something (the round is used up).
func collide(a: Vector3, b: Vector3, team: String, owner, cannon: bool, src) -> bool:
	# friendly fire is on: any round can hit any aircraft except the one that fired it
	var hit_b := hit_bomber(a, b, cannon, src, owner)
	if hit_b:
		if player_side == "allied" and _is(owner, "player") and time - last_ff > 4:
			last_ff = time
			ui.log("Cease fire! You're hitting our own bombers!")
		return true
	if fgrid == null:
		return false
	var cand = fgrid.get(_key(a, FCELL))
	if not cand:
		return false
	var reach := a.distance_to(b) + 8
	for f in cand:
		if f.state == "gone" or f == src:
			continue
		var dx: float = a.x - f.pos.x
		var dy: float = a.y - f.pos.y
		var dz: float = a.z - f.pos.z
		if dx * dx + dy * dy + dz * dz > reach * reach:
			continue # cheap reject first: most rounds are nowhere near
		if seg_point(a, b, f.pos) > 7:
			continue
		var la: Vector3 = f.inv * a
		var lb: Vector3 = f.inv * b
		var best = null
		var bt := 2.0
		for k in f.k.parts:
			var t := seg_box(la, lb, f.k.parts[k].box)
			if t >= 0 and t < bt:
				bt = t; best = k
		if best == null:
			continue
		effects.impact(a.lerp(b, bt))
		var was_alive: bool = f.alive
		var mine: bool = _is(owner, "player") and f.side != player_side
		var crits := crit_level(f) if mine else 0
		if was_alive:
			damage(f, best, owner, team)
		if was_alive and not f.alive and _is(owner, "crew") and src == player_bomber:
			_call(on_crew_kill, [f]) # (one of your own crew's)
		if mine and was_alive: # your round on an enemy: a hit; set it on fire, kill the engine or take a wing off: a crit
			f.player_hit_t = time
			_call(report, ["hit", f.k.name, 3 if cannon else 1])
			if f.alive and crit_level(f) > crits:
				_call(report, ["crit", f.k.name])
		if _is(owner, "player"):
			if f.side != player_side:
				ui.hit_marker(was_alive and not f.alive) # (no marker for hitting your own side)
			if f.side == player_side and time - last_ff > 4:
				last_ff = time
				ui.log("Cease fire! That's one of ours, a %s!" % f.k.name)
		return true
	return false

func damage(f: Fighter, part: String, owner, team: String) -> void:
	if (team == "enemy") == (f.side == "axis"):
		owner = "friendly" # shot by its own side: nobody's kill
	f.parts[part] -= 1
	if f.player: # your own fighter hit: you hear it strike, and feel it if it's the cockpit
		audio.impact(false, 0.8)
		if part == "pilot":
			audio.pain(1, f.parts.pilot <= 0, 0.3)
			ui.hit_flash(1)
	var hp: float = f.parts[part]
	var full: float = f.k.parts[part].hp
	if part == "engine" and hp < full * 0.5:
		f.smoking = true
	if part == "engine" and hp <= 0 and not f.engine_dead:
		f.engine_dead = true
		if randf() < 0.5:
			f.burning = true
	if part == "fuel" and hp <= 0:
		f.burning = true; f.fuse = rand(2.5, 6)
	if part == "pilot" and hp <= 0:
		f.pilot_dead = true
	if (part == "wingL" or part == "wingR") and hp <= 0 and not f.wing_gone: # the wing tears off and tumbles away
		f.wing_gone = true; f.burning = true; f.spin = (-1.0 if part == "wingL" else 1.0) * rand(2.5, 4)
		effects.wreck(f.xf * Vector3(-3 if part == "wingL" else 3, 0, -1.2), f.velocity, 2, Vector3(3.5, 0.2, 1.6), 0.6)
	if part == "tail" and hp <= 0 and not f.tail_gone:
		f.tail_gone = true; f.spin = rand(-1.5, 1.5)
		effects.wreck(f.xf * Vector3(0, 0.6, 4), f.velocity, 2, Vector3(2.2, 0.15, 1.0), 0.2)
	if part == "fuselage" and hp <= 0:
		f.burning = true
	if f.engine_dead or f.pilot_dead or f.parts.wingL <= 0 or f.parts.wingR <= 0 or f.parts.tail <= 0 or f.parts.fuselage <= 0 or f.burning:
		shot_down(f, owner)

func shot_down(f: Fighter, owner) -> void:
	# a 109 the player shoots down on its way in to the bombers: an attack broken up, bombers saved
	if _is(owner, "player") and not crew_view and f.side == "axis" and (f.state == "attack" or f.state == "approach"):
		_call(on_saved) # (your P-47, not your gun in a B-17)
	f.state = "down"
	f.killed_by = owner
	_call(on_down, [f, owner]) # (the interphone: radio.gd)
	if tally == null:
		tally = {player = 0, crew = 0, escorts = 0, axis_lost = 0, allied_lost = 0}
	var t: Dictionary = tally
	var nobody := ["friendly", "bailout", "collision", "ground"].has(owner) if owner is String else false
	if f.side == "axis":
		t.axis_lost += 1
		if _is(owner, "player"):
			t.player += 1
		elif _is(owner, "crew"):
			t.crew += 1
		elif not nobody:
			t.escorts += 1
	else:
		t.allied_lost += 1
	f.down_time = rand(8, 14)
	# the pilot gets out (if he's alive and the plane isn't in pieces at once)
	if not f.pilot_dead and not _is(owner, "collision") and randf() < 0.55:
		f.bail_t = rand(1.5, 4.5)
	if not f.spin:
		f.spin = rand(-0.8, 0.8)
	if _is(owner, "player") and f.side != player_side:
		kills += 1
		ui.kill(kills)
		_call(report, ["kill", f.k.name])
	elif f.side != player_side and not _is(owner, "player") and f.player_hit_t > time - 20:
		_call(report, ["assist", f.k.name]) # you damaged it, someone else finished it
	elif crew_view and not (owner is String and ["collision", "friendly", "ground", "bailout"].has(owner)) and f.pos.distance_to(player_bomber.group.position) < 1500 and randf() < 0.6:
		ui.log("Escort got one!" if f.side == "axis" else "Little friend going down!")

func fall(f: Fighter, dt: float) -> void:
	# out of control: the nose drops, speed builds, it rolls or spins; burning ones may blow up
	f.speed = minf(f.k.max + 40, f.speed + dt * 7)
	f.steer(f.dir + Vector3(0, -0.9, 0), 0.12 if f.engine_dead and not f.burning else 0.3, dt)
	f.roll += f.spin * dt
	if f.bail_t != null:
		f.bail_t -= dt
		if f.bail_t <= 0:
			effects.parachute(f.pos + Vector3(0, 3, 0))
			f.bail_t = null
			_call(on_bail, [f])
	if f.fuse != null:
		f.fuse -= dt
		if f.fuse <= 0:
			explode(f)
			return
	f.down_time -= dt
	if f.down_time <= 0 or f.pos.y < -2500:
		if f.burning and f.pos.distance_to(player_bomber.group.position) < 2500:
			explode(f)
		else:
			f.state = "gone"

func explode(f: Fighter) -> void:
	effects.explosion(f.pos, f.velocity, 1)
	effects.wreck(f.pos, f.velocity, 4, Vector3(2.2, 0.3, 1.2), 0.4) # the plane in pieces
	audio.explosion(f.pos.distance_to(player_bomber.group.position))
	f.state = "gone"

func spin_prop(f: Fighter, dt: float) -> void:
	if not f.obj.get_parent():
		return # drawn as a far-away instance: no prop to see
	var turning := not f.engine_dead
	if f.disc:
		f.disc.visible = turning
		f.disc.rotate_object_local(Vector3(0, 0, 1), dt * 40)
	if f.blades:
		f.blades.visible = not turning
		if f.state == "down":
			f.blades.rotate_object_local(Vector3(0, 0, 1), dt * 3)
	if f.spinner:
		f.spinner.rotate_object_local(Vector3(0, 0, 1), dt * (45.0 if turning else 3.0))

func damage_trails(f: Fighter, dt: float) -> void:
	if not f.burning and not f.engine_dead and not f.smoking:
		return
	var v := f.velocity
	if f.burning:
		effects.trail(f.xf * f.k.fire_at, v, "fire", dt)
	elif f.engine_dead:
		effects.trail(f.xf * f.k.smoke_at, v, "black", dt)
	else:
		effects.trail(f.xf * f.k.smoke_at, v, "glycol", dt)

# ----- German rounds against the bombers -----
## File every bomber into the grid cells it (plus a frame's flight of a round) reaches. Once per frame.
func file_bombers() -> void:
	if grid == null:
		grid = {}
	for bomber in bombers:
		if bomber.gone:
			unfile(grid, grid_filed, bomber)
			continue
		# the bomber's own transform only (it sits in the scene root): its parts are the renderer's job
		_binv[bomber] = _xf(bomber.group).affine_inverse()
		refile(grid, grid_filed, bomber, bomber.group.position, CELL, CELL_PAD)

## Mid-air collisions. Fighter with fighter: both lose a wing or the tail and go down. Fighter with a B-17:
## the fighter is wrecked and the bomber badly damaged where it hit (a 109 pilot ramming counts as his kill).
## B-17 with B-17: only possible while you fly yours out of its slot; both go down.
func collisions(dt := 0.0) -> void:
	for f in list:
		if not f.alive:
			continue
		for g in fgrid.get(_key(f.pos, FCELL), []):
			if g == f or not g.alive or g.id < f.id:
				continue # each pair once
			if f.pos.distance_squared_to(g.pos) > RAM * RAM:
				continue
			if not f.player and not g.player and not close_call(f, AI_MIDAIR_CHANCE):
				continue
			ram(f); ram(g)
			call_collision(f.pos, "Mid-air! A %s and a %s collided!" % [f.k.name, g.k.name])
			break
		if not f.alive:
			continue
		for b in (grid.get(_key(f.pos, FCELL), []) if grid else []):
			if b.gone:
				continue
			var l: Vector3 = _binv[b] * f.pos
			var part = null
			for p in Bomber.PARTS:
				var q = p.box
				if l.x > q[0] - RAM_PAD and l.x < q[1] + RAM_PAD and l.y > q[2] - RAM_PAD and l.y < q[3] + RAM_PAD and l.z > q[4] - RAM_PAD and l.z < q[5] + RAM_PAD:
					part = p
					break
			if part == null:
				continue
			if not f.player and not close_call(f, AI_RAM_CHANCE):
				continue
			b.last_hit_by = "player" if f.player else "collision"; b.last_hit_t = time
			for i in 34:
				b.hit(part, true) # tons of fighter at 200 m/s: wings and tails break
			if part.get("section") == "nose" or part.get("section") == "cockpit":
				b.go_down("Rammed head-on! The cockpit is gone!")
			for i in 3:
				_call(on_bomber_hit, [b, part, l, true]) # the crew near the impact
			if b == player_bomber:
				audio.impact(true)
			ram(f)
			explode(f)
			call_collision(f.pos, "We've been rammed!" if b == player_bomber and crew_view else "A %s has rammed a B-17!" % f.k.name)
			break
	# a crippled bomber drifting out of the box, or one falling, can hit another on the way
	for b in bombers:
		if b.gone or b.crashed or not (b.down or b.dead_engines >= 2):
			continue
		for o in (grid.get(_key(b.group.position, FCELL), []) if grid else []):
			if o == b or o.gone or o.crashed or o.group.position.distance_squared_to(b.group.position) > BOMBER_RAM * BOMBER_RAM:
				continue
			# one roll per close pass of the pair (not one a frame), and most near things miss
			if not _near_until.has(b):
				_near_until[b] = {}
			var nu: Dictionary = _near_until[b]
			if nu.get(o, -1.0) > time:
				continue
			nu[o] = time + 3
			if randf() >= BOMBER_RAM_CHANCE:
				continue
			b.crashed = true; o.crashed = true # (they go down together; checked once)
			var mid: Vector3 = (b.group.position + o.group.position) * 0.5
			effects.explosion(mid, Vector3(0, -10, 30), 2.5)
			effects.wreck(mid, Vector3(0, -5, 25), 8, Vector3(5, 0.4, 2.5), 0.5)
			if not o.down:
				o.go_down("Mid-air collision!")
			if not b.down:
				b.go_down("Mid-air collision!")
			if crew_view and (o == player_bomber or b == player_bomber):
				ui.log("We've collided with another B-17!")
			else:
				call_collision(mid, "Two B-17s have collided!")
			break
	bomber_contact(dt)

## You flying your B-17 into another: contact between their real shapes (wings, tailplane, fuselage), not
## their centres, and as bad as it was hard. A brush (a wingtip, a scrape): a jolt, a little damage, both
## knocked apart and the controls kicked for a moment. A real hit: heavy damage where they met, an engine
## or a wingtip gone, a long fight for control. Wing into wing hard: those wing panels come off. Only a big
## hit into a fuselage takes both straight down.
func bomber_contact(dt: float) -> void:
	var pb = player_bomber
	if not pb.off_station or pb.down or pb.gone or dt <= 0:
		last_pb = null
		return
	var at: Vector3 = pb.group.position
	var v_a: Vector3 = (at - (last_pb if last_pb != null else at)) / dt # (your velocity through the box)
	last_pb = at
	for b in bombers:
		if b == pb or b.down or b.gone or b.group.position.distance_squared_to(at) > CONTACT_NEAR * CONTACT_NEAR:
			continue
		if _bumped_until.get(b, 0.0) > time:
			continue # (just knocked apart: not the same contact twice)
		var c = contact(pb, b)
		if c == null:
			c = contact(b, pb, true)
		if c == null:
			continue
		# how hard: the closing speed along the line between them, and how deep they went into each other
		var v_b: Vector3 = (b.group.position - _last_at.get(b, b.group.position)) / dt
		var n: Vector3 = (b.group.position - at).normalized()
		var closing := maxf(0, v_a.dot(n) - v_b.dot(n))
		var hard: float = closing + c.depth * 6
		last_bump = {hard = hard, closing = closing, depth = c.depth, mine = c.a.name, theirs = c.b.name} # (for the tests)
		bump(pb, b, c, n, hard)
	for b in bombers:
		if not b.gone and b.group.position.distance_squared_to(at) < CONTACT_NEAR * CONTACT_NEAR * 4:
			_last_at[b] = b.group.position

func bump(pb, b, c: Dictionary, n: Vector3, hard: float) -> void:
	var mine = c.a # the parts that met: yours, hers
	var theirs = c.b
	var wings: bool = mine.kind == "wing" and theirs.kind == "wing"
	var hull: bool = mine.kind == "section" or theirs.kind == "section"
	var where: Vector3 = c.at
	# knocked apart, both of them (her AI pilot then takes her back to her slot)
	var push: float = c.depth * 0.6 + 0.5 + minf(4, hard * 0.15)
	pb.base += n * -push; b.base += n * push
	_bumped_until[pb] = time + 1.5; _bumped_until[b] = time + 1.5
	var level := 0 if hard < BRUSH else 1 if hard < SMASH else 2
	var k: float = [0.35, 0.8, 1.0][level]
	var T: float = [1.6, 4.5, 6.0][level]
	for x in [pb, b]:
		x.knock = {t = T, T = T, yaw = (-1.0 if randf() < 0.5 else 1.0) * [0.08, 0.22, 0.35][level], roll = (-1.0 if randf() < 0.5 else 1.0) * [0.25, 0.6, 0.9][level]}
	effects.impact(where, true); effects.impact(where + n, level > 0)
	if level > 0:
		effects.wreck(where, Vector3(0, -3, 20), 6 if level == 2 else 3, Vector3(1.2, 0.15, 0.8), 0.15)
	_call(on_bumped, [k, level])
	# the damage where they met (and an engine on that stretch of wing)
	var hits: int = [2, 8, 20][level] # (each as a cannon shell: 3 points. A brush dents her; a hit takes a third of a wing panel; a big one tears it open)
	var engines := func(part, l: Vector3) -> Array:
		if part.kind != "wing":
			return []
		return Bomber.PARTS.filter(func(p): return p.kind == "engine" and absf((p.box[0] + p.box[1]) / 2.0 - l.x) < 1.6)
	for e in [[pb, mine, c.la], [b, theirs, c.lb]]:
		var x = e[0]
		var part = e[1]
		var l: Vector3 = e[2]
		for i in hits:
			x.hit(part, true)
		if level > 0:
			for en in engines.call(part, l):
				var i := 0
				while i < hits * 0.6:
					x.hit(en, true)
					i += 1
		_call(on_bomber_hit, [x, part, l, level > 0, (_binv[x].basis * (n * (-1.0 if x == pb else 1.0))).normalized()]) # (into her own frame, as the holes are)
	var side := func(p) -> String: return "left" if p.side < 0 else "right"
	var msg: String
	if level == 2 and hull: # into her fuselage, hard: both finished
		b.go_down("Mid-air collision!"); pb.go_down("Mid-air collision! We hit another B-17!")
		msg = "We've collided with another B-17! She's breaking up!"
	elif level >= 1 and wings and hard > WING_OFF: # wing into wing: those panels come off
		b.lose_wing(theirs.side, bool(theirs.get("inner", false)), "Mid-air collision: her wing is gone!")
		pb.lose_wing(mine.side, bool(mine.get("inner", false)), "Mid-air collision! We've lost the %s wing!" % side.call(mine))
		msg = "We've lost the %s wing!" % side.call(mine)
	elif level == 0:
		msg = "We scraped her wingtip! Our %s wing's dented." % side.call(mine) if mine.kind == "wing" else "We bumped another B-17! Ease off!"
	else:
		msg = "We've hit another B-17! %s badly damaged!" % ("The %s wing is" % side.call(mine) if mine.kind == "wing" else "The tail is" if mine.kind == "tail" else "We are")
	last_bump.level = level; last_bump.msg = msg
	if crew_view:
		ui.log(msg)
	else:
		call_collision(where, "Two B-17s have touched!")

## An AI pilot's close pass: one roll per pass (a second), and most of the time he just misses.
func close_call(f: Fighter, chance: float) -> bool:
	if f.pass_until > time:
		return false
	f.pass_until = time + 1
	return randf() < chance

## A fighter's collision: a wing or the tail is gone, maybe a fire; it goes down (nobody's kill).
func ram(f: Fighter) -> void:
	if not f.alive:
		return
	var lost: String = ["wingL", "wingR", "tail"][randi() % 3]
	f.parts[lost] = 0
	f.spin = rand(-1.5, 1.5) if lost == "tail" else (-1.0 if lost == "wingL" else 1.0) * rand(2.5, 4)
	if randf() < 0.5:
		f.burning = true
	shot_down(f, "collision")

func call_collision(at: Vector3, text: String) -> void:
	var pf = pilot.f if pilot else null
	if pf and at.distance_to(pf.pos) < 30 and not crew_view:
		ui.log("You collided!")
	elif at.distance_to(player_bomber.group.position if crew_view else (pf.pos if pf else at)) < 1500:
		ui.log(text)

## File the fighters into grid cells too, once a frame after they've moved.
func file_fighters() -> void:
	if fgrid == null:
		fgrid = {}
	for f in list:
		if f.state == "gone":
			unfile(fgrid, fgrid_filed, f)
			continue
		refile(fgrid, fgrid_filed, f, f.pos, FCELL, FCELL_PAD)

func hit_bomber(a: Vector3, b: Vector3, cannon: bool, src, owner) -> bool:
	if grid == null:
		file_bombers()
	var lst = grid.get(_key(a, CELL))
	if not lst:
		return false
	var reach := a.distance_to(b) + 20
	for bomber in lst:
		if bomber.gone or bomber == src:
			continue
		var g: Vector3 = bomber.group.position
		var dx := a.x - g.x
		var dy := a.y - g.y
		var dz := a.z - g.z
		if dx * dx + dy * dy + dz * dz > reach * reach:
			continue # quick reject
		if seg_point(a, b, g) > 20:
			continue
		var inv: Transform3D = _binv[bomber]
		var la := inv * a
		var lb := inv * b
		var part = null
		var t := 2.0
		for p in Bomber.PARTS:
			if seg_box(la, lb, p.box) < 0:
				continue # (not near it at all)
			for q in p.boxes:
				var u := seg_box(la, lb, q)
				if u >= 0 and u < t:
					t = u; part = p
		if part == null:
			continue
		effects.impact(a.lerp(b, t), cannon)
		var mine: bool = _is(owner, "player") and player_side == "axis" and not bomber.down
		var crits: int = bomber.dead_engines + (10 if bomber.burning else 0) if mine else 0
		# (the enemy's fire on the rest of the stream, weighted to keep the mission's losses on course: main.gd)
		# (never shielding a straggler: alone, she gets the full weight of it)
		# (and the AI fighters' fire on them counts for a little less: the flak takes its share too, flak.gd)
		var kk := 1.0
		if not _is(owner, "player") and bomber != player_bomber:
			kk = 0.8 * (loss_bias if loss_bias != null else 1.0) * (group_bias.get(bomber.squad, 1.0) if group_bias else 1.0) * (bomber.hist_k if bomber.hist_k != null else 1.0)
		var n := floori(kk) + (1 if randf() < fmod(kk, 1.0) else 0)
		while n > 0:
			bomber.hit(part, cannon)
			n -= 1
		if mine:
			ui.hit_marker(bomber.down) # a 109 pilot's rounds on a B-17 (red and bigger if that brought it down)
			bomber.player_hit_t = time
			_call(report, ["hit", "B-17", 3 if cannon else 1])
			if not bomber.down and bomber.dead_engines + (10 if bomber.burning else 0) > crits:
				_call(report, ["crit", "B-17"])
		bomber.last_hit_by = owner; bomber.last_hit_t = time # for the fighter pilots' score
		_call(on_bomber_hit, [bomber, part, la.lerp(lb, t), cannon, lb - la])
		if bomber == player_bomber:
			audio.impact(cannon)
		return true
	return false
