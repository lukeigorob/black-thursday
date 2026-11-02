extends Node
# The menus and the HUD on their own: src/ui.gd driven by a stand-in game (the calls main.js makes of ui.js,
# with the numbers in states.json, the same ones web/harness.js feeds the web game's UI), stepping through every
# menu and HUD state and saving a screenshot of each to --out (the same names as the web harness's #states, for
# comparing side by side). --only=pause,map runs just those. --keys also drives a few with the keyboard and mouse.
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/ui/test_ui.tscn -- --out=<folder>

const UI := preload("res://src/ui.gd")
const Kit := preload("res://ui/kit.gd")
const Store := preload("res://src/core/store.gd")
const Args := preload("res://src/core/args.gd")
const TestKit := preload("res://src/core/test_kit.gd")

## A bomber as the UI reads one (bomber.gd's fields: base, label, squad, the damage...).
class StandInBomber:
	var label := ""
	var squad := 0
	var base := Vector3.ZERO
	var group := {}
	var down := false
	var gone := false
	var burning := false
	var dead_engines := 0
	var damaged := false
	var health := 1.0
	var engines: Array = []
	var tank_fire := {-1: 0, 1: 0}
	var sec_fire := {}
	var lost := {}
	var parts := {}
	var crew := {}
	func damage(n: String) -> float:
		return parts.get(n, 0.0)

var S: Dictionary
var ui
var bombers: Array = []
var mine

func _ready() -> void:
	var bg := TextureRect.new() # the battle behind the menus: a still, as the web harness has
	bg.texture = load("res://loading/formation.jpg")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	add_child(bg)
	S = JSON.parse_string(FileAccess.get_file_as_string("res://tests/ui/states.json"))
	for i in S.bombers.size():
		var d: Dictionary = S.bombers[i]
		var b := StandInBomber.new()
		for k in ["label", "squad", "down", "gone", "burning", "damaged", "health"]:
			b.set(k, d[k])
		b.dead_engines = int(d.deadEngines)
		b.base = Vector3(d.base[0], d.base[1], d.base[2])
		b.group = {position = b.base}
		b.crew = {members = d.crew}
		bombers.append(b)
	mine = bombers[int(S.mine)]
	print("window ", get_window().size, " screen ", DisplayServer.screen_get_size())
	var only = Args.param("only")
	var names := STATES if not only else Array(only.split(","))
	for n in names:
		await run(n)
	if Args.has("keys"):
		await drive()
	await fresh() # (what the HUD costs a frame, redrawn as the game redraws it)
	crew_hud()
	await TestKit.time_frames(self, 3.0, "hud (crew)")
	get_tree().quit()

const STATES := ["loading", "start", "start_settings", "start_options", "start_controls", "roles", "pause", "pause_quit", "map", "debrief", "debrief_pilot", "over",
	"hud_crew", "hud_events", "hud_seat", "hud_fighter", "hud_sight", "hud_eject", "mission_map", "identity", "hurt", "no_graphics"]

## A fresh UI (the web harness loads the page afresh for each screen), set up as main.js does.
func fresh() -> void:
	if ui:
		ui.queue_free()
		await get_tree().process_frame
	for k in ["bt-tips", "bomber.hud", "bomber.sound"]:
		Store.remove_item(k)
	ui = UI.new()
	add_child(ui)
	ui.fullscreen()
	ui.sound(func(_v, _m, _x): pass)
	ui.hud_options(func(_o): pass)
	var env: Dictionary = S.env.duplicate()
	ui.env_controls(env, func(_e, _f): pass)
	ui.conditions("default", env, func(_m): pass, func(_k, _v): pass)
	for e in S.events:
		ui.log(e)

func run(name: String) -> void:
	await fresh()
	call("s_" + name)
	await TestKit.wait(self, 1.6)
	await TestKit.shot(self, name)

func choose_role(id): print("role ", id)

func start() -> void:
	var o: Dictionary = S.start.duplicate()
	o.merge({kind = "start", roles = choose_role, quality = S.quality, on_quality = func(q): print("quality ", q)})
	ui.menu(o)

func pause() -> void:
	ui.menu({kind = "pause", kicker = "Crew, stand by", title = "Paused", stamp = "Hold", status = S.status, button = "Resume", on_click = func(): print("resume"), quality = S.quality, on_quality = func(_q): pass,
		seats = S.seats, on_seat = func(id): print("seat ", id),
		actions = [{label = "Change aircraft", on_click = func(): pass}, {label = "Controls", on_click = func(): ui.drawer("controls")}, {label = "Options", on_click = func(): ui.drawer("options")}, {label = "Settings", on_click = func(): ui.drawer("settings")},
			{label = "Quit to menu", confirm = "Click again to quit", on_click = func(): print("quit")}],
		hint = "Quitting starts the mission again from the briefing"})

func bomber_hud() -> StandInBomber:
	var b := StandInBomber.new()
	b.engines = S.engines
	b.parts = {wingLo = 0.15, engine2 = 0.6, waist = 0.4, tail = 0.85, nose = 0.05, radio = 0.3}
	return b

func vec(x: float, z: float) -> Vector3: return Vector3(x, 0, z)

func crew_hud() -> void:
	ui.set_mode("crew")
	ui.play()
	ui.mission("Over Germany · target in 12:34")
	ui.forces(S.forces, S.fcounts)
	ui.hud({location = "Left waist", prompt = S.prompt, atStation = true})
	ui.controls(S.controls, "gun")
	ui.gun(S.gun)
	ui.crew(S.crewList)
	var b := bomber_hud()
	ui.engines(b, true)
	ui.you(0.62, S.wounds)
	ui.health(0.72, 2, b)
	ui.life_stats(S.life)
	ui.kill(2)
	ui.minimap({at = mine.base, yaw = S.minimap.yaw, bombers = bombers, fighters = [{alive = true, pos = mine.base + vec(600, -900), side = "axis"}, {alive = true, pos = mine.base + vec(-900, 400), side = "allied"}],
		target = Vector3(0, 0, -9000), range = S.minimap.range, flak = S.minimap.flak})
	ui.tick(0.5)
	ui.tick(0.5)

func s_loading() -> void:
	var l = ui.loading(S.loadingSteps, int(S.loadingTotal), S.quality, func(_q): pass)
	for i in int(S.loadingDone):
		l.tick(0 if i < 6 else 1)
func s_start() -> void: start()
func s_start_settings() -> void: start(); ui.drawer("settings")
func s_start_options() -> void: start(); ui.drawer("options")
func s_start_controls() -> void: start(); ui.drawer("controls")
func s_roles() -> void:
	ui.menu({kind = "roles", kicker = "Sortie over", title = "You were shot down", text = "Fly again, or take another role.", body = ui.life_card(S.life), roles = choose_role,
		quality = S.quality, on_quality = func(_q): pass, hint = "<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick a role"})
func s_pause() -> void: pause()
func s_pause_quit() -> void:
	pause()
	var extra: Array = ui.find_children("*", "Container", true, false).filter(func(c): return c.has_meta("label") and c.get_meta("label").text == "Quit to menu")
	extra[0].pressed.emit()
func s_map() -> void:
	ui.map({title = "You were killed", text = "Pick any surviving bomber on the map, then the crewman you will carry on as. Double-click a bomber to board her straight away.",
		record = ui.life_card(S.life, "That life"), bombers = bombers, crew_of = func(b): return b.crew, mine = mine, on_pick = func(b, m): print("pick ", b.label, " ", m.name), on_role = choose_role})
func s_debrief() -> void: ui.debrief(S.debrief, func(): pass, func(_q): pass, "crew")
func s_debrief_pilot() -> void: ui.debrief(S.debrief, func(): pass, func(_q): pass, "bf109")
func s_over() -> void:
	ui.menu({kind = "over", kicker = "Mission failed", title = "The bombers are all gone", stamp = "Lost", text = "Fighters shot down: 41.", body = ui.life_card(S.mission, "Whole mission"),
		button = "Fly again", on_click = func(): pass, quality = S.quality, on_quality = func(_q): pass})
func s_hud_crew() -> void: crew_hud()
func s_hud_events() -> void:
	crew_hud()
	ui.toast("Bail out! Get to a hatch!", "kill")
	ui.toast("Back in formation")
	ui.banner("kill", "Bf 109 G-6", 100)
	ui.banner("assist", "Fw 190 A-6", 50)
	ui.tip("gun", S.tip[0], S.tip[1])
	ui.hint("Click to capture the mouse.")
func s_hud_seat() -> void:
	crew_hud()
	ui.hud({location = "Pilot", prompt = "<b>T</b> Extinguish fire (engine 2) · 2 bottles left&nbsp;&nbsp;&nbsp;<b>F</b> Feather engine 2", atStation = true})
	ui.gun(null)
	ui.flight(S.flight)
func s_hud_fighter() -> void:
	ui.set_mode("bf109")
	ui.play()
	ui.mission("Over Germany · target in 12:34")
	ui.forces(S.forces, S.fcounts)
	ui.hud({location = "Bf 109 G-6 · cockpit", prompt = "", atStation = true})
	ui.fighter(S.fighter)
	ui.fighter_damage(S.fighterParts)
	ui.life_stats(S.life)
	ui.lock([1150, 470], 412)
func s_hud_sight() -> void:
	crew_hud()
	ui.gun(null)
	ui.hud({location = "Bombsight", prompt = "", atStation = true})
	ui.sight(S.sight)
func s_hud_eject() -> void:
	ui.set_mode("eject")
	ui.play()
	ui.hud({location = "Free fall", prompt = "<span style=\"font-size:24px\">Press <b>J</b> to pull your parachute</span>", atStation = false})
	ui.ejected(ui.life_card(S.life, "That life"), false)
func s_mission_map() -> void:
	crew_hud()
	var d: Dictionary = S.missionMap.duplicate(true)
	d.city.riverZ = func(x): return 400 + 120 * sin(x / 400.0)
	d.bombers = S.bombers.filter(func(b): return not b.down).map(func(b): return [b.base[0] * 0.5, b.base[2] * 0.5 + 9000])
	d.fighters = [{side = "axis", at = [400, 8000]}, {side = "allied", at = [-300, 9600]}]
	ui.mission_map(d)
func s_identity() -> void: crew_hud(); ui.identity(S.identity)
func s_hurt() -> void: crew_hud(); ui.hurt(14, 30, false)
func s_no_graphics() -> void: UI.no_graphics(self, "The game is running on the processor's software graphics (Microsoft Basic Render Driver), not the graphics card.")

## The keyboard and mouse: pick a role with a number key, open and close the drawer with Esc, arm and confirm the
## quit, pick a bomber on the plot by clicking it, pan and zoom it with keys.
func drive() -> void:
	await fresh()
	var picked := []
	var o: Dictionary = S.start.duplicate()
	o.merge({kind = "start", roles = func(id): picked.append(id)})
	ui.menu(o)
	await TestKit.wait(self, 0.5)
	key(KEY_2)
	await get_tree().process_frame
	print("KEYS role by 2: ", picked)
	ui.drawer("settings")
	key(KEY_ESCAPE)
	await get_tree().process_frame
	print("KEYS drawer after Esc: ", ui.drawer_open)
	s_map()
	await TestKit.wait(self, 0.8)
	var plot = ui.el("map-canvas")
	var s0: float = plot.view.s
	key(KEY_EQUAL)
	print("KEYS zoom + : ", s0, " -> ", plot.view.s)
	key(KEY_0)
	await get_tree().process_frame
	var target = bombers[40]
	var p: Vector2 = plot.global_position + plot.px(target)
	click(p)
	await get_tree().process_frame
	print("KEYS clicked bomber 40: selected ", plot.selected == target)
	await TestKit.shot(self, "keys_map_selected")

func key(code: Key) -> void:
	var e := InputEventKey.new()
	e.keycode = code
	e.physical_keycode = code
	e.pressed = true
	Input.parse_input_event(e)
	var u := e.duplicate()
	u.pressed = false
	Input.parse_input_event(u)
	Input.flush_buffered_events()

func click(p: Vector2) -> void:
	var m := InputEventMouseMotion.new()
	m.position = p
	m.global_position = p
	Input.parse_input_event(m)
	for down in [true, false]:
		var b := InputEventMouseButton.new()
		b.button_index = MOUSE_BUTTON_LEFT
		b.pressed = down
		b.position = p
		b.global_position = p
		Input.parse_input_event(b)
	Input.flush_buffered_events()
