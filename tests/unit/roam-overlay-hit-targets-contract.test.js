'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML = path.join(ROOT, 'pages/roam/index.wxml')
const WXSS = path.join(ROOT, 'pages/roam/index.wxss')
const STATE_SHELL_WXML = path.join(ROOT, 'components/cy/state-shell/index.wxml')
const EMPTY_WXML = path.join(ROOT, 'components/cy/empty/index.wxml')
const EMPTY_WXSS = path.join(ROOT, 'components/cy/empty/index.wxss')

function rule(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies = []
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(',').map((item) => item.trim()).includes(selector)) bodies.push(match[2])
  }
  assert.ok(bodies.length, `缺少 ${selector}`)
  return bodies.join('\n')
}

function assertContract(overrides = {}) {
  const wxml = overrides.wxml === undefined ? fs.readFileSync(WXML, 'utf8') : overrides.wxml
  const wxss = overrides.wxss === undefined ? fs.readFileSync(WXSS, 'utf8') : overrides.wxss
  const stateShellWxml = fs.readFileSync(STATE_SHELL_WXML, 'utf8')
  const emptyWxml = fs.readFileSync(EMPTY_WXML, 'utf8')
  const emptyWxss = fs.readFileSync(EMPTY_WXSS, 'utf8')
  for (const selector of ['.event-overlay__close', '.zc-go', '.zc-close', '.pc-close', '.roam-prompt-close']) {
    const cssRule = rule(wxss, selector)
    assert.match(cssRule, /width:\s*var\(--cy-btn-h\)/, `${selector} 宽度不足 44px`)
    assert.match(cssRule, /height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
  }
  for (const selector of ['.event-task__btn', '.pc-action', '.pc-error-retry', '.cn-err-retry', '.settle__minor-act', '.dr-skip', '.woo__coupon']) {
    assert.match(rule(wxss, selector), /min-height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
  }
  assert.match(wxml, /<cy-state-shell[^>]*class="intro-permission"[^>]*primary="去设置"[^>]*bind:primary="openRoamLocationSetting"/s,
    '定位拒权态必须保留可达的去设置主动作')
  assert.match(stateShellWxml, /<cy-empty[^>]*cta="\{\{_primary\}\}"[^>]*bind:cta="onPrimary"/s,
    'state-shell 必须把主动作转交 cy-empty')
  assert.match(emptyWxml, /class="cy-empty-cta"[^>]*aria-role="button"[^>]*aria-label="\{\{cta\}\}"/s,
    'cy-empty 主动作必须保留按钮语义和可读名称')
  assert.match(rule(emptyWxss, '.cy-empty-cta'), /height:\s*var\(--cy-btn-h\)/,
    'cy-empty 主动作高度不足 44px')
  for (const label of [
    '关闭官方活动提示', '验证活动任务到达', '关闭附近商家提示',
    '关闭地点提示', '确认到达漫游点', '重试确认漫游点', '关闭足迹提示',
    '查看漫游数据', '返回广场', '跳过首次发现奖励', // 「取消分享」已随底部取消键退役(2026-09-19 裁决:退出口只留 ✕)
  ]) {
    assert.match(wxml, new RegExp(`aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `缺少可读名称：${label}`)
  }
  // 拍板 9-16:打卡钮不再有失败重试态,但「可打卡/还差多少米」两种态都必须读得出人话。
  assert.match(wxml, /'在' \+ item\.name \+ '打卡'/, '缺少可读名称：附近商家打卡钮')
  assert.match(wxml, /'还差 ' \+ \(item\.gapM \|\| 0\) \+ ' 米才能打卡，走近后再试'/,
    '距离不够的打卡钮必须读得出还差多少米')
}

test('漫游提示栈与结算次级动作均满足 44px 和可读语义', () => {
  assertContract()
})

test('负控：官方活动关闭退回 44rpx 会判红', () => {
  const wxss = fs.readFileSync(WXSS, 'utf8').replace(
    /(\.event-overlay__close\s*\{[^}]*?)width:\s*var\(--cy-btn-h\);\s*height:\s*var\(--cy-btn-h\);/s,
    '$1width:44rpx; height:44rpx;',
  )
  assert.throws(() => assertContract({ wxss }), /宽度不足/)
})

test('负控：打卡钮丢失可读名称会判红', () => {
  const wxml = fs.readFileSync(WXML, 'utf8').replace("'在' + item.name + '打卡'", "''")
  assert.throws(() => assertContract({ wxml }), /可读名称/)
})
