extends CanvasLayer
# Menus (start / pause with the graphics setting) and the HUD (crosshair, prompts, location, fps).
# (src/ui.js with menus.css and index.html's HUD styles: the page's HTML and CSS are Godot Controls here, built
# in code with the same layout, sizes, faces and colours; ui/kit.gd has the type and the small pieces, ui/box.gd
# the boxes, ui/*.gdshader the CSS filters and gradients. main.gd makes one, adds it to the tree and calls it as
# main.js calls the UI: the same methods in snake_case.)
#
# Where the JS passed or returned HTML, this takes what it meant: life_card() returns a card (a Dictionary the
# menus draw as the service record), menu({body = ...}) takes that card, a Control or plain text; prompts and
# hints may still carry the game's little bits of HTML (<b>E</b> as a key cap, <span class="dim">, <br>).

const Kit := preload("res://ui/kit.gd")
const Box := preload("res://ui/box.gd")
const Store := preload("res://src/core/store.gd")
const Graphics := preload("res://src/graphics.gd")
const Env := preload("res://src/environment.gd")
const FILTER := preload("res://ui/filter.gdshader")
const C := Kit.C

static func clamp_(v: float, a: float, b: float) -> float:
	return maxf(a, minf(b, v))

# ---------- the damage diagram ----------
const K := 5.6
static func X(x: float) -> String: return "%.1f" % (100 + x * K)
static func Y(z: float) -> String: return "%.1f" % (70 + z * K)
static func poly(part: String, pts: Array, extra := "") -> String:
	var p := PackedStringArray()
	for xz in pts:
		p.append("%s,%s" % [X(xz[0]), Y(xz[1])])
	return "<polygon data-part=\"%s\" points=\"%s\" %s{A}/>" % [part, " ".join(p), extra]
static func le(x: float) -> float: return -7.3 + ((absf(x) - 1.25) / 15) * 2.2 # wing leading / trailing edges
static func te(x: float) -> float: return -1.3 - ((absf(x) - 1.25) / 15) * 2.4
static func wing(part: String, x0: float, x1: float) -> String: return poly(part, [[x0, le(x0)], [x1, le(x1)], [x1, te(x1)], [x0, te(x0)]])
static func section_(part: String, z0: float, z1: float, w0: float, w1: float) -> String: return poly(part, [[-w0, z0], [w0, z0], [w1, z1], [-w1, z1]])
static var DIAGRAM: Array = _diagram() # [part, element with {A} where its fill goes]
static func _diagram() -> Array:
	var d := [["wingLo", wing("wingLo", -16.3, -8)], ["wingLi", wing("wingLi", -8, -1.2)], ["wingRi", wing("wingRi", 1.2, 8)], ["wingRo", wing("wingRo", 8, 16.3)],
		["tailplane", poly("tailplane", [[-6.5, 9.2], [-6.2, 8.1], [-1, 7.1], [1, 7.1], [6.2, 8.1], [6.5, 9.2], [1, 10.1], [-1, 10.1]])],
		["nose", section_("nose", -11.4, -8.6, 0.35, 1.0)], ["cockpit", section_("cockpit", -8.6, -6.35, 1.0, 1.25)], ["bombbay", section_("bombbay", -6.35, -2.6, 1.25, 1.3)],
		["radio", section_("radio", -2.6, -1.25, 1.3, 1.25)], ["waist", section_("waist", -1.25, 5.2, 1.25, 0.95)], ["tail", section_("tail", 5.2, 11.4, 0.95, 0.3)]]
	var xs := [-7.16, -3.93, 3.94, 7.15]
	for i in 4:
		d.append(["engine%d" % (i + 1), "<rect data-part=\"engine%d\" x=\"%s\" y=\"%s\" width=\"%.1f\" height=\"%.1f\" rx=\"2\" {A}/>" % [i + 1, X(xs[i] - 0.6), Y(-9.2), 1.2 * K, 3.6 * K]])
	d.append(["top", "<circle data-part=\"top\" cx=\"%s\" cy=\"%s\" r=\"%.1f\" {A}/>" % [X(0), Y(-6.7), 0.6 * K]])
	d.append(["ball", "<circle data-part=\"ball\" cx=\"%s\" cy=\"%s\" r=\"%.1f\" stroke-dasharray=\"2 1.5\" {A}/>" % [X(0), Y(-0.1), 0.55 * K]])
	return d
const STOPS := [[0.0, [143, 165, 138]], [0.25, [240, 170, 160]], [0.55, [205, 60, 45]], [0.8, [95, 18, 14]], [1.0, [12, 10, 10]]]
## normal -> light red -> dark red -> black
static func damage_colour(d: float) -> Color:
	d = minf(1, maxf(0, d))
	var i := 0
	while i < STOPS.size() - 2 and d > STOPS[i + 1][0]:
		i += 1
	var a: float = STOPS[i][0]
	var b: float = STOPS[i + 1][0]
	var ca: Array = STOPS[i][1]
	var cb: Array = STOPS[i + 1][1]
	var t := (d - a) / (b - a)
	return Color8(roundi(ca[0] + (cb[0] - ca[0]) * t), roundi(ca[1] + (cb[1] - ca[1]) * t), roundi(ca[2] + (cb[2] - ca[2]) * t))
const DMG_PARTS := ["wingLo", "wingLi", "wingRi", "wingRo", "tailplane", "nose", "cockpit", "bombbay", "radio", "waist", "tail", "engine1", "engine2", "engine3", "engine4", "top", "ball"]
static func damage_key(b) -> String:
	var k := PackedStringArray()
	for n in DMG_PARTS:
		k.append(str(roundi(b.damage(n) * 40)))
	for e in b.engines:
		k.append(str(e.state))
	var sf = b.get("sec_fire") if b is Object else b.get("sec_fire", {})
	if sf:
		for v in sf.values():
			k.append(str(bool(v)))
	var tf = b.tank_fire
	k.append(str(tf.get(-1, 0)) + str(tf.get(1, 0)))
	return ",".join(k)

# ---------- the menus' artwork: insignia and plan-view silhouettes, drawn as SVG ----------
static func star(r: float) -> String:
	var p := PackedStringArray()
	for i in 10:
		var a := -PI / 2 + (i * PI) / 5
		var k := r * 0.382 if i % 2 else r
		p.append("%.1f,%.1f" % [cos(a) * k, sin(a) * k])
	return " ".join(p)
# the loading screen's backgrounds (loading/): stills of the battle, captured in the game
const LOADING_SHOTS := ["flak", "going-down", "formation", "night-flak", "fighter", "stream"]

static var EMBLEM := {
	crew = "<svg viewBox=\"-60 -30 120 60\"><rect x=\"-56\" y=\"-9\" width=\"112\" height=\"18\" fill=\"#f3efe4\" stroke=\"#22406e\" stroke-width=\"3.5\"/><circle r=\"27\" fill=\"#22406e\"/><polygon points=\"%s\" fill=\"#f3efe4\"/></svg>" % star(25),
	bf109 = "<svg viewBox=\"-30 -30 60 60\"><path d=\"M-11-27h22v16h16v22h-16v16h-22v-16h-16v-22h16z\" fill=\"#f3efe4\" stroke=\"#111\" stroke-width=\"1\"/><path d=\"M-5-27h10v22h22v10h-22v22h-10v-22h-22v-10h22z\" fill=\"#111\"/></svg>",
	fw190 = "<svg viewBox=\"-30 -30 60 60\"><circle r=\"28\" fill=\"#e8b400\"/><circle r=\"28\" fill=\"none\" stroke=\"#111\" stroke-width=\"2\"/><path d=\"M-10-24h20v14h14v20h-14v14h-20v-14h-14v-20h14z\" fill=\"#f3efe4\" stroke=\"#111\" stroke-width=\"1\"/><path d=\"M-4.5-24h9v19.5h19.5v9h-19.5v19.5h-9v-19.5h-19.5v-9h19.5z\" fill=\"#111\"/></svg>", # (on the yellow of the Reich defence)
	p47 = "", # the USAAF's star and bars, as on the Thunderbolt's wings and fuselage (the crew's: below)
}
const EMBLEM_ASPECT := {crew = 2.0, bf109 = 1.0, fw190 = 1.0, p47 = 2.0}
static func emblem(id: String) -> String:
	return EMBLEM.crew if id == "p47" or id == "" else EMBLEM[id]
static func both(d: String) -> String: return "<path d=\"%s\"/><path d=\"%s\" transform=\"matrix(-1 0 0 1 100 0)\"/>" % [d, d] # a wing and its mirror
static var PLAN := { # recognition-chart plan views, nose up (drawn white at a tenth, behind the role cards)
	bf109 = "<svg viewBox=\"0 0 100 100\"><g fill=\"#fff\"><path d=\"M50 9C53.5 9 55 14 55.5 22L55 60 52.5 88h-5L45 60 44.5 22C45 14 46.5 9 50 9z\"/>%s%s</g></svg>" % [both("M45 33 8 37.5Q5 38 5 40.5l.5 3Q6 45.5 9 45.5L45 50z"), both("M47.5 79 36 81Q34 82 34.5 84l1.5 2.5 11.5.5z")],
	fw190 = "<svg viewBox=\"0 0 100 100\"><g fill=\"#fff\"><path d=\"M50 7C55.5 7 57 12 57 20L55.5 60 52.5 90h-5L44.5 60 43 20C43 12 44.5 7 50 7z\"/>%s%s</g></svg>" % [both("M44 30 7 37Q4 38 4 41q0 3.5 3.5 4L44 49z"), both("M47.5 82 34 83.5Q32 84.5 32.5 87q.5 2 2.5 2h12.5z")],
	p47 = "<svg viewBox=\"0 0 100 100\"><g fill=\"#fff\"><path d=\"M50 10C53 10 54.5 15 55 24v34l-3 28h-4l-3-28V24C45.5 15 47 10 50 10z\"/>%s%s</g></svg>" % [both("M45 36 9 40.5Q5 41 5 44q0 3.5 3.5 3.5L45 52z"), both("M48 78 37 80Q35 81 35.5 83.5 36 85.5 38 85.5h10z")],
}
static func plan(id: String) -> String:
	if id == "crew":
		return "<svg viewBox=\"0 0 200 140\">%s</svg>" % _diagram_svg(func(_p): return "fill=\"#fff\"")
	return PLAN[id]
# the fighters' own damage diagrams, from the same plan views: [fuselage, left wing, tailplane (one
# half, mirrored), engine y0..y1 and half-width, cockpit y, fuel tank y0..y1] in a 100 x 100 box, nose up
const FPLAN := {
	bf109 = ["M50 9C53.5 9 55 14 55.5 22L55 60 52.5 88h-5L45 60 44.5 22C45 14 46.5 9 50 9z", "M45 33 8 37.5Q5 38 5 40.5l.5 3Q6 45.5 9 45.5L45 50z", "M47.5 79 36 81Q34 82 34.5 84l1.5 2.5 11.5.5z", 9.5, 25, 4.6, 37, 45, 53],
	fw190 = ["M50 7C55.5 7 57 12 57 20L55.5 60 52.5 90h-5L44.5 60 43 20C43 12 44.5 7 50 7z", "M44 30 7 37Q4 38 4 41q0 3.5 3.5 4L44 49z", "M47.5 82 34 83.5Q32 84.5 32.5 87q.5 2 2.5 2h12.5z", 8, 24, 6, 35, 41, 49],
	p47 = ["M50 10C53 10 54.5 15 55 24v34l-3 28h-4l-3-28V24C45.5 15 47 10 50 10z", "M45 36 9 40.5Q5 41 5 44q0 3.5 3.5 3.5L45 52z", "M48 78 37 80Q35 81 35.5 83.5 36 85.5 38 85.5h10z", 10.5, 31, 4.6, 41, 49, 56],
}
static func _fdiagram(kind: String) -> Array:
	if not FPLAN.has(kind):
		return []
	var f: Array = FPLAN[kind]
	var body: String = f[0]
	var w: String = f[1]
	var tail: String = f[2]
	return [["wingL", "<path data-part=\"wingL\" d=\"%s\" {A}/>" % w], ["wingR", "<path data-part=\"wingR\" d=\"%s\" transform=\"matrix(-1 0 0 1 100 0)\" {A}/>" % w],
		["tail", "<path data-part=\"tail\" d=\"%s\" {A}/>" % tail], ["tail", "<path data-part=\"tail\" d=\"%s\" transform=\"matrix(-1 0 0 1 100 0)\" {A}/>" % tail],
		["fuselage", "<path data-part=\"fuselage\" d=\"%s\" {A}/>" % body],
		["engine", "<rect data-part=\"engine\" x=\"%s\" y=\"%s\" width=\"%s\" height=\"%s\" rx=\"2.5\" {A}/>" % [50 - f[5], f[3], f[5] * 2, f[4] - f[3]]],
		["fuel", "<rect data-part=\"fuel\" x=\"46.5\" y=\"%s\" width=\"7\" height=\"%s\" rx=\"1\" {A}/>" % [f[7], f[8] - f[7]]],
		["pilot", "<circle data-part=\"pilot\" cx=\"50\" cy=\"%s\" r=\"3.2\" {A}/>" % f[6]]]
static func _diagram_svg(attrs: Callable, parts: Array = DIAGRAM) -> String:
	var s := ""
	for p in parts:
		var a = attrs.call(p[0])
		if a != null:
			s += p[1].replace("{A}", a)
	return s

const ROLES := {
	crew = {name = "B-17 crewman", unit = "Eighth Air Force", line = "Ten men, thirteen guns, one target.",
		does = ["Man any of the bomber's guns", "Fly her from the pilot's seat", "Drop the bombs through the Norden sight", "Patch up the wounded"]},
	bf109 = {name = "Bf 109 pilot", unit = "Luftwaffe · JG 26", line = "Break up the bomber stream.",
		does = ["Dive through the boxes head-on", "Bring the B-17s down", "Wait for the Thunderbolts to turn back"]},
	fw190 = {name = "Fw 190 pilot", unit = "Luftwaffe · Sturmgruppe", line = "Through the bombers head-on.",
		does = ["Four 20 mm cannon and armour", "Attack in a tight group from ahead", "Outrun the escorts in a dive"]},
	p47 = {name = "P-47 pilot", unit = "56th Fighter Group", line = "Cover the bombers through the fight.",
		does = ["Fly escort over the stream", "Break up attacks before they land", "Stay with them all the way in"]},
}
# (the cards' colours: .role-card.crew etc.)
const CARD := {
	crew = {grad = [[0.0, Color("#5f6a3d")], [0.55, Color("#3d4527")], [1.0, Color("#262b19")]], accent = Color("#d9b56a")},
	bf109 = {grad = [[0.0, Color("#6a737f")], [0.55, Color("#464d57")], [1.0, Color("#2a2e35")]], accent = Color("#f0c13a")},
	fw190 = {grad = [[0.0, Color("#5e626e")], [0.55, Color("#3e424c")], [1.0, Color("#24272e")]], accent = Color("#f2c230")},
	p47 = {grad = [[0.0, Color("#4d6589")], [0.55, Color("#31445f")], [1.0, Color("#1d283a")]], accent = Color("#ef5a3c")},
}
const ICON := { # (stroked in the tool's colour)
	full = "<path d=\"M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5\"/>",
	gear = "<circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1\"/><circle cx=\"12\" cy=\"12\" r=\"6.5\"/>",
	keys = "<rect x=\"2.5\" y=\"6\" width=\"19\" height=\"12\" rx=\"2\"/><path d=\"M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10\"/>",
	info = "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7.5v.5\"/>",
	sound = "<path d=\"M4 9.5h3.5L12 5.5v13l-4.5-4H4z\"/><path d=\"M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11\"/>",
	muted = "<path d=\"M4 9.5h3.5L12 5.5v13l-4.5-4H4z\"/><path d=\"M16 9.5l5 5M21 9.5l-5 5\"/>",
}
static func icon(name: String, color: Color, w := 1.8) -> String:
	return "<svg viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"#%s\" stroke-width=\"%s\" stroke-linecap=\"round\" stroke-linejoin=\"round\">%s</g></svg>" % [color.to_html(false), w, ICON[name]]
const CONTROLS := [
	["General", [["Esc", "pause"], ["M", "mission map (hold)"], ["H", "controls card"], ["N", "mute"], ["F3", "frame rate"], ["J", "bail out (B-17: rings the bell, then E at a red hatch) · in free fall: the ripcord"], ["Alt+Enter", "full screen"]]],
	["B-17 crewman", [["W A S D", "walk"], ["Shift", "hurry"], ["Mouse", "look"], ["E", "take / leave a position"], ["Left click", "fire"], ["Right click", "zoom"], ["R", "reload"],
		["C", "hold: look round"], ["F", "hold by a wounded man: first aid"]]],
	["Pilot's seat", [["Mouse", "steer"], ["W / S", "throttle"], ["A / D", "roll"], ["T", "fire bottle, worst engine"], ["F", "feather it"], ["1 – 4", "a bottle on that engine"], ["C", "hold: look round"], ["V", "cockpit / third-person view"]]],
	["Bombsight", [["1 – 4", "in the nose: its guns, left to right"], ["5 / B", "in the nose, from the initial point: the bombsight"], ["A / D", "steer the formation"], ["Space / Click", "bombs away"], ["B / E", "leave the sight"]]],
	["Fighters", [["Mouse", "aim where you fly"], ["W / S", "throttle"], ["A / D", "roll"], ["Left click", "guns"], ["Middle click", "lock on / off (aim assist)"], ["Right click", "hold: zoom"], ["C", "hold: look round"], ["V", "cockpit / third-person view"], ["J", "bail out"]]],
]
## "W / S" -> [W] [S]; "W A S D" -> four keys.
static func keycaps(k: String) -> Array:
	var out := []
	var re := RegEx.create_from_string("^([A-Z] )+[A-Z]$")
	for x in k.split(" / "):
		if re.search(x):
			out.append_array(x.split(" "))
		else:
			out.append(x)
	return out
const FACTS := [
	"The B-17F carried up to twelve .50-calibre machine guns, two of them in the nose cheeks.",
	"Bomber crews flew at 25,000 feet in an unpressurised cabin, at forty below and colder.",
	"Gunners wore electrically heated suits, plugged into the aircraft.",
	"The Norden bombsight was so secret that bombardiers swore an oath to protect it.",
	"The combat box stacked the bombers so that their guns covered one another.",
	"A tour of duty was 25 missions. In the autumn of 1943 few crews lived to finish one.",
	"More than 12,000 B-17s were built between 1936 and 1945.",
	"In October 1943 the P-47s could only escort the bombers as far as the German border.",
	"On 14 October 1943, Black Thursday, 60 of the 291 B-17s sent to Schweinfurt were shot down.",
	"The ball turret gunner flew curled up under the fuselage, with no room for his parachute.",
]
static func mmss(s: float) -> String:
	return "%d:%02d" % [floori(s / 60), floori(fmod(s, 60))]

## A little paper texture for the formation plot: flecks and fibres on cream.
static func paper_texture() -> ImageTexture:
	var img := Image.create(256, 256, false, Image.FORMAT_RGBA8)
	img.fill(Color("#e9dfc3"))
	for i in 2600:
		var col := Color8(90, 70, 40) if randf() < 0.55 else Color8(255, 250, 235)
		col.a = randf() * 0.08
		var r := Rect2i(randi() % 256, randi() % 256, 1 + randi() % 2, 1 + randi() % 2)
		for y in range(r.position.y, mini(256, r.end.y)):
			for x in range(r.position.x, mini(256, r.end.x)):
				img.set_pixel(x, y, img.get_pixel(x, y).blend(col))
	return ImageTexture.create_from_image(img)

# ======================================================================================================

var _e := {} # the named pieces (the page's ids)
func el(id: String) -> Control:
	return _e.get(id)
var show_fps := false
var frames := 0
var fps_time := 0.0
var root: Control
var hud_mode := "crew" # (#hud[data-mode])
var seat_pick = null
var briefed := false
var counted := false
var loading_done := false
var map_key = null # (the formation plot's own keys, while it's up)
var map_resize = null
var paper_tex: ImageTexture
var events: Array = []
var tips_shown := {}
var toggle_hud: Callable # (set by hud_options: flip one option from the game)
var show_conditions: Callable # (set by conditions)
var env_selects: Callable # (set by env_controls)
## main.gd: the crew's radio hears what's logged first (main.js wrapped ui.log); true = said aloud, not kept.
var hear: Callable
var _last := {} # what each HUD piece last showed (lastMission, lastCrew...)
var _ctl_key = null
var ctl_open_until := 0.0
var ctl_pinned = null
var _anim := [] # running per-frame animations: [Callable(dt) -> bool keep]
var _menu_kind := "loading"
var _drawer_open := false

func _now() -> float:
	return Time.get_ticks_usec() / 1000.0

func _init() -> void:
	layer = 10
	root = Control.new()
	root.name = "ui"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_hurt()
	_build_hud()
	_build_map()
	_build_menu()
	var cond := _build_conditions()
	_e["menu-cond"] = cond
	var mr := Kit.hbox(22, BoxContainer.ALIGNMENT_CENTER)
	mr.visible = false
	_e["menu-roles"] = mr
	var ml := Kit.vbox(0)
	_e["menu-loading"] = ml
	_persist = [cond, mr, ml]
	_e.menu.visible = true

func _process(dt: float) -> void:
	var keep := []
	for f in _anim:
		if f.call(dt):
			keep.append(f)
	_anim = keep

## Run f(dt) every frame until it returns false.
func _every_frame(f: Callable) -> void:
	_anim.append(f)

## A fade (or any property) over time, the CSS transition.
func _tween(node: Object, prop: String, to, secs: float, delay := 0.0) -> Tween:
	var t := create_tween()
	if delay > 0.0:
		t.tween_interval(delay)
	t.tween_property(node, prop, to, secs).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	return t

static func _clear(n: Node) -> void:
	for c in n.get_children():
		n.remove_child(c)
		c.queue_free()

## A full-screen layer for absolutely placed things.
static func _layer(name := "") -> Control:
	var c := Control.new()
	if name:
		c.name = name
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

## A Control that draws with f(control) (a canvas).
static func _canvas(f: Callable, w := 0.0, h := 0.0) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, h)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.draw.connect(func(): f.call(c))
	return c

static func _filter_rect(params: Dictionary) -> ColorRect:
	var r := ColorRect.new()
	r.set_anchors_preset(Control.PRESET_FULL_RECT)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = FILTER
	for k in params:
		m.set_shader_parameter(k, params[k])
	r.material = m
	return r

# ---------- the menu pieces menus.css styles: buttons, tool buttons, selects, sliders, switches ----------

## .btn: primary (brass), ghost, danger; on the paper sheets (sheet) the paper's own versions.
func _btn(text: String, style := "primary", sheet := false, small := false) -> Container:
	var look := {}
	var col: Color = C.cream
	match style:
		"primary":
			if sheet:
				look = {grad = [[0.0, Color("#66713f")], [1.0, Color("#434c2a")]], cut = 9.0, ring = [1.0, Color("#a5b0767a")], shadow = [6, 16, Color("#00000055")]}
			else:
				look = {grad = [[0.0, Color("#e2c37c")], [1.0, Color("#b8914a")]], cut = 9.0, ring = [1.0, Color("#ffffff33")], bottom = Color("#00000033"), shadow = [8, 22, Color("#000000aa")]}
				col = C.ink
		"ghost":
			if sheet:
				look = {bg = Color("#ffffff33"), cut = 9.0, ring = [1.0, Color("#261f1580")]}
				col = C.ink
			else:
				look = {bg = Color("#0d0f0a99"), cut = 9.0, ring = [1.0, Color("#efe8d64d")]}
		"danger":
			look = {grad = [[0.0, Color("#a8352a")], [1.0, Color("#7c2219")]], cut = 9.0, ring = [1.0, Color("#ff9a8a55")]}
			if sheet:
				look.shadow = [6, 16, Color("#00000055")]
		_: # (the plain olive .btn)
			look = {grad = [[0.0, Color("#66713f")], [1.0, Color("#4b5530")]], cut = 9.0, ring = [1.0, Color("#a5b0767a")], top = Color("#ffffff26"), shadow = [6, 18, Color("#00000088")]}
	var b := Kit.box(look, [10, 16, 10, 16] if small else [12, 34, 12, 34], true)
	b.hover_look = {bright = 1.12}
	b.press_look = {bright = 0.92}
	b.lift = 2.0
	b.focus_ring = C.brass2
	if style == "primary" and not small:
		b.min_w = 240.0
	var l := Kit.label(text, {f = "cond", w = 600, s = 15 if small else 17, ls = 0.1 if small else 0.16, up = true, c = col})
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b.add_child(l)
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	b.set_meta("label", l)
	return b

## .tool: the top bar's buttons (an icon and a word).
func _tool(text: String, icon_name := "") -> Container:
	var b := Kit.box({bg = Color("#0f110bb3"), border = [1, 1, 1, 1], border_color = Color("#c9a55a40"), radius = 3.0}, [7, 14, 7, 14], true)
	b.hover_look = {bg = Color("#23271ae6"), border_color = C.brass}
	b.focus_ring = C.brass2
	var row := Kit.hbox(8)
	if icon_name:
		row.add_child(Kit.svg_rect(icon(icon_name, C.brass), 16, 16))
	var l := Kit.label(text, {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.cream})
	row.add_child(l)
	b.add_child(row)
	b.set_meta("label", l)
	return b

static var _select_theme: Theme
## .select: a dropdown (small: the conditions' pickers).
func _select(options: Array, small := false) -> OptionButton:
	var o := OptionButton.new()
	for i in options.size():
		o.add_item(str(options[i][1]), i)
		o.set_item_metadata(i, str(options[i][0]))
	if not _select_theme:
		_select_theme = Theme.new()
		var n := StyleBoxFlat.new()
		n.bg_color = Color("#0d0f0a")
		n.set_border_width_all(1)
		n.border_color = Color("#606b3c")
		n.set_corner_radius_all(3)
		var h := n.duplicate()
		h.border_color = C.brass
		for s in ["normal", "pressed", "disabled"]:
			_select_theme.set_stylebox(s, "OptionButton", n)
		_select_theme.set_stylebox("hover", "OptionButton", h)
		_select_theme.set_stylebox("focus", "OptionButton", h)
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			_select_theme.set_color(k, "OptionButton", C.cream)
		var p := StyleBoxFlat.new()
		p.bg_color = Color("#0d0f0a")
		p.set_border_width_all(1)
		p.border_color = Color("#606b3c")
		p.set_content_margin_all(4)
		_select_theme.set_stylebox("panel", "PopupMenu", p)
		var ph := StyleBoxFlat.new()
		ph.bg_color = Color("#4b5530")
		_select_theme.set_stylebox("hover", "PopupMenu", ph)
		_select_theme.set_color("font_color", "PopupMenu", C.cream)
		_select_theme.set_color("font_hover_color", "PopupMenu", C.cream)
		_select_theme.set_font("font", "PopupMenu", Kit.font("ui", 500))
		_select_theme.set_font_size("font_size", "PopupMenu", 15)
		_select_theme.set_constant("v_separation", "PopupMenu", 8)
		# the chevron: brass, as .select::after draws it
		var chev := Image.create(16, 10, false, Image.FORMAT_RGBA8)
		for x in 16:
			for y in 10:
				var d := absf(absf(x - 7.5) - (7.5 - y * 0.95))
				chev.set_pixel(x, y, Color(C.brass, clampf(1.6 - d, 0, 1)) if y < 9 else Color(0, 0, 0, 0))
		_select_theme.set_icon("arrow", "OptionButton", ImageTexture.create_from_image(chev))
	o.theme = _select_theme
	var sb_pad := [6, 30, 6, 10] if small else [10, 40, 10, 14]
	for s in ["normal", "pressed", "hover", "focus", "disabled"]:
		var st: StyleBoxFlat = _select_theme.get_stylebox(s, "OptionButton").duplicate()
		st.content_margin_top = sb_pad[0]
		st.content_margin_right = sb_pad[1]
		st.content_margin_bottom = sb_pad[2]
		st.content_margin_left = sb_pad[3]
		o.add_theme_stylebox_override(s, st)
	o.add_theme_font_override("font", Kit.font("ui", 500))
	o.add_theme_font_size_override("font_size", 14 if small else 15)
	o.add_theme_constant_override("arrow_margin", 11 if small else 14)
	o.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	return o

static func _select_value(o: OptionButton) -> String:
	return str(o.get_item_metadata(o.selected)) if o.selected >= 0 else ""

static func _select_set(o: OptionButton, v) -> void:
	for i in o.item_count:
		if str(o.get_item_metadata(i)) == str(v):
			o.select(i)
			return

static var _slider_theme: Theme
## <input type="range"> with the brass accent.
func _slider(w := 0.0) -> HSlider:
	var s := HSlider.new()
	s.min_value = 0
	s.max_value = 100
	s.step = 1
	s.value = 100
	s.custom_minimum_size = Vector2(w, 20)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if not _slider_theme:
		_slider_theme = Theme.new()
		var track := StyleBoxFlat.new()
		track.bg_color = Color("#efe8d640")
		track.set_corner_radius_all(2)
		track.content_margin_top = 2
		track.content_margin_bottom = 2
		var fill := track.duplicate()
		fill.bg_color = C.brass
		_slider_theme.set_stylebox("slider", "HSlider", track)
		_slider_theme.set_stylebox("grabber_area", "HSlider", fill)
		_slider_theme.set_stylebox("grabber_area_highlight", "HSlider", fill)
		var dot := Image.create(16, 16, false, Image.FORMAT_RGBA8)
		for x in 16:
			for y in 16:
				dot.set_pixel(x, y, Color(C.brass, clampf(7.5 - Vector2(x - 7.5, y - 7.5).length(), 0, 1)))
		var tex := ImageTexture.create_from_image(dot)
		_slider_theme.set_icon("grabber", "HSlider", tex)
		_slider_theme.set_icon("grabber_highlight", "HSlider", tex)
	s.theme = _slider_theme
	return s

## A label switch (.set-row.toggle): the words, and the pill switch at the right.
func _toggle_row(title: String, help: String) -> Array:
	var row := Kit.box({}, [14, 0, 16, 0], true)
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var h := Kit.hbox(16)
	var words := Kit.vbox(2)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.add_child(Kit.label(title, {f = "cond", w = 600, s = 15, ls = 0.16, up = true, c = C.cream}))
	words.add_child(Kit.label(help, {f = "ui", w = 500, s = 13, c = C.cream_dim, wrap = true}))
	h.add_child(words)
	var sw := {on = false}
	var pill := _canvas(func(c: Control):
		var on: bool = c.get_meta("on", false)
		var r := Rect2(0, 0, 46, 24)
		var bg := StyleBoxFlat.new()
		bg.bg_color = C.od2 if on else Color("#0d0f0a")
		bg.set_corner_radius_all(12)
		bg.set_border_width_all(0 if on else 1)
		bg.border_color = C.od2
		c.draw_style_box(bg, r)
		c.draw_circle(Vector2(3 + 9 + (22 if on else 0), 12), 9, C.brass2 if on else C.cream_dim), 46, 24)
	pill.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(pill)
	row.add_child(h)
	row.add_child(_dashed_bottom(Color("#c9a55a2e")))
	return [row, pill]

## The dashed rule under a settings row (border-bottom: 1px dashed).
static func _dashed_bottom(col: Color) -> Control:
	var c := _canvas(func(c: Control): c.draw_dashed_line(Vector2(0, c.size.y - 0.5), Vector2(c.size.x, c.size.y - 0.5), col, 1.0, 3.0))
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	return c

## The rubber stamp: a word in a double red frame, tilted (.stamp).
func _stamp(text: String) -> Control:
	var st := Kit.settings({f = "display", w = 400, s = 22, ls = 0.14, c = C.red})
	var t := text.to_upper()
	var tw := st.font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 22).x
	var w := tw + 24 + 6
	var h := 22 * 1.1 + 4 + 6
	var c := _canvas(func(c: Control):
		var col := Color(C.red, 0.82)
		c.draw_rect(Rect2(0.5, 0.5, w - 1, h - 1), col, false, 1.0)
		c.draw_rect(Rect2(2.5, 2.5, w - 5, h - 5), col, false, 1.0)
		c.draw_string(st.font, Vector2(15, h - 9), t, HORIZONTAL_ALIGNMENT_LEFT, -1, 22, col)
		# (the rubber's wear: specks where the ink didn't take)
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(text)
		for i in int(w * h / 40):
			c.draw_rect(Rect2(rng.randf() * w, rng.randf() * h, 1.5, 1.5), Color(0.91, 0.87, 0.76, rng.randf() * 0.5)), w, h)
	c.size = Vector2(w, h)
	c.pivot_offset = Vector2(w, h) / 2
	c.rotation = deg_to_rad(-7)
	return c

## The kicker: brass words between two short rules that fade in towards them.
func _kicker(text: String, col: Color) -> Control:
	var row := Kit.hbox(14, BoxContainer.ALIGNMENT_CENTER)
	for side in 2:
		var line := _canvas(func(c: Control):
			for i in 46:
				var k := float(i) / 45.0
				c.draw_rect(Rect2(i, 10, 1, 1), Color(col, k if side == 0 else 1.0 - k)), 46, 20)
		row.add_child(line)
		if side == 0:
			row.add_child(Kit.label(text, {f = "cond", w = 600, s = 14, ls = 0.2, up = true, c = col}))
	return row

# ======================================================================================================
# the menu (#menu): the overlay, the top bar, the card, the drawer

func _build_menu() -> void:
	var menu := _layer("menu")
	menu.mouse_filter = Control.MOUSE_FILTER_STOP
	menu.visible = false
	root.add_child(menu)
	_e.menu = menu
	# the scene behind, darker at the edges, a little sepia, film grain
	menu.add_child(_filter_rect({sepia = 0.5, saturate = 0.65, brightness = 0.72, contrast = 1.06,
		rad_in = Color("#18140c26"), rad_mid = Color("#0b0906a8"), rad_out = Color("#050403ee"), rad_midpoint = 0.58, rad_r = Vector2(1.2, 0.95), rad_at = Vector2(0.5, 0.42), grain = 0.16}))
	# the loading screen's slides
	var slides := _layer("slides")
	slides.clip_contents = true
	slides.visible = false
	menu.add_child(slides)
	_e.slides = slides
	# the thin brass frame inset 12px
	var frame_line := _canvas(func(c: Control): c.draw_rect(Rect2(12.5, 12.5, c.size.x - 25, c.size.y - 25), Color("#c9a55a22"), false, 1.0))
	frame_line.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu.add_child(frame_line)
	var frame := MarginContainer.new()
	frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for s in [["top", 20], ["right", 34], ["bottom", 16], ["left", 34]]:
		frame.add_theme_constant_override("margin_" + s[0], s[1])
	menu.add_child(frame)
	var col := Kit.vbox(0)
	frame.add_child(col)
	# top bar: the unit, and the sound, full screen, controls and settings
	var top = Kit.hbox(16)
	top.custom_minimum_size.y = 40
	top.add_child(_brand("VIII Bomber Command"))
	var sp := Kit.gap()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp)
	var tools := Kit.hbox(8)
	tools.add_child(_sound_top())
	var fs := _tool("Full screen", "full")
	fs.set_meta("fs", true)
	tools.add_child(fs)
	var ctl := _tool("Controls", "keys")
	ctl.pressed.connect(func(): drawer("controls"))
	tools.add_child(ctl)
	var set_ := _tool("Settings", "gear")
	set_.pressed.connect(func(): drawer("settings"))
	tools.add_child(set_)
	top.add_child(tools)
	col.add_child(top)
	# the middle: one card, centred, scrolls only if the window is very small
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.mouse_filter = Control.MOUSE_FILTER_PASS
	col.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scroll.add_child(center)
	_e.menu_center = center
	scroll.resized.connect(func(): center.custom_minimum_size = Vector2(scroll.size.x, scroll.size.y))
	var card := Kit.box({}, 0.0)
	center.add_child(card)
	_e.menu_card = card
	var card_col := Kit.vbox(0)
	card.add_child(card_col)
	_e.card_col = card_col
	var card_over := _layer()
	card.add_child(card_over)
	_e.card_over = card_over
	# the footer: the hint
	var foot := Kit.hbox(20)
	foot.custom_minimum_size.y = 28
	var hint_box := Kit.hbox(0)
	foot.add_child(hint_box)
	_e.menu_hint = hint_box
	col.add_child(foot)
	# the drawer: settings, options and controls
	var scrim := ColorRect.new()
	scrim.color = Color("#00000088")
	scrim.set_anchors_preset(Control.PRESET_FULL_RECT)
	scrim.visible = false
	scrim.gui_input.connect(func(e): if e is InputEventMouseButton and e.pressed: close_drawer())
	menu.add_child(scrim)
	_e.drawer_scrim = scrim
	menu.add_child(_build_drawer())

func _brand(second: String) -> Control:
	var b := Kit.hbox(12)
	b.add_child(Kit.svg_rect(EMBLEM.crew, 52, 26))
	var st := {f = "cond", w = 600, s = 14, ls = 0.16, up = true, c = C.brass}
	b.add_child(Kit.label("Eighth Air Force", st))
	b.add_child(_canvas(func(c: Control): c.draw_circle(Vector2(2, c.size.y / 2), 2, Color(C.brass, 0.6)), 4, 4))
	b.get_child(2).size_flags_vertical = Control.SIZE_FILL
	var l := Kit.label(second, st)
	b.add_child(l)
	return b

## The sound on every menu's top bar: mute and volume, always to hand.
func _sound_top() -> Control:
	var b := Kit.box({bg = Color("#0f110bb3"), border = [1, 1, 1, 1], border_color = Color("#c9a55a40"), radius = 3.0}, [3, 12, 3, 4])
	var row := Kit.hbox(10)
	var mute := _icon_btn(32, 28, false)
	row.add_child(mute)
	var s := _slider(120)
	row.add_child(s)
	var out := Kit.label("", {f = "cond", w = 600, s = 13, ls = 0.08, c = C.cream})
	out.custom_minimum_size.x = 38
	out.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(out)
	b.add_child(row)
	_e["snd-mute-top"] = mute
	_e["snd-vol-top"] = s
	_e["snd-val-top"] = out
	return b

## .icon-btn: the mute button (its icon set by sound()).
func _icon_btn(w: float, h: float, framed := true) -> Container:
	var look := {bg = Color("#0d0f0a"), border = [1, 1, 1, 1], border_color = Color("#606b3c"), radius = 3.0} if framed else {}
	var b := Kit.box(look, 0.0, true)
	b.hover_look = {border_color = C.brass} if framed else {}
	b.min_w = w
	b.min_h = h
	var t := TextureRect.new()
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(t)
	b.set_meta("icon", t)
	return b

func _build_drawer() -> Control:
	var d := Kit.box({grad = [[0.0, Color("#1e2117")], [1.0, Color("#14160f")]], grain = 0.12, shadow = [0, 60, Color("#000000aa")]}, 0.0)
	d.mouse_filter = Control.MOUSE_FILTER_STOP
	d.anchor_left = 1.0
	d.anchor_right = 1.0
	d.anchor_top = 0.0
	d.anchor_bottom = 1.0
	d.offset_left = -600
	d.offset_right = 0
	d.visible = false
	_e.drawer = d
	var col := Kit.vbox(0)
	d.add_child(col)
	# the brass line down its left edge
	var edge := _canvas(func(c: Control): c.draw_line(Vector2(0.5, 0), Vector2(0.5, c.size.y), Color("#c9a55a55"), 1.0))
	edge.set_anchors_preset(Control.PRESET_FULL_RECT)
	d.add_child(edge)
	var head := MarginContainer.new()
	for s in [["top", 18], ["right", 22], ["bottom", 0], ["left", 26]]:
		head.add_theme_constant_override("margin_" + s[0], s[1])
	var hrow := Kit.hbox(0)
	head.add_child(hrow)
	var tabs := Kit.hbox(4)
	_e.tabs = {}
	for t in [["settings", "Settings"], ["options", "Options"], ["controls", "Controls"]]:
		var b := Kit.box({border = [0, 0, 0, 3], border_color = Color(0, 0, 0, 0)}, [10, 18, 9, 18], true)
		var l := Kit.label(t[1], {f = "cond", w = 600, s = 15, ls = 0.16, up = true, c = C.cream_dim})
		b.add_child(l)
		b.set_meta("label", l)
		var id: String = t[0]
		b.pressed.connect(func(): drawer(id))
		b.mouse_entered.connect(func(): l.modulate = Color(1.15, 1.15, 1.15))
		b.mouse_exited.connect(func(): l.modulate = Color.WHITE)
		tabs.add_child(b)
		_e.tabs[id] = b
	hrow.add_child(tabs)
	var sp := Kit.gap()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hrow.add_child(sp)
	var close := _tool("Close")
	close.pad = [6, 12, 6, 12]
	close.get_child(0).add_child(Kit.keycap("Esc"))
	close.pressed.connect(close_drawer)
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var cw := MarginContainer.new()
	cw.add_theme_constant_override("margin_bottom", 8)
	cw.add_child(close)
	hrow.add_child(cw)
	col.add_child(head)
	col.add_child(Kit.rule(Color("#c9a55a33")))
	_e.panes = {}
	for id in ["settings", "options", "controls"]:
		var sc := ScrollContainer.new()
		sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
		sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		var m := MarginContainer.new()
		m.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for s in [["top", 22], ["right", 26], ["bottom", 26], ["left", 26]]:
			m.add_theme_constant_override("margin_" + s[0], s[1])
		sc.add_child(m)
		var pane := Kit.vbox(0)
		m.add_child(pane)
		sc.visible = false
		col.add_child(sc)
		_e.panes[id] = sc
		call("_pane_" + id, pane)
	return d

func _set_row(name: String, help: String, ctl: Control) -> Control:
	var row := Kit.box({}, [14, 0, 16, 0])
	var c := Kit.vbox(0)
	c.add_child(Kit.label(name, {f = "cond", w = 600, s = 15, ls = 0.16, up = true, c = C.cream}))
	c.add_child(Kit.label(help, {f = "ui", w = 500, s = 14.5, c = C.cream_dim, wrap = true}))
	c.add_child(Kit.gap(0, 10))
	c.add_child(ctl)
	row.add_child(c)
	row.add_child(_dashed_bottom(Color("#c9a55a2e")))
	return row

func _pane_settings(p: VBoxContainer) -> void:
	var fsb := _btn("Full screen", "ghost", false, true)
	fsb.pad = [9, 18, 9, 18]
	fsb.set_meta("fs", true)
	fsb.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	p.add_child(_set_row("Display", "Alt+Enter switches it in the game too.", fsb))
	var q := _select(Graphics.QUALITY.keys().map(func(k): return [k, Graphics.QUALITY[k].label]))
	_e["menu-quality"] = q
	p.add_child(_set_row("Graphics", "Lower it if the frame rate drops.", q))
	var snd := Kit.hbox(14)
	var mute := _icon_btn(42, 38)
	snd.add_child(mute)
	var vol := _slider()
	vol.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	snd.add_child(vol)
	var val := Kit.label("", {f = "ui", w = 600, s = 15, c = C.cream})
	val.custom_minimum_size.x = 46
	val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	snd.add_child(val)
	_e["snd-mute"] = mute
	_e["snd-vol"] = vol
	_e["snd-val"] = val
	p.add_child(_set_row("Sound", "N mutes it in the game too.", snd))
	var mix := Kit.vbox(6)
	_e.mixers = {}
	for m in [["guns", "Guns"], ["engines", "Engines"], ["battle", "Flak and hits"], ["crew", "Crew and turret motors"]]:
		var r := Kit.hbox(14)
		var l := Kit.label(m[1], {f = "ui", w = 500, s = 15, c = C.cream})
		l.custom_minimum_size.x = 170
		r.add_child(l)
		var s := _slider()
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(s)
		var o := Kit.label("", {f = "ui", w = 600, s = 15, c = C.cream})
		o.custom_minimum_size.x = 46
		o.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		r.add_child(o)
		mix.add_child(r)
		_e.mixers[m[0]] = [s, o]
	p.add_child(_set_row("Sound mix", "Each kind of sound on its own.", mix))
	_e.env_selects = {}
	for e in [["time", "Time of day", "Morning sun, high noon, dusk or a moonlit night."], ["season", "Season", "Autumn browns the fields (mid-October, as on the day); winter brings snow and thicker contrails."],
			["weather", "Weather", "Clear, cloudy, rain, or a thunderstorm with lightning."]]:
		var s := _select(Env.ENV_OPTIONS[e[0]])
		_e.env_selects[e[0]] = s
		p.add_child(_set_row(e[1], e[2], s))

func _pane_options(p: VBoxContainer) -> void:
	p.add_child(Kit.label("What's drawn over the battle. Each one on its own; remembered for next time.", {f = "ui", w = 500, s = 13, c = C.cream_dim, wrap = true}))
	p.add_child(Kit.gap(0, 6))
	_e.hud_boxes = {}
	for o in [["enemy", "Enemy markers", "The red triangles over enemy aircraft"], ["friend", "Friendly markers", "The blue triangles over your own side"],
			["distance", "Distance numbers", "The range under each marker, once within 1,000 m"], ["lead", "Lead marker", "Where to aim ahead of a fighter so your rounds meet it"],
			["plainSight", "Plain crosshair in fighters", "Instead of the reflector gunsight in the cockpit"], ["third", "Third-person view for pilots", "Behind your fighter or your B-17 instead of the cockpit. V switches it in flight"], ["infinite", "Infinite ammunition", "Your guns never run out (off: limited, as the real ones were: reload with R)"],
			["historical", "Historical outcomes", "The bombers recorded as lost on 14 October 1943 are the likeliest to go down, those that came home the least, and the recorded aborts turn back. Off: the battle plays out on its own"]]:
		var r := _toggle_row(o[1], o[2])
		r[1].set_meta("on", o[0] == "lead")
		p.add_child(r[0])
		_e.hud_boxes[o[0]] = r

func _pane_controls(p: VBoxContainer) -> void:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 30)
	grid.add_theme_constant_override("v_separation", 6)
	for g in CONTROLS:
		var gc := Kit.vbox(0)
		gc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		gc.add_child(Kit.gap(0, 12))
		gc.add_child(Kit.label(g[0], {f = "cond", w = 600, s = 14, ls = 0.16, up = true, c = C.brass}))
		gc.add_child(Kit.gap(0, 4))
		gc.add_child(Kit.rule(Color("#c9a55a33")))
		gc.add_child(Kit.gap(0, 6))
		for r in g[1]:
			var row := Kit.hbox(10)
			row.custom_minimum_size.y = 28
			var keys := Kit.hbox(4)
			for k in keycaps(r[0]):
				keys.add_child(Kit.keycap(k))
			row.add_child(keys)
			var w := Kit.label(r[1], {f = "ui", w = 500, s = 15, c = Color("#e6dfcc"), wrap = true, align = HORIZONTAL_ALIGNMENT_RIGHT})
			w.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(w)
			gc.add_child(row)
		grid.add_child(gc)
	p.add_child(grid)

## Role cards: crew / bf109 / fw190 / p47. `into` is the element id; on_role(id) is called with the choice.
## only: the ids to offer (all four by default). 1, 2, 3 pick them from the keyboard too.
func roles(into: String, on_role, only := ["crew", "bf109", "fw190", "p47"]) -> void:
	var box: Container = el(into)
	_clear(box)
	if not on_role:
		box.visible = false
		return
	box.visible = true
	var small := into == "map-roles"
	for i in only.size():
		var id: String = only[i]
		var card := _role_card(id, i, small)
		card.pressed.connect(func(): on_role.call(id))
		box.add_child(card)
		if not small:
			card.modulate.a = 0.0
			_tween(card, "modulate:a", 1.0, 0.34, 0.06 * mini(i, 2))

func _role_card(id: String, i: int, small: bool) -> Container:
	var r: Dictionary = ROLES[id]
	var cc: Dictionary = CARD[id]
	var accent: Color = cc.accent
	var look := {grad = cc.grad, angle = 165.0, radius = 4.0, grain = 0.18, ring = [1.0, Color("#ffffff1f")], top = Color("#ffffff26"), shadow = [14, 34, Color("#000000bb")]}
	var card := Kit.box(look, [10, 12, 10, 16] if small else [20, 22, 18, 22], true)
	card.hover_look = {ring = [2.0, accent], shadow = [22, 44, Color("#000000dd")], glow = [30, Color(accent, 0.25)]}
	card.lift = 3.0 if small else 6.0
	card.clip_contents = true
	if not small:
		card.custom_minimum_size.x = 320
	# the stripe down its left edge, the plan view behind, the rivets
	var deco := _canvas(func(c: Control):
		c.draw_rect(Rect2(-(card.pad[3]), -(card.pad[0]), 5, card.size.y), accent)
		var k := 7.0
		var pts := [Vector2(k, k), Vector2(card.size.x - k, k), Vector2(k, card.size.y - k), Vector2(card.size.x - k, card.size.y - k)]
		for p in pts:
			c.draw_circle(p - Vector2(card.pad[3], card.pad[0]), 1.6, Color("#ffffff40"))
		)
	deco.set_anchors_preset(Control.PRESET_FULL_RECT)
	if not small:
		var pl := Kit.svg_rect(plan(id), 250, 250 * (0.7 if id == "crew" else 1.0))
		pl.modulate = Color(1, 1, 1, 0.1)
		pl.rotation = deg_to_rad(-18)
		pl.set_anchors_preset(Control.PRESET_TOP_LEFT)
		pl.position = Vector2(320 * 0.36 - 22, 0)
		pl.size = pl.custom_minimum_size
		pl.pivot_offset = pl.size / 2
		card.resized.connect(func(): pl.position = Vector2(card.size.x * (1 - 0.78 + 0.14) - 22, card.size.y * (1 + 0.12) - pl.size.y - 20))
		card.add_child(_wrap_free(pl))
	var col := Kit.vbox(0)
	card.add_child(col)
	card.add_child(deco)
	var head := Kit.hbox(10)
	var eh := 24.0 if small else 40.0
	head.add_child(Kit.svg_rect(emblem(id), eh * EMBLEM_ASPECT[id], eh))
	if not small:
		var sp := Kit.gap()
		sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(sp)
		head.add_child(Kit.label(r.unit, {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = accent, align = HORIZONTAL_ALIGNMENT_RIGHT}))
	col.add_child(head)
	if small:
		col.add_child(Kit.label(r.name, {f = "display", w = 400, s = 16, ls = 0.04, c = C.cream, lh = 1.05, wrap = true}))
		return card
	col.add_child(Kit.gap(0, 16))
	col.add_child(Kit.label(r.name, {f = "display", w = 400, s = 30, ls = 0.04, c = C.cream, lh = 1.05}))
	col.add_child(Kit.gap(0, 2))
	col.add_child(Kit.label(r.line, {f = "ui", w = 500, s = 16, c = Color("#e9e2cf"), lh = 1.45, wrap = true}))
	col.add_child(Kit.gap(0, 14))
	col.add_child(Kit.rule(Color("#ffffff22")))
	col.add_child(Kit.gap(0, 12))
	for d in r.does:
		var li := Kit.hbox(0)
		li.add_child(_canvas(func(c: Control):
			var m := Vector2(2 + 3.5, 12)
			c.draw_colored_polygon(PackedVector2Array([m + Vector2(0, -3.5), m + Vector2(3.5, 0), m + Vector2(0, 3.5), m + Vector2(-3.5, 0)]), accent), 18, 24))
		li.get_child(0).size_flags_vertical = Control.SIZE_FILL
		var l := Kit.label(d, {f = "ui", w = 500, s = 15, c = Color("#e6dfcc"), lh = 1.6, wrap = true})
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		li.add_child(l)
		col.add_child(li)
	var fill := Kit.gap()
	fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(fill)
	col.add_child(Kit.gap(0, 16))
	var foot := Kit.hbox(0)
	foot.add_child(Kit.keycap(str(i + 1)))
	var sp2 := Kit.gap()
	sp2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(sp2)
	var go := Kit.label("Take this role →", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = accent})
	foot.add_child(go)
	col.add_child(foot)
	return card

## A Control laid out by hand inside a container (the container leaves it where it's put).
static func _wrap_free(c: Control) -> Control:
	var w := Control.new()
	w.mouse_filter = Control.MOUSE_FILTER_IGNORE
	w.add_child(c)
	return w

## Open the menu's drawer at a tab: 'settings', 'options' or 'controls'.
func drawer(tab: String) -> void:
	var d: Control = el("drawer")
	var was := _drawer_open
	_drawer_open = true
	d.visible = true
	el("drawer_scrim").visible = true
	for t in _e.tabs:
		var b: Container = _e.tabs[t]
		var on: bool = t == tab
		b.set_look({border = [0, 0, 0, 3], border_color = C.brass if on else Color(0, 0, 0, 0)})
		b.get_meta("label").label_settings = Kit.settings({f = "cond", w = 600, s = 15, ls = 0.16, up = true, c = C.cream if on else C.cream_dim})
	for p in _e.panes:
		_e.panes[p].visible = p == tab
	_e.tabs[tab].grab_focus()
	if not was: # (it slides in from the right)
		d.offset_left = -600 + 620
		d.offset_right = 620
		_tween(d, "offset_left", -600.0, 0.28)
		_tween(d, "offset_right", 0.0, 0.28)
		el("drawer_scrim").modulate.a = 0.0
		_tween(el("drawer_scrim"), "modulate:a", 1.0, 0.25)

func close_drawer() -> void:
	_drawer_open = false
	if el("drawer"):
		el("drawer").visible = false
		el("drawer_scrim").visible = false

var drawer_open: bool:
	get: return _drawer_open

func _input(e: InputEvent) -> void:
	if not (e is InputEventKey and e.pressed):
		return
	var k := e as InputEventKey
	if k.keycode == KEY_F3 and not k.echo:
		show_fps = not show_fps
		el("fps").visible = show_fps
		get_viewport().set_input_as_handled()
		return
	if k.keycode == KEY_ENTER and k.alt_pressed and not k.echo:
		_toggle_fullscreen()
		get_viewport().set_input_as_handled()
		return
	if k.keycode == KEY_N and not k.echo and _sound_flip.is_valid() and not _typing():
		_sound_flip.call()
	menu_key(k)

## (a text field or a dropdown has the keys)
func _typing() -> bool:
	var f := get_viewport().gui_get_focus_owner()
	return f is LineEdit or f is TextEdit or f is OptionButton or f is Slider

## Keys on a menu: Esc closes the drawer, 1 2 3 pick a role card and the arrows move between them; the map has its own.
func menu_key(e: InputEventKey) -> void:
	var menu_on: bool = el("menu").visible
	var map_on: bool = el("map").visible
	if not menu_on and not map_on:
		return
	var stop := func(): get_viewport().set_input_as_handled() # (not on to the game's own keys)
	if menu_on and drawer_open:
		if e.keycode == KEY_ESCAPE:
			stop.call()
			close_drawer()
		return
	if _typing():
		return
	if map_on and map_key and map_key.call(e):
		stop.call()
		return
	var cards: Array = el("map-roles" if map_on else "menu-roles").get_children()
	var n := -1
	if e.keycode >= KEY_1 and e.keycode <= KEY_9:
		n = e.keycode - KEY_1 + 1
	elif e.keycode >= KEY_KP_1 and e.keycode <= KEY_KP_9:
		n = e.keycode - KEY_KP_1 + 1
	if n > 0 and n <= cards.size() and not e.echo:
		stop.call()
		cards[n - 1].pressed.emit()
		return
	if (e.keycode == KEY_RIGHT or e.keycode == KEY_LEFT) and cards.size():
		var i := cards.find(get_viewport().gui_get_focus_owner())
		cards[0 if i < 0 else (i + (1 if e.keycode == KEY_RIGHT else cards.size() - 1)) % cards.size()].grab_focus()
		stop.call()

## Which HUD to show: the bomber's (crew) or the fighter pilot's.
func set_mode(mode: String) -> void:
	hud_mode = mode if mode == "crew" or mode == "eject" else "fighter"
	if mode == "crew":
		el("gunsight").visible = false
		el("flight").visible = false
		el("nose").visible = false
		_at(el("crosshair"), null)
		el("crosshair").visible = true
	_apply_mode()

## The fighter pilot's instruments (null hides them).
func fighter(s) -> void:
	var box: Control = el("flight")
	var nose: Control = el("nose")
	var sight: Control = el("gunsight")
	box.visible = s != null
	_apply_mode()
	# the gunsight and the nose circle sit where the guns point; the crosshair is where you're steering
	var cross: Control = el("crosshair")
	var flying: bool = s != null and s.view != "chase"
	# (the cockpit's reflector sight is the gunsight; with the plain crosshair option, these instead)
	sight.visible = flying and s.marker != null and not s.reflector
	nose.visible = s != null and s.marker != null and not s.reflector and not sight.visible # (not under the gunsight: one mark there)
	cross.visible = s == null or s.view == "chase" or s.aim != null
	_at(cross, s.aim if flying else null)
	if s == null:
		return
	if s.marker:
		_at(nose, s.marker)
		_at(sight, s.marker)
	_clear(box)
	var head := Kit.hbox(0)
	head.add_child(Kit.label(s.kind, {f = "cond", w = 700, s = 13, ls = 0.08, up = true, c = Color("#ece8dccc"), sh = true}))
	if s.get("damage", ""):
		head.add_child(Kit.label(" · " + s.damage, {f = "cond", w = 700, s = 13, ls = 0.08, up = true, c = Color("#ffb36a"), sh = true}))
	box.add_child(head)
	box.add_child(Kit.flow("<b>%d</b> km/h · <b>%s</b> ft" % [roundi(s.speed * 3.6), Kit.num(s.alt)], _FLIGHT, null, {}, FlowContainer.ALIGNMENT_BEGIN))
	box.add_child(_bar(s.throttle, Color("#8fcf6a"), 7))
	box.add_child(Kit.label("Throttle %d%%" % roundi(s.throttle * 100), _LBL))
	for k in s.ammo:
		box.add_child(Kit.flow("%s <b>%d</b>" % ["20 mm" if k == "cannon" else "MG", s.ammo[k].n], _FLIGHT, null, {}, FlowContainer.ALIGNMENT_BEGIN))
	box.add_child(_bar(minf(1, s.heat), Color("#ff4a3a") if s.jammed else Color("#ffa23a") if s.heat > 0.7 else Color("#d9d2b8"), 7))
	box.add_child(Kit.label("Guns overheated" if s.jammed else "Gun heat", _LBL))
	health(s.health, null)
const _FLIGHT := {f = "ui", w = 500, s = 15, c = Color("#ece8dc"), sh = true}
const _LBL := {f = "cond", w = 700, s = 13, ls = 0.08, up = true, c = Color("#ece8dccc"), sh = true}

## A HUD bar (.bar i): a dark track with a border, the fill v of it.
func _bar(v: float, col: Color, h := 5.0, track := Color("#00000077"), border := Color("#ece8dc55")) -> Control:
	var c := _canvas(func(c: Control):
		c.draw_rect(Rect2(Vector2.ZERO, c.size), track)
		c.draw_rect(Rect2(1, 1, maxf(0, (c.size.x - 2) * clampf(v, 0, 1)), c.size.y - 2), col)
		c.draw_rect(Rect2(0.5, 0.5, c.size.x - 1, c.size.y - 1), border, false, 1.0), 0, h)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return c

## Put a HUD mark at a point of the screen (0..1), or back where the stylesheet has it (null: the middle).
func _at(c: Control, p) -> void:
	var x: float = p.x if p else 0.5
	var y: float = p.y if p else 0.5
	Kit.pin(c, x, y, 0.5, 0.5)

# ======================================================================================================

var _on_go: Callable
var _on_quality: Callable
var _typing_tween: Tween
var _persist := [] # (the card's pieces that are wired once and kept: the conditions, the roles, the loading)

## A full-screen menu. kind sets the layout: 'loading', 'start', 'roles' (pick again after a sortie), or the
## paper sheets 'pause', 'debrief' and 'over'. facts: the briefing strip [[label, value]]; status: the pause
## sheet's mission at a glance (status_html); body: more (a service record from life_card, a Control, or text);
## actions: more buttons [{label, on_click, style, confirm}] (confirm: the button asks once more before it acts).
func menu(o: Dictionary) -> void:
	var kind: String = o.get("kind", "start")
	var title: String = o.get("title", "")
	var kicker: String = o.get("kicker", "")
	var sub: String = o.get("sub", "")
	var text = o.get("text", null)
	var facts = o.get("facts", null)
	var stamp: String = o.get("stamp", "")
	var button = o.get("button", null)
	var status = o.get("status", null)
	var body = o.get("body", "")
	var actions: Array = o.get("actions", [])
	var hint_html: String = o.get("hint", "")
	var seats = o.get("seats", null)
	_menu_kind = kind
	seat_pick = null
	var sheet: bool = kind in ["pause", "debrief", "over"]
	var pause := kind == "pause"
	var card: Container = el("menu_card")
	var col: VBoxContainer = el("card_col")
	for c in col.get_children():
		col.remove_child(c)
		if not c in _persist:
			c.queue_free()
	_clear(el("card_over"))
	if sheet: # the paper: the pause sheet, the interrogation report
		card.set_look({bg = C.paper, grain = 0.07, vignette = Color("#9a7c4433"), ring = [1.0, Color("#00000055")], shadow = [26, 70, Color("#000000ee")]})
		card.pad = [26, 44, 22, 44] if pause else [34, 44, 30, 44]
		card.custom_minimum_size.x = 900 if pause else 1180 if kind == "debrief" else 700
		var head := ColorRect.new()
		head.color = Color(C.ink, 0.88)
		head.anchor_right = 1.0
		head.offset_left = -card.pad[3]
		head.offset_right = card.pad[1]
		head.offset_top = -card.pad[0]
		head.offset_bottom = -card.pad[0] + 22
		var hl := Kit.label("Restricted · Mission in progress" if pause else "Restricted · Interrogation report", {f = "cond", w = 600, s = 12, ls = 0.3, up = true, c = C.paper})
		hl.set_anchors_preset(Control.PRESET_FULL_RECT)
		hl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		hl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		head.add_child(hl)
		el("card_over").add_child(head)
	else:
		card.set_look({})
		card.pad = [0, 0, 0, 0]
		card.custom_minimum_size.x = 0
	var ink: Color = C.ink if sheet else C.cream
	var add := func(c: Control, top: float):
		if top > 0:
			col.add_child(Kit.gap(0, top))
		c.size_flags_horizontal = Control.SIZE_SHRINK_CENTER if not c.has_meta("fill") else Control.SIZE_FILL
		col.add_child(c)
	if kicker:
		add.call(_kicker(kicker, C.ink2 if sheet else C.brass), 10 if sheet else 0)
	var h1 := 124 if kind == "start" or kind == "loading" else 64 if pause else 78 if sheet else 88
	var t := Kit.label(title, {f = "display", w = 400, s = h1, ls = 0.06, c = ink, lh = 0.95, sh = not sheet})
	if not sheet:
		t.label_settings = t.label_settings.duplicate()
		t.label_settings.shadow_offset = Vector2(0, 2)
		t.label_settings.shadow_color = Color("#00000080")
		t.label_settings.shadow_size = 1
	if title:
		add.call(t, (6 if pause else 14) if sheet else 2)
	if sub:
		add.call(Kit.label(sub, {f = "cond", w = 600, s = 20, ls = 0.62, up = true, c = C.cream_dim}), 4)
	if _typing_tween:
		_typing_tween.kill()
	if text != null and text != "":
		var brief := Kit.label(text, {f = "ui", w = 500, s = 17, c = C.ink2 if sheet else Color("#e8e0cb"), lh = 1.55, wrap = true, align = HORIZONTAL_ALIGNMENT_CENTER})
		brief.custom_minimum_size.x = minf(760, Kit.settings({f = "ui", w = 500, s = 17}).font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 17).x + 4)
		add.call(brief, 8 if sheet else 18)
		if kind == "start" and not briefed:
			briefed = true
			typewrite(brief, text)
	el("fact_cond_ref").set_meta("label", null)
	if facts:
		add.call(_facts(facts), 16)
	if kind == "start":
		add.call(el("menu-cond"), 22)
	if kind == "loading" and el("menu-loading").get_child_count():
		add.call(el("menu-loading"), 34)
	if kind != "loading":
		_clear(el("menu-loading"))
		loading_done = true
	if status:
		add.call(status_html(status), 14 if pause else 22)
	var b := _render_body(body)
	if seats:
		var wrap := Kit.vbox(0)
		if b:
			wrap.add_child(b)
		wrap.add_child(seats_html(seats, o.get("on_seat", Callable())))
		b = wrap
	if b:
		b.set_meta("fill", true)
		add.call(b, 18)
	var q: OptionButton = el("menu-quality")
	if o.has("quality") and o.quality:
		_select_set(q, o.quality)
	if o.has("on_quality") and o.on_quality:
		_on_quality = o.on_quality
	roles("menu-roles", o.get("roles", null))
	if el("menu-roles").visible:
		add.call(el("menu-roles"), 30)
	var acts := Kit.vbox(12 if not pause else 8, BoxContainer.ALIGNMENT_CENTER)
	if button:
		var go := _btn(button, "primary", sheet)
		if pause:
			go.pad = [12, 34, 12, 34]
		_on_go = o.get("on_click", Callable())
		go.pressed.connect(func(): if _on_go.is_valid(): _on_go.call())
		acts.add_child(go)
		_e["menu-go"] = go
	if actions.size():
		var extra := Kit.hbox(8 if pause else 10, BoxContainer.ALIGNMENT_CENTER)
		for a in actions:
			var bt := _btn(a.label, a.get("style", "ghost"), sheet, pause)
			var lbl: Label = bt.get_meta("label")
			bt.pressed.connect(func():
				if a.get("confirm", "") and not bt.has_meta("armed"):
					bt.set_meta("armed", true)
					lbl.text = a.confirm
					var dl := _btn("", "danger", sheet, pause)
					bt.set_look(dl.look)
					dl.free()
					lbl.label_settings = Kit.settings({f = "cond", w = 600, s = 15 if pause else 17, ls = 0.1 if pause else 0.16, up = true, c = C.cream})
					return
				a.on_click.call())
			extra.add_child(bt)
		acts.add_child(extra)
	if acts.get_child_count():
		add.call(acts, 14 if pause else 22)
	_clear(el("menu_hint"))
	if hint_html:
		el("menu_hint").add_child(Kit.flow(hint_html, {f = "ui", w = 500, s = 14, c = Color("#d2c9b2"), cap_gap = 4.0}, "kbd", {}, FlowContainer.ALIGNMENT_BEGIN))
	if stamp: # (rubber stamps: on the sheets it sits on the paper's edge)
		var s := _stamp(stamp)
		el("card_over").add_child(s)
		s.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		var right = 26.0 - card.pad[1] if sheet else -18.0
		var top = 40.0 - card.pad[0] if sheet else 6.0
		s.position = Vector2(0, top)
		card.resized.connect(func(): s.position = Vector2(card.size.x - card.pad[1] - card.pad[3] - right - s.size.x, top), CONNECT_ONE_SHOT)
		s.modulate.a = 0.0
		s.scale = Vector2(1.6, 1.6)
		_tween(s, "modulate:a", 0.82 / 0.82, 0.3, 0.15)
		_tween(s, "scale", Vector2.ONE, 0.3, 0.15).set_trans(Tween.TRANS_BACK)
	close_drawer()
	# (each page comes in afresh, row by row)
	var i := 0
	for c in col.get_children():
		if c.custom_minimum_size.y > 0 and c.get_child_count() == 0:
			continue
		c.modulate.a = 0.0
		_tween(c, "modulate:a", 1.0, 0.32, 0.1 if i >= 6 else 0.05 if i >= 3 else 0.0)
		i += 1
	el("menu").visible = true
	el("slides").visible = kind == "loading"
	el("map").visible = false
	el("hud").visible = false

## The briefing facts: a strip of labels and values between two brass rules.
func _facts(facts: Array) -> Control:
	var strip := Kit.box({border = [0, 1, 0, 1], border_color = Color("#c9a55a40")}, 0.0)
	var row := Kit.hbox(0)
	for i in facts.size():
		var f: Array = facts[i]
		var cell := Kit.box({}, [8, 22, 8, 22])
		var v := Kit.vbox(0)
		v.add_child(Kit.label(f[0], {f = "cond", w = 600, s = 13, ls = 0.14, up = true, c = C.brass}))
		var val := Kit.label(str(f[1]), {f = "ui", w = 600, s = 18, c = C.cream})
		v.add_child(val)
		cell.add_child(v)
		if f[0] == "Conditions":
			el("fact_cond_ref").set_meta("label", val)
		if i > 0:
			var dash := _canvas(func(c: Control): c.draw_dashed_line(Vector2(0.5, 0), Vector2(0.5, c.size.y), Color("#c9a55a33"), 1.0, 3.0))
			dash.set_anchors_preset(Control.PRESET_FULL_RECT)
			cell.add_child(dash)
		row.add_child(cell)
	strip.add_child(row)
	return strip

## The briefing strip's Conditions (main.js set it in the page itself when the conditions change).
func set_conditions_fact(text: String) -> void:
	var l = el("fact_cond_ref").get_meta("label", null)
	if l and is_instance_valid(l):
		l.text = text

## Type a line out quickly (under half a second); the rest is there but clear, so nothing moves as it grows.
func typewrite(label: Label, text: String) -> void:
	var dur := minf(450, text.length() * 4) / 1000.0
	label.visible_characters_behavior = TextServer.VC_CHARS_AFTER_SHAPING
	label.visible_ratio = 0.0
	_typing_tween = create_tween()
	_typing_tween.tween_property(label, "visible_ratio", 1.0, dur)

## What menu({body}) shows: a service record (life_card), a Control, or plain text.
func _render_body(body) -> Control:
	if body is Control:
		return body
	if body is Dictionary and body.get("_card", false):
		return _record(body)
	if body is String and body != "":
		return Kit.label(body, {f = "ui", w = 500, s = 16, c = C.ink2, wrap = true, align = HORIZONTAL_ALIGNMENT_CENTER})
	return null

## The loading screen: a checklist (steps), a bar that follows the pieces actually loading (total of them),
## and a fact about the B-17 now and then. Returns a Loading: track(signal or callable, step) and tick(step):
## each piece done moves the bar on, and a step is ticked off once every piece in it is in.
func loading(steps: Array, total: int, quality, on_quality) -> Loading:
	var box: Container = el("menu-loading")
	_clear(box)
	var l := Loading.new(self, steps, total)
	box.add_child(l.build())
	menu({kind = "loading", kicker = "Eighth Air Force · 14 October 1943", title = "Black Thursday", sub = "B-17 Flying Fortress", quality = quality, on_quality = on_quality})
	slides()
	loading_done = false
	return l

class Loading:
	var ui
	var steps: Array
	var total: int
	var pending: Array
	var seen: Array
	var done := 0
	var shown := 0.0
	var marks: Array = []
	var bar: Control
	var what: Label
	var pct: Label
	var fact: Control
	var line: Label
	var f := 0
	var fact_t := 0.0

	func _init(u, s: Array, t: int) -> void:
		ui = u
		steps = s
		total = t
		pending = s.map(func(_x): return 0)
		seen = s.map(func(_x): return false)

	func build() -> Control:
		var col: VBoxContainer = Kit.vbox(0)
		col.custom_minimum_size.x = 600
		var list: HBoxContainer = Kit.hbox(8)
		for i in steps.size():
			var item: HBoxContainer = Kit.hbox(8)
			var mark = ui._canvas(func(c: Control):
				var st: String = c.get_meta("st", "")
				var colr: Color = C.brass if st == "done" else C.cream if st == "now" else C.cream_dim
				var r := Rect2(0.75, 0.75, 10.5, 10.5)
				if st == "done":
					c.draw_rect(Rect2(0, 0, 12, 12), C.brass)
					c.draw_polyline(PackedVector2Array([Vector2(2.5, 6.5), Vector2(5, 9), Vector2(9.5, 3)]), C.ink, 2.0)
				elif st == "now" and fmod(Time.get_ticks_msec() / 800.0, 1.0) > 0.5:
					c.draw_rect(r, Color("#efe8d655"))
				c.draw_rect(r, colr, false, 1.5), 12, 12)
			mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			item.add_child(mark)
			var lab: Label = Kit.label(steps[i], {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.cream_dim})
			item.add_child(lab)
			marks.append([mark, lab])
			if i > 0:
				var sp: Control = Kit.gap()
				sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				list.add_child(sp)
			list.add_child(item)
		col.add_child(list)
		col.add_child(Kit.gap(0, 12))
		bar = ui._canvas(func(c: Control): ui._draw_progress(c, shown), 600, 10)
		col.add_child(bar)
		col.add_child(Kit.gap(0, 8))
		var row: HBoxContainer = Kit.hbox(0)
		what = Kit.label("", {f = "ui", w = 500, s = 14, c = C.cream_dim})
		what.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(what)
		pct = Kit.label("", {f = "ui", w = 500, s = 14, c = C.cream_dim})
		row.add_child(pct)
		col.add_child(row)
		col.add_child(Kit.gap(0, 30))
		fact = Kit.box({bg = Color("#0d0f0a8c"), border = [3, 0, 0, 0], border_color = C.brass}, [14, 20, 14, 20])
		fact.custom_minimum_size.x = 560
		fact.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		var fc: VBoxContainer = Kit.vbox(4)
		fc.add_child(Kit.label("Did you know", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.brass}))
		f = randi() % FACTS.size()
		line = Kit.label(FACTS[f % FACTS.size()], {f = "ui", w = 500, s = 16, c = Color("#ddd3bb"), lh = 1.55, wrap = true})
		f += 1
		fc.add_child(line)
		fact.add_child(fc)
		col.add_child(fact)
		show()
		# the bar moves steadily: it eases towards how much is really done, and while it waits on something
		# slow (the last step, getting every shader ready) it creeps on a little, so it never sits still
		ui._every_frame(func(dt: float) -> bool:
			if not is_instance_valid(bar) or not bar.is_inside_tree() or ui.loading_done:
				return false
			dt = minf(0.1, dt)
			var real := minf(1.0, float(done) / total)
			var ceiling := 1.0 if real >= 1 else minf(0.97, real + 0.12)
			shown = minf(ceiling, shown + maxf(0.03, (real - shown) * 2.2) * dt)
			if real > shown + 0.25:
				shown = real - 0.25 # (never too far behind)
			bar.queue_redraw()
			pct.text = "%d%%" % floori(shown * 100)
			for m in marks:
				m[0].queue_redraw()
			fact_t += dt
			if fact_t > 4.5: # a new fact every 4.5 s, faded across
				fact_t = 0.0
				var tw: Tween = ui.create_tween()
				tw.tween_property(fact, "modulate:a", 0.0, 0.3)
				tw.tween_callback(func(): line.text = FACTS[f % FACTS.size()]; f += 1)
				tw.tween_property(fact, "modulate:a", 1.0, 0.3)
			return true)
		return col

	func show() -> void:
		var now := -1
		for i in steps.size():
			if not seen[i] or pending[i] > 0:
				now = i
				break
		for i in marks.size():
			var st := "done" if seen[i] and not pending[i] else "now" if i == now else ""
			marks[i][0].set_meta("st", st)
			marks[i][1].label_settings = Kit.settings({f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.brass if st == "done" else C.cream if st == "now" else C.cream_dim})
			marks[i][0].queue_redraw()
		what.text = "Ready" if now < 0 else "%s…" % steps[now]

	## Follow a piece loading: p is a Signal (awaited) or a Callable (called and awaited); returns its result.
	func track(p, step: int):
		pending[step] += 1
		seen[step] = true
		show()
		var r = null
		if p is Signal:
			r = await p
		elif p is Callable:
			r = await p.call()
		else:
			r = p
		pending[step] -= 1
		done += 1
		show()
		return r

	func tick(step: int) -> void:
		seen[step] = true
		done += 1
		show()

static var _stripes: ImageTexture
## The loading bar: brass stripes at -45°, ticks every tenth.
func _draw_progress(c: Control, v: float) -> void:
	if not _stripes:
		var img := Image.create(28, 28, false, Image.FORMAT_RGBA8)
		for x in 28:
			for y in 28:
				img.set_pixel(x, y, Color("#e2c37c") if fposmod(x + y, 28.28) < 14.14 else C.brass)
		_stripes = ImageTexture.create_from_image(img)
	var w := c.size.x
	c.draw_rect(Rect2(0, 0, w, 10), Color("#0d0f0acc"))
	c.draw_texture_rect(_stripes, Rect2(0, 0, w * v, 10), true)
	for i in range(1, 10):
		c.draw_rect(Rect2(w * i / 10.0 - 1, 0, 1, 10), Color("#0d0f0a99"))
	c.draw_rect(Rect2(0.5, 0.5, w - 1, 9), Color("#c9a55a55"), false, 1.0)

## The pause sheet's mission at a glance. s: {phase, detail, toTarget (s, or null once past it), role,
## health (0..1, null when not flying), engines, crewFit, crewMen, life, mission, lives, forces {total, healthy, damaged, down}}.
## (The JS's statusHtml: the same tiles, as Controls.)
func status_html(s: Dictionary) -> Control:
	var pct := func(v: float) -> int: return roundi(v * 100)
	var l: Dictionary = s.life
	var f: Dictionary = s.forces
	var tiles := []
	var tile := func(k: String, v: String, small: String, meter):
		tiles.append([k, v, small, meter])
	var kills := int(l.kills + l.bombers)
	var acc := "%.1f" % ((100.0 * l.hits) / l.fired) if l.fired else "0.0"
	tile.call("Mission", s.phase, s.get("detail", ""), null)
	var tt = s.get("toTarget", null)
	tile.call("Target", mmss(tt) if tt != null else "Behind us", "until it's under the bombsight" if tt != null else "heading for home", null)
	var mine := "Your bomber" if s.role == "crew" else "Your fighter"
	if s.get("health", null) == null:
		tile.call(mine, "—", "not flying", null)
	else:
		var more := ""
		if s.role == "crew":
			var cm = s.get("crewMen", null)
			more = "%d of 4 engines · %s" % [s.engines, ("%d fit%s%s" % [cm.alive, ", %d wounded" % cm.wounded if cm.wounded else "", ", %d dead" % cm.dead if cm.dead else ""]) if cm else "%d of 10 crew fit" % s.crewFit]
		tile.call(mine, "%d%%" % pct.call(s.health), more, s.health)
	tile.call("This life", "%d kill%s" % [kills, "" if kills == 1 else "s"], "%d hits · %s%% accuracy" % [l.hits, acc], null)
	tile.call("Mission score", Kit.num(s.mission.points), "%d %s so far" % [s.lives, "life" if s.lives == 1 else "lives"], null)
	var men = f.get("men", null)
	tile.call("The stream", "%d of %d" % [f.healthy + f.damaged, f.total], "%d damaged · %d lost%s" % [f.damaged, f.down, " · men %d dead, %d wounded" % [men.dead, men.wounded] if men else ""], null)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 0)
	grid.add_theme_constant_override("v_separation", 0)
	var frame := Kit.box({border = [1, 1, 1, 1], border_color = Color("#261f1540")}, 0.0)
	frame.add_child(grid)
	var count_up := not counted
	counted = true
	for i in tiles.size():
		var tl: Array = tiles[i]
		var cell := Kit.box({border = [0, 0, 0 if i % 3 == 2 else 1, 0 if i >= 3 else 1], border_color = Color("#261f1530")}, [10, 14, 10, 14])
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cell.custom_minimum_size.x = 270
		var v := Kit.vbox(0)
		v.add_child(Kit.label(tl[0], {f = "cond", w = 700, s = 13, ls = 0.14, up = true, c = C.ink2}))
		v.add_child(Kit.gap(0, 2))
		var b := Kit.label(tl[1], {f = "ui", w = 600, s = 25, c = C.ink, lh = 1.15})
		v.add_child(b)
		if tl[3] != null:
			var mv: float = tl[3]
			v.add_child(Kit.gap(0, 6))
			v.add_child(_bar(mv, C.fit if mv > 0.6 else C.dmg if mv > 0.3 else C.fire, 6, Color("#261f1526"), Color(0, 0, 0, 0)))
		if tl[2]:
			v.add_child(Kit.gap(0, 3))
			v.add_child(Kit.label(tl[2], {f = "ui", w = 500, s = 14, c = C.ink2, lh = 1.35, wrap = true}))
		cell.add_child(v)
		grid.add_child(cell)
		# the first time: the numbers count up
		var m := RegEx.create_from_string("^(\\d[\\d,]*)(.*)$").search(tl[1])
		if count_up and m:
			var to := m.get_string(1).replace(",", "").to_int()
			var rest := m.get_string(2)
			if to >= 2:
				var tw := create_tween()
				tw.tween_method(func(k: float): b.text = Kit.num(roundi(to * (1 - pow(1 - k, 3)))) + rest, 0.0, 1.0, 0.45)
		cell.modulate.a = 0.0
		_tween(cell, "modulate:a", 1.0, 0.22, 0.06 if i >= 3 else 0.0)
	return frame

## The pause sheet's crew positions: who's there, and whether you can take it. seats: [{id, name, who, state, can, here}].
func seats_html(seats: Array, on_seat: Callable) -> Control:
	var word := {ok = "✓ Manned", wounded = "✚ Wounded", dead = "✕ KIA", bailed = "↓ Gone", free = "○ Free", you = "★ You", out = "✕ Knocked out"}
	var sec := Kit.vbox(0)
	sec.add_child(Kit.gap(0, 14))
	sec.add_child(Kit.label("Change position", {f = "cond", w = 700, s = 14, ls = 0.16, up = true, c = C.ink}))
	sec.add_child(Kit.gap(0, 5))
	sec.add_child(Kit.rule(C.ink, 2))
	sec.add_child(Kit.gap(0, 10))
	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	sec.add_child(grid)
	for i in seats.size():
		var s: Dictionary = seats[i]
		var takes: bool = s.can and not s.here
		var look := {bg = Color("#fff8e0aa"), ring = [3.0, Color("#a8822c")]} if s.here else {bg = Color("#ffffff66"), ring = [1.0, Color("#261f1566")]}
		var b := Kit.box(look, [8, 11, 8, 11], takes)
		b.min_h = 68
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.size_flags_vertical = Control.SIZE_FILL
		b.custom_minimum_size.x = 156
		if takes:
			b.hover_look = {bg = Color("#ffffffbb"), ring = [2.0, C.od], shadow = [6, 14, Color("#00000033")]}
			b.press_look = {bg = Color("#4b553033")}
			b.lift = 2.0
			b.focus_ring = C.brass2
			var id: String = s.id
			b.pressed.connect(func(): on_seat.call(id))
		elif not s.here:
			b.modulate.a = 0.55
		var v := Kit.vbox(2)
		v.add_child(Kit.label(s.name, {f = "cond", w = 700, s = 16, ls = 0.05, up = true, c = C.ink}))
		v.add_child(Kit.label(str(s.get("who", "")), {f = "ui", w = 600, s = 16, c = C.ink, lh = 1.25}))
		if s.get("job", ""):
			v.add_child(Kit.label(s.job, {f = "ui", w = 500, s = 13.5, c = C.ink2, lh = 1.25}))
		var fill := Kit.gap()
		fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
		v.add_child(fill)
		var chip_state: String = "player" if s.state == "you" else "ok" if s.state == "free" else s.state
		var crow := Kit.hbox(0)
		crow.add_child(_chip(word.you if s.here else word[s.state], chip_state, true))
		v.add_child(Kit.gap(0, 4))
		v.add_child(crow)
		b.add_child(v)
		if takes: # "Take it ›", there on hover
			var take := Kit.label("Take it ›", {f = "cond", w = 700, s = 13, ls = 0.08, c = C.od})
			take.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
			take.grow_horizontal = Control.GROW_DIRECTION_BEGIN
			take.grow_vertical = Control.GROW_DIRECTION_BEGIN
			take.modulate.a = 0.0
			var over := _layer()
			over.add_child(take)
			b.add_child(over)
			b.mouse_entered.connect(func(): _tween(take, "modulate:a", 1.0, 0.14))
			b.mouse_exited.connect(func(): _tween(take, "modulate:a", 0.0, 0.14))
		grid.add_child(b)
		b.modulate.a *= 0.0
		var a := 1.0 if s.here or takes else 0.55
		_tween(b, "modulate:a", a, 0.22, 0.06 * floori(i / 4.0))
	return sec

## A state chip: white on green (fit), on amber (wounded), on red (KIA)...; seat: the pause sheet's darker ones.
func _chip(text: String, state: String, seat := false, take := false) -> Control:
	var bg := {ok = C.fit, wounded = Color("#e0a72c"), dead = C.fire, bailed = Color("#261f1522"), player = Color("#261f1522"), free = C.fit, out = Color("#6d5f50")}
	var fg := {wounded = C.ink, bailed = C.ink, player = C.ink}
	if seat:
		bg = {ok = Color("#2f6420"), player = Color("#8a6a24"), wounded = Color("#a35f00"), dead = Color("#6d5f50"), out = Color("#6d5f50"), bailed = Color("#6d5f50"), free = C.fit}
		fg = {}
	var look := {bg = bg.get(state, C.fit), radius = 2.0}
	if state in ["bailed", "player"] and not seat:
		look.ring = [1.0, Color("#261f1566")]
	var b := Kit.box(look, [2, 8, 1, 8] if seat else [2, 7, 1, 7])
	b.add_child(Kit.label(text + (" · take" if take else ""), {f = "cond", w = 700 if seat else 600, s = 13, ls = 0.08 if seat else 0.14, up = true, c = fg.get(state, Color.WHITE)}))
	b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return b

## Behind the loading screen: scenes of the air war (taken from the game itself) one after another,
## each slowly pushing in, cross-fading to the next.
func slides() -> void:
	var box: Control = el("slides")
	if box.get_child_count():
		return
	var imgs := []
	for i in LOADING_SHOTS.size():
		var r := TextureRect.new()
		r.texture = load("res://loading/%s.jpg" % LOADING_SHOTS[i])
		r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		r.anchor_left = -0.04
		r.anchor_top = -0.04
		r.anchor_right = 1.04
		r.anchor_bottom = 1.04
		r.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var m := ShaderMaterial.new()
		m.shader = FILTER
		m.set_shader_parameter("from_screen", false)
		for kv in [["sepia", 0.35], ["saturate", 0.85], ["brightness", 0.62], ["contrast", 1.12]]:
			m.set_shader_parameter(kv[0], kv[1])
		r.material = m
		r.modulate.a = 1.0 if i == 0 else 0.0
		box.add_child(r)
		imgs.append(r)
	var dark := _filter_rect({from_screen = false, tex_alpha = 0.0, rad_in = Color("#0503024d"), rad_mid = Color("#050302cc"), rad_out = Color("#050302f2"), rad_midpoint = 0.7, rad_r = Vector2(0.7, 0.6), rad_at = Vector2(0.5, 0.45)})
	box.add_child(dark)
	var st := {k = 0, t = 0.0}
	var push := func(r: TextureRect): # (pushing in: scale 1 -> 1.08 over 7 s)
		r.pivot_offset = r.size / 2
		r.scale = Vector2.ONE
		var tw := create_tween()
		tw.tween_property(r, "scale", Vector2(1.08, 1.08), 7.0)
	box.resized.connect(func(): push.call(imgs[st.k]), CONNECT_ONE_SHOT)
	_every_frame(func(dt: float) -> bool:
		if not box.visible or _menu_kind != "loading":
			return false
		st.t += dt
		if st.t >= 4.2:
			st.t = 0.0
			_tween(imgs[st.k], "modulate:a", 0.0, 1.6)
			st.k = (st.k + 1) % imgs.size()
			_tween(imgs[st.k], "modulate:a", 1.0, 1.6)
			push.call(imgs[st.k])
		return true)

func play() -> void:
	loading_done = true
	close_drawer()
	if _typing_tween:
		_typing_tween.kill()
	el("menu").visible = false
	el("map").visible = false
	el("hud").visible = true
	var f := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	if f:
		f.release_focus() # (so Space in the game doesn't press a hidden button)

## Ammo, heat and reload timer for the gun the player is on (null hides it).
func gun(s) -> void:
	_show("gun", s != null)
	if s == null:
		return
	var key := str([s.ammo, s.max, snappedf(s.heat, 0.01), s.jammed, s.reloading, snappedf(s.reloadLeft, 0.1)])
	if key == _last.get("gun"):
		return
	_last.gun = key
	var ammo: Container = el("gun-ammo")
	_clear(ammo)
	var row := Kit.hbox(0, BoxContainer.ALIGNMENT_END)
	var big := Kit.label(str(int(s.ammo)), {f = "mono", w = 600, s = 30, c = C.hud, sh = true})
	var rest := Kit.label(" / %d" % int(s.max), {f = "mono", w = 600, s = 15, c = Color("#ece8dcbb"), sh = true})
	rest.size_flags_vertical = Control.SIZE_SHRINK_END
	row.add_child(big)
	row.add_child(rest)
	ammo.add_child(row)
	var heat: Control = el("gun-heat")
	heat.set_meta("v", s.heat)
	heat.set_meta("c", Color("#ff4a3a") if s.jammed else Color("#ffa23a") if s.heat > 0.7 else Color("#d9d2b8"))
	heat.queue_redraw()
	var state: Label = el("gun-state")
	if s.reloading:
		state.text = "Reloading… %.1f s" % s.reloadLeft
	elif s.jammed:
		state.text = "Overheated, let the barrels cool"
	elif s.ammo == 0:
		state.text = "Out of ammo"
	else:
		state.text = "Low ammo: R to reload" if s.ammo < s.max * 0.2 else ""
	var warn: bool = s.reloading or s.jammed or s.ammo < s.max * 0.2
	state.label_settings = Kit.settings({f = "ui", w = 500, s = 15, c = Color("#ffb36a") if warn else C.hud, sh = true})
	var rl: Control = el("gun-reload")
	rl.visible = s.reloading
	rl.set_meta("v", 1 - s.reloadLeft / s.reloadTime)
	rl.queue_redraw()

# ======================================================================================================
# the seat screen (#map): you were killed / bailed out: the formation plot, the roster, the fighters

func _build_map() -> void:
	var box := _layer("map")
	box.mouse_filter = Control.MOUSE_FILTER_STOP
	box.visible = false
	root.add_child(box)
	_e.map = box
	box.add_child(_filter_rect({sepia = 0.5, saturate = 0.65, brightness = 0.72, contrast = 1.06,
		rad_in = Color("#18140c26"), rad_mid = Color("#0b0906a8"), rad_out = Color("#050403ee"), rad_midpoint = 0.58, rad_r = Vector2(1.2, 0.95), rad_at = Vector2(0.5, 0.42), grain = 0.16}))
	var frame_line := _canvas(func(c: Control): c.draw_rect(Rect2(12.5, 12.5, c.size.x - 25, c.size.y - 25), Color("#c9a55a22"), false, 1.0))
	frame_line.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.add_child(frame_line)
	var frame := MarginContainer.new()
	frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for s in [["top", 20], ["right", 34], ["bottom", 22], ["left", 34]]:
		frame.add_theme_constant_override("margin_" + s[0], s[1])
	box.add_child(frame)
	var col := Kit.vbox(10)
	frame.add_child(col)
	var top = Kit.hbox(16)
	top.custom_minimum_size.y = 40
	top.add_child(_brand("Formation plot"))
	var sp := Kit.gap()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp)
	top.add_child(Kit.label("The battle holds while you choose", {f = "ui", w = 500, s = 14, ls = 0.02, c = C.cream_dim}))
	col.add_child(top)
	# the head: back (only when you came here by choice), the title, what to do
	var head := Control.new()
	head.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var hc = Kit.vbox(0, BoxContainer.ALIGNMENT_CENTER)
	hc.set_anchors_preset(Control.PRESET_FULL_RECT)
	hc.add_child(_kicker("Pick your seat", C.brass))
	var h1 := Kit.label("", {f = "display", w = 400, s = 66, ls = 0.06, c = C.cream, lh = 0.95, align = HORIZONTAL_ALIGNMENT_CENTER})
	hc.add_child(h1)
	var p := Kit.label("", {f = "ui", w = 500, s = 16, c = Color("#e8e0cb"), align = HORIZONTAL_ALIGNMENT_CENTER})
	hc.add_child(Kit.gap(0, 4))
	hc.add_child(p)
	head.add_child(hc)
	head.custom_minimum_size.y = 20 + 66 * 0.95 + 28
	_e["map-title"] = h1
	_e["map-text"] = p
	var back := _btn("← Back", "ghost", false, true)
	back.get_child(1).add_child(Kit.keycap("Esc"))
	var back_row := Kit.hbox(10)
	back.remove_child(back.get_meta("label"))
	back_row.add_child(back.get_meta("label"))
	var esc := Kit.keycap("Esc", "kbd", 11)
	esc.modulate.a = 0.8
	back_row.add_child(esc)
	back.add_child(back_row)
	Kit.pin(back, 0, 0.5, 0, 0.5)
	head.add_child(back)
	_e["map-back"] = back
	col.add_child(head)
	# the grid: the record and how, the plot, the roster and the fighters
	var grid := Kit.hbox(22)
	grid.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(grid)
	var left := Kit.vbox(14)
	left.custom_minimum_size.x = 330
	var rec := Kit.vbox(0)
	left.add_child(rec)
	_e["map-record"] = rec
	var how := Kit.box({bg = Color("#0d0f0a8c"), border = [3, 0, 0, 0], border_color = C.brass}, [12, 14, 12, 14])
	var hv := Kit.vbox(0)
	for r in [["Pan", "drag the map"], ["Zoom", "mouse wheel · <kbd>+</kbd> <kbd>−</kbd>"], ["Whole formation", "<kbd>0</kbd> or Fit all"], ["Pick", "click a bomber, then a man"]]:
		var row := Kit.hbox(8)
		row.custom_minimum_size.y = 27
		row.add_child(Kit.label(r[0], {f = "ui", w = 500, s = 15, c = Color("#e6dfcc")}))
		var fl := Kit.flow(r[1], {f = "ui", w = 500, s = 15, c = Color("#e6dfcc"), cap_gap = 4.0}, "kbd", {}, FlowContainer.ALIGNMENT_END)
		fl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(fl)
		hv.add_child(row)
	how.add_child(hv)
	left.add_child(how)
	grid.add_child(left)
	var wrap := Control.new()
	wrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wrap.clip_contents = true
	wrap.mouse_filter = Control.MOUSE_FILTER_PASS
	grid.add_child(wrap)
	_e["map-wrap"] = wrap
	var plot := Plot.new(self)
	plot.set_anchors_preset(Control.PRESET_FULL_RECT)
	wrap.add_child(plot)
	_e["map-canvas"] = plot
	var tools := Kit.hbox(6)
	Kit.pin(tools, 1, 0, 1, 0, Vector2(-12, 20))
	for z in [["in", "+", true], ["out", "−", true], ["fit", "Fit all", false], ["me", "Where I was", false]]:
		var b := Kit.box({bg = Color("#efe6ccee"), border = [1, 1, 1, 1], border_color = Color("#261f15aa"), radius = 3.0, shadow = [2, 6, Color("#00000033")]}, [0, 10, 0, 10] if not z[2] else 0.0, true)
		b.hover_look = {bg = Color("#fff8e4")}
		b.min_w = 34
		b.min_h = 32
		var l := Kit.label(z[1], {f = "cond", w = 600, s = 18 if z[2] else 13, ls = 0.0 if z[2] else 0.12, up = true, c = C.ink, align = HORIZONTAL_ALIGNMENT_CENTER})
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		b.add_child(l)
		var id: String = z[0]
		b.pressed.connect(func(): plot.tool(id))
		tools.add_child(b)
	wrap.add_child(tools)
	var legend := Kit.box({bg = Color("#efe6ccee"), border = [1, 1, 1, 1], border_color = Color("#261f1566"), shadow = [2, 6, Color("#00000033")]}, [6, 10, 6, 10])
	var lf := HFlowContainer.new()
	lf.add_theme_constant_override("h_separation", 12)
	lf.add_theme_constant_override("v_separation", 4)
	lf.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for it in [[C.fit, "Fit"], [C.dmg, "Damaged"], [C.fire, "Burning"], [Color("#8a8273"), "No one left"], [null, "Where you were"], [false, "Paler = lower in the stack"]]:
		var row := Kit.hbox(5)
		if it[0] is Color or it[0] == null:
			var dc = it[0]
			row.add_child(_canvas(func(c: Control):
				var m := Vector2(4.5, c.size.y / 2)
				if dc == null:
					_dashed_circle(c, m, 4.5, C.ink, 1.5, 2.0)
				else:
					c.draw_circle(m, 4.5, dc), 9, 9))
			row.get_child(0).size_flags_vertical = Control.SIZE_FILL
		row.add_child(Kit.label(it[1], {f = "type", w = 400, s = 12.5, c = C.ink}))
		lf.add_child(row)
	legend.add_child(lf)
	Kit.pin(legend, 0, 1, 0, 1, Vector2(12, -12))
	wrap.add_child(legend)
	wrap.resized.connect(func(): legend.custom_minimum_size.x = 0; legend.size.x = minf(legend.get_combined_minimum_size().x, wrap.size.x - 210))
	var tip := Kit.box({bg = C.paper, grain = 0.07, ring = [1.0, Color("#261f1580")], shadow = [8, 22, Color("#00000077")]}, [8, 11, 8, 11])
	tip.visible = false
	tip.custom_minimum_size.x = 190
	wrap.add_child(tip)
	_e["map-tip"] = tip
	var right = Kit.vbox(14)
	right.custom_minimum_size.x = 360
	var roster := Kit.box({bg = C.paper, grain = 0.07, vignette = Color("#9a7c4433"), ring = [1.0, Color("#00000055")], shadow = [14, 36, Color("#000000bb")]}, [14, 14, 10, 14])
	roster.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var side := Kit.vbox(0)
	roster.add_child(side)
	_e["map-side"] = side
	right.add_child(roster)
	var ff := Kit.vbox(6)
	ff.add_child(Kit.label("Or fly a fighter", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.brass}))
	var mr := GridContainer.new()
	mr.columns = 3
	mr.add_theme_constant_override("h_separation", 8)
	ff.add_child(mr)
	_e["map-roles"] = mr
	_e["fly-fighter"] = ff
	right.add_child(ff)
	grid.add_child(right)

static func _dashed_circle(c: CanvasItem, at: Vector2, r: float, col: Color, w: float, dash: float) -> void:
	var n := maxi(6, int(TAU * r / (dash * 2)))
	for i in n:
		var a0 := TAU * i / n
		c.draw_arc(at, r, a0, a0 + TAU / n / 2, 4, col, w, true)

## Text on a canvas as the 2D canvas puts it: align left / center / right, baseline alphabetic / top / middle / bottom.
static func _txt(c: CanvasItem, font: Font, size: int, t: String, x: float, y: float, col: Color, align := "left", base := "alphabetic") -> void:
	var asc := font.get_ascent(size)
	var desc := font.get_descent(size)
	match base:
		"top": y += asc
		"middle": y += (asc - desc) / 2
		"bottom": y -= desc
	if align != "left":
		var w := font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		x -= w / 2 if align == "center" else w
	c.draw_string(font, Vector2(x, y), t, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)

## The formation map: pick any surviving bomber, then any fit AI crewman to take over. A briefing-room plot
## on paper. It opens centred on where you were, zoomed out far enough to take in every bomber; drag pans,
## the wheel zooms on the cursor, and the view can't wander off the formation. Hovering a bomber says how
## she stands. crew_of(bomber) -> Crew. on_pick(bomber, member) is called with the choice; record: the
## service record of the life just ended (life_card).
func map(o: Dictionary) -> void:
	var box: Control = el("map")
	el("map-title").text = o.get("title", "")
	el("map-text").text = o.get("text", "")
	var rec: Control = el("map-record")
	_clear(rec)
	var record = o.get("record", "")
	if record is Dictionary and record:
		rec.add_child(_record(record, "seat"))
	var back: Container = el("map-back") # (only when you came here by choice: there's somewhere to go back to)
	var on_back = o.get("on_back", null)
	back.visible = on_back != null
	for c in back.pressed.get_connections():
		back.pressed.disconnect(c.callable)
	if on_back:
		back.pressed.connect(func(): box.visible = false; on_back.call())
	el("menu").visible = false
	el("hud").visible = false
	box.visible = true
	var on_role = o.get("on_role", null)
	roles("map-roles", (func(id): box.visible = false; on_role.call(id)) if on_role else null, ["bf109", "fw190", "p47"])
	el("fly-fighter").visible = on_role != null
	var plot: Plot = el("map-canvas")
	plot.open(o.bombers, o.crew_of, o.mine, o.on_pick)
	map_key = plot.key
	map_resize = plot.fit_size

## How a bomber stands, beside the cursor (the plot's tooltip).
func _map_tip(b, n: int, live: bool, height: String, mx: float, my: float, W: float, H: float) -> void:
	var tip: Container = el("map-tip")
	if b == null:
		tip.visible = false
		return
	_clear(tip)
	var v := Kit.vbox(0)
	v.add_child(Kit.label(b.label if b.label else "B-17", {f = "cond", w = 700, s = 17, ls = 0.03, c = C.ink}))
	var st := {f = "ui", w = 500, s = 15, c = C.ink, lh = 1.45}
	var running := 4 - int(b.dead_engines)
	var line := func(k: String, t: String, hot: String):
		var r := Kit.hbox(0)
		r.add_child(Kit.label(k + " ", {f = "ui", w = 500, s = 15, c = C.ink2, lh = 1.45}))
		r.add_child(Kit.label(t, st))
		if hot:
			r.add_child(Kit.label(hot, {f = "ui", w = 600, s = 15, c = C.fire, lh = 1.45}))
		v.add_child(r)
	line.call("Engines", "%d of 4 running%s" % [running, " · " if b.burning else ""], "on fire" if b.burning else "")
	line.call("Airframe", "%d%%" % roundi(b.health * 100), "")
	line.call("Crew", "%d of 10 fit" % n, "")
	line.call("Height", height, "")
	v.add_child(Kit.label("Click: her crew · double-click: board her" if live else "No one left to take over", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.fit if live else C.fire, wrap = true}))
	tip.add_child(v)
	tip.visible = true
	tip.reset_size()
	var sz = tip.get_combined_minimum_size()
	sz.x = clampf(sz.x, 190, 260)
	tip.size = sz
	var x := mx + 18 # beside the cursor, inside the map
	var y := my + 16
	if x + sz.x > W - 8:
		x = mx - sz.x - 18
	if y + sz.y > H - 8:
		y = my - sz.y - 16
	tip.position = Vector2(maxf(8, x), maxf(8, y))

const STATUS := {ok = "Fit", wounded = "Wounded", dead = "KIA", bailed = "Bailed out", player = "You"}
## The crew roster for the bomber you picked.
func _map_side(b, crew, on_pick: Callable) -> void:
	var side: Control = el("map-side")
	_clear(side)
	var label: String = b.label if b.label else "B-17"
	var grp := RegEx.create_from_string(", \\w+ squadron$").sub(label, "")
	var sqm := RegEx.create_from_string("(\\w+ squadron)$").search(label)
	side.add_child(Kit.label(sqm.get_string(1) if sqm else "", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.ink2}))
	side.add_child(Kit.label(grp, {f = "display", w = 400, s = 21, ls = 0.04, up = true, c = C.ink, lh = 1.1}))
	var state := HFlowContainer.new()
	state.add_theme_constant_override("h_separation", 12)
	state.add_theme_constant_override("v_separation", 4)
	var fit := 0
	for m in crew.members:
		if m.state == "ok":
			fit += 1
	var sst := {f = "ui", w = 500, s = 14, c = C.ink2}
	state.add_child(Kit.label("%d of 4 engines" % (4 - int(b.dead_engines)), sst))
	state.add_child(Kit.label("Airframe %d%%" % roundi(b.health * 100), sst))
	if b.burning:
		state.add_child(Kit.label("On fire", {f = "ui", w = 500, s = 14, c = C.fire}))
	state.add_child(Kit.label("%d of 10 fit" % fit, sst))
	side.add_child(Kit.gap(0, 6))
	side.add_child(state)
	side.add_child(Kit.gap(0, 8))
	side.add_child(Kit.rule(C.ink, 2))
	var rows := Kit.vbox(0)
	for i in crew.members.size():
		var m = crew.members[i]
		var rank: String = m.role.rank
		var nm: String = m.name.substr(rank.length()).strip_edges() if m.name.begins_with(rank) else m.name
		var can: bool = m.state == "ok" or m.state == "player"
		var row := Kit.box({}, [5, 6, 5, 6], can)
		if can:
			row.hover_look = {bg = Color("#4b55302e")}
			row.focus_ring = C.brass2
			row.pressed.connect(func(): el("map").visible = false; on_pick.call(b, m))
		var h := Kit.hbox(8)
		var rk := Kit.label(rank, {f = "cond", w = 600, s = 13, ls = 0.08, c = C.ink2})
		rk.custom_minimum_size.x = 54
		h.add_child(rk)
		var who := Kit.vbox(0)
		who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		who.add_child(Kit.label(nm, {f = "ui", w = 600, s = 17, c = C.ink, lh = 1.15}))
		who.add_child(Kit.label(m.role.title, {f = "ui", w = 500, s = 14, c = C.ink2, lh = 1.15}))
		if not can:
			rk.modulate.a = 0.55
			who.modulate.a = 0.55
		h.add_child(who)
		h.add_child(_chip(STATUS.get(m.state, m.state), m.state, false, can and m.state == "ok"))
		row.add_child(h)
		row.add_child(_dotted_bottom())
		rows.add_child(row)
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(rows)
	side.add_child(sc)
	side.size_flags_vertical = Control.SIZE_EXPAND_FILL

static func _dotted_bottom(col := Color("#261f1566")) -> Control:
	var c := _canvas(func(c: Control):
		var x := 0.0
		while x < c.size.x:
			c.draw_rect(Rect2(x, c.size.y - 1, 1, 1), col)
			x += 3.0)
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	return c

## The plot itself: map()'s canvas, its view and its pointer (the JS's closures over one map() call).
class Plot extends Control:
	const INK := Color("#261f15")
	const FIT := Color("#3f7d2a")
	const DMG := Color("#c08a00")
	const FIRE := Color("#c0281c")
	const SPENT := Color("#8a8273")
	const RED := Color("#b8352a")
	const GUNS := ["tail", "top", "ball", "waistL", "waistR", "radio", "cheekL", "cheekR", "noseL", "noseR"]
	var ui
	var bombers: Array = []
	var shown: Array = []
	var live := {}
	var groups := {}
	var crew_of: Callable
	var on_pick: Callable
	var mine
	var x0 := 0.0
	var x1 := 0.0
	var z0 := 0.0
	var z1 := 0.0
	var y0 := 0.0
	var y1 := 0.0
	var W := 0.0
	var H := 0.0
	var s_min := 0.01
	var s_max := 2.0
	var view := {s = 1.0, cx = 0.0, cz = 0.0}
	var PAD := 60.0
	var hover = null
	var selected = null
	var drag = null
	var paper: ImageTexture
	var stain: ImageTexture
	var stain_size := Vector2.ZERO

	func _init(u) -> void:
		ui = u
		mouse_filter = MOUSE_FILTER_STOP
		clip_contents = true
		resized.connect(func(): if is_visible_in_tree() and fit_size(): clamp_view(); queue_redraw())
		mouse_exited.connect(func(): if drag == null and hover != null: hover = null; ui._map_tip(null, 0, false, "", 0, 0, W, H); queue_redraw())

	func fit_crew(b) -> int:
		var n := 0
		for m in crew_of.call(b).members:
			if m.state == "ok":
				n += 1
		return n

	func open(list: Array, crew: Callable, me, pick: Callable) -> void:
		bombers = list
		crew_of = crew
		mine = me
		on_pick = pick
		shown = list.filter(func(b): return not b.gone)
		live = {}
		for b in shown:
			if not b.down and fit_crew(b) > 0:
				live[b] = true
		# the world stands still while you choose: the formation's extent is fixed
		x0 = INF; x1 = -INF; z0 = INF; z1 = -INF; y0 = INF; y1 = -INF
		for b in shown:
			x0 = minf(x0, b.base.x); x1 = maxf(x1, b.base.x)
			z0 = minf(z0, b.base.z); z1 = maxf(z1, b.base.z)
			y0 = minf(y0, b.base.y); y1 = maxf(y1, b.base.y)
		# the 18-ship groups, boxed and named on the plot
		groups = {}
		for b in shown:
			if not b.down:
				if not groups.has(b.squad):
					groups[b.squad] = []
				groups[b.squad].append(b)
		view = {s = 1.0, cx = mine.base.x, cz = mine.base.z}
		if not paper:
			paper = ui.paper_tex if ui.paper_tex else ui.paper_texture()
			ui.paper_tex = paper
		hover = null
		drag = null
		ui._map_tip(null, 0, false, "", 0, 0, W, H)
		await get_tree().process_frame # (laid out first: the plot's size)
		if fit_size():
			view.merge(around_me(), true)
		clamp_view()
		# start with the nearest fit bomber picked
		var near = null
		for b in live:
			if near == null or b.base.distance_to(mine.base) < near.base.distance_to(mine.base):
				near = b
		if near:
			select(near)
		else:
			queue_redraw()
			var side: Control = ui.el("map-side")
			ui._clear(side)
			side.add_child(Kit.label("No one left", {f = "display", w = 400, s = 21, ls = 0.04, up = true, c = INK}))
			side.add_child(Kit.label("No bomber has a fit man left to take over.", {f = "ui", w = 500, s = 15, c = Color("#3d3222"), wrap = true}))

	func fit_all() -> Dictionary:
		return {s = minf((W - 2 * PAD) / maxf(300, x1 - x0), (H - 2 * PAD) / maxf(300, z1 - z0)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2}

	func around_me() -> Dictionary: # centred on where you were, out just far enough to take in every bomber
		var dx := 150.0
		var dz := 150.0
		for b in shown:
			dx = maxf(dx, absf(b.base.x - mine.base.x))
			dz = maxf(dz, absf(b.base.z - mine.base.z))
		return {s = minf((W / 2 - PAD) / dx, (H / 2 - PAD) / dz), cx = mine.base.x, cz = mine.base.z}

	func clamp_view() -> void:
		view.s = clampf(view.s, s_min, s_max)
		view.cx = clampf(view.cx, x0, x1) # (the middle of the map never leaves the formation)
		view.cz = clampf(view.cz, z0, z1)

	func set_view(v: Dictionary) -> void:
		view.merge(v, true)
		clamp_view()
		queue_redraw()

	func fit_size() -> bool:
		if size.x <= 0 or size.y <= 0 or shown.is_empty():
			return false
		W = size.x
		H = size.y
		var a: float = fit_all().s
		var m: float = around_me().s
		s_min = minf(a, m) * 0.75
		s_max = maxf(a * 40, 1.2)
		return true

	func px(b) -> Vector2:
		return Vector2(W / 2 + (b.base.x - view.cx) * view.s, H / 2 + (b.base.z - view.cz) * view.s)

	func radius() -> float: # a bomber's mark, never too small to hit
		return clampf(view.s * 15, 3.4, 13)

	func zoom_at(mx: float, my: float, k: float) -> void:
		var wx: float = view.cx + (mx - W / 2) / view.s
		var wz: float = view.cz + (my - H / 2) / view.s
		view.s = clampf(view.s * k, s_min, s_max)
		view.cx = wx - (mx - W / 2) / view.s
		view.cz = wz - (my - H / 2) / view.s
		clamp_view()
		queue_redraw()

	func hit(mx: float, my: float):
		var best = null
		var bd := maxf(14, radius() + 6)
		for b in shown:
			if b.down:
				continue
			var d := px(b).distance_to(Vector2(mx, my))
			if d < bd or (d == bd and live.has(b)):
				bd = d
				best = b
		return best

	func tool(id: String) -> void:
		match id:
			"in": zoom_at(W / 2, H / 2, 1.4)
			"out": zoom_at(W / 2, H / 2, 1 / 1.4)
			"fit": set_view(fit_all())
			"me": set_view({cx = mine.base.x, cz = mine.base.z})

	func key(e: InputEventKey) -> bool:
		var pan := {KEY_LEFT: Vector2(-1, 0), KEY_RIGHT: Vector2(1, 0), KEY_UP: Vector2(0, -1), KEY_DOWN: Vector2(0, 1)}
		if pan.has(e.keycode):
			view.cx += pan[e.keycode].x * 90 / view.s
			view.cz += pan[e.keycode].y * 90 / view.s
			clamp_view()
			queue_redraw()
			return true
		if e.keycode == KEY_EQUAL or e.keycode == KEY_KP_ADD:
			zoom_at(W / 2, H / 2, 1.4)
			return true
		if e.keycode == KEY_MINUS or e.keycode == KEY_KP_SUBTRACT:
			zoom_at(W / 2, H / 2, 1 / 1.4)
			return true
		if e.keycode == KEY_0 or e.keycode == KEY_KP_0:
			set_view(fit_all())
			return true
		return false

	func height_word(b) -> String:
		var ft := roundi(((b.base.y - mine.base.y) * 3.281) / 50) * 50
		return "level with where you were" if ft == 0 else "%s ft %s where you were" % [Kit.num(absi(ft)), "above" if ft > 0 else "below"]

	func set_tip(b, mx := 0.0, my := 0.0) -> void:
		ui._map_tip(b, fit_crew(b) if b else 0, live.has(b) if b else false, height_word(b) if b else "", mx, my, W, H)

	func select(b) -> void:
		selected = b
		queue_redraw()
		ui._map_side(b, crew_of.call(b), func(bb, m): on_pick.call(bb, m))

	# straight aboard: as one of her gunners if one's fit, or whoever is
	func board(b) -> void:
		var fit: Array = crew_of.call(b).members.filter(func(x): return x.state == "ok")
		var m = null
		for id in GUNS:
			for x in fit:
				if x.role.station == id:
					m = x
					break
			if m:
				break
		if m == null and fit.size():
			m = fit[0]
		if m == null:
			return
		ui.el("map").visible = false
		on_pick.call(b, m)

	func _gui_input(e: InputEvent) -> void:
		if e is InputEventMouseButton:
			if e.button_index == MOUSE_BUTTON_WHEEL_UP or e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				if e.pressed:
					zoom_at(e.position.x, e.position.y, 1.25 if e.button_index == MOUSE_BUTTON_WHEEL_UP else 0.8)
				accept_event()
			elif e.button_index == MOUSE_BUTTON_LEFT:
				if e.pressed and e.double_click:
					var h = hit(e.position.x, e.position.y)
					if h != null and live.has(h):
						board(h)
				elif e.pressed:
					drag = {x = e.position.x, y = e.position.y, cx = view.cx, cz = view.cz, moved = false}
				else:
					if drag and not drag.moved:
						var h = hit(e.position.x, e.position.y)
						if h != null and live.has(h):
							select(h)
					drag = null
					mouse_default_cursor_shape = CURSOR_ARROW
				accept_event()
		elif e is InputEventMouseMotion:
			var mx: float = e.position.x
			var my: float = e.position.y
			if drag:
				var dx: float = mx - drag.x
				var dy: float = my - drag.y
				if not drag.moved and Vector2(dx, dy).length() > 4:
					drag.moved = true
					mouse_default_cursor_shape = CURSOR_DRAG
					set_tip(null)
				if drag.moved:
					view.cx = drag.cx - dx / view.s
					view.cz = drag.cz - dy / view.s
					clamp_view()
					queue_redraw()
				return
			var h = hit(mx, my)
			if h != hover:
				hover = h
				queue_redraw()
			set_tip(h, mx, my)
			mouse_default_cursor_shape = CURSOR_POINTING_HAND if h != null and live.has(h) else CURSOR_ARROW

	static func nice(want: float) -> float:
		for n in [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]:
			if n >= want:
				return n
		return 20000

	func plane(x: float, y: float, r: float) -> PackedVector2Array: # a bomber in plan view, nose up
		var P := [[0, -1], [0.12, -0.72], [0.12, -0.3], [1, -0.08], [1, 0.06], [0.12, 0.12], [0.09, 0.66], [0.42, 0.76], [0.42, 0.88], [0, 0.92]]
		var pts := PackedVector2Array()
		for p in P:
			pts.append(Vector2(x + p[0] * r, y + p[1] * r))
		for i in range(P.size() - 1, -1, -1):
			pts.append(Vector2(x - P[i][0] * r, y + P[i][1] * r))
		return pts

	func ring(b, r: float, col: Color, w: float, dash := false) -> void:
		var p := px(b)
		if dash:
			ui._dashed_circle(self, p, r, col, w, 3.0)
		else:
			draw_arc(p, r, 0, TAU, 48, col, w, true)

	func _draw() -> void:
		if W <= 0:
			return
		draw_texture_rect(paper, Rect2(0, 0, W, H), true)
		if stain_size != Vector2(W, H): # the coffee-brown darkening towards the edges (made once per size)
			stain_size = Vector2(W, H)
			var img := Image.create(int(W / 4) + 1, int(H / 4) + 1, false, Image.FORMAT_RGBA8)
			var c0 := Vector2(W * 0.5, H * 0.45)
			var c1 := Vector2(W * 0.5, H * 0.5)
			var r0 := minf(W, H) * 0.2
			var r1 := maxf(W, H) * 0.75
			for y in img.get_height():
				for x in img.get_width():
					var p := Vector2(x * 4, y * 4)
					var t := clampf((p.distance_to(c0.lerp(c1, 0.5)) - r0) / (r1 - r0), 0, 1)
					img.set_pixel(x, y, Color(0.478, 0.353, 0.165, 0.302 * t))
			stain = ImageTexture.create_from_image(img)
		draw_texture_rect(stain, Rect2(0, 0, W, H), false)
		# the grid, lettered across and numbered down like a briefing map
		var step := nice(80 / view.s)
		var wx0: float = view.cx - W / 2 / view.s
		var wz0: float = view.cz - H / 2 / view.s
		var f13: Font = Kit.font("cond", 600)
		var k := floorf(wx0 / step) * step
		while k < wx0 + W / view.s:
			var x := roundf(W / 2 + (k - view.cx) * view.s) + 0.5
			var n := roundi(k / step)
			draw_line(Vector2(x, 0), Vector2(x, H), Color("#8f774b38") if n % 5 else Color("#8f774b70"), 1.0)
			if x > 260 and x < W - 300:
				ui._txt(self, f13, 13, String.chr(65 + posmod(n, 26)), x + 4, 14, Color("#5d4f39aa"), "left", "top")
			k += step
		k = floorf(wz0 / step) * step
		while k < wz0 + H / view.s:
			var y := roundf(H / 2 + (k - view.cz) * view.s) + 0.5
			var n := roundi(k / step)
			draw_line(Vector2(0, y), Vector2(W, y), Color("#8f774b38") if n % 5 else Color("#8f774b70"), 1.0)
			if y > 70 and y < H - 60:
				ui._txt(self, f13, 13, "%02d" % posmod(n, 100), W - 30, y + 3, Color("#5d4f39aa"), "left", "top")
			k += step
		# the combat boxes: each group dashed round and named, once there's room
		for list in groups.values():
			var a := INF
			var b := INF
			var c := -INF
			var d := -INF
			for m in list:
				var p := px(m)
				a = minf(a, p.x); b = minf(b, p.y); c = maxf(c, p.x); d = maxf(d, p.y)
			var r := radius() + 8
			if c - a < 40 or c < -r or a > W + r or d < -r or b > H + r:
				continue
			var rc := Rect2(a - r, b - r, c - a + 2 * r, d - b + 2 * r)
			var col := Color("#261f1566")
			for e in [[rc.position, Vector2(rc.end.x, rc.position.y)], [Vector2(rc.end.x, rc.position.y), rc.end], [rc.end, Vector2(rc.position.x, rc.end.y)], [Vector2(rc.position.x, rc.end.y), rc.position]]:
				draw_dashed_line(e[0], e[1], col, 1.0, 4.5)
			ui._txt(self, f13, 13, RegEx.create_from_string(", \\w+ squadron$").sub(list[0].label, "").to_upper(), a - r, b - r - 3, Color("#261f15b0"), "left", "bottom")
		# the bombers: shot down ones crossed out, the rest by state; paler is lower in the stack
		var r0 := radius()
		for bm in shown:
			var p := px(bm)
			if p.x < -20 or p.y < -20 or p.x > W + 20 or p.y > H + 20:
				continue
			if bm.down:
				var kk := minf(5, r0 * 0.6)
				draw_line(p - Vector2(kk, kk), p + Vector2(kk, kk), Color("#261f1566"), 1.5, true)
				draw_line(p + Vector2(kk, -kk), p + Vector2(-kk, kk), Color("#261f1566"), 1.5, true)
				continue
			var up: float = (bm.base.y - y0) / maxf(1, y1 - y0)
			var alpha := 0.5 + up * 0.5
			var fill: Color = SPENT if not live.has(bm) else FIRE if bm.burning else DMG if bm.dead_engines or bm.damaged else FIT
			fill.a = alpha
			var ink := Color(INK, alpha)
			if r0 >= 6:
				var pts := plane(p.x, p.y, r0)
				draw_colored_polygon(pts, fill)
				pts.append(pts[0])
				draw_polyline(pts, ink, 0.8, true)
			else:
				draw_circle(p, r0, fill)
				draw_arc(p, r0, 0, TAU, 24, ink, 0.8, true)
		# where you were (an inked ring), the bomber you picked (a grease-pencil circle), the one under the cursor
		if hover != null and hover != selected:
			ring(hover, r0 + 7, Color("#9a7426"), 2)
		if selected != null:
			ring(selected, r0 + 9, RED, 2.6)
			ring(selected, r0 + 12, Color("#b8352a66"), 1.2)
		if not mine.gone:
			ring(mine, r0 + 6, INK, 1.6, true)
			var p := px(mine)
			ui._txt(self, Kit.font("cond", 700), 14, "YOU WERE HERE", p.x + r0 + 12, p.y - r0 - 8, INK, "left", "middle")
		# the heading marker, the title, the scale and the frame
		var hx := 40.0
		var hy := 44.0
		draw_arc(Vector2(hx, hy), 20, 0, TAU, 48, INK, 1.2, true)
		for i in 4:
			var a := (i * PI) / 2
			draw_line(Vector2(hx + sin(a) * 20, hy - cos(a) * 20), Vector2(hx + sin(a) * 25, hy - cos(a) * 25), INK, 1.2, true)
		draw_colored_polygon(PackedVector2Array([Vector2(hx, hy - 17), Vector2(hx + 6, hy + 4), Vector2(hx, hy)]), RED)
		draw_colored_polygon(PackedVector2Array([Vector2(hx, hy - 17), Vector2(hx - 6, hy + 4), Vector2(hx, hy)]), INK)
		ui._txt(self, Kit.font("cond", 700), 13, "HEADING", hx, hy + 34, INK, "center", "middle")
		ui._txt(self, Kit.font("type", 400), 20, "FORMATION PLOT", 78, 34, INK, "left", "middle")
		ui._txt(self, Kit.font("ui", 500), 15, "%d bombers with men to spare" % live.size(), 78, 56, Color("#3d3222"), "left", "middle")
		var L := nice(110 / view.s)
		var lw: float = L * view.s
		var sx := W - 22 - lw
		var sy := H - 26
		for i in 4:
			draw_rect(Rect2(sx + (i * lw) / 4, sy, lw / 4, 5), Color("#efe6cc") if i % 2 else INK)
		draw_rect(Rect2(sx + 0.5, sy + 0.5, lw, 5), INK, false, 1.0)
		ui._txt(self, Kit.font("cond", 700), 13, "0", sx, sy - 3, INK, "center", "bottom")
		ui._txt(self, Kit.font("cond", 700), 13, ("%s km" % str(L / 1000)) if L >= 1000 else "%d m" % L, sx + lw, sy - 3, INK, "right", "bottom")
		draw_rect(Rect2(5, 5, W - 10, H - 10), INK, false, 2.0)
		draw_rect(Rect2(9.5, 9.5, W - 19, H - 19), INK, false, 0.7)

# ======================================================================================================
# the HUD (#hud)

const _SH := {sh = true}
var _want := {} # what the code last asked of each mode-dependent piece (the stylesheet's mode rules can hide it)
const MODE_HIDES := {
	fighter = ["crew", "engines", "gun"],
	eject = ["crew", "engines", "gun", "flight", "health", "crosshair", "nose", "gunsight", "minimap"],
}

func _show(id: String, on: bool) -> void:
	_want[id] = on
	el(id).visible = on and not (id in MODE_HIDES.get(hud_mode, []))

func _apply_mode() -> void:
	for id in _want:
		el(id).visible = _want[id] and not (id in MODE_HIDES.get(hud_mode, []))
	# (in a fighter the damage diagram sits lower, with no gun panel under it; both marks the fighter's cross)
	Kit.pin(el("health"), 1, 1, 1, 1, Vector2(-18, -22 if hud_mode == "fighter" else -120))
	var cross: Control = el("crosshair")
	cross.set_meta("look", _CROSS.fighter if hud_mode == "fighter" else _CROSS.gun if cross.get_meta("gun", false) else _CROSS.plain)
	_size_cross(cross)

# every aim mark is a crosshair: a thin cross with a gap in the middle and a dot at its centre, outlined dark for bright sky
const _CROSS := {
	plain = {s = 18.0, g = 4.0, w = 2.0, d = 1.6, c = Color("#ffffffd0")},
	gun = {s = 30.0, g = 6.0, w = 2.0, d = 2.0, c = Color("#ffffffc0")},
	fighter = {s = 24.0, g = 5.0, w = 2.0, d = 2.0, c = Color("#ffffffd0")},
	nose = {s = 24.0, g = 5.0, w = 2.0, d = 1.6, c = Color("#b6ff9ad0")},
	gunsight = {s = 24.0, g = 5.0, w = 2.0, d = 2.0, c = Color("#ffb34ae0")},
}
func _cross(kind: String) -> Control:
	var c := _canvas(func(c: Control):
		var l: Dictionary = c.get_meta("look")
		var s: float = l.s
		var g: float = l.g
		var w: float = l.w
		var arms := [Rect2(s / 2 - w / 2, 0, w, s / 2 - g), Rect2(s / 2 - w / 2, s / 2 + g, w, s / 2 - g), Rect2(0, s / 2 - w / 2, s / 2 - g, w), Rect2(s / 2 + g, s / 2 - w / 2, s / 2 - g, w)]
		for a in arms: # (drop-shadow 0 0 1px #000c, twice)
			c.draw_rect(a.grow(1.0), Color(0, 0, 0, 0.45))
		c.draw_circle(Vector2(s, s) / 2, l.d + 1.0, Color(0, 0, 0, 0.45))
		for a in arms:
			c.draw_rect(a, l.c)
		c.draw_circle(Vector2(s, s) / 2, l.d, l.c))
	c.set_meta("look", _CROSS[kind])
	_size_cross(c)
	return c

func _size_cross(c: Control) -> void:
	var s: float = c.get_meta("look").s
	c.custom_minimum_size = Vector2(s, s)
	c.size = Vector2(s, s)
	c.queue_redraw()

func _build_hurt() -> void:
	# the 3D under the HUD, blurred and darkened while you're wounded (main.js filtered the canvas)
	var fx := _filter_rect({blur = 0.0})
	fx.visible = false
	root.add_child(fx)
	_e.hurt_fx = fx

func _hud_box(id: String, c: Control) -> Control:
	c.name = id
	_e[id] = c
	el("hud").add_child(c)
	return c

func _build_hud() -> void:
	var hud := _layer("hud")
	hud.visible = false
	root.add_child(hud)
	_e.hud = hud
	_e.fact_cond_ref = Control.new()
	var cross := _hud_box("crosshair", _cross("plain"))
	_at(cross, null)
	var loc := _hud_box("location", Kit.label("", {f = "cond", w = 700, s = 15, ls = 0.1, up = true, c = C.hud, sh = true}))
	Kit.pin(loc, 0, 0, 0, 0, Vector2(18, 14))
	loc.visible = false # (the crew list and the position's name at the top left: gone; the crew are on the pause menu's Change position)
	var prompt := _hud_box("prompt", Kit.vbox(0))
	Kit.pin(prompt, 0.5, 0.82, 0.5, 1.0)
	prompt.modulate.a = 0.0
	var warn := _hud_box("speedwarn", Kit.box({bg = Color("#2a1a0ccc"), border = [1, 1, 1, 1], border_color = Color("#ffb04a88"), radius = 4.0}, [6, 14, 6, 14]))
	Kit.pin(warn, 0.5, 0.74, 0.5, 1.0)
	warn.visible = false
	_every_frame(func(_dt): # (its border pulses)
		if warn.visible:
			var k := 0.5 - 0.5 * cos(Time.get_ticks_msec() / 1200.0 * TAU)
			warn.look.border_color = Color("#ffb04a88").lerp(Color("#ffb04aff"), k)
			warn.queue_redraw()
		return true)
	var ctl := _hud_box("controls", Kit.vbox(4))
	Kit.pin(ctl, 1, 0.36, 1, 0, Vector2(-18, 0))
	ctl.visible = false
	var fps := _hud_box("fps", Kit.label("", {f = "mono", w = 400, s = 12, c = Color("#b6ff9a"), sh = true}))
	Kit.pin(fps, 1, 0, 1, 0, Vector2(-12, 10))
	fps.visible = false
	var hint_b := _hud_box("hint", Kit.box({bg = Color("#0b0d10c8"), radius = 4.0}, [6, 12, 6, 12]))
	var hl := Kit.label("", {f = "ui", w = 500, s = 15, c = C.hud, align = HORIZONTAL_ALIGNMENT_CENTER})
	hint_b.add_child(hl)
	hint_b.set_meta("label", hl)
	Kit.pin(hint_b, 0.5, 0, 0.5, 0, Vector2(0, 124))
	hint_b.visible = false
	var tip_b := _hud_box("tip", Kit.box({bg = Color("#0b0d10d0"), border = [1, 1, 1, 1], border_color = Color("#ece8dc33"), radius = 6.0}, [9, 16, 9, 16]))
	Kit.pin(tip_b, 0.5, 0.75, 0.5, 1.0)
	tip_b.modulate.a = 0.0
	var lock_c := _hud_box("lock", _canvas(func(c: Control):
		var col := Color("#ff6b4a")
		var s := 54.0
		var a := s * 0.3
		for corner in [[Vector2(1, 1), Vector2(1, 0), Vector2(0, 1)], [Vector2(s - 1, 1), Vector2(-1, 0), Vector2(0, 1)], [Vector2(1, s - 1), Vector2(1, 0), Vector2(0, -1)], [Vector2(s - 1, s - 1), Vector2(-1, 0), Vector2(0, -1)]]:
			c.draw_line(corner[0], corner[0] + corner[1] * a, col, 2.0)
			c.draw_line(corner[0], corner[0] + corner[2] * a, col, 2.0), 54, 54))
	var ll := Kit.label("LOCKED", {f = "cond", w = 700, s = 12, ls = 0.12, c = Color("#ff8a6a"), sh = true})
	Kit.pin(ll, 0.5, 1, 0.5, 0, Vector2(0, 4))
	lock_c.add_child(ll)
	lock_c.set_meta("label", ll)
	lock_c.visible = false
	var hm := _hud_box("hitmarker", _canvas(func(c: Control):
		var kill: bool = c.get_meta("kill", false)
		var L := 26.0 if kill else 18.0
		var w := 5.0 if kill else 4.0
		var col := Color("#ff2a1a") if kill else Color("#ff3a2a")
		for i in 4:
			var a := deg_to_rad(45 + 90 * i)
			var d := Vector2(cos(a), sin(a))
			c.draw_line(d * (17 - L / 2), d * (17 + L / 2), Color(col, 0.35), w + (6 if kill else 3), true)
			c.draw_line(d * (17 - L / 2), d * (17 + L / 2), col, w, true)))
	Kit.pin(hm, 0.5, 0.5)
	hm.modulate.a = 0.0
	var mission_b := _hud_box("mission", Kit.box({grad = [[0.0, Color("#0b0c0800")], [0.15, Color("#0b0c08d0")], [0.85, Color("#0b0c08d0")], [1.0, Color("#0b0c0800")]], angle = 90.0}, [3, 16, 2, 16]))
	var ml := Kit.label("", {f = "cond", w = 600, s = 14, ls = 0.16, up = true, c = C.brass2, sh = true})
	mission_b.add_child(ml)
	mission_b.set_meta("label", ml)
	Kit.pin(mission_b, 0.5, 0, 0.5, 0, Vector2(0, 10))
	mission_b.visible = false
	var forces_b := _hud_box("forces", Kit.box({bg = Color("#0b0c08b8"), border = [1, 1, 1, 1], border_color = Color("#c9a55a40"), radius = 3.0, shadow = [4, 14, Color("#00000066")]}, [8, 14, 8, 12]))
	forces_b.min_w = 500
	Kit.pin(forces_b, 0.5, 0, 0.5, 0, Vector2(0, 32))
	forces_b.visible = false
	var sight_c := _hud_box("sight", _layer())
	sight_c.add_child(_canvas(func(c: Control):
		var v := minf(c.size.x, c.size.y) / 100.0 # vmin
		var m := c.size / 2
		var r := 34.0 * v
		var big := maxf(c.size.x, c.size.y)
		c.draw_arc(m, r + 0.3 * v + big / 2, 0, TAU, 128, Color.BLACK, big) # (black beyond the eyepiece's ring)
		var lc := Color("#1a1a1acc")
		c.draw_rect(Rect2(m.x - 34 * v, m.y, 34 * v - 1.2 * v, 1), lc)
		c.draw_rect(Rect2(m.x + 1.2 * v, m.y, 34 * v - 1.2 * v, 1), lc)
		c.draw_rect(Rect2(m.x, m.y - 34 * v, 1, 34 * v - 1.2 * v), lc)
		c.draw_rect(Rect2(m.x, m.y + 1.2 * v, 1, 34 * v - 1.2 * v), lc)
		c.draw_circle(m, 2, Color("#1a1a1a"))))
	sight_c.get_child(0).set_anchors_preset(Control.PRESET_FULL_RECT)
	var si := Kit.vbox(0)
	si.anchor_left = 0
	si.anchor_right = 1
	si.anchor_top = 0.94
	si.anchor_bottom = 0.94
	si.grow_vertical = Control.GROW_DIRECTION_BEGIN
	sight_c.add_child(si)
	_e["sight-info"] = si
	sight_c.visible = false
	var crew_b := _hud_box("crew", Kit.vbox(0))
	Kit.pin(crew_b, 0, 0, 0, 0, Vector2(18, 40))
	_want.crew = false
	crew_b.visible = false
	# you: a small figure, your health bar and where you're hurt
	var you := _hud_box("you", Kit.box({bg = Color("#0b0c08b0"), border = [1, 1, 1, 1], border_color = Color("#c9a55a40"), radius = 3.0}, [6, 10, 6, 10]))
	Kit.pin(you, 0, 0, 0, 0, Vector2(18, 16))
	var yr := Kit.hbox(10)
	var body := TextureRect.new()
	body.custom_minimum_size = Vector2(36, 72)
	body.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	body.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	yr.add_child(body)
	_e["you-body"] = body
	var yc := Kit.vbox(6, BoxContainer.ALIGNMENT_CENTER)
	var row := Kit.hbox(8)
	row.add_child(Kit.label("You", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.brass2}))
	var ybar := _canvas(func(c: Control):
		c.draw_rect(Rect2(0, 0, 150, 8), Color("#ffffff18"))
		c.draw_rect(Rect2(0, 0, 150 * c.get_meta("v", 1.0), 8), c.get_meta("c", Color("#7fbf5a"))), 150, 8)
	ybar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(ybar)
	_e["you-bar"] = ybar
	var ypct := Kit.label("", {f = "cond", w = 600, s = 13, c = C.cream, align = HORIZONTAL_ALIGNMENT_RIGHT})
	ypct.custom_minimum_size.x = 24
	row.add_child(ypct)
	_e["you-pct"] = ypct
	yc.add_child(row)
	var zone := Kit.label("", {f = "cond", w = 600, s = 12, ls = 0.1, up = true, c = Color("#f0a090")})
	zone.custom_minimum_size.y = 15
	yc.add_child(zone)
	_e["you-zone"] = zone
	yr.add_child(yc)
	you.add_child(yr)
	you.visible = false
	var flash := _hud_box("hitflash", _filter_rect({from_screen = false, tex_alpha = 0.0, edge_color = Color("#b0100a"), edge_blur = 160.0, edge_spread = 50.0, edge_k = 0.0}))
	flash.resized.connect(func(): flash.material.set_shader_parameter("px_size", flash.size))
	var ident := _hud_box("ident", Kit.box({grad = [[0.0, Color("#e9dfc3")], [1.0, Color("#ddd0ab")]], ring = [1.0, C.paper_edge], radius = 3.0, shadow = [12, 40, Color("#000000aa")]}, [18, 22, 18, 22]))
	ident.custom_minimum_size.x = 620
	Kit.pin(ident, 0.5, 0.5, 0.5, 0.5)
	ident.visible = false
	var health_b := _hud_box("health", Kit.vbox(0))
	health_b.custom_minimum_size.x = 200
	var dmg := TextureRect.new()
	dmg.custom_minimum_size = Vector2(200, 140)
	dmg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	dmg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	health_b.add_child(dmg)
	_e.dmg = dmg
	var hp := Kit.label("", {f = "ui", w = 600, s = 14, c = C.hud, sh = true, align = HORIZONTAL_ALIGNMENT_CENTER})
	health_b.add_child(hp)
	_e["health-pct"] = hp
	_want.health = true
	var eng := _hud_box("engines", Kit.hbox(6))
	Kit.pin(eng, 0.5, 1, 0.5, 1, Vector2(0, -14))
	_want.engines = false
	eng.visible = false
	var nose := _hud_box("nose", _cross("nose"))
	nose.visible = false
	var gs := _hud_box("gunsight", _cross("gunsight"))
	gs.visible = false
	_at(gs, null)
	var flight_b := _hud_box("flight", Kit.vbox(0))
	flight_b.custom_minimum_size.x = 220
	Kit.pin(flight_b, 0, 1, 0, 1, Vector2(18, -22))
	flight_b.visible = false
	var aid_b := _hud_box("aid", _canvas(func(c: Control):
		c.draw_rect(Rect2(Vector2.ZERO, c.size), Color("#00000077"))
		c.draw_rect(Rect2(1, 1, (c.size.x - 2) * clampf(c.get_meta("v", 0.0), 0, 1), c.size.y - 2), Color("#b6d47a"))
		c.draw_rect(Rect2(0.5, 0.5, c.size.x - 1, c.size.y - 1), Color("#ece8dc55"), false, 1.0), 220, 6))
	aid_b.custom_minimum_size.x = 220
	Kit.pin(aid_b, 0.5, 0.82, 0.5, 0.0, Vector2(0, 22 - 6))
	aid_b.visible = false
	var hurt_b := _hud_box("hurt", _filter_rect({from_screen = false, tex_alpha = 0.0, edge_color = Color("#6a0000"), edge_blur = 220.0, edge_spread = 60.0}))
	hurt_b.resized.connect(func(): hurt_b.material.set_shader_parameter("px_size", hurt_b.size))
	var ht := Kit.label("", {f = "ui", w = 600, s = 22, c = Color("#ffd0c0"), sh = true})
	Kit.pin(ht, 0.5, 0.7, 0.5, 1.0)
	hurt_b.add_child(ht)
	_e["hurt-text"] = ht
	hurt_b.visible = false
	var kills := _hud_box("kills", Kit.label("", {f = "cond", w = 700, s = 15, ls = 0.08, up = true, c = C.hud, sh = true}))
	Kit.pin(kills, 1, 0, 1, 0, Vector2(-18, 14))
	var ls := _hud_box("lifestats", Kit.hbox(0))
	Kit.pin(ls, 1, 0, 1, 0, Vector2(-18, 36))
	var banners := _hud_box("banners", Kit.vbox(8, BoxContainer.ALIGNMENT_CENTER))
	Kit.pin(banners, 0.5, 0.14, 0.5, 0)
	var ej := _hud_box("ejectcard", Kit.vbox(0))
	Kit.pin(ej, 1, 1, 1, 1, Vector2(-18, -22))
	ej.visible = false
	var toasts := _hud_box("toasts", Kit.vbox(6, BoxContainer.ALIGNMENT_CENTER))
	Kit.pin(toasts, 0.5, 0.22, 0.5, 0)
	var mm := _hud_box("mmap", ColorRect.new())
	mm.color = Color("#00000099")
	mm.set_anchors_preset(Control.PRESET_FULL_RECT)
	mm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mmc := CenterContainer.new()
	mmc.set_anchors_preset(Control.PRESET_FULL_RECT)
	mmc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mmr := Kit.hbox(18)
	var mcv := Control.new()
	mcv.custom_minimum_size = Vector2(720, 720)
	mcv.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mmr.add_child(mcv)
	_e["mmap-canvas"] = mcv
	var mside := Kit.box({bg = Color("#e8dcbc"), shadow = [6, 30, Color("#000000aa")]}, [16, 18, 16, 18])
	mside.custom_minimum_size.x = 300
	mside.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mmr.add_child(mside)
	_e["mmap-side"] = mside
	mmc.add_child(mmr)
	mm.add_child(mmc)
	mm.visible = false
	var mini := _hud_box("minimap", Control.new())
	mini.custom_minimum_size = Vector2(200, 200)
	mini.mouse_filter = Control.MOUSE_FILTER_IGNORE
	Kit.pin(mini, 0, 0, 0, 0, Vector2(18, 112))
	mini.visible = false
	_want.minimap = false
	# the gun: ammo, barrel heat, what's wrong, the reload
	var gun_b := _hud_box("gun", Kit.vbox(0))
	gun_b.custom_minimum_size.x = 220
	Kit.pin(gun_b, 1, 1, 1, 1, Vector2(-24, -22))
	var ga := Kit.vbox(0)
	gun_b.add_child(ga)
	_e["gun-ammo"] = ga
	gun_b.add_child(Kit.gap(0, 6))
	var heat := _canvas(func(c: Control):
		c.draw_rect(Rect2(Vector2.ZERO, c.size), Color("#00000077"))
		c.draw_rect(Rect2(1, 1, (c.size.x - 2) * c.get_meta("v", 0.0), c.size.y - 2), c.get_meta("c", Color("#d9d2b8")))
		c.draw_rect(Rect2(0.5, 0.5, c.size.x - 1, c.size.y - 1), Color("#ece8dc44"), false, 1.0), 0, 5)
	gun_b.add_child(heat)
	_e["gun-heat"] = heat
	gun_b.add_child(Kit.gap(0, 2))
	gun_b.add_child(Kit.label("Barrel heat", {f = "cond", w = 700, s = 13, ls = 0.1, up = true, c = Color("#ece8dccc"), sh = true, align = HORIZONTAL_ALIGNMENT_RIGHT}))
	gun_b.add_child(Kit.gap(0, 6))
	var gst := Kit.label("", {f = "ui", w = 500, s = 15, c = C.hud, sh = true, align = HORIZONTAL_ALIGNMENT_RIGHT})
	gst.custom_minimum_size.y = 18
	gun_b.add_child(gst)
	_e["gun-state"] = gst
	var rl := _canvas(func(c: Control):
		c.draw_rect(Rect2(Vector2.ZERO, c.size), Color("#00000077"))
		c.draw_rect(Rect2(1, 1, (c.size.x - 2) * clampf(c.get_meta("v", 0.0), 0, 1), c.size.y - 2), Color("#b6d47a"))
		c.draw_rect(Rect2(0.5, 0.5, c.size.x - 1, c.size.y - 1), Color("#ece8dc44"), false, 1.0), 0, 5)
	rl.visible = false
	gun_b.add_child(rl)
	_e["gun-reload"] = rl
	_want.gun = false
	gun_b.visible = false
	_want.crosshair = true
	_want.nose = false
	_want.gunsight = false
	_want.flight = false
	_apply_mode()

func mission(text: String) -> void:
	if text != _last.get("mission"):
		_last.mission = text
		el("mission").get_meta("label").text = text
		el("mission").visible = text != ""

## Both sides at a glance, under the mission line: each side's insignia, its strength as a bar (bombers:
## healthy, damaged, lost; fighters: in the air, shot down, still to come) and the numbers beside it.
func forces(b: Dictionary, f: Dictionary) -> void:
	var key := str([b, f])
	if key == _last.get("forces"):
		return
	_last.forces = key
	var box: Container = el("forces")
	box.visible = true
	_clear(box)
	var grid := Kit.vbox(3)
	var fa: Dictionary = f.axis
	var fl: Dictionary = f.allied
	var cls := {ok = {c = Color("#8fcf6a"), w = 600}, dmg = {c = Color("#f0c24a"), w = 600}, down = {c = Color("#ff6a5a"), w = 600}, air = {c = C.cream, w = 600}, left = {c = Color("#9a9484"), w = 600}}
	var seg := {ok = Color("#6fae4a"), dmg = Color("#d9a432"), down = Color("#c8402f"), air = Color("#d8d2bc"), left = Color("#5a574e")}
	var row := func(us: bool, badge: String, name: String, total: int, segs: Array, text: String):
		var r := Kit.hbox(6)
		r.add_child(Kit.svg_rect(badge, 24, 14))
		r.get_child(0).custom_minimum_size.x = 26
		var n := Kit.label(name, {f = "cond", w = 600, s = 15, ls = 0.14, up = true, c = Color("#9cc4ff") if us else Color("#ff8a78")})
		n.custom_minimum_size.x = 78
		r.add_child(n)
		var t := Kit.label(str(total), {f = "cond", w = 600, s = 15, c = Color.WHITE, align = HORIZONTAL_ALIGNMENT_RIGHT})
		t.custom_minimum_size.x = 38
		r.add_child(t)
		var bar := _canvas(func(c: Control):
			c.draw_rect(Rect2(0, 0, 120, 6), Color("#ffffff14"))
			var x := 0.0
			for s in segs:
				var w: float = 120.0 * s[1] / maxf(1, total)
				c.draw_rect(Rect2(x, 0, w, 6), seg[s[0]])
				x += w, 120, 6)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		r.add_child(bar)
		r.add_child(Kit.flow(text, {f = "ui", w = 500, s = 14, c = Color("#e0d8c2")}, null, cls, FlowContainer.ALIGNMENT_BEGIN))
		grid.add_child(r)
	row.call(true, EMBLEM.crew, "B-17", b.total, [["ok", b.healthy], ["dmg", b.damaged], ["down", b.down]],
		"<em class=\"ok\">%d</em> healthy · <em class=\"dmg\">%d</em> damaged · <em class=\"down\">%d</em> lost%s" % [b.healthy, b.damaged, b.down, " · %d turned back" % b.aborted if b.get("aborted", 0) else ""])
	row.call(false, EMBLEM.bf109, "Luftwaffe", fa.total, [["air", fa.air], ["down", fa.down], ["left", fa.reserve]],
		"<em class=\"air\">%d</em> up%s · <em class=\"down\">%d</em> down · <em class=\"left\">%d</em> to come" % [fa.air, " (%d Fw 190)" % fa.fw if fa.get("fw", 0) else "", fa.down, fa.reserve])
	row.call(true, EMBLEM.crew, "P-47", fl.total, [["air", fl.air], ["down", fl.down], ["left", fl.reserve]],
		"<em class=\"air\">%d</em> up · <em class=\"down\">%d</em> down · <em class=\"left\">%d</em> to come" % [fl.air, fl.down, fl.reserve])
	box.add_child(grid)

## The Norden bombsight view (null hides it).
func sight(s) -> void:
	el("sight").visible = s != null
	_show("crosshair", s == null)
	if s == null:
		return
	var lr := "on course" if absf(s.across) < 15 else "target %d m %s" % [roundi(absf(s.across)), "right: D" if s.across > 0 else "left: A"]
	var html := ""
	if s.released:
		html = "<b>BOMBS AWAY</b> · %d left in the racks" % s.bombs
	elif s.phase != "bombrun":
		html = "Bomb run not started: the target is still beyond the horizon"
	else:
		html = "Target <b>%.2f km</b> to the crosshair · %s<br><span class=\"keys\">A / D steer the formation · <b>Space</b> or click: release when the target is on the crosshair · E leave</span>" % [maxf(0, s.along) / 1000.0, lr]
	if html == _last.get("sight"):
		return
	_last.sight = html
	var si: Control = el("sight-info")
	_clear(si)
	si.add_child(Kit.flow(html, {f = "ui", w = 500, s = 16, c = C.hud, sh = true, lh = 1.6}, null))

## End-of-mission debrief: the interrogation report.
func debrief(d: Dictionary, on_again: Callable, on_quality: Callable = Callable(), role := "crew") -> void:
	if role != "crew":
		pilot_debrief(d, on_again, on_quality, role)
		return
	var pct := roundi((float(d.onTarget) / d.dropped) * 100) if d.dropped else 0
	var mine = roundi((float(d.playerOnTarget) / d.playerDropped) * 100) if d.playerDropped else null
	var rating := "Excellent" if pct > 45 else "Good" if pct > 30 else "Fair" if pct > 15 else "Poor"
	var f: Dictionary = d.forces
	var c1 := Kit.vbox(16)
	c1.add_child(section("Bombing", [
		["Bombs within 1,000 ft of the aiming point", "%d%% of %s" % [pct, Kit.num(d.dropped)]],
		["Your bombs on target", "none dropped" if mine == null else "%d%% of %d" % [mine, d.playerDropped]],
		["Target buildings destroyed", "%d of %d" % [d.destroyed, d.buildings]]]))
	var crew_rows := [["Crewmen saved by first aid", "%d (%d by you)" % [d.saved, d.savedByYou]], ["Your crew home safe", "%d of 10" % d.crewHome]]
	if d.get("crewMen"):
		crew_rows.append(["Your crew", "%d fit · %d wounded · %d dead" % [d.crewMen.alive, d.crewMen.wounded, d.crewMen.dead]])
	c1.add_child(section("Your crew", crew_rows))
	var c2 := Kit.vbox(16)
	c2.add_child(section("The air battle", [
		["Fighters shot down by you", d.kills.player],
		["… by your crews' gunners", d.kills.crew],
		["… by the escorts", d.kills.escorts],
		["Escorts lost", d.kills.alliedLost],
		["Bf 109s and Fw 190s", "%d down of %d sent up" % [f.f.axis.down, f.f.axis.total - f.f.axis.reserve]],
		["P-47s", "%d lost of %d sent up" % [f.f.allied.down, f.f.allied.total - f.f.allied.reserve]]]))
	var stream := [["B-17s lost", "%d of %d" % [d.bombersLost, d.bombers]],
		["At the end", "%d healthy, %d damaged%s" % [f.b.healthy, f.b.damaged, ", %d turned back early" % f.b.aborted if f.b.get("aborted", 0) else ""]]]
	if d.get("men"):
		stream.append(["Men in the bombers home", "%s fit · %d wounded · %d dead" % [Kit.num(d.men.alive), d.men.wounded, d.men.dead]])
	c2.add_child(section("The stream", stream))
	var rec := Kit.vbox(18, BoxContainer.ALIGNMENT_BEGIN)
	var st := _rating(rating)
	st.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	rec.add_child(st)
	rec.add_child(_record(life_card(d.score, "Whole mission"), "debrief"))
	menu({kind = "debrief", kicker = "Interrogation report", title = "Mission complete", button = "Fly again", on_click = on_again, on_quality = on_quality,
		body = _debrief_grid([c1, c2, rec])})

## End of the mission as a fighter pilot.
func pilot_debrief(d: Dictionary, on_again: Callable, on_quality: Callable, role: String) -> void:
	var p: Dictionary = d.pilot
	var f: Dictionary = d.forces
	var rows := [["B-17s you brought down", p.bombers], ["P-47s you shot down", p.fighters]] if role != "p47" else [["Bf 109s you shot down", p.fighters], ["Attacks you broke up (bombers saved)", p.saved]]
	rows.append(["Times you were shot down", p.deaths])
	var c1 := Kit.vbox(16)
	c1.add_child(section("Your sorties", rows))
	var c2 := Kit.vbox(16)
	c2.add_child(section("The air battle", [
		["B-17s lost", "%d of %d" % [d.bombersLost, d.bombers]],
		["Luftwaffe fighters lost (all)", d.kills.get("axisLost", 0)],
		["P-47s lost (all)", d.kills.alliedLost],
		["B-17s at the end", "%d healthy, %d damaged" % [f.b.healthy, f.b.damaged]],
		["Bombs within 1,000 ft of the aiming point", "%d%% of %s" % [roundi((float(d.onTarget) / d.dropped) * 100) if d.dropped else 0, Kit.num(d.dropped)]]]))
	var rec := Kit.vbox(18)
	rec.add_child(_record(life_card(d.score, "Whole mission"), "debrief"))
	menu({kind = "debrief", kicker = "Gefechtsbericht · combat report" if role != "p47" else "Interrogation report", title = "Einsatz beendet" if role != "p47" else "Mission complete",
		button = "Fly again", on_click = on_again, on_quality = on_quality, body = _debrief_grid([c1, c2, rec])})

func _debrief_grid(cols: Array) -> Control:
	var g := Kit.hbox(28)
	for i in cols.size():
		var c: Control = cols[i]
		if i < 2:
			c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			c.size_flags_stretch_ratio = 1.0
		else:
			c.custom_minimum_size.x = 360
		g.add_child(c)
	return g

## The bombing's rating, stamped: a word under "Bombing", green when it's good.
func _rating(word: String) -> Control:
	var good := word == "Excellent" or word == "Good"
	var col: Color = Color("#2f6420") if good else C.red
	var big := Kit.settings({f = "display", w = 400, s = 30, ls = 0.14, c = col})
	var small := Kit.settings({f = "cond", w = 600, s = 13, ls = 0.18, c = col})
	var t := word.to_upper()
	var w := big.font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 30).x + 36 + 6
	var h := 13 + 33 + 9 + 6
	var c := _canvas(func(c: Control):
		var cc := Color(col, 0.82)
		c.draw_rect(Rect2(0.5, 0.5, w - 1, h - 1), cc, false, 1.0)
		c.draw_rect(Rect2(2.5, 2.5, w - 5, h - 5), cc, false, 1.0)
		_txt(c, small.font, 13, "BOMBING", 21, 9, cc, "left", "top")
		_txt(c, big.font, 30, t, 21, h - 8, cc, "left", "alphabetic")
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(word)
		for i in int(w * h / 40):
			c.draw_rect(Rect2(rng.randf() * w, rng.randf() * h, 1.5, 1.5), Color(0.91, 0.87, 0.76, rng.randf() * 0.5)), w, h)
	c.pivot_offset = Vector2(w, h) / 2
	c.rotation = deg_to_rad(-7)
	return c

## A titled list of typed results, for the debrief.
func section(name: String, rows: Array) -> Control:
	var s := Kit.vbox(0)
	s.add_child(Kit.label(name, {f = "cond", w = 700, s = 15, ls = 0.16, up = true, c = C.ink}))
	s.add_child(Kit.gap(0, 3))
	s.add_child(Kit.rule(C.ink, 2))
	s.add_child(Kit.gap(0, 4))
	for r in rows:
		var row := Kit.box({}, [5, 0, 5, 0])
		var h := Kit.hbox(8)
		var dt := Kit.label(str(r[0]), {f = "ui", w = 500, s = 16, c = C.ink2})
		dt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(dt)
		h.add_child(Kit.label(str(r[1]), {f = "ui", w = 600, s = 16, c = C.ink, align = HORIZONTAL_ALIGNMENT_RIGHT}))
		row.add_child(h)
		row.add_child(_dotted_bottom())
		s.add_child(row)
	return s

## Crew list: who's on which gun, who's hit (with time left), who's gone. (Hidden in play, as the stylesheet has
## it: the crew are on the pause menu's Change position; kept for the data.)
func crew(members: Array) -> void:
	var parts := []
	for m in members:
		var s := ""
		if m.state == "player":
			s = "YOU" + (" ●" if m.get("standIn") else "")
		elif m.state == "wounded":
			s = "WOUNDED %ds" % ceili(m.woundLeft)
		elif m.state == "dead":
			s = "KIA"
		elif m.state == "bailed":
			s = "BAILED OUT"
		elif m.get("task") == "helping":
			s = "FIRST AID"
		else:
			s = "●"
		var once := " ✚1" if m.get("patched") and (m.state == "ok" or m.state == "player") else ""
		parts.append([m.role.title + once, s, m.state])
	var key := str(parts)
	if key == _last.get("crew"):
		return
	_last.crew = key
	var box: Container = el("crew")
	_clear(box)
	var colr := {ok = Color("#8fcf6a"), player = Color.WHITE, wounded = Color("#ffb36a"), dead = Color("#ff5a4a"), bailed = Color("#d9d2b8")}
	for p in parts:
		var r := Kit.hbox(14)
		r.custom_minimum_size.x = 190
		var t := Kit.label(p[0], {f = "sys", w = 400, s = 11, ls = 0.05, c = Color("#ece8dcaa"), sh = true})
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(t)
		r.add_child(Kit.label(p[1], {f = "sys", w = 600, s = 11, c = colr.get(p[2], Color("#8fcf6a")), sh = true}))
		if p[2] == "dead":
			r.modulate.a = 0.6
		box.add_child(r)

## The four engines, numbered as the pilot sees them, plus wing fires: only when it matters (an engine
## in trouble, a wing on fire, going down) or while you're at the controls (show).
func engines(bomber, show := false) -> void:
	var tf = bomber.tank_fire
	var trouble: bool = bomber.down or tf.get(-1, 0) or tf.get(1, 0)
	for e in bomber.engines:
		if e.state != "ok" or e.get("feathered"):
			trouble = true
	_show("engines", show or trouble)
	var label := {ok = "", smoking = "SMOKING", dead = "OUT", fire = "FIRE"}
	var items := []
	for i in bomber.engines.size():
		items.append([str(i + 1), label[bomber.engines[i].state], bomber.engines[i].state])
	if tf.get(-1, 0) or tf.get(1, 0):
		items.append(["WING FIRE", "", "wing"])
	if bomber.down:
		items.append(["GOING DOWN", "", "wing"])
	var key := str(items)
	if key == _last.get("eng"):
		return
	_last.eng = key
	var box: Container = el("engines")
	_clear(box)
	for it in items:
		var st: String = it[2]
		var col: Color = {smoking = Color("#ffd36a"), dead = Color("#888888"), fire = Color("#ff5a3a"), wing = Color("#ff5a3a")}.get(st, C.hud)
		var bc: Color = {smoking = Color("#ffd36a"), dead = Color("#666666"), fire = Color("#ff5a3a"), wing = Color("#ff5a3a")}.get(st, Color("#ece8dc66"))
		var b := Kit.box({bg = Color("#0b0d10b8"), border = [1, 1, 1, 1], border_color = bc, radius = 3.0}, [3, 7, 3, 7])
		b.min_w = 38
		var v := Kit.vbox(0, BoxContainer.ALIGNMENT_CENTER)
		v.add_child(Kit.label(it[0], {f = "cond", w = 700, s = 13 if st == "wing" else 15, c = col, align = HORIZONTAL_ALIGNMENT_CENTER}))
		if st != "wing":
			var sm := Kit.label(it[1], {f = "cond", w = 700, s = 12, ls = 0.04, c = col, align = HORIZONTAL_ALIGNMENT_CENTER})
			sm.custom_minimum_size.y = 13
			v.add_child(sm)
		b.add_child(v)
		if st == "fire" or st == "wing": # (blinking)
			_every_frame(func(_dt):
				if not is_instance_valid(b):
					return false
				b.modulate.a = 0.35 if fmod(Time.get_ticks_msec() / 600.0, 1.0) > 0.5 else 1.0
				return true)
		box.add_child(b)

## The damage diagram: a top-down B-17 made of its parts (wings inner and outer, engines, tail,
## turrets, the fuselage section by section), each tinted from its normal colour through light red
## and dark red to black as it's shot up. A part that has broken off is gone from the picture.
## Burning parts flicker orange. Plus the overall figure and the fire bottles left.
func health(h: float, bottles, bomber = null) -> void:
	_show("health", true)
	if _last.get("dmg_kind", "x") != "": # (back from a fighter: the B-17 again)
		_last.dmg_kind = ""
		_last.dmg = null
		_last.health = null
	var key := damage_key(bomber) if bomber else ""
	var pct := roundi(h * 100)
	if key != _last.get("dmg") or _last.get("burning", false):
		_last.dmg = key
		var any_burning := false
		var fills := {}
		for part in DMG_PARTS:
			var fill := damage_colour(bomber.damage(part) if bomber else 0.0)
			var burning := false
			var e = null
			if bomber and part.begins_with("engine"):
				e = bomber.engines[int(part.substr(6)) - 1]
			if bomber:
				var tf = bomber.tank_fire
				var sf = bomber.get("sec_fire") if bomber is Object else bomber.get("sec_fire", {})
				burning = (e != null and e.state == "fire") or (part == "wingLi" and tf.get(-1, 0) > 0) or (part == "wingRi" and tf.get(1, 0) > 0) or (sf != null and sf.get(part, 0) > 0)
				if e != null and e.state == "dead":
					fill = Color("#1b1b1b")
				if bomber.lost.get(part, false):
					fills[part] = null
					continue
			if burning: # (flickering orange and yellow)
				any_burning = true
				fill = Color("#ff7a18").lerp(Color("#ffd060"), 0.5 + 0.5 * sin(Time.get_ticks_msec() / 450.0 * PI))
			fills[part] = [fill, burning]
		_last.burning = any_burning
		var svg := "<svg viewBox=\"0 0 200 140\">%s</svg>" % _diagram_svg(func(p):
			var f = fills.get(p)
			if f == null:
				return null
			return "fill=\"#%s\" fill-opacity=\"0.82\" stroke=\"%s\" stroke-width=\"%s\"" % [f[0].to_html(false), "#ffb040" if f[1] else "#00000099", 1.4 if f[1] else 0.8])
		el("dmg").texture = Kit.svg(svg, 200, 140)
	if pct == _last.get("health") and bottles == _last.get("bottles"):
		return
	_last.health = pct
	_last.bottles = bottles
	el("health-pct").text = "%d%%" % pct if bottles == null else "%d%% · %d fire bottle%s" % [pct, bottles, "" if bottles == 1 else "s"]

## Flying a fighter: the same diagram for your own plane, its type's plan view in parts (engine,
## cockpit, fuel tank, wings, fuselage, tail), each tinted as it's shot up; the engine flickers when on fire.
func fighter_damage(f) -> void:
	_show("health", true)
	if _last.get("dmg_kind") != f.kind:
		_last.dmg_kind = f.kind
		_last.dmg = null
		_last.health = null
	var key := ""
	for v in f.parts.values():
		key += str(roundi(v * 4)) + ","
	key += str(f.burning) + str(f.smoking) + str(f.alive)
	if key == _last.get("dmg") and not f.burning:
		return
	_last.dmg = key
	var left := 0.0
	var all := 0.0
	for n in f.k.parts:
		left += maxf(0, f.parts[n])
		all += f.k.parts[n].hp
	var svg := "<svg viewBox=\"0 0 100 100\">%s</svg>" % _diagram_svg(func(n):
		var hp: float = f.k.parts[n].hp if f.k.parts.has(n) else 1.0
		var fill := damage_colour(1 - maxf(0, f.parts.get(n, hp)) / hp)
		var burning: bool = n == "engine" and f.burning
		if burning:
			fill = Color("#ff7a18").lerp(Color("#ffd060"), 0.5 + 0.5 * sin(Time.get_ticks_msec() / 450.0 * PI))
		return "fill=\"#%s\" fill-opacity=\"0.82\" stroke=\"%s\" stroke-width=\"%s\"" % [fill.to_html(false), "#ffb040" if burning else "#00000099", 1.4 if burning else 0.8], _fdiagram(f.kind))
	el("dmg").texture = Kit.svg(svg, 140, 140)
	var pct := roundi((left / all) * 100) if f.alive else 0
	_last.health = pct
	el("health-pct").text = "%s · %d%%" % [f.k.name, pct]

## Flight instruments while you're at the controls (null hides them).
func flight(f) -> void:
	var box: Container = el("flight")
	_show("flight", f != null)
	_show("nose", f != null and f.get("nose") != null)
	if f == null:
		el("speedwarn").visible = false
		return
	if f.get("nose"):
		_at(el("nose"), f.nose)
	_clear(box)
	var st := _FLIGHT
	var al := FlowContainer.ALIGNMENT_BEGIN
	box.add_child(Kit.flow("<b>%d</b> mph" % roundi(f.mph), st.merged({cap_s = 18}), null, {}, al))
	box.add_child(Kit.flow("<b>%s</b> ft" % Kit.num(f.feet), st, null, {}, al))
	box.add_child(Kit.flow("Heading <b>%03d°</b> · bank %d°" % [roundi(f.heading), roundi(f.bank)], st, null, {}, al))
	box.add_child(Kit.gap(0, 2))
	box.add_child(_bar(f.throttle, Color("#8fcf6a"), 7))
	box.add_child(Kit.gap(0, 2))
	box.add_child(Kit.label("Throttle %d%%" % roundi(f.throttle * 100), _LBL))
	box.add_child(Kit.label("%d m out of formation" % roundi(f.offset) if f.offset > 60 else "In formation", _LBL))
	_bold_big(box)
	# an engine out: you've lost power, and only more throttle on the others keeps you in the box
	var w: Container = el("speedwarn")
	var p = f.get("power")
	var short: bool = p != null and f.throttle < minf(1, p.need) - 0.02
	var falling: bool = f.behind > 25
	w.visible = p != null and (short or falling)
	if w.visible:
		var e = p.lost[0]
		var what := "on fire" if e.state == "fire" else "damaged" if e.state == "smoking" else "feathered" if e.get("feathered") else "windmilling"
		var html := "<b>Losing speed</b> — engine %d %s%s.<br>" % [e.n, what, " (%d engines out)" % p.lost.size() if p.lost.size() > 1 else ""]
		html += "Full throttle won't hold the formation" if p.need > 1 else "Increase throttle to %d%% to stay in formation" % roundi(p.need * 100) if short else "More throttle to catch up with your slot"
		html += " · <b>%d m</b> behind" % roundi(f.behind) if falling else ""
		if html != _last.get("warn"):
			_last.warn = html
			_clear(w)
			var fl := Kit.flow(html, {f = "ui", w = 500, s = 15, c = Color("#ffd36a")}, null, {}, FlowContainer.ALIGNMENT_CENTER)
			for l in fl.find_children("*", "Label", true, false):
				if l.label_settings.font == Kit.font("ui", 700):
					l.label_settings = Kit.settings({f = "ui", w = 700, s = 15, c = Color("#ffe9b0")})
			w.add_child(fl)

## (#flight b: 18px bold)
func _bold_big(box: Control) -> void:
	for l in box.find_children("*", "Label", true, false):
		if l.label_settings.font == Kit.font("ui", 700):
			l.label_settings = Kit.settings({f = "ui", w = 700, s = 18, c = C.hud, sh = true})

## The mini map: a round radar plot, always up in the corner, turned with your view (straight up is where
## you're looking). You in the middle; the B-17s as grey dots (paler lower down, crosses for the ones going
## down), the P-47s blue, the Luftwaffe red; the target's bearing and range on the rim. d: {at, yaw,
## bombers, fighters, target, side, range}.
func minimap(d) -> void:
	var box: Control = el("minimap")
	_show("minimap", d != null)
	if d == null:
		return
	if not box.draw.is_connected(_draw_minimap):
		box.draw.connect(_draw_minimap)
	box.set_meta("d", d)
	box.queue_redraw()

func _draw_minimap() -> void:
	var box: Control = el("minimap")
	var d = box.get_meta("d")
	box.draw_set_transform(Vector2.ZERO, 0, Vector2(0.5, 0.5)) # (drawn on a 400 px plot, shown at 200)
	var S := 400.0
	var R := S / 2 - 8
	var k: float = R / d.range
	var cs := cos(d.yaw)
	var sn := sin(d.yaw)
	var plot := func(p) -> Vector2:
		var dx: float = p.x - d.at.x
		var dz: float = p.z - d.at.z
		return Vector2(S / 2 + (dx * cs - dz * sn) * k, S / 2 + (dx * sn + dz * cs) * k)
	var m := Vector2(S / 2, S / 2)
	box.draw_circle(m, R, Color("#0d110bcc"))
	box.draw_arc(m, R / 3, 0, TAU, 64, Color("#c9a55a33"), 2.0, true) # 1 km rings
	box.draw_arc(m, R * 2 / 3, 0, TAU, 64, Color("#c9a55a33"), 2.0, true)
	box.draw_line(Vector2(S / 2, 8), Vector2(S / 2, S - 8), Color("#c9a55a33"), 2.0)
	box.draw_line(Vector2(8, S / 2), Vector2(S - 8, S / 2), Color("#c9a55a33"), 2.0)
	var inside := func(p: Vector2) -> bool: return p.distance_to(m) <= R
	for b in d.bombers: # the stream
		if b.gone:
			continue
		var p: Vector2 = plot.call(b.group.position)
		if not inside.call(p):
			continue
		if b.down:
			box.draw_line(p - Vector2(4, 4), p + Vector2(4, 4), Color("#ff6a4a"), 2.0)
			box.draw_line(p + Vector2(4, -4), p + Vector2(-4, 4), Color("#ff6a4a"), 2.0)
			continue
		box.draw_circle(p, 3.6, Color("#e8b04a") if b.get("straggling") else Color("#b9bfc4"))
	for f in d.fighters:
		if not f.alive or f.get("player"):
			continue
		var p: Vector2 = plot.call(f.pos)
		if not inside.call(p):
			continue
		box.draw_colored_polygon(PackedVector2Array([p + Vector2(0, -5), p + Vector2(4.5, 4), p + Vector2(-4.5, 4)]), Color("#ff3a2a") if f.side == "axis" else Color("#4aa0ff"))
	# the rim (red in the flak belt), the target's bearing, you
	var fk: float = d.get("flak", 0.0)
	box.draw_arc(m, R, 0, TAU, 96, Color8(255, int(120 - fk * 80), 70, int((0.5 + fk * 0.5) * 255)) if fk else Color("#c9a55a99"), 5.0 if fk else 3.0, true)
	if fk:
		_txt(box, Kit.font("cond", 700), 22, "FLAK", S / 2, 44, Color("#ff8a6a"), "center")
	if d.get("target"):
		var dx: float = d.target.x - d.at.x
		var dz: float = d.target.z - d.at.z
		var a := atan2(dx * sn + dz * cs, dx * cs - dz * sn)
		var dist := Vector2(dx, dz).length()
		var p := Vector2(S / 2 + cos(a) * (R - 2), S / 2 + sin(a) * (R - 2))
		box.draw_circle(p, 9, Color("#ff5040"))
		box.draw_arc(p, 4, 0, TAU, 24, Color.WHITE, 2.0, true)
		_txt(box, Kit.font("sys", 600), 20, "TARGET %d km" % roundi(dist / 1000), S / 2, S - 26, Color("#ece8dc"), "center")
	var you := PackedVector2Array([m + Vector2(0, -11), m + Vector2(8, 8), m + Vector2(0, 3), m + Vector2(-8, 8)])
	box.draw_colored_polygon(you, Color("#ffd24a"))
	you.append(you[0])
	box.draw_polyline(you, Color.BLACK, 2.0, true)
	_txt(box, Kit.font("sys", 600), 17, "%s km" % str(d.range / 1000), 14, S - 12, Color("#ece8dc99"))
	box.draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)

const YOU_ZONES := [["head", "<circle cx=\"20\" cy=\"8\" r=\"6.5\" {A}/>"], ["torso", "<rect x=\"12\" y=\"16\" width=\"16\" height=\"26\" rx=\"3\" {A}/>"], ["armL", "<rect x=\"5\" y=\"17\" width=\"6\" height=\"25\" rx=\"3\" {A}/>"],
	["armR", "<rect x=\"29\" y=\"17\" width=\"6\" height=\"25\" rx=\"3\" {A}/>"], ["legL", "<rect x=\"12.5\" y=\"43\" width=\"7\" height=\"34\" rx=\"3\" {A}/>"], ["legR", "<rect x=\"20.5\" y=\"43\" width=\"7\" height=\"34\" rx=\"3\" {A}/>"]]
var _last_you = null
## You: your health, and a small figure of you (seen from behind: its left is your left) whose head, body,
## arms and legs are tinted as they're hurt (wounds: player.wounds, 0..1 each), like the bomber's diagram.
func you(h, wounds = null) -> void:
	el("you").visible = h != null
	var key := ""
	if wounds:
		for v in wounds.values():
			key += str(roundi(v * 20)) + ","
	if (wounds or not el("you-body").texture) and key != _last.get("wounds"):
		_last.wounds = key
		var w: Dictionary = wounds if wounds else {}
		el("you-body").texture = Kit.svg("<svg viewBox=\"0 0 40 80\">%s</svg>" % _diagram_svg(func(z): return "fill=\"#%s\" fill-opacity=\"0.85\" stroke=\"#00000099\" stroke-width=\"0.8\"" % damage_colour(w.get(z, 0.0)).to_html(false), YOU_ZONES), 36, 72)
		var worst = null
		for z in w:
			if w[z] > 0.05 and (worst == null or w[z] > w[worst]):
				worst = z
		var NAME := {head = "Head", torso = "Chest", armL = "Left arm", armR = "Right arm", legL = "Left leg", legR = "Right leg"}
		el("you-zone").text = "%s %s" % [NAME[worst], "badly hurt" if w[worst] > 0.6 else "hurt"] if worst != null else ""
	if h == null or h == _last_you:
		return
	if _last_you != null and h < _last_you:
		hit_flash(minf(1, (_last_you - h) * 3))
	_last_you = h
	var bar: Control = el("you-bar")
	bar.set_meta("v", h)
	bar.set_meta("c", Color("#7fbf5a") if h > 0.6 else Color("#e0a832") if h > 0.3 else Color("#d8452f"))
	bar.queue_redraw()
	el("you-pct").text = str(roundi(h * 100))

## The bomber you're in, as the records have her (I): serial, type, name, group and squadron, code, pilot,
## what became of her that day, and her crew by station with each man's recorded fate. Only what's on
## record is shown; an unknown is said to be unknown, a placeholder crewman is marked as one, and each
## line carries how sure the record is (VERIFIED / PROBABLE / UNVERIFIED). d: null hides it.
func identity(d) -> void:
	var box: Container = el("ident")
	if d == null:
		box.visible = false
		_last.ident = null
		return
	if str(d) == _last.get("ident"):
		box.visible = true
		return
	_last.ident = str(d)
	_clear(box)
	var i: Dictionary = d.get("ident", {}) if d.get("ident") else {}
	var OUT := {bombed = "bombed the target", aborted = "turned back (abort)", returned_damaged = "returned damaged", written_off = "written off", lost = "lost", unknown = "not known"}
	var col := Kit.vbox(0)
	var conf := func(c) -> Control:
		if not c:
			return Kit.gap()
		var cc: Color = {VERIFIED = Color("#2f6b22"), PROBABLE = Color("#8a6a10")}.get(str(c).to_upper(), Color("#8a3a2a"))
		var b := Kit.box({border = [1, 1, 1, 1], border_color = cc, radius = 2.0}, [1, 5, 1, 5])
		b.add_child(Kit.label(str(c), {f = "cond", w = 700, s = 10, ls = 0.1, c = cc}))
		b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		return b
	var head := HFlowContainer.new()
	head.add_theme_constant_override("h_separation", 12)
	var tp: String = (" " + RegEx.create_from_string("^B-17").sub(i.type, "")) if i.get("type") else ""
	var ht := Kit.label("B-17%s Flying Fortress" % tp, {f = "cond", w = 700, s = 13, ls = 0.16, up = true, c = C.ink2})
	ht.size_flags_vertical = Control.SIZE_SHRINK_END
	head.add_child(ht)
	head.add_child(Kit.label("“%s”" % i.nickname if i.get("nickname") else "name not recorded" if i.get("known") else "not identified", {f = "display", w = 400, s = 26, ls = 0.04, c = C.ink}))
	head.add_child(conf.call(i.get("confidence")))
	col.add_child(head)
	col.add_child(Kit.gap(0, 8))
	col.add_child(Kit.rule(C.ink2, 2))
	col.add_child(Kit.gap(0, 10))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 4)
	var row := func(k: String, v) -> Control:
		var r := Kit.box({}, [3, 0, 3, 0])
		var h := Kit.hbox(8)
		var kl := Kit.label(k, {f = "cond", w = 700, s = 12, ls = 0.1, up = true, c = C.ink2})
		kl.custom_minimum_size.x = 92
		h.add_child(kl)
		h.add_child(Kit.label(str(v) if v else "unknown", {f = "type", w = 400, s = 15, c = C.ink} if v else {f = "ui", w = 400, s = 15, c = Color("#7a6a52")}))
		r.add_child(h)
		r.add_child(_dashed_bottom(Color("#4c3f2c33")))
		r.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		return r
	grid.add_child(row.call("Serial", i.get("serial")))
	grid.add_child(row.call("Bomb Group", i.get("unit", i.get("group", "?"))))
	grid.add_child(row.call("Squadron", i.get("squadron")))
	grid.add_child(row.call("Code", i.get("code")))
	grid.add_child(row.call("Pilot", i.get("pilot")))
	grid.add_child(row.call("That day", OUT.get(i.get("outcome", "unknown"), i.get("outcome"))))
	grid.add_child(row.call("Mission", "Schweinfurt, 14 October 1943"))
	grid.add_child(row.call("Her place", ("as charted" if i.get("slotBasis") else "as recorded") if i.get("slotDocumented") else "not documented: an estimate"))
	col.add_child(grid)
	if i.get("lossDetails"):
		col.add_child(Kit.label(i.lossDetails + (" (MACR %s)" % i.macr if i.get("macr") else ""), {f = "type", w = 400, s = 14, c = C.ink, wrap = true}))
	col.add_child(Kit.gap(0, 6))
	for m in d.get("crew", []):
		var r := Kit.box({}, [3, 0, 3, 0])
		var h := Kit.hbox(8)
		var t := Kit.label(m.title, {f = "cond", w = 700, s = 12, ls = 0.1, up = true, c = C.ink2})
		t.custom_minimum_size.x = 92
		h.add_child(t)
		var nm := Kit.hbox(6)
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		nm.add_child(Kit.label(m.name, {f = "type", w = 600, s = 15, c = C.ink}))
		if m.get("placeholder"):
			nm.add_child(Kit.label("placeholder", {f = "ui", w = 400, s = 14, c = Color("#7a6a52")}))
		h.add_child(nm)
		if not m.get("placeholder"):
			h.add_child(conf.call(m.get("confidence")))
			h.add_child(Kit.label(str(m.get("fate", "")) if m.get("fate") else "", {f = "type", w = 400, s = 13, c = C.ink2}))
		r.add_child(h)
		r.add_child(_dashed_bottom(Color("#4c3f2c33")))
		col.add_child(r)
	col.add_child(Kit.gap(0, 10))
	var foot := Kit.flow(("From the bomb group records (historical_data/black_thursday)." if i.get("known") else "No record of this aircraft has been found: its crew are placeholders, not real men.") + " <kbd>I</kbd> to close",
		{f = "type", w = 400, s = 12, c = C.ink2, cap_gap = 4.0}, "kbd", {}, FlowContainer.ALIGNMENT_BEGIN)
	col.add_child(foot)
	box.add_child(col)
	box.visible = true

## The screen's edges flash red: you've been hit (k 0..1, how hard).
func hit_flash(k := 1.0) -> void:
	var f: ColorRect = el("hitflash")
	var m: ShaderMaterial = f.material
	var tw := create_tween()
	tw.tween_method(func(v): m.set_shader_parameter("edge_k", v), 0.35 + k * 0.65, 0.0, 0.45).set_ease(Tween.EASE_OUT)

## First-aid progress (0..1), or null to hide.
func aid(progress) -> void:
	var a: Control = el("aid")
	a.visible = progress != null
	if progress != null:
		a.set_meta("v", progress)
		a.queue_redraw()

var hurt_on := false
## You're wounded: the screen blurs and darkens as time runs out. left = seconds, null = fine.
func hurt(left = null, total := 1.0, helped := false) -> void:
	var fx: ColorRect = el("hurt_fx")
	if left == null:
		if hurt_on:
			fx.visible = false
			el("hurt").visible = false
			hurt_on = false
		return
	var k: float = 1 - left / total
	var m: ShaderMaterial = fx.material
	m.set_shader_parameter("blur", 1.5 + k * 5)
	m.set_shader_parameter("brightness", 0.75 - k * 0.45)
	m.set_shader_parameter("saturate", 0.7 - k * 0.5)
	fx.visible = true
	el("hurt").visible = true
	el("hurt").modulate.a = 0.5 + k * 0.5
	el("hurt-text").text = "You're hit! %s… %ds" % ["Help is on the way" if helped else "Nobody can reach you", ceili(left)]
	hurt_on = true

## Flash the hit marker round the crosshair: white for a hit, red for the killing blow.
var _hm_tween: Tween
func hit_marker(kill: bool) -> void:
	var m: Control = el("hitmarker")
	m.set_meta("kill", kill)
	m.queue_redraw()
	if _hm_tween:
		_hm_tween.kill() # restart the animation
	m.modulate.a = 1.0
	_hm_tween = create_tween()
	if kill: # 0.7 s: 0.7 -> 1.35 -> 1.2 -> 1.5, fading over the last third
		m.scale = Vector2.ONE * 0.7
		_hm_tween.tween_property(m, "scale", Vector2.ONE * 1.35, 0.175)
		_hm_tween.tween_property(m, "scale", Vector2.ONE * 1.2, 0.315)
		_hm_tween.tween_property(m, "scale", Vector2.ONE * 1.5, 0.21)
		_hm_tween.parallel().tween_property(m, "modulate:a", 0.0, 0.21)
	else: # 0.28 s: 0.8 -> 1.15 -> 1.3, fading after the first third
		m.scale = Vector2.ONE * 0.8
		_hm_tween.tween_property(m, "scale", Vector2.ONE * 1.15, 0.084)
		_hm_tween.tween_property(m, "scale", Vector2.ONE * 1.3, 0.196)
		_hm_tween.parallel().tween_property(m, "modulate:a", 0.0, 0.196)

func kill(count: int) -> void:
	el("kills").text = "Kills %d" % count # (the banner announces it)

## War Thunder style banner across the upper middle: kind 'kill' | 'assist' | 'crit', the aircraft
## type, the points. Fades after ~3 s; several stack.
func banner(kind: String, name: String, points: int) -> void:
	var head: String = {kill = "Aircraft destroyed", assist = "Kill assist", crit = "Critical hit"}[kind]
	var re := func(p: String) -> bool: return RegEx.create_from_string(p).search(name) != null
	var badge: String = emblem("bf109") if re.call("109") else emblem("fw190") if re.call("190") else emblem("p47") if re.call("47") else emblem("crew")
	var bid := "bf109" if re.call("109") else "fw190" if re.call("190") else "crew"
	var sz = {kill = [380.0, [9, 22, 9, 16], 26, 30.0, 17], assist = [320.0, [7, 18, 7, 14], 20, 30.0, 17], crit = [270.0, [5, 16, 5, 12], 17, 22.0, 14]}[kind]
	var hc = {kill = [Color("#ffd66e"), Color("#e6cb8a99")], assist = [Color("#a9d6ff"), Color("#9ad0ff88")], crit = [Color("#ffad7a"), Color("#ff9a6a77")]}[kind]
	var pc = {kill = [Color("#f0d488"), Color("#c49a48")], assist = [Color("#cfe6ff"), Color("#86b4e6")], crit = [Color("#ffc8a0"), Color("#e08a58")]}[kind]
	var b := Kit.box({}, sz[1])
	b.min_w = sz[0]
	var sweep := {t = -1.0}
	var bg := _canvas(func(c: Control):
		var w := c.size.x
		var h := c.size.y
		var dark := Color("#0b0c08ee")
		var mid := Color("#14160fee")
		var clear := Color("#0b0c0800")
		var pts := PackedVector2Array([Vector2(0, h / 2), Vector2(14, 0), Vector2(w / 2, 0), Vector2(w - 14, 0), Vector2(w, h / 2), Vector2(w - 14, h), Vector2(w / 2, h), Vector2(14, h)])
		var cols := PackedColorArray([clear, dark.lerp(clear, 0.5), mid, dark.lerp(clear, 0.5), clear, dark.lerp(clear, 0.5), mid, dark.lerp(clear, 0.5)])
		c.draw_polygon(pts, cols)
		c.draw_line(Vector2(14, 0.5), Vector2(w - 14, 0.5), hc[1], 1.0)
		c.draw_line(Vector2(14, h - 0.5), Vector2(w - 14, h - 0.5), hc[1], 1.0)
		if sweep.t >= 0.0 and sweep.t <= 1.0: # (a shine sweeps across it once)
			var x := lerpf(-w * 0.4, w * 1.0, sweep.t)
			c.draw_polygon(PackedVector2Array([Vector2(x, 0), Vector2(x + w * 0.18, 0), Vector2(x + w * 0.18 + h * 0.2, h), Vector2(x + h * 0.2, h)]),
				PackedColorArray([Color("#fff5d800"), Color("#fff5d855"), Color("#fff5d800"), Color("#fff5d800")])))
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	var bgw := _layer()
	bgw.add_child(bg)
	bg.offset_left = -sz[1][3]
	bg.offset_top = -sz[1][0]
	bg.offset_right = sz[1][1]
	bg.offset_bottom = sz[1][2]
	b.add_child(bgw)
	var row := Kit.hbox(14)
	row.add_child(Kit.svg_rect(badge, sz[3] * EMBLEM_ASPECT[bid if bid != "crew" else "crew"], sz[3]))
	var tx := Kit.vbox(3)
	var hl := Kit.label(head, {f = "display", w = 400, s = sz[2], ls = 0.08, up = true, c = hc[0], sh = true})
	tx.add_child(hl)
	tx.add_child(Kit.label(name, {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.cream}))
	row.add_child(tx)
	var sp := Kit.gap()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(sp)
	var pts_b := Kit.box({grad = [[0.0, pc[0]], [1.0, pc[1]]], radius = 2.0, shadow = [0, 12, Color(pc[0], 0.4)]}, [4, 10, 3, 10])
	pts_b.add_child(Kit.label("+%d" % points, {f = "cond", w = 700, s = sz[4], ls = 0.06, c = C.ink}))
	pts_b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(pts_b)
	b.add_child(row)
	var box: Container = el("banners")
	box.add_child(b)
	box.move_child(b, 0)
	while box.get_child_count() > 4:
		var last := box.get_child(box.get_child_count() - 1)
		box.remove_child(last)
		last.queue_free()
	# in: from narrow and faint, springing out (0.32 s); the shine; out after ~2.8 s (crits 1.8)
	b.modulate.a = 0.0
	b.pivot_offset = Vector2(sz[0] / 2, 25)
	b.scale = Vector2(0.4, 0.8)
	var tw := create_tween().set_parallel()
	tw.tween_property(b, "modulate:a", 1.0, 0.32)
	tw.tween_property(b, "scale", Vector2.ONE, 0.32).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	var t2 := create_tween()
	t2.tween_interval(0.12)
	t2.tween_method(func(v): sweep.t = v; bg.queue_redraw(), 0.0, 1.0, 0.9)
	var out := 1.8 if kind == "crit" else 2.8
	var t3 := create_tween()
	t3.tween_interval(out)
	t3.tween_property(b, "modulate:a", 0.0, 0.6)
	t3.parallel().tween_property(b, "scale", Vector2(0.97, 0.97), 0.6)
	t3.tween_callback(func(): if is_instance_valid(b): b.queue_free())

## Your current life on the HUD: kills, assists, hits.
func life_stats(s: Dictionary) -> void:
	var html := "<b>%d</b> kills · <b>%d</b> assists · <b>%d</b> hits" % [s.kills + s.bombers, s.assists, s.hits]
	if html == _last.get("life"):
		return
	_last.life = html
	var box: Container = el("lifestats")
	_clear(box)
	var fl := Kit.flow(html, {f = "ui", w = 500, s = 14, c = C.hud, sh = true}, null, {}, FlowContainer.ALIGNMENT_END)
	for l in fl.find_children("*", "Label", true, false):
		if l.label_settings.font == Kit.font("ui", 700):
			l.label_settings = Kit.settings({f = "ui", w = 700, s = 14, c = Color.WHITE, sh = true})
	box.add_child(fl)

## A life's service record: on the eject / death screens, the parachute view and the debrief. (A card the
## menus draw: menu({body = ui.life_card(...)}), ejected(ui.life_card(...)).)
func life_card(s: Dictionary, title := "This sortie") -> Dictionary:
	return {_card = true, s = s.duplicate(), title = title}

## The service record as drawn. where: "" (a menu), "eject" (the parachute view's corner), "seat" (beside the
## formation plot, two columns), "debrief" (on the report's paper).
func _record(card: Dictionary, where := "") -> Control:
	var s: Dictionary = card.s
	var acc := "%.1f" % ((100.0 * s.hits) / s.fired) if s.fired else "0.0"
	var look := {bg = C.paper, grain = 0.07, vignette = Color("#9a7c4433"), ring = [1.0, Color("#00000055")], shadow = [14, 36, Color("#000000bb")]}
	if where == "debrief":
		look = {bg = C.paper2, ring = [1.0, Color("#261f1555")]}
	var eject := where == "eject"
	var b := Kit.box(look, [10, 12, 8, 12] if eject else [14, 16, 12, 16])
	b.custom_minimum_size.x = 330 if eject else 0
	if where == "":
		b.custom_minimum_size.x = 420
	var col := Kit.vbox(0)
	var head := Kit.hbox(10)
	var hs := Kit.label("Service record", {f = "cond", w = 700, s = 13, ls = 0.14, up = true, c = C.ink2})
	hs.size_flags_vertical = Control.SIZE_SHRINK_END
	head.add_child(hs)
	var sp := Kit.gap()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	head.add_child(Kit.label(card.title, {f = "display", w = 400, s = 19, ls = 0.06, up = true, c = C.ink}))
	col.add_child(head)
	col.add_child(Kit.gap(0, 6))
	col.add_child(Kit.rule(C.ink, 2))
	var grid := GridContainer.new()
	grid.columns = 2 if where == "seat" else 4
	grid.add_theme_constant_override("h_separation", 0)
	grid.add_theme_constant_override("v_separation", 0)
	var bsz := 17 if eject else 22
	var cell := func(k: String, v: String, small: String):
		var c := Kit.box({}, [7, 4, 6, 4])
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var v_ := Kit.vbox(0)
		v_.add_child(Kit.label(k, {f = "cond", w = 700, s = 13, ls = 0.1, up = true, c = C.ink2}))
		var r := Kit.hbox(0)
		r.add_child(Kit.label(v, {f = "ui", w = 600, s = bsz, c = C.ink, lh = 1.2}))
		if small:
			var sm := Kit.label(small, {f = "ui", w = 500, s = 14, c = C.ink2})
			sm.size_flags_vertical = Control.SIZE_SHRINK_END
			r.add_child(sm)
		v_.add_child(r)
		c.add_child(v_)
		c.add_child(_dashed_bottom(Color("#261f1545")))
		grid.add_child(c)
	cell.call("Kills", str(s.kills), "")
	if s.get("role") == "bf109" or s.get("role") == "fw190":
		cell.call("B-17s", str(s.bombers), "")
	cell.call("Assists", str(s.assists), "")
	cell.call("Crits", str(s.crits), "")
	cell.call("Hits", str(s.hits), " / %d" % s.fired)
	cell.call("Accuracy", acc, "%")
	cell.call("Damage", str(s.damage), "")
	cell.call("Time alive", mmss(s.time), "")
	col.add_child(grid)
	col.add_child(Kit.gap(0, 10))
	var score := Kit.box({bg = C.ink}, [6, 12, 6, 12])
	var sr := Kit.hbox(0)
	var sl := Kit.label("Score", {f = "cond", w = 700, s = 14, ls = 0.18, up = true, c = C.paper})
	sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sr.add_child(sl)
	var sp2 := Kit.gap()
	sp2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sr.add_child(sp2)
	sr.add_child(Kit.label(Kit.num(s.points), {f = "ui", w = 600, s = 20 if eject else 28, c = Color("#f4d48a"), lh = 1.1}))
	score.add_child(sr)
	col.add_child(score)
	b.add_child(col)
	return b

## The parachute view: the life card in a corner, and when you can go again.
func ejected(card, ready := false) -> void:
	var box: Container = el("ejectcard")
	box.visible = card != null
	if card != null and str(card) != _last.get("card"):
		_last.card = str(card)
		_clear(box)
		box.add_child(_record(card, "eject"))
	hint(("Click to fly again" if ready else "Bailed out · click to skip") if card != null else "")

## Something that happened (a crew call, a phase of the mission, a collision): kept for the mission
## map (M) rather than popped up, so the only pop-ups in play are kills, assists, crits and your death.
func log(text: String) -> void:
	if hear.is_valid() and hear.call(text):
		return # (said aloud on the intercom instead: main.js's wrapper of ui.log)
	log_raw(text)

## log() without the radio's say first (main.js handed the radio the unwrapped ui.log: this).
func log_raw(text: String) -> void:
	events.append({text = text, t = _now()})
	if events.size() > 6:
		events.pop_front()

## The mission map, held open with M: a 1943 briefing map of the route out from England to the target
## town, the initial point, the flak belt, the rally, the bomber stream (you in yellow), fighters near
## you, and the town itself in a corner. `d` = Mission.map_data plus where everyone is; null closes it.
func mission_map(d) -> void:
	var box: Control = el("mmap")
	box.visible = d != null
	if d == null:
		return
	var cv: Control = el("mmap-canvas")
	if not cv.draw.is_connected(_draw_mission_map):
		cv.draw.connect(_draw_mission_map)
	cv.set_meta("d", d)
	cv.queue_redraw()
	var side: Container = el("mmap-side")
	_clear(side)
	var ink := Color("#261f15")
	var col := Kit.vbox(0)
	col.add_child(Kit.label(d.phase, {f = "cond", w = 700, s = 20, ls = 0.06, up = true, c = ink}))
	col.add_child(Kit.gap(0, 6))
	var st := {f = "ui", w = 500, s = 15, c = ink, lh = 1.45}
	var tt = d.get("toTarget")
	col.add_child(Kit.flow("Target in <b>%s</b>" % mmss(tt) if tt != null else "Target behind us", st, null, {}, FlowContainer.ALIGNMENT_BEGIN))
	col.add_child(Kit.flow("Town wrecked: <b>%d%%</b> (%d buildings)" % [roundi((float(d.wrecked) / d.buildings) * 100), d.wrecked], st, null, {}, FlowContainer.ALIGNMENT_BEGIN))
	var key := HFlowContainer.new()
	for k in [[Color("#e8b400"), "You"], [Color("#2d3a55"), "B-17s"], [Color("#1d5fc0"), "P-47s"], [Color("#c0281c"), "Luftwaffe"]]:
		var kc: Color = k[0]
		var sw := _canvas(func(c: Control):
			c.draw_rect(Rect2(0.5, c.size.y / 2 - 4, 9, 9), kc)
			c.draw_rect(Rect2(0.5, c.size.y / 2 - 4, 9, 9), Color("#3b2f22"), false, 1.0), 13, 20)
		key.add_child(sw)
		key.add_child(Kit.label(k[1] + "  ", st))
	col.add_child(key)
	col.add_child(Kit.gap(0, 10))
	col.add_child(Kit.label("Log", {f = "ui", w = 700, s = 15, c = ink}))
	col.add_child(Kit.rule(Color("#3b2f2255")))
	col.add_child(Kit.gap(0, 2))
	var now := _now()
	if events.is_empty():
		col.add_child(Kit.label("Nothing yet", {f = "ui", w = 500, s = 14, c = ink, wrap = true}))
	for i in range(events.size() - 1, -1, -1):
		var e: Dictionary = events[i]
		col.add_child(Kit.label("%s ago · %s" % [mmss((now - e.t) / 1000.0), e.text], {f = "ui", w = 500, s = 14, c = ink, lh = 1.45, wrap = true}))
	col.add_child(Kit.gap(0, 10))
	var hold := Kit.label("Let go of M to close", {f = "ui", w = 500, s = 14, c = ink})
	hold.modulate.a = 0.75
	col.add_child(hold)
	side.add_child(col)

func _draw_mission_map() -> void:
	var cv: Control = el("mmap-canvas")
	var d = cv.get_meta("d")
	var W := 720.0
	# the whole route on it, the turn for home and all (north up: the way we fly in is up the map)
	var x0 := -3500.0
	var x1 := 3500.0
	var z0 := INF
	var z1 := -INF
	for p in d.route:
		x0 = minf(x0, p[0]); x1 = maxf(x1, p[0])
		z0 = minf(z0, p[1]); z1 = maxf(z1, p[1])
	z0 -= 1500
	z1 += 1500
	var span := maxf(x1 - x0, z1 - z0) + 2000
	var sc := (W - 60) / span
	var cx := (x0 + x1) / 2
	var cz := (z0 + z1) / 2
	var P := func(p) -> Vector2: return Vector2(W / 2 + (p[0] - cx) * sc, W / 2 + 10 + (p[1] - cz) * sc)
	var INK := Color("#3b2f22")
	var RED := Color("#a3271c")
	cv.draw_rect(Rect2(0, 0, W, W), Color("#e8dcbc"))
	var k := floorf((cz - span) / 5000) * 5000 # the grid, 5 km squares
	while k < cz + span:
		var y: float = P.call([0, k]).y
		cv.draw_line(Vector2(0, y), Vector2(W, y), Color("#cdbf9a"), 1.0)
		k += 5000
	k = floorf((cx - span) / 5000) * 5000
	while k < cx + span:
		var x: float = P.call([k, 0]).x
		cv.draw_line(Vector2(x, 0), Vector2(x, W), Color("#cdbf9a"), 1.0)
		k += 5000
	var mono := Kit.font("courier", 400)
	var label := func(t: String, p: Vector2, c: Color, dx: float):
		_txt(cv, mono, 13, t, p.x + dx, p.y, c, "left", "middle")
	# the flak belt, hatched
	var fy0: float = P.call([0, d.flak[0]]).y
	var fy1: float = P.call([0, d.flak[1]]).y
	var fx := 3500 * sc
	var fc: float = P.call([0, 0]).x # (round the target)
	var fr := Rect2(fc - fx, fy1, fx * 2, fy0 - fy1)
	var hh := fy0 - fy1
	var kk := -W
	while kk < W * 2: # (each hatch line clipped to the belt)
		var a := Vector2(kk, fy1)
		var b := Vector2(kk + hh, fy0)
		if b.x > fr.position.x and a.x < fr.end.x:
			var t0 := clampf((fr.position.x - a.x) / hh, 0, 1)
			var t1 := clampf((fr.end.x - a.x) / hh, 0, 1)
			cv.draw_line(a.lerp(b, t0), a.lerp(b, t1), Color("#8f8070"), 1.0)
		kk += 9
	for e in [[fr.position, Vector2(fr.end.x, fr.position.y)], [Vector2(fr.end.x, fr.position.y), fr.end], [fr.end, Vector2(fr.position.x, fr.end.y)], [Vector2(fr.position.x, fr.end.y), fr.position]]:
		cv.draw_dashed_line(e[0], e[1], Color("#6d5f50"), 1.0, 3.5)
	label.call("FLAK", Vector2(fc - fx, (fy0 + fy1) / 2), Color("#5d5045"), -44)
	# the route: in from the coast, the initial point, the target, the rally and home
	var pts := PackedVector2Array()
	for p in d.route:
		pts.append(P.call(p))
	cv.draw_polyline(pts, RED, 3.0, true)
	for n in [["FROM ENGLAND", [0, d.start]], ["I.P.", [0, d.ip]], ["RALLY", d.rally], ["HOME", d.home]]:
		var p: Vector2 = P.call(n[1])
		cv.draw_circle(p, 5, RED)
		label.call(n[0], p + Vector2(0, 14) if n[0] == "RALLY" else p, RED, -66 if n[0] == "RALLY" else 12) # (the rally's just past the target: its name below-left, clear of TARGET)
	# the turn's arrow: which way round it goes
	var kn: int = floori(d.route.size() / 2.0)
	var a2: Vector2 = P.call(d.route[kn - 1])
	var b2: Vector2 = P.call(d.route[kn + 1])
	var ang := atan2(b2.y - a2.y, b2.x - a2.x)
	var m: Vector2 = P.call(d.route[kn])
	cv.draw_colored_polygon(PackedVector2Array([m + Vector2(cos(ang), sin(ang)) * 9, m + Vector2(cos(ang + 2.5), sin(ang + 2.5)) * 8, m + Vector2(cos(ang - 2.5), sin(ang - 2.5)) * 8]), RED)
	# the target town: a ringed square
	var t: Vector2 = P.call([0, 0])
	var half: float = (d.city.size / 2) * sc
	cv.draw_rect(Rect2(t.x - half, t.y - half, half * 2, half * 2), Color("#9b8f7a"))
	for r in [10, 18]:
		cv.draw_arc(t, r, 0, TAU, 48, RED, 2.0, true)
	label.call("TARGET", t, RED, 24)
	# the bomber stream, fighters near you, and you
	for b in d.bombers:
		var p: Vector2 = P.call(b)
		cv.draw_rect(Rect2(p.x - 1.5, p.y - 1.5, 3, 3), Color("#2d3a55"))
	for f in d.fighters:
		cv.draw_circle(P.call(f.at), 2.2, Color("#c0281c") if f.side == "axis" else Color("#1d5fc0"))
	if d.get("self"):
		var p: Vector2 = P.call(d.self)
		var tri := PackedVector2Array([p + Vector2(0, -8), p + Vector2(6, 6), p + Vector2(-6, 6)])
		cv.draw_colored_polygon(tri, Color("#e8b400"))
		tri.append(tri[0])
		cv.draw_polyline(tri, INK, 1.5, true)
		label.call("YOU", p, INK, 10)
	town_inset(cv, d, W)
	cv.draw_rect(Rect2(1, 1, W - 2, W - 2), INK, false, 2.0)
	_txt(cv, Kit.font("courier", 700), 15, "MISSION MAP  ·  SECRET", 14, 18, INK, "left", "middle")

## The target town, enlarged in the map's corner: the works, the rail yard, the river, the old town.
func town_inset(g: CanvasItem, d, W: float) -> void:
	var c = d.city
	var S := 210.0
	var x0 := W - S - 14
	var y0 := W - S - 14
	var k: float = S / c.size
	var P := func(x: float, z: float) -> Vector2: return Vector2(x0 + (x + c.size / 2) * k, y0 + (z + c.size / 2) * k)
	g.draw_rect(Rect2(x0, y0, S, S), Color("#ddd0ad"))
	var rp: Vector2 = P.call(-c.size / 2, c.rail.z0)
	g.draw_rect(Rect2(rp.x, rp.y, S, (c.rail.z1 - c.rail.z0) * k), Color("#b5a88c"))
	g.draw_circle(P.call(c.oldTown.x, c.oldTown.z), c.oldTown.r * k, Color("#a3967c"))
	var river := PackedVector2Array()
	var x: float = -c.size / 2
	while x <= c.size / 2:
		river.append(P.call(x, c.riverZ.call(x)))
		x += 40
	g.draw_polyline(river, Color("#6f8a99"), c.riverW * k, true)
	var f = c.factory
	var fp: Vector2 = P.call(f.x0, f.z0)
	g.draw_rect(Rect2(fp.x, fp.y, (f.x1 - f.x0) * k, (f.z1 - f.z0) * k), Color("#8d3a2c"))
	var a: Vector2 = P.call(0, 0)
	g.draw_arc(a, 8, 0, TAU, 32, Color("#a3271c"), 1.5, true)
	g.draw_line(a - Vector2(12, 0), a + Vector2(12, 0), Color("#a3271c"), 1.5)
	g.draw_line(a - Vector2(0, 12), a + Vector2(0, 12), Color("#a3271c"), 1.5)
	var mono := Kit.font("courier", 400)
	var ink := Color("#3b2f22")
	_txt(g, mono, 11, "AIMING POINT: BALL-BEARING WORKS", x0 + 6, y0 + 12, ink)
	var ot: Vector2 = P.call(c.oldTown.x - 120, c.oldTown.z)
	_txt(g, mono, 11, "OLD TOWN", ot.x, ot.y, ink)
	var ry: Vector2 = P.call(-1100, c.rail.z1 + 60)
	_txt(g, mono, 11, "RAIL YARD", ry.x, ry.y, ink)
	g.draw_rect(Rect2(x0, y0, S, S), ink, false, 1.0)

## Short pop-up message (only for your own death now).
func toast(text: String, kind := "") -> void:
	var t := Kit.box({bg = Color("#0b0d10c8"), radius = 3.0}, [6, 16, 6, 16])
	t.add_child(Kit.label(text, {f = "ui", w = 600, s = 18, ls = 1.0 / 18.0, c = Color("#ffb36a") if kind == "kill" else C.hud, sh = true}))
	el("toasts").add_child(t)
	var tw := create_tween()
	tw.tween_interval(2.6)
	tw.tween_property(t, "modulate:a", 0.0, 0.5)
	tw.tween_interval(0.1)
	tw.tween_callback(t.queue_free)

var _sound_flip: Callable
## The sound controls: a mute button and a volume line on every menu's top bar and in the settings (kept
## in step), and the mix in the settings (guns, engines, battle, crew), all remembered between games.
## on_change(volume 0..1, muted, mix) is called now and whenever they change. N mutes too.
func sound(on_change: Callable) -> void:
	var st := {vol = 1.0, muted = false, mix = {guns = 1.0, engines = 1.0, battle = 1.0, crew = 1.0, ui = 0.8}}
	var saved = JSON.parse_string(str(Store.get_item("bomber.sound"))) if Store.get_item("bomber.sound") != null else null
	if saved is Dictionary: # (else: defaults)
		st.vol = float(saved.get("vol", 1.0))
		st.muted = bool(saved.get("muted", false))
		st.mix.merge(saved.get("mix", {}), true)
	var sets := [["snd-mute", "snd-vol", "snd-val"], ["snd-mute-top", "snd-vol-top", "snd-val-top"]].map(func(ids): return ids.map(func(i): return el(i)))
	var apply := func():
		var off: bool = st.muted or st.vol == 0
		for s in sets:
			var tex := Kit.svg(icon("muted" if off else "sound", Color("#ff8a6a") if off else C.cream), 20, 20)
			s[0].get_meta("icon").texture = tex
			s[1].set_value_no_signal(roundi(st.vol * 100))
			s[2].text = "off" if st.muted else "%d%%" % roundi(st.vol * 100)
		for k in _e.mixers:
			_e.mixers[k][0].set_value_no_signal(roundi(st.mix[k] * 100))
			_e.mixers[k][1].text = "%d%%" % roundi(st.mix[k] * 100)
		Store.set_item("bomber.sound", JSON.stringify({vol = st.vol, muted = st.muted, mix = st.mix}))
		on_change.call(st.vol, st.muted, st.mix.duplicate())
	for s in sets:
		s[0].pressed.connect(func(): st.muted = not st.muted; apply.call())
		var slider: HSlider = s[1]
		slider.value_changed.connect(func(v): st.vol = v / 100.0; st.muted = st.muted and st.vol <= 0; apply.call())
	for k in _e.mixers:
		var key: String = k
		_e.mixers[k][0].value_changed.connect(func(v): st.mix[key] = v / 100.0; apply.call())
	_sound_flip = func():
		st.muted = not st.muted
		apply.call()
		if el("hud").visible:
			toast("Sound off (N)" if st.muted else "Sound on (N)")
	apply.call()

## Full screen: the buttons on the menus and in the settings, and Alt+Enter; kept in step when the window leaves it itself.
func fullscreen() -> void:
	for b in _fs_buttons():
		if not b.pressed.is_connected(_toggle_fullscreen):
			b.pressed.connect(_toggle_fullscreen)
	_show_fs()
	get_viewport().size_changed.connect(_show_fs)

func _fs_buttons() -> Array:
	return root.find_children("*", "Container", true, false).filter(func(c): return c.has_meta("fs"))

static func _is_fullscreen() -> bool:
	var m := DisplayServer.window_get_mode()
	return m == DisplayServer.WINDOW_MODE_FULLSCREEN or m == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN

func _toggle_fullscreen() -> void:
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if _is_fullscreen() else DisplayServer.WINDOW_MODE_FULLSCREEN)
	_show_fs()

func _show_fs() -> void:
	for b in _fs_buttons():
		b.get_meta("label").text = "Exit full screen" if _is_fullscreen() else "Full screen"

## The time of day, season and weather selects: env is changed in place, on_change(env, 'settings') on every change.
func env_controls(env: Dictionary, on_change: Callable) -> void:
	env_selects = func():
		for k in _e.env_selects:
			_select_set(_e.env_selects[k], env[k])
	for k in _e.env_selects:
		var key: String = k
		var o: OptionButton = _e.env_selects[k]
		o.item_selected.connect(func(_i): env[key] = _select_value(o); on_change.call(env, "settings"))
	env_selects.call()

## The start menu's mission conditions panel (in the card on the start menu only).
func _build_conditions() -> Control:
	var wrap := MarginContainer.new()
	wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var b := Kit.box({grad = [[0.0, Color("#22261ae6")], [1.0, Color("#14160fe6")]], radius = 4.0, ring = [1.0, Color("#c9a55a99")], ring2 = [1.0, Color("#c9a55a33"), 4.0], shadow = [6, 18, Color("#00000088")]}, [18, 22, 14, 22])
	wrap.add_child(b)
	var row := Kit.hbox(16, BoxContainer.ALIGNMENT_CENTER)
	b.add_child(row)
	var seg := Kit.box({border = [1, 1, 1, 1], border_color = Color("#c9a55a66"), radius = 3.0}, 1.0)
	var sr := Kit.hbox(0)
	seg.add_child(sr)
	_e.seg = {}
	for m in [["default", "Default"], ["choose", "Choose"], ["random", "Random"]]:
		var bt := Kit.box({bg = Color("#0d0f0acc")}, [6, 16, 6, 16], true)
		var l := Kit.label(m[1], {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.cream_dim})
		bt.add_child(l)
		bt.set_meta("label", l)
		if sr.get_child_count():
			sr.add_child(Kit.rule(Color("#c9a55a44"), 1.0, false, true))
		sr.add_child(bt)
		_e.seg[m[0]] = bt
	row.add_child(seg)
	var pick := Kit.hbox(8)
	_e.cond_pick = {}
	for k in ["time", "season", "weather"]:
		var o := _select(Env.ENV_OPTIONS[k], true)
		pick.add_child(o)
		_e.cond_pick[k] = o
	row.add_child(pick)
	_e.cond_pick_row = pick
	var note := Kit.label("", {f = "ui", w = 500, s = 15, c = C.cream})
	row.add_child(note)
	_e.cond_note = note
	# its label sits on the frame's top edge
	var over := _layer()
	var lb := Kit.box({bg = C.night, border = [1, 1, 1, 1], border_color = Color("#c9a55a99"), radius = 3.0}, [2, 12, 2, 12])
	lb.add_child(Kit.label("Mission conditions", {f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.brass2}))
	Kit.pin(lb, 0.5, 0, 0.5, 0.5)
	over.add_child(lb)
	wrap.add_child(over)
	return wrap

## The start menu's Mission conditions: Default (autumn, day, clear), Choose (the three pickers) or Random
## (what this mission rolled). on_mode(mode) when the mode changes, on_pick(key, value) when Choose's pickers do.
func conditions(mode: String, env: Dictionary, on_mode: Callable, on_pick: Callable) -> void:
	var st := {mode = mode}
	var show := func():
		for m in _e.seg:
			var on: bool = m == st.mode
			var bt: Container = _e.seg[m]
			bt.set_look({grad = [[0.0, Color("#66713f")], [1.0, Color("#4b5530")]]} if on else {bg = Color("#0d0f0acc")})
			bt.get_meta("label").label_settings = Kit.settings({f = "cond", w = 600, s = 13, ls = 0.16, up = true, c = C.cream if on else C.cream_dim})
		for k in _e.cond_pick:
			_select_set(_e.cond_pick[k], env[k])
		_e.cond_pick_row.visible = st.mode == "choose"
		_e.cond_note.visible = st.mode != "choose"
		_e.cond_note.text = "This mission: %s" % Env.env_label(env) if st.mode == "random" else "Summer · Day · Clear" if st.mode == "default" else ""
		if env_selects.is_valid():
			env_selects.call()
	for m in _e.seg:
		var id: String = m
		_e.seg[m].pressed.connect(func(): st.mode = id; on_mode.call(id); show.call())
	for k in _e.cond_pick:
		var key: String = k
		var o: OptionButton = _e.cond_pick[k]
		o.item_selected.connect(func(_i): on_pick.call(key, _select_value(o)); show.call())
	show_conditions = func(m):
		if m:
			st.mode = m
		show.call()
	show.call()

## The Options switches (markers, distances, lead): remembered between games; on_change(opts) now and on every change.
func hud_options(on_change: Callable) -> void:
	var o := {enemy = false, friend = false, distance = false, lead = true, plainSight = false, third = false, infinite = false, historical = false, v = 2}
	var saved = JSON.parse_string(str(Store.get_item("bomber.hud"))) if Store.get_item("bomber.hud") != null else null
	if saved is Dictionary and int(saved.get("v", 0)) == 2: # (else: defaults)
		o.merge(saved, true)
	o.third = false # (every game starts in the cockpit: V switches)
	var boxes: Dictionary = _e.hud_boxes
	var show := func():
		for k in boxes:
			boxes[k][1].set_meta("on", bool(o[k]))
			boxes[k][1].queue_redraw()
	for k in boxes:
		var key: String = k
		boxes[k][0].pressed.connect(func():
			o[key] = not o[key]
			show.call()
			Store.set_item("bomber.hud", JSON.stringify(o))
			on_change.call(o.duplicate()))
	show.call()
	on_change.call(o.duplicate())
	## Flip one option from the game (V: the view), kept in step with its box and remembered.
	toggle_hud = func(k: String) -> bool:
		o[k] = not o[k]
		show.call()
		Store.set_item("bomber.hud", JSON.stringify(o))
		on_change.call(o.duplicate())
		return o[k]

func hint(text: String) -> void:
	var h: Container = el("hint")
	h.get_meta("label").text = text
	h.get_meta("label").custom_minimum_size.x = 0
	var w: float = h.get_meta("label").label_settings.font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 15).x
	if w > 600: # (max-width: 70ch)
		h.get_meta("label").autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		h.get_meta("label").custom_minimum_size.x = 600
	h.visible = text != ""

## The controls for where you are, in a small card at the side: shown for a few seconds whenever that
## changes (a new station, walking again), then folded to a tag. H opens or folds it.
func controls(rows: Array, key) -> void:
	var box: VBoxContainer = el("controls")
	if key != _ctl_key:
		_ctl_key = key
		_clear(box)
		var tag := Kit.hbox(4, BoxContainer.ALIGNMENT_END)
		tag.add_child(Kit.keycap("H", "ctl"))
		tag.add_child(Kit.label("controls", {f = "ui", w = 500, s = 14.5, c = C.hud, sh = true}))
		tag.modulate.a = 0.55
		box.add_child(tag)
		var rb := Kit.box({bg = Color("#00000088"), border = [1, 1, 1, 1], border_color = Color("#ece8dc33"), radius = 4.0}, [6, 10, 6, 10])
		var rc := Kit.vbox(0)
		for r in rows:
			var row := Kit.hbox(10)
			row.custom_minimum_size.y = 25
			var keys := Kit.hbox(4)
			for k in r[0].split(" / "):
				keys.add_child(Kit.keycap(k, "ctl"))
			row.add_child(keys)
			var w := Kit.label(r[1], {f = "ui", w = 500, s = 14.5, c = C.hud, sh = true, align = HORIZONTAL_ALIGNMENT_RIGHT})
			w.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(w)
			rc.add_child(row)
		rb.add_child(rc)
		rb.modulate.a = 0.0
		rb.visible = false
		box.add_child(rb)
		ctl_open_until = _now() + 6000
	var open: bool = ctl_pinned if ctl_pinned != null else _now() < ctl_open_until
	if box.get_child_count() == 2:
		var rb: Control = box.get_child(1)
		if open != box.get_meta("open", false):
			box.set_meta("open", open)
			box.get_child(0).modulate.a = 0.85 if open else 0.55
			if open:
				rb.visible = true
				_tween(rb, "modulate:a", 1.0, 0.5)
			else:
				var tw := _tween(rb, "modulate:a", 0.0, 0.5)
				tw.tween_callback(func(): rb.visible = box.get_meta("open", false))
	box.visible = rows.size() > 0

## The first time somewhere (walking, a gun, the pilot's seat, the sight, a fighter, bailing out): its main
## keys, big and low in the middle, for a few seconds. Once each, remembered (so a player back for another
## go isn't told again). title: what this is; keys: [[key, what]].
var _tip_tween: Tween
func tip(id: String, title: String, keys: Array) -> void:
	var seen = JSON.parse_string(str(Store.get_item("bt-tips"))) if Store.get_item("bt-tips") != null else []
	if not seen is Array:
		seen = []
	if tips_shown.has(id) or id in seen:
		return
	tips_shown[id] = true
	Store.set_item("bt-tips", JSON.stringify(seen + [id]))
	var box: Container = el("tip")
	_clear(box)
	var col := Kit.vbox(0, BoxContainer.ALIGNMENT_CENTER)
	col.add_child(Kit.label(title, {f = "cond", w = 700, s = 12.5, ls = 0.12, up = true, c = Color("#e0b25a"), lh = 1.4, align = HORIZONTAL_ALIGNMENT_CENTER}))
	var fl := HFlowContainer.new()
	fl.alignment = FlowContainer.ALIGNMENT_CENTER
	fl.add_theme_constant_override("h_separation", 18)
	fl.custom_minimum_size.x = 0
	for k in keys:
		var s := Kit.hbox(0)
		s.custom_minimum_size.y = 33 # (line-height: 2)
		for x in k[0].split(" / "):
			s.add_child(Kit.keycap(x, "tip"))
			s.add_child(Kit.gap(5))
		s.add_child(Kit.label(k[1], {f = "ui", w = 500, s = 16.5, c = C.hud}))
		fl.add_child(s)
	col.add_child(fl)
	box.add_child(col)
	# (max-width: min(92vw, 860px))
	var w := 0.0
	for s in fl.get_children():
		w += s.get_combined_minimum_size().x + 18
	fl.custom_minimum_size.x = minf(860 - 32, w)
	if _tip_tween:
		_tip_tween.kill()
	_tip_tween = create_tween()
	_tip_tween.tween_property(box, "modulate:a", 1.0, 0.5)
	_tip_tween.tween_interval(9.0 - 0.5)
	_tip_tween.tween_property(box, "modulate:a", 0.0, 0.5)

## The fighter's lock-on brackets at screen point [x, y] (px), with the range in m; null hides them.
func lock(at, range := 0.0) -> void:
	var c: Control = el("lock")
	if at == null:
		c.visible = false
		return
	c.visible = true
	c.position = Vector2(at[0], at[1]) - Vector2(27, 27)
	var t := "LOCKED · %d m" % (roundi(range / 10) * 10)
	if c.get_meta("label").text != t:
		c.get_meta("label").text = t

## H: open the controls card for good, or fold it away.
func toggle_controls() -> void:
	ctl_pinned = not (ctl_pinned if ctl_pinned != null else _now() < ctl_open_until)

func hud(o: Dictionary) -> void:
	var cross: Control = el("crosshair")
	# (a reflector sight in view: its reticle is the aim) // (free-looking: the guns aren't where you look)
	cross.modulate.a = 0.0 if o.get("reflector", false) else 0.25 if o.get("looking", false) else 1.0
	var location: String = o.get("location", "")
	if location != _last.get("loc"):
		_last.loc = location
		el("location").text = location
	var prompt: String = o.get("prompt", "")
	if prompt != _last.get("prompt"):
		_last.prompt = prompt
		var p: Container = el("prompt")
		_clear(p)
		if prompt:
			p.add_child(Kit.flow(prompt, {f = "ui", w = 600, s = 18, c = C.hud, sh = true}, "prompt", {dim = {alpha = 0.75, s = 15, cap_s = 15}}))
		_tween(p, "modulate:a", 1.0 if prompt else 0.0, 0.15)
	var gun_: bool = o.get("atStation", false)
	if gun_ != cross.get_meta("gun", false):
		cross.set_meta("gun", gun_)
		_apply_mode()

func tick(dt: float) -> void:
	frames += 1
	fps_time += dt
	if fps_time >= 0.5:
		if show_fps:
			el("fps").text = "%d fps" % roundi(frames / fps_time)
		frames = 0
		fps_time = 0.0

# ---------- the "can't use your graphics card" page (main.js's noGraphics) ----------

## Why the graphics can't run the game, or "" if they can: a software renderer standing in for the card
## (main.js looked for SwiftShader / llvmpipe / Basic Render in the WebGL renderer's name).
static func graphics_problem() -> String:
	var name := RenderingServer.get_video_adapter_name()
	if RegEx.create_from_string("(?i)swiftshader|llvmpipe|basic render|software").search(name):
		return ("Chrome has switched off graphics acceleration (it does after its graphics have crashed)." if OS.has_feature("web")
			else "The game is running on the processor's software graphics (%s), not the graphics card." % name)
	return ""

## The page that says so, over everything: what's wrong and what to do about it.
static func no_graphics(parent: Node, why: String) -> Control:
	var d := ColorRect.new()
	d.color = Color("#16181b")
	d.set_anchors_preset(Control.PRESET_FULL_RECT)
	d.z_index = 4096
	var c := CenterContainer.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	d.add_child(c)
	var col := Kit.vbox(0)
	col.custom_minimum_size.x = 560
	var st := {f = "sys", w = 400, s = 16, c = Color("#e9e3d2"), lh = 1.5, wrap = true}
	col.add_child(Kit.label("The game can't use your graphics card", {f = "sys", w = 700, s = 24, c = Color("#e9e3d2")}))
	col.add_child(Kit.gap(0, 12))
	col.add_child(Kit.label("%s Black Thursday needs it to run." % why, st))
	col.add_child(Kit.gap(0, 16))
	if OS.has_feature("web"):
		col.add_child(Kit.flow("<b>Close every Chrome window</b> (and check Chrome isn't still running by the clock, bottom right), then open it again and reload this page.", st, null, {}, FlowContainer.ALIGNMENT_BEGIN))
		col.add_child(Kit.gap(0, 16))
		col.add_child(Kit.label("If it still happens: Chrome's Settings → System → turn on Use graphics acceleration when available, and relaunch.", st))
	else:
		col.add_child(Kit.flow("<b>Update your graphics card's driver</b> (from NVIDIA, AMD or Intel), restart the computer and start the game again.", st, null, {}, FlowContainer.ALIGNMENT_BEGIN))
		col.add_child(Kit.gap(0, 16))
		col.add_child(Kit.label("On a laptop with two graphics chips: set the game to use the high-performance one (Windows Settings → System → Display → Graphics).", st))
	for l in col.find_children("*", "Label", true, false):
		if l.label_settings.font == Kit.font("ui", 700):
			l.label_settings = Kit.settings({f = "sys", w = 700, s = 16, c = Color("#e9e3d2"), lh = 1.5})
	c.add_child(col)
	var layer := CanvasLayer.new()
	layer.layer = 100
	layer.add_child(d)
	parent.add_child(layer)
	return d
