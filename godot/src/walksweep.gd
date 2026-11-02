extends RefCounted
# A test of the walkable inside of the bomber, run with the real movement code (`WalkSweep.walk_sweep(player)`,
# or tests/crew/walksweep.tscn): from a grid of standing spots on every deck it walks a second
# in eight directions and reports every place you can fall through, get stuck, push your body
# through the hull, or put your eye through a wall or the roof. Then it walks the routes a player
# takes, nose to tail and back and out to every station, steering like a player, past the crew.

const Interior := preload("res://src/interior.gd")
const CrewM := preload("res://src/crew.gd")

const R := 0.2
const STEP := 0.42
const MIN_HEADROOM := 0.55
const DT := 1.0 / 60
const STEPS := 50

static func walk_sweep(player) -> Dictionary:
	var it = player.it
	var saved := {feet = player.feet, safe = player.safe, yaw = player.yaw, pitch = player.pitch, enabled = player.enabled, station = player.station, keys = player.keys}
	if player.station:
		player.interact()
	player.enabled = true
	var issues := {}
	var add := func(kind: String, p: Vector3, extra := "") -> void:
		var key := "%s:%.1f:%.1f" % [kind, p.x, p.z]
		if not issues.has(key):
			issues[key] = {kind = kind, x = snappedf(p.x, 0.01), y = snappedf(p.y, 0.01), z = snappedf(p.z, 0.01), extra = extra}
	var cam: Camera3D = player.camera
	var starts := 0
	var runs := 0
	for d in Interior.DECKS:
		var z: float = d.z0 + 0.15
		while z < d.z1 - 0.1:
			var x: float = -d.hw
			while x <= d.hw + 1e-6:
				var ok := true
				if it.floor_at(x, z, d.y + 0.05) < d.y - 0.01: ok = false # no floor there
				elif it.blocked(x, z, R, d.y + STEP, d.y + MIN_HEADROOM): ok = false # something stands there
				elif absf(x) > it.wall_limit(z, d.y + 0.3, d.y + 1.2) - R: ok = false # outside the hull
				elif it.headroom(x, z, d.y, R, STEP) < MIN_HEADROOM: ok = false
				if ok:
					starts += 1
					var start := Vector3(x, d.y, z)
					var moved := 0.0
					for k in 8:
						runs += 1
						player.feet = start; player.safe = start; player.vel = Vector3.ZERO; player.vy = 0.0
						player.cam_y = start.y + player.eye # (standing there: not the eye height of wherever you were before)
						player.yaw = (k / 8.0) * TAU; player.pitch = 0.0
						player.keys = {KeyW = true}
						var top := start.y
						for i in STEPS:
							var before: Vector3 = player.feet
							player.update(DT)
							var f: Vector3 = player.feet
							if f.distance_to(before) > 1: add.call("teleported back (fell out of the world)", before)
							top = f.y if player.vy == 0 else top
							if top - f.y > 0.5: add.call("falls through", f, "from %.2f" % top)
							var lim: float = it.wall_limit(f.z, f.y + 0.3, f.y + maxf(player.eye - 0.25, 0.35)) # (as the movement code measures it: a crouching body is lower)
							if absf(f.x) > lim + 0.02: add.call("body through the hull", f, "|x| %.2f > %.2f" % [absf(f.x), lim])
							var e := cam.position # (bomber space: the camera rides in the bomber)
							var w: float = it.hw_smooth(e.z, e.y)
							if absf(e.x) > w - 0.03: add.call("eye in the wall", f, "eye x %.2f wall %.2f" % [e.x, w])
							var roof: float = it.ceiling_at(e.z, e.x, f.y + 0.3)
							if e.y > roof + 0.02: add.call("eye through the roof", f, "eye %.2f roof %.2f" % [e.y, roof])
						moved = maxf(moved, (player.feet as Vector3).distance_to(start))
					if moved < 0.05: add.call("stuck (cannot walk out)", start)
				x += 0.2
			z += 0.3
	player.keys = saved.keys; player.feet = saved.feet; player.safe = saved.safe; player.yaw = saved.yaw; player.pitch = saved.pitch; player.enabled = saved.enabled
	player.vel = Vector3.ZERO; player.vy = 0.0
	var routes := walk_routes(player, add)
	var all := issues.values()
	var kinds := {}
	for i in all:
		kinds[i.kind] = kinds.get(i.kind, 0) + 1
	return {starts = starts, runs = runs, routes = routes, total = all.size(), by_kind = kinds, issues = all}

## Walk the routes a player takes: nose to the tail gun and back along the walkway (through the doors,
## over the steps, past the crew), then from the walkway to every station's E spot. Steers straight at
## each point like a player holding W. Reports where you're held up over a second, or can't get to.
static func walk_routes(player, add: Callable) -> Array:
	var it = player.it
	var done := []
	var follow := func(name: String, path: Array) -> void:
		player.feet = path[0]; player.safe = path[0]; player.vel = Vector3.ZERO; player.vy = 0.0; player.cam_y = path[0].y + player.eye
		var ok := true
		for target in path.slice(1):
			var t := 0.0
			var best := INF
			var since_best := 0.0
			var flagged := false
			while Vector2(target.x - player.feet.x, target.z - player.feet.z).length() > 0.22:
				player.yaw = atan2(-(target.x - player.feet.x), -(target.z - player.feet.z))
				player.pitch = 0.0
				player.keys = {KeyW = true}
				player.update(DT)
				t += DT
				var d := Vector2(target.x - player.feet.x, target.z - player.feet.z).length()
				if d < best - 0.03:
					best = d; since_best = 0
				else:
					since_best += DT
				if since_best > 1 and not flagged:
					add.call("held up (%s)" % name, player.feet, "on the way to %.2f, %.2f" % [target.x, target.z]); flagged = true
				if t > 10:
					add.call("can't get there (%s)" % name, player.feet, "to %.2f, %.2f" % [target.x, target.z]); ok = false
					break
			if not ok:
				break
		done.append("%s: %s" % [name, "ok" if ok else "FAILED"])
	follow.call("nose to tail", CrewM.CORRIDOR)
	var back: Array = CrewM.CORRIDOR.duplicate()
	back.reverse()
	follow.call("tail to nose", back)
	for s in it.stations: # from the nearest point on the walkway to the station's E spot
		var near: Vector3 = CrewM.CORRIDOR[0]
		for c in CrewM.CORRIDOR:
			if (c as Vector3).distance_to(s.stand) < near.distance_to(s.stand):
				near = c
		follow.call("to the %s" % s.name.to_lower(), [near, s.stand])
	player.keys = {}
	return done
