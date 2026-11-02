extends Node3D
# Black Thursday in Godot: a test of the engine against the browser game (../src). The stream of 291 B-17s
# over Franconia at 25,000 ft on 14 October 1943, laid out as ../src/formation.js lays it out, you at the
# left waist gun of one in the lead wing, Bf 109s making passes, flak bursting.
# Mouse: aim, left button: fire, C: outside view (mouse orbits, wheel zooms), Esc: free the mouse.
# Run with `-- --test --out=<folder>` to fly 40 s on its own, save screenshots and print the frame times.

const Bullets := preload("res://bullets.gd")
const Fighters := preload("res://fighters.gd")
const Effects := preload("res://effects.gd")

const AIRSPEED := 75.0
const ALTITUDE := 7600.0   # ~25,000 ft
const NEAR := 150.0        # m: bombers closer than this get the full model, the rest one MultiMesh per material
const BOMBERS := 291
const SUN_DIR := Vector3(-0.55, 0.45, 0.7)  # mid-afternoon in October, from the south-west and behind
const HAZE := Color(0.70, 0.76, 0.84)

# the formation (../src/formation.js): element, squadron, group, combat wing, stream; x right, y up, +z aft
const ELEMENT := [Vector3(0, 0, 0), Vector3(-29, -5, 18), Vector3(29, 5, 18)]
const SQUADRON := [Vector3(0, 0, 0), Vector3(0, -16, 50)]
const GROUP := [Vector3(0, 0, 0), Vector3(92, 36, 58), Vector3(-92, -36, 58)]
const WING := [Vector3(0, 0, 0), Vector3(250, 120, 180), Vector3(-250, -120, 180)]
const STREAM := [Vector3(0, 0, 0), Vector3(-90, 70, -780), Vector3(110, -70, 760), Vector3(-720, 160, -260), Vector3(740, -150, 240), Vector3(-60, -110, 1520)]
const ENGINES := [Vector3(-7.16, -0.7, -4.6), Vector3(-3.93, -0.7, -4.6), Vector3(3.94, -0.7, -4.6), Vector3(7.15, -0.7, -4.6)]

# the left waist gun (../src/interior.js STATIONS waistL): its pintle, and your eye behind and above it
const PIVOT := Vector3(-0.98, -1.06, 2.02)
const EYE_BEHIND := 0.72
const EYE_UP := 0.22
const YAW_LIM := deg_to_rad(65.0)
const PITCH_MIN := deg_to_rad(-55.0)
const PITCH_MAX := deg_to_rad(50.0)
const RPM := 750.0

class Bomber:
	var base := Vector3.ZERO   # its place in the formation
	var pos := Vector3.ZERO
	var basis := Basis.IDENTITY
	var phase := 0.0
	var node: Node3D           # the full model, if it's near enough to have one
	var props: Array = []
	var damage := 0.0
	var smoke: GPUParticles3D
	var fire: GPUParticles3D
	var engine := 0
	var down := false
	var fall := Vector3.ZERO
	var fall_t := 0.0
	var spin := 0.0

var bombers: Array[Bomber] = []
var me := 0                    # which bomber is yours
var far_meshes: Array[MultiMesh] = []
var far_buf := PackedFloat32Array()
var fx: Effects
var bullets: Bullets
var fighters: Fighters
var cam: Camera3D
var gun: Node3D
var flash: OmniLight3D
var ground: MeshInstance3D
var clouds: MeshInstance3D
var hud: Label
var cross: Control
var t := 0.0
var yaw := 0.0
var pitch := 0.05
var outside := false
var follow := -1               # (the test: riding behind a fighter)
var orbit := Vector3(2.4, 0.18, 60.0)  # yaw, pitch, distance
var gun_t := 0.0
var rounds := 0
var lost := 0
var flak_t := 3.0
var gunners_t := 0.0
var gunner_aim := {}           # bomber index -> fighter index it's shooting at

# the test run (-- --test)
var test := false
var out_dir := "user://"
var frame_ms := PackedFloat32Array()

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a == "--test":
			test = true
		elif a.begins_with("--out="):
			out_dir = a.substr(6)
	if test:
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	_world()
	fx = Effects.new(self)
	bullets = Bullets.new(self)
	_formation()
	fighters = Fighters.new(self, load("res://models/bf109.glb"))
	bullets.on_hit = func(i: int, at: Vector3, k: int): fighters.hit(i, at, k == Bullets.PLAYER)
	_gun()
	_hud()
	if not test:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

# ---- the sky, the sun, the ground and the clouds ----

func _world() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	# deep blue overhead at 25,000 ft, paling to the haze at the horizon, which is the fog's colour, so the
	# far ground melts into the sky with no edge
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.13, 0.27, 0.52)
	sm.sky_horizon_color = HAZE
	sm.sky_curve = 0.09
	sm.ground_horizon_color = HAZE
	sm.ground_bottom_color = HAZE
	sm.sun_angle_max = 20.0
	sm.sun_curve = 0.08
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.8
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.03
	env.glow_hdr_threshold = 1.3
	env.ssao_enabled = true
	env.fog_enabled = true
	env.fog_light_color = HAZE
	env.fog_density = 0.00002
	env.fog_sun_scatter = 0.15
	env.fog_aerial_perspective = 0.0
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 350.0
	add_child(sun)

	ground = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(400000, 400000)
	ground.mesh = plane
	var gm := ShaderMaterial.new()
	gm.shader = load("res://ground.gdshader")
	ground.material_override = gm
	ground.position.y = -ALTITUDE
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ground)

	clouds = MeshInstance3D.new()
	var cp := PlaneMesh.new()
	cp.size = Vector2(160000, 160000)
	clouds.mesh = cp
	var cm := ShaderMaterial.new()
	cm.shader = load("res://clouds.gdshader")
	clouds.material_override = cm
	clouds.position.y = -ALTITUDE + 2200.0
	clouds.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(clouds)

	cam = Camera3D.new()
	cam.near = 0.05
	cam.far = 250000.0
	cam.fov = 70.0
	add_child(cam)
	cam.make_current()

# ---- the bombers ----

func _slots() -> Array[Vector3]:
	var out: Array[Vector3] = []
	for s in STREAM:
		for w in WING:
			for g in GROUP:
				for q in SQUADRON:
					for e in ELEMENT:
						if out.size() < BOMBERS:
							out.append(s + w + g + q + e)
	return out

func _formation() -> void:
	var slots := _slots()
	me = 1 # left wingman of the lead element, lead squadron, lead group, lead wing
	var origin := slots[me]
	var full: PackedScene = load("res://models/b17.glb")
	for i in slots.size():
		var b := Bomber.new()
		b.base = slots[i] - origin
		b.pos = b.base
		b.phase = randf() * TAU
		if b.base.length() < NEAR:
			b.node = full.instantiate()
			add_child(b.node)
			_prepare(b.node, i == me)
			_collect_props(b.node, b.props)
		bombers.append(b)
	_far_fleet(load("res://models/b17_lod.glb"))

# the model's hull marks its windows with alpha; make them open cut-outs (as ../src/models.js does), drop the
# panels in the waist windows, and for your own bomber show the hull from inside too
func _prepare(root: Node, mine: bool) -> void:
	for n in _meshes(root):
		var mi := n as MeshInstance3D
		if String(mi.name) == "SideGunPanels" or (mine and String(mi.name) in ["GunBarrel10", "LateralGunPivots"]):
			mi.visible = false
			continue
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s) as StandardMaterial3D
			if m == null:
				continue
			if m.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA or mine:
				m = m.duplicate()
				if m.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA:
					m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
					m.alpha_scissor_threshold = 0.95
				if mine:
					m.cull_mode = BaseMaterial3D.CULL_DISABLED
				mi.set_surface_override_material(s, m)

func _meshes(n: Node, into: Array = []) -> Array:
	if n is MeshInstance3D:
		into.append(n)
	for c in n.get_children():
		_meshes(c, into)
	return into

func _collect_props(n: Node, into: Array) -> void:
	for c in n.get_children():
		if String(c.name).begins_with("Propeller"):
			into.append(c)
		else:
			_collect_props(c, into)

# all the far bombers: the low-detail model merged into one mesh per material, drawn as a MultiMesh each
func _far_fleet(scene: PackedScene) -> void:
	var src := scene.instantiate()
	add_child(src)
	var by_mat := {}
	for n in _meshes(src):
		var mi := n as MeshInstance3D
		var xf: Transform3D = src.global_transform.affine_inverse() * mi.global_transform
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s)
			if m is StandardMaterial3D and m.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA:
				m = m.duplicate()
				m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				m.alpha_scissor_threshold = 0.5
			var key: int = m.get_instance_id() if m else 0
			if not by_mat.has(key):
				var st := SurfaceTool.new()
				st.begin(Mesh.PRIMITIVE_TRIANGLES)
				by_mat[key] = [st, m]
			by_mat[key][0].append_from(mi.mesh, s, xf)
	src.queue_free()
	far_buf.resize(BOMBERS * 12)
	for key in by_mat:
		var st: SurfaceTool = by_mat[key][0]
		var mesh := st.commit()
		mesh.surface_set_material(0, by_mat[key][1])
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = BOMBERS
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.custom_aabb = AABB(Vector3(-4000, -4000, -4000), Vector3(8000, 8000, 8000))
		add_child(mmi)
		far_meshes.append(mm)

func bomber_pos(i: int) -> Vector3:
	return bombers[i].pos

# a bomber for a fighter to go for: half the time one of those round yours, so there's a fight to watch
func pick_target() -> int:
	for k in 20:
		var i := randi() % bombers.size()
		if randf() < 0.5:
			i = randi() % 30
		if not bombers[i].down:
			return i
	return me

# a fighter's burst has hit bomber i (the rounds take `delay` s to get there)
func bomber_hit(i: int, delay: float) -> void:
	get_tree().create_timer(delay).timeout.connect(func():
		var b := bombers[i]
		if b.down:
			return
		b.damage += 0.25
		var at := b.pos + b.basis * Vector3(randf_range(-6, 6), randf_range(-1, 1), randf_range(-8, 8))
		if b.node:
			fx.sparks(at)
		if b.damage > 1.2 and b.smoke == null:
			b.engine = randi() % 4
			b.smoke = fx.trail("smoke", b.pos)
		if b.damage > 2.4 and b.fire == null:
			b.fire = fx.trail("fire", b.pos)
		if b.damage > 3.5 and i != me:
			_shoot_down(i))

func _shoot_down(i: int) -> void:
	var b := bombers[i]
	b.down = true
	b.fall = Vector3(0, -2, 8)
	b.spin = randf_range(0.15, 0.4) * signf(randf() - 0.5)
	lost += 1
	if randf() < 0.3:
		fx.explosion(b.pos, true)
	if b.smoke == null:
		b.smoke = fx.trail("smoke", b.pos)
	if b.fire == null:
		b.fire = fx.trail("fire", b.pos)

func _update_bombers(dt: float) -> void:
	for i in bombers.size():
		var b := bombers[i]
		if b.down:
			b.fall_t += dt
			b.fall.y -= 9.81 * dt * 0.35
			b.fall.z += 4.0 * dt # (out of the formation, falling behind)
			b.pos += b.fall * dt
			b.basis = (Basis(Vector3.BACK, b.spin * dt) * Basis(Vector3.RIGHT, -0.05 * dt) * b.basis).orthonormalized()
			if b.fall_t > 60.0 and b.smoke:
				fx.end_trail(b.smoke)
				fx.end_trail(b.fire)
				b.smoke = null
				b.fire = null
		else:
			var ph := b.phase
			if b.damage > 2.4:
				b.base.z += 2.5 * dt # (a straggler, dropping back)
			b.pos = b.base + Vector3(sin(t * 0.31 + ph) * 0.7, sin(t * 0.53 + ph * 1.3) * 0.5, sin(t * 0.23 + ph * 0.7) * 1.1)
			b.basis = Basis.from_euler(Vector3(sin(t * 0.41 + ph) * 0.012, sin(t * 0.17 + ph) * 0.006, sin(t * 0.63 + ph * 2.0) * 0.02))
		var e: Vector3 = ENGINES[b.engine]
		if b.smoke:
			b.smoke.position = b.pos + b.basis * e
		if b.fire:
			b.fire.position = b.pos + b.basis * (e + Vector3(0, 0, 0.5))
		if b.node:
			b.node.transform = Transform3D(b.basis, b.pos)
			for pr in b.props:
				pr.rotate_object_local(Vector3.BACK, dt * 30.0)
		var j := i * 12
		var x := b.basis.x
		var y := b.basis.y
		var z := b.basis.z
		if b.node or b.fall_t > 90.0:
			x = Vector3.ZERO
			y = Vector3.ZERO
			z = Vector3.ZERO
		far_buf[j] = x.x; far_buf[j + 1] = y.x; far_buf[j + 2] = z.x; far_buf[j + 3] = b.pos.x
		far_buf[j + 4] = x.y; far_buf[j + 5] = y.y; far_buf[j + 6] = z.y; far_buf[j + 7] = b.pos.y
		far_buf[j + 8] = x.z; far_buf[j + 9] = y.z; far_buf[j + 10] = z.z; far_buf[j + 11] = b.pos.z
	for mm in far_meshes:
		mm.buffer = far_buf

# the other bombers' gunners: the nearest 30 fire at whichever fighter is closest to them and inside 900 m
func _gunners(dt: float) -> void:
	gunners_t -= dt
	if gunners_t <= 0.0:
		gunners_t = 0.5
		gunner_aim.clear()
		for i in mini(30, bombers.size()):
			if i == me or bombers[i].down:
				continue
			var best := -1
			var bd := 900.0
			for f in Fighters.COUNT:
				if fighters.alive[f]:
					var d := bombers[i].pos.distance_to(fighters.pos[f])
					if d < bd:
						bd = d
						best = f
			if best >= 0:
				gunner_aim[i] = best
	for i in gunner_aim:
		if randf() > dt * 9.0: # (about nine rounds a second from each bomber: a gun or two at a time)
			continue
		var f: int = gunner_aim[i]
		var b := bombers[i]
		var from := b.pos + b.basis * Vector3(randf_range(-1, 1), randf_range(-1.5, 1.5), randf_range(-6, 9))
		var fl = fighters.list[f]
		var fv: Vector3 = fl.fwd * Fighters.SPEED + Fighters.WIND
		var to: Vector3 = fighters.pos[f] + fv * (from.distance_to(fighters.pos[f]) / Bullets.MUZZLE)
		var dir := (to - from).normalized() + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.02
		bullets.fire(from, dir.normalized() * Bullets.MUZZLE, Bullets.GUNNER, f, randf() < 0.35, 1.6)

# ---- your gun ----

func _gun() -> void:
	gun = Node3D.new()
	bombers[me].node.add_child(gun)
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.08, 0.08, 0.085)
	metal.metallic = 0.7
	metal.roughness = 0.45
	# the Browning M2: the receiver, the barrel in its perforated jacket, the spade grips (all approximate)
	_part(gun, BoxMesh.new(), Vector3(0.11, 0.14, 0.62), Vector3(0, 0, 0.12), metal)
	_part(gun, CylinderMesh.new(), Vector3(0.055, 0.95, 0.055), Vector3(0, 0.02, -0.65), metal, true)
	_part(gun, CylinderMesh.new(), Vector3(0.028, 1.15, 0.028), Vector3(0, 0.02, -0.75), metal, true)
	_part(gun, BoxMesh.new(), Vector3(0.2, 0.03, 0.03), Vector3(0, -0.02, 0.46), metal)
	_part(gun, BoxMesh.new(), Vector3(0.03, 0.12, 0.03), Vector3(-0.09, -0.07, 0.46), metal)
	_part(gun, BoxMesh.new(), Vector3(0.03, 0.12, 0.03), Vector3(0.09, -0.07, 0.46), metal)
	_part(gun, BoxMesh.new(), Vector3(0.012, 0.09, 0.012), Vector3(0, 0.12, -0.05), metal) # the ring sight's post
	var ring := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.052
	torus.outer_radius = 0.058
	ring.mesh = torus
	ring.material_override = metal
	ring.rotation.x = PI / 2
	ring.position = Vector3(0, 0.22, -0.05)
	gun.add_child(ring)
	# the waist inside: daylight from the open windows and the hatch, bounced round the green lining
	var inside := OmniLight3D.new()
	inside.position = Vector3(0, -0.4, 2.6)
	inside.light_color = Color(0.85, 0.88, 0.8)
	inside.light_energy = 0.7
	inside.omni_range = 5.0
	bombers[me].node.add_child(inside)
	flash = OmniLight3D.new()
	flash.position = Vector3(0, 0.02, -1.4)
	flash.light_color = Color(1.0, 0.7, 0.35)
	flash.omni_range = 6.0
	flash.light_energy = 0.0
	gun.add_child(flash)

func _part(parent: Node3D, mesh: PrimitiveMesh, size: Vector3, at: Vector3, mat: Material, along := false) -> void:
	var mi := MeshInstance3D.new()
	if mesh is BoxMesh:
		mesh.size = size
	elif mesh is CylinderMesh:
		mesh.top_radius = size.x
		mesh.bottom_radius = size.x
		mesh.height = size.y
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = at
	if along:
		mi.rotation.x = PI / 2
	parent.add_child(mi)

func _aim_dir() -> Vector3:
	return Vector3(-cos(pitch) * cos(yaw), sin(pitch), -cos(pitch) * sin(yaw))

func _update_gun(dt: float) -> void:
	var dir := _aim_dir()
	var b := Basis.looking_at(dir, Vector3.UP)
	gun.transform = Transform3D(b, PIVOT)
	var firing := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and not outside
	if test:
		firing = _test_aim(dt)
	flash.light_energy = 0.0
	if firing:
		gun_t -= dt
		while gun_t <= 0.0:
			gun_t += 60.0 / RPM
			rounds += 1
			var mine := bombers[me]
			var muzzle := mine.pos + mine.basis * (PIVOT + dir * 1.35)
			var spread := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.0018
			bullets.fire(muzzle, (mine.basis * dir + spread).normalized() * Bullets.MUZZLE, Bullets.PLAYER, -1, rounds % 5 == 0, 2.5)
			flash.light_energy = 4.0
	else:
		gun_t = maxf(gun_t, 0.0)
	if not outside:
		var kick := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * (0.004 if firing else 0.0)
		cam.global_transform = bombers[me].node.global_transform * Transform3D(Basis.looking_at(dir + kick, Vector3.UP), PIVOT - dir * EYE_BEHIND + Vector3(0, EYE_UP, 0))

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		elif outside and e.button_index == MOUSE_BUTTON_WHEEL_UP:
			orbit.z = maxf(30.0, orbit.z * 0.9)
		elif outside and e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			orbit.z = minf(3000.0, orbit.z * 1.1)
	elif e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		if outside:
			orbit.x -= e.relative.x * 0.004
			orbit.y = clampf(orbit.y + e.relative.y * 0.004, -1.2, 1.4)
		else:
			yaw = clampf(yaw + e.relative.x * 0.0022, -YAW_LIM, YAW_LIM)
			pitch = clampf(pitch - e.relative.y * 0.0022, PITCH_MIN, PITCH_MAX)
	elif e is InputEventKey and e.pressed and not e.echo:
		if e.keycode == KEY_C:
			outside = not outside
		elif e.keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _orbit_cam() -> void:
	var c := bombers[me].pos
	var off := Vector3(sin(orbit.x) * cos(orbit.y), sin(orbit.y), cos(orbit.x) * cos(orbit.y)) * orbit.z
	cam.global_transform = Transform3D(Basis.looking_at(-off, Vector3.UP), c + off)

# ---- the screen ----

func _hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	cross = Control.new()
	cross.set_anchors_preset(Control.PRESET_FULL_RECT)
	cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cross.draw.connect(func():
		if outside:
			return
		var c := cross.size / 2
		cross.draw_arc(c, 14, 0, TAU, 32, Color(1, 1, 1, 0.55), 1.5)
		cross.draw_circle(c, 1.5, Color(1, 1, 1, 0.8)))
	layer.add_child(cross)
	hud = Label.new()
	hud.position = Vector2(16, 12)
	hud.add_theme_font_size_override("font_size", 18)
	hud.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	layer.add_child(hud)

# ---- the frame ----

func _process(dt: float) -> void:
	dt = minf(dt, 0.05)
	t += dt
	var scroll := t * AIRSPEED
	(ground.material_override as ShaderMaterial).set_shader_parameter("scroll", scroll)
	(clouds.material_override as ShaderMaterial).set_shader_parameter("scroll", scroll)
	_update_bombers(dt)
	fighters.update(dt)
	_gunners(dt)
	_update_gun(dt)
	if follow >= 0:
		var fl = fighters.list[follow]
		var fb: Basis = fl.node.basis
		cam.global_transform = Transform3D(Basis.looking_at(fl.fwd * 60.0 - fb.y * 4.0 + fb.x * 3.0 - fb.z * 0.0, fb.y), fl.node.position - fl.fwd * 22.0 + fb.y * 4.5 - fb.x * 6.0)
	elif outside:
		_orbit_cam()
	var cp := cam.global_position
	ground.position = Vector3(cp.x, -ALTITUDE, cp.z)
	clouds.position = Vector3(cp.x, -ALTITUDE + 2200.0, cp.z)
	bullets.update(dt, fighters.pos, fighters.alive, cp)
	flak_t -= dt
	if flak_t <= 0.0:
		flak_t = randf_range(0.6, 2.0)
		var near := bombers[randi() % 60].pos
		fx.flak(near + Vector3(randf_range(-250, 250), randf_range(-80, 120), randf_range(-300, 300)))
	fx.update(dt)
	cross.queue_redraw()
	hud.text = "Bf 109s down: %d (you: %d)    B-17s lost: %d of %d\n%.1f ms  (%d fps)    draw calls: %d" % [
		fighters.kills, fighters.by_player, lost, BOMBERS, dt * 1000.0, Engine.get_frames_per_second(),
		Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)]
	if test:
		_test_step(dt)

# ---- the test run ----

# aim at the nearest fighter the gun can bear on, leading it, and fire when on
func _test_aim(dt: float) -> bool:
	var mine := bombers[me]
	var inv := mine.basis.inverse()
	var eye := mine.pos + mine.basis * PIVOT
	var best := -1
	var bd := 1100.0
	var want := Vector2.ZERO
	for f in Fighters.COUNT:
		if not fighters.alive[f]:
			continue
		var fp: Vector3 = fighters.pos[f]
		var d := eye.distance_to(fp)
		if d > bd:
			continue
		var fl = fighters.list[f]
		var lead: Vector3 = fp + (fl.fwd * Fighters.SPEED + Fighters.WIND) * (d / Bullets.MUZZLE) * 1.05
		var l := (inv * (lead - eye)).normalized()
		var y := atan2(-l.z, -l.x)
		var p := asin(l.y)
		if absf(y) < YAW_LIM and p > PITCH_MIN and p < PITCH_MAX:
			best = f
			bd = d
			want = Vector2(y, p)
	if best < 0:
		return false
	yaw = move_toward(yaw, want.x, dt * 2.5)
	pitch = move_toward(pitch, want.y, dt * 2.5)
	return absf(yaw - want.x) < 0.03 and absf(pitch - want.y) < 0.03

func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(out_dir.path_join(name))

var _step := 0
func _test_step(dt: float) -> void:
	if t > 5.0 and t < 38.0:
		frame_ms.append(get_process_delta_time() * 1000.0)
	var plan := [[18.0, "waist.png"], [24.0, "outside.png"], [30.0, "formation.png"], [35.0, "fighter.png"], [38.0, ""]]
	if _step >= plan.size() or t < plan[_step][0]:
		return
	var name: String = plan[_step][1]
	_step += 1
	if name != "":
		_shot(name)
		# then set up the next view
		if name == "waist.png":
			outside = true
			orbit = Vector3(-2.0, 0.12, 45.0)
		elif name == "outside.png":
			orbit = Vector3(-2.6, 0.35, 900.0)
		elif name == "formation.png":
			for f in Fighters.COUNT: # behind one on its way in
				if fighters.alive[f]:
					follow = f
					fighters.list[f].state = Fighters.ATTACK
					fighters.list[f].target = 6
					break
		return
	var ms := frame_ms.duplicate()
	ms.sort()
	var sum := 0.0
	for v in ms:
		sum += v
	print("FRAMES %d  avg %.2f ms  median %.2f  p95 %.2f  p99 %.2f  max %.2f" % [ms.size(), sum / ms.size(), ms[ms.size() / 2], ms[int(ms.size() * 0.95)], ms[int(ms.size() * 0.99)], ms[ms.size() - 1]])
	print("VIDEO MEM %.0f MB  STATIC MEM %.0f MB  DRAW CALLS %d  OBJECTS %d" % [Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)])
	print("KILLS %d (gun %d)  LOST %d" % [fighters.kills, fighters.by_player, lost])
	get_tree().quit()
