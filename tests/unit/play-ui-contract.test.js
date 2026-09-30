const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildPlayHeader, buildPlayHud, buildPlayRoute, createSessionClock } = require('../../utils/play-ui-contract.js')

const readXcx = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')

test('三种模式共用顶部状态条合同', () => {
  const classic = buildPlayHeader({ section: '第一章', modeLabel: '经典定向', title: '旧街到黄昏', current: 2, total: 5, actionLabel: '重看本章' })
  const roam = buildPlayHeader({ section: '自由漫游', modeLabel: '实时探索', title: '人民广场附近', current: 18, total: 100, progressKind: 'percent' })

  assert.deepEqual(Object.keys(classic), Object.keys(roam))
  assert.equal(classic.eyebrow, '第一章 · 经典定向')
  assert.equal(classic.progressText, '2 / 5')
  assert.equal(classic.progressPct, 40)
  assert.equal(roam.progressText, '18%')
})

test('Classic 与 Free 共用完成数/用时 HUD 合同', () => {
  const classic = buildPlayHud({
    mode: 'classic',
    elapsedSeconds: 83,
    completedCount: 2,
    totalCount: 5,
    paused: false,
  })
  const free = buildPlayHud({
    mode: 'free',
    elapsedSeconds: 83,
    completedCount: 2,
    totalCount: 5,
    paused: false,
  })

  assert.deepEqual(classic, free)
  assert.deepEqual(classic.left, { label: '已完成', value: '2', unit: '/5' })
  assert.deepEqual(classic.right, { label: '用时', value: '01:23', unit: '' })
  assert.equal(classic.actionLabel, '暂停')
  assert.equal(classic.endHoldPct, 0)
})

test('Explore 沿用同一 HUD 结构但左侧显示真实路程', () => {
  const hud = buildPlayHud({
    mode: 'explore',
    elapsedSeconds: 3723,
    distanceKm: 1.26,
    paused: true,
  })

  assert.deepEqual(hud.left, { label: '已走', value: '1.26', unit: 'km' })
  assert.deepEqual(hud.right, { label: '用时', value: '62:03', unit: '' })
  assert.equal(hud.state, 'paused')
  assert.equal(hud.actionLabel, '继续')
})

test('会话计时在暂停期间冻结并可继续累计', () => {
  let now = 1000
  const clock = createSessionClock(() => now)

  clock.start()
  now = 6500
  assert.equal(clock.elapsedSeconds(), 5)

  clock.pause()
  now = 26500
  assert.equal(clock.elapsedSeconds(), 5)

  clock.resume()
  now = 30600
  assert.equal(clock.elapsedSeconds(), 9)
  assert.equal(clock.isPaused(), false)
})

test('R9-21 暂停中的会话可从快照用时恢复,恢复后不偷跑、继续要接着算', () => {
  let now = 0
  const clock = createSessionClock(() => now)

  clock.restorePaused(42)
  now = 999999
  assert.equal(clock.isPaused(), true, '恢复出来必须是暂停态')
  assert.equal(clock.elapsedSeconds(), 42, '暂停期间用时不许跟着真实时间走')

  clock.resume()
  now = 1002000
  assert.equal(clock.elapsedSeconds(), 44, '继续后从 42 秒接着累计')
  assert.equal(clock.isPaused(), false)
})

test('Classic 连线带箭头，Free 一条线都不画 —— 它没有解锁顺序', () => {
  const nodes = [
    { latitude: 31.21, longitude: 121.46 },
    { lat: 31.22, lng: 121.47 },
    { latitude: null, longitude: 121.48 },
  ]
  const classic = buildPlayRoute(nodes, 'classic')

  assert.equal(classic.length, 1)
  assert.deepEqual(classic[0].points, [
    { latitude: 31.21, longitude: 121.46 },
    { latitude: 31.22, longitude: 121.47 },
  ])
  assert.equal(classic[0].color, '#FFFFFF')
  assert.equal(classic[0].dottedLine, false)
  assert.equal(classic[0].arrowLine, true)
  // 2026-09-09 裁决:自由探索不连线。此前它画一条灰虚线把所有点串起来,
  // 而那条线本身就在说「先走这个再走那个」—— 恰恰是这个模式没有的东西。
  assert.deepEqual(buildPlayRoute(nodes, 'free'), [])
  assert.deepEqual(buildPlayRoute(nodes, 2), [])
})

test('路线坐标不足两点时不绘制误导性路线', () => {
  assert.deepEqual(buildPlayRoute([{ latitude: 31.21, longitude: 121.46 }], 'classic'), [])
})

test('三模式与自由探索过场均使用真实腾讯原生地图', () => {
  const playWxml = readXcx('pages/play/index.wxml')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const mapWxml = readXcx('components/cy/free-map/index.wxml')
  const mapWxss = readXcx('components/cy/free-map/index.wxss')

  assert.match(mapWxml, /<map\s+id="fmap"/)
  assert.match(mapWxml, /enable-poi="\{\{true\}\}"/)
  // 2026-09-22 主地图与起始页过场随地图层一起删;完成页回放那一处仍是真原生地图。
  assert.ok((playWxml.match(/<free-map\b/g) || []).length >= 1, '完成页路径回放仍应使用 free-map')
  assert.match(roamWxml, /<free-map\b[^>]*scene="explore"/s)
  assert.doesNotMatch(playWxml, /free-map-grid/)
  assert.match(mapWxss, /:host\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
})

// 2026-08-04 用户裁决:推翻原「雾层不会遮蔽腾讯地图道路与 POI」——按参考图走未探区几乎不透的
// 探索游戏观感。这条测试改为锁「两条渲染路径浓度一致」:overlay 的 FOG_ALPHA 与 poly 的最高档
// 必须同值,否则同一个玩家在真机和降级设备上看到的是两种游戏。
test('自由漫游雾层浓度:overlay 与 poly 两条路径同档,且降级不得退成无雾', () => {
  const roamJs = readXcx('pages/roam/index.js')

  const alpha = roamJs.match(/const FOG_ALPHA = ([0-9.]+);/)
  assert.ok(alpha, '找不到 FOG_ALPHA')
  // 最高档 = _fogBandColor 里那条无条件 return(前两档都挂在 if 后面)
  const topBand = roamJs.match(/\n\s*return '#060606([0-9A-F]{2})'; \/\/ 约/)
  assert.ok(topBand, '找不到 poly 最高档雾色')
  const bandAlpha = parseInt(topBand[1], 16) / 255
  assert.ok(Math.abs(Number(alpha[1]) - bandAlpha) < 0.02,
    'poly 最高档 ' + bandAlpha.toFixed(2) + ' 与 FOG_ALPHA ' + alpha[1] + ' 不同档 —— 真机与降级设备会看到两种雾')
  // 边缘挡板必须和最高档同色,否则雾区边界会出现一条明显的深浅硬线
  assert.ok((roamJs.match(new RegExp("fillColor: '#060606" + topBand[1] + "'", 'g')) || []).length >= 2,
    '边缘 slab 的填色必须跟最高档雾色同步改')
  // 浓度是可调的产品裁决,但「把雾关掉」不是 —— 下面锁的是这个。
  // 2026-08-04 前这里锁的是 _fogMode='none' + fogPolys:[] —— 那两行正是「漫游看不到迷雾」的成因,
  // 被当成契约锁住后,修 bug 反而会判红。改锁真正的不变量:降级路径必须仍然画雾。
  assert.doesNotMatch(roamJs, /this\._fogMode = 'none';/,
    '降级不得退成无雾;要保留浓度上限请改 FOG_ALPHA / _fogBandColor')
  assert.match(roamJs, /_fogFallbackToPoly\(\)/)
  assert.match(roamJs, /this\._fogMode = 'poly';[\s\S]{0,120}this\._initFogGrid\(\);/)
})

test('黑白地图控件保持前景与背景可辨', () => {
  const mapJs = readXcx('components/cy/free-map/index.js')
  const playWxss = readXcx('pages/play/index.wxss')
  const roamJs = readXcx('pages/roam/index.js')

  assert.match(mapJs, /color:\s*highlighted \? '#111111' : '#fff'/)
  // 2026-09-06 原生 showModal 全删:确认键色由 cy-modal token 承担,页面不再传 confirmColor
  assert.doesNotMatch(roamJs, /confirmColor:/)
  assert.match(roamJs, /cyModal\.show\(/)
  assert.doesNotMatch(playWxss, /background:\s*var\(--cy-color-play-accent\)[^}]*color:\s*var\(--cy-color-text-primary\)/s)
  assert.match(playWxss, /\.cover-stamp\{[^}]*color:\s*var\(--cy-color-text-inverse\)/s)
})

test('城市定向保留中性底卡和操作栏，漫游底栏改为地图浮层', () => {
  const playWxss = readXcx('pages/play/index.wxss')
  const roamWxss = readXcx('pages/roam/index.wxss')

  // 2026-09-22 读数卡(.pcard)随地图层一起删,只剩操作栏那半条契约。
  // 2026-09-10 照原型:.trio 是浮在地图上的(bottom:20px / height:100px,没有底色也没有上边线),
  //   现码那条 #0D0E12 实心条来自旧 Figma 稿。漫游上一批已经改过,这里补上城市定向与自由探索。
  //   断言反过来钉死:这条实心底不许回来。
  assert.doesNotMatch(playWxss, /\.pbar\{[^}]*background:#0D0E12/s)
  assert.match(playWxss, /\.pbar\{[^}]*background:transparent/s)
  // 2026-09-09 抽屉照原型搬:原型**没有**内层那张卡,行直接排在黑面上,
  // 靠 1px 白 7% 的上边框分隔。#1E2028 那张卡整块删掉了。
  assert.doesNotMatch(playWxss, /\.tools__card\{/)
  // 2026-09-11 行样式并进 style/proto-sheet.wxss 的 .drow(与漫游抽屉同一份),
  // 所以分隔线断言挪到共用件上,play 这边只断言它确实引了那份。
  assert.match(playWxss, /@import "\/style\/proto-sheet\.wxss";/)
  assert.match(readXcx('style/proto-sheet.wxss'), /\.drow\{[\s\S]*?border-top:1rpx solid rgba\(255,255,255,\.07\)/)
  assert.match(roamWxss, /\.pcard\{[^}]*background:rgba\(8,10,13,\.56\)/s)
  assert.match(roamWxss, /\.pbar\{[^}]*background:transparent/s)
  assert.doesNotMatch(roamWxss, /\.tools__card\{/)
  ;[playWxss, roamWxss].forEach((source) => {
    assert.doesNotMatch(source, /\.pcard\{[^}]*var\(--cy-color-bg-(?:glass|elevated)\)/s)
  })
  assert.doesNotMatch(playWxss, /\.nextcard\s*\{/)
})

test('漫游不再渲染底部黑色工具块，三枚操作浮在地图上', () => {
  const roamWxml = readXcx('pages/roam/index.wxml')
  const roamJs = readXcx('pages/roam/index.js')
  const roamWxss = readXcx('pages/roam/index.wxss')

  assert.doesNotMatch(roamJs, /roamToolsOpen|toggleRoamTools/)
  assert.doesNotMatch(roamWxml, /class="tools"|pbar__grabhit|pbar--tools/)
  // 2026-09-10 漫游三键改口照原型:更多 / 暂停 / 拍照。
  //   左键从「拍照」换成「更多」—— 它拉的是工具抽屉(原型 f-more),漫游原来压根没有抽屉入口。
  //   右键合成一枚:打卡待确认时完成打卡,否则开相机(原型的「拍照」通向 f-visit 探店那一步)。
  //   ⚠️ 右键必须仍能走到 onCenterTap:_finishVisit 在现码里只有那一个入口。
  assert.match(roamWxml, /class="pbar__trio">[\s\S]*?bindtap="openRoamMore"[\s\S]*?bindtap="togglePause"[\s\S]*?bindtap="onRoamRightAction"/)
  assert.match(roamWxss, /\.pbar\{[^}]*position:absolute;[^}]*background:transparent/s)
  // 2026-09-09 按原型 .trio 的 gap:64px 换算 = 123rpx。原来写的 64rpx 正好差一倍,
  // 三键挤在一起 —— 这是把 px 当 rpx 直接抄下来的老错。
  assert.match(roamWxss, /\.pbar__trio\{[^}]*gap:123rpx/s)
})

test('三模式核心地图操作达到 44pt 点击区且有可读标签', () => {
  const mapWxss = readXcx('components/cy/free-map/index.wxss')
  const playWxml = readXcx('pages/play/index.wxml')
  const playWxss = readXcx('pages/play/index.wxss')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const roamWxss = readXcx('pages/roam/index.wxss')
  const roamJs = readXcx('pages/roam/index.js')

  assert.match(mapWxss, /\.fmap-btn\s*\{[^}]*width:\s*88rpx;[^}]*height:\s*88rpx;/s)
  ;[playWxss, roamWxss].forEach((source) => {
    const side = source.match(/\.pact__ic\{[^}]*width:(\d+)rpx;[^}]*height:(\d+)rpx/s)
    assert.ok(side, '底栏侧键必须显式声明宽高')
    assert.ok(Number(side[1]) >= 88 && Number(side[2]) >= 88, `底栏侧键 ${side[1]}×${side[2]}rpx 小于 44pt`)
    // 「继续 / 结束」两个方键(.pbtn)已随一枚圆钮的裁决删除,点击区只剩三键这一排
    assert.doesNotMatch(source, /\.pbtn\{/)
  })
  // 主键 = 原型 .tbtn.main .ic 的 64px = 123rpx(原来 124rpx 是 Figma 板的实测值,
  // 与 HTML 差 1rpx;用户裁决所有页面以 HTML 为准)
  ;[playWxss, roamWxss].forEach((source) => {
    assert.match(source, /\.pact__ic--main\{ width:123rpx; height:123rpx;/)
  })
  assert.match(playWxml, /bindtap="onRunToggle"[\s\S]{0,160}?aria-label=/)
  assert.match(playWxml, /bindtap="onScanArrive"[^>]*aria-role="button"[^>]*aria-label="扫码到达"/)
  assert.match(roamWxml, /bindtap="onRoamRightAction"[^>]*aria-role="button"[^>]*aria-label="\{\{visit\.checkinOk \? '完成探店打卡' : '拍摄探索照片'\}\}"/)
  assert.match(roamJs, /onRoamRightAction\(\)\s*\{[\s\S]*?onCenterTap\(\)[\s\S]*?onTakePhoto\(\)/)
  assert.match(roamWxml, /class="location-picker__cta"[^>]*aria-role="button"[^>]*aria-label="在腾讯地图中选择地点"/)
})

test('自由探索从进入起显示全部已解锁地点，不用先完成一站才揭示其余章节', () => {
  const playJs = readXcx('pages/play/index.js')

  assert.doesNotMatch(playJs, /freeRevealAll/)
  assert.doesNotMatch(playJs, /const freeSingle\s*=/)
  assert.doesNotMatch(playJs, /visibleNodes\s*=\s*freeSingle/)
})

test('主题介绍消费后端公开奖励摘要，不只下发无人读取的 couponId', () => {
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')

  // 2026-09-22 奖励摘要的唯一渲染点(剧本 tab 奖励卡)随起始页删除,改存实例字段,不再占 data 位。
  assert.match(playJs, /that\._themeReward = d\.reward \|\| null/)
  assert.match(playJs, /coupon:\s*shopDay \? null : \(n\.coupon \|\| null\)/)
})

test('漫游底栏暂停态显示用时、地盘与距离三格读数', () => {
  const playWxml = readXcx('pages/play/index.wxml')
  const roamWxml = readXcx('pages/roam/index.wxml')

  // 2026-09-09 读数照原型 countUp 滚动:渲染的是 statsShown 这份镜像,
  // 真值在 this._stats(实例字段,2026-09-10 从 data 挪出去,它一行都不进 wxml)。
  // 2026-09-10 中间那格改口:原来断言的是 statsShown.shops(探店数),
  //   而原型 fogBase 的 dcard 三格逐字是 用时 / 地盘 / 距离 (公里) —— 实拍原型比对时发现的,
  //   现码抄错了一格。断言跟着改成 explorePct,顺序不变。
  assert.match(roamWxml, /class="pcard__row"[\s\S]*?\{\{statsShown\.time\}\}[\s\S]*?\{\{statsShown\.explorePct\}\}[\s\S]*?\{\{statsShown\.distance\}\}/)
  assert.doesNotMatch(playWxml, /<cy-play-pause/)
  assert.doesNotMatch(roamWxml, /<cy-play-pause/)
})

// 9-09 裁决:开始 / 暂停 / 结束收进同一枚圆钮 —— 点一下切换,长按 3 秒结束。
// 暂停态不再换成另一排「继续 / 结束」两个方键,那排连同它的确认弹窗一起删了。
test('开始暂停结束是同一枚圆钮，长按三秒结束', () => {
  const playWxml = readXcx('pages/play/index.wxml')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const playJs = readXcx('pages/play/index.js')
  const roamJs = readXcx('pages/roam/index.js')

  // 方键那一排彻底没有了
  assert.doesNotMatch(playWxml, /pbar__pair|pbtn--stop/)
  assert.doesNotMatch(roamWxml, /pbar__pair|pbtn--stop/)
  // 三键那一排不再挂条件:暂停态也是它
  // 2026-09-11 抽屉拉开时三键收起(原型 x-tools / h-tools 里三键不在场),所以多了 wx:if。
  // 2026-09-21 F-57:自由探索带 lead 时底栏整条要出来(领队工具在抽屉里),但三键仍只属于
  //   城市定向与地图态 —— 自由探索的核销/扫码收在节点半屏那一步,不跟着 lead 冒出来。
  assert.match(playWxml, /class="pbar__trio" wx:if="\{\{!sessionToolsOpen && \(mode!=2 \|\| freeMap\)\}\}">/)
  assert.match(roamWxml, /class="pbar__trio">/)
  // 主键同时接了点按和长按
  // 2026-09-10 中键加了 wx:if="{{mode!=2}}" —— 自由探索没有「一场会话」,原型 freeBar
  //   只有核销 + 扫码两键。长按结束那套接线本身一字未改。
  assert.match(playWxml, /class="pact pact--main" wx:if="\{\{mode!=2\}\}" bindtap="onRunToggle"[\s\S]{0,200}?bindtouchstart="onRunHoldStart"[\s\S]{0,120}?bindtouchend="onRunHoldEnd"/)
  assert.match(roamWxml, /class="pact pact--main" bindtap="togglePause"[\s\S]{0,200}?bindtouchstart="onCenterHoldStart"[\s\S]{0,120}?bindtouchend="onCenterHoldEnd"/)
  // 进度环由 pct 驱动,满了转红
  assert.match(playWxml, /runHoldPct >= 100 \? 'is-holdfull'/)
  assert.match(roamWxml, /endHoldPct >= 100 \? 'is-holdfull'/)
  // 三秒是两页共同口径
  assert.match(playJs, /RUN_HOLD_MS = 3000/)
  assert.match(roamJs, /END_HOLD_MS = 3000/)
  // 长按满之后补的那记 tap 必须吞掉,否则结束完又切回去
  assert.match(playJs, /_runHoldTriggered\) \{ this\._runHoldTriggered = false; return; \}/)
  assert.match(roamJs, /_endHoldTriggered\) \{ this\._endHoldTriggered = false; return; \}/)
  // 漫游长按不再要求先暂停
  assert.doesNotMatch(roamJs, /onCenterHoldStart\(\) \{\s*if \(!this\.data\.paused/)
})

test('游玩工具抽屉:开关是真开关，用不了的行画成失效态，抽屉内部滚动', () => {
  const wxml = readXcx('pages/play/index.wxml')
  const wxss = readXcx('pages/play/index.wxss')
  const js = readXcx('pages/play/index.js')

  // 动态效果是本机偏好 → 真开关,就地翻,不带箭头也不跳页。
  // 2026-09-09 照原型搬:开关换成原型自己那枚 44×26 药丸(.dsw),不再用原生 cy-switch。
  assert.match(wxml, /<text class="dt">动态效果<\/text>[\s\S]{0,260}?class="dsw \{\{reducedMotion \? '' : 'is-on'\}\}" catchtap="toggleReducedMotion"/)
  assert.doesNotMatch(wxml, /<cy-switch/)
  // 它此前被写在「设置」那一行内部,于是屏上出现两行「设置」;现在只剩一行
  assert.equal((wxml.match(/<text class="dt">设置<\/text>/g) || []).length, 0)
  // 定位驱动的两行翻不动 → 失效态 + 点了要解释,而不是留一枚没反应的开关
  for (const label of ['自动记录足迹', '到点提醒']) {
    const row = new RegExp('class="drow \\{\\{gpsOk \\? \'\' : \'is-off\'\\}\\}" bindtap="onLocationRowTap"[\\s\\S]{0,400}?' + label)
    assert.match(wxml, row)
  }
  assert.match(js, /onLocationRowTap\(\) \{[\s\S]{0,200}?requestPlayLocation\(\); return; \}[\s\S]{0,120}?cyToast\(/)
  // 失效态整行压暗,并且这一行不画箭头(箭头 = 点了会去别处)
  assert.match(readXcx('style/proto-sheet.wxss'), /\.drow\.is-off/)
  assert.doesNotMatch(wxml, /bindtap="onLocationRowTap"[\s\S]{0,400}?class="darr"/)
  // 抽屉到屏底内部滚动,行数多不会把三键顶出屏外
  assert.match(wxml, /<scroll-view class="tools" wx:if="\{\{sessionToolsOpen\}\}" scroll-y/)
  assert.match(wxss, /\.tools\{[^}]*max-height/)
  // 标签和动作对不上的那一行已收口:onGoTap 与 onSheetGoTap 逐行同义,只留后者
  assert.doesNotMatch(wxml, /bindtap="onGoTap"/)
  assert.doesNotMatch(js, /^  onGoTap\(\) \{/m)
  assert.match(js, /onSheetGoTap\(\)/)
  // 失效行:原型是整行 opacity .42,不再逐个子元素改色
  assert.match(readXcx('style/proto-sheet.wxss'), /\.drow\.is-off\{ opacity:\.42/)
})

test('完成页明确显示通关状态并保留照片邮票', () => {
  const playWxml = readXcx('pages/play/index.wxml')
  const roamWxml = readXcx('pages/roam/index.wxml')

  // 2026-08-01:副文案改成称号式(优先显示累计里程碑),但「通关状态必须写在页面上」这条没变 ——
  // milestone 取不到时仍旧回落到 已通关/本章完成,这里连回落分支一起钉住,
  // 避免有人把回落删掉、让接口一挂完成页就不说自己完成没完成。
  assert.match(playWxml, /class="finsheet__result">\{\{milestone \? milestone\.title : \(allDone \? '已通关' : '本章完成'\)\}\}/)
  assert.match(playWxml, /class="finish-stamps"[\s\S]*?wx:for="\{\{finishPhotos\}\}"/)
  assert.match(roamWxml, /class="finish-stamps"[\s\S]*?wx:for="\{\{finish\.photos\}\}"/)
})

test('三模式完成卡继续使用真实腾讯地图展示完整路径', () => {
  const playWxml = readXcx('pages/play/index.wxml')
  const roamWxml = readXcx('pages/roam/index.wxml')

  assert.match(playWxml, /class="finsheet__map"[\s\S]*?<free-map[\s\S]*?map-polyline="\{\{fmPolyline\}\}"/)
  // roam 完成态已改半屏结算(Figma 3992:18005,无地图);路线预览由 C2 分享卡 archRoute 模板承载
  assert.match(roamWxml, /template name="archRoute"[\s\S]*?archSegs/)
})

test('主题游玩只在玩家开始或前往时请求定位，并保留扫码降级', () => {
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')
  const loadData = playJs.slice(playJs.indexOf('  loadData(first) {'), playJs.indexOf('  applyPreviewData(data) {'))
  const previewData = playJs.slice(playJs.indexOf('  applyPreviewData(data) {'), playJs.indexOf('  normNode('))

  assert.doesNotMatch(loadData, /initLocation\(|requestPlayLocation\(|wx\.getLocation/)
  assert.doesNotMatch(previewData, /initLocation\(|requestPlayLocation\(|wx\.getLocation/)
  assert.match(playJs, /startNav\(node\)\s*\{[\s\S]*?this\.requestPlayLocation\(\)/)
  assert.match(playJs, /onScanArrive\(\)\s*\{[\s\S]*?this\.scanArrive\(node\)/)
  assert.match(playJs, /content:\s*'仅在你主动开始游玩后/)
  assert.match(playWxml, /bindtap="onScanArrive"[^>]*aria-label="扫码到达"/)
})

test('主题游玩主数据加载在网络 reject 时落加载失败态而非死转 loading', () => {
  const playJs = readXcx('pages/play/index.js')
  const loadData = playJs.slice(playJs.indexOf('  loadData(first) {'), playJs.indexOf('  applyPreviewData(data) {'))
  // /api/play/nodes 被 reject(超时/断网/req 抛错)时必须有 .catch 落 emptyKind:'error',
  // 复用「重新加载」(reloadPlay)按钮;否则 .then 不执行、loading 永远为 true=白屏死转。
  assert.match(loadData, /\}\)\.catch\(/)
  assert.match(loadData, /\.catch\(\(\s*\w*\s*\)\s*=>\s*\{[\s\S]*?emptyKind:\s*'error'/)
  // 成功已落地时不覆盖首屏(2026-09-16),但每轮加载必须重新武装,否则第二轮的真失败会被上一轮的成功吃掉。
  assert.match(loadData, /_loadCommitted = false/)
})

test('队伍状态、终章故事和路线预览失败均有可见重试入口', () => {
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')
  const teamProgress = playJs.slice(playJs.indexOf('  loadTeamProgress() {'), playJs.indexOf('  _startLeadPoll() {'))
  const ending = playJs.slice(playJs.indexOf('  loadEnding() {'), playJs.indexOf('  retryEnding()'))

  assert.match(playJs, /leadLoadError/)
  assert.match(playJs, /retryLeadProgress\(\)/)
  assert.match(teamProgress, /const markLeadLoadFailure = \(\) => \{[\s\S]*?leadLoadError: true/)
  assert.match(teamProgress, /\.catch\(markLeadLoadFailure\)/)
  assert.match(playWxml, /leadLoadError[\s\S]*?bindtap="retryLeadProgress"/)
  assert.match(playJs, /endingError/)
  assert.match(playJs, /retryEnding\(\)/)
  assert.match(ending, /\.catch\(\(\) => \{[\s\S]*?endingError: true/)
  assert.match(playWxml, /endingError[\s\S]*?bindtap="retryEnding"/)
  assert.match(playJs, /finishSnapError/)
  assert.match(playJs, /retryRouteThumb\(\)/)
  assert.match(playWxml, /finishSnapError[\s\S]*?bindtap="retryRouteThumb"/)
})

test('城市定向把次级到达方式收进详情，并记录打卡网络失败', () => {
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')
  const arrive = playJs.slice(playJs.indexOf('  arrive(nodeId, via) {'), playJs.indexOf('  checkin(nodeId, code, source) {'))
  const checkin = playJs.slice(playJs.indexOf('  checkin(nodeId, code, source) {'), playJs.indexOf('  // ---------- 节点玩法 ----------'))

  assert.match(playWxml, /class="sheet-note"[\s\S]*?wx:if="\{\{!gpsOk\}\}" bindtap="onScanArrive"/)
  assert.match(playJs, /onLeftAction\(\)\s*\{[\s\S]*?if \(this\.data\.mode === 2\)[\s\S]*?this\.openEntryQr\(\)/)
  assert.match(arrive, /r\.netFail[\s\S]*?recordArrivalNetworkFailure/)
  assert.match(checkin, /r\.netFail[\s\S]*?recordArrivalNetworkFailure/)
})

test('自由探索把换点和完整地点列表收进详情，正常行走态不争夺主动作', () => {
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')

  assert.doesNotMatch(playWxml, /class="nextcard"/)
  // 2026-09-22 地点卡层删除后两个模式合成一条路:多章弹章节选择,否则回卡包。
  assert.match(playJs, /openStackOrChapters\(\)[\s\S]*?chapterCards\.length > 1[\s\S]*?chapterPick[\s\S]*?packOpen: true/)
  assert.match(playWxml, /mode==2 && !sheet\.node\.done[^>]*bindtap="openPoiFromSheet"/)
  assert.match(playJs, /openPoiFromSheet\(\)/)
  // 2026-08-12:mode2 的「完整地点列表」从地点卡层换成首屏六宫格(seatTiles 覆盖全部 nodes),
  // 所以「看看别家」的落点跟着改。这里钉死**落点仍然存在**,防止它退化成关掉半屏就什么都没有 ——
  // 原来只断言「入口在」,入口在但目的地被隐藏时会文本绿、行为死。
  assert.match(playJs, /openPoiFromSheet\(\)[\s\S]*?packOpen: true/)
  assert.match(playWxml, /class="fx-grid"[\s\S]*?wx:for="\{\{seatTiles\}\}"/)
})

test('任务中的扫码和照片上传失败留在任务层，并能原样重试', () => {
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')
  const checkin = playJs.slice(playJs.indexOf('  checkin(nodeId, code'), playJs.indexOf('  recordArrivalNetworkFailure'))
  const photo = playJs.slice(playJs.indexOf('  photoGame() {'), playJs.indexOf('  submitGame() {'))

  assert.match(playWxml, /gNetRetryable[\s\S]*?bindtap="retryGameSubmission"/)
  assert.match(checkin, /source === 'game'/)
  assert.match(checkin, /recordGameNetworkFailure/)
  assert.match(photo, /submitPhoto\(/)
  assert.match(playJs, /retryGameSubmission\(\)/)
})

test('完成节点照片通过腾讯地图原生 customCallout 回到地图', () => {
  const mapJs = readXcx('components/cy/free-map/index.js')
  const mapWxml = readXcx('components/cy/free-map/index.wxml')
  const playJs = readXcx('pages/play/index.js')
  const playWxml = readXcx('pages/play/index.wxml')

  assert.match(playJs, /imgUrl:\s*String\(x\.imgUrl\s*\|\|\s*''\)\.split\(','\)\[0\]/)
  assert.match(mapJs, /customCallout\s*=\s*\{\s*display:\s*'ALWAYS'/)
  assert.match(mapJs, /showPhotoCallouts:\s*\{\s*type:\s*Boolean,\s*value:\s*true\s*\}/)
  assert.match(mapWxml, /slot="callout"[\s\S]*?marker-id="\{\{item\.id\}\}"[\s\S]*?<cover-image/)
  assert.match(playWxml, /class="finsheet__map-native"[\s\S]*?show-photo-callouts="\{\{false\}\}"/s)
})

test('三模式新增共享层不重新引入竞品命名、字面字号或页面级色值', () => {
  const pauseStyle = readXcx('components/cy/play-pause/index.wxss')
  const playStyle = readXcx('pages/play/index.wxss')
  const roamStyle = readXcx('pages/roam/index.wxss')

  assert.doesNotMatch(pauseStyle, /font-size:\s*\d+rpx/)
  assert.doesNotMatch(playStyle, /Zenly|Strava/)
  assert.doesNotMatch(roamStyle, /FocusFlight/)
  const pageThemeOverride = /--cy-color-(?:bg-page|bg-surface|bg-surface-subtle|bg-elevated|bg-glass|text-inverse)\s*:\s*(?:#|rgba\()/i
  assert.doesNotMatch(playStyle, pageThemeOverride)
  assert.doesNotMatch(roamStyle, pageThemeOverride)
})

test('A01：首页城市事件入口及其数据请求已完整删除', () => {
  const indexWxml = readXcx('pages/index/index.wxml')
  const indexJs = readXcx('pages/index/index.js')
  const indexStyle = readXcx('pages/index/index.wxss')
  assert.doesNotMatch(indexWxml, /v3-city-events|v3-ce-/)
  assert.doesNotMatch(indexJs, /fetchCityEvent|goCityEvents|\/api\/official\/events/)
  assert.doesNotMatch(indexStyle, /\.v3-city-events|\.v3-ce-/)
})

test('新增游玩入口与失败提示使用既有间距 token', () => {
  const memberStyle = readXcx('pages/member/index/index.wxss')
  const playStyle = readXcx('pages/play/index.wxss')
  const journeyStyles = memberStyle.slice(memberStyle.indexOf('.pc-journey-hub'), memberStyle.indexOf('/* 探索值 */'))
  const arrivalStyle = playStyle.slice(playStyle.indexOf('.arrival-error{'), playStyle.indexOf('.banner{'))
  const spacingDeclaration = /(?:margin|padding|gap|min-height)\s*:\s*[^;{}]*\d+rpx/i

  assert.doesNotMatch(journeyStyles, spacingDeclaration)
  assert.doesNotMatch(arrivalStyle, spacingDeclaration)
})

test('自由漫游只在玩家点击出发后请求定位，玩法说明不自动弹但随时可重看', () => {
  const roamJs = readXcx('pages/roam/index.js')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const onLoad = roamJs.slice(roamJs.indexOf('  onLoad(q) {'), roamJs.indexOf('  onUnload() {'))
  const goStart = roamJs.slice(roamJs.indexOf('  goStart() {'), roamJs.indexOf('  _openRoamMap('))

  assert.doesNotMatch(onLoad, /wx\.getLocation/)
  // ★ 这里曾经还锁 /wx\.showModal/ —— 那是「怎么问」的实现细节,不是这条契约的意图。
  //   本页已改为不再自弹确认框:wx.getLocation 首次调用会触发微信自己的系统授权弹窗,
  //   那才是有效的明示同意,业务层再弹一层是重复问。契约的意图(进页不请求 / 点了才请求)
  //   由上下这两条守着,与用什么方式征得同意无关。
  assert.match(goStart, /wx\.getLocation/)
  // ⚠️ 但「取位之前必须先告知用途」这件事不能跟着弹窗一起消失。原弹窗 content 是唯一说明
  //   「记录本次足迹」的地方;删掉它之后,唯一的告知载体就是系统授权框读的 app.json desc,
  //   而漫游确实会把足迹落到 roam_reveals / roam_sessions。把意图从「弹窗」平移到「告知」。
  //   注:desc 的**存在性与 ≤30 字符**已由 scripts/wechat-release-contract.js 守着(改长了会 FAIL,
  //   本条最初就把它写成 38 字被那个门禁抓了),这里补的是它管不到的**覆盖面**。
  const appJson = JSON.parse(readXcx('app.json'))
  const locDesc = ((appJson.permission || {})['scope.userLocation'] || {}).desc || ''
  assert.ok(locDesc.length > 0, 'scope.userLocation.desc 不能为空:系统授权框会没有用途说明')
  assert.ok(locDesc.length <= 30, `desc 不得超过微信 30 字符上限(当前 ${locDesc.length})`)
  assert.match(locDesc, /足迹|已探索/, 'desc 必须覆盖漫游的真实用途(记录足迹/已探索区域),否则告知面窄于实际采集')
  assert.match(goStart, /_openRoamMap\(/)
  assert.match(roamJs, /const ROAM_INTRO_RULE_VERSION = /)
  assert.match(roamJs, /buildRoamIntroSeenKey\(\)/)
  assert.match(roamJs, /markRoamIntroSeen\(\)/)
  assert.match(roamJs, /openRoamLocationSetting\(\)/)
  // 走查 B04:进页不许自动弹玩法说明。负向断言 —— 谁把自动弹加回 onLoad 就红。
  assert.doesNotMatch(onLoad, /openScene\('roam-rules'\)/)
  // 不自动弹的前提是「随时看得到」:两个手动入口一个都不能少,少一个这条就红。
  assert.match(roamWxml, /class="go-side" bindtap="openRoamRules"[^>]*aria-label="查看自由漫游玩法说明"/)
  assert.match(roamWxml, /class="pcard__rules" catchtap="openRoamRules"[^>]*aria-label="查看玩法说明"/)
  assert.match(roamWxml, /bindtap="openRoamHistory"|bindtap="onPassportTileTap"[\s\S]*history/)
  assert.match(roamWxml, /<cy-state-shell[^>]*wx:if="\{\{introError\}\}"[^>]*bind:primary="openRoamLocationSetting"/s)
})

test('扫码被拒或相机异常时在原层说明失败并可重新打开扫码', () => {
  const playJs = readXcx('pages/play/index.js')
  const scanArrive = playJs.slice(playJs.indexOf('  scanArrive(node) {'), playJs.indexOf('  arrive(nodeId, via) {'))
  const scanGame = playJs.slice(playJs.indexOf('  scanGame() {'), playJs.indexOf('  photoGame() {'))
  const retryGame = playJs.slice(playJs.indexOf('  retryGameSubmission() {'), playJs.indexOf('  // ---------- 节点玩法 ----------'))

  assert.match(playJs, /function isScanCancelled\(error\)/)
  assert.match(scanArrive, /isScanCancelled\(error\)/)
  assert.match(scanArrive, /type: 'scan'/)
  assert.match(scanGame, /isScanCancelled\(error\)/)
  assert.match(scanGame, /type: 'gameScan'/)
  assert.match(retryGame, /attempt\.type === 'gameScan'/)
})

test('正常行走态保留城市定向更多层，漫游主操作直接浮在地图上', () => {
  const playWxml = readXcx('pages/play/index.wxml')
  const playJson = readXcx('pages/play/index.json')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const roamJson = readXcx('pages/roam/index.json')

  assert.match(playWxml, /class="pbar[^>]*\{\{sessionToolsOpen \? 'pbar--tools' : ''\}\}"[\s\S]*?class="tools" wx:if="\{\{sessionToolsOpen\}\}"/)
  assert.match(playWxml, /class="drow" bindtap="openJournalFromTools"/)
  assert.doesNotMatch(roamWxml, /roamToolsOpen|pbar--tools|class="tools"/)
  // 三键那一排不再挂 wx:else(暂停态也是它);主键 aria 里同时说明点按和长按
  // 2026-09-10 三键改口照原型:更多 / 暂停(长按结束) / 拍照。左右两端换了,中键不变。
  assert.match(roamWxml, /class="pbar__trio">[\s\S]*?aria-label="更多，打开工具抽屉"[\s\S]*?长按 3 秒结束本次漫游[\s\S]*?onRoamRightAction/)
  assert.equal(JSON.parse(playJson).usingComponents['cy-slide-confirm'], '/components/cy/slide-confirm/index')
  assert.equal(JSON.parse(roamJson).usingComponents['cy-slide-confirm'], '/components/cy/slide-confirm/index')
  assert.match(playWxml, /class="play-scene-host"[^>]*sceneCurrent && sceneCurrent\.id === 'play-activity-detail'/)
  assert.match(roamWxml, /class="roam-scene-host"[^>]*sceneCurrent && sceneCurrent\.id === 'roam-rules'/)
})

test('自由漫游会话内可重看规则，演示点只由开发环境闸门注入', () => {
  const roamJs = readXcx('pages/roam/index.js')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const initWorld = roamJs.slice(roamJs.indexOf('  _initWorld(c) {'), roamJs.indexOf('  _resolveNearbyReady() {'))
  const syncMarkers = roamJs.slice(roamJs.indexOf('  _syncMarkers() {'), roamJs.indexOf('  _syncSparkCircles() {'))
  const startVisit = roamJs.slice(roamJs.indexOf('  startVisit(e) {'), roamJs.indexOf('  /**\n   * 打卡上报'))

  assert.match(roamJs, /openRoamRules\(\)/)
  assert.match(roamJs, /sceneCurrent/)
  assert.match(roamJs, /requestSceneClose\(\)/)
  assert.match(roamWxml, /roam-scene-host[^>]*sceneCurrent && sceneCurrent\.id === 'roam-rules'/)
  // 2026-09-10 脱离 DS:半屏壳换成原型自己的 .psheet,断言跟着改 —— 断的仍是
  //   「规则那一屏挂在场景栈上、由真触发打开」,不是某个组件名。
  assert.match(roamWxml, /class="psheet [^"]*\{\{sceneIn \? 'is-in' : ''\}\}/)
  // 同上:关闭走的是本页的 onProtoSheetClose(能返回就返回上一层,否则 requestSceneClose,
  //   脏态确认仍归 requestSceneClose 管)。断的是「关闭真的接到场景栈上」。
  assert.match(roamWxml, /class="psheet__x"[^>]*catchtap="onProtoSheetClose"/)
  assert.match(initWorld, /selectDemoRoamPois\(getApp\(\), \[/)
  assert.match(initWorld, /\.map\(\(p\) => \(\{ \.\.\.p, demo: true/)
  assert.match(syncMarkers, /content: p\.demo \? '演示点 · 非真实\\n' \+ p\.name : p\.name/)
  assert.match(startVisit, /poi\.demo[\s\S]*?演示点仅供浏览/)
})

test('自由漫游的演示地标也明确为仅浏览，不伪装成真实地点', () => {
  const roamJs = readXcx('pages/roam/index.js')
  const roamWxml = readXcx('pages/roam/index.wxml')
  const checkNear = roamJs.slice(roamJs.indexOf('  _checkNear(p) {'), roamJs.indexOf('  onMarkerTap(e) {'))
  const markerTap = roamJs.slice(roamJs.indexOf('  onMarkerTap(e) {'), roamJs.indexOf('  onNearbySwipe(e) {'))
  const paceCard = roamJs.slice(roamJs.indexOf('  _paceCardFor(poi, patch) {'), roamJs.indexOf('  discoverRoamPoi(e) {'))

  assert.match(checkNear, /paceCard: this\._paceCardFor\(landmark\)/)
  assert.match(markerTap, /paceCard: this\._paceCardFor\(poi\)/)
  assert.match(paceCard, /demo: !!poi\.demo/)
  assert.match(roamWxml, /paceCard\.demo[\s\S]*?演示点 · 仅浏览（非真实地点）/)
})

// 「点亮坐标」是已点亮数,不是总数 —— 2026-08-01 修:原来两处都绑 total,
// 只完成 2/4 时显示 4,用户会以为自己全点亮了。通关卡和分享卡是同一个 bug 的两个出口,
// 分享卡那份还会被烤进图片传播出去,所以两处一起锁。
test('「点亮坐标」必须取已完成数(doneCount),部分完成时不得显示总数', () => {
  const wxml = readXcx('pages/play/index.wxml')
  const js = readXcx('pages/play/index.js')

  // ① 通关卡统计格:该格的数字必须是 doneCount
  const cell = wxml.match(/<view class="fst"><text class="fst__v">\{\{([a-zA-Z]+)\}\}<\/text><text class="fst__l">点亮坐标<\/text><\/view>/)
  assert.ok(cell, '找不到「点亮坐标」统计格')
  assert.equal(cell[1], 'doneCount', '「点亮坐标」绑的必须是 doneCount,不能是 total')

  // ② 分享卡 canvas:同一标签的同一口径
  assert.match(js, /\[String\(that\.data\.doneCount \|\| 0\), '点亮坐标'\]/,
    '分享卡的「点亮坐标」也必须取 doneCount —— 错数字会被烤进分享图')
  assert.doesNotMatch(js, /\[String\(that\.data\.total \|\| 0\), '点亮坐标'\]/)

  // ③ 行为口径:doneCount 只数 done 的节点(部分完成时必然 < total)
  assert.match(js, /doneCount: nodes\.filter\(\(n\) => n\.done\)\.length/)

  // ④ 「本章N处旧址已全部点亮」那句仍可用 total —— 它被 allDone 门控,此时 total===doneCount,
  //    不是同一个 bug,别顺手改错。门控现在走 HUD 槽位(hud-slots.wxs BOTTOM_CARD),
  //    所以这里断言「这句话只在 banner 槽里出」+「banner 槽的判据确实是 allDone」,
  //    而不是抄一遍 wx:if 的字面量(字面量一变就假红,且证明不了门还在)。
  // 2026-08-15 F3:banner 文案改为按 mode 三元(探店日不再念「旧址点亮」),
  // 契约意图不变 —— 全量口径的那句话仍只出现在 allDone 门控的 banner 槽里,且仍用 total。
  assert.match(wxml, /=== 'banner'\}\}"[\s\S]{0,260}本章' \+ total \+ '处旧址已全部点亮/)
  assert.match(readXcx('utils/wxs/hud-slots.wxs'), /banner:\s*!screen && !!allDone/)
})

test('负控:「点亮坐标」退回 total 时上面那条契约必须判红', () => {
  const wxml = readXcx('pages/play/index.wxml')
  const mutated = wxml.replace(
    '<view class="fst"><text class="fst__v">{{doneCount}}</text><text class="fst__l">点亮坐标</text></view>',
    '<view class="fst"><text class="fst__v">{{total}}</text><text class="fst__l">点亮坐标</text></view>')
  assert.notEqual(mutated, wxml, '负控必须真的把绑定改回 total')
  const cell = mutated.match(/<view class="fst"><text class="fst__v">\{\{([a-zA-Z]+)\}\}<\/text><text class="fst__l">点亮坐标<\/text><\/view>/)
  assert.ok(cell)
  // 断言「上面那条契约会判红」，判据是抛出 AssertionError 本身，不是它的消息文案。
  // 2026-08-27:原来写的是 /doneCount|total/ 去匹配 Node 内部的错误消息 —— 那串文案
  // 随 Node 小版本变化(22.22 带实际值、22.23 起改成 "Expected values to be strictly
  // equal:"),于是同一份代码换个 runtime 小版本就翻车,而 4559 个用例里只有这一处这样。
  // 本仓其余负控(title-system-owner / ui-token-funds / form-state 等)一律用
  // assert.AssertionError,这里对齐。
  assert.throws(() => assert.equal(cell[1], 'doneCount'), assert.AssertionError)
  // 再钉一次业务语义:变异后就该是 total,这才是「上面那条契约会红」的实际原因。
  assert.equal(cell[1], 'total')
})
