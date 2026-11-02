extends RefCounted
# Stand-in for src/bomber.gd (the fighters' test only, until the bombers session's lands): the hit boxes
# (PARTS, exactly as bomber.js has them), AIRSPEED, and a Bomber with just what fighters.gd reads and calls.

const AIRSPEED := 75.0
const ENGINE_X := [-7.16, -3.93, 3.94, 7.15]
const SECTIONS := [["nose", -11.4, -8.6], ["cockpit", -8.6, -6.35], ["bombbay", -6.35, -2.6], ["radio", -2.6, -1.25], ["waist", -1.25, 5.2], ["tail", 5.2, 11.4]]
const HULL := [[-11.6, 0.55, -0.8, 0.5], [-10.6, 0.95, -1.1, 0.85], [-10.0, 1.0, -1.8, 0.95], [-8.6, 1.1, -1.85, 1.0], [-8.0, 1.15, -1.9, 1.05],
	[-6.0, 1.2, -2.0, 1.05], [-4.0, 1.15, -2.2, 0.85], [-2.5, 1.1, -2.3, 0.55], [-1.0, 1.0, -2.45, 0.25], [1.0, 0.95, -2.5, 0.05], [3.0, 0.9, -2.5, -0.2],
	[6.0, 0.82, -2.55, -0.25], [8.5, 0.62, -2.6, -0.8], [10.0, 0.45, -2.62, -1.15], [11.4, 0.3, -2.62, -1.8]]
const WING := [[1.1, 3.0, -6.8, -1.5, -1.65, -0.35], [3.0, 5.5, -6.5, -1.8, -1.55, -0.4], [5.5, 8.0, -6.2, -2.1, -1.45, -0.45],
	[8.0, 10.5, -5.95, -2.1, -1.3, -0.5], [10.5, 13.0, -5.45, -2.25, -1.15, -0.55], [13.0, 15.0, -5.2, -2.35, -1.05, -0.6], [15.0, 16.4, -4.9, -2.6, -1.0, -0.65]]

static func hull_boxes(z0: float, z1: float) -> Array:
	var out := []
	for i in HULL.size() - 1:
		var A: Array = HULL[i]
		var B: Array = HULL[i + 1]
		var lo := maxf(z0, A[0])
		var hi := minf(z1, B[0])
		if hi - lo < 0.01:
			continue
		var at := func(z: float) -> Array:
			var t: float = (z - A[0]) / (B[0] - A[0])
			return [A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, A[3] + (B[3] - A[3]) * t]
		var p1: Array = at.call(lo)
		var p2: Array = at.call(hi)
		var w := maxf(p1[0], p2[0])
		out.append([-w, w, minf(p1[1], p2[1]), maxf(p1[2], p2[2]), lo, hi])
	return out

static func wing_boxes(side: int, from: float, to: float) -> Array:
	var out := []
	for r in WING:
		if r[0] >= from and r[0] < to:
			out.append([-r[1], -r[0], r[4], r[5], r[2], r[3]] if side < 0 else [r[0], r[1], r[4], r[5], r[2], r[3]])
	return out

static func _bounds(boxes: Array) -> Array:
	var b := [INF, -INF, INF, -INF, INF, -INF]
	for q in boxes:
		for k in 6:
			b[k] = minf(b[k], q[k]) if k % 2 == 0 else maxf(b[k], q[k])
	return b

static var PARTS: Array = _parts()
static func _parts() -> Array:
	var fin := [[4.6, 6.0, -0.6, 0.3], [6.0, 6.8, -0.6, 0.9], [6.8, 7.6, -0.8, 1.7], [7.6, 8.3, -0.9, 2.7], [8.3, 10.0, -1.0, 3.05], [10.0, 10.4, -1.1, 2.6]].map(func(r): return [-0.28, 0.28, r[2], r[3], r[0], r[1]])
	var stab := []
	for r in [[0.3, 2.2, 5.9, 9.4], [2.2, 4.4, 6.4, 9.4], [4.4, 6.8, 6.9, 9.3]]:
		stab.append([r[0], r[1], -2.0, -1.3, r[2], r[3]])
		stab.append([-r[1], -r[0], -2.0, -1.3, r[2], r[3]])
	var out := []
	for i in 4:
		var x: float = ENGINE_X[i]
		out.append({name = "engine%d" % (i + 1), kind = "engine", engine = i, boxes = [[x - 0.7, x + 0.7, -1.4, 0.0, -9.1, -4.6]], hp = 32})
	out.append({name = "wingLi", kind = "wing", side = -1, inner = true, boxes = wing_boxes(-1, 0, 8), hp = 70})
	out.append({name = "wingRi", kind = "wing", side = 1, inner = true, boxes = wing_boxes(1, 0, 8), hp = 70})
	out.append({name = "wingLo", kind = "wing", side = -1, boxes = wing_boxes(-1, 8, 99), hp = 80})
	out.append({name = "wingRo", kind = "wing", side = 1, boxes = wing_boxes(1, 8, 99), hp = 80})
	out.append({name = "tailplane", kind = "tail", boxes = fin + stab, hp = 45})
	out.append({name = "ball", kind = "turret", turret = "ball", boxes = [[-0.55, 0.55, -2.95, -1.95, -0.75, 0.5]], hp = 22})
	out.append({name = "top", kind = "turret", turret = "top", boxes = [[-0.62, 0.62, 1.0, 1.75, -7.35, -6.05]], hp = 22})
	for s in SECTIONS:
		var bx := hull_boxes(s[1], s[2])
		if s[0] == "cockpit":
			bx.append([-0.9, 0.9, 1.0, 1.6, -8.4, -6.4])
		out.append({name = s[0], kind = "section", section = s[0], boxes = bx, hp = 60})
	for p in out:
		p.box = _bounds(p.boxes)
	return out

## A fresh stand-in bomber, every part at full strength.
static func make() -> Bomber:
	var b := Bomber.new()
	for p in PARTS:
		b.hp[p.name] = p.hp
	return b

class Bomber:
	var group := Node3D.new()
	var base := Vector3.ZERO
	var down := false
	var gone := false
	var crashed := false
	var straggling := false
	var dead_engines := 0
	var squad = 0
	var off_station := false
	var lost := {}
	var hist_k = 1.0
	var burning := false
	var hp := {}
	var last_hit_by = null
	var last_hit_t := -INF
	var player_hit_t := -INF
	var knock = null
	var down_t := 0.0
	var hits := 0

	func hit(part, cannon) -> void:
		if down:
			return
		hits += 1
		hp[part.name] -= 3 if cannon else 1
		if part.kind == "engine" and hp[part.name] <= 0 and hp[part.name] > -3:
			dead_engines += 1
			straggling = dead_engines >= 2
		if hp[part.name] <= 0 and part.kind != "engine" and part.kind != "turret":
			go_down("%s shot away" % part.name)
		if dead_engines >= 3:
			go_down("Three engines out")

	func go_down(msg: String) -> void:
		if down:
			return
		down = true
		print("B-17 DOWN (squad ", squad, "): ", msg)

	func lose_wing(_side, _inner, msg) -> void:
		go_down(msg)

	func update(dt: float) -> void:
		if down and not gone:
			down_t += dt
			group.position += Vector3(0, -25 * dt, 20 * dt)
			group.rotate_object_local(Vector3(0, 0, 1), dt * 0.3)
			if down_t > 40:
				gone = true
				group.visible = false
		elif not down:
			group.position = base
