function fromHttpStatusAbnormal(body) {
  const source = body && typeof body === 'object' ? body : {};
  return {
    code: 'fail',
    httpFail: true,
    upstreamCode: source.code == null ? '' : source.code,
    msg: source.msg || '服务暂时不可用',
  };
}

module.exports = { fromHttpStatusAbnormal };
