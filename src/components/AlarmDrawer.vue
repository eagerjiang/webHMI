<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  alarms: { type: Array, required: true },
  machine: { type: Object, required: true },
  canResetAlarm: { type: Function, required: true },
  alarmStatusText: { type: Function, required: true },
  canStartMachine: { type: Boolean, default: false },
  machineStartReason: { type: String, default: "" },
});
const emit = defineEmits([
  "close",
  "acknowledge",
  "reset",
  "start-machine",
  "locate",
]);
const confirmMachineStart = ref(false);
const activeFilter = ref("all");
const drawer = ref(null);
const closeButton = ref(null);
let previousFocus = null;

const counts = computed(() => ({
  all: props.alarms.length,
  active: props.alarms.filter((alarm) => alarm.active).length,
  pendingAck: props.alarms.filter((alarm) => !alarm.acknowledged).length,
  pendingReset: props.alarms.filter((alarm) => props.canResetAlarm(alarm))
    .length,
}));

const filters = computed(() => [
  { id: "all", label: "需处理", count: counts.value.all },
  { id: "active", label: "活动", count: counts.value.active },
  { id: "pendingAck", label: "待确认", count: counts.value.pendingAck },
  { id: "pendingReset", label: "待复位", count: counts.value.pendingReset },
]);

const filteredAlarms = computed(() =>
  props.alarms.filter((alarm) => {
    if (activeFilter.value === "active") return alarm.active;
    if (activeFilter.value === "pendingAck") return !alarm.acknowledged;
    if (activeFilter.value === "pendingReset")
      return props.canResetAlarm(alarm);
    return true;
  }),
);

const alarmSections = computed(() =>
  [
    {
      id: "active",
      title: "活动报警",
      hint: "条件仍存在，优先处理",
      alarms: filteredAlarms.value.filter((alarm) => alarm.active),
    },
    {
      id: "recovered",
      title: "已恢复 · 待闭环",
      hint: "条件已恢复，仍需确认或复位",
      alarms: filteredAlarms.value.filter((alarm) => !alarm.active),
    },
  ].filter((section) => section.alarms.length),
);

function locateLabel(alarm) {
  if (alarm.scope === "machine" || alarm.sourceId === "MACHINE")
    return "查看整机状态";
  if (alarm.scope === "signal") return `查看 ${alarm.sourceId} 曲线`;
  return `定位 ${alarm.sourceId}`;
}

function impactText(alarm) {
  if (alarm.scope === "machine" || alarm.sourceId === "MACHINE")
    return "影响整线";
  if (alarm.scope === "signal") return "影响测量可信度";
  if (alarm.severity === "stop") return "当前单元停机";
  return "当前单元需关注";
}

function resetButtonText(alarm) {
  if (props.canResetAlarm(alarm)) return "↻ 复位报警";
  if (alarm.active) return "⚠ 故障仍存在";
  if (!alarm.acknowledged) return "✓ 请先确认";
  return "↻ 暂不可复位";
}

function resetButtonTitle(alarm) {
  if (props.canResetAlarm(alarm)) return "故障已恢复且报警已确认，可以复位";
  if (alarm.active) return "故障条件仍存在，恢复后才可复位";
  if (!alarm.acknowledged) return "故障已恢复，请先确认报警";
  return "当前条件不允许复位";
}

function requestClose() {
  emit("close");
}

function focusableElements() {
  return [
    ...(drawer.value?.querySelectorAll(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) || []),
  ];
}

function onKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusableElements();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  previousFocus = document.activeElement;
  nextTick(() => closeButton.value?.focus());
});

onBeforeUnmount(() => previousFocus?.focus?.());
</script>

<template>
  <div class="drawer-backdrop" @click.self="requestClose">
    <aside
      ref="drawer"
      class="alarm-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alarm-drawer-title"
      @keydown="onKeydown"
    >
      <div class="drawer-head">
        <div>
          <small>ALARM QUEUE</small>
          <h2 id="alarm-drawer-title">报警处理</h2>
        </div>
        <button
          ref="closeButton"
          class="icon-button"
          aria-label="关闭报警列表"
          @click="requestClose"
        >
          ×
        </button>
      </div>

      <div class="alarm-drawer-summary" aria-label="报警统计">
        <span
          ><b>{{ counts.active }}</b
          >活动</span
        >
        <span
          ><b>{{ counts.pendingAck }}</b
          >待确认</span
        >
        <span
          ><b>{{ counts.pendingReset }}</b
          >待复位</span
        >
      </div>

      <div class="alarm-filter" aria-label="报警状态筛选">
        <button
          v-for="filter in filters"
          :key="filter.id"
          :class="{ active: activeFilter === filter.id }"
          :aria-pressed="activeFilter === filter.id"
          @click="activeFilter = filter.id"
        >
          {{ filter.label }} <b>{{ filter.count }}</b>
        </button>
      </div>

      <div class="alarm-list" tabindex="0" aria-label="可滚动报警列表">
        <section
          v-for="section in alarmSections"
          :key="section.id"
          class="alarm-section"
          :class="section.id"
        >
          <div class="alarm-section-head">
            <div>
              <strong>{{ section.title }}</strong
              ><small>{{ section.hint }}</small>
            </div>
            <b>{{ section.alarms.length }}</b>
          </div>
          <article
            v-for="alarm in section.alarms"
            :key="alarm.id"
            class="alarm-row"
            :class="[
              alarm.severity,
              {
                recovered: !alarm.active,
                resettable: props.canResetAlarm(alarm),
              },
            ]"
          >
            <div class="alarm-copy">
              <strong>{{ alarm.sourceId }} · {{ alarm.title }}</strong>
              <div class="alarm-meta-row">
                <span class="alarm-badge">{{
                  alarm.severity === "stop" ? "停机级" : "警告"
                }}</span
                ><span class="impact-badge">{{ impactText(alarm) }}</span>
              </div>
              <p>{{ alarm.message }}</p>
              <small
                >{{
                  new Date(alarm.occurredAt).toLocaleTimeString("zh-CN", {
                    hour12: false,
                  })
                }}
                · {{ props.alarmStatusText(alarm) }}</small
              >
              <button
                class="alarm-locate-button"
                @click="emit('locate', alarm)"
              >
                {{ locateLabel(alarm) }} →
              </button>
            </div>
            <div class="alarm-actions">
              <button
                v-if="!alarm.acknowledged"
                class="mini-button acknowledge-button"
                @click="emit('acknowledge', alarm.id)"
              >
                ✓ 确认报警
              </button>
              <button
                v-if="alarm.resetRequired"
                class="mini-button reset-button"
                :class="{
                  'condition-active': alarm.active,
                  'waiting-ack': !alarm.active && !alarm.acknowledged,
                }"
                :disabled="!props.canResetAlarm(alarm)"
                :title="resetButtonTitle(alarm)"
                @click="emit('reset', alarm.id)"
              >
                {{ resetButtonText(alarm) }}
              </button>
            </div>
          </article>
        </section>
        <div v-if="!filteredAlarms.length" class="empty-state">
          当前筛选下没有报警
        </div>
      </div>

      <div
        v-if="machine.runState === 'stop'"
        class="machine-start-card alarm-drawer-footer"
      >
        <div>
          <strong>整机已停止</strong
          ><small>{{
            canStartMachine ? "启动条件满足" : machineStartReason
          }}</small>
        </div>
        <button
          v-if="!confirmMachineStart"
          class="primary-button mini-button"
          :disabled="!canStartMachine"
          @click="confirmMachineStart = true"
        >
          启动整机
        </button>
        <div v-else class="inline-confirm-actions">
          <span>确认启动整机？</span
          ><button
            class="primary-button mini-button"
            @click="
              emit('start-machine');
              confirmMachineStart = false;
            "
          >
            确认</button
          ><button
            class="outline-button mini-button"
            @click="confirmMachineStart = false"
          >
            取消
          </button>
        </div>
      </div>
    </aside>
  </div>
</template>
