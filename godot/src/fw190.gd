extends RefCounted
# The Focke-Wulf Fw 190 A-8, built in code (no model file): the BMW 801's big round cowling with its
# cooling fan, the spinner with its white spiral and a broad three-bladed VDM propeller, the low wing
# with its wide-track undercarriage doors, the bubble canopy, the two MG 131s over the engine and the
# four MG 151/20s in the wings. Painted in the 1944 day-fighter scheme by a shader: RLM 74/75 grey
# splinter on top, RLM 76 below with mottled sides, black-and-white Balkenkreuze, a yellow
# Reichsverteidigung band round the rear fuselage and the yellow under-cowl. Same frame as the
# other fighters: nose -Z, the prop's axis at y = 0, metres.

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")

# the fuselage's sections: [z, half-width, half-height, centre height]
const BODY := [
	[-4.02, 0.5, 0.5, 0], [-3.96, 0.6, 0.6, 0], [-3.6, 0.645, 0.645, 0], [-3.0, 0.645, 0.65, 0.0], [-2.5, 0.6, 0.66, 0.02],
	[-1.8, 0.53, 0.67, 0.07], [-1.0, 0.48, 0.66, 0.1], [-0.2, 0.46, 0.63, 0.1], [0.7, 0.42, 0.58, 0.07], [1.6, 0.36, 0.52, 0.06],
	[2.5, 0.29, 0.45, 0.07], [3.3, 0.22, 0.37, 0.1], [4.0, 0.14, 0.27, 0.13], [4.4, 0.06, 0.15, 0.15], [4.55, 0.01, 0.03, 0.16],
]

## A loft through elliptical sections (seg points round each).
static func loft(rings: Array, seg: int):
	var pos := PackedFloat64Array()
	var idx := PackedInt32Array()
	for r in rings:
		for k in seg + 1:
			var a := (float(k) / seg) * TAU
			pos.append(cos(a) * r[1]); pos.append(r[3] + sin(a) * r[2]); pos.append(r[0])
	for r in rings.size() - 1:
		for k in seg:
			var a := r * (seg + 1) + k
			var b := a + seg + 1
			idx.append_array([a, a + 1, b, a + 1, b + 1, b])
	var g = Geo.from_arrays(pos, null, null, idx)
	g.compute_vertex_normals()
	return g

## A flat outline (points in its own x/y) given thickness, then placed: for the wings and the tail.
static func slab(points: Array, thick: float, bevel := 0.02):
	var shape := Shapes.Shape.new(points.map(func(p): return Vector2(p[0], p[1])))
	var g = Geo.extrude(shape, {depth = thick, bevelEnabled = true, bevelThickness = bevel, bevelSize = bevel, bevelSegments = 2, curveSegments = 6})
	return g.translate(0, 0, -thick / 2)

## The wing's planform (right side, x out, z aft) with a rounded tip: laid flat, a little dihedral.
static func wing(side: int, lod: bool):
	var pts := [[0.42, -1.78], [2.6, -1.42], [4.6, -1.08], [5.08, -0.96], [5.28, -0.78], [5.33, -0.5], [5.22, -0.26], [4.8, -0.18], [2.6, 0.12], [0.42, 0.46]]
	# (x, z) -> shape (x, -z) so the extrusion is along +y once turned
	var g = slab(pts.map(func(p): return [p[0], -p[1]]), 0.15, 0.0 if lod else 0.03).rotate_x(-PI / 2)
	# thinner towards the tip, and the dihedral
	var p: PackedVector3Array = g.positions
	var dih := tan(deg_to_rad(5.5))
	for i in p.size():
		var x: float = p[i].x
		var t := (x - 0.42) / 4.9
		p[i].y = p[i].y * (1 - 0.55 * t) + x * dih
	g.positions = p
	g.compute_vertex_normals()
	if side < 0:
		g.scale(-1, 1, 1)
		flip(g)
	return g.translate(0, -0.47, 0)

## Mirrored geometry turns inside out: put its faces back the right way round.
static func flip(g) -> void:
	if not g.indices.is_empty():
		var a: PackedInt32Array = g.indices
		for i in range(0, a.size(), 3):
			var s := a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = s
		g.indices = a
	else:
		var p: PackedVector3Array = g.positions
		var n: PackedVector3Array = g.normals
		var uv: PackedVector2Array = g.uvs
		for i in range(0, p.size(), 3):
			var s := p[i + 1]; p[i + 1] = p[i + 2]; p[i + 2] = s
			if not n.is_empty():
				s = n[i + 1]; n[i + 1] = n[i + 2]; n[i + 2] = s
			if not uv.is_empty():
				var u := uv[i + 1]; uv[i + 1] = uv[i + 2]; uv[i + 2] = u
		g.positions = p; g.normals = n; g.uvs = uv
	g.compute_vertex_normals()

# The camouflage, the markings and the yellow, worked out per pixel from where it is on the plane.
# (The JS patched these into a MeshStandardMaterial with onBeforeCompile; here it's a spatial shader doing the
# same: the colours are the same linear values, the roughness and metalness the material's.)
const PAINT_COMMON := """
shader_type spatial;
uniform float roughness = 0.62;
uniform float metalness = 0.15;
varying vec3 vObj;
varying vec3 vObjN;
void vertex() { vObj = VERTEX; vObjN = NORMAL; }
// a Balkenkreuz: 0 nothing, 1 the white outline, 2 the black cross (p in the plane of the marking)
float cross2(vec2 p, float s) {
	vec2 a = abs(p);
	float arm = max(a.x, a.y), w = min(a.x, a.y);
	if (arm < s && w < s * 0.2) return 2.0;
	if (arm < s * 1.05 && w < s * 0.33) return 1.0;
	return 0.0;
}
"""
const PAINT_BODY := """
void fragment() {
	vec3 p = vObj, n = normalize(vObjN);
	vec3 c74 = vec3(0.034, 0.041, 0.045), c75 = vec3(0.078, 0.074, 0.094), c76 = vec3(0.27, 0.33, 0.37), yel = vec3(0.8, 0.5, 0.02);
	// the splinter pattern: straight-edged patches, shuffled so they don't make a chequerboard
	vec2 cell = floor(vec2(p.x * 0.9 + p.z * 0.38, p.z * 0.82 - p.x * 0.52) + 0.3);
	float s = step(0.5, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
	vec3 top = mix(c75, c74, s);
	float mot = smoothstep(0.55, 0.8, 0.5 + 0.5 * sin(p.z * 6.5 + sin(p.y * 9.0) * 2.2) * sin(p.y * 7.5 + sin(p.z * 5.0) * 1.7)); // mottled sides
	vec3 side = mix(c76, mix(c75, c74, step(0.5, fract(p.z * 0.9))), mot * 0.85);
	float up = n.y;
	vec3 c = up > 0.45 ? top : up < -0.25 ? c76 : mix(side, top, smoothstep(0.1, 0.45, up));
	bool body = abs(p.x) < 0.7;
	if (body && p.z < -2.55 && p.y < -0.12) c = yel; // the yellow under-cowl
	if (body && p.z > 2.45 && p.z < 2.95) c = yel; // the Reichsverteidigung band
	float k = 0.0;
	if (body && abs(n.x) > 0.35) k = cross2(vec2(p.z - 1.45, p.y - 0.06), 0.4); // on the fuselage sides
	if (abs(p.x) > 2.6) k = max(k, cross2(vec2(abs(p.x) - 3.55, p.z + 0.72), 0.5)); // on the wings, top and bottom
	if (k > 1.5) c = vec3(0.012); else if (k > 0.5) c = vec3(0.75);
	ALBEDO = c;
	ROUGHNESS = roughness;
	METALLIC = metalness;
}
"""
const PAINT_SPINNER := """
void fragment() {
	float a = atan(vObj.y, vObj.x) / 6.2832 + vObj.z * 1.6; // the white spiral on the black-green spinner
	ALBEDO = fract(a) < 0.18 ? vec3(0.72) : vec3(0.012, 0.02, 0.012);
	ROUGHNESS = roughness;
	METALLIC = metalness;
}
"""
static var _shaders := {}

static func paint(roughness: float, metalness: float, spinner := false) -> ShaderMaterial:
	var key := "fw190-spinner" if spinner else "fw190-paint"
	if not _shaders.has(key):
		var sh := Shader.new()
		sh.code = PAINT_COMMON + (PAINT_SPINNER if spinner else PAINT_BODY)
		_shaders[key] = sh
	var m := ShaderMaterial.new()
	m.shader = _shaders[key]
	m.set_shader_parameter("roughness", roughness)
	m.set_shader_parameter("metalness", metalness)
	return m

## Glass for the canopy.
static func glass() -> Material:
	var m := Mat.physical({color = 0xc8d8e0, roughness = 0.05, metalness = 0, transparent = true, opacity = 0.22, depthWrite = false, side = Mat.DOUBLE})
	m.render_priority = 2 # (renderOrder 2: drawn after the plane's other see-through parts)
	return m

## Every geometry non-indexed with only position and normal (as the JS kept them), for one merge.
static func _plain(list: Array) -> Array:
	return list.map(func(g):
		var h = g.to_non_indexed() if not g.indices.is_empty() else g
		h.uvs = PackedVector2Array(); h.colors = PackedColorArray()
		return h)

static func _mesh(g, mat: Material, name := "") -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = g.to_mesh(mat)
	if name:
		mi.name = name
	return mi

## The whole aeroplane. lod: the low-detail copy for far away (fewer sections, no guns or fan).
## Named parts: 'Fw190_Blades' (the propeller) and 'Fake_Blades' (its blur disc), as the game spins them.
static func build_fw190(o := {}) -> Node3D:
	var lod: bool = o.get("lod", false)
	var root := Node3D.new()
	root.name = "Fw190"
	var skin := paint(0.62, 0.15)
	var dark := Mat.standard({color = 0x16181a, roughness = 0.55, metalness = 0.6})
	var seg := 12 if lod else 28
	var body := [loft(BODY, seg)]
	# the wings, the tailplane and the fin (all in the same paint)
	body.append(wing(1, lod)); body.append(wing(-1, lod))
	var tp := [[0.15, -0.45], [1.0, -0.33], [1.62, -0.18], [1.78, 0.02], [1.7, 0.22], [1.1, 0.35], [0.15, 0.42]]
	for s in [1, -1]:
		var g = slab(tp.map(func(p): return [p[0], -p[1]]), 0.07, 0.0 if lod else 0.015).rotate_x(-PI / 2).translate(0, 0.2, 3.95)
		if s < 0:
			g.scale(-1, 1, 1)
			flip(g)
		body.append(g)
	var fin := [[-0.55, 0.15], [-0.25, 0.75], [0.0, 1.12], [0.25, 1.22], [0.45, 1.12], [0.62, 0.7], [0.68, 0.15]]
	body.append(slab(fin.map(func(p): return [-p[0], p[1]]), 0.08, 0.0 if lod else 0.015).rotate_y(PI / 2).translate(0, 0.08, 3.85))
	# the spine behind the canopy, rising to the headrest
	body.append(loft([[-0.2, 0.0, 0.0, 0.62], [0.05, 0.2, 0.14, 0.6], [0.8, 0.2, 0.12, 0.56], [1.8, 0.12, 0.06, 0.47], [2.4, 0.01, 0.01, 0.4]], 6 if lod else 14))
	if not lod:
		# the bulges over the MG 131s, in front of the windscreen
		for s in [-1, 1]:
			body.append(loft([[-2.6, 0.01, 0.01, 0.6], [-2.35, 0.1, 0.08, 0.63], [-1.4, 0.1, 0.08, 0.68], [-1.15, 0.01, 0.01, 0.7]], 10).translate(s * 0.17, 0, 0))
		# the wheel doors on the wing's underside (the legs folded inwards), and the radio mast
		for s in [-1, 1]:
			body.append(Geo.cylinder(0.42, 0.42, 0.03, 20).translate(s * 1.25, -0.6, -0.95))
	var body_mesh := _mesh(Geo.merge(_plain(body)), skin, "Fw190_Body")
	root.add_child(body_mesh)
	# the cowling's open front: the cooling fan behind the lip, dark, its blades just showing
	var front := [Geo.circle(0.5, seg).translate(0, 0, -3.98)]
	if not lod:
		for k in 12:
			front.append(Geo.box(0.05, 0.36, 0.02).translate(0, 0.27, -3.94).rotate_z((k / 12.0) * TAU))
	root.add_child(_mesh(Geo.merge(_plain(front)), dark))
	# the spinner, and the three broad VDM blades
	var spinner := _mesh(Geo.sphere(0.34, seg, 10, 0, TAU, 0, PI / 2).rotate_x(-PI / 2).scale(1, 1, 1.35).translate(0, 0, -4.0), paint(0.5, 0.3, true))
	root.add_child(spinner)
	var blades := Node3D.new()
	blades.name = "Fw190_Blades"
	blades.position = Vector3(0, 0, -4.1)
	var blade := Shapes.Shape.new([[0.0, 0.25], [0.12, 0.3], [0.17, 0.9], [0.15, 1.5], [0.07, 1.7], [-0.05, 1.68], [-0.12, 1.3], [-0.12, 0.4], [-0.06, 0.25]].map(func(p): return Vector2(p[0], p[1])))
	var bm: ArrayMesh = Geo.extrude(blade, {depth = 0.03, bevelEnabled = false}).translate(0, 0, -0.015).rotate_y(0.35).to_mesh(dark)
	for k in 3:
		var b := MeshInstance3D.new()
		b.mesh = bm
		b.rotation.z = (k / 3.0) * TAU
		blades.add_child(b)
	root.add_child(blades)
	var disc := _mesh(Geo.circle(1.7, 32), Mat.basic({color = 0x1a1a1a, transparent = true, opacity = 0.18, depthWrite = false, side = Mat.DOUBLE}), "Fake_Blades")
	disc.position = Vector3(0, 0, -4.12)
	disc.visible = false
	root.add_child(disc)
	# the bubble canopy and the armoured windscreen's frame, the exhausts down the sides
	var canopy := _mesh(Geo.sphere(1, 10 if lod else 24, 6 if lod else 12, 0, TAU, 0, PI / 2).scale(0.33, 0.36, 0.95).translate(0, 0.62, -0.18), glass())
	root.add_child(canopy)
	if not lod:
		var frame := [Geo.torus(0.34, 0.018, 6, 24, PI).translate(0, 0.62, -0.95).scale(1, 1.05, 1),
			Geo.box(0.03, 0.34, 0.03).translate(0, 0.8, -1.02).rotate_x(-0.6),
			Geo.torus(0.33, 0.016, 6, 24, PI).translate(0, 0.62, 0.55)]
		for s in [-1, 1]:
			for k in 5:
				frame.append(Geo.box(0.06, 0.04, 0.16).translate(s * 0.6, 0.12 - k * 0.07, -2.45 + k * 0.05))
		root.add_child(_mesh(Geo.merge(_plain(frame)), dark))
		# the guns: the MG 131s' muzzles in their troughs, the MG 151s out of the wing roots and further out
		var guns := []
		for s in [-1, 1]:
			guns.append(Geo.cylinder(0.022, 0.022, 0.5, 8).rotate_x(PI / 2).translate(s * 0.17, 0.62, -2.75))
			guns.append(Geo.cylinder(0.03, 0.03, 0.55, 8).rotate_x(PI / 2).translate(s * 0.95, -0.46, -2.0))
			guns.append(Geo.cylinder(0.03, 0.03, 0.35, 8).rotate_x(PI / 2).translate(s * 2.05, -0.38, -1.62))
		root.add_child(_mesh(Geo.merge(_plain(guns)), dark))
	for m in root.find_children("*", "GeometryInstance3D", true, false):
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if lod else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return root
