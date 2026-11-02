extends RefCounted
# Rounds in flight, with the browser game's ballistics (../src/weapons.js): 890 m/s from the muzzle, gravity,
# and drag through the air, which streams aft past the formation at its airspeed (so a round fired out of
# the side drifts back). The bombers' .50s are tested against the fighters; the fighters' fire is for show
# (whether it hits is rolled when it's fired: fighters.gd). Tracers are one MultiMesh, one draw call.

const MUZZLE := 890.0
const GRAVITY := 9.81
const DRAG := 0.00025
const WIND := Vector3(0, 0, 75.0)
const MAX := 2500
const PLAYER := 0
const GUNNER := 1
const FIGHTER := 2
const COLORS := [Color(1.0, 0.2, 0.08), Color(1.0, 0.2, 0.08), Color(1.0, 0.7, 0.25)]
const HIT_R := 4.5  # m: a Bf 109 as a ball (span 10 m, length 9)

var n := 0
var pos := PackedVector3Array()
var vel := PackedVector3Array()
var life := PackedFloat32Array()
var kind := PackedByteArray()
var aim := PackedInt32Array()  # a gunner's round: the fighter he fired at (only that one is tested)
var shows := PackedByteArray()  # drawn as a tracer
var mm: MultiMesh
var buf := PackedFloat32Array()
var on_hit: Callable  # (fighter index, where, kind)

func _init(root: Node3D) -> void:
	for a in [pos, vel]:
		a.resize(MAX)
	life.resize(MAX)
	kind.resize(MAX)
	aim.resize(MAX)
	shows.resize(MAX)
	buf.resize(MAX * 16)
	mm = MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var box := BoxMesh.new()
	box.size = Vector3(1, 1, 1)
	var m := ShaderMaterial.new()
	m.shader = load("res://tracer.gdshader")
	box.material = m
	mm.mesh = box
	mm.instance_count = MAX
	mm.visible_instance_count = 0
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-5000, -5000, -5000), Vector3(10000, 10000, 10000))
	root.add_child(mi)

func fire(p: Vector3, v: Vector3, k: int, target: int, tracer: bool, seconds: float) -> void:
	if n >= MAX:
		return
	pos[n] = p
	vel[n] = v
	life[n] = seconds
	kind[n] = k
	aim[n] = target
	shows[n] = 1 if tracer else 0
	n += 1

func _remove(i: int) -> void:
	n -= 1
	pos[i] = pos[n]
	vel[i] = vel[n]
	life[i] = life[n]
	kind[i] = kind[n]
	aim[i] = aim[n]
	shows[i] = shows[n]

func update(dt: float, fpos: PackedVector3Array, falive: PackedByteArray, cam: Vector3) -> void:
	var i := 0
	var drawn := 0
	var r2 := HIT_R * HIT_R
	while i < n:
		life[i] -= dt
		if life[i] <= 0.0:
			_remove(i)
			continue
		var v := vel[i]
		var va := v - WIND
		v -= va * (DRAG * va.length() * dt)
		v.y -= GRAVITY * dt
		vel[i] = v
		var p0 := pos[i]
		var step := v * dt
		var p1 := p0 + step
		pos[i] = p1
		var k := kind[i]
		var hit := -1
		if k != FIGHTER:
			var s2 := step.length_squared()
			var lo := 0
			var hi := fpos.size()
			if k == GUNNER:
				lo = aim[i]
				hi = lo + 1
			for f in range(lo, hi):
				if not falive[f]:
					continue
				var c := fpos[f] - p0
				var t := clampf(c.dot(step) / s2, 0.0, 1.0)
				if (c - step * t).length_squared() < r2:
					hit = f
					break
		if hit >= 0:
			on_hit.call(hit, p1, k)
			_remove(i)
			continue
		if shows[i]:
			var d := v.normalized()
			var dist := p1.distance_to(cam)
			var w := maxf(0.07, dist * 0.0011)  # never thinner than about a pixel and a half
			var b := Basis.looking_at(d, Vector3.UP if absf(d.y) < 0.98 else Vector3.RIGHT)
			b.x *= w
			b.y *= w
			b.z *= minf(16.0, dist * 0.25)
			var o := p1 - d * (b.z.length() * 0.5)
			var j := drawn * 16
			buf[j] = b.x.x; buf[j + 1] = b.y.x; buf[j + 2] = b.z.x; buf[j + 3] = o.x
			buf[j + 4] = b.x.y; buf[j + 5] = b.y.y; buf[j + 6] = b.z.y; buf[j + 7] = o.y
			buf[j + 8] = b.x.z; buf[j + 9] = b.y.z; buf[j + 10] = b.z.z; buf[j + 11] = o.z
			var c: Color = COLORS[k]
			buf[j + 12] = c.r; buf[j + 13] = c.g; buf[j + 14] = c.b; buf[j + 15] = 1.0
			drawn += 1
		i += 1
	mm.buffer = buf
	mm.visible_instance_count = drawn
