const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => readResolved(file)

test('Play 与 Roam 接入共享状态及共享动效偏好', () => {
  const playJs = read('pages/play/index.js')
  const playWxml = read('pages/play/index.wxml')
  const playWxss = read('pages/play/index.wxss')
  const roamJs = read('pages/roam/index.js')
  const roamWxml = read('pages/roam/index.wxml')
  const roamWxss = read('pages/roam/index.wxss')

  assert.match(playJs, /require\('\.\.\/\.\.\/utils\/play-state-contract\.js'\)/)
  assert.match(playJs, /require\('\.\.\/\.\.\/utils\/motion-preference\.js'\)/)
  // 根节点后来又挂了别的条件 class(如剧情叙事页打开时的 play--scaled),
  // 所以不再钉整个 class 串,只钉「reducedMotion 确实接在根节点上」这件事本身。
  assert.match(playWxml, /class="play [^"]*\{\{reducedMotion \? 'play--reduced-motion' : ''\}\}/)
  assert.match(playWxml, /reduced-motion="\{\{reducedMotion\}\}"/)
  // 2026-09-09:动态效果那一行从「箭头 + bindtap」改成抽屉里的真开关(先是 cy-switch 的
  // bindchange,照原型搬之后换成原型自己那枚 .dsw 药丸,回到 catchtap)。
  // 这条要守的是「页面里翻得动动态效果」,不是它长成哪种控件。
  assert.match(playWxml, /(?:bindchange|catchtap)="toggleReducedMotion"/)
  assert.match(playWxss, /\.play--reduced-motion/)
  // 2026-08-06 用户裁决:起飞过场删除,开场=章节过场直接落地图;不得回流
  assert.doesNotMatch(playJs, /playStartFlight/)

  assert.match(roamJs, /require\('\.\.\/\.\.\/utils\/play-state-contract\.js'\)/)
  assert.match(roamJs, /require\('\.\.\/\.\.\/utils\/motion-preference\.js'\)/)
  assert.match(roamWxml, /class="roam [^"]*\{\{reducedMotion \? 'roam--reduced-motion' : ''\}\}/)
  assert.match(roamWxml, /accessibility-label="\{\{roamMapA11y\}\}"/)
  assert.match(roamWxml, /class="pcard__head pcard__head--goal" bindtap="onGoalTap"/)
  assert.match(roamWxss, /\.roam--reduced-motion/)
  /* ⚠️ 这一条原来断言的是 `bottom:calc(var(--cy-tabbar-h) ... padding-bottom:env(safe-area-inset-bottom)`,
     而那两样早就被删了 —— 它一直是靠**注释里复述的那段文字**匹配上的,是条假绿。
     2026-09-11 改成断言真声明:地图屏没有 tabBar(它只在起始页渲),所以底栏照原型取
     bottom 20px = 38rpx,安全区只出现一次(别再把安全区算两遍)。 */
  const pbarRule = /\.pbar\{[^}]*\}/.exec(roamWxss.replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(pbarRule, '找不到 .pbar 规则')
  assert.match(pbarRule[0], /bottom:calc\(38rpx \+ env\(safe-area-inset-bottom\)\)/,
    '底栏照原型 .trio 的 bottom 20px,不再给不存在的 tabBar 让位')
  assert.doesNotMatch(pbarRule[0], /--cy-tabbar-h/, '地图屏没有 tabBar,不该给它让位')
  assert.equal((pbarRule[0].match(/env\(safe-area-inset-bottom\)/g) || []).length, 1,
    '安全区只能出现一次 —— 两处相加就是把它算了两遍')
  assert.match(roamJs, /if \(reducedMotion && this\._zoomAnim\)/)
  assert.match(roamJs, /mapScale: this\._zoomTarget\.scale/)
})

test('共享地图把状态语义、读屏与减少动效落实到组件边界', () => {
  const mapJs = read('components/cy/free-map/index.js')
  const mapWxml = read('components/cy/free-map/index.wxml')
  const roamJs = read('pages/roam/index.js')

  assert.match(mapJs, /require\('\.\.\/\.\.\/\.\.\/utils\/play-state-contract\.js'\)/)
  assert.match(mapJs, /accessibilityLabel:\s*\{\s*type:\s*String/)
  assert.match(mapJs, /reducedMotion:\s*\{\s*type:\s*Boolean/)
  assert.match(mapJs, /getPlayMapState\(/)
  assert.match(mapWxml, /aria-role="img"/)
  assert.match(mapWxml, /aria-label="\{\{accessibilityLabel\}\}"/)
  assert.match(roamJs, /getRoamPoiState/)
  assert.match(roamJs, /this\._icons\['state-' \+ state\]/)
  assert.match(roamJs, /STATUS_MARKER_ID/)
  assert.match(roamJs, /this\.setData\(\{ goal \}, \(\) => this\._syncMarkers\(\)\)/)
})

test('玩家与商家一级导航未选统一黑白、选中统一品牌紫(UI-03)', () => {
  const tabJs = read('components/tabBar/index.js')
  // 断言的是"代码里没有商家例外",不是"文中没提过这个词"——注释里正解释着这道闸为何被删,
  // 不剥注释会被自己的说明文字判红(2026-08-01 实际踩到)。
  const tabWxml = read('components/tabBar/index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  const tabWxss = read('components/tabBar/index.wxss')
  const homeWxml = read('pages/index/index.wxml')
  const roamWxml = read('pages/roam/index.wxml')
  const memberWxml = read('pages/member/index/index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  const memberWxss = read('pages/member/index/index.wxss')

  // 2026-08-01 合并批3+批7 两条同向修复,两边断言都保留:
  //  · 批3:默认值必须是 true —— 覆盖 template/talent-list 这类从来没传过 monochrome 的玩家页
  //  · 批7:mode==='merchant' 时强制叠加黑白 —— 商家即便被显式传 false 也拉不回紫
  assert.match(tabJs, /monochrome:\s*\{\s*type:\s*Boolean,\s*value:\s*true\s*\}/)
  assert.match(tabWxml, /\{\{\(monochrome \|\| mode === 'merchant'\) \? 'monochrome' : ''\}\}/)
  assert.match(
    tabWxml,
    /\{\{\(monochrome \|\| mode === 'merchant'\) \|\| index !== active \? item\.iconPath : item\.selectedIconPath\}\}/,
    '选中图标也必须走同一条判定,否则商家/玩家会各走各的资源',
  )
  // 批3 那条反向守卫保留:防止有人把方向搞反的 mode !== 'merchant' 例外闸再加回来
  assert.doesNotMatch(
    tabWxml,
    /mode !== 'merchant'/,
    '不得再出现 mode !== \'merchant\' 例外闸:那是把商家保护成紫色,方向反了',
  )
  assert.match(tabWxml, /aria-label="\{\{index === active \? '当前' \+ item\.text : '前往' \+ item\.text\}\}"/)
  assert.match(tabWxss, /\.tabbar\.monochrome/)
  // 2026-09-18 用户走查 UI-03:未选仍是黑白明度,选中统一品牌紫 —— 玩家/商家同一条滤镜链,
  // 不再出现「商家选中黑、玩家选中紫」的分叉。滤镜链输出色逐通道实算 = #7A5CFF。
  const ruleBody = (selector) => {
    const start = tabWxss.indexOf(selector)
    assert.ok(start >= 0, `缺少选中态规则 ${selector}`)
    return tabWxss.slice(start, tabWxss.indexOf('}', start))
  }
  const purple = /filter:\s*brightness\(0\) invert\(37%\) sepia\(10%\) saturate\(10000%\) hue-rotate\(206deg\) brightness\(125%\) contrast\(80%\)/
  assert.match(ruleBody('.tabbar.monochrome .list .ul .li.active .tabbar__icon'), purple, '浅端选中必须是品牌紫')
  assert.match(ruleBody('.tabbar.monochrome.dark .list .ul .li.active .tabbar__icon'), purple, '深端选中必须是同一品牌紫')
  assert.match(ruleBody('.tabbar.monochrome.dark .list .ul .li .tabbar__icon'), /filter:\s*grayscale\(1\) brightness\(0\) invert\(1\)/, '未选在深端仍是白明度')
  assert.match(homeWxml, /<tabBar[^>]*monochrome="\{\{true\}\}"/)
  assert.match(roamWxml, /<tabBar[^>]*monochrome="\{\{true\}\}"/)
  // 2026-08-04 用户拍板:共用的 member 主页不算「玩家内容页」,商家态回到白色(theme-merchant)。
  // 这推翻了 #510 把它一刀切成深色的做法;8-03 拍板①「玩家内容页全深色」的射程只到俱乐部/广场
  // 这类纯玩家页,不含本页。深色仍是玩家态唯一形态,所以两侧都钉。
  assert.match(memberWxml, /<view class="pc-page \{\{isMerchantView \? 'pc-merchant theme-merchant' : 'pc-player'\}\} \{\{isSelf \? 'pc-self' : 'pc-public'\}\} \{\{reducedMotion \? 'pc-reduced-motion' : ''\}\}">/,
    'member home must switch light(merchant)/dark(player) by identity, not hardcode either side')
  // 原为 monochrome="{{!isMerchantView}}" —— 商家态求值成 false,会绕过组件默认值继续拿紫色选中图,
  // 正是总控实拍在 member/index?mode=merchant 上看到的那个紫。删掉该属性改为继承默认 true,
  // 所以这里反过来断言"本页不许再显式传 monochrome"。
  assert.doesNotMatch(
    memberWxml,
    /<tabBar[^>]*monochrome=/,
    'member/index 不得显式传 monochrome:商家态传 false 会把紫色选中图放回来',
  )
  assert.match(memberWxss, /\.pc-player/)
})

test('减少动态偏好跨常驻页与自定义组件边界同步', () => {
  const behavior = read('behaviors/reduced-motion.js')
  const starJs = read('components/cy/starfield/index.js')
  const starWxss = read('components/cy/starfield/index.wxss')
  const sheetWxml = read('components/cy/sheet/index.wxml')
  const sheetWxss = read('components/cy/sheet/index.wxss')
  const pauseWxml = read('components/cy/play-pause/index.wxml')
  const tabWxml = read('components/tabBar/index.wxml')
  const playWxml = read('pages/play/index.wxml')
  const roamWxml = read('pages/roam/index.wxml')

  assert.match(behavior, /pageLifetimes:\s*\{\s*show\(\)/)
  assert.match(behavior, /readReducedMotion\(\)/)
  assert.match(starJs, /reduced-motion\.js/)
  assert.doesNotMatch(starWxss, /rgba\((60,120,255|255,72,96|255,120,90),/)
  assert.match(sheetWxml, /sh--reduced-motion/)
  assert.match(sheetWxss, /\.sh--reduced-motion/)
  assert.match(pauseWxml, /play-pause--reduced-motion/)
  assert.match(tabWxml, /tabbar--reduced-motion/)
  // 2026-09-11 游玩页的半屏也脱离了 DS 壳:减少动态由原型壳自己的 is-reduced 承担,
  // 与漫游同一条(下面那句注释讲的就是这件事)。
  assert.match(playWxml, /class="psheet [^"]*\{\{reducedMotion \? 'is-reduced' : ''\}\}"/)
  // 2026-09-10 漫游四模式按用户裁决脱离小程序 DS:半屏不再套 cy-scene-sheet,
  //   减少动态的接线也从「传给组件」变成「页面自己那层壳吃这个 class」。
  //   断的还是同一件事 —— 这一层必须真的认减少动态,不是换壳时顺手丢掉。
  // 2026-09-11 那层壳抽成了共用件(组局页也要用同一件),样式从 style/proto-sheet.wxss 来。
  const protoSheet = read('style/proto-sheet.wxss')
  assert.match(roamWxml, /class="psheet [^"]*\{\{reducedMotion \? 'is-reduced' : ''\}\}/)
  assert.match(roamWxml, /class="pdim [^"]*\{\{reducedMotion \? 'is-reduced' : ''\}\}/)
  assert.match(protoSheet, /\.psheet\.is-reduced\{[^}]*transform:none/)
  // 组局页用的是同一件,同样得认减少动态
  assert.match(read('subpackageRoam/nearby/index.wxml'), /class="psheet [^"]*\{\{reducedMotion \? 'is-reduced' : ''\}\}/)
  assert.match(playWxml, /<cy-fragment[^>]*reduced-motion="\{\{reducedMotion\}\}"/)
  assert.match(playWxml, /<cy-slide-confirm[^>]*reduced="\{\{reducedMotion\}\}"/)
  // 首次发现仪式卡同上:从 cy-sheet 换成原型壳,减少动态由 is-reduced 承担(上面已断言)。
  assert.match(roamWxml, /<cy-slide-confirm[^>]*reduced="\{\{reducedMotion\}\}"/)
  assert.match(roamWxml, /<tabBar[^>]*reduced-motion="\{\{reducedMotion\}\}"/)
})
