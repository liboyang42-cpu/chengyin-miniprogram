#!/bin/bash
# ds-theme-sync-check.sh —— 日间主题单真源门禁(T1,2026-07-14)
# 校验三处日间/过渡键值一致,防 merchant-light 镜像与 tokens.wxss 真源漂移:
#   A. merchant-light.wxss page{} 里的每个 --cy-color-* 和 5 个字面旧 token,
#      必须与 tokens.wxss 日间块(.theme-light)完全一致(键集+值,双向)。
#   B. merchant-light.wxss 与 merchant-light-scope.wxss 的「商家过渡黑 CTA」段一致。
# 用法:bash scripts/ds-theme-sync-check.sh   (在 chengyinhub-xcx 目录下)
# 退出码:0=一致 1=漂移(打印差异)
# 注意:BSD(macOS) sed/grep 无 \s,一律用 [[:space:]];grep 匹配 --cy-* 必须加 -- 分隔。
set -u
cd "$(dirname "$0")/.." || exit 1

TOK="style/tokens.wxss"
ML="style/merchant-light.wxss"
MLS="style/merchant-light-scope.wxss"

# 抽取 <文件> 中 <起始正则> 到下一个 '}' 之间的 --cy-* 声明,归一化为 "键=值"(去注释/全部空白)
extract() { # $1=file $2=block-start-regex
  awk "/$2/,/^\}/" "$1" \
    | grep -oE '^[[:space:]]*--cy-[a-z0-9-]+:[[:space:]]*[^;]+' \
    | sed -E 's|/\*[^*]*\*/||g' \
    | sed -E 's/[[:space:]]+//g' \
    | sed 's/:/=/'
}

FAIL=0

# ---- A. 日间镜像 vs 真源 ----
day_src=$(extract "$TOK" '^page\.theme-light')
ml_all=$(extract "$ML" '^page \{')
locked_keys='^--cy-color-|^--cy-bg-subtle=|^--cy-white-4=|^--cy-white-64=|^--cy-price=|^--cy-shadow-card='
ml_locked=$(printf '%s\n' "$ml_all" | grep -E -- "$locked_keys")

while IFS= read -r kv; do
  [ -z "$kv" ] && continue
  key="${kv%%=*}"
  src_line=$(printf '%s\n' "$day_src" | grep -F -- "${key}=" | head -1)
  if [ -z "$src_line" ]; then
    echo "[theme-sync] ✗ $key 只在 merchant-light 有,真源 .theme-light 缺失"; FAIL=1
  elif [ "$src_line" != "$kv" ]; then
    echo "[theme-sync] ✗ $key 漂移:真源 '$src_line' ≠ 镜像 '$kv'"; FAIL=1
  fi
done <<EOF_A
$ml_locked
EOF_A

# 反向:真源里的 --cy-color-* 必须都被镜像(防商家页语义缺洞)
while IFS= read -r kv; do
  [ -z "$kv" ] && continue
  case "$kv" in --cy-color-*) ;; *) continue ;; esac
  key="${kv%%=*}"
  printf '%s\n' "$ml_locked" | grep -qF -- "${key}=" \
    || { echo "[theme-sync] ✗ 真源 $key 未镜像进 merchant-light(商家页语义缺洞)"; FAIL=1; }
done <<EOF_B
$day_src
EOF_B

# ---- B. 过渡段两处一致(黑 CTA) ----
trans_keys='^--cy-brand=|^--cy-brand-soft=|^--cy-accent=|^--cy-accent-strong=|^--cy-accent-soft=|^--cy-bg-accent-weak='
ml_trans=$(printf '%s\n' "$ml_all" | grep -E -- "$trans_keys" | sort)
mls_trans=$(extract "$MLS" '^\.theme-merchant' | grep -E -- "$trans_keys" | sort)
if [ "$ml_trans" != "$mls_trans" ]; then
  echo "[theme-sync] ✗ 商家过渡段两处不一致:"
  diff <(printf '%s\n' "$ml_trans") <(printf '%s\n' "$mls_trans") | sed 's/^/    /'
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  n_color=$(printf '%s\n' "$ml_locked" | grep -c -- '^--cy-color-')
  echo "[theme-sync] ✓ 日间主题单真源一致(镜像 $n_color 条语义 + 5 字面 + 过渡段×2)"
fi
exit $FAIL
