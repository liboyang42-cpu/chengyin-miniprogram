// 通关分享卡的里程碑轴(参照 03_游戏结束分享.jpg 的 30/50/100/150/240/365 刻度轴)。
// 纯函数,不碰网络:调用方把「累计完成主题数」算好传进来,这里只决定档位与高亮位置。
//
// ⚠️ 档位数字是真实累计值的刻度,不是装饰:
//   · count 拿不到(null/负数/非数字)时返回 null —— 调用方据此整条轴不渲染,
//     不允许退化成「全是灰点 + 第一档高亮」那种看起来有数据其实没有的样子。
//   · 已经越过的档位标 past,当前所处档位标 current,尚未抵达的标 future。
const TIERS = [1, 5, 10, 30, 100];

function buildMilestone(count) {
  // ⚠️ 必须先挡掉 null / undefined / 空串再做 Number():Number(null) 和 Number('') 都是 0,
  // 直接 Number() 会把「接口没给值」悄悄变成「累计 0 个」,轴照样渲染出来 —— 正是要防的假数据。
  // (同 utils/growth-overview.js 的 nonNegativeNumber 口径)
  if (count == null || (typeof count === 'string' && count.trim() === '')) return null;
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return null;

  // 当前档 = 已达成的最大档位;一个都没到(count=0)时没有 current,全部 future
  let currentIndex = -1;
  for (let i = 0; i < TIERS.length; i++) {
    if (n >= TIERS[i]) currentIndex = i;
  }

  const tiers = TIERS.map((value, i) => ({
    value: value,
    state: i < currentIndex ? 'past' : (i === currentIndex ? 'current' : 'future'),
  }));
  const nextValue = TIERS.find((value) => value > n);
  const lowerValue = currentIndex >= 0 ? TIERS[currentIndex] : 0;
  const intervalProgress = nextValue == null
    ? 1
    : (n - lowerValue) / Math.max(1, nextValue - lowerValue);
  // 轨道上的档位等距排列，填充宽度也必须落在对应档位之间；只返回“本区间 40%”
  // 会让 7 个主题的填充停在整条轨道 40% 处，而不是 5 与 10 两点之间。
  const progress = currentIndex < 0
    ? 0
    : Math.round((currentIndex + intervalProgress) / Math.max(1, TIERS.length - 1) * 100);

  return {
    count: n,
    // 称号式一句话(副文案),对应参考图的 You are now a "..."
    title: n > 0 ? ('你已完成第 ' + n + ' 个主题') : '你的第一个主题正在路上',
    tiers: tiers,
    next: nextValue == null ? null : { value: nextValue, remaining: nextValue - n },
    progress: Math.max(0, Math.min(100, progress)),
  };
}

module.exports = { buildMilestone, TIERS };
