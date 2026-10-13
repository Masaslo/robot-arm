# Manual robot-arm frontend

Approved in conversation: one app with Manual/Automatic tabs, desktop first, a centered procedural Three.js arm, and no backend implementation in this work.

Manual inputs are XYZ and tool pitch. Analytic IK controls hip (0), shoulder (1), elbow (2), wrist (3). Palm rotation (4) and fingers (5) have independent sliders. The four IK joints show calculated angles without override sliders. X is forward, Y sideways, Z up. The IK has one elbow-down branch. The 3D module lives at `web/js/robot_arm.js`; pure math, calibration, and HTTP are separate modules.

Use vanilla JavaScript, Vite, local Three.js, and the dark gray/turquoise dashboard/widget style from `h-robo-twin-rsl/apps/web/app`. Use a fixed perspective camera and basic joint/link/gripper geometry. Automatic is a placeholder for a future camera stream.

Demo geometry: base height 0.5, upper arm 1.0, forearm 0.8, wrist/tool 0.35, normalized units. Real geometry, per-servo bounds, zero offsets and direction must be configured before sending. Default calibration is false. Preview remains interactive. Invalid/unreachable inputs show errors and preserve the last valid pose; never silently clamp or send an invalid pose.

Send Angles sends exactly one POST `/api/arm/angles`, JSON `{anglesDeg: {"0": 90, "1": 90, "2": 90, "3": 90, "4": 90, "5": 90}}`. Values are calibrated servo target degrees, IDs as listed above. A 2xx means accepted, not movement finished. Loading/error/success states are visible. The backend chat implements the batch endpoint: the current Express code only implements POST `/api/servo`. Do not add that endpoint here and do not fall back to six single-servo requests.

Preserve the existing Express static serving paths. Vite source HTML becomes `web/index.html`, build output `web/static/`. Source JS and CSS remain `web/js/` and `web/style/`. Dev proxy `/api` to localhost:3000. No firmware or backend implementation changes.

Meaningful verification: IK known targets, forward reconstruction, wrist pitch, unreachable and limit errors; calibration mapping and send gate; HTTP batch shape, success and failures; model joint transforms; desktop/narrow browser interactions; production build and existing backend tests.
