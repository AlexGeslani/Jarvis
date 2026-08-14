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


def test_n8n_backend_requires_webhook_and_credential_file(monkeypatch, tmp_path):
    _set_common(monkeypatch)
    monkeypatch.setenv("JARVIS_REASONING_BACKEND", "n8n")
    monkeypatch.delenv("JARVIS_REASONING_URL", raising=False)
    monkeypatch.delenv("JARVIS_REASONING_MODEL", raising=False)
    monkeypatch.setenv("JARVIS_N8N_WEBHOOK_URL", "http://host.docker.internal:5678/webhook/jarvis")
    credential = tmp_path / "n8n-token"
    credential.write_text("opaque-test-token")
    monkeypatch.setenv("JARVIS_N8N_API_KEY_FILE", str(credential))

    config = Config.from_env()

    assert config.reasoning_backend == "n8n"
    assert config.n8n_webhook_url.endswith("/webhook/jarvis")
    assert config.n8n_api_key_file == credential


@pytest.mark.parametrize("backend", ["", "agent", "cloud"])
def test_reasoning_backend_is_closed(monkeypatch, backend):
    _set_common(monkeypatch)
    monkeypatch.setenv("JARVIS_REASONING_BACKEND", backend)
    monkeypatch.setenv("JARVIS_REASONING_URL", "http://host.docker.internal:8082/v1")
    monkeypatch.setenv("JARVIS_REASONING_MODEL", "example-model")

    with pytest.raises(ValueError, match="must be direct or n8n"):
        Config.from_env()


def test_n8n_backend_rejects_missing_credential_file(monkeypatch, tmp_path):
    _set_common(monkeypatch)
    monkeypatch.setenv("JARVIS_REASONING_BACKEND", "n8n")
    monkeypatch.delenv("JARVIS_REASONING_URL", raising=False)
    monkeypatch.delenv("JARVIS_REASONING_MODEL", raising=False)
    monkeypatch.setenv("JARVIS_N8N_WEBHOOK_URL", "http://host.docker.internal:5678/webhook/jarvis")
    monkeypatch.setenv("JARVIS_N8N_API_KEY_FILE", str(tmp_path / "missing"))

    with pytest.raises(ValueError, match="credential is unavailable"):
        Config.from_env()


def test_n8n_backend_rejects_a_simultaneously_configured_direct_fallback(monkeypatch, tmp_path):
    _set_common(monkeypatch)
    monkeypatch.setenv("JARVIS_REASONING_BACKEND", "n8n")
    monkeypatch.setenv("JARVIS_REASONING_URL", "http://host.docker.internal:8082/v1")
    monkeypatch.setenv("JARVIS_REASONING_MODEL", "example-model")
    monkeypatch.setenv("JARVIS_N8N_WEBHOOK_URL", "http://host.docker.internal:5678/webhook/jarvis")
    credential = tmp_path / "n8n-token"
    credential.write_text("opaque-test-token")
    monkeypatch.setenv("JARVIS_N8N_API_KEY_FILE", str(credential))

    with pytest.raises(ValueError, match="direct fallback must be unset"):
        Config.from_env()
