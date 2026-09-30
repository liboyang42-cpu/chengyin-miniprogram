// cy-category-sheet · 半屏分类选择弹窗(2026-07-31,弹窗化收口 pages/publish/biaoqian)。
// 复用 /api/category/list 接口 + 页面既有的 updateCategorySelection(selectedIds, selectedCategories)
// 回调形状——发起页不用改接收逻辑,只把 wx.navigateTo 换成显示本组件 + 监听 'select' 事件。
// 2026-09-06:pages/publish/biaoqian 路由页已删,分类选择只走本组件。
const toast = require('../../../utils/toast.js');
const { resolveCategoryIcon } = require('../../../utils/category-icon.js');
const app = getApp();

Component({
  properties: {
    show: { type: Boolean, value: false },
    type: { type: Number, value: 0 },   // 对应 biaoqian 的 type:1=行业类型/2=活动分类/4=玩法类别 等
    num: { type: Number, value: 0 },    // 最多可选数量,0=不限
    ids: { type: String, value: '' },   // 预选中的分类 id,逗号分隔(对齐旧页 URL 参数形状)
  },
  data: {
    categoryList: [],
    selectedIds: [],
    loaded: false,
    loadError: '', // A-08:失败态与「真·无分类」区分,弹层内给 inline-error + 重试
  },
  observers: {
    show(v) {
      if (v) this.getCategoryList();
    },
  },
  methods: {
    getCategoryList() {
      const that = this;
      this.setData({ loaded: false, loadError: '' });
      app.sendRequest({
        hideLoading: true,
        silentError: true, // 失败在弹层内给 inline-error + 重试(A-08),关掉通道自动 toast 防双弹
        url: '/api/category/list',
        method: 'POST',
        data: { type: this.data.type, parentid: 0 },
        success(res) {
          if (res.code == '200' && res.data && res.data.length > 0) {
            // UI-13:展示层按 categoryName 映射 cy-icon(iconName);item.icon 仍是后端原值,
            // onSave 回传给调用方的 selectedCategories 形状不变。
            const list = res.data.map((item) => Object.assign({}, item, {
              iconName: resolveCategoryIcon(item && item.categoryName),
            }));
            that.setData({ categoryList: that.processSelectedCategories(list), loaded: true, loadError: '' });
          } else if (res.code == '200') {
            // 服务端确认没有分类:走既有空态;不能和「加载失败」混为一谈
            that.setData({ categoryList: [], loaded: true, loadError: '' });
          } else {
            that.setData({
              categoryList: [],
              loaded: false,
              loadError: app.getRequestErrorMessage(res, '分类没能加载出来'),
            });
          }
        },
        fail(res) {
          that.setData({
            categoryList: [],
            loaded: false,
            loadError: app.getRequestErrorMessage(res, '分类没能加载出来'),
          });
        },
      });
    },

    processSelectedCategories(categories) {
      const ids = this.data.ids;
      const num = this.data.num;
      if (!ids) { this.setData({ selectedIds: [] }); return categories; }
      const selectedIdsArray = ids.split(',').filter(Boolean).map((id) => parseInt(id.trim(), 10));
      this.setData({ selectedIds: selectedIdsArray });
      return categories.map((item) => {
        item.checked = selectedIdsArray.includes(item.id);
        item.disabled = num > 0 && selectedIdsArray.length >= num && !item.checked;
        return item;
      });
    },

    toggleCategory(e) {
      const categoryId = parseInt(e.currentTarget.dataset.id, 10);
      const categoryList = this.data.categoryList;
      const selectedIds = [...this.data.selectedIds];
      const num = this.data.num;

      const idx = categoryList.findIndex((item) => item.id === categoryId);
      if (idx === -1) return;

      if (categoryList[idx].disabled) {
        toast(`最多只能选择 ${num} 个分类`);
        return;
      }

      const isSelected = categoryList[idx].checked;
      if (num > 0 && !isSelected && selectedIds.length >= num) {
        toast(`最多只能选择 ${num} 个分类`);
        return;
      }

      categoryList[idx].checked = !isSelected;
      if (isSelected) {
        const i = selectedIds.indexOf(categoryId);
        if (i > -1) selectedIds.splice(i, 1);
      } else if (!selectedIds.includes(categoryId)) {
        selectedIds.push(categoryId);
      }

      if (num > 0) {
        categoryList.forEach((item) => { item.disabled = selectedIds.length >= num && !item.checked; });
      }

      this.setData({ categoryList, selectedIds });
    },

    onSave() {
      const num = this.data.num;
      const selectedIds = this.data.selectedIds;
      if (num > 0 && selectedIds.length > num) {
        toast(`最多只能选择 ${num} 个分类`);
        return;
      }
      const selectedCategories = [];
      this.data.categoryList.forEach((item) => {
        if (selectedIds.includes(item.id)) {
          selectedCategories.push({ id: item.id, categoryName: item.categoryName, icon: item.icon || '/images/icon_cat2.png' });
        }
      });
      this.triggerEvent('select', { selectedIds, selectedCategories });
      this.onClose();
    },

    onClose() {
      this.triggerEvent('close');
    },
  },
});
