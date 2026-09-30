/* 竞猜:押完之后那句「什么时候截止、答案谁给」
 *
 * 这一行是这屏押完之后唯一的交代 —— 它空了不会报错、不会掉布局,
 * 只是玩家押完之后什么也没被告知。2026-09-15 之前它在真机上恒为空:
 * kit 要 closeMode/closeDays,而配置、校验、后端投影、pickPlayKit 产出的都是 closeAtHour。
 */
const assert = require('node:assert/strict')
const test = require('node:test')

/** 在 node 里把这个组件的定义抓出来:补三个小程序全局,不引真运行时 */
function loadConfig() {
  const path = require('node:path')
  const file = path.resolve(__dirname, '../../pages/play/components/playkit-predict/index.js')
  const prev = { Behavior: global.Behavior, Component: global.Component, wx: global.wx }
  let captured = null
  global.Behavior = (behavior) => behavior
  global.Component = (config) => { captured = config }
  global.wx = global.wx || {}
  try {
    delete require.cache[require.resolve(file)]
    require(file)
  } finally {
    Object.assign(global, prev)
  }
  return captured
}

/** 跑一次「显示」观察器,把 waitLabel 算出来 */
function waitLabelFor(closeAtHour, revealDays, revealHour) {
  const config = loadConfig()
  const key = Object.keys(config.observers).find((name) => name.includes('closeAtHour'))
  assert.ok(key, '观察器必须盯着 closeAtHour —— 不盯它就等于又回到 closeMode 那条死路')
  const ctx = {
    data: Object.assign({}, config.data, {
      options: [{ key: 'A', label: '手冲' }], reducedMotion: true, closeAtHour: closeAtHour,
      revealDays: revealDays === undefined ? -1 : revealDays,
      revealHour: revealHour === undefined ? -1 : revealHour,
    }),
    setData(patch) { Object.assign(this.data, patch) },
    _paint() {}, _stop() {}, _spin() {},
  }
  config.observers[key].call(ctx, true)
  return ctx.data.waitLabel
}

test('★押完之后告诉玩家今天几点截止,而且补零', () => {
  assert.equal(waitLabelFor(9), '今天 09:00 截止,之后由商家给出答案。')
  assert.equal(waitLabelFor(20), '今天 20:00 截止,之后由商家给出答案。')
})

test('★配了揭晓时间就照原型把两件事都说出来', () => {
  // 原型:「第 N 天揭晓,由商家给出答案。」这里把收注截止也说上 —— 少了它玩家不知道还能不能押
  assert.equal(waitLabelFor(20, 1, 20), '今天 20:00 截止,明天 20:00 由商家给出答案。')
  assert.equal(waitLabelFor(20, 0, 22), '今天 20:00 截止,今天 22:00 由商家给出答案。')
  assert.equal(waitLabelFor(9, 2, 18), '今天 09:00 截止,后天 18:00 由商家给出答案。')
  assert.equal(waitLabelFor(9, 5, 18), '今天 09:00 截止,第 5 天 18:00 由商家给出答案。')
})

test('没配揭晓时间就只说截止 —— 不替商家许一个时间', () => {
  assert.equal(waitLabelFor(20), '今天 20:00 截止,之后由商家给出答案。')
  assert.ok(!waitLabelFor(20).includes('揭晓'))
})

test('没有可信的截止点就一个字都不写 —— 宁可不写,也不编一个', () => {
  for (const bad of [-1, 24, 8.5, NaN, undefined, null, '', '晚上']) {
    assert.equal(waitLabelFor(bad), '', '越界/非整点的 ' + String(bad) + ' 不该被说出来')
  }
})

test('揭晓时间自己越界时,截止那半句照说,不整句作废', () => {
  assert.equal(waitLabelFor(20, 31, 20), '今天 20:00 截止,之后由商家给出答案。')
  assert.equal(waitLabelFor(20, 1, 24), '今天 20:00 截止,之后由商家给出答案。')
})

test('只有揭晓时间、没有截止点时,也能把揭晓说出来', () => {
  assert.equal(waitLabelFor(-1, 1, 20), '明天 20:00 由商家给出答案。')
})
