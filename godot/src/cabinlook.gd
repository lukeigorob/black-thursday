extends RefCounted
# How the inside of the bomber is painted and lit: the hull lining in worn interior-green paint with
# its rivet rows, frame seams and skin-panel seams (raised and sunk in the shader, so they catch the
# light), the walkway's wooden planks, and the cabin kept dark: indirect light (sky, haze) cut right
# down inside, so it's the sun through the windows and gun ports that lights it, as in the photos.
# The textures are ambientCG's (CC0, see CREDITS.md), mapped by position (the model's own UVs are
# laid out for its outside paint).
#
# (Godot: the web game chains GLSL into Three's own shaders (onBeforeCompile). Godot doesn't hand out a
# StandardMaterial3D's generated shader, so the cabin's materials are its own shaders here: `std()` makes
# the cabin's standard material (colour, roughness, metalness, a texture, a normal map, emission) as a
# ShaderMaterial, and planks / leather / prop_wear / inside_light switch its features on. A plain
# StandardMaterial3D from elsewhere (the cockpit's) is converted by prop_wear, and inside_light darkens one
# with a constant AO texture, which in Godot scales exactly the indirect light.)

const Mat := preload("res://src/core/mat.gd")

## The quality setting's switch for the extra surface detail (worn edges, grime, oil streaks): set_detail().
static var DETAIL := 1.0
static var _detail_mats: Array = [] # (weak refs to every material with a detail switch)

const INSIDE_AMBIENT := 0.3 # how much of the sky's indirect light reaches inside

static var _tex := {}
static func tex(name: String) -> Texture2D:
	if not _tex.has(name):
		_tex[name] = Mat.tex("textures/%s.jpg" % name)
	return _tex[name]

static func set_detail(on: bool) -> void:
	DETAIL = 1.0 if on else 0.0
	var keep := []
	for w in _detail_mats:
		var m = w.get_ref()
		if m:
			m.set_shader_parameter("detail_on", DETAIL)
			keep.append(w)
	_detail_mats = keep

static func _track_detail(m: ShaderMaterial) -> void:
	m.set_shader_parameter("detail_on", DETAIL)
	_detail_mats.append(weakref(m))

# ---------------------------------------------------------------- GLSL shared by the cabin's shaders

## Value noise (the web game's h3/n3, wh1/wn3, bh/bn: the same function under each file's names).
const NOISE := """
float h3(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
			   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
"""

## A bump (height) of rivet rows and seams on the hull at bomber-space position p.
const HULL_RELIEF := """
// the fuselage's middle line: in the cockpit it's higher (its roof is), so the rows run round that
float hullMid(float z) { return mix(mix(-0.9, 0.25, smoothstep(-6.2, -6.6, z)), -0.1, smoothstep(-8.6, -8.9, z)); }
float deckK(float z) { return smoothstep(-6.2, -6.6, z) * smoothstep(-8.9, -8.6, z); } // (the flight deck only)
float hullRelief(vec3 p) {
	// around the fuselage: an angle from its middle line (so rows run round the roof too)
	float s = atan(p.x, p.y - hullMid(p.z));
	// the frames every 50 cm, two rivet rows either side of each
	float fz = abs(fract(p.z * 2.0 + 0.5) - 0.5) / 2.0;      // metres to the nearest frame
	float rows = smoothstep(0.012, 0.0, abs(fz - 0.028));
	vec2 rv = vec2(fract(s / 0.045) - 0.5, 0.0);
	float rivet = rows * smoothstep(0.32, 0.12, abs(rv.x));
	// the skin panels' seams, lengthwise every 0.3 rad and across every metre, riveted too
	float seamS = abs(fract(s / 0.3) - 0.5) * 0.3;
	float seamZ = abs(fract(p.z + 0.25) - 0.5);
	float seam = smoothstep(0.004, 0.0, seamS) + smoothstep(0.003, 0.0, seamZ);
	float rivet2 = smoothstep(0.012, 0.004, seamS) * smoothstep(0.32, 0.12, abs(fract(p.z / 0.04) - 0.5));
	return (rivet + rivet2) * 0.7 - seam * 0.5;
}
vec3 bumpFrom(vec3 surfPos, vec3 n, float h) {
	vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
	vec3 r1 = cross(sy, n), r2 = cross(n, sx);
	float det = dot(sx, r1);
	vec2 dh = vec2(dFdx(h), dFdy(h));
	return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}
// a normal map's xy pushed onto the normal along the screen's directions (as the web game does it)
vec3 screenNudge(vec3 n, vec3 view_pos, vec2 d, float k) {
	return normalize(n + (d.x * k) * normalize(dFdx(view_pos)) + (d.y * k) * normalize(dFdy(view_pos)));
}
// a tangent-space normal map without tangents, from the uv derivatives (three.js's perturbNormal2Arb)
vec3 perturbUv(vec3 n, vec3 view_pos, vec2 uv, vec3 mapN) {
	vec3 q0 = dFdx(view_pos), q1 = dFdy(view_pos);
	vec2 st0 = dFdx(uv), st1 = dFdy(uv);
	vec3 q1perp = cross(q1, n), q0perp = cross(n, q0);
	vec3 T = q1perp * st0.x + q0perp * st1.x;
	vec3 B = q1perp * st0.y + q0perp * st1.y;
	float det = max(dot(T, T), dot(B, B));
	float sc = det == 0.0 ? 0.0 : inversesqrt(det);
	return normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + n * mapN.z);
}
"""

## The hull lining's paint: ambientCG's worn green paint (colour, roughness, normal) projected along the
## fuselage, tinted to the B-17's interior green, plus the rivet and seam relief. `%s` = the bomber-space
## position. Needs uniforms u_paint, u_paint_n, u_paint_r, detail_on, and `vec3 col; float rough;` in scope;
## sets `hp` and `puv`; HULL_PAINT_NORMAL after it (with NORMAL in scope) does the relief.
const HULL_PAINT := """
	vec3 hp = %s;
	// the flight deck (forward of the top turret's bulkhead): kept smart, as in the photos of the
	// real one, in smooth bronze-green paint over riveted panels, hardly worn
	float deck = deckK(hp.z);
	vec2 puv = vec2(hp.z, atan(hp.x, hp.y - hullMid(hp.z)) * 1.1) * mix(0.55, 1.4, deck);
	vec3 paint = texture(u_paint, puv).rgb;
	float luma = dot(paint, vec3(0.3, 0.55, 0.15));
	// tinted to interior green; where it's worn through (light, unsaturated) bare aluminium shows
	vec3 green = vec3(0.30, 0.34, 0.23) * (0.74 + 0.5 * luma); // (gently: big blotches read as camouflage)
	vec3 bronze = vec3(0.075, 0.13, 0.095) * (0.9 + 0.2 * luma); // (Boeing's dark green lacquer, Bronze Green 234G9)
	float bare = smoothstep(0.62, 0.8, luma) * mix(0.35, 0.08, deck);
	col = mix(mix(green, bronze, deck), vec3(0.55, 0.56, 0.54), bare);
	if (detail_on > 0.5) {
		// grime in the panel seams and along the rivet rows, so each skin panel reads as a panel
		float rel = hullRelief(hp);
		col *= 1.0 - clamp(-rel, 0.0, 1.0) * mix(0.35, 0.5, deck);
		// oil and hydraulic fluid run down the lower walls in thin streaks, darkest near the floor
		float side = abs(hp.x) / max(length(hp.xy + vec2(0.0, 0.9)), 0.01);
		float streak = smoothstep(0.55, 0.95, texture(u_paint, vec2(hp.z * 3.1, 0.37)).g * 0.5 + fract(sin(floor(hp.z * 14.0) * 91.7) * 43758.5) * 0.6);
		float low = smoothstep(-0.4, -1.6, hp.y) * smoothstep(0.55, 0.9, side);
		col *= 1.0 - streak * low * 0.45 * (1.0 - deck);
	}
	rough = mix(0.45 + 0.5 * texture(u_paint_r, puv).g, 0.32 + 0.18 * texture(u_paint_r, puv).g, deck);
"""
const HULL_PAINT_NORMAL := """
	{
		vec3 pn = texture(u_paint_n, puv).xyz * 2.0 - 1.0;
		float pk = mix(0.25, 0.08, deck); // (the flight deck's paint is smooth: the rivets and seams show)
		NORMAL = screenNudge(NORMAL, VERTEX, pn.xy, pk);
		NORMAL = bumpFrom(VERTEX, NORMAL, hullRelief(hp) * mix(0.004, 0.006, deck));
	}
"""
const HULL_PAINT_UNIFORMS := """
uniform sampler2D u_paint : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D u_paint_n : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D u_paint_r : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float detail_on = 1.0;
"""

static func hull_paint_params(m: ShaderMaterial) -> void:
	m.set_shader_parameter("u_paint", tex("paint_color"))
	m.set_shader_parameter("u_paint_n", tex("paint_normal"))
	m.set_shader_parameter("u_paint_r", tex("paint_rough"))
	_track_detail(m)

# ---------------------------------------------------------------- the cabin's standard material

static var _shaders := {}
## One Shader per variant (feature list), shared by every material of that variant.
static func shader(key: String, make: Callable) -> Shader:
	if not _shaders.has(key):
		var s := Shader.new()
		s.code = make.call()
		_shaders[key] = s
	return _shaders[key]

## features: cull ("back", "front", "disabled"), wear, metal (wear on bare metal: no chips), planks,
## normal (a normal map on its uvs), alpha ("blend", "scissor", "add" or ""), nodepth (no depth write),
## always (depth written even when see-through), nodtest (no depth test), unshaded
static func _std_code(f: Dictionary) -> String:
	var rm := ["cull_" + f.get("cull", "back"), "depth_draw_never" if f.get("nodepth", false) else "", "blend_add" if f.get("alpha", "") == "add" else "",
		"unshaded" if f.get("unshaded", false) else "", "depth_test_disabled" if f.get("nodtest", false) else "",
		"depth_draw_always" if f.get("always", false) else ""].filter(func(s): return s != "")
	var defs := ""
	for k in ["wear", "metal", "planks", "normal"]:
		if f.get(k, false):
			defs += "#define F_%s\n" % k.to_upper()
	if f.get("alpha", "") in ["blend", "add"]:
		defs += "#define F_BLEND\n"
	if f.get("alpha", "") == "scissor":
		defs += "#define F_SCISSOR\n"
	return "shader_type spatial;\nrender_mode %s;\n%s" % [", ".join(rm), defs] + """
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec2 uv_scale = vec2(1.0);
uniform float roughness = 1.0;
uniform float metallic = 0.0;
uniform sampler2D normal_tex : filter_linear_mipmap_anisotropic, repeat_enable, hint_normal;
uniform float normal_scale = 1.0;
uniform vec2 normal_repeat = vec2(1.0);
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform sampler2D emission_tex : source_color, hint_default_white;
uniform float inside = 1.0;
uniform float alpha_scissor = 0.5;
uniform float detail_on = 1.0;
uniform float lift = 0.0; // (a decal's Three polygonOffset: drawn this far off the surface it's on)
uniform sampler2D u_wood : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D u_wood_n : filter_linear_mipmap_anisotropic, repeat_enable;
varying vec2 v_edge;
varying vec3 v_wp;
""" + NOISE + HULL_RELIEF + """
void vertex() {
	v_edge = CUSTOM0.xy;
	v_wp = VERTEX;
	VERTEX += NORMAL * lift;
}
void fragment() {
	vec4 c = albedo * texture(albedo_tex, UV * uv_scale);
	vec3 col = c.rgb;
	float rough = roughness;
#ifdef F_PLANKS
	// the walkway and floors: ambientCG's planks, laid along the fuselage
	vec2 fuv = vec2(v_wp.x * 0.9, v_wp.z * 0.45);
	col *= texture(u_wood, fuv).rgb;
	vec3 wn = texture(u_wood_n, fuv).xyz * 2.0 - 1.0;
	NORMAL = screenNudge(NORMAL, VERTEX, wn.xy, 0.4);
#endif
#ifdef F_NORMAL
	{ vec3 mn = texture(normal_tex, UV * normal_repeat).xyz * 2.0 - 1.0; mn.xy *= normal_scale;
	  NORMAL = perturbUv(NORMAL, VERTEX, UV * normal_repeat, mn); }
#endif
#ifdef F_WEAR
	// wear on the cabin's fittings: the paint chipped back to bare metal along the edges and corners of
	// boxes and the rims of cans and bottles, scuffs and handling grime over the faces, and a rougher,
	// dirtier finish in the creases. The edge distance comes from the UVs (which run 0-1 across each
	// face) scaled to metres on screen.
	float wearRough = 0.0;
	if (detail_on > 0.5) {
		// metres per UV unit, each way, from the screen derivatives
		vec2 mpu = vec2(length(dFdx(v_wp)) / max(length(dFdx(UV)), 1e-5), length(dFdy(v_wp)) / max(length(dFdy(UV)), 1e-5));
		float m = min(mpu.x, mpu.y);
		vec2 e = min(UV, 1.0 - UV) * m; // metres to each edge
		float d = min(v_edge.x > 0.5 ? e.x : 1.0, v_edge.y > 0.5 ? e.y : 1.0);
		float n = n3(v_wp * 60.0), n2 = n3(v_wp * 9.0 + 4.0);
#ifdef F_METAL
		float chip = 0.0; // bare steel/aluminium already: only darker grime, no chips
#else
		float chip = (1.0 - smoothstep(0.0015, 0.007, d + (n - 0.5) * 0.006)) * smoothstep(0.35, 0.6, n2) * 0.6;
#endif
		float grime = n2 * 0.6 + n3(v_wp * 31.0) * 0.4;
		col *= 0.78 + 0.34 * grime;
		col = mix(col, vec3(0.26, 0.26, 0.245), chip); // dull bare metal at the chipped edges
		float scuff = smoothstep(0.72, 0.9, n3(vec3(v_wp.x * 40.0, v_wp.y * 6.0, v_wp.z * 40.0)));
		col *= 1.0 - scuff * 0.18;
		wearRough = chip * -0.15 + (1.0 - grime) * 0.12;
	}
	rough = clamp(rough + wearRough, 0.05, 1.0);
#endif
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metallic;
	EMISSION = emission * emission_energy * texture(emission_tex, UV).rgb;
	// the cabin is dark inside: the sun through the windows lights it, not the sky (AO scales only the indirect light)
	AO = inside;
	AO_LIGHT_AFFECT = 0.0;
#ifdef F_BLEND
	ALPHA = c.a;
#endif
#ifdef F_SCISSOR
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_scissor;
#endif
}
"""

static func _key(f: Dictionary) -> String:
	var ks := f.keys()
	ks.sort()
	return "std|" + "|".join(ks.map(func(k): return "%s=%s" % [k, f[k]]))

## The cabin's MeshStandardMaterial({color, roughness, metalness, ...}): o takes Three's option names
## (color, roughness, metalness, map, normalMap, normalScale, emissive, emissiveIntensity, emissiveMap,
## transparent, opacity, alphaTest, depthWrite, side, blending).
static func std(o: Dictionary = {}) -> ShaderMaterial:
	var f := {cull = ["back", "front", "disabled"][o.get("side", 0)]}
	if o.get("blending", "") == "additive":
		f.alpha = "add"
	elif o.get("transparent", false):
		f.alpha = "blend"
	elif o.get("alphaTest", 0.0) > 0.0:
		f.alpha = "scissor"
	if o.has("depthWrite") and not o.depthWrite:
		f.nodepth = true
	if o.get("normalMap") != null:
		f.normal = true
	if o.has("depthTest") and not o.depthTest:
		f.nodtest = true
	if o.get("transparent", false) and o.get("depthWrite", false):
		f.always = true
	var m := ShaderMaterial.new()
	m.set_meta("cabin_features", f)
	m.shader = shader(_key(f), _std_code.bind(f))
	var c := Mat.color(o.get("color", 0xffffff))
	c.a = o.get("opacity", 1.0)
	m.set_shader_parameter("albedo", c)
	m.set_shader_parameter("roughness", o.get("roughness", 1.0))
	m.set_shader_parameter("metallic", o.get("metalness", 0.0))
	if o.get("map") != null:
		m.set_shader_parameter("albedo_tex", o.map)
	if o.get("normalMap") != null:
		m.set_shader_parameter("normal_tex", o.normalMap)
		var ns = o.get("normalScale", 1.0)
		m.set_shader_parameter("normal_scale", ns.x if ns is Vector2 else float(ns))
	if o.has("emissive"):
		m.set_shader_parameter("emission", Mat.color(o.emissive))
		m.set_shader_parameter("emission_energy", o.get("emissiveIntensity", 1.0))
	if o.get("emissiveMap") != null:
		m.set_shader_parameter("emission_tex", o.emissiveMap)
	if o.get("alphaTest", 0.0) > 0.0:
		m.set_shader_parameter("alpha_scissor", o.alphaTest)
	if o.get("outside", false):
		m.set_meta("outside", true)
	return m

## Change a cabin material's features (keeps its parameters).
static func refeature(m: ShaderMaterial, changes: Dictionary) -> ShaderMaterial:
	var f: Dictionary = m.get_meta("cabin_features", {}).duplicate()
	f.merge(changes, true)
	m.set_meta("cabin_features", f)
	m.shader = shader(_key(f), _std_code.bind(f))
	return m

static func features(m: Material) -> Dictionary:
	return m.get_meta("cabin_features", {}) if m else {}

## True for a material that draws see-through (Three's material.transparent).
static func is_transparent(m: Material) -> bool:
	if m is BaseMaterial3D:
		return m.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA
	return features(m).get("alpha", "") in ["blend", "add"] or m.get_meta("transparent", false)

## A StandardMaterial3D (another area's) as a cabin material with the same look.
static func from_standard(s: BaseMaterial3D) -> ShaderMaterial:
	var m := std({color = s.albedo_color, roughness = s.roughness, metalness = s.metallic, map = s.albedo_texture,
		side = 1 if s.cull_mode == BaseMaterial3D.CULL_FRONT else (2 if s.cull_mode == BaseMaterial3D.CULL_DISABLED else 0)})
	if s.emission_enabled:
		m.set_shader_parameter("emission", s.emission)
		m.set_shader_parameter("emission_energy", s.emission_energy_multiplier)
	if s.normal_enabled and s.normal_texture:
		refeature(m, {normal = true})
		m.set_shader_parameter("normal_tex", s.normal_texture)
		m.set_shader_parameter("normal_scale", s.normal_scale)
		m.set_shader_parameter("normal_repeat", Vector2(s.uv1_scale.x, s.uv1_scale.y))
	m.set_shader_parameter("uv_scale", Vector2(s.uv1_scale.x, s.uv1_scale.y))
	return m

# ---------------------------------------------------------------- the web game's functions

static var _ao_tex := {}
## Darken a material's indirect light (it's inside the fuselage).
static func inside_light(m: Material, amount: float = INSIDE_AMBIENT) -> Material:
	if m == null or m.get_meta("inside", false) or m.get_meta("outside", false):
		return m
	m.set_meta("inside", true)
	if m is ShaderMaterial:
		m.set_shader_parameter("inside", amount)
	elif m is BaseMaterial3D and not m.ao_enabled:
		var k := snappedf(amount, 0.01)
		if not _ao_tex.has(k):
			var img := Image.create(1, 1, false, Image.FORMAT_L8)
			img.set_pixel(0, 0, Color(k, k, k))
			_ao_tex[k] = ImageTexture.create_from_image(img)
		m.ao_enabled = true
		m.ao_texture = _ao_tex[k]
		m.ao_light_affect = 0.0
	return m

## The walkway and floors: ambientCG's planks, laid along the fuselage.
static func planks(m: ShaderMaterial) -> ShaderMaterial:
	m.set_shader_parameter("albedo", Mat.color(0xb8aa96))
	m.set_shader_parameter("u_wood", tex("planks_color"))
	m.set_shader_parameter("u_wood_n", tex("planks_normal"))
	return refeature(m, {planks = true})

## Leather (seats, jackets, pads): ambientCG's leather grain as a normal map on the material's own UVs.
static func leather(m: ShaderMaterial, repeat: float = 3.0) -> ShaderMaterial:
	m.set_shader_parameter("normal_tex", tex("leather_normal"))
	m.set_shader_parameter("normal_repeat", Vector2(repeat, repeat))
	m.set_shader_parameter("normal_scale", 0.6)
	return refeature(m, {normal = true})

## Wear on the cabin's fittings (merged geometry with an `aEdge` attribute in CUSTOM0, see Interior.add).
## A StandardMaterial3D comes back as a cabin material: assign the result.
static func prop_wear(m: Material) -> Material:
	if m.get_meta("wear", false):
		return m
	var out: ShaderMaterial = m if m is ShaderMaterial else from_standard(m)
	out.set_meta("wear", true)
	var metal: bool = float(out.get_shader_parameter("metallic")) > 0.5 # bare steel/aluminium already: only darker grime, no chips
	refeature(out, {wear = true, metal = metal})
	_track_detail(out)
	return out
