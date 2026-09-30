const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const renderable = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

const SOURCE = {
  profileJs: read('pages/merchant/profile/index.js'),
  profileWxml: read('pages/merchant/profile/index.wxml'),
  applyJs: read('pages/merchant/apply/index.js'),
  applyWxml: read('pages/merchant/apply/index.wxml'),
  decorWxss: read('pages/merchant/decor/index.wxss'),
}

function ruleBody(wxss, selector) {
  const start = wxss.indexOf(selector + ' {')
  assert.ok(start >= 0, `找不到 ${selector} 规则`)
  const end = wxss.indexOf('}', start)
  assert.ok(end > start, `${selector} 规则没有闭合`)
  return wxss.slice(start, end + 1)
}

function openingTagContaining(wxml, marker) {
  const source = renderable(wxml)
  const markerAt = source.indexOf(marker)
  assert.ok(markerAt >= 0, `找不到 ${marker}`)
  const start = source.lastIndexOf('<', markerAt)
  const end = source.indexOf('>', markerAt)
  assert.ok(start >= 0 && end > markerAt, `${marker} 所在开标签不完整`)
  return source.slice(start, end + 1)
}

function assertProgrammaticRequired(tag, fieldDescription) {
  assert.match(tag, /\baria-required="(?:true|\{\{true\}\})"/,
    `${fieldDescription} 没有 programmatic required`)
  assert.match(tag, /\baria-label="[^"]*必填[^"]*"/,
    `${fieldDescription} 的无障碍名称没有说明必填`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 2026-08-09 用户裁决:白卡内不再嵌灰。行与行只靠间距分组 —— 既不要横线,也不要填充。
const { NESTED_FILL } = require('../helpers/nested-fill.js')

function assertPlainRows(wxss, rowSelector, dividerSelector) {
  const row = ruleBody(wxss, rowSelector)
  assert.doesNotMatch(row, NESTED_FILL,
    `${rowSelector} 又在白卡里嵌了一层灰底`)
  assert.doesNotMatch(row, /border-(?:top|bottom)\s*:/,
    `${rowSelector} 用横线分层`)
  const divider = new RegExp(`${escapeRegExp(dividerSelector)}\\s*\\{[^}]*border-(?:top|bottom)\\s*:`)
  assert.doesNotMatch(wxss, divider, `${dividerSelector} 不应再用横线分层`)
}

function applyRequiredFieldsAreAccessible(applyWxml) {
  const requiredControls = [
    ['data-field="name"', '店铺名称输入框', '店铺名称'],
    ['data-field="phone"', '联系电话输入框', '联系电话'],
    ['bindtap="chooseLocation"', '店铺地址选择', '店铺地址'],
    ['bindtap="openHoursPicker"', '经营时间选择', '经营时间'],
    ['class="up-row"', '营业执照字段', '营业执照'],
    // RUN-52 第 4 步的经营者实名两格也是必填,和上面五条同等待遇 —— 少任一格的
    // 可见星号或 programmatic required 都要判红,不许「新字段自由发挥」。
    ['data-field="realName"', '真实姓名输入框', '真实姓名'],
    ['data-field="idCard"', '身份证号输入框', '身份证号'],
  ]
  requiredControls.forEach(([marker, description]) => {
    assertProgrammaticRequired(openingTagContaining(applyWxml, marker), description)
  })
  const upload = openingTagContaining(applyWxml, 'bindtap="uploadLicense"')
  assert.match(upload, /\baria-role="button"/, '营业执照上传框没有按钮角色')
  assert.match(upload, /\baria-label="[^"]*必填[^"]*"/, '营业执照上传框没有说明必填')

  // 2026-09-06 用户定:必填标记改成红星号,不再每个字段写「必填」两个字。
  // 但原判据要保的东西一条不能松 —— 必填不能只靠「颜色 + 符号」传达。
  // 新判据:允许星号,前提是页面上有一句解释星号含义的图例(标 * 的是必填),
  // 且每个字段仍有 programmatic required(上面已逐个断言)。
  const rendered = renderable(applyWxml)
  // 可见标记【按字段逐个认】,不再数总数:页面上多一颗星(2026-09-19 新加的实名两格
  // 就是)会把「少一颗」抵掉,数量判据照样绿 —— 那正是这条门禁要防的失败模式。
  const lostMarks = requiredControls
    .filter(([, , label]) => !new RegExp(`class="fl">${escapeRegExp(label)}<text class="req"`).test(rendered))
    .map(([, , label]) => label)
  assert.deepEqual(lostMarks, [], `这些必填字段丢了可见星号标记(图例那颗不算):${lostMarks.join('、')}`)
  const asteriskOnly = /class="req"[^>]*>\s*\*\s*<\/text>/.test(rendered)
  if (asteriskOnly) {
    assert.match(rendered, /标\s*<text class="req"[^>]*>\*<\/text>\s*的是必填/,
      '用星号表达必填时,页面必须有一句图例说明星号含义,否则必填只靠颜色+符号')
  }
}

function chineseCopyUsesFullWidthPunctuation(applyJs) {
  const codeOnly = applyJs.split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  const literals = Array.from(codeOnly.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g), (match) => match[2])
  const offenders = literals.filter((value) => /[\p{Script=Han}]/u.test(value) && /[,()]/.test(value))
  assert.deepEqual(offenders, [], `中文文案仍含半角逗号或括号：${offenders.join('；')}`)
}

// 2026-08-11 旧「承接商家」页收成兼容壳(设计文档 §3.2):
//   · 「发起合作」CTA 与它的安全区留白搬到统一主页的主动作位(阶段C 域,契约在那边补);
//   · 招牌主推与承接的官方活动按 §7 明确砍掉,不迁移;
//   · 白卡内行连同商家资料一起下线。
// 这三条不是"因为页面变壳了就删",是去处已经写死在设计文档里。这里改钉"旧壳不得回潮"。
test('旧「承接商家」页只剩过场态,不得回潮成第二套商家主页', () => {
  const wxml = renderable(SOURCE.profileWxml)
  assert.doesNotMatch(wxml, /pr-cta-bar|发起合作/, '兼容壳不得再放业务主动作')
  assert.doesNotMatch(wxml, /pr-official|pr-hero|pr-gallery|pr-chapters|pr-node-card/,
    '兼容壳不得再渲染商家资料、章节或据点任务卡')
  assert.doesNotMatch(SOURCE.profileJs, /chapter-application|goInvite|startInteract|public-detail/,
    '兼容壳不得保留承接/邀请/据点互动/旧商家资料接口的业务方法')
})

test('装修页：卡内共享行保持透明、触控行高和分组间距', () => {
  const css = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/design.wxss'), 'utf8')
  assert.match(css, /--cy-comp-cell-min-h:\s*104rpx/)
  assert.match(ruleBody(css, '.dc-content'), /gap:\s*38.5rpx/)
  const cell = fs.readFileSync(path.join(ROOT, 'components/cy/cell/index.wxss'), 'utf8')
  assert.doesNotMatch(ruleBody(cell, '.cell'), /background:/)
})

test('negative control:白卡内行重新长出灰底或横线必须判红', () => {
  assert.throws(() => assertPlainRows('.r { background: var(--cy-comp-cell-fill-bg); }', '.r', '.r + .r'), /嵌了一层灰底/)
  assert.throws(() => assertPlainRows('.r { border-bottom: 1rpx solid #eee; }', '.r', '.r + .r'), /用横线分层/)
})

test('商家入驻：每个必填字段同时有可见星号和 programmatic required', () => {
  applyRequiredFieldsAreAccessible(SOURCE.applyWxml)
})

test('商家入驻：中文文案不使用半角逗号或括号', () => {
  chineseCopyUsesFullWidthPunctuation(SOURCE.applyJs)
})

test('负控：撤掉任一道细节门禁都会判红', () => {
  assert.throws(() => assertPlainRows(
    SOURCE.decorWxss.replace(
      /(\.dc-row\s*\{)/,
      '$1 background: var(--cy-comp-cell-fill-bg);'
    ),
    '.dc-row',
    '.dc-row + .dc-row'
  ), assert.AssertionError, '把灰底加回卡内行后没有判红')

  assert.throws(() => applyRequiredFieldsAreAccessible(
    SOURCE.applyWxml.replace(/aria-required="true"/, '')
  ), assert.AssertionError, '删除一个 programmatic required 后无障碍契约没有判红')

  // 图例还在、但某个字段的可见标记没了 —— 旧写法这里是绿的
  assert.throws(() => applyRequiredFieldsAreAccessible(
    SOURCE.applyWxml.replace('<text class="fl">店铺名称<text class="req" aria-hidden="true">*</text></text>',
      '<text class="fl">店铺名称</text>')
  ), assert.AssertionError, '某个字段丢掉可见必填标记后没有判红')

  assert.throws(() => chineseCopyUsesFullWidthPunctuation(
    SOURCE.applyJs + "\nconst mutationCopy = '中文,文案'\n"
  ), assert.AssertionError, '注入半角逗号后中文标点契约没有判红')
})
