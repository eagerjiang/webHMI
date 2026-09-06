import assert from 'node:assert/strict'
import { createInitialAlarms, createInitialMachine, createSignalFrame } from '../src/data/mock.js'
import { createMachineSnapshot, MACHINE_SCENE_DURATION_SECONDS } from '../src/data/mockMachineSource.js'
import { calculateWindowDeviation } from '../src/data/signalMath.js'
import {
  alarmCanReset,
  alarmLifecycleText,
  highestAlarmLabel,
  highestAlarmLevel,
  summarizeAlarms,
  windowsEqual
} from '../src/data/hmiRules.js'

const startedAt = 1_700_000_000_000
const machine = createInitialMachine()
const alarms = createInitialAlarms()

assert.equal(MACHINE_SCENE_DURATION_SECONDS, 90, 'automatic demo state must remain stable for 90 seconds')

assert.equal(highestAlarmLevel(alarms), 'stop', 'active stop alarm must be the highest alarm')
assert.equal(highestAlarmLabel(alarms), '停机级报警', 'top alarm label must describe the active stop alarm')
assert.deepEqual(summarizeAlarms(alarms), { active: 3, pendingAck: 2, pendingReset: 0, needsAction: 3 }, 'an active fault must not be counted as ready for reset')
assert.equal(windowsEqual({ xMin: 1, xMax: 2, yMin: 3, yMax: 4 }, { xMin: 1, xMax: 2, yMin: 3, yMax: 4 }), true, 'equal window coordinates must not be marked dirty')

const frame = createSignalFrame(0, startedAt)
assert.equal(frame.points.length, 1200, 'signal frame must contain 1200 points')
assert.deepEqual(frame.references, createSignalFrame(0, startedAt).references, 'reference config must be deterministic')

const first = createMachineSnapshot(machine, alarms, startedAt + 8_000, startedAt)
const second = createMachineSnapshot(machine, alarms, startedAt + 8_000, startedAt)
assert.deepEqual(first, second, 'machine scenario must be reproducible')
const beforeFirstTransition = createMachineSnapshot(machine, alarms, startedAt + 89_000, startedAt)
const atFirstTransition = createMachineSnapshot(machine, alarms, startedAt + 90_000, startedAt)
assert.equal(first.scene, 0, 'every refresh must begin at scene 0')
assert.equal(beforeFirstTransition.scene, 0, 'initial scene must remain stable for the full 90-second interval')
assert.equal(atFirstTransition.scene, 1, 'automatic state may advance only after the 90-second interval')
assert.equal(first.machine.stations.length, 10, 'snapshot must contain all 10 stations')
assert.equal(first.machine.runState, 'run', 'initial scene should keep the machine-level state running')
assert.equal(calculateWindowDeviation(frame, { xMin: 140, xMax: 280, yMin: 20, yMax: 90 }).reference.key, 'first', 'first colour is the primary reference')

// Stop-level alarm lifecycle: condition recovery alone must not restart PU7.
const initialPu7Alarm = alarms.find(alarm => alarm.id === 'alarm-pu7-drive')
assert.equal(initialPu7Alarm.active, true, 'PU7 stop alarm starts active')
assert.equal(initialPu7Alarm.resetRequired, true, 'PU7 stop alarm requires a manual reset')
assert.equal(alarmCanReset({ ...initialPu7Alarm, acknowledged: true }), false, 'acknowledging an active fault must not enable reset')

const pu7Active = createMachineSnapshot(machine, alarms, startedAt + 1_000, startedAt)
const pu7Recovered = createMachineSnapshot(pu7Active.machine, pu7Active.alarms, startedAt + 90_000, startedAt)
const recoveredPu7Alarm = pu7Recovered.alarms.find(alarm => alarm.id === 'alarm-pu7-drive')
assert.equal(recoveredPu7Alarm.active, false, 'PU7 alarm condition recovers when scene 1 begins')
assert.equal(recoveredPu7Alarm.resetRequired, true, 'recovered PU7 stop alarm retains its manual reset requirement')
assert.equal(alarmCanReset(recoveredPu7Alarm), false, 'a recovered but unacknowledged stop alarm must still require acknowledgement')
const acknowledgedPu7Alarm = { ...recoveredPu7Alarm, acknowledged: true }
assert.equal(alarmCanReset(acknowledgedPu7Alarm), true, 'a recovered and acknowledged stop alarm must become resettable')
assert.equal(summarizeAlarms([acknowledgedPu7Alarm]).pendingReset, 1, 'only a resettable alarm is counted as pending reset')
assert.equal(highestAlarmLevel(pu7Recovered.alarms), 'stop', 'a recovered stop alarm stays red until acknowledgement and reset are complete')
assert.equal(highestAlarmLabel(pu7Recovered.alarms), '停机报警待确认', 'a recovered unacknowledged stop alarm must request acknowledgement first')
assert.equal(highestAlarmLabel([acknowledgedPu7Alarm]), '停机报警待复位', 'top alarm label must expose reset only after acknowledgement')
assert.equal(alarmLifecycleText(acknowledgedPu7Alarm), '已恢复 / 待复位', 'recovered acknowledged stop alarm must be shown as pending reset')
assert.equal(pu7Recovered.machine.stations.find(station => station.id === 'PU7').runState, 'stop', 'PU7 remains stopped after condition recovery')

const resetPu7Alarms = pu7Recovered.alarms.map(alarm => alarm.id === 'alarm-pu7-drive'
  ? { ...alarm, acknowledged: true, acknowledgedAt: startedAt + 90_100, resetRequired: false, resetAt: startedAt + 90_200 }
  : alarm)
const resetPu7Machine = {
  ...pu7Recovered.machine,
  stations: pu7Recovered.machine.stations.map(station => station.id === 'PU7' ? { ...station, runCommand: 'run' } : station)
}
const pu7Restarted = createMachineSnapshot(resetPu7Machine, resetPu7Alarms, startedAt + 91_000, startedAt)
assert.equal(pu7Restarted.machine.stations.find(station => station.id === 'PU7').runState, 'run', 'PU7 runs only after reset and an explicit start command')

// The scripted machine stop in scene 4 also requires an explicit start command.
const machineStopped = createMachineSnapshot(createInitialMachine(), createInitialAlarms(), startedAt + 360_000, startedAt)
assert.equal(machineStopped.machine.runState, 'stop', 'scene 4 stops the whole machine')
const machineRestarted = createMachineSnapshot(
  { ...machineStopped.machine, runCommand: 'run' },
  machineStopped.alarms,
  startedAt + 361_000,
  startedAt
)
assert.equal(machineRestarted.machine.runState, 'run', 'whole machine runs after an explicit start command')

// Virtual five-minute run: validates the deterministic 1s script without waiting
// five real minutes in CI or during an interview demonstration.
let virtualMachine = machine
let virtualAlarms = alarms
for (let second = 1; second <= 300; second += 1) {
  const snapshot = createMachineSnapshot(virtualMachine, virtualAlarms, startedAt + second * 1000, startedAt)
  virtualMachine = snapshot.machine
  virtualAlarms = snapshot.alarms
}
assert.equal(virtualMachine.stations.length, 10, 'five-minute virtual run keeps all stations')

console.log('acceptance checks passed: 90-second demo cadence, alarm summary/lifecycle, 1200 points, deterministic snapshots, 10 stations, transactional window equality, reset/start lifecycle, virtual 5-minute run')
