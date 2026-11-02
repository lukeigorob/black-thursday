extends RefCounted
# The ten men of every bomber: who mans which gun, being wounded, first aid, and the AI gunners.
# In the player's bomber the crew are visible figures who walk to help the wounded; in every other
# bomber the same rules run without figures.
#
# (Godot: the script is the Crew class, `Crew.new(bomber, opts)`, its module functions static; a man is a
# Dictionary with the same fields the web game's objects had, all present from the start.)

const Figure := preload("res://src/figure.gd")
const Bomber := preload("res://src/bomber.gd")
const Lines := preload("res://src/lines.gd")
const CockpitB17 := preload("res://src/cockpitb17.gd")

# flak fragments through the hull: the fuselage's box in bomber space, a man's half-width round his chest,
# and who wears a flak vest (the gunners in the waist, the tail and the ball)
const HULL := [-1.25, 1.25, -2.45, 1.8, -11.4, 11.4]
const BODY := 0.4
static var VEST := RegEx.create_from_string("waist|tail|ball")
const _CHEST := Vector3(0, 0.95, 0)
static var HULL_R := Vector3(1.25, 2.45, 11.4).length() # m: the hull's bounding sphere, round the bomber's origin

## Where a path from `o` along `d` enters the fuselage's box (its distance), or null if it misses it.
static func slab(o: Vector3, d: Vector3):
	var t0 := 0.0
	var t1 := INF
	for a in 3:
		var oa := o[a]
		var da := d[a]
		var lo: float = HULL[a * 2]
		var hi: float = HULL[a * 2 + 1]
		if absf(da) < 1e-9:
			if oa < lo or oa > hi:
				return null
			continue
		var ta := (lo - oa) / da
		var tb := (hi - oa) / da
		if ta > tb:
			var s := ta; ta = tb; tb = s
		t0 = maxf(t0, ta); t1 = minf(t1, tb)
		if t0 > t1:
			return null
	return t0

const D := PI / 180.0
# how far a hand sits from its shoulder at a grip, as a share of his reach: elbow bent but not folded
const FAR := 0.85
const NEAR := 0.5
# the men who stand to a flexible gun (stand_to_gun): lean = forward from the hips at a level gun (negative
# back), pitch_lean = how much less as it's raised, crouch = how low his hips may go (of their standing
# height), stride and width = his stance (m), twist = his shoulders turned in behind the grips
const STAND := {
	waistL = {lean = 0.38, pitch_lean = 0.3, crouch = 0.58, stride = 0.34, width = 0.15, twist = 0.08},
	waistR = {lean = 0.38, pitch_lean = 0.3, crouch = 0.58, stride = 0.34, width = 0.15, twist = -0.08},
	radio = {lean = -0.24, pitch_lean = 0.15, crouch = 0.8, stride = 0.36, width = 0.14, twist = 0.05},
}
const TOP_STANCE := {stride = 0.2, width = 0.13} # (the engineer's feet on the turret's little platform)
static func rand(a: float, b: float) -> float: return a + randf() * (b - a)
static func _wrap(a: float) -> float: return atan2(sin(a), cos(a))
const WOUND_TIME := 30.0
const REVIVE_TIME := 4.0
const WALK := 1.2 # s, s, m/s
const GUN_RANGE := 900.0
const FIRE_RANGE := 650.0
const AI_RPM := 750.0
const AI_SPREAD := 0.006
const AIM_ERROR := 0.03 # rad: real bomber gunners hit very little at range (grows with crossing speed)
const ACQUIRE := [0.8, 2.2]
const BURST := [0.5, 1.3]
const PAUSE := [1.4, 3.5]
const SPRAY := 0.1 # s, s, s, chance of a burst at nothing much
const ACTIVE_RANGE := 1200.0 # bombers further than this from the player don't simulate their gunners
static var tally := {saved = 0, saved_by_you = 0} # for the debrief

# What each man wears over his F-1 heated suit on 14 October 1943, by his station (hackathon/
# CREW_GEAR_RESEARCH.md, its station table): the waist and tail gunners at their open windows in full
# sheepskin, the pilots in B-3 sheepskin jackets too (their fleece collars), the nose and the radio operator in B-10s (or an A-2),
# the ball gunner in his F-1 alone. The pilots in their officer's caps, crushed, with an HS-38 headset over
# them (as the 303rd's pilots wore them that first year in England); everyone else in a B-6 helmet; every
# man in the A-10 Revised mask. No flak vests: the heavy plated vests were left off (they read as a shapeless
# box over the jacket); opts.flak still adds one if a station ever needs it.
const KIT := {
	pilot = {outfit = "b3od", flak = false, cap = true}, copilot = {outfit = "b3od", flak = false, cap = true}, # (the B-3's sheepskin collar under the cap, as the officers wore it)
	bombardier = {outfit = "b10", flak = false}, navigator = {outfit = "a2", flak = false},
	engineer = {outfit = "b3od", flak = false}, radio = {outfit = "b10", flak = false},
	ball = {outfit = "f1", flak = false}, waistL = {outfit = "sheep", flak = false}, waistR = {outfit = "sheep", flak = false}, tail = {outfit = "sheep", flak = false},
}
const ROLES := [
	{id = "pilot", title = "Pilot", rank = "Lt.", station = "pilot"},
	{id = "copilot", title = "Co-pilot", rank = "Lt.", station = "copilot"},
	{id = "bombardier", title = "Bombardier", rank = "Lt.", station = "noseR"},
	{id = "navigator", title = "Navigator", rank = "Lt.", station = "cheekL"}, # (on the B-17F he manned the left cheek gun, beside his table)
	{id = "engineer", title = "Engineer", rank = "T/Sgt.", station = "top"},
	{id = "radio", title = "Radio operator", rank = "T/Sgt.", station = "radio"},
	{id = "ball", title = "Ball gunner", rank = "S/Sgt.", station = "ball"},
	{id = "waistL", title = "Left waist", rank = "S/Sgt.", station = "waistL"},
	{id = "waistR", title = "Right waist", rank = "S/Sgt.", station = "waistR"},
	{id = "tail", title = "Tail gunner", rank = "S/Sgt.", station = "tail"},
]
# (the surnames: lines.gd, where their calls are recorded)
const WHERE := {head = "the head", torso = "the chest", armL = "the left arm", armR = "the right arm", legL = "the left leg", legR = "the right leg"} # (the parts of you, player.gd)

# where each man is in the player's bomber: spot = feet, pose, yaw (0 = facing the nose); lie = where he falls
# (his feet: lying, he stretches 1.8 m forward of them, so the men in the nose lie well back in it)
static var SPOTS := {
	pilot = {at = [-0.55, 0.05, -7.6], pose = "sit", yaw = 0.0, lie = [-0.55, 0.05, -7.6], lie_pose = "slump", help = [-0.18, -0.40, -7.2]},
	copilot = {at = [0.55, 0.05, -7.6], pose = "sit", yaw = 0.0, lie = [0.55, 0.05, -7.6], lie_pose = "slump", help = [0.18, -0.40, -7.2]},
	bombardier = {at = [0.26, -0.72, -9.9], pose = "kneel", yaw = 0.0, lie = [0.24, -0.72, -8.75], lie_pose = "lie"}, # (kneeling upright behind the right nose gun: standing, the low nose bent him double)
	navigator = {at = [-0.38, -0.72, -9.45], pose = "kneel", yaw = 70 * D, lie = [-0.26, -0.72, -8.7], lie_pose = "lie"}, # (kneeling at the left cheek gun, as the bombardier does behind his)
	engineer = {at = [0, -0.28, -6.78], pose = "stand", yaw = 0.0, lie = [0.1, -0.40, -7.05], lie_pose = "lie"},
	radio = {at = [0, -1.8, -2.25], pose = "gun", yaw = PI, lie = [-0.1, -1.80, -1.8], lie_pose = "lie"}, # at his gun under the roof hatch, facing aft
	ball = {at = [0, -2.2, -0.13], pose = "hidden", yaw = 0.0, lie = [0.05, -1.95, 0.95], lie_pose = "lie"}, # pulled out of the turret
	# (back to back at their guns, staggered: stand_to_gun puts them where the guns' sights do)
	waistL = {at = [0.02, -1.95, 2.02], pose = "gun", yaw = 90 * D, lie = [-0.2, -1.95, 2.6], lie_pose = "lie"}, # (staggered: the right gun is forward)
	waistR = {at = [-0.02, -1.95, 1.58], pose = "gun", yaw = -90 * D, lie = [0.2, -1.95, 1.1], lie_pose = "lie"},
	tail = {at = [0, -2.32, 9.98], pose = "kneel", yaw = 180 * D, lie = [0, -2.32, 9.3], lie_pose = "lie"},
}

# the walkway through the fuselage, nose to tail, through the doors and round the ball turret
# (from the nose through the crawlway under the flight deck, up through the hatch between the seats)
static var CORRIDOR: Array = [[0, -0.72, -9.75], [0, -0.72, -8.95], [0, -1.0, -8.55], [0, -1.0, -7.62], [0, -0.40, -7.5], [0, -0.40, -6.6], [0, -0.72, -6.22], [0, -1.02, -5.97],
	[0, -1.32, -5.72], [0, -1.62, -5.4], [0, -1.62, -2.75], [0, -1.80, -2.45], [0, -1.80, -1.4], [0, -1.95, -1.05], [0.6, -1.95, -0.7],
	[0.6, -1.95, 0.4], [0, -1.95, 0.8], [0, -1.95, 5.0], [0, -2.15, 5.4], [0, -2.15, 8.0], [0, -2.32, 8.4], [0, -2.32, 9.5]].map(func(p): return Vector3(p[0], p[1], p[2]))

static func _v(a) -> Vector3:
	return a if a is Vector3 else Vector3(a[0], a[1], a[2])
static func _a(v: Vector3) -> Array:
	return [v.x, v.y, v.z]

## How the man at a station sits or stands there (for the player's own body).
static func spot_for(station_id) -> Variant:
	for r in ROLES:
		if r.station == station_id:
			return SPOTS[r.id]
	return null

## Down in the crawlway under the flight deck (on hands and knees there).
static func in_crawlway(p: Vector3) -> bool:
	return (p.y < -0.6 and p.z > -8.9 and p.z < -7.4) or (p.z > 5.0 and p.z < 9.3) # (and the tail, beyond its bulkhead)

static func section_at(z: float) -> String:
	for s in Bomber.SECTIONS:
		if z >= s[1] and z < s[2]:
			return s[0]
	return "waist"

static func walk_path(from: Vector3, to: Vector3) -> Array:
	var near := func(p: Vector3) -> int:
		var bi := 0
		for i in CORRIDOR.size():
			if (CORRIDOR[i] as Vector3).distance_to(p) < (CORRIDOR[bi] as Vector3).distance_to(p):
				bi = i
		return bi
	var a: int = near.call(from)
	var b: int = near.call(to)
	var pts := [from]
	var step := 1 if a <= b else -1
	var i := a
	while (i <= b) if a <= b else (i >= b):
		pts.append(CORRIDOR[i])
		i += step
	pts.append(to)
	return pts

# ---------- figures ----------
static func make_figure(opts := {}) -> Figure.Fig: # (the airman himself is built in figure.gd)
	return Figure.make_figure(opts)

## The head marker's box in `parent`'s space: [top, centre].
static func _head_box(j: Figure.Joints, parent: Node3D) -> Array:
	var box: AABB = j.head.get_meta("box")
	var xf := parent.global_transform.affine_inverse() * j.head.global_transform
	var lo := Vector3(INF, INF, INF)
	var hi := -lo
	for k in 8:
		var p := xf * box.get_endpoint(k)
		lo = lo.min(p); hi = hi.max(p)
	return [hi.y, (lo + hi) * 0.5]

## Fit a posed man under the roof: the B-17 is cramped (the waist is barely head height, the tail gunner
## kneels in a space half that), so if his head would go through the hull he bends his knees, then
## leans forward over his gun, until it's clear. `interior` measures the hull round him.
static func fit_under_roof(fig: Figure.Fig, interior, pose_name: String) -> void:
	var standing := pose_name == "gun" or pose_name == "stand"
	var j := fig.j
	var parent := fig.get_parent() as Node3D
	if not parent or not interior or not fig.is_inside_tree():
		return
	# (torso.rotation.x < 0 leans him forward)
	var lean0 := j.torso.rotation.x
	var dir := -1.0
	for k in 40:
		var hb := _head_box(j, parent)
		var c: Vector3 = hb[1]
		var roof: float = interior.roof_at(c.z, c.x, fig.position.y + 0.3) - 0.05
		if hb[0] <= roof:
			return
		var h := j.hips.position.y
		if standing and h > 0.5: # bend the knees: a squat that keeps the feet under him
			var H := h - 0.05
			var a := acos(clampf(H / 0.92, 0, 1))
			j.hips.position.y = H
			for l in [j.leg_l, j.leg_r]:
				l.hip.rotation.x = a; l.knee.rotation.x = -2 * a
			j.torso.rotation.x = minf(lean0, -a * 0.45)
		elif pose_name == "kneel" and h > 0.3: # sit back on the heels, shins flat on the floor
			var H := h - 0.04
			var a := acos(clampf((H - 0.06) / 0.44, 0, 1))
			j.hips.position.y = H
			for l in [j.leg_l, j.leg_r]:
				l.hip.rotation.x = a; l.knee.rotation.x = -PI / 2 - a
		elif absf(j.torso.rotation.x) < 1.2: # lean over the gun, head tipped up to keep looking ahead
			j.torso.rotation.x += dir * 0.08
			j.head.rotation.x = -j.torso.rotation.x * 0.7
		elif dir < 0: # no room leaning forward (the hull curves in there): sit back instead
			dir = 1
			j.torso.rotation.x = lean0
		else:
			return

static func _set_r(o: Node3D, x := 0.0, z := 0.0) -> void:
	o.rotation = Vector3(x, 0, z)

## Set a pose: joint angles in radians (x = forward/back, z = sideways). `t` animates walking.
static func pose(fig: Figure.Fig, name: String, t := 0.0) -> void:
	var j := fig.j
	fig.visible = name != "hidden"
	if fig.rig: # hands half closed, or relaxed; at a gun, animate_gunner puts them on the grips
		fig.rig.grip = 0.6 if ["gun", "kneel", "crouch", "sit", "slump"].has(name) else 0.3
		fig.rig.reach = null
		fig.rig.feet = null
	fig.rotation.x = 0
	j.hips.position = Vector3(0, 0.95, 0)
	_set_r(j.torso); _set_r(j.head)
	for a in [j.arm_l, j.arm_r]:
		_set_r(a.sh, 0, 0); _set_r(a.el)
	for l in [j.leg_l, j.leg_r]:
		_set_r(l.hip); _set_r(l.knee)
	j.arm_l.sh.rotation.z = -0.12; j.arm_r.sh.rotation.z = 0.12
	match name:
		"sit", "slump":
			j.hips.position.y = 0.05
			for l in [j.leg_l, j.leg_r]:
				_set_r(l.hip, 1.5); _set_r(l.knee, -1.5)
			for a in [j.arm_l, j.arm_r]:
				_set_r(a.sh, 0.9); _set_r(a.el, 0.5)
			if name == "slump":
				_set_r(j.torso, 0.55); _set_r(j.head, 0.5)
				for a in [j.arm_l, j.arm_r]:
					_set_r(a.sh, 0.2)
		"gun": # standing square to a gun, feet apart, knees a little bent, both hands on the spade grips
			j.hips.position.y = 0.91
			_set_r(j.leg_l.hip, 0.14, -0.1); _set_r(j.leg_r.hip, 0.14, 0.1)
			_set_r(j.leg_l.knee, -0.3); _set_r(j.leg_r.knee, -0.3)
			for a in [j.arm_l, j.arm_r]:
				_set_r(a.sh, 1.1, 0); _set_r(a.el, 0.6)
			_set_r(j.torso, -0.06)
		"kneel":
			j.hips.position.y = 0.5
			for l in [j.leg_l, j.leg_r]:
				_set_r(l.hip, 0); _set_r(l.knee, -1.55)
			for a in [j.arm_l, j.arm_r]:
				_set_r(a.sh, 1.2); _set_r(a.el, 0.4)
			_set_r(j.torso, 0.25)
		"crouch":
			j.hips.position.y = 0.62
			for l in [j.leg_l, j.leg_r]:
				_set_r(l.hip, 1.0); _set_r(l.knee, -1.6)
			_set_r(j.torso, 0.4)
			for a in [j.arm_l, j.arm_r]:
				_set_r(a.sh, 1.0); _set_r(a.el, 0.5)
		"walk":
			var s := sin(t * 7)
			_set_r(j.leg_l.hip, s * 0.45); _set_r(j.leg_r.hip, -s * 0.45)
			_set_r(j.leg_l.knee, -maxf(0, -s) * 0.6); _set_r(j.leg_r.knee, -maxf(0, s) * 0.6)
			_set_r(j.arm_l.sh, -s * 0.35, -0.12); _set_r(j.arm_r.sh, s * 0.35, 0.12)
			_set_r(j.torso, 0.08)
		"crawl": # on hands and knees, as through the crawlway: arms and legs going in turn
			var s := sin(t * 5)
			j.hips.position.y = 0.46
			_set_r(j.torso, 1.45); _set_r(j.head, -1.1)
			_set_r(j.arm_l.sh, 1.45 + s * 0.3, -0.1); _set_r(j.arm_r.sh, 1.45 - s * 0.3, 0.1)
			for lk in [[j.leg_l, -s], [j.leg_r, s]]:
				_set_r(lk[0].hip, 0.15 + lk[1] * 0.2); _set_r(lk[0].knee, -1.6)
		"lie": # on his back on the floor
			fig.rotation.x = -PI / 2
			j.hips.position.y = 0.95 # rotated: this lifts him 15 cm off the floor plane
			fig.position.y += 0.15
			_set_r(j.leg_l.hip, 0.15); _set_r(j.leg_r.knee, -0.5); _set_r(j.leg_r.hip, 0.4)
			_set_r(j.arm_l.sh, 0.3, -0.5); _set_r(j.arm_r.sh, -0.2, 0.9)
			_set_r(j.head, -0.3)

static func _aabb_dist(b: AABB, p: Vector3) -> float:
	return p.clamp(b.position, b.end).distance_to(p)

static func _now() -> float:
	return Time.get_ticks_usec() / 1e6

# ---------- crew ----------
var bomber
var visible := false
var interior = null
var members: Array = []
var gunners := {} # station id -> aim state
var listeners: Array = []
var on_sound = null # Callable(kind, member) or null
var bail_fx = null
var relief = null
var frame := 0
var burn_t := 0.0
var recheck := -1.0
var inv_at := -1
var inv := Transform3D()
var turret_t := 0.0

## visible = the player's bomber (figures + walking). player_role = the role the player plays.
func _init(bomber_, opts := {}) -> void:
	bomber = bomber_
	visible = opts.get("visible", false)
	interior = opts.get("interior", null)
	var player_role = opts.get("player_role", null)
	# the men: the real crew where the records have them (history.gd: bomber.hist_crew, their names and ranks
	# as recorded: no rank where none is), and for a man not on record a placeholder name, marked as one
	var names: Array = Lines.SURNAMES.duplicate()
	names.shuffle()
	var real = bomber.get("hist_crew") if bomber.get("hist_crew") else {}
	for i in ROLES.size():
		var role: Dictionary = ROLES[i]
		var h = real.get(role.id)
		members.append({
			role = role, name = ((("%s %s" % [h.rank, h.name]) if h.get("rank") else h.name) if h else "%s %s" % [role.rank, names[i]]),
			state = "player" if role.id == player_role else "ok",
			historical = {confidence = h.get("confidence"), fate = h.get("fate")} if h else null, placeholder = h == null,
			wound_left = 0.0, task = "station", spot = SPOTS[role.id], fig = null, pos = null, path = [], patient = null,
			health = 1.0, patched = false, stand_in = false, displaced = false, on_tail = false, hatch = null, walk_t = 0.0, revive_t = 0.0,
		})
	if visible:
		for m in members:
			m.fig = Figure.make_figure(KIT[m.role.id].merged({seed = ROLES.find(m.role) * 7 + 3}))
			# (the model's waist is barely 1.7 m under the roof, its windows low: the men who stand at
			# their guns there are on the short side, as many gunners were)
			if m.role.id.begins_with("waist"):
				m.fig.scale = Vector3.ONE * 0.92
			interior.group.add_child(m.fig)
			place(m)

func on_event(fn: Callable) -> void: listeners.append(fn)
func emit(msg: String) -> void: # only your own crew's calls are heard
	if visible:
		for fn in listeners:
			fn.call(msg)
func _sound(kind: String, m) -> void:
	if on_sound:
		on_sound.call(kind, m)

func member(role_id: String):
	for m in members:
		if m.role.id == role_id:
			return m
	return null
var alive: Array:
	get: return members.filter(func(m): return m.state == "ok" or m.state == "wounded" or m.state == "player")

## Is this gun crewed right now (by an AI man at his post)?
func manned(station_id: String, player = null) -> bool:
	var st = player.station if player else null
	var at = ("noseR" if st.id == "bombsight" else st.id) if st else null # the bombardier mans both
	if player and at == station_id:
		return false
	if bomber.has_method("turret_works") and not bomber.turret_works(station_id): # knocked out
		return false
	for m in members:
		if m.role.station == station_id:
			return (m.state == "ok" or (m.state == "player" and m.stand_in)) and m.task == "station"
	return false

func _where(m) -> Vector3:
	return _v(m.spot.at) if m.task == "station" or m.pos == null else m.pos

## A round struck the bomber at `local` (bomber space): anyone close by in that section may be hurt.
func on_hit(part, local: Vector3, cannon: bool, player = null) -> void:
	if part.kind != "section":
		return
	# how much a round does to a man: more the closer it strikes, a 20 mm shell's splinters far more
	var harm := func(near: float) -> float:
		return near * (0.75 if cannon else 0.32) * (0.6 + randf() * 0.8) if randf() < near * (0.9 if cannon else 0.55) else 0.0
	for m in members:
		if m.state != "ok":
			continue
		var p := _where(m) + Vector3(0, 0.9, 0)
		if section_at(p.z) != part.section:
			continue
		var d: float = harm.call(maxf(0, 1 - p.distance_to(local) / 2.2))
		if not d:
			continue
		m.health -= d
		if m.health <= 0: # (down the first time; patched up once, the next one kills him)
			if m.patched: kill(m)
			else: wound(m)
		else:
			_sound("hurt", m)
	if player and not player.wounded and not player.dead:
		var p: Vector3 = player.feet + Vector3(0, 0.9, 0)
		var how = player.hurt(harm.call(maxf(0, 1 - p.distance_to(local) / 2.0)), player.zone_at(local, 0.6))
		if how:
			_sound("down" if how == "down" else "hurt", null)
		if how == "hurt":
			emit("You're hit in %s!" % WHERE[player.last_zone])
		if how == "down":
			emit("You're hit in %s! You're down!" % WHERE[player.last_zone])
			find_helper({player = player})
		if how == "dead":
			emit("You're hit again. You didn't make it.")

## Flak fragments through the fuselage: n of them flung every way from the burst at `from` (bomber space);
## those whose path crosses the hull go through it (so a burst close by sprays her near side, one further
## off sends a few through). The first man (or you) within a body's width of a fragment's path takes it, harder
## the less hull it has come through; a flak vest takes some of it. Returns where up to three of them
## came in (for the holes in her skin): [{at, dir}].
func shrapnel(from: Vector3, n: int, player = null) -> Array:
	var holes := []
	var men := []
	for m in members:
		if m.state != "ok":
			continue
		men.append({m = m, player = null, p = _where(m) + _CHEST, vest = VEST.search(m.role.id) != null})
	if player and not player.wounded and not player.dead:
		men.append({m = null, player = player, p = player.feet + _CHEST, vest = VEST.search(str(player.role if player.get("role") else "")) != null})
	# only those flung towards her can reach her: the cone round the hull's bounding sphere (the same share
	# of the n as that cone is of all directions), each evenly spread through it
	var dist := from.length()
	var cos_a := sqrt(1 - pow(HULL_R / dist, 2)) if dist > HULL_R else -1.0
	var toward := roundi(n * (1 - cos_a) / 2 + randf() - 0.5)
	var axis := (-from).normalized()
	var u := Vector3(1, 0, 0).cross(axis)
	if u.length_squared() < 1e-6:
		u = Vector3(0, 1, 0).cross(axis)
	u = u.normalized()
	var w := axis.cross(u)
	for i in toward:
		var ct := 1 - randf() * (1 - cos_a)
		var st := sqrt(1 - ct * ct)
		var ph := randf() * TAU
		var dir := axis * ct + u * (st * cos(ph)) + w * (st * sin(ph))
		var t_in = slab(from, dir)
		if t_in == null:
			continue
		if holes.size() < 3:
			holes.append({at = from + dir * t_in, dir = dir})
		var hit = null
		var ht := INF
		for x in men: # the first man along its path
			var t: float = (x.p - from).dot(dir)
			if t < t_in or t >= ht:
				continue
			if (from + dir * t).distance_to(x.p) > BODY:
				continue
			hit = x; ht = t
		if hit == null:
			continue
		# (slowed by the air on the way, by the hull and what's inside, by a flak vest)
		var force := clampf(1.15 - t_in / 90.0, 0.25, 1) * clampf(1 - (ht - t_in) / 4.5, 0.15, 1) * (0.6 if hit.vest else 1.0)
		var harm := rand(0.3, 0.95) * force
		tally.fragments = tally.get("fragments", 0) + 1
		if hit.player:
			var pl = hit.player
			var how = pl.hurt(harm, pl.zone_at(from + dir * ht, 0.3)) # (about where its path crosses you)
			if how:
				_sound("hurt" if how == "hurt" else "down", null)
			if how == "hurt":
				emit("Flak! You're hit in %s!" % WHERE[pl.last_zone])
			if how == "down":
				emit("Flak! You're hit in %s! You're down!" % WHERE[pl.last_zone])
				find_helper({player = pl})
			if how == "dead":
				emit("You're hit again. You didn't make it.")
			if how and how != "hurt":
				men.erase(hit)
		else:
			var m = hit.m
			m.health -= harm
			if m.health <= 0:
				if m.patched: kill(m)
				else: wound(m)
				men.erase(hit)
			else:
				_sound("hurt", m)
	return holes

## Killed outright.
func kill(m) -> void:
	var was: String = m.state
	if was != "wounded":
		wound(m, true)
	m.state = "dead"
	emit("%s %s is dead." % [m.role.title, m.name])
	if visible:
		place(m)
	check_pilots()

## Going down: every man who can goes for the nearest hatch and out (some don't make it: hit, trapped).
func bail_out(hatches: Array, effects) -> void:
	bail_fx = effects
	for m in members:
		if m.state != "ok" or m.state == "player":
			continue
		if randf() < 0.2: # (trapped, too badly hurt to move, or held by the forces of her fall)
			continue
		var from: Vector3 = m.pos if m.pos != null else _v(m.spot.at)
		var best = hatches[0]
		var bd := INF
		for h in hatches:
			var d := absf(h.pos.z - from.z)
			if d < bd:
				bd = d; best = h
		m.pos = from; m.task = "bailing"; m.hatch = best
		if visible:
			m.path = walk_path(m.pos, best.pos)
		else:
			m.walk_t = rand(3, 12)

## Both pilots dead: in a bomber you're not in, the engineer (or the bombardier, or the navigator) takes the
## controls, as they did, and flies her on; with none of them left, or in yours (unless you take the
## controls), nobody flies her: she glides down out of the box.
func check_pilots() -> void:
	var gone := func(id: String) -> bool:
		var p = member(id)
		return p == null or p.state == "dead" or p.state == "bailed"
	if not gone.call("pilot") or not gone.call("copilot") or bomber.get("pilotless"):
		return
	if not visible and (relief == null or relief.state != "ok"):
		relief = null
		for id in ["engineer", "bombardier", "navigator"]:
			var x = member(id)
			if x and x.state == "ok":
				relief = x
				break
		if relief:
			emit("Both pilots are dead! %s %s is on the controls!" % [relief.role.title, relief.name])
	if visible or relief == null or relief.state != "ok":
		bomber.pilotless = true
		emit("Both pilots are dead! Somebody get on the controls!")

func wound(m, quiet := false) -> void:
	if not quiet:
		_sound("down", m)
	var walking: bool = m.task != "station" and m.pos != null # hit on his way somewhere: he falls where he is
	m.state = "wounded"
	m.wound_left = WOUND_TIME
	m.task = "down"
	m.pos = m.pos if walking else _v(m.spot.lie)
	if walking:
		m.spot = m.spot.merged({lie = _a(m.pos)}, true)
	if visible:
		place(m)
	emit("%s's hit!" % m.role.title)
	find_helper({member = m})
	if m == relief: # (the man flying her in the pilots' place)
		check_pilots()

## A fire in the fuselage burns whoever is in that section: the men at their posts there get hurt
## before long, and so do you if you stand in it more than a few seconds.
func burns(dt: float, player) -> void:
	var fire = bomber.get("sec_fire")
	if not fire or not fire.values().any(func(v): return v):
		burn_t = 0
		return
	for m in members:
		if m.state != "ok":
			continue
		var z = m.spot.at[2] if m.task == "station" else (m.pos.z if m.pos != null else null)
		if z != null and fire.get(section_at(z)) and randf() < dt * 0.04:
			wound(m)
			emit("%s's burnt!" % m.role.title)
	if player and not player.wounded and not player.dead and fire.get(section_at(player.feet.z)):
		burn_t += dt
		if burn_t > 4:
			burn_t = 0
			player.wound()
			emit("You're burnt! Get out of the fire!")
			find_helper({player = player})
	else:
		burn_t = maxf(0, burn_t - dt)

## The men you can see are solid: a box round each one standing or sitting about (not the ones lying
## on the floor: you can step over them), so you walk round the engineer instead of through him.
func solid(camera) -> void:
	# a slim box round each man's body as he's posed (hips to head: a man leaning out of his window
	# takes his body with him, and his crouched legs don't count), for Player to brush past
	if not interior:
		return
	var list: Array = interior.people
	var parent: Node3D = interior.group
	if list == null or not parent or not parent.is_inside_tree():
		return
	list.clear()
	var inv_p := parent.global_transform.affine_inverse()
	for m in members:
		var f = m.fig
		if not f or not f.visible or m.state == "wounded" or m.state == "dead":
			continue
		var j: Figure.Joints = f.j
		var hip := inv_p * j.hips.global_position
		var head := inv_p * j.head.global_position
		var cx := (hip.x + head.x) / 2
		var cz := (hip.z + head.z) / 2
		var lo := Vector3(cx - 0.13, minf(hip.y, head.y) - 0.1, cz - 0.13)
		var hi := Vector3(cx + 0.13, maxf(hip.y, head.y) + 0.28, cz + 0.13)
		var b := AABB(lo, hi - lo)
		m.box = b
		list.append(b)
		# squeezing past him: don't show the inside of his body; and right behind his head (it would
		# fill the screen) he isn't drawn either
		if f.model:
			var eye = (inv_p * camera.global_position) if camera else null
			var crowd: bool = camera != null and camera.get_meta("exiting", false) and eye != null and Vector2(eye.x - head.x, eye.z - head.z).length() < 0.9 # (going out of a hatch past the men crowding it: they're not drawn in your face)
			f.model.visible = not (eye != null and (crowd or _aabb_dist(b, eye) < 0.2 or Vector3(eye.x - head.x, eye.y - head.y - 0.08, eye.z - head.z).length() < 0.38)) # (his shoulders and arms are wider than the box)

## Send the nearest able man (not a pilot: someone has to fly) to give first aid.
func find_helper(patient: Dictionary) -> void:
	var where: Vector3 = patient.player.feet if patient.get("player") else patient.member.pos
	var free := members.filter(func(m): return m.state == "ok" and m.task == "station" and m.role.id != "pilot" and m.role.id != "copilot")
	if free.is_empty():
		return
	var helper = free[0]
	for m in free:
		if _v(m.spot.at).distance_to(where) < _v(helper.spot.at).distance_to(where):
			helper = m
	helper.task = "helping"
	helper.patient = patient
	helper.revive_t = 0.0
	if visible:
		helper.pos = _v(helper.spot.get("help", helper.spot.at))
		# (he kneels at the wounded man's side by his chest, not on top of him: a man lying stretches forward of his feet)
		var lying: bool = patient.get("member") != null and patient.member.spot.lie_pose == "lie"
		var at := where + Vector3(-0.36 if where.x > 0 else 0.36, 0, -0.75) if lying else where + Vector3(0.3, 0, 0)
		helper.path = walk_path(helper.pos, at)
	else:
		helper.walk_t = rand(4, 18) # time to get there and work, in a bomber we don't see

func update(dt: float, o: Dictionary) -> void:
	var player = o.get("player")
	var time: float = o.get("time", 0.0)
	frame += 1
	burns(dt, player)
	if visible:
		solid(player.camera if player else null)
		radio_work(dt, time)
		pilot_work(dt)
	for m in members:
		if m.state == "wounded":
			m.wound_left -= dt
			if m.wound_left <= 0:
				m.state = "dead"
				emit("%s %s is dead." % [m.role.title, m.name])
				if visible:
					place(m)
				check_pilots()
		if m.task == "bailing" and m.state == "ok": # making for his hatch, then out
			var out := func():
				m.state = "bailed"; m.task = "down"; check_pilots()
				if visible:
					place(m)
				if bail_fx:
					bail_fx.parachute(bomber.group.global_transform * (m.hatch.pos as Vector3))
			if not visible:
				m.walk_t -= dt
				if m.walk_t <= 0:
					out.call()
			elif not m.path.is_empty():
				walk(m, dt, time)
			else:
				out.call()
			continue
		if m.task == "helping":
			update_helper(m, dt, player, time)
		elif m.task == "returning":
			walk(m, dt, time, func():
				m.task = "station"
				place(m))
	# a helper can be hit, or nobody was free at the time: look again about once a second
	if recheck < 0:
		recheck = rand(0, 1)
	recheck -= dt
	if recheck <= 0:
		recheck = 1
		var helped := func(pat: Dictionary) -> bool:
			for h in members:
				if h.task == "helping" and h.patient and h.patient.get("member") == pat.get("member") and h.patient.get("player") == pat.get("player"):
					return true
			return false
		for m in members:
			if m.state == "wounded" and not helped.call({member = m}):
				find_helper({member = m})
		if player and player.wounded and not helped.call({player = player}):
			find_helper({player = player})

func update_helper(m, dt: float, player, time: float) -> void:
	var p: Dictionary = m.patient
	var done: bool = (not p.player.wounded) if p.get("player") else p.member.state != "wounded"
	if done:
		go_back(m)
		return
	if not visible:
		m.walk_t -= dt
		if m.walk_t <= 0:
			revive(p)
		return
	if not m.path.is_empty():
		walk(m, dt, time)
		return
	# at the patient: kneel and work on him, facing him
	pose(m.fig, "kneel")
	var w = p.member.pos if p.get("member") and p.member.spot.lie_pose == "lie" else null
	if w != null:
		m.fig.rotation.y = atan2(-(w.x - m.pos.x), -(w.z - 0.75 - m.pos.z))
	m.revive_t += dt
	if m.revive_t >= REVIVE_TIME:
		revive(p)

func revive(p: Dictionary, by_player := false) -> void:
	if visible:
		tally.saved += 1
	if by_player:
		tally.saved_by_you += 1
	if p.get("player"):
		p.player.revive()
		for m in members:
			if m.state == "player":
				m.patched = true
		emit("You're patched up, but another hit like that will finish you. Back to your post!")
	else:
		p.member.patched = true # (once: the next wound like that kills him)
		p.member.state = "ok"
		p.member.task = "station"
		p.member.wound_left = 0.0
		p.member.health = 0.6
		if visible:
			place(p.member)
		emit("%s's patched up and back on his gun." % p.member.role.title)

func go_back(m) -> void:
	m.patient = null
	if not visible:
		m.task = "station"
		return
	m.task = "returning"
	m.path = walk_path(m.pos, _v(m.spot.get("help", m.spot.at)))

## Move a figure along its path; `arrive` runs at the end.
func walk(m, dt: float, time: float, arrive = null) -> void:
	var step := WALK * dt
	while step > 0 and not m.path.is_empty():
		var next: Vector3 = m.path[0]
		var d: float = m.pos.distance_to(next)
		if d <= step:
			m.pos = next; m.path.pop_front(); step -= d
			continue
		var dir: Vector3 = (next - m.pos).normalized()
		m.pos += dir * step
		if absf(dir.x) + absf(dir.z) > 0.1:
			m.fig.rotation.y = atan2(-dir.x, -dir.z)
		step = 0
	m.fig.position = m.pos
	pose(m.fig, "crawl" if in_crawlway(m.pos) else ("crouch" if m.pos.z > 5.2 else "walk"), time)
	if m.path.is_empty() and arrive:
		arrive.call()

## Put a figure where his state says he should be.
func place(m) -> void:
	if not m.fig or m.on_tail: # (he went down with the tail: his figure rides the falling piece)
		return
	var s: Dictionary = m.spot
	# (you, or out of the plane; when you've walked away from your own post, a stand-in mans it)
	if (m.state == "player" and not m.stand_in) or m.state == "bailed":
		m.fig.visible = false
		return
	var down: bool = m.state == "wounded" or m.state == "dead"
	m.fig.position = _v(s.lie if down else s.at)
	m.fig.rotation.y = s.yaw + (0.3 if down and s.lie_pose == "lie" else 0.0) # (lying, turned only a little on his side: rolled further his outflung arm stood up in the air)
	pose(m.fig, s.lie_pose if down else s.pose)
	if not down:
		fit_under_roof(m.fig, interior, s.pose)
	m.fig.visible = not (m.displaced and not down) and not (false if down else s.pose == "hidden")
	var j: Figure.Joints = m.fig.j # the pose as placed: animate_gunner works on top of it
	m.fig.base = null if down else {hip = j.hips.position.y, sh_l = j.arm_l.sh.rotation.x, sh_r = j.arm_r.sh.rotation.x, head = j.head.rotation.x, torso = j.torso.rotation.x, pos = m.fig.position, yaw = m.fig.rotation.y}

## The player has taken (or left) this man's gun: he steps out of the way meanwhile. And your own
## post never stands empty: walk away from it (`feet` = where you are) and a man takes it over until
## you come back to it.
func set_displaced(station_id, feet = null) -> void:
	if station_id == "bombsight":
		station_id = "noseR" # the bombardier's gun is right by the sight
	for m in members:
		if m.state == "player":
			# (the bombardier's post is the whole nose: its four guns and the sight)
			var at_post: bool = feet != null and ((RegEx.create_from_string("^(nose|cheek)").search(str(station_id if station_id else "")) != null or feet.z < -9.2) if m.role.id == "bombardier" else (station_id == m.role.station if m.role.station else _v(m.spot.at).distance_to(feet) < 1.2))
			var stand_in: bool = feet != null and not at_post
			if stand_in != m.stand_in:
				m.stand_in = stand_in; m.task = "station"; place(m)
			continue
		var was: bool = m.displaced
		m.displaced = m.role.station == station_id and m.state == "ok" and m.task == "station"
		if was != m.displaced:
			place(m)

## A gunner you can see, at his gun: he turns with it (the top turret gunner all the way round with
## the turret, the others from the hips), his arms and head follow its elevation, hands on the grips,
## and he shakes with the recoil while it fires. gp = the gun position (yaw / pitch in bomber space).
func animate_gunner(station_id: String, gp, firing: bool) -> void:
	if not visible:
		return
	var m = null
	for x in members:
		if x.role.station == station_id:
			m = x
	var b = m.fig.base if m and m.fig else null
	if b == null or not m.fig.visible or m.task != "station" or not (m.state == "ok" or m.stand_in):
		return
	if STAND.has(station_id): # (posed from the gun: stand_to_gun)
		stand_to_gun(m, gp, firing)
		return
	if not m.has("t"):
		m.t = randf() * 20
	m.t += 1.0 / 60
	var fig: Figure.Fig = m.fig
	var j := fig.j
	var top := station_id == "top"
	var rel := _wrap(gp.yaw - m.spot.yaw)
	fig.rotation.y = b.yaw + rel * (1.0 if top else 0.6)
	var arms := 1.45 if top else 0.0
	var lift := clampf(gp.pitch, -0.8, 1.2) * 0.85
	j.arm_l.sh.rotation.x = (arms if arms else b.sh_l) + lift
	j.arm_r.sh.rotation.x = (arms if arms else b.sh_r) + lift
	if top: # his feet on the platform, stepping round as the turret turns him
		j.arm_l.el.rotation.x = 0.7; j.arm_r.el.rotation.x = 0.7
		var now := _now()
		var dt := minf(0.05, maxf(0, now - m.get("last_t", now)))
		m.last_t = now
		step_feet(m, b.pos.x, b.pos.z, fig.rotation.y, b.pos.y, TOP_STANCE, dt)
	j.head.rotation.x = b.head + clampf(gp.pitch, -0.6, 0.9) * 0.5
	if not m.has("grips"):
		m.grips = [Vector3(), Vector3()]
	m.grips = gp.grips_world(m.grips)
	Figure.reach_for(fig, m.grips) # both hands on the grips, wherever the gun points
	# he leans in to his grips: his shoulders (where they'd be standing straight) a forearm and a bit
	# short of them, so the arms are never stretched straight and the hands never fall short. He bends
	# at the waist first, and only steps in for the rest, his feet kept inside the hull.
	var rig := fig.rig
	var par := fig.get_parent() as Node3D
	if not m.has("lean"):
		m.lean = Vector3()
		m.bend = 0.0
	if rig and par:
		var pinv := par.global_transform.affine_inverse()
		var skg := rig.skel.global_transform
		var sh_l: Vector3 = pinv * Figure._bone_world(rig, skg, rig.arms.l.upper).origin - fig.position + b.pos
		var sh_r: Vector3 = pinv * Figure._bone_world(rig, skg, rig.arms.r.upper).origin - fig.position + b.pos
		var sh := (sh_l + sh_r) * 0.5
		var want: Vector3 = pinv * ((m.grips[0] + m.grips[1]) * 0.5) - sh
		var dh := Vector2(want.x, want.z).length()
		var ux := want.x / dh if dh else 0.0
		var uz := want.z / dh if dh else 0.0
		# each hand to its own grip, from where his shoulder would be standing straight (last frame's
		# bend undone: his shoulders had already come that far). He wants every hand within a comfortable
		# reach, elbow bent (FAR of his arm), and none so close the arm folds up into the gun (NEAR): he
		# leans or steps in for the far one, and steps back from a gun that's on top of him.
		var L: float = (rig.arms.l.a + rig.arms.l.b) * fig.global_transform.basis.get_scale().x + 0.075 # (the wrist stops a hand short)
		var fwd: float = sin(m.bend) * 0.5
		var go := 0.0
		var back := 0.0
		for sg in [[sh_l, m.grips[0]], [sh_r, m.grips[1]]]:
			var s: Vector3 = sg[0]
			var gl: Vector3 = pinv * (sg[1] as Vector3)
			var d := Vector3(gl.x - s.x + ux * fwd, gl.y - s.y, gl.z - s.z + uz * fwd).length()
			go = maxf(go, d - FAR * L); back = maxf(back, NEAR * L - d)
		if go <= 0:
			go = 0.0 if top else -minf(back, 0.2) # (in the turret he can't step back: the Sperry's grips are close to his chest)
		# (a waist gunner stands up to his gun: he steps in to it rather than stooping over it)
		var waist := station_id.begins_with("waist")
		var bend_go := clampf(go, 0, 0.15 if waist else 0.26)
		var bend := asin(bend_go / 0.5)
		var step := minf(go - bend_go, 0.45 if (station_id == "tail" or waist or station_id.begins_with("cheek")) else 0.3) # (the cheek guns are well forward of the navigator's table)
		# a waist gunner gets down to a low gun by bending his knees, feet flat on the floor
		var sink := clampf(-(want.y + 0.12) * 0.7, 0, 0.16) if waist else 0.0
		want = Vector3(ux * step, clampf((want.y + 0.1) * 0.5, -0.12 if station_id == "tail" else 0.0, 0.05), uz * step) # (up a little, on his toes at most; only the kneeling tail gunner sinks to his)
		var ms: float = m.get("sink", sink)
		m.sink = ms + (sink - ms) * (0.2 if m.get("lean_set", false) else 1.0)
		if waist:
			var H: float = b.hip - m.sink
			var a := acos(clampf(H / 0.92, 0, 1))
			j.hips.position.y = H
			for l in [j.leg_l, j.leg_r]:
				l.hip.rotation.x = a; l.knee.rotation.x = -2 * a
		var it = interior
		var fx: float = b.pos.x + want.x
		var fz: float = b.pos.z + want.z
		if it: # (knees and boots out in front of him: a good way in from the skin)
			var lim := maxf(absf(b.pos.x), it.hw(fz, b.pos.y + 0.4) - (0.34 if waist else 0.42))
			if absf(fx) > lim:
				want.x = signf(fx) * lim - b.pos.x
		var k := 0.2 if m.get("lean_set", false) else 1.0
		m.lean = (m.lean as Vector3).lerp(want, k); m.bend += (bend - m.bend) * k; m.lean_set = true
	var torso: float = b.torso - m.bend
	if firing: # the guns hammer him: each round's kick (12.5 a second, twice that from a twin mount) back through his shoulders
		var kick := pow(maxf(0, sin(m.t * (25.0 if gp.guns.size() > 1 else 12.5) * TAU)), 3)
		var back_v := Vector3(sin(gp.yaw), 0, cos(gp.yaw)) * (kick * 0.01)
		fig.position = b.pos + m.lean + back_v
		fig.position.y += rand(-1, 1) * 0.002
		j.torso.rotation.x = torso + kick * 0.03
		j.head.rotation.x += rand(-1, 1) * 0.02 * kick
	else: # breathing
		fig.position = b.pos + m.lean
		j.torso.rotation.x = torso + sin(m.t * 1.6) * 0.012
	# and his head stays inside: where the hull's low (the nose, the cheek windows) he stoops under it
	var room = interior
	if room and par and RegEx.create_from_string("^(nose|cheek)").search(station_id): # (only in the nose, under its low glass: elsewhere it pulled men down through the floor)
		var h: Vector3 = par.global_transform.affine_inverse() * j.head.global_position
		var over: float = h.y + 0.24 - room.roof_at(h.z, h.x, b.pos.y + 0.4)
		m.duck = clampf(m.get("duck", 0.0) + (over * 0.5 if over > 0 else -0.01), 0, 0.35) # (eased, and never more than a stoop)
		if m.duck > 0:
			fig.position.y -= m.duck

## A man standing to a flexible gun (the waist guns, the radio room's): posed from the gun itself, as men
## stood to them in the photos. His eye goes on the sight line behind the ring sight, wherever the gun
## points; his body turns with the gun; he leans into a low gun from the hips (back under the radio
## room's, his head tipped back to its sight), and bends his knees for the rest of the height, his feet
## planted on the floor in a braced stance, one ahead of the other, stepping round as the gun swings
## far enough to leave a foot behind. Hands on the spade grips. Between bursts he breathes, shifts his
## weight and looks round the sky; firing, the gun's hammering at 750 a minute shakes through his
## shoulders and head.
func stand_to_gun(m, gp, firing: bool) -> void:
	var fig: Figure.Fig = m.fig
	var rig := fig.rig
	var par := fig.get_parent() as Node3D
	var j := fig.j
	var st: Dictionary = gp.station
	var cfg: Dictionary = STAND[st.id]
	if not rig or not rig.dims or not par:
		return
	var now := _now()
	var dt := minf(0.05, maxf(0, now - m.get("last_t", now)))
	m.last_t = now
	m.t = m.get("t", randf() * 20) + dt
	var sc := fig.scale.x
	var Dm := rig.dims
	var floor_y: float = st.stand.y
	var t: float = m.t
	# the sight line: the gun's direction and its "up", and the eye a hand behind the ring
	var cp := cos(gp.pitch)
	var sp := sin(gp.pitch)
	var sy := sin(gp.yaw)
	var cy := cos(gp.yaw)
	var fwd := Vector3(-sy * cp, sp, -cy * cp)
	var up := Vector3(sy * sp, cp, cy * sp)
	var pinv := par.global_transform.affine_inverse()
	var pv: Vector3 = pinv * (gp.pivot as Node3D).global_position
	var E: Vector3 = pv - fwd * st.eye_behind + up * st.get("eye_up", 0.22)
	# firing: each round's kick (12.5 a second), sharp and dying away
	var kick := pow(maxf(0, sin(t * 12.5 * TAU)), 3) if firing else 0.0
	m.fire = lerpf(m.get("fire", 0.0), 1.0 if firing else 0.0, 1 - exp(-dt * 6))
	# his body turns with the gun (a moment behind it)
	var by0: float = m.get("body_yaw", gp.yaw)
	m.body_yaw = by0 + _wrap(gp.yaw - by0) * (1 - exp(-dt * 7))
	var by: float = m.body_yaw
	var F := Vector3(-sin(by), 0, -cos(by))
	var R := Vector3(cos(by), 0, -sin(by))
	# leaning into it: more over a gun aimed down, less as it comes up; breathing; the kick rocks him back
	var lean: float = cfg.lean - gp.pitch * cfg.pitch_lean + sin(t * 1.6) * 0.012 - kick * 0.035
	# his head: on the sight between looks round the sky (not while he's firing)
	m.look_t = m.get("look_t", rand(2, 5)) - dt
	if m.look_t <= 0:
		m.look_t = rand(1.5, 4.5)
		m.look = [0.0, 0.0] if randf() < 0.45 else [rand(-0.7, 0.7), rand(-0.15, 0.35)]
	var lk: Array = [0.0, 0.0] if firing else m.get("look", [0.0, 0.0])
	var kl := 1 - exp(-dt * (9.0 if firing else 3.0))
	m.head_y = m.get("head_y", 0.0) + (lk[0] - m.get("head_y", 0.0)) * kl
	m.head_p = m.get("head_p", 0.0) + (lk[1] - m.get("head_p", 0.0)) * kl
	var aim_p := clampf(gp.pitch + m.head_p, -0.75, 1.05)
	var head_rel := clampf(aim_p + lean, -0.6, 1.0)
	# where his eye is from his hips, in his own frame (y up, -z ahead): the spine leaning, the head pitched
	var S: float = Dm.spine * sc
	var a := head_rel - lean
	var ey: float = Dm.eye.y * sc
	var ez: float = -Dm.eye.z * sc
	var eye_up := S * cos(lean) + ey * cos(a) + ez * sin(a)
	var eye_ahead := S * sin(lean) + ez * cos(a) - ey * sin(a)
	# (corrected by what last frame's pose actually put where: the skeleton isn't quite this simple)
	if not m.has("corr"):
		m.corr = Vector3()
	var corr: Vector3 = m.corr
	var hip := clampf(E.y - floor_y - eye_up + corr.y, Dm.hip * sc * cfg.crouch, Dm.hip * sc * 0.97)
	hip += sin(t * 0.9) * 0.006 - kick * 0.008
	var sway: float = sin(t * 0.45) * 0.018 * (1 - m.fire) # (shifting his weight foot to foot)
	var hx: float = E.x - F.x * eye_ahead + R.x * sway + corr.x - fwd.x * kick * 0.012
	var hz: float = E.z - F.z * eye_ahead + R.z * sway + corr.z - fwd.z * kick * 0.012
	fig.position = Vector3(hx, floor_y, hz)
	fig.rotation = Vector3(0, by, 0)
	j.hips.position.y = hip / sc - rig.pelvis_at.y
	j.torso.rotation = Vector3(-lean, cfg.twist + kick * 0.02 * (randf() - 0.5), 0)
	j.head.rotation = Vector3(head_rel + (randf() - 0.5) * kick * 0.04, m.head_y, 0)
	# his hands on the grips
	if not m.has("grips"):
		m.grips = [Vector3(), Vector3()]
	m.grips = gp.grips_world(m.grips)
	Figure.reach_for(fig, m.grips)
	rig.grip = 1
	step_feet(m, hx, hz, by, floor_y, cfg, dt)
	# and where his eye really went last frame (the skeleton's head, the eye in front of it), for the correction
	if m.get("posed", false):
		var h := Figure._bone_world(rig, rig.skel.global_transform, rig.bones.Head).origin
		h += Figure._qrot(j.head.global_transform.basis) * (Dm.eye * sc * par.global_transform.basis.get_scale().x)
		h = pinv * h
		var err: Vector3 = m.get("last_e", E) - h
		corr = (corr + err * 0.25).limit_length(0.25)
		m.corr = corr
	m.last_e = E
	m.posed = true

## His feet, planted on the floor (figure.gd plant_feet): in a stance round (hx, hz) facing yaw `by` (cfg:
## stride, one foot ahead of the other, and width), toes a little out; each stays put till the body has
## moved or turned far enough to leave it behind, then steps, one foot at a time.
func step_feet(m, hx: float, hz: float, by: float, floor_y: float, cfg: Dictionary, dt: float) -> void:
	var par := m.fig.get_parent() as Node3D
	var F := Vector3(-sin(by), 0, -cos(by))
	var R := Vector3(cos(by), 0, -sin(by))
	if not m.has("feet"):
		m.feet = [{p = Vector3(), yaw = by, step = null, set = false, out = null}, {p = Vector3(), yaw = by, step = null, set = false, out = null}]
	for i in 2:
		var ft: Dictionary = m.feet[i]
		var s := 1.0 if i else -1.0
		var ahead: float = (-1.0 if i else 1.0) * cfg.stride * 0.5
		var want: Vector3 = Vector3(hx, floor_y, hz) + R * (s * cfg.width) + F * ahead
		var it = interior
		var lim: float = it.hw(want.z, floor_y + 0.1) - 0.13 if it else 9.0
		if is_finite(lim) and lim > 0.1 and absf(want.x) > lim:
			want.x = signf(want.x) * lim
		var want_yaw := by + s * -0.22
		if not ft.set:
			ft.p = want; ft.yaw = want_yaw; ft.set = true
		var other: Dictionary = m.feet[1 - i]
		if ft.step == null and other.step == null and ((ft.p as Vector3).distance_to(want) > 0.15 or absf(_wrap(want_yaw - ft.yaw)) > 0.5):
			ft.step = {from = ft.p, yaw0 = ft.yaw, u = 0.0}
		var lift := 0.0
		if ft.step != null:
			ft.step.u = minf(1, ft.step.u + dt / 0.28)
			var k: float = ft.step.u
			var e := k * k * (3 - 2 * k)
			ft.p = (ft.step.from as Vector3).lerp(want, e)
			ft.yaw = ft.step.yaw0 + _wrap(want_yaw - ft.step.yaw0) * e
			lift = sin(k * PI) * 0.06
			if k >= 1:
				ft.step = null
		var at: Vector3 = ft.p
		at.y += lift
		ft.out = {at = par.global_transform * at, q = Figure._qrot(par.global_transform.basis) * Quaternion(Vector3.UP, ft.yaw)}
	Figure.plant_feet(m.fig, [m.feet[0].out, m.feet[1].out])

## The pilots fly her: both hands on the wheel (the pilot's right on the throttles), and now and then
## a look round, out of his side window, across the other way, up at the formation, then ahead again.
func pilot_work(dt: float) -> void:
	var it: Node3D = interior.group if interior else null
	if not it:
		return
	for id in ["pilot", "copilot"]:
		var m = member(id)
		var f: Figure.Fig = m.fig if m else null
		var b = f.base if f else null
		if b == null or not f.visible or m.task != "station" or not (m.state == "ok" or m.stand_in):
			continue
		var s := -1.0 if id == "pilot" else 1.0
		var x := s * 0.55
		var W: Dictionary = CockpitB17.WHEEL
		var wheel := [Vector3(x - W.r, W.hub_y + 0.045, W.z + 0.006), Vector3(x + W.r, W.hub_y + 0.045, W.z + 0.006)] # (on the grips: cockpitb17.gd)
		if id == "pilot":
			wheel[1] = Vector3(-0.07, 0.115, -8.06) # (his right hand on the throttles' bar)
		for i in 2:
			wheel[i] = it.global_transform * (wheel[i] as Vector3)
		m.wheel = wheel
		Figure.reach_for(f, wheel)
		# he sits forward to the wheel (and the pilot over to his throttles) until the farther hand is in
		# easy reach, his back off the seat, rather than his arm stretched out short of it
		var rig := f.rig
		if rig:
			var skg := rig.skel.global_transform
			var L: float = (rig.arms.l.a + rig.arms.l.b) * f.global_transform.basis.get_scale().x + 0.075
			var d := maxf(Figure._bone_world(rig, skg, rig.arms.l.upper).origin.distance_to(wheel[0]), Figure._bone_world(rig, skg, rig.arms.r.upper).origin.distance_to(wheel[1]))
			m.sit_lean = clampf(m.get("sit_lean", 0.0) + (d - FAR * L) * 0.6, 0, 0.5)
			f.j.torso.rotation.x = b.torso - m.sit_lean
		m.look_t = m.get("look_t", rand(1, 4)) - dt
		if m.look_t <= 0:
			m.look_t = rand(2.5, 7)
			var r := randf()
			m.look_at = [0.0, 0.0] if r < 0.4 else ([-s * rand(0.6, 1.2), rand(-0.1, 0.15)] if r < 0.75 else ([s * rand(0.3, 0.6), 0.0] if r < 0.9 else [-s * rand(0.1, 0.4), rand(0.25, 0.45)]))
		var la: Array = m.get("look_at", [0.0, 0.0])
		var k := 1 - exp(-dt * 2.5)
		m.head_y = m.get("head_y", 0.0) + (la[0] - m.get("head_y", 0.0)) * k
		m.head_p = m.get("head_p", 0.0) + (la[1] - m.get("head_p", 0.0)) * k
		f.j.head.rotation.y = m.head_y
		f.j.head.rotation.x = b.head + m.head_p + m.get("sit_lean", 0.0) # (eyes kept ahead as he sits forward)

## The radio operator at his desk is never still: he tunes the receiver, taps out on the Morse key,
## writes up his log, holds an earphone to his ear to hear through the noise, and now and then looks
## up through the hatch overhead. Each a few seconds, his hands easing from one to the next.
func radio_work(dt: float, time: float) -> void:
	var m = member("radio")
	var f: Figure.Fig = m.fig if m else null
	var b = f.base if f else null
	if b == null or not f.visible or m.task != "station" or not (m.state == "ok" or m.stand_in) or not interior:
		return
	if m.role.station: # (he's at his gun under the roof hatch, not his desk)
		return
	m.job_t = m.get("job_t", 0.0) - dt
	if m.job_t <= 0:
		var jobs := ["tune", "key", "write", "listen", "tune", "write", "look"].filter(func(jb): return jb != m.get("job"))
		m.job = jobs[randi() % jobs.size()]
		m.job_t = rand(2.5, 5.5)
	var j := f.j
	var it: Node3D = interior.group
	var job: String = m.job
	# (desk-top height: his hands rest on it between jobs)
	var L := Vector3(-0.8, -1.03, -1.92)
	var R := Vector3(-0.56, -1.03, -1.9)
	var lean := 0.25
	var head := 0.35
	var turn := 0.0
	if job == "tune":
		R = Vector3(-0.6, -0.953 + sin(time * 1.3) * 0.004, -2.12 + sin(time * 0.7) * 0.02); lean = 0.6; head = 0.15; turn = -0.15
	elif job == "key":
		R = Vector3(-0.47, -1.0 + maxf(0, sin(time * 19) * sin(time * 2.3)) * 0.012, -2.095); lean = 0.55; head = 0.25
	elif job == "write":
		R = Vector3(-0.6 + sin(time * 6) * 0.015, -1.035, -1.94 + sin(time * 0.9) * 0.04); L = Vector3(-0.7, -1.035, -1.86); lean = 0.45; head = 0.55; turn = 0.1
	elif job == "listen":
		L = it.global_transform.affine_inverse() * j.head.global_position + Vector3(-0.11, 0.08, 0.02)
		head = 0.15; lean = 0.15; turn = 0.15
	elif job == "look":
		head = -0.6; lean = 0.05; turn = 0.3
	var k := 1 - exp(-dt * 4)
	m.hand_l = (m.get("hand_l", L) as Vector3).lerp(L, k); m.hand_r = (m.get("hand_r", R) as Vector3).lerp(R, k)
	m.work_lean = m.get("work_lean", lean) + (lean - m.get("work_lean", lean)) * k
	j.torso.rotation.x = b.torso - m.work_lean # (negative leans him forward)
	m.head_x = m.get("head_x", head) + (head - m.get("head_x", head)) * k
	j.head.rotation.x = -m.head_x + m.work_lean * 0.6 # (head_x > 0 looks down)
	m.head_y = m.get("head_y", turn) + (turn - m.get("head_y", turn)) * k
	j.head.rotation.y = m.head_y
	Figure.reach_for(f, [it.global_transform * (m.hand_l as Vector3), it.global_transform * (m.hand_r as Vector3)])
	f.rig.grip = 0.8 if job == "write" else (0.6 if job == "tune" else 0.35)

## The player has moved to `other`'s bomber: hand over the visible figures (and the interior).
func hand_figures_to(other) -> void:
	for i in members.size():
		var m = members[i]
		if m.fig and m.fig.get_parent() != interior.group: # (a figure that went down with the tail comes back aboard: it's now another man)
			if m.fig.get_parent():
				m.fig.get_parent().remove_child(m.fig)
			interior.group.add_child(m.fig)
		other.members[i].fig = m.fig
		m.fig = null
	other.visible = true; other.interior = interior
	visible = false; interior = null
	for m in members: # the crew left behind carries on unseen
		if m.task == "helping":
			m.walk_t = rand(4, 12)
		if m.task == "bailing":
			m.walk_t = rand(2, 8) # (his walk to the hatch, unseen)
		if m.task == "returning":
			m.task = "station"
	for m in other.members: # the crew we join: at their posts, or where they fell
		if m.task == "helping" or m.task == "returning":
			m.task = "station"; m.patient = null
		if m.task == "bailing" and m.state == "ok":
			m.path = walk_path(m.pos, m.hatch.pos) # (on his way out: seen walking there now)
		if m.state == "wounded" or m.state == "dead":
			m.task = "down"; m.pos = _v(m.spot.lie)
		other.place(m)
	# then send helpers (in a second pass, so resetting a later man can't cancel one just sent)
	for m in other.members:
		if m.state == "wounded":
			other.find_helper({member = m})

## The player takes this man's place (a living AI crewman).
func become_player(m) -> void:
	m.state = "player"
	m.stand_in = false
	m.task = "station"
	place(m)

## The player died: become another living man of this crew (gunners first). Returns him or null.
func take_over(player):
	var me = null
	for m in members:
		if m.state == "player":
			me = m
			break
	var next = null
	for id in ["tail", "waistL", "waistR", "ball", "engineer", "navigator", "bombardier", "copilot", "pilot"]:
		var x = member(id)
		if x.state == "ok":
			next = x
			break
	if next == null:
		return null
	if me:
		me.state = "dead"
		me.stand_in = false
		me.spot = me.spot.merged({lie = _a(player.feet), lie_pose = "lie"}, true) # he lies where you fell
		place(me)
	next.state = "player"
	next.stand_in = false
	next.task = "station"
	place(next)
	return next

# ---------- gunnery ----------
## Aim for an AI gunner at `station`: picks a fighter in his arc, leads it, fires in bursts.
## Returns {dir (bomber space), yaw_rel, fire, aim_point (world), origin} or null when there's nothing to shoot.
func aim(station: Dictionary, fighters, dt: float):
	if not gunners.has(station.id):
		gunners[station.id] = {target = null, retarget = 0.0, burst = 0.0, pause = rand(0, 1), err = Vector3(), lead = 1.0, clear = null, timer = 0.0, n = 0}
	var g: Dictionary = gunners[station.id]
	var bm: Transform3D = bomber.group.global_transform
	if not station.has("local"):
		station.local = _v(station.pivot) if station.get("pivot") != null else _v(station.eye)
	var local: Vector3 = station.local
	var origin := bm * local
	if inv_at != frame: # once a frame
		inv_at = frame
		inv = bm.affine_inverse()
	var in_arc := func(f) -> bool:
		var d: Vector3 = (inv * (f.pos as Vector3) - local).normalized()
		var yaw := atan2(-d.x, -d.z)
		var pitch := asin(clampf(d.y, -1, 1))
		return absf(_wrap(yaw - station.yaw)) <= station.yaw_lim and pitch >= station.pitch[0] and pitch <= station.pitch[1]
	g.retarget -= dt
	if g.retarget <= 0 or not (g.target and g.target.alive) or not in_arc.call(g.target) or (g.target.pos as Vector3).distance_to(origin) > GUN_RANGE:
		g.retarget = rand(1, 2)
		var best = null
		var score := INF
		for f in fighters.list:
			if not f.alive or f.side != "axis":
				continue
			var d: float = (f.pos as Vector3).distance_to(origin)
			if d > GUN_RANGE or not in_arc.call(f):
				continue
			var s := d * (0.5 if f.target == bomber and f.state == "attack" else 1.0) # the one coming at us first
			if s < score:
				score = s; best = f
		# a new target takes him a moment: spotting it, swinging the guns round, getting it in the sight
		if best and best != g.target:
			g.pause = maxf(g.pause, rand(ACQUIRE[0], ACQUIRE[1]))
		g.target = best
	if not g.target:
		return null
	var f = g.target
	var dist: float = (f.pos as Vector3).distance_to(origin)
	var vel: Vector3 = f.velocity
	# how fast it crosses his line of sight: the hard deflection shots are where gunners missed most
	var los: Vector3 = ((f.pos as Vector3) - origin).normalized()
	var crossing := (vel - los * vel.dot(los)).length()
	# a human lead, judged by eye (each burst a bit under or over), plus an aiming error that grows with
	# range and crossing speed and shrinks as he walks his tracers onto the target
	var aim_point: Vector3 = f.pos + vel * ((dist / 850.0) * g.lead) + g.err
	if g.pause > 0:
		g.pause -= dt
		if g.pause <= 0:
			g.burst = rand(BURST[0], BURST[1])
			g.lead = rand(0.45, 1.25)
			var spray := 4.0 if randf() < SPRAY else 1.0 # a nervous burst at nothing much
			g.err = Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)) * (dist * AIM_ERROR * (1 + crossing / 90.0) * spray)
			# friendly fire is real: a gunner holds his burst if another B-17 is in the line of fire
			g.clear = line_clear(origin, aim_point, fighters.near_bombers())
	else:
		g.err *= exp(-dt * 0.6) # walking the tracers in
		g.burst -= dt
		if g.burst <= 0:
			g.pause = rand(PAUSE[0], PAUSE[1])
	var dir := (inv * aim_point - local).normalized()
	var yaw_rel := _wrap(atan2(-dir.x, -dir.z) - station.yaw)
	return {dir = dir, yaw_rel = yaw_rel, fire = g.pause <= 0 and dist < FIRE_RANGE and g.clear != false, aim_point = aim_point, origin = origin}

## No other bomber within 30 m of the line from `from` to `to`?
func line_clear(from: Vector3, to: Vector3, bombers: Array) -> bool:
	var ab := to - from
	var len2 := ab.length_squared()
	if len2 == 0:
		len2 = 1
	for b in bombers:
		if b == bomber or b.get("gone"):
			continue
		var bp: Vector3 = b.group.position
		var t := clampf((bp - from).dot(ab) / len2, 0, 1)
		if (from + ab * t).distance_squared_to(bp) < 900:
			return false
	return true

## AI gunners of a bomber we don't see from inside: fire straight from their positions.
func fire_unseen(stations: Array, fighters, bullets, audio, player_pos: Vector3, dt: float) -> void:
	var shown: bool = bomber.model != null and not bomber.down # (near enough to have a model: its turrets turn as they aim)
	turret_t += dt
	if bomber.down or not bomber.guns_active or (bomber.group.position as Vector3).distance_to(player_pos) > ACTIVE_RANGE:
		if shown:
			for id in ["ball", "top"]:
				bomber.aim_turret(id, null, dt, turret_t)
		return
	for s in stations:
		if not s.get("guns") or not manned(s.id):
			continue
		var a = aim(s, fighters, dt)
		if shown and (s.id == "ball" or s.id == "top"):
			bomber.aim_turret(s.id, a.dir if a else null, dt, turret_t)
		var g: Dictionary = gunners[s.id]
		if not a or not a.fire:
			g.timer = 0.0
			continue
		g.timer -= dt
		while g.timer <= 0:
			g.timer += 60.0 / AI_RPM # one simulated stream per position, even for twin guns, to save work
			var d: Vector3 = (a.aim_point - a.origin).normalized()
			d += Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)) * AI_SPREAD
			g.n += 1
			bullets.spawn(a.origin + d * 1.5, d.normalized() * 890, g.n % 5 == 0, "allied", "crew", false, bomber, 1.4)
		if randf() < dt * 6:
			audio.distant_gun(a.origin.distance_to(player_pos))
