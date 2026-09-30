// 通用协议展示页：按 type 渲染协议文本。
// 文本本身已抽到 utils/agreement-docs.js 作为单一真源 —— 同一份法律文本还被
// components/cy/agreement-sheet(全屏弹窗)消费,存两份必然改一处漏一处。
const { DEFAULT_TYPE, getDoc, resolveKey } = require('../../utils/agreement-docs.js');

// 栈首页(深链 / 直达 / 分享)时 navigateBack 会失败,必须落回**该 type 真实 caller 所在页**。
// caller 矩阵(全仓 grep,只有这两个;新增 caller 必须回来补一行,契约测试会盯):
//   user_agreement      ← pages/shezhi/shezhi.js:125    goUserAgreement
//   cancellation_notice ← pages/deregister/index.js:49  goCancellationNotice
// ⚠️ 别退回「一律回设置页」:那会让用户从注销页点进《账号注销须知》再返回时被丢到设置页,
//    他正在走的注销流程整段丢失、也没有任何回去的路。
const ORIGIN_BY_TYPE = {
  user_agreement: '/pages/shezhi/shezhi',
  cancellation_notice: '/pages/deregister/index',
};

Page({
  data: { doc: null, docType: DEFAULT_TYPE },

  onLoad(query) {
    const type = (query && query.type) || DEFAULT_TYPE;
    const doc = getDoc(type);
    // 兜底路由必须与上面 doc 的回退**同步**:未知 type 既落 user_agreement 文档,
    // 也就该落 user_agreement 的 caller(设置页)。
    const docType = resolveKey(type);
    wx.setNavigationBarTitle({ title: doc.title });
    this.setData({ doc, docType });
  },

  // redirectTo 而非 navigateTo:兜底不该把页面栈越堆越深。
  // 两个兜底目标自身都还有下一层出口(设置页有 member tab 兜底;注销页是设置的子页)。
  onBack() {
    const url = ORIGIN_BY_TYPE[this.data.docType] || ORIGIN_BY_TYPE[DEFAULT_TYPE];
    wx.navigateBack({ fail() { wx.redirectTo({ url }); } });
  },
});
