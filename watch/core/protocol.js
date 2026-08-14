const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let result = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    const triple = (first << 16) | (second << 8) | third
    result += BASE64[(triple >> 18) & 63]
    result += BASE64[(triple >> 12) & 63]
    result += index + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '='
    result += index + 2 < bytes.length ? BASE64[triple & 63] : '='
  }
  return result
}

export function createTransfer(input, turnId, chunkCharacters = 6144) {
  if (!Number.isInteger(chunkCharacters) || chunkCharacters < 4) {
    throw new Error('chunk size is invalid')
  }
  const alignedSize = chunkCharacters - (chunkCharacters % 4)
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const encoded = bytesToBase64(bytes)
  const chunks = []
  for (let offset = 0; offset < encoded.length; offset += alignedSize) {
    chunks.push(encoded.slice(offset, offset + alignedSize))
  }
  return {
    manifest: {
      transferId: `${turnId}-opus`,
      turnId,
      byteLength: bytes.byteLength,
      totalChunks: chunks.length,
      audioFormat: 'opus',
    },
    chunks,
  }
}

export function createSegmentState(manifest, limits = {}) {
  const maxBytes = limits.maxBytes || 1_000_000
  const maxChunks = limits.maxChunks || 256
  if (
    !manifest
    || typeof manifest.transferId !== 'string'
    || typeof manifest.turnId !== 'string'
    || manifest.audioFormat !== 'opus'
    || !Number.isInteger(manifest.byteLength)
    || manifest.byteLength < 1
    || manifest.byteLength > maxBytes
    || !Number.isInteger(manifest.totalChunks)
    || manifest.totalChunks < 1
    || manifest.totalChunks > maxChunks
  ) {
    throw new Error('transfer manifest is invalid')
  }
  return {
    manifest,
    chunks: new Array(manifest.totalChunks),
    received: 0,
    encodedCharacters: 0,
  }
}

export function addSegment(state, index, data, maxChunkCharacters = 8192) {
  if (
    !state
    || !Number.isInteger(index)
    || index < 0
    || index >= state.chunks.length
    || state.chunks[index] !== undefined
    || typeof data !== 'string'
    || data.length < 1
    || data.length > maxChunkCharacters
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  ) {
    throw new Error('transfer segment is invalid')
  }
  state.chunks[index] = data
  state.received += 1
  state.encodedCharacters += data.length
}

export function completeSegments(state) {
  if (!state || state.received !== state.chunks.length) {
    throw new Error('transfer is incomplete')
  }
  const encoded = state.chunks.join('')
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedLength = Math.floor((encoded.length * 3) / 4) - padding
  if (decodedLength !== state.manifest.byteLength) {
    throw new Error('transfer length does not match manifest')
  }
  return encoded
}

export function createTurnId(now = Date.now(), random = Math.random()) {
  const randomPart = Math.floor(random * 0x100000000)
    .toString(16)
    .padStart(8, '0')
  return `watch-${now}-${randomPart}`
}

export function boundedWatchText(value, limit = 72) {
  const normalized = String(value == null ? '' : value).trim().replace(/\s+/g, ' ')
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`
}

export function presenceFrame(state, tick) {
  const styles = {
    idle: { coreColor: 0x4dff88, glyph: '◇' },
    listening: { coreColor: 0xa9ff63, glyph: '◈' },
    thinking: { coreColor: 0xa9ff63, glyph: '◇' },
    speaking: { coreColor: 0x4dff88, glyph: '◆' },
    error: { coreColor: 0xff577a, glyph: '!' },
  }
  const style = styles[state] || styles.idle
  return { coreColor: style.coreColor, glyph: style.glyph, ring: tick % 3 }
}
