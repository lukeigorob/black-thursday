extends RefCounted
# Stand-in for src/effects.gd while it doesn't compile (tests/bombers only): the calls the bombers, the flak
# and the break-up make, drawn simply (soft billboards, CPU-moved) so damage shows in the screenshots.

class ParticlePool:
	var max := 0
	var n := 0
	var mm: MultiMesh
	var mi: MultiMeshInstance3D
	var ps: Array = []
	var _buf := PackedFloat32Array()
	func _init(scene: Node, max_: int, o: Dictionary) -> void:
		max = max_
		var q := QuadMesh.new()
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.vertex_color_use_as_albedo = true
		m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		if o.get("additive", false):
			m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				var r := Vector2(x - 15.5, y - 15.5).length() / 16.0
				img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - r, 0, 1) ** 1.5))
		m.albedo_texture = ImageTexture.create_from_image(img)
		q.material = m
		mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = q
		mm.instance_count = max
		mm.visible_instance_count = 0
		mi = MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
		scene.add_child(mi)
		_buf.resize(max * 16)
	func emit(p: Vector3, v: Vector3, o: Dictionary) -> void:
		if ps.size() >= max:
			ps.pop_front()
		ps.append({p = p, v = v, t = 0.0, life = float(o.life), s0 = float(o.s0), s1 = float(o.s1), a0 = float(o.get("a0", 1.0)), c0 = o.c0, c1 = o.get("c1", o.c0), drag = float(o.get("drag", 0.6))})
	func update(dt: float) -> void:
		var i := 0
		var k := 0
		while i < ps.size():
			var q: Dictionary = ps[i]
			q.t += dt
			if q.t >= q.life:
				ps.remove_at(i)
				continue
			q.v *= exp(-q.drag * dt)
			q.p += q.v * dt
			var f: float = q.t / q.life
			var s: float = lerpf(q.s0, q.s1, f)
			var c := Color(lerpf(q.c0[0], q.c1[0], f), lerpf(q.c0[1], q.c1[1], f), lerpf(q.c0[2], q.c1[2], f))
			var mx := maxf(1.0, maxf(c.r, maxf(c.g, c.b)))
			c = Color(c.r / mx, c.g / mx, c.b / mx, q.a0 * (1.0 - f))
			var o := k * 16
			_buf[o] = s; _buf[o + 1] = 0; _buf[o + 2] = 0; _buf[o + 3] = q.p.x
			_buf[o + 4] = 0; _buf[o + 5] = s; _buf[o + 6] = 0; _buf[o + 7] = q.p.y
			_buf[o + 8] = 0; _buf[o + 9] = 0; _buf[o + 10] = s; _buf[o + 11] = q.p.z
			_buf[o + 12] = c.r; _buf[o + 13] = c.g; _buf[o + 14] = c.b; _buf[o + 15] = c.a
			k += 1
			i += 1
		n = k
		mm.buffer = _buf
		mm.visible_instance_count = k

var scene: Node
var smoke: ParticlePool
var fire: ParticlePool
var cam_pos = null
var extra_pools: Array = []
var counts := {trail = 0, impact = 0, wreck = 0, explosion = 0, parachute = 0, ground_burst = 0}
var _acc := {}

func _init(scene_: Node) -> void:
	scene = scene_
	smoke = ParticlePool.new(scene, 6000, {additive = false})
	fire = ParticlePool.new(scene, 3000, {additive = true})

const TRAILS := {
	smoke = [[0.35, 0.34, 0.33], [0.6, 0.6, 0.6], 3.0, 1.5, 6.0, 0.5, 6.0],
	black = [[0.05, 0.045, 0.04], [0.2, 0.19, 0.18], 4.0, 2.0, 9.0, 0.8, 8.0],
	fire = [[6, 2.5, 0.6], [1.5, 0.4, 0.1], 0.6, 1.2, 0.4, 1.0, 30.0],
	fuel = [[0.85, 0.85, 0.85], [0.9, 0.9, 0.9], 2.5, 0.5, 3.0, 0.35, 8.0],
}
func trail(p: Vector3, v: Vector3, kind: String, dt: float) -> void:
	counts.trail += 1
	var t: Array = TRAILS[kind]
	for i in int(dt * t[6] + randf()):
		(fire if kind == "fire" else smoke).emit(p, v + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)), {life = t[2], s0 = t[3], s1 = t[4], a0 = t[5], c0 = t[0], c1 = t[1], drag = 0.3})
func impact(p: Vector3, big := false) -> void:
	counts.impact += 1
func wreck(at: Vector3, vel: Vector3, n: int, size: Vector3, burning := 0.4, quat = null) -> void:
	counts.wreck += 1
func explosion(p: Vector3, v := Vector3.ZERO, scale := 1.0) -> void:
	counts.explosion += 1
	for i in 12:
		fire.emit(p, v + Vector3(randf_range(-8, 8), randf_range(-8, 8), randf_range(-8, 8)), {life = 0.8, s0 = 3.0 * scale, s1 = 9.0 * scale, a0 = 1.0, c0 = [8, 3, 0.8], c1 = [0.4, 0.1, 0.02], drag = 2.0})
	for i in 6:
		smoke.emit(p, v + Vector3(randf_range(-4, 4), randf_range(-4, 4), randf_range(-4, 4)), {life = 6.0, s0 = 4.0 * scale, s1 = 14.0 * scale, a0 = 0.9, c0 = [0.06, 0.055, 0.05], c1 = [0.2, 0.2, 0.2], drag = 1.0})
func parachute(p: Vector3) -> void:
	counts.parachute += 1
func ground_burst(p: Vector3) -> void:
	counts.ground_burst += 1
	smoke.emit(p, Vector3(0, 6, 75), {life = 12.0, s0 = 30.0, s1 = 90.0, a0 = 0.8, c0 = [0.3, 0.28, 0.25], c1 = [0.5, 0.5, 0.5], drag = 0.0})
func ground_smoke(p: Vector3) -> void:
	pass
func update(dt: float) -> void:
	smoke.update(dt)
	fire.update(dt)
