const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

/**
 * 身份标签契约。设计真源:Figma ku2oaN9ag1XUMC9lKNnrcr
 *   BIZ (商家)  node 107:10367 —— 蓝渐变 #3BADF5 → #0083DA @ 25.24°
 *   CLUB(俱乐部) node 107:10402 —— 橙渐变 #FFA654 → #F26702 @ 151.46°
 *   两者同规格 35×16px / 圆角 5px / 白字 8px / 外发光 57.355px @ .70
 *
 * ⚠️ 产品明确要求:**玩家什么都不挂**。所以这里有一条负向断言 ——
 * 谁要给玩家补一个「玩家/PLAYER」角标,这个测试会红。
 */
function component() {
  return {
    js: read('components/cy/identity-tag/index.js'),
    wxml: read('components/cy/identity-tag/index.wxml'),
    wxss: read('components/cy/identity-tag/index.wxss'),
  }
}

// 把组件的 observer 跑起来,拿到它对某个 kind 的判定结果
function runObserver(kind) {
  let captured = null
  const sandbox = { setData(patch) { Object.assign(this.data, patch) }, data: {} }
  let def = null
  const fn = new Function('Component', component().js)
  fn(cfg => { def = cfg })
  assert.ok(def && def.observers && def.observers.kind, '组件必须有 kind observer')
  sandbox.data = Object.assign({}, def.data)
  def.observers.kind.call(sandbox, kind)
  captured = sandbox.data
  return captured
}

test('商家 → BIZ,俱乐部 → CLUB', () => {
  assert.equal(runObserver('biz')._label, 'BIZ')
  assert.equal(runObserver('club')._label, 'CLUB')
  assert.equal(runObserver('BIZ')._label, 'BIZ', '大小写不敏感')
})

test('玩家/空/未知 → 不渲染任何标签(不给兜底角标)', () => {
  for (const v of ['', null, undefined, 'player', '玩家', 'unknown', '1']) {
    const d = runObserver(v)
    assert.equal(d._label, '', `kind=${JSON.stringify(v)} 不该产生标签`)
  }
  // wxml 必须靠 _label 决定渲不渲染,不能无条件出一个 view
  assert.match(component().wxml, /wx:if="\{\{_label\}\}"/,
    '标签必须由 _label 控制显隐 —— 否则玩家行会多出一个空角标位')
})

test('两个渐变与发光逐项对齐 Figma', () => {
  const wxss = component().wxss
  // BIZ 蓝
  assert.match(wxss, /linear-gradient\(25\.24deg,\s*#3BADF5\s*6\.35%,\s*#0083DA\s*98\.31%\)/,
    'BIZ 渐变必须与 node 107:10367 一致')
  assert.match(wxss, /rgba\(60,\s*179,\s*255,\s*\.70\)/, 'BIZ 外发光色值')
  // CLUB 橙
  assert.match(wxss, /linear-gradient\(151\.46deg,\s*#FFA654\s*7\.31%,\s*#F26702\s*100\.03%\)/,
    'CLUB 渐变必须与 node 107:10402 一致')
  assert.match(wxss, /rgba\(255,\s*166,\s*84,\s*\.70\)/, 'CLUB 外发光色值')
  // 尺寸以用户在画板上摆定的 134:401 为准(比组件原稿小一圈):
  // 24×12px → 48×24rpx,圆角 5px → 10rpx,字 7px → 14rpx
  assert.match(wxss, /width:\s*48rpx/)
  assert.match(wxss, /height:\s*24rpx/)
  assert.match(wxss, /border-radius:\s*10rpx/)
  assert.match(wxss, /font-size:\s*14rpx/)
})

test('后端只下发封顶的 identityKind,绝不下发账号级 user_type', () => {
  const mapper = read('../chengyinhub-system/src/main/resources/mapper/business/PublicMemberMapper.xml')
  // 2026-08-29 窄投影:在 SQL 里就把账号类型收敛成 BIZ/null,原始枚举不出库。
  assert.match(mapper, /<result property="identityKind" column="identity_kind"\/>/,
    'resultMap 必须映射收敛后的 identity_kind')
  // RUN-13 后该投影 join 了 player_growth,列必须带表别名消歧 —— pin 允许可选的 `x.` 前缀,
  // 契约要钉的是「收敛在 SQL 里、值域封顶」,不是别名写法。
  assert.match(mapper, /CASE WHEN (?:\w+\.)?user_type = 2 THEN 'BIZ' ELSE NULL END AS identity_kind/,
    '收敛必须发生在 SQL 里 —— 值域封顶,不靠调用方自觉')
  assert.doesNotMatch(mapper, /<result property="userType"/,
    'user_type 不得出现在公开投影的 resultMap 里')

  const vo = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/domain/vo/PublicMemberVO.java')
  assert.match(vo, /private String identityKind;/)
  assert.match(vo, /public String getIdentityKind\(\)/, '没有 getter 的话 JSON 里根本不会出现这个字段')
  assert.doesNotMatch(vo, /userType/,
    'PublicMemberVO 不得含 userType —— 它与 password/phone/openId 同属匿名响应禁止字段')
})
