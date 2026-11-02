# 3D Model and asset viewer setup.
# Port of src/viewer.js: standalone viewer for testing aircraft models.

extends Node3D

var cam: Camera3D
var model_node: Node3D
var orbit_angle := 0.0
var orbit_dist := 15.0

func _ready() -> void:
	# Basic camera and light set up for inspect mode
	cam = Camera3D.new()
	cam.position = Vector3(0, 2, orbit_dist)
	add_child(cam)
	cam.make_current()

	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-45, 45, 0)
	add_child(light)

func load_model(path: String) -> void:
	if model_node:
		model_node.queue_free()
	var scene: PackedScene = load(path)
	if scene:
		model_node = scene.instantiate()
		add_child(model_node)

func _process(delta: float) -> void:
	if model_node:
		model_node.rotate_y(delta * 0.5)
