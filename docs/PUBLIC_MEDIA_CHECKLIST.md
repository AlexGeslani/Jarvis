# Public media release checklist

Automated media scanning is defense in depth, not proof that an image or video is safe. `npm run media-safety` inventories candidate raster, vector, and moving-image assets; full-decodes raster/moving media with FFmpeg; validates vector XML through publication validation and inspects its source text; inspects embedded metadata; extracts representative moving-media frames; and scans visible text for high-confidence secret and private-infrastructure patterns. CI requires Tesseract OCR and ExifTool; macOS development can use Apple Vision OCR with FFprobe metadata inspection.

A private denylist may be supplied through ignored `.public-safety.private.json` or `JARVIS_PUBLIC_SAFETY_PRIVATE_LITERALS_JSON`. The scanner reports only category labels and safe asset labels, never matched values.

Before publishing or replacing any screenshot, GIF, video, or physical-device photo:

- [ ] Capture from the exact release candidate using sanitized fixtures or explicitly authorized device footage.
- [ ] Confirm no credentials, tokens, private webhook/model/STT/TTS URLs, private hostnames/IPs, local paths, account identifiers, prompts, raw logs, transcripts, recordings, session artifacts, notifications, Wi-Fi identifiers, QR codes, Zepp preview URLs, or personal/family information are visible.
- [ ] For physical-device evidence, inspect the background and reflections for home details, people, documents, screens, location clues, and other private context.
- [ ] Keep physical-device evidence explicitly distinct from browser-rendered watch documentation.
- [ ] Review a chronological contact sheet covering the opening, every scene transition, representative moving-media positions, and the final frame.
- [ ] Inspect embedded metadata and require a clean full decode with `npm run media-safety`.
- [ ] Verify titles, captions, repository links, interface labels, narration, and accessibility text against the current release candidate.
- [ ] Confirm the media includes no Marvel/Disney artwork, logos, copied interface assets, quotes, sounds, cloned character voices, or unapproved music.
- [ ] Describe narration only as an authorized original synthetic voice; do not publish provider credentials, private voice identifiers, or conditioning material.
- [ ] Re-run the scanner after the final render; changing or re-encoding an asset invalidates the prior result.

OCR can miss stylized, animated, low-contrast, reflected, very small, or briefly displayed text. Five representative video frames can miss a short-lived disclosure between samples. Metadata tools cannot establish what a scene implies. Human review of every final still and the complete final cut remains required.
