# Security Policy

## Supported deployment

**SUPPORTED:** private trusted-LAN deployment following the documented configuration.

The supported security boundary assumes:

- a user-operated private network;
- a trusted HTTPS origin for the browser and API;
- operator-supplied private speech, reasoning, orchestration, and synthesis services;
- server-side credentials that are never shipped to browser or watch clients;
- the documented origin, session, request, media, rate, and response limits;
- no anonymous public route to the Jarvis API, n8n webhook, model, STT, or TTS service.

Only the current default-branch release and its documented configuration are evaluated. Modified deployments must preserve the same trust boundary and fail-closed controls.

## Unsupported deployment

**NOT SUPPORTED:** direct anonymous Internet exposure.

Jarvis is not an Internet-facing assistant or hosted service. The current design does not provide the account authentication, device credential issuance and revocation, abuse controls, public-ingress review, or operational protections required for anonymous exposure. Do not publish the API, n8n webhook, model, STT, or TTS services directly to the Internet.

## Reporting a vulnerability

Use this repository's private vulnerability-reporting path:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version, deployment assumptions, impact, and minimal reproduction details.

Do not post credentials, private URLs, transcripts, audio, account identifiers, or exploit details in a public issue. If private reporting is temporarily unavailable, open a minimal public issue requesting a private reporting channel without including sensitive details.

## Publication safety

Before release, run:

```bash
npm run public-safety
npm run media-safety
npm run validate:publication
```

The text scanner fails closed on common credential, private-network, path, log, transcript, recording, session, QR, and generated-package risks. The media scanner inventories candidate visual media, inspects metadata, full-decodes raster/moving media, samples moving-media frames, and uses OCR where available. These automated checks are defense in depth; human visual review remains required under [`docs/PUBLIC_MEDIA_CHECKLIST.md`](docs/PUBLIC_MEDIA_CHECKLIST.md).
