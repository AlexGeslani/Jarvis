import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createScopedPlaybackVolume } from '../../watch/core/playback-volume.js'

const root = process.cwd()

test('watch response playback is 85 percent of the current system volume and restores it', () => {
  const calls = []
  const player = {
    getVolume() {
      calls.push(['getVolume'])
      return 80
    },
    setVolume(volume) {
      calls.push(['setVolume', volume])
      return true
    },
  }
  const responseVolume = createScopedPlaybackVolume(player)

  assert.equal(responseVolume.apply(), true)
  assert.equal(responseVolume.apply(), true)
  assert.equal(responseVolume.restore(), true)
  assert.deepEqual(calls, [
    ['getVolume'],
    ['setVolume', 68],
    ['setVolume', 80],
  ])
})

test('watch playback lifecycle scopes attenuation to Jarvis responses', async () => {
  const source = await readFile(join(root, 'watch/page/genevaw/index.js'), 'utf8')
  const manifest = JSON.parse(await readFile(join(root, 'watch/app.json'), 'utf8'))

  assert.equal(manifest.app.version.code, 9)
  assert.equal(manifest.app.version.name, '0.1.8')
  assert.match(source, /createScopedPlaybackVolume/)
  assert.match(source, /responseVolume\.apply\(\)[\s\S]*player\.start\(\)/)
  assert.match(source, /player\.event\.COMPLETE[\s\S]*responseVolume\.restore\(\)/)
  assert.match(source, /playResponse\(filePath\)[\s\S]*player\.stop\(\)[\s\S]*responseVolume\.restore\(\)/)
  assert.match(source, /onDestroy\(\)[\s\S]*responseVolume\.restore\(\)/)
  assert.match(source, /V0\.1\.8/)
})
