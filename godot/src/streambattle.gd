extends RefCounted
# The air battle across the whole stream. Round you it's fought for real (fighters.js: fighters, rounds,
# hits); everywhere else it's played out in the abstract, a group at a time, so the losses fall all
# down the stream as they did in the real raids, not only where you happen to be:
# - each second, each 18-ship group away from your fight may take a fighter pass (more while the
#   Luftwaffe has plenty up and is attacking, few over the flak belt, none once they've gone home) and
#   the flak where the route takes it;
# - a pass picks one bomber (a straggler or a damaged one far likelier) and puts a burst into one or two
#   of its parts, through the same damage as a real hit (bomber.hit: engines out, fires, a wing gone),
#   and the crew near it are hurt (crew.js);
# - the passes go mostly at a few "hot" groups at a time, changing every so often, weighted towards the
#   exposed ones (the lead group, the low groups, the trailing wings: "Purple Heart Corner");
# - a governor for each group as well as the stream: none wiped out by chance, none untouched.

const Bomber := preload("res://src/bomber.gd")
const Oob := preload("res://src/oob.gd")

static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)
static var REAL: float = Oob.FIGHT_RANGE # m from your bomber: inside this the fight is the real one (all of the compact force)
# (the fighters and the flak both: the flak mostly by an engine set alight, the fire into the wing)
const PASS_RATE := 0.04 # fighter passes a second at a group, at full pressure
const FLAK_RATE := 0.15 # flak hits a second at a group, at the heaviest
static var ENGINES: Array = Bomber.PARTS.filter(func(p): return p.kind == "engine")
const HOT_EVERY := 40.0 # s: the fighters shift their attention to other groups

var bombers: Array
var crews = null
var effects = null
var t := 0.0
var hot_t := 0.0
var hot := {}
var tick := 0.0
var groups := {} # group -> its bombers (who's in which group changes as they re-form)
var group_bias := {} # group -> how hard it's being hit, against how it should be (1: as it should)

func _init(o: Dictionary) -> void:
	bombers = o.bombers
	crews = o.get("crews")
	effects = o.get("effects")

## The exposure of a group by its place in the stream (its name: wing-position).
func exposure(g: String) -> float:
	var p := g.split("-")
	var wing := p[0]
	var pos := p[1] if p.size() > 1 else ""
	return (1.4 if pos == "Low" else 1.15 if pos == "Lead" else 1.0) * (1.25 if wing == "2" else 1.1 if wing == "1" else 1.0)

## dt: s. ctx: { center (your bomber's position), want (the share of the bombers lost by now, main.js),
## fighters (their state: how many up, suppressed, leaving), flak ({ on, heavy }), loss_bias }.
func update(dt: float, ctx: Dictionary) -> void:
	t += dt
	tick -= dt
	if tick > 0:
		return
	tick = 1.0
	groups.clear()
	for b in bombers:
		if not b.gone:
			if not groups.has(b.squad):
				groups[b.squad] = []
			groups[b.squad].append(b)
	hot_t -= 1
	if hot_t <= 0: # a new set of groups the fighters go for
		hot_t = HOT_EVERY
		hot.clear()
		var names: Array = groups.keys()
		for k in maxi(2, roundi(names.size() * 0.3)):
			var w: Array = names.map(func(g): return exposure(g))
			var sum := 0.0
			for x in w:
				sum += x
			var r := randf() * sum
			var i := 0
			while r > w[i] and i < w.size() - 1:
				r -= w[i]
				i += 1
			hot[names[i]] = true
	var f = ctx.fighters
	var up: int = f.axis.size() if f and f.get("axis") != null else 0
	# how hard the Luftwaffe is pressing: how many it has up, against the stage of the day
	var pressure := 0.0 if not f or f.leaving else minf(1.3, up / 120.0) * (0.25 if f.suppressed else 1.0) * (1.2 if (f.get("surge_t") if f.get("surge_t") != null else 0.0) > 0 else 1.0)
	var want: float = ctx.want # the share each group should have lost by now (main.js)
	for g in groups:
		var list: Array = groups[g]
		var alive := list.filter(func(b): return not b.down)
		if not alive.size():
			continue
		var peril := 0.0
		for b in alive:
			peril += b.peril
		var lost := (list.size() - alive.size() + peril) / list.size() # (the crippled ones partly)
		# each group's own governor (the real fight round you uses it too: fighters.js, flak.js)
		group_bias[g] = clampf(1 + (want - lost) * 25, 0.02, 2.2)
		var centre: Vector3 = alive[0].group.position
		if centre.distance_to(ctx.center) < REAL:
			continue # (the real fight's here)
		var bias: float = group_bias[g] * clampf(ctx.get("loss_bias") if ctx.get("loss_bias") != null else 1.0, 0.1, 1.8)
		# the group's own guns keep them off: fewer passes the more of it is left
		var guns := alive.size() / float(list.size())
		var passes := PASS_RATE * pressure * (2.2 if hot.has(g) else 0.6) * exposure(g) * bias * (1.25 - 0.5 * guns)
		if randf() < passes:
			pass_at(alive)
		var flak = ctx.get("flak")
		if flak and flak.on and randf() < FLAK_RATE * flak.heavy * bias:
			flak_hit(alive)

## A fighter pass at one bomber of the group: a burst into one or two of its parts, the crew near them hurt.
## (pass() in the web game: `pass` is a word of GDScript's own)
func pass_at(alive: Array) -> void:
	var w: Array = alive.map(func(b): return (5.0 if b.straggling else 1.0) * (2.0 if b.dead_engines else 1.0) * (1.5 if b.burning else 1.0) * b.hist_k) # (hist_k: the records' fates, main.js)
	var sum := 0.0
	for x in w:
		sum += x
	var r := randf() * sum
	var i := 0
	while r > w[i] and i < w.size() - 1:
		r -= w[i]
		i += 1
	var b = alive[i]
	var cannon := randf() < 0.45
	var k := 1 if randf() < 0.5 else 2
	while k > 0:
		var part: Dictionary = Bomber.PARTS[randi() % Bomber.PARTS.size()]
		var n := roundi(rand(6, 18))
		while n > 0:
			b.hit(part, cannon)
			n -= 1
		wound(b, part, cannon)
		k -= 1
	if effects and b.group.visible != false:
		effects.impact(b.group.position, true)

## Flak: a burst near one bomber of the group.
func flak_hit(alive: Array) -> void:
	var b = alive[randi() % alive.size()]
	var part: Dictionary = ENGINES[randi() % ENGINES.size()] if randf() < 0.5 else Bomber.PARTS[randi() % Bomber.PARTS.size()]
	var n := roundi(rand(4, 14))
	while n > 0:
		b.hit(part, randf() < 0.6)
		n -= 1
	if part.kind == "engine" and randf() < 0.45:
		b.ignite_engine(part.engine) # (alight from the splinters)
	wound(b, part, true)

func wound(b, part: Dictionary, cannon: bool) -> void:
	var c = crews.get(b) if crews else null
	if not c or part.kind != "section":
		return
	var p: Array = part.box
	c.on_hit(part, Vector3((p[0] + p[1]) / 2, (p[2] + p[3]) / 2, (p[4] + p[5]) / 2), cannon, null)
