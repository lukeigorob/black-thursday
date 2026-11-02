// A cloud (world.gd): Three's Sprite with a SpriteMaterial (unlit, its picture times its colour, faded by its
// opacity, in the scene's fog). Always facing you; its size is the node's scale.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D tex0 : source_color, filter_linear_mipmap;
uniform sampler2D tex1 : source_color, filter_linear_mipmap;
uniform sampler2D tex2 : source_color, filter_linear_mipmap;
uniform sampler2D tex3 : source_color, filter_linear_mipmap;
instance uniform int tex_index = 0;
instance uniform vec4 tint = vec4(1.0); // (rgb: its colour, linear and over 1 as Three's; a: its opacity)
global uniform vec3 fog_col;
global uniform float fog_dens;

void vertex() {
	// a sprite: the quad turned to face the camera, scaled as the node is
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
}

void fragment() {
	vec4 t = tex_index == 0 ? texture(tex0, UV) : tex_index == 1 ? texture(tex1, UV) : tex_index == 2 ? texture(tex2, UV) : texture(tex3, UV);
	ALBEDO = t.rgb * tint.rgb;
	ALPHA = t.a * tint.a;
	float d = length(VERTEX);
	FOG = vec4(fog_col, 1.0 - exp(-fog_dens * fog_dens * d * d)); // (FogExp2)
}
