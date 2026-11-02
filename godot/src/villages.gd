extends RefCounted
# The villages and little towns of Lower Franconia as they look from the air, painted once into one atlas
# (countryside.gd lays them on the ground and stands the near ones up in 3D from the same plans).
# A village (Haufendorf) is a knot of farmsteads along a few crooked lanes round its church: each farmstead
# a house with its gable to the lane, a stable down one side and a big barn across the back of the yard,
# the kitchen garden behind. Round it all the orchards (Streuobst), fruit trees in rough rows in the grass:
# the dark ring that marks a village from five miles up. Some villages are strung along one street
# (Straßendorf) or round a long green with its pond (Angerdorf); a hamlet is a handful of farms on a bend.
# A small town has its old walled town, packed solid round the market and the church, the old wall a ring
# of trees, and the newer houses in their gardens out along the roads.
# Every roof is weathered red-brown plain tile (some slate, the barns darker), its far slope in shade; the
# buildings and trees throw a soft shadow. The edges fade into the fields the shader draws under them.

const Urban := preload("res://src/urban.gd")
const Canvas2D := preload("res://src/core/canvas2d.gd")

const ATLAS := 4096

static var _seed := 1
static func rnd() -> float:
	_seed = (_seed * 16807) % 2147483647
	return float(_seed) / 2147483647.0
static func rand(a: float, b: float) -> float:
	return a + rnd() * (b - a)
static func pick(a: Array):
	return a[floori(rnd() * a.size())]

const ROOF := ["#9a4f33", "#8c4630", "#a0573a", "#83472f", "#7e4c38", "#944f34", "#88402a", "#a35c3e", "#734a3a"]
const BARN := ["#6e4636", "#68503f", "#5e4638", "#774e36", "#625246", "#7a4f36"]
const SLATE := ["#55565a", "#4d4f54"]
const YARD := ["#5c5244", "#574e41", "#615646"]
const LANE := "#6f6654"
const STREET := "#67605a"
const GRASS := ["#424c2b", "#465030", "#3f492a", "#4a532f"]
const TREE := ["#343f22", "#3a4524", "#4c4c25", "#585024", "#303a20", "#424523", "#5c4e28"]
const GARDEN := ["#5e4e38", "#525e32", "#6a5a40", "#4e5a33", "#6e6248", "#5f6a3a"]

## One village or town's plan, painted on its own canvas. kind: 'hamlet' | 'haufen' | 'strassen' | 'anger' | 'town'.
## Returns { canvas, size (m across), buildings: [{ x, z, len, wid, ang, h, rh, wall, roof, tower? }], spires: [{ x, z, r, h, y }] }.
static func paint_place(kind: String, px: int, s0: int) -> Dictionary:
	_seed = s0
	var S := 520.0 if kind == "hamlet" else 2100.0 if kind == "town" else 1150.0 if kind == "strassen" else 1000.0
	var P := px
	var sc := P / S
	var X := func(m: float) -> float: return P / 2.0 + m * sc
	var main := Canvas2D.new(P, P)
	var g := main
	var shadow_c := Canvas2D.new(P, P)
	var sg := shadow_c
	var mask_c := Canvas2D.new(P, P)
	var mg := mask_c
	var lanes := []
	var plots := []
	var buildings := []
	var trees := []
	var spires := []
	var gardens := []
	var yards := []
	var greens := []

	# ---------------- the lanes ----------------
	var wiggle := func(pts: Array, amp: float) -> Array:
		var o := []
		for i in pts.size():
			o.append(pts[i] if i == 0 or i == pts.size() - 1 else [pts[i][0] + rand(-amp, amp), pts[i][1] + rand(-amp, amp)])
		return o
	var smooth := func(pts: Array, n := 3) -> Array:
		var l := pts
		for it in n:
			var o := [l[0]]
			for k in l.size() - 1:
				var a: float = l[k][0]
				var b: float = l[k][1]
				var c: float = l[k + 1][0]
				var d: float = l[k + 1][1]
				o.append([a * 0.75 + c * 0.25, b * 0.75 + d * 0.25])
				o.append([a * 0.25 + c * 0.75, b * 0.25 + d * 0.75])
			o.append(l[l.size() - 1])
			l = o
		return l
	var ray := func(a: float, r0: float, r1: float, amp := 18.0) -> Array:
		var n := 6
		var pts := []
		for k in n + 1:
			var r := r0 + ((r1 - r0) * k) / n
			var aa := a + sin(k * 0.9) * 0.08
			pts.append([cos(aa) * r, sin(aa) * r])
		return smooth.call(wiggle.call(pts, amp), 2)
	var lane := func(pts: Array, w: float, wide := false) -> Array:
		lanes.append({pts = pts, w = w, wide = wide})
		return pts
	var core := 160.0
	var church = [0.0, 0.0]
	if kind == "haufen" or kind == "hamlet":
		var arms := 2 if kind == "hamlet" else 3 + int(rnd() < 0.6)
		var a0 := rand(0, 6.28)
		for i in arms:
			lane.call(ray.call(a0 + (float(i) / arms) * 6.28 + rand(-0.4, 0.4), 0, S * 0.49, 10.0 if kind == "hamlet" else 22.0), 5.0 if kind == "hamlet" else 7.0)
		if kind == "haufen": # crooked lanes between them, round the middle
			for i in 6:
				var a := rand(0, 6.28)
				var r := rand(60, 200)
				var da := rand(0.7, 1.6)
				var pts := []
				for k in 7:
					var aa := a + (da * k) / 6
					var rr := r * (1 + 0.15 * sin(k))
					pts.append([cos(aa) * rr, sin(aa) * rr])
				lane.call(smooth.call(wiggle.call(pts, 10), 2), 5)
			core = rand(190, 270)
		else:
			core = rand(70, 110)
		church = null if kind == "hamlet" else [rand(-15, 15), rand(-15, 15)]
	elif kind == "strassen" or kind == "anger":
		var L := S * 0.47
		var bend := rand(-50, 50)
		var street: Array = smooth.call(wiggle.call([[-L, 0], [-L * 0.5, bend * 0.5], [0, bend], [L * 0.5, bend * 0.4], [L, 0]], 15), 3)
		if kind == "anger": # the street parts round a long green and meets again
			var gw := rand(28, 40)
			var gl := rand(150, 210)
			var up := []
			var dn := []
			for k in 13:
				var t := -1 + (2.0 * k) / 12
				var x := t * gl
				var half := gw * sqrt(maxf(0, 1 - t * t)) + 6
				up.append([x, bend - half]); dn.append([x, bend + half])
			lane.call(street.filter(func(p): return p[0] < -gl), 7); lane.call(street.filter(func(p): return p[0] > gl), 7)
			lane.call(up, 6); lane.call(dn, 6)
			greens.append({x = 0.0, z = bend, rx = gl, rz = gw})
			church = [rand(-40, 40), bend]
		else:
			lane.call(street, 7)
			church = [rand(-120, 120), bend + rand(-6, 6)]
			if rnd() < 0.7:
				lane.call(smooth.call(wiggle.call([[-L * 0.7, 75], [0, 80 + bend * 0.6], [L * 0.6, 70]], 12), 2), 4) # (the back lane)
		lane.call(ray.call(rand(1.2, 1.9), 25, S * 0.49), 5); lane.call(ray.call(rand(4.3, 5.1), 25, S * 0.49), 5) # (side roads out)
		core = L * 0.8
	else: # the town
		core = 0.0

	# ---------------- the farmsteads along the lanes ----------------
	var near := func(x: float, z: float, r: float) -> bool:
		for p in plots:
			if Vector2(p.x - x, p.z - z).length() < r + p.r:
				return true
		return false
	# (plots as turned rectangles: two overlap unless one of their four axes parts them)
	var overlap := func(a: Dictionary, b: Dictionary) -> bool:
		if Vector2(a.x - b.x, a.z - b.z).length() > a.r + b.r:
			return false
		if not a.get("tx", 0.0) or not b.get("tx", 0.0):
			return Vector2(a.x - b.x, a.z - b.z).length() < minf(a.r, b.r) + 4
		for uu in [[a.tx, a.tz], [a.nx, a.nz], [b.tx, b.tz], [b.nx, b.nz]]:
			var ux: float = uu[0]
			var uz: float = uu[1]
			var ext_a: float = absf(a.tx * ux + a.tz * uz) * a.f / 2 + absf(a.nx * ux + a.nz * uz) * a.D / 2
			var ext_b: float = absf(b.tx * ux + b.tz * uz) * b.f / 2 + absf(b.nx * ux + b.nz * uz) * b.D / 2
			if absf((a.x - b.x) * ux + (a.z - b.z) * uz) > ext_a + ext_b + 1:
				return false
		return true
	var in_plot := func(x: float, z: float) -> bool:
		for p in plots:
			if p.get("tx", 0.0) and absf((x - p.x) * p.tx + (z - p.z) * p.tz) < p.f / 2 and absf((x - p.x) * p.nx + (z - p.z) * p.nz) < p.D / 2:
				return true
		return false
	var lane_dist := func(x: float, z: float, self_) -> float:
		var best := INF
		for l in lanes:
			if not is_same(l, self_):
				best = minf(best, Urban.dist_to_line(x, z, l.pts) - l.w / 2)
		return best
	var farm_ref := [] # (the lambda calls itself through this: a lambda can't name itself)
	var farm := func(l: Dictionary, x: float, z: float, tx: float, tz: float, side: int, small: bool, depth := 0) -> bool:
		var nx := -tz * side
		var nz := tx * side # (away from the lane)
		var f := rand(11, 15) if small else rand(18, 28)
		var yard := 0.0 if small else rand(14, 22)
		var bd := rand(9, 12)
		var gd := 0.0 if depth else rand(8, 26)
		var D := rand(16, 22) if small else yard + bd + gd + 3
		var ox: float = x + nx * (l.w / 2 + 1.5)
		var oz: float = z + nz * (l.w / 2 + 1.5) # the plot's front, at the lane
		var cx := ox + (nx * D) / 2
		var cz := oz + (nz * D) / 2
		var plot := {x = cx, z = cz, r = Vector2(f, D).length() / 2, ox = ox, oz = oz, nx = nx, nz = nz, tx = tx, tz = tz, f = f, D = D}
		var clear := true
		for p in plots:
			if overlap.call(plot, p):
				clear = false
				break
		clear = clear and lane_dist.call(ox + nx * D * 0.75, oz + nz * D * 0.75, l) > 2 and lane_dist.call(cx, cz, l) > 2 and lane_dist.call(ox + nx * D, oz + nz * D, l) > 1 \
			and (church == null or Vector2(cx - church[0], cz - church[1]).length() > 30 + plot.r)
		if not clear:
			if not small and not depth:
				return farm_ref[0].call(l, x, z, tx, tz, side, false, 1) or farm_ref[0].call(l, x, z, tx, tz, side, true, 1)
			return false
		plots.append(plot)
		var at := func(a: float, b: float) -> Array: return [ox + tx * a + nx * b, oz + tz * a + nz * b]
		var angT := atan2(tz, tx)
		var angN := atan2(nz, nx)
		var tile := func() -> String: return pick(SLATE) if rnd() < 0.07 else pick(ROOF)
		if small:
			var hp: Array = at.call(rand(-1, 1), 6.5)
			var len1 := rand(9, 11)
			var wid1 := rand(7, 8)
			var ang1 := angN if rnd() < 0.5 else angT
			buildings.append({x = hp[0], z = hp[1], len = len1, wid = wid1, ang = ang1, h = 5.5, rh = 4.5, roof = tile.call(), wall = 1})
			var sp: Array = at.call(rand(-3, 3), D - 4)
			var len2 := rand(5, 7)
			buildings.append({x = sp[0], z = sp[1], len = len2, wid = 4.5, ang = angT, h = 3.0, rh = 2.5, roof = pick(BARN), wall = 2})
			var gp: Array = at.call(0, D / 2 + 3)
			gardens.append({x = gp[0], z = gp[1], w = f, d = D - 6, ang = angT})
			return true
		var hl := rand(12, 15)
		var hw := rand(8.5, 10.5)
		var hs := -1 if rnd() < 0.5 else 1
		var yp: Array = at.call(0, 1 + yard / 2)
		yards.append({x = yp[0], z = yp[1], w = f, d = yard + 2, ang = angT})
		var bp: Array = at.call(hs * (f / 2 - hw / 2 - 0.5), hl / 2 + 0.5)
		var h1 := rand(6.5, 8.5)
		var rh1 := rand(5.5, 7)
		buildings.append({x = bp[0], z = bp[1], len = hl, wid = hw, ang = angN, h = h1, rh = rh1, roof = tile.call(), wall = 1}) # the house, gable to the lane
		if rnd() < 0.75: # the stable
			var sl := rand(10, yard + 2)
			bp = at.call(-hs * (f / 2 - 3.6), 2 + sl / 2)
			var w2 := rand(6, 7.5)
			var h2 := rand(4, 5)
			buildings.append({x = bp[0], z = bp[1], len = sl, wid = w2, ang = angN, h = h2, rh = 3.5, roof = pick(BARN), wall = 2})
		bp = at.call(rand(-1, 1), yard + 1 + bd / 2)
		var len3 := f - rand(0.5, 3)
		var h3 := rand(6, 8)
		var rh3 := rand(6, 7.5)
		buildings.append({x = bp[0], z = bp[1], len = len3, wid = bd, ang = angT, h = h3, rh = rh3, roof = pick(BARN), wall = 2}) # the barn across the back
		var gp: Array = at.call(0, yard + bd + 2 + gd / 2)
		gardens.append({x = gp[0], z = gp[1], w = f, d = gd, ang = angT})
		# the orchard behind, out into the grass
		var od := rand(15, 70) * (0.5 if kind == "town" else 1.0) if rnd() < 0.5 else 0.0
		var b2 := D + 4
		while b2 < D + od:
			var a2 := -f / 2 + 4
			while a2 < f / 2:
				if rnd() < 0.85:
					var tp: Array = at.call(a2 + rand(-1.5, 1.5), b2 + rand(-1.5, 1.5))
					trees.append([tp[0], tp[1], rand(2.8, 4.2), "orchard"])
				a2 += rand(9, 12)
			b2 += rand(9, 12)
		if od > 15:
			var op: Array = at.call(0, D + od / 2)
			greens.append({x = op[0], z = op[1], w = f + rand(0, 8), d = od + 6, ang = angT, rect = true})
		return true
	farm_ref.append(farm)
	var along_lanes := func(filter: Callable, spacing: float, small: bool) -> void:
		for l in lanes:
			var pts: Array = l.pts
			var acc := rand(0, spacing)
			for k in range(1, pts.size()):
				var ax: float = pts[k - 1][0]
				var az: float = pts[k - 1][1]
				var bx: float = pts[k][0]
				var bz: float = pts[k][1]
				var L := Vector2(bx - ax, bz - az).length()
				var tx := (bx - ax) / L
				var tz := (bz - az) / L
				while acc < L:
					var x := ax + tx * acc
					var z := az + tz * acc
					if filter.call(x, z):
						for side in [-1, 1]:
							if rnd() < 0.93:
								farm.call(l, x, z, tx, tz, side, small or rnd() < 0.15)
					acc += spacing * rand(0.8, 1.25)
				acc -= L
	if kind != "town":
		along_lanes.call(func(x, z): return Vector2(x, z).length() < core * (0.75 + 0.5 * rnd()), 16, false)
		along_lanes.call(func(x, z): return Vector2(x, z).length() < core * 0.9, 12, false) # (and again: the gaps filled)
		along_lanes.call(func(x, z): return Vector2(x, z).length() < core * 1.5 and rnd() < 0.35, 30, true) # (cottages at the ends)

	# ---------------- the town: its walled old town, the newer houses out along the roads ----------------
	var old_town = null
	if kind == "town":
		var rx := rand(250, 320)
		var rz := rand(170, 220)
		var ta := rand(-0.5, 0.5)
		var ca := cos(ta)
		var sa := sin(ta)
		var T := func(u: float, v: float) -> Array: return [u * ca - v * sa, u * sa + v * ca]
		var ph := rand(0, 6.28)
		var ph2 := rand(0, 6.28)
		var rim := func(a: float) -> float: return 1 + 0.07 * sin(3 * a + ph) + 0.045 * sin(5 * a + ph2) # (not an ellipse: the wall followed the ground)
		var inside := func(x: float, z: float) -> bool:
			var u := x * ca + z * sa
			var v := -x * sa + z * ca
			return pow(u / rx, 2) + pow(v / rz, 2) < pow(rim.call(atan2(v / rz, u / rx)), 2)
		old_town = {rx = rx, rz = rz, ta = ta, rim = rim, inside = inside}
		# the streets inside: the main street gate to gate (widening into the market), two along it, lanes across
		lane.call(smooth.call(wiggle.call([T.call(-rx - 30, 0), T.call(-rx * 0.4, rand(-12, 12)), T.call(0, rand(-8, 8)), T.call(rx * 0.45, rand(-12, 12)), T.call(rx + 30, 0)], 8), 2), 10, true)
		for v in [-rz * 0.5, rz * 0.48]:
			lane.call(smooth.call(wiggle.call([T.call(-rx * 0.85, v * 0.8), T.call(-rx * 0.3, v), T.call(rx * 0.35, v * 1.02), T.call(rx * 0.85, v * 0.8)], 6), 2), 6.5)
		for i in 7:
			var u := -rx * 0.75 + (i / 6.0) * rx * 1.5 + rand(-25, 25)
			var top := rnd() < 0.5
			var p0: Array = T.call(u, -rz * 0.95 if top else rand(-rz * 0.6, 0))
			var p1: Array = T.call(u + rand(-25, 25), rand(-20, 20))
			var p2: Array = T.call(u + rand(-45, 45), rand(0, rz * 0.6) if top else rz * 0.95)
			var pts: Array = smooth.call(wiggle.call([p0, p1, p2], 12), 2)
			lane.call(pts, rand(4, 6))
		var ring := []
		for k in 25:
			var a := (k / 24.0) * 6.2832
			var m: float = rim.call(a)
			ring.append(T.call(cos(a) * (rx * m - 8), sin(a) * (rz * m - 8)))
		lane.call(smooth.call(wiggle.call(ring, 3), 1), 5) # (the lane inside the wall)
		church = T.call(rand(-40, 40), -rz * 0.12)
		# the roads out of the gates, and the newer town along them
		var gates := [T.call(-rx - 30, 0), T.call(rx + 30, 0), T.call(rand(-60, 60), -rz - 20), T.call(rand(-60, 60), rz + 20)]
		for gt in gates:
			var gx: float = gt[0]
			var gz: float = gt[1]
			var a := atan2(gz, gx) + rand(-0.3, 0.3)
			lane.call(smooth.call(wiggle.call([[gx, gz], [gx + cos(a) * 300, gz + sin(a) * 300], [cos(a) * S * 0.49, sin(a) * S * 0.49]], 25), 2), 8)
		for i in 5:
			var a := rand(0, 6.28)
			var r := rand(rx + 90, rx + 300)
			var pts := []
			for k in 6:
				var aa := a + k * 0.16
				pts.append([cos(aa) * r * 1.0, sin(aa) * r * 0.8])
			lane.call(smooth.call(wiggle.call(pts, 12), 2), 6)
		# houses shoulder to shoulder along every street of the old town, back buildings behind them
		for l in lanes:
			var pts: Array = l.pts
			for k in range(1, pts.size()):
				var ax: float = pts[k - 1][0]
				var az: float = pts[k - 1][1]
				var bx: float = pts[k][0]
				var bz: float = pts[k][1]
				var L := Vector2(bx - ax, bz - az).length()
				var tx := (bx - ax) / L
				var tz := (bz - az) / L
				var a := 0.0
				while a < L:
					var x := ax + tx * a
					var z := az + tz * a
					for side in [-1, 1]:
						var nx: float = -tz * side
						var nz: float = tx * side
						var d := rand(10, 14)
						var off: float = l.w / 2 + 0.5 + d / 2
						var hx := x + nx * off
						var hz := z + nz * off
						if not inside.call(hx, hz) or Vector2(hx - church[0], hz - church[1]).length() < 40:
							continue
						if l.wide and Vector2(hx, hz).length() < 55:
							continue # (the market)
						var bl := rand(7.5, 10.5)
						var bh := rand(9, 14)
						var brh := rand(5, 7)
						var broof: String = pick(SLATE) if rnd() < 0.1 else pick(ROOF)
						buildings.append({x = hx, z = hz, len = bl, wid = d, ang = atan2(tz, tx), h = bh, rh = brh, roof = broof, wall = 1, town = true})
						if rnd() < 0.55:
							var bb := off + d / 2 + rand(3, 9)
							var l2 := rand(5, 9)
							var w2 := rand(5, 7)
							var a2 := atan2(tz, tx) + (1.5708 if rnd() < 0.5 else 0.0)
							var h2 := rand(4, 7)
							buildings.append({x = x + nx * bb, z = z + nz * bb, len = l2, wid = w2, ang = a2, h = h2, rh = 3.0, roof = pick(BARN), wall = 2, town = true})
					a += rand(7, 11)
		var th: Array = T.call(25, 4)
		buildings.append({x = th[0], z = th[1], len = 26.0, wid = 13.0, ang = ta, h = 12.0, rh = 8.0, roof = pick(SLATE), wall = 3}) # the town hall on the market
		# newer houses in their gardens out along the roads beyond the wall, the odd workshop
		for l in lanes:
			var pts: Array = l.pts
			for k in range(1, pts.size()):
				var ax: float = pts[k - 1][0]
				var az: float = pts[k - 1][1]
				var bx: float = pts[k][0]
				var bz: float = pts[k][1]
				var L := Vector2(bx - ax, bz - az).length()
				var tx := (bx - ax) / L
				var tz := (bz - az) / L
				var a := rand(0, 10)
				while a < L:
					var x := ax + tx * a
					var z := az + tz * a
					var r := Vector2(x, z).length()
					if inside.call(x * 0.88, z * 0.88) or r > rx + 520 + rand(-150, 150):
						a += rand(15, 24)
						continue
					for side in [-1, 1]:
						if rnd() < 0.2:
							continue
						var nx: float = -tz * side
						var nz: float = tx * side
						var off: float = l.w / 2 + rand(5, 9)
						var hx := x + nx * (off + 5)
						var hz := z + nz * (off + 5)
						if near.call(hx, hz, 7) or lane_dist.call(hx, hz, l) < 8:
							continue
						if rnd() < 0.08 and r > rx + 120:
							var wl := rand(20, 40)
							var ww := rand(12, 18)
							var wh := rand(6, 9)
							buildings.append({x = hx + nx * 10, z = hz + nz * 10, len = wl, wid = ww, ang = atan2(tz, tx), h = wh, rh = 2.5, roof = pick(["#6f6c66", "#77746c", "#5f5d58"]), wall = 2})
							plots.append({x = hx + nx * 10, z = hz + nz * 10, r = 18.0})
							continue
						plots.append({x = hx, z = hz, r = 8.0})
						var hl := rand(10, 13)
						var hw := rand(8.5, 10.5)
						var ha := atan2(tz, tx) + (1.5708 if rnd() < 0.3 else 0.0)
						var hh := rand(7, 10)
						var hrh := rand(4.5, 6.5)
						var hroof: String = pick(SLATE) if rnd() < 0.15 else pick(ROOF)
						buildings.append({x = hx, z = hz, len = hl, wid = hw, ang = ha, h = hh, rh = hrh, roof = hroof, wall = 1})
						var gx := hx + nx * 16
						var gz := hz + nz * 16
						var gw2 := rand(14, 20)
						var gd2 := rand(18, 30)
						gardens.append({x = gx, z = gz, w = gw2, d = gd2, ang = atan2(tz, tx)})
						for t in 3:
							if rnd() < 0.7:
								trees.append([gx + rand(-9, 9), gz + rand(-12, 12), rand(2.5, 4), "garden"])
					a += rand(15, 24)
		# the old wall: a ring of trees round the old town (its moat gardens), the orchards and gardens beyond
		for n in 2600: # the back buildings filling the old town's yards
			var x := rand(-rx * 1.1, rx * 1.1)
			var z := rand(-rx * 1.1, rx * 1.1)
			if not inside.call(x, z) or Vector2(x - church[0], z - church[1]).length() < 38 or Vector2(x, z).length() < 50:
				continue
			var ld := INF
			for l in lanes:
				ld = minf(ld, Urban.dist_to_line(x, z, l.pts) - l.w / 2)
			if ld < 3:
				continue
			var bl := rand(5, 11)
			var bw := rand(4.5, 8)
			var ba := ta + (1.5708 if rnd() < 0.5 else 0.0) + rand(-0.2, 0.2)
			var bh := rand(4, 8)
			var brh := rand(2.5, 4)
			var broof: String = pick(BARN) if rnd() < 0.6 else pick(ROOF)
			buildings.append({x = x, z = z, len = bl, wid = bw, ang = ba, h = bh, rh = brh, roof = broof, wall = 2, town = true})
		for k in 140:
			var a := (k / 140.0) * 6.2832
			var m: float = rim.call(a)
			var p: Array = T.call(cos(a) * (rx * m + 14), sin(a) * (rz * m + 14))
			trees.append([p[0] + rand(-2, 2), p[1] + rand(-2, 2), rand(4, 6), "big"])
		for i in 26:
			var a := rand(0, 6.28)
			var r := rand(rx + 250, rx + 560)
			var x := cos(a) * r
			var z := sin(a) * r * 0.85
			var w := rand(40, 110)
			var d := rand(50, 140)
			var ang := rand(0, 3.14)
			var c2 := cos(ang)
			var s2 := sin(ang)
			greens.append({x = x, z = z, w = d, d = w, ang = ang, rect = true})
			var u := -d / 2 + 5
			while u < d / 2:
				var v := -w / 2 + 5
				while v < w / 2:
					if rnd() < 0.8:
						trees.append([x + c2 * u - s2 * v + rand(-1, 1), z + s2 * u + c2 * v + rand(-1, 1), rand(2.8, 4), "orchard"])
					v += rand(8.5, 11)
				u += rand(8.5, 11)
		core = rx + 300

	# ---------------- the church in its walled churchyard, and its linden trees ----------------
	if church != null:
		var cx: float = church[0]
		var cz: float = church[1]
		var a := rand(0, 6.28)
		var big := kind == "town"
		var ca := cos(a)
		var sa := sin(a)
		var nl := 46.0 if big else rand(20, 26)
		var nw := 17.0 if big else rand(9, 11)
		greens.append({x = cx, z = cz, rx = 50.0 if big else 30.0, rz = 44.0 if big else 26.0, ang = a, yard = true})
		buildings.append({x = cx, z = cz, len = nl, wid = nw, ang = a, h = 16.0 if big else 9.0, rh = 12.0 if big else 7.0, roof = pick(SLATE) if big else pick(ROOF), wall = 3})
		var tx := cx - ca * (nl / 2 + 3)
		var tz := cz - sa * (nl / 2 + 3)
		var tw := 11.0 if big else 7.0
		var th := 44.0 if big else rand(20, 26)
		buildings.append({x = tx, z = tz, len = tw, wid = tw, ang = a, h = th, rh = 0.0, roof = "#58554e", wall = 3, tower = true})
		spires.append({x = tx, z = tz, r = tw * 0.62, h = 26.0 if big else rand(10, 15), y = 44.0 if big else th})
		for k in (10 if big else 6):
			var t := rand(0, 6.28)
			var tr1 := rand(18, 44 if big else 26)
			var tr2 := rand(14, 38 if big else 22)
			trees.append([cx + cos(t) * tr1, cz + sin(t) * tr2, rand(4.5, 6.5), "big"])
	# the orchard ring and odd trees round a village (where there's grass and no farm)
	if kind != "town":
		for i in (6 if kind == "hamlet" else 16): # (orchard parcels round the edge: rows of fruit trees in the grass)
			var a := rand(0, 6.28)
			var r := core * rand(0.8, 1.25) + 30
			var x := cos(a) * r
			var z := sin(a) * r
			var w := rand(25, 60)
			var d := rand(40, 90)
			var ang := a + rand(-0.3, 0.3)
			var ca := cos(ang)
			var sa := sin(ang)
			if near.call(x, z, 15):
				continue
			greens.append({x = x, z = z, w = d, d = w, ang = ang, rect = true})
			var u := -d / 2 + 5
			while u < d / 2:
				var v := -w / 2 + 5
				while v < w / 2:
					if rnd() < 0.82:
						trees.append([x + ca * u - sa * v + rand(-1, 1), z + sa * u + ca * v + rand(-1, 1), rand(2.8, 4), "orchard"])
					v += rand(8.5, 11)
				u += rand(8.5, 11)
		for p in plots:
			if rnd() < 0.3:
				trees.append([p.x + rand(-8, 8), p.z + rand(-8, 8), rand(4, 6), "big"]) # (the walnut or linden in the yard)
		# the orchard belt: fruit trees thick in the grass all round the farms (the dark ring that marks a village from the air)
		var ld := func(x: float, z: float) -> float:
			var best := INF
			for l in lanes:
				best = minf(best, Urban.dist_to_line(x, z, l.pts) - l.w / 2)
			return best
		for p in plots:
			if Vector2(p.x, p.z).length() < core * 0.6 and kind != "hamlet":
				continue # (not in the middle of the village)
			for k in 26:
				var a := rand(0, 6.28)
				var d: float = p.r + rand(4, 60 if kind == "hamlet" else 90)
				var x: float = p.x + cos(a) * d
				var z: float = p.z + sin(a) * d
				if in_plot.call(x, z) or ld.call(x, z) < 4 or (church != null and Vector2(x - church[0], z - church[1]).length() < 40):
					continue
				trees.append([x, z, rand(3, 4.6), "orchard"])
				if k % 4 == 0:
					var erx := rand(14, 24)
					var erz := rand(12, 20)
					greens.append({x = x, z = z, rx = erx, rz = erz, ang = rand(0, 3), soft = true})

	for k in range(trees.size() - 1, -1, -1):
		if trees[k][3] == "orchard" and in_plot.call(trees[k][0], trees[k][1]):
			trees.remove_at(k)

	# ---------------- paint ----------------
	var rect := func(ctx, x: float, z: float, w: float, d: float, ang: float) -> void:
		ctx.save(); ctx.translate(X.call(x), X.call(z)); ctx.rotate(ang); ctx.fill_rect((-w / 2) * sc, (-d / 2) * sc, w * sc, d * sc); ctx.restore()
	var ell := func(ctx, e: Dictionary) -> void:
		ctx.begin_path(); ctx.ellipse(X.call(e.x), X.call(e.z), e.rx * sc, e.rz * sc, e.get("ang", 0.0), 0, 7); ctx.fill()
	var stroke := func(ctx, pts: Array, w: float) -> void:
		ctx.line_width = maxf(1, w * sc); ctx.begin_path()
		for i in pts.size():
			if i:
				ctx.line_to(X.call(pts[i][0]), X.call(pts[i][1]))
			else:
				ctx.move_to(X.call(pts[i][0]), X.call(pts[i][1]))
		ctx.stroke()
	g.line_cap = "round"; mg.line_cap = "round"; g.line_join = "round"; mg.line_join = "round"
	# the mask: where the village is (its plots, its grass, its lanes, fading out at the ends of the lanes)
	mg.fill_style = "#fff"; mg.stroke_style = "#fff"
	for p in plots:
		mg.begin_path(); mg.arc(X.call(p.x), X.call(p.z), (p.r + 6) * sc, 0, 7); mg.fill()
	for e in greens:
		if e.get("rect", false):
			rect.call(mg, e.x, e.z, e.w + 6, e.d + 6, e.ang)
		else:
			var e2: Dictionary = e.duplicate()
			e2.rx = e.rx + 4; e2.rz = e.rz + 4
			ell.call(mg, e2)
	for b in buildings:
		rect.call(mg, b.x, b.z, b.len + 8, b.wid + 8, b.ang)
	for t in trees:
		mg.begin_path(); mg.arc(X.call(t[0]), X.call(t[1]), (t[2] + 3) * sc, 0, 7); mg.fill()
	if old_town:
		mg.save(); mg.translate(X.call(0), X.call(0)); mg.rotate(old_town.ta); mg.begin_path(); mg.ellipse(0, 0, (old_town.rx * 1.12 + 22) * sc, (old_town.rz * 1.12 + 22) * sc, 0, 0, 7); mg.fill(); mg.restore()
	for l in lanes:
		stroke.call(mg, l.pts, l.w + 2)
	# the grass under the orchards and round the church, the gardens, the yards
	for e in greens:
		g.fill_style = "#6d7149" if e.get("yard", false) else pick(GRASS)
		if e.get("rect", false):
			rect.call(g, e.x, e.z, e.w, e.d, e.ang)
		else:
			ell.call(g, e)
	if old_town: # the old town's ground (yards, packed), the green ring of the old wall round it
		var rim_path := func(ctx, add: float) -> void:
			ctx.save(); ctx.translate(X.call(0), X.call(0)); ctx.rotate(old_town.ta); ctx.begin_path()
			for k in 65:
				var a := (k / 64.0) * 6.2832
				var m: float = old_town.rim.call(a)
				ctx.line_to(cos(a) * (old_town.rx * m + add) * sc, sin(a) * (old_town.rz * m + add) * sc)
			ctx.restore()
		g.stroke_style = "#56603a"; g.line_width = 26 * sc; rim_path.call(g, 13); g.stroke()
		g.fill_style = "#6a5a4c"; rim_path.call(g, 0); g.fill()
	for gd in gardens: # (beds in strips)
		var n := maxi(2, roundi(gd.w / 4))
		for k in n:
			g.fill_style = pick(GARDEN)
			var ca := cos(gd.ang)
			var sa := sin(gd.ang)
			var o: float = -gd.w / 2 + (k + 0.5) * (gd.w / n)
			rect.call(g, gd.x + ca * o, gd.z + sa * o, gd.w / n - 0.4, gd.d, gd.ang)
	for y in yards:
		g.fill_style = pick(YARD); rect.call(g, y.x, y.z, y.w, y.d, y.ang)
	# the lanes: unmetalled, pale; the town's streets cobbled grey; the market and the churchyard
	for l in lanes:
		g.stroke_style = STREET if l.wide or kind == "town" else LANE; stroke.call(g, l.pts, l.w)
	if kind == "town":
		g.fill_style = STREET; g.begin_path(); g.ellipse(X.call(0), X.call(0), 50 * sc, 34 * sc, old_town.ta, 0, 7); g.fill()
	for e in greens:
		if e.get("yard", false):
			g.stroke_style = "#9a917e"; g.line_width = maxf(1, 1.5 * sc); g.begin_path(); g.ellipse(X.call(e.x), X.call(e.z), e.rx * sc, e.rz * sc, e.ang, 0, 7); g.stroke()
	for e in greens:
		if e.get("pond", false):
			g.fill_style = "#3d4b4c"; ell.call(g, e)
	if kind == "anger":
		for e in greens:
			if not e.get("soft", false) and not e.get("yard", false):
				g.fill_style = "#3d4b4c"; ell.call(g, {x = e.x + e.rx * 0.45, z = e.z, rx = 14.0, rz = 9.0})
				break
	# shadows: every building and tree's, down and to the right a little, blurred (laid on in one go)
	sg.fill_style = "#000"
	var so := 0.55
	for b in buildings:
		var h: float = b.h + b.rh * 0.6
		rect.call(sg, b.x + h * so * 0.6, b.z + h * so, b.len, b.wid, b.ang)
	for t in trees:
		sg.begin_path(); sg.arc(X.call(t[0] + t[2] * 0.9), X.call(t[1] + t[2] * 1.4), t[2] * sc, 0, 7); sg.fill()
	g.save(); g.global_alpha = 0.42; g.filter = "blur(%.1fpx)" % maxf(0.6, 1.2 * sc); g.draw_image(shadow_c, 0, 0); g.restore()
	# the trees: the orchards' fruit trees, bigger ones in the yards and round the church (autumn colours)
	for t in trees:
		var col: String = pick(TREE)
		g.fill_style = col; g.begin_path(); g.arc(X.call(t[0]), X.call(t[1]), t[2] * sc, 0, 7); g.fill()
		if t[2] * sc > 1.6:
			g.fill_style = "rgba(255,240,200,0.13)"; g.begin_path(); g.arc(X.call(t[0] - t[2] * 0.3), X.call(t[1] - t[2] * 0.3), t[2] * 0.55 * sc, 0, 7); g.fill()
	# the roofs: the far slope in shade, the ridge, the weathering
	for b in buildings:
		g.save(); g.translate(X.call(b.x), X.call(b.z)); g.rotate(b.ang)
		var L: float = b.len * sc
		var W: float = b.wid * sc
		g.fill_style = b.roof; g.fill_rect(-L / 2, -W / 2, L, W)
		if not b.get("tower", false) and b.rh > 2.6:
			g.fill_style = "rgba(20,12,8,0.28)"; g.fill_rect(-L / 2, 0, L, W / 2); g.fill_style = "rgba(255,230,200,0.07)"; g.fill_rect(-L / 2, -W / 2, L, W / 2)
		if rnd() < 0.5:
			var dark := rnd() < 0.5
			g.fill_style = "rgba(%s,%.2f)" % ["40,40,36" if dark else "90,80,60", rand(0.05, 0.15)]
			var x0 := -L / 2 + rand(0, L / 2)
			g.fill_rect(x0, -W / 2, L * rand(0.2, 0.5), W)
		g.restore()
	for sp in spires:
		g.fill_style = "#4b5a52"; g.begin_path(); g.arc(X.call(sp.x), X.call(sp.z), sp.r * sc, 0, 7); g.fill()
	# fade the edge into the fields: the mask, blurred
	var fm := Canvas2D.new(P, P)
	var fg := fm
	fg.filter = "blur(%.1fpx)" % (9 * sc); fg.draw_image(mask_c, 0, 0)
	fg.filter = "none"; fg.global_composite_operation = "destination-in"
	var edge = fg.create_radial_gradient(P / 2.0, P / 2.0, P * 0.38, P / 2.0, P / 2.0, P * 0.5)
	edge.add_color_stop(0, "#000"); edge.add_color_stop(1, "#0000")
	fg.fill_style = edge; fg.fill_rect(0, 0, P, P)
	g.global_composite_operation = "destination-in"; g.draw_image(fm, 0, 0); g.global_composite_operation = "source-over"
	return {canvas = main, size = S, buildings = buildings, spires = spires, kind = kind}

## The plans: eight villages and hamlets in the atlas's top half, two towns in the bottom half (each its cell's uv rectangle).
const VARIANTS := [
	["hamlet", 0], ["hamlet", 1], ["haufen", 2], ["haufen", 3], ["haufen", 4], ["strassen", 5], ["strassen", 6], ["anger", 7], ["town", 8], ["town", 9],
]
## The variants each kind of place picks from (hamlet, village, village, town).
const BY_KIND := [[0, 1], [2, 3, 4, 7], [5, 6, 2, 4], [8, 9]]

static func paint_atlas() -> Dictionary:
	var t0 := Time.get_ticks_usec()
	var c := Canvas2D.new(ATLAS, ATLAS)
	var g := c
	var plans := []
	for v in VARIANTS:
		var kind: String = v[0]
		var i: int = v[1]
		var town := kind == "town"
		var px := 2048 if town else 1024
		var cx := (i - 8) * 2048 if town else (i % 4) * 1024
		var cy := 2048 if town else floori(i / 4.0) * 1024
		var p := paint_place(kind, px, 7919 * (i + 3))
		g.draw_image(p.canvas, cx, cy)
		p.canvas = null
		# (uv: Godot's v runs down the image, as the canvas's rows do: the cell's top-left and size)
		p.cell = [float(cx) / ATLAS, float(cy) / ATLAS, float(px) / ATLAS, float(px) / ATLAS]
		plans.append(p)
	return {canvas = c, plans = plans, ms = (Time.get_ticks_usec() - t0) / 1000.0}
