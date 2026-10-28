import bpy, traceback, math, sys
OUT = r"C:/Users/Garre/AppData/Local/Temp/claude/C--Users-Garre-Documents-bomber-game/45934ce7-c6da-4aec-b6d4-5e94c7f7ac7d/scratchpad/blend"
log = open(OUT + "/build_base.log", "w")
def p(*a): log.write(" ".join(str(x) for x in a) + "\n"); log.flush()
try:
    import addon_utils
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    # (the Store install's sandbox: MPFB resolves its own folder to the real LocalCache path, which the app
    # can't open from inside; point it back at the path the app sees)
    import os
    from pathlib import Path
    from bl_ext.user_default.mpfb.services.locationservice import LocationService
    root = Path(os.path.join(os.environ["APPDATA"], "Blender Foundation", "Blender", "4.5", "extensions", "user_default", "mpfb"))
    LocationService._mpfb_root = root; LocationService._mpfb_data = os.path.join(str(root), "data")
    p("data", LocationService._mpfb_data, os.path.exists(LocationService._mpfb_data))
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    info = HumanService._create_default_human_info_dict()
    info["phenotype"] = {"gender": 1.0, "age": 0.42, "muscle": 0.55, "weight": 0.45, "proportions": 0.65, "height": 0.5, "cupsize": 0.5, "firmness": 0.5,
                         "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0}}
    info["rig"] = "game_engine"
    info["eyes"] = "low-poly/low-poly.mhclo"
    info["eyebrows"] = "eyebrow001/eyebrow001.mhclo"
    info["eyelashes"] = "eyelashes01/eyelashes01.mhclo"
    info["hair"] = "short02/short02.mhclo"  # (a short back and sides: it shows under the pilots' caps)
    info["skin_mhmat"] = "young_caucasian_male/young_caucasian_male.mhmat"
    info["skin_material_type"] = "MAKESKIN"
    info["clothes"] = ["male_worksuit01/male_worksuit01.mhclo"]
    s = HumanService.get_default_deserialization_settings(); s["subdiv_levels"] = 0
    body = HumanService.deserialize_from_dict(info, s)
    p("body", body.name, len(body.data.vertices))
    for o in bpy.data.objects: p("obj", o.name, o.type, len(o.data.vertices) if o.type == 'MESH' else '', [m.name for m in o.material_slots] if o.type == 'MESH' else '')
    bpy.ops.wm.save_as_mainfile(filepath=OUT + "/base.blend")
    # a preview: front and back, a key light and a fill
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try: sc.render.engine = eng; break
        except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = 900, 1200
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    for nm, rot, loc, e in (("key", (0.9, 0.2, 0.6), (3, -4, 4), 900), ("fill", (1.2, 0, -2.4), (-4, 3, 3), 400)):
        L = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'AREA')); L.data.energy = e; L.data.size = 3; L.location = loc; sc.collection.objects.link(L)
        L.rotation_euler = rot
        c = L.constraints.new('TRACK_TO'); c.target = body; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
    sc.world = sc.world or bpy.data.worlds.new("w"); sc.world.color = (0.35, 0.38, 0.42)
    tgt = bpy.data.objects.new("tgt", None); tgt.location = (0, 0, 1.0); sc.collection.objects.link(tgt)
    tc = cam.constraints.new('TRACK_TO'); tc.target = tgt; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
    for nm, loc in (("front", (0, -4.6, 1.2)), ("back", (0, 4.6, 1.2)), ("face", (0.25, -1.1, 1.62))):
        cam.location = loc
        tgt.location = (0, 0, 1.6 if nm == "face" else 0.95)
        sc.render.filepath = OUT + f"/base_{nm}.png"
        bpy.ops.render.render(write_still=True)
        p("rendered", nm)
except Exception:
    p(traceback.format_exc())
log.close()
