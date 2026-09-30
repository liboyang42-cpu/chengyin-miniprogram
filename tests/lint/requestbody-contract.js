#!/usr/bin/env node
/**
 * @RequestBody 契约静态扫描(纯 node,零依赖,无需开发者工具,可进 CI / code-review)。
 *
 * 抓的 bug:前端 POST 打后端 @RequestBody 端点,却不传 header。
 *   utils/transport/request-client.js buildHeader():POST 且不传 param.header
 *   → header 固定 {'content-type':'application/x-www-form-urlencoded;'}
 *   后端零自定义 HttpMessageConverter,urlencoded 打 @RequestBody =
 *   HTTP 200 + {code:500, msg:"Content type ... not supported"}(被 GlobalExceptionHandler
 *   的 @ExceptionHandler(Exception.class) 兜成 200,不是 415),业务方法体一行不执行
 *   —— 线上零告警,只能事后人肉发现。本仓库已踩三次:
 *   pages/club/enroll、pages/coop/list、fabu 的两个 AI 口。
 *
 * 正确写法(仓库既定惯例,两种各自自洽,不能混搭):
 *   data: JSON.stringify({...}), header: { 'Content-Type': 'application/json' }  // 大写必须配手动 stringify
 *   data: {...},                 header: { 'content-type': 'application/json' }  // 小写靠 wx.request 自己序列化
 *
 *   [ERROR] POST 到 @RequestBody 端点 + 完全不传 header  → 业务必不执行(线上零告警)
 *   [WARN ] url 动态拼接不出 / 后端匹配不到 / 匹配有歧义 → 需人工确认(不硬猜,避免假阳性)
 *
 * 假阳性防线:URL 按「路径段」精确匹配,@PathVariable 段({id})只当通配符 ——
 *   /api/official/broadcast/{id}/click(@PathVariable+@RequestParam,本来就对)
 *   与 /api/official/broadcast(@RequestBody)段数不同,绝不互相误配;
 *   /api/coop/list 也不会误配到 /api/coop/list-detail(不用 startsWith)。
 *
 * 用法: node tests/lint/requestbody-contract.js               (有 ERROR 时退出码 1)
 *       node tests/lint/requestbody-contract.js --warn-as-error
 */
const fs = require('fs');
const path = require('path');
const { resolveDynamicUrls, classifyEndpointCandidates } = require('./requestbody-dynamic-url');

const ROOT = path.resolve(__dirname, '..', '..');            // chengyinhub-xcx
const ADMIN = path.resolve(ROOT, '..', 'chengyinhub-admin'); // 同 worktree 的后端
const WARN_AS_ERROR = process.argv.includes('--warn-as-error');

const errors = [], warns = [];

// ---------- 通用:按扩展名递归 ----------
function walk(dir, ext, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (name !== 'node_modules' && name !== 'miniprogram_npm') walk(fp, ext, acc);
    } else if (name.endsWith(ext)) acc.push(fp);
  }
  return acc;
}

// ---------- 通用:剥注释(尊重字符串字面量,避免切坏 "http://" 之类) ----------
function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// ---------- 通用:从 openIdx(指向开括号)配对扫描,返回闭括号下标 ----------
function matchBracket(src, openIdx) {
  const open = src[openIdx];
  const close = open === '{' ? '}' : open === '(' ? ')' : null;
  if (!close) return -1;
  let depth = 0, i = openIdx;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i++;
      }
      i++; continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// ================= Pass A:扫后端,建 POST 端点表 =================
// URL 存为 segments 数组;@PathVariable 段({id})记为 null = 通配符。
function toSegments(url) {
  return url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').filter(s => s.length)
    .map(s => (s.indexOf('{') !== -1 ? null : s));
}
function joinUrl(a, b) {
  const l = (a || '').replace(/\/+$/, '');
  const r = b || '';
  if (!r) return l || '/';
  return l + (r.charAt(0) === '/' ? r : '/' + r);
}
// 注解参数串取 path:@PostMapping("/x") / @PostMapping(value = "/x", produces = ...)
function annotationPath(argsRaw) {
  if (argsRaw == null) return '';        // @PostMapping 无参 → 类根路径
  const s = argsRaw.trim();
  if (!s) return '';
  const v = s.match(/(?:^|[(,\s])value\s*=\s*"([^"]*)"/) || s.match(/^\s*\{?\s*"([^"]*)"/);
  return v ? v[1] : '';
}

const javaFiles = walk(path.join(ADMIN, 'src', 'main', 'java'), '.java', []);

// ★ 自检:扫不到后端就必须炸,不许安静地报 0 error。
// 本门禁跨模块反向读 ../chengyinhub-admin。若 CI 用稀疏检出/只 checkout 前端,walk() 会返回空 →
// 端点集为空 → 前端再怎么写都匹配不上 → 恒 0 error。那是「门禁在,但什么都没查」的假绿,
// 比没有门禁更危险(它给人已覆盖的错觉)。宁可红着让人来修路径,也不许绿着骗人。
if (javaFiles.length === 0) {
  console.error('[requestbody-contract] 扫不到任何后端 .java:' + path.join(ADMIN, 'src', 'main', 'java'));
  console.error('  本门禁必须能同时看到前端与后端才有意义。路径不存在 = 无法判定,不是「没问题」。');
  console.error('  若在 CI 中,请确认检出包含 chengyinhub-admin 模块(勿用只含前端的稀疏检出)。');
  process.exit(1);
}

const bodyEndpoints = [];      // @RequestBody 的 POST 端点
const otherPostEndpoints = []; // 非 @RequestBody 的 POST 端点(歧义判定用)

for (const jf of javaFiles) {
  const raw = fs.readFileSync(jf, 'utf8');
  if (!/@(RestController|Controller)\b/.test(raw)) continue;
  const src = stripComments(raw);

  // 类级 @RequestMapping = class 声明之前最后一个 @RequestMapping 的 path
  const classDecl = src.search(/\b(?:public\s+|abstract\s+|final\s+)*class\s+\w+/);
  let classPrefix = '';
  const rmRe = /@RequestMapping\s*(\()?/g;
  let rm;
  while ((rm = rmRe.exec(src)) !== null) {
    if (classDecl !== -1 && rm.index > classDecl) break;
    if (!rm[1]) { classPrefix = ''; continue; }
    const open = rm.index + rm[0].length - 1;
    const close = matchBracket(src, open);
    if (close === -1) continue;
    classPrefix = annotationPath(src.slice(open + 1, close));
  }

  // 方法级 @PostMapping(仓库内无 @RequestMapping(method=...) 写法,已核实)
  const pmRe = /@PostMapping\s*(\()?/g;
  let pm;
  while ((pm = pmRe.exec(src)) !== null) {
    let methodPath = '', after = pm.index + pm[0].length;
    if (pm[1]) {
      const open = pm.index + pm[0].length - 1;
      const close = matchBracket(src, open);
      if (close === -1) continue;
      methodPath = annotationPath(src.slice(open + 1, close));
      after = close + 1;
    }
    // 方法参数表:@PostMapping 之后第一个 public/protected/private,再取其 (...) 配对
    const tail = src.slice(after);
    const sig = tail.search(/\b(?:public|protected|private)\b/);
    if (sig === -1) continue;
    const parenRel = tail.indexOf('(', sig);
    if (parenRel === -1) continue;
    const parenAbs = after + parenRel;
    const parenEnd = matchBracket(src, parenAbs);
    if (parenEnd === -1) continue;
    const params = src.slice(parenAbs + 1, parenEnd);

    const url = joinUrl(classPrefix, methodPath);
    const rec = { segs: toSegments(url), url, file: path.relative(path.resolve(ROOT, '..'), jf) };
    // @RequestBody(required = false) 不豁免:Content-Type 存在且 body 非空时照抛
    if (/@RequestBody\b/.test(params)) bodyEndpoints.push(rec);
    else otherPostEndpoints.push(rec);
  }
}

// ★ 自检第二层:.java 扫到了,却一个 @RequestBody POST 端点都没解析出来 —— 那不是「后端很干净」,
// 是解析器坏了(后端换了注解写法/换了框架/本文件的正则失效)。此时前端全都匹配不上 → 恒 0 error 的假绿。
// 同理宁可红。阈值取 1 而非某个魔数:只要还有一个,说明解析链路是通的。
if (bodyEndpoints.length === 0) {
  console.error('[requestbody-contract] 扫了 ' + javaFiles.length + ' 个 .java,却解析出 0 个 @RequestBody POST 端点。');
  console.error('  这几乎必然是本门禁的解析器坏了(后端注解写法变了?),而不是后端真的一个都没有。');
  console.error('  解析器坏掉时本门禁会对任何前端代码都报 0 error —— 那是假绿,故在此主动失败。');
  process.exit(1);
}

// ================= Pass B:扫前端 sendRequest({...}) =================
// 取 object literal 顶层(depth 1)的 key → value 原文
function topLevelProps(objSrc) {
  const props = {};
  let i = 1, depth = 1;
  const n = objSrc.length - 1; // 不含末尾 }
  while (i < n) {
    const c = objSrc[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n) { if (objSrc[i] === '\\') { i += 2; continue; } if (objSrc[i] === q) break; i++; }
      i++; continue;
    }
    if ('{(['.indexOf(c) !== -1) { depth++; i++; continue; }
    if ('})]'.indexOf(c) !== -1) { depth--; i++; continue; }
    if (depth === 1 && c === ':') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(objSrc[j])) j--;
      const end = j + 1;
      while (j >= 0 && /[\w$'"]/.test(objSrc[j])) j--;
      const key = objSrc.slice(j + 1, end).replace(/['"]/g, '');
      let k = i + 1, vDepth = 0;
      while (k < n) {
        const cc = objSrc[k];
        if (cc === '"' || cc === "'" || cc === '`') {
          const q = cc; k++;
          while (k < n) { if (objSrc[k] === '\\') { k += 2; continue; } if (objSrc[k] === q) break; k++; }
          k++; continue;
        }
        if ('{(['.indexOf(cc) !== -1) vDepth++;
        else if ('})]'.indexOf(cc) !== -1) { if (vDepth === 0) break; vDepth--; }
        else if (cc === ',' && vDepth === 0) break;
        k++;
      }
      if (key) props[key] = objSrc.slice(i + 1, k).trim();
      i = k; continue;
    }
    i++;
  }
  return props;
}

// 动态段占位符(纯 ASCII;真实 URL 里不可能出现)
const HOLDER = '@@VAR@@';
function segsFromFlat(flat) {
  return flat.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').filter(x => x.length)
    .map(x => (x.indexOf(HOLDER) !== -1 ? null : x));
}
// 按顶层 + 切分(尊重字符串与括号);无顶层 + 返回 null
function splitTopLevelPlus(s) {
  const parts = [];
  let depth = 0, last = 0, i = 0, found = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) break; i++; }
      i++; continue;
    }
    if ('{(['.indexOf(c) !== -1) depth++;
    else if ('})]'.indexOf(c) !== -1) depth--;
    else if (c === '+' && depth === 0) { parts.push(s.slice(last, i)); last = i + 1; found = true; }
    i++;
  }
  if (!found) return null;
  parts.push(s.slice(last));
  return parts;
}
function asLiteral(s) {
  const t = s.trim();
  const m = t.match(/^'([^']*)'$/) || t.match(/^"([^"]*)"$/) || t.match(/^`([^`$]*)`$/);
  return m ? m[1] : null;
}

// url 原文 → { segs, dynamic, text };解析不出返回 null(不硬猜)
function parseUrl(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // 1) 纯字符串字面量
  const lit = asLiteral(s);
  if (lit !== null) return { segs: toSegments(lit), dynamic: false, text: lit };
  // 2) 模板字符串:${...} 段记为通配
  if (/^`[^`]*`$/.test(s)) {
    const inner = s.slice(1, -1);
    const flat = inner.replace(/\$\{[^{}]*\}/g, HOLDER);
    if (flat.indexOf('${') !== -1) return null; // 嵌套模板,放弃
    return { segs: segsFromFlat(flat), dynamic: true, text: inner };
  }
  // 3) 字符串拼接 '/a/' + x + '/b':字面量按原文,变量段记为通配
  const parts = splitTopLevelPlus(s);
  if (parts) {
    let flat = '';
    for (const p of parts) {
      const pl = asLiteral(p);
      if (pl !== null) flat += pl;
      else if (p.indexOf('`') !== -1) return null; // 拼接里混模板串,放弃
      else flat += HOLDER;
    }
    if (flat.charAt(0) !== '/') return null; // 前缀未知,不硬猜
    return { segs: segsFromFlat(flat), dynamic: true, text: flat.split(HOLDER).join('${..}') };
  }
  return null; // 变量 / 三元 → 不硬猜
}

// 段级精确匹配:段数必须相等,任一侧通配即放行(杜绝前缀误配)
function segMatch(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === null || b[i] === null) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const FRONT_DIRS = ['pages', 'components', 'utils', 'subpackageA', 'subpackageB', 'subpackageP3', 'custom-tab-bar']
  .map(d => path.join(ROOT, d));
const frontFiles = [];
FRONT_DIRS.forEach(d => walk(d, '.js', frontFiles));
if (fs.existsSync(path.join(ROOT, 'app.js'))) frontFiles.push(path.join(ROOT, 'app.js'));

const rel = fp => path.relative(ROOT, fp);
// 动态 URL 不能泛化为 @RequestBody:只收口 official-inbox 里这两个后端已确认的动作端点。
function isKnownOfficialInboxActionRequest(jsf, objSrc, src, callIdx) {
  if (rel(jsf) !== 'pages/activity/official-inbox/index.js' || !/(?:^|[,{\s])url\s*(?:,|})/.test(objSrc)) return false;
  const beforeCall = src.slice(0, callIdx);
  const declaration = beforeCall.lastIndexOf('const url =');
  if (declaration === -1) return false;
  const urlExpression = beforeCall.slice(declaration, beforeCall.indexOf(';', declaration));
  return urlExpression.indexOf('/api/official/v2/organizer-invites/') !== -1 &&
    urlExpression.indexOf('/api/official/v2/parties/') !== -1;
}
let callCount = 0;

for (const jsf of frontFiles) {
  const raw = fs.readFileSync(jsf, 'utf8');
  if (raw.indexOf('sendRequest') === -1) continue;
  const src = stripComments(raw);
  const callRe = /\bsendRequest\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const parenIdx = m.index + m[0].length - 1;
    let k = parenIdx + 1;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== '{') continue; // 变量传参 → 解析不了
    const objEnd = matchBracket(src, k);
    if (objEnd === -1) continue;
    callCount++;

    const objSrc = src.slice(k, objEnd + 1);
    const props = topLevelProps(objSrc);
    const line = src.slice(0, m.index).split('\n').length;
    const where = rel(jsf) + ':' + line;

    // method 缺省 = GET
    const mraw = (props.method || '').trim();
    let method = 'GET';
    if (mraw) {
      const ml = asLiteral(mraw);
      if (ml !== null) method = ml.toUpperCase();
      else {
        if (props.header === undefined) {
          warns.push('[动态method] ' + where + '  method=' + mraw.slice(0, 30) +
            ' 且未传 header → 若实际为 POST 且打 @RequestBody 端点会静默失败');
        }
        continue;
      }
    }
    if (method !== 'POST') continue;
    if (props.header !== undefined) continue; // 传了 header(大小写两种写法都算)→ 不报

    // official-inbox 的 url 是由已知两条 @RequestBody 端点拼出的局部变量，不能因解析器不追踪
    // 分支赋值就退化成 WARN；其他动态 URL 仍保持人工确认，避免扩大全仓假阳性。
    const knownDynamicBodyRequest = isKnownOfficialInboxActionRequest(jsf, objSrc, src, m.index);
    if (knownDynamicBodyRequest) {
      errors.push('[缺JSON头] ' + where + '  POST official-inbox 动态动作 URL → 已确认是 @RequestBody 端点;' +
        '不传 header = urlencoded,业务一行不执行(HTTP200 + code:500,零告警)');
      continue;
    }

    const u = parseUrl(props.url);
    if (!u) {
      const dynamicUrls = resolveDynamicUrls(rel(jsf), props.url, objSrc, src);
      if (dynamicUrls) {
        const decision = classifyEndpointCandidates(dynamicUrls, function (url) {
          const candidate = { segs: toSegments(url), text: url };
          const hitBody = bodyEndpoints.filter(e => segMatch(e.segs, candidate.segs));
          const hitOther = otherPostEndpoints.filter(e => segMatch(e.segs, candidate.segs));
          if (hitBody.length && !hitOther.length) return 'body';
          if (hitBody.length && hitOther.length) return 'ambiguous';
          if (!hitBody.length && !hitOther.length) return 'unknown';
          return 'nonbody';
        });
        if (decision.kind === 'body') {
          errors.push('[缺JSON头] ' + where + '  POST 动态候选 ' + decision.candidate +
            ' → 后端是 @RequestBody 端点;不传 header = urlencoded,业务一行不执行(HTTP200 + code:500,零告警)');
        } else if (decision.kind === 'ambiguous') {
          warns.push('[匹配歧义] ' + where + '  POST 动态候选 ' + decision.candidate +
            ' 同时匹配 @RequestBody 与非 @RequestBody 端点 → 人工确认');
        } else if (decision.kind === 'unknown') {
          warns.push('[无匹配端点] ' + where + '  POST 动态候选 ' + decision.candidate +
            ' → 后端未扫到同名 POST 端点,人工确认(可能是扫描器漏解析)');
        }
        continue;
      }
      warns.push('[动态url] ' + where + '  url=' + (props.url || '?').slice(0, 44) +
        ' 且未传 header → 静态匹配不出,人工确认后端是否 @RequestBody');
      continue;
    }
    const hitBody = bodyEndpoints.filter(e => segMatch(e.segs, u.segs));
    const hitOther = otherPostEndpoints.filter(e => segMatch(e.segs, u.segs));

    if (hitBody.length && !hitOther.length) {
      errors.push('[缺JSON头] ' + where + '  POST ' + u.text + ' → ' + hitBody[0].file +
        ' 是 @RequestBody 端点;不传 header = urlencoded,业务一行不执行(HTTP200 + code:500,零告警)');
    } else if (hitBody.length && hitOther.length) {
      warns.push('[匹配歧义] ' + where + '  POST ' + u.text + ' 同时匹配 @RequestBody 与非 @RequestBody 端点 → 人工确认(' +
        hitBody[0].url + ' / ' + hitOther[0].url + ')');
    } else if (!hitBody.length && !hitOther.length && u.text.indexOf('/api') === 0) {
      warns.push('[无匹配端点] ' + where + '  POST ' + u.text + ' → 后端未扫到同名 POST 端点,人工确认(可能是扫描器漏解析)');
    }
  }
}

// ================= 输出 =================
const uniq = a => [...new Set(a)].sort();
const E = uniq(errors), W = uniq(warns);
console.log('\n===== @RequestBody 契约扫描:后端 ' + bodyEndpoints.length + ' 个 @RequestBody POST 端点(另 ' +
  otherPostEndpoints.length + ' 个非 body POST)/ 前端 ' + callCount + ' 处 sendRequest =====');
if (E.length) { console.log('\n❌ ERROR (' + E.length + ') — 阻断发布:'); E.forEach(s => console.log('  ' + s)); }
if (W.length) { console.log('\n⚠️  WARN (' + W.length + ') — 需人工确认:'); W.forEach(s => console.log('  ' + s)); }
if (!E.length && !W.length) console.log('\n✅ 无问题。');
console.log('\n汇总: ' + E.length + ' error, ' + W.length + ' warn');
if (E.length || (WARN_AS_ERROR && W.length)) process.exit(1);
