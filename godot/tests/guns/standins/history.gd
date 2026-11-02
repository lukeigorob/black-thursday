extends RefCounted
# STAND-IN (tests/guns only): the real history.gd is the bombers session's. Copied into src/ of a test copy when missing.
static func surname_of(name) -> String:
	var w := Array(str(name).replace(",", "").split(" ", false))
	var suf := RegEx.create_from_string("(?i)^(jr\.?|sr\.?|ii|iii|iv)$")
	while w.size() > 1 and suf.search(w[w.size() - 1]):
		w.pop_back()
	return w[w.size() - 1] if w.size() else str(name)
