import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const scanner = resolve('scripts/public-safety-check.py')

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-public-safety-'))
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0)
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0)
  return root
}

function scan(root) {
  return spawnSync('python3.11', [scanner, '--root', root], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

test('public safety scanner accepts documented placeholders, public digests, and protocol fixtures', async () => {
  const root = await fixture({
    'README.md': 'Designed for a user-operated private LAN.\n',
    '.env.example': 'JARVIS_API_TOKEN=\nJARVIS_PORT=8080\nJARVIS_ALLOWED_ORIGIN=https://jarvis.example\n',
    'package-lock.json': '{"integrity":"sha512-3pmyT9qbNwcEh6Vu2khH+1OEeYInYm6zZWVQsp2Jz+UrvGo/xxp9cbqjfXiOh4LvM0b3p560tBWFtlROwKbL0w=="}\n',
    'tests/protocol.txt': 'Authorization: Bearer opaque-test-key\nJARVIS_API_TOKEN=example-token\n',
  })
  try {
    const result = scan(root)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /^public_safety=passed files_scanned=4 findings=0\n$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('public safety scanner reports categories and safe paths without printing matched values', async () => {
  const prohibited = {
    hostname: ['private-gateway', 'lan'].join('.'),
    address: ['192', '168', '44', '9'].join('.'),
    userPath: `/${['Users', 'example', 'private-service'].join('/')}`,
    secret: 'do-not-print-this-secret',
  }
  const keyMarker = `-----BEGIN ${'PRIVATE'} ${'KEY'}-----`
  const root = await fixture({
    'config.txt': `${prohibited.hostname}\n${prohibited.address}\n${prohibited.userPath}\n${keyMarker}\n`,
    'secrets.env': `JARVIS_API_TOKEN=${prohibited.secret}\n`,
    'watch/review/candidate-qr.png': 'fixture only',
    'watch/dist/release.zab': 'fixture only',
    'api/src/example.egg-info/PKG-INFO': 'fixture only',
    'recordings/turn.wav': 'fixture only',
    'transcripts/turn.txt': 'fixture only',
    'sessions/state.json': '{}',
    'logs/runtime.log': 'fixture only',
  })
  try {
    const result = scan(root)
    const output = result.stdout + result.stderr
    assert.equal(result.status, 1, output)
    for (const category of [
      'private_hostname', 'private_address', 'user_absolute_path', 'private_key',
      'populated_secret', 'qr_artifact', 'build_artifact', 'package_metadata',
      'audio_capture', 'transcript_artifact', 'session_artifact', 'log_artifact',
    ]) {
      assert.match(result.stdout, new RegExp(`category=${category} count=\\d+`))
    }
    assert.match(result.stdout, /path=config\.txt categories=/)
    for (const value of Object.values(prohibited)) assert.doesNotMatch(output, new RegExp(value.replaceAll('.', '\\.')))
    assert.doesNotMatch(output, /JARVIS_API_TOKEN=/)
    assert.equal(result.stderr, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('public safety scanner scans untracked candidates but excludes ignored local files', async () => {
  const root = await fixture({
    '.gitignore': 'private/\n',
    'README.md': 'Safe candidate.\n',
    'private/local.env': 'JARVIS_API_TOKEN=local-value-never-scanned\n',
  })
  try {
    await writeFile(join(root, 'candidate.env'), 'JARVIS_API_TOKEN=unsafe-untracked-value\n')
    const result = scan(root)
    const output = result.stdout + result.stderr
    assert.equal(result.status, 1, output)
    assert.match(result.stdout, /path=candidate\.env categories=populated_secret:1 count=1/)
    assert.doesNotMatch(output, /local-value-never-scanned|unsafe-untracked-value/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
