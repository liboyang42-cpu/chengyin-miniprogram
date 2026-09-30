const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const source = '../../pages/roam/index.js'
let config, app, values, calls, sessions, loseBootstrap
const SID = '9007199254740993'
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)) }
function mount() {
  delete require.cache[require.resolve(source)]
  require(source)
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = patch => Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.'); let object = page.data
    parts.slice(0, -1).forEach(p => { object = object[p] || (object[p] = {}) })
    object[parts.at(-1)] = value
  })
  page._loadIntroTopics = () => {}; page._fetchShopBadgeCfg = () => {}
  page._stopClock = () => {}; page._stopReal = () => {}; page._triggerCelebration = () => {}
  page.onLoad({})
  return page
}
beforeEach(() => {
  calls = []; sessions = {}; values = {}; loseBootstrap = true
  global.Page = x => { config = x }
  app = { getUserID: () => '9', globalData: { user_id: '9', features: {} }, isDevEnv: () => false,
    sendRequest(o) {
      calls.push({ url: o.url, data: o.data })
      const key = app.getUserID() + ':' + o.data.clientSessionKey
      if (o.url === '/api/roam/reveal') {
        sessions[key] = sessions[key] || { state: 'ACTIVE', sessionId: SID, clientSessionKey: o.data.clientSessionKey }
        if (loseBootstrap) { loseBootstrap = false; o.successStatusAbnormal({ statusCode: 502 }); return }
        o.success({ code: 200, data: { sessionId: SID } }); return
      }
      if (o.url === '/api/roam/session') { o.success({ code: 200, data: sessions[key] || { state: 'NOT_FOUND' } }); return }
      if (o.url === '/api/roam/finish') { throw new Error('must not finish without an earlier ending intent') }
      o.fail && o.fail({})
    },
  }
  global.getApp = () => app
  global.wx = {
    getStorageSync: k => values[k], setStorageSync: (k, v) => { values[k] = JSON.parse(JSON.stringify(v)) },
    getRandomValues: o => o.success({ randomValues: new Uint8Array(16).fill(17).buffer }),
    getWindowInfo: () => ({ statusBarHeight: 20 }), getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast() {}, hideLoading() {}, showLoading() {},
  }
})

test('结算完成后主动GO开启独立新会话，不重用已完成关联', async () => {
  loseBootstrap = false
  const page = mount(); page._pendingTiles = ['wtw3sjq']; await page._flushReveal()
  const previousKey = page._clientSessionKey
  page._pois = [{ id: 77, cat: 'merchant', name: '旧轮已探', state: 'done' }]
  page._applyRoamFinishResult({ totalXp: 1 }, true)
  wx.getRandomValues = o => o.success({ randomValues: new Uint8Array(16).fill(18).buffer })
  wx.getLocation = () => {}
  page.data.introCards = []; page.goStart()
  assert.deepEqual(page._pois, [])
  page._pendingTiles = ['wtw3sjr']; await page._flushReveal()
  assert.notEqual(page._clientSessionKey, previousKey)
  assert.equal(Object.keys(sessions).length, 2)
  assert.equal(calls.filter(c => c.url === '/api/roam/reveal').at(-1).data.sessionId, '0')
})

test('首批确认后本机保存失败不得结算，恢复存储后仍用同会话排空再完成', async () => {
  loseBootstrap = false
  const original = app.sendRequest
  let failStorage = true
  const write = wx.setStorageSync
  wx.setStorageSync = (key, value) => {
    if (failStorage && key.endsWith(':recovery') && value && value.sessionId) throw new Error('quota')
    write(key, value)
  }
  app.sendRequest = o => {
    if (o.url !== '/api/roam/finish') return original(o)
    calls.push({ url: o.url, data: o.data }); o.success({ code: 200, data: { totalXp: 1 } })
  }
  const page = mount(); page._pendingTiles = ['wtw3sjq']; page._pois = []
  page.data.screen = 'map'; page._arrive(); await settle()
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 0)
  assert.deepEqual(values['roam_memory_v1:9:recovery'].pendingTiles, ['wtw3sjq'])
  failStorage = false
  const cold = mount(); await settle()
  assert.equal(cold.data.finish.xpAwarded, 1)
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
  assert.equal(Object.keys(sessions).length, 1)
})

test('恢复核对期间重复点击只发送一个查询，未返回前不写', async () => {
  const page = mount(); page._pendingTiles = ['wtw3sjq']; await page._flushReveal()
  let query
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url !== '/api/roam/session') return original(o)
    calls.push({ url: o.url, data: o.data }); query = o
  }
  page._recoveryNeedsLookup = true
  const first = page.recoverRoam(); const second = page.recoverRoam()
  assert.equal(first, second)
  assert.equal(calls.filter(c => c.url === '/api/roam/session').length, 1)
  assert.equal(calls.filter(c => c.url === '/api/roam/reveal').length, 1)
  query.success({ code: 200, data: sessions[Object.keys(sessions)[0]] }); await first
  assert.deepEqual(page._pendingTiles, [])
})

test('零格子尚无服务端会话时保留本机记录并可主动继续，不虚报结算', async () => {
  const page = mount(); page._pois = []; page.data.screen = 'map'
  page._arrive(); await settle()
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 0)
  assert.equal(page.data.recoveryCanContinue, true)
  assert.equal(page.data.finish.xpAwarded, undefined)
  page.continueUnstartedRoam()
  assert.equal(page._finishRequested, false)
  assert.equal(page.data.screen, 'entry-map', '没有可恢复格子时回到新的真实地图入口，不直接进入旧 intro')
  assert(values['roam_memory_v1:9:recovery'])
  loseBootstrap = false; page._pendingTiles = ['wtw3sjq']; await page._flushReveal()
  assert.equal(Object.keys(sessions).length, 1)
})

test('历史存档写失败后结算事实仍保留恢复记录，修复存储后重建本次存档', async () => {
  loseBootstrap = false
  const write = wx.setStorageSync
  let failArchive = true
  wx.setStorageSync = (key, value) => {
    if (failArchive && key.endsWith(':sessions')) throw new Error('archive unavailable')
    write(key, value)
  }
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url !== '/api/roam/finish') return original(o)
    calls.push({ url: o.url, data: o.data })
    sessions[Object.keys(sessions)[0]].state = 'FINISHED'
    sessions[Object.keys(sessions)[0]].result = { totalXp: 1 }
    sessions[Object.keys(sessions)[0]].resultComplete = true
    o.success({ code: 200, data: { totalXp: 1 } })
  }
  const page = mount(); page._pois = []; page._pendingTiles = ['wtw3sjq']; page.data.screen = 'map'
  page._arrive(); await settle()
  assert(values['roam_memory_v1:9:recovery'])
  failArchive = false
  const cold = mount(); cold._pois = []; await settle()
  assert.equal(values['roam_memory_v1:9:sessions'][0].xpAwarded, 1)
  assert.equal(values['roam_memory_v1:9:sessions'][0].sessionId, SID)
  assert.equal(values['roam_memory_v1:9:recovery'], null)
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
})

test('首次reveal已提交但丢回包，冷重进精确找回同sid并确认原格子，不自动结束', async () => {
  const first = mount(); first._pendingTiles = ['wtw3sjq']
  await first._flushReveal(); await settle()
  const second = mount(); await settle()
  assert.equal(second._roamSid, SID)
  assert.deepEqual(second._pendingTiles, [])
  assert.equal(Object.keys(sessions).length, 1)
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 0)
  assert(calls.some(c => c.url === '/api/roam/session'))
})

test('已有结束意图在冷重进后先确认原格子，再只执行一次结算', async () => {
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url !== '/api/roam/finish') return original(o)
    calls.push({ url: o.url, data: o.data })
    o.success({ code: 200, data: { totalXp: 7 } })
  }
  const first = mount(); first._pendingTiles = ['wtw3sjq']; first._pois = []; first._dist = 10
  first.data.screen = 'map'; first._arrive(); await settle()
  const second = mount(); await settle()
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
  assert.equal(second.data.finish.xpAwarded, 7)
})

test('finish已提交但timeout，冷重进只回读原结果，不重复奖励请求', async () => {
  loseBootstrap = false
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url !== '/api/roam/finish') return original(o)
    calls.push({ url: o.url, data: o.data })
    const key = Object.keys(sessions)[0]
    sessions[key] = { ...sessions[key], state: 'FINISHED', resultComplete: true, result: { totalXp: 7, medal: '原结算徽章' } }
    o.fail({ errMsg: 'request:fail timeout' })
  }
  const first = mount(); first._pendingTiles = ['wtw3sjq']; first._pois = []; first._dist = 10
  first.data.screen = 'map'; first._arrive(); await settle()
  assert.equal(first.data.finish.settleErr, 'unknown')
  const second = mount(); await settle()
  assert.equal(second.data.finish.xpAwarded, 7)
  assert.equal(second.data.finish.medal, '原结算徽章')
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
})

test('存储失败时不发首笔写，请求中的失败不覆盖已保存key', async () => {
  wx.setStorageSync = () => { throw new Error('quota') }
  const page = mount(); page._pendingTiles = ['wtw3sjq']
  assert.equal(await page._flushReveal(), false)
  assert.equal(calls.filter(c => c.url === '/api/roam/reveal').length, 0)
  assert.deepEqual(page._pendingTiles, ['wtw3sjq'])
  assert.match(page.data.recoveryError, /保存/)
})

test('核对网络失败不当NOT_FOUND，不重新创建且保留原格子', async () => {
  const first = mount(); first._pendingTiles = ['wtw3sjq']; await first._flushReveal(); await settle()
  const original = app.sendRequest
  app.sendRequest = o => o.url === '/api/roam/session' ? o.fail({}) : original(o)
  const second = mount(); await settle()
  assert.deepEqual(second._pendingTiles, ['wtw3sjq'])
  assert.equal(calls.filter(c => c.url === '/api/roam/reveal').length, 1)
  assert.match(second.data.recoveryError, /核对/)
})

for (const mode of ['timeout', 'missingSid']) test('首次' + mode + '后精确查询再重放同key，不盲建会话', async () => {
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url === '/api/roam/reveal' && loseBootstrap) {
      o.successStatusAbnormal = () => mode === 'timeout' ? o.fail({}) : o.success({ code: 200, data: {} })
      return original(o)
    }
    return original(o)
  }
  const first = mount(); first._pendingTiles = ['wtw3sjq']; await first._flushReveal(); await settle()
  assert.equal(first._revealBootstrapUnknown, true)
  const second = mount(); await settle()
  assert.equal(second._roamSid, SID)
  assert.equal(Object.keys(sessions).length, 1)
})

test('常驻页切号后隔离恢复记录，切回原账号还能继续原会话', async () => {
  const page = mount(); page._pendingTiles = ['wtw3sjq']; await page._flushReveal(); await settle()
  page._pois = [{ id: 77, cat: 'merchant', name: '前账号已探', state: 'done' }]
  app.getUserID = () => '10'; page.onShow(); await settle()
  assert.equal(page._roamSid, 0)
  assert.deepEqual(page._pendingTiles, [])
  assert.equal(page._roamMemory.playerId, '10')
  assert.deepEqual(page._pois, [])
  app.getUserID = () => '9'; page.onShow(); await settle()
  assert.equal(page._roamSid, SID)
  assert.deepEqual(page._pendingTiles, [])
})

test('Standards: ACTIVE恢复后新增距离再次冷进必须保留', async () => {
  loseBootstrap = false
  const first = mount(); first._pendingTiles = ['wtw3sjq']; first._dist = 10
  await first._flushReveal()
  const second = mount(); await settle()
  second._dist = 50; second._pendingTiles = ['wtw3sjr']; await second._flushReveal()
  const third = mount(); await settle()
  assert.equal(third._dist, 50)
})
test('Standards: 未知首批后结束且lookup失败仍持久化结束意图', async () => {
  const page = mount(); page._pendingTiles = ['wtw3sjq']; await page._flushReveal()
  const original = app.sendRequest
  app.sendRequest = o => o.url === '/api/roam/session' ? o.fail({errMsg:'timeout'}) : original(o)
  page.data.screen = 'map'; page._pois = []; page._arrive(); await settle()
  assert.equal(values['roam_memory_v1:9:recovery'].finishRequested, true)
  app.sendRequest = o => {
    if (o.url !== '/api/roam/finish') return original(o)
    calls.push({ url: o.url, data: o.data }); o.success({ code: 200, data: { totalXp: 1 } })
  }
  const cold = mount(); await settle()
  assert.equal(cold.data.finish.xpAwarded, 1)
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
  assert.equal(Object.keys(sessions).length, 1)
})
test('Standards: 足迹存档静默不写时不得清除唯一恢复记录', async () => {
  loseBootstrap = false
  const write = wx.setStorageSync
  wx.setStorageSync = (key,value) => { if (!key.endsWith(':sessions')) write(key,value) }
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url !== '/api/roam/finish') return original(o)
    calls.push({ url: o.url, data: o.data })
    Object.assign(sessions[Object.keys(sessions)[0]], { state: 'FINISHED', resultComplete: true, result: { totalXp: 1 } })
    o.success({code:200,data:{totalXp:1}})
  }
  const page = mount(); page._pendingTiles = ['wtw3sjq']; page._pois=[]; page.data.screen='map'
  page._arrive(); await settle()
  assert.ok(values['roam_memory_v1:9:recovery'])
  wx.setStorageSync = write
  mount(); await settle()
  assert.equal(values['roam_memory_v1:9:sessions'][0].xpAwarded, 1)
  assert.equal(values['roam_memory_v1:9:sessions'][0].sessionId, SID)
  assert.equal(values['roam_memory_v1:9:recovery'], null)
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
})

test('Spec: ACTIVE恢复后真实GO初始化及异步商家刷新保留本次done，再结束存档不丢', async () => {
  loseBootstrap = false
  const first = mount(); first._pendingTiles = ['wtw3sjq']
  first._pois = [{ id: 77, cat: 'merchant', name: '已探店', nameKnown: true, state: 'done', lat: 31, lng: 121 }]
  await first._flushReveal()
  const page = mount(); await settle()
  const original = app.sendRequest
  app.recordConsent = () => Promise.resolve()
  app.sendRequest = o => {
    if (o.url === '/api/map/nearby') {
      o.success({ code: 200, data: [{ nodeId: 77, id: 1, addressName: '已探店', latitude: 31, longitude: 121 }] }); return
    }
    if (o.url === '/api/roam/finish') { calls.push({ url: o.url, data: o.data }); o.success({ code: 200, data: { totalXp: 1 } }); return }
    return original(o)
  }
  page._disposeFogRenderer = () => {}; page._mapLoadWatch = () => {}
  page._genIcons = () => Promise.resolve(); page._syncMarkers = () => {}; page._syncSparkCircles = () => {}
  page._fetchRoamTiles = () => {}; page._fetchRoamPois = () => {}; page._seenSweepHistory = () => {}
  wx.getLocation = o => o.success({ latitude: 31, longitude: 121 })
  page.data.introCards = []; page.goStart(); clearTimeout(page._roamOpeningTimer); clearTimeout(page._fogOpenTimer); await settle()
  const done = page._pois.filter(p => p.state === 'done')
  assert.equal(done.length, 1)
  assert.equal(done[0].id, 77)
  page._saveRoamRecovery()
  assert.equal(values['roam_memory_v1:9:recovery'].pois.length, 1)
  page.data.screen = 'map'; page._arrive(); await settle()
  assert.equal(page.data.finish.shops, 1)
  assert.equal(values['roam_memory_v1:9:sessions'][0].pois[0].id, 77)
  assert.equal(calls.filter(c => c.url === '/api/roam/finish').length, 1)
})

test('Standards v2: 切号后的旧POI读取不能把旧账号found带入新账号地图', async () => {
  const page = mount(); let oldRead
  const original = app.sendRequest
  app.sendRequest = o => {
    if (o.url === '/api/roam/pois') { oldRead=o; return }
    return original(o)
  }
  page._genIcons=()=>Promise.resolve(); page._syncMarkers=()=>{}; page._syncSparkCircles=()=>{}; page._syncGoal=()=>{}
  page._fetchRoamPois({lat:31,lng:121}); await settle()
  assert.ok(oldRead)
  app.getUserID=()=> '10'; page.onShow(); await settle()
  assert.equal(page._roamMemory.playerId,'10')
  oldRead.success({code:200,data:[{id:77,type:1,name:'old account found',lat:31,lng:121,found:true}]}); await settle()
  assert.equal(page._pois.some(p=>p.id==='r77'),false)
})

for (const boundary of ['account', 'newSession']) test('等待nearby时' + boundary + '变化不再发旧POI请求，当前会话可正常重试', async () => {
  const page = mount(); let resolveNearby; const pending = []
  page._nearbyReady = new Promise(resolve => { resolveNearby = resolve })
  const original = app.sendRequest
  app.sendRequest = o => { if (o.url === '/api/roam/pois') { pending.push(o); return } return original(o) }
  page._genIcons = () => Promise.resolve(); page._syncMarkers = () => {}; page._syncSparkCircles = () => {}; page._syncGoal = () => {}
  page._fetchRoamPois({ lat: 31, lng: 121 })
  if (boundary === 'account') { app.getUserID = () => '10'; page.onShow() } else page._resetRoamRecoverySession()
  resolveNearby(); await settle(); assert.equal(pending.length, 0)
  page._nearbyReady = Promise.resolve(); page._fetchRoamPois({ lat: 31, lng: 121 }); await settle()
  pending[0].fail({ errMsg: 'timeout' }); await settle(); assert.equal(page.data.poiOffline, true)
  page._fetchRoamPois({ lat: 31, lng: 121 }); await settle()
  pending[1].success({ code: 200, data: [{ id: 88, type: 1, name: '当前地点', lat: 31, lng: 121, found: false }] }); await settle()
  // 2026-09-16 C-09:真 POI 的 marker id 从字符串 'r88' 改成数字段 700000+id(微信 <map> 数字契约)
  assert.equal(page.data.poiOffline, false); assert.equal(page._pois[0].id, 700088); assert.equal(page._pois[0]._roamId, 88); assert.equal(page._pois[0].state, 'fog')
})

for (const route of ['/api/map/nearby', '/api/roam/tiles/page']) test('同初始化链旧' + route + '回包不得改新账号地图或本机桶', async () => {
  const page = mount(); let oldRead
  page._pois = []; page._localTiles = {}; page._syncMarkers = () => {}; page._syncSparkCircles = () => {}
  const original = app.sendRequest
  app.sendRequest = o => { if (o.url === route) { oldRead = o; return } return original(o) }
  if (route === '/api/map/nearby') page._fetchNearbyMerchants({ lat: 31, lng: 121 }); else page._fetchRoamTiles()
  await settle(); app.getUserID = () => '10'; page.onShow(); await settle()
  page._localTiles = { newAccountOnly: 1 }
  if (route === '/api/map/nearby') oldRead.success({ code: 200, data: [{ nodeId: 77, latitude: 31, longitude: 121, addressName: '旧店' }] })
  else oldRead.success({ code: 200, data: { tiles: ['wtw3sjq'], nextAfterId: 1, hasMore: false } })
  await settle()
  assert.deepEqual(page._pois, [])
  assert.deepEqual(page._localTiles, { newAccountOnly: 1 })
  assert.equal(JSON.stringify(values).includes('newAccountOnly'), false)
})

test('同账号主动新一轮后旧POI回包不能填入passed或覆盖新轮加载状态', async () => {
  const page = mount(); let oldRead
  const original = app.sendRequest
  app.sendRequest = o => { if (o.url === '/api/roam/pois') { oldRead = o; return } return original(o) }
  page._fetchRoamPois({ lat: 31, lng: 121 }); await settle()
  page._roamCompleted = true; page.data.introCards = []; wx.getLocation = () => {}; page.goStart()
  page.setData({ poiOffline: true })
  oldRead.success({ code: 200, data: [{ id: 77, type: 1, name: '旧轮地点', lat: 31, lng: 121, found: true }] }); await settle()
  assert.deepEqual(page._pois, [])
  assert.equal(page.data.poiOffline, true)
})

test('换账号清空入口缓存和弹层，旧回包不能恢复上一账号入口', async () => {
  const page = mount();
  const pending = [];
  app.sendRequest = options => pending.push(options);
  page._entryItems = [{ id: 1, kind: 'activity', registered: true }];
  page._entryTeams = [{ teamId: 2 }];
  page.setData({ entryCards: [{ id: 1 }], entryActivity: { registered: true }, entryTeam: { teamId: 2 }, entrySheet: 'activity' });
  page._loadEntryMap({ lat: 31, lng: 121 });
  app.getUserID = () => '10';
  page._resetRoamRecoverySession();
  pending[0].success({ code: 200, data: { items: [{ id: 1, kind: 'activity', registered: true }] } });
  pending[1].success({ code: 200, data: [{ teamId: 2 }] });
  await settle();
  assert.deepEqual(page._entryItems, []);
  assert.deepEqual(page._entryTeams, []);
  assert.deepEqual(page.data.entryCards, []);
  assert.equal(page.data.entryActivity, null);
  assert.equal(page.data.entryTeam, null);
  assert.equal(page.data.entrySheet, '');
});
