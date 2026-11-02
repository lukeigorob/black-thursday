// The menus' painted surfaces, what menus.css draws with gradients, clip-paths and grain: a box filled with a
// CSS-style linear gradient (up to four stops at an angle), its corners rounded (border-radius) or the top-left
// and bottom-right cut off (the buttons' clip-path chamfer), inset rings (box-shadow: inset 0 0 0 Npx), a top
// highlight line, film grain multiplied in, and a radial darkening (the paper's edges). ui/box.gd sets it up.
shader_type canvas_item;

uniform vec2 size = vec2(100.0);
uniform float cut = 0.0;
uniform float radius = 0.0;
uniform float angle = 180.0; // CSS degrees: 180 = top to bottom
uniform int n = 2;
uniform vec4 c0 : source_color = vec4(1.0);
uniform vec4 c1 : source_color = vec4(1.0);
uniform vec4 c2 : source_color = vec4(1.0);
uniform vec4 c3 : source_color = vec4(1.0);
uniform vec4 stops = vec4(0.0, 1.0, 1.0, 1.0);
uniform float ring1 = 0.0;
uniform vec4 ring1_color : source_color = vec4(0.0);
uniform float ring2 = 0.0; // a second ring inside the first (the conditions panel's double frame)
uniform float ring2_gap = 0.0;
uniform vec4 ring2_color : source_color = vec4(0.0);
uniform vec4 top_color : source_color = vec4(0.0); // inset 0 1px 0: a one-pixel line along the top
uniform vec4 bottom_color : source_color = vec4(0.0); // inset 0 -2px 0
uniform float grain = 0.0;
uniform float grain_scale = 1.0;
uniform vec4 vignette : source_color = vec4(0.0); // radial-gradient(130% 120% at 50% 40%, transparent 55%, this 100%)
uniform vec2 vignette_r = vec2(1.3, 1.2);
uniform vec2 vignette_at = vec2(0.5, 0.4);
uniform float vignette_from = 0.55;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// signed distance to the box's edge, in pixels (negative inside)
float box_sd(vec2 p) {
	vec2 h = size * 0.5;
	vec2 q = abs(p - h) - h + vec2(radius);
	float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
	if (cut > 0.0) {
		// the chamfers: the line x + y = cut at the top left, and its mirror at the bottom right
		float tl = (cut - (p.x + p.y)) * 0.70710678;
		float br = (cut - ((size.x - p.x) + (size.y - p.y))) * 0.70710678;
		d = max(d, max(tl, br));
	}
	return d;
}

vec4 grad(float t) {
	if (n <= 1) return c0;
	vec4 c = c0;
	c = mix(c, c1, clamp((t - stops.x) / max(1e-4, stops.y - stops.x), 0.0, 1.0));
	if (n > 2) c = mix(c, c2, clamp((t - stops.y) / max(1e-4, stops.z - stops.y), 0.0, 1.0));
	if (n > 3) c = mix(c, c3, clamp((t - stops.z) / max(1e-4, stops.w - stops.z), 0.0, 1.0));
	return c;
}

void fragment() {
	vec2 p = UV * size;
	float d = box_sd(p);
	float a = 1.0 - clamp(d + 0.5, 0.0, 1.0);
	if (a <= 0.0) discard;
	float r = radians(angle);
	vec2 dir = vec2(sin(r), -cos(r));
	float len = abs(size.x * dir.x) + abs(size.y * dir.y);
	float t = dot(p - size * 0.5, dir) / max(1.0, len) + 0.5;
	vec4 col = grad(clamp(t, 0.0, 1.0));
	if (vignette.a > 0.0) {
		float v = length((UV - vignette_at) / vignette_r);
		col.rgb = mix(col.rgb, vignette.rgb, vignette.a * smoothstep(vignette_from, 1.0, v));
	}
	if (grain > 0.0) {
		float g = noise(p * 0.8 / grain_scale) * 0.6 + noise(p * 1.9 / grain_scale) * 0.4;
		col.rgb *= 1.0 - grain * g;
	}
	if (top_color.a > 0.0 && p.y < 1.0 && d < -1.0) col.rgb = mix(col.rgb, top_color.rgb, top_color.a);
	if (bottom_color.a > 0.0 && p.y > size.y - 2.0 && d < -1.0) col.rgb = mix(col.rgb, bottom_color.rgb, bottom_color.a);
	if (ring2 > 0.0 && -d > ring2_gap && -d < ring2_gap + ring2) col = vec4(mix(col.rgb, ring2_color.rgb, ring2_color.a), max(col.a, ring2_color.a));
	if (ring1 > 0.0 && -d < ring1) col = vec4(mix(col.rgb, ring1_color.rgb, ring1_color.a), max(col.a, ring1_color.a));
	COLOR = vec4(col.rgb, col.a * a);
}
