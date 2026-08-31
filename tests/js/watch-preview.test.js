import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF_SIGNATURE = Buffer.from('GIF89a', 'ascii')
const SPEAKING_HERO = 'docs/showcase/jarvis-speaking-preview.gif'
const SCREENSHOTS = [
  'docs/screenshots/jarvis-watch-ready.png',
]

function pngDimensions(image) {
  assert.ok(image.subarray(0, 8).equals(PNG_SIGNATURE), 'asset must use the PNG signature')
  assert.equal(image.subarray(12, 16).toString('ascii'), 'IHDR')
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  }
}

test('watch documentation preview mirrors the 480px source geometry and both stable states', async () => {
  const preview = await readFile('docs/watch-preview/index.html', 'utf8')

  assert.match(preview, /class="watch-face"[^>]*data-width="480"[^>]*data-height="480"/)
  assert.match(preview, /\.watch-face\s*\{[\s\S]*?width:\s*480px;[\s\S]*?height:\s*480px;/)
  assert.match(preview, /data-geometry="100,34,280,38"[^>]*>J A R V I S</)
  assert.match(preview, /data-geometry="120,70,240,22"[^>]*>MECHANICAL INTELLIGENCE</)
  assert.match(preview, /data-geometry="116,94,248,248"/)
  assert.match(preview, /data-geometry="148,126,184,184"/)
  assert.match(preview, /data-geometry="191,169,98,98"/)
  assert.match(preview, /data-geometry="104,282,272,34"/)
  assert.match(preview, /data-geometry="74,315,332,46"/)
  assert.match(preview, /data-geometry="112,364,256,70"/)
  assert.match(preview, /data-geometry="96,440,288,22"[^>]*>V0\.1\.12\s*<span[^>]*>•<\/span>\s*8 SEC\s*<span[^>]*>•<\/span>\s*LAN</)

  assert.match(preview, /ACTIVE MAX\s*<span[^>]*>·<\/span>\s*480 × 480/)
  assert.match(preview, /Jarvis watch preview/)
  assert.match(preview, /data-state="ready"[\s\S]*?data-status="READY"[\s\S]*?data-response="TAP TO SPEAK"[\s\S]*?data-action="START VOICE"/)
  assert.match(preview, /data-state="response"[\s\S]*?data-status="READY"[\s\S]*?data-response="Systems nominal\. Ready to assist\."[\s\S]*?data-action="START VOICE"/)
  assert.match(preview, /Browser-rendered, source-faithful preview/)
  assert.match(preview, /physical Active Max remains authoritative for Zepp rendering, microphone, speaker\/volume, and performance\./)
  assert.doesNotMatch(preview, /simulator|physical capture|https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}|\.lan\b/i)
})

test('watch preview screenshot keeps a stable path, signature, and 1280x900 dimensions', async () => {
  const images = await Promise.all(SCREENSHOTS.map((path) => readFile(path)))
  for (let index = 0; index < images.length; index += 1) {
    assert.deepEqual(pngDimensions(images[index]), { width: 1280, height: 900 }, SCREENSHOTS[index])
    assert.ok(images[index].byteLength > 50_000, `${SCREENSHOTS[index]} must be a rendered screenshot`)
    assert.ok(images[index].byteLength < 5 * 1024 * 1024, `${SCREENSHOTS[index]} must remain publication-sized`)
  }
})

test('README leads with a tested speaking hero and then labels one watch documentation preview', async () => {
  const readme = await readFile('README.md', 'utf8')
  const speakingHero = await readFile(SPEAKING_HERO)
  const heroIndex = readme.indexOf(SPEAKING_HERO)
  const filmIndex = readme.indexOf('## Portfolio film')
  const portfolioSection = readme.slice(filmIndex, readme.indexOf('## What happens when I speak?'))
  const interfaceSection = readme.slice(readme.indexOf('## Interface evidence'), readme.indexOf('## Release details'))
  const watchHeading = interfaceSection.indexOf('### Active Max watch')
  const browserHeading = interfaceSection.indexOf('### Browser cockpit')

  assert.ok(heroIndex >= 0, 'README must include the speaking hero')
  assert.ok(heroIndex < filmIndex, 'speaking hero must be the first visual before the film')
  assert.ok(speakingHero.subarray(0, 6).equals(GIF_SIGNATURE), 'speaking hero must use the GIF89a signature')
  assert.deepEqual({ width: speakingHero.readUInt16LE(6), height: speakingHero.readUInt16LE(8) }, { width: 900, height: 506 })
  assert.ok(speakingHero.byteLength > 500_000, 'speaking hero must contain real animation frames')
  assert.ok(speakingHero.byteLength < 5 * 1024 * 1024, 'speaking hero must remain publication-sized')
  assert.ok(watchHeading >= 0, 'Interface must include the watch subsection')
  assert.ok(browserHeading >= 0, 'Interface must include the browser subsection')
  assert.ok(watchHeading > browserHeading, 'browser evidence must precede the labeled watch preview')
  assert.match(interfaceSection, /docs\/screenshots\/jarvis-watch-ready\.png/)
  assert.doesNotMatch(interfaceSection, /docs\/screenshots\/jarvis-watch-response\.png/)
  assert.match(interfaceSection, /Round Active Max source-faithful preview showing Jarvis ready for an explicit voice turn/)
  assert.match(interfaceSection, /Explicit voice control/)
  assert.match(interfaceSection, /Private response path/)
  assert.match(interfaceSection, /Clear lifecycle/)
  assert.match(interfaceSection, /browser-rendered, source-faithful documentation preview/i)
  assert.match(interfaceSection, /physical Active Max remains authoritative/i)
  assert.doesNotMatch(portfolioSection, /docs\/screenshots\/jarvis-browser-response\.png/)
  assert.match(interfaceSection, /docs\/screenshots\/jarvis-browser-ready\.png/)
  assert.doesNotMatch(interfaceSection, /live demo|GitHub Pages/i)
})
