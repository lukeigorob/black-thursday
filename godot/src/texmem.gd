# Texture memory tracker and diagnostics.
# Port of src/texmem.gd.

extends RefCounted

static func get_vram_usage() -> float:
	# Returns estimated VRAM usage in MB from the RenderingServer
	return Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0

static func check_budget() -> bool:
	# Returns true if VRAM usage is within safe limits (under 1.5 GB)
	return get_vram_usage() < 1536.0
