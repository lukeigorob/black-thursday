extends RefCounted
# The villages and towns of the Franconian countryside, where the ground's layout put them (ground.gd: every
# 2-3 km, down in the valleys by the water, the roads running between them). Each is its painted plan
# (villages.gd: one atlas, one instanced quad each, a few hundred of them in one draw call) lying on the
# fields; the ones near you also stand up in 3D, the same houses on the same plan: walls, a tiled roof, the
# church tower and its spire. The layout wraps every 82 km: each place is shown at its copy nearest to you.

const Env := preload("res://src/environment.gd")
const Ground := preload("res://src/ground.gd")
const Villages := preload("res://src/villages.gd")
const River := preload("res://src/river.gd")
const Geo := preload("res://src/core/geo.gd")
const Shapes := preload("res://src/core/shapes.gd")
const Mat := preload("res://src/core/mat.gd")

const ATLAS := Villages.ATLAS
const KEEP_OUT := 6500.0 # m round the target: the city has its own outskirts (city.gd)
const NEAR_R := 6500.0 # m: the villages this close to you are built in 3D
const POOL := 9000
const SPIRES := 64 # 3D buildings and spires at most

## A unit gable roof: ridge along Z, eaves at y 0, ridge at y 1.
static func gable():
	var s := Shapes.Shape.new([Vector2(-0.5, 0), Vector2(0.5, 0), Vector2(0, 1)])
	return Geo.extrude(s, {depth = 1, bevelEnabled = false}).translate(0, 0, -0.5)

const WALL := [null, [0xa89c82, 0x9c8e74, 0xb0a48b, 0x8f826a, 0xa3967c], [0x7a6b55, 0x6e604c, 0x82745c], [0xb3a890, 0xa79c85]]
const HIDE := Transform3D(Basis(Vector3.ZERO, Vector3.ZERO, Vector3.ZERO), Vector3.ZERO)

var group: Node3D # (moved as the ground scrolls; the layout's 0, 0 is at its origin)
var paint_ms := 0.0
var plans: Array
var decals: MultiMeshInstance3D
var walls: MultiMeshInstance3D
var roofs: MultiMeshInstance3D
var spires: MultiMeshInstance3D
var places: Array
var near := ""
var next := 0
var tick := 0
var keep_out = null

## drift: the turning ground's node (world.gd); ground_y: the ground's height in it; layout: ground.gd's.
func _init(drift: Node3D, ground_y: float, layout) -> void:
	group = Node3D.new()
	group.name = "countryside"
	group.position.y = ground_y
	drift.add_child(group)
	var atlas := Villages.paint_atlas()
	paint_ms = atlas.ms
	plans = atlas.plans
	var tex: Texture2D = atlas.canvas.texture(true)
	var n: int = layout.villages.size()
	# the plans on the ground: one quad each, its cell of the atlas
	var mat = Env.hook(Mat.standard({map = tex, color = Color(1.05, 1.02, 1.0).linear_to_srgb(), roughness = 1, transparent = true, depthWrite = false}), {atlas = true})
	mat = Ground.aerial(Env.snowy(mat, 0.62))
	mat.render_priority = 1
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = Geo.plane(1, 1).rotate_x(-PI / 2).to_mesh(mat)
	mm.instance_count = n
	decals = MultiMeshInstance3D.new()
	decals.name = "villages"
	decals.multimesh = mm
	decals.extra_cull_margin = 16384 # (frustumCulled = false)
	decals.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	group.add_child(decals)
	# the near ones in 3D
	walls = _mesh(Geo.box(1, 1, 1).translate(0, 0.5, 0), Mat.standard({roughness = 0.9, vertexColors = true}), POOL, true)
	roofs = _mesh(gable(), Mat.standard({roughness = 0.85, side = Mat.DOUBLE, vertexColors = true}), POOL, true)
	spires = _mesh(Geo.cone(1, 1, 8).translate(0, 0.5, 0), Mat.standard({color = 0x4a5a52, roughness = 0.6, metalness = 0.25}), SPIRES, false)
	# the places: the layout's villages, each its plan and turn
	places = []
	for i in n:
		var v: Dictionary = layout.villages[i]
		var by: Array = Villages.BY_KIND[v.kind]
		var plan: int = by[int(v.variant) % by.size()]
		var c: Array = plans[plan].cell
		mm.set_instance_custom_data(i, Color(c[0], c[1], c[2], c[3]))
		places.append({i = i, kind = v.kind, plan = plan, turn = v.turn, tx = v.x, tz = v.z, x = v.x, z = v.z, shown = null, ox = NAN, oz = NAN})
	for p in places:
		put(p, 0, 0)

## (the near ones' instanced meshes: hidden till the first near village)
func _mesh(g, m: Material, k: int, colors: bool) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = g.to_mesh(Ground.aerial(Env.snowy(m)))
	mm.instance_count = k
	mm.visible_instance_count = 0
	var x := MultiMeshInstance3D.new()
	x.multimesh = mm
	x.extra_cull_margin = 16384
	group.add_child(x)
	return x

## Set place p at its copy nearest (fx, fz) (the ground's frame), hidden if the target town is there.
func put(p: Dictionary, fx: float, fz: float) -> bool:
	var x: float = p.tx + Ground.MACRO * roundf((fx - p.tx) / Ground.MACRO)
	var z: float = p.tz + Ground.MACRO * roundf((fz - p.tz) / Ground.MACRO)
	var k = keep_out
	var gp := group.position
	var cx: float = x + gp.x - (k.x if k != null else 0.0)
	var cz: float = z + gp.z - (k.z if k != null else 0.0) # (from the target town: it and its river kept clear)
	var hide: bool = k != null and (Vector2(cx, cz).length() < KEEP_OUT or (absf(cx) < 31000 and absf(cz - River.main_z(cx)) < 450))
	if x == p.x and z == p.z and p.shown == (not hide):
		return false
	p.x = x
	p.z = z
	p.shown = not hide
	var s: float = plans[p.plan].size
	decals.multimesh.set_instance_transform(p.i, HIDE if hide else Transform3D(Basis(Vector3.UP, p.turn).scaled_local(Vector3(s, 1, s)), Vector3(x, 0, z)))
	return true

## Each frame: (sx, sz) the ground's move this frame (world.update); keep_out: where the target city is, in
## the same frame; focus: where you are (in the scene). The places re-placed a few a frame (they move
## across the wrap far off), the near ones built in 3D.
func update(sx: float, sz: float, keep_out_ = null, focus = null) -> void:
	group.position.x += sx
	group.position.z += sz
	keep_out = keep_out_
	var gp := group.position
	var fx := -gp.x
	var fz := -gp.z
	var parent := group.get_parent() as Node3D
	if focus != null and parent:
		var f := parent.to_local(focus)
		fx = f.x - gp.x
		fz = f.z - gp.z
	for k in 40:
		next = (next + 1) % places.size()
		put(places[next], fx, fz)
	tick += 1
	if tick % 20 == 0:
		build_3d(fx, fz)

## Stand up in 3D the villages nearest (fx, fz), as many as the pool holds (nothing done if they're the same ones).
func build_3d(fx: float, fz: float) -> void:
	var nearby := places.filter(func(p): return p.shown and Vector2(p.x - fx, p.z - fz).length() < NEAR_R + plans[p.plan].size / 2)
	nearby.sort_custom(func(a, b): return Vector2(a.x - fx, a.z - fz).length() < Vector2(b.x - fx, b.z - fz).length())
	var key := "|".join(nearby.map(func(p): return "%d@%s,%s" % [p.i, p.x, p.z]))
	if key == near:
		return
	near = key
	var n := 0
	var ns := 0
	var wm := walls.multimesh
	var rm := roofs.multimesh
	var sm := spires.multimesh
	for p in nearby:
		var plan: Dictionary = plans[p.plan]
		var c := cos(p.turn)
		var s := sin(p.turn)
		for b in plan.buildings:
			if n >= POOL:
				break
			var x: float = p.x + b.x * c + b.z * s
			var z: float = p.z - b.x * s + b.z * c
			var th: float = PI / 2 - b.ang + p.turn
			var q := Basis(Vector3.UP, th)
			wm.set_instance_transform(n, Transform3D(q.scaled_local(Vector3(b.wid, b.h, b.len)), Vector3(x, 0, z)))
			var wc: Array = WALL[b.wall]
			wm.set_instance_color(n, Color.hex((int(wc[(n * 7) % wc.size()]) << 8) | 0xff))
			rm.set_instance_transform(n, Transform3D(q.scaled_local(Vector3(b.wid, b.rh, b.len)), Vector3(x, b.h, z)) if b.rh > 0 else HIDE)
			rm.set_instance_color(n, Color.html(b.roof))
			n += 1
		for sp in plan.spires:
			if ns >= SPIRES:
				break
			var x: float = p.x + sp.x * c + sp.z * s
			var z: float = p.z - sp.x * s + sp.z * c
			sm.set_instance_transform(ns, Transform3D(Basis.from_scale(Vector3(sp.r, sp.h, sp.r)), Vector3(x, sp.y, z)))
			ns += 1
	wm.visible_instance_count = n
	rm.visible_instance_count = n
	sm.visible_instance_count = ns
