extends RefCounted
# The German fighters' radio (the FuG 16): what you hear flying a Bf 109 or an Fw 190. Real voices: a
# night fighter crew's radio traffic recorded in 1944 (the static taken out), cut into its calls. Their
# cover words were the same by day: the ground station calling, "Pauke, Pauke!" as a man goes in to
# attack, "Viktor" for understood, and "Otto, Otto" (by night: the bomber caught in the searchlights; by
# day, now and then, the chatter of the fight). "Pauke" only when a fighter near you really does start his
# attack on the bombers. res://audio/funk/<id>.mp3, from the recording published as
# "Original Luftwaffe Radio Chatter 1944 / Nightfighter" (youtube.com/watch?v=PXwbmkS9kYA), denoised.
const URL := "audio/funk"
const CLIPS := {
	leit = {ids = ["leit_1", "leit_2"], text = "Bodenstelle: \"… Delta …\"", note = "ground control calling"},
	pauke = {ids = ["pauke_1", "pauke_2", "pauke_3", "pauke_4"], text = "\"Pauke, Pauke!\"", note = "going in to attack"},
	viktor = {ids = ["viktor_1", "viktor_2"], text = "\"Viktor, Viktor.\"", note = "understood"},
	vor = {ids = ["vorwaerts"], text = "\"Vorwärts!\"", note = "go in!"},
	otto = {ids = ["otto_1", "otto_2"], text = "\"Otto, Otto!\"", note = "caught in the searchlights"},
	chatter = {ids = ["chatter_1", "chatter_2", "chatter_3", "chatter_4", "chatter_5"], text = "…", note = "the Staffel talking"},
}
const OTTO := {day = 0.25, night = 0.7} # (how often a "Pauke" is followed by "Otto")

static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)

const PAUKE_GAP := 20 # s between two "Pauke"s (a gaggle all going in at once: one call)
const PAUKE_NEAR := 2500 # m: a man close enough to be in your Staffel

var audio
var log_line: Callable
var on := false
var t := 0.0
var q: Array = []
var playing = null
var busy_t := 0.0
var leit_t := 0.0
var pauke_t := -1e9
var vor_said := false
var going := {} # (the fighters gone in: a WeakSet in the browser; here keyed by the fighter, cleared as each comes out of his attack)
var last := {}
var night := false
var warmed := false

## log: the game's log, for what was said and what it means.
func _init(audio_, log_: Callable) -> void:
	audio = audio_
	log_line = log_
	reset()

func reset() -> void:
	q = []
	if playing and playing.get("h"):
		playing.h.stop.call()
	playing = null
	busy_t = 0.0
	leit_t = rand(3, 6)
	pauke_t = -1e9
	vor_said = false
	going = {}
	last = {}

## Each frame. s: {on (flying a German fighter, alive), me (your fighter), fighters, bombers, night}.
func update(dt: float, s: Dictionary) -> void:
	t += dt
	if s.on != on:
		on = s.on
		reset()
		if on and not warmed:
			warmed = true
			for c in CLIPS.values():
				for id in c.ids:
					audio.voice_clip(id, URL)
	if not on or not s.me:
		return
	notice(dt, s)
	busy_t -= dt
	if busy_t > 0:
		return
	playing = null
	q = q.filter(func(x): return t - x.at < 6) # (old news, unsaid)
	var i := -1
	for k in q.size():
		if q[k].at <= t:
			i = k
			break
	if i < 0:
		return
	var x: Dictionary = q[i]
	var c: Dictionary = CLIPS[x.kind]
	# which take: any but the one heard last
	var id: String = c.ids[randi() % c.ids.size()]
	if c.ids.size() > 1 and id == last.get(x.kind):
		id = c.ids[(c.ids.find(id) + 1) % c.ids.size()]
	var buf = audio.voice_clip(id, URL)
	if buf == null:
		return # (still on its way)
	q.remove_at(i)
	var h = audio.voice(id, {url = URL, vol = 0.9}) if buf else null
	if not h:
		return
	last[x.kind] = id
	playing = {h = h}
	busy_t = h.dur + rand(0.4, 1)
	log_line.call("Funk: %s (%s)" % [c.text, c.note])
	# ground control answered, as often as not
	if x.kind == "leit" and randf() < 0.65:
		say("viktor", h.dur + rand(0.6, 1.4))
	# a man going in: as often as not, the searchlights have him (always at night, now and then by day)
	if x.kind == "pauke" and randf() < (OTTO.night if night else OTTO.day):
		say("otto", h.dur + rand(1.5, 4))

func say(kind: String, delay := 0.0) -> void:
	if kind == "pauke": # (the fight before the chatter)
		q = q.filter(func(x): return x.kind != "leit")
	q.append({kind = kind, at = t + delay})
	if q.size() > 3:
		q.pop_front()

func notice(dt: float, s: Dictionary) -> void:
	var me: Vector3 = s.me.pos
	night = not not s.get("night", false)
	# a man of yours going in on the bombers
	if t - pauke_t > PAUKE_GAP:
		for f in s.fighters.axis:
			if f != s.me and f.alive and f.state == "attack" and f.target and not going.has(f) and f.pos.distance_to(me) < PAUKE_NEAR:
				going[f] = true
				pauke_t = t
				say("pauke", rand(0.2, 0.8))
				break
	for f in s.fighters.axis: # (his next attack is news again)
		if f.state != "attack":
			going.erase(f)
	# closing on the bombers the first time: go in
	if not vor_said:
		for b in s.bombers:
			if not b.down and b.group.position.distance_to(me) < 4000:
				vor_said = true
				say("vor", 0.5)
				break
	# the ground station between the fights
	leit_t -= dt
	if leit_t <= 0:
		leit_t = rand(45, 80)
		if t - pauke_t > 15:
			say("leit" if randf() < 0.6 else "chatter")
