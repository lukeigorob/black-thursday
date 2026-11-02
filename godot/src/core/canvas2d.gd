extends RefCounted
# The browser's canvas 2D API, for the textures the web game paints (src/*.js: getContext('2d') then a
# CanvasTexture). The same names in snake_case and the same behaviour, so a port reads line for line:
#
#   var g := Canvas2D.new(256, 256)
#   g.fill_style = "#3a3a2a"; g.fill_rect(0, 0, 256, 256)
#   g.begin_path(); g.arc(128, 128, 90, 0, TAU); g.stroke()
#   material.albedo_texture = g.texture()
#
# The calls are recorded, then drawn on the GPU in a SubViewport over the next frames: texture() returns an
# ImageTexture at once that fills itself in when the drawing is done; `await g.image()` waits for the pixels.
# Drawing more and calling texture() again redraws into the same texture (live instruments).
#
# How it draws: every fill and stroke is turned into its outline polygons (curves flattened to a tenth of a
# pixel, strokes outlined with their joins and caps as Skia does) and a shader counts the winding number at 16
# points in each pixel, so self-intersections, holes, nonzero and evenodd all come out right, antialiased as
# finely as Chrome's. Gradients and patterns are worked out per pixel in the same shader. Text is Godot's own
# font rendering of the same system fonts Chrome picks. Compositing (lighter, destination-in, source-atop),
# clip(), shadows and filter: blur() are separate passes, as the browser does them.
#
# Colours: like the browser's canvas, everything is in sRGB and stored unpremultiplied in the texture, so the
# texture used as an albedo (which Godot reads as sRGB, as Three does with colorSpace = SRGBColorSpace) looks
# the same. A texture used as data (a mask, a bump map) wants its material to read it raw, as in Three.

signal rendered # (each time a drawing has reached the texture)
signal _drawn

const _TOL := 0.1 # (how far a flattened curve may stray from the true one, in pixels)
const _EDGE_W := 4096 # (the width of the edge data texture)
const _BAND := 16 # (rows of pixels each band of a fill covers: the shader only looks at that band's edges)

var width: int:
	set(v):
		width = maxi(0, v)
		_reset()
var height: int:
	set(v):
		height = maxi(0, v)
		_reset()
## The canvas itself (ported code reads `g.canvas`: here the canvas and its context are the one object).
var canvas: RefCounted:
	get:
		return self

var fill_style: Variant = "#000000":
	set(v):
		var p = _paint(v)
		if p != null:
			fill_style = v
			_st.fill = p
var stroke_style: Variant = "#000000":
	set(v):
		var p = _paint(v)
		if p != null:
			stroke_style = v
			_st.stroke = p
var line_width := 1.0:
	set(v):
		if v > 0.0 and is_finite(v):
			line_width = v
var line_cap := "butt"
var line_join := "miter"
var miter_limit := 10.0
var line_dash_offset := 0.0
var global_alpha := 1.0:
	set(v):
		if v >= 0.0 and v <= 1.0:
			global_alpha = v
## source-over, lighter, destination-in and source-atop (what src uses); anything else draws as source-over.
var global_composite_operation := "source-over"
var font := "10px sans-serif":
	set(v):
		var f = _parse_font(v)
		if f != null:
			font = v
			_st.font = f
var text_align := "start"
var text_baseline := "alphabetic"
var shadow_blur := 0.0
var shadow_color: Variant = "rgba(0, 0, 0, 0)":
	set(v):
		var c = css_color(v)
		if c != null:
			shadow_color = v
			_st.shadow_color = c
var shadow_offset_x := 0.0
var shadow_offset_y := 0.0
## "none" or "blur(Npx)" (the only filter src uses).
var filter := "none":
	set(v):
		var m := RegEx.create_from_string("^\\s*blur\\(\\s*([0-9.]+)\\s*(px)?\\s*\\)\\s*$").search(v)
		if v.strip_edges() == "none" or v.strip_edges() == "":
			filter = v
			_st.blur = 0.0
		elif m:
			filter = v
			_st.blur = m.get_string(1).to_float()
		else:
			push_warning("Canvas2D: filter '%s' not supported" % v)
var image_smoothing_enabled := true

var _st := {fill = Color.BLACK, stroke = Color.BLACK, font = null, shadow_color = Color(0, 0, 0, 0), blur = 0.0}
var _t := Transform2D.IDENTITY
var _clip: Array = []
var _dash := PackedFloat32Array()
var _stack: Array = []
var _subs: Array = [] # the current path: [{pts = PackedVector2Array (canvas pixels), closed = bool}]
var _ops: Array = []
var _serial := 0
var _tex: ImageTexture
var _tex_mipmaps := false
var _tex_shape := []
var _tex_serial := -1
var _img: Image
var _img_serial := -1
var _busy_serial := -1
var _premul: ImageTexture # (this canvas as a source for draw_image / create_pattern)
var _premul_serial := -1

static var _serials := 0


func _init(w := 300, h := 150) -> void:
	width = w
	height = h
	font = "10px sans-serif"


func _reset() -> void:
	_ops = []
	_subs = []
	_stack = []
	_t = Transform2D.IDENTITY
	_clip = []
	_dash = PackedFloat32Array()
	_bump()


func _bump() -> void:
	_serials += 1
	_serial = _serials


# ---------------------------------------------------------------- the result

## The canvas as a texture, returned at once and filled in when the drawing has rendered (a frame or a few).
## Call again after drawing more to redraw it into the same texture.
func texture(mipmaps := false) -> ImageTexture:
	if _tex == null:
		var blank := Image.create(maxi(1, width), maxi(1, height), false, Image.FORMAT_RGBA8)
		_tex = ImageTexture.create_from_image(blank)
	_tex_mipmaps = mipmaps
	if _tex_serial != _serial:
		_tex_serial = _serial
		_fill_texture()
	return _tex


func _fill_texture() -> void:
	var s := _serial
	var img: Image = await image()
	if s != _tex_serial or img == null:
		return
	if _tex_mipmaps:
		img = img.duplicate()
		img.generate_mipmaps()
	var shape := [img.get_width(), img.get_height(), img.get_format(), img.has_mipmaps()]
	if shape == _tex_shape: # (ImageTexture.has_mipmaps() doesn't say, so it's remembered)
		_tex.update(img)
	else:
		_tex.set_image(img)
		_tex_shape = shape
	rendered.emit()


## The canvas's pixels (RGBA8, unpremultiplied, rows top down), once drawn: `var img: Image = await g.image()`.
func image() -> Image:
	while true:
		if _img_serial == _serial:
			return _img
		if _busy_serial != _serial:
			break
		await _drawn
	var s := _serial
	_busy_serial = s
	var res: Dictionary = await _run(_ops.duplicate(), width, height, true)
	if s >= _img_serial:
		_img = res.straight
		_img_serial = s
		if res.premul_tex:
			_premul = res.premul_tex
			_premul_serial = s
	if _busy_serial == s:
		_busy_serial = -1
	_drawn.emit()
	return res.straight


## getImageData: `var d = await g.get_image_data(0, 0, w, h)`, then d.data[(y * d.width + x) * 4 + c].
func get_image_data(sx: int, sy: int, sw: int, sh: int) -> ImageData:
	var img: Image = await image()
	var d := ImageData.new(sw, sh)
	var part := Image.create(sw, sh, false, Image.FORMAT_RGBA8)
	part.blit_rect(img, Rect2i(sx, sy, sw, sh), Vector2i.ZERO)
	d.data = part.get_data()
	return d


func create_image_data(w: int, h: int) -> ImageData:
	return ImageData.new(w, h)


## putImageData: the pixels replace what's there (no blending, no transform, no clip). An ImageData or an Image.
func put_image_data(src, dx: int, dy: int) -> void:
	var img: Image
	if src is Image:
		img = src.duplicate()
		img.convert(Image.FORMAT_RGBA8)
	else:
		img = Image.create_from_data(src.width, src.height, false, Image.FORMAT_RGBA8, src.data)
	img.premultiply_alpha()
	_ops.append({k = "put", tex = ImageTexture.create_from_image(img), rect = Rect2(dx, dy, img.get_width(), img.get_height())})
	_bump()


# ---------------------------------------------------------------- state

func save() -> void:
	_stack.append({
		fill_style = fill_style, stroke_style = stroke_style, line_width = line_width, line_cap = line_cap,
		line_join = line_join, miter_limit = miter_limit, line_dash_offset = line_dash_offset,
		global_alpha = global_alpha, global_composite_operation = global_composite_operation, font = font,
		text_align = text_align, text_baseline = text_baseline, shadow_blur = shadow_blur,
		shadow_color = shadow_color, shadow_offset_x = shadow_offset_x, shadow_offset_y = shadow_offset_y,
		filter = filter, image_smoothing_enabled = image_smoothing_enabled,
		st = _st.duplicate(), t = _t, clip = _clip, dash = _dash,
	})


func restore() -> void:
	if _stack.is_empty():
		return
	var s: Dictionary = _stack.pop_back()
	for k in s:
		if k == "st":
			_st = s.st
		elif k == "t":
			_t = s.t
		elif k == "clip":
			_clip = s.clip
		elif k == "dash":
			_dash = s.dash
		else:
			set(k, s[k])


func translate(x: float, y: float) -> void:
	_t = _t * Transform2D(Vector2(1, 0), Vector2(0, 1), Vector2(x, y))


func rotate(a: float) -> void:
	_t = _t * Transform2D(a, Vector2.ZERO)


func scale(x: float, y: float) -> void:
	_t = _t * Transform2D(Vector2(x, 0), Vector2(0, y), Vector2.ZERO)


## set_transform(a, b, c, d, e, f) as in the browser, or set_transform(Transform2D).
func set_transform(a: Variant, b := 0.0, c := 0.0, d := 1.0, e := 0.0, f := 0.0) -> void:
	_t = a if a is Transform2D else Transform2D(Vector2(a, b), Vector2(c, d), Vector2(e, f))


func transform(a: float, b: float, c: float, d: float, e: float, f: float) -> void:
	_t = _t * Transform2D(Vector2(a, b), Vector2(c, d), Vector2(e, f))


func reset_transform() -> void:
	_t = Transform2D.IDENTITY


func get_transform() -> Transform2D:
	return _t


func set_line_dash(segments: Array) -> void:
	for v in segments:
		if v < 0.0 or not is_finite(v):
			return
	var d := PackedFloat32Array(segments)
	if d.size() % 2 == 1:
		d.append_array(PackedFloat32Array(segments))
	_dash = d


func get_line_dash() -> Array:
	return Array(_dash)


# ---------------------------------------------------------------- paths

func begin_path() -> void:
	_subs = []


func move_to(x: float, y: float) -> void:
	_subs.append({pts = PackedVector2Array([_t * Vector2(x, y)]), closed = false})


func line_to(x: float, y: float) -> void:
	if _subs.is_empty():
		move_to(x, y)
	else:
		_subs[-1].pts.append(_t * Vector2(x, y))


func close_path() -> void:
	if _subs.is_empty():
		return
	var s: Dictionary = _subs[-1]
	s.closed = true
	_subs.append({pts = PackedVector2Array([s.pts[0]]), closed = false})


func _cur_user() -> Vector2:
	return _t.affine_inverse() * _subs[-1].pts[-1]


func _ensure(x: float, y: float) -> void:
	if _subs.is_empty():
		move_to(x, y)


func quadratic_curve_to(cx: float, cy: float, x: float, y: float) -> void:
	_ensure(cx, cy)
	var p0: Vector2 = _subs[-1].pts[-1]
	var p1 := _t * Vector2(cx, cy)
	var p2 := _t * Vector2(x, y)
	var dd := (p0 - 2.0 * p1 + p2).length()
	var n := clampi(ceili(sqrt(dd / (4.0 * _TOL))), 1, 512)
	for i in range(1, n + 1):
		var u := float(i) / n
		_subs[-1].pts.append(p0 * (1 - u) * (1 - u) + p1 * 2.0 * u * (1 - u) + p2 * u * u)


func bezier_curve_to(c1x: float, c1y: float, c2x: float, c2y: float, x: float, y: float) -> void:
	_ensure(c1x, c1y)
	var p0: Vector2 = _subs[-1].pts[-1]
	var p1 := _t * Vector2(c1x, c1y)
	var p2 := _t * Vector2(c2x, c2y)
	var p3 := _t * Vector2(x, y)
	var dd := maxf((p0 - 2.0 * p1 + p2).length(), (p1 - 2.0 * p2 + p3).length())
	var n := clampi(ceili(sqrt(3.0 * dd / (4.0 * _TOL))), 1, 512)
	for i in range(1, n + 1):
		var u := float(i) / n
		var v := 1.0 - u
		_subs[-1].pts.append(p0 * v * v * v + p1 * 3.0 * u * v * v + p2 * 3.0 * u * u * v + p3 * u * u * u)


func arc(x: float, y: float, r: float, a0: float, a1: float, anticlockwise := false) -> void:
	ellipse(x, y, r, r, 0.0, a0, a1, anticlockwise)


func ellipse(x: float, y: float, rx: float, ry: float, rot: float, a0: float, a1: float, anticlockwise := false) -> void:
	if rx < 0.0 or ry < 0.0:
		push_error("Canvas2D: negative radius")
		return
	var sweep := a1 - a0 # (Chrome's rules: a turn the wrong way goes round the long way, a whole turn included)
	if not anticlockwise:
		if sweep >= TAU:
			sweep = TAU
		elif sweep < 0.0:
			sweep = TAU - fmod(-sweep, TAU)
	else:
		if sweep <= -TAU:
			sweep = -TAU
		elif sweep > 0.0:
			sweep = -(TAU - fmod(sweep, TAU))
	var rdev := maxf(rx, ry) * _scale()
	var step := TAU / 4.0
	if rdev > _TOL:
		step = 2.0 * acos(clampf(1.0 - _TOL / rdev, -1.0, 1.0))
	var n := clampi(ceili(absf(sweep) / maxf(step, 1e-4)), 1, 2048)
	var cr := cos(rot)
	var sr := sin(rot)
	for i in range(n + 1):
		var a := a0 + sweep * i / n
		var ex := rx * cos(a)
		var ey := ry * sin(a)
		var p := Vector2(x + ex * cr - ey * sr, y + ex * sr + ey * cr)
		if i == 0 and _subs.is_empty():
			move_to(p.x, p.y)
		else:
			line_to(p.x, p.y)


func arc_to(x1: float, y1: float, x2: float, y2: float, r: float) -> void:
	_ensure(x1, y1)
	var p0 := _cur_user()
	var p1 := Vector2(x1, y1)
	var p2 := Vector2(x2, y2)
	var v1 := p0 - p1
	var v2 := p2 - p1
	if r == 0.0 or v1.length() < 1e-9 or v2.length() < 1e-9 or absf(v1.normalized().cross(v2.normalized())) < 1e-9:
		line_to(x1, y1)
		return
	v1 = v1.normalized()
	v2 = v2.normalized()
	var th := acos(clampf(v1.dot(v2), -1.0, 1.0))
	var d := r / tan(th / 2.0)
	var c := p1 + (v1 + v2).normalized() * (r / sin(th / 2.0))
	var t1 := p1 + v1 * d
	var t2 := p1 + v2 * d
	line_to(t1.x, t1.y)
	var ccw := (p1 - p0).cross(p2 - p1) < 0.0
	arc(c.x, c.y, r, (t1 - c).angle(), (t2 - c).angle(), ccw)


func rect(x: float, y: float, w: float, h: float) -> void:
	move_to(x, y)
	line_to(x + w, y)
	line_to(x + w, y + h)
	line_to(x, y + h)
	close_path()


## round_rect(x, y, w, h, radii): radii a number or 1 to 4 numbers, as in the browser.
func round_rect(x: float, y: float, w: float, h: float, radii: Variant = 0.0) -> void:
	var r: Array = radii if radii is Array else [radii]
	var tl: float
	var tr: float
	var br: float
	var bl: float
	match r.size():
		1:
			tl = r[0]; tr = r[0]; br = r[0]; bl = r[0]
		2:
			tl = r[0]; br = r[0]; tr = r[1]; bl = r[1]
		3:
			tl = r[0]; tr = r[1]; bl = r[1]; br = r[2]
		_:
			tl = r[0]; tr = r[1]; br = r[2]; bl = r[3]
	var k := 1.0
	for pair in [[tl + tr, absf(w)], [bl + br, absf(w)], [tl + bl, absf(h)], [tr + br, absf(h)]]:
		if pair[0] > 0.0:
			k = minf(k, pair[1] / pair[0])
	tl *= k; tr *= k; br *= k; bl *= k
	move_to(x + tl, y)
	line_to(x + w - tr, y)
	if tr > 0.0: arc(x + w - tr, y + tr, tr, -PI / 2, 0.0)
	line_to(x + w, y + h - br)
	if br > 0.0: arc(x + w - br, y + h - br, br, 0.0, PI / 2)
	line_to(x + bl, y + h)
	if bl > 0.0: arc(x + bl, y + h - bl, bl, PI / 2, PI)
	line_to(x, y + tl)
	if tl > 0.0: arc(x + tl, y + tl, tl, PI, PI * 1.5)
	close_path()
	move_to(x, y)


func _scale() -> float:
	return maxf(_t.x.length(), _t.y.length())


# ---------------------------------------------------------------- drawing

func fill(rule := "nonzero") -> void:
	_add_fill(_fill_polys(_subs), rule == "evenodd", _st.fill)


func stroke() -> void:
	_add_fill(_stroke_polys(_subs), false, _st.stroke)


func clip(rule := "nonzero") -> void:
	_clip = _clip + [{polys = _fill_polys(_subs), evenodd = rule == "evenodd"}]


func fill_rect(x: float, y: float, w: float, h: float) -> void:
	_add_fill([_rect_poly(x, y, w, h)], false, _st.fill)


func stroke_rect(x: float, y: float, w: float, h: float) -> void:
	var keep := _subs
	_subs = []
	rect(x, y, w, h)
	stroke()
	_subs = keep


func clear_rect(x: float, y: float, w: float, h: float) -> void:
	var p := _rect_poly(x, y, w, h)
	var bb := _bbox([p])
	# (the whole canvas cleared, straight: everything before it can go)
	if _clip.is_empty() and absf(_t.x.y) < 1e-9 and absf(_t.y.x) < 1e-9 and bb.position.x <= 0 and bb.position.y <= 0 and bb.end.x >= width and bb.end.y >= height:
		_ops = []
	else:
		_ops.append({k = "clear", polys = [p]})
	_bump()


func _rect_poly(x: float, y: float, w: float, h: float) -> PackedVector2Array:
	return PackedVector2Array([_t * Vector2(x, y), _t * Vector2(x + w, y), _t * Vector2(x + w, y + h), _t * Vector2(x, y + h)])


func _common() -> Dictionary:
	var sh = null
	var sc: Color = _st.shadow_color
	if sc.a > 0.0 and (shadow_blur > 0.0 or shadow_offset_x != 0.0 or shadow_offset_y != 0.0):
		sh = {color = sc, blur = shadow_blur, off = Vector2(shadow_offset_x, shadow_offset_y)}
	return {comp = global_composite_operation, clip = _clip, shadow = sh, blur = _st.blur, alpha = global_alpha}


func _add_fill(polys: Array, evenodd: bool, paint) -> void:
	if polys.is_empty():
		return
	var op := _common()
	op.k = "fill"
	op.polys = polys
	op.evenodd = evenodd
	op.paint = _bind_paint(paint)
	_ops.append(op)
	_bump()


# a paint fixed at the moment it's used: gradients and patterns lie in the user space of that moment
func _bind_paint(p) -> Variant:
	if p is Color:
		return p
	return {src = p, inv = _t.affine_inverse()}


func _fill_polys(subs: Array) -> Array:
	var out := []
	for s in subs:
		if s.pts.size() >= 3:
			out.append(s.pts)
	return out


# The stroke's outline: a quad for each segment, a piece for each join and cap, all wound the same way so
# the nonzero fill makes them one shape however they overlap (as Skia's stroker does).
func _stroke_polys(subs: Array) -> Array:
	var det := _t.determinant()
	if absf(det) < 1e-12:
		return []
	var inv := _t.affine_inverse()
	var hw := line_width / 2.0
	var rdev := hw * _scale()
	var step := PI / 2
	if rdev > _TOL:
		step = 2.0 * acos(clampf(1.0 - _TOL / rdev, -1.0, 1.0))
	var pieces := []
	for s in subs:
		var raw: PackedVector2Array = s.pts
		var pts := PackedVector2Array()
		for p in raw:
			var u := inv * p
			if pts.is_empty() or pts[-1].distance_squared_to(u) > 1e-12:
				pts.append(u)
		var closed: bool = s.closed
		if closed and pts.size() > 1 and pts[0].distance_squared_to(pts[-1]) < 1e-12:
			pts.remove_at(pts.size() - 1)
		if pts.size() == 1:
			if raw.size() >= 2 or closed: # (a zero-length line: round and square caps still show)
				if line_cap == "round":
					pieces.append(_circle(pts[0], hw, step))
				elif line_cap == "square":
					var c: Vector2 = pts[0]
					pieces.append(PackedVector2Array([c + Vector2(-hw, -hw), c + Vector2(hw, -hw), c + Vector2(hw, hw), c + Vector2(-hw, hw)]))
			continue
		if pts.size() < 2:
			continue
		if _dash.size() > 0 and _dash_len() > 0.0:
			for d in _dashes(pts, closed):
				_outline(d, false, hw, step, pieces)
		else:
			_outline(pts, closed, hw, step, pieces)
	var out := []
	for p in pieces:
		var q := PackedVector2Array()
		q.resize(p.size())
		for i in p.size():
			q[i] = _t * p[i]
		var a := _area(q)
		if absf(a) < 1e-9:
			continue
		if a < 0.0:
			q.reverse()
		out.append(q)
	return out


func _dash_len() -> float:
	var t := 0.0
	for v in _dash:
		t += v
	return t


func _dashes(pts: PackedVector2Array, closed: bool) -> Array:
	var poly := pts.duplicate()
	if closed:
		poly.append(pts[0])
	var out := []
	var total := _dash_len()
	var pos := fposmod(line_dash_offset, total)
	var di := 0
	while pos >= _dash[di]:
		pos -= _dash[di]
		di = (di + 1) % _dash.size()
	var left := _dash[di] - pos # (what's left of the current dash or gap)
	var on := di % 2 == 0
	var cur := PackedVector2Array()
	if on:
		cur.append(poly[0])
	for i in range(poly.size() - 1):
		var a: Vector2 = poly[i]
		var b: Vector2 = poly[i + 1]
		var seg := a.distance_to(b)
		var at := 0.0
		while seg - at > left:
			at += left
			var p := a.lerp(b, at / seg)
			if on:
				cur.append(p)
				out.append(cur)
				cur = PackedVector2Array()
			else:
				cur = PackedVector2Array([p])
			on = not on
			di = (di + 1) % _dash.size()
			left = _dash[di]
		left -= seg - at
		if on:
			cur.append(b)
	if on and cur.size() >= 2:
		out.append(cur)
	return out


func _outline(pts: PackedVector2Array, closed: bool, hw: float, step: float, pieces: Array) -> void:
	var n := pts.size()
	var segs := n if closed else n - 1
	for i in segs:
		var a: Vector2 = pts[i]
		var b: Vector2 = pts[(i + 1) % n]
		var nn := (b - a).normalized().orthogonal() * hw
		pieces.append(PackedVector2Array([a + nn, b + nn, b - nn, a - nn]))
	# joins
	var from := 0 if closed else 1
	var to := n if closed else n - 1
	for i in range(from, to):
		var v: Vector2 = pts[i]
		var d0 := (v - pts[(i - 1 + n) % n]).normalized()
		var d1 := (pts[(i + 1) % n] - v).normalized()
		var cr := d0.cross(d1)
		var dt := d0.dot(d1)
		if absf(cr) < 1e-6 and dt > 0.0:
			continue
		var sgn := 1.0 if cr > 0.0 else -1.0 # (the outside of the turn; Vector2.orthogonal() turns right)
		var o0 := d0.orthogonal() * hw * sgn
		var o1 := d1.orthogonal() * hw * sgn
		if line_join == "round":
			var a0 := o0.angle()
			var sweep := wrapf(o1.angle() - a0, -PI, PI)
			if absf(cr) < 1e-6: # (turning straight back: round the end, ahead)
				sweep = PI if o0.rotated(PI / 2).dot(d0) > 0.0 else -PI
			var m := maxi(1, ceili(absf(sweep) / step))
			var poly := PackedVector2Array([v])
			for k in range(m + 1):
				poly.append(v + Vector2.from_angle(a0 + sweep * k / m) * hw)
			pieces.append(poly)
		else:
			var cos_half := sqrt(maxf(0.0, (1.0 + dt) / 2.0)) # (cos of half the turn: the miter is 1 / that)
			if line_join == "miter" and cos_half > 1e-6 and 1.0 / cos_half <= miter_limit:
				var mp := v + (o0 + o1).normalized() * hw / cos_half
				pieces.append(PackedVector2Array([v, v + o0, mp, v + o1]))
			else:
				pieces.append(PackedVector2Array([v, v + o0, v + o1]))
	# caps
	if not closed:
		for e in [[pts[0], (pts[0] - pts[1]).normalized()], [pts[n - 1], (pts[n - 1] - pts[n - 2]).normalized()]]:
			var p: Vector2 = e[0]
			var d: Vector2 = e[1]
			if line_cap == "round":
				pieces.append(_circle(p, hw, step))
			elif line_cap == "square":
				var nn := d.orthogonal() * hw
				pieces.append(PackedVector2Array([p + nn, p + nn + d * hw, p - nn + d * hw, p - nn]))


func _circle(c: Vector2, r: float, step: float) -> PackedVector2Array:
	var m := clampi(ceili(TAU / step), 8, 1024)
	var poly := PackedVector2Array()
	for k in m:
		poly.append(c + Vector2.from_angle(TAU * k / m) * r)
	return poly


static func _area(p: PackedVector2Array) -> float:
	var a := 0.0
	var n := p.size()
	for i in n:
		a += p[i].cross(p[(i + 1) % n])
	return a / 2.0


static func _bbox(polys: Array) -> Rect2:
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for p in polys:
		for v in p:
			lo = lo.min(v)
			hi = hi.max(v)
	return Rect2(lo, hi - lo)


# ---------------------------------------------------------------- images

## drawImage: (src, dx, dy), (src, dx, dy, dw, dh) or (src, sx, sy, sw, sh, dx, dy, dw, dh). src: another
## Canvas2D (as it is now: drawing on it later doesn't change this), an Image or a Texture2D.
func draw_image(src, a: float, b: float, c := NAN, d := NAN, e := NAN, f := NAN, g := NAN, h := NAN) -> void:
	var s := _source(src)
	if s.is_empty():
		return
	var sr: Rect2
	var dr: Rect2
	if is_nan(c):
		sr = Rect2(0, 0, s.w, s.h)
		dr = Rect2(a, b, s.w, s.h)
	elif is_nan(e):
		sr = Rect2(0, 0, s.w, s.h)
		dr = Rect2(a, b, c, d)
	else:
		sr = Rect2(a, b, c, d)
		dr = Rect2(e, f, g, h)
	var op := _common()
	op.k = "image"
	op.src = s
	op.sr = sr
	op.dr = dr
	op.t = _t
	op.smooth = image_smoothing_enabled
	_ops.append(op)
	_bump()


func _source(src) -> Dictionary:
	if src != null and src.get_script() == get_script():
		if src.width == 0 or src.height == 0:
			return {}
		return {canvas = src, ops = src._ops.duplicate(), serial = src._serial, w = src.width, h = src.height}
	var img: Image
	if src is Image:
		img = src.duplicate()
	elif src is Texture2D:
		img = src.get_image()
	if img == null:
		push_error("Canvas2D: can't draw %s" % src)
		return {}
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	img.premultiply_alpha()
	return {tex = ImageTexture.create_from_image(img), w = img.get_width(), h = img.get_height()}


func create_pattern(src, repetition := "repeat") -> CanvasPattern:
	var s := _source(src)
	if s.is_empty():
		return null
	var p := CanvasPattern.new()
	p.src = s
	p.rep_x = repetition in ["repeat", "repeat-x", ""]
	p.rep_y = repetition in ["repeat", "repeat-y", ""]
	p.smooth = image_smoothing_enabled
	return p


func create_linear_gradient(x0: float, y0: float, x1: float, y1: float) -> CanvasGradient:
	var gr := CanvasGradient.new()
	gr.radial = false
	gr.p = [x0, y0, x1, y1]
	return gr


func create_radial_gradient(x0: float, y0: float, r0: float, x1: float, y1: float, r1: float) -> CanvasGradient:
	var gr := CanvasGradient.new()
	gr.radial = true
	gr.p = [x0, y0, r0, x1, y1, r1]
	return gr


# ---------------------------------------------------------------- text

func fill_text(text: String, x: float, y: float, max_width := INF) -> void:
	_add_text(text, x, y, max_width, _st.fill, false)


func stroke_text(text: String, x: float, y: float, max_width := INF) -> void:
	_add_text(text, x, y, max_width, _st.stroke, true)


func measure_text(text: String) -> TextMetrics:
	var f: Dictionary = _st.font
	var m := TextMetrics.new()
	var sz := maxi(1, roundi(f.size))
	var k: float = f.size / sz
	m.width = f.font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x * k
	m.font_bounding_box_ascent = f.font.get_ascent(sz) * k
	m.font_bounding_box_descent = f.font.get_descent(sz) * k
	m.actual_bounding_box_ascent = m.font_bounding_box_ascent
	m.actual_bounding_box_descent = m.font_bounding_box_descent
	var ax := _align_x(m.width)
	m.actual_bounding_box_left = ax
	m.actual_bounding_box_right = m.width - ax
	return m


func _align_x(w: float) -> float:
	match text_align:
		"center":
			return w / 2.0
		"right", "end":
			return w
	return 0.0


func _add_text(text: String, x: float, y: float, max_width: float, paint, outline: bool) -> void:
	if text.is_empty() or max_width <= 0.0:
		return
	var f: Dictionary = _st.font
	var det := absf(_t.determinant())
	if det < 1e-12:
		return
	var sz := maxi(1, roundi(f.size * sqrt(det))) # (rasterised at the size it lands on the canvas)
	var k: float = sz / f.size
	var w: float = f.font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x / k
	var sx := 1.0
	if w > max_width:
		sx = max_width / w
		w = max_width
	var asc: float = f.asc * f.size
	var desc: float = f.size - asc
	var dy := 0.0
	match text_baseline:
		"top":
			dy = asc
		"hanging":
			dy = asc * 0.8
		"middle":
			dy = (asc - desc) / 2.0
		"bottom", "ideographic":
			dy = -desc
	var op := _common()
	op.k = "text"
	op.text = text
	op.font = f.font
	op.size = sz
	op.t = _t * Transform2D(Vector2(sx / k, 0), Vector2(0, 1.0 / k), Vector2(x - _align_x(w), y + dy))
	op.color = paint if paint is Color else _paint_colour(paint)
	op.outline = outline
	op.outline_size = maxi(1, roundi(line_width * k))
	op.bold = 0
	if f.fake_bold: # (Skia's fake bold: a stroke 1/24 of the size at 9pt down to 1/32 from 36pt)
		var pt: float = sz * 0.75
		op.bold = roundi(sz * lerpf(1.0 / 24, 1.0 / 32, clampf((pt - 9.0) / 27.0, 0.0, 1.0)))
	_ops.append(op)
	_bump()


# (text in a gradient or pattern: drawn in its middle colour)
func _paint_colour(p) -> Color:
	if p is CanvasGradient and not p.stops.is_empty():
		return p.stops[p.stops.size() / 2][1]
	return Color.BLACK


# ---------------------------------------------------------------- the classes it hands out

class CanvasGradient:
	extends RefCounted
	var radial := false
	var p: Array = []
	var stops: Array = [] # [[offset, Color]]
	var _ramp: PackedColorArray

	func add_color_stop(offset: float, color: Variant) -> void:
		var c = Canvas2DColour.parse(color)
		if c == null or offset < 0.0 or offset > 1.0:
			push_error("Canvas2D: bad colour stop %s %s" % [offset, color])
			return
		var i := stops.size()
		while i > 0 and stops[i - 1][0] > offset:
			i -= 1
		stops.insert(i, [offset, c])
		_ramp = PackedColorArray()

	# 256 colours along the gradient, interpolated unpremultiplied (as the browser's canvas does)
	func ramp() -> PackedColorArray:
		if not _ramp.is_empty():
			return _ramp
		_ramp.resize(256)
		for i in 256:
			var t := i / 255.0
			var c: Color = stops[0][1]
			for j in stops.size():
				if stops[j][0] <= t:
					c = stops[j][1]
					if j + 1 < stops.size() and stops[j + 1][0] > t:
						var a: float = stops[j][0]
						var b: float = stops[j + 1][0]
						c = (stops[j][1] as Color).lerp(stops[j + 1][1], (t - a) / (b - a))
			_ramp[i] = c
		return _ramp


class CanvasPattern:
	extends RefCounted
	var src: Dictionary
	var rep_x := true
	var rep_y := true
	var smooth := true


class TextMetrics:
	extends RefCounted
	var width := 0.0
	var actual_bounding_box_left := 0.0
	var actual_bounding_box_right := 0.0
	var actual_bounding_box_ascent := 0.0
	var actual_bounding_box_descent := 0.0
	var font_bounding_box_ascent := 0.0
	var font_bounding_box_descent := 0.0


## ImageData: width, height and data (RGBA bytes, unpremultiplied, rows top down), as in the browser.
class ImageData:
	extends RefCounted
	var width: int
	var height: int
	var data: PackedByteArray

	func _init(w := 0, h := 0) -> void:
		width = w
		height = h
		data = PackedByteArray()
		data.resize(w * h * 4)


# ---------------------------------------------------------------- colours and fonts

func _paint(v) -> Variant:
	if v is CanvasGradient:
		return v
	if v is CanvasPattern:
		return v
	return css_color(v)


## A CSS colour (hex, rgb()/rgba(), hsl()/hsla(), a name), an int 0xRRGGBB or a Color, as a Color; null if
## it isn't one.
static func css_color(v) -> Variant:
	return Canvas2DColour.parse(v)


class Canvas2DColour:
	static var _cache := {}

	static func parse(v) -> Variant:
		if v is Color:
			return v
		if v is int:
			return Color.hex((v << 8) | 0xff)
		if not v is String:
			return null
		if _cache.has(v):
			return _cache[v]
		var c = _parse(v.strip_edges().to_lower())
		_cache[v] = c
		return c

	static func _parse(s: String) -> Variant:
		if s.begins_with("#"):
			var h := s.substr(1)
			if not h.is_valid_hex_number():
				return null
			match h.length():
				3, 4:
					var e := ""
					for ch in h:
						e += ch + ch
					h = e
			match h.length():
				6:
					return Color.html(h)
				8:
					return Color(h.substr(0, 2).hex_to_int() / 255.0, h.substr(2, 2).hex_to_int() / 255.0, h.substr(4, 2).hex_to_int() / 255.0, h.substr(6, 2).hex_to_int() / 255.0)
			return null
		var m := RegEx.create_from_string("^(rgba?|hsla?)\\((.*)\\)$").search(s)
		if m:
			var body := m.get_string(2).replace(",", " ").replace("/", " / ")
			var parts := []
			for p in body.split(" ", false):
				parts.append(p)
			var alpha := 1.0
			var slash := parts.find("/")
			if slash >= 0:
				if slash + 1 < parts.size():
					alpha = _num(parts[slash + 1], 1.0)
				parts.resize(slash)
			elif parts.size() == 4:
				alpha = _num(parts[3], 1.0)
				parts.resize(3)
			if parts.size() != 3:
				return null
			alpha = clampf(alpha, 0.0, 1.0)
			if m.get_string(1).begins_with("rgb"):
				return Color(clampf(_num(parts[0], 255.0), 0, 255) / 255.0, clampf(_num(parts[1], 255.0), 0, 255) / 255.0, clampf(_num(parts[2], 255.0), 0, 255) / 255.0, alpha)
			var hh := fposmod(parts[0].trim_suffix("deg").to_float(), 360.0) / 360.0
			var ss := clampf(_num(parts[1], 1.0), 0, 1)
			var ll := clampf(_num(parts[2], 1.0), 0, 1)
			var q := ll * (1 + ss) if ll < 0.5 else ll + ss - ll * ss
			var p := 2 * ll - q
			return Color(_hue(p, q, hh + 1.0 / 3), _hue(p, q, hh), _hue(p, q, hh - 1.0 / 3), alpha)
		if s == "transparent":
			return Color(0, 0, 0, 0)
		var named := Color.from_string(s, Color(1, 0, 1, 0.5))
		if named == Color(1, 0, 1, 0.5):
			return null
		return named

	# a number, or a percentage of `full`
	static func _num(t: String, full: float) -> float:
		if t.ends_with("%"):
			return t.trim_suffix("%").to_float() / 100.0 * full
		return t.to_float()

	static func _hue(p: float, q: float, t: float) -> float:
		t = fposmod(t, 1.0)
		if t < 1.0 / 6:
			return p + (q - p) * 6 * t
		if t < 0.5:
			return q
		if t < 2.0 / 3:
			return p + (q - p) * (2.0 / 3 - t) * 6
		return p


# Fonts: the families in the CSS list, in order, as Windows has them (what Chrome picks), or registered ones.
static var _fonts := {}
static var _registered := {}
const _GENERIC := {"sans-serif": "Arial", "serif": "Times New Roman", "monospace": "Consolas", "system-ui": "Segoe UI", "cursive": "Comic Sans MS", "fantasy": "Impact"}


## Use a font file for a family (one the system doesn't have, e.g. a web font the game loads):
## Canvas2D.register_font("Stardos Stencil", "res://fonts/StardosStencil-Bold.ttf", 700)
static func register_font(family: String, path: String, weight := 400, italic := false) -> void:
	var key := family.to_lower()
	if not _registered.has(key):
		_registered[key] = []
	_registered[key].append({path = path, weight = weight, italic = italic})
	_fonts.clear()


func _parse_font(css: String) -> Variant:
	if _fonts.has(css):
		return _fonts[css]
	var m := RegEx.create_from_string("^\\s*(.*?)\\s*([0-9]*\\.?[0-9]+)(px|pt|em|rem)(\\s*/\\s*[^\\s]+)?\\s+(.+)$").search(css)
	if not m:
		return null
	var weight := 400
	var italic := false
	var stretch := 100
	for w in m.get_string(1).split(" ", false):
		match w:
			"bold", "bolder":
				weight = 700
			"lighter":
				weight = 300
			"italic", "oblique":
				italic = true
			"condensed", "semi-condensed":
				stretch = 75
			_:
				if w.is_valid_int():
					weight = w.to_int()
	var size := m.get_string(2).to_float()
	match m.get_string(3):
		"pt":
			size *= 4.0 / 3.0
		"em", "rem":
			size *= 16.0
	var fams := []
	for f in m.get_string(5).split(","):
		fams.append(f.strip_edges().trim_prefix("\"").trim_suffix("\"").trim_prefix("'").trim_suffix("'"))
	var info = _find_font(fams, weight, italic, stretch)
	var out := {font = info.font, asc = info.asc, size = size, fake_bold = info.fake_bold}
	_fonts[css] = out
	return out


static var _files := {}

static func _find_font(fams: Array, weight: int, italic: bool, stretch: int) -> Dictionary:
	fams = fams + ["sans-serif"]
	for fam in fams:
		var name: String = _GENERIC.get(fam.to_lower(), fam)
		var path := ""
		var reg: Array = _registered.get(name.to_lower(), [])
		if not reg.is_empty():
			var best = null
			for r in reg:
				var score: int = absi(r.weight - weight) + (0 if r.italic == italic else 1000)
				if best == null or score < best[0]:
					best = [score, r.path]
			path = best[1]
		else:
			var st := stretch
			for suffix in [" Narrow", " Condensed"]:
				if name.ends_with(suffix):
					name = name.trim_suffix(suffix)
					st = 75
			path = OS.get_system_font_path(name, weight, st, italic)
			if path != "" and st < 100 and path == OS.get_system_font_path(name, weight, 100, italic):
				path = "" # (no narrow cut of it here)
		if path == "":
			continue
		var f: Dictionary = _load(path)
		# (no bold cut: Chrome thickens the regular one, an outline round each glyph, the advances unchanged)
		return {font = f.file, asc = f.asc, fake_bold = weight >= 600 and f.file.font_weight < 600}
	return {font = ThemeDB.fallback_font, asc = 0.8, fake_bold = false}


static func _load(path: String) -> Dictionary:
	if _files.has(path):
		return _files[path]
	var ff := FontFile.new()
	if path.begins_with("res://"):
		var r = load(path)
		if r is FontFile:
			ff = r.duplicate()
	else:
		ff.load_dynamic_font(path)
	ff.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	ff.hinting = TextServer.HINTING_NONE
	ff.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_ONE_QUARTER
	ff.generate_mipmaps = false
	var bytes := FileAccess.get_file_as_bytes(path)
	var out := {file = ff, asc = _typo_ascent(bytes)}
	_files[path] = out
	return out


# The OS/2 table's typo ascent as a fraction of ascent + descent: where Chrome puts the top, middle and bottom
# baselines (the em box split in that ratio).
static func _typo_ascent(b: PackedByteArray) -> float:
	if b.size() < 12:
		return 0.8
	var base := 0
	if b.slice(0, 4).get_string_from_ascii() == "ttcf":
		base = _u32(b, 12)
	var n := _u16(b, base + 4)
	for i in n:
		var rec := base + 12 + i * 16
		if b.slice(rec, rec + 4).get_string_from_ascii() == "OS/2":
			var o := _u32(b, rec + 8)
			var asc := _s16(b, o + 68)
			var desc := -_s16(b, o + 70)
			if asc + desc > 0:
				return float(asc) / (asc + desc)
	return 0.8


static func _u16(b: PackedByteArray, o: int) -> int:
	return (b[o] << 8) | b[o + 1]


static func _s16(b: PackedByteArray, o: int) -> int:
	var v := _u16(b, o)
	return v - 65536 if v >= 32768 else v


static func _u32(b: PackedByteArray, o: int) -> int:
	return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]


# ================================================================ rendering
# The recorded calls run in stages, one frame each (several canvases share the frames). A plain stage draws
# straight over what's there; one with a clip, a shadow, a filter or a composite mode other than
# source-over/lighter is drawn into a layer first, then laid on through the mask with that mode. Pixels are
# kept premultiplied (as the browser keeps them) and unpremultiplied at the end.

const _COVER := """
shader_type canvas_item;
render_mode BLEND;
uniform sampler2D edges : filter_nearest;
uniform sampler2D ramps : filter_nearest;
PATTERN_UNIFORM
varying vec2 dpos;
varying flat vec2 rec;

vec4 at(int i) { return texelFetch(edges, ivec2(i % 4096, i / 4096), 0); }

void vertex() { dpos = VERTEX; rec = UV; }

void fragment() {
	int base = int(rec.x + 0.5) + int(rec.y + 0.5) * 4096;
	vec4 h = at(base);
	int count = int(h.x + 0.5);
	bool evenodd = h.y > 0.5;
	int kind = int(h.z + 0.5);
	int e0 = base + ((kind == 0 || kind >= 4) ? 2 : 6);
	vec2 px = floor(dpos);
	int w[16];
	for (int s = 0; s < 16; s++) w[s] = 0;
	for (int i = 0; i < count; i++) {
		vec4 e = at(e0 + i);
		float y0 = min(e.y, e.w), y1 = max(e.y, e.w);
		if (y1 <= px.y || y0 >= px.y + 1.0 || max(e.x, e.z) <= px.x) continue;
		int dir = e.w > e.y ? 1 : -1;
		bool right = min(e.x, e.z) >= px.x + 1.0;
		float slope = (e.z - e.x) / (e.w - e.y);
		for (int s = 0; s < 16; s++) {
			float sy = px.y + (float(s) + 0.5) / 16.0;
			if (sy < y0 || sy >= y1) continue;
			if (right) { w[s] += dir; continue; }
			float sx = px.x + (float((s * 5 + 3) % 16) + 0.5) / 16.0;
			if (e.x + (sy - e.y) * slope > sx) w[s] += dir;
		}
	}
	int n = 0;
	for (int s = 0; s < 16; s++) n += evenodd ? (w[s] & 1) : (w[s] != 0 ? 1 : 0);
	float cov = float(n) / 16.0;
	vec4 col = vec4(0.0);
	if (kind == 0) {
		vec4 c = at(base + 1);
		col = vec4(c.rgb * c.a, c.a);
	} else if (kind <= 3) {
		vec4 m0 = at(base + 2), m1 = at(base + 3), g0 = at(base + 4), g1 = at(base + 5);
		vec2 up = vec2(m0.x * dpos.x + m0.z * dpos.y + m1.x, m0.y * dpos.x + m0.w * dpos.y + m1.y);
		float t = 0.0;
		bool ok = true;
		if (kind == 1) {
			vec2 d = g0.zw - g0.xy;
			float dd = dot(d, d);
			ok = dd > 0.0;
			t = ok ? dot(up - g0.xy, d) / dd : 0.0;
		} else if (kind == 2) {
			vec2 cd = g1.xy - g0.xy, pd = up - g0.xy;
			float dr = g1.z - g0.z;
			float a = dot(cd, cd) - dr * dr, b = dot(pd, cd) + g0.z * dr, c = dot(pd, pd) - g0.z * g0.z;
			if (abs(a) < 1e-6) {
				t = c / (2.0 * b);
				ok = b != 0.0 && g0.z + t * dr >= 0.0;
			} else {
				float disc = b * b - a * c;
				ok = disc >= 0.0;
				if (ok) {
					float sq = sqrt(disc), t1 = (b + sq) / a, t2 = (b - sq) / a;
					float hi = max(t1, t2), lo = min(t1, t2);
					if (g0.z + hi * dr >= 0.0) t = hi;
					else if (g0.z + lo * dr >= 0.0) t = lo;
					else ok = false;
				}
			}
		}
		if (!ok) discard;
		if (kind == 3) {
			PATTERN_SAMPLE
		} else {
			vec4 r = at(base + 1);
			float f = clamp(t, 0.0, 1.0) * 255.0;
			int i0 = int(floor(f));
			int row = int(r.x + 0.5);
			vec4 c = mix(texelFetch(ramps, ivec2(i0, row), 0), texelFetch(ramps, ivec2(min(i0 + 1, 255), row), 0), f - float(i0));
			col = vec4(c.rgb * c.a, c.a);
		}
	}
	OUTPUT
}
"""

const _PATTERN_UNIFORM := "uniform sampler2D pattern : filter_linear, repeat_enable;"
const _PATTERN_SAMPLE := """vec4 r = at(base + 1);
			vec2 uv = up / r.xy;
			if ((r.z < 0.5 && (uv.x < 0.0 || uv.x > 1.0)) || (r.w < 0.5 && (uv.y < 0.0 || uv.y > 1.0))) discard;
			col = texture(pattern, uv);"""
const _OUT_PREMUL := "if (cov <= 0.0) discard; col *= h.w * cov; COLOR = col;"
const _OUT_ADD := "if (cov <= 0.0) discard; col *= h.w * cov; COLOR = col.a > 0.0 ? vec4(col.rgb / sqrt(col.a), sqrt(col.a)) : vec4(0.0);" # (blend_add multiplies colour and alpha by alpha: undo it)
const _OUT_MUL := "if (kind == 5 && cov <= 0.0) discard; COLOR = vec4(kind == 4 ? cov : 1.0 - cov);"

const _SIMPLE := """
shader_type canvas_item;
render_mode BLEND;
uniform sampler2D mask : filter_nearest;
uniform bool has_mask = false;
uniform vec2 size = vec2(1.0);
uniform vec4 tint = vec4(-1.0);
varying vec2 dpos;
varying vec4 vcol;
void vertex() { dpos = VERTEX; vcol = COLOR; }
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	FRAG
}
"""

const _COMPOSITE := """
shader_type canvas_item;
render_mode blend_disabled;
uniform sampler2D acc : filter_nearest;
uniform bool has_acc = false;
uniform sampler2D mask : filter_nearest;
uniform bool has_mask = false;
uniform int mode = 0;
void fragment() {
	vec4 s = texture(TEXTURE, UV);
	vec4 d = has_acc ? texture(acc, UV) : vec4(0.0);
	vec4 r;
	if (mode == 1) r = d * s.a; // destination-in
	else if (mode == 2) r = s * d.a + d * (1.0 - s.a); // source-atop
	else if (mode == 3) r = min(s + d, vec4(1.0)); // lighter
	else r = s + d * (1.0 - s.a);
	float m = has_mask ? texture(mask, UV).a : 1.0;
	COLOR = mix(d, r, m);
}
"""

const _BLUR := """
shader_type canvas_item;
render_mode blend_disabled;
uniform vec2 texel_dir = vec2(1.0, 0.0);
uniform float sigma = 1.0;
void fragment() {
	int r = int(ceil(sigma * 3.0));
	vec4 sum = vec4(0.0);
	float wsum = 0.0;
	for (int i = -r; i <= r; i++) {
		float w = exp(-float(i * i) / (2.0 * sigma * sigma));
		vec2 uv = UV + texel_dir * float(i);
		wsum += w;
		if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) sum += texture(TEXTURE, uv) * w;
	}
	COLOR = sum / wsum;
}
"""

static var _shaders := {}

static func _shader(name: String) -> Shader:
	if _shaders.has(name):
		return _shaders[name]
	var code: String
	match name:
		"cov", "cov_add", "cov_mul", "pat", "pat_add":
			code = _COVER.replace("BLEND", "blend_add" if name.ends_with("_add") else "blend_mul" if name == "cov_mul" else "blend_premul_alpha")
			var pat := name.begins_with("pat")
			code = code.replace("PATTERN_UNIFORM", _PATTERN_UNIFORM if pat else "").replace("PATTERN_SAMPLE", _PATTERN_SAMPLE if pat else "")
			code = code.replace("OUTPUT", _OUT_ADD if name.ends_with("_add") else _OUT_MUL if name == "cov_mul" else _OUT_PREMUL)
		"copy", "put":
			code = _SIMPLE.replace("BLEND", "blend_disabled").replace("FRAG", "COLOR = c;")
		"img":
			code = _SIMPLE.replace("BLEND", "blend_premul_alpha").replace("FRAG", "COLOR = c * vcol.a;")
		"img_add":
			code = _SIMPLE.replace("BLEND", "blend_add").replace("FRAG", "c *= vcol.a; COLOR = c.a > 0.0 ? vec4(c.rgb / sqrt(c.a), sqrt(c.a)) : vec4(0.0);")
		"layer": # (a layer, or its shadow when tint is set, laid on through the clip mask)
			code = _SIMPLE.replace("BLEND", "blend_premul_alpha").replace("FRAG", "float m = has_mask ? texture(mask, dpos / size).a : 1.0; COLOR = (tint.a >= 0.0 ? tint * c.a : c) * m;")
		"text": # (glyph coverage a little fuller, as DirectWrite's text contrast in Chrome makes it)
			code = "shader_type canvas_item;
varying vec4 vcol;
void vertex() { vcol = COLOR; }
void fragment() { vec4 t = texture(TEXTURE, UV); COLOR = vec4(vcol.rgb * t.rgb, vcol.a * (1.0 - pow(1.0 - t.a, 1.25))); }"
		"unpremul":
			code = _SIMPLE.replace("BLEND", "blend_disabled").replace("FRAG", "COLOR = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);")
		"composite":
			code = _COMPOSITE
		"blur":
			code = _BLUR
	var s := Shader.new()
	s.code = code
	_shaders[name] = s
	return s


static func _mat(name: String, params := {}) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _shader(name)
	for k in params:
		m.set_shader_parameter(k, params[k])
	return m


static func _new_vp(w: int, h: int) -> SubViewport:
	var vp := SubViewport.new()
	vp.size = Vector2i(w, h)
	vp.transparent_bg = true
	vp.disable_3d = true
	vp.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	vp.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	return vp


# renders the viewports (all in the same frame) and waits for them
static func _render(vps: Array) -> void:
	var root: Node = (Engine.get_main_loop() as SceneTree).root
	for vp in vps:
		root.add_child.call_deferred(vp)
	await RenderingServer.frame_post_draw


static func _node(vp: Node, mat: Material, filter_linear: bool, draw: Callable) -> Node2D:
	var n := Node2D.new()
	n.material = mat
	n.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR if filter_linear else CanvasItem.TEXTURE_FILTER_NEAREST
	n.draw.connect(draw.bind(n))
	vp.add_child(n)
	return n


# Draws ops (each with its own colour, alpha and blending among themselves) into vp, over `acc` if given.
class _Batch:
	var w: int
	var h: int
	var data := PackedFloat32Array()
	var ramps := PackedColorArray()
	var nodes: Array = [] # [{kind, key, ...}]

	func _init(cw: int, ch: int) -> void:
		w = cw
		h = ch

	func node(kind: String, key = null) -> Dictionary:
		if not nodes.is_empty() and nodes[-1].kind == kind and nodes[-1].key == key:
			return nodes[-1]
		var n := {kind = kind, key = key, pts = PackedVector2Array(), uvs = PackedVector2Array(), idx = PackedInt32Array(), items = []}
		nodes.append(n)
		return n

	# a fill as bands of quads, each pointing at its header and the edges that cross it
	func cover(polys: Array, evenodd: bool, kind: int, alpha: float, head: PackedFloat32Array, n: Dictionary, outside_too := false) -> void:
		var ex := PackedFloat32Array()
		var lo := Vector2(INF, INF)
		var hi := Vector2(-INF, -INF)
		for p in polys:
			var m: int = p.size()
			for i in m:
				var a: Vector2 = p[i]
				var b: Vector2 = p[(i + 1) % m]
				lo = lo.min(a)
				hi = hi.max(a)
				if a.y != b.y:
					ex.append_array([a.x, a.y, b.x, b.y])
		var x0 := clampi(floori(lo.x) - 1, 0, w)
		var x1 := clampi(ceili(hi.x) + 1, 0, w)
		var y0 := clampi(floori(lo.y) - 1, 0, h)
		var y1 := clampi(ceili(hi.y) + 1, 0, h)
		if outside_too: # (a clip within a clip: zero outside its box as well)
			for r in [Rect2i(0, 0, w, y0), Rect2i(0, y1, w, h - y1), Rect2i(0, y0, x0, y1 - y0), Rect2i(x1, y0, w - x1, y1 - y0)]:
				if r.size.x > 0 and r.size.y > 0:
					quad(n, Rect2(r), _header(0, false, kind, alpha, head, PackedFloat32Array()))
		if x1 <= x0 or y1 <= y0 or ex.is_empty():
			return
		var ne := ex.size() / 4
		var nb := 1 if ne <= 8 else ceili(float(y1 - y0) / _BAND)
		var bands := []
		bands.resize(nb)
		for b in nb:
			bands[b] = PackedFloat32Array()
		for i in ne:
			var ya := minf(ex[i * 4 + 1], ex[i * 4 + 3])
			var yb := maxf(ex[i * 4 + 1], ex[i * 4 + 3])
			var b0 := 0 if nb == 1 else clampi(floori((ya - y0) / _BAND), 0, nb - 1)
			var b1 := 0 if nb == 1 else clampi(floori((yb - y0) / _BAND), 0, nb - 1)
			for b in range(b0, b1 + 1):
				bands[b].append_array(ex.slice(i * 4, i * 4 + 4))
		for b in nb:
			if bands[b].is_empty():
				continue
			var by0 := y0 + b * _BAND if nb > 1 else y0
			var by1 := mini(by0 + _BAND, y1) if nb > 1 else y1
			quad(n, Rect2(x0, by0, x1 - x0, by1 - by0), _header(bands[b].size() / 4, evenodd, kind, alpha, head, bands[b]))

	func _header(count: int, evenodd: bool, kind: int, alpha: float, head: PackedFloat32Array, edges: PackedFloat32Array) -> int:
		var at := data.size() / 4
		data.append_array([count, 1.0 if evenodd else 0.0, kind, alpha])
		data.append_array(head)
		data.append_array(edges)
		return at

	func quad(n: Dictionary, r: Rect2, at: int) -> void:
		var i: int = n.pts.size()
		n.pts.append_array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)])
		var uv := Vector2(at % 4096, at / 4096)
		n.uvs.append_array([uv, uv, uv, uv])
		n.idx.append_array([i, i + 1, i + 2, i, i + 2, i + 3])

	# the header after the first texel: the paint
	func paint_head(p) -> Array: # [kind, head, pattern or null]
		if p is Color:
			return [0, PackedFloat32Array([p.r, p.g, p.b, p.a]), null]
		var src = p.src
		var inv: Transform2D = p.inv
		var m := PackedFloat32Array([0, 0, 0, 0, inv.x.x, inv.x.y, inv.y.x, inv.y.y, inv.origin.x, inv.origin.y, 0, 0])
		if src is CanvasGradient and src.stops.is_empty():
			return [0, PackedFloat32Array([0, 0, 0, 0]), null]
		if src is CanvasGradient:
			var row := ramps.size() / 256
			ramps.append_array(src.ramp())
			m[0] = row
			var q: Array = src.p
			if src.radial:
				m.append_array([q[0], q[1], q[2], 0, q[3], q[4], q[5], 0])
			else:
				m.append_array([q[0], q[1], q[2], q[3], 0, 0, 0, 0])
			return [2 if src.radial else 1, m, null]
		m[0] = src.src.w
		m[1] = src.src.h
		m[2] = 1.0 if src.rep_x else 0.0
		m[3] = 1.0 if src.rep_y else 0.0
		m.append_array([0, 0, 0, 0, 0, 0, 0, 0])
		return [3, m, src]

	func add(op: Dictionary) -> void:
		var lighter: bool = op.get("comp", "") == "lighter"
		match op.k:
			"fill":
				var ph := paint_head(op.paint)
				var key = null
				var kind := "cov_add" if lighter else "cov"
				if ph[2] != null:
					kind = "pat_add" if lighter else "pat"
					key = ph[2]
				cover(op.polys, op.evenodd, ph[0], op.alpha, ph[1], node(kind, key))
			"clear":
				cover(op.polys, false, 5, 1.0, PackedFloat32Array([0, 0, 0, 0]), node("cov_mul"))
			"text":
				node("text").items.append(op)
			"image":
				node("img_add" if lighter else "img", op.smooth).items.append(op)
			"put":
				node("put").items.append(op)


static func _build(b: _Batch, vp: SubViewport, acc: Texture2D) -> void:
	var w := b.w
	var h := b.h
	var data := b.data
	var ramps := b.ramps
	var nodes := b.nodes
	if acc:
		_node(vp, _mat("copy"), false, func(n: Node2D): n.draw_texture_rect(acc, Rect2(0, 0, w, h), false))
	var rows := maxi(1, ceili(data.size() / 4.0 / 4096))
	data.resize(rows * 4096 * 4)
	var etex := ImageTexture.create_from_image(Image.create_from_data(4096, rows, false, Image.FORMAT_RGBAF, data.to_byte_array()))
	var nr := maxi(1, ramps.size() / 256)
	var rimg := Image.create(256, nr, false, Image.FORMAT_RGBAF)
	for i in ramps.size():
		rimg.set_pixel(i % 256, i / 256, ramps[i])
	var rtex := ImageTexture.create_from_image(rimg)
	for nd in nodes:
		match nd.kind:
			"cov", "cov_add", "cov_mul", "pat", "pat_add":
				var params := {edges = etex, ramps = rtex}
				if nd.key != null:
					params.pattern = nd.key.src.tex
				var idx: PackedInt32Array = nd.idx
				var pts: PackedVector2Array = nd.pts
				var uvs: PackedVector2Array = nd.uvs
				_node(vp, _mat(nd.kind, params), false, func(n: Node2D):
					RenderingServer.canvas_item_add_triangle_array(n.get_canvas_item(), idx, pts, PackedColorArray([Color.WHITE]), uvs))
			"text":
				var items: Array = nd.items
				_node(vp, _mat("text"), true, func(n: Node2D):
					for op in items:
						n.draw_set_transform_matrix(op.t)
						var c: Color = op.color
						c.a *= op.alpha
						if op.outline:
							n.draw_string_outline(op.font, Vector2.ZERO, op.text, HORIZONTAL_ALIGNMENT_LEFT, -1, op.size, op.outline_size, c)
						else:
							if op.bold > 0:
								n.draw_string_outline(op.font, Vector2.ZERO, op.text, HORIZONTAL_ALIGNMENT_LEFT, -1, op.size, op.bold, c)
							n.draw_string(op.font, Vector2.ZERO, op.text, HORIZONTAL_ALIGNMENT_LEFT, -1, op.size, c)
					n.draw_set_transform_matrix(Transform2D.IDENTITY))
			"img", "img_add":
				var items: Array = nd.items
				_node(vp, _mat(nd.kind), nd.key, func(n: Node2D):
					for op in items:
						n.draw_set_transform_matrix(op.t)
						n.draw_texture_rect_region(op.src.tex, op.dr, op.sr, Color(1, 1, 1, op.alpha), false, true)
					n.draw_set_transform_matrix(Transform2D.IDENTITY))
			"put":
				var items: Array = nd.items
				_node(vp, _mat("put"), false, func(n: Node2D):
					for op in items:
						n.draw_texture_rect(op.tex, op.rect, false))


# a source canvas as it was when drawn from, premultiplied, as a texture
static func _resolve(src: Dictionary) -> void:
	if src.has("tex"):
		return
	var c = src.canvas
	if c._premul_serial == src.serial and c._premul:
		src.tex = c._premul
		return
	var res: Dictionary = await c._run(src.ops, src.w, src.h, false)
	src.tex = res.premul_tex
	if src.serial == c._serial:
		c._premul = src.tex
		c._premul_serial = src.serial


func _run(ops: Array, w: int, h: int, straight: bool) -> Dictionary:
	if w <= 0 or h <= 0:
		return {straight = Image.create(1, 1, false, Image.FORMAT_RGBA8), premul_tex = null}
	# the canvases drawn from, first
	for op in ops:
		if op.k == "image":
			await _resolve(op.src)
		elif op.k == "fill" and op.paint is Dictionary and op.paint.src is CanvasPattern:
			await _resolve(op.paint.src.src)
	var acc_vp: SubViewport = null
	var acc: Texture2D = null
	for stage in _plan(ops):
		var vp := _new_vp(w, h)
		if stage.direct:
			var b := _Batch.new(w, h)
			for op in stage.ops:
				b.add(op)
			_build(b, vp, acc)
			await _render([vp])
		else:
			var later: Array = await _layered(stage, vp, acc, w, h)
			for x in later:
				x.queue_free()
		if acc_vp:
			acc_vp.queue_free()
		acc_vp = vp
		acc = vp.get_texture()
	var premul: Image
	if acc == null:
		premul = Image.create(w, h, false, Image.FORMAT_RGBA8)
	else:
		premul = acc.get_image()
	if premul == null: # (no renderer: --headless)
		premul = Image.create(w, h, false, Image.FORMAT_RGBA8)
	var out := {premul_tex = ImageTexture.create_from_image(premul), straight = null}
	if straight:
		if acc == null:
			out.straight = premul
		else:
			var vp := _new_vp(w, h)
			_node(vp, _mat("unpremul"), false, func(n: Node2D): n.draw_texture_rect(acc, Rect2(0, 0, w, h), false))
			await _render([vp])
			out.straight = vp.get_texture().get_image()
			if out.straight == null:
				out.straight = Image.create(w, h, false, Image.FORMAT_RGBA8)
			vp.queue_free()
	if acc_vp:
		acc_vp.queue_free()
	return out


# Groups the calls into stages: runs of plain drawing, and the layered ones.
static func _plan(ops: Array) -> Array:
	var stages := []
	for op in ops:
		var comp: String = op.get("comp", "source-over")
		if not comp in ["source-over", "lighter", "destination-in", "source-atop"]:
			push_warning("Canvas2D: globalCompositeOperation '%s' drawn as source-over" % comp)
			comp = "source-over"
			op.comp = comp
		var direct: bool = op.k in ["put", "clear"] or (comp in ["source-over", "lighter"] and op.clip.is_empty() and op.shadow == null and op.blur <= 0.0)
		var last = stages[-1] if not stages.is_empty() else null
		if direct:
			if last and last.direct:
				last.ops.append(op)
			else:
				stages.append({direct = true, ops = [op]})
			continue
		var over := comp in ["source-over", "lighter"]
		var mode := "source-over" if over else comp
		if last == null or last.direct or last.mode != mode or not is_same(last.clip, op.clip) or mode == "destination-in" or (not over and last.subs[-1].blur != op.blur):
			last = {direct = false, mode = mode, clip = op.clip, subs = []}
			stages.append(last)
		var sub = last.subs[-1] if not last.subs.is_empty() else null
		var shadow = op.shadow if over else null
		if sub == null or shadow != null or sub.shadow != null or sub.blur != op.blur:
			last.subs.append({ops = [op], shadow = shadow, blur = op.blur})
		else:
			sub.ops.append(op)
	return stages


# A layered stage: each layer drawn on its own (with the clip mask beside it), blurred if it has to be, then
# laid over what's there. Returns the viewports to free once vp has been used.
func _layered(stage: Dictionary, vp: SubViewport, acc: Texture2D, w: int, h: int) -> Array:
	var vps := []
	var layers := []
	for sub in stage.subs:
		var lv := _new_vp(w, h)
		var b := _Batch.new(w, h)
		for op in sub.ops:
			b.add(op)
		_build(b, lv, null)
		vps.append(lv)
		layers.append(lv)
	var mask_vp: SubViewport = null
	if not stage.clip.is_empty():
		mask_vp = _new_vp(w, h)
		var b := _Batch.new(w, h)
		var first := true
		for c in stage.clip:
			if first:
				b.cover(c.polys, c.evenodd, 0, 1.0, PackedFloat32Array([1, 1, 1, 1]), b.node("cov"))
			else:
				b.cover(c.polys, c.evenodd, 4, 1.0, PackedFloat32Array([0, 0, 0, 0]), b.node("cov_mul"), true)
			first = false
		_build(b, mask_vp, null)
		vps.append(mask_vp)
	await _render(vps)
	var free_later := vps.duplicate()
	# blur: the filter's on the layer itself, the shadow's on a copy of it
	var texs := []
	var shadows := []
	for i in layers.size():
		texs.append(layers[i].get_texture())
		shadows.append(null)
	for pass_kind in ["filter", "shadow"]:
		var jobs := []
		for i in layers.size():
			var sub: Dictionary = stage.subs[i]
			var sigma: float = sub.blur if pass_kind == "filter" else (sub.shadow.blur / 2.0 if sub.shadow != null else 0.0)
			if pass_kind == "shadow" and sub.shadow != null:
				shadows[i] = texs[i]
			if sigma > 0.0:
				jobs.append([i, sigma])
		if jobs.is_empty():
			continue
		for dir in [Vector2(1.0 / w, 0), Vector2(0, 1.0 / h)]:
			var bvps := []
			for j in jobs:
				var bv := _new_vp(w, h)
				var src: Texture2D = texs[j[0]] if pass_kind == "filter" else shadows[j[0]]
				_node(bv, _mat("blur", {texel_dir = dir, sigma = j[1]}), false, func(n: Node2D): n.draw_texture_rect(src, Rect2(0, 0, w, h), false))
				bvps.append(bv)
			await _render(bvps)
			free_later.append_array(bvps)
			for k in jobs.size():
				if pass_kind == "filter":
					texs[jobs[k][0]] = bvps[k].get_texture()
				else:
					shadows[jobs[k][0]] = bvps[k].get_texture()
	var mask_tex: Texture2D = mask_vp.get_texture() if mask_vp else null
	if stage.mode == "source-over":
		if acc:
			_node(vp, _mat("copy"), false, func(n: Node2D): n.draw_texture_rect(acc, Rect2(0, 0, w, h), false))
		for i in layers.size():
			var sub: Dictionary = stage.subs[i]
			var base := {has_mask = mask_tex != null, size = Vector2(w, h)}
			if mask_tex:
				base.mask = mask_tex
			if sub.shadow != null:
				var sc: Color = sub.shadow.color
				var p := base.duplicate()
				p.tint = Vector4(sc.r * sc.a, sc.g * sc.a, sc.b * sc.a, sc.a)
				var st: Texture2D = shadows[i]
				var off: Vector2 = sub.shadow.off
				_node(vp, _mat("layer", p), false, func(n: Node2D): n.draw_texture_rect(st, Rect2(off, Vector2(w, h)), false))
			var lt: Texture2D = texs[i]
			_node(vp, _mat("layer", base), false, func(n: Node2D): n.draw_texture_rect(lt, Rect2(0, 0, w, h), false))
	else:
		var p := {has_acc = acc != null, has_mask = mask_tex != null, mode = {"destination-in": 1, "source-atop": 2}.get(stage.mode, 0)}
		if acc:
			p.acc = acc
		if mask_tex:
			p.mask = mask_tex
		var lt: Texture2D = texs[0]
		_node(vp, _mat("composite", p), false, func(n: Node2D): n.draw_texture_rect(lt, Rect2(0, 0, w, h), false))
	await _render([vp])
	return free_later
