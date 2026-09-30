// cy-session-picker · 主题页内选场次 / 选票种(Figma 11 240:401 · 11a 240:446)。
//
// 2026-09-06 用户拍板:**主题报名没有废弃,是代码写错了**。
// 原来 pages/topic/index 的 bmClick 把人踢去 play-activity-detail 再选一遍票 ——
// 主题页上明明已经把场次和价格都列出来了,点一下却跳走,回来还得重新找。
// 现在按稿在主题页内选完场次 + 票种,直接进结算。
//
// ⚠️ 票仍然绑到具体场次(下一步进 baoming?activityId=X&ticketId=Y,后端 ownerType=2)——
//    「主题页内能买」说的是交互层,不是绕过场次买一张没人核销的票。那条老注释
//    (「主题级报名已废弃,避免买了票既玩不了又没人核销」)把这两件事混成了一件。
//
// 多日 → 先选日期再选票种(稿 11);只有一个场次 → 跳过选日期,顶部直接写明是哪天(稿 11a)。
const app = getApp();

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function toDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(/-/g, '/').replace('T', ' '));
  return isNaN(d.getTime()) ? null : d;
}

/** 「周六 / 12.13」两行。拿不到日期就只留场次名,不编一个日期出来。 */
function dateChip(activity) {
  const d = toDate(activity.startDate);
  if (!d) return { week: '', day: String(activity.name || '').slice(0, 8) };
  return { week: WEEKDAY[d.getDay()], day: (d.getMonth() + 1) + '.' + d.getDate() };
}

/** 稿 11a 顶部那行「2025年12月13日(周六)· 19:30 集合」——缺哪半截就少写哪半截 */
function singleDayText(activity) {
  const d = toDate(activity && activity.startDate);
  if (!d) return String((activity && activity.name) || '');
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const day = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日('
    + WEEKDAY[d.getDay()] + ')';
  const clock = pad(d.getHours()) + ':' + pad(d.getMinutes());
  return clock === '00:00' ? day : day + ' · ' + clock + ' 集合';
}

Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false },
    // 宿主传 info.activityList(该主题已上架、未结束的场次)
    activities: { type: Array, value: [] },
  },
  data: {
    days: [],
    singleDay: false,
    singleDayText: '',
    pickedActivityId: 0,
    tickets: [],
    ticketsState: 'idle',   // idle | loading | ready | error | empty | gate
    ticketsError: '',
    // M1-3 门卡:后端对非俱乐部成员返回 {gate:true, clubId, message}。
    // 这一档不是「票种没读出来」,重试再多次也读不出来 —— 唯一出口是去加入俱乐部。
    gateClubId: 0,
    pickedTicketId: 0,
    totalText: '',
  },
  observers: {
    'show, activities': function (show, activities) {
      if (!show) return;
      const rows = (activities || []).filter((a) => a && a.id).map((a) => ({
        id: a.id,
        name: String(a.name || ''),
        week: dateChip(a).week,
        day: dateChip(a).day,
      }));
      const single = rows.length === 1;
      this.setData({
        days: rows,
        singleDay: single,
        singleDayText: single ? singleDayText((activities || [])[0]) : '',
      });
      // 单场次不用选日期,直接进第二步
      if (single && this.data.pickedActivityId !== rows[0].id) this.pickActivity(rows[0].id);
    },
  },
  methods: {
    onPickDay(e) {
      const id = Number(e.currentTarget.dataset.id) || 0;
      if (!id || id === this.data.pickedActivityId) return;
      this.pickActivity(id);
    },

    pickActivity(activityId) {
      // 换了日期,上一场的票种与总价一律作废 —— 留着会让人以为选中的还算数
      this.setData({
        pickedActivityId: activityId,
        pickedTicketId: 0,
        tickets: [],
        totalText: '',
        ticketsState: 'loading',
        ticketsError: '',
      });
      const that = this;
      app.sendRequest({
        url: '/api/activity/info', method: 'POST', hideLoading: true, silentError: true,
        data: { id: activityId },
        success(res) {
          if (that.data.pickedActivityId !== activityId) return;   // 已经切到别的日期
          const d = res && (res.code == 200 || res.code == '200') ? res.data : null;
          if (d && d.gate === true) {
            that.setData({
              tickets: [],
              ticketsState: 'gate',
              ticketsError: d.message || '来自俱乐部的活动，加入后查看',
              gateClubId: Number(d.clubId) || 0,
              pickedTicketId: 0,
              totalText: '',
            });
            return;
          }
          const rows = d && Array.isArray(d.omsTicketList)
            ? d.omsTicketList.filter((t) => t && t.id && String(t.name || '').trim()) : null;
          if (!rows && d) {
            // 后端只在真有票时才下发 omsTicketList(ApiActivityController:995),
            // 所以成功体里没这个字段 = 这一场还没放票。它不是读取失败:拿成功回执
            //「操作成功」当错误解释,会和「票种没读出来」同屏矛盾(CU-C-131)。
            that.setData({ ticketsState: 'empty', ticketsError: '' });
            return;
          }
          if (!rows) {
            // 只有业务失败体才有可展示的原因
            that.setData({
              ticketsState: 'error',
              ticketsError: app.getRequestErrorMessage(res, '票种没读出来'),
            });
            return;
          }
          that.setData({
            tickets: rows.map((t) => ({
              id: t.id,
              name: String(t.name).trim(),
              price: t.price,
              // 说明与余量都是「有就写、没有就不写」,不兜底成占位
              rule: String(t.refundRule || '').trim(),
              remaining: t.remainingInventory == null ? null : Number(t.remainingInventory),
            })),
            ticketsState: rows.length ? 'ready' : 'empty',
            ticketsError: '',
          });
        },
        fail(res) {
          if (that.data.pickedActivityId !== activityId) return;
          that.setData({
            ticketsState: 'error',
            ticketsError: app.getRequestErrorMessage(res, '票种没读出来，检查网络后重试'),
          });
        },
      });
    },

    retryTickets() {
      if (this.data.pickedActivityId) this.pickActivity(this.data.pickedActivityId);
    },

    // 门卡出口:先关掉选场次弹层,再去俱乐部页 —— 不在半屏弹层上压第二层。
    goGateClub() {
      const clubId = Number(this.data.gateClubId) || 0;
      this.triggerEvent('close', {});
      if (clubId > 0) wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId });
    },

    onPickTicket(e) {
      const id = Number(e.currentTarget.dataset.id) || 0;
      const ticket = this.data.tickets.filter((t) => t.id === id)[0];
      if (!ticket) return;
      // 售罄的不给选:让人选中再到结算页被拦是白走一趟
      if (ticket.remaining === 0) return;
      this.setData({
        pickedTicketId: id,
        totalText: ticket.price == null ? '' : ('¥' + ticket.price),
      });
    },

    onClose() { this.triggerEvent('close', {}); },

    onNext() {
      const { pickedActivityId, pickedTicketId } = this.data;
      if (!pickedActivityId || !pickedTicketId) return;
      this.triggerEvent('confirm', { activityId: pickedActivityId, ticketId: pickedTicketId });
    },
  },
});
