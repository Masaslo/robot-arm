# Robot Arm — Car Scrap Yard

> Multi-joint robot arm for the Studio Smart Cities *Robotic System* challenge — ESP32 FreeRTOS firmware + host-side OpenCV vision and inverse kinematics.

ESP32 firmware and host software for a multi-joint robot arm that detects model cars with a top-down camera and moves broken cars to a scrapyard.

Built for **Studio Smart Cities**, challenge *Robotic System* (Embedded & Robotics Engineer, **Advanced** track).

> **Short description:** ESP32 + host vision/IK for a robot arm that moves broken model cars to a scrapyard.

## Concept

A top-down camera observes the model-city tile. The host detects and localises cars, classifies each car as whole or broken, and sends a pick-and-place job to the arm.

The planned arm state machine is:

```text
idle → approach → grasp → move → place → release → home
```

The ESP32 handles real-time servo motion, motion limits, and safety. Computer vision and inverse kinematics run on the host (planned: Raspberry Pi). The inverse-kinematics math was first validated independently in Processing (Java) before its planned port to the host.

## Architecture

The system is split into a web client, a host backend, and the ESP32 firmware:

- **Web client (`web/`)** — Dutch Manual interface with XYZ/toolpitch inverse kinematics, a Three.js arm preview and Palm/Vingers sliders. Vite builds the client for Express; sending is blocked until real geometry and servo calibration are configured. Automatic is a future camera placeholder.
- **Backend (`backend/`)** — Node.js/Express serves the web client and forwards validated servo targets to the ESP32 over TCP. OpenCV detection, inverse kinematics (pixel → world → joint angles), and the job/state interface remain planned.
- **Firmware (`firmware/`)** — ESP-IDF and FreeRTOS C++ for servo joint control, motion interpolation, safety limits, and the arm state machine.

Planned data flow:

- Camera → backend: **UDP** image frames.
- Backend → firmware: **TCP** target joint positions and commands.
- Firmware → backend: **TCP** state, joint summary, perception result, and abort/stop events.
- Web client ↔ backend: same-origin HTTP JSON. The Manual client sends one `POST /api/arm/angles` batch; the backend validates all six targets and forwards channels 0–5 sequentially, waiting for each firmware acknowledgement. The existing single-servo `POST /api/servo` API remains available.

The current manual-control message format is documented below. Camera transport and the future job/state messages still need to be specified.

## Hardware

- ESP32 development board with ESP-IDF and FreeRTOS — **[model / ESP32 variant]**
- **[N]** hobby servos for joints (at least 3 DOF) plus one gripper servo
- Separate servo supply (5–6 V rail or BEC) with a common ground to the ESP32
- Top-down camera — **[model]**
- Raspberry Pi host/server — **[model]**
- Arm: 3D-printed links, servo horns, spacers, and brackets; servo-driven gripper with gears
- CAD: Autodesk Fusion 360

Servo selection, GPIO assignments, power budget, and the exact ESP32 variant are not confirmed yet. Do not treat example pins or power values as a final wiring plan.

## Planned repository layout

The repository is still being set up; paths below describe the intended layout and may change as the implementation takes shape.

```text
web/                 Browser interface
backend/             Raspberry Pi host software
  vision/            OpenCV detection and localisation
  kinematics/        Inverse kinematics
  comms/             UDP camera and TCP firmware interfaces
firmware/            ESP-IDF / FreeRTOS firmware
  src/               Motion, state machine, safety, and communications
  include/           Firmware headers
  test/              Firmware tests
cad/                 Fusion 360 models and exports
docs/                Project and interface documentation
README.md
```

## Getting started

The backend can run locally or on the planned Raspberry Pi host. Firmware commands depend on your ESP-IDF installation and board; replace the serial port as needed.

### Firmware

The current firmware targets `esp32s3` (ESP32-S3). Confirm the exact physical board before flashing.

```sh
cd firmware
idf.py set-target esp32s3
idf.py menuconfig # Robot arm network: configure Wi-Fi and backend IPv4 address/port
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

Configure **Robot arm network** in `idf.py menuconfig`: Wi-Fi SSID/password, `ROBOT_ARM_BACKEND_IP` (the backend machine's LAN IPv4 address), and `ROBOT_ARM_BACKEND_PORT` (default `3333`). The backend IP defaults to empty and must be configured locally; an empty or invalid IPv4 address leaves the TCP client inactive while the rest of the firmware continues running. Settings are stored in the local, Git-ignored `firmware/sdkconfig`; keep credentials out of committed defaults.

The ESP32 initiates a persistent TCP connection after Wi-Fi obtains an IP address. Each connect attempt is limited to two seconds. Failed attempts use reconnect delays of 1, 2, 4, 8, 16, then 30 seconds (capped at 30); a successful connection resets the delay. Wi-Fi loss or a socket error closes the connection and returns the client to the IP wait/reconnect loop.

### Backend

Use Node.js 22.9.0 or newer:

```sh
cd backend
npm ci
cp .env.example .env
# Optional: adjust FIRMWARE_PORT and HTTP PORT in .env.
npm start
```

`FIRMWARE_PORT` defaults to `3333`: the backend listens on all IPv4 interfaces (`0.0.0.0`) for the ESP32 to connect. `PORT` defaults to `3000` and is the separate HTTP listener for the browser/API. Both ports must be integers from 1 to 65535 and must be distinct. Configuration is read at startup.

Set the firmware backend IP to this machine's LAN IPv4 address and its backend port to `FIRMWARE_PORT`. Allow inbound TCP on that port through the host firewall, and put the ESP32 and backend on a network where they can reach each other. Start the backend before sending commands; requests fail with HTTP `503` until the ESP32 connects.

### Web client

Use Node.js 22.12.0 or newer and build the frontend before starting Express:

```sh
cd web
npm ci
npm test
npm run build
```

Start the backend as above, then open `http://localhost:3000` (or the host's address and configured port). Express serves the generated `web/static/index.html` and `/assets`. Source modules remain in `web/js`, and source styles in `web/style`; rebuild after changes. For development, run `npm run dev` in `web` and use the printed Vite URL. Its `/api` proxy targets `http://localhost:3000`.

Manual previews a pose from X/Y/Z and toolpitch, with sliders for Palm and Vingers. Default geometry is a normalized demo; **Send Angles is blocked until calibration is configured**. The client sends one six-channel batch to `POST /api/arm/angles`; the backend validates the complete batch and sends channels 0–5 in order, waiting for each acknowledgement. A failure stops the batch; earlier targets may already be moving. There is no automatic retry or rollback, and the targets are not applied simultaneously. The client does not fall back to six single-servo requests. See [web/README.md](web/README.md) for calibration, commands and the exact batch contract. The existing single-servo API below remains unchanged.

### Manual servo API and TCP protocol

```sh
curl -X POST http://localhost:3000/api/servo \
  -H 'Content-Type: application/json' \
  -d '{"servo":0,"angle":90}'
```

`servo` and `angle` must be JSON numbers and integers: channel `0–15`, angle `0–180`. Channels map directly to PCA9685 channels; there is no one-based joint numbering. Each valid HTTP request queues a command on the persistent socket opened by the ESP32. The backend sends ASCII decimal `channel:angle` followed by a newline, for example `0:90\n` (the final byte is LF). Commands share one queue across both HTTP endpoints, with at most one command awaiting acknowledgement at a time.

The firmware replies with exactly one `OK\n` when it accepts a target or `ERR\n` when it rejects it. Acknowledgements may arrive in fragments. Parsing stores at most four bytes. Each command has an absolute two-second acknowledgement deadline starting after its socket write completes; time waiting in the queue is excluded. A valid `OK\n` or `ERR\n` leaves the connection open for subsequent commands. A malformed acknowledgement or timeout closes it; the ESP32 reconnects. A newly connected ESP32 replaces the previous connection and fails any pending or queued commands. Commands are never automatically retried or replayed after reconnecting. The ACK frames have no command IDs, so the backend cannot correlate a delayed duplicate valid acknowledgement that arrives only after it has sent the next command; the persistent protocol relies on the firmware's one-ACK-per-command behavior.

| HTTP status | Meaning |
| --- | --- |
| `200` | Target accepted (`OK`); motion may still be underway. |
| `400` | Invalid JSON, missing fields, wrong types, or out-of-range values. |
| `503` | No ESP32 connected, connection replaced or closed, or transport failure; queued commands also fail on disconnect. |
| `504` | No complete acknowledgement before the deadline. |
| `502` | Firmware rejection (`ERR`) or malformed acknowledgement. |

Responses are JSON with `message` on success or `error` on failure. A timeout or lost connection can occur after the target was accepted; check the arm before sending another target. Use this manual-control server on the trusted project network; authentication and coordinated motion jobs are future work.

### Backend tests

```sh
cd backend
npm test
```

Node's test runner exercises actual local TCP and HTTP servers for framing, fragmented acknowledgements, validation, error mapping, timeouts, and static file delivery. It does not require an ESP32. Physical motion and hardware integration require the board.

## Conventions

- Follow Google coding conventions unless the team agrees otherwise.
- The delivered firmware uses ESP32 + FreeRTOS C++ with ESP-IDF; Arduino is not the project firmware framework.
- There will be one shared city firmware. This arm integrates with the group firmware; it is not a parallel personal firmware.
- Keep the backend, web client, and firmware interfaces documented as those contracts are agreed.

## Status

- [x] Inverse-kinematics math validated in a standalone Processing test.
- [x] Robot-arm 3D model created in Fusion 360.
- [ ] ESP32 firmware: servo motion and state machine.
- [ ] Host vision: OpenCV detection and localisation.
- [x] Manual servo web interface and Express/TCP backend API.
- [ ] End-to-end pick-and-place demo.
- [ ] Measure position error, latency, false positives, and success rate over **[N]** runs.

## License and privacy

The project is licensed under the MIT License; see [LICENSE](LICENSE).

The camera's image processing, storage, and retention policy has not been specified yet. Document it before storing or sharing camera footage.
