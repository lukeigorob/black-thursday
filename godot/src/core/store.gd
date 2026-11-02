extends RefCounted
# The browser's localStorage, for the settings the game keeps between visits (graphics quality, the weather,
# the hour...): the same keys, kept in user://settings.cfg. `Store.get_item("bomber.quality")` returns null
# when nothing's been saved, as localStorage.getItem does.

const PATH := "user://settings.cfg"
static var _cfg: ConfigFile

static func _load() -> ConfigFile:
	if _cfg == null:
		_cfg = ConfigFile.new()
		_cfg.load(PATH) # (no file yet is fine)
	return _cfg

static func get_item(key: String):
	return _load().get_value("store", key, null)

static func set_item(key: String, value: String) -> void:
	_load().set_value("store", key, value)
	_cfg.save(PATH)

static func remove_item(key: String) -> void:
	if _load().has_section_key("store", key):
		_cfg.erase_section_key("store", key)
		_cfg.save(PATH)
