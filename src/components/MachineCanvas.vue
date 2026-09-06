<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  machine: { type: Object, required: true },
  selectedId: String,
  attentionLevel: { type: Function, default: null },
  statusText: { type: Function, default: null }
})
const emit = defineEmits(['select'])
const canvas = ref(null)
const hoverStation = ref(null)
const hoverPoint = ref({ x: 0, y: 0 })
let resizeObserver
let animationFrame

function statusText(station) {
  if (props.statusText) return props.statusText(station.id)
  if (station.alarmState === 'alarm') return '停机'
  if (station.alarmState === 'warning') return '警告'
  return station.runState === 'run' ? '运行' : '停止'
}

function canvasStatusText(station) {
  const text = statusText(station)
  const shortLabels = { '停机级报警': '报警', '活动警告': '警告', '待确认': '确认', '待复位': '复位', '信号中断': '信号', '信号恢复中': '恢复' }
  return shortLabels[text] || text
}

function statusLevel(station) {
  if (props.attentionLevel) return props.attentionLevel(station.id)
  if (station.alarmState === 'alarm') return 'alarm'
  if (station.alarmState === 'warning') return 'warning'
  return station.runState === 'run' ? 'run' : 'stop'
}

function statusColor(station) {
  const level = statusLevel(station)
  if (level === 'alarm') return '#ff6565'
  if (level === 'warning') return '#ffc857'
  return level === 'run' ? '#40d998' : '#6c8791'
}

function canvasGeometry(width, height, stationCount = 10) {
  const sidePadding = Math.max(54, Math.min(88, width * 0.06))
  const left = sidePadding
  const right = width - sidePadding
  // 让印刷单元均匀分布在放卷与收卷之间，尾部不再留下额外的空白段。
  const step = Math.max(1, (right - left) / (Math.max(1, stationCount) + 1))
  // 减少“机柜式”的纵向比例，为上下辊和压印辊隙保留清晰的层次。
  // 高度不足时同步缩小单元，避免底部编号被画布边界裁切。
  const stationHeight = Math.min(260, Math.max(70, Math.min(height * 0.5, height - 76)))
  const stationTop = Math.max(10, (height - stationHeight - 62) / 2)
  const stationY = stationTop + stationHeight / 2
  const stationWidth = Math.max(50, Math.min(116, step * 0.86))
  // 承印材料位于压印辊与凹版辊的中间，所有 PU 共用同一条压印基准线。
  const nipY = stationY
  return { left, right, step, stationHeight, stationTop, stationY, stationWidth, nipY }
}

function drawWebPath(ctx, left, right, nipY, width, moving, phase, speedMpm) {
  ctx.save()
  ctx.strokeStyle = '#27d4ed'
  ctx.globalAlpha = 0.18
  ctx.lineWidth = 12
  ctx.beginPath()
  ctx.moveTo(left + 28, nipY)
  ctx.bezierCurveTo(width * 0.3, nipY, width * 0.68, nipY, right - 28, nipY)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.setLineDash([14, 14])
  ctx.lineDashOffset = moving ? -(phase * Math.max(12, speedMpm * 0.8)) % 28 : 0
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(left + 28, nipY)
  ctx.bezierCurveTo(width * 0.3, nipY, width * 0.68, nipY, right - 28, nipY)
  ctx.stroke()
  ctx.restore()
}

function drawReelLabels(ctx, x, y, label, activeAxis, axes, height) {
  const standbyAxis = Object.keys(axes).find(axis => axis !== activeAxis)
  if (height < 220) {
    ctx.textAlign = 'center'
    ctx.fillStyle = '#8fa3af'
    ctx.font = '11px Inter, "Microsoft YaHei", sans-serif'
    // 紧凑高度时将短标签放到画布底部，避免压住上辊与辊隙；完整画布中再补充备用轴。
    ctx.fillText(`${label} ${activeAxis} · 运行轴`, x, height - 12)
    return
  }
  const labelY = Math.min(height - (standbyAxis ? 30 : 18), y + 180)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#8fa3af'
  ctx.font = '12px Inter, "Microsoft YaHei", sans-serif'
  ctx.fillText(`${label} ${activeAxis} · 运行轴`, x, labelY)
  if (standbyAxis) {
    ctx.fillStyle = '#6c8791'
    ctx.font = '11px Inter, "Microsoft YaHei", sans-serif'
    ctx.fillText(`备用轴 ${standbyAxis}`, x, labelY + 17)
  }
}

function draw(timestamp = performance.now()) {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.floor(rect.width * dpr))
  el.height = Math.max(1, Math.floor(rect.height * dpr))
  const ctx = el.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = rect.width
  const h = rect.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0a161d'
  ctx.fillRect(0, 0, w, h)

  const geometry = canvasGeometry(w, h, props.machine.stations.length)
  const { left, right, step, stationHeight, stationY, stationWidth, nipY } = geometry
  const moving = props.machine.runState === 'run'
  const phase = timestamp / 1000
  const compact = h < 220

  ctx.fillStyle = '#8fa3af'
  ctx.font = '13px Inter, "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('2.5D CANVAS / 工艺路径', 18, 24)
  ctx.textAlign = 'right'
  ctx.fillStyle = moving ? '#40d998' : '#6c8791'
  ctx.beginPath()
  ctx.arc(w - 48, 20, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillText(moving ? '运行' : '停止', w - 18, 24)

  props.machine.stations.forEach((station, index) => drawStation(ctx, station, left + step * (index + 1), stationY, stationWidth, stationHeight, index, moving ? phase : 0, compact))

  // 先画印刷单元，再叠加承印材料带，使材料明确穿过每个 PU 的辊隙。
  drawWebPath(ctx, left, right, nipY, w, moving, phase, props.machine.speedMpm)

  const unwindAxis = props.machine.unwind.activeAxis
  const rewindAxis = props.machine.rewind.activeAxis
  const unwindReel = props.machine.unwind.axes[unwindAxis]
  const rewindReel = props.machine.rewind.axes[rewindAxis]
  drawReel(ctx, left, nipY, unwindReel.diameterMm, unwindReel.active, moving ? phase : 0, stationHeight * 0.78)
  drawReel(ctx, right, nipY, rewindReel.diameterMm, rewindReel.active, moving ? -phase : 0, stationHeight * 0.78)

  drawReelLabels(ctx, left, nipY, '放卷', unwindAxis, props.machine.unwind.axes, h)
  drawReelLabels(ctx, right, nipY, '收卷', rewindAxis, props.machine.rewind.axes, h)
  ctx.textAlign = 'left'
}

function drawReel(ctx, x, y, diameter, active, rotation, targetHeight) {
  const r = Math.max(30, Math.min(52, diameter / 15))
  const bodyHeight = Math.max(78, Math.min(250, targetHeight || r * 2.8))
  const bodyWidth = Math.max(56, Math.min(108, bodyHeight * 0.42))
  ctx.save()
  ctx.translate(x - bodyWidth / 2, y - bodyHeight / 2)
  ctx.shadowColor = '#0009'
  ctx.shadowBlur = 14
  ctx.fillStyle = '#14232d'
  ctx.strokeStyle = active ? '#40d998' : '#6c8791'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(8, 14)
  ctx.lineTo(bodyWidth - 8, 14)
  ctx.lineTo(bodyWidth, 30)
  ctx.lineTo(bodyWidth, bodyHeight - 12)
  ctx.lineTo(bodyWidth - 12, bodyHeight)
  ctx.lineTo(12, bodyHeight)
  ctx.lineTo(0, bodyHeight - 12)
  ctx.lineTo(0, 30)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#314957'
  ctx.beginPath()
  ctx.moveTo(8, 14)
  ctx.lineTo(bodyWidth - 8, 14)
  ctx.lineTo(bodyWidth - 2, 30)
  ctx.lineTo(6, 30)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#071016'
  ctx.strokeStyle = '#8aa0a8'
  ctx.lineWidth = 2
  ;[bodyHeight * 0.43, bodyHeight * 0.72].forEach(rollerY => {
    ctx.beginPath()
    ctx.ellipse(bodyWidth / 2, rollerY, bodyWidth * 0.27, bodyWidth * 0.11, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  })
  ctx.save()
  ctx.translate(bodyWidth / 2, bodyHeight * 0.58)
  ctx.rotate(rotation * 0.7)
  ctx.fillStyle = active ? '#27d4ed' : '#6c8791'
  ctx.beginPath()
  ctx.ellipse(0, 0, bodyWidth * 0.2, bodyWidth * 0.1, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.restore()
}

function drawStation(ctx, station, x, y, width, height, index, phase, compact = false) {
  const selected = station.id === props.selectedId
  const stateColor = statusColor(station)
  const processColor = station.color || '#8fa3af'
  const depth = Math.max(7, Math.min(14, width * 0.16))
  ctx.save()
  ctx.translate(x - width / 2, y - height / 2)
  ctx.shadowColor = '#0008'
  ctx.shadowBlur = selected ? 12 : 8
  ctx.fillStyle = '#10212b'
  ctx.strokeStyle = selected ? '#27d4ed' : stateColor
  ctx.lineWidth = selected ? 3 : 2
  ctx.beginPath()
  ctx.moveTo(0, 10)
  ctx.lineTo(width - depth, 10)
  ctx.lineTo(width, 17)
  ctx.lineTo(width, height - 8)
  ctx.lineTo(width - depth, height)
  ctx.lineTo(0, height)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#29404b'
  ctx.beginPath()
  ctx.moveTo(0, 10)
  ctx.lineTo(width - depth, 10)
  ctx.lineTo(width - 2, 17)
  ctx.lineTo(5, 17)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#1b3440'
  ctx.beginPath()
  ctx.moveTo(width - depth, 10)
  ctx.lineTo(width, 17)
  ctx.lineTo(width, height - 8)
  ctx.lineTo(width - depth, height)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#071016'
  ctx.strokeStyle = '#8aa0a8'
  ctx.lineWidth = 2
  ;[height * 0.38, height * 0.62].forEach(rollerY => {
    ctx.save()
    ctx.translate(width / 2, rollerY)
    ctx.rotate(station.runState === 'run' ? phase * 0.7 * (index % 2 ? -1 : 1) : 0)
    ctx.beginPath()
    ctx.ellipse(0, 0, Math.max(12, width * 0.3), Math.max(6, width * 0.11), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  })

  ctx.strokeStyle = processColor
  ctx.lineWidth = Math.max(8, Math.min(12, width * 0.16))
  ctx.lineCap = 'round'
  ctx.beginPath()
  const processY = compact ? height * 0.78 : height - 18
  ctx.moveTo(width * 0.22, processY)
  ctx.lineTo(width * 0.78, processY)
  ctx.stroke()
  ctx.lineCap = 'butt'

  ctx.fillStyle = stateColor
  ctx.beginPath()
  ctx.arc(width - depth - 8, 18, 5, 0, Math.PI * 2)
  ctx.fill()

  if (['alarm', 'warning'].includes(statusLevel(station))) {
    ctx.save()
    ctx.translate(width - depth - 8, 36)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = stateColor
    ctx.fillRect(-5, -5, 10, 10)
    ctx.restore()
  }

  ctx.fillStyle = '#e8f0f4'
  ctx.textAlign = 'center'
  const unitNo = String(index + 1).padStart(2, '0')
  if (compact) {
    // 紧凑高度下保留编号与状态，颜色由底部工艺色条表达。
    ctx.font = `bold ${width < 58 ? 10 : 12}px Inter, sans-serif`
    ctx.fillText(unitNo, width / 2, height - 18)
    ctx.fillStyle = stateColor
    ctx.font = `bold ${width < 58 ? 8 : 10}px Inter, "Microsoft YaHei", sans-serif`
    ctx.fillText(canvasStatusText(station), width / 2, height - 4)
  } else {
    ctx.font = `bold ${width < 58 ? 13 : 16}px Inter, sans-serif`
    ctx.fillText(unitNo, width / 2, height + 24)
    ctx.fillStyle = stateColor
    ctx.font = `bold ${width < 58 ? 10 : 12}px Inter, "Microsoft YaHei", sans-serif`
    ctx.fillText(canvasStatusText(station), width / 2, height + 43)
  }
  ctx.textAlign = 'left'
  ctx.restore()
}

function hitStation(event) {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const width = rect.width
  const height = rect.height
  const { left, right, step, stationHeight, stationY, stationWidth } = canvasGeometry(width, height, props.machine.stations.length)
  let hitIndex = -1
  let nearestDistance = Infinity

  props.machine.stations.forEach((station, index) => {
    const centerX = left + step * (index + 1)
    const halfWidth = Math.max(stationWidth / 2 + 12, 24)
    const top = stationY - stationHeight / 2 - 6
    const bottom = stationY + stationHeight / 2 + 58
    if (localX < centerX - halfWidth || localX > centerX + halfWidth || localY < top || localY > bottom) return
    const distance = Math.abs(localX - centerX)
    if (distance < nearestDistance) {
      nearestDistance = distance
      hitIndex = index
    }
  })

  return hitIndex < 0 ? null : props.machine.stations[hitIndex]
}

function pointerSelect(event) {
  const station = hitStation(event)
  if (!station) return
  emit('select', station.id)
}

function pointerHover(event) {
  const station = hitStation(event)
  hoverStation.value = station
  if (!station) return
  const bounds = canvas.value.getBoundingClientRect()
  hoverPoint.value = {
    x: Math.max(10, Math.min(bounds.width - 190, event.clientX - bounds.left + 14)),
    y: Math.max(10, event.clientY - bounds.top - 72)
  }
}

function pointerLeave() {
  hoverStation.value = null
}

function animate(timestamp) {
  draw(timestamp)
  animationFrame = requestAnimationFrame(animate)
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => draw())
  resizeObserver.observe(canvas.value)
  animationFrame = requestAnimationFrame(animate)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(animationFrame)
})

watch(() => [props.selectedId, props.machine.runState, props.machine.stations], () => draw(), { deep: true })
</script>

<template>
  <div class="machine-canvas-wrap">
  <canvas ref="canvas" @click="pointerSelect" @pointermove="pointerHover" @pointerleave="pointerLeave" aria-label="参数化 2.5D 整机 Canvas；单击印刷单元查看详情"></canvas>
  <div v-if="hoverStation" class="machine-tooltip" :style="{ left: `${hoverPoint.x}px`, top: `${hoverPoint.y}px` }">
    <strong>{{ hoverStation.id }} · {{ hoverStation.colorName }}</strong>
    <span><i class="status-dot" :class="statusLevel(hoverStation)"></i>{{ statusText(hoverStation) }} · 单击查看详情</span>
  </div>
  </div>
</template>
