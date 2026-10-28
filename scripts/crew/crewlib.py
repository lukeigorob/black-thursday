# Building blocks for the B-17 crewman (run inside Blender): the MPFB body prepared, garments grown from its
# surface (shells), tubes along their edges (collars, cuffs, rims), straps over them, procedural materials,
# and every piece weighted to the same skeleton as the body.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

LOG = None
def log(*a):
    if LOG: LOG.write(" ".join(str(x) for x in a) + "\n"); LOG.flush()

BONES = None  # bone name -> (head, tail) in rest pose, object space

def active(o):
    for x in bpy.context.view_layer.objects: x.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o

# ---------------------------------------------------------------- the body
def prepare_body(body, rig):
    """Shape keys applied, helper geometry (eyes' sockets, teeth, the skirt and tights helpers) deleted, the
    MASK modifiers gone: the body as it is, in its rest pose."""
    global BONES
    active(body)
    if body.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for m in list(body.modifiers):
        if m.type == 'MASK': body.modifiers.remove(m)
    gi = body.vertex_groups["body"].index
    bm = bmesh.new(); bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if v[dl].get(gi, 0.0) < 0.5]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(body.data); bm.free()
    BONES = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    log("body verts", len(body.data.vertices))

def group_centre(body, name):
    gi = body.vertex_groups[name].index
    pts = [v.co for v in body.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    return sum(pts, Vector()) / len(pts) if pts else None

def dominant(body):
    """Each vertex's strongest bone (by the rig's weights)."""
    names = {g.index: g.name for g in body.vertex_groups if g.name in BONES}
    out = []
    for v in body.data.vertices:
        best, w = None, 0
        for g in v.groups:
            if g.group in names and g.weight > w: best, w = names[g.group], g.weight
        out.append(best)
    return out

# ---------------------------------------------------------------- shells grown from the body
def shell(body, name, keep, thick, smooth=10, lam=0.5, subdiv=1, solid=0.0, push=None, facing=None):
    """A garment from the body's faces where keep(vertex co, its bone) holds for all its corners: smoothed
    (no muscles under cloth), pushed out along the normals by thick (push(co, bone) -> extra), optionally
    subdivided and given an edge thickness. Keeps the body's UVs and vertex groups."""
    dom = dominant(body)
    me = body.data.copy(); me.name = name
    me.materials.clear()  # (not the body's skin: the garment's own, appended by the caller)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    for g in body.vertex_groups: ob.vertex_groups.new(name=g.name)
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    sel = [keep(v.co, dom[v.index]) for v in bm.verts]
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(sel[v.index] for v in f.verts) or (facing and f.normal.dot(facing[0]) < facing[1])], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # (only the largest connected piece: no stray islands, nostrils, lips' insides)
    bm.verts.ensure_lookup_table()
    seen, comps = set(), []
    for v0 in bm.verts:
        if v0 in seen: continue
        comp, stack = [], [v0]; seen.add(v0)
        while stack:
            v = stack.pop(); comp.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w not in seen: seen.add(w); stack.append(w)
        comps.append(comp)
    big = max(len(c) for c in comps)
    keepv = set(v for c in comps if len(c) > big * 0.3 for v in c)  # (both boots, both gloves: only the crumbs go)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keepv], context='VERTS')
    bm.verts.ensure_lookup_table()
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smooth):
        bmesh.ops.smooth_laplacian_vert(bm, verts=inner, lambda_factor=lam, lambda_border=0.0, use_x=True, use_y=True, use_z=True, preserve_volume=False)
    bm.normal_update()
    for v in bm.verts:
        d = thick + (push(v.co, None) if push else 0.0)
        v.co += v.normal * d
    bm.to_mesh(me); bm.free()
    if subdiv:
        m = ob.modifiers.new("sub", 'SUBSURF'); m.levels = subdiv; m.render_levels = subdiv; m.quality = 2
        apply_mods(ob)
    if solid:
        m = ob.modifiers.new("sol", 'SOLIDIFY'); m.thickness = solid; m.offset = -1; m.use_rim = True; m.use_even_offset = False
        apply_mods(ob)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def apply_mods(ob):
    active(ob)
    for m in list(ob.modifiers):
        if m.type == 'ARMATURE': continue
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e: log("apply fail", ob.name, m.name, e); ob.modifiers.remove(m)

def boundary_loops(ob):
    """The garment's open edges, each as an ordered loop of points (object space)."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    edges = [e for e in bm.edges if e.is_boundary]
    nb = {}
    for e in edges:
        a, b = e.verts
        nb.setdefault(a.index, []).append(b.index); nb.setdefault(b.index, []).append(a.index)
    co = {v.index: v.co.copy() for v in bm.verts}
    seen, loops = set(), []
    for s in nb:
        if s in seen: continue
        loop, prev, cur = [s], None, s
        seen.add(s)
        while True:
            nxt = [n for n in nb[cur] if n != prev and n not in seen]
            if not nxt: break
            prev, cur = cur, nxt[0]; seen.add(cur); loop.append(cur)
        if len(loop) > 5: loops.append([co[i] for i in loop])
    bm.free()
    return loops

def loop_near(ob, point):
    """The open edge loop whose middle is nearest point."""
    best, bd = None, 1e9
    for l in boundary_loops(ob):
        c = sum(l, Vector()) / len(l)
        d = (c - point).length
        if d < bd: best, bd = l, d
    return best

# ---------------------------------------------------------------- tubes and straps
def profile(name, w, h, rect=False):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '2D'
    sp = c.splines.new('POLY' if rect else 'NURBS')
    if rect:
        pts = [(-w, -h), (w, -h), (w, h), (-w, h)]
    else:
        pts = [(math.cos(a) * w, math.sin(a) * h) for a in [i * math.tau / 12 for i in range(12)]]
    sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts): p.co = (x, y, 0, 1)
    sp.use_cyclic_u = True
    if not rect: sp.order_u = 3
    o = bpy.data.objects.new(name, c); bpy.context.scene.collection.objects.link(o)
    return o

def tube(name, pts, w, h, closed=True, rect=False, tilt=0.0, smooth_pts=True, resolution=2):
    """A tube (or flat strap, rect) along pts, its cross-section w x h (half sizes, m)."""
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'
    c.bevel_mode = 'OBJECT'; c.bevel_object = profile(name + "_p", w, h, rect)
    c.use_fill_caps = not closed; c.resolution_u = resolution; c.twist_mode = 'MINIMUM'
    sp = c.splines.new('NURBS' if smooth_pts else 'POLY')
    sp.points.add(len(pts) - 1)
    for p, v in zip(sp.points, pts): p.co = (v.x, v.y, v.z, 1); p.tilt = tilt
    sp.use_cyclic_u = closed
    if smooth_pts: sp.order_u = 3; sp.use_endpoint_u = not closed
    o = bpy.data.objects.new(name, c); bpy.context.scene.collection.objects.link(o)
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    m = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(m)
    bpy.data.objects.remove(o); bpy.data.objects.remove(c.bevel_object)
    for p in me.polygons: p.use_smooth = True
    if not me.uv_layers: me.uv_layers.new(name="UVMap")
    return m

def resample(pts, n, closed=True):
    """n points evenly along a polyline."""
    seg = list(zip(pts, pts[1:] + ([pts[0]] if closed else [])))
    L = [ (b - a).length for a, b in seg ]; total = sum(L)
    out, acc, k = [], 0.0, 0
    for i in range(n):
        t = total * i / (n if closed else n - 1)
        while k < len(L) - 1 and acc + L[k] < t: acc += L[k]; k += 1
        a, b = seg[k]; f = 0 if L[k] == 0 else (t - acc) / L[k]
        out.append(a.lerp(b, min(1, max(0, f))))
    return out

def onto(surface_ob, pts, off):
    """Points pulled onto a surface and lifted off it by off along its normal."""
    bvh = BVHTree.FromObject(surface_ob, bpy.context.evaluated_depsgraph_get())
    out = []
    for p in pts:
        loc, nor, _, _ = bvh.find_nearest(p)
        out.append(loc + nor * off if loc else p)
    return out

def ring_on(surface_ob, centre, axis, radius_guess, n=40, off=0.004):
    """A closed ring round a limb/neck on surface_ob: points round centre in the plane across axis, pulled
    onto the surface (straps, cuffs, bands)."""
    axis = axis.normalized(); u = axis.orthogonal().normalized(); w = axis.cross(u)
    bvh = BVHTree.FromObject(surface_ob, bpy.context.evaluated_depsgraph_get())
    pts = []
    for i in range(n):
        a = math.tau * i / n
        d = (u * math.cos(a) + w * math.sin(a))
        hit = bvh.ray_cast(centre + d * radius_guess * 3, -d, radius_guess * 3)
        if hit[0] is None: hit = bvh.find_nearest(centre + d * radius_guess)
        pts.append(hit[0] + hit[1] * off)
    return pts

# ---------------------------------------------------------------- weights: the body's, onto every piece
def skin_to(ob, body, rig, only=None):
    """Weights from the nearest point of the body (its face's corners, by distance), then the armature.
    only: limit to these bones (rigid kit on the head, say)."""
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get(), deform=False)
    bone_groups = {g.index: g.name for g in body.vertex_groups if g.name in BONES}
    bverts = body.data.vertices; bpolys = body.data.polygons
    for name in set(bone_groups.values()):
        if name not in ob.vertex_groups: ob.vertex_groups.new(name=name)
    # (clear what a duplicated shell carried over, so no stale weights)
    for g in ob.vertex_groups:
        if g.name in BONES: g.remove(range(len(ob.data.vertices)))
    for v in ob.data.vertices:
        loc, nor, fi, dist = bvh.find_nearest(v.co)
        acc = {}
        if fi is None: continue
        poly = bpolys[fi]; tot = 0
        for vi in poly.vertices:
            d = 1.0 / (0.002 + (bverts[vi].co - loc).length)
            tot += d
            for g in bverts[vi].groups:
                if g.group in bone_groups: acc[bone_groups[g.group]] = acc.get(bone_groups[g.group], 0) + g.weight * d
        if only: acc = {k: x for k, x in acc.items() if k in only} or {only[0]: 1.0}
        s = sum(acc.values()) or 1
        for k, x in sorted(acc.items(), key=lambda kv: -kv[1])[:4]:
            ob.vertex_groups[k].add([v.index], x / s, 'REPLACE')
    for g in list(ob.vertex_groups):
        if g.name not in BONES: ob.vertex_groups.remove(g)
    for m in list(ob.modifiers):
        if m.type == 'ARMATURE': ob.modifiers.remove(m)
    m = ob.modifiers.new("Armature", 'ARMATURE'); m.object = rig
    ob.parent = rig

def rigid_to(ob, rig, bone):
    """A rigid piece on one bone (goggles, a buckle): all its weight on it."""
    for g in list(ob.vertex_groups): ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name=bone); g.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
    m = ob.modifiers.new("Armature", 'ARMATURE'); m.object = rig
    ob.parent = rig

def join(name, obs):
    active(obs[0])
    for o in obs[1:]: o.select_set(True)
    bpy.ops.object.join()
    obs[0].name = name; obs[0].data.name = name
    return obs[0]

def patch(src, name, keep, off, solid=0.003, mat=None):
    """A patch cut from another garment's surface where keep(co) holds (pockets, flaps, panels), lifted off
    it by off and given a thickness: real geometry, with an edge."""
    me = src.data.copy(); me.name = name; me.materials.clear()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(keep(v.co) for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    for v in bm.verts: v.co += v.normal * off
    bm.to_mesh(me); bm.free()
    if solid:
        m = ob.modifiers.new("sol", 'SOLIDIFY'); m.thickness = solid; m.offset = 1; m.use_rim = True; m.use_even_offset = False
        apply_mods(ob)
    for p in ob.data.polygons: p.use_smooth = True
    if mat: ob.data.materials.append(mat)
    return ob

# ---------------------------------------------------------------- straps and seams that lie on a surface
def tree_of(ob):
    """A BVH of the object's mesh as it is now (not the depsgraph's copy, which can be stale)."""
    bm = bmesh.new(); bm.from_mesh(ob.data); t = BVHTree.FromBMesh(bm); bm.free()
    return t

def slice_path(tree, centre, axis, start, sweep, n, off, spoke=None):
    """Points on a surface along a slice through it: rays cast in from outside at angles round `axis`
    (through `centre`), from direction `start`, through `sweep` radians. spoke(a) can tilt each ray's
    direction (to bend the path). Returns [(point lifted off by off, outward normal)]."""
    axis = axis.normalized(); start = (start - axis * start.dot(axis)).normalized(); side = axis.cross(start)
    out = []
    for i in range(n):
        a = sweep * i / (n - 1)
        d = start * math.cos(a) + side * math.sin(a)
        if spoke: d = spoke(a, d).normalized()
        hit = tree.ray_cast(centre + d * 0.5, -d, 0.5)
        if hit[0] is None: continue
        nor = hit[1] if hit[1].dot(d) > 0 else -hit[1]
        out.append((hit[0] + nor * off, nor))
    return out

def flat_strap(name, path, width, thick, closed=False):
    """A flat strap lying along path [(point, outward normal)]: its width across the surface, its
    thickness outward (so it lies flat on it, never edge-on)."""
    vs, fs = [], []
    m = len(path)
    for i, (p, nor) in enumerate(path):
        a = path[(i + 1) % m if closed else min(i + 1, m - 1)][0]; b = path[(i - 1) % m if closed else max(i - 1, 0)][0]
        t = (a - b).normalized(); w = t.cross(nor).normalized()
        for sw, sn in ((-1, -0.3), (1, -0.3), (1, 1), (-1, 1)):
            vs.append(tuple(p + w * (width * sw) + nor * (thick * sn)))
    for i in range(m if closed else m - 1):
        j = (i + 1) % m
        for k in range(4):
            fs.append((i * 4 + k, i * 4 + (k + 1) % 4, j * 4 + (k + 1) % 4, j * 4 + k))
    if not closed: fs += [(3, 2, 1, 0), tuple(4 * (m - 1) + k for k in range(4))]
    me = bpy.data.meshes.new(name); me.from_pydata(vs, [], fs); me.update()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    active(ob); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    for p in me.polygons: p.use_smooth = True
    me.uv_layers.new(name='UVMap')
    return ob

# ---------------------------------------------------------------- cloth hangs, it doesn't cling
def _hull2(pts):
    """Convex hull of 2D points (monotone chain), counter-clockwise."""
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0: hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]

def _ray_hull(c, d, hull):
    """Distance from c along unit d to the hull polygon's edge."""
    best = None
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        ex, ey = b[0] - a[0], b[1] - a[1]
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12: continue
        t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den
        u = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den
        if t > 0 and -1e-6 <= u <= 1 + 1e-6 and (best is None or t < best): best = t
    return best

def drape(ob, select, blend=0.85, bin_h=0.012, margin=0.0):
    """Hang the cloth: in each horizontal slice, the selected vertices pushed out to the slice's convex
    outline (and margin beyond), so it bridges every hollow (between the pecs, the spine, under the
    shoulder blades) instead of clinging to the muscle."""
    me = ob.data
    bins = {}
    for v in me.vertices:
        if select(v.co): bins.setdefault(int(v.co.z / bin_h), []).append(v)
    for k, vs in bins.items():
        hull = _hull2([(round(v.co.x, 5), round(v.co.y, 5)) for v in vs])
        if len(hull) < 3: continue
        cx = sum(p[0] for p in hull) / len(hull); cy = sum(p[1] for p in hull) / len(hull)
        for v in vs:
            dx, dy = v.co.x - cx, v.co.y - cy; l = math.hypot(dx, dy)
            if l < 1e-6: continue
            r = _ray_hull((cx, cy), (dx / l, dy / l), hull)
            if r is None or r + margin <= l: continue
            t = (r + margin - l) * blend
            v.co.x += dx / l * t; v.co.y += dy / l * t
    me.update()

def ease(ob, select, iterations=8, factor=0.5, push=0.0):
    """Smooth the selected part (a sleeve: no biceps showing through), then back out by push."""
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    vs = [v for v in bm.verts if select(v.co) and not v.is_boundary]
    for _ in range(iterations): bmesh.ops.smooth_vert(bm, verts=vs, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in vs: v.co += v.normal * push
    bm.to_mesh(ob.data); bm.free()
