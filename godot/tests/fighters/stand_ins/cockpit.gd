extends RefCounted
# Stand-in for src/cockpit.gd (the fighters' test only, until the cockpits session's lands): an empty cockpit
# with the update/night hooks, and a plain ring-and-dot reflector sight.
const Geo := preload("res://src/core/geo.gd")
const Mat := preload("res://src/core/mat.gd")

class Pit extends Node3D:
	var night_k := 0.0
	func update(_s: Dictionary, _dt: float) -> void: pass
	func night(_k: float) -> void: pass

static func build_cockpit(_kind: String) -> Node3D:
	return Pit.new()

static func build_reticle(_kind: String) -> Node3D:
	var r := Node3D.new()
	var m := Mat.basic({color = 0xff8a3a, transparent = true, opacity = 0.85, depthTest = false, side = Mat.DOUBLE})
	var ring := MeshInstance3D.new()
	ring.mesh = Geo.ring(0.36, 0.375, 64).to_mesh(m)
	r.add_child(ring)
	var dot := MeshInstance3D.new()
	dot.mesh = Geo.circle(0.012, 12).to_mesh(m)
	r.add_child(dot)
	return r
