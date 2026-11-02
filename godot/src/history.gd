extends RefCounted
# The real aircraft and men of Mission 115, Schweinfurt, 14 October 1943, from the research files in
# historical_data/black_thursday (one file a bomb group, each record with its sources and how sure it is:
# VERIFIED, PROBABLE, UNVERIFIED, UNKNOWN). Nothing here is made up: a bomber whose record isn't known gets
# no serial or name, and a man who isn't known is a placeholder, marked as one wherever he's shown.
# (The files the game reads are copied into res://data/black_thursday: the groups' files without their
# _sources, and slots.json. An export must include data/*.json.)

const DIR := "res://data/black_thursday"

static func _read(path: String):
	var f := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(f.get_as_text()) if f else null

static func _load_groups() -> Dictionary:
	var out := {} # '306th' -> its file (aircraft, dispatched, research gaps)
	for name in DirAccess.get_files_at(DIR + "/groups"):
		if not name.ends_with(".json") or name.ends_with("_sources.json"):
			continue
		var data = _read(DIR + "/groups/" + name)
		if data is Dictionary and data.get("group"):
			out[data.group] = data
	return out

static var GROUPS: Dictionary = _load_groups()

## The crew positions in the records, as the game's crew roles (crew.js).
const POSITION_ROLE := {pilot = "pilot", copilot = "copilot", navigator = "navigator", bombardier = "bombardier", engineer = "engineer", radio = "radio", ball = "ball", waist_left = "waistL", waist_right = "waistR", tail = "tail"}

static var SLOTS = _read(DIR + "/slots.json")

static func history_loaded() -> bool:
	return GROUPS.size() > 0

static func _charted() -> Dictionary:
	var out := {}
	for s in (SLOTS.slots if SLOTS else []):
		out[s.serial_number] = s
	return out

## The places the groups' own charts give their aircraft (slots.json): serial -> { squadron, element, wingman, basis, confidence }.
static var CHARTED: Dictionary = _charted()

static func group_record(group: String):
	return GROUPS.get(group, null)

## The aircraft a group flew that day, in the order the research has them (lead ship first where the
## records say which it was). Records without a serial still count: the group did fly that many.
static func group_aircraft(group: String) -> Array:
	var g = GROUPS.get(group, null)
	if not g or not g.get("aircraft"):
		return []
	return g.aircraft.filter(func(a): return not a.get("duplicate_of")) # (a sortie filed under two groups: counted under one)

## The men of a record as the game's crew roles: { pilot: { name, rank, fate, confidence }, ... }. A
## plain "waist" gunner goes to whichever waist is still free; men the game has no station for (a second
## navigator, an observer) are left out of the roles but kept in the record.
static func crew_by_role(record) -> Dictionary:
	var out := {}
	if not record:
		return out
	var crew = record.get("crew")
	for m in (crew if crew else []):
		if not m or not m.get("name") or m.get("confidence") == "UNKNOWN":
			continue
		var role = POSITION_ROLE.get(m.get("position"), null)
		if not role and m.get("position") == "waist":
			role = "waistR" if out.has("waistL") else "waistL"
		if role and not out.has(role):
			out[role] = {name = m.name, rank = m.get("rank"), fate = m.get("fate") if m.get("fate") != null else "unknown", confidence = m.get("confidence") if m.get("confidence") != null else "UNVERIFIED"}
	return out

static var _SUFFIX := RegEx.create_from_string("(?i)^(jr\\.?|sr\\.?|ii|iii|iv)$")

## A man's surname, for the intercom ("Kowalski's hit!"): the last word, past a "Jr." or "III".
static func surname_of(name) -> String:
	var w := Array(str(name).replace(",", "").split(" ", false))
	while w.size() > 1 and _SUFFIX.search(w[w.size() - 1]):
		w.pop_back()
	return w[w.size() - 1] if w.size() else str(name)

## What the game shows of a bomber's identity (the panel, the seat map): only what's recorded, with how
## sure it is; null fields are unknown, not blank.
static func identity_of(record, group) -> Dictionary:
	if not record:
		return {group = group, known = false}
	var code = null
	if record.get("squadron_code"):
		code = record.squadron_code + ("-" + record.aircraft_letter if record.get("aircraft_letter") else "")
	return {
		known = true, group = group, serial = record.get("serial_number"), type = record.get("aircraft_type"), block = record.get("block"),
		nickname = record.get("nickname"), squadron = record.get("bomb_squadron"),
		code = code,
		pilot = ((record.pilot_rank + " ") if record.get("pilot_rank") else "") + record.pilot if record.get("pilot") else null,
		outcome = record.get("mission_outcome") if record.get("mission_outcome") != null else "unknown", loss_details = record.get("loss_details"), macr = record.get("macr"),
		confidence = record.get("historical_confidence") if record.get("historical_confidence") != null else "UNKNOWN", sources = record.get("sources") if record.get("sources") != null else [],
	}
