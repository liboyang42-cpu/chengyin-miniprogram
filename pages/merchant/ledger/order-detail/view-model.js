function canonicalCode(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return null;
  return Number(value);
}

function moneyText(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : null;
}

function firstMoney(order) {
  const values = [order.payAmount, order.orderTotalAmount, order.productTotalAmount];
  for (let index = 0; index < values.length; index += 1) {
    const amount = moneyText(values[index]);
    if (amount) return amount;
  }
  return null;
}

function statusOf(order) {
  const aftersale = canonicalCode(order.aftersaleStatus);
  if (aftersale === 2) return { text: '售后处理中', variant: 'danger' };
  if (aftersale === 3) return { text: '退款中', variant: 'danger' };
  if (aftersale === 4) return { text: '退款成功', variant: 'neutral' };
  const status = canonicalCode(order.status);
  const states = {
    0: ['待付款', 'warning'],
    1: ['待处理', 'warning'],
    2: ['已发货', 'info'],
    3: ['待评价', 'info'],
    4: ['已完成', 'success'],
    5: ['已关闭', 'neutral'],
    6: ['无效订单', 'neutral'],
  };
  const state = states[status];
  return state ? { text: state[0], variant: state[1] } : { text: '状态待确认', variant: 'neutral' };
}

function valueRow(key, label, value) {
  if (value === null || value === undefined || value === '') return null;
  return { key, label, value: String(value) };
}

function compact(rows) {
  return rows.filter(Boolean);
}

function shortTime(value) {
  return value ? String(value).slice(0, 16).replace('T', ' ') : '';
}

function buildMerchantOrderDetail(input) {
  const order = input || {};
  const status = statusOf(order);
  const quantity = Number(order.productQuantity);
  const address = [order.receiverProvince, order.receiverDetailAddress].filter(Boolean).join(' ');
  return {
    id: order.id == null ? '' : String(order.id),
    orderNo: order.orderSn || (order.id != null ? `订单 #${order.id}` : '未命名订单'),
    amount: firstMoney(order) || '—',
    status: status.text,
    statusVariant: status.variant,
    detailRows: compact([
      valueRow('quantity', '商品数量', Number.isFinite(quantity) && quantity >= 0 ? `${quantity} 件` : ''),
      valueRow('created', '下单时间', shortTime(order.createTime)),
      valueRow('paid', '支付时间', shortTime(order.paymentTime)),
      valueRow('delivery', '配送方式', order.deliveryCompany),
      valueRow('deliveryNo', '物流单号', order.deliverySn),
    ]),
    receiverRows: compact([
      valueRow('receiver', '收货人', order.receiverName),
      valueRow('phone', '联系电话', order.receiverPhone),
      valueRow('address', '收货地址', address),
    ]),
    noteRows: compact([
      valueRow('orderNote', '顾客备注', order.orderNote),
      valueRow('merchantNote', '商家备注', order.merchantNote),
    ]),
  };
}

module.exports = { buildMerchantOrderDetail };
