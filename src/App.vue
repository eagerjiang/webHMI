<script setup>
import { computed, ref } from 'vue'
import { useHmi } from './stores/hmi'
import TopBar from './components/TopBar.vue'
import SideNav from './components/SideNav.vue'
import OverviewPage from './components/OverviewPage.vue'
import LockMarkPage from './components/LockMarkPage.vue'
import AlarmDrawer from './components/AlarmDrawer.vue'

// useHmi 是页面间共享的唯一领域状态；App 只负责页面壳层和跨页报警抽屉编排..
const hmi = useHmi()
const showAlarms = ref(false)
const selectedForAlarm = computed(() => hmi.alarmQueue.value)

function locateAlarm(alarm) {
  if (hmi.locateAlarm(alarm)) showAlarms.value = false
}
</script>

<template>
  <div class="hmi-shell">
    <TopBar :hmi="hmi" @open-alarms="showAlarms = true" />
    <SideNav :page="hmi.state.page" @navigate="hmi.navigate" @open-alarms="showAlarms = true" @open-settings="hmi.showToast('设置功能暂未开放')" />
    <main class="workspace">
      <OverviewPage v-if="hmi.state.page === 'overview'" :hmi="hmi" @open-alarms="showAlarms = true" />
      <LockMarkPage v-else :hmi="hmi" />
    </main>
    <AlarmDrawer
      v-if="showAlarms"
      :alarms="selectedForAlarm"
      :machine="hmi.state.machine"
      :can-reset-alarm="hmi.canResetAlarm"
      :alarm-status-text="hmi.alarmStatusText"
      :can-start-machine="hmi.canStartMachine.value"
      :machine-start-reason="hmi.machineStartReason.value"
      @close="showAlarms = false"
      @acknowledge="hmi.confirmAlarm"
      @reset="hmi.resetAlarm"
      @start-machine="hmi.requestStartMachine"
      @locate="locateAlarm"
    />
    <Transition name="toast"><div v-if="hmi.state.toast" class="toast-message" role="status" aria-live="polite">{{ hmi.state.toast }}</div></Transition>
  </div>
</template>

<style scoped>
.hmi-shell { height: 100vh; min-height: 0; overflow: hidden; background: var(--bg); color: var(--text); }
.workspace { height: calc(100vh - 80px); min-height: 0; margin-left: 96px; margin-top: 80px; padding: 16px 24px; overflow: hidden; }
.toast-message { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background: #132d38; border: 1px solid var(--cyan); color: var(--text); border-radius: 8px; padding: 14px 20px; z-index: 50; box-shadow: 0 10px 30px #0008; }
.toast-enter-active,.toast-leave-active { transition: .2s ease; }.toast-enter-from,.toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }
@media (max-width: 900px) {
  .workspace { margin-left: 0; }
}
@media (min-width: 901px) and (max-width: 1280px) and (max-height: 800px) {
  .workspace { margin-left: 80px; padding: 16px; }
}
</style>
