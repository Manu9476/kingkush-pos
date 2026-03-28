import { neon } from '@neondatabase/serverless';

interface LocalStore {
  docs: Record<string, unknown>;
  authAccounts: Record<string, unknown>;
}

const STORE_ID = 'kingkush-pos-main';

function normalizeStore(value: unknown): LocalStore {
  if (!value || typeof value !== 'object') {
    return { docs: {}, authAccounts: {} };
  }

  const candidate = value as { docs?: unknown; authAccounts?: unknown };
  const docs = candidate.docs && typeof candidate.docs === 'object' ? candidate.docs as Record<string, unknown> : {};
  const authAccounts = candidate.authAccounts && typeof candidate.authAccounts === 'object'
    ? candidate.authAccounts as Record<string, unknown>
    : {};

  return { docs, authAccounts };
}

async function ensureTable(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_store (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export default async function handler(req: any, res: any) {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      return res.status(503).json({ error: 'Cloud database is not configured on this deployment.' });
    }
    const sql = neon(connectionString);
    await ensureTable(sql);

    if (req.method === 'GET') {
      const result = await sql`SELECT payload FROM app_store WHERE id = ${STORE_ID} LIMIT 1`;
      const row = result[0] as { payload?: unknown } | undefined;
      const store = normalizeStore(row?.payload);
      return res.status(200).json({ store });
    }

    if (req.method === 'PUT') {
      const store = normalizeStore(req.body?.store);
      await sql`
        INSERT INTO app_store (id, payload, updated_at)
        VALUES (${STORE_ID}, ${JSON.stringify(store)}::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return res.status(500).json({ error: message });
  }
}
