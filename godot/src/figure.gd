extends RefCounted
# A B-17 crewman of 14 October 1943 (models/crew/crewman1943.glb): a realistic young man (MPFB /
# MakeHuman, CC0: a proper face, skin and body, on a game-engine skeleton) in the kit the research says
# each station wore that day (hackathon/CREW_GEAR_RESEARCH.md), every piece modelled on him in Blender
# and baked to textures (scripts/crew/: build_crew.py, bake_export.py), all skinned to the one skeleton:
# - outfits (one shown per man, OUTFITS): the B-3 sheepskin jacket and A-3 trousers (the waist and tail
#   gunners at their open windows), the olive B-10 with its mouton collar and olive trousers, the pilots'
#   A-2 with knit cuffs, or the ball gunner's blue F-1 heated suit alone;
# - on his head (HEADGEAR): the B-6 helmet (its sheepskin lining turned out round the face, the earphones,
#   the chin strap) with the goggles up on it, or, for the pilots (opts.cap), the officer's cap crushed
#   under an HS-38 headset, his short hair showing;
# - on everyone: the A-10 Revised mask on its head straps, its corrugated hose, A-6 boots, leather gloves
#   with gauntlets, and the plain olive drab parachute harness with its leg loops, snaps and D-rings;
# - the yellow B-4 Mae West (all but the ball gunner), and the dark green M1 flak vest with its red pull
#   for the men who had one (opts.flak).
# Only the face is left of the body: everything else is always under the clothes, so nothing pokes through.
#
# The figure is posed through a simple joint rig (fig.j: hips, torso, head, arms, legs, as before)
# that pose() and the crew code drive; sync_figures() copies it onto the skeleton each frame.
#
# (Godot: a figure is a Fig, a Node3D carrying what the web game kept in userData: j, rig, model, base,
# is_self, no_head. The skeleton is Godot's Skeleton3D, posed bone by bone the same way; the oxygen hose
# is bent in its vertex shader instead of rewritten on the CPU each frame.)

const Mat := preload("res://src/core/mat.gd")
const CabinLook := preload("res://src/cabinlook.gd")

static var BASE = null # the dressed model, loaded once: instanced for each man
static var figures := {} # (a set: Fig -> true)

# the meshes of each outfit, and the kit every man wears (the GLB's mesh names)
const OUTFITS := {sheep = ["gear_b3", "gear_a3"], b3od = ["gear_b3", "gear_od"], b10 = ["gear_b10", "gear_od"], a2 = ["gear_a2", "gear_od"], f1 = ["gear_f1"]}
const WORN := ["Human", "gear_boots", "gear_gloves", "gear_mask", "gear_harness"]
# on his head: the B-6 helmet and goggles, or (the pilots, opts.cap) the crushed officer's cap and HS-38
# headset, his hair showing under it
const HEADGEAR := {helmet = ["gear_helmet", "gear_goggles", "gear_goggle_lens"], cap = ["gear_cap", "gear_headset", "Human_short02"]} # (Godot turns the glTF's dot into an underscore)
const CHEST := ["gear_maewest", "gear_flak"] # (off on your own body: they sat round your eyes)
const SCALE := 1.05 # the model is 1.65 m: a man of 1.73, the airmen's average
# inside the bomber the crew catch more of the light from the windows than the hull round them does (cabinlook
# INSIDE_AMBIENT 0.3): without it a man in brown leather seen from behind is a black shape
const CREW_AMBIENT := 0.5

## A man: the rig's joints and everything the crew code keeps on him.
class Fig extends Node3D:
	var j: Joints
	var rig: RigData
	var model: Node3D
	var base = null # the pose as placed (crew.gd place): a Dictionary, or null
	var is_self := false
	var no_head := false

class Arm:
	var sh: Node3D
	var el: Node3D

class Leg:
	var hip: Node3D
	var knee: Node3D

class Joints:
	var hips: Node3D
	var torso: Node3D
	var head: Node3D
	var arm_l: Arm
	var arm_r: Arm
	var leg_l: Leg
	var leg_r: Leg

class RigData:
	var skel: Skeleton3D
	var map: Array # [{bone, parent, joint, off}], parents before children
	var bones: Dictionary # name -> index
	var pelvis_at: Vector3
	var fingers: Array
	var arms: Dictionary
	var legs: Dictionary
	var dims: Dictionary
	var grip := 0.35
	var reach = null # [Vector3, Vector3] or null
	var free := [false, false]
	var feet = null # [{at, q}, {at, q}] or null
	var chest: Array # [{mesh, on}]
	var clip: Vector3
	var hose: MeshInstance3D

## Load the crewman (once, before any figure is made).
static func load_crew_model() -> void:
	if BASE:
		return
	var scene: PackedScene = load("res://models/crew/crewman1943.glb")
	var probe: Node3D = scene.instantiate()
	var done := {}
	var mats := {}
	for o in probe.find_children("*", "MeshInstance3D", true, false):
		var mi: MeshInstance3D = o
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var m = mi.mesh.surface_get_material(0)
		if m and not done.has(m):
			done[m] = true
			_tune(m, String(mi.name))
		mats[String(mi.name)] = m
	var top := 0.0
	for o in probe.find_children("*", "MeshInstance3D", true, false):
		top = maxf(top, (o as MeshInstance3D).mesh.get_aabb().end.y)
	probe.free()
	BASE = {scene = scene, mats = mats, info = {height = top * SCALE}}
	# (and his light copy, ~5% of the triangles, no textures of its own: the men seen from outside, crowd.gd)
	if ResourceLoader.exists("res://models/crew/crewman1943_lod.glb"):
		BASE.lod = load("res://models/crew/crewman1943_lod.glb")
	else:
		push_warning("crew LOD not loaded")

## The glTF's own materials, set as the web game sets them as they load.
static func _tune(m: Material, name: String) -> void:
	if not (m is BaseMaterial3D):
		return
	var b: BaseMaterial3D = m
	# (envMapIntensity 0.35: Godot has no per-material reflection strength; inside_light below cuts the
	# indirect light, reflections with it)
	if RegEx.create_from_string("(?i)eyebrow|eyelash|short").search(name):
		b.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		b.alpha_scissor_threshold = 0.4
		b.cull_mode = BaseMaterial3D.CULL_DISABLED
	if RegEx.create_from_string("mask|maewest|flak").search(name):
		b.cull_mode = BaseMaterial3D.CULL_DISABLED # (thin shells: seen from inside at their edges)
	if name.contains("goggle_lens"): # (dark smoked glass: his eyes just seen through it)
		b.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		b.albedo_color.a = 0.8
		b.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		b.roughness = 0.05
		b.metallic = 0.0
		return
	CabinLook.inside_light(b, CREW_AMBIENT)

static func crew_info():
	return BASE.info if BASE else null

# ---- the pose rig: the same joints the crew code has always driven
static func _group(parent: Node3D, pos := Vector3.ZERO) -> Node3D:
	var g := Node3D.new()
	g.rotation_order = EULER_ORDER_XYZ # (Three's order: pose() sets x and z)
	g.position = pos
	parent.add_child(g)
	return g

static func _make_rig(root: Node3D) -> Joints:
	var j := Joints.new()
	j.hips = _group(root, Vector3(0, 0.95, 0))
	j.torso = _group(j.hips)
	j.head = _group(j.torso, Vector3(0, 0.62, 0))
	# (the head's size, for fitting him under the roof: crew.gd fit_under_roof measures this box)
	j.head.set_meta("box", AABB(Vector3(-0.1, 0.005, -0.11), Vector3(0.2, 0.25, 0.22)))
	var arm := func(s: float) -> Arm:
		var a := Arm.new()
		a.sh = _group(j.torso, Vector3(s * 0.2, 0.53, 0))
		a.el = _group(a.sh, Vector3(0, -0.29, 0))
		return a
	var leg := func(s: float) -> Leg:
		var l := Leg.new()
		l.hip = _group(j.hips, Vector3(s * 0.1, 0, 0))
		l.knee = _group(l.hip, Vector3(0, -0.44, 0))
		return l
	j.arm_l = arm.call(-1.0)
	j.arm_r = arm.call(1.0)
	j.leg_l = leg.call(-1.0)
	j.leg_r = leg.call(1.0)
	return j

const FINGERS := ["index", "middle", "ring", "pinky"]

## A node's transform relative to `root` (an ancestor), worked out up its parents (no tree needed).
static func _rel(n: Node3D, root: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	while n and n != root:
		t = n.transform * t
		n = n.get_parent() as Node3D
	return t

static func _qrot(b: Basis) -> Quaternion:
	return b.get_rotation_quaternion()

## opts.outfit: 'sheep' | 'b3od' | 'b10' | 'a2' | 'f1' (OUTFITS; opts.pilot: the A-2). opts.flak: the M1 vest
## over the Mae West. opts.self: your own body (no head: it would sit round your eyes). opts.lod: the light
## copy (seen from outside the bomber, crowd.gd). Feet at the origin, facing -Z.
static func make_figure(opts := {}) -> Fig:
	if not BASE:
		push_error("load_crew_model() first")
		return null
	var root := Fig.new()
	root.rotation_order = EULER_ORDER_XYZ
	var j := _make_rig(root)
	var lod: bool = opts.get("lod", false) and BASE.has("lod")
	var model: Node3D = (BASE.lod if lod else BASE.scene).instantiate()
	model.rotation.y = PI # the model faces +Z; the crew face -Z
	model.scale = Vector3.ONE * SCALE
	root.add_child(model)
	var kind: String = opts.get("outfit", "") if OUTFITS.has(opts.get("outfit", "")) else ("a2" if opts.get("pilot", false) else "sheep")
	var show := {}
	for n in WORN + OUTFITS[kind] + HEADGEAR["cap" if opts.get("cap", false) else "helmet"]:
		show[n] = true
	if kind != "f1":
		show["gear_maewest"] = true # (the ball gunner wore none in his turret)
	if opts.get("flak", false):
		show["gear_flak"] = true
	var skel: Skeleton3D = null
	var chest := []
	var face_re := RegEx.create_from_string("(?i)^Human|eye|low-poly")
	for o in model.find_children("*", "MeshInstance3D", true, false):
		var mi: MeshInstance3D = o
		var name := String(mi.name)
		var face := face_re.search(name) != null and not name.contains("short") # (the face, its eyes, brows and lashes; not the hair)
		mi.visible = face or show.has(name)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.extra_cull_margin = 2.0 # (posed far from his rest pose: never culled by it)
		if lod and BASE.mats.has(name) and BASE.mats[name]: # (its meshes given the full model's materials)
			mi.material_override = BASE.mats[name]
		if CHEST.has(name) and mi.visible:
			chest.append({mesh = mi, on = true})
	skel = model.find_children("*", "Skeleton3D", true, false)[0]
	var bones := {}
	for i in skel.get_bone_count():
		bones[skel.get_bone_name(i)] = i
	if opts.get("self", false): # (your own: no head, and no chest kit round your eyes when you look down)
		skel.set_bone_pose_scale(bones.Head, Vector3.ONE * 0.001)
		root.is_self = true
		for c in chest:
			c.on = false

	# bind the rig to the skeleton: put the rig in the model's rest pose (its limbs pointing the way the
	# bones do), and remember, for each bone, its rotation relative to its rig joint
	var sk_rel := _rel(skel, root)
	var bw := func(name: String) -> Transform3D: return sk_rel * skel.get_bone_global_pose(bones[name])
	var W := func(name: String) -> Vector3: return (bw.call(name) as Transform3D).origin
	var BQ := func(name: String) -> Quaternion: return _qrot((bw.call(name) as Transform3D).basis)
	# where the mask's hose ends, clipped to the harness on his chest (build_crew.py: straight down from the mask,
	# 32 cm under the neck, in the middle of his chest, 17 cm out in front), carried by the upper spine: the oxygen line runs on from there
	var clip_w: Vector3 = W.call("neck_01") + _qrot(_rel(model, root).basis) * (Vector3(0, -0.32, 0.17) * SCALE)
	var clip: Vector3 = (bw.call("spine_03") as Transform3D).affine_inverse() * clip_w
	var hose := _make_hose()
	root.add_child(hose)
	var dir_of := func(a: String, b: String) -> Vector3: return ((W.call(b) as Vector3) - (W.call(a) as Vector3)).normalized()
	var aim := func(joint: Node3D, dir: Vector3) -> void: # turn a joint so its -Y (down the limb) points along dir
		var pq := _qrot(_rel(joint.get_parent(), root).basis).inverse()
		joint.quaternion = Quaternion(Vector3(0, -1, 0), pq * dir)
	aim.call(j.arm_l.sh, dir_of.call("upperarm_l", "lowerarm_l")); aim.call(j.arm_l.el, dir_of.call("lowerarm_l", "hand_l"))
	aim.call(j.arm_r.sh, dir_of.call("upperarm_r", "lowerarm_r")); aim.call(j.arm_r.el, dir_of.call("lowerarm_r", "hand_r"))
	aim.call(j.leg_l.hip, dir_of.call("thigh_l", "calf_l")); aim.call(j.leg_l.knee, dir_of.call("calf_l", "foot_l"))
	aim.call(j.leg_r.hip, dir_of.call("thigh_r", "calf_r")); aim.call(j.leg_r.knee, dir_of.call("calf_r", "foot_r"))
	var pairs := [ # [bone, rig joint], parents before children
		["pelvis", j.hips], ["spine_01", j.torso], ["spine_02", j.torso], ["spine_03", j.torso], ["neck_01", j.head], ["Head", j.head],
		["clavicle_l", j.torso], ["upperarm_l", j.arm_l.sh], ["lowerarm_l", j.arm_l.el], ["hand_l", j.arm_l.el],
		["clavicle_r", j.torso], ["upperarm_r", j.arm_r.sh], ["lowerarm_r", j.arm_r.el], ["hand_r", j.arm_r.el],
		["thigh_l", j.leg_l.hip], ["calf_l", j.leg_l.knee], ["foot_l", j.leg_l.knee], ["thigh_r", j.leg_r.hip], ["calf_r", j.leg_r.knee], ["foot_r", j.leg_r.knee],
	]
	var map := []
	for p in pairs:
		var bi: int = bones[p[0]]
		var off: Quaternion = _qrot(_rel(p[1], root).basis).inverse() * BQ.call(p[0])
		map.append({bone = bi, parent = skel.get_bone_parent(bi), joint = p[1], off = off})
	var pelvis_at: Vector3 = _rel(j.hips, root).affine_inverse() * (W.call("pelvis") as Vector3) # the pelvis in the hips joint's frame
	# each finger joint's own bend axis, from the skeleton in its rest pose: it curls the finger towards
	# the palm (whose normal comes from the hand's forward and across directions); the thumb across it
	var fingers := []
	for s in ["l", "r"]:
		var hand: Vector3 = W.call("hand_" + s)
		var across: Vector3 = ((W.call("index_01_" + s) as Vector3) - W.call("pinky_01_" + s)).normalized()
		var along: Vector3 = ((W.call("middle_01_" + s) as Vector3) - hand).normalized()
		var palm := along.cross(across).normalized()
		if palm.y > 0: # (the rest pose holds the arms out, palms down)
			palm = -palm
		for f in FINGERS + ["thumb"]:
			for k in range(1, 4):
				var bn := "%s_0%d_%s" % [f, k, s]
				if not bones.has(bn):
					continue
				var cn := "%s_0%d_%s" % [f, k + 1, s]
				if not bones.has(cn): # (no joint beyond it to aim by: the GLB has no leaf bones, so the tips stay as they are)
					continue
				var dir: Vector3 = ((W.call(cn) as Vector3) - W.call(bn)).normalized()
				var toward: Vector3 = (palm * 0.7 - across * 0.7).normalized() if f == "thumb" else palm # the thumb closes across the palm
				var axis: Vector3 = BQ.call(bn).inverse() * dir.cross(toward).normalized()
				fingers.append({b = bones[bn], rest = skel.get_bone_pose_rotation(bones[bn]), axis = axis, thumb = f == "thumb", k = k})
	# the arms' bone lengths, for reaching the grips (two-bone IK)
	var arm := func(s: String) -> Dictionary:
		return {upper = bones["upperarm_" + s], lower = bones["lowerarm_" + s], hand = bones["hand_" + s],
			a = (W.call("upperarm_" + s) as Vector3).distance_to(W.call("lowerarm_" + s)), b = (W.call("lowerarm_" + s) as Vector3).distance_to(W.call("hand_" + s))}
	# and the legs', for standing on the floor where the crew code plants his feet (two-bone IK too), each foot's
	# rest turn (flat on the floor, the way he faces) and the ankle's height over the sole
	var leg := func(s: String) -> Dictionary:
		return {upper = bones["thigh_" + s], lower = bones["calf_" + s], foot = bones["foot_" + s],
			a = (W.call("thigh_" + s) as Vector3).distance_to(W.call("calf_" + s)), b = (W.call("calf_" + s) as Vector3).distance_to(W.call("foot_" + s)),
			rest = BQ.call("foot_" + s), ankle = (W.call("foot_" + s) as Vector3).y}
	var legs := {l = leg.call("l"), r = leg.call("r")}
	# his proportions, for posing him to a gun's sight (crew.gd): the pelvis's height, the spine from the
	# pelvis up to the head bone, and the eyes from it (in front of and above the skull's base)
	var dims := {hip = (W.call("pelvis") as Vector3).y, spine = (W.call("Head") as Vector3).distance_to(W.call("pelvis")), eye = Vector3(0, 0.075, -0.095) * SCALE,
		leg_len = legs.l.a + legs.l.b + legs.l.ankle}
	# the rig back to its neutral pose (pose() sets it from here)
	for g in [j.arm_l.sh, j.arm_l.el, j.arm_r.sh, j.arm_r.el, j.leg_l.hip, j.leg_l.knee, j.leg_r.hip, j.leg_r.knee]:
		(g as Node3D).quaternion = Quaternion.IDENTITY
		(g as Node3D).rotation_order = EULER_ORDER_XYZ
	root.j = j
	root.model = model
	var rig := RigData.new()
	rig.skel = skel; rig.map = map; rig.bones = bones; rig.pelvis_at = pelvis_at; rig.fingers = fingers
	rig.arms = {l = arm.call("l"), r = arm.call("r")}; rig.legs = legs; rig.dims = dims
	rig.chest = chest; rig.clip = clip; rig.hose = hose
	root.rig = rig
	figures[root] = true # (freed figures drop out in sync_figures)
	return root

## Put his hands on the grips: [left, right] world positions (or null to let the pose's arms be). The
## arms reach with two-bone IK each frame, the elbows down and out, and the fingers close round them.
static func reach_for(fig: Fig, grips) -> void:
	var rig := fig.rig
	if not rig:
		return
	if grips == null:
		rig.reach = null
		return
	if rig.reach == null:
		rig.reach = [Vector3(), Vector3()]
	rig.free = [grips[0] == null, grips[1] == null] # (a null hand stays as posed)
	for i in 2:
		if grips[i] != null:
			rig.reach[i] = grips[i]
	rig.grip = 1.0

## Plant his feet: [left, right], each {at: world point on the floor, q: world turn of the foot} (or
## null to let the pose's legs be). The legs reach them with two-bone IK, the knees bending forward.
static func plant_feet(fig: Fig, feet) -> void:
	if fig.rig:
		fig.rig.feet = feet

## Curl the fingers: 0 open, 1 a fist round a grip.
static func grip(fig: Fig, amount: float) -> void:
	if fig.rig:
		fig.rig.grip = amount

## Copy each figure's rig pose onto its skeleton (call once a frame, before drawing).
static func sync_figures() -> void:
	for fig in figures.keys():
		if not is_instance_valid(fig):
			figures.erase(fig)
			continue
		if fig.is_inside_tree() and fig.is_visible_in_tree():
			sync(fig)

static func _bone_world(rig: RigData, skg: Transform3D, i: int) -> Transform3D:
	return skg * rig.skel.get_bone_global_pose(i)

static func _parent_q(rig: RigData, skg: Transform3D, parent: int) -> Quaternion:
	return _qrot(skg.basis) * (_qrot(rig.skel.get_bone_global_pose(parent).basis) if parent >= 0 else Quaternion.IDENTITY)

static func sync(fig: Fig) -> void:
	var rig := fig.rig
	var sk := rig.skel
	var skg := sk.global_transform
	# the pelvis follows the hips joint
	var pv: int = rig.bones.pelvis
	var pp := sk.get_bone_parent(pv)
	var pw := skg * (sk.get_bone_global_pose(pp) if pp >= 0 else Transform3D.IDENTITY)
	sk.set_bone_pose_position(pv, pw.affine_inverse() * (fig.j.hips.global_transform * rig.pelvis_at))
	# (parents before children: each bone's rotation from its rig joint's, in its parent's frame)
	for m in rig.map:
		var q: Quaternion = _qrot((m.joint as Node3D).global_transform.basis) * m.off # where the bone should point, in the world
		sk.set_bone_pose_rotation(m.bone, _parent_q(rig, skg, m.parent).inverse() * q)
	if fig.is_self: # (your own: never drawn round your eyes)
		sk.set_bone_pose_scale(rig.bones.Head, Vector3.ONE * 0.001)
	else:
		sk.set_bone_pose_scale(rig.bones.Head, Vector3.ONE * (0.01 if fig.no_head else 1.0))
	for c in rig.chest: # (and the Mae West under your chin)
		(c.mesh as MeshInstance3D).visible = c.on and not fig.no_head
	if rig.reach != null:
		_reach(rig, fig, skg)
	if rig.feet != null:
		_stand(rig, fig, skg)
	var g := rig.grip
	for f in rig.fingers: # curl about each joint's own bend axis: more at the knuckle, a fist at 1
		sk.set_bone_pose_rotation(f.b, f.rest * Quaternion(f.axis, g * (0.45 if f.thumb else [0.0, 1.15, 1.3, 0.9][f.k])))
	_oxygen_line(fig, skg)

# ---- the oxygen line: from the clip on his chest to the A-12 regulator at his post (the nearest outlet
# the cabin has, interiordetail.gd), a rubber hose hanging slack between them. Away from any (moving
# through the ship, bailing out) he's off the line, as men were on a walk-around bottle.
const HOSE_LEN := 1.7
const HOSE_SEG := 200
const HOSE_SIDES := 8
const HOSE_R := 0.011 # (rings close enough to draw its corrugations)
static var _hose_mesh: ArrayMesh
static var _hose_mat: ShaderMaterial
# (Godot: the hose's rings are placed along the curve by its vertex shader, from the curve's four points
# given per man as instance uniforms: the same cubic, the same corrugation, no mesh rewritten each frame)
const HOSE_SHADER := """
shader_type spatial;
render_mode cull_disabled;
instance uniform vec3 hose_a;
instance uniform vec3 hose_p1;
instance uniform vec3 hose_p2;
instance uniform vec3 hose_b;
instance uniform float hose_r = 0.011;
uniform vec3 albedo : source_color = vec3(0.106, 0.106, 0.098);
uniform float inside = 0.5;
vec3 bez(float t) {
	float u = 1.0 - t;
	return hose_a * u * u * u + hose_p1 * 3.0 * u * u * t + hose_p2 * 3.0 * u * t * t + hose_b * t * t * t;
}
vec3 tangent_at(float t) {
	float u = 1.0 - t;
	return normalize(3.0 * u * u * (hose_p1 - hose_a) + 6.0 * u * t * (hose_p2 - hose_p1) + 3.0 * t * t * (hose_b - hose_p2) + vec3(1e-6));
}
void vertex() {
	float t = VERTEX.x, a = VERTEX.y, ring = VERTEX.z; // (the mesh carries where on the hose each vertex is)
	vec3 p = bez(t), tg = tangent_at(t);
	vec3 ref = abs(tg.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
	vec3 n1 = normalize(cross(cross(tg, ref), tg)), n2 = cross(tg, n1);
	vec3 n = n1 * cos(a) + n2 * sin(a);
	float r = hose_r * (ring > 0.5 ? 0.82 : 1.0); // (corrugated: every other ring drawn in)
	VERTEX = p + n * r;
	NORMAL = n;
}
void fragment() {
	ALBEDO = albedo;
	ROUGHNESS = 0.55;
	AO = inside; AO_LIGHT_AFFECT = 0.0;
}
"""

static func _make_hose() -> MeshInstance3D:
	if not _hose_mesh:
		var pos := PackedVector3Array()
		var idx := PackedInt32Array()
		for i in HOSE_SEG + 1:
			for s in HOSE_SIDES:
				pos.append(Vector3(float(i) / HOSE_SEG, (float(s) / HOSE_SIDES) * TAU, float(i % 2)))
		for i in HOSE_SEG:
			for k in HOSE_SIDES:
				var a := i * HOSE_SIDES + k
				var b := i * HOSE_SIDES + (k + 1) % HOSE_SIDES
				idx.append_array([a, a + HOSE_SIDES, b, b, a + HOSE_SIDES, b + HOSE_SIDES]) # (Godot's clockwise)
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = pos
		arr[Mesh.ARRAY_INDEX] = idx
		_hose_mesh = ArrayMesh.new()
		_hose_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		_hose_mesh.custom_aabb = AABB(Vector3(-10, -10, -10), Vector3(20, 20, 20))
		var sh := Shader.new()
		sh.code = HOSE_SHADER
		_hose_mat = ShaderMaterial.new()
		_hose_mat.shader = sh
		_hose_mat.set_shader_parameter("inside", CREW_AMBIENT)
	var m := MeshInstance3D.new()
	m.mesh = _hose_mesh
	m.material_override = _hose_mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	m.visible = false
	return m

static func _oxygen_line(fig: Fig, skg: Transform3D) -> void:
	var rig := fig.rig
	var hose := rig.hose
	var par := fig.get_parent() as Node3D
	hose.visible = false
	if par == null or not par.has_meta("oxygen") or (fig.model and not fig.model.visible): # (and not when he isn't drawn: crew.gd solid)
		return
	var outlets: Array = par.get_meta("oxygen")
	# in the figure's own frame: the clip, the nearest outlet, and "down" (the bomber's)
	var A := _bone_world(rig, skg, rig.bones.spine_03) * rig.clip
	var pt := par.global_transform.affine_inverse() * A
	var best = null
	var bd := HOSE_LEN * 0.95
	for o in outlets:
		var d: float = (o as Vector3).distance_to(pt)
		if d < bd:
			bd = d
			best = o
	if best == null:
		return
	var inv := fig.global_transform.affine_inverse()
	A = inv * A
	var B: Vector3 = inv * (par.global_transform * (best as Vector3))
	var D := (_qrot(fig.global_transform.basis).inverse() * (par.global_transform.basis * Vector3(0, -1, 0))).normalized()
	var k := 1.0 / fig.global_transform.basis.get_scale().x # (the hose is the cabin's size, not his)
	# hanging: a cubic from the chest down and round to the outlet, the slack deeper the closer they are
	var sag := 0.5 * sqrt(maxf(0.0, HOSE_LEN * HOSE_LEN - bd * bd)) * k
	hose.set_instance_shader_parameter("hose_a", A)
	hose.set_instance_shader_parameter("hose_p1", A + D * (0.12 * k + sag * 0.7))
	hose.set_instance_shader_parameter("hose_p2", B + D * (sag * 0.8))
	hose.set_instance_shader_parameter("hose_b", B)
	hose.set_instance_shader_parameter("hose_r", HOSE_R * k)
	hose.visible = true

## Two-bone IK: turn upper and lower arm so the hand lands on its grip, the elbow bending down and out.
static func _reach(rig: RigData, fig: Fig, skg: Transform3D) -> void:
	var qf := _qrot(fig.global_transform.basis)
	var k := fig.global_transform.basis.get_scale().x # (bone lengths were measured at full size)
	for side_i in [["l", 0, -1.0], ["r", 1, 1.0]]:
		var i: int = side_i[1]
		if rig.free[i]:
			continue
		var side: float = side_i[2]
		var A: Dictionary = rig.arms[side_i[0]]
		var S := _bone_world(rig, skg, A.upper).origin
		var T: Vector3 = rig.reach[i]
		# the wrist goes a hand's length short of the grip, so it's the palm that closes round it
		var u := (T - S).normalized()
		T -= u * 0.075
		var a: float = A.a * k
		var b: float = A.b * k
		var d := minf(S.distance_to(T), (a + b) * 0.999)
		# the elbow: down, out to his side and a little back (in the world, from his body's frame); reaching up
		# to a grip above his shoulder (the radio hatch gun) it swings out and forward instead, never back
		# behind his head
		var up := (qf * Vector3(0, 1, 0)).dot(u)
		var hi := clampf((up - 0.1) / 0.5, 0, 1)
		var p := qf * Vector3(side * (0.6 + 0.5 * hi), -1 + 0.6 * hi, 0.35 - 0.9 * hi)
		p = (p - u * p.dot(u)).normalized()
		var cos_a := clampf((a * a + d * d - b * b) / (2 * a * d), -1, 1)
		var E := S + u * (a * cos_a) + p * (a * sqrt(1 - cos_a * cos_a))
		_aim_bone(rig, skg, A.upper, A.lower, E)
		_aim_bone(rig, skg, A.lower, A.hand, S + u * d)

## Two-bone IK for the legs: the ankle over its planted foot, the knee forward (and a little out), the foot flat.
static func _stand(rig: RigData, fig: Fig, skg: Transform3D) -> void:
	var qf := _qrot(fig.global_transform.basis)
	var k := fig.global_transform.basis.get_scale().x
	for side_i in [["l", 0, -1.0], ["r", 1, 1.0]]:
		var f = rig.feet[side_i[1]]
		if f == null:
			continue
		var side: float = side_i[2]
		var L: Dictionary = rig.legs[side_i[0]]
		var S := _bone_world(rig, skg, L.upper).origin
		var lu := qf * Vector3(0, 1, 0)
		var T: Vector3 = f.at + lu * (L.ankle * k)
		var u := T - S
		var dist := u.length()
		u /= dist if dist else 1.0
		var a: float = L.a * k
		var b: float = L.b * k
		var d := minf(dist, (a + b) * 0.999)
		var fq: Quaternion = f.q if f.get("q") != null else qf
		var lk := fq * Vector3(side * 0.18, 0, -1) # (the knee over the toes, turned out a little)
		lk = (lk - u * lk.dot(u)).normalized()
		var cos_a := clampf((a * a + d * d - b * b) / (2 * a * d), -1, 1)
		var P := S + u * (a * cos_a) + lk * (a * sqrt(1 - cos_a * cos_a))
		_aim_bone(rig, skg, L.upper, L.lower, P)
		_aim_bone(rig, skg, L.lower, L.foot, S + u * d)
		# the foot flat on the floor, turned the way it was put down
		var foot: int = L.foot
		rig.skel.set_bone_pose_rotation(foot, _parent_q(rig, skg, rig.skel.get_bone_parent(foot)).inverse() * (fq * L.rest))

## Turn `bone` (in the world) so its child `tip` lands at world point `to`.
static func _aim_bone(rig: RigData, skg: Transform3D, bone: int, tip: int, to: Vector3) -> void:
	var bw := _bone_world(rig, skg, bone)
	var cur := (_bone_world(rig, skg, tip).origin - bw.origin).normalized()
	var want := (to - bw.origin).normalized()
	if cur.is_zero_approx() or want.is_zero_approx():
		return
	var world := _arc(cur, want) * _qrot(bw.basis)
	rig.skel.set_bone_pose_rotation(bone, _parent_q(rig, skg, rig.skel.get_bone_parent(bone)).inverse() * world)

## The shortest turn from one unit direction to another (Three's setFromUnitVectors, safe when opposite).
static func _arc(a: Vector3, b: Vector3) -> Quaternion:
	var r := a.dot(b) + 1.0
	if r < 1e-6:
		var ax := Vector3(-a.y, a.x, 0) if absf(a.x) > absf(a.z) else Vector3(0, -a.z, a.y)
		return Quaternion(ax.x, ax.y, ax.z, 0).normalized()
	var c := a.cross(b)
	return Quaternion(c.x, c.y, c.z, r).normalized()

## Bake posed figures into plain meshes, in `frame`'s space: {figure: {material: ArrayMesh arrays}}, for
## drawing men who needn't move many at a time (crowd.gd). Best made of light copies (opts.lod). The figures
## and `frame` must be in the scene tree (the skeleton's pose is read from there).
static func bake_figures(figs: Array, frame: Node3D) -> Dictionary:
	var out := {}
	var inv := frame.global_transform.affine_inverse()
	for fig in figs:
		var mine := {}
		out[fig] = mine
		sync(fig)
		for o in (fig as Fig).model.find_children("*", "MeshInstance3D", true, false):
			var t: MeshInstance3D = o
			if not t.visible or t.skin == null:
				continue
			# (Godot skins him natively: the mesh as the skeleton now holds it, in the mesh's own space)
			var baked := t.bake_mesh_from_current_skeleton_pose()
			if baked == null or baked.get_surface_count() == 0:
				continue
			var arr := baked.surface_get_arrays(0)
			var xf := inv * t.global_transform
			var nb := xf.basis.orthonormalized() # (uniform scale: the normals only turn)
			arr[Mesh.ARRAY_VERTEX] = xf * (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array)
			if arr[Mesh.ARRAY_NORMAL] != null:
				arr[Mesh.ARRAY_NORMAL] = Transform3D(nb, Vector3.ZERO) * (arr[Mesh.ARRAY_NORMAL] as PackedVector3Array)
			if arr[Mesh.ARRAY_TANGENT] != null:
				var tg: PackedFloat32Array = arr[Mesh.ARRAY_TANGENT]
				for i in range(0, tg.size(), 4):
					var v := nb * Vector3(tg[i], tg[i + 1], tg[i + 2])
					tg[i] = v.x; tg[i + 1] = v.y; tg[i + 2] = v.z
				arr[Mesh.ARRAY_TANGENT] = tg
			arr[Mesh.ARRAY_BONES] = null
			arr[Mesh.ARRAY_WEIGHTS] = null
			var mat: Material = t.material_override if t.material_override else t.mesh.surface_get_material(0)
			mine[mat] = arr
	return out
