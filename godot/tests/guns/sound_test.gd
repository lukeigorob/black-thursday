extends Node
# Plays every sound audio.gd makes, one after another, and records what comes out of the Master bus to
# <out>/sounds/<name>.wav (and all of it to sounds_all.wav). Then a run of the intercom (radio.gd: the
# archive clips) and the German radio (funk.gd). Prints how long making the sound bank took.
#   Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/guns/sound_test.tscn -- --out=<folder>

const GameAudio := preload("res://src/audio.gd")
const Radio := preload("res://src/radio.gd")
const Funk := preload("res://src/funk.gd")
const Archive := preload("res://src/archive.gd")
const TestKit := preload("res://src/core/test_kit.gd")

var audio
var rec: AudioEffectRecord
var out := ""
var log_lines: Array = []

func _ready() -> void:
	out = TestKit.out_dir().path_join("sounds")
	DirAccess.make_dir_recursive_absolute(out)
	audio = GameAudio.new()
	add_child(audio)
	var t0 := Time.get_ticks_msec()
	audio.ensure()
	while not audio.bank_ready():
		await get_tree().process_frame
	print("sound bank made in %d ms" % (Time.get_ticks_msec() - t0))
	rec = AudioEffectRecord.new()
	AudioServer.add_bus_effect(0, rec)
	audio.set_volume(1.0, false)
	await run()
	get_tree().quit()

func take(name: String, seconds: float, f: Callable) -> void:
	rec.set_recording_active(true)
	f.call()
	await TestKit.wait(self, seconds)
	rec.set_recording_active(false)
	var w := rec.get_recording()
	if w:
		w.save_to_wav(out.path_join(name + ".wav"))
	print("SOUND ", name)

func run() -> void:
	await take("gunshot_burst", 1.5, func() -> void:
		for i in 12:
			get_tree().create_timer(i * 60.0 / 750.0).timeout.connect(func() -> void: audio.gunshot(1.0)))
	await take("gunshot_ai_far", 1.2, func() -> void:
		for i in 6:
			get_tree().create_timer(i * 0.24).timeout.connect(func() -> void: audio.gunshot(0.2)))
	await take("reload", 2.0, func() -> void:
		audio.reload(true)
		get_tree().create_timer(1.2).timeout.connect(func() -> void: audio.reload(false)))
	await take("overheat", 1.3, func() -> void: audio.overheat())
	await take("distant_gun", 1.5, func() -> void:
		for i in 5:
			get_tree().create_timer(i * 0.2).timeout.connect(func() -> void: audio.distant_gun(150.0 + i * 150)))
	await take("impact", 1.0, func() -> void: audio.impact(false))
	await take("impact_cannon", 1.2, func() -> void: audio.impact(true))
	await take("pain", 2.5, func() -> void:
		audio.pain(1.0, false, 0.0)
		get_tree().create_timer(0.7).timeout.connect(func() -> void: audio.pain(1.0, false, 0.8))
		get_tree().create_timer(1.4).timeout.connect(func() -> void: audio.pain(1.0, true, 0.4)))
	await take("flak_near_to_far", 9.0, func() -> void:
		var i := 0
		for d in [40.0, 200.0, 500.0, 1000.0, 2000.0, 3000.0]:
			var dd: float = d
			get_tree().create_timer(i * 1.2).timeout.connect(func() -> void: audio.flak(dd))
			i += 1)
	await take("flak_close", 2.0, func() -> void:
		audio.flak_close(0.4)
		get_tree().create_timer(0.9).timeout.connect(func() -> void: audio.flak_close(1.0)))
	await take("explosion", 6.0, func() -> void:
		audio.explosion(5)
		get_tree().create_timer(2.0).timeout.connect(func() -> void: audio.explosion(600)))
	await take("thunder", 9.0, func() -> void: audio.thunder(1200))
	await take("chimes", 2.0, func() -> void:
		audio.chime("kill")
		get_tree().create_timer(0.6).timeout.connect(func() -> void: audio.chime("assist"))
		get_tree().create_timer(1.2).timeout.connect(func() -> void: audio.chime("crit")))
	await take("heartbeat", 3.0, func() -> void:
		for i in 60:
			get_tree().create_timer(i / 20.0).timeout.connect(func() -> void: audio.heartbeat(0.8, 0.05)))
	await take("case_tinks", 2.0, func() -> void:
		for i in 10:
			get_tree().create_timer(i * 0.15).timeout.connect(func() -> void: audio.case_tink(0.8, i % 3 == 0)))
	await take("brass_rolling", 3.0, func() -> void:
		for i in 60:
			get_tree().create_timer(i / 20.0).timeout.connect(func() -> void: audio.brass(0.05, 1.0, 0.6)))
	await take("bell", 3.0, func() -> void:
		audio.bell_ring(true)
		get_tree().create_timer(2.0).timeout.connect(func() -> void: audio.bell_ring(false)))
	await take("b17_engines", 4.0, func() -> void: audio.start())
	await take("fighter_drone_pass", 5.0, func() -> void:
		for i in 100:
			var k := i / 100.0
			get_tree().create_timer(i * 0.05).timeout.connect(func() -> void:
				var d := absf(k - 0.5) * 1200.0 + 30.0
				audio.fighter_drone(d, 200.0 if k < 0.5 else -200.0)))
	audio.fighter_drone(INF, 0)
	await take("turret_whine", 3.0, func() -> void:
		for i in 60:
			var k := sin(i / 60.0 * PI)
			get_tree().create_timer(i * 0.05).timeout.connect(func() -> void: audio.turret_whine(k * 1.05)))
	audio.turret_whine(0)
	for kind in ["bf109", "fw190", "p47"]:
		await take("own_engine_" + kind, 4.0, func() -> void:
			for i in 80:
				var th := clampf(i / 40.0, 0.0, 1.0)
				get_tree().create_timer(i * 0.05).timeout.connect(func() -> void: audio.own_engine(kind, th, 120.0 + th * 100)))
	audio.own_engine(null)
	await TestKit.wait(self, 1.0)
	# the intercom: a few of the archive clips, through the headset (radio.gd's way of saying them)
	await take("intercom", 16.0, func() -> void: intercom())
	await take("funk", 10.0, func() -> void: funk_run())

func intercom() -> void:
	var ids := ["belle_02_02", "belle_04_03", "belle_05_01", "bail_order"]
	for id in ids:
		audio.voice_clip(id if id.begins_with("belle_") else "belle_" + id, "audio/archive")
	await TestKit.wait(self, 0.5)
	for id in ids:
		var cid: String = id if id.begins_with("belle_") else "belle_" + id
		var h = audio.voice(cid, {url = "audio/archive"})
		if h:
			print("  intercom %s: %.1f s" % [cid, h.dur])
			await TestKit.wait(self, h.dur + 0.8)

func funk_run() -> void:
	for id in ["leit_1", "pauke_2", "viktor_1", "otto_1"]:
		audio.voice_clip(id, "audio/funk")
	await TestKit.wait(self, 0.5)
	for id in ["leit_1", "viktor_1", "pauke_2", "otto_1"]:
		var h = audio.voice(id, {url = "audio/funk", vol = 0.9})
		if h:
			print("  funk %s: %.1f s" % [id, h.dur])
			await TestKit.wait(self, h.dur + 0.5)
