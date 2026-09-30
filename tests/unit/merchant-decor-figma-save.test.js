'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')

function applyPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') cursor[parts[index]] = {}
      cursor = cursor[parts[index]]
    }
    cursor[parts.at(-1)] = value
  })
}

function loadPage(relativePath, options = {}) {
  const absolutePath = path.join(ROOT, relativePath)
  const requests = []
  const navigations = []
  const toasts = []
  let definition
  const app = {
    globalData: { navBarHeight: 44 },
    sendRequest(request) { requests.push(request) },
    getRequestErrorMessage(error, fallback) { return error && error.msg || fallback },
    chooseImage() {},
  }
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateBack() { navigations.push('back') },
    redirectTo({ url }) { navigations.push(url) },
    navigateTo({ url }) { navigations.push(url) },
    showToast(payload) { toasts.push(payload) },
    setNavigationBarColor() {},
    setBackgroundColor() {},
  }
  const localRequire = createRequire(absolutePath)
  const sandbox = {
    Array, Date, JSON, Math, Number, Object, RegExp, String,
    clearTimeout, setTimeout,
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(config) { definition = config },
    Component(config) { definition = Object.assign({}, config, config.methods) },
    require(request) {
      if (request.endsWith('merchant-theme.js')) {
        return { merchantPageShow() {}, merchantPageRestore() {} }
      }
      return localRequire(request)
    },
    wx,
  }
  const source = options.source || fs.readFileSync(absolutePath, 'utf8')
  vm.runInNewContext(source, sandbox, { filename: absolutePath })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    applyPatch(this.data, patch)
    if (typeof callback === 'function') callback.call(this)
  }
  return { page, requests, navigations, toasts }
}

test('字段保存失败保留草稿，成功前公开预览保持原值', () => {
  const h = loadPage('pages/merchant/decor/index.js');
  h.page.data.m = {memberId: 3, name: '旧店名'};
  h.page.openField({currentTarget:{dataset:{k:'name'}}});
  h.page.onFieldInput({detail:{value:'新店名'}});
  h.page.confirmField();
  assert.equal(h.page.data.m.name, '旧店名');
  assert.equal(h.page.data.fieldSheet.show, true);
  h.requests[0].fail({errMsg:'request:fail timeout'});
  assert.equal(h.page.data.fieldSheet.value, '新店名');
  assert.equal(h.page.data.m.name, '旧店名');
  h.page.confirmField();
  h.requests[1].success({code:'200'});
  assert.equal(h.page.data.m.name, '新店名');
  assert.equal(h.page.data.fieldSheet.show, false);
});

const hours = require('../../pages/merchant/utils/merchant-business-hours.js');
test('营业时间能往返跨夜，拒绝零营业日、相同时间和越界分钟', () => {
  const draft = hours.parse('周一至周日 22:30-次日02:15');
  assert.equal(hours.serialize(draft).value, '周一至周日 22:30-次日02:15');
  assert.equal(hours.serialize({...draft,end:'22:30'}).error, '开始与结束时间不能相同');
  assert.ok(hours.serialize({...draft,start:'24:00'}).error);
  assert.ok(hours.serialize({...draft,end:'02:60'}).error);
  assert.ok(hours.serialize({...draft,days:[]}).error);
});
// CU-M-136:门店信息已有「09:30-21:00」，进「经营时间」却七天全未选中，原样点完成被拒。
// 判据取后端同一口径：TopicRouteCandidatePolicy.isBusinessDay 把不带周几前缀的值当每天营业。
test('旧纯时间段营业时间回填成七天，认不出的周几文字不替商家编', () => {
  const legacy = hours.parse('09:30-21:00');
  assert.equal(legacy.days.filter(d => d.on).length, 7, '无周几前缀 = 每天营业，跟后端同口径');
  assert.equal(legacy.start, '09:30');
  assert.equal(legacy.end, '21:00');
  assert.equal(hours.serialize(legacy).value, '周一至周日 09:30-21:00', '原样确认必须存得下去');
  assert.equal(hours.parse('周一、周三 10:00-22:00').days.filter(d => d.on).map(d => d.label).join(''), '一三');
  assert.equal(hours.parse('周末 10:00-22:00').days.filter(d => d.on).length, 0,
    '后端对这个前缀也是失败关闭，前端不得当成七天让商家误以为已确认');
});
test('图片和承接单字段退出须确认，继续编辑保留草稿', () => {
  const h=loadPage('pages/merchant/decor/index.js');
  h.page.data.m={memberId:3,logo:'old.png'};
  h.page.openImage('logo');h.page.data.imageEditor.value='new.png';h.page.closeImage();
  assert.equal(h.page.data.discardVisible,true);h.page.keepEditing();
  assert.equal(h.page.data.imageEditor.value,'new.png');h.page.closeImage();h.page.discardField();
  assert.equal(h.page.data.imageEditor,null);assert.equal(h.page.data.m.logo,'old.png');
  const c=loadPage('pages/merchant/decor/coop-setting/index.js');
  c.page.editField({currentTarget:{dataset:{k:'demand'}}});c.page.editInput({detail:{value:'城市漫步'}});c.page.closeEditor();
  assert.equal(c.page.data.discardVisible,true);c.page.keepEditing();assert.equal(c.page.data.editor.value,'城市漫步');
  c.page.closeEditor();c.page.discardChanges();assert.equal(c.page.data.form.demand,'');assert.equal(c.navigations.length,0);
});
test('自定义标签可删除且服务器保存失败不覆盖原选项',()=>{
  const h=loadPage('pages/merchant/decor/index.js');h.page.data.m={memberId:3};h.page.data.tags=['自定义'];
  h.page.openTagPanel();assert.deepEqual(h.page.data.customTagChoices,['自定义']);
  h.page.toggleTag({currentTarget:{dataset:{t:'自定义'}}});h.page.confirmTags();
  h.requests[0].fail({errMsg:'request:fail'});assert.deepEqual(h.page.data.tags,['自定义']);assert.equal(h.page.data.tagDraft.length,0);
});

test('下拉日历重开远期日期不受滚轮年限影响，保留选中日',()=>{
  const h=loadPage('components/cy/date-field/index.js');h.page.data.value='2030-02-28';h.page.data.start='';
  h.page.triggerEvent=()=>{};h.page.prepareCalendar();
  assert.equal(h.page.data.calendarYear,2030);
  assert.equal(h.page.data.calendarDays.filter(d=>d.selected)[0].value,'2030-02-28');
  h.page.data.calendarYear=2028;h.page.buildCalendar();
  assert.equal(h.page.data.calendarDays.filter(d=>d.value).length,29);
});
test('角色保存使用现有请求通道，失败保留草稿，成功才更新已存头像',async()=>{
  const h=loadPage('pages/merchant/decor/ai-npc/index.js');h.page.data.savedAvatar='px1:p01';
  const payload={avatar:'px1:p07',name:'店长',greeting:'欢迎'};
  let promise=h.page.persistProfile(payload);assert.equal(h.requests[0].url,'/api/merchant/npc/save');
  assert.equal(h.page.data.savedAvatar,'px1:p01');h.requests[0].fail();await promise;
  assert.equal(h.page.data.savedAvatar,'px1:p01');assert.ok(h.page.data.saveError);
  promise=h.page.persistProfile(payload);h.requests[1].success({code:200});await promise;
  assert.equal(h.page.data.savedAvatar,'px1:p07');assert.equal(h.page.data.saving,false);
});
test('语音超时后查回同一样本已就绪，清除待提交文件，不能再次生成',async()=>{
  const h=loadPage('pages/merchant/decor/ai-npc/index.js');
  h.page.data.voiceFile={url:'https://files.example.com/voice.wav'};h.page.data.voiceUnknown=true;
  const promise=h.page.refreshVoice();h.requests[0].success({code:200,voiceStatus:2,voiceSample:'https://files.example.com/voice.wav'});await promise;
  assert.equal(h.page.data.voiceFile,null);assert.equal(h.page.data.voiceUnknown,false);
  h.page.uploadVoice();assert.equal(h.requests.length,1);
});

 test('新角色资料未保存时退出先确认，继续编辑保留草稿', () => {
  const h = loadPage('pages/merchant/decor/ai-npc/index.js');
  h.page._saved = {avatar: '', name: '', greeting: ''};
  h.page.data.name = '小城';
  h.page.onNavBack();
  assert.equal(h.page.data.discardVisible, true);
  assert.equal(h.navigations.length, 0);
  h.page.keepEditing();
  assert.equal(h.page.data.name, '小城');
  h.page.onNavBack();
  h.page.discardChanges();
  assert.equal(h.navigations[0], 'back');
});

test('设置的商家旧资料链接与装修入口汇合，普通用户仍编辑个人资料', () => {
  const h = loadPage('pages/shezhi/shezhi.js');
  h.page.data.isMerchantView = true;
  h.page.openScene('settings-profile');
  assert.equal(h.navigations[0], '/pages/merchant/decor/index');
  assert.equal(h.page.data.sceneCurrent, null);
  h.page.data.isMerchantView = false;
  h.page.goUserInfo();
  assert.equal(h.navigations[1], '/pages/gerenziliao/gerenziliao');
});


test('店铺资料先只读，下方编辑启用字段，完成后恢复只读', () => {
  const { page } = loadPage('pages/merchant/decor/index.js')
  page.data.view = 'basic'
  const event = {currentTarget:{dataset:{action:'openField',k:'name'}}}
  let calls = 0
  page.openField = () => { calls++ }
  page.onBasicAction(event)
  assert.equal(calls, 0)
  page.toggleBasicEditing()
  page.onBasicAction(event)
  assert.equal(calls, 1)
  page.toggleBasicEditing()
  page.onBasicAction(event)
  assert.equal(calls, 1)
  const markup = fs.readFileSync(path.join(ROOT,'pages/merchant/decor/index.wxml'),'utf8')
  const home = markup.split("view === 'home'")[2].split("view === 'brand'")[0]
  assert.ok(!home.includes('完善店铺'))
  const basic = markup.split('<block wx:elif="{{view === \'basic\'}}">')[1]
  assert.ok(!basic.includes('完善店铺'))
  assert.ok(basic.includes('bindtap="toggleBasicEditing"'))
})


test('入驻资料使用含审核材料的商家信息接口，不误用公开展示资料', () => {
  const {page, requests} = loadPage('pages/merchant/decor/index.js')
  page.data.view = 'qualification'
  page.load()
  assert.equal(requests[0].url, '/api/merchant/info')
  requests[0].fail({msg:'测试结束'})
})


test('常备权益作为页面编辑，返回先关闭编辑且保留列表路由', () => {
  const {page,navigations} = loadPage('pages/merchant/decor/perks/index.js')
  page.data.formVisible = true
  let closed = 0
  page.closeForm = () => { closed++ }
  page.onNavBack()
  assert.equal(closed, 1)
  assert.equal(navigations.length, 0)
  const markup = fs.readFileSync(path.join(ROOT,'pages/merchant/decor/perks/index.wxml'),'utf8')
  assert.match(markup, /<scroll-view[^>]*class="dp-editor-page"/)
  assert.doesNotMatch(markup, /<cy-sheet[^>]*title="添加常备权益"/)
})
