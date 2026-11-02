// Rain round the camera (environment.gd Rain): each streak a line, moved entirely here.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform float u_time;
uniform float u_box;
uniform float u_speed;
uniform float u_exclude;
uniform float u_density = 1.0;
uniform vec3 u_cam;
uniform mat4 u_inv;
uniform vec3 u_color = vec3(0.55, 0.6, 0.66);
varying float v_a;

void vertex() {
	float id = float(VERTEX_ID / 2);
	float a_end = UV.x;
	vec3 flow = vec3(0.0, -9.0, u_speed); // falling, and the air streaming past aft
	vec3 p = VERTEX + flow * u_time;
	p = mod(p - u_cam + u_box, 2.0 * u_box) - u_box + u_cam; // wrapped round the camera
	vec3 dir = normalize(flow);
	p -= dir * a_end * (1.6 + fract(id * 0.618) * 1.4); // a streak, as the eye sees a drop at speed
	vec3 local = (u_inv * vec4(p, 1.0)).xyz; // inside your own fuselage: not drawn
	bool inside = u_exclude > 0.5 && abs(local.x) < 1.7 && local.y > -2.9 && local.y < 1.9 && local.z > -11.8 && local.z < 11.6;
	v_a = (inside || fract(id * 0.7548) > u_density) ? 0.0 : (1.0 - smoothstep(u_box * 0.6, u_box, length(p - u_cam))) * (a_end > 0.5 ? 0.1 : 0.55);
	POSITION = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(p, 1.0));
}

void fragment() {
	if (v_a <= 0.001) discard;
	ALBEDO = u_color;
	ALPHA = v_a;
}
