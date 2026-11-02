// The vignette (graphics.gd): the picture a little darker towards the corners. Drawn over everything as a quad
// that multiplies what's under it, before tone mapping as the JS's ShaderPass was (it ran before the OutputPass).
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;

uniform float strength = 0.35;

void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 1.0, 1.0); // (the quad's 1 x 1: the whole screen, at the near plane)
}

void fragment() {
	float v = smoothstep(0.8, 0.2, length(SCREEN_UV - 0.5) * 1.3);
	ALBEDO = vec3(mix(1.0 - strength, 1.0, v));
}
