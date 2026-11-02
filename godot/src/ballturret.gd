extends RefCounted
# The inside of the Sperry ball turret, as the gunner saw it, curled up on his back in the ball with
# his knees drawn up: the big round armoured-glass window between his feet, in its heavy riveted ring;
# the K-4 reflector sight hung from the roof right in front of his face, its amber reticle on the
# slanted glass; the two Brownings along either side of him (their receivers and feed chutes at the
# edges of his view, the barrels running out through the ball's sides), the ammunition boxes beside
# them; the control handles over his head with his gloved hands on them, the firing buttons under his
# thumbs; his knees and boots in the stirrups either side of the window. All round, the inside of the
# steel ball: worn interior green, bare metal at its edges, its frames, a couple of small side panes.
# Built in the camera's frame (-Z = where you look, your eye at the origin) and turned with your aim.
# It's drawn after the world and over it (the ball is closer than anything outside), so nothing of
# the bomber shows through its steel; only the window and side panes show the world.
# (Godot: drawn in the transparent pass, after everything else, with render priorities 100-107 for Three's
# renderOrder 1000-1007: the shell with no depth test, writing its depth, the rest tested against it.)

const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")
const Mat := preload("res://src/core/mat.gd")
const Cabinlook := preload("res://src/cabinlook.gd")
const Environment_ := preload("res://src/environment.gd")

const R := 0.56 # m, inside radius of the ball round your eye
const WIN := 37 # degrees off your aim: the round window's edge
const D := PI / 180.0
static var PANES: Array = [Vector3(-0.8, 0.52, -0.3).normalized(), Vector3(0.8, 0.52, -0.3).normalized()] # the small side panes, up either side
const PANE := 9 # their radius, degrees
const GUN := {x = 0.3, y = 0.02} # the guns' bores beside you (interior.js: the ball's twin layout matches)

static func smudge_texture() -> Texture2D:
	var g := Canvas2D.new(512, 512)
	var st := {s = 11}
	var rnd := func() -> float:
		st.s = (st.s * 16807) % 2147483647
		return float(st.s) / 2147483647
	g.fill_style = "rgba(255,255,255,0.04)"
	g.fill_rect(0, 0, 512, 512)
	for i in 60: # smudges and oil from the guns
		var x: float = rnd.call() * 512
		var y: float = rnd.call() * 512
		var r: float = 10 + rnd.call() * 45
		var grd = g.create_radial_gradient(x, y, 0, x, y, r)
		grd.add_color_stop(0, "rgba(235,230,215,%s)" % (0.05 + rnd.call() * 0.09))
		grd.add_color_stop(1, "rgba(235,230,215,0)")
		g.fill_style = grd; g.fill_rect(x - r, y - r, r * 2, r * 2)
	# oil streaks running back from the edge (the slipstream drags them round the ball)
	for i in 26:
		var a: float = rnd.call() * PI * 2
		var r0: float = 200 + rnd.call() * 50
		var l: float = 20 + rnd.call() * 50
		g.stroke_style = "rgba(60,45,20,%s)" % (0.08 + rnd.call() * 0.1); g.line_width = 1 + rnd.call() * 3
		g.begin_path(); g.move_to(256 + cos(a) * r0, 256 + sin(a) * r0); g.line_to(256 + cos(a) * (r0 - l), 256 + sin(a) * (r0 - l)); g.stroke()
	g.stroke_style = "rgba(255,255,255,0.14)"; g.line_width = 0.8 # fine scratches
	for i in 90:
		var x: float = rnd.call() * 512
		var y: float = rnd.call() * 512
		var a: float = rnd.call() * 6.28
		var l: float = 8 + rnd.call() * 40
		g.begin_path(); g.move_to(x, y); g.line_to(x + cos(a) * l, y + sin(a) * l); g.stroke()
	return g.texture(true)

static var _glass_shaders := {}
static var _smudge: Texture2D
## Glass: transparent, glossy, and more opaque where you look across it (Fresnel), like real glass.
## (And drops on it in the rain: environment.gd's `wet`, as wetGlass adds them.) depth_test: false for the ball's.
static func glass_material(depth_test := true) -> ShaderMaterial:
	Environment_.globals()
	var key := str(depth_test)
	if not _glass_shaders.has(key):
		var sh := Shader.new()
		sh.code = "shader_type spatial;\nrender_mode blend_mix, depth_draw_never, cull_front%s;\n" % ("" if depth_test else ", depth_test_disabled") + """
global uniform float wet;
uniform vec4 albedo : source_color = vec4(0.875, 0.910, 0.925, 1.0);
uniform sampler2D map : source_color, filter_linear_mipmap_anisotropic;
uniform float inside = 1.0;
varying vec3 v_wet_p;
void vertex() { v_wet_p = VERTEX; }
void fragment() {
	vec4 c = albedo * texture(map, UV);
	float facing = abs(dot(normalize(NORMAL), normalize(-VERTEX)));
	float a = clamp(c.a + pow(1.0 - facing, 3.0) * 0.45, 0.0, 0.6);
	vec3 col = c.rgb;
	if (wet > 0.0) {
		float drops = 0.0;
		for (int k = 0; k < 2; k++) { // two sizes of bead
			vec3 wp = v_wet_p * (k == 0 ? 24.0 : 55.0);
			vec3 cell = floor(wp), fr = fract(wp);
			float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
			vec3 cc = vec3(fract(h * 7.13), fract(h * 3.71), fract(h * 5.37)) * 0.6 + 0.2;
			float r = (0.09 + 0.11 * fract(h * 11.0));
			drops = max(drops, step(1.0 - wet * 0.4, h) * smoothstep(r, r * 0.5, length(fr - cc)));
		}
		col = mix(col, col * 1.5, drops * 0.6);
		a = max(a, drops * 0.28);
	}
	ALBEDO = col;
	ALPHA = a;
	ROUGHNESS = 0.06;
	METALLIC = 0.0;
	CLEARCOAT = 1.0;
	CLEARCOAT_ROUGHNESS = 0.08;
	AO = inside;
	AO_LIGHT_AFFECT = 0.0;
}
"""
		_glass_shaders[key] = sh
	if _smudge == null:
		_smudge = smudge_texture()
	var m := ShaderMaterial.new()
	m.shader = _glass_shaders[key]
	m.set_shader_parameter("map", _smudge)
	m.set_meta("transparent", true)
	return m

## The amber K-4 reticle: a cross with a gap in the middle and a dot at its centre, on black (drawn additively).
static func reticle_texture() -> Texture2D:
	var g := Canvas2D.new(256, 256)
	var m := 128
	g.fill_style = "#000"; g.fill_rect(0, 0, 256, 256)
	g.shadow_color = "#ffb040"; g.shadow_blur = 6
	g.stroke_style = "#ffd08a"; g.line_width = 4.5
	g.line_cap = "round"
	for k in 4:
		var a := (k * PI) / 2
		g.begin_path(); g.move_to(m + cos(a) * 22, m + sin(a) * 22); g.line_to(m + cos(a) * 104, m + sin(a) * 104); g.stroke()
	g.fill_style = "#ffe2b0"; g.begin_path(); g.arc(m, m, 4.5, 0, PI * 2); g.fill()
	return g.texture(true)

## The steel shell round you: worn interior green, its frames, bare metal round the window; holes for the glass.
static func shell_material() -> ShaderMaterial:
	var panes := ""
	for p in PANES:
		panes += "\tif (dot(bd, vec3(%.4f, %.4f, %.4f)) > %.5f) discard;\n" % [p.x, p.y, p.z, cos(PANE * D)]
	var sh := Shader.new()
	# (drawn over the world: no depth test, its depth written; see-through so it's drawn after the world)
	sh.code = """shader_type spatial;
render_mode blend_mix, cull_front, depth_test_disabled, depth_draw_always;
uniform vec4 albedo : source_color = vec4(0.227, 0.259, 0.188, 1.0);
uniform float inside = 0.45;
varying vec3 vBall;
""" + Cabinlook.NOISE.replace("h3", "bh").replace("n3", "bn") + """
void vertex() { vBall = VERTEX; }
void fragment() {
	vec3 bd = normalize(vBall);
	float th = acos(clamp(-bd.z, -1.0, 1.0));
	if (th < %.4f) discard; // the window
""" % (WIN * D) + panes + """
	float ph = atan(bd.y, bd.x);
	// the frames: meridians every 45 degrees and two rings, darker; bare metal round the window
	float mer = smoothstep(0.035, 0.0, abs(fract(ph / 0.7854 + 0.5) - 0.5) * 0.7854 * sin(th));
	float rings = smoothstep(0.02, 0.0, abs(th - 1.15)) + smoothstep(0.02, 0.0, abs(th - 1.75));
	float frame = clamp(mer * step(%.3f, th) + rings, 0.0, 1.0);
	float wear = bn(vBall * 26.0) * 0.6 + bn(vBall * 90.0) * 0.4;
	float chip = smoothstep(0.8, 0.86, wear) * (0.25 + frame) * 0.6;
	float rim = smoothstep(%.3f, %.3f, th);
	vec3 col = albedo.rgb;
	col *= 0.88 + 0.16 * bn(vBall * 7.0);
	col = mix(col, col * 0.55, frame);
	col = mix(col, vec3(0.42, 0.43, 0.4), max(chip, rim * 0.6) * 0.75);
	ALBEDO = col;
	ROUGHNESS = mix(0.78, 0.45, max(chip, rim * 0.6));
	METALLIC = 0.35;
	ALPHA = 1.0;
	AO = inside;
	AO_LIGHT_AFFECT = 0.0;
}
""" % [(WIN + 7) * D, (WIN + 9) * D, (WIN + 2) * D]
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_meta("transparent", true)
	return m

static func std(color, roughness: float, metalness := 0.0) -> ShaderMaterial:
	var m := Cabinlook.std({color = color, roughness = roughness, metalness = metalness})
	Cabinlook.inside_light(m, 0.5)
	return m

## A rounded-off box (bevelled edges catch the light).
static func rbox(w: float, h: float, d: float, r := 0.006):
	var s := Shapes.Shape.new()
	var x := w / 2 - r
	var y := h / 2 - r
	s.move_to(-x, -h / 2); s.line_to(x, -h / 2); s.quadratic_curve_to(w / 2, -h / 2, w / 2, -y); s.line_to(w / 2, y); s.quadratic_curve_to(w / 2, h / 2, x, h / 2)
	s.line_to(-x, h / 2); s.quadratic_curve_to(-w / 2, h / 2, -w / 2, y); s.line_to(-w / 2, -y); s.quadratic_curve_to(-w / 2, -h / 2, -x, -h / 2)
	return Geo.extrude(s, {depth = d - 2 * r, bevelEnabled = true, bevelThickness = r, bevelSize = r * 0.6, bevelSegments = 2, curveSegments = 3}).translate(0, 0, -(d - 2 * r) / 2)

static func _q(a: Vector3, b: Vector3) -> Quaternion:
	var r := a.dot(b) + 1.0
	if r < 1e-8:
		return Quaternion(-a.y, a.x, 0, 0).normalized() if absf(a.x) > absf(a.z) else Quaternion(0, -a.z, a.y, 0).normalized()
	var c := a.cross(b)
	return Quaternion(c.x, c.y, c.z, r).normalized()

static func rod(a: Array, b: Array, r: float, seg := 8):
	var A := Vector3(a[0], a[1], a[2])
	var B := Vector3(b[0], b[1], b[2])
	var g = Geo.cylinder(r, r, A.distance_to(B), seg)
	g.apply_quaternion(_q(Vector3.UP, (B - A).normalized()))
	return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2)

static func limb(a: Array, b: Array, r: float):
	var A := Vector3(a[0], a[1], a[2])
	var B := Vector3(b[0], b[1], b[2])
	var g = Geo.capsule(r, maxf(0.005, A.distance_to(B) - r), 4, 10)
	g.apply_quaternion(_q(Vector3.UP, (B - A).normalized()))
	return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2)

static func merge(list: Array):
	var out := []
	for g in list:
		var n = g.to_non_indexed() if not g.indices.is_empty() else g
		n.uvs = PackedVector2Array()
		n.colors = PackedColorArray()
		if n.normals.is_empty():
			n.compute_vertex_normals()
		out.append(n)
	return Geo.merge(out)

## Ring of steel round the view axis at `deg` from straight ahead.
static func latitude(deg: float, tube: float, r := R):
	var a := deg * D
	return Geo.torus(r * sin(a), tube, 8, 72).translate(0, 0, -r * cos(a))

static func build_ball_turret() -> Node3D:
	var g := Node3D.new()
	g.name = "BallCockpit"
	var M := {
		steel = std(0x34372f, 0.45, 0.75), dark = std(0x1b1c19, 0.6, 0.5), bakelite = std(0x141210, 0.35, 0.1),
		red = std(0x8a1a12, 0.4), parker = std(0x2a2b28, 0.5, 0.6), ammo = std(0x4a5237, 0.75, 0.2), brass = std(0x9c7a36, 0.35, 0.85),
		glove = std(0x4a2f1d, 0.62), sleeve = std(0x5a3a22, 0.7), fleece = std(0xbfae88, 0.95), trousers = std(0x4f513a, 0.85), boot = std(0x1c1612, 0.5),
		sightBody = std(0x2b2d2c, 0.4, 0.55),
	}
	var add := func(geo, mat: Material, order := 1003) -> MeshInstance3D:
		var m := MeshInstance3D.new()
		m.mesh = geo.to_mesh(mat)
		m.set_meta("order", order)
		g.add_child(m)
		return m

	# ---- the steel ball round you, its window and side panes
	var shell: MeshInstance3D = add.call(Geo.sphere(R, 72, 40), shell_material(), 1000)
	var glass_mat := glass_material(false)
	var glass: MeshInstance3D = add.call(Geo.sphere(R - 0.004, 48, 12, 0, PI * 2, 0, (WIN + 1) * D).rotate_x(-PI / 2), glass_mat, 1001)
	var pane_glass := glass_material(false)
	pane_glass.set_shader_parameter("albedo", Mat.color(0x7d8a8e)) # (seen across: darker)
	for p in PANES:
		var q := _q(Vector3(0, 0, -1), p)
		add.call(Geo.sphere(R - 0.004, 24, 6, 0, PI * 2, 0, (PANE + 1) * D).rotate_x(-PI / 2).apply_quaternion(q), pane_glass, 1001)
		add.call(Geo.torus(R * sin(PANE * D), 0.01, 6, 40).translate(0, 0, -R * cos(PANE * D) + 0.006).apply_quaternion(q), M.steel, 1002)
	# the window's heavy ring: its frame, the flange round it and two rows of rivets
	var ring_g := [latitude(WIN, 0.026, R - 0.012), latitude(WIN + 5.5, 0.012, R - 0.006)]
	for q in [[44, WIN + 2.6, R - 0.03, 0.006], [44, WIN + 6.6, R - 0.016, 0.0045]]:
		for k in q[0]:
			var a: float = (float(k) / q[0]) * PI * 2 + (PI / q[0] if q[3] < 0.005 else 0.0)
			var t: float = q[1] * D
			var r: float = q[2] * sin(t)
			ring_g.append(Geo.sphere(q[3], 6, 4).translate(cos(a) * r, sin(a) * r, -q[2] * cos(t)))
	add.call(merge(ring_g), M.steel, 1002)

	# ---- the two Brownings either side of you: receivers, feed covers, charging handles, the jackets out
	# to the ball's side slots (outside, the guns' own barrels carry on: weapons.js)
	var guns := []
	var feed := []
	var ammo := []
	var brass := []
	for s in [-1, 1]:
		var x: float = s * GUN.x
		var y: float = GUN.y
		guns.append(rbox(0.1, 0.13, 0.5, 0.01).translate(x, y, 0.06)) # receiver, running back past you
		for dz in [-0.12, 0.0, 0.12]:
			guns.append(rbox(0.006, 0.11, 0.012, 0.002).translate(x - s * 0.052, y, 0.06 + dz)) # its side plate's stiffeners, facing you
		for q in [[-0.16, 0.04], [-0.16, -0.04], [0.2, 0.04], [0.2, -0.04], [0.04, 0.045], [0.04, -0.045]]:
			guns.append(Geo.cylinder(0.007, 0.007, 0.008, 8).rotate_z(PI / 2).translate(x - s * 0.054, y + q[1], 0.06 + q[0])) # its bolts
		guns.append(rbox(0.11, 0.14, 0.02, 0.005).translate(x, y, 0.31)) # the back plate
		for sy in [-1, 1]:
			guns.append(rod([x + sy * 0.035, y - 0.02, 0.32], [x + sy * 0.04, y - 0.1, 0.36], 0.012)) # its spade grips (the guns are fired from the handles: these hang idle)
		guns.append(rbox(0.115, 0.03, 0.3, 0.006).translate(x, y + 0.09, 0.1)) # feed cover
		guns.append(rbox(0.13, 0.17, 0.08, 0.01).translate(x, y, -0.22)) # trunnion block
		guns.append(rod([x + s * 0.068, y + 0.02, 0.18], [x + s * 0.068, y + 0.02, -0.02], 0.009)) # charging handle slide
		guns.append(rod([x, y, -0.25], [x, y, -0.5], 0.032, 14)) # the jacket to the slot
		for k in 9:
			guns.append(Geo.torus(0.033, 0.004, 4, 14).translate(x, y, -0.28 - k * 0.025)) # its cooling holes' rims
		guns.append(Geo.cylinder(0.06, 0.06, 0.012, 18).rotate_x(PI / 2).translate(x, y, -sqrt(R * R - x * x - y * y) + 0.012)) # the slot plate in the ball's side
		# the ammunition box outboard, above the gun, and the belt chute down into the feed tray
		ammo.append(rbox(0.1, 0.16, 0.26, 0.008).translate(s * 0.42, 0.17, 0.12))
		for k in 3:
			ammo.append(rbox(0.105, 0.01, 0.01, 0.003).translate(s * 0.42, 0.11 + k * 0.055, -0.015)) # its straps
		var chute := Shapes.CatmullRomCurve3.new([Vector3(s * 0.41, 0.09, 0.06), Vector3(s * 0.37, 0.04, 0.06), Vector3(s * 0.33, y + 0.09, 0.08)])
		feed.append(Geo.tube(chute, 10, 0.026, 6, false))
		for i in range(1, 10):
			var p: Vector3 = chute.get_point_at(i / 10.0)
			var tn: Vector3 = chute.get_tangent_at(i / 10.0)
			feed.append(Geo.torus(0.029, 0.004, 3, 8).apply_quaternion(_q(Vector3(0, 0, 1), tn)).translate(p.x, p.y, p.z))
		for k in 6:
			brass.append(Geo.cylinder(0.006, 0.006, 0.05, 6).rotate_z(PI / 2).translate(s * (0.36 - k * 0.004), 0.06 - k * 0.012, 0.07)) # the belt's rounds showing
	add.call(merge(guns), M.parker) # (in the ball's light: the sun through the window and the panes)
	# (the web game's line ends in that comment: its feed chutes, ammunition boxes and brass were never added. Kept so.)

	# ---- your knees drawn up and your boots in the stirrups, either side of the window, low in the view
	var legs := []
	var boots := []
	var stir := []
	for s in [-1, 1]:
		var hip := [s * 0.16, -0.4, 0.16]
		var knee := [s * 0.29, -0.27, -0.3]
		var ankle := [s * 0.29, -0.41, -0.38]
		legs.append_array([limb(hip, knee, 0.075), limb(knee, ankle, 0.06), Geo.sphere(0.078, 12, 10).translate(knee[0], knee[1], knee[2])])
		boots.append_array([limb(ankle, [s * 0.3, -0.45, -0.48], 0.055), Geo.sphere(0.06, 10, 8).scale(1, 0.8, 1.2).translate(s * 0.3, -0.46, -0.49)])
		stir.append(Geo.torus(0.055, 0.008, 6, 18).rotate_x(PI / 2 - 0.4).translate(s * 0.3, -0.5, -0.48)) # the stirrup
		stir.append(rod([s * 0.3, -0.51, -0.43], [s * 0.38, -0.4, -0.38], 0.008))
	add.call(merge(legs), M.trousers); add.call(merge(boots), M.boot); add.call(merge(stir), M.steel)

	# ---- the control handles over your head, your gloved hands on them, thumbs on the firing buttons
	var bar := []
	var grips := []
	var buttons := []
	var gloves := []
	var sleeves := []
	var cuffs := []
	bar.append(rod([-0.22, 0.27, -0.16], [0.22, 0.27, -0.16], 0.014)) # the cross bar
	bar.append(rod([0, 0.27, -0.16], [0, 0.42, -0.1], 0.02)) # up to the control box
	bar.append(rbox(0.12, 0.08, 0.1, 0.01).translate(0, 0.44, -0.08))
	for s in [-1, 1]:
		var gx: float = s * 0.17
		grips.append(limb([gx, 0.27, -0.16], [gx + s * 0.01, 0.17, -0.19], 0.019)) # the grip, angled down and forward
		buttons.append(Geo.cylinder(0.011, 0.011, 0.012, 12).translate(gx + s * 0.008, 0.285, -0.158)) # the firing button on top
		# the glove round the grip: palm, four curled fingers, the thumb up on the button
		gloves.append(Geo.sphere(0.04, 12, 10).scale(1, 1.35, 0.85).translate(gx + s * 0.02, 0.22, -0.16))
		for f in 4:
			gloves.append(limb([gx - s * 0.015, 0.25 - f * 0.022, -0.2], [gx - s * 0.03, 0.245 - f * 0.022, -0.17], 0.012))
		gloves.append(limb([gx + s * 0.02, 0.25, -0.15], [gx + s * 0.008, 0.29, -0.155], 0.012))
		# the gauntlet and the jacket sleeve, going back up out of the view
		cuffs.append(limb([gx + s * 0.03, 0.2, -0.13], [gx + s * 0.05, 0.22, -0.06], 0.045))
		sleeves.append(limb([gx + s * 0.05, 0.22, -0.06], [gx + s * 0.12, 0.3, 0.12], 0.052))
	add.call(merge(bar), M.steel); add.call(merge(grips), M.bakelite); add.call(merge(buttons), M.red)
	add.call(merge(gloves), M.glove, 1004); add.call(merge(cuffs), M.fleece, 1004); add.call(merge(sleeves), M.sleeve, 1004)

	# ---- the K-4 sight hung from the roof right in front of your face, its reflector glass across your line of sight
	var body := [rbox(0.1, 0.06, 0.12, 0.01).translate(0, 0.16, -0.21), rbox(0.04, 0.1, 0.04, 0.008).translate(0, 0.23, -0.22)] # the computing head, its hanger
	for q in [[-0.058, -0.18], [0.058, -0.18], [0.058, -0.24]]:
		body.append(Geo.cylinder(0.011, 0.011, 0.016, 14).rotate_z(PI / 2).translate(q[0], 0.155, q[1])) # its knobs
	body.append(Geo.cylinder(0.02, 0.02, 0.016, 18).rotate_x(PI / 2).translate(0.03, 0.165, -0.145)) # the range drum's face
	body.append(rbox(0.09, 0.012, 0.012, 0.004).translate(0, 0.122, -0.24)) # the glass's holder
	add.call(merge(body), M.sightBody, 1005)
	var plate_mat := Mat.physical({color = 0xa8c0c8, roughness = 0.04, transparent = true, opacity = 0.06, clearcoat = 1, side = Mat.DOUBLE, depthWrite = false})
	add.call(Geo.plane(0.085, 0.07).rotate_x(-0.85).translate(0, 0.095, -0.215), plate_mat, 1006) # the slanted reflector glass
	# the reticle: projected at infinity, so it sits on your aim (scaled with the range drum: setRange)
	var ret_mat := ShaderMaterial.new()
	ret_mat.shader = Shader.new()
	ret_mat.shader.code = """shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled;
uniform sampler2D map : source_color;
void fragment() { ALBEDO = texture(map, UV).rgb * vec3(5.0, 2.9, 1.2); } // (bright, not tone-mapped down: an amber glow)
"""
	ret_mat.set_shader_parameter("map", reticle_texture())
	var ret := MeshInstance3D.new()
	ret.mesh = Geo.plane(1, 1).to_mesh(ret_mat)
	var RET := 0.2
	var base := (RET * tan(0.05)) / (96.0 / 128) * 2 # (a ring of 50 mils radius at the default range)
	ret.position = Vector3(0, 0, -RET)
	ret.scale = Vector3.ONE * base
	ret.set_meta("order", 1007)
	g.add_child(ret)

	# ---- a little oxygen regulator and the interphone box up on the frames
	add.call(merge([rbox(0.07, 0.09, 0.03, 0.006).translate(-0.33, 0.33, -0.18), rbox(0.06, 0.05, 0.03, 0.006).translate(0.34, 0.32, -0.16)]), M.dark)
	add.call(Geo.cylinder(0.018, 0.018, 0.012, 14).rotate_z(PI / 2 - 0.4).translate(-0.31, 0.35, -0.164), M.red) # the regulator's blinker

	# drawn over the world: the shell first (writing its depth), the parts inside it after, against that
	var seen := {}
	for m in g.get_children():
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var mat: Material = m.mesh.surface_get_material(0)
		var order: int = m.get_meta("order", 1003)
		if m == shell or m == ret:
			mat.render_priority = order - 900
			continue
		if seen.has(mat): # (a material shared by parts of different orders: one copy each)
			if seen[mat] != order:
				mat = mat.duplicate()
				m.mesh.surface_set_material(0, mat)
		seen[mat] = order
		mat.render_priority = order - 900
		if mat == glass_mat or mat == pane_glass or mat == plate_mat:
			continue # (the glass: no depth test, or none written)
		if mat is ShaderMaterial and Cabinlook.features(mat).size():
			Cabinlook.refeature(mat, {alpha = "blend", always = true})
	var set_range := func(k: float) -> void: ret.scale = Vector3.ONE * base * k # the range ring: 1 = the default
	g.set_meta("set_range", set_range)
	return g
