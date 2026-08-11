import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'


test('verify workflow is pinned, non-deploying, and covers every publication gate', async () => {
  const [workflow, pkg] = await Promise.all([
    readFile('.github/workflows/verify.yml', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
  ])

  const uses = [...workflow.matchAll(/^\s*- uses:\s*([^\s]+)$/gm)].map((match) => match[1])
  assert.ok(uses.length >= 3)
  for (const action of uses) assert.match(action, /^[^@]+@[0-9a-f]{40}$/)
  assert.match(workflow, /node-version:\s*['"]20['"]/)
  assert.match(workflow, /python-version:\s*['"]3\.11['"]/)
  assert.match(workflow, /apt-get install --yes ffmpeg libopus0/)
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /pytest -c api\/pyproject\.toml api\/tests/)
  assert.match(workflow, /docker compose config/)
  assert.match(workflow, /JARVIS_ALLOWED_ORIGIN:\s*https:\/\/jarvis\.example/)
  assert.match(workflow, /npm run validate:publication/)
  assert.match(workflow, /npm run public-safety/)
  assert.match(workflow, /git diff --check/)
  assert.doesNotMatch(workflow, /deploy|pages|upload-pages/i)
  assert.equal(pkg.scripts['validate:publication'], 'uv run --project api --python 3.11 --extra test python scripts/validate-publication.py')
  assert.equal(pkg.scripts['public-safety'], 'python3.11 scripts/public-safety-check.py')
})

test('publication validator checks OpenAPI, local links, image assets, and XML', () => {
  const result = spawnSync(
    'uv',
    ['run', '--project', 'api', '--python', '3.11', '--extra', 'test', 'python', 'scripts/validate-publication.py'],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(
    result.stdout,
    /^publication_validation=passed markdown_files=\d+ local_links=\d+ images=\d+ xml_files=\d+ openapi_documents=1\n$/,
  )
  assert.equal(result.stderr, '')
})
