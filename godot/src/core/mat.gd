extends RefCounted
# Three.js materials as Godot ones, taking the same options the web game passes (src/*.js), so a port reads
# `Mat.standard({color = 0x6b6f48, roughness = 0.8})` where the original read
# `new THREE.MeshStandardMaterial({ color: 0x6b6f48, roughness: 0.8 })`.
# Colours: an int 0xRRGGBB (sRGB, as Three takes it), a CSS string, or a Color. Both engines treat these as
# sRGB and light in linear space, and both use 4% reflectance for non-metals, so the same numbers look the same.

const FRONT := 0
const BACK := 1
const DOUBLE := 2

static func color(c) -> Color:
	if c is Color:
		return c
	if c is int:
		return Color.hex((c << 8) | 0xff)
	if c is String:
		return Color.from_string(c, Color.MAGENTA)
	return Color.WHITE

static func _common(m: BaseMaterial3D, o: Dictionary) -> BaseMaterial3D:
	if o.has("color"):
		m.albedo_color = color(o.color)
	if o.has("map") and o.map:
		m.albedo_texture = o.map
	if o.get("vertexColors", false):
		m.vertex_color_use_as_albedo = true
		m.vertex_color_is_srgb = true
	match o.get("side", FRONT):
		BACK:
			m.cull_mode = BaseMaterial3D.CULL_FRONT
		DOUBLE:
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
	var opacity: float = o.get("opacity", 1.0)
	if o.get("transparent", false):
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color.a *= opacity
	if o.get("alphaTest", 0.0) > 0.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = o.alphaTest
	if o.get("alphaHash", false):
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_HASH
	if o.has("depthWrite") and not o.depthWrite:
		m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	if o.has("depthTest") and not o.depthTest:
		m.no_depth_test = true
	if o.has("fog") and not o.fog:
		m.disable_fog = true
	if o.get("blending", "") == "additive":
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	return m

## MeshStandardMaterial (and MeshLambertMaterial: `lambert` is the same with roughness 1).
static func standard(o: Dictionary = {}) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	_common(m, o)
	m.roughness = o.get("roughness", 1.0)
	m.metallic = o.get("metalness", 0.0)
	# (flatShading: Godot has no material switch for it; make the geometry faceted instead,
	# geo.to_non_indexed().compute_vertex_normals(), which shades the same)
	if o.has("normalMap") and o.normalMap:
		m.normal_enabled = true
		m.normal_texture = o.normalMap
		if o.has("normalScale"):
			var ns = o.normalScale
			m.normal_scale = ns.x if ns is Vector2 else float(ns)
	if o.has("roughnessMap") and o.roughnessMap:
		m.roughness_texture = o.roughnessMap
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN # (glTF packs roughness in G)
	if o.has("metalnessMap") and o.metalnessMap:
		m.metallic_texture = o.metalnessMap
		m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
	if o.has("aoMap") and o.aoMap:
		m.ao_enabled = true
		m.ao_texture = o.aoMap
		m.ao_light_affect = o.get("aoMapIntensity", 1.0)
	if o.has("emissive") or o.has("emissiveMap"):
		m.emission_enabled = true
		m.emission = color(o.get("emissive", 0xffffff))
		m.emission_energy_multiplier = o.get("emissiveIntensity", 1.0)
		if o.has("emissiveMap") and o.emissiveMap:
			m.emission_texture = o.emissiveMap
	return m

static func lambert(o: Dictionary = {}) -> StandardMaterial3D:
	var m := standard(o)
	m.roughness = 1.0
	m.metallic = 0.0
	return m

## MeshPhysicalMaterial: standard plus clearcoat; glass (transmission) as see-through alpha with a sharp
## reflection, which is how it looks at the distances the game shows it.
static func physical(o: Dictionary = {}) -> StandardMaterial3D:
	var m := standard(o)
	if o.get("clearcoat", 0.0) > 0.0:
		m.clearcoat_enabled = true
		m.clearcoat = o.clearcoat
		m.clearcoat_roughness = o.get("clearcoatRoughness", 0.0)
	var tr: float = o.get("transmission", 0.0)
	if tr > 0.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color.a = minf(m.albedo_color.a, 1.0 - tr * 0.9)
	return m

## MeshBasicMaterial (unlit).
static func basic(o: Dictionary = {}) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	_common(m, o)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	# (toneMapped: false has no per-material switch here; Godot tone-maps the whole frame)
	return m

## A texture loaded from the game's files: `Mat.tex("textures/paint_color.jpg")` (Three's TextureLoader).
static func tex(path: String) -> Texture2D:
	return load("res://" + path)
