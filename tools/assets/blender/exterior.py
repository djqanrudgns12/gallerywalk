"""미술관 외관 조각(R-3, ADR-057). 치수는 배치 계약(`packages/core/src/domain/templates/geometry.ts` `exterior`)을
`tools/assets/pipeline/contract.mjs`가 뽑은 contract.json에서 읽는다 — 이 파일에 계약 수치를 다시 적지 않는다.

좌표(Blender, Z-위): 조각의 앞 = −Y(glTF +Z, 광장 쪽). 기준점과 범위:
- `mh_ext_portico_12m`: 현관 앞 끝 가운데 바닥(실내 바닥 높이 z 0). 현관은 +Y로 깊이만큼(뒷벽 y = 깊이), 기단은 z −(계단 높이)까지.
- `mh_ext_stairs_12m`: 계단 위 끝 가운데(z 0). 계단은 −Y로 내려간다(단 k 디딤판 z = −k·단높이, y ∈ [−(k+1)·깊이, −k·깊이]).
- `mh_ext_wall_2m`: 벽 시작 쪽 땅(z 0), +X로 2m, 앞 면 y = 0, 두께는 뒤(+Y). 높이 FACADE_H.
- `mh_ext_wall_end`: 날개 끝 바깥 모서리(땅). 좌우 날개 모두 같은 조각을 돌려 놓으므로(거울 없음) x·y 모두 대칭인 모서리 기둥.
- `mh_ext_plaza_2x2`: 바닥 판(실내 바닥 판과 같음, x 0..2, y −2..0).
- `mh_ext_hedge_2m`: 땅, +X로 2m, 앞 면 y = 0(광장 쪽), 몸통은 뒤(+Y).
"""

import math

import bmesh
from mathutils import Vector

from geometry import Builder

FACADE_H = 6.2  # 날개 벽 높이(땅에서, R-3 위임서) — 실내 바닥 기준 5.0
HEDGE_H = 1.1

PORTICO_SLOTS = ('M_Stone', 'M_Ashlar', 'M_Paving', 'M_Bronze')
STAIRS_SLOTS = ('M_Stone',)
WALL_SLOTS = ('M_Ashlar', 'M_Stone')
PLAZA_SLOTS = ('M_Paving',)
HEDGE_SLOTS = ('M_Hedge', 'M_Stone')


def _rise(c):
    e = c['exterior']
    return e['steps'] * e['stepRiseM']


# ── 기둥(그리스 도리스식: 받침 없음, 세로 홈 20개, 배흘림) ───────────────────


def doric_column(b, cx, cy, d, shaft_top, flutes=20, per_flute=3):
    """기둥 하나. 몸통 위 지름 = 0.78 × 아래 지름, 배흘림(볼록), 홈은 날(arris)에서 날카롭고 홈 안은 매끈."""
    r0 = d / 2
    r1 = r0 * 0.78
    depth = d * 0.026
    zs = [0.0, 0.6, 1.3, 2.0, 2.7, shaft_top]
    rings = []
    for z in zs:
        t = z / shaft_top
        r = r0 - (r0 - r1) * t**1.35
        dep = depth * (r / r0)
        ring = []
        for k in range(flutes):
            for j in range(per_flute):
                s = j / per_flute
                a = 2 * math.pi * (k + s) / flutes + math.pi / flutes
                rr = r - dep * math.sin(math.pi * s) ** 0.85
                ring.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
        rings.append(ring)
    m = flutes * per_flute

    def uv(i, j):
        return (2 * math.pi * r0 * j / m / 2.0, zs[i] / 2.0)

    b.loft(rings, 'M_Stone', closed=True, smooth=True, sharp_cols=[k * per_flute for k in range(flutes)], uv=uv)
    # 기둥머리: 목 고리 세 줄 → 에키누스(둥근 쿠션) → 아바쿠스(네모 판)
    z0 = shaft_top
    prof = [
        (r1, z0),
        (r1 + 0.006, z0 + 0.012),
        (r1 - 0.004, z0 + 0.022),
        (r1 + 0.007, z0 + 0.034),
        (r1 - 0.002, z0 + 0.044),
        (r1 + 0.012, z0 + 0.058),
        (r1 + 0.03, z0 + 0.085),
        (r0 * 0.93, z0 + 0.13),
        (r0 * 1.06, z0 + 0.168),
        (r0 * 1.16, z0 + 0.2),
    ]
    grid = b.lathe(prof, 28, 'M_Stone', center=(cx, cy), sharp=(1, 2, 3, 4, 5, 9))
    b.cap(grid[0], 'M_Stone', flip=True)
    ab = r0 * 1.2
    b.box(cx - ab, cx + ab, cy - ab, cy + ab, z0 + 0.2, z0 + 0.3, 'M_Stone', skip=('top',))
    return z0 + 0.3


def portico(c):
    """mh_ext_portico_12m: 기단 · 기둥 6개 · 엔타블러처(이름판 띠 y 4.3~5.1 비움) · 박공 · 격자 천장 · 현관 뒷벽(정문) · 청동 문짝."""
    e = c['exterior']
    W, D = e['porticoW'], e['porticoD']
    hw = W / 2
    rise = _rise(c)
    ceil_z = e['porticoCeilingY']
    col_d = e['columnDiameterM']
    col_y = e['columnInsetM']
    b = Builder('mh_ext_portico_12m', PORTICO_SLOTS)

    # 바닥(화강석) + 기단 옆면(석재 벽)과 아래·위 몰딩
    b.quad([(-hw, 0, 0), (hw, 0, 0), (hw, D, 0), (-hw, D, 0)], 'M_Paving')
    for sx in (-1, 1):
        x = sx * hw
        pts = [(x, 0, -rise), (x, D, -rise), (x, D, 0), (x, 0, 0)]
        b.quad(pts if sx > 0 else list(reversed(pts)), 'M_Ashlar')
        base = [(0.0, 0.0), (0.06, 0.0), (0.06, 0.18), (0.045, 0.21), (0.0, 0.23)]
        cap = [(0.0, rise - 0.13), (0.04, rise - 0.13), (0.075, rise - 0.07), (0.075, rise - 0.025), (0.055, rise), (0.0, rise)]
        for prof in (base, cap):
            b.sweep(prof, (x, 0.0, -rise), (x, D, -rise), (sx, 0, 0), (0, 0, 1), 'M_Stone', caps=True)

    # 기둥
    col_top = 0.0
    shaft_top = 3.50
    for x in e['columnXs']:
        for sx in (-1, 1):
            col_top = doric_column(b, sx * x, col_y, col_d, shaft_top)

    # 엔타블러처: 앞 + 양옆(앞 모서리 45° 맞춤). 단면 (a = 바깥으로 나옴, z)
    sign_lo, sign_hi = e['signY'] - 0.4, e['signY'] + 0.4  # 4.3 ~ 5.1
    ew = max(x for x in e['columnXs']) + col_d / 2 * 1.2 + 0.03  # 모서리 기둥 아바쿠스 바깥 + 조금
    depth_in = col_y + col_d / 2 * 1.2 + 0.03  # 안쪽 면: 기둥 줄 뒤(아바쿠스 뒤 끝)
    top = ceil_z
    ent = [
        (-depth_in, col_top),
        (-0.02, col_top),
        (-0.02, sign_lo - 0.08),
        (0.03, sign_lo - 0.08),
        (0.03, sign_lo),
        (0.0, sign_lo),
        (0.0, sign_hi),
        (0.06, sign_hi),
        (0.10, sign_hi + 0.06),
        (0.38, sign_hi + 0.09),
        (0.38, sign_hi + 0.32),
        (0.40, sign_hi + 0.34),
        (0.43, sign_hi + 0.40),
        (0.43, top),
        (-depth_in, top),
    ]
    path = [(-ew, D, 0.0), (-ew, 0.0, 0.0), (ew, 0.0, 0.0), (ew, D, 0.0)]
    b.sweep_path(ent, path, [(-1, 0, 0), (0, -1, 0), (1, 0, 0)], (0, 0, 1), 'M_Stone')

    # 박공: 박공 벽(띠 면과 같은 면) + 비스듬한 코니스(앞) + 지붕 두 비탈 + 뒤 박공 벽
    pitch = math.radians(13.0)
    base_z = top
    apex = base_z + ew * math.tan(pitch)
    b.face_n([(-ew, 0.0, base_z), (ew, 0.0, base_z), (0.0, 0.0, apex)], 'M_Stone', (0, -1, 0))
    rake = [(-0.35, 0.0), (0.30, 0.0), (0.38, 0.03), (0.38, 0.24), (0.40, 0.26), (0.43, 0.32), (0.43, 0.38), (-0.35, 0.38)]
    thick = 0.38
    eave_x = ew + 0.43  # 비스듬한 코니스 아래 끝 = 가로 코니스 바깥 끝(세로 면으로 자름)
    for sx in (-1, 1):
        s0 = Vector((sx * ew, 0.0, base_z))
        e0 = Vector((0.0, 0.0, apex))
        dvec = (e0 - s0).normalized()
        perp = Vector((-dvec.z, 0.0, dvec.x)) if sx < 0 else Vector((dvec.z, 0.0, -dvec.x))
        b.sweep(
            rake,
            s0,
            e0,
            (0, -1, 0),
            perp,
            'M_Stone',
            cut0=((sx * eave_x, 0.0, 0.0), (1.0, 0.0, 0.0)),
            cut1=((0.0, 0.0, apex), (1.0, 0.0, 0.0)),
        )
    # 지붕(비스듬한 코니스 윗면과 같은 면에서 이어짐) — 아래(천장 위)는 보이지 않아 윗면만
    roof_ridge = apex + thick / math.cos(pitch)
    eave_z = roof_ridge - eave_x * math.tan(pitch)
    y_roof = 0.35
    for sx in (-1, 1):
        b.face_n([(0.0, y_roof, roof_ridge), (sx * eave_x, y_roof, eave_z), (sx * eave_x, D, eave_z), (0.0, D, roof_ridge)], 'M_Stone', (sx * 0.2, 0, 1))
        # 처마 아래 막음(옆 코니스 윗면 ~ 지붕 처마)
        b.face_n([(sx * eave_x, -0.43, top), (sx * eave_x, D, top), (sx * eave_x, D, eave_z), (sx * eave_x, -0.43, eave_z)], 'M_Stone', (sx, 0, 0))
    b.face_n([(eave_x, D, eave_z), (-eave_x, D, eave_z), (0.0, D, roof_ridge)], 'M_Stone', (0, 1, 0))  # 뒤 박공(+Y)

    # 안쪽 벽기둥(anta): 뒤 모서리, 옆 엔타블러처 밑
    ax0, ax1 = ew - 0.03 - col_d * 1.2 + 0.07, ew - 0.03 - 0.07
    for sx in (-1, 1):
        xa, xb = sorted((sx * ax0, sx * ax1))
        # 깊이는 걸을 수 있는 영역의 벽 여유(0.3m) 안 — 배치 장애물 없이도 캐릭터가 파고들지 않는다
        b.box(xa, xb, D - 0.28, D, 0.0, col_top - 0.18, 'M_Stone', skip=('back', 'bottom', 'top'))
        xa2, xb2 = sorted((sx * (ax0 - 0.05), sx * (ax1 + 0.05)))
        b.box(xa2, xb2, D - 0.34, D, col_top - 0.18, col_top, 'M_Stone', skip=('back', 'top'))
        b.box(xa2, xb2, D - 0.30, D, 0.0, 0.16, 'M_Stone', skip=('back', 'bottom'))

    # 격자 천장(z = 현관 천장 높이, 아래를 봄)
    cx0, cx1 = -(ew - depth_in), ew - depth_in
    cy0, cy1 = depth_in, D
    coffers(b, cx0, cx1, cy0, cy1, top, nx=6, ny=2, beam=0.16, depth=0.15)

    # 현관 뒷벽(석재 벽) + 정문 열림(맑은 1.8 × 2.7, 실내 정문 조각의 벽 두께 면과 이어짐)
    clear_w = c['config']['DOOR_WIDTH_M'] - 2 * c['geometry']['doorCasingM']
    clear_h = c['config']['DOOR_HEIGHT_M'] - c['geometry']['doorCasingM']
    dx = clear_w / 2
    bw = hw
    b.quad([(-bw, D, 0), (-dx, D, 0), (-dx, D, clear_h), (-bw, D, clear_h)], 'M_Ashlar')
    b.quad([(dx, D, 0), (bw, D, 0), (bw, D, clear_h), (dx, D, clear_h)], 'M_Ashlar')
    b.quad([(-bw, D, clear_h), (bw, D, clear_h), (bw, D, top), (-bw, D, top)], 'M_Ashlar')
    portal(b, D, dx, clear_h)
    return b.finish()


def coffers(b, x0, x1, y0, y1, z, nx, ny, beam, depth):
    """우물 천장: 보 격자(z 면) + 칸마다 비스듬히 들어간 우물(옆 4면 + 바닥)."""
    cw = (x1 - x0 - beam * (nx + 1)) / nx
    ch = (y1 - y0 - beam * (ny + 1)) / ny
    xs = [x0 + beam + i * (cw + beam) for i in range(nx)]
    ys = [y0 + beam + j * (ch + beam) for j in range(ny)]

    def down(xa, xb, ya, yb, zz):
        b.quad([(xa, ya, zz), (xa, yb, zz), (xb, yb, zz), (xb, ya, zz)], 'M_Stone')

    # 보: 가로 띠(ny + 1) + 칸 사이 세로 조각
    for j in range(ny + 1):
        ya = y0 + j * (ch + beam)
        down(x0, x1, ya, ya + beam, z)
    for j in range(ny):
        for i in range(nx + 1):
            xa = x0 + i * (cw + beam)
            down(xa, xa + beam, ys[j], ys[j] + ch, z)
    inset = 0.06
    for j in range(ny):
        for i in range(nx):
            ax, bx, ay, by = xs[i], xs[i] + cw, ys[j], ys[j] + ch
            ix, jx, iy, jy = ax + inset, bx - inset, ay + inset, by - inset
            zt = z + depth
            down(ix, jx, iy, jy, zt)
            b.face_n([(ax, ay, z), (bx, ay, z), (jx, iy, zt), (ix, iy, zt)], 'M_Stone', (0, 1, -1))
            b.face_n([(bx, ay, z), (bx, by, z), (jx, jy, zt), (jx, iy, zt)], 'M_Stone', (-1, 0, -1))
            b.face_n([(bx, by, z), (ax, by, z), (ix, jy, zt), (jx, jy, zt)], 'M_Stone', (0, -1, -1))
            b.face_n([(ax, by, z), (ax, ay, z), (ix, iy, zt), (ix, jy, zt)], 'M_Stone', (1, 0, -1))


PORTAL = [(0.0, 0.0), (0.12, 0.0), (0.12, 0.06), (0.10, 0.08), (0.10, 0.19), (0.135, 0.22), (0.135, 0.30), (0.07, 0.34), (0.0, 0.34)]


def portal(b, D, dx, clear_h):
    """뒷벽 정문 둘레(바깥): 접힌 청동 문짝 두 장이 들어가는 넓은 돌 테 + 문 위 띠·코니스."""
    leaf_w = dx  # 문짝 한 장 = 맑은 폭의 절반
    fx = dx + leaf_w + 0.04  # 테 안쪽 가장자리(문짝이 접힌 자리 바깥)
    ftop = clear_h + 0.05
    path = [(-fx, D, 0.0), (-fx, D, ftop), (fx, D, ftop), (fx, D, 0.0)]
    b.sweep_path(PORTAL, path, (0, -1, 0), [(-1, 0, 0), (0, 0, 1), (1, 0, 0)], 'M_Stone')
    pw = PORTAL[-1][1]
    for sx in (-1, 1):
        xa, xb = sorted((sx * (fx - 0.01), sx * (fx + pw + 0.03)))
        b.box(xa, xb, D - 0.15, D, 0.0, 0.34, 'M_Stone', skip=('back', 'bottom'))
    z0 = ftop + pw
    b.box(-fx - pw, fx + pw, D - 0.07, D, z0, z0 + 0.30, 'M_Stone', skip=('back', 'bottom'))
    cor = [(0.0, 0.0), (0.08, 0.0), (0.12, 0.04), (0.30, 0.07), (0.30, 0.20), (0.33, 0.24), (0.33, 0.28), (0.0, 0.28)]
    cz = z0 + 0.30
    b.prism_x([(D - a, cz + zz) for a, zz in cor], -fx - pw - 0.15, fx + pw + 0.15, 'M_Stone')
    # 청동 문짝(열려 벽 면에 접힘): 판 + 테(위·아래·가운데 가로대, 양 세로대) + 도드라진 판 두 개
    t0, t1 = D - 0.075, D - 0.02
    for sx in (-1, 1):
        xa, xb = sorted((sx * (dx + 0.015), sx * (dx + leaf_w - 0.005)))
        b.box(xa, xb, t0, t1, 0.005, clear_h - 0.01, 'M_Bronze', skip=('back', 'bottom'))
        f = t0 - 0.012
        rail = 0.09
        b.box(xa, xb, f, t0, 0.005, 0.005 + rail * 1.4, 'M_Bronze', skip=('back', 'bottom'))
        b.box(xa, xb, f, t0, clear_h - 0.01 - rail, clear_h - 0.01, 'M_Bronze', skip=('back', 'top'))
        mz = 0.98
        b.box(xa, xb, f, t0, mz, mz + rail, 'M_Bronze', skip=('back',))
        b.box(xa, xa + rail, f, t0, 0.005 + rail * 1.4, clear_h - 0.01 - rail, 'M_Bronze', skip=('back', 'top', 'bottom'))
        b.box(xb - rail, xb, f, t0, 0.005 + rail * 1.4, clear_h - 0.01 - rail, 'M_Bronze', skip=('back', 'top', 'bottom'))
        for za, zb in ((0.005 + rail * 1.4 + 0.05, mz - 0.05), (mz + rail + 0.05, clear_h - 0.01 - rail - 0.05)):
            b.box(xa + rail + 0.05, xb - rail - 0.05, t0 - 0.02, t0, za, zb, 'M_Bronze', skip=('back',))


def stairs(c):
    """mh_ext_stairs_12m: 8단(단 높이·깊이 계약대로), 디딤판 앞 끝 둥근 코(2.5cm 내밀기), 양옆 낮은 돌 난간턱.
    디딤판 k(위에서 0부터): z = −k·단높이, y ∈ [−(k+1)·깊이, −k·깊이]. 맨 위 디딤판은 현관 바닥과 같은 높이."""
    e = c['exterior']
    hw = e['porticoW'] / 2
    n, rise, run = e['steps'], e['stepRiseM'], e['stepRunM']
    total = n * rise
    b = Builder('mh_ext_stairs_12m', STAIRS_SLOTS)
    nose = 0.025
    prof = [(0.0, 0.0)]  # (y, z) — 위 뒤 끝에서 앞(−y)으로
    for k in range(n):
        z = -k * rise
        yf = -(k + 1) * run
        prof += [(yf - nose + 0.008, z), (yf - nose, z - 0.012), (yf - nose + 0.004, z - 0.03), (yf, z - 0.042), (yf, z - rise)]
    prof += [(-(n * run), -total), (0.0, -total)]
    sw = hw - 0.2  # 난간턱 안쪽
    b.sweep([(-y, z) for y, z in prof], (-sw, 0.0, 0.0), (sw, 0.0, 0.0), (0, -1, 0), (0, 0, 1), 'M_Stone')
    # 양옆 난간턱: 단 코 선 위 0.18m, 바깥 면은 기단 옆면(x = ±폭/2)과 같은 면
    slope = total / (n * run)
    over = 0.18
    for sx in (-1, 1):
        xa, xb = sorted((sx * sw, sx * hw))
        y_end = -(n * run)
        top_hi = over
        top_lo = -total + over
        side = [(0.0, -total), (0.0, top_hi), (y_end, top_lo), (y_end, -total)]
        prof2 = [(-y, z) for y, z in side]
        b.sweep(prof2, (xa, 0.0, 0.0), (xb, 0.0, 0.0), (0, -1, 0), (0, 0, 1), 'M_Stone', caps=True)
        _ = slope
    return b.finish()


# ── 날개 벽 ────────────────────────────────────────────────────
F = None  # 실내 바닥 높이(땅에서) — contract에서 정해짐


def _wall_profiles(rise):
    """날개 벽 가로 단면들 (y, z): y < 0 = 앞으로 나옴. 실내 바닥 높이(rise)에 기단 덮개, 실내 3.8m에 아키트레이브."""
    f = rise
    plinth = [(0.0, 0.0), (-0.06, 0.0), (-0.06, 0.21), (-0.045, 0.25), (0.0, 0.25)]
    rust = [(0.0, 0.25), (-0.012, 0.25), (-0.03, 0.27), (-0.03, 0.63), (-0.015, 0.65), (-0.03, 0.67), (-0.03, f - 0.17), (-0.012, f - 0.15), (0.0, f - 0.15)]
    cap = [(0.0, f - 0.15), (-0.04, f - 0.15), (-0.07, f - 0.1), (-0.07, f - 0.04), (-0.05, f), (0.0, f)]
    a0 = f + 3.80  # 현관 기둥 위 끝(아바쿠스 위)과 같은 높이
    ent = [
        (0.0, a0),
        (-0.08, a0),
        (-0.08, a0 + 0.15),
        (-0.095, a0 + 0.16),
        (-0.095, a0 + 0.31),
        (-0.11, a0 + 0.33),
        (-0.11, a0 + 0.36),
        (-0.075, a0 + 0.36),
        (-0.075, a0 + 0.70),
        (-0.10, a0 + 0.72),
        (-0.14, a0 + 0.78),
        (-0.16, a0 + 0.80),
        (-0.40, a0 + 0.82),
        (-0.40, a0 + 1.00),
        (-0.42, a0 + 1.02),
        (-0.46, a0 + 1.12),
        (-0.46, FACADE_H),
        (0.0, FACADE_H),
    ]
    return plinth, rust, cap, ent, a0


WALL_T_EXT = 0.6


def facade_wall(c):
    """mh_ext_wall_2m: 거친 돌 기단(실내 바닥 높이까지) · 석재 벽 면 · 양 끝 반쪽 벽기둥(이웃과 만나 하나) ·
    가운데 테 두른 오목 판 · 엔타블러처(현관 기둥 위 높이에서 시작) · 코니스. 높이 FACADE_H, 두께는 뒤로."""
    rise = _rise(c)
    L = 2.0
    b = Builder('mh_ext_wall_2m', WALL_SLOTS, uv_origin=(0.0, 0.0, rise))
    plinth, rust, cap, ent, a0 = _wall_profiles(rise)
    for prof in (plinth, rust, cap, ent):
        b.prism_x(prof, 0.0, L, 'M_Stone')
    # 벽 면(석재) — 가운데 판 자리만 빼고
    px0, px1, pz0, pz1 = 0.45, 1.55, rise + 0.8, rise + 3.1
    ix0, ix1, iz0, iz1 = px0 + 0.08, px1 - 0.08, pz0 + 0.08, pz1 - 0.08
    w0, w1 = rise, a0
    rects = [(0, L, w0, iz0), (0, L, iz1, w1), (0, ix0, iz0, iz1), (ix1, L, iz0, iz1)]
    for xa, xb, za, zb in rects:
        b.quad([(xa, 0, za), (xb, 0, za), (xb, 0, zb), (xa, 0, zb)], 'M_Ashlar')
    # 오목 판(3.5cm 들어감) + 테(3cm 나옴)
    rec = 0.035
    b.quad([(ix0, rec, iz0), (ix1, rec, iz0), (ix1, rec, iz1), (ix0, rec, iz1)], 'M_Ashlar')
    b.quad([(ix0, 0, iz0), (ix1, 0, iz0), (ix1, rec, iz0), (ix0, rec, iz0)], 'M_Ashlar')
    b.quad([(ix0, rec, iz1), (ix1, rec, iz1), (ix1, 0, iz1), (ix0, 0, iz1)], 'M_Ashlar')
    b.quad([(ix0, 0, iz0), (ix0, rec, iz0), (ix0, rec, iz1), (ix0, 0, iz1)], 'M_Ashlar')
    b.quad([(ix1, rec, iz0), (ix1, 0, iz0), (ix1, 0, iz1), (ix1, rec, iz1)], 'M_Ashlar')
    frame = [(0.0, 0.0), (0.03, 0.0), (0.03, 0.025), (0.015, 0.06), (0.0, 0.08)]
    path = [(px0, 0.0, pz0), (px0, 0.0, pz1), (px1, 0.0, pz1), (px1, 0.0, pz0)]
    b.sweep_path(frame, path, (0, -1, 0), [(1, 0, 0), (0, 0, -1), (-1, 0, 0), (0, 0, 1)], 'M_Stone', closed_path=True)
    # 양 끝 반쪽 벽기둥(이웃 조각과 만나 0.5m 벽기둥 하나)
    pw, pp = 0.25, 0.07
    for xa, xb in ((0.0, pw), (L - pw, L)):
        b.box(xa, xb, -pp, 0.0, rise + 0.18, a0 - 0.18, 'M_Stone', skip=('back', 'bottom', 'top'))
        b.box(xa, xb, -pp - 0.03, 0.0, rise, rise + 0.18, 'M_Stone', skip=('back', 'bottom'))
        b.box(xa, xb, -pp - 0.04, 0.0, a0 - 0.18, a0 - 0.06, 'M_Stone', skip=('back',))
        b.box(xa, xb, -pp - 0.05, 0.0, a0 - 0.06, a0, 'M_Stone', skip=('back', 'top'))
    # 위 덮개돌(두께 쪽)
    b.quad([(0, 0, FACADE_H), (L, 0, FACADE_H), (L, WALL_T_EXT, FACADE_H), (0, WALL_T_EXT, FACADE_H)], 'M_Stone')
    return b.finish()


def facade_end(c):
    """mh_ext_wall_end: 날개 끝 바깥 모서리 기둥. 좌우를 같은 조각으로 돌려 놓기 때문에 x·y 대칭 네모 기둥에
    벽의 가로 단면(기단·덮개·벽기둥 머리·엔타블러처)을 네 면에 두른다(모서리 45° 맞춤). 벽 단면보다 PIER만큼
    더 나와 날개 벽·꺾인 벽의 단면 끝을 안에 품는다."""
    rise = _rise(c)
    b = Builder('mh_ext_wall_end', WALL_SLOTS, uv_origin=(0.0, 0.0, rise))
    plinth, rust, cap, ent, a0 = _wall_profiles(rise)
    a = PIER
    loop = [(-a, -a, 0.0), (a, -a, 0.0), (a, a, 0.0), (-a, a, 0.0)]
    outs = [(0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0)]
    ups = [(0, 0, 1)] * 4
    for prof in (plinth, rust, cap, ent):
        b.sweep_path([(-y, z) for y, z in prof], loop, outs, ups, 'M_Stone', closed_path=True)
    pilaster_cap = [(0.0, a0 - 0.18), (-0.04, a0 - 0.18), (-0.04, a0 - 0.06), (-0.05, a0 - 0.06), (-0.05, a0), (0.0, a0)]
    pilaster_base = [(0.0, rise), (-0.03, rise), (-0.03, rise + 0.18), (0.0, rise + 0.18)]
    for prof in (pilaster_cap, pilaster_base):
        b.sweep_path([(-y, z) for y, z in prof], loop, outs, ups, 'M_Stone', closed_path=True)
    # 기둥 몸 네 면
    for k in range(4):
        p0, p1 = Vector(loop[k]), Vector(loop[(k + 1) % 4])
        b.quad([(p0.x, p0.y, rise), (p1.x, p1.y, rise), (p1.x, p1.y, a0), (p0.x, p0.y, a0)], 'M_Stone')
    b.quad([(-a, -a, FACADE_H), (a, -a, FACADE_H), (a, a, FACADE_H), (-a, a, FACADE_H)], 'M_Stone')
    return b.finish()


PIER = 0.25


def plaza_tile(c):
    b = Builder('mh_ext_plaza_2x2', PLAZA_SLOTS)
    b.quad([(0, 0, 0), (0, -2, 0), (2, -2, 0), (2, 0, 0)], 'M_Paving')
    return b.finish()


def hedge(c):
    """mh_ext_hedge_2m: 돌 턱(앞) + 회양목 산울타리(높이 HEDGE_H, 깊이 0.72). 앞·위 면은 2m 주기 물결(이웃과 이어짐),
    앞 위 모서리는 둥글게 깎은 모양. 기준점 = 땅·시작 쪽, +X 2m, 앞 = −Y(광장)."""
    L = 2.0
    b = Builder('mh_ext_hedge_2m', HEDGE_SLOTS)
    # 돌 턱
    curb = [(0.0, 0.0), (-0.14, 0.0), (-0.14, 0.13), (-0.125, 0.16), (-0.0, 0.16)]
    b.prism_x([(y + 0.0, z) for y, z in curb], 0.0, L, 'M_Stone')
    y_front, y_back = 0.06, 0.78
    top = HEDGE_H

    def bump(x, z, k):
        t = 2 * math.pi * x / L
        return 0.018 * math.sin(2 * t + 1.3 * k + z * 3.1) + 0.012 * math.sin(5 * t + 0.7 + k) + 0.008 * math.sin(9 * t + z * 7.0 + 2 * k)

    # 단면 위의 점(앞 → 위 → 뒤): (y, z, 법선 방향)
    prof = [
        (y_front, 0.10),
        (y_front, 0.40),
        (y_front, 0.70),
        (y_front + 0.005, 0.92),
        (y_front + 0.035, top - 0.06),
        (y_front + 0.10, top - 0.005),
        (0.30, top),
        (0.52, top),
        (y_back - 0.08, top - 0.01),
        (y_back, top - 0.09),
        (y_back, 0.10),
    ]
    nrm = [(-1, 0), (-1, 0), (-1, 0), (-1, 0.15), (-0.7, 0.7), (-0.2, 1), (0, 1), (0, 1), (0.3, 1), (1, 0.2), (1, 0)]
    nx = 10
    rings = []
    for j, ((y, z), (ny_, nz_)) in enumerate(zip(prof, nrm)):
        ln = math.hypot(ny_, nz_)
        ny_, nz_ = ny_ / ln, nz_ / ln
        ring = []
        for i in range(nx + 1):
            x = L * i / nx
            dd = bump(x, z, j) if j < len(prof) - 1 else 0.0
            dd = abs(dd) * 0.6 + dd * 0.4  # 주로 바깥으로 부풀게
            ring.append((x, y + ny_ * dd, z + nz_ * dd))
        rings.append(ring)
    # 고리: x 방향 점 목록이 하나의 "고리"가 되도록 바꿔 잇는다(열린 띠)
    grid, faces = b.loft(rings, 'M_Hedge', closed=False, smooth=True)
    # 끝 마구리(x = 0, x = L): 단면 다각형
    caps = []
    for i in (0, nx):
        caps.append(b.cap([grid[j][i] for j in range(len(prof))], 'M_Hedge'))
    bmesh.ops.recalc_face_normals(b.bm, faces=faces + caps)
    return b.finish()


MODULES = {
    'mh_ext_portico_12m': portico,
    'mh_ext_stairs_12m': stairs,
    'mh_ext_wall_2m': facade_wall,
    'mh_ext_wall_end': facade_end,
    'mh_ext_plaza_2x2': plaza_tile,
    'mh_ext_hedge_2m': hedge,
}
