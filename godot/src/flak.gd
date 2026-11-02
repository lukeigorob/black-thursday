extends RefCounted
# Flak: 88 mm shells bursting at the formation's height, fired in four-gun salvos, thicker the nearer the
# target. Each burst: a white-hot flash, a short fireball, a cloud of thick oily black smoke that swells,
# drifts back past the bombers and slowly fades, and fragments streaking out glowing. Close to you: the
# crack of it, the thump through the airframe, the view jolted, the fragments rattling on the skin like
# gravel, and shrapnel through the part nearest the burst and anyone by it. Bombers near a burst take
# shrapnel; a close one can be fatal. At night the flashes light the bombers round them; in cloud and
# rain they're muffled. All pooled and capped (one draw call per kind, nothing allocated per burst).
# The mission switches it on (`flak.on`) over the flak belt round the target, and sets how heavy (`heavy`).

const Bomber := preload("res://src/bomber.gd")
const Effects := preload("res://src/effects.gd")
const Oob := preload("res://src/oob.gd")

const AIRSPEED := Bomber.AIRSPEED
static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)
const LETHAL := 55.0 # m: shrapnel reaches this far
const CLOSE := 160.0 # m: nearer than this you feel it
const SALVO := 6 # shells a battery fires together
const QUEUE := 200 # bursts waiting to go off
static var BATTERIES: int = 6 if Oob.COMPACT else 3 # batteries firing at once: their salvos overlap (more on the whole compact force)
const FRAGS := 2600 # glowing fragments in the air at once
const DIRECT := 2.5 # m from her skin: a shell bursting this close is as good as a direct hit
const ENGINE_FIRE := 0.3 # chance splinters through an engine set it alight
const FRAG_RANGE := 110.0 # m: fragments still go through a fuselage this far off (weaker the further)
const FRAGS_OUT := 3000 # fragments flung out every way from a burst (those whose path crosses a fuselage go through it)

## The fragments: short glowing streaks flying out of a burst, fading as they cool. One draw call.
class Fragments:
	var max: int
	var n := 0
	var pos := PackedVector3Array()
	var vel := PackedVector3Array()
	var age := PackedFloat32Array()
	var life := PackedFloat32Array()
	var mesh: MeshInstance3D
	var am := ArrayMesh.new()
	# (the colours go above 1, white-hot: the vertex colours carry them scaled down by this, the shader scales them back)
	const HDR := 16.0

	func _init(scene: Node, max_: int) -> void:
		max = max_
		pos.resize(max); vel.resize(max); age.resize(max); life.resize(max)
		var sh := Shader.new()
		sh.code = """shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled;
void fragment() { ALBEDO = COLOR.rgb * 16.0; }
"""
		var m := ShaderMaterial.new()
		m.shader = sh
		mesh = MeshInstance3D.new()
		mesh.mesh = am
		mesh.material_override = m
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
		scene.add_child(mesh)

	func emit(at: Vector3, v: Vector3, l: float) -> void:
		if n >= max:
			return
		pos[n] = at; vel[n] = v; age[n] = 0.0; life[n] = l
		n += 1

	func update(dt: float) -> void:
		var d := exp(-dt * 1.2)
		var line := PackedVector3Array()
		var col := PackedColorArray()
		var i := 0
		while i < n:
			age[i] += dt
			var k := age[i] / life[i]
			if k >= 1:
				kill(i)
				continue
			var v := vel[i]
			v.x *= d; v.y = v.y * d - 9.8 * dt; v.z = AIRSPEED + (v.z - AIRSPEED) * d
			vel[i] = v
			var p := pos[i] + v * dt
			pos[i] = p
			# a streak back along its path (relative to the air: the formation flies through them), cooling as it goes
			var s := 0.025
			var h := (1 - k) * (1 - k) * 14 / HDR
			line.append(p)
			line.append(Vector3(p.x - v.x * s, p.y - v.y * s, p.z - (v.z - AIRSPEED) * s))
			col.append(Color(h, h * 0.45, h * 0.12))
			col.append(Color(h * 0.2, h * 0.06, 0))
			i += 1
		am.clear_surfaces()
		if line.size():
			var arrays := []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = line
			arrays[Mesh.ARRAY_COLOR] = col
			am.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)

	func kill(i: int) -> void:
		n -= 1
		var l := n
		if i == l:
			return
		age[i] = age[l]; life[i] = life[l]; pos[i] = pos[l]; vel[i] = vel[l]

const C_FLASH := [70, 58, 42]
const C_BALL0 := [34, 15, 3.5]
const C_BALL1 := [2.2, 0.5, 0.08]
const C_SMOKE0 := [0.022, 0.019, 0.016]
const C_SMOKE1 := [0.1, 0.095, 0.09]

var effects
var audio
var ui
var bombers: Array
var player_bomber
var on_bomber_hit: Callable
var on_close: Callable
var on_shrapnel: Callable
var on_burst: Callable
var timer := 0.0
var active := false
var on := false
var heavy := 0.5 # 0..1: how thick it is (the mission: heaviest over the target)
var night := 0.0 # 0..1: the flashes light the bombers round them
var muffle := 0.0 # 0..1: in cloud and rain, the flashes are dimmed and blurred
var inside := false
var ear: Node3D = null
var loss_bias = null
var group_bias = null
var flash
var ball
var smoke
var frags: Fragments
var light: OmniLight3D
var light_k := 0.0
var queue: Array = []
var near: Array = []
var near_t := 0.0
var barrage_t := 4.0 # s to the next box barrage
var heard := 0.0 # bursts heard lately (far ones beyond a few a moment aren't each given a sound)

func _init(o: Dictionary) -> void:
	effects = o.effects; audio = o.get("audio"); ui = o.get("ui"); bombers = o.bombers; player_bomber = o.player_bomber
	if o.get("on_bomber_hit"):
		on_bomber_hit = o.on_bomber_hit
	if o.get("on_close"):
		on_close = o.on_close
	if o.get("on_shrapnel"):
		on_shrapnel = o.on_shrapnel
	var scene: Node = effects.scene
	flash = Effects.ParticlePool.new(scene, 160, {additive = true, soft = false})
	ball = Effects.ParticlePool.new(scene, 900, {additive = true, soft = true})
	smoke = Effects.ParticlePool.new(scene, 5000, {additive = false, soft = true})
	effects.extra_pools.append_array([flash, ball, smoke])
	frags = Fragments.new(scene, FRAGS)
	# the light of the nearest flash (at nothing by day: always in the scene, so no shader rebuilds)
	light = OmniLight3D.new()
	light.light_color = Color.hex(0xffb070ff)
	light.omni_range = 900
	light.omni_attenuation = 1.5
	light.light_energy = 0
	light.shadow_enabled = false
	scene.add_child(light)
	for i in QUEUE:
		queue.append({t = -1.0, at = Vector3.ZERO})

func update(dt: float) -> void:
	if on != active:
		active = on
		ui.log("Flak! Flak dead ahead!" if on else "We're through the flak.")
	# the bursts already on their way
	for q in queue:
		if q.t >= 0:
			q.t -= dt
			if q.t < 0:
				burst(q.at)
	flash.update(dt); ball.update(dt); smoke.update(dt); frags.update(dt)
	light_k *= exp(-dt * 12)
	heard = maxf(0, heard - dt * 12)
	# (not inside your bomber: through her skin its light lit up the bomb bay and the tunnel to the tail)
	# (Godot's light units aren't Three's: the flash's 1.2e6 is taken as about 8 here, matched by eye)
	light.light_energy = 0.0 if inside else light_k / 1.2e6 * 8.0 * night * (1 - 0.6 * muffle)
	if not on:
		return
	timer -= dt
	if timer > 0:
		return
	# the batteries below fire at the part of the stream around us, several salvos in the air at once;
	# over the target a wall of it: box barrages put up across the stream's path, which it must fly through
	var h := maxf(0.1, heavy) # (light at the edge of the belt, a wall over the target)
	timer = rand(0.12, 0.45) / h
	barrage_t -= timer
	if barrage_t <= 0 and h > 0.5:
		barrage_t = rand(5, 9) / h
		barrage(h)
	near_t -= 1
	if near_t <= 0: # (who's in range, now and then)
		near_t = 8
		near.clear()
		for b in bombers:
			if not b.down and b.base.distance_to(player_bomber.base) < Oob.FIGHT_RANGE:
				near.append(b)
	for bat in BATTERIES:
		# (a battery on the bomber you're in now and then: the near ones' crack and jolt much more often)
		var aimed = player_bomber if randf() < (0.03 if Oob.COMPACT else 0.06) else (near[randi() % near.size()] if near.size() else null)
		if not aimed or aimed.down:
			continue
		salvo(aimed)

func _free_slot():
	for x in queue:
		if x.t < 0:
			return x
	return null

## One battery's salvo at `aimed`: predicted fire, the error mostly in height and range.
func salvo(aimed) -> void:
	# predicted fire: the error is mostly in height and range; the salvo's shells close round that point
	# (and the barrage put up ahead of the stream: you fly into the smoke of the salvos before yours)
	var c: Vector3 = aimed.group.position + Vector3(rand(-110, 110), rand(-70, 70), rand(-900, -150) if randf() < 0.6 else rand(-140, 140))
	for s in SALVO:
		var q = _free_slot()
		if not q:
			break
		q.t = rand(0, 0.7)
		q.at = c + Vector3(rand(-45, 45), rand(-30, 30), rand(-55, 55))

## A box barrage: a wall of bursts across the stream's path just ahead, at its height, over a second or two.
func barrage(h: float) -> void:
	var at: Vector3 = player_bomber.group.position
	var n := roundi(22 + 26 * h)
	var ahead := rand(250, 700)
	for s in n:
		var q = _free_slot()
		if not q:
			break
		q.t = rand(0, 1.8)
		q.at = at + Vector3(rand(-650, 650), rand(-120, 140), -ahead + rand(-220, 220))

func burst(at: Vector3) -> void:
	if on_burst.is_valid():
		on_burst.call(at) # (the interphone: radio.js)
	var m := muffle
	# the flash, the fireball (both dimmer and softer in cloud), the black smoke swelling and drifting aft
	flash.emit(at, Vector3(0, 0, AIRSPEED), {life = 0.09, s0 = 40, s1 = 70, a0 = 1 - 0.55 * m, c0 = C_FLASH, c1 = C_FLASH, drag = 0, grav = 0})
	for i in 4:
		ball.emit(at + Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), Vector3(rand(-8, 8), rand(-6, 8), AIRSPEED + rand(-8, 8)),
			{life = rand(0.22, 0.45), s0 = rand(4, 7), s1 = rand(11, 16), a0 = 1 - 0.4 * m, c0 = C_BALL0, c1 = C_BALL1, drag = 3, grav = 0})
	for i in 5: # (five puffs, each a little bigger: the same cloud for fewer of them)
		var r := 3.0 if i < 3 else 7.0
		smoke.emit(at + Vector3(rand(-r, r), rand(-r, r), rand(-r, r)), Vector3(rand(-9, 9), rand(-5, 10), AIRSPEED + rand(-9, 9)),
			{life = rand(14, 24), s0 = rand(9, 13), s1 = rand(34, 48), a0 = rand(0.8, 0.95), c0 = C_SMOKE0, c1 = C_SMOKE1, drag = 2.2, grav = 0})
	for i in 26: # the fragments, out in every direction
		var l := Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalized() * rand(110, 240)
		frags.emit(at, Vector3(l.x, l.y, l.z + AIRSPEED), rand(0.35, 0.8))
	if night > 0: # (the last one lights the bombers round it)
		light_k = 1.2e6
		light.position = at
	var d: float = at.distance_to(player_bomber.group.position)
	# heard from where you are (ear: the camera, main.js): in a P-47 far off, the flak's far off too
	var dh: float = at.distance_to(ear.global_position) if ear and ear.is_inside_tree() else d
	if dh < 600 or heard < 3: # (the far ones: a few at a time, or the sound would clip)
		heard += 1
		if audio:
			audio.flak(dh, m)
	if d < CLOSE and dh < CLOSE * 2 and on_close.is_valid():
		on_close.call(1 - d / CLOSE, d) # the thump, the jolt, the rattle (in the bomber)
	for b in bombers:
		if b.down or b.gone:
			continue
		var dist: float = at.distance_to(b.group.position)
		if dist > FRAG_RANGE:
			continue
		var local: Vector3 = b.group.transform.affine_inverse() * at
		# the fragments through her hull: the men inside take them (crew.js shrapnel), even from a burst some way off
		if on_shrapnel.is_valid():
			on_shrapnel.call(b, local, FRAGS_OUT)
		if dist > LETHAL + 20:
			continue
		# shrapnel: the parts nearest the burst take most of it
		var near_parts := []
		for p in Bomber.PARTS:
			var c := Vector3.ZERO
			var dd := INF # (the nearest point of the part to the burst)
			for q in p.boxes:
				var e := Vector3(clampf(local.x, q[0], q[1]), clampf(local.y, q[2], q[3]), clampf(local.z, q[4], q[5]))
				var de := e.distance_to(local)
				if de < dd:
					c = e
					dd = de
			if dd < LETHAL:
				near_parts.append({p = p, c = c, d = dd})
		near_parts.sort_custom(func(x, y): return x.d < y.d)
		var bias: float = 1.0 if b == player_bomber else (loss_bias if loss_bias != null else 1.0) * (group_bias.get(b.squad, 1.0) if group_bias else 1.0) * b.hist_k
		var middle := func(p: Dictionary) -> Vector3: return Vector3((p.box[0] + p.box[1]) / 2, (p.box[2] + p.box[3]) / 2, (p.box[4] + p.box[5]) / 2)
		if near_parts.size() and near_parts[0].d < DIRECT and randf() < (0.3 if b == player_bomber else 0.55 * minf(1.0, bias)): # as good as a direct hit: that part's torn out (a wing tank, an engine: she may go down then and there)
			var p: Dictionary = near_parts[0].p
			var c: Vector3 = near_parts[0].c
			for i in p.hp + 6:
				b.hit(p, true)
			if on_bomber_hit.is_valid():
				on_bomber_hit.call(b, p, c, true, middle.call(p) - c)
		for x in near_parts.slice(0, 4):
			var p: Dictionary = x.p
			var hits := roundi(randf() * (1 - x.d / LETHAL) * (14 if x.d < 10 else 6) * bias)
			for i in hits:
				b.hit(p, x.d < 8)
				if on_bomber_hit.is_valid():
					on_bomber_hit.call(b, p, x.c, x.d < 8, middle.call(p) - x.c) # (the shrapnel flies in from the burst)
			if hits and b == player_bomber and audio:
				audio.impact(x.d < 10)
			# splinters through an engine: often it catches fire (the way flak brought most of them down)
			if hits and p.kind == "engine" and randf() < ENGINE_FIRE * (1.5 if x.d < 10 else 1.0) * (0.6 if b == player_bomber else minf(1.5, bias)):
				b.ignite_engine(p.engine)
