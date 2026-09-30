#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""稿 ↔ 实现 的像素对照。给出「差多少」和「差在哪一段」,不是只给一个百分比。

    python3 scripts/figma-diff.py <稿.png> <实现截图.png> [-o 输出目录]

为什么不用 pixelmatch:那要装 pixelmatch + pngjs 两个 npm 包,而本机 PIL + numpy
现成(ci/render_template_covers.py 已经在用),判据一样、少两个依赖。

⚠️ 这个比值有一条**下限**,永远到不了 0:
  · 稿是设计画板,截图是模拟器,状态栏/导航栏不是同一套像素;
  · rpx 换算、字体 hinting、没有全局 border-box,这三样是系统性偏差;
  · 夹具喂的文案跟稿上的文案本来就不一样。
所以「比值」只在**同一对图的前后两次之间**有意义 —— 改一版、重截、看它降没降。
拿它跟别的页比、或者拿它当验收线,都是在读噪音。真正能指挥改动的是下面两项:
  · bands  —— 哪一段 y 差得最凶(缺一块 / 多一块 / 位置错)
  · shift  —— 整体上下错位多少像素(改一个 margin 就能归零的那种)
"""
import json
import os
import sys

import numpy as np
from PIL import Image

# 每通道差多少才算「不一样」。抗锯齿与字体 hinting 的噪音通常 < 40。
CHANNEL_TOLERANCE = 40
# 找整体错位时的搜索范围(像素,按截图分辨率)
SHIFT_RANGE = 80
BAND_COUNT = 16


def load_pair(baseline_path, shot_path):
    """把稿缩放到截图宽度。以截图为准而不是反过来 —— 截图是真实渲染,不该被重采样。"""
    base = Image.open(baseline_path).convert('RGB')
    shot = Image.open(shot_path).convert('RGB')
    if base.width != shot.width:
        scale = shot.width / base.width
        base = base.resize((shot.width, max(1, round(base.height * scale))), Image.LANCZOS)
    return np.asarray(base, dtype=np.int16), np.asarray(shot, dtype=np.int16)


def diff_mask(a, b, tolerance=CHANNEL_TOLERANCE):
    return np.abs(a - b).max(axis=2) > tolerance


def best_vertical_shift(a, b, span):
    """整体上下错位多少。差异率最低的那个位移就是答案。

    ⚠️ 只在「位移确实换来明显更低的差异率」时才报,否则是噪音里挑最小值 ——
    两张本来就不像的图,任意位移都差不多,报出来会把人往错方向带。
    """
    height = min(a.shape[0], b.shape[0])
    base_ratio = float(diff_mask(a[:height], b[:height]).mean())
    best = (0, base_ratio)
    for shift in range(-span, span + 1):
        if shift == 0:
            continue
        if shift > 0:      # 实现比稿靠下
            top_a, top_b = 0, shift
        else:
            top_a, top_b = -shift, 0
        rows = min(a.shape[0] - top_a, b.shape[0] - top_b)
        if rows < height * 0.6:
            continue
        ratio = float(diff_mask(a[top_a:top_a + rows], b[top_b:top_b + rows]).mean())
        if ratio < best[1]:
            best = (shift, ratio)
    if best[0] == 0 or best[1] > base_ratio - 0.02:
        return {'px': 0, 'ratio': base_ratio, 'meaningful': False}
    return {'px': best[0], 'ratio': best[1], 'meaningful': True}


def bands(mask, count=BAND_COUNT):
    height = mask.shape[0]
    edges = np.linspace(0, height, count + 1).astype(int)
    out = []
    for i in range(count):
        y0, y1 = int(edges[i]), int(edges[i + 1])
        if y1 <= y0:
            continue
        out.append({'y0': y0, 'y1': y1, 'ratio': round(float(mask[y0:y1].mean()), 4)})
    return out


def write_triptych(base, shot, mask, out_path):
    """稿 | 实现 | 红色叠加。三联横排,一眼看出是「位置错」还是「内容不一样」。"""
    height = mask.shape[0]
    overlay = shot[:height].copy()
    gray = overlay.mean(axis=2, keepdims=True).repeat(3, axis=2) * 0.45 + 120
    overlay = gray
    overlay[mask] = [230, 40, 60]
    gap = 12
    width = base.shape[1]
    canvas = np.full((height, width * 3 + gap * 2, 3), 24, dtype=np.uint8)
    canvas[:, :width] = base[:height].astype(np.uint8)
    canvas[:, width + gap:width * 2 + gap] = shot[:height].astype(np.uint8)
    canvas[:, width * 2 + gap * 2:] = overlay.astype(np.uint8)
    Image.fromarray(canvas).save(out_path)


def compare(baseline_path, shot_path, out_dir=None):
    base, shot = load_pair(baseline_path, shot_path)
    height = min(base.shape[0], shot.shape[0])
    mask = diff_mask(base[:height], shot[:height])
    result = {
        'baseline': os.path.basename(baseline_path),
        'shot': os.path.basename(shot_path),
        'width': int(base.shape[1]),
        'baselineHeight': int(base.shape[0]),
        'shotHeight': int(shot.shape[0]),
        'comparedHeight': int(height),
        'diffRatio': round(float(mask.mean()), 4),
        'shift': best_vertical_shift(base, shot, SHIFT_RANGE),
        'bands': bands(mask),
    }
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        stem = os.path.splitext(os.path.basename(shot_path))[0]
        out_path = os.path.join(out_dir, stem + '__diff.png')
        write_triptych(base, shot, mask, out_path)
        result['diffImage'] = out_path
    return result


def _demo():
    """自检:同一张图对自己必须 0,人为挪 20px 必须被 shift 抓到。

    ⚠️ 负控是这段的重点 —— 一个永远报「差不多」的比对器毫无价值。
    """
    import tempfile
    rng = np.random.default_rng(7)
    art = np.full((400, 200, 3), 250, dtype=np.uint8)
    art[80:140, 20:180] = rng.integers(0, 90, size=(60, 160, 3))
    art[200:260, 20:180] = rng.integers(0, 90, size=(60, 160, 3))
    with tempfile.TemporaryDirectory() as tmp:
        a = os.path.join(tmp, 'a.png')
        Image.fromarray(art).save(a)
        assert compare(a, a)['diffRatio'] == 0.0, '同一张图必须零差异'

        moved = np.full_like(art, 250)
        moved[20:, :, :] = art[:-20, :, :]
        b = os.path.join(tmp, 'b.png')
        Image.fromarray(moved).save(b)
        got = compare(a, b)
        assert got['diffRatio'] > 0.05, '整体挪了 20px,差异率不该还是 0'
        assert got['shift']['meaningful'] and got['shift']['px'] == 20, \
            '整体位移必须被认出来,而且方向要对:got %r' % (got['shift'],)

        # 负控:两张毫不相干的图不许报出「有意义的位移」
        noise = rng.integers(0, 255, size=art.shape, dtype=np.uint8)
        c = os.path.join(tmp, 'c.png')
        Image.fromarray(noise).save(c)
        assert not compare(a, c)['shift']['meaningful'], '不相干的两张图不许报位移'
    print('figma-diff self-check OK')


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('-')]
    if '--self-check' in sys.argv:
        _demo()
        raise SystemExit(0)
    if len(args) < 2:
        print(__doc__)
        raise SystemExit(2)
    out = None
    if '-o' in sys.argv:
        out = sys.argv[sys.argv.index('-o') + 1]
    print(json.dumps(compare(args[0], args[1], out), ensure_ascii=False, indent=2))
