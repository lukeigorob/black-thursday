extends RefCounted
## Three.js's BufferGeometry and its geometry classes (r0.186), ported so the same calls give the same
## vertices, in the same order, with the same normals, uvs and groups:
##   const Geo := preload("res://src/core/geo.gd")
##   var g := Geo.cylinder(0.1, 0.1, 2, 12).rotate_x(PI / 2).translate(0, 1, 0)
##   mesh_instance.mesh = g.to_mesh(material)
## Data stays in Three's conventions (counter-clockwise front faces, v up from the image's bottom) until
## to_mesh(), which turns the triangles round for Godot and flips v.
## Maths runs in doubles like Three's and is stored as float32 like Three's Float32Arrays.

const Shapes := preload("res://src/core/shapes.gd")

var positions := PackedVector3Array()
var normals := PackedVector3Array() # empty = no normal attribute
var uvs := PackedVector2Array() # empty = no uv attribute
var colors := PackedColorArray() # empty = no color attribute (Three's rgb comes in with alpha 1)
var indices := PackedInt32Array() # empty = non-indexed
var groups: Array = [] # of {start, count, material_index}, counted in indices (or vertices if non-indexed)
## Custom per-vertex attributes (Three's setAttribute('aEdge', ...)): custom_size[i] floats a vertex
## (0 = unused), reaching a shader as CUSTOM0..CUSTOM3.
var custom: Array = [PackedFloat32Array(), PackedFloat32Array(), PackedFloat32Array(), PackedFloat32Array()]
var custom_size := PackedInt32Array([0, 0, 0, 0])


# ---------------------------------------------------------------- basics

func vertex_count() -> int:
	return positions.size()

func add_group(start: int, count: int, material_index: int = 0) -> void:
	groups.append({start = start, count = count, material_index = material_index})

func clear_groups():
	groups = []
	return self

## Three's setIndex.
func set_index(idx) -> Variant:
	indices = PackedInt32Array(idx)
	return self

## Three's setAttribute for 'position', 'normal', 'uv' and 'color', from flat numbers or packed vectors.
func set_attribute(name: String, data, item_size: int = 0):
	match name:
		"position": positions = _vec3s(data)
		"normal": normals = _vec3s(data)
		"uv": uvs = _vec2s(data)
		"color": colors = _cols(data, item_size)
		_: push_error("Geo.set_attribute: use set_custom() for '%s'" % name)
	return self

## A custom attribute in slot 0..3: flat floats, size per vertex.
func set_custom(slot: int, data, size: int):
	custom[slot] = PackedFloat32Array(data)
	custom_size[slot] = size
	return self

## Three's deleteAttribute ('normal', 'uv', 'color', or a custom slot number as a string).
func delete_attribute(name: String):
	match name:
		"normal": normals = PackedVector3Array()
		"uv": uvs = PackedVector2Array()
		"color": colors = PackedColorArray()
		"position": positions = PackedVector3Array()
		_:
			var s := int(name)
			custom[s] = PackedFloat32Array()
			custom_size[s] = 0
	return self

func clone():
	var g = new()
	g.positions = positions.duplicate()
	g.normals = normals.duplicate()
	g.uvs = uvs.duplicate()
	g.colors = colors.duplicate()
	g.indices = indices.duplicate()
	g.groups = groups.duplicate(true)
	for i in 4:
		g.custom[i] = custom[i].duplicate()
	g.custom_size = custom_size.duplicate()
	return g

## Three's computeBoundingBox, as an AABB.
func bounding_box() -> AABB:
	if positions.is_empty():
		return AABB()
	var lo := positions[0]
	var hi := positions[0]
	for p in positions:
		lo = lo.min(p)
		hi = hi.max(p)
	return AABB(lo, hi - lo)


# ---------------------------------------------------------------- transforms (Three's applyMatrix4)

## Row-major 3x4 [a00, a01, a02, tx, a10, a11, a12, ty, a20, a21, a22, tz] in doubles.
func _apply(m: PackedFloat64Array):
	for i in positions.size():
		var p := positions[i]
		var x: float = p.x
		var y: float = p.y
		var z: float = p.z
		positions[i] = Vector3(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11])
	if not normals.is_empty():
		# Matrix3.getNormalMatrix: the 3x3's inverse transposed (elements column-major as in Three)
		var n11 := m[0]; var n21 := m[4]; var n31 := m[8]
		var n12 := m[1]; var n22 := m[5]; var n32 := m[9]
		var n13 := m[2]; var n23 := m[6]; var n33 := m[10]
		var t11 := n33 * n22 - n32 * n23
		var t12 := n32 * n13 - n33 * n12
		var t13 := n23 * n12 - n22 * n13
		var det := n11 * t11 + n21 * t12 + n31 * t13
		var e := PackedFloat64Array([0, 0, 0, 0, 0, 0, 0, 0, 0])
		if det != 0:
			var di := 1.0 / det
			e = PackedFloat64Array([
				t11 * di, (n31 * n23 - n33 * n21) * di, (n32 * n21 - n31 * n22) * di,
				t12 * di, (n33 * n11 - n31 * n13) * di, (n31 * n12 - n32 * n11) * di,
				t13 * di, (n21 * n13 - n23 * n11) * di, (n22 * n11 - n21 * n12) * di])
			var s := e[1]; e[1] = e[3]; e[3] = s # transpose
			s = e[2]; e[2] = e[6]; e[6] = s
			s = e[5]; e[5] = e[7]; e[7] = s
		for i in normals.size():
			var n := normals[i]
			var x: float = n.x
			var y: float = n.y
			var z: float = n.z
			normals[i] = _unit(e[0] * x + e[3] * y + e[6] * z, e[1] * x + e[4] * y + e[7] * z, e[2] * x + e[5] * y + e[8] * z)
	return self

func translate(x: float, y: float, z: float):
	return _apply(PackedFloat64Array([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]))

func scale(x: float, y: float, z: float):
	return _apply(PackedFloat64Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]))

func rotate_x(a: float):
	var c := cos(a)
	var s := sin(a)
	return _apply(PackedFloat64Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]))

func rotate_y(a: float):
	var c := cos(a)
	var s := sin(a)
	return _apply(PackedFloat64Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]))

func rotate_z(a: float):
	var c := cos(a)
	var s := sin(a)
	return _apply(PackedFloat64Array([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]))

## Three's applyMatrix4 with a Godot transform.
func apply_transform(t: Transform3D):
	var b := t.basis
	return _apply(PackedFloat64Array([b.x.x, b.y.x, b.z.x, t.origin.x, b.x.y, b.y.y, b.z.y, t.origin.y, b.x.z, b.y.z, b.z.z, t.origin.z]))

## Three's applyMatrix4 with a Matrix4's `elements` (16 numbers, column-major), kept in doubles.
func apply_matrix4(e: Array):
	return _apply(PackedFloat64Array([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]))

## Three's applyQuaternion (Godot's Quaternion has the same x, y, z, w).
func apply_quaternion(q: Quaternion):
	var x: float = q.x
	var y: float = q.y
	var z: float = q.z
	var w: float = q.w
	var x2 := x + x; var y2 := y + y; var z2 := z + z
	var xx := x * x2; var xy := x * y2; var xz := x * z2
	var yy := y * y2; var yz := y * z2; var zz := z * z2
	var wx := w * x2; var wy := w * y2; var wz := w * z2
	return _apply(PackedFloat64Array([
		1 - (yy + zz), xy - wz, xz + wy, 0,
		xy + wz, 1 - (xx + zz), yz - wx, 0,
		xz - wy, yz + wx, 1 - (xx + yy), 0]))

## Three's center(): moves the bounding box's centre to the origin.
func center():
	var bb := bounding_box()
	var lo := bb.position
	var hi := bb.end
	return translate(-((lo.x + hi.x) * 0.5), -((lo.y + hi.y) * 0.5), -((lo.z + hi.z) * 0.5))

func compute_vertex_normals():
	var n := positions.size()
	normals = PackedVector3Array()
	normals.resize(n)
	if not indices.is_empty():
		for i in range(0, indices.size(), 3):
			var va := indices[i]
			var vb := indices[i + 1]
			var vc := indices[i + 2]
			var cb := _face(positions[va], positions[vb], positions[vc])
			for v in [va, vb, vc]:
				var o := normals[v]
				normals[v] = Vector3(o.x + cb[0], o.y + cb[1], o.z + cb[2])
	else:
		for i in range(0, n - n % 3, 3):
			var cb := _face(positions[i], positions[i + 1], positions[i + 2])
			var f := Vector3(cb[0], cb[1], cb[2])
			normals[i] = f
			normals[i + 1] = f
			normals[i + 2] = f
	for i in n:
		var v := normals[i]
		normals[i] = _unit(v.x, v.y, v.z)
	return self

## (C - B) x (A - B) in doubles.
static func _face(a: Vector3, b: Vector3, c: Vector3) -> PackedFloat64Array:
	var cbx: float = c.x - b.x
	var cby: float = c.y - b.y
	var cbz: float = c.z - b.z
	var abx: float = a.x - b.x
	var aby: float = a.y - b.y
	var abz: float = a.z - b.z
	return PackedFloat64Array([cby * abz - cbz * aby, cbz * abx - cbx * abz, cbx * aby - cby * abx])

## Three's toNonIndexed: a new Geo (or this one, unchanged, if it has no index).
func to_non_indexed():
	if indices.is_empty():
		push_warning("Geo.to_non_indexed(): already non-indexed")
		return self
	var g = new()
	for i in indices:
		g.positions.append(positions[i])
	if not normals.is_empty():
		for i in indices:
			g.normals.append(normals[i])
	if not uvs.is_empty():
		for i in indices:
			g.uvs.append(uvs[i])
	if not colors.is_empty():
		for i in indices:
			g.colors.append(colors[i])
	for s in 4:
		var k := custom_size[s]
		if k == 0:
			continue
		var src: PackedFloat32Array = custom[s]
		var dst := PackedFloat32Array()
		for i in indices:
			for c in k:
				dst.append(src[i * k + c])
		g.custom[s] = dst
		g.custom_size[s] = k
	g.groups = groups.duplicate(true)
	return g


## mergeGeometries from three/addons/utils/BufferGeometryUtils.js. All indexed or none, with the same
## attributes; null (and an error) otherwise. Groups only with use_groups, one per geometry.
static func merge(geos: Array, use_groups: bool = false):
	var first = geos[0]
	var indexed: bool = not first.indices.is_empty()
	var out = new()
	var offset := 0
	for i in geos.size():
		var g = geos[i]
		if indexed != (not g.indices.is_empty()):
			push_error("Geo.merge: geometry %d: all geometries must be indexed, or none" % i)
			return null
		if g.normals.is_empty() != first.normals.is_empty() or g.uvs.is_empty() != first.uvs.is_empty() \
				or g.colors.is_empty() != first.colors.is_empty() or g.custom_size != first.custom_size:
			push_error("Geo.merge: geometry %d: all geometries must have the same attributes" % i)
			return null
		if use_groups:
			var count: int = g.indices.size() if indexed else g.positions.size()
			out.add_group(offset, count, i)
			offset += count
	var base := 0
	for g in geos:
		if indexed:
			for j in g.indices:
				out.indices.append(j + base)
		base += g.positions.size()
		out.positions.append_array(g.positions)
		out.normals.append_array(g.normals)
		out.uvs.append_array(g.uvs)
		out.colors.append_array(g.colors)
		for s in 4:
			var c: PackedFloat32Array = out.custom[s]
			c.append_array(g.custom[s])
			out.custom[s] = c
	out.custom_size = first.custom_size.duplicate()
	return out


# ---------------------------------------------------------------- to Godot

## An ArrayMesh. `materials` as in Three: a single Material (or null) draws everything in one surface
## and ignores groups; an Array gives one surface per group, with materials[group.material_index]
## (groups whose material is missing aren't drawn, as in Three). Triangles turn clockwise for Godot
## and v becomes 1 - v, so a texture lands the same way up as Three's flipY'd one.
func to_mesh(materials = null, mesh: ArrayMesh = null) -> ArrayMesh:
	if mesh == null:
		mesh = ArrayMesh.new()
	var total := indices.size() if not indices.is_empty() else positions.size()
	var ranges := []
	if materials is Array and not groups.is_empty():
		for gr in groups:
			var mat = materials[gr.material_index] if gr.material_index < materials.size() else null
			if mat != null:
				ranges.append([gr.start, mini(gr.start + gr.count, total), mat])
	else:
		var mat = materials[0] if materials is Array and not materials.is_empty() else (materials if not materials is Array else null)
		ranges.append([0, total, mat])
	for r in ranges:
		var start: int = r[0]
		var end: int = r[1]
		end -= (end - start) % 3
		if end <= start:
			continue
		# corners in Godot's order: a, c, b
		var corners := PackedInt32Array()
		corners.resize(end - start)
		for t in range(start, end, 3):
			var o := t - start
			if indices.is_empty():
				corners[o] = t; corners[o + 1] = t + 2; corners[o + 2] = t + 1
			else:
				corners[o] = indices[t]; corners[o + 1] = indices[t + 2]; corners[o + 2] = indices[t + 1]
		var verts := PackedInt32Array() # source vertex of each output vertex
		var idx := PackedInt32Array()
		if indices.is_empty():
			verts = corners
		else:
			var remap := {}
			for c in corners:
				if not remap.has(c):
					remap[c] = verts.size()
					verts.append(c)
				idx.append(remap[c])
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		var pv := PackedVector3Array()
		for v in verts:
			pv.append(positions[v])
		arrays[Mesh.ARRAY_VERTEX] = pv
		if not normals.is_empty():
			var nv := PackedVector3Array()
			for v in verts:
				nv.append(normals[v])
			arrays[Mesh.ARRAY_NORMAL] = nv
		if not uvs.is_empty():
			var uv := PackedVector2Array()
			for v in verts:
				var u := uvs[v]
				uv.append(Vector2(u.x, 1.0 - u.y))
			arrays[Mesh.ARRAY_TEX_UV] = uv
		if not colors.is_empty():
			var cv := PackedColorArray()
			for v in verts:
				cv.append(colors[v])
			arrays[Mesh.ARRAY_COLOR] = cv
		var flags := 0
		const FORMATS := [0, Mesh.ARRAY_CUSTOM_R_FLOAT, Mesh.ARRAY_CUSTOM_RG_FLOAT, Mesh.ARRAY_CUSTOM_RGB_FLOAT, Mesh.ARRAY_CUSTOM_RGBA_FLOAT]
		for s in 4:
			var k := custom_size[s]
			if k == 0:
				continue
			var src: PackedFloat32Array = custom[s]
			var dst := PackedFloat32Array()
			for v in verts:
				for c in k:
					dst.append(src[v * k + c])
			arrays[Mesh.ARRAY_CUSTOM0 + s] = dst
			flags |= FORMATS[k] << (Mesh.ARRAY_FORMAT_CUSTOM_BASE + s * Mesh.ARRAY_FORMAT_CUSTOM_BITS)
		if not indices.is_empty():
			arrays[Mesh.ARRAY_INDEX] = idx
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, flags)
		if r[2] != null:
			mesh.surface_set_material(mesh.get_surface_count() - 1, r[2])
	return mesh


# ---------------------------------------------------------------- helpers

## Three's normalize (times 1 / (length || 1)) as a float32 Vector3.
static func _unit(x: float, y: float, z: float) -> Vector3:
	var l := sqrt(x * x + y * y + z * z)
	if l == 0.0:
		l = 1.0
	var k := 1.0 / l
	return Vector3(x * k, y * k, z * k)

static func _vec3s(data) -> PackedVector3Array:
	if data == null:
		return PackedVector3Array()
	if data is PackedVector3Array:
		return data.duplicate()
	if data is Array and not data.is_empty() and data[0] is Vector3:
		return PackedVector3Array(data)
	var out := PackedVector3Array()
	for i in range(0, data.size() - 2, 3):
		out.append(Vector3(data[i], data[i + 1], data[i + 2]))
	return out

static func _vec2s(data) -> PackedVector2Array:
	if data == null:
		return PackedVector2Array()
	if data is PackedVector2Array:
		return data.duplicate()
	if data is Array and not data.is_empty() and data[0] is Vector2:
		return PackedVector2Array(data)
	var out := PackedVector2Array()
	for i in range(0, data.size() - 1, 2):
		out.append(Vector2(data[i], data[i + 1]))
	return out

## Colors from a PackedColorArray, or flat rgb (item_size 3) / rgba (4) numbers.
static func _cols(data, item_size: int = 3) -> PackedColorArray:
	if data == null:
		return PackedColorArray()
	if data is PackedColorArray:
		return data.duplicate()
	if data is Array and not data.is_empty() and data[0] is Color:
		return PackedColorArray(data)
	var k := item_size if item_size > 0 else 3
	var out := PackedColorArray()
	for i in range(0, data.size() - k + 1, k):
		out.append(Color(data[i], data[i + 1], data[i + 2], data[i + 3] if k == 4 else 1.0))
	return out

static func _make(pos: PackedFloat64Array, nrm: PackedFloat64Array, uv: PackedFloat64Array, idx: PackedInt32Array):
	var g = new()
	for i in range(0, pos.size(), 3):
		g.positions.append(Vector3(pos[i], pos[i + 1], pos[i + 2]))
	for i in range(0, nrm.size(), 3):
		g.normals.append(Vector3(nrm[i], nrm[i + 1], nrm[i + 2]))
	for i in range(0, uv.size(), 2):
		g.uvs.append(Vector2(uv[i], uv[i + 1]))
	g.indices = idx
	return g

static func _push_unit(arr: PackedFloat64Array, x: float, y: float, z: float) -> void:
	var l := sqrt(x * x + y * y + z * z)
	if l == 0.0:
		l = 1.0
	var k := 1.0 / l
	arr.append(x * k)
	arr.append(y * k)
	arr.append(z * k)

static func _push3(arr: PackedFloat64Array, x: float, y: float, z: float) -> void:
	arr.append(x)
	arr.append(y)
	arr.append(z)


# ---------------------------------------------------------------- factories

## Raw BufferGeometry: flat numbers or packed vectors; null/empty for an attribute it hasn't.
static func from_arrays(pos, nrm = null, uv = null, idx = null, col = null, col_size: int = 3):
	var g = new()
	g.positions = _vec3s(pos)
	g.normals = _vec3s(nrm)
	g.uvs = _vec2s(uv)
	g.indices = PackedInt32Array(idx) if idx != null else PackedInt32Array()
	g.colors = _cols(col, col_size)
	return g

static func box(width: float = 1, height: float = 1, depth: float = 1, width_segments: int = 1, height_segments: int = 1, depth_segments: int = 1):
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var grp := []
	var state := [0, 0] # numberOfVertices, groupStart
	var plane := func(u: int, v: int, w: int, udir: float, vdir: float, pw: float, ph: float, pd: float, grid_x: int, grid_y: int, mi: int) -> void:
		var seg_w := pw / grid_x
		var seg_h := ph / grid_y
		var gx1 := grid_x + 1
		var gy1 := grid_y + 1
		var vc := 0
		var gc := 0
		var vec := [0.0, 0.0, 0.0]
		for iy in gy1:
			var y := iy * seg_h - ph / 2
			for ix in gx1:
				var x := ix * seg_w - pw / 2
				vec[u] = x * udir
				vec[v] = y * vdir
				vec[w] = pd / 2
				_push3(pos, vec[0], vec[1], vec[2])
				vec[u] = 0.0
				vec[v] = 0.0
				vec[w] = 1.0 if pd > 0 else -1.0
				_push3(nrm, vec[0], vec[1], vec[2])
				uv.append(float(ix) / grid_x)
				uv.append(1 - (float(iy) / grid_y))
				vc += 1
		var nv: int = state[0]
		for iy in grid_y:
			for ix in grid_x:
				var a := nv + ix + gx1 * iy
				var b := nv + ix + gx1 * (iy + 1)
				var c := nv + (ix + 1) + gx1 * (iy + 1)
				var d := nv + (ix + 1) + gx1 * iy
				idx.append_array([a, b, d, b, c, d])
				gc += 6
		grp.append({start = state[1], count = gc, material_index = mi})
		state[1] += gc
		state[0] += vc
	plane.call(2, 1, 0, -1, -1, depth, height, width, depth_segments, height_segments, 0) # px
	plane.call(2, 1, 0, 1, -1, depth, height, -width, depth_segments, height_segments, 1) # nx
	plane.call(0, 2, 1, 1, 1, width, depth, height, width_segments, depth_segments, 2) # py
	plane.call(0, 2, 1, 1, -1, width, depth, -height, width_segments, depth_segments, 3) # ny
	plane.call(0, 1, 2, 1, -1, width, height, depth, width_segments, height_segments, 4) # pz
	plane.call(0, 1, 2, -1, -1, width, height, -depth, width_segments, height_segments, 5) # nz
	var g = _make(pos, nrm, uv, idx)
	g.groups = grp
	return g

## three/addons/geometries/RoundedBoxGeometry.js: non-indexed, with the box's six groups.
static func rounded_box(width: float = 1, height: float = 1, depth: float = 1, segments: int = 2, radius: float = 0.1):
	var total := segments * 2 + 1
	radius = minf(minf(width / 2, height / 2), minf(depth / 2, radius))
	var g = box(1, 1, 1, total, total, total)
	if total == 1:
		return g
	var g2 = g.to_non_indexed()
	var bx := width / 2 - radius
	var by := height / 2 - radius
	var bz := depth / 2 - radius
	var face_tris: float = g2.positions.size() * 3 / 6.0
	var half := 0.5 / total
	for k in g2.positions.size():
		var p: Vector3 = g2.positions[k]
		var px: float = p.x
		var py: float = p.y
		var pz: float = p.z
		var nx := px - signf(px) * half
		var ny := py - signf(py) * half
		var nz := pz - signf(pz) * half
		var l := sqrt(nx * nx + ny * ny + nz * nz)
		if l == 0.0:
			l = 1.0
		var inv := 1.0 / l
		nx *= inv; ny *= inv; nz *= inv
		g2.positions[k] = Vector3(bx * signf(px) + nx * radius, by * signf(py) + ny * radius, bz * signf(pz) + nz * radius)
		g2.normals[k] = Vector3(nx, ny, nz)
		var n := [nx, ny, nz]
		var u := 0.0
		var v := 0.0
		match int(floor(k * 3 / face_tris)):
			0:
				u = _rb_uv([1, 0, 0], n, 2, 1, radius, depth)
				v = 1.0 - _rb_uv([1, 0, 0], n, 1, 2, radius, height)
			1:
				u = 1.0 - _rb_uv([-1, 0, 0], n, 2, 1, radius, depth)
				v = 1.0 - _rb_uv([-1, 0, 0], n, 1, 2, radius, height)
			2:
				u = 1.0 - _rb_uv([0, 1, 0], n, 0, 2, radius, width)
				v = _rb_uv([0, 1, 0], n, 2, 0, radius, depth)
			3:
				u = 1.0 - _rb_uv([0, -1, 0], n, 0, 2, radius, width)
				v = 1.0 - _rb_uv([0, -1, 0], n, 2, 0, radius, depth)
			4:
				u = 1.0 - _rb_uv([0, 0, 1], n, 0, 1, radius, width)
				v = 1.0 - _rb_uv([0, 0, 1], n, 1, 0, radius, height)
			5:
				u = _rb_uv([0, 0, -1], n, 0, 1, radius, width)
				v = 1.0 - _rb_uv([0, 0, -1], n, 1, 0, radius, height)
		g2.uvs[k] = Vector2(u, v)
	return g2

static func _rb_uv(face_dir: Array, normal: Array, uv_axis: int, projection_axis: int, radius: float, side_length: float) -> float:
	var tot_arc := 2 * PI * radius / 4
	var center_len := maxf(side_length - 2 * radius, 0)
	var half_arc := PI / 4
	var t := normal.duplicate()
	t[projection_axis] = 0.0
	var l := sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2])
	if l == 0.0:
		l = 1.0
	var k := 1.0 / l
	t = [t[0] * k, t[1] * k, t[2] * k]
	var arc_uv := 0.5 * tot_arc / (tot_arc + center_len)
	# Vector3.angleTo
	var den := sqrt((t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) * float(face_dir[0] * face_dir[0] + face_dir[1] * face_dir[1] + face_dir[2] * face_dir[2]))
	var angle := PI / 2
	if den != 0:
		angle = acos(clampf((t[0] * face_dir[0] + t[1] * face_dir[1] + t[2] * face_dir[2]) / den, -1, 1))
	var arc_angle := 1.0 - (angle / half_arc)
	if t[uv_axis] > 0:
		return arc_angle * arc_uv
	var len_uv := center_len / (tot_arc + center_len)
	return len_uv + arc_uv + arc_uv * (1.0 - arc_angle)

static func plane(width: float = 1, height: float = 1, width_segments: int = 1, height_segments: int = 1):
	var gx := width_segments
	var gy := height_segments
	var gx1 := gx + 1
	var seg_w := width / gx
	var seg_h := height / gy
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	for iy in gy + 1:
		var y := iy * seg_h - height / 2
		for ix in gx1:
			var x := ix * seg_w - width / 2
			_push3(pos, x, -y, 0)
			_push3(nrm, 0, 0, 1)
			uv.append(float(ix) / gx)
			uv.append(1 - (float(iy) / gy))
	for iy in gy:
		for ix in gx:
			var a := ix + gx1 * iy
			var b := ix + gx1 * (iy + 1)
			var c := (ix + 1) + gx1 * (iy + 1)
			var d := (ix + 1) + gx1 * iy
			idx.append_array([a, b, d, b, c, d])
	return _make(pos, nrm, uv, idx)

static func circle(radius: float = 1, segments: int = 32, theta_start: float = 0, theta_length: float = TAU):
	segments = maxi(3, segments)
	var pos := PackedFloat64Array([0, 0, 0])
	var nrm := PackedFloat64Array([0, 0, 1])
	var uv := PackedFloat64Array([0.5, 0.5])
	var idx := PackedInt32Array()
	for s in segments + 1:
		var seg := theta_start + float(s) / segments * theta_length
		var x := radius * cos(seg)
		var y := radius * sin(seg)
		_push3(pos, x, y, 0)
		_push3(nrm, 0, 0, 1)
		uv.append((x / radius + 1) / 2)
		uv.append((y / radius + 1) / 2)
	for i in range(1, segments + 1):
		idx.append_array([i, i + 1, 0])
	return _make(pos, nrm, uv, idx)

static func ring(inner_radius: float = 0.5, outer_radius: float = 1, theta_segments: int = 32, phi_segments: int = 1, theta_start: float = 0, theta_length: float = TAU):
	theta_segments = maxi(3, theta_segments)
	phi_segments = maxi(1, phi_segments)
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var radius := inner_radius
	var step := (outer_radius - inner_radius) / phi_segments
	for j in phi_segments + 1:
		for i in theta_segments + 1:
			var seg := theta_start + float(i) / theta_segments * theta_length
			var x := radius * cos(seg)
			var y := radius * sin(seg)
			_push3(pos, x, y, 0)
			_push3(nrm, 0, 0, 1)
			uv.append((x / outer_radius + 1) / 2)
			uv.append((y / outer_radius + 1) / 2)
		radius += step
	for j in phi_segments:
		var level := j * (theta_segments + 1)
		for i in theta_segments:
			var s := i + level
			var a := s
			var b := s + theta_segments + 1
			var c := s + theta_segments + 2
			var d := s + 1
			idx.append_array([a, b, d, b, c, d])
	return _make(pos, nrm, uv, idx)

static func cylinder(radius_top: float = 1, radius_bottom: float = 1, height: float = 1, radial_segments: int = 32, height_segments: int = 1, open_ended: bool = false, theta_start: float = 0, theta_length: float = TAU):
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var grp := []
	var index := 0
	var half := height / 2
	var group_start := 0
	# torso
	var rows := []
	var slope := (radius_bottom - radius_top) / height
	for y in height_segments + 1:
		var row := []
		var v := float(y) / height_segments
		var radius := v * (radius_bottom - radius_top) + radius_top
		for x in radial_segments + 1:
			var u := float(x) / radial_segments
			var theta := u * theta_length + theta_start
			var st := sin(theta)
			var ct := cos(theta)
			_push3(pos, radius * st, -v * height + half, radius * ct)
			_push_unit(nrm, st, slope, ct)
			uv.append(u)
			uv.append(1 - v)
			row.append(index)
			index += 1
		rows.append(row)
	var gc := 0
	for x in radial_segments:
		for y in height_segments:
			var a: int = rows[y][x]
			var b: int = rows[y + 1][x]
			var c: int = rows[y + 1][x + 1]
			var d: int = rows[y][x + 1]
			if radius_top > 0 or y != 0:
				idx.append_array([a, b, d])
				gc += 3
			if radius_bottom > 0 or y != height_segments - 1:
				idx.append_array([b, c, d])
				gc += 3
	grp.append({start = group_start, count = gc, material_index = 0})
	group_start += gc
	if not open_ended:
		for top in [true, false]:
			var radius := radius_top if top else radius_bottom
			if radius <= 0:
				continue
			var center_start := index
			var sign := 1.0 if top else -1.0
			for x in range(1, radial_segments + 1):
				_push3(pos, 0, half * sign, 0)
				_push3(nrm, 0, sign, 0)
				uv.append(0.5)
				uv.append(0.5)
				index += 1
			var center_end := index
			for x in radial_segments + 1:
				var u := float(x) / radial_segments
				var theta := u * theta_length + theta_start
				var ct := cos(theta)
				var st := sin(theta)
				_push3(pos, radius * st, half * sign, radius * ct)
				_push3(nrm, 0, sign, 0)
				uv.append((ct * 0.5) + 0.5)
				uv.append((st * 0.5 * sign) + 0.5)
				index += 1
			gc = 0
			for x in radial_segments:
				var c := center_start + x
				var i := center_end + x
				if top:
					idx.append_array([i, i + 1, c])
				else:
					idx.append_array([i + 1, i, c])
				gc += 3
			grp.append({start = group_start, count = gc, material_index = 1 if top else 2})
			group_start += gc
	var g = _make(pos, nrm, uv, idx)
	g.groups = grp
	return g

static func cone(radius: float = 1, height: float = 1, radial_segments: int = 32, height_segments: int = 1, open_ended: bool = false, theta_start: float = 0, theta_length: float = TAU):
	return cylinder(0, radius, height, radial_segments, height_segments, open_ended, theta_start, theta_length)

static func sphere(radius: float = 1, width_segments: int = 32, height_segments: int = 16, phi_start: float = 0, phi_length: float = TAU, theta_start: float = 0, theta_length: float = PI):
	width_segments = maxi(3, width_segments)
	height_segments = maxi(2, height_segments)
	var theta_end := minf(theta_start + theta_length, PI)
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var grid := []
	var index := 0
	for iy in height_segments + 1:
		var row := []
		var v := float(iy) / height_segments
		var theta := theta_start + v * theta_length
		var y := radius * cos(theta)
		var ring_r := sqrt(radius * radius - y * y)
		var u_off := 0.0
		if iy == 0 and theta_start == 0:
			u_off = 0.5 / width_segments
		elif iy == height_segments and theta_end == PI:
			u_off = -0.5 / width_segments
		for ix in width_segments + 1:
			var u := float(ix) / width_segments
			var phi := phi_start + u * phi_length
			var x := -ring_r * cos(phi)
			var z := ring_r * sin(phi)
			_push3(pos, x, y, z)
			_push_unit(nrm, x, y, z)
			uv.append(u + u_off)
			uv.append(1 - v)
			row.append(index)
			index += 1
		grid.append(row)
	for iy in height_segments:
		for ix in width_segments:
			var a: int = grid[iy][ix + 1]
			var b: int = grid[iy][ix]
			var c: int = grid[iy + 1][ix]
			var d: int = grid[iy + 1][ix + 1]
			if iy != 0 or theta_start > 0:
				idx.append_array([a, b, d])
			if iy != height_segments - 1 or theta_end < PI:
				idx.append_array([b, c, d])
	return _make(pos, nrm, uv, idx)

static func torus(radius: float = 1, tube_radius: float = 0.4, radial_segments: int = 12, tubular_segments: int = 48, arc: float = TAU, theta_start: float = 0, theta_length: float = TAU):
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	for j in radial_segments + 1:
		var v := theta_start + (float(j) / radial_segments) * theta_length
		for i in tubular_segments + 1:
			var u := float(i) / tubular_segments * arc
			var x := (radius + tube_radius * cos(v)) * cos(u)
			var y := (radius + tube_radius * cos(v)) * sin(u)
			var z := tube_radius * sin(v)
			_push3(pos, x, y, z)
			_push_unit(nrm, x - radius * cos(u), y - radius * sin(u), z - 0.0)
			uv.append(float(i) / tubular_segments)
			uv.append(float(j) / radial_segments)
	for j in range(1, radial_segments + 1):
		for i in range(1, tubular_segments + 1):
			var a := (tubular_segments + 1) * j + i - 1
			var b := (tubular_segments + 1) * (j - 1) + i - 1
			var c := (tubular_segments + 1) * (j - 1) + i
			var d := (tubular_segments + 1) * j + i
			idx.append_array([a, b, d, b, c, d])
	return _make(pos, nrm, uv, idx)

static func capsule(radius: float = 1, height: float = 1, cap_segments: int = 4, radial_segments: int = 8, height_segments: int = 1):
	height = maxf(0, height)
	cap_segments = maxi(1, cap_segments)
	radial_segments = maxi(3, radial_segments)
	height_segments = maxi(1, height_segments)
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var half := height / 2
	var cap_arc := (PI / 2) * radius
	var cyl := height
	var total_arc := 2 * cap_arc + cyl
	var vsegs := cap_segments * 2 + height_segments
	var per_row := radial_segments + 1
	for iy in vsegs + 1:
		var arc_len := 0.0
		var py := 0.0
		var pr := 0.0
		var ny := 0.0
		if iy <= cap_segments:
			var sp := float(iy) / cap_segments
			var angle := (sp * PI) / 2
			py = -half - radius * cos(angle)
			pr = radius * sin(angle)
			ny = -radius * cos(angle)
			arc_len = sp * cap_arc
		elif iy <= cap_segments + height_segments:
			var sp := float(iy - cap_segments) / height_segments
			py = -half + sp * height
			pr = radius
			ny = 0
			arc_len = cap_arc + sp * cyl
		else:
			var sp := float(iy - cap_segments - height_segments) / cap_segments
			var angle := (sp * PI) / 2
			py = half + radius * sin(angle)
			pr = radius * cos(angle)
			ny = radius * sin(angle)
			arc_len = cap_arc + cyl + sp * cap_arc
		var v := maxf(0, minf(1, arc_len / total_arc))
		var u_off := 0.0
		if iy == 0:
			u_off = 0.5 / radial_segments
		elif iy == vsegs:
			u_off = -0.5 / radial_segments
		for ix in radial_segments + 1:
			var u := float(ix) / radial_segments
			var theta := u * PI * 2
			var st := sin(theta)
			var ct := cos(theta)
			_push3(pos, -pr * ct, py, pr * st)
			_push_unit(nrm, -pr * ct, ny, pr * st)
			uv.append(u + u_off)
			uv.append(v)
		if iy > 0:
			var prev := (iy - 1) * per_row
			for ix in radial_segments:
				var i1 := prev + ix
				var i2 := prev + ix + 1
				var i3 := iy * per_row + ix
				var i4 := iy * per_row + ix + 1
				idx.append_array([i1, i2, i3, i2, i4, i3])
	return _make(pos, nrm, uv, idx)

## points: Vector2s (or [x, y]s), x = radius, y = height; turned about Y.
static func lathe(points: Array = [Vector2(0, -0.5), Vector2(0.5, 0), Vector2(0, 0.5)], segments: int = 12, phi_start: float = 0, phi_length: float = TAU):
	var pts := points.map(func(p): return Shapes.p2(p))
	phi_length = clampf(phi_length, 0, TAU)
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var init := PackedFloat64Array()
	var inv := 1.0 / segments
	var n := pts.size()
	var prev := [0.0, 0.0, 0.0]
	for j in n:
		if j == 0:
			var dx: float = pts[j + 1].x - pts[j].x
			var dy: float = pts[j + 1].y - pts[j].y
			prev = [dy * 1.0, -dx, dy * 0.0]
			_push_unit(init, prev[0], prev[1], prev[2])
		elif j == n - 1:
			_push3(init, prev[0], prev[1], prev[2])
		else:
			var dx: float = pts[j + 1].x - pts[j].x
			var dy: float = pts[j + 1].y - pts[j].y
			var cur := [dy * 1.0, -dx, dy * 0.0]
			_push_unit(init, cur[0] + prev[0], cur[1] + prev[1], cur[2] + prev[2])
			prev = cur
	for i in segments + 1:
		var phi := phi_start + i * inv * phi_length
		var s := sin(phi)
		var c := cos(phi)
		for j in n:
			_push3(pos, pts[j].x * s, pts[j].y, pts[j].x * c)
			uv.append(float(i) / segments)
			uv.append(float(j) / (n - 1))
			_push3(nrm, init[3 * j] * s, init[3 * j + 1], init[3 * j] * c)
	for i in segments:
		for j in n - 1:
			var base := j + i * n
			var a := base
			var b := base + n
			var c := base + n + 1
			var d := base + 1
			idx.append_array([a, b, d, c, d, b])
	return _make(pos, nrm, uv, idx)

## ShapeGeometry: one Shape, or an Array of them (then one group each).
static func shape(shapes = null, curve_segments: int = 12):
	if shapes == null:
		shapes = Shapes.Shape.new([Vector2(0, 0.5), Vector2(-0.5, -0.5), Vector2(0.5, -0.5)])
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var grp := []
	var list: Array = shapes if shapes is Array else [shapes]
	var group_start := 0
	for si in list.size():
		var offset := pos.size() / 3
		var pts: Dictionary = list[si]._extract(curve_segments)
		var verts: Array = pts.shape
		var holes: Array = pts.holes
		if not Shapes.ShapeUtils.is_clock_wise(verts):
			verts.reverse()
		for h in holes:
			if Shapes.ShapeUtils.is_clock_wise(h):
				h.reverse()
		var faces := Shapes.ShapeUtils.triangulate_shape(verts, holes)
		for h in holes:
			verts = verts + h
		for p in verts:
			_push3(pos, p.x, p.y, 0)
			_push3(nrm, 0, 0, 1)
			uv.append(p.x)
			uv.append(p.y)
		for f in faces:
			idx.append_array([f[0] + offset, f[1] + offset, f[2] + offset])
		if shapes is Array:
			grp.append({start = group_start, count = faces.size() * 3, material_index = si})
			group_start += faces.size() * 3
	var g = _make(pos, nrm, uv, idx)
	g.groups = grp
	return g

## ExtrudeGeometry. options keep Three's keys: curveSegments, steps, depth, bevelEnabled, bevelThickness,
## bevelSize, bevelOffset, bevelSegments. (No extrudePath or UVGenerator: the game uses neither.)
## Non-indexed; per shape a group 0 for the lids and 1 for the sides.
static func extrude(shapes = null, options: Dictionary = {}):
	if shapes == null:
		shapes = Shapes.Shape.new([Vector2(0.5, 0.5), Vector2(-0.5, 0.5), Vector2(-0.5, -0.5), Vector2(0.5, -0.5)])
	if options.has("extrudePath") or options.has("UVGenerator"):
		push_error("Geo.extrude: extrudePath and UVGenerator aren't ported")
	var list: Array = shapes if shapes is Array else [shapes]
	var out := PackedFloat64Array() # verticesArray
	var out_uv := PackedFloat64Array()
	var grp := []
	for sh in list:
		_extrude_shape(sh, options, out, out_uv, grp)
	var g = new()
	for i in range(0, out.size(), 3):
		g.positions.append(Vector3(out[i], out[i + 1], out[i + 2]))
	for i in range(0, out_uv.size(), 2):
		g.uvs.append(Vector2(out_uv[i], out_uv[i + 1]))
	g.groups = grp
	g.compute_vertex_normals()
	return g

static func _extrude_shape(sh, options: Dictionary, out: PackedFloat64Array, out_uv: PackedFloat64Array, grp: Array) -> void:
	var P2 = Shapes.P2
	var curve_segments: int = options.get("curveSegments", 12)
	var steps: int = options.get("steps", 1)
	var depth: float = options.get("depth", 1)
	var bevel_enabled: bool = options.get("bevelEnabled", true)
	var bevel_thickness: float = options.get("bevelThickness", 0.2)
	var bevel_size: float = options.get("bevelSize", bevel_thickness - 0.1)
	var bevel_offset: float = options.get("bevelOffset", 0)
	var bevel_segments: int = options.get("bevelSegments", 3)
	if not bevel_enabled:
		bevel_segments = 0
		bevel_thickness = 0
		bevel_size = 0
		bevel_offset = 0
	var pts: Dictionary = sh._extract(curve_segments)
	var vertices: Array = pts.shape
	var holes: Array = pts.holes
	if not Shapes.ShapeUtils.is_clock_wise(vertices):
		vertices.reverse()
		for h in holes:
			if Shapes.ShapeUtils.is_clock_wise(h):
				h.reverse()
	_merge_overlapping(vertices)
	for h in holes:
		_merge_overlapping(h)
	var contour := vertices
	for h in holes:
		vertices = vertices + h
	var vlen := vertices.size()
	var contour_moves := []
	var il := contour.size()
	for i in il:
		contour_moves.append(_bevel_vec(contour[i], contour[(i + il - 1) % il], contour[(i + 1) % il]))
	var holes_moves := []
	var vertices_moves := contour_moves.duplicate()
	for h in holes:
		var hm := []
		var hl: int = h.size()
		for i in hl:
			hm.append(_bevel_vec(h[i], h[(i + hl - 1) % hl], h[(i + 1) % hl]))
		holes_moves.append(hm)
		vertices_moves.append_array(hm)
	var ph := PackedFloat64Array() # placeholder
	var faces: Array
	if bevel_segments == 0:
		faces = Shapes.ShapeUtils.triangulate_shape(contour, holes)
	else:
		var contracted := []
		var expanded := []
		for b in bevel_segments:
			var t := float(b) / bevel_segments
			var z := bevel_thickness * cos(t * PI / 2)
			var bs := bevel_size * sin(t * PI / 2) + bevel_offset
			for i in contour.size():
				var vert = _scale_pt2(contour[i], contour_moves[i], bs)
				_push3(ph, vert.x, vert.y, -z)
				if t == 0:
					contracted.append(vert)
			for hi in holes.size():
				var h: Array = holes[hi]
				var hv := []
				for i in h.size():
					var vert = _scale_pt2(h[i], holes_moves[hi][i], bs)
					_push3(ph, vert.x, vert.y, -z)
					if t == 0:
						hv.append(vert)
				if t == 0:
					expanded.append(hv)
		faces = Shapes.ShapeUtils.triangulate_shape(contracted, expanded)
	var bs_all := bevel_size + bevel_offset
	for i in vlen: # back
		var vert = _scale_pt2(vertices[i], vertices_moves[i], bs_all) if bevel_enabled else vertices[i]
		_push3(ph, vert.x, vert.y, 0)
	for s in range(1, steps + 1): # steps, front included
		for i in vlen:
			var vert = _scale_pt2(vertices[i], vertices_moves[i], bs_all) if bevel_enabled else vertices[i]
			_push3(ph, vert.x, vert.y, depth / steps * s)
	for b in range(bevel_segments - 1, -1, -1): # front bevel
		var t := float(b) / bevel_segments
		var z := bevel_thickness * cos(t * PI / 2)
		var bs := bevel_size * sin(t * PI / 2) + bevel_offset
		for i in contour.size():
			var vert = _scale_pt2(contour[i], contour_moves[i], bs)
			_push3(ph, vert.x, vert.y, depth + z)
		for hi in holes.size():
			var h: Array = holes[hi]
			for i in h.size():
				var vert = _scale_pt2(h[i], holes_moves[hi][i], bs)
				_push3(ph, vert.x, vert.y, depth + z)
	# lids
	var start := out.size() / 3
	if bevel_enabled:
		var offset := 0
		for f in faces:
			_f3(ph, out, out_uv, f[2] + offset, f[1] + offset, f[0] + offset)
		offset = vlen * (steps + bevel_segments * 2)
		for f in faces:
			_f3(ph, out, out_uv, f[0] + offset, f[1] + offset, f[2] + offset)
	else:
		for f in faces:
			_f3(ph, out, out_uv, f[2], f[1], f[0])
		for f in faces:
			_f3(ph, out, out_uv, f[0] + vlen * steps, f[1] + vlen * steps, f[2] + vlen * steps)
	grp.append({start = start, count = out.size() / 3 - start, material_index = 0})
	# sides
	start = out.size() / 3
	var layer := 0
	var rings: Array = [contour] + holes
	for ring_pts in rings:
		var n: int = ring_pts.size()
		var i := n
		i -= 1
		while i >= 0:
			var j := i
			var k := i - 1
			if k < 0:
				k = n - 1
			for s in steps + bevel_segments * 2:
				var s1 := vlen * s
				var s2 := vlen * (s + 1)
				_f4(ph, out, out_uv, layer + j + s1, layer + k + s1, layer + k + s2, layer + j + s2)
			i -= 1
		layer += n
	grp.append({start = start, count = out.size() / 3 - start, material_index = 1})

static func _merge_overlapping(points: Array) -> void:
	const TH_SQ := 1e-10 * 1e-10
	if points.is_empty():
		return
	var prev = points[0]
	var i := 1
	while i <= points.size():
		var ci := i % points.size()
		var cur = points[ci]
		var dx: float = cur.x - prev.x
		var dy: float = cur.y - prev.y
		var dist_sq := dx * dx + dy * dy
		var sc := maxf(maxf(absf(cur.x), absf(cur.y)), maxf(absf(prev.x), absf(prev.y)))
		if dist_sq <= TH_SQ * sc * sc:
			points.remove_at(ci)
			continue
		prev = cur
		i += 1

static func _scale_pt2(pt, vec, size: float):
	return Shapes.P2.new(pt.x + vec.x * size, pt.y + vec.y * size)

## Which way, and how far, a contour point moves when the contour is shrunk by 1 (ExtrudeGeometry's getBevelVec).
static func _bevel_vec(pt, prev, next):
	var eps := Shapes.EPSILON
	var tx: float
	var ty: float
	var shrink: float
	var vpx: float = pt.x - prev.x
	var vpy: float = pt.y - prev.y
	var vnx: float = next.x - pt.x
	var vny: float = next.y - pt.y
	var vp_lensq := vpx * vpx + vpy * vpy
	var collinear := vpx * vny - vpy * vnx
	if absf(collinear) > eps:
		var vp_len := sqrt(vp_lensq)
		var vn_len := sqrt(vnx * vnx + vny * vny)
		var ppx: float = prev.x - vpy / vp_len
		var ppy: float = prev.y + vpx / vp_len
		var pnx: float = next.x - vny / vn_len
		var pny: float = next.y + vnx / vn_len
		var sf := ((pnx - ppx) * vny - (pny - ppy) * vnx) / (vpx * vny - vpy * vnx)
		tx = ppx + vpx * sf - pt.x
		ty = ppy + vpy * sf - pt.y
		var t_lensq := tx * tx + ty * ty
		if t_lensq <= 2:
			return Shapes.P2.new(tx, ty)
		shrink = sqrt(t_lensq / 2)
	else:
		var same := false
		if vpx > eps:
			if vnx > eps:
				same = true
		elif vpx < -eps:
			if vnx < -eps:
				same = true
		elif signf(vpy) == signf(vny):
			same = true
		if same:
			tx = -vpy
			ty = vpx
			shrink = sqrt(vp_lensq)
		else:
			tx = vpx
			ty = vpy
			shrink = sqrt(vp_lensq / 2)
	return Shapes.P2.new(tx / shrink, ty / shrink)

static func _add_vertex(ph: PackedFloat64Array, out: PackedFloat64Array, i: int) -> void:
	out.append(ph[i * 3])
	out.append(ph[i * 3 + 1])
	out.append(ph[i * 3 + 2])

static func _f3(ph: PackedFloat64Array, out: PackedFloat64Array, out_uv: PackedFloat64Array, a: int, b: int, c: int) -> void:
	for i in [a, b, c]:
		_add_vertex(ph, out, i)
		out_uv.append(ph[i * 3]) # WorldUVGenerator.generateTopUV: x, y
		out_uv.append(ph[i * 3 + 1])

static func _f4(ph: PackedFloat64Array, out: PackedFloat64Array, out_uv: PackedFloat64Array, a: int, b: int, c: int, d: int) -> void:
	for i in [a, b, d, b, c, d]:
		_add_vertex(ph, out, i)
	# WorldUVGenerator.generateSideWallUV
	var use_x := absf(ph[a * 3 + 1] - ph[b * 3 + 1]) < absf(ph[a * 3] - ph[b * 3])
	var q := []
	for i in [a, b, c, d]:
		q.append([ph[i * 3] if use_x else ph[i * 3 + 1], 1 - ph[i * 3 + 2]])
	for k in [0, 1, 3, 1, 2, 3]:
		out_uv.append(q[k][0])
		out_uv.append(q[k][1])

## TubeGeometry along a Shapes curve (e.g. Shapes.CatmullRomCurve3).
static func tube(path, tubular_segments: int = 64, radius: float = 1, radial_segments: int = 8, closed: bool = false):
	var frames: Dictionary = path._frames(tubular_segments, closed)
	var pos := PackedFloat64Array()
	var nrm := PackedFloat64Array()
	var uv := PackedFloat64Array()
	var idx := PackedInt32Array()
	var segs := range(tubular_segments)
	segs.append(tubular_segments if not closed else 0)
	for i in segs:
		var p = path._pt_at(float(i) / tubular_segments)
		var n = frames.normals[i]
		var b = frames.binormals[i]
		for j in radial_segments + 1:
			var v := float(j) / radial_segments * PI * 2
			var s := sin(v)
			var c := -cos(v)
			var nx: float = c * n.x + s * b.x
			var ny: float = c * n.y + s * b.y
			var nz: float = c * n.z + s * b.z
			var l := sqrt(nx * nx + ny * ny + nz * nz)
			if l == 0.0:
				l = 1.0
			var k := 1.0 / l
			nx *= k; ny *= k; nz *= k
			_push3(nrm, nx, ny, nz)
			_push3(pos, p.x + radius * nx, p.y + radius * ny, p.z + radius * nz)
	for i in tubular_segments + 1:
		for j in radial_segments + 1:
			uv.append(float(i) / tubular_segments)
			uv.append(float(j) / radial_segments)
	for j in range(1, tubular_segments + 1):
		for i in range(1, radial_segments + 1):
			var a := (radial_segments + 1) * (j - 1) + (i - 1)
			var b := (radial_segments + 1) * j + (i - 1)
			var c := (radial_segments + 1) * j + i
			var d := (radial_segments + 1) * (j - 1) + i
			idx.append_array([a, b, d, b, c, d])
	return _make(pos, nrm, uv, idx)
