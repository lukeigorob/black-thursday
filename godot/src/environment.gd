extends RefCounted
# The weather and the hour: time of day (morning, day, twilight, night), season (summer, autumn, winter) and
# weather (clear, cloudy, rain, thunderstorm). Chosen on the menus, remembered, and applied by World:
# the sky, sun or moon, haze, cloud cover, the ground's snow, rain past the windows, lightning.
# (Load it as `const Env := preload("res://src/environment.gd")`: `Environment` is Godot's own class.)

const Store := preload("res://src/core/store.gd")
const Mat := preload("res://src/core/mat.gd")

const KEY := "bomber.env"
const ENV_OPTIONS := {
	time = [["morning", "Morning"], ["day", "Day"], ["twilight", "Twilight"], ["night", "Night"]],
	season = [["summer", "Summer"], ["autumn", "Autumn"], ["winter", "Winter"]],
	weather = [["clear", "Clear"], ["cloudy", "Cloudy"], ["rain", "Rain"], ["thunder", "Thunderstorm"]],
}

static func load_env() -> Dictionary:
	var env := {time = "day", season = "autumn", weather = "clear"}
	var saved = Store.get_item(KEY)
	if saved is String:
		var j = JSON.parse_string(saved)
		if j is Dictionary:
			env.merge(j, true)
	var def := {time = "day", season = "autumn", weather = "clear"}
	for k in ENV_OPTIONS:
		if not ENV_OPTIONS[k].any(func(o): return o[0] == env.get(k)):
			env[k] = def[k]
	return env

static func save_env(env: Dictionary) -> void:
	Store.set_item(KEY, JSON.stringify(env))

# how the mission's conditions are picked: 'default' (autumn, day, clear: 14 October 1943), 'choose' (as set), 'random' (rolled anew each mission)
const MODE_KEY := "bomber.envMode"
const DEFAULT_ENV := {time = "day", season = "autumn", weather = "clear"}

static func load_env_mode() -> String:
	var m = Store.get_item(MODE_KEY)
	if m in ["default", "choose", "random"]:
		return m
	return "default"

static func save_env_mode(m: String) -> void:
	Store.set_item(MODE_KEY, m)

## A random hour, season and weather (the daylight hours and fair weather a little likelier).
static func roll_env() -> Dictionary:
	var pick := func(list: Array) -> String:
		var total := 0.0
		for e in list:
			total += e[1]
		var r := randf() * total
		for e in list:
			r -= e[1]
			if r < 0:
				return e[0]
		return list[list.size() - 1][0]
	return {time = pick.call([["morning", 2], ["day", 3], ["twilight", 2], ["night", 2]]), season = pick.call([["summer", 1], ["autumn", 1], ["winter", 1]]),
		weather = pick.call([["clear", 3], ["cloudy", 3], ["rain", 2], ["thunder", 1]])}

## "Rain · Night · Winter"
static func env_label(env: Dictionary) -> String:
	var name := func(k: String) -> String:
		for o in ENV_OPTIONS[k]:
			if o[0] == env[k]:
				return o[1]
		return ""
	return "%s · %s · %s" % [name.call("weather"), name.call("time"), name.call("season")]

# the light of each hour: sun (or moon) elevation / azimuth in degrees, its colour and strength, the
# sky model's haze, how bright the sky is drawn, exposure, the ambient (sky / ground) and how sunlit
# the clouds look
const TIMES := {
	morning = {elev = 9, az = 100, sun = [1, 0.74, 0.5], sunI = 2.5, turb = 5, ray = 2.6, mie = 0.0045, dim = 0.62, exp = 0.6, hemi = [0x9fb2d6, 0x564a3a, 0.22], cloud = [1.35, 1.12, 0.95], env = 0.55},
	day = {elev = 38, az = 150, sun = [1, 0.95, 0.88], sunI = 3.2, turb = 2.2, ray = 1.6, mie = 0.004, dim = 0.55, exp = 0.55, hemi = [0xc4d8f0, 0x6a6458, 0.2], cloud = [1.55, 1.55, 1.55], env = 0.6},
	twilight = {elev = 4, az = 255, sun = [1, 0.52, 0.3], sunI = 1.7, turb = 8, ray = 3, mie = 0.011, dim = 0.75, exp = 1.15, hemi = [0x7c84b8, 0x3e3228, 0.4], cloud = [1.1, 0.74, 0.66], env = 0.55}, # (dusk, but you can still see: the cabins weren't black)
	night = {night = true, elev = 32, az = 210, sun = [0.55, 0.66, 0.95], sunI = 0.42, dim = 1, exp = 1.05, hemi = [0x1e2846, 0x0a0a0c, 0.14], cloud = [0.09, 0.1, 0.14], env = 0.12},
}
# cover: clouds against the quality setting's count; deck: how many lie in the low deck; fog: haze
# thickness; overcast 0..1 greys the sky and dims the sun; rain: streak density
const WEATHER := {
	clear = {cover = 0.35, deck = 0.35, fog = 1, overcast = 0, rain = 0, storm = false},
	cloudy = {cover = 1.5, deck = 0.7, fog = 1.6, overcast = 0.35, rain = 0, storm = false},
	rain = {cover = 1.7, deck = 0.8, fog = 4.5, overcast = 0.85, rain = 1, storm = false},
	thunder = {cover = 1.9, deck = 0.85, fog = 5.5, overcast = 1, rain = 1.3, storm = true},
}

# ---------- the values every material of the kind shares: global shader parameters ----------
# (Three shared one uniform object between materials; Godot's global shader parameters do the same job.
# `SNOW.value = 1` sets it for every snowy material at once, as before.)
class Shared:
	var key: String
	var _v := 0.0
	var value: float:
		get: return _v
		set(v):
			_v = v
			RenderingServer.global_shader_parameter_set(key, v)
	func _init(k: String, v: float) -> void:
		key = k
		_v = v

static var _registered := false
## The global shader parameters this area's shaders read (registered once, before the first of them compiles).
static func globals() -> void:
	if _registered:
		return
	_registered = true
	var add := func(n: String, t: int, v) -> void:
		if not RenderingServer.global_shader_parameter_get_list().has(StringName(n)):
			RenderingServer.global_shader_parameter_add(n, t, v)
		else:
			RenderingServer.global_shader_parameter_set(n, v)
	add.call("snow", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 0.0) # SNOW
	add.call("wet", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 0.0) # WET
	add.call("air", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 0.32) # ground.gd AIR
	add.call("fog_col", RenderingServer.GLOBAL_VAR_TYPE_VEC3, Vector3(0.32, 0.42, 0.56)) # the scene's haze (linear): world.gd
	add.call("fog_dens", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 2.4e-5) # and its density (FogExp2)

# ---------- snow on the ground and on the town: one switch every snowy material shares ----------
static var SNOW := _shared("snow", 0.0)
static func _shared(k: String, v: float) -> Shared:
	globals()
	return Shared.new(k, v)

## Snow on whatever faces up (roofs, the ground, tree tops) when it's winter.
static func snowy(m: Material, amount := 0.92) -> Material:
	return hook(m, {snow = amount})

# ---------- rain on the glass: drops on the real panes (not over the whole screen) ----------
static var WET := _shared("wet", 0.0) # 0 dry .. 1 wet: every glass material shares it

## Raindrops on a glass material: beads scattered over the pane (fixed to the glass, so they move
## with it), a little brighter and more opaque than the clear glass round them. Chains any shader
## hook the material already has.
static func wet_glass(m: Material) -> Material:
	return hook(m, {wet = true})

# ---------- the hooks (Three's onBeforeCompile) ----------
# Godot can't splice code into its own StandardMaterial3D, so a material that gets a hook (snowy, wet_glass,
# ground.gd's aerial) becomes a ShaderMaterial: the same standard lighting with the same settings (colour, map,
# vertex colours, roughness, metalness, emission, clearcoat, alpha, culling, depth), and the hooks spliced in
# where Three put them. Hooking it again adds to its list (as the JS chained its onBeforeCompile).
static var _shader_cache := {}

static func hook(m: Material, add: Dictionary) -> Material:
	if m == null:
		return m
	globals()
	var base: BaseMaterial3D
	var hooks := {}
	if m is ShaderMaterial and m.has_meta("hook_base"):
		base = m.get_meta("hook_base")
		hooks = (m.get_meta("hooks") as Dictionary).duplicate()
		for k in add:
			if hooks.has(k):
				return m # (already: once per material, as the JS's WeakSet)
		hooks.merge(add)
	elif m is BaseMaterial3D:
		base = m
		hooks = add.duplicate()
	else:
		push_warning("hook: not a standard material, left as it is")
		return m
	var sm: ShaderMaterial = m if m is ShaderMaterial else ShaderMaterial.new()
	sm.set_meta("hook_base", base)
	sm.set_meta("hooks", hooks)
	_apply(sm, base, hooks)
	return sm

static func _apply(sm: ShaderMaterial, b: BaseMaterial3D, hooks: Dictionary) -> void:
	var f := {
		map = b.albedo_texture != null, vcol = b.vertex_color_use_as_albedo, vsrgb = b.vertex_color_is_srgb,
		unshaded = b.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED,
		alpha = b.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA, scissor = b.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR,
		hash = b.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_HASH,
		cull = b.cull_mode, nodepth = b.depth_draw_mode == BaseMaterial3D.DEPTH_DRAW_DISABLED, nodtest = b.no_depth_test,
		nofog = b.disable_fog, add = b.blend_mode == BaseMaterial3D.BLEND_MODE_ADD,
		emission = b.emission_enabled, emap = b.emission_enabled and b.emission_texture != null,
		normal = b.normal_enabled and b.normal_texture != null, rmap = b.roughness_texture != null, mmap = b.metallic_texture != null,
		clearcoat = b.clearcoat_enabled, ao = b.ao_enabled and b.ao_texture != null,
		snow = hooks.has("snow"), wet = hooks.has("wet"), air = hooks.has("air"), grade = hooks.get("grade", hooks.has("air")),
		atlas = hooks.has("atlas"), offset = hooks.get("offset", 0.0) != 0.0,
	}
	var key := JSON.stringify(f)
	var sh: Shader = _shader_cache.get(key)
	if sh == null:
		sh = Shader.new()
		sh.code = _code(f)
		_shader_cache[key] = sh
	sm.shader = sh
	sm.render_priority = b.render_priority
	sm.set_shader_parameter("albedo", b.albedo_color)
	sm.set_shader_parameter("roughness", b.roughness)
	sm.set_shader_parameter("metallic", b.metallic)
	sm.set_shader_parameter("specular", b.metallic_specular)
	if f.map:
		sm.set_shader_parameter("texture_albedo", b.albedo_texture)
	if f.scissor:
		sm.set_shader_parameter("alpha_scissor", b.alpha_scissor_threshold)
	if f.emission:
		sm.set_shader_parameter("emission", b.emission)
		sm.set_shader_parameter("emission_energy", b.emission_energy_multiplier)
		if f.emap:
			sm.set_shader_parameter("texture_emission", b.emission_texture)
	if f.normal:
		sm.set_shader_parameter("texture_normal", b.normal_texture)
		sm.set_shader_parameter("normal_scale", b.normal_scale)
	if f.rmap:
		sm.set_shader_parameter("texture_roughness", b.roughness_texture)
	if f.mmap:
		sm.set_shader_parameter("texture_metallic", b.metallic_texture)
	if f.clearcoat:
		sm.set_shader_parameter("clearcoat", b.clearcoat)
		sm.set_shader_parameter("clearcoat_roughness", b.clearcoat_roughness)
	if f.ao:
		sm.set_shader_parameter("texture_ao", b.ao_texture)
		sm.set_shader_parameter("ao_light_affect", b.ao_light_affect)
	if f.snow:
		sm.set_shader_parameter("snow_amount", float(hooks.snow))
	if f.offset:
		sm.set_shader_parameter("depth_offset", float(hooks.offset))

## The standard material, as a Godot shader, with the hooks wanted.
static func _code(f: Dictionary) -> String:
	var rm := ["blend_add" if f.add else "blend_mix", ["cull_back", "cull_front", "cull_disabled"][f.cull]]
	rm.append("depth_draw_never" if f.nodepth else ("depth_draw_always" if f.alpha else "depth_draw_opaque"))
	if f.nodtest:
		rm.append("depth_test_disabled")
	if f.unshaded:
		rm.append("unshaded")
	if f.nofog:
		rm.append("fog_disabled")
	if f.hash:
		rm.append("depth_prepass_alpha")
	var c := "shader_type spatial;\nrender_mode %s;\n" % ", ".join(rm)
	c += "uniform vec4 albedo : source_color = vec4(1.0);\nuniform float roughness : hint_range(0, 1) = 1.0;\nuniform float metallic = 0.0;\nuniform float specular = 0.5;\nuniform float env_ao = 1.0;\n"
	if f.map:
		c += "uniform sampler2D texture_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;\n"
	if f.scissor:
		c += "uniform float alpha_scissor = 0.5;\n"
	if f.emission:
		c += "uniform vec4 emission : source_color = vec4(0.0);\nuniform float emission_energy = 1.0;\n"
		if f.emap:
			c += "uniform sampler2D texture_emission : source_color, filter_linear_mipmap_anisotropic;\n"
	if f.normal:
		c += "uniform sampler2D texture_normal : hint_normal, filter_linear_mipmap_anisotropic;\nuniform float normal_scale = 1.0;\n"
	if f.rmap:
		c += "uniform sampler2D texture_roughness : hint_roughness_g, filter_linear_mipmap_anisotropic;\n"
	if f.mmap:
		c += "uniform sampler2D texture_metallic : hint_default_white, filter_linear_mipmap_anisotropic;\n"
	if f.clearcoat:
		c += "uniform float clearcoat = 1.0;\nuniform float clearcoat_roughness = 0.0;\n"
	if f.ao:
		c += "uniform sampler2D texture_ao : hint_default_white, filter_linear_mipmap;\nuniform float ao_light_affect = 1.0;\n"
	if f.snow:
		c += "global uniform float snow;\nuniform float snow_amount = 0.92;\nvarying float v_up;\n"
	if f.wet:
		c += "global uniform float wet;\nvarying vec3 v_wet_p;\n"
	if f.air:
		c += "global uniform float air;\nglobal uniform vec3 fog_col;\nglobal uniform float fog_dens;\n"
	if f.offset:
		c += "uniform float depth_offset = 0.0;\n" # (Three's polygonOffset: drawn a hair nearer than the ground it lies on)
	# vertex
	c += "void vertex() {\n"
	if f.vcol and f.vsrgb: # (the colours (and a MultiMesh's instance colours) given in sRGB, as StandardMaterial3D takes them)
		c += "  COLOR.rgb = mix(pow((COLOR.rgb + vec3(0.055)) * (1.0 / (1.0 + 0.055)), vec3(2.4)), COLOR.rgb * (1.0 / 12.92), lessThan(COLOR.rgb, vec3(0.04045)));\n"
	if f.atlas: # (countryside.gd: each village's cell of the atlas, its MultiMesh instance's custom data)
		c += "  UV = UV * INSTANCE_CUSTOM.zw + INSTANCE_CUSTOM.xy;\n"
	if f.snow:
		c += "  v_up = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz).y;\n"
	if f.wet:
		c += "  v_wet_p = VERTEX;\n"
	if f.offset:
		c += "  POSITION = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));\n  POSITION.z += depth_offset * POSITION.w;\n"
	c += "}\n"
	# fragment
	c += "void fragment() {\n  vec4 col = albedo;\n"
	if f.map:
		c += "  col *= texture(texture_albedo, UV);\n"
	if f.vcol:
		c += "  col *= COLOR;\n"
	if f.grade:
		# (the town's and villages' painted ground graded as the fields' colours are: kept rich and warm under the cool light)
		c += "  col.rgb = max(mix(vec3(dot(col.rgb, vec3(0.3, 0.55, 0.15))), col.rgb, 1.3) * vec3(1.08, 1.0, 0.82), 0.0);\n"
	if f.snow:
		c += "  col.rgb = mix(col.rgb, vec3(0.86, 0.88, 0.9), snow * snow_amount * smoothstep(0.35, 0.8, v_up));\n"
	c += "  ALBEDO = col.rgb;\n"
	if not f.unshaded:
		c += "  ROUGHNESS = roughness%s;\n  METALLIC = metallic%s;\n  SPECULAR = specular;\n" % [" * texture(texture_roughness, UV).g" if f.rmap else "", " * texture(texture_metallic, UV).b" if f.mmap else ""]
		if f.normal:
			c += "  NORMAL_MAP = texture(texture_normal, UV).rgb;\n  NORMAL_MAP_DEPTH = normal_scale;\n"
		if f.clearcoat:
			c += "  CLEARCOAT = clearcoat;\n  CLEARCOAT_ROUGHNESS = clearcoat_roughness;\n"
		if f.ao:
			c += "  AO = texture(texture_ao, UV).r * env_ao;\n  AO_LIGHT_AFFECT = ao_light_affect;\n"
		else: # (env_ao: Three's envMapIntensity, how much of the sky's light it takes: ground.gd's aerial turns it down)
			c += "  AO = env_ao;\n  AO_LIGHT_AFFECT = 0.0;\n"
	if f.emission:
		c += "  EMISSION = emission.rgb * emission_energy%s;\n" % (" * texture(texture_emission, UV).rgb" if f.emap else "")
	if f.alpha or f.scissor or f.hash:
		c += "  ALPHA = col.a;\n"
	if f.scissor:
		c += "  ALPHA_SCISSOR_THRESHOLD = alpha_scissor;\n"
	if f.hash:
		c += "  ALPHA_HASH_SCALE = 1.0;\n"
	if f.wet:
		c += """  if (wet > 0.0) {
    float drops = 0.0;
    for (int k = 0; k < 2; k++) { // two sizes of bead
      vec3 wp = v_wet_p * (k == 0 ? 24.0 : 55.0);
      vec3 cell_ = floor(wp), fr = fract(wp);
      float h = fract(sin(dot(cell_, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      vec3 cc = vec3(fract(h * 7.13), fract(h * 3.71), fract(h * 5.37)) * 0.6 + 0.2;
      float r = (0.09 + 0.11 * fract(h * 11.0));
      drops = max(drops, step(1.0 - wet * 0.4, h) * smoothstep(r, r * 0.5, length(fr - cc)));
    }
    // (lit by what's round it: a bead catches the light, it doesn't glow by itself at night: brighter and
    // glossier, so it takes the sun and the sky's reflection as the JS took indirectSpecular)
    ALBEDO = mix(ALBEDO, ALBEDO * 1.5, drops * 0.6);
    ROUGHNESS = mix(ROUGHNESS, 0.02, drops);
    SPECULAR = mix(SPECULAR, 1.0, drops * 0.6);
    ALPHA = max(ALPHA, drops * 0.28);
  }
"""
	if f.air:
		# the haze over the ground: the scene's fog (exp2), and over it a veil that grows with distance from
		# the first metre (exponential), whichever is the thicker
		c += """  float fog_d = length(VERTEX);
  float fog_f = max(1.0 - exp(-fog_dens * fog_dens * fog_d * fog_d), 1.0 - exp(-air * fog_dens * fog_d));
  FOG = vec4(fog_col, fog_f);
"""
	c += "}\n"
	return c

# ---------- the night sky: a dark gradient, stars, the moon ----------
## The night sky's stars, the 2600 of them the JS scattered (the same seed, the same places), baked into an
## equirectangular map the sky shader reads (Three drew them as 1-pixel points into the sky cube).
static func night_stars() -> ImageTexture:
	var W := 4096
	var H := 2048
	var img := Image.create(W, H, false, Image.FORMAT_RGBH)
	var st := [3] # (an array: a lambda keeps its own copy of a plain local)
	var rnd := func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return float(st[0]) / 2147483647.0
	var n := 2600
	for i in n:
		var y: float = rnd.call() * 1.05 - 0.05
		var a: float = rnd.call() * PI * 2.0
		var r := sqrt(1.0 - y * y)
		var d := Vector3(cos(a) * r, y, sin(a) * r)
		var b: float = pow(rnd.call(), 9) * 1.6 + 0.05
		var warm: float = rnd.call() # (most faint, a few bright)
		var col := Color(b * (0.85 + warm * 0.2), b * 0.92, b * (1.1 - warm * 0.2))
		# (the sky shader's lookup: u from atan(z, x), v from the elevation)
		var u := (atan2(d.z, d.x) / TAU + 0.5) * W
		var v := (acos(clampf(d.y, -1, 1)) / PI) * H
		var px := int(u) % W
		var py := clampi(int(v), 0, H - 1)
		img.set_pixel(px, py, col)
	return ImageTexture.create_from_image(img)

## The moon's disc, as it looks from 25,000 feet on a clear night: a bright, slightly gibbous moon, its
## dark seas where they are on the real near side (Imbrium, Serenitatis, Tranquillitatis, Crisium,
## Procellarum, Nubium...), bright young craters with their rays (Tycho's down in the south, Copernicus,
## Kepler), a mottled highland grain, the limb a little darker, the terminator soft. Drawn once.
static func moon_texture() -> Texture2D:
	var Canvas2D = load("res://src/core/canvas2d.gd")
	var S := 512
	var g = Canvas2D.new(S, S)
	var R := S * 0.46
	var cx := S / 2.0
	var cy := S / 2.0
	var st := [11]
	var rnd := func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return float(st[0]) / 2147483647.0
	g.save(); g.begin_path(); g.arc(cx, cy, R, 0, PI * 2); g.clip()
	# the highlands: warm grey-white, a fine grain all over
	g.fill_style = "#e9e6dc"; g.fill_rect(0, 0, S, S)
	for i in 9000:
		var v := int(200 + rnd.call() * 55)
		g.fill_style = "rgba(%d,%d,%d,0.25)" % [v, v - 4, v - 10]
		g.fill_rect(rnd.call() * S, rnd.call() * S, 1 + rnd.call() * 3, 1 + rnd.call() * 3)
	# the seas: overlapping soft dark blotches (x, y in disc radii from the centre, size)
	var seas := [[-0.38, -0.35, 0.3], [-0.1, -0.42, 0.22], [0.14, -0.3, 0.2], [0.22, -0.05, 0.24], [0.55, -0.12, 0.13], [-0.55, 0.05, 0.36],
		[-0.62, -0.18, 0.22], [-0.2, 0.25, 0.18], [0.05, 0.12, 0.12], [0.38, 0.2, 0.16], [-0.42, 0.42, 0.14], [-0.05, -0.05, 0.1]]
	for s in seas:
		for k in 7:
			var px: float = cx + (s[0] + (rnd.call() - 0.5) * s[2] * 0.6) * R
			var py: float = cy + (s[1] + (rnd.call() - 0.5) * s[2] * 0.6) * R
			var pr: float = s[2] * R * (0.55 + rnd.call() * 0.5)
			var gr = g.create_radial_gradient(px, py, 0, px, py, pr)
			gr.add_color_stop(0, "rgba(88,92,102,0.5)"); gr.add_color_stop(0.7, "rgba(104,108,116,0.3)"); gr.add_color_stop(1, "rgba(120,120,125,0)")
			g.fill_style = gr; g.fill_rect(px - pr, py - pr, pr * 2, pr * 2)
	# craters: small dark-rimmed pits, and the bright young ones with rays
	for i in 140:
		var a: float = rnd.call() * PI * 2
		var d: float = sqrt(rnd.call()) * R
		var x := cx + cos(a) * d
		var y := cy + sin(a) * d
		var r: float = 1 + pow(rnd.call(), 3) * 9
		g.fill_style = "rgba(120,118,112,0.2)"; g.begin_path(); g.arc(x + r * 0.2, y + r * 0.2, r, 0, 7); g.fill()
		g.fill_style = "rgba(255,253,245,0.35)"; g.begin_path(); g.arc(x - r * 0.15, y - r * 0.15, r * 0.75, 0, 7); g.fill()
	for c in [[-0.12, 0.66, 26, 0.9], [-0.28, -0.08, 16, 0.45], [-0.58, -0.02, 10, 0.3], [0.62, -0.42, 8, 0.25]]: # Tycho, Copernicus, Kepler, a fourth
		var px: float = cx + c[0] * R
		var py: float = cy + c[1] * R
		g.stroke_style = "rgba(255,255,250,0.13)"
		for k in int(c[2]):
			var a: float = rnd.call() * PI * 2
			var l: float = R * c[3] * (0.4 + rnd.call() * 0.6)
			g.line_width = 1 + rnd.call() * 2.5; g.begin_path(); g.move_to(px, py); g.line_to(px + cos(a) * l, py + sin(a) * l); g.stroke()
		g.fill_style = "rgba(255,255,252,0.95)"; g.begin_path(); g.arc(px, py, 4, 0, 7); g.fill()
	# the limb a little darker and cooler; the terminator, soft, just past full on the left
	var limb = g.create_radial_gradient(cx, cy, R * 0.55, cx, cy, R)
	limb.add_color_stop(0, "rgba(0,0,0,0)"); limb.add_color_stop(1, "rgba(40,46,70,0.38)")
	g.fill_style = limb; g.fill_rect(0, 0, S, S)
	var term = g.create_linear_gradient(cx - R, 0, cx - R * 0.55, 0)
	term.add_color_stop(0, "rgba(6,8,16,0.92)"); term.add_color_stop(1, "rgba(6,8,16,0)")
	g.fill_style = term; g.fill_rect(0, 0, S, S)
	g.restore()
	return g.texture()

## The moon's glow: a soft cold light round it, fading smoothly to nothing.
static func moon_glow_texture() -> Texture2D:
	# a soft glow round the moon, falling smoothly away to nothing: no halo ring, and dithered so its
	# 8-bit steps don't show as rings either
	var S := 512
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	var m := S / 2.0
	for y in S:
		for x in S:
			var r := Vector2(x + 0.5 - m, y + 0.5 - m).length() / m
			var a := 0.0 if r >= 1 else (0.5 * exp(-r / 0.045) + 0.2 * exp(-r / 0.16) + 0.05 * exp(-r / 0.4)) * pow(1 - r * r, 2)
			var nz := randf() - 0.5
			var k := minf(1, r * 2)
			img.set_pixel(x, y, Color8(int(205 - 60 * k), int(218 - 55 * k), int(250 - 30 * k), int(clampf(a * 255 + nz, 0, 255))))
	return ImageTexture.create_from_image(img)

# ---------- rain streaking past ----------
## Rain round the camera: thousands of short streaks drawn in one call, moved entirely on the GPU (the
## air streams past at the formation's speed, the drops fall). Never inside your own bomber's fuselage.
class Rain:
	var mesh: MeshInstance3D
	var mat: ShaderMaterial
	var u := {time = 0.0}

	func _init(scene: Node, airspeed: float) -> void:
		var N := 6000
		var B := 46.0 # streaks, half the box they fill round the camera (m)
		var pos := PackedVector3Array()
		var end := PackedFloat32Array() # (Three's aEnd: 0 the drop, 1 its tail; in UV.x here)
		pos.resize(N * 2)
		var uv := PackedVector2Array()
		uv.resize(N * 2)
		var st := [5]
		var rnd := func() -> float:
			st[0] = (st[0] * 16807) % 2147483647
			return float(st[0]) / 2147483647.0
		for i in N:
			var p := Vector3((rnd.call() * 2 - 1) * B, (rnd.call() * 2 - 1) * B, (rnd.call() * 2 - 1) * B)
			pos[i * 2] = p
			pos[i * 2 + 1] = p
			uv[i * 2] = Vector2(0, 0)
			uv[i * 2 + 1] = Vector2(1, 0)
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = pos
		arrays[Mesh.ARRAY_TEX_UV] = uv
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
		mat = ShaderMaterial.new()
		mat.shader = load("res://src/shaders/rain.gdshader")
		mat.set_shader_parameter("u_box", B)
		mat.set_shader_parameter("u_speed", airspeed)
		mat.set_shader_parameter("u_color", Vector3(0.55, 0.6, 0.66))
		mat.set_shader_parameter("u_density", 1.0)
		mat.set_shader_parameter("u_exclude", 0.0)
		am.surface_set_material(0, mat)
		mesh = MeshInstance3D.new()
		mesh.mesh = am
		mesh.custom_aabb = AABB(Vector3(-1e9, -1e9, -1e9), Vector3(2e9, 2e9, 2e9)) # (never culled: frustumCulled = false)
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh.visible = false
		scene.add_child(mesh)

	## amount: 0 none, 1 rain, more is heavier. inv: your bomber's inverse world transform (or null).
	func update(dt: float, cam_pos: Vector3, amount: float, inv) -> void:
		mesh.visible = amount > 0
		if not amount:
			return
		u.time = fmod(u.time + dt, 1000.0)
		mat.set_shader_parameter("u_time", u.time)
		mat.set_shader_parameter("u_cam", cam_pos)
		mat.set_shader_parameter("u_density", minf(1, amount * 0.75))
		mat.set_shader_parameter("u_exclude", 1.0 if inv != null else 0.0)
		if inv != null:
			mat.set_shader_parameter("u_inv", Projection(inv as Transform3D))

	func set_speed(v: float) -> void:
		mat.set_shader_parameter("u_speed", v)

## Lightning: now and then a flash (two or three flickers) somewhere in the storm; thunder follows it.
class Lightning:
	var t := 4.0
	var flash := 0.0
	var flicker := []
	var age := 0.0

	## Returns the flash brightness this frame (0..1); on_strike(distance m) when a bolt goes.
	func update(dt: float, on: bool, on_strike = null) -> float:
		if not on:
			flash = 0.0
			flicker.clear()
			return 0.0
		t -= dt
		if t <= 0:
			t = 5 + randf() * 12
			var d := 1500 + randf() * 9000
			var k := minf(1, 4000 / d) * (0.6 + randf() * 0.4)
			flicker = [[0, k], [0.07, k * 0.25], [0.12, k * 0.9], [0.22, k * 0.15], [0.3, k * 0.6]].map(func(e): return [e[0] + randf() * 0.03, e[1]])
			age = 0.0
			if on_strike is Callable:
				on_strike.call(d)
		if flicker.size():
			age += dt
			var v := 0.0
			for e in flicker:
				if age >= e[0]:
					v = e[1] * exp(-(age - e[0]) * 14)
			flash = v
			if age > 1:
				flicker.clear()
		else:
			flash = 0.0
		return flash
