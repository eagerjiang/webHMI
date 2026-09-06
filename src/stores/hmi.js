import { computed, onBeforeUnmount, reactive } from "vue";
import {
  createInitialAlarms,
  createInitialMachine,
  stationIds,
} from "../data/mock";
import { MockMachineSource } from "../data/mockMachineSource";
import {
  createSignalBucket,
  receiveSignalFrame,
} from "../data/mockSignalSource";
import { calculateWindowDeviation, normalizeWindow } from "../data/signalMath";
import {
  alarmCanReset,
  alarmLifecycleText,
  alarmNeedsAction,
  highestAlarmLabel,
  highestAlarmLevel,
  summarizeAlarms,
  windowsEqual,
} from "../data/hmiRules";

const signalStationIds = stationIds.slice(1);
const defaultWindow = { xMin: 150, xMax: 275, yMin: 18, yMax: 72 };
const sessionWindowKey = "visu19-demo-windows-v1";

// 检测窗按 PU 保存在当前浏览器会话中；读取时统一归一化，避免历史数据越过
// 1200 个采样点和 0–100% 强度的业务坐标边界。
function loadSessionWindows() {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(sessionWindowKey) || "{}",
    );
    return Object.fromEntries(
      signalStationIds.map((id) => [id, normalizeWindow(parsed[id])]),
    );
  } catch {
    return Object.fromEntries(signalStationIds.map((id) => [id, null]));
  }
}

function alarmPriority(alarm) {
  const severity = alarm.severity === "stop" ? 0 : 2;
  const scope =
    alarm.scope === "machine" ? 0 : alarm.scope === "station" ? 1 : 2;
  const pending = alarm.acknowledged ? 1 : 0;
  return severity + scope + pending;
}

export function useHmi() {
  const params = new URLSearchParams(window.location.search);
  const requestedPu = params.get("pu");
  const initialPage = window.location.pathname.startsWith("/lock-mark")
    ? "lock"
    : "overview";
  const initialPu =
    stationIds.includes(requestedPu) && requestedPu !== "PU1"
      ? requestedPu
      : "PU2";
  const startedAt = Date.now();
  const initialMachine = createInitialMachine();
  const initialAlarms = createInitialAlarms();
  const sessionWindows = loadSessionWindows();
  if (!sessionWindows.PU2) sessionWindows.PU2 = { ...defaultWindow };

  // Store 是整套 HMI 的数据中枢。检测窗相关字段刻意拆成三份：
  // windows=已生效配置，draftWindows=画布正在编辑的草稿，
  // windowEditSnapshots=进入编辑前的快照，用于判断未保存修改和安全取消。
  const state = reactive({
    page: initialPage,
    selectedStationId:
      initialPage === "lock"
        ? initialPu
        : stationIds.includes(requestedPu)
          ? requestedPu
          : null,
    sourceStationId: null,
    alarmContext: null,
    detailOpen: initialPage === "overview" && stationIds.includes(requestedPu),
    machine: initialMachine,
    alarms: initialAlarms,
    signals: Object.fromEntries(
      // PU2–PU10 生成初始信号桶，PU1 不生成。
      signalStationIds.map((id, index) => [id, createSignalBucket(index)]),
    ),
    windows: sessionWindows,
    draftWindows: Object.fromEntries(signalStationIds.map((id) => [id, null])),
    windowEditSnapshots: Object.fromEntries(
      signalStationIds.map((id) => [id, null]),
    ),
    windowEditModes: Object.fromEntries(
      signalStationIds.map((id) => [id, "idle"]),
    ),
    windowAppliedAt: Object.fromEntries(
      signalStationIds.map((id) => [id, id === "PU2" ? startedAt : null]),
    ),
    windowAuditLog: [],
    rollerOffsets: Object.fromEntries(signalStationIds.map((id) => [id, 0])),
    viewport: { xMin: 0, xMax: 1199 },
    toast: "",
    now: startedAt,
  });

  let machineTimer;
  let signalTimer;
  let toastTimer;
  const editTimers = new Map();
  let machineSource = new MockMachineSource(
    state.machine,
    state.alarms,
    startedAt,
  );

  const activeAlarms = computed(() =>
    state.alarms.filter((alarm) => alarm.active),
  );
  const pendingAlarms = computed(() =>
    state.alarms.filter((alarm) => !alarm.acknowledged),
  );
  const pendingResetAlarms = computed(() => state.alarms.filter(alarmCanReset));
  const alarmStats = computed(() => summarizeAlarms(state.alarms));
  // 报警队列只保留仍需操作员处理的项，并按停机级、作用范围、确认状态排序。
  const alarmQueue = computed(() =>
    [...state.alarms]
      .filter(alarmNeedsAction)
      .sort(
        (a, b) =>
          alarmPriority(a) - alarmPriority(b) || b.occurredAt - a.occurredAt,
      ),
  );
  const highestAlarm = computed(() => highestAlarmLevel(state.alarms));
  const alarmHeadline = computed(() => highestAlarmLabel(state.alarms));
  const selectedStation = computed(() =>
    state.machine.stations.find(
      (station) => station.id === state.selectedStationId,
    ),
  );
  const selectedSignal = computed(() => state.signals[state.selectedStationId]);
  // latestFrame 始终跟随采集，用于计算；currentFrame 允许因手动冻结或编辑暂停，
  // 只负责画面展示。两者不能合并，否则冻结画面会同时冻结实时偏差。
  const currentFrame = computed(
    () => selectedSignal.value?.displayedFrame || null,
  );
  const latestFrame = computed(() => selectedSignal.value?.latestFrame || null);
  const currentWindow = computed(() => state.windows[state.selectedStationId]);
  const currentDraftWindow = computed(
    () => state.draftWindows[state.selectedStationId],
  );
  const displayWindow = computed(
    () => currentDraftWindow.value || currentWindow.value,
  );
  const isWindowEditing = computed(
    () => state.windowEditModes[state.selectedStationId] !== "idle",
  );
  const hasUnsavedWindowChanges = computed(() => {
    const id = state.selectedStationId;
    return (
      state.windowEditModes[id] !== "idle" &&
      !windowsEqual(state.draftWindows[id], state.windowEditSnapshots[id])
    );
  });
  const displayedFrameAt = computed(
    () => selectedSignal.value?.displayedAt || 0,
  );
  const latestReceivedAt = computed(
    () => selectedSignal.value?.latestReceivedAt || 0,
  );
  const signalStatus = computed(
    () => selectedSignal.value?.signalStatus || "interrupted",
  );
  const isSignalInterrupted = computed(() => signalStatus.value !== "live");
  const isSignalLossSimulated = computed(() =>
    Boolean(selectedSignal.value?.simulatedLoss),
  );
  const machineDataAgeMs = computed(() =>
    Math.max(0, state.now - (state.machine.updatedAt || startedAt)),
  );
  const isMachineDataDelayed = computed(() => machineDataAgeMs.value > 2000);
  const machineDataStatus = computed(() =>
    isMachineDataDelayed.value ? "整机数据延迟" : "数据正常",
  );
  const currentDeviation = computed(() => {
    if (signalStatus.value !== "live" || !currentWindow.value) {
      return { peak: null, reference: null, longitudinalMm: null };
    }
    // 曲线冻结只影响显示帧；偏差和报警仍依据最新有效帧计算。
    return calculateWindowDeviation(latestFrame.value, currentWindow.value);
  });

  const alarmGroups = computed(() => ({
    machine: state.alarms.filter((alarm) => alarm.scope === "machine"),
    station: state.alarms.filter((alarm) => alarm.scope === "station"),
    signal: state.alarms.filter((alarm) => alarm.scope === "signal"),
  }));

  function stationActionReasons(id) {
    const reasons = [];
    const alarms = alarmQueue.value.filter((alarm) => alarm.sourceId === id);
    if (alarms.some((alarm) => alarm.severity === "stop" && alarm.active))
      reasons.push("停机级报警");
    if (alarms.some((alarm) => !alarm.acknowledged)) reasons.push("待确认");
    if (alarms.some(alarmCanReset)) reasons.push("待复位");
    if (alarms.some((alarm) => alarm.severity !== "stop" && alarm.active))
      reasons.push("活动警告");
    const signal = state.signals[id];
    if (signal?.signalStatus === "interrupted") reasons.push("信号中断");
    else if (signal?.signalStatus === "recovering") reasons.push("信号恢复中");
    const station = state.machine.stations.find((item) => item.id === id);
    if (
      station?.runState === "stop" &&
      state.machine.runState === "run" &&
      !reasons.length
    )
      reasons.push("联锁停止");
    return [...new Set(reasons)];
  }

  function stationNeedsAction(id) {
    return stationActionReasons(id).length > 0;
  }

  function stationAttentionLevel(id) {
    const station = state.machine.stations.find((item) => item.id === id);
    const alarms = alarmQueue.value.filter((alarm) => alarm.sourceId === id);
    if (
      alarms.some(
        (alarm) =>
          alarm.severity === "stop" && (alarm.active || alarm.resetRequired),
      )
    )
      return "alarm";
    if (stationNeedsAction(id) || station?.alarmState === "warning")
      return "warning";
    return station?.runState === "run" ? "run" : "stop";
  }

  function stationStatusText(id) {
    const reasons = stationActionReasons(id);
    if (reasons.length) return reasons[0];
    const station = state.machine.stations.find((item) => item.id === id);
    return station?.runState === "run" ? "运行" : "停止";
  }

  const machineStartReason = computed(() => {
    if (state.machine.runState === "run") return "整机运行中";
    const activeStop = state.alarms.find(
      (alarm) => alarm.active && alarm.severity === "stop",
    );
    if (activeStop) return `${activeStop.sourceId} 仍有活动停机级报警`;
    const pendingAck = state.alarms.find(
      (alarm) =>
        alarm.resetRequired && alarm.severity === "stop" && !alarm.acknowledged,
    );
    if (pendingAck) return `${pendingAck.sourceId} 停机报警尚未确认`;
    const pendingReset = state.alarms.find(alarmCanReset);
    if (pendingReset) return `${pendingReset.sourceId} 停机报警尚未复位`;
    return "";
  });
  const canStartMachine = computed(
    () => state.machine.runState === "stop" && !machineStartReason.value,
  );

  function alarmById(alarmOrId) {
    return typeof alarmOrId === "string"
      ? state.alarms.find((item) => item.id === alarmOrId)
      : alarmOrId;
  }

  function canResetAlarm(alarmOrId) {
    const alarm = alarmById(alarmOrId);
    return alarmCanReset(alarm);
  }

  function resetAlarm(id) {
    const alarm = alarmById(id);
    if (!alarm) return false;
    if (alarm.active) {
      showToast("报警条件仍存在，暂不能复位");
      return false;
    }
    if (!alarm.acknowledged) {
      showToast("请先确认报警，再执行复位");
      return false;
    }
    if (!alarm.resetRequired) {
      showToast("当前报警无需复位");
      return false;
    }
    alarm.resetRequired = false;
    alarm.resetAt = Date.now();
    const station = state.machine.stations.find(
      (item) => item.id === alarm.sourceId,
    );
    if (station) station.alarmState = "normal";
    showToast(`${alarm.sourceId} 报警已复位，可执行启动`);
    return true;
  }

  function stationStartReason(id) {
    const station = state.machine.stations.find((item) => item.id === id);
    if (!station) return "色组不存在";
    if (station.runState === "run") return "PU 当前运行中";
    if (state.machine.runState !== "run") return "请先启动整机";
    const activeStop = state.alarms.find(
      (alarm) =>
        alarm.sourceId === id && alarm.active && alarm.severity === "stop",
    );
    if (activeStop) return "仍有活动停机级报警";
    const pendingAck = state.alarms.find(
      (alarm) =>
        alarm.sourceId === id &&
        alarm.resetRequired &&
        alarm.severity === "stop" &&
        !alarm.acknowledged,
    );
    if (pendingAck) return "停机报警尚未确认";
    const pendingReset = state.alarms.find(
      (alarm) => alarm.sourceId === id && alarmCanReset(alarm),
    );
    if (pendingReset) return "报警尚未复位";
    const signal = state.signals[id];
    if (signal?.signalStatus === "interrupted") return "光电眼信号中断";
    return "";
  }

  function canStartStation(id) {
    return Boolean(
      id &&
      state.machine.runState === "run" &&
      state.machine.stations.some((item) => item.id === id) &&
      !stationStartReason(id),
    );
  }

  function requestStartMachine() {
    if (state.machine.runState === "run") {
      showToast("整机当前已在运行");
      return false;
    }
    if (!canStartMachine.value) {
      showToast(`整机暂不可启动：${machineStartReason.value}`);
      return false;
    }
    state.machine.runCommand = "run";
    showToast("整机启动指令已发送，正在启动");
    return true;
  }

  function requestStartStation(id) {
    const station = state.machine.stations.find((item) => item.id === id);
    if (!station) return false;
    const reason = stationStartReason(id);
    if (reason) {
      showToast(`${id} 暂不可启动：${reason}`);
      return false;
    }
    station.runCommand = "run";
    showToast(`${id} 启动指令已发送，正在启动`);
    return true;
  }

  function showToast(message) {
    state.toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.toast = "";
    }, 2600);
  }

  function persistSessionWindows() {
    try {
      window.sessionStorage.setItem(
        sessionWindowKey,
        JSON.stringify(state.windows),
      );
    } catch {
      showToast("浏览器未允许会话保存，检测窗将在刷新后重置");
    }
  }

  function routePath(page, pu = state.selectedStationId) {
    if (page === "lock")
      return `/lock-mark?pu=${signalStationIds.includes(pu) ? pu : "PU2"}`;
    return pu && stationIds.includes(pu) ? `/overview?pu=${pu}` : "/overview";
  }

  function writeRoute(page, pu, method = "replace") {
    const action = method === "push" ? "pushState" : "replaceState";
    window.history[action]({}, "", routePath(page, pu));
  }

  function discardWindowDraft(id = state.selectedStationId, silent = false) {
    if (!signalStationIds.includes(id) || !state.draftWindows[id]) return false;
    const hadSavedWindow = Boolean(state.windows[id]);
    state.draftWindows[id] = null;
    state.windowEditSnapshots[id] = null;
    state.windowEditModes[id] = "idle";
    if (!silent)
      showToast(
        hadSavedWindow ? "已取消修改，继续使用原检测窗" : "已取消新建检测窗",
      );
    return true;
  }

  function allowLeavingWindowEditor(id = state.selectedStationId) {
    if (!signalStationIds.includes(id) || !state.draftWindows[id]) return true;
    if (windowsEqual(state.draftWindows[id], state.windowEditSnapshots[id])) {
      discardWindowDraft(id, true);
      return true;
    }
    const confirmed = window.confirm(
      `${id} 存在未应用的检测窗修改。离开后将放弃这些修改，是否继续？`,
    );
    if (confirmed) discardWindowDraft(id, true);
    return confirmed;
  }

  function navigate(page, pu = null, options = {}) {
    // 所有页面/PU 切换都走这里，集中处理未应用草稿、页面状态和 URL 三者同步。
    const previousPage = state.page;
    const target =
      page === "lock"
        ? signalStationIds.includes(pu)
          ? pu
          : signalStationIds.includes(state.selectedStationId)
            ? state.selectedStationId
            : "PU2"
        : stationIds.includes(pu)
          ? pu
          : null;
    const changesEditorContext =
      previousPage === "lock" &&
      (page !== "lock" || target !== state.selectedStationId);
    if (
      !options.skipUnsavedCheck &&
      changesEditorContext &&
      !allowLeavingWindowEditor(state.selectedStationId)
    )
      return false;

    state.page = page;
    if (page === "lock") {
      state.selectedStationId = target;
      state.detailOpen = false;
      if (previousPage !== "lock") {
        state.sourceStationId = Object.prototype.hasOwnProperty.call(
          options,
          "sourceStationId",
        )
          ? options.sourceStationId
          : null;
      }
    } else {
      state.selectedStationId = target;
      state.sourceStationId = null;
      state.alarmContext = null;
      state.detailOpen = Boolean(target);
    }
    if (options.history !== false)
      writeRoute(page, state.selectedStationId, options.history || "replace");
    return true;
  }

  function closeStationDetail() {
    state.detailOpen = false;
    state.selectedStationId = null;
    state.sourceStationId = null;
    state.alarmContext = null;
    if (state.page === "overview") writeRoute("overview", null);
  }

  function setTargetSpeed(speed) {
    const next = Math.max(
      state.machine.speedRangeMpm.min,
      Math.min(state.machine.speedRangeMpm.max, Number(speed)),
    );
    state.machine.targetSpeedMpm = next;
  }

  function selectStation(id) {
    if (!stationIds.includes(id)) return;
    state.selectedStationId = id;
    state.alarmContext = null;
    state.detailOpen = true;
    if (state.page === "overview") writeRoute("overview", id);
  }

  function enterLock(id = state.selectedStationId) {
    if (!stationIds.includes(id)) return;
    if (id === "PU1") {
      selectStation(id);
      showToast("PU1 暂无锁定标记检测");
      return;
    }
    state.viewport = { xMin: 0, xMax: 1199 };
    navigate("lock", id, {
      sourceStationId: state.page === "overview" ? id : null,
    });
  }

  function chooseStation(id) {
    if (!signalStationIds.includes(id)) return;
    if (id === state.selectedStationId) return true;
    if (!allowLeavingWindowEditor(state.selectedStationId)) return false;
    state.selectedStationId = id;
    // 用户主动切换 PU 后，当前 PU 成为新的导航上下文；不再展示历史进入来源。
    state.sourceStationId = null;
    state.viewport = { xMin: 0, xMax: 1199 };
    state.alarmContext = null;
    writeRoute("lock", id);
    return true;
  }

  function locateAlarm(alarmOrId) {
    const alarm = alarmById(alarmOrId);
    if (!alarm) return false;
    const context = {
      id: alarm.id,
      sourceId: alarm.sourceId,
      title: alarm.title,
    };
    if (alarm.scope === "machine" || alarm.sourceId === "MACHINE") {
      if (!navigate("overview", state.selectedStationId)) return false;
      closeStationDetail();
      state.alarmContext = context;
      showToast(`已定位整机状态 · ${alarm.title}`);
      return true;
    }
    if (alarm.scope === "signal") {
      if (!navigate("lock", alarm.sourceId, { sourceStationId: null }))
        return false;
      state.alarmContext = context;
      showToast(`已打开 ${alarm.sourceId} 检测曲线`);
      return true;
    }
    if (!navigate("overview", alarm.sourceId)) return false;
    state.alarmContext = context;
    state.selectedStationId = alarm.sourceId;
    state.detailOpen = true;
    writeRoute("overview", alarm.sourceId);
    showToast(`已定位 ${alarm.sourceId} · ${alarm.title}`);
    return true;
  }

  function clearAlarmContext() {
    state.alarmContext = null;
  }

  function confirmAlarm(id) {
    const alarm = state.alarms.find((item) => item.id === id);
    if (!alarm || alarm.acknowledged) return;
    alarm.acknowledged = true;
    alarm.acknowledgedAt = Date.now();
    showToast("报警已确认；确认不等于故障恢复");
  }

  function toggleFreeze() {
    //手动冻结/恢复
    // 手动冻结仅切换 displayedFrame；receiveSignalFrame 仍持续更新 latestFrame。
    const bucket = selectedSignal.value;
    if (!bucket) return;
    if (bucket.freezeMode === "manual") {
      bucket.freezeMode = "live";
      bucket.frozenAt = null;
      bucket.displayedFrame = bucket.latestFrame;
      bucket.displayedAt = bucket.latestReceivedAt;
      showToast("已恢复实时曲线");
    } else {
      bucket.freezeMode = "manual";
      bucket.frozenAt = Date.now();
      bucket.displayedFrame = bucket.latestFrame;
      bucket.displayedAt = bucket.latestReceivedAt;
      showToast("已冻结当前画面；后台仍继续接收信号");
    }
  }

  function beginSignalEdit() {
    // 拖动画框时暂存视觉帧，避免曲线在指针下刷新造成框选位置跳动。
    // 编辑结束后再恢复进入编辑前的 live/manual 模式。
    const id = state.selectedStationId;
    const bucket = state.signals[id];
    if (!bucket || bucket.freezeMode === "edit") return;
    clearTimeout(editTimers.get(id));
    bucket.modeBeforeEdit = bucket.freezeMode;
    bucket.freezeMode = "edit";
    bucket.displayedFrame = bucket.displayedFrame || bucket.latestFrame;
  }

  function endSignalEdit() {
    const id = state.selectedStationId;
    const bucket = state.signals[id];
    if (!bucket || bucket.freezeMode !== "edit") return;
    clearTimeout(editTimers.get(id));
    editTimers.set(
      id,
      setTimeout(() => {
        if (bucket.modeBeforeEdit === "manual") {
          bucket.freezeMode = "manual";
        } else {
          bucket.freezeMode = "live";
          bucket.displayedFrame = bucket.latestFrame;
          bucket.displayedAt = bucket.latestReceivedAt;
        }
      }, 300),
    );
  }

  function validWindow(windowData) {
    const normalized = normalizeWindow(windowData);
    if (!normalized) return null;
    if (
      normalized.xMax - normalized.xMin < 12 ||
      normalized.yMax - normalized.yMin < 5
    ) {
      showToast("请拖出更大的检测区域");
      return null;
    }
    return normalized;
  }
  //检查窗编辑
  function createOrSaveWindow(windowData) {
    const normalized = validWindow(windowData);
    if (!normalized) return false;
    const id = state.selectedStationId;
    if (state.windowEditModes[id] === "idle") beginWindowEdit();
    state.draftWindows[id] = normalized;
    if (state.windowEditModes[id] === "idle")
      state.windowEditModes[id] = state.windows[id] ? "editing" : "creating";
    showToast("检测窗草稿已更新，请应用或取消");
    return true;
  }

  function beginRecreateWindow() {
    const id = state.selectedStationId;
    const frame = state.signals[id]?.latestFrame;
    const center = frame?.references?.first ?? 210;
    state.windowEditSnapshots[id] = state.windows[id]
      ? { ...state.windows[id] }
      : null;
    state.windowEditModes[id] = state.windows[id] ? "editing" : "creating";
    state.draftWindows[id] = {
      xMin: Math.max(0, center - 60),
      xMax: Math.min(1199, center + 60),
      yMin: 35,
      yMax: 65,
    };
    showToast(
      state.windows[id]
        ? "已创建替换草稿，原检测窗尚未改变"
        : "已创建新检测窗草稿，应用后开始计算偏差",
    );
  }

  function confirmDraftWindow() {
    const id = state.selectedStationId;
    const draft = validWindow(state.draftWindows[id]);
    if (!draft) return false;

    // “应用”是检测窗唯一的提交点：先替换生效配置，再清空编辑态，最后持久化
    // 并记录审计信息。提交前的草稿不会参与实时偏差计算。
    const previous = state.windows[id] ? { ...state.windows[id] } : null;
    const appliedAt = Date.now();
    state.windows[id] = draft;
    state.draftWindows[id] = null;
    state.windowEditSnapshots[id] = null;
    state.windowEditModes[id] = "idle";
    state.windowAppliedAt[id] = appliedAt;
    state.windowAuditLog.unshift({
      stationId: id,
      previous,
      next: { ...draft },
      appliedAt,
    });
    if (state.windowAuditLog.length > 50) state.windowAuditLog.length = 50;
    persistSessionWindows();
    showToast(
      `${id} 检测窗已应用 · x ${Math.round(draft.xMin)}–${Math.round(draft.xMax)} · ${new Date(appliedAt).toLocaleTimeString("zh-CN", { hour12: false })}`,
    );
    return true;
  }

  function cancelDraftWindow() {
    return discardWindowDraft(state.selectedStationId);
  }

  function deleteWindow() {
    const id = state.selectedStationId;
    const previous = state.windows[id] ? { ...state.windows[id] } : null;
    state.windows[id] = null;
    state.draftWindows[id] = null;
    state.windowEditSnapshots[id] = null;
    state.windowEditModes[id] = "idle";
    state.windowAppliedAt[id] = null;
    state.windowAuditLog.unshift({
      stationId: id,
      previous,
      next: null,
      appliedAt: Date.now(),
      action: "delete",
    });
    persistSessionWindows();
    showToast("当前 PU 检测窗已删除");
  }

  function beginWindowEdit() {
    const id = state.selectedStationId;
    if (!signalStationIds.includes(id) || state.windowEditModes[id] !== "idle")
      return;
    const current = state.windows[id];
    if (!current) return;
    state.windowEditSnapshots[id] = current ? { ...current } : null;
    state.windowEditModes[id] = "editing";
    state.draftWindows[id] = { ...current };
  }

  function cancelWindowEdit() {
    return discardWindowDraft(state.selectedStationId);
  }

  function confirmWindowEdit() {
    if (!state.draftWindows[state.selectedStationId]) return false;
    return confirmDraftWindow();
  }

  function shiftWindow(delta) {
    const id = state.selectedStationId;
    if (!state.draftWindows[id] && state.windows[id]) beginWindowEdit();
    const target = state.draftWindows[id];
    if (!target) return;
    const width = target.xMax - target.xMin;
    const xMin = Math.max(0, Math.min(1199 - width, target.xMin + delta));
    state.draftWindows[id] = { ...target, xMin, xMax: xMin + width };
  }

  function nudgeRoller(delta) {
    const id = state.selectedStationId;
    state.rollerOffsets[id] = Math.max(
      -0.5,
      Math.min(0.5, +(state.rollerOffsets[id] + delta).toFixed(2)),
    );
    showToast(
      `${id} 模拟版辊偏移 ${state.rollerOffsets[id] >= 0 ? "+" : ""}${state.rollerOffsets[id].toFixed(2)} mm`,
    );
  }

  function resetRollerOffset() {
    const id = state.selectedStationId;
    state.rollerOffsets[id] = 0;
    showToast(`${id} 模拟版辊偏移已恢复为 0.00 mm`);
  }

  function zoom(delta) {
    const width = state.viewport.xMax - state.viewport.xMin;
    const nextWidth = Math.max(120, Math.min(1199, width + delta));
    const center = (state.viewport.xMin + state.viewport.xMax) / 2;
    const xMin = Math.max(
      0,
      Math.min(1199 - nextWidth, center - nextWidth / 2),
    );
    state.viewport = { xMin, xMax: xMin + nextWidth };
  }

  function pan(deltaRatio) {
    const width = state.viewport.xMax - state.viewport.xMin;
    const xMin = Math.max(
      0,
      Math.min(1199 - width, state.viewport.xMin + width * deltaRatio),
    );
    state.viewport = { xMin, xMax: xMin + width };
  }

  function resetViewport() {
    state.viewport = { xMin: 0, xMax: 1199 };
  }

  function ensureSignalAlarm(id, bucket, now) {
    // 将采集层的 signalStatus 映射成统一报警生命周期；恢复信号只解除 active，
    // 不替操作员自动确认报警，因此恢复后的记录仍可出现在待处理队列中。
    const alarmId = `signal-${id}`;
    let alarm = state.alarms.find((item) => item.id === alarmId);
    if (bucket.signalStatus === "interrupted") {
      if (!alarm) {
        alarm = {
          id: alarmId,
          sourceType: "signal",
          sourceId: id,
          severity: "warning",
          scope: "signal",
          title: "光电眼信号异常",
          message: "超过信号超时阈值，已保留最后有效帧",
          active: true,
          acknowledged: false,
          resetRequired: false,
          resetAt: null,
          occurredAt: now,
        };
        state.alarms.push(alarm);
      } else if (!alarm.active) {
        alarm.active = true;
        alarm.acknowledged = false;
        alarm.acknowledgedAt = undefined;
        alarm.recoveredAt = undefined;
        alarm.resetRequired = false;
        alarm.resetAt = null;
        alarm.occurredAt = now;
      }
    } else if (alarm?.active) {
      alarm.active = false;
      alarm.recoveredAt = now;
    }
  }
  //模拟信号丢失
  function simulateSignalLoss() {
    const bucket = selectedSignal.value;
    if (!bucket) return;
    bucket.simulatedLoss = !bucket.simulatedLoss;
    if (bucket.simulatedLoss) {
      bucket.lossStartedAt = Date.now();
      bucket.recoveryFrames = 0;
      ensureSignalAlarm(state.selectedStationId, bucket, Date.now());
      showToast("已模拟信号丢帧，超过 2 秒后进入中断");
    } else {
      if (bucket.signalStatus === "interrupted") {
        bucket.signalStatus = "recovering";
        bucket.recoveryFrames = 0;
      }
      showToast("信号恢复中，等待连续有效帧");
    }
  }

  function tickMachine() {
    // UI 中可能下发了速度/启停指令，先回灌到数据源，再生成下一份不可变快照
    // 覆盖响应式状态，形成“操作指令 → 模拟设备 → 界面刷新”的闭环。
    const now = Date.now();
    state.now = now;
    machineSource.machine.targetSpeedMpm = state.machine.targetSpeedMpm;
    machineSource.machine.runCommand = state.machine.runCommand;
    machineSource.machine.stations = machineSource.machine.stations.map(
      (sourceStation) => {
        const currentStation = state.machine.stations.find(
          (station) => station.id === sourceStation.id,
        );
        return currentStation
          ? { ...sourceStation, runCommand: currentStation.runCommand }
          : sourceStation;
      },
    );
    machineSource.alarms = state.alarms;
    const snapshot = machineSource.next(now);
    state.machine = snapshot.machine;
    state.alarms = snapshot.alarms;
  }

  function tickSignals() {
    //每个印刷单元的信号帧推进
    // 每个 PU 独立收帧：采集桶先更新帧和信号状态，再同步对应的信号报警。
    const now = Date.now();
    signalStationIds.forEach((id, index) => {
      const bucket = state.signals[id];
      receiveSignalFrame(bucket, index, now);
      ensureSignalAlarm(id, bucket, now);
    });
  }

  function handlePopState() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("pu");
    const nextPage = window.location.pathname.startsWith("/lock-mark")
      ? "lock"
      : "overview";
    const nextPu =
      nextPage === "lock"
        ? signalStationIds.includes(requested)
          ? requested
          : "PU2"
        : stationIds.includes(requested)
          ? requested
          : null;
    if (
      !navigate(nextPage, nextPu, { history: false, sourceStationId: null })
    ) {
      writeRoute(state.page, state.selectedStationId, "push");
    }
  }

  // 整机状态强调稳定趋势，1 秒刷新；光电曲线按验收要求以 500 ms 刷新。
  machineTimer = setInterval(tickMachine, 1000);
  signalTimer = setInterval(tickSignals, 500);
  window.addEventListener("popstate", handlePopState);
  onBeforeUnmount(() => {
    clearInterval(machineTimer);
    clearInterval(signalTimer);
    clearTimeout(toastTimer);
    editTimers.forEach((timer) => clearTimeout(timer));
    window.removeEventListener("popstate", handlePopState);
  });

  return {
    state,
    activeAlarms,
    pendingAlarms,
    pendingResetAlarms,
    alarmStats,
    alarmQueue,
    highestAlarm,
    alarmHeadline,
    alarmGroups,
    alarmStatusText: alarmLifecycleText,
    stationActionReasons,
    stationNeedsAction,
    stationAttentionLevel,
    stationStatusText,
    machineStartReason,
    canStartMachine,
    canResetAlarm,
    resetAlarm,
    stationStartReason,
    canStartStation,
    requestStartMachine,
    requestStartStation,
    selectedStation,
    selectedSignal,
    currentFrame,
    latestFrame,
    currentWindow,
    currentDraftWindow,
    displayWindow,
    isWindowEditing,
    hasUnsavedWindowChanges,
    displayedFrameAt,
    latestReceivedAt,
    signalStatus,
    isSignalInterrupted,
    isSignalLossSimulated,
    machineDataAgeMs,
    isMachineDataDelayed,
    machineDataStatus,
    currentDeviation,
    showToast,
    navigate,
    closeStationDetail,
    setTargetSpeed,
    selectStation,
    enterLock,
    chooseStation,
    locateAlarm,
    clearAlarmContext,
    confirmAlarm,
    toggleFreeze,
    beginSignalEdit,
    endSignalEdit,
    createOrSaveWindow,
    beginRecreateWindow,
    confirmDraftWindow,
    cancelDraftWindow,
    discardWindowDraft,
    allowLeavingWindowEditor,
    deleteWindow,
    beginWindowEdit,
    cancelWindowEdit,
    confirmWindowEdit,
    shiftWindow,
    nudgeRoller,
    resetRollerOffset,
    zoom,
    pan,
    resetViewport,
    simulateSignalLoss,
  };
}
