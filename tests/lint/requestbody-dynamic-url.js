/**
 * 只收口当前可从源码穷举的动态 URL；不认识的表达式必须继续交给主扫描器 WARN。
 *
 * 这里的候选路径并不是“白名单放过”：调用方仍会逐条和后端 POST 端点表比对。
 * 候选中的任一路径若改成 @RequestBody，门禁会转成 ERROR。
 */
function literal(value) {
  const text = (value || '').trim();
  const match = text.match(/^'([^']*)'$/) || text.match(/^"([^"]*)"$/);
  return match ? match[1] : null;
}

function staticTernaryUrls(raw) {
  const text = (raw || '').trim();
  let depth = 0;
  let question = -1;
  let colon = -1;
  let quote = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('([{'.indexOf(ch) !== -1) { depth++; continue; }
    if (')]}'.indexOf(ch) !== -1) { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === '?' && question === -1) { question = i; continue; }
    if (ch === ':' && question !== -1) { colon = i; break; }
  }

  if (question === -1 || colon === -1) return null;
  const yes = literal(text.slice(question + 1, colon));
  const no = literal(text.slice(colon + 1));
  if (yes === null || no === null) return null;
  return [yes, no];
}

const EXACT_DYNAMIC_URLS = {
  'pages/index/index.js': {
    url: ['/api/topic/list', '/api/activity/list'],
  },
  'pages/member/index/index.js': {
    'scan.url': [
      '/api/verify/groupcode/redeem',
      '/api/registration/scan_dynamic_code',
      '/api/coupon/verification',
      '/api/registration/scan_qr_code',
    ],
  },
  'pages/merchant/index/index.js': {
    'scan.url': [
      '/api/verify/groupcode/redeem',
      '/api/registration/scan_dynamic_code',
      '/api/coupon/verification',
      '/api/registration/scan_qr_code',
    ],
  },
  'subpackageA/pages/myproject/index.js': {
    url: [
      '/api/activity/update_publish_status',
      '/api/topic/update_user_status',
      '/api/activity/delete',
      '/api/topic/delete',
    ],
  },
  'subpackageP3/pages/badge-wall/index/index.js': {
    url: ['/api/medal/wall', '/api/badge/wall-v2'],
  },
  'subpackageP3/pages/growthcenter/index/index.js': {
    url: ['/api/growth/center', '/api/play/growth', '/api/play/my-completed'],
  },
};

function literalReqUrls(source) {
  const calls = [];
  const call = /\breq\s*\(\s*([^,\n)]+)/g;
  let match;
  while ((match = call.exec(source || '')) !== null) {
    const prefix = (source || '').slice(Math.max(0, match.index - 24), match.index);
    if (/function\s*$/.test(prefix)) continue;
    const url = literal(match[1]);
    if (!url || url.indexOf('/api/') !== 0) return null;
    calls.push(url);
  }
  return calls.length ? [...new Set(calls)] : null;
}

function resolveDynamicUrls(relativeFile, rawUrl, objectSource, fullSource) {
  const ternary = staticTernaryUrls(rawUrl);
  if (ternary) return ternary;

  if (relativeFile === 'pages/member/index/index.js' && (rawUrl || '').trim() === 'url') {
    return literalReqUrls(fullSource);
  }

  const byExpression = EXACT_DYNAMIC_URLS[relativeFile];
  if (!byExpression) return null;
  const expression = (rawUrl || '').trim();
  if (Object.prototype.hasOwnProperty.call(byExpression, expression)) return byExpression[expression].slice();

  // requestGrowthData({ url, ... }) uses object-property shorthand, which the
  // zero-dependency object parser intentionally does not treat as a value.
  if (!expression && /(?:^|[,{\s])url\s*(?:,|})/.test(objectSource || '')) {
    return byExpression.url ? byExpression.url.slice() : null;
  }
  return null;
}

function classifyEndpointCandidates(candidates, classify) {
  const results = candidates.map(function (candidate) {
    return { candidate, kind: classify(candidate) };
  });
  const body = results.find(function (item) { return item.kind === 'body'; });
  if (body) return body;
  const ambiguous = results.find(function (item) { return item.kind === 'ambiguous'; });
  if (ambiguous) return ambiguous;
  const unknown = results.find(function (item) { return item.kind === 'unknown'; });
  if (unknown) return unknown;
  return { kind: 'nonbody' };
}

module.exports = { staticTernaryUrls, literalReqUrls, resolveDynamicUrls, classifyEndpointCandidates };
