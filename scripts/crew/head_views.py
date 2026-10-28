# Close renders of the crewman's head for review, from crew_stage1.blend: the gunners' B-6 helmet and
# goggles, and the pilots' crushed cap and headset, each from the front, three-quarter, side, back and above.
# blender -b crew_stage1.blend --python head_views.py -- <out dir>
import bpy, sys, os, importlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import preview; importlib.reload(preview)
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else HERE
body = bpy.data.objects['Human']
sets = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and 'set' in o: sets.setdefault(o['set'], []).append(o)
H = 1.53  # (about his eyes)
VIEWS = (('front', (0, -0.75, H + 0.04), H), ('three', (0.55, -0.55, H + 0.06), H), ('side', (0.78, 0.0, H + 0.03), H),
         ('back', (0.25, 0.75, H + 0.08), H), ('above', (0.35, -0.5, H + 0.45), H + 0.03))
for tag, head, jacket in (('helmet', ('helmet', 'goggles', 'goggle_lens'), ('b3', 'a3', 'flak')), ('cap', ('cap', 'headset'), ('a2', 'od'))):
    for k, obs in sets.items():
        vis = k in head or k in jacket or k in ('mask', 'maewest', 'harness')
        for o in obs: o.hide_render = not vis
    for o in bpy.data.objects:
        if 'short' in o.name: o.hide_render = tag != 'cap'
    preview.render(OUT, 'head_' + tag, body, views=VIEWS)
