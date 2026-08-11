import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(path, 'utf8')
}

test('browser declares and packages a self-contained Jarvis AI-core favicon', async () => {
  const html = await source('web/index.html')

  assert.match(
    html,
    /<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg">/,
    'the browser document must declare the SVG tab icon',
  )

  const [favicon, dockerfile] = await Promise.all([
    source('web/favicon.svg'),
    source('web/Dockerfile'),
  ])

  assert.match(favicon, /<svg[^>]+width="64"[^>]+height="64"[^>]+viewBox="0 0 64 64"/)
  assert.match(favicon, /<title[^>]*>Jarvis AI core<\/title>/)
  assert.match(favicon, /data-role="outer-core"/)
  assert.match(favicon, /data-role="segmented-ring"/)
  assert.match(favicon, /data-role="diamond-core"/)
  assert.match(favicon, /#00e5ff/i)
  assert.match(favicon, /#675cff/i)
  assert.doesNotMatch(favicon, /<(?:script|image)\b|(?:xlink:)?href=/i)
  assert.match(dockerfile, /COPY[^\n]*favicon\.svg[^\n]*\/usr\/share\/nginx\/html\//)
})
