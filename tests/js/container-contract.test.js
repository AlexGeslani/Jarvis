import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'


test('compose keeps both named services private, hardened, and topology-neutral', async () => {
  const compose = await readFile('compose.yaml', 'utf8')
  assert.match(compose, /^\s{2}jarvis-api:/m)
  assert.match(compose, /^\s{2}jarvis-web:/m)
  assert.match(compose, /external:\s*\$\{JARVIS_NETWORK_EXTERNAL:-false\}/)
  assert.match(compose, /name:\s*\$\{JARVIS_NETWORK_NAME:-jarvis\}/)
  assert.doesNotMatch(compose, /^\s+ports:/m)
  assert.match(compose, /read_only:\s*true/g)
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/g)
  assert.match(compose, /JARVIS_STT_URL:\s*\$\{JARVIS_STT_URL:\?[^}]+\}/)
  assert.match(compose, /JARVIS_TTS_URL:\s*\$\{JARVIS_TTS_URL:\?[^}]+\}/)
  assert.match(compose, /JARVIS_REASONING_BACKEND:\s*\$\{JARVIS_REASONING_BACKEND:-direct\}/)
  assert.match(compose, /JARVIS_REASONING_URL:\s*\$\{JARVIS_REASONING_URL:-\}/)
  assert.match(compose, /JARVIS_REASONING_MODEL:\s*\$\{JARVIS_REASONING_MODEL:-\}/)
  assert.match(compose, /JARVIS_N8N_WEBHOOK_URL:\s*\$\{JARVIS_N8N_WEBHOOK_URL:-\}/)
  assert.match(compose, /JARVIS_N8N_API_KEY_FILE:\s*\/run\/secrets\/jarvis_n8n_api_key/)
  assert.match(compose, /source:\s*\$\{JARVIS_N8N_API_KEY_FILE:-\.\/deploy\/empty-secret\}/)
  assert.match(compose, /target:\s*\/run\/secrets\/jarvis_n8n_api_key/)
  assert.match(compose, /read_only:\s*true/)
  assert.match(compose, /JARVIS_ALLOWED_ORIGIN:\s*\$\{JARVIS_ALLOWED_ORIGIN:\?[^}]+\}/)
  assert.match(compose, /JARVIS_PIPER_VOICE:\s*\$\{JARVIS_PIPER_VOICE:-piper:en_US-danny-low\}/)
  assert.doesNotMatch(compose, /(?:TOKEN|SECRET|PASSWORD):|API_KEY:\s*[^$\s]|\.lan\b|192\.168\./i)
})
