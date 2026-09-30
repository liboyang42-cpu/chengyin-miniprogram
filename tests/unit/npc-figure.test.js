// 门店分身低模人形的几何契约(2026-09-07)。
//
// 这一块是纯函数,所以能在没有真机、没有 canvas 的情况下把「转起来对不对」验到可断言:
// 面朝向、背面剔除、深度排序、明暗范围、以及转到极限角还在不在画面里。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildFigure, project, shadeFaces } = require('../../pages/play/utils/npc-figure.js')

const W = 400, H = 440
const model = buildFigure()

function frame(ry) {
  const proj = project(model.verts, ry, W, H)
  return { proj, faces: shadeFaces(model.verts, model.faces, ry, proj) }
}

test('人形是实的:有头、有躯干、有两条手臂,不是一个球', () => {
  assert.ok(model.verts.length > 120, '顶点太少说明某个部件没建出来,实测 ' + model.verts.length)
  assert.ok(model.faces.length > 200, '面太少,实测 ' + model.faces.length)
  const ys = model.verts.map((v) => v[1])
  assert.ok(Math.max(...ys) > 0.85, '头顶要在 y>0.85')
  assert.ok(Math.min(...ys) < -0.55, '躯干底要在 y<-0.55')
  // 手臂的判据挂在躯干半径上,不写死数值:躯干最宽处在 y∈[-0.6,0.46] 那一段,
  // 比它还宽的顶点只可能来自手臂。改躯干粗细时这条会自己跟着走。
  const torsoR = Math.max(...model.verts
    .filter((v) => v[1] > -0.62 && v[1] < 0.47)
    .map((v) => Math.abs(v[2])))          // z 向没有手臂,所以 |z| 的极大值就是躯干半径
  assert.ok(torsoR > 0.2 && torsoR < 0.32, '躯干半径读数不对:' + torsoR.toFixed(3))
  assert.ok(model.verts.some((v) => v[0] < -torsoR - 0.02), '缺左臂')
  assert.ok(model.verts.some((v) => v[0] > torsoR + 0.02), '缺右臂')
})

test('背面剔除真的在剔:可见面必须显著少于总面数', () => {
  const { faces } = frame(0)
  assert.ok(faces.length < model.faces.length * 0.75,
    '剔不掉背面的话,转到侧面会看见躯干内壁,像塌了一块。可见 ' + faces.length + '/' + model.faces.length)
  assert.ok(faces.length > 100, '剔太狠了,人形会缺面')
})

test('画家算法:面按远到近排,近的后画才能盖住远的', () => {
  const { faces } = frame(24)
  for (let i = 1; i < faces.length; i++) {
    assert.ok(faces[i - 1].z >= faces[i].z, '第 ' + i + ' 个面的深度顺序反了')
  }
})

test('明暗有范围但不全黑:背光面留了环境光垫底', () => {
  const { faces } = frame(0)
  const sh = faces.map((f) => f.shade)
  assert.ok(Math.min(...sh) >= 0.26, '背光面全黑会在暗底上消失,人形缺一块')
  assert.ok(Math.max(...sh) > 0.8, '没有受光面就没有体积感')
  assert.ok(Math.max(...sh) - Math.min(...sh) > 0.4, '明暗差太小,看着是一张剪影不是一个立体')
})

test('转到 ±38° 极限仍然完整落在画面内', () => {
  for (const ry of [-38, 0, 38]) {
    const { proj } = frame(ry)
    const xs = proj.p.map((q) => q[0]), ys = proj.p.map((q) => q[1])
    assert.ok(Math.min(...xs) > 0 && Math.max(...xs) < W, 'ry=' + ry + ' 横向出画')
    assert.ok(Math.min(...ys) > 0 && Math.max(...ys) < H, 'ry=' + ry + ' 纵向出画')
  }
})

// 真旋转与「横向压扁」的唯一可靠判据:x' = x·cos + z·sin —— 位移同时取决于 z。
// 所以取**x 几乎相同、z 明显不同**的两点,看它们挪得一样不一样。
// (只看「有点左移有点右移」是不够的:等比向中线压扁也会左右反向,我第一版就栽在这。)
function depthPairs() {
  const pairs = []
  for (let i = 0; i < model.verts.length; i++) {
    for (let j = i + 1; j < model.verts.length; j++) {
      const a = model.verts[i], b = model.verts[j]
      if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[2] - b[2]) > 0.2 && Math.abs(a[1] - b[1]) < 0.01) {
        pairs.push([i, j])
      }
    }
  }
  return pairs
}

function depthSpread(after) {
  const before = frame(0).proj.p
  let max = 0
  for (const [i, j] of depthPairs()) {
    const di = after[i][0] - before[i][0], dj = after[j][0] - before[j][0]
    max = Math.max(max, Math.abs(di - dj))
  }
  return max
}

test('转起来是真的绕 Y 轴转,不是把剪影压扁', () => {
  assert.ok(depthPairs().length > 20, '模型里要有成对的同 x 异 z 顶点才验得了这条')
  assert.ok(depthSpread(frame(30).proj.p) > 20,
    '同 x 异 z 的两点位移必须明显不同;一样就说明只是横向压扁')
})

test('负控:把旋转换成等比压扁,上一条必须判红', () => {
  const before = frame(0).proj.p
  const squashed = before.map((q) => [W / 2 + (q[0] - W / 2) * 0.8, q[1]])
  assert.ok(depthSpread(squashed) < 1,
    '压扁下同 x 异 z 的两点位移应当完全一致,实测 ' + depthSpread(squashed).toFixed(3))
})
