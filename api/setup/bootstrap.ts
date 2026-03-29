import { readJsonBody } from '../_lib/http';
import { createId, withTransaction } from '../_lib/db';
import { createSessionToken, getSessionExpiryDate, hashPassword, hashSessionToken, serializeSessionCookie } from '../_lib/security';

const DEFAULT_PERMISSIONS = [
  'dashboard',
  'pos',
  'sales-history',
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
  'users',
  'audit-logs',
  'settings',
  'status'
];

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = await readJsonBody<{
      username?: string;
      password?: string;
      displayName?: string;
    }>(req);

    const username = (body.username || '').trim().toLowerCase();
    const password = (body.password || '').trim();
    const displayName = (body.displayName || '').trim() || 'Super Admin';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const user = await withTransaction(async (client) => {
      const existing = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
      if (Number(existing.rows[0]?.count ?? '0') > 0) {
        throw new Error('Bootstrap has already been completed');
      }

      const userId = createId('usr');
      const passwordHash = await hashPassword(password);
      const email = `${username}@kingkush.local`;

      await client.query(
        `
        INSERT INTO users (
          id,
          username,
          email,
          display_name,
          role,
          permissions,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, 'superadmin', $5::jsonb, 'active', NOW(), NOW())
        `,
        [userId, username, email, displayName, JSON.stringify(DEFAULT_PERMISSIONS)]
      );

      await client.query(
        `
        INSERT INTO user_credentials (user_id, password_hash, updated_at)
        VALUES ($1, $2, NOW())
        `,
        [userId, passwordHash]
      );

      return {
        uid: userId,
        username,
        email,
        displayName,
        role: 'superadmin' as const,
        permissions: DEFAULT_PERMISSIONS,
        status: 'active' as const,
        createdAt: new Date().toISOString()
      };
    });

    const sessionToken = createSessionToken();
    const sessionId = createId('ses');
    const expiresAt = getSessionExpiryDate();

    await withTransaction(async (client) => {
      await client.query(
        `
        INSERT INTO user_sessions (
          id,
          user_id,
          token_hash,
          expires_at,
          created_at,
          last_seen_at
        )
        VALUES ($1, $2, $3, $4::timestamptz, NOW(), NOW())
        `,
        [sessionId, user.uid, hashSessionToken(sessionToken), expiresAt.toISOString()]
      );
    });

    res.setHeader('Set-Cookie', serializeSessionCookie(sessionToken, expiresAt));
    return res.status(201).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode = message.includes('already been completed') ? 409 : 500;
    return res.status(statusCode).json({ error: message });
  }
}
