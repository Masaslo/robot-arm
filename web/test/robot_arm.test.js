import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_SETTINGS, createRobotArm, toRadians } from '../js/robot_arm.js';

const settings = () => structuredClone(ARM_SETTINGS);

test('demo arm owns six named angles and derives integer servo-ID angles', t => {
  const arm = createRobotArm();
  t.after(() => arm.dispose());
  assert.equal(arm.calibrated, false);
  assert.equal(arm.previewReady, false);
  assert.deepEqual(arm.getAngles(), { hip: 0, shoulder: 0, elbow: 0, wrist: 0, palm: 0, fingers: 0 });
  assert.deepEqual(arm.getServoAngles(), { 0: 90, 1: 0, 2: 180, 3: 90, 4: 90, 5: 90 });
});

test('servoId in settings selects the outgoing angle key', t => {
  const config = settings();
  config.joints.hip.servoId = 1;
  config.joints.shoulder.servoId = 0;
  const arm = createRobotArm(null, config);
  t.after(() => arm.dispose());
  assert.deepEqual(arm.getServoAngles(), { 0: 0, 1: 90, 2: 180, 3: 90, 4: 90, 5: 90 });
});

test('turnJoint is absolute, uses radians and emits independent snapshots', t => {
  const arm = createRobotArm();
  t.after(() => arm.dispose());
  const seen = [];
  const unsubscribe = arm.onChange(angles => seen.push(angles));
  arm.turnJoint('hip', Math.PI / 4);
  arm.turnJoint('hip', Math.PI / 4);
  assert.equal(arm.getAngles().hip, Math.PI / 4);
  assert.equal(arm.getServoAngles()[0], 135);
  assert.equal(seen.length, 1);
  seen[0].hip = 0;
  const snapshot = arm.getAngles();
  snapshot.hip = 0;
  assert.equal(arm.getAngles().hip, Math.PI / 4);
  unsubscribe();
  arm.turnJoint('hip', 0);
  assert.equal(seen.length, 1);
});

test('mapping preserves precision, reverses direction and handles palm/fingers uniformly', t => {
  const config = settings();
  config.joints.hip.direction = -1;
  const arm = createRobotArm(null, config);
  t.after(() => arm.dispose());
  arm.setAngles({ hip: Math.PI / 2, shoulder: toRadians(40.25), elbow: -Math.PI / 2,
    palm: toRadians(-57.6), fingers: toRadians(31.7) });
  assert.deepEqual(arm.getServoAngles(), { 0: 0, 1: 40, 2: 90, 3: 90, 4: 32, 5: 122 });
  assert.equal(arm.getAngles().shoulder, toRadians(40.25));
});

test('a bad named angle rejects the whole batch and retains the previous stand', t => {
  const arm = createRobotArm();
  t.after(() => arm.dispose());
  arm.turnJoint('hip', Math.PI / 4);
  const before = arm.getAngles();
  for (const change of [{ hip: 0, shoulder: NaN }, { hip: 0, elbow: Infinity },
    { hip: 0, wrist: toRadians(90.1) }, { hip: 0, palm: toRadians(-90.1) },
    { hip: 0, fingers: toRadians(90.1) }, { hip: 0, unknown: 1 }, { 0: 1 }, null, []]) {
    assert.throws(() => arm.setAngles(change));
    assert.deepEqual(arm.getAngles(), before);
  }
});

test('both the unrounded angle and rounded command respect servo limits', t => {
  const config = settings();
  config.joints.palm.max = 90.7;
  const arm = createRobotArm(null, config);
  t.after(() => arm.dispose());
  assert.throws(() => arm.turnJoint('palm', toRadians(0.6)), /grenzen/);
  assert.throws(() => arm.turnJoint('palm', toRadians(0.8)), /grenzen/);
  arm.turnJoint('palm', toRadians(0.4));
  assert.equal(arm.getServoAngles()[4], 90);
});

test('malformed measurements and servo settings are rejected at arm creation', () => {
  for (const change of [
    c => { c.dimensions.upperArm = 0; }, c => { c.dimensions.forearm = -1; },
    c => { c.dimensions.tool = NaN; }, c => { c.calibrated = 'true'; },
    c => { delete c.joints.wrist; }, c => { c.joints.fingers.servoId = 4; },
    c => { c.joints.hip.direction = 0; }, c => { c.joints.hip.offset = NaN; },
    c => { c.joints.hip.min = -1; }, c => { c.joints.hip.max = 181; },
  ]) {
    const config = settings(); change(config);
    assert.throws(() => createRobotArm(null, config));
  }
});

test('arm copies its settings and dispose prevents later changes', () => {
  const config = settings();
  const arm = createRobotArm(null, config);
  config.joints.hip.direction = -1;
  arm.turnJoint('hip', Math.PI / 4);
  assert.equal(arm.getServoAngles()[0], 135);
  assert.throws(() => { arm.joints.hip.offset = 0; }, TypeError);
  assert.throws(() => { arm.joints = {}; }, TypeError);
  assert.throws(() => { arm.dimensions = {}; }, TypeError);
  assert.throws(() => { arm.calibrated = true; }, TypeError);
  arm.dispose(); arm.dispose();
  assert.throws(() => arm.turnJoint('hip', 0), /opgeruimd/);
});
