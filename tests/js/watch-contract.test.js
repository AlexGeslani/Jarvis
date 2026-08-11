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
  assert.equal(manifest.app.version.code, 9)
  assert.equal(manifest.app.version.name, '0.1.8')
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
    /recorder\.addEventListener\(recorder\.event\.STOP,[\s\S]*onRecordingStopped\(\)/,
  )
  assert.doesNotMatch(source, /setTimeout\(\(\) => this\.onRecordingStopped\(\), 150\)/)
  assert.match(source, /MIC INIT FAILED/)
  assert.match(source, /PLAYER INIT FAILED/)
  assert.match(source, /describeError/)
  assert.match(source, /V0\.1\.8/)
})

test('Zepp recorder bytes are read only after the asynchronous STOP event', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const stopBlock = source.slice(source.indexOf('stopRecording()'), source.indexOf('async onRecordingStopped()'))
  const stoppedBlock = source.slice(source.indexOf('async onRecordingStopped()'), source.indexOf('onReceivedFile('))

  assert.match(source, /addEventListener\(recorder\.event\.STOP,[\s\S]*onRecordingStopped\(\)/)
  assert.match(stopBlock, /recorder\.stop\(\)/)
  assert.doesNotMatch(stopBlock, /readFileSync/)
  assert.doesNotMatch(stopBlock, /onRecordingStopped\(\)/)
  assert.match(stoppedBlock, /readFileSync/)
  assert.doesNotMatch(stoppedBlock, /setTimeout/)
})
