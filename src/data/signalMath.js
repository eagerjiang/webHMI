export const SAMPLE_PITCH_MM = 0.001

// 检测窗统一使用业务坐标：x=采样点 0–1199，y=信号强度 0–100；
// Canvas 像素坐标只在组件内部转换，不应进入计算层。
export function normalizeWindow(windowData) {
  if (!windowData) return null
  return {
    xMin: Math.max(0, Math.min(1199, Math.round(Math.min(windowData.xMin, windowData.xMax)))),
    xMax: Math.max(0, Math.min(1199, Math.round(Math.max(windowData.xMin, windowData.xMax)))),
    yMin: Math.max(0, Math.min(100, Math.min(windowData.yMin, windowData.yMax))),
    yMax: Math.max(0, Math.min(100, Math.max(windowData.yMin, windowData.yMax)))
  }
}

export function findPeakInWindow(points, windowData) {
  const window = normalizeWindow(windowData)
  if (!window || !points?.length) return null

  // 只在检测窗内寻找最高点，窗外的材料纹理和反光峰不会进入偏差计算。
  let peak = null
  for (const point of points) {
    if (
      point.x < window.xMin || point.x > window.xMax ||
      point.y < window.yMin || point.y > window.yMax
    ) continue
    if (!peak || point.y > peak.y) peak = point
  }
  return peak
}

export function nearestReference(references, x) {
  if (!references || x == null) return null
  return Object.entries(references).reduce((best, [key, value]) => {
    const distance = Math.abs(value - x)
    return !best || distance < best.distance ? { key, value, distance } : best
  }, null)
}

export function calculateWindowDeviation(frame, windowData, samplePitchMm = SAMPLE_PITCH_MM) {
  // 数据流：有效帧 → 窗内峰值 → 参考线距离（sample）→ 纵向偏差（mm）。
  const peak = findPeakInWindow(frame?.points, windowData)
  if (!peak) return { peak: null, reference: null, longitudinalMm: null }
  // 首色是主参考线；前色/本色只作为上下文展示，不参与主偏差选择。
  const firstReference = frame?.references?.first
  const reference = firstReference == null
    ? nearestReference(frame?.references, peak.x)
    : { key: 'first', value: firstReference, distance: Math.abs(firstReference - peak.x) }
  if (!reference) return { peak, reference: null, longitudinalMm: null }
  const deviations = Object.fromEntries(
    Object.entries(frame.references || {}).map(([key, value]) => [
      key,
      +((peak.x - value) * samplePitchMm).toFixed(3)
    ])
  )
  return {
    peak,
    reference,
    longitudinalMm: deviations.first ?? +((peak.x - reference.value) * samplePitchMm).toFixed(3),
    deviations
  }
}
