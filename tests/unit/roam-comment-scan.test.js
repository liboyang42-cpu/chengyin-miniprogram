const test = require('node:test')
const assert = require('node:assert/strict')
const { stripComments, scanRoam } = require('../../scripts/roam-redline-gate')

test('漫游扫描屏蔽真实跨行注释，保留字符串里的注释符及其后的违规', () => {
  const source = [
    "const marker = '/*';",
    "app.tips('下一站去公园');",
    '/* 说明',
    '下次打开才清理草稿 */',
    "app.tips('https://example.test//下一站');",
    "const regex = /[/*]/;",
    "app.tips('下一次继续');",
  ].join('\n')
  const masked = stripComments(source)
  assert.ok(masked.includes("app.tips('下一站去公园');"))
  assert.ok(masked.includes("app.tips('https://example.test//下一站');"))
  assert.ok(masked.includes("app.tips('下一次继续');"))
  assert.ok(!masked.includes('下次打开才清理草稿'))
  assert.equal(masked.split('\n').length, source.split('\n').length)
})

test('当前nearby草稿说明不是面向用户的前瞻引导', () => {
  assert.deepEqual(scanRoam().filter(i => i.rule.id === 'R1' && i.file.endsWith('/nearby/index.js')), [])
})


test('模板插值中的真注释被屏蔽，嵌套模板不能吞掉后续文案', () => {
  const vm = require('node:vm')
  const cases = [
    ['const a = `x ${`/*`} y`;\napp.tips("下一站去公园");', '下一站去公园', true],
    ['const a = `x ${ /* 下一站 */ 1 } y`;', '下一站', false],
    ['const a = `x ${ {v: `a ${ /* 下一站 */ 2 } b`}.v } y`;\napp.tips("下一次继续");', '下一次继续', true],
    ['const a = `x ${ {v: `a ${ /* 下一站 */ 2 } b`}.v } y`;', '下一站', false],
  ]
  for (const [source, word, expected] of cases) {
    new vm.Script(source)
    const masked = stripComments(source)
    assert.equal(masked.includes(word), expected, source)
    assert.equal(masked.split('\n').length, source.split('\n').length)
  }
})

test('控制语句后合法正则不能吞掉下一行真实 R1 违规', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const vm = require('node:vm')
  const root = path.resolve(__dirname, '../..')
  const dir = fs.mkdtempSync(path.join(root, 'subpackageRoam/scan-comment-test-'))
  const source = "if (ok) /[/*]/.test('a');\napp.tips('下一站');\n"
  new vm.Script(source)
  try {
    const file = path.join(dir, 'regex.js')
    fs.writeFileSync(file, source)
    const hits = scanRoam().filter(i => i.file.endsWith(path.basename(dir) + '/regex.js') && i.rule.id === 'R1')
    assert.deepEqual(hits.map(i => i.line), [2])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('完整 JS 按语法区分控制括号、块、对象除法及正则，保留所有 literal', () => {
  const vm = require('node:vm')
  const cases = [
    "if (ok) /[/*]/.test('a');",
    "while (ok) /[/*]/.test('a');",
    "for (;ok;) /[/*]/.test('a');",
    "if (ok) {} /[/*]/.test('a');",
    "function f() {} /[/*]/.test('a');",
    "const f = function () {} / 2;",
    "const f = (() => {}) / 2;",
    "const n = ({ x: 1 }).x / 2;",
    "const n = `x ${/[/*]/.test('a') ? `/*` : ''}`;",
    "const n = `# 下一站\n* 下一次\n-- 下回`;",
    "const n = '<!-- 下一站 -->';",
    "const n = /[/*下一站]/;",
    "const n = 'https://example.test//下一站';",
  ]
  for (const prefix of cases) {
    const source = prefix + "\n/* 下一站注释\n下一次注释 */\napp.tips('下一站');"
    new vm.Script(source)
    const out = stripComments(source, 'source.js')
    assert.equal(out.slice(0, prefix.length), prefix)
    assert.ok(out.endsWith("app.tips('下一站');"))
    assert.ok(!out.includes('下一站注释'))
    assert.equal(out.length, source.length)
    assert.deepEqual([...out.matchAll(/\n/g)].map(m => m.index), [...source.matchAll(/\n/g)].map(m => m.index))
  }
})

test('完整 ESM 和 hashbang 可扫描，非法完整 JS 必须显式失败', () => {
  const source = "#!/usr/bin/env node\nexport const hint = `下一站 ${ /* 解释 */ 1 }`;"
  assert.ok(stripComments(source, 'module.js').includes('下一站'))
  assert.ok(!stripComments(source, 'module.js').includes('解释'))
  assert.throws(() => stripComments("if (ok) /[/*]/.test('a');\nconst = ;\napp.tips('下一站')", 'broken.js'), /broken.js: JS 注释解析失败/)
})

test('H11 在完整 JS 上屏蔽注释再选新增行，不漏模板正文或正则之后真违规', () => {
  const { scanH11 } = require('../../scripts/roam-redline-gate')
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve(__dirname, '../..')
  const dir = fs.mkdtempSync(path.join(root, 'subpackageRoam/scan-comment-test-'))
  const relative = 'chengyinhub-xcx/subpackageRoam/' + path.basename(dir) + '/h11.js'
  const source = ['/*', 'open_line', '*/', 'const text = `', '# open_line', '`;', "if (ok) /[/*]/.test('a');", 'const tier_k = 1;', 'const open_line = 2;'].join('\n')
  try {
    fs.writeFileSync(path.join(dir, 'h11.js'), source)
    const entries = [2, 5, 8].map(line => ({ file: relative, line, text: source.split('\n')[line - 1] }))
    assert.deepEqual(scanH11(entries).filter(i => i.rule.id === 'H11-1').map(i => i.line), [5, 8])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('缺失文件片段及 Java/XML/SQL 的原注释与违规合同保留', () => {
  const { scanH11 } = require('../../scripts/roam-redline-gate')
  const samples = [
    ['missing.js', "payload.openLine = 1; // 原注释"],
    ['missing.java', 'private Integer openLine; // 原注释'],
    ['missing.xml', '<result property="openLine" column="open_line"/> <!-- 原注释 -->'],
    ['missing.sql', 'ALTER TABLE x ADD COLUMN open_line INT; -- 原说明'],
  ]
  for (const [file, text] of samples) assert.ok(scanH11([{ file, text, line: 1 }]).length > 0)
  assert.equal(stripComments('<!--\n下一站\n-->\n<view>正常</view>', 'a.wxml').includes('下一站'), false)
  assert.equal(stripComments('/*\n下一站\n*/\nclass X {}', 'a.java').includes('下一站'), false)
  assert.equal(stripComments('-- open_line\nSELECT perk_min_value;', 'a.sql').includes('open_line'), false)
})

test('内置 Acorn 缺失必须失败，默认 mask 不依赖它', () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const path = require('node:path')
  const file = path.resolve(__dirname, '../../scripts/lib/xcx-scan.js')
  const module = { exports: {} }
  const sandboxRequire = id => {
    if (id === 'internal/deps/acorn/acorn/dist/acorn') {
      const error = new Error('not available'); error.code = 'MODULE_NOT_FOUND'; throw error
    }
    return require(id)
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: sandboxRequire, module, exports: module.exports, __dirname: path.dirname(file), process: { binding: () => ({}) } })
  assert.equal(module.exports.maskNonCode("const a = 'x';"), 'const a =    ;')
  assert.throws(() => module.exports.maskJavaScriptComments("app.tips('下一站')"), /禁止跳过 JS 扫描/)
})

test('H11 缺源片段不能将真实模板正文误认成注释，命中只标待核验', () => {
  const { scanH11 } = require('../../scripts/roam-redline-gate')
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve(__dirname, '../..')
  const dir = fs.mkdtempSync(path.join(root, 'subpackageRoam/scan-comment-test-'))
  const file = 'chengyinhub-xcx/subpackageRoam/' + path.basename(dir) + '/fragment.js'
  const absolute = path.join(dir, 'fragment.js')
  const source = ['const text = `', '// open_line', '/* 最低人数 */', '`;'].join('\n')
  const entries = [2, 3].map(line => ({ file, line, text: source.split('\n')[line - 1] }))
  try {
    fs.writeFileSync(absolute, source)
    const certain = scanH11(entries)
    assert.deepEqual(certain.map(hit => hit.line), [2, 3])
    assert.ok(certain.every(hit => !hit.sourceUncertain))
    fs.unlinkSync(absolute)
    const uncertain = scanH11(entries)
    assert.deepEqual(uncertain.map(hit => hit.line), [2, 3])
    assert.deepEqual(uncertain.map(hit => hit.text), entries.map(entry => entry.text))
    assert.ok(uncertain.every(hit => hit.sourceUncertain === true))
    for (const text of ["if (ok) /[/*]/.test('a'); payload.openLine = 1;", "} else { payload.openLine = 1;"]) {
      const hits = scanH11([{ file, text, line: 1 }])
      assert.ok(hits.some(hit => hit.rule.id === 'H11-2'))
      assert.ok(hits.every(hit => hit.sourceUncertain === true))
    }
    for (const text of ['// 普通说明', '} else { ordinary();', 'const perk_min_value = 1;']) {
      assert.deepEqual(scanH11([{ file, text, line: 1 }]), [])
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
