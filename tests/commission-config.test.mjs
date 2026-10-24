import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionRateFromSnapshot, readCommissionRate, saveCommissionRate } from '../server/commission-config.ts';
import { MemoryFirestore } from './fixtures/v2-repositories.mjs';

test('commission settings survive a new reader, preserve zero, and append an atomic audit', async () => {
  const db = new MemoryFirestore();
  assert.equal(await readCommissionRate(db), 500);
  await saveCommissionRate(db, 750, 'verified-admin');
  // Every caller reads the durable record instead of retaining a process-local rate.
  db.seed('platform_settings/commission', { platformCommissionBps: 250 });
  assert.equal(await readCommissionRate(db), 250);
  await saveCommissionRate(db, 0, 'verified-admin');
  assert.equal(await readCommissionRate(db), 0);
  const audits = [...db.data].filter(([path]) => path.startsWith('platform_settings/commission/audit/')).map(([, data]) => data);
  assert.equal(audits.length, 2);
  assert.deepEqual(audits.map(a => [a.previousCommissionBps, a.platformCommissionBps]), [[500, 750], [250, 0]]);
  assert.ok(audits.every(a => a.actorUid === 'verified-admin'));
});

test('a failed commission transaction preserves both the old rate and audit history', async () => {
  const db = new MemoryFirestore();
  await saveCommissionRate(db, 600, 'verified-admin');
  const before = structuredClone(db.data);
  db.failCommit = true;
  await assert.rejects(saveCommissionRate(db, 900, 'verified-admin'));
  assert.deepEqual(db.data, before);
  assert.equal(await readCommissionRate(db), 600);
});

test('corrupt rates fail closed while an administrator can repair the stored setting', async () => {
  for (const rate of [undefined, null, '500', -1, 0.5, 5001, Infinity, NaN]) {
    assert.throws(() => commissionRateFromSnapshot({ exists: true, get: () => rate }), error => error.status === 503);
  }
  assert.equal(commissionRateFromSnapshot({ exists: true, get: () => 0 }), 0);
  await assert.rejects(readCommissionRate(null), error => error.status === 503);
  const db = new MemoryFirestore();
  db.seed('platform_settings/commission', { platformCommissionBps: 'corrupt' });
  await saveCommissionRate(db, 500, 'verified-admin');
  assert.equal(await readCommissionRate(db), 500);
});
