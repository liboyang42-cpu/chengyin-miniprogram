// 俱乐部端「剧情与玩法」页契约(Figma J1-A 228:125 / J1-B 228:142 / J1-C 241:126)。
//
// 最重要的一条是安全闸:答案只能走 club 独立端点。玩家端的 /api/play/nodes 是玩家视角
// (揭示判据是玩家自己写的 member_spoiler_reveal,而且揭示即 0 分),把主理人的
// 「核对答案」接到那条上就是拿玩家身份开玩家的付费内容闸。断言钉的是**调用了哪条 url**,
// 不是某句文案。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_DIR = path.join(ROOT, 'pages/club/topic-story')

function read(file) {
  return fs.readFileSync(path.join(PAGE_DIR, file), 'utf8')
}

// 注释里必然要写清楚「为什么不复用 /api/play/nodes」，所以扫代码前先把注释抹掉，
// 否则这条断言会被它自己的解释性注释撞红(钉字面量的经典坑)。
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// 载入页面定义:Page/getApp/require/wx 全部由测试注入,不依赖小程序运行时。
// source 默认读磁盘;负控要喂变异后的源码时显式传,别再复制一份 new Function。
function loadPage(app, source = read('index.js')) {
  let definition = null
  const Page = (value) => { definition = value }
  /* 2026-09-08:原来这里是 path.join(ROOT,'utils',path.basename(request)) —— 把路径拍平,
     只能解析 utils/ 第一层。页面引 utils/identity/identity-policy.js 时会被拍成
     utils/identity-policy.js 而找不到,报的还是「模块不存在」这种看不出根因的错。
     改成按页面目录真实解析,与小程序运行时一致。 */
  const localRequire = (request) => require(path.resolve(ROOT, 'pages/club/topic-story', request))
  const wx = { navigateTo() {}, navigateBack() {}, switchTab() {}, getStorageSync: () => '' }
  new Function('Page', 'getApp', 'require', 'wx', source)(Page, () => app, localRequire, wx)
  return definition
}

function instantiate(definition) {
  const context = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  }
  Object.assign(context, definition)
  return context
}

// 一章两站:站1 文字作答(有答案)、站2 拍照打卡(无答案)。
function topicPayload() {
  return {
    code: '200',
    data: {
      chaptersList: [{
        id: 1,
        name: '苏州河的回声',
        description: '沿着苏州河往东走。',
        totalTime: 75,
        nodes: [
          {
            id: 101, name: '幸会咖啡', address: '静安区愚园路 68 号',
            businessTime: '19:20—19:40', imgUrl: 'a.png',
            latitude: '31.2300', longitude: '121.4500',
            cmsMemberTemplate: { id: 9001, title: '门牌线索', validationMethod: 1, players: '2–6 人', duration: 25, difficulty: '中等' },
          },
          {
            id: 102, name: '老码头补给站', address: '光复路',
            businessTime: '19:50—20:05', imgUrl: 'b.png',
            latitude: '31.2380', longitude: '121.4560',
            cmsMemberTemplate: { id: 9002, title: '到店拍一张', validationMethod: 2, players: '不限人数', duration: 10 },
          },
        ],
      }],
    },
  }
}

function loadedPage() {
  const requests = []
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    // 2026-09-08:页面按身份切浅/深色域(稿 448:* 是商家浅色版),syncViewerTheme 要读这两个。
    // 默认给俱乐部身份 —— 这个装置测的是俱乐部端行为。
    getUserRole: () => 'club',
    getUserType: () => 3,
    sendRequest(options) {
      requests.push(options)
      if (options.url === '/api/topic/info-to-user') options.success(topicPayload())
    },
  }
  /* utils/theme.js 在真机上直接读全局 getApp()。本装置用 new Function 注入的 getApp
     只对页面自己可见,被 require 进来的模块看不到 —— 装上全局的,用完还原。 */
  const prevGetApp = global.getApp
  const prevWx = global.wx
  global.getApp = () => app
  // utils/theme.js 还会调 wx.setNavigationBarColor / getStorageSync
  global.wx = { setNavigationBarColor() {}, getStorageSync: () => '', setStorageSync() {} }
  try {
    const page = instantiate(loadPage(app))
    page.onLoad({ topicId: '77', clubId: '42' })
    return { page, requests }
  } finally {
    if (prevGetApp === undefined) delete global.getApp
    else global.getApp = prevGetApp
    if (prevWx === undefined) delete global.wx
    else global.wx = prevWx
  }
}

test('答案只走 club 独立端点，页面不碰玩家端 /api/play/nodes', () => {
  const source = stripComments(read('index.js'))
  assert.ok(!source.includes('/api/play/'),
    '俱乐部看答案不得复用玩家端游玩接口')

  const { page, requests } = loadedPage()
  page.onViewAnswer({ currentTarget: { dataset: { nodeId: 101, title: '门牌线索' } } })

  const answerCall = requests.find((r) => r.url !== '/api/topic/info-to-user')
  assert.ok(answerCall, '点「查看答案」必须真的发一次请求')
  assert.equal(answerCall.url, '/api/club/topic-node-answer')
  // ⚠️ 后端是 @RequestBody 端点:不传 JSON 头就发成 urlencoded,业务一行不执行,
  //    却照样回 HTTP 200 + code:500 —— 零告警的哑火,取答案永远拿不到东西。
  //    (2026-09-03 requestbody-contract 抓出来的,这里跟着钉住,免得再退回去。)
  assert.equal((answerCall.header || {})['Content-Type'], 'application/json',
    '@RequestBody 端点必须传 JSON 头,否则参数根本进不去')
  assert.equal(typeof answerCall.data, 'string', '传 JSON 头时 body 必须是序列化后的字符串')
  const answerBody = JSON.parse(answerCall.data)
  // 服务端要靠这三个 id 做「俱乐部治理权 + 团归属 + 站点归属」三重校验，少一个就没法 fail-closed
  assert.deepEqual(Object.keys(answerBody).sort(), ['clubId', 'nodeId', 'topicId'])
  assert.equal(answerBody.clubId, '42')
  assert.equal(answerBody.topicId, '77')
  assert.equal(answerBody.nodeId, 101)
})

test('有答案/无答案两态：只有答题类玩法才给「查看答案」按钮', () => {
  const { page } = loadedPage()
  const plays = page.data.activeChapter.plays

  assert.equal(plays.length, 2)
  assert.equal(plays[0].hasAnswer, true, 'validationMethod=1 文字作答有答案')
  assert.equal(plays[1].hasAnswer, false, 'validationMethod=2 拍照打卡没有答案')
  assert.match(plays[1].badge, /无答案/, '无答案态要在角标上说清楚')

  const wxml = read('index.wxml')
  const acts = wxml.slice(wxml.indexOf('class="play-card__acts"'), wxml.indexOf('</view>', wxml.indexOf('bindtap="onViewAnswer"')))
  assert.match(acts, /bindtap="onViewTemplate"/, '「看看模板」两态都在')
  assert.match(acts, /wx:if="\{\{item\.hasAnswer\}\}"[^>]*bindtap="onViewAnswer"|bindtap="onViewAnswer"/,
    '「查看答案」必须挂在 hasAnswer 分支上')
  assert.ok(/wx:if="\{\{item\.hasAnswer\}\}"[\s\S]{0,400}?onViewAnswer/.test(acts),
    '「查看答案」不得无条件渲染 —— 无答案的玩法点了只会撞服务端 403')
})

test('路线 tab：站点按章跨章连号，站间步行只在有坐标时才画', () => {
  const { page } = loadedPage()
  const stops = page.data.chapters[0].stops

  assert.deepEqual(stops.map((s) => s.seq), [1, 2], '序号连续')
  assert.equal(stops[0].walkText, '', '第一站前面没有连接')
  assert.match(stops[1].walkText, /min 步行$/, '有坐标时给出步行估算')
})

test('页面壳与弹层遵循 DS：暗色根、T1 half 弹窗、分档 z-index', () => {
  const wxml = read('index.wxml')
  const wxss = read('index.wxss')
  const json = JSON.parse(read('index.json'))

  /* 2026-09-08:稿 448:925 / 448:1076 是这一页的**商家浅色版**(J1-A/J1-B「· 商家浅」),
     所以根节点不再恒暗,而是按身份切档。断言跟着改成「两档都在、且默认是暗」——
     钉的性质没弱化:俱乐部/玩家进来仍是纯黑,只有商家走浅色域。 */
  assert.match(wxml, /^<view class="\{\{isMerchantViewer \? 'theme-merchant' : 'theme-dark'\}\}">/,
    '按身份切档:商家浅色域,俱乐部/玩家仍恒暗')
  const storyJs = read('index.js')
  assert.match(storyJs, /policy\.isMerchantView\(/, '身份判定走统一的 identity-policy,不自己数 role')
  assert.match(storyJs, /merchantTheme\.merchantPageRestore\(\)/, '离开页面必须把主题还原')
  assert.equal(json.navigationStyle, 'custom')
  assert.equal(json.usingComponents['cy-scene-sheet'], '/components/cy/scene-sheet/index')
  assert.equal(json.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index')
  assert.match(wxml, /<cy-scene-sheet[^>]*variant="half"/, '查看答案是 T1 底部弹窗')
  assert.ok(!/variant="peek"/.test(wxml), 'peek 档已并入 half')
  assert.ok(!/^\s*z-index:\s*\d/m.test(wxss), 'z-index 必须走分档 token，不写字面量')

  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const clubPkg = appJson.subPackages.find((p) => p.root === 'pages/club')
  assert.ok(clubPkg.pages.includes('topic-story/index'), '新页面必须在 app.json 注册路由')
})

/* 注册了路由 ≠ 有人进得来。
   本页 2026-09-03 就合流并注册了,契约、截图矩阵一直在跑,但唯一的入口
   club/topic-detail 的 goStory() 停在 notReady('剧情与玩法') —— 整页造好了没人跳,
   在 9-05 日报里作为 P1 孤儿页记着。nav-route-exists 拦的是「跳向不存在的路由」,
   拦不住反过来的「页存在但没人跳」,所以这条断言补在这里。 */
test('剧情与玩法必须有真实入口:注册了路由不等于进得来', () => {
  const entries = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (!/^(node_modules|miniprogram_npm)$/.test(entry.name)) walk(abs); continue }
      if (!entry.name.endsWith('.js')) continue
      if (abs.startsWith(PAGE_DIR)) continue // 本页自己不算入口
      if (/navigateTo|redirectTo|reLaunch/.test(fs.readFileSync(abs, 'utf8'))
        && fs.readFileSync(abs, 'utf8').includes('/pages/club/topic-story/index')) {
        entries.push(path.relative(ROOT, abs))
      }
    }
  }
  walk(path.join(ROOT, 'pages'))
  assert.ok(entries.length > 0, '剧情与玩法整页没有任何入口，用户进不来')

  // 入口必须真的跳，不能是 notReady / toast 之类的占位
  const detail = fs.readFileSync(path.join(ROOT, 'pages/club/topic-detail/index.js'), 'utf8')
  const goStory = detail.slice(detail.indexOf('goStory()'), detail.indexOf('goEventOps()'))
  assert.doesNotMatch(goStory, /notReady/, 'goStory 又退回占位了')
  assert.match(goStory, /topic-story\/index\?topicId=/)
})

/* CU-C-152:「查看答案」弹层原来把完整玩法名拼进标题(「玩法名 · 答案」),
   而 cy-scene-sheet 的 .ss__title 是 white-space:nowrap + text-overflow:ellipsis,
   长玩法名必然在右侧截成「隔离走查·口令换券 · 答...」。改成标题只留「答案」,
   玩法名降为可换行的副信息。钉的是「标题不再拼接 + 副信息走能换行的样式」。 */
test('答案弹层标题只留「答案」,玩法名作可换行副信息,不再被 nowrap 截断', () => {
  const { page } = loadedPage()
  page.onViewAnswer({ currentTarget: { dataset: { nodeId: 101, title: '隔离走查·口令换券' } } })
  assert.equal(page.data.answerTitle, '答案', '弹层标题必须是简短的「答案」,不能拼玩法名')
  assert.equal(page.data.answerNodeName, '隔离走查·口令换券', '玩法名要作为副信息单独留一份')
  const wxml = read('index.wxml')
  assert.match(wxml, /class="ans__node"[^>]*>\{\{answerNodeName\}\}/, '副信息要在弹层正文里渲染出来')
  const wxss = read('index.wxss')
  const node = /\.ans__node\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(node, '副信息缺样式规则')
  assert.doesNotMatch(node[1], /white-space:\s*nowrap/, '副信息必须能换行,否则又是一个被截断的长名')
})

test('负控:CU-C-152 把玩法名重新拼回标题必须判红', () => {
  const mutated = read('index.js').replace(
    "answerTitle: '答案',",
    "answerTitle: (title ? title + ' · ' : '') + '答案',",
  )
  assert.notEqual(mutated, read('index.js'), '负控变异注入失败:onViewAnswer 的标题锚点要先同步')
  const app = { globalData: {}, getUserRole: () => 'club', getUserType: () => 3, sendRequest() {} }
  const context = instantiate(loadPage(app, mutated))
  context.onViewAnswer({ currentTarget: { dataset: { nodeId: 101, title: '隔离走查·口令换券' } } })
  assert.throws(() => assert.equal(context.data.answerTitle, '答案'), /答案/)
})
