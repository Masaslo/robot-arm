import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createFirmwareLink} from '../firmware_link.js';

test('serializes servo IDs unchanged in the TCP command', async t => {
  const {server, sendTarget} = createFirmwareLink();
  const clientSockets = new Set();
  server.on('connection', socket => {
    clientSockets.add(socket);
    socket.on('close', () => clientSockets.delete(socket));
    socket.on('error', () => {});
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const client = net.createConnection(server.address().port, '127.0.0.1');
  t.after(async () => {
    client.destroy();
    for (const socket of clientSockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });

  let received = '';
  client.on('data', bytes => {
    received += bytes.toString();
    if (received.endsWith('\n')) client.write('OK\n');
  });
  for (let servoId = 0; servoId < 6; servoId += 1) {
    const previousLength = received.length;
    await sendTarget(servoId, 90 + servoId);
    assert.equal(received.slice(previousLength), `${servoId}:${90 + servoId}\n`);
  }
});
