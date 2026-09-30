/* cy-upload · 图片上传网格(DS §3.13)
 * 结构:说明行(比例/数量/用途,tipText)→ 网格(已传缩略 160rpx + 添加位)。
 * 组件纯展示 + 事件(add/remove/retry/preview),选图与上传网络逻辑留在页面。
 * uploading 传 true(整体上传中)或索引数组;errorIndexes 传失败索引——
 * 失败位保留并就地重试,禁静默丢图(§3.13)。达上限或 disabled 时隐藏添加位。 */
Component({
  properties: {
    urls:         { type: Array,   value: [] },    // 已传图 src 列表
    max:          { type: Number,  value: 9 },
    tipText:      { type: String,  value: '' },    // 说明行:比例 / 数量 / 用途
    disabled:     { type: Boolean, value: false }, // 只读展示:隐藏添加位与删除钮
    uploading:    { type: null,    value: false }, // true 或 [index, ...]
    errorIndexes: { type: Array,   value: [] },    // 上传失败的索引(可重试)
    replaceOnTap: { type: Boolean, value: false }, // 仅 max=1 生效:已满时点图走 add(重选)而非 preview——单图封面一步换图。多图位点图表达不了「换哪张」,故 max>1 时忽略
  },
  data: { items: [], showAdd: true },
  observers: {
    'urls, max, disabled, uploading, errorIndexes': function () { this.recalc(); },
  },
  lifetimes: {
    attached() { this.recalc(); },
  },
  methods: {
    recalc() {
      const { urls, max, disabled, uploading, errorIndexes } = this.data;
      const upAll = uploading === true;
      const upSet = {};
      if (Array.isArray(uploading)) uploading.forEach((i) => { upSet[i] = true; });
      const errSet = {};
      (errorIndexes || []).forEach((i) => { errSet[i] = true; });
      const items = (urls || []).map((url, i) => {
        // error 优先于 uploading:失败是终态,不许被整批 uploading=true 的转圈压制(§3.13 禁静默丢图)
        const isErr = !!errSet[i];
        return { url, index: i, error: isErr, uploading: !isErr && (upAll || !!upSet[i]) };
      });
      this.setData({ items, showAdd: !disabled && items.length < max });
    },
    onAdd() { if (!this.data.disabled) this.triggerEvent('add'); },
    onRemove(e) { if (!this.data.disabled) this.triggerEvent('remove', { index: e.currentTarget.dataset.index }); },
    onRetry(e)  { if (!this.data.disabled) this.triggerEvent('retry',  { index: e.currentTarget.dataset.index }); },
    onPreview(e) {
      const i = e.currentTarget.dataset.index;
      const it = this.data.items[i];
      if (!it || it.uploading || it.error) return;
      // replaceOnTap:单图位已满时点图直接走重选(添加位此时已隐藏,否则换封面要先删再加两步)。
      // 硬限 max===1:多图位 add 事件不带 index,页面无从知道「换哪张」,误用会点谁都触发重选
      if (this.data.replaceOnTap && !this.data.disabled && this.data.max === 1 && this.data.items.length >= 1) {
        this.triggerEvent('add');
        return;
      }
      this.triggerEvent('preview', { index: i, url: it.url });
    },
  },
});
