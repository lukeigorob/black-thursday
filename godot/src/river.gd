extends RefCounted
# The Main at Schweinfurt, in the town's own frame (m, the aiming point at 0, 0): where the town (city.gd)
# and the countryside round it (countryside.gd: no village in the river) both need it.

## The river's middle line (z) at x, through the town.
static func river_z(x: float) -> float:
	return -480 + 90 * sin(x / 380) + 40 * sin(x / 150 + 1)

## The Main's course out past the town: the town's own river, swinging into wide meanders beyond it.
static func main_z(x: float) -> float:
	return river_z(x) + 700 * sin(x / 3600) * minf(1, maxf(0, (absf(x) - 1000) / 1600))
