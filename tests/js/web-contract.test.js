import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

async function source(path) {
  return readFile(join(root, path), 'utf8')
}

test('web client is CSP-safe, accessible, local-only, and presence-first', async () => {
  const [html, css, app] = await Promise.all([
    source('web/index.html'),
    source('web/styles.css'),
    source('web/app.js'),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /<canvas[^>]+id="presence"[^>]+aria-label=/)
  assert.match(html, /id="transcript"[^>]+aria-live="polite"/)
  assert.match(html, /type="module" src="\.\/app\.js"/)
  assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/)
  assert.doesNotMatch(html, /style=/)
  assert.doesNotMatch(html + css + app, /https?:\/\//)
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.match(app, /createAnalyser\(/)
  assert.match(app, /MediaRecorder/)
  assert.match(app, /pointerdown/)
  assert.match(html, /id="dialogue"[^>]+aria-pressed="false"/)
  assert.match(html, /JARVIS \/\/ 01/)
  assert.doesNotMatch(html, /ARK \/\/ 01/)
  assert.match(app, /VoiceActivityDetector/)
  assert.match(app, /Open dialogue/)
  assert.match(app, /\/api\/v1\/turns/)
})
