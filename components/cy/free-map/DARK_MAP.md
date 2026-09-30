# free-map 暗色底图接入说明(S9)

## 现状
`free-map` 目前用的是腾讯默认**浅色**底图。spec 要暗色,但暗色需要在**腾讯位置服务(LBS)控制台**
建一个"个性化地图样式",这是一步**外部依赖**,必须由项目负责人(不是代码)在控制台完成。

本次改动只做了**代码侧预留**:`subkey` / `layerStyle` 两个属性已经从
`free-map` 组件 → `pages/play` 打通,默认值让底图**逐字节**保持现在的样子。控制台建好样式后,
只需要把两个值填进一个地方,不用再碰其它代码。

## 已核实的微信 `<map>` 属性(不是猜的)

查了微信官方 `<map>` 组件文档(developers.weixin.qq.com/miniprogram/dev/component/map.html),
个性化地图用这两个属性:

| WXML 属性名 | 类型 | 官方默认值 | 最低基础库版本 | 作用 |
|---|---|---|---|---|
| `subkey` | String | `''` | 2.3.0 | 腾讯 LBS 控制台申请的"个性化地图"专用 key,**不支持运行时动态修改**(改了要重新渲染 map 才生效) |
| `layer-style` | Number | `1` | 2.3.0 | 个性化样式编号(控制台建好样式后分配的 style ID) |

同一份配置也能通过 `<map>` 的统一 `setting` 对象下发(驼峰名 `subKey` / `layerStyle`),
官方文档给的默认值同样是 `subKey:''` / `layerStyle:1`——两处默认值一致,互相印证。

本项目 `chengyinhub-xcx/project.config.json` 里 `libVersion` 是 `3.7.3`,远高于 2.3.0,版本上没有障碍。

**关键点:官方默认值是 `layerStyle: 1`,不是 0。** 如果代码把默认值写成 0,而 0 不是一个已定义的
样式编号,底图可能不会跟"不传这个属性"时完全一致——这就破坏了回归安全。所以本次代码把默认值
定成 `subkey:''` / `layerStyle:1`,和微信 `<map>` 组件自己的默认值完全对齐。

## 代码预留改了什么

1. `components/cy/free-map/index.js`:properties 加了 `subkey`(String,默认 `''`)、
   `layerStyle`(Number,默认 `1`),纯透传,没有 observer/副作用。
2. `components/cy/free-map/index.wxml`:`<map>` 标签加了
   `subkey="{{subkey}}" layer-style="{{layerStyle}}"`。
3. `pages/play/index.js`:顶部加了一个集中配置常量

   ```js
   const MAP_DARK = { subkey: '', layerStyle: 1 };
   ```

   `data` 里加了 `fmSubkey: MAP_DARK.subkey, fmLayerStyle: MAP_DARK.layerStyle`。
4. `pages/play/index.wxml`:`<free-map>` 标签加了
   `subkey="{{fmSubkey}}" layer-style="{{fmLayerStyle}}"`。

默认值 `subkey:''` / `layerStyle:1` 时,`<map>` 收到的属性值和微信组件自身的默认值一模一样,
渲染出来的底图和这次改动之前没有任何差别(回归安全)。

## 用户接下来要做的事(真正点亮暗色底图)

1. 登录腾讯位置服务控制台(https://lbs.qq.com/),在自己的应用下新建一个"个性化地图样式",
   选 Monochrome/暗色基调,按需调整道路、POI、水系等图层颜色,发布。
2. 控制台会给这个样式分配一个 **styleId**(数字),同时你的小程序在 LBS 控制台需要绑定/申请
   一个**个性化地图 subkey**(和小程序 `AppID` 关联,不是普通的 REST API key)。
3. 把这两个值填进 `pages/play/index.js` 顶部的 `MAP_DARK` 常量:

   ```js
   const MAP_DARK = { subkey: '你的subkey', layerStyle: 你的styleId };
   ```

4. 保存、重新编译/预览——`pages/play` 的地图会用新样式渲染。因为 `subkey` 不支持运行时动态改,
   改完这个常量后要让页面重新加载(冷启动或重新进入该页面),不能指望热更新生效。

## roam 同坑(本任务未改 roam,写在这里供用户自行套用)

`pages/roam/index.wxml` 里也有一个独立的原生 `<map>`(不经过 `free-map` 组件)。**本任务没有碰
`pages/roam/*` 任何文件**——用户正在那边并行改动约 1000 行未提交代码,动了会冲掉。

同样的道理可以直接套到 roam 自己的 `<map>` 上:

- 给 roam 的 `<map>` 标签加 `subkey="{{...}}" layer-style="{{...}}"`(两个属性名和这里完全一样,
  官方默认值同样是 `''` / `1`,回归安全逻辑不变)。
- roam 页面自己维护一份 `subkey`/`layerStyle` 的 data 字段(或者也 require 这份 `MAP_DARK` 常量,
  如果想和 play 共用同一个暗色样式的话)。
- 同一个控制台样式(同一个 subkey + styleId)可以被 play 和 roam 两处地图同时复用,不需要建两份。

用户可以在自己方便的时候把这段逻辑加到 roam 里,不影响这次提交。
