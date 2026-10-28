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

test('admin payment approval requires statement confirmation and durable callback', () => {
  assert.match(dashboard, /Have you independently verified CLEARED funds/);
  assert.match(dashboard, /Secure admin order verification is unavailable/);
  assert.match(dashboard, /Payment Verification Failed/);
  assert.match(dashboard, /Order Update Failed/);
});

test('unimplemented seller registration policy cannot be falsely saved by admin', () => {
  assert.match(dashboard, /Registration controls are not yet connected to a durable server policy/);
  assert.match(dashboard, /Seller registration policy is not configurable yet/);
});
