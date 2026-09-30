const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = (...p) => path.join(__dirname, '../..', ...p)
const read = (...p) => fs.readFileSync(root(...p), 'utf8')

test('新建据点是已注册的独立子页', () => {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(root(`pages/merchant/citynode/create/index.${ext}`)), `missing .${ext}`)
  }
  const app = JSON.parse(read('app.json'))
  const merchant = app.subPackages.find((p) => p.root === 'pages/merchant')
  assert.ok(merchant.pages.includes('citynode/create/index'))
})

test('创建页收成两段卡:玩法配置 + 店址确认', () => {
  // 2026-08-10:商家信息不用填(档案里有),玩法整套交给 pages/publish/temp。
  const wxml = read('pages/merchant/citynode/create/index.wxml')
  const steps = [...wxml.matchAll(/<text class="cnc-step">([^<]*)/g)].map((m) => m[1].trim())
  assert.deepEqual(steps, ['① 店铺玩法', '② 确认店址'])
  assert.match(wxml, /class="cnc-ok" wx:if="\{\{tpl\}\}"/)
  assert.match(wxml, /class="cnc-ok" wx:if="\{\{picked\}\}"/)
  // 本页不再自绘模板表单
  assert.ok(!/<input/.test(wxml), '模板字段已搬去玩法配置页,本页不许再留输入框')
})

test('玩法配置改用游戏模板配置页,且保存必须走据点端点', () => {
  const js = read('pages/merchant/citynode/create/index.js')
  assert.match(js, /url: '\/pages\/publish\/temp\/index\?from=citynode&scope=MERCHANT'/)
  assert.match(js, /events:[\s\S]{0,200}templateCreated/, '靠 eventChannel 回传 templateId')
  assert.ok(!/url: '\/api\/merchant\/city-node\/template\/submit'/.test(js), '本页不再直接提交模板')

  // ★ 闸不许被绕过:temp 页从据点进来时必须改道到据点端点。
  // /api/template/publish 没有 validationMethodError 与微信内容安全这两道,
  // 也不落 merchantNodeEnabled / nodeSubmitStatus —— 走错就是静默把闸拆了。
  const temp = read('pages/publish/temp/index.js')
  assert.match(temp, /from === 'citynode'[\s\S]{0,400}'\/api\/merchant\/city-node\/template\/submit'/)
})

test('创建页沿用投放端点及其传输契约', () => {
  const js = read('pages/merchant/citynode/create/index.js')
  assert.match(js, /url: '\/api\/merchant\/city-node\/save'/)
  const saveCall = js.slice(js.indexOf("city-node/save"))
  assert.ok(!/application\/json/.test(saveCall.slice(0, 400)), '/save 不是 RequestBody')
  assert.match(js, /if \(this\.data\.submitting\) return;/)
  // 2026-09-06 轻提示收口:页面不再直调 wx.showToast,统一走 utils/toast.js 的 toast(...)
  assert.match(js, /if \(!this\.data\.tpl \|\| !this\.data\.tpl\.id\) return toast\(/)
  assert.match(js, /if \(!this\.data\.picked\) return toast\(/)
  assert.match(js, /applications\.some\(function \(item\)/, '回读必须核对对面产生的申请 id，不能只看请求成功')
})

test('店址默认取商家档案坐标,但必须让商家确认一次', () => {
  // 档案坐标多半是按地址反查的(mms_merchant 自带 location_verified),
  // 而据点靠 GPS 判到达 —— 偏了就是玩家永远打不了卡且零报错。
  const js = read('pages/merchant/citynode/create/index.js')
  assert.match(js, /url: '\/api\/merchant\/info'/)
  assert.match(js, /locationLat/)
  assert.match(js, /pickedFromProfile/)
  assert.match(js, /if \(!this\.data\.addressConfirmed\) return toast\(/, // 同上:toast(...) 取代 wx.showToast
    '档案坐标未显式确认时必须挡住提交')
  const wxml = read('pages/merchant/citynode/create/index.wxml')
  assert.match(wxml, /wx:if="\{\{pickedFromProfile\}\}"/, '档案坐标要明确告诉商家这是哪来的')
  assert.match(wxml, /bind:tap="confirmProfileAddress"/, '档案候选坐标必须有显式确认动作')
  assert.match(wxml, /addressConfirmed \? '已确认' : '待确认'/, '候选坐标不能提前声称已确认')
  assert.match(wxml, /bind:tap="repick"/, '要能挪')

  const relaxed = js.replace(/\s*if \(!this\.data\.addressConfirmed\) return wx\.showToast\([^\n]+/, '')
  assert.throws(() => assert.match(relaxed, /if \(!this\.data\.addressConfirmed\) return wx\.showToast/),
    '负控:删掉显式确认门槛必须判红')
})

test('列表页新建入口先过配额闸并跳子页', () => {
  const js = read('pages/merchant/citynode/index.js')
  assert.match(js, /this\.data\.used >= this\.data\.max/, 'max=0 也是零配额，必须在前端拦住')
  assert.match(js, /wx\.navigateTo\(\{ url: '\/pages\/merchant\/citynode\/create\/index' \}\)/)
  assert.ok(!/showCreate/.test(js))
  assert.ok(!/submitTemplate|pickLocation|submitNode/.test(js))
  assert.ok(!/class="cn-create"/.test(read('pages/merchant/citynode/index.wxml')))
})

test('★负控：缺注册或错误 JSON 传输会判红', () => {
  assert.throws(() => assert.ok(['citynode/index'].includes('citynode/create/index')))
  // 负控:temp 页把据点的保存改回普通模板发布端点 ⇒ 两道闸被绕过,必须判红
  const bad = read('pages/publish/temp/index.js').replace("'/api/merchant/city-node/template/submit'", "'/api/template/publish'")
  assert.throws(() => assert.match(bad, /from === 'citynode'[\s\S]{0,400}'\/api\/merchant\/city-node\/template\/submit'/))
})

// 表单形状 → CmsMemberTemplate 形状的字段映射:漏一个就是静默丢配置。
// 这里锁住三个对不上的名字,并留负控。
test('temp → 据点端点的字段映射不许漏', () => {
  const js = read('pages/publish/temp/index.js')
  const fn = js.slice(js.indexOf('toNodeTemplate: function'), js.indexOf('onPickInteraction:'))
  assert.match(fn, /feedbackMethodStr = String\(body\.feedbackMethod\)/, 'feedbackMethod(数字) → feedbackMethodStr(字符串)')
  assert.match(fn, /body\.interactionType =/, '玩法语义只有据点有,普通发布 DTO 没这个字段')
  assert.match(fn, /body\.activityCategoryids = body\.categoryIds/, 'categoryIds 是发布 DTO 的名字,实体侧不认')
  assert.match(fn, /delete body\.audioFileName/, '本页独有的上传辅助字段实体上没有')
})

test('★负控:映射漏掉 feedbackMethodStr / interactionType 必须判红', () => {
  const js = read('pages/publish/temp/index.js')
  const fn = js.slice(js.indexOf('toNodeTemplate: function'), js.indexOf('onPickInteraction:'))
  assert.throws(() => assert.match(fn.replace(/body\.feedbackMethodStr = String\(body\.feedbackMethod\);?/, ''),
    /feedbackMethodStr = String\(body\.feedbackMethod\)/))
  assert.throws(() => assert.match(fn.replace(/body\.interactionType =[^\n]*/, ''), /body\.interactionType =/))
})

test('据点玩法形态必选 —— 不选就落库,玩家侧形态是空的', () => {
  const js = read('pages/publish/temp/index.js')
  assert.match(js, /from === 'citynode' && !this\.data\.interactionType[\s\S]{0,120}errors\.interactionType/)
  assert.match(read('pages/publish/temp/index.wxml'), /wx:if="\{\{ from === 'citynode' \}\}"/)
})
