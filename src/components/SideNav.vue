<script setup>
defineProps({ page: String })
defineEmits(['navigate','open-alarms','open-settings'])
</script>
<template>
  <aside class="sidenav">
    <button class="nav-item" :class="{active: page === 'overview'}" @click="$emit('navigate','overview')"><span class="nav-icon">⌂</span><small>整机浏览</small></button>
    <button class="nav-item" :class="{active: page === 'lock'}" @click="$emit('navigate','lock')"><span class="nav-icon">≋</span><small>锁定标记</small></button>
    <button class="nav-item" @click="$emit('open-alarms')"><span class="nav-icon alarm-glyph">◇</span><small>报警辅助</small></button>
    <button class="nav-item settings" title="设置功能暂未开放" @click="$emit('open-settings')"><span class="nav-icon">◷</span><small>设置</small></button>
  </aside>
</template>
