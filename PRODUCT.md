# Robot Arm

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User selected vanilla JavaScript + Vite + local Three.js. Existing Express backend serves static browser files and will gain a batch API in another chat.

## Users
Project operator developing and manually positioning the Studio Smart Cities robot arm, primarily on laptop/desktop.

## Product Purpose
Preview a six-servo arm pose with XYZ/toolpitch inverse kinematics, then explicitly send calibrated servo setpoints to the backend.

## Capabilities and Constraints
Manual and Automatic tabs. Manual supports IK for heup 0, schouder 1, elleboog 2, pols 3; palm 4 and vingers 5 have separate sliders. Automatic camera stream is future work. Demo geometry must be honest and all sending blocked until real geometry and servo limits/offsets/directions are configured. HTTP acceptance does not mean physical movement completed. Camera and backend implementation are outside this frontend change.

## Brand Commitments
Reuse the dark gray/turquoise dashboard layout and widget design from h-robo-twin-rsl, simplified for one arm.

## Evidence on Hand
Reference styles under h-robo-twin-rsl/apps/web/app. Existing Express static server under backend. No local CAD export or existing IK source; measured geometry and servo calibration are still missing.

## Product Principles
- Keep the arm and the requested pose central.
- Make preview, transmission and hardware acceptance distinguishable.
- Keep the first version small and explicit.
