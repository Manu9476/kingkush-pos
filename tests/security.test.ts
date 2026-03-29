import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, createSessionToken, hashSessionToken, parseCookies } from '../api/_lib/security';
import { hasPermission, serializeUser } from '../api/_lib/auth';

test('password hashing verifies the original password and rejects a wrong one', async () => {
  const password = 'SuperSecure123!';
  const passwordHash = await hashPassword(password);

  assert.notEqual(passwordHash, password);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('wrong-password', passwordHash), false);
});

test('session token hashing is deterministic and cookie parsing reads the token', () => {
  const token = createSessionToken();
  const hashedOnce = hashSessionToken(token);
  const hashedTwice = hashSessionToken(token);

  assert.equal(hashedOnce, hashedTwice);
  assert.notEqual(hashedOnce, token);

  const cookies = parseCookies(`theme=dark; kingkush_session=${encodeURIComponent(token)}`);
  assert.equal(cookies.kingkush_session, token);
});

test('serializeUser normalizes permission payloads and superadmin permission checks always pass', () => {
  const cashier = serializeUser({
    id: 'usr_cashier',
    username: 'cashier',
    email: 'cashier@example.com',
    display_name: 'Cashier One',
    role: 'cashier',
    permissions: JSON.stringify(['dashboard', 'pos']),
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString()
  });

  const superadmin = serializeUser({
    id: 'usr_super',
    username: 'superadmin',
    email: 'superadmin@example.com',
    display_name: 'Super Admin',
    role: 'superadmin',
    permissions: [],
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString()
  });

  assert.deepEqual(cashier.permissions, ['dashboard', 'pos']);
  assert.equal(hasPermission(cashier, 'pos'), true);
  assert.equal(hasPermission(cashier, 'users'), false);
  assert.equal(hasPermission(superadmin, 'users'), true);
});
