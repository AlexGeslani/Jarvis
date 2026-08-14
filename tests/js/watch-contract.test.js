import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

test('Zepp app targets Active Max with a Device App and Side Service', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'watch/app.json'), 'utf8'))
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const side = await readFile(join(root, 'watch/app-side/index.js'), 'utf8')
  assert.equal(manifest.app.appName, 'Jarvis')
  assert.equal(manifest.app.version.code, 13)
  assert.equal(manifest.app.version.name, '0.1.12')
  assert.equal(manifest.targets.genevaw.designWidth, 480)
  assert.deepEqual(manifest.targets.genevaw.platforms, [{ st: 'r' }])
  assert.equal(manifest.runtime.apiVersion.minVersion, '4.2')
  assert.deepEqual(manifest.permissions, ['device:os.mic'])
  assert.equal(manifest.targets.genevaw.module['app-side'].path, 'app-side/index')
  assert.match(source, /create\(id\.RECORDER\)/)
  assert.match(source, /codec\.OPUS/)
  assert.match(source, /readFileSync/)
  assert.match(source, /MAX_RECORDING_MS\s*=\s*8000/)
  assert.match(side, /from ['"]\.\/api-config['"]/)
  assert.doesNotMatch(side, /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}|\.lan\b/)
  assert.match(side, /sendFile/)
  assert.match(side, /response_format:\s*['"]mp3['"]/)
})

test('Zepp page lazily initializes media from the user action', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  assert.doesNotMatch(source, /const\s+recorder\s*=\s*create\(id\.RECORDER\)/)
  assert.doesNotMatch(source, /const\s+player\s*=\s*create\(id\.PLAYER\)/)
  assert.match(source, /toggleRecording\(\)[\s\S]*this\.ensureRecorder\(\)/)
  const buildBlock = source.slice(source.indexOf('build()'), source.indexOf('ensureRecorder()'))
  assert.doesNotMatch(buildBlock, /ensureRecorder\(\)/)
  assert.match(
    source,
    /createdRecorder\.addEventListener\(createdRecorder\.event\.STOP,[\s\S]*onRecordingStopped\(createdRecorder\)/,
  )
  assert.doesNotMatch(source, /setTimeout\(\(\) => this\.onRecordingStopped\(\), 150\)/)
  assert.match(source, /MIC INIT FAILED/)
  assert.match(source, /PLAYER INIT FAILED/)
  assert.match(source, /describeError/)
  assert.match(source, /V0\.1\.12/)
})

test('Zepp presence uses the validated green native animation with a static fallback', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const frameBlock = source.slice(source.indexOf('\n    applyPresenceFrame() {'), source.indexOf('\n    disablePresenceAnimation('))
  const destroyBlock = source.slice(source.indexOf('\n    onDestroy() {'))

  assert.match(source, /BRIGHT_GREEN\s*=\s*0x4dff88/)
  assert.match(source, /LIME\s*=\s*0xa9ff63/)
  assert.match(source, /ringNodes:\s*\[\]/)
  assert.match(source, /animationTimer:\s*null/)
  assert.match(source, /animationEnabled:\s*false/)
  assert.match(source, /startPresenceAnimation\(\)/)
  assert.match(source, /SAFE STATIC MODE/)
  assert.match(frameBlock, /setProperty\(ui\.prop\.MORE/)
  assert.doesNotMatch(frameBlock, /createWidget/)
  assert.match(destroyBlock, /animationEnabled\s*=\s*false/)
  assert.match(destroyBlock, /clearTimeout\(this\.state\.animationTimer\)/)
})

test('Zepp recorder bytes are read only once from the matching asynchronous STOP event', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const stopBlock = source.slice(source.indexOf('\n    stopRecording() {'), source.indexOf('async onRecordingStopped('))
  const stoppedBlock = source.slice(source.indexOf('async onRecordingStopped('), source.indexOf('onReceivedFile('))

  assert.match(source, /addEventListener\(createdRecorder\.event\.STOP,[\s\S]*onRecordingStopped\(createdRecorder\)/)
  assert.match(source, /recordingFile:\s*null/)
  assert.match(source, /recordingFile\s*=\s*`jarvis-turn-\$\{createTurnId\(\)\}\.opus`/)
  assert.match(source, /pendingRecorder\s*=\s*recorder/)
  assert.match(stopBlock, /this\.state\.processing\s*=\s*true[\s\S]*recorder\.stop\(\)/)
  assert.match(stopBlock, /recorder\.stop\(\)/)
  assert.doesNotMatch(stopBlock, /readFileSync/)
  assert.doesNotMatch(stopBlock, /onRecordingStopped\(\)/)
  assert.match(stoppedBlock, /sourceRecorder\s*!==\s*this\.state\.pendingRecorder/)
  assert.match(stoppedBlock, /this\.state\.uploadStarted/)
  assert.match(stoppedBlock, /readFileSync/)
  assert.match(source, /function removeRecording\([\s\S]*rmSync/)
  assert.match(stoppedBlock, /this\.releaseRecordingTurn\(recordingFile\)/)
  assert.match(source, /releaseRecordingTurn\(recordingFile = this\.state\.recordingFile\)[\s\S]*removeRecording\(recordingFile\)/)
  assert.doesNotMatch(stoppedBlock, /setTimeout/)
})

test('a stale recorder STOP cleans its abandoned file instead of entering a replacement page', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const callbackBlock = source.slice(
    source.indexOf('createdRecorder.addEventListener(createdRecorder.event.STOP'),
    source.indexOf('recorder = createdRecorder'),
  )

  assert.match(
    callbackBlock,
    /activePage\s*&&\s*activePage\.state\.pendingRecorder\s*===\s*createdRecorder/,
  )
  assert.match(callbackBlock, /else\s*{[\s\S]*removeRecording\(abandonedRecordingFile\)/)
  assert.match(callbackBlock, /abandonedRecordingFile\s*=\s*null/)
})

test('a recorder STOP failure releases the turn so microphone input can retry', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const stopBlock = source.slice(source.indexOf('\n    stopRecording() {'), source.indexOf('async onRecordingStopped('))

  assert.match(stopBlock, /try\s*{[\s\S]*recorder\.stop\(\)[\s\S]*}\s*catch \(error\)/)
  assert.match(stopBlock, /this\.releaseRecordingTurn\(/)
  assert.match(stopBlock, /this\.fail\('MICROPHONE ERROR'/)
  assert.match(source, /releaseRecordingTurn\(recordingFile = this\.state\.recordingFile\)/)
  assert.match(source, /this\.state\.processing\s*=\s*false/)
  assert.match(source, /this\.state\.pendingRecorder\s*=\s*null/)
  assert.match(source, /this\.state\.uploadStarted\s*=\s*false/)
  assert.match(source, /removeRecording\(recordingFile\)/)
})

test('a missing recorder STOP event is recovered from IDLE without permanently blocking taps', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const stopBlock = source.slice(source.indexOf('\n    stopRecording() {'), source.indexOf('async onRecordingStopped('))
  const recoverBlock = source.slice(source.indexOf('recoverStoppedRecording('), source.indexOf('async onRecordingStopped('))

  assert.match(source, /STOP_COMPLETION_TIMEOUT_MS\s*=\s*2000/)
  assert.match(source, /stopTimer:\s*null/)
  assert.match(stopBlock, /this\.state\.stopTimer\s*=\s*setTimeout\(/)
  assert.match(stopBlock, /this\.recoverStoppedRecording\(recorder\)/)
  assert.match(recoverBlock, /sourceRecorder\.getStatus\(\)\s*===\s*sourceRecorder\.state\.IDLE/)
  assert.match(recoverBlock, /this\.onRecordingStopped\(sourceRecorder\)/)
  assert.match(recoverBlock, /this\.releaseRecordingTurn\(/)
  assert.match(recoverBlock, /this\.fail\('MICROPHONE ERROR'/)
  assert.match(source, /this\.state\.stopTimer\s*!==\s*null[\s\S]*clearTimeout\(this\.state\.stopTimer\)/)
})

test('a delayed STOP after watchdog recovery cannot finalize a newer turn', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const callbackBlock = source.slice(
    source.indexOf('createdRecorder.addEventListener(createdRecorder.event.STOP'),
    source.indexOf('recorder = createdRecorder'),
  )
  const recoverBlock = source.slice(
    source.indexOf('\n    recoverStoppedRecording('),
    source.indexOf('\n    releaseRecordingTurn('),
  )

  assert.match(source, /let recorderStopEventsTrusted = true/)
  assert.match(callbackBlock, /if \(!recorderStopEventsTrusted\) return/)
  assert.match(recoverBlock, /recorderStopEventsTrusted\s*=\s*false/)
  assert.match(recoverBlock, /sourceRecorder\.getStatus\(\)\s*===\s*sourceRecorder\.state\.IDLE/)
  assert.match(recoverBlock, /this\.onRecordingStopped\(sourceRecorder\)/)
  assert.doesNotMatch(recoverBlock, /create\(id\.RECORDER\)/)
})

test('the Zepp recorder remains reusable after STOP and across a page relaunch', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const callbackBlock = source.slice(
    source.indexOf('createdRecorder.addEventListener(createdRecorder.event.STOP'),
    source.indexOf('recorder = createdRecorder'),
  )
  const destroyBlock = source.slice(source.indexOf('\n    onDestroy() {'))

  assert.match(source, /ensureRecorder\(\)\s*{[\s\S]*if \(recorder\) return true/)
  assert.doesNotMatch(callbackBlock, /recorder\s*=\s*null/)
  assert.doesNotMatch(destroyBlock, /recorder\s*=\s*null/)
})
