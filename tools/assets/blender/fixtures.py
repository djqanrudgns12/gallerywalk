"""설비 모델(R-3, ADR-057): 이젤·벤치·화분·가로등·나무 + 벽에 다는 판(이름판·소개판·사인, 글 자리는 비움).

좌표(Blender, Z-위): 앞 = −Y(glTF +Z). 바닥 설비의 기준점 = 바닥 한가운데, 바닥 넓이는 배치 계약 `footprints` 안.
벽에 다는 판의 기준점 = 판 뒷면 한가운데(벽 면), 매다는 홀 사인은 판 한가운데.
이 파일은 형상만 만든다. 구운 그늘(꼭짓점 AO)·바닥 그림자 판은 build.py가 굽는다(`SHADOWS`).
"""

import math
import random

from mathutils import Matrix, Vector

from geometry import Builder

TREE_SLOTS = ('M_Bark', 'M_Leaf')


def easel(c):
    """원목 이젤(A자, 뒷다리 하나). 받침 윗면 = 계약 EASEL_LEDGE_Y_M. 액자 뒷면 = y 0(glTF z 0), 앞다리는 그 뒤(+Y)."""
    ledge = c['config']['EASEL_LEDGE_Y_M']
    fp = c['geometry']['footprints']['easel']
    b = Builder('easel', ('M_Oak', 'M_Brass'))
    top_z = 2.16
    foot_x = min(0.44, fp['w'] / 2 - 0.04)
    ly = 0.03  # 앞다리 한가운데 y(액자 뒷면 바로 뒤)
    for sx in (-1, 1):
        b.beam((sx * foot_x, ly, 0.0), (sx * 0.055, ly, top_z), 0.05, 0.035, 'M_Oak', up=(0, 1, 0), chamfer=0.008)
    b.box(-0.085, 0.085, 0.012, 0.062, top_z - 0.08, top_z + 0.05, 'M_Oak')
    b.lathe([(0.018, top_z + 0.05), (0.03, top_z + 0.075), (0.026, top_z + 0.10), (0.0, top_z + 0.115)], 10, 'M_Brass', center=(0.0, 0.037))
    # 받침(액자가 앉는 판) + 앞 턱 + 받침 까치발
    b.box(-0.5, 0.5, -0.10, 0.04, ledge - 0.045, ledge, 'M_Oak')
    b.box(-0.5, 0.5, -0.10, -0.082, ledge, ledge + 0.022, 'M_Oak', skip=('bottom',))
    leg_x_at = lambda z: foot_x - (foot_x - 0.055) * z / top_z
    for sx in (-1, 1):
        x = sx * leg_x_at(ledge)
        b.beam((x, -0.07, ledge - 0.045), (x, ly, ledge - 0.16), 0.03, 0.03, 'M_Oak', up=(1, 0, 0))
        b.lathe([(0.012, ledge), (0.012, ledge + 0.03), (0.016, ledge + 0.034), (0.0, ledge + 0.04)], 8, 'M_Brass', center=(sx * 0.42, -0.04))
    zs = 0.32
    b.beam((-leg_x_at(zs), ly, zs), (leg_x_at(zs), ly, zs), 0.03, 0.025, 'M_Oak', up=(0, 0, 1))
    # 뒷다리 + 받침대
    back_foot = min(0.42, fp['d'] / 2 - 0.03)
    b.beam((0.0, 0.065, top_z - 0.10), (0.0, back_foot, 0.0), 0.045, 0.035, 'M_Oak', up=(1, 0, 0), chamfer=0.007)
    zb = 0.55
    yb = 0.065 + (back_foot - 0.065) * (top_z - 0.10 - zb) / (top_z - 0.10)
    b.beam((0.0, ly + 0.02, zb), (0.0, yb - 0.02, zb), 0.022, 0.02, 'M_Oak', up=(0, 0, 1))
    b.cylinder((-0.06, 0.07, top_z - 0.06), (0.06, 0.07, top_z - 0.06), 0.012, 0.012, 8, 'M_Brass')
    return b.finish(), {'ledgeY': ledge}


def rounded_box(b, center, half, r, n, material, crown=0.0):
    """둥근 모서리 상자(방석): 정육면체 여섯 면 격자를 안쪽 상자 + 반지름 r 구로 밀어 낸다. 윗면 가운데를 crown만큼 볼록."""
    cx, cy, cz = center
    hx, hy, hz = half
    inner = (hx - r, hy - r, hz - r)
    faces = [
        ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
        ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
        ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
        ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
        ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
        ((0, 0, -1), (0, 1, 0), (1, 0, 0)),
    ]
    for nrm, ua, va in faces:
        N, U, V = Vector(nrm), Vector(ua), Vector(va)
        nu = n[[abs(x) for x in ua].index(1)]
        nv = n[[abs(x) for x in va].index(1)]

        def pt(s, t, N=N, U=U, V=V):
            p = N + U * (2 * s - 1) + V * (2 * t - 1)  # 단위 정육면체 면 위
            # 모서리 가까이 촘촘하게(둥근 부분에 점이 모이게)
            q = Vector([math.copysign(abs(x) ** 0.6, x) for x in p])
            pos = Vector((q.x * hx, q.y * hy, q.z * hz))
            core = Vector((max(-inner[0], min(inner[0], pos.x)), max(-inner[1], min(inner[1], pos.y)), max(-inner[2], min(inner[2], pos.z))))
            d = pos - core
            out = core + (d.normalized() * r if d.length > 1e-9 else Vector((0, 0, 0)))
            if crown and out.z > 0:
                out.z += crown * (1 - (out.x / hx) ** 2) * (1 - (out.y / hy) ** 2)
            return (cx + out.x, cy + out.y, cz + out.z)

        b.grid_surface(pt, nu, nv, material, smooth=True)


def bench(c):
    """미술관 벤치: 가죽 방석(둥근 모서리, 윗면 살짝 볼록) + 밝은 참나무 틀·다리·H자 버팀 + 황동 발굽."""
    fp = c['geometry']['footprints']['bench']
    b = Builder('bench', ('M_Leather', 'M_Oak', 'M_Brass'))
    hx, hy = fp['w'] / 2 - 0.025, fp['d'] / 2 - 0.015
    rounded_box(b, (0.0, 0.0, 0.40), (hx, hy, 0.05), 0.035, (12, 5, 3), 'M_Leather', crown=0.012)
    fx, fy = hx - 0.04, hy - 0.04
    zt, zb = 0.35, 0.27
    for sy in (-1, 1):
        b.beam((-fx, sy * fy, (zt + zb) / 2), (fx, sy * fy, (zt + zb) / 2), 0.035, zt - zb, 'M_Oak', up=(0, 0, 1), chamfer=0.006)
    for sx in (-1, 1):
        b.beam((sx * fx, -fy, (zt + zb) / 2), (sx * fx, fy, (zt + zb) / 2), 0.035, zt - zb, 'M_Oak', up=(0, 0, 1), chamfer=0.006)
    lx, ly = fx - 0.03, fy - 0.03
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.beam((sx * lx, sy * ly, 0.025), (sx * lx, sy * ly, zt), 0.048, 0.048, 'M_Oak', up=(1, 0, 0), chamfer=0.006, taper=1.25)
            b.box(sx * lx - 0.027, sx * lx + 0.027, sy * ly - 0.027, sy * ly + 0.027, 0.0, 0.025, 'M_Brass', skip=('bottom',))
        b.beam((sx * lx, -ly, 0.10), (sx * lx, ly, 0.10), 0.03, 0.03, 'M_Oak', up=(0, 0, 1), chamfer=0.005)
    b.beam((-lx, 0.0, 0.12), (lx, 0.0, 0.12), 0.03, 0.035, 'M_Oak', up=(0, 0, 1), chamfer=0.005)
    return b.finish(), {}


def plant(c):
    """화분: 석회암 받침돌 + 메디치 꽃병 모양 돌 화분 + 둥글게 다듬은 회양목."""
    b = Builder('plant', ('M_Stone', 'M_Hedge'))
    b.box(-0.2, 0.2, -0.2, 0.2, 0.0, 0.07, 'M_Stone', skip=('bottom',))
    b.box(-0.18, 0.18, -0.18, 0.18, 0.07, 0.085, 'M_Stone', skip=('bottom',))
    prof = [
        (0.16, 0.085),
        (0.16, 0.11),
        (0.125, 0.13),
        (0.095, 0.17),
        (0.095, 0.21),
        (0.13, 0.23),
        (0.14, 0.255),
        (0.16, 0.28),
        (0.205, 0.35),
        (0.24, 0.44),
        (0.262, 0.52),
        (0.285, 0.55),
        (0.29, 0.585),
        (0.272, 0.60),
        (0.25, 0.60),
        (0.245, 0.56),
    ]
    b.lathe(prof, 20, 'M_Stone', sharp=(1, 4, 11, 13))
    # 흙(회양목에 가려짐)
    soil = [(0.245 * math.cos(2 * math.pi * k / 12), 0.245 * math.sin(2 * math.pi * k / 12), 0.56) for k in range(12)]
    b.face(soil, 'M_Hedge')
    # 둥근 회양목(낮은 주파수 혹으로 공 모양이 너무 매끈하지 않게)
    cz, R = 0.81, 0.272  # 혹 포함 반지름 ≤ 0.29 — 바닥 넓이(0.6m) 안
    rng = random.Random(7)
    ph = [rng.uniform(0, 6.28) for _ in range(6)]

    def ball(s, t):
        th = 2 * math.pi * s
        ph_ = math.pi * (0.06 + 0.88 * t)
        n = Vector((math.sin(ph_) * math.cos(th), math.sin(ph_) * math.sin(th), -math.cos(ph_)))
        bump = 0.012 * math.sin(3 * th + ph[0]) * math.sin(2 * ph_ + ph[1]) + 0.008 * math.sin(5 * th + ph[2] + 3 * ph_)
        p = n * (R + bump)
        return (p.x, p.y, cz + p.z * 0.95)

    b.grid_surface(ball, 16, 10, 'M_Hedge', smooth=True, closed_u=True)
    return b.finish(), {}


def lamp(c):
    """광장 가로등: 주철 받침·기둥(목 고리 둘) + 네모 등(위가 넓음, 유리 네 장) + 피라미드 지붕 + 황동 꼭지."""
    b = Builder('lamp', ('M_Iron', 'M_Glass', 'M_Brass'))
    base = [
        (0.185, 0.0),
        (0.185, 0.05),
        (0.165, 0.07),
        (0.165, 0.11),
        (0.145, 0.13),
        (0.145, 0.30),
        (0.115, 0.36),
        (0.085, 0.44),
        (0.072, 0.55),
        (0.084, 0.59),
        (0.06, 0.63),
        (0.054, 1.85),
        (0.068, 1.88),
        (0.068, 1.93),
        (0.05, 1.96),
        (0.046, 3.0),
        (0.078, 3.04),
        (0.078, 3.09),
        (0.10, 3.12),
        (0.125, 3.16),
        (0.125, 3.19),
        (0.0, 3.19),
    ]
    b.lathe(base, 16, 'M_Iron', sharp=(1, 3, 5, 9, 12, 13, 16, 17, 19, 20))
    z0, z1 = 3.20, 3.58
    h0, h1 = 0.105, 0.15
    corners = lambda h, z: [(h, -h, z), (h, h, z), (-h, h, z), (-h, -h, z)]
    lo, hi = corners(h0, z0), corners(h1, z1)
    inset = 0.012
    for k in range(4):
        a0, a1 = Vector(lo[k]), Vector(lo[(k + 1) % 4])
        c0, c1 = Vector(hi[k]), Vector(hi[(k + 1) % 4])
        mid = (a0 + a1 + c0 + c1) / 4
        shrink = lambda p: mid + (p - mid) * 0.86
        nrm = Vector((mid.x, mid.y, 0.0)).normalized()
        pts = [shrink(a0) - nrm * inset, shrink(a1) - nrm * inset, shrink(c1) - nrm * inset, shrink(c0) - nrm * inset]
        b.face_n([tuple(p) for p in pts], 'M_Glass', tuple(nrm))
        b.face_n([tuple(p) for p in reversed(pts)], 'M_Glass', tuple(-nrm))
        b.beam(tuple(a0), tuple(c0), 0.022, 0.022, 'M_Iron', up=(0, 0, 1))
    for z, h in ((z0, h0), (z1, h1)):
        ring = corners(h + 0.012, z)
        for k in range(4):
            b.beam(ring[k], ring[(k + 1) % 4], 0.02, 0.025, 'M_Iron', up=(0, 0, 1))
    b.box(-h0, h0, -h0, h0, z0 - 0.012, z0, 'M_Iron', skip=('bottom',))
    # 지붕
    rz0, rz1, rh = z1 + 0.012, z1 + 0.21, h1 + 0.05
    rc = corners(rh, rz0)
    for k in range(4):
        b.face_n([rc[k], rc[(k + 1) % 4], (0.0, 0.0, rz1)], 'M_Iron', (rc[k][0] + rc[(k + 1) % 4][0], rc[k][1] + rc[(k + 1) % 4][1], 0.4))
    b.face_n(list(reversed(rc)), 'M_Iron', (0, 0, -1))
    b.lathe([(0.02, rz1 - 0.01), (0.03, rz1 + 0.02), (0.022, rz1 + 0.05), (0.03, rz1 + 0.075), (0.0, rz1 + 0.105)], 10, 'M_Brass')
    return b.finish(), {}


def tree(c, seed=3):
    """광장 둘레 나무(보리수 모양 타원 수관): 줄기·큰 가지 몇 개 + 잎 다발 알파 카드 ~270장.
    카드 꼭짓점 색 = 구운 그늘(수관 안쪽·아래가 어둡게) — glTF COLOR_0, 뷰어는 기본색에 곱한다."""
    rng = random.Random(seed)
    b = Builder('tree', TREE_SLOTS)
    # 줄기(살짝 휜 축)
    zs = [0.0, 0.25, 0.8, 1.6, 2.3, 2.85]
    rs = [0.23, 0.17, 0.15, 0.14, 0.125, 0.11]
    axis = [Vector((0.03 * math.sin(z * 1.3), 0.02 * math.cos(z * 0.9), z)) for z in zs]
    seg = 10
    rings = [[tuple(axis[i] + Vector((rs[i] * math.cos(2 * math.pi * k / seg), rs[i] * math.sin(2 * math.pi * k / seg), 0.0))) for k in range(seg)] for i in range(len(zs))]
    b.loft(rings, 'M_Bark', closed=True, smooth=True, uv=lambda i, j: (2 * math.pi * 0.2 * j / seg / 2.0, zs[i] / 2.0))
    trunk_top = axis[-1]
    crown_c = Vector((0.0, 0.0, 4.55))
    crown_r = Vector((2.05, 2.05, 2.25))
    limbs = []
    for k in range(5):
        az = 2 * math.pi * k / 5 + rng.uniform(-0.3, 0.3)
        el = math.radians(rng.uniform(42, 62))
        ln = rng.uniform(1.6, 2.2)
        start = trunk_top + Vector((0, 0, rng.uniform(-0.45, 0.0)))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        end = start + d * ln
        limbs.append((start, end, d))
        b.cylinder(tuple(start), tuple(end), 0.085, 0.03, 6, 'M_Bark', caps=(False, True))
        for s in (0.55, 0.75):
            p = start + d * (ln * s)
            az2 = az + rng.choice((-1, 1)) * rng.uniform(0.6, 1.1)
            el2 = el + rng.uniform(-0.2, 0.25)
            d2 = Vector((math.cos(az2) * math.cos(el2), math.sin(az2) * math.cos(el2), math.sin(el2)))
            b.cylinder(tuple(p), tuple(p + d2 * rng.uniform(0.8, 1.2)), 0.04, 0.014, 5, 'M_Bark', caps=(False, True))
    # 잎 카드
    cards = []
    n_out, n_in = 220, 50
    golden = math.pi * (3 - math.sqrt(5))
    for layer, count, scale, size in ((0, n_out, 1.0, (1.15, 1.55)), (1, n_in, 0.6, (1.0, 1.3))):
        for i in range(count):
            yv = 1 - 2 * (i + 0.5) / count
            rr = math.sqrt(max(0.0, 1 - yv * yv))
            th = golden * i + layer * 1.1
            dirn = Vector((rr * math.cos(th), rr * math.sin(th), yv))
            jitter = rng.uniform(0.9, 1.06) * scale
            pos = crown_c + Vector((dirn.x * crown_r.x, dirn.y * crown_r.y, dirn.z * crown_r.z)) * jitter
            if pos.z < 2.6:
                continue
            nrm = (dirn + Vector((rng.gauss(0, 0.32), rng.gauss(0, 0.32), rng.gauss(0, 0.32) + 0.2))).normalized()
            up = Vector((0, 0, 1))
            if abs(nrm.dot(up)) > 0.92:
                up = Vector((1, 0, 0))
            u = up.cross(nrm).normalized()
            v = nrm.cross(u).normalized()
            spin = rng.uniform(-0.6, 0.6)
            u, v = (u * math.cos(spin) + v * math.sin(spin)), (-u * math.sin(spin) + v * math.cos(spin))
            s = rng.uniform(*size)
            cell = rng.randrange(4)
            radial = (pos - crown_c).length / max(crown_r.x, crown_r.z)
            ao = 0.42 + 0.5 * min(1.0, radial) + 0.08 * max(0.0, (pos.z - crown_c.z) / crown_r.z)
            ao = min(1.0, ao * (0.85 if layer else 1.0))
            cards.append((pos, u * (s / 2), v * (s / 2), cell, ao))
    card_faces = []
    for pos, hu, hv, cell, ao in cards:
        p = [pos - hu - hv, pos + hu - hv, pos + hu + hv, pos - hu + hv]
        u0, v0 = (cell % 2) * 0.5, (cell // 2) * 0.5
        uv = [(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0, v0 + 0.5)]
        f = b.face([tuple(q) for q in p], 'M_Leaf', uv=uv)
        card_faces.append((f, ao))
    obj = b.finish()
    # 꼭짓점 색(구운 그늘): 줄기·가지 0.7~0.9, 카드는 위에서 정한 값
    me = obj.data
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    leaf_idx = obj.data.materials.find('PH_M_Leaf')
    ao_iter = iter([ao for _f, ao in card_faces])
    for poly in me.polygons:
        if poly.material_index == leaf_idx:
            a = next(ao_iter)
            vals = [a] * len(poly.loop_indices)
        else:
            vals = [0.78] * len(poly.loop_indices)
        for li, a in zip(poly.loop_indices, vals):
            col.data[li].color = (a, a, a, 1.0)
    me.color_attributes.active_color = col
    return obj, {'cards': len(cards)}


# ── 벽에 다는 판(글 자리 비움) ─────────────────────────────────────


def _plate(name, w, h, face_slot, frame_slot, frame_w, depth=0.03, centered=False, back_face=False):
    """판: 뒤판(면 색) + 둘레 테(앞으로 조금 더 나옴). 글 자리 = 테 안쪽(앞 면 y = −depth + 0.002)."""
    slots = tuple(dict.fromkeys((face_slot, frame_slot)))
    b = Builder(name, slots)
    y0 = -depth / 2 if centered else 0.0
    y1 = y0 - depth
    hw, hh = w / 2, h / 2
    b.box(-hw, hw, y1 + 0.004, y0, -hh, hh, face_slot, skip=() if back_face else ('back',))
    fd = 0.008
    for xa, xb, za, zb in ((-hw, hw, hh - frame_w, hh), (-hw, hw, -hh, -hh + frame_w), (-hw, -hw + frame_w, -hh + frame_w, hh - frame_w), (hw - frame_w, hw, -hh + frame_w, hh - frame_w)):
        b.box(xa, xb, y1 - fd, y1 + 0.004, za, zb, frame_slot, skip=('back',))
    text = {'w': round(w - 2 * frame_w - 0.02, 4), 'h': round(h - 2 * frame_w - 0.02, 4), 'z': round(-(y1 + 0.004) + 0.001, 4)}
    return b, text


def nameplate(c):
    b, t = _plate('nameplate', 1.5, 0.34, 'M_SignFace', 'M_Brass', 0.022)
    return b.finish(), {'textArea': t}


def intro_panel(c):
    b, t = _plate('introPanel', 1.0, 1.4, 'M_Card', 'M_Oak', 0.05, depth=0.035)
    return b.finish(), {'textArea': t}


def hall_sign(c):
    """천장에서 매단 홀 사인(한가운데가 기준점, 앞뒤 모두 면). 매다는 막대 위 끝 = 천장(기준점 위 hallSignDropM)."""
    drop = c['geometry']['fixtures']['hallSignDropM']
    w, h = 2.8, 0.6
    b, t = _plate('hallSign', w, h, 'M_SignFace', 'M_Brass', 0.028, depth=0.04, centered=True, back_face=True)
    for sx in (-1, 1):
        b.cylinder((sx * 1.05, 0.0, h / 2), (sx * 1.05, 0.0, drop), 0.009, 0.009, 8, 'M_Brass', caps=(False, False))
        b.lathe([(0.05, drop - 0.012), (0.045, drop - 0.004), (0.0, drop)], 12, 'M_Brass', center=(sx * 1.05, 0.0))
    return b.finish(), {'textArea': t, 'twoSided': True}


def exit_sign(c):
    b, t = _plate('exitSign', 1.4, 0.42, 'M_SignFace', 'M_Brass', 0.024)
    return b.finish(), {'textArea': t}


def corridor_nameplate(c):
    b, t = _plate('corridorNameplate', 1.1, 0.30, 'M_SignFace', 'M_Brass', 0.02)
    return b.finish(), {'textArea': t}


def sound_plaque(c):
    s = c['config'].get('SOUND_PLAQUE', {'w': 0.5, 'h': 0.35})
    b, t = _plate('soundPlaque', s['w'], s['h'], 'M_Card', 'M_Brass', 0.02)
    return b.finish(), {'textArea': t}


MODELS = {
    'easel': easel,
    'bench': bench,
    'plant': plant,
    'lamp': lamp,
    'tree': tree,
    'nameplate': nameplate,
    'introPanel': intro_panel,
    'hallSign': hall_sign,
    'exitSign': exit_sign,
    'corridorNameplate': corridor_nameplate,
    'soundPlaque': sound_plaque,
}

# 바닥 그림자 판(구워서): 사각형(x0, x1, y0, y1, Blender 지역), 화소, 해 그림자 여부.
# 해는 광장 쪽(세계 −Z = Blender +Y)에서 45° — 가로등·나무는 늘 rotY 0으로 놓이므로 세계 방향과 같다.
SHADOWS = {
    'easel': {'rect': (-0.75, 0.75, -0.6, 0.75), 'px': (96, 96), 'sun': False},
    'bench': {'rect': (-1.05, 1.05, -0.55, 0.55), 'px': (128, 64), 'sun': False},
    'plant': {'rect': (-0.5, 0.5, -0.5, 0.5), 'px': (64, 64), 'sun': False},
    'lamp': {'rect': (-0.6, 0.6, -4.4, 0.6), 'px': (48, 192), 'sun': True},
    'tree': {'rect': (-2.9, 2.9, -8.6, 1.4), 'px': (128, 224), 'sun': True},
}
# 꼭짓점 AO를 굽는 설비(판은 납작해 굽지 않음, 나무는 직접 정함)
AO_BAKE = ('easel', 'bench', 'plant', 'lamp')

_ = Matrix
