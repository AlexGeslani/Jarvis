export class TurnOwnership {
  constructor() {
    this.generation = 0
    this.active = null
  }

  begin(turnId, controller = null) {
    this.generation += 1
    const ticket = Object.freeze({ turnId, generation: this.generation, controller })
    this.active = ticket
    return ticket
  }

  isCurrent(ticket) {
    return Boolean(
      ticket
      && this.active
      && ticket.generation === this.active.generation
      && ticket.turnId === this.active.turnId,
    )
  }

  complete(ticket) {
    if (!this.isCurrent(ticket)) return false
    this.active = null
    this.generation += 1
    return true
  }

  cancel() {
    const current = this.active
    this.active = null
    this.generation += 1
    return current
  }
}

export function calculateEnergy(samples) {
  if (!samples || samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) {
    const centered = sample - 128
    sum += centered * centered
  }
  return Math.min(1, Math.sqrt(sum / samples.length) / 128)
}

export class VoiceActivityDetector {
  constructor({
    startEnergy = 0.03,
    stopEnergy = 0.015,
    startFrames = 2,
    stopFrames = 12,
    noiseAlpha = 0.04,
  } = {}) {
    this.startEnergy = startEnergy
    this.stopEnergy = stopEnergy
    this.startFrames = startFrames
    this.stopFrames = stopFrames
    this.noiseAlpha = noiseAlpha
    this.noiseFloor = 0.008
    this.reset()
  }

  reset() {
    this.speaking = false
    this.aboveFrames = 0
    this.belowFrames = 0
  }

  update(value) {
    const energy = Math.max(0, Math.min(1, Number(value) || 0))
    if (!this.speaking) {
      const threshold = Math.max(this.startEnergy, this.noiseFloor * 2.2)
      if (energy >= threshold) {
        this.aboveFrames += 1
      } else {
        this.aboveFrames = 0
        if (energy < this.startEnergy) {
          this.noiseFloor = this.noiseFloor * (1 - this.noiseAlpha) + energy * this.noiseAlpha
        }
      }
      if (this.aboveFrames >= this.startFrames) {
        this.speaking = true
        this.aboveFrames = 0
        this.belowFrames = 0
        return 'speech-start'
      }
      return null
    }

    const threshold = Math.max(this.stopEnergy, this.noiseFloor * 1.5)
    this.belowFrames = energy <= threshold ? this.belowFrames + 1 : 0
    if (this.belowFrames >= this.stopFrames) {
      this.reset()
      return 'speech-end'
    }
    return null
  }
}

export function boundedTranscript(value, limit = 500) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

export function chooseRecorderMimeType(isSupported) {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
  ]
  return candidates.find((candidate) => isSupported(candidate)) || ''
}

export function safeErrorMessage(payload, fallback = 'Jarvis could not complete that request.') {
  const message = payload?.error?.message
  return typeof message === 'string' && message.length <= 240 ? message : fallback
}
