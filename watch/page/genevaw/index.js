import ui from '@zos/ui'
import { readFileSync, rmSync } from '@zos/fs'
import { codec, create, id } from '@zos/media'
import { clearTimeout, setTimeout } from '@zos/timer'
import { BasePage } from '@zeppos/zml/base-page'
import {
  boundedWatchText,
  createTransfer,
  createTurnId,
  presenceFrame,
} from '../../core/protocol'
import { createScopedPlaybackVolume } from '../../core/playback-volume'

const MAX_RECORDING_MS = 8000
const STOP_COMPLETION_TIMEOUT_MS = 2000
const CHUNK_CHARACTERS = 6144
const BACKGROUND = 0x010503
const DEEP_GREEN = 0x03180c
const PLATE_GREEN = 0x062512
const TRACK_GREEN = 0x0b3c1f
const MID_GREEN = 0x126632
const SIGNAL_GREEN = 0x18c766
const BRIGHT_GREEN = 0x4dff88
const LIME = 0xa9ff63
const PALE = 0xefffdb
const MUTED = 0x75a887
const CENTER_X = 240
const CENTER_Y = 218
const ORBIT_RADIUS = 124
const NODE_SIZE = 8
const PRESENCE_DELAYS = {
  idle: 560,
  listening: 260,
  thinking: 150,
  speaking: 210,
  error: 480,
}

let recorder = null
let player = null
let responseVolume = null
let activePage = null
let abandonedRecordingFile = null
let recorderStopEventsTrusted = true

function setText(widget, text) {
  if (widget) widget.setProperty(ui.prop.TEXT, text)
}

function removeRecording(file) {
  if (!file) return
  try {
    rmSync(file)
  } catch (ignored) {
    // The recording is already absent or the platform is still finalizing it.
  }
}

function describeError(error) {
  try {
    const detail = error && (error.message || error.code || error.name)
    return boundedWatchText(String(detail || error || 'UNKNOWN ERROR'), 64)
  } catch (ignored) {
    return 'UNKNOWN ERROR'
  }
}

Page(
  BasePage({
    state: {
      session: null,
      mode: 'idle',
      recording: false,
      processing: false,
      recordingFile: null,
      pendingRecorder: null,
      uploadStarted: false,
      tick: 0,
      recordTimer: null,
      stopTimer: null,
      animationTimer: null,
      animationEnabled: false,
      staticBase: null,
      outer: null,
      middle: null,
      core: null,
      glyph: null,
      ringNodes: [],
      nodeGeometry: [],
      status: null,
      response: null,
      action: null,
    },

    build() {
      activePage = this
      this.state.staticBase = ui.createWidget(ui.widget.FILL_RECT, {
        x: 0, y: 0, w: 480, h: 480, color: BACKGROUND,
      })

      this.state.outer = ui.createWidget(ui.widget.FILL_RECT, {
        x: 116, y: 94, w: 248, h: 248, color: TRACK_GREEN, radius: 124,
      })
      ui.createWidget(ui.widget.FILL_RECT, {
        x: 124, y: 102, w: 232, h: 232, color: BACKGROUND, radius: 116,
      })
      this.state.middle = ui.createWidget(ui.widget.FILL_RECT, {
        x: 148, y: 126, w: 184, h: 184, color: MID_GREEN, radius: 92,
      })
      ui.createWidget(ui.widget.FILL_RECT, {
        x: 156, y: 134, w: 168, h: 168, color: DEEP_GREEN, radius: 84,
      })

      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2 - Math.PI / 2
        const x = Math.round(CENTER_X + Math.cos(angle) * ORBIT_RADIUS - NODE_SIZE / 2)
        const y = Math.round(CENTER_Y + Math.sin(angle) * ORBIT_RADIUS - NODE_SIZE / 2)
        this.state.nodeGeometry.push({ x, y })
        this.state.ringNodes.push(ui.createWidget(ui.widget.FILL_RECT, {
          x, y, w: NODE_SIZE, h: NODE_SIZE,
          color: index === 0 ? BRIGHT_GREEN : TRACK_GREEN,
          radius: NODE_SIZE / 2,
        }))
      }

      // Paint text after the ring widgets so the round-screen header stays unobscured.
      ui.createWidget(ui.widget.TEXT, {
        x: 100, y: 34, w: 280, h: 38,
        text: 'J A R V I S', text_size: 24, color: PALE,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      ui.createWidget(ui.widget.TEXT, {
        x: 120, y: 70, w: 240, h: 22,
        text: 'MECHANICAL INTELLIGENCE', text_size: 11, color: MUTED,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })

      this.state.core = ui.createWidget(ui.widget.FILL_RECT, {
        x: 191, y: 169, w: 98, h: 98, color: BRIGHT_GREEN, radius: 49,
      })
      this.state.glyph = ui.createWidget(ui.widget.TEXT, {
        x: 185, y: 161, w: 110, h: 114,
        text: '◇', text_size: 55, color: PALE,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      this.state.status = ui.createWidget(ui.widget.TEXT, {
        x: 104, y: 282, w: 272, h: 34,
        text: 'CONNECTING', text_size: 17, color: BRIGHT_GREEN,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      this.state.response = ui.createWidget(ui.widget.TEXT, {
        x: 74, y: 315, w: 332, h: 46,
        text: 'TAP TO SPEAK', text_size: 15, color: MUTED,
        text_style: ui.text_style.WRAP,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      this.state.action = ui.createWidget(ui.widget.BUTTON, {
        x: 112, y: 364, w: 256, h: 70,
        text: 'START VOICE', text_size: 21,
        normal_color: DEEP_GREEN, press_color: MID_GREEN,
        color: PALE, radius: 35,
      })
      this.state.action.addEventListener(ui.event.CLICK_UP, () => this.toggleRecording())
      ui.createWidget(ui.widget.TEXT, {
        x: 96, y: 440, w: 288, h: 22,
        text: 'V0.1.12  •  8 SEC  •  LAN', text_size: 12, color: MUTED,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      this.startPresenceAnimation()
      this.ensureSession()
    },

    ensureRecorder() {
      if (recorder) return true
      try {
        const createdRecorder = create(id.RECORDER)
        createdRecorder.addEventListener(createdRecorder.event.STOP, () => {
          if (!recorderStopEventsTrusted) return
          if (activePage && activePage.state.pendingRecorder === createdRecorder) {
            activePage.onRecordingStopped(createdRecorder)
          } else {
            removeRecording(abandonedRecordingFile)
            abandonedRecordingFile = null
          }
        })
        recorder = createdRecorder
        return true
      } catch (error) {
        recorder = null
        this.showMediaFailure('MIC INIT FAILED', error)
        return false
      }
    },

    ensurePlayer() {
      if (player) return true
      try {
        player = create(id.PLAYER)
        responseVolume = createScopedPlaybackVolume(player)
        player.addEventListener(player.event.PREPARE, (ready) => {
          if (!activePage) return
          if (!ready) {
            responseVolume.restore()
            activePage.fail('AUDIO UNAVAILABLE')
            return
          }
          if (!responseVolume.apply()) {
            activePage.fail('VOLUME CONTROL FAILED')
            return
          }
          activePage.setPresence('speaking', 'SPEAKING')
          player.start()
        })
        player.addEventListener(player.event.COMPLETE, () => {
          player.stop()
          const restored = responseVolume.restore()
          if (activePage) {
            if (!restored) activePage.fail('VOLUME RESTORE FAILED')
            else activePage.setPresence('idle', 'READY')
          }
        })
        return true
      } catch (error) {
        player = null
        this.showMediaFailure('PLAYER INIT FAILED', error)
        return false
      }
    },

    showMediaFailure(message, error) {
      setText(this.state.status, message)
      setText(this.state.response, describeError(error))
      setText(this.state.action, message === 'MIC INIT FAILED' ? 'RETRY VOICE' : 'UNAVAILABLE')
    },

    async ensureSession() {
      try {
        const result = await this.request({
          method: 'jarvis.session',
          params: { idempotency_key: createTurnId() },
        })
        if (!result || !result.ok || !result.session) {
          const detail = result && (result.detail || result.error)
          throw new Error(detail || 'session unavailable')
        }
        this.state.session = result.session
        this.setPresence('idle', 'READY')
        setText(this.state.response, 'TAP TO SPEAK')
      } catch (error) {
        this.fail('LINK UNAVAILABLE')
        setText(this.state.response, describeError(error))
      }
    },

    async toggleRecording() {
      if (this.state.recording) {
        this.stopRecording()
        return
      }
      if (this.state.processing) return
      if (!this.state.session) {
        await this.ensureSession()
        if (!this.state.session) return
      }
      if (!this.ensureRecorder()) return
      try {
        this.state.recordingFile = `jarvis-turn-${createTurnId()}.opus`
        this.state.pendingRecorder = recorder
        this.state.uploadStarted = false
        recorder.setFormat(codec.OPUS, { target_file: `data://${this.state.recordingFile}` })
        this.state.recording = true
        this.setPresence('listening', 'LISTENING')
        setText(this.state.action, 'STOP & SEND')
        setText(this.state.response, 'SPEAK NOW')
        recorder.start()
        this.state.recordTimer = setTimeout(() => this.stopRecording(), MAX_RECORDING_MS)
      } catch (error) {
        this.state.recording = false
        removeRecording(this.state.recordingFile)
        this.state.recordingFile = null
        this.state.pendingRecorder = null
        this.fail('MICROPHONE ERROR')
      }
    },

    stopRecording() {
      if (!this.state.recording) return
      this.state.recording = false
      if (this.state.recordTimer !== null) clearTimeout(this.state.recordTimer)
      this.state.recordTimer = null
      this.state.processing = true
      setText(this.state.action, 'PLEASE WAIT')
      this.setPresence('thinking', 'PROCESSING')
      try {
        this.state.stopTimer = setTimeout(
          () => this.recoverStoppedRecording(recorder),
          STOP_COMPLETION_TIMEOUT_MS,
        )
        recorder.stop()
      } catch (error) {
        this.releaseRecordingTurn()
        this.fail('MICROPHONE ERROR')
      }
    },

    recoverStoppedRecording(sourceRecorder) {
      if (sourceRecorder !== this.state.pendingRecorder || this.state.uploadStarted) return
      recorderStopEventsTrusted = false
      try {
        if (sourceRecorder.getStatus() === sourceRecorder.state.IDLE) {
          this.onRecordingStopped(sourceRecorder)
          return
        }
      } catch (ignored) {
        // If recorder state cannot be read, release the turn rather than wedge input.
      }
      this.releaseRecordingTurn()
      this.fail('MICROPHONE ERROR')
    },

    releaseRecordingTurn(recordingFile = this.state.recordingFile) {
      if (this.state.stopTimer !== null) clearTimeout(this.state.stopTimer)
      this.state.stopTimer = null
      removeRecording(recordingFile)
      this.state.recordingFile = null
      this.state.pendingRecorder = null
      this.state.uploadStarted = false
      this.state.processing = false
    },

    async onRecordingStopped(sourceRecorder) {
      if (sourceRecorder !== this.state.pendingRecorder) return
      if (this.state.uploadStarted) return
      this.state.uploadStarted = true
      this.state.processing = true
      const recordingFile = this.state.recordingFile
      try {
        const content = readFileSync({ path: recordingFile })
        if (!content) throw new Error('recording is empty')
        const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
        if (bytes.byteLength < 1 || bytes.byteLength > 1_000_000) {
          throw new Error('recording size is invalid')
        }
        const turnId = createTurnId()
        const transfer = createTransfer(bytes, turnId, CHUNK_CHARACTERS)
        let result = await this.request({
          method: 'jarvis.audio.begin',
          params: { manifest: transfer.manifest },
        })
        if (!result || !result.ok) throw new Error('transfer begin failed')
        for (let index = 0; index < transfer.chunks.length; index += 1) {
          result = await this.request({
            method: 'jarvis.audio.chunk',
            params: {
              transferId: transfer.manifest.transferId,
              index,
              data: transfer.chunks[index],
            },
          })
          if (!result || !result.ok) throw new Error('transfer chunk failed')
        }
        result = await this.request({
          method: 'jarvis.audio.commit',
          params: {
            transferId: transfer.manifest.transferId,
            session_id: this.state.session.session_id,
            csrf_token: this.state.session.csrf_token,
            idempotency_key: createTurnId(),
          },
        })
        if (!result || !result.ok || !result.turn) throw new Error('turn failed')
        setText(this.state.response, boundedWatchText(result.turn.response_text, 76))
        setText(this.state.status, 'RESPONSE READY')
      } catch (error) {
        this.fail('REQUEST FAILED')
      } finally {
        this.releaseRecordingTurn(recordingFile)
        setText(this.state.action, 'START VOICE')
      }
    },

    onReceivedFile(fileHandler) {
      fileHandler.on('change', (event) => {
        if (event.data.readyState === 'transferred') {
          this.playResponse(fileHandler.filePath)
        }
      })
    },

    onCall(message) {
      if (message && message.type === 'jarvis.error') this.fail('AUDIO UNAVAILABLE')
    },

    playResponse(filePath) {
      if (!this.ensurePlayer()) return
      try {
        player.stop()
        if (!responseVolume.restore()) {
          this.fail('VOLUME RESTORE FAILED')
          return
        }
        player.setSource(player.source.FILE, { file: filePath })
        this.setPresence('speaking', 'PREPARING VOICE')
        player.prepare()
      } catch (error) {
        if (responseVolume) responseVolume.restore()
        this.fail('PLAYBACK ERROR')
      }
    },

    setPresence(mode, label) {
      this.state.mode = mode
      setText(this.state.status, label)
      if (!this.state.animationEnabled) return
      try {
        this.applyPresenceFrame()
      } catch (error) {
        this.disablePresenceAnimation('SAFE STATIC MODE')
      }
    },

    startPresenceAnimation() {
      this.state.animationEnabled = true
      const step = () => {
        if (!this.state.animationEnabled) return
        try {
          this.applyPresenceFrame()
        } catch (error) {
          this.disablePresenceAnimation('SAFE STATIC MODE')
          return
        }
        const delay = PRESENCE_DELAYS[this.state.mode] || PRESENCE_DELAYS.idle
        this.state.animationTimer = setTimeout(step, delay)
      }
      step()
    },

    applyPresenceFrame() {
      this.state.tick = (this.state.tick + 1) % 120
      const frame = presenceFrame(this.state.mode, this.state.tick)
      const lead = this.state.tick % this.state.ringNodes.length
      for (let index = 0; index < this.state.ringNodes.length; index += 1) {
        const distance = (index - lead + this.state.ringNodes.length) % this.state.ringNodes.length
        const color = distance === 0
          ? frame.coreColor
          : distance === 1 || distance === this.state.ringNodes.length - 1
            ? SIGNAL_GREEN
            : distance === 2 || distance === this.state.ringNodes.length - 2
              ? MID_GREEN
              : TRACK_GREEN
        const geometry = this.state.nodeGeometry[index]
        this.state.ringNodes[index].setProperty(ui.prop.MORE, {
          x: geometry.x, y: geometry.y, w: NODE_SIZE, h: NODE_SIZE,
          color, radius: NODE_SIZE / 2,
        })
      }

      const size = 94 + frame.ring * 4
      this.state.core.setProperty(ui.prop.MORE, {
        x: CENTER_X - size / 2, y: CENTER_Y - size / 2,
        w: size, h: size, color: frame.coreColor, radius: size / 2,
      })
      this.state.outer.setProperty(ui.prop.MORE, {
        x: 116, y: 94, w: 248, h: 248,
        color: this.state.tick % 2 === 0 ? TRACK_GREEN : MID_GREEN,
        radius: 124,
      })
      this.state.middle.setProperty(ui.prop.MORE, {
        x: 148, y: 126, w: 184, h: 184,
        color: frame.ring === 2 ? SIGNAL_GREEN : PLATE_GREEN,
        radius: 92,
      })
      setText(this.state.glyph, frame.glyph)
    },

    disablePresenceAnimation(label = 'SAFE STATIC MODE') {
      this.state.animationEnabled = false
      if (this.state.animationTimer !== null) clearTimeout(this.state.animationTimer)
      this.state.animationTimer = null
      setText(this.state.status, label)
      setText(this.state.glyph, '◇')
    },

    fail(message) {
      this.state.processing = false
      this.state.recording = false
      this.setPresence('error', message)
      setText(this.state.response, 'TRY AGAIN')
      setText(this.state.action, 'START VOICE')
    },

    onDestroy() {
      this.state.animationEnabled = false
      if (this.state.animationTimer !== null) clearTimeout(this.state.animationTimer)
      if (this.state.recordTimer !== null) clearTimeout(this.state.recordTimer)
      if (this.state.stopTimer !== null) clearTimeout(this.state.stopTimer)
      this.state.animationTimer = null
      this.state.recordTimer = null
      this.state.stopTimer = null
      activePage = null
      abandonedRecordingFile = this.state.recordingFile
      this.state.recordingFile = null
      this.state.pendingRecorder = null
      if (this.state.recording && recorder) recorder.stop()
      if (player) {
        player.stop()
        if (responseVolume) responseVolume.restore()
      }
      player = null
      responseVolume = null
    },
  }),
)
