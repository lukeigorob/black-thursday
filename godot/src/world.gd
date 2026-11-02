extends RefCounted
# The sky, sun, haze, ground far below and layered clouds.
# The formation stays near the origin; the ground and clouds scroll past instead.

const Countryside := preload("res://src/countryside.gd")
const Ground := preload("res://src/ground.gd")
const Env := preload("res://src/environment.gd")

const ALTITUDE := 7600.0 # ~25,000 ft
const SUN_ELEVATION := 38.0
const SUN_AZIMUTH := 150.0 # degrees
const CLOUD_RECYCLE_Z := 4000.0
const CLOUD_SPAN_Z := 18000.0
const HAZE := Color(0.32, 0.42, 0.56) # linear
# at 25,000 ft the sky is a deep blue: draw it darker than the raw sky model so planes, smoke and
# fires stand out against it instead of being lost in the glare
const SKY_DIM := 0.55
const FOG_DENSITY := 2.4e-5 # half the old haze: you can see the battle 2-3x further

var scene: Node3D
var renderer # graphics.gd's Renderer: its environment is the scene's (sky, fog, light)
var environment: Environment
var sun_dir: Vector3
var heading := 0.0
var sun_base: Vector3
var drift: Node3D
var look: Dictionary
var env: Dictionary
var sky_mat: ShaderMaterial
var sun: DirectionalLight3D
var hemi := {color = Color.hex(0xc4d8f0ff), ground_color = Color.hex(0x6a6458ff), intensity = 0.2}
var hemi_base := 0.2
var sky_base := 0.55
var fog_base: Color
var fog_density := FOG_DENSITY
var layout
var ground_mat: ShaderMaterial
var ground: MeshInstance3D
var countryside
var cloud_textures: Array
var cloud_mat: ShaderMaterial
var clouds: Array = []
var cloud_count := 0
var cloud_tint := WHITE
var rain
var lightning
var flash := 0.0
var focus = null
var keep_out = null # (the target city's place: main.gd sets it)
var _stars: Texture2D
var _moon: Texture2D
var _moon_glow: Texture2D

## spherical (radius 1, polar phi from +Y, azimuth theta), as Three's setFromSphericalCoords
static func spherical(phi: float, theta: float) -> Vector3:
	return Vector3(sin(phi) * sin(theta), cos(phi), sin(phi) * cos(theta))

func _init(renderer_, scene_: Node3D) -> void:
	scene = scene_
	renderer = renderer_
	environment = renderer.environment
	sun_dir = spherical(deg_to_rad(90 - SUN_ELEVATION), deg_to_rad(SUN_AZIMUTH))
	# the formation's turns (the rally): the ground, the clouds and the target under it (drift), the sky and
	# the sun all swing round the formation together (set_heading); in the formation's frame the ground still
	# streams straight aft past it (update), only turned
	sun_base = sun_dir
	drift = Node3D.new()
	drift.name = "drift"
	scene.add_child(drift)
	look = Env.TIMES.day.duplicate()
	look.merge({overcast = 0, fog = 1, cover = 1, deck = 0.5}, true)
	_init_environment()
	build_sky(renderer)

	sun = DirectionalLight3D.new()
	sun.name = "sun"
	sun.light_color = Color.hex(0xfff2e0ff)
	sun.light_energy = 3.2
	# (Three's shadow: an orthographic box round your bomber, 90 m across (34 m inside it), a soft PCF edge.
	# Godot's sun shadow follows the camera; two splits over the same reach keep it as crisp near you)
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 90.0
	sun.directional_shadow_split_1 = 0.3
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 1.0
	sun.shadow_blur = 1.5
	scene.add_child(sun)
	_aim_sun()

	build_ground(renderer)
	countryside = Countryside.new(drift, -ALTITUDE, layout) # (villages and towns where the layout put them)
	cloud_textures = [0, 1, 2, 3].map(cloud_texture)
	cloud_mat = ShaderMaterial.new()
	cloud_mat.shader = load("res://src/shaders/cloud.gdshader")
	cloud_mat.set_shader_parameter("tex0", cloud_textures[0])
	cloud_mat.set_shader_parameter("tex1", cloud_textures[1])
	cloud_mat.set_shader_parameter("tex2", cloud_textures[2])
	cloud_mat.set_shader_parameter("tex3", cloud_textures[3])
	rain = Env.Rain.new(scene, 0)
	lightning = Env.Lightning.new()

## The scene's environment as the JS's renderer and scene had it: the sky as the background and the light,
## the fog (FogExp2), and what graphics.gd sets (tone mapping, glow, SSAO).
func _init_environment() -> void:
	Env.globals()
	var e := environment
	e.background_mode = Environment.BG_SKY
	if e.sky == null:
		e.sky = Sky.new()
	# (the light's cube: 128 in the JS, PMREM'd; Godot filters its own. Redrawn when the sky changes)
	e.sky.radiance_size = Sky.RADIANCE_SIZE_128
	e.sky.process_mode = Sky.PROCESS_MODE_QUALITY
	sky_mat = ShaderMaterial.new()
	sky_mat.shader = load("res://src/shaders/sky.gdshader")
	e.sky.sky_material = sky_mat
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.ambient_light_sky_contribution = 1.0
	e.ambient_light_energy = 1.0
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	# the haze: Three's FogExp2 (1 - exp(-(density d)^2)), as Godot's depth fog with a squared curve, matched to it
	# out to ~30 km (the battle, the clouds); the ground's and the town's own shaders work the exact formula
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_DEPTH
	e.fog_depth_begin = 0.0
	e.fog_depth_curve = 2.0
	e.fog_density = 1.0
	e.fog_sky_affect = 0.0
	e.fog_sun_scatter = 0.0
	e.fog_aerial_perspective = 0.0
	e.fog_height_density = 0.0

## The hour, season and weather (environment.gd): the sky is drawn afresh, the sun (or the moon) moves
## and changes colour, the haze, the cloud cover and the ground follow. Returns the exposure to use.
func set_env(env_: Dictionary) -> float:
	var L: Dictionary = Env.TIMES[env_.time]
	var W: Dictionary = Env.WEATHER[env_.weather]
	var o: float = W.overcast
	var winter: bool = env_.season == "winter"
	env = env_
	look = L.duplicate()
	look.merge({overcast = o, fog = W.fog, cover = W.cover, deck = W.deck, rain = W.rain, storm = W.storm, winter = winter}, true)
	sun_dir = spherical(deg_to_rad(90 - L.elev), deg_to_rad(L.az))
	sun_base = sun_dir # (the sky is drawn for the track; the turn swings it: set_heading)
	build_sky(renderer)
	# the sun (or by night the moon): dimmed and its shadows softened under cloud; colder in winter
	var c := Color(L.sun[0], L.sun[1], L.sun[2])
	if winter:
		c *= Color(0.93, 0.97, 1.06)
	sun.light_color = c.linear_to_srgb() # (Three's colours here are linear; Godot's light colour is sRGB)
	sun.light_energy = L.sunI * (1 - 0.7 * o)
	hemi.color = Color.hex((int(L.hemi[0]) << 8) | 0xff)
	hemi.ground_color = Color.hex(((0x8a8e94 if winter else int(L.hemi[1])) << 8) | 0xff)
	hemi_base = L.hemi[2] * (1 + 1.6 * o) * (1.25 if winter and not L.get("night", false) else 1.0)
	hemi.intensity = hemi_base
	_set_hemi()
	sky_mat.set_shader_parameter("env_intensity", L.env * (1 - 0.3 * o))
	# the clouds: how many, how low, and how lit
	cloud_tint = Color(L.cloud[0], L.cloud[1], L.cloud[2]) * (1 - 0.5 * o)
	set_cloud_count(cloud_count, true)
	# snow on the fields and the town
	Env.SNOW.value = 1.0 if winter else 0.0
	ground_mat.set_shader_parameter("uSeason", 0.0 if env_.season == "summer" else 1.0) # (winter: autumn's ploughland under the snow)
	ground_mat.set_shader_parameter("uSunL", sun_base) # (the ground turns with the sun in a turn: in its own frame the sun stays put)
	_aim_sun()
	return L.exp * (1 + 0.25 * o)

func _set_hemi() -> void:
	sky_mat.set_shader_parameter("hemi_sky", _lin3(hemi.color))
	sky_mat.set_shader_parameter("hemi_ground", _lin3(hemi.ground_color))
	sky_mat.set_shader_parameter("hemi_intensity", hemi.intensity)

static func _lin3(c: Color) -> Vector3:
	var l := c.srgb_to_linear()
	return Vector3(l.r, l.g, l.b)

func build_sky(_renderer = null) -> void:
	# the sky shader (shaders/sky.gdshader): the background and the light from the one sky, no depth issues
	var L := look
	var o: float = L.get("overcast", 0)
	var mixo := func(a: float, b: float) -> float: return a + (b - a) * o
	var night: bool = L.get("night", false)
	var u := sky_mat
	u.set_shader_parameter("night", night)
	if night:
		if _stars == null:
			_stars = Env.night_stars() # a dark sky and its stars
		u.set_shader_parameter("stars", _stars)
	else:
		# under cloud the sky goes milky grey: more haze, less blue
		u.set_shader_parameter("turbidity", mixo.call(L.turb, 20))
		u.set_shader_parameter("rayleigh", mixo.call(L.ray, 0.35))
		u.set_shader_parameter("mie_coefficient", mixo.call(L.mie, 0.04))
		u.set_shader_parameter("mie_directional_g", 0.74 if L.elev < 15 else 0.82) # (a low sun: a softer glow round it, not a white-out)
		u.set_shader_parameter("cloud_coverage", 0.25) # faint high cirrus
		# no physical sun disc: it is thousands of times brighter than anything else and would make the
		# bloom wash out the whole screen (and every metal glow). A sprite sun with sane brightness instead.
	u.set_shader_parameter("sun_position", sun_base)
	# the overcast: a grey lid over the sky (and the stars)
	u.set_shader_parameter("overcast", o)
	u.set_shader_parameter("lid_color", Vector3(0.01, 0.011, 0.014) if night else Vector3(0.62, 0.65, 0.7))
	sky_base = 1.0 if night else L.dim * (1 - 0.35 * o)
	u.set_shader_parameter("bg_intensity", sky_base)
	build_sun()
	u.set_shader_parameter("env_intensity", 0.6)
	_set_hemi()

	# haze matched to the sky just above the horizon, so the far ground melts into the sky (grey in
	# overcast and rain, near black at night), thicker in bad weather
	var haze: Color = Color(0.012, 0.016, 0.03) if night else horizon_color(L.az) * L.dim
	if o:
		haze = haze.lerp(Color(0.2, 0.215, 0.235) * (0.08 if night else L.dim * 1.6), o * 0.8)
	haze.a = 1
	fog_density = FOG_DENSITY * L.get("fog", 1)
	fog_base = haze
	_set_fog(haze)

## The fog's colour (linear) and density, for Godot's fog and for the shaders that work it out themselves.
func _set_fog(haze: Color) -> void:
	environment.fog_light_color = haze.linear_to_srgb()
	environment.fog_light_energy = 1.0
	environment.fog_depth_end = 1.1 / fog_density # (x^2 to x = 1.1: 1 - exp(-x^2) is matched best over the near ranges)
	RenderingServer.global_shader_parameter_set("fog_col", Vector3(haze.r, haze.g, haze.b))
	RenderingServer.global_shader_parameter_set("fog_dens", fog_density)

func build_sun() -> void:
	# the sun's sprite (and the moon's), drawn in the sky shader, moved and shown or hidden with the hour
	var L := look
	var night: bool = L.get("night", false)
	var o: float = L.get("overcast", 0)
	var k := 2.2 if L.elev < 5 else 3.0 if L.elev < 15 else 6.0 # (bright, but not a white-out through the bloom)
	var show_sun := not night and o < 0.7
	sky_mat.set_shader_parameter("sun_sprite", Vector3(L.sun[0], L.sun[1], L.sun[2]) * k if show_sun else Vector3.ZERO)
	var show_moon := night and o < 0.7
	if show_moon and _moon == null:
		_moon = Env.moon_texture()
		_moon_glow = Env.moon_glow_texture()
		sky_mat.set_shader_parameter("moon_tex", _moon)
		sky_mat.set_shader_parameter("moon_glow_tex", _moon_glow)
	sky_mat.set_shader_parameter("moon_on", show_moon)

func _aim_sun() -> void:
	# (Three's light shines from its position, sun_dir out, to its target; Godot's down its -Z)
	sun.basis = Basis.looking_at(-sun_dir, Vector3.UP if absf(sun_dir.y) < 0.999 else Vector3.FORWARD)
	if ground_mat:
		ground_mat.set_shader_parameter("uSunL", sun_base)

func build_ground(_renderer = null) -> void:
	# the country laid out (woods, streams, villages, roads), drawn by the ground's own shader (ground.gd)
	layout = Ground.layout_country()
	ground_mat = Ground.ground_material(layout)
	const Geo := preload("res://src/core/geo.gd")
	var g = Geo.plane(400000, 400000).rotate_x(-PI / 2)
	ground = MeshInstance3D.new()
	ground.name = "ground"
	ground.mesh = g.to_mesh(ground_mat)
	ground.position.y = -ALTITUDE
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF # (receiveShadow false: no shadow reaches it from 7.6 km up)
	ground.extra_cull_margin = 16384
	drift.add_child(ground)

## (The old painted winter ground: nothing to paint now, the shader does the snow.)
func winter_ground() -> void:
	pass

## Draw the other kinds of sky once now (the night sky's shader), so switching to them later doesn't stall.
## (One sky shader does every hour here: the night's stars are made now so the switch doesn't wait on them.)
func warm_skies() -> void:
	if _stars == null:
		_stars = Env.night_stars()

func set_quality(q: Dictionary) -> void:
	sun.shadow_enabled = q.shadows > 0
	if q.shadows:
		RenderingServer.directional_shadow_atlas_set_size(q.shadows, true)
	set_cloud_count(q.clouds)

## base: the quality setting's count (the weather scales it). again: re-place all of them (the weather changed).
func set_cloud_count(base: int, again := false) -> void:
	cloud_count = base
	var n := mini(520, roundi(base * look.get("cover", 1.0)))
	if again:
		for c in clouds:
			place_cloud(c, c.position.z)
	while clouds.size() > n:
		var c: MeshInstance3D = clouds.pop_back()
		c.queue_free()
	while clouds.size() < n:
		var c := MeshInstance3D.new()
		var q := QuadMesh.new()
		c.mesh = q
		c.material_override = cloud_mat
		c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		c.extra_cull_margin = 2000.0 # (a billboard: its box turns, the sprite doesn't)
		c.set_instance_shader_parameter("tex_index", clouds.size() % 4)
		place_cloud(c, rand(-CLOUD_SPAN_Z + CLOUD_RECYCLE_Z, CLOUD_RECYCLE_Z))
		drift.add_child(c)
		clouds.append(c)

func place_cloud(c: MeshInstance3D, z: float) -> void:
	var layer := randf()
	var L := look
	var deck: float = L.get("deck", 0.5)
	var o: float = L.get("overcast", 0)
	var y: float
	var size: float
	var opacity := 1.0
	var bright := 1.55 # sunlit cloud, a little brighter than the dimmed horizon
	if layer < deck:
		y = rand(-2700, -2200); size = rand(700, 1500) * (1 + o * 0.6); bright = 1.35 # the deck far below (solid under overcast)
	elif layer < deck + (1 - deck) * 0.7:
		y = rand(-1500, -350); size = rand(250, 650) # cumulus we fly over
	else:
		y = rand(350, 900 + o * 1500); size = rand(400, 900) * (1 + o); opacity = 0.35 + o * 0.5 # wisps above (a grey ceiling in rain)
	var x := rand(-9000, 9000)
	if absf(x) < 350 and y > -500:
		x += signf(x if x else 1.0) * 700 # keep the formation's own air clear
	c.position = Vector3(x, y, z)
	c.scale = Vector3(size * rand(1.2, 1.8), size * (0.45 if layer < 0.5 else 0.8), 1)
	var col: Color = cloud_tint * (bright / 1.55)
	c.set_meta("color", col)
	c.set_instance_shader_parameter("tint", Color(col.r, col.g, col.b, opacity))

## Keep the sun's shadow on the player's bomber, wherever in the stream it is.
func follow(pos: Vector3, inside := false) -> void:
	# inside the bomber the shadow closes in on it: four times the texels, so the sun through the windows
	# and gun hatches lands as crisp shapes, not soft blobs (Godot's sun shadow is round the camera: its
	# reach is what the JS's box was)
	var half := 17.0 if inside else 45.0
	if sun.directional_shadow_max_distance != half * 2:
		sun.directional_shadow_max_distance = half * 2
		sun.shadow_blur = 0.75 if inside else 1.5
		sun.shadow_normal_bias = 0.4 if inside else 1.0
	focus = pos # (where you are: the villages near it get their houses in 3D)

## cam_pos: rain falls round it; inv: your bomber's inverse transform (no rain inside it), or null.
## on_strike(distance): lightning has struck (thunder follows).
func weather(dt: float, cam_pos: Vector3, inv, on_strike = null) -> void:
	var L := look
	rain.update(dt, cam_pos, L.get("rain", 0), inv)
	var f: float = lightning.update(dt, L.get("storm", false), on_strike)
	if f == flash:
		return
	flash = f
	# a flash lights everything for a moment: the sky, the clouds, the haze, the planes
	hemi.intensity = hemi_base + f * 3
	environment.ambient_light_energy = 1.0 + f * 3 / maxf(hemi_base, 0.05) * 0.35 # (the light's cube isn't redrawn for a flash: the ambient turned up instead)
	sky_mat.set_shader_parameter("bg_intensity", sky_base + f * 1.6)
	var fc := fog_base + Color(f * 0.12, f * 0.12, f * 0.12, 0)
	_set_fog(fc)
	for c in clouds:
		var col: Color = c.get_meta("color")
		var t: Color = c.get_instance_shader_parameter("tint")
		c.set_instance_shader_parameter("tint", Color(col.r + f * 1.4, col.g + f * 1.4, col.b + f * 1.4, t.a))

## The formation's heading off the track (rad, + to the right): the ground, clouds and target (drift), the
## sky and the sun turn about the formation the other way, as they would below and around a formation
## that turned. Called every frame of a turn; cheap (no sky redrawn).
func set_heading(psi: float) -> void:
	if psi == heading:
		return
	heading = psi
	drift.rotation.y = psi
	sun_dir = sun_base.rotated(Vector3.UP, psi)
	environment.sky_rotation = Vector3(0, -psi, 0) # (Godot turns the eye's direction by it: the sky turns the other way, as backgroundRotation did)
	_aim_sun()

func update(dt: float, speed: float) -> void:
	rain.set_speed(speed)
	# straight aft in the formation's frame: in drift's turned frame, back along the turn (-heading)
	var sx := -sin(heading) * speed * dt
	var sz := cos(heading) * speed * dt
	countryside.update(sx, sz, keep_out, focus) # (keep_out: the target city's place, main.gd)
	# the ground's layout rides with the countryside's group; the target town's own ground keeps ours off it
	var gp: Vector3 = countryside.group.position
	ground_mat.set_shader_parameter("uOrigin", Vector2(gp.x, gp.z))
	if keep_out != null:
		ground_mat.set_shader_parameter("uCity", Vector3(keep_out.x - gp.x, keep_out.z - gp.z, 5600))
	for c in clouds:
		c.position.x += sx
		c.position.z += sz
		if c.position.z > CLOUD_RECYCLE_Z:
			place_cloud(c, c.position.z - CLOUD_SPAN_Z)

static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)

const WHITE := Color(1.55, 1.55, 1.55)

## The sky's colour a couple of degrees above the horizon, away from the sun (linear HDR): the JS rendered the
## sky into an 8x8 target through a 10° camera and averaged it; here the same sky model (sky.gdshader's day_sky,
## the overcast lid over it) is worked out for the same 64 directions.
func horizon_color(az := SUN_AZIMUTH) -> Color:
	var a := deg_to_rad(az) + PI
	var fwd := Vector3(sin(a), 0.035, cos(a)).normalized()
	var right := fwd.cross(Vector3.UP).normalized()
	var up := right.cross(fwd)
	var t := tan(deg_to_rad(5.0))
	var c := Vector3.ZERO
	var p := _sky_params()
	for j in 8:
		for i in 8:
			var d := (fwd + right * ((i + 0.5) / 4.0 - 1.0) * t + up * ((j + 0.5) / 4.0 - 1.0) * t).normalized()
			var s := day_sky(d, p)
			var o: float = look.get("overcast", 0)
			if o > 0:
				s = s.lerp(Vector3(0.62, 0.65, 0.7), minf(0.95, o * 0.95))
			c += s / 64.0
	return Color(c.x, c.y, c.z) if c.x + c.y + c.z > 0 else HAZE

func _sky_params() -> Dictionary:
	var u := sky_mat
	return {turbidity = u.get_shader_parameter("turbidity"), rayleigh = u.get_shader_parameter("rayleigh"), mie = u.get_shader_parameter("mie_coefficient"),
		g = u.get_shader_parameter("mie_directional_g"), sun = u.get_shader_parameter("sun_position"), coverage = u.get_shader_parameter("cloud_coverage")}

## sky.gdshader's day_sky (Three's SkyShader) on the CPU.
static func day_sky(direction: Vector3, p: Dictionary) -> Vector3:
	const totalRayleigh := Vector3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5)
	const MieConst := Vector3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14)
	var sp: Vector3 = p.sun
	var sd := sp.normalized()
	var zc := clampf(sd.y, -1, 1)
	var vSunE := 1000.0 * maxf(0.0, 1.0 - pow(exp(1.0), -((1.6110731556870734 - acos(zc)) / 1.5)))
	var vSunfade := 1.0 - clampf(1.0 - exp(sp.y / 450000.0), 0, 1)
	var rc: float = p.rayleigh - (1.0 - vSunfade)
	var vBetaR := totalRayleigh * rc
	var vBetaM := 0.434 * (0.2 * p.turbidity) * 10E-18 * MieConst * p.mie
	var zenithAngle := acos(maxf(0.0, direction.y))
	var inverse := 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / PI), -1.253))
	var sR := 8.4E3 * inverse
	var sM := 1.25E3 * inverse
	var ex := -(vBetaR * sR + vBetaM * sM)
	var Fex := Vector3(exp(ex.x), exp(ex.y), exp(ex.z))
	var cosTheta := direction.dot(sd)
	var rPhase := 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0))
	var g: float = p.g
	var mPhase := 0.07957747154594767 * ((1.0 - g * g) / pow(1.0 - 2.0 * g * cosTheta + g * g, 1.5))
	var ratio := (vBetaR * rPhase + vBetaM * mPhase) / (vBetaR + vBetaM)
	var a := ratio * vSunE * (Vector3.ONE - Fex)
	var Lin := Vector3(pow(a.x, 1.5), pow(a.y, 1.5), pow(a.z, 1.5))
	var b := ratio * vSunE * Fex
	var k := clampf(pow(1.0 - sd.y, 5.0), 0, 1)
	Lin *= Vector3.ONE.lerp(Vector3(sqrt(b.x), sqrt(b.y), sqrt(b.z)), k)
	var L0 := Fex * 0.1
	var tex := (Lin + L0) * 0.04 + Vector3(0.0, 0.0003, 0.00075)
	var coverage: float = p.coverage
	if direction.y > 0.0 and coverage > 0.0: # the faint cirrus
		var cloud_uv := Vector2(direction.x, direction.z) / (direction.y * lerpf(1.0, 0.1, 0.5)) * 0.0002
		var cloud_noise := clampf(_fbm(cloud_uv * 1000.0) * 0.7 + 0.5, 0, 1)
		var region := _noise(cloud_uv * 300.0) * 0.37 + 0.5
		var cov := clampf(coverage + (region - 0.5) * 0.6, 0, 1)
		var threshold := 1.0 - cov
		var mask := smoothstep(threshold, threshold + 0.3, cloud_noise)
		var horizon_fade := smoothstep(0.0, 0.03 + 0.06 * 0.5, direction.y)
		mask *= horizon_fade
		var day_factor := smoothstep(-0.08, 0.3, sd.y)
		var sun_color := Fex * vSunE * 0.22 * 0.04
		var sky_ambient := Lin * 0.04 + Vector3(0.0, 0.0003, 0.00075)
		var depth := maxf(0.0, cloud_noise - threshold)
		var beer := exp(depth * -4.0)
		var powder := 1.0 - beer * beer
		var shade := lerpf(0.45, 1.0, clampf(beer * powder * 2.6, 0, 1))
		var silver := clampf(0.51 / pow(1.49 - cosTheta * 1.4, 1.5), 0, 3)
		var edge := mask * (1.0 - mask) * 4.0
		var cloud_color := sky_ambient + sun_color * shade
		cloud_color += sun_color * silver * edge * 0.6
		cloud_color *= maxf(day_factor, 0.03)
		var alpha := (1.0 - exp(depth * 0.4 * -12.0)) * horizon_fade
		tex -= L0 * 0.04 * alpha
		var cloud_aerial := tex.lerp(cloud_color, 1.0) * Fex + tex * (Vector3.ONE - Fex) # (mix(tex, cloud, Fex))
		tex = tex.lerp(cloud_aerial, alpha)
	return tex

static func _grad(i: Vector2) -> Vector2:
	var p := Vector3(fposmod(i.x * 0.1031, 1.0), fposmod(i.y * 0.1030, 1.0), fposmod(i.x * 0.0973, 1.0))
	var dd := p.dot(Vector3(p.y, p.z, p.x) + Vector3(33.33, 33.33, 33.33))
	p += Vector3(dd, dd, dd)
	return Vector2(fposmod((p.x + p.y) * p.z, 1.0), fposmod((p.x + p.z) * p.y, 1.0)) * 2.0 - Vector2.ONE

static func _noise(p: Vector2) -> float:
	var i := p.floor()
	var f := p - i
	var u := f * f * f * (f * (f * 6.0 - Vector2(15, 15)) + Vector2(10, 10))
	var a := _grad(i).dot(f)
	var b := _grad(i + Vector2(1, 0)).dot(f - Vector2(1, 0))
	var c := _grad(i + Vector2(0, 1)).dot(f - Vector2(0, 1))
	var d := _grad(i + Vector2(1, 1)).dot(f - Vector2(1, 1))
	return lerpf(lerpf(a, b, u.x), lerpf(c, d, u.x), u.y) * 1.6

static func _fbm(p: Vector2) -> float:
	var r := 0.0
	var amp := 1.0
	for i in 4:
		r += amp * _noise(p)
		amp *= 0.5
		p = p * 2.0
	return r

## A cloud's picture: soft puffs heaped up, the underside shaded (the JS's canvas, worked out pixel by pixel).
static func cloud_texture(seed: int) -> ImageTexture:
	var S := 256
	var alpha := PackedFloat32Array()
	alpha.resize(S * S)
	var st := [seed * 9301 + 49297]
	var rnd := func() -> float:
		st[0] = (st[0] * 9301 + 49297) % 233280
		return float(st[0]) / 233280.0
	for i in 34:
		var r: float = 26 + rnd.call() * 58
		var x: float = 128 + (rnd.call() - 0.5) * 150
		var y: float = 140 + (rnd.call() - 0.5) * 70 - r * 0.25
		# fillRect(x - r, y - r, 2r, 2r) with a radial gradient white 0.5 → 0, source-over
		for py in range(maxi(0, floori(y - r)), mini(S, ceili(y + r))):
			for px in range(maxi(0, floori(x - r)), mini(S, ceili(x + r))):
				var d := Vector2(px + 0.5 - x, py + 0.5 - y).length() / r
				if d >= 1:
					continue
				var a := 0.5 * (1 - d)
				var k := py * S + px
				alpha[k] = a + alpha[k] * (1 - a)
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for py in S:
		# shade the underside: source-atop, a linear gradient from clear at y 70 to rgba(140,150,168,0.65) at 220
		var ga := clampf((py + 0.5 - 70) / 150.0, 0, 1) * 0.65
		var col := Color(1, 1, 1).lerp(Color8(140, 150, 168), ga)
		for px in S:
			img.set_pixel(px, py, Color(col.r, col.g, col.b, alpha[py * S + px]))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)
