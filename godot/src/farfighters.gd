extends RefCounted
# Fighters far away are drawn as instanced low-detail copies (one draw call per part per type), like
# the bomber Fleet; only the ones near the camera (and the player's own) use their full model.
# With a hundred fighters in the air this keeps the draw calls and the scene graph small.
# (InstancedMesh -> a MultiMeshInstance3D per mesh of the low-detail model.)

const Models := preload("res://src/models.gd")

const NEAR := 800.0 # m: closer than this a fighter is drawn with its own full model
const MAX := 160 # instances per type

var scene: Node3D
var parts := {} # kind -> [{ mesh: MultiMeshInstance3D, local: Transform3D }] once its low-detail model has loaded
var loading := {}

func _init(scene_: Node3D) -> void:
	scene = scene_

## (Each mesh's transform within the model's root, the root itself left out: Three's matrixWorld of a
## model that isn't in the scene.)
static func _local(o: Node3D, root: Node) -> Transform3D:
	var t := Transform3D()
	var n: Node = o
	while n and n != root:
		if n is Node3D:
			t = (n as Node3D).transform * t
		n = n.get_parent()
	return t

func load(kind: String) -> void:
	if loading.has(kind):
		return
	loading[kind] = true
	var low: Node3D = (await Models.load_model(kind, {lod = true})).scene
	var list := []
	for o in low.find_children("*", "MeshInstance3D", true, false):
		var mi := o as MeshInstance3D
		if mi.mesh == null:
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mi.mesh
		mm.instance_count = MAX
		mm.visible_instance_count = 0
		var mesh := MultiMeshInstance3D.new()
		mesh.multimesh = mm
		# (the model's own materials, as the mesh instance drew them: its overrides if it had any)
		if mi.material_override:
			mesh.material_override = mi.material_override
		elif mi.get_surface_override_material_count() and mi.get_surface_override_material(0):
			mesh.material_override = mi.get_surface_override_material(0)
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		# (frustumCulled = false: the instances spread over kilometres; the AABB covers the whole fight)
		mesh.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
		scene.add_child(mesh)
		list.append({mesh = mesh, local = _local(mi, low)})
	low.free()
	parts[kind] = list

## Each fighter: its own model up close (in the scene), an instance far away (taken out of the scene).
func update(list: Array, cam_pos: Vector3) -> void:
	var n := {}
	for f in list:
		if f.state == "gone":
			continue
		var p = parts.get(f.kind)
		var near: bool = f.player or p == null or f.pos.distance_squared_to(cam_pos) < NEAR * NEAR
		if near:
			if not f.obj.get_parent():
				scene.add_child(f.obj)
			continue
		if f.obj.get_parent():
			scene.remove_child(f.obj)
		var i: int = n.get(f.kind, 0)
		if i >= MAX:
			continue
		for e in p:
			e.mesh.multimesh.set_instance_transform(i, f.xf * e.local)
		n[f.kind] = i + 1
	for kind in parts:
		for e in parts[kind]:
			e.mesh.multimesh.visible_instance_count = n.get(kind, 0)
