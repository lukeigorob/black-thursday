extends RefCounted
# Smoke, fire, explosions, flak bursts and hit sparks, as GPU particles. Everything is in the formation's
# frame, where the air streams aft (+Z) at the bombers' airspeed: smoke left by a burning engine is carried
# back at that speed, and an explosion's cloud drifts aft as it spreads.

const AIRSPEED := 75.0

var root: Node3D
var puff: GradientTexture2D
var drifting := []  # [node, seconds left]: one-shot effects carried aft with the air
var flashes := []   # [light, seconds left, energy]

func _init(r: Node3D) -> void:
	root = r
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	g.add_point(0.45, Color(1, 1, 1, 0.75))
	puff = GradientTexture2D.new()
	puff.gradient = g
	puff.fill = GradientTexture2D.FILL_RADIAL
	puff.fill_from = Vector2(0.5, 0.5)
	puff.fill_to = Vector2(1.0, 0.5)
	puff.width = 64
	puff.height = 64

func _material(additive: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = puff
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	return m

func _ramp(stops: Array) -> GradientTexture1D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array(stops.map(func(s): return s[0]))
	g.colors = PackedColorArray(stops.map(func(s): return s[1]))
	var t := GradientTexture1D.new()
	t.gradient = g
	return t

func _grow(from: float) -> CurveTexture:
	var c := Curve.new()
	c.add_point(Vector2(0, from))
	c.add_point(Vector2(1, 1))
	var t := CurveTexture.new()
	t.curve = c
	return t

# one emitter: `drift` true = particles leave at the airspeed aft (a trail from something moving with the
# formation); false = they spread from where they're made (the node itself is then carried aft)
func _emitter(additive: bool, amount: int, life: float, size: float, grow_from: float, speed: float, spread: float, drift: bool, ramp: Array, one_shot: bool, at := Vector3.ZERO) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.position = at # (placed before it starts: a trail started at the origin would puff smoke there first)
	p.amount = amount
	p.lifetime = life
	p.one_shot = one_shot
	p.explosiveness = 0.95 if one_shot else 0.0
	p.local_coords = not drift
	p.visibility_aabb = AABB(Vector3(-3000, -3000, -3000), Vector3(6000, 6000, 6000))
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 0, 1)
	pm.spread = spread
	pm.initial_velocity_min = speed * 0.85
	pm.initial_velocity_max = speed * 1.15
	pm.gravity = Vector3.ZERO
	pm.damping_min = 0.0
	pm.scale_curve = _grow(grow_from)
	pm.color_ramp = _ramp(ramp)
	pm.angle_min = -180.0
	pm.angle_max = 180.0
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	q.material = _material(additive)
	p.draw_pass_1 = q
	root.add_child(p)
	p.emitting = true
	return p

const SMOKE := [[0.0, Color(0.25, 0.24, 0.23, 0.0)], [0.05, Color(0.22, 0.21, 0.2, 0.75)], [0.6, Color(0.35, 0.34, 0.34, 0.45)], [1.0, Color(0.5, 0.5, 0.52, 0.0)]]
const WHITE_SMOKE := [[0.0, Color(0.8, 0.8, 0.8, 0.0)], [0.05, Color(0.75, 0.75, 0.75, 0.55)], [1.0, Color(0.85, 0.86, 0.88, 0.0)]]
const FIRE := [[0.0, Color(1.0, 0.85, 0.5, 1.0)], [0.25, Color(1.0, 0.45, 0.1, 0.9)], [1.0, Color(0.3, 0.05, 0.0, 0.0)]]

## A trail following something (an engine on fire, a fighter going down); the owner moves it each frame.
func trail(kind: String, at: Vector3) -> GPUParticles3D:
	match kind:
		"fire":
			return _emitter(true, 220, 0.7, 3.5, 0.5, AIRSPEED, 6.0, true, FIRE, false, at)
		"white":
			return _emitter(false, 120, 5.0, 4.0, 0.3, AIRSPEED, 3.0, true, WHITE_SMOKE, false, at)
		_:
			return _emitter(false, 500, 7.0, 7.0, 0.25, AIRSPEED, 4.0, true, SMOKE, false, at)

## Stop a trail and free it once its smoke has gone.
func end_trail(p: GPUParticles3D) -> void:
	if not is_instance_valid(p):
		return
	p.emitting = false
	drifting.append([p, p.lifetime + 0.5])

func _one_shot(p: GPUParticles3D, at: Vector3) -> void:
	drifting.append([p, p.lifetime + 0.5])

func _flash(at: Vector3, energy: float, rng: float, color: Color) -> void:
	var l := OmniLight3D.new()
	l.position = at
	l.light_color = color
	l.light_energy = energy
	l.omni_range = rng
	l.shadow_enabled = false
	root.add_child(l)
	flashes.append([l, 0.35, energy])

## A fighter or a bomber's tanks going up.
func explosion(at: Vector3, big := false) -> void:
	var k := 2.2 if big else 1.0
	_one_shot(_emitter(true, 40, 0.9, 7.0 * k, 0.3, 28.0 * k, 180.0, false, FIRE, true, at), at)
	_one_shot(_emitter(false, 50, 6.0, 11.0 * k, 0.3, 14.0 * k, 180.0, false, SMOKE, true, at), at)
	_one_shot(_emitter(true, 30, 2.5, 0.9, 1.0, 60.0 * k, 180.0, false, [[0.0, Color(1, 0.8, 0.4, 1)], [1.0, Color(0.4, 0.1, 0, 0)]], true, at), at)
	_flash(at, 12.0 * k, 120.0 * k, Color(1.0, 0.6, 0.25))

## An 88 mm shell bursting: a flash, then a black puff that hangs and drifts back through the formation.
func flak(at: Vector3) -> void:
	_one_shot(_emitter(false, 14, 9.0, 12.0, 0.35, 6.0, 180.0, false, [[0.0, Color(0.05, 0.05, 0.05, 0.0)], [0.03, Color(0.06, 0.05, 0.05, 0.95)], [0.7, Color(0.12, 0.11, 0.11, 0.6)], [1.0, Color(0.2, 0.2, 0.2, 0.0)]], true, at), at)
	_one_shot(_emitter(true, 8, 0.25, 6.0, 0.4, 10.0, 180.0, false, FIRE, true, at), at)
	_flash(at, 6.0, 90.0, Color(1.0, 0.7, 0.35))

## Rounds striking metal.
func sparks(at: Vector3) -> void:
	_one_shot(_emitter(true, 10, 0.3, 0.6, 1.0, 30.0, 70.0, false, [[0.0, Color(1, 0.9, 0.6, 1)], [1.0, Color(1, 0.4, 0.1, 0)]], true, at), at)

func update(dt: float) -> void:
	for i in range(drifting.size() - 1, -1, -1):
		var d = drifting[i]
		d[1] -= dt
		var n: GPUParticles3D = d[0]
		if n.local_coords:
			n.position.z += AIRSPEED * dt
		if d[1] <= 0.0:
			n.queue_free()
			drifting.remove_at(i)
	for i in range(flashes.size() - 1, -1, -1):
		var f = flashes[i]
		f[1] -= dt
		var l: OmniLight3D = f[0]
		l.light_energy = f[2] * maxf(f[1], 0.0) / 0.35
		l.position.z += AIRSPEED * dt
		if f[1] <= 0.0:
			l.queue_free()
			flashes.remove_at(i)
