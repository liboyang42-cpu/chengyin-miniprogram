/* 弹窗合同第 3 轮(2026-09-15)
 *   ① cy-state-shell 整页加载失败 → 零钮 fail 半屏 + 自动返回(只认加载失败类 kind,空态/无权限/加载中不算);
 *   ② 有失败半屏的首载请求不再叠自动 toast(只在面板真会出现时静音,刷新失败有旧内容仍 toast);
 *   ③ 纯告知单钮弹窗:能自动消失的改 toast,必须读到的保留;
 *   ④ 失败徽章红 = 稿色 #F94D5C,全部主题作用域重声明。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

function mountShell(props) {
  const file = path.join(ROOT, 'components/cy/state-shell/index.js')
  let def = null
  global.Component = (c) => { def = c }
  delete require.cache[require.resolve(file)]
  require(file)
  delete global.Component
  const data = Object.assign({}, def.data)
  for (const [k, spec] of Object.entries(def.properties)) data[k] = spec.value
  Object.assign(data, props)
  const inst = Object.assign({ data, events: [] }, def.methods, {
    setData(d) { Object.assign(this.data, d) },
    triggerEvent(name) { this.events.push(name) },
  })
  const key = Object.keys(def.observers)[0]
  def.observers[key].apply(inst, key.split(',').map((k) => inst.data[k.trim()]))
  return inst
}

test('① state-shell:加载失败类 kind 才进 auto-back,其它照旧(负控:不传 auto-back 不进)', () => {
  for (const kind of ['error', 'data', 'network', 'offline', 'missing-param']) {
    assert.equal(mountShell({ kind, autoBack: true }).data._autoBack, true, kind)
    assert.equal(mountShell({ kind }).data._autoBack, false, kind + ' 未开 auto-back')
  }
  for (const kind of ['empty', 'loading', 'no-permission', 'not-started']) {
    assert.equal(mountShell({ kind, autoBack: true }).data._autoBack, false, kind)
  }
  const wxml = strip(read('components/cy/state-shell/index.wxml'))
  assert.match(wxml, /<cy-error wx:if="\{\{_autoBack \|\| _renderer === 'error'\}\}" auto-back="\{\{_autoBack\}\}" custom-back="\{\{customBack\}\}"[^>]*title="\{\{_title\}\}"[^>]*sub="\{\{_sub\}\}"[^>]*bind:back="onBack"/)
  assert.match(wxml, /<cy-empty wx:else/, 'network / offline / missing-param 开 auto-back 时不能再落到 cy-empty 整页')
  const shell = mountShell({ kind: 'error', autoBack: true, customBack: true }); shell.onBack()
  assert.deepEqual(shell.events, ['back'])
})

const SHELL_PAGES = [
  ['subpackageMember/signup/index.wxml', /kind="error" title="票夹没能打开"[^>]*auto-back/],
  ['subpackageMember/coupon-qr/index.wxml', /kind="missing-param"[\s\S]*?auto-back[\s\S]*?custom-back[\s\S]*?bind:back="onClose"/],
  ['pages/club/apply/index.wxml', /title="主理人资格未确认"[^>]*auto-back custom-back bind:back="onExit"/],
  ['pages/club/create/index.wxml', /title="创建资格未确认"[\s\S]*?auto-back custom-back bind:back="onClose"/],
  ['pages/activity/official-detail/index.wxml', /kind="\{\{loadErrKind\}\}"[\s\S]*?auto-back custom-back bind:back="onLoadErrorBack"/],
  ['pages/addressinfo/addressinfo.wxml', /kind="\{\{bootstrapErrorKind\}\}"[\s\S]*?auto-back/],
  ['pages/team/join/index.wxml', /kind="\{\{errorKind\}\}"[\s\S]*?auto-back/],
  ['pages/team/detail/index.wxml', /kind="\{\{errorKind\}\}"[\s\S]*?auto-back/],
  ['pages/gerenziliao/gerenziliao.wxml', /kind="\{\{loadErrorKind\}\}"[\s\S]*?auto-back/],
  ['pages/play/circle/index.wxml', /kind="\{\{errorKind\}\}"[\s\S]*?auto-back custom-back bind:back="goBack"/],
  ['pages/merchant/apply/index.wxml', /kind="\{\{bootstrapErrorKind \|\| 'error'\}\}"[\s\S]*?auto-back="\{\{!everSettled\}\}"/],
  ['pages/merchant/apply/index.wxml', /title="页面状态暂时不可用"[\s\S]*?auto-back="\{\{!everSettled\}\}"/],
]

test('① 整页 state-shell 失败态全部接 auto-back', () => {
  for (const [file, re] of SHELL_PAGES) assert.match(strip(read(file)), re, file)
  // 页内局部区块不许接:ai-insight 事实缺失只是一块
  assert.doesNotMatch(read('pages/merchant/marketing/ai-insight/index.wxml'), /kind="data"[^/]*auto-back/)
})

test('② 失败半屏出现时首载请求不叠自动 toast', () => {
  const cases = [
    ['pages/activity/official-detail/index.js', /url: '\/api\/official\/events\/' \+ id, method: 'GET',\s*autoErrorToast: false,/],
    ['pages/activity/official-detail/index.js', /if \(this\.data\.e\) toast\('网络没连上'\);/],
    ['subpackageMember/signup/index.js', /hideLoading: true,\s*autoErrorToast: false,[^\n]*\n\s*url: '\/api\/registration\/list'[\s\S]*hideLoading: true,\s*autoErrorToast: false,[^\n]*\n\s*url: '\/api\/registration\/list'/],
    ['pages/addressinfo/addressinfo.js', /url: '\/api\/user\/address\/info',\s*autoErrorToast: false,/],
    ['pages/team/detail/index.js', /url: '\/api\/team\/info', method: 'POST', hideLoading: true, autoErrorToast: hasTeam,/],
    ['pages/team/join/index.js', /url: '\/api\/team\/info', method: 'POST', hideLoading: true, autoErrorToast: hasTeam,/],
    ['pages/gerenziliao/gerenziliao.js', /url: '\/api\/user\/info',\s*autoErrorToast: hadLoaded,/],
    ['pages/club/create/index.js', /url: '\/api\/club\/my', method: 'POST', hideLoading: true, autoErrorToast: false,/],
    ['pages/merchant/reviews/index.js', /hideLoading: requestOptions\.hideLoading, autoErrorToast: !!append,\s*url: `\/api\/merchant\/reviews\/manage/],
    ['pages/merchant/reviews/index.js', /hideLoading: requestOptions\.hideLoading, autoErrorToast: !!append,\s*url: `\/api\/merchant\/reviews\/public/],
    ['pages/merchant/decor/gallery/index.js', /hideLoading: true, autoErrorToast: hasOldContent, url: '\/api\/merchant\/coop-profile'/],
    // pages/merchant/decor/story 的断言随 2026-09-19 审查 #30 退役:该子页整页零入口(从未注册进 app.json),已删。
    ['pages/merchant/decor/coop-setting/index.js', /hideLoading: true, autoErrorToast: hasOldContent, url: '\/api\/merchant\/coop-profile'/],
    ['pages/merchant/decor/perks/index.js', /hideLoading: true, autoErrorToast: hasOldContent, url: '\/api\/coop\/perk-template\/list'/],
    ['subpackageP3/pages/stamp-album/index/index.js', /url: '\/api\/roam\/stamp\/list', method: 'POST', autoErrorToast: this\.data\.items\.length > 0,/],
    ['pages/merchant/apply/index.js', /url: '\/api\/merchant\/info',\s*method: 'POST',\s*hideLoading: true,\s*autoErrorToast: false,/],
    ['pages/merchant/profile/index.js', /hideLoading: true, autoErrorToast: false, url: '\/api\/merchant\/public-home'/],
  ]
  for (const [file, re] of cases) assert.match(read(file), re, file)
})

test('② search2:每路请求静音,只在「有结果但部分失败」(不出面板)时报一次', () => {
  const src = read('pages/search2/result/index.js')
  assert.match(src, /app\.sendRequest\(\{\s*hideLoading: true,\s*autoErrorToast: false,/)
  assert.match(src, /if \(failed > 0 && hasResults\) toast\('部分搜索没有完成，结果可能不全'\);/)
})

test('③ 纯告知单钮:可自动消失的改 toast,必须读到的保留', () => {
  const gone = [
    ['pages/club/apply/index.js', /modal\.show\(\{ title: '无法申请'/],
    ['pages/publish/fabu/index.js', /title: '权限加载中'/],
    ['pages/talent/list/index.js', /title: '无法创建'/],
    ['pages/merchant/citynode/index.js', /title: '核销成功'/],
    ['pages/publish/activity/index.js', /title: '暂未解锁'/],
    ['pages/merchant/decor/index.wxml', /show="\{\{showUpgradeTip\}\}"/],
    ['pages/merchant/decor/index.js', /showUpgradeTip/],
  ]
  for (const [file, re] of gone) assert.doesNotMatch(read(file), re, file)
  const kept = [
    ['pages/activity/baoming/baoming.js', /title: '支付结果待确认'/],
    ['pages/topic/index/index.js', /title: '支付结果待确认'/],
    ['pages/merchant/decor/index.js', /title: '支付结果待确认'/],
    ['components/cy/scene-member-order-history/index.js', /title: '支付结果待确认'/],
    ['pages/publish/fabu/index.js', /title: '这些改动存不下来'/],
    // 2026-09-17 定向广播接线:原「通知还发不出去」的纯告知弹窗已删除 ——
    // 真实流程改为 服务端预览→确认弹窗→真实发送→结果块,假告知不保留。
    // 确认弹窗仍走 cyModal('确认发送'),属于「必须读到」那一档,由
    // merchant-customer-broadcast-flow.test.js 锁住。
    ['pages/play/index.js', /title: '答案已揭示'/],
    ['pages/merchant/citynode/index.js', /title: '核销失败'/],
    // C-30:券被平台停用时后端回 couponGranted=false,成功 toast 不得再说「已发放」
    ['pages/merchant/citynode/index.js', /toast\(res\.data && res\.data\.couponGranted === false \? '核销成功，该券已失效或停发，未发放' : '核销成功，优惠券已发放给玩家'\);/],
    // 2026-09-15 审查C B1 反转:「活动已取消」原本判在 gone(改 toast),这条判错了 ——
    // 后端成功文案含已核销票时 66 字,过 utils/toast.js 的 safeUserMessage 会被兜底成
    // 「操作失败」,成功显示成失败,且「平台人工跟进退款」这句越要紧越会被吞。
    // 它属于「必须读到」那一档,退回单钮告知弹窗。判据见
    // tests/unit/activity-cancel-result-readable-contract.test.js。
    ['components/cy/scene-play-activity-detail/index.js', /noticeCancelled\(res\.msg\)/],
    ['components/cy/scene-play-activity-detail/index.js', /title: '活动已取消', content: message \|\|/],
  ]
  for (const [file, re] of kept) assert.match(read(file), re, file)
})

test('④ 失败徽章红读稿色 token,全部主题作用域重声明为 #F94D5C', () => {
  assert.match(strip(read('components/cy/result-sheet/index.wxss')), /\.rs--fail \.rs__scallop \{ color: var\(--cy-color-result-fail-badge\); \}/)
  const decl = (src) => (strip(src).match(/--cy-color-result-fail-badge:\s*#F94D5C;/g) || []).length
  assert.equal(decl(read('style/tokens.wxss')), 4)
  assert.equal(decl(read('style/merchant-light.wxss')), 2)
  assert.equal(decl(read('style/dark-mode.wxss')), 1)
})

test('① 审查补修:cy-error 挂上后 autoBack 才翻 true 也要开面板,且只开一次', () => {
  const file = path.join(ROOT, 'components/cy/error/index.js')
  let def = null
  global.Component = (c) => { def = c }
  delete require.cache[require.resolve(file)]
  require(file)
  delete global.Component
  global.getCurrentPages = () => [{}, {}]
  const data = Object.assign({}, def.data)
  for (const [k, spec] of Object.entries(def.properties)) data[k] = spec.value
  const inst = Object.assign({ data }, def.methods, { setData(d) { Object.assign(this.data, d) } })
  def.lifetimes.attached.call(inst)
  assert.equal(inst.data._sheet, false)
  inst.data.autoBack = true; def.observers.autoBack.call(inst, true)
  assert.equal(inst.data._sheet, true, '晚到的 autoBack 必须打开面板')
  inst.data._sheet = false; def.observers.autoBack.call(inst, true)
  assert.equal(inst.data._sheet, false, '收起后不重开')
})

test('② signup 只挂一路时报一次,两路都挂(出半屏)时不报', () => {
  const file = path.join(ROOT, 'subpackageMember/signup/index.js')
  const toasts = []
  const toastPath = require.resolve(path.join(ROOT, 'utils/toast.js'))
  require.cache[toastPath] = { id: toastPath, filename: toastPath, loaded: true, exports: (m) => toasts.push(m) }
  let def = null
  global.getApp = () => ({ globalData: {}, getImgUrl: (u) => u, getPageSize: () => 10 })
  global.Page = (d) => { def = d }
  delete require.cache[require.resolve(file)]
  require(file)
  delete global.Page
  delete require.cache[toastPath]
  const run = (t, a) => { toasts.length = 0; def._reportHalfFailure.call({ _topic: t, _activity: a }); return toasts.slice() }
  assert.deepEqual(run({ state: 'error', err: '路线票加载失败' }, { state: 'ready' }), ['路线票加载失败'])
  assert.deepEqual(run({ state: 'error', err: 'x' }, { state: 'error', err: 'y' }), [])
  assert.deepEqual(run({ state: 'error', err: 'x' }, { state: 'loading' }), [])
})
