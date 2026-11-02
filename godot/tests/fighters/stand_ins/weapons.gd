extends RefCounted
# Stand-in for src/weapons.gd (the fighters' test only, until the guns session's lands): BALLISTICS, and the
# rounds in flight (Bullets: spawn, update with the collide hook) drawn as tracer streaks.
const Bomber := preload("res://src/bomber.gd")
const MUZZLE_SPEED := 890.0
const GRAVITY := 9.81
const DRAG := 0.00025
const BALLISTICS := {MUZZLE_SPEED = MUZZLE_SPEED, GRAVITY = GRAVITY, DRAG = DRAG, WIND = Vector3(0, 0, Bomber.AIRSPEED)}
const LIFE := 2.5

class Bullets:
	var p := PackedVector3Array()
	var v := PackedVector3Array()
	var info: Array = [] # [age, tracer, team, owner, cannon, src]
	var mm: MultiMesh
	var player_fired := 0

	func _init(scene: Node3D) -> void:
		mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		var box := BoxMesh.new()
		box.size = Vector3(0.06, 0.06, 1)
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.vertex_color_use_as_albedo = true
		box.material = m
		mm.mesh = box
		mm.instance_count = 3000
		mm.visible_instance_count = 0
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
		scene.add_child(mi)

	func spawn(pos: Vector3, vel: Vector3, tracer: bool, team := "allied", owner = null, cannon := false, src = null, life := LIFE) -> void:
		if p.size() >= 6000:
			return
		p.append(pos)
		v.append(vel)
		info.append([LIFE - life, tracer, team, owner, cannon, src])
		if owner is String and owner == "player":
			player_fired += 1

	func update(dt: float, cam: Vector3, collide: Callable) -> void:
		var W: Vector3 = BALLISTICS.WIND
		var t := 0
		var i := 0
		while i < p.size():
			var inf: Array = info[i]
			inf[0] += dt
			if inf[0] > LIFE:
				_remove(i)
				continue
			var from := p[i]
			var r := v[i] - W
			var k := DRAG * r.length() * dt
			var vv := v[i] - r * k
			vv.y -= GRAVITY * dt
			v[i] = vv
			p[i] = from + vv * dt
			if collide.call(from, p[i], inf[2], inf[3], inf[4], inf[5]):
				_remove(i)
				continue
			if inf[1] and t < mm.instance_count and p[i].distance_squared_to(cam) < 2500.0 * 2500.0:
				var d := vv.normalized()
				var w := maxf(1.0, p[i].distance_to(cam) * 0.0011 / 0.03)
				var b := Basis.looking_at(d, Vector3.UP if absf(d.y) < 0.99 else Vector3.RIGHT).scaled_local(Vector3(w, w, minf(vv.length() * 0.022, 20)))
				mm.set_instance_transform(t, Transform3D(b, p[i]))
				mm.set_instance_color(t, Color(0.75, 1, 0.45) if inf[2] == "enemy" else Color(1, 0.42, 0.12))
				t += 1
			i += 1
		mm.visible_instance_count = t

	func _remove(i: int) -> void:
		var last := p.size() - 1
		p[i] = p[last]
		v[i] = v[last]
		info[i] = info[last]
		p.resize(last)
		v.resize(last)
		info.resize(last)
