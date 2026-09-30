'use strict'

/* cy-inline-error 的副标题兜底规则(CU-C-140)。
 *
 * 病:组件对空 `sub` 一律补 KIND_DEFAULTS 里那句通用话术。调用方明写 `sub=""`
 * (modal-host 的必填校验)和「只有一句字段错误」的调用方(temp/activity/merchantapply
 * 的 30 处表单校验)因此被挂上一句「重试一次，或稍后再来」—— 本地必填校验等不来任何重试,
 * 这句话把一条精确的字段提示稀释成一条笼统的失败广播,还把错误卡撑高一倍。
 *
 * 判据:兜底只在调用方**什么都没说**时生效;只要给了自己的 title,副标题就归调用方。
 * 负控:把 observers 里的 `title ? sub : defaults.sub` 改回 `sub || defaults.sub`,本文件必红。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function loadComponent() {
  let config = null
  global.Component = (value) => { config = value }
  delete require.cache[require.resolve(
    path.join(__dirname, '../../components/cy/inline-error/index.js')
  )]
  require(path.join(__dirname, '../../components/cy/inline-error/index.js'))
  const instance = {
    data: Object.assign({}, config.data),
    setData(patch) { Object.assign(this.data, patch) },
  }
  config.observers['kind, title, sub, aria'].apply(instance, arguments)
  return instance
}

test('调用方给了自己的 title 时,不再补通用重试话术', () => {
  const bare = loadComponent('error', '请填写事实说明', '')
  assert.equal(bare.data._title, '请填写事实说明')
  assert.equal(bare.data._sub, '', '字段必填提示下面不该再有一句「重试一次，或稍后再来」')

  const cleared = loadComponent('data', '玩家人数要填 1-99 的整数', '')
  assert.equal(cleared.data._sub, '')
})

test('调用方自己写的 sub 原样透出,不被默认值覆盖', () => {
  const withSub = loadComponent('error', '这次报名还没完成', '钱没付成，票没出，可以再试一次')
  assert.equal(withSub.data._sub, '钱没付成，票没出，可以再试一次')
})

test('什么都没说时仍按 kind 兜底,不留光杆错误卡', () => {
  const nothing = loadComponent('error', '', '')
  assert.equal(nothing.data._title, '这一步没有完成')
  assert.equal(nothing.data._sub, '重试一次，或稍后再来')

  const network = loadComponent('network', '', '')
  assert.equal(network.data._title, '网络没连上')
  assert.equal(network.data._sub, '连接恢复后可继续')
})

test('负控:字段校验卡不得再出现「重试一次，或稍后再来」这句兜底', () => {
  const fieldError = loadComponent('error', '请填写事实说明', '')
  assert.notEqual(fieldError.data._sub, '重试一次，或稍后再来')
})
