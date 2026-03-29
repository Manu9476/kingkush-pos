import { queryOne } from '../../lib/db.js';

export default async function handler(_req: any, res: any) {
  try {
    const row = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
    const userCount = Number(row?.count ?? '0');
    return res.status(200).json({ needsBootstrap: userCount === 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return res.status(500).json({ error: message });
  }
}
