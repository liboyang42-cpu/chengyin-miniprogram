// 关卡编辑器(创建游戏)客户端联调自测 —— 不打后端,只验模块/校验/命名/计数器/导航
// 用法:cd chengyinhub-xcx && node scripts/level-editor-smoke.js
// 前置:微信开发者工具已打开 + 设置→安全→服务端口 已开启
const automator = require('miniprogram-automator');
const path = require('path');

const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT = path.resolve(__dirname, '..');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const mp = await automator.launch({ projectPath: PROJECT, cliPath: CLI });
  try {
    // ---- 新建态:带标题预填进入 ----
    const page = await mp.reLaunch('/pages/publish/temp/index?templateName=' + encodeURIComponent('测试关卡A'));
    await page.waitFor(1500);
    check('页面路径 = publish/temp/index', page.path === 'pages/publish/temp/index', page.path);

    let d = await page.data();
    check('标题预填', d.formData && d.formData.title === '测试关卡A', JSON.stringify(d.formData && d.formData.title));

    // F1 新建默认模块 = finish + reward
    const mk = (d.moduleList || []).map(m => m.key);
    check('新建默认模块=finish,reward', mk.length === 2 && mk.includes('finish') && mk.includes('reward'), mk.join(','));
    const ak = (d.availableModules || []).map(m => m.key).sort().join(',');
    check('可添加模块含 story/hint/voice', ['hint', 'story', 'voice'].every(k => ak.includes(k)), ak);

    // F1 模块增删
    await page.callMethod('addModule', { currentTarget: { dataset: { key: 'story' } } });
    await page.waitFor(300);
    d = await page.data();
    check('addModule(story) 生效', (d.moduleList || []).some(m => m.key === 'story'));
    check('addModule 后 story 移出可添加区', !(d.availableModules || []).some(m => m.key === 'story'));

    await page.callMethod('removeModule', { currentTarget: { dataset: { key: 'story' } } });
    await page.waitFor(300);
    d = await page.data();
    check('removeModule(story) 生效', !(d.moduleList || []).some(m => m.key === 'story'));
    check('removeModule 清空 storyText', !(d.formData && d.formData.storyText));

    // F4 校验:草稿只校验标题
    await page.callMethod('validateForm', {}, true);
    await page.waitFor(200);
    d = await page.data();
    check('草稿校验:有标题→通过(无 errors.title)', !(d.errors && d.errors.title), JSON.stringify(d.errors));

    // F4 校验:发布全量——空描述应报错
    const okPub = await page.callMethod('validateForm', {}, false);
    await page.waitFor(200);
    d = await page.data();
    check('发布校验:空描述→拦截', okPub === false && d.errors && !!d.errors.description, JSON.stringify(d.errors));

    // F4 校验:标题清空→草稿也拦
    await page.setData({ 'formData.title': '' });
    await page.waitFor(200);
    const okDraft2 = await page.callMethod('validateForm', {}, true);
    d = await page.data();
    check('草稿校验:空标题→拦截', okDraft2 === false && d.errors && !!d.errors.title, JSON.stringify(d.errors));

    // F4 命名:页面标题/CTA 文案(读渲染文本)
    try {
      const previewBtn = await page.$('.mainBtn2');
      const txt = previewBtn ? (await previewBtn.text()) : null;
      check('底部 CTA = 查看预览', !!txt && txt.indexOf('预览') >= 0, txt);
    } catch (e) { check('底部 CTA 文案', false, 'selector err: ' + e.message); }

    // 预览覆盖层:重置标题→开预览(无完成方式配置时应出软提示),先恢复标题
    await page.setData({ 'formData.title': '测试关卡A' });
    await page.callMethod('openPreview');
    await page.waitFor(400);
    d = await page.data();
    check('openPreview 打开覆盖层', d.previewVisible === true, 'previewVisible=' + d.previewVisible);

    // 截图
    const shot = '/Users/developer/Downloads/小程序截图/level-editor-smoke.png';
    try { await mp.screenshot({ path: shot }); check('截图已存', true, shot); }
    catch (e) { check('截图', false, e.message); }

    const passed = results.filter(r => r.ok).length;
    console.log(`\n==== ${passed}/${results.length} PASS ====`);
  } finally {
    await mp.close();
  }
})().catch(err => { console.error('SMOKE ERROR:', err); process.exit(1); });
