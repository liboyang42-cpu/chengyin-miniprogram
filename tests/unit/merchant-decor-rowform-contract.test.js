const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = (...p) => path.join(__dirname, '../..', ...p)
const read = (...p) => fs.readFileSync(root(...p), 'utf8')
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

test('品牌中心按六项任务分短页，不在首页堆清单或表单', () => {
  const wxml = strip(read('pages/merchant/decor/index.wxml'))
  const body = wxml.split('<cy-sheet')[0]
  assert.match(wxml, /class="dc-public"[\s\S]{0,100}bindtap="goPreview"/)
  assert.match(wxml, /class="dc-status"[\s\S]{0,200}<cy-switch/)
  for (const title of ['门店信息','品牌介绍','门店相册','AI 店铺角色','合作经营','入驻资料']) assert.ok(wxml.includes('title="' + title + '"'))
  const basic = wxml.split('<block wx:elif="{{view === \'basic\'}}">')[1].split('<block wx:elif="{{view === \'qualification\'}}">')[0]
  assert.ok(!basic.includes('title="店铺介绍"'))
  assert.ok(!basic.includes('title="营业执照"'))
  assert.match(basic, /toggleBasicEditing/)
  assert.doesNotMatch(wxml, /guide\.todo/)
  assert.ok(!/<input/.test(body), '正文不许留内联 input')
  assert.ok(!/<textarea/.test(body), '正文不许留内联 textarea')
  assert.ok(!/<radio-group/.test(body), '正文不许留内联 radio')
  assert.ok(!/dc-meter/.test(wxml), '百分比进度条已撤销')
  assert.doesNotMatch(wxml, /bindtap="toggleSec"|secOpen\./, '清单分组不应藏在折叠层')
  assert.doesNotMatch(read('pages/merchant/decor/index.js'), /secOpen|toggleSec/)
})

test('装修四个重编辑器拆为注册子页，各自保存', () => {
  const app = JSON.parse(read('app.json'))
  const merchant = app.subPackages.find((p) => p.root === 'pages/merchant')
  const dirs = ['ai-npc', 'coop-setting', 'gallery', 'perks']
  for (const dir of dirs) {
    assert.ok(merchant.pages.includes(`decor/${dir}/index`), `${dir} 未注册`)
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(root(`pages/merchant/decor/${dir}/index.${ext}`)), `${dir}/index.${ext}`)
    }
  }
  const js = read('pages/merchant/decor/index.js')
  assert.match(js, /goStory\(\)/)
  assert.match(js, /goCoopSetting\(\)/)
  assert.match(js, /goGallery\(\)/)
  assert.match(js, /goPerks\(\)/)
})

test('承接设置沿用同接口完整白名单', () => {
  const coop = read('pages/merchant/decor/coop-setting/index.js')
  assert.match(coop, /url: '\/api\/merchant\/coop-profile\/save'/)
  assert.match(coop, /suitActivityTypes: this\.data\.keep\.suitActivityTypes/)
  assert.match(coop, /coopOpen: this\.data\.keep\.coopOpen/)

  // 2026-09-19 审查 #30:decor/story 子页整页零入口(没进 app.json),已删;
  // 它那份「长文只提交实际编辑字段」的不变量现在由装修首页 openField 单字段保存承接 ——
  // 就是下面 decor/index.js 那三条断言,不再另有一页。
  assert.match(coop, /if \(this\.data\.loadState !== 'ok'\) return;/, '未读到资料时不能保存默认空值')

  const decor = read('pages/merchant/decor/index.js')
  assert.match(decor, /saveBrand\(patch, onSuccess\)/)
  assert.match(decor, /const stablePatch = Object\.assign\(\{\}, patch\)/)
  assert.match(decor, /data: JSON\.stringify\(stablePatch\)/)
  assert.match(decor, /saveBrand\(\{\s*\[key\]: value\s*\}, done\)/)
  assert.doesNotMatch(decor, /saveBrand\(\)\s*\{/)
})

test('装修页从子页返回回读真数据，摘要只用后端字段', () => {
  const js = read('pages/merchant/decor/index.js')
  assert.match(js, /if \(this\._loadedOnce && this\.canReadProfileView\(\) && !this\.data\.fieldSheet\.show && !this\.data\.imageEditor\) this\.load\(\);/,
    '资料视图无权限时回读会撞 403,onShow 必须先过视图权限判断')
  assert.match(js, /if \(m\.capacity != null && String\(m\.capacity\) !== ''\) parts\.push/)
  assert.match(js, /if \(m\.availableTime\) parts\.push\(m\.availableTime\)/)
})

test('★负控：正文表单与漏注册子页会让契约变红', () => {
  const bodyRule = (s) => assert.ok(!/<input/.test(s.split('<cy-sheet')[0]))
  assert.throws(() => bodyRule('<view><input /></view><cy-sheet />'))
  const pages = ['decor/gallery/index']
  assert.throws(() => assert.ok(!pages.includes('decor/gallery/index')))
  assert.throws(() => assert.doesNotMatch(
    'data: JSON.stringify({ description: this.data.description, derivatives: k.derivatives })',
    /derivatives: k\.derivatives/))
})

// 2026-08-10:装修子页的保存位置统一到底部大按钮 —— 原先 story / coop-setting
// 把保存藏在导航栏右上角,和相册 / 权益两页不一致,用户在同一组页面里要找两个地方。
// 2026-09-19 审查 #30:story 子页整页零入口已删,这条收到剩下三页。
test('装修三个子页的保存都在底部,导航栏 actions 槽里不再有保存', () => {
  for (const dir of ['coop-setting', 'gallery', 'perks']) {
    const wxml = strip(read(`pages/merchant/decor/${dir}/index.wxml`))
    const nav = wxml.slice(wxml.indexOf('<cy-nav-bar'), wxml.indexOf('</cy-nav-bar>') + 1)
    assert.ok(!/保存/.test(nav), `${dir}:保存不许留在导航栏`)
    assert.match(wxml, /<cy-btn[^>]*>\s*保存/, `${dir}:底部缺保存按钮`)
    assert.match(read(`pages/merchant/decor/${dir}/index.json`), /"cy-btn"/, `${dir}:漏注册 cy-btn`)
  }
})

// 「品牌故事是一整块灰填充域(无标题输入、无白卡、提示词在 placeholder 里)」那两条
// —— 正条 + 负控 —— 随 2026-09-19 审查 #30 一起退役:它们钉的是 decor/story 子页,
// 而那一页没进 app.json、全仓零入口,商家实际用的是装修首页的内联字段弹层
// (断言在文件开头那条「正文不许留内联 input / textarea」上,弹层里的形态另有闸门)。
// 2026-08-11 那条「字段不套白卡」的裁决本身没有被推翻,只是这里不再是它的落点。
