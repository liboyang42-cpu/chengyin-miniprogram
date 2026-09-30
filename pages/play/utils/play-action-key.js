'use strict';

// 幂等键必须由「这一次动作意图」派生，不能带时间或随机数。
// 带 Date.now()/Math.random() 的键每次调用都不一样 ⇒ 服务端
// selectByIdempotencyKey 永远命中不了 ⇒ 用户重试 = 重复写入，
// 后端那套 replay 形同虚设（服务端上限 64 位）。
// version 是服务端权威值、写成功后才 +1，所以「同 version 的同一动作」
// 天然就是同一次尝试：重试复用键被 replay，新动作换 version 自动换键。

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); })
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

// FNV-1a 32 位：小程序里没有 crypto，这里只需要稳定摘要，不需要抗碰撞。
function digest(text) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return ('0000000' + hash.toString(16)).slice(-8);
}

function buildActionKey(sessionId, version, action, payload) {
  var session = String(sessionId || '');
  var normalizedAction = String(action || '').trim().toUpperCase();
  if (!session || session === '0' || !normalizedAction) return '';
  if (version === null || version === undefined || version === '') return '';
  var normalizedVersion = Number(version);
  if (!isFinite(normalizedVersion)) return '';
  var key = 'adv-' + session + '-v' + normalizedVersion + '-'
    + digest(normalizedAction + '|' + canonical(payload === undefined ? {} : payload));
  // session/version 再长也得压回 64 位：摘要在尾部，截断会毁掉唯一性，
  // 所以超长时改成整串摘要，仍然是纯函数、仍然可重放。
  return key.length <= 64 ? key : 'adv-' + digest(key);
}

function buildUnitId(sessionId, version) {
  return 'unit-' + String(sessionId || '') + '-v' + Number(version || 0);
}

module.exports = { buildActionKey: buildActionKey, buildUnitId: buildUnitId };
