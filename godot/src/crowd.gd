extends RefCounted
# The men seen from outside: the crews of the B-17s near you at their stations (the pilots in their seats,
# the nose men kneeling at their guns, the engineer up in the top turret, the radio, waist and tail gunners
# at theirs), your own crew seen from out behind her (the third-person view from the pilots' seats, where
# her cabin isn't drawn), and the pilot in a fighter that comes close. Each is the crewman's light copy
# (figure.gd), posed once at his station as in your own bomber and baked into plain meshes: no skeletons to
# update, one draw a material for all the bombers' crews together (instanced), one for all the pilots. Only
# the nearest few are drawn, none further than you could make out a man through a window.
#
# (Godot: the script is the Crowds class, `Crowd.new(scene, interior)`. A crowd is one ArrayMesh, a surface a material, drawn by one
# MultiMeshInstance3D: still one draw a material.)

const Figure := preload("res://src/figure.gd")
const CrewM := preload("res://src/crew.gd")

const BOMBER_NEAR := 150.0
const BOMBERS_MAX := 5 # m from the camera, and at most this many crews drawn
const FIGHTER_NEAR := 120.0
const FIGHTERS_MAX := 6
const EYE := {bf109 = Vector3(0, 0.75, -0.8), p47 = Vector3(0, 1.05, -0.2), fw190 = Vector3(0, 0.86, -0.22)} # (the pilot's eye in each: pilot.gd)

var scene: Node3D
var interior
var ready := false
var by_role := {}
var bombers: MultiMeshInstance3D
var pilots: MultiMeshInstance3D
var own: MeshInstance3D
var own_key = null

## interior: your own bomber's (the hull the men are fitted under: every B-17's the same).
func _init(scene_: Node3D, interior_) -> void:
	scene = scene_
	interior = interior_

## Bake the men (once the crewman has loaded).
func build() -> void:
	if ready or not Figure.crew_info() or not scene.is_inside_tree():
		return
	# a bomber's crew at their stations (the ball gunner is down in his turret: not seen)
	var frame := Node3D.new()
	scene.add_child(frame) # (in the tree, at the origin: the skeletons are posed and read there)
	# (fitted under your own bomber's roof: the hull's measurements are in its interior group's frame, so the
	# men are posed in a stand-in for it here, at the origin)
	var roles := CrewM.ROLES.filter(func(r): return r.id != "ball")
	var men := []
	for i in roles.size():
		var r: Dictionary = roles[i]
		var s: Dictionary = CrewM.SPOTS[r.id]
		var fig := Figure.make_figure(CrewM.KIT[r.id].merged({seed = i * 7 + 3, lod = true}))
		if r.id.begins_with("waist"):
			fig.scale = Vector3.ONE * 0.92
		frame.add_child(fig)
		fig.position = CrewM._v(s.at)
		fig.rotation.y = s.yaw
		if r.id == "tail": # (a little further in, where her tail's tall enough for a kneeling man: at his post he'd come through her skin)
			fig.position.z -= 1.0
			fig.position.y += 0.1
		CrewM.pose(fig, s.pose)
		CrewM.fit_under_roof(fig, interior, s.pose)
		# (the tail and radio gunners' hands down on their grips: raised, they'd come up through her skin, or
		# look like a man putting his hands up)
		if r.id == "tail" or r.id == "radio":
			for a in [fig.j.arm_l, fig.j.arm_r]:
				a.sh.rotation.x = 0.55; a.el.rotation.x = 0.9
		men.append(fig)
	var baked := Figure.bake_figures(men, frame)
	for i in roles.size(): # (your own crew: only the men at their posts)
		by_role[roles[i].id] = baked[men[i]]
	bombers = _instanced(_by_material(baked.values()), BOMBERS_MAX)
	own = MeshInstance3D.new()
	own.top_level = true
	own.visible = false
	own.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	scene.add_child(own)
	# a fighter pilot in his seat (helmet and goggles, a leather jacket), baked with his eye at the origin
	var pf := Figure.make_figure({seed = 11, outfit = "a2", lod = true})
	frame.add_child(pf)
	CrewM.pose(pf, "sit")
	pf.j.arm_l.sh.rotation.x = 0.7; pf.j.arm_r.sh.rotation.x = 0.7 # (a hand on the stick, one on the throttle)
	var eye: Vector3 = pf.j.head.global_position + pf.rig.dims.eye
	pf.position -= eye
	pilots = _instanced(_by_material(Figure.bake_figures([pf], frame).values()), FIGHTERS_MAX)
	frame.queue_free() # (the posed men with it)
	ready = true

## One instanced mesh for all its materials (a surface each), for up to `max` copies.
func _instanced(by_mat: Dictionary, max_n: int) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = _mesh_of(by_mat)
	mm.instance_count = max_n
	mm.visible_instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.extra_cull_margin = 16384.0 # (frustumCulled = false: the copies are anywhere)
	scene.add_child(mmi)
	return mmi

## Your own crew as drawn from outside: the men at their posts now (put together again when that changes).
func own_crew(crew) -> void:
	var at := []
	if crew:
		for m in crew.members:
			if (m.state == "ok" or m.state == "player") and by_role.has(m.role.id):
				at.append(m.role.id)
	var key := ",".join(at)
	if key == own_key:
		return
	own_key = key
	own.mesh = _mesh_of(_by_material(at.map(func(id): return by_role[id])))

## Each frame, after everything's moved. camera; o: bombers (all of them), mine (yours), crews (bomber ->
## Crew), fighters (fighters.gd), me (your own fighter: not drawn while you're in its cockpit), mine_outside
## (her cabin isn't drawn, seen from out behind her: her crew are drawn from here instead).
func update(camera: Node3D, o: Dictionary) -> void:
	if not ready:
		build()
		if not ready:
			return
	var mine = o.mine
	var crews: Dictionary = o.get("crews", {})
	var me = o.get("me")
	var cam := camera.global_position
	# your own crew, from out behind her
	own.visible = o.get("mine_outside", false) and not mine.down
	if own.visible:
		own_crew(crews.get(mine))
		own.global_transform = mine.group.global_transform
	# the other crews: the nearest few bombers, flying and still crewed
	var near := []
	for b in o.bombers:
		if b == mine or b.down or b.get("gone") or not b.model:
			continue
		var d: float = (b.group.position as Vector3).distance_to(cam)
		if d > BOMBER_NEAR:
			continue
		var c = crews.get(b)
		if c and c.members.all(func(m): return m.state == "bailed" or m.state == "dead"):
			continue
		near.append([d, b])
	near.sort_custom(func(a, b): return a[0] < b[0])
	var nb := mini(near.size(), BOMBERS_MAX)
	for i in nb:
		bombers.multimesh.set_instance_transform(i, near[i][1].group.global_transform)
	bombers.multimesh.visible_instance_count = nb
	# the fighter pilots: the nearest few, still in their seats
	var close := []
	for f in o.fighters.list:
		var ob = f.get("obj")
		if not ob or not ob.is_inside_tree() or not EYE.has(f.kind) or f == me or not (f.alive or f.get("bail_t") != null):
			continue
		var d: float = (ob as Node3D).global_position.distance_to(cam) # (where he's drawn)
		if d < FIGHTER_NEAR:
			close.append([d, f])
	close.sort_custom(func(a, b): return a[0] < b[0])
	var nf := mini(close.size(), FIGHTERS_MAX)
	for i in nf:
		var f = close[i][1]
		var xf: Transform3D = (f.obj as Node3D).global_transform
		# (his eye where the cockpit's is, at his own size)
		pilots.multimesh.set_instance_transform(i, Transform3D(Basis(xf.basis.get_rotation_quaternion()), xf * EYE[f.kind]))
	pilots.multimesh.visible_instance_count = nf

## Several men's baked meshes put together: {material: [arrays]}.
static func _by_material(list: Array) -> Dictionary:
	var out := {}
	for m in list:
		for mat in m:
			if not out.has(mat):
				out[mat] = []
			out[mat].append(m[mat])
	return out

## One ArrayMesh, a surface a material, each surface the material's meshes merged.
static func _mesh_of(by_mat: Dictionary) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	for mat in by_mat:
		var st := SurfaceTool.new()
		for arr in by_mat[mat]:
			var part := ArrayMesh.new()
			part.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
			st.append_from(part, 0, Transform3D.IDENTITY)
		var merged := st.commit_to_arrays()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, merged)
		mesh.surface_set_material(mesh.get_surface_count() - 1, mat)
	return mesh
