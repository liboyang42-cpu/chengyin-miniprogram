const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

// 原生 button / aria-role=button 的主 CTA 不能靠 cy-btn 扫描兜底；逐个登记真实主动作。
// 圆形图标、地图控制、卡片行热区不在此表，它们是触达尺寸而非页面主按钮。
const NATIVE_PRIMARY_CTAS = [
  ['pages/publish/components/creation-success/index.wxss', '.cs__primary,.cs__secondary'],
  ['pages/activity/official-detail/index.wxss', '.od-cta'],
  ['components/cy/scene-member-order-detail/index.wxss', '.primary-cta'],
  // 2026-09-18 UI-16:.sec-btn 是次级动作(取消订单/查看票夹),按用户要求降到 --cy-btn-h-sm,
  // 不再是 88rpx 主 CTA;主 CTA 只剩 .primary-cta 一条。
  ['pages/gerenziliao/gerenziliao.wxss', 'button.fbox_but'],
  ['pages/addressinfo/addressinfo.wxss', 'button.fbox_but'],
  ['pages/address/address.wxss', 'button.fbox_but'],
  ['style/common.wxss', '.pop-vote .bm-btn button'],
  ['components/cy/scene-play-activity-detail/index.wxss', '.activity-share'],
  ['pages/topic/index/index.wxss', '.topic .bm-btn button'],
  ['pages/topic/index/index.wxss', '.topic .bm-btn2 button'],
  ['subpackageMember/mytemplate/mytemplate.wxss', '.project .fenxi .tx-btn button'],
  ['pages/activity/baoming/baoming.wxss', '.manage-btn, .confirm-btn'],
  ['style/merchant-light.wxss', '.ma3-btn-primary'],
  ['style/merchant-light.wxss', '.ma3-btn-secondary'],
  ['pages/topic/components/project-drawer/index.wxss', '.dw-btn'],
  ['pages/club/detail/index.wxss', '.error-primary, .error-secondary'],
  ['components/cy/empty/index.wxss', '.cy-empty-cta'],
  ['components/cy/error/index.wxss', '.cy-error-retry'],
  ['subpackageMember/components/scene-member-participation-detail/index.wxss', '.cyinfobottom_box_but'],
  ['components/cy/scene-qr-ticket/index.wxss', '.voucher__cta'],
]

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  return match ? match[1] : ''
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(absolute, files)
    else if (entry.name.endsWith('.wxml') || entry.name.endsWith('.wxss')) files.push(absolute)
  }
  return files
}

function auditPrimaryButtonHeights(overrides = {}) {
  const failures = []
  for (const absolute of walk(ROOT)) {
    const relative = path.relative(ROOT, absolute)
    const source = Object.prototype.hasOwnProperty.call(overrides, relative)
      ? overrides[relative]
      : fs.readFileSync(absolute, 'utf8')

    if (absolute.endsWith('.wxml')) {
      for (const match of source.matchAll(/<cy-btn\b[^>]*>/g)) {
        if (/ds-ok/.test(match[0])) continue
        if (/--cy-btn-h\s*:/.test(match[0])) failures.push(`${relative}: cy-btn 内联覆写 --cy-btn-h`)
      }
      continue
    }

    if (/^style\/(?:tokens|merchant-light|merchant-light-scope)\.wxss$/.test(relative)) continue
    source.split('\n').forEach((line, index) => {
      if (/--cy-btn-h\s*:/.test(line) && !/ds-ok/.test(line)) {
        failures.push(`${relative}:${index + 1}: 局部覆写 --cy-btn-h`)
      }
    })
  }

  for (const [relative, selector] of NATIVE_PRIMARY_CTAS) {
    const source = Object.prototype.hasOwnProperty.call(overrides, relative)
      ? overrides[relative]
      : fs.readFileSync(path.join(ROOT, relative), 'utf8')
    const body = ruleBody(source, selector)
    if (!body) {
      failures.push(`${relative}: 找不到已登记主动作 ${selector}`)
      continue
    }
    if (!/(?:min-)?height:\s*var\(--cy-btn-h\)/.test(body)) {
      failures.push(`${relative}: ${selector} 未消费 --cy-btn-h`)
    }
    if (/(?:min-)?height:\s*\d+rpx/.test(body) || /line-height:\s*\d+rpx/.test(body)) {
      failures.push(`${relative}: ${selector} 仍有字面按钮高度`)
    }
  }
  assert.deepEqual(failures, [], `主按钮必须统一走 --cy-btn-h 默认档：\n${failures.join('\n')}`)
}

test('D25：全站 cy-btn、底部动作条与登记的原生主 CTA 统一按钮高度', () => {
  const overrides = {}
  if (process.env.B3_NEGATIVE_CONTROL === 'button-height') {
    const file = 'subpackageMember/tixian/tixian.wxml'
    overrides[file] = fs.readFileSync(path.join(ROOT, file), 'utf8')
      .replace('<cy-btn variant="primary"', '<cy-btn variant="primary" style="--cy-btn-h:96rpx"')
  }
  auditPrimaryButtonHeights(overrides)
})

test('负控：任一页面把 cy-btn 改回自定义高度时审计必须判红', () => {
  const file = 'subpackageMember/tixian/tixian.wxml'
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const broken = source.replace('<cy-btn variant="primary"', '<cy-btn variant="primary" style="--cy-btn-h:96rpx"')
  assert.notEqual(broken, source, '负控锚点失效：提现主按钮不存在')
  assert.throws(() => auditPrimaryButtonHeights({ [file]: broken }), assert.AssertionError)
})

test('负控：原生主 CTA 恢复独立高度时审计必须判红', () => {
  const file = 'pages/publish/components/creation-success/index.wxss'
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const broken = source.replace(
    /(\.cs__primary,\.cs__secondary\s*\{[^}]*?)height:\s*var\(--cy-btn-h\);/s,
    '$1height: 96rpx;',
  )
  assert.notEqual(broken, source, '负控锚点失效：creation-success 主 CTA 不存在')
  assert.throws(() => auditPrimaryButtonHeights({ [file]: broken }), assert.AssertionError)
})
