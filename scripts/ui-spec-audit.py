#!/usr/bin/env python3
"""城瘾小程序 UI 规范审核门禁 —— 总控用,可反复跑。
用法: python3 audit_gate.py <chengyinhub-xcx 路径>
退出码 0=全绿, 1=有违规"""
import re, sys, os, glob, json
from collections import defaultdict

root = sys.argv[1] if len(sys.argv) > 1 else '.'
os.chdir(root)

SPACE = {8,12,16,20,24,28,32,48,64,80,96}
LEGACY = {4,6,10,14,18,22,26,36,72}   # --cy-legacy-* 已 token 化,本门禁不管
FONT = {64,58,56,36,32,28,24,22,20}

TOKEN_FILES = ['style/tokens.wxss', 'style/merchant-light.wxss']
# text/border/ink 语义位置的自定义属性声明,如 --cy-color-text-secondary: #334155;
TOKEN_PROP_RE = re.compile(
    r'--cy-[a-zA-Z0-9-]*(?:text|border|ink)[a-zA-Z0-9-]*:\s*#([0-9a-fA-F]{6})\b'
)

def br_delta(hex6):
    r = int(hex6[0:2], 16)
    b = int(hex6[4:6], 16)
    return b - r

# 只在浅底(白/灰底)主题块里查墨蓝 —— 默认暗色 page{}/.theme-dark 文字天然偏冷色,
# 不是本规则要治的"浅底文字读成藏青"问题。merchant-light.wxss 整个文件都是浅底镜像,不需要按块过滤。
LIGHT_SELECTOR_RE = re.compile(r'\.theme-(light|merchant|topic-editor)\b')

def scan_tokens(v):
    for f in TOKEN_FILES:
        if not os.path.exists(f):
            continue
        whole_file_is_light = (f != 'style/tokens.wxss')
        in_light_block = whole_file_is_light
        for ln, line in enumerate(open(f, encoding='utf-8').read().split('\n'), 1):
            st = line.strip()
            if not whole_file_is_light:
                if re.match(r'^[.\w][^{]*\{', st) or (st and not st.startswith('-') and st.endswith(',')):
                    in_light_block = bool(LIGHT_SELECTOR_RE.search(st))
                elif st == '}':
                    pass  # 块内容行不改变判定,下一个选择器行会重新判定
            if st.startswith('/*') or st.startswith('*') or 'ds-ok' in line:
                continue
            if not in_light_block:
                continue
            for m in TOKEN_PROP_RE.finditer(line):
                if br_delta(m.group(1)) > 8:
                    v['C2_墨蓝硬编码'].append(f'{f}:{ln} #{m.group(1)} B-R={br_delta(m.group(1)):+d}')

def scan():
    v = defaultdict(list)
    files = glob.glob('pages/**/*.wxss', recursive=True) + glob.glob('subpackage*/**/*.wxss', recursive=True)
    for f in files:
        for ln, line in enumerate(open(f, encoding='utf-8').read().split('\n'), 1):
            st = line.strip()
            if st.startswith('/*') or st.startswith('*') or 'ds-ok' in line:
                continue
            # ① 颜色:紫/墨蓝/蓝 硬编码(零容忍)
            if re.search(r'rgba?\(\s*122\s*,\s*92\s*,\s*255|#(7A5CFF|6A4AF0|1677FF)\b', line, re.I):
                v['C1_紫色硬编码'].append(f'{f}:{ln}')
            if re.search(r'#0f172b\b', line, re.I):
                v['C2_墨蓝硬编码'].append(f'{f}:{ln}')
            # ①b token 中介的紫色(提示项,不阻断):--cy-brand/--cy-color-brand 默认(玩家深色)
            # 主题下解析成品牌紫,C1 只抓硬编码十六进制/rgba 抓不到——门禁曾报"紫色 0"实际
            # 全仓 139 处经这层 token 间接留了紫,必须可见,不能一律判红(强调色是 DS 允许用法)。
            if re.search(r'var\(--cy-(color-)?brand\)', line):
                v['T1_品牌紫token中介'].append(f'{f}:{ln}')
            # ② 字号:字面值(legacy 除外)
            for m in re.finditer(r'font-size:\s*(\d+)rpx', line):
                n = int(m.group(1))
                if n < 20:
                    v['F1_字号小于micro(20)'].append(f'{f}:{ln} {n}rpx')
                elif n not in FONT:
                    v['F2_字号量表外'].append(f'{f}:{ln} {n}rpx')
                else:
                    v['F3_字号对但没走token'].append(f'{f}:{ln} {n}rpx')
            # ③ 间距:字面值
            for m in re.finditer(r'(margin|padding|gap)(-\w+)?:\s*([^;]+);', line):
                for num in re.findall(r'(\d+)rpx', m.group(3)):
                    n = int(num)
                    if n == 0 or n in LEGACY:
                        continue
                    if n not in SPACE:
                        v['S1_间距量表外'].append(f'{f}:{ln} {n}rpx')
                    else:
                        v['S2_间距对但没走token'].append(f'{f}:{ln} {n}rpx')
    scan_tokens(v)
    return v

v = scan()
BLOCK = ['C1_紫色硬编码', 'C2_墨蓝硬编码', 'F1_字号小于micro(20)']
WARN  = ['F2_字号量表外', 'S1_间距量表外']
INFO  = ['F3_字号对但没走token', 'S2_间距对但没走token', 'T1_品牌紫token中介']

fail = 0
print("=" * 56)
print("阻断项(必须清零)")
for k in BLOCK:
    n = len(v[k])
    print(f"  {'✅' if n==0 else '❌'} {k}: {n}")
    if n: fail = 1
    for x in v[k][:8]: print(f'       {x}')
print("\n警告项(判断后保留需加 /* ds-ok: 理由 */)")
for k in WARN:
    print(f"  {'✅' if len(v[k])==0 else '⚠️ '} {k}: {len(v[k])}")
print("\n提示项(值对但没走 token / 品牌紫经 token 中介,低优先级,不阻断)")
for k in INFO:
    print(f"     {k}: {len(v[k])}")
if v['T1_品牌紫token中介']:
    per_file = defaultdict(int)
    for x in v['T1_品牌紫token中介']:
        per_file[x.split(':')[0]] += 1
    top = sorted(per_file.items(), key=lambda kv: -kv[1])[:10]
    print("     T1 top 文件(品牌紫 token 用量,强调色是合法用法,不代表都要清):")
    for fn, n in top:
        print(f"       {n:>4}  {fn}")
print("=" * 56)
# ⚠️ 输出写到被扫描目录自己的 .audit 下,不要用 /tmp 共享路径 ——
# 多个 worktree 并行跑时 /tmp 同名文件会互相覆盖,读到别人那次的结果(批7、批4 都踩过)
_out = os.path.join(os.getcwd(), '.audit-result.json')
json.dump({k: v[k] for k in v}, open(_out, 'w'), ensure_ascii=False, indent=1)
print(f'明细: {_out}')
sys.exit(fail)
