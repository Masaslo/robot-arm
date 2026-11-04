import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createArmModel } from '../js/arm_view.js';
import { ARM_SETTINGS, createRobotArm, toRadians } from '../js/robot_arm.js';

const angles = extra => ({ hip: 0, shoulder: 0, elbow: 0, wrist: 0, palm: 0, fingers: 0, ...extra });
const worldPosition = node => node.getWorldPosition(new Vector3());
function closePoint(actual, expected) {
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9,
    `${axis}: expected ${expected[axis]}, got ${actual[axis]}`);
}
function model(t, dimensions = ARM_SETTINGS.dimensions) {
  const arm = createArmModel(dimensions);
  t.after(() => arm.dispose());
  arm.setAngles(angles());
  return arm;
}

test('arm and view modules can be imported without a document or WebGL', async () => {
  assert.equal(typeof (await import('../js/robot_arm.js')).createRobotArm, 'function');
  assert.equal(typeof (await import('../js/arm_view.js')).createArmView, 'function');
});

test('neutral named hierarchy extends along X at shoulder height', t => {
  const arm = model(t);
  closePoint(worldPosition(arm.endEffector), { x: 2.15, y: 0, z: 0.5 });
  closePoint(worldPosition(arm.group.getObjectByName('shoulder')), { x: 0, y: 0, z: 0.5 });
});

test('hip yaw and positive shoulder pitch compose in the actual hierarchy', t => {
  const arm = model(t);
  arm.setAngles(angles({ hip: Math.PI / 2, shoulder: Math.PI / 2, elbow: -Math.PI / 2 }));
  closePoint(worldPosition(arm.group.getObjectByName('elbow')), { x: 0, y: 0, z: 1.5 });
  closePoint(worldPosition(arm.group.getObjectByName('wrist')), { x: 0, y: 0.8, z: 1.5 });
  closePoint(worldPosition(arm.endEffector), { x: 0, y: 1.15, z: 1.5 });
});

test('relative wrist and negative hip yaw follow changed arm measurements', t => {
  const dimensions = { baseHeight: 0.7, upperArm: 1.2, forearm: 0.65, tool: 0.4 };
  const arm = model(t, dimensions);
  const next = angles({ hip: toRadians(-35), shoulder: toRadians(40), elbow: toRadians(-75), wrist: toRadians(15) });
  arm.setAngles(next);
  const forearmPitch = next.shoulder + next.elbow;
  const toolPitch = forearmPitch + next.wrist;
  const radial = dimensions.upperArm * Math.cos(next.shoulder) + dimensions.forearm * Math.cos(forearmPitch) +
    dimensions.tool * Math.cos(toolPitch);
  closePoint(worldPosition(arm.endEffector), { x: radial * Math.cos(next.hip), y: radial * Math.sin(next.hip),
    z: dimensions.baseHeight + dimensions.upperArm * Math.sin(next.shoulder) +
      dimensions.forearm * Math.sin(forearmPitch) + dimensions.tool * Math.sin(toolPitch) });
});

test('palm and fingers move independently without changing the mathematical tip', t => {
  const arm = model(t);
  const next = angles({ hip: toRadians(20), shoulder: toRadians(50), elbow: toRadians(-60), wrist: toRadians(10),
    fingers: -Math.PI / 2 });
  arm.setAngles(next);
  const tip = worldPosition(arm.endEffector);
  const left = arm.group.getObjectByName('finger-left');
  const closed = left.position.y;
  arm.setAngles({ ...next, palm: -Math.PI / 6 });
  assert.equal(arm.group.getObjectByName('palm').rotation.x, -Math.PI / 6);
  assert.equal(left.position.y, closed);
  closePoint(worldPosition(arm.endEffector), tip);
  arm.setAngles({ ...next, palm: -Math.PI / 6, fingers: Math.PI / 2 });
  assert.ok(left.position.y > closed);
  assert.equal(arm.group.getObjectByName('palm').rotation.x, -Math.PI / 6);
  closePoint(worldPosition(arm.endEffector), tip);
});

test('finger angle controls symmetric opening around its neutral position', t => {
  const arm = model(t);
  const left = arm.group.getObjectByName('finger-left');
  const right = arm.group.getObjectByName('finger-right');
  arm.setAngles(angles({ fingers: -Math.PI / 2 }));
  const closed = left.position.y;
  arm.setAngles(angles());
  assert.ok(left.position.y > closed);
  const neutral = left.position.y;
  arm.setAngles(angles({ fingers: Math.PI / 2 }));
  assert.ok(left.position.y > neutral);
  assert.equal(left.position.y, -right.position.y);
});

test('the public arm rejects invalid updates before changing any model transform', t => {
  const drawing = model(t);
  const arm = createRobotArm();
  const unsubscribe = arm.onChange(next => drawing.setAngles(next));
  t.after(() => { unsubscribe(); arm.dispose(); });
  arm.setAngles({ hip: toRadians(25), shoulder: toRadians(70), elbow: -Math.PI / 2 });
  const before = [];
  drawing.group.traverse(node => before.push(node.matrixWorld.toArray()));
  for (const invalid of [{ hip: 0, shoulder: NaN }, { hip: 0, palm: Math.PI }, { unknown: 1 }]) {
    assert.throws(() => arm.setAngles(invalid));
    drawing.group.updateMatrixWorld(true);
    const after = [];
    drawing.group.traverse(node => after.push(node.matrixWorld.toArray()));
    assert.deepEqual(after, before);
  }
});

test('dispose releases each drawing resource once and ignores later drawing calls', () => {
  const arm = createArmModel(ARM_SETTINGS.dimensions);
  const resources = new Set();
  arm.group.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    if (node.material) resources.add(node.material);
  });
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => {
    counts.set(resource, (counts.get(resource) ?? 0) + 1);
  });
  arm.dispose(); arm.dispose();
  assert.equal(counts.size, resources.size);
  assert.ok([...counts.values()].every(count => count === 1));
  arm.setAngles(angles({ hip: Math.PI / 2 }));
  assert.equal(arm.group.getObjectByName('hip').rotation.z, 0);
});
