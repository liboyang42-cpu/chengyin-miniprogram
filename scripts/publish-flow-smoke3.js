// M5 压测/护栏 + 关键流自检:1/5/20/50 节点压测(marker>30 简化护栏)+ 加点入口 + 发布检查 + 预览入口
// cd chengyinhub-xcx && NODE_PATH="$(pwd)/node_modules" perl -e 'alarm 150; exec @ARGV' node scripts/publish-flow-smoke3.js
const automator = require('miniprogram-automator')
const report = []
const ok = (n, p, e) => report.push({ n, p: !!p, e: e || '' })

// 造 N 个带坐标节点(上海散点)
function makeNodes(N) {
  const out = []
  for (let i = 0; i < N; i++) {
    out.push({
      _localId: 'pn' + i,
      name: '站点' + (i + 1),
      address: '测试地址' + (i + 1),
      longitude: (121.45 + i * 0.002).toFixed(6),
      latitude: (31.22 + i * 0.0015).toFixed(6),
      nodeTime: 30, businessTime: '09:00-18:00', description: 'desc' + i,
      sortID: i + 1, templateId: i % 2 === 0 ? 0 : 10,
      templateInfo: i % 2 === 0 ? {} : { title: '游戏' + i }, showTemplate: false
    })
  }
  return out
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const page = await mp.reLaunch('/pages/publish/fabu/index?templateName=' + encodeURIComponent('M5压测'))
  await page.waitFor(2200)
  const d0 = await page.data()
  const lid = d0.formData.chapters[0]._localId
  ok('就绪', !!lid)

  // —— 压测:1/5/20/50 节点 ——
  for (const N of [1, 5, 20, 50]) {
    const chapters = (await page.data()).formData.chapters
    chapters[0].nodes = makeNodes(N)
    await page.setData({ 'formData.chapters': chapters })
    await page.callMethod('updateAllStatistics')
    await page.waitFor(450)              // 等过 120ms debounce
    const d = await page.data()
    const markers = d.mapMarkers || []
    ok(`压测 N=${N}:marker 数==N`, markers.length === N, 'markers=' + markers.length)
    if (N === 50) {
      // marker>30 简化护栏:非关键(非首末)marker 应为 lite 尺寸 22
      const mid = markers[10]
      ok('护栏 N=50:中间 marker 简化(w=22)', mid && mid.width === 22, 'midW=' + (mid && mid.width))
      const head = markers[0]
      ok('护栏 N=50:起点 marker 不简化(w=30)', head && head.width === 30, 'headW=' + (head && head.width))
      ok('护栏 N=50:hasRoute + 完整度算出', d.hasRoute === true && d.completeness && d.completeness.percent > 0, 'pct=' + (d.completeness && d.completeness.percent))
    }
  }

  // —— 加点入口:enterAddNodeOnMap → editorState=addNode ——
  try {
    await page.callMethod('enterAddNodeOnMap')
    await page.waitFor(300)
    ok('加点入口 editorState=addNode', (await page.data()).editorState === 'addNode', 'state=' + (await page.data()).editorState)
    await page.callMethod('cancelMapEdit')
  } catch (e) { ok('加点入口', false, e.message) }

  // —— 发布检查:清空主题名→submitForm 应弹 publishCheck(blocking 非空)——
  try {
    await page.setData({ 'formData.name': '', 'formData.imgUrl': '' })
    await page.callMethod('submitForm')
    await page.waitFor(400)
    const d = await page.data()
    ok('发布检查弹层 show', d.publishCheck && d.publishCheck.show === true)
    ok('发布检查 blocking 非空', d.publishCheck && (d.publishCheck.blocking || []).length > 0, 'blocking=' + (d.publishCheck && (d.publishCheck.blocking || []).length))
    await page.callMethod('closePublishCheck')
  } catch (e) { ok('发布检查', false, e.message) }

  // —— 预览入口:openPlayerPreview → navigateTo play ——
  try {
    await page.setData({ 'formData.name': 'M5压测' }) // 恢复有节点+名
    await page.callMethod('openPlayerPreview')
    await page.waitFor(1500)
    const cur = await mp.currentPage()
    const onPlay = (cur && cur.path && cur.path.indexOf('pages/play') >= 0)
    ok('预览入口跳到 play 页', onPlay, 'path=' + (cur && cur.path))
    if (onPlay) {
      const pd = await cur.data()
      ok('play 预览态 isPreview=true', pd.isPreview === true, 'isPreview=' + pd.isPreview)
      ok('play 预览喂入节点(nodes>0)', (pd.nodes || []).length > 0, 'nodes=' + (pd.nodes || []).length)
      await mp.navigateBack()
    }
  } catch (e) { ok('预览入口', false, e.message) }

  console.log('\n==== SMOKE3 REPORT ====')
  let pn = 0; report.forEach(r => { if (r.p) pn++; console.log((r.p ? 'PASS ' : 'FAIL ') + r.n + (r.e ? '  [' + r.e + ']' : '')) })
  console.log(`==== ${pn}/${report.length} PASS ====`)
  await mp.disconnect()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
