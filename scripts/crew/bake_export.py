# From crew_stage1.blend (build_crew.py): each set of gear joined into one mesh, weighted to the skeleton,
# its procedural materials baked to images (colour, roughness, normal), the body trimmed to what shows
# (the face in the helmet's opening), the head bone named as the game has it, and the lot exported as one
# GLB. blender -b crew_stage1.blend --python bake_export.py -- <out.glb> <texture size>
import bpy, sys, os, traceback, importlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import crewlib as L; importlib.reload(L)
args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]; SIZE = int(args[1]) if len(args) > 1 else 1024
L.LOG = open(os.path.join(HERE, 'bake_export.log'), 'w'); log = L.log

RIGID = {'helmet': 'head', 'goggles': 'head', 'cap': 'head', 'headset': 'head'}
BIG = {'b3', 'b10', 'a2', 'f1', 'a3', 'od', 'boots'}
CAP = {'b3': 22000, 'b10': 20000, 'a2': 20000, 'f1': 24000}  # vertices kept per set (12000 for the rest): ten men skinned at once

def decimate(ob, cap):
    n = len(ob.data.vertices)
    if n <= cap: return
    m = ob.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = cap / n
    L.apply_mods(ob)

def bake(ob, size):
    """Colour, roughness and normal baked from its materials into images on a fresh UV layout; one material."""
    me = ob.data
    L.active(ob)
    uv = me.uv_layers.new(name='bake'); me.uv_layers.active = uv
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.006, area_weight=0.6)
    bpy.ops.object.mode_set(mode='OBJECT')
    imgs = {}
    for kind, cs in (('col', 'sRGB'), ('rough', 'Non-Color'), ('nrm', 'Non-Color')):
        im = bpy.data.images.new(f'{ob.name}_{kind}', size, size, alpha=False)
        im.colorspace_settings.name = cs
        imgs[kind] = im
    for kind, btype in (('col', 'DIFFUSE'), ('rough', 'ROUGHNESS'), ('nrm', 'NORMAL')):
        for m in me.materials:
            nt = m.node_tree
            n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'
            n.image = imgs[kind]; nt.nodes.active = n
        sc = bpy.context.scene
        sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
        sc.render.bake.margin = 8
        bpy.ops.object.bake(type=btype, uv_layer='bake')
    for kind, im in imgs.items():
        im.filepath_raw = os.path.join(HERE, 'tex', f'{im.name}.png'); im.file_format = 'PNG'; im.save()
    # the one material the game gets
    mat = bpy.data.materials.new(ob.name + '_mat'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    def tex(im):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; return t
    nt.links.new(tex(imgs['col']).outputs[0], bsdf.inputs['Base Color'])
    nt.links.new(tex(imgs['rough']).outputs[0], bsdf.inputs['Roughness'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tex(imgs['nrm']).outputs[0], nm.inputs['Color']); nt.links.new(nm.outputs[0], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = 0.0
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons: p.material_index = 0
    # (by name, one at a time: a layer reference goes stale when another is removed, and touching it crashes Blender)
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(next(u for u in me.uv_layers if u.name != 'bake'))
    me.uv_layers['bake'].name = 'UVMap'

ARM = ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
def torso_only(ob):
    """Kit worn on the chest (harness, Mae West, flak vest) moves with the body, never with the arm: near the
    armpit its nearest skin is on the upper arm, and as he raised his arms to a gun those weights pulled
    the straps and panels out into a sheet over the arm. The arm's share goes to the spine and clavicle."""
    arm = {g.index for g in ob.vertex_groups if g.name.startswith(ARM)}
    if not arm: return
    sp = ob.vertex_groups.get('spine_03') or ob.vertex_groups.new(name='spine_03')
    for v in ob.data.vertices:
        lost = sum(g.weight for g in v.groups if g.group in arm)
        if lost <= 0: continue
        for g in list(v.groups):
            if g.group in arm: ob.vertex_groups[g.group].remove([v.index])
        side = 'l' if v.co.x > 0 else 'r'
        cl = ob.vertex_groups.get(f'clavicle_{side}') or ob.vertex_groups.new(name=f'clavicle_{side}')
        cl.add([v.index], lost * 0.5, 'ADD'); sp.add([v.index], lost * 0.5, 'ADD')

def seat_weights(ob):
    """The seat of the trousers moves with the pelvis, not split between the thighs (it bridges the cleft:
    weighted from the nearest thigh, it would open up again as he bends his hips); then all the weights
    smoothed a little, so the cloth stretches rather than creases."""
    P = L.BONES['pelvis'][0]
    pel = ob.vertex_groups.get('pelvis') or ob.vertex_groups.new(name='pelvis')
    for v in ob.data.vertices:
        if v.co.y <= P.y or not (P.z - 0.17 < v.co.z < P.z + 0.06): continue
        k = max(0.0, 1 - abs(v.co.x) / 0.09) * min(1.0, (v.co.z - (P.z - 0.17)) / 0.05)
        if k <= 0: continue
        for g in v.groups:
            if g.group != pel.index: ob.vertex_groups[g.group].add([v.index], g.weight * (1 - k), 'REPLACE')
        cur = next((g.weight for g in v.groups if g.group == pel.index), 0.0)
        pel.add([v.index], cur * (1 - k) + k, 'REPLACE')
    # (smoothed by hand round the seat and hips: the operator wants an interactive mode)
    me = ob.data
    near = [v.index for v in me.vertices if v.co.y > P.y - 0.05 and P.z - 0.25 < v.co.z < P.z + 0.1]
    nb = {i: [] for i in near}
    for e in me.edges:
        a, b = e.vertices
        if a in nb: nb[a].append(b)
        if b in nb: nb[b].append(a)
    W = {v.index: {g.group: g.weight for g in v.groups} for v in me.vertices}
    for _ in range(6):
        new = {}
        for i in near:
            acc = {g: w * 0.5 for g, w in W[i].items()}
            for j in nb[i]:
                for g, w in W[j].items(): acc[g] = acc.get(g, 0) + w * 0.5 / max(1, len(nb[i]))
            top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]; tot = sum(w for _, w in top) or 1
            new[i] = {g: w / tot for g, w in top}
        W.update(new)
    for i in near:
        for g in list(me.vertices[i].groups): ob.vertex_groups[g.group].remove([i])
        for g, w in W[i].items(): ob.vertex_groups[g].add([i], w, 'REPLACE')

def simple_material(ob, alpha=False):
    """The MPFB material swapped for a plain Principled with its own diffuse image (what glTF can carry)."""
    for slot in ob.material_slots:
        m = slot.material
        if not m or not m.use_nodes: continue
        img = next((n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'diffuse' in n.image.name.lower()), None) \
            or next((n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
        new = bpy.data.materials.new(m.name + '_gl'); new.use_nodes = True
        nt = new.node_tree; bsdf = nt.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.55
        if img:
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
            nt.links.new(t.outputs[0], bsdf.inputs['Base Color'])
            if alpha: nt.links.new(t.outputs[1], bsdf.inputs['Alpha']); new.blend_method = 'HASHED' if hasattr(new, 'blend_method') else None
        slot.material = new

try:
    os.makedirs(os.path.join(HERE, 'tex'), exist_ok=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 4; sc.cycles.device = 'CPU'
    body = bpy.data.objects['Human']; rig = bpy.data.objects['Human.rig']
    L.BONES = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    sets = {}
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and 'set' in o: sets.setdefault(o['set'], []).append(o)
    for k, obs in sets.items():
        for o in obs: o.hide_render = False; o.hide_set(False)
        j = L.join('gear_' + k, obs) if len(obs) > 1 else obs[0]
        j.name = 'gear_' + k
        decimate(j, CAP.get(k, 12000))
        log('set', k, len(j.data.vertices), 'verts')
        bake(j, SIZE if k in BIG else SIZE // 2)
        if k in RIGID: L.rigid_to(j, rig, RIGID[k])
        else: L.skin_to(j, body, rig)
        if k in ('a3', 'od', 'f1'): seat_weights(j)
        if k in ('harness', 'maewest', 'flak'): torso_only(j)
        log('baked and skinned', k)
    # the body: only the head and neck (everything else is always under clothes, gloves or boots)
    import bmesh
    dom = L.dominant(body)
    bm = bmesh.new(); bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all((dom[v.index] or '').startswith(('head', 'neck')) for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data); bm.free()
    # and the face under the mask: a ray from each corner forward meets the mask within a few cm (so his
    # nose and lips never show through it)
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    mk = bpy.data.objects['gear_mask']
    tree = BVHTree.FromObject(mk, bpy.context.evaluated_depsgraph_get(), deform=False)
    under = set()
    for v in body.data.vertices:
        hit = tree.ray_cast(v.co, Vector((0, -1, 0)), 0.06)
        if hit[0] is not None: under.add(v.index)
    bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
    gone = [f for f in bm.faces if all(v.index in under for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data); bm.free()
    log('face under the mask removed:', len(gone), 'faces')
    simple_material(body)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent in (rig, body) and o is not body and not o.name.startswith('gear_'):
            simple_material(o, alpha=('eyebrow' in o.name or 'eyelash' in o.name or 'short' in o.name))
    rig.data.bones['head'].name = 'Head'  # (as the game's skeleton has it)
    # export: the rig and every mesh on it
    for o in bpy.data.objects: o.select_set(False)
    keep = [rig] + [o for o in bpy.data.objects if o.type == 'MESH' and o.parent in (rig, body)] + [body]
    keep = list(dict.fromkeys(keep))
    for o in keep: o.select_set(True); o.hide_set(False)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
                              export_yup=True, export_apply=False, export_image_format='JPEG', export_texcoords=True, export_normals=True)
    log('exported', OUT, [o.name for o in keep])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'crew_final.blend'))
except Exception:
    log(traceback.format_exc())
L.LOG.close()
