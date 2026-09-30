#!/usr/bin/env bash
# ds-hardcode-gate 自证(2026-07-26):证明门禁「能判红,也能判绿」。
# 起因:pages/publish/** 曾被目录级排除,往 fabu/index.wxss 注入 color:#ff00aa 门禁照样 exit 0
# —— 绿是廉价的,只有能变红才是价值。本脚本把当时的手工负控固化成可无人值守跑的回归。
# 用法:bash chengyinhub-xcx/scripts/ds-hardcode-gate-selftest.sh   退出码 0=自证通过
# 全程在 mktemp 出来的一次性 git 仓里跑,不碰本仓工作区/索引。
set -uo pipefail

GATE=$(cd "$(dirname "$0")" && pwd)/ds-hardcode-gate.sh
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/chengyinhub-xcx/scripts" "$TMP/chengyinhub-xcx/style" "$TMP/chengyinhub-xcx/pages/publish/fabu"
cp "$GATE" "$TMP/chengyinhub-xcx/scripts/"
cp "$(dirname "$GATE")/../style/tokens.wxss" "$TMP/chengyinhub-xcx/style/"
cd "$TMP" || exit 1
git init -q . && git -c user.email=selftest@local -c user.name=selftest commit -q --allow-empty -m base

TARGET=chengyinhub-xcx/pages/publish/fabu/index.wxss
JS_TARGET=chengyinhub-xcx/pages/publish/fabu/index.js
FAIL=0
case_run() { # $1=用例名 $2=期望退出码 $3=文件内容
  printf '%s\n' "$3" > "$TARGET"
  git add "$TARGET"
  out=$(bash chengyinhub-xcx/scripts/ds-hardcode-gate.sh 2>&1); rc=$?
  if [ "$rc" != "$2" ]; then
    echo "[selftest] ✗ $1:期望 exit $2,实得 $rc"; printf '%s\n' "$out" | sed 's/^/      /'; FAIL=1; return
  fi
  # 该红的用例还要点名到具体文件,否则「红了但指不出哪」等于没有可操作信号
  if [ "$2" = 1 ] && ! printf '%s' "$out" | grep -F "$TARGET" >/dev/null; then
    echo "[selftest] ✗ $1:红了但没点名 $TARGET"; printf '%s\n' "$out" | sed 's/^/      /'; FAIL=1; return
  fi
  echo "[selftest] ✓ $1(exit $rc)"
}

case_run "注入硬编码色 → 必须红且点名"  1 '.x { color:#ff00aa; }'
case_run "改用 token → 必须绿"          0 '.x { background: var(--cy-comp-scrim-top); }'
case_run "行级 /* ds-ok */ 逃生口仍在"  0 '.x { color:#ff00aa; } /* ds-ok */'

# ---- 2026-08-01:注释误报(批4 踩过,当时靠把「#486」改写成「PR 486」绕开)----
# 门禁误报比漏报更坏:它会拿一个不存在的问题挡住别人的 PR,还逼着人改注释措辞去躲关键词。
case_run "注释里的 PR 号 #486 不是色值 → 必须绿" 0 '/* 见 PR #486 的回归修复 */
.x { color: var(--cy-text-title); }'
case_run "跨行块注释里的 #486 → 必须绿(逐行剥注释认不出中间行)" 0 '/* 说明第一行
   见 PR #486
   收尾 */
.x { color: var(--cy-text-title); }'
case_run "注释里提到旧名 token → 必须绿" 0 '/* 别再用 var(--cy-text-body) 了 */
.x { color: var(--cy-color-text-secondary); }'
# ↓ 别把误报修成漏报:代码里的真违规,不管周围有没有注释都得照样红
case_run "真违规 + 同行尾注释 → 仍必须红" 1 '.x { color:#ff00aa; } /* 见 PR #486 */'
case_run "注释在前、代码里真违规 → 仍必须红" 1 '/* PR #486 */
.x { color:#ff00aa; }'
case_run "跨行注释后跟真违规 → 仍必须红" 1 '/* 第一行
   PR #486
   收尾 */
.x { color:#ff00aa; }'

# ---- 2026-09-02:JS 注入色盲区(实证 3 处活代码跑了几个月没被扫过)----
# 这条闸窄:只认「颜色属性名紧跟色值」。太宽会在 JS 的 #(选择器/锚点/PR 号)上误报,
# 误报会逼人去躲关键词 —— 所以下面的「不该红」用例和「该红」的一样重要。
js_case_run() { # $1=用例名 $2=期望退出码 $3=文件内容
  printf '%s\n' "$3" > "$JS_TARGET"
  git add "$JS_TARGET"
  out=$(bash chengyinhub-xcx/scripts/ds-hardcode-gate.sh 2>&1); rc=$?
  if [ "$rc" != "$2" ]; then
    echo "[selftest] ✗ $1:期望 exit $2,实得 $rc"; printf '%s\n' "$out" | sed 's/^/      /'; FAIL=1; return
  fi
  if [ "$2" = 1 ] && ! printf '%s' "$out" | grep -F "$JS_TARGET" >/dev/null; then
    echo "[selftest] ✗ $1:红了但没点名 $JS_TARGET"; printf '%s\n' "$out" | sed 's/^/      /'; FAIL=1; return
  fi
  echo "[selftest] ✓ $1(exit $rc)"
}
# 先把上面 wxss 用例留下的最后一份内容换成合规的,免得它一直红着干扰 js 用例
printf '%s\n' '.x { color: var(--cy-text-title); }' > "$TARGET"; git add "$TARGET"

js_case_run "JS 里 marker bgColor 写死色值 → 必须红且点名" 1 "const m = { bgColor: '#0f172b' };"
js_case_run "JS 里富文本注入 style=\"color:#007AFF\" → 必须红" 1 'const h = s.replace(/<a/gi, String.fromCharCode(60) + "a style=" + String.fromCharCode(34) + "color:#007AFF;" + String.fromCharCode(34));'
js_case_run "改读 token 实值镜像并注明 → 仍红(值就是写死的)" 1 "const m = { bgColor: '#000000' };"
js_case_run "三元里的色值也要抓(属性名与色值隔着 8 个字符)" 1 "const m = { bgColor: on ? '#0f172b' : '#155dfc' };"
js_case_run "同一行里有 URL 也要照样抓(别被 https:// 里的 // 截断)" 1 'const h = "<a href=" + q + "https://chengyinhub.com" + q + " style=" + q + "color:#007AFF;" + q + ">";'
js_case_run "background / border 形状同样要抓" 1 'const s2 = "background:#0f172b;";'
js_case_run "整行注释里的色值 → 必须绿" 0 '// 历史:这里以前写死过 color:#0f172b
const c = theme.ink;'
js_case_run "行尾 /* ds-ok */ 逃生口在 js 上同样有效" 0 "const m = { bgColor: '#000000' }; /* ds-ok: 原生 marker 只吃字面量 */"
js_case_run "JS 里的 # 不是色值(选择器/PR 号/注释)→ 必须绿" 0 'const sel = "#app-root";
// 见 PR #486:这里以前写死过颜色
const cls = "#hash-anchor";'
js_case_run "颜色属性但读的是变量 → 必须绿" 0 "const m = { bgColor: theme.markerActiveBg };"

[ "$FAIL" = 0 ] && echo "[selftest] ✓ 门禁自证通过(能判红也能判绿;wxss + js 两侧)"
exit $FAIL
