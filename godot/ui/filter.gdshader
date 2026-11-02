// CSS filters for the menus: the overlay's backdrop-filter (the battle behind, sepia, desaturated, darker, a
// touch more contrast) with its radial darkening and film grain, the loading slides' filter, the wounded blur
// (ui.hurt: the canvas's blur / brightness / saturate) and the red edges of a hit (box-shadow inset). On a
// ColorRect with from_screen, it filters what's behind; on a TextureRect, its own picture.
shader_type canvas_item;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform bool from_screen = true;
uniform float tex_alpha = 1.0; // 0: only what's laid over shows (the red edges on a bare ColorRect)
uniform float sepia = 0.0;
uniform float saturate = 1.0;
uniform float brightness = 1.0;
uniform float contrast = 1.0;
uniform float blur = 0.0; // px (CSS blur radius), done with the screen's mipmaps
// radial-gradient(rx ry at cx cy, c_in 0%, c_mid mid, c_out 100%) laid over (alpha in the colours)
uniform vec4 rad_in : source_color = vec4(0.0);
uniform vec4 rad_mid : source_color = vec4(0.0);
uniform vec4 rad_out : source_color = vec4(0.0);
uniform float rad_midpoint = 0.58;
uniform vec2 rad_r = vec2(1.2, 0.95);
uniform vec2 rad_at = vec2(0.5, 0.42);
uniform float grain = 0.0;
// box-shadow: inset 0 0 <edge_blur>px <edge_spread>px <edge_color>, faded by edge_k
uniform vec4 edge_color : source_color = vec4(0.0);
uniform float edge_blur = 0.0;
uniform float edge_spread = 0.0;
uniform float edge_k = 1.0;
uniform vec2 px_size = vec2(1920.0, 1080.0);

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void fragment() {
	vec4 c;
	if (from_screen) {
		float lod = blur > 0.0 ? log2(max(1.0, blur * 1.6)) : 0.0;
		c = textureLod(screen_tex, SCREEN_UV, lod);
		c.a = 1.0;
	} else {
		c = texture(TEXTURE, UV);
		c.a *= tex_alpha;
	}
	vec3 s = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131)));
	c.rgb = mix(c.rgb, min(s, 1.0), sepia);
	float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
	c.rgb = mix(vec3(l), c.rgb, saturate);
	c.rgb *= brightness;
	c.rgb = (c.rgb - 0.5) * contrast + 0.5;
	if (rad_out.a > 0.0 || rad_mid.a > 0.0 || rad_in.a > 0.0) {
		float d = length((UV - rad_at) / rad_r);
		vec4 g = d < rad_midpoint ? mix(rad_in, rad_mid, d / rad_midpoint) : mix(rad_mid, rad_out, clamp((d - rad_midpoint) / (1.0 - rad_midpoint), 0.0, 1.0));
		c.rgb = mix(c.rgb, g.rgb, g.a);
		if (!from_screen) c.a = max(c.a, g.a);
	}
	if (grain > 0.0) c.rgb *= 1.0 - grain * hash(floor(UV * px_size) + floor(TIME * 24.0) * 0.0);
	if (edge_color.a > 0.0) {
		vec2 p = UV * px_size;
		float e = min(min(p.x, px_size.x - p.x), min(p.y, px_size.y - p.y)); // px from the nearest edge
		float k = 1.0 - smoothstep(edge_spread - edge_blur * 0.5, edge_spread + edge_blur * 0.5, e);
		c.rgb = mix(c.rgb, edge_color.rgb, edge_color.a * k * edge_k);
		if (!from_screen) c.a = max(c.a, edge_color.a * k * edge_k);
	}
	COLOR = c;
}
