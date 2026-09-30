// 发布前全页扫描:逐页 reLaunch app.json 里全部注册页,捕获 JS 异常 / console 错误 / 路径不符。
// 运行: node scripts/prerelease-sweep.js   (结果同时写 scripts/prerelease-sweep-result.json)
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const PAGES = [
  ...appJson.pages.map(p => '/' + p),
  ...(appJson.subPackages || appJson.subpackages || []).flatMap(s => s.pages.map(p => '/' + s.root + '/' + p)),
];

(async () => {
  const mp = await automator.launch({
    projectPath: ROOT,
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  });

  // 全局收集:console error/warn + 未捕获异常,按时间戳归属到当前页
  let current = '(boot)';
  const issues = [];
  mp.on('console', msg => {
    if (msg.type === 'error' || msg.type === 'warn') {
      const text = (msg.args || []).map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 500);
      issues.push({ page: current, kind: 'console.' + msg.type, text });
    }
  });
  mp.on('exception', err => {
    issues.push({ page: current, kind: 'exception', text: String(err && err.message ? err.message : err).slice(0, 500) });
  });

  const results = [];
  for (const p of PAGES) {
    current = p;
    const before = issues.length;
    let status = 'PASS', detail = '';
    try {
      const page = await mp.reLaunch(p);
      await page.waitFor(1500);
      const cur = '/' + (await page.path);
      if (cur !== p) { status = 'REDIRECT'; detail = '实际 ' + cur; }
    } catch (e) {
      status = 'FAIL';
      detail = String(e && e.message ? e.message : e).slice(0, 300);
    }
    const pageIssues = issues.slice(before).filter(i => i.page === p);
    const errN = pageIssues.filter(i => i.kind !== 'console.warn').length;
    const warnN = pageIssues.filter(i => i.kind === 'console.warn').length;
    results.push({ page: p, status, detail, errors: errN, warns: warnN });
    console.log(`${status.padEnd(8)} err=${errN} warn=${warnN} ${p} ${detail}`);
  }

  await mp.close();
  const summary = {
    total: PAGES.length,
    pass: results.filter(r => r.status === 'PASS').length,
    redirect: results.filter(r => r.status === 'REDIRECT').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    pagesWithErrors: results.filter(r => r.errors > 0).length,
    results,
    issues,
  };
  fs.writeFileSync(path.join(__dirname, 'prerelease-sweep-result.json'), JSON.stringify(summary, null, 2));
  console.log(`\n==== ${summary.pass}/${summary.total} PASS | ${summary.fail} FAIL | ${summary.redirect} REDIRECT | ${summary.pagesWithErrors} 页有报错 ====`);
  console.log('明细: scripts/prerelease-sweep-result.json');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e && e.message ? e.message : e); process.exit(1); });
