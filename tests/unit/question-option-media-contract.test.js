const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const optionMedia = require('../../pages/publish/utils/publish/option-media.js');

const PAGE = '../../pages/publish/temp/index.js';
const ROLE_GUARD = '../../utils/roleGuard.js';

// 题干配图/配音 + 选项配图配音(2026-08-16)。
// 这一组的形状必须与后端 QuestionOptionMedia 逐字一致 —— 后端 sanitize 是「畸形整条打回」
// 而不是静默丢弃,前端多塞一个键,用户看到的是「保存失败」而查不到是哪个字段。

let sent = [];
let storage = {};
let pageConfig = null;
let chosenImages = [];
let chosenDocs = [];

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (request) => { sent.push(request); },
  getAuthorization: () => 'Bearer test',
  getUserID: () => 0,
  getUserInfo: () => null,
  getToken: () => '',
  chooseImage: (cb) => { cb(chosenImages); },
  chooseDocument: (cb) => { cb(chosenDocs); },
});
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  showToast: () => {},
  navigateBack: () => {},
  getBackgroundAudioManager: () => ({ stop: () => {} }),
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  sent = [];
  storage = {};
  pageConfig = null;
  chosenImages = ['https://cdn/opt-a.jpg'];
  chosenDocs = [{ url: 'https://cdn/opt-a.mp3', filename: 'a.mp3', type: 'mp3' }];
  delete require.cache[require.resolve(PAGE)];
  delete require.cache[require.resolve(ROLE_GUARD)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = page.data;
      for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
      target[parts[parts.length - 1]] = patch[key];
    });
    if (callback) callback();
  };
  return page;
}

// ===== 序列化口径 =====

test('optionItems → JSON:只留有 url 的选项,键就是字母', () => {
  const json = optionMedia.toJson([
    { letter: 'A', text: '甲', img: 'https://cdn/a.jpg', audio: '' },
    { letter: 'B', text: '乙', img: '', audio: 'https://cdn/b.mp3' },
    { letter: 'C', text: '丙', img: '', audio: '' },
  ]);

  assert.deepEqual(JSON.parse(json), {
    A: { img: 'https://cdn/a.jpg' },
    B: { audio: 'https://cdn/b.mp3' },
  });
});

test('一个媒体都没配时给空串,而不是 "{}" —— 后端据此把列存成 NULL', () => {
  assert.equal(optionMedia.toJson([{ letter: 'A', text: '甲' }]), '');
  assert.equal(optionMedia.toJson([]), '');
});

test('坏 JSON 当没配处理,不能让整张题打不开', () => {
  assert.deepEqual(optionMedia.fromJson('{不是json'), {});
  assert.deepEqual(optionMedia.fromJson(''), {});
  assert.deepEqual(optionMedia.fromJson(null), {});
});

test('回填按字母对齐;字母对不上的媒体丢掉(选项已被删,它的图没有归属)', () => {
  const items = optionMedia.applyToOptions(
    [{ letter: 'A', text: '甲' }, { letter: 'B', text: '乙' }],
    JSON.stringify({ A: { img: 'https://cdn/a.jpg' }, D: { img: 'https://cdn/d.jpg' } }),
  );

  assert.equal(items[0].img, 'https://cdn/a.jpg');
  assert.equal(items[1].img, '');
  assert.equal(items.length, 2);
});

test('往返:toJson(applyToOptions(...)) 回到原始 JSON', () => {
  const original = { A: { img: 'https://cdn/a.jpg', audio: 'https://cdn/a.mp3' }, C: { img: 'https://cdn/c.jpg' } };
  const items = optionMedia.applyToOptions(
    ['A', 'B', 'C'].map((letter) => ({ letter, text: letter })),
    JSON.stringify(original),
  );

  assert.deepEqual(JSON.parse(optionMedia.toJson(items)), original);
});

// ===== 编辑器行为 =====

// ★ 最容易悄悄坏的一条:_normalizeOptions 被增删选项、选正确答案等每条路径复用。
//   它漏带 img/audio,用户配好的选项图会在「点一下圆圈」时无声消失。
test('选正确答案不会把已配的选项媒体抹掉', () => {
  const page = makePage();
  page.data.optionItems = [
    { letter: 'A', text: '甲', isCorrect: true, img: 'https://cdn/a.jpg', audio: '' },
    { letter: 'B', text: '乙', isCorrect: false, img: '', audio: 'https://cdn/b.mp3' },
  ];

  page.pickCorrectOption({ currentTarget: { dataset: { index: 1 } } });

  assert.equal(page.data.optionItems[0].img, 'https://cdn/a.jpg');
  assert.equal(page.data.optionItems[1].audio, 'https://cdn/b.mp3');
  assert.equal(page.data.optionItems[1].isCorrect, true);
});

test('加一个选项不会把已有选项的媒体抹掉', () => {
  const page = makePage();
  page.data.optionItems = [
    { letter: 'A', text: '甲', isCorrect: true, img: 'https://cdn/a.jpg', audio: '' },
    { letter: 'B', text: '乙', isCorrect: false, img: '', audio: '' },
  ];

  page.addChoiceOption();

  assert.equal(page.data.optionItems.length, 3);
  assert.equal(page.data.optionItems[0].img, 'https://cdn/a.jpg');
});

test('上传选项图只落到那一行,不串到别的选项', () => {
  const page = makePage();
  page.data.optionItems = [
    { letter: 'A', text: '甲', isCorrect: true, img: '', audio: '' },
    { letter: 'B', text: '乙', isCorrect: false, img: '', audio: '' },
  ];

  page.uploadOptionImg({ currentTarget: { dataset: { index: 1 } } });

  assert.equal(page.data.optionItems[0].img, '');
  assert.equal(page.data.optionItems[1].img, 'https://cdn/opt-a.jpg');
});

test('提交投影:选择题带上选项媒体 JSON', () => {
  const page = makePage();
  page.data.moduleList = [{ key: 'finish' }];
  page.data.formData.validationMethod = 3;
  page.data.optionQuestion = '石碑上的图案象征什么?';
  page.data.optionItems = [
    { letter: 'A', text: '甲', isCorrect: true, img: 'https://cdn/a.jpg', audio: '' },
    { letter: 'B', text: '乙', isCorrect: false, img: '', audio: '' },
  ];

  const payload = page.prepareFormData();

  assert.deepEqual(JSON.parse(payload.questionOptionMediaJson), { A: { img: 'https://cdn/a.jpg' } });
  assert.equal(payload.questionA, '甲');
  assert.equal(payload.correctAnswer, 'A');
});

// ★ 换成拍照/扫码后题干附件必须一起清:留着就是一条对不上任何题面的孤儿数据,
//   而且它会随模板发布复制到模板库里去。
test('换成拍照后题干附件与选项媒体一起清空', () => {
  const page = makePage();
  page.data.moduleList = [{ key: 'finish' }];
  page.data.formData.validationMethod = 2;
  page.data.formData.questionImg = 'https://cdn/q.jpg';
  page.data.formData.questionAudio = 'https://cdn/q.mp3';
  page.data.optionItems = [{ letter: 'A', text: '甲', isCorrect: true, img: 'https://cdn/a.jpg' }];

  const payload = page.prepareFormData();

  assert.equal(payload.questionImg, '');
  assert.equal(payload.questionAudio, '');
  assert.equal(payload.questionOptionMediaJson, '');
});

test('文字作答保留题干附件 —— 看图答题/听音答题正是 vm=1 的用法', () => {
  const page = makePage();
  page.data.moduleList = [{ key: 'finish' }];
  page.data.formData.validationMethod = 1;
  page.data.formData.questionImg = 'https://cdn/q.jpg';
  page.data.formData.questionAudio = 'https://cdn/q.mp3';

  const payload = page.prepareFormData();

  assert.equal(payload.questionImg, 'https://cdn/q.jpg');
  assert.equal(payload.questionAudio, 'https://cdn/q.mp3');
});

test('编辑既有模板:选项媒体从 JSON 回填到行上', () => {
  const page = makePage();

  page.setOptionDataFromTemplate({
    questionA: '甲', questionB: '乙', correctAnswer: 'B',
    questionName: '题目',
    questionOptionMediaJson: JSON.stringify({ B: { img: 'https://cdn/b.jpg', audio: 'https://cdn/b.mp3' } }),
  });

  assert.equal(page.data.optionItems[0].img, '');
  assert.equal(page.data.optionItems[1].img, 'https://cdn/b.jpg');
  assert.equal(page.data.optionItems[1].audio, 'https://cdn/b.mp3');
});
