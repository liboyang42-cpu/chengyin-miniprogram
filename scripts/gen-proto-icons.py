#!/usr/bin/env python3
"""从 HTML 原型里把 IC / DIC 两套图标抽出来,生成 style/proto-icons.wxss。

2026-09-10 用户裁决:漫游四模式不跟小程序 UI 规则走 —— 图标也用原型自己那套,
不用小程序的图标集(coolicons)。

path data 逐字搬,一笔不改;只做两件事:
  ① 原型写的是 currentColor —— background-image 里继承不了,所以把用色烤进每个类。
     同一枚图标出现在两种色位时,各给一个类,而不是留一个继承不到的 currentColor。
  ② 尺寸交给用它的地方,这里只画图形。

用法:python3 scripts/gen-proto-icons.py <原型 HTML 路径>
原型真源 = [外部原型链接已移除]
"""
import io, json, re, sys, urllib.parse, pathlib

WANT = [
    ('filter2',  'DIC.filter2',  '#8A93A0', '抽屉「查找附近好玩的」'),
    ('people2',  'DIC.people2',  '#8A93A0', '抽屉「附近正在走的人」/ 玩法说明第三行'),
    ('flagtask', 'DIC.flagtask', '#8A93A0', '抽屉「任务」'),
    ('medal',    'DIC.medal',    '#8A93A0', '抽屉「勋章」'),
    ('gift',     'DIC.gift',     '#8A93A0', '抽屉「奖励」'),
    ('track',    'DIC.track',    '#8A93A0', '抽屉「记录」/ 设置「后台持续定位」/ 玩法说明第一行'),
    ('stamp',    'DIC.stamp',    '#8A93A0', '抽屉「集邮册」/ 设置「清空本机缓存」/ 玩法说明第二行'),
    ('info',     'DIC.info',     '#8A93A0', '抽屉「玩法说明」/ 设置「位置权限」'),
    ('team',     'DIC.team',     '#8A93A0', '组局抽屉「附近的人」/ 游玩抽屉「队伍位置」'),
    ('ticket',   'DIC.ticket',   '#8A93A0', '自由探索抽屉「入场码」'),
    ('groupcode','DIC.groupcode','#8A93A0', '游玩抽屉「展示整团码」'),
    ('unlock',   'DIC.unlock',   '#8A93A0', '游玩抽屉「解锁下一章节」'),
    ('settle',   'DIC.settle',   '#8A93A0', '游玩抽屉「整团结算」'),
    ('journal',  'DIC.journal',  '#8A93A0', '自由探索抽屉「旅程手记」'),
    ('gear',     'DIC.gear',     '#8A93A0', '抽屉「设置」/ 设置「减少动态效果」'),
    ('bell',     'DIC.bell',     '#8A93A0', '设置「到点提醒」'),
    ('route',    'IC.route',     '#8A93A0', '自由探索卡包页「N 家商户」旁那枚地图钮'),
    ('more',     'IC.more',      '#1A1A1A', '三键左「更多」—— 白底圆钮上是深色'),
    ('cam',      'IC.cam',       '#1A1A1A', '三键右「拍照」'),
    ('play',     'IC.play',      '#FFFFFF', '三键中「继续」—— 绿底圆钮上是白色'),
    ('qr',       'IC.qr',        '#1A1A1A', '三键左「核销」—— 白底圆钮上是深色'),
    ('scan',     'IC.scan',      '#1A1A1A', '三键右「扫码」'),
    ('scan2',    'IC.scan',      '#8A93A0', '同一枚扫码,出现在抽屉行里是灰色'),
    ('pause',    'LIT.pause',    '#FFFFFF', '三键中「暂停」—— 橙底圆钮上是白色'),
    ('expand',   'LIT.expand',   '#7A8496', '读数卡右上那枚展开钮(原型 dcard 里的 EX)'),
]

# IC / DIC 之外的两枚:原型没把它们收进图标集,是写在用它的地方的字面量。
# 这里照样从 HTML 里抓,不手抄 —— 抓不到就报错,别默默少一枚。
LITERAL = {
    'LIT.pause':  r'(<svg\b[^`]*?rect x="7" y="5"[^`]*?</svg>)',
    'LIT.expand': r'const EX=`(<svg\b.*?</svg>)`',
}


def extract(html):
    out = {}
    for name in ('IC', 'DIC'):
        i = html.index('const %s={' % name)
        body = html[i:html.index('\n};', i)]
        for m in re.finditer(r"\n\s*([a-zA-Z0-9]+):`(<svg.*?</svg>)`", body, re.S):
            out['%s.%s' % (name, m.group(1))] = m.group(2)
    for key, pat in LITERAL.items():
        m = re.search(pat, html, re.S)
        if not m:
            raise SystemExit('原型里找不到 %s,正则该跟着原型改:%s' % (key, pat))
        out[key] = m.group(1)
    return out


def main(path):
    ico = extract(io.open(path, encoding='utf-8').read())
    lines = [
        '/* ══ 原型自带的图标集(IC / DIC)══════════════════════════════════════════════',
        ' * ⚠️ 本文件由 scripts/gen-proto-icons.py 从原型 HTML 生成,别手改;要改先改原型。',
        ' * 生成规则与理由见那个脚本的文件头。 */',
        '.pic{ display:block; background-repeat:no-repeat; background-position:center; background-size:100% 100%; }',
    ]
    for cls, src, color, note in WANT:
        svg = ico[src].replace('currentColor', color)
        if 'xmlns' not in svg:
            svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
        enc = urllib.parse.quote(svg, safe="/:=<>?\"' ").replace('"', "'").replace('#', '%23')
        lines.append('/* %s(原型 %s) */' % (note, src))
        lines.append('.pic--%s{ background-image:url("data:image/svg+xml,%s"); }' % (cls, enc))
    out = pathlib.Path(__file__).resolve().parent.parent / 'style' / 'proto-icons.wxss'
    io.open(out, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('写了 %d 枚 → %s' % (len(WANT), out))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
