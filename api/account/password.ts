import { requireUser } from '../../backend/lib/auth';
import { readJsonBody } from '../../backend/lib/http';
import { withTransaction } from '../../backend/lib/db';
import { hashPassword, verifyPassword } from '../../backend/lib/security';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const sessionUser = await requireUser(req, res);
    if (!sessionUser) {
      return;
    }

    const body = await readJsonBody<{
      currentPassword?: string;
      newPassword?: string;
      targetUserId?: string;
    }>(req);

    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';
    const targetUserId = body.targetUserId || sessionUser.uid;

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    await withTransaction(async (client) => {
      const targetUserResult = await client.query<{
        id: string;
        role: 'superadmin' | 'admin' | 'cashier';
      }>(
        'SELECT id, role FROM users WHERE id = $1 LIMIT 1',
        [targetUserId]
      );
      const targetUser = targetUserResult.rows[0];
      if (!targetUser) {
        throw new Error('Target user was not found');
      }

      const isSelf = targetUserId === sessionUser.uid;
      const isAdminReset =
        sessionUser.role === 'superadmin' ||
        (sessionUser.role === 'admin' && targetUser.role === 'cashier');

      if (!isSelf && !isAdminReset) {
        throw new Error('You are not allowed to change this password');
      }

      if (isSelf) {
        if (!currentPassword) {
          throw new Error('Current password is required');
        }

        const credentialResult = await client.query<{ password_hash: string }>(
          'SELECT password_hash FROM user_credentials WHERE user_id = $1 LIMIT 1',
          [sessionUser.uid]
        );
        const credential = credentialResult.rows[0];
        if (!credential) {
          throw new Error('Current credentials were not found');
        }

        const passwordMatches = await verifyPassword(currentPassword, credential.password_hash);
        if (!passwordMatches) {
          throw new Error('Incorrect current password');
        }
      }

      const passwordHash = await hashPassword(newPassword);
      await client.query(
        `
        INSERT INTO user_credentials (user_id, password_hash, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
        `,
        [targetUserId, passwordHash]
      );

      await client.query(
        `
        INSERT INTO audit_logs (id, user_id, user_name, action, details, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        `,
        [
          `audit_pwd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sessionUser.uid,
          sessionUser.displayName || sessionUser.username,
          'CHANGE_PASSWORD',
          isSelf
            ? 'User changed their own password'
            : `Password reset for user ${targetUserId}`
        ]
      );
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message === 'Incorrect current password'
        ? 401
        : message.includes('not allowed')
          ? 403
          : message.includes('required') || message.includes('not found')
            ? 400
            : 500;
    return res.status(statusCode).json({ error: message });
  }
}
