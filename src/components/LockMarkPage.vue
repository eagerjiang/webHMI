<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SignalCanvas from './SignalCanvas.vue'
import { stationIds, stationColors, stationNames } from '../data/mock'

const props = defineProps({ hmi: { type: Object, required: true } })
// 页面只组合 Store 的派生数据；信号采集、检测窗提交和报警规则都留在 useHmi 中。
const selected = computed(() => props.hmi.selectedStation.value)
const selectedSignal = computed(() => props.hmi.selectedSignal.value)
const frame = computed(() => props.hmi.currentFrame.value)
const savedWindow = computed(() => props.hmi.currentWindow.value)
const draftWindow = computed(() => props.hmi.currentDraftWindow.value)
const displayWindow = computed(() => props.hmi.displayWindow.value)
const currentDeviation = computed(() => props.hmi.currentDeviation.value)
const showDeleteConfirm = ref(false)
const showRecreateConfirm = ref(false)
const pointerEditing = ref(false)
const pressTimer = ref(null)
const pressInterval = ref(null)
const puTabScroll = ref(null)

const signalStatus = computed(() => {
  if (selectedSignal.value?.freezeMode === 'manual') return '已冻结'
  if (selectedSignal.value?.freezeMode === 'edit') return '编辑中'
  if (props.hmi.signalStatus.value === 'interrupted') return '信号中断'
  if (props.hmi.signalStatus.value === 'recovering') return '信号恢复中'
  return '实时'
})
const signalStatusClass = computed(() => {
  if (props.hmi.signalStatus.value !== 'live') return 'warning'
  return selectedSignal.value?.freezeMode === 'manual' || selectedSignal.value?.freezeMode === 'edit' ? 'frozen' : 'run'
})
const isSignalInterrupted = computed(() => props.hmi.signalStatus.value !== 'live')
const draftTitle = computed(() => savedWindow.value ? '替换草稿未应用' : '新建草稿未应用')
const draftHelp = computed(() => savedWindow.value ? '当前仍使用原检测窗计算偏差' : '应用后开始用于偏差计算')
const appliedText = computed(() => {
  const timestamp = props.hmi.state.windowAppliedAt[props.hmi.state.selectedStationId]
  return timestamp ? `演示会话内已应用 · ${formatTime(timestamp)}` : '演示会话内已应用'
})
const deviationRows = computed(() => {
  // MD 来自最新有效信号帧的峰值计算；CD 使用色组横向偏差叠加演示版辊微调。
  // 没有已应用窗口或信号异常时统一返回 null，避免把旧帧显示成实时测量值。
  const long = currentDeviation.value?.longitudinalMm
  const deviations = currentDeviation.value?.deviations || {}
  const hasValidWindow = Boolean(savedWindow.value) && !isSignalInterrupted.value
  const lateral = hasValidWindow ? (selected.value?.offsetLateralMm ?? 0) : null
  const roller = props.hmi.state.rollerOffsets[props.hmi.state.selectedStationId] ?? 0
  return [
    { name: '本色', key: 'current', long: deviations.current ?? long, lat: lateral == null ? null : lateral + roller },
    { name: '前色', key: 'previous', long: deviations.previous ?? null, lat: lateral == null ? null : lateral + roller },
    { name: '首色', key: 'first', long: deviations.first ?? long, lat: lateral == null ? null : lateral + roller }
  ]
})

function choose(id) {
  if (!props.hmi.chooseStation(id)) return
  showDeleteConfirm.value = false
  showRecreateConfirm.value = false
}

function scrollSelectedTab() {
  nextTick(() => {
    const button = puTabScroll.value?.querySelector(`[data-station-id="${props.hmi.state.selectedStationId}"]`)
    button?.scrollIntoView?.({ behavior: 'auto', block: 'nearest', inline: 'center' })
  })
}

function onWindowChange(data) {
  // SignalCanvas 输出业务坐标后只更新草稿；用户点击“应用”才替换生效检测窗。
  props.hmi.createOrSaveWindow(data)
}

function onInteractionStart() {
  // 框选期间冻结视觉帧以稳定指针参照，但后台 latestFrame 仍持续接收。
  pointerEditing.value = true
  props.hmi.beginWindowEdit()
  props.hmi.beginSignalEdit()
}

function onInteractionEnd() {
  pointerEditing.value = false
  props.hmi.endSignalEdit()
}

function onPan(ratio) {
  props.hmi.pan(ratio)
}

function startPress(action, delta, accelerate = true) {
  // 微调按钮短按执行一次，长按在 500 ms 后连续触发；窗口移动可逐步加速。
  stopPress()
  action(delta)
  pressTimer.value = window.setTimeout(() => {
    let step = delta
    pressInterval.value = window.setInterval(() => {
      action(step)
      if (accelerate) step *= 1.35
    }, 100)
  }, 500)
}

function stopPress() {
  if (pressTimer.value) window.clearTimeout(pressTimer.value)
  if (pressInterval.value) window.clearInterval(pressInterval.value)
  pressTimer.value = null
  pressInterval.value = null
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (showDeleteConfirm.value || showRecreateConfirm.value) {
      showDeleteConfirm.value = false
      showRecreateConfirm.value = false
      return
    }
    if (draftWindow.value) props.hmi.cancelWindowEdit()
    return
  }

  const target = event.target
  const insideEditor = target?.closest?.('.window-editor-region')
  const isControl = target?.closest?.('button, a, input, select, textarea, [role="button"]')
  if (!insideEditor || isControl) return

  if (event.key === 'Enter' && draftWindow.value && props.hmi.isWindowEditing.value) {
    event.preventDefault()
    props.hmi.confirmWindowEdit()
  } else if (event.key === 'Delete' && savedWindow.value) {
    event.preventDefault()
    requestDelete()
  }
}

function onBeforeUnload(event) {
  if (!draftWindow.value) return
  event.preventDefault()
  event.returnValue = ''
}

function requestRecreate() {
  if (savedWindow.value) showRecreateConfirm.value = true
  else props.hmi.beginRecreateWindow()
}

function confirmRecreate() {
  showRecreateConfirm.value = false
  props.hmi.beginRecreateWindow()
}

function requestDelete() {
  if (savedWindow.value) showDeleteConfirm.value = true
}

function confirmDelete() {
  showDeleteConfirm.value = false
  props.hmi.deleteWindow()
}

function formatValue(value) {
  if (value == null || isSignalInterrupted.value) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} mm`
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—'
}

watch(() => props.hmi.state.selectedStationId, scrollSelectedTab)
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  scrollSelectedTab()
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  stopPress()
})
</script>

<template>
  <section class="page lock-page" @keydown="onKeydown">
    <div class="page-heading">
      <div><div class="eyebrow">LOCK MARK / SIGNAL WORKBENCH</div><h1>锁定标记</h1></div>
      <div class="heading-actions">
        <span v-if="props.hmi.state.sourceStationId" class="source-pill">已从整机 {{ props.hmi.state.sourceStationId }} 进入</span>
        <button class="outline-button" @click="props.hmi.navigate('overview')">返回整机</button>
      </div>
    </div>

    <div v-if="props.hmi.state.alarmContext" class="alarm-context-banner">
      <span>来自报警：{{ props.hmi.state.alarmContext.sourceId }} · {{ props.hmi.state.alarmContext.title }}</span>
      <button aria-label="关闭报警上下文" @click="props.hmi.clearAlarmContext">×</button>
    </div>

    <div class="pu-strip">
      <span class="eyebrow">印刷色组 / PRINT UNIT</span>
      <div class="pu-tab-scroll-wrap">
      <div ref="puTabScroll" class="pu-tab-scroll">
        <button v-for="id in stationIds.slice(1)" :key="id" :data-station-id="id" class="pu-tab" :class="{ selected: id === props.hmi.state.selectedStationId }" @click="choose(id)"><i :style="{ background: stationColors[id] }"></i><span>{{ id }}</span><small>{{ props.hmi.state.draftWindows[id] ? '草稿' : props.hmi.state.windows[id] ? '已设窗' : '未设窗' }}</small></button>
      </div>
      </div>
      <div class="signal-online"><span class="status-dot" :class="signalStatusClass"></span>{{ signalStatus }} · 500ms</div>
    </div>

    <div class="lock-grid">
      <div class="signal-card window-editor-region">
        <div class="signal-toolbar"><span><b>{{ selected?.id }}</b> / {{ stationNames[props.hmi.state.selectedStationId] }} · 光电眼曲线</span><span class="canvas-meta">1200 点 · 信号强度 0–100%</span><div class="toolbar-spacer"></div><div class="curve-thresholds"><span class="warning">预警 0.10 mm</span><span class="stop">停机 0.20 mm</span></div><button class="text-button" @click="props.hmi.simulateSignalLoss">{{ props.hmi.isSignalLossSimulated.value ? '恢复模拟信号' : '模拟信号中断（演示）' }}</button></div>
        <SignalCanvas :frame="frame" :window-data="displayWindow" :viewport="props.hmi.state.viewport" :signal-interrupted="isSignalInterrupted" :is-draft="Boolean(draftWindow)" @change="onWindowChange" @pan="onPan" @interaction-start="onInteractionStart" @interaction-end="onInteractionEnd" />
        <div class="signal-footer"><span class="legend"><i class="legend-line waveform"></i>显示波形</span><span class="legend"><i class="legend-line first"></i>首色主参考</span><span class="legend"><i class="legend-line previous"></i>前色辅助</span><span class="legend"><i class="legend-line current"></i>本色</span><span v-if="pointerEditing" class="last-frame warning-text">编辑中 · 暂停视觉帧</span><span v-else-if="selectedSignal?.freezeMode === 'manual'" class="last-frame frozen-frame">冻结于 {{ formatTime(selectedSignal?.frozenAt) }} · 数据帧 {{ formatTime(props.hmi.displayedFrameAt.value) }}</span><span v-else class="last-frame">最新帧 {{ formatTime(props.hmi.latestReceivedAt.value) }} · 最后显示 {{ formatTime(props.hmi.displayedFrameAt.value) }}</span></div>
      </div>

      <aside class="lock-inspector">
        <div class="lock-inspector-scroll">
          <div class="panel-head"><div><div class="eyebrow">LOCK MARK INSPECTOR</div><h2>{{ selected?.id }} <span>/ {{ selected?.colorName }}</span></h2></div><span class="state-chip" :class="signalStatusClass"><i class="status-dot" :class="signalStatusClass"></i>{{ signalStatus }}</span></div>

          <div v-if="draftWindow" class="draft-banner"><strong>{{ draftTitle }}</strong><small>{{ draftHelp }}</small></div>
          <div v-else-if="savedWindow" class="applied-banner">{{ appliedText }}</div>
          <div class="coordinate-box" v-if="displayWindow"><small>{{ draftWindow ? '当前草稿 · 数据坐标' : '当前检测窗 · 数据坐标' }}</small><strong>x {{ Math.round(displayWindow.xMin) }} — {{ Math.round(displayWindow.xMax) }} <i>sample</i></strong><strong>y {{ displayWindow.yMin.toFixed(0) }} — {{ displayWindow.yMax.toFixed(0) }} <i>%</i></strong></div>
          <div class="coordinate-box empty" v-else><small>当前未设置检测窗</small><strong>新建后开始用于偏差计算</strong></div>

          <div class="deviation-table"><div class="table-head"><span>参考色</span><span>套色纵向偏差（MD）</span><span>套色横向偏差（CD）</span></div><div v-for="item in deviationRows" :key="item.key" class="table-row"><b>{{ item.name }}</b><span :class="item.long != null && Math.abs(item.long) >= .2 ? 'danger-text' : item.long != null && Math.abs(item.long) >= .1 ? 'warning-text' : ''">{{ formatValue(item.long) }}</span><span>{{ formatValue(item.lat) }}</span></div></div>
          <div class="threshold-note"><span>预警阈值 0.10 mm</span><span>停机阈值 0.20 mm</span></div>
        </div>

        <div class="lock-inspector-sticky">
          <div v-if="draftWindow" class="draft-actions"><button class="primary-button" @click="props.hmi.confirmDraftWindow">应用检测窗并开始计算</button><button class="outline-button" @click="props.hmi.cancelDraftWindow">取消修改</button></div>
          <button v-else class="primary-button full compact-action" @click="savedWindow ? props.hmi.beginWindowEdit() : requestRecreate()">{{ savedWindow ? '编辑检测窗' : '新建检测窗' }}</button>
          <div class="inspector-actions"><button class="outline-button" @click="props.hmi.toggleFreeze">{{ selectedSignal?.freezeMode === 'manual' ? '恢复实时曲线' : '冻结曲线' }}</button><button class="outline-button" @click="requestDelete" :disabled="!savedWindow">删除当前检测窗</button></div>
          <div v-if="showDeleteConfirm" class="confirm-strip danger-confirm"><span>确定删除 {{ selected?.id }} 的当前检测窗？删除后停止该 PU 的偏差计算。</span><div><button class="primary-button" @click="confirmDelete">确认删除</button><button class="outline-button" @click="showDeleteConfirm = false">取消</button></div></div>
          <div v-if="showRecreateConfirm" class="confirm-strip"><span>保留原检测窗并创建替换草稿？</span><div><button class="primary-button" @click="confirmRecreate">继续创建</button><button class="outline-button" @click="showRecreateConfirm = false">取消</button></div></div>
        </div>
      </aside>
    </div>

    <div class="lock-bottom-rail">
      <div><div class="eyebrow">检测窗微调 / WINDOW TOOLS</div><div class="tool-row"><button class="outline-button" @pointerdown="startPress(props.hmi.shiftWindow, -1)" @pointerup="stopPress" @pointerleave="stopPress" @click.prevent="stopPress" :disabled="!displayWindow">检测窗左移</button><button class="outline-button" @pointerdown="startPress(props.hmi.shiftWindow, 1)" @pointerup="stopPress" @pointerleave="stopPress" @click.prevent="stopPress" :disabled="!displayWindow">检测窗右移</button><button v-if="savedWindow" class="text-button" @click="requestRecreate">新建替换检测窗</button></div></div>
      <div><div class="eyebrow">曲线视图 / VIEWPORT</div><div class="tool-row"><button class="outline-button" @click="props.hmi.zoom(-120)">放大</button><button class="outline-button" @click="props.hmi.zoom(120)">缩小</button><button class="outline-button" @click="props.hmi.pan(-.1)">左移</button><button class="outline-button" @click="props.hmi.pan(.1)">右移</button><button class="outline-button" @click="props.hmi.resetViewport">重置曲线视图</button></div></div>
      <div><div class="eyebrow">模拟版辊偏移 / ROLLER OFFSET</div><div class="tool-row"><button class="outline-button" @pointerdown="startPress(props.hmi.nudgeRoller, -.01, false)" @pointerup="stopPress" @pointerleave="stopPress" @click.prevent="stopPress">版辊偏移 −0.01 mm</button><button class="outline-button" @pointerdown="startPress(props.hmi.nudgeRoller, .01, false)" @pointerup="stopPress" @pointerleave="stopPress" @click.prevent="stopPress">版辊偏移 +0.01 mm</button><button class="text-button" @click="props.hmi.resetRollerOffset">恢复 0.00 mm</button><strong class="offset-readout">{{ (props.hmi.state.rollerOffsets[props.hmi.state.selectedStationId] ?? 0).toFixed(2) }} mm</strong></div></div>
    </div>
  </section>
</template>
