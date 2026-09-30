#!/usr/bin/env bash
# D-10 入口治理静态核验:确认死入口已被 wx:if flag 隐藏、flag 默认 false、导航已实现。
# tabBar 页(member/index、role/center)无后端时 automator 会经 roleGuard 重定向读不到,
# 故这些用静态 grep 核验;逻辑改动(play navTo / 官方活动 CTA)见 verify_entry_roam.js。
# 复跑:  CY_XCX=<xcx> bash scripts/static_check_d10.sh   (默认取脚本上级目录)
set -u
XCX="${CY_XCX:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$XCX" || { echo "找不到 xcx: $XCX"; exit 2; }
fail=0
pass() { echo "  [PASS] $1"; }
bad()  { echo "  [FAIL] $1"; fail=1; }
has()  { grep -q "$2" "$3" && pass "$1" || bad "$1"; }
# 确认某元素(按 handler 定位)带某 wx:if
elem_has_if() { grep "$2" "$4" | grep -q "$3" && pass "$1" || bad "$1"; }

echo "== D-10 入口治理静态核验 (XCX=$XCX) =="

# 1) member/index 二维码入口隐藏
elem_has_if "member/index 二维码入口(onShowQr)带 wx:if featQrEntry" "onShowQr" 'wx:if="{{featQrEntry}}"' pages/member/index/index.wxml
has "member/index featQrEntry 默认 false" 'featQrEntry: false' pages/member/index/index.js

# 2) member/index 会员续费入口隐藏
elem_has_if "member/index 会员续费入口(pc-renew)带 wx:if featMemberPay" "pc-renew" 'wx:if="{{featMemberPay}}"' pages/member/index/index.wxml
has "member/index featMemberPay 默认 false" 'featMemberPay: false' pages/member/index/index.js

# 3) role/center 会员续费入口隐藏×2(ic-renew 卡 + ··· ic-more)
cnt=$(grep -c 'wx:if="{{featMemberPay}}"' pages/role/center/index.wxml)
[ "${cnt:-0}" -ge 2 ] && pass "role/center featMemberPay 隐藏 ≥2 处(实得 $cnt)" || bad "role/center featMemberPay 隐藏 ≥2 处(实得 ${cnt:-0})"
has "role/center featMemberPay 默认 false" 'featMemberPay: false' pages/role/center/index.js

# 4) play/index 导航已实现(非死 toast)
grep -A7 'navTo()' pages/play/index.js | grep -q 'wx.openLocation' && pass "play/index navTo 已实现为 wx.openLocation" || bad "play/index navTo 已实现为 wx.openLocation"
grep -q "navTo() { wx.showToast({ title: '导航功能即将开放'" pages/play/index.js && bad "play/index navTo 仍是死 toast" || pass "play/index navTo 不再是'即将开放'死 toast"

echo "== 结果:$([ $fail -eq 0 ] && echo 全部通过 || echo 有失败) =="
exit $fail
