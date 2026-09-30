const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

// 小程序基础库自带的带连字符标签,不需要写进 usingComponents。
const BUILTIN = new Set([
  'cover-view', 'cover-image', 'movable-view', 'movable-area', 'scroll-view',
  'swiper-item', 'rich-text', 'web-view', 'open-data', 'match-media',
  'functional-page-navigator', 'page-container', 'share-element', 'root-portal',
  'picker-view', 'picker-view-column', 'keyboard-accessory', 'voip-room',
  'ad-custom', 'official-account', 'navigation-bar', 'page-meta',
  'checkbox-group', 'radio-group',
])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.wxml')) out.push(p)
  }
  return out
}

// 未注册的自定义组件在小程序里只报 warning、不报 error,页面静默少一块。
// 2026-08-03 实证:roam 首屏 <cy-starfield> 漏注册 → 整屏纯黑,截图验收也没抓到。
test('每个 wxml 用到的自定义组件都在同名 json 的 usingComponents 里注册', () => {
  const roots = ['pages', 'components', 'subpackageA', 'subpackageB', 'subpackageP3']
    .map((d) => path.join(ROOT, d))
    .filter((d) => fs.existsSync(d))

  const missing = []
  for (const wxml of roots.flatMap((d) => walk(d))) {
    const json = wxml.replace(/\.wxml$/, '.json')
    if (!fs.existsSync(json)) continue
    const conf = JSON.parse(fs.readFileSync(json, 'utf8'))
    const registered = new Set(Object.keys(conf.usingComponents || {}))
    // xr-frame 组件(json 声明 renderer: xr-frame)里的 <xr-*> 是渲染器自带标签,不走 usingComponents;
    // 只对这类组件放行 —— 普通组件里写 <xr-scene> 照样判红。
    const xrBuiltin = conf.renderer === 'xr-frame'
    const src = fs.readFileSync(wxml, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const tag of new Set(src.match(/<[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g) || [])) {
      const name = tag.slice(1)
      if (BUILTIN.has(name) || registered.has(name) || (xrBuiltin && name.startsWith('xr-'))) continue
      missing.push(`${path.relative(ROOT, wxml)} 用了 <${name}> 但 json 里没注册`)
    }
  }

  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`)
})
