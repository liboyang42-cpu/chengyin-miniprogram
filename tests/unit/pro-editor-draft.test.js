const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  createDraftUuid,
  draftKeyFor,
  loadDraft,
  readActiveNewDraft,
  rememberActiveNewDraft,
  removeDraft,
  saveDraft,
} = require('../../utils/publish/pro-editor-draft.js')

function makeStorage() {
  const values = Object.create(null)
  const calls = []
  return {
    values,
    calls,
    getStorageSync(key) { return values[key] },
    setStorageSync(key, value) { calls.push({ key, value }); values[key] = value },
    removeStorageSync(key) { delete values[key] },
  }
}

function input(over) {
  return Object.assign({
    memberId: 42,
    draftUuid: 'draft-a',
    baseRevision: '',
    formData: { name: '河畔路线', chapters: [{ name: '第一章', nodes: [] }] },
    pendingMaterials: [{ _localId: 'p1', kind: 'place', name: '河畔', description: '' }],
    savedAt: 123456,
  }, over)
}

test('每个新草稿 UUID 独立分桶，不会互相覆盖', () => {
  const storage = makeStorage()
  const firstUuid = createDraftUuid(1000, 0.111)
  const secondUuid = createDraftUuid(1000, 0.222)
  assert.notEqual(firstUuid, secondUuid)
  assert.notEqual(
    draftKeyFor({ draftUuid: firstUuid }),
    draftKeyFor({ draftUuid: secondUuid }),
    '测试语义是两个新草稿不共用一个桶，不锁死具体 key 字面量',
  )

  saveDraft(storage, input({ draftUuid: firstUuid, formData: { name: '草稿一', chapters: [] } }))
  saveDraft(storage, input({ draftUuid: secondUuid, formData: { name: '草稿二', chapters: [] } }))

  assert.equal(loadDraft(storage, { draftUuid: firstUuid }, { memberId: 42 }).envelope.formData.name, '草稿一')
  assert.equal(loadDraft(storage, { draftUuid: secondUuid }, { memberId: 42 }).envelope.formData.name, '草稿二')
})

test('一次同步写入完整草稿信封，章节与待编排素材来自同一快照', () => {
  const storage = makeStorage()
  const source = input()
  const key = saveDraft(storage, source)
  const envelopeWrites = storage.calls.filter(call => call.key === key)

  assert.equal(envelopeWrites.length, 1, '完整信封必须一次 setStorageSync 原子写入')
  assert.deepEqual(envelopeWrites[0].value, {
    memberId: 42,
    draftUuid: 'draft-a',
    baseRevision: '',
    formData: source.formData,
    chapters: source.formData.chapters,
    pendingMaterials: source.pendingMaterials,
    savedAt: 123456,
  })

  source.formData.chapters[0].name = '写入后被外部改坏'
  assert.equal(storage.values[key].chapters[0].name, '第一章', 'storage 快照不能继续引用页面可变对象')
})

test('恢复前校验 memberId，绝不把 A 的草稿恢复给 B', () => {
  const storage = makeStorage()
  saveDraft(storage, input({ memberId: 7 }))

  const result = loadDraft(storage, { draftUuid: 'draft-a' }, { memberId: 8 })
  assert.equal(result.status, 'member_mismatch')
  assert.equal(result.envelope, null)
})

test('编辑既有主题时 baseRevision 不一致必须返回冲突而非静默合并', () => {
  const storage = makeStorage()
  saveDraft(storage, input({ draftUuid: undefined, topicId: 99, baseRevision: 'server-v1' }))

  const result = loadDraft(storage, { topicId: 99 }, {
    memberId: 42,
    currentBaseRevision: 'server-v2',
  })
  assert.equal(result.status, 'revision_conflict')
  assert.equal(result.envelope.baseRevision, 'server-v1')
})

test('活跃新草稿指针按账号隔离，删除草稿会同时清掉当前账号指针', () => {
  const storage = makeStorage()
  rememberActiveNewDraft(storage, 1, 'draft-one')
  rememberActiveNewDraft(storage, 2, 'draft-two')
  assert.equal(readActiveNewDraft(storage, 1), 'draft-one')
  assert.equal(readActiveNewDraft(storage, 2), 'draft-two')

  saveDraft(storage, input({ memberId: 1, draftUuid: 'draft-one' }))
  removeDraft(storage, { draftUuid: 'draft-one' }, { memberId: 1 })
  assert.equal(loadDraft(storage, { draftUuid: 'draft-one' }, { memberId: 1 }).status, 'missing')
  assert.equal(readActiveNewDraft(storage, 1), '')
  assert.equal(readActiveNewDraft(storage, 2), 'draft-two')
})
