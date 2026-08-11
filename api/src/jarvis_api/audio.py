from __future__ import annotations

import asyncio
import ctypes
import ctypes.util
import io
import json
import math
import struct
import tempfile
import wave
from enum import StrEnum
from pathlib import Path
from typing import Callable

from .models import RenderedAudio


class AudioFailureStage(StrEnum):
    NORMALIZATION = "normalization"
    OUTPUT_RENDER = "output_render"


class AudioFailureSubtype(StrEnum):
    INPUT_EMPTY_OR_UNSUPPORTED = "input_empty_or_unsupported"
    ZEPP_FRAME_TRUNCATED = "zepp_frame_truncated"
    ZEPP_FRAME_INVALID = "zepp_frame_invalid"
    OPUS_PACKET_DECODE_FAILED = "opus_packet_decode_failed"
    FFMPEG_CONVERSION_FAILED = "ffmpeg_conversion_failed"
    DURATION_VALIDATION_FAILED = "duration_validation_failed"
    NORMALIZED_OUTPUT_INVALID = "normalized_output_invalid"
    SYNTHESIZED_INPUT_EMPTY = "synthesized_input_empty"
    SYNTHESIZED_OUTPUT_INVALID = "synthesized_output_invalid"


class AudioFormatError(ValueError):
    """Raised with a bounded diagnostic when audio processing fails."""

    def __init__(
        self,
        message: str,
        *,
        stage: AudioFailureStage,
        subtype: AudioFailureSubtype,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.subtype = subtype


class LibOpusPacketDecoder:
    """Decode individual 16 kHz mono Opus packets through upstream libopus."""

    def __init__(
        self,
        *,
        create_decoder: Callable[..., object] | None = None,
        decode_packet: Callable[..., int] | None = None,
        destroy_decoder: Callable[[object], object] | None = None,
    ) -> None:
        if create_decoder is None or decode_packet is None or destroy_decoder is None:
            create_decoder, decode_packet, destroy_decoder = self._load_libopus()
        self._decode_packet = decode_packet
        self._destroy_decoder = destroy_decoder
        error = ctypes.c_int()
        self._handle = create_decoder(16_000, 1, ctypes.byref(error))
        if not self._handle or error.value != 0:
            raise AudioFormatError(
                "libopus decoder initialization failed",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.OPUS_PACKET_DECODE_FAILED,
            )

    @staticmethod
    def _load_libopus():
        library_name = ctypes.util.find_library("opus")
        if not library_name:
            raise AudioFormatError(
                "libopus is unavailable",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.OPUS_PACKET_DECODE_FAILED,
            )
        library = ctypes.CDLL(library_name)
        create_decoder = library.opus_decoder_create
        create_decoder.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
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
        return create_decoder, decode_packet, destroy_decoder

    def __call__(self, packet: bytes) -> bytes:
        if self._handle is None or not packet:
            raise AudioFormatError(
                "Zepp Opus packet is invalid",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.OPUS_PACKET_DECODE_FAILED,
            )
        encoded = (ctypes.c_ubyte * len(packet)).from_buffer_copy(packet)
        pcm = (ctypes.c_int16 * 1_920)()
        samples = self._decode_packet(self._handle, encoded, len(packet), pcm, 1_920, 0)
        if samples <= 0:
            raise AudioFormatError(
                "Zepp Opus packet could not be decoded",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.OPUS_PACKET_DECODE_FAILED,
            )
        return ctypes.string_at(pcm, samples * 2)

    def close(self) -> None:
        if self._handle is not None:
            self._destroy_decoder(self._handle)
            self._handle = None


def zepp_opus_to_wav(
    payload: bytes,
    *,
    decode_packet: Callable[[bytes], bytes] | None = None,
) -> bytes:
    """Decode Zepp's 8-byte-framed raw Opus stream to mono 16 kHz WAV."""
    owned_decoder = None
    if decode_packet is None:
        owned_decoder = LibOpusPacketDecoder()
        decode_packet = owned_decoder
    try:
        position = 0
        pcm_frames: list[bytes] = []
        while position < len(payload):
            if len(payload) - position < 8:
                raise AudioFormatError(
                    "Zepp Opus frame header is truncated",
                    stage=AudioFailureStage.NORMALIZATION,
                    subtype=AudioFailureSubtype.ZEPP_FRAME_TRUNCATED,
                )
            packet_size = struct.unpack_from(">I", payload, position)[0]
            packet_start = position + 8
            packet_end = packet_start + packet_size
            if packet_size <= 0 or packet_end > len(payload):
                raise AudioFormatError(
                    "Zepp Opus frame is invalid",
                    stage=AudioFailureStage.NORMALIZATION,
                    subtype=AudioFailureSubtype.ZEPP_FRAME_INVALID,
                )
            decoded = decode_packet(payload[packet_start:packet_end])
            if not decoded or len(decoded) % 2:
                raise AudioFormatError(
                    "Zepp Opus frame could not be decoded",
                    stage=AudioFailureStage.NORMALIZATION,
                    subtype=AudioFailureSubtype.OPUS_PACKET_DECODE_FAILED,
                )
            pcm_frames.append(decoded)
            position = packet_end
        if not pcm_frames:
            raise AudioFormatError(
                "Zepp Opus stream is empty",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.INPUT_EMPTY_OR_UNSUPPORTED,
            )

        output = io.BytesIO()
        with wave.open(output, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(16_000)
            writer.writeframes(b"".join(pcm_frames))
        return output.getvalue()
    finally:
        if owned_decoder is not None:
            owned_decoder.close()


class FFmpegAudioProcessor:
    def __init__(
        self,
        *,
        temp_root: Path,
        max_seconds: float,
        opus_packet_decoder: Callable[[bytes], bytes] | None = None,
    ) -> None:
        self.temp_root = Path(temp_root)
        self.max_seconds = max_seconds
        self.opus_packet_decoder = opus_packet_decoder
        self.temp_root.mkdir(parents=True, exist_ok=True)

    async def normalize_input(self, payload: bytes, input_format: str) -> bytes:
        suffixes = {"webm": ".webm", "opus": ".opus", "wav": ".wav"}
        suffix = suffixes.get(input_format)
        if suffix is None or not payload:
            raise AudioFormatError(
                "unsupported or empty audio",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.INPUT_EMPTY_OR_UNSUPPORTED,
            )

        if input_format == "opus" and not payload.startswith(b"OggS"):
            payload = zepp_opus_to_wav(payload, decode_packet=self.opus_packet_decoder)
            suffix = ".wav"

        with tempfile.TemporaryDirectory(prefix="input-", dir=self.temp_root) as directory:
            root = Path(directory)
            source = root / f"source{suffix}"
            target = root / "normalized.wav"
            source.write_bytes(payload)
            await self._ffmpeg(
                "-i",
                str(source),
                "-t",
                f"{self.max_seconds + 0.25:.3f}",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(target),
                stage=AudioFailureStage.NORMALIZATION,
            )
            duration = await self._duration(target)
            if duration <= 0 or duration > self.max_seconds:
                raise AudioFormatError(
                    "audio duration exceeds the configured limit",
                    stage=AudioFailureStage.NORMALIZATION,
                    subtype=AudioFailureSubtype.DURATION_VALIDATION_FAILED,
                )
            result = target.read_bytes()
            if not result.startswith(b"RIFF"):
                raise AudioFormatError(
                    "audio normalization failed",
                    stage=AudioFailureStage.NORMALIZATION,
                    subtype=AudioFailureSubtype.NORMALIZED_OUTPUT_INVALID,
                )
            return result

    async def render_output(self, payload: bytes) -> RenderedAudio:
        if not payload:
            raise AudioFormatError(
                "empty synthesized audio",
                stage=AudioFailureStage.OUTPUT_RENDER,
                subtype=AudioFailureSubtype.SYNTHESIZED_INPUT_EMPTY,
            )
        with tempfile.TemporaryDirectory(prefix="output-", dir=self.temp_root) as directory:
            root = Path(directory)
            source = root / "source.audio"
            wav = root / "response.wav"
            mp3 = root / "response.mp3"
            source.write_bytes(payload)
            await self._ffmpeg(
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "22050",
                "-c:a",
                "pcm_s16le",
                str(wav),
                stage=AudioFailureStage.OUTPUT_RENDER,
            )
            await self._ffmpeg(
                "-i",
                str(wav),
                "-vn",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
                str(mp3),
                stage=AudioFailureStage.OUTPUT_RENDER,
            )
            wav_bytes = wav.read_bytes()
            mp3_bytes = mp3.read_bytes()
            if not wav_bytes.startswith(b"RIFF") or not mp3_bytes:
                raise AudioFormatError(
                    "synthesized audio conversion failed",
                    stage=AudioFailureStage.OUTPUT_RENDER,
                    subtype=AudioFailureSubtype.SYNTHESIZED_OUTPUT_INVALID,
                )
            return RenderedAudio(wav=wav_bytes, mp3=mp3_bytes)

    async def _duration(self, source: Path) -> float:
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(source),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await process.communicate()
        if process.returncode != 0:
            raise AudioFormatError(
                "audio could not be decoded",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.DURATION_VALIDATION_FAILED,
            )
        try:
            duration = float(json.loads(stdout)["format"]["duration"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise AudioFormatError(
                "audio duration is unavailable",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.DURATION_VALIDATION_FAILED,
            ) from error
        if not math.isfinite(duration):
            raise AudioFormatError(
                "audio duration is invalid",
                stage=AudioFailureStage.NORMALIZATION,
                subtype=AudioFailureSubtype.DURATION_VALIDATION_FAILED,
            )
        return duration

    async def _ffmpeg(
        self,
        *arguments: str,
        stage: AudioFailureStage = AudioFailureStage.NORMALIZATION,
    ) -> None:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *arguments,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await process.communicate()
        if process.returncode != 0:
            raise AudioFormatError(
                "audio conversion failed",
                stage=stage,
                subtype=AudioFailureSubtype.FFMPEG_CONVERSION_FAILED,
            )
