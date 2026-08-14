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

test('web cockpit exposes the roadmap, truthful local modules, and responsive command surface', async () => {
  const [html, css, app] = await Promise.all([
    source('web/index.html'),
    source('web/styles.css'),
    source('web/app.js'),
  ])

  assert.match(html, /class="[^"]*\bmodule-rail\b[^"]*"/)
  assert.match(html, /aria-label="Jarvis modules"/)
  for (const label of ['ACTIVE', 'PLANNED', 'FUTURE', 'TBD']) {
    assert.match(html, new RegExp(`>${label}<`))
  }
  assert.match(html, /id="core-status"/)
  assert.match(html, /id="network-status"/)
  assert.match(html, /id="voice-status"/)
  assert.match(html, /id="memory-status"/)
  assert.match(html, /LOCAL PROCESSING · PRIVATE · SECURE/)
  assert.match(css, /--signal:\s*#4dff88/i)
  assert.match(css, /grid-template-areas:\s*"rail core conversation"/)
  assert.match(css, /@container cockpit \(max-width: 1180px\)/)
  assert.match(css, /@media \(max-width: 720px\)/)
  assert.match(css, /@keyframes radar-sweep/)
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.match(app, /function updateSystemStatus\(/)
  assert.match(app, /resize\(\) \{[\s\S]{0,260}const width = this\.canvas\.clientWidth \|\| window\.innerWidth[\s\S]{0,120}const height = this\.canvas\.clientHeight \|\| window\.innerHeight/)
  assert.doesNotMatch(css + app, /#00e5ff|#675cff|#7468ff|#00b9e8|rgba\(21,31,91/)
  for (const layer of ['drawCorePlate', 'drawMechanicalBand', 'drawRadialTicks', 'drawTechnicalLabels']) {
    assert.match(app, new RegExp(`${layer}\\(`))
  }
  assert.doesNotMatch(app, /drawHardwareArc\(/)
  assert.doesNotMatch(app, /mechanicalDepth\s*=\s*baseRadius/)
  assert.doesNotMatch(app, /drawSegmentedRing\(context, centerX, centerY, baseRadius \* 1\.62/)
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*grid-template-areas:\s*"rail"\s*"core"\s*"command"\s*"conversation"/)
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.module-nav,\s*\.rail-status,\s*\.rail-signature\s*\{\s*display:\s*none/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.voice-controls\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*\.8fr\)\s*minmax\(0,\s*1\.2fr\)/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.text-form\s*\{\s*height:\s*46px/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*#text-input,\s*#send\s*\{\s*min-height:\s*44px/)
  assert.doesNotMatch(css, /@media \(max-width: 420px\)[\s\S]*\.command\s*\{\s*position:\s*relative/)
  assert.match(app, /memoryStatus\.textContent = 'EPHEMERAL'/)
})
