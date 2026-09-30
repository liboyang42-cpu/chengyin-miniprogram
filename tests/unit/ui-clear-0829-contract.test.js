const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('设置页直接展示素材署名，独立署名页不再注册', () => {
  const app = JSON.parse(read('app.json'))
  const routes = app.pages.concat(app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)))
  const settings = read('pages/shezhi/shezhi.wxml')
  const about = read('pages/shezhi/about/index.wxml')

  assert.equal(routes.includes('pages/shezhi/attribution/index'), false)
  assert.match(settings, /game-icons\.net[\s\S]*Creative Commons BY 3\.0[\s\S]*Delapouite[\s\S]*Lord Berandas/)
  assert.match(settings, /ansimuz[\s\S]*CC0 1\.0[\s\S]*Warped Miami Synth/)
  assert.doesNotMatch(about, /图像来源|openAttribution/)
})

test('协作邀请没有主题时提供真实发布入口', () => {
  const wxml = read('pages/coop/invite/index.wxml')
  const js = read('pages/coop/invite/index.js')

  assert.match(wxml, /title="还没有可关联的主题"[\s\S]*cta="先发布主题"[\s\S]*bind:cta="goCreateTopic"/)
  assert.match(js, /goCreateTopic\(\)[\s\S]*\/pages\/publish\/fabu\/index/)
})

test('创作者申请页不再作为第四条角色准入路径注册', () => {
  const app = JSON.parse(read('app.json'))
  const routes = app.pages.concat(app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)))

  assert.equal(routes.includes('subpackageP3/pages/creator/index/index'), false)
})
