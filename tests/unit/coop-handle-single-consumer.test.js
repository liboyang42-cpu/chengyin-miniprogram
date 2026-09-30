const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

// /api/coop/handle 一个端点承载两个**不同角色**的动作,后端
// ApiCoopController.handle 的规则写死了这条分界:
//
//     「接受/拒绝须受邀方本人;取消须发起方本人。」
//
//   status 1 已接受 / 2 已拒绝  → 受邀方(**商家或俱乐部**)
//   status 3 已取消            → 发起方(俱乐部 / 官方)
//
// 所以「只准有一个消费方」是错的判据 —— 它把两个角色的动作当成同一件事的重复实现。
// 2026-08-08 曾照那个判据把发起方的取消一起退役,俱乐部从此无法撤回自己发出的邀约,
// 而 cancelAccepted 那条链是**涉资的**(锁价前取消要退保证金)。门禁当时还是绿的。
//
// 2026-09-06 再修一次同类错:上一版把「受邀方 = 商家」写死了,于是
//   **俱乐部作为受邀方**收到的邀约,在小程序里一个能点的地方都没有 —— coop-center 是
//   商家页,俱乐部进不去。后端 handle 从来允许俱乐部接受(它只要求「受邀方本人」),
//   Figma 02b 也把接受/拒绝画在收件箱。这是能力缺失,不是「收敛干净了」。
//
// 正确的判据是**按面所服务的角色对齐,而不是按角色各配一个面**:
//   pages/merchant/coop-center = 商家作为受邀方        → 只准 1/2,发 3 必被后端拒
//   pages/coop/list            = 俱乐部这一侧的全部动作 → 作为发起方取消 3
//                                                        + 作为受邀方接受/拒绝 1/2
//
// ★ 判据不是「文件清单等于某两个字符串」—— 那样只能证明清单没被改过。
//   这里逐个消费方**解析它实际发出的 status 值**,再核对角色归属。

// 2026-09-08 加第三个面:pages/coop/invite-detail(Figma 02d-1~5 协作详情)。
//   它服务的角色**和 coop/list 完全相同**(俱乐部既是受邀方也是发起方),
//   所以按本文件的判据「按面所服务的角色对齐,而不是按角色各配一个面」,
//   它和 coop/list 同属俱乐部侧,允许 1/2/3;而不是因为「多了一个文件」就判违规。
//   ⚠️ 反过来也要成立:它绝不能出现在商家那一侧的允许集里。
// 2026-09-15 用户裁决「全站合作只有 收到的 / 我发出的 两个入口」:合作中心「邀约我的」tab 删除,
//   商家作为受邀方的接受/拒绝也收进 pages/coop/list「收到的」。于是 coop/list 同时服务
//   **商家与俱乐部**两种受邀方 + 发起方,判据仍是「按面服务的角色对齐」—— 只是商家那一个面合并进来了。
const INITIATOR_SURFACE = 'pages/coop/list/index.js';
const CLUB_DETAIL_SURFACE = 'pages/coop/invite-detail/index.js';
const CLUB_SURFACES = [INITIATOR_SURFACE, CLUB_DETAIL_SURFACE];

const MERCHANT_STATUSES = new Set([1, 2]);       // 商家页只服务受邀方
const CLUB_STATUSES = new Set([1, 2, 3]);        // 俱乐部页两个角色都服务

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ['tests', 'scripts', 'node_modules', 'miniprogram_npm'].includes(entry.name)) return [];
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolute] : [];
  });
}

function consumers() {
  return jsFiles(ROOT)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('/api/coop/handle'))
    .map((file) => path.relative(ROOT, file))
    .sort();
}

// 注释里提到 data-status / status: 3 是在**描述**这条规则,不是在发请求。
// 不剥注释就会拿解释规则的那段话去判违规 —— 本文件自己的注释第一次跑就把自己判红了。
// (同类:ds-hardcode-gate.sh:47 记的「注释里写 #486 被当成三位色值」)
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 找出一个文件里发往 /api/coop/handle 的 status 取值。两种形态都要覆盖:
//   ① 对象字面量        —— coop/list:      data: JSON.stringify({ id: id, status: 3, ... })
//   ② 位置参数经转发函数 —— coop-center:    this.submitInvite(id, 1, '') → submitInvite 里再发请求
// 只认 ① 会把 coop-center 误判成「一个 status 都没发」。
function statusesSentBy(relativePath) {
  const source = stripComments(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
  const literals = new Set();

  // ① 直接写在请求体里的
  for (const m of source.matchAll(/status:\s*(\d+)/g)) literals.add(Number(m[1]));

  // ①b 三元里的 status —— 2026-09-06 补的盲点:
  //     `status: accept ? 1 : 2` 不匹配上面那条正则,于是一个真的发 1/2 的调用点
  //     会被判成「一个 status 都没发」,门禁全绿。这正是本文件要防的那类漏判。
  for (const m of source.matchAll(/status:\s*[^,}\n]*\?\s*(\d+)\s*:\s*(\d+)/g)) {
    literals.add(Number(m[1]));
    literals.add(Number(m[2]));
  }

  // ② 找到「真正发请求的那个方法」,再回头收集它在本文件内所有调用点的整数实参。
  //    定位方式:从 /api/coop/handle 往前找最近的一个方法名声明。
  const sendIndex = source.indexOf('/api/coop/handle');
  if (sendIndex > 0) {
    const before = source.slice(0, sendIndex);
    // 控制流关键字长得跟方法声明一样(`catch (error) {`),不排掉就会把 "catch" 当成发送方名字
    const KEYWORDS = new Set(['catch', 'if', 'for', 'while', 'switch', 'return', 'try', 'function', 'do', 'else']);
    const decls = Array.from(before.matchAll(/(?:^|\n)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g))
      .filter((m) => !KEYWORDS.has(m[1]));
    const senderName = decls.length ? decls[decls.length - 1][1] : null;
    if (senderName) {
      const callSite = new RegExp(`[.\\s]${senderName}\\s*\\(([^)]*)\\)`, 'g');
      for (const call of source.matchAll(callSite)) {
        for (const arg of call[1].split(',')) {
          const n = arg.trim();
          if (/^\d+$/.test(n)) literals.add(Number(n));
        }
      }
    }
  }

  // 动态来源:dataset.status / data-status —— 这类写法让静态判定失效,
  // 必须显式报出来,不能当作「没有发 status」而静默通过。
  const dynamic = /dataset\.status|data-status/.test(source);
  return { literals, dynamic };
}

test('/api/coop/handle 的消费方 = 协作邀请页 + 协作详情,各自服务受邀方与发起方', () => {
  assert.deepEqual(
    consumers(),
    CLUB_SURFACES.slice().sort(),
    '消费方集合变了:收发件箱(coop/list)与协作详情(coop/invite-detail)之外再多一个,要先说清它服务的是哪个角色'
  );
});

test('收发件箱与详情都承载 接受1 / 拒绝2(受邀方)与 取消3(发起方),不许动态 status', () => {
  for (const surface of CLUB_SURFACES) {
    const sent = statusesSentBy(surface);
    assert.equal(sent.dynamic, false, `${surface} 用 dataset.status 动态传 status,静态判不出角色 —— 请写成字面量`);
    for (const s of sent.literals) {
      assert.ok(CLUB_STATUSES.has(s), `${surface} 发出了 status=${s};只允许 1/2(受邀方)与 3(发起方)。`);
    }
    // 三条能力缺一不可,少哪条都是死路而不是「收敛干净了」
    for (const need of [1, 2, 3]) {
      assert.ok(sent.literals.has(need), `${surface} 没有发 status=${need};接受/拒绝/取消少一条就是死路`);
    }
  }
});

test('合作中心不再处理邀约,只以铃铛进协作邀请页', () => {
  const center = fs.readFileSync(path.join(ROOT, 'pages/merchant/coop-center/index.js'), 'utf8');
  assert.doesNotMatch(center, /\/api\/coop\/handle/);
  assert.match(center, /url: '\/pages\/coop\/list\/index'/);
});
