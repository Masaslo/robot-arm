// CCD zoekt de positie. De richting van het gereedschap volgt uit de gewrichtshoeken.
export const IK_COMPLETE = true;

// Alle gewrichtshoeken zijn in radialen. De solve-functies passen deze aan.
let hip = 0;
let shoulder = 0;
let elbow = 0;
let wrist = 0;

/** De hoek van het ene punt naar het andere punt. */
export function calculateAngleToPoint(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** De afstand tussen twee punten. */
export function calculateDistance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** Bereken het volgende punt met een lengte en een hoek. */
function calculateNextPoint(start, length, angle) {
  return {
    x: start.x + length * Math.cos(angle),
    y: start.y + length * Math.sin(angle),
  };
}

/** Bereken de actuele gewrichtsposities in het verticale 2D-vlak. */
export function getArmPoints(dimensions) {
  const shoulderPoint = { x: 0, y: 0 };
  const elbowPoint = calculateNextPoint(shoulderPoint, dimensions.upperArm, shoulder);
  const wristPoint = calculateNextPoint(elbowPoint, dimensions.forearm, shoulder + elbow);
  const endPoint = calculateNextPoint(wristPoint, dimensions.tool, shoulder + elbow + wrist);
  return { shoulder: shoulderPoint, elbow: elbowPoint, wrist: wristPoint, end: endPoint };
}

/** Hoe ver moet dit gewricht draaien om de arm-tip naar het doel te richten? */
export function calculateRotation(jointPoint, endPoint, targetPoint) {
  // Bij twee gelijke punten is er geen richting. De andere gewrichten mogen verder.
  if (calculateDistance(jointPoint, endPoint) < 1e-10 ||
      calculateDistance(jointPoint, targetPoint) < 1e-10) return 0;

  const currentAngle = calculateAngleToPoint(jointPoint, endPoint);
  const targetAngle = calculateAngleToPoint(jointPoint, targetPoint);
  let rotation = targetAngle - currentAngle;
  // Kies de kortste draai: nooit meer dan 180 graden per stap.
  if (rotation > Math.PI) rotation -= 2 * Math.PI;
  if (rotation < -Math.PI) rotation += 2 * Math.PI;
  return rotation;
}

/** Houd de lokale hoek binnen de grenzen van deze servo. */
function limitAngle(angle, joint) {
  const firstLimit = (Math.ceil(joint.min) - joint.offset) / joint.direction * Math.PI / 180;
  const secondLimit = (Math.floor(joint.max) - joint.offset) / joint.direction * Math.PI / 180;
  const minAngle = Math.min(firstLimit, secondLimit);
  const maxAngle = Math.max(firstLimit, secondLimit);
  return Math.max(minAngle, Math.min(maxAngle, angle));
}

/** Bovenaanzicht: draai de heup naar X/Y. */
export function solveHip(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Vul geldige X en Y in.');
  if (x === 0 && y === 0) throw new Error('De heuphoek is onbepaald op de basisas. Kies een andere X of Y.');
  hip = Math.atan2(y, x);
}

/** Zijaanzicht: afstand vanaf de basis en hoogte boven het schouderdraaipunt. */
export function projectToArmPlane(target, baseHeight) {
  const plane = { distance: Math.hypot(target.x, target.y), height: target.z - baseHeight };
  if (!Object.values(plane).every(Number.isFinite)) throw new Error('Het doel levert geen bruikbaar 2D-vlak op.');
  return plane;
}

// Stap 1: richt de lijn van pols naar arm-tip naar het doel.
export function solveWrist(targetPoint, dimensions, joint) {
  const points = getArmPoints(dimensions);
  const rotation = calculateRotation(points.wrist, points.end, targetPoint);
  wrist = limitAngle(wrist + rotation, joint);
}

// Stap 2: richt de lijn van elleboog naar arm-tip naar het doel. *
export function solveElbow(targetPoint, dimensions, joint) {
  const points = getArmPoints(dimensions);
  const rotation = calculateRotation(points.elbow, points.end, targetPoint);
  elbow = limitAngle(elbow + rotation, joint);
}

// richt de lijn van schouder naar arm-tip naar het doel.
export function solveShoulder(targetPoint, dimensions, joint) {
  const points = getArmPoints(dimensions);
  const rotation = calculateRotation(points.shoulder, points.end, targetPoint);
  shoulder = limitAngle(shoulder + rotation, joint);
}

// Herhaal pols -> elleboog -> schouder totdat de arm-tip bij het XYZ-doel s.
export function solveIK(arm, target, handAngles = {}) {
  if (!target || !['x', 'y', 'z'].every(name =>
    typeof target[name] === 'number' && Number.isFinite(target[name]))) {
    throw new Error('Vul voor X, Y en Z een eindig getal in.');
  }

  const dimensions = arm.dimensions;
  const currentAngles = arm.getAngles();
  shoulder = currentAngles.shoulder;
  elbow = currentAngles.elbow;
  wrist = currentAngles.wrist;
  solveHip(target.x, target.y);

  const plane = projectToArmPlane(target, dimensions.baseHeight);
  const targetPoint = { x: plane.distance, y: plane.height };
  const origin = { x: 0, y: 0 };
  const targetDistance = calculateDistance(origin, targetPoint);
  const reach = dimensions.upperArm + dimensions.forearm + dimensions.tool;
  const tolerance = reach * 0.001;
  if (targetDistance > reach + tolerance) {
    throw new Error('Het doel ligt buiten het bereik van de arm.');
  }

  // Aan de rand van het bereik moet de arm volledig uitgestrekt zijn.
  if (targetDistance >= reach - tolerance) {
    shoulder = limitAngle(calculateAngleToPoint(origin, targetPoint), arm.joints.shoulder);
    elbow = limitAngle(0, arm.joints.elbow);
    wrist = limitAngle(0, arm.joints.wrist);
  // Een volledig rechte arm kan voor een dichterbij gelegen doel vastlopen.
  } else if (Math.abs(elbow) < 1e-10 && Math.abs(wrist) < 1e-10) {
    shoulder = limitAngle(Math.PI / 2, arm.joints.shoulder);
    elbow = limitAngle(-Math.PI / 2, arm.joints.elbow);
    wrist = limitAngle(0, arm.joints.wrist);
  }

  for (let step = 0; step < 300; step++) {
    const points = getArmPoints(dimensions);
    if (calculateDistance(points.end, targetPoint) <= tolerance) break;

    solveWrist(targetPoint, dimensions, arm.joints.wrist);
    solveElbow(targetPoint, dimensions, arm.joints.elbow);
    solveShoulder(targetPoint, dimensions, arm.joints.shoulder);
  }

  const finalPoints = getArmPoints(dimensions);
  if (calculateDistance(finalPoints.end, targetPoint) > tolerance) {
    throw new Error('Geen oplossing gevonden binnen de gewrichtsgrenzen. Kies een ander doel.');
  }

  // Pas alleen een gevonden oplossing toe; fouten behouden de vorige 3D-stand.
  arm.setAngles({ ...handAngles, hip, shoulder, elbow, wrist });
  return plane;
}
