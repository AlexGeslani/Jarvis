import { BaseSideService } from '@zeppos/zml/base-side'
import {
  addSegment,
  completeSegments,
  createSegmentState,
} from '../core/protocol'
import { API_BASE, API_ORIGIN } from './api-config'

const MAX_ACTIVE_TRANSFERS = 2
const MAX_TRANSFER_AGE_MS = 30_000
const transfers = Object.create(null)

function bodyOf(response) {
  if (typeof response.body === 'string') return JSON.parse(response.body)
  return response.body || {}
}

async function fetchJson(options) {
  const response = await fetch(options)
  if (response.status && (response.status < 200 || response.status >= 300)) {
    throw new Error('Jarvis API request failed')
  }
  const body = bodyOf(response)
  if (body.error) throw new Error('Jarvis API rejected the request')
  return body
}

function mutationHeaders(session, idempotencyKey) {
  return {
    'Content-Type': 'application/json',
    'X-Jarvis-Session': session.session_id,
    'X-Jarvis-CSRF': session.csrf_token,
    'Idempotency-Key': idempotencyKey,
  }
}

function pruneTransfers() {
  const now = Date.now()
  const ids = Object.keys(transfers)
  for (const id of ids) {
    if (now - transfers[id].createdAt > MAX_TRANSFER_AGE_MS) delete transfers[id]
  }
  const remaining = Object.keys(transfers)
  while (remaining.length >= MAX_ACTIVE_TRANSFERS) {
    delete transfers[remaining.shift()]
  }
}

function safeReply(response, body) {
  response(null, body)
}

function errorDetail(error) {
  try {
    const detail = error && (error.message || error.code || error.name)
    return String(detail || error || 'unknown_error').slice(0, 64)
  } catch (ignored) {
    return 'unknown_error'
  }
}

AppSideService(
  BaseSideService({
    onInit() {
      pruneTransfers()
    },

    async onRequest(request, response) {
      try {
        switch (request.method) {
          case 'jarvis.session': {
            const session = await fetchJson({
              url: `${API_BASE}/sessions`,
              method: 'POST',
              headers: {
                'Idempotency-Key': request.params.idempotency_key,
              },
            })
            safeReply(response, { ok: true, session })
            break
          }
          case 'jarvis.audio.begin': {
            pruneTransfers()
            const state = createSegmentState(request.params.manifest, {
              maxBytes: 1_000_000,
              maxChunks: 256,
            })
            state.createdAt = Date.now()
            transfers[state.manifest.transferId] = state
            safeReply(response, { ok: true })
            break
          }
          case 'jarvis.audio.chunk': {
            const params = request.params || {}
            const state = transfers[params.transferId]
            if (!state) throw new Error('Audio transfer not found')
            addSegment(state, params.index, params.data, 8192)
            safeReply(response, { ok: true, received: state.received })
            break
          }
          case 'jarvis.audio.commit': {
            const params = request.params || {}
            const state = transfers[params.transferId]
            if (!state) throw new Error('Audio transfer not found')
            delete transfers[params.transferId]
            const audioBase64 = completeSegments(state)
            const session = {
              session_id: params.session_id,
              csrf_token: params.csrf_token,
            }
            const turn = await fetchJson({
              url: `${API_BASE}/turns`,
              method: 'POST',
              headers: mutationHeaders(session, params.idempotency_key),
              body: JSON.stringify({
                session_id: session.session_id,
                turn_id: state.manifest.turnId,
                input: {
                  type: 'audio',
                  audio_format: 'opus',
                  audio_base64: audioBase64,
                },
                response_format: 'mp3',
              }),
            })
            if (
              !turn.audio
              || typeof turn.audio.url !== 'string'
              || turn.audio.url.indexOf('/api/v1/turns/') !== 0
            ) {
              throw new Error('Jarvis audio response is invalid')
            }
            safeReply(response, {
              ok: true,
              turn: {
                turn_id: turn.turn_id,
                transcript: turn.transcript,
                response_text: turn.response_text,
              },
            })
            this.deliverAudio(turn, session)
            break
          }
          default:
            safeReply(response, { ok: false, error: 'unsupported_request' })
        }
      } catch (error) {
        safeReply(response, {
          ok: false,
          error: 'request_failed',
          detail: errorDetail(error),
        })
      }
    },

    deliverAudio(turn, session) {
      const download = this.download(`${API_ORIGIN}${turn.audio.url}`, {
        headers: {
          'X-Jarvis-Session': session.session_id,
          'X-Jarvis-CSRF': session.csrf_token,
        },
        timeout: 30_000,
        filePath: 'jarvis-response.mp3',
      })
      if (!download) {
        this.call({ type: 'jarvis.error', code: 'audio_download_failed' })
        return
      }
      download.onSuccess = (result) => {
        const transfer = this.sendFile(result.filePath, {
          type: 'audio',
          name: 'jarvis-response.mp3',
          turnId: turn.turn_id,
        })
        transfer.on('change', (event) => {
          if (event.data.readyState === 'transferred') {
            this.call({ type: 'jarvis.audio.transferred', turnId: turn.turn_id })
          }
        })
      }
      download.onFail = () => {
        this.call({ type: 'jarvis.error', code: 'audio_download_failed' })
      }
    },

    onDestroy() {
      for (const id of Object.keys(transfers)) delete transfers[id]
    },
  }),
)
