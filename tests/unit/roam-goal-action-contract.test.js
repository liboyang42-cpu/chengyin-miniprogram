const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildRoamGoal } = require('../../utils/play-state-contract.js')

const PAGE_MODULE = '../../pages/roam/index.js'
const ROAM_WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxml'), 'utf8')
const ROAM_WXSS = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxss'), 'utf8')
const TOKENS_WXSS = fs.readFileSync(path.resolve(__dirname, '../../style/tokens.wxss'), 'utf8')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = ROAM_WXSS.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  assert.ok(match, `找不到样式规则 ${selector}`)
  return match[1]
}

function tokenNumber(name) {
  // Dynamic Type(2026-08-22):字阶已包成 calc(NNrpx * var(--cy-type-scale)),取 scale=1 的基准值
  const match = TOKENS_WXSS.match(new RegExp(`--${name}:\\s*(?:calc\\()?([0-9.]+)(?:rpx)?`))
  assert.ok(match, `找不到数值 token --${name}`)
  return Number(match[1])
}

function loadRoamPage() {
  let definition
  const previous = {
    Page: global.Page,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx,
  }
  try {
    global.Page = config => { definition = config }
    global.getApp = () => ({ globalData: { features: {} } })
    global.getCurrentPages = () => []
    global.wx = { getStorageSync: () => undefined }
    delete require.cache[require.resolve(PAGE_MODULE)]
    require(PAGE_MODULE)
  } finally {
    global.Page = previous.Page
    global.getApp = previous.getApp
    global.getCurrentPages = previous.getCurrentPages
    global.wx = previous.wx
  }
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  })
}

function enumerateGoalActions() {
  const actions = new Set()
  const bools = [false, true]
  for (const visitActive of bools) {
    for (const gpsEnabled of bools) {
      for (const locationError of bools) {
        for (const offline of bools) {
          for (const poiEmpty of bools) {
            for (const nearbyCount of [0, 2]) {
              // 拍板 9-16「漫游打卡不存在失败态」:页面不再向 buildRoamGoal 传 checkinError
              // (visit.checkinErr/checkinRetryable 已随失败浮卡一起删),所以这里不枚举它 ——
              // 'retry-checkin' 这一档在漫游页物理上不可达,由下面的独立断言钉住。
              const goal = buildRoamGoal({
                visitActive,
                poiName: '',
                gpsEnabled,
                locationError,
                offline,
                poiEmpty,
                nearbyCount,
              })
              if (goal.act) actions.add(goal.act)
            }
          }
        }
      }
    }
  }
  return [...actions].sort()
}

test('漫游页不再产生「打卡失败」目标态(拍板:打卡不存在失败态)', () => {
  const roamJs = fs.readFileSync(path.resolve(__dirname, PAGE_MODULE), 'utf8')
  const goalSource = roamJs.slice(roamJs.indexOf('_syncGoal('), roamJs.indexOf('onGoalTap('))
  assert.doesNotMatch(goalSource, /checkinError/, '目标态输入不许再带 checkinError')
  assert.doesNotMatch(roamJs, /retryCheckin/, '失败重试入口(retryCheckin)必须随失败浮卡一起删除')
})

test('buildRoamGoal 的每个非空动作都由 onGoalTap 产生明确且唯一的效果', () => {
  const expectedEffect = {
    discover: 'discover',
    gps: 'gps',
    nearby: 'nearby',
    'retry-poi': 'retry-poi',
  }
  // util 里 'retry-checkin' 分支留给共享九态合同(play-state-contract.test.js 直接测 util);
  // 漫游页已不产生该输入,故不列入页面动作合同 —— 见上面那条独立断言。
  const declaredActions = [...new Set(
    [...buildRoamGoal.toString().matchAll(/\bact:\s*([^,\n}]+)/g)]
      .flatMap(expression => [...expression[1].matchAll(/'([^']+)'/g)].map(match => match[1])),
  )].filter(act => act !== 'retry-checkin').sort()
  assert.deepEqual(enumerateGoalActions(), declaredActions, '每个声明的非空 goal.act 都必须可由输入合同产出')
  assert.deepEqual(Object.keys(expectedEffect).sort(), declaredActions, '新增 goal.act 时必须同步补页面动作合同')

  const expectedActions = declaredActions
  for (const act of expectedActions) {
    const page = loadRoamPage()
    const effects = []
    page.data.goal = { act }
    page.goDiscover = () => { effects.push('discover') }
    page.toggleGps = () => { effects.push('gps') }
    page.onPoiRetry = () => { effects.push('retry-poi') }
    page.setData = patch => {
      if (patch.nearbyBanner && patch.nearbyBanner.show === true) effects.push('nearby')
    }

    page.onGoalTap()

    assert.deepEqual(effects, [expectedEffect[act]], `${act} 必须且只能执行一个对应动作`)
  }
})

test('discover 点击只调用一次 goDiscover，规则入口用 catchtap 隔离父级目标点击', () => {
  const page = loadRoamPage()
  let discoverCalls = 0
  page.data.goal = { act: 'discover' }
  page.goDiscover = () => { discoverCalls += 1 }

  page.onGoalTap()

  assert.equal(discoverCalls, 1)
  const goalHead = ROAM_WXML.slice(
    ROAM_WXML.indexOf('<view wx:if="{{goal.act}}" class="pcard__head pcard__head--goal"'),
    ROAM_WXML.indexOf('<view class="pcard__row">'),
  )
  assert.match(goalHead, /bindtap="onGoalTap"/)
  assert.match(goalHead, /class="pcard__rules" catchtap="openRoamRules"/)
  assert.doesNotMatch(goalHead, /class="pcard__rules" bindtap=/)

  const rulesBinding = goalHead.match(/class="pcard__rules"\s+(catch|bind)tap="([^"]+)"/)
  let rulesCalls = 0
  discoverCalls = 0
  page.openRoamRules = () => { rulesCalls += 1 }
  page[rulesBinding[2]]()
  if (rulesBinding[1] !== 'catch') page.onGoalTap()
  assert.deepEqual({ goalCalls: discoverCalls, rulesCalls }, { goalCalls: 0, rulesCalls: 1 })
})

test('没有下一步动作的当前目标不伪装成可点击按钮', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/roam/index.wxml'), 'utf8')
  assert.match(wxml, /wx:if="\{\{goal\.act\}\}"[^>]*bindtap="onGoalTap"[^>]*aria-role="button"/)
  assert.match(wxml, /wx:else[^>]*aria-role="text"/)
})

test('弱网长目标在固定卡高中换成两行，且正常与空态仍保留单行布局', () => {
  assert.match(
    ROAM_WXML,
    /class="pcard \{\{goal\.act === 'retry-poi' \? 'pcard--long-goal' : ''\}\}"/,
    '只有弱网重试目标应进入长文案布局',
  )

  const baseCard = cssRule('.pcard')
  const baseHead = cssRule('.pcard__head')
  const baseRow = cssRule('.pcard__row')
  const baseTitle = cssRule('.pcard__title')
  const longRow = cssRule('.pcard--long-goal .pcard__row')
  const longTitle = cssRule('.pcard--long-goal .pcard__title')

  // 2026-09-09 读数卡照原型 .dcard 搬之后,头/体不再各写死一个高度:
  // 原型是「固定卡高 + flex column + space-between」,头一变高读数区自然被挤矮。
  // 所以这里改成钉那套机制本身 —— 它才是「长目标换行不撑破卡」的真正保证。
  assert.match(baseCard, /height:\s*246rpx/, '卡高固定,长文案不许把卡撑大')
  assert.match(baseCard, /display:flex/)
  assert.match(baseCard, /flex-direction:column/)
  assert.match(baseCard, /justify-content:space-between/)
  assert.doesNotMatch(baseHead, /height:\s*\d+rpx/, '头不再写死高度,由内容撑')
  assert.doesNotMatch(baseRow, /height:\s*\d+rpx/, '读数区同上')
  assert.match(longRow, /padding-top:\s*var\(--cy-space-2\)/)
  assert.match(baseTitle, /white-space:\s*nowrap/)
  assert.match(baseTitle, /text-overflow:\s*ellipsis/)
  assert.match(longTitle, /font-size:\s*var\(--cy-type-body\)/)
  assert.match(longTitle, /white-space:\s*normal/)
  assert.match(longTitle, /text-overflow:\s*clip/)
  assert.match(longTitle, /overflow:\s*visible/)

  assert.match(cssRule('.pcard__goal-copy'), /flex:\s*1/)
  assert.match(cssRule('.pcard__goal-copy'), /min-width:\s*0/)
  assert.match(cssRule('.pcard__rules'), /flex:\s*none/)

  // DevTools 报告的 390px 视口映射到小程序 750rpx 设计宽；以下按全角字最坏宽度计算。
  const viewportWidth = 750
  const cardLeft = Number(baseCard.match(/left:\s*(\d+)rpx/)[1])
  const cardRight = Number(baseCard.match(/right:\s*(\d+)rpx/)[1])
  // 左右内边距 2026-09-09 随「照原型 .dcard 搬」从 .pcard__head 挪到 .pcard 自己身上
  // (原型 padding:15px 20px 16px);数值没变,只是换了承载者。
  const headPadding = Number(baseCard.match(/padding:\s*\d+rpx\s+(\d+)rpx/)[1])
  const titleWidth = viewportWidth - cardLeft - cardRight - headPadding * 2
    - tokenNumber('cy-btn-h') - tokenNumber('cy-space-2')
  const weakText = buildRoamGoal({ gpsEnabled: true, offline: true }).text
  const titleLines = Math.ceil([...weakText].length * tokenNumber('cy-type-body') / titleWidth)
  assert.equal(titleLines, 2, '弱网目标全文必须能在规则按钮左侧两行内放下')

  // 头不再有固定高之后,「不越界」要按卡的**内容盒**算:
  // 卡高 246rpx 减掉原型 padding(上 29 + 下 31)= 186rpx,两行标题 + 读数区必须都装得下。
  const tightLeading = tokenNumber('cy-leading-tight')
  const cardHeight = Number(baseCard.match(/height:\s*(\d+)rpx/)[1])
  const padTop = Number(baseCard.match(/padding:\s*(\d+)rpx/)[1])
  const padBottom = Number(baseCard.match(/padding:\s*\d+rpx\s+\d+rpx\s+(\d+)rpx/)[1])
  const contentBox = cardHeight - padTop - padBottom
  const goalCopyHeight = tokenNumber('cy-type-micro') * tightLeading
    + tokenNumber('cy-space-1')
    + titleLines * tokenNumber('cy-type-body') * tightLeading
  // 读数区 = 数字(62rpx 行高 1)+ 标签上边距 + 标签,取自照原型搬来的 .pstat__v / .pstat__l
  const statValue = Number(cssRule('.pstat__v').match(/font-size:\s*(\d+)rpx/)[1])
  const statLabel = Number(cssRule('.pstat__l').match(/font-size:\s*(\d+)rpx/)[1])
  const statGap = Number(cssRule('.pstat__l').match(/margin-top:\s*(\d+)rpx/)[1])
  const rowHeight = statValue + statGap + statLabel
  // 原型没有「弱网长目标」这一态,而两行标题 + 读数区在原型的 246rpx 里实测装不下。
  // 所以只有这一档放开成 auto,min-height 仍钉在原型高度上 —— 它只会更高,不会更矮。
  const longGoal = cssRule('.pcard--long-goal')
  assert.match(longGoal, /height:auto/, '长目标态必须放开卡高,否则读数数字会被压出卡外')
  assert.match(longGoal, new RegExp(`min-height:${cardHeight}rpx`), '下限仍是原型的卡高')
  assert.ok(goalCopyHeight + rowHeight > contentBox,
    '这条断言在提醒:两行标题确实装不进原型卡高,上面那两条放开才有意义 —— 哪天装得下了就把 auto 收回去')

  // 读数区不再有「被缩短」这回事:长目标态的卡高放开成 auto,读数区拿的是自己的自然高。
  // 要守的变成「读数区自己算得出高度」,别哪天 .pstat__v 又被写死成一个撑不下数字的行高。
  const valueRule = cssRule('.pstat__v')
  const labelRule = cssRule('.pstat__l')
  assert.match(valueRule, /line-height:1/, '数字行高按原型取 1,靠字号本身撑')
  assert.ok(rowHeight > 0 && rowHeight < contentBox, `读数区 ${rowHeight}rpx 必须小于卡内容盒`)
  assert.match(labelRule, /margin-top:\s*\d+rpx/)
})
