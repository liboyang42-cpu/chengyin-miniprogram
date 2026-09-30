#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const XCX_ROOT = path.resolve(__dirname, '..');
const META_ROOT_TAGS = new Set(['wxs', 'page-meta', 'import']);
const VOID_TAGS = new Set(['image', 'input', 'include']);

// 页面域划分的单一真源：未命中规则的新页面默认属于玩家域。
// 共享页必须在根节点显式声明 dark / merchant 两套主题，由页面状态选择，禁止靠 app 继承。
const DOMAIN_RULES = [
  {
    domain: 'shared',
    // 2026-08-09:模板详情与我的模板同属发布/模板链,商家与玩家共用同一份页面
    //(商家从工作台点进来必须是浅色,玩家仍是暗色),归共享域。
    // 2026-08-25:我的收藏(mylike)与资料页(infomation)同理 —— 两页 JS 都按
    // policy.isMerchantView 分身份渲染,商家从工作台进来是浅色,玩家仍是暗色。
    // 2026-09-08:剧情与玩法(club/topic-story)进共享域 —— 稿 448:925 / 448:1076 是
    // 这一页的**商家浅色版**(J1-A/J1-B「· 商家浅」)。同一份内容,俱乐部/玩家看是纯黑,
    // 商家承接方看是浅色;页面用 policy.isMerchantView 分档,与上面几页同一种做法。
    // 2026-09-16:提现记录(subpackageMember/tixianjilu)进共享域 —— 商家侧深链壳
    // pages/coop/withdraw/records 带 theme=merchant redirect 进来必须保持商家白底
    // (SMOKE/095 实拍落到黑底),玩家从收益页进来仍是暗色;页面按 options.theme 分档。
    route: /^(?:pages\/(?:template|templatedetail|talent|shezhi|mylike)\/|pages\/club\/topic-story\/|pages\/activity\/(?:detail|official-(?:inbox|mine))\/|subpackageMember\/(?:mytemplate|tixianjilu)\/|subpackageA\/pages\/infomation\/)/
  },
  {
    domain: 'merchant',
    route: /^(?:pages\/(?:merchant\/(?!discover\/)|coop\/|publish\/|activity\/official-detail\/|topic\/(?:merchantinfo|merchantapply|pricing)\/)|subpackageA\/pages\/myproject\/|subpackageMember\/(?:coupon\/|couponInfo\/))/
  }
];

// 用户自维护的漫游 / 游玩设计域：主题由各域自身的 intro / 运行态方案管理。
// owner 固定为用户；两道门禁共同消费这一份记录，不在各自扫描器里复制排除清单。
// 2026-08-10:原第三项 subpackageRoam/passport/ 随整页删除一并退出 —— 护照内容已并进
// 漫游页自己的「漫游护照」tab,归 pages/roam/ 那条排除项管。
const EXCLUDED_DESIGN_DOMAINS = [
  {
    pathPrefix: 'pages/play/',
    reason: '用户自维护的游玩设计域，主题由该域自身的 intro / 运行态方案管理',
    owner: '用户'
  },
  {
    pathPrefix: 'pages/roam/',
    reason: '用户自维护的漫游设计域，主题由该域自身的 intro / 运行态方案管理',
    owner: '用户'
  }
];
const EXCLUSION_PATH_CONTRACT = /^pages\/(?:play|roam)\/$/;
const THEMELESS_REDIRECT_SHELLS = new Set(['pages/publish/topicadd/topicadd']);

const UNIT_WORDS = [
  '公里', '千米', '小时', '分钟', '米', '家', '%', '次', '张', '人', '元',
  '个', '份', '天', '秒', '枚', '条', '项', '座', '笔', '单', '点', '级',
  '折', '章', '场', '户', '位', '名', '年', '月', '日'
];
const UNIT_PATTERN = new RegExp(`{{([^{}]*?)}}\\s*(${UNIT_WORDS.join('|')})`, 'g');

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function maskComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function maskNonMarkup(source) {
  return maskComments(source).replace(/<wxs\b[\s\S]*?<\/wxs>/g,
    (wxs) => wxs.replace(/[^\n]/g, ' '));
}

function readTags(source) {
  const tags = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start === -1) break;

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
        selfClosing: /\/\s*>$/.test(raw) || VOID_TAGS.has(match[2].toLowerCase()),
        offset: start
      });
    }
    cursor = end + 1;
  }
  return tags;
}

function topLevelThemeClasses(source) {
  const classes = new Set();
  let depth = 0;
  readTags(maskNonMarkup(source)).forEach((tag) => {
    if (tag.closing) {
      depth = Math.max(0, depth - 1);
      return;
    }

    if (depth === 0 && !META_ROOT_TAGS.has(tag.name)) {
      const classMatch = tag.raw.match(/\bclass\s*=\s*"([^"]*)"/)
        || tag.raw.match(/\bclass\s*=\s*'([^']*)'/);
      if (classMatch) {
        [...classMatch[1].matchAll(/\btheme-[\w-]+\b/g)].forEach((match) => classes.add(match[0]));
      }
    }
    if (!tag.selfClosing) depth += 1;
  });
  return classes;
}

function hasPageEntityMarkup(source) {
  return readTags(maskNonMarkup(source)).some((tag) => (
    !tag.closing && !META_ROOT_TAGS.has(tag.name)
  ));
}

function classifyPageDomain(route) {
  const matched = DOMAIN_RULES.find((rule) => rule.route.test(route));
  return matched ? matched.domain : 'player';
}

function isExcludedDesignPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return EXCLUDED_DESIGN_DOMAINS.some(({ pathPrefix }) => normalized.startsWith(pathPrefix));
}

function assertExclusionContract() {
  const paths = EXCLUDED_DESIGN_DOMAINS.map(({ pathPrefix }) => pathPrefix);
  const validRecords = EXCLUDED_DESIGN_DOMAINS.every(({ pathPrefix, reason, owner }) => (
    EXCLUSION_PATH_CONTRACT.test(pathPrefix) && reason && owner === '用户'
  ));
  if (paths.length !== 2 || new Set(paths).size !== 2 || !validRecords) {
    throw new Error('设计域排除项只能是 pages/play/、pages/roam/，且必须记录原因与负责人');
  }
}

function pageRoutes(appJson) {
  const subPackages = appJson.subPackages || appJson.subpackages || [];
  return [
    ...(appJson.pages || []),
    ...subPackages.flatMap((subPackage) => (subPackage.pages || [])
      .map((page) => `${subPackage.root}/${page}`))
  ];
}

function findThemeErrors(root = XCX_ROOT) {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const routes = pageRoutes(appJson);
  if (THEMELESS_REDIRECT_SHELLS.size !== 1
    || !THEMELESS_REDIRECT_SHELLS.has('pages/publish/topicadd/topicadd')
    || !routes.includes('pages/publish/topicadd/topicadd')) {
    throw new Error('无主题重定向壳必须保持唯一，且只能是已注册的 topicadd 兼容页');
  }
  return routes.filter((route) => !isExcludedDesignPath(`${route}/`)).flatMap((route) => {
    const file = path.join(root, `${route}.wxml`);
    const source = fs.readFileSync(file, 'utf8');
    const domain = classifyPageDomain(route);
    if (THEMELESS_REDIRECT_SHELLS.has(route)) {
      return hasPageEntityMarkup(source)
        ? [{ file, route, domain, message: '重定向壳不得渲染实体节点或伪造主题根' }]
        : [];
    }
    const themes = topLevelThemeClasses(source);
    const errors = [];

    if (themes.size === 0) errors.push('页面顶层节点未声明 theme-*');
    if (themes.has('theme-light')) errors.push('禁止使用 theme-light');
    if (domain === 'player') {
      if (!themes.has('theme-dark')) errors.push('玩家页必须声明 theme-dark');
      if (themes.has('theme-merchant') || themes.has('theme-topic-editor')) {
        errors.push('玩家页禁止声明商家主题');
      }
    } else if (domain === 'merchant') {
      if (!themes.has('theme-merchant') && !themes.has('theme-topic-editor')) {
        errors.push('商家页必须声明 theme-merchant 或 theme-topic-editor');
      }
      if (themes.has('theme-dark')) errors.push('商家页禁止声明 theme-dark');
    } else {
      if (!themes.has('theme-dark') || !themes.has('theme-merchant')) {
        errors.push('共享页必须显式声明 theme-dark 与 theme-merchant');
      }
    }

    return errors.map((message) => ({ file, route, domain, message }));
  });
}

function walkWxmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'miniprogram_npm', '.mcp-artifacts'].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkWxmlFiles(target);
    return entry.isFile() && entry.name.endsWith('.wxml') ? [target] : [];
  });
}

function findUnitErrors(root = XCX_ROOT) {
  return walkWxmlFiles(root).filter((file) => (
    !isExcludedDesignPath(path.relative(root, file))
  )).flatMap((file) => {
    const source = maskComments(fs.readFileSync(file, 'utf8'));
    const errors = [];
    UNIT_PATTERN.lastIndex = 0;
    let match;
    while ((match = UNIT_PATTERN.exec(source))) {
      if (!match[1].includes('||')) {
        errors.push({
          file,
          line: lineNumber(source, match.index),
          expression: match[1].trim(),
          unit: match[2]
        });
      }
    }
    return errors;
  });
}

function runSelfTest() {
  assertExclusionContract();
  const wrongTheme = topLevelThemeClasses('<view class="theme-merchant"></view>');
  const rightTheme = topLevelThemeClasses('<view class="theme-dark"></view>');
  const badUnit = '<text>{{count}} 人</text>';
  const goodUnit = '<text>{{count || 0}} 人</text>';
  UNIT_PATTERN.lastIndex = 0;
  const badMatch = UNIT_PATTERN.exec(badUnit);
  UNIT_PATTERN.lastIndex = 0;
  const goodMatch = UNIT_PATTERN.exec(goodUnit);
  if (!wrongTheme.has('theme-merchant') || !rightTheme.has('theme-dark')
    // 2026-09-02 rebase 并集:两侧改的是**不同的域**,各取各的。
    //   · game-director:本 PR 拆掉了把 club 整域特判成浅色的 carve-out
    //     (读我板尾点名的「代码待改」),它因此落到默认的 player 暗域 —— 这是本 PR 的目的。
    //   · official-detail:master 侧已把它并进 merchant 域的 route 正则,
    //     本 PR 那侧写的 'shared' 是它旧基线上的值,不是它的改动意图。
    || classifyPageDomain('pages/club/game-director/index') !== 'player'
    || classifyPageDomain('pages/activity/official-detail/index') !== 'merchant'
    || hasPageEntityMarkup('<!-- redirect shell -->')
    || !hasPageEntityMarkup('<view class="theme-merchant"></view>')
    || !badMatch || badMatch[1].includes('||') || !goodMatch || !goodMatch[1].includes('||')) {
    console.error('主题与孤立单位门禁:自证失败');
    process.exit(1);
  }
  console.log('主题与孤立单位门禁:自证通过(能判红也能判绿，排除项锁死为 3 个设计域 + 1 个无实体重定向壳)');
}

function printThemeErrors(errors) {
  errors.forEach((error) => {
    console.error(`${path.relative(process.cwd(), error.file)} [${error.domain}] ${error.message}`);
  });
}

function printUnitErrors(errors) {
  errors.forEach((error) => {
    console.error(`${path.relative(process.cwd(), error.file)}:${error.line} {{${error.expression}}} 后紧跟单位 ${error.unit}，必须用 || 提供兜底`);
  });
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
  } else if (process.argv.includes('--theme')) {
    const errors = findThemeErrors();
    if (errors.length) {
      printThemeErrors(errors);
      process.exit(1);
    }
    console.log('页面根主题门禁:通过');
  } else if (process.argv.includes('--units')) {
    const errors = findUnitErrors();
    if (errors.length) {
      printUnitErrors(errors);
      process.exit(1);
    }
    console.log('WXML 孤立单位门禁:通过');
  } else {
    console.error('用法:ui-theme-unit-lint.js --selftest|--theme|--units');
    process.exit(2);
  }
}

module.exports = {
  EXCLUDED_DESIGN_DOMAINS,
  THEMELESS_REDIRECT_SHELLS,
  assertExclusionContract,
  classifyPageDomain,
  findThemeErrors,
  findUnitErrors,
  hasPageEntityMarkup,
  pageRoutes,
  topLevelThemeClasses
};
