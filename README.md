# Jarvis

**A local-first voice assistant for the browser and Amazfit Active Max.** Jarvis turns an explicit microphone interaction into speech recognition, bounded local reasoning, and a spoken response without sending the interaction through a public web application.

**Current watch version:** `0.1.8` · **API contract:** `v1` · **Deployment:** private LAN only

> [!IMPORTANT]
> This repository is not a self-contained cloud service or public demo. A clone requires user-supplied private-LAN speech-to-text, reasoning, and text-to-speech services, a trusted same-origin web/API deployment, and—when using the watch—a paired phone and Amazfit Active Max. No GitHub Pages site or public endpoint is provided.

## Current status

| Surface | Verified state |
|---|---|
| Browser | The responsive interface and its voice-turn flow have been verified. It provides Hold-to-Talk, explicit half-duplex Open Dialogue, typed requests, turn cancellation, ephemeral transcript display, and response-reactive animation. |
| Shared API | The `v1` server gate passes for sessions, text and audio turns, audio normalization, cancellation, policy rejection, bounded storage, local reasoning authentication, and WAV/MP3 response delivery. |
| Active Max | `0.1.8` builds for the 480 × 480 `genevaw` target on Zepp OS API 4.2. An earlier candidate completed the physical watch end-to-end voice path; final physical-device acceptance of `0.1.8` is still pending. |
| Public availability | None. Jarvis has no live web demo, public API, Pages deployment, or marketplace release. The screenshots below are the public preview. |

See the [roadmap](ROADMAP.md) for the distinction between the current baseline and planned work.

## Interface

| Ready for an explicit voice turn | Completed response with transcript and playback state |
|---|---|
| ![Jarvis browser interface ready for Hold-to-Talk or Open Dialogue on the private local link](docs/screenshots/jarvis-browser-ready.png) | ![Jarvis browser interface showing a completed local conversation and spoken response state](docs/screenshots/jarvis-browser-response.png) |

## What works today

### Browser

- **Hold-to-Talk** with pointer, <kbd>Space</kbd>, or <kbd>Enter</kbd>; release sends the recording.
- **Open Dialogue**, explicitly enabled by the user, with local voice-activity detection.
- **Half-duplex conversation:** microphone capture pauses while a request is processed or Jarvis is speaking, preventing the assistant from listening to its own response.
- Text input, bounded on-screen conversation history, and cancellation of the current turn.
- A canvas-based presence visualization with idle, listening, processing, speaking, and error states.
- Audio-reactive response animation and a reduced-motion mode.
- A three-minute silence timeout for Open Dialogue and a 12-second maximum browser utterance.

### Amazfit Active Max

- Zepp OS Device App plus phone Side Service, targeting the round 480 × 480 Active Max profile.
- Tap-to-start/tap-to-stop OPUS recording with an eight-second maximum.
- Bounded, chunked transfer from watch to phone, then relay to the same private `v1` API used by the browser.
- MP3 response transfer back to the watch, on-watch playback, response text, and low-power state animation.
- Response-only volume attenuation to 85% of the current watch volume, followed by restoration on completion or teardown.
- Microphone-only app permission in the current manifest.

### Voice pipeline and API

- Browser WebM/Opus, watch OPUS, and WAV inputs normalized to mono 16 kHz WAV before transcription.
- Whisper-compatible private-LAN speech recognition.
- Bounded, non-tool local reasoning through an OpenAI-compatible endpoint; optional Bearer authentication is loaded server-side from a file rather than embedded in either client.
- Piper speech synthesis with the pinned `en_US-danny-low` voice selector.
- WAV output for the browser and MP3 output for the watch.
- A versioned session/turn API with idempotency, cancellation, ownership checks, concurrency and rate limits, and bounded ephemeral audio storage.

## Architecture

![Architecture diagram showing browser and Active Max clients using a shared private-LAN API for speech recognition, local reasoning, and speech synthesis](docs/architecture/jarvis-architecture.svg)

A voice turn follows one controlled path:

1. The browser records directly, or the watch records OPUS and transfers it through its paired phone.
2. The client creates a short-lived session and submits the turn to the private `v1` API.
3. The API validates origin, session ownership, request schema, replay key, payload size, duration, and policy.
4. Audio is normalized and sent to the user-operated speech-recognition service.
5. The transcript is sent to the authenticated local reasoning service with bounded in-memory conversation context and no tool access.
6. The answer is synthesized with Piper, converted to the requested format, and made available only to the owning session.
7. The browser or watch plays the response and returns to an idle state.

Both clients share the same server-side policy and media path; the watch is not given a privileged device API.

## Privacy and security model

Jarvis is designed for a trusted private network, not anonymous Internet exposure.

- **Local reachability:** there is no public route, hosted demo, external analytics integration, or public credential flow.
- **Explicit listening:** browser voice capture starts only while Hold-to-Talk is pressed or after Open Dialogue is deliberately enabled; the watch starts recording only from its on-screen control.
- **Ephemeral server state:** sessions, bounded conversation context, transcripts, and response audio live in memory and expire. API audio normalization uses temporary directories that are removed after processing. The watch currently reuses one device-local recording file; explicit cleanup verification is tracked in the roadmap.
- **Client isolation:** the browser uses a restrictive Content Security Policy, same-origin API calls, no-referrer behavior, and no third-party script or asset origins.
- **Request authorization:** short-lived session IDs and session-bound CSRF tokens protect turns and audio retrieval. Mutations require idempotency keys, and stale or cross-session results are rejected.
- **Fail-closed limits:** payload, audio duration, text length, response length, active-turn count, concurrency, rate, session count, and ephemeral audio storage are bounded.
- **Policy before reasoning:** high-risk physical, security, purchase, and irreversible intents are rejected before the conversation backend or speech synthesizer is called.
- **Credential boundary:** reasoning credentials stay on the API host and can be read from a local file. They are not shipped in browser or watch bundles.
- **Hardened containers:** the included services run as non-root users with read-only filesystems, dropped capabilities, no new privileges, bounded temporary storage, and no published host ports.
- **Safe errors:** client responses and routine failure logs avoid upstream response bodies, credentials, transcripts, audio, stack traces, and local filesystem details.

These controls do **not** make the current build suitable for public exposure. Account authentication, device credential issuance/revocation, and a public-ingress security review remain future gates.

## Prerequisites

A working installation needs more than this source tree:

- Node.js and npm.
- Python `3.11.x` (the supported range is `>=3.11,<3.12`).
- `ffmpeg`, `ffprobe`, and `libopus` available to the API runtime.
- Private speech-to-text and text-to-speech HTTP endpoints compatible with the request/response shapes in the source.
- A private OpenAI-compatible reasoning endpoint, model identifier, and optional server-side API-key file.
- A trusted HTTPS origin that serves the web client and routes `/api/v1` to the API on the same origin. Browser microphone access requires a secure context.
- For watch use: the official Zepp OS Zeus CLI, the Zepp mobile app in Developer Mode, a paired Amazfit Active Max, and phone-to-API reachability over the same private network.

The checked-in Compose file is deployment-specific: it expects an existing external container network and intentionally publishes no host ports. Review and adapt its network and reverse-proxy wiring for your environment instead of treating `docker compose up` as a portable one-command install.

## Local setup

### 1. Install JavaScript dependencies

```bash
npm ci
```

The root package provides the Node test commands and the watch workspace. The Zeus CLI is an external prerequisite and is not installed by `npm ci`.

### 2. Create the API environment

```bash
cd api
python3.11 --version
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
cd ..
```

Install `ffmpeg`/`ffprobe` and `libopus` through your operating system's package manager if they are not already available.

### 3. Configure private upstreams

Copy [`.env.example`](.env.example) to a local, untracked environment file and fill in:

- private STT and TTS endpoint URLs;
- the reasoning base URL and model identifier;
- `JARVIS_REASONING_API_KEY_FILE` when the reasoning endpoint requires Bearer authentication;
- the exact HTTPS browser origin;
- the pinned Piper selector `piper:en_US-danny-low`;
- any limits you intentionally want to override.

Do not commit credentials, private hostnames, device preview URLs, or watch pairing material. The configuration validator rejects incomplete reasoning configuration, non-HTTPS non-loopback upstreams, relative credential-file paths, invalid limits, and a different Piper voice selector.

### 4. Run the API and web client

With the environment loaded:

```bash
cd api
source .venv/bin/activate
jarvis-api
```

Serve `web/` from your trusted HTTPS origin and reverse-proxy same-origin `/api/` requests to the API. The production-style web container already contains this static-serving and API-proxy behavior, but the repository intentionally leaves private ingress and external network setup to the operator.

The browser creates its session automatically. A healthy API returns:

```json
{"status":"ready","api_version":"v1"}
```

from `GET /api/v1/health`.

## Build and test

Run the repository's JavaScript contract and unit tests:

```bash
npm test
```

Run the API suite from the repository root (several media tests use root-relative fixtures):

```bash
api/.venv/bin/pytest -c api/pyproject.toml api/tests
```

Validate the container definition without starting services:

```bash
docker compose config
```

Build the Active Max package after installing and authenticating the official Zeus CLI:

```bash
npm run build:watch
```

The API tests exercise real `ffmpeg`/`ffprobe` conversions and real `libopus` packet decoding when those system dependencies are present. The Node tests verify browser security/accessibility contracts, half-duplex voice-state logic, watch transfer bounds, Active Max metadata, response-volume restoration, and private container configuration.

## Install on Amazfit Active Max

The supported development path is source → Zeus preview → QR code → Zepp mobile app → paired watch.

1. Copy `watch/.env.local.example` to `watch/.env.local`, set `JARVIS_WATCH_API_ORIGIN` to an HTTP(S) origin that **your phone** can reach, and keep the local file mode `0600`. The origin must not contain credentials, a path, query, or fragment.
2. Do not commit the private origin. The local override and generated `watch/app-side/api-config.js` are ignored; the build generator writes the endpoint without printing it. Without an override, clean-clone generation deterministically uses the loopback-only safe example, which is not phone-reachable.
3. Confirm [`watch/app.json`](watch/app.json) still targets `genevaw`, design width `480`, and Zepp OS API `4.2`.
4. Build from the repository root with `npm run build:watch`.
5. From `watch/`, run:

   ```bash
   zeus preview --target "Amazfit Active Max"
   ```

6. In the Zepp mobile app, enable Developer Mode through **Profile → Settings → About → tap the Zepp icon seven times**. Then use **Profile → Settings → Developer Mode → Scan**.
7. Display the preview QR code on a second screen and scan it from the phone. Preview QR codes are temporary credentials; do not publish or share them.
8. Complete the physical acceptance path: launch, grant microphone access, record, transfer, receive and hear the response, verify volume restoration, interrupt/back out, relaunch, and test a network failure.

A successful build or QR install is not physical-device acceptance. The checked-in `0.1.8` artifact has passed the server gate, but its final Active Max acceptance sequence remains open.

## Current limitations

- No public web demo, public API, GitHub Pages deployment, or marketplace package.
- A clone cannot answer requests until the operator supplies and secures the STT, reasoning, and TTS services.
- The current watch Side Service needs an operator-specific private API origin at build time.
- Open Dialogue is explicit, browser-only, half-duplex, and energy-threshold based; it is not wake-word listening or full-duplex streaming.
- The watch starts recording from the on-screen button; physical-button activation is planned, not implemented.
- Current reasoning is deliberately non-tool. Home Assistant is not integrated; it remains explicitly future roadmap work.
- Sessions and conversation context are process-local and ephemeral; restarting the API clears them.
- The present local build does not issue or revoke per-device credentials and must not be exposed directly to the Internet.
- Final physical-watch acceptance for `0.1.8`, including failure and lifecycle cases, is pending.

## Project structure

```text
.
├── api/                 aiohttp API, media pipeline, policy, storage, and Python tests
├── docs/
│   ├── architecture/    product architecture diagram
│   ├── screenshots/     browser review states
│   └── openapi.yaml     shared v1 client contract
├── tests/js/            browser, watch, protocol, and container contract tests
├── watch/               Zepp OS Device App, phone Side Service, manifest, and build output
├── web/                 static browser client and hardened web-server configuration
├── compose.yaml         private, non-published container deployment definition
└── ROADMAP.md           current baseline and planned milestones
```

## Contributing

Changes should preserve the shared API boundary and keep product claims tied to executable or physical-device evidence.

- Add or update tests with behavior changes; run both the Node and Python suites.
- Keep watch target, version label, package artifact, and version assertions synchronized.
- Never commit credentials, private network coordinates, QR/session URLs, audio, or transcripts.
- Treat browser verification, simulator verification, package build, and physical-watch acceptance as different evidence levels.
- Keep new integrations typed, allowlisted, bounded, and server-authorized; clients and transcripts must not choose arbitrary tools or URLs.
- Update [ROADMAP.md](ROADMAP.md) when work moves between planned, in progress, and verified.

<!-- Maintainers: when behavior or release metadata changes, update the manifest/version assertions, README status and limitations, architecture/docs, and screenshots together. -->
