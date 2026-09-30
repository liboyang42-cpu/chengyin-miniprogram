const cyLoading = require('../../utils/loading.js');
const toast = require('../../utils/toast.js');
const app = getApp();
const { isRecordList } = require('../../utils/response-shape.js');
const { isValidMobile } = require('../../utils/form-state.js');

function boundPhoneFromResponse(res) {
  if (!res) return '';
  var candidates = [];
  if (typeof res.data === 'string') candidates.push(res.data);
  if (res.data && typeof res.data === 'object' && typeof res.data.phone === 'string') {
    candidates.push(res.data.phone);
  }
  if (typeof res.msg === 'string') candidates.push(res.msg);
  for (var i = 0; i < candidates.length; i++) {
    var phone = String(candidates[i]).trim();
    if (isValidMobile(phone)) return phone;
  }
  return '';
}

function maskPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  return digits.slice(0, 3) + '****' + digits.slice(-4);
}
Page({

  /**
   * 页面的初始数据
   */
  data: {
    // 自定义导航:顶栏高度 = 状态栏 + 导航条,页面自留同高占位,内容不被顶栏压住
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    popDavid: false,
    popDavid2: false,
    popDavid3: false,
    popDavid4: false,
    userInfo: {
      name: '',
      introduction: '',
      website: '',
      caseIntroducton: '',
      avatar: '',
      tag_ids: '',
      casePics: '', // 个人项目图片链接字符串
      wechat: '',
      phone: ''
    },
    phoneMasked: '',
    casePicsList: [], // 个人项目图片数组
    tempCasePics: [], // 临时个人项目图片数组（编辑时使用）
    tempCaseIntroducton: '', // 临时个人项目描述
    tempWechat: '', // 临时微信二维码
    tempIntroduction: '', // 城市签名草稿；完成前不写回 userInfo
    tempName: '', // 昵称草稿；完成前不写回 userInfo

    // 活动类型选择 - 多选相关
    selectedCategoryIds: [], // 选中的分类ID数组
    selectedCategoryNames: [], // 选中的分类名称数组
    categorySheetVisible: false,
    categorySheetIds: '',
    selectedCategoryNamesStr: '', // 选中的分类名称字符串，用于显示
    categoryList: [],
    canSave: false,
    loading: true,
    refreshing: false,
    loaded: false,
    loadError: '',
    loadErrorKind: 'network',
    loadErrorSub: '',
    saving: false,
    saveError: '',
    saveSucceeded: false,
    saveSteps: ['保存资料'],
  },

  //个人介绍
  openPop() {
    this.setData({
      popDavid: true,
      tempIntroduction: this.data.userInfo.introduction || ''
    })
  },
  //取消
  cancel() {
    this.setData({
      popDavid: false
    })
  },
  //完成
  confirm() {
    this.setData({
      popDavid: false,
      'userInfo.introduction': this.data.tempIntroduction
    }, () => this.refreshSaveState())
  },

  //个人项目
  openPop2() {
    this.setData({
      popDavid2: true,
      tempCasePics: [...this.data.casePicsList], // 复制当前图片数组
      tempCaseIntroducton: this.data.userInfo.caseIntroducton
    })
  },
  //取消
  cancel2() {
    this.setData({
      popDavid2: false
    })
  },
  //完成
  confirm2() {
    // 更新个人项目图片和描述
    const casePicsString = this.data.tempCasePics.join(';');
    this.setData({
      popDavid2: false,
      casePicsList: [...this.data.tempCasePics],
      'userInfo.casePics': casePicsString,
      'userInfo.caseIntroducton': this.data.tempCaseIntroducton
    })
  },

  //个人微信二维码
  openPop3() {
    this.setData({
      popDavid3: true,
      tempWechat: this.data.userInfo.wechat
    })
  },
  //取消
  cancel3() {
    this.setData({
      popDavid3: false
    })
  },
  //完成
  confirm3() {
    this.setData({
      popDavid3: false,
      'userInfo.wechat': this.data.tempWechat
    })
  },

  //个人名称
  openPop4() {
    this.setData({
      popDavid4: true,
      tempName: this.data.userInfo.name || ''
    })
  },
  //取消
  cancel4() {
    this.setData({
      popDavid4: false
    })
  },
  //完成
  confirm4() {
    this.setData({
      popDavid4: false,
      'userInfo.name': this.data.tempName
    }, () => this.refreshSaveState())
  },

  // 上传个人项目图片
  uploadCasePics: function() {
    const that = this;
    const remainingCount = 9 - that.data.tempCasePics.length;
    
    if (remainingCount <= 0) {
      app.tips('最多只能上传9张图片');
      return;
    }

    app.chooseImage(function(res) {
      const newPics = [...that.data.tempCasePics, ...res];
      that.setData({
        tempCasePics: newPics
      });
    }, remainingCount);
  },

  // 删除个人项目图片
  deleteCasePic: function(e) {
    const index = e.currentTarget.dataset.index;
    const tempCasePics = [...this.data.tempCasePics];
    tempCasePics.splice(index, 1);
    this.setData({
      tempCasePics: tempCasePics
    });
  },
  removeCategory: function (e) {
    const categoryId = parseInt(e.currentTarget.dataset.id);
    const that = this;

    // 从 selectedCategoryIds 中移除
    const newSelectedIds = that.data.selectedCategoryIds.filter(id => id !== categoryId);

    // 从 selectedCategoryNames 中移除对应的名称
    const newSelectedNames = that.data.selectedCategoryNames.filter((name, index) => {
      return that.data.selectedCategoryIds[index] !== categoryId;
    });

    // 从 categoryList 中移除（更新显示的分类列表）
    const newCategoryList = that.data.categoryList.filter(item => item.id !== categoryId);

    that.setData({
      selectedCategoryIds: newSelectedIds,
      selectedCategoryNames: newSelectedNames,
      categoryList: newCategoryList,
      'formData.activityCategoryids': newSelectedIds.join(',')
    });

    // console.log('移除分类后:', {
//       selectedIds: newSelectedIds,
//       selectedNames: newSelectedNames,
//       categoryList: newCategoryList
//     });

    toast.success('移除成功', { duration: 1000 });
  },

  // 上传微信二维码
  uploadWechat: function() {
    const that = this;
    
    app.chooseImage(function(res) {
      that.setData({
        tempWechat: res[0]
      });
    }, 1);
  },

  // 删除微信二维码
  deleteWechat: function() {
    this.setData({
      tempWechat: ''
    });
  },

  // 个人项目描述输入变化
  onCaseIntroductonChange: function(e) {
    this.setData({
      tempCaseIntroducton: e.detail.value
    });
  },

  // 分类选择弹窗化(2026-07-31):半屏 cy-category-sheet + 事件回传,不再跳转独立页面
  navigateToCategorySelect: function () {
    this.setData({
      categorySheetVisible: true,
      categorySheetIds: this.data.selectedCategoryIds.join(','),
    });
  },

  onCategorySelect: function (e) {
    this.updateCategorySelection(e.detail.selectedIds, e.detail.selectedCategories);
  },

  onCategorySheetClose: function () {
    this.setData({ categorySheetVisible: false });
  },

  // 从分类选择弹窗回调更新选择 - 需要同时接收ID和名称
  updateCategorySelection: function (selectedIds, selectedCategories) {
    const that = this;

    const selectedCategoryIds = selectedIds || [];
    const selectedCategoryNames = selectedCategories ? selectedCategories.map(item => item.categoryName) : [];
    const selectedCategoryNamesStr = selectedCategoryNames.join('，');

    // 更新 categoryList 数组（这是您主要需要的）
    that.setData({
      selectedCategoryIds: selectedCategoryIds,
      selectedCategoryNames: selectedCategoryNames,
      selectedCategoryNamesStr: selectedCategoryNamesStr,
      // 更新 categoryList 数组
      categoryList: selectedCategories || []
    });

  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    var that = this
    this._unloaded = false;
    that.getUserData()
  },

  onUnload() {
    this._unloaded = true;
    this._profileLoading = false;
    if (this._profileReturnTimer) {
      clearTimeout(this._profileReturnTimer);
      this._profileReturnTimer = null;
    }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
 
  },

  // 输入框内容变化处理
  onInputChange: function (e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    if (field === 'introduction') this.setData({ tempIntroduction: value });
    else if (field === 'name') this.setData({ tempName: value });
  },

  refreshSaveState: function () {
    const canSave = !!(this.data.userInfo.name || '').trim();
    if (canSave !== this.data.canSave) this.setData({ canSave });
  },

  retryLoad: function () {
    this.getUserData();
  },

  getUserData: function () {
    if (this._profileLoading) return;
    this._profileLoading = true;
    const that = this;
    const hadLoaded = !!this.data.loaded;
    this.setData({
      loading: !hadLoaded,
      refreshing: hadLoaded,
      loadError: '',
      loadErrorSub: ''
    });
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      autoErrorToast: hadLoaded,   // 从未读到过 = auto-back 半屏讲原因,不叠 toast
      data: {
        member_id: app.getUserID()
      },
      method: "POST",
      success: function (res) {
        if (that._unloaded) return;
        that._profileLoading = false;
        if (res && res.code == "200" && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          // 处理个人项目图片字符串转数组
          let casePicsList = [];
          if (typeof res.data.casePics === 'string' && res.data.casePics.trim() !== '') {
            casePicsList = res.data.casePics.split(';').filter(url => url.trim() !== '');
          }

          that.setData({
            userInfo: {
              ...that.data.userInfo,
              ...res.data
            },
            phoneMasked: maskPhone(res.data.phone),
            casePicsList: casePicsList,
            loading: false,
            refreshing: false,
            loaded: true,
            loadError: '',
            loadErrorSub: ''
          }, () => that.refreshSaveState());

          if (isRecordList(res.data.sysCategoryList) && res.data.sysCategoryList.length > 0) {
            const selectedIds = res.data.sysCategoryList.map(item => item.id);
            const selectedNames = res.data.sysCategoryList.map(item => item.categoryName);
            const selectedNamesStr = selectedNames.join('，');

            that.setData({
              categoryList: res.data.sysCategoryList,
              selectedCategoryIds: selectedIds,
              selectedCategoryNames: selectedNames,
              selectedCategoryNamesStr: selectedNamesStr
            });
          }

        } else {
          that.setData({
            loading: false,
            refreshing: false,
            loadError: hadLoaded ? '' : '资料暂时不可用',   // 有旧资料时静默降级,wxml 只在 !loaded 渲染
            loadErrorKind: 'data',
            loadErrorSub: hadLoaded ? '' : ((res && res.msg) || '请稍后重新加载')
          });
        }
        cyLoading.hide();
      },
      fail: function (res) {
        if (that._unloaded) return;
        that._profileLoading = false;
        that.setData({
          loading: false,
          refreshing: false,
          loadError: hadLoaded ? '' : '网络没连上',   // 同上:有旧资料时静默
          loadErrorKind: 'network',
          loadErrorSub: hadLoaded ? '' : '检查网络连接后重试'
        });
        cyLoading.hide();
      }
    })
  },

  saveInfo: function () {
    const that = this;
    const userInfo = this.data.userInfo;
    if (!this.data.canSave || this.data.saving || this.data.saveSucceeded) return;

    // 基本验证
    if (!userInfo.name || userInfo.name.trim() === '') {
      app.tips('请输入姓名');
      return;
    }

    const data = {
      name: userInfo.name,
      avatar: userInfo.avatar,
      introduction: userInfo.introduction,
      website: userInfo.website,
      caseIntroducton: userInfo.caseIntroducton,
      casePics: userInfo.casePics, // 个人项目图片字符串
      wechat: userInfo.wechat, // 微信二维码
      tagIds: this.data.selectedCategoryIds.join(',')
    };

    this.setData({ saving: true, saveError: '', saveSucceeded: false });

    app.sendRequest({
      url: '/api/user/update',
      data: JSON.stringify(data),
      method: "POST",
      header: {
        'Content-Type': 'application/json'
      },
      success: function (res) {
        if (that._unloaded) return;
        if (res.code == "200") {
          that.setData({ saving: false, saveError: '', saveSucceeded: true });
          toast.success('资料已保存', { duration: 2000 });
          that._profileReturnTimer = setTimeout(() => {
            that._profileReturnTimer = null;
            if (that._unloaded) return;
            that.exitPage();
          }, 2000);
        } else {
          that.setData({
            saving: false,
            saveError: res.msg || '资料暂时没有保存，请重试'
          });
        }
      },
      fail: function (res) {
        if (that._unloaded) return;
        that.setData({ saving: false, saveError: '网络没连上，请检查后重试' });
      }
    });
  },

  exitPage: function () {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/member/index/index' });
  },

  uploadPic() {
    let that = this;
    app.chooseImage(function (res) {
      that.setData({
        'userInfo.avatar': res[0]
      });
    }, 1, { crop: true, cropScale: '1:1' });
  },

  getPhoneNumber(e) {
    const that = this;
    if (!e || !e.detail || e.detail.errMsg !== 'getPhoneNumber:ok') {
      toast('您已取消授权');
      return;
    }
    const code = e.detail.code;
    if (!code) {
      toast('获取手机号失败');
      return;
    }
    cyLoading.show('获取中...');
    app.sendRequest({
      url: '/api/getwxbindphone',
      method: 'POST',
      data: { code: code },
      success(res) {
        cyLoading.hide();
        if (res.code == '200') {
          const phone = boundPhoneFromResponse(res);
          if (!phone) {
            toast(res.msg || '获取手机号失败');
            return;
          }
          that.setData({
            'userInfo.phone': phone,
            phoneMasked: maskPhone(phone)
          });
        } else {
          toast(res.msg || '获取手机号失败');
        }
      },
      fail() {
        cyLoading.hide();
        toast('网络错误，请重试');
      }
    });
  },
})
