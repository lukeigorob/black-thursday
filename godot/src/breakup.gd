extends RefCounted
# Bombers coming apart: a wing folding off at the outer joint or snapping at the root, the tail
# breaking away, the fuselage parting where a fire has burnt through. The parts really leave.
#  - The bomber (its own model, whichever detail it has) has the lost region cut away in its shaders,
#    the torn edge charred and glowing, the inside of the skin dark where you look into it.
#  - Each lost part is a copy of the same model that keeps only that region, given its own
#    tumble and fall, trailing fire and smoke, with a little debris.
# Bombers far off (drawn by the instanced Fleet, which can't be cut) get a low-detail model of their
# own once they break up. Copies share the models' meshes, so a break-up costs no loading.
# (The cut is bomber_skin.gdshader's CUT, on a copy of each material a cut: models.gd skin().)

const Models := preload("res://src/models.gd")

const MAX_PIECES := 8 # pieces at once
const FAR := 2500.0 # past FAR a wreck stays in the instanced Fleet (a lost wing is a few pixels there)

# the parts a B-17 comes apart at, in bomber space (x right, y up, z back): [min], [max]
const REGIONS := {
	wingLo = [[-40, -3, -10], [-8.0, 2, 0]], # outer wing, beyond engine 1
	wingRo = [[8.0, -3, -10], [40, 2, 0]],
	wingLi = [[-40, -3, -10], [-1.3, 2, 0]], # the whole wing at the root, engines and all
	wingRi = [[1.3, -3, -10], [40, 2, 0]],
	tail = [[-8, -4, 6.0], [8, 6, 20]], # fin, tailplanes and the tail gun
}
## The fuselage parting at z: everything behind it goes.
static func behind(z: float) -> Array:
	return [[-8, -4, z], [8, 6, 20]]

# up to 4 boxes; keep = 1 draws only inside the boxes (a piece), 0 draws only outside (what's left)
const MAXB := 4

## The cut state shared by one model's materials: the boxes, which side to keep, its inverse transform.
class CutState:
	var min_: Array = [Vector3.ZERO, Vector3.ZERO, Vector3.ZERO, Vector3.ZERO]
	var max_: Array = [Vector3.ZERO, Vector3.ZERO, Vector3.ZERO, Vector3.ZERO]
	var n := 0
	var keep := 0.0
	var inv := Transform3D.IDENTITY
	var t := 0.0
	var mats: Array = []

	func set_boxes(boxes: Array) -> void:
		for i in mini(MAXB, boxes.size()):
			var a: Array = boxes[i][0]
			var b: Array = boxes[i][1]
			min_[i] = Vector3(a[0], a[1], a[2])
			max_[i] = Vector3(b[0], b[1], b[2])
		n = mini(MAXB, boxes.size())
		for m in mats:
			push_boxes(m)

	func push_boxes(m: ShaderMaterial) -> void:
		m.set_shader_parameter("cut_min", PackedVector3Array(min_))
		m.set_shader_parameter("cut_max", PackedVector3Array(max_))
		m.set_shader_parameter("cut_n", n)
		m.set_shader_parameter("cut_keep", keep)

	## The matrix and the time, each frame.
	func push_frame() -> void:
		var p := Projection(inv)
		for m in mats:
			m.set_shader_parameter("cut_inv", p)
			m.set_shader_parameter("cut_t", t)

static func cut_state(boxes: Array, keep: bool) -> CutState:
	var s := CutState.new()
	s.keep = 1.0 if keep else 0.0
	s.set_boxes(boxes)
	return s

## A material that can be cut: the B-17's skin, or a material it can be made from (not the nose glass, the
## additive and unshaded ones, or other shaders).
static func _cuttable(mat: Material) -> bool:
	if not mat or mat.get_meta("glass", false):
		return false
	if mat is ShaderMaterial:
		return mat.has_meta("skin_defines")
	if mat is BaseMaterial3D:
		return not (mat.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED and mat.blend_mode == BaseMaterial3D.BLEND_MODE_ADD)
	return false

## Swap every material under `root` for a cut copy using `state` (originals kept to put back). A piece
## (state.keep) hides what can't be cut (the nose glass, the markings): else it'd fall with the piece whole.
static func apply_cut(root: Node, state: CutState) -> void:
	var cache := {}
	for o in root.find_children("*", "GeometryInstance3D", true, false) + ([root] if root is GeometryInstance3D else []):
		if o.get_meta("noCut", false):
			continue
		if not (o is MeshInstance3D) or not o.mesh:
			if state.keep > 0.5 and o is Label3D:
				o.visible = false
			continue
		var was := []
		var any := false
		for i in o.mesh.get_surface_count():
			was.append(o.get_surface_override_material(i))
			var mat := Models.surface_material(o, i)
			if not _cuttable(mat):
				if state.keep > 0.5 and mat and mat.get_meta("glass", false):
					o.set_surface_override_material(i, _hidden())
				continue
			var src: Material = mat.get_meta("cut_from", mat)
			if not cache.has(src):
				var m := Models.skin(src, ["CUT"], true, ["CULL_BACK"]) # (through the torn end you see the inside of the skin)
				m.set_meta("cut_from", src)
				state.mats.append(m)
				state.push_boxes(m)
				cache[src] = m
			o.set_surface_override_material(i, cache[src])
			any = true
		if not o.has_meta("uncut"):
			o.set_meta("uncut", was)
			o.set_meta("shadow_was", o.cast_shadow)
		o.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		o.set_meta("noShadow", true)
	state.push_frame()

static var _hide_mat: StandardMaterial3D
static func _hidden() -> Material:
	if not _hide_mat:
		_hide_mat = StandardMaterial3D.new()
		_hide_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_hide_mat.albedo_color = Color(0, 0, 0, 0)
	return _hide_mat

static func remove_cut(root: Node) -> void:
	for o in root.find_children("*", "MeshInstance3D", true, false) + ([root] if root is MeshInstance3D else []):
		if not o.has_meta("uncut"):
			continue
		var was: Array = o.get_meta("uncut")
		for i in was.size():
			o.set_surface_override_material(i, was[i])
		o.remove_meta("uncut")
		o.cast_shadow = o.get_meta("shadow_was", GeometryInstance3D.SHADOW_CASTING_SETTING_ON)
		o.set_meta("noShadow", false)
	for l in root.find_children("*", "Label3D", true, false):
		l.visible = true

var scene: Node
var effects
var sources: Dictionary
var pieces: Array = []
var cam_pos = null

## sources: { lod, mid }: model scenes to copy for pieces (and for far bombers' bodies).
func _init(scene_: Node, effects_, sources_: Dictionary) -> void:
	scene = scene_
	effects = effects_
	sources = sources_

## Compile the cut shaders now (both details, body and piece), not mid-battle on the first break-up.
## (In the real scene, for a couple of frames, out of sight: its lights and shadows are part of each pipeline.
## Godot's own pipeline cache and ubershaders cover most of this; it's kept as the web game had it.)
func warm(_renderer = null, _camera = null) -> void:
	var roots := []
	for src in [sources.get("mid"), sources.get("lod")]:
		if not src:
			continue
		for keep in [true, false]:
			var root: Node3D = src.duplicate()
			apply_cut(root, cut_state([REGIONS.tail], keep))
			root.position = Vector3(0, -50000, 0) # (out of sight)
			scene.add_child(root)
			roots.append(root)
	_free_later(roots)

func _free_later(roots: Array) -> void:
	if not scene.is_inside_tree():
		for r in roots:
			r.queue_free()
		return
	await scene.get_tree().process_frame
	await scene.get_tree().process_frame
	for r in roots:
		if is_instance_valid(r):
			r.queue_free()

## Compile the cut versions of everything in `root` (your own bomber, its cabin) now, not when it first breaks up.
func warm_cut(root: Node, _renderer = null, _camera = null) -> void:
	apply_cut(root, cut_state([REGIONS.tail], true))
	if scene.is_inside_tree():
		await scene.get_tree().process_frame
		await scene.get_tree().process_frame
	remove_cut(root)

## Bomber `b` has lost a part: kind 'wingo' / 'wingi' (side -1 left, 1 right), 'tail', or 'fuselage'
## (parting at z). Called from its damage fx with the velocity its wreckage starts with.
func lose(b, kind: String, side: int, z: float, vel: Vector3) -> void:
	if b.cut_boxes == null:
		b.cut_boxes = []
	if b.lost_parts == null:
		b.lost_parts = {}
	var s := "L" if side < 0 else "R"
	var had := func(k: String) -> bool: return b.lost_parts.has(k)
	var boxes: Array
	if kind == "wingo":
		boxes = [] if had.call("wing" + s + "o") or had.call("wing" + s + "i") else [REGIONS["wing%so" % s]]
	elif kind == "wingi":
		if had.call("wing" + s + "i"):
			boxes = []
		else: # (the outer panel may have gone already: this piece is the rest of the wing)
			var r: Array = REGIONS["wing%si" % s].duplicate(true)
			if had.call("wing" + s + "o"):
				if side < 0:
					r[0][0] = REGIONS.wingLo[1][0]
				else:
					r[1][0] = REGIONS.wingRo[0][0]
			boxes = [r]
	elif kind == "tail":
		boxes = [] if had.call("tail") else [REGIONS.tail]
	else:
		boxes = [] if had.call("fuselage") else [[[-1.7, -4, z], [1.7, 4, 20]], REGIONS.tail] # (the rear fuselage and its tail)
	if not boxes.size() or b.cut_boxes.size() + boxes.size() > MAXB:
		return
	b.lost_parts["wing%s%s" % [s, kind.right(1)] if kind == "wingo" or kind == "wingi" else kind] = true
	if kind == "fuselage":
		b.lost_parts["tail"] = true
	b.cut_boxes.append_array(boxes)
	cut_body(b)
	var piece := spawn_piece(b, boxes, kind, side, z, vel)
	if kind == "tail" or kind == "fuselage":
		b.tail_piece = piece

## Keep the bomber's own drawing cut, whatever model it has right now.
func cut_body(b) -> void:
	if not b.cut_boxes or not b.cut_boxes.size():
		return
	if not b.model and not b.wreck_body and cam_pos != null and b.group.position.distance_to(cam_pos) > FAR:
		return # (too far to see it: the Fleet draws it whole)
	if not b.model and not b.wreck_body: # a far one, drawn by the Fleet: give it a model of its own
		b.wreck_body = sources.lod.duplicate()
		b.group.add_child(b.wreck_body)
		if not b.group.get_parent():
			scene.add_child(b.group)
	var root: Node3D = b.model if b.model else b.wreck_body
	if b.cut_root != root: # (a new model: cut it the same)
		if b.cut_root and is_instance_valid(b.cut_root):
			remove_cut(b.cut_root)
		b.cut_state = cut_state(b.cut_boxes, false)
		apply_cut(root, b.cut_state)
		if b.model and b.interior:
			apply_cut(b.interior.group, b.cut_state) # your own bomber's cabin goes with it
		b.cut_root = root
	else:
		b.cut_state.set_boxes(b.cut_boxes)
	# the propellers out on a lost wing go with it
	for p in b.props:
		if p:
			p.visible = not b.cut_boxes.any(func(bx): return p.position.x > bx[0][0] and p.position.x < bx[1][0] and p.position.z > bx[0][2] and p.position.z < bx[1][2])

## A model handed back to the pool, or a bomber gone: put the materials back.
func release(b) -> void:
	if b.cut_root and is_instance_valid(b.cut_root):
		remove_cut(b.cut_root)
	if b.interior:
		remove_cut(b.interior.group)
	b.cut_root = null
	if b.wreck_body:
		b.group.remove_child(b.wreck_body)
		b.wreck_body.queue_free()
		b.wreck_body = null

func spawn_piece(b, boxes: Array, kind: String, side: int, z: float, vel: Vector3) -> Dictionary:
	if pieces.size() >= MAX_PIECES:
		drop(pieces[0])
	# (copied from a clean source model: never a cut one)
	var far: bool = cam_pos != null and b.group.position.distance_to(cam_pos) > 400
	var root: Node3D = (sources.lod if far or not sources.get("mid") else sources.mid).duplicate() # (low detail unless it's close)
	var state := cut_state(boxes, true)
	apply_cut(root, state)
	var g := Node3D.new()
	g.add_child(root)
	g.transform = b.group.transform
	scene.add_child(g)
	# where it tore off (in the piece's own space), for its fire and smoke, and its middle
	var tear := Vector3(0, 0.3, 6.0) if kind == "tail" else Vector3(side * 8.0, -0.6, -4.5) if kind == "wingo" \
		else Vector3(side * 1.4, -0.7, -4.6) if kind == "wingi" else Vector3(0, 0, z)
	var centre := Vector3(0, 0.8, 8.5) if kind == "tail" else Vector3(side * 12, -0.6, -4.5) if kind == "wingo" \
		else Vector3(side * 7, -0.6, -4.5) if kind == "wingi" else Vector3(0, 0.3, (z + 11) / 2)
	# spin about its middle: a wing flips over and over, the tail tumbles end over end
	var spin := Vector3(randf_range(-0.6, 0.6), randf_range(-0.4, 0.4), side * randf_range(1.6, 2.6)) if kind.begins_with("wing") \
		else Vector3(randf_range(1.0, 1.8) * (-1 if randf() < 0.5 else 1), randf_range(-0.5, 0.5), randf_range(-0.6, 0.6))
	var v := vel + Vector3(side * (6 if kind.begins_with("wing") else 0), randf_range(-2, 3), 8 if kind == "tail" else 4)
	var piece := {g = g, root = root, state = state, v = v, spin = spin, centre = centre, tear = tear, t = 0.0, kind = kind, burn = randf() < 0.85}
	pieces.append(piece)
	# the moment it goes: a burst of fire and pieces of skin at the tear
	var at: Vector3 = g.transform * tear
	var near := clampf(at.distance_to(cam_pos) / 30, 0.2, 1) if cam_pos != null else 1.0
	if effects:
		effects.explosion(at, vel, (1.2 if kind == "tail" else 1.6) * near) # (smaller right by your eye: from inside, a full one whites out the cabin)
	return piece

func drop(p: Dictionary) -> void:
	if p.g.get_parent():
		p.g.get_parent().remove_child(p.g)
	p.g.queue_free()
	pieces.erase(p)

func update(dt: float, cam_pos_) -> void:
	cam_pos = cam_pos_
	for p in pieces.duplicate():
		p.t += dt
		p.state.t = p.t
		# falls: gravity to a tumbling piece's terminal speed, the air stream carrying it back
		p.v.y = maxf(p.v.y - 9.8 * dt, -60.0 if p.kind == "tail" else -45.0)
		p.v.z += (25 - p.v.z) * minf(1.0, dt * 0.25)
		# turn about its centre of mass, not the bomber's origin
		var g: Node3D = p.g
		var c: Vector3 = g.transform * p.centre
		var b := g.basis * Basis.from_euler(p.spin * dt, EULER_ORDER_XYZ)
		g.transform = Transform3D(b, c - b * p.centre + p.v * dt)
		p.state.inv = g.transform.affine_inverse()
		p.state.push_frame()
		var at: Vector3 = g.transform * p.tear
		if p.burn and p.t < 40 and not (cam_pos != null and at.distance_to(cam_pos) < 18) and effects: # (not right by your eye: it whites out the view)
			effects.trail(at, Vector3(0, 0, 3), "fire", dt * 0.8)
			effects.trail(at, Vector3(0, 0, 3), "black", dt)
		if p.t > 60 or (cam_pos != null and g.position.distance_to(cam_pos) > FAR + 500):
			drop(p)

## Each frame, for every broken bomber: keep its cut's frame on it.
func track(bombers: Array) -> void:
	for b in bombers:
		if not b.cut_boxes or not b.cut_boxes.size():
			continue
		if b.gone:
			release(b)
			continue
		if b.wreck_body and cam_pos != null and b.group.position.distance_to(cam_pos) > FAR + 300:
			release(b)
			continue
		cut_body(b)
		if not b.cut_root:
			continue # (far: drawn whole by the Fleet)
		if b.wreck_body and b.model:
			b.group.remove_child(b.wreck_body)
			b.wreck_body.queue_free()
			b.wreck_body = null
			cut_body(b)
		b.cut_state.t = b.down_t
		b.cut_state.inv = b.group.transform.affine_inverse()
		b.cut_state.push_frame()
