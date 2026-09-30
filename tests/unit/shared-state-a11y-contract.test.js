const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadComponentFromSource(source, filename) {
  let definition
  vm.runInNewContext(source, {
    Component(value) { definition = value },
  }, { filename })
  assert.ok(definition, `${filename} 必须注册 Component`)
  return definition
}

function createInstance(definition, properties = {}) {
  const defaults = {}
  Object.entries(definition.properties || {}).forEach(([key, config]) => {
    defaults[key] = config.value
  })
  return {
    data: Object.assign({}, definition.data || {}, defaults, properties),
    setData(patch) { Object.assign(this.data, patch) },
  }
}

function assertEmptyStateA11y(source) {
  const definition = loadComponentFromSource(source.js, 'components/cy/empty/index.js')
  const observer = definition.observers['kind, icon, title, sub']
  assert.equal(typeof observer, 'function', 'empty 必须继续通过公开属性解析最终状态')

  const success = createInstance(definition, { kind: 'success' })
  observer.call(success, 'success', '', '', '')
  assert.deepEqual(
    [success.data._glyph, success.data._title, success.data._sub, success.data._loading],
    ['check', '已完成', '', false],
    'kind=success 必须是完成语义，不能掉回普通空态',
  )

  ;['typo-success', 'constructor'].forEach((kind) => {
    const unknown = createInstance(definition, { kind })
    observer.call(unknown, kind, '', '', '')
    assert.deepEqual(
      [unknown.data._icon, unknown.data._glyph, unknown.data._title, unknown.data._sub, unknown.data._loading],
      ['', '', '暂无内容', '', false],
      `未知 kind=${kind} 必须安全退回中性旧空态，不能猜成成功、错误或持续加载`,
    )
  })

  const root = /<view class="cy-empty[^>]*>/.exec(source.wxml)
  assert.ok(root, 'empty 必须保留单一根状态容器')
  assert.match(root[0], /aria-role="status"/, '普通空态只能是非紧急 status')
  assert.match(root[0], /aria-live="polite"/, '空态变化应礼貌播报')
  assert.match(root[0], /aria-label="\{\{aria \|\| _title\}\}\{\{!aria && _sub \? '，' \+ _sub : ''\}\}"/,
    '空态根节点必须直接由可见标题与说明组成名称')
  assert.match(root[0], /aria-busy="\{\{_loading\}\}"/, 'loading 必须暴露 busy 状态')
  assert.doesNotMatch(root[0], /aria-role="alert"/, '正常空态不得升级成严重错误提示')
}

test('cy-empty 支持完成态、未知 kind 安全回退，根状态以非紧急语义播报', () => {
  assertEmptyStateA11y({
    js: read('components/cy/empty/index.js'),
    wxml: read('components/cy/empty/index.wxml'),
  })
})

test('负控：empty 回退成严重 alert 或丢失 success 映射必须判红', () => {
  const source = {
    js: read('components/cy/empty/index.js'),
    wxml: read('components/cy/empty/index.wxml'),
  }
  const mutants = [
    {
      name: '正常空态误标为 alert',
      source: { ...source, wxml: source.wxml.replace('aria-role="status"', 'aria-role="alert"') },
    },
    {
      name: 'success 映射丢失',
      source: { ...source, js: source.js.replace(/\n\s*success:\s*\{[^\n]+\},/, '') },
    },
    {
      name: '原型键绕过未知 kind 门禁',
      source: {
        ...source,
        js: source.js.replace(
          'const knownKind = Boolean(kind && Object.prototype.hasOwnProperty.call(KIND_DEFAULTS, kind));',
          'const knownKind = Boolean(kind && KIND_DEFAULTS[kind]);',
        ),
      },
    },
  ]
  mutants.forEach((mutant) => {
    assert.notDeepEqual(mutant.source, source, `负控变异未命中：${mutant.name}`)
    assert.throws(() => assertEmptyStateA11y(mutant.source), assert.AssertionError, mutant.name)
  })
})

function assertErrorStateA11y(source) {
  const definition = loadComponentFromSource(source.js, 'components/cy/error/index.js')
  assert.equal(definition.properties.aria && definition.properties.aria.value, '',
    'error 必须允许调用方在必要时覆盖播报名称')
  const root = /<view class="cy-error[^>]*>/.exec(source.wxml)
  assert.ok(root, 'error 必须保留单一根状态容器')
  assert.match(root[0], /aria-role="alert"/, '真实错误态必须暴露 alert')
  assert.match(root[0], /aria-live="polite"/, '错误需播报，但不应粗暴打断正在进行的操作')
  assert.match(root[0], /aria-label="\{\{aria \|\| title\}\}\{\{!aria && sub \? '，' \+ sub : ''\}\}"/,
    '错误根节点必须直接由最终可见文案命名，显式 aria 优先')
}

test('cy-error 以 alert 暴露失败原因，并允许覆盖播报名称', () => {
  assertErrorStateA11y({
    js: read('components/cy/error/index.js'),
    wxml: read('components/cy/error/index.wxml'),
  })
})

test('负控：error 降级成普通 status 或丢失名称必须判红', () => {
  const source = {
    js: read('components/cy/error/index.js'),
    wxml: read('components/cy/error/index.wxml'),
  }
  const mutants = [
    {
      name: '错误态误标为 status',
      source: { ...source, wxml: source.wxml.replace('aria-role="alert"', 'aria-role="status"') },
    },
    {
      name: '错误态丢失可读名称',
      source: { ...source, wxml: source.wxml.replace(' aria-label="{{aria || title}}{{!aria && sub ? \'，\' + sub : \'\'}}"', '') },
    },
  ]
  mutants.forEach((mutant) => {
    assert.notDeepEqual(mutant.source, source, `负控变异未命中：${mutant.name}`)
    assert.throws(() => assertErrorStateA11y(mutant.source), assert.AssertionError, mutant.name)
  })
})

function assertQrVoucherStateA11y(wxml) {
  const error = /<view wx:if="\{\{state === 'error'[^>]*class="qr__error"[^>]*>/.exec(wxml)
  assert.ok(error, 'QR 凭证必须保留独立错误根状态')
  assert.match(error[0], /aria-role="alert"/, 'QR 取码失败必须暴露 alert')
  assert.match(error[0], /aria-live="polite"/, 'QR 失败应礼貌播报')
  assert.match(error[0], /aria-label="\{\{errorText\}\}"/, 'QR 失败根状态必须使用实际错误文案命名')

  const loading = /<view wx:else class="qr__ph"[^>]*>/.exec(wxml)
  assert.ok(loading, 'QR 凭证必须保留独立 loading 根状态')
  assert.match(loading[0], /aria-role="status"/, 'QR loading 必须是非紧急 status')
  assert.match(loading[0], /aria-live="polite"/, 'QR loading 应礼貌播报')
  assert.match(loading[0], /aria-label="二维码加载中"/, 'QR loading 必须有稳定可读名称')
  assert.match(loading[0], /aria-busy="true"/, 'QR loading 必须暴露 busy 状态')
}

test('cy-qr-voucher 的 loading 与 error 根状态可被辅助技术区分', () => {
  assertQrVoucherStateA11y(read('components/cy/qr-voucher/index.wxml'))
})

test('负控：QR 错误被降级或 loading 丢失 busy 必须判红', () => {
  const source = read('components/cy/qr-voucher/index.wxml')
  const mutants = [
    ['QR 错误误标为 status', source.replace('class="qr__error" aria-role="alert"', 'class="qr__error" aria-role="status"')],
    ['QR loading 丢失 busy', source.replace(' aria-busy="true"', '')],
  ]
  mutants.forEach(([name, mutant]) => {
    assert.notEqual(mutant, source, `负控变异未命中：${name}`)
    assert.throws(() => assertQrVoucherStateA11y(mutant), assert.AssertionError, name)
  })
})
