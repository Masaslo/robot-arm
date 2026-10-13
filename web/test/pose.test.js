import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPose } from '../js/pose.js';
import { ARM_CONFIG, INITIAL_TARGET, INITIAL_PALM_DEG, INITIAL_FINGERS_DEG } from '../js/joint_config.js';

const bent = { x: 1.15, y: 0, z: 1.5, toolPitchDeg: 0 };
const calibrated = () => ({
  calibrated: true,
  geometry: { baseHeight: 0.5, upperArm: 1, forearm: 0.8, tool: 0.35 },
  joints: ['Heup', 'Schouder', 'Elleboog', 'Pols', 'Palm', 'Vingers'].map((name, id) => ({
    id, name, minDeg: 0, maxDeg: 180, offsetDeg: [90, 0, 180, 90, 90, 90][id], direction: 1,
  })),
});

test('default demo provides a usable preview while blocking transmission', () => {
  const pose = buildPose(INITIAL_TARGET, INITIAL_PALM_DEG, INITIAL_FINGERS_DEG);
  assert.equal(pose.valid, true);
  assert.equal(pose.canSend, false);
  assert.match(pose.blockedReason, /kalibr/i);
  assert.deepEqual(Object.keys(pose.servoAnglesDeg), ['0', '1', '2', '3', '4', '5']);
  assert.ok(Object.values(pose.servoAnglesDeg).every(Number.isInteger));
  assert.equal(ARM_CONFIG.calibrated, false);
});

// Catches incorrect offset/direction conversion or sliders converted a second time.
test('calibrated bent pose sends integer servo degrees while preserving model precision', () => {
  const pose = buildPose(bent, 32.4, 121.7, calibrated());
  assert.equal(pose.valid, true);
  assert.equal(pose.canSend, true);
  assert.equal(pose.error, null);
  assert.equal(pose.blockedReason, null);
  assert.deepEqual(pose.servoAnglesDeg, { 0: 90, 1: 90, 2: 90, 3: 90, 4: 32, 5: 122 });
  assert.ok(Math.abs(pose.modelAnglesDeg[2] + 90) < 1e-8);
  const fractional = buildPose(INITIAL_TARGET, 90, 90, calibrated());
  assert.equal(fractional.canSend, true);
  assert.notEqual(fractional.modelAnglesDeg[1], Math.round(fractional.modelAnglesDeg[1]));
});

test('negative direction reverses the corresponding mathematical rotation', () => {
  const config = calibrated();
  config.joints[0].direction = -1;
  const pose = buildPose({ ...bent, x: 0, y: 1.15 }, 90, 90, config);
  assert.equal(pose.canSend, true);
  assert.equal(pose.servoAnglesDeg[0], 0);
  assert.equal(pose.modelAnglesDeg[0], 90);
});

test('fractional out-of-range values are rejected before integer rounding', () => {
  for (const [palm, fingers] of [[180.1, 90], [-0.1, 90], [90, 180.1]]) {
    const pose = buildPose(bent, palm, fingers, calibrated());
    assert.equal(pose.valid, false);
    assert.equal(pose.canSend, false);
    assert.equal(pose.servoAnglesDeg, null);
    assert.match(pose.error, /grens|grenz|bereik/i);
  }
  const config = calibrated();
  config.joints[0].offsetDeg = 180.1;
  assert.equal(buildPose(bent, 90, 90, config).valid, false);
});

test('rounded output must still respect a fractional calibrated limit', () => {
  const config = calibrated();
  config.joints[4].maxDeg = 89.7;
  assert.equal(buildPose(bent, 89.6, 90, config).canSend, false);
  assert.equal(buildPose(bent, 89.4, 90, config).canSend, true);
});

test('invalid calibration cannot be enabled by a true calibrated flag', () => {
  const mutations = [
    c => c.joints.pop(),
    c => c.joints.push({ ...c.joints[0], id: 6 }),
    c => c.joints[5].id = 4,
    c => c.joints[5].id = '5',
    c => c.joints[0].direction = 0,
    c => c.joints[0].offsetDeg = NaN,
    c => c.joints[0].minDeg = -1,
    c => c.joints[0].maxDeg = 181,
    c => c.joints[0].minDeg = 181,
    c => c.geometry.upperArm = 0,
  ];
  for (const mutate of mutations) {
    const config = calibrated(); mutate(config);
    const pose = buildPose(bent, 90, 90, config);
    assert.equal(pose.valid, false);
    assert.equal(pose.canSend, false);
    assert.equal(pose.servoAnglesDeg, null);
    assert.ok(pose.error);
  }
});

test('malformed config, unreachable goals and invalid sliders never produce sendable targets', () => {
  for (const config of [null, {}, { ...calibrated(), calibrated: 'true' }]) {
    assert.equal(buildPose(bent, 90, 90, config).canSend, false);
  }
  for (const value of ['', NaN, Infinity, null, '90']) {
    assert.equal(buildPose(bent, value, 90, calibrated()).valid, false);
    assert.equal(buildPose(bent, 90, value, calibrated()).valid, false);
  }
  const pose = buildPose({ ...bent, x: 10 }, 90, 90, calibrated());
  assert.equal(pose.valid, false);
  assert.equal(pose.modelAnglesDeg, null);
  assert.equal(pose.canSend, false);
});
