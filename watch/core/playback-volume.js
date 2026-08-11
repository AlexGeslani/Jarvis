const WATCH_RESPONSE_VOLUME_SCALE = 0.85

export function createScopedPlaybackVolume(player) {
  let originalVolume = null

  return {
    apply() {
      if (originalVolume !== null) return true
      const currentVolume = player.getVolume()
      if (!Number.isFinite(currentVolume) || currentVolume < 0 || currentVolume > 100) {
        return false
      }
      const responseVolume = Math.round(currentVolume * WATCH_RESPONSE_VOLUME_SCALE)
      if (responseVolume !== currentVolume && !player.setVolume(responseVolume)) return false
      originalVolume = currentVolume
      return true
    },

    restore() {
      if (originalVolume === null) return true
      if (!player.setVolume(originalVolume)) return false
      originalVolume = null
      return true
    },
  }
}