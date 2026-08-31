import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MEDIA_EXTENSIONS,
  findSensitiveLabels,
  parsePrivateLiterals,
  representativeFrameTimes,
} from '../../scripts/media-safety-lib.mjs'

test('media safety classifies high-confidence visible disclosures without echoing values', () => {
  const privateIp = ['192', '168', '50', '10'].join('.')
  const privateHost = ['knowledge', 'lan'].join('.')
  const userPath = ['', 'Users', 'operator', 'private', 'notes.txt'].join('/')
  const email = ['operator', 'example.com'].join('@')
  const privateLiteral = 'synthetic-internal-label'
  const labels = findSensitiveLabels(
    `${privateIp} ${privateHost} ${userPath} ${email} ${privateLiteral}`,
    [privateLiteral],
  )

  assert.deepEqual(labels, [
    'email address',
    'macOS user path',
    'private infrastructure literal',
    'private IPv4 address',
    'private LAN hostname',
  ])
  assert.doesNotMatch(labels.join(' '), new RegExp(privateLiteral))
  assert.doesNotMatch(labels.join(' '), new RegExp(privateIp.replaceAll('.', '\\.')))
})

test('media safety parses only explicit private literal arrays', () => {
  assert.deepEqual(parsePrivateLiterals('{"literals":["alpha-private","beta-private"]}'), [
    'alpha-private', 'beta-private',
  ])
  assert.throws(() => parsePrivateLiterals('{"literals":["x"]}'))
})

test('media safety selects representative moving-media frames', () => {
  assert.deepEqual(representativeFrameTimes(100), [10, 30, 50, 70, 90])
  assert.deepEqual(representativeFrameTimes(2), [0.2, 0.6, 1, 1.4, 1.8])
})

test('media safety inventories supported raster, vector, and moving-image formats', () => {
  assert.deepEqual([...MEDIA_EXTENSIONS].sort(), [
    '.gif', '.jpeg', '.jpg', '.m4v', '.mov', '.mp4', '.png', '.svg', '.webm', '.webp',
  ])
})

test('media gate is part of local verification and required in CI', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const workflow = await readFile(new URL('../../.github/workflows/verify.yml', import.meta.url), 'utf8')

  assert.equal(packageJson.scripts['media-safety'], 'node scripts/check-media-safety.mjs')
  assert.match(packageJson.scripts.verify, /npm run media-safety/)
  assert.match(workflow, /tesseract-ocr/)
  assert.match(workflow, /libimage-exiftool-perl/)
  assert.match(workflow, /JARVIS_MEDIA_SAFETY_REQUIRE_OCR: '1'/)
  assert.match(workflow, /JARVIS_MEDIA_SAFETY_REQUIRE_EXIFTOOL: '1'/)
  assert.match(workflow, /npm run media-safety/)
})
