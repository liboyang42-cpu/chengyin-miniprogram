/**
 * 带队场次只核销主题票：旧码是 JSON 包装，动态码原样交给后端验签。
 * 不在小程序解析动态码 type，避免把客户端声明当作资金链路的判据。
 */
function resolveLeadMemberTicket(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { code: '', error: '二维码格式错误' };
  if (value.charAt(0) !== '{') return { code: value, error: '' };
  try {
    const ticket = JSON.parse(value);
    if (!ticket || !ticket.code) return { code: '', error: '二维码格式错误' };
    if (ticket.type && ticket.type !== 'topic') return { code: '', error: '本场次只可核销主题票' };
    return { code: String(ticket.code).trim(), error: '' };
  } catch (e) {
    return { code: '', error: '二维码格式错误' };
  }
}

module.exports = { resolveLeadMemberTicket };
