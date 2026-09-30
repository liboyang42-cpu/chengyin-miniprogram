#!/usr/bin/env node
'use strict';

/**
 * 微信 WXML 要求 wx:elif / wx:else 紧随同层 wx:if 或 wx:elif。
 * DevTools 对这一类错误只在编译时提示，因此在 CI 中提前阻断。
 */
const fs = require('fs');
const path = require('path');

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'image', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr'
]);

function lineNumber(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') line += 1;
  }
  return line;
}

function readTags(source) {
  const tags = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start === -1) break;
    if (source.startsWith('<!--', start)) {
      const endComment = source.indexOf('-->', start + 4);
      cursor = endComment === -1 ? source.length : endComment + 3;
      continue;
    }

    let quote = null;
    let end = start + 1;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote && source[end - 1] !== '\\') quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end >= source.length) break;

    const raw = source.slice(start, end + 1);
    const match = raw.match(/^<\s*(\/)?\s*([\w:-]+)/);
    if (match) {
      tags.push({
        raw,
        name: match[2].toLowerCase(),
        closing: Boolean(match[1]),
        selfClosing: /\/\s*>$/.test(raw),
        line: lineNumber(source, start)
      });
    }
    cursor = end + 1;
  }
  return tags;
}

function directiveOf(raw) {
  if (/(?:\s)wx:elif\s*=/.test(raw)) return 'wx:elif';
  if (/(?:\s)wx:else(?:\s|=|\/?>)/.test(raw)) return 'wx:else';
  if (/(?:\s)wx:if\s*=/.test(raw)) return 'wx:if';
  return null;
}

function findConditionalChainErrors(source) {
  const errors = [];
  const stack = [{ name: '__root__', previousChild: null }];

  readTags(source).forEach((tag) => {
    if (tag.closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === tag.name) {
          stack.length = index;
          break;
        }
      }
      return;
    }

    const parent = stack[stack.length - 1];
    const directive = directiveOf(tag.raw);
    if ((directive === 'wx:elif' || directive === 'wx:else')
      && (!parent.previousChild || !['wx:if', 'wx:elif'].includes(parent.previousChild.directive))) {
      errors.push({
        line: tag.line,
        directive,
        previousDirective: parent.previousChild && parent.previousChild.directive
      });
    }
    parent.previousChild = { directive, line: tag.line };

    if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
      stack.push({ name: tag.name, previousChild: null });
    }
  });

  return errors;
}

function walkWxmlFiles(directory) {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm') return;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkWxmlFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.wxml')) files.push(target);
  });
  return files;
}

function lintWxmlDirectory(directory) {
  return walkWxmlFiles(directory).flatMap((file) => findConditionalChainErrors(fs.readFileSync(file, 'utf8'))
    .map((error) => ({ ...error, file })));
}

function runSelfTest() {
  const invalid = findConditionalChainErrors('<view wx:elif="{{ready}}"></view>');
  const valid = findConditionalChainErrors([
    '<block wx:if="{{state === 1}}"></block>',
    '<block wx:elif="{{state === 2}}"></block>',
    '<block wx:else></block>'
  ].join('\n'));
  if (invalid.length !== 1 || valid.length !== 0) {
    console.error('WXML 条件链门禁:自证失败');
    process.exit(1);
  }
  console.log('WXML 条件链门禁:自证通过(能判红也能判绿)');
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
  } else {
    const errors = lintWxmlDirectory(path.resolve(__dirname, '..'));
    if (errors.length) {
      errors.forEach((error) => {
        const previous = error.previousDirective ? `，前一同层分支为 ${error.previousDirective}` : '';
        console.error(`${path.relative(process.cwd(), error.file)}:${error.line} ${error.directive} 前必须有同层 wx:if 或 wx:elif${previous}`);
      });
      process.exit(1);
    }
    console.log('WXML 条件链门禁:通过');
  }
}

module.exports = { findConditionalChainErrors, lintWxmlDirectory, readTags };
