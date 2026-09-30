'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const REPO = path.resolve(ROOT, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const readRepo = (file) => fs.readFileSync(path.join(REPO, file), 'utf8')

const CONTROLLER = 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiTopicController.java'

/* 稿 E2(99:6181 / 99:6679)记的是一处**假保证**:「我的权益」页写着「未解锁勋章设计」,
   创作端的通关勋章弹窗却三端都能设、保存也照收。
   稿自己的原话:「真要落代码时有两层要一起做,只做前端就是假保证」。
   所以这一条也分两截查 —— 少任何一截,这个闸就是假的。 */

function assertBackendGate(source) {
  assert.match(source, /checkDesignMedal/,
    '主题保存路径必须挂 ICapabilityGuard#checkDesignMedal')
  // create 与 update 两条路都要拦:只拦 create 的话,建的时候不填、回头编辑再填就绕过去了
  const calls = source.match(/checkMedalCapability\(/g) || []
  assert.ok(calls.length >= 3,
    `create / update 两条保存路径都要调 checkMedalCapability(含定义共 ${calls.length} 处，至少 3)`)
  // 只在真要写勋章时才查:无条件拦会把「身份变了、只想改描述」的存量作者锁在自己主题外面
  assert.match(source, /wantsMedal[\s\S]{0,200}?if \(!wantsMedal\)[\s\S]{0,60}?return null/,
    '没有要写勋章时必须直接放行,不能无条件拦')
}

test('E2 后端:主题 create/update 都挂上了勋章资格闸', () => {
  assertBackendGate(readRepo(CONTROLLER))
})

test('负控:把勋章资格闸从主题保存路径摘掉必须判红', () => {
  const broken = readRepo(CONTROLLER).replace(/checkMedalCapability\(/g, 'noopMedalCheck(')
  assert.notEqual(broken, readRepo(CONTROLLER), '变异夹具必须真的把调用点改掉')
  assert.throws(() => assertBackendGate(broken))
})

test('E2 前端:锁态只读**不清空**,且默认不擅自上锁', () => {
  const js = read('pages/publish/fabu/index.js')
  assert.match(js, /medalEditable: !roleGuard\.hasSnapshot\(\) \|\| roleGuard\.can\('canDesignMedal'\)/,
    '拿不到权限快照时按可编辑处理,与招商资格同一条取舍')
  // 锁态绝不能顺手清掉存量勋章 —— 那等于替用户删图
  assert.doesNotMatch(js, /medalEditable[\s\S]{0,400}?formData\.finishMedal(Name|Img)'\]\s*=/,
    '锁态不许清空 formData.finishMedal*')

  const wxml = read('pages/publish/fabu/topic-detail-sheet.wxml')
  assert.match(wxml, /<block wx:if="\{\{medalEditable\}\}">/, '可编辑档要挂在 medalEditable 上')
  assert.match(wxml, /勋章设计是俱乐部主理人的权益，当前身份暂未解锁/, '锁态要说清为什么不能用')
  assert.match(wxml, /node-pill--locked[\s\S]{0,40}?未解锁/, '稿 99:6233 的「未解锁」药丸')
  // 锁态里不许还留着可写控件
  const locked = /<block wx:else>([\s\S]*?)<\/block>/.exec(
    wxml.slice(wxml.indexOf('<block wx:if="{{medalEditable}}">')))
  assert.ok(locked, '找不到锁态分支')
  assert.doesNotMatch(locked[1], /<input|bindinput|uploadFinishMedal|clearFinishMedal/,
    '锁态里不能还留着输入框 / 上传 / 清除')
})
