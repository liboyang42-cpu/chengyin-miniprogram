/* 转台藏品卡 · 判过当场看到卡的接线(施工文档第三版 §2.2 / §3.3 / §3.4)
 *
 * 这张卡有两条到玩家眼前的路,少一条都缺一半:
 *   事后翻 = 藏品册那一页;当场看 = 判过这一次的回包(view.objectCard)。
 * 后端铸卡挂在提交之后,客户端手上**只有这一次回包** —— 投影漏一环,
 * 当场那一屏就永远不出卡,而且不报错(册子里照样翻得到,没人会怀疑玩法这一屏坏了)。
 * 所以这里从「kit 有没有把卡搬过来」一路钉到「组件的 WXML 到底渲不渲」。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js')

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const at = (h, m) => new Date(2026, 8, 22, h, m, 0)

/** 后端 objectCard 回执的确切形状 = PlayerObjectCardVO 的字段(改名一处,两头都要红)。 */
const RECEIPT = {
  id: 61,
  sourceUrl: '/profile/upload/shell.jpg',
  title: '一枚弹壳',
  caption: '把窗框也拍进去',
  cardStyle: 'plain',
  originType: 'PLAY',
  originId: '29',
  createTime: 1790000000000,
  genStatus: 'NONE',
  frames: ['/profile/upload/shell.jpg'],
}
const PREFIX = 'https://cdn.chengyinhub.com/profile/upload/card-frames/61/'
const FRAMES_24 = Array.from({ length: 24 }, (_, i) => PREFIX + String(i).padStart(2, '0') + '.webp')

const SEG = { title: '捡一件东西', passed: true, mode: 'CARD', cardTitle: '一枚弹壳', cardStyle: 'plain' }

const kitOf = (state) => pickPlayKit(state, at(12, 0))

test('★判过 + 回包带卡:kit 里就有一张能直接喂给 cy-spin-card 的卡', () => {
  const kit = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG }, objectCard: RECEIPT })
  assert.ok(kit, 'photoCheck 段该出 kit')
  assert.equal(kit.type, 'photocheck')
  assert.ok(kit.card, '回包带了卡而 kit.card 是空的 —— 当场那一屏永远不会出卡,且没有任何报错')
  assert.deepEqual(kit.card.frames, RECEIPT.frames, '帧清单照搬后端 VO,不在客户端另算')
  assert.equal(kit.card.generating, false)
  assert.equal(kit.card.cutoutUrl, null, '没抠出来就是 null,界面据此走照片卡')
  assert.equal(kit.card.cutoutBox, null)
  assert.equal(kit.card.title, RECEIPT.title)
  assert.equal(kit.card.caption, RECEIPT.caption)
  assert.equal(kit.card.cardStyle, RECEIPT.cardStyle)
})

test('负控:回包没带卡(老模板 / 铸卡炸了)→ 这一屏与今天逐字相同', () => {
  const kit = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG } })
  assert.equal(kit.card, null, '没有卡却要渲染,组件手里就是一张空白卡')
})

test('READY 时当场就是 24 帧转台,不再标生成中', () => {
  const kit = kitOf({
    sessionId: 's1', version: 3, playKit: { photoCheck: SEG },
    objectCard: Object.assign({}, RECEIPT, { genStatus: 'READY', frames: FRAMES_24 }),
  })
  assert.equal(kit.card.frames.length, 24)
  assert.equal(kit.card.frames[23], PREFIX + '23.webp')
  assert.equal(kit.card.generating, false)
})

test('排队或生成中:照片卡 + generating=true(界面据此出「3D 生成中」)', () => {
  for (const genStatus of ['QUEUED', 'GENERATING']) {
    const kit = kitOf({
      sessionId: 's1', version: 3, playKit: { photoCheck: SEG },
      objectCard: Object.assign({}, RECEIPT, { genStatus }),
    })
    assert.deepEqual(kit.card.frames, [RECEIPT.sourceUrl], genStatus)
    assert.equal(kit.card.generating, true, genStatus)
  }
})

test('负控:回执没带 frames(旧后端 / 字段丢了)→ 退回原照片,不是空数组', () => {
  const receipt = Object.assign({}, RECEIPT)
  delete receipt.frames
  const kit = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG }, objectCard: receipt })
  assert.deepEqual(kit.card.frames, [RECEIPT.sourceUrl], '空数组喂给 cy-spin-card 就是一张什么都没有的卡')
})

test('负控:cardStyle 缺失时落回 foil —— 与组件默认、后端默认同一口径', () => {
  const kit = kitOf({
    sessionId: 's1', version: 3, playKit: { photoCheck: SEG },
    objectCard: Object.assign({}, RECEIPT, { cardStyle: '' }),
  })
  assert.equal(kit.card.cardStyle, 'foil')
})

test('★回执一路到组件:分发器把 kit.card 传下去,组件收得到', () => {
  const dispatcher = read('../../pages/play/components/playkit/index.wxml')
  const block = (dispatcher.match(/<cy-playkit-photocheck[\s\S]*?\/>/) || [''])[0]
  assert.ok(block, '分发器里找不到 photocheck 那一块,这条断言就是恒真的')
  assert.ok(/card="\{\{kit\.card\}\}"/.test(block), 'kit.card 没传给组件:投影再对也到不了屏')
})

test('★组件里那张卡真的渲出来,而且只在「判过 + 有卡」时渲,并且跟陀螺仪', () => {
  const dir = '../../pages/play/components/playkit-photocheck/'
  const wxml = strip(read(dir + 'index.wxml'))
  const json = JSON.parse(read(dir + 'index.json'))
  assert.equal(json.usingComponents['cy-spin-card'], '/components/cy/spin-card/index',
    '没注册自定义组件 —— WXML 写了也是白写,渲染时静少一块')

  const at = wxml.indexOf('<cy-spin-card')
  assert.ok(at > 0, 'WXML 里没有 cy-spin-card')
  const gates = [...wxml.slice(0, at).matchAll(/wx:if="\{\{([^}]*)\}\}"/g)].map((m) => m[1])
  const gate = gates[gates.length - 1] || ''
  assert.ok(/card/.test(gate) && /passed/.test(gate),
    '卡必须在「判过且有卡」的闸里:' + JSON.stringify(gate))
  const card = wxml.slice(at, wxml.indexOf('/>', at) + 2)
  assert.ok(!/tilt="\{\{false\}\}"/.test(card), '§10.2 要的是「倾斜跟手」,tilt 关死就是张静态图')
})

test('★藏品册与当场出卡走同一个映射:两处不许各写一份', () => {
  const page = strip(read('../../subpackageP3/pages/object-cards/index/index.js'))
  assert.ok(/require\(['"][./]*utils\/object-card(\.js)?['"]\)/.test(page), '藏品册没用共用的 utils/object-card')
  assert.ok(!/frames:\s*\[\s*row\.sourceUrl\s*\]/.test(page), '藏品册又自己把帧写死成原图了')
  const view = strip(read('../../pages/play/utils/playkit-view.js'))
  assert.ok(/require\(['"][./]*utils\/object-card(\.js)?['"]\)/.test(view), 'playkit-view 没用共用的 utils/object-card')
})

/* 第三版那条「抠图字样一处都不剩」随第四版作废:当场主角就是抠图贴纸(施工文档第四版 §0)。 */

/* ---------- 第四版:抠图贴纸 + 当场揭晓(样稿 artifact 9U7HFWDfbinjmt2tppvVGp) ---------- */

const CUT = { cutoutUrl: 'https://cdn.chengyinhub.com/upload/c.png', cutoutBox: [0.1, 0.25, 0.5, 0.5], category: '食物饮料' }

test('★回执带抠图:贴纸地址、物品位置、分类原样到卡上', () => {
  const kit = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG }, objectCard: Object.assign({}, RECEIPT, CUT) })
  assert.equal(kit.card.cutoutUrl, CUT.cutoutUrl)
  assert.deepEqual(kit.card.cutoutBox, CUT.cutoutBox)
  assert.equal(kit.card.category, '食物饮料')
  assert.equal(kit.card.sourceUrl, RECEIPT.sourceUrl)
})

test('负控:位置格式不对就不给 —— 背景散掉时物品会落在错的地方', () => {
  const kit = kitOf({
    sessionId: 's1', version: 3, playKit: { photoCheck: SEG },
    objectCard: Object.assign({}, RECEIPT, CUT, { cutoutBox: [0.6, 0, 0.6, 0.5] }),
  })
  assert.equal(kit.card.cutoutBox, null)
})

test('★地点由页面给(主题名 · 节点名),kit 产出 place;没给就是空串', () => {
  const withPlace = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG }, placeName: '预制人生 · 第一百货' })
  assert.equal(withPlace.place, '预制人生 · 第一百货')
  const without = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG } })
  assert.equal(without.place, '')
})

test('★提交失败信号 photoFailSeq 由 kit 恒产出(页面在上传失败时把它往上加)', () => {
  const kit = kitOf({ sessionId: 's1', version: 3, playKit: { photoCheck: SEG } })
  assert.equal(kit.photoFailSeq, 0)
})

test('★拍物成卡模式分到新的一屏,普通拍照审核还是原来那一屏', () => {
  const dispatcher = read('../../pages/play/components/playkit/index.wxml')
  const json = JSON.parse(read('../../pages/play/components/playkit/index.json'))
  const oc = (dispatcher.match(/<cy-playkit-objectcard\s[\s\S]*?\/>/) || [''])[0]
  assert.ok(oc, '分发器里没有拍物成卡那一屏')
  assert.ok(/kit\.type === 'photocheck' && kit\.mode === 'CARD'/.test(oc), '拍物成卡的闸不对:' + oc)
  assert.ok(dispatcher.indexOf('<cy-playkit-objectcard ') < dispatcher.indexOf('<cy-playkit-photocheck '),
    '拍物成卡那一屏必须排在普通拍照前面,否则 wx:elif 链先落到旧屏')
  for (const key of ['card', 'place', 'passed', 'tries', 'degraded', 'flagged', 'photoFailSeq']) {
    assert.ok(new RegExp('\\{\\{kit\\.' + key + '\\}\\}').test(oc), '没把 kit.' + key + ' 传给拍物成卡那一屏')
  }
  assert.equal(json.usingComponents['cy-playkit-objectcard'], '/pages/play/components/playkit-objectcard/index')
})

test('★游玩页把「主题名 · 节点名」交给 pickPlayKit —— 会话视图里只有 nodeId', () => {
  const page = strip(read('../../pages/play/index.js'))
  assert.ok(/pickPlayKit\(Object\.assign\(\{\}, view, \{ placeName \}\)/.test(page), '没把 placeName 塞进 view:信息卡的地点永远是空的')
})

test('★上传/提交失败时通知拍物成卡那一屏回取景,且这一模式不盖全屏 loading', () => {
  const page = read('../../pages/play/index.js')
  const at = page.indexOf('  _submitKitPhoto(detail, cfg) {')
  const body = strip(page.slice(at, page.indexOf('\n  },\n', at)))
  assert.ok(/if \(cardMode\) this\._notifyPhotoFail\(\)/.test(body), '失败没通知那一屏:玩家会对着转圈干等 45 秒')
  const nAt = page.indexOf('  _notifyPhotoFail() {')
  const notify = strip(page.slice(nAt, page.indexOf('\n  },', nAt)))
  assert.ok(/'playKit\.kit\.photoFailSeq': this\._photoFailSeq/.test(notify), '_notifyPhotoFail 没把计数送到那一屏')
  // 五处失败出口都走 fail(),不许有漏网的 cyToast 直接 return
  assert.equal((body.match(/\bcyToast\(/g) || []).length, 1, '失败出口里还有直接 cyToast 的,那一屏收不到失败:' + body)
  assert.ok(/if \(!cardMode\) cyLoading\.show/.test(body), '拍物成卡自己有处理中,不该再盖全屏 loading')
})

test('★拍物成卡那一屏:不用 Behavior、不加 keyframes、减弱动效挂在组件自己的根上', () => {
  const dir = '../../pages/play/components/playkit-objectcard/'
  const js = strip(read(dir + 'index.js'))
  const wxss = read(dir + 'index.wxss').replace(/\/\*[\s\S]*?\*\//g, '')
  const wxml = read(dir + 'index.wxml')
  assert.ok(!/\bbehaviors\s*:/.test(js), '组件里别用 Behavior:node 单测环境没有全局 Behavior')
  assert.ok(!/@keyframes/.test(wxss), '仓内 keyframes 只减不增:点阵与上移用 canvas 画')
  assert.ok(/class="oc \{\{reducedMotion \? 'oc--reduced' : ''\}\}"/.test(wxml), '减弱动效类必须挂在组件自己的外层')
  assert.ok(/<canvas type="2d" id="ocStage"/.test(wxml), '点阵要画在 2d canvas 上')
})

test('★玩法组件报「这一步没提交成功」时,页面让拍物成卡那一屏回取景(只认拍照提交)', () => {
  const wxml = read('../../pages/play/index.wxml')
  assert.ok(/<cy-advanced-game[^>]*bind:actionfail="onAdvancedActionFail"/.test(wxml.replace(/\n\s*/g, ' ')), '没接 actionfail:提交失败时那一屏干等 45 秒')
  const page = strip(read('../../pages/play/index.js'))
  const at = page.indexOf('onAdvancedActionFail(e) {')
  assert.ok(at > 0, '页面没有 onAdvancedActionFail')
  const body = page.slice(at, page.indexOf('\n  },', at))
  assert.ok(/SUBMIT_PHOTO_CHECK/.test(body) && /this\._notifyPhotoFail\(\)/.test(body), body)
})

test('★预览标记一路到拍物成卡那一屏;编辑页预览收到拍照事件明说不判定', () => {
  const dispatcher = read('../../pages/play/components/playkit/index.wxml')
  const oc = (dispatcher.match(/<cy-playkit-objectcard\s[\s\S]*?\/>/) || [''])[0]
  assert.ok(/preview="\{\{kit\.preview\}\}"/.test(oc), '分发器没把 kit.preview 传给拍物成卡那一屏')
  const temp = strip(read('../../pages/publish/temp/index.js'))
  const at = temp.indexOf('onPvKitAction: function (e) {')
  const body = temp.slice(at, temp.indexOf('\n  },', at))
  assert.ok(/d\.action === 'shoot'/.test(body), '编辑页预览没接拍照事件:普通拍照屏按了快门没有任何回应')
})

/* 2026-09-24 模拟器实拍:编辑页根挂 .theme-topic-editor(浅色),变量一路继承进组件,
   拍物成卡那一屏在预览里整块变成白底 —— 玩家侧是深色,预览就不是「玩家看到的样子」了。 */
test('★编辑页预览演拍物成卡时宿主挂 theme-dark,别被编辑页的浅色令牌染白', () => {
  const temp = read('../../pages/publish/temp/index.wxml')
  const host = (temp.match(/<cy-playkit\s[^>]*kit="\{\{pvKit\}\}"[^>]*\/>/) || [''])[0]
  assert.ok(host, '没找到预览里的 cy-playkit')
  assert.ok(/class="\{\{\s*pvKit\.mode === 'CARD' \? 'theme-dark' : ''\s*\}\}"/.test(host), '预览宿主没按拍物成卡挂 theme-dark')
})

/* 2026-09-24 用户看完预览截图:「不要这种弹窗的样式了吧 而且整体取景也是圆角 删除掉四周的白色标记」。
   拍物成卡改成整屏:没有顶部圆角面板、没有抓手、面板外不露遮罩;取景框整块圆角,不压白色角标。
   内容区仍从胶囊下面开始(面板 top = topSafe),不越过微信导航栏。 */
test('★拍物成卡是整屏不是弹窗:无抓手、无角标、底色铺满、面板不带顶部圆角、取景框整块圆角', () => {
  const wxml = read('../../pages/play/components/playkit-objectcard/index.wxml')
  const wxss = read('../../pages/play/components/playkit-objectcard/index.wxss')
  assert.ok(!/oc__grab/.test(wxml + wxss), '还留着弹窗抓手')
  assert.ok(!/oc__corner/.test(wxml + wxss), '取景框四角还压着白色角标')
  const rule = (sel) => ((wxss.match(new RegExp('\\n' + sel.replace(/\./g, '\\.') + ' \\{([^}]*)\\}')) || [])[1] || '')
  assert.match(rule('.oc'), /background: var\(--cy-color-bg-surface-subtle\)/, '面板外露的是遮罩,看着还是弹窗')
  assert.ok(!/border-radius/.test(rule('.oc__sheet')), '面板还带顶部圆角')
  assert.match(wxml, /class="oc__sheet" style="top:\{\{topSafe\}\}px"/, '内容区不能越过胶囊')
  assert.match(rule('.oc__vf'), /border-radius: var\(--cy-radius-2xl\)/, '取景框要整块圆角')
})
