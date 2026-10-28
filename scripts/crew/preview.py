# Preview renders of the crewman: front, back, three-quarter and face, under a key and a fill light.
import bpy, os
from mathutils import Vector

def render(out, tag, body, views=(('front', (0, -3.6, 1.1), 0.9), ('back', (0, 3.6, 1.1), 0.9), ('three', (2.4, -2.6, 1.3), 0.95), ('face', (0.35, -0.95, 1.6), 1.5))):
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try: sc.render.engine = eng; break
        except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = 800, 1000
    if not sc.camera:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam = sc.camera; cam.data.lens = 55
    tgt = bpy.data.objects.get('tgt') or bpy.data.objects.new('tgt', None)
    if tgt.name not in sc.collection.objects: sc.collection.objects.link(tgt)
    if not cam.constraints:
        c = cam.constraints.new('TRACK_TO'); c.target = tgt; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
    if not bpy.data.objects.get('key'):
        for nm, loc, e in (('key', (2.5, -3.5, 3.5), 700), ('fill', (-3.5, -1.5, 2.0), 250), ('rimlight', (0, 4, 3), 450)):
            Lt = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'AREA')); Lt.data.energy = e; Lt.data.size = 2.5; Lt.location = loc; sc.collection.objects.link(Lt)
            c = Lt.constraints.new('TRACK_TO'); c.target = tgt; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.use_nodes = False; sc.world.color = (0.32, 0.35, 0.4)
    for name, loc, look in views:
        cam.location = loc; tgt.location = (0, 0, look)
        sc.render.filepath = os.path.join(out, f'{tag}_{name}.png')
        bpy.ops.render.render(write_still=True)
