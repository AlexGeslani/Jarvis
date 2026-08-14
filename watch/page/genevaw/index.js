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
const BACKGROUND = 0x020712
const CYAN = 0x00e5ff
const INDIGO = 0x675cff
const PALE = 0xeafcff
const MUTED = 0x6f98a6

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
      outer: null,
      middle: null,
      core: null,
      glyph: null,
      status: null,
      response: null,
      action: null,
    },

    build() {
      activePage = this
      ui.createWidget(ui.widget.FILL_RECT, {
        x: 0, y: 0, w: 480, h: 480, color: BACKGROUND,
      })
      ui.createWidget(ui.widget.TEXT, {
        x: 86, y: 30, w: 308, h: 44,
        text: 'J A R V I S', text_size: 27, color: PALE,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      ui.createWidget(ui.widget.TEXT, {
        x: 120, y: 66, w: 240, h: 28,
        text: 'PRIVATE LOCAL VOICE', text_size: 13, color: MUTED,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })

      this.state.outer = ui.createWidget(ui.widget.FILL_RECT, {
        x: 116, y: 94, w: 248, h: 248, color: 0x07374b, radius: 124,
      })
      ui.createWidget(ui.widget.FILL_RECT, {
        x: 124, y: 102, w: 232, h: 232, color: BACKGROUND, radius: 116,
      })
      this.state.middle = ui.createWidget(ui.widget.FILL_RECT, {
        x: 148, y: 126, w: 184, h: 184, color: INDIGO, radius: 92,
      })
      ui.createWidget(ui.widget.FILL_RECT, {
        x: 156, y: 134, w: 168, h: 168, color: 0x061527, radius: 84,
      })
      this.state.core = ui.createWidget(ui.widget.FILL_RECT, {
        x: 191, y: 169, w: 98, h: 98, color: 0x126276, radius: 49,
      })
      this.state.glyph = ui.createWidget(ui.widget.TEXT, {
        x: 185, y: 161, w: 110, h: 114,
        text: '◇', text_size: 55, color: PALE,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })
      this.state.status = ui.createWidget(ui.widget.TEXT, {
        x: 104, y: 282, w: 272, h: 34,
        text: 'CONNECTING', text_size: 17, color: CYAN,
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
        normal_color: 0x063d52, press_color: 0x08677e,
        color: PALE, radius: 35,
      })
      this.state.action.addEventListener(ui.event.CLICK_UP, () => this.toggleRecording())
      ui.createWidget(ui.widget.TEXT, {
        x: 96, y: 440, w: 288, h: 22,
        text: 'V0.1.11  •  8 SEC  •  LAN', text_size: 12, color: MUTED,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V,
      })

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
      this.animatePresence()
    },

    animatePresence() {
      try {
        this.state.tick += 1
        const frame = presenceFrame(this.state.mode, this.state.tick)
        const size = 94 + frame.ring * 6
        const offset = (480 - size) / 2
        this.state.core.setProperty(ui.prop.MORE, {
          x: offset, y: 218 - size / 2, w: size, h: size,
          color: frame.coreColor, radius: size / 2,
        })
        this.state.outer.setProperty(ui.prop.MORE, {
          x: 116, y: 94, w: 248, h: 248,
          color: frame.ring === 1 ? 0x075d73 : 0x07374b, radius: 124,
        })
        this.state.middle.setProperty(ui.prop.MORE, {
          x: 148, y: 126, w: 184, h: 184,
          color: frame.ring === 2 ? CYAN : INDIGO, radius: 92,
        })
        setText(this.state.glyph, frame.glyph)
      } catch (error) {
        setText(this.state.glyph, '◇')
      }
    },

    fail(message) {
      this.state.processing = false
      this.state.recording = false
      this.setPresence('error', message)
      setText(this.state.response, 'TRY AGAIN')
      setText(this.state.action, 'START VOICE')
    },

    onDestroy() {
      if (this.state.recordTimer !== null) clearTimeout(this.state.recordTimer)
      if (this.state.stopTimer !== null) clearTimeout(this.state.stopTimer)
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
