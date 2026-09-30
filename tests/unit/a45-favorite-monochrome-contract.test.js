const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function productionWxml() {
  const out = {}
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = path.join(rel, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (child.endsWith('.wxml')) out[child] = read(child)
    }
  }
  ;['components', 'pages', 'subpackageA', 'subpackageB', 'subpackageP3'].forEach(walk)
  return out
}

function assertMonochromeFavoriteContract(sources) {
  for (const [rel, source] of Object.entries(sources.productionWxml)) {
    assert.doesNotMatch(source, /\/images\/heart_cur\.png/, `${rel}: 不得继续消费紫色 heart_cur 位图`)
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'images/heart_cur.png')), false, '紫色 heart_cur 资产不得继续留在包内')
  assert.equal(fs.existsSync(path.join(ROOT, 'images/heart.png')), false, '替换后无消费方的旧 heart 资产不得继续占包')

  assert.match(sources.wxml.mylike, /<cy-icon class="favorite-card__action-heart" name="heart" size="32"\s*\/>/)
  assert.match(sources.wxml.scene, /<cy-icon class="src-favorite-card__action-heart" name="heart" size="32"\s*\/>/)

  assert.match(sources.css.mylike, /\.favorite-card__action-heart\s*\{\s*color:\s*var\(--cy-color-text-primary\)/)
  assert.match(sources.css.scene, /\.src-favorite-card__action-heart\s*\{\s*color:\s*var\(--cy-color-text-primary\)/)

  assert.equal(JSON.parse(sources.json.mylike).usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.equal(JSON.parse(sources.json.scene).usingComponents['cy-icon'], '/components/cy/icon/index')
}

function sources() {
  return {
    productionWxml: productionWxml(),
    wxml: {
      mylike: read('pages/mylike/mylike.wxml'),
      scene: read('components/cy/scene-route-content/index.wxml'),
    },
    css: {
      mylike: read('pages/mylike/mylike.wxss'),
      scene: read('components/cy/scene-route-content/index.wxss'),
    },
    json: {
      mylike: read('pages/mylike/mylike.json'),
      scene: read('components/cy/scene-route-content/index.json'),
    },
  }
}

test('A45：共享收藏选中态只消费黑白 cy-icon，不再渲染紫色位图', () => {
  assertMonochromeFavoriteContract(sources())
})

test('negative control：任一玩家侧消费点接回 heart_cur 必须判红', () => {
  const original = sources()
  const broken = {
    ...original,
    productionWxml: {
      ...original.productionWxml,
      'pages/mylike/mylike.wxml': original.productionWxml['pages/mylike/mylike.wxml'].replace(
        '<cy-icon class="favorite-card__action-heart" name="heart" size="32" />',
        '<image src="/images/heart_cur.png" />',
      ),
    },
    wxml: {
      ...original.wxml,
      mylike: original.wxml.mylike.replace(
        '<cy-icon class="favorite-card__action-heart" name="heart" size="32" />',
        '<image src="/images/heart_cur.png" />',
      ),
    },
  }
  assert.notEqual(broken.productionWxml['pages/mylike/mylike.wxml'], original.productionWxml['pages/mylike/mylike.wxml'], '负控锚点失效')
  assert.throws(() => assertMonochromeFavoriteContract(broken), /不得继续消费紫色/)
})
