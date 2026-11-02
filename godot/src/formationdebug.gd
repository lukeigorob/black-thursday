extends Node
# A developer's look at the formation (--debug=formation on the command line, ?debug=formation in a web build;
# never shown otherwise): every bomber's slot and who it keeps station on, how far each is out of its slot,
# the force's numbers by division, wing and group, and cameras framing the whole force, a division, a combat
# wing, a group, a squadron, or one B-17 and its neighbours. Keys (only in this mode): , and . change the view,
# [ and ] change which bomber the view is built round, \ hides the overlay.
# (A Node, where the web game's class listened on the window: it's added to the scene for its keys.)

const Args := preload("res://src/core/args.gd")
const Oob := preload("res://src/oob.gd")

static var formation_debug_on: bool = Args.param("debug") == "formation"
const VIEWS := ["normal", "force", "division", "wing", "group", "squadron", "neighbours"]

var camera: Camera3D
var bombers: Array
var view := 0
var sel := 0
var shown := true
var slot_pts: MeshInstance3D
var links: MeshInstance3D
var box: Label
var t := 0.0

func _init(scene: Node, camera_: Camera3D, bombers_: Array) -> void:
	camera = camera_
	bombers = bombers_
	name = "FormationDebug"
	# the slots (small points) and a line from each bomber to the one it keeps station on
	slot_pts = _overlay(Color.hex(0x44ff66ff), 1.0, true)
	links = _overlay(Color.hex(0xffcc33ff), 0.7, false)
	scene.add_child(slot_pts)
	scene.add_child(links)
	var layer := CanvasLayer.new()
	layer.layer = 30
	box = Label.new()
	box.position = Vector2(12, 12)
	box.add_theme_font_size_override("font_size", 12)
	box.add_theme_color_override("font_color", Color("#d8ffd0"))
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.8)
	bg.border_color = Color("#44ff44")
	bg.set_border_width_all(1)
	bg.set_content_margin_all(8)
	box.add_theme_stylebox_override("normal", bg)
	var mono := SystemFont.new()
	mono.font_names = PackedStringArray(["Consolas", "monospace"])
	box.add_theme_font_override("font", mono)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(box)
	add_child(layer)
	scene.add_child(self)

static func _overlay(c: Color, opacity: float, points: bool) -> MeshInstance3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(c, opacity)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if opacity < 1 else BaseMaterial3D.TRANSPARENCY_DISABLED
	m.no_depth_test = true
	m.disable_fog = true
	m.render_priority = 10
	if points:
		m.use_point_size = true
		m.point_size = 6
	var mi := MeshInstance3D.new()
	mi.mesh = ArrayMesh.new()
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	mi.set_meta("points", points)
	return mi

func _unhandled_key_input(e: InputEvent) -> void:
	if not (e is InputEventKey) or not e.pressed or e.echo:
		return
	match e.keycode:
		KEY_PERIOD: view = (view + 1) % VIEWS.size()
		KEY_COMMA: view = (view + VIEWS.size() - 1) % VIEWS.size()
		KEY_BRACKETRIGHT: sel = (sel + 1) % bombers.size()
		KEY_BRACKETLEFT: sel = (sel + bombers.size() - 1) % bombers.size()
		KEY_BACKSLASH: shown = not shown

## The bomber b keeps station on: its element's lead, else its squadron's, else its group's (null: it leads the group).
func leader_of(b):
	var u = b.unit
	if not u or b.lead:
		return null
	var same := func(x): return not x.down and not x.gone and x.squad == b.squad and x != b
	for x in bombers:
		if same.call(x) and x.unit and x.unit.squadron == u.squadron and x.unit.element == u.element and x.unit.wingman == 0 and u.wingman != 0:
			return x
	for x in bombers:
		if same.call(x) and x.unit and x.unit.squadron == u.squadron and x.unit.element == 0 and x.unit.wingman == 0:
			return x
	for x in bombers:
		if same.call(x) and x.lead:
			return x
	return null

## The bombers a view frames, round the selected one.
func members(v: String) -> Array:
	var s = bombers[sel]
	var u = s.unit if s.unit else {}
	var live := bombers.filter(func(b): return not b.gone)
	if v == "force":
		return live
	if v == "division":
		return live.filter(func(b): return b.unit and b.unit.division == u.get("division"))
	if v == "wing":
		return live.filter(func(b): return b.unit and b.unit.wing == u.get("wing"))
	if v == "group":
		return live.filter(func(b): return b.squad == s.squad)
	if v == "squadron":
		return live.filter(func(b): return b.squad == s.squad and b.unit and b.unit.squadron == u.get("squadron"))
	return live.filter(func(b): return b.group.position.distance_to(s.group.position) < 160)

func update(dt: float) -> void:
	var pts := PackedVector3Array()
	var ln := PackedVector3Array()
	for b in bombers:
		pts.append(b.home)
		var l = null if b.down or b.gone else leader_of(b)
		ln.append(b.group.position)
		ln.append((l if l else b).group.position)
	for pair in [[slot_pts, pts, Mesh.PRIMITIVE_POINTS], [links, ln, Mesh.PRIMITIVE_LINES]]:
		var am: ArrayMesh = pair[0].mesh
		am.clear_surfaces()
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = pair[1]
		am.add_surface_from_arrays(pair[2], arrays)
	slot_pts.visible = shown
	links.visible = shown
	box.visible = shown
	t -= dt
	if t > 0:
		return
	t = 0.5
	box.text = report()

func report() -> String:
	var bs := bombers
	var live := bs.filter(func(b): return not b.down and not b.gone)
	var s = bs[sel]
	var u = s.unit if s.unit else {}
	var count := func(f: Callable) -> int: return live.filter(f).size()
	var groups := {}
	var order := []
	for b in bs:
		var k := "%s CW  %s  %s%s" % [b.unit.wing if b.unit else "?", b.squad, b.unit.group if b.unit else "?", ("-" + b.unit.part) if b.unit and b.unit.part else ""]
		if not groups.has(k):
			groups[k] = {n = 0, up = 0, off = 0}
			order.append(k)
		var g: Dictionary = groups[k]
		g.n += 1
		if not b.down and not b.gone:
			g.up += 1
			if b.straggling:
				g.off += 1
	var err: Array = live.map(func(b): return b.group.position.distance_to(b.home))
	err.sort()
	err.reverse()
	var l = leader_of(s)
	var rel = s.home - l.home if l else null
	var ident = s.ident if s.ident else {}
	var lines := [
		"FORMATION INSPECTION  view: %s (, .)  bomber %d/%d ([ ])  overlay (\\)" % [VIEWS[view], sel + 1, bs.size()],
		"active %d of %d (mission start %d: 1st AD %d, 3rd AD %d)   1st AD up %d   3rd AD up %d   stragglers %d" % [live.size(), bs.size(), Oob.TOTALS.all, Oob.TOTALS["1st"], Oob.TOTALS["3rd"],
			count.call(func(b): return b.unit and b.unit.division == "1st"), count.call(func(b): return b.unit and b.unit.division == "3rd"), count.call(func(b): return b.straggling)],
		"station error: worst %s m, median %s m" % ["%.1f" % err[0] if err.size() else "-", "%.1f" % err[err.size() / 2] if err.size() else "-"],
		"",
		"SELECTED  %s   %s %s  %s" % [s.label, ident.get("serial") if ident.get("serial") else "serial unknown", ("\"%s\"" % ident.nickname) if ident.get("nickname") else "", ident.get("confidence", "")],
		"  slot: %s squadron, element %s, %s%s%s" % [u.get("squadron", "?"), str(u.get("element", "?")), (["lead", "left wing", "right wing"][u.wingman] if u.get("wingman") != null else "?"), "  (GROUP LEAD)" if s.lead else "", "  [group count/place ESTIMATE]" if u.get("estimate") else ""],
		"  altitude %d ft   out of slot %.1f m   %s" % [roundi((7600 + s.group.position.y) * 3.281), s.group.position.distance_to(s.home), "DOWN" if s.down else "STRAGGLING" if s.straggling else "in formation"],
		"  keeps station on: %s" % ("%s (%s)  %d m away, slot offset x %d y %d z %d" % [l.label, l.ident.get("serial", "?") if l.ident else "?", roundi(s.group.position.distance_to(l.group.position)), roundi(rel.x), roundi(rel.y), roundi(rel.z)] if l else "nobody (leads the group)"),
		"",
		"GROUPS (wing, bombing unit, group: up / dispatched, stragglers)",
	]
	for k in order:
		var g: Dictionary = groups[k]
		lines.append("  %s %2d / %2d%s" % [k.rpad(28), g.up, g.n, "  (%d out of the box)" % g.off if g.off else ""])
	lines.append_array([
		"",
		"HISTORY NOTES: counts 1st AD from its dispatch table (VERIFIED/PROBABLE); 3rd AD wing places and the 388th/390th",
		"counts ESTIMATE; spacing: element/vertical PROBABLE, lateral/fore-aft ESTIMATE (oob.js LAYOUT); %s." % ("historical spacing" if Oob.LAYOUT == Oob.HISTORICAL_LAYOUT else "COMPACT spacing (for the game: historically the wings flew 9 km apart and the divisions 30 mi abreast; --spacing=historical)"),
		"FORCE BOX now: %s" % force_box(),
	])
	return "\n".join(lines)

## The size of the force in the air now (the bombers still up): width x height x length, and the closest pair.
func force_box() -> String:
	var up := bombers.filter(func(b): return not b.down and not b.gone)
	var mn := Vector3(1e9, 1e9, 1e9)
	var mx := Vector3(-1e9, -1e9, -1e9)
	for b in up:
		mn = mn.min(b.group.position)
		mx = mx.max(b.group.position)
	var close := INF
	for i in up.size():
		for j in range(i + 1, up.size()):
			close = minf(close, up[i].group.position.distance_to(up[j].group.position))
	return "%d m wide x %d m tall x %d m long, %d bombers, closest pair %.1f m" % [roundi(mx.x - mn.x), roundi(mx.y - mn.y), roundi(mx.z - mn.z), up.size(), close]

## The camera for a framing view (none for 'normal'): over and behind the bombers it frames, far enough to take them all in.
func frame():
	var v: String = VIEWS[view]
	if v == "normal":
		return null
	var list := members(v)
	if not list.size():
		return null
	var b := AABB(list[0].group.position, Vector3.ZERO)
	for x in list:
		b = b.expand(x.group.position)
	var c := b.get_center()
	var r := maxf(150, b.size.length() * 0.5 + 60)
	var d := r / tan(deg_to_rad(camera.fov) / 2) * 0.9
	return {at = c + Vector3(d * 0.35, d * 0.45, d * 0.82), look = c}
