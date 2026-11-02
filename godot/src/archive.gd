extends RefCounted
# The interphone as it really sounded: B-17 crews in combat, from The Memphis Belle (1944, the USAAF's
# film of the 91st Bomb Group's Wilhelmshaven raid of 15 May 1943: a US government work, public domain),
# the voices alone (the engines taken out). Each clip is played only when what it says is what's
# happening: a clock call when fighters really are at that o'clock, "bail out" when a Fort near us goes
# down, "I got him" when our gunners get one. res://audio/archive/belle_<id>.mp3; the sources and how
# they were cut: hackathon/archive_audio/SOURCES.md.

## on: the event it fits (bandits: fighters coming at us; engaged: one attacking our ship, close; fortHit: a
## Fort near us starting to burn; fortDown, chutes: one going down, then her crew getting out; kill: our
## gunners got one; bail: its pilot jumped; flak: a burst close by; bombRun: the IP). clock: the o'clock
## it calls (it's only said when that's where it is, give or take an hour); level: high or low, if it says.
## says: everything else the clip claims, all of which must be so round our ship when it's picked and again
## when it's said: fighters: [[o'clocks], ...] (an enemy fighter near us at one of each), or 'any'; flak:
## [o'clocks] (a burst close by there, just now). A clip telling of something that isn't happening is worse
## than silence.
const ARCHIVE := [
	{id = "02_01", on = "bandits", clock = [1], level = "high", says = {fighters = [[1]]}, text = "There's four of them, one o'clock high. They're coming around. Watch."},
	{id = "02_02", on = "bandits", clock = [6], level = "high", says = {fighters = [[6]]}, text = "Two fighters, six o'clock up, coming in, diving at you."},
	{id = "02_05", on = "bandits", clock = [9], says = {fighters = [[9]]}, text = "Three planes, nine o'clock, coming around. Keep your eye on them, boys."},
	{id = "02_06", on = "bandits", clock = [10, 11], says = {fighters = [[10, 11]]}, text = "Coming around to ten. Watch him, Chuck. Keep your eyes open. They're breaking eleven. Breaking eleven. I got him."},
	{id = "02_07", on = "bandits", clock = [8, 10], says = {fighters = [[8, 10]]}, text = "Coming around here at 8 or 10 o'clock. I see him."},
	{id = "02_10", on = "bandits", clock = [10, 11], says = {fighters = [[10, 11]]}, text = "Ten-thirty, upper or lower?"},
	{id = "03_08", on = "bandits", clock = [6, 3], says = {fighters = [[6], [3]]}, text = "Fighters, six o'clock. ME 109 at three o'clock."},
	{id = "04_05", on = "bandits", clock = [10, 12], says = {fighters = [[10], [12]]}, text = "Fighters, ten o'clock. Watch those two at twelve. They're coming in. They're coming in, Scotty."},
	{id = "04_07", on = "bandits", clock = [3], says = {fighters = [[3]]}, text = "Watch that fighter coming in at three o'clock."},
	{id = "02_04", on = "bandits", says = {fighters = "any"}, text = "Two more diving through the 94th."}, # (no clock: any wave)
	{id = "02_08", on = "engaged", says = {fighters = "any"}, text = "Watch him, Scotty. I got my sights on him."},
	{id = "04_01", on = "engaged", says = {fighters = "any"}, text = "Keep after him, Mitchell. I see him. I'm on him."},
	{id = "04_02", on = "engaged", says = {fighters = "any"}, text = "Come on, you son of a bitch."},
	{id = "04_06", on = "engaged", level = "low", says = {fighters = "any"}, text = "Get that ball turret on them."},
	{id = "04_08", on = "engaged", clock = [11, 12, 1], says = {fighters = [[11, 12, 1]]}, text = "He's coming in at a half roll. Pull her up, Chief. Pull her up, hurry."},
	{id = "02_03", on = "fortHit", clock = [2], text = "B-17 in trouble, out at two o'clock, watch it. Got an engine on fire."},
	{id = "02_09", on = "fortHit", clock = [3], says = {fighters = [[10, 11]]}, text = "Check that B-17, Chuck. Three o'clock. Motor's smoking. Fighters, ten-thirty. Coming around."},
	{id = "03_01", on = "fortDown", text = "Come on, you guys. Get out of that plane. Bail out. There's one."},
	{id = "03_06", on = "fortDown", text = "Eight men still in that B-17."},
	{id = "03_02", on = "chutes", text = "He come out of the bomb bay. Yeah, I see him."},
	{id = "03_03", on = "chutes", says = {fighters = "any"}, text = "There's a tail gunner coming out. Watch out for the fighter."},
	{id = "03_04", on = "chutes", text = "Keep your eye on him, Bill. See any parachutes, Quinlan? No parachutes."},
	{id = "03_07", on = "chutes", says = {flak = [11]}, text = "Come on, the rest of you guys. Get out of there. Come on, bail. So far, three more chutes. Flak, eleven o'clock."},
	{id = "04_03", on = "kill", text = "I got him. Let's confirm that fighter. He got him."},
	{id = "04_04", on = "bail", text = "Look, he's bailing out. Damn it, don't yell on that intercom."},
	{id = "03_05", on = "flak", clock = [9], says = {flak = [9]}, text = "Flak at nine o'clock."},
	{id = "05_01", on = "bombRun", text = "Pilot to bombardier. Okay, Vin, you've got it."},
	# (two of the Belle's men put together: her pilot's own "pilot to crew" from his oxygen call, and "bail
	# out!" called at a Fort going down in the same fight)
	{id = "bail_order", on = "bailOrder", text = "Pilot to crew. Bail out!"},
]

static func archive_id(a: Dictionary) -> String:
	return "belle_" + a.id

# s before the same kind of call again (the first of the fight is never held back), and before any clip
# is said a second time
const GAP := {bandits = 25, engaged = 35, fortHit = 50, fortDown = 60, chutes = 0, kill = 20, bail = 30, flak = 45, bombRun = 0, bailOrder = 0}
const REPEAT := 240 # (the bail-out order excepted: archive_bail)

static func near(h: int, c: int) -> bool:
	var d := absi(h - c) % 12
	return mini(d, 12 - d) <= 1

## Is all that clip a says so round our ship now? world: {fighters_at: Callable(clocks) (an enemy fighter
## near us at one of them, give or take an hour), any_fighters: Callable(), flak_at: Callable(clocks) (a burst
## close by there, just now)}.
static func holds(a: Dictionary, world: Dictionary) -> bool:
	var s = a.get("says")
	if not s:
		return true
	var f = s.get("fighters")
	if f is String and f == "any" and not world.any_fighters.call():
		return false
	if f is Array:
		for clocks in f:
			if not world.fighters_at.call(clocks):
				return false
	if s.has("flak") and not world.flak_at.call(s.flak):
		return false
	return true

## Picks the clip for an event, or null: none fits, or it's too soon.
class ArchivePicker:
	var last := {}
	var said := {}
	var t := 0.0

	func _init() -> void:
		reset()

	func reset() -> void:
		last = {}
		said = {}
		t = 0.0

	func pick(on: String, opts := {}, world = null):
		var Archive = load("res://src/archive.gd")
		var h = opts.get("h")
		var level = opts.get("level")
		if t - last.get(on, -1e9) < GAP[on]:
			return null
		var fits: Array = []
		for a in ARCHIVE:
			if a.on != on or t - said.get(a.id, -1e9) <= REPEAT:
				continue
			if a.has("clock"):
				if h == null:
					continue
				var any := false
				for c in a.clock:
					any = any or Archive.near(h, c)
				if not any:
					continue
			if a.has("level") and a.level != level:
				continue
			if world and not Archive.holds(a, world):
				continue
			fits.append(a)
		# (one that names where they are, over one that doesn't)
		var named := fits.filter(func(a): return a.has("clock"))
		var from: Array = named if named.size() else fits
		if not from.size():
			return null
		var a: Dictionary = from[randi() % from.size()]
		last[on] = t
		said[a.id] = t
		return a
