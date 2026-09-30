const hours = require('../../../utils/merchant-business-hours');
const { HOURS, MINUTES, pad2 } = require('../../../../../utils/time-picker-options');
Component({
  properties: {
    value: { type: String, value: '' },
    saving: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },
  data: {
    draft: hours.parse(''),
    hours: HOURS.map(pad2),
    minutes: MINUTES.map(pad2),
    localError: '',
    timePart: '',
    hourIndex: 10,
    minuteIndex: 0,
  },
  methods: {
    open() {
      (Object.assign(this.data, {timePart: ''}), this.setData({draft: hours.parse(this.data.value), localError: ''}));
    },
    close() {
      this.selectComponent('#hours-drop').close();
    },
    toggleDay(e) {
      if (this.data.saving) return;
      const i = e.currentTarget.dataset.index;
      this.setData({ ['draft.days[' + i + '].on']: !this.data.draft.days[i].on, localError: '' });
    },
    openStart() {
      this.openTime('start');
    },
    openEnd() {
      this.openTime('end');
    },
    openTime(part) {
      const values = this.data.draft[part].split(':');
      (Object.assign(this.data, {timePart: part}), this.setData({hourIndex: Number(values[0]), minuteIndex: Number(values[1])}));
    },
    pickHour(e) {
      if (this.data.saving) return;
      const hour = Number(e.currentTarget.dataset.index);
      this.setData({
        hourIndex: hour,
        ['draft.' + this.data.timePart]: pad2(hour) + ':' + pad2(this.data.minuteIndex),
      });
    },
    pickMinute(e) {
      if (this.data.saving) return;
      const minute = Number(e.currentTarget.dataset.index);
      this.setData({
        minuteIndex: minute,
        ['draft.' + this.data.timePart]: pad2(this.data.hourIndex) + ':' + pad2(minute),
        localError: '',
      });
      this.selectComponent('#' + this.data.timePart + '-drop').close();
    },
    save() {
      if (this.data.saving) return;
      const result = hours.serialize(this.data.draft);
      if (result.error) return this.setData({ localError: result.error });
      this.triggerEvent('save', { value: result.value });
    },
  },
});
