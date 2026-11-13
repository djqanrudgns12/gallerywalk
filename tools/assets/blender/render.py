"""미리 보기 렌더(R-3 캡처): 빌드한 glb(최적화 전)를 불러와 배치 계약의 실제 자리에 놓고 찍는다.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/assets/blender/render.py -- \\
    --src .local/art/build/modern-history --out .local/art/r3 [--mode viewer|solid] [--only front,portico,...]

- `viewer`(기본): 뷰어와 같은 셈으로 칠한다 — 구운 조각 = 기본색 × 구운 빛 × 세기/π × 빛 색, 그 밖(바닥·설비) =
  기본색 × 꼭짓점 그늘 × 반구광(+ 외관 설비는 해 방향 빛) / π. 실시간 그림자·반사 없음(뷰어와 같음), AgX.
  여기 쓰는 세기·색이 보고하는 뷰어 권장값이다(LOOK).
- `solid`: 형태 확인용(Workbench, 굽기 없이도).
배치: contract.json의 `samples.narrow`(가장 좁은 정면) 외관 조각·설비. 실내 방은 아래 ROOM(홀 12×8m, 뒷벽 = 4m 벽 · 4m 정문 · 4m 벽).
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

# 뷰어 권장값(보고에 씀) — 실내는 packages/core/src/domain/templates/look.ts에, 외관은 새 외관 look에
LOOK = {
    # 실내(2026-11-11 밤 사용자 의견 "전시관은 살짝 어둡게, 작품 쪽은 은은하게 밝게"): 방 전체는 한 단계 낮추고
    # 빛 색은 덜 주황인 따뜻한 흰색, 작품은 빛 웅덩이(가산)로 둘레보다 밝게. 뷰어 look.ts에 옮길 제안값.
    'interior': {
        'bakedIntensity': 2.9,
        'bakedColor': (1.0, 0.957, 0.905),
        'hemiSky': (1.0, 0.965, 0.92),
        'hemiGround': (0.62, 0.56, 0.49),
        'hemiIntensity': 1.5,
        'background': (0.10, 0.09, 0.08),
        'pool': (1.0, 0.93, 0.82),
        'poolStrength': 0.22,
    },
    'exterior': {
        'bakedIntensity': 5.0,
        'bakedColor': (1.0, 1.0, 1.0),
        'hemiSky': (0.80, 0.87, 0.97),
        'hemiGround': (0.62, 0.60, 0.52),
        'hemiIntensity': 2.2,
        'sunColor': (1.0, 0.95, 0.86),
        'sunIntensity': 2.6,
        'sunDir': (0.0, 1.0, 1.0),  # Blender 좌표에서 해가 있는 쪽(세계 −Z = Blender +Y, 45°)
        'lawn': (0.25, 0.33, 0.16),
    },
}
HEMI_SCALE_BAKED = 0.15


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--contract', default=None)
    p.add_argument('--mode', default='viewer')
    p.add_argument('--only', default='front,plaza,portico,stairs,corner,door,interior,fixtures')
    p.add_argument('--res', default='1600x1000')
    p.add_argument('--samples', type=int, default=24)
    return p.parse_args(argv)


def gl_to_bl(p):
    return Vector((p[0], -p[2], p[1]))


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    made = [o for o in bpy.data.objects if o not in before]
    protos = {}
    for o in made:
        if o.type == 'MESH' and o.parent is None:
            protos[o.name.split('.')[0]] = o
    for o in protos.values():
        o.hide_render = True
        o.hide_viewport = True
        o.location = (0, 0, 0)
    return protos


def place(protos, name, pos_gl, rot_y, coll):
    src = protos.get(name)
    if src is None:
        return None
    o = src.copy()
    o.hide_render = False
    o.hide_viewport = False
    o.location = gl_to_bl(pos_gl)
    o.rotation_mode = 'XYZ'
    o.rotation_euler = Euler((0.0, 0.0, rot_y))
    coll.objects.link(o)
    return o


# ── 뷰어와 같은 셈의 재질 ────────────────────────────────────────


def _images(mat):
    """불러온 glTF 재질에서 기본색 질감(Base Color에 이어진 것)과 구운 빛(두 번째 UV를 쓰는 것)을 찾는다.
    내보내기가 그림 이름을 파일 이름으로 바꾸므로 이름이 아니라 연결로 찾는다."""
    base = lm = None
    base_uv = lm_uv = None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    def upstream_image(sock, depth=0):
        if not sock.is_linked or depth > 4:
            return None
        n = sock.links[0].from_node
        if n.type == 'TEX_IMAGE':
            return n
        for inp in n.inputs:
            found = upstream_image(inp, depth + 1)
            if found is not None:
                return found
        return None

    if bsdf is not None:
        n = upstream_image(bsdf.inputs['Base Color'])
        if n is not None:
            base = n.image
            vec = n.inputs['Vector']
            base_uv = vec.links[0].from_node.uv_map if vec.is_linked and vec.links[0].from_node.type == 'UVMAP' else None
    for n in mat.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or n.image is None:
            continue
        vec = n.inputs['Vector']
        if vec.is_linked and vec.links[0].from_node.type == 'UVMAP':
            uvname = vec.links[0].from_node.uv_map
            if uvname.endswith('.001'):
                lm, lm_uv = n.image, uvname
    return base, base_uv, lm, lm_uv


def viewer_material(mat, look, outdoor, baked_override=None, has_color=False):
    """원래 재질의 기본색·구운 빛을 읽어 방출(emission)만으로 뷰어 셈을 흉내 낸다."""
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    base_col = tuple(bsdf.inputs['Base Color'].default_value) if bsdf else (0.8, 0.8, 0.8, 1)
    metal = bsdf.inputs['Metallic'].default_value if bsdf else 0.0
    emis = tuple(bsdf.inputs['Emission Color'].default_value)[:3] if bsdf else (0, 0, 0)
    emis_s = bsdf.inputs['Emission Strength'].default_value if bsdf else 0.0
    alpha_linked = bsdf is not None and bsdf.inputs['Alpha'].is_linked
    base, base_uv, lm, lm_uv = _images(mat)
    m = bpy.data.materials.new(f'V_{mat.name}')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')

    def tex(img, uv):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        if uv:
            u = nt.nodes.new('ShaderNodeUVMap')
            u.uv_map = uv
            nt.links.new(u.outputs['UV'], t.inputs['Vector'])
        return t

    def mul(a, b):
        n = nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = 'MULTIPLY'
        s = {x.identifier: x for x in n.inputs}
        s['Factor_Float'].default_value = 1.0
        for sock, v in (('A_Color', a), ('B_Color', b)):
            if isinstance(v, tuple):
                s[sock].default_value = (*v[:3], 1.0)
            else:
                nt.links.new(v, s[sock])
        return {x.identifier: x for x in n.outputs}['Result_Color']

    base_t = tex(base, base_uv) if base is not None else None
    albedo = base_t.outputs['Color'] if base_t else tuple(base_col)
    surface = mat.name.split('__')[0].removeprefix('M_')
    if not outdoor and surface in look.get('surfaces', {}):
        albedo = mul(albedo, tuple(look['surfaces'][surface]))
    # 금속은 뷰어에서 환경맵이 대부분 — 미리 보기에서는 기본색을 밝기 대신 조금만
    if metal > 0.5:
        albedo = mul(albedo, (0.55, 0.55, 0.55))
    k = look['bakedIntensity'] / math.pi
    hemi = None
    attr = nt.nodes.new('ShaderNodeVertexColor')
    if lm is not None and baked_override is not False:
        lmt = tex(lm, lm_uv)
        light = mul(lmt.outputs['Color'], tuple(c * k for c in look['bakedColor']))
        col = mul(albedo, light)
    else:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
        f = nt.nodes.new('ShaderNodeMapRange')
        f.inputs['From Min'].default_value = -1.0
        f.inputs['From Max'].default_value = 1.0
        nt.links.new(sep.outputs['Z'], f.inputs['Value'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        s = {x.identifier: x for x in mix.inputs}
        s['A_Color'].default_value = (*[c * look['hemiIntensity'] / math.pi for c in look['hemiGround']], 1)
        s['B_Color'].default_value = (*[c * look['hemiIntensity'] / math.pi for c in look['hemiSky']], 1)
        nt.links.new(f.outputs['Result'], s['Factor_Float'])
        hemi = {x.identifier: x for x in mix.outputs}['Result_Color']
        if outdoor and 'sunDir' in look:
            dot = nt.nodes.new('ShaderNodeVectorMath')
            dot.operation = 'DOT_PRODUCT'
            dot.inputs[1].default_value = Vector(look['sunDir']).normalized()
            nt.links.new(geo.outputs['Normal'], dot.inputs[0])
            cl = nt.nodes.new('ShaderNodeMath')
            cl.operation = 'MAXIMUM'
            cl.inputs[1].default_value = 0.0
            nt.links.new(dot.outputs['Value'], cl.inputs[0])
            sm = nt.nodes.new('ShaderNodeMix')
            sm.data_type = 'RGBA'
            ss = {x.identifier: x for x in sm.inputs}
            sm.blend_type = 'ADD'
            nt.links.new(cl.outputs['Value'], ss['Factor_Float'])
            nt.links.new(hemi, ss['A_Color'])
            ss['B_Color'].default_value = (*[c * look['sunIntensity'] / math.pi for c in look['sunColor']], 1)
            hemi = {x.identifier: x for x in sm.outputs}['Result_Color']
        light = mul(hemi, attr.outputs['Color']) if has_color else hemi
        col = mul(albedo, light)
    if emis_s > 0:
        add = nt.nodes.new('ShaderNodeMix')
        add.data_type = 'RGBA'
        add.blend_type = 'ADD'
        s = {x.identifier: x for x in add.inputs}
        s['Factor_Float'].default_value = 1.0
        nt.links.new(col, s['A_Color'])
        s['B_Color'].default_value = (*[c * emis_s for c in emis], 1)
        col = {x.identifier: x for x in add.outputs}['Result_Color']
    nt.links.new(col, em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    if alpha_linked and base_t is not None:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mx = nt.nodes.new('ShaderNodeMixShader')
        if mat.name.startswith('M_Shadow'):
            # 그림자 판: 검정 × 알파 → 곱하기 대신 투명 위 검은 방출(어둡게)
            black = nt.nodes.new('ShaderNodeEmission')
            black.inputs['Color'].default_value = (0, 0, 0, 1)
            nt.links.new(base_t.outputs['Alpha'], mx.inputs['Fac'])
            nt.links.new(tr.outputs['BSDF'], mx.inputs[1])
            nt.links.new(black.outputs['Emission'], mx.inputs[2])
        else:
            gt = nt.nodes.new('ShaderNodeMath')
            gt.operation = 'GREATER_THAN'
            gt.inputs[1].default_value = 0.5
            nt.links.new(base_t.outputs['Alpha'], gt.inputs[0])
            nt.links.new(gt.outputs['Value'], mx.inputs['Fac'])
            nt.links.new(tr.outputs['BSDF'], mx.inputs[1])
            nt.links.new(em.outputs['Emission'], mx.inputs[2])
        nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])
    else:
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    m.use_backface_culling = mat.use_backface_culling
    return m


def apply_viewer_materials(objs, look, outdoor):
    cache = {}
    for o in objs:
        if o.type != 'MESH':
            continue
        has_color = len(o.data.color_attributes) > 0
        for i, slot in enumerate(o.material_slots):
            mat = slot.material
            if mat is None:
                continue
            key = (mat.name, outdoor, has_color)
            if key not in cache:
                cache[key] = viewer_material(mat, look, outdoor, has_color=has_color)
            o.material_slots[i].link = 'OBJECT'
            o.material_slots[i].material = cache[key]


# ── 장면 ───────────────────────────────────────────────────────


def new_scene(name, mode, res, samples, background):
    scene = bpy.data.scenes.new(name)
    bpy.context.window.scene = scene if bpy.context.window else scene
    w, h = (int(v) for v in res.split('x'))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    if mode == 'solid':
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
    else:
        # 방출만 쓰는 셈이라 빛 튕김이 없다 — EEVEE로 충분하고 가볍다
        scene.render.engine = 'BLENDER_EEVEE'
        scene.eevee.taa_render_samples = samples
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'None'
    world = bpy.data.worlds.new(f'W_{name}')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*background, 1.0)
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    return scene


def sky_background(scene, zenith=(0.36, 0.53, 0.86), horizon=(0.86, 0.90, 0.95)):
    nt = scene.world.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mx = nt.nodes.new('ShaderNodeMath')
    mx.operation = 'MAXIMUM'
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 0.6
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    s = {x.identifier: x for x in mix.inputs}
    s['A_Color'].default_value = (*horizon, 1)
    s['B_Color'].default_value = (*zenith, 1)
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mx.inputs[0])
    nt.links.new(mx.outputs['Value'], pw.inputs[0])
    nt.links.new(pw.outputs['Value'], s['Factor_Float'])
    nt.links.new({x.identifier: x for x in mix.outputs}['Result_Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def camera(scene, pos, target, lens=28.0, name='Cam'):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_end = 400
    cam = bpy.data.objects.new(name, data)
    scene.collection.objects.link(cam)
    cam.location = Vector(pos)
    d = Vector(target) - Vector(pos)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    scene.camera = cam
    return cam


def lawn(scene, z, color, half=120.0):
    me = bpy.data.meshes.new('Lawn')
    me.from_pydata([(-half, -half, z), (half, -half, z), (half, half, z), (-half, half, z)], [], [[0, 1, 2, 3]])
    o = bpy.data.objects.new('Lawn', me)
    mat = bpy.data.materials.new('Lawn')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    me.materials.append(mat)
    scene.collection.objects.link(o)
    return o


def render(scene, path):
    scene.render.filepath = path
    bpy.context.window.scene = scene if bpy.context.window else scene
    bpy.ops.render.render(write_still=True, scene=scene.name)
    print(f'[render] {path}', flush=True)


def exterior_scene(args, c, ext, fix, view):
    look = LOOK['exterior']
    sc = new_scene(f'ext_{view}', args.mode, args.res, args.samples, (0.8, 0.86, 0.95))
    if args.mode != 'solid':
        sky_background(sc)
    sample = c['samples']['narrow']
    placed = []
    for m in sample['modules']:
        o = place(ext, m['type'], m['pos'], m['rotY'], sc.collection)
        if o:
            placed.append(o)
    for f in sample['fixtures']:
        if f['kind'] in fix:
            o = place(fix, f['kind'], f['pos'], f['rotY'], sc.collection)
            if o:
                placed.append(o)
    gy = sample['exterior']['groundY']
    lw = lawn(sc, gy - 0.02, look['lawn'])
    if args.mode != 'solid':
        apply_viewer_materials(placed, look, outdoor=True)
    e = c['geometry']['exterior']
    zf = sample['exterior']['facadeZ']
    zpf = zf - e['porticoD']
    zsb = zpf - e['steps'] * e['stepRunM']
    eye = c['config']['CAMERA_HEIGHT_M']
    if view == 'front':
        spawn = zsb - e['spawnFromStairsM']
        camera(sc, gl_to_bl((0.0, gy + eye + 2.6, spawn - 8.5)), gl_to_bl((0.0, 2.4, zf)), lens=22)
    elif view == 'portico':
        camera(sc, gl_to_bl((-4.2, eye, zpf - 0.9)), gl_to_bl((1.2, 2.6, zf)), lens=20)
    elif view == 'stairs':
        camera(sc, gl_to_bl((9.5, gy + 1.3, zsb - 5.0)), gl_to_bl((2.0, -0.4, zpf)), lens=28)
    elif view == 'plaza':
        zb = sample['exterior']['plaza']['min'][1]
        camera(sc, gl_to_bl((-5.0, gy + 6.5, zb + 1.5)), gl_to_bl((1.0, 0.0, zf - 4.0)), lens=24)
    elif view == 'corner':
        hw = sample['exterior']['halfWidth']
        camera(sc, gl_to_bl((hw - 4.5, gy + 1.7, zf - 6.5)), gl_to_bl((hw, gy + 2.2, zf)), lens=26)
    elif view == 'door':
        camera(sc, gl_to_bl((0.6, eye + 0.1, zf - 3.4)), gl_to_bl((0.0, 1.7, zf)), lens=22)
    _ = lw
    return sc


def interior_scene(args, c, core, fix):
    look = LOOK['interior']
    sc = new_scene('interior', args.mode, args.res, args.samples, look['background'])
    placed = []

    def put(name, x, z, rot, y=0.0):
        o = place(core if name.startswith('mh_') else fix, name, (x, y, z), rot, sc.collection)
        if o:
            placed.append(o)
        return o

    W, D = 12.0, 8.0
    hw = W / 2
    # 뒷벽(z = −D, 안쪽 +Z, 지역 +X = 세계 +X): 4m 벽 · 4m 정문 · 4m 벽
    put('mh_wall_4m', -hw, -D, 0.0)
    put('mh_entrance_4m', -2.0, -D, 0.0)
    put('mh_wall_4m', 2.0, -D, 0.0)
    # 오른쪽 벽(x = +6, 안쪽 −X, 지역 +X = 세계 +Z)
    r = -math.pi / 2
    put('mh_wall_4m', hw, -D, r)
    put('mh_wall_door_2m', hw, -4.0, r)
    put('mh_wall_2m', hw, -2.0, r)
    # 왼쪽 벽(x = −6, 안쪽 +X, 지역 +X = 세계 −Z)
    l = math.pi / 2
    put('mh_wall_4m', -hw, 0.0, l)
    put('mh_wall_4m', -hw, -4.0, l)
    # 앞벽(z = 0, 안쪽 −Z, 지역 +X = 세계 −X) — 카메라 뒤
    put('mh_wall_4m', hw, 0.0, math.pi)
    put('mh_wall_4m', 2.0, 0.0, math.pi)
    put('mh_wall_4m', -2.0, 0.0, math.pi)
    for x, z, rot in ((-hw, -D, 0.0), (hw, -D, r), (hw, 0.0, math.pi), (-hw, 0.0, l)):
        put('mh_corner_in', x, z, rot)
    for i in range(6):
        for j in range(4):
            put('mh_floor_2x2', -hw + 2 * i, -D + 2 * j, 0.0)
            put('mh_ceiling_2x2', -hw + 2 * i, -D + 2 * j, 0.0)
    # 설비
    off = c['geometry']['fixtures']['wallOffsetM']
    put('bench', 0.0, -3.2, 0.0)
    put('plant', -4.9, -7.45, 0.0)
    put('plant', 4.9, -7.45, 0.0)
    put('easel', -3.2, -4.4, 0.0)
    put('introPanel', -hw + off, -2.4, math.pi / 2, y=c['config']['EYE_HEIGHT_M'])
    put('hallSign', 0.0, -0.9, math.pi, y=c['config']['WALL_HEIGHT_M'] - c['geometry']['fixtures']['hallSignDropM'])
    for item in c.get('decorations', []):
        x, y, z = item['pos']
        put(item['kind'], x, z, item['rotY'], y=y)
    # 합성 그림(시안): 오른쪽 벽 두 점 + 이젤 위 한 점
    synth = []
    synth.append(painting(sc, 'ArtA', (hw - 0.08, 1.75, -6.8), -math.pi / 2, (1.35, 1.0), seed=1))
    synth.append(painting(sc, 'ArtB', (-hw + 0.08, 1.7, -6.0), math.pi / 2, (1.6, 1.15), seed=3))
    synth.append(painting(sc, 'ArtC', (-3.2, c['config']['EASEL_LEDGE_Y_M'] + 0.45, -4.4 + 0.0), 0.0, (0.75, 0.9), seed=5, easel=True))
    if args.mode != 'solid':
        apply_viewer_materials(placed, look, outdoor=False)
    camera(sc, gl_to_bl((3.6, 1.65, -0.6)), gl_to_bl((-1.2, 1.55, -8.0)), lens=22)
    _ = synth
    return sc


def painting(scene, name, pos_gl, rot, size, seed=1, easel=False):
    """합성 그림(시안 자료 — 실제 작품 아님): 색면 추상 + 어두운 테. 뷰어의 액자와 비슷한 두께."""
    import numpy as np

    w, h = size
    rng = np.random.default_rng(seed)
    px = 256
    img = np.zeros((px, px, 4), dtype=np.float32)
    img[..., 3] = 1
    palette = rng.uniform(0.15, 0.85, (4, 3))
    yy, xx = np.mgrid[0:px, 0:px] / px
    img[..., :3] = palette[0]
    for k in range(1, 4):
        cx, cy, r = rng.uniform(0.2, 0.8), rng.uniform(0.2, 0.8), rng.uniform(0.15, 0.35)
        m = ((xx - cx) ** 2 + (yy - cy) ** 2) < r * r
        img[m, :3] = palette[k]
    bimg = bpy.data.images.new(f'P_{name}', px, px)
    bimg.pixels.foreach_set(img.ravel())
    me = bpy.data.meshes.new(name)
    t = 0.05
    hw, hh = w / 2, h / 2
    f = -t - 0.004  # 테(상자) 앞면보다 조금 앞
    verts = [(-hw, f, -hh), (hw, f, -hh), (hw, f, hh), (-hw, f, hh)]
    me.from_pydata(verts, [], [[0, 1, 2, 3]])
    uv = me.uv_layers.new(name='UVMap')
    for li, (u, v) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    o = bpy.data.objects.new(name, me)
    mat = bpy.data.materials.new(f'PM_{name}')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = bimg
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 0.92
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tx.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    me.materials.append(mat)
    # 테(어두운 나무)
    bpy.ops.mesh.primitive_cube_add(size=1)
    fr = bpy.context.active_object
    fr.scale = (w + 0.12, t, h + 0.12)
    fr.location = (0, -t / 2 + 0.002, 0)
    fmat = bpy.data.materials.new(f'FR_{name}')
    fmat.use_nodes = True
    fnt = fmat.node_tree
    fnt.nodes.clear()
    fe = fnt.nodes.new('ShaderNodeEmission')
    fe.inputs['Color'].default_value = (0.05, 0.035, 0.025, 1)
    fo = fnt.nodes.new('ShaderNodeOutputMaterial')
    fnt.links.new(fe.outputs['Emission'], fo.inputs['Surface'])
    fr.data.materials.append(fmat)
    for coll in fr.users_collection:
        coll.objects.unlink(fr)
    root = bpy.data.objects.new(f'{name}_root', None)
    scene.collection.objects.link(root)
    scene.collection.objects.link(o)
    scene.collection.objects.link(fr)
    o.parent = root
    fr.parent = root
    if not easel:
        pool = light_pool(name, w, h)
        scene.collection.objects.link(pool)
        pool.parent = root
    root.location = gl_to_bl(pos_gl)
    root.rotation_euler = Euler((0.0, 0.0, rot))
    return root


def light_pool(name, w, h):
    """작품 빛 웅덩이(뷰어의 가산 판, ADR-013 흉내): 벽 면 바로 앞, 작품보다 넓은 타원 기울기로 은은히 밝힌다."""
    look = LOOK['interior']
    pw, ph = w * 1.9 + 0.6, h * 1.7 + 0.6
    me = bpy.data.meshes.new(f'Pool_{name}')
    y = -0.003
    me.from_pydata([(-pw / 2, y, -ph / 2 - 0.1), (pw / 2, y, -ph / 2 - 0.1), (pw / 2, y, ph / 2 - 0.1), (-pw / 2, y, ph / 2 - 0.1)], [], [[0, 1, 2, 3]])
    uv = me.uv_layers.new(name='UVMap')
    for li, (u, v) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    o = bpy.data.objects.new(f'Pool_{name}', me)
    mat = bpy.data.materials.new(f'Pool_{name}')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'QUADRATIC_SPHERE'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (-1.0, -1.0, 0.0)
    mp.inputs['Scale'].default_value = (2.0, 2.0, 1.0)
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], grad.inputs['Vector'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*look['pool'], 1.0)
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = look['poolStrength']
    nt.links.new(grad.outputs['Fac'], mul.inputs[0])
    nt.links.new(mul.outputs['Value'], em.inputs['Strength'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(tr.outputs['BSDF'], add.inputs[0])
    nt.links.new(em.outputs['Emission'], add.inputs[1])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(add.outputs['Shader'], out.inputs['Surface'])
    me.materials.append(mat)
    return o


def fixtures_scene(args, c, fix):
    look = LOOK['interior']
    sc = new_scene('fixtures', args.mode, args.res, args.samples, (0.80, 0.78, 0.75))
    placed = []
    items = [('easel', -3.3, 0.0), ('bench', -1.2, 0.3), ('plant', 0.6, 0.0), ('lamp', 1.9, 0.0), ('tree', 5.2, -2.0)]
    for name, x, z in items:
        o = place(fix, name, (x, 0.0, z), 0.0, sc.collection)
        if o:
            placed.append(o)
    for name, x, y in (('nameplate', -2.2, 2.6), ('exitSign', -0.2, 2.6), ('corridorNameplate', 1.5, 2.6), ('soundPlaque', -1.1, 1.6), ('introPanel', -4.9, 1.4)):
        o = place(fix, name, (x, y, -0.6), 0.0, sc.collection)
        if o:
            placed.append(o)
    # 바닥 판(대리석 대신 밝은 회색)
    me = bpy.data.meshes.new('Floor')
    me.from_pydata([(-12, -12, 0), (12, -12, 0), (12, 12, 0), (-12, 12, 0)], [], [[0, 1, 2, 3]])
    fl = bpy.data.objects.new('Floor', me)
    fm = bpy.data.materials.new('FloorM')
    fm.use_nodes = True
    fnt = fm.node_tree
    fnt.nodes.clear()
    em = fnt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.62, 0.60, 0.57, 1)
    o2 = fnt.nodes.new('ShaderNodeOutputMaterial')
    fnt.links.new(em.outputs['Emission'], o2.inputs['Surface'])
    me.materials.append(fm)
    sc.collection.objects.link(fl)
    if args.mode != 'solid':
        apply_viewer_materials(placed, LOOK['exterior'] | {'hemiSky': look['hemiSky'], 'hemiGround': look['hemiGround']}, outdoor=True)
    camera(sc, gl_to_bl((0.6, 2.4, 8.2)), gl_to_bl((0.6, 1.5, -0.6)), lens=30)
    return sc


def decorations_scene(args, c, fix):
    """새 장식만 같은 배율로 모은 검수 그림. 실시간 조명 없이 꼭짓점 그늘·발광을 확인한다."""
    look = LOOK['interior']
    sc = new_scene('decorations', args.mode, '1600x1000', args.samples, (0.12, 0.11, 0.10))
    placed = []
    for name, pos in (
        ('barrier', (-2.2, 0, 0)), ('artPlinth', (0, 0, 0)), ('exitPortal', (2.2, 0, -0.4)),
        ('spotRail', (-2.2, 2.7, 0)), ('wallSconce', (0, 1.6, 0)),
    ):
        o = place(fix, name, pos, 0, sc.collection)
        if o:
            placed.append(o)
    if args.mode != 'solid':
        apply_viewer_materials(placed, look, outdoor=False)
    camera(sc, gl_to_bl((4.2, 3.2, 8)), gl_to_bl((0, 1.5, 0)), lens=40)
    return sc


def use_contract_look(c):
    """제품의 기본 분위기를 읽는다. 예전 밝은 시안 값을 최종 포스터에 재사용하지 않는다."""
    look = c.get('look')
    if look is None:
        return

    def linear(hex_color):
        values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)

    LOOK['interior'].update({
        'bakedIntensity': look['baked']['intensity'], 'bakedColor': linear(look['baked']['color']),
        'hemiSky': linear(look['hemisphere']['sky']), 'hemiGround': linear(look['hemisphere']['ground']),
        'hemiIntensity': look['hemisphere']['intensity'], 'background': linear(look['background']),
        'pool': linear(look['pool']['color']), 'poolStrength': look['pool']['opacity'],
        'surfaces': {name: linear(color) for name, color in look.get('surfaces', {}).items()},
    })


def main():
    args = parse_args()
    src = os.path.abspath(args.src)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    import json

    with open(args.contract or os.path.join(src, 'contract.json'), encoding='utf-8') as f:
        c = json.load(f)
    use_contract_look(c)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    core = import_glb(os.path.join(src, 'modern-history-core.glb'))
    ext = import_glb(os.path.join(src, 'modern-history-exterior.glb'))
    fix = import_glb(os.path.join(src, 'modern-history-fixtures.glb'))
    only = args.only.split(',')
    tag = '' if args.mode == 'viewer' else f'-{args.mode}'
    for view in ('front', 'plaza', 'portico', 'stairs', 'corner', 'door'):
        if view in only:
            sc = exterior_scene(args, c, ext, fix, view)
            render(sc, os.path.join(out, f'{view}{tag}.png'))
    if 'interior' in only:
        sc = interior_scene(args, c, core, fix)
        render(sc, os.path.join(out, f'interior{tag}.png'))
    if 'fixtures' in only:
        sc = fixtures_scene(args, c, fix)
        render(sc, os.path.join(out, f'fixtures{tag}.png'))
    if 'decorations' in only:
        sc = decorations_scene(args, c, fix)
        render(sc, os.path.join(out, f'decorations{tag}.png'))
    for name, size in (('poster', (900, 1200)), ('template-card', (960, 600))):
        if name in only:
            sc = interior_scene(args, c, core, fix)
            sc.render.resolution_x, sc.render.resolution_y = size
            if name == 'poster':
                camera(sc, gl_to_bl((0.6, 1.9, -0.8)), gl_to_bl((-3.3, 1.7, -5.3)), lens=24)
            render(sc, os.path.join(out, f'{name}{tag}.png'))


if __name__ == '__main__':
    main()
