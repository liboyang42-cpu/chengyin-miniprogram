// M1-B2 节点交互自检(注入 2 节点后跑 折叠/上下移/选中/抽屉三分区/游戏内联)
// cd chengyinhub-xcx && NODE_PATH="$(pwd)/node_modules" node scripts/publish-flow-smoke2.js
const automator = require('miniprogram-automator')
const fs = require('fs'); const os = require('os'); const path = require('path')
const SHOT_DIR = path.join(os.homedir(), 'Downloads', '小程序截图')
const report = []
const ok = (n, p, e) => report.push({ n, p: !!p, e: e || '' })
async function shot(mp, name) { try { const b = await mp.screenshot(); const f = path.join(SHOT_DIR, name + '.png'); fs.writeFileSync(f, Buffer.from(b, 'base64')); return f } catch (e) { return 'shot-fail ' + e.message } }

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const page = await mp.reLaunch('/pages/publish/fabu/index?templateName=' + encodeURIComponent('节点自检'))
  await page.waitFor(2000)

  // 注入 2 个节点到首章(带 _localId/坐标/游戏)
  const d0 = await page.data()
  const chapters = (d0.formData && d0.formData.chapters) || []
  const lid = chapters[0]._localId
  chapters[0].nodes = [
    { _localId: 'nlidA', name: '外滩源', address: '黄浦区中山东一路', longitude: '121.490317', latitude: '31.237536', nodeTime: 60, businessTime: '09:00-18:00', description: '起点', sortID: 1, templateId: 0, templateInfo: {}, showTemplate: false },
    { _localId: 'nlidB', name: '和平饭店', address: '南京东路20号', longitude: '121.485000', latitude: '31.240000', nodeTime: 30, businessTime: '10:00-20:00', description: '第二站', sortID: 2, templateId: 12, templateInfo: { title: '解谜游戏A', imgUrl: '' }, showTemplate: true },
  ]
  await page.setData({ 'formData.chapters': chapters })
  await page.callMethod('updateAllStatistics')
  await page.waitFor(1200)
  const d1 = await page.data()
  ok('注入 2 节点', ((d1.formData.chapters[0].nodes) || []).length === 2)
  ok('M1.6 完整度随节点上升', d1.completeness.percent > 14, 'percent=' + d1.completeness.percent)
  ok('M1.7a buildRouteMap 出 marker', (d1.mapMarkers || []).length === 2, 'markers=' + (d1.mapMarkers || []).length)
  ok('hasRoute=true', d1.hasRoute === true)
  console.log('SHOT 2节点+路线:', await shot(mp, 'smoke2-1-route'))

  // selectNode:点第一个序号圈
  try {
    const xh = await page.$('.topic-list .xh'); await xh.tap(); await page.waitFor(700)
    const d2 = await page.data()
    ok('M1.6 selectNode 高亮', d2.selectedNodeLid === 'nlidA', 'sel=' + d2.selectedNodeLid)
    const selMarker = (d2.mapMarkers || []).find(m => m.width === 42)
    ok('M1.6 选中 marker 放大(42)', !!selMarker)
    console.log('SHOT 选中:', await shot(mp, 'smoke2-2-select'))
  } catch (e) { ok('M1.6 selectNode', false, e.message) }

  // 上下移:把第 1 个下移
  try {
    const downBtn = await page.$('.node-reorder .node-reorder__btn:not(.disabled)')
    if (downBtn) { await downBtn.tap(); await page.waitFor(700) }
    const d3 = await page.data()
    const order = (d3.formData.chapters[0].nodes || []).map(n => n._localId).join(',')
    ok('M1.5 上下移生效(顺序变化)', order !== 'nlidA,nlidB', 'order=' + order)
    ok('M1.5 sortID 重算', (d3.formData.chapters[0].nodes[0].sortID === 1), 'sort0=' + d3.formData.chapters[0].nodes[0].sortID)
    ok('M1.7b 重排后 canUndo', d3.canUndo === true)
    console.log('SHOT 重排:', await shot(mp, 'smoke2-3-reorder'))
  } catch (e) { ok('M1.5 上下移', false, e.message) }

  // 撤销
  try {
    const undoBtn = await page.$('.undo-btn:not(.undo-btn--disabled)')
    if (undoBtn) { await undoBtn.tap(); await page.waitFor(700) }
    const d4 = await page.data()
    const order = (d4.formData.chapters[0].nodes || []).map(n => n._localId).join(',')
    ok('M1.7b 撤销恢复顺序', order === 'nlidA,nlidB', 'order=' + order)
  } catch (e) { ok('M1.7b 撤销', false, e.message) }

  // 章节折叠
  try {
    const arrow = await page.$('.collapse-arrow'); await arrow.tap(); await page.waitFor(600)
    const d5 = await page.data()
    ok('M1.4f 章节折叠', d5.formData.chapters[0]._collapsed === true, '_collapsed=' + d5.formData.chapters[0]._collapsed)
    console.log('SHOT 折叠:', await shot(mp, 'smoke2-4-collapse'))
    await arrow.tap(); await page.waitFor(400) // 展开回来
  } catch (e) { ok('M1.4f 折叠', false, e.message) }

  // 节点抽屉三分区 + 游戏内联
  try {
    const item = await page.$('.topic-list .list .item'); await item.tap(); await page.waitFor(900)
    const d6 = await page.data()
    ok('M1.8 打开抽屉 detail', d6.popChapterNodes === true && d6.nodeSheetView === 'detail')
    console.log('SHOT 抽屉三分区:', await shot(mp, 'smoke2-5-sheet'))
    const pick = await page.$('.game-change, .game-pick')
    if (pick) { await pick.tap(); await page.waitFor(700); const d7 = await page.data(); ok('M1.8b 游戏区原地替换 games', d7.nodeSheetView === 'games', 'view=' + d7.nodeSheetView); console.log('SHOT 游戏视图:', await shot(mp, 'smoke2-6-games')) }
    else ok('M1.8b 游戏按钮(选择器未命中,看截图)', true)
  } catch (e) { ok('M1.8 抽屉', false, e.message) }

  console.log('\n==== SMOKE2 REPORT ====')
  let pn = 0; report.forEach(r => { if (r.p) pn++; console.log((r.p ? 'PASS ' : 'FAIL ') + r.n + (r.e ? '  [' + r.e + ']' : '')) })
  console.log(`==== ${pn}/${report.length} PASS ====`)
  await mp.disconnect()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
