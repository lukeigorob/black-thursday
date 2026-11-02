extends RefCounted
# The menus' and HUD's type and colours (menus.css's :root and index.html's styles) and the small pieces every
# screen is built from: labels set in the game's four faces, key caps, a line of mixed text and keys from the
# same little bits of HTML the game passes the UI (prompts: "<b>E</b> Leave"), boxes (ui/box.gd), and the SVG
# artwork drawn to textures. Used by src/ui.gd and src/viewer.gd.

const Box := preload("res://ui/box.gd")

# the faces: Barlow for names, sentences and numbers, Barlow Condensed for labels and buttons, Stardos
# Stencil for the big titles, Special Elite (the typewriter) for decoration (fonts: ui/fonts, SIL OFL)
const FILES := {
	ui = {400: "Barlow-Regular", 500: "Barlow-Medium", 600: "Barlow-SemiBold", 700: "Barlow-Bold"},
	cond = {500: "BarlowCondensed-Medium", 600: "BarlowCondensed-SemiBold", 700: "BarlowCondensed-Bold"},
	type = {400: "SpecialElite-Regular"},
	display = {400: "StardosStencil-Regular", 700: "StardosStencil-Bold"},
}

# :root (with the "readable at a glance" overrides at the end of menus.css)
const C := {
	night = Color("#0c0d09"), steel = Color("#1b1d15"), od = Color("#4b5530"), od2 = Color("#606b3c"), od_deep = Color("#22261a"),
	brass = Color("#c9a55a"), brass2 = Color("#e6cb8a"), cream = Color("#efe8d6"), cream_dim = Color("#d2c9b2"),
	paper = Color("#e9dfc3"), paper2 = Color("#ddd0ab"), paper_edge = Color("#a8916194"),
	ink = Color("#261f15"), ink2 = Color("#3d3222"), red = Color("#a8291e"), blue = Color("#22406e"),
	fit = Color("#3f7d2a"), dmg = Color("#c08a00"), fire = Color("#c0281c"),
	hud = Color("#ece8dc"),
}

static var _fonts := {}
static var _settings := {}
static var _fallbacks: Array[Font] = []

## A face at a weight, with CSS letter-spacing (px). "mono" is the system's (ui-monospace, Consolas), "sys" its
## sans (system-ui), "courier" Courier New (the mission map's typewriter).
static func font(fam: String, weight := 500, spacing := 0.0) -> Font:
	var key := "%s|%d|%d" % [fam, weight, roundi(spacing * 10.0)]
	if _fonts.has(key):
		return _fonts[key]
	if _fallbacks.is_empty():
		var sym := SystemFont.new()
		sym.font_names = PackedStringArray(["Segoe UI Symbol", "Segoe UI", "Arial Unicode MS", "DejaVu Sans", "sans-serif"])
		_fallbacks.append(sym)
	var base: Font
	if fam == "mono" or fam == "sys" or fam == "courier":
		var sf := SystemFont.new()
		sf.font_names = PackedStringArray({mono = ["Consolas", "Cascadia Mono", "monospace"], sys = ["Segoe UI", "Arial", "sans-serif"], courier = ["Courier New", "Courier", "monospace"]}[fam])
		sf.font_weight = weight
		base = sf
	else:
		var have: Dictionary = FILES[fam]
		var best := -1
		for w in have:
			if best < 0 or absi(w - weight) < absi(best - weight):
				best = w
		var ff: FontFile = load("res://ui/fonts/%s.ttf" % have[best])
		if ff.fallbacks.is_empty():
			ff.fallbacks = _fallbacks
		base = ff
	var f: Font = base
	if spacing != 0.0:
		var v := FontVariation.new()
		v.base_font = base
		v.spacing_glyph = roundi(spacing)
		f = v
	_fonts[key] = f
	return f

## The settings for a label. st: f (face), w (weight), s (size px), c (Color), ls (letter-spacing, em), sh (the
## HUD's text-shadow: 0 1px 2px #000, 0 0 6px #000c), lh (line-height, as a multiple of the size).
static func settings(st: Dictionary) -> LabelSettings:
	var key := str(st)
	if _settings.has(key):
		return _settings[key]
	var s := LabelSettings.new()
	var size: int = st.get("s", 16)
	s.font = font(st.get("f", "ui"), st.get("w", 500), st.get("ls", 0.0) * size)
	s.font_size = size
	s.font_color = st.get("c", C.cream)
	if st.get("sh", false):
		s.shadow_color = Color(0, 0, 0, 0.85)
		s.shadow_offset = Vector2(0, 1)
		s.shadow_size = 4
	if st.has("lh"):
		s.line_spacing = size * st.lh - s.font.get_height(size)
	_settings[key] = s
	return s

static func label(text: String, st: Dictionary = {}) -> Label:
	var l := Label.new()
	l.text = text
	l.label_settings = settings(st)
	l.uppercase = st.get("up", false)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if st.has("align"):
		l.horizontal_alignment = st.align
	if st.get("wrap", false):
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if st.has("maxw"):
		l.custom_minimum_size.x = st.maxw
	return l

static func hbox(sep := 0, align := BoxContainer.ALIGNMENT_BEGIN) -> HBoxContainer:
	var b := HBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	b.alignment = align
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

static func vbox(sep := 0, align := BoxContainer.ALIGNMENT_BEGIN) -> VBoxContainer:
	var b := VBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	b.alignment = align
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

static func box(look: Dictionary = {}, pad = 0.0, button := false) -> Container:
	return Box.new(look, pad, button)

## A fixed gap in a row or column.
static func gap(w := 0.0, h := 0.0) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, h)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

## A thin rule (CSS border-top / -bottom), dashed or not.
static func rule(color: Color, w := 1.0, dashed := false, vertical := false) -> Control:
	var c := Control.new()
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.custom_minimum_size = Vector2(w, 0) if vertical else Vector2(0, w)
	c.draw.connect(func():
		var a := Vector2(w / 2, 0) if vertical else Vector2(0, w / 2)
		var b := Vector2(w / 2, c.size.y) if vertical else Vector2(c.size.x, w / 2)
		if dashed:
			c.draw_dashed_line(a, b, color, w, 4.0)
		else:
			c.draw_line(a, b, color, w))
	return c

# the key caps: <kbd> on the menus, <b> in the prompt, the controls card and the first-time tips
const CAPS := {
	kbd = {look = {bg = Color("#1a1c14"), border = [1, 1, 1, 3], border_color = Color("#cfc6ae55"), radius = 4.0}, pad = [0, 7, 0, 7], st = {f = "cond", w = 600, s = 13, ls = 0.04}, minw = 21.0},
	prompt = {look = {bg = Color("#00000066"), border = [1, 1, 1, 1], border_color = Color("#ece8dc99"), radius = 3.0}, pad = [1, 6, 1, 6], st = {f = "ui", w = 600, s = 18, c = Color("#ece8dc")}, minw = 22.0},
	ctl = {look = {bg = Color("#00000066"), border = [1, 1, 1, 1], border_color = Color("#ece8dc88"), radius = 3.0}, pad = [0, 5, 0, 5], st = {f = "ui", w = 700, s = 13, c = Color("#ece8dc")}, minw = 16.0},
	tip = {look = {bg = Color("#00000066"), border = [1, 1, 1, 1], border_color = Color("#ece8dc99"), radius = 3.0}, pad = [0, 6, 0, 6], st = {f = "ui", w = 700, s = 16.5, c = Color("#ece8dc")}, minw = 22.0},
}

static func keycap(text: String, kind := "kbd", size := 0) -> Container:
	var k: Dictionary = CAPS[kind]
	var st: Dictionary = k.st.duplicate()
	if size:
		st.s = size
	var b := box(k.look, k.pad)
	b.min_w = k.minw
	var l := label(text, st)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	b.add_child(l)
	b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return b

const ENTITIES := {"&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&rarr;": "→", "&larr;": "←", "&middot;": "·", "&mdash;": "—", "&ndash;": "–"}

static func decode(t: String) -> String:
	for e in ENTITIES:
		t = t.replace(e, ENTITIES[e])
	return t

## A line (or lines, at <br>) of the little HTML the game hands the UI: text, <b> and <kbd> as key caps (caps:
## the CAPS kind; null: <b> is bold), <span class="dim"> (fainter, smaller), <span style="color:..; font-size:..">,
## <small>, <em>, <i>. st: the text's own style; classes: extra span classes {name: style changes}.
static func flow(html: String, st: Dictionary, caps = "prompt", classes: Dictionary = {}, align := FlowContainer.ALIGNMENT_CENTER, sep := 0) -> VBoxContainer:
	var col := vbox(sep)
	var row := _row(align)
	col.add_child(row)
	var stack: Array[Dictionary] = [st.duplicate()]
	var re := RegEx.create_from_string("<[^>]+>|[^<]+")
	var in_cap := false
	var cap_text := ""
	var cap_tag := ""
	for m in re.search_all(html):
		var tok := m.get_string()
		var cur: Dictionary = stack.back()
		if tok.begins_with("<"):
			var tag := tok.trim_prefix("</").trim_prefix("<").trim_suffix(">").trim_suffix("/").strip_edges()
			var name := tag.split(" ")[0].to_lower()
			var closing := tok.begins_with("</")
			if name == "br":
				row = _row(align)
				col.add_child(row)
			elif (name == "b" or name == "kbd") and caps != null:
				if closing and in_cap:
					in_cap = false
					var k := keycap(cap_text, "kbd" if cap_tag == "kbd" else caps, cur.get("cap_s", 0))
					if cur.has("alpha"):
						k.modulate.a = cur.alpha
					row.add_child(k)
					row.add_child(gap(cur.get("cap_gap", 6.0)))
				elif not closing:
					in_cap = true
					cap_text = ""
					cap_tag = name
			elif closing:
				if stack.size() > 1:
					stack.pop_back()
			else:
				var n := cur.duplicate()
				if name == "b" or name == "strong":
					n.w = 700
				elif name == "small":
					n.s = roundi(cur.get("s", 16) * 0.85)
				elif name == "em" or name == "i":
					pass
				var cls := RegEx.create_from_string("class=\"([^\"]*)\"").search(tag)
				if cls:
					for c in cls.get_string(1).split(" "):
						if classes.has(c):
							n.merge(classes[c], true)
				var sty := RegEx.create_from_string("style=\"([^\"]*)\"").search(tag)
				if sty:
					for decl in sty.get_string(1).split(";"):
						var kv := decl.split(":")
						if kv.size() < 2:
							continue
						var k := kv[0].strip_edges()
						var v := kv[1].strip_edges()
						if k == "color":
							n.c = Color(v)
						elif k == "font-size":
							n.s = v.to_int()
							n.cap_s = v.to_int()
				stack.append(n)
		else:
			var t := decode(tok)
			if in_cap:
				cap_text += t
				continue
			# one label per word run, so the line can wrap between them
			var words := t.split(" ")
			for i in words.size():
				var w := words[i] + (" " if i < words.size() - 1 else "")
				if w == "":
					continue
				var st2: Dictionary = cur.duplicate()
				for k in ["alpha", "cap_s", "cap_gap"]:
					st2.erase(k)
				var l := label(w, st2)
				if cur.has("alpha"):
					l.modulate.a = cur.alpha
				row.add_child(l)
	return col

static func _row(align) -> HFlowContainer:
	var r := HFlowContainer.new()
	r.alignment = align
	r.add_theme_constant_override("h_separation", 0)
	r.add_theme_constant_override("v_separation", 0)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r

## An SVG drawn to a texture, w x h px (the drawing scaled to fit its viewBox). Cached by its text.
static var _svgs := {}
static func svg(src: String, w: float, h: float, sharp := 2.0) -> Texture2D:
	var key := "%s|%d|%d" % [src.md5_text(), w, h]
	if _svgs.has(key):
		return _svgs[key]
	var s := src.replace("<svg ", "<svg width=\"%d\" height=\"%d\" " % [roundi(w * sharp), roundi(h * sharp)])
	var img := Image.new()
	img.load_svg_from_string(s, 1.0)
	var t := ImageTexture.create_from_image(img)
	if _svgs.size() > 400:
		_svgs.clear()
	_svgs[key] = t
	return t

## The texture in a rect of its own, w x h.
static func svg_rect(src: String, w: float, h: float) -> TextureRect:
	var r := TextureRect.new()
	r.texture = svg(src, w, h)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.custom_minimum_size = Vector2(w, h)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r

## Number with thousands commas (toLocaleString).
static func num(n) -> String:
	var s := str(absi(int(round(n))))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out

## Hold a Control at an anchor point of the screen: x/y in 0..1 of the parent, the control's own pivot px/py
## in 0..1 of itself (CSS: left 50%, transform translateX(-50%) is x 0.5, px 0.5), plus an offset in px.
static func pin(c: Control, x: float, y: float, px := 0.0, py := 0.0, off := Vector2.ZERO) -> Control:
	c.set_anchors_preset(Control.PRESET_TOP_LEFT)
	c.anchor_left = x
	c.anchor_right = x
	c.anchor_top = y
	c.anchor_bottom = y
	c.grow_horizontal = Control.GROW_DIRECTION_BOTH if px == 0.5 else (Control.GROW_DIRECTION_BEGIN if px == 1.0 else Control.GROW_DIRECTION_END)
	c.grow_vertical = Control.GROW_DIRECTION_BOTH if py == 0.5 else (Control.GROW_DIRECTION_BEGIN if py == 1.0 else Control.GROW_DIRECTION_END)
	c.offset_left = off.x
	c.offset_right = off.x
	c.offset_top = off.y
	c.offset_bottom = off.y
	return c
