// 专业版发布编辑器 路线地图 Hero 自测 —— 验 buildRouteMap 产出 markers/polyline/include + 截图
// 用法:cd chengyinhub-xcx && node scripts/route-map-smoke.js
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
    const page = await mp.reLaunch('/pages/publish/fabu/index?templateName=' + encodeURIComponent('外滩夜行'));
    await page.waitFor(1800);
    check('页面路径 = publish/fabu/index', page.path === 'pages/publish/fabu/index', page.path);

    let d = await page.data();

    // 空态:清空所有节点 → hasRoute=false、无 marker/折线(走空态引导)
    const emptyChapters = JSON.parse(JSON.stringify(d.formData.chapters));
    emptyChapters.forEach(c => { c.nodes = []; });
    await page.setData({ 'formData.chapters': emptyChapters });
    await page.callMethod('buildRouteMap');
    await page.waitFor(300);
    d = await page.data();
    check('空态:hasRoute=false', d.hasRoute === false, 'hasRoute=' + d.hasRoute);
    check('空态:markers=0', (d.mapMarkers || []).length === 0, 'markers=' + (d.mapMarkers || []).length);
    check('空态:polyline=0', (d.mapPolyline || []).length === 0, 'polyline=' + (d.mapPolyline || []).length);

    // 单点态:1 个坐标节点 → 有 marker、无折线
    const oneChapter = JSON.parse(JSON.stringify(emptyChapters));
    oneChapter[0].nodes = [{ name: '街角', address: '钦州北路', longitude: '121.3849', latitude: '31.1672', nodeTime: 20 }];
    await page.setData({ 'formData.chapters': oneChapter });
    await page.callMethod('buildRouteMap');
    await page.waitFor(300);
    d = await page.data();
    check('单点:hasRoute=true', d.hasRoute === true, 'hasRoute=' + d.hasRoute);
    check('单点:markers=1', (d.mapMarkers || []).length === 1, 'markers=' + (d.mapMarkers || []).length);
    check('单点:polyline=0(不画线)', (d.mapPolyline || []).length === 0, 'polyline=' + (d.mapPolyline || []).length);

    // 多点态:往第 1 章注入 3 个坐标节点 → 应画 1 段折线
    const chapters = JSON.parse(JSON.stringify(emptyChapters));
    chapters[0].nodes = [
      { name: '外滩源', address: '中山东一路', longitude: '121.4906', latitude: '31.2453', nodeTime: 20 },
      { name: '和平饭店', address: '南京东路20号', longitude: '121.4900', latitude: '31.2405', nodeTime: 20 },
      { name: '外滩观景台', address: '中山东二路', longitude: '121.4912', latitude: '31.2360', nodeTime: 20 }
    ];
    await page.setData({ 'formData.chapters': chapters });
    await page.callMethod('buildRouteMap');
    await page.waitFor(500);
    d = await page.data();
    check('多点:markers=3', (d.mapMarkers || []).length === 3, 'markers=' + (d.mapMarkers || []).length);
    check('多点:polyline=1 段', (d.mapPolyline || []).length === 1, 'polyline=' + (d.mapPolyline || []).length);
    const pl = (d.mapPolyline || [])[0] || {};
    // 2026-08-01 玩家域去紫:原生 map 的 polyline/callout 是 JS 字面量,吃不到 CSS var,
    // 已在 pages/square/components/route-map/index.js 单独改成中性近黑。这条断言跟着改,
    // 否则它会一直按"折线必须是紫的"判红 —— 那正好和去紫方向反着来。
    check('折线色 = 中性近黑(#1A1A1A,已去紫)', (pl.color || '').toUpperCase().indexOf('#1A1A1A') === 0, 'color=' + pl.color);
    check('include-points=3(自动适配视野)', (d.mapInclude || []).length === 3, 'include=' + (d.mapInclude || []).length);
    check('marker 编号连续 1..3', (d.mapMarkers || []).map(m => m.label && m.label.content).join(',') === '1,2,3', (d.mapMarkers || []).map(m => m.label && m.label.content).join(','));

    // 两章分色:加第 2 章 → 应有 2 段折线、颜色不同
    chapters.push({ name: 'Chapter 2', description: '', imgArr: '', nodes: [
      { name: '武康大楼', address: '武康路1号', longitude: '121.4352', latitude: '31.2106', nodeTime: 20 },
      { name: '安福路', address: '安福路288号', longitude: '121.4256', latitude: '31.2127', nodeTime: 20 }
    ]});
    await page.setData({ 'formData.chapters': chapters });
    await page.callMethod('buildRouteMap');
    await page.waitFor(500);
    d = await page.data();
    check('两章:polyline=2 段', (d.mapPolyline || []).length === 2, 'polyline=' + (d.mapPolyline || []).length);
    const colors = (d.mapPolyline || []).map(p => (p.color || '').slice(0, 7));
    check('两章折线分色', colors.length === 2 && colors[0] !== colors[1], colors.join(' / '));
    check('全局编号跨章连续 1..5', (d.mapMarkers || []).map(m => m.label.content).join(',') === '1,2,3,4,5', (d.mapMarkers || []).map(m => m.label.content).join(','));

    // 截图(留证)
    const fs = require('fs');
    const dir = '/tmp/chengyin-shots';
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const shot = dir + '/route-map-hero.png';
    try { await mp.screenshot({ path: shot }); check('截图已存', true, shot); }
    catch (e) { check('截图', false, e.message); }

    // ===== 剧情内容 Tab:节点卡片(含游戏/模板)=====
    // 给第 1 章节点补 名称/时间/模板,验证卡片渲染 + 游戏磨砂条
    const DEMO_IMG = 'https://xianghuioss.oss-cn-shanghai.aliyuncs.com/chenyin/map.png';
    const storyChapters = JSON.parse(JSON.stringify(chapters));
    storyChapters[0].nodes[0].name = '外滩源';
    storyChapters[0].nodes[0].businessTime = '10:00-18:00';
    storyChapters[0].nodes[0].description = '从城市入口开始,寻找第一组现场线索。';
    storyChapters[0].nodes[0].imgUrl = DEMO_IMG;
    storyChapters[0].nodes[0].templateInfo = { title: '密室解谜·爵士谜案', imgUrl: DEMO_IMG, rating: '4.7' };
    storyChapters[0].nodes[0].templateId = 9;
    storyChapters[0].nodes[1].name = '和平饭店';
    storyChapters[0].nodes[1].businessTime = '11:00-22:00';
    await page.setData({ 'formData.chapters': storyChapters, activeTab: '1' });
    await page.callMethod('updateAllStatistics');
    await page.waitFor(600);
    d = await page.data();
    check('已切到剧情 Tab', d.activeTab === '1', 'activeTab=' + d.activeTab);
    // 卡片渲染检查(读 DOM)
    const cards = await page.$$('.david_tgb_box_li_con');
    check('剧情卡片渲染 ≥2', cards.length >= 2, 'cards=' + cards.length);
    const gameBars = await page.$$('.david_tgb_box_li_con_top_xf');
    check('有游戏的节点显示模板磨砂条', gameBars.length === 1, 'gameBars=' + gameBars.length);
    // 滚到带游戏的第 2 张卡片再截图
    try { await mp.pageScrollTo({ scrollTop: 560, duration: 200 }); await page.waitFor(600); } catch (e) { console.log('scroll err:', e.message); }
    const shot2 = dir + '/story-tab-cards.png';
    try { await mp.screenshot({ path: shot2 }); check('剧情卡片截图已存', true, shot2); }
    catch (e) { check('剧情卡片截图', false, e.message); }

    const passed = results.filter(r => r.ok).length;
    console.log(`\n==== ${passed}/${results.length} PASS ====`);
    if (passed !== results.length) process.exitCode = 2;
  } finally {
    await mp.close();
  }
})().catch(err => { console.error('SMOKE ERROR:', err); process.exit(1); });
