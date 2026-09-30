const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function loadBannerContract() {
  const target = process.env.HOME_ACTION_BANNER_MODULE
    || path.join(ROOT, 'utils/index/home-action-banner.js')
  delete require.cache[require.resolve(target)]
  return require(target)
}

test('首页第一张是品牌封面，其后固定展示俱乐部、商家、活动三条行动 Banner', () => {
  const { buildHomeActionBanners } = loadBannerContract()
  const banners = buildHomeActionBanners()

  assert.equal(banners[0].id, 'home-cover', '品牌封面必须排在第一位')
  assert.equal(banners[0].poster, '/images/home-banner-cover.png')
  assert.equal(banners[0].route, undefined, '封面是纯展示，不许挂路由')
  assert.equal(banners[0].title, undefined, '封面文案烧在图里，不叠 wxml 文字')

  const actions = banners.slice(1)
  assert.deepEqual(actions.map((item) => item.title), [
    '成为俱乐部',
    '成为商家',
    '和朋友报名活动',
  ])
  assert.deepEqual(actions.map((item) => item.route), [
    '/pages/club/apply/index',
    '/pages/merchant/apply/index',
    '/pages/activity/list/index',
  ])
  assert.deepEqual(actions.map((item) => item.motionSrc), [
    'https://api.example.invalid/prod-api/profile/home-banners/home-banner-club.gif',
    'https://api.example.invalid/prod-api/profile/home-banners/home-banner-merchant.gif',
    'https://api.example.invalid/prod-api/profile/home-banners/home-banner-friends.gif',
  ])
  assert.equal(new Set(actions.map((item) => item.motionSrc)).size, 3, '三张 Banner 必须使用三段不同动图')
  assert.deepEqual(actions.map((item) => item.poster), [
    '/images/home-banner-club.jpg',
    '/images/home-banner-merchant.jpg',
    '/images/home-banner-friends.jpg',
  ])
})

test('品牌封面满宽平铺、不叠文案、也不冒充可点按钮', () => {
  const wxml = read('pages/index/index.wxml')
  const wxss = read('pages/index/index.wxss')
  const hero = wxml.slice(wxml.indexOf('id="sec-hero"'), wxml.indexOf('id="sec-reco"'))

  assert.match(hero, /wx:if="\{\{item\._type === 'cover'\}\}"[^>]*class="v3-hero-art"[^>]*src="\{\{item\.poster\}\}"/,
    '封面走独立节点，不复用行动 Banner 那套居中动图布局')
  assert.match(hero, /class="v3-hero-copy" wx:if="\{\{item\.title\}\}"/,
    '没有 title 的 Banner 不渲染空文案块')
  assert.match(hero, /aria-role="\{\{item\.route \? 'button' : 'img'\}\}"/,
    '不可点的封面不能被读屏念成按钮')
  assert.match(wxss, /\.v3-hero-art\s*\{[^}]*width:\s*100%/, '封面满宽')
})

test('三张 Banner 自动循环轮换，减少动态效果时停止自动切换', () => {
  const wxml = read('pages/index/index.wxml')
  const hero = wxml.slice(wxml.indexOf('id="sec-hero"'), wxml.indexOf('id="sec-reco"'))

  assert.match(hero, /circular="\{\{heroBannerList\.length > 1\}\}" autoplay="\{\{!reducedMotion\}\}"/)
  assert.match(hero, /interval="5500" duration="450"/)
})

test('整张 Banner 点击调用真实 navigateTo，不引入 Banner 内按钮', () => {
  const { buildHomeActionBanners, openHomeActionBanner } = loadBannerContract()
  const calls = []
  const wxApi = { navigateTo: ({ url }) => calls.push(url) }

  const banners = buildHomeActionBanners()
  assert.equal(openHomeActionBanner(wxApi, banners[0]), false, '品牌封面点了不跳任何页')
  banners.slice(1).forEach((item) => {
    assert.equal(openHomeActionBanner(wxApi, item), true)
  })
  assert.deepEqual(calls, [
    '/pages/club/apply/index',
    '/pages/merchant/apply/index',
    '/pages/activity/list/index',
  ])

  const wxml = read('pages/index/index.wxml')
  const hero = wxml.slice(wxml.indexOf('id="sec-hero"'), wxml.indexOf('id="sec-reco"'))
  assert.doesNotMatch(hero, /<button\b/, 'Banner 内不能出现按钮')
  assert.match(hero, /bindtap="onHeroBannerTap"/)
})

test('动态头像使用包内 GIF 直接循环；减少动态效果时切换为静态海报', () => {
  const wxml = read('pages/index/index.wxml')
  const wxss = read('pages/index/index.wxss')
  const hero = wxml.slice(wxml.indexOf('id="sec-hero"'), wxml.indexOf('id="sec-reco"'))

  assert.match(hero, /<image[^>]*class="v3-hero-motion"[^>]*src="\{\{reducedMotion \? item\.poster : item\.motionSrc\}\}"[^>]*mode="aspectFit"/)
  assert.doesNotMatch(hero, /<video\b|bindplay=|binderror=/)
  assert.match(wxss, /\.v3-hero-motion[\s\S]*pointer-events:\s*none/)
})

// 产物入库就得防静默漂移 —— 对齐仓里既有先例 ci/render_template_covers.py 的做法：
// CI 侧不重渲(不需要 ffmpeg)，只校验「已提交产物 ↔ manifest」+「生成脚本 ↔ manifest」。
// 后一条专治「改了生成脚本却忘了重跑」：脚本变了 sha256 就对不上，直接红。
function assertBannerManifest(readFile) {
  const dir = path.join(ROOT, '../assets/covers/home-banners')
  const manifest = JSON.parse(readFile(path.join(dir, 'manifest.json'), 'utf8'))
  const digest = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

  Object.entries(manifest.assets).forEach(([name, meta]) => {
    const file = name.endsWith('.jpg')
      ? path.join(ROOT, 'images', name)
      : path.join(dir, name)
    assert.equal(digest(readFile(file)), meta.sha256,
      `${name} 与 manifest 不符：产物被手改过，或改完没重跑生成器`)
  })
  Object.entries(manifest.producers).forEach(([name, sha]) => {
    assert.equal(digest(readFile(path.join(dir, name))), sha,
      `${name} 改过但没重跑生成器：manifest.producers 里的 sha256 对不上`)
  })
  return Object.keys(manifest.assets).length
}

test('Banner 产物与生成脚本都对得上 manifest', () => {
  assert.ok(assertBannerManifest(fs.readFileSync) >= 9)
})

test('manifest 契约具备红控：产物被改、或脚本改了没重渲，都要判红', () => {
  const tamper = (target) => (file, enc) => {
    const real = fs.readFileSync(file, enc)
    return path.basename(file) === target ? Buffer.concat([Buffer.from(real), Buffer.from('x')]) : real
  }
  assert.throws(() => assertBannerManifest(tamper('home-banner-club.gif')))
  assert.throws(() => assertBannerManifest(tamper('generate.py')))
})

test('三段本地 GIF 均为多帧、内容不同且总量保持在主包预算内', () => {
  const assets = [
    '../assets/covers/home-banners/home-banner-club.gif',
    '../assets/covers/home-banners/home-banner-merchant.gif',
    '../assets/covers/home-banners/home-banner-friends.gif',
  ]
  const digests = []
  let totalBytes = 0

  assets.forEach((rel) => {
    const asset = path.join(ROOT, rel)
    assert.ok(fs.existsSync(asset), `${rel} 必须随小程序主包交付`)
    const bytes = fs.readFileSync(asset)
    assert.match(bytes.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/)
    const frameMarkers = bytes.toString('hex').match(/21f9/g) || []
    assert.ok(frameMarkers.length > 20, `${rel} 必须包含足够帧数，实际 ${frameMarkers.length}`)
    assert.ok(bytes.length < 900 * 1024, `${rel} 单张不得超过 900KB，实际 ${bytes.length}`)
    totalBytes += bytes.length
    digests.push(crypto.createHash('sha256').update(bytes).digest('hex'))
  })

  assert.equal(new Set(digests).size, 3, '三段 GIF 的二进制内容必须互不相同')
  // 2026-08-26 从 850KB 抬到 1.75MB，是明确的产品取舍，不是为了让改动过关。
  // 俱乐部这张改用真 Memoji 的整段编排(Apple Fitness「共享体能训练」那支)，单张 ~805KB；
  // 摆在桌上的更省方案是自绘重制版(三张能留在旧线内)，做出来和参考稿差距明显，用户选了前者。
  // ⚠️ 线定在「当前 1.43MB + 约两成余量」，不是随手取个大数：上限如果高到任何现实回归
  // 都撞不到，它就只是块假招牌 —— 本仓栽过这种跟头。单张 900KB 那条才是真正咬合的
  // (俱乐部占 89%)；总量线兜的是「三张一起涨」。
  assert.ok(totalBytes < 1750 * 1024, `三段 GIF 总量必须小于 1.75MB，实际 ${totalBytes}`)

  // 上面那条只管这三个文件，读起来像「主包预算」其实什么都没守住 —— 真正会把发布卡死的
  // 是主包总字节(微信限 2MB)。这里直接按 project.config.json 的 packOptions.ignore
  // 与 app.json 的分包根算一遍真实主包体积，超了就红。
  const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'))
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const ignoreFolders = new Set((projectConfig.packOptions?.ignore || [])
    .filter((i) => i.type === 'folder').map((i) => i.value.replace(/\/$/, '')))
  const ignoreFiles = new Set((projectConfig.packOptions?.ignore || [])
    .filter((i) => i.type === 'file').map((i) => i.value))
  const subRoots = (appJson.subPackages || appJson.subpackages || [])
    .map((s) => s.root.replace(/\/$/, ''))

  // 收文件清单而不是只累加总数 —— 下面要按「资源 / 代码」分开算两条棘轮。
  const mainPackageFiles = (function walk(dir, rel, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const top = childRel.split('/')[0]
        if (top.startsWith('.') || ignoreFolders.has(top)) continue
        if (subRoots.some((r) => childRel === r || childRel.startsWith(`${r}/`))) continue
        walk(path.join(dir, entry.name), childRel, out)
      } else if (entry.isFile() && !ignoreFiles.has(childRel)) {
        // ⚠️ 只收真实文件:worker worktree 里 node_modules 可能是**符号链接**(指向主仓),
        //    isDirectory() 对链接为 false 会把它当成文件,后面的 readFileSync 直接 EISDIR。
        //    链接本就不是打包内容(微信也不跟链接),跳过不影响主包字节口径。
        out.push({ rel: childRel, size: fs.statSync(path.join(dir, entry.name)).size })
      }
    }
    return out
  })(ROOT, '', [])
  const mainPackageBytes = mainPackageFiles.reduce((sum, item) => sum + item.size, 0)

  // 封面与动效 GIF 已搬去服务端静态目录后,主包原始字节 6.48MB → 2.52MB。
  //
  // ⚠️ 2026-08-30 拆成「资源」与「总量」两条,原因是单一数字把两种完全不同的增长
  //    混在一起,反而没守住它自己写的那个目标。原注释说得很清楚:
  //      「量的是未压缩字节;微信上传会压代码(图片不会)」
  //      「再往上涨说明**又有人往包里塞资源**了」
  //    ——「塞资源」才是要拦的,而**一个总量数字分不出代码和图片**。
  //    结果是:加 20K 图片(不压缩、真的会顶到微信 2MB)和加 20K JS(会压缩)
  //    被同等对待。master 已经站在 2.99MB,于是任何一个正常写代码的 PR 都被拦住,
  //    而真正危险的「塞图」反倒可以借着别人腾出来的空间悄悄进来。
  //
  // ⇒ 资源字节钉死在实测值(**只准降**),代码字节给出空间。
  const ASSET_RE = /\.(png|jpg|jpeg|gif|svg|webp|mp3|wav|m4a|ttf|otf|woff2?)$/i
  const assetBytes = mainPackageFiles
    .filter((item) => ASSET_RE.test(item.rel))
    .reduce((sum, item) => sum + item.size, 0)

  /* 资源棘轮:2026-08-30 实测 492334 字节。**只准降,不准升**。
   * 要加图先问:能不能放服务端静态目录 / 能不能挪进分包 / 能不能压。
   * ⚠️ 贴着实测值写,不留余量 —— 留余量就等于把额度提前发给下一次悄悄增长
   *   (同 success-toast-ratchet 那条的道理)。
   *
   * 2026-09-02 重新贴实测 515728:首页第一张品牌封面 home-banner-cover.png(27763 字节)。
   *   抬法仍是那一条 —— **贴死实测值,不留一个字节余量**,理由写在这里。
   *   ⚠️ 抬幅是 23394 而不是 27763:旧线 492334 本身带着 4369 字节余量(实测才 487965),
   *   这次一并吸收掉。「抬幅=新增文件大小」的直觉在这里不成立,别照着倒推。
   *   为什么不放服务端静态目录(三段 GIF 那样):它是首屏第一眼,远程图会让首页开局空一拍,
   *   而且多一步「记得把图 scp 上 ECS」的人工动作 —— 本仓栽过太多次这种零告警的漏做。
   *   ⚠️ 为什么这么大:前两版用的是 1 倍图(375x812),铺满 375pt 宽等于被放大着显示,
   *   实拍放大后字牌描边明显发糊。现在这版是从 Figma(hHQwsqHYsLAmwDokGh9okO 的
   *   node 603:52「BG/12 碎片文字 · CHENGYIN」)按 @3x 导的 1125x2436,PNG-8 256 色
   *   27763 字节(274 万像素里只有 1026 个与原导出有差异,明显差 5 个)。
   *   ⇒ 这 21KB 买的是「真的清晰」,不是随手放宽。要再省只能降到 @2x(750x1624)。
   *
   * 2026-09-09 重新贴实测 519563:漫游点位的图钉 images/roam-pushpin.png(4104 字节)。
   *   抬幅 3835 而不是 4104 —— 旧线 515728 自己带着 269 字节余量,一并吸收掉。
   *   ⚠️ 为什么必须进主包:图钉是 pages/roam 的地图 marker 素材,而 pages/roam 在**主包**;
   *   放进 subpackageRoam 主包引不到(分包按需下载,首帧就要画的东西不能等下载)。
   *   为什么不放服务端静态目录:marker 图标是开图那一瞬间用 canvas 合成的,远程图要等一次
   *   网络往返,拿不到就整批点位没图标 —— 而且多一步「记得 scp 上 ECS」的人工动作。
   *   ⚠️ 为什么不重画成矢量(那样零字节):用户 9-08 明确否掉了 ——「你的 pin 是要用我的 pin,
   *   不是参考着画」。这 4KB 买的就是那张实物图本身。
   *   已经压到底:原图 132×160 / 27299 字节 → 抠底后按 marker 实绘高度的 2 倍取 96px 高,
   *   PNG-8 24 色 4104 字节。再降只能牺牲清晰度(64px/24 色 = 2525)。
   *
   * 2026-09-16 重新贴实测 520443:帖文卡的两枚小图标 images/icon_jia.png(214 B)+ images/icon_rz.png(666 B)= 880 B。
   *   ⚠️ 为什么必须进主包:它们被 components/cy/post-card(**主包组件**)引用。原先放在 pages/square/images/,
   *   而 app.json 里 pages/square 是**分包 root** —— 主包引分包资源,真机按需加载时拿不到(与同日修掉的
   *   「scene-deep-link 主包引分包组件」同一病形)。
   *   为什么不放服务端静态目录:关注「+」与认证角标是帖文卡首帧就要画的东西,远程图要等网络往返,
   *   列表滚动时会一格格闪出来;而且多一步「记得 scp 上 ECS」的人工动作。
   *   为什么不复用主包已有的 images/add.png(247 B):那是 40×40,这里要的是 18×18 小号「+」,
   *   换过去比例与描边粗细都会变 —— 未经截图验证不能替,宁可多 214 B。
   *   已经小到底:两张都是 PNG-8,18×18 / 24×24 的原生尺寸,没有再压的空间。
   *   ⚠️ 这条是 postcard-img-0916 自带的红,在 merge-union 合拢时暴露;当初修主包引分包时漏跑了本测试。 */
  const ASSET_CEILING = 520443
  assert.ok(assetBytes <= ASSET_CEILING,
    `主包资源 ${assetBytes} 字节 > 棘轮 ${ASSET_CEILING}。`
    + '图片/音频**不会**被微信压缩,是最贵的那部分 —— '
    + '先考虑放服务端静态目录或挪进分包,不要直接调大这个数。')

  /* 总量这一条改成**量压缩后**(2026-09-02)。
   *
   * 原来量的是未压缩字节,棘轮 3.1MB —— 它是「微信真限 2MB 压缩后」的**代理指标**,
   * 而代理指标会漂:master 已经站到 3250312 字节,离 3.1MB 只剩 **274 字节**余量。
   * 任何一个正常的小程序 PR(一个组件 wxss + 一条契约测试就上千字节)都被它拦住,
   * 而实测这个主包 deflate 之后只有 1.33MB —— **离微信真正的 2MB 还有三分之一空间**。
   * 也就是说:它拦住的全是不该拦的,该拦的(真撞 2MB)一次都没拦到过。
   *
   * ⇒ 不再猜,直接量它自己声称要守的那个东西:逐文件 deflate 求和,近似 wxapkg 的 zip 条目。
   *   资源那条棘轮(ASSET_CEILING,只准降)原样保留 —— 图片不压缩,那才是真正贵的部分,
   *   它守的是「有人往包里塞图」,和本条守的「总量撞 2MB」是两回事,不要合并。
   *
   * 线定在 1.75MB:实测 1.33MB + 约三成余量,且仍低于微信 2MB。
   * ⚠️ 留余量的理由与 ASSET_CEILING 那条「贴死实测值」相反,是因为两者性质不同:
   *   资源棘轮防的是**悄悄增长**,贴死才有意义;本条防的是**真的发不出去**,
   *   贴死会把每个正常 PR 都变成红灯(就是刚刚发生的事)。 */
  const deflatedBytes = mainPackageFiles.reduce((sum, item) =>
    sum + zlib.deflateSync(fs.readFileSync(path.join(ROOT, item.rel)), { level: 9 }).length, 0)
  /* ⚠️ 2026-09-04 更正一条错误前提。
   *
   * 上面那段说「微信真限 2MB 压缩后」——**不对**。微信 upload 报的原话是
   *   `main package source size 2115KB exceed max limit 2048KB`
   * 卡的是 **source size(未压缩)**。所以这条量 deflate 的棘轮,守的根本不是它
   * 声称要守的东西:实测主包 2115KB 已经传不上去了,而它一路绿。
   *
   * 但也不能简单改成量未压缩 —— 本地按扩展名遍历得到 3327KB,微信算 2115KB,
   * 差 1.2MB(微信按 app.json 可达性算,本地复刻不了)。**硬凑一个数只会自欺。**
   *
   * ⇒ 现在的分工:
   *   本条 = 增长哨兵,量 deflate(口径稳定、可复现),只防悄悄变大;
   *   真限 2048KB 只有 `cli upload` 能回答 —— 那是唯一的观测,回执(exit 0)不算。
   *   2026-09-04 实测:下沉 28 个组件后主包 2018KB,余量仅 30KB。**下次加东西前先想想它进哪个包。**
   */
  const MAIN_PACKAGE_COMPRESSED_CEILING = 1.75 * 1024 * 1024
  assert.ok(deflatedBytes < MAIN_PACKAGE_COMPRESSED_CEILING,
    `主包压缩后 ${(deflatedBytes / 1048576).toFixed(2)}MB 超过棘轮 `
    + `${(MAIN_PACKAGE_COMPRESSED_CEILING / 1048576).toFixed(2)}MB。`
    + '⚠️ 本条只是增长哨兵;微信卡的是 source size,真限只有 cli upload 能回答。'
    + '先瘦身,或把它挪进分包。')

  // 粗底线:压缩比再差也不该到 4 倍。这条不是发布闸,是「上面那个 deflate 估算本身失灵」的哨兵。
  assert.ok(mainPackageBytes < 8 * 1024 * 1024,
    `主包未压缩 ${(mainPackageBytes / 1048576).toFixed(2)}MB 已经离谱,先查是不是有大文件误入主包`)

  const posterDigests = [
    'images/home-banner-club.jpg',
    'images/home-banner-merchant.jpg',
    'images/home-banner-friends.jpg',
  ].map((rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'))
  assert.equal(new Set(posterDigests).size, 3, '三个静态减弱动效海报也必须是不同人物')
})

test('负控：任一行动路由被改坏时契约必须判红', () => {
  const { buildHomeActionBanners, validateHomeActionBanners } = loadBannerContract()
  const mutated = buildHomeActionBanners()
  mutated[1].route = '/pages/index/index'
  assert.throws(() => validateHomeActionBanners(mutated), /home-action-club/)

  const covered = buildHomeActionBanners()
  covered[0].route = '/pages/index/index'
  assert.throws(() => validateHomeActionBanners(covered), /home-cover/, '给封面偷挂路由也要判红')
})

test('负控：封面掉头判据抽掉 !item.route 后必须真的跳出去', () => {
  const { buildHomeActionBanners, openHomeActionBanner } = loadBannerContract()
  const cover = buildHomeActionBanners()[0]
  const calls = []
  const wxApi = { navigateTo: ({ url }) => calls.push(url) }

  assert.equal(openHomeActionBanner(wxApi, cover), false)
  assert.deepEqual(calls, [], '封面一次 navigateTo 都不该发出')

  // 变异体 = 去掉 !item.route 那半句。undefined === undefined 会放行，
  // 于是它真的会 navigateTo({ url: undefined }) —— 证明上面那条断言不是恒真。
  const naive = (api, item) => {
    const EXPECTED = { 'home-action-club': '/pages/club/apply/index' }
    if (!item || EXPECTED[item.id] !== item.route) return false
    api.navigateTo({ url: item.route })
    return true
  }
  assert.equal(naive(wxApi, cover), true)
  assert.deepEqual(calls, [undefined])
})
