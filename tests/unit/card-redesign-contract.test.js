'use strict'

// 2026-08-20 商家卡/俱乐部卡重设计契约(Figma 定稿 → 小程序落地)。
// 锁的都是「不渲染比渲染难」的边界闸:verified=0 禁 0.0km、level=0 禁 Lv.0、
// null 与 0 区分、无服务整行隐藏、三态按钮。这些闸一旦松掉,界面不报错只说谎。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// ---------- cy-merchant-card ----------

test('商家卡:封面头图 + logo 压角,无封面走纯色底品类图标(不许拿 logo 拉伸当封面)', () => {
  const wxml = read('components/cy/merchant-card/index.wxml')
  assert.match(wxml, /wx:if="\{\{cover\}\}" class="mc__cover-img"/)
  // CU-M-61(2026-09-24):兜底图标按品类给 —— 原来写死 poi-shop(咖啡杯),书店与花店
  // 在列表里长得一模一样。品类拿不到时 resolveCategoryIcon 退中性店铺图标,仍不许写死品类。
  assert.match(wxml, /class="mc__cover-ph"><cy-icon name="\{\{_catIcon\}\}" size="88" \/>/)
  assert.doesNotMatch(wxml, /name="poi-shop"/, '兜底图标不得写死成某个品类(咖啡杯)')
  assert.match(read('components/cy/merchant-card/index.js'), /categoryName\(name\) \{ this\.setData\(\{ _catIcon: resolveCategoryIcon\(name\) \}\); \}/)
  assert.match(wxml, /class="mc__logo"/)
  // 旧实现把 cover||logo 混喂同一个 thumb;重设计后两个槽位各自独立
  assert.doesNotMatch(wxml, /cover \|\| logo|logo \|\| cover/)
})

test('商家卡:verified=0/null 时距离整行作废,不渲染 0.0km', () => {
  const js = read('components/cy/merchant-card/index.js')
  assert.match(js, /v != null && Number\(v\) !== 0/)
  const wxml = read('components/cy/merchant-card/index.wxml')
  assert.match(wxml, /wx:if="\{\{_meta\}\}" class="mc__meta"/)
})

test('商家卡:cityRole 有独立金色副标题位;服务行空 = 整行隐藏;标签截前 3 不显 +N', () => {
  const wxml = read('components/cy/merchant-card/index.wxml')
  assert.match(wxml, /wx:if="\{\{cityRole\}\}" class="mc__role"/)
  // 稿 7:2:服务行进底行与按钮同排;无服务时底行只剩右侧按钮,服务行整块不渲染
  assert.match(wxml, /wx:if="\{\{serviceText\}\}" class="mc__service"/)
  assert.match(wxml, /class="mc__bottom"/)
  const js = read('components/cy/merchant-card/index.js')
  assert.match(js, /\.slice\(0, 3\)/)
  assert.doesNotMatch(read('components/cy/merchant-card/index.wxml'), /\+\{\{|\+N/)
})

test('商家卡 venue 变体:承接档案四件套 + coopOpen=0 降饱和;卡上无按钮(稿 8:24)', () => {
  const wxml = read('components/cy/merchant-card/index.wxml')
  assert.match(wxml, /variant === 'venue'\}\}" class="mc__profile"/)
  assert.match(wxml, /可承接 ' \+ capacity \+ ' 人/)
  assert.match(wxml, /chargeType == 1 \? '场地收费' : '场地免费'/)
  // 稿 8:24 用户删掉卡上按钮:发邀请链路 = 整卡进主页 → 主页「发起合作」
  assert.doesNotMatch(wxml, /发起接洽|暂不接洽/)
  assert.match(wxml, /variant !== 'venue' && \(serviceText \|\| \(actionText/, '按钮只属于 list 变体底行')
  const wxss = read('components/cy/merchant-card/index.wxss')
  assert.match(wxss, /\.mc--coop-off\s*\{[^}]*opacity/)
})

test('商家卡:调用方(漫游场景)把 cover、cityRole 分槽喂入,不再折进标签', () => {
  for (const p of ['components/cy/scene-roam-discover/index.wxml']) {
    const wxml = read(p)
    assert.match(wxml, /cover="\{\{item\.cover\}\}"/, p)
    assert.match(wxml, /city-role="\{\{item\.cityRole\}\}"/, p)
  }
  for (const p of ['components/cy/scene-roam-discover/index.js']) {
    assert.doesNotMatch(read(p), /\[row\.cityRole\]|\[m\.cityRole\]/, p + ' cityRole 不再前置进标签')
  }
})

// ---------- cy-club-card ----------

test('俱乐部卡:level=0 不显徽章;null 与 0 区分;能力芯片只显为 1 的且 ≤3', () => {
  const wxml = read('components/cy/club-card/index.wxml')
  assert.match(wxml, /wx:if="\{\{club\.level > 0\}\}" class="cc__level"/)
  const js = read('components/cy/club-card/index.js')
  assert.match(js, /memberCount != null/)
  assert.match(js, /topicCount != null/)
  assert.match(js, /Number\(c\.canDesignRoute\) === 1/)
  assert.match(js, /abilities\.slice\(0, 3\)/)
})

test('俱乐部卡:按钮三态 管理/进入/加入(joinPolicy=1 显申请加入);权益行免费加入不含价格', () => {
  const js = read('components/cy/club-card/index.js')
  assert.match(js, /\{ label: '管理', act: 'manage'/)
  assert.match(js, /\{ label: '进入', act: 'enter'/)
  assert.match(js, /Number\(c\.joinPolicy\) === 1 \? '申请加入' : '加入'/)
  assert.match(js, /'免费加入 · 成员优先报名'/)
  assert.doesNotMatch(js, /memberDiscountPrice|成员价/, '加入不收费,权益行禁止出现价格')
})

test('俱乐部列表页:三份内联拷贝收敛为 cy-club-card,动作分发进既有处理器', () => {
  const json = JSON.parse(read('pages/talent/list/index.json'))
  assert.equal(json.usingComponents['cy-club-card'], '/components/cy/club-card/index')
  const wxml = read('pages/talent/list/index.wxml')
  const uses = wxml.match(/<cy-club-card /g) || []
  assert.equal(uses.length, 3, '我的/已加入/附近 三处都走组件')
  const js = read('pages/talent/list/index.js')
  assert.match(js, /onClubCardAction/)
  // 管理入口修正:此前误读不存在的 data.clubs(死代码),现在按 myClubs 找
  assert.match(js, /this\.data\.myClubs\.find/)
  assert.doesNotMatch(js, /this\.data\.clubs\.find/)
})

test('俱乐部找场地:club/detail 可对接商家用 venue 变体卡', () => {
  const json = JSON.parse(read('pages/club/detail/index.json'))
  assert.equal(json.usingComponents['cy-merchant-card'], '/components/cy/merchant-card/index')
  const wxml = read('pages/club/detail/index.wxml')
  assert.match(wxml, /<cy-merchant-card class="mcard"[\s\S]*?variant="venue"/)
  assert.match(wxml, /suit-types="\{\{item\.suitActivityTypes\}\}"/)
})

// ---------- 商家工作台项目卡(稿 3910:580) ----------

test('工作台项目卡:状态签按真实档期判(档期未知不编状态),类目跟在状态后', () => {
  const { buildProjectCards } = require('../../utils/merchant-workbench.js')
  const cards = buildProjectCards({
    today: '2026-08-20',
    joinList: [
      { id: 1, topicId: 1, topicName: 'A', mode: 2, startDate: '2026-08-19', endDate: '2026-08-21' },
      { id: 2, topicId: 2, topicName: 'B', mode: 1, startDate: '2026-09-01' },
      { id: 3, topicId: 3, topicName: 'C' },
    ],
    hostList: [{ id: 9, bizType: 'activity', titleText: 'X', startTime: '2026-08-01', endTime: '2026-08-02' }],
    todoByProject: [],
  })
  assert.equal(cards[0].statusLabel, '进行中')
  assert.equal(cards[0].catLabel, '自由探索')
  assert.equal(cards[1].statusLabel, '未开始')
  assert.equal(cards[1].catLabel, '城市定向')
  assert.equal(cards[2].statusLabel, '', '档期未知不许编一个状态出来')
  assert.equal(cards[3].statusLabel, '已结束')
  assert.equal(cards[3].catLabel, '活动')
  const wxml = read('pages/merchant/index/index.wxml')
  assert.match(wxml, /rv-project-status[\s\S]*?rv-project-cat/, '类目签必须跟在状态签后面')
  assert.match(wxml, /rv-project-line1[\s\S]*?<\/view>[\s\S]*?rv-project-card-title/, '标题在签行下独占一行')
})

// ---------- 商家主页发起合作 ----------

test('商家版主页:无成就 tab / tab 无整条底线 / 白卡退场文字落底', () => {
  const js = read('components/cy/profile/index.js')
  assert.match(js, /t\.key !== 'achievements'/, '商家版必须滤掉成就 tab')
  const wxml = read('components/cy/profile/index.wxml')
  // 2026-08-20 解冲突:master(#753)那侧按「用户定不要那条白线」改成一律关掉,
  // 不再按身份区分;本分支原来的 !isMerchantView 让位给它。
  assert.match(wxml, /hairline="\{\{false\}\}"/, 'tab 整条底线一律关掉')
  const wxss = read('components/cy/profile/index.wxss')
  assert.match(wxss, /\.pc-merchant \.pc-card \{ background: transparent; border: none/)
  const tabsWxss = read('components/cy/tabs/index.wxss')
  // 同一功能两边并行实现,修饰类名以已合入 master 的 --noline 为准(本分支原叫 --flat)
  assert.match(tabsWxss, /\.cy-tabs--noline \{[^}]*border-bottom: none/)
})

test('商家合作页:商家/俱乐部行换新版卡,俱乐部按钮为「发起合作」', () => {
  const wxml = read('pages/merchant/relation/index.wxml')
  assert.match(wxml, /<cy-merchant-card[\s\S]*?bind:tap="goMerchant"/)
  assert.match(wxml, /<cy-club-card club="\{\{item\}\}" cta="发起合作"/)
  assert.doesNotMatch(wxml, /<cy-cell/, '旧 cy-cell 行不许残留')
  const json = JSON.parse(read('pages/merchant/relation/index.json'))
  assert.equal(json.usingComponents['cy-club-card'], '/components/cy/club-card/index')
  assert.equal(json.usingComponents['cy-cell'], undefined, '孤儿注册一并清掉')
})

test('商家主页:访客(非商家)看商家档案时底部有「发起合作」,走 coop/invite type=0', () => {
  const wxml = read('components/cy/profile/index.wxml')
  // 2026-09-16 拍板 #13:带主题上下文的商家观看者(商家主办去邀商家承接)也渲染这颗 CTA。
  assert.match(wxml, /isMerchantView && !isSelf && \(!viewerIsMerchant \|\| topicId\)\}\}" class="pc-coop-bar"/)
  assert.match(wxml, />发起合作</)
  const js = read('components/cy/profile/index.js')
  assert.match(js, /\/pages\/coop\/invite\/index\?/)
  assert.match(js, /'type=0'/)
  const wxss = read('components/cy/profile/index.wxss')
  assert.match(wxss, /\.pc-coop-bar\s*\{[^}]*env\(safe-area-inset-bottom\)/s)
})
