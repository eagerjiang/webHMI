export function alarmNeedsAction(alarm) {
  return Boolean(alarm && (alarm.active || !alarm.acknowledged || alarm.resetRequired))
}

export function alarmCanReset(alarm) {
  // 停机报警必须依次经历“故障消失 → 操作员确认 → 复位”；确认本身不清故障。
  return Boolean(alarm
    && alarm.severity === 'stop'
    && alarm.resetRequired
    && !alarm.active
    && alarm.acknowledged)
}

export function alarmLifecycle(alarm) {
  // 这里是报警状态机的唯一文本前置规则，页面只消费结果，不自行推断生命周期。
  if (!alarm) return 'closed'
  if (alarm.active) return alarm.acknowledged ? 'active-acknowledged' : 'active-pending-ack'
  if (!alarm.acknowledged) return 'recovered-pending-ack'
  if (alarm.resetRequired) return 'recovered-pending-reset'
  if (alarm.resetAt) return 'reset-closed'
  return 'recovered-closed'
}

export function alarmLifecycleText(alarm) {
  const labels = {
    'active-pending-ack': '活动 / 待确认',
    'active-acknowledged': '活动 / 已确认',
    'recovered-pending-ack': '已恢复 / 待确认',
    'recovered-pending-reset': '已恢复 / 待复位',
    'reset-closed': '已复位 / 已关闭',
    'recovered-closed': '已恢复 / 已关闭',
    closed: '已关闭'
  }
  return labels[alarmLifecycle(alarm)]
}

export function summarizeAlarms(alarms = []) {
  const active = alarms.filter(alarm => alarm.active).length
  const pendingAck = alarms.filter(alarm => !alarm.acknowledged).length
  const pendingReset = alarms.filter(alarmCanReset).length
  const needsAction = alarms.filter(alarmNeedsAction).length
  return { active, pendingAck, pendingReset, needsAction }
}

export function highestAlarmLevel(alarms = []) {
  if (alarms.some(alarm => alarm.severity === 'stop' && (alarm.active || alarm.resetRequired))) return 'stop'
  if (alarms.some(alarm => alarm.active || !alarm.acknowledged || alarm.resetRequired)) return 'warning'
  return 'normal'
}

export function highestAlarmLabel(alarms = []) {
  if (alarms.some(alarm => alarm.severity === 'stop' && alarm.active)) return '停机级报警'
  if (alarms.some(alarm => alarm.severity === 'stop' && alarm.resetRequired && !alarm.acknowledged)) return '停机报警待确认'
  if (alarms.some(alarm => alarmCanReset(alarm))) return '停机报警待复位'
  if (alarms.some(alarm => alarm.active)) return '活动警告'
  if (alarms.some(alarm => !alarm.acknowledged)) return '存在待确认报警'
  if (alarms.some(alarm => alarm.resetRequired)) return '存在待复位报警'
  return '正常'
}

export function windowsEqual(a, b) {
  if (!a || !b) return a === b
  return ['xMin', 'xMax', 'yMin', 'yMax'].every(key => Math.abs(Number(a[key]) - Number(b[key])) < 0.0001)
}
