import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createApp} from '../app.js';

async function fixture(t, reply, options = {}) {
  const sockets = new Set();
  const tcp = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.once('data', data => reply(socket, data.toString()));
  });
  await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const app = createApp({host:'127.0.0.1', port:tcp.address().port, timeoutMs:100, ...options});
  const http = app.listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => http.close(resolve)), new Promise(resolve => tcp.close(resolve))]);
  });
  const url = `http://127.0.0.1:${http.address().port}`;
  return {url, tcp, post: (body, raw=false) => fetch(`${url}/api/servo`, {method:'POST', headers:{'Content-Type':'application/json'}, body:raw ? body : JSON.stringify(body)})};
}

test('sends decimal channel:angle newline and accepts fragmented acknowledgement', async t => {
  let command;
  const f = await fixture(t, (socket, data) => { command=data; socket.write('O'); setTimeout(() => socket.write('K\n'), 10); });
  assert.equal((await f.post({servo:15, angle:180})).status, 200);
  assert.equal(command, '15:180\n');
});

test('accepts channel and angle zero', async t => {
  const f = await fixture(t, (socket, data) => {assert.equal(data, '0:0\n');socket.end('OK\n');});
  assert.equal((await f.post({servo:0, angle:0})).status,200);
});

test('rejects invalid input before opening TCP', async t => {
  let connected=false;
  const f=await fixture(t, () => {connected=true;});
  for (const body of [{servo:'1',angle:90},{servo:16,angle:90},{servo:-1,angle:90},{servo:1.5,angle:90},{servo:1,angle:181},{servo:1,angle:-1},{servo:1,angle:90.5},{servo:1},{},null,[]]) {
    assert.equal((await f.post(body)).status,400,JSON.stringify(body));
  }
  assert.equal((await f.post('{',true)).status,400);
  assert.equal(connected,false);
});

for (const response of ['ERR\n','NO\n','OK','x'.repeat(100)]) {
  test(`rejects malformed or rejected response ${response.slice(0,8)}`, async t => {
    const f=await fixture(t,socket => socket.end(response));
    assert.equal((await f.post({servo:1,angle:90})).status,502);
  });
}

test('absolute timeout expires even while partial bytes arrive',async t => {
  const f=await fixture(t,socket => {
    const timers=[100,200,300,400].map(delay => setTimeout(()=>socket.write('O'),delay));
    socket.once('close',()=>timers.forEach(clearTimeout));
  },{timeoutMs:600});
  const started=performance.now();
  const response=await f.post({servo:1,angle:90});
  const elapsed=performance.now()-started;
  assert.equal(response.status,504);
  assert.ok(elapsed>=500,`deadline expired too early: ${elapsed}ms`);
  assert.ok(elapsed<850,`deadline behaved like an inactivity timeout: ${elapsed}ms`);
});

test('connection refusal returns service unavailable',async t => {
  const f=await fixture(t,()=>{});
  await new Promise(resolve=>f.tcp.close(resolve));
  assert.equal((await f.post({servo:1,angle:90})).status,503);
});

test('serves browser files from same origin',async t => {
  const f=await fixture(t,()=>{});
  for (const path of ['/', '/js/robot_arm.js','/style/style.css']) {
    const response=await fetch(f.url+path); assert.equal(response.status,200);assert.ok((await response.text()).length>0);
  }
});


test('silent firmware reaches the acknowledgement deadline', async t => {
  const f = await fixture(t, () => {});
  assert.equal((await f.post({servo:1,angle:90})).status,504);
});

test('rejects oversized JSON without contacting firmware', async t => {
  let contacted = false;
  const f = await fixture(t, () => { contacted = true; });
  assert.equal((await f.post({servo:1,angle:90,padding:'x'.repeat(1500)})).status,400);
  assert.equal(contacted,false);
});
