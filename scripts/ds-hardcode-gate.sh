#!/usr/bin/env bash
# 城瘾 DS-13 防回潮门禁:拦「wxss 新增行」里的硬编码 hex 颜色 / 裸 font-size / 裸 border-radius,
# 以及「js 新增行」里颜色属性直接写死的色值(2026-09-02 补盲区:JS 注入的颜色原本一次没扫过),
# 保护已 token 化的内容页成果(色/字/圆角收编)。只看新增行,不动存量;秒级、只读。
#
# 两种模式:
#   默认        比对「暂存区」新增行(pre-commit 本地用)
#   --ci        比对「GitHub master 合并基线以来」的新增行(由 ci/xcx-check.sh 调用)
# 逃生口(装饰/游戏/刻意值合法):
#   1. 行尾加注释 /* ds-ok */  —— 该行豁免(标记为刻意的装饰/非精确值)
#   2. DS_ALLOW_HARDCODE=1 git commit ...  —— 整次提交整体绕过
#   3. git commit --no-verify              —— 跳过所有钩子
# 天然排除(本就该有硬编码值):token 定义 style/、装饰画布页 index/creator/badge-wall。
# Play/roam 是统一游玩系统的关键消费面,不得再豁免。
#   例外 style/common.wxss(W12,2026-07-17):它是「消费层」不是定义层——app.wxss import,
#   对全部 95 页生效,却不属于任何一批逐页迁移的白名单 ⇒ 结构上没有任何一张卡覆盖它,
#   于是攒到 67 处旧名 alias + 111 处硬编码。故本文件不随 style/ 免检,并额外拦 ② 旧名 alias。
#   pages/publish/**(2026-07-26 取消排除):它当初随「装饰画布页」被整域排除,但这个域里
#   只有 simple 是 AI 画布,fabu(4,043 行发布编辑器)/temp/activity/topicadd 都是普通内容页
#   —— 目录级排除把它们一起静默豁免 = 假绿:往 fabu/index.wxss 注入 color:#ff00aa 门禁照样 exit 0。
#   佐证:fabu/temp/simple 已攒下 49 处行级 /* ds-ok */ 标注,写的人以为门禁在看,其实一行没扫过。
#   现按「豁免落在行、不落在目录」收口:装饰/刻意值仍走行尾 /* ds-ok */,存量不受影响(只看新增行)。
#   负控固化在 scripts/ds-hardcode-gate-selftest.sh(一次性临时仓,不碰本仓索引)。
set -uo pipefail
[ "${DS_ALLOW_HARDCODE:-0}" = "1" ] && exit 0

# ★ 必须在仓库根跑:git diff --name-only 吐的是【仓库根相对路径】,而下面又拿它当 pathspec
#   回喂 git diff。若 cwd 是 chengyinhub-xcx,pathspec "chengyinhub-xcx/xxx.wxss" 相对 cwd
#   解析不到任何文件 ⇒ added 恒空 ⇒ 每个文件都 continue ⇒ 门禁恒 exit 0。
#   实测:在 chengyinhub-xcx 下暂存一处 color:#ABCDEF,门禁照样绿。
#   这是"绿得很廉价"的典型 —— 无论谁从哪里调用,先归位到仓库根。
cd "$(git rev-parse --show-toplevel)" || { echo "[ds-gate] ✗ 不在 git 仓库内,拒绝恒真放行"; exit 1; }

# W12:从 tokens.wxss ② 段动态取「有 ① 目标」的旧名 alias(值形如 var(--cy-新名))。
# 无 ① 目标者(--cy-bg-subtle / --cy-font-display / --cy-price 等字面值)不在此列 —— 它们
# 要等 batch5 语义合并,现在拦了没有出路。真源是 tokens.wxss,不在这里抄一份清单以免烂掉。
# 惰性求值:只有真碰 common.wxss 时才解析 —— 否则锚点一坏会连纯后端提交都卡死(钩子每次提交都跑本脚本)。
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TOKENS="$SCRIPT_DIR/../style/tokens.wxss"
alias_re() {
  [ -f "$TOKENS" ] || return 1
  awk '/② 旧名 alias 层 ——/{f=1;next} /③ 保留原名层 ——/{f=0} f' "$TOKENS" \
    | grep -oE '^[[:space:]]*--cy-[a-z0-9-]+:[[:space:]]*var\(' \
    | sed -E 's/^[[:space:]]*(--cy-[a-z0-9-]+):.*/\1/' | paste -sd'|' -
}

# ---------- 新增行:先剥注释再匹配 ----------
# 注释里写个 PR 号「#486」会被 '#[0-9a-fA-F]{3,8}' 当成三位十六进制色值报出来
# (批4 踩过,当时把写法改成「PR 486」绕开,脚本本体没动 —— 只要有人写回自然写法就复发)。
# 正解与死链门禁 wxml-handler-lint.js 的 maskWxmlComments 一致:注释内容抹成等长空格。
#
# ⚠️ 不能逐行剥:块注释会跨行,中间那些行本身既没有 /* 也没有 */,单看一行根本认不出它在注释里。
#    所以先在【完整新侧文件】上按字符扫出注释区间,再按新侧行号回查每条新增行。
# ⚠️ ds-ok 逃生口本身就写在注释里 ⇒ 必须先在【原始行】上判豁免,再拿【抹过的行】去匹配。
#    顺序反了,逃生口会连同注释一起被抹掉,变成"标了 ds-ok 也照样红"。
masked_added_lines() {
  local file="$1" newref
  case "$DIFF_ARGS" in
    --cached) newref=":$file" ;;
    *)        newref="HEAD:$file" ;;
  esac
  # shellcheck disable=SC2086 — DIFF_ARGS 为受控的 sha/选项
  awk '
    NR==FNR {                       # pass1:新侧文件 → 逐字符抹注释,保留行数与长度
      line=$0; out=""; i=1; n=length(line)
      while (i<=n) {
        if (!inc) {
          if (substr(line,i,2)=="/*") { inc=1; out=out"  "; i+=2 }
          else { out=out substr(line,i,1); i++ }
        } else {
          if (substr(line,i,2)=="*/") { inc=0; out=out"  "; i+=2 }
          else { out=out" "; i++ }
        }
      }
      masked[FNR]=out; next
    }
    /^\+\+\+/ { next }              # pass2:diff → 取新增行的新侧行号
    /^@@/ { if (match($0,/\+[0-9]+/)) ln=substr($0,RSTART+1,RLENGTH-1)+0; next }
    /^\+/ { raw=substr($0,2); if (index(raw,"ds-ok")==0) print masked[ln]; ln++; next }
    /^-/  { next }                  # 删除行不推进新侧行号
    { ln++ }
  ' <(git show "$newref" 2>/dev/null) <(git diff $DIFF_ARGS -U0 -- "$file" 2>/dev/null)
}

# 模式选择:默认查暂存区;--ci 查相对 GitHub master 合并基线的分支增量
DIFF_ARGS="--cached"
if [ "${1:-}" = "--ci" ]; then
  REMOTE=origin
  git remote get-url github >/dev/null 2>&1 && REMOTE=github
  git fetch -q --depth=200 "$REMOTE" master 2>/dev/null || true
  BASE=$(git merge-base "$REMOTE/master" HEAD 2>/dev/null || true)
  if [ -z "$BASE" ]; then
    echo "[ds-gate] ✗ CI 模式取不到 $REMOTE/master 基线,拒绝恒真放行"
    exit 1
  fi
  if [ "$BASE" = "$(git rev-parse HEAD)" ]; then
    exit 0   # master 本身的 push 构建:无分支增量
  fi
  DIFF_ARGS="$BASE HEAD"
fi

# shellcheck disable=SC2086 — DIFF_ARGS 为受控的 sha/选项,无空格注入
FILES=$(git diff $DIFF_ARGS --name-only --diff-filter=ACM -- '*.wxss' '*.js' 2>/dev/null)
[ -z "$FILES" ] && exit 0

FAIL=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *chengyinhub-xcx/*) : ;;   # 只管小程序
    *) continue ;;
  esac
  # ---------- .js:颜色注入盲区(2026-09-02)----------
  # 起因:门禁原本只扫 .wxss,于是 JS 字符串里注入的颜色它永远看不见 ——
  #   pages/publish/simple/index.js  marker 的 bgColor: '#0f172b'(墨蓝,7-31 已明令清掉)
  #   infomationdetail.js / scene-how-to-play-detail.js  rich-text 注入 <a style="color:#007AFF">(系统蓝)
  # 三处都在活代码里跑了几个月,ds-hardcode-gate 一次都没报过。
  # ⚠️ 这里【不】照搬 wxss 那套「见 hex 就红」:JS 里的 # 太多(选择器、锚点、注释、PR 号),
  #    照搬必然误报,而误报会逼人去躲关键词。只拦【颜色属性名紧跟色值】这一种形状:
  #    color/bgColor/backgroundColor/borderColor/background/border/shadow/outline/fill/stroke,
  #    且色值与属性名在【同一条语句】内([^;] 界定,能吃三元)。
  # 逃生口与 wxss 一致:行尾 /* ds-ok */(masked_added_lines 在抹注释【前】先判)。
  case "$f" in
    *.js)
      case "$f" in
        # 工具/测试/生成物不是运行时界面:审计脚本、夹具、契约测试里天然大量色值
        */scripts/*|*/tests/*|*/node_modules/*|*/miniprogram_npm/*) continue ;;
      esac
      # JS 的行注释 // 不在块注释掩码的覆盖里,单独抹掉,避免「注释里写了个颜色」误报。
      # ⚠️ 只抹【整行注释】。抹「行内 // 起到行尾」会被 URL 里的 // 骗到:
      #    `'<a href="https://x" style="color:#007AFF">'` 会从 https:// 处被截断 ⇒ 色值消失 ⇒ 恒绿。
      #    正是本次要修的那个形状,一加 href 盲区就复原。宁可放过行尾注释里的假色值(会误报,
      #    加 /* ds-ok */ 即可),也不能放过真色值(漏报 = 门禁形同虚设)。
      js_added=$(masked_added_lines "$f" | sed 's|^[[:space:]]*//.*$||')
      [ -z "$js_added" ] && continue
      # 同一条语句里「颜色属性名 … 色值」即算命中(用 [^;] 界定语句,别跨到下一条)。
      # 必须能吃三元:bgColor: on ? '#0f172b' : '#155dfc' —— 属性名与色值之间隔着 8 个字符,
      # 卡死「紧跟」会把最典型的那处漏掉(实证:publish/simple 的 marker 就是这个形状)。
      js_hex=$(printf '%s\n' "$js_added" \
        | grep -inE '(color|bgColor|backgroundColor|borderColor|background|border|shadow|outline|fill|stroke)[^;]{0,80}#[0-9a-fA-F]{3,8}\b' | head -3)
      if [ -n "$js_hex" ]; then
        echo "[ds-gate] ✗ $f 新增硬编码颜色(JS 注入的颜色同样受管):"
        printf '%s\n' "$js_hex" | sed 's/^/      色  /'
        FAIL=1
      fi
      continue
      ;;
  esac

  case "$f" in
    */style/common.wxss) : ;;   # W12:消费层公共地面,受管(须先于下面的 */style/* 匹配)
    */style/*|*/pages/index/*|*/creator/*|*/pages/badge-wall/*) continue ;;
  esac
  # 只取新增行,豁免带 ds-ok 的行,并把注释内容抹空(见上面 masked_added_lines)
  added=$(masked_added_lines "$f")
  [ -z "$added" ] && continue
  hex=$(printf '%s\n' "$added" | grep -inE '#[0-9a-fA-F]{3,8}\b' | head -3)
  fs=$(printf '%s\n' "$added" | grep -inE 'font-size:[[:space:]]*[1-9][0-9.]*(rpx|px)' | head -3)
  br=$(printf '%s\n' "$added" | grep -inE 'border-radius:[^;}]*[1-9][0-9]*rpx' | head -3)
  # T6(2026-07-14):rgba/rgb 字面值也拦——半透明叠加对应 token 已有(border-subtle/strong、white-*、state-*)
  rg=$(printf '%s\n' "$added" | grep -inE 'rgba?\([[:space:]]*[0-9]' | head -3)
  # W12:公共地面额外拦 ② 旧名 alias —— 它一处顶 95 页,放它回潮 = alias 层永远删不掉
  al=""
  case "$f" in
    */style/common.wxss)
      # W12:本文件只设「② 旧名 alias」这道闸,硬编码闸暂不接管 —— 不是偷懒,是它现在必然误报:
      # 存量 111 处硬编码与 alias 引用【共处同一行】(如 `font-size:32rpx; color:var(--cy-text-title)`),
      # 而本门禁是 diff-based,迁移 alias 必然重写这些行 ⇒ 存量硬编码被当成「新增」。
      # 「只看新增行不动存量」这条前提在存量与新增共用一行时不成立。
      # TODO(W12 第2项「硬编码→token」卡):那张卡把存量清零后,删掉下面这行 reset 即自动接管硬编码闸。
      hex=""; fs=""; br=""; rg=""
      ARE=$(alias_re)
      # fail-closed:锚点被改坏 / 文件挪走时必须红,不许静默放行(静默放行 = 比没有门禁更危险)
      if [ -z "$ARE" ]; then
        echo "[ds-gate] ✗ 取不到 tokens.wxss 的 ② alias 清单($TOKENS),无法校验 $f"
        echo "[ds-gate]   段锚点「② 旧名 alias 层 ——」/「③ 保留原名层 ——」是否被改动?修锚点或同步更新本脚本。"
        FAIL=1
      else
        al=$(printf '%s\n' "$added" | grep -inE "var\((${ARE})\)" | head -3)
      fi
      ;;
  esac
  if [ -n "$hex$fs$br$rg$al" ]; then
    echo "[ds-gate] ✗ $f 新增硬编码(内容页应走 var(--cy-*) token):"
    [ -n "$hex" ] && printf '%s\n' "$hex" | sed 's/^/      色  /'
    [ -n "$fs" ]  && printf '%s\n' "$fs"  | sed 's/^/      字  /'
    [ -n "$br" ]  && printf '%s\n' "$br"  | sed 's/^/      角  /'
    [ -n "$rg" ]  && printf '%s\n' "$rg"  | sed 's/^/      透  /'
    [ -n "$al" ]  && printf '%s\n' "$al"  | sed 's/^/      旧名/'
    FAIL=1
  fi
done <<< "$FILES"

if [ "$FAIL" = 1 ]; then
  echo "[ds-gate] 防回潮:内容页颜色→var(--cy-brand/info/danger/text-*/bg-*)、字号→var(--cy-font-*)、圆角→var(--cy-radius-*)。"
  echo "[ds-gate] ⚠ style/common.wxss 例外:它已收编到 ① 真值层,只读 var(--cy-color-*/--cy-type-*),"
  echo "[ds-gate]   别用上面那些 ② 旧名(--cy-text-*/--cy-bg-*/--cy-font-*),否则 alias 层删不掉。"
  echo "[ds-gate]   ⚠ 照 tokens.wxss 的 alias 定义映射,别按字面改名:--cy-text-body→--cy-color-text-secondary、"
  echo "[ds-gate]   --cy-text-secondary→--cy-color-text-tertiary(按字面改 = 静默改色)。"
  echo "[ds-gate] 刻意装饰值行尾加 /* ds-ok */;整体绕过 DS_ALLOW_HARDCODE=1 git commit / --no-verify。详见 chengyinhub-xcx/docs/DS改页自查清单.md"
  exit 1
fi
exit 0
