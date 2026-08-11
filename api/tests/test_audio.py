import ctypes
import ctypes.util
import io
import math
import shutil
import struct
import subprocess
import wave
from pathlib import Path

import pytest
import jarvis_api.audio as audio_module

from jarvis_api.audio import (
    AudioFormatError,
    FFmpegAudioProcessor,
    LibOpusPacketDecoder,
    zepp_opus_to_wav,
)


def tiny_wav(duration_seconds=0.08, sample_rate=16_000):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        frames = int(duration_seconds * sample_rate)
        output.writeframes(b"".join(struct.pack("<h", 0) for _ in range(frames)))
    return stream.getvalue()


def streaming_webm(duration_seconds=0.2):
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration_seconds}",
            "-c:a",
            "libopus",
            "-f",
            "webm",
            "pipe:1",
        ],
        check=True,
        stdout=subprocess.PIPE,
    )
    return result.stdout


def opus_test_library():
    candidates = [
        ctypes.util.find_library("opus"),
        "/opt/homebrew/opt/opus/lib/libopus.0.dylib",
        "/opt/homebrew/opt/opus/lib/libopus.dylib",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return ctypes.CDLL(candidate)
        except OSError:
            continue
    pytest.fail("the production libopus dependency is unavailable")


def encode_opus_packet(frame_samples):
    library = opus_test_library()
    create_encoder = library.opus_encoder_create
    create_encoder.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_int),
    ]
    create_encoder.restype = ctypes.c_void_p
    encode = library.opus_encode
    encode.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_int16),
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_int32,
    ]
    encode.restype = ctypes.c_int
    destroy_encoder = library.opus_encoder_destroy
    destroy_encoder.argtypes = [ctypes.c_void_p]
    destroy_encoder.restype = None

    error = ctypes.c_int()
    handle = create_encoder(16_000, 1, 2049, ctypes.byref(error))
    assert handle and error.value == 0
    try:
        pcm = (ctypes.c_int16 * frame_samples)(
            *(
                int(10_000 * math.sin(2 * math.pi * 440 * index / 16_000))
                for index in range(frame_samples)
            )
        )
        encoded = (ctypes.c_ubyte * 1_275)()
        packet_size = encode(handle, pcm, frame_samples, encoded, len(encoded))
        assert 0 < packet_size <= len(encoded)
        return bytes(encoded[:packet_size])
    finally:
        destroy_encoder(handle)


def real_opus_decoder():
    library = opus_test_library()
    create_decoder = library.opus_decoder_create
    create_decoder.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_int),
    ]
    create_decoder.restype = ctypes.c_void_p
    decode_packet = library.opus_decode
    decode_packet.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_int16),
        ctypes.c_int,
        ctypes.c_int,
    ]
    decode_packet.restype = ctypes.c_int
    destroy_decoder = library.opus_decoder_destroy
    destroy_decoder.argtypes = [ctypes.c_void_p]
    destroy_decoder.restype = None
    return LibOpusPacketDecoder(
        create_decoder=create_decoder,
        decode_packet=decode_packet,
        destroy_decoder=destroy_decoder,
    )


def test_zepp_opus_frames_are_decoded_to_mono_16khz_wav():
    packets = [b"first-packet", b"second-packet"]
    payload = b"".join(struct.pack(">II", len(packet), 0) + packet for packet in packets)
    seen = []

    def decode_packet(packet):
        seen.append(packet)
        return b"\x00\x00" * 320

    result = zepp_opus_to_wav(payload, decode_packet=decode_packet)

    with wave.open(io.BytesIO(result), "rb") as recording:
        assert recording.getnchannels() == 1
        assert recording.getsampwidth() == 2
        assert recording.getframerate() == 16_000
        assert recording.getnframes() == 640
    assert seen == packets


@pytest.mark.parametrize("frame_samples", [40, 80, 160, 320, 640, 960])
def test_real_zepp_opus_frame_durations_decode_completely(frame_samples):
    packet = encode_opus_packet(frame_samples)
    payload = struct.pack(">II", len(packet), 0) + packet
    decoder = real_opus_decoder()
    try:
        result = zepp_opus_to_wav(payload, decode_packet=decoder)
    finally:
        decoder.close()

    with wave.open(io.BytesIO(result), "rb") as recording:
        assert recording.getnchannels() == 1
        assert recording.getsampwidth() == 2
        assert recording.getframerate() == 16_000
        assert recording.getnframes() == frame_samples


def test_real_zepp_multi_frame_stream_preserves_complete_final_frame():
    frame_samples = [40, 320, 960]
    packets = [encode_opus_packet(samples) for samples in frame_samples]
    payload = b"".join(
        struct.pack(">II", len(packet), sequence) + packet
        for sequence, packet in enumerate(packets)
    )
    decoder = real_opus_decoder()
    try:
        result = zepp_opus_to_wav(payload, decode_packet=decoder)
    finally:
        decoder.close()

    with wave.open(io.BytesIO(result), "rb") as recording:
        assert recording.getnframes() == sum(frame_samples)


@pytest.mark.parametrize(
    ("payload", "expected_subtype"),
    [
        (b"", "input_empty_or_unsupported"),
        (b"\x00" * 7, "zepp_frame_truncated"),
        (struct.pack(">II", 0, 0), "zepp_frame_invalid"),
        (struct.pack(">II", 4, 0) + b"xx", "zepp_frame_invalid"),
        (struct.pack(">II", 1, 0) + b"\xff", "opus_packet_decode_failed"),
    ],
)
def test_real_zepp_malformed_streams_fail_with_bounded_enum(payload, expected_subtype):
    decoder = real_opus_decoder()
    try:
        with pytest.raises(AudioFormatError) as caught:
            zepp_opus_to_wav(payload, decode_packet=decoder)
    finally:
        decoder.close()

    assert caught.value.subtype.value == expected_subtype
    assert caught.value.subtype in audio_module.AudioFailureSubtype


def test_valid_zepp_frame_followed_by_partial_header_is_rejected():
    packet = encode_opus_packet(320)
    payload = struct.pack(">II", len(packet), 0) + packet + b"\x00"
    decoder = real_opus_decoder()
    try:
        with pytest.raises(AudioFormatError) as caught:
            zepp_opus_to_wav(payload, decode_packet=decoder)
    finally:
        decoder.close()

    assert caught.value.subtype.value == "zepp_frame_truncated"


def test_libopus_packet_decoder_returns_little_endian_pcm():
    destroyed = []

    def create_decoder(rate, channels, error):
        assert (rate, channels) == (16_000, 1)
        error._obj.value = 0
        return 42

    def decode_packet(handle, packet, packet_size, pcm, frame_size, fec):
        assert handle == 42
        assert bytes(packet[:packet_size]) == b"opus"
        assert (frame_size, fec) == (1_920, 0)
        pcm[0] = 123
        pcm[1] = -123
        return 2

    decoder = LibOpusPacketDecoder(
        create_decoder=create_decoder,
        decode_packet=decode_packet,
        destroy_decoder=destroyed.append,
    )

    result = decoder(b"opus")
    decoder.close()

    assert result == struct.pack("<hh", 123, -123)
    assert destroyed == [42]


def test_zepp_opus_uses_and_closes_default_packet_decoder(monkeypatch):
    packet = b"watch-opus"
    payload = struct.pack(">II", len(packet), 0) + packet
    state = {"closed": False}

    class FakeDecoder:
        def __call__(self, value):
            assert value == packet
            return b"\x00\x00" * 320

        def close(self):
            state["closed"] = True

    monkeypatch.setattr(audio_module, "LibOpusPacketDecoder", FakeDecoder)

    result = zepp_opus_to_wav(payload)

    assert result.startswith(b"RIFF")
    assert state["closed"] is True


@pytest.mark.parametrize(
    ("payload", "decode_packet", "expected_subtype"),
    [
        (b"short", lambda packet: b"\x00\x00", "zepp_frame_truncated"),
        (
            struct.pack(">II", 4, 0) + b"no",
            lambda packet: b"\x00\x00",
            "zepp_frame_invalid",
        ),
        (
            struct.pack(">II", 4, 0) + b"opus",
            lambda packet: b"",
            "opus_packet_decode_failed",
        ),
    ],
)
def test_zepp_normalization_failures_have_bounded_subtypes(
    payload, decode_packet, expected_subtype
):
    with pytest.raises(AudioFormatError) as caught:
        zepp_opus_to_wav(payload, decode_packet=decode_packet)

    assert caught.value.subtype.value == expected_subtype


def test_libopus_failures_have_bounded_packet_decode_subtype():
    def create_decoder(rate, channels, error):
        error._obj.value = 0
        return 42

    decoder = LibOpusPacketDecoder(
        create_decoder=create_decoder,
        decode_packet=lambda *args: -4,
        destroy_decoder=lambda handle: None,
    )

    with pytest.raises(AudioFormatError) as caught:
        decoder(b"opus")

    decoder.close()
    assert caught.value.subtype.value == "opus_packet_decode_failed"


@pytest.mark.asyncio
async def test_ffmpeg_and_duration_failures_have_bounded_subtypes(monkeypatch, tmp_path):
    class FakeProcess:
        def __init__(self, returncode, stdout=b""):
            self.returncode = returncode
            self.stdout = stdout

        async def communicate(self):
            return self.stdout, b""

    processor = FFmpegAudioProcessor(temp_root=tmp_path, max_seconds=1.0)

    async def failed_process(*args, **kwargs):
        return FakeProcess(1)

    monkeypatch.setattr(audio_module.asyncio, "create_subprocess_exec", failed_process)
    with pytest.raises(AudioFormatError) as conversion:
        await processor._ffmpeg("-i", "source", "target")
    assert conversion.value.subtype.value == "ffmpeg_conversion_failed"

    with pytest.raises(AudioFormatError) as duration_probe:
        await processor._duration(tmp_path / "normalized.wav")
    assert duration_probe.value.subtype.value == "duration_validation_failed"

    async def invalid_duration_process(*args, **kwargs):
        return FakeProcess(0, b"{}")

    monkeypatch.setattr(
        audio_module.asyncio, "create_subprocess_exec", invalid_duration_process
    )
    with pytest.raises(AudioFormatError) as duration_metadata:
        await processor._duration(tmp_path / "normalized.wav")
    assert duration_metadata.value.subtype.value == "duration_validation_failed"


@pytest.mark.asyncio
async def test_input_duration_and_output_validation_have_bounded_subtypes(
    monkeypatch, tmp_path
):
    processor = FFmpegAudioProcessor(temp_root=tmp_path, max_seconds=1.0)

    with pytest.raises(AudioFormatError) as empty_input:
        await processor.normalize_input(b"", "wav")
    assert empty_input.value.subtype.value == "input_empty_or_unsupported"

    with pytest.raises(AudioFormatError) as unsupported_input:
        await processor.normalize_input(b"synthetic-audio", "aac")
    assert unsupported_input.value.subtype.value == "input_empty_or_unsupported"

    async def write_invalid_output(*arguments, **kwargs):
        Path(arguments[-1]).write_bytes(b"not-a-wav")

    async def valid_duration(source):
        return 0.1

    monkeypatch.setattr(processor, "_ffmpeg", write_invalid_output)
    monkeypatch.setattr(processor, "_duration", valid_duration)
    with pytest.raises(AudioFormatError) as normalized_output:
        await processor.normalize_input(b"not-a-wav", "wav")
    assert normalized_output.value.subtype.value == "normalized_output_invalid"


@pytest.mark.asyncio
async def test_audio_processor_normalizes_zepp_raw_opus_before_ffmpeg(monkeypatch):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg tools are not installed")

    packet = b"watch-opus-packet"
    payload = struct.pack(">II", len(packet), 0) + packet
    seen = []

    class FakeDecoder:
        def __call__(self, value):
            seen.append(value)
            return b"\x00\x00" * 640

        def close(self):
            pass

    monkeypatch.setattr(audio_module, "LibOpusPacketDecoder", FakeDecoder)

    temp_root = Path("api/.test-tmp")
    temp_root.mkdir(exist_ok=True)
    processor = FFmpegAudioProcessor(
        temp_root=temp_root,
        max_seconds=1.0,
    )

    normalized = await processor.normalize_input(payload, "opus")

    assert normalized.startswith(b"RIFF")
    assert seen == [packet]
    assert list(temp_root.iterdir()) == []
    temp_root.rmdir()


@pytest.mark.asyncio
async def test_ffmpeg_normalizes_input_and_renders_web_and_watch_formats():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg tools are not installed")

    temp_root = Path("api/.test-tmp")
    temp_root.mkdir(exist_ok=True)
    processor = FFmpegAudioProcessor(temp_root=temp_root, max_seconds=1.0)

    normalized = await processor.normalize_input(tiny_wav(), "wav")
    rendered = await processor.render_output(normalized)

    assert normalized.startswith(b"RIFF")
    assert rendered.wav.startswith(b"RIFF")
    assert rendered.mp3[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
    assert list(temp_root.iterdir()) == []
    temp_root.rmdir()


@pytest.mark.asyncio
async def test_audio_longer_than_the_limit_is_rejected_before_stt():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg tools are not installed")

    temp_root = Path("api/.test-tmp")
    temp_root.mkdir(exist_ok=True)
    processor = FFmpegAudioProcessor(temp_root=temp_root, max_seconds=0.05)

    with pytest.raises(AudioFormatError, match="duration") as caught:
        await processor.normalize_input(tiny_wav(duration_seconds=0.12), "wav")

    assert caught.value.subtype.value == "duration_validation_failed"

    assert list(temp_root.iterdir()) == []
    temp_root.rmdir()


@pytest.mark.asyncio
async def test_media_recorder_webm_without_header_duration_is_normalized():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg tools are not installed")

    temp_root = Path("api/.test-tmp")
    temp_root.mkdir(exist_ok=True)
    processor = FFmpegAudioProcessor(temp_root=temp_root, max_seconds=1.0)

    normalized = await processor.normalize_input(streaming_webm(), "webm")

    assert normalized.startswith(b"RIFF")
    assert list(temp_root.iterdir()) == []
    temp_root.rmdir()
