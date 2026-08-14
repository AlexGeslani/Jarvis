import test from 'node:test'
import assert from 'node:assert/strict'

import {
  boundedWatchText,
  bytesToBase64,
  createTransfer,
  createTurnId,
  presenceFrame,
} from '../../watch/core/protocol.js'

test('watch OPUS payloads are base64 encoded into ordered bounded segments', () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
  assert.equal(bytesToBase64(bytes), 'AAEC/f7/')
  const transfer = createTransfer(bytes, 'turn-123', 4)
  assert.equal(transfer.manifest.byteLength, 6)
  assert.equal(transfer.manifest.totalChunks, 2)
  assert.equal(transfer.chunks.join(''), 'AAEC/f7/')
  assert.deepEqual(transfer.chunks.map((data, index) => ({ index, data })), [
    { index: 0, data: 'AAEC' },
    { index: 1, data: '/f7/' },
  ])
})

test('watch identifiers, copy, and low-power presence frames stay bounded', () => {
  assert.equal(createTurnId(123456, 0.25), 'watch-123456-40000000')
  assert.equal(boundedWatchText('abcdefghijkl', 8), 'abcdefg…')
  assert.deepEqual(presenceFrame('listening', 2), { coreColor: 0xa9ff63, glyph: '◈', ring: 2 })
  assert.deepEqual(presenceFrame('thinking', 3), { coreColor: 0xa9ff63, glyph: '◇', ring: 0 })
  assert.deepEqual(presenceFrame('speaking', 4), { coreColor: 0x4dff88, glyph: '◆', ring: 1 })
})
