// 专业主题编辑器策略层。断言的是行为,不是「我有没有抄对条件表达式」——
// 所以只走 evaluateProfessionalDraft 这一个 interface,不去测内部分支。
//
// 承重不变量:
//  - 三种默认起点(俱乐部 > 城市定向 > 自由探索),且起点不改变 productType
//  - 城市定向没剧情不许建节点;自由探索没剧情不阻断发布
//  - 「暂无描述」这类占位文案不算真实剧情(旧 confrimChapter 会写它凑完成态)
//  - 自由探索缺 recruitDeadline 必须前端就拦(后端硬约束,缺了直接抛异常)
//  - 待编排素材没清零不许发布
//  - 必填的主题类别计入「还差 N 项」,摘要与发布校验同一批判据
//  - 每条阻断项都要能定位到具体章节/节点,不能只给一句汇总
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  evaluateProfessionalDraft,
  formalNodeCreationIssue,
  hasUsableCoords,
} = require('../../utils/publish/pro-editor-policy.js')

const node = (over) => Object.assign({
  name: '邻里苑', longitude: '121.38', latitude: '31.11', templateId: 7,
}, over)

const chapter = (over) => Object.assign({
  name: '第1章', description: '这一章讲邻里的故事', nodes: [node()],
}, over)

// 一个「本地校验全过、可直接发布」的城市定向草稿
const ready = (over) => Object.assign({
  productType: 1,
  name: '患得患失吧', subtitle: '一句话', description: '完整介绍', imgUrl: 'https://x/y.png',
  categoryIds: '4001',
  chapters: [chapter()],
}, over)

const evalDraft = (formData, opts) => evaluateProfessionalDraft(
  Object.assign({ formData }, opts || {})
)

// ===== 默认起点 =====

test('无 clubId 的城市定向默认从剧情开始', () => {
  const r = evalDraft(ready())
  assert.equal(r.defaultAnchor, 'story')
})

test('无 clubId 的自由探索默认从节点开始', () => {
  const r = evalDraft(ready({ productType: 2 }))
  assert.equal(r.defaultAnchor, 'node')
})

test('有 clubId 默认从地点开始,且不改变 productType', () => {
  const formData = ready({ productType: 1 })
  const r = evalDraft(formData, { clubId: 42 })
  assert.equal(r.defaultAnchor, 'place')
  assert.equal(formData.productType, 1, '起点不是第三种玩法模式,不许回写 productType')
})

test('空草稿给引导动作,一旦有内容就撤掉(不做全局推荐下一步)', () => {
  const blank = evalDraft(ready({ chapters: [] }))
  assert.equal(blank.starterAction.key, 'createChapter')

  const withContent = evalDraft(ready())
  assert.equal(withContent.starterAction, null, '有内容后靠章节卡状态标记,不再给全局动作')
})

// ===== 城市定向的剧情闸 =====

test('城市定向:章节没剧情时不许建节点', () => {
  const r = evalDraft(ready({ chapters: [chapter({ description: '' })] }))
  assert.equal(r.chapterStates[0].canAddNode, false)
  assert.equal(r.chapterStates[0].storyRequired, true)

  const issue = formalNodeCreationIssue(ready({ chapters: [chapter({ description: '' })] }), 0)
  assert.deepEqual(issue, {
    field: 'chapterStory',
    chapterIndex: 0,
    message: '城市定向需先完成本章剧情',
  }, '必须指认剧情闸及其错误文案，不能被相邻的节点/坐标闸接住')
})

test('城市定向:有剧情才放行建节点', () => {
  const r = evalDraft(ready())
  assert.equal(r.chapterStates[0].canAddNode, true)
  assert.equal(formalNodeCreationIssue(ready(), 0), null)
})

test('自由探索:没剧情照样可以建节点,也不产生发布阻断', () => {
  const r = evalDraft(ready({
    productType: 2, recruitDeadline: '2026-09-01',
    chapters: [chapter({ description: '' })],
  }))
  assert.equal(r.chapterStates[0].canAddNode, true)
  assert.equal(r.chapterStates[0].storyRequired, false)
  assert.equal(r.blockingIssues.filter(i => /剧情/.test(i.message)).length, 0)
})

test('★「暂无描述」不算真实剧情 —— 旧代码会写它凑完成态', () => {
  const r = evalDraft(ready({ chapters: [chapter({ description: '暂无描述' })] }))
  assert.equal(r.chapterStates[0].storyDone, false, '占位文案冒充完成会让剧情闸形同虚设')
  assert.equal(r.chapterStates[0].canAddNode, false)
})

// ===== 招募截止(后端硬约束) =====

test('★自由探索缺 recruitDeadline 必须前端就拦(后端会抛异常)', () => {
  const r = evalDraft(ready({ productType: 2 }))
  assert.ok(r.blockingIssues.some(i => i.key === 'recruitDeadline'))
})

test('城市定向不要求 recruitDeadline(它走直卖路径)', () => {
  const r = evalDraft(ready())
  assert.equal(r.blockingIssues.filter(i => i.key === 'recruitDeadline').length, 0)
})

// ===== 待编排素材 =====

test('待编排素材没清零不许发布', () => {
  const r = evalDraft(ready(), { pendingMaterials: [{ _localId: 'm1', kind: 'place' }] })
  assert.equal(r.creativeComplete, false)
  const issue = r.blockingIssues.find(i => i.key === 'pendingMaterials')
  assert.deepEqual(issue, {
    key: 'pendingMaterials',
    message: '还有 1 个素材未编排进章节',
  }, '必须命中 pendingMaterials 发布闸，不能只断言任意异常')
})

// ===== 阻断项必须可定位 =====

test('阻断项要定位到具体章节与节点,不能只给汇总', () => {
  const r = evalDraft(ready({
    chapters: [chapter({ nodes: [node({ name: '宠物公园', longitude: '', latitude: '' })] })],
  }))
  const miss = r.blockingIssues.find(i => /缺少地点/.test(i.message))
  assert.ok(miss, '必须报出缺地点')
  assert.equal(miss.chapterIndex, 0)
  assert.equal(miss.nodeIndex, 0)
  assert.match(miss.message, /宠物公园/, '错误文案要带节点名,否则用户不知道是哪个')
})

test('坐标为 "0" 不算有效(POI/后端的常见空值)', () => {
  const r = evalDraft(ready({
    chapters: [chapter({ nodes: [node({ longitude: '0', latitude: '0' })] })],
  }))
  assert.ok(r.blockingIssues.some(i => /缺少地点/.test(i.message)))
  assert.equal(hasUsableCoords({ longitude: '0.0', latitude: '31.2' }), false)
  assert.equal(hasUsableCoords({ longitude: '121.5', latitude: '-0' }), false)
})

test('空章节要报错(空章节即无节点章节)', () => {
  const r = evalDraft(ready({ chapters: [chapter({ nodes: [] })] }))
  assert.ok(r.blockingIssues.some(i => /还没有节点/.test(i.message)))
})

// ===== 完整草稿 =====

test('齐了就是 creativeComplete', () => {
  const r = evalDraft(ready())
  assert.deepEqual(r.blockingIssues, [])
  assert.equal(r.creativeComplete, true)
})

/**
 * CU-C-157:「主题详情」入口的「还差 N 项」以前不数主题类别,而类别既是必填星号、
 * 又真的被发布校验拦着 —— 于是选完类别回总览,数字纹丝不动。摘要说「缺项」就得和
 * 同一批必填项同源。
 */
test('主题类别计入缺项数,数组与逗号串两种形态都认', () => {
  assert.ok(evalDraft(ready({ categoryIds: '' })).blockingIssues.some(i => i.key === 'categoryIds'),
    '没选类别必须进缺项数,否则选完类别总览数字不动')
  assert.equal(evalDraft(ready({ categoryIds: '' }), { categoryIds: ['4001'] })
    .blockingIssues.filter(i => i.key === 'categoryIds').length, 0, '页面传数组形态')
  assert.equal(evalDraft(ready({ categoryIds: '' }), { categoryIds: [] })
    .blockingIssues.filter(i => i.key === 'categoryIds').length, 1)
  // 负控:取消选择后残留的空逗号串,不能因为「字符串非空」被判成已选
  assert.equal(evalDraft(ready({ categoryIds: ',' }))
    .blockingIssues.filter(i => i.key === 'categoryIds').length, 1)
})

test('商家开关读 openMerchantPool,不新造字段', () => {
  assert.equal(evalDraft(ready()).merchantRequired, false)
  assert.equal(evalDraft(ready({ openMerchantPool: 1 })).merchantRequired, true)
})

// ===== 负控:每条规则被破坏时必须判红 =====

test('负控:去掉剧情闸后城市定向会误放行 —— 证明上面的断言不是恒真', () => {
  // 直接构造「剧情为空但仍要求 canAddNode=true」的期望,应当失败
  const r = evalDraft(ready({ chapters: [chapter({ description: '' })] }))
  assert.throws(
    () => assert.equal(r.chapterStates[0].canAddNode, true),
    assert.AssertionError,
  )
})

test('负控:把占位文案当真实剧情会让闸失效', () => {
  const r = evalDraft(ready({ chapters: [chapter({ description: '暂无描述' })] }))
  assert.throws(
    () => assert.equal(r.chapterStates[0].storyDone, true),
    assert.AssertionError,
  )
})

test('负控:自由探索补上 recruitDeadline 后不得再报该错(避免误红)', () => {
  const r = evalDraft(ready({ productType: 2, recruitDeadline: '2026-09-01' }))
  assert.equal(r.blockingIssues.filter(i => i.key === 'recruitDeadline').length, 0)
})
