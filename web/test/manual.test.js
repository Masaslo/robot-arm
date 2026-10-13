import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualController } from '../js/manual.js';
import { ARM_CONFIG } from '../js/joint_config.js';

const values = () => ({ x: '1.3', y: '0', z: '1.1', toolPitchDeg: '-25', palmDeg: '90', fingersDeg: '90' });
const calibrated = () => structuredClone({ ...ARM_CONFIG, calibrated: true });

// Removing strict blank handling would turn an emptied Y field into a sendable zero.
test('blank and non-finite inputs retain the previous preview and block sending', () => {
  let current = values();
  const controller = createManualController({ readValues: () => current, config: calibrated() });
  const previous = controller.state.lastValidPose;
  for (const invalid of ['', ' ', 'Infinity', 'nope', null, undefined]) {
    current = { ...values(), y: invalid };
    controller.update();
    assert.equal(controller.state.pose.valid, false);
    assert.equal(controller.state.canSend, false);
    assert.equal(controller.state.lastValidPose, previous);
  }
  current = values();
  controller.update();
  assert.equal(controller.state.pose.valid, true);
});

// Trusting the previous valid pose in submit would transmit stale angles.
test('submit reads the current fields again and never sends a stale valid target', async () => {
  let current = values();
  let requests = 0;
  const controller = createManualController({ readValues: () => current, config: calibrated(),
    send: async () => { requests++; } });
  current = { ...values(), x: '20' };
  await controller.submit();
  assert.equal(requests, 0);
  assert.equal(controller.state.pose.valid, false);
  assert.equal(controller.state.feedback.kind, 'error');
});

// Trusting a previously enabled button would permit changed calibration.
test('submit revalidates calibration and the default demo never sends', async () => {
  const config = calibrated();
  let requests = 0;
  const send = async () => { requests++; };
  const controller = createManualController({ readValues: values, config, send });
  assert.equal(controller.state.canSend, true);
  config.joints[0].direction = 0;
  await controller.submit();
  const demo = createManualController({ readValues: values, send });
  await demo.submit();
  assert.equal(requests, 0);
  assert.equal(controller.state.canSend, false);
  assert.equal(demo.state.canSend, false);
});

// Missing the pending guard would emit duplicate requests; live values must not mutate the snapshot.
test('one submission sends exactly one snapshot and disables sends until acceptance', async () => {
  let current = values();
  let resolve;
  const requests = [];
  const controller = createManualController({ readValues: () => current, config: calibrated(),
    send: angles => { requests.push(angles); return new Promise(done => { resolve = done; }); } });
  const pending = controller.submit();
  assert.equal(controller.state.pending, true);
  assert.equal(controller.state.canSend, false);
  current = { ...values(), palmDeg: '20' };
  await controller.submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0][4], 90);
  assert.deepEqual(Object.keys(requests[0]), ['0', '1', '2', '3', '4', '5']);
  resolve({ message: 'Doel geaccepteerd.' });
  await pending;
  assert.equal(controller.state.pending, false);
  assert.equal(controller.state.feedback.kind, 'success');
  controller.update();
  assert.equal(controller.state.feedback, null);
  assert.equal(controller.state.pose.servoAnglesDeg[4], 20);
});

// A rejected request must restore interaction and make a deliberate retry possible.
test('a failed send exposes the error and supports an explicit retry', async () => {
  let attempts = 0;
  const controller = createManualController({ readValues: values, config: calibrated(),
    send: async () => { if (++attempts === 1) throw new Error('Netwerk niet beschikbaar.'); return { message: 'Aanvraag ontvangen.' }; } });
  await controller.submit();
  assert.equal(controller.state.feedback.kind, 'error');
  assert.match(controller.state.feedback.message, /Netwerk/);
  assert.equal(controller.state.pending, false);
  assert.equal(controller.state.canSend, true);
  await controller.submit();
  assert.equal(attempts, 2);
  assert.equal(controller.state.feedback.kind, 'success');
});

// Losing WebGL must also block a programmatic form submission.
test('preview failure blocks transmission even with valid calibrated angles', async () => {
  let requests = 0;
  const controller = createManualController({ readValues: values, config: calibrated(),
    send: async () => { requests++; } });
  controller.setPreviewReady(false);
  await controller.submit();
  assert.equal(requests, 0);
  assert.equal(controller.state.canSend, false);
  assert.equal(controller.state.feedback.kind, 'error');
});
