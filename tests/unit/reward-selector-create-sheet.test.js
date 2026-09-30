// reward-selector 创建优惠券半屏 sheet:验「建完自动选中」这条核心价值 +
// dirty 拦截在提交成功/失败两条真实网络路径下的行为(automator 只能跑到"网络失败"这条,
// 因为本地没有可连的后端;成功路径必须靠这里的单测坐实)。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT_JS = path.join(ROOT, 'pages/publish/components/reward-selector/index.js')
const COMPONENT_WXML = path.join(ROOT, 'pages/publish/components/reward-selector/index.wxml')

let sandbox

beforeEach(() => {
  sandbox = { requests: [], toasts: [], tips: [], modals: [] }
  global.getApp = () => ({
    sendRequest: (options) => { sandbox.requests.push(options) },
    tips: (m) => sandbox.tips.push(m),
  })
  global.wx = {
    showToast: (o) => sandbox.toasts.push(o && o.title),
    showModal: (o) => { sandbox.modals.push(o); if (sandbox.modalConfirm) o.success && o.success({ confirm: true }) },
  }
  global.Component = (config) => { sandbox.componentConfig = config }
  delete require.cache[COMPONENT_JS]
  delete require.cache[path.join(ROOT, 'utils/coupon-form.js')]
  require(COMPONENT_JS)
})

// 组件实例最小复刻:data 走真实 setData 合并(支持 'a.b' 路径写法),
// change 事件记进 sandbox 方便断言"建完自动选中"这条核心价值。
function makeInstance() {
  const config = sandbox.componentConfig
  const events = []
  const instance = {
    data: JSON.parse(JSON.stringify(config.data)),
    setData(patch, cb) {
      Object.keys(patch).forEach((key) => {
        const parts = key.split('.')
        if (parts.length === 1) {
          this.data[key] = patch[key]
        } else {
          let obj = this.data
          for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
          obj[parts[parts.length - 1]] = patch[key]
        }
      })
      cb && cb()
    },
    triggerEvent(name, detail) { events.push({ name, detail }) },
  }
  Object.keys(config.methods).forEach((name) => {
    instance[name] = config.methods[name].bind(instance)
  })
  instance.__events = events
  return instance
}

test('创建优惠券:提交成功后自动选中新券(核心价值),并回补优惠券列表', () => {
  const rs = makeInstance()
  rs.data.scope = 'MERCHANT'
  rs.createCoupon()
  assert.equal(rs.data.creating, true, '点新建后 sheet 必须真的开')
  assert.equal(rs.data.open, false, 'createCoupon 不该触碰选择器自己的 open 字段(它由 openSelector/closeSelector 管)')

  // 真实事件路径填字段(不是直接改 data)
  rs.onCreateName({ detail: { value: '测试优惠券' } })
  rs.onCreatePublishCount({ detail: { value: '20' } })
  rs.onCreateTypeChange({ detail: { value: 2 } })
  rs.onCreateDescription({ detail: { value: '单测填的说明' } })
  assert.equal(rs.data.createDirty, true, '有字段非空 ⇒ dirty 必须为 true')

  rs.data.createForm.startTime = '2026-08-01 09:00:00'
  rs.data.createForm.endTime = '2026-08-01 18:00:00'

  rs.onCreateSubmit()
  assert.equal(sandbox.requests.length, 1, '必须真的打了 /api/coupon/publish')
  assert.equal(sandbox.requests[0].url, '/api/coupon/publish')
  assert.equal(sandbox.requests[0].data.scope, 'MERCHANT', '商家发布流必须显式声明 MERCHANT scope')

  // 模拟后端真的返回成功(automator 本地连不上后端,这条分支只能这样坐实)
  sandbox.requests[0].success({ code: '200', data: { id: 4567 } })

  assert.equal(rs.data.creating, false, '提交成功必须关闭 sheet')
  const changeEvent = rs.__events.find((e) => e.name === 'change')
  assert.ok(changeEvent, '必须触发 change 事件通知发起页(auto 选中的机制)')
  assert.equal(changeEvent.detail.couponId, 4567, '选中的必须是刚创建的这张券的真实 id,不是占位值')
  assert.equal(changeEvent.detail.couponName, '测试优惠券')
  assert.equal(rs.data.selectedLabel, '测试优惠券', '选择器摘要要立刻反映新选中的券')

  // loadCoupons 会再发一次请求,把新券也拉进列表(不然列表里的"已选"勾选不出来)
  assert.equal(sandbox.requests.length, 2, '成功后必须刷新优惠券列表')
  assert.equal(sandbox.requests[1].url, '/api/coupon/mypublishlist')
  assert.equal(sandbox.requests[1].data.scope, 'MERCHANT', '商家券回读必须保持同一 MERCHANT scope')
})

test('C-31 创建优惠券:回包缺 id 时不得挂 couponId=0 冒充已选中,要明确提示去列表里选', () => {
  const rs = makeInstance()
  rs.createCoupon()
  rs.onCreateName({ detail: { value: '缺 id 的券' } })
  rs.data.createForm.startTime = '2026-08-01 09:00:00'
  rs.data.createForm.endTime = '2026-08-01 18:00:00'
  rs.data.createForm.publishCount = 5
  rs.data.createForm.couponType = 1

  rs.onCreateSubmit()
  sandbox.requests[0].success({ code: '200', msg: '发布成功' })

  assert.equal(rs.__events.filter((e) => e.name === 'change').length, 0, '没有真实 id 不能发 change')
  assert.equal(rs.data.selectedLabel, '', '摘要不能显示成已选中')
  assert.deepEqual(sandbox.tips, ['优惠券已发布，请在列表中选择它'])
  assert.equal(sandbox.requests[1].url, '/api/coupon/mypublishlist', '仍要刷新列表让作者能选到新券')
})

test('创建优惠券:提交失败不清空表单、不静默吞掉错误', () => {
  const rs = makeInstance()
  rs.createCoupon()
  rs.onCreateName({ detail: { value: '会失败的券' } })
  rs.data.createForm.startTime = '2026-08-01 09:00:00'
  rs.data.createForm.endTime = '2026-08-01 18:00:00'
  rs.data.createForm.publishCount = 5
  rs.data.createForm.couponType = 1

  rs.onCreateSubmit()
  sandbox.requests[0].success({ code: '500', msg: '库存不足' })

  assert.equal(rs.data.creating, true, '失败不能把 sheet 关掉,用户要能重试')
  assert.equal(rs.data.isSubmitting, false, '必须解除提交中锁定,否则再也点不动提交')
  assert.deepEqual(sandbox.tips, ['库存不足'], '真实错误信息必须透出给用户,不能吞掉')
  assert.equal(rs.data.createForm.name, '会失败的券', '失败后表单内容不能丢')
})

test('校验失败(必填项缺失)不会打网络请求,和 couponInfo 页同一套校验', () => {
  const rs = makeInstance()
  rs.createCoupon()
  // 什么都不填直接提交
  rs.onCreateSubmit()
  assert.equal(sandbox.requests.length, 0, '校验没过就不该打请求')
  assert.deepEqual(sandbox.toasts, ['请输入优惠券名称'])
})

test('体验卡入口使用体验卡文案与固定类型,默认值本身不触发放弃确认', () => {
  const rs = makeInstance()
  rs.data.rewardKind = 'PASS'
  rs.createCoupon()

  assert.equal(rs.data.createForm.couponType, 4, '体验卡对应 picker index 4 / 后端 couponType 3')
  assert.equal(rs.data.couponTypeIndex, 4)
  assert.equal(rs.data.createDirty, false, '系统固定的类型不算用户输入')

  rs.updateCreateDirty()
  assert.equal(rs.data.createDirty, false, '仅固定体验卡类型时关闭不应弹放弃确认')
  rs.onCreateName({ detail: { value: '咖啡体验卡' } })
  assert.equal(rs.data.createDirty, true, '用户真的填写后才进入 dirty 状态')
  assert.equal(rs.data.createForm.couponType, 4, '填写名称不能把体验卡类型冲掉')
})

test('内嵌创建表单与商家营销优惠券共用字段，并将日期和投放数排成双列', () => {
  const wxml = fs.readFileSync(COMPONENT_WXML, 'utf8')
  const row = wxml.slice(wxml.indexOf('class="create-row"'), wxml.indexOf('wx:if="{{rewardKind !== \'PASS\'}}"'))
  assert.match(row, /优惠券日期/)
  assert.match(row, /投放数/)
  assert.match(wxml, /优惠券名称/)
  assert.match(wxml, /优惠券类型/)
  assert.match(wxml, /优惠券说明/)
  assert.doesNotMatch(wxml, />有效期</)
  assert.doesNotMatch(wxml, />发放数量</)
})

test('dirty 时请求关闭走二次确认;非 dirty 时直接关', () => {
  const rs = makeInstance()
  rs.createCoupon()

  // 非 dirty:直接关闭,不弹确认
  rs.onCreateRequestClose()
  assert.equal(rs.data.creating, false)
  assert.equal(sandbox.modals.length, 0)

  // dirty:必须先弹确认,用户确认后才真的关
  rs.createCoupon()
  rs.onCreateName({ detail: { value: '有输入' } })
  assert.equal(rs.data.createDirty, true)
  sandbox.modalConfirm = false
  rs.onCreateRequestClose()
  assert.equal(sandbox.modals.length, 1, 'dirty 时遮罩/✕ 必须弹二次确认,不能静默丢数据')
  assert.equal(rs.data.creating, true, '用户没确认放弃前 sheet 不能关')

  sandbox.modalConfirm = true
  rs.onCreateRequestClose()
  assert.equal(rs.data.creating, false, '用户确认放弃后才真的关')
})

test('负控:把 isDirty 判据故意改错(非空字段不算脏)必须让 dirty 门禁测试判红', () => {
  const rs = makeInstance()
  rs.createCoupon()
  const original = rs.updateCreateDirty
  rs.updateCreateDirty = function () { this.setData({ createDirty: false }) } // 变异:永远不脏
  rs.onCreateName({ detail: { value: '有内容但判定不脏' } })
  assert.equal(rs.data.createDirty, false, '变异生效的前提检查')
  rs.updateCreateDirty = original
  // 还原后重新走一遍,确认负控确实是"变异让检查失效",不是断言本身写错
  rs.onCreateName({ detail: { value: '有内容' } })
  assert.equal(rs.data.createDirty, true)
})
