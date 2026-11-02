// A tracer round or a muzzle flash: glowing, added on top of what's behind it (the bloom does the rest).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

uniform float brightness = 2.5;
varying vec4 tint;

void vertex() { tint = COLOR; }

void fragment() { ALBEDO = tint.rgb * brightness; }
