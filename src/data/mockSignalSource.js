import { createSignalFrame } from "./mock";

export function createSignalBucket(stationIndex, now = Date.now()) {
  //PU 的最新帧、显示帧、冻结状态、信号状态等
  const frame = createSignalFrame(stationIndex, now);
  return {
    // latest* 属于采集链路，displayed* 属于 UI 链路；冻结/编辑只阻止后者更新。

    latestFrame: frame,
    displayedFrame: frame,
    latestReceivedAt: now,
    displayedAt: now,
    frozenAt: null,
    freezeMode: "live",
    modeBeforeEdit: "live",
    signalStatus: "live",
    recoveryFrames: 0,
    simulatedLoss: false,
    lossStartedAt: null,
  };
}
//把新的一帧模拟信号送进这个 PU 的信号桶，并根据当前状态决定它是正常、恢复中，还是中断
export function receiveSignalFrame(bucket, stationIndex, now = Date.now()) {
  // 模拟丢帧时保留最后有效帧；超过 2 秒才判定中断，避免瞬时抖动触发报警。
  if (bucket.simulatedLoss) {
    if (bucket.lossStartedAt == null) bucket.lossStartedAt = now;
    if (now - bucket.latestReceivedAt >= 2000)
      bucket.signalStatus = "interrupted";
    return null;
  }
  //--正常接收
  const frame = createSignalFrame(stationIndex, now);
  bucket.latestFrame = frame;
  bucket.latestReceivedAt = now;
  bucket.lossStartedAt = null;

  if (bucket.signalStatus === "interrupted") {
    bucket.signalStatus = "recovering";
    bucket.recoveryFrames = 1;
  } else if (bucket.signalStatus === "recovering") {
    // 连续收到两帧才恢复 live，模拟真实采集中的去抖/稳定性确认。
    bucket.recoveryFrames += 1;
    if (bucket.recoveryFrames >= 2) {
      bucket.signalStatus = "live";
      bucket.recoveryFrames = 0;
    }
  }

  if (bucket.freezeMode === "live") {
    // manual/edit 模式仍收最新帧，但保持屏幕上的 displayedFrame 不变。
    bucket.displayedFrame = frame;
    bucket.displayedAt = now;
  }
  return frame;
}
