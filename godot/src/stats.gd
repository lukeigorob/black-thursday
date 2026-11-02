# Player statistics, mission points, and career tracking.
# Port of src/stats.js.

extends RefCounted

const POINTS := {
	"hit": 10,
	"crit": 50,
	"kill": 200,
	"assist": 100
}

var score: int = 0
var hits: int = 0
var crits: int = 0
var kills: int = 0
var assists: int = 0
var mission_score: int = 0

func hit(damage: float) -> void:
	hits += 1
	score += POINTS["hit"]

func crit() -> void:
	crits += 1
	score += POINTS["crit"]

func kill() -> void:
	kills += 1
	score += POINTS["kill"]

func assist() -> void:
	assists += 1
	score += POINTS["assist"]

func reset() -> void:
	score = 0
	hits = 0
	crits = 0
	kills = 0
	assists = 0
