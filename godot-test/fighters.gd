extends RefCounted
# The Luftwaffe: Bf 109s making passes at the formation. Most come from ahead and high (the head-on attack
# the Jagdwaffe used against the B-17s in 1943), some from the beam and some from astern; each fires as it
# closes, breaks away down and out, and climbs back round for another pass. Hit enough, a fighter smokes,
# then burns and goes down or blows up; another takes its place (the Luftwaffe came up in waves all day).

const COUNT := 24
const SPEED := 165.0     # m/s through the air in the attack (~600 km/h)
const WIND := Vector3(0, 0, 75.0)
const TURN := 0.9        # rad/s at most
const RANGE := 750.0     # m: opens fire inside this
const SETUP := 0
const ATTACK := 1
const BREAK := 2
const DOWN := 3
const GONE := 4

class Fighter:
	var node: Node3D
	var props: Array = []
	var fwd := Vector3.FORWARD
	var roll := 0.0
	var state := SETUP
	var t := 0.0
	var target := 0
	var setup := Vector3.ZERO     # where to start the pass from, relative to the target
	var break_dir := Vector3.DOWN
	var hp := 1.0
	var smoke: GPUParticles3D
	var fire: GPUParticles3D
	var gun_t := 0.0
	var fall := Vector3.ZERO
	var spin := 0.0

var main  # the scene: its bombers, effects and bullets
var list: Array[Fighter] = []
var pos := PackedVector3Array()   # (for the bullets' hit tests)
var alive := PackedByteArray()
var kills := 0
var by_player := 0

func _init(m, scene: PackedScene) -> void:
	main = m
	pos.resize(COUNT)
	alive.resize(COUNT)
	for i in COUNT:
		var f := Fighter.new()
		f.node = scene.instantiate()
		main.add_child(f.node)
		_find_props(f.node, f.props)
		list.append(f)
		_spawn(i, true)

func _find_props(n: Node, into: Array) -> void:
	for c in n.get_children():
		if String(c.name).contains("Blades"):
			into.append(c)
		_find_props(c, into)

# a new pass: pick a bomber (the ones round the player's more often, so there's a fight to see) and a direction
func _choose(f: Fighter) -> void:
	f.target = main.pick_target()
	var r := randf()
	if r < 0.55:   # from ahead and high
		f.setup = Vector3(randf_range(-500, 500), randf_range(350, 800), -randf_range(2200, 2800))
	elif r < 0.85: # from the beam
		f.setup = Vector3(signf(randf() - 0.5) * randf_range(1900, 2400), randf_range(150, 500), randf_range(-600, 300))
	else:          # from astern
		f.setup = Vector3(randf_range(-400, 400), randf_range(200, 600), randf_range(2000, 2500))
	f.state = SETUP
	f.t = 0.0

func _spawn(i: int, first: bool) -> void:
	var f := list[i]
	f.hp = 1.0
	_choose(f)
	var at: Vector3 = main.bomber_pos(f.target) + f.setup
	if not first:
		at += f.setup.normalized() * 2500.0 # (the next wave comes in from well out)
	else:
		at += Vector3(randf_range(-1500, 1500), randf_range(-200, 400), randf_range(-1500, 1500))
	f.node.position = at
	f.fwd = (main.bomber_pos(f.target) - at).normalized()
	f.node.visible = true
	f.state = SETUP
	alive[i] = 1
	pos[i] = at

func hit(i: int, at: Vector3, from_player: bool) -> void:
	var f := list[i]
	if f.state >= DOWN:
		return
	f.hp -= 0.085
	main.fx.sparks(at)
	if f.hp < 0.55 and f.smoke == null:
		f.smoke = main.fx.trail("smoke", f.node.position)
	if f.hp <= 0.0:
		kills += 1
		if from_player:
			by_player += 1
		alive[i] = 0
		if randf() < 0.35: # the fuel tank: gone in a flash
			main.fx.explosion(f.node.position)
			f.node.visible = false
			f.state = GONE
			f.t = 0.0
		else:
			f.state = DOWN
			f.t = 0.0
			f.fall = f.fwd * SPEED + WIND
			f.spin = randf_range(1.5, 3.0) * signf(randf() - 0.5)
			if f.fire == null:
				f.fire = main.fx.trail("fire", f.node.position)

func _steer(f: Fighter, want: Vector3, rate: float, dt: float) -> void:
	var a := f.fwd.angle_to(want)
	var bank := 0.0
	if a > 0.0001:
		var axis := f.fwd.cross(want).normalized()
		var turn := minf(a, rate * dt)
		var before := f.fwd
		f.fwd = f.fwd.rotated(axis, turn).normalized()
		var right := before.cross(Vector3.UP).normalized()
		bank = clampf((f.fwd - before).dot(right) / dt * SPEED / 9.81 * 0.35, -1.3, 1.3)
	f.roll = lerpf(f.roll, bank, minf(1.0, dt * 2.5))

func update(dt: float) -> void:
	for i in COUNT:
		var f := list[i]
		f.t += dt
		var p := f.node.position
		match f.state:
			SETUP:
				var to: Vector3 = main.bomber_pos(f.target) + f.setup - p
				_steer(f, to.normalized(), TURN, dt)
				if to.length() < 350.0 or f.t > 40.0:
					f.state = ATTACK
					f.t = 0.0
			ATTACK:
				var tp: Vector3 = main.bomber_pos(f.target)
				var to := tp - p
				var dist := to.length()
				var want := (to / dist - WIND / SPEED).normalized() # (so its track through the formation runs at the target)
				_steer(f, want, TURN * 0.6, dt)
				var track := (f.fwd * SPEED + WIND).normalized()
				if dist < RANGE and track.angle_to(to) < 0.06:
					f.gun_t -= dt
					while f.gun_t <= 0.0:
						f.gun_t += 0.07
						_fire(f, tp, dist)
				if dist < 160.0 or (dist < 700.0 and track.dot(to) < 0.0) or f.t > 30.0:
					f.state = BREAK
					f.t = 0.0
					var side := f.fwd.cross(Vector3.UP).normalized() * signf(randf() - 0.5)
					f.break_dir = (f.fwd + Vector3(0, -0.9, 0) + side * 0.8).normalized()
			BREAK:
				_steer(f, f.break_dir, TURN * 1.3, dt)
				if f.t > 6.0:
					_choose(f)
			DOWN:
				f.fall.y -= 9.81 * dt
				f.fall = f.fall.lerp(WIND + Vector3(0, f.fall.y, 0), dt * 0.15)
				f.node.position += f.fall * dt
				f.roll += f.spin * dt
				f.fwd = f.fwd.lerp(f.fall.normalized(), dt * 0.4).normalized()
				if f.t > 25.0:
					_retire(i)
				_place(f, dt)
				continue
			GONE:
				if f.t > 3.0:
					_retire(i)
				continue
		f.node.position = p + (f.fwd * SPEED + WIND) * dt
		pos[i] = f.node.position
		_place(f, dt)

func _place(f: Fighter, dt: float) -> void:
	var up := Vector3.UP if absf(f.fwd.y) < 0.98 else Vector3.BACK
	f.node.basis = Basis(f.fwd, -f.roll) * Basis.looking_at(f.fwd, up)
	for pr in f.props:
		pr.rotate_object_local(Vector3.FORWARD, dt * 40.0)
	for t in [f.smoke, f.fire]:
		if t != null:
			t.position = f.node.position - f.fwd * 2.0

func _retire(i: int) -> void:
	var f := list[i]
	main.fx.end_trail(f.smoke)
	main.fx.end_trail(f.fire)
	f.smoke = null
	f.fire = null
	f.roll = 0.0
	_spawn(i, false)

# the two cowl guns and the cannon: the rounds are for show; whether they hit is rolled here
func _fire(f: Fighter, at: Vector3, dist: float) -> void:
	var right := f.fwd.cross(Vector3.UP).normalized()
	var muzzle := f.node.position + f.fwd * 3.0 + right * randf_range(-0.4, 0.4)
	var spread := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.012
	main.bullets.fire(muzzle, (f.fwd + spread).normalized() * 760.0 + f.fwd * SPEED + WIND, 2, -1, true, 1.3)
	if randf() < 0.05 * (1.0 - dist / RANGE):
		main.bomber_hit(f.target, dist / 760.0)
