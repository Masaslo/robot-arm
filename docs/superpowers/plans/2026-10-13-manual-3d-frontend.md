# Manual 3D Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Steps use checkbox syntax.

**Goal:** Implement the approved Manual 3D/IK frontend and Automatic placeholder, ready for a separately implemented batch API.
**Architecture:** Vanilla JS modules separate pure math/calibration, HTTP, Three.js drawing, and DOM orchestration. Vite builds to the current Express static root.
**Tech Stack:** Vanilla JS, Vite, Three.js, Node 22 node:test.
**Spec:** docs/superpowers/specs/2026-10-13-manual-3d-frontend-design.md

## Global Constraints

- Work in `/home/floris/School/robot-arm`; preserve backend, firmware, reference repo, unrelated user changes. No subagents spawned by implementers. Commit only owned files.
- No backend batch endpoint implementation; frontend uses POST `/api/arm/angles` with six calibrated servo degrees in `{anglesDeg:{"0":...,"5":...}}`; never six `/api/servo` fallbacks.
- Main joints 0–3 use XYZ/toolpitch IK; sliders only for palm 4 and fingers 5. All UI copy Dutch except Manual, Automatic and Send Angles.
- Default uncalibrated visual demo must block transmission, even if the button is invoked programmatically through the UI handler.
- No React, router, Tailwind, external fonts, source copied wholesale from Robo-Twin, or camera implementation. Desktop primary with stacked narrow layout, visible focus, reduced motion.
- Meaningful tests for math, calibration, API and model transforms. No tests that grep source markup. Run focused tests during iteration, full frontend suite before commit, and preserve existing backend tests.

## Review Focus

- Empty/non-finite numeric inputs must not turn into zero or send stale pose.
- Workspace singularities, negative yaw, tool orientation and inside inner reach must fail cleanly or produce correct finite solutions.
- Changing targets after success, changing tabs and resizing must preserve useful state and render a fresh canvas.
- API HTML errors/204 success/timeout must produce understandable states without duplicate POSTs.
- Invalid calibration data with `calibrated:true` must not enable sends; conversion must validate before rounding.

### Task 1: Kinematics, calibration and API boundary

**Files:** Create `web/package.json`, `web/package-lock.json`, `web/.gitignore`, `web/js/joint_config.js`, `web/js/inverse_kinematics.js`, `web/js/pose.js`, `web/js/api.js`, `web/test/kinematics.test.js`, `web/test/pose.test.js`, `web/test/api.test.js`. Do not edit existing UI/backend files.

**Interfaces produced:**
- `ARM_CONFIG` from joint_config.js: `{calibrated:false, geometry:{baseHeight:0.5,upperArm:1,forearm:0.8,tool:0.35}, joints:[{id,name,minDeg:0,maxDeg:180,offsetDeg,direction:1},...]}`. Names Heup, Schouder, Elleboog, Pols, Palm, Vingers; offsets for IDs 0–5 `[90,0,180,90,90,90]`. Demo values are explicit, not measured facts.
- `INITIAL_TARGET = {x:1.3,y:0,z:1.1,toolPitchDeg:-25}`, `INITIAL_PALM_DEG=90`, `INITIAL_FINGERS_DEG=90` exported from joint_config.js.
- `solveIK(target, geometry)` returns `{valid,anglesDeg,error}`. `anglesDeg` is map IDs 0–3 of mathematical joint rotations in degrees, null on invalid. Shoulder is angle above radial horizontal; elbow-down is negative elbow angle; wrist relative angle sums to tool pitch. Base yaw atan2(y,x). Subtract tool offset before two-link solve. Reject invalid geometry/non-finite/singular base yaw, unreachable targets with useful Dutch errors; use a small tolerance for acos round-off, not clamping genuinely unreachable inputs.
- `forwardKinematics(anglesDeg, geometry)` returns `{shoulder,elbow,wrist,tip}`, each `{x,y,z}`; degrees in interface, radians internally.
- `buildPose(target,palmDeg,fingersDeg,config=ARM_CONFIG)` returns `{valid,modelAnglesDeg,servoAnglesDeg,canSend,error,blockedReason}`. Validate geometry/config/all six joint IDs/bounds/offsets/directions. Convert joints 0–3 using `offsetDeg + direction * modelAngle`. Sliders 4/5 already servo degrees. Validate unrounded values before rounding to nearest integer and validate rounded values. `valid` requires usable preview and bounds; `canSend` additionally requires `config.calibrated === true` and valid calibration. No silently clamped angles. Preserve model math precision; servo targets integers for compatibility with firmware.
- `sendAngles(anglesDeg,{fetchImpl=globalThis.fetch,timeoutMs=15000}={})` returns `{message}` on 2xx and throws user-facing Error on validation/network/HTTP/timeout. Exactly keys 0–5, integer degrees 0–180, one POST JSON, no automatic retries. Handle empty/non-JSON success (including 204) and non-JSON errors. Clear abort timeout in all paths. No import-time effects.

- [x] Write meaningful tests first; watch red before implementing each boundary. Hand-derive known straight pose (upper+forearm+tool at X, shoulder height at Z), base yaw, bent target reconstruction, pitch sum, inner/outer reach, invalid geometry and origin singularity.
- [x] Test calibration offsets/directions/limits, invalid true-flag config, fractional out-of-range before rounding, manual slider values and default gate. Test API using a real local HTTP server via injected fetch URL wrapper where useful; assert actual received body and output/errors, 204/HTML/timeout and malformed payload.
- [x] Implement modules and npm setup with `type:module`, `dev/build/preview` Vite scripts and `test:node --test`; install compatible local Vite/Three.js and pin lockfile. Ignore node_modules and build asset directory, preserve tracked static entry for backend compatibility.
- [x] Run `npm test` from web; self-review and commit task-owned files. Report RED/GREEN evidence.

### Task 2: Dedicated articulated Three.js graphic

**Files:** Replace `web/js/robot_arm.js`; create `web/js/arm_model.js`, `web/test/arm_model.test.js`. Read interfaces from Task 1. Do not edit UI/backend files.

**Interfaces:**
- `createArmModel(config=ARM_CONFIG)` from arm_model.js returns `{group,setPose(pose),endEffector,dispose()}`. No DOM/WebGL at import or model creation. Use Three.js hierarchy with hip Z yaw; shoulder/elbow/wrist local negative-Y rotation so positive math pitch points up. Upper/forearm/tool links extend local X. Shoulder height equals baseHeight. `endEffector` matches FK tip. Palm rolls around tool X from servo neutral offset/direction; fingers open by slider fraction along local Y without moving the mathematical tip. Basic shapes: substantial base, articulated links, round joints, palm, two jaws. Dark metal links and turquoise accents, no asset downloads.
- `createRobotArmView(canvas,config=ARM_CONFIG)` from robot_arm.js returns `{setPose(pose),resize(),setActive(active),dispose()}`. Three WebGLRenderer, fixed perspective camera with Z-up, dark ground and subtle measuring grid, studio lighting. Render on demand; ResizeObserver handles container dimensions and DPR capped at 2; ignore hidden zero size and rerender on becoming active. Proper disposal of renderer, geometries/materials, observer, pending frames. Leave browser fallback handling to caller. No import-time DOM work.

- [x] Test first that actual Three.js joint hierarchy tip position agrees with hand-derived pose/FK for neutral and nonzero yaw/bends, and palm/fingers do not change IK target position. Verify independent grip movement from slider and no invalid pose mutation.
- [x] Implement arm_model and graphic modules, using exact Task 1 pose interface.
- [x] Run full frontend tests; self-review and commit task-owned files. Report browser-specific concerns; controller verifies WebGL visually after Task 3.

### Task 3: Manual app, Vite integration and design

**Files:** Create `web/index.html`, `web/vite.config.js`, `web/js/app.js`, `web/js/manual.js`, `web/README.md`; replace `web/style/style.css`, `web/style/robot_arm.css`; update root README web-start/architecture sections to match delivered frontend. Build updates tracked `web/static/index.html` and generate ignored `web/static/assets/`. Do not edit backend/firmware or other modules unless you report need for context.

**Interfaces consumed:** Task 1 exports and Task 2 `createRobotArmView(canvas,config)`; no alternate pose/angle mapping in UI.

**Behavior:**
- Vite root web; source index at web/index.html; outDir static, publicDir false; root source outside build directory. Proxy `/api` unchanged to `http://localhost:3000`. Built HTML served by existing Express root, assets under `/assets` from its web/static root. Keep /js/robot_arm.js and /style/style.css source files nonempty for existing backend tests. No backend changes.
- One dark app shell with top wordmark Robot Arm, real Manual/Automatic tab buttons and a turquoise segmented switch inspired by reference. Default Manual. Proper tab roles, aria-controls, selected/tabindex and Arrow/Home/End keyboard activation. Automatic placeholder says camera stream follows later, no image/video/fake metrics.
- Desktop canvas stays central with modest widget panels around it (XYZ/toolpitch form left, angle outputs plus palm/fingers controls right) and visible Send Angles action. At narrow width, stack panels and reserve a useful canvas height; no horizontal overflow. Palette from reference (`#202123`, `#42474b`, `#9ee3e9`, near-white); local system sans, tabular numeric values, strong focus and readable labels, no decorative dashboard inflation.
- XYZ numeric inputs step .05, toolpitch degrees input step 1; sliders plus visible degree outputs for Palm/Vingers. Read-only degree values for all six servo commands, main 4 visibly IK-derived. Units label normalized model units in demo. Brief demo/calibration status that explains disabled Send, detailed setup in README. Main math uses buildPose, no manual overrides.
- Every input change computes pose. Empty/invalid fields must not coerce to 0. Invalid poses keep last valid 3D graphic, show explicit error and disable Send; readouts cannot imply invalid target was applied. Clear stale success messages on edits. Tabs preserve values; canvas suspends/resizes when hidden or resumed. Three.js failure shows text fallback and disables sends rather than blank/crashed app.
- Submit revalidates current pose and calibration, makes exactly one `sendAngles` call snapshot, disables relevant inputs/button during pending, uses aria-busy and live status; handles success/errors and allows correction/retry explicitly. Never claims physical motion completed. Never auto-send on controls/tabs/load. Default uncalibrated config blocks all network commands.
- Document npm dev/test/build commands, build-before-Express workflow, geometry/offset/direction/min/max setup, source vs generated paths, and exact batch API contract for other backend chat. No backend endpoint implementation/fallback.

- [x] Implement UI and Vite integration using the approved style references. Use existing product/spec facts; no new approval questions.
- [x] Run frontend tests and build, backend tests from backend. Document any pre-existing failure accurately.
- [x] Check built artifact loading in browser via Vite and existing Express static root without contacting hardware; controller performs bounded screenshot/interactions pass. Commit task-owned files after self-review.
