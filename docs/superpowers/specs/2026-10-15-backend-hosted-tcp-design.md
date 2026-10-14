# Backend-Hosted TCP Connection Design

## Status

Proposed design. The user selected one persistent TCP connection from the ESP32 to the backend on 2026-10-15. This document needs user review before implementation planning.

## Goal

Make the JavaScript backend the TCP listener for servo control. The ESP32 joins the same LAN and connects to the backend's configured IP address. HTTP requests continue to use the existing servo API and receive a result based on the firmware acknowledgement.

## Current behavior

- `backend/app.js` opens an outbound TCP connection to the ESP32 for each servo command.
- The ESP32 listens on port 3333, parses one `channel:angle\n` frame, replies with `OK\n` or `ERR\n`, then closes the connection.
- The ESP32 already joins Wi-Fi in station mode and retries Wi-Fi association after disconnects.
- The current uncommitted backend change also includes `POST /api/arm/angles`; it must be preserved and routed through the same TCP connection.

## Proposed behavior

1. The backend starts a TCP listener on the configured firmware port (default 3333) and accepts the ESP32's outbound connection. It listens on all network interfaces so another LAN device can reach it.
2. The ESP32 waits until Wi-Fi has an IP address, then connects to the backend IPv4 address and configured TCP port. Its Kconfig settings provide the backend address and port; the address is not hard-coded because the actual host IP is environment-specific.
3. The TCP connection stays open. Both sides keep the existing newline-framed protocol: the backend sends `channel:angle\n`, and the ESP32 replies `OK\n` or `ERR\n` for each command. The ESP32 resets its bounded parser after each complete command and continues reading frames on the same socket.
4. For a valid command, the ESP32 calls `moveServoTo`. Set the default movement speed to 360 degrees per second, the existing maximum software speed. Motion remains interpolated at the firmware's 20 ms update interval and is not physically instantaneous.
5. The backend serializes commands from concurrent HTTP requests so each acknowledgement belongs to the command at the head of the queue. `POST /api/servo` and `POST /api/arm/angles` keep their current validation and response contracts.
6. If the connection drops, the ESP32 closes its socket and reconnects with bounded backoff. A newly accepted firmware connection replaces any stale active connection.

## Failure handling

- Requests received before a firmware connection is available return HTTP 503.
- A disconnect or socket error during a command returns HTTP 503. The backend does not retry a command because the firmware may have accepted it before the connection failed.
- A firmware `ERR` returns HTTP 502 and leaves the aligned connection open. A malformed acknowledgement returns HTTP 502 and closes the connection so leftover bytes cannot be mistaken for a later acknowledgement.
- If no complete acknowledgement arrives within the existing two-second deadline, the request returns HTTP 504 and the backend closes that TCP connection. Closing it prevents a late acknowledgement from being mistaken for a later command; the ESP32 reconnects, and queued commands fail with HTTP 503 rather than being retried.
- A batch stops at the first failed command. Earlier channel targets may already have been accepted, matching the current API behavior.

## Configuration and documentation

- Keep the HTTP listener on `PORT` (default 3000).
- Replace backend `ESP32_HOST` / `ESP32_PORT` outbound-client settings with a firmware TCP listener port setting (default 3333). The listener binds to all interfaces.
- Add firmware Kconfig settings for backend IPv4 address and TCP port (default 3333). The user supplies the backend machine's LAN address.
- Update the root and web documentation to explain that the backend listens and the ESP32 connects, and document the two separate ports.
- Do not read or edit the ignored local `.env` or `firmware/sdkconfig` while changing committed configuration; the user can update their local backend IP setting after the interface is in place.

## Scope

Changes are expected in the backend TCP connection manager, backend startup/configuration, the ESP-IDF TCP component and its Kconfig settings, the robot-arm motion API/default speed, and the connection/protocol documentation. The web UI and its HTTP endpoint payloads remain unchanged. Existing unrelated local edits must be preserved.

## Open implementation prerequisite

The checked-in firmware configuration targets ESP32-S3, but the physical board revision and ESP-IDF version are not established from the repository. Confirm those before editing or building firmware. The backend host's actual LAN IP remains a local configuration value and does not need to be written into the repository.

## Review checklist

- The backend is the TCP listener and the ESP32 is the TCP client.
- The connection persists and the ESP32 reconnects after loss.
- The existing command and acknowledgement frames are reused.
- HTTP commands are serialized and await their matching acknowledgement.
- Existing backend changes and unrelated workspace edits are preserved.
