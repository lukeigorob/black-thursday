extends Container
# A box as menus.css draws them: a background (flat, or a gradient, chamfered, grained: ui/deco.gdshader),
# a drop shadow, padding round its children, and, as a button, the hover / press / focus states (a lift, a
# brighter fill, a ring). Its children are laid out on top of each other inside the padding, like a
# MarginContainer; put a VBox or HBox inside for rows.
#
# look keys: bg (Color), grad ([[stop 0..1, Color], ...] up to 4) and angle (CSS degrees), cut (the chamfer, px),
# radius, ring ([px, Color]: an inset ring), ring2 ([px, Color, gap]), border ([l, t, r, b] px) with border_color,
# top / bottom (Color: a 1 px line inside the top, 2 px inside the bottom), shadow ([y offset, blur, Color]),
# grain (0..1, multiplied in), vignette (Color: the paper's darker edges), bright (a brightness filter, 1 = none).

signal pressed

const DECO := preload("res://ui/deco.gdshader")

var pad := [0.0, 0.0, 0.0, 0.0] # CSS order: top, right, bottom, left
var look := {}
var hover_look := {} # merged over look while the pointer's on it or it has the keyboard focus
var press_look := {}
var focus_ring := Color(0, 0, 0, 0) # (outline: 2px solid, offset 3px, while it has the keyboard focus)
var lift := 0.0 # px it rises while hovered (transform: translateY(-n))
var press_sink := 1.0 # px it sinks while pressed
var button := false
var disabled := false: set = set_disabled
var armed := false # (pressed down on it)
var hovered := false
var min_w := 0.0
var min_h := 0.0
var _bg: ColorRect
var _mat: ShaderMaterial
var _flat := StyleBoxFlat.new()
var _shadow := StyleBoxFlat.new()
var _y := 0.0 # the lift now (eases)

func _init(l: Dictionary = {}, p = 0.0, is_button := false) -> void:
	look = l
	pad = p if p is Array else [p, p, p, p]
	button = is_button
	mouse_filter = MOUSE_FILTER_STOP if button else MOUSE_FILTER_IGNORE
	if button:
		focus_mode = FOCUS_ALL
		mouse_default_cursor_shape = CURSOR_POINTING_HAND
		mouse_entered.connect(func(): hovered = true; _refresh())
		mouse_exited.connect(func(): hovered = false; armed = false; _refresh())
		focus_entered.connect(_refresh)
		focus_exited.connect(_refresh)
	_bg = ColorRect.new()
	_bg.mouse_filter = MOUSE_FILTER_IGNORE
	_bg.show_behind_parent = false
	_mat = ShaderMaterial.new()
	_mat.shader = DECO
	_bg.material = _mat
	add_child(_bg, false, INTERNAL_MODE_FRONT)
	_shadow.draw_center = false
	resized.connect(_refresh)
	_refresh()

func set_disabled(v: bool) -> void:
	disabled = v
	if button:
		mouse_default_cursor_shape = CURSOR_ARROW if v else CURSOR_POINTING_HAND
		focus_mode = FOCUS_NONE if v else FOCUS_ALL
	_refresh()

func set_look(l: Dictionary) -> void:
	look = l
	_refresh()

func _cur() -> Dictionary:
	var l := look.duplicate()
	if button and not disabled and (hovered or has_focus()):
		l.merge(hover_look, true)
	if button and not disabled and armed:
		l.merge(press_look, true)
	return l

func _refresh() -> void:
	if not is_instance_valid(_bg):
		return
	var l := _cur()
	var want := lift if button and not disabled and (hovered or has_focus()) else 0.0
	if armed and button and not disabled:
		want = -press_sink
	if want != _y:
		_y = want
		queue_sort()
	var shaded: bool = l.has("grad") or l.get("cut", 0.0) > 0.0 or l.get("grain", 0.0) > 0.0 or l.has("vignette")
	_bg.visible = shaded
	if shaded:
		_bg.position = Vector2(0, -_y)
		_bg.size = size
		var g: Array = l.get("grad", [[0.0, l.get("bg", Color(0, 0, 0, 0))]])
		_mat.set_shader_parameter("size", size)
		_mat.set_shader_parameter("cut", l.get("cut", 0.0))
		_mat.set_shader_parameter("radius", l.get("radius", 0.0))
		_mat.set_shader_parameter("angle", l.get("angle", 180.0))
		_mat.set_shader_parameter("n", g.size())
		var st := Vector4(0, 1, 1, 1)
		for i in 4:
			var s = g[min(i, g.size() - 1)]
			_mat.set_shader_parameter("c%d" % i, s[1])
			st[i] = s[0]
		_mat.set_shader_parameter("stops", st)
		var r = l.get("ring", [0.0, Color(0, 0, 0, 0)])
		_mat.set_shader_parameter("ring1", r[0])
		_mat.set_shader_parameter("ring1_color", r[1])
		var r2 = l.get("ring2", [0.0, Color(0, 0, 0, 0), 0.0])
		_mat.set_shader_parameter("ring2", r2[0])
		_mat.set_shader_parameter("ring2_color", r2[1])
		_mat.set_shader_parameter("ring2_gap", r2[2])
		_mat.set_shader_parameter("top_color", l.get("top", Color(0, 0, 0, 0)))
		_mat.set_shader_parameter("bottom_color", l.get("bottom", Color(0, 0, 0, 0)))
		_mat.set_shader_parameter("grain", l.get("grain", 0.0))
		_mat.set_shader_parameter("vignette", l.get("vignette", Color(0, 0, 0, 0)))
	var b: float = l.get("bright", 1.0)
	self_modulate = Color(b, b, b)
	_bg.modulate = Color(b, b, b)
	queue_redraw()

func _draw() -> void:
	var l := _cur()
	var rect := Rect2(Vector2(0, -_y), size)
	var sh = l.get("shadow", null)
	var rad: float = l.get("radius", 0.0)
	if sh:
		_shadow.shadow_offset = Vector2(0, sh[0])
		_shadow.shadow_size = int(sh[1])
		_shadow.shadow_color = sh[2]
		_shadow.set_corner_radius_all(int(rad))
		draw_style_box(_shadow, rect)
	var glow = l.get("glow", null) # (a second, coloured shadow: the role card's accent glow)
	if glow:
		_shadow.shadow_offset = Vector2.ZERO
		_shadow.shadow_size = int(glow[0])
		_shadow.shadow_color = glow[1]
		draw_style_box(_shadow, rect)
	if not _bg.visible:
		_flat.bg_color = l.get("bg", Color(0, 0, 0, 0))
		_flat.set_corner_radius_all(int(rad))
		_flat.corner_detail = 6
		var bw = l.get("border", [0, 0, 0, 0])
		var r = l.get("ring", null)
		if r:
			bw = [r[0], r[0], r[0], r[0]]
			_flat.border_color = r[1]
		else:
			_flat.border_color = l.get("border_color", Color(0, 0, 0, 0))
		_flat.border_width_left = int(bw[0])
		_flat.border_width_top = int(bw[1])
		_flat.border_width_right = int(bw[2])
		_flat.border_width_bottom = int(bw[3])
		_flat.anti_aliasing = rad > 0.0
		draw_style_box(_flat, rect)
	if button and not disabled and focus_ring.a > 0.0 and has_focus() and not hovered:
		draw_rect(rect.grow(4.0), focus_ring, false, 2.0)

func _notification(what: int) -> void:
	if what == NOTIFICATION_SORT_CHILDREN:
		var r := Rect2(Vector2(pad[3], pad[0] - _y), size - Vector2(pad[1] + pad[3], pad[0] + pad[2]))
		for c in get_children():
			if c is Control and c.visible:
				fit_child_in_rect(c, r)
		if is_instance_valid(_bg):
			_bg.position = Vector2(0, -_y)
			_bg.size = size

func _get_minimum_size() -> Vector2:
	var m := Vector2.ZERO
	for c in get_children():
		if c is Control and c.visible:
			m = m.max(c.get_combined_minimum_size())
	return Vector2(maxf(min_w, m.x + pad[1] + pad[3]), maxf(min_h, m.y + pad[0] + pad[2]))

func _gui_input(e: InputEvent) -> void:
	if not button or disabled:
		return
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			armed = true
			_refresh()
			accept_event()
		elif armed:
			armed = false
			_refresh()
			accept_event()
			if Rect2(Vector2.ZERO, size).has_point(e.position):
				pressed.emit()
	elif e is InputEventKey and e.pressed and not e.echo and (e.keycode == KEY_ENTER or e.keycode == KEY_KP_ENTER or e.keycode == KEY_SPACE):
		accept_event()
		pressed.emit()
