// Scattered cumulus a few thousand metres below the formation, lit from above, drifting aft with the ground.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;
#include "res://noise.gdshaderinc"

uniform float scroll = 0.0;
varying vec3 wpos;

void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec2 p = wpos.xz - vec2(0.0, scroll * 1.05);
	float n = fbm(p / 2600.0) * 0.7 + fbm(p / 650.0) * 0.3;
	float a = smoothstep(0.53, 0.64, n);
	a *= 1.0 - smoothstep(35000.0, 75000.0, length(wpos.xz - CAMERA_POSITION_WORLD.xz)); // (no edge to the layer)
	float tops = smoothstep(0.52, 0.75, n); // the thick middles are brightest, the thin edges greyer
	ALBEDO = mix(vec3(0.72, 0.75, 0.80), vec3(1.0, 0.99, 0.97), tops) * 1.15;
	ALPHA = a * 0.92;
}
