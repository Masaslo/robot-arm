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

- **Web client (`web/`)** — browser interface for the system. Minimal Dutch control form for a servokanaal (0–15) and doelhoek (0–180°), served by the backend.
- **Backend (`backend/`)** — Node.js/Express serves the web client and forwards validated servo targets to the ESP32 over TCP. OpenCV detection, inverse kinematics (pixel → world → joint angles), and the job/state interface remain planned.
- **Firmware (`firmware/`)** — ESP-IDF and FreeRTOS C++ for servo joint control, motion interpolation, safety limits, and the arm state machine.

Planned data flow:

- Camera → backend: **UDP** image frames.
- Backend → firmware: **TCP** target joint positions and commands.
- Firmware → backend: **TCP** state, joint summary, perception result, and abort/stop events.
- Web client ↔ backend: same-origin HTTP JSON (`POST /api/servo`).

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
idf.py menuconfig # Robot arm network: configure Wi-Fi SSID and password
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

Wi-Fi settings are stored in the local, Git-ignored `firmware/sdkconfig`. Configure them under **Robot arm network** in `idf.py menuconfig`; keep credentials out of committed defaults.

### Backend

Use Node.js 22.9.0 or newer:

```sh
cd backend
npm ci
cp .env.example .env
# Set ESP32_HOST in .env to the ESP32 address on your local network.
npm start
```

`ESP32_HOST` is required. `ESP32_PORT` defaults to `3333`; `PORT` defaults to `3000`. Both ports must be integers from 1 to 65535. The sample address is illustrative; use the actual ESP32 address. Configuration is read at startup.

### Web client

Open `http://localhost:3000` (or the host's address and configured port). The backend serves `web/static/index.html`, `/js`, and `/style` from the same origin; no separate frontend build or server is needed. Select a channel and angle, then submit. The form disables submission while awaiting a result and displays connection or validation errors.

### Manual servo API and TCP protocol

```sh
curl -X POST http://localhost:3000/api/servo \
  -H 'Content-Type: application/json' \
  -d '{"servo":0,"angle":90}'
```

`servo` and `angle` must be JSON numbers and integers: channel `0–15`, angle `0–180`. Channels map directly to PCA9685 channels; there is no one-based joint numbering. Each valid HTTP request opens one TCP connection to the configured ESP32 and sends ASCII decimal `channel:angle` followed by a newline, for example `0:90\n` (the final byte is LF).

The firmware replies with `OK\n` when it accepts the target or `ERR\n` when it rejects it. Acknowledgements may arrive in fragments. Parsing stores at most four bytes, and the entire connection/acknowledgement has an absolute two-second deadline. The backend closes each connection after the result and does not retry automatically.

| HTTP status | Meaning |
| --- | --- |
| `200` | Target accepted (`OK`); motion may still be underway. |
| `400` | Invalid JSON, missing fields, wrong types, or out-of-range values. |
| `503` | TCP connection or transport failure. |
| `504` | No complete acknowledgement before the deadline. |
| `502` | Firmware rejection, malformed response, or connection closed without a complete acknowledgement. |

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
