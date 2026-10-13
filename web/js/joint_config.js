// Visual demo dimensions and offsets, not measured hardware calibration.
export const ARM_CONFIG = {
  calibrated: false,
  geometry: { baseHeight: 0.5, upperArm: 1, forearm: 0.8, tool: 0.35 },
  joints: ['Heup', 'Schouder', 'Elleboog', 'Pols', 'Palm', 'Vingers'].map((name, id) => ({
    id, name, minDeg: 0, maxDeg: 180,
    offsetDeg: [90, 0, 180, 90, 90, 90][id], direction: 1,
  })),
};
export const INITIAL_TARGET = { x: 1.3, y: 0, z: 1.1, toolPitchDeg: -25 };
export const INITIAL_PALM_DEG = 90;
export const INITIAL_FINGERS_DEG = 90;
