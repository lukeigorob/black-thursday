extends RefCounted
# A stand-in for src/city.gd (the world area's) while it isn't ported: the target as the mission uses it (its
# centre moving with the ground, buildings that can be wrecked), a grey square on the ground to see it by.
# run_tests copies it into a scratch copy's src/city.gd only when there's no city.gd there.

const AIRSPEED := 75.0
var center: Vector3
var group := Node3D.new()
var buildings: Array = []
var layout = null
var destroyed: int:
	get:
		return buildings.filter(func(b): return not b.alive).size()

func _init(scene: Node, c: Vector3) -> void:
	center = c
	for i in 400:
		buildings.append({x = randf_range(-600, 600), z = randf_range(-600, 600), alive = true})
	var m := MeshInstance3D.new()
	var p := PlaneMesh.new()
	p.size = Vector2(1400, 1400)
	m.mesh = p
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.45, 0.43, 0.4)
	m.material_override = mat
	group.add_child(m)
	scene.add_child(group)
	group.position = center

func blast(p: Vector3) -> int:
	var n := 0
	for b in buildings:
		if b.alive and Vector2(b.x + center.x - p.x, b.z + center.z - p.z).length() < 40:
			b.alive = false
			n += 1
	return n

func update(dt: float, _effects) -> void:
	center.z += AIRSPEED * dt
	group.position = center
