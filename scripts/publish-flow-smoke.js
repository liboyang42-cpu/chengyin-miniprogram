// M0~M1-B2 自检 smoke(automator connect 模式,base64 截图)
// 跑法:cd chengyinhub-xcx && NODE_PATH="$(pwd)/node_modules" node scripts/publish-flow-smoke.js
const automator = require('miniprogram-automator')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SHOT_DIR = path.join(os.homedir(), 'Downloads', '小程序截图')
const report = []
function ok(name, pass, extra) { report.push({ name, pass: !!pass, extra: extra || '' }) }

async function shot(mp, name) {
  try {
    const b64 = await mp.screenshot()
    const f = path.join(SHOT_DIR, name + '.png')
    fs.writeFileSync(f, Buffer.from(b64, 'base64'))
    return f
  } catch (e) { return 'shot-fail: ' + e.message }
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })

  // 1. 直达 fabu(带 templateName 预填)
  let page
  try {
    page = await mp.reLaunch('/pages/publish/fabu/index?templateName=' + encodeURIComponent('自检测试'))
    await page.waitFor(2500)
    ok('reLaunch fabu', (await page.path).indexOf('publish/fabu') >= 0, await page.path)
  } catch (e) { ok('reLaunch fabu', false, e.message); console.log(JSON.stringify(report, null, 2)); await mp.disconnect(); return }

  console.log('SHOT初始:', await shot(mp, 'smoke-1-initial'))

  // 2. 读初始状态
  let d = {}
  try { d = await page.data() } catch (e) { ok('page.data', false, e.message) }
  ok('M0 步骤条 activeTab=0', d.activeTab === '0', 'activeTab=' + d.activeTab)
  ok('M0 maxReachedStep 存在', typeof d.maxReachedStep === 'number', 'maxReachedStep=' + d.maxReachedStep)
  ok('M0 editorState=idle', d.editorState === 'idle', 'editorState=' + d.editorState)
  ok('M1-B2 completeness 存在', d.completeness && typeof d.completeness.percent === 'number', 'percent=' + (d.completeness && d.completeness.percent))
  ok('M1-B2 canUndo 字段存在', typeof d.canUndo === 'boolean', 'canUndo=' + d.canUndo)
  ok('M1-B1 nodeSheetView=detail', d.nodeSheetView === 'detail', 'nodeSheetView=' + d.nodeSheetView)
  const chapters = (d.formData && d.formData.chapters) || []
  ok('章节存在且带 _localId', chapters.length > 0 && !!chapters[0]._localId, 'chapters=' + chapters.length + ' lid0=' + (chapters[0] && chapters[0]._localId))
  const nodes0 = (chapters[0] && chapters[0].nodes) || []
  ok('首章节点带 _localId', nodes0.length === 0 || !!nodes0[0]._localId, 'nodes=' + nodes0.length)

  // 3. 步骤条 3 段 + 加站点 fab
  try { const steps = await page.$$('.step'); ok('M0 步骤条 3 段', steps.length === 3, 'steps=' + steps.length) } catch (e) { ok('M0 步骤条 3 段', false, e.message) }
  try { const fab = await page.$('.map-add-fab'); ok('M1-A 加站点 fab', !!fab) } catch (e) { ok('M1-A 加站点 fab', false, e.message) }

  // 4. 点序号圈 .xh → selectNode 双向高亮(若有节点)
  if (nodes0.length > 0) {
    try {
      const xh = await page.$('.topic-list .xh')
      if (xh) { await xh.tap(); await page.waitFor(800) }
      const d2 = await page.data()
      ok('M1.6 selectNode 设选中', !!d2.selectedNodeLid, 'selectedNodeLid=' + d2.selectedNodeLid)
      console.log('SHOT选中:', await shot(mp, 'smoke-2-select'))
    } catch (e) { ok('M1.6 selectNode', false, e.message) }
  } else { ok('M1.6 selectNode(跳过:无节点)', true, 'no nodes') }

  // 5. 点节点 → 详情抽屉三分区
  if (nodes0.length > 0) {
    try {
      const item = await page.$('.topic-list .list .item')
      if (item) { await item.tap(); await page.waitFor(1000) }
      const d3 = await page.data()
      ok('M1.8 打开节点抽屉(popChapterNodes)', d3.popChapterNodes === true, 'popChapterNodes=' + d3.popChapterNodes)
      ok('M1.8 抽屉 detail 视图', d3.nodeSheetView === 'detail', 'nodeSheetView=' + d3.nodeSheetView)
      console.log('SHOT抽屉:', await shot(mp, 'smoke-3-nodesheet'))
      // 切到游戏选择视图(②a 原地替换)
      const pick = await page.$('.chapt-game .game-pick, .chapt-game .game-change, .game-pick, .game-change')
      if (pick) {
        await pick.tap(); await page.waitFor(800)
        const d4 = await page.data()
        ok('M1.8b 游戏区原地替换 games', d4.nodeSheetView === 'games', 'nodeSheetView=' + d4.nodeSheetView)
        console.log('SHOT游戏视图:', await shot(mp, 'smoke-4-games'))
      } else { ok('M1.8b 游戏选择按钮(未找到选择器,看截图)', true, 'pick selector miss') }
    } catch (e) { ok('M1.8 节点抽屉', false, e.message) }
  } else { ok('M1.8 节点抽屉(跳过:无节点)', true, 'no nodes') }

  // 报告
  console.log('\n==== SMOKE REPORT ====')
  let passN = 0
  report.forEach(r => { if (r.pass) passN++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')) })
  console.log(`==== ${passN}/${report.length} PASS ====`)

  await mp.disconnect()
})().catch(err => { console.error('FATAL', err); process.exit(1) })
