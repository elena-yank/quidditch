# Voice Chat Setup

To make voice chat work reliably for all players, the app needs three things:

1. `HTTPS` in the browser.
2. Working microphone permissions.
3. A `TURN` relay for users behind NAT, mobile networks, or strict routers.

Without `TURN`, WebRTC often works only for part of the lobby.

## App Environment

Set these variables for the main app server:

```env
VOICE_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
VOICE_TURN_URLS=turn:voice.example.com:3478?transport=udp,turns:voice.example.com:5349?transport=tcp
VOICE_TURN_USERNAME=kwidditch
VOICE_TURN_CREDENTIAL=change-me
```

The backend already exposes these ICE servers through `/api/meta`, and the client uses them for every peer connection.

If you deploy with the repository's `turnserver.conf`, the app can also auto-read that file as a fallback and publish matching `turn:` URLs even when `VOICE_TURN_*` env vars are not set yet. This is useful for the bundled `docker-compose.voice-stack.yml` setup.

## Coturn Example

The repository contains `docker-compose.turn.yml` with a ready-made `coturn` template.

Example:

```bash
docker compose -f docker-compose.turn.yml up -d
```

Before starting it, set these environment variables in your shell or a compose env file:

```env
TURN_REALM=voice.example.com
TURN_USERNAME=kwidditch
TURN_PASSWORD=change-me-now
TURN_EXTERNAL_IP=203.0.113.10
```

## Network Requirements

Open these ports to the TURN host:

- `3478/tcp`
- `3478/udp`
- `5349/tcp` if you use `turns:`
- the relay range from the compose file: `49160-49200/tcp`
- the relay range from the compose file: `49160-49200/udp`

## Notes

- Several players can talk at the same time: the client uses full-duplex `WebRTC` audio and sends/receives streams in parallel.
- If voice still fails for some users after `TURN` is configured, first verify the app is opened over `HTTPS` and that the TURN public IP is correct.
- For the current `turnserver.conf` in this repository, the correct app-side URLs are plain `turn:` URLs on port `3478`, because `no-tls` is enabled there.

## Quick Start For Full Stack

To start the app together with `Postgres`, `Caddy`, and `coturn`, use the default compose file in the repository root:

```bash
cp .env.voice-stack.example .env.voice-stack
# edit PUBLIC_HOST and POSTGRES_PASSWORD
docker compose up -d --build
```

On Windows PowerShell, you can also run:

```powershell
.\scripts\start-voice-stack.ps1
```

This script creates `.env.voice-stack` from the example on first run and then starts the full voice-enabled stack.
