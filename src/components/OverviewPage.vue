<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import MachineCanvas from './MachineCanvas.vue'
import PrintUnitDiagram from './PrintUnitDiagram.vue'

const props = defineProps({ hmi: { type: Object, required: true } })
const emit = defineEmits(['open-alarms'])
const machine = computed(() => props.hmi.state.machine)
const selected = computed(() => props.hmi.selectedStation.value)
const widthClass = computed(() => props.hmi.state.detailOpen ? 'detail-mode' : 'overview-mode')
const speedPresets = [24, 36, 120, 150]
const alarmFilter = ref('all')
const diagramExpanded = ref(false)
const diagramDialog = ref(null)
const diagramCloseButton = ref(null)
const pendingStationStart = ref(null)
const pendingSpeed = ref(null)
const stationRail = ref(null)
let diagramTrigger = null

const selectedAlarm = computed(() => {
  if (!selected.value) return null
  return props.hmi.alarmQueue.value.find(alarm => alarm.sourceId === selected.value.id) || null
})
const visibleStations = computed(() => alarmFilter.value === 'needs-action'
  ? machine.value.stations.filter(station => props.hmi.stationNeedsAction(station.id))
  : machine.value.stations)
const latestAlarm = computed(() => props.hmi.alarmQueue.value[0] || null)

function statusText(station) {
  return props.hmi.stationStatusText(station.id)
}

function statusClass(station) {
  return props.hmi.stationAttentionLevel(station.id)
}

function railStatusText(station) {
  const text = statusText(station)
  if (text === '停机级报警') return '停机'
  if (text === '活动警告') return '警告'
  return text
}

function setSpeed(speed) {
  if (Math.abs(speed - machine.value.targetSpeedMpm) > 10) {
    pendingSpeed.value = speed
    return
  }
  applySpeed(speed)
}

function applySpeed(speed = pendingSpeed.value) {
  if (speed == null) return
  props.hmi.setTargetSpeed(speed)
  props.hmi.showToast(`演示目标速度已更新为 ${speed} m/min`)
  pendingSpeed.value = null
}

function scrollSelectedStation() {
  nextTick(() => {
    const item = stationRail.value?.querySelector(`[data-station-id="${props.hmi.state.selectedStationId}"]`)
    item?.scrollIntoView?.({ behavior: 'auto', block: 'nearest', inline: 'center' })
  })
}

function selectFromRail(id) {
  props.hmi.selectStation(id)
}

function selectFromCanvas(id) {
  props.hmi.selectStation(id)
}

function openDiagram() {
  diagramTrigger = document.activeElement
  diagramExpanded.value = true
  nextTick(() => diagramCloseButton.value?.focus())
}

function closeDiagram() {
  diagramExpanded.value = false
  nextTick(() => diagramTrigger?.focus?.())
}

function onDiagramKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDiagram()
    return
  }
  if (event.key !== 'Tab') return
  const items = [...(diagramDialog.value?.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])]
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function requestStationStart(id) {
  pendingStationStart.value = id
}

function confirmStationStart() {
  if (pendingStationStart.value) props.hmi.requestStartStation(pendingStationStart.value)
  pendingStationStart.value = null
}

function cancelStationStart() {
  pendingStationStart.value = null
}

function closeStationDetail() {
  pendingStationStart.value = null
  diagramExpanded.value = false
  diagramTrigger = null
  props.hmi.closeStationDetail()
}

watch(() => props.hmi.state.selectedStationId, scrollSelectedStation)
onMounted(scrollSelectedStation)
</script>

<template>
  <section class="page overview-page" :class="widthClass">
    <div class="page-heading overview-heading">
      <div class="heading-actions">
        <span class="data-freshness" :class="{ delayed: props.hmi.isMachineDataDelayed.value }">
          <i class="status-dot" :class="props.hmi.isMachineDataDelayed.value ? 'warning' : 'run'"></i>
          数据状态 · {{ props.hmi.machineDataStatus.value }}
        </span>
        <button v-if="props.hmi.state.detailOpen" class="outline-button" @click="closeStationDetail">返回整线总览</button>
      </div>
    </div>

    <div v-if="props.hmi.state.alarmContext" class="alarm-context-banner">
      <span>来自报警：{{ props.hmi.state.alarmContext.sourceId }} · {{ props.hmi.state.alarmContext.title }}</span>
      <button aria-label="关闭报警上下文" @click="props.hmi.clearAlarmContext">×</button>
    </div>

    <div class="overview-grid">
      <div class="canvas-card">
        <div class="canvas-toolbar">
          <span><i class="status-dot" :class="machine.runState === 'run' ? 'run' : 'stop'"></i> {{ machine.runState === 'run' ? '材料走料中' : '材料走料已停止' }}</span>
          <div class="toolbar-spacer"></div>
          <span class="canvas-view-label">工艺视图 · 工艺路径</span>
        </div>

        <MachineCanvas
          :machine="machine"
          :selected-id="props.hmi.state.selectedStationId"
          :attention-level="props.hmi.stationAttentionLevel"
          :status-text="props.hmi.stationStatusText"
          @select="selectFromCanvas"
        />

        <div class="station-rail">
          <div class="station-rail-head">
            <div><div class="eyebrow">PRINT UNIT STATUS</div><strong>印刷单元状态带</strong></div>
            <div class="rail-filter" aria-label="色组状态筛选">
              <button :class="{ active: alarmFilter === 'all' }" @click="alarmFilter = 'all'">全部</button>
              <button :class="{ active: alarmFilter === 'needs-action' }" @click="alarmFilter = 'needs-action'">需处理</button>
            </div>
          </div>
          <div class="station-rail-scroll-wrap">
          <div ref="stationRail" class="station-rail-items">
            <button v-for="station in visibleStations" :key="station.id" :data-station-id="station.id" class="station-rail-item" :class="[{ selected: station.id === selected?.id }, statusClass(station)]" @click="selectFromRail(station.id)">
              <span class="station-rail-index">{{ station.id.replace('PU', '').padStart(2, '0') }}</span>
              <span class="process-swatch" :style="{ background: station.color }" :title="`${station.colorName} 工艺色`"></span>
              <i class="status-dot" :class="statusClass(station)"></i>
              <span>{{ railStatusText(station) }}</span>
              <b v-if="props.hmi.stationNeedsAction(station.id)" class="station-rail-alert">!</b>
            </button>
            <span v-if="!visibleStations.length" class="rail-empty">当前没有需要处理的色组</span>
          </div>
          </div>
        </div>
      </div>

      <aside class="context-panel" :class="{ expanded: props.hmi.state.detailOpen }">
        <template v-if="props.hmi.state.detailOpen && selected">
          <div class="context-panel-scroll">
          <div class="panel-head">
            <div><div class="eyebrow">SELECTED STATION</div><h2>{{ selected.id }} 印刷单元 <span>/ {{ selected.colorName }}</span></h2></div>
          <button class="icon-button" aria-label="返回整线总览" @click="closeStationDetail">×</button>
          </div>

          <PrintUnitDiagram :station="selected" compact @expand="openDiagram" />

          <div class="state-banner" :class="statusClass(selected)">
            <span class="status-dot" :class="statusClass(selected)"></span>
            <strong>{{ statusText(selected) }}</strong>
            <small>{{ selected.lockEye === 'online' ? '光电眼在线' : '暂无锁定标记检测' }}</small>
          </div>

          <div v-if="selectedAlarm" class="station-alarm-card" :class="selectedAlarm.severity">
            <div><span class="alarm-badge">{{ selectedAlarm.severity === 'stop' ? '停机' : '警告' }}</span><strong>{{ selectedAlarm.title }}</strong></div>
            <p>{{ selectedAlarm.message }}</p>
            <small>{{ new Date(selectedAlarm.occurredAt).toLocaleTimeString('zh-CN', { hour12: false }) }} · {{ props.hmi.alarmStatusText(selectedAlarm) }}</small>
          </div>

          <div class="detail-section-label">套色与印刷单元关键数据 · 最近更新 {{ new Date(props.hmi.state.machine.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</div>
          <div class="key-parameter-grid">
            <div><small>套色纵向偏差（MD）</small><b>{{ selected.offsetLongitudinalMm.toFixed(2) }} <i>mm</i></b></div>
            <div><small>套色横向偏差（CD）</small><b>{{ selected.offsetLateralMm.toFixed(2) }} <i>mm</i></b></div>
            <div><small>凹版辊转速</small><b>{{ selected.rollerRpm.toFixed(1) }} <i>rpm</i></b></div>
            <div><small>段间张力</small><b>{{ selected.tensionN.toFixed(1) }} <i>N</i></b></div>
          </div>

          <details class="more-parameters">
            <summary><span>更多参数</span><b>4 项 · 仅监视</b></summary>
            <div class="parameter-grid">
              <div><small>刮刀压力</small><b>{{ selected.doctorPressureBar.toFixed(1) }} <i>bar</i></b></div>
              <div><small>压印辊合压压力</small><b>{{ selected.impressionPressureBar.toFixed(1) }} <i>bar</i></b></div>
              <div><small>干燥温度</small><b>{{ selected.dryerTempC.toFixed(1) }} <i>°C</i></b></div>
              <div><small>油墨黏度</small><b>{{ selected.inkViscosityS.toFixed(1) }} <i>s</i></b></div>
            </div>
          </details>
          </div>

          <div class="context-panel-actions">
            <button v-if="selected.id !== 'PU1'" class="primary-button full" @click="props.hmi.enterLock(selected.id)">查看 {{ selected.id }} 检测曲线</button>
            <button v-else class="outline-button full" disabled>PU1 暂无锁定标记检测</button>
            <div v-if="selected.runState === 'stop'" class="station-start-card">
              <button v-if="pendingStationStart !== selected.id" class="outline-button full" :disabled="!props.hmi.canStartStation(selected.id)" @click="requestStationStart(selected.id)">启动 {{ selected.id }}</button>
              <div v-else class="inline-confirm-actions"><span>确认启动 {{ selected.id }}？</span><button class="primary-button mini-button" @click="confirmStationStart">确认</button><button class="outline-button mini-button" @click="cancelStationStart">取消</button></div>
              <small>{{ props.hmi.canStartStation(selected.id) ? '启动条件满足' : props.hmi.stationStartReason(selected.id) }}</small>
            </div>
            <button class="text-button full" @click="closeStationDetail">返回整线总览</button>
          </div>
        </template>

        <template v-else>
          <div class="machine-summary-title"><span class="status-dot" :class="machine.runState === 'run' ? 'run' : 'stop'"></span><strong>{{ machine.runState === 'run' ? '整线运行中' : '整线已停止' }}</strong></div>
          <div class="context-summary-list">
            <span>实际线速度 <b>{{ machine.speedMpm.toFixed(1) }} m/min</b></span>
            <span>需处理报警 <b :class="props.hmi.highestAlarm.value === 'normal' ? '' : 'warning-text'">{{ props.hmi.alarmStats.value.needsAction }} 条</b></span>
            <span>最新来源 <b :class="latestAlarm?.severity === 'stop' ? 'danger-text' : latestAlarm ? 'warning-text' : ''">{{ latestAlarm ? `${latestAlarm.sourceId} · ${latestAlarm.title}` : '暂无待处理报警' }}</b></span>
            <span>数据 <b>{{ props.hmi.machineDataStatus.value }}</b></span>
          </div>
          <button class="primary-button full" @click="emit('open-alarms')">打开报警列表</button>
        </template>
      </aside>
    </div>

    <div class="bottom-rail">
      <div class="rail-block speed-readout-block">
        <div class="eyebrow">SPEED STATUS</div>
        <div class="speed-readout"><span>实际线速度 <b>{{ machine.speedMpm.toFixed(1) }}</b> m/min</span><span>目标线速度 <b>{{ machine.targetSpeedMpm.toFixed(1) }}</b> m/min</span><span>{{ machine.motionPhase === 'accelerating' ? '加速中' : machine.motionPhase === 'decelerating' ? '减速中' : machine.runState === 'stop' ? '已停止' : '稳速' }} · {{ machine.runMode === 'auto' ? '自动' : '手动' }}</span></div>
      </div>
      <div class="rail-block speed-control"><div class="eyebrow">模拟目标速度 / TARGET</div><div class="stepper"><button @click="applySpeed(machine.targetSpeedMpm - 1)">−</button><b>{{ machine.targetSpeedMpm.toFixed(1) }}</b><button @click="applySpeed(machine.targetSpeedMpm + 1)">+</button></div></div>
      <div class="rail-block quick-speed-block"><div class="eyebrow">QUICK SPEED / TIMING</div><div class="preset-row"><button v-for="speed in speedPresets" :key="speed" :class="{ selected: machine.targetSpeedMpm === speed }" @click="setSpeed(speed)">{{ speed }}</button><small>m/min</small></div><div class="rail-values"><span>加速 {{ machine.accelerationTimeS }} s</span><span>减速 {{ machine.decelerationTimeS }} s</span></div></div>
      <div class="rail-block reel-extended-block"><div class="eyebrow">REELS / TENSION</div><div class="rail-values"><span>放卷 {{ machine.unwind.activeAxis }}（运行轴）· {{ machine.unwind.axes[machine.unwind.activeAxis].lengthM }} m · 摆臂 {{ machine.unwind.armPositionPct.toFixed(0) }}%</span><span>收卷 {{ machine.rewind.activeAxis }}（运行轴）· {{ machine.rewind.axes[machine.rewind.activeAxis].lengthM }} m · 摆臂 {{ machine.rewind.armPositionPct.toFixed(0) }}%</span><span>放卷张力 {{ machine.unwind.tensionN.toFixed(1) }} N</span></div></div>
      <div class="rail-block event-block"><div class="eyebrow">LATEST EVENT</div><template v-if="latestAlarm"><b :class="latestAlarm.severity === 'stop' ? 'danger-text' : 'warning-text'">{{ latestAlarm.sourceId }} · {{ latestAlarm.title }}</b><small>{{ props.hmi.alarmStatusText(latestAlarm) }}</small></template><template v-else><b>暂无待处理报警</b><small>报警流程已闭环</small></template></div>
      <details class="compact-secondary-rail">
        <summary>卷材 / 张力 / 速度预设</summary>
        <div class="compact-secondary-grid">
          <div><b>放卷 {{ machine.unwind.activeAxis }}</b><span>剩余 {{ machine.unwind.axes[machine.unwind.activeAxis].lengthM }} m · 张力 {{ machine.unwind.tensionN.toFixed(1) }} N</span></div>
          <div><b>收卷 {{ machine.rewind.activeAxis }}</b><span>当前 {{ machine.rewind.axes[machine.rewind.activeAxis].lengthM }} m · 张力 {{ machine.rewind.tensionN.toFixed(1) }} N</span></div>
          <div class="compact-presets"><b>速度预设</b><span><button v-for="speed in speedPresets" :key="speed" @click="setSpeed(speed)">{{ speed }}</button></span></div>
        </div>
      </details>
      <div v-if="pendingSpeed != null" class="speed-confirm-strip"><span>模拟目标速度将从 {{ machine.targetSpeedMpm.toFixed(1) }} 调整到 {{ pendingSpeed.toFixed(1) }} m/min</span><div><button class="primary-button" @click="applySpeed()">确认调整</button><button class="outline-button" @click="pendingSpeed = null">取消</button></div></div>
    </div>

    <div v-if="diagramExpanded && selected" class="diagram-modal-backdrop" @click.self="closeDiagram" @keydown="onDiagramKeydown">
      <div ref="diagramDialog" class="diagram-modal" role="dialog" aria-modal="true" aria-labelledby="diagram-modal-title">
        <div class="diagram-modal-head"><div><div class="eyebrow">PRINT UNIT DETAIL</div><strong id="diagram-modal-title">{{ selected.id }} · {{ selected.colorName }}</strong></div><button ref="diagramCloseButton" class="icon-button" aria-label="关闭原理图" @click="closeDiagram">×</button></div>
        <PrintUnitDiagram :station="selected" />
      </div>
    </div>
  </section>
</template>
