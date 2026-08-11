import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TurnOwnership,
  VoiceActivityDetector,
  boundedTranscript,
  calculateEnergy,
  chooseRecorderMimeType,
} from '../../web/core.js'

test('turn ownership fences stale completions after cancellation', () => {
  const ownership = new TurnOwnership()
  const first = ownership.begin('turn-1')
  assert.equal(ownership.isCurrent(first), true)
  assert.equal(ownership.cancel().turnId, 'turn-1')
  assert.equal(ownership.isCurrent(first), false)

  const second = ownership.begin('turn-2')
  assert.equal(ownership.isCurrent(second), true)
  ownership.complete(second)
  assert.equal(ownership.active, null)
})

test('audio energy is normalized from analyser samples', () => {
  assert.equal(calculateEnergy(new Uint8Array([128, 128, 128])), 0)
  assert.ok(calculateEnergy(new Uint8Array([0, 255, 0])) > 0.9)
})

test('voice activity opens after sustained speech and closes after sustained silence', () => {
  const vad = new VoiceActivityDetector({
    startEnergy: 0.05,
    stopEnergy: 0.02,
    startFrames: 2,
    stopFrames: 3,
    noiseAlpha: 0,
  })

  assert.equal(vad.update(0.01), null)
  assert.equal(vad.update(0.08), null)
  assert.equal(vad.update(0.08), 'speech-start')
  assert.equal(vad.update(0.06), null)
  assert.equal(vad.update(0.01), null)
  assert.equal(vad.update(0.01), null)
  assert.equal(vad.update(0.01), 'speech-end')
  assert.equal(vad.speaking, false)
})

test('transcripts and recorder formats are bounded and deterministic', () => {
  assert.equal(boundedTranscript('  hello   Jarvis  ', 40), 'hello Jarvis')
  assert.equal(boundedTranscript('abcdef', 5), 'abcd…')
  assert.equal(
    chooseRecorderMimeType((type) => type === 'audio/webm;codecs=opus'),
    'audio/webm;codecs=opus',
  )
})
