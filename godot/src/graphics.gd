extends RefCounted
# Renderer, post-processing (bloom, vignette, ACES tone mapping) and the Low / Medium / High setting.
# Godot draws the frame itself; what the JS built as an EffectComposer chain is Godot's own Environment effects
# here (glow for the bloom, its ACES tone mapping, its SSAO: ssao.gd), plus the vignette as a quad over the picture.

const Store := preload("res://src/core/store.gd")
const SSAOPass := preload("res://src/ssao.gd")

const QUALITY := {
	low = {label = "Low", pixelRatio = 1, shadows = 0, clouds = 60, bloom = false, msaa = 0, ao = 0, dust = false, detail = false},
	medium = {label = "Medium", pixelRatio = 1.25, shadows = 2048, clouds = 140, bloom = true, msaa = 4, ao = 8, dust = true, detail = true},
	high = {label = "High", pixelRatio = 2, shadows = 4096, clouds = 260, bloom = true, msaa = 4, ao = 14, dust = true, detail = true},
}
const KEY := "bomber.quality"

# Three's ACESFilmicToneMapping scales by exposure / 0.6 and clips at 1; Godot's ACES scales by 1.8 and
# divides by its white point's tone-mapped value. With white at the curve's own clipping point (where the RRT/ODT
# fit reaches 1) the two curves are the same, Three's exposure e being Godot's e / (0.6 * 1.8).
const ACES_WHITE := 14.26 # (25.67 / 1.8: the fit (v(v + 0.0245786) - 0.000090537) / (v(0.983729v + 0.432951) + 0.238081) = 1)
const EXPOSURE_K := 1.0 / (0.6 * 1.8)

## What the JS called the renderer: the scene's Environment (the sky, fog and light are world.gd's; tone mapping,
## glow and SSAO are set here) and the viewport it draws to. `tone_mapping_exposure` is Three's toneMappingExposure.
class Renderer:
	var environment := Environment.new()
	var viewport: Viewport
	var tone_mapping_exposure: float:
		get: return environment.tonemap_exposure / EXPOSURE_K
		set(v): environment.tonemap_exposure = v * EXPOSURE_K

# A cockpit 30 cm away and bombers 3 km away need a lot of depth precision: Godot's depth buffer is
# reversed float already (the JS asked for it, or fell back to a slower logarithmic one).
var renderer := Renderer.new()
var reversed := true
var quality_name := "medium"
var listeners: Array[Callable] = []
var scene: Node3D
var camera: Camera3D
var ssao = null
var bloom := false
var vignette: MeshInstance3D
var world_env: WorldEnvironment

func _init() -> void:
	var e := renderer.environment
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.tonemap_white = ACES_WHITE
	renderer.tone_mapping_exposure = 0.55
	var tree := Engine.get_main_loop() as SceneTree
	if tree:
		renderer.viewport = tree.root
	var saved = Store.get_item(KEY)
	quality_name = saved if saved is String and QUALITY.has(saved) else "medium"

var quality: Dictionary:
	get: return QUALITY[quality_name]

## Call once the scene and camera exist; sets up the effects for the quality level.
func setup(scene_: Node3D, camera_: Camera3D) -> void:
	scene = scene_
	camera = camera_
	if renderer.viewport == null:
		renderer.viewport = scene.get_viewport()
	world_env = WorldEnvironment.new()
	world_env.name = "environment"
	world_env.environment = renderer.environment
	scene.add_child(world_env)
	# the vignette: a quad over the whole picture (on the camera, so it's never culled away)
	var q := QuadMesh.new()
	var m := ShaderMaterial.new()
	m.shader = load("res://src/shaders/vignette.gdshader")
	m.render_priority = Material.RENDER_PRIORITY_MAX
	q.material = m
	vignette = MeshInstance3D.new()
	vignette.name = "vignette"
	vignette.mesh = q
	vignette.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	vignette.extra_cull_margin = 16384
	vignette.position = Vector3(0, 0, -1)
	camera.add_child(vignette)
	set_quality(quality_name)

func set_quality(name: String) -> void:
	quality_name = name
	Store.set_item(KEY, name)
	var q := quality
	var vp := renderer.viewport
	var e := renderer.environment
	if vp:
		# (pixelRatio: Three drew at min(devicePixelRatio, it); Godot draws at the window's pixels, so the same
		# is a 3D scale of that over the screen's own scale)
		var dpr := maxf(1.0, DisplayServer.screen_get_scale())
		vp.scaling_3d_scale = minf(dpr, q.pixelRatio) / dpr
		vp.msaa_3d = Viewport.MSAA_4X if q.msaa >= 4 else Viewport.MSAA_2X if q.msaa >= 2 else Viewport.MSAA_DISABLED
		# (a broken pixel (NaN) can't spread through Godot's glow as it did through the JS's bloom: its
		# luminance cap below does the sanitize pass's clamp)
	# ambient occlusion (Godot's SSAO: ssao.gd)
	if ssao:
		ssao.dispose(e)
	ssao = SSAOPass.new(camera, {samples = q.ao}) if q.ao else null
	if ssao:
		ssao.apply(e)
	bloom = q.bloom
	if q.bloom:
		# threshold is above the bright horizon sky, so only the sun, tracers and fire glow (the JS's
		# UnrealBloomPass: strength 0.4, radius 0.4, threshold 20, its five blurs weighted as it weighed them)
		e.glow_enabled = true
		e.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
		e.glow_intensity = 0.4
		e.glow_strength = 1.0
		e.glow_bloom = 0.0
		e.glow_hdr_threshold = 20.0
		e.glow_hdr_scale = 2.0
		e.glow_hdr_luminance_cap = 1000.0
		e.glow_normalized = false
		var w := [0.68, 0.64, 0.6, 0.56, 0.52, 0.0, 0.0]
		for i in 7:
			e.set_glow_level(i, w[i])
	else:
		e.glow_enabled = false
	for fn in listeners:
		fn.call(q)

func on_quality_change(fn: Callable) -> void:
	listeners.append(fn)

## (Godot keeps the drawing size and the camera's aspect with the window itself.)
func resize() -> void:
	pass

## (Godot draws the frame itself.)
func render() -> void:
	pass
