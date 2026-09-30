'use strict'

// 解散俱乐部是「后端已生效、前端只能靠事件知道」的单向链路:
// scene-club-edit 收到 /api/club/dissolve 200 后 triggerEvent('dissolved'),
// 宿主负责清 dirty + 提示 + 退出。宿主漏绑 = 俱乐部真没了,但用户停在已删俱乐部的编辑页,
// 且 dirty 没清还会被「未保存」二次确认拦住。WXML 合法、组件存在,静态门禁看不见。
// 2026-08-10 实证:PR #678 加 automator 用的 id= 时顺手吃掉了 pages/club/edit 的 bind:dissolved。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', 'tests', 'scripts', 'docs', '.obsidian', '.serena'])

function walkWxml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walkWxml(p, out)
    else if (name.endsWith('.wxml')) out.push(p)
  }
  return out
}

// 负控的另一半:事件名要是被改掉/删掉,下面的断言就成了恒真。先钉住事件真的存在。
test('scene-club-edit 仍然对外抛 dissolved 事件', () => {
  const componentJs = fs.readFileSync(path.join(ROOT, 'components/cy/scene-club-edit/index.js'), 'utf8')
  assert.match(
    componentJs,
    /triggerEvent\(\s*['"]dissolved['"]/,
    'scene-club-edit 不再抛 dissolved —— 事件改名了就得同步改本契约与所有宿主,不能让断言静默变恒真',
  )
})

test('每个 cy-scene-club-edit 宿主都必须绑 dissolved,且 handler 真实存在', () => {
  // 多行标签也要吃到:<cy-scene-club-edit\n  bind:xxx="yyy"\n/>
  const TAG = /<cy-scene-club-edit\b[\s\S]*?\/?>/g
  const hosts = walkWxml(ROOT).filter((p) => /<cy-scene-club-edit\b/.test(fs.readFileSync(p, 'utf8')))

  assert.ok(hosts.length >= 3, `宿主只找到 ${hosts.length} 个,少于已知的 3 个 —— 扫描口径坏了或宿主被删`)

  for (const wxmlPath of hosts) {
    const rel = path.relative(ROOT, wxmlPath)
    for (const tag of fs.readFileSync(wxmlPath, 'utf8').match(TAG) || []) {
      const bound = tag.match(/bind:?dissolved\s*=\s*"([^"]+)"/i)
      assert.ok(bound, `${rel}: cy-scene-club-edit 没绑 dissolved —— 解散成功后宿主收不到,用户会卡在已删俱乐部的页面`)

      const handler = bound[1].trim()
      const siblingJs = wxmlPath.replace(/\.wxml$/, '.js')
      assert.ok(fs.existsSync(siblingJs), `${rel}: 找不到同名 js,无法核实 handler ${handler}`)
      assert.match(
        fs.readFileSync(siblingJs, 'utf8'),
        new RegExp(`\\b${handler}\\s*[(:]`),
        `${path.relative(ROOT, siblingJs)}: 绑了 dissolved="${handler}" 但没有这个 handler`,
      )
    }
  }
})
