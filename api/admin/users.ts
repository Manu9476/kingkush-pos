import { requirePermission } from '../../backend/lib/auth.js';
import { readJsonBody } from '../../backend/lib/http.js';
import { createId, withTransaction } from '../../backend/lib/db.js';
import { hashPassword } from '../../backend/lib/security.js';

const KNOWN_PERMISSIONS = [
  'dashboard',
  'pos',
  'sales-history',
  'shifts',
  'customers',
  'credits',
  'products',
  'categories',
  'inventory',
  'purchase-orders',
  'suppliers',
  'branches',
  'labels',
  'reports',
  'expenses',
  'users',
  'audit-logs',
  'settings',
  'status'
] as const;

const ROLE_PERMISSION_PRESETS: Record<'admin' | 'cashier', string[]> = {
  cashier: ['dashboard', 'pos', 'sales-history', 'shifts', 'customers', 'credits'],
  admin: [
    'dashboard',
    'pos',
    'sales-history',
    'shifts',
    'customers',
    'credits',
    'products',
    'categories',
    'inventory',
    'purchase-orders',
    'suppliers',
    'labels',
    'reports',
    'expenses',
    'users'
  ]
};

function sanitizePermissions(role: 'admin' | 'cashier', permissions: unknown) {
  const requestedPermissions = Array.isArray(permissions)
    ? permissions.filter(
        (value): value is (typeof KNOWN_PERMISSIONS)[number] =>
          typeof value === 'string' && KNOWN_PERMISSIONS.includes(value as (typeof KNOWN_PERMISSIONS)[number])
      )
    : [];

  const dedupedPermissions = Array.from(new Set(requestedPermissions));
  if (dedupedPermissions.length > 0) {
    return dedupedPermissions;
  }

  return [...ROLE_PERMISSION_PRESETS[role]];
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const sessionUser = await requirePermission(req, res, ['users']);
    if (!sessionUser) {
      return;
    }

    const body = await readJsonBody<{
      username?: string;
      password?: string;
      displayName?: string;
      branchId?: string;
      role?: 'admin' | 'cashier';
      permissions?: string[];
    }>(req);

    const username = (body.username || '').trim().toLowerCase();
    const password = (body.password || '').trim();
    const displayName = (body.displayName || '').trim();
    const branchId = (body.branchId || '').trim() || sessionUser.branchId || 'branch_main';
    const requestedRole = body.role || 'cashier';
    const permissions = sanitizePermissions(requestedRole, body.permissions);

    if (!username || !password || !displayName) {
      return res.status(400).json({ error: 'Display name, username, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    if (sessionUser.role === 'admin' && requestedRole !== 'cashier') {
      return res.status(403).json({ error: 'Admins can only create cashier accounts' });
    }

    const createdUser = await withTransaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE username = $1 LIMIT 1',
        [username]
      );
      if (existing.rows[0]) {
        throw new Error('Username already exists');
      }

      const branchResult = await client.query<{ id: string }>(
        'SELECT id FROM branches WHERE id = $1 LIMIT 1',
        [branchId]
      );
      if (!branchResult.rows[0]) {
        throw new Error('Selected branch was not found');
      }

      const userId = createId('usr');
      const email = `${username}@kingkush.local`;
      const passwordHash = await hashPassword(password);

      await client.query(
        `
        INSERT INTO users (
          id,
          username,
          email,
          display_name,
          branch_id,
          role,
          permissions,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active', NOW(), NOW())
        `,
        [userId, username, email, displayName, branchId, requestedRole, JSON.stringify(permissions)]
      );

      await client.query(
        `
        INSERT INTO user_credentials (user_id, password_hash, updated_at)
        VALUES ($1, $2, NOW())
        `,
        [userId, passwordHash]
      );

      await client.query(
        `
        INSERT INTO audit_logs (id, user_id, user_name, action, details, created_at)
        VALUES ($1, $2, $3, 'CREATE_USER', $4, NOW())
        `,
        [
          createId('audit'),
          sessionUser.uid,
          sessionUser.displayName || sessionUser.username,
          `Created ${requestedRole} user @${username}`
        ]
      );

      return {
        uid: userId,
        username,
        email,
        displayName,
        branchId,
        role: requestedRole,
        permissions,
        status: 'active' as const,
        createdAt: new Date().toISOString()
      };
    });

    return res.status(201).json({ user: createdUser });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message === 'Username already exists'
        ? 409
        : message.includes('required') || message.includes('Password')
          ? 400
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
