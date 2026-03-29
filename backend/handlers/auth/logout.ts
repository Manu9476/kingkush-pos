import { queryResult } from '../_lib/db';
import { parseCookies, SESSION_COOKIE_NAME, hashSessionToken, serializeClearedSessionCookie } from '../_lib/security';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      await queryResult('DELETE FROM user_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    }

    res.setHeader('Set-Cookie', serializeClearedSessionCookie());
    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return res.status(500).json({ error: message });
  }
}
