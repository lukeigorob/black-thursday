# Renders of the crewman's torso and arms for review, from crew_stage1.blend: each jacket (the gunners'
# B-3 with the Mae West, harness and flak vest; the pilots' A-2; the B-10) from the front, three-quarter,
# side, back and close on the shoulder and sleeve. blender -b crew_stage1.blend --python torso_views.py -- <out dir>
import bpy, sys, os, importlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import preview; importlib.reload(preview)
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else HERE
body = bpy.data.objects['Human']
sets = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and 'set' in o: sets.setdefault(o['set'], []).append(o)
T = 1.25  # (about his chest)
VIEWS = (('front', (0, -1.55, T + 0.05), T), ('three', (1.1, -1.1, T + 0.1), T), ('side', (1.55, 0.0, T + 0.05), T),
         ('back', (0.3, 1.55, T + 0.1), T), ('sleeve', (0.75, -0.55, T + 0.05), T - 0.05))
for tag, wear in (('b3', ('b3', 'a3', 'maewest', 'harness', 'gloves')), ('pilot', ('b3', 'od', 'maewest', 'harness', 'gloves')), ('b10', ('b10', 'od', 'maewest', 'harness', 'gloves'))):
    head = ('cap', 'headset') if tag == 'pilot' else ('helmet', 'goggles', 'goggle_lens')
    for k, obs in sets.items():
        vis = k in wear or k in head or k == 'mask'
        for o in obs: o.hide_render = not vis
    for o in bpy.data.objects:
        if 'short' in o.name: o.hide_render = tag != 'pilot'
    preview.render(OUT, 'torso_' + tag, body, views=VIEWS)
