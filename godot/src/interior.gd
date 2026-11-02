extends RefCounted
# The walkable inside of a B-17, lined up with the outer model.
# - Walls: the real hull mesh is drawn a second time from the inside with interior paint
#   (the outer skin is made front-face only), so windows and shapes match exactly.
# - The hull's cross-section is measured at load time; the player is kept inside it.
# - Floors, steps, bulkheads, seats and racks are box colliders (Box) in bomber space.
#
# (Godot: `Interior.new(model)` with the B-17 as models.gd loads it. The web game's shader hooks on the
# model's skin (the cuts for the cabin's own parts) are spliced into the skin's own shader code here, as
# onBeforeCompile spliced them into Three's; the lining, glass and fittings are this file's and
# cabinlook.gd's own shaders.)

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Models := preload("res://src/models.gd")
const Scars := preload("res://src/scars.gd")
const Environment_ := preload("res://src/environment.gd")
const Cabinlook := preload("res://src/cabinlook.gd")
const BallTurret := preload("res://src/ballturret.gd")
const TopTurret := preload("res://src/topturret.gd")
const InteriorDetail := preload("res://src/interiordetail.gd")
const CockpitB17 := preload("res://src/cockpitb17.gd")
const Stations := preload("res://src/stations.gd")
const Waist := preload("res://src/waist.gd")

const D := PI / 180.0
const HULL := ["MainFuselage2", "Nose", "Tail", "TailGunPod", "SideGunPanels", "FrontGunPanels", "TopTurret"]

# Floors (bomber space, nose towards -Z), measured from the hull cross-sections.
static var DECKS: Array = [
	{name = "Nose", z0 = -10.9, z1 = -8.6, y = -0.72, hw = 0.9}, # right up to the nose glass
	{name = "Cockpit", z0 = -8.6, z1 = -6.35, y = -0.40, hw = 1.0},
	{name = "Bomb bay", z0 = -5.6, z1 = -2.6, y = -1.62, hw = 0.13}, # the narrow catwalk
	{name = "Radio room", z0 = -2.6, z1 = -1.25, y = -1.80, hw = 0.9},
	{name = "Waist", z0 = -1.25, z1 = 5.2, y = -1.95, hw = 0.9}, # starts with the ball turret well
	{name = "Tail", z0 = 5.2, z1 = 8.2, y = -2.15, hw = 0.6},
	{name = "Tail gun", z0 = 8.2, z1 = 10.25, y = -2.32, hw = 0.5},
]
const STEPS := [ # from the flight deck down into the bomb bay
	{z0 = -6.35, z1 = -6.1, y = -0.72}, {z0 = -6.1, z1 = -5.85, y = -1.02}, {z0 = -5.85, z1 = -5.6, y = -1.32},
]
const TURRET_CUT := {z = -6.71, y = 0.9, r = 0.5, ring = 1.14} # the hole in the cockpit roof up into the top turret
# the cuts in her outer skin for the cabin's own parts (the tail cab, the radio hatch, under the top turret, the
# tailplanes' roots): made only while the cabin's drawn. Seen from outside without it (modelShell), she's whole.
static var CABIN := 1.0
static var _cabin_mats: Array = [] # (every material with a cut: they all read `cabin`)

## The tail gunner's cab replaces the model's skin aft of CAB.z0 under the fin (its window cut-outs had
## ragged edges, and a broad strip of metal between them filled the middle of his view): discard the
## skin there. Below the fin root as far as the step down to the gun pod, then below the pod's top.
const CAB := {z0 = 9.55, step = 10.3, podTop = -1.4}
static func cab_cut(z: float) -> float:
	return -1.17 - 0.2 * (z - 9.3) if z < CAB.step - 0.02 else CAB.podTop # just over the fin root

# the radio room's gun hatch: the opening in the roof over the room (bomber space), the gun's mount
# at its forward end, the slipstream deflector ahead of it
const RADIO_HATCH := {x = 0.44, z0 = -2.32, z1 = -0.98, y = 0.15}
# which waist window is cut wide (1) right now: the one whose gun you're at (setWaistWide); the other, and both
# while you're anywhere else, are the model's own size
static var WAIST_WIDE := {L = 0.0, R = 0.0}
static var _waist_mats: Array = []

# ---- the cuts, as GLSL spliced into a skin material's shader (the web game's cutBelow, cutTailCab,
# cutRadioHatch, cutWaistWindows, cutTailplanes). `v_cab_p` is the bomber-space position.
static func _cut_code(kind: String) -> String:
	var f := func(v: float) -> String: return "%.4f" % v
	var w: Dictionary = Waist.WAIST_WINDOW
	match kind:
		"below":
			return "if (cabin > 0.5 && v_cab_p.y < cut_y) discard;\n"
		"tailcab":
			return "if (cabin > 0.5 && v_cab_p.z > %s && v_cab_p.y < (v_cab_p.z < %s ? -1.17 - 0.2 * (v_cab_p.z - 9.3) : %s)) discard;\n" % [f.call(CAB.z0), f.call(CAB.step - 0.02), f.call(CAB.podTop)]
		"radiohatch":
			var h := RADIO_HATCH
			return "if (cabin > 0.5 && v_cab_p.y > %s && abs(v_cab_p.x) < %s && v_cab_p.z > %s && v_cab_p.z < %s) discard;\n" % [f.call(h.y), f.call(h.x), f.call(h.z0), f.call(h.z1)]
		"waistwin":
			return """if ((v_cab_p.x < 0.0 ? wide_l : wide_r) > 0.5) { vec2 q = abs(v_cab_p.zy - vec2(%s, %s)) - vec2(%s, %s);
	if (abs(v_cab_p.x) > 0.45 && length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) < %s) discard; }
""" % [f.call((w.z0 + w.z1) / 2), f.call((w.y0 + w.y1) / 2), f.call((w.z1 - w.z0) / 2 - w.r), f.call((w.y1 - w.y0) / 2 - w.r), f.call(w.r)]
		"tailplane":
			return "if (cabin > 0.5 && v_cab_p.z > 4.8 && v_cab_p.y < -0.9 && abs(v_cab_p.x) < 0.78 - 0.045 * (v_cab_p.z - 5.0)) discard;\n"
	return ""

const _CUT_DECL := "uniform mat4 to_bomber;\nuniform float cabin = 1.0;\nuniform float cut_y = 0.0;\nuniform float wide_l = 0.0;\nuniform float wide_r = 0.0;\nvarying vec3 v_cab_p;\n"
static var _cut_shaders := {}

## A copy of a skin material (models.gd's, or anything with vertex() and fragment()) with these cuts spliced
## in, for one mesh: `to_bomber` = the mesh's frame in bomber space.
static func cut_skin(src: Material, kinds: Array, to_bomber: Transform3D) -> ShaderMaterial:
	var sm: ShaderMaterial = src if src is ShaderMaterial else Models.skin(src, [])
	var key := "%d|%s" % [sm.shader.get_instance_id(), ",".join(kinds)]
	if not _cut_shaders.has(key):
		var code: String = sm.shader.code
		var body := ""
		for k in kinds:
			body += _cut_code(k)
		if not "v_cab_p" in code:
			code = code.replace("void vertex() {", _CUT_DECL + "void vertex() {\n\tv_cab_p = (to_bomber * vec4(VERTEX, 1.0)).xyz;")
		code = code.replace("void fragment() {", "void fragment() {\n" + body)
		var sh := Shader.new()
		sh.code = code
		_cut_shaders[key] = sh
	var m := ShaderMaterial.new()
	m.shader = _cut_shaders[key]
	for u in sm.shader.get_shader_uniform_list():
		m.set_shader_parameter(u.name, sm.get_shader_parameter(u.name))
	for k in sm.get_meta_list():
		m.set_meta(k, sm.get_meta(k))
	m.set_meta("cuts", kinds)
	m.resource_name = sm.resource_name
	m.render_priority = sm.render_priority
	m.set_shader_parameter("to_bomber", Projection(to_bomber))
	m.set_shader_parameter("cabin", CABIN)
	_cabin_mats.append(weakref(m))
	if "waistwin" in kinds:
		_waist_mats.append(weakref(m))
	return m

static func _each(list: Array, f: Callable) -> void:
	for w in list:
		var m = w.get_ref()
		if m:
			f.call(m)

const ROOF := 1.12 # m: just under the top of the fuselage at the cockpit (the turret dome rises above it)
# the crawlway from the flight deck to the nose: down through the hatch in the floor between the
# pilots' seats, forward on hands and knees under the flight deck, out under the instrument panel.
# `hatch` / `mouth` = where you start the crawl from (x, z), `path` = the way through for the eye
static var CRAWLWAY := {
	hatch = {x0 = -0.2, x1 = 0.2, z0 = -7.82, z1 = -7.38}, tunnel = {x = 0.32, y0 = -1.02, y1 = -0.43, z0 = -8.66, z1 = -7.36},
	down = {from = [0, -7.55], reach = 0.7, floor = -0.40, to = [0, -0.72, -9.2], yaw = 0.0, time = 3.8, name = "Crawl down to the nose",
		path = [[0, -0.05, -7.5], [0, -0.55, -7.6], [0, -0.72, -7.95], [0, -0.74, -8.45], [0, -0.55, -8.8]]},
	up = {from = [0, -8.95], reach = 0.7, floor = -0.72, to = [0, -0.40, -7.18], yaw = PI, time = 3.8, name = "Crawl up to the flight deck",
		path = [[0, -0.42, -8.82], [0, -0.74, -8.45], [0, -0.72, -7.95], [0, -0.55, -7.6], [0, -0.05, -7.5]]},
}

# the tail: shut off from the waist by a bulkhead with a low opening in it (the tail wheel's well
# behind it), and back from there on hands and knees down the narrowing fuselage to the tail gun
static var TAILWAY := {
	z = 5.15, mouth = {x = 0.26, y0 = -1.95, y1 = -1.45},
	# (down on your knees before the opening, under it, and on along the narrowing tail into the gunner's
	# seat: the crawl ends at the gun's eye, player.js startCrawl, so you never stand up under the tail's roof)
	aft = {from = [0, 4.85], floor = -1.95, to = [0, -2.32, 9.6], yaw = PI, time = 5.6, name = "Crawl back to the tail gun", station = "tail",
		path = [[0, -0.8, 4.88], [0, -1.3, 4.93], [0, -1.6, 5.05], [0, -1.68, 5.35], [0, -1.85, 6.2], [0, -1.88, 7.2], [0, -1.95, 8.2], [0, -2.0, 8.9]]},
	# (out through the opening low, and up once your head's clear of it, slowing as you straighten: only part
	# way, the roof's low at the waist's after end; walking on forward you straighten the rest)
	fwd = {from = [0, 9.1], floor = -2.32, to = [0, -1.95, 4.25], yaw = 0.0, time = 5.2, name = "Crawl forward to the waist",
		path = [[0, -1.95, 8.9], [0, -1.95, 8.2], [0, -1.88, 7.2], [0, -1.85, 6.2], [0, -1.68, 5.35], [0, -1.62, 5.0], [0, -1.38, 4.8], [0, -1.08, 4.55]]},
	# (and from anywhere along the tail, up at the bulkhead: back through its opening to the waist)
	back = {from = [0, 5.55], reach = 0.6, floor = -2.15, to = [0, -1.95, 4.25], yaw = 0.0, time = 3.0, name = "Crawl forward through to the waist",
		path = [[0, -1.85, 5.45], [0, -1.7, 5.28], [0, -1.62, 5.0], [0, -1.38, 4.8], [0, -1.08, 4.55]]},
}
## The lowest a turret may aim at yaw (radians off its station's direction): its floor ahead, else its own limit.
static func turret_floor(s: Dictionary, yaw_rel: float) -> float:
	if not s.get("floor"):
		return s.pitch[0]
	var a := absf(atan2(sin(yaw_rel), cos(yaw_rel)))
	var cone: float = s.floor[0] * PI / 180.0
	var k := 1.0 if a < cone * 0.75 else (0.0 if a > cone else (cone - a) / (cone * 0.25))
	return s.pitch[0] + (s.floor[1] * PI / 180.0 - s.pitch[0]) * k
static var PASSAGES: Array = [CRAWLWAY.down, CRAWLWAY.up, TAILWAY.aft, TAILWAY.fwd, TAILWAY.back]

const BULKHEADS := [ # door: [x0, x1, height above floor]
	{z = -6.35, floor = -0.40, door = [-0.32, 0.32, 1.45]},
	{z = -2.6, floor = -1.62, door = [-0.3, 0.3, 1.75]},
	{z = -1.25, floor = -1.80, door = [-0.32, 0.32, 1.65]},
]

## A point fixed to a turret aimed at (yaw, pitch), bomber space: `at` = [right, up, forward] metres from
## its pivot in the turret's own frame. (The guns of the ball and upper turrets, and the ball gunner's eye.)
static func turret_point(pivot, yaw: float, pitch: float, at) -> Vector3:
	var r: float = at[0]
	var u: float = at[1]
	var f: float = at[2]
	var cp := cos(pitch)
	var sp := sin(pitch)
	var sy := sin(yaw)
	var cy := cos(yaw)
	return Vector3(pivot[0] + cy * r + sy * sp * u - sy * cp * f, pivot[1] + cp * u + sp * f, pivot[2] - sy * r + cy * sp * u - cy * cp * f)

# Crew positions. stand = where you press E, eye = view at the position,
# yaw: 0 = forward (-Z), 90 = left, 180 = backwards. guns = node names in b17.glb (as Three names them:
# Godot's are GunBarrel_002 for GunBarrel002, find_node() takes either).
# pivot = what the guns turn about (default: their breech); turret = parts that turn with them.
# twin = a turret's pair of Brownings laid out in its own frame: [out to each side, up, jacket start,
# muzzle, receiver length] (m from the pivot); eye_turret = the gunner's eye fixed in the turret too.
# (Fields in snake_case as the port's names are: yaw_lim, gun_rear, eye_behind, eye_up, round_arc, fin_cut,
# feed_box, eye_turret; `attach` names the Interior field holding the turret's inside.)
static var STATIONS: Array = _stations([
	# the B-17F's nose guns: two hand-held Brownings out through ball sockets in the nose glass, side by
	# side at the same height, left and right of the Norden (the right one the bombardier's). socket = no
	# gun in the model: the gun is built on the ball (pivot) pointing `rest`, its receiver inside, `front`
	# m of jacket out through it
	{id = "noseL", name = "Nose gun, left", stand = [-0.24, -0.72, -9.82], eye = [-0.28, 0.32, -10.5], yaw = 8, yaw_lim = 25, pitch = [-18, 28], guns = [], socket = true,
		ball = true, pivot = [-0.28, 0.1, -11.29], rest = [-0.1392, 0, -0.9903], browning = "flex", front = 0.9, gun_rear = 0.55, eye_behind = 0.82, eye_up = 0.22},
	{id = "noseR", name = "Nose gun, right", stand = [0.24, -0.72, -9.82], eye = [0.28, 0.32, -10.5], yaw = -8, yaw_lim = 25, pitch = [-18, 28], guns = [], socket = true,
		ball = true, pivot = [0.28, 0.1, -11.29], rest = [0.1392, 0, -0.9903], browning = "flex", front = 0.9, gun_rear = 0.55, eye_behind = 0.82, eye_up = 0.22},
	# the radio room gun: a flexible Browning on its mount at the forward end of the hatch in the roof,
	# firing up and aft (fin_cut: [yaw, pitch] the fin and tailplane stand in: aimed within that yaw of
	# dead astern, no lower than that pitch). The radio operator mans it.
	# (its pivot just under the roof, the grips at about head height and above: he holds them with his arms
	# bent, leaning back, his head tipped back to the sight)
	{id = "radio", name = "Radio room gun", stand = [0.15, -1.8, -2.3], eye = [0, -0.21, -2.44], yaw = 180, yaw_lim = 45, pitch = [25, 85], guns = [], socket = true,
		pivot = [0, 0.2, -1.72], rest = [0, 0.7071, 0.7071], browning = "flex", front = 0.9, gun_rear = 0.5, eye_behind = 0.8, eye_up = 0.22, fin_cut = [15, 34]},
	# the Norden bombsight: a telescope looking down-ahead to where the bombs would land (no gun)
	{id = "bombsight", name = "Norden bombsight", stand = [0.32, -0.72, -9.82], eye = [0, -0.42, -11.05], yaw = 0, yaw_lim = 4, pitch = [-4, 4], sight = true,
		hide = ["FrontGunPanels", "NoseCone", "NoseFlat"]}, # looks down through the flat panel in the nose bottom (a telescope: no glass in its view)
	# the cheek guns: a flexible Browning in each nose window on its own mount, as the waist guns are
	{id = "cheekL", name = "Left cheek gun", stand = [-0.35, -0.72, -9.45], eye = [-0.55, 0.1, -10.0], yaw = 70, yaw_lim = 35, pitch = [-35, 30], guns = ["GunBarrel16"], ghost = ["FrontGunPanels"],
		browning = "flex", gun_rear = 0.08, eye_behind = 0.3, eye_up = 0.2, round_arc = true},
	{id = "cheekR", name = "Right cheek gun", stand = [0.35, -0.72, -9.45], eye = [0.55, 0.1, -10.0], yaw = -70, yaw_lim = 35, pitch = [-35, 30], guns = ["GunBarrel002"], ghost = ["FrontGunPanels"],
		browning = "flex", gun_rear = 0.08, eye_behind = 0.3, eye_up = 0.2, round_arc = true},
	{id = "pilot", name = "Pilot seat", stand = [-0.18, -0.40, -7.2], eye = [-0.55, 0.88, -7.72], yaw = 0, yaw_lim = 120, pitch = [-40, 40], seat = true, flies = true},
	{id = "copilot", name = "Co-pilot seat", stand = [0.18, -0.40, -7.2], eye = [0.55, 0.88, -7.72], yaw = 0, yaw_lim = 120, pitch = [-40, 40], seat = true, flies = true},
	{id = "top", name = "Top turret", stand = [0, -0.28, -6.78], eye = [0, 1.4, -6.71], yaw = 0, yaw_lim = 180, pitch = [-5, 85], guns = ["TopGuns"], floor = [55, 9], # (forward of the beam its guns can't come down into the cockpit roof: no lower than 9 degrees within 55 of dead ahead)
		entry = {time = 0.8, path = [[0, 0.85, -6.85]], bob = 0.02, bobs = 1}, # step up onto the platform, head up into the dome
		pivot = [0, 1.43, -6.71], turret = {yaw = ["TopTurret"]}, twin = [0.27, -0.07, 0.12, 0.81, 0.42], # (barrels shortened with the model's: models.js BARREL_K) either side of your head, as in the real one: the receivers by your temples, the barrels out through the dome's slots (topturret.js SLOT_X)
		hide = ["TopTurret"], attach = "top_cockpit"}, # inside, the model's dome is replaced by a glass one (topturret.js)
	{id = "ball", name = "Ball turret", stand = [0, -1.95, 0.6], eye = [0, -2.42, -0.1], yaw = 0, yaw_lim = 180, pitch = [-89, 0], guns = ["GunBarrel004", "GunBarrel14"], # (down from the horizon: up there her belly fills the top of the window)
		entry = {time = 1.2, path = [[0, -1.05, 0.3], [0, -1.75, 0.08], [0, -2.25, -0.02]], bob = 0.015, bobs = 2}, # kneel at the hatch, down into the ball
		pivot = [0, -2.3, -0.13], turret = {full = ["BallTurret"], yaw = ["BallStabilizer1"]}, # (the ball's own centre: it, its guns and its yoke all turn about it, bomber.js rigTurrets the same)
		# the two guns either side of you, out through the ball's sides; you curl up between them, your eye
		# at the window: it all turns and tilts together
		twin = [0.3, -0.15, 0.35, 1.45, 0.45], eye_turret = [0, -0.17, 0.2], whine = true, # (the guns out through the front of the ball, your head between them at the window) // (the guns beside you, as the cockpit draws them: ballturret.js; turned by its motors: player.js drive) // (the guns outside the ball either side, level with your eye, as in the photos)
		# inside, the model's ball is replaced by a glass and steel one that turns with your aim (ballturret.js)
		hide = ["BallTurret", "BallStabilizer1", "BallTurretTracks", "BallCap"], attach = "ball_cockpit"},
	# the waist guns: Brownings on their K-5 type mounts in the open windows, staggered as in the B-17G
	# (the right gun forward, the left aft, so the two gunners aren't quite back to back). Only the jacket
	# and barrel go out of the window: the pivot (the trunnion) is in it, the receiver and grips inside.
	# sill: the window's bottom, where the mount's socket stands; feed: the side the belt comes in (-1 the
	# gun's left); feed_box: the top of its ammunition box (waist.js), where the chute comes out; bag: a
	# canvas bag catches the cases (hackathon/WAIST_SPEC.md)
	{id = "waistL", name = "Left waist gun", stand = [-0.22, -1.95, 2.02], eye = [-0.26, -0.84, 2.02], yaw = 90, yaw_lim = 65, pitch = [-55, 50], guns = ["GunBarrel10"], eye_behind = 0.72, eye_up = 0.22, round_arc = true, # behind the gun, swinging round its mount with it
		browning = "flex", front = 0.92, gun_rear = 0.52, pivot = [-0.98, -1.06, 2.02], rest = [-1, 0, 0], sill = -1.47, feed = -1, bag = true, feed_box = [-0.8, -1.42, 2.42]},
	{id = "waistR", name = "Right waist gun", stand = [0.22, -1.95, 1.58], eye = [0.26, -0.84, 1.58], yaw = -90, yaw_lim = 65, pitch = [-55, 50], guns = ["GunBarrel005"], eye_behind = 0.72, eye_up = 0.22, round_arc = true,
		browning = "flex", front = 0.92, gun_rear = 0.52, pivot = [0.98, -1.06, 1.58], rest = [1, 0, 0], sill = -1.47, feed = 1, bag = true, feed_box = [0.8, -1.42, 1.98]},
	{id = "tail", name = "Tail gun", stand = [0, -2.32, 9.6], eye = [0, -1.55, 10.1], lean = 0.05, duck = 0.3, # (up close behind the rear window: you see where the guns point, up too)
		yaw = 180, yaw_lim = 50, pitch = [-40, 35], round_arc = true, # (wider than the real one's: more fun; the corners cut off by the cab's frames)
		guns = ["GunBarrel007", "GunBarrel12"], # (aimed with the plain crosshair, as the other guns are)
		entry = {time = 1.5, path = [[0, -1.5, 9.66], [0, -1.6, 9.82], [0, -1.58, 9.98]], bob = 0.035, bobs = 3}}, # crawl back under the tail on your knees, up onto the seat (the cab: buildTailCab)
])
static func _stations(list: Array) -> Array:
	var out := []
	for s in list:
		var t: Dictionary = s.duplicate(true)
		t.stand = _v(s.stand)
		t.eye = _v(s.eye)
		t.yaw = s.yaw * D
		t.yaw_lim = s.yaw_lim * D
		t.pitch = [s.pitch[0] * D, s.pitch[1] * D]
		out.append(t)
	return out

static func _v(a) -> Vector3:
	return Vector3(a[0], a[1], a[2])

## A node of b17.glb by the name the web game uses (Three's GunBarrel002 is Godot's GunBarrel_002).
static func find_node(root: Node, name: String) -> Node:
	var n := Models.find(root, name)
	if n == null:
		var re := RegEx.create_from_string("^(.*?)(\\d{3})$")
		var m := re.search(name)
		if m:
			n = Models.find(root, m.get_string(1) + "_" + m.get_string(2))
	return n

# hull cross-section table: half-width of the cabin at (z, y), 10 cm x 5 cm cells
const T := {z0 = -11.4, dz = 0.1, nz = 229, y0 = -2.7, dy = 0.05, ny = 89}

static func measure_hull(meshes: Array, root: Node) -> PackedFloat32Array:
	var hw := PackedFloat32Array()
	hw.resize(T.nz * T.ny)
	hw.fill(INF)
	var cut := []
	for mesh in meshes:
		var m: Transform3D = Models.rel(mesh, root)
		for s in mesh.mesh.get_surface_count():
			var arr: Array = mesh.mesh.surface_get_arrays(s)
			var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var idx = arr[Mesh.ARRAY_INDEX]
			var has_idx: bool = idx != null and idx.size() > 0
			var n: int = idx.size() if has_idx else pos.size()
			for i in range(0, n, 3):
				var a: Vector3 = m * pos[idx[i] if has_idx else i]
				var b: Vector3 = m * pos[idx[i + 1] if has_idx else i + 1]
				var c: Vector3 = m * pos[idx[i + 2] if has_idx else i + 2]
				var k0 := maxi(0, ceili((minf(a.z, minf(b.z, c.z)) - T.z0) / T.dz))
				var k1 := mini(T.nz - 1, floori((maxf(a.z, maxf(b.z, c.z)) - T.z0) / T.dz))
				for k in range(k0, k1 + 1):
					var z: float = T.z0 + k * T.dz
					cut.clear()
					_edge(a, b, z, cut); _edge(b, c, z, cut); _edge(c, a, z, cut)
					if cut.size() < 4:
						continue
					var x1: float = cut[0]
					var y1: float = cut[1]
					var x2: float = cut[2]
					var y2: float = cut[3]
					var r0 := maxi(0, ceili((minf(y1, y2) - T.y0) / T.dy))
					var r1 := mini(T.ny - 1, floori((maxf(y1, y2) - T.y0) / T.dy))
					for r in range(r0, r1 + 1):
						var y: float = T.y0 + r * T.dy
						var x := minf(absf(x1), absf(x2)) if y1 == y2 else x1 + ((x2 - x1) * (y - y1)) / (y2 - y1)
						var j: int = k * T.ny + r
						if x >= 0 and x < hw[j]:
							hw[j] = x
	for j in hw.size():
		if not is_finite(hw[j]):
			hw[j] = 0
	return hw

static func _edge(p: Vector3, q: Vector3, z: float, cut: Array) -> void:
	if (p.z <= z and q.z > z) or (q.z <= z and p.z > z):
		var t := (z - p.z) / (q.z - p.z)
		cut.append(p.x + (q.x - p.x) * t)
		cut.append(p.y + (q.y - p.y) * t)

# ---------- materials ----------
# low envMapIntensity: the sky reflection must not light the cabin as if the hull weren't there
# (Godot: the cabin's indirect light, the sky's reflection with it, is cut to INSIDE_AMBIENT: insideLight)
static func std(color, roughness := 0.8, metalness := 0.1) -> ShaderMaterial:
	return Cabinlook.std({color = color, roughness = roughness, metalness = metalness})
static var _mat: Dictionary = {}
static func materials() -> Dictionary:
	if _mat.is_empty():
		_mat = {
			floor = Cabinlook.planks(std(0x9a8a70, 0.85)), # wooden planks (cabinlook.js)
			metal = std(0x767a70, 0.55, 0.6),
			green = std(0x5d6640, 0.75),
			deck = std(0x34402f, 0.65, 0.15), # (the flight deck's bronze-green paint, as the lining's there: cabinlook.js)
			dark = std(0x232323, 0.6, 0.3),
			well = Cabinlook.std({color = 0x2a2b28, roughness = 0.7, metalness = 0.4, side = Mat.DOUBLE}), # seen from below, from inside
			leather = Cabinlook.leather(std(0x5b3b24, 0.7)),
			bomb = std(0x495031, 0.6, 0.2),
			bombBand = std(0xb8932c, 0.6), # only on the bombs, so the whole load can be hidden after the drop
			bombFuze = std(0x6f6a5e, 0.45, 0.7), # their fuzes, vanes and lugs (hidden with them)
			catwalk = std(0x8b9088, 0.5, 0.6), # the bare aluminium keel beam
			yellow = std(0xb8932c, 0.6),
			radio = std(0x3d3f38, 0.5, 0.4),
			ammo = std(0x4b5230, 0.7, 0.15), # olive drab ammunition boxes
			chute = std(0x4d5048, 0.6, 0.55), # flexible steel feed chutes
			hose = std(0x161616, 0.85, 0.0), # rubber oxygen hoses
			cable = std(0x2a2a28, 0.4, 0.8),
			red = std(0x8a1c14, 0.5, 0.2),
			pad = Cabinlook.std({map = quilt_texture(), roughness = 0.95}), # quilted insulation
			canvas = Cabinlook.leather(std(0x6b5f47, 0.95)), # the tail guns' canvas boot
		}
	return _mat

# ---- the lining: interior paint, cut out where the outer skin has windows; worn: blotchy, scuffed through
# to bare aluminium here and there (noise from the position, so no extra texture)
static var _lining_shaders := {}
static func _lining_code(cull: String, kinds: Array) -> String:
	var cuts := ""
	for k in kinds:
		cuts += _cut_code(k)
	return "shader_type spatial;\nrender_mode cull_%s;\n" % cull + Cabinlook.HULL_PAINT_UNIFORMS + _CUT_DECL + """
uniform sampler2D map : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform float inside = 0.3;
uniform vec4 hits[32];
uniform float scar_on = 1.0;
uniform float hole_light = 1.0;
""" + Cabinlook.NOISE + Cabinlook.HULL_RELIEF + """
void vertex() {
	v_cab_p = (to_bomber * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
""" + cuts + """
	// windows only: the paint's alpha is speckled, and a lone speck cut through let the sky show
	// through the wall in white flecks. Cut where the texels round about are see-through too.
	// (the full-size texture, not a mip level: as windowCutout's, so the window's edge is the skin's)
	vec2 o = vec2(0.003, 0.0);
	float aa = max(max(textureLod(map, UV, 0.0).a, max(textureLod(map, UV + o, 0.0).a, textureLod(map, UV - o, 0.0).a)), max(textureLod(map, UV + o.yx, 0.0).a, textureLod(map, UV - o.yx, 0.0).a));
	if (aa < 0.95) discard;
	// the opening up into the top turret: the roof is cut away round its ring (bomber space)
	vec3 pb = v_cab_p;
	if (pb.y > %.2f && length(pb.xz - vec2(0.0, %.2f)) < %.2f) discard;
	vec3 col = vec3(0.0);
	float rough = 0.75;
	float blotch = n3(pb * 2.3) * 0.6 + n3(pb * 9.0) * 0.4;
	float worn = smoothstep(0.8, 0.92, n3(pb * 5.0 + 3.1) * 0.8 + n3(pb * 23.0) * 0.2);
""" % [TURRET_CUT.y, TURRET_CUT.z, TURRET_CUT.r] + (Cabinlook.HULL_PAINT % "pb") + """
	col *= 0.9 + 0.14 * blotch; // (a little: blotchy paint looks like camouflage)
	col = mix(col, vec3(0.5, 0.51, 0.48), worn * 0.35); // scuffed through to the metal (subtle: bright patches read as holes)
	// the holes the rounds and shrapnel have punched through (scars.js keeps the list): the skin torn
	// inward round each, bare metal, and daylight through the hole
	vec3 glow = vec3(0.0);
	if (scar_on > 0.5) {
		for (int i = 0; i < 32; i++) {
			vec4 h = hits[i];
			if (h.w <= 0.0) continue;
			float l = length(pb - h.xyz);
			if (l > h.w * 2.5) continue;
			float rag = n3(pb * 80.0) * 0.6 + n3(pb * 21.0) * 0.4;
			float hole = 1.0 - smoothstep(h.w * (0.2 + 0.15 * rag), h.w * (0.28 + 0.15 * rag), l);
			float petal = (1.0 - smoothstep(h.w * 0.3, h.w * (0.6 + 0.5 * rag), l)) * (1.0 - hole);
			col = mix(col, vec3(0.5, 0.51, 0.49), petal * 0.65);
			col *= 1.0 - hole;
			glow += vec3(1.0, 0.97, 0.9) * hole * hole_light * 2.5;
		}
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = 0.3;
	EMISSION = glow;
""" + Cabinlook.HULL_PAINT_NORMAL + """
	AO = inside;
	AO_LIGHT_AFFECT = 0.0;
}
"""

static func lining_material(outer: Material, inverted: bool, to_bomber: Transform3D, kinds: Array) -> ShaderMaterial:
	var cull := "front" if not inverted else "back" # (BackSide: from inside; a mesh modelled inside out, FrontSide)
	var key := cull + "|" + ",".join(kinds)
	if not _lining_shaders.has(key):
		var sh := Shader.new()
		sh.code = _lining_code(cull, kinds)
		_lining_shaders[key] = sh
	var m := ShaderMaterial.new()
	m.shader = _lining_shaders[key]
	var map = null
	if outer is ShaderMaterial:
		map = outer.get_shader_parameter("tex_albedo")
	elif outer is BaseMaterial3D:
		map = outer.albedo_texture
	if map:
		m.set_shader_parameter("map", map)
	Cabinlook.hull_paint_params(m)
	m.set_shader_parameter("to_bomber", Projection(to_bomber))
	m.set_shader_parameter("cabin", CABIN)
	m.set_meta("inside", true)
	_cabin_mats.append(weakref(m))
	Scars.register(m) # (the holes the rounds have punched through: scars.gd keeps it up to date)
	if "waistwin" in kinds:
		_waist_mats.append(weakref(m))
	return m
## Copy of the mesh without the end caps: triangles beyond z_front / z_back (bomber space) facing along Z.
static func open_ends(mesh: Mesh, to_bomber: Transform3D, z_front: float, z_back: float) -> ArrayMesh:
	var out := ArrayMesh.new()
	for s in mesh.get_surface_count():
		var arr: Array = mesh.surface_get_arrays(s)
		var p: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var idx = arr[Mesh.ARRAY_INDEX]
		if idx != null and idx.size() > 0:
			var keep := PackedInt32Array()
			for i in range(0, idx.size(), 3):
				var a: Vector3 = p[idx[i]]
				var b: Vector3 = p[idx[i + 1]]
				var c: Vector3 = p[idx[i + 2]]
				var z: float = (to_bomber * ((a + b + c) / 3.0)).z
				var n := (b - a).cross(c - a).normalized()
				if (z < z_front or z > z_back) and absf(n.z) > 0.6:
					continue
				keep.append_array([idx[i], idx[i + 1], idx[i + 2]])
			arr[Mesh.ARRAY_INDEX] = keep
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		out.surface_set_material(s, mesh.surface_get_material(s))
	return out

## True if most normals point towards the middle of the mesh instead of away from it.
static func faces_inward(mesh: Mesh) -> bool:
	var s := 0.0
	var p := PackedVector3Array()
	var n := PackedVector3Array()
	for i in mesh.get_surface_count():
		var arr: Array = mesh.surface_get_arrays(i)
		p.append_array(arr[Mesh.ARRAY_VERTEX])
		if arr[Mesh.ARRAY_NORMAL] == null:
			return false
		n.append_array(arr[Mesh.ARRAY_NORMAL])
	var c := mesh.get_aabb().get_center()
	for i in p.size():
		s += n[i].dot(p[i] - c)
	return s < 0

static func quilt_texture() -> Texture2D:
	var g := Canvas2D.new(128, 128)
	g.fill_style = "#5e5a44"; g.fill_rect(0, 0, 128, 128)
	g.stroke_style = "rgba(30,28,20,0.55)"; g.line_width = 2
	for k in range(-128, 256, 32): # diamond stitching
		g.begin_path(); g.move_to(k, 0); g.line_to(k + 128, 128); g.stroke()
		g.begin_path(); g.move_to(k + 128, 0); g.line_to(k, 128); g.stroke()
	return g.texture(true)

## Plexiglas: clear, but you can tell it's there. Faint where you look straight through it, brighter and
## reflecting the sky towards grazing angles, fine scratches that catch the light, and a little grime
## gathered towards the edges of the window. (And drops on it in the rain: environment.gd's `wet`.)
static func plexiglas(holes: Texture2D = null, side: int = Mat.DOUBLE, base: float = 0.13) -> ShaderMaterial:
	return plexiglas_base(holes, side, base)
static var _glass_shaders := {}
static func plexiglas_base(holes: Texture2D, side: int, base: float) -> ShaderMaterial:
	Environment_.globals()
	var key := "%s|%d|%.3f" % [holes != null, side, base]
	if not _glass_shaders.has(key):
		var sh := Shader.new()
		# (premultiplied: the sky's reflection is added on top at full strength, stronger towards grazing
		# angles, as the web game adds it divided by the glass's alpha, so the glass shows)
		sh.code = "shader_type spatial;\nrender_mode blend_premul_alpha, depth_draw_never, cull_%s;\n" % ["back", "front", "disabled"][side] + """
global uniform float wet;
uniform sampler2D map : source_color, hint_default_white, filter_linear_mipmap;
varying vec3 vGP;
varying vec2 vGUv;
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
void vertex() { vGP = VERTEX; vGUv = UV; }
void fragment() {
""" + ("""	// holes: the skin's paint texture; the glass is only drawn in its windows (see windowCutout)
	vec2 ho = vec2(0.003, 0.0);
	float ha = max(max(texture(map, UV).a, max(texture(map, UV + ho).a, texture(map, UV - ho).a)), max(texture(map, UV + ho.yx).a, texture(map, UV - ho.yx).a));
	if (ha >= 0.95) discard;
""" if holes else "") + """
	vec3 vd = normalize(-VERTEX);
	float fres = pow(1.0 - abs(dot(normalize(NORMAL), vd)), 4.0);
	// fine scratches: long thin streaks in two directions, only some catch the light
	vec2 q = vGP.xy * 38.0 + vGP.zz * 21.0;
	float sc = smoothstep(0.985, 1.0, gn(vec2(q.x * 0.08, q.y * 3.0))) + smoothstep(0.988, 1.0, gn(vec2(q.x * 2.6 + q.y, q.y * 0.07)));
	// grime towards the window's edges, and a faint mottle all over
	float edge = %s;
	float grime = edge * (0.5 + 0.5 * gn(vGP.xy * 18.0)) * 0.12 + gn(vGP.xz * 60.0) * 0.012;
	// (thin: in a dim light a denser glass drew as dark slabs over the sky)
	float ga = clamp(%.3f + fres * 0.16 + sc * 0.5 + grime, 0.0, 0.34);
	vec3 col = mix(vec3(0.788, 0.847, 0.812), vec3(0.32, 0.31, 0.27), clamp(grime / max(ga, 0.01), 0.0, 1.0));
	float drops = 0.0;
	if (wet > 0.0) {
		for (int k = 0; k < 2; k++) { // two sizes of bead
			vec3 wp = vGP * (k == 0 ? 24.0 : 55.0);
			vec3 cell = floor(wp), fr = fract(wp);
			float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
			vec3 cc = vec3(fract(h * 7.13), fract(h * 3.71), fract(h * 5.37)) * 0.6 + 0.2;
			float r = (0.09 + 0.11 * fract(h * 11.0));
			drops = max(drops, step(1.0 - wet * 0.4, h) * smoothstep(r, r * 0.5, length(fr - cc)));
		}
		ga = max(ga, drops * 0.28);
	}
	ALBEDO = col * ga * (1.0 + drops * 0.8);
	ALPHA = ga;
	ROUGHNESS = 0.04;
	METALLIC = 0.0;
	SPECULAR = 0.5 + 0.5 * fres;
}
""" % ["0.25" if holes else "1.0 - smoothstep(0.0, 0.22, min(min(vGUv.x, 1.0 - vGUv.x), min(vGUv.y, 1.0 - vGUv.y)))", base]
		_glass_shaders[key] = sh
	var m := ShaderMaterial.new()
	m.shader = _glass_shaders[key]
	if holes:
		m.set_shader_parameter("map", holes)
	m.set_meta("outside", true) # (it reflects the open sky: not darkened like the cabin)
	m.set_meta("transparent", true)
	return m

## A stencilled marking: white or yellow letters on a transparent plate.
static func stencil_texture(lines: Array, colour: String = "#e8e2c8") -> Texture2D:
	var g := Canvas2D.new(256, 64 * lines.size())
	g.fill_style = colour; g.font = 'bold 44px "Courier New", monospace'; g.text_align = "center"; g.text_baseline = "middle"
	for i in lines.size():
		g.fill_text(lines[i], 128, 32 + i * 64, 248)
	return g.texture(true)

## Remove zero-area triangles (non-indexed geometry). Filling an outline whose wall runs straight puts
## several points in a line, and the triangulation then makes slivers with no area, so they have no
## normal: lighting them gives NaN, and the bloom pass spread that one pixel into a black screen.
static func drop_degenerate(geo):
	var pos: PackedVector3Array = geo.positions
	var keep := PackedInt32Array()
	for t in range(0, pos.size(), 3):
		var a := pos[t]
		if (pos[t + 2] - a).cross(pos[t + 1] - a).length_squared() > 1e-12:
			keep.append(t)
	if keep.size() * 3 != pos.size():
		var out = Geo.new()
		for t in keep:
			for v in 3:
				out.positions.append(pos[t + v])
				if not geo.normals.is_empty(): out.normals.append(geo.normals[t + v])
				if not geo.uvs.is_empty(): out.uvs.append(geo.uvs[t + v])
		for s in 4:
			var k: int = geo.custom_size[s]
			if k == 0:
				continue
			var src: PackedFloat32Array = geo.custom[s]
			var dst := PackedFloat32Array()
			for t in keep:
				for v in 3:
					for c in k:
						dst.append(src[(t + v) * k + c])
			out.custom[s] = dst
			out.custom_size[s] = k
		geo = out
	# any normal still zero-length (a vertex averaged from opposite faces) points up instead of NaN
	for i in geo.normals.size():
		if geo.normals[i].length() < 1e-6:
			geo.normals[i] = Vector3.UP
	return geo

# ---- Three's geometry constructors tagged with their type (Interior.add reads it for the worn edges)
static func box_geo(w: float, h: float, d: float):
	var g = Geo.box(w, h, d)
	g.set_meta("type", "box")
	return g
static func cyl_geo(rt: float, rb: float, h: float, seg: int = 32, hseg: int = 1, open: bool = false, ts: float = 0.0, tl: float = TAU):
	var g = Geo.cylinder(rt, rb, h, seg, hseg, open, ts, tl)
	g.set_meta("type", "cyl")
	return g

## Three's Quaternion.setFromUnitVectors.
static func from_to(a: Vector3, b: Vector3) -> Quaternion:
	var r := a.dot(b) + 1.0
	var x: float; var y: float; var z: float; var w: float
	if r < 1e-8:
		r = 0.0
		if absf(a.x) > absf(a.z):
			x = -a.y; y = a.x; z = 0.0; w = r
		else:
			x = 0.0; y = -a.z; z = a.y; w = r
	else:
		x = a.y * b.z - a.z * b.y; y = a.z * b.x - a.x * b.z; z = a.x * b.y - a.y * b.x; w = r
	return Quaternion(x, y, z, w).normalized()

## A MeshInstance3D of geo, added to `parent` (Three's new Mesh(geo, mat); castShadow off as Three's default).
static func mesh_of(geo, mat: Material, parent: Node = null, name := "") -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = geo.to_mesh(mat)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if name != "":
		m.name = name
	if parent:
		parent.add_child(m)
	return m

# ---------- the interior ----------
## A box collider (Three's Box3): min and max in bomber space.
class Box:
	var min: Vector3
	var max: Vector3
	var walk_only := false
	func _init(a: Vector3, b: Vector3) -> void:
		min = a
		max = b

var model: Node3D
var table: PackedFloat32Array
var hull_meshes: Array = []
var boxes: Array = []
var people: Array = [] # the crew standing or sitting about: you brush past them (Player), not through (Crew keeps it up to date)
var group: Node3D
var geos := {} # material -> geometries to merge
var _geo_mats: Array = [] # (the materials in the order first used: the meshes come out in that order)
var stations: Array
var parts := {} # name -> [outer mesh, lining] so stations can hide what blocks the view
var bomb_meshes: Array = []
var frame_zs := {}
var waist_parts := {}
var nose_cone := {}
var ball_cockpit: Node3D
var top_cockpit: Node3D
var top_dome: Node3D
var shafts: Array = []
var night_lights: Array = []
var cockpit_night: Callable # (cockpitb17.gd sets it: the instruments' radium figures glow)
var cockpit_live: Callable # (cockpitb17.gd sets it: its needles and controls each frame)
var shell_shown = null
var MAT: Dictionary

func _init(model_: Node3D) -> void:
	model = model_
	MAT = materials()
	var hull := []
	for o in model.find_children("*", "MeshInstance3D", true, false):
		if o.name in HULL:
			hull.append(o)
	table = measure_hull(hull, model)
	hull_meshes = hull
	group = Node3D.new()
	group.name = "Interior"
	stations = STATIONS

	line_hull(hull)
	set_hidden(["SideGunPanels"], true) # (the model's waist window panels: the windows are open holes, waist.js)
	build_ribs()
	build_floors()
	build_bulkheads()
	build_nose()
	build_cockpit()
	build_bomb_bay()
	build_radio_room()
	build_waist()
	build_tail()
	cut_tailplanes(model)
	build_details()
	InteriorDetail.add_more_detail(self, MAT, DECKS)
	Waist.build_waist_section(self, MAT) # the waist's windows, ammunition, structure, oxygen and interphone (waist.js)

	bomb_meshes = []
	for mat in _geo_mats:
		var list: Array = geos[mat]
		var mesh := MeshInstance3D.new()
		mesh.mesh = Geo.merge(list).to_mesh(mat)
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if mat != MAT.floor else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF # (the floor's planks would shade themselves: no window light on them)
		group.add_child(mesh)
		if mat == MAT.bomb or mat == MAT.bombBand or mat == MAT.bombFuze:
			bomb_meshes.append(mesh)
		# grime and worn edges on the boxes, cans, bottles, radio sets and seats (not the floor, glass, lamps)
		if mat != MAT.floor and not Cabinlook.is_transparent(mat) and not _emissive(mat):
			mesh.mesh.surface_set_material(0, Cabinlook.prop_wear(mat))
	# the cabin is dark inside: the sun through the windows lights it, not the sky (cabinlook.js)
	for o in group.find_children("*", "GeometryInstance3D", true, false):
		if o is MeshInstance3D:
			for i in o.mesh.get_surface_count():
				Cabinlook.inside_light(Models.surface_material(o, i))
		if o.material_override:
			Cabinlook.inside_light(o.material_override)
	for k in parts:
		var p: Array = parts[k]
		if p.size() > 1 and p[1].material_override:
			Cabinlook.inside_light(p[1].material_override)

static func _emissive(m: Material) -> bool:
	if m is ShaderMaterial:
		var e = m.get_shader_parameter("emission_energy")
		var c = m.get_shader_parameter("emission")
		return e != null and float(e) > 0 and c is Color and c != Color.BLACK
	if m is BaseMaterial3D:
		return m.emission_enabled
	return false

## Bombs away: the racks are empty (or full again, for a fresh bomber).
func empty_bomb_bay(empty := true) -> void:
	for m in bomb_meshes:
		m.visible = not empty

# ----- helpers -----
func hw(z: float, y: float) -> float:
	var k := roundi((z - T.z0) / T.dz)
	var r := roundi((y - T.y0) / T.dy)
	return 0.0 if k < 0 or k >= T.nz or r < 0 or r >= T.ny else table[k * T.ny + r]

func _cell(k: int, r: int) -> float:
	return 0.0 if k < 0 or k >= T.nz or r < 0 or r >= T.ny else table[k * T.ny + r]

## Half-width blended between table cells, so walls and ceilings are smooth to walk along.
func hw_smooth(z: float, y: float) -> float:
	var fz: float = (z - T.z0) / T.dz
	var fy: float = (y - T.y0) / T.dy
	var k := floori(fz)
	var r := floori(fy)
	var tz := fz - k
	var ty := fy - r
	# (the table has no open cells left, measure_hull: the blend is plain)
	return lerpf(lerpf(_cell(k, r), _cell(k + 1, r), tz), lerpf(_cell(k, r + 1), _cell(k + 1, r + 1), tz), ty)

## Narrowest half-width of the cabin between heights y0 and y1 at z.
func wall_limit(z: float, y0: float, y1: float) -> float:
	var m := INF
	var y := y0
	while y <= y1 + 1e-6:
		m = minf(m, hw_smooth(z, y))
		y += T.dy
	return minf(m, hw_smooth(z, y1))

## First height above y0 where the hull is too narrow for a head at x.
func ceiling_at(z: float, x: float, y0: float) -> float:
	var top: float = T.y0 + T.ny * T.dy
	var need := absf(x) + 0.15 # 0.15 = half a head; the thin tail fin is not headroom
	var y := y0
	var prev := hw_smooth(z, y) - need
	if prev < 0:
		return y
	while y < top:
		var g := hw_smooth(z, y + T.dy) - need
		if g < 0:
			return y + (T.dy * prev / (prev - g) if is_finite(prev) else 0.0) # where the wall crosses
		prev = g
		y += T.dy
	return y

## Highest box top under (x, z) that is no higher than max_y.
func floor_at(x: float, z: float, max_y: float) -> float:
	var best := -INF
	for b in boxes:
		if x >= b.min.x and x <= b.max.x and z >= b.min.z and z <= b.max.z and b.max.y <= max_y and b.max.y > best:
			best = b.max.y
	return best

## Does a vertical cylinder (radius r, from y0 to y1) at (x, z) hit any box?
func blocked(x: float, z: float, r: float, y0: float, y1: float) -> bool:
	for b in boxes:
		if b.max.y <= y0 or b.min.y >= y1:
			continue
		var cx := clampf(x, b.min.x, b.max.x)
		var cz := clampf(z, b.min.z, b.max.z)
		if (x - cx) ** 2 + (z - cz) ** 2 < r * r:
			return true
	return false

## Pushes a circle (radius r, centre p.x/p.z) out of every box between heights y0 and y1, so you slide round
## corners. (Vector3 is a value in GDScript: returns the moved point.)
func push_out(p: Vector3, r: float, y0: float, y1: float) -> Vector3:
	for pass_ in 3:
		var moved := false
		for b in boxes:
			if b.max.y <= y0 or b.min.y >= y1:
				continue
			var dx := p.x - clampf(p.x, b.min.x, b.max.x)
			var dz := p.z - clampf(p.z, b.min.z, b.max.z)
			var d2 := dx * dx + dz * dz
			if d2 >= r * r:
				continue
			if d2 > 1e-10:
				var k := (r - sqrt(d2)) / sqrt(d2)
				p.x += dx * k
				p.z += dz * k
			else: # centre inside the box: leave through the nearest side
				var out := [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z]
				var i := out.find(out.min())
				if i == 0: p.x = b.min.x - r
				elif i == 1: p.x = b.max.x + r
				elif i == 2: p.z = b.min.z - r
				else: p.z = b.max.z + r
			moved = true
		if not moved:
			break
	return p

## The roof over (x, z) above y0: the hull's, or anything solid lower down (the deck under the windscreen).
func roof_at(z: float, x: float, y0: float) -> float:
	var c := ceiling_at(z, x, y0)
	for b in boxes:
		if not b.walk_only and b.min.y > y0 and b.min.y < c and x > b.min.x - 0.1 and x < b.max.x + 0.1 and z > b.min.z - 0.1 and z < b.max.z + 0.1:
			c = b.min.y
	return c

## Free height above the feet at (x, z): hull ceiling or the underside of a box overhead.
func headroom(x: float, z: float, feet: float, r: float, step: float) -> float:
	var c := ceiling_at(z, x, feet + 0.3)
	for b in boxes:
		if b.min.y < feet + step:
			continue
		var cx := clampf(x, b.min.x, b.max.x)
		var cz := clampf(z, b.min.z, b.max.z)
		if (x - cx) ** 2 + (z - cz) ** 2 < r * r:
			c = minf(c, b.min.y)
	return c - feet

func zone_at(z: float) -> String:
	if z >= -6.35 and z < -5.6:
		return "Bomb bay"
	for d in DECKS:
		if z >= d.z0 and z < d.z1:
			return d.name
	return ""

func nearest_station(feet: Vector3, max_dist := 1.1):
	var best = null
	var bd := max_dist
	for s in stations:
		if absf(feet.y - s.stand.y) > 0.7 or s.get("sight", false):
			continue # (the bombsight has its own key, B)
		var d := Vector2(feet.x - s.stand.x, feet.z - s.stand.z).length()
		if d < bd:
			bd = d
			best = s
	return best

## Adds a box: `mat` draws it (null = invisible), `solid` makes it a collider.
func box(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat, solid := true) -> void:
	if solid:
		boxes.append(Box.new(Vector3(x0, y0, z0), Vector3(x1, y1, z1)))
	if mat:
		add(mat, box_geo(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))

func add(mat: Material, geo) -> void:
	if not geos.has(mat):
		geos[mat] = []
		_geo_mats.append(mat)
	# which of its UVs run to an edge, for the worn edges (cabinlook.js propWear): a box's both ways
	# round each face, a can's or bottle's only top and bottom
	var type: String = geo.get_meta("type", "") if geo.has_meta("type") else ""
	var edge := [1.0, 1.0] if type == "box" else ([0.0, 1.0] if type == "cyl" else [0.0, 0.0])
	var g = geo.to_non_indexed() if not geo.indices.is_empty() else geo
	if g.normals.is_empty():
		g.compute_vertex_normals()
	var n: int = g.positions.size()
	var e := PackedFloat32Array()
	e.resize(n * 2)
	for i in n:
		e[i * 2] = edge[0]
		e[i * 2 + 1] = edge[1]
	g.set_custom(0, e, 2)
	if g.uvs.is_empty():
		var z := PackedVector2Array()
		z.resize(n)
		g.uvs = z
	g.colors = PackedColorArray() # (no vertex colours in the cabin's fittings: all merge alike)
	for s in [1, 2, 3]:
		g.custom[s] = PackedFloat32Array()
		g.custom_size[s] = 0
	geos[mat].append(drop_degenerate(g)) # extrusions are non-indexed

func cylinder(r: float, len: float, x: float, y: float, z: float, axis: String, mat: Material, seg := 14) -> void:
	var g = cyl_geo(r, r, len, seg)
	if axis == "z": g.rotate_x(PI / 2)
	if axis == "x": g.rotate_z(PI / 2)
	add(mat, g.translate(x, y, z))

# ----- parts -----
func line_hull(hull: Array) -> void:
	parts = {}
	for mesh in hull:
		var src: Material = Models.surface_material(mesh, 0)
		if src and src.has_meta("glass"):
			continue # glass needs no lining
		var to_b: Transform3D = Models.rel(mesh, model) # (bomber space: the web game used the mesh's own position)
		# the fuselage is closed with painted caps behind the nose glass and in front of the tail pod:
		# open them up (in this bomber only) so the bombardier and tail gunner can see out
		if mesh.name == "MainFuselage2":
			mesh.mesh = open_ends(mesh.mesh, to_b, -10.5, 10.1)
		parts[String(mesh.name)] = [mesh]
		# some parts (e.g. the nose glass) were modelled with their faces pointing inwards
		var inverted := faces_inward(mesh.mesh)
		var kinds := []
		# the top turret isn't cabin: no lining (from below you look up through its ring into the glass
		# dome, see buildTopDome), and its floor under the ring is cut away, so it doesn't shut the opening
		if mesh.name == "TopTurret":
			kinds = ["below"]
		else:
			if mesh.name == "MainFuselage2" or mesh.name == "Tail":
				kinds.append("tailcab") # (the gunner's cab: buildTailCab)
			kinds.append("radiohatch") # (and the radio room's gun hatch, open to the sky)
			if mesh.name == "MainFuselage2":
				kinds.append("waistwin") # (and the waist windows, wide open)
		# the outside skin no longer hides the cabin: drawn front faces only (inverted: back faces)
		var base := Models.skin(src, ["CULL_BACK"]) if not inverted else Models.skin(src, [])
		var outer := cut_skin(base, kinds, to_b)
		if inverted:
			outer = _cull(outer, "cull_front")
		if mesh.name == "TopTurret":
			outer.set_shader_parameter("cut_y", TURRET_CUT.ring)
		for i in mesh.mesh.get_surface_count():
			mesh.set_surface_override_material(i, outer)
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED # (one-sided, its shadow would be the belly's alone: the roof and its windows must cast)
		if mesh.name == "TopTurret":
			continue
		var lining := MeshInstance3D.new()
		lining.mesh = mesh.mesh
		lining.material_override = lining_material(src, inverted, to_b, kinds)
		lining.name = "%s_lining" % mesh.name
		lining.transform = mesh.transform
		lining.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF # (the skin's shadow has the window cut-outs; a second one wouldn't)
		lining.set_meta("noShadow", true)
		mesh.get_parent().add_child(lining)
		parts[String(mesh.name)].append(lining)

## The same material drawn with another cull mode (its shader's render_mode changed).
static var _cull_shaders := {}
static func _cull(m: ShaderMaterial, mode: String) -> ShaderMaterial:
	var key := "%d|%s" % [m.shader.get_instance_id(), mode]
	if not _cull_shaders.has(key):
		var re := RegEx.create_from_string("cull_(back|front|disabled)")
		var sh := Shader.new()
		sh.code = re.sub(m.shader.code, mode, true)
		_cull_shaders[key] = sh
	m.shader = _cull_shaders[key]
	return m

## Cut a waist window ('L' or 'R') wide while you're at its gun, or back to the model's own size (waist.js).
func set_waist_wide(side: String, on: bool) -> void:
	if not WAIST_WIDE.has(side):
		return
	WAIST_WIDE[side] = 1.0 if on else 0.0
	var pname := "wide_l" if side == "L" else "wide_r"
	_each(_waist_mats, func(m): m.set_shader_parameter(pname, WAIST_WIDE[side]))
	var p = waist_parts.get(side)
	if p:
		p.wide.visible = on
		p.small.visible = not on

## Seen from outside, the cabin not drawn (the third-person view from the pilots' seats): the model's own tail
## gun pod and nose glazing back in their places (the cabin's own replace them, and go with it), and no cuts in
## her skin for the cabin's parts.
func model_shell(on: bool) -> void:
	if shell_shown == on:
		return
	shell_shown = on
	CABIN = 0.0 if on else 1.0
	_each(_cabin_mats, func(m): m.set_shader_parameter("cabin", CABIN))
	for m in parts.get("TailGunPod", []):
		if not group.is_ancestor_of(m):
			m.visible = on # (its lining is the cabin's)
	var nose := Models.find(model, "Nose")
	if nose:
		nose.visible = on

## Hide (or show again) hull parts by name, e.g. the painted tail cap while at the tail gun.
func set_hidden(names: Array, hidden: bool) -> void:
	for n in names:
		var list: Array = parts.get(n, [])
		if list.is_empty():
			var o := find_node(model, n)
			if o == null:
				o = group.find_child(n, true, false)
			list = [o]
		for m in list:
			if m:
				m.visible = not hidden

static var _ghosts := {}
static func ghost_of(m: Material) -> Material:
	if not _ghosts.has(m):
		var map = null
		if m is ShaderMaterial:
			map = m.get_shader_parameter("tex_albedo")
		elif m is BaseMaterial3D:
			map = m.albedo_texture
		var g := Mat.standard({map = map, color = 0xb8c8d0, roughness = 0.15, metalness = 0.2, transparent = true, opacity = 0.16,
			depthWrite = false, side = Mat.DOUBLE})
		_ghosts[m] = g
	return _ghosts[m]

## Turret shells turn to faint glass while you're in them, so the frame never blocks the view.
func set_ghost(names: Array, on: bool) -> void:
	for n in names:
		var p: Array = parts.get(n, [find_node(model, n)])
		var outer = p[0]
		var lining = p[1] if p.size() > 1 else null
		if lining:
			lining.visible = not on
		if outer == null:
			continue
		var list: Array = outer.find_children("*", "MeshInstance3D", true, false)
		if outer is MeshInstance3D:
			list.push_front(outer)
		for o in list:
			if on and not o.has_meta("solid"):
				var solid := []
				for i in o.mesh.get_surface_count():
					var sm: Material = Models.surface_material(o, i)
					solid.append(sm)
					o.set_surface_override_material(i, ghost_of(sm))
				o.set_meta("solid", solid)
				o.set_meta("solid_shadow", o.cast_shadow)
				o.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			elif not on and o.has_meta("solid"):
				var solid: Array = o.get_meta("solid")
				for i in solid.size():
					o.set_surface_override_material(i, solid[i])
				o.cast_shadow = o.get_meta("solid_shadow")
				o.remove_meta("solid")

func build_floors() -> void:
	for d in DECKS:
		box(-d.hw, d.hw, d.y - 0.1, d.y, d.z0, d.z1, null)
		if d.name == "Bomb bay":
			continue # (its catwalk is a metal beam: buildBombBay)
		var z: float = d.z0
		while z < d.z1 - 0.01: # planks follow the hull's width
			var z1 := minf(z + 0.25, d.z1)
			var w := minf(d.hw, hw((z + z1) / 2, d.y + 0.06) - 0.01)
			var h: Dictionary = CRAWLWAY.hatch
			if d.name == "Cockpit" and z < h.z1 and z1 > h.z0: # (the hatch: the planks either side of it)
				for s in [-1, 1]:
					if w > h.x1:
						add(MAT.floor, box_geo(w - h.x1, 0.04, z1 - z - 0.01).translate(s * (w + h.x1) / 2, d.y - 0.02, (z + z1) / 2))
				z += 0.25
				continue
			if w > 0.05:
				add(MAT.floor, box_geo(w * 2, 0.04, z1 - z - 0.01).translate(0, d.y - 0.02, (z + z1) / 2))
			z += 0.25
	for s in STEPS:
		box(-0.3, 0.3, -2.0, s.y, s.z0, s.z1, MAT.floor)

## Cabin outline at z (shrunk by `inset`), as points going round: [lo, hi, points].
func outline(z: float, mid: float, inset: float, max_y := INF) -> Array:
	var lo := mid
	var hi := mid
	while hw(z, lo - 0.05) > 0.08 + inset and lo > T.y0:
		lo -= 0.05
	while hw(z, hi + 0.05) > 0.08 + inset and hi < T.y0 + T.ny * T.dy and hi + 0.05 <= max_y:
		hi += 0.05
	var pts := []
	var y := lo
	while y <= hi + 1e-6:
		pts.append(Vector2(hw(z, y) - inset, y))
		y += 0.05
	y = hi
	while y >= lo - 1e-6:
		pts.append(Vector2(-(hw(z, y) - inset), y))
		y -= 0.05
	return [lo, hi, pts]

func build_ribs() -> void:
	# fuselage frames every 50 cm from the radio room to the tail, following the hull's shape
	# (the waist windows sit between two frames: those run either side of them, not across them)
	var W: Dictionary = Waist.WAIST_WINDOW
	var zs := []
	var z := -2.5
	while z < 9.5:
		zs.append(null if (z > W.z0 - 0.25 and z < W.z1 - 0.05) or (z > RADIO_HATCH.z0 and z < RADIO_HATCH.z1) else z) # (none across the radio room's gun hatch either)
		z += 0.5
	frame_zs = {}
	for x in zs:
		if x != null:
			frame_zs[x] = true # (where there's a frame: interiordetail.js puts its rivets only there, none in mid air across a window)
	for fz in zs.filter(func(x): return x != null) + [W.z0 - 0.04]: # (and one just forward of the waist windows: the one aft of them is a regular frame)
		var deck = _deck_at(fz)
		if deck == null:
			continue
		var outer: Array = outline(fz, deck.y + 0.3, 0.01)[2]
		var inner: Array = outline(fz, deck.y + 0.3, 0.07)[2]
		if outer.size() < 8 or inner.size() < 8:
			continue
		var shape := Shapes.Shape.new(outer)
		shape.holes.append(Shapes.Path.new(inner))
		# lightening holes punched through the web, every 15 cm or so round the frame
		var mid: Array = outline(fz, deck.y + 0.3, 0.04)[2]
		var last = null
		for p in mid:
			if p.y < deck.y + 0.08 or (last != null and last.distance_to(p) < 0.15):
				continue
			shape.holes.append(Shapes.Path.new().absarc(p.x, p.y, 0.014, 0, PI * 2, true))
			last = p
		add(MAT.metal, Geo.extrude(shape, {depth = 0.012, bevelEnabled = false, curveSegments = 6}).translate(0, 0, fz))
		# the inner flange: the frame is a channel, its edge turned over
		var lip: Array = outline(fz, deck.y + 0.3, 0.062)[2]
		if lip.size() >= 8:
			var flange := Shapes.Shape.new(lip)
			flange.holes.append(Shapes.Path.new(inner))
			add(MAT.metal, Geo.extrude(flange, {depth = 0.045, bevelEnabled = false, curveSegments = 1}).translate(0, 0, fz - 0.015))

static func _deck_at(z: float):
	for d in DECKS:
		if z >= d.z0 and z < d.z1:
			return d
	return null

func build_bulkheads() -> void:
	for b in BULKHEADS:
		# stop at the fuselage roof: the hull table also holds the top turret's dome, and a bulkhead
		# traced up into it stood right behind the turret gunner's head, filling his view aft
		var o := outline(b.z, b.floor + 0.6, 0.01, ROOF)
		var hi: float = o[1]
		var shape := Shapes.Shape.new(o[2])
		var x0: float = b.door[0]
		var x1: float = b.door[1]
		var top := minf(b.floor + b.door[2], hi - 0.1)
		shape.holes.append(Shapes.Path.new([Vector2(x0, b.floor), Vector2(x1, b.floor), Vector2(x1, top), Vector2(x0, top)]))
		add(MAT.green, Geo.extrude(shape, {depth = 0.04, bevelEnabled = false, curveSegments = 1}).translate(0, 0, b.z - 0.02))
		box(-2, x0, -3, 3, b.z - 0.05, b.z + 0.05, null)
		box(x1, 2, -3, 3, b.z - 0.05, b.z + 0.05, null)
		box(x0, x1, top, 3, b.z - 0.05, b.z + 0.05, null)
		for x in [x0, x1]:
			box(x - 0.03, x + 0.03, b.floor, top, b.z - 0.04, b.z + 0.04, MAT.metal, false) # door frame

func build_nose() -> void:
	var f := -0.72
	box(-0.95, -0.55, f, 0.02, -9.4, -8.85, null) # navigator's table (drawn in stations.js)
	box(-0.18, 0.18, f, -0.3, -10.3, -10.08, MAT.leather) # bombardier's seat
	box(-0.18, 0.18, -0.3, 0.4, -10.3, -10.08, null) # (no climbing onto it)
	box(-1.0, 1.0, f, 1.0, -11.8, -10.82, null) # the nose glass: you can't walk out past the end of the floor
	box(-0.09, 0.09, f, -0.25, -10.55, -10.42, MAT.metal) # bomb-sight stand
	box(-0.11, 0.11, -0.25, -0.02, -10.6, -10.36, MAT.dark, false) # Norden bomb sight

## The crawlway: the hatch in the flight deck floor between the seats, its raised frame and its lid
## laid open aft; under the floor a low tunnel forward to the nose, its mouth low in the bulkhead
## under the instrument panel. The bulkhead closes off the cockpit: no seeing (or walking) through.
func build_crawlway() -> void:
	var h: Dictionary = CRAWLWAY.hatch
	var t: Dictionary = CRAWLWAY.tunnel
	var f := -0.40
	# the tunnel: floor, walls and roof (the flight deck's underside), the aft wall under the hatch
	add(MAT.floor, box_geo(t.x * 2, 0.03, t.z1 - t.z0).translate(0, t.y0 - 0.015, (t.z0 + t.z1) / 2))
	for s in [-1, 1]:
		add(MAT.green, box_geo(0.02, t.y1 - t.y0, t.z1 - t.z0).translate(s * (t.x + 0.01), (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2))
	add(MAT.green, box_geo(t.x * 2, 0.02, h.z0 - t.z0).translate(0, t.y1 + 0.01, (t.z0 + h.z0) / 2))
	add(MAT.green, box_geo(t.x * 2, t.y1 - t.y0, 0.02).translate(0, (t.y0 + t.y1) / 2, t.z1 + 0.01))
	for z in [-8.3, -7.95]:
		for s in [-1, 1]:
			rod([s * (t.x - 0.01), t.y0, z], [s * (t.x - 0.01), t.y1, z], 0.012, MAT.metal, 5) # its frames
	# the well down through the floor, the raised frame round the hatch, the lid laid open aft on its hinge
	for s in [-1, 1]:
		add(MAT.green, box_geo(0.02, f - t.y1, h.z1 - h.z0).translate(s * (h.x1 + 0.01), (f + t.y1) / 2, (h.z0 + h.z1) / 2))
	for r in [[h.x0 - 0.035, h.x1 + 0.035, h.z0 - 0.035, h.z0], [h.x0 - 0.035, h.x1 + 0.035, h.z1, h.z1 + 0.035], [h.x0 - 0.035, h.x0, h.z0, h.z1], [h.x1, h.x1 + 0.035, h.z0, h.z1]]:
		box(r[0], r[1], f, f + 0.045, r[2], r[3], MAT.metal, false)
	var lid := [
		box_geo(h.x1 - h.x0, 0.02, h.z1 - h.z0).translate(0, 0.01, (h.z1 - h.z0) / 2),
		box_geo(0.02, 0.025, h.z1 - h.z0 - 0.06).translate(-0.08, 0.03, (h.z1 - h.z0) / 2), # its stiffeners
		box_geo(0.02, 0.025, h.z1 - h.z0 - 0.06).translate(0.08, 0.03, (h.z1 - h.z0) / 2),
	]
	for g in lid:
		add(MAT.metal, g.rotate_x(-0.36).translate(0, f + 0.045, h.z1 + 0.035))
	rod([-0.06, f + 0.09, h.z1 + 0.3], [0.06, f + 0.09, h.z1 + 0.3], 0.008, MAT.dark, 6) # its handle
	cylinder(0.012, h.x1 - h.x0, 0, f + 0.045, h.z1 + 0.035, "x", MAT.dark, 8) # the hinge
	# the bulkhead under the panel, seen from the nose, with the tunnel's mouth low in it
	var z: float = t.z0 - 0.005
	var shape := Shapes.Shape.new(outline(z, 0, 0.01, 0.62)[2])
	shape.holes.append(Shapes.Path.new([Vector2(-t.x, -0.72), Vector2(t.x, -0.72), Vector2(t.x, t.y1), Vector2(-t.x, t.y1)]))
	add(MAT.green, Geo.extrude(shape, {depth = 0.03, bevelEnabled = false, curveSegments = 1}).translate(0, 0, z - 0.03))
	for ab in [[[-t.x, -0.72], [-t.x, t.y1]], [[t.x, -0.72], [t.x, t.y1]], [[-t.x, t.y1], [t.x, t.y1]]]:
		rod([ab[0][0], ab[0][1], z - 0.035], [ab[1][0], ab[1][1], z - 0.035], 0.016, MAT.metal, 6) # (its edge, worn bright)
	stencil(["CRAWLWAY"], 0.13, [0, t.y1 + 0.06, z - 0.04], PI, "#e8e2c8")
	# and a wall right across: the cockpit ends at its panel (no walking through it, either way)
	box(-1.3, 1.3, t.y1, 1.4, t.z0 - 0.02, -8.4, null)
	# over the top of the panel: the deck under the windscreen, forward from the glare shield to where
	# it meets the skin (the cockpit is closed in, as in the real one: no looking down into the nose)
	var L := []
	var R := []
	var dz := -8.64
	var y := 0.665
	while dz > -10.4:
		var roof := ceiling_at(dz, 0, y - 0.3)
		var w := hw(dz, minf(y, roof - 0.01)) - 0.004
		if roof < y + 0.01 or not (w > 0.05):
			y = roof; L.append(Vector3(-0.04, y, dz)); R.append(Vector3(0.04, y, dz)); break # (the skin comes down to it: done)
		L.append(Vector3(-w, y, dz)); R.append(Vector3(w, y, dz))
		dz -= 0.05
		y += 0.05 * 0.3
	var dp := PackedVector3Array()
	for i in L.size() - 1:
		for q in [L[i], R[i], R[i + 1], L[i], R[i + 1], L[i + 1]]:
			dp.append(q)
	var dg = Geo.from_arrays(dp)
	dg.compute_vertex_normals()
	var dmat: ShaderMaterial = MAT.deck.duplicate()
	Cabinlook.refeature(dmat, {cull = "disabled"})
	mesh_of(dg, dmat, group)
	if L.size():
		box(-1.3, 1.3, 0.66, 1.5, L[L.size() - 1].z, -8.6, null) # (its underside: the nose's ceiling there)

func build_cockpit() -> void:
	var f := -0.40
	CockpitB17.build_b17_cockpit(self) # the panel, glare shield, wheels, pedestal and seats (cockpitb17.js)
	build_crawlway()
	# top turret: the engineer's standing platform, and above him the opening in the roof up into the
	# turret: the ring and its lip, and ammunition boxes either side
	box(-0.32, 0.32, f, f + 0.12, -7.0, -6.55, MAT.metal)
	add(MAT.metal, Geo.torus(TURRET_CUT.r + 0.02, 0.035, 8, 40).rotate_x(PI / 2).translate(0, 1.15, TURRET_CUT.z))
	add(MAT.well, cyl_geo(TURRET_CUT.r + 0.01, TURRET_CUT.r + 0.01, 0.06, 40, 1, true).translate(0, 1.15, TURRET_CUT.z)) # the ring's lip (open below: you see the engineer up in it)
	# walking about, the ring is your ceiling: your head never goes up into the dome (and out over the
	# fuselage). Only climbing into the turret takes you up there (the station's way in)
	box(-0.75, 0.75, 1.05, 3, TURRET_CUT.z - 0.75, TURRET_CUT.z + 0.75, null)
	boxes[boxes.size() - 1].walk_only = true
	for s in [-1, 1]:
		box(s * 0.42 - 0.1, s * 0.42 + 0.1, 0.62, 0.92, TURRET_CUT.z - 0.22, TURRET_CUT.z + 0.22, MAT.ammo, false) # ammunition boxes on the turret
		rod([s * 0.38, 0.92, TURRET_CUT.z], [s * 0.18, 1.12, TURRET_CUT.z - 0.05], 0.03, MAT.chute, 8) # feed chutes up to the guns

## The bomb bay as in the photos: the bombs hung in tiers on the racks either side of the catwalk,
## each an M43/M64 general-purpose bomb (ogive nose and its fuze, a body tapering to the tail, two
## yellow bands at the nose and one at the tail, the suspension lugs on top, the box fin with the tail
## fuze's arming vane), held in its shackle to the rack's uprights; the narrow riveted keel-beam
## catwalk on its V-supports, and a handrail along each side.
func build_bomb_bay() -> void:
	var f := -1.62
	for s in [-1, 1]:
		box(0.3 if s > 0 else -1.2, 1.2 if s > 0 else -0.3, -2.2, 0.8, -6.35, -2.6, null) # bomb racks: stay on the catwalk
	# one bomb, nose towards -Z, centred on the origin: its parts by material
	var profile := [[0, -0.66], [0.02, -0.655], [0.028, -0.62], [0.05, -0.6], [0.095, -0.56], [0.135, -0.5], [0.163, -0.42],
		[0.178, -0.32], [0.181, -0.2], [0.181, 0.12], [0.172, 0.22], [0.145, 0.32], [0.1, 0.41], [0.055, 0.47], [0.03, 0.5], [0, 0.52]]
	var body = Geo.lathe(profile.map(func(p): return Vector2(p[0], p[1])), 20).rotate_x(PI / 2) # (turned about Y: laid along Z)
	var bparts := {bomb = [body], band = [], fuze = []}
	for z in [-0.43, -0.38, 0.17]:
		bparts.band.append(cyl_geo(0.1835, 0.1835, 0.022, 20, 1, true).rotate_x(PI / 2).translate(0, 0, z))
	bparts.fuze.append(cyl_geo(0.018, 0.028, 0.05, 10).rotate_x(-PI / 2).translate(0, 0, -0.67)) # nose fuze
	bparts.fuze.append(cyl_geo(0.012, 0.012, 0.06, 8).rotate_x(PI / 2).translate(0, 0, 0.55)) # tail fuze
	for a in [0.0, PI / 2]:
		bparts.fuze.append(box_geo(0.07, 0.004, 0.018).rotate_z(a + 0.3).translate(0, 0, 0.585)) # its arming vane
	for k in 4: # the box fin: four fins in an X, joined by the square box round their tips
		bparts.bomb.append(box_geo(0.004, 0.17, 0.3).translate(0, 0.1, 0.5).rotate_z(PI / 4 + (k * PI) / 2))
		bparts.bomb.append(box_geo(0.235, 0.004, 0.17).translate(0, 0.118, 0.58).rotate_z((k * PI) / 2))
	for z in [-0.12, 0.1]:
		bparts.fuze.append(box_geo(0.03, 0.03, 0.025).translate(0, 0.19, z)) # suspension lugs
	var M := {bomb = MAT.bomb, band = MAT.bombBand, fuze = MAT.bombFuze}
	# the racks: on each side two bombs fore and aft in tiers four high, hung slightly nose down
	var tilt := Basis(Vector3.RIGHT, -0.05)
	var rows := [-1.48, -1.08, -0.68, -0.28]
	for s in [-1, 1]:
		for z in [-4.95, -3.55]:
			for y in rows:
				var at := Transform3D(tilt, Vector3(s * 0.58, y, z))
				for k in bparts:
					for g in bparts[k]:
						var c = g.clone()
						if g.has_meta("type"):
							c.set_meta("type", g.get_meta("type"))
						add(M[k], c.apply_transform(at))
				# its shackle: the release unit on the rack's upright, hooks down round both lugs
				var sy: float = y + 0.25
				box(minf(s * 0.36, s * 0.42), maxf(s * 0.36, s * 0.42), sy - 0.03, sy + 0.04, z - 0.2, z + 0.18, MAT.dark, false)
				for lz in [-0.12, 0.1]:
					rod([s * 0.4, sy, z + lz], [s * 0.58, sy - 0.02, z + lz - 0.01], 0.007, MAT.metal, 5)
					rod([s * 0.58, sy - 0.02, z + lz - 0.01], [s * 0.58, y + 0.2, z + lz - 0.01], 0.006, MAT.metal, 5)
				cylinder(0.008, 0.06, s * 0.43, sy + 0.05, z - 0.02, "z", MAT.red, 6) # the arming wire's clip
			# the rack's uprights (a channel section) and the braces between them
			for dz in [-0.2, 0.18]:
				box(s * 0.34 - 0.02, s * 0.34 + 0.02, -1.75, 0.0, z + dz - 0.03, z + dz + 0.03, MAT.metal, false)
				box(s * 0.34 - 0.025, s * 0.34 + 0.025, -1.75, 0.0, z + dz - 0.004, z + dz + 0.004, MAT.dark, false)
			for y in rows:
				rod([s * 0.34, y + 0.05, z - 0.2], [s * 0.34, y + 0.38, z + 0.18], 0.007, MAT.metal, 5)
	# the catwalk: a keel beam, its top plate punched with lightening holes and riveted, webs and flanges below
	var plate := Shapes.Shape.new([Vector2(-0.13, -6.35), Vector2(0.13, -6.35), Vector2(0.13, -2.6), Vector2(-0.13, -2.6)])
	var z := -6.2
	while z < -2.7:
		plate.holes.append(Shapes.Path.new().absellipse(0, z, 0.045, 0.07, 0, PI * 2, true))
		z += 0.25
	add(MAT.catwalk, Geo.extrude(plate, {depth = 0.012, bevelEnabled = false, curveSegments = 10}).rotate_x(PI / 2).translate(0, f, 0))
	for x in [-0.12, 0.12]:
		box(x - 0.006, x + 0.006, f - 0.2, f - 0.012, -6.35, -2.6, MAT.catwalk, false) # webs
		box(x - 0.03, x + 0.03, f - 0.212, f - 0.2, -6.35, -2.6, MAT.catwalk, false) # flanges
		z = -6.3
		while z < -2.6:
			add(MAT.metal, Geo.sphere(0.004, 4, 3).translate(x, f + 0.003, z)) # rivets along it
			z += 0.05
	# the handrails: a tube each side at hip height, on posts down to the catwalk
	for x in [-0.2, 0.2]:
		rod([x, f + 0.85, -6.3], [x, f + 0.85, -2.65], 0.014, MAT.green, 8)
		for pz in [-5.6, -4.25, -2.9]:
			rod([x, f + 0.85, pz], [signf(x) * 0.13, f, pz], 0.011, MAT.green, 6)

func build_radio_room() -> void:
	var f := -1.80
	build_radio_hatch()
	# the desk, its sets and the chair are drawn in stations.js; these keep you out of them
	box(-1.0, -0.42, f, -1.05, -2.5, -1.8, null) # desk
	box(-0.97, -0.6, -1.05, -0.3, -2.45, -1.94, null) # the sets on it
	box(-0.85, -0.5, f, f + 0.45, -1.72, -1.42, null) # operator's chair

## The radio room's gun hatch: the opening in the roof with its riveted frame inside and out, the
## slipstream deflector standing up ahead of it (seen from outside too), the gun's mount at its
## forward end, and the ammunition box and feed chute on the wall by it.
func build_radio_hatch() -> void:
	var h := RADIO_HATCH
	var skin := func(z: float) -> float: return 0.525 - (z + 2.2) * 0.17 # (the roof's top there, measured)
	var st: Dictionary = STATIONS.filter(func(s): return s.id == "radio")[0]
	var p := _v(st.pivot)
	# the frame round the opening, on the skin
	var c := [[-h.x, h.z0], [h.x, h.z0], [h.x, h.z1], [-h.x, h.z1]].map(func(q): return Vector3(q[0], skin.call(q[1]) - 0.02, q[1]))
	for i in 4:
		var a: Vector3 = c[i]
		var b: Vector3 = c[(i + 1) % 4]
		rod(a, b, 0.01, MAT.dark, 6) # (slim: it's all round the view)
		var L := a.distance_to(b)
		var t := 0.05
		while t < L:
			var q := a.lerp(b, t / L) + Vector3(0, 0.022, 0)
			add(MAT.metal, Geo.sphere(0.006, 5, 3).translate(q.x, q.y, q.z))
			t += 0.06
	# the deflector: a curved plate standing up ahead of the opening, leaning back, braced to the skin
	var def = cyl_geo(0.9, 0.9, h.x * 2 + 0.1, 16, 1, true, -0.28, 0.56).rotate_z(PI / 2).rotate_y(PI / 2)
	def.translate(0, skin.call(h.z0) - 0.62, h.z0 - 0.92 + 0.14)
	add(MAT.metal, def)
	for s in [-1, 1]:
		rod([s * (h.x + 0.04), skin.call(h.z0 - 0.12), h.z0 - 0.12], [s * (h.x + 0.04), skin.call(h.z0) + 0.2, h.z0 - 0.02], 0.01, MAT.dark, 5)
	# the mount: a cradle under the pivot, braced out to the hatch's side frames (nothing in the room,
	# nothing across the view)
	for s in [-1, 1]:
		rod([s * 0.05, p.y - 0.1, p.z], [s * (h.x - 0.01), skin.call(p.z) - 0.04, p.z], 0.016, MAT.dark, 6)
	cylinder(0.035, 0.06, p.x, p.y - 0.09, p.z, "y", MAT.metal, 10)
	# its ammunition box on the right wall, the feed chute up to the gun
	var bz := -2.0
	var by := -0.75
	var bx := hw(bz, by) - 0.14
	box(bx - 0.11, bx + 0.11, by - 0.15, by + 0.15, bz - 0.2, bz + 0.2, MAT.ammo, false)
	var chute := Shapes.CatmullRomCurve3.new([Vector3(bx - 0.05, by + 0.15, bz), Vector3(bx - 0.15, by + 0.6, bz + 0.1), Vector3(0.18, p.y - 0.25, p.z - 0.15), Vector3(0.07, p.y - 0.05, p.z - 0.2)])
	add(MAT.chute, Geo.tube(chute, 18, 0.028, 5, false))
	stencil(["CAL .50"], 0.12, [bx - 0.111, by + 0.05, bz], -PI / 2, "#d8d0a8")
	# two passenger seats folded down along the right wall aft of it, and equipment cases on the floor
	for z in [-1.62, -1.32]:
		var x := hw(z, -1.4) - 0.2
		box(x - 0.18, x + 0.18, -1.38, -1.33, z - 0.13, z + 0.13, MAT.leather, false) # the seat
		box(x + 0.15, x + 0.19, -1.33, -0.92, z - 0.13, z + 0.13, MAT.leather, false) # its back on the wall
		for dz in [-0.1, 0.1]:
			rod([x - 0.16, -1.8, z + dz], [x - 0.16, -1.36, z + dz], 0.01, MAT.metal, 5) # its legs
	for q in [[0.5, -2.42, -1.8, 0.32, 0.26, 0.24], [0.5, -2.42, -1.54, 0.24, 0.18, 0.2]]: # (forward, on the right: clear of the gun and the operator's chair)
		var x: float = q[0]; var z: float = q[1]; var y: float = q[2]; var w: float = q[3]; var hh: float = q[4]; var d: float = q[5]
		box(x - w / 2, x + w / 2, y, y + hh, z - d / 2, z + d / 2, MAT.green)
		box(x - 0.04, x + 0.04, y + hh, y + hh + 0.012, z - d / 2 - 0.005, z - d / 2 + 0.02, MAT.metal, false) # a catch

## The tailplanes run right through the fuselage in the model (and they're two-sided): crawling down
## the tail you'd have them as walls either side. Inside the fuselage they're cut away (your bomber only).
func cut_tailplanes(m: Node3D) -> void:
	for o in m.find_children("*", "MeshInstance3D", true, false):
		for i in o.mesh.get_surface_count():
			var src: Material = Models.surface_material(o, i)
			if src == null or src.resource_name != "RearWings":
				continue
			o.set_surface_override_material(i, cut_skin(src, ["tailplane"], Models.rel(o, m)))

## The bulkhead shutting off the tail, its low opening framed and stencilled, solid all but that.
func build_tailway() -> void:
	var z: float = TAILWAY.z
	var m: Dictionary = TAILWAY.mouth
	var shape := Shapes.Shape.new(outline(z, -1.6, 0.01)[2])
	shape.holes.append(Shapes.Path.new([Vector2(-m.x, m.y0), Vector2(m.x, m.y0), Vector2(m.x, m.y1), Vector2(-m.x, m.y1)]))
	add(MAT.green, Geo.extrude(shape, {depth = 0.03, bevelEnabled = false, curveSegments = 1}).translate(0, 0, z - 0.015))
	for ab in [[[-m.x, m.y0], [-m.x, m.y1]], [[m.x, m.y0], [m.x, m.y1]], [[-m.x, m.y1], [m.x, m.y1]]]:
		rod([ab[0][0], ab[0][1], z - 0.02], [ab[1][0], ab[1][1], z - 0.02], 0.016, MAT.metal, 6)
	stencil(["TAIL GUNNER"], 0.16, [0, m.y1 + 0.08, z - 0.02], PI, "#e8e2c8")
	box(-1.3, -m.x, -2.4, 1.5, z - 0.03, z + 0.03, null) # (solid: only the crawl through the opening)
	box(m.x, 1.3, -2.4, 1.5, z - 0.03, z + 0.03, null)
	box(-m.x, m.x, m.y1 - 0.17, 1.5, z - 0.03, z + 0.03, null) # (too low to walk through from either side: the tail's floor is lower)

func build_waist() -> void:
	build_tailway()
	var f := -1.95
	box(-0.36, 0.36, f, -1.2, -0.5, 0.24, null) # ball turret and its support stick up through the floor
	add(MAT.metal, Geo.torus(0.5, 0.04, 8, 32).rotate_x(PI / 2).translate(0, f + 0.02, -0.13))
	# the ball's steel top where it comes up through the floor (the model's ball is glass up here, and
	# seen from the waist it mirrored the sky). Hidden while you're in the ball yourself.
	var rc := 0.57
	var cy := -2.15
	var top := acos(clampf((f - cy) / rc, -1, 1))
	var cap := mesh_of(Geo.sphere(rc, 36, 10, 0, PI * 2, 0, top).translate(0, cy, -0.13), std(0x5a5e56, 0.55, 0.55), group, "BallCap")
	cap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add(MAT.dark, cyl_geo(0.08, 0.1, 0.05, 16).translate(0, cy + rc - 0.01, -0.13)) # its hub
	# (its drum and column, the ammunition boxes and the oxygen bottles: waist.js)

## A thin rod (cable, hose, chute) from a to b.
func rod(a, b, r: float, mat: Material, seg := 6) -> void:
	var A: Vector3 = a if a is Vector3 else _v(a)
	var B: Vector3 = b if b is Vector3 else _v(b)
	var len := A.distance_to(B)
	var g = cyl_geo(r, r, len, seg, 1, true)
	g.apply_quaternion(from_to(Vector3.UP, (B - A).normalized()))
	add(mat, g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2))

## A stencilled marking on a flat surface (facing +Z when rot_y = 0).
func stencil(lines: Array, w: float, pos, rot_y := 0.0, colour := "#e8e2c8") -> MeshInstance3D:
	var h := (w / 4) * lines.size()
	var m := Cabinlook.std({map = stencil_texture(lines, colour), alphaTest = 0.3, roughness = 0.8})
	m.set_shader_parameter("lift", 0.0015) # (Three's polygonOffset: drawn just off the surface it's on)
	var mi := mesh_of(Geo.plane(w, h), m, group)
	mi.position = _v(pos)
	mi.rotation.y = rot_y
	return mi

## The clutter of a real B-17: ammunition boxes and feed chutes at the guns, oxygen bottles and hoses,
## control cables along the walls, the ball turret's support, the radio sets, padding and stencils.
## All decoration (no colliders), kept clear of the walkway and every gun position's view.
func build_details() -> void:
	# (the waist guns' ammunition boxes: waist.js; their feed chutes move with the guns, weapons.js)
	# tail guns: boxes along the walls, chutes forward to the guns
	for s in [-1, 1]:
		box(s * 0.32 - 0.12, s * 0.32 + 0.12, -2.32, -2.02, 8.55, 9.15, MAT.ammo, false)
		rod([s * 0.3, -2.05, 9.1], [s * 0.18, -2.12, 9.85], 0.04, MAT.chute, 8)
	# the ball turret hangs in a yoke from a heavy fuselage frame either side: braces from its ring up
	# to the frame at the walls, nothing across the walkway at head height
	if true:
		var z := -0.13
		var f := -1.95
		for sd in [-1, 1]:
			var pts := []
			var y := f
			while y <= f + 1.05 + 1e-6:
				pts.append(Vector2(sd * (hw(z, y) - 0.01), y))
				y += 0.05
			y = f + 1.05
			while y >= f - 1e-6:
				pts.append(Vector2(sd * (hw(z, y) - 0.1), y))
				y -= 0.05
			if sd < 0:
				pts.reverse()
			var heavy := Shapes.Shape.new(pts) # the heavy frame up the wall
			for dz in [-0.2, 0.2]:
				add(MAT.metal, Geo.extrude(heavy, {depth = 0.035, bevelEnabled = false, curveSegments = 1}).translate(0, 0, z + dz - 0.017))
			var top := f + 0.85
			var wx: float = sd * (hw(z, top) - 0.06)
			for dz in [-0.2, 0.2]:
				rod([sd * 0.44, f + 0.06, z + dz * 0.6], [wx, top, z + dz], 0.028, MAT.metal, 8) # the yoke's arms
				box(wx - 0.04, wx + 0.04, top - 0.06, top + 0.06, z + dz - 0.04, z + dz + 0.04, MAT.dark, false) # bolted to the frame
			rod([wx, top, z - 0.2], [wx, top, z + 0.2], 0.022, MAT.metal, 8) # and tied together along the wall
			box(sd * 0.44 - 0.05, sd * 0.44 + 0.05, f, f + 0.1, z - 0.16, z + 0.16, MAT.dark, false) # the trunnion block on the ring
	# oxygen: yellow bottles in the cockpit and radio room, hoses to each crew position
	for q in [[-0.85, -0.15, -7.05], [0.85, -0.15, -7.05], [0.8, -1.5, -2.2], [0.8, -1.5, -1.95]]:
		cylinder(0.1, 0.5, q[0], q[1], q[2], "y", MAT.yellow, 12)
		rod([q[0], q[1] + 0.27, q[2]], [q[0] * 0.92, q[1] + 0.55, q[2] + 0.25], 0.012, MAT.hose)
	stencil(["OXYGEN"], 0.2, [0.69, -1.45, -2.08], -PI / 2, "#1a1a1a")
	# fire extinguisher by the radio room door
	cylinder(0.07, 0.42, 0.55, -1.58, -1.4, "y", MAT.red, 12)
	stencil(["FIRE", "EXTINGUISHER"], 0.26, [0.55, -1.1, -1.32], 0)
	# control cables to the tail, along both walls just under the windows
	var W: Dictionary = Waist.WAIST_WINDOW
	for s in [-1, 1]:
		var prev = null
		var z := -1.0
		while z <= 9.0:
			var deck = _deck_at(z)
			if deck == null:
				deck = DECKS[DECKS.size() - 1]
			var y: float = deck.y + 1.32
			var x: float = s * (hw(z, y) - 0.06)
			if not is_finite(x) or absf(x) < 0.2:
				prev = null
				z += 0.5
				continue
			if prev != null and not (z > W.z0 - 0.05 and z < W.z1 + 0.1):
				rod(prev, [x, y, z], 0.006, MAT.cable, 4) # (not across the waist windows)
			prev = [x, y, z]
			z += 0.5
	Stations.build_stations(self, MAT) # the navigator's and radio operator's stations (stations.js)
	# padded walls: quilted insulation on the radio room bulkheads, either side of the doors
	for zd in [[-2.57, 1], [-1.28, -1]]:
		for s in [-1, 1]:
			var g = Geo.plane(0.42, 1.0)
			if zd[1] < 0:
				g.rotate_y(PI)
			add(MAT.pad, g.translate(s * 0.58, -1.2, zd[0]))
	# stencils: the things painted on every B-17
	stencil(["NO SMOKING"], 0.36, [0, -0.25, -6.31], PI)
	stencil(["DANGER", "BOMB BAY"], 0.3, [0.5, -0.95, -2.56], 0)
	stencil(["WALK ON", "CATWALK ONLY"], 0.3, [-0.5, -0.95, -2.64], PI)
	stencil(["42-31909"], 0.3, [0.68, -0.6, 4.0], -PI / 2, "#d8c86a")
	# data plates, riveted on by the doors and at the stations, and the bottles' and boxes' stencils
	var plate := func(lines: Array, w: float, p: Array, rot: float) -> void:
		var h := (w / 4) * lines.size() + 0.02
		var n := Vector3(sin(rot), 0, cos(rot))
		add(MAT.dark, box_geo(w + 0.02, h, 0.004).rotate_y(rot).translate(p[0] - n.x * 0.003, p[1], p[2] - n.z * 0.003))
		stencil(lines, w, [p[0] + n.x * 0.0005, p[1], p[2] + n.z * 0.0005], rot, "#cfc8b0")
	plate.call(["BOEING B-17G-35-BO", "AAF SER. NO. 42-31909", "SEATTLE WASH."], 0.16, [-0.45, -0.95, -1.32], 0.0)
	plate.call(["EMERGENCY EXIT", "PULL HANDLE"], 0.14, [0.62, -1.0, 6.18], PI)
	plate.call(["FUEL TRANSFER", "VALVE - DO NOT", "OPERATE IN FLIGHT"], 0.15, [0.5, -0.55, -2.62], PI)
	plate.call(["A-12 OXYGEN", "REGULATOR", "400 PSI MAX"], 0.12, [-0.7, -1.25, 1.2], PI / 2)
	for q in [[-0.85, -0.15, -7.05], [0.85, -0.15, -7.05], [0.8, -1.5, -2.2], [0.8, -1.5, -1.95]]:
		var rot := PI / 2 if q[0] < 0 else -PI / 2 # (facing into the cabin)
		stencil(["OXYGEN"], 0.1, [q[0] - signf(q[0]) * 0.102, q[1], q[2]], rot, "#1a1a1a")
	for s in [-1, 1]:
		stencil(["CAL .50", "M2 LINKED"], 0.16, [s * 0.32, -2.17, 8.549], PI, "#d8d0a8")

## Sunlight falling through the windows: soft shafts that follow the sun as the bomber turns.
func build_shafts() -> void:
	var c := Canvas2D.new(4, 64)
	var grd = c.create_linear_gradient(0, 0, 0, 64)
	grd.add_color_stop(0, "rgba(255,240,210,0.0)"); grd.add_color_stop(0.15, "rgba(255,240,210,1)"); grd.add_color_stop(1, "rgba(255,240,210,0)")
	c.fill_style = grd; c.fill_rect(0, 0, 4, 64)
	var map := c.texture()
	# (the waist windows only: the radio room's showed as a pale slab across the floor)
	shafts = []
	for q in [[-1.0, -1.0, 1.78, -1], [1.0, -1.0, 1.82, 1]]:
		var geo = Geo.cylinder(0.28, 0.45, 2.4, 10, 1, true).translate(0, -1.2, 0) # from the window inwards
		var m := Mat.basic({map = map, transparent = true, opacity = 0.0, depthWrite = false, blending = "additive", side = Mat.DOUBLE, fog = false})
		m.render_priority = 2
		var mesh := mesh_of(geo, m, group)
		mesh.position = Vector3(q[0], q[1], q[2])
		shafts.append({mesh = mesh, side = q[3]})

## sun_local: the direction to the sun in bomber space. A shaft shows when the sun is on its side.
func update_shafts(sun_local: Vector3) -> void:
	if shafts.is_empty():
		build_shafts()
	var down := -sun_local
	for s in shafts:
		s.mesh.quaternion = from_to(Vector3.UP, -down.normalized()) # its axis points back up the sun ray
		var m: StandardMaterial3D = s.mesh.mesh.surface_get_material(0)
		m.albedo_color.a = 0.03 * clampf(sun_local.x * s.side, 0, 1)

## By night the cabin has its own dim lights: the instrument glow in the cockpit, a lamp at the
## navigator's table and the radio desk, and low lamps down the waist and in the tail. (Added only
## at night: every light costs every lit surface something.)
func set_night(k: float) -> void:
	# (always in the scene, at nothing by day: adding lights later would rebuild every shader, a freeze)
	if night_lights.is_empty():
		for q in [
			[0xffa860, 0.28, 1.4, [0, 0.62, -8.0]], # the instrument panels: a little warm light on the dials
			[0xffc890, 0.22, 1.2, [-0.4, 0.1, -9.6]], # the navigator's lamp, over his table
			[0xffc890, 0.22, 1.3, [-0.5, -0.8, -1.9]], # the radio desk
			[0xff9a70, 0.12, 2.5, [0, -0.6, 2.2]], # the waist
			[0xff9a70, 0.1, 1.6, [0, -1.5, 8.6]], # the tail
		]:
			var l := OmniLight3D.new()
			l.light_color = Mat.color(q[0])
			l.light_energy = 0.0
			l.omni_range = q[2]
			l.omni_attenuation = 2.0
			l.position = _v(q[3])
			l.set_meta("full", q[1])
			night_lights.append(l)
		# (hung on the bomber, where the cabin is, not in the cabin: the cabin's hidden in third person, and a light
		# leaving the scene with it would rebuild every shader in the game, a long stall: main.js)
		for l in night_lights:
			var holder: Node = group.get_parent() if group.get_parent() else group
			holder.add_child(l)
			if holder != group:
				l.transform = group.transform * l.transform
	for l in night_lights:
		l.light_energy = l.get_meta("full") * k
	if cockpit_night.is_valid():
		cockpit_night.call(k) # the instruments' radium figures glow (cockpitb17.js)

func build_tail() -> void:
	box(-0.25, 0.25, -2.32, -2.17, 9.65, 9.95, MAT.leather) # knee pad
	# (the compartment itself, its windows, frames and armour: buildTailCab)
	build_tail_glazing()
	build_tail_cab()
	build_nose_glazing()
	ball_cockpit = BallTurret.build_ball_turret() # the inside of the ball turret, mounted on the camera while you're in it
	top_cockpit = TopTurret.build_top_turret() # and the upper turret's dome
	build_top_dome()

## The tail gunner's fittings: the canvas boot where the guns go out through the armour, the padding,
## the oxygen regulator and its hose, the interphone box, a little lamp and the stencils.
func build_tail_glazing() -> void:
	var fz := 10.5
	for m in parts.get("TailGunPod", []):
		m.visible = false # (the cab has its own pod: buildTailCab)
	# the canvas boot round the guns where they pass out through the armour, gathered in folds
	var boot = cyl_geo(0.1, 0.16, 0.12, 16, 3, true).rotate_x(PI / 2)
	for i in boot.positions.size():
		var bp: Vector3 = boot.positions[i]
		var a := atan2(bp.y, bp.x)
		var f := 1 + 0.08 * sin(a * 9) * (0.5 + bp.z * 4)
		boot.positions[i] = Vector3(bp.x * f * 1.3, bp.y * f * 0.75, bp.z)
	boot.compute_vertex_normals()
	add(MAT.canvas, boot.translate(0, -2.36, fz - 0.07))
	# quilted padding on the compartment's walls
	for sd in [-1, 1]:
		var x: float = sd * (hw(9.85, -1.95) - 0.02)
		var g = Geo.plane(0.5, 0.32)
		g.rotate_y(-sd * PI / 2)
		add(MAT.pad, g.translate(x, -1.95, 9.78))
	# the A-12 oxygen regulator, its blinker and hose; the interphone jack box
	var rx := -(hw(9.55, -1.8) - 0.04)
	var jx := hw(9.55, -1.85) - 0.04
	box(rx - 0.03, rx + 0.03, -1.86, -1.74, 9.5, 9.62, MAT.dark, false)
	cylinder(0.022, 0.012, rx + 0.032, -1.8, 9.56, "x", MAT.metal, 12)
	rod([rx + 0.02, -1.86, 9.56], [rx + 0.1, -2.05, 9.7], 0.011, MAT.hose)
	box(jx - 0.025, jx + 0.025, -1.9, -1.8, 9.5, 9.58, MAT.green, false)
	cylinder(0.008, 0.02, jx - 0.03, -1.83, 9.54, "x", MAT.metal, 8)
	# a small lamp on the roof, and the seat cushion he half sits on
	cylinder(0.03, 0.025, 0, ceiling_at(9.45, 0, -2.3) - 0.02, 9.45, "y", MAT.dark, 10)
	box(-0.15, 0.15, -2.06, -1.99, 9.5, 9.66, MAT.leather, false)
	stencil(["CAL .50 AMMUNITION"], 0.2, [-0.32, -2.12, 9.151], 0, "#d8d0a8")
	stencil(["OXYGEN"], 0.08, [rx + 0.031, -1.765, 9.56], PI / 2, "#d8c86a")
	stencil(["INTERPHONE"], 0.07, [jx - 0.026, -1.88, 9.54], -PI / 2, "#e8e2c8")

## The tail gunner's cab, as the B-17G's Cheyenne tail was built: a skin of riveted panels on ring
## frames and stringers, with Plexiglas side windows in two panes each, the big rear window above the
## guns, the gun pod below it with the armour plate and its bolts, the slot the guns go out through,
## and every pane in a riveted frame at its edges (the middle of the gunner's view is all glass).
## Inside: the frames, the stringers, the feed tracks from the ammunition boxes to the guns and the
## knee pads he kneels on. The cab follows the hull's own shape (the cross-section table).
func build_tail_cab() -> void:
	var NT := 40
	var top := func(z: float) -> float: return -1.84 if z > CAB.step else cab_cut(z) + 0.03 # (the pod: no higher than the rear window's sill)
	# a cross-section ring at z: rays out from the middle to the skin (up to just over the fin root)
	var ring := func(z: float, cy: float) -> Array:
		var pts := []
		for k in NT + 1:
			var a := (float(k) / NT) * PI * 2
			var dx := cos(a)
			var dy := sin(a)
			var r := 0.02
			while r < 1 and cy + dy * r < top.call(z) and absf(dx * r) < hw_smooth(z, cy + dy * r) - 0.003:
				r += 0.005
			pts.append(Vector3(dx * r, cy + dy * r, z))
		for pass_ in 2:
			var c := pts.duplicate()
			for k in NT:
				pts[k] = c[(k + NT - 1) % NT].lerp(c[(k + 1) % NT], 0.5).lerp(c[k], 0.5)
			pts[NT] = pts[0]
		return pts
	var skin_out := Cabinlook.std({color = 0x4b5135, roughness = 0.75, metalness = 0.15, outside = true})
	var skin_in := Cabinlook.std({color = 0x6f7462, roughness = 0.75, metalness = 0.3, side = Mat.BACK})
	var glass := plexiglas(null, Mat.DOUBLE, 0.07)
	var metal := []
	var panes := []
	# the body, z0 .. the step, and the pod, the step .. its end
	var loft := func(z0: float, z1: float, n: int, cy: float, glass_at) -> Array:
		var rings := []
		for i in n + 1:
			rings.append(ring.call(z0 + ((z1 - z0) * i) / n, cy))
		for i in n:
			for k in NT:
				var q := [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]]
				var c: Vector3 = (q[0] + q[1] + q[2] + q[3]) * 0.25
				(panes if glass_at != null and glass_at.call(c) else metal).append(q)
		return rings
	var SIDE := {z0 = 9.64, z1 = 10.285, zMid = 9.94, y0 = -2.0} # the side windows (two panes a side)
	var side_glass := func(c: Vector3) -> bool: return c.z > SIDE.z0 and c.z < SIDE.z1 and absf(c.z - SIDE.zMid) > 0.02 and c.y > SIDE.y0 and c.y < top.call(c.z) - 0.07 and absf(c.x) > 0.12
	var body: Array = loft.call(CAB.z0, CAB.step, 15, -1.95, side_glass)
	var pod: Array = loft.call(CAB.step + 0.03, 10.55, 5, -2.15, null)
	# the rear face at the step: the big rear window above the pod, metal round it
	var rear: Array = body[body.size() - 1]
	var wy := -1.86
	var rc := Vector3(0, -1.62, CAB.step)
	# the glass: one pane right down to the sill, fanned from the sill's middle out to the frame (and to
	# where the frame meets the sill), so there's no gap above the sill; metal below it
	var sill := Vector3(0, wy, CAB.step)
	var cut := func(a: Vector3, b: Vector3) -> Vector3: return a.lerp(b, (wy - a.y) / (b.y - a.y))
	for k in NT:
		var a: Vector3 = rear[k]
		var b: Vector3 = rear[k + 1]
		if a.y > wy and b.y > wy:
			panes.append([sill, b, a])
		elif a.y > wy or b.y > wy:
			panes.append([sill, cut.call(a, b), a] if a.y > wy else [sill, b, cut.call(a, b)]) # (the piece of a frame segment above the sill)
		if a.y <= wy or b.y <= wy:
			metal.append([Vector3(rc.x, -1.95, rc.z), b, a]) # (wound the other way: flipped below, its normal points aft)
	# the pod's end: a cap with the slot the guns go out through
	var end: Array = pod[pod.size() - 1]
	var ec := Vector3(0, -2.15, 10.55)
	for k in NT:
		metal.append([ec, end[k + 1], end[k]])
	var geo := func(list: Array, flip: bool):
		var pos := PackedVector3Array()
		var uv := PackedVector2Array()
		for poly in list:
			for t in range(1, poly.size() - 1):
				for p in ([poly[0], poly[t + 1], poly[t]] if flip else [poly[0], poly[t], poly[t + 1]]):
					pos.append(p)
					uv.append(Vector2(0.5, 0.5))
		var g = Geo.from_arrays(pos, null, uv)
		g.compute_vertex_normals()
		return g
	var mg = geo.call(metal, true) # (wound so the normals point out)
	var outer := mesh_of(mg, skin_out, group, "TailCab")
	var inner := mesh_of(mg, skin_in, group, "TailCab")
	outer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	var gm := mesh_of(geo.call(panes, true), glass, group, "TailCab_glass")
	glass.render_priority = 4
	# the frames round every pane, riveted: along the window edges (where glass meets metal) and between panes
	var edge := func(a: Vector3, b: Vector3) -> void:
		rod(a, b, 0.011, MAT.dark, 5)
		var L := a.distance_to(b)
		var t := 0.02
		while t < L:
			var q := a.lerp(b, t / L)
			add(MAT.metal, Geo.sphere(0.0042, 4, 3).translate(q.x, q.y, q.z))
			t += 0.045
	var inset := func(p: Vector3, d := 0.008) -> Vector3: return (p - Vector3(0, -2.15 if p.z > CAB.step else -1.95, p.z)) * -d + p
	var key := func(q: Array) -> String: return "|".join(q.map(func(p): return "%s" % p))
	var is_glass := {}
	for q in panes:
		is_glass[key.call(q)] = true
	var quad_at := func(i: int, k: int) -> Array: return [body[i][k], body[i + 1][k], body[i + 1][k + 1], body[i][k + 1]]
	var glass_q := func(i: int, k: int) -> bool: return i >= 0 and i < body.size() - 1 and is_glass.has(key.call(quad_at.call(i, (k + NT) % NT)))
	for i in body.size() - 1:
		for k in NT:
			if not glass_q.call(i, k):
				continue
			var q: Array = quad_at.call(i, k)
			if not glass_q.call(i - 1, k): edge.call(inset.call(q[0]), inset.call(q[3])) # fore edge
			if not glass_q.call(i + 1, k): edge.call(inset.call(q[1]), inset.call(q[2])) # aft edge
			if not glass_q.call(i, k - 1): edge.call(inset.call(q[0]), inset.call(q[1])) # lower / upper edges
			if not glass_q.call(i, k + 1): edge.call(inset.call(q[3]), inset.call(q[2]))
	for k in NT:
		var a: Vector3 = rear[k]
		var b: Vector3 = rear[k + 1]
		if a.y > wy or b.y > wy:
			var ia: Vector3 = inset.call(a, 0.01)
			var ib: Vector3 = inset.call(b, 0.01)
			ia.z = CAB.step - 0.01
			ib.z = CAB.step - 0.01
			edge.call(ia, ib)
	if true: # the rear window's sill
		var xl := INF
		var xr := -INF
		for p in rear:
			if absf(p.y - wy) < 0.06:
				xl = minf(xl, p.x)
				xr = maxf(xr, p.x)
		if is_finite(xl):
			edge.call(Vector3(xl + 0.02, wy, CAB.step - 0.012), Vector3(xr - 0.02, wy, CAB.step - 0.012))
	# ring frames and stringers inside the cab, clear of the windows' middle
	for i in [0, 5, 10, 15]:
		var r: Array = body[mini(i, body.size() - 1)]
		for k in NT:
			if not (glass_q.call(i, k) or glass_q.call(i - 1, k)):
				rod(inset.call(r[k], 0.03), inset.call(r[k + 1], 0.03), 0.01, MAT.metal, 4)
	for k in [roundi(NT * 0.62), roundi(NT * 0.75), roundi(NT * 0.88)]:
		for i in body.size() - 1:
			rod(inset.call(body[i][k], 0.015), inset.call(body[i + 1][k], 0.015), 0.007, MAT.metal, 4) # (stringers along the floor and lower walls)
	# the armour plate across the pod under the rear window, bolted, with the slot for the guns
	var az: float = CAB.step - 0.03
	for r in [[-0.38, -0.16, -2.42, -1.87], [0.16, 0.38, -2.42, -1.87], [-0.16, 0.16, -2.04, -1.87], [-0.16, 0.16, -2.5, -2.42]]:
		box(r[0], r[1], r[2], r[3], az - 0.012, az + 0.012, MAT.metal, false)
		for x in [r[0] + 0.025, r[1] - 0.025]:
			for y in [r[2] + 0.025, r[3] - 0.025]:
				cylinder(0.008, 0.012, x, y, az - 0.016, "z", MAT.dark, 6) # bolt heads
	# the feed tracks: from the ammunition boxes forward along the floor and up to each gun's feed
	for sd in [-1, 1]:
		var c := Shapes.CatmullRomCurve3.new([Vector3(sd * 0.3, -2.02, 9.1), Vector3(sd * 0.27, -2.15, 9.6), Vector3(sd * 0.2, -2.25, 10.0), Vector3(sd * 0.1, -2.34, CAB.step + 0.08)])
		add(MAT.chute, Geo.tube(c, 20, 0.03, 4, false))
		for i in range(1, 20):
			var p: Vector3 = c.get_point_at(i / 20.0)
			var t: Vector3 = c.get_tangent_at(i / 20.0)
			add(MAT.dark, Geo.torus(0.033, 0.004, 3, 4).apply_quaternion(from_to(Vector3(0, 0, 1), t)).translate(p.x, p.y, p.z))
		box(sd * 0.18 - 0.07, sd * 0.18 + 0.07, -2.32, -2.27, 9.72, 9.98, MAT.leather, false) # a knee pad

## The B-17F's nose: one blown Plexiglas cone (the model's is a faint, faceted sheet that read as open
## air), round and smooth from the fuselage's last frame to its tip, with the riveted ring that holds
## it to the fuselage, short struts over the top and below (its middle clear), the two gun sockets, and low
## in front of the Norden the optically flat bomb-aiming panel in its own frame. Plexiglas in the cheek
## gun windows too (found the way the tail's are, see glazeWindows).
func build_nose_glazing() -> void:
	var z0 := -10.62
	var L := 0.76
	var NU := 24
	var NT := 48
	# the base ring: the fuselage's own cross-section where the cone meets it, measured round its middle
	var lo := 0.6
	var hi := -1.2
	var y := -1.2
	while y <= 0.8:
		if hw_smooth(z0, y) > 0.03:
			lo = minf(lo, y)
			hi = maxf(hi, y)
		y += 0.02
	var cy := (lo + hi) / 2
	var r0 := PackedFloat64Array()
	for k in NT + 1:
		var a := (float(k) / NT) * PI * 2
		var dx := cos(a)
		var dy := sin(a)
		var r := 0.0
		while r < 1.2 and absf(dx * (r + 0.01)) < hw_smooth(z0, cy + dy * (r + 0.01)):
			r += 0.01
		r0.append(r)
	for pass_ in 4: # (the measured outline steps from cell to cell: smooth it round)
		var c := r0.duplicate()
		for k in NT + 1:
			r0[k] = (c[(k + NT - 1) % NT] + 2 * c[k % NT] + c[(k + 1) % NT]) / 4
	r0[NT] = r0[0]
	# the cone: an ellipsoid on that ring, its middle rising a little towards the tip (as the real one's does)
	var at := func(u: float, k: float, inset := 0.0) -> Vector3:
		var a := (k / NT) * PI * 2
		var s := sqrt(maxf(0, 1 - u * u))
		var r := maxf(0, r0[int(k)] * s - inset) # (Three indexed r0 with k itself: a half k reads as nothing, NaN)
		return Vector3(cos(a) * r, cy + 0.16 * u * u + sin(a) * r, z0 - L * u)
	# (the cone's radius towards a point, for keeping a gunner's head inside it: weapons.js)
	nose_cone = {z0 = z0, L = L, cy = cy, radius = func(x: float, yy: float, z: float) -> float:
		var u := clampf((z0 - z) / L, 0, 0.999)
		var k := fposmod(atan2(yy - cy - 0.16 * u * u, x) / (PI * 2) + 1, 1.0) * NT
		return r0[roundi(k)] * sqrt(1 - u * u)}
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for i in NU + 1:
		var u := pow(sin((float(i) / NU) * PI / 2), 1.4) * 0.999 # (rows closer together near the tip)
		for k in NT + 1:
			pos.append(at.call(u, k))
			uv.append(Vector2(u * 0.5, 0.5))
	for i in NU:
		for k in NT:
			var a := i * (NT + 1) + k
			var b := a + NT + 1
			idx.append_array([a, b, a + 1, b, b + 1, a + 1])
	var cone = Geo.from_arrays(pos, null, uv, idx)
	cone.compute_vertex_normals()
	var glass := plexiglas(null, Mat.DOUBLE, 0.09) # (a touch more there than the tail's: it's all round you)
	glass.render_priority = 4
	mesh_of(cone, glass, group, "NoseCone")
	var nose := Models.find(model, "Nose") # (this one replaces it, in your bomber)
	if nose:
		nose.visible = false
	# the frames: a heavy riveted ring at the base, two ribs over the top, a ring frame round the middle
	var ring_at := func(u: float, inset: float, r: float, mat: Material, rivets: bool) -> void:
		for k in NT:
			rod(at.call(u, k, inset), at.call(u, k + 1, inset), r, mat, 6)
			if rivets:
				# (Three's at(u, k + 0.5) read r0[k + 0.5], undefined: the rivets went to NaN and weren't drawn)
				pass
	ring_at.call(0.004, 0.012, 0.018, MAT.dark, true)
	# the struts, short of the middle (the guns and the sight look out through clear glass): two over
	# the top, two down either side of the flat panel below
	for q in [[NT * 0.25 - 3, 0.55], [NT * 0.25 + 3, 0.55], [NT * 0.75 - 5, 0.5], [NT * 0.75 + 5, 0.5]]:
		for i in 8:
			var u0: float = i / 8.0 * q[1]
			var u2: float = (i + 1) / 8.0 * q[1]
			rod(at.call(u0, q[0], 0.008), at.call(u2, q[0], 0.008), 0.008, MAT.dark, 5)
	# the two gun sockets: a steel ball in a heavy collar set into the glass, a doubler ring round it
	# (the Browning's jacket goes out through the ball: weapons.js, socketGun)
	for st in STATIONS:
		if not st.get("ball", false):
			continue
		var c := _v(st.pivot)
		var n := (c - Vector3(0, cy, z0)).normalized()
		var q := from_to(Vector3(0, 0, 1), n)
		add(MAT.metal, Geo.sphere(0.062, 16, 10).translate(c.x, c.y, c.z))
		add(MAT.dark, Geo.torus(0.07, 0.016, 8, 24).apply_quaternion(q).translate(c.x, c.y, c.z))
		var c2 := c + n * 0.012
		add(MAT.dark, Geo.torus(0.12, 0.008, 6, 28).apply_quaternion(q).translate(c2.x, c2.y, c2.z))
		for i in 8: # its bolts through the glass
			var a := (i / 8.0) * PI * 2
			var b := q * Vector3(cos(a) * 0.095, sin(a) * 0.095, 0.012) + c
			add(MAT.metal, Geo.sphere(0.006, 5, 3).translate(b.x, b.y, b.z))
	# the optically flat panel, low at the front: a flat pane just inside the cone, in a riveted frame
	var pc: Vector3 = at.call(0.6, NT * 0.75, 0.012)
	var n: Vector3 = (at.call(0.6, NT * 0.75) - at.call(0.6, NT * 0.75, 0.05)).normalized() # outward
	var ex := Vector3(1, 0, 0)
	var ey := n.cross(ex).normalized() # across, and up the slope
	var w := 0.15
	var h := 0.12
	var corners := [[-w, -h], [w, -h], [w, h], [-w, h]].map(func(q): return pc + ex * q[0] + ey * q[1])
	var flat = Geo.from_arrays(PackedVector3Array([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]), null,
		PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 0), Vector2(1, 1), Vector2(0, 1)]))
	flat.compute_vertex_normals()
	mesh_of(flat, glass, group, "NoseFlat")
	for i in 4:
		var a: Vector3 = corners[i]
		var b: Vector3 = corners[(i + 1) % 4]
		rod(a, b, 0.011, MAT.dark, 6)
		var t := 0.1
		while t < 1:
			var q := a.lerp(b, t) - n * 0.01
			add(MAT.metal, Geo.sphere(0.0045, 5, 3).translate(q.x, q.y, q.z))
			t += 0.2
	# the cheek windows: where the side panels' paint marks a window, Plexiglas in it (as the tail pod's)
	var cheeks_list: Array = parts.get("FrontGunPanels", [])
	if cheeks_list.size():
		var cheeks: MeshInstance3D = cheeks_list[0]
		var cm: Material = Models.surface_material(cheeks, 0)
		var map = cm.get_shader_parameter("tex_albedo") if cm is ShaderMaterial else cm.albedo_texture
		var cg := MeshInstance3D.new()
		cg.mesh = cheeks.mesh
		var pg := plexiglas(map, Mat.DOUBLE, 0.13)
		pg.render_priority = 4
		cg.material_override = pg
		cg.transform = cheeks.transform
		cg.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		cg.name = "FrontGunPanels_glass"
		cheeks.get_parent().add_child(cg)
		parts["FrontGunPanels"].append(cg) # (hidden and ghosted with them)

## The top turret's glass dome as seen from inside the bomber (from below, through the ring): the
## same dome you have round your head in the turret, fixed on the ring and turned with the turret,
## so you see the engineer's head and shoulders up in the glass and the sky beyond. (Hidden while
## you're in the turret yourself: then it's on your camera.)
func build_top_dome() -> void:
	var s: Dictionary = STATIONS.filter(func(x): return x.id == "top")[0]
	top_dome = TopTurret.build_top_turret()
	var sight: Node = top_dome.get_child(1)
	top_dome.remove_child(sight) # (not the gunsight: that rides with the gunner's head)
	sight.free()
	top_dome.position = s.eye
	group.add_child(top_dome)
