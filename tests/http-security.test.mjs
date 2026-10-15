import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { installAuthHelperProxy, asyncRoute, apiErrorHandler } from '../server/http.ts';

async function serve(t, setup) {
  const app = express();
  setup(app);
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('OAuth helpers preserve bytes and form bodies without forwarding user tokens', async t => {
  const calls = [];
  const origin = await serve(t, app => installAuthHelperProxy(app, {
    authDomain: 'test-project.firebaseapp.com', apiKey: 'public-key', projectId: 'test-project',
  }, async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('<html>official helper</html>', { headers: { 'content-type': 'text/html' } });
  }));
  const response = await fetch(origin + '/__/auth/handler?eventId=one', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer do-not-forward' },
    body: 'code=one&state=two',
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<html>official helper</html>');
  assert.equal(calls[0].url, 'https://test-project.firebaseapp.com/__/auth/handler?eventId=one');
  assert.equal(calls[0].options.body.toString(), 'code=one&state=two');
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const method of ['GET', 'POST', 'DELETE']) {
    const relay = await fetch(origin + '/__/auth/relay', { method });
    assert.equal(relay.status, 410);
    assert.equal((await relay.json()).events, undefined);
  }
  assert.equal(calls.length, 1, 'retired relay never reaches Firebase');
});

test('rejected async handlers return safe JSON and leave the server running', async t => {
  const origin = await serve(t, app => {
    app.get('/failure', asyncRoute(async () => { throw new Error('private service-account detail'); }));
    app.get('/healthy', (_req, res) => res.json({ ok: true }));
  });
  const failure = await fetch(origin + '/failure');
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private service-account/);
  assert.equal((await fetch(origin + '/healthy')).status, 200);
});

test('OAuth proxy fails safely on an upstream outage', async t => {
  const origin = await serve(t, app => installAuthHelperProxy(app, {
    authDomain: 'test-project.firebaseapp.com', apiKey: 'key', projectId: 'test-project',
  }, async () => { throw new Error('upstream private diagnostic'); }));
  const response = await fetch(origin + '/__/auth/iframe');
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private diagnostic/);
});
