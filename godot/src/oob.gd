extends RefCounted
# The order of battle of Mission 115, Schweinfurt, 14 October 1943, and how it flew: two air divisions,
# six combat wings, sixteen bomb groups (with the 100th's eight split between the 95th and the 390th),
# 291 B-17s. Built from the research (BLACK_THURSDAY_RESEARCH.md, historical_data/black_thursday):
# what's documented is used as it is; what isn't (the 3rd Division's wing positions, the lateral and
# fore-and-aft spacing) is an estimate, marked so here and in the research notes, and set in one place
# (LAYOUT) so it can be changed. Offsets are metres: x right, y up, z back (behind the lead), each from
# its parent formation's lead, so a whole box moves with its leader.

const Args := preload("res://src/core/args.gd")

# ---- how each level is laid out (formations.json; the confidence of each is in the comment) ----
# Two layouts. HISTORICAL_LAYOUT is the force as it flew: the combat wings two minutes (9 km) apart and
# the 3rd Division thirty miles off to the side, so from any one bomber you see your own wing and little
# else. The game flies COMPACT_LAYOUT: the same order of battle, groups, squadrons, elements and charted
# slots, with only the distances between the wings and the divisions shrunk (and the wing a little
# tighter), so the whole force is round you in one mass of 291 bombers and the fighters' attacks all
# through it are in sight. --spacing=historical flies the historical one.
const SHARED := {
	# an element of three: the lead, the wingmen back and out on either side (50 ft wingtip and nose-to-tail
	# clearance: B-17 Pilot Training Manual, PROBABLE; opened a tenth for the game, as is everything below)
	element = [[0, 0, 0], [-52, 0, 42], [52, 0, 42]],
	# a squadron of six (or seven): the second element stepped down behind the first, the seventh ship down
	# behind that (the 303rd's 3-3-1 chart: VERIFIED as an arrangement; the distances ESTIMATE)
	squadron = {second = [0, -33, 84], seventh = [0, -60, 126], third = [0, -64, 168]}, # (third: a squadron of eight or nine, the 385th's: ESTIMATE, clear of the low squadron)
	# a group: the high squadron up and to the right, the low down and to the left (vertical: the official
	# history's +100 / -250 ft diagram, PROBABLE; lateral and fore-aft ESTIMATE); the 100th's four-ship
	# flights trailing the group they joined (ESTIMATE)
	group = {lead = [0, 0, 0], high = [110, 33, 132], low = [-110, -84, 132], attached = [0, -50, 276]},
}

static func _with_shared(o: Dictionary) -> Dictionary:
	var out := SHARED.duplicate(true)
	out.merge(o, true)
	return out

static var HISTORICAL_LAYOUT: Dictionary = _with_shared({
	# a combat wing: high group 1,000 ft up and to the right, the low 1,000 ft down to the left (vertical
	# documented for this mission: the 351st's briefing; lateral and trail ESTIMATE, fitted to the wing's
	# ~3,000 x 7,000 x 2,000 ft envelope)
	wing = {lead = [0, 0, 0], high = [250, 305, 400], low = [-250, -305, 800]},
	# the wings of a division in trail, about two minutes apart (ESTIMATE, from the bombing times: 120 s at
	# the game's 75 m/s) and the 3rd Division abreast of the 1st, thirty miles to the south: to the right as
	# the stream flies east (the official history, PROBABLE)
	wing_trail = [0, 0, 9000], # m, each wing from the one ahead
	division = {"1st": [0, 0, 0], "3rd": [48300, 0, 0]}, # m
})
static var COMPACT_LAYOUT: Dictionary = _with_shared({
	# (the wing: the high and low groups closer in, still a squadron's height and more clear of the lead's)
	wing = {lead = [0, 0, 0], high = [192, 165, 232], low = [-192, -165, 462]},
	# (the wings ~700 m apart in trail, each stepped down and out a little so the one behind sees past the
	# one ahead; the 3rd Division close alongside, to the right as it flew, a little back and below. A
	# tenth looser than the tightest it would go: any tighter looked squashed, and ships wandering off their
	# slots met)
	wing_trail = [-77, -55, 792],
	division = {"1st": [0, 0, 0], "3rd": [1023, -105, 352]},
})
static var _historical: bool = Args.param("spacing") == "historical"
static var LAYOUT: Dictionary = HISTORICAL_LAYOUT if _historical else COMPACT_LAYOUT
static var COMPACT: bool = not _historical # (the fight spreads through the whole force: fighters.js, streambattle.js)
# m from your bomber: inside this the battle's fought for real, fighters and flak (beyond it, streambattle.js):
# the whole of the compact force
static var FIGHT_RANGE: float = 4200.0 if COMPACT else 1500.0

## The force as it flew: [division, wing, its groups in the wing's lead / high / low positions]. Aircraft
## counts: the 1st Division's from its own dispatch table (the 303rd's Mission 78 report: 149 in all);
## the 3rd's from the group records (94th 21, 95th 18, 96th 41 flown as two groups, 100th 8, 385th 22 by
## its association's sortie list) and the 32 left of its 142 split between the 388th and the 390th, 16
## each (ESTIMATE: their own sources say 16-22 and 15-18; 16 is what the 390th's database lists and what
## the 388th's memoir says reached the target). The 388th as the lead wing's low group: that memoir.
## pos: the group's place in its wing; 'attached': flights flying with another group (the 100th).
const FORCE := [
	{division = "1st", wing = "40th", groups = [{group = "92nd", pos = "lead", n = 19}, {group = "306th", pos = "high", n = 18}, {group = "305th", pos = "low", n = 16}]},
	{division = "1st", wing = "1st", groups = [{group = "91st", pos = "lead", n = 11}, {group = "351st", pos = "high", n = 16}, {group = "381st", pos = "low", n = 17}]},
	{division = "1st", wing = "41st", groups = [{group = "379th", pos = "lead", n = 17}, {group = "303rd", pos = "high", n = 19, squadrons = {lead = 6, high = 6, low = 7}} # (its assembly chart: the high squadron's trailing ship, an abort, is the twentieth)
		, {group = "384th", pos = "low", n = 16}]},
	# (the 3rd Division's wing order and most positions: UNVERIFIED / ESTIMATE; the 96th led it: PROBABLE)
	{division = "3rd", wing = "45th", groups = [{group = "96th", part = "A", pos = "lead", n = 21}, {group = "96th", part = "B", pos = "high", n = 20}, {group = "388th", pos = "low", n = 16, estimate = true}]},
	{division = "3rd", wing = "4th", groups = [{group = "94th", pos = "lead", n = 21}, {group = "385th", pos = "high", n = 22}]},
	{division = "3rd", wing = "13th", groups = [
		{group = "95th", pos = "high", n = 18, attach = {group = "100th", n = 4}}, # (the 100th's flights: the 3rd Division's interrogation, VERIFIED)
		{group = "390th", pos = "low", n = 16, estimate = true, attach = {group = "100th", n = 4}},
	]},
]

static func _add(a: Array, b: Array) -> Array:
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

## A squadron of n: elements of three (lead first), stepped down behind; a lone seventh ship below them.
static func _squadron_slots(n: int, layout: Dictionary) -> Array:
	var out := []
	for i in n:
		var el := i / 3
		var k := i % 3
		var base: Array = [0, 0, 0] if el == 0 else layout.squadron.second if el == 1 else layout.squadron.third if n > 7 else layout.squadron.seventh
		out.append({at = _add(base, [0, 0, 0] if n == 7 and el == 2 else layout.element[k]), element = el, wingman = k}) # (a lone seventh ship sits under the box; an eighth and ninth make a third element)
	return out

## A group's n aircraft as three squadrons, lead / high / low, as even as they'll go (the lead gets the odd one).
static func _group_squadrons(n: int, sizes = null) -> Array:
	if sizes:
		return [["lead", sizes.lead], ["high", sizes.high], ["low", sizes.low]] # (as the group's own chart has it)
	var base := n / 3
	var extra := n % 3
	return [["lead", base + (1 if extra > 0 else 0)], ["high", base + (1 if extra > 1 else 0)], ["low", base]]

## Every B-17 of the force, in the formation frame: { pos [x, y, z] (from the force's lead), division, wing,
## group, part, wing_pos, squadron, element, wingman, lead (the group's lead ship), squad (the bombing unit:
## one id a group), attached_to (the 100th's), estimate (a count or place that isn't documented) }.
static func force_slots(layout = null) -> Array:
	var L: Dictionary = layout if layout else LAYOUT # (the tests check both)
	var out := []
	var div0 := {} # division -> how many wings of it laid out so far
	for wi in FORCE.size():
		var w: Dictionary = FORCE[wi]
		var nth: int = div0.get(w.division, 0)
		div0[w.division] = nth + 1
		var d: Array = L.division[w.division]
		var t: Array = L.wing_trail
		var wing_at := [d[0] + nth * t[0], d[1] + nth * t[1], d[2] + nth * t[2]]
		for g in w.groups:
			var group_at := _add(wing_at, L.wing[g.pos])
			var squad := "%d-%s%s" % [wi, g.pos.substr(0, 1).to_upper(), g.pos.substr(1)]
			var unit := {division = w.division, wing = w.wing, wing_index = wi, group = g.group, part = g.get("part", null), wing_pos = g.pos, squad = squad, estimate = g.get("estimate", false)}
			for sq in _group_squadrons(g.n, g.get("squadrons", null)):
				var list := _squadron_slots(sq[1], L)
				for i in list.size():
					var s: Dictionary = list[i]
					var o := unit.duplicate()
					o.merge({pos = _add(_add(group_at, L.group[sq[0]]), s.at), squadron = sq[0], element = s.element, wingman = s.wingman, lead = sq[0] == "lead" and i == 0, attached_to = null}, true)
					out.append(o)
			if g.has("attach"): # the 100th's four-ship flight, trailing the group it joined (two elements: a lead and wingmen, a fourth below)
				for s in _squadron_slots(g.attach.n, L):
					var o := unit.duplicate()
					o.merge({group = g.attach.group, attached_to = g.group, pos = _add(_add(group_at, L.group.attached), s.at), squadron = "attached", element = s.element, wingman = s.wingman, lead = false}, true)
					out.append(o)
	return out

## The totals the force must have (the mission's: VERIFIED).
const TOTALS := {"all": 291, "1st": 149, "3rd": 142}
