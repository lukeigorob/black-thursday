extends RefCounted
# Loads each aircraft GLB once and hands out copies (meshes and materials are shared).
# If a file fails to load, a simple placeholder plane is used so the game never shows a blank screen.
# (Godot loads synchronously: load_model returns { scene, ok } at once, where the web game's was a promise.)

const Mat := preload("res://src/core/mat.gd")
const SKIN := preload("res://src/bomber_skin.gdshader")

# real-world sizes in metres (the conversion script already scales the GLBs to these)
const MODELS := {
	b17 = {url = "models/b17.glb", label = "B-17 Flying Fortress", length = 22.7, span = 32.6, color = 0x6b6f48},
	bf109 = {url = "models/bf109.glb", label = "Bf 109 F-2", length = 8.94, span = 10.4, color = 0x7a8288},
	p47 = {build = "res://src/p47.gd:build_p47", label = "P-47 Thunderbolt", length = 11.0, span = 12.4, color = 0x5d5f3e},
	fw190 = {build = "res://src/fw190.gd:build_fw190", label = "Fw 190 A-8", length = 9.0, span = 10.5, color = 0x5a5a68}, # (built in code: fw190.js)
}

# big meshes that mix skin with windows. Their opacity maps mark glass at ~82% opacity, which reads as
# a solid speckled panel, so anything under 95% becomes an open cut-out (also in the shadow pass,
# so sunlight falls through the windows into the cabin).
const WINDOWED := ["MainHull", "Tail_TBTurrets"]

# (The web game scaled the GLBs' textures down to 1024 below High quality as they loaded: 2048 maps four
# times over filled a browser tab's memory. Godot keeps them in video memory as imported, with no tab's
# limit to run into, so they're kept at full size at every quality. shrink_textures is kept, doing nothing,
# for anything that calls it.)
static func shrink_textures(_root: Node) -> void:
	pass

# ---- the B-17's skin (bomber_skin.gdshader): the glTF material plus the web game's shader additions ----
static var _shaders := {} # defines -> Shader
static var _skins := {} # source material + defines -> ShaderMaterial

static func _skin_shader(defines: Array) -> Shader:
	var key := ",".join(defines)
	if not _shaders.has(key):
		var sh := Shader.new()
		var lines := ""
		for d in defines:
			lines += "#define %s\n" % d
		sh.code = SKIN.code.replace("//DEFINES", lines)
		_shaders[key] = sh
	return _shaders[key]

## A material as the B-17 skin with these features (WINDOWS, BALL, SCARS, CUT) added to what it has. From a
## StandardMaterial3D (the GLB's) or a skin already made; the same source and features give the same material,
## unless `fresh` (a copy of its own: breakup.gd's cuts, each with its own boxes). `drop`: features taken away
## (CULL_BACK, for a cut: through the torn end you see the inside of the skin).
static func skin(src: Material, add: Array, fresh := false, drop: Array = []) -> ShaderMaterial:
	var defines: Array = []
	if src is ShaderMaterial and src.has_meta("skin_defines"):
		defines = src.get_meta("skin_defines").duplicate()
	if src is BaseMaterial3D and src.cull_mode == BaseMaterial3D.CULL_BACK and not "CULL_BACK" in defines:
		defines.append("CULL_BACK")
	for d in add:
		if not d in defines:
			defines.append(d)
	for d in drop:
		defines.erase(d)
	defines.sort()
	var key := "%d|%s" % [src.get_instance_id(), ",".join(defines)]
	if not fresh and _skins.has(key):
		return _skins[key]
	var m := ShaderMaterial.new()
	m.shader = _skin_shader(defines)
	m.resource_name = src.resource_name
	m.set_meta("skin_defines", defines)
	m.set_meta("skin_from", src.get_meta("skin_from", src) if src is ShaderMaterial else src)
	if src is ShaderMaterial:
		for u in src.shader.get_shader_uniform_list():
			m.set_shader_parameter(u.name, src.get_shader_parameter(u.name))
		for k in ["glass", "noShadow"]:
			if src.has_meta(k):
				m.set_meta(k, src.get_meta(k))
	elif src is BaseMaterial3D:
		var s: BaseMaterial3D = src
		m.set_shader_parameter("albedo", s.albedo_color)
		m.set_shader_parameter("has_albedo", s.albedo_texture != null)
		if s.albedo_texture:
			m.set_shader_parameter("tex_albedo", s.albedo_texture)
		m.set_shader_parameter("metallic", s.metallic)
		m.set_shader_parameter("roughness", s.roughness)
		const CH := [Vector4(1, 0, 0, 0), Vector4(0, 1, 0, 0), Vector4(0, 0, 1, 0), Vector4(0, 0, 0, 1), Vector4(0.333333, 0.333333, 0.333333, 0)]
		if s.metallic_texture:
			m.set_shader_parameter("tex_metallic", s.metallic_texture)
		m.set_shader_parameter("metallic_channel", CH[s.metallic_texture_channel] if s.metallic_texture else Vector4(1, 0, 0, 0))
		if s.roughness_texture:
			m.set_shader_parameter("tex_roughness", s.roughness_texture)
		m.set_shader_parameter("roughness_channel", CH[s.roughness_texture_channel] if s.roughness_texture else Vector4(1, 0, 0, 0))
		m.set_shader_parameter("has_normal", s.normal_enabled and s.normal_texture != null)
		if s.normal_enabled and s.normal_texture:
			m.set_shader_parameter("tex_normal", s.normal_texture)
			m.set_shader_parameter("normal_scale", s.normal_scale)
		if s.emission_enabled:
			m.set_shader_parameter("emission_color", s.emission)
			m.set_shader_parameter("emission_energy", s.emission_energy_multiplier)
	if not fresh:
		_skins[key] = m
	return m

## Turn a material's base-colour alpha into a hard window cut-out (the shadow pass too: Godot draws the
## shadow with the same shader, so there's no separate depth material to keep).
static func window_cutout(material: Material) -> ShaderMaterial:
	return skin(material, ["WINDOWS"])

## The ball turret's shell (and the support it hangs from), as in the photos of the Sperry ball: bare,
## slightly worn aluminium framing round big glass panes. The model's texture is pale blue-white (drawn
## as glass all over), so its alpha says which is which, and only its light and dark detail (panel
## lines, rivets) is kept on the metal. The panes are real glass: dark, glossy, and a little
## see-through, so you get a hint of the guns and frames inside.
static func _steel_ball(material: Material) -> ShaderMaterial:
	var m := skin(material, ["BALL"])
	m.set_shader_parameter("albedo", Mat.color(0x9a9e9c)) # bare aluminium, weathered: dull, not chrome
	m.set_shader_parameter("metallic", 0.6)
	m.set_shader_parameter("roughness", 0.5)
	return m

# parts whose "glass" is painted solid in the source model: swapped for real glass
const GLASS_PARTS := ["Nose"]
static var _glass: ShaderMaterial = null
## The Plexiglas nose reads as glass from outside: the sky's reflection grows towards its curving edges.
static func glass() -> ShaderMaterial:
	if _glass:
		return _glass
	var sh := Shader.new()
	sh.code = """shader_type spatial;
render_mode cull_disabled, depth_draw_never, blend_mix;
uniform vec4 color : source_color = vec4(0.623, 0.706, 0.749, 0.14);
void fragment() {
	ALBEDO = color.rgb;
	ROUGHNESS = 0.04;
	METALLIC = 0.0;
	CLEARCOAT = 1.0;
	CLEARCOAT_ROUGHNESS = 0.05;
	SPECULAR = 0.9; // (envMapIntensity 1.8: the sky's reflection strong in it)
	float facing = abs(dot(normalize(NORMAL), normalize(VIEW)));
	ALPHA = clamp(color.a + pow(1.0 - facing, 2.5) * 0.55, 0.0, 0.7);
}
"""
	_glass = ShaderMaterial.new()
	_glass.shader = sh
	_glass.set_meta("glass", true)
	return _glass

static var _cache := {}

# the B-17G's chin turret: our B-17s have the F's nose (its guns are hand-held, out through the glass);
# and the spinner-like knob under the nose, which looked from the ball turret like a propeller hub
const REMOVED := ["FrontGunCapsule", "LowerFrontGuns", "NavigationKnob"]

# The ball and top turrets' guns: the model's barrels stand too far out of the turrets, so each is
# shortened along its own length to BARREL_K of it, from its inner end (the end in the turret): the
# same barrel, as thick, only less of it out in the air. (Your own turret's Brownings are built to these
# shortened barrels too: weapons.js measures them; the top turret's from its station, interior.js.)
# (Godot names the glTF's "GunBarrel.004" GunBarrel_004, where Three made it GunBarrel004.)
const SHORT_BARRELS := {BallTurret = ["GunBarrel_004", "GunBarrel14"], TopGuns = ["GunBarrel", "GunBarrel15"]}
const BARREL_K := 0.7

## A node's transform in `root`'s frame (Three's matrixWorld with the root at the origin).
static func rel(node: Node, root: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var x := node
	while x and x != root:
		if x is Node3D:
			t = x.transform * t
		x = x.get_parent()
	return t

## Three's Raycaster against these meshes, in `root`'s frame: the nearest hit within `far` as
## { point, normal (the face's), object, distance }, or {} for none. (Each mesh's triangles are kept by Godot
## once worked out, so a second ray at the same mesh costs only the ray.)
static func raycast(meshes: Array, root: Node, from: Vector3, dir: Vector3, far: float) -> Dictionary:
	var best := {}
	for o: MeshInstance3D in meshes:
		if not o.mesh:
			continue
		var t := rel(o, root)
		var inv := t.affine_inverse()
		var a := inv * from
		var b := inv * (from + dir * far)
		var tm: TriangleMesh = o.mesh.generate_triangle_mesh()
		if not tm:
			continue
		var hit := tm.intersect_segment(a, b)
		if hit.is_empty():
			continue
		var p: Vector3 = t * hit.position
		var d := p.distance_to(from)
		if best.is_empty() or d < best.distance:
			best = {point = p, normal = (t.basis.inverse().transposed() * hit.normal).normalized(), object = o, distance = d}
	return best

static func find(root: Node, name: String) -> Node:
	if root.name == name:
		return root
	return root.find_child(name, true, false)

static func _shorten_barrels(root: Node) -> void:
	var centre_of := {BallTurret = find(root, "BallTurret"), TopGuns = find(root, "TopTurret")}
	for key in SHORT_BARRELS:
		var turret: Node = centre_of[key]
		if not turret:
			continue
		var scope: Node = (find(root, "TopGuns") if find(root, "TopGuns") else root) if key == "TopGuns" else root
		for n in SHORT_BARRELS[key]:
			var o = find(scope, n)
			if not (o is MeshInstance3D):
				continue
			var src: Mesh = o.mesh
			var out := ArrayMesh.new()
			# its length: the principal axis of its vertices (a few rounds of power iteration on their spread)
			var all := PackedVector3Array()
			for s in src.get_surface_count():
				all.append_array(src.surface_get_arrays(s)[Mesh.ARRAY_VERTEX])
			var c := Vector3.ZERO
			for p in all:
				c += p
			c /= all.size()
			var axis := Vector3(0.3, 0.6, 0.7).normalized()
			for it in 12:
				var next := Vector3.ZERO
				for p in all:
					next += (p - c) * (p - c).dot(axis)
				axis = next.normalized()
			# which end is in the turret: the one nearer its centre
			var inside: Vector3 = rel(o, root).affine_inverse() * rel(turret, root).origin
			var lo := INF
			var hi := -INF
			for p in all:
				var d := (p - c).dot(axis)
				lo = minf(lo, d)
				hi = maxf(hi, d)
			var from := lo if (inside - c).dot(axis) < (lo + hi) / 2.0 else hi
			for s in src.get_surface_count():
				var arrays := src.surface_get_arrays(s)
				var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
				for i in v.size():
					var d := (v[i] - c).dot(axis)
					v[i] += axis * ((from + (d - from) * BARREL_K) - d)
				arrays[Mesh.ARRAY_VERTEX] = v
				out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
				out.surface_set_material(s, src.surface_get_material(s))
			o.mesh = out

## The material a mesh instance draws surface i with.
static func surface_material(o: MeshInstance3D, i: int) -> Material:
	var m := o.get_surface_override_material(i)
	return m if m else o.mesh.surface_get_material(i)

static func _prepare(root: Node) -> Node:
	for n in REMOVED:
		var o := find(root, n)
		if o:
			o.get_parent().remove_child(o)
			o.free()
	for o in root.find_children("*", "MeshInstance3D", true, false):
		o.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for i in o.mesh.get_surface_count():
			var m := surface_material(o, i)
			if not m:
				continue
			if o.name in GLASS_PARTS:
				o.set_surface_override_material(i, glass())
				o.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			elif m.resource_name == "BallTurret_WSupport":
				o.set_surface_override_material(i, _steel_ball(m))
			elif m.resource_name in WINDOWED:
				o.set_surface_override_material(i, window_cutout(m))
	return root

## Merge every mesh of a model into one mesh per material (a B-17 has ~90 parts = ~90 draw calls,
## this makes it ~10: here one mesh of a surface per material). Nodes matching `keep` (e.g. propeller hubs
## that spin) stay separate; with `turrets`, the turrets are merged on their own, as nodes of those names.
# the wingmen close by keep their turrets apart from the rest (each merged on its own), so they can
# turn as their gunners aim (bomber.js)
const MID_TURRETS := {BallTurret = ["BallTurret", "GunBarrel_004", "GunBarrel14"], BallStabilizer1 = ["BallStabilizer1"], TopTurret = ["TopTurret", "TopGuns"]}

## One MeshInstance3D (a surface per material) from these meshes, in `root`'s frame, or `base`'s: the
## transform `base` applies to them after it.
static func _merge_meshes(meshes: Array, root: Node, base := Transform3D.IDENTITY) -> MeshInstance3D:
	var by_mat := {} # material -> [arrays...]
	var order := []
	for o: MeshInstance3D in meshes:
		var t := base * rel(o, root)
		var nb := t.basis.inverse().transposed()
		var identity_basis := t.basis.is_equal_approx(Basis.IDENTITY)
		for s in o.mesh.get_surface_count():
			var a := o.mesh.surface_get_arrays(s)
			var mat := surface_material(o, s)
			var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
			var n = a[Mesh.ARRAY_NORMAL]
			var tg = a[Mesh.ARRAY_TANGENT]
			var idx = a[Mesh.ARRAY_INDEX]
			if idx == null:
				idx = PackedInt32Array(range(v.size()))
			var uv = a[Mesh.ARRAY_TEX_UV]
			if uv == null:
				uv = PackedVector2Array(); uv.resize(v.size())
			v = t * v
			if n == null:
				n = PackedVector3Array(); n.resize(v.size()) # (filled in below: zero normals would light as NaN)
			elif not identity_basis:
				n = Transform3D(nb, Vector3.ZERO) * n
				for i in n.size():
					n[i] = n[i].normalized()
			if tg == null:
				tg = PackedFloat32Array(); tg.resize(v.size() * 4)
				for i in v.size():
					tg[i * 4] = 1.0; tg[i * 4 + 3] = 1.0
			elif not identity_basis:
				tg = tg.duplicate()
				for i in v.size():
					var tv := (t.basis * Vector3(tg[i * 4], tg[i * 4 + 1], tg[i * 4 + 2])).normalized()
					tg[i * 4] = tv.x; tg[i * 4 + 1] = tv.y; tg[i * 4 + 2] = tv.z
			if not by_mat.has(mat):
				by_mat[mat] = []
				order.append(mat)
			by_mat[mat].append([v, n, tg, uv, idx, a[Mesh.ARRAY_NORMAL] == null])
	var out := ArrayMesh.new()
	for mat in order:
		var V := PackedVector3Array(); var N := PackedVector3Array(); var T := PackedFloat32Array(); var U := PackedVector2Array(); var I := PackedInt32Array()
		var need_normals := false
		for p in by_mat[mat]:
			var off := V.size()
			V.append_array(p[0]); N.append_array(p[1]); T.append_array(p[2]); U.append_array(p[3])
			var idx: PackedInt32Array = p[4]
			if off:
				idx = idx.duplicate()
				for i in idx.size():
					idx[i] += off
			I.append_array(idx)
			need_normals = need_normals or p[5]
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = V; arrays[Mesh.ARRAY_NORMAL] = N; arrays[Mesh.ARRAY_TANGENT] = T; arrays[Mesh.ARRAY_TEX_UV] = U; arrays[Mesh.ARRAY_INDEX] = I
		if need_normals:
			var st := SurfaceTool.new()
			st.create_from_arrays(arrays)
			st.generate_normals()
			arrays = st.commit_to_arrays()
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		out.surface_set_material(out.get_surface_count() - 1, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = out
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return mi

static func _is_under(o: Node, p: Node) -> bool:
	var x := o
	while x:
		if x == p:
			return true
		x = x.get_parent()
	return false

static func _merge_by_material(root: Node, keep: RegEx, turrets = null) -> Node3D:
	var kept := []
	var parts := {}
	for o in root.find_children("*", "Node3D", true, false):
		if keep and keep.search(o.name) and not kept.any(func(k): return _is_under(o, k)):
			kept.append(o)
	var turret_of := func(o: Node):
		for k in (turrets if turrets else {}):
			var x := o
			while x:
				if x.name in turrets[k]:
					return k
				x = x.get_parent()
		return null
	var rest := []
	for o in root.find_children("*", "MeshInstance3D", true, false):
		if kept.any(func(k): return _is_under(o, k)):
			continue
		var t = turret_of.call(o)
		if t:
			if not parts.has(t):
				parts[t] = []
			parts[t].append(o)
		else:
			rest.append(o)
	var out := Node3D.new()
	out.name = root.name
	var body := _merge_meshes(rest, root)
	body.name = "Body"
	out.add_child(body)
	for k in parts:
		var meshes: Array = parts[k]
		var grp := Node3D.new()
		grp.name = k
		grp.add_child(_merge_meshes(meshes, root))
		var guns := AABB() # (which way its guns point at rest: from their middle)
		var has_guns := false
		for o: MeshInstance3D in meshes:
			if "Gun" in o.name or "Gun" in str(o.get_parent().name):
				var box := rel(o, root) * o.get_aabb()
				guns = box if not has_guns else guns.merge(box)
				has_guns = true
		if has_guns:
			grp.set_meta("guns", guns.get_center())
		out.add_child(grp)
	for k: Node3D in kept: # (placed where they were in the model, as the merged parts are; its own parts merged too: a propeller's blades and hub are one draw)
		var meshes := k.find_children("*", "MeshInstance3D", true, false)
		var kt := rel(k, root)
		var c := Node3D.new()
		c.add_child(_merge_meshes(meshes, root, kt.affine_inverse()))
		c.name = k.name
		c.transform = kt
		out.add_child(c)
	return out

static func _placeholder(name: String) -> Node3D:
	var info: Dictionary = MODELS[name]
	var length: float = info.length
	var span: float = info.span
	var g := Node3D.new()
	var mat := Mat.standard({color = info.color, roughness = 0.6, metalness = 0.3})
	var add := func(w, h, d, x, y, z):
		var m := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(w, h, d)
		b.material = mat
		m.mesh = b
		m.position = Vector3(x, y, z)
		g.add_child(m)
	var r := length * 0.06
	add.call(r * 2, r * 2, length, 0, 0, 0)
	add.call(span, r * 0.4, length * 0.18, 0, 0, -length * 0.08)
	add.call(span * 0.35, r * 0.3, length * 0.1, 0, r * 0.5, length * 0.44)
	add.call(r * 0.3, r * 3, length * 0.12, 0, r * 1.8, length * 0.43)
	g.name = "%s_placeholder" % name
	return g

## { scene, ok }: `scene` is a fresh copy, or a placeholder when loading failed.
## lod: the low-detail version (decimated, small textures) for planes far away;
## mid: the in-between version for nearby wingmen (B-17 only).
static func load_model(name: String, opts := {}) -> Dictionary:
	var lod: bool = opts.get("lod", false)
	var mid: bool = opts.get("mid", false)
	var suffix := "_lod" if lod else "_mid" if mid else ""
	var key := name + suffix
	var info: Dictionary = MODELS[name]
	if info.has("build") and not _cache.has(key):
		var parts: PackedStringArray = info.build.split(":")
		var builder = load(parts[0])
		_cache[key] = {scene = builder.call(parts[1], {lod = lod}) if builder else _placeholder(name), ok = builder != null}
	if not _cache.has(key):
		var url: String = "res://" + info.url.replace(".glb", suffix + ".glb")
		var packed = load(url) if ResourceLoader.exists(url) else null
		if packed is PackedScene:
			var scene: Node = packed.instantiate()
			if name == "b17":
				_shorten_barrels(scene)
			_prepare(scene)
			# lower-detail versions are only looked at, never taken apart: merge them for speed
			if suffix:
				var merged := _merge_by_material(scene, RegEx.create_from_string("^Prop_\\d$"), MID_TURRETS if mid else null)
				scene.free()
				scene = merged
			_cache[key] = {scene = scene, ok = true}
		else:
			push_warning("Could not load %s, using a placeholder." % url)
			_cache[key] = {scene = _placeholder(name), ok = false}
	var c: Dictionary = _cache[key]
	return {scene = c.scene.duplicate(), ok = c.ok}
