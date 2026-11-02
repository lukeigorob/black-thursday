extends RefCounted
# The intercom: the crew talking. Only a few things are said, and only when they're so: the fighters
# from where they really are, called by the man who can see them; the flak starting and stopping; the
# target; Forts burning and going down near us; our own bomber on fire, as the pilot sees it. What the
# game logs reaches here as a line of text; the ones a man would call are given to him and said aloud,
# his own voice every time, through the headset's crackle. One man talks at a time: the rest wait their
# turn, the urgent ones first, and stale ones are dropped. Long gaps between the calls: never a chatter.
const Lines := preload("res://src/lines.gd")
const Archive := preload("res://src/archive.gd")
const History := preload("res://src/history.gd")

# the crew's own recorded voices, off for now (not good enough yet): in their place, the real interphone
# of 1943 (archive.gd) when what it says is happening; the game's log shows the rest as text
const VOICED := false
const ARCHIVE_URL := "audio/archive"

static func rand(a: float, b: float) -> float:
	return a + randf() * (b - a)

const BANDIT_GAP := 30 # s between two calls of where the fighters are
const MANY_GAP := 240 # s before a big fresh wave is called again even straight after another call

# a crewman by his role, as the game logs it ("Left waist's hit!"), and his surname (the last of his name)
func by_title(title: String):
	if not crew:
		return null
	for x in crew.members:
		if x.role.title == title:
			return x
	return null

static func surname(m):
	return History.surname_of(m.name) if m else null

# what the game logs, and what the crew make of it: [pattern, Callable(match, radio) -> the lines to say]
static var HEARD := [
	[RegEx.create_from_string("^Engine (\\d) on fire!$"), func(m, _r): return "engFire" + m.get_string(1)],
	[RegEx.create_from_string("^Engine (\\d) is smoking!$"), func(m, _r): return "engHit" + m.get_string(1)],
	[RegEx.create_from_string("^The (left|right) (?:wing root's badly shot up|wingtip's shot to pieces)!$"), func(m, r): # (once a wing)
		var k: String = "wingHole_" + m.get_string(1)
		if r.called.has(k):
			return null
		r.called[k] = true
		return k],
	[RegEx.create_from_string("^(.+)'s hit!$"), func(m, r): # (a placeholder by his name; a real man by his station, then his name)
		var who = r.by_title(m.get_string(1))
		var n = surname(who)
		if not who:
			return null
		if Lines.LINES.has("hit_%s" % n) and who.placeholder:
			return {key = "hit_%s" % n, note = m.get_string(1)}
		return [{key = "hitRole_" + who.role.id, note = who.name}, {key = "name_" + Lines.name_key(n)}]],
	[RegEx.create_from_string("^(.+) is dead\\.$"), func(m, r): # (the man by his role and name as the game has him: "Tail gunner S/Sgt. John W. Hendry Jr. is dead.")
		var who = null
		if r.crew:
			for x in r.crew.members:
				if m.get_string(0) == "%s %s is dead." % [x.role.title, x.name]:
					who = x
					break
		var n = surname(who)
		if not who:
			return null
		if Lines.LINES.has("dead_%s" % n) and who.placeholder:
			return {key = "dead_%s" % n, note = who.role.title}
		return [{key = "deadRole_" + who.role.id, note = who.name}, {key = "name_" + Lines.name_key(n)}]],
	[RegEx.create_from_string("^(?:Fire in the|The fire's spreading into the) (left|right) wing!$"), func(m, _r): return "wingFire_" + m.get_string(1)],
	[RegEx.create_from_string("^Initial point\\. Bomb run"), func(_m, r): return ["yourShip", {key = "myShip", delay = 0.3}] if r.is_free("pilot") else null], # (no "my ship" without the pilot's "your ship": you're the pilot, or he's gone)
	[RegEx.create_from_string("^Bombs away!$"), func(_m, _r): return "bombsAway"],
	[RegEx.create_from_string("^The Thunderbolts are turning back"), func(_m, _r): return "escortsHome"],
	[RegEx.create_from_string("^Flak! Flak dead ahead!$"), func(_m, _r): return "flakAhead"],
	[RegEx.create_from_string("^Fighters! A fresh wave"), func(_m, r): # (the big wave it warns of: no "so many" on top of it)
		r.many_t = r.t
		return "flakStopping"],
	[RegEx.create_from_string("^Large formation of (?:Fw 190s|fighters) coming in at (\\d+) o'clock (high|level|low)! (\\d+) of them\\.$"), func(m, r): return r.bandits(int(m.get_string(1)), m.get_string(2), int(m.get_string(3)) >= 6)],
	[RegEx.create_from_string("^Fighters, (\\d+) o'clock (high|level|low)!$"), func(m, r): return r.bandits(int(m.get_string(1)), m.get_string(2), false)],
]

var audio
var log_line: Callable
var t := 0.0
var on := false
var queue: Array = []
var later: Array = []
var playing = null
var busy_t := 0.0
var last_said := {}
var last_ver := {}
var called := {}
var down = null # (a set of bombers: Dictionary)
var bandit_t := -1e9
var many_t := -1e9
var seen_bandits := false
var fire_said := false
var fire_clear_t := 0.0
var fort_t := -1e9
var hell_t := -1e9
var arch = null
var arch_q: Array = []
var burn_seen = null
var bursts: Array = []
var warmed := false
var crew = null
var me = null
var bomber = null
var fighters = null # (fighters.gd: where its calls of the fighters came from)
var crews = null # (Dictionary bomber -> crew: the other Forts' pilots, by name)
var on_caption: Callable # (label, text): what's being said now, or (null, null) when it's over

## log: puts a line in the game's log (the plain one, not this).
func _init(audio_, log_: Callable) -> void:
	audio = audio_
	log_line = log_
	reset()
	# every man's clips fetched ahead, in the background once the game's loaded (the gunners' first: the
	# co-pilot's many are mostly names, said less often)
	if VOICED:
		var ids := Lines.all_clips().map(func(c): return c.id)
		ids.sort_custom(func(a, b): return int(a.ends_with(".copilot")) < int(b.ends_with(".copilot")))
		audio.prefetch_voices(ids)

func _caption(label = null, text = null) -> void:
	if on_caption.is_valid():
		on_caption.call(label, text)

func _stop_playing() -> void:
	if playing and playing.get("h"):
		playing.h.stop.call()
	playing = null

## A new life aboard: forget what's been said (the distance, the fighters seen, the Forts lost).
func reset() -> void:
	queue.clear()
	later.clear()
	_stop_playing()
	busy_t = 0.0
	_caption()
	called = {}
	down = null
	bandit_t = -1e9
	many_t = -1e9
	seen_bandits = false
	fire_said = false
	fire_clear_t = 0.0
	fort_t = -1e9
	hell_t = -1e9
	if not arch:
		arch = Archive.ArchivePicker.new()
	arch.reset()
	arch_q = []
	burn_seen = null

## Who's aboard and which of them you are. on: you're in the bomber, alive, to hear it.
func set_state(on_: bool, crew_, me_) -> void:
	if on_ and not warmed: # (all fetched and ready before they're wanted)
		warmed = true
		for a in Archive.ARCHIVE:
			audio.voice_clip(Archive.archive_id(a), ARCHIVE_URL)
	if not on_ and on:
		queue.clear()
		later.clear()
		arch_q.clear()
		_stop_playing()
		busy_t = 0.0
		_caption()
	on = on_
	crew = crew_
	me = me_

## Can this man talk? On the intercom, not hurt or dead, not gone, and not you.
func is_free(id) -> bool:
	if id == me or not crew:
		return false
	for x in crew.members:
		if x.role.id == id:
			return x.state == "ok"
	return false

## A line the game logged: if it's one the crew would call, it's said (and logged as said, with who
## said it), and this returns true; otherwise false, and the game logs it as it was.
func hear(text: String) -> bool:
	if not on:
		return false
	if not VOICED: # (the log shows it as it was)
		archive_hear(text)
		return false
	for h in HEARD:
		var m: RegExMatch = h[0].search(text)
		if not m:
			continue
		var lines = h[1].call(m, self)
		if not lines:
			return false
		if not lines is Array:
			lines = [lines]
		for i in lines.size(): # (the rest of a call only if its start was said)
			var l: Dictionary = {key = lines[i]} if lines[i] is String else lines[i].duplicate()
			l.fallback = text if i == 0 else null
			if not say(l.key, l):
				break
		return true
	return false

## Fighters coming at us from `h` o'clock, `level`, where they are now: just where, never how many ("a whole
## gaggle", "so many of them": cut, they grated). The first of the fight or a big fresh wave (`big`) is
## always called; after that only now and then, never a running commentary.
func bandits(h: int, level: String, big: bool):
	var many := not seen_bandits or (big and t - many_t > MANY_GAP)
	if not many and t - bandit_t < BANDIT_GAP:
		return null # (just said where they are: the log has it)
	seen_bandits = true
	bandit_t = t
	if many:
		many_t = t
	return "bandits%d_%s" % [h, level]

## Have a man say line `key`. by: who (else the first free man of the line's own); delay: s from now;
## fallback: shown if nobody's free to say it.
func say(key: String, o := {}) -> bool:
	var by = o.get("by")
	var delay: float = o.get("delay", 0.0)
	var fallback = o.get("fallback")
	var note = o.get("note")
	if not on or not Lines.LINES.has(key):
		return false
	if delay > 0:
		later.append({key = key, by = by, fallback = fallback, note = note, at = t + delay})
		return true
	var l: Dictionary = Lines.LINES[key]
	if l.has("gap") and t - last_said.get(l.get("group", key), -1e9) < l.gap: # (said just now: not again yet)
		if fallback:
			log_line.call(fallback)
		return false
	var cand: Array = ([by] + l.by) if by else l.by
	var free_: Array = cand.filter(func(s): return l.by.has(s) and is_free(s))
	var spk = (free_[randi() % free_.size()] if l.get("any", false) else free_[0]) if free_.size() else null
	if not spk: # (nobody left to say it: just the news)
		if fallback:
			log_line.call(fallback)
		return false
	# which way he says it: any but the one said last
	var n := Lines.versions(key, spk).size()
	var last = last_ver.get("%s.%s" % [key, spk])
	var i := randi() % n
	if n > 1 and i == last:
		i = (i + 1 + randi() % (n - 1)) % n
	last_ver["%s.%s" % [key, spk]] = i
	var text := Lines.words(key, spk, i)
	log_line.call("%s: %s%s" % [Lines.SPEAKERS[spk].label, text, " (%s)" % note if note else ""])
	last_said[key] = t
	if l.has("group"):
		last_said[l.group] = t
	# (a newer call of where the fighters are replaces the one still waiting)
	if key.begins_with("bandits"):
		queue = queue.filter(func(q): return not q.key.begins_with("bandits"))
	var at = fighters.call_at if key.begins_with("bandits") and fighters and "call_at" in fighters else null # (where they were called from: checked again when it's said)
	var pri: int = l.pri
	queue.append({key = key, i = i, spk = spk, pri = pri, ttl = l.get("ttl", 5 if pri >= 3 else 8 if pri == 2 else 14), born = t, text = text, at = at})
	audio.voice_clip(Lines.clip_id(key, i, Lines.SPEAKERS[spk].voice)) # (fetched now, ready by its turn)
	if queue.size() > 4: # (too much at once: the least of it goes unsaid)
		queue.sort_custom(_by_pri)
		queue.resize(4)
	# an urgent call cuts in over the rest
	if pri >= 3 and playing and playing.pri <= 1:
		_stop_playing()
		busy_t = 0.15
		_caption()
	return true

static func _by_pri(a, b) -> bool:
	return a.pri > b.pri or (a.pri == b.pri and a.born < b.born)

## Each frame. s: {phase, to_go (m, the target from the crosshair), quiet_t (s since the last fighter
## turned for home), bombers, bomber}.
func update(dt: float, s = null) -> void:
	t += dt
	if not VOICED:
		archive_update(dt, s)
		return
	for i in range(later.size() - 1, -1, -1):
		if later[i].at <= t:
			var l: Dictionary = later[i]
			later.remove_at(i)
			say(l.key, l)
	if on and s:
		notice(dt, s)
	# the next man on the intercom
	if playing and t > playing.ends:
		_caption()
	busy_t -= dt
	if busy_t > 0:
		return
	playing = null
	queue = queue.filter(func(q): return t - q.born < q.ttl) # (old news, unsaid)
	if not on or not queue.size():
		return
	queue.sort_custom(_by_pri)
	if not still_there(queue[0], s.bomber if s else null):
		queue.pop_front()
		return
	var q: Dictionary = queue[0]
	var sp: Dictionary = Lines.SPEAKERS[q.spk]
	var id := Lines.clip_id(q.key, q.get("i", 0), sp.voice)
	var buf = audio.voice_clip(id)
	if not q.has("asked"):
		q.asked = t
	if buf == null and t - q.asked < 5:
		return # (still on its way: a moment more)
	queue.pop_front()
	var h = audio.voice(id, {rate = sp.rate, far = sp.get("far", false)}) if buf else null
	if not h:
		return # (not here in time, or failed: left unsaid. Never a synthesised voice: a robot, and not his)
	var dur: float = h.dur
	playing = q.duplicate()
	playing.h = h
	playing.ends = t + dur + 0.4
	busy_t = dur + rand(0.4, 0.8)
	_caption(sp.label, q.text)

## A call of where the fighters are, about to be said after waiting its turn: the clock again from where
## they were called (the formation may have turned since). An hour out, it's said as it is now (if the
## same man would call it); further, or high or low changed, it's old news: dropped.
static var _bandit_key := RegEx.create_from_string("^(banditsMany|bandits)(\\d+)_(\\w+)$")
func still_there(q: Dictionary, bomber_) -> bool:
	if not q.get("at") or not bomber_:
		return true
	var m := _bandit_key.search(q.key)
	if not m:
		return true
	var c = load("res://src/fighters.gd").clock(bomber_, q.at) # (loaded only here: fighters.gd brings half the game with it)
	var off := absi(c.h - int(m.get_string(2))) % 12
	var hours := mini(off, 12 - off)
	if hours == 0 and c.level == m.get_string(3):
		return true
	var key := "%s%d_%s" % [m.get_string(1), c.h, c.level]
	if hours > 1 or c.level != m.get_string(3) or not Lines.LINES.has(key) or not Lines.LINES[key].by.has(q.spk):
		return false
	q.key = key
	q.text = Lines.words(key, q.spk, q.i)
	return true

# ---- the real interphone (archive.gd): the same moments, said by the men of 1943 ----

static var _clock_re := RegEx.create_from_string("(\\d+) o'clock (high|level|low)")
static var _ip_re := RegEx.create_from_string("^Initial point\\. Bomb run")
static var _fighters_re := RegEx.create_from_string("^(Fighters|Large formation)")

## What the game logged that one of the clips fits.
func archive_hear(text: String) -> void:
	if _ip_re.search(text):
		archive("bombRun")
	var m := _clock_re.search(text)
	if m and _fighters_re.search(text):
		archive("bandits", {h = int(m.get_string(1)), level = m.get_string(2)})

## Queue the clip that fits event `on_` (if one does, and it isn't too soon). delay: s from now.
func archive(on_: String, opts := {}, delay := 0.0):
	if not on:
		return null
	arch.t = t
	var a = arch.pick(on_, opts, world())
	if not a:
		return null
	if on_ == "bandits": # (the newer call of where they are)
		arch_q = arch_q.filter(func(q): return q.a.on != "bandits")
	arch_q.append({a = a, at = t + delay, ttl = 5 if on_ == "bandits" or on_ == "engaged" else 10})
	if arch_q.size() > 3:
		arch_q.pop_front()
	return a

## The order to bail out (main.gd): said now, over whatever's being said, and every time it's given.
func archive_bail() -> void:
	if not on:
		return
	arch.said["bail_order"] = -1e9
	var a = null
	for x in Archive.ARCHIVE:
		if x.id == "bail_order":
			a = x
	arch_q = [{a = a, at = t, ttl = 4}]
	_stop_playing()
	busy_t = 0.0

## What the clips' claims are checked against (archive.gd holds): what's round our ship now.
func world() -> Dictionary:
	var live := func() -> Array:
		var out: Array = []
		if not fighters or not bomber:
			return out
		for f in fighters.axis:
			if f.alive and not f.player and f.state != "rtb" and f.pos.distance_to(bomber.group.position) < 2500:
				out.append(f)
		return out
	return {
		any_fighters = func() -> bool: return live.call().size() > 0,
		fighters_at = func(clocks: Array) -> bool:
			for f in live.call():
				var h: int = where(f.pos, bomber).h
				for c in clocks:
					if Archive.near(h, c):
						return true
			return false,
		flak_at = func(clocks: Array) -> bool:
			for b in bursts:
				if t - b.t < 10:
					for c in clocks:
						if Archive.near(b.h, c):
							return true
			return false,
	}

## Where `pos` is from our ship: {h: o'clock, level, dist}.
func where(pos: Vector3, bomber_) -> Dictionary:
	var d: Vector3 = bomber_.group.to_local(pos)
	var up := maxf(150.0, Vector2(d.x, d.z).length() * 0.14)
	return {h = clock_of(d), level = "high" if d.y > up else "low" if d.y < -up else "level", dist = d.length()}

## A fighter down (fighters.gd): one our gunners got, near enough to see.
func downed(f, owner) -> void:
	if not on or not bomber or f.side != "axis" or not owner in ["player", "crew"]:
		return
	if f.pos.distance_to(bomber.group.position) < 1500:
		archive("kill", {}, 0.6)

## Its pilot out (fighters.gd).
func bailed(f) -> void:
	if on and bomber and f.side == "axis" and f.pos.distance_to(bomber.group.position) < 1200:
		archive("bail")

## A flak burst (flak.gd): one close by, and on the side a clip calls.
func burst(at: Vector3) -> void:
	if not on or not bomber:
		return
	var w := where(at, bomber)
	if w.dist < 700: # (what "flak at nine o'clock" is checked against)
		bursts.append({t = t, h = w.h})
		if bursts.size() > 30:
			bursts.pop_front()
	if w.dist > 60 and w.dist < 450:
		archive("flak", w)

func archive_update(dt: float, s) -> void:
	if s:
		bomber = s.bomber
	if on and s:
		archive_notice(dt, s)
	if playing and t > playing.ends:
		_caption()
	busy_t -= dt
	if busy_t > 0:
		return
	playing = null
	arch_q = arch_q.filter(func(q): return t - q.at < q.ttl) # (old news, unsaid)
	var q = null
	if on:
		for x in arch_q:
			if x.at <= t:
				q = x
				break
	if not q:
		return
	if not Archive.holds(q.a, world()): # (no longer so by the time it'd be said: left unsaid)
		arch_q.erase(q)
		return
	var id := Archive.archive_id(q.a)
	var buf = audio.voice_clip(id, ARCHIVE_URL)
	if buf == null:
		return # (still on its way: dropped if it never comes in time)
	arch_q.erase(q)
	var h = audio.voice(id, {url = ARCHIVE_URL}) if buf else null
	if not h:
		return
	playing = {h = h, ends = t + h.dur + 0.3, pri = 0}
	busy_t = h.dur + rand(1.5, 3)
	_caption("Intercom", q.a.text)

## The moments the clips fit, from what's to be seen round our ship.
func archive_notice(_dt: float, s) -> void:
	var me_b = s.bomber
	if down == null:
		down = {}
		for b in s.bombers:
			if b.down:
				down[b] = true
	if burn_seen == null:
		burn_seen = {}
		for b in s.bombers:
			if b.burning:
				burn_seen[b] = true
	for b in s.bombers:
		if b == me_b or b.gone:
			continue
		var near: float = b.group.position.distance_to(me_b.group.position)
		# a Fort near us going down: the men calling for her crew to get out, then the chutes
		if b.down and not down.has(b):
			down[b] = true
			if near < 2000 and archive("fortDown"):
				archive("chutes", {}, rand(5, 8))
		# one starting to burn, on the side a clip calls
		if b.burning and not b.down and not burn_seen.has(b):
			burn_seen[b] = true
			if near < 1100: # (close enough that "that B-17" is plainly her)
				archive("fortHit", where(b.group.position, me_b))
	# a fighter boring in on our own ship
	if fighters:
		for f in fighters.axis:
			if f.state == "attack" and f.target == me_b and f.pos.distance_to(me_b.group.position) < 700:
				archive("engaged", where(f.pos, me_b))
				break

## The things the crew call of their own accord, from what they can see.
func notice(dt: float, s) -> void:
	var once := func(key: String, cond: bool) -> void:
		if cond and not called.has(key):
			called[key] = true
			say(key)
	# the navigator: twenty kilometres to the target
	if s.phase == "outbound" or s.phase == "bombrun":
		once.call("km20", s.to_go < 20000 and s.to_go > 17000)
	# the fighters all gone home
	once.call("lastOfThem", s.phase == "homeward" and s.quiet_t > 4)
	# the Forts near us: several burning at once; one going down (said by the man who can see it)
	var burning := 0
	if down == null: # (a new life: the Forts already gone down aren't news)
		down = {}
		for b in s.bombers:
			if b.down:
				down[b] = true
	for b in s.bombers:
		if b == s.bomber or b.gone:
			continue
		var dist: float = b.group.position.distance_to(s.bomber.group.position)
		if dist < 2500 and (b.burning or b.down):
			burning += 1
		if not b.down or down.has(b):
			continue
		down[b] = true
		if dist > 2000 or t - fort_t < 60:
			continue # (not every one: at most one a minute)
		fort_t = t
		var d: Vector3 = s.bomber.group.to_local(b.group.position)
		var up := maxf(150.0, Vector2(d.x, d.z).length() * 0.14)
		var sees := Lines.clock_callers(clock_of(d), "high" if d.y > up else "low" if d.y < -up else "level")
		var by = null
		for x in sees:
			if is_free(x):
				by = x
				break
		say("fortDown", {by = by})
		if t - hell_t > 180:
			hell_t = t
			say("giveEmHell", {delay = 3.0})
	# a gaggle diving on a Fort close by: "they're going for Miller's ship!" (her pilot), from the side it's on
	if fighters and crews and t - last_said.get("goingFor", -1e9) > 75:
		var f = null
		for x in fighters.axis:
			if x.state == "attack" and x.target and x.target != s.bomber and not x.target.down and not x.player \
					and x.target.group.position.distance_to(s.bomber.group.position) < 700:
				f = x
				break
		var pilot = null
		if f and crews.has(f.target):
			for x in crews[f.target].members:
				if x.role.id == "pilot":
					pilot = x
					break
		var n = surname(pilot) if pilot else null
		var real: bool = n != null and Lines.LINES.has("goingForP_" + Lines.name_key(n)) and not pilot.placeholder
		if real: # (a real pilot's name: recorded by the top turret)
			say("goingForP_" + Lines.name_key(n))
		elif n and Lines.LINES.has("goingFor_%s" % n):
			var d: Vector3 = s.bomber.group.to_local(f.target.group.position)
			say("goingFor_%s" % n, {by = "waistL" if d.x < -60 else "waistR" if d.x > 60 else "engineer"})
	# (once, until the sky's clear of burning Forts for a while and it happens again)
	if burning >= 2 and not fire_said:
		fire_said = true
		say("fortsFire")
	fire_clear_t = 0.0 if burning else fire_clear_t + dt
	if fire_clear_t > 45:
		fire_said = false

static func clock_of(d: Vector3) -> int:
	var h := roundi(atan2(-d.x, -d.z) * -6.0 / PI)
	var r := ((h % 12) + 12) % 12
	return r if r else 12
