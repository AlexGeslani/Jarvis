import {
  TurnOwnership,
  VoiceActivityDetector,
  boundedTranscript,
  calculateEnergy,
  chooseRecorderMimeType,
  safeErrorMessage,
} from './core.js'

const experience = document.querySelector('.experience')
const canvas = document.querySelector('#presence')
const statusElement = document.querySelector('#status')
const stateLabel = document.querySelector('#state-label')
const connectionElement = document.querySelector('#connection')
const transcriptElement = document.querySelector('#transcript')
const dialogueButton = document.querySelector('#dialogue')
const dialogueLabel = document.querySelector('#dialogue-label')
const talkButton = document.querySelector('#talk')
const talkLabel = document.querySelector('#talk-label')
const textForm = document.querySelector('#text-form')
const textInput = document.querySelector('#text-input')
const sendButton = document.querySelector('#send')
const cancelButton = document.querySelector('#cancel')

const API = '/api/v1'
const TURN_ENDPOINT = '/api/v1/turns'
const MAX_CAPTURE_MS = 12_000
const VAD_SAMPLE_MS = 50
const DIALOGUE_IDLE_MS = 180_000
const ownership = new TurnOwnership()

let session = null
let capture = null
let dialogue = null
let playbackContext = null
let activePlayback = null

class Presence {
  constructor(target) {
    this.canvas = target
    this.context = target.getContext('2d', { alpha: true })
    this.state = 'idle'
    this.analyser = null
    this.samples = new Uint8Array(128)
    this.energy = 0
    this.frameRequest = null
    this.reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.reducedMotion = this.reducedQuery.matches
    this.particles = Array.from({ length: 74 }, (_, index) => ({
      angle: (index / 74) * Math.PI * 2 + Math.random() * 0.18,
      distance: 1.05 + Math.random() * 1.15,
      depth: 0.28 + Math.random() * 0.72,
      speed: 0.16 + Math.random() * 0.44,
      size: 0.6 + Math.random() * 1.9,
    }))
    this.resize = this.resize.bind(this)
    this.draw = this.draw.bind(this)
    window.addEventListener('resize', this.resize, { passive: true })
    this.reducedQuery.addEventListener?.('change', (event) => {
      this.reducedMotion = event.matches
      if (this.reducedMotion && this.frameRequest) cancelAnimationFrame(this.frameRequest)
      this.frameRequest = null
      this.draw(performance.now())
    })
    this.resize()
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    this.canvas.width = Math.round(width * ratio)
    this.canvas.height = Math.round(height * ratio)
    this.canvas.dataset.ratio = String(ratio)
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
    this.draw(performance.now())
  }

  setState(state, analyser = null) {
    this.state = state
    this.analyser = analyser
    this.canvas.setAttribute('aria-label', `Jarvis presence visualization: ${state}`)
    experience.dataset.state = state
    const labels = {
      idle: 'STANDBY',
      listening: 'LISTENING',
      thinking: 'PROCESSING',
      speaking: 'RESPONDING',
      error: 'ATTENTION',
    }
    stateLabel.textContent = labels[state] || state.toUpperCase()
    if (this.reducedMotion) this.draw(performance.now())
  }

  sampleEnergy() {
    if (!this.analyser) {
      this.energy *= 0.91
      return this.energy
    }
    if (this.samples.length !== this.analyser.fftSize) {
      this.samples = new Uint8Array(this.analyser.fftSize)
    }
    this.analyser.getByteTimeDomainData(this.samples)
    const measured = calculateEnergy(this.samples)
    this.energy = this.energy * 0.72 + measured * 0.28
    return this.energy
  }

  draw(timestamp = 0) {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest)
    this.frameRequest = null

    const context = this.context
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    const mobile = width < 900
    const centerX = width * 0.5
    const centerY = height * (mobile ? 0.41 : 0.49)
    const baseRadius = Math.min(width, height) * (mobile ? 0.17 : 0.2)
    const reducedTime = this.reducedMotion ? 0 : timestamp / 1000
    const energy = this.reducedMotion ? 0.08 : this.sampleEnergy()
    const statePulse = this.state === 'thinking' ? 0.1 : energy * 0.5
    const pulse = 1 + statePulse + Math.sin(reducedTime * 1.7) * 0.018
    const palette = this.state === 'error'
      ? { primary: '#ff416c', secondary: '#78264d', rgb: '255,65,108' }
      : this.state === 'thinking'
        ? { primary: '#7468ff', secondary: '#00b9e8', rgb: '103,92,255' }
        : { primary: '#00e5ff', secondary: '#675cff', rgb: '0,229,255' }

    context.clearRect(0, 0, width, height)
    context.save()
    context.globalCompositeOperation = 'lighter'

    const ambient = context.createRadialGradient(
      centerX,
      centerY,
      baseRadius * 0.12,
      centerX,
      centerY,
      baseRadius * 2.65,
    )
    ambient.addColorStop(0, `rgba(${palette.rgb},${0.22 + energy * 0.24})`)
    ambient.addColorStop(0.35, `rgba(${palette.rgb},${0.075 + energy * 0.08})`)
    ambient.addColorStop(0.72, 'rgba(103,92,255,.025)')
    ambient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = ambient
    context.beginPath()
    context.arc(centerX, centerY, baseRadius * 2.65, 0, Math.PI * 2)
    context.fill()

    this.drawParticles(context, centerX, centerY, baseRadius, reducedTime, energy, palette)
    this.drawSegmentedRing(context, centerX, centerY, baseRadius * 1.62, reducedTime * 0.2, 28, palette.primary, 0.42, 1)
    this.drawSegmentedRing(context, centerX, centerY, baseRadius * 1.37, -reducedTime * 0.38, 18, palette.secondary, 0.55, 1.4)
    this.drawSegmentedRing(context, centerX, centerY, baseRadius * 1.13, reducedTime * 0.64, 12, palette.primary, 0.72, 1.2 + energy * 2)

    context.save()
    context.translate(centerX, centerY)
    context.rotate(reducedTime * (this.state === 'thinking' ? 0.7 : 0.22))
    context.strokeStyle = `rgba(${palette.rgb},.22)`
    context.lineWidth = 1
    for (let index = 0; index < 6; index += 1) {
      context.rotate(Math.PI / 3)
      context.beginPath()
      context.moveTo(baseRadius * 0.58, 0)
      context.lineTo(baseRadius * 0.98, 0)
      context.stroke()
      context.beginPath()
      context.arc(baseRadius * 1.02, 0, 2 + energy * 3, 0, Math.PI * 2)
      context.fillStyle = palette.primary
      context.fill()
    }
    context.restore()

    const shellRadius = baseRadius * 0.83 * pulse
    const shell = context.createRadialGradient(
      centerX - shellRadius * 0.22,
      centerY - shellRadius * 0.25,
      shellRadius * 0.04,
      centerX,
      centerY,
      shellRadius,
    )
    shell.addColorStop(0, 'rgba(235,254,255,.98)')
    shell.addColorStop(0.12, `rgba(${palette.rgb},${0.9 + energy * 0.1})`)
    shell.addColorStop(0.42, `rgba(${palette.rgb},.28)`)
    shell.addColorStop(0.68, 'rgba(21,31,91,.2)')
    shell.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = shell
    context.beginPath()
    context.arc(centerX, centerY, shellRadius, 0, Math.PI * 2)
    context.fill()

    context.strokeStyle = `rgba(${palette.rgb},${0.55 + energy * 0.35})`
    context.lineWidth = 1.4 + energy * 3
    context.beginPath()
    const points = 96
    for (let index = 0; index <= points; index += 1) {
      const angle = (index / points) * Math.PI * 2
      const wave = Math.sin(angle * 6 + reducedTime * 2.4) * (2 + energy * baseRadius * 0.17)
      const radius = baseRadius * 0.91 + wave
      const x = centerX + Math.cos(angle) * radius
      const y = centerY + Math.sin(angle) * radius
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.closePath()
    context.stroke()

    context.fillStyle = 'rgba(238,254,255,.96)'
    context.shadowColor = palette.primary
    context.shadowBlur = 18 + energy * 44
    context.beginPath()
    context.arc(centerX, centerY, Math.max(5, baseRadius * (0.08 + energy * 0.08)), 0, Math.PI * 2)
    context.fill()
    context.restore()

    if (!this.reducedMotion) this.frameRequest = requestAnimationFrame(this.draw)
  }

  drawParticles(context, centerX, centerY, baseRadius, time, energy, palette) {
    const speedScale = this.state === 'thinking' ? 1.8 : this.state === 'speaking' ? 1.25 : 0.55
    const visible = this.reducedMotion ? this.particles.slice(0, 16) : this.particles
    for (const particle of visible) {
      const angle = particle.angle + time * particle.speed * speedScale
      const distance = baseRadius * particle.distance * (1 + energy * 0.12)
      const stretch = 0.78 + particle.depth * 0.22
      const x = centerX + Math.cos(angle) * distance
      const y = centerY + Math.sin(angle) * distance * stretch
      const alpha = 0.12 + particle.depth * 0.42 + energy * 0.18
      context.fillStyle = particle.depth > 0.66
        ? `rgba(${palette.rgb},${alpha})`
        : `rgba(103,92,255,${alpha * 0.72})`
      context.beginPath()
      context.arc(x, y, particle.size * (0.7 + energy), 0, Math.PI * 2)
      context.fill()
    }
  }

  drawSegmentedRing(context, x, y, radius, rotation, segments, color, alpha, width) {
    context.save()
    context.translate(x, y)
    context.rotate(rotation)
    context.strokeStyle = color
    context.globalAlpha = alpha
    context.lineWidth = width
    const step = (Math.PI * 2) / segments
    for (let index = 0; index < segments; index += 1) {
      const start = index * step
      const length = step * (index % 4 === 0 ? 0.72 : 0.43)
      context.beginPath()
      context.arc(0, 0, radius, start, start + length)
      context.stroke()
    }
    context.restore()
  }
}

const presence = new Presence(canvas)

function idempotencyKey() {
  return crypto.randomUUID()
}

async function ensureSession() {
  if (session) return session
  setStatus('Establishing secure local session', 'thinking')
  const response = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey() },
    cache: 'no-store',
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(safeErrorMessage(payload, 'Local session unavailable.'))
  session = payload
  connectionElement.textContent = 'LOCAL LINK'
  setStatus('Local voice link ready', 'idle')
  return session
}

function sessionHeaders(key = null) {
  return {
    'X-Jarvis-Session': session.session_id,
    'X-Jarvis-CSRF': session.csrf_token,
    ...(key ? { 'Idempotency-Key': key } : {}),
  }
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function setStatus(message, state = null) {
  statusElement.textContent = message
  if (state) presence.setState(state)
}

function setBusy(busy) {
  talkButton.disabled = busy || Boolean(dialogue)
  dialogueButton.disabled = Boolean(capture) || (busy && !dialogue)
  sendButton.disabled = busy
  textInput.disabled = busy
  cancelButton.disabled = !busy
}

function addTranscript(speaker, text, className) {
  const system = transcriptElement.querySelector('.system-line')
  if (system) system.remove()
  const item = document.createElement('li')
  item.className = className
  const label = document.createElement('span')
  label.className = 'speaker'
  label.textContent = speaker
  const copy = document.createTextNode(boundedTranscript(text, 1_200))
  item.append(label, copy)
  transcriptElement.append(item)
  while (transcriptElement.children.length > 8) transcriptElement.firstElementChild.remove()
  transcriptElement.scrollTop = transcriptElement.scrollHeight
}

async function runTurn({ text = '', audioBlob = null } = {}) {
  if (ownership.active) return false
  await ensureSession()
  primePlayback()
  const turnId = crypto.randomUUID()
  const controller = new AbortController()
  const ticket = ownership.begin(turnId, controller)
  setBusy(true)
  setStatus('Resolving on the private local link', 'thinking')

  const headers = sessionHeaders(idempotencyKey())
  let body
  if (audioBlob) {
    body = new FormData()
    body.append('session_id', session.session_id)
    body.append('turn_id', turnId)
    body.append('response_format', 'wav')
    body.append('audio', audioBlob, 'jarvis-capture.webm')
  } else {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({
      session_id: session.session_id,
      turn_id: turnId,
      input: { type: 'text', text },
      response_format: 'wav',
    })
  }

  try {
    const response = await fetch(TURN_ENDPOINT, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      signal: controller.signal,
    })
    const payload = await readJson(response)
    if (!response.ok) {
      if (payload?.error?.code === 'session_denied') session = null
      throw new Error(safeErrorMessage(payload))
    }
    if (!ownership.isCurrent(ticket)) return
    addTranscript('You', payload.transcript, 'user-line')
    addTranscript('Jarvis', payload.response_text, 'assistant-line')

    const audioResponse = await fetch(payload.audio.url, {
      headers: sessionHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!audioResponse.ok) throw new Error('Jarvis responded, but audio playback was unavailable.')
    const audioBytes = await audioResponse.arrayBuffer()
    if (!ownership.isCurrent(ticket)) return
    await playAudio(audioBytes, ticket)
    if (!ownership.isCurrent(ticket)) return
    ownership.complete(ticket)
    setStatus('Ready when you are', 'idle')
    return true
  } catch (error) {
    if (error.name === 'AbortError' || !ownership.isCurrent(ticket)) return false
    ownership.complete(ticket)
    showError(error.message)
    return false
  } finally {
    if (!ownership.active) setBusy(Boolean(capture))
  }
}

function primePlayback() {
  try {
    if (!playbackContext) playbackContext = new AudioContext()
    if (playbackContext.state === 'suspended') playbackContext.resume().catch(() => {})
  } catch {
    playbackContext = null
  }
}

async function playAudio(arrayBuffer, ticket) {
  if (!playbackContext) primePlayback()
  if (!playbackContext) throw new Error('Audio playback is not supported in this browser.')
  if (playbackContext.state === 'suspended') await playbackContext.resume()
  const decoded = await playbackContext.decodeAudioData(arrayBuffer.slice(0))
  if (!ownership.isCurrent(ticket)) return
  const source = playbackContext.createBufferSource()
  const analyser = playbackContext.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.72
  source.buffer = decoded
  source.connect(analyser)
  analyser.connect(playbackContext.destination)
  activePlayback = { source, analyser }
  presence.setState('speaking', analyser)
  statusElement.textContent = 'Voice response active'
  await new Promise((resolve, reject) => {
    const abort = () => {
      try { source.stop() } catch {}
      reject(new DOMException('Playback cancelled', 'AbortError'))
    }
    ticket.controller.signal.addEventListener('abort', abort, { once: true })
    source.addEventListener('ended', () => {
      ticket.controller.signal.removeEventListener('abort', abort)
      resolve()
    }, { once: true })
    source.start()
  }).finally(() => {
    source.disconnect()
    analyser.disconnect()
    if (activePlayback?.source === source) activePlayback = null
    presence.setState('idle')
  })
}

async function beginCapture(pointerId = null) {
  if (capture || dialogue || ownership.active) return
  primePlayback()
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError('Microphone capture is not supported in this browser.')
    return
  }
  try {
    await ensureSession()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const context = new AudioContext()
    if (context.state === 'suspended') await context.resume()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.65
    source.connect(analyser)
    const mimeType = chooseRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate))
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    const chunks = []
    const state = {
      stream,
      context,
      source,
      analyser,
      recorder,
      chunks,
      discard: false,
      pointerId,
      timer: null,
    }
    capture = state
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => finishCapture(state), { once: true })
    recorder.start(250)
    state.timer = window.setTimeout(stopCapture, MAX_CAPTURE_MS)
    talkButton.classList.add('is-recording')
    talkLabel.textContent = 'Release to send'
    cancelButton.disabled = false
    textInput.disabled = true
    sendButton.disabled = true
    presence.setState('listening', analyser)
    statusElement.textContent = 'Listening · release to send'
  } catch (error) {
    cleanupCapture(capture)
    capture = null
    showError(error.name === 'NotAllowedError' ? 'Microphone permission was not granted.' : 'Microphone capture could not start.')
  }
}

function stopCapture() {
  if (!capture || capture.recorder.state === 'inactive') return
  capture.recorder.stop()
  setStatus('Preparing voice turn', 'thinking')
}

async function finishCapture(state) {
  const type = state.recorder.mimeType || 'audio/webm'
  const blob = new Blob(state.chunks, { type })
  const discard = state.discard
  cleanupCapture(state)
  if (capture === state) capture = null
  talkButton.classList.remove('is-recording')
  talkLabel.textContent = 'Hold to talk'
  if (discard || blob.size === 0) {
    setBusy(false)
    setStatus('Ready when you are', 'idle')
    return
  }
  await runTurn({ audioBlob: blob })
}

function cleanupCapture(state) {
  if (!state) return
  if (state.timer) window.clearTimeout(state.timer)
  state.source?.disconnect()
  for (const track of state.stream?.getTracks?.() || []) track.stop()
  state.context?.close?.().catch(() => {})
}

function setDialogueUi(active) {
  dialogueButton.classList.toggle('is-active', active)
  dialogueButton.setAttribute('aria-pressed', String(active))
  dialogueLabel.textContent = active ? 'End dialogue' : 'Open dialogue'
}

function armDialogueIdleTimeout(state) {
  if (state.idleTimer) window.clearTimeout(state.idleTimer)
  state.idleTimer = window.setTimeout(() => {
    if (dialogue === state) stopDialogue('Open dialogue paused after three minutes of silence')
  }, DIALOGUE_IDLE_MS)
}

function resumeDialogue(state) {
  if (dialogue !== state || !state.enabled) return
  state.suspended = false
  state.vad.reset()
  armDialogueIdleTimeout(state)
  setStatus('Open dialogue · listening', 'listening')
  presence.setState('listening', state.analyser)
  setBusy(false)
}

async function startDialogue() {
  if (dialogue || capture || ownership.active) return
  primePlayback()
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError('Open dialogue is not supported in this browser.')
    return
  }

  let stream = null
  let context = null
  let source = null
  dialogueButton.disabled = true
  try {
    await ensureSession()
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    context = new AudioContext()
    if (context.state === 'suspended') await context.resume()
    source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.35
    source.connect(analyser)

    const state = {
      enabled: true,
      suspended: false,
      stream,
      context,
      source,
      analyser,
      samples: new Uint8Array(analyser.fftSize),
      vad: new VoiceActivityDetector(),
      recorder: null,
      sampleTimer: null,
      idleTimer: null,
    }
    dialogue = state
    state.sampleTimer = window.setInterval(() => sampleDialogue(state), VAD_SAMPLE_MS)
    setDialogueUi(true)
    resumeDialogue(state)
  } catch (error) {
    source?.disconnect()
    for (const track of stream?.getTracks?.() || []) track.stop()
    context?.close?.().catch(() => {})
    dialogue = null
    setDialogueUi(false)
    showError(error.name === 'NotAllowedError' ? 'Microphone permission was not granted.' : 'Open dialogue could not start.')
  } finally {
    dialogueButton.disabled = false
    setBusy(Boolean(ownership.active || capture))
  }
}

function sampleDialogue(state) {
  if (dialogue !== state || !state.enabled || state.suspended || ownership.active || activePlayback) {
    state.vad.reset()
    return
  }
  state.analyser.getByteTimeDomainData(state.samples)
  const event = state.vad.update(calculateEnergy(state.samples))
  if (event === 'speech-start' && !state.recorder) beginDialogueUtterance(state)
  if (event === 'speech-end' && state.recorder) stopDialogueUtterance(state)
}

function beginDialogueUtterance(state) {
  if (dialogue !== state || state.recorder) return
  try {
    const mimeType = chooseRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate))
    const recorder = mimeType ? new MediaRecorder(state.stream, { mimeType }) : new MediaRecorder(state.stream)
    const utterance = { recorder, chunks: [], discard: false, timer: null }
    state.recorder = utterance
    if (state.idleTimer) window.clearTimeout(state.idleTimer)
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) utterance.chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => finishDialogueUtterance(state, utterance), { once: true })
    recorder.start(250)
    utterance.timer = window.setTimeout(() => stopDialogueUtterance(state), MAX_CAPTURE_MS)
    setBusy(true)
    setStatus('Speech detected · listening', 'listening')
    presence.setState('listening', state.analyser)
  } catch {
    stopDialogue('')
    showError('Open dialogue audio capture could not start.')
  }
}

function stopDialogueUtterance(state, discard = false) {
  const utterance = state?.recorder
  if (!utterance || utterance.recorder.state === 'inactive') return
  utterance.discard ||= discard
  state.suspended = true
  utterance.recorder.stop()
  setStatus(discard ? 'Voice utterance cancelled' : 'Preparing voice turn', discard ? 'idle' : 'thinking')
}

async function finishDialogueUtterance(state, utterance) {
  if (utterance.timer) window.clearTimeout(utterance.timer)
  if (state.recorder === utterance) state.recorder = null
  const type = utterance.recorder.mimeType || 'audio/webm'
  const blob = new Blob(utterance.chunks, { type })
  if (dialogue !== state || !state.enabled) return
  if (utterance.discard || blob.size === 0) {
    resumeDialogue(state)
    return
  }

  const completed = await runTurn({ audioBlob: blob })
  if (dialogue !== state || !state.enabled) return
  if (completed) {
    resumeDialogue(state)
  } else {
    window.setTimeout(() => resumeDialogue(state), 4_500)
  }
}

function stopDialogue(message = 'Open dialogue stopped') {
  const state = dialogue
  if (!state) return
  dialogue = null
  state.enabled = false
  if (state.sampleTimer) window.clearInterval(state.sampleTimer)
  if (state.idleTimer) window.clearTimeout(state.idleTimer)
  if (state.recorder) {
    state.recorder.discard = true
    if (state.recorder.timer) window.clearTimeout(state.recorder.timer)
    if (state.recorder.recorder.state !== 'inactive') state.recorder.recorder.stop()
  }
  state.source?.disconnect()
  for (const track of state.stream?.getTracks?.() || []) track.stop()
  state.context?.close?.().catch(() => {})
  setDialogueUi(false)
  setBusy(Boolean(ownership.active || capture))
  if (message && !ownership.active && !capture) setStatus(message, 'idle')
}

async function toggleDialogue() {
  if (dialogue) stopDialogue()
  else await startDialogue()
}

async function cancelActive() {
  if (dialogue?.recorder) stopDialogueUtterance(dialogue, true)
  if (capture) {
    capture.discard = true
    stopCapture()
  }
  const active = ownership.cancel()
  if (!active) return
  setStatus('Cancelling active turn', 'thinking')
  try {
    await fetch(`${TURN_ENDPOINT}/${encodeURIComponent(active.turnId)}/cancel`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(idempotencyKey()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_id: session.session_id }),
      cache: 'no-store',
    })
  } catch {
    // Local cancellation remains authoritative even if the server is already complete.
  } finally {
    active.controller?.abort()
    if (activePlayback) {
      try { activePlayback.source.stop() } catch {}
      activePlayback = null
    }
    setBusy(false)
    setStatus('Turn cancelled', 'idle')
  }
}

function showError(message) {
  setBusy(false)
  connectionElement.textContent = 'CHECK LINK'
  setStatus(boundedTranscript(message, 220), 'error')
  window.setTimeout(() => {
    if (!ownership.active && !capture) {
      connectionElement.textContent = session ? 'LOCAL LINK' : 'DISCONNECTED'
      if (dialogue?.enabled) {
        setStatus('Open dialogue · listening', 'listening')
        presence.setState('listening', dialogue.analyser)
      } else {
        setStatus(session ? 'Ready when you are' : 'Local session unavailable', session ? 'idle' : 'error')
      }
    }
  }, 4_500)
}

textForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = boundedTranscript(textInput.value, 2_000)
  if (!text || ownership.active || capture) return
  primePlayback()
  textInput.value = ''
  runTurn({ text }).catch((error) => showError(error.message))
})

talkButton.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  talkButton.setPointerCapture?.(event.pointerId)
  beginCapture(event.pointerId)
})
talkButton.addEventListener('pointerup', (event) => {
  event.preventDefault()
  stopCapture()
})
talkButton.addEventListener('pointercancel', stopCapture)
talkButton.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
    event.preventDefault()
    beginCapture()
  }
})
talkButton.addEventListener('keyup', (event) => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    stopCapture()
  }
})
dialogueButton.addEventListener('click', toggleDialogue)
cancelButton.addEventListener('click', cancelActive)
window.addEventListener('pagehide', () => {
  if (dialogue) stopDialogue('')
  if (capture) {
    capture.discard = true
    stopCapture()
  }
  ownership.cancel()?.controller?.abort()
  playbackContext?.close?.().catch(() => {})
})

ensureSession().catch((error) => showError(error.message))
