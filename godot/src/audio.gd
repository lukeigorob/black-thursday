extends Node
# All sound is made in code (no files, but for the recorded voices). Starts only after the player clicks Start.
# The port of audio.js (GameAudio). Web Audio built each sound as a graph of oscillators, noise and filters at
# the moment it was wanted; GDScript is too slow to run such graphs sample by sample, so here the same graphs
# are rendered once at start-up (on worker threads, a second or two) into AudioStreamWAVs: a few takes of each
# one-shot (the random parts of each sound, a different take each time), loops for the steady ones. A one-shot
# is played through one AudioStreamPolyphonic (each sound its own volume, on its channel's bus); a steady sound
# (the engines, the wind, a fighter's snarl, the turret's motors) is a looping player whose volume and pitch
# glide as the Web Audio params did. Where a sound depended on a distance (flak, explosions, thunder: duller and
# longer far off), it's rendered at several distances and the two nearest are mixed.
# The node must be in the tree (main adds it) before ensure()/start().

const MIX := {guns = 1.0, engines = 1.0, battle = 1.0, crew = 1.0, ui = 0.8} # the channels of the mix, at full

var volume := 1.0
var muted := false
var mix := MIX.duplicate()
var engines_on := false
var own_kind = null # (JS ownKind: undefined until the first call, then a kind or null)
var _own_kind_set := false
var bell_on = null
var _t := 0.0 # the sound system's own clock (ctx.currentTime): stands still while suspended
var _suspended := false
var _poly: AudioStreamPlayer
var _pb: AudioStreamPlaybackPolyphonic
var _bank := {} # name -> Array of Snd (the takes)
var _bank_ready := false
var _bank_mutex := Mutex.new()
var _task := -1
var _due: Array = [] # [time, Callable]: sounds that start later (far off: the sound takes its time)
var _auto: Array = [] # volume automations of playing one-shots
var _loops := {} # name -> {player, gain: Glide, pitch: Glide}
var beat_t := 0.0
var brass_t := 0.0
var _clips := {}

## A rendered sound: the stream (normalised to its peak) and the level it was made at.
class Snd:
	var stream: AudioStreamWAV
	var peak := 1.0
	var length := 0.0

## A param eased toward a value, as setTargetAtTime: but not again if it's already heading there.
class Glide:
	var v := 0.0
	var to := 0.0
	var tau := 0.1
	func _init(v0 := 0.0) -> void:
		v = v0
		to = v0
	func go(x: float, tau_: float) -> void:
		if absf(x - to) <= absf(to) * 0.005 + 1e-5:
			return
		to = x
		tau = tau_
	func step(dt: float) -> void:
		v = to + (v - to) * exp(-dt / maxf(tau, 1e-4))

# ---------------------------------------------------------------------------------------------------------
# The volume and the mix

## The volume (0..1, 1 = as loud as it was made) and mute, and the mix: each channel's own level
## (guns, engines, battle: flak, hits and explosions, crew: voices, heartbeat, the turret's motor).
## Applied at once if sound is running.
func set_volume(volume_: float, muted_: bool, mix_ = null) -> void:
	volume = clampf(volume_, 0, 1)
	muted = muted_
	var m := MIX.duplicate()
	var given: Dictionary = mix_ if mix_ != null else mix
	for k in given:
		m[k] = given[k]
	mix = m
	if _poly:
		_apply_levels()

var level: float:
	get:
		return 0.0 if muted else 0.5 * volume

func _apply_levels() -> void:
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(level, 1e-6)))
	AudioServer.set_bus_mute(0, level <= 0)
	for k in MIX:
		var i := AudioServer.get_bus_index(k)
		var g := clampf(mix[k], 0, 1)
		AudioServer.set_bus_volume_db(i, linear_to_db(maxf(g, 1e-6)))
		AudioServer.set_bus_mute(i, g <= 0)

func start() -> void:
	if engines_on:
		resume()
		return
	ensure()
	engines_on = true
	engines()
	resume()

## The sound system itself, without the engines yet (the menus' clicks, from the first click on).
func ensure() -> void:
	if _poly:
		return
	_make_buses()
	_poly = AudioStreamPlayer.new()
	var s := AudioStreamPolyphonic.new()
	s.polyphony = 128
	_poly.stream = s
	add_child(_poly)
	_poly.play()
	_pb = _poly.get_stream_playback()
	_apply_levels()
	# every sound rendered in the background, the engines' first
	var jobs := _jobs()
	_task = WorkerThreadPool.add_group_task(func(i: int) -> void: _run_job(jobs[i]), jobs.size(), -1, true, "sound bank")

## The mix's channels as buses, under Master; the intercom's two radio chains (a headset's amplifier: 300 Hz
## to 3 kHz, a presence peak, driven a little) feeding the crew channel.
func _make_buses() -> void:
	for k in MIX:
		_bus(k, "Master")
	for far in [false, true]:
		var i := _bus("radio_far" if far else "radio", "crew")
		if AudioServer.get_bus_effect_count(i) > 0:
			continue
		var hp := AudioEffectHighPassFilter.new()
		hp.cutoff_hz = 450.0 if far else 300.0
		hp.resonance = pow(10.0, 0.7 / 20.0) # (Web Audio's highpass Q is in dB)
		AudioServer.add_bus_effect(i, hp)
		var eq := AudioEffectEQ10.new() # the presence peak: +3 dB about 1800 Hz, broad (Q 0.7)
		eq.set_band_gain_db(5, 1.2)
		eq.set_band_gain_db(6, 3.0)
		eq.set_band_gain_db(7, 0.8)
		AudioServer.add_bus_effect(i, eq)
		var lp := AudioEffectLowPassFilter.new()
		lp.cutoff_hz = 2600.0 if far else 3400.0
		lp.resonance = pow(10.0, 0.8 / 20.0)
		AudioServer.add_bus_effect(i, lp)
		var sh := AudioEffectDistortion.new() # tanh(k x) / tanh(k), k 1.4 (2.6 far): atan of the same slope
		sh.mode = AudioEffectDistortion.MODE_ATAN
		sh.drive = 0.463 if far else 0.372
		sh.keep_hf_hz = 16000.0
		AudioServer.add_bus_effect(i, sh)
		AudioServer.set_bus_volume_db(i, linear_to_db(0.6 if far else 0.8))

func _bus(name: String, send: String) -> int:
	var i := AudioServer.get_bus_index(name)
	if i < 0:
		AudioServer.add_bus()
		i = AudioServer.bus_count - 1
		AudioServer.set_bus_name(i, name)
	AudioServer.set_bus_send(i, send)
	return i

## True once every sound has been made (a second or two after ensure()).
func bank_ready() -> bool:
	return _bank_ready

func _process(delta: float) -> void:
	if _task >= 0 and not _bank_ready and WorkerThreadPool.is_group_task_completed(_task):
		WorkerThreadPool.wait_for_group_task_completion(_task)
		_task = -1
		_bank_ready = true
		if engines_on:
			engines()
	if _suspended or not _pb:
		return
	_t += delta
	# the sounds whose time has come
	if _due.size():
		var i := 0
		while i < _due.size():
			if _due[i][0] <= _t:
				var c: Callable = _due[i][1]
				_due.remove_at(i)
				c.call()
			else:
				i += 1
	# one-shots' volumes moving (a bell let go, a voice cut off, the hiss under a voice)
	var k := 0
	while k < _auto.size():
		var a: Dictionary = _auto[k]
		var v := _auto_value(a)
		if not _pb.is_stream_playing(a.id) or (a.has("stop") and _t >= a.stop):
			if _pb.is_stream_playing(a.id) and a.has("stop"):
				_pb.stop_stream(a.id)
			_auto.remove_at(k)
			continue
		_pb.set_stream_volume(a.id, linear_to_db(maxf(v * a.mul, 1e-6)))
		k += 1
	# the steady sounds' glides
	for n in _loops:
		var l: Dictionary = _loops[n]
		l.gain.step(delta)
		l.pitch.step(delta)
		var p: AudioStreamPlayer = l.player
		p.volume_db = linear_to_db(maxf(l.gain.v * l.mul, 1e-6))
		p.pitch_scale = clampf(l.pitch.v, 0.05, 16.0)

func _auto_value(a: Dictionary) -> float:
	var pts: Array = a.get("pts", [])
	if a.has("tau"): # setTargetAtTime: from where it was, towards the target
		return a.to + (a.from - a.to) * exp(-maxf(0.0, _t - a.t0) / a.tau)
	if _t <= pts[0][0]:
		return pts[0][1]
	for i in range(1, pts.size()):
		if _t <= pts[i][0]:
			var p0: Array = pts[i - 1]
			var p1: Array = pts[i]
			return lerpf(p0[1], p1[1], (_t - p0[0]) / maxf(p1[0] - p0[0], 1e-6))
	return pts[pts.size() - 1][1]

## Play take `snd` on `bus` at `gain` (linear) after `delay` s; returns its id (or -1 if later or not made yet).
func _play(snd: Snd, bus: StringName, gain: float, delay := 0.0, pitch := 1.0) -> int:
	if not snd or not _pb:
		return -1
	if delay > 0.0:
		_due.append([_t + delay, func() -> void: _play(snd, bus, gain, 0.0, pitch)])
		return -1
	return _pb.play_stream(snd.stream, 0.0, linear_to_db(maxf(gain * snd.peak, 1e-6)), pitch, AudioServer.PLAYBACK_TYPE_DEFAULT, bus)

func _take(name: String) -> Snd:
	var a: Array = _bank.get(name, [])
	return a[randi() % a.size()] if a.size() else null

# ---------------------------------------------------------------------------------------------------------
# The sounds

## The bail-out bell, on (true) or off: the B-17's alarm bell was an electric one, a hammer on a steel gong
## buzzing at it twenty times a second, a fire or school bell's continuous clanging ring. Rung while it's
## on; let go, it rings on a moment and dies away.
func bell_ring(on: bool) -> void:
	if not _pb or on == (bell_on != null):
		return
	if on:
		var snd := _take("bell")
		if not snd:
			return
		var id := _pb.play_stream(snd.stream, 0.0, -120.0, 1.0, AudioServer.PLAYBACK_TYPE_DEFAULT, &"crew")
		var a := {id = id, mul = snd.peak, pts = [[_t, 0.0], [_t + 0.02, 0.32]]}
		_auto.append(a)
		bell_on = a
	else:
		var a: Dictionary = bell_on
		_auto.erase(a)
		_auto.append({id = a.id, mul = a.mul, from = _auto_value(a), to = 0.0, t0 = _t, tau = 0.12, stop = _t + 0.8}) # (the gong rings out)
		bell_on = null

## Four Wright Cyclones heard through the fuselage: detuned low saws, beating slowly, plus wind.
func engines() -> void:
	if not _bank_ready:
		return # (made in a moment: started then, _process)
	_loop("bomber", "engines", 0.22)
	# wind / slipstream rumble
	_loop("wind", "engines", 0.35)

## A steady sound: its loop playing at `gain`, gliding from then on.
func _loop(name: String, bus: StringName, gain: float, pitch := 1.0) -> Dictionary:
	if _loops.has(name):
		return _loops[name]
	var snd := _take(name)
	if not snd:
		return {}
	var p := AudioStreamPlayer.new()
	p.stream = snd.stream
	p.bus = bus
	p.volume_db = linear_to_db(maxf(gain * snd.peak, 1e-6))
	p.pitch_scale = pitch
	add_child(p)
	p.play(randf() * snd.length * 0.9)
	var l := {player = p, gain = Glide.new(gain), pitch = Glide.new(pitch), mul = snd.peak}
	_loops[name] = l
	return l

## Your own fighter's engine, or null back in the B-17. A V12 heard from the cockpit: the firing note
## (rises with throttle) over an exhaust crackle an octave down. The 109's DB 601 runs lower and rougher
## than the P-47's R-2800. The slipstream gets louder with speed.
func own_engine(kind, throttle := 0.0, speed := 0.0) -> void:
	if not _pb or not _bank_ready:
		return
	if not kind:
		if _own_kind_set and own_kind == null:
			return # already back in the B-17
		for k in ["bf109", "fw190", "p47"]: # (kept, silent, for the next sortie)
			if _loops.has("fighter_" + k):
				_loops["fighter_" + k].gain.go(0.0, 0.3)
		if _loops.has("bomber"):
			_loops.bomber.gain.go(0.22, 0.5)
		if _loops.has("wind"):
			_loops.wind.gain.go(0.35, 0.5)
		own_kind = null
		_own_kind_set = true
		return
	# the three engines' characters (the levels of each voice, the low-pass) are each their own loop, made
	# at a 100 Hz base and pitched to the engine's note: the one flown heard, the others silent
	var base := (82.0 if kind == "bf109" else 68.0 if kind == "fw190" else 96.0) * (0.7 + 0.55 * throttle) # Hz (the BMW radial deeper still)
	for k in ["bf109", "fw190", "p47"]:
		var l := _loop("fighter_" + k, "engines", 0.0, base / 100.0)
		if l.is_empty():
			continue
		l.pitch.go(base / 100.0, 0.15)
		l.gain.go(0.16 + throttle * 0.08 if k == kind else 0.0, 0.2 if k == kind and own_kind == kind else 0.1)
	own_kind = kind
	_own_kind_set = true
	if _loops.has("bomber"):
		_loops.bomber.gain.go(0.0, 0.4) # the bombers' drone is outside now
	if _loops.has("wind"):
		_loops.wind.gain.go(clampf(speed / 260.0, 0.15, 1) * 0.45, 0.3)

## A short cue for your score: a kill (two rising notes), an assist (one soft note), a crit (a low ping).
func chime(kind: String) -> void:
	_play(_take("chime_" + kind), &"crew", 1.0)

## A powered turret's motors: a soft electric hum under everything, rising with how fast it's turning (0 = still).
func turret_whine(speed: float) -> void:
	if not _pb or not _bank_ready:
		return
	var k := minf(1.0, speed / 1.05)
	var f := 120.0 + 220.0 * k
	# (made at rest and at full speed: the two mixed, each pitched to the motor's note)
	var w0 := _loop("whine0", "crew", 0.0, 1.0)
	var w1 := _loop("whine1", "crew", 0.0, 340.0 / 120.0)
	if w0.is_empty() or w1.is_empty():
		return
	var g := 0.006 + 0.014 * k if k > 0.02 else 0.0 # (about a quarter of what it was)
	w0.pitch.go(f / 120.0, 0.1)
	w1.pitch.go(f / 340.0, 0.1)
	w0.gain.go(g * sqrt(1.0 - k), 0.08)
	w1.gain.go(g * sqrt(k), 0.08)

## One .50 cal round: a sharp crack plus a low thump through the airframe. vol: 1 = your own gun.
func gunshot(vol := 1.0) -> void:
	_play(_take("gunshot"), &"guns", vol)

## Metallic clanks: the old ammo can coming off (start) or the new belt locking in (end).
func reload(start: bool, vol := 1.0) -> void:
	_play(_take("reload_start" if start else "reload_end"), &"guns", vol)

## Heartbeat while you're wounded: faster as time runs out (call each frame with 0..1).
func heartbeat(urgency: float, dt: float) -> void:
	if not _pb:
		return
	beat_t -= dt
	if urgency <= 0 or beat_t > 0:
		return
	beat_t = 1.1 - urgency * 0.6
	_play(_take("heartbeat"), &"crew", 1.0)

## Hiss of an overheated barrel.
func overheat() -> void:
	_play(_take("overheat"), &"guns", 1.0)

## Snarl of the nearest Bf 109: louder as it closes, pitch shifted by closing speed (Doppler).
func fighter_drone(dist: float, closing: float) -> void:
	if not _pb or not _bank_ready:
		return
	var l := _loop("drone", "engines", 0.0, 0.95)
	if l.is_empty():
		return
	var near := dist if is_finite(dist) else 1e9
	var vol := pow(minf(0.5, 120.0 / maxf(near, 60)), 1.3)
	var doppler := 343.0 / maxf(120.0, 343.0 - clampf(closing if is_finite(closing) else 0.0, -250, 250))
	l.gain.go(vol * 0.6, 0.1)
	l.pitch.go(0.95 * doppler, 0.1) # (made at 100 Hz: 95 Hz times the Doppler)

## German guns heard from a distance.
func distant_gun(dist: float) -> void:
	if not _pb or dist > 900:
		return
	var v := minf(0.4, 60.0 / dist)
	var name := "distant_gun_near" if v > 0.2 else "distant_gun_far" # (the decay to silence is as fast either way)
	var made := 0.4 if v > 0.2 else 0.1
	_play(_take(name), &"guns", v / made)

## A round striking our own airframe, clear over everything else: the sharp crack of it punching
## through the aluminium, a metallic ring, and for a 20 mm shell the bang of it going off.
func impact(cannon: bool, vol := 1.0) -> void:
	_play(_take("impact_cannon" if cannon else "impact"), &"battle", vol)

## A man hurt (severe: going down). A voiced grunt: a buzzy tone pushed through two vowel formants, its
## pitch falling, with breath noise. vol 0..1 (far down the fuselage, quieter); deep varies the voice.
func pain(vol := 1.0, severe := false, deep := 0.0) -> void:
	if not _pb or vol < 0.03:
		return
	var d := clampi(roundi(deep * 5.0), 0, 5) # (made for each man's voice: deep 0, 0.2 .. 1)
	_play(_take("pain_%s_%d" % ["severe" if severe else "hurt", d]), &"crew", vol)

## A flak burst at `dist` m: the deep crump of it (later and duller far off), a sharp crack on top when near.
func flak(dist: float, muffle := 0.0) -> void:
	if not _pb:
		return
	var delay := minf(dist / 343.0, 3)
	# (louder close by; far off it dies away fast, the air soaking it up: a barrage 3 km off is a distant rumble)
	var v := minf(1.6, 180.0 / maxf(dist, 30)) * exp(-dist / 1800.0)
	# in cloud the crump's duller: heard as from further off (the filter's what changes most with distance)
	var lp := maxf(140.0, (1600.0 - dist * 1.2) * (1.0 - 0.4 * muffle))
	var dd := dist if muffle <= 0 else maxf(dist, (1600.0 - lp) / 1.2)
	_blend("flak", FLAK_AT, dd, v, delay, &"battle")
	if dist < 400: # close: the crack of the shell itself
		_play(_take("flak_crack"), &"battle", minf(1.2, 90.0 / maxf(dist, 20)), delay)

## A burst close to your bomber (k 0..1, nearer = 1): the thump through the airframe, and the fragments
## rattling on the skin like thrown gravel, a scatter of small hard ticks.
func flak_close(k: float) -> void:
	if not _pb or k <= 0:
		return
	var b := clampi(roundi(k * 4.0), 1, 4) # (made at k 0.25, 0.5, 0.75 and 1: as many ticks)
	_play(_take("flak_close_%d" % b), &"battle", k / (b / 4.0))

## A plane blowing up: a deep boom, quieter and duller with distance.
func explosion(dist: float) -> void:
	if not _pb:
		return
	_blend("explosion", EXPLOSION_AT, dist, minf(1.2, 400.0 / maxf(dist, 50)), minf(dist / 343.0, 4), &"battle") # sound arrives late

## Thunder: a crack if it's close, then a long low rumble, arriving late from `dist` m away.
func thunder(dist: float) -> void:
	if not _pb:
		return
	var at: Array = THUNDER_AT if dist < 3000 else THUNDER_FAR_AT # (the crack only close)
	_blend("thunder_near" if dist < 3000 else "thunder_far", at, dist, minf(1.1, 2600.0 / dist), minf(dist / 343.0, 12), &"battle")

## The two takes made at the distances either side of `dist`, mixed (equal power) at level v.
func _blend(name: String, at: Array, dist: float, v: float, delay: float, bus: StringName) -> void:
	var i := 0
	while i < at.size() - 1 and at[i + 1] < dist:
		i += 1
	if dist <= at[0] or i >= at.size() - 1:
		var j := 0 if dist <= at[0] else at.size() - 1
		_play(_take("%s_%d" % [name, j]), bus, v / _made_level(name, at[j]), delay)
		return
	var w := clampf(log(dist / at[i]) / log(at[i + 1] / at[i]), 0, 1)
	_play(_take("%s_%d" % [name, i]), bus, v / _made_level(name, at[i]) * sqrt(1.0 - w), delay)
	_play(_take("%s_%d" % [name, i + 1]), bus, v / _made_level(name, at[i + 1]) * sqrt(w), delay)

func _made_level(name: String, d: float) -> float:
	if name == "flak":
		return minf(1.6, 180.0 / maxf(d, 30)) * exp(-d / 1800.0)
	if name == "explosion":
		return minf(1.2, 400.0 / maxf(d, 50))
	return minf(1.1, 2600.0 / d)

## A recorded line (scripts/voices: one small MP3 a clip): loaded the first time it's wanted (in the
## background), and the last few hundred kept. Returns the AudioStream, null while it's still on its way, or
## false if there's no such recording.
func voice_clip(id: String, url := "audio/voice"):
	var c = _clips.get(id)
	if c:
		_clips.erase(id) # (to the back: the most recently wanted)
		_clips[id] = c
		_poll_clip(c)
		return false if c.failed else c.buf
	c = {buf = null, failed = false, path = "res://%s/%s.mp3" % [url, id]}
	_clips[id] = c
	if not ResourceLoader.exists(c.path):
		c.failed = true
		push_warning("crew voice %s not loaded: no such file" % id)
	elif ResourceLoader.load_threaded_request(c.path) != OK:
		c.failed = true
	if _clips.size() > 400: # (the oldest go: never one still on its way)
		for k in _clips.keys():
			if _clips.size() <= 400:
				break
			var o: Dictionary = _clips[k]
			if o.buf or o.failed:
				_clips.erase(k)
	return null

func _poll_clip(c: Dictionary) -> void:
	if c.buf or c.failed:
		return
	match ResourceLoader.load_threaded_get_status(c.path):
		ResourceLoader.THREAD_LOAD_LOADED:
			c.buf = ResourceLoader.load_threaded_get(c.path)
			c.failed = c.buf == null
		ResourceLoader.THREAD_LOAD_FAILED, ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			c.failed = true
			push_warning("crew voice %s not loaded" % c.path)

## Fetch every crew clip once, quietly, so no line waits in the middle of a fight. In the browser this
## filled the disk cache over the network; here the clips are on disk already, and each is loaded (in the
## background) when first asked for (voice_clip): nothing to do.
func prefetch_voices(_ids: Array, _url := "audio/voice") -> void:
	pass

## One line on the intercom: the clip `id` through a headset and an amplifier (300 Hz to 3 kHz, a little
## overdriven: the radio buses), a hiss of static under it, a click as the mike is keyed and a burst of
## squelch after. rate: played a touch faster or slower (makes the man); far: the command radio, thinner and
## noisier. Returns {dur, stop} or null (not loaded yet, or no such clip: see voice_clip).
func voice(id: String, opts := {}):
	var rate: float = opts.get("rate", 1.0)
	var far: bool = opts.get("far", false)
	var vol: float = opts.get("vol", 1.0)
	var buf = voice_clip(id, opts.get("url", "audio/voice")) if opts.get("url") else voice_clip(id)
	if not _pb or not buf:
		return null
	var dur: float = buf.get_length() / rate
	var t := _t + 0.06
	var h := {dead = false, ids = []}
	var later := func(at: float, f: Callable) -> void:
		_due.append([at, func() -> void:
			if not h.dead:
				f.call()])
	# the voice: band-limited, a presence peak, driven into the amplifier a little (the radio bus)
	later.call(t, func() -> void: h.ids.append(_pb.play_stream(buf, 0.0, linear_to_db(vol), rate, AudioServer.PLAYBACK_TYPE_DEFAULT, &"radio_far" if far else &"radio")))
	# the static under it, from the key going down to the squelch
	var hl := 0.07 if far else 0.022
	later.call(t - 0.05, func() -> void:
		var snd := _take("hiss")
		if not snd:
			return
		var id2 := _pb.play_stream(snd.stream, randf() * 0.5, -120.0, 1.0, AudioServer.PLAYBACK_TYPE_DEFAULT, &"crew")
		h.ids.append(id2)
		_auto.append({id = id2, mul = snd.peak * vol, pts = [[t - 0.05, 0.0], [t - 0.03, hl], [t + dur + 0.03, hl], [t + dur + 0.06, 0.0]], stop = t + dur + 0.25}))
	# the click of the mike keyed, and the squelch tail as it's let go
	later.call(t - 0.05, func() -> void: h.ids.append(_play(_take("click"), &"crew", vol)))
	later.call(t + dur + 0.04, func() -> void: h.ids.append(_play(_take("squelch_far" if far else "squelch"), &"crew", vol)))
	h.dur = dur + 0.15
	h.stop = func() -> void:
		h.dead = true
		for i in h.ids:
			if i >= 0 and _pb.is_stream_playing(i):
				_auto.append({id = i, mul = 1.0, from = 1.0, to = 0.0, t0 = _t, tau = 0.01, stop = _t + 0.05})
	return h

## A spent .50 cal case hitting the floor (link: a belt link, duller steel): the bright ping of thin brass,
## two or three high partials that die away almost at once, and the tick of it landing. vol 0..1.
func case_tink(vol: float, link := false) -> void:
	if not _pb or vol < 0.01:
		return
	_play(_take("link" if link else "case"), &"guns", vol * (0.5 if link else 0.7) * 0.4, randf() * 0.02) # (well under the guns: a tinkle at your feet, not a bell)

## The brass lying on the floor, rolling and chinking against itself: a scatter of small quiet tinks, more
## of them the more brass there is (lying 0..1) and the more she moves (motion 0..1: banking, bumps, flak).
func brass(dt: float, lying: float, motion: float) -> void:
	if not _pb or lying <= 0:
		return
	brass_t -= dt
	var rate := lying * (0.3 + 10.0 * motion) # tinks a second (a quiet background chink, now and then)
	while brass_t <= 0:
		brass_t += -log(1.0 - randf()) / maxf(rate, 0.01)
		case_tink((0.05 + 0.12 * randf()) * minf(1, 0.4 + motion), randf() < 0.3)

func suspend() -> void:
	_suspended = true
	if _poly:
		_poly.stream_paused = true
	for n in _loops:
		_loops[n].player.stream_paused = true

func resume() -> void:
	_suspended = false
	if _poly:
		_poly.stream_paused = false
	for n in _loops:
		_loops[n].player.stream_paused = false

# ---------------------------------------------------------------------------------------------------------
# Making the sounds: each as its Web Audio graph was, rendered offline (Dsp below).

const FLAK_AT := [30.0, 150.0, 400.0, 800.0, 1300.0, 2200.0, 3500.0] # m: the distances its takes are made at
const EXPLOSION_AT := [50.0, 400.0, 900.0, 1500.0, 2200.0, 4000.0]
const THUNDER_AT := [800.0, 1500.0, 2900.0]
const THUNDER_FAR_AT := [3000.0, 5000.0, 8000.0, 14000.0]
const SR := 48000.0

## [name, takes, Callable(rng) -> [samples, rate, loop]]
func _jobs() -> Array:
	var j: Array = []
	var add := func(name: String, takes: int, f: Callable) -> void:
		for i in takes:
			j.append([name, f])
	add.call("bomber", 1, _r_bomber)
	add.call("wind", 1, _r_wind)
	add.call("gunshot", 10, _r_gunshot)
	add.call("reload_start", 3, func(r): return _r_reload(r, true))
	add.call("reload_end", 3, func(r): return _r_reload(r, false))
	add.call("overheat", 2, _r_overheat)
	add.call("distant_gun_near", 3, func(r): return _r_distant_gun(r, 0.4))
	add.call("distant_gun_far", 3, func(r): return _r_distant_gun(r, 0.1))
	add.call("impact", 8, func(r): return _r_impact(r, false))
	add.call("impact_cannon", 5, func(r): return _r_impact(r, true))
	for d in 6:
		add.call("pain_hurt_%d" % d, 3, func(r): return _r_pain(r, false, d / 5.0))
		add.call("pain_severe_%d" % d, 2, func(r): return _r_pain(r, true, d / 5.0))
	for i in FLAK_AT.size():
		add.call("flak_%d" % i, 2, func(r): return _r_flak(r, FLAK_AT[i]))
	add.call("flak_crack", 4, _r_flak_crack)
	for b in range(1, 5):
		add.call("flak_close_%d" % b, 2, func(r): return _r_flak_close(r, b / 4.0))
	for i in EXPLOSION_AT.size():
		add.call("explosion_%d" % i, 2, func(r): return _r_explosion(r, EXPLOSION_AT[i]))
	for i in THUNDER_AT.size():
		add.call("thunder_near_%d" % i, 2, func(r): return _r_thunder(r, THUNDER_AT[i]))
	for i in THUNDER_FAR_AT.size():
		add.call("thunder_far_%d" % i, 2, func(r): return _r_thunder(r, THUNDER_FAR_AT[i]))
	for k in ["kill", "assist", "crit"]:
		add.call("chime_" + k, 1, func(_r): return _r_chime(k))
	add.call("heartbeat", 1, _r_heartbeat)
	add.call("case", 10, func(r): return _r_tink(r, false))
	add.call("link", 8, func(r): return _r_tink(r, true))
	add.call("click", 3, func(r): return _r_burst(r, 0.02, 2500, 0.25))
	add.call("squelch", 3, func(r): return _r_burst(r, 0.11, 2200, 0.15))
	add.call("squelch_far", 3, func(r): return _r_burst(r, 0.18, 2200, 0.22))
	add.call("hiss", 1, _r_hiss)
	add.call("bell", 1, func(_r): return [bell_buffer(SR), SR, true])
	for k in ["bf109", "fw190", "p47"]:
		add.call("fighter_" + k, 1, func(_r): return _r_fighter(k))
	add.call("drone", 1, _r_drone)
	add.call("whine0", 1, func(_r): return _r_whine(0.0))
	add.call("whine1", 1, func(_r): return _r_whine(1.0))
	return j

func _run_job(job: Array) -> void:
	var r := RandomNumberGenerator.new()
	r.randomize()
	var out: Array = job[1].call(r)
	var snd := Dsp.wav(out[0], out[1], out[2])
	_bank_mutex.lock()
	if not _bank.has(job[0]):
		_bank[job[0]] = []
	_bank[job[0]].append(snd)
	_bank_mutex.unlock()

## Two seconds of an electric alarm bell, made once, to loop: a steel gong's ringing tones (a struck bell's
## partials aren't harmonics of each other: that's its clang), each struck again 18 times a second by the
## hammer before it's died away, so it rings on continuously; the hammer's tick on each stroke, a little
## uneven, the same every two seconds so the loop doesn't show.
static func bell_buffer(sr: float) -> PackedFloat32Array:
	var n := roundi(sr * 2)
	const RATE := 18
	const F0 := 820.0
	const MODES := [[1.0, 1.0, 3.2], [1.51, 0.55, 4.0], [2.02, 0.4, 5.0], [2.76, 0.5, 6.0], [3.79, 0.28, 8.0], [5.4, 0.18, 11.0], [7.1, 0.1, 14.0]] # [freq x F0, level, decay /s]
	var strikes := RATE * 2
	var hit := PackedFloat32Array() # (each stroke a little harder or softer)
	for k in strikes:
		hit.append(0.82 + 0.18 * absf(fmod(sin(k * 12.9898) * 43758.5453, 1.0)))
	var out := PackedFloat32Array()
	out.resize(n)
	# each ringing tone a resonator the hammer's strokes keep going (it never dies between them); run four
	# seconds and keep the last two, by when it's ringing steadily, so the loop's ends meet
	var kick := PackedFloat32Array() # (a stroke: one sample's kick)
	kick.resize(n)
	for i in n:
		var p := float(i) / sr * RATE
		var k := floori(p)
		kick[i] = hit[k % strikes] if p - k < RATE / sr else 0.0
	for md in MODES:
		var w: float = TAU * F0 * md[0] / sr
		var r := exp(-md[2] / sr)
		var c1 := 2.0 * r * cos(w)
		var c2 := -r * r
		var g: float = md[1] * sin(w)
		var y1 := 0.0
		var y2 := 0.0
		for i in 2 * n:
			var y := c1 * y1 + c2 * y2 + kick[i % n] * g
			y2 = y1
			y1 = y
			if i >= n:
				out[i - n] += y
	# the hammer's tick on each stroke: a few milliseconds of hard click
	for k in strikes:
		var i0 := roundi(float(k) / RATE * sr)
		var j := 0
		while j < sr * 0.004 and i0 + j < n:
			out[i0 + j] += (sin(j * 1.7) * 0.6 + sin(j * 0.9)) * hit[k] * 0.9 * (1.0 - j / (sr * 0.004))
			j += 1
	var peak := 0.0
	for v in out:
		peak = maxf(peak, absf(v))
	for i in n:
		out[i] = tanh(out[i] / peak * 1.6) / tanh(1.6) # (a little hard, as a bell is up close)
	return out

# Four Wright Cyclones: per engine a sawtooth, a square an octave up and a triangle higher, detuned against
# each other so they beat slowly, through a low-pass. Made as a 10 s loop (each tone's frequency to the
# nearest 0.1 Hz, so every one meets itself at the loop's end) at 11 kHz: nothing passes the low-pass above.
func _r_bomber(_r: RandomNumberGenerator) -> Array:
	var sr := 11025.0
	var n := roundi(sr * 10)
	var sum := PackedFloat32Array()
	sum.resize(n)
	for i in 4:
		var f: float = [38.5, 39.1, 39.8, 40.3][i] * pow(2.0, i * 7 / 1200.0) # (detune i * 7 cents)
		for v in [[1.0, "sawtooth", 0.5], [2.0, "square", 0.12], [4.5, "triangle", 0.05]]:
			var fq := snappedf(f * v[0], 0.1)
			Dsp.add(sum, Dsp.osc(n, sr, v[1], fq), v[2])
	var twice := sum.duplicate()
	twice.append_array(sum) # (filtered twice over, the second time kept: the filter's settled, the loop seamless)
	var y := Dsp.biquad(twice, sr, "lowpass", 320, 0.7)
	return [y.slice(n), sr, true]

# wind / slipstream rumble: 2 s of noise through a one-pole low-pass (a rumble), through a band-pass at 180 Hz
func _r_wind(r: RandomNumberGenerator) -> Array:
	var sr := 24000.0
	var n := roundi(sr * 2)
	var d := PackedFloat32Array()
	d.resize(n)
	var a := pow(0.98, 48000.0 / sr) # (the browser's one-pole was per sample at 48 kHz: the same cut-off here)
	var last := 0.0
	for i in n:
		last = last * a + (r.randf() * 2 - 1) * (1 - a)
		d[i] = last
	var want := 6.0 * sqrt(1.0 / 3.0 * 0.02 / 1.98) # (as loud as it was: the same RMS)
	var have := sqrt(1.0 / 3.0 * (1 - a) / (1 + a))
	var twice := d.duplicate()
	twice.append_array(d)
	var y := Dsp.biquad(twice, sr, "bandpass", 180, 0.5)
	y = y.slice(n)
	for i in n:
		y[i] *= want / have
	return [y, sr, true]

func _r_gunshot(r: RandomNumberGenerator) -> Array:
	var n := roundi(SR * 0.12)
	var out := Dsp.zeros(n)
	var crack := Dsp.biquad(Dsp.noise(roundi(SR * 0.1), r), SR, "bandpass", 900 + r.randf() * 500, 0.7)
	Dsp.add(out, Dsp.mul(crack, Env.new(1).set_at(0.55, 0).expo(0.001, 0.09).render(crack.size(), SR)))
	var nt := roundi(SR * 0.12)
	var thump := Dsp.osc(nt, SR, "sine", Env.new(120).set_at(120, 0).expo(45, 0.08).render(nt, SR))
	Dsp.add(out, Dsp.mul(thump, Env.new(1).set_at(0.7, 0).expo(0.001, 0.1).render(nt, SR)))
	return [out, SR, false]

func _r_reload(r: RandomNumberGenerator, start: bool) -> Array:
	var hits: Array = [0.0, 0.18, 0.5] if start else [0.0, 0.12]
	var out := Dsp.zeros(roundi(SR * (hits[hits.size() - 1] + 0.16)))
	for i in hits.size():
		var x := Dsp.biquad(Dsp.noise(roundi(SR * 0.15), r), SR, "bandpass", (2400.0 if start else 3200.0) - i * 300, 8)
		Dsp.add(out, Dsp.mul(x, Env.new(1).set_at(0.5, 0).expo(0.001, 0.12).render(x.size(), SR)), 1.0, roundi(hits[i] * SR))
	return [out, SR, false]

func _r_overheat(r: RandomNumberGenerator) -> Array:
	var x := Dsp.biquad(Dsp.noise(roundi(SR * 0.95), r), SR, "highpass", 3500)
	return [Dsp.mul(x, Env.new(1).set_at(0.25, 0).expo(0.001, 0.9).render(x.size(), SR)), SR, false]

func _r_distant_gun(r: RandomNumberGenerator, v: float) -> Array:
	var x := Dsp.biquad(Dsp.noise(roundi(SR * 0.13), r), SR, "bandpass", 600)
	return [Dsp.mul(x, Env.new(1).set_at(v, 0).expo(0.001, 0.12).render(x.size(), SR)), SR, false]

func _r_impact(r: RandomNumberGenerator, cannon: bool) -> Array:
	var out := Dsp.zeros(roundi(SR * (0.52 if cannon else 0.14)))
	# the crack: a very short bright burst
	var c := Dsp.biquad(Dsp.noise(roundi(SR * 0.06), r), SR, "highpass", 2200)
	Dsp.add(out, Dsp.mul(c, Env.new(1).set_at(0.9, 0).expo(0.001, 0.05).render(c.size(), SR)))
	# the skin tearing: a short rasp of torn aluminium (no ring: thin skin punched through doesn't ring)
	var rs := Dsp.biquad(Dsp.noise(roundi(SR * 0.12), r), SR, "bandpass", 900 + r.randf() * 900, 1.2)
	Dsp.add(out, Dsp.mul(rs, Env.new(1).set_at(0.55, 0).expo(0.001, 0.066 + r.randf() * 0.04).render(rs.size(), SR)), 1.0, roundi(SR * 0.004))
	# and the knock of it through the airframe: a dull thud
	var k := Dsp.biquad(Dsp.noise(roundi(SR * 0.1), r), SR, "lowpass", 260)
	Dsp.add(out, Dsp.mul(k, Env.new(1).set_at(0.7, 0).expo(0.001, 0.09).render(k.size(), SR)))
	if cannon: # the shell bursting: a deep bang
		var m := Dsp.biquad(Dsp.noise(roundi(SR * 0.5), r), SR, "lowpass", 520)
		Dsp.add(out, Dsp.mul(m, Env.new(1).set_at(1.3, 0).expo(0.001, 0.44).render(m.size(), SR)), 1.0, roundi(SR * 0.01))
	return [out, SR, false]

func _r_pain(r: RandomNumberGenerator, severe: bool, deep: float) -> Array:
	var sr := 24000.0 # (nothing above the 2.5 kHz formant)
	var len := 0.75 if severe else 0.28 + r.randf() * 0.12
	var f0 := (175.0 if severe else 150.0) * (0.85 + deep * 0.3) * (0.92 + r.randf() * 0.16)
	var t0 := 0.02
	var n := roundi(sr * (t0 + len + 0.06))
	var no := roundi(sr * (len + 0.05))
	var o := Dsp.osc(no, sr, "sawtooth", Env.new(f0).set_at(f0 * 1.15, 0).expo(f0 * (0.62 if severe else 0.78), len).render(no, sr))
	var voiced := Dsp.zeros(no)
	for fm in [[760.0 if severe else 620.0, 6.0, 1.0], [1180.0 if severe else 1050.0, 8.0, 0.6], [2500.0, 10.0, 0.18]]: # the "ah" / "uh"
		Dsp.add(voiced, Dsp.biquad(o, sr, "bandpass", fm[0], fm[1]), fm[2])
	var br := Dsp.biquad(Dsp.noise(no, r), sr, "bandpass", 1400, 1) # breath
	Dsp.add(voiced, br, 0.12)
	var env := Env.new(1).set_at(0.0001, 0).expo(0.5, 0.03).set_at(0.5, len * 0.55).expo(0.0001, len).render(no, sr)
	var out := Dsp.zeros(n)
	Dsp.add(out, Dsp.mul(voiced, env), 1.0, roundi(t0 * sr))
	return [out, sr, false]

func _r_flak(r: RandomNumberGenerator, dist: float) -> Array:
	var sr := 16000.0 # (below the low-pass's 1.6 kHz at most)
	var len := 0.9 + minf(1, dist / 800.0)
	var x := Dsp.biquad(Dsp.noise(roundi(sr * 2), r), sr, "lowpass", maxf(140.0, 1600.0 - dist * 1.2))
	var v := minf(1.6, 180.0 / maxf(dist, 30)) * exp(-dist / 1800.0)
	x = x.slice(0, roundi(sr * minf(2.0, len + 0.05)))
	return [Dsp.mul(x, Env.new(1).set_at(0.0001, 0).lin(v, 0.012).expo(0.001, len).render(x.size(), sr)), sr, false]

func _r_flak_crack(r: RandomNumberGenerator) -> Array:
	var x := Dsp.biquad(Dsp.noise(roundi(SR * 0.09), r), SR, "highpass", 1500)
	return [Dsp.mul(x, Env.new(1).set_at(1.0, 0).expo(0.001, 0.07).render(x.size(), SR)), SR, false]

func _r_flak_close(r: RandomNumberGenerator, k: float) -> Array:
	var t0 := 0.02
	var out := Dsp.zeros(roundi(SR * (t0 + 0.62)))
	var nt := roundi(SR * 0.5)
	var o := Dsp.osc(nt, SR, "sine", Env.new(70).set_at(70, 0).expo(34, 0.35).render(nt, SR)) # the airframe's thump
	Dsp.add(out, Dsp.mul(o, Env.new(1).set_at(0.0001, 0).lin(1.1 * k, 0.015).expo(0.001, 0.45).render(nt, SR)), 1.0, roundi(t0 * SR))
	var ticks := roundi(6 + k * 26)
	for i in ticks: # the rattle: fragments arrive a little after the blast, spread out
		var at := t0 + 0.06 + r.randf() * (0.15 + 0.35 * r.randf())
		var x := Dsp.biquad(Dsp.noise(roundi(SR * 0.04), r), SR, "bandpass", 2500 + r.randf() * 3500, 2.5)
		Dsp.add(out, Dsp.mul(x, Env.new(1).set_at((0.25 + 0.5 * r.randf()) * k, 0).expo(0.001, 0.012 + r.randf() * 0.02).render(x.size(), SR)), 1.0, roundi(at * SR))
	return [out, SR, false]

func _r_explosion(r: RandomNumberGenerator, dist: float) -> Array:
	var sr := 16000.0
	var x := Dsp.biquad(Dsp.noise(roundi(sr * 1.0), r), sr, "lowpass", maxf(150.0, 1200.0 - dist * 0.5))
	return [Dsp.mul(x, Env.new(1).set_at(minf(1.2, 400.0 / maxf(dist, 50)), 0).expo(0.001, 1.6).render(x.size(), sr)), sr, false]

func _r_thunder(r: RandomNumberGenerator, dist: float) -> Array:
	var sr := 8000.0 # (a low-pass under 900 Hz)
	var dur := 2.5 + minf(dist / 2500.0, 3)
	var n := roundi(sr * (dur + 0.1))
	var f := Env.new(900).set_at(900.0 if dist < 3000 else 380.0, 0).expo(90, dur).render(n, sr)
	var x := Dsp.biquad(Dsp.noise(n, r), sr, "lowpass", 900, 1.0, f)
	var v := minf(1.1, 2600.0 / dist)
	return [Dsp.mul(x, Env.new(1).set_at(0.0001, 0).expo(v, 0.08).set_at(v * 0.5, 0.5).lin(v * 0.7, 1.1).expo(0.001, dur).render(n, sr)), sr, false] # (the rumble rolls on)

func _r_chime(kind: String) -> Array:
	var notes: Array = {kill = [[660.0, 0.0], [990.0, 0.11]], assist = [[740.0, 0.0]], crit = [[330.0, 0.0]]}.get(kind, [])
	var out := Dsp.zeros(roundi(SR * 0.55))
	for nt in notes:
		var n := roundi(SR * 0.4)
		var o := Dsp.osc(n, SR, "triangle" if kind == "crit" else "sine", nt[0])
		var e := Env.new(0).set_at(0, 0).lin(0.22 if kind == "kill" else 0.14, 0.015).expo(0.001, 0.35 if kind == "kill" else 0.22).render(n, SR)
		Dsp.add(out, Dsp.mul(o, e), 1.0, roundi(nt[1] * SR))
	return [out, SR, false]

func _r_heartbeat(_r: RandomNumberGenerator) -> Array:
	var sr := 16000.0
	var out := Dsp.zeros(roundi(sr * 0.4))
	for i in 2:
		var n := roundi(sr * 0.18)
		var o := Dsp.osc(n, sr, "sine", Env.new(60).set_at(60.0 - i * 8, 0).expo(35, 0.12).render(n, sr))
		Dsp.add(out, Dsp.mul(o, Env.new(1).set_at(0.9 - i * 0.3, 0).expo(0.001, 0.16).render(n, sr)), 1.0, roundi([0.0, 0.18][i] * sr))
	return [out, sr, false]

func _r_tink(r: RandomNumberGenerator, link: bool) -> Array:
	var f := 1900.0 + r.randf() * 900 if link else 3300.0 + r.randf() * 2400
	var out := Dsp.zeros(roundi(SR * 0.2))
	var parts: Array = [[1.0, 1.0, 0.03], [2.31, 0.4, 0.02]] if link else [[1.0, 1.0, 0.09 + r.randf() * 0.07], [2.72, 0.5, 0.05], [5.1, 0.25, 0.03]]
	for p in parts:
		var n := roundi(SR * (p[2] + 0.01))
		Dsp.add(out, Dsp.mul(Dsp.osc(n, SR, "sine", f * p[0]), Env.new(1).set_at(0.09 * p[1], 0).expo(0.0005, p[2]).render(n, SR)))
	var x := Dsp.biquad(Dsp.noise(roundi(SR * 0.02), r), SR, "highpass", 4000) # the tick of it landing
	Dsp.add(out, Dsp.mul(x, Env.new(1).set_at(0.12, 0).expo(0.001, 0.012).render(x.size(), SR)))
	return [out, SR, false]

func _r_burst(r: RandomNumberGenerator, len: float, f: float, v: float) -> Array:
	var x := Dsp.biquad(Dsp.noise(roundi(SR * (len + 0.02)), r), SR, "bandpass", f, 0.7)
	return [Dsp.mul(x, Env.new(1).set_at(v, 0).expo(0.001, len).render(x.size(), SR)), SR, false]

func _r_hiss(r: RandomNumberGenerator) -> Array:
	var n := roundi(SR)
	var x := Dsp.noise(n, r)
	var twice := x.duplicate()
	twice.append_array(x)
	return [Dsp.biquad(twice, SR, "bandpass", 1900, 0.5).slice(n), SR, true]

# Your own fighter's engine: four voices (the firing note, the exhaust's crackle an octave down, a high
# harmonic and a low rumble) wobbling together at 7 Hz, the exhaust stacks beating; each engine's own mix of
# them and its own low-pass, made at a 100 Hz base (the low-pass scaled with it) to be pitched to the note.
func _r_fighter(kind: String) -> Array:
	var sr := 22050.0
	var n := roundi(sr) # (1 s: 25, 50, 100 and 201 Hz, and the 7 Hz wobble, all meet themselves)
	var mixv: Array = [0.35, 0.3, 0.06, 0.22] if kind == "bf109" else [0.5, 0.26, 0.1, 0.16] if kind == "fw190" else [0.45, 0.18, 0.1, 0.1]
	var lp := (1100.0 if kind == "bf109" else 900.0 if kind == "fw190" else 1600.0) * 100.0 / (82.0 if kind == "bf109" else 68.0 if kind == "fw190" else 96.0)
	var sum := Dsp.zeros(n)
	var vs := [[1.0, "sawtooth"], [0.5, "square"], [2.01, "triangle"], [0.25, "sawtooth"]]
	for i in 4:
		var f := PackedFloat32Array()
		f.resize(n)
		for s in n: # (the wobble: 6 cents either way)
			f[s] = 100.0 * vs[i][0] * pow(2.0, 6.0 * sin(TAU * 7.0 * s / sr) / 1200.0)
		Dsp.add(sum, Dsp.osc(n, sr, vs[i][1], f), mixv[i])
	var twice := sum.duplicate()
	twice.append_array(sum)
	return [Dsp.biquad(twice, sr, "lowpass", lp, 0.8).slice(n), sr, true]

# The nearest fighter's snarl: a sawtooth and two squares a fifth and an octave up, through a low-pass; at
# 100 Hz (95 Hz times the Doppler when played)
func _r_drone(_r: RandomNumberGenerator) -> Array:
	var sr := 22050.0
	var n := roundi(sr)
	var sum := Dsp.zeros(n)
	for i in 3:
		Dsp.add(sum, Dsp.osc(n, sr, "square" if i else "sawtooth", 100.0 * [1.0, 1.5, 2.02][i]), [0.5, 0.15, 0.1][i])
	var twice := sum.duplicate()
	twice.append_array(sum)
	return [Dsp.biquad(twice, sr, "lowpass", 900.0 * 100.0 / 95.0).slice(n), sr, true]

# The turret's motors at rest (k 0) and flat out (k 1): rounded waves through a band-pass and a low-pass,
# a hum, not a buzz. 0.5 s loops.
func _r_whine(k: float) -> Array:
	var sr := 16000.0
	var n := roundi(sr * 0.5)
	var sum := Dsp.osc(n, sr, "triangle", 120.0 + 220.0 * k)
	Dsp.add(sum, Dsp.osc(n, sr, "sine", 242.0 + 440.0 * k))
	var twice := sum.duplicate()
	twice.append_array(sum)
	var y := Dsp.biquad(twice, sr, "bandpass", 300 + 500 * k, 1.2)
	return [Dsp.biquad(y, sr, "lowpass", 700).slice(n), sr, true]

## A gain or frequency over time, as an AudioParam's automation: set, linear and exponential ramps, targets.
class Env:
	var v0 := 1.0
	var ev: Array = []
	func _init(initial := 1.0) -> void:
		v0 = initial
	func set_at(v: float, t: float) -> Env:
		ev.append([0, v, t, 0.0])
		return self
	func lin(v: float, t: float) -> Env:
		ev.append([1, v, t, 0.0])
		return self
	func expo(v: float, t: float) -> Env:
		ev.append([2, v, t, 0.0])
		return self
	func target(v: float, t: float, tau: float) -> Env:
		ev.append([3, v, t, tau])
		return self
	func render(n: int, sr: float) -> PackedFloat32Array:
		var out := PackedFloat32Array()
		out.resize(n)
		var k := 0
		var pt := 0.0
		var pv := v0
		var tgt := false
		var tv := 0.0
		var tt := 0.0
		var ttau := 1.0
		for i in n:
			var t := i / sr
			while k < ev.size() and ev[k][2] <= t:
				var e: Array = ev[k]
				if e[0] == 3:
					pv = (tv + (pv - tv) * exp(-(e[2] - tt) / ttau)) if tgt else pv
					tgt = true
					tv = e[1]
					tt = e[2]
					ttau = e[3]
				else:
					tgt = false
					pv = e[1]
				pt = e[2]
				k += 1
			var v := pv
			if tgt:
				v = tv + (pv - tv) * exp(-(t - tt) / ttau)
			if k < ev.size() and (ev[k][0] == 1 or ev[k][0] == 2):
				var e: Array = ev[k]
				var u := (t - pt) / maxf(e[2] - pt, 1e-9)
				if e[0] == 1:
					v = pv + (e[1] - pv) * u
				elif pv > 0 and e[1] > 0:
					v = pv * pow(e[1] / pv, u)
			out[i] = v
		return out

## The bits of Web Audio the sounds are made of, offline.
class Dsp:
	static func zeros(n: int) -> PackedFloat32Array:
		var a := PackedFloat32Array()
		a.resize(n)
		return a

	static func noise(n: int, r: RandomNumberGenerator) -> PackedFloat32Array:
		var a := PackedFloat32Array()
		a.resize(n)
		for i in n:
			a[i] = r.randf() * 2.0 - 1.0
		return a

	## dst[at + i] += src[i] * g
	static func add(dst: PackedFloat32Array, src: PackedFloat32Array, g := 1.0, at := 0) -> void:
		var n := mini(src.size(), dst.size() - at)
		for i in n:
			dst[at + i] += src[i] * g

	static func mul(a: PackedFloat32Array, b: PackedFloat32Array) -> PackedFloat32Array:
		var n := mini(a.size(), b.size())
		var o := a.slice(0, n)
		for i in n:
			o[i] *= b[i]
		return o

	static func _blep(t: float, dt: float) -> float:
		if t < dt:
			t /= dt
			return t + t - t * t - 1.0
		if t > 1.0 - dt:
			t = (t - 1.0) / dt
			return t * t + t + t + 1.0
		return 0.0

	## An OscillatorNode: sine, square, sawtooth or triangle (band-limited, as the browser's are), at a
	## frequency (Hz) or a frequency for every sample.
	static func osc(n: int, sr: float, type: String, freq) -> PackedFloat32Array:
		var out := PackedFloat32Array()
		out.resize(n)
		var per_sample: bool = freq is PackedFloat32Array
		var f0: float = 0.0 if per_sample else freq
		var ph := 0.0
		for i in n:
			var f: float = freq[i] if per_sample else f0
			var dt := f / sr
			var v := 0.0
			match type:
				"sine":
					v = sin(TAU * ph)
				"sawtooth":
					v = 2.0 * ph - 1.0 - _blep(ph, dt)
				"square":
					v = (1.0 if ph < 0.5 else -1.0) + _blep(ph, dt) - _blep(fmod(ph + 0.5, 1.0), dt)
				"triangle":
					v = 4.0 * absf(ph - 0.5) - 1.0
			out[i] = v
			ph += dt
			ph -= floorf(ph)
		return out

	## A BiquadFilterNode, with its formulas (Audio EQ Cookbook; lowpass and highpass take Q in dB, the
	## others as Q). f_env: its frequency for every sample (an automated frequency), else f throughout.
	static func biquad(x: PackedFloat32Array, sr: float, type: String, f: float, q := 1.0, f_env := PackedFloat32Array(), gain_db := 0.0) -> PackedFloat32Array:
		var y := PackedFloat32Array()
		y.resize(x.size())
		var c := _coef(sr, type, f, q, gain_db)
		var x1 := 0.0
		var x2 := 0.0
		var y1 := 0.0
		var y2 := 0.0
		var moving := f_env.size() > 0
		for i in x.size():
			if moving and i % 32 == 0:
				c = _coef(sr, type, f_env[mini(i, f_env.size() - 1)], q, gain_db)
			var xi := x[i]
			var yi: float = c[0] * xi + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2
			x2 = x1
			x1 = xi
			y2 = y1
			y1 = yi
			y[i] = yi
		return y

	static func _coef(sr: float, type: String, f: float, q: float, g: float) -> PackedFloat32Array:
		f = clampf(f, 1.0, sr * 0.5 - 1.0)
		var w := TAU * f / sr
		var c := cos(w)
		var s := sin(w)
		var b0 := 0.0
		var b1 := 0.0
		var b2 := 0.0
		var a0 := 1.0
		var a1 := -2.0 * c
		var a2 := 1.0
		match type:
			"lowpass", "highpass":
				var al := s / (2.0 * pow(10.0, q / 20.0))
				var lo := type == "lowpass"
				b0 = (1.0 - c) / 2.0 if lo else (1.0 + c) / 2.0
				b1 = 1.0 - c if lo else -(1.0 + c)
				b2 = b0
				a0 = 1.0 + al
				a2 = 1.0 - al
			"bandpass":
				var al := s / (2.0 * q)
				b0 = al
				b2 = -al
				a0 = 1.0 + al
				a2 = 1.0 - al
			"peaking":
				var A := pow(10.0, g / 40.0)
				var al := s / (2.0 * q)
				b0 = 1.0 + al * A
				b1 = -2.0 * c
				b2 = 1.0 - al * A
				a0 = 1.0 + al / A
				a2 = 1.0 - al / A
		return PackedFloat32Array([b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0])

	## The samples as a 16-bit AudioStreamWAV, normalised to their peak (the peak kept: the level it was made at).
	static func wav(x: PackedFloat32Array, sr: float, loop: bool) -> Snd:
		var peak := 1e-9
		for v in x:
			peak = maxf(peak, absf(v))
		var b := PackedByteArray()
		b.resize(x.size() * 2)
		var k := 32767.0 / peak
		for i in x.size():
			b.encode_s16(i * 2, clampi(roundi(x[i] * k), -32768, 32767))
		var w := AudioStreamWAV.new()
		w.format = AudioStreamWAV.FORMAT_16_BITS
		w.mix_rate = roundi(sr)
		w.stereo = false
		w.data = b
		if loop:
			w.loop_mode = AudioStreamWAV.LOOP_FORWARD
			w.loop_begin = 0
			w.loop_end = x.size()
		var s := Snd.new()
		s.stream = w
		s.peak = peak
		s.length = x.size() / sr
		return s
