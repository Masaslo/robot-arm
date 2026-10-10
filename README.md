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

- **Web client (`web/`)** — browser interface for the system. Its screens and backend API are not defined yet.
- **Backend (`backend/`, planned for Raspberry Pi)** — OpenCV detection and localisation, inverse kinematics (pixel → world → joint angles), and the job/state interface.
- **Firmware (`firmware/`)** — ESP-IDF and FreeRTOS C++ for servo joint control, motion interpolation, safety limits, and the arm state machine.

Planned data flow:

- Camera → backend: **UDP** image frames.
- Backend → firmware: **TCP** target joint positions and commands.
- Firmware → backend: **TCP** state, joint summary, perception result, and abort/stop events.
- Web client ↔ backend: transport and API contract **to be decided**.

The exact message format, network setup, and web/backend interface still need to be specified.

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

These are placeholder commands based on the planned layout. They have not been verified against a buildable firmware or backend project yet. Replace the target, serial port, and entry-point paths when those are known.

### Firmware

```sh
cd firmware
idf.py set-target esp32
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

### Backend

Once `backend/requirements.txt` and `backend/main.py` exist:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
python3 backend/main.py
```

### Web client

The web framework, package manager, and start command have not been selected yet.

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
- [ ] Web interface and backend API.
- [ ] End-to-end pick-and-place demo.
- [ ] Measure position error, latency, false positives, and success rate over **[N]** runs.

## License and privacy

The project is licensed under the MIT License; see [LICENSE](LICENSE).

The camera's image processing, storage, and retention policy has not been specified yet. Document it before storing or sharing camera footage.
