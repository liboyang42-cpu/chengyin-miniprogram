#!/usr/bin/env python3
# ds-build-icons.py —— 从 design/icons/coolicons/*.svg 生成 components/cy/icon/icons.wxss
# 方案:CSS mask + data URI(仓库先例:roam 底栏 .ab-ic--route),background-color: currentColor 随主题。
# 图标源:coolicons © Kryston Schwarze,CC BY 4.0(署名见 关于页/合规备忘)。
import glob, os, urllib.parse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # chengyinhub-xcx/
SRC = os.path.join(os.path.dirname(ROOT), 'design', 'icons', 'coolicons')   # 仓库根/design(不进小程序包)
DST = os.path.join(ROOT, 'components', 'cy', 'icon', 'icons.wxss')
rules, names = [], []
for f in sorted(glob.glob(f'{SRC}/*.svg')):
    sem = os.path.basename(f)[:-4]
    svg = open(f).read()
    uri = urllib.parse.quote(svg, safe="~()*!.'")
    # URI 只存一次进 CSS 变量,基类经 var() 双前缀引用 —— icons.wxss 体积减半
    rules.append(f'.cyi--{sem} {{ --cyi-m: url("data:image/svg+xml,{uri}"); }}')
    names.append(sem)
header = ('/* 自动生成,勿手改 —— python3 scripts/ds-build-icons.py\n'
          f' * 源:design/icons/coolicons/(coolicons © Kryston Schwarze, CC BY 4.0)\n'
          f' * 图标 {len(names)} 枚:{" ".join(names)} */\n')
open(DST, 'w').write(header + '\n'.join(rules) + '\n')
print(f'OK {len(names)} icons -> {DST} ({os.path.getsize(DST)} bytes)')
