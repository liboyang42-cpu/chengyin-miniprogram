/* 俱乐部 · 活动详情页契约(2026-09-02,Figma ★俱乐部·全流程 H1–H6)
 *
 * 锁四件事:
 *   ① 俱乐部管理身份点主题**不再**跳商家承接视角 pages/topic/merchantinfo ——
 *      那个页面的「这一站玩什么」是讲给商家听的,不是俱乐部要看的;纯玩家仍走 topic/index。
 *   ② 六个状态各自的主键文案与「出不出核销/未通过原因」按稿一一对应,不许少一态;
 *   ③ 页面恒暗(theme-dark),不许挂 theme-merchant —— 俱乐部端全暗;
 *   ④ 四圆钮按稿绑定「商家 / 成员 / 团码 / 更多」,顺序、文案、图标换了都要显式改这条。
 *
 * 断言锚点一律钉**结构**(行首选择器 / 属性 / 表项),不钉散落字面量 ——
 * 解释改动的注释里会出现同名字符串,钉字面量会被自己的注释撞红(本轮已踩过两次)。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const PAGE_JS = 'pages/club/topic-detail/index.js'
const PAGE_WXML = 'pages/club/topic-detail/index.wxml'
const PAGE_WXSS = 'pages/club/topic-detail/index.wxss'
const CLUB_DETAIL = 'pages/club/detail/index.js'

test('① 管理身份从俱乐部点主题进的是俱乐部视角详情,不是商家承接页', () => {
  const src = read(CLUB_DETAIL)
  assert.match(src, /goTopic\(e\)[\s\S]{0,600}?\/pages\/club\/topic-detail\/index\?topicId=/,
    'goTopic 的管理分支必须指向 pages/club/topic-detail')
  assert.match(src, /goTopic\(e\)[\s\S]{0,600}?\/pages\/topic\/index\/index\?id=/,
    '纯玩家分支必须仍走 pages/topic/index —— 这条不该被一起改掉')
  assert.doesNotMatch(src, /goTopic\(e\)[\s\S]{0,600}?merchantinfo\?topicId=/,
    'goTopic 不该再跳商家承接视角')
  assert.doesNotMatch(src, /goManageTopic\(e\)[\s\S]{0,500}?merchantinfo\?topicId=/,
    'goManageTopic 同样不该再跳商家承接视角')
})

test('② 六个状态齐全,主键文案与核销/未通过原因的出没按稿对应', () => {
  const src = read(PAGE_JS)
  const block = /const STATES = \{([\s\S]*?)\n\};/.exec(src)
  assert.ok(block, '找不到 STATES 表')
  const body = block[1]
  const expect = {
    reviewing: { primary: '等待审核中',    disabled: true,  verify: false, reject: false },
    rejected:  { primary: '修改并重新提交', disabled: false, verify: false, reject: true  },
    confirmed: { primary: '开始准备',      disabled: false, verify: false, reject: false },
    preparing: { primary: '开始活动',      disabled: false, verify: false, reject: false },
    running:   { primary: '结束活动',      disabled: false, verify: true,  reject: false },
    /* 2026-09-11 改判据:稿 H6 写的是「去核销」,而 onPrimary 对 selfrun 走的是
       directorEndConfirmShow —— 读着像个查看动作、点下去弹「结束这场活动?」。
       把写操作挂在读文案下面比死按钮更危险,所以让文案跟行为走。
       ⚠️ 这条是**稿与码对不上**、由码胜出的一次:稿待同步(H6 的主键应改成「结束活动」)。
       核销台账另有入口(主题设置半屏里的「核销台账」),没有因此丢掉。 */
    selfrun:   { primary: '结束活动',      disabled: false, verify: true,  reject: false },
    ended:     { primary: '查看结算报告',   disabled: false, verify: true,  reject: false },
  }
  for (const [key, want] of Object.entries(expect)) {
    const row = new RegExp('^\\s*' + key + ':\\s*\\{([^}]*)\\}', 'm').exec(body)
    assert.ok(row, `STATES 缺状态 ${key} —— 六态少一个,那个状态的页面就没人渲染`)
    assert.match(row[1], new RegExp(`primary:\\s*'${want.primary}'`), `${key} 主键文案不符`)
    assert.match(row[1], new RegExp(`disabled:\\s*${want.disabled}`), `${key} 主键可点性不符`)
    assert.match(row[1], new RegExp(`verify:\\s*${want.verify}`), `${key} 核销区出没不符`)
    assert.match(row[1], new RegExp(`reject:\\s*${want.reject}`), `${key} 未通过原因出没不符`)
  }
  // 审核中只有它禁用主键;别让别的状态跟着变灰
  const disabledStates = [...body.matchAll(/^\s*(\w+):\s*\{[^}]*disabled:\s*true/gm)].map((m) => m[1])
  assert.deepEqual(disabledStates, ['reviewing'], '只有审核中该禁用主键')
})

test('③ 页面恒暗:根节点 theme-dark,且全页不出现 theme-merchant', () => {
  const wxml = read(PAGE_WXML)
  assert.match(wxml, /^<view class="theme-dark">/m, '根节点必须挂 theme-dark —— 俱乐部端恒暗')
  assert.doesNotMatch(wxml, /theme-merchant/, '俱乐部端不许挂商家浅色域')
})

test('④ 四圆钮按稿绑定图标与顺序', () => {
  const src = read(PAGE_JS)
  const block = /const QUICK_ACTIONS = \[([\s\S]*?)\n\];/.exec(src)
  assert.ok(block, '找不到 QUICK_ACTIONS 表')
  const rows = [...block[1].matchAll(/key:\s*'(\w+)'[^}]*label:\s*'([^']+)'[^}]*icon:\s*'([\w-]+)'/g)]
    .map((m) => [m[1], m[2], m[3]])
  /* 2026-09-09 改:用户裁决「客户」改叫「成员」——「俱乐部会员」(付费)和
     「俱乐部成员」(名单)是两件事,这一栏是后者。
     CU-C-88(2026-09-24 用户裁决 A):连「成员」也不对 —— 这一栏后面统计的是
     主题报名/购票参与者(cms_registration),与俱乐部成员名单(club_member)不是同一套
     对象,于是改成「报名参与者」。
     2026-09-08 改:「编辑」并进「更多」(Figma J9),图标同时换成语义对得上的。
     旧绑定是照 H 系稿原样抄的 —— 客户=tab-club、编辑=image、团码=edit(铅笔),
     后两个明显反了,旧注释里也写着「已在 PR 里提请设计确认」。 */
  assert.deepEqual(rows, [
    ['merchant', '商家', 'discover-shop'],
    ['customer', '报名参与者', 'mtab-customers'],
    ['groupcode', '团码', 'qr'],
    ['more', '更多', 'more'],
  ], '四圆钮的顺序/文案/图标按 Figma 绑定;要改先跟设计确认')

  // 图标名必须是 icons.wxss 里真有的那 62 枚之一 —— 写错名字不会报错,只会渲染成空白
  const iconCss = read('components/cy/icon/icons.wxss')
  for (const [, , icon] of rows) {
    assert.ok(iconCss.includes('.cyi--' + icon + ' '), `图标 ${icon} 不在 icons.wxss 里`)
  }
})

/** 找出写死颜色又没标 ds-ok 的**声明行**。
 *  注释先剥掉再扫 —— 解释「坐在 #4D4D4D 上只能用 text-primary」这类注释本身含 hex,
 *  按原文行扫会把注释判成违规;判据要看代码,不看注解。
 *  但行尾的 `ds-ok` 标注也写在注释里,所以剥的时候给它留个记号,别把豁免一起剥没了。 */
function findRawColors(wxss) {
  const code = wxss.replace(/\/\*[\s\S]*?\*\//g, (m) => (/ds-ok/.test(m) ? '/*ds-ok*/' : ''))
  return code.split('\n')
    .filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l))
    .filter((l) => !/ds-ok/.test(l))
    .map((l) => l.trim())
}

test('⑤ wxss 不写死颜色:除显式 ds-ok 标注的装饰值外,一律走 token', () => {
  const bad = findRawColors(read(PAGE_WXSS))
  assert.deepEqual(bad, [], `这些行写死了颜色又没标 ds-ok:\n${bad.join('\n')}`)
})

test('负控:把 goTopic 改回商家承接页必须判红', () => {
  const src = read(CLUB_DETAIL)
  const mutated = src.replace(
    /(goTopic\(e\)[\s\S]{0,600}?)\/pages\/club\/topic-detail\/index\?topicId=/,
    '$1/pages/topic/merchantinfo/merchantinfo?topicId=')
  assert.notEqual(mutated, src, '负控变异注入失败 —— 锚点没命中')
  assert.doesNotMatch(mutated, /goTopic\(e\)[\s\S]{0,600}?\/pages\/club\/topic-detail\/index\?topicId=/,
    '变异没真的把跳转改回去')
  assert.throws(() => {
    assert.match(mutated, /goTopic\(e\)[\s\S]{0,600}?\/pages\/club\/topic-detail\/index\?topicId=/)
  })
})

test('负控:STATES 少一态必须判红', () => {
  const src = read(PAGE_JS)
  const block = /const STATES = \{([\s\S]*?)\n\};/.exec(src)[1]
  const mutated = block.replace(/^\s*ended:\s*\{[^}]*\},?\s*$/m, '')
  assert.notEqual(mutated, block, '负控变异注入失败')
  assert.equal(/^\s*ended:\s*\{/m.test(mutated), false, '变异没真删掉 ended')
  assert.throws(() => {
    assert.ok(/^\s*ended:\s*\{/m.exec(mutated), 'STATES 缺状态 ended')
  }, /缺状态 ended/)
})

test('负控:wxss 里混进未标注的写死颜色必须判红,而注释里的 hex 不算', () => {
  // 走同一个检查器,不另写一套判据 —— 否则负控证明的是别的东西
  assert.deepEqual(findRawColors('.x { color: #ABCDEF; }'), ['.x { color: #ABCDEF; }'])
  assert.deepEqual(findRawColors('/* 说明:#4D4D4D 上只能用 primary */\n.x { color: var(--a); }'), [],
    '注释里的 hex 不该被判违规')
  assert.deepEqual(findRawColors('.x { color: #ABCDEF; } /* ds-ok: 刻意 */'), [],
    '标了 ds-ok 的行应放行')
})
