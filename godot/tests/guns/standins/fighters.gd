extends RefCounted
# STAND-IN (tests/guns only): the real fighters.gd is the fighters session's. Copied into src/ of a test copy when missing.
static func clock(bomber, p: Vector3) -> Dictionary:
	var d: Vector3 = bomber.group.to_local(p)
	var h := roundi(atan2(-d.x, -d.z) * -6.0 / PI)
	h = ((h % 12) + 12) % 12
	if h == 0:
		h = 12
	var up := maxf(150.0, Vector2(d.x, d.z).length() * 0.14)
	return {h = h, level = "high" if d.y > up else "low" if d.y < -up else "level"}
