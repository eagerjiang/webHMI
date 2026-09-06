<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  station: { type: Object, required: true },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['expand'])

const activePart = ref('web')
const partCopy = {
  web: ['承印材料', '连续走料并经过压印区，箭头表示当前材料运行方向。'],
  impression: ['压印辊', '上方压印辊提供稳定的压印接触，主体保持金属灰蓝色。'],
  plate: ['凹版辊', '下方凹版辊承载当前 PU 的工艺颜色，底部半圆弧表达油墨色。'],
  ink: ['油墨槽', '油墨槽为凹版辊提供工艺油墨，本图仅表达工艺关系，不直接控制参数。'],
  doctor: ['刮刀', '刮刀控制凹版辊表面墨量，详细压力参数在右侧详情查看。'],
  eye: ['光电眼', '光电眼采集锁定标记信号，曲线页用于进一步确认检测窗口和偏差。']
}

const stationColor = computed(() => props.station.color || '#27d4ed')
const selectedPart = computed(() => partCopy[activePart.value] || partCopy.web)
const running = computed(() => props.station.runState === 'run')

function selectPart(part) {
  activePart.value = part
}
</script>

<template>
  <div v-if="compact" class="unit-mini-diagram">
    <div class="unit-mini-head"><div><div class="eyebrow">PRINT UNIT SCHEMATIC</div><strong>单元原理图</strong></div><button class="text-button" @click="emit('expand')">展开</button></div>
    <div class="unit-mini-web"><span>→</span> 承印材料 / {{ running ? '运行方向' : '已停止' }}</div>
    <div class="unit-mini-process">
      <span class="mini-part">油墨槽</span>
      <span class="mini-part" :style="{ borderColor: stationColor, color: stationColor }">凹版辊</span>
      <span class="mini-part">压印辊</span>
      <span class="mini-eye"><i :class="station.lockEye === 'online' ? 'online' : 'offline'"></i>光电眼</span>
    </div>
    <div class="unit-mini-note">检测信号 → 锁定标记曲线</div>
  </div>
  <div v-else class="unit-diagram-wrap">
    <div class="unit-diagram-topline">
      <div>
        <div class="eyebrow">印刷单元原理图 / PRINT UNIT SCHEMATIC</div>
        <strong>{{ station.id }} · {{ station.colorName }}</strong>
      </div>
      <span class="diagram-state" :class="station.alarmState">
        <i class="status-dot" :class="station.alarmState === 'alarm' ? 'alarm' : station.alarmState === 'warning' ? 'warning' : running ? 'run' : 'stop'"></i>
        {{ station.alarmState === 'alarm' ? '停机级报警' : station.alarmState === 'warning' ? '运行中 · 警告' : running ? '运行中' : '单元停止' }}
      </span>
    </div>

    <svg class="unit-diagram" viewBox="0 0 900 540" role="img" :aria-label="`${station.id} 单个印刷单元原理图`">
      <defs>
        <pattern id="unit-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1a3642" stroke-width="1" />
        </pattern>
        <marker id="web-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#27d4ed" />
        </marker>
      </defs>
      <rect width="900" height="540" rx="12" fill="#0a161d" />
      <rect x="16" y="16" width="868" height="508" rx="10" fill="url(#unit-grid)" opacity=".9" />

      <g class="diagram-part" :class="{ active: activePart === 'web' }" @click.stop="selectPart('web')">
        <path d="M74 354 C210 322 300 332 420 354 S670 382 826 348" fill="none" stroke="#27d4ed" stroke-width="16" opacity=".18" />
        <path d="M74 354 C210 322 300 332 420 354 S670 382 826 348" fill="none" stroke="#27d4ed" stroke-width="3" stroke-dasharray="13 11" marker-end="url(#web-arrow)" />
        <text x="80" y="389" class="diagram-label">承印材料 / {{ running ? '运行方向 →' : '已停止' }}</text>
      </g>

      <g class="diagram-part" :class="{ active: activePart === 'impression' }" @click.stop="selectPart('impression')">
        <rect x="310" y="104" width="280" height="25" rx="12" fill="#1d3440" stroke="#8fa3af" stroke-width="2" />
        <ellipse cx="450" cy="117" rx="106" ry="23" fill="#243d49" stroke="#b8c8ce" stroke-width="2" />
        <text x="618" y="122" class="diagram-label">压印辊</text>
      </g>

      <g class="diagram-part" :class="{ active: activePart === 'plate' }" @click.stop="selectPart('plate')">
        <rect x="290" y="292" width="320" height="28" rx="14" fill="#1d3440" stroke="#8fa3af" stroke-width="2" />
        <ellipse cx="450" cy="306" rx="118" ry="28" fill="#243d49" stroke="#b8c8ce" stroke-width="2" />
        <path d="M358 317 A96 39 0 0 0 542 317" fill="none" :stroke="stationColor" stroke-width="12" />
        <text x="618" y="312" class="diagram-label">凹版辊 · {{ station.colorName }}</text>
      </g>

      <g class="diagram-part" :class="{ active: activePart === 'ink' }" @click.stop="selectPart('ink')">
        <path d="M326 365 L574 365 L548 414 L352 414 Z" fill="#172b36" stroke="#8fa3af" stroke-width="2" />
        <path d="M344 382 L556 382 L545 403 L355 403 Z" :fill="stationColor" opacity=".72" />
        <text x="618" y="395" class="diagram-label">油墨槽</text>
      </g>

      <g class="diagram-part" :class="{ active: activePart === 'doctor' }" @click.stop="selectPart('doctor')">
        <path d="M334 276 L565 276" stroke="#ffc857" stroke-width="8" stroke-linecap="round" />
        <path d="M352 270 L548 270" stroke="#f4e2ae" stroke-width="2" stroke-linecap="round" />
        <text x="618" y="276" class="diagram-label">刮刀</text>
      </g>

      <g class="diagram-part" :class="{ active: activePart === 'eye' }" @click.stop="selectPart('eye')">
        <rect x="674" y="205" width="82" height="48" rx="8" fill="#14232d" stroke="#40d998" stroke-width="2" />
        <circle cx="692" cy="229" r="8" fill="#40d998" />
        <path d="M674 229 C624 229 600 252 565 292" fill="none" stroke="#40d998" stroke-width="2" stroke-dasharray="7 6" />
        <text x="768" y="234" class="diagram-label">光电眼</text>
        <text x="674" y="278" class="diagram-note">检测信号 → 曲线</text>
      </g>

      <line x1="222" y1="117" x2="222" y2="306" stroke="#39515d" stroke-width="2" stroke-dasharray="6 8" />
      <line x1="678" y1="306" x2="804" y2="306" stroke="#39515d" stroke-width="2" stroke-dasharray="6 8" />
    </svg>

    <div class="unit-diagram-footer">
      <span class="diagram-selected"><i :style="{ background: stationColor }"></i>{{ selectedPart[0] }}</span>
      <span>{{ selectedPart[1] }}</span>
    </div>
  </div>
</template>
