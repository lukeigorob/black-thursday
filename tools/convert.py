"""Convert the source aircraft in models-source/ to GLB files in public/models/.

Run with:  npm run convert
(or directly: blender --background --factory-startup --python tools/convert.py)

For every model it: imports, deletes unwanted parts (landing gear), applies modifiers,
links textures to materials by file name, resizes textures to <= 2048 px, flips DirectX
normal maps, scales to real-world metres, turns the nose to -Z (three.js), bakes all
rotations/scales so every node only has a position, and exports a GLB with embedded textures.
A report of every node is written to tools/convert_report.txt.
"""
import bpy, bmesh, os, re
import numpy as np
from math import radians
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "models-source")
OUT = os.path.join(ROOT, "public", "models")
MAX_TEX = 2048

# nose_rot_z: rotation about Blender Z that turns the nose to Blender +Y (= three.js -Z)
# length: real length in metres, measured along the nose axis
# textures: material name -> file-name token in the textures folder
MODELS = {
    "b17": dict(
        src="b17/source/BomberEdited1105.fbx", tex="b17/textures", length=22.7, nose_rot_z=90,
        textures={"MainHull": "MainHull", "RightFrontWing": "FrontWings", "LeftFrontWing": "LeftFrontWing",
                  "RearWings": "RearWings", "Engines": "Engines", "EngineShellWWheels": "EngineShellWWheels",
                  "Guns": "Guns", "BallTurret_WSupport": "BallTurret_WSupport", "Tail_TBTurrets": "Tail_TBTurrets",
                  "Tires_Nav": "Tires_Nav"},
        delete_prefix=["Tire", "Wheel_Support", "RearWheelSupport"],  # main and tail landing gear
        mid_ratio=0.2, lod_ratio=0.012,
        group_props=True, recenter_all=True),  # FBX pivots are far from the geometry
    "bf109": dict(
        src="bf109/source/BF-109_F2_Grounded.fbx", tex="bf109/textures", length=8.94, nose_rot_z=90,
        textures={"BF_109_F2": "BF_109_F2", "Fake_Blades_Mat": "Rotating_Propeller"},
        lod_ratio=0.06,
        glass=["Glass_Mat"],
        delete_vgroups=["Gear_L", "Gear_R"],  # main landing gear is skinned to these bones
        # tail wheel is skinned to the body: drop loose parts centred in this box (source coords)
        delete_parts_in=[((-3.6, -0.12, 1.3), (-3.15, 0.12, 2.0))],
        recenter=["Fake_Blades", "BF109_F2_Blades"],
        # real blades are rigged at 1% size; the blur disc art is ~10% wider than the 3.0 m prop
        resize={"BF109_F2_Blades": 3.0, "Fake_Blades": 3.3}),
    "p51": dict(
        src="p51/source/Sketchfab_2021_04_08_09_06_49.blend", tex="p51/textures", length=9.83, nose_rot_z=180,
        textures={"Main": "Material", "parts": "parts"},
        lod_ratio=0.25,
        delete_prefix=["Gear "],  # gear legs, wheels and doors are separate objects
        recenter=["Nose"]),
}

report = open(os.path.join(HERE, "convert_report.txt"), "w", encoding="utf-8")


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    report.write(s + "\n")
    report.flush()


def fmt(v):
    return "(" + ", ".join(f"{x:7.2f}" for x in v) + ")"


def to_three(v):  # Blender Z-up -> glTF / three.js Y-up
    return Vector((v.x, v.z, -v.y))


# ---------- textures ----------
MAP_KEYS = (("bas", "base"), ("alb", "base"), ("met", "met"), ("rou", "rou"), ("nor", "nor"), ("opa", "opa"))


def find_maps(texdir, token):
    """Files named <anything>_<token>_<Map>.ext or <token>_<Map>.ext -> {map: (path, channel)}."""
    maps = {}
    for f in sorted(os.listdir(texdir)):
        m = re.search(r"(?:^|_)" + re.escape(token) + r"_(.+)$", f)
        if not m:
            continue
        rest = m.group(1).lower()
        ch = re.search(r"@channels=([rgb])", rest)
        if ch:  # Sketchfab-style split maps: metallic in B, roughness in G
            key = {"b": "met", "g": "rou", "r": "occ"}[ch.group(1)]
            maps[key] = (os.path.join(texdir, f), ch.group(1).upper())
            continue
        for prefix, key in MAP_KEYS:
            if rest.startswith(prefix) and key not in maps:
                maps[key] = (os.path.join(texdir, f), None)
    return maps


_images = {}


def load_image(path, non_color, flip_green):
    key = (path, flip_green)
    if key in _images:
        return _images[key]
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    w, h = img.size
    if max(w, h) > MAX_TEX:
        k = MAX_TEX / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
    if flip_green:  # DirectX -> OpenGL normal map
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        px[1::4] = 1.0 - px[1::4]
        img.pixels.foreach_set(px)
        img.update()
    img.name = os.path.splitext(os.path.basename(path))[0][:60]
    log(f"    {os.path.basename(path):62} {w}x{h} -> {img.size[0]}x{img.size[1]}" + ("  (green flipped)" if flip_green else ""))
    _images[key] = img
    return img


def set_blend(mat):
    for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
        try:
            setattr(mat, attr, val)
        except (AttributeError, TypeError):
            pass


def wire(mat, maps):
    """Rebuild the material as a Principled BSDF fed by the given texture maps."""
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    def tex(key, non_color):
        path, ch = maps[key]
        flip = key == "nor" and "directx" in os.path.basename(path).lower()
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = load_image(path, non_color, flip)
        if ch or key == "opa":
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(node.outputs["Color"], sep.inputs["Color"])
            return sep.outputs[{"R": "Red", "G": "Green", "B": "Blue"}[ch or "R"]]
        return node.outputs["Color"]

    if "base" in maps:
        nt.links.new(tex("base", False), bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.6
    if "met" in maps:
        nt.links.new(tex("met", True), bsdf.inputs["Metallic"])
    if "rou" in maps:
        nt.links.new(tex("rou", True), bsdf.inputs["Roughness"])
    if "nor" in maps:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex("nor", True), nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if "opa" in maps:
        nt.links.new(tex("opa", True), bsdf.inputs["Alpha"])
        set_blend(mat)
    return bsdf


def make_glass(mat):
    bsdf = wire(mat, {})
    bsdf.inputs["Base Color"].default_value = (0.55, 0.65, 0.7, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Alpha"].default_value = 0.25
    set_blend(mat)


# ---------- geometry ----------
def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def world_bounds(objs):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def delete_vgroup_verts(o, names):
    idx = {g.index for g in o.vertex_groups if g.name in names}
    if not idx:
        return 0
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if dl and any(i in idx and w > 0.5 for i, w in v[dl].items())]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    return len(kill)


def delete_parts_in(o, boxes):
    """Delete connected pieces of the mesh whose world-space centre lies inside any box."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    seen, kill = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        part, stack = [], [v]
        seen.add(v.index)
        while stack:
            x = stack.pop()
            part.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        pts = [o.matrix_world @ p.co for p in part]
        c = (Vector(map(min, *pts)) + Vector(map(max, *pts))) / 2 if len(pts) > 1 else pts[0]
        if any(all(lo[i] <= c[i] <= hi[i] for i in range(3)) for lo, hi in boxes):
            kill += part
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    return len(kill)


def apply_modifiers():
    dg = bpy.context.evaluated_depsgraph_get()
    baked = [(o, bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)) for o in meshes() if o.modifiers]
    for o, data in baked:
        o.modifiers.clear()
        o.data = data


def remove_armatures():
    for arm in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
        for c in list(arm.children):
            mw = c.matrix_world.copy()
            c.parent = None
            c.matrix_world = mw
        bpy.data.objects.remove(arm, do_unlink=True)
    bpy.context.view_layer.update()


def group_b17_props():
    """Blades are loose objects: put the 3 blades of each engine under one hub empty."""
    blades = [o for o in meshes() if re.fullmatch(r"Propeller\d*", o.name)]
    engines = [o for o in meshes() if o.name.startswith("EngineInside")]
    groups = {e.name: [] for e in engines}
    centre = lambda o: sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8
    for b in blades:
        e = min(engines, key=lambda e: abs(centre(e).y - centre(b).y))
        groups[e.name].append(b)
    hubs = []
    for blist in groups.values():
        hub = bpy.data.objects.new("Prop", None)
        bpy.context.scene.collection.objects.link(hub)
        hub.location = sum((centre(b) for b in blist), Vector()) / len(blist)
        bpy.context.view_layer.update()
        for b in blist:
            mw = b.matrix_world.copy()
            b.parent = hub
            b.matrix_parent_inverse = hub.matrix_world.inverted()
            b.matrix_world = mw
        hubs.append(hub)
    bpy.context.view_layer.update()
    return hubs


def bake(G, recenter, recenter_all=False, resize={}):
    """Bake G @ world into the mesh data so every node ends up with position only.
    recenter / recenter_all move pivots to the middle of the geometry; resize scales a part
    (about its centre) so its largest side is the given number of metres."""
    objs = list(bpy.context.scene.objects)
    W = {o: G @ o.matrix_world for o in objs}
    loc = {}
    for o in objs:
        M = W[o]
        p = M.translation.copy()
        if o.type == "MESH":
            if o.data.users > 1:
                o.data = o.data.copy()
            m3 = M.to_3x3()
            o.data.transform(m3.to_4x4())
            if m3.determinant() < 0:  # mirrored part: keep faces pointing outwards
                bm = bmesh.new()
                bm.from_mesh(o.data)
                bmesh.ops.reverse_faces(bm, faces=bm.faces)
                bm.to_mesh(o.data)
                bm.free()
            vs = [v.co for v in o.data.vertices]
            if (recenter_all or o.name in recenter) and len(vs) > 1:  # pivot at the middle of the part
                lo, hi = Vector(map(min, *vs)), Vector(map(max, *vs))
                c = (lo + hi) / 2
                o.data.transform(Matrix.Translation(-c))
                p += c
                if o.name in resize:
                    o.data.transform(Matrix.Scale(resize[o.name] / max(hi - lo), 4))
        loc[o] = p
    if recenter_all:  # group nodes sit at the middle of their children, deepest groups first
        def depth(o):
            return 0 if not o.parent else 1 + depth(o.parent)
        for o in sorted((o for o in objs if o.type == "EMPTY" and o.children), key=depth, reverse=True):
            loc[o] = sum((loc[c] for c in o.children), Vector()) / len(o.children)
    for o in objs:
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = Matrix.Translation(loc[o] - (loc[o.parent] if o.parent else Vector()))
    bpy.context.view_layer.update()


def export(path):
    kw = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_cameras=False,
              export_lights=False, export_animations=False, export_skins=False, export_image_format="WEBP")
    try:
        bpy.ops.export_scene.gltf(**kw, export_image_quality=88)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def print_nodes():
    def walk(o, depth):
        line = f"  {'  ' * depth}{o.name:{40 - 2 * depth}} {o.type:6} pos={fmt(to_three(o.matrix_world.translation))}"
        if o.type == "MESH" and len(o.data.vertices):
            lo, hi = world_bounds([o])
            size = to_three(hi - lo)
            line += f" size={fmt(Vector(map(abs, size)))} verts={len(o.data.vertices)}"
        log(line)
        for c in sorted(o.children, key=lambda c: c.name):
            walk(c, depth + 1)
    for o in sorted((o for o in bpy.context.scene.objects if not o.parent), key=lambda o: o.name):
        walk(o, 0)


# ---------- main ----------
def convert(key, cfg):
    log(f"\n==================== {key} ====================")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _images.clear()
    src = os.path.join(SRC, cfg["src"])
    if src.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=src)
    else:
        bpy.ops.wm.open_mainfile(filepath=src)
    scene = bpy.context.scene

    for o in list(scene.objects):
        if o.type in ("CAMERA", "LIGHT") or any(o.name.startswith(p) for p in cfg.get("delete_prefix", ())):
            log("  removed object", o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes():
        n = delete_vgroup_verts(o, cfg.get("delete_vgroups", ()))
        if n:
            log(f"  removed {n} landing-gear vertices from {o.name} (vertex groups {cfg['delete_vgroups']})")
        if cfg.get("delete_parts_in"):
            n = delete_parts_in(o, cfg["delete_parts_in"])
            if n:
                log(f"  removed {n} tail-wheel vertices from {o.name}")
    apply_modifiers()
    remove_armatures()
    hubs = group_b17_props() if cfg.get("group_props") else []

    log("  textures:")
    texdir = os.path.join(SRC, cfg["tex"])
    for mat in bpy.data.materials:
        if mat.name in cfg.get("glass", ()):
            make_glass(mat)
            log(f"  material {mat.name}: glass")
        elif mat.name in cfg["textures"]:
            maps = find_maps(texdir, cfg["textures"][mat.name])
            wire(mat, maps)
            log(f"  material {mat.name}: {sorted(maps)}")
        elif mat.users:
            log(f"  material {mat.name}: NO TEXTURES FOUND (left as is)")

    lo, hi = world_bounds(meshes())
    rot = Matrix.Rotation(radians(cfg["nose_rot_z"]), 4, "Z")
    raw = rot.to_3x3() @ (hi - lo)
    s = cfg["length"] / abs(raw.y)
    G = Matrix.Scale(s, 4) @ rot @ Matrix.Translation(-(lo + hi) / 2)
    bake(G, set(cfg.get("recenter", ())), cfg.get("recenter_all", False), cfg.get("resize", {}))

    # name the B-17 propeller hubs left to right as seen from the pilot's seat
    for i, h in enumerate(sorted(hubs, key=lambda h: h.matrix_world.translation.x)):
        h.name = f"Prop_{i + 1}"

    lo, hi = world_bounds(meshes())
    size = to_three(hi - lo)
    log(f"  scale x{s:.3f}  ->  span {abs(size.x):.2f} m, height {abs(size.y):.2f} m, length {abs(size.z):.2f} m (nose towards -Z)")
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{key}.glb")
    export(path)
    log(f"  wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1e6:.1f} MB)")
    log("  nodes (three.js coordinates, metres):")
    print_nodes()
    export_lod(key, cfg)


def export_lod(key, cfg):
    """Lower-detail copies: <key>_mid.glb (if cfg has mid_ratio) for nearby wingmen and
    <key>_lod.glb for planes far away. Decimated meshes and smaller textures."""
    levels = ([("mid", cfg["mid_ratio"], 1024)] if "mid_ratio" in cfg else []) + [("lod", cfg["lod_ratio"], 512)]
    tris0 = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes())
    for o in meshes():
        if len(o.data.polygons) > 24:
            o.modifiers.new("lod", "DECIMATE").use_collapse_triangulate = True
    for suffix, ratio, tex in levels:
        for o in meshes():
            if "lod" in o.modifiers:
                o.modifiers["lod"].ratio = ratio
        dg = bpy.context.evaluated_depsgraph_get()
        tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).data.polygons) for o in meshes())
        for img in bpy.data.images:
            w, h = img.size
            if max(w, h) > tex:
                k = tex / max(w, h)
                img.scale(max(1, round(w * k)), max(1, round(h * k)))
        path = os.path.join(OUT, f"{key}_{suffix}.glb")
        export(path)
        log(f"  wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1e6:.1f} MB, {tris0} -> {tris} triangles)")


for k, c in MODELS.items():
    convert(k, c)
report.close()
