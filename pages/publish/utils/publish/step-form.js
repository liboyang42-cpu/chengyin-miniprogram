// ADA 处方 I:步进式表单的纯逻辑(每屏一问/一组)。
// 只管「哪个字段属于第几步」和「进度点怎么画」——不碰字段语义、不碰提交接口。
//
// steps 形如:[{ key:'basic', title:'基本信息', fields:['name','addressName'] }, ...]
// fields 里以 * 结尾的是前缀项(如 'ticket*' 命中 ticketName0 / ticketStock1),
// 因为票单是可增删的动态组,错误键带下标,不能逐个枚举。

function normalizeSteps(steps) {
  return Array.isArray(steps) ? steps : [];
}

function matchField(pattern, key) {
  if (typeof pattern !== 'string' || typeof key !== 'string') return false;
  if (pattern.charAt(pattern.length - 1) === '*') {
    const prefix = pattern.slice(0, -1);
    return prefix.length > 0 && key.indexOf(prefix) === 0;
  }
  return pattern === key;
}

// 返回字段所在步的下标;找不到返回 -1(调用方据此决定「留在原步」而不是跳到第 0 步)
function resolveStepOfField(steps, key) {
  const list = normalizeSteps(steps);
  for (let i = 0; i < list.length; i += 1) {
    const fields = (list[i] && list[i].fields) || [];
    for (let j = 0; j < fields.length; j += 1) {
      if (matchField(fields[j], key)) return i;
    }
  }
  return -1;
}

// 把步数收进合法区间:上一步/下一步点到头时停在端点,不产生越界的空白屏
function clampStep(steps, next) {
  const list = normalizeSteps(steps);
  if (!list.length) return 0;
  const num = Number(next);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(Math.floor(num), 0), list.length - 1);
}

// 进度点:大标题下一行,done/current/todo 三态
function buildProgress(steps, current) {
  const list = normalizeSteps(steps);
  const active = clampStep(list, current);
  return list.map((step, index) => ({
    key: step.key || String(index),
    title: step.title || '',
    index,
    state: index < active ? 'done' : (index === active ? 'current' : 'todo'),
  }));
}

module.exports = { resolveStepOfField, clampStep, buildProgress };
