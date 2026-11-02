// The B-17's skin: the glTF material (base colour, metal / roughness, normal map) as StandardMaterial3D
// draws it, plus what the web game added to its materials in onBeforeCompile, each switched on by a
// define that models.gd puts in front of this code (one compiled variant a combination):
//  WINDOWS   models.js windowCutout: the base colour's alpha under 95% is an open cut-out (the shadow too)
//  BALL      models.js steelBall: the Sperry ball, worn aluminium framing round dark glass panes
//  SCARS     scars.js: bullet and cannon holes, flaked paint, soot, and the exhaust stains behind each cowling
//  CUT       breakup.js: a region cut away (or kept), the torn edge ragged, charred and glowing
//  CULL_BACK the glTF material is single-sided (the rest are double-sided, as the B-17's are)
shader_type spatial;
//DEFINES
#if defined(BALL) && defined(CULL_BACK)
render_mode cull_back, depth_prepass_alpha;
#elif defined(BALL)
render_mode cull_disabled, depth_prepass_alpha;
#elif defined(CULL_BACK)
render_mode cull_back, depth_draw_opaque;
#else
render_mode cull_disabled, depth_draw_opaque;
#endif

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D tex_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_albedo = false;
uniform float metallic = 0.0;
uniform float roughness = 1.0;
uniform sampler2D tex_metallic : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec4 metallic_channel = vec4(0.0, 0.0, 1.0, 0.0);
uniform sampler2D tex_roughness : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec4 roughness_channel = vec4(0.0, 1.0, 0.0, 0.0);
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_normal = false;
uniform float normal_scale = 1.0;
uniform vec3 emission_color : source_color = vec3(0.0);
uniform float emission_energy = 0.0;

#if defined(SCARS) || defined(CUT)
float sh1(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(sh1(i), sh1(i + vec3(1,0,0)), f.x), mix(sh1(i + vec3(0,1,0)), sh1(i + vec3(1,1,0)), f.x), f.y),
		mix(mix(sh1(i + vec3(0,0,1)), sh1(i + vec3(1,0,1)), f.x), mix(sh1(i + vec3(0,1,1)), sh1(i + vec3(1,1,1)), f.x), f.y), f.z); }
#endif

#ifdef SCARS
// (bomber space: the web game baked it into a vertex attribute; here it's worked out from the bomber's own
// frame, set each frame by scars.gd, so a turret that's turned carries its holes round with it)
uniform mat4 bomber_inv;
uniform vec4 hits[32]; // xyz, w = radius (0: none)
uniform float scar_on = 1.0; // the quality setting: 0 turns it all off
varying vec3 v_bp;
#endif

#ifdef CUT
uniform vec3 cut_min[4];
uniform vec3 cut_max[4];
uniform int cut_n = 0;
uniform float cut_keep = 0.0; // 1 draws only inside the boxes (a piece), 0 draws only outside (what's left)
uniform mat4 cut_inv;
uniform float cut_t = 0.0;
varying vec3 v_cut_p;
// signed distance (m) into the cut region (> 0 inside), the boundary ragged like torn metal
float cut_dist(vec3 p) {
	float best = -1e3;
	for (int i = 0; i < 4; i++) {
		if (i >= cut_n) break;
		vec3 d = min(p - cut_min[i], cut_max[i] - p);
		best = max(best, min(min(d.x, d.y), d.z));
	}
	return best + (sn3(p * 5.0) - 0.5) * 0.35 + (sn3(p * 23.0) - 0.5) * 0.08;
}
#endif

void vertex() {
#ifdef SCARS
	v_bp = (bomber_inv * MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
#endif
#ifdef CUT
	v_cut_p = (cut_inv * MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
#endif
}

void fragment() {
	vec4 texel = has_albedo ? texture(tex_albedo, UV) : vec4(1.0);
	vec3 col = albedo.rgb * texel.rgb;
	float rough = roughness * dot(texture(tex_roughness, UV), roughness_channel);
	float metal = metallic * dot(texture(tex_metallic, UV), metallic_channel);
#ifdef WINDOWS
	// (a mip level near the full-size texture's, also in the shadow pass: seen small, as from the sun, the
	// windows' alpha would be averaged in with the skin's round them and no window cut out of the shadow)
	vec2 px = UV * vec2(textureSize(tex_albedo, 0));
	float lod = clamp(log2(max(length(dFdx(px)), length(dFdy(px)))), 0.0, 1.5);
	if (textureLod(tex_albedo, UV, lod).a < 0.95) discard;
#endif
#ifdef BALL
	// metal: aluminium with the texture's panel lines and a little wear; glass: dark, a bit see-through
	float detail = dot(texel.rgb, vec3(0.3, 0.55, 0.15));
	float pane = texel.a < 0.95 ? 1.0 : 0.0;
	col = mix(albedo.rgb * (0.6 + 0.5 * detail), vec3(0.025, 0.03, 0.035), pane);
	ALPHA = mix(1.0, 0.86, pane); // (the ball is empty inside: much more see-through and the sky shows through it)
	rough = mix(rough, 0.04, pane);
	metal = mix(metal, 0.0, pane);
#endif
#ifdef CUT
	float cut_d = cut_dist(v_cut_p);
	if (cut_keep > 0.5 ? cut_d < 0.0 : cut_d > 0.0) discard;
	float cut_edge = 1.0 - smoothstep(0.0, 0.45, abs(cut_d));
	col *= mix(1.0, 0.12, cut_edge); // scorched round the tear
	if (!FRONT_FACING) col *= 0.18; // the inside of the skin
	// the torn edge glows where it's still burning, flickering
	float glow = (1.0 - smoothstep(0.0, 0.12, abs(cut_d))) * (0.5 + 0.5 * sn3(v_cut_p * 9.0 + vec3(0.0, cut_t * 3.0, 0.0)));
	EMISSION += vec3(4.0, 1.4, 0.3) * glow * max(0.0, 1.0 - cut_t / 40.0);
#endif
#ifdef SCARS
	float scar_rough = 0.0;
	if (scar_on > 0.5) {
		// exhaust: soot streaming back from each cowling over the nacelle and the wing behind
		for (int e = 0; e < 4; e++) {
			vec3 q = v_bp - vec3(e == 0 ? -7.16 : e == 1 ? -3.93 : e == 2 ? 3.94 : 7.15, -0.85, -7.4);
			float along = smoothstep(-0.3, 0.4, q.z) * (1.0 - smoothstep(1.0, 5.2, q.z));
			float across = exp(-q.x * q.x / max(0.22 + 0.06 * q.z, 0.15)) * smoothstep(-1.0, -0.75, q.y) * (1.0 - smoothstep(0.25, 0.75, q.y)); // (the nacelle's belly and sides, not its top)
			float streak = 0.6 + 0.4 * sn3(vec3(q.x * 14.0, q.y * 14.0, q.z * 1.2));
			float s = along * across * streak;
			col = mix(col, vec3(0.035, 0.032, 0.03), s * 0.75); scar_rough += s * 0.2;
		}
		// the hits
		for (int i = 0; i < 32; i++) {
			vec4 h = hits[i];
			if (h.w <= 0.0) continue;
			vec3 d = v_bp - h.xyz;
			float l = length(d);
			if (l > h.w * 4.0) continue;
			float rag = sn3(v_bp * 90.0) * 0.5 + sn3(v_bp * 23.0) * 0.5;
			float hole = 1.0 - smoothstep(h.w * (0.18 + 0.2 * rag), h.w * (0.26 + 0.2 * rag), l);
			float flake = (1.0 - smoothstep(h.w * (0.4 + 0.5 * rag), h.w * (0.55 + 0.6 * rag), l)) * (1.0 - hole);
			// soot blown back along the fuselage (+z) from the hole, streaky
			float back = clamp(d.z / (h.w * 3.5), 0.0, 1.0);
			float soot = exp(-(d.x * d.x + d.y * d.y) / (h.w * h.w * (0.5 + 2.0 * back))) * step(-h.w * 0.6, d.z) * (1.0 - smoothstep(h.w, h.w * 3.5, d.z)) * (0.55 + 0.45 * sn3(v_bp * 30.0));
			soot = max(soot, 1.0 - smoothstep(h.w * 0.3, h.w * 1.3, l)) * (1.0 - hole);
			col = mix(col, vec3(0.62, 0.63, 0.6), flake * 0.85); // bare aluminium
			col = mix(col, vec3(0.03, 0.028, 0.025), soot * 0.8);
			col = mix(col, vec3(0.005), hole); // the hole itself
			scar_rough += soot * 0.3 - flake * 0.25;
		}
	}
	rough = clamp(rough + scar_rough, 0.0, 1.0);
#endif
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	EMISSION += emission_color * emission_energy;
	if (has_normal) {
		NORMAL_MAP = texture(tex_normal, UV).rgb;
		NORMAL_MAP_DEPTH = normal_scale;
	}
}
