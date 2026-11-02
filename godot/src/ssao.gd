extends RefCounted
# Screen-space ambient occlusion: the dark in the corners, under the shelves, round the ribs and
# where the crew stand against the walls. The JS worked it out itself at half resolution from the depth the
# scene pass had written (no second scene render), blurred it along edges, and laid it over the picture
# before tone mapping. Godot's own SSAO does the same job (half resolution from the depth prepass, an
# edge-keeping blur, before tone mapping), so this sets that up with the JS's settings instead of a pass of
# its own. Two deliberate differences: Godot's AO darkens the ambient light fully and the sun's light only in
# part (DIRECT, below; the JS darkened the whole picture), and it uses the scene's real normals rather than
# ones rebuilt from the depth.

## How much the AO darkens direct sunlight too (0: only the sky's light, as in life; 1: everything, as the JS).
const DIRECT := 0.5

var camera: Camera3D
var samples: int
var radius: float
var strength: float
var debug := false # (the JS's debug: the AO alone. Godot's own: Viewport.debug_draw = DEBUG_DRAW_SSAO)

## samples: 8 (medium) or 14 (high); radius in metres.
func _init(camera_: Camera3D, o := {}) -> void:
	camera = camera_
	samples = o.get("samples", 8)
	radius = o.get("radius", 0.45)
	strength = o.get("strength", 0.9)

## Turn it on in env (graphics.gd's), at this pass's settings.
func apply(env: Environment) -> void:
	env.ssao_enabled = true
	env.ssao_radius = radius
	# (the JS: ao = 1 - occlusion * 3.2, laid on at strength 0.9; Godot's intensity and power to match by eye)
	env.ssao_intensity = 2.0 * strength / 0.9
	env.ssao_power = 1.5
	env.ssao_detail = 0.5
	env.ssao_horizon = 0.08 # (the JS's 0.08: a surface's own grazing neighbours don't shade it)
	env.ssao_sharpness = 0.98
	env.ssao_light_affect = DIRECT * strength
	env.ssao_ao_channel_affect = 0.0
	# 8 samples → Godot's medium, 14 → high, at half resolution as the JS; faded out where its 0.45 m disc is
	# under two pixels across (past ~100 m at 1080p), as the JS stopped there
	var q := RenderingServer.ENV_SSAO_QUALITY_HIGH if samples > 10 else RenderingServer.ENV_SSAO_QUALITY_MEDIUM
	RenderingServer.environment_set_ssao_quality(q, true, 0.5, 2, 50.0, 105.0)
	if debug and camera:
		camera.get_viewport().debug_draw = Viewport.DEBUG_DRAW_SSAO

func dispose(env: Environment) -> void:
	env.ssao_enabled = false
