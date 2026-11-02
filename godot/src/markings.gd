extends RefCounted
# Each B-17's own markings, as the records have her, painted on the full and mid-detail models (the ones
# near you; far off they'd be less than a pixel): the group's symbol high on the fin (the 1st Bomb Wing's
# triangle, the 4th's square, each with the group's letter, in white as on the olive drab of 1943), the tail
# number below it in yellow (the serial without the first figure of its year: 42-30708 is 230708), the
# squadron code and the aircraft's letter on the fuselage sides in grey, and the recorded name in plain
# lettering on the nose. Only what's on record is painted: no serial, no tail number; no name, nothing on
# the nose. The nose art itself isn't drawn (it isn't documented), only the name.
# (The lettering is Godot's Label3D, text drawn sharp at any distance, where the web game painted each
# marking into a canvas texture; the symbol's shape is a small texture of its own, as it was.)

const Models := preload("res://src/models.gd")

# the group markings of the autumn of 1943 (Eighth Air Force tail symbols)
const GROUP_SYMBOL := {
	"91st": ["triangle", "A"], "92nd": ["triangle", "B"], "303rd": ["triangle", "C"], "305th": ["triangle", "G"], "306th": ["triangle", "H"],
	"351st": ["triangle", "J"], "379th": ["triangle", "K"], "381st": ["triangle", "L"], "384th": ["triangle", "P"],
	"94th": ["square", "A"], "95th": ["square", "B"], "96th": ["square", "C"], "100th": ["square", "D"], "385th": ["square", "G"], "388th": ["square", "H"], "390th": ["square", "J"],
}

static var _TAIL := RegEx.create_from_string("^(\\d)(\\d)-(\\d+)$")
## The tail number painted on the fin: the serial without its year's first figure (42-30708 -> 230708).
static func tail_number(serial):
	var m := _TAIL.search(serial if serial is String else "")
	return m.get_string(2) + m.get_string(3) if m else null

static var _fonts := {}
static func _font(names: Array, italic := false) -> SystemFont:
	var key := ",".join(names) + str(italic)
	if not _fonts.has(key):
		var f := SystemFont.new()
		f.font_names = PackedStringArray(names)
		f.font_weight = 700
		f.font_italic = italic
		f.multichannel_signed_distance_field = true # (crisp at any size)
		_fonts[key] = f
	return _fonts[key]
const STENCIL := ["Stardos Stencil", "Stencil", "Impact", "sans-serif"]

static var _shapes := {} # (one texture a shape, shared)
static func _shape_tex(shape: String) -> Texture2D:
	if _shapes.has(shape):
		return _shapes[shape]
	var w := 256
	var h := 256
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var c := Color("#e8e4d8")
	var a := Vector2(w / 2.0, 14)
	var b := Vector2(w - 14, h - 22)
	var d := Vector2(14, h - 22)
	for y in h:
		for x in w:
			var p := Vector2(x + 0.5, y + 0.5)
			var inside := Geometry2D.point_is_inside_triangle(p, a, b, d) if shape == "triangle" else (x >= 26 and x < w - 26 and y >= 26 and y < h - 26)
			if inside:
				img.set_pixel(x, y, c)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_shapes[shape] = t
	return t

static var _mats := {}
static func _mat(tex: Texture2D) -> StandardMaterial3D:
	if not _mats.has(tex):
		var m := StandardMaterial3D.new()
		m.albedo_texture = tex
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.35
		m.roughness = 0.75
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		_mats[tex] = m
	return _mats[tex]

## Where on this model the markings go, found once per model by casting rays at its skin from either side
## (so they sit on the surface whatever its exact shape), in the bomber's frame (nose -Z, y up, metres: the
## model's parent). SPOTS: name -> [z, y].
# (from a scan of the model's side: the fin from y 0 to 2.5 at z 8.5-10, the fuselage's middle about y -0.8)
# (the code and the letter both aft of the star and the waist window: this model's star sits close behind
# the wing, leaving no room for the code ahead of it as on most of the real ones; the window itself is open)
const SPOTS := {fin = [9.3, 1.75], tail = [9.4, 0.85], code = [5.6, -0.55], letter = [7.4, -0.5], name = [-9.3, -0.55]}
static func _anchors(model: Node3D) -> Dictionary:
	if model.has_meta("mark_anchors"):
		return model.get_meta("mark_anchors")
	var meshes := []
	for o in model.find_children("*", "MeshInstance3D", true, false):
		if o.visible and not o.get_meta("noShadow", false) and not o.get_parent().name == "markings":
			meshes.append(o)
	var out := {}
	# (rays in the model's frame, then put in the bomber's: the model's own transform on top)
	var mt := model.transform
	for name in SPOTS:
		var z: float = SPOTS[name][0]
		var y: float = SPOTS[name][1]
		for side in [-1, 1]:
			var from := mt.affine_inverse() * Vector3(side * 12, y, z)
			var dir := (mt.basis.inverse() * Vector3(-side, 0, 0)).normalized()
			var hit := Models.raycast(meshes, model, from, dir, 12.5)
			if hit.is_empty():
				continue
			var p: Vector3 = mt * hit.point
			# the skin's facing there (kept upright: only its lean in and out, its sweep fore and aft)
			var n: Vector3 = (mt.basis * hit.normal).normalized()
			if n.x * side < 0.0:
				n = -n # (Godot's winding: the face's normal may come the other way round)
			if n.x * side < 0.3:
				n = Vector3(side, 0, 0) # (a face seen from inside, or edge-on: straight out of that side)
			out["%s%d" % [name, side]] = {p = p, n = n.normalized(), side = side}
	model.set_meta("mark_anchors", out)
	return out

## Paint ident's markings on model (repainted when the model goes to another bomber, or her identity changes).
static func apply_markings(model: Node3D, ident) -> void:
	if not model or not model.get_parent():
		return
	var key: String = "%s|%s|%s|%s" % [ident.group, ident.get("serial"), ident.get("code"), ident.get("nickname")] if ident else ""
	if model.get_meta("mark_key", null) == key:
		return
	model.set_meta("mark_key", key)
	var old = model.get_meta("markings", null)
	if old and is_instance_valid(old):
		old.get_parent().remove_child(old)
		old.queue_free()
	model.remove_meta("markings")
	if not ident or not ident.get("group"):
		return
	var at := _anchors(model)
	var g := Node3D.new()
	g.name = "markings"
	g.transform = model.transform.affine_inverse() # (in the bomber's frame, though hung on the model)
	# facing out of the skin, upright, reading towards the nose on the right side and the tail on the left
	# (as you look at either side), held a few centimetres off it so a curve doesn't swallow its edges
	var frame := func(a: Dictionary, lift: float) -> Transform3D:
		var right := Vector3.UP.cross(a.n).normalized()
		var up2: Vector3 = a.n.cross(right)
		return Transform3D(Basis(right, up2, a.n), a.p + a.n * lift)
	var quad := func(spot: String, tex: Texture2D, w: float, h: float):
		for side in [-1, 1]:
			if not at.has("%s%d" % [spot, side]):
				continue
			var m := MeshInstance3D.new()
			var q := QuadMesh.new()
			q.size = Vector2(w, h)
			m.mesh = q
			m.material_override = _mat(tex)
			m.transform = frame.call(at["%s%d" % [spot, side]], 0.05)
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			g.add_child(m)
	# text: `px` the canvas height it was drawn in and `h` the height that canvas covered on her, so the
	# letters are the size they were
	var text := func(spot: String, s: String, color: String, font: SystemFont, size: int, px: float, h: float, lift := 0.05, dy := 0.0):
		for side in [-1, 1]:
			if not at.has("%s%d" % [spot, side]):
				continue
			var l := Label3D.new()
			l.text = s
			l.font = font
			l.font_size = size
			l.pixel_size = h / px
			l.modulate = Color(color)
			l.outline_size = 0
			l.shaded = true
			l.double_sided = false
			l.alpha_cut = Label3D.ALPHA_CUT_DISCARD
			l.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			l.transform = frame.call(at["%s%d" % [spot, side]], lift)
			l.position += l.transform.basis.y * dy
			g.add_child(l)
	if GROUP_SYMBOL.has(ident.group):
		var sym: Array = GROUP_SYMBOL[ident.group]
		quad.call("fin", _shape_tex(sym[0]), 0.95, 0.95)
		# (the letter in the olive drab, on the symbol: lower in the triangle, in the square's middle)
		var tri: bool = sym[0] == "triangle"
		text.call("fin", sym[1], "#4b4f30", _font(STENCIL), 118 if tri else 140, 256.0, 0.95, 0.052, -(0.62 - 0.5) * 0.95 if tri else -6.0 / 256 * 0.95)
	var tail = tail_number(ident.get("serial"))
	if tail:
		text.call("tail", tail, "#e3c03a", _font(STENCIL), 104, 128.0, 0.38)
	var cl := str(ident.get("code") if ident.get("code") else "").split("-")
	if cl[0] != "":
		text.call("code", cl[0], "#c9c9bd", _font(STENCIL), 112, 128.0, 0.65)
	if cl.size() > 1 and cl[1] != "":
		text.call("letter", cl[1], "#c9c9bd", _font(STENCIL), 112, 128.0, 0.8)
	if ident.get("nickname"):
		text.call("name", ident.nickname, "#eeeadf", _font(["Georgia", "serif"], true), 64, 128.0, 0.3)
	model.add_child(g)
	model.set_meta("markings", g)
