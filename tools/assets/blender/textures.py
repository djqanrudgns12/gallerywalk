"""이음새 없이 반복되는 질감 만들기(numpy 주기 잡음). tools/assets/spec/modules.md §4.

FFT로 거른 잡음은 정의상 주기적이라, 질감 한 장(2m)을 이어 붙여도 경계가 보이지 않는다.
돌 줄눈·포장 줄눈·잎 무늬도 2m 주기에 맞춰 놓는다(줄 수·덩이 수가 정수, 잎 도장은 가장자리를 넘으면 반대편에도 찍음).
시드를 고정해 같은 입력이면 같은 그림이 나온다(빌드 재현성). 외부 파일·사진을 쓰지 않는다.

색 방향(R-3, ADR-057 "밝고 고급스러운 고전 미술관"): 따뜻한 흰 회반죽 · 밝은 참나무 · 연한 석회암/대리석 · 황동.
값은 sRGB 0..1(이미지로 저장할 때 그대로 8비트).
"""

import math

import numpy as np

TILE_M = 2.0


def periodic_noise(size, seed, beta=1.8, stretch=(1.0, 1.0), cutoff=None, angle=0.0):
    """1/f^beta 스펙트럼의 주기 잡음, 0..1. stretch=(ax, ay)로 한 방향을 길게(나뭇결).
    angle(라디안)은 늘이는 축을 돌린다 — 거르기만 돌리므로 결과는 여전히 질감 한 장 주기다(흙손 자국)."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((size, size))
    fy0 = np.fft.fftfreq(size)[:, None]
    fx0 = np.fft.fftfreq(size)[None, :]
    ca, sa = math.cos(angle), math.sin(angle)
    fx = (fx0 * ca + fy0 * sa) * stretch[0]
    fy = (-fx0 * sa + fy0 * ca) * stretch[1]
    r = np.sqrt(fx * fx + fy * fy)
    filt = 1.0 / np.maximum(r, 1.0 / size) ** beta
    if cutoff is not None:
        filt *= np.exp(-((r / cutoff) ** 2))
    filt[0, 0] = 0.0
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def _rgb(base, field, amount):
    """기본색에 field(0..1, 평균 0.5 근처)만큼 밝기 변화를 준다."""
    base = np.asarray(base, dtype=np.float64)[None, None, :]
    shade = 1.0 + (field[..., None] - 0.5) * 2.0 * amount
    return np.clip(base * shade, 0.0, 1.0)


def _coords(size):
    """질감 한 장(2m)의 화소 한가운데 좌표(m). X = 열(u), Y = 행(v, 행 0 = v 0 = 아래)."""
    t = (np.arange(size) + 0.5) / size * TILE_M
    return np.meshgrid(t, t)


def _smooth(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _mix(a, b, t):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1.0 - t) + b * t


def _blocks(size, course_m, length_m, seed, bond=0.5):
    """덩이 쌓기(줄마다 반 덩이씩 엇갈림). 줄눈까지 거리(m)·덩이마다 −1..1 값을 돌려준다. 2m 주기."""
    X, Y = _coords(size)
    rows = int(round(TILE_M / course_m))
    cols = int(round(TILE_M / length_m))
    row = np.floor(Y / course_m).astype(int)
    xs = np.mod(X + (row % 2) * length_m * bond, TILE_M)
    col = np.floor(xs / length_m).astype(int)
    fy = Y - row * course_m
    fx = xs - col * length_m
    d = np.minimum(np.minimum(fx, length_m - fx), np.minimum(fy, course_m - fy))
    tone = np.random.default_rng(seed).uniform(-1.0, 1.0, (rows, cols))
    return d, tone[row % rows, col % cols]


# ── 실내(차분하고 현실적인 미술관, 2026-11-11 밤 사용자 의견) ───────────────────
# "게임 같은" 인상은 ① 고른 원색 면 ② 규칙적인 줄무늬 결 ③ 큰 대비에서 온다. 그래서
# - 회반죽은 미세한 요철(높이장을 위에서 비춘 그늘 — 법선 지도 없이 기본색에)과 흙손 자국, 아주 낮은 색 흔들림.
# - 참나무는 판자마다 다른 색·결 간격, 굽이치는 나이테(이른·늦은 재), 결 따라 짧은 물관 구멍, 은결 — 대비는 낮게.
# - 대리석은 규칙 사인 줄무늬 대신 능선 잡음(ridged fbm)으로 끊기고 갈라지는 결, 판마다 다른 밝기, 대비 낮게.
# 평균 밝기는 이전과 비슷하게 둔다(build.py BAKE_GRAY가 이 평균과 맞음).


def _relief(height, amount, light=(0.35, 1.0)):
    """높이장(0..1, 주기)을 위(+v, 행 증가)·조금 옆에서 비춘 그늘 배율(평균 1). 질감 한 장 주기를 지킨다(np.roll)."""
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    lx, ly = light
    n = math.hypot(lx, ly)
    s = (gx * lx + gy * ly) / n
    s = s / max(float(np.std(s)), 1e-9)
    return 1.0 + amount * np.tanh(s * 0.8)


def _ridged(size, seed, beta=1.9, octaves=3, stretch=(1.0, 1.0), angle=0.0):
    """능선 잡음: 1 − |2n − 1|을 여러 겹 — 0..1, 1 가까이가 가늘게 이어지는 능선(대리석 결)."""
    acc = np.zeros((size, size))
    wsum = 0.0
    for k in range(octaves):
        n = periodic_noise(size, seed + 17 * k, beta=beta - 0.15 * k, stretch=stretch, angle=angle)
        r = 1.0 - np.abs(2.0 * n - 1.0)
        w = 0.55**k
        acc += w * r
        wsum += w
    return acc / wsum


def plaster(size, seed=11):
    """따뜻한 흰 회반죽(매트 석회 마감): 흙손 자국(비스듬히 늘어진 낮은 요철) + 고운 모래알 + 아주 옅은 얼룩.
    요철은 위에서 비춘 그늘로만 보인다(±2~3%) — 가까이서는 손으로 바른 면, 멀리서는 고른 흰 벽."""
    trowel_a = periodic_noise(size, seed + 3, beta=2.2, stretch=(1.0, 3.2), angle=0.55)
    trowel_b = periodic_noise(size, seed + 4, beta=2.2, stretch=(1.0, 3.2), angle=-0.75)
    patch = _smooth(0.42, 0.58, periodic_noise(size, seed + 5, beta=2.6))
    trowel = trowel_a * patch + trowel_b * (1.0 - patch)
    grain = periodic_noise(size, seed + 1, beta=0.6)
    height = 0.75 * trowel + 0.25 * grain
    shade = _relief(height, 0.022)
    low = periodic_noise(size, seed, beta=2.4)
    mid = periodic_noise(size, seed + 2, beta=1.5)
    rgb = _rgb((0.918, 0.900, 0.858), 0.7 * low + 0.3 * mid, 0.012)
    # 아주 옅은 따뜻함·차가움 흔들림(같은 흰색이 칠한 판처럼 보이지 않게)
    hue = periodic_noise(size, seed + 6, beta=2.8) - 0.5
    rgb = rgb * (1.0 + np.stack([0.010 * hue, 0.0 * hue, -0.012 * hue], axis=-1))
    sand = np.clip((periodic_noise(size, seed + 7, beta=0.1) - 0.5) * 2.0, -1.0, 1.0)
    rgb = rgb * shade[..., None] * (1.0 + 0.010 * sand[..., None])
    return np.clip(rgb, 0.0, 1.0)


def _boards(size, seed, n, along):
    """판자 나눔(결과 수직 방향): 판자 번호·판자 안 위치(0..1)·판자마다 값(−1..1). 폭은 들쭉날쭉, 2m 주기."""
    rng = np.random.default_rng(seed)
    w = rng.uniform(0.75, 1.3, n)
    edges = np.concatenate([[0.0], np.cumsum(w / w.sum())])
    t = (np.arange(size) + 0.5) / size
    idx = np.clip(np.searchsorted(edges, t, side='right') - 1, 0, n - 1)
    local = (t - edges[idx]) / (edges[idx + 1] - edges[idx])
    tone = rng.uniform(-1.0, 1.0, n)
    hue = rng.uniform(-1.0, 1.0, n)
    freq = rng.uniform(0.75, 1.3, n)
    phase = rng.uniform(0.0, 1.0, n)
    if along == 'v':  # 결이 세로 → 판자는 가로로 나뉨(열)
        shape = lambda a: np.broadcast_to(a[None, :], (size, size))  # noqa: E731
    else:
        shape = lambda a: np.broadcast_to(a[:, None], (size, size))  # noqa: E731
    return shape(idx), shape(local), shape(tone[idx]), shape(hue[idx]), shape(freq[idx]), shape(phase[idx])


def oak(size, seed=21, base=(0.74, 0.58, 0.40), contrast=0.10, along='v', boards=9):
    """밝은 참나무(쪽매 판): 판자마다 다른 색·결 간격 + 굽이치는 나이테(늦은 재가 좁고 짙음) + 결 따라 짧은 물관 구멍
    + 연한 은결(참나무 특유의 빛나는 얼룩). 대비 낮게.
    along = 결이 흐르는 방향('v' = 세로 — 판벽·이젤 다리, 'u' = 가로 — 몰딩처럼 긴 가로 부재).
    (periodic_noise의 stretch는 주파수에 곱하는 값이라, 한 방향으로 길게 늘이려면 그 방향에 큰 값을 준다.)"""
    long_ = (1.0, 16.0) if along == 'v' else (16.0, 1.0)
    soft = (1.0, 5.0) if along == 'v' else (5.0, 1.0)
    _idx, _local, tone, hue, freq, phase = _boards(size, seed + 9, boards, along)
    t = np.linspace(0.0, 1.0, size, endpoint=False)
    across = np.broadcast_to(t[None, :] if along == 'v' else t[:, None], (size, size))
    mid_ = (1.0, 3.0) if along == 'v' else (3.0, 1.0)
    warp = periodic_noise(size, seed + 1, beta=2.4, stretch=soft)
    warp2 = periodic_noise(size, seed + 4, beta=1.7, stretch=mid_)
    spacing = periodic_noise(size, seed + 6, beta=2.6, stretch=soft)
    # 나이테: 판자마다 간격(약 2.5~4cm)·위상이 다르고, 간격이 판자 안에서도 바뀌며 결이 굽이친다
    rings = across * 64.0 * freq * (0.8 + 0.4 * spacing) + phase * 7.0 + warp * 7.0 + warp2 * 1.6
    f = rings - np.floor(rings)
    late = _smooth(0.55, 0.78, f) * (1.0 - _smooth(0.84, 0.99, f))  # 늦은 재 띠(이른 재보다 짙음)
    amp = periodic_noise(size, seed + 3, beta=1.8, stretch=mid_)
    broken = _smooth(0.30, 0.70, periodic_noise(size, seed + 7, beta=1.6, stretch=long_))  # 결이 끊겼다 이어짐
    fine_rings = 0.5 + 0.5 * np.sin(2 * np.pi * (across * 260.0 * freq + warp * 20.0 + warp2 * 5.0))
    streak = periodic_noise(size, seed, beta=1.6, stretch=long_)
    pores = periodic_noise(size, seed + 5, beta=0.3, stretch=(1.0, 9.0) if along == 'v' else (9.0, 1.0))
    pores = np.clip((pores - 0.74) * 4.0, 0.0, 1.0)
    fleck_n = periodic_noise(size, seed + 2, beta=1.0, stretch=(3.0, 1.0) if along == 'v' else (1.0, 3.0))
    fleck = np.clip((fleck_n - 0.80) * 5.0, 0.0, 1.0)
    field = (
        0.5
        + 0.40 * (streak - 0.5)
        - 0.42 * late * (0.25 + 0.95 * amp) * (0.35 + 0.65 * broken)
        - 0.06 * fine_rings
        + 0.05 * tone
    )
    rgb = _rgb(base, field, contrast)
    # 판자마다 아주 옅은 색 차(꿀빛 ↔ 회갈)
    rgb = rgb * (1.0 + np.stack([0.012 * hue, 0.004 * hue, -0.014 * hue], axis=-1))
    rgb = rgb * (1.0 - 0.07 * pores[..., None]) * (1.0 + 0.035 * fleck[..., None])
    return np.clip(rgb, 0.0, 1.0)


def honey_oak(size, seed=31):
    """몰딩·걸레받이·의자 높이 몰딩: 판벽보다 조금 짙은 꿀빛 참나무, 결은 가로(몰딩을 따라)."""
    return oak(size, seed, base=(0.64, 0.47, 0.30), contrast=0.085, along='u', boards=5)


def ceiling(size, seed=41):
    """천장: 회반죽보다 고운 흰 면(요철 아주 작게)."""
    height = periodic_noise(size, seed + 1, beta=1.8)
    shade = _relief(height, 0.008)
    rgb = _rgb((0.945, 0.935, 0.905), periodic_noise(size, seed, beta=2.2), 0.010)
    return np.clip(rgb * shade[..., None], 0.0, 1.0)


def _vein_field(size, seed, slope, warp_amt, width, angle=0.0):
    """끊기고 갈라지는 대리석 결(0..1, 1 = 결 한가운데). 큰 휨(주기 잡음) 위 능선 잡음 + 결이 드나드는 가림."""
    X, Y = _coords(size)
    u = X / TILE_M
    v = Y / TILE_M
    warp = periodic_noise(size, seed, beta=2.3)
    warp2 = periodic_noise(size, seed + 1, beta=1.7)
    a, b = slope
    phase = a * u + b * v + warp_amt * (0.7 * warp + 0.3 * warp2)
    main = 1.0 - np.abs(np.sin(np.pi * phase))  # 1 = 줄 한가운데(굵은 결)
    ridge = 1.0 - np.abs(2.0 * periodic_noise(size, seed + 2, beta=1.9, angle=angle, stretch=(1.0, 1.8)) - 1.0)
    jitter = periodic_noise(size, seed + 4, beta=1.2)
    thick = _smooth(1.0 - width, 1.0, main + 0.08 * (jitter - 0.5))
    thin = _smooth(1.0 - 0.35 * width, 1.0, ridge)  # 가는 갈래 결
    fade = _smooth(0.30, 0.65, periodic_noise(size, seed + 3, beta=2.4))  # 결이 흐려졌다 짙어졌다
    halo = _smooth(1.0 - 3.0 * width, 1.0, main) * 0.35  # 굵은 결 둘레의 옅은 번짐
    return np.clip(np.maximum(thick, 0.5 * thin) + halo, 0.0, 1.0) * (0.3 + 0.7 * fade)


def marble(size, seed=51):
    """바닥: 연한 크림 대리석 1m 판(판마다 결 방향·밝기가 조금씩 다름) + 2mm 줄눈. 대비 낮게 — 결은 회베이지 안개처럼."""
    X, Y = _coords(size)
    cloud = periodic_noise(size, seed + 1, beta=1.5)
    cloud2 = periodic_noise(size, seed + 4, beta=2.6)
    tile_i = np.floor(X).astype(int) % 2 + 2 * (np.floor(Y).astype(int) % 2)
    vein_a = _vein_field(size, seed + 10, (2, 3), 2.6, 0.10, angle=0.4)
    vein_b = _vein_field(size, seed + 20, (3, -2), 2.4, 0.10, angle=-0.6)
    fine = _vein_field(size, seed + 30, (5, 1), 3.4, 0.05, angle=1.1)
    vein = np.where(tile_i % 3 == 0, vein_a, vein_b)
    tone = np.random.default_rng(seed + 7).uniform(-1.0, 1.0, 4)[tile_i]
    rgb = _rgb((0.872, 0.850, 0.802), 0.6 * cloud + 0.4 * cloud2, 0.035)
    rgb = rgb * (1.0 + 0.016 * tone[..., None])
    vein_col = np.array((0.70, 0.67, 0.62))
    rgb = _mix(rgb, vein_col, 0.30 * vein + 0.12 * fine)
    fx = np.mod(X, 1.0)
    fy = np.mod(Y, 1.0)
    d = np.minimum(np.minimum(fx, 1.0 - fx), np.minimum(fy, 1.0 - fy))
    grout = 1.0 - _smooth(0.0007, 0.0016, d)
    rgb = _mix(rgb, (0.70, 0.67, 0.62), grout * 0.7)
    return np.clip(rgb, 0.0, 1.0)


def white_marble(size, seed=57):
    """정문 둘레: 희고 회색 결이 흐르는 대리석(줄눈 없음). 결은 끊기고 갈라지며 옅다."""
    cloud = periodic_noise(size, seed + 1, beta=1.6)
    vein = _vein_field(size, seed + 10, (1, 2), 2.8, 0.09, angle=0.7)
    fine = _vein_field(size, seed + 20, (4, -3), 3.2, 0.05, angle=-0.4)
    rgb = _rgb((0.930, 0.924, 0.910), cloud, 0.025)
    rgb = _mix(rgb, (0.66, 0.66, 0.65), 0.30 * vein + 0.12 * fine)
    return np.clip(rgb, 0.0, 1.0)


# ── 외관(밝은 석회암·화강석·회양목·청동) ──────────────────────────────


def _limestone_field(size, seed):
    low = periodic_noise(size, seed, beta=2.4)
    mid = periodic_noise(size, seed + 1, beta=1.5)
    fine = periodic_noise(size, seed + 2, beta=0.35)
    pores = np.clip((periodic_noise(size, seed + 3, beta=0.2) - 0.86) * 8.0, 0.0, 1.0)
    return 0.5 * low + 0.3 * mid + 0.2 * fine, pores


def limestone(size, seed=61, base=(0.875, 0.840, 0.762)):
    """다듬은 석회암(기둥·엔타블러처·몰딩): 줄눈 없는 따뜻한 크림색, 고운 얼룩과 작은 구멍."""
    field, pores = _limestone_field(size, seed)
    rgb = _rgb(base, field, 0.05)
    return np.clip(rgb * (1.0 - 0.10 * pores[..., None]), 0.0, 1.0)


def ashlar(size, seed=71, base=(0.862, 0.826, 0.748)):
    """석재 벽(벽 면): 0.5m 줄 × 1m 덩이 엇갈려 쌓기, 덩이마다 조금 다른 밝기, 6mm 줄눈. 줄 0의 아래 줄눈 = v 0."""
    field, pores = _limestone_field(size, seed)
    d, tone = _blocks(size, 0.5, 1.0, seed + 9)
    rgb = _rgb(base, field, 0.045)
    rgb = rgb * (1.0 + 0.015 * tone[..., None])
    rgb = rgb * (1.0 - 0.09 * pores[..., None])
    edge = 1.0 - _smooth(0.003, 0.02, d)  # 덩이 모서리 닳음
    rgb = rgb * (1.0 - 0.05 * edge[..., None])
    joint = 1.0 - _smooth(0.0015, 0.0035, d)
    rgb = _mix(rgb, (0.70, 0.67, 0.61), joint * 0.85)
    return np.clip(rgb, 0.0, 1.0)


def granite(size, seed=81):
    """광장·현관 바닥 포장: 밝은 회베이지 화강석 1m × 0.5m 엇갈림, 반점(운모·석영), 8mm 줄눈."""
    d, tone = _blocks(size, 0.5, 1.0, seed + 5)
    low = periodic_noise(size, seed, beta=2.2)
    speck = periodic_noise(size, seed + 1, beta=0.05)
    speck2 = periodic_noise(size, seed + 2, beta=0.15)
    rgb = _rgb((0.735, 0.715, 0.672), low, 0.05)
    rgb = rgb * (1.0 + 0.016 * tone[..., None])
    dark = np.clip((speck - 0.80) * 6.0, 0.0, 1.0)
    light = np.clip((0.22 - speck2) * 6.0, 0.0, 1.0)
    rgb = _mix(rgb, (0.34, 0.33, 0.32), dark * 0.6)
    rgb = _mix(rgb, (0.90, 0.89, 0.86), light * 0.5)
    edge = 1.0 - _smooth(0.004, 0.018, d)
    rgb = rgb * (1.0 - 0.06 * edge[..., None])
    joint = 1.0 - _smooth(0.002, 0.0045, d)
    rgb = _mix(rgb, (0.42, 0.41, 0.39), joint * 0.9)
    return np.clip(rgb, 0.0, 1.0)


def _leaf_stamps(length_px, width_px, n_rot, tip=1.0):
    """잎 도장(회전 n_rot가지): (마스크, 밝기) 쌍. 끝이 뾰족한 타원 + 가운데 잎맥 + 한쪽이 밝은 기울기."""
    r = int(math.ceil(length_px / 2 + 2))
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1].astype(np.float64)
    out = []
    for k in range(n_rot):
        a = math.pi * k / n_rot
        ca, sa = math.cos(a), math.sin(a)
        u = (xx * ca + yy * sa) / (length_px / 2)
        v = (-xx * sa + yy * ca) / (width_px / 2)
        taper = 1.0 - 0.35 * tip * np.clip(u, 0, 1) ** 2
        rad = u * u + (v / np.maximum(taper, 0.2)) ** 2
        mask = np.clip((1.0 - rad) * 3.0, 0.0, 1.0)
        shade = 0.82 + 0.28 * np.clip(0.5 - 0.5 * v, 0, 1) - 0.12 * np.clip(np.abs(u), 0, 1)
        vein = np.exp(-((v * width_px / 2) ** 2) / 0.7) * (np.abs(u) < 0.9)
        shade = shade * (1.0 - 0.18 * vein)
        out.append((mask, shade))
    return out


def _splat(canvas, alpha, stamp, x, y, color, opacity=1.0, wrap=True):
    """도장 하나를 (x, y)에 찍는다(알파 합성). wrap이면 가장자리를 넘은 부분을 반대편에도(주기)."""
    mask, shade = stamp
    h, w = canvas.shape[:2]
    r = mask.shape[0] // 2
    offs = [(0, 0)]
    if wrap:
        offs = [(dx, dy) for dx in (-w, 0, w) for dy in (-h, 0, h)]
    for dx, dy in offs:
        cx, cy = int(x) + dx, int(y) + dy
        x0, x1 = cx - r, cx + r + 1
        y0, y1 = cy - r, cy + r + 1
        if x1 <= 0 or y1 <= 0 or x0 >= w or y0 >= h:
            continue
        sx0, sy0 = max(0, -x0), max(0, -y0)
        sx1 = mask.shape[1] - max(0, x1 - w)
        sy1 = mask.shape[0] - max(0, y1 - h)
        a = mask[sy0:sy1, sx0:sx1, None] * opacity
        c = shade[sy0:sy1, sx0:sx1, None] * np.asarray(color)[None, None, :]
        region = canvas[max(0, y0) : min(h, y1), max(0, x0) : min(w, x1)]
        region[...] = region * (1.0 - a) + c * a
        if alpha is not None:
            ar = alpha[max(0, y0) : min(h, y1), max(0, x0) : min(w, x1)]
            ar[...] = np.maximum(ar, a[..., 0])


def boxwood(size, seed=91):
    """회양목 산울타리·둥근 화분 나무: 1~2cm 잎이 빽빽하게 겹친 면(틈은 짙은 녹색). 2m 주기."""
    rng = np.random.default_rng(seed)
    depth = periodic_noise(size, seed, beta=1.6)
    canvas = _rgb((0.07, 0.12, 0.05), depth, 0.35).astype(np.float64)
    px_per_m = size / TILE_M
    stamps = _leaf_stamps(0.020 * px_per_m, 0.011 * px_per_m, 12)
    lit = periodic_noise(size, seed + 1, beta=2.0)
    n = int(1.15 * (size / (0.012 * px_per_m)) ** 2)
    xs = rng.uniform(0, size, n)
    ys = rng.uniform(0, size, n)
    ks = rng.integers(0, len(stamps), n)
    tones = rng.uniform(0.0, 1.0, n)
    dark = np.array((0.13, 0.22, 0.08))
    light = np.array((0.30, 0.42, 0.15))
    yellow = np.array((0.40, 0.47, 0.18))
    for i in range(n):
        t = tones[i]
        l = lit[int(ys[i]) % size, int(xs[i]) % size]
        c = dark + (light - dark) * min(1.0, t * 0.8 + l * 0.6)
        if t > 0.93:
            c = light + (yellow - light) * (t - 0.93) / 0.07
        _splat(canvas, None, stamps[ks[i]], xs[i], ys[i], c)
    return np.clip(canvas, 0.0, 1.0)


def bronze(size, seed=101):
    """청동 문짝: 짙은 조각용 청동 + 아주 옅은 녹청 얼룩."""
    low = periodic_noise(size, seed, beta=2.2)
    pat = np.clip((periodic_noise(size, seed + 1, beta=1.8) - 0.62) * 3.0, 0.0, 1.0)
    rgb = _rgb((0.36, 0.25, 0.15), low, 0.12)
    rgb = _mix(rgb, (0.27, 0.30, 0.23), pat * 0.35)
    return np.clip(rgb, 0.0, 1.0)


# ── 설비 ────────────────────────────────────────────────────────


def leather(size, seed=111):
    """벤치 가죽: 짙은 자주빛(옥스블러드) + 고운 오돌토돌한 결 + 아주 큰 얼룩."""
    low = periodic_noise(size, seed, beta=2.4)
    pebble = periodic_noise(size, seed + 1, beta=0.25)
    pebble = np.clip((pebble - 0.5) * 2.2 + 0.5, 0.0, 1.0)
    rgb = _rgb((0.37, 0.125, 0.105), 0.6 * low + 0.4 * pebble, 0.10)
    return np.clip(rgb, 0.0, 1.0)


def bark(size, seed=121):
    """플라타너스 껍질: 회갈색 바탕에 크림·연한 올리브 조각(손바닥만 한 벗겨진 껍질) + 세로로 긴 결."""
    a = periodic_noise(size, seed, beta=1.6, stretch=(1.0, 1.4), cutoff=0.06)
    b = periodic_noise(size, seed + 1, beta=1.5, stretch=(1.0, 1.4), cutoff=0.07)
    fine = periodic_noise(size, seed + 2, beta=0.8, stretch=(1.0, 6.0))
    base = np.array((0.50, 0.48, 0.42))
    rgb = np.broadcast_to(base, (size, size, 3)).copy()
    rgb = _mix(rgb, (0.72, 0.70, 0.61), _smooth(0.56, 0.60, a) * 0.75)
    rgb = _mix(rgb, (0.55, 0.55, 0.44), _smooth(0.58, 0.63, b) * 0.6)
    rgb = rgb * (0.9 + 0.2 * fine[..., None])
    return np.clip(rgb, 0.0, 1.0)


def leaf_atlas(size, seed=131):
    """나무 잎 카드(RGBA): 2×2칸에 잎 다발 네 가지. 칸마다 가지 + 둥근 잎이 둘레로 성기게 퍼진다.
    투명한 곳의 색도 잎 색으로 채워(색 번짐 막기) 밉맵에서 가장자리가 검게 되지 않는다."""
    rng = np.random.default_rng(seed)
    rgb = np.zeros((size, size, 3))
    alpha = np.zeros((size, size))
    cell = size // 2
    leaf_px = cell * 0.10
    stamps = _leaf_stamps(leaf_px, leaf_px * 0.74, 16, tip=0.6)
    twig = (0.30, 0.25, 0.17)
    greens = [np.array(c) for c in ((0.20, 0.33, 0.11), (0.29, 0.43, 0.14), (0.36, 0.50, 0.18), (0.25, 0.38, 0.13))]
    for ci in range(4):
        ox = (ci % 2) * cell
        oy = (ci // 2) * cell
        cx, cy = ox + cell / 2, oy + cell / 2
        sub = rgb[oy : oy + cell, ox : ox + cell]
        sub_a = alpha[oy : oy + cell, ox : ox + cell]
        # 가지: 한가운데 아래에서 위·옆으로 가는 선
        branches = []
        for b in range(7):
            ang = math.radians(rng.uniform(-80, 80) + 90)
            ln = cell * rng.uniform(0.40, 0.62)
            branches.append((ang, ln))
            for t in np.linspace(0, 1, 60):
                px = cell / 2 + math.cos(ang) * ln * t
                py = cell * 0.18 + math.sin(ang) * ln * t
                w = max(1, int(3 * (1 - t)))
                xi, yi = int(px), int(py)
                if 0 <= xi < cell and 0 <= yi < cell:
                    sub[max(0, yi - w) : yi + w, max(0, xi - w) : xi + w] = twig
                    sub_a[max(0, yi - w) : yi + w, max(0, xi - w) : xi + w] = 1.0
        n = 330
        for i in range(n):
            ang, ln = branches[rng.integers(0, len(branches))]
            t = rng.uniform(0.2, 1.0)
            px = cell / 2 + math.cos(ang) * ln * t + rng.normal(0, cell * 0.09)
            py = cell * 0.18 + math.sin(ang) * ln * t + rng.normal(0, cell * 0.09)
            r = math.hypot(px - cell / 2, py - cell / 2)
            if r > cell * 0.49 or px < leaf_px or py < leaf_px or px > cell - leaf_px or py > cell - leaf_px:
                continue
            g = greens[rng.integers(0, len(greens))] * rng.uniform(0.85, 1.12)
            _splat(sub, sub_a, stamps[rng.integers(0, len(stamps))], px, py, g, wrap=False)
        _ = (cx, cy)
    # 투명한 곳 색 채우기: 잎 색 평균으로 + 가까운 잎 색 번짐(몇 번 흐리게)
    mean = (rgb * alpha[..., None]).sum((0, 1)) / max(alpha.sum(), 1.0)
    fill = np.where(alpha[..., None] > 0.05, rgb, mean)
    for _i in range(6):
        blur = (np.roll(fill, 1, 0) + np.roll(fill, -1, 0) + np.roll(fill, 1, 1) + np.roll(fill, -1, 1)) / 4
        fill = np.where(alpha[..., None] > 0.05, rgb, blur)
    a = np.clip((alpha - 0.35) * 3.0, 0.0, 1.0)
    return np.concatenate([np.clip(fill, 0, 1), a[..., None]], axis=2)


# 조각 재질 칸 → 기본색 질감. 단색 칸(황동·유리·주철·안내판 면·그림자)은 질감 없이 값만(build.py).
MAKERS = {
    'M_Plaster': plaster,
    'M_Panel': oak,
    'M_Molding': honey_oak,
    'M_Ceiling': ceiling,
    'M_Floor': marble,
    'M_Marble': white_marble,
    'M_Stone': limestone,
    'M_Ashlar': ashlar,
    'M_Paving': granite,
    'M_Hedge': boxwood,
    'M_Bronze': bronze,
    'M_Oak': oak,
    'M_Leather': leather,
    'M_Bark': bark,
}
# 투명(알파) 질감
ALPHA_MAKERS = {'M_Leaf': leaf_atlas}
