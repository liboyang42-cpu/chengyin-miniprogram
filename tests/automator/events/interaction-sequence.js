'use strict'

function nativeEventName(binding) {
  const value = String(binding || '')
  const match = value.match(/^(?:bind|catch):?(.+)$/)
  if (!match || !match[1]) throw new Error(`不支持的事件绑定 ${value}`)
  return match[1]
}

module.exports = {
  async perform({ action, fixture, expectation, element }) {
    if (!element) throw new Error('event-contract 缺少 runner 已锁定的目标 element')
    const nativeEvent = nativeEventName(action && action.control && action.control.event)
    const contract = expectation && expectation.event
    if (!contract || typeof contract !== 'object') throw new Error('event-contract 必须声明 event object')
    const detail = contract.detail && typeof contract.detail === 'object' ? contract.detail : {}
    if (nativeEvent === 'tap') await element.tap()
    else if (nativeEvent === 'longpress' && typeof element.longpress === 'function') await element.longpress()
    else if (nativeEvent === 'input' && typeof element.input === 'function') {
      if (!Object.prototype.hasOwnProperty.call(detail, 'value')) throw new Error('input 事件必须声明 event.detail.value')
      await element.input(String(detail.value == null ? '' : detail.value))
    } else if (nativeEvent === 'touchstart' && typeof element.touchstart === 'function') await element.touchstart(detail)
    else if (nativeEvent === 'touchmove' && typeof element.touchmove === 'function') await element.touchmove(detail)
    else if (nativeEvent === 'touchend' && typeof element.touchend === 'function') await element.touchend(detail)
    else if (typeof element.trigger === 'function') await element.trigger(nativeEvent, detail)
    else throw new Error(`目标 element 不支持 ${nativeEvent} 事件`)
    return {
      actionId: action.id,
      event: action.control.event,
      fixtureId: fixture.id,
      assertions: ['runner 锁定的目标 element 已触发绑定事件，效果由 runner 独立回读'],
      observed: { nativeEvent, detail },
    }
  },
}
