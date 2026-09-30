// cy-club-topic-merchants · J7 商家(T1 半屏弹窗)。Figma node 297:409。
//
// ⚠️ 安全铁律(须知原文):合作确认(accepted)后才展示联系人手机号、才可拨打;
// 未确认的不下发号码。前端不能靠 wx:if 藏 —— 号码本就不该下发。
// 落地方式:每一站的联系人信息只在后端真的给了 `item.contact` 时才渲染那一行
// (wxml 判据是 `item.contact` 有没有,不是 `item.status === 'accepted'`)——
// 这样即便以后有人在别处按 status 加条件分支,少了 contact 字段这一行还是渲染不出来;
// 反过来,只要后端老老实实按"未确认不下发"实现,这里天然就是安全的,不依赖前端记得判断。
//
// 纯展示组件:数据由宿主通过 stations/onboarding 属性传入,不自己发请求 ——
// 后端目前没有聚合接口(TODO(backend)见下),真写一个指向不存在 endpoint 的
// app.sendRequest 调用只会是死代码,还会被 UI-GATE-0(U1)判红。
//
// TODO(backend):需要新增 GET /api/topic/merchant-overview?id= 返回
//   { stations: [{ name, meta, statusLabel, statusTone: 'success'|'warning',
//     contact: { name, phoneMasked, phone } | null }],
//     onboarding: [{ mode: 'node'|'chapter', label, sub, pendingCount }] }
// —— contact 字段本身必须只在该站商家已确认合作时才出现在响应体里,不能靠前端过滤。
// 宿主接线时:拉到数据后 setData 给 stations/onboarding,把 loadState 切到 ready/empty/error。
Component({
  properties: {
    show: { type: Boolean, value: false },
    topicId: { type: String, value: '' },
    loadState: { type: String, value: 'loading' }, // loading | ready | empty | error
    loadErrorText: { type: String, value: '' },
    stations: { type: Array, value: [] },
    onboarding: { type: Array, value: [] },
  },
  methods: {
    /** 拨打联系人。号码只可能来自 item.contact.phone —— 没有这个字段就点不出这个按钮。 */
    onCallContact(e) {
      const phone = e.currentTarget.dataset.phone;
      if (!phone) return;
      wx.makePhoneCall({ phoneNumber: String(phone) });
    },

    onOpenOnboarding(e) {
      const mode = e.currentTarget.dataset.mode;
      const detail = { topicId: this.data.topicId };
      if (mode === 'chapter') this.triggerEvent('openchapter', detail);
      else this.triggerEvent('opennode', detail);
    },

    onRetry() { this.triggerEvent('retry', { topicId: this.data.topicId }); },
    onClose() { this.triggerEvent('close'); },
  },
});
