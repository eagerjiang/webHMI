<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  frame: { type: Object, default: null },
  windowData: { type: Object, default: null },
  viewport: { type: Object, required: true },
  signalInterrupted: { type: Boolean, default: false },
  isDraft: { type: Boolean, default: false }
})
const emit = defineEmits(['change', 'pan', 'interaction-start', 'interaction-end'])

const canvas = ref(null)
const interaction = ref(null)
const cursor = ref(null)
let resizeObserver

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function rect() {
  const bounds = canvas.value.getBoundingClientRect()
  return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
}

function plotRect() {
  const bounds = rect()
  return { left: 58, top: 34, width: Math.max(1, bounds.width - 82), height: Math.max(1, bounds.height - 100) }
}

// 交互事件使用浏览器像素坐标，检测窗和信号计算使用固定业务坐标。
// 所有缩放/平移都通过这两个函数收口，避免 Canvas 尺寸影响测量结果。
function toData(clientX, clientY) {
  const bounds = rect()
  const plot = plotRect()
  const x = clamp(clientX - bounds.left - plot.left, 0, plot.width)
  const y = clamp(clientY - bounds.top - plot.top, 0, plot.height)
  const viewport = props.viewport
  return {
    x: viewport.xMin + (x / plot.width) * (viewport.xMax - viewport.xMin),
    y: 100 - (y / plot.height) * 100
  }
}

function toScreen(x, y) {
  const plot = plotRect()
  const viewport = props.viewport
  return {
    x: plot.left + ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * plot.width,
    y: plot.top + ((100 - y) / 100) * plot.height
  }
}

function normalizeWindow(value) {
  if (!value) return null
  return {
    xMin: Math.min(value.xMin, value.xMax),
    xMax: Math.max(value.xMin, value.xMax),
    yMin: Math.min(value.yMin, value.yMax),
    yMax: Math.max(value.yMin, value.yMax)
  }
}

function getWindowScreen(value) {
  const windowValue = normalizeWindow(value)
  if (!windowValue) return null
  const topLeft = toScreen(windowValue.xMin, windowValue.yMax)
  const bottomRight = toScreen(windowValue.xMax, windowValue.yMin)
  return {
    left: Math.min(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    right: Math.max(topLeft.x, bottomRight.x),
    bottom: Math.max(topLeft.y, bottomRight.y)
  }
}

function hitWindow(point, value) {
  const screen = getWindowScreen(value)
  if (!screen) return 'outside'
  const touchRadius = 22
  const handles = [
    ['nw', screen.left, screen.top], ['n', (screen.left + screen.right) / 2, screen.top], ['ne', screen.right, screen.top],
    ['e', screen.right, (screen.top + screen.bottom) / 2], ['se', screen.right, screen.bottom], ['s', (screen.left + screen.right) / 2, screen.bottom],
    ['sw', screen.left, screen.bottom], ['w', screen.left, (screen.top + screen.bottom) / 2]
  ]
  const handle = handles.find(([, x, y]) => Math.abs(point.x - x) <= touchRadius && Math.abs(point.y - y) <= touchRadius)
  if (handle) return handle[0]
  if (point.x >= screen.left && point.x <= screen.right && point.y >= screen.top && point.y <= screen.bottom) return 'inside'
  return 'outside'
}

function isInsidePlot(clientX, clientY) {
  const bounds = rect()
  const plot = plotRect()
  const x = clientX - bounds.left
  const y = clientY - bounds.top
  return x >= plot.left && x <= plot.left + plot.width && y >= plot.top && y <= plot.top + plot.height
}

function applyInteraction(current) {
  // interaction 是一个轻量状态机：创建、整体移动、八向缩放和视口平移
  // 共用同一套指针事件，但只有前三类会产出新的检测窗草稿。
  const state = interaction.value
  if (!state) return null
  const origin = state.originWindow
  const dx = current.x - state.start.x
  const dy = current.y - state.start.y
  if (state.mode === 'creating') {
    return normalizeWindow({ xMin: state.start.x, xMax: current.x, yMin: state.start.y, yMax: current.y })
  }
  if (state.mode === 'panning') return null
  if (!origin) return null
  if (state.mode === 'moving') {
    const width = origin.xMax - origin.xMin
    const height = origin.yMax - origin.yMin
    const xMin = clamp(origin.xMin + dx, 0, 1199 - width)
    const yMin = clamp(origin.yMin + dy, 0, 100 - height)
    return { xMin, xMax: xMin + width, yMin, yMax: yMin + height }
  }
  const next = { ...origin }
  if (state.handle.includes('w')) next.xMin = clamp(origin.xMin + dx, 0, origin.xMax - 12)
  if (state.handle.includes('e')) next.xMax = clamp(origin.xMax + dx, origin.xMin + 12, 1199)
  if (state.handle.includes('n')) next.yMax = clamp(origin.yMax + dy, origin.yMin + 5, 100)
  if (state.handle.includes('s')) next.yMin = clamp(origin.yMin + dy, 0, origin.yMax - 5)
  return normalizeWindow(next)
}

function previewWindow() {
  return interaction.value?.preview || props.windowData
}

function draw() {
  const el = canvas.value
  if (!el) return
  const bounds = el.getBoundingClientRect()
  // backing store 按 DPR 放大，绘制坐标仍使用 CSS 像素，保证高分屏文字和曲线清晰。
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.floor(bounds.width * dpr))
  el.height = Math.max(1, Math.floor(bounds.height * dpr))
  const ctx = el.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const width = bounds.width
  const height = bounds.height
  const plot = plotRect()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#0a161d'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#071016'
  ctx.fillRect(plot.left, plot.top, plot.width, plot.height)

  ctx.strokeStyle = '#29404b'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i += 1) {
    const y = plot.top + (plot.height * i) / 4
    ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.left + plot.width, y); ctx.stroke()
    ctx.fillStyle = '#8fa3af'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(`${100 - i * 25}%`, 12, y + 4)
  }
  for (let i = 0; i <= 6; i += 1) {
    const x = plot.left + (plot.width * i) / 6
    ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.top + plot.height); ctx.stroke()
    const value = props.viewport.xMin + ((props.viewport.xMax - props.viewport.xMin) * i) / 6
    ctx.fillStyle = '#8fa3af'; ctx.fillText(`${Math.round(value)}`, x - 8, plot.top + plot.height + 22)
  }

  const points = props.frame?.points || []
  ctx.strokeStyle = '#ee7649'; ctx.lineWidth = 2; ctx.beginPath()
  let started = false
  for (const point of points) {
    if (point.x < props.viewport.xMin || point.x > props.viewport.xMax) continue
    const screen = toScreen(point.x, point.y)
    if (!started) { ctx.moveTo(screen.x, screen.y); started = true } else ctx.lineTo(screen.x, screen.y)
  }
  if (started) ctx.stroke()

  if (cursor.value && !interaction.value) {
    const cursorScreen = toScreen(cursor.value.x, cursor.value.y)
    ctx.save()
    ctx.strokeStyle = '#e8f0f466'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 5])
    ctx.beginPath(); ctx.moveTo(cursorScreen.x, plot.top); ctx.lineTo(cursorScreen.x, plot.top + plot.height); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(plot.left, cursorScreen.y); ctx.lineTo(plot.left + plot.width, cursorScreen.y); ctx.stroke()
    ctx.restore()
  }

  const references = props.frame?.references || {}
  for (const [key, x] of Object.entries(references)) {
    if (x < props.viewport.xMin || x > props.viewport.xMax) continue
    const screen = toScreen(x, 0)
    const color = key === 'first' ? '#40d998' : key === 'previous' ? '#ff6565' : '#6c8791'
    ctx.strokeStyle = color; ctx.setLineDash([7, 7]); ctx.beginPath(); ctx.moveTo(screen.x, plot.top); ctx.lineTo(screen.x, plot.top + plot.height); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = color; ctx.font = '12px Inter, sans-serif'; ctx.fillText(`${key === 'first' ? '首色' : key === 'previous' ? '前色' : '本色'} ${Math.round(x)}`, screen.x - 22, plot.top + 16)
  }

  const visibleWindow = previewWindow()
  const windowScreen = getWindowScreen(visibleWindow)
  if (windowScreen) {
    const draft = props.isDraft || Boolean(interaction.value?.mode)
    ctx.save()
    ctx.fillStyle = draft ? '#ffc85724' : '#27d4ed20'
    ctx.fillRect(windowScreen.left, windowScreen.top, windowScreen.right - windowScreen.left, windowScreen.bottom - windowScreen.top)
    ctx.strokeStyle = draft ? '#ffc857' : '#27d4ed'; ctx.lineWidth = 3
    if (draft) ctx.setLineDash([8, 5])
    ctx.strokeRect(windowScreen.left, windowScreen.top, windowScreen.right - windowScreen.left, windowScreen.bottom - windowScreen.top)
    ctx.setLineDash([])
    const handleSize = 14
    for (const [x, y] of [[windowScreen.left, windowScreen.top], [(windowScreen.left + windowScreen.right) / 2, windowScreen.top], [windowScreen.right, windowScreen.top], [windowScreen.right, (windowScreen.top + windowScreen.bottom) / 2], [windowScreen.right, windowScreen.bottom], [(windowScreen.left + windowScreen.right) / 2, windowScreen.bottom], [windowScreen.left, windowScreen.bottom], [windowScreen.left, (windowScreen.top + windowScreen.bottom) / 2]]) {
      ctx.fillStyle = draft ? '#ffc857' : '#27d4ed'; ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize)
    }
    ctx.restore()
  }

  const bands = props.frame?.colorBand || []
  for (const band of bands) {
    const x1 = plot.left + ((band.from - props.viewport.xMin) / (props.viewport.xMax - props.viewport.xMin)) * plot.width
    const x2 = plot.left + ((band.to - props.viewport.xMin) / (props.viewport.xMax - props.viewport.xMin)) * plot.width
    const left = Math.max(plot.left, Math.min(plot.left + plot.width, x1))
    const right = Math.max(plot.left, Math.min(plot.left + plot.width, x2))
    if (right <= left) continue
    ctx.fillStyle = band.color; ctx.globalAlpha = 0.78; ctx.fillRect(left, plot.top + plot.height + 35, right - left, 25)
  }
  ctx.globalAlpha = 1
  if (props.signalInterrupted) {
    ctx.fillStyle = '#071016dd'
    ctx.fillRect(plot.left, plot.top, plot.width, plot.height)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffc857'; ctx.font = 'bold 18px Inter, "Microsoft YaHei", sans-serif'
    ctx.fillText('信号中断 · 当前显示最后有效帧', plot.left + plot.width / 2, plot.top + plot.height / 2 - 8)
    ctx.fillStyle = '#e8f0f4'; ctx.font = '13px Inter, "Microsoft YaHei", sans-serif'
    ctx.fillText('禁止将旧帧作为实时测量值', plot.left + plot.width / 2, plot.top + plot.height / 2 + 20)
    ctx.textAlign = 'left'
  }
}

function down(event) {
  if (!canvas.value || !isInsidePlot(event.clientX, event.clientY)) return
  const point = toData(event.clientX, event.clientY)
  const bounds = rect()
  const hit = hitWindow({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, props.windowData)
  // 已应用窗口外拖动用于查看曲线；没有已应用窗口时，窗口外拖动表示新建检测窗。
  const mode = hit === 'outside'
    ? (props.windowData && !props.isDraft ? 'panning' : 'creating')
    : hit === 'inside' ? 'moving' : 'resizing'
  interaction.value = {
    mode,
    handle: mode === 'resizing' ? hit : null,
    start: point,
    originWindow: mode === 'creating' || mode === 'panning' ? null : normalizeWindow(props.windowData),
    preview: mode === 'creating' ? normalizeWindow({ xMin: point.x, xMax: point.x, yMin: point.y, yMax: point.y }) : normalizeWindow(props.windowData)
  }
  if (mode !== 'panning') emit('interaction-start')
  canvas.value.setPointerCapture?.(event.pointerId)
  draw()
}

function move(event) {
  if (!interaction.value) {
    cursor.value = isInsidePlot(event.clientX, event.clientY) ? toData(event.clientX, event.clientY) : null
    draw()
    return
  }
  interaction.value.preview = applyInteraction(toData(event.clientX, event.clientY))
  draw()
}

function leave() {
  if (interaction.value) return
  cursor.value = null
  draw()
}

function finish(event, cancelled = false) {
  if (!interaction.value) return
  const current = interaction.value
  if (!cancelled) {
    const next = current.preview || applyInteraction(toData(event.clientX, event.clientY))
    if (current.mode === 'panning') {
      const bounds = rect()
      const plot = plotRect()
      const dxRatio = (event.clientX - bounds.left - plot.left - ((current.start.x - props.viewport.xMin) / (props.viewport.xMax - props.viewport.xMin)) * plot.width) / plot.width
      emit('pan', -dxRatio)
    // Canvas 只上报业务坐标，草稿/应用/持久化由 Store 决定。
    } else if (next) emit('change', next)
  }
  interaction.value = null
  if (current.mode !== 'panning') emit('interaction-end')
  draw()
}

onMounted(() => {
  resizeObserver = new ResizeObserver(draw)
  resizeObserver.observe(canvas.value)
  draw()
})
onBeforeUnmount(() => resizeObserver?.disconnect())
watch(() => [props.frame, props.windowData, props.viewport, props.signalInterrupted, props.isDraft], draw, { deep: true })
</script>

<template>
  <div class="signal-canvas-wrap">
    <canvas ref="canvas" tabindex="0" @pointerdown="down" @pointermove="move" @pointerleave="leave" @pointerup="finish" @pointercancel="event => finish(event, true)" aria-label="锁定标记实时信号曲线。检测窗编辑时可在此按 Enter 应用，按 Escape 取消"></canvas>
    <div v-if="cursor && !interaction" class="canvas-cursor-readout">游标 x {{ Math.round(cursor.x) }} sample · y {{ cursor.y.toFixed(1) }}%</div>
    <div v-if="!frame" class="canvas-empty">当前 PU 暂无信号数据</div>
  </div>
</template>
