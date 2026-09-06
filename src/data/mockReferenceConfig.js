/**
 * 演示版首色参考配置。
 * 真实设备接入后由 PLC/配方服务替换；演示阶段固定配置，确保每次回放
 * 的参考位置一致，不再用固定偏移量拼接偏差结果。
 */
export const MockReferenceConfig = Object.fromEntries(
  Array.from({ length: 9 }, (_, index) => {
    const stationIndex = index + 1
    return [`PU${stationIndex + 1}`, {
      first: 210 + stationIndex * 3,
      previous: 560 + stationIndex * 2,
      current: 852 + stationIndex
    }]
  })
)

export function getMockReferenceConfig(stationIndex) {
  const id = `PU${stationIndex + 2}`
  return { ...(MockReferenceConfig[id] || MockReferenceConfig.PU2) }
}
