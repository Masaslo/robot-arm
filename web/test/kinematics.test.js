import test from 'node:test';
import assert from 'node:assert/strict';
import { solveIK, forwardKinematics } from '../js/inverse_kinematics.js';

const geometry = { baseHeight: 0.5, upperArm: 1, forearm: 0.8, tool: 0.35 };
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

// Catches an omitted tool offset or a wrong angle convention.
test('straight horizontal reach has zero rotations and the expected endpoint', () => {
  const result = solveIK({ x: 2.15, y: 0, z: 0.5, toolPitchDeg: 0 }, geometry);
  assert.equal(result.valid, true);
  for (const id of [0, 1, 2, 3]) near(result.anglesDeg[id], 0, 1e-5);
  const points = forwardKinematics({ 0: 0, 1: 0, 2: 0, 3: 0 }, geometry);
  assert.deepEqual(points, {
    shoulder: { x: 0, y: 0, z: 0.5 },
    elbow: { x: 1, y: 0, z: 0.5 },
    wrist: { x: 1.8, y: 0, z: 0.5 },
    tip: { x: 2.15, y: 0, z: 0.5 },
  });
});

// Hand-derived: shoulder 90°, elbow -90°, wrist 0°, yaw -90°.
test('elbow-down bent target preserves yaw, pitch, and its endpoint', () => {
  const result = solveIK({ x: 0, y: -1.15, z: 1.5, toolPitchDeg: 0 }, geometry);
  assert.equal(result.valid, true);
  for (const [id, expected] of [[0, -90], [1, 90], [2, -90], [3, 0]]) near(result.anglesDeg[id], expected);
  near(result.anglesDeg[1] + result.anglesDeg[2] + result.anglesDeg[3], 0);
  const { tip } = forwardKinematics(result.anglesDeg, geometry);
  near(tip.x, 0); near(tip.y, -1.15); near(tip.z, 1.5);
});

test('forward kinematics includes a pitched tool after the wrist', () => {
  const { tip, wrist } = forwardKinematics({ 0: 90, 1: 0, 2: 0, 3: 90 }, geometry);
  near(wrist.y, 1.8); near(tip.y, 1.8); near(tip.z, 0.85);
});

test('rejects inner and outer workspace targets without clamping them', () => {
  for (const x of [0.45, 2.150001]) {
    const result = solveIK({ x, y: 0, z: 0.5, toolPitchDeg: 0 }, geometry);
    assert.equal(result.valid, false);
    assert.equal(result.anglesDeg, null);
    assert.match(result.error, /bereik/i);
  }
});

test('rejects undefined base yaw and non-finite or empty coordinates', () => {
  for (const target of [
    { x: 0, y: 0, z: 1, toolPitchDeg: 0 },
    { x: NaN, y: 0, z: 1, toolPitchDeg: 0 },
    { x: '', y: 0, z: 1, toolPitchDeg: 0 },
    { x: 1, y: 0, z: 1, toolPitchDeg: Infinity },
    null,
  ]) {
    assert.equal(solveIK(target, geometry).valid, false);
  }
});

test('invalid geometry fails cleanly and cannot produce forward coordinates', () => {
  for (const invalid of [null, { ...geometry, upperArm: 0 }, { ...geometry, forearm: -1 },
    { ...geometry, tool: NaN }, { ...geometry, baseHeight: -1 }]) {
    assert.equal(solveIK({ x: 1, y: 0, z: 1, toolPitchDeg: 0 }, invalid).valid, false);
    assert.throws(() => forwardKinematics({ 0: 0, 1: 0, 2: 0, 3: 0 }, invalid), /geometrie/i);
  }
});

test('forward kinematics rejects missing and non-finite model rotations', () => {
  assert.throws(() => forwardKinematics({ 0: 0, 1: 0, 2: 0 }, geometry), /hoek/i);
  assert.throws(() => forwardKinematics({ 0: 0, 1: 0, 2: NaN, 3: 0 }, geometry), /hoek/i);
});
