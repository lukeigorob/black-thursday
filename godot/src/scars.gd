extends RefCounted
# Battle damage you can see on the outside of the bomber, and the grime of hard flying:
#  - every hit leaves a hole: a dark puncture, the paint flaked round it to bare metal, and soot
#    blown back from it (cannon shells: bigger, ragged, scorched);
#  - each engine's exhaust has stained the nacelle and the wing behind it.
# All in the hull's shaders (bomber_skin.gdshader, SCARS), from a list of the last hits in bomber space, so
# there's no extra geometry or draw call. Bomber space: the web game baked it into a vertex attribute (the
# GLB's parts each have their own transform, but every clone shares its geometry); here the shader works it
# out from the bomber's own frame, which flush_scars() hands it each frame.
#
# Three shared one uniform object between every material that showed the holes (the hull's, and the cabin's
# lining in interior.js). Godot keeps a material's values on the material, so the materials that show them are
# registered (register()) and given the list whenever it changes, as these shader parameters:
#   hits (vec4[32]: xyz, w = radius, 0: none), scar_on (float), hole_light (float), bomber_inv (mat4).
# Set the quality and the light through set_detail() and set_light() (main.js wrote SCARS.detail.value and
# SCARS.light.value).

const Models := preload("res://src/models.gd")

const MAX := 32
const SCAR_MAX := MAX
static func _empty_hits() -> Array:
	var a := []
	for i in MAX:
		a.append(Vector4(0, -100, 0, 0))
	return a
static var SCARS := {
	light = 1.0, # daylight through a hole, seen from inside (dim by night: main)
	hits = _empty_hits(), # xyz, w = radius (0: none)
	detail = 1.0, # the quality setting: 0 turns it all off
	next = 0,
}
static var _mats: Array = [] # every material showing them
static var _root: Node3D = null # the scarred model (its parent: the bomber's frame)

## Register a material (a ShaderMaterial with the parameters above) to be kept up to date.
static func register(m: ShaderMaterial) -> void:
	if not m in _mats:
		_mats.append(m)
		_push(m)

static func _push(m: ShaderMaterial) -> void:
	m.set_shader_parameter("hits", PackedVector4Array(SCARS.hits))
	m.set_shader_parameter("scar_on", SCARS.detail)
	m.set_shader_parameter("hole_light", SCARS.light)

static func _push_all() -> void:
	for m in _mats:
		_push(m)

static func set_detail(v: float) -> void:
	SCARS.detail = v
	_push_all()

static func set_light(v: float) -> void:
	SCARS.light = v
	_push_all()

## Mark every mesh of a loaded B-17 as in bomber space (the meshes the holes are found on: collect), once.
static func bake_bomber_space(root: Node3D) -> void:
	_root = root
	for o in root.find_children("*", "MeshInstance3D", true, false):
		o.set_meta("bomber_space", true)

## Give a hull material the scars and the exhaust staining. Returns the material to draw with (Godot can't add
## to a material in place, as onBeforeCompile did): put it on the mesh, or use scar_model.
static func scar_material(mat: Material) -> Material:
	if not mat or mat.get_meta("glass", false) or (mat is ShaderMaterial and not mat.has_meta("skin_defines")):
		return mat
	if not (mat is BaseMaterial3D or mat is ShaderMaterial):
		return mat
	var m := Models.skin(mat, ["SCARS"])
	register(m)
	return m

## Every mesh of the model in bomber space but the hull's inner lining, its materials scarred (main.js's
## traverse with scarMaterial).
static func scar_model(root: Node3D) -> void:
	for o in root.find_children("*", "MeshInstance3D", true, false):
		if not o.get_meta("bomber_space", false) or o.name.ends_with("_lining"):
			continue
		for i in o.mesh.get_surface_count():
			var m := Models.surface_material(o, i)
			var s := scar_material(m)
			if s != m:
				o.set_surface_override_material(i, s)

static var _pending: Array = [] # hits waiting to be marked (a flak burst can put thirty-odd through her at once)
const PER_FRAME := 3 # (each is a ray against the whole model: a few a frame, the rest the next)

## A round hit the player's bomber at bomber-space point `local`, travelling `dir` (bomber space): the
## hole is marked over the next frames (flush_scars), only the latest MAX kept, as on her skin.
static func add_scar(bomber, local: Vector3, dir: Vector3, cannon: bool) -> void:
	if not bomber.model or not SCARS.detail:
		return
	_pending.append({bomber = bomber, local = local, dir = dir, cannon = cannon})
	if _pending.size() > MAX:
		_pending.pop_front()

## Each frame: mark a few of the waiting hits (and give the shaders the bomber's frame).
static func flush_scars() -> void:
	for i in PER_FRAME:
		if not _pending.size():
			break
		var s: Dictionary = _pending.pop_front()
		_mark_scar(s.bomber, s.local, s.dir, s.cannon)
	if _root and is_instance_valid(_root) and _root.get_parent() is Node3D:
		var inv: Transform3D = (_root.get_parent().global_transform if _root.is_inside_tree() else _root.get_parent().transform).affine_inverse()
		var p := Projection(inv)
		for m in _mats:
			m.set_shader_parameter("bomber_inv", p)

## Find the skin a hit went through (a ray against the model) and mark it there.
static func _mark_scar(bomber, local: Vector3, dir: Vector3, cannon: bool) -> void:
	var model: Node3D = bomber.model
	if not model or not SCARS.detail:
		return
	if bomber.scar_meshes == null:
		bomber.scar_meshes = _collect(model)
	var d := dir.normalized()
	var meshes: Array = bomber.scar_meshes.filter(func(o): return _shown(o)) # (only what's there now: a part shot away, or hidden then, takes no hole)
	var hit := Models.raycast(meshes, bomber.group, local - d * 1.5, d, 4.0)
	if hit.is_empty():
		return
	var p: Vector3 = hit.point
	SCARS.hits[SCARS.next] = Vector4(p.x, p.y, p.z, 0.2 + randf() * 0.08 if cannon else 0.06 + randf() * 0.03)
	SCARS.next = (SCARS.next + 1) % MAX
	_push_all()

# (every skin mesh, hidden or not, so a part hidden at the first hit still gets holes once it shows)
static func _collect(model: Node3D) -> Array:
	var out := []
	for o in model.find_children("*", "MeshInstance3D", true, false):
		if not o.name.ends_with("_lining") and o.get_meta("bomber_space", false):
			out.append(o)
	return out

static func _shown(o: Node) -> bool:
	var x := o
	while x:
		if x is Node3D and not x.visible:
			return false
		x = x.get_parent()
	return true

## A fresh bomber (or the player moved to another one): no holes.
static func clear_scars() -> void:
	_pending.clear()
	SCARS.hits = _empty_hits()
	SCARS.next = 0
	_push_all()
