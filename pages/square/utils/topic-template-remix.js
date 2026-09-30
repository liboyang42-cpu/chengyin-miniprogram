const toast = require('../../../utils/toast.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');
function remixTopicTemplate(app, topicId) {
  return new Promise((resolve) => {
    app.sendRequest({
      url: '/api/template/topic-template/use',
      method: 'POST',
      data: { id: topicId },
      success(res) {
        const copiedTopicId = res && res.code == '200' && res.data && res.data.topicId
        if (!copiedTopicId) {
          toast(bizFailureMessage(res, '模板改编失败'))
          resolve(false)
          return
        }
        wx.navigateTo({ url: '/pages/publish/fabu/index?id=' + copiedTopicId })
        resolve(true)
      },
      fail() {
        toast('网络错误，请重试')
        resolve(false)
      },
    })
  })
}

module.exports = { remixTopicTemplate }
