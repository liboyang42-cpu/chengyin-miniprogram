'use strict';

const fs = require('fs');
const path = require('path');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/questo-puzzle-atmosphere';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setCurrentPageData(mp, patch) {
  await mp.evaluate((data) => {
    const pages = getCurrentPages();
    pages[pages.length - 1].setData(data);
  }, patch);
  await wait(500);
}

async function shot(mp, name) {
  const target = path.join(SHOT_DIR, name);
  await mp.screenshot({ path: target });
  const stat = await fs.promises.stat(target);
  if (stat.size < 10000) throw new Error(`${name} 截图异常小:${stat.size}`);
  console.log(`✔ ${name} ${stat.size} bytes`);
}

async function main() {
  await fs.promises.mkdir(SHOT_DIR, { recursive: true });
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    await mp.reLaunch('/pages/play/index?mock=city');
    await wait(1200);

    await setCurrentPageData(mp, {
      screen: 'gamePlay',
      chapterFull: false,
      chapter: {
        idxLabel: '第二章', name: '午夜档案', description: '沿着门楣留下的年份继续追查。',
        atmospherePreset: 'BLUE', atmosphereClass: 'atmosphere--blue'
      },
      game: {
        nodeId: 1002, title: '门楣上的年份', vm: 1, question: '找出门楣最左侧的四位数字',
        puzzleScoring: true, hintCount: 2, reveal: ''
      },
      shownHints: ['提示 1：先观察入口上方的石刻。'],
      puzzleScoreCap: 70,
      canHint: true,
      canReveal: false,
      hintLabel: '1/2',
      gWrong: false,
      answerInput: ''
    });
    await shot(mp, '01-puzzle-night-hint.png');

    await setCurrentPageData(mp, {
      screen: '', chapterFull: true,
      chapterParas: [{ key: 'p1', text: '雨后的石墙像一本没有合上的旧档案。' }, { key: 'p2', text: '抬头，下一条线索藏在门楣的年份里。' }]
    });
    await shot(mp, '02-chapter-night.png');

    await setCurrentPageData(mp, {
      chapterFull: false, showFinish: true, doneCount: 4, total: 4,
      finishPuzzleScore: 210, finishPuzzleCount: 3, finishPuzzleBest: 240,
      finishScore: 48, finishSnap: '', finishPhotos: [], finishBadge: null,
      reviewEmpty: true, finishRouteRecommendation: null
    });
    await shot(mp, '03-finish-puzzle-best.png');

    await mp.reLaunch('/pages/publish/fabu/index');
    await wait(1500);
    await setCurrentPageData(mp, {
      popChapter: true,
      popChapterAction: 0,
      'formData.productType': 1,
      'chapterForm.name': '第二章 · 午夜档案',
      'chapterForm.atmospherePreset': 'NIGHT'
    });
    await shot(mp, '04-editor-atmosphere-presets.png');
  } finally {
    await closeMiniProgram(session);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
