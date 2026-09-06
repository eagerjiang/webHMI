<script setup>
import { computed } from 'vue'
const props = defineProps({ hmi: { type: Object, required: true } })
defineEmits(['open-alarms'])
const machine = computed(() => props.hmi.state.machine)
const levelText = computed(() => props.hmi.alarmHeadline.value)
const levelClass = computed(() => props.hmi.highestAlarm.value === 'stop' ? 'is-stop' : props.hmi.highestAlarm.value === 'warning' ? 'is-warning' : 'is-ok')
const alarmDotClass = computed(() => props.hmi.highestAlarm.value === 'stop' ? 'alarm' : props.hmi.highestAlarm.value === 'warning' ? 'warning' : 'run')
const runStateClass = computed(() => machine.value.runState === 'run' ? 'run' : 'stop')
</script>

<template>
  <header class="topbar">
    <div class="brand"><div class="brand-mark">V²</div><div><strong>VISU·19</strong><small>WEB HMI / 2.5D CONTROL</small></div></div>
    <div class="top-metric order"><small>工单号</small><b>{{ machine.orderNo }}</b></div>
    <div class="top-metric width"><small>材料幅宽</small><b>{{ machine.webWidthMm }} <i>mm</i></b></div>
    <div class="top-metric speed"><small>实际线速度</small><b>{{ machine.speedMpm.toFixed(1) }} <i>m/min</i></b></div>
    <div class="link-state"><span class="status-dot" :class="runStateClass"></span><strong>整线 {{ machine.runState === 'run' ? '运行中' : '已停止' }}</strong><small>{{ machine.linked ? '主从联动已启用' : '主从联动关闭' }}</small></div>
    <button class="alarm-summary" :class="levelClass" @click="$emit('open-alarms')"><span class="status-dot" :class="alarmDotClass"></span><strong>{{ levelText }}</strong><small>{{ props.hmi.alarmStats.value.active }} 条活动 · {{ props.hmi.alarmStats.value.pendingAck }} 条待确认 · {{ props.hmi.alarmStats.value.pendingReset }} 条待复位</small></button>
    <div class="clock"><small>本地时间 / LOCAL TIME</small><b>{{ new Date(hmi.state.now).toLocaleTimeString('zh-CN', { hour12: false }) }}</b></div>
  </header>
</template>
