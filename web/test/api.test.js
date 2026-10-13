import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { sendAngles } from '../js/api.js';

const angles = { 0: 90, 1: 60, 2: 120, 3: 80, 4: 20, 5: 100 };

async function endpoint(t, respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], body });
    respond(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { requests, fetchImpl: (url, options) => fetch(new URL(url, base), options) };
}

// Catches wrong endpoint, payload shape, non-JSON requests, or duplicate sends.
test('sends exactly one JSON batch with all six integer channels', async t => {
  const api = await endpoint(t, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Doel geaccepteerd.' }));
  });
  assert.deepEqual(await sendAngles(angles, api), { message: 'Doel geaccepteerd.' });
  assert.equal(api.requests.length, 1);
  assert.deepEqual(api.requests[0], {
    method: 'POST', url: '/api/arm/angles', contentType: 'application/json',
    body: '{"anglesDeg":{"0":90,"1":60,"2":120,"3":80,"4":20,"5":100}}',
  });
});

test('rejects malformed payloads before any HTTP request', async t => {
  const api = await endpoint(t, (_req, res) => res.end());
  for (const invalid of [null, [], {}, { ...angles, 6: 0 }, { ...angles, 5: undefined },
    { ...angles, 5: 180.1 }, { ...angles, 5: -1 }, { ...angles, 5: '90' },
    { ...angles, 5: NaN }, { ...angles, 5: Infinity }]) {
    await assert.rejects(sendAngles(invalid, api), /zes|hoek|kanaal/i);
  }
  assert.equal(api.requests.length, 0);
});

test('accepts empty 204 and non-JSON successful responses', async t => {
  for (const [status, body] of [[204, ''], [200, '<html>OK</html>'], [200, ''], [200, '{}']]) {
    const api = await endpoint(t, (_req, res) => { res.statusCode = status; res.end(body); });
    const result = await sendAngles(angles, api);
    assert.match(result.message, /geaccepteerd/i);
    assert.doesNotMatch(result.message, /html/i);
    assert.equal(api.requests.length, 1);
  }
});

test('surfaces a server JSON error without retrying', async t => {
  const api = await endpoint(t, (_req, res) => {
    res.statusCode = 400; res.end('{"error":"Gewricht geweigerd."}');
  });
  await assert.rejects(sendAngles(angles, api), /Gewricht geweigerd/);
  assert.equal(api.requests.length, 1);
});

test('turns an HTML HTTP failure into a readable status error', async t => {
  const api = await endpoint(t, (_req, res) => {
    res.statusCode = 503; res.end('<html>upstream unavailable</html>');
  });
  await assert.rejects(sendAngles(angles, api), error => {
    assert.match(error.message, /503/);
    assert.doesNotMatch(error.message, /html|JSON|Unexpected/);
    return true;
  });
  assert.equal(api.requests.length, 1);
});

test('reports a disconnected server as a network error without retrying', async t => {
  const api = await endpoint(t, req => req.socket.destroy());
  await assert.rejects(sendAngles(angles, api), /verbinding|netwerk/i);
  assert.equal(api.requests.length, 1);
});

test('aborts a stalled request with a user-facing timeout', async t => {
  const api = await endpoint(t, () => {});
  await assert.rejects(sendAngles(angles, { ...api, timeoutMs: 80 }), /tijd|time-out/i);
  assert.equal(api.requests.length, 1);
});

test('timeout also covers a stalled response body', async t => {
  const api = await endpoint(t, (_req, res) => { res.writeHead(200); res.flushHeaders(); });
  await assert.rejects(sendAngles(angles, { ...api, timeoutMs: 80 }), /tijd|time-out/i);
  assert.equal(api.requests.length, 1);
});

test('clears its abort timer after success and HTTP failure', async t => {
  for (const status of [200, 500]) {
    const api = await endpoint(t, (_req, res) => { res.statusCode = status; res.end('{}'); });
    let signal;
    const fetchImpl = (url, options) => { signal = options.signal; return api.fetchImpl(url, options); };
    if (status === 200) await sendAngles(angles, { fetchImpl, timeoutMs: 80 });
    else await assert.rejects(sendAngles(angles, { fetchImpl, timeoutMs: 80 }));
    await delay(100);
    assert.equal(signal.aborted, false);
  }
});

test('rejects invalid request options with understandable errors', async () => {
  await assert.rejects(sendAngles(angles, { fetchImpl: null }), /verbinding|browser/i);
  for (const timeoutMs of [0, -1, NaN, Infinity, '50']) {
    await assert.rejects(sendAngles(angles, { timeoutMs }), /tijd/i);
  }
});
