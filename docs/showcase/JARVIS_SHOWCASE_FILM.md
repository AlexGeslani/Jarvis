# Jarvis showcase film contract

## Public release

- **Title:** Jarvis — Private system online
- **Duration:** 72 seconds
- **Frame:** 1280 × 720 at 30 fps
- **Narration:** user-authorized Prime synthetic voice through ElevenLabs
- **Visual evidence:** sanitized browser cockpit screenshots, the accepted architecture diagram, and a browser-rendered source-faithful watch documentation preview
- **Physical-device claim:** none; the watch preview is not physical-device footage
- **Sound design:** original synthesized tones and ambience; no third-party music or character audio

Raw narration, voice identifiers, conditioning material, provider credentials, and non-public generation metadata are not tracked.

## Timeline and transcript

| Time | Visual | Narration |
| --- | --- | --- |
| 00:00–00:06 | `JARVIS // PRIVATE SYSTEM ONLINE` boot card | “What if a voice assistant didn't need to send every conversation to someone else's cloud?” |
| 00:06–00:16 | Browser cockpit ready state | “Jarvis is my local-first voice assistant. I can talk to it from a browser or from the watch on my wrist.” |
| 00:16–00:28 | Sanitized explicit-turn release-check interface | “The interaction is simple. I choose when it listens. The audio enters my private stack, gets transcribed locally, and only the bounded transcript reaches the reasoning workflow.” |
| 00:28–00:40 | Accepted system architecture | “A shared API owns the security boundary. It validates the session, the request, the media, and the response before anything gets played back.” |
| 00:40–00:52 | API and bounded local-reasoning detail | “Reasoning runs against a private local model. Speech comes back through local synthesis. No public AI endpoint is required for the core experience.” |
| 00:52–01:03 | Browser plus labeled watch documentation preview | “One voice path. Two interfaces. Explicit listening. Ephemeral state. Local control.” |
| 01:03–01:12 | Jarvis / Alex Geslani end card | “Jarvis is where voice AI stopped being an API experiment and became something I could actually wear.” |

## Release checks

Before publication:

1. Full-decode the final MP4 with FFmpeg using error-on-decode.
2. Verify duration, dimensions, cadence, H.264 profile, pixel format, AAC channels, sample rate, and fast-start delivery.
3. Measure decoded dialogue mix for clipping and unexpected silence.
4. Review a chronological final-video contact sheet.
5. Run the repository media-safety gate and complete [`PUBLIC_MEDIA_CHECKLIST.md`](../PUBLIC_MEDIA_CHECKLIST.md).
6. Verify the posted GitHub attachment anonymously with a complete GET and decode.
