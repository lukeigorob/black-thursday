// Franconia in October from five miles up: farms of long strip fields (each strip its own crop: stubble,
// plough, pasture, winter wheat), woods, villages, all in world space so it never repeats where you can
// see; `scroll` slides it aft under the bombers. The ground falls away with the earth's curve.
shader_type spatial;
#include "res://noise.gdshaderinc"

uniform float scroll = 0.0;
varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec2 d = wpos.xz - CAMERA_POSITION_WORLD.xz;
	VERTEX.y -= dot(d, d) / (2.0 * 6371000.0);
}

vec3 crop(float h) {
	return h < 0.22 ? vec3(0.33, 0.38, 0.18)   // pasture
		: h < 0.45 ? vec3(0.55, 0.47, 0.30)    // stubble
		: h < 0.66 ? vec3(0.42, 0.32, 0.22)    // fresh plough
		: h < 0.84 ? vec3(0.40, 0.44, 0.22)    // winter wheat coming up
		: vec3(0.62, 0.55, 0.40);              // pale stubble
}

void fragment() {
	vec2 p = wpos.xz - vec2(0.0, scroll);
	float dist = length(wpos.xz - CAMERA_POSITION_WORLD.xz);
	float far = smoothstep(12000.0, 50000.0, dist);
	float edge;
	vec2 id = cell(p / 700.0, edge);           // a village's fields, all strips running one way
	float a = hash(id) * 3.14159;
	vec2 dir = vec2(cos(a), sin(a));
	float w = mix(28.0, 60.0, hash(id + 7.0));
	float along = dot(p, dir);
	float strip = floor(along / w);
	float h = hash(vec2(strip, hash(id * 3.0) * 97.0));
	vec3 c = crop(h) * (0.88 + 0.24 * hash(vec2(strip, 5.0) + id));
	float seam = smoothstep(0.0, 0.08, fract(along / w)) * smoothstep(1.0, 0.92, fract(along / w));
	float fine = smoothstep(4000.0, 9000.0, dist); // (past this a strip's under a pixel: show their mix)
	c = mix(c * mix(0.85, 1.0, seam), mix(crop(0.5), crop(0.2), 0.4), fine * 0.7);
	c = mix(c * 0.8, c, mix(smoothstep(0.0, 0.04, edge), 1.0, far)); // the lanes between
	float wood = smoothstep(0.55, 0.59, fbm(p / 4200.0));
	c = mix(c, vec3(0.12, 0.17, 0.09) * (0.8 + 0.4 * noise(p / 60.0)), wood);
	vec2 vc = floor(p / 2200.0);
	float village = step(0.93, hash(vc * 1.3)) * smoothstep(260.0, 120.0, length(fract(p / 2200.0) * 2200.0 - 1100.0 - (hash2(vc) - 0.5) * 800.0));
	c = mix(c, vec3(0.50, 0.38, 0.34) * (0.8 + 0.4 * noise(p / 25.0)), village * 0.85);
	c = mix(c, vec3(0.40, 0.40, 0.26), far * 0.5);
	ALBEDO = c * 0.6;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}
