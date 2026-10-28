import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/components/screens/SuperAdminDashboard.tsx', import.meta.url), 'utf8');

test('admin moderation supports distinct pending, suspended and active states', () => {
  assert.match(server, /status: 'Active' \| 'Pending' \| 'Suspended'/);
  assert.match(server, /status: statusInput === 'active' \? 'Active' : statusInput === 'suspended' \? 'Suspended' : 'Pending'/);
  assert.match(server, /patch\.status = cleanAction === 'activate' \? 'Active' : 'Suspended'/);
  assert.match(server, /patch\.status = statusInput === 'active' \? 'Active' : statusInput === 'suspended' \? 'Suspended' : 'Pending'/);
});

test('dashboard sends the selected state and overview differentiates pending from suspended', () => {
  assert.match(dashboard, /status: newStatus === 'active' \? 'Active' : newStatus === 'suspended' \? 'Suspended' : 'Pending'/);
  assert.match(server, /st\.status === 'Suspended' \? 'suspended' : 'pending_review'/);
  assert.match(server, /saved\.status === 'Suspended' \? 'suspended' : 'pending_review'/);
});
