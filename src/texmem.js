// A canvas painted once and made a texture keeps its own copy of every pixel in the page's memory after the
// texture is on the graphics card (the villages' 4096 atlas alone is 64 MB, the town's maps more). Three only
// reads the canvas again if the texture changes (needsUpdate), which these never do; and a lost graphics
// context reloads the page (main.js). So once it's uploaded, the canvas is shrunk to nothing.
export function freeAfterUpload(tex) {
  tex.onUpdate = () => {
    const c = tex.image;
    if (c && 'width' in c && c.getContext) c.width = c.height = 1;
    tex.onUpdate = null;
  };
  return tex;
}
