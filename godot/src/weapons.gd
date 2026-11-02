extends RefCounted
# Browning M2 .50 calibre guns: firing, ballistics (muzzle velocity, gravity, air drag), tracers,
# muzzle flash, ammo, reloading and overheating. The model's guns swing to follow the aim.
const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Bomber := preload("res://src/bomber.gd")
const Browning := preload("res://src/browning.gd")
const CabinLook := preload("res://src/cabinlook.gd")
const Interior := preload("res://src/interior.gd")

# the parts of the airframe a gun mustn't fire through: wings (from the wing roots), engines, the fin
# and the tailplanes (bomber space; the fuselage itself is kept out of the guns' arcs by their limits)
static var AIRFRAME: Array = _airframe()
static func _airframe() -> Array:
	var out: Array = []
	for p in Bomber.PARTS:
		if p.kind == "wing" or p.kind == "engine" or p.kind == "tail":
			for q in p.boxes:
				out.append(AABB(Vector3(q[0], q[2], q[4]), Vector3(q[1] - q[0], q[3] - q[2], q[5] - q[4])))
	return out
static var HANDLE_MAT: StandardMaterial3D = Mat.standard({color = 0x1d1b18, roughness = 0.6, metalness = 0.3}) # black bakelite grips
const UP := Vector3(0, 1, 0)
const FWD := Vector3(0, 0, -1)
const MUZZLE_SPEED := 890.0 # m/s
const GRAVITY := 9.81
const DRAG := 0.00025 # simple quadratic drag on the bullet's speed through the air
const WIND := Vector3(0, 0, Bomber.AIRSPEED) # the air streams past the formation (which stays at the origin)
const LIFE := 2.5 # seconds a round is simulated (~1.7 km, well past effective range)
const TRACER_EVERY := 5 # (every fifth round a tracer, as the belts were loaded)
const TRACER_RANGE := 500.0 # m from the camera
const CONVERGENCE := 350.0 # m: guns are harmonised so rounds cross the sight line here
const SPREAD := 0.0018 # rad, gun dispersion
# the same numbers the lead indicator uses to predict where a round goes
const BALLISTICS := {MUZZLE_SPEED = MUZZLE_SPEED, GRAVITY = GRAVITY, DRAG = DRAG, WIND = WIND}
const MAX_BULLETS := 6000
const MAX_TRACERS := 1000
const ALLIED_TRACER := [1.0, 0.42, 0.12] # red-orange
const ENEMY_TRACER := [0.75, 1.0, 0.45] # vs. German yellow-green

# per position: rounds per load (all guns of the position together) and reload time
const LOADS := {twin = {ammo = 500, reload = 5.0}, single = {ammo = 250, reload = 3.5}}
const RPM := 750.0
const HEAT_PER_SHOT := 1.0 / 45 # at 12.5 rounds/s a barrel overheats after ~6 s of non-stop fire
const COOL := 0.12 # per second (so short bursts never overheat)
const UNJAM := 0.45 # an overheated gun fires again below this heat

## A node's transform relative to `root` (one of its ancestors), whether or not it's in the tree.
static func rel_xf(n: Node3D, root: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	var x: Node = n
	while x and x != root:
		if x is Node3D:
			t = (x as Node3D).transform * t
		x = x.get_parent()
	return t

## Move `child` under `parent`, keeping where it is (Three's attach), both under `root`.
static func attach_keep(parent: Node3D, child: Node3D, root: Node3D) -> void:
	var xf := rel_xf(parent, root).affine_inverse() * rel_xf(child, root)
	if child.get_parent():
		child.get_parent().remove_child(child)
	parent.add_child(child)
	child.transform = xf

static func world_xf(n: Node3D) -> Transform3D:
	return n.global_transform if n.is_inside_tree() else rel_xf(n, null)

const TRACER_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
void fragment() {
	ALBEDO = COLOR.rgb * 60.0; // far above the bloom threshold
}
"""
# the glowing head: a few pixels wide at any distance, so tracers seen end-on still show
const HEAD_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, skip_vertex_transform;
uniform sampler2D map : filter_linear, repeat_disable;
uniform float px = 7.0;
void vertex() {
	vec4 c = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0));
	POSITION = c + vec4(VERTEX.xy * px * 2.0 / VIEWPORT_SIZE * c.w, 0.0, 0.0);
}
void fragment() {
	vec4 t = texture(map, UV);
	ALBEDO = COLOR.rgb * 40.0 * t.rgb;
	ALPHA = t.a;
}
"""

## All rounds in flight. Tracers are drawn as glowing streaks; ball rounds are only simulated.
class Bullets:
	var p := PackedFloat32Array()
	var v := PackedFloat32Array()
	var age := PackedFloat32Array()
	var tracer := PackedByteArray()
	var team: Array = []
	var owner: Array = []
	var src: Array = []
	var cannon := PackedByteArray()
	var count := 0
	var player_fired := 0
	var mesh: MultiMeshInstance3D
	var points: MultiMeshInstance3D
	var _tb := PackedFloat32Array() # (the tracers' instance data: transform and colour)
	var _hb := PackedFloat32Array() # (the heads')

	func _init(scene: Node) -> void:
		var W = load("res://src/weapons.gd")
		p.resize(MAX_BULLETS * 3)
		v.resize(MAX_BULLETS * 3)
		age.resize(MAX_BULLETS)
		tracer.resize(MAX_BULLETS)
		cannon.resize(MAX_BULLETS)
		team.resize(MAX_BULLETS)
		owner.resize(MAX_BULLETS)
		src.resize(MAX_BULLETS)
		var geo = Geo.cylinder(0.03, 0.03, 1, 6, 1, true).rotate_x(PI / 2).translate(0, 0, -0.5) # (thin: a streak, not a bar)
		var sh := Shader.new()
		sh.code = W.TRACER_SHADER
		var mat := ShaderMaterial.new()
		mat.shader = sh
		mesh = W._instanced(scene, geo.to_mesh(mat), MAX_TRACERS)
		var hs := Shader.new()
		hs.code = W.HEAD_SHADER
		var hm := ShaderMaterial.new()
		hm.shader = hs
		hm.set_shader_parameter("map", W.glow_texture())
		var quad := QuadMesh.new()
		quad.material = hm
		points = W._instanced(scene, quad, MAX_TRACERS)
		_tb.resize(MAX_TRACERS * 16)
		_hb.resize(MAX_TRACERS * 16)
		for i in MAX_TRACERS: # (the heads' basis: identity)
			_hb[i * 16] = 1.0
			_hb[i * 16 + 5] = 1.0
			_hb[i * 16 + 10] = 1.0

	## team 'allied' | 'enemy'; owner = who gets the credit ('player', 'crew', a fighter); cannon = 20 mm shell;
	## src = the aircraft it was fired from (its own rounds can't hit it); life = seconds to simulate it.
	func spawn(pos: Vector3, vel: Vector3, is_tracer: bool, team_ := "allied", owner_ = null, is_cannon := false, src_ = null, life := LIFE) -> void:
		if count >= MAX_BULLETS:
			return
		var i := count
		count += 1
		var j := i * 3
		p[j] = pos.x; p[j + 1] = pos.y; p[j + 2] = pos.z
		v[j] = vel.x; v[j + 1] = vel.y; v[j + 2] = vel.z
		age[i] = LIFE - life
		tracer[i] = 1 if is_tracer else 0
		team[i] = team_; owner[i] = owner_; src[i] = src_; cannon[i] = 1 if is_cannon else 0
		if owner_ is String and owner_ == "player": # (for your accuracy)
			player_fired += 1

	## cam_pos: tracers keep a minimum on-screen width (a real tracer's glow stays visible far away).
	## collide(a, b, team, owner, cannon, src): tests this frame's path of a round, true = it hit something.
	func update(dt: float, cam_pos = null, collide = null) -> void:
		var t := 0
		var has_cam := cam_pos != null
		var cam: Vector3 = cam_pos if has_cam else Vector3.ZERO
		var hit := collide is Callable and (collide as Callable).is_valid()
		var wx := WIND.x
		var wy := WIND.y
		var wz := WIND.z
		var r2 := TRACER_RANGE * TRACER_RANGE
		var i := 0
		while i < count:
			var j := i * 3
			age[i] += dt
			if age[i] > LIFE:
				remove(i)
				continue
			var fx := p[j]
			var fy := p[j + 1]
			var fz := p[j + 2]
			# drag acts on the speed through the air, gravity pulls down
			var rx := v[j] - wx
			var ry := v[j + 1] - wy
			var rz := v[j + 2] - wz
			var k := DRAG * sqrt(rx * rx + ry * ry + rz * rz) * dt
			v[j] -= rx * k
			v[j + 1] -= ry * k + GRAVITY * dt
			v[j + 2] -= rz * k
			p[j] = fx + v[j] * dt
			p[j + 1] = fy + v[j + 1] * dt
			p[j + 2] = fz + v[j + 2] * dt
			# test the whole path since last frame, so fast rounds can't skip through a plane
			if hit and collide.call(Vector3(fx, fy, fz), Vector3(p[j], p[j + 1], p[j + 2]), team[i], owner[i], cannon[i] == 1, src[i]):
				remove(i)
				continue
			# tracers are drawn only within TRACER_RANGE of you: further off they cluttered the whole sky
			if tracer[i] and t < MAX_TRACERS:
				var dx := p[j] - cam.x
				var dy := p[j + 1] - cam.y
				var dz := p[j + 2] - cam.z
				var d2 := dx * dx + dy * dy + dz * dz
				if not has_cam or d2 < r2:
					var dir := Vector3(v[j], v[j + 1], v[j + 2])
					var speed := dir.length()
					var d := sqrt(d2) if has_cam else 999.0
					var w := maxf(1, d * 0.0011 / 0.03) if has_cam else 1.0
					var b := Basis(Quaternion(FWD, dir / speed)).scaled_local(Vector3(w, w, minf(speed * 0.022, 20))) # streak length ~ motion blur
					var c: Array = ENEMY_TRACER if team[i] == "enemy" else ALLIED_TRACER
					# dimmer close by: your own guns' tracers, metres from your eye, bloomed into broad white bars
					var f := minf(1, 0.06 + maxf(0, d - 5) / 80)
					var o := t * 16
					_tb[o] = b.x.x; _tb[o + 1] = b.y.x; _tb[o + 2] = b.z.x; _tb[o + 3] = p[j]
					_tb[o + 4] = b.x.y; _tb[o + 5] = b.y.y; _tb[o + 6] = b.z.y; _tb[o + 7] = p[j + 1]
					_tb[o + 8] = b.x.z; _tb[o + 9] = b.y.z; _tb[o + 10] = b.z.z; _tb[o + 11] = p[j + 2]
					_tb[o + 12] = c[0] * f; _tb[o + 13] = c[1] * f; _tb[o + 14] = c[2] * f; _tb[o + 15] = 1.0
					_hb[o + 3] = p[j]; _hb[o + 7] = p[j + 1]; _hb[o + 11] = p[j + 2]
					_hb[o + 12] = c[0] * f; _hb[o + 13] = c[1] * f; _hb[o + 14] = c[2] * f; _hb[o + 15] = 1.0
					t += 1
			i += 1
		if t:
			RenderingServer.multimesh_set_buffer(mesh.multimesh.get_rid(), _tb)
			RenderingServer.multimesh_set_buffer(points.multimesh.get_rid(), _hb)
		mesh.multimesh.visible_instance_count = t
		points.multimesh.visible_instance_count = t

	func remove(i: int) -> void: # swap with the last round
		count -= 1
		var last := count
		if i == last:
			return
		for k in 3:
			p[i * 3 + k] = p[last * 3 + k]
			v[i * 3 + k] = v[last * 3 + k]
		age[i] = age[last]
		tracer[i] = tracer[last]
		team[i] = team[last]; owner[i] = owner[last]; src[i] = src[last]; cannon[i] = cannon[last]

## A MultiMeshInstance3D of `n` (none visible yet) at the scene's origin, never culled.
static func _instanced(scene: Node, mesh: Mesh, n: int, colors := true) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = n
	mm.visible_instance_count = 0
	mm.custom_aabb = AABB(Vector3(-1e6, -1e6, -1e6), Vector3(2e6, 2e6, 2e6))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	scene.add_child(mi)
	return mi

## Main axis of a set of points (power iteration on the covariance).
static func principal_axis(pts: Array) -> Dictionary:
	var c := Vector3.ZERO
	for q in pts:
		c += q
	c /= pts.size()
	var m := PackedFloat64Array([0, 0, 0, 0, 0, 0, 0, 0, 0])
	for q in pts:
		var d := [q.x - c.x, q.y - c.y, q.z - c.z]
		for r in 3:
			for s in 3:
				m[r * 3 + s] += d[r] * d[s]
	var a := Vector3(0.3, 0.2, 1).normalized()
	for n in 30:
		a = Vector3(m[0] * a.x + m[1] * a.y + m[2] * a.z, m[3] * a.x + m[4] * a.y + m[5] * a.z, m[6] * a.x + m[7] * a.y + m[8] * a.z).normalized()
	return {centre = c, axis = a}

static var _glow: ImageTexture
static func glow_texture() -> ImageTexture:
	if _glow:
		return _glow
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(x + 0.5 - 16, y + 0.5 - 16).length() / 16.0
			var a := lerpf(1.0, 0.6, d / 0.35) if d < 0.35 else lerpf(0.6, 0.0, minf(1, (d - 0.35) / 0.65))
			img.set_pixel(x, y, Color(1, 1, 1, a))
	img.generate_mipmaps()
	_glow = ImageTexture.create_from_image(img)
	return _glow

## The muzzle flash of a .50 seen end-on: a hot white core and five ragged prongs of flame, yellow going
## to orange at their tips (each shot's sprite turned and sized at random, so no two look alike).
static func flash_texture() -> Texture2D:
	var g := Canvas2D.new(128, 128)
	g.translate(64, 64)
	var seed := [7]
	var rnd := func() -> float:
		seed[0] = (seed[0] * 16807) % 2147483647
		return seed[0] / 2147483647.0
	g.global_composite_operation = "lighter"
	for i in 5: # the prongs: tapering, a little crooked
		var a: float = (i / 5.0) * PI * 2 + rnd.call() * 0.3
		var len: float = 44 + rnd.call() * 18
		var w: float = 7 + rnd.call() * 4
		var grd = g.create_linear_gradient(0, 0, cos(a) * len, sin(a) * len)
		grd.add_color_stop(0, "rgba(255,250,225,1)"); grd.add_color_stop(0.35, "rgba(255,205,110,0.85)"); grd.add_color_stop(1, "rgba(255,110,30,0)")
		g.fill_style = grd
		g.begin_path()
		g.move_to(cos(a + PI / 2) * w, sin(a + PI / 2) * w)
		g.quadratic_curve_to(cos(a + 0.12) * len * 0.5, sin(a + 0.12) * len * 0.5, cos(a) * len, sin(a) * len)
		g.quadratic_curve_to(cos(a - 0.12) * len * 0.5, sin(a - 0.12) * len * 0.5, cos(a - PI / 2) * w, sin(a - PI / 2) * w)
		g.fill()
	var core = g.create_radial_gradient(0, 0, 0, 0, 0, 30)
	core.add_color_stop(0, "rgba(255,255,245,1)"); core.add_color_stop(0.4, "rgba(255,225,160,0.7)"); core.add_color_stop(1, "rgba(255,150,60,0)")
	g.fill_style = core
	g.begin_path()
	g.arc(0, 0, 30, 0, PI * 2)
	g.fill()
	return g.texture(true)

## The flame out of the muzzle seen from the side: a short tongue, bright at the muzzle, ragged at the end.
static func flame_texture() -> Texture2D:
	var g := Canvas2D.new(64, 128)
	g.global_composite_operation = "lighter"
	for i in 6:
		var w := 26.0 - i * 3
		var h := 120.0 - i * 14
		var grd = g.create_linear_gradient(0, 128, 0, 128 - h)
		grd.add_color_stop(0, "rgba(255,245,210,0.55)"); grd.add_color_stop(0.5, "rgba(255,180,80,0.3)"); grd.add_color_stop(1, "rgba(255,100,20,0)")
		g.fill_style = grd
		g.begin_path()
		g.move_to(32 - w / 2, 128)
		g.quadratic_curve_to(32 - w * 0.7, 128 - h * 0.5, 32 + (4 if i % 2 else -4), 128 - h)
		g.quadratic_curve_to(32 + w * 0.7, 128 - h * 0.5, 32 + w / 2, 128)
		g.fill()
	return g.texture(true)

const FLASH_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
uniform sampler2D map : source_color, filter_linear_mipmap, repeat_disable;
uniform vec3 color = vec3(9.0, 7.2, 4.5);
instance uniform float rot = 0.0;
void vertex() { // a sprite: facing the eye, turned `rot` about its centre, its node's scale
	float s = length(MODEL_MATRIX[0].xyz);
	vec2 q = mat2(vec2(cos(rot), sin(rot)), vec2(-sin(rot), cos(rot))) * VERTEX.xy * s;
	vec4 c = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	POSITION = PROJECTION_MATRIX * (c + vec4(q, 0.0, 0.0));
}
void fragment() {
	vec4 t = texture(map, UV);
	ALBEDO = t.rgb * color;
	ALPHA = t.a;
}
"""
const FLAME_SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
uniform sampler2D map : source_color, filter_linear_mipmap, repeat_disable;
void fragment() {
	vec4 t = texture(map, UV);
	ALBEDO = t.rgb * vec3(6.0, 5.1, 3.6);
	ALPHA = t.a;
}
"""
static var FLASH_MAT: ShaderMaterial
static var FLAME_MAT: ShaderMaterial
static var FLAME_MESH: ArrayMesh
static func _flash_stuff() -> void:
	if FLASH_MAT:
		return
	var s := Shader.new()
	s.code = FLASH_SHADER
	FLASH_MAT = ShaderMaterial.new()
	FLASH_MAT.shader = s
	FLASH_MAT.set_shader_parameter("map", flash_texture()) # (bright, but not a white-out through the bloom)
	var s2 := Shader.new()
	s2.code = FLAME_SHADER
	FLAME_MAT = ShaderMaterial.new()
	FLAME_MAT.shader = s2
	FLAME_MAT.set_shader_parameter("map", flame_texture())
	# two crossed quads along -Z from the muzzle
	var q := func(rot: float): return Geo.plane(0.16, 0.42).translate(0, 0.21, 0).rotate_x(-PI / 2).rotate_z(rot)
	FLAME_MESH = Geo.merge([q.call(0), q.call(PI / 2)]).to_mesh(FLAME_MAT)

## Spent cases and links: they fly out of the guns' ejection ports as they fire, tumble, and fall to the
## floor (where they bounce and lie a while) or, from the turrets outside, away out of sight. Kept in
## the bomber's own space, so they lie still on its floor however it moves.
## (Each case keeps its own slot in its instanced mesh while it lies there: only those still moving are
## written again each frame, the hundreds lying on the floor once, when they come to rest.)
class Casings:
	var MAX := 1500 # (after a fight the floor is covered in brass: the oldest go first)
	var cases: MultiMeshInstance3D
	var links: MultiMeshInstance3D
	var items: Array = []
	var moving: Array = []
	var it
	var lying := 0
	var _free := {false: [], true: []}
	var _b := PackedFloat32Array() # (the cases' instance transforms, then the links')
	var _dirty := {false: false, true: false}

	func _init(parent: Node3D, interior) -> void:
		var W = load("res://src/weapons.gd")
		var brass := Mat.standard({color = 0xb58a3c, roughness = 0.35, metalness = 0.9})
		var link := Mat.standard({color = 0x2a2a28, roughness = 0.5, metalness = 0.7})
		cases = W._instanced(parent, Geo.cylinder(0.0065, 0.0065, 0.1, 6).to_mesh(brass), MAX, false)
		links = W._instanced(parent, Geo.box(0.03, 0.006, 0.016).to_mesh(link), MAX, false)
		for m in [cases, links]:
			m.multimesh.visible_instance_count = -1
		_b.resize(MAX * 24) # (all zero: a slot with nothing in it draws nothing)
		for k in [false, true]:
			_free[k] = range(MAX - 1, -1, -1)
			_dirty[k] = true
		it = interior
		# already some brass and links on the floor round the hand-held guns, from the last fight
		if interior:
			for s in interior.stations:
				if s.get("browning") != "flex" and not s.get("socket", false):
					continue
				for k in 16:
					var at := Vector3(s.stand.x + (randf() - 0.5) * 0.9, s.stand.y, s.stand.z + (randf() - 0.5) * 0.9)
					var floor: float = interior.floor_at(at.x, at.z, at.y + 0.3)
					if not is_finite(floor):
						continue
					at.y = floor + 0.007
					_add({p = at, v = Vector3(), r = Vector3(PI / 2, randf() * 6, 0), w = Vector3(), link = k % 3 == 0, out = false, age = 0.0, rest = true, floor = floor, old = true})

	func _add(c: Dictionary) -> void:
		var fl: Array = _free[c.link]
		if not fl.size(): # (the oldest of its kind lying there)
			for k in items.size():
				if items[k].rest and items[k].link == c.link:
					_drop(k)
					break
		if not fl.size():
			return
		c.slot = fl.pop_back()
		items.append(c)
		if c.rest:
			lying += 1
		else:
			moving.append(c)
		_write(c)

	func _drop(k: int) -> void:
		var c: Dictionary = items[k]
		items.remove_at(k)
		if c.rest:
			lying -= 1
		else:
			moving.erase(c)
		var o: int = (MAX if c.link else 0) * 12 + c.slot * 12
		for i in 12:
			_b[o + i] = 0.0
		_dirty[c.link] = true
		_free[c.link].append(c.slot)

	func _write(c: Dictionary) -> void:
		var bs := Basis.from_euler(c.r, EULER_ORDER_XYZ)
		var o: int = (MAX if c.link else 0) * 12 + c.slot * 12
		_b[o] = bs.x.x; _b[o + 1] = bs.y.x; _b[o + 2] = bs.z.x; _b[o + 3] = c.p.x
		_b[o + 4] = bs.x.y; _b[o + 5] = bs.y.y; _b[o + 6] = bs.z.y; _b[o + 7] = c.p.y
		_b[o + 8] = bs.x.z; _b[o + 9] = bs.y.z; _b[o + 10] = bs.z.z; _b[o + 11] = c.p.z
		_dirty[c.link] = true

	## at, vel: bomber space. is_link: a link rather than a case. outside: no floor under it.
	func spawn(at: Vector3, vel: Vector3, is_link: bool, outside: bool) -> void:
		if items.size() >= MAX * 2: # (the oldest lying there)
			for k in items.size():
				if items[k].rest:
					_drop(k)
					break
		_add({p = at, v = vel, r = Vector3(randf() * 6, randf() * 6, randf() * 6), w = Vector3((randf() - 0.5) * 40, (randf() - 0.5) * 40, (randf() - 0.5) * 40),
			link = is_link, out = outside, age = 0.0, rest = false, floor = -INF if outside or not it else it.floor_at(at.x, at.z, at.y)})

	## ear: where you're listening from (bomber space), or null (not aboard): each case that lands near you
	## pings as it hits the floor (the first, hardest bounces; a few a frame at most).
	func update(dt: float, ear = null, audio = null) -> void:
		var pings := 0
		var i := 0
		while i < moving.size():
			var c: Dictionary = moving[i]
			c.age += dt
			if c.out and c.age > 1.5: # (out of the window: gone; on the floor they stay)
				_drop(items.find(c))
				continue
			c.v.y -= 9.8 * dt
			if c.out:
				c.v.z += 40 * dt # (outside, the slipstream takes it)
			c.p += c.v * dt
			c.r += c.w * dt
			if c.p.y < c.floor + 0.007: # bounce, and soon lie still
				if ear != null and pings < 4 and c.v.y < -0.6: # (the clink of it)
					var d: float = c.p.distance_to(ear)
					var vol := minf(1, -c.v.y / 2.5) / (1 + d * d * 0.35)
					if vol > 0.03 and audio:
						audio.case_tink(vol, c.link)
						pings += 1
				c.p.y = c.floor + 0.007
				c.v = Vector3(c.v.x * 0.5, c.v.y * -0.3, c.v.z * 0.5)
				c.w *= 0.4
				if absf(c.v.y) < 0.25:
					c.rest = true
					c.r = Vector3(PI / 2, c.r.y, 0)
					lying += 1
					moving.remove_at(i)
					_write(c)
					continue
			_write(c)
			i += 1
		for k in [false, true]:
			if _dirty[k]:
				var o := (MAX if k else 0) * 12
				RenderingServer.multimesh_set_buffer((links if k else cases).multimesh.get_rid(), _b.slice(o, o + MAX * 12))
				_dirty[k] = false

const CHUTE := {rings = 46, sides = 10}
static var CAN_MAT: Material
static var MOUNT_MAT: Material
static var CHUTE_MAT: Material

## A nose gun in its ball socket: no gun in the model, so one laid out from the station itself.
static func socket_gun(station: Dictionary) -> Dictionary:
	var breech := Vector3(station.pivot[0], station.pivot[1], station.pivot[2])
	var axis := Vector3(station.rest[0], station.rest[1], station.rest[2]).normalized()
	return {mesh = null, axis = axis, breech = breech, muzzle = breech + axis * station.get("front", 1.0)}

## One gun position on a bomber: its barrels, the pivot they turn on, ammo, heat and reload state.
class GunPosition:
	var station: Dictionary
	var dome: Node3D
	var rest_dir: Vector3
	var pivot: Node3D
	var yaw_part: Node3D
	var full_part: Node3D
	var guns: Array
	var light: OmniLight3D
	var loadout: Dictionary # (the browser's `load`: a clash with GDScript's load())
	var ammo := 0
	var reload_left := 0.0
	var rounds := 0
	var aim_q := Quaternion.IDENTITY
	var yaw0 := 0.0
	var pitch0 := 0.0
	var elev_axis: Vector3
	var yaw := 0.0
	var pitch := 0.0
	var q_yaw := Quaternion.IDENTITY
	var q_pitch := Quaternion.IDENTITY
	var grip_local: Array
	var receiver = null
	var bomber
	var handles: MeshInstance3D
	var yoke: Node3D
	var chute: MeshInstance3D
	var chute_from: Vector3
	var chute_it: Node3D

	func _init(bomber_, station_: Dictionary) -> void:
		var W = load("res://src/weapons.gd")
		W._flash_stuff()
		station = station_
		dome = bomber_.interior.top_dome if station.id == "top" and bomber_.interior else null # the glass dome seen from inside, turns with the turret
		var model: Node3D = bomber_.model
		var root: Node3D = bomber_.group
		var fwd := Vector3(-sin(station.yaw), 0, -cos(station.yaw))

		# barrels: every mesh under the named gun nodes
		var barrels: Array = []
		for n in station.get("guns", []):
			var o = Interior.find_node(model, n)
			if o:
				if o is MeshInstance3D:
					barrels.append(o)
				for m in o.find_children("*", "MeshInstance3D", true, false):
					barrels.append(m)
		var info: Array = []
		if station.get("socket", false):
			info = [W.socket_gun(station)]
		else:
			for b in barrels:
				var verts := PackedVector3Array()
				for si in b.mesh.get_surface_count():
					verts.append_array(b.mesh.surface_get_arrays(si)[Mesh.ARRAY_VERTEX])
				var m: Transform3D = W.rel_xf(b, root)
				var pts: Array = []
				var stp := maxi(1, verts.size() / 600)
				for i in range(0, verts.size(), stp):
					pts.append(m * verts[i])
				var pa: Dictionary = W.principal_axis(pts)
				var axis: Vector3 = pa.axis
				if axis.dot(fwd) < 0: # point out of the aircraft
					axis = -axis
				var lo := INF
				var hi := -INF
				for q in pts:
					var d: float = (q - pa.centre).dot(axis)
					lo = minf(lo, d)
					hi = maxf(hi, d)
				info.append({mesh = b, axis = axis, muzzle = pa.centre + axis * hi, breech = pa.centre + axis * lo})
		if station.get("rest") != null:
			rest_dir = Vector3(station.rest[0], station.rest[1], station.rest[2])
		else:
			var s := Vector3.ZERO
			for g in info:
				s += g.axis
			rest_dir = s.normalized()
		# (a twin turret whose two barrels the model made as one mesh: a pair all the same)
		if station.get("twin") and info.size() == 1:
			info.append(info[0].duplicate())
		var pivot_pos: Vector3
		if station.get("pivot") != null:
			pivot_pos = Vector3(station.pivot[0], station.pivot[1], station.pivot[2])
		else:
			pivot_pos = Vector3.ZERO
			for g in info:
				pivot_pos += g.breech
			pivot_pos /= info.size()
		if station.get("twin"): # a turret's guns where the real ones are (its own layout), parallel, side by side
			var tw: Array = station.twin
			var p := [pivot_pos.x, pivot_pos.y, pivot_pos.z]
			var y0 := atan2(-rest_dir.x, -rest_dir.z)
			var p0 := asin(clampf(rest_dir.y, -1, 1))
			var across := Vector3(cos(y0), 0, -sin(y0))
			info.sort_custom(func(a, b): return (a.breech - pivot_pos).dot(across) < (b.breech - pivot_pos).dot(across))
			for i in info.size():
				var s: float = tw[0] if i else -tw[0]
				info[i].breech = Interior.turret_point(p, y0, p0, [s, tw[1], tw[2]])
				info[i].muzzle = Interior.turret_point(p, y0, p0, [s, tw[1], tw[3]])
				info[i].axis = rest_dir

		# pivot the guns turn on; parts listed in `turret` turn with them (yaw only or fully)
		pivot = Node3D.new()
		pivot.name = "GunPivot_" + station.id
		model.add_child(pivot)
		pivot.transform = Transform3D(Basis.IDENTITY, W.rel_xf(model, root).affine_inverse() * pivot_pos)
		for g in info:
			if g.mesh:
				W.attach_keep(pivot, g.mesh, root)
		var turret = station.get("turret")
		yaw_part = make_turret(model, root, turret.get("yaw") if turret else null, pivot_pos)
		full_part = make_turret(model, root, turret.get("full") if turret else null, pivot_pos)
		# the model's guns are a few low-poly tubes: in their place, Brownings (browning.gd). A flexible
		# gun is the whole gun on its mount; of a turret's only the jacketed barrels show.
		var flex: bool = station.get("browning") == "flex"
		for g in info:
			if g.mesh:
				g.mesh.visible = false
			var front: float = station.get("front", 1.5) if flex else g.breech.distance_to(g.muzzle)
			if flex and station.get("rest") != null: # (on its own mount: laid out by the station, not the model's barrel)
				g.axis = rest_dir
			var tw4 = station.twin[4] if station.get("twin") else null
			var gun: Node3D = Browning.build_browning("flex" if flex else "turret" if tw4 else "barrel", front, tw4 if tw4 else station.get("gun_rear", 0.12), flex, {feed = station.get("feed"), bag = station.get("bag", false)})
			var z_axis: Vector3 = -g.axis
			var x_axis := UP.cross(z_axis).normalized()
			var y_axis := z_axis.cross(x_axis)
			gun.transform = Transform3D(Basis(x_axis, y_axis, z_axis), (pivot_pos if flex else g.breech) - pivot_pos)
			pivot.add_child(gun)
			g.gun = gun
			if station.get("socket", false): # a hand-held nose gun carries its ammunition can on its left side, the belt into the feed tray
				if not W.CAN_MAT:
					W.CAN_MAT = CabinLook.inside_light(Mat.standard({color = 0x4a4f33, roughness = 0.7, metalness = 0.2}))
				var r: float = station.gun_rear
				var can := MeshInstance3D.new()
				can.mesh = Geo.merge([
					Geo.box(0.09, 0.15, 0.22).translate(-0.15, -0.02, r - 0.24),
					Geo.box(0.04, 0.03, 0.08).translate(-0.1, 0.05, r - 0.22), # the belt's chute into the tray
				].map(func(x): return x.to_non_indexed())).to_mesh(W.CAN_MAT)
				gun.add_child(can)
			if flex:
				g.muzzle = pivot_pos + g.axis * front

		guns = []
		for i in info.size():
			var g: Dictionary = info[i]
			var flash := MeshInstance3D.new()
			var fq := QuadMesh.new()
			fq.material = W.FLASH_MAT
			flash.mesh = fq
			flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			flash.position = g.muzzle - pivot_pos + g.axis * 0.1
			flash.visible = false
			pivot.add_child(flash)
			var flame := MeshInstance3D.new()
			flame.mesh = W.FLAME_MESH
			flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			flame.position = g.muzzle - pivot_pos
			flame.quaternion = Quaternion(Vector3(0, 0, -1), g.axis)
			flame.visible = false
			pivot.add_child(flame)
			# where its spent cases come out: a flexible gun's ejection port, a turret gun's breech
			var gun: Node3D = g.get("gun")
			var port: Vector3 = gun.transform * (gun.get_meta("receiver") as Vector3) if gun and gun.has_meta("receiver") else g.breech - pivot_pos + g.axis * 0.1
			guns.append({muzzle = g.muzzle - pivot_pos, flash = flash, flame = flame, flame_q = flame.quaternion, port = port, gun = gun, gun_at = gun.position if gun else Vector3.ZERO, kick = 0.0, timer = (i * 60.0) / RPM / info.size(), heat = 0.0, jammed = false})
		light = OmniLight3D.new()
		light.light_color = Color.hex(0xffb060ff)
		light.light_energy = 0.0
		light.omni_range = 9.0
		light.omni_attenuation = 2.0
		var mc := Vector3.ZERO
		for g in guns:
			mc += g.muzzle
		light.position = mc / guns.size()
		pivot.add_child(light)

		loadout = LOADS.twin if guns.size() > 1 else LOADS.single
		ammo = loadout.ammo
		# the guns traverse (yaw) and elevate (pitch) like a real mount, so they never roll about the barrel
		yaw0 = atan2(-rest_dir.x, -rest_dir.z)
		pitch0 = asin(clampf(rest_dir.y, -1, 1))
		elev_axis = Vector3(cos(yaw0), 0, -sin(yaw0))
		yaw = yaw0
		pitch = pitch0
		# the grips, in the pivot's frame: a pair of spade grips behind the breech (one each side of a
		# twin mount's guns). The top turret's control handles are elsewhere (see grips_world).
		var rear := Vector3.ZERO
		for g in info:
			rear += g.breech
		rear = rear / info.size() - rest_dir * 0.07
		var side := rest_dir.cross(Vector3(0, 1, 0)).normalized()
		var spread: float = maxf(0.12, info[0].breech.distance_to(info[1].breech) / 2 + 0.03) if info.size() > 1 else 0.075
		grip_local = [-1, 1].map(func(s): return rear + side * (s * spread) + Vector3(0, -0.02, 0) - pivot_pos)
		if flex: # the Browning's own spade grips
			var gun: Node3D = info[0].gun
			grip_local = (gun.get_meta("grips") as Array).map(func(q): return gun.transform * q)
			grip_local.sort_custom(func(a, b): return a.dot(side) < b.dot(side)) # [left, right] from behind it
			receiver = gun.transform * (gun.get_meta("receiver") as Vector3)
		bomber = bomber_
		# the handles themselves (the model has none): spade grips on the guns, the top turret's control
		# handles on their yoke
		if station.id != "ball" and not flex:
			var is_yoke: bool = station.id == "top" or station.id == "tail"
			var bar: float = 0.34 if station.id == "top" else 0.3 if station.id == "tail" else spread * 2
			var gs: Array = []
			for s in [-1, 1]:
				gs.append(Geo.cylinder(0.013, 0.015, 0.1, 8).translate(s * bar / 2, -0.02, 0))
			gs.append(Geo.cylinder(0.01, 0.01, bar, 6).rotate_z(PI / 2).translate(0, 0.035, 0))
			handles = MeshInstance3D.new()
			handles.mesh = Geo.merge(gs.map(func(x): return x.to_non_indexed())).to_mesh(W.HANDLE_MAT)
			if is_yoke:
				if bomber.interior:
					bomber.interior.group.add_child(handles) # (placed each frame: they turn with the guns, kept level)
			else:
				pivot.add_child(handles)
				handles.position = (grip_local[0] + grip_local[1]) * 0.5
				handles.quaternion = Quaternion(Vector3(1, 0, 0), side) # (across the gun)
		# a flexible gun's mount stands where the station puts it (the waist guns are staggered, and sit
		# higher in the window than the model's): everything on the pivot moves with it
		if station.get("mount") != null:
			pivot.position += Vector3(station.mount[0], station.mount[1], station.mount[2])
		if flex and bomber.interior and station.get("sill") != null:
			build_mount(bomber, station)
		elif flex and bomber.interior and not station.get("socket", false): # its post (a nose gun's mount is its ball socket in the glass: build_nose_glazing), down from the pivot to the window sill, braced to the wall
			var p: Vector3 = W.rel_xf(bomber.interior.group, root).affine_inverse() * (W.rel_xf(pivot, root).origin)
			var out := signf(p.x)
			var mat = CabinLook.inside_light(Mat.standard({color = 0x2c2e2a, roughness = 0.55, metalness = 0.6}))
			var post := MeshInstance3D.new()
			post.mesh = Geo.merge([
				Geo.cylinder(0.022, 0.026, 0.3, 10).translate(p.x, p.y - 0.25, p.z),
				Geo.cylinder(0.035, 0.035, 0.05, 10).translate(p.x, p.y - 0.12, p.z), # the swivel
				Geo.box(0.16, 0.04, 0.1).translate(p.x + out * 0.06, p.y - 0.4, p.z), # its foot on the sill
			].map(func(x): return x.to_non_indexed())).to_mesh(mat)
			bomber.interior.group.add_child(post)

	## Where the gunner's hands go, in world space: [left, right]. On a gun's spade grips they swing and
	## elevate with it; the top turret's handles turn with the turret but stay level.
	func grips_world(out = null) -> Array:
		if out == null or not out is Array or out.size() < 2:
			out = [Vector3(), Vector3()]
		var W = load("res://src/weapons.gd")
		var id: String = station.id
		var m: Transform3D = W.world_xf(bomber.group)
		var it_inv := Transform3D.IDENTITY # (the handles live in the interior's group: bomber space to it)
		if handles and handles.get_parent() and bomber.interior and handles.get_parent() == bomber.interior.group:
			it_inv = W.rel_xf(bomber.interior.group, bomber.group).affine_inverse()
		if id == "top":
			var f := Vector3(-sin(yaw), 0, -cos(yaw))
			var sd := Vector3(-f.z, 0, f.x)
			for pair in [[0, -1], [1, 1]]:
				out[pair[0]] = m * (Vector3(0, 1.06, -6.71) + f * 0.3 + sd * (pair[1] * 0.17))
			if handles: # the handles on their yoke, in front of the gunner, turned with the turret
				handles.transform = it_inv * Transform3D(Basis(UP, yaw), Vector3(0, 1.06, -6.71) + f * 0.3)
		elif id == "tail":
			# the tail gunner's handles on their yoke, linked to the guns and the sight: they swing with
			# his aim, so they stay low in front of him (his hands at the bottom of his view, never over
			# the sight) wherever he points
			var cp := cos(pitch)
			var sp := sin(pitch)
			var sy := sin(yaw)
			var cy := cos(yaw)
			var f := Vector3(-sy * cp, sp, -cy * cp)
			var up := Vector3(-sy * -sp, cp, -cy * -sp)
			var sd := f.cross(up)
			var c: Vector3 = station.eye + f * 0.12 + up * -0.3 # (just inside the rear window, under its sill)
			c.y -= maxf(0, sp) * station.get("duck", 0.0) # (down with his head as he ducks to aim up)
			for pair in [[0, 1], [1, -1]]:
				out[pair[0]] = m * (c + sd * (-pair[1] * 0.15))
			if handles:
				handles.transform = it_inv * Transform3D(Basis(sd, up, f), c)
		else:
			var pm: Transform3D = W.world_xf(pivot)
			for i in 2:
				out[i] = pm * (grip_local[i] as Vector3)
		return out

	## A waist gun's mount in its window: the socket bolted to the sill (fixed), the yoke on its pintle,
	## turning with the gun in traverse only (aim()), and the flexible steel chute from the ammunition box
	## up into the gun's feed tray, bent each frame as the gun swings (update_chute).
	func build_mount(bomber_, station_: Dictionary) -> void:
		var W = load("res://src/weapons.gd")
		var it = bomber_.interior
		var p := Vector3(station_.pivot[0], station_.pivot[1], station_.pivot[2])
		var out := signf(p.x)
		var sill: float = station_.sill
		if not W.MOUNT_MAT:
			W.MOUNT_MAT = CabinLook.inside_light(Mat.standard({color = 0x2c2e2a, roughness = 0.55, metalness = 0.6}))
		var parts: Array = [
			Geo.cylinder(0.036, 0.04, 0.1, 14).translate(p.x, sill + 0.05, p.z), # the socket the pintle drops into
			Geo.cylinder(0.05, 0.05, 0.015, 14).translate(p.x, sill + 0.007, p.z), # its flange
			Geo.box(0.2, 0.025, 0.16).translate(p.x + out * 0.03, sill - 0.012, p.z), # the plate on the sill
		]
		for s in [-1, 1]: # its bolts
			for t in [-1, 1]:
				parts.append(Geo.cylinder(0.008, 0.008, 0.012, 6).translate(p.x + out * 0.03 + s * 0.08, sill + 0.006, p.z + t * 0.06))
		parts.append(Geo.box(0.03, 0.22, 0.05).translate(p.x - out * 0.05, sill - 0.12, p.z)) # a gusset down the wall under it
		var socket := MeshInstance3D.new()
		socket.mesh = Geo.merge(parts.map(func(x): return x.to_non_indexed())).to_mesh(W.MOUNT_MAT)
		it.group.add_child(socket)
		var drop := maxf(0.05, p.y - 0.16 - (sill + 0.03))
		yoke = Node3D.new()
		yoke.position = pivot.position
		pivot.get_parent().add_child(yoke)
		var y := Browning.build_yoke(drop)
		y.rotation.y = yaw0 # (built facing -Z: turned to the gun's rest direction)
		yoke.add_child(y)
		if station_.get("feed_box") != null:
			if not W.CHUTE_MAT:
				W.CHUTE_MAT = CabinLook.inside_light(Mat.standard({color = 0x3c3f38, roughness = 0.7, metalness = 0.35, side = Mat.DOUBLE}))
			chute = MeshInstance3D.new()
			chute.mesh = ArrayMesh.new()
			chute.extra_cull_margin = 4
			chute_from = Vector3(station_.feed_box[0], station_.feed_box[1], station_.feed_box[2])
			it.group.add_child(chute)
			chute_it = it.group
		update_chute()

	## Bend the feed chute from its box to where the gun's feed tray is now.
	func update_chute() -> void:
		if not chute or not guns.size() or not guns[0].gun or not guns[0].gun.has_meta("feed"):
			return
		var W = load("res://src/weapons.gd")
		var g: Node3D = guns[0].gun
		var gm: Transform3D = W.rel_xf(chute_it, bomber.group).affine_inverse() * W.rel_xf(g, bomber.group) # the gun in the interior's space
		var B: Vector3 = gm * (g.get_meta("feed") as Vector3) # the chute's end, at the feed tray
		var up := (gm.basis * Vector3(0, 1, 0)).normalized() # (into the tray from below)
		var along := (gm.basis * Vector3(0, 0, 1)).normalized() # (the belt's rounds lie along the gun)
		var A := chute_from
		var d := A.distance_to(B)
		var c1 := A + Vector3(0, d * 0.55, 0) # up out of the box
		var c2 := B - up * (d * 0.45) + (gm.basis * Vector3(g.get_meta("feed_side") * 0.5, 0, 0)).normalized() * (d * 0.2)
		var R: int = CHUTE.rings
		var S: int = CHUTE.sides
		var bez := func(t: float) -> Vector3:
			var u := 1 - t
			return A * (u * u * u) + c1 * (3 * u * u * t) + c2 * (3 * u * t * t) + B * (t * t * t)
		var pos := PackedVector3Array()
		var nor := PackedVector3Array()
		pos.resize(R * S)
		nor.resize(R * S)
		for i in R:
			var t := float(i) / (R - 1)
			var P: Vector3 = bez.call(t)
			var T: Vector3
			if t >= 1:
				T = P - bez.call(t - 0.01)
			else:
				T = bez.call(minf(1, t + 0.01)) - P
			T = T.normalized()
			# the chute's flat: its wide side across the belt (the rounds lie along the box, then along the gun)
			var N := Vector3(signf(A.x) if A.x != 0 else 1.0, 0, 0) * -1
			N = N.lerp(along, t * t)
			N = (N - T * N.dot(T)).normalized()
			var Mv := T.cross(N)
			var link := 1.12 if i % 3 == 0 else 1.0 # (its articulated links: a lip every few centimetres)
			for k in S:
				var a := (float(k) / S) * PI * 2
				var c := cos(a)
				var sn := sin(a)
				# a rounded rectangle: 6 cm by 2.5 cm across
				var w := signf(c) * pow(absf(c), 0.35) * 0.06 * link
				var h := signf(sn) * pow(absf(sn), 0.35) * 0.025 * link
				pos[i * S + k] = P + N * w + Mv * h
				nor[i * S + k] = N * c + Mv * sn
		var idx := PackedInt32Array()
		for i in R - 1:
			for k in S:
				var a := i * S + k
				var b := i * S + (k + 1) % S
				idx.append_array([a, b, a + S, b, b + S, a + S]) # (clockwise, Godot's front)
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = pos
		arr[Mesh.ARRAY_NORMAL] = nor
		arr[Mesh.ARRAY_INDEX] = idx
		var am: ArrayMesh = chute.mesh
		am.clear_surfaces()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		am.surface_set_material(0, W.CHUTE_MAT)

	func make_turret(model: Node3D, root: Node3D, names, pivot_pos: Vector3) -> Node3D:
		if not names:
			return null
		var W = load("res://src/weapons.gd")
		var part := Node3D.new()
		model.add_child(part)
		part.transform = Transform3D(Basis.IDENTITY, W.rel_xf(model, root).affine_inverse() * pivot_pos)
		for n in names:
			for o in [Interior.find_node(model, n), Interior.find_node(model, n + "_lining")]:
				if o:
					W.attach_keep(part, o, root)
		return part

	var heat: float:
		get:
			var h := 0.0
			for g in guns:
				h = maxf(h, g.heat)
			return h
	var jammed: bool:
		get:
			for g in guns:
				if not g.jammed:
					return false
			return true
	var reloading: bool:
		get:
			return reload_left > 0

	func reload() -> bool:
		if reloading or ammo == loadout.ammo:
			return false
		reload_left = loadout.reload
		return true

	## Turn the guns towards a direction given in bomber space (smoothly, like a real traverse).
	func aim(dir_local: Vector3, _yaw_rel: float, dt: float, instant := false) -> void:
		var k := 1.0 if instant else 1 - exp(-dt * 16)
		var y := atan2(-dir_local.x, -dir_local.z)
		var pt := asin(clampf(dir_local.y, -1, 1))
		# the short way round, so a turret passing behind you doesn't spin all the way back
		yaw += atan2(sin(y - yaw), cos(y - yaw)) * k
		pitch += (pt - pitch) * k
		if station.get("floor"): # (the top turret's guns never down into the cockpit)
			pitch = maxf(pitch, Interior.turret_floor(station, yaw - station.yaw))
		q_yaw = Quaternion(UP, yaw - yaw0)
		q_pitch = Quaternion(elev_axis, pitch - pitch0)
		aim_q = q_yaw * q_pitch
		pivot.quaternion = aim_q
		if yoke: # (the mount turns in traverse only)
			yoke.quaternion = q_yaw
			update_chute()
		if full_part:
			full_part.quaternion = aim_q
		if yaw_part:
			yaw_part.rotation.y = yaw - yaw0
		if dome:
			dome.rotation.y = yaw

# ---------------------------------------------------------------------------------------------------------

## Runs every gun position of the player's bomber (AI gunners will reuse the same positions later).
var bullets: Bullets
var audio
var positions := {} # station id -> GunPosition
var bomber
var casings: Casings
var effects # (main.gd: the guns' muzzle smoke)
var infinite := false # (the Options' infinite ammunition: the belt never runs out)
var ear: Node3D # (the camera while you're aboard, set by the game: the spent cases heard only then)

func _init(scene: Node, audio_) -> void:
	bullets = Bullets.new(scene)
	audio = audio_

func attach(bomber_) -> void:
	bomber = bomber_
	if not casings and bomber.interior:
		casings = Casings.new(bomber.interior.group, bomber.interior)
	var pivots = Interior.find_node(bomber.model, "LateralGunPivots") # (the waist guns bring their own mounts)
	if pivots:
		pivots.visible = false
	for s in bomber.interior.stations:
		if s.get("guns") != null:
			positions[s.id] = GunPosition.new(bomber, s)

## Fresh ammo and cool barrels: the player has moved to another bomber's guns.
func rearm() -> void:
	for gp in positions.values():
		gp.ammo = gp.loadout.ammo
		gp.reload_left = 0.0
		for g in gp.guns:
			g.heat = 0.0
			g.jammed = false

## The player's current gun position (or null).
func current(player) -> GunPosition:
	return positions.get(player.station.id) if player.station else null

## Runs every gun position of the player's bomber: the player's own, and the AI gunners' (crew).
func update(dt: float, player, camera: Node3D, crew = null, fighters = null) -> void:
	var me := current(player)
	var bm: Transform3D = world_xf(bomber.group)
	for gp: GunPosition in positions.values():
		# cool down, reload, flashes off
		for g in gp.guns:
			g.heat = maxf(0, g.heat - COOL * dt)
			if g.jammed and g.heat < UNJAM:
				g.jammed = false
			g.flash.visible = false
			g.flame.visible = false
			if g.gun: # the recoil: back on its mount with each round, and forward again
				g.kick *= exp(-dt * 28)
				g.gun.position = g.gun_at + gp.rest_dir * (-0.022 * g.kick)
		gp.light.light_energy = 0.0
		if gp.reload_left > 0:
			gp.reload_left -= dt
			if gp.reload_left <= 0:
				gp.reload_left = 0.0
				gp.ammo = gp.loadout.ammo
				audio.reload(false, volume(gp, camera))
		if gp.ammo == 0 and not gp.reloading:
			gp.reload()
			audio.reload(true, volume(gp, camera))
		# an AI gunner works every manned gun the player isn't on
		if gp != me and crew and crew.manned(gp.station.id, player) and not bomber.down and dt > 0:
			var a = crew.aim(gp.station, fighters, dt)
			if a:
				gp.aim(a.dir, a.yaw_rel, dt)
			if a and a.fire:
				fire(gp, a.aim_point, dt, "crew", null, camera)
			else:
				stagger(gp)
			crew.animate_gunner(gp.station.id, gp, a != null and a.fire and gp.ammo > 0 and not gp.reloading)
		elif gp != me and crew:
			crew.animate_gunner(gp.station.id, gp, false) # (idle at his gun: hands on it all the same)
		if gp == me:
			player.grip_targets = gp.grips_world(player.grip_targets) # (your own hands on your gun)
			# at a flexible gun you stand behind it, your eye following it round its mount
			if gp.station.get("eye_behind"):
				var pv: Vector3 = bm.affine_inverse() * world_xf(gp.pivot).origin
				var cp := cos(gp.pitch)
				# ...close behind it (your head at the window, leaning into it), on the gun's own line: that
				# passes through the mount in the window, so the frame never crosses your sight line, however
				# far forward or back you swing it
				var b: float = gp.station.eye_behind
				var e: Vector3 = Vector3(-sin(gp.yaw) * cp, sin(gp.pitch), -cos(gp.yaw) * cp) * -b + pv
				# and over it, square to the gun (so aimed down your head goes out over it, not up into the roof)
				var sp := sin(gp.pitch)
				e += Vector3(sin(gp.yaw) * sp, cp, cos(gp.yaw) * sp) * gp.station.get("eye_up", 0.22)
				# (high over the gun: your hands on its grips sit low in the view), and always inside the hull,
				# which narrows towards the roof
				var it = bomber.interior
				if it:
					var w: float = it.hw(e.z, e.y + 0.05) - 0.07
					if absf(e.x) > w and w > 0.2:
						e.x = signf(e.x) * w
				if it and gp.station.get("socket", false): # (in the nose: your head stays under its roof and inside the glass, however the gun swings)
					e.y = minf(e.y, it.ceiling_at(e.z, 0, -0.5) - 0.14) # (the roof along the middle: out at the side the hull's too narrow to measure from)
					var c = it.nose_cone
					# (inside the cone, and just behind it: inside its base ring there)
					if c and e.z < c.z0 + 0.5:
						var r: float = c.radius.call(e.x, e.y, e.z) - 0.14
						var cy: float = c.cy + 0.16 * pow(maxf(0, (c.z0 - e.z) / c.L), 2)
						var dx := e.x
						var dy := e.y - cy
						var d := sqrt(dx * dx + dy * dy)
						if d > r and r > 0.05:
							e.x = dx * r / d
							e.y = cy + dy * r / d
				player.gun_eye = e
			elif gp.station.get("lean"): # (the tail gunner leans in towards the window as he swings his guns out to the side)
				var cp := cos(gp.pitch)
				var f := Vector3(-sin(gp.yaw) * cp, sin(gp.pitch), -cos(gp.yaw) * cp)
				var k := minf(1, acos(clampf(f.dot(gp.rest_dir), -1, 1)) / 0.55)
				var e: Vector3 = gp.station.eye + f * (gp.station.lean * k)
				# aiming up he ducks his head, so he looks up out through the rear window (not into its roof)
				if gp.station.get("duck"):
					e.y -= maxf(0, sin(gp.pitch)) * gp.station.duck
				player.gun_eye = e
			else:
				player.gun_eye = null

	# (heard only aboard: `ear`, the camera, set by the game while you're in the bomber)
	if casings:
		var ear_at = null
		if ear and bomber:
			ear_at = rel_xf(bomber.interior.group, bomber.group).affine_inverse() * (bm.affine_inverse() * world_xf(ear).origin)
		casings.update(dt, ear_at, audio)
	var gp := me
	if not gp: # R away from a gun doesn't carry over
		player.reload_pressed = false
		player.grip_targets = null
		return
	# aim the model's guns where the player looks
	var s: Dictionary = gp.station
	var yaw: float = s.yaw + player.s_yaw
	var pitch: float = player.s_pitch
	# (in a turret you sit in, the guns are fixed to it: they turn exactly with your view)
	var dir := Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
	gp.aim(dir, player.s_yaw, dt, s.id == "ball" or s.id == "top")

	if player.reload_pressed:
		player.reload_pressed = false
		if gp.reload():
			audio.reload(true)
	if not (player.firing and player.blend > 0.9) or not bomber.turret_works(s.id): # (a knocked-out turret won't fire)
		stagger(gp)
		return
	# rounds converge on the sight line, so the crosshair is where they go (the guns' line, not your
	# head's: free-looking with C, they fire where they point)
	var cam: Transform3D = world_xf(camera)
	var aim_point: Vector3
	if player.head_yaw or player.head_pitch:
		aim_point = (bm.basis * dir).normalized() * CONVERGENCE + cam.origin
	else:
		aim_point = (-cam.basis.z).normalized() * CONVERGENCE + cam.origin
	fire(gp, aim_point, dt, "player", player, camera)

## Keep twin guns staggered for the next burst.
func stagger(gp: GunPosition) -> void:
	for i in gp.guns.size():
		gp.guns[i].timer = maxf(gp.guns[i].timer, (i * 60.0) / RPM / gp.guns.size())

## Loudness of a gun position for the camera (the player's own gun = 1).
func volume(gp: GunPosition, camera: Node3D) -> float:
	var d := world_xf(gp.pivot).origin.distance_to(world_xf(camera).origin)
	return clampf(2.5 / maxf(d, 1), 0.12, 1)

## Would a round from this position to the point (world space) go through our own wing, engines or tail?
func blocked_by_airframe(gp: GunPosition, aim_point: Vector3) -> bool:
	var inv := world_xf(bomber.group).affine_inverse()
	var o := inv * world_xf(gp.pivot).origin
	var d := (inv * aim_point - o).normalized()
	o += d * 1.0
	for b: AABB in AIRFRAME:
		if b.intersects_ray(o, d) != null:
			return true
	return false

## Fire the guns of a position at a point (world space) for one frame.
func fire(gp: GunPosition, aim_point: Vector3, dt: float, owner: String, player = null, camera: Node3D = null) -> void:
	if gp.reloading or gp.ammo <= 0:
		return
	# the crew's guns hold fire when the line goes through their own wing, engines or tail, as the
	# turrets' cut-out cams made them do (you at a gun can still shoot your own plane)
	if owner == "crew" and blocked_by_airframe(gp, aim_point):
		return
	var vol := 1.0 if player else volume(gp, camera)
	var pm := world_xf(gp.pivot)
	var to_bomber := world_xf(bomber.group).affine_inverse()
	var to_it := rel_xf(bomber.interior.group, bomber.group).affine_inverse() if bomber.interior else Transform3D.IDENTITY
	for g in gp.guns:
		g.timer -= dt
		while g.timer <= 0 and gp.ammo > 0 and not g.jammed:
			g.timer += 60.0 / RPM
			var muzzle: Vector3 = pm * (g.muzzle as Vector3)
			var dir := (aim_point - muzzle).normalized()
			dir += Vector3((randf() - 0.5) * SPREAD * 2, (randf() - 0.5) * SPREAD * 2, (randf() - 0.5) * SPREAD * 2)
			bullets.spawn(muzzle, dir.normalized() * MUZZLE_SPEED, gp.rounds % TRACER_EVERY == 0, "allied", owner, false, bomber)
			gp.rounds += 1
			if not infinite: # (the Options' infinite ammunition: the belt never runs out)
				gp.ammo -= 1
			g.heat += HEAT_PER_SHOT
			if g.heat >= 1:
				g.jammed = true
				if player:
					audio.overheat()
			# the flash: the star end-on, the flame from the side, each round a little different; the
			# muzzle's light on everything round it, a puff of smoke, the gun kicking back on its mount
			g.flash.visible = true
			g.flash.scale = Vector3.ONE * (0.28 + randf() * 0.3)
			g.flash.set_instance_shader_parameter("rot", randf() * PI * 2)
			g.flame.visible = randf() < 0.85
			g.flame.quaternion = g.flame_q * Quaternion(Vector3(0, 0, 1), randf() * PI)
			g.flame.scale = Vector3(0.7 + randf() * 0.6, 0.7 + randf() * 0.6, 0.6 + randf() * 0.8)
			gp.light.light_energy = 22 + randf() * 16
			g.kick = 1.0
			if effects and gp.rounds % 2 == 0:
				effects.smoke.emit(muzzle, dir.normalized() * 4, {life = 0.9 + randf() * 0.6, s0 = 0.12, s1 = 0.9, a0 = 0.28, c0 = [0.55, 0.53, 0.5], drag = 2.5})
			if casings: # the M2 throws its spent case and the belt's link out underneath it
				var it = bomber.interior
				var port: Vector3 = to_it * (to_bomber * (pm * (g.port as Vector3)))
				var out: bool = not it or absf(port.x) > it.hw(port.z, port.y) - 0.02 or gp.station.id == "ball"
				if not (g.gun and g.gun.has_meta("bag")): # (with a bag under it the cases go in the bag: only the links fall)
					casings.spawn(port, Vector3((randf() - 0.5) * 0.6, -0.8 - randf() * 0.8, (randf() - 0.5) * 0.6), false, out)
				casings.spawn(port + Vector3(0, -0.02, 0), Vector3((randf() - 0.5) * 0.3, -0.6, (randf() - 0.5) * 0.3), true, out)
			if player or gp.rounds % 3 == 0: # AI guns: fewer sounds, same rhythm
				audio.gunshot(vol)
			if player:
				player.kick(0.6 if gp.guns.size() > 1 else 1.0)
		if g.jammed:
			g.timer = maxf(g.timer, 0)

## HUD info for the player's gun position.
func status(player):
	var gp := current(player)
	if not gp:
		return null
	return {
		ammo = gp.ammo, max = gp.loadout.ammo, heat = minf(1, gp.heat), jammed = gp.jammed,
		reloading = gp.reloading, reload_left = gp.reload_left, reload_time = gp.loadout.reload,
	}
