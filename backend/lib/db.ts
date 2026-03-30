import { Pool, neonConfig } from '@neondatabase/serverless';
import type { PoolClient, QueryResult } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import ws from 'ws';

import { hashPassword } from './security.js';

neonConfig.webSocketConstructor = ws;

const DEFAULT_PERMISSIONS = [
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
];

type DbExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

type LegacyStore = {
  docs?: Record<string, unknown>;
  authAccounts?: Record<string, unknown>;
};

let pool: Pool | null = null;
let schemaReadyPromise: Promise<void> | null = null;
const SCHEMA_LOCK_NAMESPACE = 2147483001;
const SCHEMA_LOCK_KEY = 2147483002;

function getConnectionString() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Database connection is not configured. Set POSTGRES_URL or DATABASE_URL.');
  }
  return connectionString;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getConnectionString()
    });
    pool.on('error', (error) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Neon pool error:', error);
      }
    });
  }
  return pool;
}

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export async function queryRows<T>(text: string, params: unknown[] = [], client?: DbExecutor) {
  await ensureSchema();
  const executor = client ?? getPool();
  const result = await executor.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T>(text: string, params: unknown[] = [], client?: DbExecutor) {
  const rows = await queryRows<T>(text, params, client);
  return rows[0] ?? null;
}

export async function queryResult(text: string, params: unknown[] = [], client?: DbExecutor) {
  await ensureSchema();
  const executor = client ?? getPool();
  return executor.query(text, params);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaInternal();
  }
  return schemaReadyPromise;
}

async function ensureSchemaInternal() {
  const client = await getPool().connect();
  let lockHeld = false;
  try {
    // Multiple serverless instances can cold-start at once. Serialize schema/default
    // initialization so Postgres catalog updates do not collide.
    await client.query('SELECT pg_advisory_lock($1, $2)', [SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);
    lockHeld = true;

    const statements = [
      `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS system_settings (
        id TEXT PRIMARY KEY,
        sku_prefix TEXT NOT NULL DEFAULT 'KK-',
        bad_debt_threshold_days INTEGER NOT NULL DEFAULT 30,
        tax_rate NUMERIC(10, 2) NOT NULL DEFAULT 16,
        loyalty_point_rate INTEGER NOT NULL DEFAULT 100,
        drawer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        drawer_auto_open_on_cash_sale BOOLEAN NOT NULL DEFAULT FALSE,
        drawer_helper_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:17363',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        barcode TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category_id TEXT,
        supplier_id TEXT,
        buying_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
        selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        unit_type TEXT NOT NULL DEFAULT 'pcs',
        expiry_date TIMESTAMPTZ,
        low_stock_threshold INTEGER NOT NULL DEFAULT 5,
        is_hot_item BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        customer_code TEXT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        loyalty_points INTEGER NOT NULL DEFAULT 0,
        total_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        cashier_name TEXT NOT NULL,
        total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL,
        amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
        balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        customer_name TEXT,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        reference TEXT,
        is_credit BOOLEAN NOT NULL DEFAULT FALSE,
        is_refunded BOOLEAN NOT NULL DEFAULT FALSE,
        refund_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        refunded_at TIMESTAMPTZ,
        refunded_by TEXT,
        refund_reason TEXT,
        outstanding_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL,
        barcode TEXT,
        quantity INTEGER NOT NULL,
        unit_price NUMERIC(14, 2) NOT NULL,
        total_price NUMERIC(14, 2) NOT NULL,
        display_name TEXT,
        selling_price NUMERIC(14, 2),
        is_refunded BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'sold',
        refunded_at TIMESTAMPTZ,
        refunded_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS credits (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL,
        total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
        outstanding_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        items TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        refunded_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS credit_payments (
        id TEXT PRIMARY KEY,
        credit_id TEXT NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
        remaining_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL,
        reference TEXT,
        cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        cashier_name TEXT NOT NULL,
        paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS inventory_ledger (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        quantity_delta INTEGER NOT NULL,
        reason TEXT,
        source_type TEXT,
        source_id TEXT,
        supplier_id TEXT,
        unit_cost NUMERIC(14, 2),
        reference TEXT,
        notes TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        resulting_stock INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        user_name TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS app_documents (
        collection_name TEXT NOT NULL,
        id TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection_name, id)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS data_migrations (
        migration_key TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS cash_shifts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_name TEXT NOT NULL,
        branch_id TEXT,
        opening_float NUMERIC(14, 2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        notes TEXT,
        opening_reference TEXT,
        closing_notes TEXT,
        closing_counted_cash NUMERIC(14, 2),
        expected_cash NUMERIC(14, 2),
        variance NUMERIC(14, 2),
        closed_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        closed_by_name TEXT,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        shift_id TEXT NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
        branch_id TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        user_name TEXT NOT NULL,
        type TEXT NOT NULL,
        amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        reference TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      `
      CREATE OR REPLACE FUNCTION assert_true(condition BOOLEAN, message TEXT)
      RETURNS VOID AS $$
      BEGIN
        IF NOT condition THEN
          RAISE EXCEPTION '%', message;
        END IF;
      END;
      $$ LANGUAGE plpgsql
      `,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id TEXT`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS business_name TEXT NOT NULL DEFAULT 'KingKush Sale'`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS store_address TEXT`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS store_phone TEXT`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS store_email TEXT`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS receipt_header TEXT NOT NULL DEFAULT 'Thank you for shopping with us!'`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS receipt_footer TEXT NOT NULL DEFAULT 'Goods once sold are not returnable.'`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS receipt_auto_print BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS drawer_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS drawer_auto_open_on_cash_sale BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS drawer_helper_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:17363'`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS barcode_autofocus BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS barcode_submit_delay_ms INTEGER NOT NULL DEFAULT 120`,
      `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS default_branch_id TEXT`,
      `ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id TEXT`,
      `ALTER TABLE sales ADD COLUMN IF NOT EXISTS shift_id TEXT`,
      `ALTER TABLE sales ADD COLUMN IF NOT EXISTS tender_method TEXT`,
      `ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS branch_id TEXT`,
      `ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS shift_id TEXT`,
      `ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS branch_id TEXT`,
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales (sold_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales (shift_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_customer_id ON credits (customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_credits_status ON credits (status)`,
      `CREATE INDEX IF NOT EXISTS idx_credit_payments_credit_id ON credit_payments (credit_id)`,
      `CREATE INDEX IF NOT EXISTS idx_credit_payments_shift_id ON credit_payments (shift_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product_id ON inventory_ledger (product_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_cash_shifts_user_status ON cash_shifts (user_id, status, opened_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_cash_shifts_branch_status ON cash_shifts (branch_id, status, opened_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_cash_movements_shift_id ON cash_movements (shift_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_branches_status ON branches (status, name)`,
      `CREATE INDEX IF NOT EXISTS idx_app_documents_collection_updated_at ON app_documents (collection_name, updated_at DESC)`
    ];

    for (const statement of statements) {
      await client.query(statement);
    }

    await ensureDefaultBranch(client);
    await ensureDefaultSettings(client);
    await ensureUsersHaveDefaultBranch(client);
    await maybeBootstrapSuperAdmin(client);
    await maybeMigrateLegacyStore(client);
    await ensureDefaultSettings(client);
    await ensureUsersHaveDefaultBranch(client);
  } finally {
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);
      } catch {
        // Ignore unlock errors; releasing the client also releases session locks.
      }
    }
    client.release();
  }
}

async function ensureDefaultBranch(client: PoolClient) {
  await client.query(
    `
    INSERT INTO branches (
      id,
      code,
      name,
      address,
      phone,
      email,
      status,
      created_at,
      updated_at
    )
    VALUES ('branch_main', 'MAIN', 'Main Branch', '', '', '', 'active', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
    `
  );
}

async function ensureDefaultSettings(client: PoolClient) {
  await client.query(
    `
    INSERT INTO system_settings (
      id,
      sku_prefix,
      bad_debt_threshold_days,
      tax_rate,
      loyalty_point_rate,
      business_name,
      store_address,
      store_phone,
      store_email,
      receipt_header,
      receipt_footer,
      receipt_auto_print,
      drawer_enabled,
      drawer_auto_open_on_cash_sale,
      drawer_helper_url,
      barcode_autofocus,
      barcode_submit_delay_ms,
      default_branch_id,
      updated_at
    )
    VALUES (
      'system',
      'KK-',
      30,
      16,
      100,
      'KingKush Sale',
      '',
      '',
      '',
      'Thank you for shopping with us!',
      'Goods once sold are not returnable.',
      FALSE,
      FALSE,
      FALSE,
      'http://127.0.0.1:17363',
      TRUE,
      120,
      'branch_main',
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      business_name = COALESCE(NULLIF(system_settings.business_name, ''), EXCLUDED.business_name),
      receipt_header = COALESCE(NULLIF(system_settings.receipt_header, ''), EXCLUDED.receipt_header),
      receipt_footer = COALESCE(NULLIF(system_settings.receipt_footer, ''), EXCLUDED.receipt_footer),
      default_branch_id = COALESCE(system_settings.default_branch_id, EXCLUDED.default_branch_id)
    `
  );
}

async function ensureUsersHaveDefaultBranch(client: PoolClient) {
  await client.query(
    `
    UPDATE users
    SET branch_id = COALESCE(branch_id, 'branch_main')
    WHERE branch_id IS NULL
    `
  );
}

async function maybeBootstrapSuperAdmin(client: PoolClient) {
  const result = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  if (Number(result.rows[0]?.count ?? '0') > 0) {
    return;
  }

  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!password) {
    return;
  }

  const userId = createId('usr');
  const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || 'Super Admin';
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
    VALUES ($1, $2, $3, $4, 'branch_main', 'superadmin', $5::jsonb, 'active', NOW(), NOW())
    ON CONFLICT (username) DO NOTHING
    `,
    [userId, username, email, displayName, JSON.stringify(DEFAULT_PERMISSIONS)]
  );

  await client.query(
    `
    INSERT INTO user_credentials (user_id, password_hash, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId, passwordHash]
  );
}

async function maybeMigrateLegacyStore(client: PoolClient) {
  const migrationKey = 'legacy_blob_store_v1';
  const migrationCheck = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM data_migrations WHERE migration_key = $1) AS exists',
    [migrationKey]
  );
  if (migrationCheck.rows[0]?.exists) {
    return;
  }

  const tableExists = await client.query<{ exists: string | null }>(
    "SELECT to_regclass('public.app_store')::text AS exists"
  );
  if (!tableExists.rows[0]?.exists) {
    await client.query('INSERT INTO data_migrations (migration_key) VALUES ($1) ON CONFLICT DO NOTHING', [migrationKey]);
    return;
  }

  const legacyRows = await client.query<{ payload?: LegacyStore | string }>('SELECT payload FROM app_store');
  for (const row of legacyRows.rows) {
    const store = normalizeLegacyStore(row.payload);
    await migrateLegacyDocs(client, store);
  }

  await client.query('INSERT INTO data_migrations (migration_key) VALUES ($1) ON CONFLICT DO NOTHING', [migrationKey]);
}

async function migrateLegacyDocs(client: PoolClient, store: LegacyStore) {
  const docs = isRecord(store.docs) ? store.docs : {};
  const authAccounts = isRecord(store.authAccounts) ? store.authAccounts : {};

  for (const [path, rawValue] of Object.entries(docs)) {
    const value = normalizeLegacyValue(rawValue);
    if (!value) {
      continue;
    }

    const parts = path.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0] === 'users') {
      const userId = parts[1];
      const username = normalizeString(value.username) || `user-${userId.slice(-6)}`;
      const email = normalizeString(value.email) || `${username.toLowerCase()}@kingkush.local`;
      const displayName = normalizeString(value.displayName) || username;
      const role = normalizeString(value.role) || 'cashier';
      const permissions = JSON.stringify(normalizeStringArray(value.permissions));
      const status = normalizeString(value.status) || 'active';
      const createdAt = normalizeTimestamp(value.createdAt) || new Date().toISOString();
      const password = normalizeString(value.password) || extractLegacyPassword(authAccounts, email, userId);

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
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, NOW())
        ON CONFLICT (id) DO UPDATE
        SET
          username = EXCLUDED.username,
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          permissions = EXCLUDED.permissions,
          status = EXCLUDED.status,
          updated_at = NOW()
        `,
        [userId, username.toLowerCase(), email.toLowerCase(), displayName, role, permissions, status, createdAt]
      );

      if (password) {
        const passwordHash = await hashPassword(password);
        await client.query(
          `
          INSERT INTO user_credentials (user_id, password_hash, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (user_id) DO UPDATE
          SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
          `,
          [userId, passwordHash]
        );
      }
      continue;
    }

    if (parts.length === 2 && parts[0] === 'settings' && parts[1] === 'system') {
      await client.query(
        `
        INSERT INTO system_settings (
          id,
          sku_prefix,
          bad_debt_threshold_days,
          tax_rate,
          loyalty_point_rate,
          updated_at
        )
        VALUES (
          'system',
          $1,
          $2,
          $3,
          $4,
          COALESCE($5::timestamptz, NOW())
        )
        ON CONFLICT (id) DO UPDATE
        SET
          sku_prefix = EXCLUDED.sku_prefix,
          bad_debt_threshold_days = EXCLUDED.bad_debt_threshold_days,
          tax_rate = EXCLUDED.tax_rate,
          loyalty_point_rate = EXCLUDED.loyalty_point_rate,
          updated_at = EXCLUDED.updated_at
        `,
        [
          normalizeString(value.skuPrefix) || 'KK-',
          normalizeInteger(value.badDebtThresholdDays, 30),
          normalizeNumber(value.taxRate, 16),
          normalizeInteger(value.loyaltyPointRate, 100),
          normalizeTimestamp(value.updatedAt)
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'products') {
      await client.query(
        `
        INSERT INTO products (
          id,
          sku,
          barcode,
          name,
          category_id,
          supplier_id,
          buying_price,
          selling_price,
          stock_quantity,
          unit_type,
          expiry_date,
          low_stock_threshold,
          is_hot_item,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14::timestamptz, $15::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET
          sku = EXCLUDED.sku,
          barcode = EXCLUDED.barcode,
          name = EXCLUDED.name,
          category_id = EXCLUDED.category_id,
          supplier_id = EXCLUDED.supplier_id,
          buying_price = EXCLUDED.buying_price,
          selling_price = EXCLUDED.selling_price,
          stock_quantity = EXCLUDED.stock_quantity,
          unit_type = EXCLUDED.unit_type,
          expiry_date = EXCLUDED.expiry_date,
          low_stock_threshold = EXCLUDED.low_stock_threshold,
          is_hot_item = EXCLUDED.is_hot_item,
          updated_at = EXCLUDED.updated_at
        `,
        [
          parts[1],
          normalizeString(value.sku) || parts[1],
          normalizeString(value.barcode) || parts[1],
          normalizeString(value.name) || 'Unnamed Product',
          normalizeNullableString(value.categoryId),
          normalizeNullableString(value.supplierId),
          normalizeNumber(value.buyingPrice, 0),
          normalizeNumber(value.sellingPrice, 0),
          normalizeInteger(value.stockQuantity, 0),
          normalizeString(value.unitType) || 'pcs',
          normalizeTimestamp(value.expiryDate),
          normalizeInteger(value.lowStockThreshold, 5),
          normalizeBoolean(value.isHotItem, false),
          normalizeTimestamp(value.createdAt) || new Date().toISOString(),
          normalizeTimestamp(value.updatedAt) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'customers') {
      await client.query(
        `
        INSERT INTO customers (
          id,
          customer_code,
          name,
          phone,
          email,
          address,
          loyalty_points,
          total_balance,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          customer_code = EXCLUDED.customer_code,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          address = EXCLUDED.address,
          loyalty_points = EXCLUDED.loyalty_points,
          total_balance = EXCLUDED.total_balance,
          updated_at = NOW()
        `,
        [
          parts[1],
          normalizeNullableString(value.customerCode),
          normalizeString(value.name) || 'Unnamed Customer',
          normalizeNullableString(value.phone),
          normalizeNullableString(value.email),
          normalizeNullableString(value.address),
          normalizeInteger(value.loyaltyPoints, 0),
          normalizeNumber(value.totalBalance, 0),
          normalizeTimestamp(value.createdAt) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'sales') {
      await client.query(
        `
        INSERT INTO sales (
          id,
          cashier_id,
          cashier_name,
          total_amount,
          tax_amount,
          payment_method,
          amount_paid,
          balance,
          customer_name,
          customer_id,
          reference,
          is_credit,
          is_refunded,
          refund_amount,
          refunded_at,
          refunded_by,
          refund_reason,
          outstanding_balance,
          sold_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $16, $17, $18, $19::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET
          cashier_id = EXCLUDED.cashier_id,
          cashier_name = EXCLUDED.cashier_name,
          total_amount = EXCLUDED.total_amount,
          tax_amount = EXCLUDED.tax_amount,
          payment_method = EXCLUDED.payment_method,
          amount_paid = EXCLUDED.amount_paid,
          balance = EXCLUDED.balance,
          customer_name = EXCLUDED.customer_name,
          customer_id = EXCLUDED.customer_id,
          reference = EXCLUDED.reference,
          is_credit = EXCLUDED.is_credit,
          is_refunded = EXCLUDED.is_refunded,
          refund_amount = EXCLUDED.refund_amount,
          refunded_at = EXCLUDED.refunded_at,
          refunded_by = EXCLUDED.refunded_by,
          refund_reason = EXCLUDED.refund_reason,
          outstanding_balance = EXCLUDED.outstanding_balance,
          sold_at = EXCLUDED.sold_at
        `,
        [
          parts[1],
          normalizeNullableString(value.cashierId),
          normalizeString(value.cashierName) || 'Unknown',
          normalizeNumber(value.totalAmount, 0),
          normalizeNumber(value.taxAmount, 0),
          normalizeString(value.paymentMethod) || 'cash',
          normalizeNumber(value.amountPaid, 0),
          normalizeNumber(value.balance, 0),
          normalizeNullableString(value.customerName),
          normalizeNullableString(value.customerId),
          normalizeNullableString(value.reference),
          normalizeBoolean(value.isCredit, false),
          normalizeBoolean(value.isRefunded, false),
          normalizeNumber(value.refundAmount, 0),
          normalizeTimestamp(value.refundedAt),
          normalizeNullableString(value.refundedBy),
          normalizeNullableString(value.refundReason),
          normalizeNumber(value.outstandingBalance, 0),
          normalizeTimestamp(value.timestamp) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 4 && parts[0] === 'sales' && parts[2] === 'items') {
      await client.query(
        `
        INSERT INTO sale_items (
          id,
          sale_id,
          product_id,
          product_name,
          barcode,
          quantity,
          unit_price,
          total_price,
          display_name,
          selling_price,
          is_refunded,
          status,
          refunded_at,
          refunded_by,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14, $15::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET
          sale_id = EXCLUDED.sale_id,
          product_id = EXCLUDED.product_id,
          product_name = EXCLUDED.product_name,
          barcode = EXCLUDED.barcode,
          quantity = EXCLUDED.quantity,
          unit_price = EXCLUDED.unit_price,
          total_price = EXCLUDED.total_price,
          display_name = EXCLUDED.display_name,
          selling_price = EXCLUDED.selling_price,
          is_refunded = EXCLUDED.is_refunded,
          status = EXCLUDED.status,
          refunded_at = EXCLUDED.refunded_at,
          refunded_by = EXCLUDED.refunded_by
        `,
        [
          parts[3],
          parts[1],
          normalizeString(value.productId) || '',
          normalizeString(value.productName) || normalizeString(value.name) || 'Unknown Product',
          normalizeNullableString(value.barcode),
          normalizeInteger(value.quantity, 0),
          normalizeNumber(value.unitPrice, normalizeNumber(value.sellingPrice, 0)),
          normalizeNumber(value.totalPrice, 0),
          normalizeNullableString(value.name),
          normalizeNumber(value.sellingPrice, normalizeNumber(value.unitPrice, 0)),
          normalizeBoolean(value.isRefunded, false),
          normalizeString(value.status) || 'sold',
          normalizeTimestamp(value.refundedAt),
          normalizeNullableString(value.refundedBy),
          normalizeTimestamp(value.timestamp) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'credits') {
      await client.query(
        `
        INSERT INTO credits (
          id,
          sale_id,
          customer_id,
          customer_name,
          total_amount,
          amount_paid,
          outstanding_balance,
          items,
          status,
          created_at,
          refunded_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          sale_id = EXCLUDED.sale_id,
          customer_id = EXCLUDED.customer_id,
          customer_name = EXCLUDED.customer_name,
          total_amount = EXCLUDED.total_amount,
          amount_paid = EXCLUDED.amount_paid,
          outstanding_balance = EXCLUDED.outstanding_balance,
          items = EXCLUDED.items,
          status = EXCLUDED.status,
          refunded_at = EXCLUDED.refunded_at,
          updated_at = NOW()
        `,
        [
          parts[1],
          normalizeString(value.saleId) || '',
          normalizeNullableString(value.customerId),
          normalizeString(value.customerName) || 'Walk-in Customer',
          normalizeNumber(value.totalAmount, 0),
          normalizeNumber(value.amountPaid, 0),
          normalizeNumber(value.outstandingBalance, 0),
          normalizeString(value.items) || '',
          normalizeString(value.status) || 'open',
          normalizeTimestamp(value.timestamp) || new Date().toISOString(),
          normalizeTimestamp(value.refundedAt)
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'credit_payments') {
      await client.query(
        `
        INSERT INTO credit_payments (
          id,
          credit_id,
          sale_id,
          amount_paid,
          remaining_balance,
          payment_method,
          reference,
          cashier_id,
          cashier_name,
          paid_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET
          credit_id = EXCLUDED.credit_id,
          sale_id = EXCLUDED.sale_id,
          amount_paid = EXCLUDED.amount_paid,
          remaining_balance = EXCLUDED.remaining_balance,
          payment_method = EXCLUDED.payment_method,
          reference = EXCLUDED.reference,
          cashier_id = EXCLUDED.cashier_id,
          cashier_name = EXCLUDED.cashier_name,
          paid_at = EXCLUDED.paid_at
        `,
        [
          parts[1],
          normalizeString(value.creditId) || '',
          normalizeString(value.saleId) || '',
          normalizeNumber(value.amountPaid, 0),
          normalizeNumber(value.remainingBalance, 0),
          normalizeString(value.paymentMethod) || 'cash',
          normalizeNullableString(value.reference),
          normalizeNullableString(value.cashierId),
          normalizeString(value.cashierName) || 'Unknown',
          normalizeTimestamp(value.timestamp) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'inventory_transactions') {
      const quantity = normalizeInteger(value.quantity, 0);
      const type = normalizeString(value.type) || 'adjustment';
      await client.query(
        `
        INSERT INTO inventory_ledger (
          id,
          product_id,
          type,
          quantity,
          quantity_delta,
          reason,
          user_id,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET
          product_id = EXCLUDED.product_id,
          type = EXCLUDED.type,
          quantity = EXCLUDED.quantity,
          quantity_delta = EXCLUDED.quantity_delta,
          reason = EXCLUDED.reason,
          user_id = EXCLUDED.user_id,
          created_at = EXCLUDED.created_at
        `,
        [
          parts[1],
          normalizeString(value.productId) || '',
          type,
          Math.abs(quantity),
          type === 'stock-out' ? -Math.abs(quantity) : Math.abs(quantity),
          normalizeNullableString(value.reason),
          normalizeNullableString(value.userId),
          normalizeTimestamp(value.timestamp) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 2 && parts[0] === 'audit_logs') {
      await client.query(
        `
        INSERT INTO audit_logs (
          id,
          user_id,
          user_name,
          action,
          details,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          user_name = EXCLUDED.user_name,
          action = EXCLUDED.action,
          details = EXCLUDED.details,
          created_at = EXCLUDED.created_at
        `,
        [
          parts[1],
          normalizeNullableString(value.userId),
          normalizeString(value.userName) || 'System',
          normalizeString(value.action) || 'UNKNOWN',
          normalizeString(value.details) || '',
          normalizeTimestamp(value.timestamp) || new Date().toISOString()
        ]
      );
      continue;
    }

    if (parts.length === 2) {
      await client.query(
        `
        INSERT INTO app_documents (
          collection_name,
          id,
          payload,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3::jsonb, NOW(), NOW()
        )
        ON CONFLICT (collection_name, id) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = NOW()
        `,
        [parts[0], parts[1], JSON.stringify(value)]
      );
    }
  }
}

function normalizeLegacyStore(value: LegacyStore | string | undefined): LegacyStore {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as LegacyStore;
    } catch {
      return {};
    }
  }

  return value;
}

function normalizeLegacyValue(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return decodeLegacyShape(value) as Record<string, unknown>;
}

function decodeLegacyShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeLegacyShape(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (typeof value.__kk_timestamp === 'string') {
    return value.__kk_timestamp;
  }
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = decodeLegacyShape(nestedValue);
  }
  return output;
}

function extractLegacyPassword(authAccounts: Record<string, unknown>, email: string, userId: string) {
  for (const accountValue of Object.values(authAccounts)) {
    if (!isRecord(accountValue)) {
      continue;
    }
    const accountEmail = normalizeString(accountValue.email);
    const accountUserId = normalizeString(accountValue.uid);
    if ((accountEmail && accountEmail.toLowerCase() === email.toLowerCase()) || accountUserId === userId) {
      return normalizeString(accountValue.password);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback = 0) {
  return Math.trunc(normalizeNumber(value, fallback));
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function normalizeTimestamp(value: unknown) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (isRecord(value)) {
    if (typeof value.toDate === 'function') {
      try {
        const date = value.toDate();
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch {
        // Ignore and try other known shapes.
      }
    }
    if (typeof value.seconds === 'number') {
      const milliseconds = value.seconds * 1000 + Math.floor(normalizeNumber(value.nanoseconds, 0) / 1_000_000);
      return new Date(milliseconds).toISOString();
    }
    if (typeof value.__kk_timestamp === 'string') {
      return normalizeTimestamp(value.__kk_timestamp);
    }
  }
  return null;
}

export type MutationResult = QueryResult<any>;
