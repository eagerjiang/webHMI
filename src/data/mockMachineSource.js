function clone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* Vue reactive proxy: use JSON fallback */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function updateAlarm(alarm, active, now) {
  if (!alarm || alarm.active === active) return alarm;
  const requiresReset = alarm.severity === "stop";
  return {
    ...alarm,
    active,
    acknowledged: active ? false : alarm.acknowledged,
    acknowledgedAt: active ? undefined : alarm.acknowledgedAt,
    recoveredAt: active ? undefined : now,
    resetRequired: active
      ? requiresReset
      : requiresReset
        ? alarm.resetRequired !== false
        : false,
    resetAt: active ? undefined : alarm.resetAt,
    occurredAt: active ? now : alarm.occurredAt,
  };
}

function updateAlarmList(alarms, id, active, now) {
  return alarms.map((alarm) =>
    alarm.id === id ? updateAlarm(alarm, active, now) : alarm,
  );
}

// 演示状态每 90 秒推进一次；完整时间线 7.5 分钟后循环。
// 相对页面加载时刻计算，确保每次刷新都从相同的第 0 阶段开始。
export const MACHINE_SCENE_DURATION_SECONDS = 90;
const MACHINE_SCENE_COUNT = 5;

/** 生成可回放的整机快照，不修改输入对象。 */
export function createMachineSnapshot(
  previousMachine,
  previousAlarms,
  now,
  startedAt,
) {
  // Also accept the compact `(machine, now, startedAt)` form used by pure
  // scenario tests; alarm state is optional in that form.
  if (typeof previousAlarms === "number") {
    startedAt = now;
    now = previousAlarms;
    previousAlarms = [];
  }
  // 每次 tick 基于上一帧克隆后计算，不直接改前一帧的状态，在新对象中计算并返回新状态
  const machine = clone(previousMachine);
  const alarms = clone(previousAlarms);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const scene =
    Math.floor(elapsed / MACHINE_SCENE_DURATION_SECONDS) % MACHINE_SCENE_COUNT;
  const phase =
    elapsed % (MACHINE_SCENE_DURATION_SECONDS * MACHINE_SCENE_COUNT);
  const target = machine.targetSpeedMpm;
  const delta = target - machine.speedMpm;
  const machineStopAlarm = alarms.some(
    (alarm) =>
      alarm.active && alarm.severity === "stop" && alarm.scope === "machine",
  );
  const machineResetPending = alarms.some(
    (alarm) =>
      alarm.resetRequired &&
      alarm.severity === "stop" &&
      alarm.scope === "machine",
  );
  if (machineStopAlarm || machineResetPending) machine.runCommand = "stop";
  const machineStopped =
    machine.runCommand === "stop" ||
    machineStopAlarm ||
    machineResetPending ||
    (machine.runCommand !== "run" && scene === 4);

  machine.runState = machineStopped ? "stop" : "run";
  machine.motionPhase = machineStopped
    ? "stopped"
    : Math.abs(delta) < 0.05
      ? "steady"
      : delta > 0
        ? "accelerating"
        : "decelerating";
  machine.speedMpm = machineStopped
    ? Math.max(0, machine.speedMpm * 0.6)
    : machine.speedMpm + delta * 0.22;
  machine.totalLengthM += machine.speedMpm / 3600;
  machine.unwind.armPositionPct = 56 + Math.sin(now / 2600) * 4;
  machine.rewind.armPositionPct = 44 + Math.cos(now / 2900) * 4;
  machine.updatedAt = now;

  // 色组状态同时受整机联锁、报警/复位状态、操作指令和演示场景控制。
  machine.stations = machine.stations.map((station, index) => {
    const pu7Stopped = station.id === "PU7" && scene === 0;
    const pu8Stopped = station.id === "PU8" && scene === 3;
    const stationStopAlarm = alarms.some(
      (alarm) =>
        alarm.active &&
        alarm.severity === "stop" &&
        alarm.scope === "station" &&
        alarm.sourceId === station.id,
    );
    const stationResetPending = alarms.some(
      (alarm) =>
        alarm.resetRequired &&
        alarm.severity === "stop" &&
        alarm.scope === "station" &&
        alarm.sourceId === station.id,
    );
    const runCommand =
      stationStopAlarm || stationResetPending ? "stop" : station.runCommand;
    const runState =
      machineStopped ||
      stationStopAlarm ||
      stationResetPending ||
      runCommand === "stop" ||
      pu7Stopped ||
      pu8Stopped
        ? "stop"
        : "run";
    let alarmState = "normal";
    if (station.id === "PU7" && pu7Stopped) alarmState = "alarm";
    else if (
      (station.id === "PU4" && scene === 0) ||
      (station.id === "PU8" && scene === 2)
    )
      alarmState = "warning";
    return {
      ...station,
      runCommand,
      runState,
      alarmState,
      rollerRpm:
        runState === "run"
          ? 57 + index * 0.4 + Math.sin(now / 1300 + index) * 0.8
          : 0,
      offsetLongitudinalMm: +(
        0.01 +
        Math.sin(now / 2200 + index) * 0.04
      ).toFixed(3),
      offsetLateralMm: +(0.02 + Math.cos(now / 2500 + index) * 0.02).toFixed(3),
    };
  });

  // 场景负责产生/恢复故障条件；确认和复位仍由 Store 中的操作员动作维护。
  let nextAlarms = alarms;
  nextAlarms = updateAlarmList(nextAlarms, "alarm-pu7-drive", scene === 0, now);
  nextAlarms = updateAlarmList(
    nextAlarms,
    "alarm-pu4-register",
    scene === 0,
    now,
  );
  nextAlarms = updateAlarmList(
    nextAlarms,
    "alarm-pu8-register",
    scene === 2,
    now,
  );
  nextAlarms = updateAlarmList(
    nextAlarms,
    "alarm-web-tension",
    scene === 1,
    now,
  );

  return { machine, alarms: nextAlarms, phase, scene, timestamp: now };
}

export class MockMachineSource {
  constructor(machine, alarms, startedAt = Date.now()) {
    this.machine = clone(machine);
    this.alarms = clone(alarms);
    this.startedAt = startedAt;
  }

  next(now = Date.now()) {
    //生成下一帧，初始化时，页面一打开有可展示数据
    const snapshot = createMachineSnapshot(
      this.machine,
      this.alarms,
      now,
      this.startedAt,
    );
    this.machine = clone(snapshot.machine);
    this.alarms = clone(snapshot.alarms);
    return snapshot;
  }
}

// Backward-compatible helper for callers outside the Store.
export function tickMachineScenario(machine, alarms, now, startedAt) {
  const snapshot = createMachineSnapshot(machine, alarms, now, startedAt);
  Object.assign(machine, snapshot.machine);
  alarms.splice(0, alarms.length, ...snapshot.alarms);
  return snapshot;
}
