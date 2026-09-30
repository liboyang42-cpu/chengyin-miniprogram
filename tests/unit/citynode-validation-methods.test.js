process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeVm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');
// 注释里写「以到店定位为准」是在讲历史,不算数;只看真代码。
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function mountPoiScene(node, overrides) {
  const requests = [];
  const app = {
    sendRequest(options) { requests.push(options); },
  };
  const wx = {
    getLocation(options) { options.success({ latitude: 31.2, longitude: 121.5 }); },
    showToast() {},
  };
  Object.assign(app, overrides && overrides.app);
  Object.assign(wx, overrides && overrides.wx);

  let definition;
  nodeVm.runInNewContext(read('components/cy/scene-roam-poi-detail/index.js'), {
    Component(options) { definition = options; },
    getApp() { return app; },
    require(request) {
      if (request === '../../../utils/response-shape.js') return require('../../utils/response-shape.js');
      if (request === '../../../utils/validation-method-labels.js') return require('../../utils/validation-method-labels.js');
      throw new Error(`unexpected require: ${request}`);
    },
    wx,
  });

  const instance = {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), { poiId: 'poi-1', node: { status: 1, ...node }, completing: false }),
    setData(patch) {
      Object.keys(patch).forEach((key) => {
        if (key.startsWith('node.')) this.data.node[key.slice(5)] = patch[key];
        else this.data[key] = patch[key];
      });
    },
    triggerEvent() {},
  };
  Object.keys(definition.methods).forEach((name) => {
    instance[name] = definition.methods[name].bind(instance);
  });
  return { instance, requests, detach: () => definition.lifetimes.detached.call(instance) };
}

test('商家连续重试只接受最后请求，旧成功或失败不能覆盖恢复结果', () => {
  for (const callback of ['success', 'fail', 'successStatusAbnormal']) {
    const h = mountPoiScene({ merchantId: 77, needRedeem: true, couponId: 88 });
    h.instance._loadToken = 1;
    h.instance.retryMerchant();
    h.instance.retryMerchant();
    h.requests[1].success({ code: 200, data: { id: 77, name: '较新响应' } });
    h.requests[0][callback]({ code: 200, data: { id: 77, name: '迟到旧响应' } });
    assert.equal(h.instance.data.merchant.name, '较新响应');
    assert.equal(h.instance.data.merchantError, '');
    assert.equal(h.instance.data.node.couponId, 88);
    assert.equal(h.instance.data.state, 'ready');
  }
});

test('下线历史不能新打卡，但本人待核销记录仍可出码履约', () => {
  const history = mountPoiScene({ status: 0, validationMethod: 5 });
  history.instance.startInteract();
  assert.equal(history.requests.length, 0);
  assert.equal(history.instance.data.interactionState, 'unavailable');
  const pending = mountPoiScene({ status: 0, validationMethod: 5, needRedeem: true });
  const events = [];
  pending.instance.triggerEvent = (name, detail) => events.push({ name, detail });
  pending.instance.startInteract();
  assert.equal(pending.requests.length, 0);
  assert.equal(events[0].detail.id, 'qr-citynode');
  assert.equal(events[0].detail.params.poiId, 'poi-1');
});

/**
 * 据点五种验证方式:商家选了什么,玩家就该走什么。
 *
 * 2026-08-06 之前的实况:五种里只有 vm=1 文字作答能跑通,另外三种**静默降级**——
 *   vm=3 选项问答:商家表单没有选项输入框 ⇒ 永远提交不出 correctAnswer ⇒ 后端拿 null 比 ⇒ 玩家怎么答都错
 *   vm=2 拍照打卡:后端要 photoUrl,玩家端只发 {lat,lng,answer} ⇒ 在 app 里根本完不成
 *   vm=4 到店扫码:后端压根没有这个分支 ⇒ 落到 GPS 判定
 * 三种都不报错。商家选了以为生效了。**静默降级比报错更坏**,所以这里逐条钉死。
 */

test('vm=3:商家表单必须能填选项并标出正确项,否则提交不出 correctAnswer', () => {
  // 2026-08-10:据点玩法配置改用游戏模板配置页(pages/publish/temp),
  // 所以这条契约跟着搬到那一页 —— 保护的性质不变。
  const wxml = strip(read('pages/publish/temp/index.wxml'));
  assert.match(wxml, /wx:for="\{\{ optionItems \}\}"/, '选项要能逐条填');
  assert.match(wxml, /bindtap="pickCorrectOption"/, '要有地方标出哪个是正确答案');

  const js = strip(read('pages/publish/temp/index.js'));
  assert.match(js, /formData\.correctAnswer = correct \? correct\.letter : 'A'/, 'vm=3 必须提交 correctAnswer —— 不提交则后端拿 null 比,玩家永远答不对');
  assert.match(js, /formData\[`question\$\{item\.letter\}`\] = item\.text/, '选项原文也要提交,否则玩家看不到选什么');

  // ★ 并且这份 formData 必须真的送到据点端点去(据点端点才有 validationMethodError 那道闸)
  assert.match(js, /from === 'citynode'[\s\S]{0,400}city-node\/template\/submit/);
});

// 2026-08-11:据点任务卡的唯一真源搬到 components/cy/scene-roam-poi-detail
// (深链宿主 /subpackageRoam/poi-detail/index 与漫游页内弹层共用同一份)。
// 玩家侧那三条静态断言跟着搬,保护的性质不变:商家选了哪种验证方式,玩家端就得真走哪条。
test('vm=3:玩家侧要拿到选项才能选,但答案绝不能下发', () => {
  // 2026-08-11 旧「承接商家」页收成兼容壳:据点玩法的唯一玩家侧实现是场景组件,
  // 原本钉在旧页那半边跟着搬 —— 保护的性质不变(选项要下发、答案不许下发)。
  const scene = strip(read('components/cy/scene-roam-poi-detail/index.js'));
  assert.match(scene, /questionA/, '玩家端要读服务端下发的选项');
  assert.match(scene, /choiceSheetItems/, '选项问答要给选项列表,不能让玩家盲猜着打字');

  assert.equal(/correctAnswer/i.test(scene), false, '玩家场景组件不得读取或展示正确答案');

  // 玩家侧投影里出现 correctAnswer 就等于下发答案
  const vo = strip(read('../chengyinhub-system/src/main/java/com/chengyinhub/business/domain/vo/CityNodeVO.java'));
  assert.equal(/correctAnswer/i.test(vo), false, 'CityNodeVO 是玩家侧投影,带上答案就是泄题');
  const mapper = strip(read('../chengyinhub-system/src/main/resources/mapper/business/RoamMapper.xml'));
  assert.equal(/correct_answer/.test(mapper), false, '玩家侧查询选出 correct_answer 就是泄题');
});

/* 2026-09-02:选项问答不再走 wx.showActionSheet(系统弹层已收编到 cy-option-sheet)。
   断言形状随之改成「打开弹层 → 选第 2 项」,要验的三件事一件没少:
   选项来自服务端字段、正确答案不下发、tapIndex/index 必须映射成 A-D 字母。 */
test('vm=3:场景组件展示服务端选项并提交所选字母,不读取正确答案', () => {
  const harness = mountPoiScene({
    validationMethod: 3,
    questionA: '甲', questionB: '乙', questionC: '丙', questionD: '丁',
    correctAnswer: '绝不能展示',
  });

  harness.instance.startInteract();

  // ⚠️ Array.from:组件跑在 node:vm 沙箱里,它造的数组原型不是本 realm 的,
  //    直接 deepStrictEqual 会因为原型不同而误红(原用例也是这么绕的)。
  const itemList = Array.from(harness.instance.data.choiceSheetItems);
  assert.equal(harness.instance.data.choiceSheetShow, true, 'vm=3 必须打开选项弹层');
  assert.deepEqual(itemList, ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'], 'vm=3 必须把玩家可见选项交给弹层');
  assert.equal(itemList.includes('绝不能展示'), false, '正确答案不能出现在玩家选项里');

  harness.instance.onChoiceSheetSelect({ detail: { index: 1 } });
  assert.equal(harness.requests.length, 1, '选择一项后必须提交一次完成请求');
  assert.equal(harness.requests[0].url, '/api/city/nodes/poi-1/complete');
  assert.equal(harness.requests[0].data.answer, 'B', '选中项必须映射为对应的 A-D 字母');
});

test('vm=2:玩家端必须真的上传照片并把 photoUrl 放进请求体', () => {
  const js = strip(read('components/cy/scene-roam-poi-detail/index.js'));
  assert.match(js, /chooseImage/, '拍照打卡要能选/拍照片');
  // ⚠️ 不能只断言出现过 photoUrl —— 光是函数形参 `doComplete(answer, photoUrl, code)`
  // 就能让 /photoUrl/ 恒真,那是假绿(已实测:删掉请求体里那一项,断言照样绿)。
  // 要钉的是「它进了发给后端的 data」。
  assert.match(js, /photoUrl:\s*photoUrl/, 'photoUrl 必须进请求体,否则后端判「请上传拍照打卡照片」,永远完不成');

});

test('vm=2:场景组件上传照片并把返回 URL 送进完成请求', () => {
  const harness = mountPoiScene({ validationMethod: 2 }, {
    app: {
      chooseImage(callback, count) {
        assert.equal(count, 1, '拍照打卡只取一张照片');
        callback(['https://img.example/uploaded.jpg']);
      },
    },
  });

  harness.instance.startInteract();

  assert.equal(harness.requests.length, 1, '照片上传成功后必须提交一次完成请求');
  assert.equal(harness.requests[0].url, '/api/city/nodes/poi-1/complete');
  assert.equal(harness.requests[0].data.photoUrl, 'https://img.example/uploaded.jpg', '上传结果必须进入 photoUrl 请求字段');
});

test('vm=4:玩家端要扫码,且把码发给后端', () => {
  const js = strip(read('components/cy/scene-roam-poi-detail/index.js'));
  assert.match(js, /scanCode/, '到店扫码要真的调起扫码');
  assert.match(js, /code:\s*code/, '扫到的码必须发给后端,否则跟 GPS 判定没区别');

});

test('vm=4:场景组件只扫相机二维码并把结果送进完成请求', () => {
  let scanOptions;
  const harness = mountPoiScene({ validationMethod: 4 }, {
    wx: {
      scanCode(options) {
        scanOptions = options;
        options.success({ result: 'shop-poster-code' });
      },
    },
  });

  harness.instance.startInteract();

  assert.equal(scanOptions.onlyFromCamera, true, '到店码必须从相机现场扫描');
  assert.deepEqual(Array.from(scanOptions.scanType), ['qrCode'], '到店码只接受二维码');
  assert.equal(harness.requests.length, 1, '扫码成功后必须提交一次完成请求');
  assert.equal(harness.requests[0].url, '/api/city/nodes/poi-1/complete');
  assert.equal(harness.requests[0].data.code, 'shop-poster-code', '扫码结果必须进入 code 请求字段');
});

/* 2026-09-02:「面板故障」那一支随系统弹层一起没了 —— 自绘的 cy-option-sheet 不存在
   「系统面板起不来」这条路径,弹层是页面自己的节点,能渲染出来就是能用。
   保留的是取消语义:取消不是故障态,不该把玩家挡在可重试的错误界面里。 */
test('vm=3:取消选项不报错,不落故障态', () => {
  const harness = mountPoiScene({
    validationMethod: 3,
    questionA: '甲', questionB: '乙',
  });

  harness.instance.startInteract();
  assert.equal(harness.instance.data.choiceSheetShow, true);
  harness.instance.onChoiceSheetCancel();
  assert.equal(harness.instance.data.choiceSheetShow, false, '取消要把弹层关掉');
  assert.equal(harness.instance.data.interactionState, 'idle', '主动取消不是故障态');
  assert.equal(harness.requests.length, 0, '取消不得提交任何完成请求');

  // 还能再开一次:取消不留残状态
  harness.instance.startInteract();
  assert.equal(harness.instance.data.choiceSheetShow, true, '取消之后必须还能重新打开');
});

test('vm=4:扫码取消、拒绝与瞬时故障分流，授权后自动重试', () => {
  const scans = [];
  const settings = [];
  const harness = mountPoiScene({ validationMethod: 4 }, {
    wx: {
      scanCode(options) { scans.push(options); },
      openSetting(options) { settings.push(options); },
    },
  });

  harness.instance.startInteract();
  scans[0].fail({ errMsg: 'scanCode:fail cancel' });
  assert.equal(harness.instance.data.interactionState, 'idle', '用户取消扫码不应显示错误');

  harness.instance.startInteract();
  scans[1].fail({ errMsg: 'scanCode:fail auth deny' });
  assert.equal(harness.instance.data.interactionState, 'camera-permission', '相机拒绝必须进入明确权限态');
  assert.ok(harness.instance.data.interactionActionText, '权限态必须显示恢复 CTA');
  harness.instance.recoverInteraction();
  assert.equal(settings.length, 1, '权限 CTA 必须打开微信设置');
  settings[0].success({ authSetting: { 'scope.camera': true } });
  assert.equal(scans.length, 3, '设置授权返回后必须自动重试扫码');
  assert.equal(harness.instance.data.interactionState, 'idle');

  scans[2].fail({ errMsg: 'scanCode:fail system error' });
  assert.equal(harness.instance.data.interactionState, 'retry', '瞬时扫码错误必须可重试');
  harness.instance.recoverInteraction();
  assert.equal(scans.length, 4, '瞬时错误 CTA 必须重试扫码');
});

test('到店定位失败保留已填数据，授权恢复后继续原完成请求', () => {
  const locations = [];
  const settings = [];
  const harness = mountPoiScene({ validationMethod: 1 }, {
    wx: {
      showModal(options) { options.success({ confirm: true, content: '已填暗号' }); },
      getLocation(options) { locations.push(options); },
      openSetting(options) { settings.push(options); },
    },
  });

  harness.instance.startInteract();
  locations[0].fail({ errMsg: 'getLocation:fail system error' });
  assert.equal(harness.instance.data.interactionState, 'retry', '瞬时定位错误必须可重试');
  harness.instance.recoverInteraction();
  assert.equal(locations.length, 2, '重试必须继续原完成动作，不重新索要暗号');

  locations[1].fail({ errMsg: 'getLocation:fail auth deny' });
  assert.equal(harness.instance.data.interactionState, 'location-permission', '定位拒绝必须进入明确权限态');
  assert.ok(harness.instance.data.interactionActionText, '定位权限态必须显示恢复 CTA');
  harness.instance.recoverInteraction();
  assert.equal(settings.length, 1, '定位权限 CTA 必须打开微信设置');
  settings[0].success({ authSetting: { 'scope.userLocation': true } });
  assert.equal(locations.length, 3, '设置授权返回后必须自动续跑定位');
  locations[2].success({ latitude: 31.2, longitude: 121.5 });
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].data.answer, '已填暗号', '恢复后不得丢失已填内容');
});

test('权限与瞬时错误在据点正文内提供恢复入口，所有失败回调都必须有处理', () => {
  const js = strip(read('components/cy/scene-roam-poi-detail/index.js'));
  const wxml = strip(read('components/cy/scene-roam-poi-detail/index.wxml'));
  assert.doesNotMatch(js, /fail\s*\(\)\s*\{\s*\}/, '交互失败回调不得静默吞掉');
  assert.match(wxml, /interactionState !== 'idle'[\s\S]*interactionActionText[\s\S]*bind:retry="recoverInteraction"/,
    '恢复状态必须在当前据点正文内显示可操作 CTA');
});

test('vm=1/5:场景组件保留文字作答与 GPS 完成路径', () => {
  const textHarness = mountPoiScene({ validationMethod: 1 }, {
    wx: {
      showModal(options) { options.success({ confirm: true, content: '城瘾口令' }); },
    },
  });
  textHarness.instance.startInteract();
  assert.equal(textHarness.requests.length, 1, 'vm=1 确认文字作答后必须提交完成请求');
  assert.equal(textHarness.requests[0].data.answer, '城瘾口令', 'vm=1 必须提交输入的文字暗号');

  const gpsHarness = mountPoiScene({ validationMethod: 5 });
  gpsHarness.instance.startInteract();
  assert.equal(gpsHarness.requests.length, 1, 'vm=5 必须直接走定位完成请求');
  assert.equal(gpsHarness.requests[0].data.lat, 31.2);
  assert.equal(gpsHarness.requests[0].data.lng, 121.5);
  assert.equal(gpsHarness.requests[0].data.answer, '');
  assert.equal(gpsHarness.requests[0].data.photoUrl, '');
  assert.equal(gpsHarness.requests[0].data.code, '');
});

test('vm=4:商家要能取到自己那张张贴码', () => {
  const js = strip(read('pages/merchant/citynode/index.js'));
  assert.match(js, /city-node\/poster-code/, '商家没有取码入口,这张码就永远到不了店里');

  const wxml = strip(read('pages/merchant/citynode/index.wxml'));
  assert.match(wxml, /bindtap="showPosterCode"/);
  // 只有到店扫码的据点需要这张码;别的方式摆出来是噪音
  assert.match(wxml, /validationMethod === 4/, '取码入口要按 vm=4 条件出');
});

test('★负控:这些断言不是橡皮图章', () => {
  // 断言用的都是真标识符,注释里写同样的字不该让它变绿
  assert.equal(/body\.correctAnswer\s*=/.test(strip('// body.correctAnswer = x')), false,
    '注释里提一嘴不能算实现');
  assert.match(strip('const a=1;\nbody.correctAnswer = "A";'), /body\.correctAnswer\s*=/,
    '真代码必须被认出来,否则断言恒假、修坏了也不会红');
  // 泄题那两条是「必须不存在」型断言,构造一个含答案的样本确认它真能判红
  assert.equal(/correctAnswer/i.test('private String correctAnswer;'), true,
    '泄题断言要真能在出现答案字段时判红');
});


test('上传、扫码和暗号的旧回调在换点或关闭后不得提交', () => {
  for (const method of [1, 2, 4]) {
    for (const exit of ['reload', 'detach', 'close']) {
      let callback;
      const h = mountPoiScene({ validationMethod: method }, {
        app: { chooseImage(cb) { callback = () => cb(['https://img.example/old.jpg']); } },
        wx: {
          showModal(opts) { callback = () => opts.success({ confirm: true, content: '旧暗号' }); },
          scanCode(opts) { callback = () => opts.success({ result: '旧店码' }); },
        },
      });
      h.instance.startInteract();
      if (exit === 'reload') {
        h.instance.data.poiId = '22';
        h.instance._load();
        h.requests.at(-1).success({ code: 200, data: { id: 22, status: 1, validationMethod: method } });
      } else if (exit === 'detach') h.detach();
      else h.instance.close();
      callback();
      assert.equal(h.requests.filter(r => r.url.endsWith('/complete')).length, 0, method + ':' + exit);
    }
  }
});

test('设置返回和选择题的旧事件不得重新开启另一个据点的任务', () => {
  let setting;
  const h = mountPoiScene({ validationMethod: 4 }, { wx: {
    scanCode(opts) { opts.fail({ errMsg: 'scanCode:fail auth deny' }); },
    openSetting(opts) { setting = opts; },
  } });
  h.instance.startInteract();
  h.instance.recoverInteraction();
  h.instance.data.poiId = '22';
  h.instance._load();
  h.requests.at(-1).success({ code: 200, data: { id: 22, status: 1, validationMethod: 5 } });
  setting.success({ authSetting: { 'scope.camera': true } });
  assert.equal(h.requests.filter(r => r.url.endsWith('/complete')).length, 0);
  const choice = mountPoiScene({ validationMethod: 3, questionA: '甲' });
  choice.instance.startInteract();
  choice.instance.close();
  choice.instance.onChoiceSheetSelect({ detail: { index: 0 } });
  assert.equal(choice.requests.length, 0);
});

test('商家公开信息失败不遮挡真实历史待核销，补充信息可独立重试', () => {
  const h = mountPoiScene({});
  h.instance.data.poiId = '21';
  h.instance._load();
  h.requests[0].success({ code: 200, data: { id: 21, status: 0, needRedeem: true, couponId: 88, merchantId: 77 } });
  h.requests[1].success({ code: 410, msg: '商家主页未开放' });
  assert.equal(h.instance.data.state, 'ready');
  assert.equal(h.instance.data.merchantError, '商家主页未开放');
  const events = [];
  h.instance.triggerEvent = (name, detail) => events.push({ name, detail });
  h.instance.startInteract();
  assert.equal(events[0].detail.id, 'qr-citynode');
  h.instance.retryMerchant();
  h.requests[2].success({ code: 200, data: { id: 77, name: '原商家' } });
  assert.equal(h.instance.data.merchantError, '');
  assert.equal(h.instance.data.merchant.name, '原商家');
  assert.equal(h.instance.data.node.couponId, 88);
});

test('据点与纯商家返回必须有合法且匹配的 ID，畸形成功仍可重试', () => {
  for (const data of [{}, { id: true }, { id: [21] }, { id: 1.5 }, { id: 22 }]) {
    const h = mountPoiScene({});
    h.instance.data.poiId = '21';
    h.instance._load();
    h.requests[0].success({ code: 200, data });
    assert.equal(h.instance.data.state, 'error', JSON.stringify(data));
  }
  for (const id of [true, [77], 1.5, 78]) {
    const h = mountPoiScene({});
    h.instance.data.poiId = '';
    h.instance.data.merchantId = '77';
    h.instance._load();
    h.requests[0].success({ code: 200, data: { id } });
    assert.equal(h.instance.data.state, 'error', JSON.stringify(id));
  }
  const valid = mountPoiScene({});
  valid.instance.data.poiId = '21';
  valid.instance._load();
  valid.requests[0].success({ code: 200, data: { poiId: '21', status: 1, validationMethod: 5 } });
  assert.equal(valid.instance.data.state, 'ready');
});


test('待核销完成回执保留出码入口，关闭核销层后还能重新打开', () => {
  const h = mountPoiScene({ validationMethod: 5 });
  const events = [];
  h.instance.triggerEvent = (name, detail) => events.push({ name, detail });
  h.instance.startInteract();
  h.requests[0].success({ code: 200, data: { couponId: 88, needRedeem: true, alreadyClaimed: true } });
  assert.equal(h.instance.data.node.completed, false);
  assert.equal(h.instance.data.node.needRedeem, true);
  h.instance.startInteract();
  assert.equal(events.filter(e => e.name === 'open').length, 2);
  assert.equal(h.requests.length, 1);
});
