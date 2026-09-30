function cityOrientationScheduleIssues(ticket) {
  if (Number(ticket && ticket.mode) !== 1) return [];

  const startTime = String((ticket && ticket.startTime) || '').trim();
  const endTime = String((ticket && ticket.endTime) || '').trim();
  const issues = [];

  if (!startTime) issues.push({ field: 'startTime', message: '请选择集合开始时间' });
  if (!endTime) issues.push({ field: 'endTime', message: '请选择集合结束时间' });
  if (startTime && endTime && endTime <= startTime) {
    issues.push({ field: 'endTime', message: '集合结束时间必须晚于开始时间' });
  }
  return issues;
}

module.exports = { cityOrientationScheduleIssues };
