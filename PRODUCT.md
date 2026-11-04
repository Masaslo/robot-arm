# Robot Arm

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User selected vanilla JavaScript + Vite + local Three.js. Express serves static browser files and accepts a six-servo-ID batch API, forwarding validated targets sequentially through the firmware protocol.

## Users
Project operator developing and manually positioning the Studio Smart Cities robot arm, primarily on laptop/desktop.

## Product Purpose
Preview a six-servo arm pose with XYZ position inverse kinematics, then explicitly send the displayed servo setpoints to the backend.

## Capabilities and Constraints
Manual and Automatic tabs. Manual uses CCD position IK: hip yaw followed by wrist, elbow and shoulder updates from the actual tip towards the XYZ target. A single arm object owns named joint angles in radians; palm and fingers have separate sliders. An opt-in keyboard widget moves the preview endpoint with WASD, Space and Shift, using the existing CCD solver; only Send Angles transmits commands. Automatic camera stream is future work. Demo geometry is labelled honestly; Send Angles transmits the current servo setpoints using the configured limits, offsets and directions. The calibration flag controls the label, not permission to send. Position IK is implemented; tool orientation is not a separate constraint. HTTP acceptance does not mean physical movement completed. Camera and backend implementation are outside this frontend change.

## Brand Commitments
Reuse the dark gray/turquoise dashboard layout and widget design from h-robo-twin-rsl, simplified for one arm.

## Evidence on Hand
Reference styles under h-robo-twin-rsl/apps/web/app. Existing Express static server under backend. No local CAD export or existing IK source; measured geometry and servo calibration are still missing.

## Product Principles
- Keep the arm and the requested pose central.
- Make preview, transmission and hardware acceptance distinguishable.
- Keep the first version small and explicit.
