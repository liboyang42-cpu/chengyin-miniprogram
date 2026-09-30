'use strict';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function parseObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) { return null; }
}

function extract(template) {
  const source = template || {};
  const items = [];
  const errors = [];
  if (Number(source.validationMethod) === 6) {
    const preference = parseObject(source.preferenceJson);
    const results = preference && preference.results;
    if (results && typeof results === 'object' && !Array.isArray(results)) {
      Object.keys(results).sort().forEach((code) => {
        const result = results[code] || {};
        items.push({ triggerType: 'PREFERENCE_RESULT', code, label: result.title || code, source: 'preference', sourceKey: code });
      });
    }
  }
  const advanced = parseObject(source.advancedConfigJson);
  const branch = advanced && advanced.branch;
  if (branch && branch.enabled && Array.isArray(branch.steps)) {
    branch.steps.filter((step) => step && step.terminal).forEach((step) => {
      items.push({
        triggerType: 'ADVANCED_RESULT',
        code: String(step.outcomeCode || ''),
        label: step.outcomeLabel || step.title || step.outcomeCode || '未命名结果',
        source: 'advanced',
        sourceKey: String(step.id || ''),
      });
    });
  }
  const dice = advanced && advanced.diceRoll;
  if (!items.length && dice && dice.enabled && dice.mode === 'd20') {
    items.push(
      { triggerType: 'ADVANCED_RESULT', code: 'D20_SUCCESS', label: '检定成功', source: 'advanced', sourceKey: 'D20_SUCCESS' },
      { triggerType: 'ADVANCED_RESULT', code: 'D20_FAILURE', label: '检定失败', source: 'advanced', sourceKey: 'D20_FAILURE' }
    );
  }
  if (!items.length) {
    items.push({ triggerType: 'CHOICE', code: 'COMPLETED', label: '完成节点', source: 'default', sourceKey: 'COMPLETED' });
  }

  const seen = new Set();
  items.forEach((item) => {
    if (!CODE_PATTERN.test(item.code)) {
      errors.push({ code: 'INVALID_CODE', message: 'outcomeCode 只能使用大写字母、数字和下划线', source: item.source, sourceKey: item.sourceKey });
    } else if (seen.has(item.code)) {
      errors.push({ code: 'DUPLICATE_CODE', message: 'outcomeCode 不能重复', source: item.source, sourceKey: item.sourceKey });
    }
    seen.add(item.code);
  });
  return {
    items: items.map(({ sourceKey, ...item }) => item),
    errors,
  };
}

module.exports = { CODE_PATTERN, extract };
