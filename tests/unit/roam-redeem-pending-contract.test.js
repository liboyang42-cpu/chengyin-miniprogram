'use strict'

// CU-M-54 「已打卡待核销」在漫游地图上必须是独立一档:
//   病灶:本地把打卡成功当完成(无条件发 completed),重进只看服务端 found(核销前仍是
//         passed)→ 同一站在地图上先亮后灭,而详情里仍能出示核销码。
//   修法:服务端 /api/roam/pois 多回一档 pending_redeem(status=0 且配了券),前端按它
//         回归成 pendingRedeem → 合同里的 redeem-pending 态(marker / 读屏都单列)。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { roamPoiLocalState } = require('../../utils/roam-poi-state.js')
const { getRoamPoiState, getPlayMapState, buildMapA11yLabel } = require('../../utils/play-state-contract.js')

let pageConfig
let requests
const storage = {}

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')]
  require('../../pages/roam/index.js')
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let cursor = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
      })
      cursor[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  return page
}

global.getApp = () => ({
  getUserID: () => '9',
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest(options) { requests.push(options) },
})

global.Page = (config) => { pageConfig = config }

global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  createSelectorQuery: () => ({ select() { return this }, fields() { return this }, exec(callback) { callback([]) } }),
  showToast() {},
  hideLoading() {},
  showLoading() {},
}

test.beforeEach(() => {
  pageConfig = null
  requests = []
  Object.keys(storage).forEach((key) => { delete storage[key] })
})

test('CU-M-54 服务端行 → 本地点位态:待核销不能读成 passed', () => {
  assert.equal(roamPoiLocalState({ found: true, pendingRedeem: true }), 'pendingRedeem')
  assert.equal(roamPoiLocalState({ found: true, pendingRedeem: false }), 'passed')
  assert.equal(roamPoiLocalState({ found: false, pendingRedeem: false }), 'fog')
  // 只认严格的 true:字段缺失(旧后端/旧缓存)照旧回落,不能凭空把点标成待核销
  assert.equal(roamPoiLocalState({ found: true }), 'passed')
  assert.equal(roamPoiLocalState(null), 'fog')
})

test('CU-M-54 待核销在状态合同里是独立态,读屏不与已完成混为一谈', () => {
  assert.equal(getRoamPoiState({ id: 1, state: 'pendingRedeem' }, { active: false }), 'redeem-pending')
  assert.equal(getPlayMapState('redeem-pending').mapLabel, '待核销')
  assert.match(buildMapA11yLabel([{ nodeId: 1, state: 'redeem-pending' }], null), /待核销 1处/)
})

test('CU-M-54 重进地图:服务端 pendingRedeem 让这一站仍是待核销,不再是候选', async () => {
  const page = loadRoamPage()
  page._nearbyReady = Promise.resolve()
  page._pois = []
  const pending = page._fetchRoamPois({ lat: 31.2, lng: 121.5 })
  await Promise.resolve()
  requests[0].success({
    code: '200',
    data: [
      { id: 21, name: '待核销据点', type: 2, lat: 31.2, lng: 121.5, found: true, pendingRedeem: true },
      { id: 22, name: '已核销据点', type: 2, lat: 31.21, lng: 121.5, found: true, pendingRedeem: false },
      { id: 23, name: '没去过', type: 1, lat: 31.22, lng: 121.5, found: false },
    ],
  })
  await pending

  const byRoamId = {}
  ;(page._pois || []).forEach((poi) => { byRoamId[poi._roamId] = poi.state })
  assert.equal(byRoamId[21], 'pendingRedeem')
  assert.equal(byRoamId[22], 'passed')
  assert.equal(byRoamId[23], 'fog')

  const a11y = buildMapA11yLabel((page._pois || []).map((poi) => ({ nodeId: poi.id, state: getRoamPoiState(poi, {}) })), null)
  assert.match(a11y, /待核销 1处/)
})

test('CU-M-54 打卡回调:needRedeem 记待核销,无券才记已完成', () => {
  const page = loadRoamPage()
  page._pois = [{ id: 1, _roamId: 21, state: 'seen' }, { id: 2, _roamId: 22, state: 'seen' }]
  page._foundRoamPois = {}
  page._syncMarkers = () => {}
  page._syncSparkCircles = () => {}
  page._syncGoal = () => {}

  page.onScenePoiCompleted({ detail: { poiId: 21, needRedeem: true } })
  page.onScenePoiCompleted({ detail: { poiId: 22, needRedeem: false } })
  assert.equal(page._pois[0].state, 'pendingRedeem')
  assert.equal(page._pois[1].state, 'done')

  // 待核销的点不能被后续商家/POI 图层重拉合并掉(合并口径与 done 同一档)
  const merged = page._mergeSessionDonePois([{ id: 1, name: '待核销据点' }])
  assert.equal(merged[0].state, 'pendingRedeem')
})

test('CU-M-54 待核销 marker 保持统一状态图标,不换成店头形象(与 target 同类)', () => {
  const page = loadRoamPage()
  page._icons = { 'state-redeem-pending': '/tmp/redeem.png', 'state-candidate': '/tmp/candidate.png' }
  page._npcIconPending = true   // 让 _genNpcIcons 早退,本用例只关心 marker 的图标选择
  page._pois = [{ id: 1, _roamId: 21, lat: 31.2, lng: 121.5, state: 'pendingRedeem', cat: 'merchant', isCityNode: true, mapAvatar: 'https://cdn/avatar.png' }]
  page._syncMarkers()
  const marker = (page.data.markers || [])[0]
  assert.ok(marker, '待核销的点必须出现在地图上')
  assert.equal(marker.iconPath, '/tmp/redeem.png')
})

test('CU-M-54 后端投影:pois 查询带出 pending_redeem,不改表也不改写入路径', () => {
  const xml = read('../chengyinhub-system/src/main/resources/mapper/business/RoamMapper.xml')
  const select = xml.slice(xml.indexOf('id="selectPoisNear"'), xml.indexOf('id="selectPoisByIds"'))
  assert.match(select, /r\.status = 0 and r\.coupon_id > 0\)\) as pending_redeem/)
  const entity = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/domain/RoamPoi.java')
  assert.match(entity, /private Boolean pendingRedeem;/)
  const page = read('pages/roam/index.js')
  assert.match(page, /roamPoiLocalState\(n\)/)
})
