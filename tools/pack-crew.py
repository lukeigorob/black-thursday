# Pack Quaternius' Superhero_Male_FullBody.gltf (+ .bin + textures) into one GLB for the game:
# textures shrunk to 1024 (JPEG for colour, PNG for normals), the hair textures dropped, and the
# light skin texture added as an extra image (the game swaps it in for some of the crew).
import json, struct, io, sys, os
from PIL import Image

SRC = sys.argv[1]  # the "Godot - UE" folder
TEX = sys.argv[2]  # the "Textures" folder (has the light skin)
OUT = sys.argv[3]
j = json.load(open(os.path.join(SRC, 'Superhero_Male_FullBody.gltf')))
binary = bytearray(open(os.path.join(SRC, j['buffers'][0]['uri']), 'rb').read())

def pad(b):
    while len(b) % 4: b.append(0)

def add_image_bytes(data, mime):
    pad(binary)
    off = len(binary)
    binary.extend(data)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    return len(j['bufferViews']) - 1

def encode(path, size, fmt):
    if not os.path.exists(path):  # (a few files are named differently in the pack)
        alt = [os.path.join(d, os.path.basename(path).replace('_png.png', '.png')) for d in (SRC, TEX)]
        path = next((a for a in alt if os.path.exists(a)), None)
        if path is None: return encode_flat(fmt)
    im = Image.open(path)
    im = im.convert('RGB') if fmt == 'JPEG' else im.convert('RGBA' if im.mode in ('RGBA', 'LA') else 'RGB')
    if im.size[0] > size: im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, fmt, **({'quality': 85} if fmt == 'JPEG' else {'optimize': True}))
    return buf.getvalue()

def encode_flat(fmt):
    buf = io.BytesIO(); Image.new('RGB', (4, 4), (128, 128, 255)).save(buf, fmt); return buf.getvalue()

for img in j['images']:
    uri = img.pop('uri')
    name = uri.lower()
    if 'normal' in name:
        data, mime = encode(os.path.join(SRC, uri), 1024, 'JPEG'), 'image/jpeg'
    elif 'eye' in name or 'hair' in name:
        data, mime = encode(os.path.join(SRC, uri), 256, 'PNG'), 'image/png'
    else:
        data, mime = encode(os.path.join(SRC, uri), 1024, 'JPEG'), 'image/jpeg'
    img['bufferView'] = add_image_bytes(data, mime)
    img['mimeType'] = mime
    img['name'] = os.path.splitext(uri)[0]
# the light skin, as an extra (unused by the materials; the game picks it up by name)
light = add_image_bytes(encode(os.path.join(TEX, 'T_Superhero_Male_Ligh.png'), 1024, 'JPEG'), 'image/jpeg')
j['images'].append({'bufferView': light, 'mimeType': 'image/jpeg', 'name': 'T_Superhero_Male_Light'})
j['textures'].append({'source': len(j['images']) - 1})
j.setdefault('extras', {})['lightSkinTexture'] = len(j['textures']) - 1
pad(binary)
j['buffers'] = [{'byteLength': len(binary)}]
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
total = 12 + 8 + len(js) + 8 + len(binary)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(binary), 0x004E4942)); f.write(binary)
print(OUT, total // 1024, 'KB')
