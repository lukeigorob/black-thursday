extends RefCounted
# A B-17 in the formation: the model, spinning props, the gentle rocking of a heavy bomber,
# and battle damage, part by part: each engine, the inner wings (with their fuel tanks) and the outer
# wings either side, the tail, the turrets, and the fuselage section by section. Each part fails in
# its own way: engines smoke, burn or stop; wings leak fuel, burn and break off; a shot-up tail makes
# her sloppy to fly, then goes; fires in the fuselage grow until she breaks up.
# Everything inside (interior, player) is a child of `group`, so it moves and rocks with the plane.
# (The bombers sit in the scene's root: `group.transform` is their world transform, Three's matrixWorld, and
# a far one drawn by the Fleet has a group that's in no tree at all.)

const Markings := preload("res://src/markings.gd")
const Self := preload("res://src/bomber.gd")

const AIRSPEED := 75.0 # m/s: 270 km/h (~170 mph), a loaded B-17's cruise at altitude
static var FORMATION := {bank = 0.0} # (the whole formation banked in a turn: rad, + right wing down; main.js)
const MAX_BANK := 0.6 # rad (~35 degrees): a loaded B-17 turns gently
const SPEED_PER_POWER := 40.0 # m/s more (or less) than the formation's speed per unit of power above (below) cruise

static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)
static func wrap_a(a: float) -> float:
	return atan2(sin(a), cos(a))

## Turn a prop's blades about their own length: 0 = in flight pitch, 1 = feathered, edge-on.
static func _feather_blades(prop: Node3D, k: float) -> void:
	prop.set_meta("shown", k)
	if not prop.has_meta("blades"):
		var list := []
		for b in prop.get_children():
			if not (b is MeshInstance3D):
				continue
			# (out along the blade from the hub: where the blade sits on the hub, or else the middle of its shape)
			var axis := Vector3(b.position.x, b.position.y, 0)
			if axis.length() < 0.05:
				var c: Vector3 = b.get_aabb().get_center()
				axis = Vector3(c.x, c.y, 0)
			list.append({b = b, axis = axis.normalized() if axis.length() > 1e-6 else Vector3.RIGHT, q0 = b.quaternion})
		prop.set_meta("blades", list)
	for e in prop.get_meta("blades"):
		e.b.quaternion = e.q0 * Quaternion(e.axis, k * 1.2)

# A running prop as the eye sees it: a faint disc, the three blades smeared into ghosts, the yellow tips a
# ring. (Drawn crisp each frame, real blades only ever looked frozen.) One texture and material for all.
static var _blur_mat: StandardMaterial3D = null
static func _blur_material() -> StandardMaterial3D:
	if _blur_mat:
		return _blur_mat
	var S := 256
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var dx := (x + 0.5) / S * 2.0 - 1.0
			var dy := (y + 0.5) / S * 2.0 - 1.0
			var r := sqrt(dx * dx + dy * dy)
			if r > 1.0 or r < 0.13:
				continue
			var ghost := pow(pow(cos(atan2(dy, dx) * 1.5), 2.0), 6.0) # (three blades, each trailing a smear)
			var tip := r > 0.9
			var a := (0.08 + 0.42 * ghost) * minf(1.0, (1.0 - r) * 30.0) * ((r - 0.13) / 0.12 if r < 0.25 else 1.0)
			img.set_pixel(x, y, Color8(200, 160, 50, int(255 * a * 0.7)) if tip else Color8(24, 24, 22, int(255 * a)))
	img.generate_mipmaps()
	# (lit like the rest of her: dark by night, not glowing)
	var m := StandardMaterial3D.new()
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 1.0
	m.render_priority = 2
	_blur_mat = m
	return m

## The disc's place on its prop: the blades' radius and how far along the shaft they sit (measured once).
static func _disc_of(prop: Node3D) -> Dictionary:
	if prop.has_meta("disc_at"):
		return prop.get_meta("disc_at")
	var box := AABB()
	var first := true
	for m in prop.get_children():
		if m is MeshInstance3D:
			var b: AABB = m.transform * m.get_aabb()
			box = b if first else box.merge(b)
			first = false
	var mn := box.position
	var mx := box.end
	var d := {R = maxf(maxf(-mn.x, mx.x), maxf(-mn.y, mx.y)), z = (mn.z + mx.z) / 2.0}
	prop.set_meta("disc_at", d)
	return d

## A circle of radius 1 in the XY plane facing +Z (Three's CircleGeometry), uv across it.
static func circle_mesh(segments: int) -> ArrayMesh:
	var v := PackedVector3Array([Vector3.ZERO])
	var n := PackedVector3Array([Vector3.BACK])
	var uv := PackedVector2Array([Vector2(0.5, 0.5)])
	var idx := PackedInt32Array()
	for i in segments + 1:
		var a := TAU * i / segments
		v.append(Vector3(cos(a), sin(a), 0))
		n.append(Vector3.BACK)
		uv.append(Vector2((cos(a) + 1) / 2, 1.0 - (sin(a) + 1) / 2))
	for i in range(1, segments + 1):
		idx.append_array([0, i + 1, i]) # (Godot's front faces wind clockwise)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = v; arrays[Mesh.ARRAY_NORMAL] = n; arrays[Mesh.ARRAY_TEX_UV] = uv; arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m

## Every running prop of every bomber as its blur disc: one multimesh, one draw call for the lot (each
## prop's blades, which it replaces, were a draw call of their own). The bombers with a model of their own
## place it on their props; the far ones the Fleet draws, on where the low-detail model's props are (lod).
## update() after the bombers have moved and their transforms are fresh (main.js, after the contrails).
class PropBlur:
	var bombers: Array
	var far: Array
	var mesh: MultiMeshInstance3D
	var mm: MultiMesh
	var _buf := PackedFloat32Array()

	func _init(scene: Node, bombers_: Array, lod: Node3D) -> void:
		bombers = bombers_
		far = [] # (each prop's place in the model, and its disc)
		for i in [1, 2, 3, 4]:
			var p = lod.find_child("Prop_%d" % i, true, false)
			far.append({local = Self._rel(p, lod), d = Self._disc_of(Self._blade_holder(p))} if p else null)
		mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = Self.circle_mesh(40)
		mm.instance_count = bombers.size() * 4
		mm.visible_instance_count = 0
		mesh = MultiMeshInstance3D.new()
		mesh.multimesh = mm
		mesh.material_override = Self._blur_material()
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
		scene.add_child(mesh)
		_buf.resize(mm.instance_count * 12)

	func update() -> void:
		var k := 0
		for b in bombers:
			if b.gone or not b.group.visible or (not b.model and b.wreck_body):
				continue
			var gt: Transform3D = b.group.transform
			for i in 4:
				var sp: Dictionary = b.spin[i]
				var p = b.props[i] if i < b.props.size() else null
				var f = far[i] if not b.model else null
				if not sp.blur or not (p.visible if p else f != null): # (a prop gone with a broken-off wing: breakup.js)
					continue
				var d: Dictionary = Self._disc_of(Self._blade_holder(p)) if p else f.d
				var dm := Transform3D(Basis(Vector3.BACK, sp.a).scaled(Vector3(d.R, d.R, d.R)), Vector3(0, 0, d.z))
				var t: Transform3D = (gt * Self._rel(p, b.group) * dm) if p else (gt * f.local * dm)
				var o := k * 12
				_buf[o] = t.basis.x.x; _buf[o + 1] = t.basis.y.x; _buf[o + 2] = t.basis.z.x; _buf[o + 3] = t.origin.x
				_buf[o + 4] = t.basis.x.y; _buf[o + 5] = t.basis.y.y; _buf[o + 6] = t.basis.z.y; _buf[o + 7] = t.origin.y
				_buf[o + 8] = t.basis.x.z; _buf[o + 9] = t.basis.y.z; _buf[o + 10] = t.basis.z.z; _buf[o + 11] = t.origin.z
				k += 1
		mm.buffer = _buf
		mm.visible_instance_count = k

## The node holding a prop's blades: the prop itself, or (merged, in the mid and low models) its one child.
static func _blade_holder(p: Node3D) -> Node3D:
	return p

static func _rel(node: Node, root: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var x := node
	while x and x != root:
		if x is Node3D:
			t = x.transform * t
		x = x.get_parent()
	return t

## Wrap a model's ball and top turrets in pivots (once per model): the ball and its guns turn and tilt
## about the ball's centre, its yoke and the top turret (with its guns) turn about their own axes.
static func _rig_turrets(model: Node3D) -> Dictionary:
	var out := {}
	var find := func(n: String) -> Node3D: return model.find_child(n, true, false) as Node3D
	var wrap := func(names: Array, at: Vector3) -> Node3D:
		var p := Node3D.new()
		p.position = at
		model.add_child(p)
		for n in names:
			var o: Node3D = find.call(n)
			if o:
				var t := _rel(o, model)
				o.get_parent().remove_child(o)
				p.add_child(o)
				o.transform = p.transform.affine_inverse() * t
		return p
	var rest_of := func(names: Array, at: Vector3) -> Vector3: # which way the guns point at rest, from their middle
		var first: Node3D = find.call(names[0])
		if first and first.has_meta("guns"): # (a merged turret knows where its guns are)
			return (first.get_meta("guns") - at).normalized()
		var b := AABB()
		var empty := true
		for n in names.slice(1):
			var o: Node3D = find.call(n)
			if not o:
				continue
			for m in ([o] if o is MeshInstance3D else []) + o.find_children("*", "MeshInstance3D", true, false):
				var box: AABB = _rel(m, model) * m.get_aabb()
				b = box if empty else b.merge(box)
				empty = false
		if empty:
			return Vector3(0, -1, -0.01).normalized()
		return (b.get_center() - at).normalized()
	var ball := Vector3(0, -2.3, -0.13)
	var ball_guns := ["GunBarrel_004", "GunBarrel14"]
	if find.call("BallTurret"):
		var d: Vector3 = rest_of.call(["BallTurret"] + ball_guns, ball)
		var yaw0 := atan2(-d.x, -d.z)
		var pitch0 := asin(clampf(d.y, -1, 1))
		var full: Node3D = wrap.call(["BallTurret"] + ball_guns, ball)
		var yaw_part: Node3D = wrap.call(["BallStabilizer1"], ball)
		out.ball = {full = full, yaw_part = yaw_part, yaw0 = yaw0, pitch0 = pitch0, yaw = yaw0, pitch = pitch0, elev = Vector3(cos(yaw0), 0, -sin(yaw0))}
	var top := Vector3(0, 1.43, -6.71)
	if find.call("TopTurret"):
		var d: Vector3 = rest_of.call(["TopTurret", "TopGuns"], top)
		var yaw0 := atan2(-d.x, -d.z)
		out.top = {yaw_part = wrap.call(["TopTurret", "TopGuns"], top), full = null, yaw0 = yaw0, pitch0 = 0.0, yaw = yaw0, pitch = 0.0, elev = Vector3(1, 0, 0)}
	return out

const ENGINE_X := [-7.16, -3.93, 3.94, 7.15] # engines 1-4, numbered left to right as the pilot sees them
const SECTIONS := [["nose", -11.4, -8.6], ["cockpit", -8.6, -6.35], ["bombbay", -6.35, -2.6], ["radio", -2.6, -1.25], ["waist", -1.25, 5.2], ["tail", 5.2, 11.4]]

# Hit boxes in bomber space [x0, x1, y0, y1, z0, z1] (nose -Z), measured from the model: each part is a
# few boxes following its shape (`boxes`: what a round must pass through to hit it), `box` the lot's bounds.
# The fuselage, station by station [z, half-width, bottom, top]: round the nose, widest at the wing, the
# spine falling away aft and the tail cone narrowing to the tail gun
const HULL := [[-11.6, 0.55, -0.8, 0.5], [-10.6, 0.95, -1.1, 0.85], [-10.0, 1.0, -1.8, 0.95], [-8.6, 1.1, -1.85, 1.0], [-8.0, 1.15, -1.9, 1.05],
	[-6.0, 1.2, -2.0, 1.05], [-4.0, 1.15, -2.2, 0.85], [-2.5, 1.1, -2.3, 0.55], [-1.0, 1.0, -2.45, 0.25], [1.0, 0.95, -2.5, 0.05], [3.0, 0.9, -2.5, -0.2],
	[6.0, 0.82, -2.55, -0.25], [8.5, 0.62, -2.6, -0.8], [10.0, 0.45, -2.62, -1.15], [11.4, 0.3, -2.62, -1.8]]
## The fuselage between z0 and z1: a box for each stretch between stations, as big as its bigger end.
static func _hull_boxes(z0: float, z1: float) -> Array:
	var out := []
	for i in HULL.size() - 1:
		var A: Array = HULL[i]
		var B: Array = HULL[i + 1]
		var lo := maxf(z0, A[0])
		var hi := minf(z1, B[0])
		if hi - lo < 0.01:
			continue
		var at := func(z: float) -> Array:
			var t: float = (z - A[0]) / (B[0] - A[0])
			return [A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, A[3] + (B[3] - A[3]) * t]
		var p1: Array = at.call(lo)
		var p2: Array = at.call(hi)
		var w := maxf(p1[0], p2[0])
		out.append([-w, w, minf(p1[1], p2[1]), maxf(p1[2], p2[2]), lo, hi])
	return out
# the wing, span-wise in stretches [|x| from, to, leading edge z, trailing edge z, bottom, top]: thick at the
# root, thin and swept back to the rounded tip
const WING := [[1.1, 3.0, -6.8, -1.5, -1.65, -0.35], [3.0, 5.5, -6.5, -1.8, -1.55, -0.4], [5.5, 8.0, -6.2, -2.1, -1.45, -0.45],
	[8.0, 10.5, -5.95, -2.1, -1.3, -0.5], [10.5, 13.0, -5.45, -2.25, -1.15, -0.55], [13.0, 15.0, -5.2, -2.35, -1.05, -0.6], [15.0, 16.4, -4.9, -2.6, -1.0, -0.65]]
static func _wing_boxes(side: int, from: float, to: float) -> Array:
	var out := []
	for w in WING:
		if w[0] >= from and w[0] < to:
			out.append([-w[1], -w[0], w[4], w[5], w[2], w[3]] if side < 0 else [w[0], w[1], w[4], w[5], w[2], w[3]])
	return out
# the tail: the fin (thin, its leading edge swept up from the dorsal fillet) and the two tailplanes
static func _tail_boxes() -> Array:
	var out := []
	for f in [[4.6, 6.0, -0.6, 0.3], [6.0, 6.8, -0.6, 0.9], [6.8, 7.6, -0.8, 1.7], [7.6, 8.3, -0.9, 2.7], [8.3, 10.0, -1.0, 3.05], [10.0, 10.4, -1.1, 2.6]]:
		out.append([-0.28, 0.28, f[2], f[3], f[0], f[1]])
	for s in [[0.3, 2.2, 5.9, 9.4], [2.2, 4.4, 6.4, 9.4], [4.4, 6.8, 6.9, 9.3]]:
		out.append([s[0], s[1], -2.0, -1.3, s[2], s[3]])
		out.append([-s[1], -s[0], -2.0, -1.3, s[2], s[3]])
	return out
static func _bounds(boxes: Array) -> Array:
	var out := []
	for k in 6:
		var v: float = boxes[0][k]
		for q in boxes:
			v = maxf(v, q[k]) if k % 2 else minf(v, q[k])
		out.append(v)
	return out
static func _parts() -> Array:
	# a B-17 could take a lot: hit points are rounds of .30/.50 (a 20 mm shell counts 3)
	var list := []
	for i in ENGINE_X.size():
		var x: float = ENGINE_X[i]
		list.append({name = "engine%d" % (i + 1), kind = "engine", engine = i, boxes = [[x - 0.7, x + 0.7, -1.4, 0.0, -9.1, -4.6]], hp = 32})
	# the inner wings carry the fuel tanks round the engines; the outer wings, the tips
	list.append({name = "wingLi", kind = "wing", side = -1, inner = true, boxes = _wing_boxes(-1, 0, 8), hp = 70})
	list.append({name = "wingRi", kind = "wing", side = 1, inner = true, boxes = _wing_boxes(1, 0, 8), hp = 70})
	list.append({name = "wingLo", kind = "wing", side = -1, boxes = _wing_boxes(-1, 8, 99), hp = 80})
	list.append({name = "wingRo", kind = "wing", side = 1, boxes = _wing_boxes(1, 8, 99), hp = 80})
	list.append({name = "tailplane", kind = "tail", boxes = _tail_boxes(), hp = 45})
	list.append({name = "ball", kind = "turret", turret = "ball", boxes = [[-0.55, 0.55, -2.95, -1.95, -0.75, 0.5]], hp = 22})
	list.append({name = "top", kind = "turret", turret = "top", boxes = [[-0.62, 0.62, 1.0, 1.75, -7.35, -6.05]], hp = 22})
	# (the cockpit with its canopy over it)
	for s in SECTIONS:
		list.append({name = s[0], kind = "section", section = s[0], boxes = _hull_boxes(s[1], s[2]) + ([[-0.9, 0.9, 1.0, 1.6, -8.4, -6.4]] if s[0] == "cockpit" else []), hp = 60})
	for p in list:
		p.box = _bounds(p.boxes)
		for k in ["side", "inner", "engine", "turret", "section"]:
			if not p.has(k):
				p[k] = null if k != "inner" else false
	return list
static var PARTS: Array = _parts()
static func _part_map() -> Dictionary:
	var out := {}
	for p in PARTS:
		out[p.name] = p
	return out
static var PART: Dictionary = _part_map()

# everything that makes a bomber "that bomber" (where it flies, its damage), but not how it's drawn
const STATE := ["base", "home", "slot0", "no_tail", "pilotless", "pilotless_t", "flown", "flight", "bottles", "leak", "fx", "spiral", "phase", "label", "squad", "lead", "bombs", "dropping", "hp", "engines", "tank_fire", "down", "gone", "drift", "roll", "roll_rate", "down_t", "chutes",
	"lost", "sec_fire", "sec_fire_limit", "turret_out", "dive", "warned", "last_hit_by", "last_hit_t", "player_hit_t", "crashed", "unit", "ident", "hist_record", "hist_crew", "cut_boxes", "lost_parts"] # (the last two: what break-up has cut away, breakup.js)
const STRAGGLE := 180.0 # m from her slot in the box: a straggler
const STRAG_BACK := 320.0 # m: how far back behind her slot one falls at most
const FUSELAGE := ["bombbay", "radio", "waist", "tail"] # the sections a fire can take hold in and break her up
const NAMES := {nose = "the nose", cockpit = "the cockpit", bombbay = "the bomb bay", radio = "the radio room", waist = "the waist", tail = "the tail"}

## Swap two bombers' identities. The player's bomber (full model, interior, guns) takes over another
## bomber's place in the formation, damage and all; that bomber gets the old one's (maybe falling) state.
static func swap_bombers(a, b) -> void:
	for k in STATE:
		var t = a.get(k)
		a.set(k, b.get(k))
		b.set(k, t)
	for x in [a, b]:
		x.group.visible = not x.gone
		x.group.position = x.base
		for sp in x.spin:
			sp.v = null
		if x.model:
			Markings.apply_markings(x.model, x.ident) # (the identity moved: so do her markings)

# (the AI pilots keep clear of each other: give_way; main sets it to every bomber)
static var flock: Array = []

var group: Node3D
var model: Node3D
var label := ""
var squad := "" # the 18-ship group it bombs with
var lead := false # that group's lead (its bombardier aims for the whole group)
var bombs := 12 # 12 x 500 lb
var base: Vector3
var home: Vector3 # its slot in the formation (base leaves it while the player flies)
var slot0: Vector3 # where that slot is in the box (home drifts away from it with a straggler)
# heading/pitch/bank relative to the formation's course; only the player's own pilot changes them
var flight := {heading = 0.0, pitch = 0.0, bank = 0.0, speed = AIRSPEED, throttle = 0.5}
var bottles := 3 # engine fire extinguisher shots
var manual_fires := false # the player is the pilot: fighting engine fires is his job
var phase: float
var props: Array = []
var interior = null
var hp := {}
var engines: Array # ok | smoking | dead | fire
var spin: Array # each prop: rad/s, blade angle, blur disc angle
var tank_fire := {-1: 0.0, 1: 0.0} # seconds a wing tank has been burning (0 = not burning)
var leak := {-1: 0.0, 1: 0.0} # seconds of fuel still streaming from a holed tank
var fx: Array = [] # things to show next frame: a wing or the tail breaking off, a tank blowing up
var spiral = null # how it falls once it's going down
var down := false # shot down: leaving the formation for good
var gone := false # fallen out of sight
var drift := Vector3.ZERO # a straggler falls back and down
var roll := 0.0
var roll_rate := 0.0
var down_t := 0.0
var chutes := 0
var lost := {} # parts gone: a wing, the tail, a section broken away
var sec_fire := {} # fuselage section -> seconds it's been burning
var sec_fire_limit = null
var turret_out := {} # a turret knocked out
var dive := false # going down nose first (tail or cockpit gone) rather than spinning
var no_tail := false
var warned := {}
var listeners: Array = []
var shudder := 0.0 # 0..1: shaken by a flak burst close by
var pilotless := false
var pilotless_t := 0.0
var flown := false
var dropping = null
var strag_t := 0.0
var keep_w = null
var fire_spots := {}
var knock = null
var aborting = null # (turned back: a drift out of the box, down and away home: main.js)
var abort_at = null
var aborted := false
# who she was (main.js, from history.js) and her place in the order of battle (oob.js)
var unit = null
var ident = null
var hist_record = null
var hist_crew = null
var hist_k := 1.0
# the battle's own notes on her (fighters.js, crew.js, main.js)
var last_hit_by = null
var last_hit_t := -INF
var player_hit_t := -INF
var crashed := false
var near_until := {}
var last_at = null
var guns_active := false
var on_break: Callable # (kind, side, z, vel): a part breaking away (breakup.js)
# break-up (breakup.js)
var cut_boxes = null
var lost_parts = null
var cut_root = null
var cut_state = null
var wreck_body = null
var tail_piece = null
var scar_meshes = null
## anything else another part of the game wants to keep on her
var extra := {}

## model = null for a far-away bomber drawn by the Fleet (instanced low-detail copies).
func _init(model_: Node3D = null, opts := {}) -> void:
	group = Node3D.new()
	group.rotation_order = EULER_ORDER_XYZ
	model = model_
	if model:
		group.add_child(model)
	label = opts.get("label", "")
	squad = opts.get("squad", "")
	lead = opts.get("lead", false)
	base = opts.get("position", Vector3.ZERO)
	home = base
	slot0 = base
	group.position = base
	phase = randf() * 100.0
	props = _find_props(model)
	if opts.get("interior", false):
		interior = load("res://src/interior.gd").new(model)
		group.add_child(interior.group)
	for p in PARTS:
		hp[p.name] = float(p.hp)
	engines = []
	spin = []
	for x in ENGINE_X:
		engines.append({state = "ok", fire_t = 0.0, feathered = false, fire_limit = null})
		spin.append({v = null, r = randf() * 6.0, a = 0.0, blur = true})

static func _find_props(m: Node3D) -> Array:
	if not m:
		return []
	var out := []
	for i in [1, 2, 3, 4]:
		out.append(m.find_child("Prop_%d" % i, true, false))
	return out

## 0 (untouched) .. 1 (destroyed) for one part, for the damage diagram.
func damage(name: String) -> float:
	return 1.0 if lost.get(name, false) else 1.0 - maxf(0.0, hp[name]) / PART[name].hp

## Is this gun's turret still working?
func turret_works(station_id: String) -> bool:
	return not turret_out.get(station_id, false) and not (station_id == "tail" and no_tail) # (the tail gun went with the tail)

## Give this bomber a model to draw (a mid-detail one from the pool), or take it away (null).
func set_model(m: Node3D) -> void:
	if model and model.get_parent() == group:
		group.remove_child(model)
	model = m
	if m:
		group.add_child(m)
	props = _find_props(m)
	if m and not interior and not m.has_meta("turrets"):
		m.set_meta("turrets", _rig_turrets(m))
	if m:
		Markings.apply_markings(m, ident) # (her own codes and numbers: markings.js)

## A bomber seen from outside: its ball and top turrets turn (and the ball tilts) towards where its
## gunners aim, guns and all. dir: bomber space, or null to search the sky slowly.
func aim_turret(id: String, dir, dt: float, t: float) -> void:
	if not model or not model.has_meta("turrets"):
		return
	var r = model.get_meta("turrets").get(id)
	if not r:
		return
	var yaw: float
	var pitch: float
	if dir != null:
		yaw = atan2(-dir.x, -dir.z)
		pitch = asin(clampf(dir.y, -1, 1))
	else: # (scanning: a slow sweep, different on every bomber)
		yaw = r.yaw0 + sin(t * 0.21 + phase * 3) * (2.2 if id == "top" else 1.6)
		pitch = 0.25 + sin(t * 0.37 + phase) * 0.2 if id == "top" else -0.6 + sin(t * 0.33 + phase) * 0.45
	var k := 1.0 - exp(-dt * 3)
	r.yaw += wrap_a(yaw - r.yaw) * k
	r.pitch += (pitch - r.pitch) * k
	r.yaw_part.rotation.y = r.yaw - r.yaw0
	if r.full:
		r.full.quaternion = Quaternion(Vector3.UP, r.yaw - r.yaw0) * Quaternion(r.elev, r.pitch - r.pitch0)

## Called with (message) for things the crew would call out (only used for the player's bomber).
func on_event(fn: Callable) -> void:
	listeners.append(fn)
func emit(msg: String) -> void:
	for fn in listeners:
		fn.call(msg)

## 0..1: how much of the airframe is left (for the health bar).
var health: float:
	get:
		if down:
			return 0.0
		var have := 0.0
		var mx := 0.0
		for p in PARTS:
			var w := 1.0 if p.kind == "section" else 1.5
			have += maxf(0.0, hp[p.name]) / p.hp * w
			mx += w
		# the parts that bring her down count for more: the weakest wing, the tail, three engines
		var crit := INF
		for n in ["wingLi", "wingRi", "wingLo", "wingRo", "tailplane", "cockpit"]:
			crit = minf(crit, maxf(0.0, hp[n]) / PART[n].hp)
		return maxf(0.0, minf(minf(have / mx, crit * 1.2), 1.0 - dead_engines / 3.0))

## The pilot pulls the fire bottle on engine i.
func pull_bottle(i: int) -> void:
	var e = engines[i] if i >= 0 and i < engines.size() else null
	if not e or e.state != "fire":
		emit("Engine %d isn't burning." % (i + 1))
		return
	if bottles <= 0:
		emit("No extinguisher bottles left!")
		return
	bottles -= 1
	# (it goes out more surely on a feathered engine: no fuel and air being pumped through it)
	if randf() < (0.9 if e.feathered else 0.75):
		e.state = "dead"
		emit(("Fire's out on %d." if e.feathered else "Fire's out on %d. Feather it!") % (i + 1))
	else:
		emit("%d is still burning! (%d bottle%s left)" % [i + 1, bottles, "" if bottles == 1 else "s"])

## Feather engine i: the prop's blades turn edge-on to the air and it stops windmilling (and dragging).
func feather(i: int) -> void:
	var e = engines[i] if i >= 0 and i < engines.size() else null
	if not e or e.feathered:
		return
	if e.state == "ok":
		emit("Engine %d is running fine." % (i + 1))
		return
	e.feathered = true
	if e.state == "smoking":
		e.state = "dead" # (shut down before it burns)
	emit("Feathering %d." % (i + 1))

## The engine the pilot should deal with first, or null: one on fire, then one dead and windmilling,
## then one smoking. { i, fire, feather } says what can be done about it.
var engine_trouble:
	get:
		var rank := func(e): return 3 if e.state == "fire" else 2 if e.state == "dead" and not e.feathered else 1 if e.state == "smoking" else 0
		var best := -1
		for i in engines.size():
			if rank.call(engines[i]) > 0 and (best < 0 or rank.call(engines[i]) > rank.call(engines[best])):
				best = i
		if best < 0:
			return null
		var e: Dictionary = engines[best]
		return {i = best, fire = e.state == "fire", feather = not e.feathered, state = e.state}

## Thrust, as a multiple of what holds the formation's speed: each running engine gives cruise power
## at half throttle and up to 1.6 times that at full; a smoking one three quarters of it; a dead one
## nothing, and one still windmilling (not feathered) drags. 1 = cruise with all four.
func power(throttle: float) -> float:
	var p := throttle * 2 if throttle <= 0.5 else 1 + (throttle - 0.5) * 1.2
	var sum := 0.0
	for e in engines:
		sum += p if e.state == "ok" else p * 0.75 if e.state == "smoking" else 0.0 if e.feathered else -0.25
	return sum / 4

## The throttle the pilot needs to hold the formation's speed (above 1: he can't).
var throttle_needed: float:
	get:
		var good := 0.0
		var drag := 0.0
		for e in engines:
			if e.state == "ok":
				good += 1
			elif e.state == "smoking":
				good += 0.75
			elif not e.feathered:
				drag += 0.25
		if good <= 0:
			return 2.0
		var p := (4 + drag) / good
		return p / 2 if p <= 1 else 0.5 + (p - 1) / 1.2

## Noticeably shot up: any part below 70% of its strength.
var damaged: bool:
	get:
		for p in PARTS:
			if hp[p.name] < p.hp * 0.7:
				return true
		return false

var dead_engines: int:
	get:
		var n := 0
		for e in engines:
			if e.state == "dead" or e.state == "fire":
				n += 1
		return n
var burning: bool:
	get:
		for e in engines:
			if e.state == "fire":
				return true
		return tank_fire[-1] > 0 or tank_fire[1] > 0
## How likely she is to go down from the damage she already has (0 sound .. 0.9): a burning wing tank
## or fuselage, an engine fire, two engines out, falling out of the formation, nobody at the controls.
var peril: float:
	get:
		if down or gone:
			return 0.0
		var tank: bool = tank_fire[-1] > 0 or tank_fire[1] > 0
		for t in sec_fire.values():
			tank = tank or t > 0
		var fire := false
		for e in engines:
			fire = fire or e.state == "fire"
		return minf(0.9, (0.7 if tank else 0.0) + (0.3 if fire else 0.0) + (0.4 if dead_engines >= 2 else 0.0) + (0.3 if straggling else 0.0) + (0.9 if pilotless and not flown else 0.0))

## Flak splinters through engine `i`'s cowling: a cut fuel or oil line, and it's alight then and there.
func ignite_engine(i: int) -> bool:
	var e = engines[i] if i >= 0 and i < engines.size() else null
	if down or not e or e.state == "fire" or e.state == "dead":
		return false
	e.state = "fire"
	e.fire_t = 0.0
	e.feathered = not manual_fires
	e.fire_limit = rand(6, 12)
	emit("Engine %d on fire!" % (i + 1))
	return true

func _once(key: String, msg: String) -> void:
	if not warned.get(key, false):
		warned[key] = true
		emit(msg)

## A round hit `part` (from PARTS). Returns the part so the crew can work out who was hurt.
func hit(part: Dictionary, cannon: bool) -> Dictionary:
	if down or lost.get(part.name, false):
		return part
	var dmg := 3 if cannon else 1
	hp[part.name] -= dmg
	var h: float = hp[part.name]
	var frac: float = h / part.hp
	var side_name := "left" if part.side != null and part.side < 0 else "right"
	if part.kind == "engine":
		var e: Dictionary = engines[part.engine]
		if e.state == "ok" and frac < 0.6:
			e.state = "smoking"
			emit("Engine %d is smoking!" % (part.engine + 1))
		if (e.state == "ok" or e.state == "smoking") and h <= 0:
			e.state = "fire" if randf() < 0.4 else "dead"
			e.fire_t = 0.0
			e.feathered = not manual_fires # (the AI pilots feather at once; you have to do it yourself)
			e.fire_limit = rand(6, 12) # how long before it either goes out or spreads
			emit(("Engine %d on fire!" % (part.engine + 1)) if e.state == "fire" else ("Engine %d is out, feathering %d!" % [part.engine + 1, part.engine + 1]))
	elif part.kind == "wing" and part.inner:
		# the tanks: self-sealing, each hit leaks a little, and may set the fuel alight (the worse the wing, the likelier)
		leak[part.side] = maxf(leak[part.side], 30.0 if cannon else 12.0) # holed: fuel streams out
		if tank_fire[part.side] == 0 and (frac < 0.3 or randf() < (0.06 if cannon else 0.01)):
			tank_fire[part.side] = 0.001
			emit("Fire in the %s wing!" % side_name)
		if frac < 0.4:
			_once(part.name, "The %s wing root's badly shot up!" % side_name)
		if h <= 0:
			lose_wing(part.side, true, "The %s wing has broken off!" % side_name)
	elif part.kind == "wing":
		if frac < 0.4:
			_once(part.name, "The %s wingtip's shot to pieces!" % side_name)
		if h <= 0:
			lose_wing(part.side, false, "The %s wing is folding up!" % side_name)
	elif part.kind == "tail":
		if frac < 0.5:
			_once("tail", "The tail is shot up, she's sluggish on the controls!")
		if h <= 0:
			lost.tailplane = true
			fx.append({type = "tail"})
			dive = true # (with no tail she can't be held: the nose goes straight down)
			no_tail = true
			go_down("The tail's been shot off!")
	elif part.kind == "turret":
		if h <= 0 and not turret_out.get(part.turret, false):
			turret_out[part.turret] = true
			emit("The %s turret's knocked out!" % ("ball" if part.turret == "ball" else "top"))
	elif part.kind == "section":
		var sec: String = part.section
		if (sec == "cockpit" or sec == "nose") and h <= 0:
			dive = true
			go_down("The pilots are hit!" if sec == "cockpit" else "The nose is shot away!")
		# a hit through the oxygen, the hydraulics or the flares can start a fire in there
		if sec in FUSELAGE and not sec_fire.get(sec, 0.0) and frac < 0.55 and randf() < (0.18 if cannon else 0.04):
			sec_fire[sec] = 0.001
			sec_fire_limit = rand(25, 50)
			emit("Fire in %s!" % NAMES[sec])
		if sec in FUSELAGE and h <= 0:
			if sec == "tail" or sec == "waist":
				no_tail = true
			break_up(sec)
	if dead_engines >= 3:
		go_down("Three engines out, we can't hold her!")
	return part

## A wing breaks: the outer panel folds up, or the whole wing goes at the root. She rolls over and spins in.
func lose_wing(side: int, root: bool, msg: String) -> void:
	if down:
		return
	var s := "L" if side < 0 else "R"
	lost["wing%so" % s] = true
	if root:
		lost["wing%si" % s] = true
	fx.append({type = "wing", side = side, x = 6.0 if root else 12.0})
	spiral = {r = 18.0 if root else 30.0, w = 1.0 if root else 0.7, side = side}
	go_down(msg)

## The fuselage fails at `sec` (fire or shell damage): she breaks in two and falls in pieces.
func break_up(sec: String) -> void:
	if down:
		return
	lost[sec] = true
	for s in SECTIONS:
		if s[0] == sec:
			fx.append({type = "breakup", z = (s[1] + s[2]) / 2.0})
	dive = true
	go_down("She's breaking up!")

func go_down(reason: String) -> void:
	if down:
		return
	down = true
	down_t = 0.0
	roll = 0.0
	roll_rate = spiral.side * -rand(0.5, 0.9) if spiral else rand(0.05, 0.25) * (-1 if randf() < 0.5 else 1)
	chutes = int(floor(rand(0, 10.99))) # how many of the crew get out
	emit(reason)
	emit("Bail out! Bail out!")

## Engine fires, burning tanks and fuselage, stragglers falling back, and the final fall.
func update_damage(dt: float, effects) -> void:
	if gone:
		return
	var m := group.transform
	var vel := Vector3(0, 0, AIRSPEED * 0.15) + drift # trails stream back
	for i in engines.size():
		var e: Dictionary = engines[i]
		if e.state == "ok":
			continue
		if not manual_fires and e.state != "smoking":
			e.feathered = true # (an AI pilot at the controls feathers it)
		var at := m * Vector3(ENGINE_X[i], -0.6, -4.2)
		if effects:
			if e.state == "smoking":
				effects.trail(at, vel, "smoke", dt)
			if e.state == "dead":
				effects.trail(at, vel, "black", dt * 0.5)
		if e.state == "fire":
			# flames out of the cowling's gills and over the nacelle, streaming back, under thick black smoke
			if effects:
				effects.trail(at, vel, "fire", dt)
				effects.trail(m * Vector3(ENGINE_X[i], -0.15, -5.4), vel, "fire", dt * 0.7)
				effects.trail(m * Vector3(ENGINE_X[i], -0.3, -3.2), vel, "black", dt * 0.8)
			# the pilot pulls the fire bottle: often it goes out, sometimes it spreads to the wing tank.
			# When the player is the pilot that's his job (1-4), and a fire left alone spreads.
			e.fire_t += dt
			if manual_fires:
				if e.fire_t > (32 if e.feathered else 20): # (feathered, it burns slower)
					e.state = "dead"
					var side := -1 if i < 2 else 1
					if not tank_fire[side]:
						tank_fire[side] = 0.001
						emit("The fire's spreading into the %s wing!" % ("left" if side < 0 else "right"))
			elif e.fire_t > (e.fire_limit if e.fire_limit != null else 8.0):
				if randf() < 0.55:
					e.state = "dead"
					emit("Fire's out on %d." % (i + 1))
				else:
					e.state = "dead"
					var side := -1 if i < 2 else 1
					if not tank_fire[side]:
						tank_fire[side] = 0.001
						emit("The fire's spreading into the %s wing!" % ("left" if side < 0 else "right"))
	for side in [-1, 1]:
		if not tank_fire[side]:
			continue
		tank_fire[side] += dt
		if effects:
			effects.trail(m * Vector3(side * 5.5, -0.8, -4.5), vel, "fire", dt)
		if tank_fire[side] > 25 and not down: # the fire reaches the main tank: it blows, and the wing goes
			fx.append({type = "blowup", side = side})
			fx.append({type = "wing", side = side})
			spiral = {r = 30.0, w = 0.7, side = side}
			go_down("The wing's burning through!")
	# fires in the fuselage: they eat at the section until the crew get them out, or she breaks up
	for sec in FUSELAGE:
		if not sec_fire.get(sec, 0.0) or down:
			continue
		sec_fire[sec] += dt
		hp[sec] -= dt * 0.8
		var z0 := 0.0
		var z1 := 0.0
		for s in SECTIONS:
			if s[0] == sec:
				z0 = s[1]; z1 = s[2]
		var z := (z0 + z1) / 2
		# out through the windows and holes, seen from other planes (not from inside her or close by: its
		# big flames, through the open waist windows, would white out the view; inside it's cabin_fire)
		var near: bool = effects != null and effects.cam_pos != null and group.position.distance_squared_to(effects.cam_pos) < 225
		if effects and not near:
			effects.trail(m * Vector3(-1.7 if randf() < 0.5 else 1.7, -0.9, z), vel, "fire", dt * 0.5)
		if interior and effects:
			cabin_fire(sec, z0, z1, effects, dt)
		if hp[sec] <= 0:
			break_up(sec)
		elif sec_fire[sec] > (sec_fire_limit if sec_fire_limit != null else 40.0) and hp[sec] > PART[sec].hp * 0.25: # put out
			sec_fire[sec] = 0.0
			emit("The fire in %s is out." % NAMES[sec])
	for side in [-1, 1]: # fuel streaming from a holed tank
		if leak[side] > 0 and not tank_fire[side]:
			leak[side] -= dt
			if effects:
				effects.trail(m * Vector3(side * 6.5, -0.7, -4.0), vel, "fuel", dt)
	# the moments it breaks up: pieces fly off, a tank goes up in a fireball
	var q := m.basis.get_rotation_quaternion()
	while fx.size() and effects:
		var e: Dictionary = fx.pop_front()
		# the part itself leaves (breakup.js), with smaller wreckage flying off the tear
		if e.type == "wing":
			if on_break.is_valid():
				on_break.call("wingi" if e.get("x") == 6.0 else "wingo", e.side, 0.0, vel)
			effects.wreck(m * Vector3(e.side * e.get("x", 12.0), -0.8, -4.3), vel, 3, Vector3(1.4, 0.2, 0.9), 0.5, q)
		if e.type == "tail":
			if on_break.is_valid():
				on_break.call("tail", 0, 0.0, vel)
			effects.wreck(m * Vector3(0, 0.6, 7), vel, 3, Vector3(1.2, 0.2, 0.8), 0.2, q)
		if e.type == "blowup":
			effects.explosion(m * Vector3(e.side * 5.5, -0.8, -4.5), vel, 3)
		if e.type == "breakup":
			effects.explosion(m * Vector3(0, 0, e.z), vel, 2.5)
			effects.wreck(m * Vector3(0, 0, e.z), vel, 4, Vector3(1.2, 0.8, 1.2), 0.6, q)
			if on_break.is_valid():
				on_break.call("fuselage", 0, maxf(e.z, -1.2), vel) # (forward of the wing's trailing edge she parts behind it)
	# stragglers: the AI pilot opens up the good engines to hold the formation's speed; when even full
	# throttle won't do it (two engines out), she drops back, and sinks. (You at the controls set your
	# own throttle: see fly.)
	var n := dead_engines
	var short := 0.0 if manual_fires else maxf(0.0, 1.0 - power(1)) * SPEED_PER_POWER
	drift = Vector3(0, -1.5 if n >= 2 else 0.0, short)
	if aborting != null:
		drift = aborting # (turned back: out of the box, down and away home: main.js)
	if not down and aborting == null and drift.z > 0 and base.z - slot0.z > STRAG_BACK:
		drift.z = 0 # (fallen back behind her group as far as she will: she hangs on there) (an abort goes on back: main.js)
	strag_t = strag_t + dt if straggling and not down else 0.0
	if pilotless and not flown and not down: # nobody at the controls: a long, slow, wandering glide down and out of the box
		pilotless_t += dt
		drift = Vector3(sin(pilotless_t * 0.05) * 3, -minf(9, 1 + pilotless_t * 0.15), minf(18, 3 + pilotless_t * 0.3))
		roll = sin(pilotless_t * 0.12) * 0.25
		if pilotless_t > 150:
			go_down("Nobody at the controls: she's going in!")
	if not manual_fires:
		flight.throttle = minf(1.0, throttle_needed)
	if down:
		down_t += dt
		# falling in a spiral: round and round as it goes down (tight and fast with a wing gone)
		if spiral == null:
			spiral = {r = rand(15, 40), w = rand(0.2, 0.45), side = -1 if randf() < 0.5 else 1}
		var sp: Dictionary = spiral
		var a: float = down_t * sp.w * sp.side
		var v: float = sp.r * sp.w * minf(1.0, down_t / 4)
		drift = Vector3(cos(a) * v * (0.4 if dive else 1.0), -minf(80.0 if dive else 45.0, (12.0 if no_tail else 4.0) + down_t * (14.0 if no_tail else 5.0 if dive else 2.5)), 22 + sin(a) * v)
		roll += roll_rate * dt * (1 + down_t * 0.08)
		if chutes > 0 and down_t > 3 and randf() < dt * 0.8:
			chutes -= 1
			if effects:
				effects.parachute(m * Vector3(rand(-1, 1), -2.5, rand(-2, 6)))
		if down_t > 6 and randf() < dt * 0.05 and effects:
			effects.explosion(group.position, Vector3.ZERO, 2)
		if base.y < -3000:
			gone = true
			group.visible = false
	base += drift * dt
	home += drift * dt
	# a straggler's place, drifting back and down through the box (and where she hangs on behind it): never
	# where another ship is. It edges over or under her, and her pilot flies there round her (give_way)
	if not down and home.distance_squared_to(slot0) > 100:
		for o in flock:
			if o == self or o.gone or o.down:
				continue
			var dx: float = home.x - o.base.x
			var dy: float = home.y - o.base.y
			var dz: float = home.z - o.base.z
			if absf(dx) > 46 or absf(dz) > 36 or absf(dy) > 18:
				continue
			var over: bool = dy > 0 if absf(dy) > 0.5 else phase > o.phase
			home.y += (1 if over else -1) * minf(1.0, (18 - absf(dy)) / 6) * 8 * dt
			home.x += (1 if dx >= 0 else -1) * 3 * dt

## Flames and smoke inside a burning section of the bomber you're in (so you see it from inside; the
## crew and you get burnt standing in it, see Crew). Few particles: the pools are shared with the battle.
func cabin_fire(sec: String, z0: float, z1: float, effects, dt: float) -> void:
	var deck: float = {bombbay = -1.62, radio = -1.8, waist = -1.95, tail = -2.15}[sec]
	# (dim, small flames: full-strength fire particles a metre from your eye would white out the screen;
	# drag 0: in the still air of the cabin they mustn't be blown back with the airstream outside)
	# a few seats of fire in the section (on the floor, against the walls), each a tight cluster of flames
	if not fire_spots.has(sec):
		fire_spots[sec] = [0, 1, 2].map(func(_i): return [rand(-0.55, 0.55), rand(z0 + 0.4, z1 - 0.4)])
	var spots: Array = fire_spots[sec]
	var m := group.transform
	var n := int(floor(dt * 110 + randf()))
	for i in n:
		var s: Array = spots[i % spots.size()]
		var p := m * Vector3(s[0] + rand(-0.14, 0.14), deck + rand(0, 0.2), s[1] + rand(-0.14, 0.14))
		effects.fire.emit(p, Vector3(rand(-0.1, 0.1), rand(0.7, 1.5), rand(-0.1, 0.1)), {life = rand(0.25, 0.5), s0 = 0.2, s1 = 0.04, c0 = [5, 2, 0.5], c1 = [1.2, 0.35, 0.08], drag = 0})
		if randf() < 0.3:
			effects.smoke.emit(p, Vector3(rand(-0.12, 0.12), rand(0.3, 0.55), rand(-0.12, 0.12)), {life = rand(2, 3.5), s0 = 0.3, s1 = 1.5, a0 = 0.6, c0 = [0.05, 0.045, 0.04], c1 = [0.16, 0.15, 0.14], drag = 0})

## Out of the box: flown away from it (the player at the controls), or dropped back and down, crippled.
## Alone, without the box's massed guns round her, she's what the fighters look for.
var straggling: bool:
	get:
		return not down and not gone and base.distance_squared_to(slot0) > STRAGGLE * STRAGGLE

## Off its slot or course: the autopilot has work to do.
var off_station: bool:
	get:
		return flight.heading != 0 or flight.pitch != 0 or flight.bank != 0 or base.distance_squared_to(home) > 0.01

## An AI pilot off his slot (a straggler falling back, an abort leaving, a ship moving up into a gap)
## keeps clear of the others on his way: one close ahead of him in his path, he goes over or under her
## (whichever side he's already on) and edges away sideways. v: his velocity through the box, changed.
func give_way(v: Vector3) -> Vector3:
	var most := 0.0
	var px := 0.0
	var py := 0.0
	for o in flock:
		if o == self or o.gone or o.down:
			continue
		var dx: float = base.x - o.base.x
		var dy: float = base.y - o.base.y
		var dz: float = base.z - o.base.z
		# (closer than a span and a half and a length and a half, within three times her height: the neighbours
		# in their own slots, 52 m out or 33 m down, are never in it)
		if absf(dx) > 46 or absf(dz) > 36 or absf(dy) > 18:
			continue
		var k := (1 - absf(dy) / 18) * minf(1.0, (46 - absf(dx)) / 14) * minf(1.0, (36 - absf(dz)) / 14)
		most = maxf(most, k)
		var over: bool = dy > 0 if absf(dy) > 0.5 else phase > o.phase # (level with her: one goes over, the other under)
		py += (1 if over else -1) * k * 10 # (over or under her, whichever he's on: up to 10 m/s)
		px += (1 if dx >= 0 else -1) * k * 4
	if not most:
		return v
	# (and he holds off going on into her while he does)
	v.x *= 1 - 0.8 * most; v.z *= 1 - 0.8 * most; v.y *= 1 - 0.5 * most
	v.x += px; v.y += py
	return v

## Fly the bomber for one frame. `input` = the player at the controls { aim_yaw, aim_pitch, throttle, roll },
## or null: the autopilot (the AI pilot) brings her back to her slot in the formation.
func fly(dt: float, input = null) -> void:
	var f := flight
	if down or gone or dt <= 0:
		return
	var heading: float
	var pitch: float
	var speed: float
	if input:
		heading = input.aim_yaw
		pitch = input.aim_pitch
		f.throttle = input.throttle
		speed = AIRSPEED + (power(f.throttle) - 1) * SPEED_PER_POWER
	else:
		if not off_station:
			return
		# steer for the slot: close the gap at up to 12 m/s relative to the formation
		var d := home - base
		var dist := d.length()
		if dist < 0.5 and absf(f.heading) < 0.005 and absf(f.bank) < 0.005 and absf(f.pitch) < 0.005:
			f.heading = 0.0; f.pitch = 0.0; f.bank = 0.0; f.speed = AIRSPEED; base = home
			return
		d *= minf(0.12, 12 / maxf(dist, 1e-3))
		d = give_way(d)
		d.z -= AIRSPEED # through the air the formation flies towards -Z
		heading = atan2(-d.x, -d.z)
		pitch = atan2(d.y, Vector2(d.x, d.z).length())
		speed = d.length()
		f.throttle = minf(1.0, throttle_needed)
	# a shot-up tail: she wanders and answers the controls slowly; damaged engines give less power
	var tail: float = 0.0 if lost.get("tailplane", false) else maxf(0.0, hp.tailplane) / PART.tailplane.hp
	if tail < 0.7:
		var wander: float = (0.7 - tail) * 0.06
		var now := Time.get_ticks_msec()
		heading += sin(phase + now * 0.0007) * wander
		pitch += sin(phase * 1.7 + now * 0.0011) * wander * 0.5
	# a heavy bomber: banks to turn, rolls slowly, and the bank angle sets the rate of turn
	var err := wrap_a(heading - f.heading)
	var bank_t: float = input.roll * MAX_BANK if input and input.get("roll") else clampf(err * 2.5, -MAX_BANK, MAX_BANK)
	f.bank += (bank_t - f.bank) * (1 - exp(-dt * 1.1 * (0.35 + 0.65 * minf(1.0, tail / 0.7))))
	if knock and knock.t > 0: # knocked by another B-17: the nose swung and a wing thrown up, fading as you get her back
		knock.t -= dt
		var k: float = knock.t / knock.T
		f.bank += knock.roll * k * sin(knock.t * 5) * dt * 3
		f.heading = wrap_a(f.heading + knock.yaw * k * dt)
	f.heading = wrap_a(f.heading + (9.81 * tan(f.bank) / maxf(f.speed, 30)) * dt)
	f.pitch += (clampf(pitch, -0.22, 0.16) - f.pitch) * (1 - exp(-dt * 0.9))
	speed -= sin(f.pitch) * 25 # climbing costs speed, diving gains it
	f.speed += (clampf(speed, 45, 115) - f.speed) * (1 - exp(-dt * (0.15 if input else 0.6)))
	# move relative to the formation, which flies -Z at AIRSPEED while the world scrolls past
	var cp := cos(f.pitch)
	base.x -= sin(f.heading) * cp * f.speed * dt
	base.y += sin(f.pitch) * f.speed * dt
	base.z += (AIRSPEED - cos(f.heading) * cp * f.speed) * dt

func update(t: float, dt: float) -> void:
	# the props: running, windmilling (a dead engine not yet feathered turns over slowly in the
	# airstream), or feathered: stopped, the blades turned edge-on
	for i in engines.size():
		var e: Dictionary = engines[i]
		var sp: Dictionary = spin[i]
		var want := 31.0 + i * 0.4 if e.state == "ok" or e.state == "smoking" else 0.0 if e.feathered else 8.0
		sp.v = want if sp.v == null else sp.v + (want - sp.v) * (1 - exp(-dt * 0.8))
		sp.r = fmod(sp.r + dt * sp.v, TAU)
		# up to speed, the blades give way to the blur disc (PropBlur draws it, turning a little slower than
		# the prop, so the ghosts are seen to go round, as a film camera catches them); windmilling or
		# stopped, the blades. (Kept on the bomber, not the model: a far bomber the Fleet draws has props too.)
		sp.blur = sp.v > 18
		if sp.blur:
			sp.a = fmod(sp.a - dt * sp.v * 0.8, TAU)
		var p: Node3D = props[i] if i < props.size() else null
		if not p:
			continue
		p.rotation.z = sp.r
		if p.get_meta("blurred", null) != sp.blur:
			p.set_meta("blurred", sp.blur)
			for c in p.get_children():
				if c is MeshInstance3D:
					c.visible = not sp.blur
		var fe := 1.0 if e.feathered and e.state != "ok" else 0.0
		var cur: float = p.get_meta("feather", fe)
		cur += signf(fe - cur) * minf(absf(fe - cur), dt / 3) # (takes a few seconds)
		p.set_meta("feather", cur)
		if cur != p.get_meta("shown", 0.0):
			_feather_blades(p, cur)
	var s := t + phase
	# slow swells plus a little turbulence; small enough to walk around comfortably
	var turb := sin(s * 2.3) * sin(s * 1.7)
	# and each pilot keeping station by hand: never exactly in his slot, always correcting, a few metres
	# out and back over half a minute or a minute, each in his own time (in your own bomber only a hint
	# of it: the formation is seen from her). His corrections across show as a little bank.
	var keep := 0.1 if interior else 1.0
	if keep_w == null:
		keep_w = [0.09 + 0.07 * randf(), 0.11 + 0.08 * randf(), 0.07 + 0.06 * randf()]
	var w: Array = keep_w
	var sx: float = sin(s * w[0]) * 4 + sin(s * w[0] * 2.7) * 1.2
	var sy: float = sin(s * w[1] + 1.3) * 2.5
	var sz: float = sin(s * w[2] + 2.1) * 6
	var pos := Vector3(base.x + sin(s * 0.21) * 0.4 + sx * keep, base.y + sin(s * 0.37) * 0.25 + turb * 0.04 + sy * keep, base.z + sz * keep)
	var slip: float = (cos(s * w[0]) * 4 * w[0] + cos(s * w[0] * 2.7) * 1.2 * w[0] * 2.7) * keep # (m/s across: banked into it)
	var rock := Vector3(
		sin(s * 0.29) * 0.008 + turb * 0.0015 - (minf(1.35 if no_tail else 1.1 if dive else 0.35, down_t * (0.7 if no_tail else 0.09 if dive else 0.02)) if down else 0.0),
		sin(s * 0.13) * 0.004 + (down_t * spiral.w * spiral.side * minf(1.0, down_t / 4) if down and spiral else 0.0),
		sin(s * 0.23) * 0.018 + sin(s * 0.9) * 0.002 - slip * 0.05 - (0.0 if down else FORMATION.bank) + roll + ((0.02 if engines[0].state != "ok" or engines[1].state != "ok" else -0.02) if dead_engines else 0.0))
	# a flak burst close by (main.js, flak's on_burst): she shudders, nose and wings kicked and the whole
	# airframe shaking, dying away over a second or two
	if shudder > 0.003:
		var k := shudder
		rock.x += (randf() - 0.5) * 0.045 * k; rock.y += (randf() - 0.5) * 0.02 * k; rock.z += (randf() - 0.5) * 0.07 * k
		pos.y += (randf() - 0.5) * 0.5 * k
		shudder *= exp(-dt * 3.5)
	var f := flight
	var b := Basis.from_euler(rock, EULER_ORDER_XYZ)
	if f.heading or f.pitch or f.bank: # flown off the formation's course: heading, then pitch, then bank
		b = Basis.from_euler(Vector3(f.pitch, f.heading, f.bank), EULER_ORDER_YXZ) * b
	group.transform = Transform3D(b, pos)
