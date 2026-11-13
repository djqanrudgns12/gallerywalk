"""근대 역사관 조각 만들기·굽기·내보내기 (P1-3·R-3, tools/assets/spec/modules.md, ADR-013·051·057).

실행(무거운 굽기라 resource-guard로 한 번에 하나):
  node tools/assets/pipeline/contract.mjs .local/art/build/modern-history      # 배치 계약 → contract.json
  resource-guard run --profile build -- \\
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
    -P tools/assets/blender/build.py -- --out .local/art/build/modern-history \\
    [--samples 512] [--no-bake] [--only core,exterior,fixtures]

결과(<out>): modern-history-{core,exterior,fixtures}.glb (최적화 전), manifest.json, textures/*.png, lightmaps/*.png
  → tools/assets/pipeline/build.mjs가 KTX2·meshopt로 줄여 apps/web/src/tpl/modern-history/에 둔다.

굽기 규칙
- 실내(ADR-051): 표준 조명틀 = 천장 아래 넓은 확산광(천창). x 방향으로 변하지 않아 어느 조각을 어디에 이어 붙여도
  같은 빛이다. 노출은 **모든 실내 조각이 하나**(4m 벽 회반죽의 작품 높이 띠). 밝기만(회색) 굽고 색은 뷰어가 곱한다.
- 외관(R-3): 하늘(위가 푸른 기울기) + 해(광장 쪽에서 45°, 정면). 해가 정면이라 현관의 그림자가 날개 벽·광장에
  떨어지지 않는다(나눠 쓰는 조각이 그 그림자를 가질 수 없음). 노출은 **외관 조각 전체가 하나**(날개 벽 면), 실내와 따로.
  해·하늘 빛 색이 다르므로 **색 있는** 구운 빛(RGB)을 싣는다 — 뷰어는 외관 재질의 빛 색을 흰색으로 둔다.
- 값 = 확산 직접광 + 간접광(재질 색 없음) → 위치·법선을 길잡이로 한 결합 양방향 걸러내기(잡음 제거) → 1 − e^(−배율·x).
  three에서는 `lightMap`(조도에 더함)으로 읽는다(viewer/scene/TemplateModules.tsx).
- 설비(R-3): 구운 빛 없음(어디에 놓일지 모름). 꼭짓점 색(COLOR_0)에 구운 그늘(AO) + 바닥 그림자 판(구운 알파).
"""

import argparse
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exterior  # noqa: E402
import fixtures  # noqa: E402
import geometry  # noqa: E402
import textures  # noqa: E402

TEMPLATE = 'modern-history'
TILE_M = 2.0  # 질감 한 장 = 2m (UV0 1 = 2m)
ROUGH_METAL = {
    'M_Plaster': (0.92, 0.0),
    'M_Panel': (0.5, 0.0),
    'M_Molding': (0.45, 0.0),
    'M_Ceiling': (0.9, 0.0),
    'M_Brass': (0.32, 0.9),
    'M_Floor': (0.28, 0.0),
    'M_Marble': (0.22, 0.0),
    'M_Stone': (0.82, 0.0),
    'M_Ashlar': (0.86, 0.0),
    'M_Paving': (0.78, 0.0),
    'M_Hedge': (0.9, 0.0),
    'M_Bronze': (0.42, 0.85),
    'M_Oak': (0.5, 0.0),
    'M_Leather': (0.45, 0.0),
    'M_Iron': (0.55, 0.35),
    'M_Glass': (0.12, 0.0),
    'M_SignFace': (0.6, 0.0),
    'M_Card': (0.85, 0.0),
    'M_Bark': (0.95, 0.0),
    'M_Leaf': (0.7, 0.0),
    'M_Shadow': (1.0, 0.0),
}
# 질감 없이 값만 쓰는 칸(sRGB)
SOLID_SRGB = {
    'M_Brass': (0.70, 0.55, 0.32),
    'M_Iron': (0.075, 0.09, 0.085),
    'M_Glass': (0.93, 0.88, 0.76),
    'M_SignFace': (0.105, 0.145, 0.255),  # 깊은 감색(ADR-057 강조색)
    'M_Card': (0.95, 0.935, 0.895),  # 상아색 글 판
    'M_Shadow': (0.0, 0.0, 0.0),
}
EMISSIVE_SRGB = {'M_Glass': (0.55, 0.45, 0.30)}  # 등 유리: 낮에도 은은히 따뜻하게
# 질감 크기(2m 한 장). 설비에만 쓰는 칸은 작게(물건이 작다).
TEX_PX = {'M_Oak': 512, 'M_Leather': 512, 'M_Bark': 512, 'M_Bronze': 512, 'M_Leaf': 1024}
# 굽기용 회색 반사율(선형) — 실제 기본색 질감의 평균 밝기와 맞춘 값(이웃이 되튕기는 빛의 세기)
BAKE_GRAY = {
    'M_Plaster': 0.80,
    'M_Panel': 0.33,
    'M_Molding': 0.22,
    'M_Ceiling': 0.86,
    'M_Brass': 0.3,
    'M_Floor': 0.68,
    'M_Marble': 0.82,
    'M_Stone': 0.66,
    'M_Ashlar': 0.62,
    'M_Paving': 0.45,
    'M_Hedge': 0.05,
    'M_Bronze': 0.1,
    'Ground': 0.30,
}

# ── 실내 표준 조명틀(천창, ADR-051) ───────────────────────────────────
ROOM_DEPTH_M = 8.0
LAYLIGHT_Z_M = 3.86  # 우물천장 보 아래(3.88), 천장 몰딩 높이
LAYLIGHT_MARGIN_M = 1.0
LAYLIGHT_RADIANCE = 1.4  # 상대값 — 절대 노출은 아래 공통 노출이 다시 맞춘다
AMBIENT = (0.022, 0.020, 0.018)  # 어두운 환경광(열린 옆면으로 새는 빛)
CONTEXT_SIDE_M = 8.0  # 굽는 벽 조각 양옆으로 이어 붙이는 길이 — 모든 벽 조각이 같은 주변을 본다
OUTSIDE_RADIANCE = 1.5  # 정문 굽기: 문 밖(밝은 현관) 대신 세운 빛 판 — 벽 두께 면의 바깥 쪽이 어둡지 않게

# 공통 노출(실내)
EXPOSURE_REF_BAND_Z = (1.3, 2.3)
EXPOSURE_REF_BAND_X = (0.5, 3.5)
EXPOSURE_REF_OUT = 0.62

# ── 외관 조명틀(하늘 + 해) ─────────────────────────────────────────
EXT_SUN_ELEV_DEG = 45.0
EXT_SUN_STRENGTH = 3.2  # 해에 수직인 면의 조도(상대값)
EXT_SUN_ANGLE_DEG = 1.5  # 그림자 가장자리 부드러움
EXT_SUN_COLOR = (1.0, 0.95, 0.86)
EXT_SKY_ZENITH = (0.36, 0.52, 0.88)
EXT_SKY_HORIZON = (0.80, 0.86, 0.95)
EXT_SKY_STRENGTH = 0.9
EXT_REF_OUT = 0.62  # 외관 기준(날개 벽 면, 해 받는 곳) 평균이 곡선 뒤 이 값
EXT_LM_PX = {
    'mh_ext_portico_12m': 2048,
    'mh_ext_stairs_12m': 1024,
    'mh_ext_wall_2m': 512,
    'mh_ext_wall_end': 512,
    'mh_ext_plaza_2x2': 16,
    'mh_ext_hedge_2m': 256,
}
EXT_LM_MARGIN = {2048: 0.004, 1024: 0.006, 512: 0.01, 256: 0.02, 16: 0.0}
# 뷰어 권장값(미리 보기 렌더로 맞춤, 보고에 씀): lightMapIntensity, 빛 색 흰색
EXT_VIEWER_INTENSITY = 5.0

# 맞닿음 그늘(짧은 거리 AO를 구운 빛에 곱함, 2026-11-11 밤 사용자 의견 "몰딩 그림자가 또렷하게"):
# (거리 m, 세기) — 세기 0.5면 완전히 막힌 곳이 빛의 절반
INTERIOR_AO = (0.22, 0.5)
EXTERIOR_AO = (0.35, 0.35)

# 표본·잡음 제거
CEILING_SAMPLES_X = 4  # 천장은 간접광만 받아 잡음이 크다
DENOISE_RADIUS_PX = 3
DENOISE_SIGMA_PX = 1.6
DENOISE_SIGMA_POS_M = 0.03
DENOISE_SIGMA_NRM = 0.08


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    p.add_argument('--contract', default=None, help='contract.json (기본 <out>/contract.json)')
    p.add_argument('--samples', type=int, default=512)
    p.add_argument('--albedo', type=int, default=1024)
    p.add_argument('--no-bake', action='store_true')
    p.add_argument('--only', default='core,exterior,fixtures')
    return p.parse_args(argv)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.engine = 'CYCLES'
    scene.cycles.seed = 7  # 같은 입력이면 같은 굽기
    # GitHub 호스트 macOS 러너의 가상 GPU에서는 Cycles Metal 굽기가 끝나지 않는다(실행 43403932448, 첫 판 5시간).
    # GALLERY_CYCLES_DEVICE=CPU면 GPU를 찾지 않는다. 같은 시드·표본이라 결과 기준은 그대로다.
    if os.environ.get('GALLERY_CYCLES_DEVICE', '').upper() == 'CPU':
        scene.cycles.device = 'CPU'
        print('[build] Cycles 장치: CPU(GALLERY_CYCLES_DEVICE)', flush=True)
        interior_world()
        return scene
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU' if any(d.use and d.type != 'CPU' for d in prefs.devices) else 'CPU'
    except Exception as exc:  # GPU가 없으면 CPU로(느리지만 결과는 같다)
        print(f'[build] GPU 설정 실패, CPU 사용: {exc}')
        scene.cycles.device = 'CPU'
    interior_world()
    return scene


def interior_world():
    world = bpy.data.worlds.get('BakeWorld') or bpy.data.worlds.new('BakeWorld')
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg.inputs['Color'].default_value = (*AMBIENT, 1.0)
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bpy.context.scene.world = world


def sky_world():
    """외관 하늘: 지평선(옅은 청백) → 꼭대기(푸름) 기울기. 땅 아래는 지평선 색(땅 판이 대부분 가린다)."""
    world = bpy.data.worlds.get('SkyWorld') or bpy.data.worlds.new('SkyWorld')
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    clamp = nt.nodes.new('ShaderNodeMath')
    clamp.operation = 'MAXIMUM'
    clamp.inputs[1].default_value = 0.0
    powr = nt.nodes.new('ShaderNodeMath')
    powr.operation = 'POWER'
    powr.inputs[1].default_value = 0.6
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    sock = {s.identifier: s for s in mix.inputs}
    sock['A_Color'].default_value = (*EXT_SKY_HORIZON, 1.0)
    sock['B_Color'].default_value = (*EXT_SKY_ZENITH, 1.0)
    mix_out = {s.identifier: s for s in mix.outputs}['Result_Color']
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = EXT_SKY_STRENGTH
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], clamp.inputs[0])
    nt.links.new(clamp.outputs['Value'], powr.inputs[0])
    nt.links.new(powr.outputs['Value'], sock['Factor_Float'])
    nt.links.new(mix_out, bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bpy.context.scene.world = world
    return world


def sun_from(toward_xy, elev_deg=EXT_SUN_ELEV_DEG, strength=EXT_SUN_STRENGTH, color=EXT_SUN_COLOR, name='Sun'):
    """해: `toward_xy`(xy 평면에서 해가 있는 쪽) 위 elev_deg에서 비춘다."""
    d = Vector((toward_xy[0], toward_xy[1], 0.0)).normalized()
    e = math.radians(elev_deg)
    to_sun = Vector((d.x * math.cos(e), d.y * math.cos(e), math.sin(e)))
    data = bpy.data.lights.new(name, 'SUN')
    data.energy = strength
    data.angle = math.radians(EXT_SUN_ANGLE_DEG)
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (-to_sun).to_track_quat('-Z', 'Y')
    bpy.context.scene.collection.objects.link(obj)
    return obj


def save_image(name, arr_in, path, non_color=False):
    """numpy 배열(H×W×3·H×W×4·H×W, 0..1)을 8비트 PNG로 저장하고 bpy 이미지를 돌려준다."""
    arr = np.asarray(arr_in, dtype=np.float32)
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, axis=2)
    h, w, ch = arr.shape
    alpha = ch == 4
    rgba = arr if alpha else np.concatenate([arr, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(rgba.ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    if alpha:
        img.alpha_mode = 'STRAIGHT'
    return img


def make_textures(out, size, slots):
    imgs = {}
    for slot in sorted(slots):
        px = TEX_PX.get(slot, size)
        if slot in textures.MAKERS:
            imgs[slot] = save_image(f'T_{slot}', textures.MAKERS[slot](px), os.path.join(out, 'textures', f'{slot}.png'))
        elif slot in textures.ALPHA_MAKERS:
            imgs[slot] = save_image(f'T_{slot}', textures.ALPHA_MAKERS[slot](px), os.path.join(out, 'textures', f'{slot}.png'))
    return imgs


def select_only(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def set_uv1(obj):
    """실내 굽기 UV: 겹침 없는 아틀라스(lightmap pack) — P1-3에서 이음새 시험을 통과한 방식 그대로."""
    me = obj.data
    if 'Lightmap' not in me.uv_layers:
        me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = me.uv_layers['Lightmap']
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False, PREF_BOX_DIV=16, PREF_MARGIN_DIV=0.4)
    bpy.ops.object.mode_set(mode='OBJECT')


def set_uv1_smart(obj, margin):
    """외관 굽기 UV: 곡면(기둥)을 섬으로 묶는 smart project → 섬 크기 고르게 → 묶기. 화소 밀도가 면 넓이에 비례."""
    me = obj.data
    if 'Lightmap' not in me.uv_layers:
        me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = me.uv_layers['Lightmap']
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60.0), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']


def gltf_output_group():
    """glTF 내보내기가 occlusion을 읽는 노드 묶음(이름 고정)."""
    name = 'glTF Material Output'
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    ng = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return ng


def export_material(slot, tag, albedo, lightmap=None, shadow_image=None):
    """내보낼 재질 `{칸}__{꼬리표}`. 질감 칸은 UV0 기본색, 값 칸은 단색. 구운 빛은 occlusion 칸(texCoord 1)에."""
    mat = bpy.data.materials.new(f'{slot}__{tag}')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    rough, metal = ROUGH_METAL[slot]
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    image = shadow_image if slot == 'M_Shadow' else albedo.get(slot)
    if slot in SOLID_SRGB and image is None:
        bsdf.inputs['Base Color'].default_value = (*[srgb_to_linear(c) for c in SOLID_SRGB[slot]], 1.0)
    else:
        uv0 = nt.nodes.new('ShaderNodeUVMap')
        uv0.uv_map = 'UVMap'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.links.new(uv0.outputs['UV'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if slot in ('M_Leaf', 'M_Shadow'):
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    if slot in EMISSIVE_SRGB:
        bsdf.inputs['Emission Color'].default_value = (*[srgb_to_linear(c) for c in EMISSIVE_SRGB[slot]], 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    if slot in ('M_Leaf', 'M_Glass'):
        mat.use_backface_culling = False
    else:
        mat.use_backface_culling = True
    if lightmap is not None:
        # glTF에는 lightMap 칸이 없어 occlusion 칸(texCoord 1)에 싣는다. 뷰어가 lightMap으로 옮긴다.
        uv1 = nt.nodes.new('ShaderNodeUVMap')
        uv1.uv_map = 'Lightmap'
        lm = nt.nodes.new('ShaderNodeTexImage')
        lm.image = lightmap
        group = nt.nodes.new('ShaderNodeGroup')
        group.node_tree = gltf_output_group()
        nt.links.new(uv1.outputs['UV'], lm.inputs['Vector'])
        nt.links.new(lm.outputs['Color'], group.inputs['Occlusion'])
    return mat


def gray_material(slot, target_image=None, emission=None):
    mat = bpy.data.materials.new(f'BAKE_{slot}')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    g = BAKE_GRAY.get(slot, 0.5)
    bsdf.inputs['Base Color'].default_value = (g, g, g, 1.0)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission
    if target_image is not None:
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = target_image
        nt.nodes.active = node
    return mat


def assign(obj, mats):
    """재질을 칸 번호 그대로 바꿔 끼운다(면의 칸 번호를 건드리지 않음)."""
    slots = obj.data.materials
    if len(slots) == len(mats):
        for i, m in enumerate(mats):
            slots[i] = m
        return
    slots.clear()
    for m in mats:
        slots.append(m)


def slot_names(obj):
    return [m.name[len('PH_') :] for m in obj.data.materials]


def plane(name, corners, slot, emission=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(corners, [], [list(range(len(corners)))])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    assign(obj, [gray_material(slot, emission=emission)])
    return obj


def laylight(x0, x1, y0, y1):
    """아래를 비추는 넓은 확산광(천창). 세기 = 복사휘도 × 넓이 × π(상대값)."""
    sx, sy = x1 - x0, y1 - y0
    data = bpy.data.lights.new(f'Laylight_{x0:.0f}_{y0:.0f}', 'AREA')
    data.shape = 'RECTANGLE'
    data.size = sx
    data.size_y = sy
    data.energy = LAYLIGHT_RADIANCE * sx * sy * math.pi
    data.color = (1.0, 1.0, 1.0)  # 색은 뷰어가 정한다(구운 빛은 밝기만)
    obj = bpy.data.objects.new(data.name, data)
    obj.location = ((x0 + x1) / 2, (y0 + y1) / 2, LAYLIGHT_Z_M)  # 기본 방향 = 아래(−Z)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box_floor_ceiling(made, rects):
    for i, (x0, x1, y0, y1) in enumerate(rects):
        made.append(plane(f'CtxFloor{i}', [(x0, y1, 0), (x0, y0, 0), (x1, y0, 0), (x1, y1, 0)], 'M_Floor'))
        made.append(plane(f'CtxCeiling{i}', [(x0, y0, 4), (x0, y1, 4), (x1, y1, 4), (x1, y0, 4)], 'M_Ceiling'))


def wall_context(module, length):
    """이웃 벽 사본(양옆 CONTEXT_SIDE_M) + 바닥·천장·맞은편 벽 + 천창. 문·정문은 4m 벽 사이."""
    made = []
    neighbor_len = 4.0 if module in ('mh_wall_door_2m', 'mh_entrance_4m') else length
    copies = math.ceil(CONTEXT_SIDE_M / neighbor_len)
    for i in range(copies):
        for x0 in (-(i + 1) * neighbor_len, length + i * neighbor_len):
            n = geometry.wall(neighbor_len)
            n.location.x = x0
            assign(n, [gray_material(s) for s in geometry.WALL_SLOTS])
            made.append(n)
    x_min, x_max = -CONTEXT_SIDE_M, length + CONTEXT_SIDE_M
    box_floor_ceiling(made, [(x_min, x_max, -ROOM_DEPTH_M, 0.0)])
    made.append(plane('CtxOpposite', [(x_min, -ROOM_DEPTH_M, 0), (x_min, -ROOM_DEPTH_M, 4), (x_max, -ROOM_DEPTH_M, 4), (x_max, -ROOM_DEPTH_M, 0)], 'M_Plaster'))
    made.append(laylight(x_min, x_max, -ROOM_DEPTH_M + LAYLIGHT_MARGIN_M, -LAYLIGHT_MARGIN_M))
    if module == 'mh_entrance_4m':
        # 문 밖 밝은 현관 대신: 벽 두께 뒤 1.2m에 문을 향한 빛 판
        y = geometry.WALL_T + 1.2
        made.append(plane('CtxOutside', [(0.3, y, 0.0), (3.7, y, 0.0), (3.7, y, 3.3), (0.3, y, 3.3)], 'M_Plaster', emission=OUTSIDE_RADIANCE))
    return made


def room_context(center):
    """천장·안쪽 모서리 조각용 방 하나(8×8m) + 천창."""
    made = []
    s = ROOM_DEPTH_M / 2
    cx, cy = center
    x0, x1, y0, y1 = cx - s, cx + s, cy - s, cy + s
    box_floor_ceiling(made, [(x0, x1, y0, y1)])
    for name, pts in {
        'CtxN': [(x0, y1, 0), (x1, y1, 0), (x1, y1, 4), (x0, y1, 4)],
        'CtxS': [(x0, y0, 0), (x0, y0, 4), (x1, y0, 4), (x1, y0, 0)],
        'CtxW': [(x0, y0, 0), (x0, y1, 0), (x0, y1, 4), (x0, y0, 4)],
        'CtxE': [(x1, y0, 0), (x1, y0, 4), (x1, y1, 4), (x1, y1, 0)],
    }.items():
        made.append(plane(name, pts, 'M_Plaster'))
    m = LAYLIGHT_MARGIN_M
    made.append(laylight(x0 + m, x1 - m, y0 + m, y1 - m))
    return made


def outer_corner_context():
    """바깥 모서리 조각용 ㄱ자 공간: 벽 A(y = 0, x ≤ 0, 안쪽 −Y) + 벽 B(x = 0, y ≥ 0, 안쪽 +X)."""
    made = []
    r = ROOM_DEPTH_M
    m = LAYLIGHT_MARGIN_M
    made.append(plane('CtxWallA', [(-r, 0, 0), (0, 0, 0), (0, 0, 4), (-r, 0, 4)], 'M_Plaster'))
    made.append(plane('CtxWallB', [(0, 0, 0), (0, r, 0), (0, r, 4), (0, 0, 4)], 'M_Plaster'))
    made.append(plane('CtxFarA', [(-r, -r, 0), (-r, -r, 4), (r, -r, 4), (r, -r, 0)], 'M_Plaster'))
    made.append(plane('CtxFarB', [(r, -r, 0), (r, -r, 4), (r, r, 4), (r, r, 0)], 'M_Plaster'))
    box_floor_ceiling(made, [(-r, r, -r, 0.0), (0.0, r, 0.0, r)])
    made.append(laylight(-r, r - m, -r + m, -m))
    made.append(laylight(m, r - m, -m, r))
    return made


def set_bake_target(obj, img):
    for slot in obj.data.materials:
        slot.node_tree.nodes.active.image = img


def bake_pass(obj, size, kind, samples, **kw):
    """한 가지를 굽고 (h, w, 3) 실수 배열로 돌려준다(행 0 = 아래, v = 0). size = 한 변 또는 (w, h)."""
    w, h = (size, size) if isinstance(size, int) else size
    img = bpy.data.images.new(f'B_{kind}_{obj.name}', w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    set_bake_target(obj, img)
    bpy.context.scene.cycles.samples = samples
    bpy.ops.object.bake(type=kind, margin=kw.pop('margin', 8), use_clear=True, **kw)
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    arr = buf.reshape(h, w, 4)[..., :3].copy()
    bpy.data.images.remove(img)
    return arr


def denoise(val, pos, nrm):
    """결합 양방향 걸러내기: 화면(아틀라스) 거리 × 세계 위치 거리 × 법선 차이로 무게를 준다.
    UV에서는 붙어 있어도 3D에서 떨어진 섬끼리, 꺾인 면끼리는 섞이지 않는다. val = (h, w) 또는 (h, w, c)."""
    r = DENOISE_RADIUS_PX
    h, w = val.shape[:2]
    pad2 = ((r, r), (r, r))
    extra = ((0, 0),) * (val.ndim - 2)
    lp = np.pad(val, pad2 + extra, mode='edge')
    pp = np.pad(pos, pad2 + ((0, 0),), mode='edge')
    np_ = np.pad(nrm, pad2 + ((0, 0),), mode='edge')
    acc = np.zeros_like(val)
    wsum = np.zeros((h, w), dtype=val.dtype)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            ws = math.exp(-(dx * dx + dy * dy) / (2 * DENOISE_SIGMA_PX**2))
            sl = (slice(r + dy, r + dy + h), slice(r + dx, r + dx + w))
            d2 = np.sum((pp[sl] - pos) ** 2, axis=-1)
            ndot = np.sum(np_[sl] * nrm, axis=-1)
            wt = ws * np.exp(-d2 / (2 * DENOISE_SIGMA_POS_M**2)) * np.exp(-np.clip(1.0 - ndot, 0.0, 2.0) / DENOISE_SIGMA_NRM)
            acc += (wt[..., None] if val.ndim == 3 else wt) * lp[sl]
            wsum += wt
    ws_ = wsum[..., None] if val.ndim == 3 else wsum
    return np.where(ws_ > 1e-9, acc / np.maximum(ws_, 1e-9), val).astype(np.float32)


def bake_light(obj, size, samples, color=False, ao=None):
    """빛(밝기 또는 RGB)·위치·법선을 굽고 잡음을 걷어 낸 배열. 장면(주변·빛)은 부르는 쪽이 세운다.
    ao = (거리 m, 세기): 짧은 거리 AO를 곱해 몰딩 아래·판 홈·모서리의 맞닿음 그늘을 또렷하게 한다(이웃 사본이 같은
    장면에 있으므로 조각 경계에서도 이어진다). 기준 띠(벽 한가운데)는 AO ≈ 1이라 공통 노출에 거의 영향이 없다."""
    select_only(obj)
    obj.data.uv_layers.active = obj.data.uv_layers['Lightmap']
    light = bake_pass(obj, size, 'DIFFUSE', samples, pass_filter={'DIRECT', 'INDIRECT'})
    pos = bake_pass(obj, size, 'POSITION', 1)
    nrm = bake_pass(obj, size, 'NORMAL', 1, normal_space='OBJECT') * 2.0 - 1.0
    nrm /= np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-6)
    occ = None
    if ao is not None:
        dist, strength = ao
        bpy.context.scene.world.light_settings.distance = dist
        occ = bake_pass(obj, size, 'AO', max(64, samples // 2)).mean(axis=-1)
        occ = 1.0 - strength + strength * np.clip(denoise(occ, pos, nrm), 0.0, 1.0)
    obj.data.uv_layers.active = obj.data.uv_layers['UVMap']
    if color:
        out = denoise(light, pos, nrm)
        return out * occ[..., None] if occ is not None else out
    out = denoise(light.mean(axis=-1), pos, nrm)
    return out * occ if occ is not None else out


def remove(objs):
    for o in list(objs):
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()


# ── 실내 ────────────────────────────────────────────────────────


def bake_interior(obj, slots, size, samples):
    module = obj.name
    assign(obj, [gray_material(s, bpy.data.images.new(f'T0_{module}_{s}', 4, 4)) for s in slots])
    if module in geometry.WALL_LENGTH:
        ctx = wall_context(module, geometry.WALL_LENGTH[module])
    elif module == 'mh_ceiling_2x2':
        obj.location = (-1.0, 1.0, 0.0)  # 방 한가운데 칸
        ctx = room_context((0.0, 0.0))
    elif module == 'mh_corner_out':
        ctx = outer_corner_context()
    else:  # 안쪽 모서리 기둥: 방 모서리(x0 = 0, y1 = 0)에
        ctx = room_context((ROOM_DEPTH_M / 2, -ROOM_DEPTH_M / 2))
    clean = bake_light(obj, size, samples, ao=INTERIOR_AO)
    remove(ctx)
    obj.location = (0.0, 0.0, 0.0)
    return clean


def plaster_sampler(obj, slots):
    """조각의 회반죽 앞면(y = 0, 방 쪽) 위 점(x, z) → 굽기 아틀라스 좌표(u, v)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv['Lightmap']
    idx = slots.index('M_Plaster')
    faces = [f for f in bm.faces if f.material_index == idx and f.normal.y < -0.9 and abs(f.calc_center_median().y) < 1e-4]
    face = max(faces, key=lambda f: f.calc_area())
    loops = list(face.loops)
    p0, p1, p3 = (loops[i].vert.co.copy() for i in (0, 1, 3))
    u0, u1, u3 = (loops[i][uv].uv.copy() for i in (0, 1, 3))
    bm.free()
    e1, e3 = p1 - p0, p3 - p0

    def at(x, z):
        d = Vector((x, 0.0, z)) - p0
        s = d.dot(e1) / e1.length_squared
        t = d.dot(e3) / e3.length_squared
        return u0 + (u1 - u0) * s + (u3 - u0) * t

    return at


def uv1_sampler(obj):
    """조각 표면 가까운 점 → 굽기 아틀라스 좌표(삼각형 무게 중심 좌표로 보간)."""
    me = obj.data
    me.calc_loop_triangles()
    verts = [v.co.copy() for v in me.vertices]
    tris = [tuple(t.vertices) for t in me.loop_triangles]
    bvh = BVHTree.FromPolygons(verts, tris)
    uvl = me.uv_layers['Lightmap'].data

    def at(p):
        loc, _n, idx, _d = bvh.find_nearest(Vector(p))
        t = me.loop_triangles[idx]
        a, b, c = (verts[i] for i in t.vertices)
        ua, ub, uc = (Vector((*uvl[li].uv, 0.0)) for li in t.loops)
        q = barycentric_transform(loc, a, b, c, ua, ub, uc)
        return (q.x, q.y)

    return at


def sample(arr, uv):
    """(size, size[, c]) 배열에서 이중 선형 표본(행 0 = v 0)."""
    h, w = arr.shape[:2]
    fx, fy = uv[0] * w - 0.5, uv[1] * h - 0.5
    x0, y0 = int(math.floor(fx)), int(math.floor(fy))
    ax, ay = fx - x0, fy - y0
    x0, y0 = max(0, min(w - 2, x0)), max(0, min(h - 2, y0))
    a = arr[y0, x0] * (1 - ax) + arr[y0, x0 + 1] * ax
    b = arr[y0 + 1, x0] * (1 - ax) + arr[y0 + 1, x0 + 1] * ax
    return a * (1 - ay) + b * ay


def common_exposure(raw, objs, manifest):
    """4m 벽 회반죽의 작품 높이 띠 평균 → 곡선을 지나 EXPOSURE_REF_OUT이 되는 배율."""
    name = 'mh_wall_4m'
    at = plaster_sampler(objs[name], manifest['modules'][name]['slots'])
    vals = [float(sample(raw[name], at(x, z))) for x in np.linspace(*EXPOSURE_REF_BAND_X, 13) for z in np.linspace(*EXPOSURE_REF_BAND_Z, 9)]
    ref = float(np.mean(vals))
    gain = -math.log(1.0 - EXPOSURE_REF_OUT) / max(ref, 1e-9)
    return ref, gain


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bounds_of(obj):
    bb = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return {'min': [round(min(p[i] for p in bb), 4) for i in range(3)], 'max': [round(max(p[i] for p in bb), 4) for i in range(3)]}


def export_glb(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_vertex_color='ACTIVE',
        export_yup=True,
        export_lights=False,
        export_cameras=False,
    )
    print(f'[build] 내보냄: {path}', flush=True)


def build_core(args, out, albedo, manifest):
    objs = {name: make() for name, make in geometry.MODULES.items()}
    manifest['modules'] = {}
    manifest['baked'] = not args.no_bake
    for name, obj in objs.items():
        has_lm = name != 'mh_floor_2x2'
        if has_lm:
            set_uv1(obj)
        # 재질 칸 이름은 형상이 만든 자리 표시 재질(`PH_{칸}`)에서 읽는다
        manifest['modules'][name] = {'slots': slot_names(obj), 'triangles': triangles(obj), 'lightmap': has_lm}
    raw = {}
    for name, obj in objs.items():
        if not manifest['modules'][name]['lightmap']:
            continue
        length = geometry.WALL_LENGTH.get(name, 2.0)
        size = 1024 if length >= 4.0 else 512  # 미터당 해상도를 맞춤(4m 벽 1024 = 2m 조각 512)
        manifest['modules'][name]['lightmapPx'] = size
        if args.no_bake:
            raw[name] = None
            continue
        for other in objs.values():
            other.hide_render = other is not obj
        samples = args.samples * (CEILING_SAMPLES_X if name == 'mh_ceiling_2x2' else 1)
        print(f'[build] 굽는 중(실내): {name} ({size}px, 표본 {samples})', flush=True)
        raw[name] = bake_interior(obj, manifest['modules'][name]['slots'], size, samples)
    gain = None
    if not args.no_bake:
        ref, gain = common_exposure(raw, objs, manifest)
        manifest['exposure'] = {'reference': ref, 'gain': gain, 'referenceOut': EXPOSURE_REF_OUT, 'curve': '1-exp(-gain*x)'}
        print(f'[build] 공통 노출(실내): 기준 {ref:.4f} → 배율 {gain:.3f}', flush=True)
    else:
        manifest.pop('exposure', None)
    for name, obj in objs.items():
        info = manifest['modules'][name]
        if not info['lightmap']:
            assign(obj, [export_material(s, name, albedo) for s in info['slots']])
            continue
        if raw[name] is None:
            gray = np.full((64, 64), 0.9, dtype=np.float32)
        else:
            gray = 1.0 - np.exp(-gain * np.maximum(raw[name], 0.0))
            info['lightmapMean'] = round(float(gray.mean()), 4)
        lm = save_image(f'LM_{name}', gray, os.path.join(out, 'lightmaps', f'{name}.png'), non_color=True)
        assign(obj, [export_material(s, name, albedo, lm) for s in info['slots']])
    for name, obj in objs.items():
        obj.hide_render = False
        manifest['modules'][name]['bounds'] = bounds_of(obj)
    export_glb(list(objs.values()), os.path.join(out, f'{TEMPLATE}-core.glb'))
    remove(objs.values())


# ── 외관 ────────────────────────────────────────────────────────


def ctx_plane(name, pts, slot='Ground'):
    return plane(name, pts, slot)


def ground(z, half=60.0, cx=0.0, cy=0.0):
    return ctx_plane('CtxGround', [(cx - half, cy - half, z), (cx + half, cy - half, z), (cx + half, cy + half, z), (cx - half, cy + half, z)])


def linked_copies(obj, offsets):
    made = []
    for dx, dy in offsets:
        o = obj.copy()
        o.location = (dx, dy, 0.0)
        bpy.context.scene.collection.objects.link(o)
        made.append(o)
    return made


def ext_context(name, objs, c):
    """외관 조각 굽기 주변 + 해. 돌려주는 목록은 굽기 뒤 지운다(같은 조각의 사본은 메시를 나눠 씀)."""
    e = c['exterior']
    rise = e['steps'] * e['stepRiseM']
    made = []
    front = (0.0, -1.0)  # 조각 앞(광장 쪽) = −Y: 해가 정면에서
    if name in ('mh_ext_portico_12m', 'mh_ext_stairs_12m'):
        made.append(ground(-rise, cy=-10.0))
        hw, D = e['porticoW'] / 2, e['porticoD']
        for sx in (-1, 1):
            x0, x1 = sorted((sx * hw, sx * (hw + 16.0)))
            top = exterior.FACADE_H - rise
            made.append(ctx_plane(f'CtxWing{sx}', [(x0, D, -rise), (x1, D, -rise), (x1, D, top), (x0, D, top)] if sx < 0 else [(x0, D, -rise), (x1, D, -rise), (x1, D, top), (x0, D, top)], 'M_Ashlar'))
        # 정문 안(홀) — 어둡지 않게 흐린 빛 판
        made.append(plane('CtxHall', [(-2.0, D + 1.2, 0.0), (2.0, D + 1.2, 0.0), (2.0, D + 1.2, 3.5), (-2.0, D + 1.2, 3.5)], 'M_Plaster', emission=0.15))
        made.append(sun_from(front))
    elif name == 'mh_ext_wall_2m':
        made += linked_copies(objs[name], [(dx, 0.0) for dx in (-8, -6, -4, -2, 2, 4, 6, 8)])
        made.append(ground(0.0, cy=-30.0))
        made.append(sun_from(front))
    elif name == 'mh_ext_hedge_2m':
        made += linked_copies(objs[name], [(dx, 0.0) for dx in (-8, -6, -4, -2, 2, 4, 6, 8)])
        made.append(ground(0.0))
        made.append(sun_from((0.0, 1.0)))  # 해는 산울타리 뒤 — 광장 쪽 면은 하늘빛만(뒤·옆 산울타리 모두 그렇다)
    elif name == 'mh_ext_plaza_2x2':
        made.append(ground(-0.002))
        made.append(sun_from(front))
    return made


def pier_context(side, c):
    """날개 끝 모서리 기둥: 오른쪽(side 1)은 날개 벽 면 x = 0(+x를 봄, y > 0) + 꺾인 벽 면 y = 0(−y를 봄, x < 0),
    해는 +x 쪽. 왼쪽(side −1)은 거울. 두 번 구워 화소마다 큰 값을 쓴다(보이는 면은 그 쪽 굽기에서 밝다)."""
    h = exterior.FACADE_H
    r = 14.0
    made = [ground(0.0)]
    if side > 0:
        made.append(ctx_plane('CtxWing', [(0, 0, 0), (0, r, 0), (0, r, h), (0, 0, h)], 'M_Ashlar'))
        made.append(ctx_plane('CtxReturn', [(-r, 0, 0), (0, 0, 0), (0, 0, h), (-r, 0, h)], 'M_Ashlar'))
        made.append(ctx_plane('CtxTop', [(-r, 0, h), (0, 0, h), (0, r, h), (-r, r, h)], 'M_Stone'))
        made.append(sun_from((1.0, 0.0)))
    else:
        made.append(ctx_plane('CtxWing', [(0, r, 0), (0, 0, 0), (0, 0, h), (0, r, h)], 'M_Ashlar'))
        made.append(ctx_plane('CtxReturn', [(0, 0, 0), (r, 0, 0), (r, 0, h), (0, 0, h)], 'M_Ashlar'))
        made.append(ctx_plane('CtxTop', [(0, 0, h), (r, 0, h), (r, r, h), (0, r, h)], 'M_Stone'))
        made.append(sun_from((-1.0, 0.0)))
    return made


def ext_exposure(raw, objs, c):
    """외관 공통 노출: 날개 벽 앞면(해 받는 석재 벽, 기단 덮개 바로 위 띠)의 평균 밝기."""
    e = c['exterior']
    rise = e['steps'] * e['stepRiseM']
    at = uv1_sampler(objs['mh_ext_wall_2m'])
    arr = raw['mh_ext_wall_2m']
    vals = [float(np.mean(sample(arr, at((x, 0.0, z))))) for x in np.linspace(0.35, 1.65, 9) for z in np.linspace(rise + 0.1, rise + 0.7, 5)]
    ref = float(np.mean(vals))
    gain = -math.log(1.0 - EXT_REF_OUT) / max(ref, 1e-9)
    return ref, gain


def build_exterior(args, out, albedo, manifest, c):
    objs = {name: make(c) for name, make in exterior.MODULES.items()}
    sec = {'file': 'exterior.glb', 'baked': not args.no_bake, 'modules': {}}
    for name, obj in objs.items():
        size = EXT_LM_PX[name]
        set_uv1_smart(obj, EXT_LM_MARGIN[size])
        sec['modules'][name] = {'slots': slot_names(obj), 'triangles': triangles(obj), 'lightmap': True, 'lightmapPx': size}
    raw = {}
    if not args.no_bake:
        sky_world()
        for name, obj in objs.items():
            size = EXT_LM_PX[name]
            slots = sec['modules'][name]['slots']
            companions = {'mh_ext_portico_12m': ['mh_ext_stairs_12m'], 'mh_ext_stairs_12m': ['mh_ext_portico_12m']}.get(name, [])
            for other_name, other in objs.items():
                other.hide_render = not (other is obj or other_name in companions)
            assign(obj, [gray_material(s, bpy.data.images.new(f'T0_{name}_{s}', 4, 4)) for s in slots])
            for cn in companions:
                assign(objs[cn], [gray_material(s) for s in sec['modules'][cn]['slots']])
            samples = max(16, args.samples // 4) if name == 'mh_ext_plaza_2x2' else args.samples
            print(f'[build] 굽는 중(외관): {name} ({size}px, 표본 {samples})', flush=True)
            if name == 'mh_ext_wall_end':
                parts = []
                for side in (1, -1):
                    ctx = pier_context(side, c)
                    parts.append(bake_light(obj, size, samples, color=True, ao=EXTERIOR_AO))
                    remove(ctx)
                raw[name] = np.maximum(parts[0], parts[1])
            else:
                ctx = ext_context(name, objs, c)
                raw[name] = bake_light(obj, size, samples, color=True, ao=EXTERIOR_AO)
                remove(ctx)
        ref, gain = ext_exposure(raw, objs, c)
        sec['exposure'] = {'reference': ref, 'gain': gain, 'referenceOut': EXT_REF_OUT, 'curve': '1-exp(-gain*x)', 'color': True}
        print(f'[build] 공통 노출(외관): 기준 {ref:.4f} → 배율 {gain:.3f}', flush=True)
        interior_world()
    sec['rig'] = {
        'sun': {'fromFront': True, 'elevationDeg': EXT_SUN_ELEV_DEG, 'strength': EXT_SUN_STRENGTH, 'color': EXT_SUN_COLOR},
        'sky': {'zenith': EXT_SKY_ZENITH, 'horizon': EXT_SKY_HORIZON, 'strength': EXT_SKY_STRENGTH},
        'note': '해는 조각 앞(광장 쪽, 세계 −Z)에서 45°. 산울타리는 해가 뒤, 날개 끝 기둥은 좌우 두 번 굽기의 큰 값.',
    }
    sec['viewer'] = {'lightMapIntensity': EXT_VIEWER_INTENSITY, 'tint': '#ffffff'}
    for name, obj in objs.items():
        info = sec['modules'][name]
        if args.no_bake:
            lmv = np.full((32, 32, 3), 0.62, dtype=np.float32)
        else:
            lmv = 1.0 - np.exp(-sec['exposure']['gain'] * np.maximum(raw[name], 0.0))
            info['lightmapMean'] = [round(float(v), 4) for v in lmv.reshape(-1, 3).mean(axis=0)]
        lm = save_image(f'LM_{name}', lmv, os.path.join(out, 'lightmaps', f'{name}.png'), non_color=True)
        assign(obj, [export_material(s, name, albedo, lm) for s in info['slots']])
    for name, obj in objs.items():
        obj.hide_render = False
        sec['modules'][name]['bounds'] = bounds_of(obj)
    manifest['exterior'] = sec
    export_glb(list(objs.values()), os.path.join(out, f'{TEMPLATE}-exterior.glb'))
    remove(objs.values())


# ── 설비 ────────────────────────────────────────────────────────

AO_DISTANCE = {'easel': 0.3, 'bench': 0.25, 'plant': 0.3, 'lamp': 0.4}


def bake_vertex_ao(obj, kind, samples):
    """꼭짓점 색(COLOR_0)에 구운 그늘: 바닥 판을 깔고 AO → 0.5 + 0.5·AO(틈이 너무 검지 않게)."""
    me = obj.data
    col = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = col
    gnd = ground(0.0, half=4.0)
    world = bpy.context.scene.world
    world.light_settings.distance = AO_DISTANCE.get(kind, 0.3)
    select_only(obj)
    bpy.context.scene.cycles.samples = samples
    assign(obj, [gray_material(s) for s in slot_names_of(obj)])
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    col = me.color_attributes['Col']  # 굽기 뒤 다시 읽는다(속성 버퍼가 바뀔 수 있음)
    for d in col.data:
        a = d.color[0]
        v = 0.5 + 0.5 * a
        d.color = (v, v, v, 1.0)
    remove([gnd])


def slot_names_of(obj):
    return [m.name.split('__')[0].replace('PH_', '').replace('BAKE_', '') for m in obj.data.materials]


def bake_shadow_card(obj, kind, spec, samples, albedo, out):
    """바닥 그림자 판: 설비 아래 판에 AO(+ 해 그림자)를 구워 알파로. 판 가장자리는 0으로 흐려 경계가 안 보이게."""
    x0, x1, y0, y1 = spec['rect']
    w, h = spec['px']
    z = 0.004
    me = bpy.data.meshes.new(f'Shadow_{kind}')
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [[0, 1, 2, 3]])
    uv = me.uv_layers.new(name='UVMap')
    for li, (u, v) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    card = bpy.data.objects.new(f'Shadow_{kind}', me)
    bpy.context.scene.collection.objects.link(card)
    assign(card, [gray_material('Ground', bpy.data.images.new(f'T0_sh_{kind}', 4, 4))])
    select_only(card)  # 굽기는 선택한 물체에 — 앞서 고른 설비가 남아 있으면 그쪽을 굽는다
    world = bpy.context.scene.world
    world.light_settings.distance = 1.6 if kind == 'tree' else 0.55
    ao = bake_pass(card, (w, h), 'AO', samples, margin=0)[..., 0]
    alpha = 0.62 * np.clip(1.0 - ao, 0.0, 1.0) ** 1.2
    if spec['sun']:
        sun = sun_from((0.0, 1.0), strength=1.0, color=(1, 1, 1), name='ShadowSun')
        world_strength = world.node_tree.nodes['Background'].inputs['Strength']
        keep = world_strength.default_value
        world_strength.default_value = 0.0
        lit = bake_pass(card, (w, h), 'DIFFUSE', max(64, samples // 2), pass_filter={'DIRECT'}, margin=0).mean(axis=-1)
        world_strength.default_value = keep
        remove([sun])
        lit = lit / max(float(np.percentile(lit, 99)), 1e-6)
        alpha = np.maximum(alpha, 0.5 * np.clip(1.0 - lit, 0.0, 1.0))
    # 가장자리 흐리기
    yy, xx = np.mgrid[0:h, 0:w]
    ex = np.minimum(xx + 0.5, w - xx - 0.5) / (0.12 * w)
    ey = np.minimum(yy + 0.5, h - yy - 0.5) / (0.12 * h)
    alpha = alpha * np.clip(np.minimum(ex, ey), 0.0, 1.0)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    rgba[..., 3] = alpha
    img = save_image(f'SH_{kind}', rgba, os.path.join(out, 'textures', f'shadow_{kind}.png'))
    assign(card, [export_material('M_Shadow', kind, albedo, shadow_image=img)])
    return card


def build_fixtures(args, out, albedo, manifest, c):
    sec = {'file': 'fixtures.glb', 'models': {}}
    objs = {}
    for name, make in fixtures.MODELS.items():
        obj, info = make(c)
        objs[name] = obj
        sec['models'][name] = dict(info)
    shared = {}

    def mat_for(slot):
        if slot not in shared:
            shared[slot] = export_material(slot, 'fixtures', albedo)
        return shared[slot]

    for name, obj in objs.items():
        slots = slot_names(obj)
        for other in objs.values():
            other.hide_render = other is not obj
        if not args.no_bake and name in fixtures.AO_BAKE:
            print(f'[build] 굽는 중(설비 그늘): {name}', flush=True)
            bake_vertex_ao(obj, name, max(64, args.samples // 4))
        assign(obj, [mat_for(s) for s in slots])
        info = sec['models'][name]
        info['slots'] = list(slots)
        info['vertexAO'] = name in fixtures.AO_BAKE or name == 'tree'
        spec = fixtures.SHADOWS.get(name)
        if spec is not None and not args.no_bake:
            print(f'[build] 굽는 중(바닥 그림자): {name}', flush=True)
            card = bake_shadow_card(obj, name, spec, max(64, args.samples // 4), albedo, out)
            if obj.data.color_attributes.get('Col') is not None:
                cm = card.data
                cc = cm.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
                for d in cc.data:
                    d.color = (1.0, 1.0, 1.0, 1.0)
            select_only(obj)
            card.select_set(True)
            bpy.ops.object.join()
            info['slots'] = slots + ['M_Shadow']
            info['shadow'] = {'rect': list(spec['rect']), 'sun': spec['sun']}
        info['triangles'] = triangles(obj)
        info['bounds'] = bounds_of(obj)
    for obj in objs.values():
        obj.hide_render = False
    manifest['fixtures'] = sec
    export_glb(list(objs.values()), os.path.join(out, f'{TEMPLATE}-fixtures.glb'))
    remove(objs.values())


def main():
    args = parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    contract_path = args.contract or os.path.join(out, 'contract.json')
    with open(contract_path, encoding='utf-8') as f:
        c = json.load(f)
    c['exterior'] = c['geometry']['exterior']
    only = set(args.only.split(','))
    mpath = os.path.join(out, 'manifest.json')
    manifest = {}
    if os.path.exists(mpath) and only != {'core', 'exterior', 'fixtures'}:
        with open(mpath, encoding='utf-8') as f:
            manifest = json.load(f)
    manifest.update({'template': TEMPLATE, 'tileM': TILE_M})
    manifest['files'] = {'core': 'core.glb', 'exterior': 'exterior.glb', 'fixtures': 'fixtures.glb'}
    setup_scene()
    slots = set(textures.MAKERS) | set(textures.ALPHA_MAKERS)
    albedo = make_textures(out, args.albedo, slots)
    if 'core' in only:
        build_core(args, out, albedo, manifest)
    if 'exterior' in only:
        build_exterior(args, out, albedo, manifest, c)
    if 'fixtures' in only:
        build_fixtures(args, out, albedo, manifest, c)
    with open(mpath, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f'[build] 끝: {mpath}', flush=True)


if __name__ == '__main__':
    main()
