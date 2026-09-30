'use strict';

/**
 * 极简 PNG 解码(8-bit、非隔行、RGB/RGBA),零三方依赖。
 *
 * 从 scripts/_infra.js 抽出来的原因:截图判据(scripts/uiaudit/verify-batch.js)
 * 要按像素判「两张图是不是同一屏」,而 _infra.js 在 require 时就会
 * ①要求 UI_AUDIT_OUT 环境变量 ②execSync 一次 git rev-parse —— 那是采集侧的前提,
 * 不该被一条在 CI 里跑 --selftest 的纯静态门禁继承。
 * ponytail:只支持 DevTools 截图桥实际吐出的那一种 PNG;换了格式就换真解码器。
 */
const fs = require('fs');
const zlib = require('zlib');

function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += len + 12;
  }
  if (!ihdr) throw new Error(`PNG has no IHDR: ${file}`);
  if (ihdr.depth !== 8 || ihdr.interlace !== 0 || (ihdr.color !== 2 && ihdr.color !== 6)) {
    throw new Error(`unsupported PNG form (depth=${ihdr.depth} color=${ihdr.color} interlace=${ihdr.interlace}): ${file}`);
  }
  const bpp = ihdr.color === 6 ? 4 : 3;
  const stride = ihdr.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return {
    width: ihdr.width,
    height: ihdr.height,
    px: (x, y) => {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}

/** 只在自证里用:把像素写成一张真 PNG(8-bit RGB、无滤波),好让判据有可解码的负控样本。 */
function writePng(file, width, height, fill) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const rgb = fill(x, y);
      const i = y * (stride + 1) + 1 + x * 3;
      raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2];
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

module.exports = { readPng, writePng };
