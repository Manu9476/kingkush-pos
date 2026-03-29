import type { PoolClient } from '@neondatabase/serverless';

import { queryOne, queryResult } from './db';
import { parseCookies, SESSION_COOKIE_NAME, hashSessionToken, serializeClearedSessionCookie } from './security';

export type SessionUser = {
  uid: string;
  username: string;
  email: string;
  displayName: string;
  role: 'superadmin' | 'admin' | 'cashier';
  permissions: string[];
  status: 'active' | 'inactive';
  createdAt: string;
};

type RequestLike = {
  headers?: {
    cookie?: string;
  };
};

type ResponseLike = {
  setHeader: (name: string, value: string) => void;
  status: (statusCode: number) => { json: (payload: unknown) => void };
};

type UserRow = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: SessionUser['role'];
  permissions: unknown;
  status: SessionUser['status'];
  created_at: string;
};

export function serializeUser(row: UserRow): SessionUser {
  return {
    uid: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    permissions: normalizePermissions(row.permissions),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString()
  };
}

export function hasPermission(user: SessionUser, permissionId: string) {
  return user.role === 'superadmin' || user.permissions.includes(permissionId);
}

export async function getSessionUser(req: RequestLike, res?: ResponseLike, client?: PoolClient) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const row = await queryOne<UserRow>(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      u.display_name,
      u.role,
      u.permissions,
      u.status,
      u.created_at
    FROM user_sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
    LIMIT 1
    `,
    [hashSessionToken(token)],
    client
  );

  if (!row || row.status !== 'active') {
    if (res) {
      res.setHeader('Set-Cookie', serializeClearedSessionCookie());
    }
    return null;
  }

  await queryResult(
    'UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = $1',
    [hashSessionToken(token)],
    client
  );

  return serializeUser(row);
}

export async function requireUser(req: RequestLike, res: ResponseLike, client?: PoolClient) {
  const user = await getSessionUser(req, res, client);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return user;
}

export async function requirePermission(
  req: RequestLike,
  res: ResponseLike,
  permissionIds: string[],
  client?: PoolClient
) {
  const user = await requireUser(req, res, client);
  if (!user) {
    return null;
  }

  if (!permissionIds.some((permissionId) => hasPermission(user, permissionId))) {
    res.status(403).json({ error: 'Permission denied' });
    return null;
  }

  return user;
}

function normalizePermissions(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return normalizePermissions(parsed);
    } catch {
      return [];
    }
  }

  return [];
}
