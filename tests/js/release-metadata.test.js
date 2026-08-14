import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const RELEASE = '0.1.8'
const WATCH_RELEASE = '0.1.12'


test('release metadata is aligned to 0.1.8 and the tested Python runtime', async () => {
  const [root, lock, watch, manifest, pyproject, pythonPackage, openapi] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('package-lock.json', 'utf8').then(JSON.parse),
    readFile('watch/package.json', 'utf8').then(JSON.parse),
    readFile('watch/app.json', 'utf8').then(JSON.parse),
    readFile('api/pyproject.toml', 'utf8'),
    readFile('api/src/jarvis_api/__init__.py', 'utf8'),
    readFile('docs/openapi.yaml', 'utf8'),
  ])

  assert.equal(root.version, RELEASE)
  assert.equal(lock.version, RELEASE)
  assert.equal(lock.packages[''].version, RELEASE)
  assert.equal(lock.packages.watch.version, WATCH_RELEASE)
  assert.equal(watch.version, WATCH_RELEASE)
  assert.match(watch.scripts.build, /npx --yes @zeppos\/zeus-cli@1\.9\.3 build/)
  assert.equal(manifest.app.version.name, WATCH_RELEASE)
  assert.equal(manifest.app.vender, 'Alphatrion')
  assert.match(pyproject, /^version = "0\.1\.8"$/m)
  assert.match(pyproject, /^requires-python = ">=3\.11,<3\.12"$/m)
  assert.match(pythonPackage, /__version__ = "0\.1\.8"/)
  assert.match(openapi, /^  version: 0\.1\.8$/m)
})
