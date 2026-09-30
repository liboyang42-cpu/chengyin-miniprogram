'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { closeMiniProgram, openMiniProgram } = require('./harness')
const { startRouteGraphM5FixtureServer } = require('./fixtures/route-graph-m5-fixture')

const PROJECT_PATH = path.resolve(__dirname, '..', '..')
const SHOT_DIR = process.env.SHOT_DIR || path.join(PROJECT_PATH, 'artifacts', 'route-m5')
const CREATOR_TOPIC_ID = '88001'
const PLAYER_A_ACTIVITY_ID = '99001'
const PLAYER_B_ACTIVITY_ID = '99002'
const API_TOPIC_UPDATE = '/api/topic/update'
const API_TOPIC_EDIT_DETAIL = '/api/topic/edit-detail'
const API_PLAY_ANSWER = '/api/play/answer'
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log('  ✔ ' + message)
}

async function eventually(check, message, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000)
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await wait(120)
  }
  const detail = lastError && lastError.message ? `：${lastError.message}` : ''
  throw new Error(message + detail)
}

async function element(page, selector, message) {
  return eventually(() => page.$(selector), message || `未找到 ${selector}`)
}

async function tapComponent(component, innerSelector) {
  assert(component, '目标组件存在')
  const target = await component.$(innerSelector || '.btn')
  assert(target, '组件内存在公开点击目标')
  await target.tap()
}

async function configureFixtureBase(mp, baseUrl) {
  const applied = await mp.evaluate((url) => {
    getApp().globalData.siteBaseUrl = url
    return getApp().globalData.siteBaseUrl
  }, baseUrl)
  assert(applied === baseUrl, '运行时 API 地址已切到受控后端')
  const probe = await mp.evaluate((url) => new Promise((resolve) => {
    wx.request({
      url: url + '/__m5_health',
      success: (response) => resolve({ ok: true, code: response.data && response.data.code }),
      fail: (error) => resolve({ ok: false, message: error && error.errMsg }),
    })
  }), baseUrl)
  assert(probe && probe.ok && Number(probe.code) === 200,
    `开发者工具可访问受控后端${probe && probe.message ? '：' + probe.message : ''}`)
}

async function reLaunch(mp, route) {
  try {
    await mp.reLaunch(route)
  } catch (error) {
    // DevTools 36.x 首次编译体积较大的分包时，命令响应可能先超时，但 wx.reLaunch
    // 已经被逻辑层接收。继续从公开 pageStack 回读目标页，只有目标页没出现才失败。
    if (!String(error && error.message || error).includes('timeout waiting for automator response')) throw error
  }
  const expectedPath = String(route || '').split('?')[0].replace(/^\//, '')
  const page = await eventually(async () => {
    const current = await mp.currentPage()
    return current && current.path === expectedPath ? current : null
  }, `公开路由未进入 ${expectedPath}`, 30000)
  assert(page, '公开路由进入页面')
  return page
}

async function waitForCreatorRouteRestored(page) {
  const chapters = await eventually(async () => {
    const rows = await page.$$('.slopes-chapter-hd')
    return rows.length ? rows : null
  }, '创作页没有故事章节')
  await chapters[0].tap()
  return eventually(async () => {
    const blocks = await page.$$('.story-node-block')
    for (const block of blocks) {
      const text = await block.text()
      const summary = await block.$('.story-node-block__route')
      if (text.includes('旧城门抉择') && summary && (await summary.text()).includes('下一站 2 条')) {
        return { block, summary }
      }
    }
    return null
  }, '创作端没有在原故事流节点恢复“下一站 2 条”摘要')
}

async function verifyCreator(mp, fixture) {
  console.log('\n=== M5 创作端：公开表单保存与重新进入恢复 ===')
  await mp.evaluate((key) => wx.removeStorageSync(key), 'pro_editor_draft_topic_' + CREATOR_TOPIC_ID)
  assert(true, '清除验收主题的本机草稿，确保 API 回读是唯一输入')
  let page = await reLaunch(mp, `/pages/publish/fabu/index?id=${CREATOR_TOPIC_ID}`)
  assert(String((page.query || {}).id || '') === CREATOR_TOPIC_ID, '创作页公开路由保留 topic id')
  await eventually(
    () => fixture.facts().requests.some((row) => row.path === API_TOPIC_EDIT_DETAIL),
    '创作页没有向受控后端请求 /api/topic/edit-detail',
  )
  const restored = await waitForCreatorRouteRestored(page)
  await mp.screenshot({ path: path.join(SHOT_DIR, 'creator-story-flow.png') })
  await restored.block.tap()
  const nodeRouteEntry = await element(page, '.node-route-entry', '节点详情没有“下一站”入口')
  assert((await nodeRouteEntry.text()).includes('下一站 2 条'), '节点详情只显示一行“下一站 2 条”摘要')
  await mp.screenshot({ path: path.join(SHOT_DIR, 'creator-node-detail.png') })
  await nodeRouteEntry.tap()

  const mappingRows = await eventually(async () => {
    const rows = await page.$$('.route-mapping-row')
    return rows.length === 3 ? rows : null
  }, '下一站弹层没有渲染两条玩法结果和一条默认规则')
  assert((await mappingRows[0].text()).includes('寻找历史'), '第一条玩法结果显示为寻找历史')
  assert((await mappingRows[1].text()).includes('寻找艺术'), '第二条玩法结果显示为寻找艺术')
  assert((await mappingRows[2].text()).includes('其他结果'), '弹层保留“其他结果 · 继续故事流”')
  const firstPicker = await mappingRows[0].$('picker')
  assert(firstPicker, '玩法结果提供同主题下一站选择器')
  await firstPicker.trigger('change', { value: 2 })
  const secondPicker = await mappingRows[1].$('picker')
  assert(secondPicker, '第二条玩法结果提供同主题下一站选择器')
  await secondPicker.trigger('change', { value: 1 })
  await mp.screenshot({ path: path.join(SHOT_DIR, 'creator-next-station-sheet.png') })

  const mappingDone = await element(page, '.route-mapping-sheet .node-sheet__done', '下一站弹层缺少完成按钮')
  await mappingDone.tap()
  const nodeDone = await element(page, '.pop-chapter .node-sheet__done', '完成对应后没有回到节点详情')
  await nodeDone.tap()
  const storyDone = await element(page, '.story-editor__done', '故事流没有完成按钮')
  await storyDone.tap()
  const modeCards = await page.$$('.pd-modecard')
  assert(modeCards.length >= 2, '主题内容页存在票务设置入口')
  await modeCards[1].tap()

  const submit = await element(page, '.slopes-tabbar__cta', '票务页没有保存主动作')
  await tapComponent(submit)
  const continueButton = await eventually(async () => {
    const actions = await page.$('.pc-actions')
    return actions && actions.$('cy-btn')
  }, '安全预检完成后没有出现继续发布按钮')
  await tapComponent(continueButton)
  await eventually(async () => !(await page.$('.pop-publish-check.show')),
    '继续发布后公开预检弹层没有关闭')
  const afterConfirmPage = await mp.currentPage()
  console.log('  · 继续发布后页面：' + (afterConfirmPage && afterConfirmPage.path || 'unknown'))
  await mp.screenshot({ path: path.join(SHOT_DIR, 'creator-after-confirm.png') })
  assert(true, '继续发布后公开预检弹层已关闭')

  await eventually(
    () => fixture.facts().requests.some((row) => row.path === API_TOPIC_UPDATE),
    '公开保存动作没有触发 /api/topic/update',
  )
  const update = fixture.facts().topicUpdates[0]
  const updatedGraph = update && JSON.parse(update.routeGraphJson)
  const startEdges = updatedGraph && updatedGraph.edges.filter((edge) => String(edge.fromNodeId) === '1001')
  assert(startEdges && startEdges.length === 2, '受控后端收到旧城门的两条结果对应')
  assert(startEdges.some((edge) => edge.trigger.outcomeCode === 'HISTORY' && String(edge.toNodeId) === '1003'),
    '受控后端收到“寻找历史 → 艺术支线”的新对应')
  assert(startEdges.some((edge) => edge.trigger.outcomeCode === 'ART' && String(edge.toNodeId) === '1002'),
    '受控后端收到“寻找艺术 → 历史支线”的新对应')

  // 等待编辑保存的实际跳转完成，再重进，避免迟到跳转覆盖验收路由。
  await eventually(async () => {
    const current = await mp.currentPage()
    return current && current.path !== 'pages/publish/fabu/index' ? current : null
  }, '编辑保存后没有离开创作页')
  page = await reLaunch(mp, `/pages/publish/fabu/index?id=${CREATOR_TOPIC_ID}`)
  const restoredAgain = await waitForCreatorRouteRestored(page)
  assert(fixture.facts().requests.filter((row) => row.path === API_TOPIC_EDIT_DETAIL).length >= 2,
    '重新进入确实再次读取 /api/topic/edit-detail')
  await restoredAgain.block.tap()
  const restoredEntry = await element(page, '.node-route-entry', '重新进入后没有下一站入口')
  await restoredEntry.tap()
  const restoredRows = await eventually(async () => {
    const rows = await page.$$('.route-mapping-row')
    return rows.length === 3 ? rows : null
  }, '重新进入后没有恢复结果对应')
  const restoredTexts = await Promise.all(restoredRows.slice(0, 2).map((row) => row.text()))
  console.log('  · 重新进入后的结果对应：' + restoredTexts.join(' | '))
  const restoredHistory = restoredTexts.find((text) => text.includes('寻找历史')) || ''
  const restoredArt = restoredTexts.find((text) => text.includes('寻找艺术')) || ''
  assert(restoredHistory.includes('艺术支线'),
    '重新进入后“寻找历史”仍对应艺术支线')
  assert(restoredArt.includes('历史支线'),
    '重新进入后“寻找艺术”仍对应历史支线')
  await mp.screenshot({ path: path.join(SHOT_DIR, 'creator-next-station-restored.png') })
}

async function enterRunningRoute(mp, activityId, expectedNodeName) {
  const page = await reLaunch(mp, `/pages/play/index?activityId=${activityId}`)
  const go = await element(page, '.go-btn', `玩家 ${activityId} 首屏没有 GO`)
  await go.tap()
  const start = await element(page, '.pact--main', `玩家 ${activityId} 没有开始按钮`)
  await start.tap()
  const row = await element(page, '.pcard__row', `玩家 ${activityId} 没有下一站卡`)
  const rowText = await row.text()
  assert(rowText.includes(expectedNodeName), `玩家 ${activityId} 下一站为「${expectedNodeName}」`)
  return { page, row }
}

async function visibleNextRow(page, activityId, expectedNodeName) {
  return eventually(async () => {
    const row = await page.$('.pcard__row')
    if (!row) return null
    const text = await row.text()
    return text.includes(expectedNodeName) ? row : null
  }, `玩家 ${activityId} 同页没有出现新解锁地点「${expectedNodeName}」`)
}

async function answerCurrentNode(mp, fixture, page, activityId, expectedNodeName, optionIndex, nextNodeName, screenshotName) {
  const before = fixture.facts().playerWrites.length
  const beforeNodesReads = fixture.facts().requests.filter((row) => row.path === '/api/play/nodes').length
  const row = await visibleNextRow(page, activityId, expectedNodeName)
  await row.tap()
  const sheet = await element(page, '.sheet', `玩家 ${activityId} 没有节点详情卡`)
  const startGame = await sheet.$('cy-btn')
  await tapComponent(startGame)
  const options = await eventually(async () => {
    const rows = await page.$$('.gp2__opt')
    return rows.length > optionIndex ? rows : null
  }, `玩家 ${activityId} 没有可选答案`)
  await options[optionIndex].tap()
  const submit = await element(page, '.gp2__cta', `玩家 ${activityId} 没有提交按钮`)
  await submit.tap()
  await eventually(() => fixture.facts().playerWrites.length === before + 1,
    `玩家 ${activityId} 的公开提交没有触发 ${API_PLAY_ANSWER}`)
  await eventually(
    () => fixture.facts().requests.filter((request) => request.path === '/api/play/nodes').length > beforeNodesReads,
    `玩家 ${activityId} 完成「${expectedNodeName}」后没有同页刷新 /api/play/nodes`,
  )
  if (nextNodeName) await visibleNextRow(page, activityId, nextNodeName)
  await mp.screenshot({ path: path.join(SHOT_DIR, screenshotName) })
}

async function playPlayerRoute(mp, fixture, activityId, branchName, branchOption, endingName, shotPrefix) {
  const { page } = await enterRunningRoute(mp, activityId, '旧城门抉择')
  await answerCurrentNode(mp, fixture, page, activityId, '旧城门抉择', branchOption, branchName,
    `${shotPrefix}-choice.png`)
  await answerCurrentNode(mp, fixture, page, activityId, branchName, 0, endingName,
    `${shotPrefix}-branch-unlocked.png`)
  await answerCurrentNode(mp, fixture, page, activityId, endingName, 0, '',
    `${shotPrefix}-final-submitted.png`)
  const finish = await element(page, '.finsheet', `玩家 ${activityId} 完成「${endingName}」后没有出现最终完赛面板`)
  assert((await finish.text()).includes('已通关'), `玩家 ${activityId} 的完赛面板显示已通关`)
  await mp.screenshot({ path: path.join(SHOT_DIR, `${shotPrefix}-finished.png`) })
}

async function verifyPlayers(mp, fixture) {
  console.log('\n=== M5 玩家端：同一起点的两个选项解锁两个不同结局 ===')
  const detail = fixture.request({ method: 'POST', path: API_TOPIC_EDIT_DETAIL, body: { id: CREATOR_TOPIC_ID } })
  const graph = JSON.parse(detail.body.data.topic.routeGraphJson)
  const targetOf = (fromNodeId, outcomeCode) => Number(graph.edges.find((edge) => Number(edge.fromNodeId) === fromNodeId
    && edge.trigger.outcomeCode === outcomeCode).toNodeId)
  const historyNodeId = targetOf(1001, 'HISTORY')
  const artNodeId = targetOf(1001, 'ART')
  assert(historyNodeId !== artNodeId, '两个模板结果仍对应两个不同地点')
  const branchName = { 1002: '历史支线', 1003: '艺术支线' }
  const endingName = { 1002: '历史守望者结局', 1003: '艺术漫游者结局' }
  const endingId = { 1002: 1004, 1003: 1005 }
  await playPlayerRoute(mp, fixture, PLAYER_A_ACTIVITY_ID, branchName[historyNodeId], 0,
    endingName[historyNodeId], 'player-a')
  await playPlayerRoute(mp, fixture, PLAYER_B_ACTIVITY_ID, branchName[artNodeId], 1,
    endingName[artNodeId], 'player-b')

  const facts = fixture.facts()
  const stateA = facts.sessions.find((state) => state.sessionId.endsWith(PLAYER_A_ACTIVITY_ID))
  const stateB = facts.sessions.find((state) => state.sessionId.endsWith(PLAYER_B_ACTIVITY_ID))
  assert(stateA.decisionLog.map((row) => row.toNodeId).join(',') === `${historyNodeId},${endingId[historyNodeId]},`,
    '玩家 A 权威轨迹与创作者保存的 HISTORY 对应一致')
  assert(stateB.decisionLog.map((row) => row.toNodeId).join(',') === `${artNodeId},${endingId[artNodeId]},`,
    '玩家 B 权威轨迹与创作者保存的 ART 对应一致')
  assert(stateA.status === 'COMPLETED' && stateB.status === 'COMPLETED', '两个隔离玩家会话都已最终完赛')
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  assert(API_TOPIC_UPDATE && API_TOPIC_EDIT_DETAIL && API_PLAY_ANSWER, 'HTTP 验收 seam 已声明')
  const fixtureServer = await startRouteGraphM5FixtureServer()
  let session = null
  const errors = []
  try {
    session = await openMiniProgram({
      projectPath: PROJECT_PATH,
      port: Number(process.env.WX_AUTO_PORT) || 9537,
      connectAttempts: 120,
      stackAttempts: 180,
      retryDelay: 1000,
      stackCallTimeoutMs: 10000,
    })
    session.mp.on('console', (message) => {
      if (message && message.type === 'error') errors.push(String(message.args && message.args[0] || '').slice(0, 300))
    })
    session.mp.on('exception', (message) => {
      errors.push(String(message && (message.exceptionDetails || message.message || message) || '').slice(0, 500))
    })
    await configureFixtureBase(session.mp, fixtureServer.baseUrl)
    await session.mp.mockWxMethod('showModal', { confirm: false, cancel: true })
    const phase = String(process.env.ROUTE_M5_PHASE || 'all').toLowerCase()
    assert(['all', 'creator', 'players'].includes(phase), 'ROUTE_M5_PHASE 只支持 all / creator / players')
    if (phase !== 'players') await verifyCreator(session.mp, fixtureServer.backend)
    if (phase !== 'creator') await verifyPlayers(session.mp, fixtureServer.backend)
    assert(errors.length === 0, `DevTools 控制台无 error（实际 ${errors.length}）`)
    fs.writeFileSync(path.join(SHOT_DIR, 'route-m5-facts.json'), JSON.stringify(fixtureServer.backend.facts(), null, 2))
  } catch (error) {
    console.error('[route-graph-m5] 失败时 HTTP 请求：', JSON.stringify(fixtureServer.backend.facts().requests))
    console.error('[route-graph-m5] 失败时控制台 error：', JSON.stringify(errors))
    throw error
  } finally {
    if (session) {
      try { await session.mp.restoreWxMethod('showModal') } catch (error) {}
      await closeMiniProgram(session)
    }
    await fixtureServer.close()
  }
  console.log('\nM5 DevTools 真实交互验收通过，截图与权威回读：' + SHOT_DIR)
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[route-graph-m5] 失败：', error && error.stack ? error.stack : error)
    process.exit(1)
  })
}

module.exports = {
  answerCurrentNode,
  configureFixtureBase,
  enterRunningRoute,
  playPlayerRoute,
  verifyCreator,
  verifyPlayers,
}
