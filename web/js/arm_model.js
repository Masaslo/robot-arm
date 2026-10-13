import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { ARM_CONFIG } from './joint_config.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const radians = value => value * Math.PI / 180;

/** The model owns geometry/materials; callers own poses and the parent scene. */
export function createArmModel(config = ARM_CONFIG) {
  const geometry = { ...config?.geometry };
  if (!['baseHeight', 'upperArm', 'forearm', 'tool'].every(key => finite(geometry[key])) ||
      geometry.baseHeight < 0 || geometry.upperArm <= 0 || geometry.forearm <= 0 || geometry.tool < 0 ||
      !Array.isArray(config?.joints) || config.joints.length !== 6) {
    throw new Error('Ongeldige armgeometrie of gewrichtconfiguratie.');
  }
  const joints = Array.from({ length: 6 }, (_, id) => ({ ...config.joints.find(joint => joint?.id === id) }));
  if (joints.some(joint => !Number.isInteger(joint.id) || typeof joint.name !== 'string' ||
      ![joint.minDeg, joint.maxDeg, joint.offsetDeg].every(finite) ||
      joint.minDeg < 0 || joint.maxDeg > 180 || joint.minDeg > joint.maxDeg ||
      ![1, -1].includes(joint.direction))) {
    throw new Error('Ongeldige gewrichtconfiguratie.');
  }

  const group = new Group();
  group.name = 'robot-arm';
  const geometries = new Set();
  const materials = new Set();
  const material = options => {
    const value = new MeshStandardMaterial(options);
    materials.add(value);
    return value;
  };
  const metal = material({ color: 0x343b40, metalness: 0.68, roughness: 0.34 });
  const graphite = material({ color: 0x151b20, metalness: 0.5, roughness: 0.42 });
  const turquoise = material({ color: 0x9ee3e9, metalness: 0.28, roughness: 0.3 });
  const steel = material({ color: 0x8a999f, metalness: 0.85, roughness: 0.25 });
  const rubber = material({ color: 0x111719, metalness: 0, roughness: 0.9 });

  function mesh(parent, shape, surface, position = [0, 0, 0]) {
    geometries.add(shape);
    const node = new Mesh(shape, surface);
    node.position.set(...position);
    node.castShadow = true;
    node.receiveShadow = true;
    parent.add(node);
    return node;
  }
  const box = (parent, size, surface, position) => mesh(parent, new BoxGeometry(...size), surface, position);
  function cylinder(parent, radius, length, surface, position, axis = 'y') {
    const node = mesh(parent, new CylinderGeometry(radius, radius, length, 40), surface, position);
    if (axis === 'z') node.rotation.x = Math.PI / 2;
    if (axis === 'x') node.rotation.z = Math.PI / 2;
    return node;
  }
  function joint(id, parent, x = 0, z = 0) {
    const node = new Group();
    node.name = `joint-${id}`;
    node.userData = { jointId: id, jointName: joints[id].name };
    node.position.set(x, 0, z);
    parent.add(node);
    return node;
  }
  function pitchHub(parent, radius) {
    cylinder(parent, radius, radius * 1.7, graphite);
    for (const side of [-1, 1]) {
      cylinder(parent, radius * 0.74, 0.025, turquoise, [0, side * radius * 0.88, 0]);
      cylinder(parent, radius * 0.28, 0.03, steel, [0, side * radius * 0.98, 0]);
    }
  }
  function link(parent, length, thickness) {
    box(parent, [length, thickness, thickness], metal, [length / 2, 0, 0]);
    // Two inset side rails give the long links depth under the studio lighting.
    for (const side of [-1, 1]) {
      box(parent, [length * 0.68, 0.018, thickness * 0.42], graphite,
        [length / 2, side * (thickness / 2 + 0.005), 0]);
      box(parent, [length * 0.46, 0.009, 0.018], turquoise,
        [length / 2, side * (thickness / 2 + 0.016), 0]);
    }
  }

  const baseHeight = Math.max(geometry.baseHeight * 0.64, 0.045);
  cylinder(group, 0.36, 0.075, graphite, [0, 0, 0.0375], 'z');
  cylinder(group, 0.29, baseHeight, metal, [0, 0, baseHeight / 2 + 0.055], 'z');
  cylinder(group, 0.295, 0.028, turquoise, [0, 0, baseHeight + 0.035], 'z');
  for (const x of [-0.23, 0.23]) {
    for (const y of [-0.23, 0.23]) cylinder(group, 0.024, 0.012, steel, [x, y, 0.081], 'z');
  }

  const hip = joint(0, group, 0, geometry.baseHeight);
  box(hip, [0.28, 0.22, Math.max(geometry.baseHeight - baseHeight, 0.1)], graphite,
    [0, 0, -(geometry.baseHeight - baseHeight) / 2]);
  const shoulder = joint(1, hip);
  pitchHub(shoulder, 0.155);
  link(shoulder, geometry.upperArm, 0.17);
  const elbow = joint(2, shoulder, geometry.upperArm);
  pitchHub(elbow, 0.135);
  link(elbow, geometry.forearm, 0.135);
  const wrist = joint(3, elbow, geometry.forearm);
  pitchHub(wrist, 0.105);

  // The target tip is a sibling of the visual gripper, so servo 4/5 never alter IK.
  const endEffector = new Object3D();
  endEffector.name = 'end-effector';
  endEffector.position.x = geometry.tool;
  wrist.add(endEffector);
  const palm = joint(4, wrist, geometry.tool * 0.23);
  cylinder(palm, 0.1, Math.max(geometry.tool * 0.36, 0.04), metal, [0, 0, 0], 'x');
  cylinder(palm, 0.104, 0.025, turquoise, [geometry.tool * 0.12, 0, 0], 'x');
  const fingers = joint(5, palm, geometry.tool * 0.14);
  box(fingers, [0.08, 0.28, 0.09], graphite);
  const fingerLength = Math.max(geometry.tool * 0.63, 0.12);
  const left = new Group();
  left.name = 'finger-left';
  const right = new Group();
  right.name = 'finger-right';
  for (const [finger, side] of [[left, 1], [right, -1]]) {
    fingers.add(finger);
    box(finger, [fingerLength, 0.045, 0.07], steel, [fingerLength / 2, 0, 0]);
    box(finger, [fingerLength * 0.38, 0.018, 0.075], rubber,
      [fingerLength * 0.78, -side * 0.027, 0]);
  }

  let disposed = false;
  function setPose(pose) {
    // Validate the entire snapshot before changing any node; malformed edits keep the last preview.
    if (disposed || pose?.valid !== true ||
        ![0, 1, 2, 3].every(id => finite(pose.modelAnglesDeg?.[id])) ||
        !joints.every(joint => finite(pose.servoAnglesDeg?.[joint.id]) &&
          pose.servoAnglesDeg[joint.id] >= joint.minDeg && pose.servoAnglesDeg[joint.id] <= joint.maxDeg)) return false;
    hip.rotation.z = radians(pose.modelAnglesDeg[0]);
    for (const [node, id] of [[shoulder, 1], [elbow, 2], [wrist, 3]]) {
      node.rotation.y = -radians(pose.modelAnglesDeg[id]);
    }
    palm.rotation.x = radians((pose.servoAnglesDeg[4] - joints[4].offsetDeg) * joints[4].direction) || 0;
    const range = joints[5].maxDeg - joints[5].minDeg;
    let fraction = range === 0 ? 0 : (pose.servoAnglesDeg[5] - joints[5].minDeg) / range;
    if (range > 0 && joints[5].direction === -1) fraction = 1 - fraction;
    const gap = 0.052 + fraction * 0.092;
    left.position.y = gap;
    right.position.y = -gap;
    group.updateMatrixWorld(true);
    return true;
  }
  // A finite neutral gripper is useful even before the first valid pose arrives.
  left.position.y = 0.098;
  right.position.y = -0.098;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const shape of geometries) shape.dispose();
    for (const surface of materials) surface.dispose();
    group.removeFromParent();
  }
  return { group, setPose, endEffector, dispose };
}
