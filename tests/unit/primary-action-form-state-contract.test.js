const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const count = (source, token) => source.split(token).length - 1

function assertDisabledReadsField(wxml, buttonText, field) {
  // 业务完成态仍只读 JS 派生字段；允许再叠加 submitting/saving
  // 这类纯 UI 在途闸，防止连点时发出第二个写请求。
  const button = wxml.match(new RegExp(`<cy-btn[^>]*\\sdisabled="\\{\\{!${field}(?:\\s*\\|\\|[^}]*)?\\}\\}"[^>]*>[^<]*${buttonText}[^<]*</cy-btn>`))
  assert.ok(button, `${buttonText} 必须只读 JS 派生字段 ${field} 控制禁用态`)
}

// 2026-09-16:银行卡表单退役 —— 独立提现页不再采集银行卡信息、不再有资金提交门闩,
// 只剩「联系客服提现」一个动作。旧契约(按钮只读 canSubmit)随表单一起作废,这里改成反向断言。
function assertTixianFormRetired(js, wxml) {
  assert.doesNotMatch(wxml, /canSubmit/, '表单退役后页面不得再有资金提交门闩')
  assert.doesNotMatch(js, /canSubmit/, '同上门闩字段必须随表单一起删除,不能留在 js 里')
  assert.doesNotMatch(wxml, /placeholder-class="tx-placeholder"|bindinput=/, '页面不得再采集姓名/银行账号/手机号')
  assert.match(wxml, /bindtap="saveData"/, '页面唯一的提现动作是联系客服(弹客服微信)')
}

test('独立提现页:银行卡表单已退役,只剩客服入口', () => {
  assertTixianFormRetired(read('subpackageMember/tixian/tixian.js'), read('subpackageMember/tixian/tixian.wxml'))
})

test('负控:银行卡表单加回独立提现页时必须判红', () => {
  const wxml = read('subpackageMember/tixian/tixian.wxml')
  const js = read('subpackageMember/tixian/tixian.js')
  const brokenWxml = wxml.replace('bindtap="saveData"', 'bindtap="saveData" disabled="{{!canSubmit}}"')
  assert.notEqual(brokenWxml, wxml, '负控锚点失效:独立提现页没有 saveData 接线')
  assert.throws(() => assertTixianFormRetired(js, brokenWxml), assert.AssertionError)
})

test('经典商家报名：提交报名只读 JS canSubmit', () => {
  const js = read('pages/topic/merchantapply/index.js')
  const wxml = read('pages/topic/merchantapply/index.wxml')
  assertDisabledReadsField(wxml, '提交报名', 'canSubmit')
  assert.match(js, /canSubmit:\s*false/)
  assert.match(js, /refreshSubmitState\s*\(\)/)
})

test('负控：经典商家报名恢复恒黑按钮必须判红', () => {
  const source = read('pages/topic/merchantapply/index.wxml')
  const broken = source.replace(
    /(<cy-btn\s+wx:else\s+variant="primary")\s+disabled="\{\{!canSubmit\}\}"/,
    '$1',
  )
  assert.notEqual(broken, source, '负控锚点失效：经典商家报名没有 canSubmit 接线')
  assert.throws(() => assertDisabledReadsField(broken, '提交报名', 'canSubmit'), /必须只读 JS 派生字段/)
})

test('商家入驻四步表单：下一步只读既有 JS canNext', () => {
  const js = read('pages/merchant/apply/index.js')
  const wxml = read('pages/merchant/apply/index.wxml')
  assert.match(wxml, /<cy-btn[^>]*variant="primary"[^>]*disabled="\{\{!canNext\}\}"[^>]*bindtap="onNext"/)
  assert.match(js, /canNext:\s*false/)
  assert.match(js, /validate\(\)[\s\S]*this\.setData\(\{ canNext: ok \}\)/)
})

test('负控：商家入驻摘掉 canNext 单源必须判红', () => {
  const source = read('pages/merchant/apply/index.wxml')
  const anchor = ' disabled="{{!canNext}}"'
  const broken = source.replace(anchor, '')
  assert.notEqual(broken, source, '负控锚点失效：商家入驻没有 canNext 接线')
  assert.doesNotMatch(broken, /disabled="\{\{!canNext\}\}"/)
})

test('发布活动三步表单：下一步/发布共读 JS canContinue', () => {
  const js = read('pages/publish/activity/index.js')
  const wxml = read('pages/publish/activity/index.wxml')
  assert.equal((wxml.match(/disabled="\{\{!canContinue\}\}"/g) || []).length, 2)
  assert.match(js, /canContinue:\s*false/)
  assert.match(js, /refreshPrimaryActionState\s*\(\)/)
})

test('负控：发布活动任一主按钮摘掉 canContinue 必须判红', () => {
  const source = read('pages/publish/activity/index.wxml')
  const broken = source.replace(' disabled="{{!canContinue}}"', '')
  assert.notEqual(broken, source, '负控锚点失效：发布活动没有 canContinue 接线')
  assert.notEqual((broken.match(/disabled="\{\{!canContinue\}\}"/g) || []).length, 2)
})

test('专业发布：发布主动作读取 JS 派生状态(平铺后只剩这一个主动作)', () => {
  const js = read('pages/publish/fabu/index.js')
  const wxml = read('pages/publish/fabu/index.wxml')
  // 2026-08-10 平铺:没有「下一步」了(也就没有 canAdvanceRoute),发布按钮从第三步底部
  // 提到常驻右上角。要守的语义没变 —— 主动作的可用态必须由 JS 派生,不许恒黑。
  // 2026-08-10 两页:发布回到第 2 页底部,文案改「检查并发布」。语义不变 —— 主动作可用态必须由 JS 派生
  // 2026-09-05 删掉「预览」后发布收回第 1 页底栏、文案改「发布」并带箭头。
  //   照上面那条同样的教训:只钉语义(同一个 cy-btn 上 disabled 绑 canPublish + bindtap 是 submitForm),
  //   不钉它长什么样,免得下次换文案/加图标又红一次。真正要防的是主动作恒黑或脱离派生态。
  const primary = wxml.match(/<cy-btn[^>]*bindtap="submitForm"[^>]*>[\s\S]*?<\/cy-btn>/)
  assert.ok(primary, '发布主动作必须存在')
  assert.match(primary[0], /disabled="\{\{!canPublish\}\}"/, '发布按钮的可用态必须来自 JS 派生的 canPublish')
  assert.match(primary[0], /loading="\{\{submitting\}\}"/, '提交中必须有 loading 态,不能重复点')
  assert.match(primary[0], /submitting \? '发布中\.\.\.' : '发布'/, '提交中文案必须切换')
  assert.doesNotMatch(wxml, /canAdvanceRoute/, '步骤已退役,不该再有下一步闸的残留接线')
  assert.match(js, /canPublish:\s*false/)
  assert.match(js, /refreshPrimaryActionState\s*\(\)/)
  assert.match(js, /setData\(patch, \(\) => that\.refreshPrimaryActionState\(\)\)/)
})

test('负控：专业发布恢复恒黑按钮必须判红', () => {
  const source = read('pages/publish/fabu/index.wxml')
  const broken = source.replace(' disabled="{{!canPublish}}"', '')
  assert.notEqual(broken, source, '负控锚点失效：专业发布没有 canPublish 接线')
  assert.doesNotMatch(broken, /disabled="\{\{!canPublish\}\}"/)
})

const PUBLISH_FORM_ROUTES = [
  ['pages/publish/activity/index.wxml', 'canContinue'],
  ['pages/publish/fabu/index.wxml', 'canPublish'],
  ['pages/publish/fabu/step3.wxml', 'canSaveTicket'],
  ['pages/publish/templateadd/templateadd.wxml', 'canSubmit'],
  ['pages/publish/temp/index.wxml', 'canOpenPreview'],
  ['pages/publish/temp/index.wxml', 'canPublishGame'],
  ['pages/publish/simple/index.wxml', 'canEnterAiEditor'],
]

test('发布链路路由清单：每个必填主操作都读取 JS 派生态', () => {
  PUBLISH_FORM_ROUTES.forEach(([file, field]) => {
    assert.match(read(file), new RegExp(`disabled="\\{\\{!${field}\\}\\}"`), `${file} 缺少 ${field} 接线`)
  })
  assert.match(read('pages/publish/temp/index.js'), /canPublishGame:\s*false/)
  assert.match(read('pages/publish/temp/index.js'), /canOpenPreview:\s*false/)
  assert.match(read('pages/publish/temp/index.js'), /refreshPreviewState\s*:\s*function\s*\(\)/)
  assert.match(read('pages/publish/temp/index.js'), /_collectValidationErrors\s*:\s*function\s*\(draft\)/)
  assert.match(read('pages/publish/simple/index.js'), /canEnterAiEditor:\s*false/)
  assert.match(read('pages/publish/simple/index.js'), /refreshEnterEditorState\s*\(\)/)
})

test('topicadd 已退役为重定向壳，不得残留表单或主操作状态', () => {
  const js = read('pages/publish/topicadd/topicadd.js')
  const wxml = read('pages/publish/topicadd/topicadd.wxml')
  assert.doesNotMatch(js, /canEnterPro|onInputChange|gotoPro|_validTitle/)
  assert.doesNotMatch(wxml, /<input\b|<cy-btn\b|bindtap=/)
  assert.match(js, /2026-10 之后删除本页并从 app\.json 摘除/)
  assert.match(js, /兼容用户手机上的历史页面栈/)
})

function assertTempOptionalFieldsRefresh(source) {
  assert.match(source, /onPhotoRequireDescChange[\s\S]*?_setFormState\(\{ 'formData\.photoRequireDesc': e\.detail\.value \}\)/)
  assert.equal(count(source, 'this._setFormState({ storyBeats: beats });'), 5)
  assert.equal(count(source, 'that._setFormState({ storyBeats: beats });'), 1)
}

test('玩法模板选填字段：拍照要求与剧情节点变化都进入预览状态刷新链', () => {
  assertTempOptionalFieldsRefresh(read('pages/publish/temp/index.js'))
})

test('负控：剧情节点任一写入绕过 _setFormState 时必须判红', () => {
  const source = read('pages/publish/temp/index.js')
  const broken = source.replace('this._setFormState({ storyBeats: beats });', 'this.setData({ storyBeats: beats });')
  assert.notEqual(broken, source, '负控锚点失效：storyBeats 尚未接入 _setFormState')
  assert.throws(() => assertTempOptionalFieldsRefresh(broken), assert.AssertionError)
})

test('负控：发布链路任一路由摘掉 disabled 接线必须判红', () => {
  PUBLISH_FORM_ROUTES.forEach(([file, field]) => {
    const source = read(file)
    const anchor = ` disabled="{{!${field}}}"`
    const before = count(source, anchor)
    const broken = source.replace(anchor, '')
    assert.ok(before > 0, `${file} 负控锚点失效`)
    assert.equal(count(broken, anchor), before - 1, `${file} 摘线后契约应变红`)
  })
})

test('商家据点：玩法配置是次级，店址确认与投放申请按步骤交接主操作', () => {
  // 店址确认只在未确认阶段出现；此时底部投放申请被 canSubmit 禁用。
  // 确认后前者消失，底部按钮才接过主操作，不是同时竞争。
  const js = read('pages/merchant/citynode/create/index.js')
  const wxml = read('pages/merchant/citynode/create/index.wxml')
  assert.match(wxml, /<cy-btn variant="secondary"[^>]*bind:tap="goConfigTemplate">去配置玩法<\/cy-btn>/)
  assert.match(wxml, /wx:if="\{\{!addressConfirmed\}\}"[\s\S]*<cy-btn[^>]*variant="primary"[^>]*bind:tap="confirmProfileAddress">确认这个店址<\/cy-btn>/)
  assert.match(wxml, /<cy-btn variant="primary"[^>]*disabled="\{\{!canSubmit && !submittedApplicationId\}\}"[^>]*bind:tap="submitNode">/)
  assert.equal((wxml.match(/variant="primary"/g) || []).length, 2)
  assert.match(js, /canSubmit:\s*false/)
})

test('负控：商家据点把始终可见的玩法配置升级为 primary 必须判红', () => {
  const source = read('pages/merchant/citynode/create/index.wxml')
  const broken = source.replace('variant="secondary" bind:tap="goConfigTemplate">去配置玩法', 'variant="primary" bind:tap="goConfigTemplate">去配置玩法')
  assert.notEqual(broken, source, '负控锚点失效：去配置玩法不是 secondary')
  assert.equal((broken.match(/variant="primary"/g) || []).length, 3)
})

test('玩法模板命名：确认按钮不在 WXML 计算 trim，只读 canSubmit', () => {
  const js = read('pages/publish/templateadd/templateadd.js')
  const wxml = read('pages/publish/templateadd/templateadd.wxml')
  assertDisabledReadsField(wxml, '确认', 'canSubmit')
  assert.match(js, /canSubmit:\s*false/)
  assert.doesNotMatch(wxml, /\.trim\(\)/)
})

const SIMPLE_FORM_ROUTES = [
  ['参与人信息', 'pages/addressinfo/addressinfo', '保存参与人信息'],
  ['投诉', 'subpackageMember/complaint/index', '提交投诉'],
  ['优惠券', 'subpackageMember/couponInfo/couponInfo', '发布优惠券'],
]

test('其余必填表单主按钮统一只读 canSubmit', () => {
  SIMPLE_FORM_ROUTES.forEach(([label, route, text]) => {
    const js = read(route + '.js')
    const wxml = read(route + '.wxml')
    assertDisabledReadsField(wxml, text, 'canSubmit')
    assert.match(js, /canSubmit:\s*false/, `${label} 必须声明 canSubmit 初值`)
  })
})

test('负控：任一简单表单摘掉 disabled 接线必须判红', () => {
  SIMPLE_FORM_ROUTES.forEach(([label, route, text]) => {
    const source = read(route + '.wxml')
    const broken = source.replace(/\sdisabled="\{\{!canSubmit(?:\s*\|\|[^}]*)?\}\}"/, '')
    assert.notEqual(broken, source, `${label} 负控锚点失效`)
    assert.throws(() => assertDisabledReadsField(broken, text, 'canSubmit'), /必须只读 JS 派生字段/)
  })
})

/* 2026-09-03 用户裁决:官方活动一律从 Web 后台上传,小程序不再提供「发起」入口。
   原来这条守的是那个发布面板的提交闸;面板整块删了,断言反过来钉住「不许复活」——
   否则下一个人照着旧代码把 FAB 加回来,这条契约会因为"找不到锚点"而恒绿。 */
test('官方活动的发起入口已下线,不许在小程序里复活', () => {
  const sheetJs = read('pages/activity/list/index.js')
  const sheetWxml = read('pages/activity/list/index.wxml')
  assert.doesNotMatch(sheetWxml, /发起官方活动/, '发起入口/面板不许回到小程序')
  assert.doesNotMatch(sheetWxml, /pubOnSubmit|pub\.canSubmit/)
  assert.doesNotMatch(sheetJs, /_pubRefreshState|pubOnSubmit/)
  // 「我发布的」不受影响:发布者仍要能看自己在后台发过什么
  assert.match(sheetWxml, /oe-manage-link/, '「我发布的」入口要留着')
})

test('商家权益与个人资料：必填名称只读 JS canSave，资料保存叠加 pending 闸', () => {
  const perksJs = read('pages/merchant/decor/perks/index.js')
  const perksWxml = read('pages/merchant/decor/perks/index.wxml')
  assertDisabledReadsField(perksWxml, '保存权益', 'canSave')
  assert.match(perksJs, /canSave:\s*false/)

  const profileJs = read('pages/gerenziliao/gerenziliao.js')
  const profileWxml = read('pages/gerenziliao/gerenziliao.wxml')
  assert.match(profileWxml, /<cy-btn[^>]*loading="\{\{saving\}\}"[^>]*disabled="\{\{!canSave \|\| saving\}\}"[^>]*bindtap="saveInfo"/)
  assert.match(profileJs, /canSave:\s*false/)
  assert.match(profileJs, /saving:\s*false/)
})

test('活动详情：取消、选票报名、评价分别读取独立 JS 派生态', () => {
  const js = read('components/cy/scene-play-activity-detail/index.js')
  const wxml = read('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(wxml, /disabled="\{\{!canCancel\}\}"[^>]*>确认取消并退款<\/cy-btn>/)
  assert.match(wxml, /disabled="\{\{!canConfirmSignup\}\}"[^>]*>立即报名<\/cy-btn>/)
  assert.match(wxml, /disabled="\{\{!canSubmitComment\}\}"[^>]*>发布评价<\/cy-btn>/)
  assert.match(js, /canCancel:\s*false/)
  assert.match(js, /canConfirmSignup:\s*false/)
  assert.match(js, /canSubmitComment:\s*false/)
})

test('主题评价与票种编辑：输入完成前禁用主按钮', () => {
  const topicJs = read('pages/topic/index/index.js')
  const topicWxml = read('pages/topic/index/index.wxml')
  const fabuJs = read('pages/publish/fabu/index.js')
  const ticketWxml = read('pages/publish/fabu/step3.wxml')
  assert.match(topicWxml, /disabled="\{\{!canSubmitComment\}\}"[^>]*>发布评价<\/cy-btn>/)
  assert.match(topicJs, /refreshCommentState\s*\(\)/)
  assert.match(ticketWxml, /disabled="\{\{!canSaveTicket\}\}"[^>]*>保存票种<\/cy-btn>/)
  assert.match(fabuJs, /refreshTicketSaveState\s*\(\)/)
})

test('账号注销：勾选确认且填写验证码后才开放危险主操作', () => {
  const js = read('utils/deregister-flow.js')
  const wxml = read('components/cy/scene-settings-deregister/index.wxml')
  assert.match(wxml, /disabled="\{\{!canApply\}\}"[^>]*>确认申请注销<\/cy-btn>/)
  assert.match(js, /canApply:\s*false/)
  assert.match(js, /refreshApplyState\s*\(\)[\s\S]*confirmed[\s\S]*smscode/)
})

test('活动结算：复杂支付条件收口到 JS canPay，WXML 不重复业务公式', () => {
  const js = read('pages/activity/baoming/baoming.js')
  const wxml = read('pages/activity/baoming/baoming.wxml')
  assert.match(wxml, /loading="\{\{isPaying \|\| paymentReadinessChecking\}\}"[^>]*disabled="\{\{!canPay\}\}"/)
  assert.match(js, /canPay:\s*false/)
  assert.match(js, /refreshPaymentState\s*\(\)[\s\S]*pageState === 'ready'[\s\S]*hostShareChecked/)
  assert.match(js, /refreshPaymentState\s*\(\)[\s\S]*!data\.isPaying/)
  assert.doesNotMatch(wxml, /disabled="\{\{pageState !== 'ready'/)
})

test('负控：canPay 摘掉 isPaying 在途闸时必须判红', () => {
  const source = read('pages/activity/baoming/baoming.js')
  const broken = source.replace(/\s*&& !data\.isPaying/, '')
  assert.notEqual(broken, source, '负控锚点失效：canPay 尚未包含 isPaying')
  assert.doesNotMatch(broken, /refreshPaymentState\s*\(\)[\s\S]*!data\.isPaying/)
})

test('复用优惠券表单与终价确认：主按钮只读 JS 状态', () => {
  const rewardJs = read('pages/publish/components/reward-selector/index.js')
  const rewardWxml = read('pages/publish/components/reward-selector/index.wxml')
  const pricingJs = read('pages/topic/pricing/index.js')
  const pricingWxml = read('pages/topic/pricing/index.wxml')
  assert.match(
    rewardWxml,
    /<cy-btn[^>]*disabled="\{\{!canCreateCoupon\}\}"[^>]*bindtap="onCreateSubmit"[^>]*>发布\{\{rewardKind === 'PASS' \? '体验卡' : '优惠券'\}\}<\/cy-btn>/,
    '优惠券 / 体验卡发布按钮必须只读 JS 派生字段 canCreateCoupon 控制禁用态',
  )
  assert.match(rewardJs, /canCreateCoupon:\s*false/)
  assertDisabledReadsField(pricingWxml, '确认终价并提交开售审核', 'canConfirmPrice')
  assert.match(pricingJs, /canConfirmPrice:\s*false/)
})

test('玩法预览答题：文本与选项提交共读 JS canSubmitPreview', () => {
  const js = read('pages/templatedetail/templatedetail.js')
  const wxml = read('pages/templatedetail/templatedetail.wxml')
  assert.equal((wxml.match(/disabled="\{\{!canSubmitPreview\}\}"/g) || []).length, 2)
  assert.match(js, /canSubmitPreview:\s*false/)
})

test('负控：玩法预览任一提交按钮摘线后数量契约必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  const anchor = ' disabled="{{!canSubmitPreview}}"'
  const broken = source.replace(anchor, '')
  assert.equal(count(source, anchor), 2)
  assert.equal(count(broken, anchor), 1)
})

test('负控：外围表单任一主按钮摘掉 JS 派生态必须判红', () => {
  const cases = [
    // 2026-09-03:官方发布面板已随入口一起删,这一行负控没有锚点了(留着会因锚点失效恒红)。
    ['pages/merchant/decor/perks/index.wxml', ' disabled="{{!canSave || saveReadbackPending}}"', /disabled="\{\{!canSave \|\| saveReadbackPending\}\}"/],
    ['components/cy/scene-play-activity-detail/index.wxml', ' disabled="{{!canConfirmSignup}}"', /disabled="\{\{!canConfirmSignup\}\}"/],
    ['pages/publish/fabu/step3.wxml', ' disabled="{{!canSaveTicket}}"', /disabled="\{\{!canSaveTicket\}\}"/],
  ]
  cases.forEach(([file, anchor, contract]) => {
    const source = read(file)
    const broken = source.replace(anchor, '')
    assert.notEqual(broken, source, `${file} 负控锚点失效`)
    assert.doesNotMatch(broken, contract)
  })
})
