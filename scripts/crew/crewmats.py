# Materials for the crewman's gear (Blender): each a Principled BSDF in the colours the research gives,
# its surface from a CC0 scan (ambientCG, cc0/: leather grain, sheepskin pile, wool, woven cloth, rubber)
# box-projected on object coordinates, with wear where it's rubbed and dirt in the creases (ambient
# occlusion), so it can be baked to image textures for the game.
import bpy, os
CC0 = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cc0')

def _new(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    return m, nt, bsdf, tc

def _rgb(h):
    return ((h >> 16 & 255) / 255) ** 2.2, ((h >> 8 & 255) / 255) ** 2.2, ((h & 255) / 255) ** 2.2, 1

def _noise(nt, tc, scale, detail=6, rough=0.6, coord='Object', mapping_scale=None):
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    src = tc.outputs[coord]
    if mapping_scale:
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = mapping_scale
        nt.links.new(src, mp.inputs[0]); src = mp.outputs[0]
    nt.links.new(src, n.inputs['Vector'])
    return n

def _colour(nt, bsdf, fac, c1, c2):
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs[6].default_value = _rgb(c1); mix.inputs[7].default_value = _rgb(c2)
    nt.links.new(fac, mix.inputs[0]); nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    return mix

def _bump(nt, bsdf, height, strength, distance=0.002):
    b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = distance
    nt.links.new(height, b.inputs['Height']); nt.links.new(b.outputs[0], bsdf.inputs['Normal'])
    return b

def _add(nt, a, b, k=1.0, op='ADD'):
    m = nt.nodes.new('ShaderNodeMath'); m.operation = op
    nt.links.new(a, m.inputs[0])
    if isinstance(b, (int, float)): m.inputs[1].default_value = b
    else: nt.links.new(b, m.inputs[1])
    return m.outputs[0]

def _scan(nt, tc, asset, scale):
    """A scanned texture set, box-projected: its colour's value (for variation), height and roughness."""
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    out = {}
    for kind, cs in (('Color', 'sRGB'), ('Displacement', 'Non-Color'), ('Roughness', 'Non-Color')):
        path = os.path.join(CC0, asset, f'{asset}_2K-JPG_{kind}.jpg')
        im = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
        im.colorspace_settings.name = cs
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; t.projection = 'BOX'; t.projection_blend = 0.25
        nt.links.new(mp.outputs[0], t.inputs[0])
        out[kind] = t.outputs[0]
    bw = nt.nodes.new('ShaderNodeRGBToBW'); nt.links.new(out['Color'], bw.inputs[0]); out['Value'] = bw.outputs[0]
    return out

def _grime(nt, colour_out, bsdf, amount=0.45, dist=0.035):
    """Darken the colour into the creases and hollows (dirt and shadow there), then feed the BSDF."""
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = dist; ao.samples = 8
    k = nt.nodes.new('ShaderNodeMapRange'); k.inputs[3].default_value = 1 - amount; k.inputs[4].default_value = 1.0
    nt.links.new(ao.outputs['AO'], k.inputs[0])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
    nt.links.new(colour_out, mul.inputs[6]); nt.links.new(k.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])

def _detail(nt, mix, val, lo=0.7, hi=1.25):
    """Multiply the tinted colour by the scan's own light and dark (remapped round 1)."""
    r = nt.nodes.new('ShaderNodeMapRange'); r.inputs[3].default_value = lo; r.inputs[4].default_value = hi
    nt.links.new(val, r.inputs[0])
    m2 = nt.nodes.new('ShaderNodeMix'); m2.data_type = 'RGBA'; m2.blend_type = 'MULTIPLY'; m2.inputs[0].default_value = 1.0
    nt.links.new(mix.outputs[2], m2.inputs[6]); nt.links.new(r.outputs[0], m2.inputs[7])
    return m2.outputs[2]

def leather(name, c_light, c_dark, rough=0.5, grain=260, wrinkle=14):
    """Worn leather: lighter where it's rubbed, a pebbled grain and soft creases."""
    m, nt, bsdf, tc = _new(name)
    wear = _noise(nt, tc, 9, 8, 0.65)
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.38; ramp.color_ramp.elements[1].position = 0.7
    nt.links.new(wear.outputs[0], ramp.inputs[0])
    mix = _colour(nt, bsdf, ramp.outputs[0], c_dark, c_light)
    sc = _scan(nt, tc, 'Leather037', grain / 40)  # (the grain about 4 mm across, as on a horsehide or a B-3's suede)
    _grime(nt, _detail(nt, mix, sc['Value']), bsdf)
    cr = _noise(nt, tc, wrinkle, 3, 0.5, mapping_scale=(1, 1, 3.5))
    cr2 = _noise(nt, tc, wrinkle * 3.2, 4, 0.55, mapping_scale=(1, 1, 2.2))  # (finer creases across the big ones)
    h = _add(nt, sc['Displacement'], _add(nt, _add(nt, cr.outputs[0], 2.6, op='MULTIPLY'), _add(nt, cr2.outputs[0], 1.2, op='MULTIPLY')))
    _bump(nt, bsdf, h, 0.72, 0.003)
    rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs[3].default_value = rough + 0.15; rr.inputs[4].default_value = rough - 0.1
    nt.links.new(_add(nt, ramp.outputs[0], _add(nt, sc['Roughness'], 0.5, op='MULTIPLY'), op='ADD'), rr.inputs[0])
    rr.inputs[2].default_value = 1.5
    nt.links.new(rr.outputs[0], bsdf.inputs['Roughness'])
    return m

def fleece(name, c1, c2):
    """Sheepskin (or mouton) pile: dense curls, matt, a little sheen."""
    m, nt, bsdf, tc = _new(name)
    sc = _scan(nt, tc, 'Carpet016', 9)  # (a dense wool pile: the shearling's curls)
    # the curls in clumps, a centimetre or so across: a cellular pattern, each tuft's tip light and the
    # crevices between them dark (the scan's pile, near white, gives only its fine shading)
    vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 70; vo.feature = 'SMOOTH_F1'
    try: vo.inputs['Smoothness'].default_value = 0.6
    except KeyError: pass
    warp = _noise(nt, tc, 25, 4, 0.6)  # (the tufts pushed about: irregular, not a grid of round dots)
    wv = nt.nodes.new('ShaderNodeVectorMath'); wv.operation = 'MULTIPLY_ADD'; wv.inputs[1].default_value = (0.03, 0.03, 0.03)
    nt.links.new(warp.outputs['Color'], wv.inputs[0]); nt.links.new(tc.outputs['Object'], wv.inputs[2])
    nt.links.new(wv.outputs[0], vo.inputs['Vector'])
    try: vo.inputs['Randomness'].default_value = 1.0
    except KeyError: pass
    tuft = nt.nodes.new('ShaderNodeMapRange'); tuft.inputs[1].default_value = 0.0; tuft.inputs[2].default_value = 0.45; tuft.inputs[3].default_value = 1.0; tuft.inputs[4].default_value = 0.0
    nt.links.new(vo.outputs['Distance'], tuft.inputs[0])
    n = _noise(nt, tc, 60, 6, 0.75)
    mix = _colour(nt, bsdf, _add(nt, _add(nt, n.outputs[0], 0.7, op='MULTIPLY'), _add(nt, tuft.outputs[0], 0.25, op='MULTIPLY')), c2, c1)
    shade = nt.nodes.new('ShaderNodeMapRange'); shade.inputs[3].default_value = 0.55; shade.inputs[4].default_value = 1.0
    nt.links.new(tuft.outputs[0], shade.inputs[0])
    m3 = nt.nodes.new('ShaderNodeMix'); m3.data_type = 'RGBA'; m3.blend_type = 'MULTIPLY'; m3.inputs[0].default_value = 1.0
    nt.links.new(_detail(nt, mix, sc['Value'], 0.55, 1.0), m3.inputs[6]); nt.links.new(shade.outputs[0], m3.inputs[7])
    _grime(nt, m3.outputs[2], bsdf, 0.6, 0.03)
    _bump(nt, bsdf, _add(nt, sc['Displacement'], _add(nt, tuft.outputs[0], 1.6, op='MULTIPLY')), 1.0, 0.007)  # (deep curls)
    bsdf.inputs['Roughness'].default_value = 0.97
    try:  # (a soft sheen the colour of the wool, not white)
        bsdf.inputs['Sheen Weight'].default_value = 0.25; bsdf.inputs['Sheen Tint'].default_value = (*_rgb(c1)[:3], 1)
    except (KeyError, TypeError): pass
    return m

def cloth(name, c1, c2, kind='twill', scale=700, rough=0.85, strength=0.35):
    """Woven cloth: twill (diagonal), canvas (a weave), rib (knit ribs along Z), wool (felted)."""
    m, nt, bsdf, tc = _new(name)
    var = _noise(nt, tc, 6, 6, 0.6)
    mix = _colour(nt, bsdf, var.outputs[0], c2, c1)
    if kind in ('wool', 'twill', 'canvas'):
        asset, sz = {'wool': ('Fabric032', 7), 'twill': ('Fabric036', 9), 'canvas': ('Fabric030', 6)}[kind]
        sc = _scan(nt, tc, asset, sz)
        _grime(nt, _detail(nt, mix, sc['Value'], 0.75, 1.2), bsdf)
        _bump(nt, bsdf, sc['Displacement'], strength * 1.6, 0.0015)
        rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs[3].default_value = rough - 0.08; rr.inputs[4].default_value = min(1.0, rough + 0.08)
        nt.links.new(sc['Roughness'], rr.inputs[0]); nt.links.new(rr.outputs[0], bsdf.inputs['Roughness'])
        return m
    _grime(nt, mix.outputs[2], bsdf)
    w1 = nt.nodes.new('ShaderNodeTexWave'); w1.wave_type = 'BANDS'; w1.inputs['Scale'].default_value = scale  # (the knit rib)
    w1.bands_direction = 'X'
    nt.links.new(tc.outputs['Object'], w1.inputs['Vector'])
    h = w1.outputs['Fac']
    _bump(nt, bsdf, h, strength, 0.0012)
    bsdf.inputs['Roughness'].default_value = rough
    return m

def plain(name, c, rough=0.5, metal=0.0, bump=0.0, scale=80, alpha=1.0, spec=0.5):
    m, nt, bsdf, tc = _new(name)
    bsdf.inputs['Base Color'].default_value = _rgb(c); bsdf.inputs['Roughness'].default_value = rough; bsdf.inputs['Metallic'].default_value = metal
    if bump:
        _bump(nt, bsdf, _noise(nt, tc, scale, 5, 0.6).outputs[0], bump, 0.002)
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'  # (Blender 4.2+'s EEVEE)
        elif hasattr(m, 'blend_method'): m.blend_method = 'BLEND'
    return m

def all_materials():
    return {
        'b3': leather('b3_leather', 0x553424, 0x2c1a10, 0.5),          # the B-3's dark chocolate sheepskin, waxed (the photographs)
        'a3': leather('a3_leather', 0x4f3826, 0x2b1f16, 0.78, grain=420),  # the A-3 trousers: darker, duller suede
        'sheep': fleece('sheep_fleece', 0xd2b383, 0xa68757),            # the sheepskin's pile at collar, cuffs and hem: cream-tan (the photographs)
        'mouton': fleece('mouton', 0x5b4130, 0x3a2a1e),                 # the B-10's dark brown mouton collar
        'a2': leather('a2_horsehide', 0x4a2d1c, 0x24150c, 0.38, grain=320),  # the A-2's seal-brown horsehide
        'b10': cloth('b10_twill', 0x77714d, 0x5a5639, 'twill', 900),    # the B-10's olive drab cotton
        'od': cloth('od_twill', 0x6a6648, 0x4f4c35, 'twill', 900),      # olive trousers
        'knit': cloth('knit_rib', 0x4b3d2c, 0x382d21, 'rib', 260, 0.9, 0.6),     # brown knit cuffs and waistband (A-2)
        'knit_od': cloth('knit_od', 0x5f5b3f, 0x46432f, 'rib', 260, 0.9, 0.6),   # olive knit (B-10)
        'f1': cloth('f1_wool', 0x41567a, 0x2f3f5c, 'wool', rough=0.92),          # the F-1 heated suit's blue wool
        'boot': leather('a6_suede', 0x5a4636, 0x2c221a, 0.85, grain=500),        # the A-6 boots: brown suede, rubber soles
        'sole': plain('sole', 0x1c1a18, 0.7),
        'glove': leather('glove_leather', 0x6b4a30, 0x3b2a1d, 0.5, grain=400),
        'helmet': leather('helmet_leather', 0x8a603e, 0x5a3b23, 0.42),          # the helmet's smooth tan-brown leather (the photograph)
        'earcup': leather('earcup_leather', 0x7a5132, 0x4c311d, 0.28, grain=700), # its ear cups: the same leather, moulded and polished
        'rubber': plain('mask_rubber', 0x3d3c29, 0.62, bump=0.012, scale=400),    # the mask's rubber: khaki olive (the photograph)
        'cord': cloth('phone_cord', 0xc2a466, 0x9c8248, 'canvas', 1600, 0.8, 0.3),  # the earphones' braided tan cord
        'hose': plain('hose_rubber', 0x232320, 0.6),
        'metal': plain('metal', 0x8d8b84, 0.32, 1.0),
        'brass': plain('brass', 0xb08a3e, 0.35, 1.0),
        'lens': plain('lens', 0x050506, 0.03, 0.0, alpha=0.82),                    # the goggles' lenses: dark smoked glass, his eyes just seen through it
        'mae': cloth('mae_west', 0xe09a2c, 0xbd7a18, 'canvas', 600, 0.75, 0.25),  # the B-4's orange-yellow rubberised cloth
        'web': cloth('harness_webbing', 0xd9d2bd, 0xb7b09a, 'twill', 1400, 0.85, 0.5), # the QAC harness's pale webbing (the photographs)
        'qac': plain('qac_face', 0xcfcbc0, 0.4, 0.3),                                # its quick-release box's painted face
        'flak': cloth('flak_canvas', 0x9c8152, 0x7a6239, 'canvas', 500, 0.88, 0.3), # the flak vest's tan canvas (the photographs)
        'red': cloth('red_pull', 0x9a2b1f, 0x6e1f17, 'canvas', 500, 0.8, 0.3),
        'phones': plain('earphone_rubber', 0x1d1c1a, 0.45),
        'cap': cloth('cap_wool', 0x4f4d36, 0x3c3b28, 'wool', rough=0.9),              # the officer's cap: dark olive drab wool elastique
        'visor': leather('cap_visor', 0x4a2f1d, 0x2a1a10, 0.32, grain=500),        # its brown leather visor and chin strap, polished
        'bakelite': plain('bakelite', 0x121110, 0.25),
        'frame': plain('goggle_frame', 0x2b2a28, 0.35, 0.8),                       # the goggles' dark blued-steel frames                               # the receivers' black Bakelite
        'strap': cloth('mask_strap', 0xbdb6a2, 0x9d9682, 'canvas', 700, 0.85, 0.35),  # the mask's webbing harness: pale grey-khaki
    }
