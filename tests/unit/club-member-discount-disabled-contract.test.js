const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const EDIT_SCENE_JS = 'components/cy/scene-club-edit/index.js'
const EDIT_SCENE_WXML = 'components/cy/scene-club-edit/index.wxml'

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 去掉注释再查:注释里写「为什么停用」是应该的,不能被当成违规。 */
function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('成员优惠价已全局停用:主理人侧不得再有可填的入口', () => {
  // [2026-08-12 拍板] 服务端 clubOperationBenefit 恒传 null ⇒ 会员与非会员同价。
  // 界面若还留输入框,主理人填了、提示保存成功、库里也真存了,而会员照付原价、全程零提示 ——
  // 「做了但不生效」比「没这个功能」更坏,这条测试就是钉死这个入口不许回来。
  const wxml = stripComments(read(EDIT_SCENE_WXML))
  assert.doesNotMatch(wxml, /data-field="memberDiscountPrice"/,
    '成员优惠价输入框不得存在:能填却不生效 = 骗主理人')
  assert.doesNotMatch(wxml, /成员优惠价|会员优惠价/,
    '成员优惠价字段名也不得出现在表单里')
})

test('停用不等于抹数据:提交体不得再带 memberDiscountPrice', () => {
  // 若继续提交,输入框没了 ⇒ 恒提 null ⇒ 把 club.member_discount_price 的存量抹平,
  // 而这一列是有意保留的恢复退路(服务端改回一行即生效)。不读,也不许动。
  const js = stripComments(read(EDIT_SCENE_JS))
  assert.doesNotMatch(js, /memberDiscountPrice\s*:/,
    '提交体/data 都不得再出现 memberDiscountPrice —— 停的是价格,不是那一列的数据')
})

test('负控:把输入框或提交字段加回来,上面两条必须判红', () => {
  const wxml = stripComments(read(EDIT_SCENE_WXML))
  const brokenWxml = wxml.replace('<view class="frow last">',
    '<view class="frow"><input data-field="memberDiscountPrice" /></view>\n      <view class="frow last">')
  assert.notEqual(brokenWxml, wxml, '负控锚点失效,说明模板结构变了')
  assert.match(brokenWxml, /data-field="memberDiscountPrice"/, '负控样本必须真的含有该入口')

  const js = stripComments(read(EDIT_SCENE_JS))
  const brokenJs = `${js}\nconst leak = { memberDiscountPrice: 1 }\n`
  assert.match(brokenJs, /memberDiscountPrice\s*:/, '负控样本必须真的含有该字段')
})

test('停用的只是价格:会员身份/优先报名/保留名额入口必须仍在', () => {
  // 少了这条,下次「清理」很容易把整个俱乐部权益一起删掉。
  const wxml = stripComments(read(EDIT_SCENE_WXML))
  assert.match(wxml, /prioritySignupEnabled/, '优先报名开关必须保留')
  assert.match(wxml, /memberReservedQuota/, '成员保留名额必须保留')
})
