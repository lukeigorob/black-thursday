# Memory management for Godot textures and resources.
# Port of src/memguard.js: keeps memory footprint under control by tracking
# dynamic texture allocations and purging unused audio/mesh caches.

extends RefCounted

static var max_texture_mem_mb := 512.0
static var tracked_textures: Array = []

static func guard_texture(tex: Texture2D) -> Texture2D:
	if tex != null and not tracked_textures.has(tex):
		tracked_textures.append(tex)
	return tex

static func purge_unused() -> void:
	# Let Godot's resource garbage collection reclaim unreferenced resources.
	var to_remove := []
	for i in range(tracked_textures.size() - 1, -1, -1):
		var ref = tracked_textures[i]
		if ref == null or not is_instance_valid(ref):
			to_remove.append(i)
	for idx in to_remove:
		tracked_textures.remove_at(idx)

static func get_tracked_count() -> int:
	return tracked_textures.size()
