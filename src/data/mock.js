export const stationIds = Array.from({ length: 10 }, (_, i) => `PU${i + 1}`)
import { getMockReferenceConfig, MockReferenceConfig } from './mockReferenceConfig.js'
export { MockReferenceConfig }

export const stationColors = {
  PU1: '#27d4ed',
  PU2: '#d92e61',
  PU3: '#4db5dd',
  PU4: '#d7d51a',
  PU5: '#e8f0f4',
  PU6: '#557a27',
  PU7: '#ee7649',
  PU8: '#ffc857',
  PU9: '#b93ccf',
  PU10: '#98a1a8'
}

export const stationNames = {
  PU1: 'Cyan', PU2: 'Magenta', PU3: 'Blue', PU4: 'Yellow', PU5: 'White',
  PU6: 'Green', PU7: 'Orange', PU8: 'Amber', PU9: 'Violet', PU10: 'Special'
}

export function createInitialMachine() {
  return {
    orderNo: 'WO-240806-17',
    webWidthMm: 600,
    speedMpm: 24,
    targetSpeedMpm: 24,
    runMode: 'auto',
    runCommand: 'auto',
    accelerationTimeS: 8,
    decelerationTimeS: 10,
    speedRangeMpm: { min: 0, max: 150 },
    runState: 'run',
    motionPhase: 'steady',
    linked: true,
    updatedAt: Date.now(),
    totalLengthM: 12840,
    unwind: { activeAxis: 'A', armPositionPct: 58, tensionN: 83.2, axes: {
      A: { axis: 'A', active: true, diameterMm: 720, lengthM: 6400, alarmThresholdMm: 140 },
      B: { axis: 'B', active: false, diameterMm: 680, lengthM: 6000, alarmThresholdMm: 140 }
    }},
    rewind: { activeAxis: 'A', armPositionPct: 42, tensionN: 81.7, axes: {
      A: { axis: 'A', active: true, diameterMm: 560, lengthM: 4200, alarmThresholdMm: 120 },
      B: { axis: 'B', active: false, diameterMm: 520, lengthM: 4000, alarmThresholdMm: 120 }
    }},
    stations: stationIds.map((id, i) => ({
      id, color: stationColors[id], colorName: stationNames[id],
      runCommand: 'auto',
      runState: id === 'PU7' ? 'stop' : 'run',
      alarmState: id === 'PU7' ? 'alarm' : id === 'PU4' || id === 'PU8' ? 'warning' : 'normal',
      offsetLongitudinalMm: i === 2 ? 0.03 : i === 6 ? 0.23 : 0.01,
      offsetLateralMm: i === 2 ? -0.01 : 0.02,
      tensionN: 78 + i * 1.3,
      rollerRpm: 57 + i * 0.4,
      doctorPressureBar: 1.6 + i * 0.04,
      impressionPressureBar: 2.1 + i * 0.03,
      dryerTempC: 58 + i * 0.6,
      inkViscosityS: 16.8 + i * 0.2,
      lockEye: i === 0 ? 'none' : 'online',
      alarmIds: []
    }))
  }
}

export function createInitialAlarms() {
  return [
    { id: 'alarm-pu7-drive', sourceType: 'station', sourceId: 'PU7', severity: 'stop', scope: 'station', title: '凹版辊驱动停机', message: '凹版辊驱动反馈异常，PU7 已停止', active: true, acknowledged: false, resetRequired: true, resetAt: null, occurredAt: Date.now() - 42000 },
    { id: 'alarm-pu4-register', sourceType: 'station', sourceId: 'PU4', severity: 'warning', scope: 'station', title: '套色偏差预警', message: '当前偏差接近预警阈值', active: true, acknowledged: false, resetRequired: false, resetAt: null, occurredAt: Date.now() - 16000 },
    { id: 'alarm-pu8-register', sourceType: 'station', sourceId: 'PU8', severity: 'warning', scope: 'station', title: '套色偏差预警', message: '当前偏差接近预警阈值', active: false, acknowledged: true, resetRequired: false, resetAt: null, occurredAt: Date.now() - 130000, recoveredAt: Date.now() - 110000 },
    { id: 'alarm-web-tension', sourceType: 'machine', sourceId: 'MACHINE', severity: 'warning', scope: 'machine', title: '放卷张力波动', message: '放卷 A 张力短时波动', active: true, acknowledged: true, resetRequired: false, resetAt: null, occurredAt: Date.now() - 95000 }
  ]
}

function noise(i, seed) {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function gaussianFeature(x, center, width, amplitude) {
  const distance = (x - center) / width
  return amplitude * Math.exp(-distance * distance)
}

export function createSignalFrame(stationIndex, now = Date.now()) {
  const phase = now / 1800 + stationIndex * 0.22
  const points = new Array(1200)
  const references = getMockReferenceConfig(stationIndex)
  // 三个主峰分别代表首色、前色和本色，是套色偏差计算的唯一目标。
  const registerPeaks = [
    { center: references.first + Math.sin(phase) * 3, width: 9, amplitude: 49 },
    { center: references.previous + Math.sin(phase + 1) * 3, width: 11, amplitude: 59 },
    { center: references.current + Math.sin(phase + 2) * 3, width: 9, amplitude: 53 }
  ]
  // 小峰和波谷模拟材料底色、图案、油墨反光等光学干扰。它们不提供
  // reference，也不参与偏差计算，只用于体现检测窗过滤背景信号的价值。
  const interferenceFeatures = [
    { center: 74 + stationIndex * 3, width: 17, amplitude: 13 },
    { center: 344 - stationIndex * 2, width: 10, amplitude: -9 },
    { center: 425 + stationIndex * 2, width: 19, amplitude: 20 },
    { center: 700 - stationIndex * 2, width: 12, amplitude: -12 },
    { center: 1015 + stationIndex * 3, width: 22, amplitude: 17 },
    { center: 1120 - stationIndex * 2, width: 14, amplitude: -8 }
  ]

  for (let i = 0; i < 1200; i += 1) {
    // 缓慢的基线漂移、纸张纹理和逐帧噪声让曲线保持实时感，同时避免
    // 整条曲线在每 500 ms 刷新时发生大幅跳动。
    let y = 11
      + Math.sin(i / 92 + phase * 0.08) * 2.4
      + Math.sin(i / 23 + stationIndex) * 1.2
      + noise(i, stationIndex + Math.floor(now / 500)) * 1.35

    for (const peak of registerPeaks) {
      y += gaussianFeature(i, peak.center, peak.width, peak.amplitude)
    }
    for (let featureIndex = 0; featureIndex < interferenceFeatures.length; featureIndex += 1) {
      const feature = interferenceFeatures[featureIndex]
      const drift = Math.sin(phase * 0.35 + featureIndex * 1.7) * 2
      const pulse = 0.9 + Math.sin(phase * 0.22 + featureIndex) * 0.1
      y += gaussianFeature(i, feature.center + drift, feature.width, feature.amplitude * pulse)
    }
    points[i] = { x: i, y: Math.max(0, Math.min(100, y)) }
  }
  return {
    points,
    receivedAt: now,
    frameNo: Math.floor(now / 500),
    references,
    colorBand: [
      { from: 0, to: 300, color: '#b93ccf' },
      { from: 300, to: 636, color: '#40d998' },
      { from: 636, to: 1199, color: '#ffc857' }
    ]
  }
}
