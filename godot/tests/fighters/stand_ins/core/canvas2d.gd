extends RefCounted
# Stand-in for src/core/canvas2d.gd (the fighters' test only): rectangles but no text, as a texture.
var img: Image
var fill_style = "#000"
var text_align = "left"
var text_baseline = "alphabetic"
var font = ""
func _init(w: int, h: int) -> void:
	img = Image.create(w, h, false, Image.FORMAT_RGBA8)
func fill_rect(x, y, w, h) -> void:
	img.fill_rect(Rect2i(x, y, w, h), Color.from_string(fill_style, Color.BLACK))
func fill_text(_t, _x, _y, _mw = null) -> void: pass
func texture() -> Texture2D:
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)
