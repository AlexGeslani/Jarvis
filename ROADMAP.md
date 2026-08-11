# Jarvis roadmap

This roadmap separates **verified current behavior** from **planned work**. It is a direction of travel, not a release-date promise. Hardware-dependent items are complete only after they pass on a physical Amazfit Active Max; a browser check, unit test, simulator run, or successful `.zab` build is not a substitute.

## Status legend

- ✅ **Verified** — exercised at the evidence level stated.
- 🟡 **In progress / acceptance pending** — implemented or packaged, but the final gate remains open.
- ⬜ **Planned** — not part of the current product baseline.
- 🔒 **Security-gated** — requires a separate threat review and explicit release decision.

## Current baseline — `0.1.8`

### Browser and shared API

- ✅ Responsive browser interface with Hold-to-Talk, typed requests, cancellation, transcript display, and response-reactive presence animation.
- ✅ Explicit Open Dialogue mode with local voice-activity detection, a silence timeout, and half-duplex capture/playback ownership.
- ✅ Shared `v1` session/turn API for text, browser audio, and watch audio.
- ✅ WebM/Opus, watch OPUS, and WAV normalization through `ffmpeg`/`ffprobe` and `libopus`.
- ✅ Private Whisper-compatible STT, authenticated local reasoning, pinned Piper TTS, and session-owned WAV/MP3 delivery.
- ✅ Origin/session/CSRF checks, idempotency, active-turn ownership, cancellation, rate and concurrency limits, bounded ephemeral storage, safe errors, and pre-backend rejection of prohibited high-risk intents.
- ✅ Non-root, read-only, no-published-port container baseline.
- ✅ Browser interface acceptance and `0.1.8` server gate.

### Amazfit Active Max

- ✅ Zepp OS Device App and phone Side Service targeting the 480 × 480 Active Max profile and API level 4.2.
- ✅ Eight-second explicit recording, bounded chunk transfer, API relay, response text, MP3 return transfer, playback-state animation, and scoped volume restoration implemented and covered by contracts/unit tests.
- ✅ A prior candidate completed the physical record → phone relay → private API → response playback path.
- 🟡 Final `0.1.8` physical acceptance is pending. The open gate includes microphone permission, full voice turn, audible playback, volume restoration, interruption, back-navigation, relaunch, and network-failure behavior.

### Distribution

- ✅ Local screenshots and architecture documentation are the public review surface.
- ✅ A development `.zab` can be built and a temporary QR preview can install through Zepp Developer Mode.
- ⬜ There is no public web demo, GitHub Pages deployment, public API, or marketplace release.

---

## Milestone 1 — Close the `0.1.8` physical gate

**Outcome:** the current watch build has repeatable, evidence-backed acceptance rather than package-only confidence.

- [ ] Run the complete acceptance matrix on a physical Active Max using the exact `0.1.8` artifact.
- [ ] Confirm first-run microphone permission and a nonempty eight-second-or-shorter recording.
- [ ] Verify phone relay, transcript response, audio transfer, audible playback, and presence-state transitions in one run.
- [ ] Prove response volume is restored after normal completion, cancellation/error, back-navigation, and teardown.
- [ ] Exercise Wi-Fi loss, unreachable API, malformed/partial transfer, expired session, and retry behavior.
- [ ] Verify relaunch after failure does not leave recorder, player, transfer, or UI state stuck.
- [ ] Record the accepted artifact identity and checksum alongside concise release evidence.
- [ ] Synchronize the watch manifest, on-screen version, version tests, README status, screenshots, and release notes.

## Milestone 2 — Latency, speed, and reliability

**Outcome:** faster turns with measurable budgets and predictable recovery, without weakening the private boundary.

- [ ] Add privacy-safe stage timing for capture finalization, phone transfer, normalization, STT, reasoning, TTS, response encoding, return transfer, and playback start.
- [ ] Establish browser and watch latency baselines across short and maximum-length utterances.
- [ ] Reduce avoidable format conversions and transfer overhead while preserving bounded input validation.
- [ ] Investigate progressive response delivery where it is compatible with explicit half-duplex operation; do not claim streaming until cancellation and stale-turn fencing are proven.
- [ ] Add bounded retry/backoff for transient phone/API transfer failures without replaying a completed mutation.
- [ ] Improve session renewal and reconnect behavior after expiry or API restart.
- [ ] Add health/readiness checks that distinguish API availability from STT, reasoning, and TTS dependency readiness without exposing private topology.
- [ ] Define latency and error-rate release budgets and fail the acceptance gate on regressions.

## Milestone 3 — Watch interaction and visual polish

**Outcome:** quicker access and clearer state on the watch while retaining explicit user control.

- [ ] **Hold the bottom watch button to trigger voice capture**, subject to Zepp OS key-event support and physical verification on Active Max.
- [ ] Preserve the on-screen start/stop control as an accessible fallback.
- [ ] Add richer listening, processing, speaking, success, and error animations designed for the round display and low-power constraints.
- [ ] Make progress and retry states clearer during phone transfer and response download.
- [ ] Add conservative haptic cues for recording start/stop and failure, with user control and no implication that an action was authorized.
- [ ] Validate long-press conflicts, accidental activation, app lifecycle, battery impact, and behavior while the display changes state.
- [ ] Add simulator screenshots only as UI evidence; keep microphone, speaker, key, lifecycle, and battery claims tied to physical-device runs.

## Milestone 4 — FUTURE: Home Assistant integration

**Outcome:** introduce a narrow, documented, accepted smart-home integration. There is no current Home Assistant adapter or product acceptance.

- [ ] Start with read-only queries and low-impact reversible actions.
- [ ] Introduce a typed server-side capability broker with explicit verbs and validated argument schemas.
- [ ] Maintain allowlists for domains, entities, and permitted state transitions; clients and transcripts must never select arbitrary tools, entity IDs, services, or URLs.
- [ ] Keep high-risk entry, alarm, camera, purchase, and irreversible actions unavailable until a stronger authentication and confirmation design is approved.
- [ ] Add exact-action visual confirmation for material mutations; a spoken “yes” on the same microphone path is not sufficient.
- [ ] Require encrypted transport and server-held credentials for the Home Assistant connection.
- [ ] Add policy, authorization, timeout, unavailable-backend, and false-positive/false-negative tests before product acceptance.
- [ ] Physically verify browser and watch behavior against a safe test allowlist before declaring the integration current.

## Milestone 5 — More integrations, without a general tool surface

**Outcome:** expand utility through small, auditable adapters rather than arbitrary agent access.

Candidate order:

1. Read-only household status and sensor summaries.
2. Timers, reminders, and bounded personal routines.
3. Media playback controls with explicit device/room selection.
4. Weather, calendar, and commute summaries through user-operated or narrowly scoped services.
5. Signed deterministic workflows with declared inputs, outputs, timeouts, and audit events.

For every integration:

- [ ] Define a typed contract, least-privilege credential, allowlist, quota, timeout, and kill switch.
- [ ] Separate reads from mutations and require stronger confirmation as impact rises.
- [ ] Redact sensitive arguments and results from routine logs.
- [ ] Test prompt-injection, malformed-output, replay, stale-session, and unavailable-upstream cases.
- [ ] Provide a per-integration disable/revoke path.
- [ ] Do not expose shells, filesystems, infrastructure administration, dynamic tool registration, or client-selected endpoints.

## Milestone 6 — Privacy and security hardening

**Outcome:** make local-first behavior inspectable and release-gated, not merely aspirational.

- [ ] Add an explicit watch-recording cleanup policy and verify deletion or bounded overwrite of the device-local recording file after transfer, failure, and teardown.
- [ ] Document exact transcript, response-audio, reasoning-history, temporary-file, and audit-metadata lifetimes.
- [ ] Add automated checks that browser and watch bundles contain no credentials, private endpoints, preview URLs, or personal data.
- [ ] Add dependency, container, static-analysis, and secret-scanning gates.
- [ ] Add abuse tests for oversized payloads, malformed OPUS framing, idempotency conflicts, rate-limit bypass, origin confusion, session ownership, and cancellation races.
- [ ] Verify that routine logs never contain audio, transcripts, session tokens, credential material, upstream bodies, or filesystem paths.
- [ ] Add a documented kill switch for integrations and voice processing.
- [ ] Define backup/restore expectations only for configuration; conversational content should remain ephemeral by default.
- 🔒 [ ] Design per-device pairing, short-lived credentials, individual revocation, and replay resistance before considering any reachability beyond a trusted LAN.

## Milestone 7 — Reproducible releases and contributor experience

**Outcome:** a reviewer or contributor can reproduce the software gates while supplying their own private services.

- [ ] Align product version metadata across the root package, API package, watch workspace, manifest, UI, OpenAPI document, tests, and release notes.
- [ ] Pin and document the supported Node, Python, Zeus CLI, Zepp OS target, `ffmpeg`, and `libopus` ranges.
- [ ] Add a sanitized configuration template that covers authenticated reasoning without containing deployment-specific values.
- [ ] Provide a portable local development topology that does not assume a pre-existing private container network.
- [ ] Add one command for Node tests, Python tests, configuration validation, and watch contract checks.
- [ ] Produce checksummed watch artifacts only after exact-version physical acceptance.
- [ ] Add a changelog and an evidence checklist that distinguishes source tests, browser acceptance, simulator evidence, build success, and physical-watch acceptance.
- [ ] Keep architecture, screenshots, README status, roadmap, API contract, and release metadata synchronized in every release change.

## Milestone 8 — Optional remote access evaluation

**Outcome:** decide whether remote access is worth supporting without turning Jarvis into a public general-purpose agent.

This is **not scheduled** and is not required for the local-first product.

- 🔒 [ ] Threat-model authenticated browser access and paired-device access as separate lanes.
- 🔒 [ ] Require phishing-resistant user authentication, application-level authorization, device revocation, origin isolation, rate limits, auditability, and a tested kill switch.
- 🔒 [ ] Prove the API and private workers remain unreachable through alternate routes.
- 🔒 [ ] Run a synthetic-data pilot with no real home mutations before any restricted remote trial.
- 🔒 [ ] Keep a public demo out of scope unless it can run safely with synthetic services and no connection to a private household environment.

## Explicit non-goals

- Always-listening or wake-word capture in the current product.
- Full-duplex audio before interruption, echo, privacy, and cancellation behavior are proven.
- A general agent dashboard or arbitrary prompt-to-tool bridge.
- Shipping private upstream services, device credentials, or a turnkey hosted backend in this repository.
- Treating a screenshot, simulator run, build artifact, or QR installation as proof of physical hardware behavior.
- Public deployment merely to provide a portfolio demo.

<!-- Maintainers: update this roadmap, README status, version metadata/tests, architecture, and screenshots together whenever an item becomes verified or a release boundary changes. -->
