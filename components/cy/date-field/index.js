// cy-date-field · 日期/时间选择字段(2026-08-25 新建)
//
// 替代全仓 14 处原生 <picker mode="date"> / <picker mode="time">。
// 原生 picker 是**系统层**:字体、圆角、深浅色全都不受设计系统控制,和页面里
// 自绘的 cy-date-sheet 摆在一起是两种长相。本组件把它换成同一张底部面板。
//
// ⚠️ 与原生 picker 的 API 逐字兼容:
//   mode='date' → value / 回传 detail.value 都是 'YYYY-MM-DD'
//   mode='time' → value / 回传 detail.value 都是 'HH:mm'
//   start 语义同原生(下限,选到更早会夹回)
// 所以 14 个调用点只改标签名与 bindchange→bind:change,JS 处理器一行不用动。
const toast = require('../../../utils/toast.js');
const df = require('../../../utils/date-field.js');
const {pad2} = require('../../../utils/time-picker-options.js');

Component({
  properties: {
    presentation:{type:String,value:'sheet'},
    mode: { type: String, value: 'date' },      // date | time
    value: { type: String, value: '' },
    start: { type: String, value: '' },         // 仅 date:可选下限
    disabled: { type: Boolean, value: false },
    title: { type: String, value: '' },
  },
  data: {
    calendarDays:[], calendarYear:0, calendarMonth:1, calendarWidth:350, weekdays:['一','二','三','四','五','六','日'],
    show: false,
    columns: [],        // [[年],[月],[日]] 或 [[时],[分]]
    index: [0, 0, 0],
    sheetTitle: '选择日期',
  },
  lifetimes: {
    attached() {
      // 基准年只在挂载时取一次:列表跨度 ±(1,3) 年,会话内不会跨年到需要重算。
      // 放实例字段不放 data —— 它从不参与渲染,进 data 就是一个死数据字段(U4 门禁盯这个)。
      this._baseYear = new Date().getFullYear();
    },
  },
  methods: {
    prepareCalendar(){
      const now=new Date(), win=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(this.data.value || '');
      const valid=match && Number(match[1])>0 && Number(match[2])>=1 && Number(match[2])<=12 && Number(match[3])>=1 && Number(match[3])<=df.daysInMonth(Number(match[1]),Number(match[2]));
      const parsed=valid?{year:Number(match[1]),month:Number(match[2])}:{year:now.getFullYear(),month:now.getMonth()+1};
      this.setData({calendarYear:parsed.year,calendarMonth:parsed.month,calendarWidth:(win.windowWidth||390)*(350/390)});
      this.buildCalendar();this.triggerEvent('open');
    },
    buildCalendar(){
      const year=this.data.calendarYear,month=this.data.calendarMonth;
      const start=(new Date(year,month-1,1).getDay()+6)%7,total=df.daysInMonth(year,month),days=[];
      for(let i=0;i<start;i++)days.push({key:'blank'+i,label:'',value:'',disabled:true});
      for(let day=1;day<=total;day++){
        const value=year+'-'+pad2(month)+'-'+pad2(day);
        days.push({key:value,label:String(day),value,disabled:!!this.data.start&&value<this.data.start,selected:value===this.data.value});
      }
      this.setData({calendarDays:days});
    },
    changeMonth(e){
      const date=new Date(this.data.calendarYear,this.data.calendarMonth-1+Number(e.currentTarget.dataset.step),1);
      this.setData({calendarYear:date.getFullYear(),calendarMonth:date.getMonth()+1});this.buildCalendar();
    },
    pickDate(e){if(this.data.disabled)return;const value=e.currentTarget.dataset.value;if(!value||(this.data.start&&value<this.data.start))return;this.triggerEvent('change',{value});this.selectComponent('#calendar').close();},
    clearDate(){if(this.data.disabled)return;this.triggerEvent('change',{value:''});this.selectComponent('#calendar').close();},
    closeCalendar(){this.triggerEvent('close');},

    open() {
      if (this.data.disabled) return;
      const isTime = this.data.mode === 'time';
      const baseYear = this._baseYear;
      if (isTime) {
        const index = df.timeToIndex(this.data.value);
        this.setData({
          show: true,
          sheetTitle: this.data.title || '选择时间',
          columns: [hourColumn(), minuteColumn()],
          index,
        });
        return;
      }
      const parsed = df.dateToIndex(this.data.value, baseYear, todayParts(baseYear));
      this.setData({
        show: true,
        sheetTitle: this.data.title || '选择日期',
        columns: df.dateColumns(baseYear, parsed.year, parsed.month),
        index: parsed.index,
      });
    },

    onColumnChange(e) {
      const index = e.detail.value;
      if (this.data.mode === 'time') { this.setData({ index }); return; }
      // 年/月一变,当月天数跟着变 —— 不重算日列会出现 2 月 31 日这种选项。
      const value = df.indexToDate(index, this._baseYear);
      const parsed = df.dateToIndex(value, this._baseYear);
      this.setData({ columns: df.dateColumns(this._baseYear, parsed.year, parsed.month), index: parsed.index });
    },

    onCancel() { this.setData({ show: false }); },

    onConfirm() {
      const isTime = this.data.mode === 'time';
      let value = isTime ? df.indexToTime(this.data.index) : df.indexToDate(this.data.index, this._baseYear);
      if (!isTime) {
        const clamped = df.clampToStart(value, this.data.start);
        // 原生 picker 的 start 是「早于它的日期根本滚不到」;这里是滚得到、确认时才夹回来。
        // 夹了不说 = 用户明明选了 1 月 1 日,回来看到今天,以为自己点错了。必须出声。
        if (clamped !== value) {
          toast(`最早只能选 ${this.data.start}`);
        }
        value = clamped;
      }
      this.setData({ show: false });
      this.triggerEvent('change', { value });
    },
  },
});

function hourColumn() {
  const list = [];
  for (let i = 0; i < 24; i += 1) list.push(String(i).padStart(2, '0'));
  return list;
}
function minuteColumn() {
  const list = [];
  for (let i = 0; i < 60; i += 1) list.push(String(i).padStart(2, '0'));
  return list;
}
function todayParts(baseYear) {
  const now = new Date();
  return { year: baseYear, month: now.getMonth() + 1, day: now.getDate() };
}
