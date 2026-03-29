import { readJsonBody } from '../_lib/http';
import { createId, withTransaction } from '../_lib/db';
import { createSessionToken, getSessionExpiryDate, hashSessionToken, serializeSessionCookie, verifyPassword } from '../_lib/security';
import { serializeUser } from '../_lib/auth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = await readJsonBody<{ username?: string; password?: string }>(req);
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const loginResult = await withTransaction(async (client) => {
      const userResult = await client.query<{
        id: string;
        username: string;
        email: string;
        display_name: string;
        branch_id: string | null;
        role: 'superadmin' | 'admin' | 'cashier';
        permissions: unknown;
        status: 'active' | 'inactive';
        created_at: string;
        password_hash: string;
      }>(
        `
        SELECT
          u.id,
          u.username,
          u.email,
          u.display_name,
          u.branch_id,
          u.role,
          u.permissions,
          u.status,
          u.created_at,
          c.password_hash
        FROM users u
        INNER JOIN user_credentials c ON c.user_id = u.id
        WHERE u.username = $1
        LIMIT 1
        `,
        [username]
      );

      const row = userResult.rows[0];
      if (!row) {
        throw new Error('Invalid username or password');
      }
      if (row.status !== 'active') {
        throw new Error('Account is inactive. Please contact an administrator.');
      }

      const passwordMatches = await verifyPassword(password, row.password_hash);
      if (!passwordMatches) {
        throw new Error('Invalid username or password');
      }

      await client.query('DELETE FROM user_sessions WHERE user_id = $1 OR expires_at <= NOW()', [row.id]);

      const sessionToken = createSessionToken();
      const sessionId = createId('ses');
      const expiresAt = getSessionExpiryDate();

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
        [sessionId, row.id, hashSessionToken(sessionToken), expiresAt.toISOString()]
      );

      return {
        user: serializeUser(row),
        sessionToken,
        expiresAt
      };
    });

    res.setHeader('Set-Cookie', serializeSessionCookie(loginResult.sessionToken, loginResult.expiresAt));
    return res.status(200).json({ user: loginResult.user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message === 'Invalid username or password'
        ? 401
        : message.includes('inactive')
          ? 403
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
