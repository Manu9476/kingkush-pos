import type { PoolClient } from '@neondatabase/serverless';

import type { SessionUser } from './auth';
import { createId } from './db';

export async function insertAuditLog(
  client: PoolClient,
  user: Pick<SessionUser, 'uid' | 'displayName' | 'username'>,
  action: string,
  details: string
) {
  await client.query(
    `
    INSERT INTO audit_logs (id, user_id, user_name, action, details, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [createId('audit'), user.uid, user.displayName || user.username, action, details]
  );
}
