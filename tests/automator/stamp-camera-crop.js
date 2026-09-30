#!/usr/bin/env node
// A16 真裁切自证:给一张带可解析 GPS EXIF 的 JPEG，走页面的真实 offscreen canvas + compressImage 链路。
// 断言产物文件而非取景框像素:尺寸严格 4:5，且真实 EXIF/GPS 不会留在导出 JPEG。
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Pillow 生成并读回验证过的 APP1:GPS IFD 含经纬度 1/2/3/4 四个字段；运行时插入有效 JPEG 的 SOI 后。
const REAL_GPS_EXIF_APP1_BASE64 = '/+EAqEV4aWYAAE1NACoAAAAIAAIBMgACAAAAFAAAACaIJQAEAAAAAQAAADoAAAAAMjAyNjowNzoyMSAxMjowMDowMAAABAABAAIAAAACTgAAAAACAAUAAAADAAAAcAADAAIAAAACRQAAAAAEAAUAAAADAAAAiAAAAAAAAAAfAAAAAQAAAA0AAAABAAAAzgAAABkAAAB5AAAAAQAAABwAAAABAAAAewAAADI=';

async function makeExifFixture(mp) {
  return mp.evaluate((app1Base64) => new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: '/pages/topic/images/icon_line.jpg',
      success(info) {
        wx.getFileSystemManager().readFile({
          filePath: info.path,
          success(file) {
            const original = new Uint8Array(file.data);
            const app1 = new Uint8Array(wx.base64ToArrayBuffer(app1Base64));
            const output = new Uint8Array(original.length + app1.length);
            output.set(original.slice(0, 2), 0); // JPEG SOI
            output.set(app1, 2);                 // 完整 APP1(Exif + TIFF + GPS IFD)
            output.set(original.slice(2), app1.length + 2);
            const target = wx.env.USER_DATA_PATH + '/stamp-camera-exif-fixture.jpg';
            wx.getFileSystemManager().writeFile({
              filePath: target,
              data: output.buffer,
              success() { resolve({ path: target }); },
              fail: reject
            });
          },
          fail: reject
        });
      },
      fail: reject
    });
  }), REAL_GPS_EXIF_APP1_BASE64);
}

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    const fixture = await makeExifFixture(mp);
    const page = await mp.reLaunch('/subpackageP3/pages/stamp-camera/index/index');
    await page.waitFor(1200);
    await page.setData({ shot: fixture.path });
    const input = await page.callMethod('__shotFileProbe');
    assert.equal(input.hasExif, true, '负控输入必须包含可解析的 EXIF');
    assert.equal(input.hasGpsExif, true, '负控输入必须包含可解析的 GPS IFD');
    await page.setData({ frameW: 240, frameH: 300, frameL: 80, frameT: 200, shot: '' });
    await page.callMethod('cropToFrame', fixture.path);

    let shot = '';
    for (let i = 0; i < 30; i++) {
      await wait(200);
      shot = await page.data('shot');
      if (shot) break;
    }
    assert.ok(shot, '真实 canvas 裁切与重编码后必须产出 tempFilePath');

    const output = await page.callMethod('__shotFileProbe');
    assert.ok(output && output.width > 0 && output.height > 0, '必须能读取真实导出文件');
    assert.equal(output.width * 5, output.height * 4,
      '导出文件必须严格为 4:5，实际 ' + output.width + 'x' + output.height);
    assert.equal(output.hasExif, false, '裁切导出的 JPEG 不得保留 EXIF');
    assert.equal(output.hasGpsExif, false, '裁切导出的 JPEG 不得保留 GPS IFD');

    const shotPath = path.join(os.tmpdir(), 'stamp-camera-crop.png');
    await mp.screenshot({ path: shotPath });
    console.log('PASS stamp-camera crop:', JSON.stringify(output), 'screenshot=' + shotPath);
  } finally {
    await closeMiniProgram(session);
  }
}

main().catch(error => {
  console.error('FAIL stamp-camera crop:', error && error.stack || error);
  process.exit(1);
});
