extends RefCounted
# The views the interior test takes, in bomber space, the same in the web game's script (web_views.mjs reads
# views.json, written from this list by the test): a camera at each station's eye looking its way, and points
# along each crawl passage looking along it.

const SUN := Vector3(-0.55, 0.45, 0.35) # the direction to the sun in bomber space (from the left, ahead, up)
const FOV := 70.0 # vertical degrees (the web game's camera)

static func list(Interior) -> Array:
	var out := []
	for s in Interior.STATIONS:
		var pitch := -0.12
		if s.id == "ball": pitch = -0.6
		if s.id == "radio": pitch = 0.6
		if s.id == "bombsight": pitch = -0.9
		var eye: Vector3 = s.eye
		out.append({name = s.id, eye = eye, yaw = s.yaw, pitch = pitch, station = s})
	# along the passages: three points on each, looking along the way
	var i := 0
	for p in Interior.PASSAGES:
		var path: Array = p.path
		for k in [0, path.size() / 2, path.size() - 2]:
			var a := Vector3(path[k][0], path[k][1], path[k][2])
			var b := Vector3(path[k + 1][0], path[k + 1][1], path[k + 1][2])
			var d := (b - a).normalized()
			out.append({name = "passage%d_%d" % [i, k], eye = a, yaw = atan2(-d.x, -d.z), pitch = clampf(asin(d.y), -0.6, 0.6)})
		i += 1
	# and walking: the radio room looking aft into the waist, the waist looking forward, the bomb bay catwalk,
	# the flight deck looking up into the top turret
	out.append({name = "walk_radio", eye = Vector3(0, -0.25, -2.3), yaw = PI, pitch = -0.15})
	out.append({name = "walk_waist", eye = Vector3(0, -0.35, 4.2), yaw = 0.0, pitch = -0.1})
	out.append({name = "walk_bombbay", eye = Vector3(0, 0.0, -2.9), yaw = 0.0, pitch = -0.2})
	out.append({name = "walk_cockpit", eye = Vector3(0.1, 0.95, -6.3), yaw = 0.0, pitch = 0.5})
	return out
