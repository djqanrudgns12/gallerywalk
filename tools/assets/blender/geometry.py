"""조각 형상 만들기(bmesh). 좌표·치수 규칙은 tools/assets/spec/modules.md §1·§2.

벽은 Blender +X로 뻗고 방 안쪽이 −Y, 회반죽 면 y = 0, 바닥 z = 0, 높이 4m.
판벽의 기둥(stile)은 1m마다이고 조각 양끝에는 절반 폭만 둔다 — 이웃 조각과 만나면 한 기둥이 된다(주기성).

Blender(Z-위) → glTF(Y-위): (x, y, z) → (x, z, −y). 그래서 Blender −Y = glTF +Z = 조각의 "앞"(방 안쪽·광장 쪽).
"""

import math

import bmesh
import bpy
from mathutils import Vector

H = 4.0
PANEL_H = 1.1
DOOR_CLEAR_W = 1.8
DOOR_CLEAR_H = 2.7
CASING = 0.1
WALL_T = 0.3
TILE_M = 2.0  # 질감 한 장 = 2m (UV0 1 = 2m)


def _v(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


class Builder:
    """한 조각의 bmesh를 모으고 면마다 재질 칸 번호를 매긴다.

    UV0(`UVMap`)는 `finish()`에서 만든다: 면마다 직접 준 값이 있으면 그것, 없으면 면 법선의 주축으로 투영한
    세계 크기 타일(1 UV = 2m). `uv_origin`을 빼고 투영한다 — 땅 높이에 놓이는 외관 조각이 실내 바닥 높이 기준으로
    줄눈을 맞출 때 쓴다(modules.md §3).
    """

    def __init__(self, name, slots, uv_origin=(0.0, 0.0, 0.0)):
        self.name = name
        self.slots = list(slots)
        self.bm = bmesh.new()
        self.uv = {}
        self.uv_origin = Vector(uv_origin)

    def slot(self, material):
        return self.slots.index(material)

    # ── 기본 면 ─────────────────────────────────────────────
    def face(self, pts, material, smooth=False, uv=None):
        verts = [self.bm.verts.new(_v(p)) for p in pts]
        f = self.bm.faces.new(verts)
        f.material_index = self.slot(material)
        f.smooth = smooth
        if uv is not None:
            self.uv[f] = list(uv)
        return f

    def quad(self, pts, material, uv=None):
        return self.face(pts, material, uv=uv)

    def face_n(self, pts, material, toward):
        """면 하나 — 법선이 `toward` 쪽을 보도록 꼭짓점 순서를 맞춘다(뉴얼 법선)."""
        n = Vector((0.0, 0.0, 0.0))
        P = [_v(p) for p in pts]
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if n.dot(_v(toward)) < 0:
            pts = list(reversed(pts))
        return self.face(pts, material)

    def box(self, x0, x1, y0, y1, z0, z1, material, skip=()):
        """축 정렬 상자. skip에 'back'(+y)·'bottom' 등을 넣으면 보이지 않는 면을 뺀다(삼각형 절약)."""
        v = {}
        for xi, x in (('0', x0), ('1', x1)):
            for yi, y in (('0', y0), ('1', y1)):
                for zi, z in (('0', z0), ('1', z1)):
                    v[xi + yi + zi] = (x, y, z)
        faces = {
            'front': ('000', '100', '101', '001'),  # −y (방 쪽)
            'back': ('010', '011', '111', '110'),
            'left': ('000', '001', '011', '010'),
            'right': ('100', '110', '111', '101'),
            'bottom': ('000', '010', '110', '100'),
            'top': ('001', '101', '111', '011'),
        }
        for key, idx in faces.items():
            if key in skip:
                continue
            self.quad([v[i] for i in idx], material)

    def prism_x(self, profile, x0, x1, material, caps=True):
        """(y, z) 닫힌 단면을 x0→x1로 밀어 만든 몰딩. 단면은 회반죽 면(y=0)에서 방 쪽(−y)으로 나온다."""
        a = [self.bm.verts.new((x0, y, z)) for (y, z) in profile]
        b = [self.bm.verts.new((x1, y, z)) for (y, z) in profile]
        n = len(profile)
        made = []
        for i in range(n):
            j = (i + 1) % n
            made.append(self.bm.faces.new((a[i], a[j], b[j], b[i])))
        if caps:
            made.append(self.bm.faces.new(list(reversed(a))))
            made.append(self.bm.faces.new(b))
        for f in made:
            f.material_index = self.slot(material)
        # 닫힌 단면이라 바깥 방향 재계산이 믿을 만하다(상자·사각형은 꼭짓점 순서로 방향을 정함).
        bmesh.ops.recalc_face_normals(self.bm, faces=made)
        return made

    # ── 단면 밀기(몰딩·코니스) ───────────────────────────────────
    def sweep(self, profile, start, end, adir, bdir, material, cut0=None, cut1=None, caps=False):
        """닫힌 단면 (a, b)를 start→end로 민다: 점 = 길 위 점 + adir·a + bdir·b.
        cut0·cut1 = (점, 법선) 평면 — 끝 고리를 진행 방향으로 그 평면까지 옮긴다(모서리 45° 맞춤·박공 끝 자르기).
        단면은 닫혀 있어야 한다(벽에 붙는 변 포함) — 그래야 바깥 방향 재계산이 믿을 만하다."""
        s, e = _v(start), _v(end)
        ad, bd = _v(adir).normalized(), _v(bdir).normalized()
        d = (e - s).normalized()

        def ring(base, cut):
            pts = []
            for a, b in profile:
                p = base + ad * a + bd * b
                if cut is not None:
                    cp, cn = _v(cut[0]), _v(cut[1])
                    den = d.dot(cn)
                    if abs(den) > 1e-9:
                        p = p + d * ((cp - p).dot(cn) / den)
                pts.append(p)
            return pts

        grid, faces = self.loft([ring(s, cut0), ring(e, cut1)], material, closed=True, smooth=False)
        if caps:
            faces.append(self.cap(grid[0], material, flip=True))
            faces.append(self.cap(grid[1], material))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return faces

    def sweep_path(self, profile, path, adirs, bdirs, material, closed_path=False, caps=False):
        """꺾은선 path를 따라 단면을 민다. adirs·bdirs = 선분마다 방향(하나만 주면 모든 선분에 같게).
        꺾인 곳은 두 선분 방향의 평균을 법선으로 한 평면으로 맞춘다(모서리 45°)."""
        n = len(path)
        segs = n if closed_path else n - 1

        def per(dirs):
            if len(dirs) == 3 and all(isinstance(x, (int, float)) for x in dirs):
                return [dirs] * segs
            return list(dirs)

        adirs, bdirs = per(adirs), per(bdirs)

        def miter(i):
            if not closed_path and (i == 0 or i == n - 1):
                return None
            prev_d = (_v(path[i]) - _v(path[(i - 1) % n])).normalized()
            next_d = (_v(path[(i + 1) % n]) - _v(path[i])).normalized()
            return (path[i], (prev_d + next_d).normalized())

        for k in range(segs):
            self.sweep(profile, path[k], path[(k + 1) % n], adirs[k], bdirs[k], material, cut0=miter(k), cut1=miter((k + 1) % n), caps=caps)

    # ── 회전체·고리 잇기 ─────────────────────────────────────────
    def loft(self, rings, material, closed=True, smooth=True, sharp_cols=(), sharp_rows=(), uv=None):
        """같은 점 수의 고리들을 차례로 잇는다(고리 사이 띠). 꼭짓점을 나눠 써서 매끈한 법선이 된다.
        sharp_cols = 날카롭게 둘 고리 안 점 번호(세로 모서리), sharp_rows = 날카롭게 둘 고리 번호(가로 모서리).
        uv(i, j) → (u, v)를 주면 그 값으로(i = 고리 번호, j = 점 번호, j = m은 이음선 닫는 끝)."""
        m = len(rings[0])
        grid = [[self.bm.verts.new(_v(p)) for p in r] for r in rings]
        faces = []
        cols = m if closed else m - 1
        for i in range(len(rings) - 1):
            for j in range(cols):
                j2 = (j + 1) % m
                f = self.bm.faces.new((grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]))
                f.material_index = self.slot(material)
                f.smooth = smooth
                if uv is not None:
                    jj = j + 1
                    self.uv[f] = [uv(i, j), uv(i, jj), uv(i + 1, jj), uv(i + 1, j)]
                faces.append(f)
        for j in sharp_cols:
            for i in range(len(rings) - 1):
                e = self.bm.edges.get((grid[i][j], grid[i + 1][j]))
                if e is not None:
                    e.smooth = False
        for i in sharp_rows:
            for j in range(cols):
                e = self.bm.edges.get((grid[i][j], grid[i][(j + 1) % m]))
                if e is not None:
                    e.smooth = False
        return grid, faces

    def cap(self, ring_verts, material, flip=False):
        vs = list(reversed(ring_verts)) if flip else list(ring_verts)
        f = self.bm.faces.new(vs)
        f.material_index = self.slot(material)
        return f

    def lathe(self, profile, segments, material, center=(0.0, 0.0), sharp=(), cap_bottom=False, cap_top=False, phase=0.0):
        """(r, z) 단면을 z축 둘레로 돌린 회전체(기둥머리·화분·가로등). sharp = 날카롭게 둘 단면 점 번호.
        UV0는 원통 펼침(u = 둘레 길이, v = z)이라 이음선이 한 줄뿐이다."""
        cx, cy = center
        rings = []
        for r, z in profile:
            rings.append(
                [
                    (cx + r * math.cos(phase + 2 * math.pi * k / segments), cy + r * math.sin(phase + 2 * math.pi * k / segments), z)
                    for k in range(segments)
                ]
            )
        rmax = max(r for r, _ in profile)

        def uv(i, j):
            return (2 * math.pi * rmax * j / segments / TILE_M, profile[i][1] / TILE_M)

        grid, faces = self.loft(rings, material, closed=True, smooth=True, sharp_rows=sharp, uv=uv)
        if cap_bottom:
            self.cap(grid[0], material, flip=True)
        if cap_top:
            self.cap(grid[-1], material)
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        # 열린 회전면은 바깥 방향 재계산이 안쪽을 고를 수 있다(첫 실제 굽기 R-3: 기둥머리 아래가 안에서 구워져 검게 나옴).
        # 면 넓이로 무게를 준 "축에서 멀어지는 쪽" 합이 음수면 모두 뒤집는다(방향은 서로 맞춰져 있으므로 한꺼번에).
        out = 0.0
        for f in faces:
            f.normal_update()
            c = f.calc_center_median()
            radial = Vector((c.x - cx, c.y - cy, 0.0))
            if radial.length > 1e-9:
                out += f.normal.dot(radial.normalized()) * f.calc_area()
        if out < 0.0:
            bmesh.ops.reverse_faces(self.bm, faces=faces)
        return grid

    def beam(self, a, b, w, d, material, up=(0.0, 0.0, 1.0), chamfer=0.0, caps=(True, True), taper=1.0):
        """a→b 사이 각진 막대(단면 w × d, chamfer > 0이면 모서리를 깎은 팔각). taper = 끝(b)의 굵기 비율."""
        pa, pb = _v(a), _v(b)
        axis = (pb - pa).normalized()
        upv = _v(up)
        if abs(axis.dot(upv)) > 0.95:
            upv = Vector((0.0, 1.0, 0.0)) if abs(axis.dot(Vector((0, 1, 0)))) < 0.95 else Vector((1.0, 0.0, 0.0))
        side = axis.cross(upv).normalized()
        upn = side.cross(axis).normalized()
        hw, hd = w / 2, d / 2
        c = min(chamfer, hw * 0.9, hd * 0.9)
        if c > 0:
            sec = [(hw, hd - c), (hw - c, hd), (-hw + c, hd), (-hw, hd - c), (-hw, -hd + c), (-hw + c, -hd), (hw - c, -hd), (hw, -hd + c)]
        else:
            sec = [(hw, hd), (-hw, hd), (-hw, -hd), (hw, -hd)]
        ra = [pa + side * s + upn * t for s, t in sec]
        rb = [pb + (side * s + upn * t) * taper for s, t in sec]
        grid, faces = self.loft([ra, rb], material, closed=True, smooth=False)
        if caps[0]:
            faces.append(self.cap(grid[0], material, flip=True))
        if caps[1]:
            faces.append(self.cap(grid[1], material))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return faces

    def cylinder(self, a, b, r0, r1, segments, material, caps=(True, True), smooth=True):
        pa, pb = _v(a), _v(b)
        axis = (pb - pa).normalized()
        ref = Vector((1.0, 0.0, 0.0)) if abs(axis.x) < 0.9 else Vector((0.0, 1.0, 0.0))
        s1 = axis.cross(ref).normalized()
        s2 = axis.cross(s1).normalized()
        ring = lambda p, r: [p + (s1 * math.cos(2 * math.pi * k / segments) + s2 * math.sin(2 * math.pi * k / segments)) * r for k in range(segments)]
        ln = (pb - pa).length
        rm = max(r0, r1)
        grid, faces = self.loft(
            [ring(pa, r0), ring(pb, r1)],
            material,
            closed=True,
            smooth=smooth,
            uv=lambda i, j: (2 * math.pi * rm * j / segments / TILE_M, (i * ln) / TILE_M),
        )
        if caps[0]:
            faces.append(self.cap(grid[0], material, flip=True))
        if caps[1]:
            faces.append(self.cap(grid[1], material))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return grid

    def grid_surface(self, fn, nu, nv, material, smooth=True, closed_u=False):
        """fn(s, t) → 점(s, t ∈ [0, 1])의 격자 면. 꼭짓점을 나눠 써서 매끈하다(산울타리·방석)."""
        cols = nu if closed_u else nu + 1
        rings = [[fn(i / nu, j / nv) for i in range(cols)] for j in range(nv + 1)]
        return self.loft(rings, material, closed=closed_u, smooth=smooth)

    # ── 마무리 ───────────────────────────────────────────────
    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        # 재질 칸을 먼저 만들어야 면마다 매긴 칸 번호가 살아남는다(칸이 없으면 0으로 눌림).
        for slot in self.slots:
            mesh.materials.append(bpy.data.materials.get(f'PH_{slot}') or bpy.data.materials.new(f'PH_{slot}'))
        layer = self.bm.loops.layers.uv.get('UVMap') or self.bm.loops.layers.uv.new('UVMap')
        o = self.uv_origin
        for f in self.bm.faces:
            given = self.uv.get(f)
            if given is not None and len(given) == len(f.loops):
                for loop, uv in zip(f.loops, given):
                    loop[layer].uv = uv
                continue
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                co = loop.vert.co - o
                if ax == 1:
                    u, v = co.x, co.z
                elif ax == 0:
                    u, v = co.y, co.z
                else:
                    u, v = co.x, co.y
                loop[layer].uv = (u / TILE_M, v / TILE_M)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


CHAIR_RAIL = [(0.0, 1.06), (-0.03, 1.07), (-0.055, 1.09), (-0.06, 1.115), (-0.045, 1.14), (0.0, 1.15)]
BASEBOARD = [(0.0, 0.0), (-0.045, 0.0), (-0.045, 0.12), (-0.035, 0.15), (0.0, 0.17)]
CROWN = [(0.0, 3.80), (-0.015, 3.82), (-0.06, 3.88), (-0.095, 3.96), (-0.10, 4.0), (0.0, 4.0)]

WALL_SLOTS = ('M_Plaster', 'M_Panel', 'M_Molding', 'M_Brass')
# 천장 몰딩은 회반죽(흰색) — 밝은 미술관(R-3). 판벽·의자 몰딩·걸레받이는 참나무.
CROWN_SLOT = 'M_Plaster'


def wainscot(b, x0, x1):
    """징두리 판벽: 뒤판 + 1m 칸마다 기둥 + 위·아래 가로대 + 살짝 도드라진 판(굽기에서 그늘 선이 생김)."""
    b.box(x0, x1, -0.03, 0.0, 0.0, PANEL_H, 'M_Panel', skip=('back', 'bottom'))
    start = int(round(x0))
    end = int(round(x1))
    # 기둥은 위·아래 가로대 사이에만 둔다 — 가로대와 앞면이 같은 평면에서 겹치면 굽기에서 서로 가려 검게 구워지고
    # 화면에서 깜빡인다(첫 실제 굽기 R-3에서 발견: 기둥 위·아래 끝의 검은 네모).
    for k in range(start, end + 1):
        sx0 = max(x0, k - 0.05)
        sx1 = min(x1, k + 0.05)
        if sx1 - sx0 > 1e-6:
            b.box(sx0, sx1, -0.045, -0.03, 0.29, PANEL_H - 0.16, 'M_Panel', skip=('back', 'top', 'bottom'))
    b.box(x0, x1, -0.045, -0.03, 0.17, 0.29, 'M_Panel', skip=('back',))
    b.box(x0, x1, -0.045, -0.03, PANEL_H - 0.16, PANEL_H - 0.04, 'M_Panel', skip=('back',))
    for k in range(start, end):
        fx0, fx1 = k + 0.05 + 0.03, k + 1 - 0.05 - 0.03
        b.box(fx0, fx1, -0.040, -0.03, 0.29 + 0.03, PANEL_H - 0.16 - 0.03, 'M_Panel', skip=('back',))


def wall(length):
    """mh_wall_4m·mh_wall_2m"""
    b = Builder(f'mh_wall_{int(length)}m', WALL_SLOTS)
    b.quad([(0, 0, PANEL_H), (length, 0, PANEL_H), (length, 0, H), (0, 0, H)], 'M_Plaster')
    wainscot(b, 0.0, length)
    b.prism_x(CHAIR_RAIL, 0.0, length, 'M_Molding')
    b.prism_x(BASEBOARD, 0.0, length, 'M_Molding')
    b.prism_x(CROWN, 0.0, length, CROWN_SLOT)
    track_lights(b, length)
    return b.finish()


def track_lights(b, length):
    """천장 레일과 조명(2m마다 하나, 각 2m 구간 가운데). 표준 조명틀의 광원 자리와 같다."""
    b.box(0.0, length, -0.62, -0.58, 3.92, 3.96, 'M_Brass', skip=('top',))
    k = 1.0
    while k < length:
        b.box(k - 0.035, k + 0.035, -0.635, -0.565, 3.80, 3.92, 'M_Brass', skip=('top',))
        k += 2.0


def door_wall():
    """mh_wall_door_2m: 맑은 폭 1.8m × 높이 2.7m 열림 + 문틀 + 벽 두께 안쪽면(문을 통해 깊이가 보이게) + 문턱.
    문턱(참나무)은 방 바닥 판과 회랑 바닥 판 사이 벽 두께(0.3m)를 메운다 — 없으면 문 아래로 땅이 보인다."""
    length = 2.0
    b = Builder('mh_wall_door_2m', WALL_SLOTS)
    top = DOOR_CLEAR_H + CASING
    b.quad([(0, 0, top), (length, 0, top), (length, 0, H), (0, 0, H)], 'M_Plaster')
    # 문틀(방 쪽으로 5cm)
    b.box(0.0, CASING, -0.05, 0.0, 0.0, top, 'M_Panel', skip=('back',))
    b.box(length - CASING, length, -0.05, 0.0, 0.0, top, 'M_Panel', skip=('back',))
    b.box(CASING, length - CASING, -0.05, 0.0, DOOR_CLEAR_H, top, 'M_Panel', skip=('back',))
    # 벽 두께 안쪽면(옆·위)
    b.quad([(CASING, 0, 0), (CASING, WALL_T, 0), (CASING, WALL_T, DOOR_CLEAR_H), (CASING, 0, DOOR_CLEAR_H)], 'M_Plaster')
    rx = length - CASING
    b.quad([(rx, 0, 0), (rx, 0, DOOR_CLEAR_H), (rx, WALL_T, DOOR_CLEAR_H), (rx, WALL_T, 0)], 'M_Plaster')
    b.quad(
        [(CASING, 0, DOOR_CLEAR_H), (CASING, WALL_T, DOOR_CLEAR_H), (rx, WALL_T, DOOR_CLEAR_H), (rx, 0, DOOR_CLEAR_H)],
        'M_Plaster',
    )
    b.quad([(CASING, 0, 0), (rx, 0, 0), (rx, WALL_T, 0), (CASING, WALL_T, 0)], 'M_Panel')  # 문턱(위를 봄)
    b.prism_x(CROWN, 0.0, length, CROWN_SLOT)
    track_lights(b, length)
    return b.finish()


CORNER_SLOTS = ('M_Molding', 'M_Plaster')


def corner_in():
    """mh_corner_in: 안쪽 모서리 덮개 기둥(두 벽 몰딩 끝의 맞닿음을 가림). 기준점 = 모서리.
    판벽 높이까지는 참나무, 그 위는 흰 회반죽(천장 몰딩 끝까지) — 흰 벽에 갈색 줄이 서지 않게."""
    b = Builder('mh_corner_in', CORNER_SLOTS)
    b.box(0.0, 0.08, -0.08, 0.0, 0.0, PANEL_H + 0.05, 'M_Molding', skip=('back', 'bottom', 'top'))
    b.box(0.0, 0.08, -0.08, 0.0, PANEL_H + 0.05, H, 'M_Plaster', skip=('back', 'bottom', 'top'))
    return b.finish()


OUTER_PROUD = 0.12  # 몰딩 가장 깊은 돌출(천장 몰딩 0.10)보다 조금 더
OUTER_BACK = 0.04  # 벽 면 뒤로 묻히는 깊이(몰딩 끝이 맞닿는 면)


def corner_out():
    """mh_corner_out: 바깥(볼록) 모서리 덮개 기둥 — 홀이 회랑으로 꺾이는 곳(PLAN §4.6).

    기준점 = 모서리. 벽 A는 +X로 와서 모서리에서 끝나고 방 안쪽이 −Y, 벽 B는 모서리에서 +Y로 뻗고 방 안쪽이 +X.
    기둥은 두 벽 몰딩의 끝면을 모두 덮는다(A 쪽 몰딩은 x = −OUTER_BACK 면에, B 쪽은 y = OUTER_BACK 면에 맞닿음).
    """
    b = Builder('mh_corner_out', CORNER_SLOTS)
    b.box(-OUTER_BACK, OUTER_PROUD, -OUTER_PROUD, OUTER_BACK, 0.0, PANEL_H + 0.05, 'M_Molding', skip=('bottom', 'top'))
    b.box(-OUTER_BACK, OUTER_PROUD, -OUTER_PROUD, OUTER_BACK, PANEL_H + 0.05, H, 'M_Plaster', skip=('bottom', 'top'))
    return b.finish()


def ceiling_tile():
    """mh_ceiling_2x2: 우물천장 판(z=4, 아래를 봄) + 둘레 보(이웃 칸과 만나 0.08m 보가 됨)."""
    b = Builder('mh_ceiling_2x2', ('M_Ceiling',))
    s = 2.0
    b.quad([(0, 0, H), (s, 0, H), (s, -s, H), (0, -s, H)], 'M_Ceiling')  # 아래(−Z)를 봄
    d = 0.12
    w = 0.04
    b.box(0, s, -w, 0, H - d, H, 'M_Ceiling', skip=('top',))
    b.box(0, s, -s, -s + w, H - d, H, 'M_Ceiling', skip=('top',))
    b.box(0, w, -s + w, -w, H - d, H, 'M_Ceiling', skip=('top',))
    b.box(s - w, s, -s + w, -w, H - d, H, 'M_Ceiling', skip=('top',))
    return b.finish()


def floor_tile():
    """mh_floor_2x2: 바닥 판(구운 빛 없음)."""
    b = Builder('mh_floor_2x2', ('M_Floor',))
    s = 2.0
    b.quad([(0, 0, 0), (0, -s, 0), (s, -s, 0), (s, 0, 0)], 'M_Floor')  # 위(+Z)를 봄
    return b.finish()


# ── 정문(홀 뒷벽 가운데, R-3) ─────────────────────────────────────
ENTRANCE_W = 4.0
ENTRANCE_SLOTS = ('M_Plaster', 'M_Marble', 'M_Brass')
# 둘레 단면(문틀 테): (돌출 a, 폭 방향 b) — b = 열림 가장자리에서 바깥으로
ARCHITRAVE = [(0.0, 0.0), (0.035, 0.0), (0.035, 0.07), (0.048, 0.08), (0.048, 0.15), (0.062, 0.165), (0.062, 0.2), (0.03, 0.22), (0.0, 0.22)]


def entrance():
    """mh_entrance_4m: 홀 뒷벽 가운데 정문. 4m 칸 한가운데 맑은 1.8m × 2.7m 열림(문 조각과 같은 맑은 크기).

    4m인 까닭: 홀 뒷벽 12m에서 가운데 2m 문을 빼면 양옆이 5m라 2m 조각으로 채울 수 없다. 4m 정문이면 양옆 4m씩.
    구성: 양 끝 대리석 벽기둥(이웃 판벽·의자 몰딩이 이 옆면에서 끝남) · 대리석 징두리 · 문틀 테(세 단) ·
    문 위 띠 + 코니스 + 낮은 박공 · 벽 두께 안쪽 대리석 면 · 대리석 문턱 · 천장 몰딩·레일(벽 조각과 같은 줄).
    문짝(청동)은 바깥(현관 쪽 벽 면)에 접혀 있어 현관 조각에 있다(바깥 빛으로 굽기 때문).
    """
    L = ENTRANCE_W
    b = Builder('mh_entrance_4m', ENTRANCE_SLOTS)
    x0, x1 = (L - DOOR_CLEAR_W) / 2, (L + DOOR_CLEAR_W) / 2  # 1.1, 2.9
    top = DOOR_CLEAR_H
    # 회반죽 면(열림 빼고)
    b.quad([(0, 0, top), (L, 0, top), (L, 0, H), (0, 0, H)], 'M_Plaster')
    b.quad([(0, 0, 0), (x0, 0, 0), (x0, 0, top), (0, 0, top)], 'M_Plaster')
    b.quad([(x1, 0, 0), (L, 0, 0), (L, 0, top), (x1, 0, top)], 'M_Plaster')
    # 벽 두께 안쪽(대리석) + 문턱
    b.quad([(x0, 0, 0), (x0, WALL_T, 0), (x0, WALL_T, top), (x0, 0, top)], 'M_Marble')
    b.quad([(x1, 0, 0), (x1, 0, top), (x1, WALL_T, top), (x1, WALL_T, 0)], 'M_Marble')
    b.quad([(x0, 0, top), (x0, WALL_T, top), (x1, WALL_T, top), (x1, 0, top)], 'M_Marble')
    b.quad([(x0, -0.02, 0.0), (x1, -0.02, 0.0), (x1, WALL_T, 0.0), (x0, WALL_T, 0.0)], 'M_Marble')
    # 양 끝 벽기둥(이웃 벽의 판벽 0.045·의자 몰딩 0.06보다 더 나와 그 끝을 받는다)
    pw, pp = 0.32, 0.09
    for (a0, a1) in ((0.0, pw), (L - pw, L)):
        b.box(a0, a1, -pp, 0.0, 0.2, 3.56, 'M_Marble', skip=('back', 'bottom', 'top'))
        b.box(a0 - (0.0 if a0 == 0 else 0.02), a1 + (0.02 if a0 == 0 else 0.0), -pp - 0.025, 0.0, 0.0, 0.2, 'M_Marble', skip=('back', 'bottom'))
        b.box(a0 - (0.0 if a0 == 0 else 0.02), a1 + (0.02 if a0 == 0 else 0.0), -pp - 0.03, 0.0, 3.56, 3.70, 'M_Marble', skip=('back',))
    # 대리석 징두리(벽기둥 ~ 문틀 테 사이): 판 + 위 몰딩(이웃 의자 몰딩 높이) + 아래 걸레받이
    fw = ARCHITRAVE[-1][1]
    for (a0, a1) in ((pw, x0 - fw), (x1 + fw, L - pw)):
        b.box(a0, a1, -0.03, 0.0, 0.0, PANEL_H, 'M_Marble', skip=('back', 'bottom'))
        b.prism_x([(0.0, 1.05), (-0.04, 1.06), (-0.058, 1.09), (-0.058, 1.12), (-0.04, 1.15), (0.0, 1.16)], a0, a1, 'M_Marble')
        b.prism_x([(0.0, 0.0), (-0.05, 0.0), (-0.05, 0.13), (-0.035, 0.16), (0.0, 0.17)], a0, a1, 'M_Marble')
    # 문틀 테: 왼쪽 기둥 → 머리 → 오른쪽 기둥(모서리 45° 맞춤). 아래 끝은 바닥 받침돌.
    path = [(x0, 0.0, 0.0), (x0, 0.0, top), (x1, 0.0, top), (x1, 0.0, 0.0)]
    b.sweep_path(ARCHITRAVE, path, (0, -1, 0), [(-1, 0, 0), (0, 0, 1), (1, 0, 0)], 'M_Marble')
    for xa, xb in ((x0 - fw - 0.02, x0), (x1, x1 + fw + 0.02)):
        b.box(xa, xb, -0.075, 0.0, 0.0, 0.26, 'M_Marble', skip=('back', 'bottom'))
    # 문 위 띠·코니스·박공
    fz0, fz1 = top + fw, top + fw + 0.22
    fx0, fx1 = x0 - fw, x1 + fw
    b.box(fx0, fx1, -0.04, 0.0, fz0, fz1, 'M_Marble', skip=('back', 'bottom'))
    cornice = [(0.0, 0.0), (-0.06, 0.0), (-0.09, 0.03), (-0.15, 0.05), (-0.17, 0.12), (-0.185, 0.17), (-0.16, 0.19), (0.0, 0.19)]
    cx0, cx1 = fx0 - 0.12, fx1 + 0.12
    b.prism_x([(a, fz1 + z) for a, z in cornice], cx0, cx1, 'M_Marble')
    pz = fz1 + 0.19
    half = (cx1 - cx0) / 2
    mid = (cx0 + cx1) / 2
    rise = min(3.70 - pz, half * math.tan(math.radians(15)))
    apex = pz + rise
    b.face([(cx0 + 0.2, -0.03, pz), (cx1 - 0.2, -0.03, pz), (mid, -0.03, apex - 0.06)], 'M_Marble')  # 박공 안 면
    rake = [(0.0, 0.0), (0.07, 0.0), (0.13, 0.03), (0.145, 0.075), (0.0, 0.075)]
    for side in (-1, 1):
        s0 = Vector((mid + side * half, 0.0, pz))
        e0 = Vector((mid, 0.0, apex))
        d = (e0 - s0).normalized()
        perp = Vector((-d.z, 0.0, d.x)) if side < 0 else Vector((d.z, 0.0, -d.x))  # 비탈에 수직, 위·바깥
        b.sweep(rake, s0, e0, (0, -1, 0), perp, 'M_Marble', cut0=((0.0, 0.0, pz), (0.0, 0.0, 1.0)), cut1=((mid, 0.0, apex), (1.0, 0.0, 0.0)))
    b.prism_x(CROWN, 0.0, L, CROWN_SLOT)
    track_lights(b, L)
    return b.finish()


MODULES = {
    'mh_wall_4m': lambda: wall(4.0),
    'mh_wall_2m': lambda: wall(2.0),
    'mh_wall_door_2m': door_wall,
    'mh_corner_in': corner_in,
    'mh_corner_out': corner_out,
    'mh_ceiling_2x2': ceiling_tile,
    'mh_floor_2x2': floor_tile,
    'mh_entrance_4m': entrance,
}

# 굽기 이웃: 벽 조각은 양옆에 같은 길이 조각(문·정문은 4m 벽 사이), 천장은 사방에 같은 칸.
WALL_LENGTH = {'mh_wall_4m': 4.0, 'mh_wall_2m': 2.0, 'mh_wall_door_2m': 2.0, 'mh_entrance_4m': ENTRANCE_W}
