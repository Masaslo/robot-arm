const radians = degrees => degrees * (Math.PI / 180);
const degrees = angle => angle * (180 / Math.PI);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function validGeometry(geometry) {
  return geometry && ['baseHeight', 'upperArm', 'forearm', 'tool'].every(key => finite(geometry[key])) &&
    geometry.baseHeight >= 0 && geometry.upperArm > 0 && geometry.forearm > 0 && geometry.tool >= 0;
}

const invalid = error => ({ valid: false, anglesDeg: null, error });

export function solveIK(target, geometry) {
  if (!validGeometry(geometry)) return invalid('Ongeldige armgeometrie: controleer de lengtes.');
  if (!target || !['x', 'y', 'z', 'toolPitchDeg'].every(key => finite(target[key]))) {
    return invalid('Vul voor elk doel een eindig getal in.');
  }
  const radial = Math.hypot(target.x, target.y);
  if (radial === 0) return invalid('De heuphoek is onbepaald op de basisas. Kies een andere X of Y.');
  const pitch = radians(target.toolPitchDeg);
  const wristRadial = radial - geometry.tool * Math.cos(pitch);
  const wristHeight = target.z - geometry.baseHeight - geometry.tool * Math.sin(pitch);
  const { upperArm, forearm } = geometry;
  const cosine = (wristRadial ** 2 + wristHeight ** 2 - upperArm ** 2 - forearm ** 2) /
    (2 * upperArm * forearm);
  // Only absorb floating-point error at a reach boundary, never real overshoot.
  if (!Number.isFinite(cosine) || cosine < -1 - 1e-10 || cosine > 1 + 1e-10) {
    return invalid('Dit doel ligt buiten het bereik van de arm.');
  }
  const elbow = -Math.acos(Math.max(-1, Math.min(1, cosine)));
  const shoulder = Math.atan2(wristHeight, wristRadial) -
    Math.atan2(forearm * Math.sin(elbow), upperArm + forearm * Math.cos(elbow));
  const anglesDeg = {
    0: degrees(Math.atan2(target.y, target.x)),
    1: degrees(shoulder),
    2: degrees(elbow),
    3: target.toolPitchDeg - degrees(shoulder) - degrees(elbow),
  };
  if (!Object.values(anglesDeg).every(finite)) return invalid('Dit doel levert geen bruikbare hoeken op.');
  return { valid: true, anglesDeg, error: null };
}

export function forwardKinematics(anglesDeg, geometry) {
  if (!validGeometry(geometry)) throw new Error('Ongeldige armgeometrie: controleer de lengtes.');
  if (!anglesDeg || ![0, 1, 2, 3].every(id => finite(anglesDeg[id]))) {
    throw new Error('Elke modelhoek moet een eindig getal zijn.');
  }
  const yaw = radians(anglesDeg[0]);
  const shoulderAngle = radians(anglesDeg[1]);
  const forearmAngle = shoulderAngle + radians(anglesDeg[2]);
  const toolAngle = forearmAngle + radians(anglesDeg[3]);
  const point = (radial, z) => ({ x: radial * Math.cos(yaw), y: radial * Math.sin(yaw), z });
  const elbowRadial = geometry.upperArm * Math.cos(shoulderAngle);
  const elbowHeight = geometry.baseHeight + geometry.upperArm * Math.sin(shoulderAngle);
  const wristRadial = elbowRadial + geometry.forearm * Math.cos(forearmAngle);
  const wristHeight = elbowHeight + geometry.forearm * Math.sin(forearmAngle);
  return {
    shoulder: { x: 0, y: 0, z: geometry.baseHeight },
    elbow: point(elbowRadial, elbowHeight),
    wrist: point(wristRadial, wristHeight),
    tip: point(wristRadial + geometry.tool * Math.cos(toolAngle), wristHeight + geometry.tool * Math.sin(toolAngle)),
  };
}
