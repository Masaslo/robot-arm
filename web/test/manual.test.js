import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualController } from '../js/manual.js';
import { ARM_SETTINGS, createRobotArm } from '../js/robot_arm.js';

const values = () => ({ x: '1.3', y: '0', z: '1.1', palmDeg: '90', fingersDeg: '90' });

// Model the availability signal without a browser or WebGL; angles still use the real arm.
function fixture(t, calibrated = true) {
  const realArm = createRobotArm(null, { ...ARM_SETTINGS, calibrated });
  let ready = true;
  const arm = Object.create(realArm, { previewReady: { get: () => ready } });
  t.after(() => realArm.dispose());
  return { arm, losePreview: () => { ready = false; } };
}

test('invalid inputs retain the actual arm stand and block sending', t => {
  const { arm } = fixture(t);
  let current = values();
  const controller = createManualController({ arm, readValues: () => current, ikComplete: true,
    onChange: (state, { syncHand }) => {
      if (syncHand) current = { ...current, palmDeg: String(arm.getServoAngles()[4]), fingersDeg: String(arm.getServoAngles()[5]) };
    } });
  t.after(() => controller.dispose());
  const before = arm.getAngles();
  for (const invalid of ['', ' ', 'Infinity', 'nope', null, undefined]) {
    current = { ...values(), y: invalid }; controller.update();
    assert.equal(controller.state.valid, false);
    assert.equal(controller.state.canSend, false);
    assert.deepEqual(arm.getAngles(), before);
  }
  arm.turnJoint('palm', Math.PI / 4);
  assert.equal(current.palmDeg, '135');
  current = { ...current, y: '0' }; controller.update();
  assert.equal(controller.state.valid, true);
  assert.equal(arm.getServoAngles()[4], 135);
});

test('submit detects silently edited inputs without recalculating or overwriting direct arm changes', async t => {
  const { arm } = fixture(t);
  let current = values();
  const requests = [];
  const controller = createManualController({ arm, readValues: () => current, ikComplete: true,
    send: async angles => { requests.push(angles); } });
  t.after(() => controller.dispose());
  arm.turnJoint('shoulder', Math.PI / 4);
  await controller.submit();
  assert.equal(requests[0][1], 45);
  assert.equal(arm.getAngles().shoulder, Math.PI / 4);
  current = { ...values(), x: '20' };
  await controller.submit();
  assert.equal(requests.length, 1);
  assert.equal(controller.state.valid, false);
  assert.equal(arm.getAngles().shoulder, Math.PI / 4);
});

test('demo settings allow sending while incomplete IK blocks programmatic sends', async t => {
  let requests = 0;
  const send = async () => { requests++; };
  const demo = createManualController({ arm: fixture(t, false).arm, readValues: values, ikComplete: true, send });
  const incomplete = createManualController({ arm: fixture(t).arm, readValues: values, ikComplete: false, send });
  t.after(() => { demo.dispose(); incomplete.dispose(); });
  await demo.submit();
  assert.equal(requests, 1);
  await incomplete.submit();
  assert.equal(requests, 1);
  assert.equal(demo.state.canSend, true);
  assert.equal(incomplete.state.canSend, false);
  assert.equal(demo.state.blockedReason, null);
  assert.match(incomplete.state.blockedReason, /IK/);
});

test('a submission sends one immutable snapshot and sliders leave other joints alone', async t => {
  const { arm } = fixture(t);
  let current = values();
  let resolve;
  const requests = [];
  const controller = createManualController({ arm, readValues: () => current, ikComplete: true,
    send: angles => { requests.push(angles); return new Promise(done => { resolve = done; }); } });
  t.after(() => controller.dispose());
  arm.turnJoint('shoulder', Math.PI / 4);
  const pending = controller.submit();
  assert.equal(controller.state.pending, true);
  current = { ...values(), palmDeg: '20' };
  controller.update('palmDeg'); await controller.submit();
  assert.equal(requests.length, 1); assert.equal(requests[0][4], 90);
  assert.equal(controller.state.canSend, false);
  arm.turnJoint('hip', Math.PI / 4);
  assert.equal(requests[0][0], 90);
  resolve(); await pending;
  controller.update('palmDeg');
  assert.equal(arm.getServoAngles()[4], 20);
  assert.equal(arm.getAngles().shoulder, Math.PI / 4);
  assert.equal(arm.getAngles().hip, Math.PI / 4);
});

test('failed sends restore interaction and support explicit retry', async t => {
  const { arm } = fixture(t);
  let attempts = 0;
  const controller = createManualController({ arm, readValues: values, ikComplete: true,
    send: async () => { if (++attempts === 1) throw new Error('Netwerk niet beschikbaar.'); } });
  t.after(() => controller.dispose());
  await controller.submit();
  assert.equal(controller.state.feedback.kind, 'error');
  assert.equal(controller.state.pending, false); assert.equal(controller.state.canSend, true);
  await controller.submit();
  assert.equal(attempts, 2); assert.equal(controller.state.feedback.kind, 'success');
});

test('preview loss blocks sends and a disposed controller releases its subscription', async t => {
  const { arm, losePreview } = fixture(t);
  let requests = 0;
  let changes = 0;
  const controller = createManualController({ arm, readValues: values, ikComplete: true,
    send: async () => { requests++; }, onChange: () => { changes++; } });
  losePreview(); await controller.submit();
  assert.equal(requests, 0); assert.equal(controller.state.canSend, false);
  controller.dispose();
  const before = changes;
  arm.turnJoint('hip', Math.PI / 4);
  assert.equal(changes, before);
  await controller.submit(); assert.equal(requests, 0);
});
