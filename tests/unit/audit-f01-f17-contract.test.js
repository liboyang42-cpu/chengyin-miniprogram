'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const copyRoots = ['pages', 'components', 'subpackageA', 'subpackageB', 'subpackageMember', 'subpackageP3', 'subpackagePrefab', 'subpackageRoam', 'utils', 'custom-tab-bar']

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(target) : [target]
  })
}

function visibleCopy(file, source) {
  if (file.endsWith('.wxml')) {
    const markup = source.replace(/<!--[\s\S]*?-->/g, '')
    return [
      ...[...markup.matchAll(/>([^<]+)</g)].map((match) => match[1]),
      ...[...markup.matchAll(/(?:aria-label|placeholder|title|label)="([^"]+)"/g)].map((match) => match[1]),
    ]
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2])
}

function engineeringCopyIssues(file, source) {
  const internalOnly = file.endsWith('utils/checkout/checkout-workflow.js')
    ? new Set(['该幂等键对应的报名已'])
    : new Set()
  return visibleCopy(file, source).filter((text) =>
    /服务端|服务器|幂等|回执|状态码|接口不下发/.test(text) && !internalOnly.has(text),
  )
}

test('F08/F10/F16 主包资源与自定义组件 WXSS 合同已收口', () => {
  const roam = read('utils/roam-hangout.js')
  const profile = read('components/cy/profile/index.wxml')
  const tabbar = read('components/tabBar/index.wxss')
  assert.match(roam, /HANGOUT_FALLBACK_ICON = '\/images\/d_smapicon\.png'/)
  assert.ok(fs.existsSync(path.join(root, 'images/d_smapicon.png')))
  assert.doesNotMatch(profile, /levelId==1[^>]*group1\.png/)
  assert.doesNotMatch(tabbar, /@import\s+['"]\/style\/lib\.wxss/)
  assert.match(tabbar, /\.flex-cb\s*\{/)
  assert.match(tabbar, /\.flex-cc\s*\{/)
})

test('F03 两个上传入口保留失败缩略图并提供原图重试', () => {
  const app = read('app.js')
  const activityJs = read('pages/publish/activity/index.js')
  const activityWxml = read('pages/publish/activity/index.wxml')
  const clubJs = read('pages/club/apply/index.js')
  const clubWxml = read('pages/club/apply/index.wxml')
  assert.match(app, /options\.onUploadStart/)
  assert.match(app, /options\.onUploadDone\(r, filePaths\)/)
  assert.match(activityWxml, /error-indexes="\{\{coverErrorIndexes\}\}"/)
  assert.match(activityWxml, /bind:retry="retryCoverUpload"/)
  assert.match(activityJs, /_coverTempPath/)
  assert.match(clubWxml, /error-indexes="\{\{certErrorIndexes\}\}"/)
  assert.match(clubWxml, /bind:retry="retryCert"/)
  assert.match(clubJs, /r\.results\[index\] \|\| path/)
})

test('F11/F12 角色卡用玩家语言且会话未准备时不给确认入口', () => {
  const js = read('pages/play/index.js')
  const wxml = read('pages/play/index.wxml')
  assert.doesNotMatch(js, /服务端为你冻结的本局身份|被授权查看的线索/)
  assert.match(js, /这是你今晚的身份。留意角色线索/)
  assert.match(wxml, /roleCard\.confirmed \|\| \(gameModule\.enabled && gameModule\.activityId\)/)
  assert.match(wxml, /本局身份还在准备中/)
  assert.match(wxml, /bindtap="retryGameModule"/)
})

test('F13 已确认的工程术语不再出现在用户可见文案', () => {
  const files = copyRoots.flatMap((dir) => filesUnder(path.join(root, dir)))
    .filter((file) => /\.(?:js|wxml)$/.test(file))
  const issues = files.flatMap((file) => engineeringCopyIssues(file, fs.readFileSync(file, 'utf8'))
    .map((text) => `${path.relative(root, file)}: ${text}`))
  assert.deepEqual(issues, [])
  assert.deepEqual(engineeringCopyIssues('pages/example.js', "toast('服务端回执读取失败')"), ['服务端回执读取失败'])
})

test('F14 票夹四类状态恢复为可见文字，不只藏在 aria-label', () => {
  const wxml = read('subpackageMember/signup/index.wxml')
  assert.match(wxml, /class="ticket-name__state"/)
  assert.match(wxml, /tk\.label\(ticketList\[currentSwiperTicket\]\)/)
})

test('F17 共享活动详情的可空头像在传入 cy-avatar 前归一为空串', () => {
  const wxml = read('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(wxml, /src="\{\{hostAvatar \|\| ''\}\}"/)
  assert.match(wxml, /src="\{\{item\.avatar \|\| ''\}\}"/)
  assert.match(wxml, /src="\{\{registrant\.avatar \|\| ''\}\}"/)
})
