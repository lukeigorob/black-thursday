extends RefCounted
## Three.js's curves, Path/Shape, ShapeUtils and earcut, ported line for line (r0.186) so geo.gd's
## shape, extrude, lathe and tube come out vertex for vertex the same as the browser game's.
##   const Shapes := preload("res://src/core/shapes.gd")
##   var s := Shapes.Shape.new(); s.move_to(0, 0); s.line_to(1, 0); s.absarc(...); s.holes.append(Shapes.Path.new([...]))
##   var c := Shapes.CatmullRomCurve3.new([Vector3(...), ...]); c.get_point_at(0.5)
## Inside, points are kept in doubles (P2/P3), not Vector2/Vector3 (float32): Three works in doubles, and
## its exact-equality tests (duplicate points, arc ends) would otherwise go differently and change vertex counts.
## Points handed in may be Vector2/Vector3, [x, y] arrays, or P2/P3; points handed back are Vector2/Vector3.

const EPSILON := 2.220446049250313e-16 # Number.EPSILON


## A 2D point in double precision.
class P2:
	var x := 0.0
	var y := 0.0

	func _init(px: float = 0.0, py: float = 0.0) -> void:
		x = px
		y = py

	static func of(v) -> P2:
		if v is P2:
			return v.clone()
		if v is Array or v is PackedFloat64Array or v is PackedFloat32Array:
			return P2.new(v[0], v[1])
		return P2.new(v.x, v.y)

	func clone() -> P2:
		return P2.new(x, y)

	func equals(o) -> bool:
		return x == o.x and y == o.y

	func distance_to(o) -> float:
		var dx: float = x - o.x
		var dy: float = y - o.y
		return sqrt(dx * dx + dy * dy)

	func sub(o) -> P2:
		return P2.new(x - o.x, y - o.y)

	func normalized() -> P2: # Three's normalize: times 1 / (length || 1)
		var l := sqrt(x * x + y * y)
		if l == 0.0:
			l = 1.0
		var k := 1.0 / l
		return P2.new(x * k, y * k)

	func to_vector() -> Vector2:
		return Vector2(x, y)


## A 3D point in double precision.
class P3:
	var x := 0.0
	var y := 0.0
	var z := 0.0

	func _init(px: float = 0.0, py: float = 0.0, pz: float = 0.0) -> void:
		x = px
		y = py
		z = pz

	static func of(v) -> P3:
		if v is Array or v is PackedFloat64Array or v is PackedFloat32Array:
			return P3.new(v[0], v[1], v[2])
		return P3.new(v.x, v.y, v.z)

	func clone() -> P3:
		return P3.new(x, y, z)

	func equals(o) -> bool:
		return x == o.x and y == o.y and z == o.z

	func distance_squared_to(o) -> float:
		var dx: float = x - o.x
		var dy: float = y - o.y
		var dz: float = z - o.z
		return dx * dx + dy * dy + dz * dz

	func distance_to(o) -> float:
		return sqrt(distance_squared_to(o))

	func sub(o) -> P3:
		return P3.new(x - o.x, y - o.y, z - o.z)

	func length() -> float:
		return sqrt(x * x + y * y + z * z)

	func normalized() -> P3:
		var l := length()
		if l == 0.0:
			l = 1.0
		var k := 1.0 / l
		return P3.new(x * k, y * k, z * k)

	func dot(o) -> float:
		return x * o.x + y * o.y + z * o.z

	func cross(b) -> P3: # crossVectors(this, b)
		return P3.new(y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x)

	## applyMatrix4(makeRotationAxis(axis, angle)), Three's way round.
	func rotated(axis: P3, angle: float) -> P3:
		var c := cos(angle)
		var s := sin(angle)
		var t := 1.0 - c
		var ax := axis.x
		var ay := axis.y
		var az := axis.z
		var tx := t * ax
		var ty := t * ay
		return P3.new(
			(tx * ax + c) * x + (tx * ay - s * az) * y + (tx * az + s * ay) * z + 0.0,
			(tx * ay + s * az) * x + (ty * ay + c) * y + (ty * az - s * ax) * z + 0.0,
			(tx * az - s * ay) * x + (ty * az + s * ax) * y + (t * az * az + c) * z + 0.0)

	func to_vector() -> Vector3:
		return Vector3(x, y, z)


## Anything with .x/.y (Vector2, P2) or an [x, y] array, as a P2.
static func p2(v) -> P2:
	return P2.of(v)


# ---------------------------------------------------------------- curves

## Three's Curve: arc-length sampling, point/tangent at u, Frenet frames. 2D and 3D curves share it.
class CurveBase:
	var arc_length_divisions := 200
	var needs_update := false
	var _cache_arc_lengths := PackedFloat64Array()

	func _pt(_t: float):
		push_error("Curve._pt() not implemented")
		return null

	func _pt_at(u: float):
		return _pt(get_u_to_t_mapping(u))

	func _tangent(t: float):
		var delta := 0.0001
		var t1 := t - delta
		var t2 := t + delta
		if t1 < 0:
			t1 = 0
		if t2 > 1:
			t2 = 1
		return _pt(t2).sub(_pt(t1)).normalized()

	func _tangent_at(u: float):
		return _tangent(get_u_to_t_mapping(u))

	## How many pieces CurvePath.get_points cuts this curve into.
	func _resolution(divisions: int) -> int:
		return divisions

	func _pts(divisions: int = 5) -> Array:
		var points := []
		for d in divisions + 1:
			points.append(_pt(float(d) / divisions))
		return points

	func _spaced(divisions: int = 5) -> Array:
		var points := []
		for d in divisions + 1:
			points.append(_pt_at(float(d) / divisions))
		return points

	func get_point(t: float):
		return _pt(t).to_vector()

	func get_point_at(u: float):
		return _pt_at(u).to_vector()

	func get_tangent(t: float):
		return _tangent(t).to_vector()

	func get_tangent_at(u: float):
		return _tangent_at(u).to_vector()

	func get_points(divisions: int = 5) -> Array:
		return _pts(divisions).map(func(p): return p.to_vector())

	func get_spaced_points(divisions: int = 5) -> Array:
		return _spaced(divisions).map(func(p): return p.to_vector())

	func get_length() -> float:
		var lengths := get_lengths()
		return lengths[lengths.size() - 1]

	func get_lengths(divisions: int = -1) -> PackedFloat64Array:
		if divisions < 0:
			divisions = arc_length_divisions
		if _cache_arc_lengths.size() == divisions + 1 and not needs_update:
			return _cache_arc_lengths
		needs_update = false
		var cache := PackedFloat64Array([0.0])
		var last = _pt(0)
		var sum := 0.0
		for p in range(1, divisions + 1):
			var current = _pt(float(p) / divisions)
			sum += current.distance_to(last)
			cache.append(sum)
			last = current
		_cache_arc_lengths = cache
		return cache

	func update_arc_lengths() -> void:
		needs_update = true
		get_lengths()

	func get_u_to_t_mapping(u: float, distance: float = 0.0) -> float:
		var arc_lengths := get_lengths()
		var i := 0
		var il := arc_lengths.size()
		var target := distance if distance != 0.0 else u * arc_lengths[il - 1]
		var low := 0
		var high := il - 1
		while low <= high:
			i = low + (high - low) / 2
			var comparison := arc_lengths[i] - target
			if comparison < 0:
				low = i + 1
			elif comparison > 0:
				high = i - 1
			else:
				high = i
				break
		i = high
		if arc_lengths[i] == target:
			return float(i) / (il - 1)
		var before := arc_lengths[i]
		var after := arc_lengths[i + 1]
		var fraction := (target - before) / (after - before)
		return (i + fraction) / (il - 1)

	## {tangents, normals, binormals}: Arrays of Vector3 (3D curves only).
	func compute_frenet_frames(segments: int, closed: bool = false) -> Dictionary:
		var f := _frames(segments, closed)
		var out := {}
		for k in f:
			out[k] = f[k].map(func(p): return p.to_vector())
		return out

	func _frames(segments: int, closed: bool) -> Dictionary:
		var tangents := []
		var normals := []
		var binormals := []
		for i in segments + 1:
			tangents.append(_tangent_at(float(i) / segments))
		var normal := P3.new()
		var vec: P3
		var mn := 1.7976931348623157e308
		var tx: float = absf(tangents[0].x)
		var ty: float = absf(tangents[0].y)
		var tz: float = absf(tangents[0].z)
		if tx <= mn:
			mn = tx
			normal = P3.new(1, 0, 0)
		if ty <= mn:
			mn = ty
			normal = P3.new(0, 1, 0)
		if tz <= mn:
			normal = P3.new(0, 0, 1)
		vec = tangents[0].cross(normal).normalized()
		normals.append(tangents[0].cross(vec))
		binormals.append(tangents[0].cross(normals[0]))
		for i in range(1, segments + 1):
			normals.append(normals[i - 1].clone())
			binormals.append(binormals[i - 1].clone())
			vec = tangents[i - 1].cross(tangents[i])
			if vec.length() > EPSILON:
				vec = vec.normalized()
				var theta := acos(clampf(tangents[i - 1].dot(tangents[i]), -1, 1))
				normals[i] = normals[i].rotated(vec, theta)
			binormals[i] = tangents[i].cross(normals[i])
		if closed:
			var theta := acos(clampf(normals[0].dot(normals[segments]), -1, 1))
			theta /= segments
			if tangents[0].dot(normals[0].cross(normals[segments])) > 0:
				theta = -theta
			for i in range(1, segments + 1):
				normals[i] = normals[i].rotated(tangents[i], theta * i)
				binormals[i] = tangents[i].cross(normals[i])
		return {tangents = tangents, normals = normals, binormals = binormals}

	# Three's Interpolations.js
	static func catmull_rom(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
		var v0 := (p2 - p0) * 0.5
		var v1 := (p3 - p1) * 0.5
		var t2 := t * t
		var t3 := t * t2
		return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1

	static func quadratic_bezier(t: float, p0: float, p1: float, p2: float) -> float:
		var k := 1 - t
		return k * k * p0 + 2 * (1 - t) * t * p1 + t * t * p2

	static func cubic_bezier(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
		var k := 1 - t
		return k * k * k * p0 + 3 * k * k * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t * p3


class LineCurve extends CurveBase:
	var v1: P2
	var v2: P2

	func _init(a = Vector2(), b = Vector2()) -> void:
		v1 = P2.of(a)
		v2 = P2.of(b)

	func _pt(t: float):
		if t == 1:
			return v2.clone()
		return P2.new((v2.x - v1.x) * t + v1.x, (v2.y - v1.y) * t + v1.y)

	func _pt_at(u: float):
		return _pt(u)

	func _tangent(_t: float):
		return v2.sub(v1).normalized()

	func _tangent_at(u: float):
		return _tangent(u)

	func _resolution(_divisions: int) -> int:
		return 1


class QuadraticBezierCurve extends CurveBase:
	var v0: P2
	var v1: P2
	var v2: P2

	func _init(a = Vector2(), b = Vector2(), c = Vector2()) -> void:
		v0 = P2.of(a)
		v1 = P2.of(b)
		v2 = P2.of(c)

	func _pt(t: float):
		return P2.new(quadratic_bezier(t, v0.x, v1.x, v2.x), quadratic_bezier(t, v0.y, v1.y, v2.y))


class CubicBezierCurve extends CurveBase:
	var v0: P2
	var v1: P2
	var v2: P2
	var v3: P2

	func _init(a = Vector2(), b = Vector2(), c = Vector2(), d = Vector2()) -> void:
		v0 = P2.of(a)
		v1 = P2.of(b)
		v2 = P2.of(c)
		v3 = P2.of(d)

	func _pt(t: float):
		return P2.new(cubic_bezier(t, v0.x, v1.x, v2.x, v3.x), cubic_bezier(t, v0.y, v1.y, v2.y, v3.y))


class SplineCurve extends CurveBase:
	var points: Array = [] # of P2

	func _init(pts: Array = []) -> void:
		for p in pts:
			points.append(P2.of(p))

	func _pt(t: float):
		var p := (points.size() - 1) * t
		var ip := int(floor(p))
		var w := p - ip
		var n := points.size()
		var p0: P2 = points[ip if ip == 0 else ip - 1]
		var p1: P2 = points[ip]
		var p2_: P2 = points[n - 1 if ip > n - 2 else ip + 1]
		var p3: P2 = points[n - 1 if ip > n - 3 else ip + 2]
		return P2.new(catmull_rom(w, p0.x, p1.x, p2_.x, p3.x), catmull_rom(w, p0.y, p1.y, p2_.y, p3.y))

	func _resolution(divisions: int) -> int:
		return divisions * points.size()


class EllipseCurve extends CurveBase:
	var ax := 0.0
	var ay := 0.0
	var x_radius := 1.0
	var y_radius := 1.0
	var start_angle := 0.0
	var end_angle := TAU
	var clockwise := false
	var rotation := 0.0

	func _init(a_x: float = 0, a_y: float = 0, xr: float = 1, yr: float = 1, a_start: float = 0, a_end: float = TAU, a_clockwise: bool = false, a_rotation: float = 0) -> void:
		ax = a_x
		ay = a_y
		x_radius = xr
		y_radius = yr
		start_angle = a_start
		end_angle = a_end
		clockwise = a_clockwise
		rotation = a_rotation

	func _pt(t: float):
		var two_pi := PI * 2
		var delta := end_angle - start_angle
		var same := absf(delta) < EPSILON
		while delta < 0:
			delta += two_pi
		while delta > two_pi:
			delta -= two_pi
		if delta < EPSILON:
			delta = 0.0 if same else two_pi
		if clockwise and not same:
			if delta == two_pi:
				delta = -two_pi
			else:
				delta = delta - two_pi
		var angle := start_angle + t * delta
		var x := ax + x_radius * cos(angle)
		var y := ay + y_radius * sin(angle)
		if rotation != 0:
			var c := cos(rotation)
			var s := sin(rotation)
			var tx := x - ax
			var ty := y - ay
			x = tx * c - ty * s + ax
			y = tx * s + ty * c + ay
		return P2.new(x, y)

	func _resolution(divisions: int) -> int:
		return divisions * 2


## Three's CatmullRomCurve3. `points` are Vector3s, or [x, y, z] arrays to keep them in doubles (a closed
## curve's frames can move by ~1e-3 when its points are rounded to float32, in Three too).
class CatmullRomCurve3 extends CurveBase:
	var points: Array = []
	var closed := false
	var curve_type := "centripetal"
	var tension := 0.5

	func _init(pts: Array = [], is_closed: bool = false, type: String = "centripetal", t: float = 0.5) -> void:
		points = pts
		closed = is_closed
		curve_type = type
		tension = t

	func _pt(t: float):
		var l := points.size()
		var p := (l - (0 if closed else 1)) * t
		var ip := int(floor(p))
		var weight := p - ip
		if closed:
			ip += 0 if ip > 0 else (int(floor(absi(ip) / float(l))) + 1) * l
		elif weight == 0 and ip == l - 1:
			ip = l - 2
			weight = 1
		var p0: P3
		var p3: P3
		if closed or ip > 0:
			p0 = P3.of(points[(ip - 1) % l])
		else:
			var a := P3.of(points[0])
			var b := P3.of(points[1])
			p0 = P3.new(a.x - b.x + a.x, a.y - b.y + a.y, a.z - b.z + a.z)
		var p1 := P3.of(points[ip % l])
		var p2_ := P3.of(points[(ip + 1) % l])
		if closed or ip + 2 < l:
			p3 = P3.of(points[(ip + 2) % l])
		else:
			var a := P3.of(points[l - 1])
			var b := P3.of(points[l - 2])
			p3 = P3.new(a.x - b.x + a.x, a.y - b.y + a.y, a.z - b.z + a.z)
		var cx: PackedFloat64Array
		var cy: PackedFloat64Array
		var cz: PackedFloat64Array
		if curve_type == "centripetal" or curve_type == "chordal":
			var pw := 0.5 if curve_type == "chordal" else 0.25
			var dt0 := pow(p0.distance_squared_to(p1), pw)
			var dt1 := pow(p1.distance_squared_to(p2_), pw)
			var dt2 := pow(p2_.distance_squared_to(p3), pw)
			if dt1 < 1e-4:
				dt1 = 1.0
			if dt0 < 1e-4:
				dt0 = dt1
			if dt2 < 1e-4:
				dt2 = dt1
			cx = _nonuniform(p0.x, p1.x, p2_.x, p3.x, dt0, dt1, dt2)
			cy = _nonuniform(p0.y, p1.y, p2_.y, p3.y, dt0, dt1, dt2)
			cz = _nonuniform(p0.z, p1.z, p2_.z, p3.z, dt0, dt1, dt2)
		else: # "catmullrom"
			cx = _poly(p1.x, p2_.x, tension * (p2_.x - p0.x), tension * (p3.x - p1.x))
			cy = _poly(p1.y, p2_.y, tension * (p2_.y - p0.y), tension * (p3.y - p1.y))
			cz = _poly(p1.z, p2_.z, tension * (p2_.z - p0.z), tension * (p3.z - p1.z))
		return P3.new(_calc(cx, weight), _calc(cy, weight), _calc(cz, weight))

	static func _poly(x0: float, x1: float, t0: float, t1: float) -> PackedFloat64Array:
		return PackedFloat64Array([x0, t0, -3 * x0 + 3 * x1 - 2 * t0 - t1, 2 * x0 - 2 * x1 + t0 + t1])

	static func _nonuniform(x0: float, x1: float, x2: float, x3: float, dt0: float, dt1: float, dt2: float) -> PackedFloat64Array:
		var t1 := (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1
		var t2 := (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2
		t1 *= dt1
		t2 *= dt1
		return _poly(x1, x2, t1, t2)

	static func _calc(c: PackedFloat64Array, t: float) -> float:
		var t2 := t * t
		var t3 := t2 * t
		return c[0] + c[1] * t + c[2] * t2 + c[3] * t3


## A chain of curves (Three's CurvePath).
class CurvePath extends CurveBase:
	var curves: Array = []
	var auto_close := false
	var _cache_lengths := PackedFloat64Array()

	func add(curve) -> void:
		curves.append(curve)

	func close_path():
		var start = curves[0]._pt(0)
		var end = curves[curves.size() - 1]._pt(1)
		if not start.equals(end):
			curves.append(LineCurve.new(end, start))
		return self

	func _pt(t: float):
		var d := t * get_length()
		var lengths := get_curve_lengths()
		var i := 0
		while i < lengths.size():
			if lengths[i] >= d:
				var diff := lengths[i] - d
				var curve = curves[i]
				var seg_len: float = curve.get_length()
				var u := 0.0 if seg_len == 0 else 1 - diff / seg_len
				return curve._pt_at(u)
			i += 1
		return null

	func get_length() -> float:
		var lens := get_curve_lengths()
		return lens[lens.size() - 1]

	func update_arc_lengths() -> void:
		needs_update = true
		_cache_lengths = PackedFloat64Array()
		get_curve_lengths()

	func get_curve_lengths() -> PackedFloat64Array:
		if _cache_lengths.size() == curves.size() and curves.size() > 0:
			return _cache_lengths
		var lengths := PackedFloat64Array()
		var sums := 0.0
		for c in curves:
			sums += c.get_length()
			lengths.append(sums)
		_cache_lengths = lengths
		return lengths

	func _spaced(divisions: int = 40) -> Array:
		var points := []
		for i in divisions + 1:
			points.append(_pt(float(i) / divisions))
		if auto_close:
			points.append(points[0])
		return points

	func _pts(divisions: int = 12) -> Array:
		var points := []
		var last = null
		for curve in curves:
			for point in curve._pts(curve._resolution(divisions)):
				if last != null and last.equals(point):
					continue # no consecutive duplicates
				points.append(point)
				last = point
		if auto_close and points.size() > 1 and not points[points.size() - 1].equals(points[0]):
			points.append(points[0])
		return points

	func get_points(divisions: int = 12) -> Array:
		return _pts(divisions).map(func(p): return p.to_vector())

	func get_spaced_points(divisions: int = 40) -> Array:
		return _spaced(divisions).map(func(p): return p.to_vector())


## Three's Path: a 2D pen (move_to, line_to, arcs, curves).
class Path extends CurvePath:
	var current_point := P2.new()

	func _init(points: Array = []) -> void:
		if not points.is_empty():
			set_from_points(points)

	func set_from_points(points: Array):
		var p0 := P2.of(points[0])
		move_to(p0.x, p0.y)
		for i in range(1, points.size()):
			var p := P2.of(points[i])
			line_to(p.x, p.y)
		return self

	func move_to(x: float, y: float):
		current_point = P2.new(x, y)
		return self

	func line_to(x: float, y: float):
		curves.append(LineCurve.new(current_point.clone(), P2.new(x, y)))
		current_point = P2.new(x, y)
		return self

	func quadratic_curve_to(cpx: float, cpy: float, x: float, y: float):
		curves.append(QuadraticBezierCurve.new(current_point.clone(), P2.new(cpx, cpy), P2.new(x, y)))
		current_point = P2.new(x, y)
		return self

	func bezier_curve_to(cp1x: float, cp1y: float, cp2x: float, cp2y: float, x: float, y: float):
		curves.append(CubicBezierCurve.new(current_point.clone(), P2.new(cp1x, cp1y), P2.new(cp2x, cp2y), P2.new(x, y)))
		current_point = P2.new(x, y)
		return self

	func spline_thru(pts: Array):
		curves.append(SplineCurve.new([current_point.clone()] + pts))
		current_point = P2.of(pts[pts.size() - 1])
		return self

	func arc(x: float, y: float, radius: float, start_angle: float, end_angle: float, clockwise: bool = false):
		absarc(x + current_point.x, y + current_point.y, radius, start_angle, end_angle, clockwise)
		return self

	func absarc(x: float, y: float, radius: float, start_angle: float, end_angle: float, clockwise: bool = false):
		absellipse(x, y, radius, radius, start_angle, end_angle, clockwise)
		return self

	func ellipse(x: float, y: float, x_radius: float, y_radius: float, start_angle: float, end_angle: float, clockwise: bool = false, rotation: float = 0.0):
		absellipse(x + current_point.x, y + current_point.y, x_radius, y_radius, start_angle, end_angle, clockwise, rotation)
		return self

	func absellipse(x: float, y: float, x_radius: float, y_radius: float, start_angle: float, end_angle: float, clockwise: bool = false, rotation: float = 0.0):
		var curve := EllipseCurve.new(x, y, x_radius, y_radius, start_angle, end_angle, clockwise, rotation)
		if curves.size() > 0:
			var first: P2 = curve._pt(0)
			if not first.equals(current_point):
				line_to(first.x, first.y)
		curves.append(curve)
		current_point = curve._pt(1)
		return self


## Three's Shape: a Path outline plus `holes` (an Array of Paths).
class Shape extends Path:
	var holes: Array = []

	func _init(points: Array = []) -> void:
		super(points)

	func _holes_pts(divisions: int) -> Array:
		var out := []
		for h in holes:
			out.append(h._pts(divisions))
		return out

	## {shape: Array of P2, holes: Array of Arrays of P2} (doubles; what geo.gd uses).
	func _extract(divisions: int) -> Dictionary:
		return {shape = _pts(divisions), holes = _holes_pts(divisions)}

	func get_points_holes(divisions: int) -> Array:
		return _holes_pts(divisions).map(func(h): return h.map(func(p): return p.to_vector()))

	## {shape: Array of Vector2, holes: Array of Arrays of Vector2}
	func extract_points(divisions: int) -> Dictionary:
		return {shape = get_points(divisions), holes = get_points_holes(divisions)}


# ---------------------------------------------------------------- ShapeUtils

class ShapeUtils:
	## Signed area of a contour of Vector2s or P2s.
	static func area(contour: Array) -> float:
		var n := contour.size()
		var a := 0.0
		var p := n - 1
		for q in n:
			a += contour[p].x * contour[q].y - contour[q].x * contour[p].y
			p = q
		return a * 0.5

	static func is_clock_wise(pts: Array) -> bool:
		return area(pts) < 0

	## Triangles as [a, b, c] index triples into contour + holes (in that order). Drops a duplicate
	## end point from contour and each hole in place, like Three.
	static func triangulate_shape(contour: Array, holes: Array) -> Array:
		var vertices := PackedFloat64Array()
		var hole_indices := PackedInt32Array()
		_remove_dup_end_pts(contour)
		_add_contour(vertices, contour)
		var hole_index := contour.size()
		for h in holes:
			_remove_dup_end_pts(h)
		for h in holes:
			hole_indices.append(hole_index)
			hole_index += h.size()
			_add_contour(vertices, h)
		var tris := Earcut.triangulate(vertices, hole_indices)
		var faces := []
		for i in range(0, tris.size(), 3):
			faces.append([tris[i], tris[i + 1], tris[i + 2]])
		return faces

	static func _remove_dup_end_pts(points: Array) -> void:
		var l := points.size()
		if l > 2 and points[l - 1].equals(points[0]):
			points.pop_back()

	static func _add_contour(vertices: PackedFloat64Array, contour: Array) -> void:
		for p in contour:
			vertices.append(p.x)
			vertices.append(p.y)


# ---------------------------------------------------------------- earcut

## mapbox/earcut 3.0.2 as Three ships it. Nodes live in parallel arrays (index = node, -1 = null),
## which keeps the linked lists free of reference cycles.
class Earcut:
	var nx := PackedFloat64Array()
	var ny := PackedFloat64Array()
	var ni := PackedInt32Array() # vertex index in the input
	var prv := PackedInt32Array()
	var nxt := PackedInt32Array()
	var zz := PackedInt32Array() # z-order value
	var pz := PackedInt32Array() # prevZ
	var nz := PackedInt32Array() # nextZ
	var steiner := PackedByteArray()
	var tris := PackedInt32Array()

	## Flat [x0, y0, x1, y1, ...] plus where each hole starts (in points) -> triangle indices.
	static func triangulate(data: PackedFloat64Array, hole_indices: PackedInt32Array = PackedInt32Array(), dim: int = 2) -> PackedInt32Array:
		return new()._run(data, hole_indices, dim)

	func _run(data: PackedFloat64Array, hole_indices: PackedInt32Array, dim: int) -> PackedInt32Array:
		var has_holes := hole_indices.size() > 0
		var outer_len := hole_indices[0] * dim if has_holes else data.size()
		var outer := _linked_list(data, 0, outer_len, dim, true)
		if outer == -1 or nxt[outer] == prv[outer]:
			return tris
		var min_x := 0.0
		var min_y := 0.0
		var inv_size := 0.0
		if has_holes:
			outer = _eliminate_holes(data, hole_indices, outer, dim)
		if data.size() > 80 * dim: # big enough for the z-order hash
			min_x = data[0]
			min_y = data[1]
			var max_x := min_x
			var max_y := min_y
			for i in range(dim, outer_len, dim):
				var x := data[i]
				var y := data[i + 1]
				if x < min_x: min_x = x
				if y < min_y: min_y = y
				if x > max_x: max_x = x
				if y > max_y: max_y = y
			inv_size = maxf(max_x - min_x, max_y - min_y)
			inv_size = 32767.0 / inv_size if inv_size != 0 else 0.0
		_earcut_linked(outer, min_x, min_y, inv_size, 0)
		return tris

	@warning_ignore("integer_division")
	func _linked_list(data: PackedFloat64Array, start: int, end: int, dim: int, clockwise: bool) -> int:
		var last := -1
		if clockwise == (_signed_area(data, start, end, dim) > 0):
			var i := start
			while i < end:
				last = _insert_node(i / dim, data[i], data[i + 1], last)
				i += dim
		else:
			var i := end - dim
			while i >= start:
				last = _insert_node(i / dim, data[i], data[i + 1], last)
				i -= dim
		if last != -1 and _equals(last, nxt[last]):
			_remove_node(last)
			last = nxt[last]
		return last

	func _filter_points(start: int, end: int = -1) -> int:
		if start == -1:
			return start
		if end == -1:
			end = start
		var p := start
		var again := false
		while true:
			again = false
			if not steiner[p] and (_equals(p, nxt[p]) or _area(prv[p], p, nxt[p]) == 0):
				_remove_node(p)
				p = prv[p]
				end = p
				if p == nxt[p]:
					break
				again = true
			else:
				p = nxt[p]
			if not (again or p != end):
				break
		return end

	func _earcut_linked(ear: int, min_x: float, min_y: float, inv_size: float, pass_: int) -> void:
		if ear == -1:
			return
		if pass_ == 0 and inv_size != 0:
			_index_curve(ear, min_x, min_y, inv_size)
		var stop := ear
		while prv[ear] != nxt[ear]:
			var prev := prv[ear]
			var next := nxt[ear]
			var is_ear := _is_ear_hashed(ear, min_x, min_y, inv_size) if inv_size != 0 else _is_ear(ear)
			if is_ear:
				tris.append(ni[prev])
				tris.append(ni[ear])
				tris.append(ni[next])
				_remove_node(ear)
				ear = nxt[next] # skipping the next vertex leaves fewer slivers
				stop = nxt[next]
				continue
			ear = next
			if ear == stop:
				if pass_ == 0:
					_earcut_linked(_filter_points(ear), min_x, min_y, inv_size, 1)
				elif pass_ == 1:
					ear = _cure_local_intersections(_filter_points(ear))
					_earcut_linked(ear, min_x, min_y, inv_size, 2)
				elif pass_ == 2:
					_split_earcut(ear, min_x, min_y, inv_size)
				break

	func _is_ear(ear: int) -> bool:
		var a := prv[ear]
		var b := ear
		var c := nxt[ear]
		if _area(a, b, c) >= 0:
			return false
		var ax := nx[a]; var bx := nx[b]; var cx := nx[c]
		var ay := ny[a]; var by := ny[b]; var cy := ny[c]
		var x0 := minf(ax, minf(bx, cx)); var y0 := minf(ay, minf(by, cy))
		var x1 := maxf(ax, maxf(bx, cx)); var y1 := maxf(ay, maxf(by, cy))
		var p := nxt[c]
		while p != a:
			if nx[p] >= x0 and nx[p] <= x1 and ny[p] >= y0 and ny[p] <= y1 and \
					_point_in_triangle_except_first(ax, ay, bx, by, cx, cy, nx[p], ny[p]) and \
					_area(prv[p], p, nxt[p]) >= 0:
				return false
			p = nxt[p]
		return true

	func _is_ear_hashed(ear: int, min_x: float, min_y: float, inv_size: float) -> bool:
		var a := prv[ear]
		var b := ear
		var c := nxt[ear]
		if _area(a, b, c) >= 0:
			return false
		var ax := nx[a]; var bx := nx[b]; var cx := nx[c]
		var ay := ny[a]; var by := ny[b]; var cy := ny[c]
		var x0 := minf(ax, minf(bx, cx)); var y0 := minf(ay, minf(by, cy))
		var x1 := maxf(ax, maxf(bx, cx)); var y1 := maxf(ay, maxf(by, cy))
		var min_z := _z_order(x0, y0, min_x, min_y, inv_size)
		var max_z := _z_order(x1, y1, min_x, min_y, inv_size)
		var p := pz[ear]
		var n := nz[ear]
		while p != -1 and zz[p] >= min_z and n != -1 and zz[n] <= max_z:
			if _blocks(p, a, c, x0, y0, x1, y1, ax, ay, bx, by, cx, cy):
				return false
			p = pz[p]
			if _blocks(n, a, c, x0, y0, x1, y1, ax, ay, bx, by, cx, cy):
				return false
			n = nz[n]
		while p != -1 and zz[p] >= min_z:
			if _blocks(p, a, c, x0, y0, x1, y1, ax, ay, bx, by, cx, cy):
				return false
			p = pz[p]
		while n != -1 and zz[n] <= max_z:
			if _blocks(n, a, c, x0, y0, x1, y1, ax, ay, bx, by, cx, cy):
				return false
			n = nz[n]
		return true

	func _blocks(p: int, a: int, c: int, x0: float, y0: float, x1: float, y1: float, ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> bool:
		return nx[p] >= x0 and nx[p] <= x1 and ny[p] >= y0 and ny[p] <= y1 and p != a and p != c and \
			_point_in_triangle_except_first(ax, ay, bx, by, cx, cy, nx[p], ny[p]) and _area(prv[p], p, nxt[p]) >= 0

	func _cure_local_intersections(start: int) -> int:
		var p := start
		while true:
			var a := prv[p]
			var b := nxt[nxt[p]]
			if not _equals(a, b) and _intersects(a, p, nxt[p], b) and _locally_inside(a, b) and _locally_inside(b, a):
				tris.append(ni[a])
				tris.append(ni[p])
				tris.append(ni[b])
				_remove_node(p)
				_remove_node(nxt[p])
				p = b
				start = b
			p = nxt[p]
			if p == start:
				break
		return _filter_points(p)

	func _split_earcut(start: int, min_x: float, min_y: float, inv_size: float) -> void:
		var a := start
		while true:
			var b := nxt[nxt[a]]
			while b != prv[a]:
				if ni[a] != ni[b] and _is_valid_diagonal(a, b):
					var c := _split_polygon(a, b)
					a = _filter_points(a, nxt[a])
					c = _filter_points(c, nxt[c])
					_earcut_linked(a, min_x, min_y, inv_size, 0)
					_earcut_linked(c, min_x, min_y, inv_size, 0)
					return
				b = nxt[b]
			a = nxt[a]
			if a == start:
				break

	func _eliminate_holes(data: PackedFloat64Array, hole_indices: PackedInt32Array, outer: int, dim: int) -> int:
		var queue := []
		var len := hole_indices.size()
		for i in len:
			var start := hole_indices[i] * dim
			var end := hole_indices[i + 1] * dim if i < len - 1 else data.size()
			var list := _linked_list(data, start, end, dim, false)
			if list == nxt[list]:
				steiner[list] = 1
			queue.append(_get_leftmost(list))
		# JS's sort is stable: a binary insertion sort gives the same order
		for i in range(1, queue.size()):
			var pivot: int = queue[i]
			var left := 0
			var right := i
			while left < right:
				var mid := (left + right) >> 1
				if _compare_xy_slope(pivot, queue[mid]) < 0:
					right = mid
				else:
					left = mid + 1
			queue.remove_at(i)
			queue.insert(left, pivot)
		for h in queue:
			outer = _eliminate_hole(h, outer)
		return outer

	func _compare_xy_slope(a: int, b: int) -> float:
		var result := nx[a] - nx[b]
		if result == 0:
			result = ny[a] - ny[b]
			if result == 0:
				var a_slope := (ny[nxt[a]] - ny[a]) / (nx[nxt[a]] - nx[a])
				var b_slope := (ny[nxt[b]] - ny[b]) / (nx[nxt[b]] - nx[b])
				result = a_slope - b_slope
		return result

	func _eliminate_hole(hole: int, outer: int) -> int:
		var bridge := _find_hole_bridge(hole, outer)
		if bridge == -1:
			return outer
		var bridge_reverse := _split_polygon(bridge, hole)
		_filter_points(bridge_reverse, nxt[bridge_reverse])
		return _filter_points(bridge, nxt[bridge])

	func _find_hole_bridge(hole: int, outer: int) -> int:
		var p := outer
		var hx := nx[hole]
		var hy := ny[hole]
		var qx := -INF
		var m := -1
		if _equals(hole, p):
			return p
		while true:
			if _equals(hole, nxt[p]):
				return nxt[p]
			elif hy <= ny[p] and hy >= ny[nxt[p]] and ny[nxt[p]] != ny[p]:
				var x := nx[p] + (hy - ny[p]) * (nx[nxt[p]] - nx[p]) / (ny[nxt[p]] - ny[p])
				if x <= hx and x > qx:
					qx = x
					m = p if nx[p] < nx[nxt[p]] else nxt[p]
					if x == hx:
						return m
			p = nxt[p]
			if p == outer:
				break
		if m == -1:
			return -1
		var stop := m
		var mx := nx[m]
		var my := ny[m]
		var tan_min := INF
		p = m
		while true:
			if hx >= nx[p] and nx[p] >= mx and hx != nx[p] and \
					_point_in_triangle(hx if hy < my else qx, hy, mx, my, qx if hy < my else hx, hy, nx[p], ny[p]):
				var tan := absf(hy - ny[p]) / (hx - nx[p])
				if _locally_inside(p, hole) and (tan < tan_min or (tan == tan_min and (nx[p] > nx[m] or (nx[p] == nx[m] and _sector_contains_sector(m, p))))):
					m = p
					tan_min = tan
			p = nxt[p]
			if p == stop:
				break
		return m

	func _sector_contains_sector(m: int, p: int) -> bool:
		return _area(prv[m], m, prv[p]) < 0 and _area(nxt[p], m, nxt[m]) < 0

	func _index_curve(start: int, min_x: float, min_y: float, inv_size: float) -> void:
		var p := start
		while true:
			if zz[p] == 0:
				zz[p] = _z_order(nx[p], ny[p], min_x, min_y, inv_size)
			pz[p] = prv[p]
			nz[p] = nxt[p]
			p = nxt[p]
			if p == start:
				break
		nz[pz[p]] = -1
		pz[p] = -1
		_sort_linked(p)

	func _sort_linked(list: int) -> int:
		var in_size := 1
		while true:
			var p := list
			var e := -1
			list = -1
			var tail := -1
			var num_merges := 0
			while p != -1:
				num_merges += 1
				var q := p
				var p_size := 0
				for i in in_size:
					p_size += 1
					q = nz[q]
					if q == -1:
						break
				var q_size := in_size
				while p_size > 0 or (q_size > 0 and q != -1):
					if p_size != 0 and (q_size == 0 or q == -1 or zz[p] <= zz[q]):
						e = p
						p = nz[p]
						p_size -= 1
					else:
						e = q
						q = nz[q]
						q_size -= 1
					if tail != -1:
						nz[tail] = e
					else:
						list = e
					pz[e] = tail
					tail = e
				p = q
			nz[tail] = -1
			in_size *= 2
			if num_merges <= 1:
				break
		return list

	static func _z_order(fx: float, fy: float, min_x: float, min_y: float, inv_size: float) -> int:
		var x := int((fx - min_x) * inv_size)
		var y := int((fy - min_y) * inv_size)
		x = (x | (x << 8)) & 0x00FF00FF
		x = (x | (x << 4)) & 0x0F0F0F0F
		x = (x | (x << 2)) & 0x33333333
		x = (x | (x << 1)) & 0x55555555
		y = (y | (y << 8)) & 0x00FF00FF
		y = (y | (y << 4)) & 0x0F0F0F0F
		y = (y | (y << 2)) & 0x33333333
		y = (y | (y << 1)) & 0x55555555
		return x | (y << 1)

	func _get_leftmost(start: int) -> int:
		var p := start
		var leftmost := start
		while true:
			if nx[p] < nx[leftmost] or (nx[p] == nx[leftmost] and ny[p] < ny[leftmost]):
				leftmost = p
			p = nxt[p]
			if p == start:
				break
		return leftmost

	static func _point_in_triangle(ax: float, ay: float, bx: float, by: float, cx: float, cy: float, px: float, py: float) -> bool:
		return (cx - px) * (ay - py) >= (ax - px) * (cy - py) and \
			(ax - px) * (by - py) >= (bx - px) * (ay - py) and \
			(bx - px) * (cy - py) >= (cx - px) * (by - py)

	static func _point_in_triangle_except_first(ax: float, ay: float, bx: float, by: float, cx: float, cy: float, px: float, py: float) -> bool:
		return not (ax == px and ay == py) and _point_in_triangle(ax, ay, bx, by, cx, cy, px, py)

	static func _truthy(v: float) -> bool: # JS truthiness of a number
		return v != 0 and not is_nan(v)

	func _is_valid_diagonal(a: int, b: int) -> bool:
		return ni[nxt[a]] != ni[b] and ni[prv[a]] != ni[b] and not _intersects_polygon(a, b) and \
			((_locally_inside(a, b) and _locally_inside(b, a) and _middle_inside(a, b) and \
				(_truthy(_area(prv[a], a, prv[b])) or _truthy(_area(a, prv[b], b)))) or \
			(_equals(a, b) and _area(prv[a], a, nxt[a]) > 0 and _area(prv[b], b, nxt[b]) > 0))

	func _area(p: int, q: int, r: int) -> float:
		return (ny[q] - ny[p]) * (nx[r] - nx[q]) - (nx[q] - nx[p]) * (ny[r] - ny[q])

	func _equals(p1: int, p2: int) -> bool:
		return nx[p1] == nx[p2] and ny[p1] == ny[p2]

	func _intersects(p1: int, q1: int, p2: int, q2: int) -> bool:
		var o1 := _sign(_area(p1, q1, p2))
		var o2 := _sign(_area(p1, q1, q2))
		var o3 := _sign(_area(p2, q2, p1))
		var o4 := _sign(_area(p2, q2, q1))
		if o1 != o2 and o3 != o4:
			return true
		if o1 == 0 and _on_segment(p1, p2, q1):
			return true
		if o2 == 0 and _on_segment(p1, q2, q1):
			return true
		if o3 == 0 and _on_segment(p2, p1, q2):
			return true
		if o4 == 0 and _on_segment(p2, q1, q2):
			return true
		return false

	func _on_segment(p: int, q: int, r: int) -> bool:
		return nx[q] <= maxf(nx[p], nx[r]) and nx[q] >= minf(nx[p], nx[r]) and ny[q] <= maxf(ny[p], ny[r]) and ny[q] >= minf(ny[p], ny[r])

	static func _sign(num: float) -> int:
		return 1 if num > 0 else (-1 if num < 0 else 0)

	func _intersects_polygon(a: int, b: int) -> bool:
		var p := a
		while true:
			if ni[p] != ni[a] and ni[nxt[p]] != ni[a] and ni[p] != ni[b] and ni[nxt[p]] != ni[b] and _intersects(p, nxt[p], a, b):
				return true
			p = nxt[p]
			if p == a:
				break
		return false

	func _locally_inside(a: int, b: int) -> bool:
		if _area(prv[a], a, nxt[a]) < 0:
			return _area(a, b, nxt[a]) >= 0 and _area(a, prv[a], b) >= 0
		return _area(a, b, prv[a]) < 0 or _area(a, nxt[a], b) < 0

	func _middle_inside(a: int, b: int) -> bool:
		var p := a
		var inside := false
		var px := (nx[a] + nx[b]) / 2
		var py := (ny[a] + ny[b]) / 2
		while true:
			if ((ny[p] > py) != (ny[nxt[p]] > py)) and ny[nxt[p]] != ny[p] and \
					(px < (nx[nxt[p]] - nx[p]) * (py - ny[p]) / (ny[nxt[p]] - ny[p]) + nx[p]):
				inside = not inside
			p = nxt[p]
			if p == a:
				break
		return inside

	func _split_polygon(a: int, b: int) -> int:
		var a2 := _create_node(ni[a], nx[a], ny[a])
		var b2 := _create_node(ni[b], nx[b], ny[b])
		var an := nxt[a]
		var bp := prv[b]
		nxt[a] = b
		prv[b] = a
		nxt[a2] = an
		prv[an] = a2
		nxt[b2] = a2
		prv[a2] = b2
		nxt[bp] = b2
		prv[b2] = bp
		return b2

	func _insert_node(i: int, x: float, y: float, last: int) -> int:
		var p := _create_node(i, x, y)
		if last == -1:
			prv[p] = p
			nxt[p] = p
		else:
			nxt[p] = nxt[last]
			prv[p] = last
			prv[nxt[last]] = p
			nxt[last] = p
		return p

	func _remove_node(p: int) -> void:
		prv[nxt[p]] = prv[p]
		nxt[prv[p]] = nxt[p]
		if pz[p] != -1:
			nz[pz[p]] = nz[p]
		if nz[p] != -1:
			pz[nz[p]] = pz[p]

	func _create_node(i: int, x: float, y: float) -> int:
		nx.append(x)
		ny.append(y)
		ni.append(i)
		prv.append(-1)
		nxt.append(-1)
		zz.append(0)
		pz.append(-1)
		nz.append(-1)
		steiner.append(0)
		return nx.size() - 1

	static func _signed_area(data: PackedFloat64Array, start: int, end: int, dim: int) -> float:
		var sum := 0.0
		var j := end - dim
		var i := start
		while i < end:
			sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1])
			j = i
			i += dim
		return sum
