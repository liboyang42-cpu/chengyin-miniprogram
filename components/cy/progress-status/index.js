// 长任务的静态可读进度。current 为 0-based 当前步骤；等于 steps.length 表示全部完成。
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    density: { type: String, value: 'compact' }, // compact | steps
    steps: { type: Array, value: [] },
    current: { type: Number, value: 0 },
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    aria: { type: String, value: '' },
  },
  data: {
    _steps: [],
    _allDone: false,
    _progressCopy: '',
  },
  observers: {
    'steps, current, title, sub, aria': function (steps, current, title, sub, aria) {
      const source = Array.isArray(steps) ? steps : [];
      const parsedCurrent = Number(current);
      const safeCurrent = Number.isFinite(parsedCurrent)
        ? Math.max(0, Math.floor(parsedCurrent))
        : 0;
      const allDone = source.length > 0 && safeCurrent >= source.length;
      const normalized = source.map((step, index) => {
        const value = step && typeof step === 'object'
          ? (step.label || step.title || '')
          : step;
        const state = index < safeCurrent ? 'done'
          : (index === safeCurrent && !allDone ? 'current' : 'pending');
        return {
          key: `i${index}`,
          label: String(value || `步骤 ${index + 1}`),
          state,
          status: state === 'done' ? '已完成' : (state === 'current' ? '进行中' : '待处理'),
        };
      });
      const progressCopy = source.length
        ? (allDone
          ? `全部完成，共 ${source.length} 步`
          : `第 ${Math.min(safeCurrent + 1, source.length)} 步，共 ${source.length} 步`)
        : '';
      this.setData({
        _steps: normalized,
        _allDone: allDone,
        _progressCopy: progressCopy,
      });
    },
  },
});
