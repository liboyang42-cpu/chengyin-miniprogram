/**
 * 仓库不得跟踪机器绝对路径的 symlink
 *
 * 为什么有这条:master 长期跟踪着 chengyinhub-xcx/node_modules,内容是
 * /Users/developer/Downloads/chengyin/chengyinhub-xcx/node_modules —— 一条指向自己的绝对路径 symlink。
 * 它在本机 ls 会报 "Too many levels of symbolic links",在别人机器 checkout 出来是死链,
 * 还会污染任何递归遍历/打包。.gitignore 里写的是 "node_modules/",带斜杠只匹配目录,
 * symlink 匹配不到,所以它一路逃到了 master。
 *
 * 判据取自 git 索引本身(不是磁盘现状),所以别人重新 add 回来一样会红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })

/** [{mode, sha, file}] —— 只要 symlink(mode 120000) */
function trackedSymlinks() {
  return git('ls-files', '-s')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [meta, file] = line.split('\t')
      const [mode, sha] = meta.split(/\s+/)
      return { mode, sha, file }
    })
    .filter(e => e.mode === '120000')
}

test('没有任何 tracked symlink 指向绝对路径', () => {
  const offenders = trackedSymlinks()
    .map(e => ({ ...e, target: git('cat-file', '-p', e.sha).trim() }))
    .filter(e => e.target.startsWith('/'))
    .map(e => `${e.file} -> ${e.target}`)
  assert.deepEqual(
    offenders,
    [],
    `symlink 指向机器绝对路径,换台机器 checkout 就是死链:\n${offenders.join('\n')}`,
  )
})

test('没有任何 tracked 路径叫 node_modules', () => {
  const offenders = git('ls-files')
    .split('\n')
    .filter(f => f.split('/').includes('node_modules'))
  assert.deepEqual(offenders, [], `依赖目录不该进版本库:\n${offenders.slice(0, 10).join('\n')}`)
})

test('negative control:判定逻辑读得到 git 索引', () => {
  const all = git('ls-files', '-s').split('\n').filter(Boolean)
  assert.ok(all.length > 500, `git ls-files 只返回 ${all.length} 行,索引没读到,上面两条会恒绿`)
  // 构造一条该被抓的记录,确认过滤逻辑真的会命中
  const fake = [{ file: 'x/node_modules', target: '/Users/someone/x' }].filter(e => e.target.startsWith('/'))
  assert.equal(fake.length, 1, '绝对路径判定失效')
  assert.ok('a/node_modules/b'.split('/').includes('node_modules'), 'node_modules 路径段判定失效')
})
