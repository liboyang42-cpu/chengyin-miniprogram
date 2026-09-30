const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('藏品册隐藏后迟到图片不重启动画，卸载后列表不更新页面', () => {
  let page, request, image, scheduled = 0, updates = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../subpackageP3/pages/object-cards/index/index.js'), 'utf8'), {
    getApp: () => ({ sendRequest: r => { request = r; } }),
    Page: p => { page = p; },
    require: id => id.endsWith('/object-card.js') ? { toCard: row => row } : {},
  });
  page.data = { cards: [], filter: '全部' };
  page.setData = patch => { updates++; Object.assign(page.data, patch); };
  page._images = {};
  page._bodies = [{}];
  page._canvas = { createImage: () => (image = {}), requestAnimationFrame: () => ++scheduled, cancelAnimationFrame() {} };
  page._loadImage('photo');
  page.onHide();
  image.onload();
  assert.equal(scheduled, 0);
  page.onShow();
  assert.equal(scheduled, 1);
  page.load('全部');
  page.onUnload();
  const before = updates;
  request.success({ code: '200', data: { list: [{ id: 1, title: '卡' }], total: 1 } });
  request.fail();
  image.onerror();
  assert.equal(updates, before);
  assert.equal(scheduled, 1);
});
