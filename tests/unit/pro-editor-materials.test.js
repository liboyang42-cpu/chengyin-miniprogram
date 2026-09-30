const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  arrangementIssue,
  materialFromNode,
  nodeFromMaterial,
} = require('../../pages/publish/utils/publish/pro-editor-materials.js')

const chapter = (description) => ({
  name: '第一章',
  description,
  nodes: [],
})

const material = (over) => Object.assign({
  _localId: 'material-1',
  kind: 'node',
  name: '河畔线索',
  description: '找到桥下的旧刻字',
  address: '滨江路 8 号',
  longitude: '121.48',
  latitude: '31.23',
  imgUrl: 'node.jpg',
  duration: 45,
  gameplay: null,
}, over)

test('节点移入待编排区时保留指定数据形状与玩法/钩子配置', () => {
  const result = materialFromNode({
    _localId: 'node-local-1',
    name: '河畔线索',
    description: '找到桥下的旧刻字',
    address: '滨江路 8 号',
    longitude: '121.48',
    latitude: '31.23',
    imgUrl: 'node.jpg',
    nodeTime: 45,
    templateId: 7,
    templateInfo: { title: '文字暗号' },
    templateName: '文字暗号',
    showTemplate: true,
    hookText: '抬头看桥洞',
    cardHookLong: '沿河往东走',
    fragmentText: '旧城记忆',
  }, 'node')

  assert.deepEqual(Object.keys(result).sort(), [
    '_localId', 'address', 'description', 'duration', 'gameplay', 'imgUrl',
    'kind', 'latitude', 'longitude', 'name',
  ].sort())
  assert.equal(result._localId, 'node-local-1')
  assert.equal(result.duration, 45)
  assert.equal(result.gameplay.templateId, 7)
  assert.equal(result.gameplay.hookText, '抬头看桥洞')
  assert.equal(result.gameplay.cardHookLong, '沿河往东走')
  assert.equal(result.gameplay.fragmentText, '旧城记忆')
})

test('待编排素材转回正式节点时恢复玩法并使用章内顺序', () => {
  const node = nodeFromMaterial(material({
    gameplay: {
      templateId: 9,
      templateInfo: { title: '拍照打卡' },
      templateName: '拍照打卡',
      showTemplate: true,
      hookText: '找到红门',
    },
  }), 3)

  assert.equal(node._localId, 'material-1')
  assert.equal(node.nodeTime, 45)
  assert.equal(node.sortID, 3)
  assert.equal(node.templateId, 9)
  assert.equal(node.hookText, '找到红门')
})

test('只有地址没有坐标的素材必须在坐标闸被拒绝', () => {
  const issue = arrangementIssue({
    productType: 2,
    chapter: chapter(''),
    material: material({ longitude: '', latitude: '', address: '只有地址' }),
  })

  assert.deepEqual(issue, {
    field: 'coordinates',
    message: '请先补齐有效地点坐标',
  }, '必须命中坐标闸，不能被名称或章节闸代替')
})

test('城市定向不能把素材放进空剧情章节', () => {
  const issue = arrangementIssue({
    productType: 1,
    chapter: chapter(''),
    material: material(),
  })

  assert.deepEqual(issue, {
    field: 'chapterStory',
    message: '城市定向需先完成目标章节剧情',
  })
})

test('素材名称、坐标及城市剧情齐全时允许转正', () => {
  assert.equal(arrangementIssue({
    productType: 1,
    chapter: chapter('沿河寻找失落的手稿'),
    material: material(),
  }), null)
})
