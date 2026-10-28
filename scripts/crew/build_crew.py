# The B-17 crewman of 14 October 1943, built on the MPFB body (base.blend): each garment of the research's
# station table (hackathon/CREW_GEAR_RESEARCH.md) modelled on him and weighted to his skeleton.
# blender -b base.blend --python build_crew.py -- <out dir> [preview]
import bpy, sys, os, math, traceback, importlib
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import crewlib as L, crewmats as M
importlib.reload(L); importlib.reload(M)
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else HERE
PREVIEW = 'preview' in args
L.LOG = open(os.path.join(OUT, 'build_crew.log'), 'w')
log = L.log
V = Vector

def run():
    body = bpy.data.objects['Human']; rig = bpy.data.objects['Human.rig']
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o is not body and 'worksuit' in o.name: bpy.data.objects.remove(o)
    # landmarks from the helper joints (before the helpers go)
    J = {n: L.group_centre(body, n) for n in ['joint-l-eye', 'joint-r-eye', 'joint-mouth', 'joint-jaw', 'joint-head-2', 'joint-neck', 'ears', 'joint-l-elbow', 'joint-r-elbow', 'joint-l-knee', 'joint-r-knee', 'joint-l-hand', 'joint-r-hand', 'joint-l-ankle', 'joint-r-ankle']}
    log('landmarks', {k: tuple(round(x, 3) for x in v) for k, v in J.items() if v})
    L.prepare_body(body, rig)
    B = L.BONES
    mats = M.all_materials()
    eye = (J['joint-l-eye'] + J['joint-r-eye']) / 2
    mouth, jaw = J['joint-mouth'], J['joint-jaw']
    head = B['head'][0]; neck = B['neck_01'][0]
    top = max(v.co.z for v in body.data.vertices)
    front = min(v.co.y for v in body.data.vertices if v.co.z > eye.z - 0.02)  # (the nose tip)
    log('eye', eye, 'mouth', mouth, 'jaw', jaw, 'top', top, 'front', front)
    hand = {s: B[f'hand_{s}'][0] for s in 'lr'}; elbow = {s: B[f'lowerarm_{s}'][0] for s in 'lr'}; knee = {s: B[f'calf_{s}'][0] for s in 'lr'}
    WAIST = B['pelvis'][0].z + 0.075                     # the jackets end at the waist
    BOOT = 0.27                                          # the A-6's top
    side = lambda bone: (bone or '')[-1:]

    def folds(ob, centres, axis_of, amp=0.0045, freq=95, reach=0.09):
        """Compression folds round a joint: rings of ridges across the limb, fading out from the joint."""
        for v in ob.data.vertices:
            for c, ax in ((c, axis_of(c)) for c in centres):
                d = (v.co - c).length
                if d > reach: continue
                along = (v.co - c).dot(ax)
                k = (1 - d / reach) ** 2
                v.co += v.normal * (math.sin(along * freq + v.co.x * 30) * amp * k)

    out = {}
    # ---------------- jackets: B-3 (sheepskin), B-10 (olive cotton), A-2 (horsehide); and the F-1 suit
    def jacket_keep(co, bone, neck_cut=0.0):
        if bone is None: return False
        if bone.startswith(('hand', 'thumb', 'index', 'middle', 'ring', 'pinky', 'head', 'thigh', 'calf', 'foot', 'ball')): return False
        if bone.startswith('lowerarm') and (co - hand[side(bone)]).length < 0.045: return False
        if co.z < WAIST: return False
        frontness = max(0, -(co.y - neck.y)) * 0.6
        if bone.startswith('neck') and co.z > neck.z + 0.012 - frontness - neck_cut: return False
        return True
    def jacket(name, mat, thick, cuff_mat, collar_mat, collar_w, collar_h, cuff_w, hem_w, knit=False):
        j = L.shell(body, name, jacket_keep, thick, smooth=14, lam=0.6, subdiv=1)
        folds(j, [elbow['l'], elbow['r']], lambda c: (hand['l' if c.x > 0 else 'r'] - c).normalized(), amp=0.006, freq=110, reach=0.11)
        folds(j, [V((0, B['spine_01'][0].y - 0.12, WAIST + 0.08))], lambda c: V((0, 0, 1)), amp=0.003, freq=140, reach=0.16)
        j.data.materials.append(mat)
        parts = [j]
        # the collar: a shawl of fleece lying round the neckline over the shoulders and the top of the chest,
        # its edge rolled; a smaller roll standing round the neck itself
        nl = L.loop_near(j, neck)
        if nl:
            ring = L.resample(nl, 64)
            near = lambda co: min((co - p).length for p in ring)
            sh = L.patch(j, name + '_collar', lambda co: near(co) < collar_w, 0.006, 0, collar_mat)
            ol = max(L.boundary_loops(sh), key=lambda l: sum((q - V((neck.x, neck.y, q.z))).length for q in l) / len(l))
            m = sh.modifiers.new('sol', 'SOLIDIFY'); m.thickness = collar_h; m.offset = 1; m.use_rim = True; L.apply_mods(sh)
            parts.append(sh)
            rl = L.tube(name + '_collar_roll', L.resample(ol, 72), 0.012, 0.012); rl.data.materials.append(collar_mat); parts.append(rl)
            nr = L.tube(name + '_neck_roll', [p + V((0, 0, 0.008)) for p in ring], 0.016, 0.02); nr.data.materials.append(collar_mat); parts.append(nr)
        # the cuffs and the hem
        if knit:
            band = L.shell(body, name + '_cuffs', lambda co, bone: bone is not None and bone.startswith('lowerarm') and 0.045 < (co - hand[side(bone)]).length < 0.1, thick + 0.006, smooth=6, subdiv=1)
            band.data.materials.append(cuff_mat); parts.append(band)
            hb = L.shell(body, name + '_waistband', lambda co, bone: bone is not None and not bone.startswith(('upperarm', 'lowerarm', 'hand', 'neck', 'head', 'thumb', 'index', 'middle', 'ring', 'pinky')) and WAIST < co.z < WAIST + 0.065, thick + 0.006, smooth=10, subdiv=1)
            hb.data.materials.append(cuff_mat); parts.append(hb)
        else:
            for s in 'lr':
                cl = L.loop_near(j, hand[s])
                if cl:
                    cu = L.tube(f'{name}_cuff_{s}', L.resample(cl, 28), cuff_w, cuff_w)
                    cu.data.materials.append(cuff_mat); parts.append(cu)
            hl = L.loop_near(j, V((0, 0, WAIST)))
            if hl:
                hm = L.tube(name + '_hem', L.resample(hl, 72), hem_w, hem_w)
                hm.data.materials.append(cuff_mat); parts.append(hm)
        # the zip up the front: a strip of teeth from hem to collar, and its pull
        zp = [V((0, -0.3, z)) for z in [WAIST + 0.01 + i * (neck.z - 0.04 - WAIST) / 10 for i in range(11)]]
        zp = L.onto(j, zp, 0.003)
        z = L.tube(name + '_zip', zp, 0.007, 0.0025, closed=False, rect=True); z.data.materials.append(mats['metal']); parts.append(z)
        # the seams: shoulder and down the sleeves, stitched leather welts
        return parts
    def pockets(j, mat, at_list, w=0.07, h=0.085):
        """Patch pockets on the jacket's front, a buttoned flap over each."""
        out = []
        for (x, z) in at_list:
            out.append(L.patch(j, 'pocket', lambda co, x=x, z=z: abs(co.x - x) < w and abs(co.z - z) < h and co.y < -0.02, 0.003, 0.003, mat))
            out.append(L.patch(j, 'flap', lambda co, x=x, z=z: abs(co.x - x) < w + 0.005 and h - 0.035 < co.z - z < h + 0.008 and co.y < -0.02, 0.008, 0.004, mat))
        return out

    b3 = jacket('B3', mats['b3'], 0.024, mats['sheep'], mats['sheep'], 0.085, 0.02, 0.02, 0.022)
    b3 += pockets(b3[0], mats['b3'], [(0.11, WAIST + 0.12), (-0.11, WAIST + 0.12)])
    out['b3'] = b3
    # ---------------- trousers: A-3 sheepskin (the waist and tail gunners), olive (the others)
    def trouser_keep(co, bone):
        if bone is None: return False
        if not bone.startswith(('pelvis', 'thigh', 'calf', 'spine_01')): return False
        if bone.startswith('spine') and co.z > WAIST + 0.04: return False
        return co.z > BOOT - 0.02 and co.z < WAIST + 0.05
    PEL = B['pelvis'][0]
    def seat(t):
        """The seat bridged across, not following the cleft: each height's back drawn no further in than a
        gentle curve from the cheeks' crowns (cloth spans the hollow, it doesn't sink into it)."""
        lo, hi = PEL.z - 0.15, PEL.z + 0.06  # (above the fork: below it the legs part)
        band = {}
        for v in t.data.vertices:
            if lo < v.co.z < hi and v.co.y > PEL.y and abs(v.co.x) < 0.16:
                k = int(v.co.z / 0.01); band[k] = max(band.get(k, -9), v.co.y)
        for v in t.data.vertices:
            k = int(v.co.z / 0.01)
            if k not in band or v.co.y <= PEL.y or abs(v.co.x) > 0.12: continue
            fade = min(1.0, (v.co.z - lo) / 0.05, (hi - v.co.z) / 0.05)
            env = band[k] - 0.006 - 2.2 * v.co.x * v.co.x
            if env > v.co.y: v.co.y += (env - v.co.y) * fade
    def trousers(name, mat, thick, cuff_mat=None):
        t = L.shell(body, name, trouser_keep, thick, smooth=22, lam=0.6, subdiv=1)
        seat(t)
        folds(t, [knee['l'], knee['r']], lambda c: V((0, 0, 1)), amp=0.005, freq=100, reach=0.1)
        folds(t, [V((s * 0.14, -0.02, BOOT + 0.05)) for s in (1, -1)], lambda c: V((0, 0, 1)), amp=0.006, freq=120, reach=0.09)
        t.data.materials.append(mat); parts = [t]
        if cuff_mat:
            for s, x in (('l', 0.15), ('r', -0.15)):
                cl = L.loop_near(t, V((x, 0, BOOT)))
                if cl:
                    c = L.tube(f'{name}_cuff_{s}', L.resample(cl, 28), 0.016, 0.012); c.data.materials.append(cuff_mat); parts.append(c)
        return parts
    out['a3'] = trousers('A3', mats['a3'], 0.018, mats['sheep'])
    # ---------------- boots, gloves
    def boot_keep(co, bone): return bone is not None and bone.startswith(('foot', 'ball', 'calf')) and co.z < BOOT + 0.01
    bt = L.shell(body, 'boots', boot_keep, 0.022, smooth=20, lam=0.7, subdiv=1)
    bt.data.materials.append(mats['boot'])
    boots = [bt]
    for s, x in (('l', 0.15), ('r', -0.15)):
        cl = L.loop_near(bt, V((x, 0, BOOT)))
        if cl:
            c = L.tube(f'boot_top_{s}', L.resample(cl, 30), 0.02, 0.018); c.data.materials.append(mats['sheep']); boots.append(c)
    out['boots'] = boots
    def glove_keep(co, bone):
        if bone is None: return False
        if bone.startswith(('hand', 'thumb', 'index', 'middle', 'ring', 'pinky')): return True
        return bone.startswith('lowerarm') and (co - hand[side(bone)]).length < 0.06
    gl = L.shell(body, 'gloves', glove_keep, 0.0035, smooth=2, lam=0.3, subdiv=0)
    gl.data.materials.append(mats['glove']); gloves = [gl]
    ga = L.shell(body, 'gauntlets', lambda co, bone: bone is not None and bone.startswith('lowerarm') and (co - hand[side(bone)]).length < 0.085, 0.036, smooth=8, subdiv=1)
    ga.data.materials.append(mats['glove']); gloves.append(ga)
    out['gloves'] = gloves
    # ---------------- the B-6 helmet: a hood of leather, sheepskin lining turned out round the face
    fc = V((0, eye.y, (eye.z + mouth.z) / 2 + 0.005))
    def helmet_keep(co, bone):
        if bone is None or not bone.startswith(('head', 'neck')): return False
        if bone.startswith('neck') and co.z < jaw.z - 0.03: return False
        if co.z < jaw.z - 0.045: return False
        u, w = co.x / 0.064, (co.z - fc.z) / 0.088
        return not (u * u + w * w < 1 and co.y < head.y - 0.015)
    hm = L.shell(body, 'helmet', helmet_keep, 0.009, smooth=6, lam=0.5, subdiv=1)
    hm.data.materials.append(mats['helmet']); helmet = [hm]
    fl = L.loop_near(hm, fc + V((0, -0.05, 0)))
    if fl:
        rim = L.tube('helmet_rim', L.resample(fl, 48), 0.011, 0.011); rim.data.materials.append(mats['sheep']); helmet.append(rim)
    ears = {s: V((s * 0.075, head.y + 0.005, eye.z - 0.03)) for s in (1, -1)}
    for s, at in ears.items():
        at = L.onto(hm, [at + V((s * 0.05, 0, 0))], 0.012)[0]
        for r, h, z0 in ((0.036, 0.018, 0.0), (0.027, 0.012, 0.016)):
            c = bpy.data.meshes.new('ph'); o = bpy.data.objects.new('earphone', c); bpy.context.scene.collection.objects.link(o)
            import bmesh
            bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r * 0.92, depth=h)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.translate(bm, verts=bm.verts, vec=at + V((s * z0, 0, 0)))
            bm.to_mesh(c); bm.free()
            for p in c.polygons: p.use_smooth = True
            o.data.materials.append(mats['helmet'] if z0 == 0 else mats['phones']); helmet.append(o)
    # chin strap, from below one ear cup round under the chin to the other
    cs = [ears[1] + V((0.005, -0.02, -0.05)), V((0.05, mouth.y + 0.03, jaw.z - 0.035)), V((0, mouth.y + 0.01, jaw.z - 0.05)), V((-0.05, mouth.y + 0.03, jaw.z - 0.035)), ears[-1] + V((-0.005, -0.02, -0.05))]
    st = L.tube('chin_strap', L.onto(body, cs, 0.012), 0.009, 0.0025, closed=False, rect=True); st.data.materials.append(mats['helmet']); helmet.append(st)
    out['helmet'] = helmet
    # goggles up on the brow: two lens cups in rubber, the bridge, the strap round the helmet
    gog = []
    gz = eye.z + 0.065
    for s in (1, -1):
        ctr = L.onto(hm, [V((s * 0.036, front, gz))], 0.022)[0]
        import bmesh
        for r, d, mat, dz in ((0.028, 0.026, mats['phones'], 0.0), (0.023, 0.004, mats['lens'], -0.014), (0.03, 0.006, mats['metal'], -0.011)):
            me = bpy.data.meshes.new('g'); o = bpy.data.objects.new('goggle', me); bpy.context.scene.collection.objects.link(o)
            bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r * 0.95, depth=d)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2 - 0.55, 3, 'X'))
            bmesh.ops.translate(bm, verts=bm.verts, vec=ctr + V((0, dz, dz * -0.6)))
            bm.to_mesh(me); bm.free()
            for p in me.polygons: p.use_smooth = True
            o.data.materials.append(mat); gog.append(o)
    sp = L.ring_on(hm, V((0, head.y + 0.01, gz + 0.005)), V((0, 0.35, 1)), 0.09, 40, 0.004)
    gs = L.tube('goggle_strap', sp, 0.011, 0.002, rect=True); gs.data.materials.append(mats['phones']); gog.append(gs)
    out['goggles'] = gog
    # ---------------- the pilots' officer's service cap, crushed (the stiffener out so the headset sits on it),
    # and the HS-38 headset over it
    import bmesh
    def disc(name, at, axis, r, depth, mat, r2=None, seg=24):
        me = bpy.data.meshes.new(name); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r2 if r2 is not None else r, depth=depth)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=V((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix())
        bmesh.ops.translate(bm, verts=bm.verts, vec=at)
        bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        o.data.materials.append(mat); return o
    cap = []
    zb = eye.z + 0.04                                   # the band's lower edge, across the brow
    up = V((0, 0.12, 1)).normalized()                   # (worn a touch back on the head)
    band = L.ring_on(body, V((0, head.y + 0.005, zb)), up, 0.09, 56, 0.013)  # (out over his hair)
    C = sum(band, V()) / len(band)
    # the cap's profile, (scale from the band out, height up): band, the welt where the crown overhangs it,
    # the soft crown, its top
    # (low and soft, a crusher: the crown wider than the band and sagging over it, not a stiff kepi)
    PROF = [(1.0, 0.0), (1.0, 0.026), (1.04, 0.034), (1.15, 0.041), (1.2, 0.047), (1.18, 0.054), (1.09, 0.06), (0.88, 0.065), (0.55, 0.068), (0.2, 0.069)]
    def crush(d):  # (the sides pressed right down by the headset band, the front pushed up, the back sagging)
        ax = abs(d.x) / max(1e-6, d.length); fr = max(0.0, -d.y / max(1e-6, d.length)); bk = max(0.0, d.y / max(1e-6, d.length))
        return -0.02 * ax ** 3 + 0.012 * fr ** 2 - 0.008 * bk ** 2
    rings = []
    for s, h in PROF:
        ring = []
        for p in band:
            d = p - C; d -= up * d.dot(up)
            k = 0 if h < 0.035 else min(1.0, (h - 0.035) / 0.03)
            edge = min(1.0, max(0.0, (s - 0.45) / 0.6))  # (only the crown's rim is pressed down: its top stays smooth)
            ring.append(C + d * s + up * (h + crush(d) * k * edge))
        rings.append(ring)
    n = len(band)
    vs = [v for r in rings for v in r] + [C + up * 0.089]
    fs = [(k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i) for k in range(len(rings) - 1) for i in range(n)]
    top = len(vs) - 1
    fs += [((len(rings) - 1) * n + i, (len(rings) - 1) * n + (i + 1) % n, top) for i in range(n)]
    me = bpy.data.meshes.new('cap'); me.from_pydata([tuple(v) for v in vs], [], fs); me.update()
    cp = bpy.data.objects.new('cap', me); bpy.context.scene.collection.objects.link(cp)
    me.validate(); me.update()
    L.active(cp); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    for m_, kw in (('SUBSURF', {'levels': 2, 'render_levels': 2}), ('SOLIDIFY', {'thickness': 0.003, 'offset': -1, 'use_rim': True, 'use_even_offset': False})):
        m = cp.modifiers.new(m_, m_)
        for a, b in kw.items(): setattr(m, a, b)
    L.apply_mods(cp)
    for p in cp.data.polygons: p.use_smooth = True
    cp.data.materials.append(mats['cap']); cap.append(cp)
    # the visor: brown leather, from the band's front edge out and down
    front_i = [i for i, p in enumerate(band) if (p - C).normalized().dot(V((0, -1, 0))) > 0.45]
    front_i.sort(key=lambda i: math.atan2((band[i] - C).x, -(band[i] - C).y))
    inner, outer = [], []
    for j, i in enumerate(front_i):
        t = j / (len(front_i) - 1); w = math.sin(math.pi * t) ** 0.6
        d = band[i] - C; d -= up * d.dot(up); d.normalize()
        p = band[i] + up * 0.004
        inner.append(p); outer.append(p + d * (0.012 + 0.05 * w) - up * (0.006 + 0.018 * w))
    vv = [tuple(v) for v in inner + outer]; m_ = len(inner)
    ff = [(i, i + 1, m_ + i + 1, m_ + i) for i in range(m_ - 1)]
    me = bpy.data.meshes.new('visor'); me.from_pydata(vv, [], ff); me.update()
    vz = bpy.data.objects.new('visor', me); bpy.context.scene.collection.objects.link(vz)
    for m2, kw in (('SUBSURF', {'levels': 2, 'render_levels': 2}), ('SOLIDIFY', {'thickness': 0.004, 'offset': 0, 'use_rim': True})):
        m = vz.modifiers.new(m2, m2)
        for a, b in kw.items(): setattr(m, a, b)
    L.apply_mods(vz)
    for p in vz.data.polygons: p.use_smooth = True
    vz.data.materials.append(mats['visor']); cap.append(vz)
    # the chin strap across the front of the band, its two little buttons, and the officer's eagle
    cs_pts = [band[i] + up * 0.012 + (band[i] - C).normalized() * 0.002 for i in front_i]
    cst = L.tube('cap_strap', cs_pts, 0.0055, 0.0015, closed=False, rect=True); cst.data.materials.append(mats['visor']); cap.append(cst)
    for e in (cs_pts[0], cs_pts[-1]):
        cap.append(disc('cap_button', e + (e - C).normalized() * 0.002, (e - C), 0.004, 0.003, mats['brass']))
    fc_ = rings[3][front_i[len(front_i) // 2]]
    ea = disc('cap_eagle', fc_ + V((0, -0.004, 0.006)), V((0, -1, 0.25)), 0.016, 0.003, mats['brass'], seg=20)
    ea.scale = (1.5, 1.0, 0.75); L.active(ea); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cap.append(ea)
    out['cap'] = cap
    # HS-38 headset: black Bakelite receivers in rubber cushions, on a sprung band over the crown, and its cord
    hs = []
    ear_at = {}
    for s in (1, -1):
        e0 = L.onto(body, [V((s * 0.125, head.y + 0.005, eye.z - 0.03))], 0.0)[0]
        ax = V((s, 0, 0))
        ear_at[s] = e0
        hs.append(disc('hs_cushion', e0 + ax * 0.007, ax, 0.033, 0.013, mats['phones'], r2=0.03))
        hs.append(disc('hs_receiver', e0 + ax * 0.022, ax, 0.029, 0.018, mats['bakelite'], r2=0.026))
        hs.append(disc('hs_cap', e0 + ax * 0.032, ax, 0.016, 0.004, mats['metal']))
    # the band lies on him from ear to ear: round the side of his head (over the hair), then over the crown,
    # found by casting in from outside across the plane through his ears
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    cbm = bmesh.new(); cbm.from_mesh(cp.data); capt = BVHTree.FromBMesh(cbm); cbm.free()  # (from its mesh: the depsgraph's copy can be stale)
    bodt = BVHTree.FromObject(body, dg)
    O = V((0, ear_at[1].y, ear_at[1].z))
    path = []  # (point, outward)
    for k in range(41):
        a = math.pi * k / 40
        d = V((math.cos(a), 0, math.sin(a)))
        hit = capt.ray_cast(O + d * 0.4, -d, 0.4)
        if hit[0] is not None: path.append((hit[0] + d * 0.005, d)); continue
        hit = bodt.ray_cast(O + d * 0.4, -d, 0.4)
        if hit[0] is not None: path.append((hit[0] + d * 0.034, d))  # (out over the receiver's yoke and his hair)
    # a flat spring-steel strip lying on him: its width across the head, its thickness outward
    bv, bf = [], []
    for i, (p, d) in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)][0] - path[max(i - 1, 0)][0]).normalized()
        w = t.cross(d).normalized()
        for sw, sn in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            bv.append(tuple(p + w * (0.008 * sw) + d * (0.0015 * sn)))
    for i in range(len(path) - 1):
        for k in range(4):
            a0, a1 = i * 4 + k, i * 4 + (k + 1) % 4
            bf.append((a0, a1, a1 + 4, a0 + 4))
    bf += [(0, 1, 2, 3), tuple(len(bv) - 1 - k for k in range(4))]
    me = bpy.data.meshes.new('hs_band'); me.from_pydata(bv, [], bf); me.update()
    hb = bpy.data.objects.new('hs_band', me); bpy.context.scene.collection.objects.link(hb)
    L.active(hb); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.new(name='UVMap')
    hb.data.materials.append(mats['metal']); hs.append(hb)
    cord = [ear_at[1] + V((0.03, 0.01, -0.02)), ear_at[1] + V((0.02, 0.04, -0.08)), V((0.06, head.y + 0.07, neck.z - 0.02)), V((0.09, head.y + 0.06, neck.z - 0.12))]
    cd = L.tube('hs_cord', L.onto(body, cord, 0.01), 0.0028, 0.0028, closed=False); cd.data.materials.append(mats['bakelite']); hs.append(cd)
    out['headset'] = hs
    # ---------------- the A-10 Revised mask: moulded over nose, mouth and chin, its hose from the bottom
    mc = V((0, mouth.y, (eye.z * 0.25 + mouth.z * 0.75) - 0.01))
    # built as its own surface on an oval round nose and mouth: at the rim it lies on the face where it
    # seals, and from there rises smoothly into the moulded cup (an ellipsoid wide enough to clear the nose)
    from mathutils.bvhtree import BVHTree
    btree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get(), deform=False)
    C, ax = V((0, front + 0.05, mc.z - 0.004)), V((0.064, 0.072, 0.078))
    def face_y(x, z):
        hit = btree.ray_cast(V((x, front - 0.1, z)), V((0, 1, 0)), 0.3)
        return hit[0].y if hit[0] is not None else front
    TOP = min(0.058, eye.z - 0.014 - mc.z)  # (the rim's top, on the bridge of the nose between the eyes)
    log('mask top', TOP, 'eye', eye.z, 'centre', mc.z)
    RINGS, SEGS = 18, 56
    verts, faces = [], []
    for i in range(RINGS + 1):
        r = i / RINGS
        for j in range(SEGS if i else 1):
            a = 2 * math.pi * j / SEGS
            # (its top on the bridge of the nose, well under the eyes, and narrower there: the A-10's shape)
            up = math.sin(a) > 0
            x = 0.05 * 0.97 * r * math.cos(a) * (1 - 0.6 * max(0.0, math.sin(a)) ** 1.5)
            z = mc.z + (TOP if up else 0.058 * 0.97) * r * math.sin(a)
            fy = face_y(x, z) - 0.003
            q = 1 - ((x - C.x) / ax.x) ** 2 - ((z - C.z) / ax.z) ** 2
            ey = C.y - ax.y * math.sqrt(max(q, 0.0))
            t = min(1.0, max(0.0, (1 - r) / 0.4)); t = t * t * (3 - 2 * t)
            verts.append(V((x, min(fy, fy + (ey - fy) * t), z)))
    def idx(i, j): return 0 if i == 0 else 1 + (i - 1) * SEGS + j % SEGS
    for j in range(SEGS): faces.append((0, idx(1, j + 1), idx(1, j)))
    for i in range(1, RINGS):
        for j in range(SEGS): faces.append((idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)))
    me = bpy.data.meshes.new('mask'); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    mk = bpy.data.objects.new('mask', me); bpy.context.scene.collection.objects.link(mk)
    for p in me.polygons: p.use_smooth = True
    me.validate(); me.update()
    if me.polygons[0].normal.y > 0:  # (facing out, forward)
        L.active(mk); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.flip_normals(); bpy.ops.object.mode_set(mode='OBJECT')
    for m_, kw in (('SUBSURF', {'levels': 2, 'render_levels': 2}), ('SOLIDIFY', {'thickness': 0.004, 'offset': -1, 'use_rim': True})):
        m = mk.modifiers.new(m_, m_)
        for a, b in kw.items(): setattr(m, a, b)
    L.apply_mods(mk)
    mk.data.materials.append(mats['rubber']); mask = [mk]
    bottom = V((0, mc.y - 0.02, mc.z - 0.055))
    hose_pts = [bottom, bottom + V((0.0, 0.0, -0.05)), V((0.05, -0.17, neck.z - 0.07)), V((0.1, -0.16, neck.z - 0.17)), V((0.12, -0.15, neck.z - 0.26))]
    # the corrugated hose: rings along it (the tube drawn with many sections, each pushed out on a rib)
    cl = L.resample(L.resample(hose_pts, 40, closed=False), 260, closed=False)
    ho = L.tube('hose', cl, 0.011, 0.011, closed=False, smooth_pts=False)
    acc = [0.0]
    for a, b in zip(cl, cl[1:]): acc.append(acc[-1] + (b - a).length)
    for v in ho.data.vertices:
        i = min(range(len(cl)), key=lambda k: (cl[k] - v.co).length_squared)
        rib = 1 + 0.2 * max(0.0, math.sin(acc[i] / 0.0085 * math.tau)) ** 0.5
        v.co = cl[i] + (v.co - cl[i]) * rib
    ho.data.materials.append(mats['hose']); mask.append(ho)
    # its metal fitting at the mask, the raised rubber lip round the mask's edge, the snaps at the sides
    mask.append(disc('mask_fitting', bottom + V((0, 0, 0.012)), V((0, -0.35, 1)), 0.016, 0.022, mats['metal'], r2=0.013))
    rim_pts = [verts[1 + (RINGS - 1) * SEGS + j] + V((0, -0.002, 0)) for j in range(SEGS)]
    lip = L.tube('mask_lip', rim_pts, 0.0045, 0.0045); lip.data.materials.append(mats['rubber']); mask.append(lip)
    for s in (1, -1):
        sn = rim_pts[0 if s > 0 else SEGS // 2]
        mask.append(disc('mask_snap', sn + V((s * 0.004, 0, 0)), V((s, -0.3, 0)), 0.006, 0.005, mats['metal']))
        # the A-10R's own head harness (it hangs from it, not the helmet): above and below the ear to the back of the head
        for zoff, yz in ((0.012, eye.z + 0.012), (-0.012, eye.z - 0.07)):
            pts = [sn + V((0, 0.005, zoff)), V((s * 0.075, eye.y + 0.05, yz)), V((s * 0.085, head.y + 0.01, yz)), V((s * 0.06, head.y + 0.07, yz - 0.005)), V((0, head.y + 0.095, yz - 0.01))]
            st = L.tube('mask_strap', L.onto(body, pts, 0.008), 0.006, 0.0015, closed=False, rect=True); st.data.materials.append(mats['strap']); mask.append(st)
    out['mask'] = mask
    jk = b3[0]  # (the kit worn over the jacket is shaped on the thickest one, the B-3)
    chest = B['spine_03'][0].z + 0.16
    # ---------------- the B-4 Mae West: its yellow collar round the back of the neck, a bladder down each side of the chest
    mw = []
    nl = L.resample(L.loop_near(jk, neck), 40)
    back_half = [p for p in nl if p.y > neck.y - 0.04]
    back_half.sort(key=lambda p: math.atan2(p.x, p.y))
    if len(back_half) > 4:
        col = L.onto(jk, back_half, 0.045)
        c = L.tube('mae_collar', col, 0.032, 0.026, closed=False); c.data.materials.append(mats['mae']); mw.append(c)
    for s in (1, -1):
        mw.append(L.patch(jk, f'mae_bladder_{s}', lambda co, s=s: 0.025 < co.x * s < 0.155 and chest - 0.22 < co.z < chest + 0.06 and co.y < -0.03, 0.012, 0.03, mats['mae']))
    for o in mw[1:]:
        sm = o.modifiers.new('sm', 'SMOOTH'); sm.iterations = 12; sm.factor = 0.8; L.apply_mods(o)
    out['maewest'] = mw
    # ---------------- the parachute harness: plain olive drab webbing over the Mae West, the leg loops round the thighs
    hn = []
    a3 = out['a3'][0]
    for s in (1, -1):
        path = [V((s * 0.1, 0.16, WAIST + 0.05)), V((s * 0.11, 0.15, chest)), V((s * 0.12, 0.06, neck.z + 0.0)), V((s * 0.115, -0.08, neck.z - 0.04)),
                V((s * 0.11, -0.16, chest)), V((s * 0.085, -0.16, chest - 0.2)), V((s * 0.06, -0.15, WAIST)), V((s * 0.075, -0.12, WAIST - 0.12))]
        pts = L.onto(jk, path[:-1], 0.004) + L.onto(a3, path[-1:], 0.004)
        pts = [p + (V((0, -0.035, 0)) if p.y < -0.05 and chest - 0.25 < p.z < chest + 0.07 else V()) for p in pts]  # (over the Mae West's bladders)
        hn.append(L.tube(f'harness_{s}', L.resample(pts, 40, closed=False), 0.022, 0.0035, closed=False, rect=True))
        thigh = B[f'thigh_{"l" if s > 0 else "r"}']
        at = thigh[0].lerp(thigh[1], 0.22)
        hn.append(L.tube(f'leg_loop_{s}', L.ring_on(a3, at, thigh[1] - thigh[0], 0.09, 36, 0.004), 0.022, 0.0035, rect=True))
    cs = L.onto(jk, [V((x, -0.2, chest - 0.02)) for x in (-0.13, -0.06, 0, 0.06, 0.13)], 0.04)
    hn.append(L.tube('chest_strap', cs, 0.02, 0.0035, closed=False, rect=True))
    for o in hn: o.data.materials.append(mats['web'])
    import bmesh
    from mathutils import Matrix
    def box(name, at, size, mat):
        me = bpy.data.meshes.new(name); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=size, verts=bm.verts); bmesh.ops.translate(bm, vec=at, verts=bm.verts)
        bmesh.ops.bevel(bm, geom=bm.edges, offset=min(size) * 0.25, segments=2, affect='EDGES')
        bm.to_mesh(me); bm.free(); o.data.materials.append(mat); return o
    for s in (1, -1):
        hn.append(box('snap', cs[2 + s * 1] + V((0, -0.006, 0)), (0.026, 0.012, 0.034), mats['metal']))   # the chest strap's snap hooks
        d = L.tube('d_ring', [cs[2 + s * 2] + V((s * 0.0, -0.01, -0.06)) + V((math.cos(a) * 0.022, 0, math.sin(a) * 0.028)) for a in [i * math.tau / 14 for i in range(14)]], 0.004, 0.004)
        d.data.materials.append(mats['metal']); hn.append(d)                                               # the D-rings for the chest pack
    out['harness'] = hn
    # ---------------- the M1 flyer's vest: padded front and back plates in dark green canvas, quilted, the red pull
    fv = []
    for nm, front_side in (('flak_front', True), ('flak_back', False)):
        o = L.patch(jk, nm, lambda co, f=front_side: abs(co.x) < 0.175 and WAIST + 0.03 < co.z < neck.z - 0.04 and ((co.y < -0.02) if f else (co.y > 0.04)), 0.05 if front_side else 0.012, 0.022, mats['flak'])
        sm = o.modifiers.new('sm', 'SMOOTH'); sm.iterations = 8; sm.factor = 0.7; L.apply_mods(o)
        fv.append(o)
        for r in range(5):
            z = WAIST + 0.08 + r * 0.075
            rowpts = L.onto(o, [V((x, -0.3 if front_side else 0.3, z)) for x in (-0.15, -0.08, 0, 0.08, 0.15)], 0.001)
            q = L.tube(f'{nm}_quilt{r}', rowpts, 0.003, 0.002, closed=False); q.data.materials.append(mats['flak']); fv.append(q)
    for s in (1, -1):
        fv.append(L.patch(jk, 'flak_shoulder', lambda co, s=s: 0.08 < co.x * s < 0.14 and co.z > neck.z - 0.09, 0.04, 0.008, mats['flak']))
    pull = L.onto(fv[0], [V((0.07, -0.3, neck.z - 0.07)), V((0.07, -0.3, neck.z - 0.17))], 0.006)
    rp = L.tube('red_pull', pull, 0.012, 0.003, closed=False, rect=True); rp.data.materials.append(mats['red']); fv.append(rp)
    out['flak'] = fv
    # ---------------- the other outfits
    b10 = jacket('B10', mats['b10'], 0.016, mats['knit_od'], mats['mouton'], 0.06, 0.012, 0.016, 0.02, knit=True)
    b10 += pockets(b10[0], mats['b10'], [(0.1, WAIST + 0.1), (-0.1, WAIST + 0.1)], 0.055, 0.07)
    out['b10'] = b10
    a2 = jacket('A2', mats['a2'], 0.012, mats['knit'], mats['a2'], 0.055, 0.006, 0.016, 0.02, knit=True)
    a2 += pockets(a2[0], mats['a2'], [(0.1, WAIST + 0.12), (-0.1, WAIST + 0.12)], 0.065, 0.08)
    for s in (1, -1):  # the epaulettes
        ep = L.onto(a2[0], [V((s * 0.06, -0.01, neck.z - 0.02)), V((s * 0.17, -0.0, neck.z - 0.05))], 0.004)
        e = L.tube('epaulette', ep, 0.018, 0.003, closed=False, rect=True); e.data.materials.append(mats['a2']); a2.append(e)
    out['a2'] = a2
    out['od'] = trousers('OD', mats['od'], 0.012)
    f1 = jacket('F1', mats['f1'], 0.008, mats['f1'], mats['f1'], 0.03, 0.006, 0.01, 0.012)
    out['f1'] = f1 + trousers('F1L', mats['f1'], 0.008)
    return body, rig, out

try:
    body, rig, out = run()
    for k, v in out.items():
        log(k, [o.name for o in v])
        for o in v: o['set'] = k
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'crew_stage1.blend'))
    if PREVIEW:
        import preview; importlib.reload(preview)
        for tag, shown in (('sheep', ['b3', 'a3']), ('b10', ['b10', 'od']), ('a2', ['a2', 'od']), ('f1', ['f1'])):
            outfits = {'b3', 'a3', 'b10', 'od', 'a2', 'f1'}
            for k, obs in out.items():
                vis = (k in shown) or (k not in outfits)
                if k == 'flak': vis = tag in ('sheep', 'b10')
                if k == 'maewest': vis = tag != 'f1'
                if k in ('cap', 'headset'): vis = tag == 'a2'          # (the pilots: cap and headset, not the helmet)
                if k in ('helmet', 'goggles'): vis = tag != 'a2'
                for o in obs: o.hide_render = not vis
            for o in bpy.data.objects:
                if 'short' in o.name: o.hide_render = tag != 'a2'      # (his hair shows only under the cap)
            face = ('face', (0.45, -1.0, 1.45), 1.38)
            preview.render(OUT, 'stage2_' + tag, body, views=(('front', (0, -3.6, 1.1), 0.9), ('back', (0, 3.6, 1.1), 0.9), ('three', (2.4, -2.6, 1.3), 0.95), face) if tag == 'sheep' else (('three', (2.4, -2.6, 1.3), 0.95), face, ('side', (1.1, -0.2, 1.5), 1.45), ('above', (0.6, -0.75, 2.0), 1.6)) if tag == 'a2' else (('three', (2.4, -2.6, 1.3), 0.95),))
except Exception:
    log(traceback.format_exc())
L.LOG.close()
