extends RefCounted
# The bomber stream, laid out like an Eighth Air Force formation of 1943-44:
#   element  = a V of three bombers (lead, wingmen stepped down left / up right)
#   squadron = two elements, the second trailing below the first          (6 bombers)
#   group    = lead squadron, high squadron above-right, low squadron below-left   (18, the "combat box")
#   wing     = lead group, high group above-right, low group below-left    (54, the "combat wing")
#   stream   = combat wings following each other a few km apart
# Only the player's bomber uses the full model, its close neighbours a mid-detail one; everything
# else is drawn as instanced low-detail copies (one multimesh for the body, one a prop) to keep the frame rate up.

const Battle := preload("res://src/battle.gd")
const Oob := preload("res://src/oob.gd")
const Self := preload("res://src/formation.gd")

const ELEMENT := [[0, 0, 0], [-29, -5, 18], [29, 5, 18]]
const SQUADRON := [[0, 0, 0, "Lead"], [0, -16, 50, "Lead"]]
const GROUP := [[0, 0, 0, "Lead"], [92, 36, 58, "High"], [-92, -36, 58, "Low"]]
const WING := [[0, 0, 0, "Lead"], [250, 120, 180, "High"], [-250, -120, 180, "Low"]]
# ours, one ahead, one behind, and a wing either side, and one more behind those: up to 6 combat wings
# (324 bombers; BATTLE.bombers cuts the last one short), packed close, the way the bombers flew for mutual
# protection: wings a few hundred metres apart
const STREAM := [[0, 0, 0, ""], [-90, 70, -780, "Leading wing, "], [110, -70, 760, "Trailing wing, "],
	[-720, 160, -260, "Left wing, "], [740, -150, 240, "Right wing, "], [-60, -110, 1520, "Last wing, "]]
const NEAR := 150.0 # m from the player's bomber: closer than this gets the full model

## Every slot of the Schweinfurt force as it flew (oob.js), shifted so the player's bomber sits at the
## origin: you fly left wing on the force's lead ship, the 92nd's (Col. Peaslee, the mission's air commander).
static func _historical_slots() -> Array:
	var slots := []
	for s in Oob.force_slots():
		var lbl: String
		if s.attached_to:
			lbl = "100th BG flight with the %s" % s.attached_to
		else:
			lbl = "%s%s Bomb Group" % [s.group, ("-" + s.part) if s.part else ""]
		lbl += ", %s%s Combat Wing" % ["" if s.squadron == "attached" else "%s squadron, " % s.squadron, s.wing]
		slots.append({pos = Vector3(s.pos[0], s.pos[1], s.pos[2]), group = s.squad, lead = s.lead, unit = s, label = lbl,
			player = s.group == "92nd" and s.squadron == "lead" and s.element == 0 and s.wingman == 1})
	var origin: Vector3 = slots.filter(func(s): return s.player)[0].pos
	for s in slots:
		s.pos -= origin
		s.near = s.pos.length() < NEAR
	return slots

## Every slot in the stream, shifted so the player's bomber sits at the origin.
static func formation_slots() -> Array:
	if Battle.battle_name == "large":
		return _historical_slots() # (the game: Schweinfurt; the smaller battles are for testing)
	var slots := []
	var sq_names := ["Lead", "High", "Low"]
	for wi in mini(STREAM.size(), Battle.BATTLE.wings):
		var w: Array = STREAM[wi]
		for g in WING:
			for s in GROUP:
				for ei in SQUADRON.size():
					var e: Array = SQUADRON[ei]
					for pi in ELEMENT.size():
						var p: Array = ELEMENT[pi]
						slots.append({
							pos = Vector3(w[0] + g[0] + s[0] + e[0] + p[0], w[1] + g[1] + s[1] + e[1] + p[1], w[2] + g[2] + s[2] + e[2] + p[2]),
							label = "%s%s group, %s squadron" % [w[3], g[3], s[3]],
							group = "%d-%s" % [wi, g[3]], # the 18-ship group: it bombs together, on its lead bombardier
							lead = s[3] == "Lead" and ei == 0 and pi == 0,
							player = wi == 0 and g[3] == "Lead" and s[3] == "Lead" and ei == 0 and pi == 1, # left wingman of the lead
							unit = null,
						})
	if Battle.BATTLE.has("bombers"):
		slots.resize(mini(slots.size(), Battle.BATTLE.bombers))
	var origin: Vector3 = slots.filter(func(s): return s.player)[0].pos
	for s in slots:
		s.pos -= origin
		s.near = s.pos.length() < NEAR
	return slots

## A transform into a multimesh buffer at instance i (12 floats: the basis rows and the origin).
static func put(buf: PackedFloat32Array, i: int, t: Transform3D) -> void:
	var o := i * 12
	buf[o] = t.basis.x.x; buf[o + 1] = t.basis.y.x; buf[o + 2] = t.basis.z.x; buf[o + 3] = t.origin.x
	buf[o + 4] = t.basis.x.y; buf[o + 5] = t.basis.y.y; buf[o + 6] = t.basis.z.y; buf[o + 7] = t.origin.y
	buf[o + 8] = t.basis.x.z; buf[o + 9] = t.basis.y.z; buf[o + 10] = t.basis.z.z; buf[o + 11] = t.origin.z

static func _instanced(scene: Node, mesh: Mesh, count: int) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = count
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5)) # (never culled: the bombers move)
	scene.add_child(mi)
	return mi

static func _rel(node: Node, root: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var x := node
	while x and x != root:
		if x is Node3D:
			t = x.transform * t
		x = x.get_parent()
	return t

## Draws many far-away bombers with one multimesh for the low-detail model's body (a surface a material,
## merged: models.gd) and one for each of its props.
class Fleet:
	var bombers: Array
	var parts: Array = []
	var _buf := PackedFloat32Array()
	static var HIDDEN := Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO)

	func _init(scene: Node, lod_model: Node3D, bombers_: Array) -> void:
		bombers = bombers_
		_buf.resize(bombers.size() * 12)
		for o in lod_model.find_children("*", "MeshInstance3D", true, false):
			var prop = null
			var x: Node = o
			while x and x != lod_model:
				if x.name.begins_with("Prop_"):
					prop = [x, int(x.name.substr(5)) - 1]
					break
				x = x.get_parent()
			var mesh: Mesh = o.mesh
			if not prop: # guns, fairings: sub-pixel at range (each surface kept only if it's bigger than that)
				var keep := ArrayMesh.new()
				for s in mesh.get_surface_count():
					var a := mesh.surface_get_arrays(s)
					var box := AABB()
					var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
					if v.size():
						box = AABB(v[0], Vector3.ZERO)
						for p in v:
							box = box.expand(p)
					if box.size.length() / 2 < 0.8:
						continue
					keep.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
					keep.surface_set_material(keep.get_surface_count() - 1, _surface(o, s))
				if not keep.get_surface_count():
					continue
				mesh = keep
			var mi := Self._instanced(scene, mesh, bombers.size())
			# a prop's blades turn with the bomber's engine (b.spin), and give way to the blur disc (PropBlur) up to speed
			if prop:
				var hub := Self._rel(prop[0], lod_model)
				parts.append({mesh = mi, engine = prop[1], hub = hub, in_prop = hub.affine_inverse() * Self._rel(o, lod_model)})
			else:
				parts.append({mesh = mi, local = Self._rel(o, lod_model)})

	static func _surface(o: MeshInstance3D, s: int) -> Material:
		var m := o.get_surface_override_material(s)
		return m if m else o.mesh.surface_get_material(s)

	func update() -> void:
		for part in parts:
			var local = part.get("local")
			# bombers drawn with their own model right now (the player's and its neighbours) are skipped
			for i in bombers.size():
				var b = bombers[i]
				if b.gone or b.model or b.wreck_body:
					Self.put(_buf, i, HIDDEN)
				elif local != null:
					Self.put(_buf, i, b.group.transform * local)
				else:
					var sp: Dictionary = b.spin[part.engine]
					if sp.blur:
						Self.put(_buf, i, HIDDEN)
					else:
						Self.put(_buf, i, b.group.transform * part.hub * Transform3D(Basis(Vector3.BACK, sp.r), Vector3.ZERO) * part.in_prop)
			part.mesh.multimesh.buffer = _buf

## Hands a pool of mid-detail models to the bombers nearest the player's, wherever that is
## (the player can move to another bomber, and stragglers drift out of the box).
class Detail:
	var scene: Node
	var bombers: Array
	var player
	var size: int
	var pool: Array
	var timer := 0.0
	var on_free: Callable

	## models: the mid-detail models to hand out (count = how many neighbours get one).
	func _init(scene_: Node, bombers_: Array, player_, models: Array) -> void:
		scene = scene_
		bombers = bombers_
		player = player_
		size = models.size()
		pool = models.duplicate()

	func assign() -> void:
		var here: Vector3 = player.base
		var keep := bombers.filter(func(b): return b != player and not b.gone)
		keep.sort_custom(func(a, b): return a.base.distance_squared_to(here) < b.base.distance_squared_to(here))
		keep = keep.slice(0, size)
		for b in bombers: # free models from bombers that are no longer close
			if b == player or not b.model or b in keep:
				continue
			if on_free.is_valid():
				on_free.call(b)
			pool.append(b.model)
			b.set_model(null)
			if b.group.get_parent() == scene:
				scene.remove_child(b.group)
		for b in keep:
			if b.model or not pool.size():
				continue
			if not b.group.get_parent():
				scene.add_child(b.group)
			b.set_model(pool.pop_back())
		for b in bombers: # only the bombers right round the player cast shadows
			if not b.model:
				continue
			var casts: bool = b == player or b.base.distance_to(here) < 75
			for o in b.model.find_children("*", "MeshInstance3D", true, false):
				# (not the hull's inner lining: the skin casts the window shapes)
				o.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if casts and not o.get_meta("noShadow", false) else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	func update(dt: float) -> void:
		timer -= dt
		if timer <= 0:
			timer = 2.0
			assign()

const ENGINES := [-7.16, -3.93, 3.94, 7.15] # engine x in the B-17 model
const TRAIL := 260.0 # m: thin, short wisps that start well behind the tail
const TRAIL_START := 70.0
const TRAIL_WIDTH := 3.2

## Four condensation trails behind every bomber (two crossed ribbons each, one draw call).
class Contrails:
	var bombers: Array
	var mesh: MultiMeshInstance3D
	var mat: ShaderMaterial
	var locals: Array
	var glow: MultiMeshInstance3D
	var _buf := PackedFloat32Array()
	var _gbuf := PackedFloat32Array()
	static var HIDDEN := Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO)

	func _init(scene: Node, bombers_: Array) -> void:
		bombers = bombers_
		# two crossed ribbons, z 0..1 along the trail, spreading as it ages; v (and the alpha along the trail:
		# forms a little behind the engine, fades out far back) from 1 at the engine end to 0 at the far end
		var v := PackedVector3Array()
		var uv := PackedVector2Array()
		var idx := PackedInt32Array()
		for rot in [0.0, PI / 2]:
			var b0 := v.size()
			for j in 9:
				var z := j / 8.0
				for x in [-0.5, 0.5]:
					var p := Vector3(x * (0.25 + z * 0.75), 0, z)
					v.append(Vector3(p.x * cos(rot), p.x * sin(rot), p.z))
					uv.append(Vector2(x + 0.5, z))
			for j in 8:
				var a := b0 + j * 2
				idx.append_array([a, a + 1, a + 2, a + 1, a + 3, a + 2])
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = v; arrays[Mesh.ARRAY_TEX_UV] = uv; arrays[Mesh.ARRAY_INDEX] = idx
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var sh := Shader.new()
		# (the alpha along the trail as the web game's gradient texture had it: 0 at the engine end, rising to 0.35
		# at 65% of the way back, 0.59 at 95%, gone at the end; wispy, not a wall)
		sh.code = """shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix;
uniform vec3 color = vec3(1.35, 1.38, 1.45);
uniform float opacity = 0.4;
void fragment() {
	float t = UV.y; // 0 at the engine end
	float a = t < 0.05 ? mix(0.0, 150.0 / 255.0, t / 0.05) : t < 0.35 ? mix(150.0, 90.0, (t - 0.05) / 0.3) / 255.0 : mix(90.0 / 255.0, 0.0, (t - 0.35) / 0.65);
	ALBEDO = color;
	ALPHA = a * opacity;
}
"""
		mat = ShaderMaterial.new()
		mat.shader = sh
		mesh = Self._instanced(scene, am, bombers.size() * ENGINES.size())
		mesh.material_override = mat
		_buf.resize(bombers.size() * ENGINES.size() * 12)
		# at night the turbo-supercharger exhausts under the engines glow: a point for every engine of every bomber
		var q := QuadMesh.new()
		q.size = Vector2(0.75, 0.75)
		var gm := StandardMaterial3D.new()
		gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		gm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		gm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		gm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		gm.albedo_texture = _glow_dot()
		q.material = gm
		glow = Self._instanced(scene, q, bombers.size() * ENGINES.size())
		glow.visible = false
		_gbuf.resize(bombers.size() * ENGINES.size() * 12)
		# trails condense a few dozen metres behind the engines (and so don't fill the tail gunner's view)
		set_env({season = "summer", time = "day"})

	static func _glow_dot() -> Texture2D:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				var r := Vector2(x + 0.5 - 16, y + 0.5 - 16).length() / 16.0
				var c: Color
				if r < 0.3:
					c = Color(1, 1, 1, 1).lerp(Color(1, 200 / 255.0, 140 / 255.0, 0.5), r / 0.3)
				else:
					c = Color(1, 200 / 255.0, 140 / 255.0, 0.5).lerp(Color(1, 120 / 255.0, 40 / 255.0, 0), minf(1.0, (r - 0.3) / 0.7))
				img.set_pixel(x, y, c)
		return ImageTexture.create_from_image(img)

	## The season and the hour: in winter's cold the trails form sooner and thicker; at night they're
	## faint in the moonlight and the exhausts glow.
	func set_env(env: Dictionary) -> void:
		var winter: bool = env.get("season") == "winter"
		var night: bool = env.get("time") == "night"
		var dusk: bool = env.get("time") == "twilight"
		var start := 28.0 if winter else TRAIL_START
		var length := TRAIL * 1.6 if winter else TRAIL
		locals = ENGINES.map(func(x): return Transform3D(Basis.from_scale(Vector3(TRAIL_WIDTH * (1.3 if winter else 1.0), TRAIL_WIDTH, length)), Vector3(x, -0.6, start)))
		mat.set_shader_parameter("opacity", (0.58 if winter else 0.4) * (0.4 if night else 1.0))
		mat.set_shader_parameter("color", Vector3(1.35, 1.38, 1.45) * (0.12 if night else 0.6 if dusk else 1.0))
		glow.visible = night or dusk
		var gm: StandardMaterial3D = glow.multimesh.mesh.material
		var k := 0.4 if night else 0.18 # (a dull glow under the nacelles, not a blaze: kept under the bloom's threshold)
		gm.albedo_color = Color(1 * k, 0.55 * k, 0.25 * k)

	func update() -> void:
		var k := 0
		var gv := glow.visible
		for b in bombers:
			var m: Transform3D = b.group.transform
			for i in b.engines.size(): # a dead engine makes no contrail; a falling bomber neither
				var e: Dictionary = b.engines[i]
				var off: bool = b.down or e.state == "dead" or e.state == "fire"
				Self.put(_buf, k, HIDDEN if off else m * locals[i])
				if gv: # the exhaust under the nacelle, behind the wing
					Self.put(_gbuf, k, HIDDEN if off else Transform3D(Basis.IDENTITY, m * Vector3(ENGINES[i], -0.95, -5.0)))
				k += 1
		mesh.multimesh.buffer = _buf
		if gv:
			glow.multimesh.buffer = _gbuf
