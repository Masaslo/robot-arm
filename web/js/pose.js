import { ARM_CONFIG } from './joint_config.js';
import { solveIK } from './inverse_kinematics.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const failedPose = (error, modelAnglesDeg = null) => ({
  valid: false, modelAnglesDeg, servoAnglesDeg: null, canSend: false, error, blockedReason: error,
});

function validCalibration(config) {
  if (!config || typeof config.calibrated !== 'boolean' || !Array.isArray(config.joints) || config.joints.length !== 6) return false;
  const ids = new Set();
  for (const joint of config.joints) {
    if (!joint || !Number.isInteger(joint.id) || joint.id < 0 || joint.id > 5 || ids.has(joint.id) ||
        typeof joint.name !== 'string' || !joint.name.trim() ||
        ![joint.minDeg, joint.maxDeg, joint.offsetDeg].every(finite) ||
        joint.minDeg < 0 || joint.maxDeg > 180 || joint.minDeg > joint.maxDeg ||
        ![1, -1].includes(joint.direction)) return false;
    ids.add(joint.id);
  }
  return ids.size === 6;
}

export function buildPose(target, palmDeg, fingersDeg, config = ARM_CONFIG) {
  if (!validCalibration(config)) return failedPose('Ongeldige kalibratie: controleer de zes gewrichten en hun grenzen.');
  const solution = solveIK(target, config.geometry);
  if (!solution.valid) return failedPose(solution.error);
  const modelAnglesDeg = solution.anglesDeg;
  if (![palmDeg, fingersDeg].every(finite)) return failedPose('Vul geldige hoeken voor Palm en Vingers in.', modelAnglesDeg);
  const servoAnglesDeg = {};
  for (const joint of config.joints) {
    const raw = joint.id < 4 ? joint.offsetDeg + joint.direction * modelAnglesDeg[joint.id] :
      joint.id === 4 ? palmDeg : fingersDeg;
    const rounded = Math.round(raw);
    // Check the physical input before rounding and the actual integer command after it.
    if (!finite(raw) || raw < joint.minDeg || raw > joint.maxDeg ||
        rounded < joint.minDeg || rounded > joint.maxDeg) {
      return failedPose(`${joint.name} valt buiten de gekalibreerde grenzen (${joint.minDeg}–${joint.maxDeg}°).`, modelAnglesDeg);
    }
    servoAnglesDeg[joint.id] = rounded;
  }
  return {
    valid: true, modelAnglesDeg, servoAnglesDeg,
    canSend: config.calibrated === true,
    error: null,
    blockedReason: config.calibrated === true ? null : 'Kalibreer de arm voordat je hoeken verstuurt.',
  };
}
