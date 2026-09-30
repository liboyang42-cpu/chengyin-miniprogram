// 2026-09-23 CU-M-31:模板介绍页「开始创建」成功跳走后 navigating 不复位,
// 从创建页返回再点「跳过」被 early-return 挡死、按钮永远转圈。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(wx) {
  let config;
  const sandbox = {
    Page(value) { config = value; },
    require: () => ({ isRecordList: Array.isArray }),
    getApp: () => ({ globalData: {}, sendRequest() {} }),
    wx, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/publish/template-intro/index.js'), 'utf8'), sandbox);
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return page;
}

test('开始创建成功后返回,再点跳过仍能进入创建页', () => {
  const urls = [];
  const page = loadPage({ navigateTo: (opts) => { urls.push(opts.url); if (opts.success) opts.success(); } });
  page.goCreate();
  page.onSkip();
  assert.equal(urls.length, 2, '第二次必须真的发起跳转');
  assert.equal(page.data.navigating, false, '按钮不得停在加载态');
});
