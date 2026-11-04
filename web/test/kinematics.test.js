import test from 'node:test';
import assert from 'node:assert/strict';
import { createRobotArm, ARM_SETTINGS } from '../js/robot_arm.js';
import {
  projectToArmPlane, solveIK, IK_COMPLETE, getArmPoints,
  calculateAngleToPoint, calculateRotation, calculateDistance,
  solveWrist, solveElbow, solveShoulder,
} from '../js/inverse_kinematics.js';

const target = { x: 1.3, y: 0, z: 1.1 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);
const tolerance = arm => (arm.dimensions.upperArm + arm.dimensions.forearm + arm.dimensions.tool) * 0.001;

// Observe the applied arm angles instead of expecting return values from joint solvers.
test('hip solver updates the angle in radians in the XY plane', t => {
  const arm = createRobotArm(); t.after(() => arm.dispose());
  for (const [x, y, expected] of [[1.3, 0, 0], [0, 1.3, Math.PI / 2],
    [0, -1.3, -Math.PI / 2], [1.3, 1.3, Math.PI / 4]]) {
    solveIK(arm, { ...target, x, y });
    assert.equal(arm.getAngles().hip, expected);
  }
});

test('side plane contains distance from the base and height above the shoulder', () => {
  assert.deepEqual(projectToArmPlane({ x: 3, y: 4, z: 2 }, 0.5), { distance: 5, height: 1.5 });
  assert.deepEqual(projectToArmPlane({ x: 3, y: -4, z: 0 }, 0.5), { distance: 5, height: -0.5 });
});

test('each CCD step aligns the line from that joint to the actual arm tip', t => {
  const settings = structuredClone(ARM_SETTINGS);
  // Geef de schouder voor deze losse stappen ruimte in beide draairichtingen.
  settings.joints.shoulder.offset = 90;
  const arm = createRobotArm(null, settings); t.after(() => arm.dispose());
  solveIK(arm, { x: 2.15, y: 0, z: 0.5 });
  const point = { x: 2, y: 0.1 };
  for (const [name, solve] of [['wrist', solveWrist], ['elbow', solveElbow], ['shoulder', solveShoulder]]) {
    solve(point, arm.dimensions, arm.joints[name]);
    const positions = getArmPoints(arm.dimensions);
    near(calculateRotation(positions[name], positions.end, point), 0);
  }
  near(calculateAngleToPoint({ x: 0, y: 0 }, { x: 0, y: 1 }), Math.PI / 2);
  near(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(calculateRotation(point, point, point), 0);
});

test('CCD reaches XYZ targets within tolerance, respects limits and preserves the hand', t => {
  const arm = createRobotArm(); t.after(() => arm.dispose());
  arm.turnJoint('palm', Math.PI / 6);
  for (const goal of [target, { x: 1.5, y: 0, z: 1.3 }, { x: 1.2, y: 0.3, z: 1.2 }]) {
    const plane = solveIK(arm, goal);
    const positions = getArmPoints(arm.dimensions);
    assert.ok(calculateDistance(positions.end, { x: plane.distance, y: plane.height }) <= tolerance(arm));
    assert.equal(arm.getAngles().palm, Math.PI / 6);
    assert.equal(arm.getAngles().fingers, 0);
    for (const value of Object.values(arm.getServoAngles())) {
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 180);
    }
  }
  assert.equal(IK_COMPLETE, true);
});

test('undefined yaw, blank and non-finite targets retain the previous arm stand', t => {
  const arm = createRobotArm(); t.after(() => arm.dispose());
  arm.turnJoint('hip', Math.PI / 4);
  const before = arm.getAngles();
  for (const invalid of [null, { ...target, x: 0, y: 0 }, { ...target, x: NaN },
    { ...target, y: '' }, { ...target, z: Infinity }]) {
    assert.throws(() => solveIK(arm, invalid));
    assert.deepEqual(arm.getAngles(), before);
  }
});

test('unreachable goals, hip limits and invalid hand edits retain the previous stand', t => {
  const arm = createRobotArm(); t.after(() => arm.dispose());
  solveIK(arm, target);
  const before = arm.getAngles();
  assert.throws(() => solveIK(arm, { ...target, x: 100 }), /bereik/);
  assert.throws(() => solveIK(arm, { ...target, x: -1.3 }), /grenzen/);
  assert.throws(() => solveIK(arm, target, { fingers: Infinity }));
  assert.deepEqual(arm.getAngles(), before);
});

test('overflow is rejected and a zero-length tool does not create undefined wrist angles', t => {
  const arm = createRobotArm(); t.after(() => arm.dispose());
  assert.throws(() => solveIK(arm, { ...target, x: 1.7e308, y: 1.7e308 }), /2D/);
  const settings = structuredClone(ARM_SETTINGS);
  settings.dimensions.tool = 0;
  const noTool = createRobotArm(null, settings); t.after(() => noTool.dispose());
  const plane = solveIK(noTool, { x: 1.2, y: 0, z: 1 });
  assert.ok(Object.values(noTool.getAngles()).every(Number.isFinite));
  const positions = getArmPoints(noTool.dimensions);
  assert.ok(calculateDistance(positions.end, { x: plane.distance, y: plane.height }) <= tolerance(noTool));
});
