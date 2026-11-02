extends RefCounted
# How big the battle is: how many bombers fly and how many fighters are in the air. The game is always
# the Large battle; the smaller ones are kept for testing (a link's ?battle=, here `-- --battle=small`).
# Read once at start-up.

const Args := preload("res://src/core/args.gd")

const BATTLES := {
	# (axisTotal: the whole mission's Luftwaffe, coming up in waves; 100 of them Fw 190s, fighters.js)
	small = {label = "Small", wings = 1, axis_active = 50, axis_total = 270, allied_active = 10, allied_total = 25, gaggle = [8, 14]}, # 54 B-17s
	medium = {label = "Medium", wings = 3, axis_active = 95, axis_total = 370, allied_active = 16, allied_total = 40, gaggle = [12, 22]}, # 162 B-17s
	# (Schweinfurt, 14 October 1943: 291 B-17s; six combat wings, the last of them short)
	large = {label = "Large", wings = 6, bombers = 291, axis_active = 165, axis_total = 470, allied_active = 20, allied_total = 50, gaggle = [15, 28]},
}

# Always the large battle. (--battle=small or medium: a hidden override, for testing only.)
static func _pick() -> String:
	var from_link = Args.param("battle")
	return from_link if from_link != null and BATTLES.has(from_link) else "large"

static var battle_name: String = _pick()
static var BATTLE: Dictionary = BATTLES[battle_name]
