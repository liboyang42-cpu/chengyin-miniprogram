// cy-badge · 徽章/角标(DS §3.6)。type=count 数字 / dot 圆点 / status 内联状态胶囊。

/* status 的默认图标 —— 手册 Foundations「业务 → token → icon」那张表。
 * 为什么放在组件里而不是让 30 个调用点各传一次:改之前只有 1 处传了 icon,
 * 其余 29 处退化成色点(Do not use 页禁的形态)。默认值放这里,那 29 处零改动就全对了;
 * 调用点仍可显式传 icon 覆盖(如「进行中」用 play 而不是 success 的默认 check)。 */
/* neutral 故意留空:它一支要覆盖「即将开始 / 结算中 / 已结束 / 已下线 / 草稿 /
 * 已使用 / 已过期 / 状态待确认」,图标集里没有哪一枚对这一组全都成立 ——
 * 试过的 close-sm 只对「已结束」那半边对,画在「即将开始」上就是错的信息。
 * 无图标退化成纯文字灰胶囊,不是 Do not use 页禁的**色点**,两者别混。 */
const VARIANT_ICON = {
  neutral: '',           // 见上
  info:    'info',       // 报名中 / 信息
  success: 'check',      // 已完成 / 已核销
  warning: 'clock',      // 待核销 / 待处理
  danger:  'warning',    // 已取消 / 逾期
  rare:    'star',       // 稀有
};

Component({
  properties: {
    type: { type: String, value: 'count' },      // count | dot | status
    variant: { type: String, value: 'danger' },  // neutral|info|success|warning|danger|rare
    count: { type: Number, value: 0 },
    max: { type: Number, value: 99 },
    label: { type: String, value: '' },
    icon: { type: String, value: '' },
    overlay: { type: Boolean, value: false },
    zero: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },
  data: { _text: '', _show: true, _icon: '' },
  observers: {
    'variant, icon'(variant, icon) {
      // 显式传的 icon 优先;variant 不认识时按 neutral 处理(即不画图标)
      this.setData({ _icon: icon || VARIANT_ICON[variant] || '' });
    },
    'type, count, max, zero'(type, count, max, zero) {
      let show = true, text = '';
      if (type === 'count') {
        const n = Math.max(0, Math.round(count));   // 角标恒为非负整数,挡 1.5 / -3
        if (n <= 0 && !zero) show = false;
        text = n > max ? max + '+' : String(n);
      }
      this.setData({ _show: show, _text: text });
    },
  },
});
