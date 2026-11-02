extends RefCounted
# The link's ?options (?battle=small, ?debug=formation...): on the command line after `--` as --battle=small,
# and in a web build read from the page's own link as before. `Args.param("battle")` is null when not given
# (URLSearchParams.get), `Args.has("test")` for a bare flag.

static var _params: Dictionary

static func _all() -> Dictionary:
	if _params == null or _params.is_empty():
		_params = {}
		for a in OS.get_cmdline_user_args():
			if a.begins_with("--"):
				var kv := a.substr(2).split("=", true, 1)
				_params[kv[0]] = kv[1] if kv.size() > 1 else ""
		if OS.has_feature("web"):
			var q = JavaScriptBridge.eval("location.search", true)
			if q is String and q.length() > 1:
				for pair in q.substr(1).split("&"):
					var kv: PackedStringArray = pair.split("=", true, 1)
					_params[kv[0].uri_decode()] = kv[1].uri_decode() if kv.size() > 1 else ""
	return _params

static func param(key: String):
	return _all().get(key, null)

static func has(key: String) -> bool:
	return _all().has(key)
