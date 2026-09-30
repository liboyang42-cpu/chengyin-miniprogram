'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const ACTIVITY_WXML = 'components/cy/scene-play-activity-detail/index.wxml'
const ACTIVITY_JS = 'components/cy/scene-play-activity-detail/index.js'
const PROFILE_WXML = 'components/cy/profile/index.wxml'
const PARTICIPATION_WXML = 'subpackageMember/components/scene-member-participation-detail/index.wxml'
const PARTICIPATION_WXSS = 'subpackageMember/components/scene-member-participation-detail/index.wxss'
const TOKENS_WXSS = 'style/tokens.wxss'
const SHEET_WXSS = 'components/cy/scene-sheet/index.wxss'

function loadActivityComponent() {
  let definition
  vm.runInNewContext(read(ACTIVITY_JS), {
    getApp: () => ({}),
    Component(value) { definition = value },
    require(request) {
      if (request.endsWith('analytics.js')) return { track() {} }
      if (request.endsWith('activity-status.js')) return { activityStatusMeta: () => ({ text: '', variant: '' }) }
      if (request.endsWith('datetime.js')) return { chinaDayStart: () => NaN, toTimestamp: () => NaN }
      if (request.endsWith('ticket-window.js')) return require('../../utils/ticket-window.js')
      if (request.endsWith('response-shape.js')) return require('../../utils/response-shape.js')
      throw new Error(`unexpected dependency: ${request}`)
    },
  }, { filename: path.join(ROOT, ACTIVITY_JS) })
  return definition
}

function stateEmptyTag(wxml, state) {
  return (wxml.match(/<cy-empty\b[^>]*\/>/g) || [])
    .find((tag) => tag.includes(`state === '${state}'`))
}

function attr(tag, name) {
  const match = tag && tag.match(new RegExp(`\\s${name}="([^"]*)"`))
  return match ? match[1] : ''
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `${selector} 样式规则不存在`)
  return match[1]
}

function declaration(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`))
  return match ? match[1].trim() : ''
}

function playerToken(name, seen = new Set()) {
  assert.equal(seen.has(name), false, `token 循环引用: ${name}`)
  seen.add(name)
  const playerScope = cssRule(read(SHEET_WXSS), '.ss--player')
  const raw = declaration(playerScope, name) || declaration(read(TOKENS_WXSS), name)
  assert.ok(raw, `找不到玩家主题 token ${name}`)
  const alias = raw.match(/^var\((--[^)]+)\)$/)
  return alias ? playerToken(alias[1], seen) : raw
}

function parseColor(value) {
  const hex = value.match(/^#([\da-f]{6})$/i)
  if (hex) {
    return [...hex[1].matchAll(/[\da-f]{2}/gi)].map((part) => Number.parseInt(part[0], 16)).concat(1)
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  assert.ok(rgba, `无法解析颜色 ${value}`)
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] == null ? 1 : Number(rgba[4])]
}

function composite(foreground, backdrop) {
  const alpha = foreground[3]
  return foreground.slice(0, 3).map((channel, index) => channel * alpha + backdrop[index] * (1 - alpha)).concat(1)
}

function luminance(color) {
  const channels = color.slice(0, 3).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

function ruleToken(ruleBody, property) {
  const raw = declaration(ruleBody, property)
  const match = raw.match(/^var\((--[^)]+)\)$/)
  assert.ok(match, `${property} 必须读取主题 token`)
  return match[1]
}

function tagWith(wxml, marker) {
  return (wxml.match(/<(?:view|button)\b[^>]*>/g) || []).find((tag) => tag.includes(marker))
}

function effectivePlayerColor(token, backdrop) {
  const color = parseColor(playerToken(token))
  return color[3] < 1 ? composite(color, backdrop) : color
}

test('活动 missing 与 empty 终态都通过组件事件返回来源列表', () => {
  const wxml = read(ACTIVITY_WXML)
  const definition = loadActivityComponent()
  const events = []

  for (const state of ['missing', 'empty']) {
    const tag = stateEmptyTag(wxml, state)
    assert.ok(tag, `${state} 必须保留独立空态`)
    assert.ok(attr(tag, 'cta').trim(), `${state} 空态必须提供可见动作`)
    const handler = attr(tag, 'bind:cta')
    assert.equal(typeof definition.methods[handler], 'function', `${state} 动作必须绑定真实 handler`)
    definition.methods[handler].call({ triggerEvent: (name) => events.push(name) })
  }

  assert.deepEqual(events, ['close', 'close'], '两种不可恢复终态都应交给宿主返回来源列表')
})

test('推文空态按主页归属切换口吻且不虚构发布动作', () => {
  const wxml = read(PROFILE_WXML)
  const tag = (wxml.match(/<cy-empty\b[^>]*\/>/g) || [])
    .find((candidate) => candidate.includes('wx:elif="{{nodata}}"'))
  assert.ok(tag, '推文列表必须保留 nodata 空态')

  const copyBinding = attr(tag, 'sub')
  const branches = copyBinding.match(/^\{\{isSelf\s*\?\s*'([^']+)'\s*:\s*'([^']+)'\}\}$/)
  assert.ok(branches, '空态说明必须由 isSelf 在本人和他人主页间分档')
  assert.notEqual(branches[1], branches[2], '本人和他人主页不得复用同一口吻')
  assert.equal(attr(tag, 'cta'), '', '纯文案修复不得新增无实现的发布动作')
  assert.doesNotMatch(tag, /\sbind(?::|tap=)/, '纯文案修复不得新增事件绑定')
})

test('三天内倒计时使用 warning 语义且玩家主题实色对比度达正文标准', () => {
  const wxml = read(PARTICIPATION_WXML)
  const wxss = read(PARTICIPATION_WXSS)
  const countdown = (wxml.match(/<text\b[^>]*class="[^"]*davidhong[^"]*"[^>]*>[\s\S]*?<\/text>/) || [])[0]
  assert.ok(countdown && countdown.includes('{{displayInfo.remainingDays}}'), '倒计时仍应消费现有完整语义文案')

  const badgeRule = cssRule(wxss, '.cyinfotop_right .mci-badge.davidhong')
  assert.equal(ruleToken(badgeRule, 'background'), '--cy-color-status-warning', '临近开始是提醒，不是危险错误')
  assert.doesNotMatch(badgeRule, /--cy-color-status-danger/, '倒计时不得借用危险语义')

  const baseRule = cssRule(wxss, '.cyinfotop_right .mci-badge')
  const foreground = parseColor(playerToken(ruleToken(baseRule, 'color')))
  const background = parseColor(playerToken(ruleToken(badgeRule, 'background')))
  const ratio = contrast(foreground, background)
  assert.ok(ratio >= 4.5, `倒计时文字实际对比度 ${ratio.toFixed(2)}:1 应达到 4.5:1`)
})

test('底栏同时出现时只有核验扫码保留 primary，取消与客服可辨且可读', () => {
  const wxml = read(PARTICIPATION_WXML)
  const wxss = read(PARTICIPATION_WXSS)
  const scanTag = tagWith(wxml, 'bindtap="goScanQR"')
  const cancelTag = tagWith(wxml, 'bindtap="cancelParticipation"')
  const contactTag = tagWith(wxml, 'open-type="contact"')
  assert.ok(scanTag && cancelTag && contactTag, '三种底栏动作必须保留真实交互入口')

  const cancelClasses = attr(cancelTag, 'class').split(/\s+/).filter(Boolean)
  const contactClasses = attr(contactTag, 'class').split(/\s+/).filter(Boolean)
  assert.ok(cancelClasses.length > 1, '破坏性动作必须挂独立降级样式')
  assert.ok(contactClasses.length > 1, '客服动作必须挂独立降级样式')
  assert.notDeepEqual(cancelClasses, contactClasses, '破坏性动作与普通帮助动作不得退回同一视觉语义')

  const scanRule = cssRule(wxss, '.cyinfobottom_scan')
  const baseRule = cssRule(wxss, '.cyinfobottom_box_but')
  const cancelRule = cssRule(wxss, `.${cancelClasses.at(-1)}`)
  const contactRule = cssRule(wxss, `.${contactClasses.at(-1)}`)
  const primaryBg = ruleToken(scanRule, 'background')
  assert.equal(primaryBg, '--cy-color-action-primary-bg', '核验扫码必须保留主操作层级')
  assert.equal(declaration(cancelRule, 'background'), 'transparent', '取消参与应降为 ghost')
  assert.equal(declaration(contactRule, 'background'), 'transparent', '联系客服应降为 ghost')
  assert.doesNotMatch(cancelRule + contactRule, /--cy-color-action-primary-(?:bg|fg)/, '降级动作不得复用 primary 配色')

  const playerPage = parseColor(playerToken('--cy-color-bg-page'))
  const scanBg = effectivePlayerColor(primaryBg, playerPage)
  const scanFg = effectivePlayerColor(ruleToken(scanRule, 'color'), scanBg)
  const cancelFg = effectivePlayerColor(ruleToken(cancelRule, 'color'), playerPage)
  const contactFg = effectivePlayerColor(ruleToken(contactRule, 'color'), playerPage)
  assert.ok(contrast(scanFg, scanBg) >= 4.5, '主操作文字对比度必须达到 4.5:1')
  assert.ok(contrast(cancelFg, playerPage) >= 4.5, '取消文字对比度必须达到 4.5:1')
  assert.ok(contrast(contactFg, playerPage) >= 4.5, '客服文字对比度必须达到 4.5:1')

  const contactBorderToken = declaration(contactRule, 'border').match(/var\((--[^)]+)\)/)
  assert.ok(contactBorderToken, '客服 ghost 必须有可感知边界')
  const contactBorder = effectivePlayerColor(contactBorderToken[1], playerPage)
  assert.ok(contrast(contactBorder, playerPage) >= 3, '客服交互边界对比度必须达到 3:1')

  assert.equal(playerToken(ruleToken(scanRule, 'height')), '88rpx', '核验扫码触控目标不得小于 88rpx')
  assert.equal(playerToken(ruleToken(baseRule, 'height')), '88rpx', '降级动作触控目标不得小于 88rpx')
})

test('核销统计数字与单位使用独立字阶且不会被同选择器覆盖', () => {
  const wxml = read(PARTICIPATION_WXML)
  const wxss = read(PARTICIPATION_WXSS)
  const valueClasses = wxml.match(/class="mci-num-value"/g) || []
  const unitClasses = wxml.match(/class="mci-num-unit"/g) || []
  assert.equal(valueClasses.length, 2, '两张统计卡的数字都必须挂数字字阶')
  assert.equal(unitClasses.length, 2, '两张统计卡的单位都必须挂单位字阶')

  const valueRule = cssRule(wxss, '.cyinfo2k_box_txt .mci-num-value')
  const unitRule = cssRule(wxss, '.cyinfo2k_box_txt .mci-num-unit')
  const valueSize = ruleToken(valueRule, 'font-size')
  const unitSize = ruleToken(unitRule, 'font-size')
  assert.notEqual(valueSize, unitSize, '数字强调层级不得与单位再次映射成同一字号')
  assert.doesNotMatch(wxss, /\.cyinfo2k_box_txt\s+\.mci-num\s*\{/, '旧同选择器覆盖链必须退场')
})
