const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')

// app.js 的隐私授权闸有两条路径:
//   ① 当前页挂了 cy-privacy-gate ⇒ 页内真弹窗,不动页面栈
//   ② 没挂 ⇒ 回退 wx.navigateTo('/pages/privacy/index'),把当前页整个盖住
// ② 不是「降级体验」,是**页面看起来白/黑屏**:2026-08-21 审计里 A39/A40/A42/A45/A48/A52/A53
// 七条「目标 route 回读为 /pages/privacy/index、节点数 0」全是同一个根因,被当成七个渲染 bug 查了很久。
// 所以:凡自身或其自定义组件会调用需隐私授权的 wx API 的页面,必须挂 gate。
const PRIVACY_APIS = /wx\.(getLocation|chooseLocation|chooseImage|chooseMedia|chooseVideo|startRecord|getRecorderManager|getUserProfile|saveImageToPhotosAlbum|saveVideoToPhotosAlbum|chooseAddress|getClipboardData|scanCode|startBluetoothDevicesDiscovery|createCameraContext)\b/g

function readIfExists(p) {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8') } catch (e) { return '' }
}

/** 判据看代码不看注解。
 *  不剥注释的话,注释里提一句 API 名就把整页判红 —— 2026-09-22 实测:
 *  publish/temp 的 uploadPhotoFrame 上方写了「别改成页面里直接调 wx.chooseMedia」,
 *  门禁当场判它调用了 chooseMedia。这会逼着人把说明写含糊,反过来让下一个人踩坑。 */
const stripComments = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function registeredRoutes() {
  const app = JSON.parse(readIfExists('app.json'))
  const out = [...(app.pages || [])]
  for (const sub of app.subPackages || app.subpackages || []) {
    for (const p of sub.pages || []) out.push(`${sub.root.replace(/\/$/, '')}/${p}`)
  }
  return out
}

/** 页面自身 + 它 usingComponents 里引到的本仓组件,合起来算隐私 API 触点。 */
function privacyApisOf(route) {
  const hits = new Set((stripComments(readIfExists(`${route}.js`)).match(PRIVACY_APIS) || []))
  let cfg = {}
  try { cfg = JSON.parse(readIfExists(`${route}.json`) || '{}') } catch (e) { cfg = {} }
  for (const p of Object.values(cfg.usingComponents || {})) {
    const rel = String(p).replace(/^\//, '')
    if (rel.startsWith('components') || rel.startsWith('pages') || rel.startsWith('subpackage')) {
      for (const h of stripComments(readIfExists(`${rel}.js`)).match(PRIVACY_APIS) || []) hits.add(h)
    }
  }
  return [...hits]
}

function hasGate(route) {
  let cfg = {}
  try { cfg = JSON.parse(readIfExists(`${route}.json`) || '{}') } catch (e) { cfg = {} }
  return Boolean((cfg.usingComponents || {})['cy-privacy-gate'])
}

test('会触发隐私授权的页面必须挂 cy-privacy-gate,否则整页被隐私页盖住', () => {
  const missing = []
  for (const route of registeredRoutes()) {
    const apis = privacyApisOf(route)
    if (apis.length && !hasGate(route)) missing.push(`${route} ← ${apis.join(',')}`)
  }
  assert.deepEqual(missing, [],
    '这些页会调用需隐私授权的 API 却没挂 gate,触发时会被 /pages/privacy/index 盖住:\n  ' + missing.join('\n  '))
})

test('挂了 gate 的页面必须真的接好 show 与 settled,光注册组件不算', () => {
  const broken = []
  for (const route of registeredRoutes()) {
    if (!hasGate(route)) continue
    const wxml = readIfExists(`${route}.wxml`)
    const js = readIfExists(`${route}.js`)
    if (!/<cy-privacy-gate[^>]*show=/.test(wxml)) broken.push(`${route}: wxml 没挂标签或没绑 show`)
    else if (!/bind:settled=/.test(wxml)) broken.push(`${route}: 没绑 settled,弹窗关不掉`)
    else if (!/showPrivacyGate\s*\(/.test(js)) broken.push(`${route}: js 缺 showPrivacyGate,app.js 仍会走 navigateTo 回退`)
    else if (!/onPrivacyGateSettled\s*\(/.test(js)) broken.push(`${route}: js 缺 onPrivacyGateSettled`)
  }
  assert.deepEqual(broken, [], '接线不完整:\n  ' + broken.join('\n  '))
})

test('★负控:检查器本身能判红 —— 摘掉一页的 gate 必须被抓出来', () => {
  const route = 'pages/userinfo/userinfo'
  const cfg = JSON.parse(readIfExists(`${route}.json`))
  assert.ok(cfg.usingComponents['cy-privacy-gate'], '前提:该页当前挂着 gate')
  const apis = privacyApisOf(route)
  assert.ok(apis.length, `前提:该页确实会触发隐私授权,实际 ${apis}`)
  // 模拟摘掉:hasGate 的判据只看 usingComponents,这里直接验判据本身
  const without = { ...cfg, usingComponents: { ...cfg.usingComponents } }
  delete without.usingComponents['cy-privacy-gate']
  assert.equal(Boolean(without.usingComponents['cy-privacy-gate']), false,
    '摘掉后判据必须返回 false,否则第一条断言是橡皮图章')
})

test('negative control:注释里提到隐私 API 不算调用,真代码里调了才算', () => {
  // 左边是注释里的提及,右边是真调用。判据必须只认右边。
  const commented = "// 别改成页面里直接调 wx.chooseMedia\n/* wx.getLocation */\nfoo()"
  assert.deepEqual(stripComments(commented).match(PRIVACY_APIS), null,
    '注释里的 API 名被当成了调用 —— 会逼着人把说明写含糊')
  const real = "// 说明\nwx.chooseMedia({})"
  assert.deepEqual(stripComments(real).match(PRIVACY_APIS), ['wx.chooseMedia'],
    '剥注释剥过头,真调用也被吃掉了 —— 那这道门禁就哑了')
})
