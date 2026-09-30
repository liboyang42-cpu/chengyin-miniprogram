/* 2026-09-24 玩法配置接通核查的五处修复(C-01 ~ C-05 里的前端部分)。
 * 台账:桌面「城瘾全产品审查文档/玩法配置接通核查_30个玩法_20260924.md」。 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const cat = require('../../pages/publish/utils/publish/node-game-catalog.js')
const pv = require('../../pages/publish/utils/publish/advanced-game-preview.js')

const ROOT = path.resolve(__dirname, '../..')

// ---------- C-01:问答 / 扫码的空媒体地址不上送 ----------
test('C-01 不配图的问答、不配语音的扫码,保存载荷里没有空串媒体字段', () => {
  const m = cat.applyToConfig(cfg.defaultConfig(), 'qaText')
  m.qa.title = '这座桥建于哪一年?'
  m.qa.answerText = '1937'
  const qa = JSON.parse(cfg.serialize(m, {})).qa
  assert.ok(!('imageUrl' in qa) && !('audioUrl' in qa), '空串会被服务端判成格式不对')

  const n = cat.applyToConfig(cfg.defaultConfig(), 'scan')
  n.scan.reply = '欢迎'
  const scan = JSON.parse(cfg.serialize(n, {})).scan
  assert.ok(!('audioUrl' in scan) && !('imageUrl' in scan))

  // 配了的照常带上
  m.qa.imageUrl = 'https://x/y.png'
  assert.equal(JSON.parse(cfg.serialize(m, {})).qa.imageUrl, 'https://x/y.png')
})

// ---------- C-03:留言标题 / 提示与后端同为必填 ----------
test('C-03 留言标题、提示空着前端就拦,文案与服务端一致', () => {
  const m = cat.applyToConfig(cfg.defaultConfig(), 'note')
  m.note.title = ''
  m.note.prompt = '写点什么'
  assert.equal(cfg.validate(m, {}), '留言标题不能为空')
  m.note.title = '留一句'
  m.note.prompt = ''
  assert.equal(cfg.validate(m, {}), '留言提示不能为空')
  m.note.prompt = '写点什么'
  assert.equal(cfg.validate(m, {}), '')
  const java = fs.readFileSync(path.resolve(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business'
    + '/service/support/AdvancedGameConfigValidator.java'), 'utf8')
  assert.match(java, /留言标题不能为空/)
  assert.match(java, /留言提示不能为空/)
})

// ---------- C-04:试玩补齐四段,字段与玩家分发器实际读取的一致 ----------
/** 从分发器模板里抽某个 type 那一块用到的 kit.xxx —— 这才是组件真吃的字段。 */
function dispatcherFields(type) {
  // 先剥注释:注释里的「kit.X」不是绑定
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit/index.wxml'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
  const start = wxml.indexOf("kit.type === '" + type + "'")
  assert.ok(start > 0, '分发器里没有 ' + type)
  const end = wxml.indexOf('kit.type ===', start + 10)
  const block = wxml.slice(start, end < 0 ? undefined : end)
  const fields = new Set()
  for (const m of block.matchAll(/kit\.([a-zA-Z]+)/g)) if (m[1] !== 'type') fields.add(m[1])
  return [...fields]
}

test('C-04 角色建档 / 拍照审核 / 限时打字 / 留言能试玩,且喂到了分发器读的每个字段', () => {
  const cases = { profile: 'profile', photoCheck: 'photocheck', typeIn: 'typein', note: 'note' }
  for (const [section, type] of Object.entries(cases)) {
    const m = cfg.defaultConfig()
    m[section] = Object.assign({}, m[section], { enabled: true })
    const kit = pv.buildPreviewKit(m, { limitSeconds: 0 })
    assert.ok(kit, section + ' 试玩出不来')
    assert.equal(kit.type, type)
    for (const f of dispatcherFields(type)) {
      assert.ok(f in kit, section + ' 试玩少了分发器要的 kit.' + f + '(玩家页有、试玩没有 = 两边漂移)')
    }
  }
})

test('C-04 检定在编辑页演不了时说实话,不再说「还要再填一点」', () => {
  const js = fs.readFileSync(path.join(ROOT, 'pages/publish/temp/index.js'), 'utf8')
  assert.match(js, /section === 'check' \? '技能检定在旅程里掷骰，编辑页演不了'/)
})
