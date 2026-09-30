// 发布广场模板摘要的展示归一化。
// 后端历史数据同时存在数字分钟与已带「分钟」单位的字符串，展示层只应补一次单位。
function formatDurationMinutes(value) {
  if (value === null || value === undefined) return '';
  var text = String(value).trim();
  if (!text) return '';
  text = text.replace(/\s*(分钟|min(?:ute)?s?)$/i, '');
  return text ? text + '分钟' : '';
}

module.exports = {
  formatDurationMinutes: formatDurationMinutes
};
