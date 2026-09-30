const automator = require('miniprogram-automator')
const PROJECT = '/Users/developer/Downloads/chengyin/chengyinhub-xcx'
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

;(async () => {
  console.log('launching...')
  const mp = await automator.launch({ projectPath: PROJECT, cliPath: CLI })
  console.log('launched ok')
  await new Promise(r => setTimeout(r, 5000))

  console.log('reLaunch to topic page...')
  await mp.evaluate(() => {
    return new Promise((resolve) => {
      wx.reLaunch({ url: '/pages/topic/index/index?id=23', success: () => resolve('ok') })
    })
  })
  await new Promise(r => setTimeout(r, 5000))

  console.log('injecting data...')
  await mp.evaluate(() => {
    return new Promise((resolve) => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      page.setData({
        'info.omsTicketList': [
          {
            id: 72, name: '单人票', price: 68,
            mode: 1, meetingPoint: '上海市黄浦区人民广场地铁站1号口', teamSize: 4,
            monthDayTime: '06/01', endMonthDayTime: '06/03',
            startTime: '2026-06-01 09:00', endTime: '2026-06-03 18:00',
            totalStock: 100, remainingInventory: 78
          },
          {
            id: 73, name: '双人票', price: 118,
            mode: 2, teamSize: 0,
            monthDayTime: '06/01', endMonthDayTime: '06/03',
            startTime: '2026-06-01', endTime: '2026-06-30',
            totalStock: 50, remainingInventory: 23
          },
          {
            id: 74, name: '体验票（免费）', price: 0,
            mode: 2, teamSize: 0,
            monthDayTime: '06/01', endMonthDayTime: '06/03',
            startTime: '2026-06-01', endTime: '2026-06-30',
            totalStock: 200, remainingInventory: 156
          }
        ],
        bmShow: true
      }, () => resolve('done'))
    })
  })
  await new Promise(r => setTimeout(r, 800))

  const page = await mp.currentPage()
  const data = await page.data()
  console.log('bmShow =', data.bmShow)
  const tickets = data.info && data.info.omsTicketList
  console.log('tickets count =', tickets ? tickets.length : 0)
  if (tickets && tickets.length) {
    tickets.forEach((t, i) => console.log(`  [${i}] ${t.name}  ¥${t.price}  mode=${t.mode}  stock=${t.remainingInventory}`))
  }
  console.log('\nREADY — new popup design should be showing')
})().catch(e => { console.error('ERR:', e.message); process.exit(1) })
