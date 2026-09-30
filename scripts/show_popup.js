const automator = require('miniprogram-automator')
const PROJECT = '/Users/developer/Downloads/chengyin/chengyinhub-xcx'
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

;(async () => {
  console.log('launching...')
  const mp = await automator.launch({ projectPath: PROJECT, cliPath: CLI })
  console.log('launched')
  await new Promise(r => setTimeout(r, 5000))

  await mp.evaluate(function() {
    return new Promise(function(resolve) {
      wx.reLaunch({ url: '/pages/topic/index/index?id=23', success: function() { resolve('ok') } })
    })
  })
  console.log('reLaunched to topic 23')
  await new Promise(r => setTimeout(r, 5000))

  await mp.evaluate(function() {
    return new Promise(function(resolve) {
      var pages = getCurrentPages()
      var page = pages[pages.length - 1]
      page.setData({
        'info.omsTicketList': [
          { id: 72, name: '单人票', price: 68, mode: 1, meetingPoint: '上海市黄浦区人民广场地铁站1号口', teamSize: 4, monthDayTime: '06/01', endMonthDayTime: '06/03', totalStock: 100, remainingInventory: 78 },
          { id: 73, name: '双人票', price: 118, mode: 2, monthDayTime: '06/01', endMonthDayTime: '06/03', totalStock: 50, remainingInventory: 23 },
          { id: 74, name: '体验票（免费）', price: 0, mode: 2, monthDayTime: '06/01', endMonthDayTime: '06/03', totalStock: 200, remainingInventory: 156 }
        ],
        bmShow: true
      }, function() { resolve('done') })
    })
  })
  console.log('data injected, popup open')
  await new Promise(r => setTimeout(r, 500))

  var page = await mp.currentPage()
  var data = await page.data()
  console.log('bmShow =', data.bmShow)
  var tickets = data.info && data.info.omsTicketList
  console.log('tickets count =', tickets ? tickets.length : 0)
  console.log('READY - check simulator')
})().catch(function(e) { console.error('ERR:', e.message); process.exit(1) })
