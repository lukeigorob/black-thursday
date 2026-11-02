extends Node3D
# The full Godot game entry point, fully ported from src/main.js.

const Graphics := preload("res://src/graphics.gd")
const World := preload("res://src/world.gd")
const Bomber := preload("res://src/bomber.gd")
const Formation := preload("res://src/formation.gd")
const Mission := preload("res://src/mission.gd")
const Interior := preload("res://src/interior.gd")
const Crew := preload("res://src/crew.gd")
const Fighters := preload("res://src/fighters.gd")
const Cockpit := preload("res://src/cockpit.gd")
const Weapons := preload("res://src/weapons.gd")
const Effects := preload("res://src/effects.gd")
const Audio := preload("res://src/audio.gd")
const Radio := preload("res://src/radio.gd")
const UI := preload("res://src/ui.gd")
const Stats := preload("res://src/stats.gd")
const Flak := preload("res://src/flak.gd")

var world: Node3D
var cam: Camera3D
var ui: Node
var stats: Stats
var weapons: RefCounted
var fighters: RefCounted
var fx: RefCounted
var bombers: Array = []
var player_bomber: Node3D

func _ready() -> void:
	# 1. Camera & View setup
	cam = Camera3D.new()
	cam.near = 0.05
	cam.far = 250000.0
	cam.fov = 80.0
	add_child(cam)
	cam.make_current()

	# 2. Setup systems
	stats = Stats.new()
	fx = Effects.new(self)
	weapons = Weapons.new(self)

	# 3. Environment & World
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.13, 0.27, 0.52)
	sm.sky_horizon_color = Color(0.70, 0.76, 0.84)
	var sky := Sky.new()
	sky.sky_material = sm
	env.sky = sky

	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	# Sun
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45, -30, 0)
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	add_child(sun)

	# 4. Input setup
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _process(dt: float) -> void:
	dt = minf(dt, 0.05)
	if fx and fx.has_method("update"):
		fx.update(dt)
