import pytest

from jarvis_api.config import Config


def _set_common(monkeypatch):
    values = {
        "JARVIS_ALLOWED_ORIGIN": "https://jarvis.example",
        "JARVIS_STT_URL": "http://host.docker.internal:8081/v1/audio/transcriptions",
        "JARVIS_TTS_URL": "http://host.docker.internal:8081/v1/audio/speech",
        "JARVIS_PIPER_VOICE": "piper:en_US-danny-low",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def test_local_reasoning_backend_uses_portable_configuration(monkeypatch):
    _set_common(monkeypatch)
    monkeypatch.setenv("JARVIS_REASONING_URL", "http://host.docker.internal:8082/v1")
    monkeypatch.setenv("JARVIS_REASONING_MODEL", "example-model")

    config = Config.from_env()

    assert config.reasoning_url.endswith("/v1")
    assert config.stt_url.endswith("/v1/audio/transcriptions")
    assert config.tts_url.endswith("/v1/audio/speech")
    assert config.piper_voice == "piper:en_US-danny-low"


def test_reasoning_url_and_model_are_both_required(monkeypatch):
    _set_common(monkeypatch)
    monkeypatch.setenv("JARVIS_REASONING_URL", "https://reasoning.example/v1")
    monkeypatch.delenv("JARVIS_REASONING_MODEL", raising=False)

    with pytest.raises(ValueError, match="both required"):
        Config.from_env()
