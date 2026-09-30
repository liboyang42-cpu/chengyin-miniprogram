'use strict';

const fs = require('fs');
const path = require('path');

const LOCATION_APIS = [
  'chooseLocation',
  'choosePoi',
  'getFuzzyLocation',
  'getLocation',
  'onLocationChange',
  'startLocationUpdate',
  'startLocationUpdateBackground',
  'chooseAddress',
];

const OFFICIAL_PACKAGE_LIMIT_BYTES = 2 * 1024 * 1024;
const OFFICIAL_TOTAL_LIMIT_BYTES = 30 * 1024 * 1024;
const DEFAULT_INTERNAL_MAIN_LIMIT_BYTES = 1.8 * 1024 * 1024;

const SOURCE_DIRS = new Set([
  'components',
  'custom-tab-bar',
  'pages',
  'subpackageA',
  'subpackageB',
  'subpackageP3',
  'utils',
]);
const SKIP_DIRS = new Set(['.git', '.obsidian', '.serena', 'docs', 'miniprogram_npm', 'node_modules', 'scripts', 'tests']);

const JS_TOKEN_PATTERN = /(["'`])(?:\\[\s\S]|(?!\1)[\s\S])*\1|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;

/** 删除注释和字符串，避免示例文字伪造微信 API 调用。 */
function stripJavaScriptComments(source) {
  return String(source || '').replace(JS_TOKEN_PATTERN, '');
}

/** 删除注释但保留字符串，供 bracket API (`wx['getLocation']`) 扫描。 */
function stripJavaScriptCommentsPreserveStrings(source) {
  return String(source || '').replace(JS_TOKEN_PATTERN, (token) => token.startsWith('/') ? '' : token);
}

function collectWxAliases(source) {
  const aliases = new Set(['wx']);
  const aliasPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*wx\b|\b([A-Za-z_$][\w$]*)\s*=\s*wx\b|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:resolveWx|resolveWechatApi)\s*\(/g;
  let match;
  while ((match = aliasPattern.exec(source)) !== null) aliases.add(match[1] || match[2] || match[3]);
  return aliases;
}

function collectUsedLocationApis(sourceFiles) {
  const used = new Set();
  for (const file of sourceFiles) {
    const source = stripJavaScriptComments(file.content);
    const sourceWithStrings = stripJavaScriptCommentsPreserveStrings(file.content);
    const aliases = collectWxAliases(source);
    for (const alias of aliases) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dotCall = new RegExp(`\\b${escapedAlias}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
      const bracketCall = new RegExp(`\\b${escapedAlias}\\s*\\[\\s*(["'])([A-Za-z_$][\\w$]*)\\1\\s*\\]\\s*\\(`, 'g');
      let match;
      while ((match = dotCall.exec(source)) !== null) {
        if (LOCATION_APIS.includes(match[1])) used.add(match[1]);
      }
      while ((match = bracketCall.exec(sourceWithStrings)) !== null) {
        if (LOCATION_APIS.includes(match[2])) used.add(match[2]);
      }
    }
  }
  return LOCATION_APIS.filter((api) => used.has(api));
}

function stripWxmlComments(source) {
  return String(source || '').replace(/<!--[\s\S]*?-->/g, '');
}

function sourceText(files, extension, transform) {
  return files
    .filter((file) => new RegExp(`${extension}$`, 'i').test(file.path || ''))
    .map((file) => transform(file.content || ''))
    .join('\n');
}

function declaredPrivateInfos(app) {
  return Array.isArray(app && app.requiredPrivateInfos)
    ? app.requiredPrivateInfos.filter((api) => typeof api === 'string')
    : [];
}

function missingPrivateInfoDeclarations(usedApis, declaredApis) {
  const declaredSet = new Set(declaredApis);
  return usedApis.filter((api) => !declaredSet.has(api));
}

function consentProblems(usedApis, jsSource, wxmlSource) {
  if (!usedApis.length) return [];
  const checks = [
    [/\bwx\s*\.\s*(?:onNeedPrivacyAuthorization|getPrivacySetting)\s*\(/, jsSource,
      'onNeedPrivacyAuthorization or getPrivacySetting hook'],
    [/<button\b(?=[^>]*\bopen-type\s*=\s*["']agreePrivacyAuthorization["'])(?=[^>]*\bbindagreeprivacyauthorization\s*=\s*["'][^"']+["'])[^>]*>/,
      wxmlSource, 'agreePrivacyAuthorization button and callback binding'],
    [/\bwx\s*\.\s*openPrivacyContract\s*\(/, jsSource, 'openPrivacyContract call'],
  ];
  return checks.filter(([pattern, source]) => !pattern.test(source)).map(([, , message]) => message);
}

function permissionProblems(usedApis, app) {
  const permission = app && app.permission && app.permission['scope.userLocation'];
  const permissionDesc = permission && typeof permission.desc === 'string' ? permission.desc : '';
  if (!usedApis.length) return permissionDesc.length > 30 ? ['scope.userLocation desc exceeds 30 characters'] : [];
  return [
    !permissionDesc.trim() ? 'scope.userLocation desc is missing' : null,
    permissionDesc.length > 30 ? 'scope.userLocation desc exceeds 30 characters' : null,
  ].filter(Boolean);
}

function analyzePrivacyContract(app, sourceFiles) {
  const files = Array.isArray(sourceFiles) ? sourceFiles : [];
  const usedApis = collectUsedLocationApis(files);
  const declaredApis = declaredPrivateInfos(app);
  const missingDeclarations = missingPrivateInfoDeclarations(usedApis, declaredApis);
  const jsSource = sourceText(files, '\\.js', stripJavaScriptComments);
  const wxmlSource = sourceText(files, '\\.wxml', stripWxmlComments);
  const missingConsentPieces = consentProblems(usedApis, jsSource, wxmlSource);
  const permissionIssues = permissionProblems(usedApis, app);

  return {
    ok: missingDeclarations.length === 0 && missingConsentPieces.length === 0 && permissionIssues.length === 0,
    usedApis,
    declaredApis,
    missingDeclarations,
    missingConsentPieces,
    permissionProblems: permissionIssues,
    sourceCount: files.length,
  };
}

function parseBytes(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|KB|KIB|MB|MIB|GB|GIB)?\s*$/i.exec(value);
  if (!match) return null;
  const multipliers = { b: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3 };
  const multiplier = multipliers[(match[2] || 'b').toLowerCase()];
  return Number(match[1]) * multiplier;
}

function readObjectSize(entry) {
  const candidates = ['sizeBytes', 'size', 'packageSize', 'bytes', 'sizeInBytes', 'totalBytes'];
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
    const nested = readSize(entry[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function readSize(entry) {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === 'number' || typeof entry === 'string') return parseBytes(entry);
  if (typeof entry !== 'object') return null;
  return readObjectSize(entry);
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstArray(values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function firstPresent(values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function packageNameIsMain(entry) {
  return ['__APP__', 'main', 'mainPackage', '主包'].includes(entryName(entry));
}

function packageEntries(info) {
  if (!info || typeof info !== 'object') return { main: null, subPackages: [], total: null };
  const size = objectOrEmpty(info.size);
  const allPackages = firstArray([
    info.subPackages, info.subpackages, info.subPackageSizes, info.packages, info.subPackageInfo,
    size.packages, size.subPackages, size.subpackages,
  ]);
  const appEntry = allPackages.find(packageNameIsMain);
  const fullEntry = allPackages.find((entry) => entryName(entry) === '__FULL__');
  const main = firstPresent([
    info.mainPackage, info.main, info.mainPackageSize, info.main_package,
    size.mainPackage, size.main, size.mainPackageSize, size.main_package, appEntry,
  ]);
  const subPackages = allPackages.filter((entry) => !packageNameIsMain(entry) && entryName(entry) !== '__FULL__');
  const total = firstPresent([info.total, info.totalBytes, size.total, size.totalBytes, fullEntry]);
  return { main, subPackages, total };
}

function entryName(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return entry.root || entry.name || entry.packageName || entry.package || entry.path || '';
}

function packageEntryMatchesRoot(entry, root) {
  const name = String(entryName(entry)).replace(/^\/+|\/+$/g, '');
  const expectedNames = typeof root === 'string' ? [root] : [root && root.root, root && root.name];
  return expectedNames.filter(Boolean).some((expectedName) => {
    const expected = String(expectedName).replace(/^\/+|\/+$/g, '');
    return name === expected || name.endsWith(`/${expected}`);
  });
}

function verifyMainSize(main, internalMainLimitBytes) {
  const bytes = readSize(main);
  if (bytes === null) return { bytes, violations: ['main package size is missing or invalid'], warnings: [] };
  const violations = [];
  const warnings = [];
  if (bytes >= internalMainLimitBytes) warnings.push('main package reaches internal 1.8M target');
  if (bytes > OFFICIAL_PACKAGE_LIMIT_BYTES) violations.push('main package exceeds official 2M limit');
  return { bytes, violations, warnings };
}

function verifySubPackageSizes(roots, subPackages) {
  const packageSizes = [];
  const violations = [];
  for (const root of roots) {
    const rootPath = typeof root === 'string' ? root : root && (root.root || root.name);
    const entry = subPackages.find((candidate) => packageEntryMatchesRoot(candidate, root));
    const bytes = readSize(entry);
    packageSizes.push({ name: rootPath, bytes });
    if (bytes === null) violations.push(`${rootPath} size is missing or invalid`);
    else if (bytes > OFFICIAL_PACKAGE_LIMIT_BYTES) violations.push(`${rootPath} exceeds official 2M limit`);
  }
  return { packageSizes, violations };
}

function calculatedTotal(mainBytes, packageSizes) {
  if (mainBytes === null || packageSizes.some((item) => item.bytes === null)) return null;
  return mainBytes + packageSizes.reduce((sum, item) => sum + item.bytes, 0);
}

function totalViolations(totalBytes, reportedTotal, packageSizes) {
  const violations = [];
  if (totalBytes !== null && totalBytes > OFFICIAL_TOTAL_LIMIT_BYTES) violations.push('all packages exceed official 30M limit');
  const reportedTotalBytes = readSize(reportedTotal);
  if (reportedTotalBytes !== null && totalBytes !== null && reportedTotalBytes !== totalBytes) {
    violations.push('reported total package size does not match package entries');
  }
  return { reportedTotalBytes, violations };
}

function verifyPackageInfo(info, options = {}) {
  const roots = Array.isArray(options.packageRoots) ? options.packageRoots : [];
  const internalMainLimitBytes = options.internalMainLimitBytes || DEFAULT_INTERNAL_MAIN_LIMIT_BYTES;
  const { main, subPackages, total: reportedTotal } = packageEntries(info);
  const mainResult = verifyMainSize(main, internalMainLimitBytes);
  const subResult = verifySubPackageSizes(roots, subPackages);
  const totalBytes = calculatedTotal(mainResult.bytes, subResult.packageSizes);
  const totalResult = totalViolations(totalBytes, reportedTotal, subResult.packageSizes);
  const violations = [...mainResult.violations, ...subResult.violations, ...totalResult.violations];
  const warnings = [...mainResult.warnings];

  return {
    ok: violations.length === 0,
    mainBytes: mainResult.bytes,
    packageSizes: subResult.packageSizes,
    totalBytes,
    reportedTotalBytes: totalResult.reportedTotalBytes,
    violations,
    warnings,
    officialPackageLimitBytes: OFFICIAL_PACKAGE_LIMIT_BYTES,
    officialTotalLimitBytes: OFFICIAL_TOTAL_LIMIT_BYTES,
    internalMainLimitBytes,
  };
}

function walkSourceFiles(root, relative = '') {
  const absolute = path.join(root, relative);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (relative === '' && !SOURCE_DIRS.has(entry.name)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      result.push(...walkSourceFiles(root, rel));
      continue;
    }
    if (!/\.(js|wxml)$/i.test(entry.name)) continue;
    result.push({ path: rel, content: fs.readFileSync(path.join(root, rel), 'utf8') });
  }
  return result;
}

function loadApp(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return 'n/a';
  return `${(bytes / (1024 * 1024)).toFixed(2)}M`;
}

function formatByteCount(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  return String(Math.round(bytes)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function printPrivacyResult(result) {
  console.log(`[wechat-contract] privacy source scan: ${result.ok ? 'PASS' : 'FAIL'}`);
  console.log(`[wechat-contract] used location APIs: ${result.usedApis.join(', ') || '(none)'}`);
  for (const item of result.missingDeclarations) console.log(`  - missing requiredPrivateInfos: ${item}`);
  for (const item of result.missingConsentPieces) console.log(`  - missing consent piece: ${item}`);
  for (const item of result.permissionProblems) console.log(`  - permission problem: ${item}`);
}

function printPackageResult(result) {
  const status = result.ok ? (result.warnings.length ? 'WARN' : 'PASS') : 'FAIL';
  console.log(`[wechat-contract] package size: ${status}`);
  console.log(`[wechat-contract] main=${formatBytes(result.mainBytes)}, total=${formatBytes(result.totalBytes)}`);
  for (const item of result.packageSizes) console.log(`  - ${item.name}=${formatBytes(item.bytes)}`);
  for (const item of result.violations) console.log(`  - ${item}`);
  if (result.warnings.length) {
    const internalTarget = Math.ceil(result.internalMainLimitBytes);
    const officialMargin = result.officialPackageLimitBytes - result.mainBytes;
    console.log(`[wechat-contract] WARN ${result.warnings.join('; ')}: current=${formatByteCount(result.mainBytes)} bytes, internal target=${formatByteCount(internalTarget)} bytes, official margin=${formatByteCount(officialMargin)} bytes`);
  }
}

function readOption(args, names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1];
  }
  return null;
}

function printUsage() {
  console.error('用法: node scripts/wechat-release-contract.js --source-only');
  console.error('或:   node scripts/wechat-release-contract.js --info /path/to/preview-info.json');
}

function packageRootsFromApp(app) {
  const packages = app.subPackages || app.subpackages || [];
  return packages.map((item) => ({ root: item.root, name: item.name }));
}

function readAppSafely(root) {
  try {
    return { app: loadApp(root), error: null };
  } catch (error) {
    return { app: null, error };
  }
}

function readPackageResult(infoPath, app) {
  const info = JSON.parse(fs.readFileSync(path.resolve(infoPath), 'utf8'));
  return verifyPackageInfo(info, { packageRoots: packageRootsFromApp(app) });
}

function runPackageCheck(infoPath, app) {
  try {
    const result = readPackageResult(infoPath, app);
    printPackageResult(result);
    return { result, error: null };
  } catch (error) {
    return { result: null, error };
  }
}

function main(argv = process.argv.slice(2), projectRoot = path.resolve(__dirname, '..')) {
  const root = path.resolve(projectRoot);
  const infoPath = readOption(argv, ['--info', '-i']);
  if (!infoPath && !argv.includes('--source-only')) {
    printUsage();
    return 2;
  }

  const { app, error: appError } = readAppSafely(root);
  if (appError) {
    console.error(`[wechat-contract] cannot read app.json: ${appError.message}`);
    return 2;
  }

  const privacy = analyzePrivacyContract(app, walkSourceFiles(root));
  printPrivacyResult(privacy);
  if (!infoPath) {
    console.log('[wechat-contract] package size: WAIT-EXTERNAL (run CLI preview/upload with --info-output)');
    return privacy.ok ? 0 : 1;
  }

  const { result: packageResult, error: packageError } = runPackageCheck(infoPath, app);
  if (packageError) {
    console.error(`[wechat-contract] cannot read package info: ${packageError.message}`);
    return 2;
  }
  return privacy.ok && packageResult.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  LOCATION_APIS,
  OFFICIAL_PACKAGE_LIMIT_BYTES,
  OFFICIAL_TOTAL_LIMIT_BYTES,
  DEFAULT_INTERNAL_MAIN_LIMIT_BYTES,
  analyzePrivacyContract,
  collectUsedLocationApis,
  parseBytes,
  verifyPackageInfo,
  stripJavaScriptComments,
  stripJavaScriptCommentsPreserveStrings,
  collectWxAliases,
  stripWxmlComments,
  main,
};
