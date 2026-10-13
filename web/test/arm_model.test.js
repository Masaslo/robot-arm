import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createArmModel } from '../js/arm_model.js';
import { ARM_CONFIG } from '../js/joint_config.js';
import { forwardKinematics } from '../js/inverse_kinematics.js';

const pose = (angles = {}, palm = 90, fingers = 90) => ({
  valid: true,
  modelAnglesDeg: { 0: 0, 1: 0, 2: 0, 3: 0, ...angles },
  servoAnglesDeg: { 0: 90, 1: 0, 2: 180, 3: 90, 4: palm, 5: fingers },
});
function closePoint(actual, expected) {
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9,
      `${axis}: expected ${expected[axis]}, got ${actual[axis]}`);
  }
}
const worldPosition = node => node.getWorldPosition(new Vector3());

test('view module can be imported without a document or WebGL context', async () => {
  const view = await import('../js/robot_arm.js');
  assert.equal(typeof view.createRobotArmView, 'function');
});

test('neutral Three hierarchy extends along X at shoulder height', t => {
  const arm = createArmModel();
  t.after(() => arm.dispose());
  arm.setPose(pose());
  closePoint(worldPosition(arm.endEffector), { x: 2.15, y: 0, z: 0.5 });
  closePoint(worldPosition(arm.group.getObjectByName('joint-1')), { x: 0, y: 0, z: 0.5 });
});

test('yaw and positive shoulder bend compose in the actual joint hierarchy', t => {
  const arm = createArmModel();
  t.after(() => arm.dispose());
  arm.setPose(pose({ 0: 90, 1: 90, 2: -90 }));
  closePoint(worldPosition(arm.group.getObjectByName('joint-2')), { x: 0, y: 0, z: 1.5 });
  closePoint(worldPosition(arm.group.getObjectByName('joint-3')), { x: 0, y: 0.8, z: 1.5 });
  closePoint(worldPosition(arm.endEffector), { x: 0, y: 1.15, z: 1.5 });
});

test('nonzero wrist bend and negative yaw match the separate FK boundary', t => {
  const config = structuredClone(ARM_CONFIG);
  config.geometry = { baseHeight: 0.7, upperArm: 1.2, forearm: 0.65, tool: 0.4 };
  const arm = createArmModel(config);
  t.after(() => arm.dispose());
  const next = pose({ 0: -35, 1: 40, 2: -75, 3: 15 });
  arm.setPose(next);
  const expected = forwardKinematics(next.modelAnglesDeg, config.geometry);
  closePoint(worldPosition(arm.group.getObjectByName('joint-2')), expected.elbow);
  closePoint(worldPosition(arm.group.getObjectByName('joint-3')), expected.wrist);
  closePoint(worldPosition(arm.endEffector), expected.tip);
});

test('palm rolls from its servo offset and fingers move independently without moving the tip', t => {
  const config = structuredClone(ARM_CONFIG);
  config.joints[4].offsetDeg = 70;
  config.joints[4].direction = -1;
  const arm = createArmModel(config);
  t.after(() => arm.dispose());
  const next = pose({ 0: 20, 1: 50, 2: -60, 3: 10 }, 70, 0);
  const original = structuredClone(next);
  arm.setPose(next);
  const tip = worldPosition(arm.endEffector);
  const left = arm.group.getObjectByName('finger-left');
  const right = arm.group.getObjectByName('finger-right');
  const closedLeft = left.position.y;
  const closedRight = right.position.y;
  arm.setPose({ ...next, servoAnglesDeg: { ...next.servoAnglesDeg, 4: 100 } });
  assert.ok(Math.abs(arm.group.getObjectByName('joint-4').rotation.x + Math.PI / 6) < 1e-12);
  assert.equal(left.position.y, closedLeft);
  assert.equal(right.position.y, closedRight);
  closePoint(worldPosition(arm.endEffector), tip);
  arm.setPose({ ...next, servoAnglesDeg: { ...next.servoAnglesDeg, 5: 180 } });
  assert.ok(left.position.y > closedLeft);
  assert.ok(right.position.y < closedRight);
  assert.equal(arm.group.getObjectByName('joint-4').rotation.x, 0);
  closePoint(worldPosition(arm.endEffector), tip);
  assert.deepEqual(next, original, 'the caller owns the pose object');
});

test('finger range and direction come from configuration, including fixed servos', t => {
  const config = structuredClone(ARM_CONFIG);
  Object.assign(config.joints[5], { minDeg: 30, maxDeg: 120, direction: -1 });
  const arm = createArmModel(config);
  t.after(() => arm.dispose());
  arm.setPose(pose({}, 90, 30));
  const open = arm.group.getObjectByName('finger-left').position.y;
  arm.setPose(pose({}, 90, 120));
  assert.ok(arm.group.getObjectByName('finger-left').position.y < open);

  Object.assign(config.joints[5], { minDeg: 60, maxDeg: 60 });
  const fixedArm = createArmModel(config);
  t.after(() => fixedArm.dispose());
  fixedArm.setPose(pose({}, 90, 60));
  assert.ok(Number.isFinite(fixedArm.group.getObjectByName('finger-left').position.y));
});

test('invalid poses preserve every joint transform and the last valid tip', t => {
  const arm = createArmModel();
  t.after(() => arm.dispose());
  arm.setPose(pose({ 0: 25, 1: 70, 2: -90, 3: 15 }, 120, 60));
  arm.group.updateMatrixWorld(true);
  const before = [];
  arm.group.traverse(node => before.push(node.matrixWorld.toArray()));
  for (const invalid of [null, { valid: false },
    pose({ 1: NaN }), pose({ 2: Infinity }), pose({}, 181), pose({}, 90, -1),
    { ...pose(), servoAnglesDeg: { 4: 90, 5: 90 } }]) {
    assert.equal(arm.setPose(invalid), false);
    arm.group.updateMatrixWorld(true);
    const after = [];
    arm.group.traverse(node => after.push(node.matrixWorld.toArray()));
    assert.deepEqual(after, before);
  }
});

test('dispose releases each owned geometry/material once and prevents later updates', () => {
  const arm = createArmModel();
  const resources = new Set();
  arm.group.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    if (node.material) resources.add(node.material);
  });
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => {
    counts.set(resource, (counts.get(resource) ?? 0) + 1);
  });
  arm.dispose();
  arm.dispose();
  assert.equal(counts.size, resources.size);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(arm.setPose(pose({ 0: 90 })), false);
});
