extends Control
# Markers over the fighters: red for Bf 109s, blue for P-47s (so you don't shoot a friend), with the
# range. On a gun, enemies within range also get a lead marker: where to aim so the rounds meet them.
# Everything is drawn on one 2D layer over the game, redrawn each frame (no node churn): update() works out
# the marks, _draw() draws them. (The JS drew on its own canvas in the HUD; here Tags is that Control:
# main adds it to the HUD, full screen, under the rest.)

const Weapons := preload("res://src/weapons.gd")

const MAX_RANGE := 2500.0 # m: lead markers only on enemies this close
const LEAD_RANGE := 700.0
const LABEL_RANGE := 1000.0 # m: closer than this a tag shows the range
const BOMBER_RANGE := 1500.0 # flying a fighter: only the nearest B-17s get a tag
const BOMBER_TAGS := 20
const FOE := [255, 74, 58] # red enemies, blue friends, from the player's side
const FRIEND := [80, 170, 255]
const SIM_STEP := 1.0 / 240 # s: bullet flight is integrated like the real rounds (drag, gravity, wind)

const STILL := Vector3.ZERO # the bombers hold their place in the formation's frame

## Where to aim (world space) from `from` so a round meets a target now at `pos` moving at `vel`.
## Iterates: guess the flight time, aim at where the target will be, fly a simulated round there,
## then correct the aim by how far that round missed (drop, drift in the airstream).
static func lead_point(from: Vector3, pos: Vector3, vel: Vector3, shooter_vel = null, muzzle: float = Weapons.BALLISTICS.MUZZLE_SPEED) -> Vector3:
	var B: Dictionary = Weapons.BALLISTICS
	var GRAVITY: float = B.GRAVITY
	var DRAG: float = B.DRAG
	var WIND: Vector3 = B.WIND
	var t := from.distance_to(pos) / muzzle
	var out := pos + vel * t
	var err := Vector3.ZERO
	for it in 3:
		var meet := pos + vel * t # where the target will be
		var aim := meet - err
		var dir := (aim - from).normalized()
		# fly a round at the aim point until it is as far out as the meeting point
		var range_ := from.distance_to(meet)
		var b := from
		var v := dir * muzzle
		if shooter_vel != null:
			v += shooter_vel # a fighter's rounds leave with the fighter's own speed added
		var s := 0.0
		while s < 3 and b.distance_to(from) < range_:
			var r := v - WIND
			var k := DRAG * r.length() * SIM_STEP
			v.x -= r.x * k; v.y -= r.y * k + GRAVITY * SIM_STEP; v.z -= r.z * k
			b += v * SIM_STEP
			s += SIM_STEP
		t = s
		err += b - (pos + vel * t) # how far it missed where the target got to
		out = pos + vel * t - err
	return out

var cam := Vector3.ZERO
var opts := {enemy = true, friend = true, distance = true, lead = true} # (the pause menu's Options: each on its own)
var near_bombers: Array = []
var _marks: Array = [] # what to draw this frame
var _font: Font

func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = ThemeDB.fallback_font

## fighters: the Fighters list. side: the player's side ('allied' | 'axis'). lead: draw lead markers.
## self_: the player's own fighter (not tagged), whose speed and muzzle velocity the lead uses.
## bombers: tagged too while you fly a fighter.
func update(camera: Camera3D, fighters: Array, o := {}) -> void:
	var side: String = o.get("side", "allied")
	var lead: bool = o.get("lead", false)
	var self_ = o.get("self")
	var bombers = o.get("bombers")
	var sz := get_viewport_rect().size
	var w := sz.x
	var h := sz.y
	_marks.clear()
	cam = camera.global_position
	var shooter_vel = self_.velocity if self_ else null
	var muzzle: float = self_.k.muzzle if self_ else Weapons.BALLISTICS.MUZZLE_SPEED
	var tag := func(pos: Vector3, vel: Vector3, foe: bool, big: bool) -> void:
		var d := pos.distance_to(cam)
		if d > (BOMBER_RANGE if big else MAX_RANGE):
			return
		var s = to_screen(pos, camera, w, h)
		if s == null:
			return
		var mark: bool = opts.enemy if foe else opts.friend
		if not mark and not opts.distance and not (foe and opts.lead):
			return
		var c: Array = FOE if foe else FRIEND
		var a := clampf(1 - (d - 600) / (MAX_RANGE - 600) * 0.65, 0.35, 1)
		var col := Color8(c[0], c[1], c[2], int(a * 255))
		# a small down-pointing triangle above the plane, plus the range
		var y: float = s.y - (22.0 if big else 14.0)
		var q := 7.0 if big else 5.0
		var m := {at = s, y = y, q = q, col = col, mark = mark, label = ""}
		if opts.distance and d < LABEL_RANGE:
			m.label = "%d m" % (roundi(d / 10) * 10) # the range only once it's close
		if lead and opts.lead and foe and d < LEAD_RANGE:
			var lp := lead_point(self_.pos if self_ else cam, pos, vel, shooter_vel, muzzle) # rounds start at your guns
			var l = to_screen(lp, camera, w, h)
			if l != null:
				m.lead = l
				m.lead_col = Color8(255, 74, 58, int(minf(1, a + 0.2) * 255))
		_marks.append(m)
	for f in fighters:
		if f.alive and f != self_:
			tag.call(f.pos, f.velocity, f.side != side, false)
	if bombers: # flying a fighter: the nearest B-17s are tagged too (bigger), friend or foe; not all 270
		near_bombers.clear()
		for b in bombers:
			if not b.down and not b.gone and b.group.position.distance_squared_to(cam) < BOMBER_RANGE * BOMBER_RANGE:
				near_bombers.append(b)
		near_bombers.sort_custom(func(p, q): return p.group.position.distance_squared_to(cam) < q.group.position.distance_squared_to(cam))
		for i in mini(near_bombers.size(), BOMBER_TAGS):
			tag.call(near_bombers[i].group.position, STILL, side != "allied", true)
	queue_redraw()

func _draw() -> void:
	for m in _marks:
		var s: Vector2 = m.at
		var y: float = m.y
		var q: float = m.q
		if m.mark:
			draw_polyline(PackedVector2Array([Vector2(s.x - q, y - q - 1), Vector2(s.x + q, y - q - 1), Vector2(s.x, y), Vector2(s.x - q, y - q - 1)]), m.col, 1.5, true)
		if m.label != "":
			var tw := _font.get_string_size(m.label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
			draw_string(_font, Vector2(s.x - tw / 2, y - q - 4), m.label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, m.col)
		if m.has("lead"):
			var l: Vector2 = m.lead
			draw_dashed_line(s, l, m.lead_col, 1.5, 3.0)
			draw_arc(l, 7, 0, TAU, 32, m.lead_col, 1.5, true)
			draw_circle(l, 1.5, m.lead_col)

## Screen position in pixels, or null when behind the camera / off screen.
func to_screen(p: Vector3, camera: Camera3D, w: float, h: float):
	# behind the camera? (tested directly, as the JS did)
	var fwd := -camera.global_transform.basis.z
	if (p - cam).dot(fwd) <= 0.5:
		return null
	var s := camera.unproject_position(p)
	# (|ndc| > 1.1: 5% of the screen past each edge)
	if absf(s.x / w * 2 - 1) > 1.1 or absf(s.y / h * 2 - 1) > 1.1:
		return null
	return s

func clear() -> void:
	_marks.clear()
	queue_redraw()
