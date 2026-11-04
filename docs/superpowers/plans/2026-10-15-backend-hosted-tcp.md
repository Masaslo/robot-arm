# Backend-Hosted TCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Node.js backend listen for a persistent TCP connection from the ESP32 and route the existing servo HTTP endpoints over it.

**Architecture:** A backend firmware-link module owns one active ESP32 socket, a FIFO command queue, and acknowledgement parsing. The ESP32 joins Wi-Fi as it does today, connects to the configured backend IPv4 address, handles repeated newline-framed commands on that socket, and reconnects after loss. The existing `channel:angle\n` and `OK\n` / `ERR\n` frames remain unchanged.

**Tech Stack:** Node.js 22.9+, Express 5, Node `net`, ESP-IDF / FreeRTOS / lwIP BSD sockets.

**Spec:** [2026-10-15-backend-hosted-tcp-design.md](../specs/2026-10-15-backend-hosted-tcp-design.md)

## Global Constraints

- Backend TCP listener binds to all interfaces and uses port 3333 by default.
- HTTP remains on `PORT` 3000 by default.
- Firmware configuration supplies the backend IPv4 address and TCP port; do not commit the user's actual LAN IP.
- Keep the command and acknowledgement frames `channel:angle\n`, `OK\n`, and `ERR\n`.
- Serialize HTTP commands; wait up to two seconds for each acknowledgement after sending it.
- Do not retry uncertain commands. Preserve HTTP 503 for unavailable/transport failures, 502 for rejection or malformed acknowledgement, and 504 for acknowledgement timeout. Close the socket after malformed data or acknowledgement timeout so a late reply from a failed exchange cannot be paired with a later command. The unchanged `OK\n` / `ERR\n` frames have no command IDs: compliant firmware must send exactly one ACK per command, and a delayed duplicate valid ACK arriving after the next command is sent cannot be distinguished from that command's reply.
- A new firmware connection replaces a stale active connection; keep only one active arm connection.
- Rename the firmware motion entry point to `moveServoTo` and set its default software speed to 360 degrees per second, the current maximum. The 20 ms interpolation task and physical servo response mean motion is fast but not literally instantaneous.
- Preserve existing local changes, including the uncommitted `/api/arm/angles` route.
- Confirm the physical ESP32-S3 board/revision and ESP-IDF version before editing firmware.
- Do not add or run tests unless the user separately asks for testing or verification.

## Review Focus

- Fragmented acknowledgements must be assembled exactly. Reject malformed data, excess bytes in the current response, and ACK data received while no command is pending. The protocol has no ACK IDs, so a delayed duplicate valid `OK\n` / `ERR\n` arriving after the next command is sent cannot be identified; explicitly rely on the firmware contract of exactly one ACK per command rather than claiming protection against that case.
- Disconnect during an in-flight or queued command must reject affected HTTP requests without retrying; inspect queue cleanup and error mapping.
- HTTP requests before the ESP32 connects must return 503; inspect initial link state handling.
- A reconnect must replace the old socket and restore command delivery; inspect active-socket ownership and backoff reset.
- Concurrent requests and six-channel batches must keep command order and stop after the first failure; inspect the shared send queue and batch loop.

---

### Task 1: Add the backend persistent firmware link

**Files:**
- Create: `backend/firmware_link.js`
- Modify: `backend/app.js`
- Modify: `backend/server.js`
- Modify: `backend/.env.example`

**Interfaces:**
- `createFirmwareLink({ackTimeoutMs = 2000} = {})` returns `{server, sendTarget(channel, angle)}`.
- `server` is a `net.Server` owned by the link and started by `server.js` on `0.0.0.0:<firmwarePort>`.
- `sendTarget(channel, angle)` resolves after the matching `OK\n`, and rejects with an error containing `status` and `message` compatible with the current HTTP handlers.
- `createApp({sendTarget})` uses the injected function for both `POST /api/servo` and `POST /api/arm/angles`.

- [ ] **Step 1: Implement the connection manager in `backend/firmware_link.js`**

  Create a TCP listener, track one active socket, replace and close the previous socket when a new one connects, and process commands through a FIFO queue. Reject immediately with status 503 when no socket is available. If an active socket closes, reject its in-flight and queued commands with status 503. Start a two-second acknowledgement deadline only after a command is written. Parse fragmented replies while accepting only exactly `OK\n` and `ERR\n`; map a firmware rejection to 502, timeout to 504, and socket loss to 503. Do not automatically retry. Close the active socket after malformed data or an acknowledgement timeout, then fail queued requests with 503; this prevents replies from those failed exchanges from being matched to later commands. The unnumbered protocol relies on compliant firmware sending exactly one ACK per command; a delayed duplicate valid ACK arriving after the next command is sent cannot be distinguished from its reply.

- [ ] **Step 2: Route existing HTTP handlers through the injected link**

  Remove the `ESP32_HOST` requirement and outbound `net.Socket` connection from `backend/app.js`. Keep all request validation and response wording/status contracts. Keep the batch route sequential; each of its six `sendTarget` calls must use the same queue and the loop must stop on its first rejection.

- [ ] **Step 3: Start the TCP and HTTP listeners in `backend/server.js`**

  Read `FIRMWARE_PORT` with default 3333 and validate it using the existing port validation pattern. Start the firmware TCP listener on `0.0.0.0` and the Express listener on `PORT` (default 3000). Log both listening ports, and fail startup with a clear error if either listener cannot bind. Retain the current Node env-file startup behavior.

- [ ] **Step 4: Update the committed backend example configuration**

  Replace `ESP32_HOST` and `ESP32_PORT` in `.env.example` with `FIRMWARE_PORT=3333`; retain `PORT=3000`. Do not read, edit, or commit the ignored local `.env`.

- [ ] **Step 5: Review the backend diff without staging pre-existing edits**

  Inspect the diff for preservation of the user's current batch route and exact HTTP status behavior. `backend/app.js` already has user edits, so leave the task changes unstaged and do not commit that file or the rest of this task.

### Task 2: Convert the ESP32 TCP service into a reconnecting client

**Files:**
- Modify: `firmware/components/tcp_socket/Kconfig`
- Modify: `firmware/components/tcp_socket/tcp_socket.c`
- Modify: `firmware/components/tcp_socket/include/tcp_socket.h`
- Modify: `firmware/components/tcp_socket/CMakeLists.txt`
- Modify: `firmware/components/robot_arm/robot_arm.c`
- Modify: `firmware/components/robot_arm/include/robot_arm.h`
- Modify: `firmware/main/main.c`

**Precondition:** Obtain the exact physical board/revision and ESP-IDF version. The checked-in `sdkconfig` targets ESP32-S3, but does not establish the board revision or IDF version.

**Interfaces:**
- Add Kconfig values `ROBOT_ARM_BACKEND_IP` (IPv4 string) and `ROBOT_ARM_BACKEND_PORT` (integer, default 3333, range 1–65535).
- Keep `tcp_socket_wifi_init()` and `tcp_socket_start()` as the public entry points; `tcp_socket_start()` launches a client task after Wi-Fi initialization.

- [ ] **Step 1: Add firmware backend address and port configuration**

  Add the two Kconfig entries, with an empty IP default so an unconfigured backend cannot silently connect to an illustrative address. Validate the address with `inet_pton(AF_INET, ...)` in the client task; if it is empty or invalid, log a clear configuration error and leave the rest of the firmware (including its console) running without attempting a connection.

- [ ] **Step 2: Replace the TCP listener task with a persistent TCP client task**

  After `IP_READY`, connect to the configured backend IP and port. Bound each connect attempt to two seconds. After failed attempts, wait 1, 2, 4, 8, 16, then 30 seconds (cap at 30); reset the delay after a successful connection. On Wi-Fi loss or socket error, close the socket and return to the IP wait/reconnect loop.

- [ ] **Step 3: Handle repeated commands on the open socket**

  Rename `lerp_to_servo_angle` to the exact public symbol `moveServoTo` in `robot_arm.h` and `robot_arm.c`, then update all call sites in `main.c` and `tcp_socket.c`. Set `SERVO_DEFAULT_SPEED` to `SERVO_MAX_SPEED` (360 degrees per second). Keep the existing 20 ms interpolation cadence; 360 degrees per second is the fastest software ramp and does not make physical servo travel instantaneous. Read the existing byte-framed protocol on the same connection. For every complete valid frame, call `moveServoTo`, send the full `OK\n` or `ERR\n` reply, reset the frame parser, and continue reading. On an invalid or oversized frame, send `ERR\n` and close the connection to restore framing before reconnecting. Do not half-close or close the socket after a valid acknowledgement.

- [ ] **Step 4: Remove the per-request close helper from the component build**

  Remove `tcp_close.c` from the component source list because persistent connections must not call `tcp_finish_response()` after each command. Keep unrelated component files and tests untouched.

- [ ] **Step 5: Build the firmware for the confirmed target**

  Confirm `idf.py --version` and the selected target first. Configure the local backend IP with `idf.py menuconfig`, then run `idf.py build`. Do not flash the board as part of this plan.

- [ ] **Step 6: Review the firmware client diff**

  Inspect the diff for socket cleanup, bounded waits, reconnect behavior, and unchanged servo parser limits. Leave the changes unstaged because the shared workspace already contains unrelated user edits.

### Task 3: Update operator documentation

**Files:**
- Modify: `README.md`
- Modify: `web/README.md`

**Interfaces:**
- Documentation names `FIRMWARE_PORT` (default 3333), `PORT` (default 3000), and the firmware Kconfig backend IP/port settings.

- [ ] **Step 1: Update root setup and protocol documentation**

  Remove the instruction to configure `ESP32_HOST`. Explain that the backend listens for the ESP32 on TCP port 3333, while the ESP32 connects to the backend machine's LAN IPv4 address. Document the persistent socket, reconnection behavior, separate HTTP port, unchanged frame/ack format, and the existing HTTP failure statuses.

- [ ] **Step 2: Update the manual batch contract in `web/README.md`**

  Replace the claim that each command uses a separate TCP connection with the persistent connection behavior. Preserve the existing six-channel ordering, partial-acceptance warning, and no-automatic-retry behavior.

- [ ] **Step 3: Review the documentation diff without staging pre-existing edits**

  Check that setup commands and port descriptions match `backend/.env.example` and firmware Kconfig. `README.md` and `web/README.md` already have user edits, so leave the task changes unstaged and do not commit those files.
