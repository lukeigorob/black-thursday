extends Node
# Flying a fighter yourself, a Bf 109, an Fw 190 or a P-47: from the cockpit (cockpit.gd), your view
# fixed to the aircraft as in a real one, so when it banks and rolls the horizon tilts and the world
# turns round you. The mouse moves an aim mark across the screen and the plane flies to it, banking into
# the turn; the reflector gunsight's ring and dot stay on the guns' line. Throttle, the type's real
# guns with ammo and overheating, free look on C (look round without steering), and a chase view only
# once you've been shot down, to watch the end.
# (A Node, where the JS was a plain class with window listeners: main adds it to the tree so it gets the
# keyboard and mouse. `keys` keeps the browser's key codes, "KeyW", "KeyC"..., as main reads them.)

const World := preload("res://src/world.gd")
const Cockpit := preload("res://src/cockpit.gd")
const Weapons := preload("res://src/weapons.gd")

const LOOK := 0.0022 # rad per pixel of mouse movement
const SPREAD := 0.003 # rad: your own guns are better harmonised than the AI's
const HEAT_TIME := 9.0 # s of non-stop fire to overheat; heat lost per s
const COOL := 0.12
const UNJAM := 0.45
# rounds per gun: Bf 109 F: 2 x MG 17 (1,000 each), MG 151/20 (200); P-47D: 8 x .50 (425 each)
# Fw 190 A-8: 2 x MG 131 (475 each), 4 x MG 151/20 (inner 250, outer 140)
const AMMO := {bf109 = [1000, 1000, 200], p47 = [425, 425, 425, 425, 425, 425, 425, 425], fw190 = [475, 475, 250, 250, 140, 140]}
const EYE := {bf109 = Vector3(0, 0.75, -0.8), p47 = Vector3(0, 1.05, -0.2), fw190 = Vector3(0, 0.86, -0.22)} # pilot's eye in the model (as in cockpit.gd)
const PLAYER_TURN := 0.5 # rad/s: the nose follows your aim this fast, in whichever fighter (an escort's combat turn)
const CHASE_BACK := 20.0 # m behind and above: watching your plane go down
const CHASE_UP := 4.5
const THIRD_BACK := 14.0 # m behind and above: the third-person view (V)
const THIRD_UP := 3.2
static var HEAD_YAW := deg_to_rad(150.0) # free look (C) limits, rad
const HEAD_UP := 1.2
const HEAD_DOWN := -0.5
const DEAD_ZONE := 0.002 # rad: no steering inside the dead zone; full turn rate beyond SETTLE
const SETTLE := 0.2
const AIM_MAX := 0.7 # rad: the aim mark can lead the nose by this much at most (~40 degrees: it stays on the screen)
const RETICLE_AT := 3.0 # m ahead of the eye the collimated sight image is drawn (its size scales with it)
# middle click: lock on (aim assist), a toggle (click again to let go). Picks the enemy nearest the aim within
# this cone and range, then draws the aim onto where to point for the bullets to meet him (his lead); the
# mouse still steers on top
static var LOCK_CONE := deg_to_rad(25.0)
const LOCK_RANGE := 1500.0
const LOCK_KEEP := 2200.0
static var LOCK_OFF := deg_to_rad(70.0)
const ASSIST := 3.5

var audio
var active := false
var f = null
var fighters = null
var keys := {}
var aim_yaw := 0.0
var aim_pitch := 0.0
var aim_v := Vector3(0, 0, -1) # where the mouse is taking the plane (world direction)
var cam_q := Quaternion() # the view last frame: the mouse moves the aim across it
var night := 0.0 # instrument glow, 0..1
var plain_sight := false # a plain crosshair instead of the reflector sight (the Options tab)
var third := false # the third-person view instead of the cockpit (V, or the Options tab)
var throttle := 0.85
var firing := false
var zoom := false
var look_scale := 1.0
var free_look := false
var infinite := false # (the Options' infinite ammunition)
var view := "nose"
var head_yaw := 0.0 # free look (hold C), relative to the plane
var head_pitch := 0.0
var cockpits := {}
var reticles := {}
var cam_pos := Vector3.ZERO
var locking := false
var locked = null
var lead_at = null
var stick_x := 0.0
var stick_y := 0.0
var ammo: Array = []
var heat: Array = []
var jammed: Array = []
var timers: Array = []
var shown = null
var wreck_t := 0.0
var wreck_at := Vector3.ZERO
var wreck_v := Vector3.ZERO

func _init(audio_ = null) -> void:
	audio = audio_
	process_mode = Node.PROCESS_MODE_ALWAYS

## The browser's KeyboardEvent.code for a key ("KeyW", "KeyC", "Space"...).
static func code(e: InputEventKey) -> String:
	var s := OS.get_keycode_string(e.physical_keycode)
	return "Key" + s if s.length() == 1 and s >= "A" and s <= "Z" else s

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT: # (the window's blur)
		keys = {}; firing = false; zoom = false; locking = false; locked = null

func _input(e: InputEvent) -> void:
	if e is InputEventKey and not e.echo:
		if e.pressed:
			if active:
				keys[code(e)] = true
		else:
			keys[code(e)] = false
	elif e is InputEventMouseButton:
		if e.pressed:
			if not active:
				return
			if e.button_index == MOUSE_BUTTON_LEFT:
				firing = true
			if e.button_index == MOUSE_BUTTON_MIDDLE: # middle click: lock on / let go
				if locking:
					locking = false; locked = null
				else:
					locking = true
			if e.button_index == MOUSE_BUTTON_RIGHT:
				zoom = true # hold right click: zoom in (main eases the view's FOV)
		else:
			if e.button_index == MOUSE_BUTTON_LEFT:
				firing = false
			if e.button_index == MOUSE_BUTTON_RIGHT:
				zoom = false
	elif e is InputEventMouseMotion:
		if not active or not (Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or free_look):
			return
		var m: Vector2 = e.screen_relative
		if absf(m.x) > 300 or absf(m.y) > 300:
			return # a bogus jump
		if keys.get("KeyC", false): # hold C: turn your head, the plane flies on towards the aim
			head_yaw = clampf(head_yaw - m.x * LOOK * look_scale, -HEAD_YAW, HEAD_YAW)
			head_pitch = clampf(head_pitch - m.y * LOOK * look_scale, HEAD_DOWN, HEAD_UP)
			return
		# the aim moves across the screen as you move the mouse, however the plane is rolled
		var ax := cam_q * Vector3(0, 1, 0)
		var ay := cam_q * Vector3(1, 0, 0)
		aim_v = aim_v.rotated(ax, -m.x * LOOK * look_scale).rotated(ay, -m.y * LOOK * look_scale).normalized()
		limit_aim()

## Take the controls of fighter f (just spawned for you).
func start(f_, fighters_) -> void:
	f = f_
	fighters = fighters_
	f.player = true
	f.state = "player"
	aim_yaw = atan2(-f.dir.x, -f.dir.z)
	aim_pitch = asin(clampf(f.dir.y, -1, 1))
	aim_v = f.dir
	throttle = 0.85
	ammo = AMMO[f.kind].duplicate()
	heat = []; jammed = []; timers = []
	for a in ammo:
		heat.append(0.0); jammed.append(false); timers.append(randf() * 0.05)
	head_yaw = 0; head_pitch = 0
	cam_pos = f.pos - f.dir * CHASE_BACK
	cam_pos.y += CHASE_UP
	active = true

func stop() -> void:
	active = false; firing = false; zoom = false; keys = {}; locking = false; locked = null
	show_cockpit(null)
	for r in reticles.values():
		r.visible = false

## (the cockpit's own hooks: methods on its script, or metas holding Callables)
static func _cp(c: Node, name: String, args: Array) -> void:
	if c.has_method(name):
		c.callv(name, args)
	elif c.has_meta(name):
		(c.get_meta(name) as Callable).callv(args)

func _cockpit(kind: String) -> Node3D:
	if not cockpits.has(kind):
		cockpits[kind] = Cockpit.build_cockpit(kind)
	return cockpits[kind]

func _reticle(kind: String) -> Node3D:
	if not reticles.has(kind):
		reticles[kind] = Cockpit.build_reticle(kind)
	return reticles[kind]

## Every type's cockpit and sight, built now and handed over to be compiled (the loading screen's warm-up).
func warm_parts() -> Array:
	var parts := []
	for kind in ["bf109", "fw190", "p47"]:
		var c := _cockpit(kind)
		var r := _reticle(kind)
		_cp(c, "update", [{speed = 120, alt = 7600, climb = 0, heading = 0, bank = 0, pitch = 0, throttle = 0.8, heat = 0, damage = false, time = 0, stick_x = 0, stick_y = 0}, 1.0])
		parts.append(c); parts.append(r)
	return parts

## The cockpit of `f`'s type round the pilot's eye, in place of the plane's own model (null: none).
func show_cockpit(f_) -> Node3D:
	if shown and shown != f_ and is_instance_valid(shown.obj):
		shown.obj.visible = true
	for c in cockpits.values():
		c.visible = false
	shown = f_
	if not f_:
		return null
	f_.obj.visible = false
	var c := _cockpit(f_.kind)
	c.visible = true
	return c

var alive: bool:
	get: return f != null and f.alive

func aim_dir() -> Vector3:
	return aim_v

## Keep the aim within reach of the nose (it can't wander behind you).
func limit_aim() -> void:
	if not f:
		return
	var a: float = aim_v.angle_to(f.dir)
	if a > AIM_MAX:
		aim_v = aim_v.lerp(f.dir, 1 - AIM_MAX / a).normalized()

## One frame of flight for the player's fighter (called by Fighters.update; it then moves the plane).
func fly(f_, dt: float) -> void:
	var k: Dictionary = f_.k
	throttle = clampf(throttle + ((1 if keys.get("KeyW", false) else 0) - (1 if keys.get("KeyS", false) else 0)) * dt * 0.5, 0, 1)
	# the instructor: turn the nose towards the aim at the type's combat turn rate; the wings bank by themselves
	# (eased in the last few degrees so the nose settles on the aim without a wobble; a tiny dead zone)
	var off: float = f_.dir.angle_to(aim_dir())
	# (every type answers the stick as the escort does: the same turn rate, the same easing)
	f_.steer(aim_v, PLAYER_TURN * minf(1, 0.25 + off / SETTLE), dt, true) # (always: with the aim ahead it rolls the wings level)
	# A / D roll on top of that (a barrel roll, or rolling to look), easing back level when let go
	var roll := (1 if keys.get("KeyA", false) else 0) - (1 if keys.get("KeyD", false) else 0)
	# (kept within half a turn either way: let go after a full roll and it levels out the short way, it doesn't unwind)
	f_.roll = atan2(sin(f_.roll), cos(f_.roll))
	f_.roll = f_.roll - roll * 2.6 * dt if roll else f_.roll * exp(-dt * 3)
	# where the stick is: how far off the nose the aim is, across and up, in the plane's own frame, and the roll keys
	var l: Vector3 = f_.xf.basis.orthonormalized().transposed() * aim_v
	stick_x = clampf(l.x * 4 - roll * 0.8, -1, 1)
	stick_y = clampf(l.y * 4, -1, 1)
	limit_aim()
	# throttle sets the speed it settles at, the same speeds the AI flies the type at: full throttle is
	# its attack speed. Climbing costs speed, diving gains it, up to the AI's top speed in a dive.
	var want := lerpf(k.cruise * 0.75, k.attack, throttle)
	f_.speed += (want - f_.speed) * (1 - exp(-dt * 0.45)) - f_.dir.y * 9.81 * dt * 0.7
	f_.speed = clampf(f_.speed, 70, k.max)
	assist(f_, dt)
	if firing:
		fire_guns(f_, dt)
	else:
		for i in timers.size():
			timers[i] = maxf(timers[i], 0)
	for i in heat.size():
		heat[i] = maxf(0, heat[i] - COOL * dt)
		if jammed[i] and heat[i] < UNJAM:
			jammed[i] = false
	if World.ALTITUDE + f_.pos.y < 30 and f_.alive: # flew into the ground
		fighters.shot_down(f_, "ground")
		fighters.explode(f_)

## The enemies you can lock on to: their fighters, and for a German, the bombers too. [{ obj, pos, vel }]
func enemies(f_) -> Array:
	var out := []
	for x in fighters.list:
		if x != f_ and x.side != f_.side and x.alive:
			out.append({obj = x, pos = x.pos, vel = x.velocity, far = 1.0})
	if f_.side == "axis":
		for b in fighters.bombers:
			if not b.down and not b.gone:
				out.append({obj = b, pos = b.group.position, vel = null, far = 1.4})
	return out

## Middle click (a toggle): lock on to the enemy nearest the aim (within LOCK_CONE and LOCK_RANGE), and draw
## the aim onto his lead, where the guns must point for the bullets to meet him. Click again, or he's down,
## out of range or well off the nose, and the lock's gone.
func assist(f_, dt: float) -> void:
	if not locking or not f_.alive:
		locked = null
		return
	var all := enemies(f_)
	var t = null
	if locked:
		for e in all:
			if e.obj == locked:
				t = e
				break
	if t and (t.pos.distance_to(f_.pos) > LOCK_KEEP * t.far or (t.pos - f_.pos).angle_to(f_.dir) > LOCK_OFF):
		t = null
	if not t and not locked: # (one press, one lock: a target lost stays lost until you press again)
		var best := LOCK_CONE
		for e in all:
			if e.pos.distance_to(f_.pos) > LOCK_RANGE * e.far:
				continue
			var a: float = (e.pos - f_.pos).angle_to(aim_v)
			if a < best:
				best = a; t = e
		if not t:
			locking = false # (nothing there: no lock)
			return
	locked = t.obj if t else null
	if not t:
		locking = false
		return
	# his lead: the direction to point the guns for the bullets to meet him (pull the aim onto it)
	var res := lead_dir(f_, t)
	aim_v = aim_v.lerp(res.dir, 1 - exp(-dt * ASSIST)).normalized()
	limit_aim()

## The intercept: which way to point the guns so a round meets target t ({ pos, vel }). Worked in the air's
## frame (the bullets' drag is against the air): the round leaves at the guns' muzzle speed plus our own
## airspeed, slows under BALLISTICS' quadratic drag and drops under gravity, while he flies on at his
## velocity. A few rounds of fixed-point iteration on the time of flight. Returns { dir: the unit gun line,
## tof } and sets lead_at (world: the meeting point).
func lead_dir(f_, t: Dictionary) -> Dictionary:
	var B: Dictionary = Weapons.BALLISTICS
	var DRAG: float = B.DRAG
	var GRAVITY: float = B.GRAVITY
	var m: float = f_.k.muzzle
	var uf: Vector3 = f_.dir * f_.speed # our airspeed vector (f.velocity less the wind)
	var ut: Vector3 = -B.WIND # his, through the air (a bomber: still over the ground, flying through the air)
	if t.vel != null:
		ut += t.vel
	var r: Vector3 = t.pos - f_.pos # where he is now (air frame, from us)
	var tof: float = r.length() / (m + f_.speed)
	var out := Vector3.ZERO
	for i in 4:
		# where he'll be then, plus the drop to allow for: the line the round must leave on
		out = r + ut * tof
		out.y += 0.5 * GRAVITY * tof * tof
		var d := out.length()
		var e := out / (d if d else 1.0)
		# the round's speed on that line: |v0 e - uf| = m, so v0 = e.uf + sqrt((e.uf)^2 - uf.uf + m^2)
		var eu := e.dot(uf)
		var v0 := eu + sqrt(maxf(0, eu * eu - uf.length_squared() + m * m))
		# with dv/dt = -k v^2 it covers d in (e^(k d) - 1) / (k v0)
		tof = minf(3, (exp(DRAG * d) - 1) / (DRAG * v0))
		out = e
		if i == 3:
			lead_at = t.pos # (world: where he'll be when the rounds arrive)
			if t.vel != null:
				lead_at += t.vel * tof
			out = (e * v0 - uf).normalized() # the gun line: launch velocity less our own speed
	return {dir = out, tof = tof}

## Where the locked target is now (for its brackets on the screen), or null.
var lock_pos:
	get:
		var l = locked
		if not l:
			return null
		if "pos" in l and l.pos is Vector3:
			return l.pos
		if "group" in l and l.group:
			return l.group.position
		return null

func fire_guns(f_, dt: float) -> void:
	var guns: Array = f_.k.guns
	var team := "enemy" if f_.side == "axis" else "allied"
	var vel: Vector3 = f_.velocity
	for i in guns.size():
		var g: Dictionary = guns[i]
		if ammo[i] <= 0 or jammed[i]:
			continue
		timers[i] -= dt
		while timers[i] <= 0 and ammo[i] > 0 and not jammed[i]:
			timers[i] += 60.0 / g.rpm
			var muzzle: Vector3 = f_.xf * g.at
			var d: Vector3 = (Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * (SPREAD * 2) + f_.dir).normalized()
			fighters.bullets.spawn(muzzle, d * f_.k.muzzle + vel, f_.rounds % g.tracer == 0, team, "player", g.cannon, f_, 2.2)
			f_.rounds += 1
			if not infinite:
				ammo[i] -= 1 # (the Options' infinite ammunition)
			heat[i] += 60.0 / g.rpm / HEAT_TIME
			if heat[i] >= 1:
				jammed[i] = true
				audio.overheat()
			if g.cannon or f_.rounds % 2 == 0:
				audio.gunshot(0.9 if g.cannon else 0.55)

## Point a camera at `target` with `up` (Three's camera.up + lookAt), keeping clear of the degenerate cases.
static func _look(camera: Camera3D, target: Vector3, up: Vector3) -> void:
	var d := target - camera.global_position
	if d.length_squared() < 1e-8 or d.normalized().cross(up.normalized()).length_squared() < 1e-8:
		return
	camera.look_at(target, up)

## From the cockpit: the pilot's eye, fixed to the aircraft (the world rolls round you as it banks),
## plus a free look on C. The reflector sight's image sits out ahead on the guns' line.
func update_camera(camera: Camera3D, dt: float) -> void:
	if not f:
		return
	if not keys.get("KeyC", false): # let go of C: the view eases back over the nose (~0.3 s)
		var kk := exp(-dt * 10)
		head_yaw *= kk; head_pitch *= kk
	var fq: Quaternion = f.xf.basis.get_rotation_quaternion()
	var head := Quaternion.from_euler(Vector3(head_pitch, head_yaw, 0)) # (YXZ, as the JS's Euler(..., 'YXZ'))
	if f.alive and third: # third person: behind and above your plane, rolling with it; C swings the view round it
		show_cockpit(null)
		for r in reticles.values():
			r.visible = false
		var q := fq * head
		camera.global_position = f.pos + q * Vector3(0, THIRD_UP, THIRD_BACK)
		_look(camera, f.pos + q * Vector3(0, 0, -60), fq * Vector3.UP)
		cam_q = fq
		cam_pos = camera.global_position
		view = "third"
		return
	if f.alive:
		var c := show_cockpit(f)
		if not c.get_parent() and camera.get_parent():
			camera.get_parent().add_child(c)
		c.transform = f.xf
		cam_pos = f.pos - f.dir * CHASE_BACK # (for the end, if it comes)
		cam_pos.y += CHASE_UP
		camera.global_transform = Transform3D(Basis(fq * head), f.xf * EYE[f.kind])
		cam_q = fq # (the mouse moves the aim across the plane's own view, not the head's)
		view = "look" if absf(head_yaw) + absf(head_pitch) > 0.03 else "aim"
		# the instruments, the stick and throttle, the night glow
		var vel: Vector3 = f.velocity
		var right := fq * Vector3(1, 0, 0)
		var up := fq * Vector3(0, 1, 0)
		_cp(c, "update", [{
			speed = f.speed, alt = World.ALTITUDE + f.pos.y, climb = vel.y, heading = atan2(f.dir.x, -f.dir.z), bank = atan2(-right.y, up.y),
			pitch = asin(clampf(f.dir.y, -1, 1)), throttle = throttle, heat = heat.max(), damage = f.smoking or f.engine_dead,
			time = fighters.time if fighters else 0.0, stick_x = stick_x, stick_y = stick_y, ammo = ammo, ammo_max = AMMO[f.kind],
		}, dt])
		var nk = c.get("night_k") if "night_k" in c else c.get_meta("night_k", null)
		if nk != night:
			if "night_k" in c:
				c.set("night_k", night)
			else:
				c.set_meta("night_k", night)
			_cp(c, "night", [night])
		# the gunsight's image, collimated: out along the guns' line from your eye, facing you
		var r := _reticle(f.kind)
		if not r.get_parent() and camera.get_parent():
			camera.get_parent().add_child(r)
		r.visible = not plain_sight
		var s := RETICLE_AT * tan(deg_to_rad(2.9)) / 0.375 # the ring ~100 mils across
		r.transform = Transform3D(Basis(fq).scaled_local(Vector3(s, s, s)), camera.global_position + f.dir * RETICLE_AT)
		return
	for r in reticles.values():
		r.visible = false
	# shot down: out of the cockpit, to watch your plane go
	show_cockpit(null)
	view = "chase"
	if _is(f.killed_by, "collision") or f.wing_gone or f.tail_gone or f.state == "gone": # torn apart: watch the wreck from a little way off, level, swinging slowly round it
		if not wreck_t: # (where the pieces go: on with her speed, slowing, falling)
			wreck_at = f.pos; wreck_v = f.velocity; cam_pos = camera.global_position
		wreck_t += dt
		wreck_v *= exp(-dt * 0.25); wreck_v.y -= 9.81 * dt * 0.6
		wreck_at += wreck_v * dt
		var a := wreck_t * 0.35
		var rr := 30 + wreck_t * 4
		var t := Vector3(wreck_at.x + sin(a) * rr, wreck_at.y + 8, wreck_at.z + cos(a) * rr)
		cam_pos = cam_pos.lerp(t, 1 - exp(-dt * 5)) + wreck_v * dt
		camera.global_position = cam_pos
		_look(camera, wreck_at, Vector3.UP)
		return
	wreck_t = 0
	var aim: Vector3 = aim_dir() if f.alive else f.dir
	var t: Vector3 = f.pos - aim * CHASE_BACK
	t.y += CHASE_UP
	cam_pos = cam_pos.lerp(t, 1 - exp(-dt * 14))
	# keep up with the plane exactly along its flight (only the offset is smoothed, so it never lags behind)
	camera.global_position = cam_pos
	_look(camera, f.pos + aim * 150, (f.xf.basis * Vector3.UP).normalized()) # (rolled with the plane as it goes down)

static func _is(v, s: String) -> bool:
	return v is String and v == s

## What the HUD needs.
func status(camera: Camera3D) -> Dictionary:
	var parts: Dictionary = f.k.parts
	var have := 0.0
	var mx := 0
	for n in parts:
		have += maxf(0, f.parts[n]) / parts[n].hp
		mx += 1
	var size := camera.get_viewport().get_visible_rect().size
	var cam_fwd := -camera.global_transform.basis.z
	var pt := func(p: Vector3):
		if cam_fwd.dot(p - camera.global_position) <= 0:
			return null
		var s := camera.unproject_position(p) / size
		if absf(s.x * 2 - 1) < 1.2 and absf(s.y * 2 - 1) < 1.2:
			return {x = s.x, y = s.y}
		return null
	# the gunsight sits on the nose (where the guns point); the aim point is where the mouse is taking you
	var marker = pt.call(f.dir * 600 + f.pos)
	var aim = pt.call(aim_dir() * 600 + f.pos)
	var by_type := {}
	var guns: Array = f.k.guns
	for i in guns.size():
		var key := "cannon" if guns[i].cannon else "mg"
		if not by_type.has(key):
			by_type[key] = {n = 0, max = 0}
		by_type[key].n += ammo[i]
		by_type[key].max += AMMO[f.kind][i]
	return {
		kind = f.k.name, view = view, speed = f.speed, alt = (World.ALTITUDE + f.pos.y) * 3.281, throttle = throttle,
		health = have / mx if f.alive else 0.0, heat = heat.max(), jammed = jammed.has(true), ammo = by_type, marker = marker, aim = aim, reflector = not plain_sight and not third,
		damage = "ON FIRE" if f.burning else "ENGINE OUT" if f.engine_dead else "ENGINE HIT" if f.smoking else "",
	}
