import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.js';

async function fixture(t, sendTarget = async () => {}) {
  const http = createApp({sendTarget}).listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(async () => {
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  });
  const url = `http://127.0.0.1:${http.address().port}`;
  return {
    post: (path, body, raw = false) => fetch(`${url}${path}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: raw ? body : JSON.stringify(body),
    }),
    get: path => fetch(`${url}${path}`),
  };
}

test('single-servo endpoint forwards a servo ID and angle', async t => {
  const targets = [];
  const f = await fixture(t, async (servoId, angle) => targets.push([servoId, angle]));
  assert.equal((await f.post('/api/servo', {servoId: 5, angle: 90})).status, 200);
  assert.deepEqual(targets, [[5, 90]]);
});

test('batch endpoint forwards all six IDs in order', async t => {
  const targets = [];
  const f = await fixture(t, async (servoId, angle) => targets.push([servoId, angle]));
  const anglesDeg = {0: 10, 1: 20, 2: 30, 3: 40, 4: 50, 5: 60};
  assert.equal((await f.post('/api/arm/angles', {anglesDeg})).status, 200);
  assert.deepEqual(targets, [[0, 10], [1, 20], [2, 30], [3, 40], [4, 50], [5, 60]]);
});

test('rejects invalid IDs and angles before forwarding any targets', async t => {
  let forwarded = 0;
  const f = await fixture(t, async () => { forwarded += 1; });
  for (const body of [
    {servoId: -1, angle: 90}, {servoId: 6, angle: 90}, {servoId: 1.5, angle: 90},
    {servoId: '1', angle: 90}, {servoId: 1, angle: -1}, {servoId: 1, angle: 181},
    {servoId: 1, angle: 90.5}, {}, null,
  ]) {
    assert.equal((await f.post('/api/servo', body)).status, 400, JSON.stringify(body));
  }
  const valid = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5};
  for (const anglesDeg of [
    {...valid, 6: 90}, {...valid, 5: 181}, {...valid, 5: 5.5}, {0: 0, 1: 1},
    ['0', '1', '2', '3', '4', '5'],
  ]) {
    assert.equal((await f.post('/api/arm/angles', {anglesDeg})).status, 400);
  }
  assert.equal((await f.post('/api/servo', '{', true)).status, 400);
  assert.equal(forwarded, 0);
});

test('firmware rejection becomes an HTTP error', async t => {
  const f = await fixture(t, async () => { throw Object.assign(new Error('Doel geweigerd.'), {status: 502}); });
  assert.equal((await f.post('/api/servo', {servoId: 2, angle: 90})).status, 502);
});

test('serves the built browser app from the same origin', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/js/robot_arm.js', '/style/style.css']) {
    const response = await f.get(path);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 0);
  }
});
