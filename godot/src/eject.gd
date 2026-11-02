extends Node
# Bailing out: a short free fall, the chute opens, and you hang under it watching the battle go on
# overhead while you drift down and back behind the bomber stream (the air streams past at AIRSPEED).
#
# (Godot: the script is the Eject class, `Eject.new(scene)`, a Node, added to the scene, so it hears the mouse.)

const Bomber := preload("res://src/bomber.gd")
const Parachutes := preload("res://src/parachutes.gd")
const Figure := preload("res://src/figure.gd")
const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")

const FREEFALL := 1.8
const HANG := 6.0 # s: falling before the chute opens; then hanging before you can go again
const LOOK := 0.0022
const EYE := Parachutes.DROP - 0.35 # m from the canopy's centre down to your eyes

## Your risers: from the harness on your shoulders (just behind your eye) straight up to the lines.
static func own_risers():
	var parts := []
	for sx in [-1.0, 1.0]:
		for zz in [[0.08, -0.04], [0.26, 0.08]]: # (front pair, back pair)
			var A := Vector3(sx * 0.19, -EYE - 0.2, zz[0])
			var B := Vector3(sx * 0.2, -Parachutes.LINK, zz[1])
			var g = Geo.box(0.032, A.distance_to(B), 0.005)
			g.apply_quaternion(Parachutes._arc(Vector3(0, 1, 0), (B - A).normalized()))
			var m := (A + B) / 2
			parts.append(g.translate(m.x, m.y, m.z))
	return Geo.merge(parts)

var active := false
var pos := Vector3()
var vel := Vector3()
var yaw := 0.0
var pitch := 0.0
var look_scale := 1.0
var free_look := false
var canopy: Node3D
var silk: MeshInstance3D
var cords: MeshInstance3D
var centre := Vector3()
var from = null
var on_done = null
var t := 0.0
var is_ready := false # (the web game's eject.ready: Node has its own `ready`)
var open_at = null # when the ripcord was pulled (J); a static line opens it for you at 7 s
var body: Figure.Fig = null
var grips = null

func _init(scene: Node3D) -> void:
	name = "Eject"
	# your own chute above you: look up and you see the canopy and the lines running down to you
	canopy = Node3D.new()
	# the lines down to the risers, the risers down to your harness: you hold them, your hands up in the
	# corners of your view; look down and your legs and boots hang under you
	silk = MeshInstance3D.new(); silk.mesh = Parachutes.canopy_geometry().to_mesh(Parachutes.SILK)
	cords = MeshInstance3D.new(); cords.mesh = Parachutes.lines_geometry(-Parachutes.LINK).to_mesh(Parachutes.CORD)
	var ris := MeshInstance3D.new(); ris.mesh = own_risers().to_mesh(Mat.standard({color = 0x8a8060, roughness = 0.9}))
	for m in [silk, cords, ris]:
		canopy.add_child(m)
	canopy.visible = false
	scene.add_child(canopy)

func _input(e: InputEvent) -> void:
	if e is InputEventMouseMotion:
		if not active or not (Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or free_look):
			return
		if absf(e.relative.x) > 300 or absf(e.relative.y) > 300:
			return
		yaw -= e.relative.x * LOOK * look_scale
		pitch = clampf(pitch - e.relative.y * LOOK * look_scale, -1.4, 1.5)
	elif e is InputEventMouseButton and e.pressed:
		if active and e.button_index == MOUSE_BUTTON_LEFT and t > 0.6 and on_done: # click: go again now
			on_done.call()

## Out of the plane at `p`, moving with `v`; on_done() when you're ready to go again. from: 'fighter' | 'crew'.
func start(p: Vector3, v: Vector3, from_: String, done: Callable) -> void:
	active = true
	pos = p
	vel = v
	from = from_
	on_done = done
	t = 0
	is_ready = false
	open_at = null
	# look up at the bomber stream flying on ahead (you drift back behind it)
	yaw = 0
	pitch = 0.35

func stop() -> void:
	active = false; canopy.visible = false; on_done = null

## J in free fall: pull the ripcord (after the first moment: clear of the plane).
func pull() -> void:
	if active and open_at == null:
		open_at = maxf(t, 0.6) # (clear of the plane first: a pull in the first moment opens it just after)
var falling: bool:
	get: return active and open_at == null

## You, in the harness: hands up on the risers, legs dangling and swinging a little.
func hang(tt: float) -> void:
	if not body:
		if not Figure.crew_info(): # (the crew's model: loaded by now)
			return
		body = Figure.make_figure({"self": true})
		canopy.add_child(body)
	var b := body
	var j := b.j
	# the neck just under your eye, as in the bomber (player.gd): the body hangs straight down from it
	b.position = Vector3(0, -EYE - (j.hips.position.y + 0.6) - 0.14, 0.18)
	for ls in [[j.leg_l, 1.0], [j.leg_r, -1.0]]: # legs a little apart, hanging forward, swaying
		var s: float = ls[1]
		ls[0].hip.rotation = Vector3(0.25 + 0.12 * sin(tt * 1.3 + s), 0, s * -0.08)
		ls[0].knee.rotation = Vector3(-0.35 - 0.1 * sin(tt * 1.1 + s * 2), 0, 0)
	j.torso.rotation = Vector3(-0.05, 0, 0)
	if grips == null:
		grips = [Vector3(), Vector3()]
	for is_ in [[0, -1.0], [1, 1.0]]: # (your hands on the front risers, just over your head)
		grips[is_[0]] = canopy.global_transform * Vector3(is_[1] * 0.2, -EYE + 0.3, 0.05)
	Figure.reach_for(b, grips)

func update(dt: float, camera: Node3D) -> void:
	if not active:
		return
	t += dt
	if open_at == null and t > 7:
		open_at = t
	var open: bool = open_at != null and t > open_at + 0.35
	var t0: float = (open_at if open_at != null else FREEFALL) + 0.35
	if not open: # tumbling out: gravity, and the air quickly takes away the plane's speed
		var d := exp(-dt * 1.2)
		vel.x *= d; vel.z = Bomber.AIRSPEED + (vel.z - Bomber.AIRSPEED) * d
		vel.y = maxf(vel.y - 9.81 * dt, -50)
	else: # under the canopy: a few m/s down, carried with the wind
		var d := exp(-dt * 2.5)
		vel.x *= d; vel.y = -6 + (vel.y + 6) * d; vel.z = Bomber.AIRSPEED + (vel.z - Bomber.AIRSPEED) * d
	pos += vel * dt
	var lk := Quaternion.from_euler(Vector3(pitch + (0.0 if open else sin(t * 9) * 0.08), yaw, 0))
	canopy.visible = open
	if not open:
		camera.global_position = pos; camera.quaternion = lk
	else: # you hang under the canopy and swing with it like a pendulum
		var tt := t - t0
		centre = pos + Vector3(0, EYE, 0)
		var q := Parachutes.chute_swing(tt, 0.7)
		canopy.position = centre
		canopy.quaternion = q
		var sh := Parachutes.chute_shape(tt)
		silk.scale = sh
		cords.scale = Vector3(sh.x, 1, sh.z)
		camera.global_position = centre + q * Vector3(0, -EYE, 0)
		camera.quaternion = q * lk # your view swings with you
		hang(tt)
	is_ready = open and t > t0 + HANG
