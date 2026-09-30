// cy-club-publish-sheet · G1 发布 · 三选一(T1 底部弹窗)。
//
// 没有找到既有的「发布」入口触发点(pages/publish/fabu 是另一个模块的大文件，不在本次改动范围内)，
// 所以做成不挂在任何具体页面上的可复用组件：谁拥有「发布」按钮，谁负责 show + 监听 bind:choose 再自己导航。
// choose 事件只带 { key: 'city' | 'explore' | 'event' }，不做任何路由跳转 —— 路由由调用方决定。
const OPTIONS = [
  {
    key: 'city',
    icon: 'flag',
    title: '城市定向',
    desc: '需设置具体的集合时间与地点,适合强组织的团体活动。',
  },
  {
    key: 'explore',
    icon: 'tab-explore',
    title: '自由探索',
    desc: '只需设置有效期,用户在规定时间内自由前往体验。',
  },
  {
    key: 'event',
    icon: 'calendar',
    title: '活动',
    desc: '一次性的线下聚会:定时间、地点与票种,不含路线与节点。',
  },
];

Component({
  properties: {
    show: { type: Boolean, value: false },
  },
  data: { options: OPTIONS },
  methods: {
    onClose() { this.triggerEvent('close'); },
    onChoose(e) {
      const key = e.currentTarget.dataset.key;
      if (!OPTIONS.some(item => item.key === key)) return;
      this.triggerEvent('choose', { key });
    },
  },
});
