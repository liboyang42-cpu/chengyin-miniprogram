// v5.1/v5.2 新玩法组件契约(Figma 组件库 v5.1 node 45:248 / v5.2 node 64:304)
//
// 两件事各测一遍,因为它们坏起来的样子完全不同:
//   ① 各组件的纯算法(倒计时 / 环形分段 / 千分位 / 图鉴空槽)—— 算错了是显示错数字,静默;
//   ② 分发器契约 —— 白名单里加了一种玩法但 wxml 没分发、或组件没注册,弹窗会一声不响不出现。
//      ② 才是这套结构真正容易烂的地方:九个分支抄下来,漏一个不会报错。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 载入组件定义:stub 掉 Component 拿到 options,不复制一份实现到测试里。
 *  ⚠️ Behavior 也要 stub:2026-08-27 玩法壳接 reduced-motion behavior 之后,
 *  behaviors/reduced-motion.js 在**模块加载时**就调 Behavior(),node 里没有它 ——
 *  少这一行,五个壳的纯算法用例会一起报 ReferenceError,而报错点在 behavior 文件里,
 *  看上去像 behavior 坏了,其实是测试宿主没提供这个全局。
 *  (仓内 remaining-scene-state / celebration-feedback 两处已是同一手法) */
function loadComponent(rel) {
  const abs = path.join(ROOT, rel)
  const prev = global.Component
  const prevBehavior = global.Behavior
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prev
    global.Behavior = prevBehavior
  }
  assert.ok(captured, rel + ' 必须调用 Component()')
  return captured
}

const methodsOf = (rel) => {
  const c = loadComponent(rel)
  assert.ok(c.methods, rel + ' 应有 methods(纯算法经 methods 暴露供本契约验证)')
  return c.methods
}

test('ring-meter:百分比 → 点亮段数与角度', () => {
  const build = methodsOf('pages/play/components/ring-meter/index.js')._buildSegments

  const zero = build(0, 40)
  assert.equal(zero.length, 40)
  assert.equal(zero.filter((s) => s.on).length, 0, '0% 一段都不该亮')

  const full = build(100, 40)
  assert.equal(full.filter((s) => s.on).length, 40, '100% 必须整圈亮')

  // 1% 也要亮一段:走了 60 步却画成"还没开始"是最伤的那种静默错
  assert.equal(build(1, 40).filter((s) => s.on).length, 1)

  assert.equal(build(50, 40).filter((s) => s.on).length, 20)
  // 超过 100 不许绕第二圈
  assert.equal(build(180, 40).filter((s) => s.on).length, 40)

  const degs = build(100, 4).map((s) => s.deg)
  assert.deepEqual(degs, [0, 90, 180, 270], '段角度必须均分整圈')
})

test('timewindow:剩余秒 → HH:MM:SS,负数归零', () => {
  const fmt = methodsOf('pages/play/components/playkit-timewindow/index.js')._formatClock
  assert.equal(fmt(13282), '03:41:22')   // 稿 45:301 的示例值
  assert.equal(fmt(0), '00:00:00')
  assert.equal(fmt(-5), '00:00:00', '负剩余不能显示成 -1:59:59')
  assert.equal(fmt(NaN), '00:00:00')
  assert.equal(fmt(59), '00:00:59')
})

test('silentorder:已表演时长只进位到分', () => {
  const fmt = methodsOf('pages/play/components/playkit-silentorder/index.js')._formatElapsed
  assert.equal(fmt(84), '01:24')          // 稿 46:316 的示例值
  assert.equal(fmt(0), '00:00')
  assert.equal(fmt(3661), '61:01', '超过一小时继续累加分钟,不悄悄回绕')
})

test('steps:千分位与封顶百分比', () => {
  const m = methodsOf('pages/play/components/playkit-steps/index.js')
  assert.equal(m._groupThousands(4286), '4,286')
  assert.equal(m._groupThousands(6000), '6,000')
  assert.equal(m._groupThousands(0), '0')
  assert.equal(m._groupThousands(-3), '0')

  assert.equal(m._stepPercent(4286, 6000), 71)
  assert.equal(m._stepPercent(9000, 6000), 100, '超额不画成 150%')
  assert.equal(m._stepPercent(100, 0), 0, '目标缺失时不能除零')
})

test('musiccorner:播放进度 → 点亮波形条数', () => {
  const lit = methodsOf('pages/play/components/playkit-musiccorner/index.js')._litBarCount
  assert.equal(lit(0, 206, 17), 0)
  assert.equal(lit(206, 206, 17), 17)
  assert.equal(lit(103, 206, 17), 9)
  assert.equal(lit(10, 0, 17), 0, '时长未知时不能按 0 除')
})

test('分发器契约:白名单每种玩法都真有组件、真被注册、真被分发', () => {
  const types = methodsOf('pages/play/components/playkit/index.js')._kitTypes()
  assert.ok(types.length >= 9, '至少覆盖稿里落到小程序的九种玩法壳')

  const wxml = read('pages/play/components/playkit/index.wxml')
  const json = JSON.parse(read('pages/play/components/playkit/index.json'))
  const registered = Object.values(json.usingComponents || {})

  types.forEach((type) => {
    // ① wxml 里必须有这一支的判断,否则后端下发了这种 type 会静默什么都不显示
    assert.ok(
      wxml.includes("kit.type === '" + type + "'"),
      'playkit/index.wxml 缺少 ' + type + ' 的分发分支'
    )
  })

  // ② 注册的每个组件路径都要真存在(路径写错在真机上是空白,不报错)
  registered.forEach((rel) => {
    const abs = path.join(ROOT, rel.replace(/^\//, '') + '.js')
    assert.ok(fs.existsSync(abs), '分发器注册了不存在的组件:' + rel)
  })
  /* 同一种玩法按模式分到另一屏的,在这里记账:它们不是新的 kit 类型,wxml 里挂在同一个 type 的分支下。 */
  const VARIANT_SCREENS = {
    '/pages/play/components/playkit-objectcard/index': 'photocheck 的 mode=CARD(拍物成卡):取景 → 点阵消散 → 信息卡',
  }
  Object.keys(VARIANT_SCREENS).forEach((rel) => assert.ok(registered.includes(rel), '记了账却没注册:' + rel))
  assert.equal(registered.length, types.length + Object.keys(VARIANT_SCREENS).length,
    '注册数必须 = 白名单数 + 记账的模式分屏,不许多也不许少')
})

test('play 页接线:入口、分发器、氛围件都真挂在 wxml 上', () => {
  const wxml = read('pages/play/index.wxml')
  const json = JSON.parse(read('pages/play/index.json'))
  const js = read('pages/play/index.js')

  assert.ok(json.usingComponents['cy-playkit'], 'play 页必须注册 cy-playkit')
  assert.ok(wxml.includes('<cy-playkit '), '分发器必须真渲染在 play 页上,否则组件是死代码')
  assert.ok(wxml.includes('bind:kitaction="onPlayKitAction"'), '玩法事件必须有页面接手')
  assert.ok(/onPlayKitAction\s*\(/.test(js), 'onPlayKitAction 必须在页面 js 里真存在')

  // 玩法整块由**服务端会话视图**驱动。第一版这里挂的是 node.playKit —— 那个字段是前端自己
  // 造的,后端根本没有;现在改成 cy-advanced-game 抛上来的权威视图(见 utils/playkit-view.js)。
  assert.ok(
    wxml.includes('bind:session="onAdvancedSession"'),
    'cy-advanced-game 必须把会话视图抛给页面,否则玩法永远不会出现'
  )
  assert.ok(/onAdvancedSession\s*\(/.test(js), 'onAdvancedSession 必须真存在')
  assert.ok(
    !wxml.includes('sheet.node.playKit'),
    '不能再依赖 node.playKit —— 那是前端造的字段,服务端不下发它'
  )
  // 提交必须委托组件:页面自己再发一份会和组件的 version 漂移
  assert.ok(
    /selectComponent\('#advancedGame'\)/.test(js),
    '玩法动作必须委托 cy-advanced-game 发(幂等键与 CAS 都在它那里)'
  )
  // 计步的顺序不能调换:必须先 wx.login 再 getWeRunData,否则 session_key 不新鲜、服务端解不开
  const stepsBlock = js.slice(js.indexOf('_submitSteps()'))
  assert.ok(
    stepsBlock.indexOf('wx.login') < stepsBlock.indexOf('getWeRunData'),
    '必须先 wx.login 再 getWeRunData'
  )
  // 音频归页面持有,页面卸载必须销毁,否则背景里一直在放
  assert.ok(
    /onUnload\(\)[\s\S]*?_kitAudio[\s\S]*?destroy\(\)/.test(js),
    'onUnload 必须销毁玩法音频'
  )
})

test('AI 参考分不是孤儿:有渲染位,也有生产代码真给它赋值', () => {
  // 这条是审出来的:第一版把卡挂在拍照任务屏,而那屏上传成功就走 onComplete 收掉,
  // 加上没有任何 setData 写过这个字段 —— wx:if 永远不成立,是个看着做完了的空壳。
  const wxml = read('pages/play/index.wxml')
  const js = read('pages/play/index.js')

  assert.ok(wxml.includes('<cy-ai-score-card '), 'AI 参考分必须真渲染在 play 页上')
  assert.ok(
    wxml.includes('wx:if="{{sheet.node.aiScore}}"'),
    'AI 参考分挂在节点卡上(任务屏没有能看见它的时机)'
  )
  assert.ok(/_applyAiScore\s*\(nodeId, data\)/.test(js), '必须有把回执里的分写进节点的方法')
  assert.ok(
    /that\._applyAiScore\(nodeId, r\.data\)/.test(js),
    '照片上传成功回调必须调用它 —— 否则这张卡没有任何数据来源'
  )
})
