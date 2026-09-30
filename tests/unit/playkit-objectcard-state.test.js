/* 拍物成卡那一屏的状态:只桩微信 API,方法走真的。
 * ① 卡只在判过那一次回包里有,之后任何回读都不带 —— 信息卡一旦出来,不许被下一次会话视图清掉;
 * ② 回看一段已经判过、但手里没有卡(回读过)的:只说「这张过了」,不能又打开相机让人重拍;
 * ③ 减弱动态效果:不转菊花。 */
const assert = require('node:assert/strict')
const test = require('node:test')

const PATH = require.resolve('../../pages/play/components/playkit-objectcard/index.js')
let definition
{
  const prev = global.Component
  global.Component = (o) => { definition = o }
  global.wx = global.wx || {}
  delete require.cache[PATH]
  require(PATH)
  global.Component = prev
}

function make(props) {
  const inst = {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)),
      { show: true, tries: 0, passed: false, flagged: false, degraded: false, fallback: 'retake', lastReason: '',
        card: null, place: '', photoFailSeq: 0 }, props || {}),
    setData(u, cb) { Object.assign(this.data, u); if (cb) cb() },
    triggerEvent() {},
    createSelectorQuery() { throw new Error('no canvas in unit test') },
    _timers: [],
  }
  Object.assign(inst, definition.methods)
  return inst
}
const CARD = { title: '半个牛油果', category: '食物饮料', cutoutUrl: 'https://c/x.png', sourceUrl: 'https://c/p.jpg', frames: ['https://c/p.jpg'] }

test('★信息卡出来之后,下一次会话视图不带卡也不许把它清掉', () => {
  const oc = make({ passed: true, card: CARD })
  oc._showInfo(true)
  assert.equal(oc.data.cardView, CARD)
  oc.data.card = null                     // 回读 / 下一次会话视图:没有 objectCard
  oc._maybeResult()
  assert.equal(oc.data.cardView, CARD, '信息卡被清空了,玩家眼前的名称/分类一下子没了')
  assert.equal(oc.data.phase, 'info')
  oc._timers.forEach(clearTimeout)
})

test('★回看已判过但手里没卡的一段:只说这张过了,不重开相机', () => {
  const oc = make({ passed: true, card: null })
  oc._enter()
  assert.equal(oc.data.phase, 'note')
  assert.equal(oc.data.head, '这张过了')
})

test('减弱动态效果:处理中不转菊花(不起定时器)', () => {
  const oc = make({ reducedMotion: true })
  oc._startSpin()
  const started = !!oc._spinTimer
  oc._stopSpin()
  assert.equal(started, false, '减弱动态效果下还在转')
})

test('★预览里按快门:不开相机、不抛 shoot、不进处理中 —— 预览没有会话,进了就干等 45 秒', () => {
  const prevWx = global.wx
  let cameraUsed = false
  global.wx = Object.assign({}, prevWx, {
    createCameraContext() { cameraUsed = true; return { takePhoto() {} } },
    chooseMedia() { cameraUsed = true },
    showToast() {},
  })
  try {
    const events = []
    const oc = make({ preview: true })
    oc.triggerEvent = (name) => events.push(name)
    oc._openCam()
    oc.onShutter()
    oc.onAlbum()
    assert.equal(cameraUsed, false, '预览里真去拍了')
    assert.deepEqual(events, [], '预览里抛了 shoot')
    assert.equal(oc.data.phase, 'cam')
  } finally {
    global.wx = prevWx
  }
})
