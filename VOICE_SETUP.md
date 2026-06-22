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
