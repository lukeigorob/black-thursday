extends RefCounted
# Particles: smoke, fire, explosions and impact sparks. Pooled, a few draw calls per kind.
# Everything is left behind in the air, so it streams aft with the wind past the formation.
#
# In the browser each pool moved its particles on the CPU every frame and sent them all to the GPU. Here a
# particle is moved by the GPU: its path through the air has a closed form (the velocity relaxing towards
# the wind at its drag, gravity pulling), so what's sent is only how it was born (where, how fast, when,
# its colours and sizes), once, and the vertex shader works out where it is now, how big, how bright. The
# same numbers give the same motion as the browser's step-by-step one (to within its frame-rate error).
const Bomber := preload("res://src/bomber.gd")
const Parachutes := preload("res://src/parachutes.gd")

const AIRSPEED := Bomber.AIRSPEED

## a puff's texture: a few blobs = lumpy smoke (soft), or a bright core falling off fast (hard)
static func puff_texture(soft: bool) -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	var a := PackedFloat32Array()
	a.resize(64 * 64)
	for i in (9 if soft else 1): # (a few blobs = lumpy smoke)
		var x := 32.0 + ((randf() - 0.5) * 22 if soft else 0.0)
		var y := 32.0 + ((randf() - 0.5) * 22 if soft else 0.0)
		var r := 14 + randf() * 12 if soft else 30.0
		# (a bright core falling off fast: HDR fire on a linear ramp read as a flat hard-edged disc)
		var stops: Array = [[0.0, 0.45], [1.0, 0.0]] if soft else [[0.0, 1.0], [0.35, 0.5], [0.7, 0.13], [1.0, 0.0]]
		for py in 64:
			for px in 64:
				var d := Vector2(px + 0.5 - x, py + 0.5 - y).length() / r
				var s := _stops(stops, d)
				var k := py * 64 + px
				a[k] = s + a[k] * (1.0 - s) # (source-over)
	for py in 64:
		for px in 64:
			img.set_pixel(px, py, Color(1, 1, 1, a[py * 64 + px]))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

static func _stops(stops: Array, d: float) -> float:
	if d >= 1.0:
		return stops[stops.size() - 1][1]
	for i in range(1, stops.size()):
		if d <= stops[i][0]:
			return lerpf(stops[i - 1][1], stops[i][1], (d - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]))
	return 0.0

## A smooth glow with no core or edge: close-up flames, many overlapping into one flame.
static func glow_texture() -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	var stops: Array = []
	for i in 9: # (a gaussian, down to 0 at the rim)
		stops.append([i / 8.0, snappedf(exp(-pow(i / 8.0, 2) * 4.5) - exp(-4.5), 0.001)])
	for py in 64:
		for px in 64:
			img.set_pixel(px, py, Color(1, 1, 1, _stops(stops, Vector2(px + 0.5 - 32, py + 0.5 - 32).length() / 32.0)))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

# The point sprite's shader: where the particle is now, from how it was born. A particle's data, in its
# multimesh slot: the transform's rows (p0, t0), (v0, life), (s0, s1, drag, grav); colour (c0, a0); custom (c1).
const SHADER := """
shader_type spatial;
render_mode unshaded, depth_draw_never, cull_disabled, skip_vertex_transform, %s;
uniform sampler2D map : source_color, filter_linear_mipmap, repeat_disable;
uniform float now;
uniform float airspeed;
varying float v_alpha;
varying vec3 v_tint;
void vertex() {
	vec4 r0 = vec4(MODEL_MATRIX[0][0], MODEL_MATRIX[1][0], MODEL_MATRIX[2][0], MODEL_MATRIX[3][0]);
	vec4 r1 = vec4(MODEL_MATRIX[0][1], MODEL_MATRIX[1][1], MODEL_MATRIX[2][1], MODEL_MATRIX[3][1]);
	vec4 r2 = vec4(MODEL_MATRIX[0][2], MODEL_MATRIX[1][2], MODEL_MATRIX[2][2], MODEL_MATRIX[3][2]);
	float age = now - r0.w, life = r1.w, k = age / max(life, 1e-6);
	if (life <= 0.0 || age < 0.0 || k >= 1.0) {
		VERTEX = vec3(0.0, 0.0, 1e9); // (dead: off behind the eye)
		v_alpha = 0.0;
		v_tint = vec3(0.0);
	} else {
		// velocity relaxes towards the wind (still air streams past at AIRSPEED), gravity pulls down
		float drag = r2.z, grav = r2.w;
		float F = drag > 1e-4 ? (1.0 - exp(-drag * age)) / drag : age;
		vec3 p0 = r0.xyz, v0 = r1.xyz;
		vec3 p;
		p.x = p0.x + v0.x * F;
		p.z = p0.z + airspeed * age + (v0.z - airspeed) * F;
		p.y = drag > 1e-4 ? p0.y + (v0.y + grav / drag) * F - grav * age / drag : p0.y + v0.y * age - 0.5 * grav * age * age;
		float size = r2.x + (r2.y - r2.x) * sqrt(k);
		v_alpha = COLOR.a * (1.0 - k) * min(1.0, age * 12.0);
		v_tint = mix(COLOR.rgb, INSTANCE_CUSTOM.rgb, k);
		vec3 c = (VIEW_MATRIX * vec4(p, 1.0)).xyz;
		float dist = -c.z;
		// a puff right at the eye (your own bomber burning round you, smoke streaming past the turret glass)
		// fades out before it fills the view: a flat sheet of smoke, or a fire sprite blown up to a hard disc
		v_alpha *= smoothstep(0.25 * size, 0.8 * size, dist) * smoothstep(0.3, 1.2, dist);
		VERTEX = c + vec3(VERTEX.xy * size, 0.0);
	}
}
void fragment() {
	vec4 t = texture(map, UV);
	t.a *= 1.0 - smoothstep(0.38, 0.5, length(UV - 0.5)); // (round: a smoke puff's blobs reach the texture's edge, which showed as a square)
	ALBEDO = v_tint * t.rgb;
	ALPHA = t.a * v_alpha;
}
"""

const CHUNK := 1024 # particles a multimesh (only the chunks something was born in are sent again)
const STRIDE := 20 # floats a particle

## One pool of point sprites (smoke or fire).
class ParticlePool:
	var max := 0
	var n := 0
	var now := 0.0
	var mat: ShaderMaterial
	var _buf := PackedFloat32Array()
	var _death := PackedFloat32Array()
	var _dirty := {}
	var _head := 0
	var _dying := {} # (a tenth of a second -> how many die then: to keep count of the living)
	var _done := 0
	var _mms: Array = []
	var nodes: Array = []

	func _init(scene: Node, max_: int, o: Dictionary) -> void:
		var E = load("res://src/effects.gd")
		max = max_
		_buf.resize(max * STRIDE)
		_death.resize(max)
		var sh := Shader.new()
		sh.code = E.SHADER % ("blend_add" if o.get("additive", false) else "blend_mix")
		mat = ShaderMaterial.new()
		mat.shader = sh
		mat.set_shader_parameter("map", E.glow_texture() if o.get("glow", false) else E.puff_texture(o.get("soft", false)))
		mat.set_shader_parameter("airspeed", AIRSPEED)
		var quad := QuadMesh.new()
		quad.size = Vector2(1, 1)
		quad.material = mat
		for c in ceili(float(max) / CHUNK):
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_colors = true
			mm.use_custom_data = true
			mm.mesh = quad
			mm.instance_count = mini(CHUNK, max - c * CHUNK)
			mm.custom_aabb = AABB(Vector3(-1e6, -1e6, -1e6), Vector3(2e6, 2e6, 2e6))
			var mi := MultiMeshInstance3D.new()
			mi.multimesh = mm
			mi.top_level = true
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mi.extra_cull_margin = 16384
			scene.add_child(mi)
			_mms.append(mm)
			nodes.append(mi)
			RenderingServer.multimesh_set_buffer(mm.get_rid(), _buf.slice(c * CHUNK * STRIDE, (c * CHUNK + mm.instance_count) * STRIDE))

	## c0 -> c1 colour over life (linear, may be HDR), alpha fades a0 -> 0, size s0 -> s1.
	func emit(p: Vector3, v: Vector3, o: Dictionary) -> void:
		if n >= max:
			return
		var i := _head
		var tries := 0
		while _death[i] > now: # (the slot's still burning: the next free one)
			i = (i + 1) % max
			tries += 1
			if tries > 64:
				return
		_head = (i + 1) % max
		n += 1
		var life: float = o.life
		_death[i] = now + life
		var b := roundi((now + life) * 10.0)
		_dying[b] = _dying.get(b, 0) + 1
		var c0: Array = o.c0
		var c1: Array = o.get("c1", c0)
		var j := i * STRIDE
		_buf[j] = p.x; _buf[j + 1] = p.y; _buf[j + 2] = p.z; _buf[j + 3] = now
		_buf[j + 4] = v.x; _buf[j + 5] = v.y; _buf[j + 6] = v.z; _buf[j + 7] = life
		_buf[j + 8] = o.s0; _buf[j + 9] = o.s1; _buf[j + 10] = o.get("drag", 0.6); _buf[j + 11] = o.get("grav", 0.0)
		_buf[j + 12] = c0[0]; _buf[j + 13] = c0[1]; _buf[j + 14] = c0[2]; _buf[j + 15] = o.get("a0", 1.0)
		_buf[j + 16] = c1[0]; _buf[j + 17] = c1[1]; _buf[j + 18] = c1[2]; _buf[j + 19] = 0.0
		_dirty[i / CHUNK] = true

	func update(dt: float) -> void:
		now += dt
		# (the ones whose time is up, a tenth of a second at a time)
		var to := roundi(now * 10.0)
		while _done < to:
			_done += 1
			if _dying.has(_done):
				n -= _dying[_done]
				_dying.erase(_done)
		n = maxi(n, 0)
		for c in _dirty:
			var mm: MultiMesh = _mms[c]
			RenderingServer.multimesh_set_buffer(mm.get_rid(), _buf.slice(c * CHUNK * STRIDE, (c * CHUNK + mm.instance_count) * STRIDE))
		_dirty.clear()
		mat.set_shader_parameter("now", now)

static func rnd(a: float, b: float) -> float:
	return a + randf() * (b - a)

## Pieces of aircraft: wing panels, a tailplane, chunks of fuselage. Tumbling, falling, some trailing
## fire, all in one instanced mesh.
class Wreckage:
	var max := 260
	var items: Array = []
	var mesh: MultiMeshInstance3D
	var mm: MultiMesh

	func _init(scene: Node) -> void:
		var Mat = load("res://src/core/mat.gd")
		var box := BoxMesh.new()
		box.material = Mat.standard({color = 0x45483b, roughness = 0.65, metalness = 0.45})
		mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = box
		mm.instance_count = max
		mm.visible_instance_count = 0
		mesh = MultiMeshInstance3D.new()
		mesh.multimesh = mm
		mesh.top_level = true
		mm.custom_aabb = AABB(Vector3(-1e6, -1e6, -1e6), Vector3(2e6, 2e6, 2e6))
		scene.add_child(mesh)

	## size: Vector3 in metres; quat: the orientation it broke off at (or random).
	func add(pos: Vector3, vel: Vector3, size: Vector3, burning := false, quat = null) -> void:
		if items.size() >= max:
			items.pop_front()
		var E = load("res://src/effects.gd")
		items.append({
			pos = pos, vel = vel, size = size, burn_t = E.rnd(3, 7) if burning else 0.0, life = E.rnd(20, 30),
			q = quat if quat != null else Basis.from_euler(Vector3(E.rnd(0, 6), E.rnd(0, 6), E.rnd(0, 6)), EULER_ORDER_XYZ).get_rotation_quaternion(),
			spin = Vector3(E.rnd(-1, 1), E.rnd(-1, 1), E.rnd(-1, 1)) * (E.rnd(1, 4) / maxf(1, size.x * 0.25)),
		})

	func update(dt: float, effects) -> void:
		for i in range(items.size() - 1, -1, -1):
			var w: Dictionary = items[i]
			w.life -= dt
			if w.life <= 0:
				items.remove_at(i)
				continue
			# falls; the air drags it back towards the wind's speed (a flat panel flutters down slowly)
			var d := exp(-dt * 0.35)
			w.vel.x *= d
			w.vel.z = AIRSPEED + (w.vel.z - AIRSPEED) * d
			w.vel.y = maxf(w.vel.y - 9.81 * dt, -60)
			w.pos += w.vel * dt
			w.q = w.q * Basis.from_euler(w.spin * dt, EULER_ORDER_XYZ).get_rotation_quaternion()
			if w.burn_t > 0: # burns for a few seconds
				w.burn_t -= dt
				effects.trail(w.pos, w.vel, "ember", dt)
		var k := mini(items.size(), max)
		for i in k:
			var w: Dictionary = items[i]
			mm.set_instance_transform(i, Transform3D(Basis(w.q).scaled_local(w.size), w.pos))
		mm.visible_instance_count = k

const SMOKE_GREY := [0.32, 0.32, 0.32]
const SMOKE_BLACK := [0.05, 0.05, 0.05]
const SMOKE_WHITE := [0.85, 0.86, 0.88]
const FIRE_HOT := [40.0, 22.0, 6.0]
const FIRE_DIM := [6.0, 1.2, 0.2]

var scene: Node
var ground_vel := Vector3(0, 0, AIRSPEED) # (how the ground moves past: swung round in a turn, main.gd)
var smoke: ParticlePool
var fire: ParticlePool
var flame: ParticlePool
## set each frame (main.gd): far trails use fewer, bigger puffs so burning planes show from km away. A
## Vector3 is a value here, not a shared object as in the browser: main sets it again every frame.
var cam_pos = null
var wreckage: Wreckage
var parachutes
var extra_pools: Array = [] # (other modules' pools, the flak's: sized with these)
var pixel_scale := 600.0

func _init(scene_: Node) -> void:
	scene = scene_
	smoke = ParticlePool.new(scene, 12000, {additive = false, soft = true})
	fire = ParticlePool.new(scene, 6000, {additive = true, soft = false})
	flame = ParticlePool.new(scene, 4000, {additive = true, glow = true}) # (a trail's flames close to the eye: soft, overlapping into one)
	wreckage = Wreckage.new(scene)
	parachutes = Parachutes.Parachutes.new(scene) # everyone who bails out

## An airman bailing out: a few seconds of free fall, then the chute opens and drifts back and down.
func parachute(p: Vector3) -> void:
	parachutes.add(p)

## Point size in world metres -> pixels. The sprites here are quads their size in metres (the same size on
## the screen as the browser's point sprites, at any resolution and field of view), so there's nothing to
## set: kept for main.gd's call.
func set_pixel_scale(height_px: float, fov_deg: float) -> void:
	pixel_scale = height_px / (2 * tan(deg_to_rad(fov_deg) / 2))

## Continuous trail behind a damaged plane: kind = 'smoke' | 'black' | 'fire' | 'glycol' | 'fuel' | 'ember'.
func trail(p: Vector3, v: Vector3, kind: String, dt: float) -> void:
	var dist: float = p.distance_to(cam_pos) if cam_pos != null else 0.0
	if dist > 9000:
		return
	var far := minf(6, maxf(1, dist / 500)) # fewer, bigger puffs far away: same look, less work
	# when the smoke pool fills up (a big battle), trails thin out instead of crowding out hits and explosions
	var load_ := float(smoke.n) / smoke.max
	var thin := maxf(0.1, (1 - load_) / 0.3) if load_ > 0.7 else 1.0
	var c := minf(1, maxf(0, (dist - 15) / 45)) if cam_pos != null else 1.0 # 0 close to the eye .. 1 from 60 m
	var dense := 1 + 2 * (1 - c) if kind == "fire" else 1.0 # (up close, smaller flames and more of them: one flame, not a row of bright discs)
	# spread puffs evenly along the path flown this frame so the trail is continuous;
	# round at random so the rate doesn't depend on the frame rate
	var rate := (160.0 if kind == "fire" else 30.0 if kind == "ember" else 110.0) * dense
	var n := floori((dt * rate * thin) / far + randf())
	# close to the eye (your own engine burning outside the cockpit glass): the flames at their real size
	# and brightness, not blown up to be seen from kilometres off (up close they were a white glare), and
	# the smoke leaves small and is torn straight back by the slipstream instead of hanging by the window
	# in puffs that fill it
	var fs := 0.22 + 0.78 * c
	var fb := 0.18 + 0.82 * c
	var ss0 := 0.25 + 0.75 * c
	var ss1 := 0.55 + 0.45 * c
	var sa := 0.65 + 0.35 * c
	var hot := [FIRE_HOT[0] * fb, FIRE_HOT[1] * fb, FIRE_HOT[2] * fb]
	var dim := [FIRE_DIM[0] * fb, FIRE_DIM[1] * fb, FIRE_DIM[2] * fb]
	var f_hot := [FIRE_HOT[0] * 0.05, FIRE_HOT[1] * 0.05, FIRE_HOT[2] * 0.05]
	var f_dim := [FIRE_DIM[0] * 0.05, FIRE_DIM[1] * 0.05, FIRE_DIM[2] * 0.05]
	for i in n:
		var q := p - v * (((i + randf()) / n) * dt)
		var w := v * 0.3 + Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * 2
		var ws := w
		ws.z += (1 - c) * (AIRSPEED * 0.8 - ws.z) # (smoke up close: already moving with the air, streaming back; the flames cling to her)
		if kind == "ember": # a burning piece of wreckage: flames and a short wisp of smoke
			fire.emit(q, w, {life = 0.4 + randf() * 0.3, s0 = 1.6 * far * fs, s1 = 0.5 * far * fs, c0 = hot, c1 = dim, drag = 2})
			smoke.emit(q, ws, {life = 2.5 + randf() * 1.5, s0 = 1.5 * far * ss0, s1 = 7 * far * ss1, a0 = 0.6 * sa, c0 = SMOKE_BLACK, drag = 1.2})
		elif kind == "fire":
			if randf() > c: # (close: soft and overlapping, each dim: together one flame)
				flame.emit(q, w, {life = 0.25 + randf() * 0.25, s0 = 1.1, s1 = 0.4, c0 = f_hot, c1 = f_dim, drag = 2})
			else:
				fire.emit(q, w, {life = (0.3 + randf() * 0.3) * sqrt(far), s0 = 3.6 * far * fs, s1 = 1.2 * far * fs, c0 = hot, c1 = dim, drag = 2})
			if dense > 1 and randf() * dense > 1:
				continue # (the smoke at its usual rate)
			smoke.emit(q, ws, {life = 7 + randf() * 5, s0 = 4 * far * ss0, s1 = 26 * far * ss1, a0 = 0.85 * sa, c0 = SMOKE_BLACK, drag = 1.2})
		elif kind == "fuel": # fuel streaming from a holed tank: a thin white vapour that hangs a long way back
			smoke.emit(q, ws, {life = 5 + randf() * 3, s0 = 0.9 * far * ss0, s1 = 7 * far * ss1, a0 = 0.35 * sa, c0 = SMOKE_WHITE, drag = 1.5})
		else:
			var col: Array = SMOKE_BLACK if kind == "black" else SMOKE_WHITE if kind == "glycol" else SMOKE_GREY
			smoke.emit(q, ws, {life = 4 + randf() * 2, s0 = 2.5 * far * ss0, s1 = (12.0 if kind == "glycol" else 16.0) * far * ss1, a0 = (0.5 if kind == "glycol" else 0.7) * sa, c0 = col, drag = 1.2})

## Where a round strikes: a flash, sparks, a puff of smoke and bits of skin flying off. The same for
## everyone's rounds; scaled with the distance so it looks the same size on the screen near or far:
## you see your bombers being hit across the formation, and the gunners' hits on the fighters.
func impact(p: Vector3, big := false) -> void:
	var far := minf(20, maxf(1, p.distance_to(cam_pos) / 150)) if cam_pos != null else 1.0
	fire.emit(p, Vector3.ZERO, {life = 0.11 if far > 2 else 0.07, s0 = (1.6 if big else 0.8) * far, s1 = 0.2 * far, c0 = [90, 70, 35], c1 = [20, 8, 2], drag = 1}) # the flash
	for i in (10 if big else 5):
		var v := Vector3(randf() - 0.5, randf() - 0.3, randf() - 0.5) * ((30.0 if big else 18.0) * sqrt(far)) # (the sparks fly as far on the screen too)
		fire.emit(p, v, {life = 0.12 + randf() * 0.15, s0 = (0.5 if big else 0.3) * far, s1 = 0.05, c0 = [60, 40, 15], c1 = [8, 3, 0.5], drag = 3, grav = 9.8})
	for i in (4 if big else 2): # fragments of skin and rivets
		var v := Vector3(randf() - 0.5, randf() * 0.4, randf() - 0.5) * (26.0 if big else 14.0)
		smoke.emit(p, v, {life = 1.2 + randf(), s0 = 0.22 * far, s1 = 0.18 * far, a0 = 0.95, c0 = [0.06, 0.06, 0.05], drag = 0.4, grav = 9.8})
	smoke.emit(p, Vector3.ZERO, {life = 0.8, s0 = 0.4 * far, s1 = 2 * far, a0 = 0.5, c0 = SMOKE_GREY, drag = 1})

## An aircraft breaking up: n pieces of `size` (Vector3, m) flung from `at` with the plane's velocity.
func wreck(at: Vector3, vel: Vector3, n: int, size: Vector3, burning := 0.4, quat = null) -> void:
	for i in n:
		var s := size * rnd(0.5, 1)
		var v := Vector3(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)) * rnd(4, 16) + vel
		wreckage.add(at, v, s, randf() < burning, quat if i == 0 else null)

static func _rand_dir(dy := 0.5) -> Vector3:
	return Vector3(randf() - 0.5, randf() - dy, randf() - 0.5)

## A plane blowing up: fireball, debris sparks and a hanging cloud of black smoke.
func explosion(p: Vector3, v := Vector3.ZERO, scale := 1.0) -> void:
	# far away it's drawn bigger (fewer pixels would hide it), and pieces fly out of it
	if cam_pos != null:
		scale *= minf(3, maxf(1, p.distance_to(cam_pos) / 700))
	wreck(p, v, roundi(3 + scale * 2), Vector3(1.6 * scale, 0.25, 1.1 * scale), 0.5)
	for i in 40:
		var d := _rand_dir().normalized()
		fire.emit(p, d * (6 + randf() * 14) + v * 0.4,
			{life = 0.5 + randf() * 0.6, s0 = (4 + randf() * 5) * scale, s1 = 1.5 * scale, c0 = [60, 32, 10], c1 = [5, 1, 0.2], drag = 2.5})
	for i in 60: # burning debris
		var d := _rand_dir(0.4).normalized()
		fire.emit(p, d * (25 + randf() * 45) + v * 0.6,
			{life = 1 + randf() * 1.5, s0 = 0.5, s1 = 0.2, c0 = [40, 18, 5], c1 = [3, 0.6, 0.1], drag = 0.6, grav = 9.8})
	for i in 30:
		var d := _rand_dir() * (14 * scale)
		smoke.emit(p + d, d * 0.4 + v * 0.3,
			{life = 8 + randf() * 6, s0 = 6 * scale, s1 = 26 * scale, a0 = 0.85, c0 = [0.08, 0.07, 0.06], c1 = [0.2, 0.2, 0.2], drag = 0.8})

## A 500 lb bomb going off on the ground: a flash and a column of dust and smoke.
func ground_burst(p: Vector3) -> void:
	fire.emit(Vector3(p.x, p.y + 10, p.z), Vector3.ZERO, {life = 0.35, s0 = 70, s1 = 30, c0 = [70, 40, 14], c1 = [8, 3, 0.6], drag = 1})
	for i in 3:
		var d := Vector3(randf() - 0.5, randf() * 0.6 + 0.3, randf() - 0.5) * 25
		smoke.emit(p + d, d * 0.8 + ground_vel,
			{life = 28 + randf() * 12, s0 = 40, s1 = 170, a0 = 0.85, c0 = [0.32, 0.28, 0.22], c1 = [0.45, 0.43, 0.4], drag = 0.6})

## Smoke rising from a burning building.
func ground_smoke(p: Vector3) -> void:
	smoke.emit(p, Vector3(randf() - 0.5, 6, randf() - 0.5) + ground_vel,
		{life = 25, s0 = 25, s1 = 120, a0 = 0.75, c0 = [0.08, 0.07, 0.06], c1 = [0.25, 0.24, 0.23], drag = 0.3})
	if randf() < 0.5:
		fire.emit(p, Vector3(0, 3, 0) + ground_vel, {life = 0.6, s0 = 18, s1 = 6, c0 = [30, 12, 3], c1 = [4, 1, 0.2], drag = 1})

## An 88 mm burst: a bright flash and a lingering ball of black smoke.
func flak_burst(p: Vector3) -> void:
	for i in 6:
		var d := _rand_dir() * 5
		fire.emit(p + d, d, {life = 0.12 + randf() * 0.08, s0 = 9, s1 = 3, c0 = [80, 50, 20], c1 = [10, 4, 1], drag = 4})
	for i in 9:
		var d := _rand_dir() * 7
		smoke.emit(p + d, d * 1.5 + Vector3(0, 0, AIRSPEED),
			{life = 14 + randf() * 8, s0 = 7, s1 = 26, a0 = 0.9, c0 = [0.04, 0.04, 0.04], c1 = [0.14, 0.14, 0.14], drag = 3})

func update(dt: float) -> void:
	smoke.update(dt)
	fire.update(dt)
	flame.update(dt)
	wreckage.update(dt, self)
	parachutes.update(dt)
