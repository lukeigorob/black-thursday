extends Node
# First-person crew member. Lives in the bomber's LOCAL space (feet position relative to the plane),
# so the plane can move and rock without the player sliding or falling through the floor.
#
# (Godot: the script is the Player class, `Player.new(bomber, camera)`, a Node: add it to the tree, where it hears the keyboard and
# mouse (_input) as the web game's listeners on the window did. Keys are kept by the browser's codes
# ("KeyW", "Digit1", "ShiftLeft"...) so every check below reads as it did.)

const CrewM := preload("res://src/crew.gd")
const Figure := preload("res://src/figure.gd")
const Interior := preload("res://src/interior.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")

const R := 0.2 # body radius
const STAND_EYE := 1.58
const MIN_EYE := 0.42
const MIN_HEADROOM := 0.55
# where on you a hit lands, and how much worse (or less bad) than one in the body it is: the head is the
# worst, the chest and belly as they were, an arm or a leg much less
const ZONES := ["head", "torso", "armL", "armR", "legL", "legR"]
const ZONE_HARM := {head = 2.2, torso = 1.0, armL = 0.45, armR = 0.45, legL = 0.45, legR = 0.45}
static func no_wounds() -> Dictionary:
	var d := {}
	for z in ZONES:
		d[z] = 0.0
	return d
const STEP := 0.42
const WALK := 1.7
const GRAVITY := 9.8
const LOOK := 0.0022
static var OUT_BY := {tail = Interior.TAILWAY.fwd} # positions you leave by crawling straight out (E at the tail gun: back to the waist)
# a crawl's progress against time: easing in and out over its first and last 12%, steady between
const EXIT_TIME := 2.3 # s: from E at a hatch to out under the plane (start_exit)
static func ease_ends(k: float, a := 0.12) -> float:
	var v := 1 / (1 - a)
	return v * k * k / (2 * a) if k < a else (1 - v * (1 - k) ** 2 / (2 * a) if k > 1 - a else v * (k - a / 2))
const BODY_DROP := 0.14
const BODY_BACK := 0.22 # m: your body's neck sits this far below and behind your eye
const TO_STATION := 4.0 # 1 / seconds to move into a gun position
const HEAD_YAW := 150 * PI / 180 # pilots free-looking (C): as far round as a head turns in the seat
const GUN_HEAD := {yaw = 100 * PI / 180, up = 0.7, down = -0.6} # at a gun: your head turns, the gun stays put
const TURRET_HEAD := {yaw = 0.9, up = 0.5, down = -0.5} # (curled up in a turret there's less room to turn)
const EDGE := 0.9 # without mouse capture: only the outer edge of the screen keeps turning the view
static func _wrap(a: float) -> float: return atan2(sin(a), cos(a))
const NOSE_KEYS := ["cheekL", "noseL", "noseR", "cheekR", "bombsight"] # (keys 1 - 5 in the nose: the guns left to right, then the sight)
const THIRD_BACK := 36.0
const THIRD_UP := 6.0 # m: the third-person view from the pilot's seat, behind and above your bomber

static func _now_ms() -> float:
	return Time.get_ticks_usec() / 1000.0

static func _euler(pitch: float, yaw: float, roll := 0.0) -> Quaternion: # (Three's Euler 'YXZ', Godot's own order)
	return Quaternion.from_euler(Vector3(pitch, yaw, roll))

static func smoothstep3(x: float, a: float, b: float) -> float: # (Three's MathUtils.smoothstep)
	if x <= a: return 0.0
	if x >= b: return 1.0
	x = (x - a) / (b - a)
	return x * x * (3 - 2 * x)

static func smootherstep(x: float, a: float, b: float) -> float:
	if x <= a: return 0.0
	if x >= b: return 1.0
	x = (x - a) / (b - a)
	return x * x * x * (x * (x * 6 - 15) + 10)

## The browser's KeyboardEvent.code for a Godot key event, so the checks read as before.
static func code_of(e: InputEventKey) -> String:
	var k := e.physical_keycode if e.physical_keycode else e.keycode
	if k >= KEY_A and k <= KEY_Z:
		return "Key" + char(k)
	if k >= KEY_0 and k <= KEY_9:
		return "Digit" + char(k)
	match k:
		KEY_SPACE: return "Space"
		KEY_SHIFT: return "ShiftRight" if e.location == KEY_LOCATION_RIGHT else "ShiftLeft"
		KEY_ESCAPE: return "Escape"
		KEY_ENTER: return "Enter"
	return OS.get_keycode_string(k)

var bomber
var it
var camera: Camera3D
var feet := Vector3(0, -1.80, -1.8) # radio room
var safe := Vector3()
var vel := Vector3()
var vy := 0.0
var yaw := PI # face aft, towards the waist
var pitch := 0.0
var eye := STAND_EYE
var cam_y := 0.0
var station = null
var last_station = null
var s_yaw := 0.0
var s_pitch := 0.0 # look angles at a station, relative to its direction
var blend := 0.0 # 0 walking .. 1 at the station
var keys := {}
var enabled := false
var near = null
var passage = null
var hatch = null
var hatches = null # going down: the lit hatches (main sets them)
var learned := {} # the positions you've taken this game (their E no longer shown)
var firing := false # left mouse held
var reload_pressed := false
var release_pressed := false
var bottle_pressed = null
var extinguish_pressed := false
var feather_pressed := false
var recoil := 0.0
var shake := 0.0
var aim_yaw := 0.0
var aim_pitch := 0.0 # pilot's aim, in the formation's frame
var head_yaw := 0.0
var head_pitch := 0.0 # pilot's free look (hold C), on top of the aim
var throttle := 0.5
var wounded := false # down on the floor, waiting for first aid
var health := 1.0 # 0..1: hits take it down; at nothing you're down (wounded)
var wounds := no_wounds() # how hurt each part of you is, 0..1 (ZONES): what the figure on the HUD shows
var wound_left := 0.0
var dead := false
var patched := false
var last_zone = null
var hurt_at := 0.0
var body: Figure.Fig
var stride := 0.0
var zoom := false
var look_scale := 1.0 # mouse turns slower while zoomed
# fallback when the mouse isn't captured: moving the mouse still turns the view,
# and holding the cursor near a screen edge keeps turning (so you never run out of screen)
var free_look := false
var cursor = null # -1..1 screen position, null when outside the window
var crawl = null
var exit = null
var jumped := false
var away := false
var third := false
var role = null
var first_aid := ""
var sight_ok := false
var leave_hint_until := 0.0
var room = null
var grip_targets = null # (your hands on your gun: weapons.gd sets them)
var gun_eye = null # (your eye behind a flexible gun: weapons.gd)
var turret_eye := Vector3()
var hidden = null
var ghosted = null
var waist_wide = null
var iron_on: Node3D = null
var turret_speed := 0.0
var t_yaw = null
var t_pitch = null
var v_yaw := 0.0
var v_pitch := 0.0
var _drove = null
var marks = null
var hatch_sprites = null
var riding_tail := false
# (main's hooks: what happens when you go out of a hatch, crawl, or ask for the sight too early)
var on_exit = null
var on_hatch = null
var on_crawl = null
var on_sight_refused = null

func _init(bomber_, camera_: Camera3D) -> void:
	bomber = bomber_
	it = bomber.interior
	camera = camera_
	camera.rotation_order = EULER_ORDER_YXZ
	if camera.get_parent():
		camera.get_parent().remove_child(camera)
	bomber.group.add_child(camera)
	safe = feet
	cam_y = feet.y + eye
	# your own body: look down and you see your chest, arms and boots (the head is left off)
	body = Figure.make_figure({"self": true}) # (no head or collar: they'd sit round your eyes)
	it.group.add_child(body)
	name = "Player"

func _input(e: InputEvent) -> void:
	if e is InputEventKey:
		var code := code_of(e)
		if e.pressed:
			keys[code] = true
			var rep: bool = e.echo
			if code == "KeyE" and enabled and not rep: use()
			if code == "KeyB" and enabled and not rep: use_sight() # the bombsight, from anywhere in the nose (on the bomb run)
			if RegEx.create_from_string("^Digit[1-5]$").search(code) and enabled and not rep and in_nose: nose_switch(int(code.substr(5))) # the bombardier's guns and sight
			if code == "KeyR" and enabled and not rep: reload_pressed = true
			if RegEx.create_from_string("^Digit[1-4]$").search(code) and enabled and station and station.get("flies") and not rep: bottle_pressed = int(code.substr(5)) - 1
			if code == "KeyT" and enabled and station and station.get("flies") and not rep: extinguish_pressed = true # the worst engine's fire bottle
			if code == "KeyF" and enabled and station and station.get("flies") and not rep: feather_pressed = true # feather the worst engine
			if code == "Space" and enabled and station and station.get("sight"): release_pressed = true # bombs away
		else:
			keys[code] = false
	elif e is InputEventMouseButton:
		if e.pressed:
			if e.button_index == MOUSE_BUTTON_LEFT and enabled and hatch and not wounded:
				start_exit(hatch) # (a click at a lit hatch: out)
				return
			if e.button_index == MOUSE_BUTTON_LEFT and enabled and not station and (passage or near) and not crawl and not wounded:
				interact() # (a click at a crawlway or a position takes it, as E does)
				return
			if e.button_index == MOUSE_BUTTON_LEFT and enabled: firing = true
			if e.button_index == MOUSE_BUTTON_RIGHT and enabled: zoom = true # hold right click to zoom in
		else:
			if e.button_index == MOUSE_BUTTON_LEFT: firing = false
			if e.button_index == MOUSE_BUTTON_RIGHT: zoom = false
	elif e is InputEventMouseMotion:
		var vs := get_viewport().get_visible_rect().size
		cursor = Vector2((e.position.x / vs.x) * 2 - 1, (e.position.y / vs.y) * 2 - 1)
		if not enabled:
			return
		# (one huge bogus jump: skip it, as the browser's were)
		if absf(e.relative.x) > 300 or absf(e.relative.y) > 300:
			return
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or free_look:
			look(-e.relative.x * LOOK * look_scale, -e.relative.y * LOOK * look_scale)

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		keys = {}; firing = false; zoom = false
	elif what == NOTIFICATION_WM_MOUSE_EXIT:
		cursor = null # left the window

## A powered turret (the ball): its motors drive it towards where you're aiming, getting up to speed
## and slowing to a stop rather than snapping there (about 60 degrees a second at most).
func drive(dt: float) -> void:
	var s = station
	if s and s.get("whine") and dt > 0: # (the ball follows the mouse directly: its motors' whine goes with how fast it's turning)
		var sp: float = Vector2(_wrap(s_yaw - _drove[0]), s_pitch - _drove[1]).length() / dt if _drove else 0.0
		turret_speed += (minf(sp, 2) - turret_speed) * minf(1, dt * 12)
		_drove = [s_yaw, s_pitch]
		return
	if not (s and s.get("powered")) or not (dt > 0):
		turret_speed = 0; t_yaw = null; t_pitch = null; v_yaw = 0; v_pitch = 0; _drove = null
		return
	if t_yaw == null or _drove == null or absf(_wrap(s_yaw - _drove[0])) > 1e-6 or absf(s_pitch - _drove[1]) > 1e-6: # (set from outside: start from there)
		t_yaw = s_yaw; t_pitch = s_pitch
	var MAX := 1.05
	var ACC := 4.5
	var step := func(v: float, err: float) -> float:
		var want := clampf(err * 7, -MAX, MAX)
		return v + clampf(want - v, -ACC * dt, ACC * dt)
	v_yaw = step.call(v_yaw, _wrap(t_yaw - s_yaw)); v_pitch = step.call(v_pitch, t_pitch - s_pitch)
	s_yaw = _wrap(s_yaw + v_yaw * dt); s_pitch = clampf(s_pitch + v_pitch * dt, s.pitch[0], s.pitch[1])
	turret_speed = Vector2(v_yaw, v_pitch).length()
	_drove = [s_yaw, s_pitch]

## Holding C at a station: looking round with your head, the gun (or the plane) left as it was.
var free_looking: bool:
	get: return station != null and keys.get("KeyC", false) and blend > 0.9

func look(d_yaw: float, d_pitch: float) -> void:
	if station and station.get("flies") and keys.get("KeyC", false): # hold C: look round without touching the controls
		head_yaw = clampf(head_yaw + d_yaw, -HEAD_YAW, HEAD_YAW)
		head_pitch = clampf(head_pitch + d_pitch, -0.5, 0.6) # (the cockpit roof is close overhead)
	elif station and keys.get("KeyC", false): # at a gun or the sight: the same, the gun stays where it points
		var h: Dictionary = TURRET_HEAD if station.get("attach") == "ballCockpit" or station.get("attach") == "topCockpit" else GUN_HEAD
		head_yaw = clampf(head_yaw + d_yaw, -h.yaw, h.yaw)
		head_pitch = clampf(head_pitch + d_pitch, h.down, h.up)
	elif station and station.get("flies"): # War Thunder style: the mouse points where you want to fly
		aim_yaw = _wrap(aim_yaw + d_yaw)
		aim_pitch = clampf(aim_pitch + d_pitch, -0.6, 0.6)
	elif station and station.get("powered"): # a powered turret: the mouse sets where it's going, its motors take it there (drive)
		var s = station
		t_yaw = _wrap((t_yaw if t_yaw != null else s_yaw) + d_yaw); t_pitch = clampf((t_pitch if t_pitch != null else s_pitch) + d_pitch, s.pitch[0], s.pitch[1])
		# (no winding the target far ahead of the turret)
		var ey := _wrap(t_yaw - s_yaw)
		if absf(ey) > 0.5: t_yaw = _wrap(s_yaw + signf(ey) * 0.5)
		if absf(t_pitch - s_pitch) > 0.4: t_pitch = s_pitch + signf(t_pitch - s_pitch) * 0.4
	elif station:
		var s = station
		s_yaw = _wrap(s_yaw + d_yaw) if s.yaw_lim >= PI else clampf(s_yaw + d_yaw, -s.yaw_lim, s.yaw_lim)
		s_pitch = clampf(s_pitch + d_pitch, Interior.turret_floor(s, s_yaw), s.pitch[1])
	else:
		yaw = _wrap(yaw + d_yaw)
		pitch = clampf(pitch + d_pitch, -1.45, 1.45)

## The Interior field a station's `attach` names ('topCockpit' -> top_cockpit).
func _attached(s):
	var a = s.get("attach") if s else null
	if not a:
		return null
	return it.get(a) if a in it else it.get(a.to_snake_case())

## Out of any station at once, cleanly: nothing left on the camera (the tail's iron sight, the ball and
## top turret cockpits) and the hull parts a station hid or made see-through put back. For bailing out,
## dying, changing role or bomber: anything that leaves a station without the usual walk away.
func detach_all() -> void:
	if station:
		station = null; last_station = null
	blend = 0
	if iron_on:
		camera.remove_child(iron_on); iron_on = null
	if hidden:
		it.set_hidden(hidden, false); hidden = null
	if ghosted:
		it.set_ghost(ghosted, false); ghosted = null
	if it.top_dome:
		it.top_dome.visible = true

## Recoil from one shot: the view shakes while the guns hammer.
func kick(amount: float) -> void: recoil = minf(recoil + amount, 4)
## A blast close by: the whole view jolted (k 0..1).
func jolt(k: float) -> void: shake = minf(1, shake + k)

## Hit near you: `amount` of your health gone (and the pain of it). At nothing you're down. Returns how
## bad it was: 'hurt' or 'down' (or null if nothing happened).
func hurt(amount: float, zone := "torso"):
	if wounded or dead or amount <= 0:
		return null
	amount *= ZONE_HARM.get(zone, 1.0)
	wounds[zone] = minf(1, wounds.get(zone, 0.0) + amount * 1.6)
	last_zone = zone
	health = maxf(0, health - amount)
	hurt_at = _now_ms()
	if health > 0:
		return "hurt"
	if patched: # (patched up once already: this one kills you)
		wound()
		return "dead"
	wound()
	return "down"

## The part of you a hit at `at` (bomber space) lands on: by its height up your body as you stand, sit or
## crouch (your eye's height: head above the chin, legs below the hips), and the side it's on; in the
## chest's height a third of them take an arm instead. doubt: 0..1, how little `at` says about the height
## (a round striking the skin near you rather than you: anywhere up you, leaning to its height).
func zone_at(at: Vector3, doubt := 0.0) -> String:
	var tall := maxf(0.5, eye + 0.12)
	var h0 := clampf((at.y - feet.y) / tall, 0, 1)
	var h := h0 * (1 - doubt) + randf() * doubt
	var side := "L" if at.x < feet.x else "R"
	if h > 0.88:
		return "head"
	if h > 0.5:
		return "arm" + side if randf() < 0.33 else "torso"
	return "leg" + side

## Hit by enemy fire: you go down where you are and have 30 s unless someone patches you up.
func wound(time := 30.0) -> void:
	if wounded or dead:
		return
	if station: # knocked off the gun
		interact()
	if patched: # the second time: no getting up from it
		dead = true; firing = false
		return
	wounded = true
	wound_left = time
	firing = false
	vel = Vector3.ZERO

func revive() -> void:
	wounded = false
	wound_left = 0
	health = 0.6 # (patched up, not new)
	patched = true # (once: another wound like that and you're dead)

## Start again as another man of the crew, at his post.
func becomes(stand: Vector3, yaw_: float) -> void:
	detach_all()
	dead = false
	wounded = false
	# a man who died at a gun can't leave it himself (interact() ignores the dead): start clean
	station = null; last_station = null; blend = 0; crawl = null; exit = null; jumped = false
	firing = false; vy = 0; wound_left = 0; health = 1; wounds = no_wounds(); last_zone = null
	reload_pressed = false; release_pressed = false
	eye = STAND_EYE; cam_y = stand.y + STAND_EYE
	feet = stand
	safe = stand
	yaw = yaw_
	pitch = 0
	vel = Vector3.ZERO

## E: as interact(), but from the tail gun straight out along the crawl to the waist (not while she's
## going down: then you're left in the tail, by its door).
func use() -> void:
	var p = OUT_BY.get(station.id) if station else null
	if p and blend > 0.95 and not hatches and not hatch and not wounded and not dead and not crawl:
		crawl_out(p)
		return
	interact()

## Off a position and into a crawl from it: from your eye where it is, back the way in, then the crawl.
func crawl_out(p: Dictionary) -> void:
	var s = station
	var from := camera.position
	var y: float = s.yaw + s_yaw
	var pt := s_pitch
	feet = s.stand; vel = Vector3.ZERO
	station = null; last_station = null; blend = 0
	var via := []
	if s.get("entry"):
		via = s.entry.path.duplicate()
		via.reverse()
	start_crawl(p, {from = from, via = via, yaw = y, pitch = pt})

func interact() -> void:
	if hatch and not wounded and not dead: # (going down: out through the hatch)
		start_exit(hatch)
		return
	firing = false
	if wounded or dead or crawl:
		return
	if not station and passage:
		start_crawl(passage)
		return
	if station: # leave: stand up where you came in, looking the way the gun pointed
		yaw = station.yaw + s_yaw
		pitch = clampf(s_pitch, -1.45, 1.45)
		feet = station.stand
		vel = Vector3.ZERO
		station = null
	elif near:
		station = near
		var s = station
		if not learned.has(s.id): # (the first time here)
			learned[s.id] = true
			leave_hint_until = _now_ms() + 4500
		if s.get("flies"):
			var f: Dictionary = bomber.flight
			aim_yaw = f.heading; aim_pitch = f.pitch; throttle = f.throttle
		var rel := _wrap(yaw - s.yaw)
		s_yaw = rel if s.yaw_lim >= PI else clampf(rel, -s.yaw_lim, s.yaw_lim)
		s_pitch = clampf(pitch, s.pitch[0], s.pitch[1])

## The E sign: a rounded plate with an E on it (the canvas the web game drew), on a sprite.
static func _e_texture(fill: String, edge: String, ink: String) -> Texture2D:
	var c := Canvas2D.new(128, 128)
	c.fill_style = fill; c.stroke_style = edge; c.line_width = 6
	c.begin_path(); c.round_rect(14, 14, 100, 100, 16); c.fill(); c.stroke()
	c.fill_style = ink; c.font = "bold 72px sans-serif"; c.text_align = "center"; c.text_baseline = "middle"; c.fill_text("E", 64, 70)
	return c.texture(true)

func _sprite(tex: Texture2D, size: float, depth_test: bool, order: int) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = tex
	s.pixel_size = 1.0 / 128
	s.scale = Vector3.ONE * size
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	s.no_depth_test = not depth_test
	s.render_priority = order
	s.shaded = false
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISABLED
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return s

## An "E" hanging over each crawlway's opening while you're near it, brighter when you can take it; and
## one at every position (the guns, the seats, the sight) until you've taken it once this game.
func passage_marks() -> void:
	if marks == null:
		var tex := _e_texture("rgba(12,12,10,0.72)", "#e8d8a8", "#f4ead0")
		marks = []
		for p in Interior.PASSAGES:
			var s := _sprite(tex, 0.16, true, 6)
			s.position = Vector3(p.from[0], p.floor + (0.62 if p.floor < -1.5 else (0.14 if p == Interior.PASSAGES[0] else 0.4)), p.from[1]) # (the flight deck's: just over its hatch)
			s.modulate.a = 0
			s.set_meta("p", p)
			it.group.add_child(s)
			marks.append(s)
		# the positions': over the gun, the seat or the sight, a little below where your eye goes
		for st in it.stations:
			var s := _sprite(tex, 0.13, false, 7)
			s.set_meta("st", st)
			s.modulate.a = 0
			s.position = st.eye + Vector3(0, -0.15 if st.get("seat") else -0.22, 0)
			if st.id == "ball": s.position = Vector3(st.stand.x, st.stand.y + 0.25, st.stand.z) # (the ball's hatch, in the floor)
			if st.id == "top": s.position = Vector3(st.stand.x, st.stand.y + 1.25, st.stand.z)
			it.group.add_child(s)
			marks.append(s)
	var t := _now_ms() / 1000
	for s in marks:
		if s.has_meta("st"): # a position's: near it, not yet learned
			var st = s.get_meta("st")
			var d := Vector2(feet.x - st.stand.x, feet.z - st.stand.z).length()
			var on: bool = not station and not crawl and not away and not wounded and not dead and not learned.has(st.id) and d < 2.0 and absf(feet.y - st.stand.y) < 0.6
			var k := (1.0 if near == st else 0.45) if on else 0.0
			s.modulate.a += (k - s.modulate.a) * 0.15
			s.visible = s.modulate.a > 0.02
			s.scale = Vector3.ONE * (0.13 + 0.01 * sin(t * 5) if near == st else 0.11)
			continue
		var p = s.get_meta("p")
		var d := Vector2(feet.x - p.from[0], feet.z - p.from[1]).length()
		var on: bool = not station and not crawl and not away and absf(feet.y - p.floor) < 0.3 and d < 2.6
		var k := (1.0 if passage == p else 0.55) if on else 0.0
		s.modulate.a += (k - s.modulate.a) * 0.15
		s.visible = s.modulate.a > 0.02
		s.scale = Vector3.ONE * (0.16 + 0.012 * sin(t * 5) if passage == p else 0.14)

## Going down: a red "E" over every bail-out hatch, pulsing, brightest at the one you're at.
func hatch_marks() -> void:
	if hatch_sprites == null and hatches:
		var tex := _e_texture("rgba(150,20,10,0.85)", "#ffb0a0", "#fff")
		hatch_sprites = []
		for h in hatches:
			var s := _sprite(tex, 0.15, false, 8)
			s.position = h.pos + Vector3(0, 0.55, 0)
			s.set_meta("h", h)
			it.group.add_child(s)
			hatch_sprites.append(s)
	if hatch_sprites == null:
		return
	var t := _now_ms() / 1000
	for s in hatch_sprites:
		s.visible = hatches != null and not exit # (not in your face as you go out)
		s.scale = Vector3.ONE * ((0.2 if hatch == s.get_meta("h") else 0.15) * (1 + 0.12 * sin(t * 7)))

## Out through a hatch (going down): you step to it, turning to face out of a side door (or over a hatch in
## the floor, looking down through it), crouch in it a moment with the slipstream roaring past, and go:
## out and down, the air taking you aft, tumbling over to see her flying on above you. Then the
## parachute (on_hatch: main.gd, eject.gd) takes over from where you are.
func start_exit(h) -> void:
	if exit:
		return
	var hp: Vector3 = h.pos
	var side := signf(hp.x) if absf(hp.x) > 0.3 else 0.0
	var f := hp.y
	var at := [hp.x - side * 0.3, hp.z] if side else [hp.x, hp.z]
	var rm: float = it.headroom(at[0], at[1], f, R, STEP)
	var crouch := minf(rm - 0.15, 0.95)
	var pts := [Vector3(at[0], f + crouch, at[1]), Vector3(hp.x + side * 0.12, f + 0.55, hp.z + 0.08), Vector3(hp.x + side * 1.1, f - 0.3, hp.z + 1.3), Vector3(hp.x + side * 2.6, f - 2.2, hp.z + 5), Vector3(hp.x + side * 3.6, f - 4.5, hp.z + 10)] if side \
		else [Vector3(at[0], f + crouch, at[1]), Vector3(at[0], f - 0.15, at[1] + 0.05), Vector3(at[0], f - 1.2, at[1] + 1.3), Vector3(at[0] + 0.5, f - 3, at[1] + 5), Vector3(at[0] + 0.8, f - 5.5, at[1] + 10)]
	exit = {h = h, t = 0.0, side = side, from = camera.position, yaw0 = station.yaw + s_yaw if station else yaw, pitch0 = s_pitch if station else pitch,
		curve = Shapes.CatmullRomCurve3.new(pts, false, "centripetal"), first = pts[0], yaw_out = -side * PI / 2 if side else yaw}
	station = null; blend = 0; firing = false; vel = Vector3.ZERO; crawl = null
	if on_exit: on_exit.call(h)

## The way out (start_exit): where your eye is, and where you look, `k` (0..1) of the way.
func exit_view(k: float) -> void:
	var x: Dictionary = exit
	var step := smootherstep(k, 0, 0.28)
	var set_k := smootherstep(k, 0.28, 0.5)
	var go := clampf((k - 0.5) / 0.5, 0, 1)
	if k < 0.5: # over to it, and down into a crouch in it, leaning out a little
		camera.position = (x.from as Vector3).lerp(x.first, step)
		if set_k > 0:
			camera.position += Vector3(x.side * 0.12, -0.12, 0) * set_k
	else:
		camera.position = x.curve.get_point(go * go * (0.6 + 0.4 * go)) # (pushing off, then falling faster)
	# looking: round to the way out, down at the slipstream and the ground; falling, over and back up at her
	var yaw_out: float = x.yaw_out
	var pitch_out := -0.55 if x.side else -1.25
	var y: float = x.yaw0 + atan2(sin(yaw_out - x.yaw0), cos(yaw_out - x.yaw0)) * step
	var p: float = x.pitch0 + (pitch_out - x.pitch0) * smootherstep(k, 0, 0.45)
	var roll := 0.0
	if go > 0:
		var back := smootherstep(go, 0.1, 0.9)
		y += (PI * 0.85 if x.side else 0.4) * back * (x.side if x.side else 1.0)
		p += ((0.45 if x.side else 1.15) - pitch_out) * back
		roll = sin(go * 7) * 0.35 * go * (1 - back * 0.5)
	camera.quaternion = _euler(p, y, roll)

## Down through the hatch and forward under the flight deck to the nose (or back): the eye along the way.
func start_crawl(p: Dictionary, o := {}) -> void:
	var st = null
	if p.get("station"):
		for s in it.stations:
			if s.id == p.station:
				st = s
	var mid := []
	for q in o.get("via", []) + p.path:
		mid.append(CrewM._v(q))
	var end: Vector3
	if st: # onto a position: on along its way in, ending at its eye (no standing up first)
		if st.get("entry"):
			for q in st.entry.path:
				mid.append(CrewM._v(q))
		end = st.eye
	else: # onto your feet: as high as the room there lets you stand
		var rm: float = it.headroom(p.to[0], p.to[2], p.to[1], R, STEP)
		end = Vector3(p.to[0], p.to[1] + clampf(rm - 0.12, MIN_EYE, STAND_EYE), p.to[2])
		# a big rise at the end (out of the nose crawlway): most of it early, slowing as you straighten up
		if not mid.is_empty() and end.y - mid[-1].y > 0.3:
			var last: Vector3 = mid[-1]
			var q := last.lerp(end, 0.55)
			q.y = last.y + (end.y - last.y) * 0.8
			mid.append(q)
	var pts := [o.get("from", Vector3(feet.x, cam_y, feet.z))] + mid + [end]
	crawl = {p = p, t = 0.0, st = st, end_y = end.y, curve = Shapes.CatmullRomCurve3.new(pts, false, "centripetal"), yaw0 = o.get("yaw", yaw), pitch0 = o.get("pitch", pitch)}
	vel = Vector3.ZERO
	if on_crawl: on_crawl.call(p)

func end_crawl() -> void:
	var p: Dictionary = crawl.p
	var st = crawl.st
	var end_y: float = crawl.end_y
	crawl = null
	feet = CrewM._v(p.to); safe = feet; vy = 0
	cam_y = end_y; eye = end_y - feet.y # (on from the height the crawl left you at: no second rise)
	room = it.headroom(feet.x, feet.z, feet.y, R, STEP) # (here's: not where the crawl began)
	yaw = p.yaw; pitch = 0
	if st: # and straight onto the gun you crawled back to: you're already at its eye
		near = st; passage = null; interact()
		gun_eye = null # (the last gun's eye, till the guns work out this one's: not a frame back at that one)
		blend = 1; last_station = st

var location: String:
	get: return station.name if station else it.zone_at(feet.z)

## The controls while you fly (null when you're not at the controls).
var controls:
	get:
		if not (station and station.get("flies")) or blend < 0.5 or wounded or dead:
			return null
		return {aim_yaw = aim_yaw, aim_pitch = aim_pitch, throttle = throttle, roll = (1 if keys.get("KeyA") else 0) - (1 if keys.get("KeyD") else 0)}

## 1 - 5 in the nose: straight to that gun (left and right nose guns, left and right cheek guns) or the Norden.
func nose_switch(n: int) -> void:
	var id: String = NOSE_KEYS[n - 1]
	if (station and station.id == id) or crawl or wounded or dead:
		return
	if id == "bombsight":
		use_sight()
		return
	var st = null
	for s in it.stations:
		if s.id == id:
			st = s
	if not st:
		return
	if station: # (off the one you're on)
		interact()
	feet = st.stand; passage = null
	near = st
	interact()

## In the nose (the bomb bay's forward bulkhead on): the Norden is in reach.
var in_nose: bool:
	get: return (station.stand.z if station else feet.z) < -9.2 and not (station and station.get("flies"))

## B in the nose: down onto the Norden bombsight (or back up from it). Only from the initial point on:
## before that there's nothing to aim at (main sets sight_ok on the bomb run).
func use_sight() -> void:
	if station and station.get("sight"):
		interact()
		return
	var sight = null
	for s in it.stations:
		if s.get("sight"):
			sight = s
	if not sight or not in_nose:
		return
	if not sight_ok: # (main: says when it'll be ready)
		if on_sight_refused: on_sight_refused.call()
		return
	if station: # (off his gun first)
		interact()
	near = sight
	interact()

## The prompt on the HUD (the web game's HTML, as ui.gd shows it).
var prompt: String:
	get:
		if wounded or dead or exit:
			return ""
		if hatch:
			return "<b>E</b> or <b>click</b> Bail out through %s" % hatch.name
		if hatches and station and station.get("flies"):
			return '<span style="color:#ff8a70">Bail out! <b>E</b> out of the seat, then the red <b>E</b> at the crawlway down to the nose hatch, or the bomb bay</span>'
		if hatches:
			return '<span style="color:#ff8a70">Bail out! Get to a hatch: the red <b>E</b></span>'
		if first_aid:
			return first_aid
		if station and station.get("flies"): # engine trouble: what you can do about the worst of it
			var t = bomber.get("engine_trouble")
			if t:
				var n: int = t.i + 1
				var b: int = bomber.bottles
				var acts := []
				if t.fire:
					acts.append(("<b>T</b> Extinguish fire (engine %d) · %d bottle%s left" % [n, b, "" if b == 1 else "s"]) if b > 0 else "Engine %d on fire · no bottles left" % n)
				if t.feather:
					acts.append("<b>F</b> Feather engine %d" % n)
				if not acts.is_empty():
					return "&nbsp;&nbsp;&nbsp;".join(acts)
		# in the nose, the bombardier's keys: his four guns and the sight
		var sight := "" if not in_nose else "&nbsp;&nbsp;&nbsp;<b>1</b><b>2</b><b>3</b><b>4</b> guns, left to right " + ("<b>5</b> bombsight" if sight_ok else '<span class="dim"><b>5</b> bombsight from the initial point</span>')
		if crawl:
			return ""
		if passage:
			return "<b>E</b> or <b>click</b> %s" % passage.name
		# (taking a position: only its E, there over it; leaving: "E Leave" a moment, the first time at each)
		var leave := ("<b>E</b> Leave" + (" (or <b>B</b>)" if station.get("sight") else "")) if station and _now_ms() < leave_hint_until else ""
		var strip := func(s: String) -> String:
			while s.begins_with("&nbsp;"):
				s = s.substr(6)
			return s
		if station:
			return strip.call(leave + sight)
		return strip.call(sight) if in_nose else ""

func edge_turn(dt: float) -> void:
	var c = cursor
	if c == null or not free_look or Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		return
	var push := func(v: float) -> float: return signf(v) * (absf(v) - EDGE) / (1 - EDGE) if absf(v) > EDGE else 0.0
	look(-push.call(c.x) * 2.4 * dt, -push.call(c.y) * 1.6 * dt)

func update(dt: float) -> void:
	if enabled:
		edge_turn(dt)
	if not keys.get("KeyC", false) or not station: # let go of C: the view eases back to the aim (~0.3 s)
		var k := exp(-dt * 10)
		head_yaw *= k; head_pitch *= k
	if station and station.get("flies") and enabled: # W / S: throttle
		throttle = clampf(throttle + ((1 if keys.get("KeyW") else 0) - (1 if keys.get("KeyS") else 0)) * dt * 0.4, 0, 1)
	if wounded:
		wound_left -= dt
		if wound_left <= 0:
			wounded = false; dead = true
		firing = false
		eye += (0.3 - eye) * (1 - exp(-dt * 3)) # lying on the floor
	elif enabled and not station and not dead and not crawl and not exit:
		walk(dt)
	camera.set_meta("exiting", exit != null)
	if exit:
		exit.t += dt / EXIT_TIME
		if exit.t >= 1: # (out: the parachute takes it from here)
			var h = exit.h
			exit_view(1)
			exit = null; jumped = true
			if on_hatch: on_hatch.call(h)
			return
	# what E takes: of the positions and crawlways in reach, the one you're looking towards (the flight
	# deck has both seats, the top turret and the crawlway down to the nose within a stride of each
	# other: by distance alone it was whichever you happened to be a few centimetres nearer). A seat is
	# judged by the seat itself, not the spot you stand at to take it; standing right on a crawlway, or
	# looking down at it, takes the crawlway.
	near = null; passage = null
	if not station and not wounded and not dead and not crawl and not away:
		var fx := -sin(yaw)
		var fz := -cos(yaw)
		var score := func(x: float, z: float, d: float) -> float: # (smaller is better: how far off your line of sight, then how far)
			var dx := x - feet.x
			var dz := z - feet.z
			var l := Vector2(dx, dz).length()
			return (0.5 if l < 0.2 else acos(clampf((dx * fx + dz * fz) / l, -1, 1))) + d * 0.25 # (standing on it: no telling which way you look)
		var best := INF
		for s in it.stations:
			if absf(feet.y - s.stand.y) > 0.7 or s.get("sight") or (s.id == "tail" and bomber.get("no_tail")): # (the bombsight has its own key, B; the tail's gone: nothing back there to take)
				continue
			var d := Vector2(feet.x - s.stand.x, feet.z - s.stand.z).length()
			if d > 1.1:
				continue
			var at: Vector3 = s.eye if s.get("seat") else s.stand
			var k: float = score.call(at.x, at.z, d) - (0.3 if d < 0.15 else 0.0) # (at its own spot: that one)
			if k < best:
				best = k; near = s
		for p in Interior.PASSAGES:
			if p.get("station") == "tail" and bomber.get("no_tail"):
				continue
			var d := Vector2(feet.x - p.from[0], feet.z - p.from[1]).length()
			if d > p.get("reach", 0.38) or absf(feet.y - p.floor) >= 0.1:
				continue
			var k: float = -1.0 if d < 0.2 or pitch < -0.6 else score.call(p.from[0], p.from[1], d) + 0.25 # (over it, or looking well down at it; else only if it's clearly what you face)
			if k < best:
				best = k; near = null; passage = p
	# going down: the nearest lit hatch in reach
	hatch = null
	if hatches and not wounded and not dead and not exit:
		for h in hatches:
			if Vector2(feet.x - h.pos.x, feet.z - h.pos.z).length() < 0.85 and absf(feet.y - h.pos.y) < 0.8:
				hatch = h
	hatch_marks()
	if crawl:
		crawl.t += dt / crawl.p.time
		if crawl.t >= 1:
			end_crawl()
	passage_marks() # (the E over each crawlway's opening)
	var es = station if station else last_station
	var rate: float = 1.0 / (es.entry.time if es and es.get("entry") else 1.0 / TO_STATION) # (crawling into the tail takes a while)
	blend = clampf(blend + (1 if station else -1) * dt * rate, 0, 1)
	# hide hull parts that block the view from this position (only while settled in it)
	var hide = station.get("hide") if blend > 0.6 and station else null
	if hide != hidden:
		if hidden: it.set_hidden(hidden, false)
		if hide: it.set_hidden(hide, true)
		hidden = hide
	# at a waist gun its window is cut wide for the view (interior.gd set_waist_wide); anywhere else, the model's own size
	var wide = station.id.substr(5) if blend > 0.3 and station and RegEx.create_from_string("^waist[LR]$").search(station.id) else null
	if wide != waist_wide:
		if waist_wide: it.set_waist_wide(waist_wide, false)
		if wide: it.set_waist_wide(wide, true)
		waist_wide = wide
	var ghost = station.get("ghost") if blend > 0.3 and station else null
	if ghost != ghosted:
		if ghosted: it.set_ghost(ghosted, false)
		if ghost: it.set_ghost(ghost, true)
		ghosted = ghost
	# things that turn with your aim: the ball and upper turrets you sit in
	var iron: Node3D = _attached(station) if blend > 0.6 and station else null
	if iron != iron_on:
		if iron_on:
			camera.remove_child(iron_on)
			iron_on.position = iron_on.get_meta("at"); iron_on.quaternion = Quaternion.IDENTITY
		if iron:
			if iron.get_parent(): iron.get_parent().remove_child(iron)
			camera.add_child(iron)
			if not iron.has_meta("at"): iron.set_meta("at", iron.position)
		iron_on = iron
	if it.top_dome:
		it.top_dome.visible = iron != it.top_cockpit # (in the turret, the dome is on your camera)
	drive(dt)
	pose(dt)
	# what rides on the guns (the turret you sit in) stays with them while your head
	# turns: it's held against the head's turn, about your eye
	if iron_on:
		var flies: bool = station != null and station.get("flies", false)
		var head_inv := _euler(0.0 if flies else head_pitch, 0.0 if flies else head_yaw).inverse()
		iron_on.quaternion = head_inv
		iron_on.position = head_inv * (iron_on.get_meta("at") as Vector3)
	# the upper turret's dome turns with the guns but doesn't tilt when they elevate
	var level = iron_on.get_meta("level") if iron_on and iron_on.has_meta("level") else null
	if level:
		level.rotation.x = -s_pitch
	update_body(dt)

func update_body(dt: float) -> void:
	var b := body
	var j := b.j
	var s = station
	if dead or exit: # (going out of a hatch: the camera's own way, your body would fill it)
		b.visible = false
		return
	# crawling or climbing into a cramped position, the camera takes its own way: don't let it pass
	# through your own body on the way
	var es = station if station else last_station
	var entering: bool = (es and es.get("entry") and blend > 0.02 and blend < 0.92) or crawl != null
	b.visible = not entering and not away # (and not while you're out of the plane)
	if entering:
		return
	j.leg_l.hip.visible = true; j.leg_r.hip.visible = true
	if wounded:
		b.position = feet
		b.rotation.y = yaw
		CrewM.pose(b, "lie")
		return
	if s and blend > 0.5:
		var spot = CrewM.spot_for(s.id)
		if spot == null or spot.pose == "hidden":
			b.visible = false
			return
		# pick the pose that puts the neck just under the gun position's eye point
		var E := eye_at(s)
		var need: float = E.y - 0.7 - spot.at[1]
		var nm := "sit" if spot.pose == "sit" else ("gun" if need > 0.8 else ("crouch" if need > 0.56 else "kneel"))
		CrewM.pose(b, nm)
		# looking round over your shoulder from the pilots' seats (C): your own shoulders and collar would fill the
		# view from inside, so you don't see yourself then
		if s.get("flies") and not third and absf(head_yaw) > 1.0:
			b.visible = false
		# in the top turret your hands are on the handles as the guns elevate: your arms and shoulders would close
		# round the camera, so (as in the ball) you see only the sight, the guns and the dome
		if s.id == "top" and not third:
			b.visible = false
			return
		var y_: float = s.yaw + s_yaw * (1.0 if s.yaw_lim >= PI else 0.6)
		var y := E.y - 0.6 - BODY_DROP - j.hips.position.y
		b.rotation.y = y_
		b.position = Vector3(E.x + sin(y_) * BODY_BACK, y, E.z + cos(y_) * BODY_BACK)
		if spot.at[1] - y > 0.3: # cramped: legs would go through the floor
			j.leg_l.hip.visible = false; j.leg_r.hip.visible = false
		b.no_head = false
		var rig := b.rig
		if s.get("guns") and grip_targets and rig and b.get_parent() and b.is_inside_tree():
			# at a gun you lean in over it: your shoulders just under and behind your eye (where your
			# head would fill the view, so it isn't drawn), close enough that your hands reach the grips
			# (the shoulders in the body's own frame, from the last sync: the pose doesn't change)
			var skg := rig.skel.global_transform
			var bi := b.global_transform.affine_inverse()
			var sh: Vector3 = bi * ((Figure._bone_world(rig, skg, rig.arms.l.upper).origin + Figure._bone_world(rig, skg, rig.arms.r.upper).origin) * 0.5)
			sh = b.transform.basis * sh # (turned and scaled as the body now is)
			b.position = Vector3(E.x + sin(y_) * 0.1, E.y - 0.24, E.z + cos(y_) * 0.1) - sh
			b.no_head = true
			Figure.reach_for(b, grip_targets) # your hands on your gun's grips
		return
	var speed := Vector2(vel.x, vel.z).length()
	stride += speed * dt
	CrewM.pose(b, "crouch" if eye < 1.3 else ("walk" if speed > 0.15 else "stand"), stride * 0.55)
	# empty-handed, your arms hang at your sides even crouched (held out in front they'd fill the
	# bottom corners of the screen)
	if eye < 1.3:
		for a in [j.arm_l, j.arm_r]:
			a.sh.rotation.x = 0.2; a.el.rotation.x = 0.25
	b.rotation.y = yaw
	# the neck always sits just under and behind the eye, however low you duck, so the camera
	# never ends up inside your own shoulders (arms flashing across the view as you walk)
	var y := cam_y - (j.hips.position.y + 0.6) - BODY_DROP
	b.position = Vector3(feet.x + sin(yaw) * BODY_BACK, y, feet.z + cos(yaw) * BODY_BACK)

func walk(dt: float) -> void:
	var k := keys
	var f := (1 if k.get("KeyW") else 0) - (1 if k.get("KeyS") else 0)
	var s := (1 if k.get("KeyD") else 0) - (1 if k.get("KeyA") else 0)
	var crouch := clampf(eye / STAND_EYE, 0.45, 1)
	var speed := WALK * crouch * (1.5 if k.get("ShiftLeft") or k.get("ShiftRight") else 1.0)
	var sn := sin(yaw)
	var cs := cos(yaw)
	var want := Vector3(-sn * f + cs * s, 0, -cs * f - sn * s)
	if want.length_squared() > 0:
		want = want.normalized() * speed
	vel = vel.lerp(want, 1 - exp(-dt * 12))

	# horizontal: small fixed sub-steps so a slow frame can't jump through anything
	var n := mini(8, ceili(dt * 120))
	var h := dt / n
	var crowd := brush_past() # squeezing past a crewman: under half speed
	for i in n:
		move(vel.x * h * crowd, vel.z * h * crowd)

	# vertical: step up onto anything low enough, step down small drops, otherwise fall
	var floor_y: float = it.floor_at(feet.x, feet.z, feet.y + STEP)
	if floor_y >= feet.y or (vy == 0 and floor_y >= feet.y - STEP):
		feet.y = floor_y; vy = 0
	else:
		vy -= GRAVITY * dt
		feet.y = maxf(floor_y, feet.y + vy * dt)
		if feet.y == floor_y:
			vy = 0
	if not (feet.y > -6): # fell out of the world
		feet = safe; vy = 0
	elif vy == 0:
		safe = feet

	# crouch automatically under low ceilings
	room = it.headroom(feet.x, feet.z, feet.y, R, STEP)
	var target := clampf(room - 0.12, MIN_EYE, STAND_EYE)
	eye += (target - eye) * (1 - exp(-dt * (14.0 if target < eye else 5.0)))

## The crew are soft obstacles: in a B-17 you squeeze past people. Walking into a man slows you to
## under half speed while you shoulder past him, but never stops you (pushing round him could leave
## you wedged beside a door). Crew hides a man while your eye is inside him. Returns the speed factor.
func brush_past() -> float:
	for b in it.people:
		var bb: AABB = b
		if bb.end.y <= feet.y + 0.3 or bb.position.y >= feet.y + eye:
			continue
		var cx := clampf(feet.x, bb.position.x, bb.end.x)
		var cz := clampf(feet.z, bb.position.z, bb.end.z)
		if Vector2(feet.x - cx, feet.z - cz).length() < R:
			return 0.4
	return 1.0

## One small step: the whole move if it fits, otherwise slide along whichever axis does.
func move(dx: float, dz: float) -> void:
	if dx == 0 and dz == 0:
		return
	if try_move(feet.x + dx, feet.z + dz):
		return
	if absf(dx) > absf(dz):
		if not try_move(feet.x + dx, feet.z): try_move(feet.x, feet.z + dz)
	else:
		if not try_move(feet.x, feet.z + dz): try_move(feet.x + dx, feet.z)

func try_move(x: float, z: float) -> bool:
	# judge the move from the floor we'd be standing on there (so stepping up onto a deck works)
	var f := maxf(feet.y, it.floor_at(x, z, feet.y + STEP))
	# only things below chest height block; anything higher you duck under (headroom check).
	# Boxes push you out sideways instead of stopping you dead, so you glide round corners and through doors.
	var p: Vector3 = it.push_out(Vector3(x, 0, z), R, f + STEP, f + MIN_HEADROOM)
	if Vector2(p.x - feet.x, p.z - feet.z).length() > 0.1: # squeezed between boxes
		return false
	if it.blocked(p.x, p.z, R * 0.95, f + STEP, f + MIN_HEADROOM):
		return false
	if it.headroom(p.x, p.z, f, R, STEP) < MIN_HEADROOM:
		return false
	# the body (up to the shoulders) must fit between the hull walls; the head is checked by headroom
	var lim: float = it.wall_limit(p.z, f + 0.3, f + maxf(eye - 0.25, 0.35)) - R
	if lim <= 0.02:
		return false
	feet.x = clampf(p.x, -lim, lim)
	feet.z = p.z
	return true

## Where your eye is at a station: its eye point, or behind a flexible gun, following it round.
func eye_at(s) -> Vector3:
	# in the ball your eye turns and tilts with it (your aim is its aim)
	if s.get("eye_turret") and station == s:
		turret_eye = Interior.turret_point(s.pivot, s.yaw + s_yaw, s_pitch, s.eye_turret)
		return turret_eye
	return gun_eye if (s.get("eye_behind") or s.get("lean")) and gun_eye != null and station == s else s.eye

func pose(dt: float) -> void:
	# smooth the camera height so steps and crouching don't snap
	var walk_y := feet.y + eye
	cam_y += (walk_y - cam_y) * (1 - exp(-dt * 8))
	# the eye never goes through the roof or into the curving wall, whatever the smoothing is doing
	if room != null:
		cam_y = minf(cam_y, feet.y + room - 0.09)
	var wall := maxf(0, it.hw_smooth(feet.z, cam_y) - 0.09)
	var walk_pos := Vector3(clampf(feet.x, -wall, wall), cam_y, feet.z)
	var walk_rot := _euler(pitch, yaw)
	if exit: # (out through a hatch: start_exit)
		exit_view(clampf(exit.t, 0, 1))
		return
	if crawl: # on hands and knees through the crawlway: the eye along its path, looking the way you go
		var c: Dictionary = crawl
		var k := ease_ends(clampf(c.t, 0, 1))
		var pos: Vector3 = c.curve.get_point_at(k)
		# (hands and knees: the bob comes in once you're down and dies away before you arrive)
		pos.y += sin(k * PI * 10) * 0.02 * smoothstep3(k, 0.05, 0.18) * (1 - smoothstep3(k, 0.7, 0.85))
		camera.position = pos
		var ahead: Vector3 = c.curve.get_point_at(minf(1, k + 0.08)) - pos
		var lk: float = atan2(-ahead.x, -ahead.z) if Vector2(ahead.x, ahead.z).length() > 0.02 else c.p.yaw
		# (turning from where you looked to the way through, and at the end the way you come out facing)
		var w0 := smoothstep3(k, 0, 0.18)
		var w1 := smoothstep3(k, 0.8, 1)
		var cp := clampf(atan2(ahead.y, Vector2(ahead.x, ahead.z).length()) * 0.6, -0.9, 0.6)
		camera.quaternion = _euler(c.pitch0, c.yaw0).slerp(_euler(cp, lk), w0).slerp(_euler(0, c.p.yaw), w1)
		return
	var t := smoothstep3(blend, 0, 1)
	var s = station if station else last_station
	if station:
		last_station = station
	if not s or t == 0:
		camera.position = walk_pos
		camera.quaternion = walk_rot
		return
	if station and station.get("fin_cut"): # (the radio gun: not down into the fin and tailplane, just astern)
		var yh: float = station.fin_cut[0] * PI / 180
		var pm: float = station.fin_cut[1] * PI / 180
		var k := 1 - absf(s_yaw) / yh
		if k > 0:
			s_pitch = maxf(s_pitch, pm * sqrt(k))
	if station and station.get("round_arc"): # the waist windows: the corners of the gun's arc are cut off by the frame
		var pl: float = s.pitch[1] if s_pitch >= 0 else -s.pitch[0]
		var e := Vector2(s_yaw / s.yaw_lim, s_pitch / pl).length()
		if e > 1:
			s_yaw /= e; s_pitch /= e
	var y: float = s.yaw + s_yaw if station else yaw
	var p: float = s_pitch if station else pitch
	var gun_rot := _euler(p, y)
	if station and not station.get("flies") and (head_yaw or head_pitch): # (free look)
		gun_rot = gun_rot * _euler(head_pitch, head_yaw)
	if station and station.get("flies"): # the view follows the aim through the sky, steady while the plane banks under you
		gun_rot = (bomber.group.quaternion as Quaternion).inverse() * _euler(clampf(aim_pitch + head_pitch, -1.45, 1.45), aim_yaw + head_yaw)
	if s.get("entry"): # the way in: a crawl, a climb, a step up (and the same way out)
		var e: Dictionary = s.entry
		var pts := [walk_pos]
		for q in e.path:
			pts.append(CrewM._v(q))
		pts.append(eye_at(s))
		var curve := Shapes.CatmullRomCurve3.new(pts, false, "centripetal")
		var k := clampf(blend, 0, 1) # (even pace along the way, not eased)
		var pos: Vector3 = curve.get_point(k)
		if k > 0 and k < 1:
			pos.y += sin(k * PI * 2 * e.bobs) * e.bob * (1 - k * 0.6) # hands and knees
		camera.position = pos
	else:
		camera.position = walk_pos.lerp(eye_at(s), t)
	camera.quaternion = walk_rot.slerp(gun_rot, t)
	if third and station and station.get("flies") and t > 0.999: # third person: out behind your bomber, looking where you fly (C still looks round her)
		camera.quaternion = gun_rot
		camera.position = Vector3(0, 0.5, -1) + gun_rot * Vector3(0, THIRD_UP, THIRD_BACK)
		return
	# recoil shake: small random jolts that die away quickly
	if shake > 0.01: # a flak burst close by: a hard jolt that dies away
		var r := shake * 0.03
		camera.rotate_object_local(Vector3.RIGHT, (randf() - 0.5) * r); camera.rotate_object_local(Vector3.BACK, (randf() - 0.5) * r * 0.6)
		camera.translate_object_local(Vector3(0, (randf() - 0.5) * r * 1.5, 0))
		shake *= exp(-dt * 9)
	recoil *= exp(-dt * 14)
	if recoil > 0.01:
		var r := recoil * 0.0012
		camera.rotate_object_local(Vector3.RIGHT, (randf() - 0.3) * r)
		camera.rotate_object_local(Vector3.UP, (randf() - 0.5) * r)
		camera.translate_object_local(Vector3(0, 0, randf() * r * 6))
