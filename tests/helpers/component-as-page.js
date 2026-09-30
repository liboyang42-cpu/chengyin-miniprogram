// 若干页面的内容已搬进自定义组件(H01/H02/H09 …),但既有契约测试是按 Page 的形状写的。
// 这里把 Component 的定义摊平成 Page 的形状(data + 方法在同一层,attached→onLoad、
// pageLifetimes.show→onShow),让那些断言逐字不变 —— 换的是承载形式,不是被验的行为。
function flattenComponentToPage(config) {
  return Object.assign(
    {},
    config.methods,
    { data: config.data },
    config.lifetimes && config.lifetimes.attached ? { onLoad: config.lifetimes.attached } : {},
    config.pageLifetimes && config.pageLifetimes.show ? { onShow: config.pageLifetimes.show } : {}
  );
}

/** 装到 global.Component 上,把捕获结果写进 sink[key] */
function installComponentStub(sink, key) {
  global.Component = (config) => { sink[key] = flattenComponentToPage(config); };
}

module.exports = { flattenComponentToPage, installComponentStub };
