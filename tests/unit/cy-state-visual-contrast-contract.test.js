const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function declarations(source) {
  const values = {};
  for (const match of source.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) values[match[1]] = match[2].trim();
  return values;
}

function themeMaps(tokens) {
  const darkBlock = tokens.match(/^page\s*\{([\s\S]*?)^\}/m);
  const lightBlock = tokens.match(/^page\.theme-light,[\s\S]*?\{([\s\S]*?)^\}/m);
  assert.ok(darkBlock && lightBlock, '必须同时解析玩家暗色与商家浅色主题');
  const dark = declarations(darkBlock[1]);
  return {
    dark,
    light: Object.assign({}, dark, declarations(lightBlock[1])),
  };
}

function resolveValue(value, tokens, seen = new Set()) {
  const variable = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  if (!variable) return value.trim();
  assert.ok(!seen.has(variable[1]), `颜色 token 出现循环引用: ${variable[1]}`);
  assert.ok(tokens[variable[1]], `颜色 token 未定义: ${variable[1]}`);
  const nextSeen = new Set(seen);
  nextSeen.add(variable[1]);
  return resolveValue(tokens[variable[1]], tokens, nextSeen);
}

function parseColor(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
  assert.ok(rgba, `无法解析颜色: ${value}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] == null ? 1 : Number(rgba[4])];
}

function composite(foreground, backdrop) {
  const alpha = foreground[3];
  return [0, 1, 2].map((index) => foreground[index] * alpha + backdrop[index] * (1 - alpha));
}

function luminance(rgb) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(foreground, backdrop) {
  const values = [luminance(foreground), luminance(backdrop)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function selectorBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `找不到选择器 ${selector}`);
  return match[1];
}

function propertyValue(body, property) {
  const match = body.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([^;]+);`));
  assert.ok(match, `找不到 ${property} 声明`);
  return match[1].trim();
}

function effectiveColor(raw, tokens, backdrop) {
  return composite(parseColor(resolveValue(raw, tokens)), backdrop);
}

function assertStateContrast({ emptyWxss, errorWxss, tokens }) {
  const themes = themeMaps(tokens);
  const iconColor = propertyValue(selectorBody(emptyWxss, '.cy-empty-glyph'), 'color');
  const emptySubColor = propertyValue(selectorBody(emptyWxss, '.cy-empty-sub'), 'color');
  const errorSubColor = propertyValue(selectorBody(errorWxss, '.cy-error-sub'), 'color');
  const actionBody = selectorBody(errorWxss, '.cy-error-retry');
  const actionForeground = propertyValue(actionBody, 'color');
  const actionBackground = propertyValue(actionBody, 'background');

  Object.entries(themes).forEach(([themeName, theme]) => {
    ['--cy-color-bg-page', '--cy-color-bg-surface'].forEach((backgroundToken) => {
      const backdrop = composite(parseColor(resolveValue(theme[backgroundToken], theme)), [255, 255, 255, 1]);
      const iconRatio = contrast(effectiveColor(iconColor, theme, backdrop), backdrop);
      assert.ok(iconRatio >= 3, `${themeName} ${backgroundToken} 上的状态图标对比度 ${iconRatio.toFixed(2)}:1 应 ≥3:1`);

      [emptySubColor, errorSubColor].forEach((foreground) => {
        const bodyRatio = contrast(effectiveColor(foreground, theme, backdrop), backdrop);
        assert.ok(bodyRatio >= 4.5, `${themeName} ${backgroundToken} 上的状态正文对比度 ${bodyRatio.toFixed(2)}:1 应 ≥4.5:1`);
      });
    });

    const actionBackdrop = composite(parseColor(resolveValue(actionBackground, theme)), [255, 255, 255, 1]);
    const actionRatio = contrast(effectiveColor(actionForeground, theme, actionBackdrop), actionBackdrop);
    assert.ok(actionRatio >= 4.5, `${themeName} 错误态主动作文字对比度 ${actionRatio.toFixed(2)}:1 应 ≥4.5:1`);
  });
}

test('cy-empty / cy-error 在浅暗主题合成后的图标、正文与主动作对比度达标', () => {
  assertStateContrast({
    emptyWxss: read('components/cy/empty/index.wxss'),
    errorWxss: read('components/cy/error/index.wxss'),
    tokens: read('style/tokens.wxss'),
  });
});

test('负控:状态图标改成半透明灰后必须命中合成对比度闸', () => {
  const emptyWxss = read('components/cy/empty/index.wxss');
  const mutated = emptyWxss.replace(
    'color: var(--cy-text-secondary);',
    'color: rgba(120,120,120,.35);',
  );
  assert.notEqual(mutated, emptyWxss, '负控锚点失效：找不到状态图标颜色');
  assert.throws(() => assertStateContrast({
    emptyWxss: mutated,
    errorWxss: read('components/cy/error/index.wxss'),
    tokens: read('style/tokens.wxss'),
  }), /状态图标对比度/);
});
