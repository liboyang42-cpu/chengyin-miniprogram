/**
 * utils/playkit-steps.js —— 玩法步骤的图形化(纯函数,可单测)
 *
 * 来源:Figma「🏆 ADA 借鉴卡」E 条 ← Sago Mini(2026 Interaction + Inclusivity 双得主)。
 * 原话:「幼儿产品的纪律对大众产品同样值钱:任务步骤全部图形化(①蒙眼 ②尝 ③答),
 * 不读字也能开始玩;文字只做氛围不做说明书。成本:图标化改造,低。」
 *
 * ★ 为什么是「替代」而不是「并排加一行图标」:
 *   稿说的是「文字只做氛围不做说明书」。图标 + 一行长说明并排,读者仍然会去读那行字,
 *   等于没改 —— 只有把说明书那一行拿掉,图标才真的承担起说明的职责。
 *   原来的整句说明降级成图标行的 aria-label:眼睛不用读,读屏器仍然听得到完整步骤。
 *
 * ★ 标签仍保留 2–4 个字,不是纯图标:
 *   cy-icon 那套是通用图标(coolicons),没有"闭眼尝一口"这种专用字形。
 *   纯图标 + 猜谜对玩家更不友好,而 Sago Mini 本身也有极简标签。
 *   ⚠️ 不用 emoji 当图标:全仓图标契约禁止 wxml 出现 emoji/字符伪图标
 *   (tests/unit/global-real-icon-contract.test.js),这条比稿里的 emoji 示意优先。
 */

/** 每种玩法的步骤序列。图标名取自 components/cy/icon/icons.wxss 的在册清单。 */
const STEPS = {
  blindtaste: [
    { icon: 'gift', label: '领小样' },
    { icon: 'heart', label: '闭眼尝' },
    { icon: 'check', label: '作答' },
  ],
  silentorder: [
    { icon: 'walk', label: '进店' },
    { icon: 'star', label: '只比划' },
    { icon: 'qr-scan', label: '店员扫码' },
  ],
  diyname: [
    { icon: 'camera', label: '拍作品' },
    { icon: 'edit', label: '起名' },
    { icon: 'check', label: '提交' },
  ],
  musiccorner: [
    { icon: 'pin', label: '坐下' },
    { icon: 'play', label: '听完' },
  ],
  steps: [
    { icon: 'walk', label: '走起来' },
    { icon: 'clock', label: '刷新' },
    { icon: 'star', label: '落章' },
  ],
  timewindow: [
    { icon: 'clock', label: '等开放' },
    { icon: 'bell', label: '订阅提醒' },
  ],
  dailysign: [
    { icon: 'gift', label: '领签' },
    { icon: 'share', label: '收下' },
  ],
};

/**
 * @param {string} type 玩法 type(cy-playkit 分发器那套)
 * @returns {Array<{index:number, icon:string, label:string}>} 带序号的步骤;未知玩法给空数组
 */
function stepIcons(type) {
  const raw = STEPS[type];
  if (!raw) return [];
  return raw.map((item, i) => ({ index: i + 1, icon: item.icon, label: item.label }));
}

/**
 * 图标行的读屏文案。眼睛不用读字,但读屏器必须听得到完整步骤 ——
 * 服务端配的整句说明在这里派上用场,拿不到就用标签拼一句。
 * @param {string} type
 * @param {string} [fallbackText] 服务端下发的整句步骤说明
 */
function stepsA11yLabel(type, fallbackText) {
  if (fallbackText && String(fallbackText).trim()) return String(fallbackText).trim();
  const steps = stepIcons(type);
  if (!steps.length) return '';
  return '玩法步骤:' + steps.map((s) => s.index + ' ' + s.label).join(',');
}

module.exports = { stepIcons, stepsA11yLabel, STEPS };
