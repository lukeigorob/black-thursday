extends RefCounted
# Dust in the cabin air: tiny motes drifting round you that only show where the sun falls on them.
# Each mote is lit by the real sun and its shadow map (the hull's shadow), facing the sun, with no
# sky light at all, so the ones in the shade vanish and the beams through the windows and gun
# hatches fill with slowly turning specks.
# (Godot: a MultiMesh of billboards; the shader puts each one's vertex at the mote's centre, so the shadow
# is looked up there, and its corners out on screen.)

const Canvas2D := preload("res://src/core/canvas2d.gd")
const Geo := preload("res://src/core/geo.gd")

const COUNT := 700
const RANGE := 2.6 # motes, and how far round your eye they float (m)

static func dot() -> Texture2D:
	var c := Canvas2D.new(32, 32)
	var r = c.create_radial_gradient(16, 16, 0, 16, 16, 16)
	r.add_color_stop(0, "rgba(255,255,255,1)"); r.add_color_stop(0.35, "rgba(255,255,255,0.45)"); r.add_color_stop(1, "rgba(255,255,255,0)")
	c.fill_style = r; c.fill_rect(0, 0, 32, 32)
	return c.texture()

const SHADER := """
shader_type spatial;
render_mode blend_add, depth_draw_never, cull_disabled, skip_vertex_transform, diffuse_lambert, specular_disabled;
uniform sampler2D map : source_color;
uniform vec3 u_sun = vec3(0.0, 1.0, 0.0);
uniform float u_size = 0.011;
uniform vec3 color = vec3(4.0, 3.7, 3.2); // (bright: a speck in the sun glints)
uniform float opacity = 0.8;
void vertex() {
	vec4 mv = MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0);
	vec3 corner = mv.xyz;
	corner.xy += VERTEX.xy * u_size * smoothstep(0.45, 1.1, -mv.z); // a billboard (none right at your eye: they'd be big blurry orbs)
	POSITION = PROJECTION_MATRIX * vec4(corner, 1.0);
	VERTEX = mv.xyz; // (the shadow is looked up at its centre)
	NORMAL = normalize((MODELVIEW_MATRIX * vec4(u_sun, 0.0)).xyz); // (it faces the sun: lit fully or not at all)
}
void fragment() {
	vec4 t = texture(map, UV);
	ALBEDO = color * t.rgb * t.a * opacity;
	AO = 0.0; // (no sky light at all)
	AO_LIGHT_AFFECT = 0.0;
}
"""

var it
var mesh: MultiMeshInstance3D
var mat: ShaderMaterial
var pos := PackedVector3Array()
var vel := PackedVector3Array()
var phase := PackedFloat32Array()
var t := 0.0
var placed := false

func _init(interior) -> void:
	it = interior
	mat = ShaderMaterial.new()
	mat.shader = Shader.new()
	mat.shader.code = SHADER
	mat.set_shader_parameter("map", dot())
	mat.render_priority = 3
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = Geo.plane(1, 1).to_mesh(mat)
	mm.instance_count = COUNT
	mm.custom_aabb = AABB(Vector3(-20, -20, -20), Vector3(40, 40, 40))
	mesh = MultiMeshInstance3D.new()
	mesh.multimesh = mm
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF # (receiving it is what makes the beams)
	mesh.extra_cull_margin = 16384 # (never culled: they're all round you)
	mesh.set_meta("noCut", true)
	interior.group.add_child(mesh)
	pos.resize(COUNT)
	vel.resize(COUNT)
	phase.resize(COUNT)
	for i in COUNT:
		phase[i] = randf() * 6.3

## A fresh mote somewhere round the eye, inside the hull.
func spawn(i: int, eye: Vector3) -> void:
	for k in 6:
		var x := eye.x + (randf() * 2 - 1) * RANGE
		var y := eye.y + (randf() * 2 - 1) * RANGE * 0.6
		var z := eye.z + (randf() * 2 - 1) * RANGE
		if absf(x) < it.hw(z, y) - 0.05:
			pos[i] = Vector3(x, y, z)
			break
		pos[i] = Vector3(eye.x, eye.y, eye.z + 50) # (nowhere found: out of sight)
	vel[i] = Vector3((randf() - 0.5) * 0.03, (randf() - 0.5) * 0.02, (randf() - 0.5) * 0.03 + 0.01)

## camera: the eye; sun_local: the direction to the sun in bomber space; on: the quality setting.
func update(dt: float, camera: Node3D, sun_local: Vector3, on: bool) -> void:
	mesh.visible = on
	if not on:
		return
	t += dt
	mat.set_shader_parameter("u_sun", sun_local.normalized())
	var eye: Vector3 = it.group.global_transform.affine_inverse() * camera.global_position
	var mm := mesh.multimesh
	for i in COUNT:
		if not placed:
			spawn(i, eye)
		# a slow drift and swirl in the draughts from the gun windows
		var w := phase[i] + t * 0.4
		var v := vel[i]
		var p := pos[i] + Vector3(v.x + sin(w) * 0.01, v.y + cos(w * 1.3) * 0.006, v.z + sin(w * 0.7) * 0.01) * dt
		pos[i] = p
		var d := p - eye
		if d.x * d.x + d.z * d.z > RANGE * RANGE or absf(d.y) > RANGE * 0.6 or absf(p.x) > it.hw(p.z, p.y):
			spawn(i, eye)
		mm.set_instance_transform(i, Transform3D(Basis.IDENTITY, pos[i]))
	placed = true
