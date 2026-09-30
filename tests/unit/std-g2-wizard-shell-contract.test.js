const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
  return match ? match[1] : ''
}

function sources() {
  return {
    onboardingWxml: read('pages/merchant/apply/index.wxml'),
    onboardingWxss: read('pages/merchant/apply/index.wxss'),
    onboardingJs: read('pages/merchant/apply/index.js'),
    signupSheetWxml: read('pages/topic/merchantapply/index.wxml'),
    signupSheetWxss: read('pages/topic/merchantapply/index.wxss'),
  }
}

function assertWizardShellContract(files) {
  // 2026-08-08:三页版报名 merchantapply1/2/3 退役后,仍在线的向导只剩两个 ——
  // 商家入驻(整页向导)与经典定向报名(cy-sheet 全屏向导)。壳规则按各自真实承载面断言:
  // 入驻页自带 .wizard-* 三件套与规则;报名弹窗的壳由 cy-sheet 提供,页面侧只有
  // wizard-card / wizard-actions 的用法与自己的 .ma-* 规则,没有 wizard-progress。
  assert.match(files.onboardingWxml, /class="[^"]*wizard-progress[^"]*"/, '商家入驻必须使用独立向导进度壳')
  assert.match(files.onboardingWxml, /class="[^"]*wizard-card[^"]*"/, '商家入驻必须使用白色向导卡')
  assert.match(files.onboardingWxml, /class="[^"]*wizard-actions[^"]*"/, '商家入驻必须使用 sticky 双动作壳')
  assert.match(files.signupSheetWxml, /class="[^"]*wizard-card[^"]*"/, '经典定向报名必须复用同一张白色向导卡')

  const card = rule(files.onboardingWxss, '.wizard-card')
  assert.match(card, /background:\s*var\(--cy-color-bg-surface\)/, '商家入驻卡片必须是主题白面')
  assert.match(card, /border-radius:\s*var\(--cy-radius-lg\)/, '商家入驻卡片必须使用统一大圆角')
  assert.doesNotMatch(card, /border(?:-top|-right|-bottom|-left)?:/, '商家入驻卡片不得描边')

  const actions = rule(files.onboardingWxss, '.wizard-actions')
  assert.match(actions, /position:\s*fixed/, '商家入驻长表单操作条必须 sticky')
  assert.match(actions, /background:\s*var\(--cy-color-bg-page\)/, '商家入驻操作条必须与页面浅灰底一致')

  assert.match(files.onboardingWxml, /class="bottom wizard-actions"[\s\S]*?variant="primary"[\s\S]*?style="width:100%"/,
    '商家入驻每个表单步骤必须是全宽单一主动作，返回由顶部独立返回键承担')
  assert.match(files.signupSheetWxml, /class="ma-footer[^\"]*wizard-actions"[\s\S]*?phase === 'form'[\s\S]*?variant="secondary"[\s\S]*?variant="primary"/,
    '单页报名弹窗的表单态必须是取消 + 单一提交动作')

  assert.doesNotMatch(files.onboardingWxml, /class="wizard-secondary"/, '顶部已有独立返回键时不得在底栏重复返回动作')

  assert.match(rule(files.onboardingWxss, '.fi'), /background:\s*var\(--cy-color-bg-surface-subtle\)/)
  assert.doesNotMatch(rule(files.onboardingWxss, '.frow'), /border-bottom:/, '入驻卡内不得用横线分层')
  assert.match(rule(files.signupSheetWxss, '.ma-row-cont'), /background:\s*var\(--cy-color-bg-surface-subtle\)/)
  assert.doesNotMatch(rule(files.signupSheetWxss, '.ma-row-cont'), /border:/, '单页报名输入块不得描边')

  assert.doesNotMatch(files.onboardingWxml, /\|\|\s*['"](?:-|无|未填写)['"]/, '空值统一显示长横线「—」')

  const targetSources = Object.values(files).join('\n')
  assert.doesNotMatch(targetSources, /#(?:181818|111111|1A1A1A|33363C)/i, '商家页近黑字面量不得回潮')
}

test('G2：入驻与报名向导共享白卡、灰块、进度与双动作视觉壳', () => {
  assertWizardShellContract(sources())
})

test('负控：卡片、灰填充、进度或双动作回退时契约必须判红', () => {
  const original = sources()
  const wrongRadius = {
    ...original,
    onboardingWxss: original.onboardingWxss.replace('border-radius: var(--cy-radius-lg);', 'border-radius: var(--cy-radius-md);'),
  }
  const wrongFill = {
    ...original,
    signupSheetWxss: original.signupSheetWxss.replace('background: var(--cy-color-bg-surface-subtle);', 'background: var(--cy-color-bg-page);'),
  }
  const wrongProgress = {
    ...original,
    onboardingWxml: original.onboardingWxml.replace('wizard-progress', 'legacy-progress'),
  }
  const wrongActions = {
    ...original,
    onboardingWxml: original.onboardingWxml.replace('style="width:100%"', 'style="width:70%"'),
  }
  assert.notEqual(wrongRadius.onboardingWxss, original.onboardingWxss, '负控锚点失效：入驻大圆角不存在')
  assert.notEqual(wrongFill.signupSheetWxss, original.signupSheetWxss, '负控锚点失效：单页报名灰填充不存在')
  assert.notEqual(wrongProgress.onboardingWxml, original.onboardingWxml, '负控锚点失效：入驻进度不存在')
  assert.notEqual(wrongActions.onboardingWxml, original.onboardingWxml, '负控锚点失效：入驻全宽主动作不存在')
  assert.throws(() => assertWizardShellContract(wrongRadius), /统一大圆角/)
  assert.throws(() => assertWizardShellContract(wrongFill))
  assert.throws(() => assertWizardShellContract(wrongProgress), /向导进度壳/)
  assert.throws(() => assertWizardShellContract(wrongActions), /全宽单一主动作/)
})
