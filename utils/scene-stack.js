'use strict'

const MAX_DEPTH = 2

// scene-sheet 实现了 half(T1)/full(T3)两档,与 Brand Handbook「弹层四型」对齐。
// 2026-09-02 合并掉 peek:它与 half 的下限相同、只有上限差 12vh,渲染结果常常一模一样。
// 这里原本只放行 peek,其余一律归一成 full —— registry 里三个 variant:'half' 的场景因此从来没半屏过,
// 且不报错、无测试覆盖。未知值(含旧的 'peek')仍 fail-closed 到 full。
const VARIANTS = new Set(['half', 'full'])

function normalizeScene(scene) {
  if (!scene || !scene.id) throw new Error('scene requires an id')
  const params = scene.params && typeof scene.params === 'object' && !Array.isArray(scene.params)
    ? { ...scene.params }
    : {}
  return {
    id: String(scene.id),
    route: String(scene.route || ''),
    params,
    title: String(scene.title || ''),
    variant: VARIANTS.has(scene.variant) ? scene.variant : 'full',
    theme: scene.theme === 'merchant' ? 'merchant' : 'player',
    form: scene.form === true,
    canBack: scene.canBack === true,
    dirty: scene.dirty === true,
    maskClosable: scene.maskClosable === true,
    footer: scene.footer === true,
    reducedMotion: scene.reducedMotion === true,
  }
}

function pushScene(stack, scene) {
  const next = Array.isArray(stack) ? stack.slice() : []
  const normalized = normalizeScene(scene)
  if (next.length >= MAX_DEPTH) next[next.length - 1] = normalized
  else next.push(normalized)
  return next
}

function popScene(stack) {
  const next = Array.isArray(stack) ? stack.slice() : []
  next.pop()
  return next
}

function currentScene(stack) {
  const next = Array.isArray(stack) ? stack : []
  if (!next.length) return null
  // 返回是栈关系,不是场景类型:同一个详情既可能从深链成为首层,也可能从列表成为子层。
  // 只按当前深度计算,避免注册表 canBack 提示让首层误出现返回箭头。
  return { ...next[next.length - 1], canBack: next.length > 1 }
}

function exitDecision(stack, action = 'close') {
  if (action !== 'close' && action !== 'back') throw new Error('scene exit action is invalid')
  const current = currentScene(stack)
  return current && current.dirty ? 'confirm' : action
}

function closeDecision(stack) {
  return exitDecision(stack, 'close')
}

module.exports = { MAX_DEPTH, closeDecision, currentScene, exitDecision, normalizeScene, popScene, pushScene }
