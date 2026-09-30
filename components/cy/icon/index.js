// cy-icon · 统一 glyph 渲染器(DS §4.5)。图标源 coolicons © Kryston Schwarze,CC BY 4.0(署名)。
// size 只表示 glyph 盒；visible circle / hit target 由语义配对或已登记 exception 决定。
// 用法:<cy-icon name="back" size="32" />;颜色 = currentColor,由父级 color 控制,双主题自动适配。
Component({
  options: { addGlobalClass: true },
  properties: {
    name: { type: String, value: '' },   // 语义名(见 icons.wxss 头部清单)
    size: { type: Number, value: 48 },   // rpx glyph 盒；48 是兼容 fallback，不是独立尺寸档位(DS §4.5)
  },
});
