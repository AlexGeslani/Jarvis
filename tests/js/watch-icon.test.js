import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const OLD_CYAN_ICON_SHA256 = '8f4a89458eb5cecc0302bf2e3d701a5da261247363c80656a9a6050b0c2f2e79'

test('watch icon is sourced from the terminal-green mechanical core design', async () => {
  const [source, icon] = await Promise.all([
    readFile('docs/design/jarvis-watch-app-icon.svg', 'utf8'),
    readFile('watch/assets/genevaw.r/images/app-icon.png'),
  ])
  const hash = createHash('sha256').update(icon).digest('hex')

  assert.match(source, /viewBox="0 0 248 248"/)
  assert.match(source, /#4dff88/i)
  assert.match(source, /#18c766/i)
  assert.match(source, /MECHANICAL CORE/i)
  assert.notEqual(hash, OLD_CYAN_ICON_SHA256)
  assert.equal(icon.subarray(12, 16).toString('ascii'), 'IHDR')
  assert.equal(icon.readUInt32BE(16), 248)
  assert.equal(icon.readUInt32BE(20), 248)
  assert.ok(icon.byteLength > 10_000)
})