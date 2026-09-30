const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function assertTalentFeedEmptyCopy(source) {
  const titleBranch = source.match(
    /feedEmptyTitle:\s*noClub\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/,
  );
  const subBranch = source.match(
    /feedEmptySub:\s*noClub\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/,
  );

  assert.ok(titleBranch, '帖文流必须保留 noClub / 有俱乐部两条空态标题');
  assert.ok(subBranch, '帖文流必须保留 noClub / 有俱乐部两条空态副题');
  assert.doesNotMatch(titleBranch[1], /^你还没有俱乐部/,
    '帖文 tab 的空态标题不能先讲俱乐部前置条件');
  // 只断语义不断字面:文案可改措辞,但「标题说你来看的东西、副题才解释前置条件」这条角色分工不能变。
  // 写死整句会把文案锁死(改一个字就红),而且拦不住换一句同样串页的话 —— 那正是本 PR 要治的病。
  assert.match(titleBranch[1], /帖文/, 'noClub 标题必须先说明这里没有帖文(用户是为帖文来的)');
  assert.doesNotMatch(titleBranch[1], /俱乐部/, 'noClub 标题不能把俱乐部前置条件当主语 —— 那就是串页感');
  assert.match(subBranch[1], /俱乐部/, '俱乐部前置条件应该由副题解释');
  assert.match(titleBranch[2], /帖文/, '有俱乐部时标题同样讲帖文');
  assert.doesNotMatch(titleBranch[2], /俱乐部/, '有俱乐部时标题不该再解释俱乐部');
}

test('帖文 tab 空态先说明这里没有帖文，再解释俱乐部来源', () => {
  assertTalentFeedEmptyCopy(read('pages/talent/list/index.js'));
});

test('negative control: 帖文空态标题改回“你还没有俱乐部”必须判红', () => {
  const source = read('pages/talent/list/index.js');
  const mutated = source.replace("noClub ? '这里还没有帖文'", "noClub ? '你还没有俱乐部'");
  assert.notEqual(mutated, source, '负控必须命中帖文空态标题');
  assert.throws(() => assertTalentFeedEmptyCopy(mutated), assert.AssertionError);
});
